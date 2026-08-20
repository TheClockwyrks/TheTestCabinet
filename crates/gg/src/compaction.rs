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
//!   history to reclaim, [`CompactionTrigger`] says to compact. It is also what says *stop*: a
//!   boundary that fires and leaves the window still at the threshold has reclaimed nothing, so
//!   the trigger retries while [`max_retries`](CompactionPolicy::max_retries) allows one and ends
//!   the agent as failed when it does not.
//! - **The rewrite.** The pinned prefix is kept verbatim and the ephemeral history is
//!   replaced by a single summary item (plus, for the two `compact`-tool strategies, a fresh
//!   [file view](RestoredFile) per path the model asked to keep) via [`apply_compaction`].
//!   The post-compaction window is *pinned prefix + restored files + summary*, and the run
//!   continues from there.
//! - **The reserve.** Condensing the thread costs a model call over the whole thread, so
//!   enabling compaction **shrinks the window the agent is given** by
//!   [`summary_headroom`](CompactionPolicy::summary_headroom) — the fraction every enabled
//!   compaction states for itself — via [`working_window`]. The held-back slice is the room that
//!   call needs to read the transcript and emit its summary; without it a run can trip the trigger
//!   at a point where the compaction that was meant to save it cannot fit.
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
    CAPABILITY_COMPACTION, COMPACTION_PARAM_MODEL, COMPACTION_PARAM_MODEL_SLOT,
    COMPACTION_STRATEGY_HANDOFF_COMPACTION, COMPACTION_STRATEGY_HANDOFF_SUMMARIZATION,
    COMPACTION_STRATEGY_MEMORY, COMPACTION_STRATEGY_SELF_COMPACTION,
    COMPACTION_STRATEGY_SELF_SUMMARIZATION, GgAgentConfig, GgContextSource, GgRetainedState,
    GgTelemetryKind, PARAM_MAX_RETRIES, PARAM_SUMMARY_HEADROOM,
};

use crate::context::{ContextModel, Retention, item_heading};
use crate::docs::DocsRuntime;
use crate::memories::MemoryCalls;
use crate::model::{ImageContent, Message, ModelClient, Role};
use crate::prompts::{self, CompactionPromptContext};
use crate::sandbox::{CONTEXT_COMPACT, ProgramLanguage, spell};
use crate::tools::{COMPACT_TOOL, CompactTool, Tool, parse_compact_request};
use crate::validate::{LaunchDefect, LaunchReport};

/// The largest accepted [`summary_headroom`](CompactionPolicy::summary_headroom). Reserving
/// more than 90% of the window would leave the agent no room to work at all, so a larger
/// value is one gg cannot honour and [refuses the launch](crate::validate) over.
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
/// also names the files to re-read, or [memories](test_cabinet_core::gg::CAPABILITY_MEMORIES)
/// instead of a summary at all.
///
/// An enabled compaction **names one**, and a run that names a strategy gg does not offer — or
/// names none at all — is [refused at launch](crate::validate): the strategy is the capability's
/// whole experimental variable, so a strategy gg picked would measure one arm and record another.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompactionStrategy {
    /// The agent writes its own summary, in its own thread, when gg asks it to.
    SelfSummarization,
    /// The agent calls [`compact`](COMPACT_TOOL) with a summary **and** the files to re-read.
    SelfCompaction,
    /// A separate model writes the summary, reading the thread as labelled user messages.
    HandoffSummarization,
    /// A separate model answers with a [`compact`](COMPACT_TOOL) call — summary plus files.
    HandoffCompaction,
    /// The agent writes its working state to
    /// [memories](test_cabinet_core::gg::CAPABILITY_MEMORIES), which are pinned and so cross the
    /// boundary verbatim; there is no prose summary.
    Memory,
}

impl CompactionStrategy {
    /// Every strategy gg offers, in the order the documentation lists them — the vocabulary an
    /// [`implementation`](test_cabinet_core::gg::GgCapabilityConfig::implementation) is read
    /// against, and what a refusal offers the operator back.
    pub const ALL: [Self; 5] = [
        Self::SelfSummarization,
        Self::SelfCompaction,
        Self::HandoffSummarization,
        Self::HandoffCompaction,
        Self::Memory,
    ];

    /// **The strategy of a thread that is not going to be compacted** — the named placeholder
    /// [`resolve`](Self::resolve) hands back when the document selected no arm, and what a
    /// [setup](CompactionSetup) with the capability off carries where a strategy would go.
    ///
    /// Three reads land here and none of them is a compaction. An enabled capability naming an arm
    /// gg does not offer is reported by [`resolve`](Self::resolve) itself; an enabled capability
    /// naming none is reported by [`check_implementation`](crate::validate), which is the reader
    /// that can see the switch — the launch is already refused in both, and no turn is taken under
    /// this value. A capability that is **off** compacts by no strategy at all, and the
    /// [`enabled`](CompactionSetup::enabled) flag beside it is what every reader gates on first.
    ///
    /// It is spelled out here, rather than reached through a `Default`, so the line that returns it
    /// says what it is: not "prose, then", but that nothing is going to be condensed under it.
    /// *Which* variant it equals is deliberately not load-bearing — nothing reads a strategy
    /// through it — and it is the inert one on purpose: a placeholder that answered
    /// [`offers_compact_tool`](Self::offers_compact_tool) or [`pending`](Self::pending) with
    /// anything would be a fallback wearing a placeholder's name.
    pub const NO_COMPACTION: Self = Self::SelfSummarization;

    /// The strategy an [implementation](test_cabinet_core::gg::GgCapabilityConfig::implementation)
    /// string names.
    ///
    /// A name gg does not offer is reported into `report` and refuses the launch, because the
    /// strategy is the capability's one experimental variable and a run that condensed in prose
    /// while its record said `handoff-compaction` is an experiment whose answer belongs to a
    /// different question.
    ///
    /// **Absent, `null` or blank is the one absence this resolver does not report**, and it is not
    /// a default either: it hands back [`NO_COMPACTION`](Self::NO_COMPACTION). Whether an arm is
    /// *owed* is a property of the switch, and this reader is given an
    /// `Option<&str>` with no switch in it — so [`check_implementation`](crate::validate), which
    /// reads the whole capability, is what refuses an enabled compaction that names none, and this
    /// says nothing rather than naming the same hole a second time in different words.
    ///
    /// [`Memory`](Self::Memory) resolves to itself whether or not the agent can write its
    /// memories. It is the one strategy with a hard prerequisite — a
    /// [read-only](crate::memories::MemoryScope::ReadOnly) holder is offered no call that changes
    /// its memories, so [`MemoryWrites`](PendingCompaction::MemoryWrites) could never be
    /// satisfied — and the prerequisite is enforced by refusing the run, never by handing back a
    /// different arm. The declared half (memories switched off, or a `read-only` scope on the
    /// profile) is a [launch refusal](crate::validate); the half no document can decide — a profile
    /// scoped [`inherited`](crate::memories::MemoryScope::Inherited) is writable or not according
    /// to who spawned it — is a gg internal error that ends the session at the moment the spawn
    /// settles it. Condensing in prose under the memory arm's name would make two profiles of a
    /// compaction study the same arm, with the cost split as the only place it ever showed.
    pub fn resolve(implementation: Option<&str>, report: &mut LaunchReport) -> Self {
        match implementation.map(str::trim) {
            None | Some("") => Self::NO_COMPACTION,
            Some(COMPACTION_STRATEGY_SELF_SUMMARIZATION) => Self::SelfSummarization,
            Some(COMPACTION_STRATEGY_SELF_COMPACTION) => Self::SelfCompaction,
            Some(COMPACTION_STRATEGY_HANDOFF_SUMMARIZATION) => Self::HandoffSummarization,
            Some(COMPACTION_STRATEGY_HANDOFF_COMPACTION) => Self::HandoffCompaction,
            Some(COMPACTION_STRATEGY_MEMORY) => Self::Memory,
            Some(other) => {
                report.report(
                    LaunchDefect::run_level(
                        crate::validate::implementation_locus(CAPABILITY_COMPACTION),
                        other,
                        format!(
                            "`{other}` is not a compaction strategy gg offers; the strategy is what \
                             a compaction study varies, so gg will not pick one for it."
                        ),
                    )
                    .known(Self::ALL.map(Self::id)),
                );
                Self::NO_COMPACTION
            }
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
    /// Whether the **tool** named `name` is one this pending compaction accepts.
    ///
    /// The narrowing is total rather than advisory, and it has to be: the window is full, so a call
    /// that is allowed through is a call that makes the problem worse.
    ///
    /// [`Summary`](Self::Summary) admits nothing here, because on the tool-calling path the summary
    /// *is* the reply's own text and the loop takes that turn whole without dispatching from it.
    /// A program has no such reply; see [`admits_operation`](Self::admits_operation).
    pub fn admits(self, name: &str) -> bool {
        match self {
            Self::Summary => false,
            Self::CompactCall => name == COMPACT_TOOL,
            Self::MemoryWrites => crate::tools::is_memory_tool(name),
        }
    }

    /// Whether the **operation** `id` is one this pending compaction accepts — [`admits`](Self::admits)
    /// asked of the responses-as-code surface, in that surface's own vocabulary.
    ///
    /// The two are separate rather than one function over a shared name for the reason the two
    /// surfaces are separate everywhere else, and for one that is specific to this gate:
    /// [`Summary`](Self::Summary) is satisfied *differently* here. A code agent has no prose reply
    /// to summarize in — every reply is a program — so its summary arrives as a `context.compact`
    /// call carrying it, and that call is what this must admit where the tool path admits nothing at
    /// all. That is not a spelling difference; it is the same requirement met by a different act,
    /// which is exactly what a single predicate parameterised by a `bool` was obscuring.
    pub fn admits_operation(self, id: crate::sandbox::OperationId) -> bool {
        match self {
            Self::Summary | Self::CompactCall => id == crate::sandbox::CONTEXT_COMPACT,
            Self::MemoryWrites => crate::memories::MEMORY_MUTATIONS.contains(&id),
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
    pub fn instruction(self, language: Option<&dyn ProgramLanguage>, calls: MemoryCalls) -> String {
        prompts::render_compaction_instruction(&self.prompt_context(None, language, calls))
    }

    /// The refusal that answers a call this pending compaction does not accept — and the message a
    /// reply that made *no* usable call is fed back.
    ///
    /// It names the call that was refused rather than only what is wanted, because a model that is
    /// told "do X" while its Y silently fails reads the failure as gg being broken and retries Y.
    pub fn refusal(
        self,
        refused: &str,
        language: Option<&dyn ProgramLanguage>,
        calls: MemoryCalls,
    ) -> String {
        prompts::render_compaction_refusal(&self.prompt_context(
            Some(refused.to_string()),
            language,
            calls,
        ))
    }

    /// The feedback for a reply that satisfied nothing at all — no usable call under
    /// [`CompactCall`](Self::CompactCall) / [`MemoryWrites`](Self::MemoryWrites).
    pub fn unsatisfied(self, language: Option<&dyn ProgramLanguage>, calls: MemoryCalls) -> String {
        prompts::render_compaction_unsatisfied(&self.prompt_context(None, language, calls))
    }

    /// The [rendering context](CompactionPromptContext) this pending compaction's three model-facing
    /// messages share: which requirement is pending, and how this run's model names the calls that
    /// satisfy it.
    ///
    /// `language` — the agent's [program language](ProgramLanguage), or `None` when it calls tools —
    /// is the one thing that changes the wording: under
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
        language: Option<&dyn ProgramLanguage>,
        calls: MemoryCalls,
    ) -> CompactionPromptContext {
        CompactionPromptContext {
            summary: matches!(self, Self::Summary),
            compact_call: matches!(self, Self::CompactCall),
            memory_writes: matches!(self, Self::MemoryWrites),
            code_mode: language.is_some(),
            // Named as the reader writes it: a program calls a method on an API object — spelled
            // from that language's own catalogue, never written out here — and a
            // tool-calling model requests a tool.
            compact_tool: match language {
                Some(language) => spell(language, CONTEXT_COMPACT),
                None => COMPACT_TOOL.to_string(),
            },
            memory_create: calls.create,
            memory_revise: calls.revise,
            memory_delete: calls.delete,
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
        .map(|item| handoff_message(item.source, item.label, item.message))
        .collect()
}

/// One item of the live window as the handoff transcript carries it: a `user` message whose body is
/// the original content under its [`handoff_label`] heading, with any tool calls it made spelled
/// out (they are what the agent *did*, and dropping them would leave a summarizer reading a thread
/// of narration with no actions in it).
///
/// A message that already opens with its own heading — every synthesized `user` message in a
/// [code-mode](crate::context::item_heading) run does — is left as it is rather than headed twice.
fn handoff_message(source: GgContextSource, label: Option<&str>, message: &Message) -> Message {
    let heading = format!("{}\n----\n", handoff_label(source, label, message.role));
    let mut body = message.content.clone().unwrap_or_default();
    for call in &message.tool_calls {
        body.push_str(&format!("\n→ called `{}`({})", call.name, call.arguments));
    }
    if body.starts_with(&heading) {
        return Message::user(body);
    }
    Message::user(format!("{heading}{body}"))
}

/// The heading one window item carries in a [handoff transcript](handoff_messages).
///
/// It is read off the item's [source](GgContextSource) **and its selector tag** — the same
/// [`item_heading`] a code-mode window already prefixes its own messages with, so a run that heads
/// its messages is not relabelled. The tag matters for exactly one band: a
/// [text view](GgContextSource::TextView) is headed `View: {label}`, and asking here for the bare
/// `View` would fail the already-headed check above and hand the summarizer
/// `View\n----\nView: notes\n----\n…` — two headings for one message, the second of which it would
/// reasonably read as content.
///
/// The exception is an assistant turn, which has no code heading (a program is the model's own
/// output, never gg's synthesis) and is exactly the item the flattening must label. `Assistant` is
/// what the handoff system prompts name it.
fn handoff_label(source: GgContextSource, label: Option<&str>, role: Role) -> String {
    if role == Role::Assistant || source == GgContextSource::Assistant {
        return "Assistant".to_string();
    }
    item_heading(source, label).unwrap_or_else(|| "Message".to_string())
}

// ---------------------------------------------------------------------------
// Policy and setup
// ---------------------------------------------------------------------------

/// The tuning of the compaction trigger, resolved from the capability's params.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CompactionPolicy {
    /// The fraction of the model's window **withheld from the agent** so that a compaction
    /// can actually be performed — see [`working_window`](Self::working_window). This is the
    /// knob the trigger is cut from: the fullness [trigger](Self::trigger_fullness) is derived
    /// from it, not configured separately.
    pub summary_headroom: f64,
    /// How many times a compaction that **did not relieve the window** is attempted again before
    /// the agent is ended as [failed](CompactionVerdict::Exhausted).
    ///
    /// Zero — which is what an absent [`maxRetries`](PARAM_MAX_RETRIES) says — means one
    /// compaction and no more: a boundary that leaves the window still at the trigger has nothing
    /// further to try, and the agent fails there. It is the figure every configuration should be
    /// running under, because a compaction that reclaims nothing is a run that is over already;
    /// what a retry buys is the one shape where a second pass can help — a strategy whose first
    /// summary came back nearly as long as the thread it replaced.
    pub max_retries: u64,
}

impl CompactionPolicy {
    /// **The policy of a thread that is not going to be compacted** — the named placeholder
    /// [`resolve`](Self::resolve) hands back once it has reported, and what a
    /// [setup](CompactionSetup) with the capability off carries where a policy would go.
    ///
    /// Reaching it means the [headroom](PARAM_SUMMARY_HEADROOM) was absent from an enabled
    /// capability or was a value gg cannot honour — the launch is refused either way, before a
    /// turn is taken — or that compaction is off, in which case the [trigger](CompactionTrigger)
    /// is idle for the whole run and nothing here is read. It is written out rather than reached
    /// through a `Default` so the line that returns it cannot be mistaken for the run getting a
    /// headroom nobody wrote; the fraction it names withholds nothing, which is the only honest
    /// thing to withhold on behalf of a document that did not ask.
    pub const NO_COMPACTION: Self = Self {
        summary_headroom: 0.0,
        max_retries: 0,
    };

    /// Resolve the policy from an **enabled** compaction capability's `params` object.
    ///
    /// [`summaryHeadroom`](PARAM_SUMMARY_HEADROOM) is required of every compaction that is switched
    /// on, and absent it is [reported](crate::validate::required_param) and the launch is refused.
    /// This one number sets both the [trigger](Self::trigger_fullness) *and* the [working
    /// window](Self::working_window) the agent has for the entire run, so a run gg picked a
    /// fraction for would differ from the configured arm in when it compacted **and** in how much
    /// window it ever had — and nothing in its record would say which fraction it was.
    ///
    /// Present and unreadable is refused on the same terms: a string, a negative, `1.5`, a NaN, or
    /// anything above [`MAX_SUMMARY_HEADROOM`] names no fraction gg can withhold.
    ///
    /// A capability that is switched **off** requires no headroom — it configures nothing — so what
    /// it carries is read by [`check_declared`](Self::check_declared) instead, which reports an
    /// unreadable value and nothing at all for an absent one.
    ///
    /// The fullness trigger is not a separate param — it is defined by the headroom.
    ///
    /// [`maxRetries`](PARAM_MAX_RETRIES) is the capability's one **optional** param, read the way
    /// every optional count is: absent is `0`, which is the setting rather than a substitution —
    /// one compaction, and an agent the boundary could not relieve is failed rather than compacted
    /// round again.
    pub fn resolve(params: &Value, report: &mut LaunchReport) -> Self {
        let headroom = crate::validate::required_param(
            params,
            CAPABILITY_COMPACTION,
            PARAM_SUMMARY_HEADROOM,
            report,
        )
        .and_then(|raw| read_summary_headroom(raw, report));
        let max_retries =
            crate::validate::count_param(params, CAPABILITY_COMPACTION, PARAM_MAX_RETRIES, report)
                .unwrap_or(0);
        match headroom {
            Some(summary_headroom) => Self {
                summary_headroom,
                max_retries,
            },
            None => Self::NO_COMPACTION,
        }
    }

    /// Read whatever headroom a **disabled** compaction capability declares, requiring none.
    ///
    /// A disabled capability carries the configuration the arm *would* have used, which is what
    /// lets the on and off arms of one comparison be one document with one switch moved: nothing is
    /// owed of it, and a value it does carry is read on exactly the terms the enabled arm's is, so
    /// a typo is heard about now rather than on the launch that flips the switch.
    pub fn check_declared(params: &Value, report: &mut LaunchReport) {
        if let Some(raw) = params
            .get(PARAM_SUMMARY_HEADROOM)
            .filter(|value| !value.is_null())
        {
            read_summary_headroom(raw, report);
        }
        crate::validate::count_param(params, CAPABILITY_COMPACTION, PARAM_MAX_RETRIES, report);
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
    /// It is applied once per agent, by
    /// [`resolve_window_limit`](crate::agent::resolve_window_limit), and what it produces is the
    /// [window every reader measures against](field@crate::context::ContextModel::window_limit) — this
    /// capability's trigger and the
    /// [context-usage signal's threshold](crate::context::UsageSignalOptions::threshold_percent)
    /// alike. One agent has one usable window, so no two readers can judge a run against two.
    ///
    /// Never returns zero (a degenerate window would make every fullness ratio infinite),
    /// and never exceeds `window`.
    pub fn working_window(&self, window: u64) -> u64 {
        let usable = (window as f64 * (1.0 - self.summary_headroom)).floor();
        (usable.max(1.0) as u64).min(window)
    }
}

/// One written [`summaryHeadroom`](PARAM_SUMMARY_HEADROOM) read as the fraction it must name — the
/// half [`CompactionPolicy::resolve`] and [`CompactionPolicy::check_declared`] share, so an enabled
/// capability's headroom and a disabled one's are judged by the same lines.
///
/// `None` is a value gg cannot withhold, already reported: anything that is not a finite number, and
/// any number outside `0.0..=`[`MAX_SUMMARY_HEADROOM`]. Zero is a legitimate (if reckless) choice —
/// an operator asking for the whole window is honoured — and it is the top of the range that has to
/// be bounded, since reserving more than that leaves the agent no window to work in.
fn read_summary_headroom(raw: &Value, report: &mut LaunchReport) -> Option<f64> {
    let defect = |found: String, message: String| {
        LaunchDefect::run_level(
            crate::validate::param_locus(CAPABILITY_COMPACTION, PARAM_SUMMARY_HEADROOM),
            found,
            message,
        )
    };
    let Some(headroom) = raw.as_f64().filter(|value| value.is_finite()) else {
        report.report(defect(
            raw.to_string(),
            format!(
                "`{PARAM_SUMMARY_HEADROOM}` is the fraction of the window held back for the \
                 summarization call, so it must be a number."
            ),
        ));
        return None;
    };
    if !(0.0..=MAX_SUMMARY_HEADROOM).contains(&headroom) {
        report.report(defect(
            headroom.to_string(),
            format!(
                "`{PARAM_SUMMARY_HEADROOM}` must be a fraction between 0.0 and \
                 {MAX_SUMMARY_HEADROOM}; reserving more than that would leave the agent no \
                 window to work in, and reserving a negative share is not a thing gg can do."
            ),
        ));
        return None;
    }
    Some(headroom)
}

/// The window the agent running `profile` may actually fill, out of a model window of `window`
/// tokens: [reduced by the summary headroom](CompactionPolicy::working_window) when
/// [compaction](CAPABILITY_COMPACTION) is on.
///
/// Read off `profile` rather than off the run's root, for the reason
/// [`CompactionSetup::resolve`] is: compaction is a per-agent capability, so the fraction that
/// fires a compaction and the window that fraction is measured against have to come from one
/// document. Read off the root instead, a worker compacting at `1 - summaryHeadroom` of a window
/// nothing reduced would reserve none of the room its own summarization call needs — and a worker
/// that compacts not at all would be measured against a window its profile never narrowed.
///
/// A capability that is **absent or switched off** is the whole `window`, unreduced. That is the
/// setting rather than a fallback: there is no summarization call to reserve for, so there is no
/// headroom to read and none is required of the document.
pub fn working_window(profile: &GgAgentConfig, window: u64, report: &mut LaunchReport) -> u64 {
    match profile
        .capability(CAPABILITY_COMPACTION)
        .filter(|capability| capability.enabled)
    {
        Some(capability) => {
            CompactionPolicy::resolve(&capability.params, report).working_window(window)
        }
        None => window,
    }
}

/// The compaction configuration threaded into the [turn loop](crate::agent): whether the
/// capability is on, its [policy](CompactionPolicy), the selected [strategy](CompactionStrategy),
/// the out-of-band [summarizer](Summarizer) it resolves to, and — for a handoff — the separate
/// model's client.
pub struct CompactionSetup {
    /// Whether the compaction capability is enabled for this run. When `false` the loop
    /// never compacts (a configuration with the capability off).
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
    /// **The setup of a run that does not compact** — the answer for a profile that declares no
    /// [compaction](CAPABILITY_COMPACTION) capability, or declares it switched off.
    ///
    /// It is the value that says so rather than an arm: [`enabled`](Self::enabled) is `false`,
    /// which is what the [trigger](CompactionTrigger) and every reader in the [loop](crate::agent)
    /// gate on, and the policy and strategy beside it are the two `NO_COMPACTION` placeholders
    /// that nothing reads.
    fn not_compacting() -> Self {
        Self {
            enabled: false,
            policy: CompactionPolicy::NO_COMPACTION,
            strategy: CompactionStrategy::NO_COMPACTION,
            summarizer: None,
            handoff_client: None,
        }
    }

    /// Resolve the compaction setup from an agent's profile: its policy and strategy read from the
    /// [compaction](CAPABILITY_COMPACTION) capability when that capability is present and on.
    ///
    /// A capability that is absent or disabled resolves to [`not_compacting`](Self::not_compacting)
    /// — no headroom is read and none is owed, because a capability that is off configures nothing.
    ///
    /// The [handoff client](Self::handoff_client) is **not** resolved here — building a model
    /// client needs the run's client factory, which this pure resolution does not have. The loop's
    /// launch path fills it in ([`handoff_model_id`]).
    pub fn resolve(set: &GgAgentConfig, report: &mut LaunchReport) -> Self {
        let Some(capability) = set
            .capability(CAPABILITY_COMPACTION)
            .filter(|capability| capability.enabled)
        else {
            return Self::not_compacting();
        };
        let strategy = CompactionStrategy::resolve(capability.implementation.as_deref(), report);
        Self {
            enabled: true,
            policy: CompactionPolicy::resolve(&capability.params, report),
            strategy,
            summarizer: resolve_summarizer(strategy),
            handoff_client: None,
        }
    }

    /// The client an out-of-band condensation runs on: the resolved
    /// [compaction model](Self::handoff_client) for a handoff, else the agent's own `client`.
    ///
    /// A handoff that names no model, names a blank one, or still defers to an unbound
    /// [model slot](COMPACTION_PARAM_MODEL_SLOT) never reaches here: [`handoff_model_id`] reports
    /// each of those and the [launch is refused](crate::validate). What is left is the residue —
    /// a model id gg cannot **resolve a client for** at run time, which is an auth failure or a
    /// provider outage rather than a configured value, and which the loop's launch path is what
    /// decides about.
    pub fn client<'a>(&'a self, client: &'a dyn ModelClient) -> &'a dyn ModelClient {
        match &self.handoff_client {
            Some(handoff) => handoff.as_ref(),
            None => client,
        }
    }
}

/// The model id a [handoff](CompactionStrategy::is_handoff) run condenses with — its capability's
/// [`model`](COMPACTION_PARAM_MODEL) param — or `None` when the capability is off or the strategy
/// is not a handoff.
///
/// A `model` on a **non-handoff** strategy is not read and not reported: it is a key the capability
/// knows and the selected arm does not use, which is the deliberate "one shared params block per
/// sweep" case.
///
/// Under a handoff strategy the param is load-bearing, and **absent or `null` is a setting rather
/// than a hole**: the handoff condenses on the agent's own model, which is what a key nobody wrote
/// means (see [`COMPACTION_PARAM_MODEL`]) and the one thing gg can do without choosing a model on an
/// operator's behalf. **Present and unreadable** is a different thing entirely: a
/// blank string, or a value that is not a string at all, is a `model` somebody meant to write and
/// gg cannot use, and resolving it to the agent's own client would condense on the working model
/// while the record named the handoff arm — with the cost split as the only place it ever showed.
/// So it is reported and the launch is refused.
///
/// A model id that is well-formed here and cannot be **resolved** — no window in the catalog, or a
/// client that will not build at run time — is not this function's business: the first is a launch
/// check over the run's bound models, the second a mid-run failure.
pub fn handoff_model_id(set: &GgAgentConfig, report: &mut LaunchReport) -> Option<String> {
    let capability = set
        .capability(CAPABILITY_COMPACTION)
        .filter(|cap| cap.enabled)?;
    // The `implementation` is read into an [already-reported](LaunchReport::already_reported) sink,
    // never into `report`: at launch [`check_launch`] resolves it a few lines above and owns the
    // refusal, and mid-run the launch pass has already proved it readable. Reporting it here too
    // would name one typo twice in the same refusal.
    let strategy = CompactionStrategy::resolve(
        capability.implementation.as_deref(),
        &mut LaunchReport::already_reported(),
    );
    if !strategy.is_handoff() {
        return None;
    }
    let raw = capability
        .params
        .get(COMPACTION_PARAM_MODEL)
        .filter(|value| !value.is_null())?;
    let model = raw
        .as_str()
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .map(str::to_string);
    if model.is_none() {
        report.report(LaunchDefect::run_level(
            crate::validate::param_locus(CAPABILITY_COMPACTION, COMPACTION_PARAM_MODEL),
            crate::validate::as_written(raw),
            format!(
                "`{COMPACTION_PARAM_MODEL}` must be the id of the model the `{}` strategy hands \
                 the thread to; gg reads nothing here, and condensing on the agent's own model \
                 instead would record one arm and run another.",
                strategy.id(),
            ),
        ));
    }
    model
}

/// Read every compaction value on `profile`, reporting each one gg cannot honour — the compaction
/// capability's whole contribution to the [launch refusal](crate::validate).
///
/// It is here rather than in the pass so the vocabulary and the reader stay the same lines of code:
/// the strategy list, the headroom bounds and the two model params are read by the resolvers just
/// above, and a check written anywhere else would be a second copy of them.
///
/// The switch is what decides how much of it is *owed*. The arm and the two model params are read
/// whether the capability is on or off — a disabled one still records the configuration the run
/// *would* have used, so a typo in it is a typo now rather than on the launch where the switch is
/// flipped — while the [headroom](PARAM_SUMMARY_HEADROOM) is required only of an enabled capability
/// and merely read on a disabled one, because a capability that configures nothing can be short of
/// nothing.
pub fn check_launch(profile: &GgAgentConfig, report: &mut LaunchReport) {
    let Some(capability) = profile.capability(CAPABILITY_COMPACTION) else {
        return;
    };
    CompactionStrategy::resolve(capability.implementation.as_deref(), report);
    if capability.enabled {
        CompactionPolicy::resolve(&capability.params, report);
    } else {
        CompactionPolicy::check_declared(&capability.params, report);
    }
    handoff_model_id(profile, report);
    // Binding a model to a slot writes the collected id to `model` and **drops the slot key**, so a
    // surviving one means the launcher never bound it. gg has no slot table in the container to
    // resolve it against, and nothing downstream will ever look at it again — the key is inert, and
    // the run it describes is not the run that would happen.
    if let Some(slot) = capability
        .params
        .get(COMPACTION_PARAM_MODEL_SLOT)
        .filter(|value| !value.is_null())
    {
        report.report(LaunchDefect::run_level(
            crate::validate::param_locus(CAPABILITY_COMPACTION, COMPACTION_PARAM_MODEL_SLOT),
            crate::validate::as_written(slot),
            format!(
                "a bound launch replaces `{COMPACTION_PARAM_MODEL_SLOT}` with the model it \
                 collected; one still on the document means the slot was never filled, and gg has \
                 no slot table to fill it from. Bind it at launch, or name the model outright in \
                 `{COMPACTION_PARAM_MODEL}`."
            ),
        ));
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

// ---------------------------------------------------------------------------
// The trigger and the rewrite
// ---------------------------------------------------------------------------

/// Whether the assembled window has reached the [trigger](CompactionPolicy::trigger_fullness) —
/// the condition that says *this agent is in trouble*, which [`CompactionTrigger::judge`] then
/// decides what to do about.
///
/// It is deliberately not the whole of "should a compaction fire": that also wants a capability
/// that is on and ephemeral history to reclaim, and — the part no window can answer — whether the
/// boundary before this one already fired and left the window here. A window over the trigger with
/// nothing ephemeral left is not a boundary that need not fire; it is one that **cannot**, and
/// telling those apart is the judgement.
///
/// An unknown window limit has no denominator and so is never over anything: a model gg has no
/// window figure for is measured against nothing, and inventing a fullness for it would invent the
/// trigger too.
///
/// The [fullness](ContextModel::fullness) it reads is a share of the
/// [usable window](CompactionPolicy::working_window), which is the same denominator the
/// [context-usage signal](crate::context::ContextModel::refresh_context_usage_signal) reports its
/// shares against and holds itself back by.
fn over_trigger(context: &ContextModel, setup: &CompactionSetup) -> bool {
    context
        .fullness()
        .is_some_and(|fullness| fullness >= setup.policy.trigger_fullness())
}

/// What the trigger says about one turn boundary — the answer [`CompactionTrigger::judge`] hands
/// the [loop](crate::agent), which acts on all three arms and on nothing else.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompactionVerdict {
    /// The window is below the trigger, or the capability is off. The turn proceeds.
    Idle,
    /// Compact now, by whichever [shape](CompactionStrategy) this run's strategy is.
    Compact,
    /// The window is **still** at the trigger with the retry allowance
    /// ([`max_retries`](CompactionPolicy::max_retries)) spent, so the agent has failed.
    ///
    /// This is the arm that makes the capability's promise falsifiable. A compaction exists to hand
    /// the agent a window it can work in; one that comes back over the trigger did not, and the
    /// next turn assembles the same over-full window and asks for the same compaction — so an
    /// agent left to carry on here compacts at every boundary for the rest of the run, burning the
    /// operator's ceilings on a thread that never advances. gg ends it instead, and says so.
    Exhausted,
}

/// The compaction trigger **with a memory** — how many boundaries in a row have compacted without
/// getting the window back under the trigger, which is the whole of what tells a working backstop
/// from a stuck one.
///
/// Held by the turn loop for the life of an agent (and re-made for each incarnation of a
/// [succession](crate::agent::transitions), which is a different window against a different
/// setup). Every boundary is [judged](Self::judge) through it, including the boundaries that do
/// nothing: a window that came back under the trigger is what clears the count, and a count that
/// only ever rose would fail an agent for a compaction that worked and a window that filled up
/// again honestly.
#[derive(Debug, Clone, Copy, Default)]
pub struct CompactionTrigger {
    /// Compactions fired since the window was last seen **below** the trigger. `0` at every
    /// boundary of a run whose compactions are doing their job, including the boundary right after
    /// one fires.
    fired: u64,
}

impl CompactionTrigger {
    /// Judge one turn boundary, with the window fully assembled and no compaction already in
    /// flight — the [pending](PendingCompaction) case is the loop's to skip, because a compaction
    /// the agent has been asked for and has not yet supplied has not failed at anything.
    ///
    /// The order the three questions are asked in is the point. Whether the window is over the
    /// trigger comes first and decides everything: under it, the count is cleared and the agent
    /// works. Over it, the count is what separates the first attempt from the fourth — and it is
    /// compared against the allowance *before* the window is asked whether anything is left to
    /// reclaim, so an agent whose compaction emptied the history and still could not get under the
    /// trigger is failed rather than left to run at a window nothing can shrink.
    pub fn judge(&mut self, context: &ContextModel, setup: &CompactionSetup) -> CompactionVerdict {
        if !setup.enabled || !over_trigger(context, setup) {
            self.fired = 0;
            return CompactionVerdict::Idle;
        }
        if self.fired > setup.policy.max_retries {
            return CompactionVerdict::Exhausted;
        }
        if !context.has_ephemeral() {
            // Nothing to reclaim. Before the first compaction that is the opening window itself
            // being over the trigger — a pinned prefix too large for the model, which no boundary
            // was ever going to fix and which the turn is left to meet as it always has. After one,
            // it is the same dead end the count exists to stop.
            return match self.fired {
                0 => CompactionVerdict::Idle,
                _ => CompactionVerdict::Exhausted,
            };
        }
        self.fired += 1;
        CompactionVerdict::Compact
    }

    /// How many compactions have fired since the window was last under the trigger — `1` on the
    /// boundary that fires the first one. Read for the operator-facing line that says which attempt
    /// this is out of how many.
    pub fn fired(&self) -> u64 {
        self.fired
    }
}

/// One file carried across a compaction boundary by name: the path the model asked for, the body gg
/// re-read for it, and any pictures that read produced.
///
/// It is what makes the two [`compact`](COMPACT_TOOL)-tool strategies different in kind from the
/// summarizing ones: the restarted context is not only *what the model said about* the work, it is
/// the material the model chose to have in hand while continuing it.
#[derive(Debug, Clone, Default)]
pub struct RestoredFile {
    /// The path the model named, which also tags the restored
    /// [file view](GgContextSource::FileView) so agent-managed context can evict it by name.
    pub path: String,
    /// The rendered read — the same body a `read_file` would have returned, or the error explaining
    /// why the re-read failed (a path the model named but gg could not read is reported to it
    /// rather than silently dropped).
    pub body: String,
    /// The pictures the re-read produced, when the path is a reference image.
    pub images: Vec<ImageContent>,
}

/// One [documentation view](GgContextSource::DocsView) re-derived for the far side of a compaction
/// boundary: the key it is addressed under, and the body gg renders for that key.
///
/// The counterpart of [`RestoredFile`], and it carries a body for the opposite reason that one
/// carries a path. A file's truth is on disk and can have moved, so the honest thing to restore is
/// the *reference* and let the re-read report what is there now. A docview's truth is a catalogue
/// compiled into this binary, read through a scope that cannot change while the agent runs — so
/// there is nothing to be stale against, and rendering it from the key is a pure function that
/// produces the same bytes every time.
///
/// It is a body rather than a key here only because this function has no
/// [documentation runtime](crate::docs::DocsRuntime) in reach to render one with, and threading a
/// runtime through a window rewrite to re-derive text the caller can render in one line would be a
/// dependency bought for nothing. The re-derivation itself is [`restore_docviews`]'s.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RestoredDocview {
    /// The key the view is addressed under.
    pub key: String,
    /// The documentation gg renders for it, without the heading the window prefixes.
    pub body: String,
}

/// Re-derive every [documentation view](GgContextSource::DocsView) open in `context` from its key,
/// ready to be handed back to [`apply_compaction`] once the window has been reset.
///
/// Called **before** the rewrite, for the reason [`RestoredFile`]s are read before it: the keys are
/// in the window the reset is about to empty. A key `docs` no longer resolves is dropped rather than
/// carried as an error — there is nothing the model could act on either way, and the two reasons a
/// key can miss are both silent by design. A key out of gg's own catalogue misses only through drift
/// in gg. A key naming a declaration of a [loaded code module](crate::docs::LoadedDocs) misses when
/// the agent holding this window is not the instance that loaded it: the code did not travel, so its
/// documentation must not either. A window that changed hands has normally been swept of those
/// already — a [carried one](crate::agent::transitions) is re-derived against its new instance
/// before that instance takes a turn — so what this catches is the same rule at the boundary a
/// window crosses **without** changing hands.
pub fn restore_docviews(context: &ContextModel, docs: &DocsRuntime) -> Vec<RestoredDocview> {
    context
        .open_docviews()
        .into_iter()
        .filter_map(|open| {
            Some(RestoredDocview {
                body: docs.read_any(&open.key)?,
                key: open.key,
            })
        })
        .collect()
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
/// # Text views do not survive the boundary, and documentation does
///
/// A [text view](GgContextSource::TextView) — material a
/// [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) program composed for
/// itself — is an ordinary ephemeral item, so it is dropped here with everything else, and the
/// request carries **`files` only**: there is no way for a model to name a view it wants carried
/// across. That is deliberate rather than an oversight. The window is a text view's only copy, so
/// carrying one across would mean re-seeding bytes the boundary exists to reclaim, and the material
/// a model wants to outlive a compaction has two homes that already survive one — a file it can
/// name in `files`, or a [memory](test_cabinet_core::gg::CAPABILITY_MEMORIES). A file view *is*
/// carried across when the model names its path, because re-reading it is cheap and truthful.
///
/// A [documentation view](GgContextSource::DocsView) is carried across too, and unlike a file it is
/// carried across **without being asked for**. Documentation is not the agent's material and not the
/// workspace's: it is the description of the surface the agent is working through, and with search
/// and on-demand lookup as the only route to it, an agent that compacted would come back holding no
/// reference to the API it was in the middle of using — and no way to know that is what happened.
/// So the caller re-derives each open view [from its key](RestoredDocview) and hands them here, in
/// first-open order, which is what keeps the band's append-only ordering true across the boundary.
///
/// `fallback` marks a summary that is gg's fixed note rather than a real recap, so a study reads a
/// failed condensation as a failure rather than as a terse strategy.
#[allow(clippy::too_many_arguments)]
pub fn apply_compaction(
    context: &mut ContextModel,
    setup: &CompactionSetup,
    retained: RetainedCounts,
    request: &CompactionRequest,
    files: Vec<RestoredFile>,
    docviews: Vec<RestoredDocview>,
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
    // After the files and before the summary: the documentation the agent was reading is reference
    // material, so it sits behind the workspace material it was being applied to and ahead of the
    // recap that tells the model where to continue. Re-opened rather than re-pushed, so a key that
    // somehow arrived twice still lands once.
    for docview in docviews {
        context.open_docview(docview.key, docview.body);
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
