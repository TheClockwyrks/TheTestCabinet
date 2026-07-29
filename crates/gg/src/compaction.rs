//! The gg **compaction** capability: the automatic summarize-and-restart that lets one
//! logical session continue *past* the active model's context window.
//!
//! When a thread nears the window, [compaction](https://docs.testcabinet.ai/gg/compaction/)
//! **summarizes the ephemeral history and restarts the thread from the summary**, so the
//! model keeps working without an [orchestrator](https://docs.testcabinet.ai/orchestrators/overview/)
//! looping it. It is the capability that makes "retained across compaction" mean something:
//! it summarizes only the *history* and carries the pinned state — read
//! [skills](crate::skills), in-play [memories](crate::memories), the
//! [task list](crate::tasks), and any **locked** [autoloaded specification](crate::agent) —
//! across the boundary **verbatim**.
//!
//! # The pieces
//!
//! - **The trigger.** At a **turn boundary** (never mid tool-call/results), when window
//!   [fullness](crate::context::ContextModel::fullness) reaches the
//!   [`trigger_fullness`](CompactionPolicy::trigger_fullness) threshold — **defined as
//!   `1 - summary_headroom`**, the point at which the working window is full and only the
//!   reserved headroom remains, not a separately configured value — and there is ephemeral
//!   history to reclaim, [`should_compact`] is true.
//! - **The rewrite.** The pinned prefix is kept verbatim and the ephemeral history is
//!   replaced by a single summary item (plus, for the two `compact`-tool strategies, a fresh
//!   [file view](RestoredFile) per path the model asked to keep) via [`apply_compaction`].
//!   The post-compaction window is *pinned prefix + restored files + summary*, and the run
//!   continues from there.
//! - **The reserve.** Condensing the thread costs a model call over the whole thread, so
//!   enabling compaction **shrinks the window the agent is given** by
//!   [`summary_headroom`](CompactionPolicy::summary_headroom) (20% by default) via
//!   [`working_window`]. The held-back slice is the room that call needs to read the
//!   transcript and emit its summary; without it a run can trip the trigger at a point where
//!   the compaction that was meant to save it cannot fit.
//! - **The strategy.** *Who* condenses the thread, and *what* the restarted context is rebuilt
//!   from, is the capability's one experimental variable — see [`CompactionStrategy`].
//!
//! # Two shapes of strategy
//!
//! The five strategies divide into two implementation shapes, and the division is what the rest
//! of this module is organized around:
//!
//! - **Out-of-band** (the two `handoff-*` ones) are performed *between* the agent's turns, by a
//!   call to a separate model the agent never sees. They are a single `async fn`
//!   ([`condense_out_of_band`]) the loop awaits at the turn boundary, and the agent's next turn
//!   simply finds a smaller window.
//! - **In-loop** ([`SelfSummarization`](CompactionStrategy::SelfSummarization),
//!   [`SelfCompaction`](CompactionStrategy::SelfCompaction),
//!   [`Memory`](CompactionStrategy::Memory)) are performed *by the agent itself*, so they cannot
//!   be a function call: gg appends an instruction ([`PendingCompaction::instruction`]), the
//!   agent's **next turn** supplies the summary (or the `compact` call, or the memory writes),
//!   and the loop applies the rewrite when it does. That is why [`PendingCompaction`] is loop
//!   state rather than a local: a compaction spans a turn boundary, and until it is satisfied
//!   the loop refuses everything else the model tries to do.
//!
//! # Offline testability
//!
//! Every out-of-band strategy's model call is answered offline by the scripted
//! [`MockClient`](crate::client::MockClient): its system prompt ends in
//! [`SUMMARIZATION_MARKER`] (or, for the one that must answer with a tool call,
//! [`COMPACT_CALL_MARKER`]), which the mock recognizes and answers deterministically **without
//! advancing its scripted turn cursor**, so a mock run can cross a real compaction boundary
//! with no network and no desync.

use std::sync::OnceLock;

use async_trait::async_trait;
use serde_json::Value;
use test_cabinet_core::gg::{
    CAPABILITY_COMPACTION, CAPABILITY_MEMORIES, COMPACTION_PARAM_MODEL,
    COMPACTION_STRATEGY_HANDOFF_COMPACTION, COMPACTION_STRATEGY_HANDOFF_SUMMARIZATION,
    COMPACTION_STRATEGY_MEMORY, COMPACTION_STRATEGY_SELF_COMPACTION,
    COMPACTION_STRATEGY_SELF_SUMMARIZATION, GgAgentConfig, GgCapabilitySet, GgContextSource,
    GgRetainedState, GgTelemetryKind,
};

use crate::context::{ContextModel, Retention, code_heading};
use crate::memories::MemoryCalls;
use crate::model::{ImageContent, Message, ModelClient, Role};
use crate::prompts::{self, CompactionPromptContext};
use crate::tools::{COMPACT_TOOL, CompactTool, Tool, parse_compact_request};

/// The API object a program reaches the [`compact`](COMPACT_TOOL) function through, and the name it
/// is bound under there. Both are the sandbox's own catalogue values; they are named here so the
/// compaction prompts spell the call exactly as the guest binds it.
const COMPACT_OBJECT: &str = "context";
/// See [`COMPACT_OBJECT`].
const COMPACT_FUNCTION: &str = "compact";

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

/// The line the [summarization prompt](handoff_summary_system_prompt) closes with, by which the
/// offline [`MockClient`](crate::client::MockClient) recognizes a compaction summary request and
/// answers it deterministically — without consuming a scripted turn — keeping a mock run's
/// main script in step across a compaction boundary.
///
/// It is a phrase of the prompt rather than a sentinel spliced into it: the prompt is product
/// text a real model reads, and a marker only a test needs has no business being in it. The one
/// requirement is that it be the half the two handoff prompts do **not** share, since they open
/// identically and differ only in what the answer is.
pub const SUMMARIZATION_MARKER: &str = "Reply with the summary of the session.";

/// The line [`handoff_compact_system_prompt`] closes with, by which the offline mock recognizes the
/// one compaction request that must be answered with a **tool call** rather than prose and replies
/// with a canned [`compact`](COMPACT_TOOL) call — again without consuming a scripted turn. Carries
/// no tool name, so it matches whatever the run calls its compact tool.
pub const COMPACT_CALL_MARKER: &str = "tool to complete the compaction process.";

/// The system prompt the [handoff summarization](CompactionStrategy::HandoffSummarization)
/// strategy gives the **separate** compaction model, from
/// [`compaction-handoff-summary.hbs`](crate::prompts). It carries the [`SUMMARIZATION_MARKER`] so
/// an offline mock can detect the request.
///
/// The one thing it does that an ordinary summarization prompt would not: it tells the reader that
/// the transcript is a *session it is compacting*, not its own work. The thread it is about to read
/// is another model's, converted to labelled user messages ([`handoff_messages`]) precisely so it
/// cannot mistake the working model's assistant turns for its own — and a model that believes it
/// wrote the thread summarizes what it "did" rather than what the agent did.
fn handoff_summary_system_prompt() -> &'static str {
    static PROMPT: OnceLock<String> = OnceLock::new();
    PROMPT.get_or_init(prompts::render_compaction_handoff_summary)
}

/// The system prompt the [handoff compaction](CompactionStrategy::HandoffCompaction) strategy
/// gives the separate compaction model, from
/// [`compaction-handoff-compact.hbs`](crate::prompts) — the same framing as
/// [`handoff_summary_system_prompt`], but the answer is a [`compact`](COMPACT_TOOL) **call**
/// rather than prose, so the compaction model also chooses which files are re-read into the
/// restarted context. It carries [`COMPACT_CALL_MARKER`] rather than [`SUMMARIZATION_MARKER`]
/// because the offline mock has to answer it with a tool call.
fn handoff_compact_system_prompt() -> &'static str {
    static PROMPT: OnceLock<String> = OnceLock::new();
    PROMPT.get_or_init(|| prompts::render_compaction_handoff_compact(COMPACT_TOOL))
}

/// The summary used when the summarization model call fails, from
/// [`compaction-fallback.hbs`](crate::prompts). Compaction must never abort the run it serves, so a
/// failed summary degrades to this note (the pinned state — the substance the agent needs — is
/// retained regardless) rather than propagating the error.
fn fallback_summary() -> &'static str {
    static SUMMARY: OnceLock<String> = OnceLock::new();
    SUMMARY.get_or_init(prompts::render_compaction_fallback)
}

/// The "summary" a [memory compaction](CompactionStrategy::Memory) restarts the thread from, from
/// [`compaction-memory-summary.hbs`](crate::prompts).
///
/// That strategy deliberately produces **no prose recap**: its whole hypothesis is that the
/// agent's own [memories](crate::memories) — which are pinned, and so cross the boundary
/// verbatim — are a better carrier of working state than a summary written once and never
/// revised. So the thread is restarted from a note that says exactly that, and points at the
/// memory block above it.
fn memory_compaction_summary() -> &'static str {
    static SUMMARY: OnceLock<String> = OnceLock::new();
    SUMMARY.get_or_init(prompts::render_compaction_memory_summary)
}

// ---------------------------------------------------------------------------
// The strategies
// ---------------------------------------------------------------------------

/// **Who** condenses a thread at a compaction boundary, and **what** the restarted context is
/// rebuilt from — the compaction capability's one experimental variable, selected by its
/// [`implementation`](test_cabinet_core::gg::GgCapabilityConfig::implementation).
///
/// The five differ along two axes. *Who*: the working agent itself in its own thread, or a
/// separate handoff model out of band. *What*: free prose, a [`compact`](COMPACT_TOOL) call that
/// also names the files to re-read, or [memories](CAPABILITY_MEMORIES) instead of a summary at all.
///
/// A run naming a strategy gg does not recognize resolves to
/// [`SelfSummarization`](Self::SelfSummarization) rather than failing to launch, so a sweep can
/// reference a not-yet-built one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompactionStrategy {
    /// The agent writes its own summary, in its own thread, when gg asks it to. The default.
    SelfSummarization,
    /// The agent calls [`compact`](COMPACT_TOOL) with a summary **and** the files to re-read.
    SelfCompaction,
    /// A separate model writes the summary, reading the thread as labelled user messages.
    HandoffSummarization,
    /// A separate model answers with a [`compact`](COMPACT_TOOL) call — summary plus files.
    HandoffCompaction,
    /// The agent writes its working state to [memories](CAPABILITY_MEMORIES), which are pinned
    /// and so cross the boundary verbatim; there is no prose summary.
    Memory,
}

impl CompactionStrategy {
    /// The strategy an [implementation](test_cabinet_core::gg::GgCapabilityConfig::implementation)
    /// string names.
    ///
    /// [`SelfSummarization`](Self::SelfSummarization) covers `self-summarization`/empty/`None`
    /// **and** any unrecognized name, so a study naming a not-yet-built strategy still launches.
    /// `memories_enabled` demotes [`Memory`](Self::Memory) to the default when the run has no
    /// memories to write to — the one strategy with a hard prerequisite, and a run that compacted
    /// by writing memories it does not have would simply never satisfy its own gate.
    pub fn resolve(implementation: Option<&str>, memories_enabled: bool) -> Self {
        match implementation.map(str::trim) {
            Some(COMPACTION_STRATEGY_SELF_COMPACTION) => Self::SelfCompaction,
            Some(COMPACTION_STRATEGY_HANDOFF_SUMMARIZATION) => Self::HandoffSummarization,
            Some(COMPACTION_STRATEGY_HANDOFF_COMPACTION) => Self::HandoffCompaction,
            Some(COMPACTION_STRATEGY_MEMORY) if memories_enabled => Self::Memory,
            _ => Self::SelfSummarization,
        }
    }

    /// The canonical id this strategy is configured and **recorded** under — the string on every
    /// [`Compaction`](GgTelemetryKind::Compaction) event, which the console labels boundaries by.
    pub fn id(self) -> &'static str {
        match self {
            Self::SelfSummarization => COMPACTION_STRATEGY_SELF_SUMMARIZATION,
            Self::SelfCompaction => COMPACTION_STRATEGY_SELF_COMPACTION,
            Self::HandoffSummarization => COMPACTION_STRATEGY_HANDOFF_SUMMARIZATION,
            Self::HandoffCompaction => COMPACTION_STRATEGY_HANDOFF_COMPACTION,
            Self::Memory => COMPACTION_STRATEGY_MEMORY,
        }
    }

    /// What this strategy needs the **agent's own next turn** to produce, or `None` for an
    /// out-of-band strategy the agent never sees. The loop holds this as
    /// [pending state](PendingCompaction) from the turn that triggers the compaction until the
    /// turn that satisfies it.
    pub fn pending(self) -> Option<PendingCompaction> {
        match self {
            Self::SelfSummarization => Some(PendingCompaction::Summary),
            Self::SelfCompaction => Some(PendingCompaction::CompactCall),
            Self::Memory => Some(PendingCompaction::MemoryWrites),
            Self::HandoffSummarization | Self::HandoffCompaction => None,
        }
    }

    /// Whether the **working** agent is offered the [`compact`](COMPACT_TOOL) tool this run.
    ///
    /// True for [self-compaction](Self::SelfCompaction), whose whole point it is, and true for
    /// *every* turn of such a run — not only the turn a compaction is pending. That is deliberate:
    /// the offered tool set is part of the prompt a provider caches, so adding a tool at the moment
    /// the window is fullest would invalidate the whole cached prefix at the most expensive point in
    /// the run.
    ///
    /// It is also true for [self-summarization](Self::SelfSummarization) under
    /// [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE), and that is not a
    /// special case so much as the only coherent reading of the strategy there. Self-summarization
    /// asks the agent for a summary; a tool-calling agent answers in prose, but a code agent has no
    /// prose to answer in — every reply it sends is a program. Asking one to stop writing programs
    /// for a turn is asking it to break the single contract the whole protocol rests on, and a
    /// contract that is suspended once is a contract a model has learned is negotiable. So the
    /// summary arrives the way everything else a program says arrives: as a call carrying it.
    ///
    /// [Handoff compaction](Self::HandoffCompaction) uses the same tool but never offers it here —
    /// only its separate compaction model is given it.
    pub fn offers_compact_tool(self, responses_as_code: bool) -> bool {
        match self {
            Self::SelfCompaction => true,
            Self::SelfSummarization => responses_as_code,
            _ => false,
        }
    }

    /// Whether this strategy delegates to a **separate model** — the two `handoff-*` strategies,
    /// the only ones that resolve a second client.
    pub fn is_handoff(self) -> bool {
        matches!(self, Self::HandoffSummarization | Self::HandoffCompaction)
    }
}

/// What an in-loop compaction is waiting for the agent to do, held by the
/// [turn loop](crate::agent) from the turn that triggers the compaction until the turn that
/// satisfies it.
///
/// While it is set the loop is in a **narrowed** mode: the agent may do the one thing compaction
/// asked for and nothing else, because everything else adds to a window that is already full. Each
/// variant therefore carries both the instruction that opens that mode
/// ([`instruction`](Self::instruction)) and the refusal that answers anything else
/// ([`refusal`](Self::refusal)).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PendingCompaction {
    /// [Self-summarization](CompactionStrategy::SelfSummarization): the next reply's text **is**
    /// the summary. gg does not dispatch that turn's tools and does not run its program.
    Summary,
    /// [Self-compaction](CompactionStrategy::SelfCompaction): the agent must call
    /// [`compact`](COMPACT_TOOL); every other call is refused until it does.
    CompactCall,
    /// [Memory compaction](CompactionStrategy::Memory): the agent must write its working state to
    /// [memories](crate::memories). Only memory calls are accepted, and the compaction is applied
    /// once a whole reply's calls have all succeeded.
    MemoryWrites,
}

impl PendingCompaction {
    /// Whether a call named `name` is one this pending compaction accepts.
    ///
    /// The narrowing is total rather than advisory, and it has to be: the window is full, so a call
    /// that is allowed through is a call that makes the problem worse.
    ///
    /// [`Summary`](Self::Summary) admits nothing on the **tool-calling** path, where the summary is
    /// the reply's own text and the loop takes that turn whole without dispatching from it. Under
    /// [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) there is no such
    /// reply — every reply is a program — so the summary arrives as a `compact` call carrying it,
    /// and that call is what this must admit. `code_mode` is therefore a parameter rather than a
    /// property of the requirement: the same pending compaction is satisfied differently in the two
    /// modes because the two modes give a model different ways to say anything at all.
    pub fn admits(self, name: &str, code_mode: bool) -> bool {
        match self {
            Self::Summary => code_mode && name == COMPACT_TOOL,
            Self::CompactCall => name == COMPACT_TOOL,
            Self::MemoryWrites => crate::tools::is_memory_tool(name),
        }
    }

    /// Whether one reply's calls satisfy this pending compaction, given how many it made and how
    /// many failed.
    ///
    /// Only [`MemoryWrites`](Self::MemoryWrites) is decided this way — "one reply whose calls all
    /// succeeded", which is what makes a half-written memory state never the thing a thread is
    /// restarted from. A refused call counts as a failure, so a reply that reached for a forbidden
    /// tool is retried rather than accepted. The other two are satisfied by a *specific* thing
    /// arriving (a summary, a `compact` request), not by a count.
    pub fn satisfied_by_calls(self, calls: u32, failures: u32) -> bool {
        matches!(self, Self::MemoryWrites) && calls > 0 && failures == 0
    }

    /// The message gg appends to the thread to open this compaction — what the model reads at the
    /// top of the turn that must satisfy it, from
    /// [`compaction-instruction.hbs`](crate::prompts) over the
    /// [shared context](Self::prompt_context).
    pub fn instruction(self, code_mode: bool, calls: MemoryCalls) -> String {
        prompts::render_compaction_instruction(&self.prompt_context(None, code_mode, calls))
    }

    /// The refusal that answers a call this pending compaction does not accept — and the message a
    /// reply that made *no* usable call is fed back.
    ///
    /// It names the call that was refused rather than only what is wanted, because a model that is
    /// told "do X" while its Y silently fails reads the failure as gg being broken and retries Y.
    pub fn refusal(self, refused: &str, code_mode: bool, calls: MemoryCalls) -> String {
        prompts::render_compaction_refusal(&self.prompt_context(
            Some(refused.to_string()),
            code_mode,
            calls,
        ))
    }

    /// The feedback for a reply that satisfied nothing at all — no usable call under
    /// [`CompactCall`](Self::CompactCall) / [`MemoryWrites`](Self::MemoryWrites).
    pub fn unsatisfied(self, code_mode: bool, calls: MemoryCalls) -> String {
        prompts::render_compaction_unsatisfied(&self.prompt_context(None, code_mode, calls))
    }

    /// The [rendering context](CompactionPromptContext) this pending compaction's three model-facing
    /// messages share: which requirement is pending, and how this run's model names the calls that
    /// satisfy it.
    ///
    /// `code_mode` is the one thing that changes the wording: under
    /// [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) every reply is a
    /// program and every call is a function on an API object, so the instruction has to name the
    /// call the way that run's model actually makes it. For [`Summary`](Self::Summary) it changes
    /// more than the wording: a code run has no prose reply to summarize *in*, so its summary is
    /// asked for as a `compact` call carrying it — a code agent is never told to stop writing
    /// programs, which is not a thing this protocol can ask for.
    ///
    /// `calls` is how this run's [memory strategy](crate::memories::MemoryStrategy) names its own
    /// calls, so a [`MemoryWrites`](Self::MemoryWrites) instruction asks for the tools the model was
    /// actually offered rather than for the scratchpad's.
    fn prompt_context(
        self,
        refused: Option<String>,
        code_mode: bool,
        calls: MemoryCalls,
    ) -> CompactionPromptContext {
        CompactionPromptContext {
            summary: matches!(self, Self::Summary),
            compact_call: matches!(self, Self::CompactCall),
            memory_writes: matches!(self, Self::MemoryWrites),
            code_mode,
            // Named as the reader writes it: a program calls a method on an API object, a
            // tool-calling model requests a tool.
            compact_tool: if code_mode {
                format!("{COMPACT_OBJECT}.{COMPACT_FUNCTION}")
            } else {
                COMPACT_TOOL.to_string()
            },
            memory_create: calls.create.to_string(),
            memory_revise: calls.revise.to_string(),
            memory_delete: calls.delete.to_string(),
            refused,
        }
    }
}

// ---------------------------------------------------------------------------
// The out-of-band summarizers
// ---------------------------------------------------------------------------

/// The inputs to one [`Summarizer::summarize`] call: the history to condense and the
/// [client](ModelClient) a model-backed summarizer may call. A summarizer that does not use
/// a model simply ignores [`client`](Self::client).
pub struct SummaryRequest<'a> {
    /// The messages to summarize — the thread about to be dropped, rebuilt as the
    /// [handoff transcript](handoff_messages) the compaction model reads.
    pub history: &'a [Message],
    /// The client to summarize with: the resolved **compaction model**, or the agent's own client
    /// when a handoff run named no model (or one that could not be resolved).
    pub client: &'a dyn ModelClient,
}

/// What one out-of-band condensation produced: the summary text, whether it is the
/// [fallback](fallback_summary) note (i.e. the call failed), and the files it asked gg to re-read.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CompactionRequest {
    /// The recap the restarted thread opens from.
    pub summary: String,
    /// The workspace paths whose contents are re-loaded into the restarted context. Empty for
    /// every strategy but the two that use the [`compact`](COMPACT_TOOL) tool.
    pub files: Vec<String>,
}

/// A **swappable** out-of-band condensation strategy for
/// [compaction](https://docs.testcabinet.ai/gg/compaction/).
///
/// Two ship today, one per [handoff](CompactionStrategy::is_handoff) strategy:
/// [`HandoffSummarizer`] (a prose recap from a separate model reading the thread as labelled user
/// messages) and [`HandoffCompactor`] (the same model answering with a [`compact`](COMPACT_TOOL)
/// call, so it names the files to re-read too). The three [in-loop](PendingCompaction) strategies
/// have no summarizer at all — the agent writes their summary in its own thread. The trait keeps
/// the choice a drop-in so a study can compare strategies by
/// [selecting an implementation](CompactionStrategy::resolve) without touching the loop.
/// `Send + Sync` so a boxed summarizer can back the async loop.
#[async_trait]
pub trait Summarizer: Send + Sync {
    /// Condense `request.history` into the working state the agent continues from.
    /// Implementations must not fail the run: on trouble they return a best-effort result
    /// (see [`fallback_summary`]) rather than an error.
    async fn summarize(&self, request: SummaryRequest<'_>) -> CompactionRequest;
}

/// The [`Summarizer`] selected by `handoff-summarization`: one focused call to the **separate**
/// compaction model for a prose recap of the thread being dropped.
///
/// Its prompt is the whole of the strategy: a model handed another agent's thread has to be told,
/// in its system prompt, that none of it is its own work — see [`handoff_summary_system_prompt`].
/// The transcript it reads is built by [`handoff_messages`], which is what makes that claim
/// structurally true rather than merely asserted. Offline it is answered by the scripted mock (see
/// the module docs), and a model or transport error degrades to [`fallback_summary`] so compaction
/// never aborts the run.
#[derive(Debug, Default, Clone, Copy)]
pub struct HandoffSummarizer;

#[async_trait]
impl Summarizer for HandoffSummarizer {
    async fn summarize(&self, request: SummaryRequest<'_>) -> CompactionRequest {
        summarize_with_prompt(
            handoff_summary_system_prompt(),
            render_history(request.history),
            request,
        )
        .await
    }
}

/// The [`Summarizer`] selected by `handoff-compaction`: a **separate** model answering with a
/// [`compact`](COMPACT_TOOL) call, so it chooses both the recap and the files gg re-reads into the
/// restarted context.
///
/// It is the one strategy whose out-of-band call is offered a tool, and it requires the call rather
/// than merely permitting it ([`ModelClient::complete_requiring`]). A reply that carries no usable
/// call is not a failure the run should die of, so it degrades in the honest order: the model's own
/// prose if it wrote any, then [`fallback_summary`].
#[derive(Debug, Default, Clone, Copy)]
pub struct HandoffCompactor;

#[async_trait]
impl Summarizer for HandoffCompactor {
    async fn summarize(&self, request: SummaryRequest<'_>) -> CompactionRequest {
        let messages = vec![
            Message::system(handoff_compact_system_prompt()),
            Message::user(render_history(request.history)),
        ];
        let definition = CompactTool.definition();
        let Ok(response) = request
            .client
            .complete_requiring(&messages, &definition)
            .await
        else {
            return CompactionRequest {
                summary: fallback_summary().to_string(),
                files: Vec::new(),
            };
        };
        // The call is what was asked for; its arguments are parsed by the same parser the tool's
        // own validation uses, so a handoff compaction and a self compaction cannot disagree about
        // what a well-formed `compact` call is.
        let called = response
            .tool_calls
            .iter()
            .find(|call| call.name == COMPACT_TOOL)
            .and_then(|call| parse_compact_request(&call.arguments).ok());
        if let Some(request) = called {
            return request;
        }
        // No usable call. Prose the model wrote anyway is still a summary — better than gg's
        // fixed note — so it is preferred over the fallback, exactly as it would be if the
        // strategy had asked for prose in the first place.
        CompactionRequest {
            summary: response
                .text
                .map(|text| text.trim().to_string())
                .filter(|text| !text.is_empty())
                .unwrap_or_else(|| fallback_summary().to_string()),
            files: Vec::new(),
        }
    }
}

/// The single-model-call summarize behind a prose strategy: one turn steered by `system_prompt`
/// over `transcript`, degrading to [`fallback_summary`] on an empty or errored response so
/// compaction never aborts the run. Kept separate from its one caller as the seam an added prose
/// strategy plugs its own prompt into.
async fn summarize_with_prompt(
    system_prompt: &str,
    transcript: String,
    request: SummaryRequest<'_>,
) -> CompactionRequest {
    let messages = vec![Message::system(system_prompt), Message::user(transcript)];
    // No tools are offered for a prose summary turn; the summarizer wants prose, not a tool call.
    let summary = match request.client.complete(&messages, &[]).await {
        Ok(response) => response
            .text
            .map(|text| text.trim().to_string())
            .filter(|text| !text.is_empty())
            .unwrap_or_else(|| fallback_summary().to_string()),
        Err(_) => fallback_summary().to_string(),
    };
    CompactionRequest {
        summary,
        files: Vec::new(),
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

/// Select the out-of-band [`Summarizer`] for a [strategy](CompactionStrategy). The match is the
/// drop-in seam for alternate strategies.
///
/// `None` for the three [in-loop](PendingCompaction) strategies, which have no summarizer at all —
/// the *agent* writes their summary, in its own thread, and the loop never routes them here.
pub fn resolve_summarizer(strategy: CompactionStrategy) -> Option<Box<dyn Summarizer>> {
    match strategy {
        CompactionStrategy::HandoffSummarization => Some(Box::new(HandoffSummarizer)),
        CompactionStrategy::HandoffCompaction => Some(Box::new(HandoffCompactor)),
        CompactionStrategy::SelfSummarization
        | CompactionStrategy::SelfCompaction
        | CompactionStrategy::Memory => None,
    }
}

// ---------------------------------------------------------------------------
// The handoff transcript
// ---------------------------------------------------------------------------

/// Rebuild an agent's live window as the transcript a **handoff** compaction model reads.
///
/// Four transforms, each of which the handoff strategies' contract depends on:
///
/// 1. **The system prompt goes.** The working agent's system prompt describes a toolset, a
///    completion contract and a set of capabilities that have nothing to do with summarizing; the
///    compaction model gets its own instead (supplied by the caller).
/// 2. **Skills and memories go.** They are retained across the boundary verbatim, so restating
///    them to the summarizer only invites it to summarize state that is not being dropped.
/// 3. **Every message becomes a `user` message.** This is the load-bearing one. Left as `assistant`
///    messages, the working model's turns read to the compaction model as *its own prior output* —
///    and a model summarizing what it believes it just wrote produces a first-person account of
///    work it never did.
/// 4. **Every message gets a `<label>\n----\n` heading** — the same headings
///    [responses-as-code](crate::context::code_heading) uses, so what a message *was* survives the
///    role flattening that step 3 performs. An assistant turn is labelled `Assistant`, which is the
///    label the handoff system prompts name.
///
/// The result is one `user` message per surviving item, in order, with the caller's system prompt
/// prepended by the caller (this returns the body only).
pub fn handoff_messages(context: &ContextModel) -> Vec<Message> {
    context
        .prompt_items()
        .filter(|item| {
            !matches!(
                item.source,
                GgContextSource::System | GgContextSource::Skill | GgContextSource::Memory
            )
        })
        .map(|item| handoff_message(item.source, item.message))
        .collect()
}

/// One item of the live window as the handoff transcript carries it: a `user` message whose body is
/// the original content under its [`handoff_label`] heading, with any tool calls it made spelled
/// out (they are what the agent *did*, and dropping them would leave a summarizer reading a thread
/// of narration with no actions in it).
///
/// A message that already opens with its own heading — every synthesized `user` message in a
/// [code-mode](crate::context::code_heading) run does — is left as it is rather than headed twice.
fn handoff_message(source: GgContextSource, message: &Message) -> Message {
    let label = handoff_label(source, message.role);
    let mut body = message.content.clone().unwrap_or_default();
    for call in &message.tool_calls {
        body.push_str(&format!("\n→ called `{}`({})", call.name, call.arguments));
    }
    let heading = format!("{label}\n----\n");
    if body.starts_with(&heading) {
        return Message::user(body);
    }
    Message::user(format!("{heading}{body}"))
}

/// The heading one window item carries in a [handoff transcript](handoff_messages).
///
/// It is read off the item's [source](GgContextSource) — the same vocabulary
/// [`code_heading`] defines, so a run that already heads its messages is not relabelled — except
/// for an assistant turn, which has no code heading (a program is the model's own output, never
/// gg's synthesis) and is exactly the item the flattening must label. `Assistant` is what the
/// handoff system prompts name it.
fn handoff_label(source: GgContextSource, role: Role) -> &'static str {
    if role == Role::Assistant || source == GgContextSource::Assistant {
        return "Assistant";
    }
    code_heading(source).unwrap_or("Message")
}

// ---------------------------------------------------------------------------
// Policy and setup
// ---------------------------------------------------------------------------

/// The tuning of the compaction trigger, resolved from the capability's params.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CompactionPolicy {
    /// The fraction of the model's window **withheld from the agent** so that a compaction
    /// can actually be performed — see [`working_window`](Self::working_window). This is the
    /// single knob: the fullness [trigger](Self::trigger_fullness) is derived from it, not
    /// configured separately.
    pub summary_headroom: f64,
}

impl Default for CompactionPolicy {
    fn default() -> Self {
        Self {
            summary_headroom: DEFAULT_SUMMARY_HEADROOM,
        }
    }
}

impl CompactionPolicy {
    /// Resolve the policy from a compaction-capability `params` object: `summaryHeadroom`
    /// overrides its default when present as a number in `[0.0, 0.9]`; anything else keeps
    /// the default (a negative or absurd value would leave the agent no window at all, so it
    /// is ignored). The fullness [trigger](Self::trigger_fullness) is not a separate param —
    /// it is defined by the headroom.
    pub fn resolve(params: &Value) -> Self {
        let summary_headroom = params
            .get(PARAM_SUMMARY_HEADROOM)
            .and_then(Value::as_f64)
            .filter(|&f| (0.0..=MAX_SUMMARY_HEADROOM).contains(&f))
            .unwrap_or(DEFAULT_SUMMARY_HEADROOM);
        Self { summary_headroom }
    }

    /// The window-fullness fraction at (or above) which a compaction fires, defined as
    /// `1.0 - summary_headroom`. The agent works against the [working
    /// window](Self::working_window) — the model's window less the headroom — so the trigger
    /// is exactly the point at which that working window is full and the reserved headroom is
    /// all that remains for the summarization round-trip. It is therefore a function of the
    /// headroom, never a separately configured value.
    pub fn trigger_fullness(&self) -> f64 {
        1.0 - self.summary_headroom
    }

    /// The portion of a `window`-token context window the agent may actually fill, given
    /// this policy's [`summary_headroom`](Self::summary_headroom).
    ///
    /// Condensing the thread is itself a model call over (nearly) the whole thread: at the trigger
    /// that call must fit the transcript **and** emit a summary within the same window. Measuring
    /// fullness against the model's full window therefore lets a run trip the trigger at a point
    /// where the summary call cannot fit — the compaction that was meant to save the run overflows
    /// instead. Holding a fraction back makes the reserve explicit: the agent works against the
    /// reduced window, and what is left over is the space the condensation runs in. It is the same
    /// reserve for an in-loop strategy, where the call is one of the agent's own turns.
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
/// capability is on, its [policy](CompactionPolicy), the selected [strategy](CompactionStrategy),
/// the out-of-band [summarizer](Summarizer) it resolves to, and — for a handoff — the separate
/// model's client.
pub struct CompactionSetup {
    /// Whether the compaction capability is enabled for this run. When `false` the loop
    /// never compacts (an ablation's off arm).
    pub enabled: bool,
    /// The resolved trigger policy.
    pub policy: CompactionPolicy,
    /// The selected strategy — recorded on each compaction event so the console can label which
    /// one produced a boundary, and the thing the loop branches on.
    pub strategy: CompactionStrategy,
    /// The out-of-band condensation strategy — `None` for the three in-loop strategies, whose
    /// summary the agent itself writes.
    pub summarizer: Option<Box<dyn Summarizer>>,
    /// The **compaction model's** client, for the two [handoff](CompactionStrategy::is_handoff)
    /// strategies. `None` for every other strategy, and also when a handoff run could not resolve
    /// the model it named — in which case the loop condenses on the agent's own client rather than
    /// giving up the compaction, and says so.
    pub handoff_client: Option<Box<dyn ModelClient>>,
}

impl CompactionSetup {
    /// Resolve the compaction setup from an agent's profile: enabled when the
    /// [compaction](CAPABILITY_COMPACTION) capability is present and on, with its policy and
    /// strategy read from its config. A disabled/absent capability yields a setup whose
    /// [`enabled`](Self::enabled) is `false` (and a default policy/strategy that is never used).
    ///
    /// The [handoff client](Self::handoff_client) is **not** resolved here — building a model
    /// client needs the run's client factory, which this pure resolution does not have. The loop's
    /// launch path fills it in ([`handoff_model_id`]).
    pub fn resolve(set: &GgAgentConfig) -> Self {
        let capability = set.capability(CAPABILITY_COMPACTION);
        let enabled = set.is_enabled(CAPABILITY_COMPACTION);
        let policy = capability
            .map(|cap| CompactionPolicy::resolve(&cap.params))
            .unwrap_or_default();
        let strategy = CompactionStrategy::resolve(
            capability.and_then(|cap| cap.implementation.as_deref()),
            set.is_enabled(CAPABILITY_MEMORIES),
        );
        Self {
            enabled,
            policy,
            strategy,
            summarizer: resolve_summarizer(strategy),
            handoff_client: None,
        }
    }

    /// The client an out-of-band condensation runs on: the resolved
    /// [compaction model](Self::handoff_client) for a handoff, else the agent's own `client`.
    ///
    /// The fallback is deliberate. A handoff run whose named model could not be resolved has a
    /// misconfiguration, not a reason to stop compacting — and a run that stopped compacting would
    /// overflow its window a few turns later, which is a far worse failure than a summary written
    /// by the wrong model. The launch path says so in a `warn` when it happens.
    pub fn client<'a>(&'a self, client: &'a dyn ModelClient) -> &'a dyn ModelClient {
        match &self.handoff_client {
            Some(handoff) => handoff.as_ref(),
            None => client,
        }
    }
}

/// The model id a [handoff](CompactionStrategy::is_handoff) run condenses with — its capability's
/// [`model`](COMPACTION_PARAM_MODEL) param — or `None` when the strategy is not a handoff or the
/// param is absent/blank.
pub fn handoff_model_id(set: &GgAgentConfig) -> Option<String> {
    let capability = set
        .capability(CAPABILITY_COMPACTION)
        .filter(|cap| cap.enabled)?;
    let strategy = CompactionStrategy::resolve(
        capability.implementation.as_deref(),
        set.is_enabled(CAPABILITY_MEMORIES),
    );
    if !strategy.is_handoff() {
        return None;
    }
    capability
        .params
        .get(COMPACTION_PARAM_MODEL)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .map(str::to_string)
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

// ---------------------------------------------------------------------------
// The trigger and the rewrite
// ---------------------------------------------------------------------------

/// Whether a compaction should fire **now** — at a turn boundary, with the window fully
/// assembled.
///
/// Three conditions, all necessary: the capability is on; window
/// [fullness](ContextModel::fullness) has reached the [trigger](CompactionPolicy::trigger_fullness)
/// (an unknown window limit has no fullness denominator, so it never fires); and there is ephemeral
/// history to reclaim — compacting with none would reclaim nothing and could loop.
pub fn should_compact(context: &ContextModel, setup: &CompactionSetup) -> bool {
    setup.enabled
        && context
            .fullness()
            .is_some_and(|fullness| fullness >= setup.policy.trigger_fullness())
        && context.has_ephemeral()
}

/// One file carried across a compaction boundary by name: the path the model asked for, the body gg
/// re-read for it, and any pictures that read produced.
///
/// It is what makes the two [`compact`](COMPACT_TOOL)-tool strategies different in kind from the
/// summarizing ones: the restarted context is not only *what the model said about* the work, it is
/// the material the model chose to have in hand while continuing it.
#[derive(Debug, Clone, Default)]
pub struct RestoredFile {
    /// The workspace-relative path, which also tags the restored
    /// [file view](GgContextSource::FileView) so agent-managed context can evict it by name.
    pub path: String,
    /// The rendered read — the same body a `read_file` would have returned, or the error explaining
    /// why the re-read failed (a path the model named but gg could not read is reported to it
    /// rather than silently dropped).
    pub body: String,
    /// The pictures the re-read produced, when the path is a reference image.
    pub images: Vec<ImageContent>,
}

/// Rewrite the window at a compaction boundary and produce the
/// [`Compaction`](GgTelemetryKind::Compaction) telemetry for it — the **one** place every strategy
/// converges, so the seven differ only in how `request` was obtained.
///
/// The pinned prefix is kept verbatim ([`ContextModel::clear_ephemeral`]); then the `files` the
/// model asked to keep are re-seeded as ordinary (ephemeral, re-readable, evictable) file views;
/// then the summary is appended last, so the last thing the model reads is the recap that tells it
/// where to continue.
///
/// `fallback` marks a summary that is gg's fixed note rather than a real recap, so a study reads a
/// failed condensation as a failure rather than as a terse strategy.
pub fn apply_compaction(
    context: &mut ContextModel,
    setup: &CompactionSetup,
    retained: RetainedCounts,
    request: &CompactionRequest,
    files: Vec<RestoredFile>,
    fallback: bool,
) -> GgTelemetryKind {
    let before_tokens = context.total_tokens();
    let before_by_source = context.usage_by_source();

    context.clear_ephemeral();
    for file in files {
        // Pushed as a `user` message, not a `tool` result: the assistant turn that would have
        // requested the read was just dropped, and a `tool` message with no `tool_calls` to answer
        // is rejected outright by an OpenAI-shaped provider. The body and any pictures are
        // identical; only the envelope differs — the same re-framing `clear_ephemeral` performs on
        // a pinned `tool` item, and for the same reason.
        context.push_labeled(
            GgContextSource::FileView,
            Retention::Ephemeral,
            Message::user(file.body).with_images(file.images),
            Some(file.path),
        );
    }
    context.push(
        GgContextSource::History,
        Retention::Ephemeral,
        Message::user(prompts::render_compaction_preface(&request.summary)),
    );

    let after_tokens = context.total_tokens();
    let after_by_source = context.usage_by_source();
    let summary_tokens = context.tokens_for(GgContextSource::History);

    GgTelemetryKind::Compaction {
        strategy: setup.strategy.id().to_string(),
        trigger_fullness: setup.policy.trigger_fullness(),
        before_tokens,
        after_tokens,
        summary_tokens,
        retained: GgRetainedState {
            skills: retained.skills,
            tasks: retained.tasks,
            memories: retained.memories,
            issues: retained.issues,
        },
        before_by_source,
        after_by_source,
        summary: request.summary.clone(),
        summary_fallback: fallback,
    }
}

/// Condense the thread with an **out-of-band** strategy and return what the rewrite should be built
/// from: the summary (and, for [handoff compaction](CompactionStrategy::HandoffCompaction), the
/// files it asked gg to re-read), plus whether the call fell back to gg's fixed note.
///
/// What the compaction model reads is the point of the handoff strategies: the whole window rebuilt
/// as [labelled user messages](handoff_messages) — no system prompt, no skills, no memories, and not
/// one `assistant` message it could mistake for its own.
///
/// A strategy with no [summarizer](resolve_summarizer) is an in-loop one, which the loop condenses
/// through the agent's own turn and never routes here; reaching this with one is a bug, so it
/// degrades to the same [fallback](fallback_summary) a failed call does rather than compacting to
/// nothing.
pub async fn condense_out_of_band(
    context: &ContextModel,
    client: &dyn ModelClient,
    setup: &CompactionSetup,
) -> (CompactionRequest, bool) {
    let Some(summarizer) = &setup.summarizer else {
        return (fallback_request(), true);
    };
    let history = handoff_messages(context);
    let request = summarizer
        .summarize(SummaryRequest {
            history: &history,
            client: setup.client(client),
        })
        .await;
    // A summary equal to the fixed fallback note means the condensation failed and degraded;
    // recorded explicitly so a study reads it as a failure, not a real recap.
    let fallback = request.summary == fallback_summary();
    (request, fallback)
}

/// The summary a [memory compaction](CompactionStrategy::Memory) restarts the thread from — a note
/// pointing at the memories the agent has just written, since that strategy produces no recap of
/// its own.
pub fn memory_compaction_request() -> CompactionRequest {
    CompactionRequest {
        summary: memory_compaction_summary().to_string(),
        files: Vec::new(),
    }
}

/// The summary an in-loop strategy falls back to when the agent's own turn produced nothing usable
/// — an empty reply where the summary should have been.
///
/// A compaction that has been triggered has to complete: the window is full, and a run that
/// declined to compact because the model said nothing would simply overflow on its next turn. So
/// this is the same fixed note a failed out-of-band call degrades to, and it is reported as a
/// fallback for the same reason.
pub fn fallback_request() -> CompactionRequest {
    CompactionRequest {
        summary: fallback_summary().to_string(),
        files: Vec::new(),
    }
}

/// Whether `summary` is gg's [fixed fallback note](fallback_summary) rather than a real recap.
pub fn is_fallback(summary: &str) -> bool {
    summary == fallback_summary()
}

#[cfg(test)]
#[path = "compaction.test.rs"]
mod tests;
