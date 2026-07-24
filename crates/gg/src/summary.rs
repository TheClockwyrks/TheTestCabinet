//! The gg **session summary tracker**: accumulates the aggregatable, telemetry-derived
//! counts of a run as its telemetry is emitted, then finalizes them into a
//! [`GgSessionSummary`] the binary emits once, just before the session ends.
//!
//! gg's experiments are only analyzable in aggregate over fields we durably record (see the
//! [result aggregation](https://docs.testcabinet.ai/gg/result-aggregation/) design), so a run
//! must carry a compact summary of its own outcome rather than forcing every query to re-parse
//! the whole event stream. This tracker computes that summary **from the telemetry the run
//! actually emitted**: the [`Emitter`](crate::telemetry::Emitter) funnels every emitted event
//! through [`observe`](SessionSummaryTracker::observe) — the single choke point every agent's
//! stream passes through — so the counts derive from exactly the stream the run recorded,
//! across the root and every subagent, without threading counters through the orchestrator. At
//! session end the binary [`finalize`](SessionSummaryTracker::finalize)s the accumulated state
//! into a [`GgSessionSummary`] and emits it as the terminal
//! [`SessionSummary`](GgTelemetryKind::SessionSummary) event; `core` then lifts it onto the run
//! record. Because the summary is derived from the same events it summarizes, the two are
//! consistent by construction.

use std::collections::HashSet;
use std::sync::Mutex;

use test_cabinet_core::gg::{
    GgCodeReviewPhase, GgIssueStatus, GgSessionSummary, GgSlotCost, GgSpeculationPhase,
    GgTelemetryKind,
};

/// Accumulates a running session's aggregatable outcome from the telemetry stream it
/// [observes](Self::observe), so the binary can [finalize](Self::finalize) it into a
/// [`GgSessionSummary`] at session end.
///
/// Held behind an [`Arc`](std::sync::Arc) shared by every [`Emitter`](crate::telemetry::Emitter)
/// derived over a run (the base emitter and every agent-scoped child), so an agent's task on any
/// thread can fold its events in. Interior mutability (a [`Mutex`]) keeps the shared handle
/// `&self`, matching the emitter's `&self` emit path.
#[derive(Default)]
pub struct SessionSummaryTracker {
    inner: Mutex<SummaryState>,
}

/// The mutable accumulator behind a [`SessionSummaryTracker`]. Issue ids are held as sets so a
/// [`BoardState`](GgTelemetryKind::BoardState) re-emitted every mutation contributes each issue
/// once (created) and each completed issue once (even if it was reopened and re-completed).
#[derive(Default)]
struct SummaryState {
    /// One per [`AgentSpawned`](GgTelemetryKind::AgentSpawned) — the root plus every subagent.
    agents_spawned: u64,
    /// The deepest [`AgentSpawned`](GgTelemetryKind::AgentSpawned) depth seen (`0` for the root).
    max_subagent_depth: u64,
    /// One per [`Compaction`](GgTelemetryKind::Compaction) boundary.
    compactions: u64,
    /// How many [`ContextBreakdown`](GgTelemetryKind::ContextBreakdown) turns reported fullness at
    /// or above the ceiling (`>= 1.0`).
    context_overflow_count: u64,
    /// The fullness of the most recent [`ContextBreakdown`](GgTelemetryKind::ContextBreakdown) that
    /// carried one.
    final_fullness: Option<f64>,
    /// One per Code Review [`Requested`](GgCodeReviewPhase::Requested) phase.
    code_reviews: u64,
    /// One per Code Review verdict — a [`ChangesRequested`](GgCodeReviewPhase::ChangesRequested) or
    /// an [`Approved`](GgCodeReviewPhase::Approved) phase.
    review_cycles: u64,
    /// One per [`ChangesRequested`](GgCodeReviewPhase::ChangesRequested) phase (an issue reopened
    /// for fixes).
    issues_reopened: u64,
    /// One per speculation [`FannedOut`](GgSpeculationPhase::FannedOut) phase (a best-of-K round).
    speculations: u64,
    /// Every distinct issue id observed on the board.
    issues_created: HashSet<String>,
    /// Every distinct issue id observed at [`Done`](GgIssueStatus::Done) on the board.
    issues_completed: HashSet<String>,
    /// One entry per [`SlotUsage`](GgTelemetryKind::SlotUsage) rollup, captured in emission order.
    slot_costs: Vec<GgSlotCost>,
    /// The [effective toolset](GgSessionSummary::effective_tools) — the exact tool names offered to
    /// the run's (root) agent, in the order presented to the model. Unlike every other field this is
    /// **not** telemetry-derived (no event carries the offered toolset); the binary records it once,
    /// off the assembled [`ToolRegistry`](crate::tools::ToolRegistry), via
    /// [`record_effective_tools`](SessionSummaryTracker::record_effective_tools).
    effective_tools: Vec<String>,
}

impl SessionSummaryTracker {
    /// A fresh, empty tracker.
    pub fn new() -> Self {
        Self::default()
    }

    /// Record the run's [effective toolset](GgSessionSummary::effective_tools) — the exact set of
    /// tool names offered to the (root) agent, in the order they were presented to the model.
    ///
    /// This is the one summary figure that is not folded in from the telemetry stream (no event
    /// carries the offered toolset), so the binary sets it once, off the root agent's assembled
    /// [`ToolRegistry`](crate::tools::ToolRegistry), before [finalizing](Self::finalize). Recording
    /// the *resolved* toolset — a capability's tools only when enabled and, for the stateful ones,
    /// only when their store is non-empty, minus any individually
    /// [withheld](test_cabinet_core::gg::GgCapabilitySet::disabled_tools) tool — makes the toolset a
    /// first-class, slice-by ablation variable rather than something a query must re-derive from the
    /// capability set.
    pub fn record_effective_tools(&self, tools: Vec<String>) {
        let mut state = self.inner.lock().expect("summary tracker lock");
        state.effective_tools = tools;
    }

    /// Fold one emitted telemetry event into the running summary.
    ///
    /// Called by the [`Emitter`](crate::telemetry::Emitter) for **every** event it emits, so the
    /// accumulated counts always reflect exactly the stream the run recorded. Only the events that
    /// contribute an aggregatable figure are counted; the rest (session/turn lifecycle, assistant
    /// text, per-turn usage deltas, and the terminal
    /// [`SessionSummary`](GgTelemetryKind::SessionSummary)/[`SessionEnded`](GgTelemetryKind::SessionEnded)
    /// events this summary precedes) are observed and ignored.
    pub fn observe(&self, kind: &GgTelemetryKind) {
        let mut state = self.inner.lock().expect("summary tracker lock");
        match kind {
            GgTelemetryKind::AgentSpawned { depth, .. } => {
                state.agents_spawned += 1;
                state.max_subagent_depth = state.max_subagent_depth.max(*depth);
            }
            GgTelemetryKind::Compaction { .. } => state.compactions += 1,
            GgTelemetryKind::ContextBreakdown {
                fullness: Some(fullness),
                ..
            } => {
                state.final_fullness = Some(*fullness);
                if *fullness >= 1.0 {
                    state.context_overflow_count += 1;
                }
            }
            GgTelemetryKind::CodeReview { phase, .. } => match phase {
                GgCodeReviewPhase::Requested => state.code_reviews += 1,
                GgCodeReviewPhase::ChangesRequested => {
                    state.review_cycles += 1;
                    state.issues_reopened += 1;
                }
                GgCodeReviewPhase::Approved => state.review_cycles += 1,
            },
            GgTelemetryKind::Speculation { phase, .. } => {
                if matches!(phase, GgSpeculationPhase::FannedOut) {
                    state.speculations += 1;
                }
            }
            GgTelemetryKind::BoardState { issues, .. } => {
                for issue in issues {
                    state.issues_created.insert(issue.id.clone());
                    if issue.status == GgIssueStatus::Done {
                        state.issues_completed.insert(issue.id.clone());
                    }
                }
            }
            GgTelemetryKind::SlotUsage {
                slot,
                model_id,
                tokens,
                cost,
            } => state.slot_costs.push(GgSlotCost {
                slot: slot.clone(),
                model_id: model_id.clone(),
                tokens: *tokens,
                cost: *cost,
            }),
            // Every other event carries no aggregatable figure of its own: session/turn
            // lifecycle, assistant text and tool call/result, per-turn usage deltas, the
            // knowledge-state snapshots (skills/memories/tasks), planning/agent-status/worktree/
            // workflow/fsm transitions, diagnostic logs, and the terminal summary/ended events
            // this summary itself precedes.
            _ => {}
        }
    }

    /// Build the [`GgSessionSummary`] from the accumulated state, stamped with the run's
    /// `terminal_status` (the [`SessionEnded`](GgTelemetryKind::SessionEnded) status this summary
    /// precedes). Called once at session end; the tracker is not reset (a run computes one
    /// summary).
    pub fn finalize(&self, terminal_status: &str) -> GgSessionSummary {
        let state = self.inner.lock().expect("summary tracker lock");
        GgSessionSummary {
            terminal_status: terminal_status.to_string(),
            agents_spawned: state.agents_spawned,
            // Every agent but the root is a subagent; a single-agent run reports `0`.
            subagent_count: state.agents_spawned.saturating_sub(1),
            max_subagent_depth: state.max_subagent_depth,
            compactions: state.compactions,
            ran_out_of_context: state.context_overflow_count > 0,
            context_overflow_count: state.context_overflow_count,
            final_fullness: state.final_fullness,
            code_reviews: state.code_reviews,
            review_cycles: state.review_cycles,
            issues_reopened: state.issues_reopened,
            speculations: state.speculations,
            issues_created: state.issues_created.len() as u64,
            issues_completed: state.issues_completed.len() as u64,
            slot_costs: state.slot_costs.clone(),
            effective_tools: state.effective_tools.clone(),
        }
    }
}

#[cfg(test)]
#[path = "summary.test.rs"]
mod tests;
