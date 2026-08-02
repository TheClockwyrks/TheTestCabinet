//! The **context projection**: the part of a session's telemetry that a reconstruction must
//! reproduce exactly.
//!
//! Telemetry is the *product* of a playback, so the round trip that proves the machinery works
//! compares a reconstruction's stream against the stream of the session it was driven from. What it
//! must **not** compare is the whole stream byte for byte: a prompt event carries a real model-call
//! duration and every turn timing is wall clock, and a reconstruction that takes seconds where the
//! run took thirty-eight minutes legitimately reports different numbers. A comparison that included
//! them would fail on every run and would have to be relaxed by hand until it proved nothing.
//!
//! So the comparison is a **named projection**, and naming it is the point — a reader can see
//! exactly what fidelity is being claimed:
//!
//! | In | Out |
//! | --- | --- |
//! | every [context message](GgTelemetryKind::ContextMessage): id, role, content, tool calls, images, token estimate | — |
//! | every [prompt](GgTelemetryKind::Prompt)'s ordered request, token totals, finish reason, cost | its `duration_ms` |
//! | the terminal [session summary](GgSessionSummary) | every [turn timing](GgTelemetryKind::TurnTiming) event, entirely |
//!
//! Wall clock is the only exclusion, and it is total: nothing derived from a clock survives the
//! projection, so an equality assertion over it is a real assertion rather than a tolerance.
//!
//! Everything else that would differ between two runs of the same session — a message's content
//! address, the order of the request, the finish reason, the token counts, the cost, the terminal
//! status, the per-slot rollups — is *in*, and is what makes the equality meaningful.

use test_cabinet_core::gg::{
    GgLoggedImage, GgLoggedToolCall, GgPromptRef, GgSessionSummary, GgTelemetryEvent,
    GgTelemetryKind,
};
use test_cabinet_core::metrics::{Cost, TokenCounts};

/// One session's telemetry, reduced to what a faithful reconstruction must reproduce exactly.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ContextProjection {
    /// Every pooled context message the session streamed, in emission order.
    pub messages: Vec<ProjectedMessage>,
    /// Every turn's request→response record, in emission order, minus its wall clock.
    pub prompts: Vec<ProjectedPrompt>,
    /// The terminal session summary, when the session reached one.
    pub summary: Option<GgSessionSummary>,
}

/// One [context message](GgTelemetryKind::ContextMessage), with the agent whose window it sat in.
#[derive(Debug, Clone, PartialEq)]
pub struct ProjectedMessage {
    /// The agent whose stream carried it.
    pub agent_id: Option<String>,
    /// Its content address.
    pub id: String,
    /// Its role.
    pub role: String,
    /// Its text, when it has any.
    pub content: Option<String>,
    /// The tool calls an assistant message requested.
    pub tool_calls: Vec<GgLoggedToolCall>,
    /// The assistant call a `tool` message answers.
    pub tool_call_id: Option<String>,
    /// Descriptors of any attached images.
    pub images: Vec<GgLoggedImage>,
    /// Its estimated share of the window.
    pub tokens: u64,
    /// Its selector tag, when it carries one.
    pub label: Option<String>,
}

/// One turn's [prompt](GgTelemetryKind::Prompt) record, **without** its `duration_ms`.
#[derive(Debug, Clone, PartialEq)]
pub struct ProjectedPrompt {
    /// The agent whose turn it was.
    pub agent_id: Option<String>,
    /// The ordered request, as pointers into the message pool.
    pub request: Vec<GgPromptRef>,
    /// The estimated total tokens across the request.
    pub total_tokens: u64,
    /// The pooled id of the assistant reply it produced.
    pub response_id: Option<String>,
    /// Why the model's turn stopped.
    pub finish_reason: String,
    /// The turn's provider-reported usage.
    pub tokens: TokenCounts,
    /// The turn's cost, when the provider reported one.
    pub cost: Option<Cost>,
}

impl ContextProjection {
    /// Project a session's emitted [events](GgTelemetryEvent).
    ///
    /// Everything not named in the [module docs](self) is dropped, including — deliberately —
    /// every event a reconstruction is free to differ on: the turn markers, the tool call/result
    /// feed, the operator log (a playback adds lines of its own, which is correct and would
    /// otherwise fail the comparison), the agent-tree transitions and the incremental usage
    /// deltas, which the prompts and the summary already carry in full.
    pub fn project(events: &[GgTelemetryEvent]) -> Self {
        let mut projection = Self::default();
        for event in events {
            match &event.kind {
                GgTelemetryKind::ContextMessage {
                    id,
                    role,
                    content,
                    tool_calls,
                    tool_call_id,
                    images,
                    tokens,
                    label,
                } => projection.messages.push(ProjectedMessage {
                    agent_id: event.agent_id.clone(),
                    id: id.clone(),
                    role: role.clone(),
                    content: content.clone(),
                    tool_calls: tool_calls.clone(),
                    tool_call_id: tool_call_id.clone(),
                    images: images.clone(),
                    tokens: *tokens,
                    label: label.clone(),
                }),
                GgTelemetryKind::Prompt {
                    request,
                    total_tokens,
                    response_id,
                    finish_reason,
                    tokens,
                    cost,
                    // The one wall-clock figure on this event, and the reason the projection
                    // exists: a reconstruction's model call takes microseconds.
                    duration_ms: _,
                } => projection.prompts.push(ProjectedPrompt {
                    agent_id: event.agent_id.clone(),
                    request: request.clone(),
                    total_tokens: *total_tokens,
                    response_id: response_id.clone(),
                    finish_reason: finish_reason.clone(),
                    tokens: *tokens,
                    cost: *cost,
                }),
                GgTelemetryKind::SessionSummary { summary } => {
                    projection.summary = Some((**summary).clone())
                }
                _ => {}
            }
        }
        projection
    }
}

#[cfg(test)]
#[path = "projection.test.rs"]
mod tests;
