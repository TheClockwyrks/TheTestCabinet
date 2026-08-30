//! The gg **agent** and its turn loop.
//!
//! An [`Agent`] is one node in gg's [subagent tree](https://docs.testcabinet.ai/gg/subagents/):
//! it carries a stable [`id`](Agent::id), its spawner's id
//! ([`parent_id`](Agent::parent_id)), its [`depth`](Agent::depth) in the tree, and the model
//! [`profile`](Agent::profile_id) it runs on (its live lifecycle is streamed as
//! [`AgentStatus`](test_cabinet_core::gg::GgTelemetryKind::AgentStatus) telemetry). Its
//! [turn loop](Agent::drive) is gg's core — the one coarse-grained plug point of the design
//! (all other modularity comes from [which tools](crate::tools) are offered). The loop drives
//! one agent: build a model request from the conversation and the offered toolset, send it via
//! the agent's [client](crate::client), record the assistant's message and tool calls, dispatch
//! each tool, append the results, and repeat until the model stops calling tools — emitting
//! [agent-tagged telemetry](crate::telemetry::Emitter::for_agent) throughout.
//!
//! Every run starts from the **root** agent (id [`ROOT_AGENT_ID`], depth `0`, running under the
//! set's [root profile](test_cabinet_core::gg::GgCapabilitySet::root)), created from the
//! invocation, and grows a tree from there: an agent spawns a child **by profile id**, and the
//! child is constructed, resourced and driven exactly as the root is. What is per-run rather than
//! per-agent lives on the [`Orchestrator`] — the [scheduler](Scheduler) that decides which agents
//! hold a running slot, the [per-profile accounting](SlotAccounting) usage and cost fold into, and
//! the shared [`ClientFactory`] every agent resolves its profile's model through — so [`run`] owns
//! the session frame and nothing about a single agent (see the seam noted on [`Agent::drive`]).
//!
//! # Control flow
//!
//! [`run`] frames one session:
//!
//! 1. scope the emitter to the [root agent](ROOT_AGENT_ID) and emit
//!    [`SessionStarted`](GgTelemetryKind::SessionStarted);
//! 2. run the launch checks — [every configured value can be honoured exactly as
//!    written](crate::validate::validate_launch), [every bound model declares a context
//!    window](validate_model_windows),
//!    the root's [profile binding](profile_binding) resolves to a concrete [`ModelClient`]
//!    (mock or OpenRouter), and the [orchestrator](Orchestrator::build) can be built at all.
//!    Failing any of them is a **launch failure**: it emits a
//!    [`Log`](GgTelemetryKind::Log)`(error)` per reason and
//!    [`SessionEnded`](GgTelemetryKind::SessionEnded)`{status:"error"}` and returns
//!    [`SessionOutcome::HarnessError`] so the process exits non-zero. The first three are things a
//!    configuration can get wrong; the fourth is a gg defect, reported in those words because only
//!    we can fix one. The first names **every** offending value rather than the first, because an
//!    operator fixing a sweep's one shared configuration document wants every typo in one pass. A
//!    *subagent's* client is resolved at spawn time instead, where the failure
//!    belongs to that agent and not the run;
//! 3. emit [`AgentSpawned`](GgTelemetryKind::AgentSpawned) for the root, assemble the offered
//!    [toolset](ToolRegistry) from the root profile's enabled capabilities, and drive the root
//!    agent's [turn loop](Agent::drive) against the client;
//! 4. join every subagent the run spawned, fold each agent's usage into the [per-profile
//!    accounting](SlotAccounting), emit the [`SlotUsage`](GgTelemetryKind::SlotUsage) rollups, a
//!    summary [`Log`](GgTelemetryKind::Log), and the terminal
//!    [`SessionEnded`](GgTelemetryKind::SessionEnded).
//!
//! Each turn the loop emits [`TurnStarted`](GgTelemetryKind::TurnStarted), calls the
//! model, emits [`Usage`](GgTelemetryKind::Usage) and (when present)
//! [`AssistantMessage`](GgTelemetryKind::AssistantMessage), then for every requested
//! tool emits [`ToolCall`](GgTelemetryKind::ToolCall), dispatches it, and emits
//! [`ToolResult`](GgTelemetryKind::ToolResult). A turn with no tool calls ends the
//! session ([`"completed"`](Agent::drive)). Under
//! [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) the turn is a **program** instead
//! ([`run_code_turn`]), and the ending rule is different in kind: every reply is a program, so no
//! shape of reply means "finished" and only a program calling [`finish`](crate::sandbox::FINISH_FUNCTION) ends the
//! session.
//!
//! # Termination and error surfacing
//!
//! The loop always ends, and always says how in the
//! [`SessionEnded`](GgTelemetryKind::SessionEnded) status:
//!
//! - `"completed"` — the model said it was done: it stopped calling tools, or — under
//!   [responses-as-code](CAPABILITY_RESPONSES_AS_CODE), where every reply is a program and no
//!   shape of reply means "finished" — a program called [`finish`](crate::sandbox::FINISH_FUNCTION);
//! - `"exhausted"` — the per-agent turn ceiling was reached;
//! - `"timed_out"` — the optional wall-clock deadline was passed;
//! - `"limit_exceeded"` — one of the three configurable [execution ceilings](crate::limits) was
//!   breached: too many consecutive error turns, too high a recent error rate, or the run's
//!   accumulated cost. Which one, and at what value, is on the
//!   [`LimitExceeded`](GgTelemetryKind::LimitExceeded) event and the session summary;
//! - `"canceled"` — an operator killed the run: the host raised the [cancellation
//!   sentinel](crate::cancel) and every agent wound down at its next turn boundary. Like the
//!   ceilings above it this is not a failure, and unlike anything else on this list it says nothing
//!   whatsoever about the model, because its cause is entirely outside the run;
//! - `"model_error"` — a model turn failed, retryable-exhausted or fatal: the provider was reached
//!   and did not deliver a usable turn. gg ends the session **loudly** — a `Log(error)` plus this
//!   status — never silently:
//!   a known failure mode of another harness is discarding a whole run on one API
//!   error, and gg's whole point is that the failure is visible in the stream. Nothing gg's own
//!   machinery does ends a session here, whatever the model was in the middle of when it broke;
//! - `"auth_error"` — the run's credential was refused (absent, or a `401`/`403` from
//!   the provider). Called out separately from `"model_error"` because nothing about
//!   the model was exercised: the key The Test Cabinet supplied was rejected, so the
//!   run is an operator fault and must not be scored against the model;
//! - `"hook_error"` — one of the operator's own [hooks](crate::hooks) broke: a script that exited
//!   non-zero, or that printed a decision gg could not read. The only tool-layer condition that
//!   stops a run outright, and it has to be: a gate that did not judge cannot be treated as having
//!   passed or failed, and the model never asked for the hook and cannot fix it;
//! - `"internal_error"` — gg itself broke, in any of the three ways it can: it reached a state its
//!   own launch validation proves is unreachable (an agent whose profile the run does not declare),
//!   its sandbox machinery failed under a turn (a guest artifact that will not run, a fault in
//!   the wasm host, a program gg accepted and then could not prepare), or an agent's task
//!   [panicked](teardown). Separate from every status
//!   above it because the fault is *ours*: the agent's loop ends loudly, naming the fault and the
//!   site, rather than substituting a profile that does exist or charging a broken sandbox to the
//!   model that wrote the program it would not run. It is also the one ending that belongs to the
//!   **run** rather than to the agent that met it — see below;
//! - `"error"` — a launch failure (no bound slot, or the client could not resolve).
//!
//! A launch failure (`"error"`) exits the process `1`, and so do two of the endings above, so
//! that `core` records a harness error rather than a tree to score. They are read off different
//! things:
//!
//! - a gg defect (`"internal_error"`) is read off the **whole tree**. The first agent to meet one
//!   raises it on the run's [fault latch](crate::fault); every other agent — the root included —
//!   stops itself at its next turn boundary exactly as it would for an operator's kill, and the
//!   session ends `"internal_error"` whatever the root's own loop was doing. A run gg broke in did
//!   not produce the tree it leaves behind, so there is nothing in it to score and nothing to
//!   compare a clean run against. A panicked agent reaches no boundary of its own, so the
//!   [teardown] raises the latch on its behalf and wakes whoever was waiting on it;
//! - an auth failure (`"auth_error"`) is read off the **root**, and only the root: the session's
//!   status is the root's [`LoopEnd`]. A subagent whose credential was refused is a
//!   [failed](GgAgentStatus::Failed) node in a session that can still complete and be scored.
//!
//! A **breached [ceiling](crate::limits)** exits on a third code
//! ([`EXIT_LIMIT_EXCEEDED`](test_cabinet_core::gg::EXIT_LIMIT_EXCEEDED)), and is read off the whole
//! tree as a defect is, through the run's [ceiling latch](crate::limits::CeilingLatch). A ceiling
//! is a safeguard the run's own configuration armed and is not expected to be reached, so a run
//! that reached one is recorded by the host apart from a session that ran to a natural end, and is
//! never retried. It changes nothing about the run's conduct: the breaching agent was already ended
//! by [`Agent::stop_on_limit`] and every other agent goes on working. A gg defect outranks it,
//! because a ceiling stopped a measurement and a defect means there was none.
//!
//! Every other ending, of any agent, is a run outcome recorded in the telemetry rather than a
//! process failure, and exits `0`.

use std::collections::{BTreeMap, BTreeSet};
use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

// `catch_unwind` over a *future* — the async equivalent of the `std` one, and the only way to be
// standing between a panicking agent task and the run it would otherwise take down silently. See
// [`teardown`].
use futures_util::FutureExt;
use serde_json::{Value, json};
use test_cabinet_core::gg::{
    ALL_HOOK_EVENTS, AUTOLOAD_LOCKED_IMPL, AUTOLOAD_PARAM_IMAGES, CAPABILITY_AGENT_MANAGED_CONTEXT,
    CAPABILITY_AUTOLOAD_SPECS, CAPABILITY_COMPACTION, CAPABILITY_CONTEXT_WINDOW_OVERRIDE,
    CAPABILITY_PROJECT_MANAGEMENT, CAPABILITY_RESPONSES_AS_CODE, CAPABILITY_SKILLS,
    CAPABILITY_SUBAGENTS, DEFAULT_SIGNAL_THRESHOLD_PERCENT, GG_WORKSPACE_SKILLS_DIR, GgAgentApi,
    GgAgentApiFunction, GgAgentConfig, GgAgentStatus, GgAgentTransitionKind, GgCallFailure,
    GgCapabilitySet, GgContextAction, GgContextSource, GgHookAgentKind, GgHookEvent,
    GgIssueReviewPhase, GgLimitBreach, GgLimitKind, GgProgramLanguage, GgReviewer, GgRosterEntry,
    GgRunLimits, GgSlotBinding, GgSubagentScope, GgTelemetryKind, GgUndocumentedCalls,
    PARAM_SIGNAL_THRESHOLD_PERCENT, PARAM_SKILLS_DIR, PARAM_TOP_FILE_VIEWS, PARAM_WINDOW_LIMIT,
    PROJECT_MANAGEMENT_PARAM_MERGE_AGENT,
};
use test_cabinet_core::gg_session_journal::GG_SESSION_JOURNAL_PATH;
use test_cabinet_core::gg_session_record::{
    GgSessionAgent, GgSessionAgentOrigin, GgSessionModalities,
};
use test_cabinet_core::metrics::{Cost, TokenCounts};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

use crate::archive::ArchiveStore;
use crate::board::{BoardCaps, BoardRuntime, IssuePolicy, IssueStatus};
use crate::cancel::CancelWatch;
use crate::capture::{GgRecorder, RecordedSeed, RecordingClient};
use crate::client::{AgentIdentity, ClientFactory, DefaultClientFactory, provider_for};
use crate::compaction::{
    self, CompactionRequest, CompactionSetup, CompactionVerdict, PendingCompaction, RestoredFile,
};
use crate::completion;
use crate::config::GgInvocation;
use crate::context::{
    BpeTokenEstimator, ContextModel, FileRegion, PromptItem, Retention, ShownLines, TokenEstimator,
    TurnRange, UsageSignalOptions, code_heading, tool_output_source,
};
use crate::discovery::{CallDiscovery, DiscoveryWarning};
use crate::docs::{DocViewTypes, DocsRuntime};
use crate::ending::{Ending, EndingRole};
use crate::fault::{FaultLatch, panic_message};
use crate::fsm::{FsmPosition, FsmSpec};
use crate::git;
use crate::hooks::{HookAgent, HookFailure, HookRuntime};
use crate::limits::{
    AgentLimits, CeilingLatch, FatalFault, RunLimits, RunSpend, TurnErrorType, TurnOutcome,
    resolve_run_limits,
};
use crate::loopguard::LoopGuardConfig;
use crate::memories::{MemoriesRuntime, MemoryRegistry, MemoryScope, MemoryStrategy};
use crate::message_log::finish_reason_token;
use crate::model::{
    FinishReason, LoopAborts, Message, ModelClient, ModelError, ModelResponse, ToolCall,
    ToolDefinition,
};
use crate::modules::{
    CapabilityModules, HistorySetup, InheritedModules, Module, ModuleIdMint, ModuleIds, ModuleKind,
    ModuleResolveCtx, ModuleSet, Refresh, TransferPlan, TransferReport,
};
use crate::persistence::{self, AgentPersistence, PersistenceSetup};
use crate::prompts::{
    self, AssignedIssueView, AutoloadView, CodeHeadingView, EndingView, FixBriefContext,
    MemoriesView, MergeBriefContext, ModuleView, NumberedItem, ReadFileView, ReviewBriefContext,
    ReviewChangesView, ReviewRecordView, SkillView, SpawnableAgentView, SystemContext, TasksView,
};
use crate::sandbox::{
    self, OperationId, PROGRAM_CALL_ID_PREFIX, ProgramResult, SandboxError, SandboxLimits,
    SandboxOutcome, run_program,
};
use crate::skills::{ReadRecord, SkillLibrary, SkillsRuntime};
use crate::subagents::{
    AgentCtx, AgentReturn, ChildHandle, ParentWait, Scheduler, SlotHold, SubagentConfig,
    WaiterToken,
};
use crate::tasks::TasksRuntime;
use crate::telemetry::Emitter;
use crate::telemetry::plural;
use crate::tools::VisionContext;
use crate::tools::{
    ARCHIVE_THREAD_TOOL, AgentFacts, AgentStatusData, ApiData, COMPACT_TOOL, EVICT_FILE_VIEW_TOOL,
    EXEC_TOOL, FORK_TOOL, OffloadPolicy, READ_FILE_TOOL, READ_SKILL_TOOL, ReadFileTool, ReadPolicy,
    ReclaimData, SEND_MESSAGE_TOOL, SHELL_TOOL, SPAWN_SUBAGENT_TOOL, ShellRunner,
    SubagentHandleData, SubagentResultData, TRANSITION_STATE_TOOL, Tool, ToolContext, ToolFailure,
    ToolOutcome, ToolRegistry, WAIT_FOR_ISSUE_TOOL, WAIT_FOR_SUBAGENTS_TOOL, is_board_tool,
    is_memory_tool, is_subagent_tool, is_task_tool, parse_archive_ranges, parse_compact_request,
    parse_evict_path, read_policy, real_shell, saturating_u32, saturating_u64, shell_offload,
    ungranted_tools,
};
use crate::turn_timing::TurnTimer;
use crate::vision::VisionSupport;

/// The [slot](GgSlotBinding) name a [handoff compaction](crate::compaction::CompactionStrategy::is_handoff)'s second
/// client is bound under, so the tokens it spends are attributed to the compaction model rather
/// than to the agent profile whose thread it condensed.
const COMPACTION_SLOT: &str = "compaction";

/// The [`SessionEnded`](GgTelemetryKind::SessionEnded) status for a session that ended because the
/// **model** said it was done — a tool-calling turn that requested no tools, or, under
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE), a program that called
/// [`finish`](crate::sandbox::FINISH_FUNCTION).
///
/// Named rather than spelled out at each of its sites because it is also what the issue-review
/// verdict tests a child agent against: one string with several readers is one string that must not
/// be typed once per reader.
const STATUS_COMPLETED: &str = "completed";

/// The [`SessionEnded`](GgTelemetryKind::SessionEnded) status for an agent that took every turn its
/// [ceiling](RunLimits::max_turns) allowed without finishing.
const STATUS_EXHAUSTED: &str = "exhausted";

/// The [`SessionEnded`](GgTelemetryKind::SessionEnded) status for a run that spent its wall-clock
/// budget ([`RunLimits::max_runtime`]).
const STATUS_TIMED_OUT: &str = "timed_out";

/// The [`SessionEnded`](GgTelemetryKind::SessionEnded) status for an agent stopped by one of three
/// [execution ceilings](RunLimits) — consecutive errors, the recent error rate, or accumulated cost.
///
/// The turn and runtime ceilings keep the host's own statuses ([`STATUS_EXHAUSTED`],
/// [`STATUS_TIMED_OUT`]) even though they record the same [breach](GgLimitBreach). Which ceiling
/// stopped a run is answered by the breach, not by the status.
///
/// It is **not** a failure status ([`is_failure_status`]): a spent ceiling is the operator's bound,
/// not the agent failing at its work, which is exactly why `exhausted` and `timed_out` are excluded
/// too.
const STATUS_LIMIT_EXCEEDED: &str = "limit_exceeded";

/// The [`SessionEnded`](GgTelemetryKind::SessionEnded) status for a run an **operator
/// killed** — the host raised the [cancellation sentinel](crate::cancel) and every agent
/// wound down at its next turn boundary.
///
/// Like the ceiling statuses beside it, and unlike the two error statuses, this is **not**
/// a failure ([`is_failure_status`]): a run a human stopped has not failed at anything. It
/// is kept distinct from all of them because it is the one terminal status that says
/// nothing whatsoever about the model — it is the only one caused entirely from outside
/// the run.
const STATUS_CANCELED: &str = "canceled";

/// The [`SessionEnded`](GgTelemetryKind::SessionEnded) status for a session a model
/// turn failed in — the model was reached and did not deliver a usable turn.
///
/// The far side of the request is the whole of it: a provider that refused, that rejected the
/// request, that answered with a body gg could not parse, or that served replies gg's [loop
/// detection](crate::loopguard) threw away until the client's retries ran out. gg's own machinery
/// failing is never any of those, and ends the agent on [`STATUS_INTERNAL_ERROR`] instead — a
/// run's output is attribution data, and our defect filed in the model's column is not a degraded
/// measurement but a wrong one that reads like a real one.
///
/// That holds for a request gg broke *under* as much as for one it never made: a turn that failed
/// while the run's [fault latch](crate::fault) was already up is not evidence about the model
/// either, so this status is one of the three the [ending attribution](attribution) upgrades. The
/// far side of the request is only the whole of it on a run that is still whole.
const STATUS_MODEL_ERROR: &str = "model_error";

/// The [`SessionEnded`](GgTelemetryKind::SessionEnded) status for a session whose
/// **credential** was refused. Distinct from [`STATUS_MODEL_ERROR`] because it is an
/// operator fault: with [`STATUS_INTERNAL_ERROR`] it is one of the two non-launch statuses that
/// leave no run to score, and the process says so (see [`SessionOutcome`]).
///
/// It disqualifies the run on the *root's* ending alone, where a gg defect does so from anywhere
/// in the tree. The asymmetry is deliberate and is the difference between a fault of the
/// operator's and a fault of ours: a subagent whose credential was refused took no turns, so it
/// contributed nothing to the tree the run leaves behind, and the run around it is still a run the
/// model produced.
const STATUS_AUTH_ERROR: &str = "auth_error";

/// The [`SessionEnded`](GgTelemetryKind::SessionEnded) status for a session one of the run's
/// [hooks](crate::hooks) broke in — a script that exited non-zero, or printed a decision gg could
/// not read.
///
/// A failure of the operator's own machinery rather than of the model or of gg, and the only tool-
/// layer condition that stops a run outright. It has to: a gate that did not judge cannot be
/// treated as having passed or failed, and there is nobody to hand the question to — the model
/// never asked for the hook and cannot fix it.
const STATUS_HOOK_ERROR: &str = "hook_error";

/// The [`SessionEnded`](GgTelemetryKind::SessionEnded) status for an agent whose
/// [compaction] could not give it back a window to work in — a boundary fired,
/// the thread restarted from the summary, and the window was **still** at the trigger, for one more
/// attempt than the capability's [`maxRetries`](crate::compaction::CompactionPolicy::max_retries)
/// allowed.
///
/// It **is** a failure ([`is_failure_status`]), and that is the judgement rather than an accident of
/// which list it was written into. A spent ceiling is a bound the operator chose and the agent ran
/// into honestly; this is the run's own backstop failing at the one thing it exists to do. Nothing
/// downstream should read it as a configuration that merely ran out of room, because the thread it
/// leaves behind is one no further turn could have advanced.
///
/// Whose failure it is, is deliberately left unstated — it is neither the model's turn nor gg's
/// defect, and both of those statuses would be a lie about a run that a study reads by status. What
/// produced it is a summary that came back no smaller than the thread it replaced, or a pinned
/// prefix that alone fills the window, and which of those it was is on the compaction records the
/// run already carries.
const STATUS_COMPACTION_FAILED: &str = "compaction_failed";

/// The [`SessionEnded`](GgTelemetryKind::SessionEnded) status for a session **gg itself** broke in,
/// in either of the two ways it can: gg reached a state [launch
/// validation](crate::validate::validate_launch) proves
/// is unreachable — an agent whose [profile](GgAgentConfig) this run does not declare — or gg's own
/// machinery failed under a turn, which is a [fatal sandbox fault](FatalFault): a guest artifact
/// that will not compile or instantiate, the wasm host itself falling over, or a program gg read,
/// accepted, and then could not prepare for its guest.
///
/// Held apart from the three faults above it by **whose** failure it is, which is the only division
/// a run's readers can act on. [`STATUS_AUTH_ERROR`] and [`STATUS_HOOK_ERROR`] are a refused
/// credential and an operator's script; [`STATUS_MODEL_ERROR`] is a turn the provider did not
/// deliver. This one is ours, and it is ours whether or not a model was in the middle of something:
/// an undeclared profile is reached before anything is asked of a model, while a sandbox fault
/// lands on a program a model wrote and gg then could not run.
///
/// **Everything gg's own machinery breaks in reports here**, and nothing gg breaks in is reported
/// as anybody else's. A [fatal fault](FatalFault) is not a model turn that failed — the model
/// answered, and the answer was never run — so ending it on [`STATUS_MODEL_ERROR`] would file our
/// defect in the model's column of the attribution data the run exists to produce. A run scored
/// against a model has to be a run that model produced, and a fault of ours recorded under its name
/// is not a degraded result but a wrong one that reads like a real one.
///
/// Which is why no ending path decides that for itself: every terminal status is stated through the
/// [attribution seam](attribution), which turns *any* failure ending taken on a run gg had already
/// broken into this one. A rule that held only where somebody remembered it is how an agent's
/// ending came to say `model_error` on a run whose own turn record said gg.
///
/// It **ends** the agent's loop instead of carrying on because in neither family is there anything
/// to carry on as. The only substitute for a profile is some *other* profile, and running an agent
/// under capabilities, a model and an execution mode nobody asked for — while the record attributes
/// every turn of it to the profile that *was* asked for — corrupts that same attribution data. A
/// fatal fault is a property of the build rather than of the turn, so there is nothing to retry
/// into either: every further turn would fail identically, and the run would burn to its deadline
/// proving it. A wrong answer that reads as a real one is worse than no answer, so gg refuses to
/// produce one.
///
/// **Whichever agent ends this way, the run ends with it.** Every site that raises it fires for any
/// agent — an issue agent, a reviewer, the merge agent, a spawned child — and a defect that struck
/// one of those is no more the model's doing than one that struck the root. So the agent that meets
/// it raises the run's [fault latch](crate::fault), every other agent stops itself at its next turn
/// boundary ([`Agent::stop_on_fault`]), and the session ends here and exits non-zero
/// ([`SessionOutcome`]) however the root's own loop happened to end.
///
/// The alternative — a failed node in a session that carries on and is scored — is the same wrong
/// answer this status exists to prevent, one level down. A subagent stopped mid-task is work the
/// run was supposed to contain and does not, or work the rest of the tree then built around a hole;
/// a reviewer that never rendered a verdict is an issue merged without the gate its filer asked
/// for. The tree that comes back is not the tree that configuration produces, and nothing
/// downstream — not `core`, not a reviewer, not a comparison against another arm — can tell it from
/// one that is. That is worse than losing the run: a missing run is visible, and a plausible wrong
/// one is not.
///
/// This is why it is not recorded as [`STATUS_CANCELED`] despite winding the run down through the
/// same machinery. A canceled run is a human's decision and says nothing about anybody's
/// correctness; filing our own defect there would hide it in the one field a study reads to find
/// out why runs stop.
const STATUS_INTERNAL_ERROR: &str = "internal_error";

/// Whether a terminal loop status means the agent failed (as opposed to finishing,
/// exhausting its turns, or timing out) — the error statuses above.
pub(crate) fn is_failure_status(status: &str) -> bool {
    status == STATUS_MODEL_ERROR
        || status == STATUS_AUTH_ERROR
        || status == STATUS_HOOK_ERROR
        || status == STATUS_COMPACTION_FAILED
        || status == STATUS_INTERNAL_ERROR
}

/// How one gg session ended, at the granularity the **process exit code** carries.
///
/// A session that ran to a natural end exits `0`, with the real outcome carried in the telemetry
/// stream, and the three outcomes below are the whole of what the code says. Every terminal status
/// maps onto exactly one of them:
///
/// - [`Ran`](Self::Ran) — [`STATUS_COMPLETED`], the turn ceiling's [`STATUS_EXHAUSTED`], the
///   wall clock's [`STATUS_TIMED_OUT`], the other three ceilings' [`STATUS_LIMIT_EXCEEDED`], an
///   operator's [`STATUS_CANCELED`], a [`STATUS_MODEL_ERROR`], a broken script's
///   [`STATUS_HOOK_ERROR`], and a backstop that stopped working
///   ([`STATUS_COMPACTION_FAILED`]) — **unless** a ceiling was breached or gg broke;
/// - [`LimitExceeded`](Self::LimitExceeded) — any agent of the run breached one of the five
///   [ceilings](RunLimits), whatever status that agent's own loop ended under;
/// - [`HarnessError`](Self::HarnessError) — a launch failure, [`STATUS_AUTH_ERROR`] as the
///   **root's** ending, or [`STATUS_INTERNAL_ERROR`] wherever in the tree the defect behind it was
///   raised.
///
/// Written out rather than illustrated with a few, because a partial list here reads as the whole
/// rule, and a reader who found their status missing from it would have to guess which side of the
/// exit code it falls on.
///
/// **A gg defect outranks a breached ceiling.** A run that both spent a safeguard and walked into
/// one of our own defects is a [`HarnessError`](Self::HarnessError), because the two facts are not
/// comparable: a ceiling stopped a measurement, and a defect means there was no measurement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionOutcome {
    /// A session was driven to a [`SessionEnded`](GgTelemetryKind::SessionEnded) inside every
    /// ceiling it armed. The process exits `0`; the session's status is in the telemetry.
    Ran,
    /// **Any agent of the run** ended on a breached [ceiling](RunLimits) — its turn budget, the
    /// run's wall-clock budget, the run's spend, or either error ceiling. The process exits
    /// [`EXIT_LIMIT_EXCEEDED`](test_cabinet_core::gg::EXIT_LIMIT_EXCEEDED), and `core` records a
    /// run state of its own that is published as a per-model statistic and never retried.
    ///
    /// It is read off the run's [ceiling latch](crate::limits::CeilingLatch) rather than off the
    /// root's ending, on the same reasoning a gg defect is read off the fault latch: the session's
    /// status is the root's, so a subagent that spent its budget, or an issue implementer that
    /// breached after the root had already finished, would otherwise leave the run exiting as one
    /// that ran to a natural end. A ceiling is a safeguard nobody expects to reach, so which agent
    /// reached it does not change what the run is.
    ///
    /// Unlike the other two, nothing about the run's conduct differs because of this: the breaching
    /// agent was already ended by its own ceiling and every other agent went on working. Only the
    /// exit code is new.
    LimitExceeded,
    /// Whatever happened, it was **ours**, so there is no run to score: the invocation could not
    /// launch a session at all (no root profile, no model bound to it, or a client that could not
    /// be resolved), the **root's** model calls were refused because the run's credential was
    /// rejected ([`STATUS_AUTH_ERROR`]), or **any agent of the run** walked into a gg defect
    /// mid-session ([`STATUS_INTERNAL_ERROR`]). The process exits `1`, so `core` records a
    /// harness error rather than a scoreable run — none of the three is the model's doing, and
    /// scoring any of them would blame a model for our mistake.
    ///
    /// The credential is read off the root because the session's status is the root's ending, and a
    /// subagent that never got a client contributed nothing to the tree. A gg defect is read off
    /// the run's [fault latch](crate::fault) instead, because it is the *tree* that is spoiled by
    /// one: an agent our own machinery stopped leaves work missing from a run whose record does not
    /// say so, and comparing that against a clean run is comparing a measurement with a mistake.
    HarnessError,
}

/// The stable id of the **root** agent — the top of the [subagent
/// tree](https://docs.testcabinet.ai/gg/subagents/), created from the run invocation. A
/// single-agent run has only this agent; a spawned subagent gets a generated id beneath it, and a
/// [successor](Agent::succeeding) a fresh one at the same depth.
pub const ROOT_AGENT_ID: &str = "root";

/// One node in gg's [subagent tree](https://docs.testcabinet.ai/gg/subagents/): the unit the
/// [turn loop](Self::drive) drives.
///
/// An agent carries its **identity** in the tree — a stable [`id`](Self::id), its spawner's
/// [`parent_id`](Self::parent_id) (`None` for the root), its [`depth`](Self::depth), and the
/// [`profile`](Self::profile_id) it runs under. The identity is what agent-tagged
/// [telemetry](crate::telemetry::Emitter::for_agent) streams, so the console can reconstruct
/// who-spawned-whom and account usage per slot; its live lifecycle (running → blocked → done/
/// failed) is streamed as [`AgentStatus`](GgTelemetryKind::AgentStatus) telemetry rather than kept
/// on the struct.
///
/// The agent's *resources* — its [context model](ContextModel), its [toolset](ToolRegistry),
/// and its [module set](crate::modules::ModuleSet) — are constructed **per agent** by the
/// [orchestrator](Orchestrator) and handed to [`drive`](Self::drive) by [`run_agent`]. Keeping
/// resource construction in the orchestrator (rather than the struct) is the multi-agent seam: a
/// spawn builds a child agent's context/toolset/runtimes the same way the root's are built, then
/// drives it identically.
#[derive(Clone)]
pub struct Agent {
    /// The agent's stable id in the tree ([`ROOT_AGENT_ID`] for the root).
    pub id: String,
    /// The id of the agent that spawned this one, or `None` for the root.
    pub parent_id: Option<String>,
    /// The agent's depth in the tree: `0` for the root, `parent.depth + 1` for a child.
    pub depth: usize,
    /// The [id](GgAgentConfig::id) of the agent profile this agent runs under — the key its
    /// capabilities, model binding, and system prompt resolve from. The root runs under the
    /// set's [root profile](GgCapabilitySet::root); a spawned child under whichever profile its
    /// spawner named. It is also what the [per-profile accounting](SlotAccounting) and the
    /// `AgentSpawned`/`SlotUsage` telemetry key on, so a run's spend splits by profile
    /// identity rather than by a display name two profiles may share.
    pub profile_id: String,
    /// Where this instance sits in a [machine](crate::fsm), when one is driving it — the machine
    /// and the state, which together decide the transition call this instance is offered and the
    /// targets that call may name.
    ///
    /// `None` for every ordinary agent, which is almost all of them. It is set when [`run_agent`]
    /// enters an [FSM shell](crate::fsm::is_shell), and carried — re-pointed at the new state —
    /// across each transition. It is deliberately *not* inherited by anything this agent spawns: a
    /// subagent is doing a job for the state, not standing in it.
    pub fsm: Option<FsmPosition>,
}

impl Agent {
    /// The **root** agent for a run: [`ROOT_AGENT_ID`], no parent, depth `0`, running under
    /// `profile` — the [id](test_cabinet_core::gg::GgAgentConfig::id) of the set's
    /// [root profile](GgCapabilitySet::root), passed in rather than assumed to be
    /// [`ROOT_PROFILE_ID`](test_cabinet_core::gg::ROOT_PROFILE_ID) so a set whose first profile is
    /// some other one still resolves its own model, capabilities, and prompt.
    pub fn root(profile: &str) -> Self {
        Self {
            id: ROOT_AGENT_ID.to_string(),
            parent_id: None,
            depth: 0,
            profile_id: profile.to_string(),
            fsm: None,
        }
    }

    /// This agent as it stands at the **entry state** of `machine`: the same instance, now running
    /// the entry state's [agent profile](crate::fsm::FsmStateSpec::agent_id) and holding the position
    /// it occupies.
    ///
    /// An [FSM shell](crate::fsm::is_shell) has no turns of its own, so an agent that was going to
    /// run one *becomes* its first state rather than spawning a child to do it. That is what makes
    /// an FSM agent indistinguishable from an ordinary one to whoever put it to work: one id in the
    /// tree, one scheduler slot, one return value.
    fn entering(self, machine: &Arc<FsmSpec>) -> Self {
        let position = machine.entry_position();
        Self {
            profile_id: position.agent_id().to_string(),
            fsm: Some(position),
            ..self
        }
    }

    /// The **successor** this instance hands off to: a fresh id, this instance as its parent, the
    /// same depth, and the profile and machine position the [handoff](Handoff) named.
    ///
    /// The depth is deliberately not incremented. Succession is not delegation — the
    /// [depth cap](SubagentConfig::max_depth) exists to bound the delegation *tree*, and a long
    /// machine that exhausted it would be measuring the wrong thing. The id, on the other hand, is
    /// deliberately fresh: a new id gives the successor its own
    /// [message pool](crate::telemetry), so its stream re-states every context message it
    /// references and is self-contained, which is exactly what the console's per-agent reduction
    /// needs.
    fn succeeding(&self, id: String, profile: String, fsm: Option<FsmPosition>) -> Self {
        Self {
            id,
            parent_id: Some(self.id.clone()),
            depth: self.depth,
            profile_id: profile,
            fsm,
        }
    }
}

/// The per-slot (and per-model-within-slot) usage/cost accounting the orchestrator owns.
///
/// A gg run spans **several models** — subagents can run on different, possibly cross-provider,
/// [slots](GgSlotBinding) than the parent — so usage and cost are accumulated per slot rather
/// than as one figure for one model (this is why a gg run cannot be a single point on the
/// per-model metric graphs; see the [multi-model](https://docs.testcabinet.ai/gg/configurations/#model-slots)
/// design). Each agent's loop reports its total tagged with the slot it ran on
/// ([`LoopEnd::profile_id`]); the orchestrator [`record`](Self::record)s it here, keyed by
/// `(slot, model)`, and emits one [`SlotUsage`](GgTelemetryKind::SlotUsage) rollup per key.
#[derive(Default)]
struct SlotAccounting {
    /// One entry per `(slot, model)` the run touched, in first-seen order.
    entries: Vec<SlotAccountEntry>,
}

/// One `(profile, model)` rollup in the [`SlotAccounting`].
struct SlotAccountEntry {
    /// The [profile](GgAgentConfig::id) this rollup accounts for.
    profile_id: String,
    /// The model id (within the profile) this rollup accounts for.
    model_id: String,
    /// The tokens accumulated on this profile/model.
    tokens: TokenCounts,
    /// The cost accumulated on this profile/model, when any turn reported one.
    cost: Option<Cost>,
}

impl SlotAccounting {
    /// Add one agent's usage/cost to the `(profile, model)` rollup, summing into any existing
    /// entry (so several agents on the same profile/model accumulate) or starting a new one.
    fn record(
        &mut self,
        profile_id: &str,
        model_id: &str,
        tokens: TokenCounts,
        cost: Option<Cost>,
    ) {
        if let Some(entry) = self
            .entries
            .iter_mut()
            .find(|entry| entry.profile_id == profile_id && entry.model_id == model_id)
        {
            entry.tokens = add_counts(entry.tokens, tokens);
            entry.cost = add_cost(entry.cost, cost);
        } else {
            self.entries.push(SlotAccountEntry {
                profile_id: profile_id.to_string(),
                model_id: model_id.to_string(),
                tokens,
                cost,
            });
        }
    }

    /// One [`SlotUsage`](GgTelemetryKind::SlotUsage) rollup per recorded `(profile, model)`, in
    /// first-seen order — the per-profile cost breakdown the console renders.
    fn slot_usage_events(&self) -> Vec<GgTelemetryKind> {
        self.entries
            .iter()
            .map(|entry| GgTelemetryKind::SlotUsage {
                profile_id: entry.profile_id.clone(),
                model_id: entry.model_id.clone(),
                tokens: entry.tokens,
                cost: entry.cost,
            })
            .collect()
    }
}

/// Build the client [binding](GgSlotBinding) for the [agent profile](GgAgentConfig) whose
/// [id](GgAgentConfig::id) is `profile` in `set`, or an error naming what is wrong. The seam every
/// agent resolves its client through: the root resolves the [root profile](GgCapabilitySet::root);
/// a spawned child resolves whichever profile its spawner named.
///
/// A [`GgSlotBinding`] is still the [factory](ClientFactory)'s input DTO (it keys purely on the
/// model id); its `slot` field carries the profile **id** so the resolved model is attributed to
/// the right profile in telemetry — the display name is not unique, so keying attribution on it
/// would fold two profiles that happen to share a name into one line of spend. Its
/// [prompt-cache lifetime](GgAgentConfig::prompt_cache_ttl) and its
/// [loop-detection policy](GgAgentConfig::loop_detection) carry this profile's choices through to
/// the client built for it — the second of which also decides that client's **transport**, since a
/// detector can only watch a reply that arrives in pieces.
///
/// Naming an [FSM shell](crate::fsm::is_shell) resolves the
/// [entry state's](GgCapabilitySet::dispatched_agent) profile instead, model and per-agent levers
/// alike: a machine takes no turns, so it has no model, and the agent dispatched onto it *becomes*
/// its entry state before its first one. Binding the shell would mean demanding a model of every
/// machine and then discarding the client built from it — which is also why the returned binding
/// names the state's profile: it is the profile whose turns are about to be charged to it.
///
/// The [resolution](GgCapabilitySet::dispatched_agent) is what decides *which* profile this is, and
/// it never answers with a profile other than the one asked for — an id nothing declares comes
/// back as an error naming it, and is passed straight through here. There is deliberately no second
/// lookup by id: the agent this returns a binding for is the very agent the resolution handed
/// back, so the id in the binding and the model in it cannot describe two different profiles.
fn profile_binding(set: &GgCapabilitySet, profile: &str) -> Result<GgSlotBinding, String> {
    let agent = set
        .dispatched_agent(profile)
        .map_err(|err| format!("{err}; there is no model to run"))?;
    let profile_id = agent.slug.as_str();
    let model_id = agent.resolved_model_id().ok_or_else(|| {
        format!("the `{profile_id}` agent profile has no model bound; there is no model to run")
    })?;
    Ok(GgSlotBinding::new(profile_id, model_id)
        .with_prompt_cache_ttl(agent.prompt_cache_ttl)
        .with_loop_detection(agent.loop_detection))
}

/// Whose failure stopped a board [issue](crate::board) from being dispatched, and therefore what it
/// costs beyond the issue.
///
/// The same division [`resolve_agent_client`] draws one step later, drawn here because a dispatch
/// fails before any agent exists to end: gg's defect disqualifies the run, an operator's missing
/// credential fails the issue and leaves the run to carry on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DispatchFault {
    /// gg's own: an issue with no assignee, or an assignee profile this run does not declare or
    /// binds no model to. Every one of them is refused by the board's own tools and by
    /// [launch validation](crate::validate::validate_launch), so reaching one means gg read its
    /// configuration two
    /// different ways.
    Gg,
    /// The run's credential was refused for the assignee's model. Nothing is broken: a key is
    /// supplied rather than fixed.
    Credential,
}

/// A profile that could not be resolved to a [client](ModelClient) **mid-session**, and the status
/// the agent's loop therefore ends on.
///
/// The status travels with the diagnostic because the two are one decision: a caller that reported
/// the failure and then chose a status separately is a caller that can report one fault and record
/// another.
struct UnresolvedProfile {
    /// The terminal status this failure ends the agent on — whose failure it was.
    status: &'static str,
    /// The resolution's own words, for the `error` line the caller writes around them.
    detail: String,
}

impl UnresolvedProfile {
    /// How the `error` line ends: what this failure costs beyond the agent that met it.
    ///
    /// The two halves of the split cost different amounts, so a single sentence for both would be
    /// wrong for one of them. gg's defect takes the whole run down; a refused credential ends this
    /// agent and leaves the run to carry on, which is a thing an operator reading the stream mid-run
    /// needs to be told rather than left to infer from the status word.
    fn consequence(&self) -> &'static str {
        if self.status == STATUS_INTERNAL_ERROR {
            "this agent's loop ends here rather than continuing as its predecessor, and the run \
             ends with it: gg's own defect had a hand in whatever tree this run would leave behind, \
             and a tree like that cannot be scored against the model"
        } else {
            "this agent's loop ends here rather than continuing as its predecessor. The run's other \
             agents carry on: a credential is the operator's to supply, and a run that lost one \
             agent to a refused key is still a run the model produced"
        }
    }
}

/// The [client](ModelClient) an agent standing up under `profile` will take its turns on, and —
/// when there is none — [whose failure that is](UnresolvedProfile).
///
/// Its caller is the [succession](Handoff), standing a successor up on a profile a launch check has
/// already passed, and it cannot carry on without a client, so it ends the agent's loop. Which
/// status it ends it on is the whole reason this is a function rather than an inline resolution,
/// because the two failures behind it belong to different people:
///
/// * the run's **credential** was refused ([`STATUS_AUTH_ERROR`]) — the operator's, and reachable
///   in a healthy build: a run whose root binds a mock model launches with no credential at all,
///   and the first agent to bind a live one then finds there is none;
/// * anything else ([`STATUS_INTERNAL_ERROR`]) — a profile the set does not declare, a machine with
///   no readable entry state, a profile with no model bound.
///   [`validate_launch`](crate::validate::validate_launch) rejects every one
///   of those before a session starts, so meeting one here means gg's own validation was wrong
///   about the configuration it accepted.
///
/// The split decides more than a word in the record. The first ends this agent and leaves the run
/// to carry on; the second ends the **run**, because it is gg's defect and a tree gg broke while
/// producing cannot be scored (see [`crate::fault`]). Getting the two the wrong way round would
/// either discard a run over a missing key or score one gg had a hand in — which is why the status
/// and the diagnostic are decided together here rather than at the call sites.
///
/// Neither is [`STATUS_MODEL_ERROR`]: no request was made, so nothing the model did is in evidence,
/// and recording it against the model would put somebody else's fault in the model's column.
fn resolve_agent_client(
    orch: &Orchestrator,
    profile: &str,
    origin: &GgSessionAgentOrigin,
) -> Result<Box<dyn ModelClient>, UnresolvedProfile> {
    let binding = profile_binding(&orch.caps, profile).map_err(|detail| UnresolvedProfile {
        status: STATUS_INTERNAL_ERROR,
        detail,
    })?;
    orch.factory
        .client_for_agent(&binding, &AgentIdentity::agent(origin.clone()))
        .map_err(|err| UnresolvedProfile {
            status: if err.is_auth_failure() {
                STATUS_AUTH_ERROR
            } else {
                STATUS_INTERNAL_ERROR
            },
            detail: err.to_string(),
        })
}

/// The [profile id](GgAgentConfig::id) of the
/// [merge agent](PROJECT_MANAGEMENT_PARAM_MERGE_AGENT) `set` names, from the first profile that
/// configures one — the board is run-global, so its merge agent is too, and reading the first
/// declaration keeps a set that names it on a non-root profile working rather than silently
/// ignored.
///
/// Every profile that switches [project management](CAPABILITY_PROJECT_MANAGEMENT) on writes the
/// param, and one that does not is [refused](crate::validate::required_param) at its own locus, on
/// that profile: an accepted issue's branch has to be merged back, concurrent issues make a
/// conflicting merge an ordinary event, and gg nominates nobody to resolve one. Every declaration is
/// read even after one has answered, so a set with two boardless-looking profiles hears about both.
/// A profile that switches the capability off is owed nothing and still has what it wrote read.
pub(crate) fn merge_agent_id(
    set: &GgCapabilitySet,
    report: &mut crate::validate::LaunchReport,
) -> Option<String> {
    let mut named: Option<String> = None;
    for agent in &set.agents {
        let Some(capability) = agent.capability(CAPABILITY_PROJECT_MANAGEMENT) else {
            continue;
        };
        let declared = if capability.enabled {
            report.for_agent(&agent.slug, |report| {
                crate::validate::required_param(
                    &capability.params,
                    CAPABILITY_PROJECT_MANAGEMENT,
                    PROJECT_MANAGEMENT_PARAM_MERGE_AGENT,
                    report,
                )
            })
        } else {
            capability
                .params
                .get(PROJECT_MANAGEMENT_PARAM_MERGE_AGENT)
                .filter(|value| !value.is_null())
        };
        if named.is_some() {
            continue;
        }
        named = declared
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(str::to_string);
    }
    named
}

/// Run one gg session for `invocation`, emitting telemetry throughout, and report
/// whether it launched.
///
/// All outcomes — success, a misconfigured slot, a model error, or hitting a bound —
/// are reported as telemetry and end with a
/// [`SessionEnded`](GgTelemetryKind::SessionEnded). The function itself never panics;
/// a model error is a *run* outcome, not a launch failure (see [`SessionOutcome`]).
///
/// The `emitter` passed in is a base (unscoped) emitter; the root agent scopes it to the
/// [root agent](ROOT_AGENT_ID) so every event — including the launch-failure diagnostics — is
/// tagged with the root agent's id, and each spawned subagent scopes a fresh emitter from its own
/// id and its spawner's id.
pub async fn run(invocation: &GgInvocation, emitter: &Emitter) -> SessionOutcome {
    run_with_seams(
        invocation,
        emitter,
        SessionSeams::live(Some(invocation.session_id.clone())),
    )
    .await
}

/// The two inputs a gg session has that are **not** a function of its own state: the model call and
/// the shell.
///
/// Between them they are ~all of a run's wall clock and ~all of its cost, which is why they are the
/// two things gg's own suite substitutes.
///
/// **They travel together, in one parameter, on purpose.** A suite that scripted the model while
/// running the shell for real would run real installs against a scratch tree, and there must be no
/// way to assemble that by forgetting an argument. Hence one constructor taking
/// [both](Self::substituted) and no field-by-field builder — [`live`](Self::live) is a name for one
/// particular pair, not a way to fill in half.
pub struct SessionSeams {
    /// Where every agent's model client comes from.
    pub factory: Arc<dyn ClientFactory>,
    /// What starts a process for every command line the run reaches — the `shell` tool, a
    /// [responses-as-code](crate::sandbox) program's `system.shell(…)`, and a
    /// [hook's](crate::hooks) commands alike.
    pub shell: Arc<dyn ShellRunner>,
}

impl SessionSeams {
    /// Both seams live: real clients (the `TCAB_GG_FAKE_MODEL`/`mock` rules, else live OpenRouter)
    /// and real commands. What [`run`] uses, and the only shape a paid run has ever had.
    ///
    /// `session_key` is the run's session id, stamped on every live client the factory builds, so
    /// all of a run's agents share one sticky-session key and a subagent reuses the cached opening
    /// prefix a sibling already warmed instead of paying for it uncached.
    pub fn live(session_key: Option<String>) -> Self {
        Self::substituted(
            Arc::new(DefaultClientFactory::new(session_key)),
            real_shell(),
        )
    }

    /// Both seams named explicitly. The **only** constructor, so a recorded model can never be
    /// paired with a real shell by omission — the pairing has to be written down.
    ///
    /// gg's own suite uses it with a scripted factory and [`real_shell`], which is a deliberate
    /// pairing rather than an accidental one: a scripted model answering real commands in a
    /// `TempDir` is what the loop tests have always been.
    pub fn substituted(factory: Arc<dyn ClientFactory>, shell: Arc<dyn ShellRunner>) -> Self {
        Self { factory, shell }
    }
}

/// [`run`], but with an injectable [`ClientFactory`] so a test can drive the root and its
/// subagents from scripted offline clients — against the **real** shell, which is what a loop test
/// wants and what [`SessionSeams::substituted`] makes it state rather than assume.
#[cfg(test)]
pub(crate) async fn run_with_factory(
    invocation: &GgInvocation,
    emitter: &Emitter,
    factory: Arc<dyn ClientFactory>,
) -> SessionOutcome {
    run_with_seams(
        invocation,
        emitter,
        SessionSeams::substituted(factory, real_shell()),
    )
    .await
}

/// [`run`], with both [seams](SessionSeams) supplied. Owns the session frame: it scopes the root
/// emitter, emits [`SessionStarted`](GgTelemetryKind::SessionStarted), performs the launch checks
/// (slot validation, the [context windows](validate_model_windows) every bound model must carry,
/// and the root's client resolution — the [launch failures](SessionOutcome) a configuration can
/// cause), builds the [`Orchestrator`] — the one launch failure only gg can cause — drives the
/// [root agent](ROOT_AGENT_ID), then joins every spawned
/// subagent, streams the [per-slot](SlotAccounting) rollups the run accumulated, and emits the
/// terminal [`SessionEnded`](GgTelemetryKind::SessionEnded).
pub(crate) async fn run_with_seams(
    invocation: &GgInvocation,
    emitter: &Emitter,
    seams: SessionSeams,
) -> SessionOutcome {
    let SessionSeams { factory, shell } = seams;
    let set = &invocation.capability_set;

    // Scope the stream to the root up front, so every event (launch diagnostics included) is
    // attributed to it.
    let root_emitter = emitter.for_agent(ROOT_AGENT_ID, None);
    // Announce the configuration on the very first event: a console watching the stream
    // then knows which capabilities are live from the start, and can shape itself to
    // this run rather than offering every surface gg has.
    root_emitter.emit(GgTelemetryKind::SessionStarted {
        capability_set: Box::new(set.clone()),
    });

    // Launch check 1: **the refusal** — every configured value this run declares must be one gg can
    // honour exactly as written. Run here, after `SessionStarted` so a console still shows what was
    // attempted, and before any model client is resolved so a configuration typo is never masked by
    // a credential error. Every defect is named, not the first: an operator fixing a sweep's one
    // shared configuration document wants every typo in one pass.
    if let Err(defects) = crate::validate::validate_launch(invocation) {
        for defect in &defects {
            root_emitter.emit(log("error", defect.to_string()));
        }
        root_emitter.emit(session_ended("error"));
        return SessionOutcome::HarnessError;
    }
    // gg's own dotdir, stood up before the workspace is read. `.gg` is gg's bookkeeping rather than
    // the model's work — the capture journal, the hook scripts and the skills library live there,
    // and seeding excludes the whole of it from the run's git tree — so gg creates it rather than
    // asking the seeder to know what is inside it. The consequence the gate below depends on: the
    // `.gg/skills` a fresh capability set is authored with is a directory the workspace always
    // carries and leaves empty, which is exactly what a profile holding gg's built-ins alone wants.
    // A `dir` naming anywhere else is a promise about the *seeded* workspace and is judged as one.
    prepare_workspace_dotdir(&invocation.workspace_dir);
    // Launch check 2: **the workspace**. Two capabilities are configured in the document and
    // satisfied by the seeded workspace — the skills library an agent reads from, and the
    // specifications autoload promises it in full — and neither can be proved from the document
    // alone. The workspace is fully seeded before gg's process starts, so this still runs before the
    // first turn and before a token is spent; it is second because a configuration typo should not
    // be reported as a missing file.
    if let Err(defects) = crate::validate::validate_workspace(invocation) {
        for defect in &defects {
            root_emitter.emit(log("error", defect.to_string()));
        }
        root_emitter.emit(session_ended("error"));
        return SessionOutcome::HarnessError;
    }
    // Wherever the operator put it: the root is the first profile, not the profile whose id is
    // `root`.
    let root_profile = set.root_id().to_string();
    let binding = match profile_binding(set, &root_profile) {
        Ok(binding) => binding,
        Err(err) => {
            root_emitter.emit(log("error", err));
            root_emitter.emit(session_ended("error"));
            return SessionOutcome::HarnessError;
        }
    };

    // Launch check 3: every bound model must have a context window to be measured against. gg
    // has no fallback to guess one with, by design, so this is a hard launch failure rather
    // than a run with silently mis-scaled context accounting.
    if let Err(err) = validate_model_windows(set, &invocation.model_windows) {
        root_emitter.emit(log("error", err));
        root_emitter.emit(session_ended("error"));
        return SessionOutcome::HarnessError;
    }

    // Launch check 4: the root's model client must resolve (a missing credential fails here). A
    // subagent's client is resolved at spawn time instead, where a failure is reported to its
    // spawner rather than failing the whole process.
    let client = match factory
        .client_for_agent(&binding, &AgentIdentity::agent(GgSessionAgentOrigin::Root))
    {
        Ok(client) => client,
        Err(err) => {
            root_emitter.emit(log(
                "error",
                format!(
                    "could not resolve the `{root_profile}` agent (model `{}`): {err}",
                    binding.model_id
                ),
            ));
            root_emitter.emit(session_ended("error"));
            return SessionOutcome::HarnessError;
        }
    };

    // Resolve worktree isolation before building the orchestrator: when the run can produce a
    // worktree (a board issue's), make the workspace a git repo and
    // commit its baseline, reporting any git-absent/failure loudly on the root's stream so a later
    // issue that has to fall back to the shared tree does so with a reason on the record.
    let worktrees = resolve_worktrees(set, &invocation.workspace_dir, &root_emitter).await;

    // Build the orchestrator: the shared, cross-task state every agent (the root and each
    // subagent) is built and driven from — the scheduler, the per-slot accounting, the offered
    // model factory, the shared skills library and token estimator, the resolved ceilings, deadline
    // and shared spend, the worktree isolation state, and the spawned-task registry the session
    // joins on before ending.
    let mut launch_warnings = Vec::new();
    // The sink `build`'s resolvers report an unhonourable value into. It is **discarding**, and that
    // is the assertion rather than an oversight: launch check 1 above ran this same document through
    // the same resolvers with a collecting sink and refused the run if anything came back, so a
    // defect arriving here would mean gg read one configuration two different ways. `LaunchReport`
    // debug-asserts exactly that. Resolvers migrate off `launch_warnings` and onto this parameter
    // one at a time, each in the same change that teaches `validate_launch` to run it — which is
    // what makes the migration incremental rather than a flag day.
    let mut launch_report = crate::validate::LaunchReport::Discarding;
    let orch = match Orchestrator::build(
        invocation,
        emitter,
        factory,
        shell,
        worktrees,
        &mut launch_warnings,
        &mut launch_report,
    ) {
        Ok(orch) => Arc::new(orch),
        // The only ways building an orchestrator fails are **ours**: launch check 1 above read the
        // same machines and the same hook declarations and refuses a set carrying one that will not
        // build, so getting here means gg read one configuration two different ways. Said in those
        // words on the root's stream — nobody but us can act on it — and the session ends before its
        // first turn rather than coming up with an empty machine table (every FSM shell running as
        // an ordinary agent with no states while the record still calls it a machine) or a
        // declaration site with no hooks (every gate an operator configured silently absent).
        Err(err) => {
            root_emitter.emit(log(
                "error",
                format!(
                    "gg could not build this run ({err}), after its own launch validation accepted \
                     the configuration. This is a gg defect, not a problem with the configuration: \
                     the session ends here rather than running with part of what was declared."
                ),
            ));
            root_emitter.emit(session_ended("error"));
            return SessionOutcome::HarnessError;
        }
    };

    // Pin the run's fixed identity into the capture journal before the first turn: the prompt, the
    // resolved windows and modalities, the baseline commit, and the seeded files. It goes here —
    // rather than at teardown, where the resolved half of it is finally known — because the
    // sessions whose envelope is most worth having are the ones that never reach a teardown.
    // Anything it could not carry joins the launch warnings printed immediately below.
    record_session_seed(&orch, invocation);

    // The residual **advisory** channel, and it is now only that: what is said out loud about a
    // configuration gg is honouring exactly as written. A launch this far along has already been
    // proved honourable — anything gg could not act on refused it at launch check 1, before a token
    // was spent — so nothing on this channel is a fallback being announced, and nothing on it is a
    // value gg substituted something else for.
    //
    // What is left, and the whole of what may ever be added: a ceiling armed exactly as declared
    // whose window can only close on the last turn, a detector armed exactly as declared and
    // provably inert, and a capture journal that could not be opened (a debugging artifact, which
    // must not fail a paid run). An allowlist entry naming a real gg call this agent's capabilities
    // do not offer is the fourth, and it is *silent* rather than said — it grants nothing, it is not
    // a typo, and it is how one shared document describes several configurations.
    //
    // A new occupant of this channel needs the same defence: gg does what the document says, and the
    // line exists only because a reader would want to know. Anything else is a refusal.
    for warning in launch_warnings {
        root_emitter.emit(log("warn", warning));
    }
    // ...and the ceilings that *are* in force, including the turn ceiling's default, so "what was
    // this run bounded by?" is answerable from the operator log as well as from the summary.
    root_emitter.emit(log("info", orch.limits.armed_summary()));
    root_emitter.record_limits(recorded_limits(&orch.limits, orch.config.max_parallel));
    // ...and the [generation-loop detector](crate::loopguard), when the root agent armed one. Said
    // on the same terms as the ceilings above — a resolved configuration that
    // decides how the run behaves — and said only when it is armed, because a disarmed detector has
    // no configuration to name and every knob on the declaration is inert. Arming it also changes
    // the transport (a detector can only watch a reply that arrives in pieces), so this line is also
    // the operator's notice that this run streamed its responses.
    if let Some(config) = orch.loop_guard {
        root_emitter.emit(log("info", config.armed_summary()));
    }
    // ...and, for a code-mode run, the reply protocol in force — a resolved configuration that
    // decides how the run behaves, logged so an operator reading the stream does not have to infer
    // it from the shape of the requests.
    if orch.code.enabled {
        root_emitter.emit(log(
            "info",
            "responses-as-code: every request requires a `submit_program` tool call; the call's \
             `program` string is compiled exactly as sent, and assistant text beside the call is \
             recorded verbatim and never parsed for code.",
        ));
        // ...and the program library's retention, when any agent keeps one. It is on the same
        // footing as the two lines above — a resolved configuration a comparison toggles — and the
        // arm without it is otherwise indistinguishable in an operator's log from the arm with it
        // where no program ever reached back.
        if let Some(summary) = crate::programs::launch_summary(&orch.caps.agents) {
            root_emitter.emit(log("info", summary));
        }
    }

    // Warm the code sandbox, once per run and never from a subagent. A embedded interpreter
    // component takes ~0.7 s to compile on a many-core machine and several seconds on one core, and
    // that compile is paid exactly once per process *per language* — so starting it *here*,
    // concurrently with the first model request (which takes far longer), takes it off the first
    // code turn's critical path entirely. Off when the capability is off: a tool-calling run must
    // not pay for a sandbox it will never enter.
    //
    // One warm-up per **distinct language the configuration will actually drive**, not one for the
    // root's: the component cache is per language, so a subagent configured to a second language
    // would otherwise pay its whole cold compile inline on its first code turn — inside the turn
    // duration a cross-language study is comparing, which is the one place that cost must not land.
    let configured = if orch.code.enabled {
        program_languages(&orch.caps.agents)
    } else {
        BTreeSet::new()
    };
    let warming: Vec<_> = configured
        .into_iter()
        .map(|id| {
            let language = sandbox::language(id);
            (
                id,
                tokio::task::spawn_blocking(move || sandbox::precompile(language)),
            )
        })
        .collect();

    // Drive the root agent. Its inbox is unused (nothing spawns the root), but every agent owns
    // one for uniformity.
    let (_root_inbox_tx, root_inbox_rx) = mpsc::unbounded_channel();
    let root_agent = Agent::root(&root_profile);
    let end = run_agent(
        Arc::clone(&orch),
        root_agent,
        AgentRole::Root,
        client,
        root_inbox_rx,
        GgSessionAgentOrigin::Root,
    )
    .await;

    // Report the warm-up, and report it *here* rather than from a detached task, so a diagnostic can
    // never land after the terminal `SessionEnded`. Draining costs nothing: the compile is behind a
    // `OnceLock`, so by the time the root has finished it has either completed or was never
    // contended. A failure is only ever a defect in the embedded artifact — the first code turn
    // would have hit it too, and ended the session loudly — so this is a breadcrumb, not a
    // control-flow signal.
    //
    // The success case is logged too, with what the compile cost. It is the one measurement of this
    // machine's compile latency a reader of the stream can get without timing a turn from outside,
    // and it is core-count sensitive by a factor of seven — which is exactly the fact needed to
    // interpret a first program that took seconds. `None` means a code turn got there first and
    // paid the compile itself; that turn's own `CodeExecution` carries the figure instead.
    for (id, warming) in warming {
        let name = sandbox::language(id).display_name();
        match warming.await {
            Ok(Ok(Some(took))) => root_emitter.emit(log(
                "info",
                format!(
                    "the code sandbox's {name} interpreter component compiled in {} ms, off the \
                     first turn's critical path.",
                    took.as_millis()
                ),
            )),
            Ok(Ok(None)) => root_emitter.emit(log(
                "info",
                format!(
                    "a code turn compiled the sandbox's {name} interpreter component before the \
                     warm-up reached it, so that turn paid the compile itself; its \
                     `CodeExecution` carries what it cost."
                ),
            )),
            Ok(Err(err)) => root_emitter.emit(log(
                "warn",
                format!(
                    "the code sandbox's {name} interpreter component could not be warmed up ahead \
                     of the first turn: {err}"
                ),
            )),
            // The blocking task itself panicked. Reported and no more: the warm-up is off every
            // turn's critical path, so nothing has been broken *by* it — the same defect meets the
            // first code turn that compiles this language, where it is fatal (a
            // [host fault](FatalFault::HostFault) that ends the run), and a run whose agents never
            // write a program was never going to touch it at all.
            Err(join) => root_emitter.emit(log(
                "warn",
                format!(
                    "warming up the code sandbox's {name} interpreter component panicked ({join}); \
                     the first turn that writes a {name} program will meet the same defect and end \
                     the run as gg's."
                ),
            )),
        }
    }

    join_spawned_agents(&orch).await;

    // The session's terminal status. It is the **root's** ending — the root is the session, and
    // every other agent was working for it — unless gg broke somewhere in the tree, which
    // supersedes whatever the root went on to do.
    //
    // Read from the [latch](crate::fault) rather than from the root's own status, even though the
    // root ends [`STATUS_INTERNAL_ERROR`] itself in every case where it was still taking turns.
    // The case that is not covered by the root's status is precisely the one the ruling is about: a
    // subagent that broke *after* the root had already finished — a detached child, an issue agent
    // still working through the board — leaves the root's ending saying `completed`, and a session
    // that reported it would hand `core` a tree to score that a gg defect had a hand in producing.
    // Reading the latch here also makes the decision independent of when the fault landed, so the
    // race between a fault and the root's last turn cannot decide whether a run is scored.
    let fault = orch.fault.raised();
    let status = match fault {
        Some(_) => STATUS_INTERNAL_ERROR,
        None => end.status.as_str(),
    };
    // Say what broke on the **root's** stream, wherever in the tree it happened. The agent that met
    // the defect already reported it on its own, and every agent that wound down repeated it on
    // theirs; this is the run-level statement, and the run's own stream is where a reader who
    // starts from "why did this run fail?" is standing. Without it the answer would be a status
    // with no attribution — barely better than a run that lied.
    if let Some(fault) = fault {
        root_emitter.emit(log(
            "error",
            format!(
                "{fault}. The run ends `{STATUS_INTERNAL_ERROR}` and exits non-zero: a run gg's \
                 own machinery broke is not a run the model produced, so there is nothing here to \
                 score or to compare against a clean run."
            ),
        ));
    }

    // Stream the per-slot rollups the whole run accumulated (the root plus every subagent, keyed by
    // `(slot, model)`), so the console shows cost per slot even though the run spanned several
    // models, then close the session.
    root_emitter.emit(log("info", end.summary(status)));
    {
        let accounting = orch.accounting.lock().expect("slot accounting lock");
        for usage in accounting.slot_usage_events() {
            root_emitter.emit(usage);
        }
    }
    root_emitter.emit(log(
        "info",
        format!(
            "root agent `{ROOT_AGENT_ID}` (profile `{root_profile}`) {status}.",
            root_profile = end.profile_id,
            status = if end.status.is_failure() {
                "failed"
            } else {
                "done"
            }
        ),
    ));
    // Record the ceiling that stopped the **run**, which is the root's and only the root's: every
    // agent's `LimitExceeded` reaches the telemetry, but a subagent that spent its own error budget
    // did not end the run, and reporting its breach as the run's outcome would misattribute the one
    // field a study reads to find out why runs stop.
    root_emitter.record_limit_hit(end.limit.clone());
    // Close the session capture journal: write its mandatory terminating line and join the writer
    // thread, so the journal `core` collects and folds into the served record is complete. Reported
    // on the stream (never fatal) — a capture that degraded is a fact about the recording, not a
    // run result.
    //
    // Ahead of the summary rather than after it, now that every run captures: the summary must stay
    // the *last* event before `SessionEnded` — that adjacency is what lets `core` lift it without
    // re-parsing the stream — and a line emitted between the two would break it on every run rather
    // than on the rare configured one. Nothing here feeds the summary: the tracker folds typed
    // events, and this emits a `Log`.
    if let Some(recorder) = &orch.replay {
        // The modality half of the seed is only resolved now: a provider that refused an image
        // denied that model for the rest of the run, and the envelope has to state where the
        // session ended up rather than where it started. A no-op — not even a journal line — for
        // the overwhelming majority of runs, in which nothing was ever denied.
        recorder.record_resolved_modalities(captured_model_modalities(&orch, invocation));
        report_session_capture(recorder, &root_emitter);
    }

    // The last hook of the run. It can neither block nor insert — there is no session left to
    // affect — so what it is *for* is the reporting that has to happen after the work: a
    // notification, an upload, a teardown. Its own failure is logged and otherwise ignored, which
    // is the one place gg forgives a broken hook: stopping a run that has already finished would
    // change a completed run's recorded status over a check that was only ever going to observe it.
    if orch.session_hooks.has(GgHookEvent::SessionEnd) {
        let session_ctx = ToolContext::new(invocation.workspace_dir.clone())
            .with_agent(ROOT_AGENT_ID)
            .with_shell(orch.shell_for(&invocation.workspace_dir, &root_emitter));
        if let Err(failure) = orch
            .session_hooks
            .fire(
                GgHookEvent::SessionEnd,
                &HookAgent::new(ROOT_AGENT_ID, set.root_name()).of_kind(GgHookAgentKind::Root),
                json!({ "status": status }),
                &session_ctx,
                // The root's own output policy: a session hook is fired on the root's behalf, in
                // the root's workspace, so what it gets back of a command's output is what the root
                // gets back of one. gg has no policy of its own to lend it.
                // Mid-run: the launch pass read the root's `shell` through this same resolver.
                &shell_offload(set.root(), &mut crate::validate::LaunchReport::Discarding),
                &root_emitter,
            )
            .await
        {
            root_emitter.emit(log("warn", failure.to_string()));
        }
    }

    // Compute and emit the run's aggregatable session summary from the telemetry the run emitted
    // (the per-slot rollups above are now folded in), right before the terminal `SessionEnded`, so
    // `core` can lift it onto the run record and result aggregation need not re-parse the stream.
    let summary = root_emitter.finalize_summary(status);
    root_emitter.emit(GgTelemetryKind::SessionSummary {
        summary: Box::new(summary),
    });

    root_emitter.emit(session_ended(status));
    // A session whose credential was refused reached no model, so it is not a run
    // outcome to be scored — it is the same operator fault as a missing key, which
    // fails at launch check 2 above. A session gg's own defect ended is not one either, for the
    // stronger reason: whatever tree it left was produced by a run that stopped on *our* mistake,
    // and the model never got the chance the record would appear to be reporting on. Exit non-zero
    // for both so `core` records a harness error instead of collecting a tree and scoring it
    // against the model.
    //
    // The two are read off different things, and deliberately so. `auth_error` is the **root's**
    // ending: a subagent whose credential was refused is a failed agent in a session that is still
    // collected and scored. `internal_error` is the whole tree's, because `status` is (see the
    // latch read above): gg breaking anywhere disqualifies the run, and there is no version of the
    // ruling where a defect that happened to strike a subagent produces a scoreable run and the
    // same defect in the root does not.
    if end.status == STATUS_AUTH_ERROR || status == STATUS_INTERNAL_ERROR {
        // (The `auth_error` half can only be read on a healthy run: on a broken one the root's own
        // ending has already been attributed to gg, and the second condition is what fires.)
        return SessionOutcome::HarnessError;
    }
    // A run that spent one of its own [ceilings](crate::limits) exits on a code of its own, so the
    // host records it apart from a session that ran to a natural end and never retries it: a
    // second attempt on the same configuration reaches the same bound.
    //
    // Read off the run's ceiling latch rather than the root's `limit` for the reason the fault is
    // read off its latch: the session's status is the root's, and a subagent that spent its turn
    // budget or an issue implementer that breached after the root had finished would otherwise
    // leave the run exiting as one that finished. It is read *after* the two conditions above
    // because a defect of ours outranks a ceiling — a ceiling stopped a measurement, and a defect
    // means there was none.
    if orch.ceiling.raised().is_some() {
        return SessionOutcome::LimitExceeded;
    }
    SessionOutcome::Ran
}

/// Join every agent task the run spawned (transitively), and **latch** any of them that did not come
/// back.
///
/// The root released its slot inside [`run_agent`], so cap-limited children that were waiting can
/// now finish; a completed task has already registered any children it spawned, so draining the
/// registry to empty joins the whole tree.
///
/// A task that did not complete panicked somewhere [`run_agent`]'s own [teardown](AgentTeardown)
/// does not cover — outside the driving frame entirely, which is the sliver before the teardown
/// exists and the teardown itself — so nothing latched it and nothing said which agent it was. That
/// is what this is the backstop for. It can wake nobody, since the join is the last thing the
/// session does; what it does is stop a run gg's machinery broke in from being reported as one the
/// model produced, which is decided by the [latch](crate::fault) read immediately after it. A run
/// that already faulted keeps its first diagnostic — the cause, rather than this consequence.
///
/// A join error that is *not* a panic is a task the runtime cancelled or dropped, which gg never
/// does to an agent; it is latched too, and said in its own words, because an agent whose work is
/// missing from the tree disqualifies the run however it went missing.
async fn join_spawned_agents(orch: &Orchestrator) {
    loop {
        let task = orch.tasks.lock().expect("subagent tasks lock").pop();
        match task {
            Some(task) => {
                if let Err(join) = task.handle.await {
                    let detail = match join.try_into_panic() {
                        Ok(payload) => format!(
                            "its task panicked outside its turn loop: {}",
                            panic_message(&*payload)
                        ),
                        Err(join) => format!("its task never ran the agent to an ending: {join}"),
                    };
                    orch.fault.in_agent(&task.id, &task.profile_id, detail);
                }
            }
            None => break,
        }
    }
}

/// Start [session capture](crate::capture) for this run, opening the
/// [journal](test_cabinet_core::gg_session_journal::GG_SESSION_JOURNAL_PATH) under the run workspace.
///
/// Called for **every** run: capture is not gated on a capability, because pooling made it cost
/// well under a megabyte and an opt-in capture is never armed for the run that surprises you.
///
/// A journal that cannot be opened is a launch **warning**, not a failure: the run proceeds without
/// capture, because a debugging artifact must never be the reason a paid run does not happen.
fn start_session_capture(
    invocation: &GgInvocation,
    limits: &RunLimits,
    warnings: &mut Vec<String>,
) -> Option<Arc<GgRecorder>> {
    let path = invocation.workspace_dir.join(GG_SESSION_JOURNAL_PATH);
    match GgRecorder::start(
        &path,
        &invocation.session_id,
        &invocation.capability_set,
        limits.replay_max_bytes,
    ) {
        Ok(recorder) => Some(Arc::new(recorder)),
        Err(err) => {
            warnings.push(format!(
                "session capture: could not open the journal `{}`: {err}. The run proceeds with no \
                 session record.",
                path.display()
            ));
            None
        }
    }
}

/// Pin the run's [seed](test_cabinet_core::gg_session_record::GgSessionSeed) — the fixed identity the
/// session started from — into the [capture journal](crate::capture).
///
/// A no-op for a run whose journal could not be opened. It happens once, at launch, before the
/// first turn, for the reason every other line is written as it happens: the sessions whose
/// envelope is most worth having are the ones that never reach a teardown.
fn record_session_seed(orch: &Orchestrator, invocation: &GgInvocation) {
    let Some(recorder) = &orch.replay else {
        return;
    };
    recorder.record_seed(RecordedSeed {
        prompt: &orch.prompt,
        // gg's own observation of the workspace, kept alongside — not merged with — the host-side
        // `RunRecord::seed_commit`. `None` for a run that never needed a repository (no board),
        // which is the honest answer rather than one committed for the record's sake.
        baseline_commit: orch.baseline_commit.as_deref(),
        model_windows: captured_model_windows(orch, invocation),
        model_modalities: captured_model_modalities(orch, invocation),
    });
}

/// The **resolved** context window every model this run may bind is measured against — the
/// catalog's figure narrowed by any [override](CAPABILITY_CONTEXT_WINDOW_OVERRIDE) and reduced by
/// the compaction headroom.
///
/// The resolved figure rather than the catalog's, because the resolved one is what the fullness
/// signal and the compaction trigger are computed against: a reconstruction handed the raw window
/// would compact at a different turn than the run did.
///
/// Keyed by model id over the **invocation's** map rather than over the capability set's bound
/// agents, and deliberately over-inclusive: a compaction handoff may name a model no agent runs
/// on, and a window recorded for a model the run never bound costs one map entry, while one
/// missing for a model it did costs the reconstruction its compaction boundary.
fn captured_model_windows(orch: &Orchestrator, invocation: &GgInvocation) -> BTreeMap<String, u64> {
    replay_model_ids(invocation)
        .into_iter()
        .filter_map(|model_id| {
            // The narrowing is per agent, and this map is per model, so the window recorded for a
            // model is the one resolved for the profile that binds it — falling back to the root
            // for a model no profile does (a compaction handoff's), which is the only profile a
            // reconstruction could attribute it to.
            let profile = orch
                .caps
                .agents
                .iter()
                .find(|agent| agent.resolved_model_id() == Some(model_id.as_str()))
                .unwrap_or_else(|| orch.caps.root());
            resolve_window_limit(profile, &orch.model_windows, &model_id)
                .map(|window| (model_id, window))
        })
        .collect()
}

/// The **resolved** input modalities of every model this run may bind, as they stand at the moment
/// of the call.
///
/// Read through the run's shared [vision registry](crate::vision::VisionSupport), so it answers
/// with the catalog's declaration *and* any runtime denial — which is exactly the difference
/// between the seed recorded at launch and the one recorded at teardown.
fn captured_model_modalities(
    orch: &Orchestrator,
    invocation: &GgInvocation,
) -> BTreeMap<String, GgSessionModalities> {
    replay_model_ids(invocation)
        .into_iter()
        .map(|model_id| {
            let vision = orch.vision.allows_images(&model_id);
            (model_id, GgSessionModalities { vision })
        })
        .collect()
}

/// Every model id the launch said something about — the union of the invocation's window and
/// modality maps, deduplicated and ordered.
fn replay_model_ids(invocation: &GgInvocation) -> BTreeSet<String> {
    invocation
        .model_windows
        .keys()
        .chain(invocation.model_modalities.keys())
        .cloned()
        .collect()
}

/// Write one [provenance row](GgSessionAgent) for an agent into the run's capture journal.
///
/// Called twice for every agent: once as it comes into existence, with `terminal` `None`, and once
/// when its loop ends, with the [end](LoopEnd) it reached. Assembly upserts the row, so the second
/// supersedes the first — and an agent that never reaches an ending (a killed run, an agent still
/// queued behind the parallelism cap) keeps the row it was born with, which is the whole reason
/// the first write exists.
fn record_session_agent(
    orch: &Orchestrator,
    agent: &Agent,
    origin: &GgSessionAgentOrigin,
    terminal: Option<&LoopEnd>,
) {
    let Some(recorder) = &orch.replay else {
        return;
    };
    recorder.record_agent(GgSessionAgent {
        agent_id: agent.id.clone(),
        profile_id: agent.profile_id.clone(),
        profile: orch.caps.agent_name(&agent.profile_id).to_string(),
        origin: origin.clone(),
        // The same two states the agent-tree telemetry reports, and read from the same predicate,
        // so a record and a stream cannot disagree about how an agent ended.
        terminal_status: terminal.map(|end| {
            if end.status.is_failure() {
                GgAgentStatus::Failed
            } else {
                GgAgentStatus::Done
            }
        }),
        limit_hit: terminal.and_then(|end| end.limit.clone()),
    });
}

/// Close the run's [session capture](crate::capture) journal and say on the root stream what it
/// achieved.
///
/// The `info` line is emitted even for a complete capture, for the same reason the armed-ceiling
/// line is: "how much of this run was recorded?" should be answerable from the operator log rather
/// than by opening the artifact. A capture that stopped early says why, at `warn`, because the
/// record it produced is not the whole session.
fn report_session_capture(recorder: &GgRecorder, emitter: &Emitter) {
    let report = recorder.finish();
    match (&report.truncation, &report.write_error) {
        (None, None) => emitter.emit(log(
            "info",
            format!(
                "session capture: journaled {} input(s) in {} byte(s).",
                report.entries, report.bytes
            ),
        )),
        _ => emitter.emit(log(
            "warn",
            format!(
                "session capture: stopped after {} input(s) ({} byte(s)){}{}. The record is \
                 marked truncated.",
                report.entries,
                report.bytes,
                report
                    .truncation
                    .as_ref()
                    .map(|truncation| format!(" — {:?}", truncation.reason))
                    .unwrap_or_default(),
                report
                    .write_error
                    .as_ref()
                    .map(|error| format!(": {error}"))
                    .unwrap_or_default(),
            ),
        )),
    }
}

/// One reviewer's verdict on one round of an [issue review](run_issue_review), kept so the **next**
/// round's reviewers can be shown what was already asked for and whether it was addressed.
struct ReviewRecord {
    /// The [agent profile](GgAgentConfig) that rendered this verdict.
    reviewer: String,
    /// Whether it approved the work.
    approved: bool,
    /// The actionable items it returned, when it did not approve.
    items: Vec<String>,
}

/// The shared, cross-task state a whole gg session is orchestrated from.
///
/// A run is no longer a single agent: the root can [spawn](handle_subagent_call) subagents that
/// run concurrently, each on its own [slot](GgSlotBinding), possibly spawning their own. All of
/// them are built and driven by [`run_agent`] from this one orchestrator — so it owns everything
/// that must be shared across those tasks: the [scheduler](Scheduler) (the global parallelism
/// cap), the [per-slot accounting](SlotAccounting) every agent folds its usage into, the
/// [client factory](ClientFactory) each agent resolves its model through, the shared skills
/// library and token estimator, the resolved loop bounds/deadline, and the registry of spawned
/// tasks the session joins before it ends. It is held behind an [`Arc`] and cloned into every
/// spawned agent task.
struct Orchestrator {
    /// The run's capability set — the source of truth each agent rebuilds its runtimes from.
    caps: GgCapabilitySet,
    /// The seeded workspace (the **main tree**) every agent's tools are rooted at, unless the agent
    /// was dispatched into an isolated [worktree](Worktree). Also the repository worktree branches
    /// are merged back into.
    workspace_dir: PathBuf,
    /// The root's build prompt (a subagent is driven by its brief instead).
    prompt: String,
    /// The workspace-relative paths of every file the test case provided — its specs then its
    /// reference images, as [`core` computed them](GgInvocation::provided_files) — that an agent
    /// whose profile enables [autoload-specifications](CAPABILITY_AUTOLOAD_SPECS) reads into its
    /// opening context. Empty when nothing was seeded; consulted per agent, since autoload is a
    /// per-agent capability.
    provided_files: Vec<PathBuf>,
    /// Whether the [subagents](CAPABILITY_SUBAGENTS) capability is on — gates the spawn tools, the
    /// per-agent delegation context, and the agent-tree telemetry.
    subagents_enabled: bool,
    /// Whether the [project-management](CAPABILITY_PROJECT_MANAGEMENT) capability is on — gates the
    /// board tools, the `wait_for_issue` tool, and the auto-[dispatch](Self::pump_dispatch) of an
    /// actionable issue to a freshly spawned top-level agent. A run with it on is multi-agent even
    /// with [`subagents`](CAPABILITY_SUBAGENTS) off (see [`multi_agent`](Self::multi_agent)).
    project_management_enabled: bool,
    /// Where [worktree](Worktree) checkouts are created (a sibling of the workspace),
    /// `Some` only when worktree isolation is usable (git present, baseline committed, root
    /// created). `None` means issues run in the shared workspace.
    worktrees_root: Option<PathBuf>,
    /// The run's **baseline commit** — the seeded workspace committed at session start when gg made
    /// the workspace a git repo. The first [worktree](Worktree) branches from it (later ones branch
    /// from whatever the main tree's `HEAD` has advanced to). `None` when git could not initialize
    /// a baseline, which is also how the rest of the orchestrator tells that isolation is off.
    baseline_commit: Option<String>,
    /// The [id](GgAgentConfig::id) of the agent profile gg hands a **conflicted merge** to when an
    /// accepted [issue](crate::board)'s branch does not apply cleanly — the
    /// [`mergeAgentId`](PROJECT_MANAGEMENT_PARAM_MERGE_AGENT) the capability requires. `None` only
    /// when project management is off (launch validation refuses a board without one).
    merge_agent: Option<String>,
    /// The **root agent's** code setup: whether its turns are conducted as
    /// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) and the per-program sandbox ceilings.
    /// Since responses-as-code is now a **per-agent** capability, each
    /// agent's own setup is resolved from its profile at run time (see
    /// [`code_setup`](Self::code_setup)); this field carries the root's, used for the run-level
    /// launch log and the sandbox warm-up decision.
    code: CodeSetup,
    /// The isolated [worktree](Worktree) each [issue](crate::board) works in, keyed by issue id.
    ///
    /// Created on the issue's **first** dispatch and reused by every later agent that touches it —
    /// a retry, a review round's re-dispatch, and its reviewers (who read the same tree) — so an
    /// attempt builds on what the last one produced rather than starting over. Removed when the
    /// issue reaches a terminal state, as its branch is merged back or discarded. Empty when git
    /// isolation is unavailable, in which case issues share the main tree. Guarded so
    /// concurrently-dispatching agents can record.
    issue_worktrees: Mutex<BTreeMap<String, Worktree>>,
    /// The [review verdicts](ReviewRecord) each [issue](crate::board) has already collected, keyed
    /// by issue id and in the order they were rendered. Every round's reviewers are shown the
    /// history, so a second reviewer knows what a first one already asked for and a re-review can
    /// tell whether its own earlier items were addressed.
    issue_reviews: Mutex<BTreeMap<String, Vec<ReviewRecord>>>,
    /// The run's **single, global** [project-management board](crate::board) — one
    /// [`BoardRuntime`] shared by every agent (each agent's board tools mutate this same store),
    /// and the queue the [dispatcher](Self::pump_dispatch) reads. [`disabled`](BoardRuntime::disabled)
    /// when the [project-management](CAPABILITY_PROJECT_MANAGEMENT) capability is off.
    board: BoardRuntime,
    /// The **profile-bound** memory instances of this run: one store per agent profile scoped
    /// [`shared`](MemoryScope::Shared), created by the first instance of that profile to ask for
    /// one and held by every later instance of it. Run-global because that is exactly what the
    /// scope means — two instances of one profile, including two running at the same time, curate
    /// one notebook and are each told what the other wrote. Empty for every run that scopes
    /// nothing, which is every run that does not say otherwise.
    memory_registry: MemoryRegistry,
    /// The run's [module id mint](crate::modules::ModuleIdMint) — one monotonic sequence per module
    /// kind, from which every module instance in the run takes its identity.
    ///
    /// Run-global because that is the scope module ids are compared in: the whole point of an id is
    /// that two agents reporting `memories-3` are holding one notebook, and that is only meaningful
    /// if one thing hands them out.
    module_ids: ModuleIds,
    /// Whether any profile this run declares takes its memories from the agent that spawned it —
    /// [`inherited`](MemoryScope::Inherited) or [`read-only`](MemoryScope::ReadOnly).
    ///
    /// Resolved once, here, because it is a fact about the *configuration* rather than about any
    /// one agent, and because the agent it matters to is the **spawner**: an agent whose own
    /// memories are isolated has to be told in its opening prompt that a child may nonetheless
    /// come to hold them, and that prompt is rendered before it has spawned anything.
    memories_inheritable: bool,
    /// Every [machine](crate::fsm) this run declares, keyed by the **FSM shell**
    /// [profile](GgAgentConfig) that declares it — parsed once at launch, then shared by every
    /// incarnation each machine runs.
    ///
    /// Built here rather than per agent so a machine cannot be re-read differently mid-run: the
    /// table a transition is checked against is the very object the entry state came from. Empty for
    /// every run that declares no machine, which is almost all of them.
    machines: BTreeMap<String, Arc<FsmSpec>>,
    /// The agents blocked in a [`wait_for_issue`](Self::begin_issue_wait), keyed by the issue id
    /// each awaits. Each entry is the [scheduler waiter tokens](WaiterToken) of the agents waiting
    /// on that issue; when the issue settles they are all [marked ready](Scheduler::mark_ready).
    /// Guarded so a completing agent and a fresh waiter can touch it concurrently.
    ///
    /// **Ordered**, and that is load-bearing rather than tidy:
    /// [`wake_settled_issue_waiters`](Self::wake_settled_issue_waiters) walks the whole table on
    /// every board change, so under a hash map the order blocked agents were woken in was reseeded
    /// every process — a per-run coin flip in a harness whose product is a *comparable* recorded
    /// run.
    issue_waits: Mutex<BTreeMap<String, Vec<WaiterToken>>>,
    /// Serializes every **single-step** git operation on the shared repository (worktree
    /// add/remove, a review's diff), since concurrently-finishing agents would otherwise race on
    /// `.git` and the main working tree. See [`merge_lock`](Self::merge_lock) for the multi-step
    /// half, which spans a dispatched merge agent's whole session.
    ///
    /// An **async** lock, because what it guards is slow: every [git] call runs on the blocking
    /// pool and is awaited, and the commands here walk the whole workspace (seconds, on a tree an
    /// `npm install` has filled). A `std` mutex would make an agent waiting its turn *block gg's
    /// single runtime thread* for as long as the agent ahead of it takes — reintroducing, in the
    /// wait, exactly the stall that moving git off the runtime thread removed.
    git_lock: tokio::sync::Mutex<()>,
    /// Serializes the **merge** of an accepted issue's branch back into the main tree.
    ///
    /// A merge is not one git call: it can leave the tree conflicted, dispatch the
    /// [merge agent](Self::merge_agent), and wait for it to resolve — a span with awaits in it, and
    /// one during which no other merge may touch the main tree (a second `git merge` on a tree with
    /// `MERGE_HEAD` set would be refused, and a concurrent abort would throw away the resolution).
    /// Hence an async lock, distinct from the synchronous [`git_lock`](Self::git_lock).
    merge_lock: tokio::sync::Mutex<()>,
    /// The resolved [parallelism and depth caps](SubagentConfig).
    config: SubagentConfig,
    /// The single global [scheduler](Scheduler) coordinating every agent's running slot.
    scheduler: Arc<Scheduler>,
    /// The run-global [persistence record](AgentPersistence): what each
    /// [persistent](crate::persistence) profile had open when one of its instances last
    /// finished, so the next instance opens on the same files. Shared by every agent, since the whole
    /// point is that a later instance reads what an earlier one wrote; inert for a run whose profiles
    /// are all non-persistent.
    persistence: Arc<AgentPersistence>,
    /// The per-`(slot, model)` usage/cost accounting every agent folds its total into.
    accounting: Mutex<SlotAccounting>,
    /// The base (unscoped) emitter each agent derives its scoped stream from.
    base_emitter: Emitter,
    /// The offered model factory each agent resolves its slot's client through.
    factory: Arc<dyn ClientFactory>,
    /// The run's [shell seam](ShellRunner), stamped onto every agent's
    /// [tool context](ToolContext) so all three of gg's command-line paths — the `shell` tool, a
    /// [responses-as-code](crate::sandbox) program's `system.shell(…)`, and a
    /// [hook's](crate::hooks) commands — start their processes through
    /// the one runner the session was launched with.
    ///
    /// It is the **base** runner: when the run is capturing, each agent's tool context gets it
    /// wrapped in a [`RecordingShellRunner`](crate::capture::RecordingShellRunner) rooted at that agent's own workspace — see
    /// [`shell_for`](Self::shell_for).
    shell: Arc<dyn ShellRunner>,
    /// Each profile's own [skills](CAPABILITY_SKILLS) library, by profile
    /// [id](GgAgentConfig::id), for the profiles that enable the capability.
    ///
    /// A skill library belongs to an agent: a profile names the directory it loads from, and two
    /// profiles naming one directory share the `Arc` this map holds twice. A profile absent from
    /// here reads no skills.
    skills: BTreeMap<String, Arc<SkillLibrary>>,
    /// The shared token estimator (built once — the BPE vocab is expensive), backing every agent's
    /// context accounting.
    estimator: Arc<dyn TokenEstimator>,
    /// The [model catalog's context window](GgInvocation::model_windows) for each model this run
    /// can bind, as pushed in with the invocation. Consulted per agent, since a
    /// [multi-model](https://docs.testcabinet.ai/gg/configurations/#model-slots) run measures each agent against
    /// its own model's window.
    model_windows: BTreeMap<String, u64>,
    /// Which of this run's models may be shown an image, seeded from the invocation's
    /// [catalog modalities](GgInvocation::model_modalities) and updated when a provider
    /// refuses one. Shared (`Arc`) across every agent so a model denied on one agent's
    /// turn stops being sent pictures by all of them — see [`crate::vision`].
    vision: Arc<VisionSupport>,
    /// The resolved [execution ceilings](RunLimits) every agent is bounded by. Shared as a value
    /// rather than behind a lock: five scalars nothing mutates after launch.
    limits: RunLimits,
    /// The **root** agent's resolved [generation-loop detector](crate::loopguard), or `None` when it
    /// left the capability disarmed (the default).
    ///
    /// Held for one purpose — the launch line that names the armed configuration — on exactly the
    /// footing the armed ceilings are held on: a resolved configuration fact worth
    /// saying out loud once, resolved here so the line and the run can never describe different
    /// settings. It is deliberately **not** how any client gets its detector: loop detection is per
    /// agent, so each agent's own client resolves its own from the
    /// [binding](GgSlotBinding::loop_detection) built for its profile, and a subagent on a different
    /// profile is watched on its own terms rather than the root's.
    loop_guard: Option<LoopGuardConfig>,
    /// The optional shared wall-clock deadline (from run start) every agent stops at — the
    /// [runtime ceiling](RunLimits::max_runtime) as an absolute instant, resolved once so every
    /// agent measures it against the same session start.
    deadline: Option<Instant>,
    /// The run's accumulated model spend, fed by every agent at its own model-response site and
    /// read by every agent at its own turn boundary — the figure the
    /// [cost ceiling](RunLimits::max_cost) is measured against.
    ///
    /// Run-wide rather than per agent because every agent bills the same run and a per-agent cost
    /// ceiling would be defeated by delegating. The existing [`SlotAccounting`] cannot serve: it is
    /// folded only when an agent *finishes*, so a subagent forty turns deep would contribute nothing
    /// until it was done — precisely the run a cost ceiling exists to stop.
    spend: Arc<RunSpend>,
    /// The host's [cancellation watch](crate::cancel), read by every agent at its own turn boundary
    /// exactly as the deadline and the spend are. Shared so one agent's observation is the run's
    /// decision — see [`crate::cancel`] for why it latches.
    ///
    /// Disabled when the invocation named no [sentinel](GgInvocation::cancel_file), which is the
    /// shape of a run whose host cannot cancel it.
    cancel: CancelWatch,
    /// The run's [internal-fault latch](crate::fault): the first gg defect any agent met, and the
    /// reason every other agent is winding down.
    ///
    /// Shared and read at the same turn boundary as the watch above it, because a defect of ours
    /// ends the *run* rather than the agent that met it: the tree a broken run leaves cannot be
    /// scored against the model, wherever in the tree the break happened.
    fault: FaultLatch,
    /// The run's [ceiling latch](crate::limits::CeilingLatch): the first
    /// [execution ceiling](RunLimits) any agent of the run breached.
    ///
    /// Shared for the reason the fault latch above it is, and unlike that one it winds nothing
    /// down: the breaching agent has already ended itself and its siblings go on working. What it
    /// decides is the process exit code, so a run that spent a safeguard is not collected as a
    /// session that ran to a natural end.
    ceiling: CeilingLatch,
    /// The run's [discovery warning latch](crate::discovery::DiscoveryWarning): whether an operator
    /// has already been told that this run's model calls functions it never looked up.
    ///
    /// Shared for the reason the two latches above it are, and for one of its own: the finding is a
    /// property of the **model**, and every agent of a run bound to one profile is the same model
    /// making the same mistake. A line per agent would say the same thing several times about one
    /// model; a line per call would drown the log of exactly the run worth reading.
    discovery: DiscoveryWarning,
    /// Every spawned agent task, drained and awaited before the session ends. Guarded so
    /// concurrently-spawning agents can register their children.
    tasks: Mutex<Vec<AgentTask>>,
    /// A monotonic counter minting unique subagent ids.
    next_seq: AtomicU64,
    /// The run's own [session hooks](crate::hooks), resolved once at launch. Fired by the root
    /// agent around the session as a whole, never by anybody else.
    session_hooks: Arc<HookRuntime>,
    /// Each agent profile's own [hooks](crate::hooks), by profile
    /// [id](test_cabinet_core::gg::GgAgentConfig::id), resolved once at launch.
    ///
    /// Keyed rather than carried on the profile because an agent instance is dispatched
    /// with its profile and needs its runtime *shared*, not cloned: a profile running a dozen times
    /// at once materializes its scripts to one directory and answers `has(event)` off one map.
    ///
    /// Ordered, like every other map gg holds: an unordered one would make the launch
    /// announcement's line order a function of hash seed, and a run's log is compared against
    /// another run's.
    agent_hooks: BTreeMap<String, Arc<HookRuntime>>,
    /// The per-key ordinals a [replay agent origin](GgSessionAgentOrigin) is keyed by: a spawn's
    /// position within its parent, a review round within its issue, a merge within its issue.
    ///
    /// Deliberately **not** the [agent counter](Self::next_seq). An origin is meant to *explain*
    /// an agent — the third spawn of this parent, the second review round of that issue — and agent
    /// ids come off a global counter in the order agents happen to reach their spawn, so two
    /// concurrent agents take different ids from one run to the next. An origin keyed on the global
    /// counter would say nothing about where the agent came from.
    ordinals: Mutex<BTreeMap<String, u32>>,
    /// The shared [session recorder](GgRecorder) every agent's model I/O, tool results and prompt
    /// frames are pinned into. Present on **every** run — capture is not a capability and no
    /// setting turns it up or down — so `None` means the journal could not be opened, which the
    /// launch warnings say out loud.
    ///
    /// Shared (`Arc`) so the root and every subagent stream into one globally-ordered
    /// [journal](test_cabinet_core::gg_session_journal), which the host folds into the run tree's
    /// [`replay.json.gz`](test_cabinet_core::gg_session_assembly::GG_SESSION_TREE_ARTIFACT) after the
    /// container is gone.
    replay: Option<Arc<GgRecorder>>,
}

impl Orchestrator {
    /// The [session capture](crate::capture) gg's own [`git`] invocations are reported through,
    /// stamped with `agent_id`.
    ///
    /// Orchestration git is the run's bookkeeping rather than any one agent's turn — a worktree is
    /// created for an issue before the agent that will work in it exists, and torn down after it
    /// is gone — so the attribution is to whichever agent's decision caused it, falling back to
    /// the [root](ROOT_AGENT_ID), which *is* the run. What actually places these entries in the
    /// session is their [`seq`](test_cabinet_core::gg_session_record::GgSessionEntry::seq), which is minted
    /// from the same global counter as every other input.
    /// The [shell seam](ShellRunner) an agent rooted at `workspace` runs its commands through: the
    /// run's, wrapped in a [`RecordingShellRunner`](crate::capture::RecordingShellRunner) whenever
    /// the run is capturing, and always in an
    /// [`EmittingShellRunner`](crate::telemetry::EmittingShellRunner) so every command it runs is
    /// reported as a [`Shell`](test_cabinet_core::gg::GgTelemetryKind::Shell) event on `emitter`'s
    /// stream.
    ///
    /// **Per agent, not per run**, because the wrapper measures a command's working directory
    /// against a root and an agent's root is its own — an [issue worktree](crate::board), or the
    /// shared tree. A single run-wide wrapper would record an issue agent's `web/` build as
    /// `worktrees/AUTH-1/web/`, so the same command issued by two agents would read back as two
    /// different commands and a reconstruction would match neither.
    ///
    /// One `Arc` per agent per turn is the cost, which is nothing beside the model call the turn is
    /// about to make.
    fn shell_for(&self, workspace: &Path, emitter: &Emitter) -> Arc<dyn ShellRunner> {
        let inner: Arc<dyn ShellRunner> = match &self.replay {
            Some(recorder) => Arc::new(crate::capture::RecordingShellRunner::new(
                Arc::clone(&self.shell),
                Arc::clone(recorder),
                workspace,
            )),
            None => Arc::clone(&self.shell),
        };
        // The telemetry decorator sits outermost, on every run: capture is a recording of the
        // session while the `shell` event is the live stream's account of the same command, and
        // a run whose journal could not be opened still reports what it ran. The emitter is the
        // calling agent's own scoped stream, so the event lands on the agent the command ran for.
        Arc::new(crate::telemetry::EmittingShellRunner::new(
            inner,
            emitter.clone(),
            workspace,
        ))
    }

    /// The [`git`](git::GitCapture) capture for `agent_id`: where its invocations are recorded.
    ///
    /// A run that is not capturing still names the agent, because the capture is the choke point
    /// every one of gg's own `git` invocations goes through whether or not a journal is being
    /// written.
    fn git_capture(&self, agent_id: &str) -> git::GitCapture {
        match &self.replay {
            Some(recorder) => {
                git::GitCapture::new(Arc::clone(recorder), agent_id, &self.workspace_dir)
            }
            None => git::GitCapture::unrecorded(agent_id, &self.workspace_dir),
        }
    }

    /// Build the orchestrator for `invocation`, loading the shared skills library and token
    /// estimator once and resolving the run-wide ceilings, deadline and subagent caps.
    ///
    /// `warnings` collects every operator-facing diagnostic the resolution produced that gg is none
    /// the less **honouring exactly as written** — an armed ceiling that can only fire on the last
    /// turn, a detector armed and provably inert. They are returned rather than emitted because this
    /// function is handed the run's **unscoped** emitter (the one it clones for every agent), while a
    /// launch diagnostic belongs on the root agent's stream alongside the rest of them; the caller
    /// has that stream and emits them there, before the first turn.
    ///
    /// `report` is the [launch sink](crate::validate::LaunchReport) for a value gg **cannot** honour.
    /// The caller hands it a [discarding](crate::validate::LaunchReport::Discarding) one, and that is
    /// the invariant rather than a shortcut: [`validate_launch`](crate::validate::validate_launch)
    /// has already run this document through these resolvers with a collecting sink and refused the
    /// run if anything came back. Nothing on `warnings` is a substituted default any more — a
    /// resolver that finds one reports it, and a run carrying one never reaches this function.
    ///
    /// Fails only where this run's declared structure will not build — a
    /// [machine](crate::fsm) that does not parse, a [hook](crate::hooks) declaration site that does
    /// not resolve. Both are **gg defects** rather than misconfigurations, because
    /// [`validate_launch`](crate::validate::validate_launch) has already refused every set that
    /// carries one. They are errors rather than more warnings because an orchestrator without those
    /// pieces is not a degraded version of this run but a different one — every machine an ordinary
    /// agent, every gate absent — and the whole point of the refusal is that such a run must not
    /// start.
    fn build(
        invocation: &GgInvocation,
        emitter: &Emitter,
        factory: Arc<dyn ClientFactory>,
        shell: Arc<dyn ShellRunner>,
        worktrees: WorktreesSetup,
        warnings: &mut Vec<String>,
        report: &mut crate::validate::LaunchReport,
    ) -> Result<Self, String> {
        let set = &invocation.capability_set;
        // One library per profile that enables skills, loaded once per distinct directory; each
        // agent keeps its own read-state runtime over the one its profile named.
        let skills = resolve_skills(set, &invocation.workspace_dir);
        let limits = resolve_run_limits(set, report, warnings);
        // Every machine the run declares, parsed once here and shared by every instance each of
        // them runs.
        //
        // The only way this fails is [`crate::validate::validate_launch`] having accepted a set
        // whose machines will
        // not build, which would mean gg read one configuration two different ways — so it is
        // reported and the launch abandoned. An empty table is emphatically not a harmless
        // stand-in: every FSM shell in the set would come up as an ordinary agent with no states,
        // no transitions and no model of its own, running a configuration nobody wrote while the
        // record still calls it a machine. That is the silent wrong-experiment failure the whole
        // of this file's validation exists to prevent.
        let machines = crate::fsm::machines(set)?;
        // The run's hooks, resolved once per declaration site: the session's, and each profile's
        // own. A resolution error — a built-in id gg does not ship, or a hook declared on the wrong
        // side of the session/agent split — **refused this launch** at check 1, through the same
        // `problems` scan this resolution runs; reaching one here means gg read one configuration
        // two different ways, so it is reported as ours and the session ends.
        //
        // It is emphatically not a warning with that site's hooks dropped, which is what it used to
        // be: one typo'd built-in id disarmed every other hook declared beside it — including the
        // blocking `pre-write`, `pre-shell` and `agent-stop` gates — and a run whose gates are
        // silently absent looks exactly like a run whose gates never had anything to say. Every
        // other hook misconfiguration is the script's own to report, at the firing.
        let resolve_hooks = |result: Result<HookRuntime, Vec<String>>| {
            result.map(Arc::new).map_err(|errors| errors.join("; "))
        };
        let session_hooks =
            resolve_hooks(HookRuntime::resolve_session(set, &invocation.workspace_dir))?;
        let mut agent_hooks: BTreeMap<String, Arc<HookRuntime>> = BTreeMap::new();
        for profile in &set.agents {
            let runtime = resolve_hooks(HookRuntime::resolve_agent(
                profile,
                &invocation.workspace_dir,
            ))?;
            agent_hooks.insert(profile.slug.clone(), runtime);
        }
        let deadline = limits.max_runtime.map(|budget| Instant::now() + budget);
        // The Root agent's code setup: responses-as-code is per-agent, but the Root's is what the
        // run-level launch log and the sandbox warm-up decision key on. Every value read here was
        // read by `validate_launch` first, through these same resolvers, and refused the run if it
        // was one gg could not honour — so the sink is discarding and nothing is reformatted here.
        // Loop detection is per agent, so every profile's declaration is read here — not just the
        // root's — and each one's advisory warning is stamped with the agent it belongs to. What
        // survives as a warning is only the one cross-knob relationship gg arms exactly as declared
        // and which is provably inert; a knob gg cannot arm at all refused this run at launch.
        //
        // Only the **root's** resolved detector is kept, and only for the launch line that names it:
        // every agent's client resolves its own from the binding built for its profile, so a
        // subagent is watched on its own terms rather than the root's.
        let mut loop_guard = None;
        for (index, agent) in set.agents.iter().enumerate() {
            let resolved = crate::loopguard::resolve_loop_guard(&agent.loop_detection, report);
            warnings.extend(
                resolved
                    .warnings
                    .iter()
                    .map(|warning| format!("agent `{}`: {warning}", agent.slug)),
            );
            // The root is the set's **first** agent — identified by position, since an operator
            // may promote a different profile to first.
            if index == 0 {
                loop_guard = resolved.config;
            }
        }
        // Nothing above may have found a value gg cannot honour: `validate_launch` read this same
        // document through these same resolvers before the first turn and refused the run if
        // anything came back, so a defect reaching a discarding sink here is gg reading one
        // configuration two different ways. Asserted rather than handled — by the time an
        // orchestrator is being built the launch is already past the point where a refusal is the
        // right answer, and the assertion is what stops a resolver being migrated onto `report`
        // without `validate_launch` learning to run it.
        debug_assert!(
            report.is_empty(),
            "the orchestrator's resolvers reported a launch defect the launch pass had accepted"
        );
        // The run's module id mint, built before anything it identifies: the board below is the
        // run's single board module, and it takes its id from here.
        let module_ids: ModuleIds = Arc::new(ModuleIdMint::default());
        Ok(Self {
            caps: set.clone(),
            workspace_dir: invocation.workspace_dir.clone(),
            prompt: invocation.prompt.clone(),
            provided_files: invocation.provided_files.clone(),
            subagents_enabled: set.is_enabled(CAPABILITY_SUBAGENTS),
            project_management_enabled: board_owner(set).is_some(),
            worktrees_root: worktrees.root,
            baseline_commit: worktrees.baseline_commit,
            merge_agent: board_owner(set)
                .is_some()
                .then(|| merge_agent_id(set, report))
                .flatten(),
            code: CodeSetup {
                enabled: set.root().is_enabled(CAPABILITY_RESPONSES_AS_CODE),
                language: sandbox::resolve_program_language(set.root(), report),
                limits: sandbox::resolve_sandbox_limits(set.root(), report),
                doc_view_types: crate::docs::resolve_doc_view_types(set.root(), report),
            },
            issue_worktrees: Mutex::new(BTreeMap::new()),
            issue_reviews: Mutex::new(BTreeMap::new()),
            board: resolve_board(set, &module_ids),
            memory_registry: MemoryRegistry::new(),
            module_ids,
            memories_inheritable: crate::memories::run_inherits_memories(set),
            machines,
            issue_waits: Mutex::new(BTreeMap::new()),
            git_lock: tokio::sync::Mutex::new(()),
            merge_lock: tokio::sync::Mutex::new(()),
            config: SubagentConfig::resolve(set, report),
            scheduler: Scheduler::new(SubagentConfig::resolve(set, report).max_parallel),
            persistence: AgentPersistence::new(),
            accounting: Mutex::new(SlotAccounting::default()),
            base_emitter: emitter.clone(),
            factory,
            shell,
            skills,
            estimator: Arc::new(BpeTokenEstimator::new()),
            model_windows: invocation.model_windows.clone(),
            vision: Arc::new(VisionSupport::new(invocation.model_modalities.clone())),
            limits,
            loop_guard,
            deadline,
            spend: Arc::new(RunSpend::default()),
            cancel: match invocation.cancel_file.clone() {
                Some(path) => CancelWatch::new(path),
                None => CancelWatch::disabled(),
            },
            fault: FaultLatch::default(),
            ceiling: CeilingLatch::default(),
            discovery: DiscoveryWarning::default(),
            tasks: Mutex::new(Vec::new()),
            next_seq: AtomicU64::new(0),
            session_hooks,
            agent_hooks,
            ordinals: Mutex::new(BTreeMap::new()),
            // Capture is always on. `None` here means the journal could not be opened, never that
            // the run declined to be recorded.
            replay: start_session_capture(invocation, &limits, warnings),
        })
    }

    /// The [machine](crate::fsm) the profile with [id](GgAgentConfig::id) `profile` declares,
    /// when it is an [FSM shell](crate::fsm::is_shell) — what turns an agent about to run that
    /// profile into the machine's entry state instead.
    fn machine(&self, profile: &str) -> Option<&Arc<FsmSpec>> {
        self.machines.get(profile)
    }

    /// A skills runtime over `profile`'s own library, or a disabled one for a profile that reads no
    /// skills.
    ///
    /// Per profile, like every other capability this loop reads: a run may point its implementer at
    /// one directory and its reviewer at another, and each agent's catalogue is the one its own
    /// profile named.
    fn skills_runtime(&self, profile: &GgAgentConfig) -> SkillsRuntime {
        match self.skills.get(profile.slug.as_str()) {
            Some(library) => SkillsRuntime::new_in(Arc::clone(library), &self.module_ids),
            None => SkillsRuntime::disabled(),
        }
    }

    /// The context accounting for an agent running `profile` on `model_id`: the shared estimator
    /// and the model's window limit (its catalog window, narrowed by an enabled
    /// [context-window override](CAPABILITY_CONTEXT_WINDOW_OVERRIDE) **on that profile**).
    ///
    /// Per profile, like every other capability this loop reads: a run may narrow its implementer's
    /// window and measure its reviewer against the model's own.
    fn context_setup(&self, profile: &GgAgentConfig, model_id: &str) -> ContextSetup {
        ContextSetup {
            estimator: Arc::clone(&self.estimator),
            window_limit: resolve_window_limit(profile, &self.model_windows, model_id),
        }
    }

    /// Mint the next unique subagent id.
    fn next_agent_id(&self) -> String {
        format!("agent-{}", self.next_seq.fetch_add(1, Ordering::SeqCst))
    }

    /// Mint the next [ordinal](Self::ordinals) under `key` — `0` the first time the key is asked
    /// for, and one more on each later ask.
    fn next_ordinal(&self, key: String) -> u32 {
        let mut ordinals = self.ordinals.lock().expect("replay ordinals lock");
        let next = ordinals.entry(key).or_insert(0);
        let ordinal = *next;
        *next += 1;
        ordinal
    }

    /// What [`next_ordinal`](Self::next_ordinal) would hand back for `key`, **without** taking it.
    ///
    /// For the one creation path that has to name an agent's [origin](GgSessionAgentOrigin) *before*
    /// it is committed to creating it: [`dispatch_child`] resolves a client — which needs to say
    /// whose it is — and a resolution failure is an ordinary tool error the spawner recovers from
    /// and may spawn again after. Minting there would spend an ordinal on a child that never
    /// existed and shift every later sibling's, so the ordinal is peeked for the identity and taken
    /// only once the dispatch is going ahead.
    ///
    /// Not racy despite the gap: ordinals are keyed per spawner, and a spawner's own turn loop is
    /// strictly sequential — it is the only thing that can take from its own key, and it is inside
    /// this call when it does.
    fn peek_ordinal(&self, key: &str) -> u32 {
        self.ordinals
            .lock()
            .expect("replay ordinals lock")
            .get(key)
            .copied()
            .unwrap_or(0)
    }

    /// Whether **delegation** is active this run — the [subagents](CAPABILITY_SUBAGENTS)
    /// capability. When it is, each agent gets a [delegation context](SubagentContext) and the
    /// agent-tree [telemetry](GgAgentStatus) (running/blocked/done/failed transitions and returns)
    /// is emitted.
    fn delegation_enabled(&self) -> bool {
        self.subagents_enabled
    }

    /// Whether the run is **multi-agent** — either [delegation](Self::delegation_enabled) is on, or
    /// [project management](CAPABILITY_PROJECT_MANAGEMENT) is (which auto-dispatches issues to
    /// spawned top-level agents). This is what gates the agent-tree
    /// [status telemetry](GgAgentStatus): a project-management run animates its dispatched agents in
    /// the live tree just as a delegating run animates its subagents.
    fn multi_agent(&self) -> bool {
        self.delegation_enabled() || self.project_management_enabled
    }

    /// The run's [baseline commit](Self::baseline_commit) sha — the seeded workspace committed at
    /// session start when gg made the workspace a git repo — or `None` when git isolation is
    /// unavailable.
    fn baseline_commit(&self) -> Option<&str> {
        self.baseline_commit.as_deref()
    }

    /// The [agent profile](GgAgentConfig) an agent named `profile` runs under, or `None` when this
    /// run declares no profile by that name.
    ///
    /// Absence is a **gg defect**, not a condition to recover from, which is why this hands the
    /// question back rather than answering it. [Launch
    /// validation](crate::validate::validate_launch) rejects every
    /// roster reference to an undeclared profile before a single agent is built, the board
    /// constrains an issue's assignee to the filer's own
    /// [implementers](crate::board::IssuePolicy::implementers) at file time, and every caller here
    /// passes either a running agent's own slot or a successor already checked against the roster
    /// and the machine — so no configuration and no model can produce a name this fails on.
    ///
    /// Substituting the [root](GgCapabilitySet::root) is the obvious repair, on the argument that a
    /// stale reference should keep running rather than refuse, and it is wrong in the only case it
    /// applies to. The substitute is a *different agent* — other capabilities, other model,
    /// possibly another execution mode — and the record still attributes its turns to the profile
    /// that was asked for. gg's whole output is attribution data, so such a fallback does not
    /// degrade a run, it silently falsifies one. Every caller here says out loud that gg is broken
    /// instead.
    fn declared_profile(&self, profile: &str) -> Option<&GgAgentConfig> {
        self.caps.agent(profile)
    }

    /// The [exclusivity key](crate::subagents::ExclusiveKey) an agent running under the profile named
    /// `profile` holds its scheduler slot under — the profile's name when it is
    /// [persistent](crate::persistence), else `None`.
    ///
    /// Every site that takes, frees, or re-takes a slot for an agent asks this rather than carrying the
    /// key around, so the answer is derived from the one capability set in every case and a slot can
    /// never be released under a key it was not taken under.
    ///
    /// A profile the run does not [declare](Self::declared_profile) holds **no** key, and this is
    /// deliberately not where that defect is reported: the one site that can reach this ahead of
    /// the check ([`run_agent`], resolving the key before it takes a slot) reaches the turn loop's
    /// own resolution a few steps later, which ends that agent's loop with
    /// [`STATUS_INTERNAL_ERROR`] naming the profile. What must not happen in the meantime is keying on the
    /// [root](GgCapabilitySet::root)'s persistence setting, which is the substitution
    /// [`declared_profile`](Self::declared_profile) refuses to make and does real damage here: a
    /// phantom agent would queue in front of, or behind, a persistent profile it has nothing to do
    /// with. Keyless contends with nothing, so the broken agent disturbs no one on its way to
    /// being reported.
    fn exclusive_key(&self, profile: &str) -> Option<String> {
        self.declared_profile(profile)
            .and_then(persistence::exclusive_key)
    }

    /// The [agent profile](GgAgentConfig) an auto-dispatched [issue](crate::board)'s agent runs
    /// under — the [assignee](crate::board::Issue::agent) named when the issue was filed — or
    /// `None` when the board carries no assignee for `issue_id`.
    ///
    /// The name is handed back **unchecked**: whether this run declares it is settled by the
    /// [binding](profile_binding) the dispatcher resolves next, so an assignee that is stale and
    /// one that is unresolvable fail the issue by the same path and read the same on the board.
    /// Neither falls back to the [root](GgCapabilitySet::root): dispatching the wrong agent is not
    /// a lesser evil than stalling the board, it is a worse one, because a stalled board is visible
    /// and a run recorded against a profile that never ran it is not.
    fn issue_profile(&self, issue_id: &str) -> Option<String> {
        self.board.issue_agent(issue_id)
    }

    /// The per-agent [code setup](CodeSetup) for `profile`: whether its turns run as
    /// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE), and the sandbox ceilings its own
    /// responses-as-code config resolves to.
    fn code_setup(&self, profile: &GgAgentConfig) -> CodeSetup {
        // A discarding sink: `validate_launch` read every one of these values off this same profile,
        // through these same resolvers, before the first turn and refused the run if any could not
        // be honoured.
        let report = &mut crate::validate::LaunchReport::Discarding;
        CodeSetup {
            enabled: profile.is_enabled(CAPABILITY_RESPONSES_AS_CODE),
            language: sandbox::resolve_program_language(profile, report),
            limits: sandbox::resolve_sandbox_limits(profile, report),
            doc_view_types: crate::docs::resolve_doc_view_types(profile, report),
        }
    }

    /// The isolated [worktree](Worktree) issue `issue_id` works in, creating it on first use.
    ///
    /// The branch is based at the main tree's **current `HEAD`**, not at the run baseline: an issue
    /// only becomes actionable once every issue it is blocked by is done and merged, so branching
    /// from `HEAD` is what lets it build on its blockers' work. Returns `None` when git isolation is
    /// unavailable (the issue then works in the shared workspace) or the worktree could not be
    /// created, in which case the reason is logged rather than failing the issue.
    ///
    /// The [git lock](Self::git_lock) serializes the **creation**, and the map is re-read once it is
    /// held: two dispatches of the same issue (a retry racing a reopen) therefore produce one
    /// worktree, not two, even though neither holds the map's own lock across the checkout — which it
    /// must not, since a checkout is awaited off the runtime thread.
    async fn ensure_issue_worktree(&self, issue_id: &str, emitter: &Emitter) -> Option<Worktree> {
        if let Some(existing) = self.issue_worktree(issue_id) {
            return Some(existing);
        }
        let root = self.worktrees_root.as_ref()?;
        self.baseline_commit.as_ref()?;
        let _guard = self.git_lock.lock().await;
        if let Some(existing) = self.issue_worktree(issue_id) {
            return Some(existing);
        }
        let capture = self.git_capture(ROOT_AGENT_ID);
        let base = match git::head_commit(&capture, &self.workspace_dir).await {
            Ok(sha) => sha,
            Err(err) => {
                emitter.emit(log(
                    "error",
                    format!(
                        "could not read the workspace `HEAD` to branch issue `{issue_id}` from: \
                         {err}; it will work directly in the shared workspace."
                    ),
                ));
                return None;
            }
        };
        let slug = worktree_slug(issue_id);
        let branch = format!("gg/issue-{slug}");
        let path = root.join(format!("issue-{slug}"));
        if let Err(err) =
            git::add_worktree(&capture, &self.workspace_dir, &path, &branch, &base).await
        {
            emitter.emit(log(
                "error",
                format!(
                    "could not create an isolated worktree for issue `{issue_id}`: {err}; it will \
                     work directly in the shared workspace."
                ),
            ));
            return None;
        }
        let worktree = Worktree { branch, path, base };
        self.issue_worktrees
            .lock()
            .expect("issue worktrees lock")
            .insert(issue_id.to_string(), worktree.clone());
        Some(worktree)
    }

    /// The isolated [worktree](Worktree) issue `issue_id` is working in, when it has one. A read —
    /// unlike [`ensure_issue_worktree`](Self::ensure_issue_worktree) it never creates one — so a
    /// reviewer joins the tree its issue is already in rather than making a second copy of it.
    fn issue_worktree(&self, issue_id: &str) -> Option<Worktree> {
        self.issue_worktrees
            .lock()
            .expect("issue worktrees lock")
            .get(issue_id)
            .cloned()
    }

    /// Forget issue `issue_id`'s worktree, returning it — called once the branch has been merged or
    /// discarded, so a later read cannot hand an agent a checkout that no longer exists.
    fn take_issue_worktree(&self, issue_id: &str) -> Option<Worktree> {
        self.issue_worktrees
            .lock()
            .expect("issue worktrees lock")
            .remove(issue_id)
    }

    /// The directory an agent working issue `issue_id` is rooted at: its
    /// [worktree](Self::issue_worktree) when it has one, else the shared workspace.
    fn issue_workspace(&self, issue_id: &str) -> PathBuf {
        self.issue_worktree(issue_id)
            .map(|wt| wt.path)
            .unwrap_or_else(|| self.workspace_dir.clone())
    }

    /// The commit the review of `issue_id` diffs its work against: the commit its worktree branched
    /// from, else the run [baseline](Self::baseline_commit). `None` when no git baseline exists.
    fn issue_baseline(&self, issue_id: &str) -> Option<String> {
        self.issue_worktree(issue_id)
            .map(|wt| wt.base)
            .or_else(|| self.baseline_commit().map(str::to_string))
    }

    /// The [agent profiles](GgAgentConfig) that must approve `issue_id`, in the order they were
    /// named when it was filed — or an error naming the first of them this run does not
    /// [declare](Self::declared_profile).
    ///
    /// The two ways this can come back with nobody to dispatch are **not** the same thing, and
    /// telling them apart is the whole of what the check buys. An issue filed without reviewers
    /// named nobody: an empty list is the honest answer, and its
    /// [caller](run_issue_review) approves the issue on it, because there really is no gate. An
    /// issue whose named reviewer resolves to no profile named *somebody* — the gate it asked for
    /// is in the record and is not in the run — and dropping that name would turn a review its
    /// filer demanded into a merge nobody ever looked at, which is precisely the outcome the
    /// board's review path exists to prevent.
    ///
    /// As everywhere else a profile name is resolved, an undeclared one is a **gg defect** rather
    /// than a condition to recover from: the board holds a filer's reviewers to its own
    /// [reviewer roster](crate::board::IssuePolicy::reviewers) at file time, and [launch
    /// validation](crate::validate::validate_launch) rejects a roster naming a profile the set does
    /// not declare — so
    /// no configuration and no model can produce a name this fails on.
    fn reviewer_slots(&self, issue_id: &str) -> Result<Vec<String>, String> {
        let reviewers = self.board.issue_reviewers(issue_id);
        if let Some(missing) = reviewers
            .iter()
            .find(|name| self.declared_profile(name).is_none())
        {
            return Err(format!(
                "its reviewer `{missing}` is not an agent profile this run declares"
            ));
        }
        Ok(reviewers)
    }

    /// The **per-file summary** of `issue_id`'s work against its [review baseline](Self::issue_baseline)
    /// — the map of what changed that its reviewers are shown. Read from the issue's own worktree
    /// (or the shared workspace when it has none). Empty when no baseline exists, and empty when the
    /// git call itself fails, which keeps a review resilient rather than aborting it. Serialized on
    /// the shared [git lock](Self::git_lock) since it stages the index transiently.
    ///
    /// A reviewer is dispatched **into the worktree it is reviewing**, so it reads the code itself
    /// rather than being handed a patch of it: a full diff of a real change carries every generated
    /// file it touched (lockfiles above all), which bloats the prompt without telling the reviewer
    /// anything it could not read for itself.
    async fn review_changes(&self, issue_id: &str) -> String {
        let Some(baseline) = self.issue_baseline(issue_id) else {
            return String::new();
        };
        let dir = self.issue_workspace(issue_id);
        let _guard = self.git_lock.lock().await;
        git::diff_stat_since(&self.git_capture(ROOT_AGENT_ID), &dir, &baseline)
            .await
            .unwrap_or_default()
    }

    /// Append `record` to the [review history](Self::issue_reviews) of `issue_id`.
    fn record_review(&self, issue_id: &str, record: ReviewRecord) {
        self.issue_reviews
            .lock()
            .expect("issue reviews lock")
            .entry(issue_id.to_string())
            .or_default()
            .push(record);
    }

    /// The [review history](Self::issue_reviews) of `issue_id` as a reviewer's brief recounts it —
    /// empty when nothing has been reviewed yet, which renders no history section.
    ///
    /// A reviewer that cannot see what a previous round already asked for re-litigates it, and a
    /// second reviewer in the same round has no way to know the first one approved. Handing over the
    /// record is what makes the rounds cumulative rather than independent.
    fn review_history(&self, issue_id: &str) -> Vec<ReviewRecordView> {
        let reviews = self.issue_reviews.lock().expect("issue reviews lock");
        reviews
            .get(issue_id)
            .map(|records| {
                records
                    .iter()
                    .map(|record| ReviewRecordView {
                        reviewer: record.reviewer.clone(),
                        approved: record.approved,
                        items: record.items.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    // -- Project-management auto-dispatch (crate::board) ------------------------------------------
    //
    // These five methods are the orchestrator's half of the [project-management](crate::board)
    // capability: the board store owns *what* is dispatchable and the retry bookkeeping; this owns
    // the *spawning* of a top-level agent per actionable issue and the waking of agents blocked in
    // a `wait_for_issue`. All are no-ops when the capability is off (the board is disabled).

    /// **Pump the dispatcher and wake ready issue-waiters** after any board change — the single
    /// entry point the loop calls when a board tool mutates the shared board, and the completion
    /// path calls when an assigned agent finishes. It (1) wakes every agent whose awaited issue has
    /// reached a terminal state, then (2) spawns a top-level agent for every issue that has become
    /// actionable. It does **not** emit the [`BoardState`](GgTelemetryKind::BoardState) telemetry —
    /// the caller does that after (in the loop, [`record_tool_result`] already re-emits it), so the
    /// snapshot reflects the assignments this made.
    fn pump_and_wake(self: &Arc<Self>, emitter: &Emitter) {
        self.wake_settled_issue_waiters();
        self.pump_dispatch(emitter);
    }

    /// [Pump and wake](Self::pump_and_wake) **and** re-emit the board state — the variant the
    /// [completion path](run_agent) uses, where there is no following `record_tool_result` to emit
    /// the snapshot.
    fn on_issue_progress(self: &Arc<Self>, emitter: &Emitter) {
        self.pump_and_wake(emitter);
        if let Some(state) = self.board.state_event() {
            emitter.emit(state);
        }
    }

    /// Spawn a **top-level agent** for every issue that is [dispatchable now](BoardRuntime::dispatchable_ids).
    /// Each dispatch atomically [claims](BoardRuntime::assign_issue) an issue and takes back the
    /// **agent id the board minted for it** — named after the issue and the attempt (`AUTH-1.0i`) —
    /// then spawns that agent with the issue's brief. Two concurrent pumps cannot both take one issue:
    /// the loser's claim simply returns `None`, and because the id is minted *by* the claim it never
    /// burns an attempt number either. The agents are top-level (no parent, depth 0), so they surface
    /// as their own roots in the Agents tree.
    ///
    /// A run that has [faulted](crate::fault) dispatches nothing. The claim is what would make the
    /// issue `in_progress` and mint an agent for it, and the agent it minted would read the latch at
    /// its first turn boundary and stop there — leaving the board saying an issue was attempted when
    /// the truth is that the run ended before it was reached. Left unclaimed, it stays open, which is
    /// what happened. Waking ([`pump_and_wake`](Self::pump_and_wake) does that first) is unaffected:
    /// an agent suspended on an issue has to be released whatever ends the run.
    fn pump_dispatch(self: &Arc<Self>, emitter: &Emitter) {
        if self.fault.raised().is_some() {
            return;
        }
        for issue_id in self.board.dispatchable_ids() {
            if let Some(agent_id) = self.board.assign_issue(&issue_id) {
                let brief = self.issue_brief_or_fallback(&issue_id);
                emitter.emit(log(
                    "info",
                    format!("dispatching issue `{issue_id}` to agent `{agent_id}`."),
                ));
                self.spawn_issue_agent(agent_id, issue_id, brief, 0, emitter);
            }
        }
    }

    /// **Re-dispatch** issue `issue_id` to a fresh top-level agent after a failed attempt, recording
    /// its new `retry` count. A no-op if the board no longer accepts it (already terminal).
    fn redispatch_issue(self: &Arc<Self>, issue_id: &str, retry: u32, emitter: &Emitter) {
        if let Some(agent_id) = self.board.redispatch_issue(issue_id, retry) {
            let brief = self.issue_brief_or_fallback(issue_id);
            emitter.emit(log(
                "info",
                format!(
                    "re-dispatching issue `{issue_id}` (attempt {}) to agent `{agent_id}`.",
                    retry + 1
                ),
            ));
            self.spawn_issue_agent(agent_id, issue_id.to_string(), brief, retry, emitter);
        }
    }

    /// **Reopen** issue `issue_id` after a review requested changes: dispatch it again to a fresh
    /// agent under its own assigned profile, driven by its brief plus the reviewer's items, in the
    /// worktree its earlier attempt already produced.
    ///
    /// The retry count is passed through unchanged — rework asked for by a reviewer is not a failed
    /// attempt, and charging it against the retry budget would let a thorough reviewer fail an issue
    /// that is progressing perfectly well.
    fn reopen_issue_for_review(
        self: &Arc<Self>,
        issue_id: &str,
        items: &[String],
        emitter: &Emitter,
    ) {
        let retry = self.board.issue_retries(issue_id);
        let Some(agent_id) = self.board.redispatch_issue(issue_id, retry) else {
            return;
        };
        let brief = build_fix_brief(&self.issue_brief_or_fallback(issue_id), items);
        emitter.emit(log(
            "info",
            format!(
                "the review of issue `{issue_id}` requested {} change(s); re-dispatching it to \
                 agent `{agent_id}`.",
                items.len()
            ),
        ));
        self.spawn_issue_agent(agent_id, issue_id.to_string(), brief, retry, emitter);
    }

    /// The issue's [brief](BoardRuntime::issue_brief), or a bare fallback if it vanished between the
    /// claim and this read (it cannot normally, since the claim just touched it).
    fn issue_brief_or_fallback(&self, issue_id: &str) -> String {
        self.board
            .issue_brief(issue_id)
            .unwrap_or_else(|| format!("Implement issue `{issue_id}`."))
    }

    /// Build and schedule one top-level [issue](crate::board) agent: resolve its client on the
    /// primary slot, mint its wiring, and `tokio::spawn` it through [`run_agent`] with the
    /// [`Issue`](AgentRole::Issue) role, registering its handle so the session joins it. If the
    /// issue names no assignee, or the assignee's client cannot resolve (an undeclared profile, a
    /// missing credential), the issue is [failed](BoardRuntime::fail_issue) and its waiters woken
    /// rather than left stuck [`InProgress`](crate::board::IssueStatus::InProgress) — and, when the
    /// failure was gg's, the run ends with it ([`abort_issue_dispatch`](Self::abort_issue_dispatch)).
    fn spawn_issue_agent(
        self: &Arc<Self>,
        agent_id: String,
        issue_id: String,
        brief: String,
        retry: u32,
        emitter: &Emitter,
    ) {
        // Dispatched issue agents run under the profile the issue was assigned to when it was
        // filed — and under nothing else. An assignee this run does not declare cannot be filed
        // (the board holds a filer to its own implementers) and cannot be configured (launch
        // validation rejects it), so one arriving here is a gg defect; it fails the issue below
        // rather than dispatching under the root, because an issue visibly failed is something an
        // operator can act on and an issue quietly implemented by the wrong agent is not — and it
        // ends the run, because an issue nobody ever worked leaves a tree that cannot be scored as
        // though the model had produced it.
        let Some(slot) = self.issue_profile(&issue_id) else {
            return self.abort_issue_dispatch(
                &issue_id,
                None,
                "it names no assignee to dispatch it to",
                DispatchFault::Gg,
                emitter,
            );
        };
        let binding = match profile_binding(&self.caps, &slot) {
            Ok(binding) => binding,
            Err(err) => {
                return self.abort_issue_dispatch(
                    &issue_id,
                    Some(&slot),
                    &err,
                    DispatchFault::Gg,
                    emitter,
                );
            }
        };
        // Bound by what it was dispatched *for*, never by its id: this agent has no parent, and
        // its id came off the board rather than out of any agent's turn loop. Resolved before the
        // client so the resolution can *state* whose it is.
        //
        // The key is **which dispatch of this issue** this is, not the `retry` count it is also
        // handed. They are not the same number: a review that requests changes re-dispatches the
        // issue to a fresh agent and deliberately passes the retry count through unchanged (rework
        // asked for by a reviewer is not a failed attempt), so two genuinely different agents would
        // otherwise carry one identical origin — and a reconstruction binding on provenance would
        // serve both of them the first one's recorded turns. The ordinal is board state exactly as
        // the retry count is: a reconstruction re-derives it by dispatching the same issues in the
        // same order.
        let origin = GgSessionAgentOrigin::IssueAttempt {
            issue: issue_id.clone(),
            attempt: self.next_ordinal(format!("issue:{issue_id}")),
        };
        let client = match self
            .factory
            .client_for_agent(&binding, &AgentIdentity::agent(origin.clone()))
        {
            Ok(client) => client,
            Err(err) => {
                // The same split the [agent-side resolution](resolve_agent_client) makes, for the
                // same reason: a refused credential is the operator's to supply and fails this
                // issue alone, while anything else is a configuration gg's own launch validation
                // promised could not exist.
                let whose = if err.is_auth_failure() {
                    DispatchFault::Credential
                } else {
                    DispatchFault::Gg
                };
                return self.abort_issue_dispatch(
                    &issue_id,
                    Some(&slot),
                    &err.to_string(),
                    whose,
                    emitter,
                );
            }
        };
        let agent = Agent {
            id: agent_id,
            parent_id: None,
            depth: 0,
            profile_id: slot,
            fsm: None,
        };
        let role = AgentRole::Issue {
            brief,
            issue_id: issue_id.clone(),
            retry,
        };
        let (_inbox_tx, inbox_rx) = mpsc::unbounded_channel();
        let orch = Arc::clone(self);
        let spawn_emitter = emitter.clone();
        // The task's own copies of the agent's identity: the `agent` value itself is moved into it.
        let (task_id, task_slot) = (agent.id.clone(), agent.profile_id.clone());
        let dispatched_slot = task_slot.clone();
        let task = AgentTask::spawned(&task_id, &task_slot, async move {
            // Every issue works in its own worktree, created on its first dispatch and reused by
            // every later agent that touches it (a retry, a review round, its reviewers). Isolation
            // that is unavailable is logged there and degrades to the shared workspace rather than
            // failing the issue.
            //
            // Created **inside the spawned task**, not in the dispatch above, because a checkout of
            // an `npm install`-sized tree takes seconds and this dispatcher runs on the caller's
            // thread — inside whichever agent's tool call happened to make the issue actionable.
            // Doing it here charges the wait to the agent that is about to use the worktree, and
            // leaves the dispatching agent's turn alone. The agent's own workspace is resolved from
            // the map after this, so it still starts in the worktree it was given.
            //
            // It is also the one piece of an agent's task that runs *before* [`run_agent`]'s own
            // [teardown](AgentTeardown) exists, so its unwind is caught here: an issue whose
            // checkout panicked would otherwise stay `InProgress` for ever, and every agent
            // suspended in a `wait_for_issue` on it would wait out the run's deadline.
            let prepared = AssertUnwindSafe(orch.ensure_issue_worktree(&issue_id, &spawn_emitter))
                .catch_unwind()
                .await;
            if let Err(payload) = prepared {
                orch.abort_issue_dispatch(
                    &issue_id,
                    Some(&dispatched_slot),
                    &format!(
                        "preparing its worktree panicked: {}",
                        panic_message(&*payload)
                    ),
                    DispatchFault::Gg,
                    &spawn_emitter,
                );
                return;
            }
            run_agent(orch, agent, role, client, inbox_rx, origin).await;
        });
        self.tasks.lock().expect("subagent tasks lock").push(task);
    }

    /// Give up on dispatching `issue_id`: mark it [`Failed`](crate::board::IssueStatus::Failed),
    /// wake its waiters, and re-emit the board — so the reason surfaces on the board rather than
    /// hanging every dependent on an issue that will never move.
    ///
    /// `slot` is the assignee the dispatch was for, and `None` when the issue named none at all —
    /// the one case with no slot to blame, which the message must therefore not invent.
    ///
    /// When the failure was gg's ([`DispatchFault::Gg`]) the run ends too, on the run's
    /// [fault latch](crate::fault). A failed issue is visible, but visible is not the same as
    /// comparable: the tree this run leaves is missing whatever that issue was for, because gg
    /// could not stand up the agent that would have done it, and a run scored on that tree reports
    /// our defect as the model's shortfall.
    fn abort_issue_dispatch(
        self: &Arc<Self>,
        issue_id: &str,
        slot: Option<&str>,
        err: &str,
        whose: DispatchFault,
        emitter: &Emitter,
    ) {
        let on_slot = slot
            .map(|slot| format!(" on the `{slot}` slot"))
            .unwrap_or_default();
        let consequence = match whose {
            DispatchFault::Gg => "marking it failed, and the run ends with it: this is a gg defect",
            DispatchFault::Credential => "marking it failed",
        };
        emitter.emit(log(
            "error",
            format!("cannot dispatch issue `{issue_id}`{on_slot}: {err}; {consequence}."),
        ));
        if matches!(whose, DispatchFault::Gg) {
            self.fault.in_dispatch(issue_id, slot, err);
        }
        self.board.fail_issue(issue_id);
        self.on_issue_progress(emitter);
    }

    /// Wake every agent whose awaited issue has **settled** — reached a terminal state, or become
    /// one that can never reach one. Called on any board change; idempotent (an already-woken issue
    /// has no waiters left).
    ///
    /// The second half is the board change nothing else answers. Failing an issue does not
    /// [cascade](crate::board::BoardStore::fail_issue), so an issue behind it stays open and stops
    /// dispatchable for the rest of the run: it will never be done, and it will never be failed
    /// either, so a wait that resolves only on a terminal state resolves never. That is a hang on
    /// an otherwise healthy run — the awaited work simply is not going to happen — and the waiting
    /// agent is told exactly that instead, which is an answer it can act on and a board it can
    /// still repair.
    ///
    /// Which is the reason waking is not answering: somebody may repair that board before the woken
    /// agent has a slot to resume on, and the wait is then [answered](issue_wait_result) on the
    /// board as it stands rather than on the state that woke it.
    ///
    /// The walk is in issue-id order, because [`issue_waits`](Self::issue_waits) is ordered — see
    /// the note there. This is the one place gg's own state was walked rather than looked up, and
    /// so the one place a hasher's seed reached a run's behaviour.
    fn wake_settled_issue_waiters(&self) {
        // Snapshot the awaited ids without holding the waits lock across the board lock.
        let awaited: Vec<String> = {
            let waits = self.issue_waits.lock().expect("issue waits lock");
            waits.keys().cloned().collect()
        };
        for issue_id in awaited {
            if self.board.issue_is_terminal(&issue_id)
                || self.board.unsatisfiable_blocker(&issue_id).is_some()
            {
                self.wake_issue_waiters(&issue_id);
            }
        }
    }

    /// Mark every agent waiting on `issue_id` ready to resume, removing them from the registry.
    ///
    /// It says only that `issue_id` has moved in a way worth resuming for — it went terminal, or it
    /// [settled](Self::wake_settled_issue_waiters) into a state nothing can carry it out of. It does
    /// **not** say what the wait will report, and it is not the moment the wait's condition is
    /// judged: a waiter marked ready here resumes when the scheduler grants it a slot, which is
    /// later, and in the meantime any agent still running can move the issue again — reviving a
    /// failed blocker, re-opening a finished issue. What a resumed wait reports is therefore read
    /// off the board at the moment it resumes ([`issue_wait_result`]), never inferred from the fact
    /// that something once woke it.
    fn wake_issue_waiters(&self, issue_id: &str) {
        let tokens = self
            .issue_waits
            .lock()
            .expect("issue waits lock")
            .remove(issue_id);
        for token in tokens.into_iter().flatten() {
            self.scheduler.mark_ready(token);
        }
    }

    /// Begin an agent's [`wait_for_issue`](handle_wait_for_issue) on `issue_id`: if the issue is
    /// already terminal, return [`AlreadyTerminal`](IssueWaitOutcome::AlreadyTerminal) so the caller
    /// does not block; otherwise **free the caller's running slot** (and the
    /// [exclusivity key](Self::exclusive_key) `key` it holds it under, so a
    /// [persistent](crate::persistence) agent suspended here releases its profile to the
    /// next queued instance) and register it as a blocked
    /// waiter on the issue, returning the resume channel it awaits. The post-registration
    /// re-check closes the race where the issue goes terminal between the first check and the
    /// registration (the caller would otherwise never be woken).
    ///
    /// `hold` is the caller's [record of holding that slot](SlotHold), given up with it and taken
    /// again on the resume — so an agent that [panics](AgentTeardown) while suspended here does not
    /// give back a slot the agent it is waiting for is running on.
    fn begin_issue_wait(
        self: &Arc<Self>,
        issue_id: &str,
        key: Option<&str>,
        hold: &SlotHold,
    ) -> IssueWaitOutcome {
        if self.board.issue_is_terminal(issue_id) {
            return IssueWaitOutcome::AlreadyTerminal;
        }
        let (token, rx) = self.scheduler.block_and_release(key, hold);
        self.issue_waits
            .lock()
            .expect("issue waits lock")
            .entry(issue_id.to_string())
            .or_default()
            .push(token);
        // Close the register-after-completion race: if the issue completed while we were
        // registering, wake ourselves now so the freed slot is reclaimed and the wait resolves.
        if self.board.issue_is_terminal(issue_id) {
            self.wake_issue_waiters(issue_id);
        }
        IssueWaitOutcome::Blocked { token, rx }
    }

    /// Release a waiter that the run [breaking](crate::fault) has stranded: its awaited issue is
    /// never going to move, because a faulted run dispatches nothing further, so the agent is made
    /// ready on the terms a woken one is and resumes on the next free slot.
    ///
    /// Marking it ready rather than handing it its slot back outright is what keeps the
    /// [parallelism cap](SubagentConfig::max_parallel) honest through the wind-down: every agent
    /// holding a slot is winding down too and gives it up within a turn, so the released waiter is
    /// granted one and reaches the turn boundary where it reads the latch — the same one-turn bound
    /// every other agent winds down under.
    ///
    /// Its registration in [`issue_waits`](Self::issue_waits) is left where it is. A token that no
    /// longer names a waiter is a no-op to [`mark_ready`](Scheduler::mark_ready), and the run is
    /// ending, so tidying the table would buy nothing a reader of it could see.
    fn release_issue_wait_on_fault(&self, token: WaiterToken) {
        self.scheduler.mark_ready(token);
    }
}

/// The outcome of [beginning an issue wait](Orchestrator::begin_issue_wait).
enum IssueWaitOutcome {
    /// The awaited issue is already terminal (done, failed, or gone) — the caller keeps its slot
    /// and does not block.
    AlreadyTerminal,
    /// The caller freed its running slot and must await this channel; it resolves once the awaited
    /// issue [settles](Orchestrator::wake_settled_issue_waiters) **and** a slot is free to resume
    /// on. The token comes back with it so the caller can
    /// [release itself](Orchestrator::release_issue_wait_on_fault) if the run breaks first.
    Blocked {
        /// This waiter's registration with the scheduler.
        token: WaiterToken,
        /// The resume channel.
        rx: oneshot::Receiver<()>,
    },
}

/// Handle `wait_for_issue`: suspend this agent until the named [board issue](crate::board) reaches
/// a terminal state ([`Done`](IssueStatus::Done) or [`Failed`](IssueStatus::Failed)).
///
/// An unknown issue is a [not-found](ToolFailure::NotFound) error. An already-terminal issue returns
/// immediately. Otherwise the agent [frees its slot and blocks](Orchestrator::begin_issue_wait) on
/// the orchestrator's issue-wait registry — animating the live tree with a
/// [`Blocked`](GgAgentStatus::Blocked)→[`Running`](GgAgentStatus::Running) transition — until the
/// issue's assigned agent completes or fails it, then reports which. gg refuses to submit a
/// [cyclic dependency](crate::board), so waiting can never deadlock on a cycle; a failed issue is
/// terminal, so a wait on one that ultimately fails resolves rather than hanging.
///
/// Three things end the wait without the issue ever becoming terminal, and each is
/// [refused](ToolFailure) rather than dressed up as a resolution — the awaited work did not happen,
/// and a caller that cannot tell the difference will go on to report as done work nobody did. The
/// issue [can never get past a blocker](BoardRuntime::unsatisfiable_blocker) of its own; gg
/// [broke](crate::fault) and the run is ending; or the thing that woke this agent was
/// [undone](unsettled_wait_result) before it got a slot to resume on, leaving an issue as live as
/// when it started waiting.
async fn handle_wait_for_issue(
    project: &ProjectContext,
    agent: &Agent,
    board: &BoardRuntime,
    emitter: &Emitter,
    call: &ToolCall,
) -> ToolOutcome {
    let issue_id = match call.arguments.get("issueId").and_then(Value::as_str) {
        Some(id) if !id.trim().is_empty() => id.trim().to_string(),
        _ => {
            return ToolOutcome::failed(
                ToolFailure::InvalidArgument,
                "missing required argument `issueId`",
            );
        }
    };
    wait_for_issue_by_id(project, agent, board, emitter, &issue_id).await
}

/// Suspend this agent until `issue_id` is terminal, then report which — or say why that is never
/// going to happen. The core of [`handle_wait_for_issue`] once the id is in hand.
///
/// It is a function of its own because two paths reach the same wait: the native tool-calling loop,
/// which parses the id off a `wait_for_issue` [`ToolCall`] and calls it through
/// [`handle_wait_for_issue`]; and the responses-as-code loop, which performs the *deferred* waits a
/// program [registered](code::LoopOperationApi::register_issue_wait) once that program has ended, calling this
/// directly for each recorded id. Both share the self-issue guard, the not-found check, the
/// already-terminal short-circuit, the refusals that answer a wait nothing settled, and the
/// slot-freeing block, so neither can drift from the other.
async fn wait_for_issue_by_id(
    project: &ProjectContext,
    agent: &Agent,
    board: &BoardRuntime,
    emitter: &Emitter,
    issue_id: &str,
) -> ToolOutcome {
    // An agent cannot wait on the very issue it was dispatched to implement — it would block itself
    // forever (nothing else completes its issue). Guide it to do the work instead.
    if project.assigned_issue.as_deref() == Some(issue_id) {
        return ToolOutcome::failed(
            ToolFailure::InvalidArgument,
            format!("cannot wait on issue `{issue_id}`: it is this agent's own assigned issue"),
        );
    }
    let Some(status) = board.issue_status(issue_id) else {
        return ToolOutcome::failed(
            ToolFailure::NotFound,
            format!("no issue `{issue_id}` on the board"),
        );
    };
    if status.is_terminal() {
        return issue_wait_result(board, issue_id);
    }
    // Neither condition that is knowable *before* suspending is worth suspending for. The
    // unsatisfiable one is checked here as well as on the wake-up because a blocker can already
    // have failed when the call is made, and the fault one because a run that has broken will never
    // move this issue: an agent that blocked anyway would have to be released again immediately,
    // having freed and re-taken its slot for nothing. (The third — an issue that goes live again —
    // is a property of the resumption and cannot be seen from here.)
    if let Some(blocker) = board.unsatisfiable_blocker(issue_id) {
        return unsatisfiable_wait_result(issue_id, &blocker);
    }
    if let Some(fault) = project.orch.fault.raised() {
        return faulted_wait_result(issue_id, fault);
    }
    let key = project.orch.exclusive_key(&agent.profile_id);
    match project
        .orch
        .begin_issue_wait(issue_id, key.as_deref(), &project.hold)
    {
        IssueWaitOutcome::AlreadyTerminal => {}
        IssueWaitOutcome::Blocked { token, mut rx } => {
            if project.orch.multi_agent() {
                emitter.emit(agent_blocked_on(format!("issue `{issue_id}`")));
            }
            // Two things can end this suspension, and the agent has to survive both. The sender is
            // held by the scheduler until this agent is granted a slot after its issue settles (a
            // dropped sender, impossible here, would also end the wait) — and the run's fault latch
            // fires if gg breaks meanwhile, which is the only other way out: a faulted run stops
            // dispatching, so the issue this is suspended on may never move again, and an agent
            // inside a tool call reaches no turn boundary to read the latch at.
            let faulted = tokio::select! {
                // Biased, and the fault first, for the reason the latch keeps the *first* fault: a
                // run that broke and then settled this issue settled it as a consequence of the
                // break, and both arms are ready at once every time a wind-down fails the very
                // issue somebody was waiting on. An unbiased pick would report the cause on some
                // runs and the consequence on others, from one recorded run to the next.
                biased;
                () = project.orch.fault.until_raised() => {
                    project.orch.release_issue_wait_on_fault(token);
                    // Still awaited, because the release goes through the scheduler: this agent
                    // resumes when it is granted a slot, exactly as a woken one does, rather than
                    // running on beside the agents that hold them.
                    let _ = rx.await;
                    project.orch.fault.raised().map(str::to_string)
                }
                _ = &mut rx => None,
            };
            if project.orch.multi_agent() {
                emitter.emit(agent_status(GgAgentStatus::Running));
            }
            if let Some(fault) = faulted {
                return faulted_wait_result(issue_id, &fault);
            }
        }
    }
    // Report what the board says **now**, which is the only thing this agent can honestly report.
    // What woke it is not an answer: a wake-up says the issue moved once, and this agent resumed
    // later, when a slot came free.
    issue_wait_result(board, issue_id)
}

/// The refusal a wait on an issue that can never become terminal returns: `issue_id` sits behind
/// `blocker`, which will never be [`Done`](IssueStatus::Done), so nothing will ever dispatch it.
///
/// A refusal rather than a resolution, because the wait did not complete — the issue is still open,
/// and reporting it as anything else would have the caller act on work that is not going to happen.
/// The blocker is named because it is the thing to act on: the agent can drop the dependency, refile
/// the blocked work, or give up on it and say so, and it can do none of those from "still waiting".
fn unsatisfiable_wait_result(issue_id: &str, blocker: &str) -> ToolOutcome {
    ToolOutcome::failed(
        ToolFailure::Conflict,
        format!(
            "issue `{issue_id}` can never be finished: it is blocked by `{blocker}`, which is \
             failed or gone and will never be done, so no agent will be dispatched to it. Nothing \
             will complete it — drop the dependency or refile the work if it still matters."
        ),
    )
}

/// The refusal a wait released by the run [breaking](crate::fault) returns.
///
/// It never reaches a model: the agent it is handed to reads the same latch at the turn boundary it
/// is now free to reach, and stops there. It is written for the record and the operator — the wait
/// is the last thing that agent did, and "waited for issue `X`" with no outcome behind it is the
/// shape of exactly the hang this replaces.
fn faulted_wait_result(issue_id: &str, fault: &str) -> ToolOutcome {
    ToolOutcome::failed(
        ToolFailure::Refused,
        format!(
            "the wait on issue `{issue_id}` was released without an answer: {fault}. The run is \
             ending, and nothing further will be dispatched to that issue."
        ),
    )
}

/// What a `wait_for_issue` on `issue_id` reports, read off `board` **at the moment the wait is
/// answered** — the one place that decision is made, for a wait that never suspended and for one
/// that resumed hours later alike.
///
/// A success means the wait *completed*: the issue is terminal and the caller is told which way, so
/// it can branch on it, or the issue left the board entirely, which is as settled as an issue gets.
/// Anything else is a [refusal](unsettled_wait_result), because the awaited work has not happened —
/// and an agent told its wait completed on work nobody did will go on to report that work as done.
///
/// It reads the board rather than taking a status because a status is a snapshot and the two
/// callers hold theirs at different distances from this line. The resuming one is the reason: it was
/// [marked ready](Orchestrator::wake_issue_waiters) when its issue settled, but it resumes only once
/// the scheduler grants it a slot, and in that window any agent still running can move the issue
/// again — `update_issue` accepts every status, so a `Failed` blocker can go back to `Open` and a
/// wait released because nothing could ever finish it wakes to an issue somebody is about to work
/// on after all. Passing the old snapshot in is how such a wait came to answer "Issue X is open."
/// as a success.
fn issue_wait_result(board: &BoardRuntime, issue_id: &str) -> ToolOutcome {
    let Some(status) = board.issue_status(issue_id) else {
        return ToolOutcome::ok(
            format!("issue `{issue_id}` is no longer on the board."),
            format!("waited for issue `{issue_id}` (removed)"),
        );
    };
    match status {
        IssueStatus::Done => ToolOutcome::ok(
            format!("Issue `{issue_id}` is done."),
            format!("issue `{issue_id}` done"),
        ),
        IssueStatus::Failed => ToolOutcome::ok(
            format!(
                "Issue `{issue_id}` failed — its assigned agent could not complete it within the \
                 retry budget. Anything depending on it will stay blocked."
            ),
            format!("issue `{issue_id}` failed"),
        ),
        // Still live. Whether that is worth waiting for again is the difference between the two
        // refusals: an issue behind a blocker that will never be done is a board to repair, and one
        // that is merely unfinished is work still in flight.
        IssueStatus::Open | IssueStatus::InProgress | IssueStatus::InReview => {
            match board.unsatisfiable_blocker(issue_id) {
                Some(blocker) => unsatisfiable_wait_result(issue_id, &blocker),
                None => unsettled_wait_result(issue_id, status),
            }
        }
    }
}

/// The refusal a wait returns when it is answered on an issue that is **still live**: not terminal,
/// not gone, and not stuck behind anything — so nothing about it has been settled.
///
/// It is reachable in one way, and on a perfectly healthy run. The waiter was woken because its
/// issue had settled — behind a failed blocker, say — and by the time the scheduler granted it a
/// slot another agent had moved the board back: the blocker re-opened, the dependency dropped, the
/// issue re-filed. What settled it is gone, and the issue is now ordinary open work that somebody
/// may well be about to do.
///
/// Reported as a refusal, and phrased as an invitation to wait again, because the caller's question
/// — "is this finished?" — has no answer yet, and the ways of getting one wrong are both bad: a
/// success would tell an agent to build on work nobody has done, and silently re-suspending would
/// spend the run's parallelism on a wait whose reason to exist has changed since it was made.
fn unsettled_wait_result(issue_id: &str, status: IssueStatus) -> ToolOutcome {
    ToolOutcome::failed(
        ToolFailure::Conflict,
        format!(
            "the wait on issue `{issue_id}` ended without it finishing: it is {} again, and \
             nothing about it is settled — whatever stopped it has since been undone. Wait on it \
             again if it still matters.",
            status_word(status)
        ),
    )
}

/// A human word for an [`IssueStatus`], for the [refusal](unsettled_wait_result) that names the
/// state a wait was answered on.
fn status_word(status: IssueStatus) -> &'static str {
    match status {
        IssueStatus::Open => "open",
        IssueStatus::InProgress => "in progress",
        IssueStatus::InReview => "in review",
        IssueStatus::Done => "done",
        IssueStatus::Failed => "failed",
    }
}

/// One spawned agent task, kept with the identity of the agent it is running.
///
/// The identity travels with the handle because of what a [join](join_spawned_agents) can find: a
/// task that did not complete panicked *outside* [`run_agent`]'s own teardown, and a diagnostic for
/// that has nothing else to name the agent by. A bare `JoinHandle` made the one thing an operator
/// needs — which agent — the one thing the join could not say.
struct AgentTask {
    /// The agent this task is running.
    id: String,
    /// The [profile](GgAgentConfig::id) it was dispatched under.
    profile_id: String,
    /// The task itself.
    handle: JoinHandle<()>,
}

impl AgentTask {
    /// Spawn `run` as the task of the agent `id` running under the profile `profile_id`.
    fn spawned(id: &str, profile_id: &str, run: impl Future<Output = ()> + Send + 'static) -> Self {
        Self {
            id: id.to_string(),
            profile_id: profile_id.to_string(),
            handle: tokio::spawn(run),
        }
    }
}

/// How an agent driven by [`run_agent`] is dispatched: the [`Root`](Self::Root) driven by the
/// run's build prompt, a [`Sub`](Self::Sub)agent driven by a delegated brief and wired to
/// signal its spawner on completion, or an [`Issue`](Self::Issue) agent gg auto-dispatched to
/// implement a [board issue](crate::board).
enum AgentRole {
    /// The root agent, driven by the run's build prompt.
    Root,
    /// A **top-level** agent gg auto-dispatched to implement a [board issue](crate::board): driven
    /// by the issue's structured brief, tied to its `issue_id`, and — unlike a [`Sub`](Self::Sub) —
    /// answering to no spawner (it has no parent and delivers no return value). When its loop ends
    /// the [completion path](run_agent) sends its issue to review if it *finished*, and otherwise
    /// re-dispatches it (up to the [retry cap](crate::board::BoardCaps::max_retries)) or fails it.
    Issue {
        /// The issue's structured brief that drives the agent (its build prompt).
        brief: String,
        /// The board issue this agent was dispatched to implement (scopes its telemetry, and is
        /// what finishing successfully sends to review).
        issue_id: String,
        /// How many times this issue has already been re-dispatched — `0` on its first attempt.
        /// Compared against the [retry cap](crate::board::BoardCaps::max_retries) when the agent
        /// ends without finishing.
        retry: u32,
    },
    /// A spawned subagent, driven by `brief`, that on completion delivers its
    /// [return value](AgentReturn) on `result`, flips `finished` (so `send_message` stops), and
    /// signals its spawner's [`ParentWait`].
    Sub {
        /// The delegated brief that drives the subagent (its build prompt).
        brief: String,
        /// The board issue this subagent was dispatched against, when any (scopes its telemetry).
        issue_id: Option<String>,
        /// The isolated [worktree](Worktree) this subagent's tools are rooted in, when it was
        /// dispatched into one — an issue's reviewer, which reads the tree its issue is working
        /// in. `None` runs the subagent in the shared main tree.
        ///
        /// The worktree is **not** reconciled here: whoever created it owns its fate — an issue's
        /// is merged when the issue is accepted — because a reviewer and its issue share one tree.
        worktree: Option<Worktree>,
        /// Which [ending calls](EndingRole) this subagent was dispatched with — how it declares the
        /// result its dispatcher is waiting for. A reviewer returns a verdict, a judge names a
        /// winner, everything else reports what it did.
        ending: EndingRole,
        /// The [modules](crate::modules) the spawner offered this subagent, which its own profile
        /// decides whether to bind. Today that is a [share](crate::modules::Module::share) of the
        /// spawner's memories, which a child scoped [`inherited`](MemoryScope::Inherited) or
        /// [`read-only`](MemoryScope::ReadOnly) takes and every other child ignores. Empty for a
        /// detached agent (a reviewer, a judge, a merge agent), which answers to no spawner's
        /// notebook.
        inherited: InheritedModules,
        /// The modules and opening note a [fork](crate::tools::FORK_TOOL) was built with, when this
        /// subagent *is* one: everything its forker held, [cloned](crate::modules::fork_modules) on
        /// the forker's side of the boundary while its window was whole.
        ///
        /// `None` for every ordinary child, which builds its own set from its profile. A child that
        /// carries one skips resolution entirely and opens on the thread it was handed — the same
        /// path an [exec'd](Opening::Carried) successor takes, because it is the same thing seen
        /// from the far side.
        seed: Option<Box<Succession>>,
        /// The wires this subagent answers its spawner on: the [wait condition](ParentWait) it
        /// signals, the channel it delivers its [return value](AgentReturn) on, and the flag that
        /// makes its spawner's `send_message` refuse once it has returned.
        ///
        /// Taken out of the role by [`run_agent`] before anything else reads it, and held by the
        /// [teardown](AgentTeardown) from then on — because they are wires that must be answered on
        /// whether the agent returns *or* panics, and only something outside the driving frame can
        /// promise that. `None` therefore means "already taken", exactly as it does for `seed`
        /// above.
        link: Option<SpawnerLink>,
    },
}

/// An isolated git worktree an agent runs in: its branch, its checkout path, and the commit it
/// branched from.
///
/// An [issue](crate::board) gets a worktree on its first dispatch
/// ([`ensure_issue_worktree`](Orchestrator::ensure_issue_worktree)) that every later agent touching
/// that issue — a retry, a review round's re-dispatch, its reviewers — shares, and which is merged
/// back into the main tree when the issue is accepted.
///
/// [`base`](Self::base) is kept because it is what a diff of the work is taken against: the tree's
/// own `HEAD` moves as the agent commits, and the run baseline is too early once earlier issues have
/// landed.
#[derive(Debug, Clone)]
struct Worktree {
    /// The branch the worktree checks out (for example `gg/issue-3`).
    branch: String,
    /// The worktree's checkout directory — the agent's rooted workspace while it runs.
    path: PathBuf,
    /// The commit the branch was created from — the baseline a review or judge diffs against.
    base: String,
}

/// The resolved worktree-isolation state for a run, computed once at session start and handed to
/// [`Orchestrator::build`].
struct WorktreesSetup {
    /// The committed [baseline](Orchestrator::baseline_commit) sha, when git made the workspace a
    /// repo.
    baseline_commit: Option<String>,
    /// The directory worktree checkouts are created under, `Some` only when isolation is
    /// actually usable this run.
    root: Option<PathBuf>,
}

/// A single agent's [delegation context](crate::subagents), threaded into [`Agent::drive`] when
/// the [subagents](CAPABILITY_SUBAGENTS) capability is on: the [orchestrator](Orchestrator) (to
/// spawn and schedule children) and this agent's [`AgentCtx`] (its inbox, its children, and the
/// wait condition its children signal).
struct SubagentContext {
    /// The shared orchestrator every spawn builds and schedules a child through.
    orch: Arc<Orchestrator>,
    /// This agent's own delegation state.
    ctx: AgentCtx,
    /// What this agent offers the children it spawns: the [modules](crate::modules) a child whose
    /// profile asks for them binds instead of building its own. Taken once, from this agent's own
    /// module set, so a spawn is a handle copy rather than a lookup.
    inherited: InheritedModules,
}

/// A single agent's [project-management](crate::board) context, threaded into [`Agent::drive`] when
/// the [project-management](CAPABILITY_PROJECT_MANAGEMENT) capability is on: the
/// [orchestrator](Orchestrator) (to auto-dispatch actionable issues after a board mutation and to
/// suspend the agent in a `wait_for_issue`) and — when this agent was *itself* auto-dispatched to
/// implement an issue — that issue's id.
#[derive(Clone)]
struct ProjectContext {
    /// The shared orchestrator whose board this agent's tools mutate and whose dispatcher its board
    /// changes drive.
    orch: Arc<Orchestrator>,
    /// The board issue this agent was dispatched to implement, when it was — so the loop frames
    /// `finish` as "return this issue's result" rather than "end the run", and knows the agent is
    /// expected to finish. `None` for the root and for a subagent that was not
    /// issue-dispatched.
    assigned_issue: Option<String>,
    /// This agent's [hold](SlotHold) on its running slot, which a `wait_for_issue` gives up for the
    /// length of the wait. Carried here for the reason [`AgentCtx::hold`] is carried on the
    /// delegation context: the wait is made from a tool call, and the
    /// [teardown](AgentTeardown) that would return the slot on a panic is nowhere near it.
    hold: SlotHold,
}

/// Build and drive one agent to completion: acquire a running slot, resolve its stream and
/// resources, drive its [turn loop](Agent::drive), fold its usage into the shared
/// [accounting](SlotAccounting), and — for a subagent — deliver its [return value](AgentReturn)
/// to its spawner and free its slot (waking the spawner if it was the last child it awaited).
///
/// This is the one path every agent goes through, the root and each spawned subagent alike, so
/// the tree is uniform: recursion is just a subagent whose own loop spawns more agents that come
/// back through here. `client` is resolved by the caller (the root's in `run_with_factory`, a
/// child's at spawn time) so a resolution failure is surfaced where it belongs.
///
/// `origin` is how this agent came to exist, supplied by the caller because only the caller knows
/// it: the role says an agent is a subagent, not whether it is a delegation, an issue's reviewer or
/// the merge agent, and the latter two carry keys (a round, a position) that exist nowhere on the
/// role. It is recorded into the [capture journal](crate::capture) here — at the one point every
/// agent goes through — rather than at each of the five sites that create one, and it is
/// *re-pointed* at each [succession](Handoff), which is the sixth.
///
/// # A panic ends the agent here rather than escaping it
///
/// [`drive_agent`] below is the whole of the above, and this is the frame that catches it unwinding.
/// A panic anywhere under it — the realistic one is a lock some earlier panic poisoned — is the one
/// gg defect the agent that meets it cannot report, because the frame that would read the run's
/// [fault latch](crate::fault) at the next turn boundary is the frame being unwound. Caught here it
/// becomes an ordinary [teardown](AgentTeardown): the fault is latched, the spawner (or the board's
/// waiters) is woken immediately instead of at the run's deadline, the running slot goes back, and
/// the caller is handed the `internal_error` ending it was promised. What a panic allowed to escape
/// this frame does to a run instead is in [`teardown`]'s module docs.
async fn run_agent(
    orch: Arc<Orchestrator>,
    agent: Agent,
    mut role: AgentRole,
    client: Box<dyn ModelClient>,
    inbox_rx: mpsc::UnboundedReceiver<String>,
    origin: GgSessionAgentOrigin,
) -> LoopEnd {
    // An [FSM shell](crate::fsm::is_shell) has no turns of its own: an agent about to run one
    // *becomes* the machine's entry state instead of spawning a child to do it. This is what keeps a
    // machine indistinguishable from an ordinary agent to whoever put it to work — one id in the
    // tree, one scheduler slot, one return value — and it is done before the teardown below, which
    // resolves the exclusivity key: the slot is then acquired under the state agent's own
    // exclusivity rather than the shell's.
    let agent = match orch.machine(&agent.profile_id) {
        Some(machine) => agent.entering(machine),
        None => agent,
    };

    let mut teardown = AgentTeardown::new(&orch, &agent, &origin, &mut role);
    // Bound to a `let` rather than matched on directly: a `match` scrutinee's temporaries outlive
    // the match, and the future borrows the teardown the panic arm has to have back.
    let driven = AssertUnwindSafe(drive_agent(
        orch,
        agent,
        role,
        client,
        inbox_rx,
        origin,
        &mut teardown,
    ))
    .catch_unwind()
    .await;
    match driven {
        Ok(end) => end,
        Err(payload) => teardown.panicked(payload.as_ref()),
    }
}

/// [`run_agent`]'s whole body, in the frame a panic is allowed to unwind.
///
/// Split out for exactly one reason: everything the panic path needs — the exclusivity key the slot
/// is held under, the wires the spawner is waiting on, which instance was running — has to live
/// somewhere the unwind does not pass through, which is the `teardown` this borrows.
#[allow(clippy::too_many_arguments)]
async fn drive_agent(
    orch: Arc<Orchestrator>,
    mut agent: Agent,
    mut role: AgentRole,
    client: Box<dyn ModelClient>,
    inbox_rx: mpsc::UnboundedReceiver<String>,
    origin: GgSessionAgentOrigin,
    teardown: &mut AgentTeardown,
) -> LoopEnd {
    // What this agent was **handed at birth**, when it is a [fork](crate::tools::FORK_TOOL): a copy
    // of everything its forker held. Taken out of the role here, before anything else reads the
    // role, so the rest of this function sees an ordinary subagent.
    let seed = match &mut role {
        AgentRole::Sub { seed, .. } => seed.take().map(|seed| *seed),
        AgentRole::Issue { .. } | AgentRole::Root => None,
    };

    // How this agent came to exist, re-pointed at each succession so the row every incarnation
    // records names the thing that created *it*.
    let mut origin = origin;
    // Its provenance row, written **before** the slot is acquired — which is the point. An agent
    // parked behind the parallelism cap when the run is killed never takes a turn and never pins an
    // input, so a table derived from the entries would have no idea it existed; the reconstruction
    // would then quietly run a smaller fleet than the run did.
    record_session_agent(&orch, &agent, &origin, None);

    // Acquire a running slot before doing anything: a spawned agent blocks here until the
    // scheduler grants one (the root's is granted immediately). This is the parallelism cap. It is
    // taken **once for the whole succession**: a transition is the continuation of work already in
    // progress, and making it queue behind unrelated agents would stall a machine mid-stride.
    orch.scheduler
        .acquire_start(teardown.exclusive(), teardown.hold())
        .await;

    let is_root = matches!(role, AgentRole::Root);
    let issue_id = match &role {
        AgentRole::Sub { issue_id, .. } => issue_id.clone(),
        AgentRole::Issue { issue_id, .. } => Some(issue_id.clone()),
        AgentRole::Root => None,
    };

    // Announce this agent to the tree: its slot/model, depth, the brief it was dispatched with (for
    // a subagent, or an auto-dispatched issue agent), and the isolated worktree branch it runs in
    // when it was dispatched with one. The root carries no brief (it is driven by the build prompt)
    // and always runs in the main tree.
    let brief = match &role {
        AgentRole::Sub { brief, .. } => Some(brief.clone()),
        AgentRole::Issue { brief, .. } => Some(brief.clone()),
        AgentRole::Root => None,
    };
    // The isolated worktree this agent's tools are rooted in, when it has one: an issue agent takes
    // its issue's, a reviewer is handed one at dispatch, and everything else works in the shared
    // main tree.
    let worktree = match &role {
        AgentRole::Sub { worktree, .. } => worktree.clone(),
        AgentRole::Issue { issue_id, .. } => orch.issue_worktree(issue_id),
        AgentRole::Root => None,
    };
    // Which ending calls this agent gets. Only a dispatched subagent can be anything but the
    // default: the root and an issue's implementer are always doing work, never judging it.
    let ending_role = match &role {
        AgentRole::Sub { ending, .. } => *ending,
        AgentRole::Issue { .. } | AgentRole::Root => EndingRole::Standard,
    };
    let worktree_branch = worktree.as_ref().map(|wt| wt.branch.clone());
    // Where this agent's file and shell tools are rooted: its worktree checkout when it has one,
    // else the shared workspace. Resolved here (rather than beside the tool context below) because
    // it is part of the agent's announced identity — a run with worktrees has agents working in
    // *different* directories, and which one an agent is in is not otherwise observable.
    let workspace_dir = match &worktree {
        Some(wt) => wt.path.clone(),
        None => orch.workspace_dir.clone(),
    };
    // The issue this agent was auto-dispatched to implement, if any. It shapes the agent's *prompt*
    // (which names the issue it is working) and its issue-wait guard, but not its toolset: an
    // implementer hands its work back by finishing, not by making a board move, so it needs no board
    // tool it would not otherwise have.
    let assigned_issue = match &role {
        AgentRole::Issue { issue_id, .. } => Some(issue_id.clone()),
        _ => None,
    };
    // What this agent's spawner offered it, when it had one. Only a profile scoped
    // [`inherited`](MemoryScope::Inherited) or [`read-only`](MemoryScope::ReadOnly) binds anything
    // from here; every other profile builds its own state and this is simply unread.
    let no_inheritance = InheritedModules::default();
    let inherited = match &role {
        AgentRole::Sub { inherited, .. } => inherited,
        AgentRole::Issue { .. } | AgentRole::Root => &no_inheritance,
    };

    // The **incarnation** state — what crosses from one instance of this agent to the next.
    //
    // A [succession](Handoff) replaces the running agent with another under a different profile,
    // and everything below is either carried across that boundary or re-resolved on the far side of
    // it. The overwhelming majority of agents go round this loop exactly once, with all four of
    // these at their initial values.
    //
    // The client the incarnation about to start runs on: the one whoever dispatched this agent
    // resolved, and after that the one each succession resolves for its successor from the profile
    // the machine (or the exec) named. It is **carried** across the loop's back edge rather than
    // re-resolved at the top of it, because re-resolving would ask the model seam for a second
    // client on one agent's identity — and a dispatch onto an FSM shell resolved the entry state's
    // profile ([`GgCapabilitySet::dispatched_agent`]), which is the profile this agent is already
    // standing in by the time it gets here, so the client it was handed is the right one.
    let mut next_client: Box<dyn ModelClient> = client;
    // What the previous incarnation handed over: its modules (already transferred), the opening note
    // gg wrote about the handoff, and the state it came from.
    //
    // A [fork](crate::tools::FORK_TOOL) arrives holding one *before its first* incarnation: a copy
    // of an agent is a successor whose predecessor is still running, so it opens on a carried
    // window by the same path an exec'd successor does rather than by one of its own.
    let mut succession: Option<Succession> = seed;
    // This agent's delegation context, built once and kept: it owns the inbox its parent messages it
    // through and the children it has spawned, neither of which a succession may drop.
    let mut subagent_context: Option<SubagentContext> = None;
    let mut inbox_rx = Some(inbox_rx);
    // How many turns this agent has taken in total. A succession spends **one** turn ceiling between
    // its incarnations and numbers its turns continuously across them, which is what keeps a
    // transferred thread's `Turn #37` meaning turn 37. A fork starts from its forker's count for
    // exactly that reason: the window it was handed already has those turns in it.
    let mut turns_taken = succession
        .as_ref()
        .map_or(0, |succession| succession.turn_base);

    let (end, agent_emitter) = loop {
        // Scope this incarnation's stream to its own node in the tree (and to the issue it was
        // dispatched for). A fresh agent id means a fresh message pool, so each incarnation's stream
        // re-states every context message it references and is self-contained — which is exactly
        // what the console's per-agent reduction needs, and the reason a succession mints a new id
        // rather than reusing the old one.
        let agent_emitter = orch.base_emitter.for_agent_on_issue(
            agent.id.clone(),
            agent.parent_id.clone(),
            issue_id.clone(),
        );
        let emitter = &agent_emitter;
        // Point the teardown at this incarnation's stream, so an agent that panics reports it on its
        // own node in the tree rather than only at run level. A successor re-points it here, which
        // is why this is inside the loop.
        teardown.on_stream(emitter);
        let first_incarnation = succession.is_none();

        // This agent's profile — the source of its capabilities, model, execution mode, and prompt.
        // A name this run does not declare is a gg defect and ends this agent's loop here — and the
        // whole session with it ([`STATUS_INTERNAL_ERROR`], raised on the run's
        // [fault latch](crate::fault) whichever agent this is) — for the same reason the client
        // resolution below does and one step earlier: the alternative is running this agent under
        // some *other* profile's capabilities, model and execution mode while every event it emits
        // is attributed to the profile it was dispatched as.
        let Some(profile) = orch.declared_profile(&agent.profile_id).cloned() else {
            let detail = format!(
                "agent profile `{}` is not declared by this run, so there is nothing to run it as",
                agent.profile_id
            );
            emitter.emit(log(
                "error",
                format!(
                    "{detail}; this agent's loop ends here — and the run with it — rather than \
                     running it as another profile. This is a gg defect: launch validation accepts \
                     no reference to an undeclared profile."
                ),
            ));
            orch.fault.in_agent(&agent.id, &agent.profile_id, detail);
            break (
                LoopEnd {
                    status: TerminalStatus::attributed(STATUS_INTERNAL_ERROR, &orch),
                    turns: turns_taken,
                    tokens: TokenCounts::default(),
                    cost: None,
                    profile_id: agent.profile_id.clone(),
                    final_text: None,
                    ending: None,
                    limit: None,
                    handoff: None,
                },
                agent_emitter,
            );
        };

        // This incarnation's client, taken off the carrier above. There is deliberately **no**
        // fallback resolution here: every one of the four dispatch sites resolves a client before it
        // calls this function, and the succession below resolves the successor's before it re-points
        // the loop, so an incarnation without one is a state nothing can produce. A fallback would
        // be a second way for an agent to acquire its model — with a failure arm that has to decide
        // whose fault an unresolvable profile is, on a path no run and no test can ever take.
        let client = next_client;

        let model_id = client.model_id().to_string();
        emitter.emit(log(
            "info",
            format!(
                "agent profile `{}` resolved to model `{model_id}` ({}).",
                agent.profile_id,
                provider_label_for(&orch, &agent.profile_id),
            ),
        ));

        emitter.emit(GgTelemetryKind::AgentSpawned {
            profile_id: agent.profile_id.clone(),
            model_id: model_id.clone(),
            depth: agent.depth as u64,
            brief: brief.clone(),
            worktree: worktree_branch.clone(),
            cwd: workspace_dir.display().to_string(),
        });
        // The state this incarnation stands in, when a machine is driving it — emitted right after
        // the spawn, so a reader of one agent's stream learns which state it is before it sees a
        // single turn of it. The entry state has no `from`; every later one names where it came
        // from, which is the other half of the outgoing instance's `AgentTransition`.
        if let Some(position) = agent.fsm.as_ref() {
            emitter.emit(GgTelemetryKind::FsmState {
                fsm_id: position.fsm().to_string(),
                state: position.state().to_string(),
                profile_id: agent.profile_id.clone(),
                from: succession
                    .as_ref()
                    .and_then(|succession| succession.from_state.clone()),
            });
        }
        // The running transition is only meaningful (and only emitted) when the run is multi-agent
        // (delegation, or project-management auto-dispatch) — it is what animates the live tree.
        if orch.multi_agent() {
            emitter.emit(agent_status(GgAgentStatus::Running));
        }

        // This agent's execution mode (traditional tool calling vs a code-shaped reply) and the
        // sandbox ceilings behind it come from its **own profile**, so a run can mix agents
        // that call tools with agents that write programs. Resolved here, ahead of the modules,
        // because the window it opens is armed by it.
        let code = orch.code_setup(&profile);
        let context_setup = orch.context_setup(&profile, &model_id);
        let history = HistorySetup {
            estimator: Arc::clone(&context_setup.estimator),
            window_limit: context_setup.window_limit,
            program_language: code.enabled.then_some(code.language),
        };

        // Build this agent's [modules](crate::modules) — everything it holds. The memory, task and
        // archive modules are **per agent** (a subagent has its own scratchpad, task list and
        // archive); the skills library and the estimator are shared through the orchestrator; and
        // the **project-management board is shared run-wide** — every agent's board tools mutate the
        // one [`orch.board`], the global work queue the dispatcher reads.
        //
        // A successor's set is not built here at all: it was [transferred](crate::modules::transfer)
        // on the far side of the handoff, where the outgoing instance's stream was still live to
        // report what it carried.
        // The program library a succession or a fork carried, handed to the loop beside the
        // opening so the successor can adopt it once it has resolved its own retention.
        let mut carried_programs: Option<crate::programs::ProgramLibrary> = None;
        let (mut modules, opening) = match succession.take() {
            Some(succession) => {
                carried_programs = Some(succession.programs);
                (
                    succession.modules,
                    Opening::Carried {
                        note: succession.note,
                        history: succession.history,
                    },
                )
            }
            None => {
                // This profile's own catalogue: the module set about to be resolved is this
                // agent's, and so is the library it reads from.
                let profile_skills = orch.skills_runtime(&profile);
                let module_ctx = ModuleResolveCtx {
                    skills: &profile_skills,
                    board: &orch.board,
                    memories: &orch.memory_registry,
                    inherited,
                    inheritable: orch.memories_inheritable,
                    history: history.clone(),
                    agent_id: &agent.id,
                    ids: &orch.module_ids,
                };
                // The one binding question the document cannot answer: an agent configured to work
                // in its spawner's notebook, spawned by an agent that organizes memories some other
                // way. Every pairing a roster shows is refused at launch, so this is a spawner gg
                // chose at run time — and gg's old answer, a private notebook nothing in the record
                // distinguishes from the inherited one, is precisely the substitution this
                // remediation deletes.
                if let Some(detail) =
                    crate::memories::inherited_strategy_conflict(&profile, &module_ctx)
                {
                    emitter.emit(log(
                        "error",
                        format!(
                            "{detail}. This is a gg defect, not a problem with the configuration: \
                             giving this agent a private notebook instead would leave the run's \
                             record saying it shared its spawner's while it never read a word of \
                             it. This agent's loop ends here, and the run with it."
                        ),
                    ));
                    orch.fault.in_agent(&agent.id, &agent.profile_id, &detail);
                    break (
                        LoopEnd {
                            status: TerminalStatus::attributed(STATUS_INTERNAL_ERROR, &orch),
                            turns: turns_taken,
                            tokens: TokenCounts::default(),
                            cost: None,
                            profile_id: agent.profile_id.clone(),
                            final_text: Some(detail),
                            ending: None,
                            limit: None,
                            handoff: None,
                        },
                        agent_emitter,
                    );
                }
                (ModuleSet::resolve(&profile, &module_ctx), Opening::Fresh)
            }
        };
        let archive_store = modules.caps().archive().store();
        let archive_id = modules.caps().archive().instance_id().to_string();
        // Every instance but the root's *first* one reports its modules' opening snapshots on its
        // own stream. The console reduces per agent, so a module that simply *arrived* — carrying
        // the whole task list its predecessor built — would otherwise leave the successor's panel
        // empty for state it very much holds, and a spawned subagent's panels would stay empty
        // until it happened to mutate something. Only the root's first incarnation stays quiet
        // here, because `announce_configuration` below is what introduces its modules and two
        // announcements of one empty store is one too many.
        if !first_incarnation || !is_root {
            for event in modules.state_events() {
                emitter.emit(event);
            }
        }
        // What this instance **holds**, whether or not it has touched any of it — the only event
        // that says so, and the one that makes a shared store's holders enumerable. Emitted for
        // every incarnation of every agent, un-gated: a read-only inherited memory holder that
        // never writes emits no snapshot at all, and would otherwise be invisible as a holder of
        // the notebook it is reading. It is emitted once and never re-emitted, because a roster
        // cannot change within an incarnation — everything that changes what an agent holds mints
        // a new agent id.
        emitter.emit(GgTelemetryKind::AgentModules {
            modules: modules.roster(),
        });

        // This agent's toolset, model, and prompt all come from **its own profile**, so a run can
        // give different agents different capabilities. The stores it binds are its modules', and
        // the transition call — if it has one — comes from where it stands in its machine.
        // The roster as the model will be shown it, resolved once against the whole set: a tool
        // schema can only enumerate labels, and two profiles may share a name.
        let spawnable = orch.caps.roster(&profile, GgSubagentScope::Subagent);
        let implementers = orch.caps.roster(&profile, GgSubagentScope::Implementer);
        let reviewers = orch.caps.roster(&profile, GgSubagentScope::Reviewer);
        let facts = AgentFacts {
            fsm: agent.fsm.as_ref(),
            spawnable: &spawnable,
            implementers: &implementers,
            reviewers: &reviewers,
        };
        let registry = ToolRegistry::from_run(&profile, modules.caps(), &facts);
        // **What this agent was granted on the API surface**, resolved once here and handed to every
        // reader of it: the capability ids its profile switches on, and the operations it holds —
        // its own [allowlist](GgAgentConfig::operations) narrowed to what this instance's modules and
        // position can actually service, plus the transition its position buys it. The membrane, the
        // documentation runtime, the built-in skill catalogue and the surface event below all take
        // these two — three of them build a `Grants` out of them — so nothing re-reads the profile
        // and comes to a different answer about what this agent may call.
        //
        // The names that answer to no operation are dropped rather than reported here: they are a
        // property of the *configuration*, not of this incarnation, and reporting them per agent
        // instance would repeat one typo once per spawn. The launch says them, once, on the root's
        // stream.
        let granted_capabilities = enabled_capabilities(&profile);
        let (granted_operations, _) =
            crate::sandbox::granted_operations(&profile, modules.caps(), &facts);
        // gg's own skills — one per family of the functions **this agent** has — joined to whatever
        // the workspace authored. They are resolved against what this agent holds, because a
        // catalogue that described a call the agent lacks is the one thing a catalogue must never
        // do; and the library they join is what decides whether the skill-reading call exists at
        // all, so both halves of the surface are re-derived over the completed library. Two
        // constructions of a pure value, once per agent instance, is what that costs.
        let builtins = crate::skills::builtin_skills(
            &registry.tool_names(),
            &registry.definitions(),
            ending_role,
            &granted_capabilities,
            &granted_operations,
            code.enabled.then_some(code.language),
            &profile,
        );
        let (registry, granted_operations) = if builtins.is_empty() {
            (registry, granted_operations)
        } else {
            modules.caps_mut().skills_mut().offer_builtins(builtins);
            let (operations, _) =
                crate::sandbox::granted_operations(&profile, modules.caps(), &facts);
            (
                ToolRegistry::from_run(&profile, modules.caps(), &facts),
                operations,
            )
        };

        // What this instance is **offered**, the other half of the roster above — and read off the
        // *completed* registry, because the rebuild above is what decides whether `read_skill`
        // exists at all. Un-gated and emitted for every incarnation of every agent, because the
        // whole point is that an agent offered nothing still says so: "it was never given the tool"
        // and "it had the tool and never called it" are different findings, and joining a call
        // count to a re-derivation of the capability set can tell them apart only for the runs
        // where nothing else gated the toolset.
        //
        // **Exactly one of the two lists is populated**, because an agent has exactly one surface.
        // A tool-calling instance reports its tools and no apis; a responses-as-code instance
        // reports its apis and no tools. The two vocabularies are scoped — a tool name is never an
        // operation id and never will be — so a surface carrying both would be inviting a reader to
        // join them, and there is nothing to join.
        //
        // The ending calls are appended to the tool list for the same reason the loop appends their
        // definitions to every request: the model is genuinely offered them, they are simply not the
        // registry's. A program's endings need no such appendix — they are operations like every
        // other call it makes, and `api_surface` reports them from the same grant that binds them.
        emitter.emit(GgTelemetryKind::AgentSurface {
            execution_mode: execution_mode(code.enabled).to_string(),
            program_language: code.enabled.then_some(code.language),
            // The arm of the documentation A/B this instance is on — reported here, beside the
            // language, because both are per-agent knobs a single run may hold two of, and a study
            // that cannot read an agent's arm off its own surface event cannot attribute the
            // documentation band's tokens to anything. The resolved flags, never the configured
            // object: an unreadable value is warned about at launch and runs as the default, and
            // recording what was written would file the run under an arm it was never on.
            doc_view_types: code.enabled.then(|| code.doc_view_types.id()),
            tools: if code.enabled {
                Vec::new()
            } else {
                registry
                    .tool_names()
                    .into_iter()
                    .chain(ending_role.tools().iter().map(|name| name.to_string()))
                    .collect()
            },
            apis: if code.enabled {
                api_surface(
                    &granted_capabilities,
                    &granted_operations,
                    ending_role,
                    code.language,
                )
            } else {
                Vec::new()
            },
        });

        // The agent's file/shell tools are rooted at the [directory it was announced
        // with](workspace_dir) — its isolated worktree when it has one, so every mutation (and every
        // command it runs without an explicit path) lands in the private copy rather than the shared
        // main tree; otherwise the shared workspace. This is the whole of the worktree isolation at
        // the tool layer — the loop is otherwise identical.
        //
        // The tool context carries this agent's model alongside its workspace root, because
        // one tool's answer depends on it: `read_file` attaches a picture only when the model
        // asking can see one. The registry behind it is the run's, not this agent's.
        //
        // It also carries the run's [shell seam](ShellRunner) and this agent's id — which is what
        // makes every command line the agent reaches (its `shell` tool, its programs'
        // `system.shell(…)`, and the commands its own [hooks](crate::hooks) run on
        // its behalf) start through one runner, attributed to one agent.
        let tool_ctx = ToolContext::new(workspace_dir.clone())
            .with_vision(&model_id, Arc::clone(&orch.vision))
            .with_agent(&agent.id)
            .with_shell(orch.shell_for(&workspace_dir, emitter));

        // Who this agent is to the run's [hooks](crate::hooks): its instance id, the profile it
        // runs, the role it was dispatched in, and the isolated worktree it works in when it has
        // one. Built once here because every hook this agent fires carries the same identity, and
        // a hook that had to be told separately at each firing site would eventually be told wrong.
        let hook_agent = HookAgent::new(&agent.id, &profile.name)
            .of_kind(hook_agent_kind(&role, agent.parent_id.is_none()))
            .in_worktree(
                worktree
                    .as_ref()
                    .map(|tree| (tree.branch.clone(), tree.path.clone())),
            );

        // Announce the run's configuration once, on the root's stream, so the console shows the
        // enabled capabilities from the start; subagents inherit the same configuration and stay
        // quiet. A later incarnation stays quiet too: this is the run's **durable
        // configuration**, and a field with two values in one run is one nothing can be
        // sliced by.
        if is_root && first_incarnation {
            announce_configuration(
                emitter,
                &registry,
                modules.caps(),
                code.enabled.then_some(code.language),
                code.enabled.then(|| {
                    api_surface(
                        &granted_capabilities,
                        &granted_operations,
                        ending_role,
                        code.language,
                    )
                    .iter()
                    .map(|module| module.functions.len())
                    .sum()
                }),
                &hook_sites(&orch),
            );
            // Record the run's effective toolset on the session summary — the exact set of tool
            // names offered to the root agent after capability gating and its allowlist — so the
            // toolset is a durable, sliceable fact rather than something a query re-derives. Empty
            // for a responses-as-code root, which is offered no tools at all; what such a root was
            // offered is its `apis`, on the surface event above.
            emitter.record_effective_tools(registry.tool_names());
            // Record the run's execution mode (code-shaped responses vs traditional tool calling) so
            // the "does responses-as-code help?" study is a durable, sliceable outcome dimension
            // alongside the capabilityEnabled facet.
            emitter.record_execution_mode(execution_mode(code.enabled));
            // …and, beside it, which language a code run wrote in. `None` for a tool-calling run,
            // which is a different answer from "TypeScript": the first arm has no program language
            // at all, and a study comparing languages must be able to tell them apart without
            // re-deriving the capability set.
            emitter.record_program_language(code.enabled.then_some(code.language));
        }

        // The agent's memory access, not merely its capability: a read-only holder cannot satisfy a
        // memory compaction, so the strategy is demoted for it rather than leaving the run to wedge
        // against a full window it has no call to clear.
        let memories_writable = modules.caps().memories().is_writable();
        // The launch pass read this profile's compaction configuration — its strategy, its
        // headroom, its handoff model — with a collecting sink and refused the run if any of it
        // could not be honoured, so this re-resolution reports into a discarding one.
        let mut compaction =
            CompactionSetup::resolve(&profile, &mut crate::validate::LaunchReport::Discarding);
        // What is left of the memory-compaction demotion once the launch pass has had it, and it
        // **ends the run**. The declared half — the memories capability off, or a `read-only` scope
        // written on the profile — refuses the launch before the first turn, so reaching here means
        // this *instance* was handed a read-only view of somebody else's store by whoever spawned
        // it, which no document could have shown. The demotion itself is the thing that cannot
        // stand: `memory-compaction` asks the agent to condense by writing its working state into
        // its memories, and an agent that cannot write them condenses in prose instead — so the run
        // would answer a question about self-summarization while its record named the memory arm.
        if !memories_writable
            && profile
                .capability(CAPABILITY_COMPACTION)
                .filter(|capability| capability.enabled)
                .and_then(|capability| capability.implementation.as_deref())
                .map(str::trim)
                == Some(test_cabinet_core::gg::COMPACTION_STRATEGY_MEMORY)
        {
            let detail = format!(
                "agent `{}` compacts with the `{}` strategy but was spawned holding its memories \
                 read-only, so it has no call that could satisfy one",
                agent.profile_id,
                test_cabinet_core::gg::COMPACTION_STRATEGY_MEMORY,
            );
            emitter.emit(log(
                "error",
                format!(
                    "{detail}; condensing with the `{}` strategy instead would run one arm of a \
                     compaction study under the other's name. This agent's loop ends here, and the \
                     run with it — give the profile writable memories, or name a strategy that \
                     condenses in prose.",
                    compaction.strategy.id(),
                ),
            ));
            orch.fault.in_agent(&agent.id, &agent.profile_id, &detail);
            break (
                LoopEnd {
                    status: TerminalStatus::attributed(STATUS_INTERNAL_ERROR, &orch),
                    turns: turns_taken,
                    tokens: TokenCounts::default(),
                    cost: None,
                    profile_id: agent.profile_id.clone(),
                    final_text: Some(detail),
                    ending: None,
                    limit: None,
                    handoff: None,
                },
                agent_emitter,
            );
        }
        // A handoff strategy condenses on a **second** model, resolved through the same factory
        // every agent's own model is. This binding keeps the standard prompt-cache lifetime whatever
        // the agent chose: a handoff is a one-shot summary request, so an extended entry would be
        // paid for and never read.
        //
        // A named model that will not resolve **ends the run**. gg used to warn and leave
        // `handoff_client` unset, after which `CompactionSetup::client` handed back the agent's own
        // client: the run then condensed on the working model while its record, its capability set
        // and its per-slot cost split all named the handoff arm — and "which model condensed the
        // thread" is the entire question a handoff study asks. The model **id** is proved against
        // the catalog at launch (it is one of the set's bound models), so what is left here is a
        // credential or a provider that failed at run time, which no fallback can honour.
        if let Some(model) =
            compaction::handoff_model_id(&profile, &mut crate::validate::LaunchReport::Discarding)
        {
            let binding = GgSlotBinding::new(COMPACTION_SLOT, &model);
            // Resolved under the **compaction** role of this agent's identity, not under a second
            // identity of its own: it is the same agent's second client. Without the role a
            // reconstruction would interleave the summarizer's calls and the agent's own next turn
            // into one indistinguishable queue and answer both from the wrong end of it.
            match orch
                .factory
                .client_for_agent(&binding, &AgentIdentity::compaction(origin.clone()))
            {
                Ok(client) => {
                    // Wrapped in the recorder like the agent's own client, but under the
                    // **compaction** client role. gg's second model client has to be wrapped too:
                    // a handoff is the one event that rewrites an agent's entire window, so a
                    // record missing its calls would describe a conversation whose next turn
                    // appears to come from nowhere.
                    compaction.handoff_client = Some(match &orch.replay {
                        Some(recorder) => Box::new(RecordingClient::for_compaction(
                            client,
                            Arc::clone(recorder),
                            agent.id.clone(),
                        )),
                        None => client,
                    });
                    if is_root && first_incarnation {
                        emitter.emit(log(
                            "info",
                            format!(
                                "compaction hands off to `{model}`; the working model's thread is \
                                 condensed by it, not by the agent."
                            ),
                        ));
                    }
                }
                Err(err) => {
                    let detail = format!(
                        "compaction hands off to the model `{model}`, which could not be resolved \
                         ({err}); there is no second model to condense this agent's thread with"
                    );
                    emitter.emit(log(
                        "error",
                        format!(
                            "{detail}, and compacting on this agent's own model instead would run \
                             the self-summarization arm while every record of this run named the \
                             handoff one. This agent's loop ends here, and the run with it."
                        ),
                    ));
                    orch.fault.in_agent(&agent.id, &agent.profile_id, &detail);
                    break (
                        LoopEnd {
                            status: TerminalStatus::attributed(STATUS_INTERNAL_ERROR, &orch),
                            turns: turns_taken,
                            tokens: TokenCounts::default(),
                            cost: None,
                            profile_id: agent.profile_id.clone(),
                            final_text: Some(detail),
                            ending: None,
                            limit: None,
                            handoff: None,
                        },
                        agent_emitter,
                    );
                }
            }
        }
        let amc = AmcSetup::resolve(
            &profile,
            &registry,
            archive_store,
            archive_id,
            code.enabled.then_some(code.language),
            &granted_operations,
        );
        let autoload =
            AutoloadSetup::resolve(&profile, &mut crate::validate::LaunchReport::Discarding);
        // This agent's persistence: whether its instances are serialized and carry their open file
        // views, bound to the run-global record every instance of its profile shares.
        let persistence = PersistenceSetup::resolve(&profile, Arc::clone(&orch.persistence));
        if is_root && first_incarnation && autoload.enabled {
            emitter.emit(log(
                "info",
                format!(
                    "autoload-specifications enabled; the {} file(s) the test case provided are \
                     seeded into the opening context{}.",
                    orch.provided_files.len(),
                    if autoload.locked {
                        ", locked (kept across compaction)"
                    } else {
                        ""
                    },
                ),
            ));
        }
        if is_root && first_incarnation && compaction.enabled {
            emitter.emit(log(
                "info",
                format!(
                    "compaction enabled; the thread compacts with the `{}` strategy once the window \
                     reaches {:.0}% full.",
                    compaction.strategy.id(),
                    compaction.policy.trigger_fullness() * 100.0
                ),
            ));
        }
        if is_root && first_incarnation && amc.enabled {
            emitter.emit(log(
                "info",
                "agent-managed context enabled; the model sees a live window-fullness signal and \
                 can evict file views, archive thread history, and search the archive.",
            ));
        }

        // When delegation is enabled, this agent gets a delegation context so its loop can
        // spawn/wait/message; off, it is a single agent with no such context (and the tools were
        // never offered).
        //
        // Built once and then *updated*, never rebuilt: it owns the inbox this agent's parent
        // messages it through and the handles of the children it has already spawned, and a
        // succession that dropped either would orphan a running subagent and silence a live channel.
        // What a succession does change is what this agent offers the children it spawns next, and
        // the key it frees when it blocks.
        if orch.delegation_enabled() {
            match subagent_context.as_mut() {
                Some(sub) => {
                    sub.inherited = InheritedModules::from_spawner(modules.caps());
                    sub.ctx.exclusive = teardown.exclusive_owned();
                }
                None => {
                    subagent_context = Some(SubagentContext {
                        orch: Arc::clone(&orch),
                        ctx: AgentCtx::new(
                            inbox_rx.take().expect("the inbox is taken exactly once"),
                            teardown.exclusive_owned(),
                            teardown.hold().clone(),
                        ),
                        // Taken from this agent's own modules, so a child that inherits binds the
                        // very store this agent is curating rather than a snapshot of it.
                        inherited: InheritedModules::from_spawner(modules.caps()),
                    });
                }
            }
        }

        // When project management is enabled, this agent gets a project context so its loop can
        // trigger auto-dispatch after a board mutation and block in `wait_for_issue`; it also
        // carries the issue this agent was itself dispatched to implement (if any), so the loop
        // knows `finish` returns a result rather than ending the run. Off, the board tools were
        // never offered.
        let project = orch.project_management_enabled.then(|| ProjectContext {
            orch: Arc::clone(&orch),
            assigned_issue: assigned_issue.clone(),
            hold: teardown.hold().clone(),
        });

        // The build prompt this incarnation is driven by. A successor that was handed a window keeps
        // the one already in it (its predecessor's), so this is only read on the first incarnation
        // and on a successor whose transition carried no history — which is seeded like a fresh
        // agent, from the note the transition gave it or, failing that, from the run's own prompt.
        let prompt = match &role {
            AgentRole::Root => orch.prompt.clone(),
            AgentRole::Sub { brief, .. } => brief.clone(),
            AgentRole::Issue { brief, .. } => brief.clone(),
        };

        // Replay capture: wrap this agent's client so every model turn it makes — including the
        // summarizer's compaction calls, which reuse this same client — records its
        // request/response into the shared recorder, and thread the recorder into the loop so it
        // records each tool result too. The wrapping is invisible to the loop (`model_id` and
        // errors pass through).
        //
        // Capture is **always on**: no capability turns it on, off, or up — every run records the
        // same session record. So `None` here does
        // not mean "the operator did not ask for a record" — it means
        // [`start_session_capture`] could not open the journal and warned about it, which is the one
        // case a run proceeds unrecorded.
        let client: Box<dyn ModelClient> = match &orch.replay {
            Some(recorder) => Box::new(RecordingClient::new(
                client,
                Arc::clone(recorder),
                agent.id.clone(),
            )),
            None => client,
        };

        let end = agent
            .drive(
                client.as_ref(),
                &prompt,
                &registry,
                &tool_ctx,
                emitter,
                &mut modules,
                DriveSetup {
                    limits: LimitsSetup {
                        limits: orch.limits,
                        deadline: orch.deadline,
                        spend: Arc::clone(&orch.spend),
                        cancel: orch.cancel.clone(),
                        fault: orch.fault.clone(),
                        ceiling: orch.ceiling.clone(),
                    },
                    compaction,
                    amc,
                    autoload,
                    persistence,
                    read_policy: read_policy(&profile),
                    shell_offload: shell_offload(
                        &profile,
                        // Mid-run: the launch pass read this profile's `shell` through this same
                        // resolver.
                        &mut crate::validate::LaunchReport::Discarding,
                    ),
                    code,
                    discovery: orch.discovery.clone(),
                    hooks: HooksSetup {
                        // A profile with no runtime is one the set does not declare, which the
                        // dispatcher has already refused — so the unreachable case here is the
                        // named [undeclared](crate::hooks::HookRuntime::undeclared) runtime, which
                        // declares no hooks rather than guessing at another profile's.
                        runtime: orch
                            .agent_hooks
                            .get(&profile.slug)
                            .map(Arc::clone)
                            .unwrap_or_else(|| Arc::new(crate::hooks::HookRuntime::undeclared())),
                        session: Arc::clone(&orch.session_hooks),
                        agent: hook_agent,
                    },
                    ending_role,
                    opening,
                    carried_programs: carried_programs.take(),
                    turn_base: turns_taken,
                    replay: orch.replay.clone(),
                },
                &orch.provided_files,
                &profile,
                &orch.caps,
                &mut subagent_context,
                project,
            )
            .await;

        // Fold this incarnation's usage into the shared per-slot accounting. Per incarnation rather
        // than per agent, and keyed on the profile each one ran: that is what splits a machine's
        // cost between its states, which is the figure a study of one actually wants.
        orch.accounting
            .lock()
            .expect("slot accounting lock")
            .record(&end.profile_id, &model_id, end.tokens, end.cost);
        turns_taken = end.turns;

        let Some(handoff) = end.handoff else {
            break (end, agent_emitter);
        };

        // A succession. Everything from here to the `continue` happens while the **outgoing**
        // instance's stream is still live, because that is where what it did with its state belongs:
        // the events its modules still owed, and the record of what each module went on to do.
        for event in modules.caps_mut().drain_events() {
            emitter.emit(event);
        }
        if orch.multi_agent() {
            emitter.emit(agent_status(GgAgentStatus::Done));
        }

        // A handoff may name an **FSM shell**, which an `exec` is allowed to do and a machine
        // transition never is. A shell has no turns of its own, so the successor *enters* the
        // machine instead: it runs the entry state's agent profile and stands in the entry
        // position, exactly as an agent dispatched onto a shell does. This is the one place the
        // profile a handoff named and the profile its successor actually runs can differ, so every
        // line below reads the resolved pair rather than the handoff.
        let (successor_profile_id, successor_fsm) = match orch.machine(&handoff.profile) {
            Some(machine) => {
                let position = machine.entry_position();
                (position.agent_id().to_string(), Some(position))
            }
            None => (handoff.profile.clone(), handoff.fsm.clone()),
        };
        // The successor's profile. Resolved before its origin is minted, because a successor that
        // cannot be resolved never runs and must not spend an ordinal. An undeclared name here is
        // a gg defect — a handoff's target is checked against this agent's roster (or its
        // machine's transitions) before the handoff is accepted — and it ends this loop exactly as
        // an unresolvable model does (and the run with it, [`STATUS_INTERNAL_ERROR`]), rather than
        // succeeding into whichever profile happens to be the root and recording its turns under
        // the name the handoff asked for.
        let Some(successor_profile) = orch.declared_profile(&successor_profile_id).cloned() else {
            let detail = format!(
                "the `{successor_profile_id}` agent is not declared by this run, so there is nothing to \
                 succeed into"
            );
            emitter.emit(log(
                "error",
                format!(
                    "{detail}; this agent's loop ends here — and the run with it — rather than \
                     succeeding into another profile. This is a gg defect: launch validation \
                     accepts no reference to an undeclared profile."
                ),
            ));
            orch.fault.in_agent(&agent.id, &agent.profile_id, detail);
            break (
                LoopEnd {
                    status: TerminalStatus::attributed(STATUS_INTERNAL_ERROR, &orch),
                    handoff: None,
                    ..end
                },
                agent_emitter,
            );
        };
        // The fifth way an agent comes into existence, and the one that happens *inside* this
        // function. Keyed on the predecessor and its own ordered position within it — never on the
        // successor's id, which comes off the global agent counter and says nothing about lineage.
        //
        // Minted here, before the client resolution, because the resolution has to say whose client
        // it is. A resolution that fails ends this agent's loop for good, so an ordinal spent on a
        // successor that never ran cannot shift a later one: there is no later one.
        let successor_origin = GgSessionAgentOrigin::Succession {
            predecessor: agent.id.clone(),
            ordinal: orch.next_ordinal(format!("succession:{}", agent.id)),
        };
        // The successor's window limit and execution mode, which its modules are re-resolved
        // against: an agent moving from a million-token window onto a 32k one is over its window the
        // instant it arrives, and its first turn's compaction check is what has to see that.
        let successor_client = match resolve_agent_client(
            &orch,
            &successor_profile_id,
            &successor_origin,
        ) {
            Ok(client) => client,
            Err(unresolved) => {
                emitter.emit(log(
                    "error",
                    format!(
                        "the `{successor_profile_id}` agent could not be resolved to a model ({}); {}.",
                        unresolved.detail,
                        unresolved.consequence()
                    ),
                ));
                // As above: gg's half of the resolution ends the run, the operator's refused
                // credential ends this agent.
                // Named as the *predecessor*, which is the agent that was running: the successor
                // has no id yet and never ran a turn. Which successor it was reaching for is in the
                // detail, and is the more useful half of the sentence anyway.
                if unresolved.status == STATUS_INTERNAL_ERROR {
                    let detail = format!(
                        "the `{successor_profile_id}` agent could not be resolved to a model ({})",
                        unresolved.detail
                    );
                    orch.fault.in_agent(&agent.id, &agent.profile_id, detail);
                }
                break (
                    LoopEnd {
                        status: TerminalStatus::attributed(unresolved.status, &orch),
                        handoff: None,
                        ..end
                    },
                    agent_emitter,
                );
            }
        };
        let successor_code = orch.code_setup(&successor_profile);
        let successor_id = orch.next_agent_id();
        let successor_history = HistorySetup {
            estimator: Arc::clone(&orch.estimator),
            window_limit: orch
                .context_setup(&successor_profile, successor_client.model_id())
                .window_limit,
            program_language: successor_code.enabled.then_some(successor_code.language),
        };
        let (successor_modules, report) = {
            // The successor's own catalogue, which is the one its profile named rather than the
            // one this incarnation was reading.
            let successor_skills = orch.skills_runtime(&successor_profile);
            let module_ctx = ModuleResolveCtx {
                skills: &successor_skills,
                board: &orch.board,
                memories: &orch.memory_registry,
                inherited,
                inheritable: orch.memories_inheritable,
                history: successor_history,
                agent_id: &successor_id,
                ids: &orch.module_ids,
            };
            crate::modules::transfer(modules, &successor_profile, &handoff.plan, &module_ctx)
        };
        // A transfer that could not carry what it was told to carry ends the run. The successor is
        // the same session continuing under another profile, and one that opens with an empty
        // module where its configuration says it continues with a live one is not a differently
        // configured run — it is this run with a hole in it, in the one place nothing downstream
        // could see. Reported before the transition event, so the last thing on the stream is the
        // reason rather than the handoff that went ahead anyway.
        if let Some(detail) = report.defects.first() {
            for defect in &report.defects {
                emitter.emit(log(
                    "error",
                    format!(
                        "{defect}. This is a gg defect: every transfer list a machine declares is \
                         read at launch against the module set the outgoing state's profile holds, \
                         and one naming a module that profile does not hold refuses the run before \
                         its first turn."
                    ),
                ));
            }
            orch.fault.in_agent(&agent.id, &agent.profile_id, detail);
            break (
                LoopEnd {
                    status: TerminalStatus::attributed(STATUS_INTERNAL_ERROR, &orch),
                    handoff: None,
                    ..end
                },
                agent_emitter,
            );
        }
        emitter.emit(GgTelemetryKind::AgentTransition {
            kind: handoff.reason.kind(),
            to_agent_id: successor_id.clone(),
            profile_id: successor_profile_id.clone(),
            state: successor_fsm
                .as_ref()
                .map(|position| position.state().to_string()),
            modules: report.modules.clone(),
        });

        // The exclusivity key follows the profile, so a succession into a persistent profile
        // contends for it exactly as a fresh instance would — without giving up the running slot it
        // already holds, unless the key is held by somebody else.
        let successor_exclusive = orch.exclusive_key(&successor_profile_id);
        orch.scheduler
            .rekey(
                teardown.exclusive(),
                successor_exclusive.as_deref(),
                teardown.hold(),
            )
            .await;

        succession = Some(Succession {
            note: succession_note(
                &handoff,
                &report,
                &successor_profile,
                successor_fsm.as_ref(),
            ),
            modules: successor_modules,
            history: report.carries(ModuleKind::History),
            from_state: handoff.reason.departed_state(),
            turn_base: turns_taken,
            // Moved, not cloned: the outgoing incarnation is over, and its library is the
            // successor's now.
            programs: handoff.programs,
        });
        next_client = successor_client;
        let successor = agent.succeeding(successor_id, successor_profile_id, successor_fsm);
        origin = successor_origin;
        record_session_agent(&orch, &successor, &origin, None);
        agent = successor;
        // Re-point the teardown at the instance now running on this slot, under the key it was just
        // exchanged for. A panic in the successor must name the successor, and the slot it gives
        // back must be given back under the key it is actually held under.
        teardown.succeeded(&agent, &origin, successor_exclusive);
    };
    let emitter = &agent_emitter;

    let failed = end.status.is_failure();
    // Whether the loop ended in a *completion* — the model signalled it was done with its
    // [ending call](crate::completion) — rather than on a ceiling, a breached limit, or an
    // error. It is what finishes an [issue](crate::board) this agent was dispatched to implement.
    let completed = end.status == STATUS_COMPLETED;
    if orch.multi_agent() {
        emitter.emit(agent_status(if failed {
            GgAgentStatus::Failed
        } else {
            GgAgentStatus::Done
        }));
    }
    // The terminal row, superseding the one written when this incarnation was born. Recorded on
    // every run, not only a multi-agent one: the status a reconstruction is compared against is as
    // meaningful for a lone root agent as for a fleet. A predecessor that handed off keeps its
    // opening row and no terminal status, which is the honest account — its loop did not end, it
    // continued as somebody else.
    record_session_agent(&orch, &agent, &origin, Some(&end));

    // Every arm ends the agent through the [teardown](AgentTeardown) rather than touching the
    // scheduler and the spawner's wires directly, because a panicked agent is ended through the very
    // same calls — and an ending that had two implementations would have the panic path drifting
    // from the ordinary one on whichever detail was changed in only one of them.
    match role {
        AgentRole::Root => {
            // The root frees its slot so any cap-limited subagents it spawned can now run to
            // completion while the session joins them.
            teardown.released();
        }
        AgentRole::Issue {
            issue_id, retry, ..
        } => {
            // Free the slot first (like the root), so a re-dispatch or a newly-unblocked issue can
            // acquire it, then reconcile the issue against what the agent did.
            teardown.released();
            reconcile_issue(&orch, &issue_id, retry, completed, emitter).await;
        }
        AgentRole::Sub { worktree, .. } => {
            // The summary is the subagent's final assistant message (its return value), or a short
            // status when it produced none.
            let summary = end
                .final_text
                .clone()
                .unwrap_or_else(|| format!("(subagent ended: {})", end.status));

            // A worktree this subagent ran in is deliberately left untouched: whoever created it
            // owns its fate. A reviewer shares its issue's tree, which the issue's own
            // reconciliation merges. Reconciling here would merge a reviewer's read as if it were
            // work.
            let _ = &worktree;

            // Gated on the run being multi-agent rather than on delegation specifically: a
            // project-management run with no `subagents` capability still dispatches reviewers and
            // a merge agent, and a reviewer whose verdict never appeared on the tree would be an
            // agent the console could see start and never see answer.
            if orch.multi_agent() {
                emitter.emit(GgTelemetryKind::AgentReturned {
                    summary: summary.clone(),
                });
            }
            // Flip finished and deliver the result *before* signalling the parent, so by the time
            // the spawner is woken its collect finds the result ready.
            teardown.returned(AgentReturn {
                summary,
                status: end.status.as_str(),
                ending: end.ending.clone(),
            });
        }
    }
    end
}

/// Every distinct [program language](GgProgramLanguage) `agents` will actually drive, in
/// registration order.
///
/// Responses-as-code is a **per-agent** capability, so one run may write its root's programs in one
/// language and a reviewer's in another. Anything that must be ready before a turn — the compiled
/// interpreter component above all — therefore has to be prepared for the whole set rather than for
/// the root's, and a set is derived from the configuration rather than assumed to be a singleton.
///
/// A [`BTreeSet`] rather than a `Vec`: forty agents on one language is one warm-up, and the order is
/// the enum's own, which is registration order.
fn program_languages(agents: &[GgAgentConfig]) -> BTreeSet<GgProgramLanguage> {
    agents
        .iter()
        .filter(|agent| agent.is_enabled(CAPABILITY_RESPONSES_AS_CODE))
        // A discarding sink: the launch pass read every profile's language, through this same
        // resolver, and refused the run if any named a language gg cannot drive.
        .map(|agent| {
            sandbox::resolve_program_language(agent, &mut crate::validate::LaunchReport::Discarding)
        })
        .collect()
}

/// Every hook declaration site of a run, in announcement order: the session's, then each profile's
/// own by name.
///
/// The name is pre-phrased for the sentence it lands in ("… bound to `pre-write` **on agent
/// `reviewer`**"), because the alternative is a format string that has to special-case the session
/// — the one site that is not an agent.
///
/// Profiles are visited in the set's own order rather than the map's, so the announcement reads in
/// the order the configuration is written rather than in hash order.
fn hook_sites(orch: &Orchestrator) -> Vec<(String, Arc<HookRuntime>)> {
    let mut sites = vec![("on the run".to_string(), Arc::clone(&orch.session_hooks))];
    sites.extend(orch.caps.agents.iter().filter_map(|profile| {
        let runtime = orch.agent_hooks.get(&profile.slug)?;
        Some((format!("on agent `{}`", profile.slug), Arc::clone(runtime)))
    }));
    sites
}

/// Announce the run's enabled capabilities once (on the root's stream) so the console shows the
/// configuration from the start — the offered toolset and the initial (empty) skills/memory/task/
/// board state — mirroring the per-capability announcements a single-agent run emitted.
fn announce_configuration(
    emitter: &Emitter,
    registry: &ToolRegistry,
    modules: &CapabilityModules,
    program_language: Option<GgProgramLanguage>,
    // How many functions a responses-as-code agent's programs may call — the surface that stands in
    // for a tool count under an execution mode that offers no tools. `None` for a tool-calling run.
    apis: Option<usize>,
    // Each declaration site as `(how to say where it is, its hooks)` — the run's session hooks and
    // every profile's own, so the announcement covers gates on profiles this run has not dispatched
    // yet.
    hooks: &[(String, Arc<HookRuntime>)],
) {
    // A responses-as-code agent is offered **no tools at all**, by construction — it calls a typed
    // surface from inside a program instead — so an empty registry says nothing about its grant and
    // the count that does is its api surface. Reading the tool registry on that arm reported every
    // fully configured code run as a run that "can only talk".
    let offered = apis.unwrap_or_else(|| registry.len());
    if offered == 0 {
        emitter.emit(log(
            "warn",
            "no capabilities are enabled; the model can only talk. Enable the shell/filesystem \
             capabilities to let it build.",
        ));
    } else {
        emitter.emit(log(
            "info",
            format!(
                "offering {offered} {} from the enabled capabilities.",
                match apis {
                    Some(_) => "function(s)",
                    None => "tool(s)",
                }
            ),
        ));
    }
    let skills = modules.skills();
    if let Some(state) = skills.state_event() {
        emitter.emit(log(
            "info",
            format!(
                "{} skill(s) available; their descriptions are in the system prompt.",
                skills.library().len()
            ),
        ));
        emitter.emit(state);
    }
    let memories = modules.memories();
    if let Some(state) = memories.state_event() {
        emitter.emit(log("info", memories_startup_note(memories)));
        emitter.emit(state);
    }
    let tasks = modules.tasks();
    if let Some(state) = tasks.state_event() {
        emitter.emit(log(
            "info",
            format!(
                "task list enabled (a blocked-by DAG, up to {} tasks).",
                tasks.max_tasks()
            ),
        ));
        emitter.emit(state);
    }
    let board = modules.board();
    if let Some(state) = board.state_event() {
        let board_caps = board.caps();
        emitter.emit(log(
            "info",
            format!(
                "epic/issue board enabled (structured, dispatchable issues in a blocked-by DAG, \
                 up to {} epics and {} issues).",
                board_caps.max_epics, board_caps.max_issues
            ),
        ));
        emitter.emit(state);
    }
    // The archive opens empty, and says so. It has no operator-log line of its own — there is
    // nothing to report until the agent puts something away — but the snapshot has to be emitted
    // like the other four, because it is what tells the console the module exists at all: an
    // archive that is never used would otherwise be the one module with no state event in the
    // whole record, and the documented contract is that `archive_state` arrives as an agent opens.
    if let Some(state) = modules.archive().state_event() {
        emitter.emit(state);
    }
    if let Some(language) = program_language {
        emitter.emit(log(
            "info",
            format!(
                "responses-as-code enabled; this agent is offered no tools at all — each turn it \
                 emits a {} program over the typed API (loops, conditionals, composed calls) that \
                 gg runs in a wasmtime sandbox. The calls the program makes stream as \
                 ApiCall/ApiResult, and the execution is streamed as a CodeExecution event.",
                sandbox::language(language).display_name()
            ),
        ));
    }

    // Every gate the run is configured with, named before the first one fires — including the ones
    // belonging to profiles that have not been dispatched yet. Announced here in full rather than
    // by each agent as it starts, because the point of the announcement is that an operator reading
    // the top of the log knows what is armed; a reviewer's `agent-stop` gate discovered two hours
    // in, on the line where it blocked, is the thing this is for.
    for (site, runtime) in hooks {
        for event in ALL_HOOK_EVENTS {
            let count = runtime.count(event);
            if count > 0 {
                emitter.emit(log(
                    "info",
                    format!(
                        "{count} hook(s) bound to `{}` {site}; they run in declaration order{}.",
                        event.as_str(),
                        if event.can_block() {
                            " and the first to block stops the operation"
                        } else {
                            ""
                        },
                    ),
                ));
            }
        }
    }
}

/// An [`AgentStatus`](GgTelemetryKind::AgentStatus) telemetry event for `status`, carrying no wait
/// condition — every transition that is not a block into a wait.
fn agent_status(status: GgAgentStatus) -> GgTelemetryKind {
    GgTelemetryKind::AgentStatus {
        status,
        waiting_on: None,
    }
}

/// An [`AgentStatus`](GgTelemetryKind::AgentStatus) telemetry event for an agent suspending itself
/// on `condition` — the [`Blocked`](GgAgentStatus::Blocked) transition, told with *what* it is
/// waiting for.
///
/// The condition is what makes a blocked agent readable: without it the console can only say an
/// agent is waiting, which is indistinguishable from an agent that is stuck.
fn agent_blocked_on(condition: impl Into<String>) -> GgTelemetryKind {
    GgTelemetryKind::AgentStatus {
        status: GgAgentStatus::Blocked,
        waiting_on: Some(condition.into()),
    }
}

/// The parenthetical of an agent's resolution log line: which provider the
/// [profile](GgAgentConfig) named `profile` is bound to, or why gg cannot say.
///
/// It always can say, here — the agent reaching this line is already holding a client built from
/// this very binding — so a failure means gg read the capability set one way to build the client
/// and another way one line later. That is reported in the line rather than answered with a
/// provider name. `mock` in particular is not a safe thing to print when unsure: it is a real
/// answer an operator acts on, meaning the run cost nothing and says nothing about any model, and
/// printing it for a profile gg could not read would put that claim in the log of a run that was
/// nothing of the sort.
fn provider_label_for(orch: &Orchestrator, profile: &str) -> String {
    match profile_binding(&orch.caps, profile) {
        Ok(binding) => format!("{} provider", provider_label(&binding)),
        Err(err) => {
            format!(
                "provider unknown: gg could not resolve this profile — {err}. This is a gg defect"
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Subagent tool handling (spawn / wait / message), applied by the loop
// ---------------------------------------------------------------------------

/// Dispatch a [subagent tool](is_subagent_tool) call against the agent's
/// [delegation context](SubagentContext), returning the model-facing [`ToolOutcome`]. Routed here
/// by [`Agent::drive`] instead of ordinary tool dispatch because these tools act on the scheduler
/// and the agent tree.
async fn handle_subagent_call(
    sub: &mut SubagentContext,
    spawner: &Agent,
    emitter: &Emitter,
    call: &ToolCall,
) -> ToolOutcome {
    match call.name.as_str() {
        SPAWN_SUBAGENT_TOOL => spawn_subagent(sub, spawner, &call.arguments),
        WAIT_FOR_SUBAGENTS_TOOL => wait_for_subagents(sub, emitter, &call.arguments).await,
        SEND_MESSAGE_TOOL => send_message(sub, &call.arguments),
        // `is_subagent_tool` admits only the three arms above.
        other => ToolOutcome::error(format!("`{other}` is not a delegation tool.")),
    }
}

/// Handle `spawn_subagent`: resolve the brief and slot, [dispatch the child](dispatch_child) on the
/// scheduler (spawning its task), and return its id immediately — the parent keeps running (parallel
/// by default). A spawn at the [max depth](SubagentConfig::max_depth) fails as a
/// **limit** ([`ToolFailure::LimitExceeded`]), not queued — the request was well-formed and the run
/// simply has no room left below the spawner, which is a ceiling rather than a refusal.
///
/// A subagent is always driven by a free-form `prompt` brief: board **issues** are no longer
/// hand-dispatched to subagents — the [project-management](crate::board) capability
/// [auto-dispatches](Orchestrator::pump_dispatch) an actionable issue to a top-level agent itself.
fn spawn_subagent(sub: &mut SubagentContext, spawner: &Agent, args: &Value) -> ToolOutcome {
    let brief = match args.get("prompt").and_then(Value::as_str) {
        Some(prompt) if !prompt.trim().is_empty() => prompt.trim().to_string(),
        _ => {
            return ToolOutcome::failed(
                ToolFailure::InvalidArgument,
                "missing required argument `prompt`",
            );
        }
    };
    // The target agent profile must be named and must be one this agent may spawn.
    let profile = match resolve_delegation_target(&sub.orch, spawner, args) {
        Ok(profile) => profile,
        Err(refusal) => return refusal,
    };
    // Ad-hoc subagents carry no board issue (issues auto-dispatch to their own top-level agents)
    // and share the spawner's tree — isolation belongs to issues, which own the worktree's whole
    // lifecycle.
    match dispatch_child(sub, spawner, ChildSpec::new(&profile, brief)) {
        Ok(child) => {
            ToolOutcome::ok(
                format!(
                    "Spawned subagent `{id}` as agent `{slot}` (model `{model}`). It is running in \
                     parallel — call `wait_for_subagents` to collect its result, or `send_message` \
                     to guide it while it works.",
                    id = child.id,
                    slot = child.profile_id,
                    model = child.model_id,
                ),
                format!("spawned subagent `{}`", child.id),
            )
            // The structured half of the same facts. Delegation never reaches a
            // [`Tool`](crate::tools::Tool), so this handler is the **only** producer of the
            // sidecar a [code program](crate::sandbox)'s `spawnSubagent` reads back — without it a
            // program would be told the call succeeded and handed nothing to name the child by.
            .with_data(ApiData::SubagentSpawned(SubagentHandleData {
                id: child.id,
                slot: child.profile_id.clone(),
                model_id: child.model_id,
            }))
        }
        Err(err) => err.into(),
    }
}

/// A subagent that [`dispatch_child`] scheduled — the facts its dispatcher (`spawn_subagent`)
/// reports back.
struct DispatchedChild {
    /// The child's minted id (also the `wait`/`collect` handle in the spawner's children).
    id: String,
    /// The [profile](ChildSpec::profile) the child runs under, by id — echoed back so the tool
    /// result and the `spawnSubagent` sidecar agree with the tree.
    profile_id: String,
    /// The concrete model the profile's [binding](profile_binding) resolved to.
    model_id: String,
}

/// A delegation that could not be dispatched, carrying **both** halves of the answer: the sentence
/// the model reads and the class a structured consumer branches on.
///
/// The class exists because a [code program](crate::sandbox) catches a typed `ApiError` and asks
/// `e.code === "limit-exceeded"`. Every one of these failures is raised in the loop rather than in
/// a [`Tool`], so nothing else would classify them, and an unclassified refusal reaches a program
/// as the useless `other`. [`Display`](std::fmt::Display) renders the message alone, so the many
/// places that only quote the reason read exactly as they did before.
struct DispatchError {
    /// Why the dispatch was refused, in the vocabulary a program's `catch` reads.
    failure: ToolFailure,
    /// What to tell the model, including how to proceed.
    message: String,
}

impl DispatchError {
    /// A dispatch refusal of class `failure`, explained by `message`.
    fn new(failure: ToolFailure, message: impl Into<String>) -> Self {
        Self {
            failure,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for DispatchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl From<DispatchError> for ToolOutcome {
    fn from(error: DispatchError) -> Self {
        ToolOutcome::failed(error.failure, error.message)
    }
}

/// What a spawner is told when gg could not stand up a child it had already accepted the name of.
///
/// The class is [`Refused`](ToolFailure::Refused) rather than
/// [`InvalidArgument`](ToolFailure::InvalidArgument), and the wording says whose defect it is, for
/// the reason [`resolve_delegation_target`] gives on the other refusal of this shape: the
/// vocabulary a program branches on exists so a program can *do something else*, and a gg defect is
/// not something a program can branch its way out of. Naming the argument would be worse than
/// useless — the name was drawn from the roster this run gave the spawner, so a model told to pass a
/// different one has nothing better to pass, and the failure would enter its tool-error record as a
/// mistake it made.
///
/// The run is already ending on the [fault latch](crate::fault) by the time this is read, so what
/// this sentence is for is the record: the spawner's turn says what gg met rather than accusing the
/// model of it.
fn ggs_spawn_defect(slot: &str, err: &impl std::fmt::Display) -> String {
    format!(
        "cannot spawn agent `{slot}`: {err}. This is a gg defect: the run declares this agent and \
         launch validation accepts no profile it cannot stand up, so the run ends here rather than \
         continuing without the work this agent was for."
    )
}

/// Resolve and validate the `agent` argument of a model-invoked delegation call
/// (`spawn_subagent`) against the spawner's
/// [allowlist](GgAgentConfig::subagents), returning the target profile name or a model-facing
/// refusal that names the agents this agent may spawn. An agent may name itself.
///
/// A spawner whose own profile the run does not [declare](Orchestrator::declared_profile) has no
/// allowlist to check against, and there is no honest answer to give: reading the
/// [root](GgCapabilitySet::root)'s roster instead would let one profile spawn on another's
/// authority. It fails the call naming the defect. The class is [`Refused`](ToolFailure::Refused)
/// — the nearest existing one — because that vocabulary exists for a program to *branch* on, and
/// a gg defect is not something a program can branch its way out of; the message is where the
/// defect is actually reported, and this call is unreachable anyway on an agent that is running.
// The `Err` is a `ToolOutcome` — the model-facing refusal — which is deliberately the same
// large enum every tool returns; boxing it here alone would just add an unwrap at each call site.
#[allow(clippy::result_large_err)]
fn resolve_delegation_target(
    orch: &Orchestrator,
    spawner: &Agent,
    args: &Value,
) -> Result<String, ToolOutcome> {
    let Some(spawner_profile) = orch.declared_profile(&spawner.profile_id) else {
        return Err(ToolOutcome::failed(
            ToolFailure::Refused,
            format!(
                "agent profile `{}` is not declared by this run, so there is no roster to spawn \
                 from. This is a gg defect: launch validation accepts no reference to an \
                 undeclared profile.",
                spawner.profile_id
            ),
        ));
    };
    // The roster as the model was shown it: labels, resolved once from the whole set so that two
    // profiles sharing a name are still two things the model can name apart.
    let roster = orch.caps.roster(spawner_profile, GgSubagentScope::Subagent);
    let allowed = || {
        if roster.is_empty() {
            "none".to_string()
        } else {
            roster
                .iter()
                .map(|entry| format!("`{}`", entry.agent_id))
                .collect::<Vec<_>>()
                .join(", ")
        }
    };
    match args
        .get("agent")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|agent| !agent.is_empty())
    {
        Some(agent) if GgRosterEntry::offers(&roster, agent) => Ok(agent.to_string()),
        Some(agent) => Err(ToolOutcome::failed(
            ToolFailure::InvalidArgument,
            format!(
                "`agent`: unknown agent `{agent}`; expected one of: {}",
                allowed()
            ),
        )),
        None => Err(ToolOutcome::failed(
            ToolFailure::InvalidArgument,
            format!(
                "missing required argument `agent`; expected one of: {}",
                allowed()
            ),
        )),
    }
}

/// Dispatch one child agent — the spawn path behind `spawn_subagent` and
/// [`fork`](handle_fork).
///
/// Enforces the [depth cap](SubagentConfig::max_depth) (a structural ceiling, not a queue — it
/// fails as a [limit](ToolFailure::LimitExceeded) rather than a refusal), resolves the named
/// [agent profile](ChildSpec::profile) to a [binding](profile_binding) and a client, then builds
/// the child's identity/wiring/role, schedules its task on the scheduler, and registers it in the
/// spawner's [children](AgentCtx::children) so it can be waited on and messaged. An isolated
/// [worktree](Worktree) is *not* opened here — one arrives already open on the
/// [spec](ChildSpec::worktree), because isolation belongs to a board issue, which owns a worktree's
/// whole lifecycle. Returns the [dispatched child](DispatchedChild) or a model-facing error, so
/// both spawn kinds share one set of refusals.
///
/// Two of those refusals are gg's own rather than the model's — a profile that will not bind, and a
/// client that will not build for a reason other than a refused credential — and both end the run on
/// the [fault latch](crate::fault) as well as failing the call. A subagent gg could not stand up
/// leaves the tree missing whatever that agent was for, with nothing in the record to say the work
/// was ever attempted.
fn dispatch_child(
    sub: &mut SubagentContext,
    spawner: &Agent,
    spec: ChildSpec,
) -> Result<DispatchedChild, DispatchError> {
    let orch = &sub.orch;
    let ChildSpec {
        profile: profile_id,
        brief,
        issue_id,
        worktree,
        ending,
        id,
        seed,
    } = spec;

    // Depth cap: a structural refusal, not a queue. An agent at the max depth cannot delegate
    // deeper — it must do the work itself. A *ceiling*, so `limit-exceeded` rather than `refused`:
    // the request was well-formed, the run simply has no room left below this agent.
    if spawner.depth >= orch.config.max_depth {
        return Err(DispatchError::new(
            ToolFailure::LimitExceeded,
            format!(
                "at the maximum delegation depth ({})",
                orch.config.max_depth
            ),
        ));
    }

    // The child runs under the named agent profile. By the time the dispatch reaches this line the
    // name has already been checked against the spawner's own roster ([`resolve_delegation_target`]),
    // and launch validation has already rejected a roster reference to an undeclared profile and a
    // profile bound to an empty model id. So a binding that fails here is not a bad argument the
    // model can correct: it is gg having read one configuration two different ways, which ends the
    // run for the reason [`resolve_agent_client`] ends it one seam over. Telling the model its
    // argument was wrong would file gg's defect as the model's and let the run be scored.
    let binding = profile_binding(&orch.caps, &profile_id).map_err(|err| {
        orch.fault.in_agent(
            &spawner.id,
            &spawner.profile_id,
            format!("cannot spawn agent `{profile_id}`: {err}"),
        );
        DispatchError::new(ToolFailure::Refused, ggs_spawn_defect(&profile_id, &err))
    })?;
    // Keyed on the spawner and the spawn's position in the spawner's own strictly-ordered turn
    // loop, counted across **all** spawn kinds rather than per profile: a fork runs the forker's
    // own profile, so a fork child and a same-profile delegated subagent from one parent would
    // otherwise compete for the same queue.
    //
    // *Peeked* rather than taken, because the resolution below may still refuse the dispatch and a
    // refusal is a tool error the spawner recovers from: an ordinal spent on a child that never
    // existed would shift every later sibling's. It is taken, to the same value, once the dispatch
    // is going ahead.
    let spawn_key = format!("spawn:{}", spawner.id);
    let origin = GgSessionAgentOrigin::Spawn {
        parent: spawner.id.clone(),
        ordinal: orch.peek_ordinal(&spawn_key),
    };
    // The profile is bound but its client would not resolve, and the two halves of that are not one
    // failure — the same split [`resolve_agent_client`] draws for an agent standing itself up. A
    // refused credential is the operator's to supply: nothing about the call was wrong, the spawner
    // is told so as an I/O-class failure, and the run carries on. Anything else is a provider gg
    // could not build for a profile gg validated, which is gg's defect and ends the run.
    let client = orch
        .factory
        .client_for_agent(&binding, &AgentIdentity::agent(origin.clone()))
        .map_err(|err| {
            if err.is_auth_failure() {
                return DispatchError::new(
                    ToolFailure::IoError,
                    format!(
                        "cannot spawn agent `{profile_id}` (model `{}`): {err}",
                        binding.model_id
                    ),
                );
            }
            orch.fault.in_agent(
                &spawner.id,
                &spawner.profile_id,
                format!(
                    "cannot spawn agent `{profile_id}` (model `{}`): {err}",
                    binding.model_id
                ),
            );
            DispatchError::new(ToolFailure::Refused, ggs_spawn_defect(&profile_id, &err))
        })?;
    let model_id = client.model_id().to_string();

    // Build the child's identity, wiring, and role, then schedule it. The child clones the
    // spawner's `ParentWait` so it can signal completion back up. A fork's id was minted at the
    // call that declared it — the forker was handed it a moment ago, in the tool result — so it is
    // reused here rather than drawn again.
    let child_id = id.unwrap_or_else(|| orch.next_agent_id());

    let (inbox_tx, inbox_rx) = mpsc::unbounded_channel();
    let (result_tx, result_rx) = oneshot::channel();
    let finished = Arc::new(AtomicBool::new(false));
    let child = Agent {
        id: child_id.clone(),
        parent_id: Some(spawner.id.clone()),
        depth: spawner.depth + 1,
        profile_id: profile_id.clone(),
        // A child is not standing in its spawner's machine: it was given a job by the agent in that
        // state, not the state itself. That holds for a fork too — a copy of a state's agent is a
        // second worker, not a second driver of the process. Its own profile may of course be an
        // FSM shell, which `run_agent` enters for it.
        fsm: None,
    };
    let role = AgentRole::Sub {
        brief,
        issue_id,
        worktree,
        ending,
        // What the spawner holds, offered to the child. Whether the child takes it is its own
        // profile's decision — see `MemoriesRuntime::resolve`.
        inherited: sub.inherited.offer(),
        seed,
        link: Some(SpawnerLink {
            parent_wait: Arc::clone(&sub.ctx.wait),
            result: result_tx,
            finished: Arc::clone(&finished),
        }),
    };
    // Take the ordinal the identity above was peeked at, now that the child is certainly being
    // created. Debug-asserted equal because the two diverging would silently bind this child to a
    // sibling's recorded queue — the exact failure provenance keying exists to rule out.
    let taken = orch.next_ordinal(spawn_key);
    debug_assert_eq!(
        GgSessionAgentOrigin::Spawn {
            parent: spawner.id.clone(),
            ordinal: taken,
        },
        origin,
        "a spawn's peeked ordinal and the one it took must agree"
    );
    let orch_for_task = Arc::clone(orch);
    let task = AgentTask::spawned(&child_id, &profile_id, async move {
        run_agent(orch_for_task, child, role, client, inbox_rx, origin).await;
    });
    orch.tasks.lock().expect("subagent tasks lock").push(task);
    sub.ctx.children.push(ChildHandle {
        id: child_id.clone(),
        inbox: inbox_tx,
        finished,
        result: Some(result_rx),
        collected: false,
    });

    Ok(DispatchedChild {
        id: child_id,
        profile_id,
        model_id,
    })
}

/// What one [dispatch](dispatch_child) is asked for: which profile to run, what to tell it, and the
/// four things only some dispatchers set.
///
/// It is a struct rather than a parameter list because the list had already reached clippy's
/// argument ceiling before `fork` needed two more, and because most dispatchers care about two of
/// the seven fields: a `spawn_subagent` is a profile and a brief, and everything else is a default
/// it should not have to spell.
struct ChildSpec {
    /// The [agent profile](GgAgentConfig) the child runs under.
    profile: String,
    /// The brief that drives the child — its build prompt, and what its
    /// [`AgentSpawned`](GgTelemetryKind::AgentSpawned) reports it was dispatched with. A
    /// [seeded](Self::seed) child opens on a carried window instead, so for a fork this is the
    /// instruction rather than the whole context.
    brief: String,
    /// The board issue the child is dispatched against, when any — it scopes the child's telemetry.
    issue_id: Option<String>,
    /// The isolated [worktree](Worktree) the child's tools are rooted in, when it gets one.
    worktree: Option<Worktree>,
    /// Which [ending calls](EndingRole) the child is dispatched with.
    ending: EndingRole,
    /// The child's agent id, when it has already been minted. Only a [fork](handle_fork) sets it:
    /// its id was returned to the forker at the call, before the dispatch this spec drives.
    id: Option<String>,
    /// The modules and opening note a [fork](handle_fork) was built with.
    seed: Option<Box<Succession>>,
}

impl ChildSpec {
    /// An ordinary child: a profile, a brief, and every option at its default.
    fn new(profile: impl Into<String>, brief: impl Into<String>) -> Self {
        Self {
            profile: profile.into(),
            brief: brief.into(),
            issue_id: None,
            worktree: None,
            ending: EndingRole::Standard,
            id: None,
            seed: None,
        }
    }

    /// This child as a **fork**: an id already minted and handed to its forker, and the clone of
    /// everything the forker held for it to open on.
    fn forked(mut self, id: String, seed: Succession) -> Self {
        self.id = Some(id);
        self.seed = Some(Box::new(seed));
        self
    }
}

/// A filesystem- and git-safe slug for a worktree branch/directory built from `name`.
///
/// Issue ids are model-chosen strings, so they can carry slashes, spaces, or anything else the model
/// felt like typing — none of which belong in a branch name or a directory. Every character outside
/// `[A-Za-z0-9._-]` becomes `-`, and an empty result falls back to `unnamed`, so a worktree can
/// always be created for any issue.
fn worktree_slug(name: &str) -> String {
    let slug: String = name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '-'
            }
        })
        .collect();
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "unnamed".to_string()
    } else {
        slug
    }
}

/// The first line of `text`, trimmed — used to keep a multi-line git conflict message to one line
/// in a subagent's return-value note.
fn first_line(text: &str) -> &str {
    text.lines().next().unwrap_or("").trim()
}

/// Handle `wait_for_subagents`: block until the named (or all outstanding) children have returned,
/// freeing this agent's slot while it waits, then collect and return their results. Emits the
/// [`Blocked`](GgAgentStatus::Blocked)→[`Running`](GgAgentStatus::Running) transitions only when it
/// actually blocks.
async fn wait_for_subagents(
    sub: &mut SubagentContext,
    emitter: &Emitter,
    args: &Value,
) -> ToolOutcome {
    // The awaited ids: an explicit `ids` list (validated against this agent's children) or every
    // not-yet-collected child.
    let awaited_ids: Vec<String> = match args.get("ids") {
        Some(Value::Array(items)) => {
            let mut ids = Vec::with_capacity(items.len());
            for item in items {
                match item.as_str() {
                    Some(id) => {
                        if !sub.ctx.children.iter().any(|c| c.id == id) {
                            return ToolOutcome::failed(
                                ToolFailure::NotFound,
                                format!(
                                    "`{id}` is not one of this agent's subagents; only agents \
                                     it spawned can be waited on."
                                ),
                            );
                        }
                        ids.push(id.to_string());
                    }
                    None => {
                        return ToolOutcome::failed(
                            ToolFailure::InvalidArgument,
                            "each entry in `ids` must be a subagent id string.",
                        );
                    }
                }
            }
            ids
        }
        Some(Value::Null) | None => sub
            .ctx
            .children
            .iter()
            .filter(|c| !c.collected)
            .map(|c| c.id.clone())
            .collect(),
        Some(_) => {
            return ToolOutcome::failed(
                ToolFailure::InvalidArgument,
                "`ids` must be an array of subagent id strings (or omit it to wait for all).",
            );
        }
    };

    if awaited_ids.is_empty() {
        // A successful wait over nothing. The empty sidecar is not a formality: a program that
        // received no data at all would be thrown into with a gg-defect diagnostic, when the honest
        // answer is simply "no children returned anything, because there were none".
        return ToolOutcome::ok(
            "You have no outstanding subagents to wait for.",
            "no subagents to wait for",
        )
        .with_data(ApiData::SubagentResults(Vec::new()));
    }

    // Block until every awaited child returns (freeing this agent's slot while it waits), then
    // collect their return values.
    let collected = await_children(sub, emitter, &awaited_ids).await;
    let lines: Vec<String> = collected
        .iter()
        .map(|(id, returned)| match returned {
            Some(ret) => format!(
                "Subagent `{}` returned ({}):\n{}",
                id, ret.status, ret.summary
            ),
            None => format!("Subagent `{id}` returned no result."),
        })
        .collect();

    // The structured half of the same collection, in the same order. This handler is the only
    // producer of it: a wait never reaches a [`Tool`](crate::tools::Tool), so without this a
    // [code program](crate::sandbox) could not branch on whether a child actually completed.
    let results: Vec<SubagentResultData> = collected
        .iter()
        .map(|(id, returned)| SubagentResultData {
            id: id.clone(),
            // An unrecognised ending — including the empty one a child that produced nothing at
            // all leaves behind — is reported as "no status" rather than as a plausible-looking
            // wrong one, since a caller that sees `None` will read the summary instead.
            status: returned
                .as_ref()
                .and_then(|returned| AgentStatusData::parse(returned.status)),
            summary: returned
                .as_ref()
                .map(|returned| returned.summary.clone())
                .unwrap_or_default(),
        })
        .collect();

    ToolOutcome::ok(
        format!(
            "Collected {} subagent result(s):\n\n{}",
            collected.len(),
            lines.join("\n\n")
        ),
        format!("collected {} subagent result(s)", collected.len()),
    )
    .with_data(ApiData::SubagentResults(results))
}

/// Block until every child in `awaited_ids` has returned — freeing this agent's running slot while
/// it waits (and, for an instance of a [persistent](crate::persistence) profile, the
/// profile itself, so a queued instance may run while this one is suspended) so its children and
/// other agents can run under the [cap](Scheduler) — then collect
/// each child's [return value](AgentReturn) (in the given order) and mark it collected. Emits the
/// [`Blocked`](GgAgentStatus::Blocked)→[`Running`](GgAgentStatus::Running) transitions only when it
/// actually blocks.
///
/// The one wait-and-collect primitive behind `wait_for_subagents`, so every wait frees the slot and
/// resumes identically through the scheduler. Every id is expected to name one of this agent's
/// children; an unknown id collects as `None`.
async fn await_children(
    sub: &mut SubagentContext,
    emitter: &Emitter,
    awaited_ids: &[String],
) -> Vec<(String, Option<AgentReturn>)> {
    // `begin_wait` returns `None` when every awaited child has already finished, in which case
    // there is nothing to block on.
    let awaited: BTreeSet<String> = awaited_ids.iter().cloned().collect();
    let exclusive = sub.ctx.exclusive.clone();
    if let Some(rx) = sub.ctx.wait.begin_wait(
        &sub.orch.scheduler,
        &awaited,
        exclusive.as_deref(),
        &sub.ctx.hold,
    ) {
        emitter.emit(agent_blocked_on(waited_subagents_condition(awaited_ids)));
        let _ = rx.await;
        emitter.emit(agent_status(GgAgentStatus::Running));
    }

    // Collect each awaited child's return value (all delivered by now — a child sends its result
    // before signalling this wait) and mark them collected.
    let mut collected = Vec::with_capacity(awaited_ids.len());
    for id in awaited_ids {
        let returned = match sub.ctx.children.iter_mut().find(|c| c.id == *id) {
            Some(child) => {
                child.collected = true;
                match child.result.take() {
                    Some(rx) => rx.await.ok(),
                    None => None,
                }
            }
            None => None,
        };
        collected.push((id.clone(), returned));
    }
    collected
}

/// The [wait condition](agent_blocked_on) for an agent blocking on its subagents: the ids it is
/// collecting, named. Long fan-outs are summarized after the first few — the point is *what* the
/// agent is waiting for, and a wall of ids on a status line is no more legible than a count.
fn waited_subagents_condition(ids: &[String]) -> String {
    /// How many awaited ids are named before the rest become a "+N more".
    const NAMED: usize = 3;
    let named: Vec<String> = ids.iter().take(NAMED).map(|id| format!("`{id}`")).collect();
    let rest = ids.len().saturating_sub(named.len());
    let plural = if ids.len() == 1 { "" } else { "s" };
    if rest == 0 {
        format!("subagent{plural} {}", named.join(", "))
    } else {
        format!("subagent{plural} {} +{rest} more", named.join(", "))
    }
}

/// Handle `send_message`: deliver a message to one of this agent's **running** children, which the
/// child drains at its next turn boundary (a live channel, not spawn-and-wait-only).
fn send_message(sub: &mut SubagentContext, args: &Value) -> ToolOutcome {
    let agent_id = match args.get("agentId").and_then(Value::as_str) {
        Some(id) if !id.trim().is_empty() => id.trim().to_string(),
        _ => {
            return ToolOutcome::failed(
                ToolFailure::InvalidArgument,
                "send_message needs a non-empty `agentId`.",
            );
        }
    };
    let message = match args.get("message").and_then(Value::as_str) {
        Some(message) if !message.trim().is_empty() => message.to_string(),
        _ => {
            return ToolOutcome::failed(
                ToolFailure::InvalidArgument,
                "send_message needs a non-empty `message`.",
            );
        }
    };
    match sub.ctx.children.iter().find(|c| c.id == agent_id) {
        None => ToolOutcome::failed(
            ToolFailure::NotFound,
            format!(
                "`{agent_id}` is not one of this agent's subagents; only agents it spawned can \
                 be messaged."
            ),
        ),
        // The agent exists but its lifecycle has moved past being messageable: well-formed, in
        // conflict with the current state, which is what `conflict` means.
        Some(child) if child.is_finished() => ToolOutcome::failed(
            ToolFailure::Conflict,
            format!("subagent `{agent_id}` has already returned; it no longer receives messages."),
        ),
        Some(child) => match child.inbox.send(message) {
            Ok(()) => ToolOutcome::ok(
                format!(
                    "Sent your message to subagent `{agent_id}`; it will receive it at its next \
                     turn."
                ),
                format!("messaged subagent `{agent_id}`"),
            ),
            Err(_) => ToolOutcome::failed(
                ToolFailure::Conflict,
                format!("subagent `{agent_id}` is no longer receiving messages (it has returned)."),
            ),
        },
    }
}

// ---------------------------------------------------------------------------
// Issue reconciliation: reviewers, the fix loop, and the merge back
// ---------------------------------------------------------------------------

/// What one round of an [issue's](crate::board) review concluded.
enum RoundOutcome {
    /// Every reviewer approved: the issue may be merged and accepted.
    Approved,
    /// A reviewer returned actionable items: the issue's assigned agent is re-invoked with them.
    ChangesRequested(Vec<String>),
    /// The review could not be conducted (a reviewer profile this run does not
    /// [declare](Orchestrator::reviewer_slots), one that would not dispatch, or one that ended
    /// without a verdict). The issue is **not** accepted — work no reviewer approved never is.
    Aborted(String),
}

/// Reconcile an [issue](crate::board) once the agent working it has finished — the whole of what
/// happens between "an agent stopped" and "the board moved".
///
/// `completed` is whether that agent's loop ended in a **completion** ([`STATUS_COMPLETED`]) rather
/// than on a ceiling or an error. That — and nothing else — is what finishes an issue: the agent
/// signalled completion with the [ending call](crate::completion) its role gives it, and
/// there is no second, board-specific signal for it to forget. Three things can be true when an
/// issue agent's loop ends, and each has its own path:
///
/// 1. It **finished** the work. gg moves the issue to [`InReview`](IssueStatus::InReview) and runs
///    its [reviewers](run_issue_review) in turn. On approval the issue's worktree is
///    [merged back](merge_issue_worktree) and the issue is
///    [accepted](BoardRuntime::accept_issue); on a request for changes the issue is
///    [reopened](Orchestrator::reopen_issue_for_review) under its own assigned agent with the items,
///    and this whole path runs again when *that* agent finishes. There is deliberately **no cycle
///    limit** — a review that keeps finding real problems should keep finding them — so the loop is
///    bounded by the run's own ceilings.
/// 2. It **stopped without finishing** and retries remain: the issue is re-dispatched to a fresh
///    agent in the same worktree, so the next attempt continues rather than restarts.
/// 3. It stopped without finishing and the retries are spent: the issue is
///    [failed](BoardRuntime::fail_issue) and its worktree discarded unmerged.
///
/// A fourth possibility supersedes all three: the run has [faulted](crate::fault). Then this agent
/// stopped because gg broke, in it or in some other agent, and the issue is
/// [abandoned](abandon_issue_on_fault) instead of reviewed or retried.
///
/// Every path ends by [pumping the board](Orchestrator::on_issue_progress), so dependents unblock
/// and waiters wake exactly once the issue's real state is settled.
async fn reconcile_issue(
    orch: &Arc<Orchestrator>,
    issue_id: &str,
    retry: u32,
    completed: bool,
    emitter: &Emitter,
) {
    if let Some(fault) = orch.fault.raised() {
        abandon_issue_on_fault(orch, issue_id, retry, completed, fault, emitter);
    } else if completed && orch.board.submit_issue_for_review(issue_id) {
        match run_issue_review(orch, issue_id, emitter).await {
            RoundOutcome::Approved => {
                accept_issue(orch, issue_id, emitter).await;
            }
            RoundOutcome::ChangesRequested(items) => {
                // The issue goes back to its own assigned agent with the reviewer's items. It stays
                // non-terminal throughout, so its waiters keep waiting and its dependents stay
                // blocked — which is the point of `InReview` not being `Done`.
                orch.reopen_issue_for_review(issue_id, &items, emitter);
            }
            RoundOutcome::Aborted(reason) => {
                emitter.emit(log(
                    "warn",
                    format!(
                        "the review of issue `{issue_id}` could not be completed ({reason}); the \
                         issue was not accepted."
                    ),
                ));
                orch.board.fail_issue(issue_id);
                discard_issue_worktree(orch, issue_id, emitter).await;
            }
        }
    } else if (retry as usize) < orch.board.max_retries() {
        // It stopped without finishing — a spent ceiling, a breached limit, or a model error — and
        // retries remain: re-dispatch it to a fresh agent. The issue stays `InProgress` (its waiters
        // keep waiting) and keeps its worktree, so the next attempt continues from what this one
        // produced.
        orch.redispatch_issue(issue_id, retry + 1, emitter);
    } else {
        // Retries exhausted: mark it failed (terminal, but not done — dependents stay blocked),
        // throw its unmerged work away, and wake anyone waiting on it.
        orch.board.fail_issue(issue_id);
        emitter.emit(log(
            "warn",
            format!(
                "issue `{issue_id}` could not be completed after {} attempt(s); marking it failed.",
                retry + 1
            ),
        ));
        discard_issue_worktree(orch, issue_id, emitter).await;
    }
    orch.on_issue_progress(emitter);
}

/// Settle issue `issue_id` on a run that has [faulted](crate::fault): mark it failed, keep its
/// worktree, and dispatch nothing further for it.
///
/// **A run gg broke in starts no new work.** Two of the three paths this replaces stand a fresh
/// agent up: a re-dispatch of an unfinished issue, and a reviewer over a finished one. Each of those
/// agents reads the latch at its first turn boundary and stops there, having done nothing. The
/// board would then record `maxRetries` attempts at an issue nothing ever attempted, which is a
/// worse account of the run than no attempt at all: it reads as a model that could not finish the
/// work.
///
/// **Failed** is the honest state whichever way the agent ended, and it is the state that resolves
/// the waits. On this board `failed` means terminal without being done, so an issue whose
/// implementer was cut short by the fault is failed for the obvious reason, and one whose
/// implementer finished is failed because its work was never gated by its reviewers or merged back.
/// Leaving either `in_progress` would leave the board claiming work is under way that nothing will
/// take up. What it does *not* have to do is release the agents suspended on it: the
/// [latch](crate::fault) released every wait in the run when the fault was raised, this issue's
/// among them, because a fault leaves plenty of waits that no board move of any kind could settle.
///
/// The worktree is **kept**. A run winding down under a fault is evidence for the defect that
/// stopped it, and the branch this issue's agent was working on is part of that evidence; the
/// retries-exhausted path discards its worktree because that run is a result, and this one is not.
fn abandon_issue_on_fault(
    orch: &Arc<Orchestrator>,
    issue_id: &str,
    retry: u32,
    completed: bool,
    fault: &str,
    emitter: &Emitter,
) {
    if !orch.board.issue_is_terminal(issue_id) {
        orch.board.fail_issue(issue_id);
    }
    let what = if completed {
        format!("issue `{issue_id}` was implemented but never reviewed or merged")
    } else {
        format!(
            "issue `{issue_id}` was left unfinished on attempt {}",
            retry + 1
        )
    };
    // Repeated on the issue's own stream rather than pointing at the run-level line, for the reason
    // every wind-down message repeats it: a reader who starts from the red issue on the board is
    // standing here, and the cause is what they need.
    emitter.emit(log(
        "warn",
        format!(
            "{what}: {fault}. It is marked failed with its worktree kept, and no further attempt \
             is dispatched: a run gg broke in starts no new work."
        ),
    ));
}

/// Run one **review round** over `issue_id`: dispatch each of its [reviewers](Orchestrator::reviewer_slots)
/// in turn against the current diff of its work, and report what the round concluded.
///
/// The reviewers run **sequentially**, and the first that does not approve ends the round — a second
/// opinion is never spent on work already known to need changes. Each is shown the issue's brief, the
/// diff, and the [history](Orchestrator::review_history) of every verdict rendered so far, so a
/// re-review can tell whether its own earlier items were addressed and a later reviewer knows what an
/// earlier one already asked for. Every verdict is recorded on the issue, whichever way it went.
///
/// An issue that named **no** reviewers is approved immediately, because there is nobody to gate
/// it, and emits no review telemetry at all: a board whose issues are filed without reviewers
/// carries none.
///
/// An issue that named a reviewer this run does not [declare](Orchestrator::reviewer_slots) is the
/// opposite case and gets the opposite answer. The round is [aborted](RoundOutcome::Aborted), which
/// fails the issue rather than merging work its filer gated on a review that never happened — the
/// two are indistinguishable on the board and in the telemetry once the name has been dropped, so
/// the name is never dropped. That such a name arrived is gg's own defect, nothing an operator or a
/// model can configure, so it is reported at `error` level here and [ends the run](crate::fault):
/// the abort says only that the issue was not accepted, which is the consequence rather than the
/// cause, and a run whose configured gate never ran is not one to compare against a run whose
/// did.
async fn run_issue_review(
    orch: &Arc<Orchestrator>,
    issue_id: &str,
    emitter: &Emitter,
) -> RoundOutcome {
    let reviewers = match orch.reviewer_slots(issue_id) {
        Ok(reviewers) => reviewers,
        // A reviewer nothing declares is the same gg defect as an assignee nothing declares, one
        // step further along the board: the issue fails rather than merging work no reviewer gated,
        // and the run ends with it, because a run missing a review it was configured to make cannot
        // be compared with one that made it.
        Err(err) => {
            emitter.emit(log(
                "error",
                format!(
                    "cannot review issue `{issue_id}`: {err}; failing the issue rather than \
                     accepting work no reviewer gated, and ending the run: this is a gg defect."
                ),
            ));
            orch.fault.in_dispatch(issue_id, None, &err);
            return RoundOutcome::Aborted(err);
        }
    };
    if reviewers.is_empty() {
        return RoundOutcome::Approved;
    }
    let Some(brief) = orch.board.issue_brief(issue_id) else {
        return RoundOutcome::Aborted(format!("issue `{issue_id}` is no longer on the board"));
    };
    let baseline = orch.issue_baseline(issue_id);
    // The review's lifecycle events ride on the issue's own stream.
    let review_emitter = emitter.with_issue(issue_id);
    review_emitter.emit(issue_review_event(
        GgIssueReviewPhase::Requested,
        None,
        None,
        Vec::new(),
        baseline.clone(),
    ));

    let changes = orch.review_changes(issue_id).await;
    let history = orch.review_history(issue_id);
    let worktree = orch.issue_worktree(issue_id);
    // Which round of this issue's review this is — board state, so a reconstruction re-derives it
    // rather than reading it off an agent id. It is what a reviewer's replay
    // [origin](GgSessionAgentOrigin::Reviewer) is bound by, alongside its position within the round.
    let round = orch.next_ordinal(format!("review:{issue_id}"));
    // Who has approved so far *this round*, in the order they ran: reported on whichever event ends
    // the round, so a verdict is attributable to an agent rather than to "the review".
    let mut approvals: Vec<GgReviewer> = Vec::new();
    for (position, profile) in reviewers.into_iter().enumerate() {
        // Each reviewer is named under the implementer whose work it is reviewing (`AUTH-1.0i.0r`),
        // so the agent id says which attempt was reviewed and in what order.
        let agent_id = orch
            .board
            .next_review_agent_id(issue_id)
            .unwrap_or_else(|| orch.next_agent_id());
        let reviewer = GgReviewer {
            agent_id: agent_id.clone(),
            profile_id: profile.clone(),
            profile: orch.caps.agent_name(&profile).to_string(),
        };
        let review_brief = build_review_brief(
            &brief,
            ReviewChanges {
                summary: &changes,
                baseline: baseline.as_deref(),
            },
            history.clone(),
        );
        let returned = run_detached_agent(
            orch,
            DetachedDispatch {
                agent_id,
                profile: &profile,
                brief: review_brief,
                issue_id: Some(issue_id.to_string()),
                worktree: worktree.clone(),
                ending: EndingRole::Review,
                origin: GgSessionAgentOrigin::Reviewer {
                    issue: issue_id.to_string(),
                    round,
                    position: position as u32,
                },
            },
        )
        .await;
        // The reviewer's verdict is read from what it **declared**, not from what it wrote. A
        // reviewer that ended any other way — a ceiling, a model error — returned no verdict at all,
        // and work no reviewer approved is never accepted.
        let (approved, items) = match returned {
            Ok(ret) if ret.status == STATUS_COMPLETED => match ret.ending {
                Some(Ending::Approved) => (true, Vec::new()),
                Some(Ending::ChangesRequested { items }) => (false, items),
                _ => {
                    return RoundOutcome::Aborted(format!(
                        "the reviewer `{profile}` ended without a verdict"
                    ));
                }
            },
            Ok(ret) => {
                return RoundOutcome::Aborted(format!(
                    "the reviewer `{profile}` {} without a verdict",
                    ret.status
                ));
            }
            Err(err) => {
                return RoundOutcome::Aborted(format!("the reviewer `{profile}` {err}"));
            }
        };
        orch.record_review(
            issue_id,
            ReviewRecord {
                reviewer: profile.clone(),
                approved,
                items: items.clone(),
            },
        );
        if !approved {
            review_emitter.emit(issue_review_event(
                GgIssueReviewPhase::ChangesRequested,
                Some(items.clone()),
                Some(reviewer),
                approvals,
                baseline,
            ));
            return RoundOutcome::ChangesRequested(items);
        }
        approvals.push(reviewer);
    }
    review_emitter.emit(issue_review_event(
        GgIssueReviewPhase::Approved,
        None,
        None,
        approvals,
        baseline,
    ));
    RoundOutcome::Approved
}

/// **Accept** `issue_id`: merge its worktree back into the main tree, then mark it
/// [`Done`](IssueStatus::Done).
///
/// The order matters. An issue is only done once its work is actually in the workspace, because
/// `Done` is what unblocks its dependents — and a dependent dispatched against work still sitting on
/// an unmerged branch would be building on something that is not there. A merge that could not be
/// completed (not even by the [merge agent](Orchestrator::merge_agent)) therefore
/// [fails](BoardRuntime::fail_issue) the issue rather than accepting it, so the board says what is
/// true.
async fn accept_issue(orch: &Arc<Orchestrator>, issue_id: &str, emitter: &Emitter) {
    if merge_issue_worktree(orch, issue_id, emitter).await {
        orch.board.accept_issue(issue_id);
        emitter.emit(log(
            "info",
            format!("issue `{issue_id}` is accepted and done."),
        ));
    } else {
        orch.board.fail_issue(issue_id);
        emitter.emit(log(
            "error",
            format!(
                "issue `{issue_id}` was approved but its work could not be merged into the main \
                 workspace; marking it failed so anything depending on it stays blocked."
            ),
        ));
    }
}

/// Merge an accepted issue's isolated branch back into the main tree, returning whether the work
/// actually landed.
///
/// The whole span holds the [merge lock](Orchestrator::merge_lock), because a merge is not one git
/// call: it commits the worktree, merges the branch, and — on a conflict — hands the conflicted tree
/// to the [merge agent](Orchestrator::merge_agent) and waits. A second merge running against a tree
/// with `MERGE_HEAD` set would be refused by git, and a concurrent abort would throw away the merge
/// agent's resolution.
///
/// A conflict is **not** a failure by itself: with issues running concurrently it is an ordinary
/// event, which is exactly why the capability requires a merge agent. Only a conflict that agent
/// could not resolve leaves the merge undone, and then the merge is aborted so the main tree is
/// restored rather than left half-merged. The worktree is torn down in every case, and the outcome
/// is streamed as [`WorktreeMerged`](GgTelemetryKind::WorktreeMerged) on the issue's own stream.
///
/// An issue with **no** worktree (git isolation was unavailable) worked directly in the shared
/// workspace, so there is nothing to merge and it lands trivially.
async fn merge_issue_worktree(orch: &Arc<Orchestrator>, issue_id: &str, emitter: &Emitter) -> bool {
    let Some(worktree) = orch.take_issue_worktree(issue_id) else {
        return true;
    };
    let issue_emitter = emitter.with_issue(issue_id);
    let _guard = orch.merge_lock.lock().await;

    // Commit whatever the issue produced onto its branch. A worktree with no changes commits
    // nothing, which merges as a no-op — an issue whose work was already present is still accepted.
    let capture = orch.git_capture(ROOT_AGENT_ID);
    if let Err(err) =
        git::commit_worktree(&capture, &worktree.path, &format!("gg issue {issue_id}")).await
    {
        emitter.emit(log(
            "error",
            format!("could not commit the work for issue `{issue_id}`: {err}"),
        ));
        remove_worktree(orch, &worktree, emitter).await;
        issue_emitter.emit(GgTelemetryKind::WorktreeMerged {
            branch: worktree.branch,
            merged: false,
            conflicts: false,
        });
        return false;
    }

    // Leave a conflict **in** the tree: the merge agent resolves it in place, which is only possible
    // if git has not already unwound it.
    let outcome = git::merge_branch(
        &capture,
        &orch.workspace_dir,
        &worktree.branch,
        git::ConflictPolicy::Keep,
    )
    .await;
    let (merged, conflicts) = match outcome {
        Ok(git::MergeOutcome::Merged) => (true, false),
        Ok(git::MergeOutcome::Conflict(reason)) => {
            emitter.emit(log(
                "warn",
                format!(
                    "merging issue `{issue_id}` conflicts with work already in the main \
                     workspace: {}",
                    first_line(&reason)
                ),
            ));
            (
                resolve_merge_conflict(orch, issue_id, &worktree, &reason, emitter).await,
                true,
            )
        }
        Err(err) => {
            emitter.emit(log(
                "error",
                format!("merging issue `{issue_id}` into the main workspace failed: {err}"),
            ));
            (false, false)
        }
    };
    // A merge that never completed must not be left half-applied: abort it so the main tree is
    // exactly what it was, and the issue is reported as unmerged rather than silently corrupting
    // every later merge.
    if !merged {
        git::abort_merge(&capture, &orch.workspace_dir).await;
    }
    remove_worktree(orch, &worktree, emitter).await;
    issue_emitter.emit(GgTelemetryKind::WorktreeMerged {
        branch: worktree.branch,
        merged,
        conflicts,
    });
    merged
}

/// Hand a conflicted merge to the run's [merge agent](Orchestrator::merge_agent) and report whether
/// it finished the merge.
///
/// The agent runs in the **main tree** (that is where the conflict is) with its own shell, which is
/// why the capability insists a merge agent has one. gg does not take its word for the outcome: the
/// merge counts as resolved only if git agrees the merge is no longer in progress, so an agent that
/// says "done" without committing leaves the merge unresolved.
async fn resolve_merge_conflict(
    orch: &Arc<Orchestrator>,
    issue_id: &str,
    worktree: &Worktree,
    reason: &str,
    emitter: &Emitter,
) -> bool {
    let Some(merge_agent) = orch.merge_agent.clone() else {
        emitter.emit(log(
            "error",
            format!(
                "issue `{issue_id}` conflicts with the main workspace and no merge agent is \
                 configured to resolve it."
            ),
        ));
        return false;
    };
    let brief = build_merge_brief(&worktree.branch, reason);
    emitter.emit(log(
        "info",
        format!(
            "dispatching the merge agent `{merge_agent}` ({}) to resolve issue `{issue_id}`.",
            orch.caps.agent_name(&merge_agent)
        ),
    ));
    // The merge agent works in the main tree — that is where the conflicted merge lives — so it is
    // dispatched with no worktree of its own.
    match run_detached_agent(
        orch,
        DetachedDispatch {
            agent_id: orch.next_agent_id(),
            profile: &merge_agent,
            brief,
            issue_id: Some(issue_id.to_string()),
            worktree: None,
            ending: EndingRole::Standard,
            // The row that proves why provenance keying is necessary at all: a merge agent's live
            // id comes straight off the global agent counter, so it can only be bound by what it
            // was dispatched *for* — this issue, and which merge of it this is.
            origin: GgSessionAgentOrigin::Merge {
                issue: issue_id.to_string(),
                ordinal: orch.next_ordinal(format!("merge:{issue_id}")),
            },
        },
    )
    .await
    {
        Ok(_) => {}
        Err(err) => {
            emitter.emit(log(
                "error",
                format!("the merge agent for issue `{issue_id}` {err}"),
            ));
            return false;
        }
    }
    if git::merge_in_progress(&orch.git_capture(ROOT_AGENT_ID), &orch.workspace_dir).await {
        emitter.emit(log(
            "error",
            format!(
                "the merge agent did not finish the merge of issue `{issue_id}` (the workspace is \
                 still mid-merge); aborting it and leaving the main workspace unchanged."
            ),
        ));
        return false;
    }
    emitter.emit(log(
        "info",
        format!(
            "the merge agent resolved the conflict and completed the merge of issue `{issue_id}`."
        ),
    ));
    true
}

/// Throw away `issue_id`'s worktree unmerged — what a [failed](IssueStatus::Failed) issue's
/// half-finished work gets. A no-op for an issue that never had one.
async fn discard_issue_worktree(orch: &Arc<Orchestrator>, issue_id: &str, emitter: &Emitter) {
    let Some(worktree) = orch.take_issue_worktree(issue_id) else {
        return;
    };
    remove_worktree(orch, &worktree, emitter).await;
    emitter
        .with_issue(issue_id)
        .emit(GgTelemetryKind::WorktreeMerged {
            branch: worktree.branch,
            merged: false,
            conflicts: false,
        });
}

/// Tear a worktree and its branch down. Best-effort: a cleanup failure leaves a breadcrumb but never
/// fails a run, since the work it guards has already been merged or deliberately discarded.
async fn remove_worktree(orch: &Orchestrator, worktree: &Worktree, emitter: &Emitter) {
    let _guard = orch.git_lock.lock().await;
    if let Err(err) = git::remove_worktree(
        &orch.git_capture(ROOT_AGENT_ID),
        &orch.workspace_dir,
        &worktree.path,
        &worktree.branch,
    )
    .await
    {
        emitter.emit(log(
            "warn",
            format!(
                "tearing down worktree `{}` reported: {err}",
                worktree.branch
            ),
        ));
    }
}

/// Run one agent to completion **out of band** from any spawner, returning its
/// [result](AgentReturn) — the primitive behind an issue's reviewers and the merge agent.
///
/// The caller supplies `agent_id` rather than the id being minted here, because the two callers name
/// their agents differently: a reviewer is named after the issue and the implementer whose work it
/// reviews (`AUTH-1.0i.0r`), while a merge agent is an ordinary `agent-N` from the run's counter.
///
/// These are agents the *orchestrator* needs, not ones a model asked for: they are dispatched while
/// no agent holds a running slot (the issue agent that triggered the reconciliation has already
/// released its own), so this simply awaits the child's result channel rather than going through the
/// [parent-wait](ParentWait) machinery a `wait_for_subagents` uses. That is also what makes them
/// independent of the [subagents](CAPABILITY_SUBAGENTS) capability: a board can review and merge its
/// issues without the run offering anyone a `spawn_subagent` tool.
///
/// The return type is spelled out as a boxed `Send` future rather than left to `async fn` inference
/// because the recursion here is genuine — this dispatches an agent, whose own reconciliation may
/// dispatch more — and the compiler cannot infer the `Send`-ness of a cycle. Naming it breaks the
/// cycle by *asserting* the bound the `tokio::spawn` inside needs.
///
/// Everything the dispatch names travels in a [`DetachedDispatch`] rather than as a parameter list:
/// the two callers pass seven values that are all "what this agent was dispatched for", and a
/// positional list of that length is one transposed `Option<String>` away from reviewing the wrong
/// issue.
///
/// A dispatch that fails before the agent exists is split by owner, like every other resolution of a
/// client: a refused credential costs this dispatch alone, and everything else is a configuration gg
/// validated and then could not stand up, which ends the run on the
/// [fault latch](latch_detached_dispatch). The `Err` says which, so the caller's own report of it
/// says which too.
fn run_detached_agent<'a>(
    orch: &'a Arc<Orchestrator>,
    dispatch: DetachedDispatch<'a>,
) -> Pin<Box<dyn Future<Output = Result<AgentReturn, String>> + Send + 'a>> {
    Box::pin(async move {
        let DetachedDispatch {
            agent_id,
            profile,
            brief,
            issue_id,
            worktree,
            ending,
            origin,
        } = dispatch;
        // A reviewer's name is checked against the run's declared profiles before the round starts
        // ([`reviewer_slots`]) and a merge agent's at launch, and launch validation accepts no
        // profile it cannot bind a model to. So a binding that fails here is gg reading one
        // configuration two different ways, exactly as it is on the two spawn paths, and it ends the
        // run rather than failing the issue alone: an issue whose review never ran and an issue
        // whose merge never ran both leave a tree that cannot be compared with a clean one.
        let binding = profile_binding(&orch.caps, profile).map_err(|err| {
            latch_detached_dispatch(orch, &agent_id, profile, issue_id.as_deref(), &err);
            format!("could not be dispatched: {err}; this is a gg defect, so the run ends with it")
        })?;
        // The dispatch already carries this agent's origin — a reviewer's issue/round/position, or
        // a merge agent's issue/ordinal — because it is the only thing that knows it. Both are
        // board state, which is what makes them re-derivable; neither agent has a parent to be
        // keyed by.
        //
        // The client is split the way every other resolution of one is: a refused credential is the
        // operator's to supply and costs this dispatch alone, while anything else is gg's and takes
        // the run with it.
        let client = orch
            .factory
            .client_for_agent(&binding, &AgentIdentity::agent(origin.clone()))
            .map_err(|err| {
                if err.is_auth_failure() {
                    return format!(
                        "could not be dispatched (model `{}`): {err}",
                        binding.model_id
                    );
                }
                latch_detached_dispatch(
                    orch,
                    &agent_id,
                    profile,
                    issue_id.as_deref(),
                    &format!("(model `{}`) {err}", binding.model_id),
                );
                format!(
                    "could not be dispatched (model `{}`): {err}; this is a gg defect, so the run \
                     ends with it",
                    binding.model_id
                )
            })?;
        let (result_tx, result_rx) = oneshot::channel();
        let agent = Agent {
            id: agent_id,
            parent_id: None,
            depth: 0,
            profile_id: profile.to_string(),
            fsm: None,
        };
        let role = AgentRole::Sub {
            brief,
            issue_id,
            worktree,
            ending,
            // A detached agent is nobody's subagent in the sense inheritance means: it is
            // dispatched by gg itself, not by an agent whose notebook it could reasonably continue,
            // and nobody forked it.
            inherited: InheritedModules::default(),
            seed: None,
            // A detached agent's spawner is gg itself, which is waiting on the result channel below
            // rather than on a [`ParentWait`] — so the wait condition is its own and nothing but its
            // own slot release ever depends on it. Held all the same, because what the
            // [teardown](AgentTeardown) does is not conditional on who is listening.
            link: Some(SpawnerLink {
                parent_wait: Arc::new(ParentWait::new()),
                result: result_tx,
                finished: Arc::new(AtomicBool::new(false)),
            }),
        };
        let (_inbox_tx, inbox_rx) = mpsc::unbounded_channel();
        let orch_for_task = Arc::clone(orch);
        let (task_id, task_slot) = (agent.id.clone(), agent.profile_id.clone());
        let task = AgentTask::spawned(&task_id, &task_slot, async move {
            run_agent(orch_for_task, agent, role, client, inbox_rx, origin).await;
        });
        orch.tasks.lock().expect("subagent tasks lock").push(task);
        // A dispatch that produced no result is a panicked agent — its teardown drops the sender
        // rather than synthesizing a return — which has already latched the run's fault. The caller
        // still fails its issue or its review round with this, which stays correct: the run is
        // ending, and an issue nobody reviewed is not an issue that was approved.
        result_rx
            .await
            .map_err(|_| "produced no result".to_string())
    })
}

/// Record on the run's [fault latch](crate::fault) that gg could not stand up a
/// [detached agent](run_detached_agent) — a reviewer or a merge agent — that the board was waiting
/// on.
///
/// Reported as a **dispatch** fault when the agent was dispatched for an issue, because the issue is
/// what an operator will be looking at and no agent ran; as an agent fault otherwise, so a dispatch
/// with no issue behind it still names something. The consequence is the same either way, and it is
/// the run: the tree is missing the review or the merge, and nothing downstream can tell that tree
/// from one where the work was done.
fn latch_detached_dispatch(
    orch: &Orchestrator,
    agent_id: &str,
    profile: &str,
    issue_id: Option<&str>,
    detail: &(impl std::fmt::Display + ?Sized),
) {
    match issue_id {
        Some(issue_id) => orch.fault.in_dispatch(issue_id, Some(profile), detail),
        None => orch.fault.in_agent(agent_id, profile, detail),
    }
}

/// What a [detached agent](run_detached_agent) is dispatched as, and for.
struct DetachedDispatch<'a> {
    /// The id to run under, supplied rather than minted because the two callers name their agents
    /// differently: a reviewer after the issue and the attempt it reviews (`AUTH-1.0i.0r`), a merge
    /// agent as an ordinary `agent-N` off the run's counter.
    agent_id: String,
    /// The [profile](GgAgentConfig) it runs on, which resolves its model, capabilities and prompt.
    profile: &'a str,
    /// The brief it is given as its opening instruction.
    brief: String,
    /// The board [issue](crate::board) it was dispatched for, when there is one.
    issue_id: Option<String>,
    /// The [worktree](Worktree) it works in — a reviewer gets the issue's; a merge agent gets none,
    /// because the conflicted merge it is resolving lives in the main tree.
    worktree: Option<Worktree>,
    /// Which ending vocabulary it declares its result in.
    ending: EndingRole,
    /// How it came to exist, for the [replay](crate::capture) provenance table. Carried here rather
    /// than derived inside, because *why* an orchestrator dispatched an agent is knowledge only the
    /// dispatching site has: a reviewer and a merge agent arrive through this one function.
    origin: GgSessionAgentOrigin,
}

/// What an [issue review](run_issue_review) tells its reviewers about the work: **where** it is and
/// **what it touched**, rather than the work itself.
struct ReviewChanges<'a> {
    /// The per-file summary of the change ([`git diff --stat`](git::diff_stat_since)) — the map of
    /// what to look at. Empty when nothing changed against the baseline (or no baseline exists).
    summary: &'a str,
    /// The commit the work branched from, when there is one: what a reviewer with a shell diffs
    /// against to see the change itself.
    baseline: Option<&'a str>,
}

/// The reviewer's brief for an [issue review](run_issue_review): the issue's own brief (its title,
/// scope, and completion criteria), any earlier verdicts, and **what the work touched**. A change set
/// with no files in it is stated plainly so the reviewer does not hallucinate changes.
///
/// The prose is [`review-brief.hbs`](crate::prompts); this assembles its
/// [context](ReviewBriefContext). The brief carries the change *summary*, not the change: a reviewer
/// is dispatched into the issue's own worktree — its filesystem tools and its shell are rooted there
/// — so it can read exactly the files it cares about at exactly the depth it needs. Pasting the whole
/// patch in instead made every review prompt carry every generated file the work touched (a
/// regenerated lockfile alone can dwarf the code under review), spending the reviewer's window on
/// text it did not ask for and burying the change that mattered.
///
/// It teaches **no ending**. The reviewer's verdict calls are its role's, named once in its system
/// prompt; a brief that restated them would be a second authority on the contract, and a
/// mode-dependent restatement would send a code-mode reviewer looking for a final message its
/// protocol does not have.
fn build_review_brief(
    issue_brief: &str,
    changes: ReviewChanges<'_>,
    history: Vec<ReviewRecordView>,
) -> String {
    prompts::render_review_brief(&ReviewBriefContext {
        issue_brief: issue_brief.to_string(),
        history,
        changes: ReviewChangesView {
            summary: (!changes.summary.trim().is_empty())
                .then(|| changes.summary.trim_end().to_string()),
            baseline: changes.baseline.map(str::to_string),
        },
    })
}

/// The brief an issue's assigned agent is re-invoked with after a review requested changes: the
/// original issue brief plus the reviewer's actionable items. The `## Requested changes` heading is a
/// stable marker (a worker can detect it is on a fix pass).
///
/// `code` swaps the ending clause for the same reason [`build_review_brief`] does: "then stop" is
/// not a thing a [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) agent can do.
fn build_fix_brief(issue_brief: &str, items: &[String]) -> String {
    prompts::render_fix_brief(&FixBriefContext {
        issue_brief: issue_brief.to_string(),
        items: numbered(items),
    })
}

/// Number `items` from one, for the prompt templates that render an ordered list (Handlebars'
/// `@index` counts from zero and a prompt counts from one).
fn numbered(items: &[String]) -> Vec<NumberedItem> {
    items
        .iter()
        .enumerate()
        .map(|(index, text)| NumberedItem {
            number: index + 1,
            text: text.clone(),
        })
        .collect()
}

/// The [merge agent](Orchestrator::merge_agent)'s brief: which issue's branch conflicts, what git
/// said, and what finishing the merge means.
///
/// It is deliberately concrete about the end state — a committed merge, no conflict markers left —
/// because that is what gg [checks](resolve_merge_conflict) afterwards, and an agent that thinks
/// "resolved" means "edited the files" would leave the workspace mid-merge.
fn build_merge_brief(branch: &str, reason: &str) -> String {
    prompts::render_merge_brief(&MergeBriefContext {
        branch: branch.to_string(),
        reason: reason.to_string(),
    })
}

/// An [`IssueReview`](GgTelemetryKind::IssueReview) telemetry event for one lifecycle transition. The
/// issue under review rides on the emitter's [issue scope](Emitter::with_issue), not the payload.
///
/// `reviewer` is the one that ended a round by asking for changes, and `approvals` the ones that
/// approved during it — so the console can say *who* said what rather than only that a review
/// happened.
fn issue_review_event(
    phase: GgIssueReviewPhase,
    items: Option<Vec<String>>,
    reviewer: Option<GgReviewer>,
    approvals: Vec<GgReviewer>,
    baseline: Option<String>,
) -> GgTelemetryKind {
    GgTelemetryKind::IssueReview {
        phase,
        items,
        reviewer,
        // A round nobody has approved in carries no list, rather than an empty one — the same
        // absent-means-nothing-to-say the items field uses.
        approvals: (!approvals.is_empty()).then_some(approvals),
        baseline,
    }
}

/// Read an intercepted **ending call**'s arguments into the [`Ending`] it declares.
///
/// It is the tool-calling counterpart of the [sandbox membrane](crate::sandbox)'s session host, and
/// it deliberately goes through the very same [`Ending`] constructors: an empty change list is
/// refused in one sentence, written once, whichever execution mode the reviewer that produced it was
/// running in. Nothing here re-reads prose — the arguments *are* the verdict.
///
/// The call names handed to those constructors are gg's **bare tool names**, because on this path
/// that is what the model wrote and what it would write again. The membrane's copy of this passes
/// its program language's spellings instead.
fn parse_ending_call(name: &str, args: &Value, _role: EndingRole) -> Result<Ending, String> {
    match name {
        completion::APPROVE_TOOL => Ok(Ending::Approved),
        completion::REQUEST_CHANGES_TOOL => Ending::changes_requested(
            parse_string_array(args, "items"),
            completion::REQUEST_CHANGES_TOOL,
            completion::APPROVE_TOOL,
        ),
        // `finish`, and — defensively — anything else the role claimed to own.
        _ => Ending::finished(
            args.get("summary")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            completion::FINISH_TOOL,
        ),
    }
}

/// Parse an optional string array (`approaches`/`slots`) from a tool's args into a positional list —
/// each entry trimmed, a non-string entry rendered as empty so the list stays index-aligned with the
/// attempts. A missing or non-array value yields an empty list.
fn parse_string_array(args: &Value, key: &str) -> Vec<String> {
    match args.get(key) {
        Some(Value::Array(items)) => items
            .iter()
            .map(|value| value.as_str().unwrap_or_default().trim().to_string())
            .collect(),
        _ => Vec::new(),
    }
}

/// How a driven turn loop ended, plus the usage it accumulated.
struct LoopEnd {
    /// The terminal [`SessionEnded`](GgTelemetryKind::SessionEnded) status — the one this agent
    /// **really** ends on, which is not always the one the ending path had in view. A
    /// [`TerminalStatus`] rather than a bare status word because every ending of an agent is read
    /// against the run's [fault latch](crate::fault) on its way here: see [`attribution`] for why a
    /// run gg broke cannot have an agent in it whose ending blames somebody else.
    status: TerminalStatus,
    /// Turns actually executed (model calls made).
    turns: usize,
    /// Running total of token usage across the session.
    tokens: TokenCounts,
    /// Running total of cost across the session, when any turn reported one.
    cost: Option<Cost>,
    /// The [profile](GgAgentConfig::id) the agent ran under, so the orchestrator can attribute
    /// this usage/cost to the right profile in the [per-profile accounting](SlotAccounting).
    profile_id: String,
    /// The agent's **final word** — its [return value](AgentReturn) to its spawner and the run's
    /// last text.
    ///
    /// For an agent that ended cleanly it is its [`ending`](Self::ending)'s
    /// [text](Ending::final_text); for one a ceiling stopped it is a [status line](stopped_text) gg
    /// wrote itself. It is never the last assistant message: in code mode every assistant message is
    /// a page of program source, so a spawner and a run record would each be handed a program where
    /// an answer belongs.
    final_text: Option<String>,
    /// What the agent **declared**, when it ended by declaring something.
    ///
    /// This — not [`final_text`](Self::final_text) — is what a reviewer's verdict and a judge's pick
    /// are read from. They are structured because they were structured when the model produced them:
    /// nothing between the ending call and here turns a verdict into prose and back.
    ending: Option<Ending>,
    /// The [execution ceiling](RunLimits) that stopped this agent, when one did.
    ///
    /// Present for all five ceilings, including the two whose terminal statuses predate this
    /// vocabulary (`exhausted`, `timed_out`) — so "which ceiling stopped it, at what value?" is one
    /// question with one answer rather than three parallel ways of inferring it from a status. The
    /// **root's** breach is what a run records as its own; a subagent's is its alone.
    limit: Option<GgLimitBreach>,
    /// The [succession](Handoff) this incarnation declared, when it ended by handing off rather
    /// than by finishing or being stopped.
    ///
    /// `Some` means this is **not** the agent's final end: [`run_agent`] folds the incarnation's
    /// usage, builds the successor, and drives it on the same slot, so the values above describe
    /// one incarnation while the run's own outcome is whichever incarnation finally returns `None`.
    handoff: Option<Handoff>,
}

impl LoopEnd {
    /// A human-readable one-line summary of the session for a closing `Log` event.
    /// (Emitted as a log, not a second [`Usage`](GgTelemetryKind::Usage): per-turn
    /// `Usage` events are incremental deltas that consumers sum, so a total `Usage`
    /// would double-count.)
    ///
    /// The `status` is passed in rather than read off `self` because this is the **session's**
    /// sentence built from the **root's** figures, and the two can disagree: a gg defect anywhere
    /// in the tree ends the run under [`STATUS_INTERNAL_ERROR`] however the root's own loop ended
    /// (see [`crate::fault`]). A line that named the root's status here would be the one place a
    /// reader is told the session ended `completed` when it did not.
    fn summary(&self, status: &str) -> String {
        let tokens = self
            .tokens
            .total()
            .map(|n| n.to_string())
            .unwrap_or_else(|| "unknown".to_string());
        let cost = match self.cost.and_then(|c| c.comparable) {
            Some(cost) => format!(", ${cost:.4} cost"),
            None => String::new(),
        };
        format!(
            "session ended ({status}) after {} turn(s); {tokens} total tokens{cost}.",
            self.turns
        )
    }
}

impl Agent {
    /// Drive this agent's turn loop to completion, returning how it ended and the usage it
    /// accrued (tagged with the agent's [`profile`](Self::profile_id) for the
    /// [per-slot accounting](SlotAccounting)).
    ///
    /// Each turn the offered [`registry`](ToolRegistry) definitions are handed to the
    /// model; any tool calls the turn returns are dispatched against `context` and their
    /// results fed back on the next turn, until the model stops calling tools, a bound is
    /// hit, or a turn errors. Under [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) the model is
    /// offered no tool definitions at all and each turn is a [program](run_code_turn) instead; the
    /// two modes share this one loop, and every ceiling, every gate and every piece of telemetry
    /// below is deliberately written once for both.
    ///
    /// `limits` carries every [ceiling](RunLimits) the agent is bounded by — the turn count, the
    /// run's wall-clock deadline, the two error ceilings, and the run-wide spend the cost ceiling is
    /// measured against. Each is checked at a turn boundary, never mid-turn: a turn is the loop's
    /// atomic unit, and interrupting one would leave a half-applied tool batch behind and, on an
    /// OpenAI-shaped provider, an assistant `tool_calls` message with no `tool` message answering
    /// it.
    ///
    /// The agent's resources are passed in rather than owned by the struct: the `registry`,
    /// the capability [modules](crate::modules) it holds, the
    /// [`context_setup`](ContextSetup), and the `client` are all constructed per agent by the
    /// orchestrator ([`run_agent`] for every agent). When the [subagents](CAPABILITY_SUBAGENTS)
    /// capability is on, `subagents` carries this agent's [delegation context](SubagentContext):
    /// the loop drains the agent's inbox each turn (injecting any parent messages) and, when the
    /// model calls a [subagent tool](is_subagent_tool), performs the spawn/wait/message against the
    /// [orchestrator](Orchestrator) and [scheduler](Scheduler) instead of ordinary dispatch. A
    /// spawn constructs a child [`Agent`] at `self.depth + 1` (refused past the
    /// [max depth](SubagentConfig::max_depth)) and drives it on its own slot the same way this
    /// agent is driven. `subagents` is `None` for a single-agent run (the tools are then never
    /// offered).
    #[allow(clippy::too_many_arguments)]
    async fn drive(
        &self,
        client: &dyn ModelClient,
        prompt: &str,
        registry: &ToolRegistry,
        tool_ctx: &ToolContext,
        emitter: &Emitter,
        modules: &mut ModuleSet,
        setup: DriveSetup,
        provided_files: &[PathBuf],
        profile: &GgAgentConfig,
        set: &GgCapabilitySet,
        subagents: &mut Option<SubagentContext>,
        project: Option<ProjectContext>,
    ) -> LoopEnd {
        let DriveSetup {
            limits,
            compaction,
            amc,
            autoload,
            persistence,
            read_policy,
            shell_offload,
            code,
            discovery,
            hooks,
            ending_role,
            opening,
            carried_programs,
            turn_base,
            replay,
        } = setup;
        // The window and the capability modules, borrowed apart for the whole session: the loop
        // pushes into the one and refreshes the others' pinned blocks into it at each boundary, and
        // the borrow checker will only prove those two things disjoint through the set's own split.
        let (history, caps) = modules.split_mut();
        // This window's own [module id](crate::modules::Module::instance_id), read before the
        // window itself is borrowed for the whole session. A `fork` copies the window and has to
        // report which one it copied, and by then the module around it is unreachable — the loop
        // holds the bare `ContextModel`, and on the responses-as-code path the window has been
        // moved out of its module altogether for the duration of a program.
        let history_id = history.instance_id().to_string();
        let context = history.context_mut();
        // The per-agent turn ceiling, or `None` for unbounded (the default — the host caps the
        // wall-clock, so gg imposes no turn backstop unless a study asks for one). An unbounded run
        // iterates to `usize::MAX`, a bound no real run reaches, so it stops only on `finish`, an
        // error/cost ceiling, or the deadline — never by falling through the loop.
        let max_turns = limits.limits.max_turns;
        let turn_bound = max_turns.unwrap_or(usize::MAX);
        // The full offered toolset — every turn offers all of it, so the tool schemas are a stable
        // prefix a provider can cache.
        let all_tools = registry.definitions();
        // The per-agent documentation carve-out, behind `docs.search` and `view.openDocsView()`. Built from
        // the same scope-bound tool set the program's objects are, and always present (docs are not a
        // capability), so a code turn can always answer a lookup. Unused on the tool-calling path.
        // This agent's [program library](crate::programs): the source of every program it runs, and
        // the `programs` object its programs reach it through. Built here, beside the docs runtime,
        // because both are per-agent-instance state that only a code turn touches — and because the
        // three things that must agree about whether the library exists (the object bound into a
        // program's scope, the functions a doc lookup will describe, and the section the system
        // prompt renders) all read this one value.
        let mut programs = crate::programs::resolve_program_library(
            profile,
            &mut crate::validate::LaunchReport::Discarding,
        );
        // What a succession moved here, or a fork cloned: adopted under **this** profile's
        // retention and id length, and adopted into nothing when this profile keeps no library.
        if let Some(carried) = carried_programs {
            programs.adopt(carried);
        }
        // **What this agent was granted on the API surface**, resolved once for the whole session
        // and handed to every reader of it: the documentation runtime below, the prompt's API
        // section, and the per-turn code scope the membrane builds its own grant from. Three
        // resolutions of one profile is two too many — that is exactly how the readers once came to
        // disagree about a capability.
        //
        // It is resolved against this **instance** and not against the profile alone: the same
        // allowlist buys different calls depending on what the run built for this agent — which
        // memory strategy its store was opened under, whether it holds a board, whether it stands
        // somewhere in a machine — and those facts live in the modules and the position, not in the
        // configuration document.
        //
        // There is no unresolvable half to worry about here: an allowlist entry gg cannot read
        // refused this launch before the first turn (see `check_allowlists`).
        let granted_capabilities = enabled_capabilities(profile);
        let spawnable = set.roster(profile, GgSubagentScope::Subagent);
        let implementers = set.roster(profile, GgSubagentScope::Implementer);
        let reviewers = set.roster(profile, GgSubagentScope::Reviewer);
        let (granted_operations, _) = crate::sandbox::granted_operations(
            profile,
            caps,
            &AgentFacts {
                fsm: self.fsm.as_ref(),
                spawnable: &spawnable,
                implementers: &implementers,
                reviewers: &reviewers,
            },
        );
        // The code this agent has loaded by using a code skill or memory, and the on-use scripts a
        // use owes. Per agent instance and per session, beside the docs runtime and the program
        // library for the same reason: only a code turn touches it, it costs no context, and a
        // compaction has nothing to do with it.
        //
        // Built **before** the documentation runtime because it owns the other half of that runtime's
        // answer: a used module and its declarations join this agent's documentation surface, and the
        // runtime reads them through a handle to this registry rather than through a copy of it.
        // The ground every program this agent compiles stands on: one private tree, created when
        // this agent starts and removed when it ends. `drive` holds a handle of its own for the
        // whole session so the tree's life is exactly the agent's, whatever happens to the registry
        // the turn path moves in and out of the loop's api.
        let compile_workspace = crate::sandbox::AgentWorkspace::new();
        #[cfg(test)]
        record_compile_workspace(&compile_workspace);
        let mut knowledge = crate::knowledge::KnowledgeModules::new(compile_workspace.clone());
        let mut docs = crate::docs::DocsRuntime::new(
            granted_capabilities.clone(),
            ending_role,
            &granted_operations,
            code.language,
        )
        .reading(knowledge.documentation());
        // This agent's own rules on filing a board issue — who it may assign one to, and whether
        // reviewers are demanded. The native `create_issue` tool carries these already (the registry
        // built it from the same profile); a code turn rebuilds the tool per call, so it needs them
        // too.
        let issue_policy = IssuePolicy::resolve(
            profile,
            implementers,
            reviewers,
            &mut crate::validate::LaunchReport::Discarding,
        );
        // Build the source-tagged context model in place of a flat transcript, seeded with
        // the two pinned items every session opens with: the system prompt (which lists any
        // available skills' descriptions and explains the memory scratchpad and task list) and
        // the build prompt. Every later contribution (assistant turns, tool output, file views,
        // read skills, the memory block, the task list) is appended as a tagged item, so the
        // window can be accounted by source and the pinned/ephemeral split is available for
        // Phase 2 compaction.
        // Arm the per-result turn headers when this agent can actually archive turns. They are what
        // makes `archive_thread` a decision the model can make — it reads the turn number and the
        // cost off each result and names the spans worth dropping — so they are armed by the tool
        // being present rather than by the capability being on in the abstract.
        if amc.can_archive {
            context.enable_turn_headers();
        }
        let system = system_prompt(PromptInputs {
            registry,
            set,
            skills: caps.skills(),
            memories: caps.memories(),
            tasks: caps.tasks(),
            read_policy,
            vision: &tool_ctx.vision,
            program_language: code.enabled.then_some(code.language),
            granted_capabilities: &granted_capabilities,
            granted_operations: &granted_operations,
            program_library: programs.is_enabled(),
            // Whether this agent's opening context is pre-seeded with the test case's specs and
            // reference images, so the prompt can tell the model they are already loaded (and,
            // when locked, that they stay) rather than leaving it to infer why they are there.
            autoload_specs: autoload.enabled.then_some(autoload.locked),
            // Whether this agent is a persistent one, so the prompt can explain the file views it is
            // opening on and that only one of it runs at a time — a model that finds reads in its
            // window it never made would otherwise have to guess where they came from.
            persistence: persistence.enabled(),
            profile,
            ending_role,
            assigned_issue: project
                .as_ref()
                .and_then(|project| project.assigned_issue.as_deref()),
        });
        // The prompt an agent reasons under **is** the experiment, so there is no second prompt to
        // fall back to: gg used to swap its own built-in template in for an override that would not
        // render, silently, and a run conducted under gg's prompt while its record names the
        // operator's answers a question nobody asked.
        let system = match system {
            Ok(system) => system,
            Err(detail) => return setup_broke(self, emitter, &limits, turn_base, detail),
        };
        // This agent's own system prompt, set unconditionally — on a fresh window and on one it
        // inherited alike. It is not a thread item: it sits in a slot of its own that renders first
        // on every request (see `ContextModel::set_system`), and a window arrives from a succession
        // or a fork with that slot *empty*, because the prompt states the toolset, the roster and
        // the ending calls of the agent it was rendered for and none of those survive the handoff.
        // So there is nothing here to detect and nothing to undo: whatever this instance inherited,
        // the prompt it reasons under is its own.
        context.set_system(system);

        // How the rest of the window opens. A **fresh** one is seeded the way every agent's has
        // always been: the build prompt, then whatever the capabilities pre-load into it. A
        // **carried** one already holds a thread, so the seeding steps below are skipped — they
        // exist to fill an empty window, and this one is not.
        let carried = match &opening {
            Opening::Fresh => {
                context.push_user_prompt(prompt);
                false
            }
            // A succession whose transfer list did **not** name `history` — the deliberate hard
            // reset an FSM edge declares by carrying nothing. Its window is empty, so there is
            // nothing for the seeding steps to duplicate: it is opened exactly as a fresh agent's
            // is, and the handoff note is appended at the tail below on top of it. Without this the
            // successor would hold a system prompt and a handoff note and no statement of the task
            // at all — every other agent's brief lives in the build prompt, and a reset must not be
            // the one way of losing it.
            Opening::Carried { history: false, .. } => {
                context.push_user_prompt(prompt);
                false
            }
            // A carried thread keeps its predecessor's build prompt: the successor is continuing
            // the same task, and the handoff note at the tail says what changed.
            Opening::Carried { .. } => true,
        };

        // A carried window arrives holding its predecessor's documentation band, and this instance
        // is not its predecessor. Every page in it is re-derived from its key against *this* agent's
        // surface, and what will not render goes — most of all a page describing a
        // [code module](crate::knowledge) the predecessor loaded, since nothing transfers loaded
        // code and a copy that kept those pages would be describing calls it cannot write until it
        // uses the skill again. See `transitions::drop_unrenderable_docviews`.
        if carried {
            let dropped = transitions::drop_unrenderable_docviews(context, &docs);
            if dropped > 0 {
                emitter.emit(log(
                    "debug",
                    format!(
                        "dropped {dropped} documentation view(s) this instance cannot render from \
                         the window it inherited"
                    ),
                ));
            }
        }

        // The bootstrap turn: on a code agent's fresh window, a program gg writes in this agent's
        // language and **runs** — listing the modules and opening the documentation of the
        // functions the profile's own `openingTurn` names, of those this agent holds — and the
        // views its own calls placed. First of every seeding step, because the prompt names no
        // function and this is the only thing that hands the model its way in; see
        // `crate::bootstrap` for why it is a program that runs, how the two lists are resolved, and
        // why a failure of it is gg's rather than the model's. An entry the agent does not hold is
        // dropped with a `warn` line each; two lists that come out empty seed nothing, on purpose.
        if !carried {
            match crate::bootstrap::seed_bootstrap(
                context,
                &mut docs,
                &mut programs,
                crate::bootstrap::BootstrapAgent {
                    opening_turn: &profile.opening_turn,
                    capabilities: &granted_capabilities,
                    operations: &granted_operations,
                    role: ending_role,
                    limits: code.limits,
                    doc_view_types: code.doc_view_types,
                },
            )
            .await
            {
                Ok(bootstrap) => {
                    for dropped in bootstrap.dropped() {
                        emitter.emit(log("warn", dropped.to_string()));
                    }
                    match bootstrap {
                        crate::bootstrap::Bootstrap::Seeded { placed, .. } => {
                            emitter.emit(log(
                                "debug",
                                format!("opened {placed} view(s) on the opening turn"),
                            ));
                        }
                        crate::bootstrap::Bootstrap::Empty { .. } => {
                            emitter.emit(log(
                                "debug",
                                "this agent's opening turn is configured empty, so no opening \
                                 program was seeded",
                            ));
                        }
                        crate::bootstrap::Bootstrap::NotCodeMode => {}
                    }
                }
                // gg wrote the program, granted the scope it ran under and implements every call in
                // it, so nothing here is the model's to recover from: the run ends as an internal
                // error rather than opening a model on a window that never got its surface.
                Err(detail) => return setup_broke(self, emitter, &limits, turn_base, detail),
            }
        }

        // The two **opening** hooks, in the order a run happens: the session's, once ever and
        // before anything else, then this agent's. Both may insert into the window they are firing
        // into, which is the whole reason they fire *here* — after the build prompt is seeded and
        // before the first turn, so what they add is part of the opening context rather than an
        // interruption of it. A carried window is deliberately not re-seeded with either: a
        // successor is the same agent continuing, and "the session started" is not news to it.
        //
        // A hook failure here stops the run before a single turn is taken, which is the cheapest
        // moment to discover that a gate is broken.
        if !carried {
            let mut opening_notes = Vec::new();
            // The session's own event, so: the run's root, on its first incarnation. An `exec`'d
            // successor of the root is the same session continuing and does not fire it again.
            let opens_session =
                matches!(hooks.agent.kind, Some(GgHookAgentKind::Root)) && turn_base == 0;
            if opens_session && hooks.session.has(GgHookEvent::SessionStart) {
                match hooks
                    .session
                    .fire(
                        GgHookEvent::SessionStart,
                        &hooks.agent,
                        json!({}),
                        tool_ctx,
                        &shell_offload,
                        emitter,
                    )
                    .await
                {
                    Ok(run) => opening_notes.extend(run.insertion()),
                    Err(failure) => {
                        return hook_failed(self, emitter, &limits, failure, turn_base);
                    }
                }
            }
            if hooks.runtime.has(GgHookEvent::AgentStart) {
                match hooks
                    .runtime
                    .fire(
                        GgHookEvent::AgentStart,
                        &hooks.agent,
                        json!({}),
                        tool_ctx,
                        &shell_offload,
                        emitter,
                    )
                    .await
                {
                    Ok(run) => opening_notes.extend(run.insertion()),
                    Err(failure) => {
                        return hook_failed(self, emitter, &limits, failure, turn_base);
                    }
                }
            }
            for note in opening_notes {
                context.push(
                    GgContextSource::System,
                    Retention::Ephemeral,
                    Message::user(note),
                );
            }
        }

        // Autoload the specifications: when this agent's profile enables the capability, seed the
        // test case's provided files (its specs and reference images) into the opening context as
        // though the model had already `read_file`d each — before the first turn, so the model
        // starts with the whole brief in the window. Locked pins them across compaction.
        if autoload.enabled
            && !carried
            && let Err(detail) = autoload_specifications(
                context,
                &mut programs,
                provided_files,
                tool_ctx,
                code.language,
                autoload.locked,
                autoload.images,
            )
            .await
        {
            return setup_broke(self, emitter, &limits, turn_base, detail);
        }

        // Re-open the views this agent's profile had open when one of its instances last finished —
        // [agent persistence](crate::persistence). Deliberately here, as part of setting up the
        // first turn, rather than at spawn time: a persistent agent's instances are serialized, so
        // this one may have sat queued for a long while behind the instance ahead of it, and the
        // files are re-read as they stand *now* rather than as that instance last saw them.
        // After autoload, so a path the specs already seeded is not opened twice.
        //
        // Files first, then the text views the last instance composed — so the desk opens the way
        // it was assembled (workspace material, then the agent's own notes on it) and the text
        // views, which are the thing nothing else could reconstruct, sit closest to the tail.
        if persistence.enabled() && !carried {
            let desk = persistence.restored();
            let files = match crate::persistence::restore_file_views(
                context,
                &mut programs,
                &desk.files,
                read_policy,
                tool_ctx,
                code.language,
                emitter,
            )
            .await
            {
                Ok(files) => files,
                // The program library could not mint an id for a restored view's synthesized
                // submission — gg's own defect, fatal the way a host fault is.
                Err(detail) => return setup_broke(self, emitter, &limits, turn_base, detail),
            };
            let texts = crate::persistence::restore_text_views(context, &desk.texts);
            // Last, because documentation is the least of the three a model needs at the tail: the
            // material it was working *on* sits closest to where it resumes reading.
            let docviews = crate::persistence::restore_docviews(context, &desk.docviews, &docs);
            emitter.emit(log(
                "info",
                crate::persistence::restore_note(files, texts, docviews),
            ));
        }

        // Pin the blocks whose modules arrived holding something.
        //
        // The memory block is otherwise rebuilt only at a compaction boundary, because between
        // boundaries the model's own calls and their confirmations are what tell it what it holds
        // (see `MemoriesRuntime::context_block`). That reasoning covers a store this agent filled
        // itself — and covers nothing about a store it was *handed*. A holder that binds its
        // spawner's instance, the registry entry a `shared` profile shares, or a transferred module
        // opens on memories it never wrote a call for: without this its window would carry no trace
        // of them, while its system prompt told it they were shown to it in full. A block over an
        // empty store renders nothing, so this is a no-op for the ordinary case of an agent that
        // starts with nothing.
        refresh_boundary_blocks(context, caps);

        // The successor's opening note, appended at the **tail** of the transferred thread: what
        // arrived, what did not, and whatever its predecessor wanted it to know. Pushed after any
        // pinned blocks the modules brought with them, so it is the last thing
        // the model reads before its first turn — and ephemeral, because it is gg speaking about
        // the handoff rather than material the agent produced, and a later compaction has by then
        // folded everything it announced into the blocks that cross the boundary.
        if let Opening::Carried { note, .. } = &opening {
            context.push(
                GgContextSource::System,
                Retention::Ephemeral,
                Message::user(note.clone()),
            );
        }

        let mut total_tokens = TokenCounts::default();
        let mut total_cost: Option<Cost> = None;
        // The last natural-language assistant message. It is this agent's final text on the
        // tool-calling path; in code mode every assistant message is program source, so that path
        // never reads it — see [`LoopEnd::final_text`].
        let mut last_text: Option<String> = None;
        // What this agent's last code turn produced, in gg's own words — the one line a stopped
        // code-mode agent returns to its spawner in place of a page of program source. `None` until it
        // has taken a code turn, which is also the honest answer for an agent stopped before it
        // could take one.
        let mut last_report: Option<String> = None;
        // Compaction that is **in flight**: an [in-loop strategy](PendingCompaction) has asked the
        // agent to condense its own window, and the loop is waiting for the turn that does it.
        //
        // It is loop state rather than a local because a compaction of this shape spans a turn
        // boundary — gg asks on one turn and the model answers on the next — and while it is set
        // the loop is narrowed: the agent may do the one thing compaction asked for and nothing
        // else, since everything else adds to a window that is already full.
        let mut pending_compaction: Option<PendingCompaction> = None;
        // The compaction trigger's memory across this incarnation's turn boundaries: how many
        // compactions have fired since the window was last under the threshold. It is what makes a
        // backstop that is not working *visible* — a boundary that compacts and comes back over the
        // trigger has reclaimed nothing, and without a count the loop would ask for the same
        // compaction at every boundary until the run's ceilings stopped it.
        //
        // One per incarnation rather than per agent, because a [succession](transitions) is a
        // different window measured against a different setup: the compactions the previous
        // incarnation could not get relief from say nothing about the one that inherits the thread.
        let mut compaction_trigger = compaction::CompactionTrigger::default();
        // This agent's error accounting against the run's ceilings. One per agent, owned outright,
        // because "consecutive" and "the last N turns" are only definable within one agent's turn
        // sequence — see [`crate::limits`].
        let mut agent_limits = AgentLimits::new(limits.limits);
        // How to name a memory call to this agent: its strategy's tools, spelled for its execution
        // mode. Resolved once, because neither the strategy nor the mode changes within a run, and
        // both of the places that need it (a memory compaction's instruction, and the refusal that
        // answers anything else while one is pending) must name calls the agent actually has.
        // The [language](crate::sandbox::ProgramLanguage) this agent writes in, or `None` when it
        // calls tools — resolved once, because every sentence gg puts in front of this agent that
        // names one of its own calls has to spell it the way this agent writes it.
        let code_language: Option<&'static dyn crate::sandbox::ProgramLanguage> = code
            .enabled
            .then(|| crate::sandbox::language(code.language));
        let memory_calls = caps.memories().strategy().calls(code_language);

        // The turn numbers this incarnation uses. `turn_base` is what this agent has already spent
        // across its earlier incarnations, so a succession numbers its turns continuously (a
        // transferred thread's `Turn #37` still means turn 37 afterwards) and spends **one** turn
        // ceiling between them rather than one each. It is `0` for the overwhelming majority of
        // agents, which have exactly one incarnation.
        for turn in turn_base..turn_bound {
            // An operator killed the run. Read here, and acted on below the fault check, at the
            // same boundary as the two run-wide ceilings further down: a human's decision outranks
            // every *configured* one, and is enforced on the same terms, so a killed run winds down
            // exactly as cleanly as a run that spent its clock — this turn has not started, so
            // nothing is abandoned, and the epilogue still emits the session summary, the per-slot
            // rollups and the replay sidecar that are the whole reason a killed run is worth
            // keeping.
            let canceled = limits.cancel.is_canceled();
            // Replay capture: the probe and the clock read below are inputs in the strict sense —
            // both can end the session, and neither is derivable from anything else the record
            // holds. Recorded on **every** boundary rather than only when one fires, because "the
            // probe was read forty times and found nothing" is what makes the fortieth read's
            // `true` an input rather than an unexplained ending; a probe is two booleans on the
            // wire, so the cost of that honesty is nil.
            if let Some(recorder) = &replay {
                recorder.record_cancel_probe(&self.id, canceled);
                if let Some(clock) = limits.read_clock() {
                    recorder.record_clock(&self.id, clock.elapsed_ms, clock.remaining_ms);
                }
            }
            // gg broke — here or in some other agent of this run. Acted on **before** the
            // cancellation above it, and before every ceiling: the other conditions decide when a
            // run stops, while this one decides that the run is not a measurement at all, and a run
            // that stopped for two reasons has to be recorded under the one that disqualifies it.
            // (The two can only coincide by racing, and an operator killing a run gg had already
            // broken must not turn our defect into their decision.)
            //
            // Every agent reads the same latch, so a defect met by any one of them stops all of
            // them — see [`crate::fault`] for why a run gg broke in cannot be allowed to finish.
            if let Some(diagnostic) = limits.fault.raised() {
                return self.stop_on_fault(
                    emitter,
                    &limits,
                    diagnostic,
                    turn,
                    total_tokens,
                    total_cost,
                    code.enabled,
                    last_report.as_deref(),
                    last_text,
                );
            }
            if canceled {
                return self.stop_on_cancel(
                    emitter,
                    &limits,
                    turn,
                    total_tokens,
                    total_cost,
                    code.enabled,
                    last_report.as_deref(),
                    last_text,
                );
            }

            // Stop cleanly at a turn boundary once the run's wall-clock budget is spent. Nothing is
            // in flight here, so nothing is abandoned mid-turn.
            if let Some(breach) = limits.check_deadline(&self.id, agent_limits.turns_recorded()) {
                return self.stop_on_limit(
                    emitter,
                    &limits,
                    breach,
                    turn,
                    total_tokens,
                    total_cost,
                    code.enabled,
                    last_report.as_deref(),
                    last_text,
                );
            }

            // The run's cost ceiling, checked on exactly the same terms and at exactly the same
            // point as the deadline above — one rule, two run-wide ceilings. It bounds **starting
            // new work**: the turn that crossed the line has already completed and already been paid
            // for, which is why the breach records the spend already accumulated rather than the
            // threshold.
            if let Some(breach) = limits.check_cost(&self.id, agent_limits.turns_recorded()) {
                return self.stop_on_limit(
                    emitter,
                    &limits,
                    breach,
                    turn,
                    total_tokens,
                    total_cost,
                    code.enabled,
                    last_report.as_deref(),
                    last_text,
                );
            }

            // Open the turn on the context model, so everything pushed from here — this turn's
            // assistant message and every result answering it — is tagged with a turn number the
            // model can see on its results and name in an `archive_thread` call. One-based, so
            // "Turn #1" is the agent's first turn and turn 0 stays the un-numbered opening context.
            context.begin_turn(turn as u64 + 1);

            emitter.emit(GgTelemetryKind::TurnStarted {});

            // Where this turn's wall-clock goes, split into prompt assembly / model call /
            // response handling. Held for exactly the turn's scope so it reports on every path
            // the loop leaves by — including the abnormal ones, which are the turns worth
            // looking at. See [`TurnTimer`] for why it emits on drop.
            let mut turn_timer = TurnTimer::start(emitter);

            // Drain this agent's inbox at the turn boundary and inject any messages from its parent
            // as ephemeral user turns, so `send_message` is a live channel: the running child sees
            // the guidance on its very next turn. Drained here (before the pinned refreshes and the
            // model call) so an injected message never lands between an assistant tool-call message
            // and its results.
            if let Some(sub) = subagents.as_mut() {
                for message in sub.ctx.drain_inbox() {
                    context.push(
                        GgContextSource::UserPrompt,
                        Retention::Ephemeral,
                        Message::user(format!("[Message from your parent agent]: {message}")),
                    );
                }
            }

            // The pinned memory block is deliberately *not* refreshed here. A memory the model
            // just wrote is already in front of it — its own call, and the confirmation that
            // answered it — so rebuilding the block each turn re-sends the whole set (or the
            // whole index) to say something the thread already said. It is rebuilt at a
            // compaction boundary instead, which is the one place the thread stops carrying
            // that news; see `MemoriesRuntime::context_block`.

            // Refresh the pinned task list from the store, so the window always shows the
            // model's current plan (with what is ready vs blocked) and Phase 2 compaction
            // retains it. Rebuilt here, at the turn boundary, so it never lands between an
            // assistant tool-call message and the tool results answering it. Unlike memories,
            // the list is what the model steers by from turn to turn rather than a record it
            // consults, so it is worth keeping current every turn.
            for (source, block) in caps.pinned_blocks(Refresh::EveryTurn) {
                context.replace_source(source, Retention::Pinned, block);
            }

            // With the pinned blocks refreshed, the window for this turn is fully assembled.
            // If the compaction backstop is on and fullness has crossed its threshold, compact
            // now — at the turn boundary, before this turn's model call, never between an
            // assistant tool-call message and its results. Compaction summarizes the ephemeral
            // history and keeps the pinned prefix verbatim, so the breakdown emitted just below
            // reflects the reclaimed window.
            //
            // Which of the two shapes runs depends on the strategy. An **out-of-band** one is
            // performed here and now, invisibly to the agent, and this turn simply proceeds against
            // a smaller window. An **in-loop** one cannot be: the agent itself writes the summary,
            // so gg appends the instruction, records what it is waiting for, and the turn that
            // follows is the compaction.
            //
            // The boundary is judged by [`CompactionTrigger`] rather than by the window alone,
            // because the question here is not only "is it full?" but "did the last compaction
            // help?". A boundary that fires and comes back over the threshold has reclaimed
            // nothing, and the loop that simply asked again would ask at every boundary for the
            // rest of the run. The trigger counts those, retries while the capability's
            // `maxRetries` allows one, and ends the agent when it does not.
            //
            // The `loop` is what makes an out-of-band retry immediate: the strategy runs here and
            // now, so the window it produced can be judged here and now, and an agent whose
            // allowance is already spent is stopped without first spending a model turn on a window
            // it cannot work in. An in-loop strategy breaks out after arming its instruction — its
            // retry is the next boundary's, because only the agent's own next turn can supply the
            // summary. A compaction already pending is nobody's failure yet, so it is not judged at
            // all; that is also what stops a still-full window from opening a second compaction on
            // top of the one in flight.
            loop {
                let verdict = match pending_compaction {
                    Some(_) => CompactionVerdict::Idle,
                    None => compaction_trigger.judge(context, &compaction),
                };
                match verdict {
                    CompactionVerdict::Idle => break,
                    CompactionVerdict::Exhausted => {
                        return self.stop_on_stuck_compaction(
                            emitter,
                            &limits,
                            &compaction,
                            compaction_trigger.fired(),
                            turn,
                            total_tokens,
                            total_cost,
                            code.enabled,
                            last_report.as_deref(),
                            last_text,
                        );
                    }
                    CompactionVerdict::Compact => {}
                }
                if compaction_trigger.fired() > 1 {
                    emitter.emit(log(
                        "warn",
                        format!(
                            "the window is still at the compaction threshold after the last \
                             boundary; compacting again (attempt {} of {}).",
                            compaction_trigger.fired(),
                            compaction.policy.max_retries + 1
                        ),
                    ));
                }
                let retained = caps.retained_counts();
                match compaction.strategy.pending() {
                    None => {
                        if let Err(failure) = fire_pre_compact(
                            &hooks,
                            compaction.strategy.id(),
                            tool_ctx,
                            &shell_offload,
                            emitter,
                        )
                        .await
                        {
                            return hook_failed(self, emitter, &limits, failure, turn);
                        }
                        let (request, fallback) =
                            compaction::condense_out_of_band(context, client, &compaction).await;
                        let files = restore_compact_files(&request.files, tool_ctx, emitter).await;
                        // Read *before* the rewrite too, for the reason the files are: the keys are
                        // in the window `clear_ephemeral` is about to empty.
                        let docviews = compaction::restore_docviews(context, &docs);
                        // Current *before* the rewrite, so the stale copy goes out with the
                        // history and the fresh one crosses in the pinned prefix.
                        refresh_boundary_blocks(context, caps);
                        emitter.emit(compaction::apply_compaction(
                            context,
                            &compaction,
                            retained,
                            &request,
                            files,
                            docviews,
                            fallback,
                        ));
                        if let Err(failure) = fire_post_compact(
                            &hooks,
                            compaction.strategy.id(),
                            context,
                            tool_ctx,
                            &shell_offload,
                            emitter,
                        )
                        .await
                        {
                            return hook_failed(self, emitter, &limits, failure, turn);
                        }
                    }
                    Some(pending) => {
                        emitter.emit(log(
                            "info",
                            format!(
                                "the window reached the compaction threshold; asking the model to \
                                 compact it with the `{}` strategy.",
                                compaction.strategy.id()
                            ),
                        ));
                        // Pushed as process-level guidance: it is gg speaking about the run rather
                        // than material the agent produced, and it is ephemeral, so the compaction
                        // it opens is also what clears it.
                        context.push(
                            GgContextSource::System,
                            Retention::Ephemeral,
                            Message::user(pending.instruction(code_language, memory_calls.clone())),
                        );
                        pending_compaction = Some(pending);
                        break;
                    }
                }
            }

            // What the modules owe this agent's *stream* since it last looked. On an unshared run
            // this is always empty here — a module's deltas are drained the moment the call that
            // made them is recorded — and it matters only when a module is shared: a sibling's
            // write moves this agent's store, so this agent's panel is stale until it says so.
            // The drain is author-filtered, so the sibling's revision is not re-reported here; what
            // this emits is the snapshot the console renders.
            for event in caps.drain_events() {
                emitter.emit(event);
            }

            // The linked-memory notices: what *other* holders of a module this agent shares have
            // done since it was last told. Appended at the tail as ordinary ephemeral messages —
            // never folded into a pinned block, which is what keeps the cached prompt prefix
            // byte-identical on a turn where a sibling wrote and this agent did nothing.
            //
            // Pushed **after** the compaction step above rather than before it, so a boundary that
            // fires on this very turn cannot sweep news the model has not read yet. A *later*
            // boundary does sweep them, by which point they have been seen and what they announced
            // is in the rebuilt block the boundary carries across. Empty on every turn of a run
            // that shares nothing, which is every run that does not say otherwise.
            for notice in caps.notices() {
                context.push(GgContextSource::Memory, Retention::Ephemeral, notice);
            }

            // Agent-managed context: rebuild the context-usage signal from the now fully-assembled
            // (and possibly just-compacted) window, so the model acts this turn on figures that are
            // true this turn. It lives in a slot of its own that is overwritten rather than appended
            // to, so a run can never accumulate two of them — including across the compaction that
            // may have just happened a few lines above.
            if amc.enabled {
                context.refresh_context_usage_signal(amc.signal_options());
            }

            // The offered toolset for this turn. In responses-as-code mode the model is offered
            // exactly **one** native tool — `submit_program` — and the request requires a call to
            // it (forced tool choice); its working surface is typed API functions it calls from
            // inside the submitted program, which the prompt names the modules of and the membrane
            // gates. In the ordinary tool-calling mode the whole offered set goes out every turn:
            // the tool list is part of the prompt a provider caches, so a toolset that varied turn
            // to turn would rewrite the cached prefix.
            let submit_tool = code
                .enabled
                .then(|| completion::submit_program_tool(code.language));
            let tools: Vec<ToolDefinition> = if code.enabled {
                Vec::new()
            } else {
                let mut tools: Vec<ToolDefinition> = all_tools.clone();
                // This agent's ending calls, the one way it may end its session. They are not
                // registry tools — the loop intercepts them — so they are appended here rather than
                // contributed by a capability.
                tools.extend(completion::role_tool_definitions(ending_role));
                tools
            };

            // The context for this turn is fully assembled (every prior item is in the
            // model). Emit its per-source breakdown — context visibility is intrinsic, so this
            // is emitted every turn.
            emitter.emit(context.breakdown_event());

            // Time the model call so the turn's generation throughput (output tokens
            // per second) is derivable — the wall-clock latency the `prompt` event
            // carries as `duration_ms`. Includes any vision-recovery retry, which is the
            // latency the turn actually paid.
            let model_call_started = Instant::now();
            // The same boundary on the turn's phase accounting: everything before this was
            // assembling the request, everything after handling what it returned.
            turn_timer.model_call_started();
            // The model call, retried **within this turn** for the two failures the loop recovers
            // from rather than dying on:
            //
            // - a call that hit gg's [per-call ceiling](crate::client::MODEL_CALL_TIMEOUT) — a
            //   stalled provider;
            // - a reply that hit the **provider's output cap** (`finish_reason: length`), which is
            //   presumed a degenerate generation and rejected whole.
            //
            // Both are recorded as error turns first — they spend the consecutive-error count and
            // the error-rate window exactly as a failed model call does, which is what bounds a
            // model (or an endpoint) that keeps doing it — and then the same request is simply
            // asked again: nothing entered the context, so the retry is byte-identical and the
            // turn keeps its number. A rejected attempt is therefore absent from the run's turn
            // count and its usage absent from the run's tokens and cost (the `ResponseRejected`
            // event and the summary's rejected rollup carry the spend instead); only the error
            // ceilings — and the run-wide deadline and an operator's kill, both re-checked
            // between attempts because a retry chain can outlast a turn boundary — decide when to
            // stop asking.
            let response = loop {
                let attempt_started = Instant::now();
                let recoverable = match complete_with_vision_recovery(
                    client,
                    context,
                    &tools,
                    submit_tool.as_ref(),
                    &tool_ctx.vision.support,
                    emitter,
                )
                .await
                {
                    // A length-capped reply is rejected whole, before anything reads it: it never
                    // becomes the assistant turn, so the next attempt's context does not carry it.
                    // Recorded twice, deliberately — the `ResponseRejected` event (and its summary
                    // rollup) carries the spend the run's own metrics exclude, and the message log
                    // keeps the rejected exchange itself so a degenerate reply is inspectable
                    // rather than merely counted.
                    Ok(response) if response.finish_reason == FinishReason::Length => {
                        let size = ResponseSize::of(&response);
                        emitter.emit(GgTelemetryKind::ResponseRejected {
                            reason: finish_reason_token(&response.finish_reason),
                            chars: size.chars,
                            tokens: response.usage,
                            cost: response.cost,
                            provider: response.provider.clone(),
                        });
                        emitter.emit(log("error", length_capped_rejected(turn, size, &response)));
                        let request: Vec<PromptItem<'_>> = context.prompt_items().collect();
                        let reply = Message::assistant(response.text.clone(), Vec::new());
                        let reply_tokens = context.estimate(&reply);
                        emitter.log_prompt(
                            &request,
                            Some((&reply, reply_tokens)),
                            response.usage,
                            response.cost,
                            finish_reason_token(&response.finish_reason),
                            Some(attempt_started.elapsed().as_millis() as u64),
                            response.provider.clone(),
                        );
                        // What loop detection discarded on the way to this reply rides on the
                        // rejection's own error turn — the reply it preceded is not becoming one.
                        (TurnErrorType::ModelLengthCapped, response.loop_aborts)
                    }
                    Ok(response) => break response,
                    // A timed-out call: the client surfaced it without spending its own retry
                    // budget (each internal retry of a stall costs the full ceiling again), so the
                    // bounded retry is this one.
                    Err(err @ ModelError::Timeout { .. }) => {
                        emitter.emit(log("error", model_call_retried(turn, &err)));
                        (TurnErrorType::ModelTimeout, LoopAborts::none())
                    }
                    Err(err) => {
                        // Surface the failure loudly — a `Log(error)` and a failed
                        // session end — rather than discarding the run silently. A
                        // retry-exhausted transient failure and a fatal one both end the
                        // session here; the client has already exhausted its own retries, so
                        // there is nothing left to retry at the turn level in Phase 0.
                        //
                        // A [generation loop](crate::loopguard) that survived every attempt is one of
                        // those retry-exhausted failures and ends the session on exactly the same terms
                        // — but it is named separately, because "retries exhausted" would send an
                        // operator looking at the provider for an outage that never happened. What
                        // actually happened is that the model kept writing the same thing and gg kept
                        // throwing it away.
                        //
                        // The classification is made ONCE, as the value that is recorded, and the log
                        // line's phrase is read back off it, so no aggregate can disagree with what the
                        // line says.
                        let error_type = err.turn_error_type();
                        // Whose failure this ending is, decided before anything says so out loud —
                        // because both the record and the sentence below are rendered from this one
                        // value. A failed model call is the model's, or the operator's when it is the
                        // credential that was refused…
                        let status = TerminalStatus::attributed(
                            if err.is_auth_failure() {
                                // An auth failure is the run's credential being refused, not the model
                                // failing at its work, so it ends the session under its own status —
                                // which the session runner turns into a launch failure.
                                STATUS_AUTH_ERROR
                            } else {
                                STATUS_MODEL_ERROR
                            },
                            // …unless gg broke under this call, which the turn recorded below is
                            // attributed against too. Whose failure the far side of a request was is
                            // not answerable from the error alone once the run itself is broken, and an
                            // ending that answered it separately from the turn is how the two records of
                            // one event came to disagree.
                            &limits,
                        );
                        // Said to the operator as the *ending* was attributed, never as the error reads
                        // on its own: this path is the one place an agent stops for a gg defect without
                        // going through [`stop_on_fault`](Self::stop_on_fault), so a line rendered from
                        // the error alone left an operator reading this agent's stream with a provider
                        // failure and no hint that the run was already broken — the same disagreement
                        // between two accounts of one event, in the record a human actually reads.
                        emitter.emit(log(
                            "error",
                            model_call_failed(turn, status, error_type, &err),
                        ));
                        // The turn is recorded before the loop leaves, so the accounting never drifts
                        // from the number of model calls the run made — and it can never breach a
                        // ceiling, because the session is already ending on the next line. A model API
                        // failure stays fatal on its first occurrence: the client has already retried
                        // with backoff over every retryable class, so counting this one and looping
                        // again would be a second, undocumented retry layer with a worse backoff and no
                        // jitter.
                        //
                        // A loop that survived every attempt keeps the `ModelApi` **base kind** it
                        // arrives as (the contract has no separate kind for it, deliberately) and is
                        // published under its own type, `model_response_loop`; the replies it discarded
                        // on the way are carried on the event too, so the money spent on them is still
                        // counted — this is the one error path that can have any.
                        //
                        // It reads the run a **second** time, a few statements after the ending above
                        // read it. The two are deliberately not folded into one: folding them would mean
                        // this seam being *told* the answer rather than deriving it, which needs an
                        // "already attributed" carrier for outcomes exactly as [`TerminalStatus`] is one
                        // for statuses — and an entry point that accepted a pre-judged outcome would
                        // reopen the "somebody forgot" hole both types exist to close, at the eight
                        // other sites that have no ending beside them to borrow a judgement from.
                        // Deriving the outcome from `status` here would not help either, since this seam
                        // re-reads regardless, which is exactly what protects those eight.
                        //
                        // The window that leaves is empty today, and it is worth writing down rather
                        // than trusting. The latch never clears and the ending read first, so the only
                        // disagreement it could produce is a **stale ending** — `model_error` beside a
                        // turn recorded as gg's — which is the harmful direction and not a harmless one.
                        // What closes it is that there is no `.await` between the two reads and gg
                        // drives every agent on a single current-thread runtime: no other agent can run
                        // between these statements to raise the latch. It reopens the moment an await
                        // is introduced between them, or a fault is raised from a thread outside the
                        // runtime.
                        let _ = self.record_turn(
                            &mut agent_limits,
                            emitter,
                            &limits,
                            TurnOutcome::Error(error_type),
                            // A turn that never got a reply at all still says what it threw away
                            // trying: every attempt looped, so the error carries the whole tally.
                            match &err {
                                ModelError::ResponseLoop { discarded, .. } => *discarded,
                                _ => LoopAborts::none(),
                            },
                            ResponseSize::none(),
                        );
                        return LoopEnd {
                            status,
                            turns: turn + 1,
                            tokens: total_tokens,
                            cost: total_cost,
                            profile_id: self.profile_id.clone(),
                            final_text: ended_text(
                                code.enabled,
                                status,
                                last_report.as_deref(),
                                last_text,
                            ),
                            ending: None,
                            limit: None,
                            handoff: None,
                        };
                    }
                };

                // The shared recoverable tail: the attempt is an error turn — counted against the
                // ceilings on exactly the terms a failed model call is — and if no ceiling (nor
                // the run's clock, nor an operator) says stop, the same request goes out again.
                let (error_type, aborts) = recoverable;
                if let Some(breach) = self.record_turn(
                    &mut agent_limits,
                    emitter,
                    &limits,
                    TurnOutcome::Error(error_type),
                    aborts,
                    ResponseSize::none(),
                ) {
                    return self.stop_on_limit(
                        emitter,
                        &limits,
                        breach,
                        turn,
                        total_tokens,
                        total_cost,
                        code.enabled,
                        last_report.as_deref(),
                        last_text,
                    );
                }
                if limits.cancel.is_canceled() {
                    return self.stop_on_cancel(
                        emitter,
                        &limits,
                        turn,
                        total_tokens,
                        total_cost,
                        code.enabled,
                        last_report.as_deref(),
                        last_text,
                    );
                }
                if let Some(breach) = limits.check_deadline(&self.id, agent_limits.turns_recorded())
                {
                    return self.stop_on_limit(
                        emitter,
                        &limits,
                        breach,
                        turn,
                        total_tokens,
                        total_cost,
                        code.enabled,
                        last_report.as_deref(),
                        last_text,
                    );
                }
            };
            // Reaching here means the call returned a response (the error arm returns), so
            // this is its latency — the denominator for the turn's generation throughput.
            let model_call_ms = model_call_started.elapsed().as_millis() as u64;
            // Hand the phase accounting the same figure the `prompt` event carries, so the two
            // events never disagree about how long the model took.
            turn_timer.model_call_finished(model_call_ms);

            // What [loop detection](crate::loopguard) threw away before this reply arrived. Held
            // for the whole turn because it belongs on the turn's *outcome* event, which is
            // recorded at whichever of this loop's exits the turn eventually takes — and is empty
            // on a run that left the capability disarmed, which is the default.
            let loop_aborts = response.loop_aborts;
            // The reply's size — its raw text, exactly as sent — threaded to every
            // record_turn of this turn so the outcome event carries it; see [`ResponseSize`].
            let response_size = ResponseSize::of(&response);
            if loop_aborts.any() {
                // Said out loud, and said as a `warn`: every one of those replies was generated,
                // and generation is billed whether or not anybody reads it, yet none of them ever
                // reached the model's context. The size is named in words and characters because
                // those are the units gg measured; there is no token count and no price, because
                // the provider reports usage at the end of a stream this one deliberately never
                // read to its end. A run whose stream is full of these is a run whose model is
                // looping, which is the fact this capability exists to make visible rather than
                // merely to bound.
                emitter.emit(log(
                    "warn",
                    format!(
                        "loop detection discarded {} on turn {turn} before one completed, throwing \
                         away {} of generated output ({} characters); it was all paid for and none \
                         of it entered the context.",
                        plural(loop_aborts.attempts as usize, "looping model response"),
                        plural(loop_aborts.words as usize, "word"),
                        loop_aborts.chars,
                    ),
                ));
            }

            record_usage(&response, emitter, &self.profile_id, client.model_id());
            total_tokens = add_counts(total_tokens, response.usage);
            total_cost = add_cost(total_cost, response.cost);
            // The same figure, folded into the run-wide total every agent's cost ceiling reads. Fed
            // here rather than at the agent's end, because a subagent forty turns deep must
            // contribute to the run's spend while it is still running.
            limits.spend.add(response.cost);

            // The assistant turn is recorded exactly as the model sent it, in **both** modes: its
            // text (on a code turn, commentary — surfaced and recorded, never parsed for code) and
            // every tool call it made. On a code turn the program itself travels inside the
            // `submit_program` call's arguments, so the transcript the model re-reads carries its
            // own submissions in exactly the shape it must produce them.
            let assistant_text = response.text.clone();
            // The assistant-message event carries the model's own text, exactly as the context
            // records it.
            if let Some(text) = &assistant_text {
                emitter.emit(GgTelemetryKind::AssistantMessage { text: text.clone() });
                last_text = Some(text.clone());
            }

            // Log this turn's exact request and response to the message log — the
            // de-duplicated ContextMessage/Prompt stream the console renders as the
            // per-message Requests view. Emitted every turn (context visibility is
            // intrinsic). Captured here,
            // *before* the assistant reply is appended, so `prompt_items` is exactly the
            // window that was sent this turn (post vision-recovery, if any). The reply is
            // built the same way `push_assistant` will record it and pooled too, so it reappears
            // — id unchanged — as a request pointer on the next turn.
            let reply = Message::assistant(assistant_text.clone(), response.tool_calls.clone());
            let reply_tokens = context.estimate(&reply);
            let has_reply = reply.content.is_some() || !reply.tool_calls.is_empty();
            let request: Vec<PromptItem<'_>> = context.prompt_items().collect();
            emitter.log_prompt(
                &request,
                has_reply.then_some((&reply, reply_tokens)),
                response.usage,
                response.cost,
                finish_reason_token(&response.finish_reason),
                Some(model_call_ms),
                response.provider.clone(),
            );

            // Replay capture: pin the same window as this turn's *prompt frame*, carrying the four
            // typed fields the flat message array the client sent does not — each item's slot, its
            // retention, the turn it was pushed on, and a paged file view's region. This is the one
            // place the loop holds them, and they are recoverable from nowhere else afterward.
            //
            // Recorded here rather than inside `log_prompt` because the recorder does not thread
            // through the telemetry emitter — and here rather than at the model call, so the frame
            // lands *after* the `model_io` entry it describes. A vision-recovery retry therefore
            // records `model_error → model_io → prompt_frame` and the frame attaches to the call
            // that was actually sent.
            if let Some(recorder) = &replay {
                recorder.record_prompt_frame(&self.id, &request);
            }

            context.push_assistant(assistant_text, response.tool_calls.clone());

            // A pending **self-summarization** takes this turn whole, in either execution mode: the
            // reply *is* the summary, so no tool call is dispatched and no program is run. That is
            // the strategy's contract rather than a shortcut — the instruction told the model this
            // one turn is not a working turn, and dispatching whatever it sent anyway would make
            // gg's own instruction a lie.
            //
            // The compaction happens even when the reply is unusable. A triggered compaction has to
            // complete: the window is already full, so a run that declined to compact because the
            // model said nothing would simply overflow on its next turn. An empty reply therefore
            // degrades to gg's fixed note, recorded as a fallback so a study reads it as the
            // failure it is.
            if !code.enabled && pending_compaction == Some(PendingCompaction::Summary) {
                pending_compaction = None;
                let request = match response.text.as_deref().map(str::trim) {
                    Some(summary) if !summary.is_empty() => CompactionRequest {
                        summary: summary.to_string(),
                        files: Vec::new(),
                    },
                    _ => {
                        emitter.emit(log(
                            "warn",
                            "the model answered the compaction request with nothing usable; the \
                             thread is compacted from gg's fixed note instead.",
                        ));
                        compaction::fallback_request()
                    }
                };
                if let Err(failure) = apply_pending_compaction(
                    context,
                    &compaction,
                    caps,
                    &docs,
                    &request,
                    tool_ctx,
                    &hooks,
                    &shell_offload,
                    emitter,
                )
                .await
                {
                    return hook_failed(self, emitter, &limits, failure, turn + 1);
                }
                // The turn did exactly the work it was asked for, so it counts as progress — not as
                // an error, and not as the completion a tool-less reply would otherwise be.
                if let Some(breach) = self.record_turn(
                    &mut agent_limits,
                    emitter,
                    &limits,
                    TurnOutcome::Progressed,
                    loop_aborts,
                    response_size,
                ) {
                    return self.stop_on_limit(
                        emitter,
                        &limits,
                        breach,
                        turn + 1,
                        total_tokens,
                        total_cost,
                        code.enabled,
                        last_report.as_deref(),
                        last_text,
                    );
                }
                continue;
            }

            // Responses-as-code turn: the request required a `submit_program` call, and each such
            // call's `program` string is a program to run in the wasmtime sandbox — bridging every
            // typed call to the real toolset (and, for a delegation tool, the scheduler) — and act
            // on what the turn asks for. There is no implicit ending here: a session under this
            // capability ends only when a program calls `finish`, or when a ceiling stops the run.
            if code.enabled {
                // Answer every call the reply made, directly after the assistant message that made
                // them: a `tool` message per id is what keeps the transcript a conversation every
                // OpenAI-shaped provider accepts, and it must directly follow the calls — the
                // programs run *after* these are pushed, so everything a program produces (views,
                // errors, notices) lands beneath the acknowledgements rather than between two of
                // them. An acknowledgement therefore carries receipt, never outcome; a call that
                // carried no program is answered with why, and a call to a tool this mode does not
                // offer with the redirect.
                let turn_call_ids: Vec<String> = response
                    .tool_calls
                    .iter()
                    .map(|call| call.id.clone())
                    .collect();
                let mut submissions: Vec<code::SubmittedProgram> = Vec::new();
                for call in &response.tool_calls {
                    if call.name == completion::SUBMIT_PROGRAM_TOOL {
                        let mut submission = code::submitted_program(call);
                        // A call that carried a program is issued its id **here**, before it runs:
                        // the acknowledgement's body is the id, so the receipt the model reads is
                        // the handle `programs.get` takes for the program. A call that carried
                        // none is issued nothing and answered with why. A library that could not
                        // mint one hands the turn a receipt the code turn ends the session on; the
                        // transcript is still answered, because the request must stay a
                        // conversation even on the way out.
                        let body = match &submission.program {
                            Ok(_) => match programs.issue_id() {
                                Ok(id) => {
                                    let body = completion::submit_program_ack(id.as_deref());
                                    submission.receipt = id.map_or(
                                        code::ProgramReceipt::Unkept,
                                        code::ProgramReceipt::Id,
                                    );
                                    body
                                }
                                Err(exhausted) => {
                                    submission.receipt =
                                        code::ProgramReceipt::Exhausted(exhausted.message);
                                    completion::SUBMIT_PROGRAM_ACK.to_string()
                                }
                            },
                            Err(why) => why.clone(),
                        };
                        context.push_tool_result(GgContextSource::ToolOutput, &call.id, body);
                        submissions.push(submission);
                    } else {
                        emitter.emit(log(
                            "warn",
                            format!(
                                "the model called `{}` on a responses-as-code turn, which offers \
                                 no such tool; the call was refused.",
                                call.name
                            ),
                        ));
                        context.push_tool_result(
                            GgContextSource::ToolOutput,
                            &call.id,
                            format!(
                                "There is no tool named `{}` in this session. Submit your \
                                 program with `{}`.",
                                call.name,
                                completion::SUBMIT_PROGRAM_TOOL
                            ),
                        );
                    }
                }
                // A reply that submitted nothing runs nothing: the turn is an error, the model is
                // told how to take its next one, and the loop asks again. Under forced tool choice
                // this is a provider that did not honour the requirement, not the ordinary shape
                // of a turn.
                if submissions.is_empty() {
                    context.push(
                        GgContextSource::System,
                        Retention::Ephemeral,
                        Message::user(format!(
                            "Your reply made no `{tool}` call, so nothing ran. Submit your next \
                             turn's whole program as the `program` string of one `{tool}` call.",
                            tool = completion::SUBMIT_PROGRAM_TOOL
                        )),
                    );
                    if let Some(breach) = self.record_turn(
                        &mut agent_limits,
                        emitter,
                        &limits,
                        TurnOutcome::Error(TurnErrorType::MissingCompletionNoProgram),
                        loop_aborts,
                        response_size,
                    ) {
                        return self.stop_on_limit(
                            emitter,
                            &limits,
                            breach,
                            turn + 1,
                            total_tokens,
                            total_cost,
                            true,
                            last_report.as_deref(),
                            last_text,
                        );
                    }
                    continue;
                }
                // The window and the skills runtime are moved **out of the module set** for the
                // turn: a program's calls act on the live window from a blocking thread, so they
                // travel by value and are put back the moment the turn hands them over. The set is
                // left holding a vacated window and an inert skills runtime in the meantime, which
                // nothing reads — the only path that never hands them back is a host fault, and the
                // loop ends the session there without looking at either again.
                let turn_window = context.take();
                let turn_skills = std::mem::replace(caps.skills_mut(), SkillsRuntime::disabled());
                let turn_ctx = CodeTurn {
                    spawner: self,
                    // The same session turn the window's own headers carry, so the number the model
                    // reads on a result and the turn a `programs.history()` entry names are one
                    // number.
                    turn: turn as u64 + 1,
                    tool_ctx,
                    read_policy,
                    shell_offload: &shell_offload,
                    board: caps.board(),
                    issue_policy: &issue_policy,
                    project: project.as_ref(),
                    memories: caps.memories(),
                    tasks: caps.tasks(),
                    amc: &amc,
                    emitter,
                    fault: &limits.fault,
                    discovery: &discovery,
                    replay: replay.as_ref(),
                    pending_compaction,
                    ending_role,
                    doc_view_types: code.doc_view_types,
                    capabilities: &granted_capabilities,
                    operations: &granted_operations,
                    exec_roster: &set.roster(profile, GgSubagentScope::Subagent),
                };
                // The per-turn state (`context`/`skills`/`docs`/`subagents`) is handed to the code
                // turn **by value** — it is moved into the program's `LoopOperationApi` so the program's
                // calls act on the live window on the blocking sandbox thread — and handed back on
                // every non-fatal path. On the one path it cannot come back (the sandbox task
                // panicked, a host fault), the turn is `Fatal` and the loop returns below without
                // reading the window again.
                let turn_programs =
                    std::mem::replace(&mut programs, crate::programs::ProgramLibrary::disabled());
                let (decision, state) = run_code_turn(
                    submissions,
                    &code,
                    limits.deadline,
                    &turn_ctx,
                    turn_window,
                    turn_skills,
                    docs,
                    turn_programs,
                    std::mem::take(&mut knowledge),
                    subagents.take(),
                )
                .await;
                // The ending gate: a program that called `finish` must clear this agent's
                // agent-stop hooks before the run ends. Fire them *before* the turn is recorded,
                // so a rejected ending is accounted as the `Continue` it becomes (progress, the
                // model must fix and finish again) rather than the `Finished` the program declared.
                // A rejected ending is turned into a `Continue` carrying the failure feedback,
                // which the arm below reclaims the turn's state for, pushes, and loops on — the same
                // path an ordinary error turn takes.
                let decision = match decision {
                    CodeTurnOutcome::Finished { ending }
                        if hooks.runtime.has(GgHookEvent::AgentStop) =>
                    {
                        match hooks
                            .runtime
                            .fire(
                                GgHookEvent::AgentStop,
                                &hooks.agent,
                                json!({ "call": sandbox::FINISH_FUNCTION }),
                                tool_ctx,
                                &shell_offload,
                                emitter,
                            )
                            .await
                        {
                            Err(failure) => {
                                emitter.emit(log("error", failure.to_string()));
                                return LoopEnd {
                                    status: TerminalStatus::attributed(STATUS_HOOK_ERROR, &limits),
                                    turns: turn + 1,
                                    tokens: total_tokens,
                                    cost: total_cost,
                                    profile_id: self.profile_id.clone(),
                                    final_text: Some(failure.to_string()),
                                    ending: None,
                                    limit: None,
                                    handoff: None,
                                };
                            }
                            Ok(run) if run.allowed() => CodeTurnOutcome::Finished { ending },
                            // A process notice, not an error message: the program itself did not
                            // fail — it ran, it declared an ending, and the *session* was refused
                            // one because a hook on the ending refused it.
                            Ok(run) => CodeTurnOutcome::Continue {
                                feedback: vec![CodeFeedback::notice(ending_blocked_feedback(
                                    run.blocked.as_deref().unwrap_or_default(),
                                    run.insertion(),
                                ))],
                                error: None,
                                report: "its ending was blocked by a hook".to_string(),
                            },
                        }
                    }
                    decision => decision,
                };
                // Every code turn is recorded, including the one that finishes and the one that
                // ends fatally, so the rate window is fed uniformly and the accounting cannot drift
                // from the number of model calls made. Neither of those two ever breaches.
                let breach = self.record_turn(
                    &mut agent_limits,
                    emitter,
                    &limits,
                    decision.turn_outcome(),
                    loop_aborts,
                    response_size,
                );
                match decision {
                    CodeTurnOutcome::Finished { ending } => {
                        // A persistent agent hands its open file views to its next instance. On the
                        // code path the window carries none (a program's reads are consumed inside the
                        // program), so this records an empty desk — which is the honest answer, not a
                        // reason to skip the call and leave a stale one behind.
                        if let Some(state) = state {
                            persistence.record(&state.context);
                            *context = state.context;
                            *caps.skills_mut() = state.skills;
                            // The program library is deliberately not put back: this arm ends the
                            // session, and a library nothing will read again is state kept for its
                            // own sake. It is per instance, so nothing outside this loop holds one.
                            *subagents = state.subagents;
                            // A program that forked and then finished still gets its copies: it
                            // handed that work to somebody else, and ending its own session is not
                            // a retraction. The run joins them before it ends, exactly as it joins
                            // a subagent spawned on the same turn.
                            if !state.forks_requested.is_empty()
                                && let Some(sub) = subagents.as_mut()
                            {
                                transitions::dispatch_forks(
                                    sub,
                                    self,
                                    transitions::ForkSource {
                                        context,
                                        history_id: &history_id,
                                        caps,
                                        programs: &state.programs,
                                    },
                                    emitter,
                                    state.forks_requested,
                                    turn + 1,
                                );
                            }
                        }
                        return LoopEnd {
                            status: TerminalStatus::attributed(STATUS_COMPLETED, &limits),
                            turns: turn + 1,
                            tokens: total_tokens,
                            cost: total_cost,
                            profile_id: self.profile_id.clone(),
                            final_text: Some(ending.final_text()),
                            ending: Some(ending),
                            limit: None,
                            handoff: None,
                        };
                    }
                    CodeTurnOutcome::Fatal { message, .. } => {
                        // Put back whatever came back, so the set is coherent for the epilogue even
                        // though nothing reads the window after a host fault.
                        if let Some(state) = state {
                            *context = state.context;
                            *caps.skills_mut() = state.skills;
                        }
                        emitter.emit(log("error", message.clone()));
                        // gg's own machinery, not the model's turn: the model answered, and the
                        // answer was never run — a guest artifact that would not run, a host fault,
                        // or a program gg accepted and could not prepare for its guest. So the
                        // agent ends on gg's status ([`STATUS_INTERNAL_ERROR`]),
                        // which is what keeps our defect out of the model's column of the run's
                        // attribution data, and out of the [error ceilings](RunLimits) the
                        // [fatal outcome](TurnOutcome::Fatal) already keeps it out of.
                        //
                        // ...and the run stops with it, whichever agent this is. A host fault
                        // strikes a subagent far more often than the root — there are more of them
                        // — and the tree that came back from a run with a hole in it cannot be
                        // compared with one from a run without.
                        limits.fault.in_agent(&self.id, &self.profile_id, message);
                        let status = TerminalStatus::attributed(STATUS_INTERNAL_ERROR, &limits);
                        return LoopEnd {
                            status,
                            turns: turn + 1,
                            tokens: total_tokens,
                            cost: total_cost,
                            profile_id: self.profile_id.clone(),
                            final_text: ended_text(true, status, last_report.as_deref(), last_text),
                            ending: None,
                            limit: None,
                            handoff: None,
                        };
                    }
                    CodeTurnOutcome::Continue {
                        feedback, report, ..
                    } => {
                        // Reclaim the per-turn state the code turn carried by value. It is present
                        // on every non-fatal path (only a panicked sandbox loses it, and that is
                        // `Fatal`), so the loop rebinds its live window, skills/docs runtimes and
                        // delegation context here before using them again this turn or next.
                        let CodeTurnState {
                            context: turn_context,
                            skills: turn_skills,
                            docs: turn_docs,
                            programs: turn_programs,
                            knowledge: turn_knowledge,
                            subagents: turn_subagents,
                            issue_waits: turn_issue_waits,
                            compact_requested: turn_compaction,
                            handoff_requested: turn_handoff,
                            forks_requested: turn_forks,
                            compaction_calls: (turn_compaction_calls, turn_compaction_failures),
                        } = state.expect("a non-fatal code turn hands back its per-turn state");
                        *context = turn_context;
                        *caps.skills_mut() = turn_skills;
                        docs = turn_docs;
                        programs = turn_programs;
                        knowledge = turn_knowledge;
                        *subagents = turn_subagents;
                        last_report = Some(report);
                        // The turn's feedback is pushed **before** the breach return, so a stopped
                        // run's context still contains everything the turn produced. It carries no
                        // pictures: a program's `view.openFile` already pushed the mockup it opened
                        // as its own file view, and a bare `fs.readFile` of one shows the model
                        // nothing. One channel, so the picture is paid for exactly once.
                        //
                        // Very often there is nothing to push. A program that compiled, ran, and
                        // opened the views it meant to has already put everything the model gets in
                        // the window, and gg saying "your program ran to completion" on top of that
                        // would be a message with no information in it. gg speaks here only to
                        // report a fault or a process fact — see `CodeFeedback`.
                        for feedback in feedback {
                            context.push(
                                feedback.source,
                                Retention::Ephemeral,
                                Message::user(feedback.body),
                            );
                        }
                        // The copies this program declared. Started here, with the turn's feedback
                        // already in the window, so a copy inherits the conversation its forker is
                        // actually holding — and before the breach return below, because a fork is
                        // work handed to somebody else and a run stopping on a ceiling has not
                        // withdrawn it.
                        if !turn_forks.is_empty()
                            && let Some(sub) = subagents.as_mut()
                        {
                            transitions::dispatch_forks(
                                sub,
                                self,
                                transitions::ForkSource {
                                    context,
                                    history_id: &history_id,
                                    caps,
                                    programs: &programs,
                                },
                                emitter,
                                turn_forks,
                                turn + 1,
                            );
                        }
                        if let Some(breach) = breach {
                            return self.stop_on_limit(
                                emitter,
                                &limits,
                                breach,
                                turn + 1,
                                total_tokens,
                                total_cost,
                                true,
                                last_report.as_deref(),
                                last_text,
                            );
                        }
                        // The deferred half of a program's `wait_for_issue`: the program only
                        // *registered* each wait (a mid-execution block has no shape in a composed
                        // program), so the loop performs it here — after the turn's feedback is
                        // recorded and only when the run is not already stopping — suspending the
                        // agent on each awaited issue in turn before taking the next turn. Each wait
                        // frees this agent's scheduler slot while it blocks, exactly as the native
                        // path's does, so other agents keep running. The terminal status of each is
                        // pushed back so the next program learns whether the issue was done or
                        // failed, the same value the native `wait_for_issue` returns.
                        if !turn_issue_waits.is_empty()
                            && let Some(project) = project.as_ref()
                        {
                            let mut resolved = Vec::with_capacity(turn_issue_waits.len());
                            for issue_id in &turn_issue_waits {
                                let outcome = wait_for_issue_by_id(
                                    project,
                                    self,
                                    caps.board(),
                                    emitter,
                                    issue_id,
                                )
                                .await;
                                resolved.push(outcome.output);
                            }
                            context.push(
                                GgContextSource::System,
                                Retention::Ephemeral,
                                Message::user(resolved.join("\n\n")),
                            );
                        }
                        // The deferred half of an in-loop compaction, the code-mode counterpart of
                        // the tool-calling path's post-dispatch rewrite below. It runs **last** in
                        // the turn, after the feedback and any issue waits are recorded, because
                        // the rewrite drops exactly that material — the summary the model just
                        // wrote is what supersedes it, and dropping it any earlier would mean
                        // compacting a window that was not yet the one the turn produced.
                        //
                        // A `compact` the program declared is honoured whether or not gg asked for
                        // one: under self-compaction the call is bound into every program's scope,
                        // so a model may compact itself the moment it has finished something it can
                        // summarize cleanly — the same freedom the tool-calling path gives it. It is
                        // honoured even if the program then threw: unlike `finish`, whose revocation
                        // exists because a failed program did not run the checks its summary
                        // claimed, a summary of work already done stays true.
                        let request = turn_compaction.or_else(|| {
                            // A memory compaction is satisfied by one program whose calls all
                            // succeeded; the thread then restarts from a note pointing at the
                            // memories the model has just written, which cross the boundary
                            // verbatim.
                            pending_compaction.filter(|pending| {
                                pending.satisfied_by_calls(
                                    turn_compaction_calls,
                                    turn_compaction_failures,
                                )
                            })?;
                            Some(compaction::memory_compaction_request())
                        });
                        match (request, pending_compaction) {
                            (Some(request), _) => {
                                pending_compaction = None;
                                if let Err(failure) = apply_pending_compaction(
                                    context,
                                    &compaction,
                                    caps,
                                    &docs,
                                    &request,
                                    tool_ctx,
                                    &hooks,
                                    &shell_offload,
                                    emitter,
                                )
                                .await
                                {
                                    return hook_failed(self, emitter, &limits, failure, turn + 1);
                                }
                            }
                            // Not satisfied: the compaction stays pending and the next program is
                            // asked again. The instruction is re-stated rather than left to the one
                            // the model has already ignored once, and the run's error ceilings are
                            // what stop an agent that never complies.
                            (None, Some(pending)) => context.push(
                                GgContextSource::System,
                                Retention::Ephemeral,
                                Message::user(
                                    pending.unsatisfied(code_language, memory_calls.clone()),
                                ),
                            ),
                            (None, None) => {}
                        }
                        // The deferred half of a state transition the program declared. Applied
                        // **last** in the turn, after the feedback, the issue waits and any
                        // compaction are all recorded — the successor inherits this window, and it
                        // must inherit the one this turn actually produced. A program that also
                        // compacted therefore hands over the compacted window, which is the right
                        // way round: the compaction was of work already done.
                        if let Some(handoff) = turn_handoff {
                            return LoopEnd {
                                status: TerminalStatus::attributed(STATUS_COMPLETED, &limits),
                                turns: turn + 1,
                                tokens: total_tokens,
                                cost: total_cost,
                                profile_id: self.profile_id.clone(),
                                final_text: None,
                                ending: None,
                                limit: None,
                                // The library goes with the successor: moved, since this
                                // incarnation reads it no further.
                                handoff: Some(handoff.carrying(std::mem::replace(
                                    &mut programs,
                                    crate::programs::ProgramLibrary::disabled(),
                                ))),
                            };
                        }
                        // The turn must end on a message from gg. Usually it already does — a view
                        // the program opened, an error, a rebuilt state block — but a program that
                        // ran cleanly and opened nothing new leaves this turn's own submission —
                        // the assistant message, or a `submit_program` acknowledgement — last,
                        // which is a request that asks the provider for nothing new.
                        //
                        // Checked against the window rather than inferred from the outcome, because
                        // what lands last is not a property of the program alone: a re-opened view
                        // supersedes in place rather than appending, a compaction rewrites the
                        // window wholesale, and either can leave the turn ending where it started.
                        if context.ends_on_submission(&turn_call_ids) {
                            context.push(
                                GgContextSource::System,
                                Retention::Ephemeral,
                                Message::user(prompts::render_code_nothing_shown(code.language)),
                            );
                        }
                        continue;
                    }
                }
            }

            // A reply that made no tool call while a compaction is pending is answered by the
            // compaction, not by the ending rule below: the model was told to compact its window and
            // replied with prose, so what it needs is the instruction restated rather than a note
            // about how to end a session it is nowhere near ending. Counted as an error either way,
            // so an agent that never complies stops on the run's error ceilings rather than looping.
            if response.tool_calls.is_empty()
                && let Some(pending) = pending_compaction
            {
                let breach = self.record_turn(
                    &mut agent_limits,
                    emitter,
                    &limits,
                    TurnOutcome::Error(TurnErrorType::MissingCompletionCompaction),
                    loop_aborts,
                    response_size,
                );
                context.push(
                    GgContextSource::System,
                    Retention::Ephemeral,
                    Message::user(pending.unsatisfied(code_language, memory_calls.clone())),
                );
                if let Some(breach) = breach {
                    return self.stop_on_limit(
                        emitter,
                        &limits,
                        breach,
                        turn + 1,
                        total_tokens,
                        total_cost,
                        code.enabled,
                        last_report.as_deref(),
                        last_text,
                    );
                }
                continue;
            }

            // The **tool-calling** mode's termination rule, and it is the same rule the code branch
            // above enforces: a session ends on an explicit ending call and on nothing else. A reply
            // that requested no tools is therefore an *error*, not a conclusion — so a model that
            // loops emitting prose instead of ending trips the run's error ceilings and stops early
            // rather than burning to its turn budget — and it is answered by naming the calls this
            // agent's role actually gives it.
            if response.tool_calls.is_empty() {
                let breach = self.record_turn(
                    &mut agent_limits,
                    emitter,
                    &limits,
                    TurnOutcome::Error(TurnErrorType::MissingCompletionNoCall),
                    loop_aborts,
                    response_size,
                );
                context.push(
                    GgContextSource::ToolOutput,
                    Retention::Ephemeral,
                    Message::user(completion::missing_completion_feedback(ending_role)),
                );
                if let Some(breach) = breach {
                    return self.stop_on_limit(
                        emitter,
                        &limits,
                        breach,
                        turn + 1,
                        total_tokens,
                        total_cost,
                        code.enabled,
                        last_report.as_deref(),
                        last_text,
                    );
                }
                continue;
            }

            // The ending this turn declared. Captured during dispatch (an ending call is
            // intercepted like the other loop-driven tools) and, if set, ends the session once the
            // turn's tool results are all recorded — so the intercepted call's result is answered
            // and the conversation stays valid.
            let mut declared_ending: Option<Ending> = None;

            // The compaction this turn declared with a `compact` call, deferred to after the
            // dispatch loop because the turn's tool results must all be recorded first, or the
            // rewrite would drop an assistant `tool_calls` message whose `tool` answers had not been
            // written yet. How this turn's calls fared against a pending compaction is tallied
            // alongside, for the memory strategy's "one reply whose calls all succeeded" gate.
            let mut compact_request: Option<CompactionRequest> = None;
            let mut compaction_calls = 0u32;
            let mut compaction_failures = 0u32;

            // The state transition this turn declared, deferred on exactly the same terms as the
            // ending above: captured during dispatch, applied once every tool result of the turn is
            // recorded. **First wins.** Unlike a compaction — which is idempotent, so a second
            // `compact` harmlessly replaces the first — a silently replaced successor identity is a
            // change the model cannot see, so a second transition in one turn is refused and says
            // why.
            let mut declared_handoff: Option<Handoff> = None;

            // The copies this turn declared with `fork`, deferred on the same terms and for the
            // same reason as the succession above — the window a copy inherits has to be a complete
            // conversation, and mid-turn it is not. **Additive**, unlike a succession: each fork is
            // a separate child, so a turn may declare several and every one of them runs.
            let mut declared_forks: Vec<PendingFork> = Vec::new();

            // A [hook](crate::hooks) whose own machinery failed, which stops the run rather than
            // being fed back to the model — a broken gate has judged nothing, and both ways of
            // guessing what it meant are a lie about a check an operator is relying on. Set inside
            // the dispatch loop and acted on the moment that loop breaks, so the turn's already-
            // recorded results are not left dangling.
            let mut hook_failure: Option<HookFailure> = None;

            // Dispatch each requested tool call against the workspace and feed the result
            // back so the model can proceed on its next turn.
            for call in &response.tool_calls {
                emitter.emit(GgTelemetryKind::ToolCall {
                    name: call.name.clone(),
                    args: call.arguments.clone(),
                });

                // The subagent tools are intercepted here (never routed through
                // `registry.dispatch`, whose registered validators are defensive placeholders): the
                // loop drives the scheduler and the agent tree, which the tools cannot reach.
                let mut outcome = if let Some(pending) =
                    pending_compaction.filter(|pending| !pending.admits(&call.name))
                {
                    // A compaction is in flight and this is not the call it asked for. Refused
                    // ahead of every other gate — including `finish` — because the window is
                    // already full: any call that ran would make the problem worse, and a run that
                    // ended here would end from a context the model has just been told is about to
                    // be dropped.
                    ToolOutcome::failed(
                        ToolFailure::Refused,
                        pending.refusal(&call.name, code_language, memory_calls.clone()),
                    )
                } else if call.name == COMPACT_TOOL
                    && compaction.strategy.offers_compact_tool(false)
                {
                    // Self-compaction: the model compacts its own window. Intercepted here,
                    // exactly as `finish` is, because the loop owns the context model the tool
                    // cannot hold. The rewrite itself is deferred until this turn's results are all
                    // recorded.
                    match parse_compact_request(&call.arguments) {
                        Ok(request) => {
                            compact_request = Some(request);
                            ToolOutcome::ok(
                                "Your context will be compacted once this turn's tool results \
                                 are recorded; your next turn opens on the summarized window.",
                                "compact accepted",
                            )
                        }
                        Err(message) => ToolOutcome::failed(ToolFailure::InvalidArgument, message),
                    }
                } else if !code.enabled && ending_role.owns(&call.name) {
                    // An ending call. Intercepted here, like the delegation tools. The
                    // declaration is built through the same [`Ending`] constructors the sandbox
                    // membrane uses, so a malformed one is refused in the same words whichever mode
                    // the agent runs in.
                    //
                    // When the ending is validated the commands run first: on success the
                    // declaration is captured and the session ends after this turn's results are
                    // recorded; on failure the tool result carries the validation output back and
                    // the session continues, so the model fixes the problem and declares again.
                    match parse_ending_call(&call.name, &call.arguments, ending_role) {
                        Err(message) => ToolOutcome::failed(ToolFailure::InvalidArgument, message),
                        Ok(declared) => {
                            // The [agent-stop](GgHookEvent::AgentStop) hooks are the ending's
                            // gate. A blocking hook hands its reason back as a refused tool result
                            // and the session goes on, so the model fixes the problem and declares
                            // again; a hook that only had something to say has it inserted
                            // alongside.
                            let fired = hooks
                                .runtime
                                .fire(
                                    GgHookEvent::AgentStop,
                                    &hooks.agent,
                                    json!({ "call": call.name }),
                                    tool_ctx,
                                    &shell_offload,
                                    emitter,
                                )
                                .await;
                            match fired {
                                Err(failure) => {
                                    hook_failure = Some(failure);
                                    break;
                                }
                                Ok(run) => match run.blocked.clone() {
                                    Some(reason) => ToolOutcome::failed(
                                        ToolFailure::Refused,
                                        ending_blocked_feedback(&reason, run.insertion()),
                                    ),
                                    None => {
                                        declared_ending = Some(declared);
                                        let mut message = "Your session will end once this turn's \
                                                           tool results are recorded."
                                            .to_string();
                                        if let Some(insertion) = run.insertion() {
                                            message.push_str("\n\n");
                                            message.push_str(&insertion);
                                        }
                                        ToolOutcome::ok(message, format!("{} accepted", call.name))
                                    }
                                },
                            }
                        }
                    }
                } else if let Some(position) = self
                    .fsm
                    .as_ref()
                    .filter(|_| call.name == TRANSITION_STATE_TOOL)
                {
                    // A state transition. Intercepted here, like the ending calls, because applying
                    // it means tearing this agent instance down and standing the next state's up
                    // against the orchestrator and the scheduler — which the tool, seeing only its
                    // arguments and a workspace path, cannot reach.
                    handle_transition(position, &declared_ending, &mut declared_handoff, call)
                } else if call.name == EXEC_TOOL && registry.offers(EXEC_TOOL) {
                    // Becoming another agent. Intercepted here for the same reason a transition is:
                    // it tears this instance down and stands another up against the orchestrator and
                    // the scheduler. Validated against this agent's own roster — the allowlist a
                    // spawn is checked against — which is the one thing the loop has and the tool
                    // does not.
                    handle_exec(
                        &set.roster(profile, GgSubagentScope::Subagent),
                        self,
                        &declared_ending,
                        &mut declared_handoff,
                        call,
                    )
                } else if call.name == FORK_TOOL && registry.offers(FORK_TOOL) {
                    // Running a copy of this agent. Intercepted here because a fork is a child: it
                    // needs the scheduler, the depth cap and this agent's delegation context, none
                    // of which a tool can see. The copy's id is minted now (so this call can answer
                    // with it) and the copy itself starts once the turn's results are recorded.
                    match subagents.as_mut() {
                        Some(sub) => handle_fork(sub, self, &mut declared_forks, call),
                        None => ToolOutcome::failed(
                            ToolFailure::Unavailable,
                            format!(
                                "`{FORK_TOOL}` is not available: this run has no delegation \
                                 runtime, so a copy of you could never be waited on or messaged."
                            ),
                        ),
                    }
                } else if let Some(project) = project
                    .as_ref()
                    .filter(|_| call.name == WAIT_FOR_ISSUE_TOOL)
                {
                    // Project management: `wait_for_issue` suspends this agent until the named
                    // board issue reaches a terminal state. Intercepted here (like the
                    // delegation tools) because it must free this agent's scheduler slot and
                    // block on the orchestrator's issue-wait registry, which the tool cannot
                    // reach.
                    handle_wait_for_issue(project, self, caps.board(), emitter, call).await
                } else if let Some(sub) = subagents.as_mut() {
                    if is_subagent_tool(&call.name) {
                        handle_subagent_call(sub, self, emitter, call).await
                    } else {
                        match dispatch_hooked(
                            registry,
                            call,
                            tool_ctx,
                            &hooks,
                            &shell_offload,
                            emitter,
                        )
                        .await
                        {
                            Ok(outcome) => outcome,
                            Err(failure) => {
                                hook_failure = Some(failure);
                                break;
                            }
                        }
                    }
                } else {
                    match dispatch_hooked(registry, call, tool_ctx, &hooks, &shell_offload, emitter)
                        .await
                    {
                        Ok(outcome) => outcome,
                        Err(failure) => {
                            hook_failure = Some(failure);
                            break;
                        }
                    }
                };

                // Agent-managed context: `evict_file_view`/`archive_thread` act on the live
                // window, which the tools cannot hold — the tool only validated the args, so the
                // loop performs the reclaim against the context model here, rewrites the tool
                // result with what was actually reclaimed, and emits the `ContextManaged` effect
                // (the tool `ToolCall`/`ToolResult` still stream too). `search_archive` needs no
                // special handling — it read the shared archive in its own `invoke`.
                let managed_events = match ContextReclaim::of_tool(&call.name) {
                    Some(reclaim) if amc.enabled && outcome.ok => apply_context_reclaim(
                        context,
                        &amc.archive,
                        &amc.archive_id,
                        reclaim,
                        &call.arguments,
                        &mut outcome,
                    ),
                    _ => Vec::new(),
                };

                emitter.emit(GgTelemetryKind::ToolResult {
                    name: call.name.clone(),
                    ok: outcome.ok,
                    summary: outcome.summary.clone(),
                    failure: outcome.wire_failure(),
                });
                for event in managed_events {
                    emitter.emit(event);
                }

                // Session capture: this is the one point every dispatched tool call funnels
                // through with its final outcome (after any agent-managed-context reclaim rewrote
                // it), so recording here pins ordinary registry dispatch and the intercepted
                // delegation/review/advance tools alike — a decorator at the choke point, not a
                // call scattered per tool. Recorded before the outcome is moved into the context.
                if let Some(recorder) = &replay {
                    recorder.record_tool_result(&self.id, call, &outcome);
                }

                // Project management: a successful board mutation may have made issues actionable
                // (dispatch a new agent) or moved one to a terminal state (wake its waiters and
                // unblock dependents). Pump the dispatcher and wake issue-waiters *before*
                // `record_tool_result` re-emits the board state below, so the emitted snapshot and
                // the refreshed pinned block reflect the resulting assignments. Idempotent, so a
                // board tool that changed nothing dispatch-relevant is harmless.
                if let Some(project) = project.as_ref()
                    && outcome.ok
                    && is_board_tool(&call.name)
                {
                    project.orch.pump_and_wake(emitter);
                }

                // Every call made while a compaction is in flight is counted, and every one that
                // did not succeed — a refusal included, since a refusal is a call that did not run —
                // is counted as a failure. A memory compaction is satisfied by one reply whose calls
                // all succeeded, which is exactly the question these two answer.
                if pending_compaction.is_some() {
                    compaction_calls += 1;
                    if !outcome.ok {
                        compaction_failures += 1;
                    }
                }

                record_tool_result(context, caps, call, outcome, emitter);
            }

            // A hook that failed stops the run here, before anything this turn declared is acted
            // on: a fork this turn asked for is work the run is no longer going to do, and an
            // ending it declared was gated by the very machinery that just broke.
            if let Some(failure) = hook_failure {
                emitter.emit(log("error", failure.to_string()));
                let _ = self.record_turn(
                    &mut agent_limits,
                    emitter,
                    &limits,
                    TurnOutcome::Finished,
                    loop_aborts,
                    response_size,
                );
                return LoopEnd {
                    status: TerminalStatus::attributed(STATUS_HOOK_ERROR, &limits),
                    turns: turn + 1,
                    tokens: total_tokens,
                    cost: total_cost,
                    profile_id: self.profile_id.clone(),
                    final_text: Some(failure.to_string()),
                    ending: None,
                    limit: None,
                    handoff: None,
                };
            }

            // The copies this turn declared: every tool result is recorded, so the window they
            // inherit is a complete conversation rather than one stopped between an assistant's
            // tool calls and their answers. Started **before** the ending check below, because a
            // fork is work this agent handed to somebody else and an agent that finishes in the
            // same turn has not withdrawn it.
            if !declared_forks.is_empty()
                && let Some(sub) = subagents.as_mut()
            {
                transitions::dispatch_forks(
                    sub,
                    self,
                    transitions::ForkSource {
                        context,
                        history_id: &history_id,
                        caps,
                        programs: &programs,
                    },
                    emitter,
                    std::mem::take(&mut declared_forks),
                    turn + 1,
                );
            }

            // An ending declared this turn: every tool result — including the ending call's — is
            // now recorded, so the conversation is valid and the session may end. Recorded as a
            // `Finished` turn (which never breaches).
            if let Some(ending) = declared_ending {
                let _ = self.record_turn(
                    &mut agent_limits,
                    emitter,
                    &limits,
                    TurnOutcome::Finished,
                    loop_aborts,
                    response_size,
                );
                // A persistent agent hands the file views it still has open to its next instance —
                // recorded only on this path, because only an agent that *finished its work* has a desk
                // worth inheriting. One stopped by a ceiling or an error leaves the previous
                // instance's record standing.
                persistence.record(context);
                return LoopEnd {
                    status: TerminalStatus::attributed(STATUS_COMPLETED, &limits),
                    turns: turn + 1,
                    tokens: total_tokens,
                    cost: total_cost,
                    profile_id: self.profile_id.clone(),
                    final_text: Some(ending.final_text()),
                    ending: Some(ending),
                    limit: None,
                    handoff: None,
                };
            }

            // The deferred half of a compaction the model performed itself: every tool result —
            // including the `compact` call's — is now recorded, so the conversation is valid and the
            // window may be rewritten. Two things can land here: a `compact` call (whether gg asked
            // for one or the model reached for the tool unprompted, which self-compaction allows at
            // any time), and a memory compaction satisfied by a reply whose calls all succeeded.
            //
            // A pending compaction that neither satisfied stays pending, with its instruction
            // restated so the next turn is asked in gg's words rather than left to re-read the one
            // it has already ignored. The run's error ceilings are what stop an agent that never
            // complies — the refusals it collects on the way are counted as the errors they are.
            let compaction_request = compact_request.or_else(|| {
                pending_compaction.filter(|pending| {
                    pending.satisfied_by_calls(compaction_calls, compaction_failures)
                })?;
                Some(compaction::memory_compaction_request())
            });
            match (compaction_request, pending_compaction) {
                (Some(request), _) => {
                    pending_compaction = None;
                    if let Err(failure) = apply_pending_compaction(
                        context,
                        &compaction,
                        caps,
                        &docs,
                        &request,
                        tool_ctx,
                        &hooks,
                        &shell_offload,
                        emitter,
                    )
                    .await
                    {
                        return hook_failed(self, emitter, &limits, failure, turn + 1);
                    }
                }
                (None, Some(pending)) => context.push(
                    GgContextSource::System,
                    Retention::Ephemeral,
                    Message::user(pending.unsatisfied(code_language, memory_calls.clone())),
                ),
                (None, None) => {}
            }

            // The state transition this turn declared: every tool result — including the
            // transition call's — is now recorded and any compaction the turn asked for has been
            // applied, so the conversation is valid and the incarnation may end. Two orderings
            // matter here, and both are deliberate:
            //
            // * **after the ending**, which is what makes an ending win a turn that declared both:
            //   the agent said its work was done, and a successor would have nothing left to do;
            // * **after the compaction**, because the successor inherits *this* window and it must
            //   inherit the one this turn actually produced. A model that compacted and handed off
            //   in one turn paid for a summary; dropping it would hand the successor the full
            //   window it thought it had just condensed. The code path applies the two in the same
            //   order, for the same reason.
            //
            // Recorded as a `Progressed` turn rather than a `Finished` one: the session is not over,
            // it is continuing as somebody else, and the error-rate window this agent has built up
            // travels no further than this incarnation anyway.
            if let Some(handoff) = declared_handoff {
                let _ = self.record_turn(
                    &mut agent_limits,
                    emitter,
                    &limits,
                    TurnOutcome::Progressed,
                    loop_aborts,
                    response_size,
                );
                return LoopEnd {
                    status: TerminalStatus::attributed(STATUS_COMPLETED, &limits),
                    turns: turn + 1,
                    tokens: total_tokens,
                    cost: total_cost,
                    profile_id: self.profile_id.clone(),
                    final_text: None,
                    ending: None,
                    limit: None,
                    // A tool-calling incarnation's library is empty (it runs no programs), but it is
                    // still the one its successor adopts, so it travels on the same terms.
                    handoff: Some(handoff.carrying(std::mem::replace(
                        &mut programs,
                        crate::programs::ProgramLibrary::disabled(),
                    ))),
                };
            }

            // The tool-calling turn is done: every requested call was dispatched and answered, and
            // every deferred effect the turn asked for has been applied. Recorded **last** for
            // exactly that reason — a stop must not land between a declaration and the rewrite that
            // completes it — and recorded at all because a `Progressed` turn can be the
            // one that first *fills* the error-rate window, and a window that becomes judgeable at
            // three errors in four must breach then rather than waiting for a fourth failure.
            if let Some(breach) = self.record_turn(
                &mut agent_limits,
                emitter,
                &limits,
                TurnOutcome::Progressed,
                loop_aborts,
                response_size,
            ) {
                return self.stop_on_limit(
                    emitter,
                    &limits,
                    breach,
                    turn + 1,
                    total_tokens,
                    total_cost,
                    code.enabled,
                    last_report.as_deref(),
                    last_text,
                );
            }
        }

        // The turn ceiling. It keeps its own long-standing terminal status, and now also records
        // the breach every other ceiling records, so "which ceiling stopped this run?" has one
        // answer rather than one per status. Only reached when a turn ceiling is set: an unbounded
        // run iterates to `usize::MAX` and stops on another ceiling or `finish` long before, so this
        // fall-through does not happen for it, and `turn_bound` is the real ceiling either way.
        let breach = GgLimitBreach {
            limit: GgLimitKind::Turns,
            threshold: turn_bound as f64,
            observed: turn_bound as f64,
            turns: agent_limits.turns_recorded(),
            agent_id: self.id.clone(),
            window: None,
        };
        self.stop_on_limit(
            emitter,
            &limits,
            breach,
            turn_bound,
            total_tokens,
            total_cost,
            code.enabled,
            last_report.as_deref(),
            last_text,
        )
    }

    /// Record one turn's [outcome](TurnOutcome) — the **one** seam every turn of this loop passes
    /// through, in both execution modes and on every path out of the loop.
    ///
    /// It does four things, in this order and for these reasons:
    ///
    /// 1. **judges the outcome against the `run`**, so that a turn which failed while gg was
    ///    already broken is recorded as gg's — see [`attributed`](Self::attributed);
    /// 2. **folds the outcome into this agent's [ceilings](AgentLimits)**, which is what makes the
    ///    consecutive count and the rate window statements about a complete turn sequence;
    /// 3. **publishes it** as a [`TurnOutcome`](GgTelemetryKind::TurnOutcome) event, so the judgement
    ///    the ceilings act on is the judgement a reader sees. That is the whole reason this helper
    ///    exists: folding the outcome in at scattered call sites without emitting it would leave a
    ///    run that failed a third of its turns and finished anyway indistinguishable, from the
    ///    outside, from one that never failed a turn;
    /// 4. **returns the breach** the fold produced, so every caller keeps its existing
    ///    "record, then stop if that was the one" shape and nothing had to move.
    ///
    /// The event carries the agent's state **after** the fold — its consecutive-error run and its
    /// running turn count — because both are per-agent facts a run-wide stream cannot re-derive
    /// (turns from concurrently running agents interleave arbitrarily), and because the maximum of
    /// the first is exactly [`GgErrorSummary::max_consecutive`](test_cabinet_core::gg::GgErrorSummary).
    ///
    /// `loop_aborts` is what [loop detection](crate::loopguard) discarded before this turn produced
    /// a reply — how many attempts, and how much generated output went with them. Empty for every
    /// turn of every run that left the capability disarmed, which is the default. It rides here
    /// rather than on an event of its own because a discarded attempt is not a turn: it produced
    /// nothing and the request was simply retried, so the turn that eventually succeeded is the
    /// only event there is to hang it on.
    fn record_turn(
        &self,
        agent_limits: &mut AgentLimits,
        emitter: &Emitter,
        run: &impl FaultedRun,
        outcome: TurnOutcome,
        loop_aborts: LoopAborts,
        response: ResponseSize,
    ) -> Option<GgLimitBreach> {
        let outcome = Self::attributed(outcome, run);
        let breach = agent_limits.record(outcome, &self.id);
        let (wire_outcome, error, error_type) = outcome.wire();
        emitter.emit(GgTelemetryKind::TurnOutcome {
            outcome: wire_outcome,
            error,
            error_type,
            // The streak **this turn is part of**, which is why a turn that is not an error
            // publishes zero rather than the raw counter. The two only differ on a terminal turn:
            // the accounting neither raises nor clears the count for one (the session is over
            // either way), so an agent that failed twice and then finished still *holds* a count of
            // two — a number that describes the turns before it and not this one. Publishing it
            // here would put a streak on a turn that did not fail, and it would tell a reader
            // nothing new, because the error turn that produced it published the same figure.
            // What is left is one clean statement: a non-zero streak and an error outcome are the
            // same thing.
            consecutive_errors: if outcome.is_error() {
                agent_limits.consecutive_errors()
            } else {
                0
            },
            turns: agent_limits.turns_recorded(),
            loop_aborts: u64::from(loop_aborts.attempts),
            // The three figures are published together and are never apart: the count says how
            // often the model looped, and the two sizes say how much generation it cost to find
            // that out. Deliberately not folded into the turn's token usage or its cost, which are
            // the provider's own numbers for the one reply that was actually read.
            loop_abort_words: loop_aborts.words,
            loop_abort_chars: loop_aborts.chars,
            // The reply's size, in the two units an output ceiling would be judged in. Ridden on
            // the outcome event because the summary folds its maxima over exactly the turns that
            // worked, and the outcome is the only event that knows which those were.
            response_chars: response.chars,
            response_output_tokens: response.output_tokens,
        });
        breach
    }

    /// Whose failure this turn's outcome really is, read once against the run's
    /// [fault latch](crate::fault).
    ///
    /// A gg defect does not only *end* a turn, it can also **fail** one. A call gg refuses because
    /// gg is broken — a subagent it validated and then could not stand up, a skill's code it
    /// accepted and could not prepare — throws into the program that made it, and an uncaught throw
    /// is a [`ProgramApiError`](TurnErrorType::ProgramApiError). Recorded as it stands, that turn
    /// enters the published record as a `program_fault` the model committed and spends the model's
    /// [error ceilings](RunLimits), so gg's defect could end the run under `limit_exceeded` with
    /// the model's name on it. The refusal's *class* is chosen carefully at each of those sites;
    /// what none of them can fix from where they stand is the turn one layer up.
    ///
    /// So an [`Error`](TurnOutcome::Error) raised while the latch is up is recorded as
    /// [`RunBroken`](FatalFault::RunBroken) instead. Every other outcome passes through: a turn that
    /// progressed or finished attributes nothing to anybody, and a turn that was already fatal
    /// names the fault it met, which is sharper than this one.
    ///
    /// It is deliberately the run's latch and not "did *this* call fault", because no error site
    /// can know: the throw reaches this loop as a message. The cost of reading it this way is a
    /// turn the model really did fail, on an agent elsewhere in a run that broke while it ran,
    /// being recorded as gg's. That run is disqualified either way and will never be scored, so the
    /// figure is one nobody reads — where the failure in the other direction is a defect of ours
    /// counted as the model's on a run somebody does.
    ///
    /// The question is put to a [`FaultedRun`] rather than to a latch for the reason the
    /// [ending seam](attribution) gives, and it belongs here at least as much: this record is what
    /// the [error ceilings](RunLimits) spend and what the published per-type error rollup counts, so
    /// a turn attributed against a latch of somebody's own making would put gg's defect in the
    /// model's column of the two figures a study reads most. A type-level guarantee that covered
    /// only the ending would have been the weaker half of the pair.
    fn attributed(outcome: TurnOutcome, run: &impl FaultedRun) -> TurnOutcome {
        match outcome {
            TurnOutcome::Error(_) if run.fault().raised().is_some() => {
                TurnOutcome::Fatal(FatalFault::RunBroken)
            }
            outcome => outcome,
        }
    }

    /// End this agent's loop on a breached [ceiling](RunLimits) — the **one** place any of the five
    /// does so.
    ///
    /// It emits the `warn` line naming what was breached and at what value, then the structured
    /// [`LimitExceeded`](GgTelemetryKind::LimitExceeded) event a study groups by, then returns the
    /// [`LoopEnd`] carrying the breach. Nothing is aborted: a cost or deadline breach is detected
    /// *before* a turn, so nothing is in flight, and an error breach is detected *after* the turn's
    /// outcome is fully recorded, so its feedback is already in the context and its telemetry has
    /// already streamed. **The workspace is left exactly as the last completed turn left it** — gg
    /// rolls nothing back.
    ///
    /// The terminal status comes from the breach rather than the caller, because the mapping is a
    /// property of the ceiling: the turn and runtime ceilings keep the statuses they have always
    /// had, and the three new ones share [`STATUS_LIMIT_EXCEEDED`]. A caller that chose its own
    /// could disagree with the breach it is carrying.
    ///
    /// It reads the run's [fault latch](crate::fault) on the way to its status like every other
    /// ending does, and in practice never changes anything: no ceiling ends an agent on a failure status, and the
    /// loop reads the latch at its boundary *before* it measures a ceiling anyway. It goes through
    /// the same seam regardless, because [an ending whose status is decided somewhere
    /// else](attribution) is what this exists to make impossible.
    ///
    /// Being the one place, it is also where the breach becomes the **run's**, on the
    /// [ceiling latch](CeilingLatch): all five ceilings pass through here, so none of them can be
    /// the one that reaches the session outcome by a different route or not at all. Raising it
    /// stops nothing further — this agent is ending, and every other agent of the run is left alone
    /// — and what it changes is the process exit code, so a run that spent a safeguard is not
    /// collected as a session that ran to a natural end.
    #[allow(clippy::too_many_arguments)]
    fn stop_on_limit(
        &self,
        emitter: &Emitter,
        limits: &LimitsSetup,
        breach: GgLimitBreach,
        turns: usize,
        tokens: TokenCounts,
        cost: Option<Cost>,
        code_mode: bool,
        last_report: Option<&str>,
        last_text: Option<String>,
    ) -> LoopEnd {
        let status = TerminalStatus::attributed(status_for_breach(breach.limit), limits);
        limits.ceiling.raise(&breach);
        emitter.emit(log("warn", breach_message(&breach)));
        emitter.emit(GgTelemetryKind::LimitExceeded {
            breach: breach.clone(),
        });
        LoopEnd {
            status,
            turns,
            tokens,
            cost,
            profile_id: self.profile_id.clone(),
            final_text: ended_text(code_mode, status, last_report, last_text),
            ending: None,
            limit: Some(breach),
            handoff: None,
        }
    }

    /// End this agent because an **operator killed the run** — [`stop_on_limit`](Self::stop_on_limit)'s
    /// sibling, and deliberately its twin in shape: the same accumulated tokens and cost, the same
    /// honest `final_text` for what the agent last did, the same return into the session's ordinary
    /// epilogue.
    ///
    /// It carries **no** [breach](GgLimitBreach), and that absence is the point. Every breach names
    /// a ceiling that was measured and crossed; a cancellation crossed nothing. Recording one would
    /// put a fabricated ceiling into the one field a study reads to find out why runs stop.
    #[allow(clippy::too_many_arguments)]
    fn stop_on_cancel(
        &self,
        emitter: &Emitter,
        limits: &LimitsSetup,
        turns: usize,
        tokens: TokenCounts,
        cost: Option<Cost>,
        code_mode: bool,
        last_report: Option<&str>,
        last_text: Option<String>,
    ) -> LoopEnd {
        let status = TerminalStatus::attributed(STATUS_CANCELED, limits);
        emitter.emit(log(
            "warn",
            format!(
                "agent `{}` stopped at a turn boundary: the run was canceled by its host after \
                 {turns} turns.",
                self.id
            ),
        ));
        LoopEnd {
            status,
            turns,
            tokens,
            cost,
            profile_id: self.profile_id.clone(),
            final_text: ended_text(code_mode, status, last_report, last_text),
            ending: None,
            limit: None,
            handoff: None,
        }
    }

    /// End this agent because **gg broke** — in this agent or in any other agent of the run
    /// ([`crate::fault`]) — [`stop_on_cancel`](Self::stop_on_cancel)'s twin in shape, and its
    /// opposite in what it means.
    ///
    /// The wind-down is identical because the mechanics are: a run-wide condition, observed at a
    /// turn boundary, stopping each agent at its own. What differs is the status
    /// ([`STATUS_INTERNAL_ERROR`], not [`STATUS_CANCELED`]) and therefore everything downstream of
    /// it — the session exits non-zero and is never scored, where a killed run exits `0` and is
    /// collected. An operator who stopped a run knows why it stopped; nobody stopped this one.
    ///
    /// The `error` line **repeats the run's fault** rather than saying "the run faulted": most
    /// agents that end here never saw the defect, and their own stream is where a console reader
    /// looking at that agent is standing. A line that made them go and find the cause somewhere
    /// else in the tree would be a line that costs an operator the thing they need most.
    #[allow(clippy::too_many_arguments)]
    fn stop_on_fault(
        &self,
        emitter: &Emitter,
        limits: &LimitsSetup,
        diagnostic: &str,
        turns: usize,
        tokens: TokenCounts,
        cost: Option<Cost>,
        code_mode: bool,
        last_report: Option<&str>,
        last_text: Option<String>,
    ) -> LoopEnd {
        // Stated as the ending every other path states it, against the very run whose latch is
        // stopping this agent — rather than asserted, which would leave the one ending that is
        // *always* gg's as the one ending nothing checks.
        let status = TerminalStatus::attributed(STATUS_INTERNAL_ERROR, limits);
        emitter.emit(log(
            "error",
            format!(
                "agent `{}` stopped at a turn boundary after {turns} turns: {diagnostic}. The whole \
                 run ends here, because a tree a gg defect stopped is not a tree the model produced \
                 and must not be scored as one.",
                self.id
            ),
        ));
        LoopEnd {
            status,
            turns,
            tokens,
            cost,
            profile_id: self.profile_id.clone(),
            final_text: ended_text(code_mode, status, last_report, last_text),
            ending: None,
            limit: None,
            handoff: None,
        }
    }

    /// End this agent because its [compaction] **stopped working** — the window
    /// came back at the trigger once more than the capability's
    /// [`maxRetries`](crate::compaction::CompactionPolicy::max_retries) allows.
    ///
    /// A sibling of [`stop_on_cancel`](Self::stop_on_cancel) and
    /// [`stop_on_fault`](Self::stop_on_fault), and the same shape as both: a condition observed at a
    /// turn boundary, with nothing in flight, ending the agent through the same [attribution
    /// seam](attribution) and into the same epilogue. It carries **no** [breach](GgLimitBreach) for
    /// the reason a cancellation carries none — no ceiling of the operator's was crossed, and
    /// writing a fabricated one into the field a study reads for "why did runs stop?" would put this
    /// ending in the ceilings' column.
    ///
    /// The `error` line names how many boundaries fired, the threshold none of them got under, and
    /// the allowance that is now spent — which is both halves of what an operator needs: what
    /// happened, and which figure to move. What each boundary actually produced is on the run's own
    /// compaction records, so it is not restated here.
    #[allow(clippy::too_many_arguments)]
    fn stop_on_stuck_compaction(
        &self,
        emitter: &Emitter,
        limits: &LimitsSetup,
        setup: &CompactionSetup,
        fired: u64,
        turns: usize,
        tokens: TokenCounts,
        cost: Option<Cost>,
        code_mode: bool,
        last_report: Option<&str>,
        last_text: Option<String>,
    ) -> LoopEnd {
        let status = TerminalStatus::attributed(STATUS_COMPACTION_FAILED, limits);
        emitter.emit(log(
            "error",
            format!(
                "agent `{}` stopped after {turns} turns: {} with the `{}` strategy left the window \
                 at or above the compaction threshold of {:.0}%, and the retry allowance \
                 (`maxRetries` = {}) is spent. There is no window left for this agent to work in.",
                self.id,
                plural(fired as usize, "compaction"),
                setup.strategy.id(),
                setup.policy.trigger_fullness() * 100.0,
                setup.policy.max_retries,
            ),
        ));
        LoopEnd {
            status,
            turns,
            tokens,
            cost,
            profile_id: self.profile_id.clone(),
            final_text: ended_text(code_mode, status, last_report, last_text),
            ending: None,
            limit: None,
            handoff: None,
        }
    }
}

/// The terminal status one breached [ceiling](GgLimitKind) ends an agent under.
///
/// Two of the five keep statuses that predate this vocabulary. That is not inconsistency but
/// compatibility: `exhausted` and `timed_out` are recorded on every historical run and are what the
/// console, the aggregation facet and `core`'s run-state mapping already read, so re-labelling them
/// would rewrite the meaning of runs nobody re-ran. Which ceiling stopped a run is answered by the
/// [breach](GgLimitBreach), which every one of the five now carries.
fn status_for_breach(limit: GgLimitKind) -> &'static str {
    match limit {
        GgLimitKind::Turns => STATUS_EXHAUSTED,
        GgLimitKind::Runtime => STATUS_TIMED_OUT,
        GgLimitKind::ConsecutiveErrors | GgLimitKind::ErrorRate | GgLimitKind::Cost => {
            STATUS_LIMIT_EXCEEDED
        }
    }
}

/// The operator-facing `warn` line for one [breach](GgLimitBreach): what was breached, and at what
/// value.
///
/// One sentence per ceiling rather than one generic template, because the five are measured in five
/// different units and a sentence that said "observed 5400 against a ceiling of 5400" would leave
/// the reader to guess whether that was turns, seconds or dollars.
fn breach_message(breach: &GgLimitBreach) -> String {
    match breach.limit {
        GgLimitKind::Turns => format!(
            "reached the {}-turn ceiling without the model finishing.",
            breach.threshold
        ),
        GgLimitKind::Runtime => format!(
            "wall-clock budget exceeded after {} turn(s); stopping.",
            breach.turns
        ),
        GgLimitKind::ConsecutiveErrors => format!(
            "{} consecutive turns failed to carry out the work they declared, reaching the \
             configured ceiling of {}; stopping rather than spending the rest of the run on the \
             same failure.",
            breach.observed, breach.threshold
        ),
        GgLimitKind::ErrorRate => format!(
            "{:.0}% of the last {} turns were errors, above the configured ceiling of {:.0}%; \
             stopping.",
            breach.observed * 100.0,
            breach.window.unwrap_or_default(),
            breach.threshold * 100.0
        ),
        GgLimitKind::Cost => format!(
            "the run has spent ${:.4}, at or above the configured ceiling of ${:.4}; stopping \
             before starting another turn.",
            breach.observed, breach.threshold
        ),
    }
}

/// The operator's `error` line for a **model call that failed**, rendered from the ending it
/// [really produced](TerminalStatus) rather than from the error on its own.
///
/// The error alone is not the whole account, and on one run in a thousand it is the wrong one. A
/// provider that refused, a credential that was rejected, a reply gg could not parse: read from
/// where the call stands, each of those is somebody else's failure, and that is what this line used
/// to say. On a run gg had **already broken** it is not — the turn beside it is recorded as gg's and
/// the agent ends `internal_error` — and a line that went on naming the provider left the operator's
/// own record of the event disagreeing with both of them. That is the same defect the
/// [attribution seam](attribution) closed for the record and for the [final text](ended_text), in
/// the one place a human reads first.
///
/// It matters more here than the phrasing of a log line usually would, because this is the only
/// ending a gg defect can stop an agent through that does **not** go via
/// [`stop_on_fault`](Agent::stop_on_fault): the fault is met inside the call rather than at the
/// boundary before it, so unless this line says gg broke, nothing on this agent's stream does — and
/// an agent's own stream is where a console reader looking at that agent is standing.
///
/// The underlying error is still printed on both paths. It is what gg actually observed, and an
/// operator debugging a defect that raced a request needs the symptom as much as the attribution.
fn model_call_failed(
    turn: usize,
    status: TerminalStatus,
    error_type: TurnErrorType,
    err: &ModelError,
) -> String {
    if status == STATUS_INTERNAL_ERROR {
        return format!(
            "gg had already broken this run when model turn {turn} failed, so the agent ends \
             `{STATUS_INTERNAL_ERROR}` — what the call itself reported ({}: {err}) is not \
             evidence about the model.",
            error_type.phrase(),
        );
    }
    format!("model turn {turn} failed — {}: {err}", error_type.phrase())
}

/// The operator's `error` line for a **timed-out model call** — the recoverable failure the loop
/// answers by recording an error turn and asking again, unlike [`model_call_failed`]'s, which end
/// the session. It says what happens next, because a timeout line that stopped at the symptom
/// would read like the run is over.
fn model_call_retried(turn: usize, err: &ModelError) -> String {
    format!(
        "model turn {turn} — {}: {err}; the turn will be retried (the error ceilings bound how \
         often).",
        err.turn_error_type().phrase(),
    )
}

/// The operator's `error` line for a **length-capped reply** the loop rejected whole: what came
/// back, what it cost, and that none of it reaches the context or the run's metrics.
fn length_capped_rejected(turn: usize, size: ResponseSize, response: &ModelResponse) -> String {
    format!(
        "model turn {turn} — length-capped reply rejected: the reply hit the provider's output \
         cap ({} characters, {} completion tokens{}); it never enters the context, its usage is \
         excluded from the run's metrics (tallied under rejected responses), and the turn will \
         be retried (the error ceilings bound how often).",
        size.chars,
        size.output_tokens,
        response
            .provider
            .as_deref()
            .map(|provider| format!("; provider: {provider}"))
            .unwrap_or_default(),
    )
}

/// This agent's [return value](LoopEnd::final_text) for a loop ending the model did **not** choose.
///
/// The two execution modes answer it differently, and the difference is the whole of
/// [`stopped_text`]'s reason for existing. In tool calling the last assistant message is a sentence,
/// and it has always been what a stopped agent hands back. Under
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) it is a page of program source.
///
/// The `status` is a [`TerminalStatus`] rather than a status word for the reason the code-mode half
/// makes obvious: on that path the text gg writes **names** the status, so a text rendered from
/// anything other than the value the record carries is a sentence that contradicts it — and it is a
/// sentence handed to a spawner's model, not merely written to a log.
fn ended_text(
    code_mode: bool,
    status: TerminalStatus,
    last_report: Option<&str>,
    last_text: Option<String>,
) -> Option<String> {
    if code_mode {
        stopped_text(status, last_report)
    } else {
        last_text
    }
}

/// This agent's return value when it was **stopped** rather than finished, under
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE).
///
/// Every assistant message on that path is a program, so the loop's `last_text` would
/// hand a subagent's spawner — and the run record — a page of source instead of an answer. This is the answer gg can honestly give instead: how the agent
/// ended, and what its last turn actually produced.
fn stopped_text(status: TerminalStatus, report: Option<&str>) -> Option<String> {
    Some(match report {
        Some(report) => format!("(agent ended: {status}; {report})"),
        None => format!("(agent ended: {status}; it produced no program)"),
    })
}

/// The resolved [ceilings](RunLimits) as the run **records** them on its session summary.
///
/// Every ceiling is written out exactly as it was in force: the
/// [parallelism cap](SubagentConfig::max_parallel) the run ran under, and each of the rest as
/// `None` when it is off — an unarmed error ceiling and an absent turn ceiling are recorded as the
/// unbounded settings they are. "What ceiling was this run under?" is answerable from the record
/// alone, and the answer is the document's, because there is nothing else it could have come
/// from.
fn recorded_limits(limits: &RunLimits, max_parallel: usize) -> GgRunLimits {
    GgRunLimits {
        max_parallel: Some(max_parallel as u64),
        max_turns: limits.max_turns.map(|turns| turns as u64),
        max_runtime_secs: limits.max_runtime.map(|budget| budget.as_secs()),
        max_consecutive_errors: limits.max_consecutive_errors.map(u64::from),
        max_error_rate: limits.error_rate.map(|rate| rate.max_rate),
        error_rate_window: limits.error_rate.map(|rate| rate.window as u64),
        max_cost: limits.max_cost,
        // Recorded on the same terms as the error ceilings: the capture ceiling in force is a fact
        // about the run, and a truncated record is far easier to read beside the number that
        // truncated it.
        replay_max_bytes: limits.replay_max_bytes,
    }
}

/// The context-accounting configuration threaded into the [turn loop](Agent::drive): the
/// [token estimator](TokenEstimator) and the active model's window limit. The per-turn
/// [`ContextBreakdown`](GgTelemetryKind::ContextBreakdown) and the
/// [message log](crate::message_log) are always emitted — context visibility is intrinsic,
/// not a capability that can be switched off.
struct ContextSetup {
    /// The estimator every context item is measured with. Shared (`Arc`) so it can back
    /// the async loop and, in later phases, spawned subagents.
    estimator: Arc<dyn TokenEstimator>,
    /// The active model's context-window limit in tokens, when known — the fullness
    /// denominator.
    window_limit: Option<u64>,
}

/// How many files the context-usage breakdown names for a profile that does not configure
/// [agent-managed context](CAPABILITY_AGENT_MANAGED_CONTEXT) at all — none, because a profile
/// without the capability is offered no `evict_file_view` and so is never shown the breakdown the
/// figure sizes.
const NO_FILE_VIEWS_NAMED: usize = 0;

/// The count the breakdown carries once [`PARAM_TOP_FILE_VIEWS`] has refused the launch. It is not
/// a size gg chose: the run it belongs to does not start, and the signal it would have sized names
/// no file.
const TOP_FILE_VIEWS_OF_A_REFUSED_LAUNCH: usize = 0;

/// The [threshold](PARAM_SIGNAL_THRESHOLD_PERCENT) carried by a profile that is shown no
/// context-usage signal at all — one without [agent-managed context](CAPABILITY_AGENT_MANAGED_CONTEXT),
/// and one that switches it off.
///
/// A window that is 0% full has reached it, so it is the widest reading there is, which is the only
/// honest one to hold a block nothing will ever render. It is named rather than written as a bare
/// `0` so the next reader of the line does not take it for an operator asking for a signal every
/// turn.
const THRESHOLD_OF_AN_UNSIGNALLED_AGENT: u64 = 0;

/// The agent-managed-context configuration threaded into the [turn loop](Agent::drive): whether the
/// capability is on, what this agent can actually do about its window, and the shared thread
/// [archive](ArchiveStore) that `archive_thread` fills and `search_archive` reads.
#[derive(Clone)]
struct AmcSetup {
    /// Whether the [agent-managed-context](CAPABILITY_AGENT_MANAGED_CONTEXT) capability is on.
    /// When on the loop injects the per-turn context-usage signal and applies the reclaim tools;
    /// off, it does neither (and the tools were never offered).
    enabled: bool,
    /// The shared thread archive the reclaim applies to. Bound to the same store the
    /// `search_archive` tool reads, so archived material is immediately searchable.
    archive: Arc<Mutex<ArchiveStore>>,
    /// That archive's [module id](crate::modules::Module::instance_id), so the
    /// [`ArchiveState`](GgTelemetryKind::ArchiveState) an archival emits is attributable to the
    /// module rather than only to the agent that happened to fill it — a successor searching an
    /// archive it inherited is holding this same instance.
    archive_id: String,
    /// Whether this agent actually has `evict_file_view` — read off the registry rather than assumed
    /// from the capability, so the per-file breakdown appears exactly when a call could act on it.
    can_evict: bool,
    /// The [program language](GgProgramLanguage) this agent writes in, or `None` when it is not in
    /// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) mode at all — how every reclaim call the
    /// context-usage signal names is spelled.
    program_language: Option<GgProgramLanguage>,
    /// Whether this agent actually holds `views.close` — read off its resolved grant rather than
    /// assumed from code mode, since closing a view is bought by this capability and granted by the
    /// allowlist like every other call, so the signal names it exactly when a program can make it.
    can_close_views: bool,
    /// Whether this agent actually has `archive_thread`. This is also what arms the per-result
    /// [turn headers](ContextModel::turn_header): the header exists to give an archival its turn
    /// numbers, so an agent that cannot archive should not be paying for one on every result.
    can_archive: bool,
    /// How many individual files the context-usage signal's file-view breakdown names, from this
    /// agent's [`PARAM_TOP_FILE_VIEWS`] param.
    top_file_views: usize,
    /// How full this agent's window has to be before it is shown the context-usage signal at all,
    /// from its [`PARAM_SIGNAL_THRESHOLD_PERCENT`] param.
    signal_threshold_percent: u64,
}

impl AmcSetup {
    /// Resolve the capability for `profile` against the toolset it was actually given, binding the
    /// shared `archive`.
    /// `code_language` is the agent's already-resolved [program language](CodeSetup::language),
    /// threaded in rather than resolved a second time from the same profile: the language is the
    /// axis a cross-language study slices on, so every consumer must read the one value the run
    /// recorded, not its own re-derivation of it.
    ///
    /// `granted_operations` is the agent's resolved responses-as-code grant, handed down for the
    /// reason the language is: the membrane, the surface and this signal must read one answer to
    /// what the agent holds.
    fn resolve(
        profile: &GgAgentConfig,
        registry: &ToolRegistry,
        archive: Arc<Mutex<ArchiveStore>>,
        archive_id: String,
        code_language: Option<GgProgramLanguage>,
        granted_operations: &[OperationId],
    ) -> Self {
        Self {
            enabled: profile.is_enabled(CAPABILITY_AGENT_MANAGED_CONTEXT),
            archive,
            archive_id,
            can_evict: registry.offers(EVICT_FILE_VIEW_TOOL),
            program_language: code_language,
            can_close_views: code_language.is_some()
                && granted_operations.contains(&crate::sandbox::VIEWS_CLOSE),
            can_archive: registry.offers(ARCHIVE_THREAD_TOOL),
            // Discarding: `resolve_top_file_views` read this same param at launch, with a collecting
            // sink, and refused the run if it named no count.
            top_file_views: resolve_top_file_views(
                profile,
                &mut crate::validate::LaunchReport::Discarding,
            ),
            // Discarding, on the same terms: `resolve_signal_threshold` read this same param at
            // launch with a collecting sink, and refused the run if it named no share gg can hold
            // the block back to.
            signal_threshold_percent: resolve_signal_threshold(
                profile,
                &mut crate::validate::LaunchReport::Discarding,
            ),
        }
    }

    /// What this agent's [context-usage signal](ContextModel::refresh_context_usage_signal) may say.
    fn signal_options(&self) -> UsageSignalOptions {
        UsageSignalOptions {
            can_evict: self.can_evict,
            program_language: self.program_language,
            can_close_views: self.can_close_views,
            can_archive: self.can_archive,
            top_file_views: self.top_file_views,
            threshold_percent: self.signal_threshold_percent,
        }
    }
}

/// How many individual files the [context-usage signal](ContextModel::refresh_context_usage_signal)
/// names, from `profile`'s [`PARAM_TOP_FILE_VIEWS`] param.
///
/// An enabled capability writes the figure, and one that does not is
/// [refused](crate::validate::required_positive_count_param) at the param's own locus: how many
/// reads a window holds at once differs enormously between an agent that opens two specifications
/// and one crawling a codebase, so there is no count gg could put here that would be the operator's.
/// A `0` is refused on the same terms — it leaves the signal telling an agent its window is full of
/// file reads and naming none of them, so the `evict_file_view` call it is being steered towards has
/// no path to take — as is a value gg cannot read as a count.
///
/// A profile that does not configure the capability, or switches it off, names
/// [no files at all](NO_FILE_VIEWS_NAMED) and is owed nothing: it is offered no `evict_file_view`,
/// so the breakdown this figure sizes is never put in front of it. What such a profile *does* write
/// is still read, so a `0` on the off arm of a comparison is heard about now rather than on the
/// launch that flips the switch.
fn resolve_top_file_views(
    profile: &GgAgentConfig,
    report: &mut crate::validate::LaunchReport,
) -> usize {
    let Some(capability) = profile.capability(CAPABILITY_AGENT_MANAGED_CONTEXT) else {
        return NO_FILE_VIEWS_NAMED;
    };
    let consequence = "a signal that names no file at all leaves the agent it is steering with \
                       nothing to evict";
    let declared = if capability.enabled {
        crate::validate::required_positive_count_param(
            &capability.params,
            CAPABILITY_AGENT_MANAGED_CONTEXT,
            PARAM_TOP_FILE_VIEWS,
            consequence,
            report,
        )
    } else {
        crate::validate::positive_count_param(
            &capability.params,
            CAPABILITY_AGENT_MANAGED_CONTEXT,
            PARAM_TOP_FILE_VIEWS,
            consequence,
            report,
        );
        return NO_FILE_VIEWS_NAMED;
    };
    declared.map_or(TOP_FILE_VIEWS_OF_A_REFUSED_LAUNCH, |top| {
        usize::try_from(top).unwrap_or(usize::MAX)
    })
}

/// How full an agent's window must be before it is shown the
/// [context-usage signal](ContextModel::refresh_context_usage_signal), from `profile`'s
/// [`PARAM_SIGNAL_THRESHOLD_PERCENT`] param.
///
/// **An absent param is [the default](DEFAULT_SIGNAL_THRESHOLD_PERCENT), not a refusal**, which is
/// the one place gg reads a silent document as a figure. The reason is that there is no useful
/// reading of "off" here: a threshold nobody wrote would have to mean either a block on every turn,
/// which is what the figure exists to stop, or no block at all, which switches off the capability's
/// own signal from a key that says nothing about it. The default is written into every new document
/// by the authoring catalog, so a run's record still names the share it was conducted under; what an
/// operator gains by leaving the key out is a document that does not have to have an opinion.
///
/// A value that *is* written is read on the ordinary terms, and one gg cannot read as a percentage
/// of the window refuses the launch. `0` is honoured: it is the block on every turn, which is what a
/// study of the signal itself is measuring.
///
/// A profile that does not configure the capability, or switches it off, is shown no signal at all,
/// so what it names is [never read](THRESHOLD_OF_AN_UNSIGNALLED_AGENT). What such a profile *does*
/// write is still read, so a `120` on the off arm of a comparison is heard about now rather than on
/// the launch that flips the switch.
fn resolve_signal_threshold(
    profile: &GgAgentConfig,
    report: &mut crate::validate::LaunchReport,
) -> u64 {
    let Some(capability) = profile.capability(CAPABILITY_AGENT_MANAGED_CONTEXT) else {
        return THRESHOLD_OF_AN_UNSIGNALLED_AGENT;
    };
    let declared = crate::validate::percent_param(
        &capability.params,
        CAPABILITY_AGENT_MANAGED_CONTEXT,
        PARAM_SIGNAL_THRESHOLD_PERCENT,
        report,
    );
    if !capability.enabled {
        return THRESHOLD_OF_AN_UNSIGNALLED_AGENT;
    }
    match declared {
        Some(percent) => percent,
        // Either the key is absent, which is the default, or it named a share gg cannot hold the
        // block back to — and that has already refused the launch, so the figure this hands back
        // sizes a signal no turn ever reads.
        None => DEFAULT_SIGNAL_THRESHOLD_PERCENT,
    }
}

/// What [`AUTOLOAD_PARAM_IMAGES`] reads as for a profile that seeds nothing — one with no
/// [autoload](CAPABILITY_AUTOLOAD_SPECS) capability, or one that switches it off. There is no
/// seeded mockup for the switch to be about, so the answer is not a picture rather than a figure
/// standing in for one nobody wrote.
const NO_PICTURES_SEEDED: bool = false;

/// What that param reads as once it has refused the launch. The run it belongs to does not start,
/// so the value seeds nothing; it is named rather than reached through `false` so the next reader
/// of the line can see it configures nothing.
const IMAGES_OF_A_REFUSED_LAUNCH: bool = false;

/// Whether the seeded views are [pinned](Retention::Pinned) once the `implementation` naming an arm
/// gg does not offer has refused the launch. Read on the terms [`IMAGES_OF_A_REFUSED_LAUNCH`] is:
/// the run does not start, so nothing is seeded to be pinned or dropped, and the name is what says
/// so at the one line where a bare `false` would read as the unlocked arm.
const LOCK_OF_A_REFUSED_LAUNCH: bool = false;

/// Whether — and how — an agent's opening context is seeded with the test case's
/// [provided files](Orchestrator::provided_files), the
/// [autoload-specifications](CAPABILITY_AUTOLOAD_SPECS) capability.
///
/// Resolved per agent from its own profile (autoload is a per-agent capability), so a run can
/// front-load the whole spec for one agent and let another read what it needs.
#[derive(Debug, Clone, Copy)]
struct AutoloadSetup {
    /// Whether this agent front-loads the provided files. When off, the agent opens with only the
    /// build prompt and reads what it needs itself.
    enabled: bool,
    /// Whether the autoloaded views are **locked** — [pinned](Retention::Pinned) into the window,
    /// kept verbatim across every [compaction] boundary and immune to
    /// [eviction](ContextModel::evict_file_views). Off, they are ordinary ephemeral file reads that
    /// compaction may summarize and agent-managed context may evict.
    locked: bool,
    /// Whether a seeded reference mockup is attached as a **picture**. Off it arrives as the
    /// description any read produces — label, format, byte size — and the model reads the file
    /// itself when it wants to look. An attached picture is charged by its dimensions and charged
    /// again on every request the view survives.
    images: bool,
}

impl AutoloadSetup {
    /// Resolve the autoload behavior from `profile`: on when it enables
    /// [`CAPABILITY_AUTOLOAD_SPECS`], and **locked** when that capability's
    /// [implementation](GgAgentConfig::capability) is [`AUTOLOAD_LOCKED_IMPL`].
    ///
    /// The lever has one value, so writing nothing is a **declaration** rather than a silence: it
    /// says the seeded specifications are ordinary ephemeral file reads, which compaction may
    /// summarize and agent-managed context may evict. Both states are writable and both are meant,
    /// which is why this is the one arm in gg an enabled capability may leave unnamed. Anything
    /// *else* is [reported](crate::validate) and refuses the launch: `lock`, `Locked` and `pinned`
    /// are not this arm, and the exact-match comparison that decides it would otherwise read every
    /// one of them as *unlocked*, running the droppable arm on a launch that asked for the pinned
    /// one.
    fn resolve(profile: &GgAgentConfig, report: &mut crate::validate::LaunchReport) -> Self {
        let enabled = profile.is_enabled(CAPABILITY_AUTOLOAD_SPECS);
        let locked = match profile
            .capability(CAPABILITY_AUTOLOAD_SPECS)
            .and_then(|capability| capability.implementation.as_deref())
            .map(str::trim)
        {
            Some(AUTOLOAD_LOCKED_IMPL) => true,
            None | Some("") => false,
            Some(other) => {
                report.report(
                    crate::validate::LaunchDefect::run_level(
                        crate::validate::implementation_locus(CAPABILITY_AUTOLOAD_SPECS),
                        other,
                        format!(
                            "the `{CAPABILITY_AUTOLOAD_SPECS}` capability has one lever, and \
                             `{other}` is not it; reading it as the default would leave the \
                             seeded specifications droppable on a run that asked for them pinned."
                        ),
                    )
                    .known([AUTOLOAD_LOCKED_IMPL]),
                );
                LOCK_OF_A_REFUSED_LAUNCH
            }
        };
        let images = Self::resolve_images(profile, report);
        // The switch decides whether anything is autoloaded at all; the implementation and the
        // params are read either way, so a typo on a profile that has the capability switched off
        // is still a typo an operator hears about now.
        Self {
            enabled,
            locked: enabled && locked,
            images: enabled && images,
        }
    }

    /// Whether `profile` asks autoload to attach a seeded mockup as a picture, from the
    /// [`images`](AUTOLOAD_PARAM_IMAGES) param.
    ///
    /// An enabled capability writes it, and one that writes none is
    /// [refused](crate::validate::required_param): what a seeded mockup costs and what the model
    /// can do with it both turn on this switch, and gg picks neither side of it. A profile with no
    /// autoload capability, or one that switches it off, seeds nothing at all, so there is no
    /// picture for the switch to be about and nothing is owed; a value written on the off arm is
    /// still read.
    ///
    /// A switch is a boolean, and a value that is not one is [reported](crate::validate) rather
    /// than read as `false`. Reading `"true"` as *off* would seed the run's opening context with
    /// captions on a launch that asked for pictures, and the record would name the arm that did
    /// not run.
    fn resolve_images(profile: &GgAgentConfig, report: &mut crate::validate::LaunchReport) -> bool {
        let Some(capability) = profile.capability(CAPABILITY_AUTOLOAD_SPECS) else {
            return NO_PICTURES_SEEDED;
        };
        let declared = if capability.enabled {
            let Some(declared) = crate::validate::required_param(
                &capability.params,
                CAPABILITY_AUTOLOAD_SPECS,
                AUTOLOAD_PARAM_IMAGES,
                report,
            ) else {
                return IMAGES_OF_A_REFUSED_LAUNCH;
            };
            declared
        } else {
            let Some(declared) = capability
                .params
                .get(AUTOLOAD_PARAM_IMAGES)
                .filter(|value| !value.is_null())
            else {
                return NO_PICTURES_SEEDED;
            };
            declared
        };
        match declared.as_bool() {
            Some(images) => images,
            None => {
                report.report(
                    crate::validate::LaunchDefect::run_level(
                        crate::validate::param_locus(
                            CAPABILITY_AUTOLOAD_SPECS,
                            AUTOLOAD_PARAM_IMAGES,
                        ),
                        crate::validate::as_written(declared),
                        format!(
                            "the `{CAPABILITY_AUTOLOAD_SPECS}` capability's \
                             `{AUTOLOAD_PARAM_IMAGES}` switches picture attachment on or off, so \
                             gg reads it as `true` or `false`; reading this as `false` would seed \
                             the opening context with captions on a run that asked for pictures."
                        ),
                    )
                    .known(["true", "false"]),
                );
                IMAGES_OF_A_REFUSED_LAUNCH
            }
        }
    }
}

/// How a run conducts its turns when [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) is on: the
/// run-wide mode flag and the per-program [sandbox ceilings](SandboxLimits).
///
/// Resolved once on the [orchestrator](Orchestrator) and handed to every agent, because these are
/// properties of *how a turn is conducted*, not of one agent — and grouped into one struct
/// because a loop that took them separately would let two of them disagree at a call site.
#[derive(Debug, Clone, Copy)]
struct CodeSetup {
    /// Whether the capability is on. When off, nothing in [`crate::sandbox`] is reachable at all
    /// and the loop drives ordinary tool calling.
    enabled: bool,
    /// The [language](GgProgramLanguage) this agent writes its programs in — which decides how a
    /// reply is prepared, which prebuilt guest evaluates it, and how the SDK the prompt describes
    /// spells its functions.
    ///
    /// Per-agent, like everything else here: responses-as-code is a per-agent capability, so one
    /// run may drive its root in one language and a reviewer in another. Meaningless — and never
    /// read — when [`enabled`](Self::enabled) is false.
    language: GgProgramLanguage,
    /// The execution timeout and linear-memory cap one program runs under, resolved from the
    /// capability's `timeoutSecs` / `maxMemoryBytes` params with their defaults.
    limits: SandboxLimits,
    /// Which SDK types an [`openDocsView`](crate::docs::DocsRuntime) of a function opens beside it —
    /// its return position, that plus its arguments, or none at all.
    ///
    /// Per agent, beside the language, and for the same reason: both are arms of the same study, and
    /// one run may hold two agents at two languages and two modes.
    doc_view_types: DocViewTypes,
}

/// Fire the [pre-compact](GgHookEvent::PreCompact) hooks and report whether the run may continue.
///
/// Separated from its `post` twin rather than wrapping the compaction in one call because the two
/// sit on opposite sides of a rewrite of the very window a hook might insert into — there is no
/// scope that holds both. The `pre` side can neither block nor insert (see [`GgHookEvent`]), so all
/// it can return is whether its own machinery survived.
async fn fire_pre_compact(
    hooks: &HooksSetup,
    strategy: &str,
    tool_ctx: &ToolContext,
    offload: &OffloadPolicy,
    emitter: &Emitter,
) -> Result<(), HookFailure> {
    if !hooks.runtime.has(GgHookEvent::PreCompact) {
        return Ok(());
    }
    hooks
        .runtime
        .fire(
            GgHookEvent::PreCompact,
            &hooks.agent,
            json!({ "strategy": strategy }),
            tool_ctx,
            offload,
            emitter,
        )
        .await
        .map(|_| ())
}

/// Fire the [post-compact](GgHookEvent::PostCompact) hooks and push whatever they said into the
/// freshly rewritten window.
///
/// The insertion goes in **pinned**, unlike every other hook's: this is the one event whose whole
/// point is to put back something the compaction just dropped, and an ephemeral note would be
/// dropped again by the next one.
async fn fire_post_compact(
    hooks: &HooksSetup,
    strategy: &str,
    context: &mut ContextModel,
    tool_ctx: &ToolContext,
    offload: &OffloadPolicy,
    emitter: &Emitter,
) -> Result<(), HookFailure> {
    if !hooks.runtime.has(GgHookEvent::PostCompact) {
        return Ok(());
    }
    let run = hooks
        .runtime
        .fire(
            GgHookEvent::PostCompact,
            &hooks.agent,
            json!({ "strategy": strategy }),
            tool_ctx,
            offload,
            emitter,
        )
        .await?;
    if let Some(insertion) = run.insertion() {
        context.push(
            GgContextSource::System,
            Retention::Pinned,
            Message::user(insertion),
        );
    }
    Ok(())
}

/// End this agent's loop — **and the run** — because gg could not stand the agent up as its
/// configuration describes it.
///
/// The counterpart to [`hook_failed`] for our own defects rather than an operator's script, and the
/// same shape for the same reason: setting an agent up asks several questions that can only be
/// answered once the workspace and the spawner are real (does this profile's system prompt render
/// against this context? did the specifications the capability promises actually arrive?), and each
/// of them has to end the same way. Not by carrying on with a substitute, which is the thing this
/// whole remediation deletes: an agent running under gg's built-in prompt while its profile names an
/// override, or opening on half a specification, produces a tree indistinguishable from a clean one
/// and is scored as though it were.
///
/// So: the detail on this agent's stream, the run's [fault latch](crate::fault) raised so every
/// other agent winds down at its next turn boundary, and [`STATUS_INTERNAL_ERROR`] — which keeps a
/// failure the model never touched out of the model's column of the run's attribution data.
///
/// **The message does not say whose fault it is**, because this seam cannot know. Two of the three
/// things that end here are answers to a *configuration*: a system prompt override that will not
/// render is the operator's Handlebars, and a [bootstrap](crate::bootstrap) program the sandbox
/// refuses to start is very often the operator's own [`SandboxLimits`] — a `maxMemoryBytes` under
/// the guest engine's floor stops every program this agent would ever run, gg's included. Telling
/// an operator "this is a gg defect, not a problem with the configuration" over their own memory
/// cap sends them to read gg's source about a number they set. The `detail` names what actually
/// failed; this sentence adds only the part that is true of all three — that gg stops rather than
/// substituting.
fn setup_broke(
    agent: &Agent,
    emitter: &Emitter,
    limits: &LimitsSetup,
    turns: usize,
    detail: impl std::fmt::Display,
) -> LoopEnd {
    let detail = detail.to_string();
    emitter.emit(log(
        "error",
        format!(
            "{detail}. gg could not stand this agent up as it is configured: this agent's loop \
             ends here — and the run with it — rather than running it under something other than \
             what it was configured as."
        ),
    ));
    limits.fault.in_agent(&agent.id, &agent.profile_id, &detail);
    LoopEnd {
        status: TerminalStatus::attributed(STATUS_INTERNAL_ERROR, limits),
        turns,
        tokens: TokenCounts::default(),
        cost: None,
        profile_id: agent.profile_id.clone(),
        final_text: Some(detail),
        ending: None,
        limit: None,
        handoff: None,
    }
}

/// End this agent's loop because one of the run's [hooks](crate::hooks) broke.
///
/// A single exit written once, because a hook can fail at four points in the loop (an opening hook,
/// a dispatch hook, an ending hook, a compaction hook) and every one of them has to produce the
/// same terminal shape: the failure named on the operator log, and a [`LoopEnd`] carrying
/// [`STATUS_HOOK_ERROR`] so the run is recorded as stopped by its own machinery rather than by the
/// model.
///
/// An operator's broken script is still a **failure** ending, so on a run gg had already broken it
/// is [attributed](attribution) to gg like any other: a hook that failed while the run was winding
/// down is a script gg stopped feeding, and its exit code is not what disqualified this run.
fn hook_failed(
    agent: &Agent,
    emitter: &Emitter,
    limits: &LimitsSetup,
    failure: HookFailure,
    turns: usize,
) -> LoopEnd {
    emitter.emit(log("error", failure.to_string()));
    LoopEnd {
        status: TerminalStatus::attributed(STATUS_HOOK_ERROR, limits),
        turns,
        tokens: TokenCounts::default(),
        cost: None,
        profile_id: agent.profile_id.clone(),
        final_text: Some(failure.to_string()),
        ending: None,
        limit: None,
        handoff: None,
    }
}

/// What the model is told when an [agent-stop](GgHookEvent::AgentStop) hook refuses its ending.
///
/// The hook's reason leads, because it is the actionable half — what to fix. The sentence gg adds
/// after it is the part the hook cannot know: that the session is *not* over and declaring again is
/// how it ends. Without that, a model handed a bare refusal reasonably concludes it has been stopped.
fn ending_blocked_feedback(reason: &str, insertion: Option<String>) -> String {
    let mut message = format!(
        "{reason}\n\nThe session is NOT over. Fix what is described above and declare the \
         session done again."
    );
    if let Some(insertion) = insertion {
        message.push_str("\n\n");
        message.push_str(&insertion);
    }
    message
}

/// Dispatch one tool call with the run's [hooks](crate::hooks) around it — the `pre`/`post` pairs
/// for a file write and a shell command.
///
/// Fired **here**, at the loop's dispatch choke point, rather than inside the tools themselves, for
/// the same reason session capture is: it is the one place every dispatched call passes through with
/// its arguments and its outcome, so one decorator covers `write_file`, `edit_file` and `shell`
/// alike — and covers them identically on the [responses-as-code](crate::sandbox) path, whose
/// programs funnel into the same registry. A hook fired from inside a tool would also have no
/// emitter, no offloading policy and no agent identity to report with, all of which live out here.
///
/// A `pre-` hook that blocks turns the call into a **refusal**, in the model's own error vocabulary:
/// nothing runs, and the reason the hook gave is what the model reads. That is deliberately
/// indistinguishable from any other refusal — a hook is the operator's, and explaining gg's
/// configuration to the model would teach it to argue with it.
async fn dispatch_hooked(
    registry: &ToolRegistry,
    call: &ToolCall,
    tool_ctx: &ToolContext,
    hooks: &HooksSetup,
    offload: &OffloadPolicy,
    emitter: &Emitter,
) -> Result<ToolOutcome, HookFailure> {
    let Some(shape) = HookedCall::of(call, tool_ctx) else {
        return Ok(registry.dispatch(call, tool_ctx).await);
    };
    if hooks.runtime.has(shape.pre) {
        let run = hooks
            .runtime
            .fire(
                shape.pre,
                &hooks.agent,
                shape.payload.clone(),
                tool_ctx,
                offload,
                emitter,
            )
            .await?;
        if let Some(reason) = run.blocked.clone() {
            return Ok(ToolOutcome::failed(
                ToolFailure::Refused,
                match run.insertion() {
                    Some(insertion) => format!("{reason}\n\n{insertion}"),
                    None => reason,
                },
            ));
        }
        if let Some(insertion) = run.insertion() {
            // An insertion from a `pre-` hook rides out on the call it preceded, which is the only
            // message this turn has left to carry it: the call is about to run, and a separate
            // message would arrive after its result.
            let mut outcome = registry.dispatch(call, tool_ctx).await;
            outcome.output = format!("{}\n\n{insertion}", outcome.output);
            return post_hooked(outcome, &shape, hooks, tool_ctx, offload, emitter).await;
        }
    }
    let outcome = registry.dispatch(call, tool_ctx).await;
    post_hooked(outcome, &shape, hooks, tool_ctx, offload, emitter).await
}

/// Fire the `post-` half of a [hooked call](HookedCall) and fold whatever it said into `outcome`.
///
/// A `post-` hook cannot block — the operation already happened — so its only effect is on what the
/// model reads, which is why this returns the outcome rather than a verdict.
async fn post_hooked(
    mut outcome: ToolOutcome,
    shape: &HookedCall,
    hooks: &HooksSetup,
    tool_ctx: &ToolContext,
    offload: &OffloadPolicy,
    emitter: &Emitter,
) -> Result<ToolOutcome, HookFailure> {
    if !hooks.runtime.has(shape.post) {
        return Ok(outcome);
    }
    // The post payload carries how the operation went alongside what it was, so a hook watching a
    // shell command can tell a passing build from a failing one without re-running it.
    let mut payload = shape.payload.clone();
    if let Some(fields) = payload.as_object_mut() {
        fields.insert("ok".into(), json!(outcome.ok));
    }
    let run = hooks
        .runtime
        .fire(
            shape.post,
            &hooks.agent,
            payload,
            tool_ctx,
            offload,
            emitter,
        )
        .await?;
    if let Some(insertion) = run.insertion() {
        outcome.output = format!("{}\n\n{insertion}", outcome.output);
    }
    Ok(outcome)
}

/// A tool call gg has hooks for, reduced to the pair of events it fires and the payload they carry.
///
/// The mapping from a tool to an event lives here, in one `match`, rather than being spread across
/// the tools: "a file write of any kind" is a claim about gg's whole toolset, and a new writing tool
/// that forgot to fire its hook would be a gate quietly not applying to one of the ways a file gets
/// written.
struct HookedCall {
    /// The event that fires before the call.
    pre: GgHookEvent,
    /// The event that fires after it.
    post: GgHookEvent,
    /// What the call is about: the path and contents for a write, the command line for a shell call.
    payload: Value,
}

impl HookedCall {
    /// The events and payload for `call`, or `None` for a tool gg has no hooks around.
    ///
    /// An `edit_file` is a **write**, and its payload is the contents the file will end up with
    /// rather than the patch that gets it there — because a hook asked "may this be written?" needs
    /// the answer to be about the file, and a patch is only about the file if you already have it.
    /// gg reads the file and applies the replacement to answer that, which is a read the write was
    /// about to do anyway.
    fn of(call: &ToolCall, ctx: &ToolContext) -> Option<Self> {
        let arg = |key: &str| {
            call.arguments
                .get(key)
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        };
        match call.name.as_str() {
            SHELL_TOOL => Some(Self {
                pre: GgHookEvent::PreShell,
                post: GgHookEvent::PostShell,
                payload: json!({ "command": arg("command") }),
            }),
            "write_file" => {
                let path = arg("path");
                Some(Self {
                    pre: GgHookEvent::PreWrite,
                    post: GgHookEvent::PostWrite,
                    payload: json!({
                        "path": absolute_workspace_path(ctx, &path),
                        "contents": arg("contents"),
                    }),
                })
            }
            "edit_file" => {
                let path = arg("path");
                let absolute = absolute_workspace_path(ctx, &path);
                // Best-effort: an unreadable file, or a replacement that does not apply, is a call
                // the tool is about to refuse anyway. The hook is shown what gg knows — the path,
                // and the contents when they can be computed — rather than nothing at all.
                let contents = std::fs::read_to_string(&absolute)
                    .ok()
                    .map(|body| body.replacen(&arg("old"), &arg("new"), 1));
                Some(Self {
                    pre: GgHookEvent::PreWrite,
                    post: GgHookEvent::PostWrite,
                    payload: json!({ "path": absolute, "contents": contents }),
                })
            }
            _ => None,
        }
    }
}

/// A tool's workspace-relative `path` argument as the absolute path a hook is promised.
///
/// Absolute because a hook is a run-level declaration and a path is only meaningful with the tree it
/// is in: two agents working the same issue in different worktrees write the same relative path to
/// different files, and a hook shown `src/main.rs` could not tell them apart.
fn absolute_workspace_path(ctx: &ToolContext, path: &str) -> String {
    let path = Path::new(path);
    if path.is_absolute() {
        path.to_string_lossy().into_owned()
    } else {
        ctx.workspace_dir.join(path).to_string_lossy().into_owned()
    }
}

/// The [hooks](crate::hooks) as one agent instance sees them: the two runtimes that can fire on its
/// behalf, and its own identity within them.
///
/// The identity travels with the runtimes because a hook's payload is half declaration (which hooks
/// exist) and half instance (who is writing the file). Pairing them here is what makes every firing
/// site a call that cannot be given a mismatched pair.
struct HooksSetup {
    /// This agent's **profile's** own hooks — the eight [agent events](crate::hooks). Shared by
    /// every instance of the profile, and different from the next profile's.
    runtime: Arc<HookRuntime>,
    /// The **run's** session hooks. Carried by every instance but fired by only one — the root, on
    /// its first incarnation — because the alternative is passing the orchestrator down to the one
    /// firing site that needs it.
    session: Arc<HookRuntime>,
    /// Who this instance is: its id, its profile, the role it was dispatched in, and its worktree.
    agent: HookAgent,
}

/// Which [kind](GgHookAgentKind) of agent an instance is, from the role it was dispatched in.
///
/// The role rather than the profile, because that is the distinction a hook author actually wants:
/// the same profile implements an issue in one dispatch and reviews one in the next, and "block a
/// reviewer that approves without reading the diff" is meaningless if it also fires on the
/// implementer. A parentless [`Sub`](AgentRole::Sub) cannot occur — a subagent has a spawner — so
/// the root test is only asked of the roles that can be either.
fn hook_agent_kind(role: &AgentRole, is_root: bool) -> GgHookAgentKind {
    match role {
        AgentRole::Root => GgHookAgentKind::Root,
        AgentRole::Issue { .. } => GgHookAgentKind::IssueImplementer,
        // A reviewer is dispatched as a subagent carrying the review [ending role](EndingRole), so
        // that — not its position in the tree — is what tells the two apart.
        AgentRole::Sub {
            ending: EndingRole::Review,
            ..
        } => GgHookAgentKind::IssueReviewer,
        AgentRole::Sub { .. } if is_root => GgHookAgentKind::Root,
        AgentRole::Sub { .. } => GgHookAgentKind::Subagent,
    }
}

/// Everything the [turn loop](Agent::drive) is *configured* by, as opposed to everything it holds.
///
/// The distinction it draws is the one the [module model](crate::modules) rests on. A
/// [`ModuleSet`] is **state**: it is cloned, shared and handed from one agent instance to the next,
/// and the loop mutates it all session. A `DriveSetup` is **resolved configuration**: every field
/// is a pure function of the agent's profile, its model and its dispatched role, so an agent that
/// succeeds another re-resolves the whole struct rather than inheriting any of it. Nothing here is
/// ever transferred.
///
/// It exists because the alternative — and what this replaced — is a twenty-six-parameter method
/// whose reader cannot tell which arguments are the agent's working state and which are the knobs
/// it was launched with.
struct DriveSetup {
    /// Every [ceiling](RunLimits) this agent is bounded by, plus the run-wide spend and the
    /// cancellation watch checked on the same terms.
    limits: LimitsSetup,
    /// Whether and how the thread [compacts](crate::compaction) when the window fills.
    compaction: CompactionSetup,
    /// The [agent-managed-context](CAPABILITY_AGENT_MANAGED_CONTEXT) configuration: the per-turn
    /// usage signal and what this agent may do about its own window.
    amc: AmcSetup,
    /// Whether the test case's provided specifications seed the opening context, and whether they
    /// are pinned across compaction.
    autoload: AutoloadSetup,
    /// This agent's [persistence]: whether its instances are serialized and carry their open file
    /// views between them.
    persistence: PersistenceSetup,
    /// How much of a file one `read_file` returns, or `None` when this agent has no
    /// [read-file](test_cabinet_core::gg::CAPABILITY_READ_FILE) capability at all and so is offered
    /// no `read_file` to bind a policy to.
    read_policy: Option<ReadPolicy>,
    /// How much of a command's output one `shell` call returns.
    shell_offload: OffloadPolicy,
    /// Whether this agent answers with programs rather than tool calls, and the sandbox
    /// ceilings behind that.
    code: CodeSetup,
    /// The run's [discovery warning latch](crate::discovery), shared by every agent.
    ///
    /// Resolved configuration is what this struct holds, and this is the one field that is not: it
    /// is a run-wide latch, cloned in here for the same reason the [fault latch](FaultLatch) is
    /// carried on [`LimitsSetup`] — the loop is where the condition is met, and the seam that meets
    /// it has no other handle on the run. It carries no configuration and decides nothing about how
    /// the agent runs; all it decides is whether the operator has already been told.
    discovery: DiscoveryWarning,
    /// The run's [hooks](crate::hooks), and who this agent is to them.
    ///
    /// Carried on the setup rather than reached through the orchestrator because the loop fires
    /// them at points the orchestrator never sees — around one tool call, around one compaction —
    /// and because a fired hook has to name the *instance*, which only the loop knows.
    hooks: HooksSetup,
    /// Which [ending calls](EndingRole) this agent is given, from the role it was dispatched in.
    ending_role: EndingRole,
    /// How this incarnation's window is [opened](Opening) — seeded fresh, or continued from the
    /// instance it succeeds.
    opening: Opening,
    /// The [program library](crate::programs) a succession moved, or a fork cloned, to this
    /// incarnation — `None` for an agent's first incarnation. Adopted after this incarnation has
    /// resolved its own library from its own profile.
    carried_programs: Option<crate::programs::ProgramLibrary>,
    /// How many turns this agent has already taken across its earlier incarnations, and therefore
    /// the number its next turn is the successor of.
    ///
    /// It is one figure serving two purposes, which is why it is a single field. It numbers the
    /// turns the window is tagged with, so a transferred thread's `Turn #37` is still turn 37 after
    /// the handoff and an `archive_thread` naming it still means the same span. And it is the point
    /// the [turn ceiling](RunLimits::max_turns) counts from, so a succession spends **one** turn
    /// budget between its incarnations rather than one each — a machine with five states is not
    /// five times the run.
    turn_base: usize,
    /// The [replay](crate::capture) recorder, when the capability is on.
    replay: Option<Arc<GgRecorder>>,
}

/// The [execution ceilings](RunLimits) threaded into the [turn loop](Agent::drive), together with
/// the run-wide [spend](RunSpend) the cost ceiling is measured against and the absolute instant the
/// wall-clock budget expires at.
///
/// The ceilings and the deadline are values every agent enforces identically; the spend is
/// **shared**, because a cost ceiling bounds the run rather than the agent. That split is the whole
/// of the per-agent/run-wide distinction in one struct — and putting the turn ceiling and the
/// deadline here rather than beside it is what makes this the single home for every ceiling gg has.
#[derive(Debug, Clone)]
struct LimitsSetup {
    /// The resolved ceilings, identical for every agent in the run.
    limits: RunLimits,
    /// When the run's wall-clock budget expires, or `None` when it declared none — derived from
    /// [`limits.max_runtime`](RunLimits::max_runtime), and `Some` exactly when that is. An absolute
    /// instant rather than a duration, so every agent measures the same session start rather than
    /// its own.
    deadline: Option<Instant>,
    /// The run's shared accumulated spend, added to at each agent's model-response site and read at
    /// each agent's turn boundary.
    spend: Arc<RunSpend>,
    /// The host's [cancellation watch](crate::cancel), read at each agent's turn boundary alongside
    /// the two run-wide ceilings. Not a ceiling — nothing is measured and nothing is breached — but
    /// enforced on identical terms, which is why it travels with them rather than beside them.
    cancel: CancelWatch,
    /// The run's [internal-fault latch](crate::fault), read at the same boundary as the watch above
    /// for the same reason: it is a run-wide condition every agent stops itself on, and the only
    /// thing that varies between the two is who decided the run should stop.
    fault: FaultLatch,
    /// The run's [ceiling latch](CeilingLatch), a clone of the orchestrator's, **written** by the
    /// one site that ends an agent on a breach rather than read at a boundary.
    ///
    /// It travels with the ceilings because it is the run-wide half of them: the four fields above
    /// say what each agent measures, and this is where the answer any of them reached becomes the
    /// run's. Nothing in the loop reads it; the session epilogue does.
    ceiling: CeilingLatch,
}

/// One read of the run's wall-clock deadline, as a
/// [`Clock`](test_cabinet_core::gg_session_record::GgSessionEntryKind::Clock) entry carries it.
struct ClockRead {
    /// How long the session had been running when the boundary read the clock.
    elapsed_ms: u64,
    /// How much of the budget was left, `0` once the deadline is behind.
    remaining_ms: Option<u64>,
}

impl LimitsSetup {
    /// The [breach](GgLimitBreach) to stop `agent_id` on if the run has already spent its
    /// [cost ceiling](RunLimits::max_cost) — the turn-boundary check, on exactly the same terms as
    /// the deadline check beside it.
    fn check_cost(&self, agent_id: &str, turns: u64) -> Option<GgLimitBreach> {
        self.limits.check_cost(&self.spend, agent_id, turns)
    }

    /// One read of the run's wall-clock deadline, for the [session record](crate::capture) — or
    /// `None` when the run declared no wall-clock budget, in which case the loop reads no clock at
    /// all and a record that carried one would be inventing it.
    ///
    /// Derived from the same two values [`check_deadline`](Self::check_deadline) branches on, so
    /// the recorded observation and the breach that a later boundary may raise cannot describe
    /// different moments. `Instant` is monotonic and unrelated to any wall clock, which is why the
    /// record carries "how far in" rather than a timestamp: the elapsed figure is the only part of
    /// a clock read that means anything to a reconstruction.
    fn read_clock(&self) -> Option<ClockRead> {
        let budget = self.limits.max_runtime?;
        let deadline = self.deadline?;
        let now = Instant::now();
        let remaining = deadline.saturating_duration_since(now);
        // Exactly one of the two saturating terms is non-zero, so this is `budget - remaining`
        // before the line and `budget + overrun` after it — the same reconstruction
        // `check_deadline` records as its `observed`.
        let elapsed = (budget + now.saturating_duration_since(deadline)).saturating_sub(remaining);
        Some(ClockRead {
            elapsed_ms: elapsed.as_millis() as u64,
            remaining_ms: Some(remaining.as_millis() as u64),
        })
    }

    /// The [breach](GgLimitBreach) to stop `agent_id` on if the run's wall-clock budget is spent.
    ///
    /// `observed` is the elapsed wall clock rather than the budget, reconstructed as the budget plus
    /// however far past the deadline this boundary landed: a turn that began just under the line and
    /// ran for ten minutes overran by ten minutes, and recording the threshold as the observation
    /// would report every timed-out run as having stopped exactly on time.
    fn check_deadline(&self, agent_id: &str, turns: u64) -> Option<GgLimitBreach> {
        let budget = self.limits.max_runtime?;
        let deadline = self.deadline?;
        let now = Instant::now();
        (now >= deadline).then(|| GgLimitBreach {
            limit: GgLimitKind::Runtime,
            threshold: budget.as_secs_f64(),
            observed: (budget + now.saturating_duration_since(deadline)).as_secs_f64(),
            turns,
            agent_id: agent_id.to_string(),
            window: None,
        })
    }
}

/// Which of the two [agent-managed-context](CAPABILITY_AGENT_MANAGED_CONTEXT) reclaims a call asked
/// for — the one thing [`apply_context_reclaim`] has to be told, named in gg's own terms rather than
/// in either surface's.
///
/// It exists because the reclaim is reached from **both** of gg's model-facing surfaces and neither
/// of their vocabularies is the other's: a tool-calling agent asks by emitting `evict_file_view`, a
/// program asks by calling the `context.evict_file_view` operation, and the two are related only by
/// arriving at the same window. Each surface maps its own names onto this enum, once, and everything
/// past that point is written in terms of the reclaim itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ContextReclaim {
    /// Drop file views from the live window — every one, or the ones for one path.
    EvictFileView,
    /// Move whole turns of the thread out of the live window and into the shared archive.
    ArchiveThread,
}

impl ContextReclaim {
    /// The reclaim the **tool** named `name` performs, or `None` for a name that is not one of the
    /// two. `search_archive` is deliberately not one: it only reads the archive, in its own
    /// `invoke`, and touches the live window not at all.
    fn of_tool(name: &str) -> Option<Self> {
        match name {
            EVICT_FILE_VIEW_TOOL => Some(Self::EvictFileView),
            ARCHIVE_THREAD_TOOL => Some(Self::ArchiveThread),
            _ => None,
        }
    }

    /// The reclaim the **operation** `id` performs — [`of_tool`](Self::of_tool) asked of the API
    /// surface, over that surface's own vocabulary.
    fn of_operation(id: OperationId) -> Option<Self> {
        match id {
            sandbox::CONTEXT_EVICT_FILE_VIEW => Some(Self::EvictFileView),
            sandbox::CONTEXT_ARCHIVE_THREAD => Some(Self::ArchiveThread),
            _ => None,
        }
    }
}

/// Apply an agent-managed-context `reclaim` to the live `context`: perform it, rewrite `outcome`
/// with what was reclaimed (the call itself only validated its arguments), and return the
/// [`ContextManaged`](GgTelemetryKind::ContextManaged) effect event to emit.
///
/// The rewrite carries a [`ApiData::Reclaim`] sidecar as well as the prose, because this is the
/// **only** producer of one: the two reclaim calls return an outcome with no data at all, so a
/// [code program](crate::sandbox)'s `evictFileView` would otherwise be handed nothing to compute
/// with. The numbers and the sentence come from the same locals, so they cannot disagree.
///
/// The reclaim runs **here**, in the loop, because it mutates the context window a tool cannot hold.
/// `args` is the request as the calling surface stated it, already validated by the call that
/// produced it — so the shared parsers are re-run with their defaults on the (unreachable) error
/// path rather than failing.
fn apply_context_reclaim(
    context: &mut ContextModel,
    archive: &Arc<Mutex<ArchiveStore>>,
    archive_id: &str,
    reclaim: ContextReclaim,
    args: &Value,
    outcome: &mut ToolOutcome,
) -> Vec<GgTelemetryKind> {
    match reclaim {
        ContextReclaim::EvictFileView => {
            let path = parse_evict_path(args).unwrap_or(None);
            let result = context.evict_file_views(path.as_deref());
            let detail = if result.items == 0 {
                match &path {
                    Some(path) => format!("No file views for `{path}` were in context to evict."),
                    None => "No file views were in context to evict.".to_string(),
                }
            } else {
                let where_ = if result.paths.is_empty() {
                    String::new()
                } else {
                    format!(" ({})", result.paths.join(", "))
                };
                format!(
                    "Evicted {} file view(s){where_}, reclaiming ~{} tokens. You can re-read \
                     these files with read_file if you need them again.",
                    result.items, result.tokens
                )
            };
            *outcome = ToolOutcome::ok(
                detail.clone(),
                format!("evicted {} file view(s)", result.items),
            )
            .with_data(ApiData::Reclaim(ReclaimData {
                items: saturating_u32(result.items),
                // The reclaim's own counters are `u64`; the sidecar is declared in the `u32` its
                // structured consumers use, and saturates rather than wrapping a preposterous
                // figure into a small plausible one.
                reclaimed_tokens: u32::try_from(result.tokens).unwrap_or(u32::MAX),
                paths: result.paths.clone(),
                detail: detail.clone(),
            }));
            vec![GgTelemetryKind::ContextManaged {
                action: GgContextAction::EvictFileViews,
                reclaimed_tokens: result.tokens,
                items: result.items as u64,
                detail,
                // Only a documentation close reports where it cut; see the field's own note.
                earliest_removed: None,
            }]
        }
        ContextReclaim::ArchiveThread => {
            // Already validated by the call; a malformed one that somehow reached here names no
            // ranges and so archives nothing, which is the safe direction.
            let ranges = parse_archive_ranges(args).unwrap_or_default();
            let result = context.archive_thread(&ranges);
            let archived = result.items.len();
            // What left the window, archived or dropped — the figure the model reasons about when it
            // asks how much its call bought.
            let removed = archived + result.dropped;
            // The archive's own snapshot, taken with the same lock the archival used: what is now
            // *out* of the window, beside the `ContextManaged` record of how much left it.
            let (archive_total, archive_state) = {
                let mut store = archive.lock().expect("archive store lock");
                store.archive(result.items.iter().map(|item| (item.source, &item.message)));
                (store.len(), store.state_event(archive_id))
            };
            let detail = if removed == 0 {
                format!(
                    "Nothing was archived: {} matched no turns still in your window (they may \
                     already be archived or compacted away).",
                    describe_ranges(&ranges)
                )
            } else {
                format!(
                    "Archived turn(s) {}: {archived} result(s) moved into the archive and {} of \
                     your own messages dropped, reclaiming ~{} tokens. The results are out of your \
                     window but still searchable with search_archive (the archive now holds \
                     {archive_total} item(s)).",
                    describe_turns(&result.turns),
                    result.dropped,
                    result.tokens
                )
            };
            *outcome =
                ToolOutcome::ok(detail.clone(), format!("archived {removed} thread item(s)"))
                    .with_data(ApiData::Reclaim(ReclaimData {
                        items: saturating_u32(removed),
                        reclaimed_tokens: u32::try_from(result.tokens).unwrap_or(u32::MAX),
                        // A thread archival frees whole conversation items, not file views, so it has
                        // no paths to name. An empty list here is a fact, not a gap.
                        paths: Vec::new(),
                        detail: detail.clone(),
                    }));
            vec![
                GgTelemetryKind::ContextManaged {
                    action: GgContextAction::ArchiveThread,
                    reclaimed_tokens: result.tokens,
                    items: removed as u64,
                    detail,
                    earliest_removed: None,
                },
                archive_state,
            ]
        }
    }
}

/// The turn ranges an `archive_thread` call named, as the failure message reads them back — `turn 7`
/// for a single turn, `turns 4-19` for a span, comma-joined.
///
/// A call that reclaimed nothing has to say *what* it asked for, or the model reads "nothing was
/// archived" as gg refusing rather than as its own range having already been archived.
fn describe_ranges(ranges: &[TurnRange]) -> String {
    if ranges.is_empty() {
        return "no turn ranges".to_string();
    }
    let spans: Vec<String> = ranges
        .iter()
        .map(|range| {
            if range.from == range.to {
                format!("turn {}", range.from)
            } else {
                format!("turns {}-{}", range.from, range.to)
            }
        })
        .collect();
    spans.join(", ")
}

/// The turns an archival actually removed something from, collapsed back into runs — `4-19, 22` —
/// so a call spanning fifty turns reports a span rather than fifty numbers.
fn describe_turns(turns: &[u64]) -> String {
    let mut spans: Vec<String> = Vec::new();
    let mut index = 0;
    while index < turns.len() {
        let start = turns[index];
        let mut end = start;
        // Extend while the next turn is the consecutive one.
        while index + 1 < turns.len() && turns[index + 1] == end + 1 {
            index += 1;
            end = turns[index];
        }
        spans.push(if start == end {
            start.to_string()
        } else {
            format!("{start}-{end}")
        });
        index += 1;
    }
    spans.join(", ")
}

/// Resolve the context window the active model's fullness ratio is measured against, in two
/// steps:
///
/// 1. **The model's window**, from `windows` — the model catalog's figure for each bound
///    model, [pushed in with the invocation](GgInvocation::model_windows) — **narrowed** by
///    the [context-window-override](CAPABILITY_CONTEXT_WINDOW_OVERRIDE) capability's
///    [`PARAM_WINDOW_LIMIT`], when that capability is enabled. The override may only make the
///    window *smaller*, and one that would not is [refused at launch](check_window_limits)
///    rather than clamped: a run recording a narrowing it never applied measures the model's
///    full window under the narrowed arm's name.
/// 2. **The working window**, [reduced by the summary headroom](crate::compaction::working_window)
///    when compaction is on, reserving room for the summarization call itself.
///
/// Returns `None` when `windows` carries no figure for `model_id`. **There is no fallback**:
/// gg keeps no model table of its own and will not guess a window from a model id, because a
/// guessed denominator silently mis-scales every fullness figure, the compaction trigger, and
/// the agent's own fullness signal. A run whose window cannot be resolved must not start —
/// [`validate_model_windows`] refuses it at launch, so this `None` is unreachable once a
/// session is running.
///
/// Read off `profile`, the agent this window belongs to, rather than off the root: every capability
/// in gg is per agent, and a run may narrow its implementer's window while measuring its reviewer
/// against the model's own.
pub(crate) fn resolve_window_limit(
    profile: &GgAgentConfig,
    windows: &BTreeMap<String, u64>,
    model_id: &str,
) -> Option<u64> {
    let model_window = windows.get(model_id).copied()?;
    // The narrowing override applies only when the capability is enabled — a disabled override
    // records the window it *would* have narrowed to (keeping two configurations' on/off
    // symmetric) without narrowing anything. Execution ceilings moved to
    // `capabilitySet.limits`; this window narrowing stays a capability param because it is
    // genuinely a lever a study toggles, not a run-wide ceiling. So the switch is read *before* the
    // param: an enabled capability owes a figure, and the discarding sink below may only be reached
    // where the launch pass has already proved one is written.
    //
    // Discarding: `check_window_limits` read this same param at launch against this same model
    // window, and refused the run if it was absent, or not a narrowing gg could apply.
    let configured = match profile
        .capability(CAPABILITY_CONTEXT_WINDOW_OVERRIDE)
        .filter(|capability| capability.enabled)
    {
        Some(_) => {
            match window_limit(profile, &mut crate::validate::LaunchReport::Discarding) {
                Some(limit) => limit.min(model_window),
                // An enabled override with no figure: `check_window_limits` read this same param
                // through this same resolver and refused the run, so this measures an agent that
                // takes no turn.
                None => window_of_a_refused_launch(model_window),
            }
        }
        // No override, or one switched off: the agent is measured against its model's own window,
        // which is the setting an absent narrowing states rather than a figure gg picked.
        None => model_window,
    };
    Some(compaction::working_window(
        profile,
        configured,
        &mut crate::validate::LaunchReport::Discarding,
    ))
}

/// The window an agent is measured against once the [narrowing](PARAM_WINDOW_LIMIT) it declared has
/// refused the launch: the model's own, because there is no narrowed one to use and a
/// [total](crate::validate#the-resolver-contract) reader must answer with something.
///
/// A function rather than a constant because the figure is the model's rather than gg's. It is
/// named so the next reader of that line sees a refused launch rather than the un-narrowed arm
/// running under the narrowed arm's name.
fn window_of_a_refused_launch(model_window: u64) -> u64 {
    model_window
}

/// The [narrowed window](PARAM_WINDOW_LIMIT) `profile` declares, in tokens, or `None` when it
/// narrows nothing.
///
/// Narrowing is the whole of what the capability does, so an enabled one writes the figure it
/// narrows to and one that writes none is [refused](crate::validate::required_positive_count_param)
/// at the param's own locus — an override with no figure is an override the run would record and
/// never apply. A `0` is refused on the same terms rather than read as "no override": it narrows to
/// a window that holds not even the system prompt, and it would leave the
/// [context-window override](CAPABILITY_CONTEXT_WINDOW_OVERRIDE) study's two arms as one arm.
///
/// A profile with no such capability, or one that switches it off, is measured against its model's
/// own window; that absence is the setting, and nothing is owed. A figure written on the off arm is
/// still read and still judged, so the two arms of one comparison stay one document with one switch
/// moved.
fn window_limit(
    profile: &GgAgentConfig,
    report: &mut crate::validate::LaunchReport,
) -> Option<u64> {
    let capability = profile.capability(CAPABILITY_CONTEXT_WINDOW_OVERRIDE)?;
    let consequence = "a window of no tokens holds not even the system prompt, and an override \
                       that narrows to nothing is one the run records and never applies";
    if capability.enabled {
        crate::validate::required_positive_count_param(
            &capability.params,
            CAPABILITY_CONTEXT_WINDOW_OVERRIDE,
            PARAM_WINDOW_LIMIT,
            consequence,
            report,
        )
    } else {
        crate::validate::positive_count_param(
            &capability.params,
            CAPABILITY_CONTEXT_WINDOW_OVERRIDE,
            PARAM_WINDOW_LIMIT,
            consequence,
            report,
        )
    }
}

/// Every profile's [window override](PARAM_WINDOW_LIMIT), read against the window of the model
/// bound to it — the launch check that makes the narrowing exact.
///
/// The override **may only make the window smaller**. A value above the model's own window is
/// refused, on the same rule an unresolvable window is refused under: clamping it would leave a run
/// recording a narrowing it never applied and measuring the model's full window under the narrowed
/// arm's name. A profile whose model has no window at all is left alone —
/// [`validate_model_windows`] owns that refusal, and reporting it twice would name one defect as
/// two.
fn check_window_limits(
    set: &GgCapabilitySet,
    windows: &BTreeMap<String, u64>,
    report: &mut crate::validate::LaunchReport,
) {
    for profile in &set.agents {
        report.for_agent(&profile.slug, |report| {
            let Some(limit) = window_limit(profile, report) else {
                return;
            };
            let Some(model_window) = profile
                .resolved_model_id()
                .and_then(|model_id| windows.get(model_id))
                .copied()
            else {
                return;
            };
            if limit > model_window {
                report.report(crate::validate::LaunchDefect::run_level(
                    crate::validate::param_locus(
                        CAPABILITY_CONTEXT_WINDOW_OVERRIDE,
                        PARAM_WINDOW_LIMIT,
                    ),
                    limit.to_string(),
                    format!(
                        "the `{CAPABILITY_CONTEXT_WINDOW_OVERRIDE}` capability may only make a \
                         window smaller, and this agent's model holds {model_window} tokens. \
                         Narrowing to the model's own window instead would record an override the \
                         run never applied."
                    ),
                ));
            }
        });
    }
}

/// One agent profile's contribution to the [launch pass](crate::validate::validate_launch) from this
/// module: the per-agent levers whose resolvers live beside the loop that reads them.
///
/// The window override is deliberately **not** here — it needs the run's model windows, which are on
/// the invocation rather than on the profile, so it is checked by [`check_window_limits`] once the
/// whole invocation is in hand.
pub(crate) fn check_launch(profile: &GgAgentConfig, report: &mut crate::validate::LaunchReport) {
    resolve_top_file_views(profile, report);
    resolve_signal_threshold(profile, report);
    AutoloadSetup::resolve(profile, report);
    check_allowlists(profile, report);
    check_opening_turn(profile, report);
}

/// The run-wide half of this module's [launch pass](crate::validate::validate_launch)
/// contribution — everything that needs more of the invocation than one profile.
pub(crate) fn check_invocation(
    invocation: &GgInvocation,
    report: &mut crate::validate::LaunchReport,
) {
    check_window_limits(
        &invocation.capability_set,
        &invocation.model_windows,
        report,
    );
    for profile in &invocation.capability_set.agents {
        report.for_agent(&profile.slug, |report| {
            resolve_skills_dir(profile, &invocation.workspace_dir, report);
        });
    }
}

/// Create gg's own [dotdir](test_cabinet_core::gg::GG_WORKSPACE_DIR) and the
/// [skills library](GG_WORKSPACE_SKILLS_DIR) inside it, before anything reads the workspace.
///
/// Everything under `.gg` is gg's — the capture journal it streams while the session runs, the
/// scripts a hook executes, the skills library — and seeding excludes the whole directory from the
/// run's git tree for that reason. So gg stands it up itself rather than requiring every seeded
/// workspace to know what belongs inside it, and the `.gg/skills` a fresh capability set is authored
/// with is a directory that is always there and always empty until a workspace authors into it.
///
/// A failure to create it is not reported here. The one thing that turns on it is the
/// [skills gate](check_workspace), which names the directory, the profile that wanted it and what
/// that profile would have opened with — a better refusal than an `io::Error` on a path.
fn prepare_workspace_dotdir(workspace_dir: &Path) {
    let _ = std::fs::create_dir_all(workspace_dir.join(GG_WORKSPACE_SKILLS_DIR));
}

/// This module's contribution to the [workspace gate](crate::validate::validate_workspace): every
/// profile's [skills library](SkillLibrary), read off the seeded workspace as the first turn will
/// find it.
///
/// Three questions, and each of them needs the filesystem rather than the document:
///
/// 1. The `dir` a profile named must be a directory gg can open. Every enabled skills capability
///    names one, so the path is always a promise about the workspace: one that is not there is a
///    typo, or a workspace that never seeded what it was meant to, and gg reaches for no directory
///    of its own — the agent would open with a library nobody authored. A profile that is to hold
///    gg's built-ins alone points `dir` at a directory the workspace carries and leaves empty.
/// 2. Every entry under it must load — [`SkillLibrary::load`] reports each one that does not.
/// 3. A skill carrying **code** must carry it in a language the profile reading it writes. A
///    directory authored `skill.ts` read by a Python agent loads nothing: the skill reads as prose,
///    the agent looks like the arm without code skills, and the only trace is a warning on a turn
///    nobody re-reads.
///
/// Each distinct directory is walked once however many profiles name it, so one unreadable entry is
/// one defect rather than one per agent.
pub(crate) fn check_workspace(
    invocation: &GgInvocation,
    report: &mut crate::validate::LaunchReport,
) {
    let mut loaded: BTreeMap<PathBuf, Arc<SkillLibrary>> = BTreeMap::new();
    let mut checked: BTreeSet<(PathBuf, GgProgramLanguage)> = BTreeSet::new();
    for profile in &invocation.capability_set.agents {
        if !profile.is_enabled(CAPABILITY_SKILLS) {
            continue;
        }
        // Already reported: the launch pass read this param, refused an enabled capability that
        // named no `dir` and refused one whose `dir` is not a path — so a profile that reaches the
        // workspace gate with skills on has a directory to walk.
        let Some(dir) = resolve_skills_dir(
            profile,
            &invocation.workspace_dir,
            &mut crate::validate::LaunchReport::already_reported(),
        ) else {
            continue;
        };
        let library = match loaded.get(&dir) {
            Some(library) => Arc::clone(library),
            None => {
                let library = if dir.is_dir() {
                    Arc::new(SkillLibrary::load(&dir, report))
                } else {
                    report.report(crate::validate::LaunchDefect::run_level(
                        crate::validate::param_locus(CAPABILITY_SKILLS, PARAM_SKILLS_DIR),
                        dir.display().to_string(),
                        format!(
                            "the `{CAPABILITY_SKILLS}` capability names this directory as the one \
                             the agent `{}` loads its skills from, and there is no such directory \
                             in the workspace; that agent would open with a library nobody \
                             authored.",
                            profile.slug,
                        ),
                    ));
                    Arc::new(SkillLibrary::empty())
                };
                loaded.insert(dir.clone(), Arc::clone(&library));
                library
            }
        };
        check_skill_languages(profile, &dir, &library, &mut checked, report);
    }
}

/// Every skill that carries code must carry it in the language of the profile reading it.
///
/// The using agent's language is what decides which of a skill directory's `skill.<ext>` files it
/// gets, so a directory serving several arms carries a spelling for each. One that carries only
/// spellings this profile does not write is an authoring mistake with no symptom: the skill still
/// reads, its prose still arrives, and the module the author wrote is simply never loaded — which is
/// indistinguishable from the arm that has no code skills at all.
///
/// Checked only for a profile that could actually be handed the module: skills enabled **and**
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) on, since a tool-calling agent has no programs
/// to import a module into and is shown a skill's prose half by design.
///
/// `checked` records the `(directory, language)` pairs already judged, so two profiles reading one
/// directory in one language report one defect rather than two.
fn check_skill_languages(
    profile: &GgAgentConfig,
    dir: &Path,
    library: &SkillLibrary,
    checked: &mut BTreeSet<(PathBuf, GgProgramLanguage)>,
    report: &mut crate::validate::LaunchReport,
) {
    if !profile.is_enabled(CAPABILITY_RESPONSES_AS_CODE) {
        return;
    }
    // Already reported: the launch pass resolved each profile's language and refused one it could
    // not read.
    let id = sandbox::resolve_program_language(
        profile,
        &mut crate::validate::LaunchReport::already_reported(),
    );
    if !checked.insert((dir.to_path_buf(), id)) {
        return;
    }
    let language = sandbox::language(id);
    for skill in library.skills() {
        if !skill.has_code() || skill.code(language).is_some() || skill.on_use(language).is_some() {
            continue;
        }
        report.report(crate::validate::LaunchDefect::run_level(
            dir.join(skill.name()).display().to_string(),
            skill
                .code_spellings()
                .iter()
                .map(|extension| format!(".{extension}"))
                .collect::<Vec<_>>()
                .join(", "),
            format!(
                "the skill `{}` carries code spelled only this way, and the agent reading it \
                 writes {}; the skill would load as prose and its module would never be loaded, \
                 which is indistinguishable from an agent with no code skills at all.",
                skill.name(),
                language.display_name(),
            ),
        ));
    }
}

/// Check that every model `set` binds has a [context window](GgInvocation::model_windows) —
/// the launch check that makes gg's lack of a fallback safe.
///
/// The window is the denominator of every fullness figure, the basis of the [compaction] trigger,
/// and part of the fullness signal the agent itself reads. Running without it would mean inventing
/// one, so a session that cannot measure its own window does not start: the run fails loudly here
/// rather than producing a run whose context accounting is quietly wrong.
///
/// This is the last of three lines of defence — the backend refuses to enqueue such a run and
/// `core` refuses to launch one — and the one that also covers an invocation written by hand.
fn validate_model_windows(
    set: &GgCapabilitySet,
    windows: &BTreeMap<String, u64>,
) -> Result<(), String> {
    let missing: Vec<&str> = set
        .bound_model_ids()
        .into_iter()
        .filter(|id| !windows.contains_key(*id))
        .collect();
    if missing.is_empty() {
        return Ok(());
    }
    Err(format!(
        "the invocation carries no context window for the model(s) {} — a gg run is measured \
         against the model catalog's window and will not guess one; re-launch once the catalog \
         knows the model",
        missing
            .iter()
            .map(|id| format!("`{id}`"))
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

/// Load one [`SkillLibrary`] per profile that enables the [`skills`](CAPABILITY_SKILLS) capability,
/// keyed by profile name.
///
/// A library belongs to an agent, so each profile is read from the directory its own
/// [`dir`](PARAM_SKILLS_DIR) names. Profiles naming one directory share a single load: the map is
/// keyed by resolved path first, so a run whose four workers all read `.gg/skills` walks that
/// directory once and hands the same `Arc` to all four.
fn resolve_skills(
    set: &GgCapabilitySet,
    workspace_dir: &Path,
) -> BTreeMap<String, Arc<SkillLibrary>> {
    // Discarding, twice over. `check_invocation` read these same params at launch and refused the
    // run if gg could not read a path from one, and the
    // [workspace gate](crate::validate::validate_workspace) then walked each of these directories —
    // over the workspace as the run's first turn will find it — and refused the run if any entry in
    // one would not load. So these loads can report nothing.
    let report = &mut crate::validate::LaunchReport::Discarding;
    let mut by_dir: BTreeMap<PathBuf, Arc<SkillLibrary>> = BTreeMap::new();
    let mut by_profile: BTreeMap<String, Arc<SkillLibrary>> = BTreeMap::new();
    for profile in &set.agents {
        if !profile.is_enabled(CAPABILITY_SKILLS) {
            continue;
        }
        let Some(dir) = resolve_skills_dir(profile, workspace_dir, report) else {
            continue;
        };
        let library = match by_dir.get(&dir) {
            Some(library) => Arc::clone(library),
            None => {
                let library = Arc::new(SkillLibrary::load(&dir, report));
                by_dir.insert(dir, Arc::clone(&library));
                library
            }
        };
        by_profile.insert(profile.slug.clone(), library);
    }
    by_profile
}

/// The directory a profile loads no skills from: it configures none — the capability is absent or
/// switched off — or the param that would have named one has already refused the launch. Either
/// way there is nothing to walk, and gg reaches for no directory of its own.
const NO_SKILLS_DIRECTORY: Option<PathBuf> = None;

/// Resolve the directory `profile` loads its authored skills from: the skills capability's
/// [`dir`](PARAM_SKILLS_DIR) param, relative to the workspace or absolute as given.
///
/// An enabled capability writes it, and one that writes none is
/// [refused](crate::validate::required_param): a library belongs to an agent, and there is no
/// directory gg could reach for that would be the one this profile meant. A present value that is
/// not a path — a number, an object, a string of nothing but whitespace — is refused on the same
/// terms.
///
/// `None` says this profile loads no authored skills at all: it declares no skills capability, or
/// switches it off, or wrote a `dir` gg could not read and the launch is already refused. A `dir` on
/// a switched-off capability is still read, so the two arms of one comparison stay one document with
/// one switch moved.
///
/// Whether the resolved directory can actually be **read** is a different question, and one the
/// workspace answers rather than the document; it is checked after seeding, by
/// [`check_workspace`], not here.
fn resolve_skills_dir(
    profile: &GgAgentConfig,
    workspace_dir: &Path,
    report: &mut crate::validate::LaunchReport,
) -> Option<PathBuf> {
    let capability = profile.capability(CAPABILITY_SKILLS)?;
    let declared = if capability.enabled {
        let Some(declared) = crate::validate::required_param(
            &capability.params,
            CAPABILITY_SKILLS,
            PARAM_SKILLS_DIR,
            report,
        ) else {
            return NO_SKILLS_DIRECTORY;
        };
        declared
    } else {
        capability
            .params
            .get(PARAM_SKILLS_DIR)
            .filter(|value| !value.is_null())?
    };
    let Some(configured) = declared
        .as_str()
        .map(str::trim)
        .filter(|dir| !dir.is_empty())
    else {
        report.report(crate::validate::LaunchDefect::run_level(
            crate::validate::param_locus(CAPABILITY_SKILLS, PARAM_SKILLS_DIR),
            crate::validate::as_written(declared),
            format!(
                "the `{CAPABILITY_SKILLS}` capability's `{PARAM_SKILLS_DIR}` names the directory \
                 the agent `{}` loads its skills from, and gg cannot read a path here; it reaches \
                 for no directory of its own, so the agent would open with a library nobody \
                 authored.",
                profile.slug,
            ),
        ));
        return NO_SKILLS_DIRECTORY;
    };
    let path = Path::new(configured);
    Some(if path.is_absolute() {
        path.to_path_buf()
    } else {
        workspace_dir.join(path)
    })
}

/// Build the run's [`MemoriesRuntime`] from the capability set: when the
/// [`memories`](test_cabinet_core::gg::CAPABILITY_MEMORIES) capability is enabled, an enabled runtime with an empty store
/// organized by the [strategy](MemoryStrategy::resolve) its `implementation` names and bounded by
/// the [limits resolved](crate::memories::MemoryCaps::resolve) from the capability's params; otherwise a
/// [disabled](MemoriesRuntime::disabled) runtime (a configuration with the capability off) that
/// offers nothing.
/// The startup log line describing a run's memory configuration: which
/// [strategy](MemoryStrategy) it runs, and the limits that are actually in force.
///
/// A disabled limit is left out rather than logged as `0`, for the same reason the model is not
/// told about it: someone reading a run's log to see what an arm was configured with should see
/// the limits that could refuse a write, not a list of every limit gg knows how to enforce.
fn memories_startup_note(memories: &MemoriesRuntime) -> String {
    let caps = memories.caps();
    let shape = match memories.strategy() {
        MemoryStrategy::Scratchpad => "memory scratchpad enabled (every memory stays in context)",
        MemoryStrategy::Markdown => "markdown memories enabled (a pinned index over files)",
        MemoryStrategy::KeywordSearch => "keyword-search memories enabled (no index)",
    };
    let limits: Vec<String> = [
        caps.max_count.map(|n| format!("{n} memories")),
        caps.max_len_per_memory.map(|n| format!("{n} chars each")),
        caps.max_total_len.map(|n| format!("{n} chars total")),
        caps.max_len_index.map(|n| format!("{n} chars of index")),
    ]
    .into_iter()
    .flatten()
    .collect();
    // How this holder binds its instance, said only when it is not the default: an `isolated`
    // notebook is what "memories" has always meant, so naming it would be noise, while anything
    // else changes who can see what and is worth a line in the log.
    let binding = match (memories.scope(), memories.is_writable()) {
        (MemoryScope::Isolated, _) => String::new(),
        (scope, true) => format!(" Scope: `{scope}`."),
        (scope, false) => format!(" Scope: `{scope}` (read-only)."),
    };
    if limits.is_empty() {
        format!("{shape}; unlimited.{binding}")
    } else {
        format!("{shape}, up to {}.{binding}", limits.join(", "))
    }
}

/// Build the run's [`TasksRuntime`] from the capability set: when the
/// [`tasks`](test_cabinet_core::gg::CAPABILITY_TASKS) capability is enabled, an enabled runtime with an empty task
/// DAG holding at most the [count resolved](crate::tasks::resolve_max_tasks) from the capability's params;
/// otherwise a [disabled](TasksRuntime::disabled) runtime (a configuration with the capability
/// off) that
/// offers nothing.
/// The [agent profile](GgAgentConfig) whose [project-management](CAPABILITY_PROJECT_MANAGEMENT)
/// configuration governs the run's **one shared board** — the first profile that has the capability
/// on, or `None` when no profile does and the run therefore has no board at all.
///
/// Read across every profile rather than off the [root](GgCapabilitySet::root) because the board is
/// run-global while the capability is per-agent: a set that puts project management on a dedicated
/// board-owning profile (a perfectly ordinary shape — the root need not be the agent that files work)
/// would otherwise offer that profile the board tools while the run around it had no board runtime,
/// no auto-dispatch, and no worktrees, so every issue it filed would sit on the board forever.
/// Mirrors how [`merge_agent_id`] reads the same capability's merge-agent param.
///
/// This is the profile the board's three ceilings are read off, and every other profile's are read
/// by nothing — so a second board-carrying profile that declares a *different* one is
/// [refused at launch](crate::validate) rather than quietly overruled.
pub(crate) fn board_owner(set: &GgCapabilitySet) -> Option<&GgAgentConfig> {
    set.agents
        .iter()
        .find(|agent| agent.is_enabled(CAPABILITY_PROJECT_MANAGEMENT))
}

/// Build the run's [`BoardRuntime`] from the capability set: when some profile
/// [owns the board](board_owner), an enabled runtime with an empty board bounded by the
/// [caps resolved](BoardCaps::resolve) from that profile's capability params; otherwise a
/// [disabled](BoardRuntime::disabled) runtime (a configuration with the capability off) that
/// offers nothing.
fn resolve_board(set: &GgCapabilitySet, ids: &ModuleIds) -> BoardRuntime {
    let Some(owner) = board_owner(set) else {
        return BoardRuntime::disabled();
    };
    // `board_owner` found the profile by its *enabled* capability, so there is one to read the
    // ceilings off; a set with none has no board at all rather than one bounded by figures gg chose.
    let Some(capability) = owner.capability(CAPABILITY_PROJECT_MANAGEMENT) else {
        return BoardRuntime::disabled();
    };
    let caps = BoardCaps::resolve(
        &capability.params,
        &mut crate::validate::LaunchReport::Discarding,
    );
    BoardRuntime::new_in(caps, ids)
}

/// Resolve the run's git-backed [isolation and baseline](WorktreesSetup) at session start, reporting
/// on `emitter`.
///
/// Isolation is wanted whenever the run can produce a worktree — the
/// [project-management](CAPABILITY_PROJECT_MANAGEMENT) capability, every issue of which works in its
/// own. With it off, git is left alone entirely — no baseline, no root.
///
/// Any problem — git absent, a failed baseline, or an uncreatable worktree root — is logged
/// **loudly** at error level and leaves isolation unusable (issues run in the shared workspace and
/// merge nothing) rather than crashing the run.
async fn resolve_worktrees(
    set: &GgCapabilitySet,
    workspace_dir: &Path,
    emitter: &Emitter,
) -> WorktreesSetup {
    let issues = board_owner(set).is_some();
    // A short, accurate description of why git is needed, for the diagnostics.
    let reason = "every issue works in an isolated git worktree";
    if !issues {
        return WorktreesSetup {
            baseline_commit: None,
            root: None,
        };
    }

    if !git::git_available().await {
        emitter.emit(log(
            "error",
            format!(
                "{reason}, but the `git` binary is not available; worktree isolation is disabled. \
                 Issues run directly in the shared workspace (nothing is merged, and reviews see \
                 an empty diff). (The rest of the run is unaffected.)"
            ),
        ));
        return WorktreesSetup {
            baseline_commit: None,
            root: None,
        };
    }

    // Not captured: worktree isolation is resolved *before* the orchestrator exists, so there is
    // no journal open yet to record into. That is the honest boundary rather than an omission —
    // the baseline commit this returns is the one thing here worth a record, and it belongs on the
    // replay [seed](test_cabinet_core::gg_session_record::GgSessionSeed::baseline_commit) rather than in
    // the input log, since it is fixed identity rather than something the session consumed.
    let baseline = match git::ensure_baseline(&git::GitCapture::disabled(), workspace_dir).await {
        Ok(sha) => sha,
        Err(err) => {
            emitter.emit(log(
                "error",
                format!(
                    "{reason}, but git could not initialize a baseline of the workspace: {err}; \
                     worktree isolation is disabled for this run."
                ),
            ));
            return WorktreesSetup {
                baseline_commit: None,
                root: None,
            };
        }
    };

    let root = worktrees_root_for(workspace_dir);
    let root = match std::fs::create_dir_all(&root) {
        Ok(()) => Some(root),
        Err(err) => {
            emitter.emit(log(
                "error",
                format!(
                    "a workspace baseline was committed, but the worktree root `{}` could not \
                     be created: {err}; worktree isolation is disabled for this run.",
                    root.display()
                ),
            ));
            None
        }
    };

    emitter.emit(log(
        "info",
        format!(
            "committed the seeded workspace as the baseline `{}`. {}",
            short_sha(&baseline),
            "Each issue is dispatched into its own worktree, merged back into the main tree once \
             it is accepted.",
        ),
    ));
    WorktreesSetup {
        baseline_commit: Some(baseline),
        root,
    }
}

/// The directory [worktree](Worktree) checkouts are created under: a sibling of the
/// workspace named `<workspace>.gg-worktrees`, so the checkouts live **outside** the main working
/// tree (never nested inside it, which would entangle them with the main tree's status).
fn worktrees_root_for(workspace_dir: &Path) -> PathBuf {
    match workspace_dir.file_name() {
        Some(name) => {
            let mut sibling = name.to_os_string();
            sibling.push(".gg-worktrees");
            workspace_dir.with_file_name(sibling)
        }
        // A workspace path with no final component (for example `/`) is degenerate; fall back to a
        // dot-dir inside it rather than panicking.
        None => workspace_dir.join(".gg-worktrees"),
    }
}

/// The first 12 characters of a commit sha, for a compact log line.
fn short_sha(sha: &str) -> &str {
    sha.get(..12).unwrap_or(sha)
}

/// Everything the [system prompt](system_prompt) is built from: the offered toolset, the
/// capability runtimes (each of which contributes a section only when it is enabled), the
/// `read_file` [read policy](ReadPolicy), and the three loop-level toggles.
///
/// Grouped into a struct rather than passed as a dozen positional arguments because the set
/// grows with every capability gg gains, and because the prompt is assembled in exactly one
/// place — [`Agent::drive`], which builds this from the resources the orchestrator handed it.
struct PromptInputs<'a> {
    /// The tools offered this run, after capability gating and per-tool overrides.
    registry: &'a ToolRegistry,
    /// The skills library whose descriptions are listed up front.
    skills: &'a SkillsRuntime,
    /// The memories capability, for its budget.
    memories: &'a MemoriesRuntime,
    /// The tasks capability, for its count ceiling.
    tasks: &'a TasksRuntime,
    /// How much of a file one `read_file` call returns, so a capped run says so up front, or `None`
    /// when the agent configures no read policy — in which case the prompt states no cap, because
    /// there is none in force.
    ///
    /// There is no `shell` counterpart: the [output policy](OffloadPolicy) states its own tail on
    /// the output it truncates, and that a program may run a command at all is what `shell`'s brief
    /// says — on the opening turn, where the profile lists `shell` as a fresh one does, and in a
    /// module lookup otherwise.
    read_policy: Option<ReadPolicy>,
    /// This agent's model and the run's vision registry, so the prompt can state whether a
    /// reference image can actually be shown to it.
    vision: &'a VisionContext,
    /// The [language](GgProgramLanguage) this agent writes its programs in, or `None` when it
    /// answers with native tool calls instead.
    ///
    /// One field rather than a flag beside a language, because the prompt needs both facts and they
    /// are the same fact: an agent writes programs exactly when it has a program language, and the
    /// language decides *which* responses-as-code template renders and how the calls in it are
    /// spelled.
    program_language: Option<GgProgramLanguage>,
    /// **What this agent was granted on the API surface**, as the loop resolved it once for the
    /// session — the same two values the membrane and the documentation runtime hold.
    ///
    /// Handed down rather than re-derived from [`profile`](Self::profile), because the resolution is
    /// not a property of the profile alone: it is narrowed by what this instance's modules and its
    /// position can service. A prompt that re-read the document would describe a surface the
    /// membrane then refuses, which is the one disagreement a model has no way to recover from.
    /// Read only by the responses-as-code arm; a tool-calling prompt names the registry's tools
    /// instead and both lists are empty for it.
    granted_capabilities: &'a [String],
    /// The operations half of the same grant. See [`granted_capabilities`](Self::granted_capabilities).
    granted_operations: &'a [OperationId],
    /// Whether this agent keeps a [program library](crate::programs) — the `programs` object, and
    /// the section that teaches a model to fetch a program it already ran instead of writing it
    /// again. Read from the same value that binds the object, so the prompt cannot describe a
    /// surface the scope does not have.
    program_library: bool,
    /// Whether this agent's opening context is pre-seeded with the test case's specifications and
    /// reference images ([autoload-specifications](CAPABILITY_AUTOLOAD_SPECS)), and if so whether
    /// they are **locked**: `None` off, `Some(false)` on, `Some(true)` on and locked. Gates the
    /// prompt section that tells the model the brief is already in its window.
    autoload_specs: Option<bool>,
    /// Whether this agent is [persistent](crate::persistence) — serialized to one running
    /// instance, opening on the file views it had open when it last finished. Gates the prompt section
    /// that explains where those views came from.
    persistence: bool,
    /// This agent's [profile](GgAgentConfig): the source of its operator custom instructions, its
    /// optional full-template override, and its [roster](GgAgentConfig::subagents) — the agents it
    /// may spawn, assign issues to, and name as reviewers (each enumerated in the prompt, scope by
    /// scope, so the model knows exactly which names each call accepts and why).
    profile: &'a GgAgentConfig,
    /// The whole set, so a roster entry can be resolved to the
    /// [name](GgAgentConfig::name) that makes its menu read as prose.
    set: &'a GgCapabilitySet,
    /// Which [ending calls](EndingRole) this agent has, so the prompt's ending section names the
    /// ones it can actually make and no others.
    ending_role: EndingRole,
    /// The [board issue](crate::board) this agent was dispatched to implement, when it was one.
    /// Renders the section that names the issue and tells the agent to record its work finished —
    /// the one thing gg needs from an implementer, and the thing it is not told anywhere else: its
    /// brief describes the work, not the protocol, and the board-authoring section it would have
    /// read the protocol from is (rightly) not rendered for a profile that may not author the board.
    assigned_issue: Option<&'a str>,
}

/// Whether `agent` was granted the call gg spells `tool` on the tool-calling surface and
/// `operation` on the responses-as-code one — asked of **whichever surface that agent has**.
///
/// The two are one call as far as gg's own machinery is concerned (`create_issue` and
/// `board.create_issue` reach the same board), and two entirely separate grants as far as
/// configuration is concerned: an agent holds one surface, so exactly one of the two allowlists can
/// answer for it and reading the other would report the opposite of the truth for every agent whose
/// operator filled in only the list that applies.
///
/// For the launch checks, which have a profile and no registry: what a *running* agent may call is
/// asked of its [registry](ToolRegistry) or its [grant](crate::sandbox::Grants), which are the same
/// answer arrived at with the modules and the role in hand.
pub(crate) fn grants_call(agent: &GgAgentConfig, tool: &str, operation: OperationId) -> bool {
    if agent.is_enabled(CAPABILITY_RESPONSES_AS_CODE) {
        agent.grants_operation(&operation.to_string())
    } else {
        agent.grants_tool(tool)
    }
}

/// The ids of the capabilities `profile` has switched **on** — the capability half of what this
/// agent was granted, in profile order.
///
/// A capability the profile declares and [disables](test_cabinet_core::gg::GgCapabilityConfig::enabled) is absent, exactly
/// as one it never declared: a disabled capability records the configuration it *would* have used so
/// two capability sets differing only in that switch stay comparable, and it buys nothing.
fn enabled_capabilities(profile: &GgAgentConfig) -> Vec<String> {
    profile
        .capabilities
        .iter()
        .filter(|capability| capability.enabled)
        .map(|capability| capability.id.clone())
        .collect()
}

/// **Every allowlist entry on `profile` that grants nothing** — the refusal that stands between a
/// mistyped allowlist and an agent that quietly never got the call its operator meant to hand it.
///
/// The two allowlists are **scoped**: [`tools`](GgAgentConfig::tools) is validated against gg's tool
/// vocabulary and [`operations`](GgAgentConfig::operations) against the
/// [operations table](crate::sandbox::Operation), and neither accepts the other's spelling. That is
/// the whole reason this refuses rather than repairs: the surfaces are independent, so a name in the
/// wrong list is not a synonym gg can resolve — the agent that would have used it writes programs
/// and was handed a tool name, or calls tools and was handed an operation id, and in both cases what
/// was asked for cannot be given. Naming which vocabulary the entry *does* belong to is the whole of
/// the help that can be offered, and the refusal carries it.
///
/// A refusal rather than the loud launch line it used to be, because this is the misconfiguration
/// whose effect is **silence**: an entry gg cannot read leaves an agent that behaves exactly like an
/// agent deliberately narrowed to less, and no reading of the run afterwards can tell the two apart.
/// The contract has said so all along — *"one that is not a gg tool … is an error, not a silently
/// inert entry"* — and only the disposition was ever missing.
///
/// An entry that *is* in the right vocabulary but that this agent's capabilities do not offer stays
/// **silent**, and that is the deliberate exception: it grants nothing, it is not a typo, and one
/// shared configuration document naming a call only some of the configurations it describes enable
/// is the ordinary way a sweep is written.
fn check_allowlists(profile: &GgAgentConfig, report: &mut crate::validate::LaunchReport) {
    // Both bad-name lists come from the readers that own the two vocabularies, so the check and the
    // grant cannot disagree about what a name means. Each entry keeps its **index** as its locus:
    // an allowlist has no other handle on one of its rows, and the same typo written twice is two
    // rows to delete.
    let ungranted = ungranted_tools(profile);
    for (index, name) in profile.tools.iter().enumerate() {
        if !ungranted.contains(name) {
            continue;
        }
        let hint = if crate::sandbox::operation_by_id(name).is_some() {
            "; it is an operation id, which belongs in this agent's `operations` allowlist"
        } else {
            ""
        };
        report.report(crate::validate::LaunchDefect::run_level(
            format!("tools[{index}]"),
            name,
            format!(
                "`{name}` is not a gg tool{hint}. The `tools` allowlist grants nothing for it, and \
                 an agent narrowed by accident is indistinguishable from one narrowed on purpose."
            ),
        ));
    }
    let (_, unknown) =
        crate::sandbox::resolve_operations(profile.operations.iter().map(String::as_str));
    for (index, name) in profile.operations.iter().enumerate() {
        if !unknown.contains(name) {
            continue;
        }
        let hint = if crate::tools::ALL_TOOL_NAMES.contains(&name.as_str()) {
            "; it is a tool name, which belongs in this agent's `tools` allowlist"
        } else {
            ""
        };
        report.report(crate::validate::LaunchDefect::run_level(
            format!("operations[{index}]"),
            name,
            format!(
                "`{name}` is not a gg operation{hint}. The `operations` allowlist grants nothing \
                 for it, and an agent narrowed by accident is indistinguishable from one narrowed \
                 on purpose."
            ),
        ));
    }
}

/// The launch pass over a profile's [opening turn](test_cabinet_core::gg::GgOpeningTurn) — the
/// vocabulary half of the rules the [bootstrap](crate::bootstrap) applies, on exactly the terms
/// [`check_allowlists`] applies them to the two allowlists.
///
/// Three things refuse. A module id that is the namespace of no operation gg has, and a function
/// id that is no gg operation, are entries nothing could ever honour — and, as with an allowlist,
/// the effect of accepting one would be **silence**: a window short of a listing it was written to
/// open on looks exactly like a window deliberately opened on less. The third is a function held by
/// **role or placement** rather than by configuration — an ending call, or the machine transition —
/// which no profile can promise its window will open on, since which agent holds it is decided by
/// where the run puts the agent and not by anything in its document.
///
/// What does *not* refuse is an entry in the right vocabulary that this agent's grant does not
/// reach: a module none of whose functions it may call, a function its allowlist does not name.
/// That is the shared-document case the allowlists also allow, and the bootstrap drops it at seed
/// time with a `warn` line naming the entry. An arm that does not catalogue a function is the same
/// case seen from the other side, and is left to the seed as well — the launch does not know the
/// arm every profile will run on.
fn check_opening_turn(profile: &GgAgentConfig, report: &mut crate::validate::LaunchReport) {
    for (index, id) in profile.opening_turn.modules.iter().enumerate() {
        if crate::sandbox::family_of_module(id).is_some() {
            continue;
        }
        let hint = if crate::sandbox::operation_by_id(id).is_some() {
            "; it is an operation id, which belongs in `openingTurn.functions`"
        } else {
            ""
        };
        report.report(crate::validate::LaunchDefect::run_level(
            format!("openingTurn.modules[{index}]"),
            id,
            format!(
                "`{id}` is not a gg module{hint}. The opening turn could list nothing for it, and a \
                 window opened on less by accident is indistinguishable from one opened on less on \
                 purpose."
            ),
        ));
    }
    for (index, id) in profile.opening_turn.functions.iter().enumerate() {
        let locus = format!("openingTurn.functions[{index}]");
        let Some(operation) = crate::sandbox::operation_by_id(id) else {
            let hint = if crate::tools::ALL_TOOL_NAMES.contains(&id.as_str()) {
                "; it is a tool name, and the opening turn opens the documentation of operations"
            } else if crate::sandbox::family_of_module(id).is_some() {
                "; it is a module id, which belongs in `openingTurn.modules`"
            } else {
                ""
            };
            report.report(crate::validate::LaunchDefect::run_level(
                locus,
                id,
                format!(
                    "`{id}` is not a gg operation{hint}. The opening turn could open nothing for it, \
                     and a window opened on less by accident is indistinguishable from one opened \
                     on less on purpose."
                ),
            ));
            continue;
        };
        let held_by = match operation.binding {
            crate::sandbox::Binding::Ending(_) => "the role an agent is dispatched in",
            crate::sandbox::Binding::Machine => "the machine an agent is placed in",
            crate::sandbox::Binding::Capability(_) | crate::sandbox::Binding::Always => continue,
        };
        report.report(crate::validate::LaunchDefect::run_level(
            locus,
            id,
            format!(
                "`{id}` is held by {held_by}, not by this profile's configuration, so an opening \
                 turn cannot promise to open its documentation."
            ),
        ));
    }
}

/// The capability modules a code program has this run, in the catalogue's own order, each with the
/// one-line description the prompt names it by, and the functions it actually binds.
///
/// A module appears exactly when the agent may call at least one of its functions — grouped by the
/// [signature catalogue](crate::sandbox::catalogue_functions), the same grouping the guest binds a
/// program's scope under, and decided by
/// [`DocsRuntime::bound`](crate::docs::DocsRuntime::bound), which is the *one* implementation of
/// "may this agent call X". So a withheld capability drops its
/// whole module rather than leaving a named-but-empty one, a reviewer is shown the ending module's
/// verdict calls where an implementer is not, and this readout cannot report a call the model's own
/// documentation would refuse to describe.
///
/// **It is not what the guest binds**, and since every SDK became static the two are deliberately
/// different: a program's scope carries every function its language has, and this reports what the
/// agent may *call*. That is the question a reader of a run asks — "was this agent offered that call
/// at all?" — and answering it with the language's compiled surface would report every agent as
/// having everything.
/// The view module always appears, because two of its calls nothing gates: the channel a program
/// puts material into its own window with (`views.open_text`), and documentation with
/// (`views.open_docs_view`). A run that offers no tools at all must still be able to show its model
/// something. The rest of the module is gated like any other — closing a view and listing what is
/// open are bought by [agent-managed context](CAPABILITY_AGENT_MANAGED_CONTEXT) — so which of its
/// functions appear varies with the profile even though the module itself never drops out.
///
/// The modules, the order they are shown in and the sentence each is introduced by are the
/// **catalogue's**, reflected from the doc comment written on that module's declaration in the guest
/// SDK — the same material a documentation search and the [reference](crate::reference) render.
/// Nothing about a module is authored here, because a table here would be a second copy of prose
/// the model also meets by two other routes and nothing would keep the copies equal. What this
/// function decides is only which of those modules *this* agent binds, and it has two consumers with
/// opposite needs. The [prompt](module_views) takes modules and descriptions **without**
/// the functions, because a model discovers those on demand — by searching, and then opening a
/// documentation view — rather than being shown every signature up front; the
/// [surface event](GgTelemetryKind::AgentSurface) takes the functions too, because a console reader
/// asking *"was this agent offered that call at all?"* is asking the question the on-demand
/// discovery deliberately does not answer up front. Both read this, so neither can drift from what
/// the guest actually binds.
///
/// # Every row is named twice, and the two names are for different readers
///
/// A module carries gg's [id](test_cabinet_core::gg::GgAgentApi::module) for it and this arm's
/// [spelling](test_cabinet_core::gg::GgAgentApi::path) of it, and each function carries gg's
/// [operation](crate::sandbox::signatures::CatalogueFunction::operation) beside the name the model
/// writes. That is not redundancy: eleven arms spell one surface eleven ways *by design*, so a
/// readout keyed on the spelling can be quoted back at the model but cannot be compared across arms,
/// and one keyed on the operation can be compared but reads as nothing the model ever typed. The
/// operation is what every call the program makes is
/// [recorded](test_cabinet_core::gg::GgTelemetryKind::ApiCall) under, so a consumer joins a bound
/// function to its own count on that and on nothing else — whether or not a tool backs it, and a
/// function offered and never called reports a real zero. What is reported is exactly the
/// catalogue's own entries: nothing is appended that the catalogue does not carry.
fn api_surface(
    capabilities: &[String],
    operations: &[OperationId],
    role: EndingRole,
    program_language: GgProgramLanguage,
) -> Vec<GgAgentApi> {
    // The agent's own documentation runtime, built from exactly what its program's scope is built
    // from — and asked the same question the model's own lookups are answered by. This readout used
    // to carry a verbatim copy of that predicate; a second copy of "may this agent call X" is a
    // drift hazard the moment either side grows a gate, and it is the same question either way.
    //
    // Both halves of the grant are the agent's own resolved ones, handed down rather than re-derived
    // here: a second reading of a profile is a second answer, and the membrane, the documentation
    // runtime and this readout must give one.
    let docs =
        crate::docs::DocsRuntime::new(capabilities.to_vec(), role, operations, program_language);
    let language = docs.language();
    // In the catalogue's order, which is the order the SDK declares them in.
    let modules = crate::sandbox::catalogue_modules(language);
    // Keyed by gg's module id rather than by the arm's spelling of it, because that id is the half
    // of an operation a consumer groups eleven arms by; the spelling comes off the module view
    // below.
    let mut bound: BTreeMap<&'static str, Vec<GgAgentApiFunction>> = BTreeMap::new();
    for function in crate::sandbox::catalogue_functions(language) {
        if docs.bound(&function) {
            bound
                .entry(function.module)
                .or_default()
                .push(GgAgentApiFunction {
                    // Module-relative rather than bare, so a method an arm hangs off a returned
                    // value reports qualified — `MemoryHit.read` beside the free `readMemory` —
                    // rather than as a bare name a reader keyed on the name could mistake for a
                    // second free function.
                    name: crate::sandbox::signatures::module_relative_name(&function).to_string(),
                    operation: function.operation.to_string(),
                });
        }
    }
    modules
        .iter()
        .filter_map(|described| {
            bound.remove(described.id).map(|functions| GgAgentApi {
                module: described.id.to_string(),
                path: described.path.to_string(),
                description: described.prose.rendered().into_owned(),
                functions,
            })
        })
        .collect()
}

/// The capability modules a code program's surface is divided into this run as the **system prompt**
/// names them: the path, the line the module's own declaration introduces it by, and the import that
/// brings it into scope where this arm needs one.
///
/// Deliberately not the functions in them. That is the whole shape of the discovery design: a model
/// is given the places its surface is filed under and finds the calls itself, by searching and
/// opening a documentation view. This list is the only vocabulary the prompt supplies, which is what
/// makes the first hop an exact lookup rather than a ranking.
///
/// A projection of [`api_surface`], which owns the modules, their order and the binding rule — but
/// **not** their prose. The surface event carries a module's whole documentation and the prompt
/// carries only the [brief](crate::sandbox::signatures::Prose::brief) of it, and that difference is
/// load-bearing rather than a matter of length.
///
/// A module's *detail* is written for a reader who has already decided to use the family, so it says
/// what the family is for — and on most arms it does that by naming calls, sometimes in a fenced
/// worked example. Rendering it here would put those names into the one document that tells the
/// model, in as many words, that it names none, which is worse than merely verbose: a model handed
/// `programs.rerun` in a module bullet never makes the search-then-open round trip that the whole
/// discovery design exists to require, and the sentences around the bullet are false while it does
/// not. The brief is the single line the module's own declaration introduces it by — no examples, no
/// second paragraph — and it is exactly what this list has always been documented as carrying.
///
/// Both halves are read from the same [module view](crate::sandbox::ModuleView) the description came
/// from, so the prompt's wording and the console's remain two projections of one authored source
/// rather than two copies that can drift.
pub(crate) fn module_views(
    capabilities: &[String],
    operations: &[OperationId],
    role: EndingRole,
    program_language: GgProgramLanguage,
) -> Vec<ModuleView> {
    // The brief and the import line, keyed by gg's id for each module, so the join below is by the
    // identity the surface reports rather than by position — `api_surface` filters to the bound
    // modules and this list does not.
    let described: BTreeMap<&'static str, (&'static str, Option<&'static str>)> =
        crate::sandbox::catalogue_modules(crate::sandbox::language(program_language))
            .into_iter()
            .map(|module| (module.id, (module.prose.brief, module.import)))
            .collect();
    api_surface(capabilities, operations, role, program_language)
        .into_iter()
        // A bound module always has a catalogue entry — `api_surface` derives its list from the very
        // same `catalogue_modules` call — so the lookup cannot miss; it is written as a filter
        // rather than an `expect` because a module gg could not describe has nothing to say in a
        // prompt, and dropping the row is the honest rendering of that.
        .filter_map(|api| {
            let (brief, import) = described.get(api.module.as_str()).copied()?;
            Some(ModuleView {
                import: import.map(str::to_string),
                path: api.path,
                brief: brief.to_string(),
            })
        })
        .collect()
}

/// The **paths** of the modules this agent binds, in the prompt's own order — [`module_views`] with
/// everything but the identifier dropped.
///
/// It exists so the [bootstrap](crate::bootstrap) lists, of the modules the agent's own
/// `openingTurn` names, exactly those the prompt publishes, by the name the prompt shows. The two
/// must be one answer: the prompt tells the model these paths are where its surface is filed, and
/// the opening turn is what fills that in — a bootstrap that decided held-ness its own way could
/// list a module the prompt did not name, or drop one it did, and in either direction the model's
/// first window would contradict its own instructions.
///
/// A path rather than gg's module id because the path is what a *search* takes and what the model
/// reads: the module filter accepts either, but a listing keyed by an id the model never saw would
/// be a view it could not match to anything.
pub(crate) fn module_paths(
    capabilities: &[String],
    operations: &[OperationId],
    role: EndingRole,
    program_language: GgProgramLanguage,
) -> Vec<String> {
    module_views(capabilities, operations, role, program_language)
        .into_iter()
        .map(|module| module.path)
        .collect()
}

/// How an agent answers a turn, as the record spells it: `responses_as_code` when the
/// [capability](CAPABILITY_RESPONSES_AS_CODE) is on for its profile, `tool_calling` otherwise.
///
/// One spelling, read by the run-level
/// [outcome dimension](crate::telemetry::Emitter::record_execution_mode) and by every instance's
/// [surface](GgTelemetryKind::AgentSurface), so a query cannot find a run's mode under one string
/// and an agent's under another.
fn execution_mode(code_enabled: bool) -> &'static str {
    if code_enabled {
        "responses_as_code"
    } else {
        "tool_calling"
    }
}

/// The [message headings](code_heading) a responses-as-code run documents in its system prompt, in
/// the order a model meets them: the base headings every code run can show — including the `View`
/// one a program writes itself, which nothing gates — then one per enabled capability that
/// synthesizes a message kind of its own.
///
/// Each heading string is read from [`code_heading`] rather than spelled out again, so the prompt and
/// the prefix a message actually carries cannot drift; this function owns only the *descriptions* and
/// the *gating*. A gate that is off drops its heading entirely — the model is never told about a
/// message kind this run cannot produce, matching how every other section answers a capability
/// that is off.
///
/// **No description names a call**, and the `View` row is the one that had to be reworded for that
/// to be true. It used to open with *"a value you showed yourself with `gg.views.openText`"*, spelled
/// per arm — which put a catalogued function into every rendered prompt, on every arm, under every
/// capability set including the one that grants nothing. The section is a reading guide: it tells a
/// model what a heading it *meets* means, not what to write to produce one. Saying the message holds
/// a value the program put there loses nothing a reader needs, and the call that puts it there is
/// found the way every other call is.
pub(crate) fn code_heading_views(memories: bool, tasks: bool, files: bool) -> Vec<CodeHeadingView> {
    // (source, one-line description, whether this run can produce it). The heading word itself comes
    // from `code_heading(source)`, the single source of truth both this list and the prefix share.
    let rows: &[(GgContextSource, &str, bool)] = &[
        (
            GgContextSource::UserPrompt,
            "the task you are working on, or a message from a parent agent",
            true,
        ),
        (
            GgContextSource::CompilerError,
            "your last program did not compile, so none of it ran; the message is the compiler's \
             error and nothing else. Fix it and resend the whole program",
            true,
        ),
        (
            GgContextSource::RuntimeError,
            "your last program compiled and then threw, or was stopped by a sandbox limit; the \
             message is the error and nothing else. Whatever the program did before it threw \
             stands, so do not repeat that work",
            true,
        ),
        (
            GgContextSource::System,
            "a process notice from the harness (a mode change, or guidance)",
            true,
        ),
        (
            GgContextSource::History,
            "a summary standing in for older turns the harness compacted out of the window",
            true,
        ),
        (
            GgContextSource::Skill,
            "documentation or a skill you asked to read, delivered on the following turn",
            true,
        ),
        (
            GgContextSource::Memory,
            "your durable memories, as they stood when this window was last compacted",
            memories,
        ),
        (
            GgContextSource::TaskList,
            "your task list, as it currently stands",
            tasks,
        ),
        (
            GgContextSource::FileView,
            "a file, or a window of one, shown in your context — seeded by the run or opened by \
             your own file-view call — headed by its path, the 1-based line range shown and the \
             file's total line count, as `File: src/main.ts:100-250 of 400 lines` (a whole file's \
             range runs `1-N`)",
            files,
        ),
        (
            GgContextSource::TextView,
            "a value your program put into your window; the view's label follows the heading, as \
             `View: changed-files`",
            // Ungated, unlike every other row: the view module is bound whatever the capability set
            // says, so any code run can produce this message kind.
            true,
        ),
    ];
    rows.iter()
        .filter(|(_, _, on)| *on)
        .filter_map(|(source, description, _)| {
            code_heading(*source).map(|heading| CodeHeadingView {
                heading: heading.to_string(),
                description: (*description).to_string(),
            })
        })
        .collect()
}

/// The entries of `profile`'s [roster](GgAgentConfig::subagents) that carry `scope`, as the prompt
/// lists them: the target's [id](GgAgentConfig::id) and [name](GgAgentConfig::name), plus the
/// caller-scoped description of when to use it.
fn roster(
    set: &GgCapabilitySet,
    profile: &GgAgentConfig,
    scope: GgSubagentScope,
) -> Vec<SpawnableAgentView> {
    set.roster(profile, scope)
        .into_iter()
        .map(|entry| SpawnableAgentView {
            // The value a call names its target by, which is the id. The profile's own name goes
            // in front of the guidance, where it reads as prose rather than as something to copy.
            name: entry.agent_id,
            description: match (entry.name.trim(), entry.description.trim()) {
                ("", why) => why.to_string(),
                (name, "") => name.to_string(),
                (name, why) => format!("{name}: {why}"),
            },
        })
        .collect()
}

/// This agent's rendered system prompt, or the reason gg could not render one.
///
/// `Err` is always **gg's own defect**: the launch pass proved a profile's
/// [override](GgAgentConfig::system_prompt_template) parses, so what is left is a template naming a
/// variable this context does not carry, or a code-mode context built without its program language.
/// Either way the agent would have to reason under a prompt other than the one its profile wrote,
/// and the prompt is the experiment — see [`prompts::render_system`].
fn system_prompt(inputs: PromptInputs<'_>) -> Result<String, String> {
    let PromptInputs {
        registry,
        skills,
        memories,
        tasks,
        read_policy,
        vision,
        program_language,
        granted_capabilities,
        granted_operations,
        program_library,
        autoload_specs,
        persistence,
        profile,
        set,
        ending_role,
        assigned_issue,
    } = inputs;
    // Every section below asks only "is this the code arm?"; exactly one place — the template
    // choice, and the spellings inside it — needs to know which language, so the flag is derived
    // here rather than carried alongside the language it would have to agree with.
    let responses_as_code = program_language.is_some();

    // This agent's spawnable roster. The prompt's Subagents section is gated on the *tool*
    // being offered rather than on the roster being non-empty.
    let spawnable_agents = roster(set, profile, GgSubagentScope::Subagent);
    let offers_spawn = registry.offers(SPAWN_SUBAGENT_TOOL);

    // The read cap is only worth stating when `read_file` is actually offered and actually
    // capped; an unlimited read — and an agent that configures no read policy at all — contributes
    // no prompt text, because there is no cap in force to describe. The cap is carried as the one
    // `Option` the template reads, so the prompt cannot state a figure the policy does not have.
    // Whether the model can be shown an image is stated whenever `read_file` is offered at all — a
    // text-only model that is not told so spends turns re-reading a mockup it will never see.
    let offers_read = registry.offers(READ_FILE_TOOL);
    let read_file = ReadFileView {
        offered: offers_read,
        line_cap: offers_read
            .then(|| read_policy.as_ref().and_then(ReadPolicy::line_cap))
            .flatten(),
        images: offers_read && !vision.declared_text_only(),
    };

    // Nothing about `shell` is built here any more, and neither half of what used to be is missed.
    // That its output may be a tail travels with the truncated output itself; that a program may run
    // a command at all is the first line of `shell`'s own brief, which an opening turn listing
    // `shell` (a fresh profile's does) puts in the window before the model's first real turn. A
    // prompt describes no capability its functions' briefs describe, so there is no shell view on
    // the rendering context to fill.

    // The message headings this run can put in front of a synthesized `user` message — only under
    // responses-as-code, where the transcript is plain text and the model needs the vocabulary named
    // (the tool-calling path distinguishes message kinds by role). The base four are intrinsic to the
    // protocol; each remaining heading is listed exactly when the capability that produces its message
    // kind is on, so the prompt describes only what this run can actually show — the same gating
    // discipline every other section follows.
    let code_headings = if program_language.is_some() {
        code_heading_views(
            memories.enabled(),
            tasks.enabled(),
            // A restored file view is a `File` message too, so a persistent agent is told the heading
            // even in the (unusual) case that it reads nothing itself.
            offers_read || autoload_specs.is_some() || persistence,
        )
    } else {
        Vec::new()
    };

    prompts::render_system(
        &SystemContext {
            responses_as_code,
            // The one language segment of the shared code template that renders, and what that
            // segment may say about itself. `None` on the tool-calling arm, which has no program
            // language at all.
            //
            // Three fields and no prose: the **id** is what a segment is gated on, the
            // **display name** is what a sentence calls the language, and the **checker** is the
            // one fact a segment's own gating turns on that the id does not already answer — an arm
            // whose programs are checked before they run and one whose are not have different
            // things to tell a model about a call it may not make. A sentence a model reads lives
            // in a `.hbs` file, so nothing here carries one.
            language: program_language.map(prompts::language_view),
            // The modules the surface is divided into — only under responses-as-code, where a
            // program reaches them by path and a model has to be told where to start looking; the
            // tool-calling path puts the tools in the request instead.
            modules: match program_language {
                // The grant the loop resolved, threaded in rather than re-derived here. A second
                // reading would be a second answer: the loop's is narrowed by this instance's
                // modules and its position in a machine, and a prompt that re-read the profile would
                // name calls the membrane goes on to refuse.
                Some(language) => module_views(
                    granted_capabilities,
                    granted_operations,
                    ending_role,
                    language,
                ),
                None => Vec::new(),
            },
            // On → the section that teaches a model to fetch a program it already ran and hand back
            // a patched copy instead of writing the whole thing again. Gated on the capability alone
            // (and, through `responses_as_code` above, on there being programs at all).
            program_library: responses_as_code && program_library,
            code_headings,
            // Operator-authored instructions for this agent's profile, inserted near the top of the
            // prompt; `None`/empty renders no section.
            custom_instructions: profile
                .custom_instructions
                .as_deref()
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .map(str::to_string),
            subagents: offers_spawn,
            spawnable_agents,
            read_file,
            skills: skill_views(skills, program_language),
            // The strategy decides what the section says: what memory *is* on this run differs
            // enough between the three (all of it in the window, an index over it, or nothing
            // until you search) that they are three paragraphs rather than one with holes.
            memories: memories.enabled().then(|| {
                let caps = memories.caps();
                let strategy = memories.strategy();
                MemoriesView {
                    scratchpad: strategy == MemoryStrategy::Scratchpad,
                    markdown: strategy == MemoryStrategy::Markdown,
                    keyword_search: strategy == MemoryStrategy::KeywordSearch,
                    max_count: caps.max_count,
                    max_len_per_memory: caps.max_len_per_memory,
                    max_total_len: caps.max_total_len,
                    max_len_index: caps.max_len_index,
                    max_len_description: caps.max_len_description,
                    max_results: caps.max_results,
                    // How this agent *holds* the memories, as opposed to what they are. Both are
                    // read off the resolved module rather than off the profile, because both
                    // depend on how this agent was spawned: a profile scoped `read-only` that
                    // ended up with an instance of its own may write it.
                    read_only: !memories.is_writable(),
                    linked: memories.is_linked(),
                    scope: memories.scope().to_string(),
                }
            }),
            tasks: tasks.enabled().then(|| TasksView {
                max_tasks: tasks.max_tasks(),
            }),
            // The issue this agent was dispatched to implement, when it was one — rendered
            // whatever its own capabilities are, since being told what it is working on has
            // nothing to do with whether it may author the board.
            assigned_issue: assigned_issue.map(|id| AssignedIssueView { id: id.to_string() }),
            // On → a section telling the model the whole brief is already in its window; the
            // `locked` flag decides whether it also promises the material stays across compaction.
            autoload_specs: autoload_specs.map(|locked| AutoloadView { locked }),
            // On → a section telling the model it is one serialized, long-lived worker and that the
            // file views already in its window are the ones it left open.
            persistence,
            // How this agent ends its session — its role's calls, named the way this execution mode
            // writes them.
            ending: ending_view(ending_role, program_language),
        },
        // A profile may override the whole prompt template; `None` uses the built-in one.
        profile.system_prompt_template.as_deref(),
    )
}

/// The available [skills](crate::skills) as the system prompt lists them: each one's name and
/// description, plus **what reading it will do** for this agent.
///
/// The two flags are the whole reason this is assembled here rather than taken straight off the
/// runtime. Reading a skill does up to three things — it pins the prose, it binds code at `lib`, it
/// runs an on-use script — and gg knows, per skill, which of the three apply. A prompt that listed
/// all three under "if it carries…" would describe two branches that are false of the skill in front
/// of it; with the flags, `{{#each skills}}` emits only the branch that is true.
///
/// The answer is **per language**, which is why it cannot be settled where the library is loaded: a
/// skill authored in Python carries code and offers a TypeScript agent none, so the flag is
/// `skill.code(language)` and not `skill.has_code()`. On the tool-calling arm both are false —
/// there is no program for a `lib` to be bound into and no on-use script to run after one.
fn skill_views(
    skills: &SkillsRuntime,
    program_language: Option<GgProgramLanguage>,
) -> Vec<SkillView> {
    // An agent that is offered no skills is listed none, which is what makes the prompt's whole
    // Skills section vanish rather than render an empty list.
    if !skills.offers_skills() {
        return Vec::new();
    }
    let language = program_language.map(crate::sandbox::language);
    skills
        .library()
        .skills()
        .iter()
        .map(|skill| SkillView {
            name: skill.name().to_string(),
            description: skill.description().to_string(),
            carries_code: language.is_some_and(|language| skill.code(language).is_some()),
            carries_on_use_script: language
                .is_some_and(|language| skill.on_use(language).is_some()),
        })
        .collect()
}

/// How this agent's ending section reads: which [role](EndingRole) it was dispatched in, and that
/// role's calls named the way this agent's protocol writes them.
///
/// All four names are filled whatever the role. The templates render in strict mode, where a missing
/// variable is a render error, and three unread strings cost nothing against a prompt that fails.
///
/// The **grouped, object-qualified** spellings a program writes are resolved from the run's
/// [program language](crate::sandbox::spell)'s own catalogue rather than written here: how a
/// language's SDK spells `requestChanges` is that language's business, and gg quoting a spelling of
/// its own would be gg telling a model to make a call the language does not bind. The bare tool
/// names on the tool-calling path are gg's own, in every language, because there is no language.
pub(crate) fn ending_view(
    role: EndingRole,
    program_language: Option<GgProgramLanguage>,
) -> EndingView {
    let language = program_language.map(crate::sandbox::language);
    let call = |operation: sandbox::OperationId, tool_name: &str| match language {
        Some(language) => crate::sandbox::spell(language, operation),
        None => tool_name.to_string(),
    };
    EndingView {
        standard: matches!(role, EndingRole::Standard),
        review: matches!(role, EndingRole::Review),
        finish: call(sandbox::SESSION_FINISH, completion::FINISH_TOOL),
        approve: call(sandbox::SESSION_APPROVE, completion::APPROVE_TOOL),
        request_changes: call(
            sandbox::SESSION_REQUEST_CHANGES,
            completion::REQUEST_CHANGES_TOOL,
        ),
    }
}

/// Seed `context` with the test case's [provided files](Orchestrator::provided_files) — its
/// specifications then its reference images — as though the agent had already opened each itself,
/// so the model opens with the whole brief already in the window. This is the
/// [autoload-specifications](CAPABILITY_AUTOLOAD_SPECS) capability's whole effect.
///
/// # The synthesized turn is written in the agent's own protocol
///
/// Seeding means putting words in the agent's mouth: a reply it did not send, answered by material
/// it did not ask for. Those words have to be a reply it *could* have sent, because the model reads
/// its own transcript as the example of what a well-formed turn looks like — and the two protocols
/// gg runs have nothing in common at that layer.
///
/// - **Tool calling**: one synthesized `read_file` assistant call per file, immediately answered by
///   the file's contents as a [`FileView`](GgContextSource::FileView) `tool` result. The
///   [call id](READ_FILE_TOOL) pairs them, so the opening conversation is well-formed exactly as a
///   real read would be.
/// - **Responses as code**: one synthesized **program** that opens a file view once per file,
///   followed by the file views it opened. There are no tools on this path — a program is the only
///   shape an assistant turn takes, a file view is the only way a file enters the window, and
///   a synthesized `tool_use` naming `read_file` would be a call to a function the model cannot
///   make, quoting an id its own assistant messages never carry. The reads still go through the
///   real [`ReadFileTool`], so what the model sees under the synthesized call is what that call
///   actually returns.
///
/// # What is the same either way
///
/// The files are read **whole** — an unlimited [`ReadPolicy`], independent of the run's own
/// `read_file` [line cap](ReadPolicy) — because the capability's promise is the *full* contents of
/// every spec, not a capped first window of it. (No read mode can refuse that; see [`ReadPolicy`].)
/// Image handling is the read tool's own: a mockup is attached as a picture when this agent's model
/// can see one and described otherwise, so an autoloaded reference behaves exactly like a read one.
/// When `locked`, each view is [`Pinned`](Retention::Pinned) so it survives compaction and eviction;
/// otherwise the views are ordinary ephemeral reads that compaction may summarize and agent-managed
/// context may evict. The synthesized assistant turn is always ephemeral — only the file view is
/// ever locked — mirroring how a read skill pins the body but not the `read_skill` call that fetched
/// it.
///
/// # A file that cannot be read ends the run
///
/// The capability's promise is the **full** specification, so there is no such thing as seeding most
/// of it. A skipped file used to be a warning, and the synthesized program was then written from the
/// files that *did* arrive — so the transcript showed a complete opening move over an incomplete
/// brief, and the run measured a specification nobody wrote against the arm that was configured.
/// The [workspace gate](crate::validate::validate_workspace) proves every one of these files
/// readable before the first turn, so an `Err` here is gg's own defect (or a file the run itself has
/// since removed) and the agent — and the run — ends on it.
async fn autoload_specifications(
    context: &mut ContextModel,
    programs: &mut crate::programs::ProgramLibrary,
    provided_files: &[PathBuf],
    tool_ctx: &ToolContext,
    language: GgProgramLanguage,
    locked: bool,
    images: bool,
) -> Result<(), String> {
    if provided_files.is_empty() {
        return Ok(());
    }
    let reader = ReadFileTool::new(ReadPolicy::Unlimited);
    let retention = if locked {
        Retention::Pinned
    } else {
        Retention::Ephemeral
    };

    // Read first, push second. The code path's assistant turn is ONE program naming every file it
    // opened, so it cannot be written until it is known which reads succeeded — a program listing a
    // call whose view never arrived would teach the model that `view.openFile` sometimes silently
    // does nothing.
    let mut seeded: Vec<(String, ToolOutcome)> = Vec::with_capacity(provided_files.len());
    for path in provided_files {
        let rel = path.to_string_lossy().into_owned();
        let outcome = reader.invoke(json!({ "path": rel }), tool_ctx).await;
        if !outcome.ok {
            return Err(format!(
                "the `{CAPABILITY_AUTOLOAD_SPECS}` capability seeds this agent's opening context \
                 with the whole of what the test case provided, and `{rel}` could not be read \
                 ({}); opening on part of the brief would measure a specification nobody wrote",
                outcome.output.trim(),
            ));
        }
        seeded.push((rel, outcome));
    }

    // Drop the pictures unless this profile asked for them. The read still happened and the view
    // still arrives carrying the descriptor the read wrote — label, format, byte size — so the
    // model knows the mockup is there and reads it itself when it wants to look. What the switch
    // decides is whether the picture rides along on this and every later request.
    if !images {
        for (_, outcome) in &mut seeded {
            outcome.images.clear();
        }
    }

    if context.code_mode() {
        // The synthesized turn takes exactly the shape the model's own turns must: a
        // `submit_program` call carrying the program, answered by the acknowledgement the model's
        // own would get — the id the library issued it, under which the program is kept as one of
        // gg's opening programs (turn 0) — with the views the program opened beneath it.
        let call_id = "autoload-program";
        let program = open_file_program(language, seeded.iter().map(|(rel, _)| rel));
        let id = programs.issue_id().map_err(|exhausted| exhausted.message)?;
        context.push_assistant(
            None,
            vec![completion::synthesized_submission(call_id, &program)],
        );
        context.push_tool_result(
            GgContextSource::ToolOutput,
            call_id,
            completion::submit_program_ack(id.as_deref()),
        );
        if let Some(id) = &id {
            programs.record(id, 0, &program, true, None);
        }
        for (rel, outcome) in seeded {
            // The path is the workspace-relative one the case provided, so the view's heading
            // names the file as the model would open it itself.
            let lines = ShownLines::of_read(outcome.data.as_ref());
            context.seed_file_view(rel, lines, outcome.output, outcome.images, retention);
        }
        return Ok(());
    }

    for (index, (rel, outcome)) in seeded.into_iter().enumerate() {
        // A deterministic, per-agent-unique id (the turn loop never assigns an `autoload-` one)
        // pairs the synthesized assistant call with its result, so the opening conversation is
        // well-formed exactly as a real read would be.
        let call_id = format!("autoload-{index}");
        let call = ToolCall {
            id: call_id.clone(),
            name: READ_FILE_TOOL.to_string(),
            arguments: json!({ "path": rel }),
        };
        context.push_assistant(None, vec![call]);
        context.push_file_view_with_retention(
            Some(rel),
            // Autoloaded files are read whole, so an autoloaded view covers no region.
            None,
            &call_id,
            outcome.output,
            outcome.images,
            retention,
        );
    }
    Ok(())
}

/// The program gg synthesizes to open `paths` on a [code-mode](ContextModel::code_mode) agent's
/// behalf — one file view per path, in seeding order, and nothing else.
///
/// The whole program is written by the agent's own
/// [program language](crate::sandbox::ProgramLanguage::open_file_program) rather than spelled out
/// here: this program is pushed into the transcript as an assistant turn, and the model reads its own
/// transcript as the example of what a well-formed turn looks like, so a statement in some other
/// language's syntax — or a statement list on an arm whose programs are translation units — would
/// teach it the wrong protocol on turn one.
fn open_file_program<'a>(
    language: GgProgramLanguage,
    paths: impl Iterator<Item = &'a String>,
) -> String {
    let views: Vec<(&str, Option<crate::sandbox::FileWindow>)> =
        paths.map(|path| (path.as_str(), None)).collect();
    crate::sandbox::language(language).open_file_program(&views)
}

/// Re-read the workspace paths a [`compact`](COMPACT_TOOL) call named, so they can be seeded back
/// into the restarted context as fresh [file views](RestoredFile).
///
/// The reads happen **before** the rewrite, not after, so a path gg cannot read is reported in the
/// restored context rather than silently missing from it: a model that asked for a file and simply
/// does not find it in its new window has no way to tell "gg dropped it" from "I misremembered the
/// path", and will spend turns looking for a file that does not exist. So a failed read is carried
/// across as the error itself, under the path the model named.
///
/// Files are read **whole** — an unlimited [`ReadPolicy`], independent of the run's own `read_file`
/// line cap — for the same reason [`autoload_specifications`] does: the model asked for the file's
/// contents to continue from, not for a capped first window of it. Pictures ride along, so a
/// reference mockup carried across a boundary stays a picture.
async fn restore_compact_files(
    paths: &[String],
    tool_ctx: &ToolContext,
    emitter: &Emitter,
) -> Vec<RestoredFile> {
    if paths.is_empty() {
        return Vec::new();
    }
    let reader = ReadFileTool::new(ReadPolicy::Unlimited);
    let mut restored = Vec::with_capacity(paths.len());
    for path in paths {
        let outcome = reader.invoke(json!({ "path": path }), tool_ctx).await;
        if !outcome.ok {
            emitter.emit(log(
                "warn",
                format!(
                    "compaction could not re-read `{path}`, which the model asked to keep: {}",
                    outcome.output
                ),
            ));
        }
        restored.push(RestoredFile {
            path: path.clone(),
            body: outcome.output,
            images: outcome.images,
        });
    }
    restored
}

/// Bring the pinned [`Memory`](GgContextSource::Memory) block up to date with the store, at a
/// boundary that is about to drop the ephemeral history.
///
/// This is the **only** place the block is rebuilt. Between boundaries the model's own memory
/// calls and their confirmations are what tell it what it holds, so re-sending the block each
/// turn would buy nothing and cost a copy of every memory per mutation. A compaction is where
/// that stops being true: it sweeps the thread the model was reading
/// its memories out of, so the block has to be current *before* the sweep. Called just before
/// the rewrite for exactly that reason — the stale copy is superseded into the ephemeral history
/// the rewrite is about to discard, and the fresh one crosses in the pinned prefix.
fn refresh_boundary_blocks(context: &mut ContextModel, modules: &CapabilityModules) {
    for (source, block) in modules.pinned_blocks(Refresh::AtBoundary) {
        context.replace_source(source, Retention::Pinned, block);
    }
}

/// Perform a compaction the agent's own turn has just supplied the material for — the shared tail
/// of all three [in-loop](PendingCompaction) strategies, in both execution modes.
///
/// It brings the pinned memory block up to date, re-reads whatever files the request named,
/// rewrites the window, emits the boundary's telemetry, and says on the operator's stream what was
/// reclaimed. Every caller has already decided *that* a compaction happens; this is the one place
/// it does.
#[allow(clippy::too_many_arguments)]
async fn apply_pending_compaction(
    context: &mut ContextModel,
    setup: &CompactionSetup,
    modules: &CapabilityModules,
    docs: &DocsRuntime,
    request: &CompactionRequest,
    tool_ctx: &ToolContext,
    hooks: &HooksSetup,
    offload: &OffloadPolicy,
    emitter: &Emitter,
) -> Result<(), HookFailure> {
    fire_pre_compact(hooks, setup.strategy.id(), tool_ctx, offload, emitter).await?;
    let retained = modules.retained_counts();
    // Both reads happen before the rewrite: the file paths and the documentation keys are in the
    // window the reset is about to empty.
    let docviews = compaction::restore_docviews(context, docs);
    refresh_boundary_blocks(context, modules);
    let files = restore_compact_files(&request.files, tool_ctx, emitter).await;
    let restored = files.len();
    let event = compaction::apply_compaction(
        context,
        setup,
        retained,
        request,
        files,
        docviews,
        compaction::is_fallback(&request.summary),
    );
    emitter.emit(event);
    emitter.emit(log(
        "info",
        format!(
            "compacted the context window with the `{}` strategy; the thread restarts from the \
             summary{}.",
            setup.strategy.id(),
            match restored {
                0 => String::new(),
                n => format!(" and {}", plural(n, "re-read file")),
            }
        ),
    ));
    fire_post_compact(
        hooks,
        setup.strategy.id(),
        context,
        tool_ctx,
        offload,
        emitter,
    )
    .await
}

/// Record one tool call's outcome into the context, giving the memory-curation tools and
/// `read_skill` their special treatment:
///
/// - a successful `write_memory`/`update_memory`/`delete_memory` (the store was already
///   mutated by the tool) emits the [`MemoryRevision`](GgTelemetryKind::MemoryRevision)s it
///   produced and then the [`MemoryState`](GgTelemetryKind::MemoryState) the store is left in,
///   so the console has both the record of what was done and the set as it now stands; the
///   pinned [`Memory`](GgContextSource::Memory) block itself is rebuilt only at a compaction
///   boundary ([`refresh_boundary_blocks`]). Its confirmation is ordinary ephemeral tool output;
/// - a successful `add_task`/`update_task`/`set_blocked_by`/`complete_task`/`remove_task`
///   likewise re-emits the [`TasksState`](GgTelemetryKind::TasksState); the pinned
///   [`TaskList`](GgContextSource::TaskList) block is rebuilt at the next turn boundary;
/// - a successful
///   `create_epic`/`create_issue`/`update_issue`/`set_issue_blocked_by`/`remove_epic`/`remove_issue`
///   likewise re-emits the [`BoardState`](GgTelemetryKind::BoardState);
/// - a **fresh** skill read is pinned as a [`Skill`](GgContextSource::Skill)-sourced item
///   (retained across compaction) and the updated
///   [`SkillsState`](GgTelemetryKind::SkillsState) is emitted; a **repeat** read is
///   answered with a short note rather than a second pinned copy of the body;
/// - every other tool result is ordinary ephemeral working material tagged by
///   [`source`](tool_output_source).
#[allow(clippy::too_many_arguments)]
fn record_tool_result(
    context: &mut ContextModel,
    modules: &mut CapabilityModules,
    call: &ToolCall,
    outcome: ToolOutcome,
    emitter: &Emitter,
) {
    // A successful memory mutation changed the store (the tool did the mutation and cap
    // enforcement); emit what it did and the set it left behind. The revisions come first: they
    // are the append-only record — including of a memory that was just deleted, which the
    // snapshot that follows can no longer show. The pinned memory block is not touched here, nor
    // at the next turn boundary; it is rebuilt at a compaction boundary (see
    // `refresh_boundary_blocks`).
    if is_memory_tool(&call.name) && outcome.ok {
        for event in modules.memories_mut().drain_events() {
            emitter.emit(event);
        }
        context.push_tool_result(tool_output_source(&call.name), &call.id, outcome.output);
        return;
    }

    // A successful task mutation changed the DAG (the tool did the mutation and the cycle
    // check); re-emit the state so the console tracks the live DAG. The pinned task block
    // is refreshed at the next turn boundary, like the memory block.
    if is_task_tool(&call.name) && outcome.ok {
        if let Some(state) = modules.tasks().state_event() {
            emitter.emit(state);
        }
        context.push_tool_result(tool_output_source(&call.name), &call.id, outcome.output);
        return;
    }

    // A successful board mutation changed the epic/issue board (the tool did the mutation, the
    // invariant checks, and the cycle check); re-emit the state so the console tracks the live
    // board. The pinned board block is refreshed at the next turn boundary, like the task block.
    if is_board_tool(&call.name) && outcome.ok {
        if let Some(state) = modules.board().state_event() {
            emitter.emit(state);
        }
        context.push_tool_result(tool_output_source(&call.name), &call.id, outcome.output);
        return;
    }

    // Only a *successful* `read_skill` names a real skill to pin; a failed one (unknown
    // name, missing argument) is ordinary tool output the model can recover from.
    if call.name == READ_SKILL_TOOL
        && outcome.ok
        && let Some(name) = call.arguments.get("name").and_then(Value::as_str)
    {
        match modules.skills_mut().record_read(name) {
            ReadRecord::Fresh => {
                // Pin the skill body so context accounting attributes it to skills and
                // compaction retains it verbatim.
                //
                // A skill whose whole content is code has no body, and this path must still answer
                // the call it is answering: a provider requires a `tool` message after the
                // assistant `tool_calls` that asked for one, and refuses an empty `content`. So an
                // empty body is answered with one sentence saying so, which is also the truth about
                // what this agent got — code halves reach a program and there are none here.
                let body = match outcome.output.trim().is_empty() {
                    true => format!("Skill `{name}` carries no text for this agent to read."),
                    false => outcome.output,
                };
                context.push(
                    GgContextSource::Skill,
                    Retention::Pinned,
                    crate::model::Message::tool_result(&call.id, body),
                );
                if let Some(state) = modules.skills().state_event() {
                    emitter.emit(state);
                }
                return;
            }
            ReadRecord::Repeat => {
                // Answer the call without re-pinning: the body is already in context.
                context.push_tool_result(
                    GgContextSource::ToolOutput,
                    &call.id,
                    format!(
                        "Skill `{name}` is already loaded in your context from an earlier read."
                    ),
                );
                return;
            }
            // Defensive: a successful read of an unknown name should not happen, but if it
            // does, treat it like any other tool output rather than dropping it.
            ReadRecord::Unknown => {}
        }
    }

    // Tag the result by source so the breakdown separates file views (evictable) from
    // other tool output. A `read_file` result is a file view tagged with its path, so
    // agent-managed context can evict it by path (`evict_file_view { path }`).
    // A `read_file` of a picture attaches the image to its own result, so the read and
    // what it returned stay one item: one thing to account for, one thing to evict, and
    // one thing to strip if the provider turns out to refuse images.
    let source = tool_output_source(&call.name);
    if source == GgContextSource::FileView {
        let path = call
            .arguments
            .get("path")
            .and_then(Value::as_str)
            .map(str::to_string);
        // The line window the read actually **returned**, when it was not the whole file — recorded on
        // the view so [agent persistence](crate::persistence) can re-open a paged read over the same
        // lines rather than from the top of the file. Taken from what the tool reports rather than from
        // the call's `offset`/`limit`, because the two disagree whenever the run's
        // [read policy](ReadPolicy) supplies a default the call did not name, or the file ends
        // before the window does.
        let region = match &outcome.data {
            Some(ApiData::FileText(text)) => FileRegion::covered(
                text.first_line.into(),
                text.last_line.into(),
                text.total_lines.into(),
            ),
            _ => None,
        };
        context.push_file_view(path, region, &call.id, outcome.output, outcome.images);
    } else {
        context.push_tool_result_with_images(source, &call.id, outcome.output, outcome.images);
    }
}

/// Run one model turn, recovering from a provider that will not accept the images the
/// conversation carries.
///
/// The ordinary path is one `complete` call. The recovery path exists because a model's
/// image support cannot always be known in advance: the catalog may have no modality
/// list for a just-released model, and gg deliberately treats that as "try it" rather
/// than withholding a test case's reference mockups from a model that can probably see
/// them. When that optimism is wrong, the provider answers with
/// [`VisionUnsupported`](ModelError::VisionUnsupported), and this:
///
/// 1. **records the model as unable to see images** in the run-wide
///    [registry](crate::vision::VisionSupport) — shared across agents, so every other
///    agent and subagent on the same model stops attaching images too, and no later turn
///    repeats the mistake;
/// 2. **strips the images from the context**, leaving each affected tool result's text
///    and its `tool_call_id` in place (so every assistant tool call still has its
///    matching result and the conversation stays well-formed) plus a note explaining
///    where the picture went;
/// 3. **re-runs the same turn** against the now image-free conversation.
///
/// Reading a reference image therefore costs a text-only run one wasted request, not the
/// run. If there was nothing to strip the original error is returned unchanged — the
/// refusal was not actually about images gg put there, and retrying identically would
/// spin.
async fn complete_with_vision_recovery(
    client: &dyn ModelClient,
    context: &mut ContextModel,
    tools: &[ToolDefinition],
    required: Option<&ToolDefinition>,
    vision: &Arc<VisionSupport>,
    emitter: &Emitter,
) -> Result<ModelResponse, ModelError> {
    let err = match model_request(client, &context.messages(), tools, required).await {
        Ok(response) => return Ok(response),
        Err(err) => err,
    };
    let Some(model_id) = err.vision_unsupported_model() else {
        return Err(err);
    };
    let first = vision.deny(model_id);
    let stripped = context.strip_images(IMAGE_STRIPPED_NOTE);
    if stripped == 0 {
        return Err(err);
    }
    if first {
        emitter.emit(log(
            "warn",
            format!(
                "`{model_id}` does not accept image input, so {stripped} image(s) were removed \
                 from the context and the turn retried. Images will not be shown to this model \
                 again for the rest of the run."
            ),
        ));
    }
    model_request(client, &context.messages(), tools, required).await
}

/// One model request in the shape this turn requires: the ordinary offered toolset, or — on a
/// responses-as-code turn — the one `submit_program` tool with the reply **required** to call it
/// ([`ModelClient::complete_requiring`]), which is the wire form of the protocol rather than a
/// preference the model may decline.
async fn model_request(
    client: &dyn ModelClient,
    messages: &[Message],
    tools: &[ToolDefinition],
    required: Option<&ToolDefinition>,
) -> Result<ModelResponse, ModelError> {
    match required {
        Some(tool) => client.complete_requiring(messages, tool).await,
        None => client.complete(messages, tools).await,
    }
}

/// The line appended to a tool result whose image was [stripped](ContextModel::strip_images).
///
/// The model is told plainly rather than left to notice a picture it was shown is gone:
/// a tool result that quietly changed shape between turns reads as a glitch, and a model
/// that does not know it cannot see images will keep reading them.
const IMAGE_STRIPPED_NOTE: &str = "[The image could not be shown: the model running this session \
     does not accept image input. Reading it again will not help — work from the written \
     specification instead.]";

/// Emit a [`Usage`](GgTelemetryKind::Usage) event for a turn when it reported any
/// tokens or cost, attributed to the `slot` (agent profile) and `model_id` that spent it.
///
/// The attribution is what makes a *live* multi-model run readable: a bare delta can only be
/// summed into one figure, so a console watching a run that spans several models could show the
/// money going out but not where — the per-model split had to wait for the end-of-agent
/// [`SlotUsage`](GgTelemetryKind::SlotUsage) rollups. Stamping each delta with its own
/// `(slot, model)` makes every consumer's breakdown derivable from the first turn on, and summing
/// the deltas of one key reproduces that key's rollup exactly.
fn record_usage(response: &ModelResponse, emitter: &Emitter, profile_id: &str, model_id: &str) {
    if response.usage == TokenCounts::default() && response.cost.is_none() {
        return;
    }
    emitter.emit(GgTelemetryKind::Usage {
        profile_id: profile_id.to_string(),
        model_id: model_id.to_string(),
        tokens: response.usage,
        cost: response.cost,
        provider: response.provider.clone(),
    });
}

/// The size of the reply a turn was judged on, in the two units an output ceiling is judged in:
/// its generated **characters** — the reply's text plus, on a responses-as-code turn, the
/// `program` string of each `submit_program` call it made, which is where such a turn's real
/// output travels — and its **completion tokens** as the provider billed them (output plus
/// reasoning, which is the figure a provider's output cap is measured against).
///
/// Threaded into [`record_turn`](Agent::record_turn) so the turn's outcome event carries it and
/// [`GgSessionSummary::max_response_chars`](test_cabinet_core::gg::GgSessionSummary) /
/// [`max_response_output_tokens`](test_cabinet_core::gg::GgSessionSummary) can be folded as maxima
/// over the turns that **worked** — the datum the owner reads before choosing an output ceiling,
/// which must accommodate every reply that was doing its job.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct ResponseSize {
    /// The reply's raw text, in characters.
    chars: u64,
    /// The reply's completion tokens (output plus reasoning), when the provider reported usage.
    output_tokens: u64,
}

impl ResponseSize {
    /// No reply at all — what a turn that never got one records.
    fn none() -> Self {
        Self::default()
    }

    /// Measure `response` — the raw reply, exactly as sent: its text, plus the `program` string
    /// of every `submit_program` call it carried.
    fn of(response: &ModelResponse) -> Self {
        let text = response
            .text
            .as_deref()
            .map(|text| text.chars().count() as u64)
            .unwrap_or(0);
        let programs: u64 = response
            .tool_calls
            .iter()
            .filter(|call| call.name == completion::SUBMIT_PROGRAM_TOOL)
            .filter_map(|call| {
                call.arguments
                    .get("program")
                    .and_then(|value| value.as_str())
            })
            .map(|program| program.chars().count() as u64)
            .sum();
        Self {
            chars: text.saturating_add(programs),
            output_tokens: response
                .usage
                .output
                .unwrap_or(0)
                .saturating_add(response.usage.reasoning.unwrap_or(0)),
        }
    }
}

/// Add two [`TokenCounts`], summing each reported class and keeping a class `None`
/// only when it is unreported on both sides (matching the metrics contract's
/// "unreported is distinct from zero").
fn add_counts(acc: TokenCounts, delta: TokenCounts) -> TokenCounts {
    TokenCounts {
        uncached_input: add_opt_u64(acc.uncached_input, delta.uncached_input),
        cached_input: add_opt_u64(acc.cached_input, delta.cached_input),
        output: add_opt_u64(acc.output, delta.output),
        reasoning: add_opt_u64(acc.reasoning, delta.reasoning),
    }
}

/// Sum two optional token counts, treating an unreported side as zero but staying
/// `None` when both are unreported.
fn add_opt_u64(a: Option<u64>, b: Option<u64>) -> Option<u64> {
    match (a, b) {
        (None, None) => None,
        (a, b) => Some(a.unwrap_or(0) + b.unwrap_or(0)),
    }
}

/// Add two optional [`Cost`]s, summing the `comparable`/`actual` figures on the same
/// "unreported-is-not-zero" terms as [`add_counts`].
fn add_cost(acc: Option<Cost>, delta: Option<Cost>) -> Option<Cost> {
    match (acc, delta) {
        (None, other) | (other, None) => other,
        (Some(acc), Some(delta)) => Some(Cost {
            comparable: add_opt_f64(acc.comparable, delta.comparable),
            actual: add_opt_f64(acc.actual, delta.actual),
        }),
    }
}

/// Sum two optional costs, treating an unreported side as zero but staying `None`
/// when both are unreported.
fn add_opt_f64(a: Option<f64>, b: Option<f64>) -> Option<f64> {
    match (a, b) {
        (None, None) => None,
        (a, b) => Some(a.unwrap_or(0.0) + b.unwrap_or(0.0)),
    }
}

/// A human-readable provider label for a binding, for the resolution log line.
fn provider_label(binding: &GgSlotBinding) -> &'static str {
    if provider_for(binding).is_offline() {
        "mock"
    } else {
        "openrouter"
    }
}

/// A `Log` telemetry event.
fn log(level: &str, message: impl Into<String>) -> GgTelemetryKind {
    GgTelemetryKind::Log {
        level: level.to_string(),
        message: message.into(),
    }
}

/// A `SessionEnded` telemetry event with the given status.
fn session_ended(status: impl Into<String>) -> GgTelemetryKind {
    GgTelemetryKind::SessionEnded {
        status: status.into(),
    }
}

#[path = "agent.attribution.rs"]
mod attribution;

use attribution::{FaultedRun, TerminalStatus};

/// The run every agent task is cloned from is the run its endings are attributed against.
impl FaultedRun for Orchestrator {
    fn fault(&self) -> &FaultLatch {
        &self.fault
    }
}

/// The ceilings threaded into a turn loop carry the same run's latch — a clone of the
/// orchestrator's, taken where the loop is set up — so an ending inside the loop asks the run
/// through the value it already has in hand rather than reaching back out to the orchestrator.
impl FaultedRun for LimitsSetup {
    fn fault(&self) -> &FaultLatch {
        &self.fault
    }
}

// `pub(crate)` for one reader outside this module: the [bootstrap](crate::bootstrap) runs gg's own
// program against an api of its own, and the search view that program places has to be rendered by
// `render_search_results` — the loop's own rendering, so what an agent reads in its opening window
// is byte for byte what it will read after its own first search. A second rendering beside it would
// be the one description of the SDK nothing could check against the SDK.
#[path = "agent.code.rs"]
pub(crate) mod code;
use code::CodeFeedback;

use code::{CodeTurn, CodeTurnOutcome, CodeTurnState, run_code_turn};

#[path = "agent.transitions.rs"]
pub(crate) mod transitions;

use transitions::{
    Handoff, Opening, PendingFork, Succession, handle_exec, handle_fork, handle_transition,
    succession_note,
};

#[path = "agent.teardown.rs"]
mod teardown;

use teardown::{AgentTeardown, SpawnerLink};

/// **Every compile workspace a session has allocated in this process**, oldest first.
///
/// An agent's tree is allocated inside [`Agent::drive`] and reachable from nowhere the loop hands
/// back, so the gate that drives a real session and counts what that session compiled reads it from
/// here. nextest runs one process per test, so what this holds is one test's own sessions.
#[cfg(test)]
static DRIVEN_WORKSPACES: Mutex<Vec<crate::sandbox::AgentWorkspace>> = Mutex::new(Vec::new());

/// File the tree a session is about to compile in.
#[cfg(test)]
fn record_compile_workspace(workspace: &crate::sandbox::AgentWorkspace) {
    DRIVEN_WORKSPACES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .push(workspace.clone());
}

/// The compile workspaces the sessions driven in this process were given, oldest first.
#[cfg(test)]
fn driven_workspaces() -> Vec<crate::sandbox::AgentWorkspace> {
    DRIVEN_WORKSPACES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone()
}

#[cfg(test)]
#[path = "agent.test.rs"]
mod tests;
