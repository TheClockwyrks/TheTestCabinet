//! The gg **compaction** capability: the automatic summarize-and-restart that lets one
//! logical session continue *past* the active model's context window.
//!
//! When a thread nears the window, [compaction](https://docs.testcabinet.ai/gg/compaction/)
//! **summarizes the ephemeral history and restarts the thread from the summary**, so the
//! model keeps working without an [orchestrator](https://docs.testcabinet.ai/orchestrators/overview/)
//! looping it. It is the capability that makes "retained across compaction" mean something:
//! it summarizes only the *history* and carries the pinned state — read
//! [skills](crate::skills), in-play [memories](crate::memories), and the
//! [task list](crate::tasks) — across the boundary **verbatim**.
//!
//! # The pieces
//!
//! - **The trigger.** At a **turn boundary** (never mid tool-call/results), when window
//!   [fullness](crate::context::ContextModel::fullness) reaches the
//!   [`trigger_fullness`](CompactionPolicy::trigger_fullness) threshold — a capability
//!   param, not a constant, since [multi-model](https://docs.testcabinet.ai/gg/multi-model/)
//!   agents will have different windows — and there is ephemeral history to reclaim,
//!   [`compact_if_needed`] fires.
//! - **The rewrite.** The pinned prefix is kept verbatim and the ephemeral history is
//!   replaced by a single summary item via
//!   [`ContextModel::compact_history`](crate::context::ContextModel::compact_history). The
//!   post-compaction window is *pinned prefix + summary*, and the run continues from there.
//! - **The reserve.** Summarizing is itself a model call over the whole thread, so enabling
//!   compaction **shrinks the window the agent is given** by
//!   [`summary_headroom`](CompactionPolicy::summary_headroom) (20% by default) via
//!   [`working_window`]. The held-back slice is the room the summarization call needs to
//!   read the transcript and emit its summary; without it a run can trip the trigger at a
//!   point where the compaction that was meant to save it cannot fit.
//! - **The summarizer.** Summarization is a **swappable strategy** behind the
//!   [`Summarizer`] trait, selected by the capability's
//!   [`implementation`](test_cabinet_core::gg::GgCapabilityConfig::implementation). The
//!   default [`ModelSummarizer`] reuses the run's primary [`ModelClient`] with a focused
//!   summarization prompt; a different prompt/structure is a drop-in.
//!
//! # Offline testability
//!
//! The default summarizer's model call is answered offline by the scripted
//! [`MockClient`](crate::client::MockClient): the summarization prompt embeds
//! [`SUMMARIZATION_MARKER`], which the mock recognizes and answers with a deterministic
//! canned summary **without advancing its scripted turn cursor**, so a mock run can cross a
//! real compaction boundary with no network and no desync.

use async_trait::async_trait;
use serde_json::Value;
use test_cabinet_core::gg::{
    CAPABILITY_COMPACTION, GgCapabilitySet, GgContextSource, GgRetainedState, GgTelemetryKind,
};

use crate::context::ContextModel;
use crate::model::{Message, ModelClient, Role};

/// The compaction capability param naming the fullness threshold that triggers a
/// compaction — a `0.0..=1.0` fraction of the active model's window.
const PARAM_TRIGGER_FULLNESS: &str = "triggerFullness";

/// The default [`trigger_fullness`](CompactionPolicy::trigger_fullness): compact once the
/// window is ~85% full, leaving headroom for the turn that trips it plus the summary call.
const DEFAULT_TRIGGER_FULLNESS: f64 = 0.85;

/// The compaction capability param naming the
/// [summary headroom](CompactionPolicy::summary_headroom) — a `0.0..=0.9` fraction of the
/// model's window held back from the agent so the summarization call fits.
const PARAM_SUMMARY_HEADROOM: &str = "summaryHeadroom";

/// The default [`summary_headroom`](CompactionPolicy::summary_headroom): reserve 20% of the
/// model's window for the summarization round-trip.
const DEFAULT_SUMMARY_HEADROOM: f64 = 0.2;

/// The largest accepted [`summary_headroom`](CompactionPolicy::summary_headroom). Reserving
/// more than 90% of the window would leave the agent no room to work at all, so a larger
/// value is treated as a misconfiguration and ignored.
const MAX_SUMMARY_HEADROOM: f64 = 0.9;

/// A sentinel embedded in the [summarization prompt](SUMMARY_SYSTEM_PROMPT) so the offline
/// [`MockClient`](crate::client::MockClient) can recognize a compaction summary request and
/// answer it deterministically — without consuming a scripted turn — keeping a mock run's
/// main script in step across a compaction boundary.
pub const SUMMARIZATION_MARKER: &str = "<<gg-compaction-summary-request>>";

/// The system prompt the default [`ModelSummarizer`] steers the summarization call with.
/// It carries the [`SUMMARIZATION_MARKER`] so an offline mock can detect the request.
const SUMMARY_SYSTEM_PROMPT: &str = "You are gg's context-compaction summarizer \
    <<gg-compaction-summary-request>>. You are given the earlier portion of a coding \
    agent's thread that is about to be dropped to reclaim context. Write a compact summary \
    that preserves enough working state for the agent to continue seamlessly: what it is \
    building, the key decisions and discoveries so far, files created or changed, what is \
    currently in progress, and the immediate next step. Do not restate the agent's skills, \
    memories, or task list — those are retained separately. Be concise and factual; output \
    only the summary.";

/// The heading prepended to the summary item placed in the compacted window, so the model
/// reads it as a recap of dropped history rather than fresh instruction.
const SUMMARY_PREFACE: &str = "# Summary of earlier work (context was compacted)\n\n\
    The detailed thread up to this point was summarized to reclaim context. Your skills, \
    memories, and task list above are unchanged. Continue from here.\n\n";

/// The summary used when the summarization model call fails. Compaction must never abort
/// the run it serves, so a failed summary degrades to this note (the pinned state — the
/// substance the agent needs — is retained regardless) rather than propagating the error.
const FALLBACK_SUMMARY: &str = "(The earlier thread could not be summarized automatically. \
    Your skills, memories, and task list are retained above; re-inspect the workspace as \
    needed to recover any detail you require.)";

/// The inputs to one [`Summarizer::summarize`] call: the history to condense and the
/// [client](ModelClient) a model-backed summarizer may call. A summarizer that does not use
/// a model simply ignores [`client`](Self::client).
pub struct SummaryRequest<'a> {
    /// The messages to summarize — the build prompt (for grounding) followed by the
    /// ephemeral thread about to be dropped, in order.
    pub history: &'a [Message],
    /// The run's primary model client, for a model-backed summarizer to call.
    pub client: &'a dyn ModelClient,
}

/// A **swappable** summarization strategy for [compaction](https://docs.testcabinet.ai/gg/compaction/).
///
/// The default is [`ModelSummarizer`] (a focused model call); the trait keeps it a
/// drop-in so a study can compare strategies — a different prompt, a structured extract, a
/// cheaper model — by [selecting an implementation](resolve_summarizer) without touching the
/// loop. `Send + Sync` so a boxed summarizer can back the async loop.
#[async_trait]
pub trait Summarizer: Send + Sync {
    /// Summarize `request.history` into working-state text the agent can continue from.
    /// Implementations must not fail the run: on trouble they return a best-effort string
    /// (see [`FALLBACK_SUMMARY`]) rather than an error.
    async fn summarize(&self, request: SummaryRequest<'_>) -> String;
}

/// The default [`Summarizer`]: one focused call to the run's primary [`ModelClient`] with a
/// summarization system prompt. Offline it is answered by the scripted mock (see the module
/// docs). A model or transport error degrades to [`FALLBACK_SUMMARY`] so compaction never
/// aborts the run.
#[derive(Debug, Default, Clone, Copy)]
pub struct ModelSummarizer;

#[async_trait]
impl Summarizer for ModelSummarizer {
    async fn summarize(&self, request: SummaryRequest<'_>) -> String {
        let messages = vec![
            Message::system(SUMMARY_SYSTEM_PROMPT),
            Message::user(render_history(request.history)),
        ];
        // No tools are offered for the summary turn; the summarizer wants prose, not a
        // tool call. Usage from this call is intentionally not folded into the run totals
        // in P2a (a clean seam for later per-role accounting).
        match request.client.complete(&messages, &[]).await {
            Ok(response) => response
                .text
                .map(|text| text.trim().to_string())
                .filter(|text| !text.is_empty())
                .unwrap_or_else(|| FALLBACK_SUMMARY.to_string()),
            Err(_) => FALLBACK_SUMMARY.to_string(),
        }
    }
}

/// Render a slice of [`Message`]s into a single plain-text transcript for the summarizer,
/// one labeled block per message. Tool calls are rendered by name and arguments so the
/// summary can reflect what the agent did.
fn render_history(history: &[Message]) -> String {
    let mut out = String::from("Earlier thread to summarize:\n");
    for message in history {
        let role = match message.role {
            Role::System => "system",
            Role::User => "user",
            Role::Assistant => "assistant",
            Role::Tool => "tool",
        };
        out.push_str("\n[");
        out.push_str(role);
        out.push(']');
        if let Some(content) = &message.content {
            out.push(' ');
            out.push_str(content);
        }
        for call in &message.tool_calls {
            out.push_str(&format!("\n  → called `{}`({})", call.name, call.arguments));
        }
        out.push('\n');
    }
    out
}

/// Select the [`Summarizer`] for a compaction capability's
/// [`implementation`](test_cabinet_core::gg::GgCapabilityConfig::implementation). `None`
/// (or an unrecognized name) selects the default [`ModelSummarizer`]; the match is the
/// drop-in seam for alternate strategies.
pub fn resolve_summarizer(implementation: Option<&str>) -> Box<dyn Summarizer> {
    match implementation {
        // The only strategy in P2a; future strategies add arms here.
        Some("model") | Some("default") | None => Box::new(ModelSummarizer),
        // An unrecognized implementation falls back to the default rather than failing to
        // launch — a study naming a not-yet-built strategy still runs.
        Some(_) => Box::new(ModelSummarizer),
    }
}

/// The tuning of the compaction trigger, resolved from the capability's params.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CompactionPolicy {
    /// The window-fullness fraction at (or above) which a compaction fires.
    pub trigger_fullness: f64,
    /// The fraction of the model's window **withheld from the agent** so that a compaction
    /// can actually be performed — see [`working_window`](Self::working_window).
    pub summary_headroom: f64,
}

impl Default for CompactionPolicy {
    fn default() -> Self {
        Self {
            trigger_fullness: DEFAULT_TRIGGER_FULLNESS,
            summary_headroom: DEFAULT_SUMMARY_HEADROOM,
        }
    }
}

impl CompactionPolicy {
    /// Resolve the policy from a compaction-capability `params` object: `triggerFullness`
    /// overrides its default when present as a number in `(0.0, 1.0]` and `summaryHeadroom`
    /// when present as a number in `[0.0, 0.9]`; anything else keeps the default (a
    /// negative or absurd value would compact every turn, never, or leave the agent no
    /// window at all, so it is ignored).
    pub fn resolve(params: &Value) -> Self {
        let trigger_fullness = params
            .get(PARAM_TRIGGER_FULLNESS)
            .and_then(Value::as_f64)
            .filter(|&f| f > 0.0 && f <= 1.0)
            .unwrap_or(DEFAULT_TRIGGER_FULLNESS);
        let summary_headroom = params
            .get(PARAM_SUMMARY_HEADROOM)
            .and_then(Value::as_f64)
            .filter(|&f| (0.0..=MAX_SUMMARY_HEADROOM).contains(&f))
            .unwrap_or(DEFAULT_SUMMARY_HEADROOM);
        Self {
            trigger_fullness,
            summary_headroom,
        }
    }

    /// The portion of a `window`-token context window the agent may actually fill, given
    /// this policy's [`summary_headroom`](Self::summary_headroom).
    ///
    /// Summarization is itself a model call over (nearly) the whole thread: at the trigger
    /// the summarizer must fit the transcript **and** emit a summary within the same window.
    /// Measuring fullness against the model's full window therefore lets a run trip the
    /// trigger at a point where the summary call cannot fit — the compaction that was meant
    /// to save the run overflows instead. Holding a fraction back makes the reserve
    /// explicit: the agent works against the reduced window, and what is left over is the
    /// space the summarization round-trip runs in.
    ///
    /// Never returns zero (a degenerate window would make every fullness ratio infinite),
    /// and never exceeds `window`.
    pub fn working_window(&self, window: u64) -> u64 {
        let usable = (window as f64 * (1.0 - self.summary_headroom)).floor();
        (usable.max(1.0) as u64).min(window)
    }
}

/// The window an agent configured with `set` may actually fill, out of a model window of
/// `window` tokens: [reduced by the summary headroom](CompactionPolicy::working_window) when
/// [compaction](CAPABILITY_COMPACTION) is on, and `window` unchanged when it is off (nothing
/// needs to be reserved for a summarization call that will never happen).
pub fn working_window(set: &GgCapabilitySet, window: u64) -> u64 {
    if !set.is_enabled(CAPABILITY_COMPACTION) {
        return window;
    }
    set.capability(CAPABILITY_COMPACTION)
        .map(|cap| CompactionPolicy::resolve(&cap.params))
        .unwrap_or_default()
        .working_window(window)
}

/// The compaction configuration threaded into the [turn loop](crate::agent): whether the
/// capability is on, its [policy](CompactionPolicy), and the selected [summarizer](Summarizer).
pub struct CompactionSetup {
    /// Whether the compaction capability is enabled for this run. When `false` the loop
    /// never compacts (an ablation's off arm).
    pub enabled: bool,
    /// The resolved trigger policy.
    pub policy: CompactionPolicy,
    /// The selected summarization strategy.
    pub summarizer: Box<dyn Summarizer>,
}

impl CompactionSetup {
    /// Resolve the compaction setup from a run's capability set: enabled when the
    /// [compaction](CAPABILITY_COMPACTION) capability is present and on, with its policy and
    /// summarizer read from its config. A disabled/absent capability yields a setup whose
    /// [`enabled`](Self::enabled) is `false` (and a default policy/summarizer that is never
    /// used).
    pub fn resolve(set: &GgCapabilitySet) -> Self {
        let capability = set.capability(CAPABILITY_COMPACTION);
        let enabled = set.is_enabled(CAPABILITY_COMPACTION);
        let policy = capability
            .map(|cap| CompactionPolicy::resolve(&cap.params))
            .unwrap_or_default();
        let summarizer =
            resolve_summarizer(capability.and_then(|cap| cap.implementation.as_deref()));
        Self {
            enabled,
            policy,
            summarizer,
        }
    }
}

/// The pinned-state counts carried into a compaction so they can be reported as the
/// [retention proof](GgRetainedState) — how many read skills, tasks, in-play memories, and
/// board issues survive the boundary. Supplied by the loop, which owns the runtimes.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RetainedCounts {
    /// Read skills whose bodies are retained.
    pub skills: u64,
    /// Tasks in the retained task list.
    pub tasks: u64,
    /// In-play memories retained.
    pub memories: u64,
    /// Issues on the retained epic/issue board.
    pub issues: u64,
}

/// Compact the context at a turn boundary **if** compaction is enabled, window fullness has
/// reached the trigger threshold, and there is ephemeral history to reclaim. Returns the
/// [`Compaction`](GgTelemetryKind::Compaction) telemetry to emit at the boundary, or `None`
/// when no compaction was performed.
///
/// On a fire it summarizes the [ephemeral history plus the build prompt](ContextModel::summary_source_messages)
/// with `setup.summarizer`, then rewrites the window via
/// [`ContextModel::compact_history`] — keeping the pinned prefix verbatim and replacing the
/// history with the summary. The returned event carries the before/after token totals (the
/// reclaim), the summary's token cost, and the [`retained`](RetainedCounts) counts.
pub async fn compact_if_needed(
    context: &mut ContextModel,
    client: &dyn ModelClient,
    setup: &CompactionSetup,
    retained: RetainedCounts,
) -> Option<GgTelemetryKind> {
    if !setup.enabled {
        return None;
    }
    // No window limit means no fullness denominator; without it the trigger cannot be
    // evaluated, so there is nothing to do (window_limit is normally always resolved).
    let fullness = context.fullness()?;
    if fullness < setup.policy.trigger_fullness {
        return None;
    }
    // Compacting with no ephemeral items would reclaim nothing and could loop; only fire
    // when there is history to summarize.
    if !context.has_ephemeral() {
        return None;
    }

    let before_tokens = context.total_tokens();
    let input = context.summary_source_messages();
    let summary_text = setup
        .summarizer
        .summarize(SummaryRequest {
            history: &input,
            client,
        })
        .await;

    let summary_message = Message::user(format!("{SUMMARY_PREFACE}{summary_text}"));
    context.compact_history(summary_message);

    let after_tokens = context.total_tokens();
    let summary_tokens = context.tokens_for(GgContextSource::History);

    Some(GgTelemetryKind::Compaction {
        trigger_fullness: setup.policy.trigger_fullness,
        before_tokens,
        after_tokens,
        summary_tokens,
        retained: GgRetainedState {
            skills: retained.skills,
            tasks: retained.tasks,
            memories: retained.memories,
            issues: retained.issues,
        },
    })
}

#[cfg(test)]
#[path = "compaction.test.rs"]
mod tests;
