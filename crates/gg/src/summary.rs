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
//!
//! # Folded figures and recorded facts
//!
//! Almost every figure is **folded** from the stream by [`observe`](SessionSummaryTracker::observe),
//! which is what keeps numerator and denominator on one mechanism: the run's
//! [healing rollup](GgHealingSummary) and the
//! [`code_executions`](GgSessionSummary::code_executions) it is a rate over are folded from the very
//! same [`CodeExecution`](GgTelemetryKind::CodeExecution) event, so the two can never come from
//! different places and drift. The run's [error rollup](GgErrorSummary) is folded on exactly the
//! same terms from the [`TurnOutcome`](GgTelemetryKind::TurnOutcome) event — one per turn of every
//! agent — so its errors and the turns they are a rate over are counted by the same statement.
//!
//! Four figures cannot be folded and are **recorded** instead, each by its own `record_*` method
//! that the binary calls once. Three of them —
//! [`effective_tools`](SessionSummaryTracker::record_effective_tools),
//! [`execution_mode`](SessionSummaryTracker::record_execution_mode) and
//! [`limits`](SessionSummaryTracker::record_limits) — are configuration facts no event carries. The
//! fourth, [`limit_hit`](SessionSummaryTracker::record_limit_hit), is recorded for a sharper reason:
//! a [`LimitExceeded`](GgTelemetryKind::LimitExceeded) event *is* on the stream, but this one tracker
//! is shared by every agent, and a subagent that stopped on its own error ceiling is not how the
//! **run** ended. Folding that event would report a child's ceiling as the run's outcome, so the
//! binary records the root loop's own breach and this module never looks at the event.

use std::collections::BTreeSet;
use std::sync::Mutex;

use test_cabinet_core::gg::{
    GgErrorSummary, GgHealingStrategy, GgHealingSummary, GgIssueReviewPhase, GgIssueStatus,
    GgLimitBreach, GgProgramLanguage, GgResponseHealing, GgRunLimits, GgSessionSummary, GgSlotCost,
    GgSpeculationPhase, GgTelemetryKind, GgTurnErrorKind,
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
    /// One per issue-review [`Requested`](GgIssueReviewPhase::Requested) phase.
    issue_reviews: u64,
    /// One per issue-review verdict — a [`ChangesRequested`](GgIssueReviewPhase::ChangesRequested) or
    /// an [`Approved`](GgIssueReviewPhase::Approved) phase.
    review_cycles: u64,
    /// One per [`ChangesRequested`](GgIssueReviewPhase::ChangesRequested) phase (an issue reopened
    /// for fixes).
    issues_reopened: u64,
    /// One per speculation [`FannedOut`](GgSpeculationPhase::FannedOut) phase (a best-of-K round).
    speculations: u64,
    /// One per [`CodeExecution`](GgTelemetryKind::CodeExecution) event (a code-shaped turn).
    code_executions: u64,
    /// The run's [response-healing](GgHealingSummary) rollup, folded from the healing record on
    /// each of those same [`CodeExecution`](GgTelemetryKind::CodeExecution) events — so
    /// [`code_executions`](Self::code_executions) is the exact denominator for every rate over it,
    /// by construction rather than by convention.
    ///
    /// The contract type doubles as the accumulator: it is [`Default`] and every field is a `u64`
    /// counter, so there is nothing to convert at [finalize](SessionSummaryTracker::finalize) time
    /// and no second shape that could disagree with the one the run records.
    healing: GgHealingSummary,
    /// The run's [error rollup](GgErrorSummary), folded from the
    /// [`TurnOutcome`](GgTelemetryKind::TurnOutcome) event every agent emits once per turn — so the
    /// numerator (errors) and the denominator ([`turns`](GgErrorSummary::turns)) come off the same
    /// statement, exactly as the [healing rollup](Self::healing) does, and neither can drift from
    /// the number of model calls the run made.
    ///
    /// Run-wide across the root and every subagent, because that is the stream this one tracker
    /// observes. The per-agent breakdown is not lost: each event rides on its own agent's id, so a
    /// reader of the stream can split what this rollup totals.
    ///
    /// Like [`healing`](Self::healing), the contract type doubles as the accumulator — it is
    /// [`Default`] and every field is a `u64` counter — so there is nothing to convert at
    /// [finalize](SessionSummaryTracker::finalize) time and no second shape that could disagree
    /// with the one the run records.
    errors: GgErrorSummary,
    /// The run's [execution mode](GgSessionSummary::execution_mode) — `"responses_as_code"` or
    /// `"tool_calling"`. Like [`effective_tools`](Self::effective_tools) this is **not**
    /// telemetry-derived (no event carries the configured mode); the binary records it once via
    /// [`record_execution_mode`](SessionSummaryTracker::record_execution_mode). Defaults to
    /// tool-calling until set.
    execution_mode: Option<String>,
    /// The run's [program language](GgSessionSummary::program_language), recorded on exactly the
    /// terms [`execution_mode`](Self::execution_mode) is: no event carries it, so the binary sets it
    /// once off the run's configuration. `None` for a tool-calling run, which writes no programs.
    program_language: Option<GgProgramLanguage>,
    /// Every distinct issue id observed on the board.
    issues_created: BTreeSet<String>,
    /// Every distinct issue id observed at [`Done`](GgIssueStatus::Done) on the board.
    issues_completed: BTreeSet<String>,
    /// One entry per [`SlotUsage`](GgTelemetryKind::SlotUsage) rollup, captured in emission order.
    slot_costs: Vec<GgSlotCost>,
    /// The [effective toolset](GgSessionSummary::effective_tools) — the exact tool names offered to
    /// the run's (root) agent, in the order presented to the model. Unlike every other field this is
    /// **not** telemetry-derived (no event carries the offered toolset); the binary records it once,
    /// off the assembled [`ToolRegistry`](crate::tools::ToolRegistry), via
    /// [`record_effective_tools`](SessionSummaryTracker::record_effective_tools).
    effective_tools: Vec<String>,
    /// The [execution ceilings](GgRunLimits) that were in force for the run — the configured set
    /// with gg's own turn default filled in. Like [`effective_tools`](Self::effective_tools) this
    /// is a resolved configuration fact no event carries, recorded once via
    /// [`record_limits`](SessionSummaryTracker::record_limits). Defaults to "no ceiling declared"
    /// until set, which is also what a run that never reached the resolver reports.
    limits: GgRunLimits,
    /// The ceiling that stopped the **run**, when one did — the root agent's own breach, recorded
    /// once via [`record_limit_hit`](SessionSummaryTracker::record_limit_hit) from the root loop's
    /// outcome.
    ///
    /// Deliberately **not** folded from [`LimitExceeded`](GgTelemetryKind::LimitExceeded), even
    /// though that event carries exactly this payload: every agent's stream passes through this one
    /// tracker, and a subagent that stopped on its own error ceiling reported back through the
    /// delegation channel while the run carried on. Folding the event would publish that child's
    /// ceiling as the run's outcome.
    limit_hit: Option<GgLimitBreach>,
    /// The [response-healing](crate::healing) strategies that were **armed** for the run — a fourth
    /// resolved-configuration fact no event carries, recorded once via
    /// [`record_healing`](SessionSummaryTracker::record_healing).
    ///
    /// Empty until set, which is exactly what a tool-calling run reports: healing never runs there,
    /// so there is no armed set to record.
    healing_enabled: Vec<GgHealingStrategy>,
}

impl SummaryState {
    /// Fold one code-shaped turn's [healing record](GgResponseHealing) into the run's rollup.
    ///
    /// Split out of [`observe`](SessionSummaryTracker::observe) because it is the one arm with real
    /// arithmetic in it, and because the definitions it encodes are worth stating in one place:
    ///
    /// * every entry in [`strategies`](GgResponseHealing::strategies) is one **application**, and a
    ///   strategy that fired twice on one response is two — which is why the record carries a list
    ///   rather than a set;
    /// * a response is **healed** exactly when at least one repair was applied to it, since every
    ///   healed reply then runs.
    ///
    /// The per-strategy `match` is exhaustive on purpose: a strategy added to the contract is a
    /// compile error here rather than an application silently missing from every run's rollup.
    fn fold_healing(&mut self, healing: &GgResponseHealing) {
        let rollup = &mut self.healing;
        for strategy in &healing.strategies {
            rollup.applications += 1;
            let count = match strategy {
                GgHealingStrategy::StripFences => &mut rollup.strip_fences,
                GgHealingStrategy::StripProse => &mut rollup.strip_prose,
                GgHealingStrategy::DropDoubledResponse => &mut rollup.drop_doubled_response,
                GgHealingStrategy::DropDuplicateProgram => &mut rollup.drop_duplicate_program,
                GgHealingStrategy::DropImports => &mut rollup.drop_imports,
                GgHealingStrategy::UnwrapAsync => &mut rollup.unwrap_async,
            };
            *count += 1;
        }
        // A clean response — nothing repaired — is the overwhelmingly common shape, and the one that
        // contributes only to the denominator.
        if !healing.strategies.is_empty() {
            rollup.healed += 1;
        }
    }

    /// Fold one turn's [outcome](GgTelemetryKind::TurnOutcome) into the run's
    /// [error rollup](GgErrorSummary).
    ///
    /// Split out beside [`fold_healing`](Self::fold_healing) for the same reason — it is arithmetic
    /// with definitions in it — and those definitions are:
    ///
    /// * **every** recorded turn advances [`turns`](GgErrorSummary::turns), whatever its outcome,
    ///   including the one that finished the session and the one that ended it fatally. That is what
    ///   makes the denominator the count of model calls the run made rather than the count of turns
    ///   that could have failed;
    /// * [`max_consecutive`](GgErrorSummary::max_consecutive) is a **maximum over the per-turn
    ///   counts**, not a streak this tracker keeps. The count is per agent and this stream is
    ///   run-wide, so a streak folded here would be an artefact of how two agents' turns happened to
    ///   interleave;
    /// * a fatal turn is counted in `turns` and **nowhere else**: gg's own machinery failing is not
    ///   charged to the model's error budget, exactly as no ceiling ever observes one;
    /// * [`loop_aborts`](GgErrorSummary::loop_aborts) is a plain sum, and is not an error count —
    ///   the discarded attempt was retried and this very turn is the retry's outcome.
    ///
    /// The error is keyed on the [kind](GgTurnErrorKind) rather than on the outcome, which keeps
    /// [`errors`](GgErrorSummary::errors) exactly the sum of the per-kind counters the contract
    /// promises it to be. gg pairs the two by construction (`TurnOutcome::wire` returns them
    /// together), so the two readings only differ for a stream gg did not write — and for one of
    /// those, a total that still agrees with its own parts is the better answer.
    ///
    /// The per-kind `match` is exhaustive on purpose: a kind added to the contract is a compile
    /// error here rather than an error silently missing from every run's rollup.
    fn fold_turn_outcome(
        &mut self,
        error: Option<GgTurnErrorKind>,
        consecutive_errors: u64,
        loop_aborts: u64,
    ) {
        let rollup = &mut self.errors;
        rollup.turns += 1;
        rollup.max_consecutive = rollup.max_consecutive.max(consecutive_errors);
        rollup.loop_aborts += loop_aborts;

        let Some(kind) = error else {
            return;
        };
        rollup.errors += 1;
        let count = match kind {
            GgTurnErrorKind::ModelApi => &mut rollup.model_api,
            GgTurnErrorKind::Transpile => &mut rollup.transpile,
            GgTurnErrorKind::ProgramFault => &mut rollup.program_fault,
            GgTurnErrorKind::SandboxLimit => &mut rollup.sandbox_limit,
            GgTurnErrorKind::MissingCompletion => &mut rollup.missing_completion,
        };
        *count += 1;
    }
}

impl SessionSummaryTracker {
    /// A fresh, empty tracker.
    pub fn new() -> Self {
        Self::default()
    }

    /// Record the run's [effective toolset](GgSessionSummary::effective_tools) — the exact set of
    /// tool names offered to the (root) agent, in the order they were presented to the model.
    ///
    /// One of the four summary figures that are recorded rather than folded in from the telemetry
    /// stream (no event carries the offered toolset), so the binary sets it once, off the root
    /// agent's assembled [`ToolRegistry`](crate::tools::ToolRegistry), before
    /// [finalizing](Self::finalize). Recording
    /// the *resolved* toolset — a capability's tools only when enabled and, for the stateful ones,
    /// only when their store is non-empty, minus any individually
    /// [withheld](test_cabinet_core::gg::GgCapabilitySet::disabled_tools) tool — makes the toolset a
    /// first-class, slice-by ablation variable rather than something a query must re-derive from the
    /// capability set.
    pub fn record_effective_tools(&self, tools: Vec<String>) {
        let mut state = self.inner.lock().expect("summary tracker lock");
        state.effective_tools = tools;
    }

    /// Record the run's [execution mode](GgSessionSummary::execution_mode) — `"responses_as_code"`
    /// when the [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) capability
    /// drove the run, else `"tool_calling"`.
    ///
    /// Like [`record_effective_tools`](Self::record_effective_tools) this is a configuration fact no
    /// event carries, so the binary sets it once (off the run's capability set) before
    /// [finalizing](Self::finalize). Recording the mode the run *actually* ran in makes "does a
    /// code-shaped response help?" a durable, sliceable outcome dimension alongside the
    /// [`cap.responses-as-code`](test_cabinet_core::gg_query) document field.
    pub fn record_execution_mode(&self, mode: impl Into<String>) {
        let mut state = self.inner.lock().expect("summary tracker lock");
        state.execution_mode = Some(mode.into());
    }

    /// Record the [program language](GgSessionSummary::program_language) the run's root agent wrote
    /// its programs in — or `None` for a tool-calling run, which wrote none.
    ///
    /// The fourth configuration fact no event carries, recorded on exactly the terms
    /// [`record_execution_mode`](Self::record_execution_mode) is and immediately beside it. It is
    /// the axis a cross-language study slices its arms on, and it is a **scalar**, which is what
    /// makes it queryable for free: the summary is flattened as `summary.*`, so it arrives as
    /// `summary.programLanguage` with no change to the query vocabulary at all.
    ///
    /// `None` and "TypeScript" are genuinely different answers here — the first is a run with no
    /// program language, the second is a run with that one — so it is recorded rather than left to
    /// default, and a reader can tell a tool-calling arm from a code arm without re-deriving the
    /// capability set.
    pub fn record_program_language(&self, language: Option<GgProgramLanguage>) {
        let mut state = self.inner.lock().expect("summary tracker lock");
        state.program_language = language;
    }

    /// Record the [execution ceilings](GgRunLimits) that were actually **in force** for this run —
    /// the configured set with gg's own turn default filled in, as the resolver produced it.
    ///
    /// A third configuration fact no event carries, so the binary sets it once, immediately after
    /// the orchestrator resolves it and long before any ceiling could be breached. Recording the
    /// *resolved* set rather than leaving a query to re-derive it from the
    /// [capability set](test_cabinet_core::gg::GgCapabilitySet) is what makes "what was this run
    /// bounded by?" answerable for every run, including one that declared nothing and inherited the
    /// default — an unrecorded default is an invisible one, and a study that cannot see it cannot
    /// control for it.
    pub fn record_limits(&self, limits: GgRunLimits) {
        let mut state = self.inner.lock().expect("summary tracker lock");
        state.limits = limits;
    }

    /// Record the [response-healing](crate::healing) strategies that were **armed** for this run,
    /// in the order gg applies them.
    ///
    /// A fourth configuration fact no event carries, recorded once beside
    /// [`record_limits`](Self::record_limits) and only for a
    /// [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) run, because a
    /// tool-calling run never heals anything and an armed set recorded for one would be an
    /// intention that had no effect.
    ///
    /// It exists because every other figure in the [healing rollup](GgHealingSummary) is a
    /// measurement of what *fired*, and the arm of an ablation in which nothing fired is
    /// byte-identical to the arm in which nothing could: without this, a study slicing on
    /// "healing on vs healing off" cannot tell its own arms apart from the telemetry.
    pub fn record_healing(&self, enabled: Vec<GgHealingStrategy>) {
        let mut state = self.inner.lock().expect("summary tracker lock");
        state.healing_enabled = enabled;
    }

    /// Record the [ceiling](GgRunLimits) that stopped the **run**, or `None` for a run that ended on
    /// its own terms.
    ///
    /// Takes an [`Option`] so the binary can hand over the root loop's outcome unconditionally,
    /// right before [finalizing](Self::finalize): the caller has one line and no branch, and "the
    /// run hit no ceiling" is recorded as deliberately as "it hit this one".
    ///
    /// This is the one summary figure whose event *is* on the stream and is still recorded rather
    /// than [folded](Self::observe): every agent shares this tracker, and a subagent that stopped on
    /// its own error ceiling ended itself and reported back while the run carried on, so its breach
    /// is not the run's outcome. Only the root's is, and only the root's loop can hand it over.
    pub fn record_limit_hit(&self, breach: Option<GgLimitBreach>) {
        let mut state = self.inner.lock().expect("summary tracker lock");
        state.limit_hit = breach;
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
            GgTelemetryKind::IssueReview { phase, .. } => match phase {
                GgIssueReviewPhase::Requested => state.issue_reviews += 1,
                GgIssueReviewPhase::ChangesRequested => {
                    state.review_cycles += 1;
                    state.issues_reopened += 1;
                }
                GgIssueReviewPhase::Approved => state.review_cycles += 1,
            },
            GgTelemetryKind::Speculation { phase, .. } => {
                if matches!(phase, GgSpeculationPhase::FannedOut) {
                    state.speculations += 1;
                }
            }
            // One event per code-shaped *turn*, including a turn whose reply did not compile — so
            // this count is the exact denominator for the healing rates folded alongside it, and
            // the two are incremented by the same statement.
            GgTelemetryKind::CodeExecution { healing, .. } => {
                state.code_executions += 1;
                state.fold_healing(healing);
            }
            // One event per *turn* of every agent, code-shaped or not — the mode-agnostic judgement
            // the error ceilings are enforced on, folded here so the run records how error-prone it
            // was even when no ceiling ever stopped it.
            GgTelemetryKind::TurnOutcome {
                error,
                consecutive_errors,
                loop_aborts,
                ..
            } => state.fold_turn_outcome(*error, *consecutive_errors, *loop_aborts),
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
            // knowledge-state snapshots (skills/memories/tasks), agent-status/worktree/
            // workflow transitions, diagnostic logs, and the terminal summary/ended events
            // this summary itself precedes.
            //
            // `LimitExceeded` is here **deliberately** rather than by omission: it carries exactly
            // the payload `limit_hit` wants, but this tracker observes every agent's stream, and a
            // subagent that stopped on its own error ceiling is not how the run ended. The root
            // loop's breach is `record_limit_hit`'s to give.
            _ => {}
        }
    }

    /// Build the [`GgSessionSummary`] from the accumulated state, stamped with the run's
    /// `terminal_status` (the [`SessionEnded`](GgTelemetryKind::SessionEnded) status this summary
    /// precedes). Called once at session end; the tracker is not reset (a run computes one
    /// summary).
    ///
    /// Copies out both halves of the state — the counts folded from the stream and the four facts
    /// the binary [recorded](Self::record_limits) — so a figure the binary never recorded reports
    /// its own default (no ceilings declared, no ceiling hit) rather than being absent, which is
    /// exactly what a run that ended before the resolver ran should say.
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
            issue_reviews: state.issue_reviews,
            review_cycles: state.review_cycles,
            issues_reopened: state.issues_reopened,
            speculations: state.speculations,
            execution_mode: state
                .execution_mode
                .clone()
                .unwrap_or_else(|| "tool_calling".to_string()),
            program_language: state.program_language,
            code_executions: state.code_executions,
            healing: GgHealingSummary {
                enabled: state.healing_enabled.clone(),
                ..state.healing.clone()
            },
            errors: state.errors.clone(),
            issues_created: state.issues_created.len() as u64,
            issues_completed: state.issues_completed.len() as u64,
            slot_costs: state.slot_costs.clone(),
            effective_tools: state.effective_tools.clone(),
            limits: state.limits,
            limit_hit: state.limit_hit.clone(),
        }
    }
}

#[cfg(test)]
#[path = "summary.test.rs"]
mod tests;
