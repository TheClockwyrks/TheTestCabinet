//! The gg **agent** and its turn loop.
//!
//! An [`Agent`] is one node in gg's [subagent tree](https://docs.testcabinet.ai/gg/subagents/):
//! it carries a stable [`id`](Agent::id), its spawner's id
//! ([`parent_id`](Agent::parent_id)), its [`depth`](Agent::depth) in the tree, and the model
//! [`slot`](Agent::slot) it runs on (its live lifecycle is streamed as
//! [`AgentStatus`](test_cabinet_core::gg::GgTelemetryKind::AgentStatus) telemetry). Its
//! [turn loop](Agent::drive) is gg's core — the one coarse-grained plug point of the design
//! (all other modularity comes from [which tools](crate::tools) are offered). The loop drives
//! one agent: build a model request from the conversation and the offered toolset, send it via
//! the agent's [client](crate::client), record the assistant's message and tool calls, dispatch
//! each tool, append the results, and repeat until the model stops calling tools — emitting
//! [agent-tagged telemetry](crate::telemetry::Emitter::for_agent) throughout.
//!
//! Today a run is a single agent — the **root** (id [`ROOT_AGENT_ID`], depth `0`, on the
//! [`primary`](PRIMARY_SLOT) slot), created from the invocation. The structure is deliberately
//! multi-agent-ready: [`run`] owns the [orchestration](SlotAccounting) — resolving each agent's
//! client **by slot** (honoring the [multi-model](CAPABILITY_MULTI_MODEL) toggle), accounting
//! usage/cost **per slot**, and streaming the agent tree — so Phase 4B attaches spawning by
//! constructing a child [`Agent`], resolving its slot's client, and driving it exactly as the
//! root is driven here (see the seam noted on [`Agent::drive`]).
//!
//! # Control flow
//!
//! [`run`] frames one session:
//!
//! 1. scope the emitter to the [root agent](ROOT_AGENT_ID) and emit
//!    [`SessionStarted`](GgTelemetryKind::SessionStarted);
//! 2. [validate the slot bindings](validate_slots) and resolve the root agent's
//!    [`primary`](PRIMARY_SLOT) slot to a concrete [`ModelClient`] (mock or OpenRouter). A
//!    missing/invalid slot or an unresolvable client is a **launch failure**: it emits a
//!    [`Log`](GgTelemetryKind::Log)`(error)` and
//!    [`SessionEnded`](GgTelemetryKind::SessionEnded)`{status:"error"}` and returns
//!    [`SessionOutcome::LaunchFailed`] so the process exits non-zero;
//! 3. emit [`AgentSpawned`](GgTelemetryKind::AgentSpawned) for the root, assemble the offered
//!    [toolset](ToolRegistry) from the run's enabled capabilities, and drive the root agent's
//!    [turn loop](Agent::drive) against the client;
//! 4. fold the agent's usage into the [per-slot accounting](SlotAccounting), emit the
//!    [`SlotUsage`](GgTelemetryKind::SlotUsage) rollups, a summary
//!    [`Log`](GgTelemetryKind::Log), and the terminal
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
//! shape of reply means "finished" and only a program calling [`finish`](FINISH_FUNCTION) ends the
//! session.
//!
//! # Termination and error surfacing
//!
//! The loop always ends, and always says how in the
//! [`SessionEnded`](GgTelemetryKind::SessionEnded) status:
//!
//! - `"completed"` — the model said it was done: it stopped calling tools, or — under
//!   [responses-as-code](CAPABILITY_RESPONSES_AS_CODE), where every reply is a program and no
//!   shape of reply means "finished" — a program called [`finish`](FINISH_FUNCTION);
//! - `"exhausted"` — the per-agent turn ceiling was reached;
//! - `"timed_out"` — the optional wall-clock deadline was passed;
//! - `"limit_exceeded"` — one of the three configurable [execution ceilings](crate::limits) was
//!   breached: too many consecutive error turns, too high a recent error rate, or the run's
//!   accumulated cost. Which one, and at what value, is on the
//!   [`LimitExceeded`](GgTelemetryKind::LimitExceeded) event and the session summary;
//! - `"model_error"` — a model turn failed (retryable-exhausted **or** fatal), or gg's own
//!   sandbox machinery did. gg ends the session **loudly** — a `Log(error)` plus this status —
//!   never silently:
//!   a known failure mode of another harness is discarding a whole run on one API
//!   error, and gg's whole point is that the failure is visible in the stream;
//! - `"auth_error"` — the run's credential was refused (absent, or a `401`/`403` from
//!   the provider). Called out separately from `"model_error"` because nothing about
//!   the model was exercised: the key The Test Cabinet supplied was rejected, so the
//!   run is an operator fault and must not be scored against the model;
//! - `"error"` — a launch failure (no bound slot, or the client could not resolve).
//!
//! A launch failure (`"error"`) and an auth failure (`"auth_error"`) exit the process
//! non-zero, so `core` records them as harness errors; a session that ran and ended
//! for any other reason is a *run outcome* recorded in the telemetry, not a process
//! failure, and exits `0`.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde_json::Value;
use test_cabinet_core::gg::{
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_CODE_REVIEWS, CAPABILITY_CONTEXT_VISIBILITY,
    CAPABILITY_MEMORIES, CAPABILITY_MULTI_MODEL, CAPABILITY_PROJECT_MANAGEMENT, CAPABILITY_REPLAY,
    CAPABILITY_RESPONSES_AS_CODE, CAPABILITY_SKILLS, CAPABILITY_SPECULATIVE, CAPABILITY_SUBAGENTS,
    CAPABILITY_TASKS, CAPABILITY_WORKFLOWS, CAPABILITY_WORKTREES, GgAgentStatus, GgCandidateShape,
    GgCapabilitySet, GgCodeReviewPhase, GgContextAction, GgContextSource, GgHealingStrategy,
    GgLimitBreach, GgLimitKind, GgNotAProgram, GgPlanPhase, GgResponseHealing, GgRunLimits,
    GgSlotBinding, GgSpeculationPhase, GgTelemetryKind, GgWorkflowPhase, PRIMARY_SLOT,
};
use test_cabinet_core::metrics::{Cost, TokenCounts};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

use crate::archive::ArchiveStore;
use crate::board::{BoardCaps, BoardRuntime, IssueStatus};
use crate::client::{ClientFactory, DefaultClientFactory, provider_for};
use crate::compaction::{self, CompactionSetup, RetainedCounts, compact_if_needed};
use crate::config::GgInvocation;
use crate::context::{
    BpeTokenEstimator, ContextModel, Retention, TokenEstimator, tool_output_source,
};
use crate::fsm::{
    FsmRuntime, MACHINE_REVIEW_GATED, StateExit, ToolPolicy, configured_machine, is_builtin_machine,
};
use crate::git;
use crate::healing::{
    self, CandidateShape, Healed, HealingConfig, HealingStrategy, HealingVerdict,
    NotAProgramReason, plural,
};
use crate::limits::{
    AgentLimits, FatalFault, RunLimits, RunSpend, TurnErrorKind, TurnOutcome, resolve_run_limits,
};
use crate::memories::{MemoriesRuntime, MemoryCaps};
use crate::message_log::finish_reason_token;
use crate::model::{
    ImageContent, Message, ModelClient, ModelError, ModelResponse, ToolCall, ToolDefinition,
};
use crate::planning::PlanningRuntime;
use crate::prompts::{
    self, BoardView, CodeCallView, CodeErrorView, CodeNotAProgramContext, CodeResultContext,
    CodeSandboxErrorContext, CodeTranspileErrorContext, FsmView, MemoriesView, ReadFileView,
    SystemContext, TasksView, ToolView,
};
use crate::replay::{GgRecorder, RecordingClient};
use crate::sandbox::{
    self, FINISH_FUNCTION, PROGRAM_CALL_ID_PREFIX, ProgramResult, SandboxError, SandboxLimits,
    SandboxOutcome, ToolInvoker, UnreachableTail, run_program, scope_tools,
};
use crate::skills::{DEFAULT_SKILLS_DIR, ReadRecord, SkillLibrary, SkillsRuntime};
use crate::subagents::{
    AgentCtx, AgentReturn, ChildHandle, ParentWait, Scheduler, SubagentConfig, WaiterToken,
};
use crate::tasks::{TasksRuntime, resolve_max_tasks, resolve_task_mode};
use crate::telemetry::Emitter;
use crate::tools::VisionContext;
use crate::tools::{
    ARCHIVE_THREAD_TOOL, AgentStatusData, COMPLETE_ISSUE_TOOL, CompletionData,
    DEFAULT_ARCHIVE_KEEP_RECENT, ENTER_PLAN_MODE_TOOL, EVICT_FILE_VIEW_TOOL, READ_FILE_TOOL,
    READ_SKILL_TOOL, RUN_WORKFLOW_TOOL, ReadPolicy, ReclaimData, RuntimeSet, SEND_MESSAGE_TOOL,
    SPAWN_SUBAGENT_TOOL, SPECULATE_TOOL, SUBMIT_PLAN_TOOL, SpeculationData, SubagentHandleData,
    SubagentResultData, TURN_LEVEL_TOOLS, ToolContext, ToolData, ToolFailure, ToolOutcome,
    ToolRegistry, WAIT_FOR_ISSUE_TOOL, WAIT_FOR_SUBAGENTS_TOOL, WorkflowData, is_board_tool,
    is_context_reclaim_tool, is_fsm_tool, is_memory_tool, is_planning_tool, is_subagent_tool,
    is_task_tool, parse_archive_keep_recent, parse_evict_path, plan_mode_offers, read_policy,
    saturating_u32, saturating_u64, unknown_disabled_tools,
};
use crate::vision::VisionSupport;

/// Capability param (context-visibility by convention, read from any capability that
/// carries it) naming the context window to run the model against, in tokens. It may only
/// *narrow* the [catalog's figure](GgInvocation::model_windows) — the model's real window is
/// a hard limit — so a larger value is clamped to it, and a value of `0` or a non-integer is
/// ignored. Narrowing it is how a study exercises compaction against a 1M-token model
/// without paying for a million tokens of input.
const PARAM_WINDOW_LIMIT: &str = "windowLimit";

/// Skills capability param naming the directory authored skills are loaded from. A
/// relative value is resolved against the run workspace; an absolute one is used as
/// given. When absent, [`DEFAULT_SKILLS_DIR`] under the workspace is used.
const PARAM_SKILLS_DIR: &str = "dir";

/// The [`SessionEnded`](GgTelemetryKind::SessionEnded) status for a session that ended because the
/// **model** said it was done — a tool-calling turn that requested no tools, or, under
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE), a program that called
/// [`finish`](FINISH_FUNCTION).
///
/// Named rather than spelled out at each of its sites because it is also what the worktree merge
/// gate, the Code Review verdict and the speculation candidate filter test a child agent against:
/// one string with five readers is one string that must not be typed six times.
const STATUS_COMPLETED: &str = "completed";

/// The [`SessionEnded`](GgTelemetryKind::SessionEnded) status for an agent that took every turn its
/// [ceiling](RunLimits::max_turns) allowed without finishing.
const STATUS_EXHAUSTED: &str = "exhausted";

/// The [`SessionEnded`](GgTelemetryKind::SessionEnded) status for a run that spent its wall-clock
/// budget ([`RunLimits::max_runtime`]).
const STATUS_TIMED_OUT: &str = "timed_out";

/// The [`SessionEnded`](GgTelemetryKind::SessionEnded) status for an agent stopped by one of the
/// three [execution ceilings](RunLimits) that do not predate this vocabulary — consecutive errors,
/// the recent error rate, or accumulated cost.
///
/// The turn and runtime ceilings keep their own long-standing statuses ([`STATUS_EXHAUSTED`],
/// [`STATUS_TIMED_OUT`]) even though they now record the same [breach](GgLimitBreach), because
/// re-labelling them would rewrite the meaning of every historical run. Which ceiling stopped a run
/// is answered by the breach, not by the status.
///
/// It is **not** a failure status ([`is_failure_status`]): a spent ceiling is the operator's bound,
/// not the agent failing at its work, which is exactly why `exhausted` and `timed_out` are excluded
/// too.
const STATUS_LIMIT_EXCEEDED: &str = "limit_exceeded";

/// The [`SessionEnded`](GgTelemetryKind::SessionEnded) status for a session a model
/// turn failed in — the model was reached and did not deliver a usable turn.
const STATUS_MODEL_ERROR: &str = "model_error";

/// The [`SessionEnded`](GgTelemetryKind::SessionEnded) status for a session whose
/// **credential** was refused. Distinct from [`STATUS_MODEL_ERROR`] because it is an
/// operator fault, and the only non-launch status that exits the process non-zero (see
/// [`SessionOutcome`]).
const STATUS_AUTH_ERROR: &str = "auth_error";

/// Whether a terminal loop status means the agent failed (as opposed to finishing,
/// exhausting its turns, or timing out) — the two error statuses above.
fn is_failure_status(status: &str) -> bool {
    status == STATUS_MODEL_ERROR || status == STATUS_AUTH_ERROR
}

/// Whether one gg session launched at all.
///
/// This is the only thing the process exit code reflects: a session that *ran* — no
/// matter how it ended (completed, model error, exhausted, timed out) — is a success
/// at the process level, with the real outcome carried in the telemetry stream. Only
/// a [`LaunchFailed`](Self::LaunchFailed) (no model to run) exits non-zero.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionOutcome {
    /// A session was driven to a [`SessionEnded`](GgTelemetryKind::SessionEnded). The
    /// process exits `0`; the session's status is in the telemetry.
    Ran,
    /// No session could be run against a working model: the invocation could not launch
    /// one (no bound `primary` slot, or the client could not be resolved), or every
    /// model call was refused because the run's credential was rejected
    /// ([`STATUS_AUTH_ERROR`]). The process exits non-zero, so `core` records a harness
    /// error rather than a scoreable run — a rejected key is our fault, not the
    /// model's, and scoring it would blame a model that never ran.
    LaunchFailed,
}

/// The stable id of the **root** agent — the top of the [subagent
/// tree](https://docs.testcabinet.ai/gg/subagents/), created from the run invocation. A
/// single-agent run has only this agent; Phase 4B gives spawned subagents generated ids
/// beneath it.
pub const ROOT_AGENT_ID: &str = "root";

/// The conventional [model slot](GgSlotBinding) a [Code Review](handle_code_review)'s reviewer runs
/// on when [multi-model](CAPABILITY_MULTI_MODEL) is enabled and the slot is bound: a dedicated
/// `reviewer` model, distinct from the model that did (and will fix) the work. When multi-model is
/// off, or no `reviewer` slot is bound, the reviewer collapses to the [`primary`](PRIMARY_SLOT)
/// slot like any other agent.
const REVIEWER_SLOT: &str = "reviewer";

/// The conventional [model slot](GgSlotBinding) a [speculative execution](handle_speculate)'s judge
/// runs on when [multi-model](CAPABILITY_MULTI_MODEL) is enabled and it is bound: a dedicated `judge`
/// model that scores the K attempts. When absent (or multi-model off), the judge falls back to the
/// [`reviewer`](REVIEWER_SLOT) slot if bound, else the [`primary`](PRIMARY_SLOT) slot — so a
/// best-of-K run needs no extra slot binding to work.
const JUDGE_SLOT: &str = "judge";

/// The default number of parallel attempts a [`speculate`](handle_speculate) call makes when it names
/// no `attempts` count.
const DEFAULT_SPECULATION_ATTEMPTS: u64 = 2;

/// The maximum number of parallel attempts a [`speculate`](handle_speculate) call may make. Best-of-K
/// multiplies token cost by K, and the attempts share the one global parallelism cap, so a generous
/// but firm ceiling keeps a single call from fanning out unboundedly.
const MAX_SPECULATION_ATTEMPTS: u64 = 6;

/// One node in gg's [subagent tree](https://docs.testcabinet.ai/gg/subagents/): the unit the
/// [turn loop](Self::drive) drives.
///
/// An agent carries its **identity** in the tree — a stable [`id`](Self::id), its spawner's
/// [`parent_id`](Self::parent_id) (`None` for the root), its [`depth`](Self::depth), and the
/// model [`slot`](Self::slot) it runs on. The identity is what agent-tagged
/// [telemetry](crate::telemetry::Emitter::for_agent) streams, so the console can reconstruct
/// who-spawned-whom and account usage per slot; its live lifecycle (running → blocked → done/
/// failed) is streamed as [`AgentStatus`](GgTelemetryKind::AgentStatus) telemetry rather than kept
/// on the struct.
///
/// The agent's *resources* — its [context model](ContextModel), its [toolset](ToolRegistry),
/// and the capability [runtimes](RuntimeSet) — are constructed **per agent** by the
/// [orchestrator](Orchestrator) and handed to [`drive`](Self::drive) by [`run_agent`]. Keeping
/// resource construction in the orchestrator (rather than the struct) is the multi-agent seam: a
/// spawn builds a child agent's context/toolset/runtimes the same way the root's are built, then
/// drives it identically.
pub struct Agent {
    /// The agent's stable id in the tree ([`ROOT_AGENT_ID`] for the root).
    pub id: String,
    /// The id of the agent that spawned this one, or `None` for the root.
    pub parent_id: Option<String>,
    /// The agent's depth in the tree: `0` for the root, `parent.depth + 1` for a child.
    pub depth: usize,
    /// The model [slot](GgSlotBinding) this agent runs on.
    pub slot: String,
}

impl Agent {
    /// The **root** agent for a run: [`ROOT_AGENT_ID`], no parent, depth `0`, on `slot`
    /// (the [`primary`](PRIMARY_SLOT) slot).
    pub fn root(slot: impl Into<String>) -> Self {
        Self {
            id: ROOT_AGENT_ID.to_string(),
            parent_id: None,
            depth: 0,
            slot: slot.into(),
        }
    }
}

/// The per-slot (and per-model-within-slot) usage/cost accounting the orchestrator owns.
///
/// A gg run spans **several models** — subagents can run on different, possibly cross-provider,
/// [slots](GgSlotBinding) than the parent — so usage and cost are accumulated per slot rather
/// than as one figure for one model (this is why a gg run cannot be a single point on the
/// per-model metric graphs; see the [multi-model](https://docs.testcabinet.ai/gg/multi-model/)
/// design). Each agent's loop reports its total tagged with the slot it ran on
/// ([`LoopEnd::slot`]); the orchestrator [`record`](Self::record)s it here, keyed by
/// `(slot, model)`, and emits one [`SlotUsage`](GgTelemetryKind::SlotUsage) rollup per key.
#[derive(Default)]
struct SlotAccounting {
    /// One entry per `(slot, model)` the run touched, in first-seen order.
    entries: Vec<SlotAccountEntry>,
}

/// One `(slot, model)` rollup in the [`SlotAccounting`].
struct SlotAccountEntry {
    /// The slot this rollup accounts for.
    slot: String,
    /// The model id (within the slot) this rollup accounts for.
    model_id: String,
    /// The tokens accumulated on this slot/model.
    tokens: TokenCounts,
    /// The cost accumulated on this slot/model, when any turn reported one.
    cost: Option<Cost>,
}

impl SlotAccounting {
    /// Add one agent's usage/cost to the `(slot, model)` rollup, summing into any existing
    /// entry (so several agents on the same slot/model accumulate) or starting a new one.
    fn record(&mut self, slot: &str, model_id: &str, tokens: TokenCounts, cost: Option<Cost>) {
        if let Some(entry) = self
            .entries
            .iter_mut()
            .find(|entry| entry.slot == slot && entry.model_id == model_id)
        {
            entry.tokens = add_counts(entry.tokens, tokens);
            entry.cost = add_cost(entry.cost, cost);
        } else {
            self.entries.push(SlotAccountEntry {
                slot: slot.to_string(),
                model_id: model_id.to_string(),
                tokens,
                cost,
            });
        }
    }

    /// One [`SlotUsage`](GgTelemetryKind::SlotUsage) rollup per recorded `(slot, model)`, in
    /// first-seen order — the per-slot cost breakdown the console renders.
    fn slot_usage_events(&self) -> Vec<GgTelemetryKind> {
        self.entries
            .iter()
            .map(|entry| GgTelemetryKind::SlotUsage {
                slot: entry.slot.clone(),
                model_id: entry.model_id.clone(),
                tokens: entry.tokens,
                cost: entry.cost,
            })
            .collect()
    }
}

/// Resolve the model slot an agent that requested `requested_slot` actually runs on, given
/// whether the [multi-model](CAPABILITY_MULTI_MODEL) capability is enabled.
///
/// With multi-model **on**, an agent runs on the slot it requested (so a subagent can be
/// dispatched on a cheaper or role-specific slot). With it **off**, every agent collapses to the
/// [`primary`](PRIMARY_SLOT) slot — the ablation off arm that pins a whole run to a single model.
/// The root always requests [`primary`](PRIMARY_SLOT), so the toggle only becomes observable once
/// Phase 4B spawns subagents on other slots. Pure, so the rule is unit tested directly.
fn effective_slot(requested_slot: &str, multi_model_enabled: bool) -> &str {
    if multi_model_enabled {
        requested_slot
    } else {
        PRIMARY_SLOT
    }
}

/// Find the [binding](GgSlotBinding) for `slot` in `set`, or an error naming the missing slot.
/// The seam every agent resolves its client through: the root looks up [`primary`](PRIMARY_SLOT);
/// Phase 4B looks up a child's [effective slot](effective_slot).
fn slot_binding<'a>(set: &'a GgCapabilitySet, slot: &str) -> Result<&'a GgSlotBinding, String> {
    set.slots
        .iter()
        .find(|binding| binding.slot == slot)
        .ok_or_else(|| format!("no `{slot}` model slot is bound; there is no model to run"))
}

/// Validate a run's [slot bindings](GgSlotBinding) before launch: the [`primary`](PRIMARY_SLOT)
/// slot must be bound (the root has no model otherwise), every binding must name a non-empty slot
/// and model id, and no slot name may be bound twice (an ambiguous binding). Returns a
/// human-readable error on the first problem, so a misconfiguration fails loudly at launch rather
/// than resolving an arbitrary binding mid-run. Pure, so it is unit tested directly.
fn validate_slots(set: &GgCapabilitySet) -> Result<(), String> {
    let mut seen: Vec<&str> = Vec::with_capacity(set.slots.len());
    for binding in &set.slots {
        if binding.slot.trim().is_empty() {
            return Err("a slot binding has an empty slot name".to_string());
        }
        if let Some(model_slot) = binding
            .model_slot
            .as_deref()
            .filter(|_| !binding.is_resolved())
        {
            // A configuration is launched, not run: whoever launched it was supposed to
            // fill in every deferred model slot. One left over means the launch skipped
            // it, so say which — the operator can only fix it on the launch form.
            return Err(format!(
                "the `{}` slot still defers to the `{model_slot}` model slot; \
                 launching must bind a model to it",
                binding.slot
            ));
        }
        if binding.model_id.trim().is_empty() {
            return Err(format!(
                "the `{}` slot is bound to an empty model id",
                binding.slot
            ));
        }
        if seen.contains(&binding.slot.as_str()) {
            return Err(format!(
                "the `{}` slot is bound more than once",
                binding.slot
            ));
        }
        seen.push(&binding.slot);
    }
    if !set.slots.iter().any(|binding| binding.slot == PRIMARY_SLOT) {
        return Err(format!(
            "no `{PRIMARY_SLOT}` model slot is bound; there is no model to run"
        ));
    }
    Ok(())
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
    // Production resolves every agent's client through the default factory (the
    // `TCAB_GG_FAKE_MODEL`/`mock` rules, else live OpenRouter). Tests inject a scripted factory so
    // a parent and its subagents run distinct offline scripts.
    run_with_factory(invocation, emitter, Arc::new(DefaultClientFactory)).await
}

/// [`run`], but with an injectable [`ClientFactory`] so a test can drive the root and its
/// subagents from scripted offline clients. Owns the session frame: it scopes the root emitter,
/// emits [`SessionStarted`](GgTelemetryKind::SessionStarted), performs the launch checks (slot
/// validation, the [context windows](validate_model_windows) every bound model must carry, and
/// the root's client resolution — the only three [launch failures](SessionOutcome)),
/// builds the [`Orchestrator`], drives the [root agent](ROOT_AGENT_ID), then joins every spawned
/// subagent, streams the [per-slot](SlotAccounting) rollups the run accumulated, and emits the
/// terminal [`SessionEnded`](GgTelemetryKind::SessionEnded).
pub(crate) async fn run_with_factory(
    invocation: &GgInvocation,
    emitter: &Emitter,
    factory: Arc<dyn ClientFactory>,
) -> SessionOutcome {
    let set = &invocation.capability_set;
    let multi_model = set.is_enabled(CAPABILITY_MULTI_MODEL);
    // The root runs on the `primary` slot: `effective_slot` collapses to primary when multi-model
    // is off, and the root already requests primary, so this is primary either way — the seam a
    // subagent requesting another slot reuses.
    let root_slot = effective_slot(PRIMARY_SLOT, multi_model).to_string();

    // Scope the stream to the root up front, so every event (launch diagnostics included) is
    // attributed to it.
    let root_emitter = emitter.for_agent(ROOT_AGENT_ID, None);
    // Announce the configuration on the very first event: a console watching the stream
    // then knows which capabilities are live from the start, and can shape itself to
    // this run rather than offering every surface gg has.
    root_emitter.emit(GgTelemetryKind::SessionStarted {
        capability_set: Some(set.clone()),
    });

    // Launch check 1: the slot bindings must be well-formed and bind `primary`.
    if let Err(err) = validate_slots(set) {
        root_emitter.emit(log("error", err));
        root_emitter.emit(session_ended("error"));
        return SessionOutcome::LaunchFailed;
    }
    let binding = match slot_binding(set, &root_slot) {
        Ok(binding) => binding.clone(),
        Err(err) => {
            root_emitter.emit(log("error", err));
            root_emitter.emit(session_ended("error"));
            return SessionOutcome::LaunchFailed;
        }
    };

    // Launch check 2: every bound model must have a context window to be measured against. gg
    // has no fallback to guess one with, by design, so this is a hard launch failure rather
    // than a run with silently mis-scaled context accounting.
    if let Err(err) = validate_model_windows(set, &invocation.model_windows) {
        root_emitter.emit(log("error", err));
        root_emitter.emit(session_ended("error"));
        return SessionOutcome::LaunchFailed;
    }

    // Launch check 3: the root's model client must resolve (a missing credential fails here). A
    // subagent's client is resolved at spawn time instead, where a failure is reported to its
    // spawner rather than failing the whole process.
    let client = match factory.client_for(&binding) {
        Ok(client) => client,
        Err(err) => {
            root_emitter.emit(log(
                "error",
                format!(
                    "could not resolve the `{root_slot}` slot (model `{}`): {err}",
                    binding.model_id
                ),
            ));
            root_emitter.emit(session_ended("error"));
            return SessionOutcome::LaunchFailed;
        }
    };

    // Resolve worktree isolation before building the orchestrator: when the worktrees capability is
    // on, make the workspace a git repo and commit its baseline (the commit Phase 5 Code Reviews
    // diff against), reporting any git-absent/failure loudly on the root's stream so a `worktree:
    // true` spawn is refused with a clear message rather than crashing.
    let worktrees = resolve_worktrees(set, &invocation.workspace_dir, &root_emitter);

    // Build the orchestrator: the shared, cross-task state every agent (the root and each
    // subagent) is built and driven from — the scheduler, the per-slot accounting, the offered
    // model factory, the shared skills library and token estimator, the resolved ceilings, deadline
    // and shared spend, the worktree isolation state, and the spawned-task registry the session
    // joins on before ending.
    let mut launch_warnings = Vec::new();
    let orch = Arc::new(Orchestrator::build(
        invocation,
        emitter,
        factory,
        multi_model,
        worktrees,
        &mut launch_warnings,
    ));

    // Every declaration gg could not act on, named on the root's stream before the first turn:
    // a ceiling that cannot bound anything, a ceiling left on a capability where gg no longer reads
    // it, a healing key that names nothing. None of them ever fails a launch — a sweep's one shared
    // configuration document must stay interpretable by every arm — so being loud here is the whole
    // of the defence against a typo silently running the wrong experiment.
    for warning in launch_warnings {
        root_emitter.emit(log("warn", warning));
    }
    // ...and the ceilings that *are* in force, including the turn ceiling's default, so "what was
    // this run bounded by?" is answerable from the operator log as well as from the summary.
    root_emitter.emit(log("info", orch.limits.armed_summary()));
    root_emitter.record_limits(recorded_limits(&orch.limits));
    // ...and, for a code-mode run, which response-healing strategies are armed. Recorded and logged
    // beside the ceilings because it is the same kind of fact — a resolved configuration that
    // decides how the run behaves — and because it is the one an ablation turns on: every healing
    // figure gg reports counts what *fired*, and the arm in which nothing fired looks exactly like
    // the arm in which nothing could. A tool-calling run says nothing, because healing never runs
    // there and an armed set recorded for one would be an intention with no effect.
    if orch.code.enabled {
        root_emitter.emit(log("info", orch.code.healing.armed_summary()));
        root_emitter.record_healing(
            orch.code
                .healing
                .armed()
                .into_iter()
                .map(code::wire_strategy)
                .collect(),
        );
    }

    // Warm the code sandbox, once per run and never from a subagent. The committed interpreter
    // component takes ~0.7 s to compile on a many-core machine and several seconds on one core, and
    // that compile is paid exactly once per process — so starting it *here*, concurrently with the
    // first model request (which takes far longer), takes it off the first code turn's critical
    // path entirely. Off when the capability is off: a tool-calling run must not pay for a sandbox
    // it will never enter.
    let warming = orch
        .code
        .enabled
        .then(|| tokio::task::spawn_blocking(sandbox::precompile));

    // Drive the root agent. Its inbox is unused (nothing spawns the root), but every agent owns
    // one for uniformity.
    let (_root_inbox_tx, root_inbox_rx) = mpsc::unbounded_channel();
    let root_agent = Agent::root(root_slot);
    let end = run_agent(
        Arc::clone(&orch),
        root_agent,
        AgentRole::Root,
        client,
        root_inbox_rx,
    )
    .await;

    // Report the warm-up, and report it *here* rather than from a detached task, so a diagnostic can
    // never land after the terminal `SessionEnded`. Draining costs nothing: the compile is behind a
    // `OnceLock`, so by the time the root has finished it has either completed or was never
    // contended. A failure is only ever a defect in the committed artifact — the first code turn
    // would have hit it too, and ended the session loudly — so this is a breadcrumb, not a
    // control-flow signal.
    //
    // The success case is logged too, with what the compile cost. It is the one measurement of this
    // machine's compile latency a reader of the stream can get without timing a turn from outside,
    // and it is core-count sensitive by a factor of seven — which is exactly the fact needed to
    // interpret a first program that took seconds. `None` means a code turn got there first and
    // paid the compile itself; that turn's own `CodeExecution` carries the figure instead.
    let warmed = match warming {
        Some(warming) => Some(warming.await),
        None => None,
    };
    match warmed {
        Some(Ok(Ok(Some(took)))) => root_emitter.emit(log(
            "info",
            format!(
                "the code sandbox's interpreter component compiled in {} ms, off the first turn's \
                 critical path.",
                took.as_millis()
            ),
        )),
        Some(Ok(Ok(None))) => root_emitter.emit(log(
            "info",
            "a code turn compiled the sandbox's interpreter component before the warm-up reached \
             it, so that turn paid the compile itself; its `CodeExecution` carries what it cost.",
        )),
        Some(Ok(Err(err))) => root_emitter.emit(log(
            "warn",
            format!("the code sandbox could not be warmed up ahead of the first turn: {err}"),
        )),
        // The blocking task itself failed to join, which only happens if the host panicked. There
        // is nothing to say about a compile that never reported either way.
        Some(Err(_)) | None => {}
    }

    // Join every subagent the run spawned (transitively). The root released its slot inside
    // `run_agent`, so cap-limited children that were waiting can now finish; a completed task has
    // already registered any children it spawned, so draining to empty joins the whole tree.
    loop {
        let handle = orch.tasks.lock().expect("subagent tasks lock").pop();
        match handle {
            Some(handle) => {
                let _ = handle.await;
            }
            None => break,
        }
    }

    // Stream the per-slot rollups the whole run accumulated (the root plus every subagent, keyed by
    // `(slot, model)`), so the console shows cost per slot even though the run spanned several
    // models, then close the session. The root's `end` names the session's terminal status.
    root_emitter.emit(log("info", end.summary()));
    {
        let accounting = orch.accounting.lock().expect("slot accounting lock");
        for usage in accounting.slot_usage_events() {
            root_emitter.emit(usage);
        }
    }
    root_emitter.emit(log(
        "info",
        format!(
            "root agent `{ROOT_AGENT_ID}` (slot `{root_slot_label}`) {status}.",
            root_slot_label = end.slot,
            status = if is_failure_status(end.status) {
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
    // Compute and emit the run's aggregatable session summary from the telemetry the run emitted
    // (the per-slot rollups above are now folded in), right before the terminal `SessionEnded`, so
    // `core` can lift it onto the run record and result aggregation need not re-parse the stream.
    let summary = root_emitter.finalize_summary(end.status);
    root_emitter.emit(GgTelemetryKind::SessionSummary {
        summary: Box::new(summary),
    });

    // Replay capture (debug-only): when the capability recorded a session, assemble the run's
    // `GgReplayRecord` from the shared recorder and write it to the `.gg/replay.json` sidecar `core`
    // collects, so the backend can serve it per run. Best-effort — a write failure is reported on the
    // stream (never fatal), like any telemetry, since replay is a debugging aid, not a run result.
    if let Some(recorder) = &orch.replay {
        write_replay_record(recorder, invocation, &root_emitter);
    }

    root_emitter.emit(session_ended(end.status));
    // A session whose credential was refused reached no model, so it is not a run
    // outcome to be scored — it is the same operator fault as a missing key, which
    // fails at launch check 2 above. Exit non-zero so `core` records a harness error
    // instead of collecting an empty tree and scoring it against the model.
    if end.status == STATUS_AUTH_ERROR {
        return SessionOutcome::LaunchFailed;
    }
    SessionOutcome::Ran
}

/// Write a [replay](CAPABILITY_REPLAY)-captured run's
/// [`GgReplayRecord`](test_cabinet_core::gg::GgReplayRecord) to the
/// [`.gg/replay.json`](test_cabinet_core::gg::GG_REPLAY_ARTIFACT_PATH) sidecar under the run
/// workspace.
///
/// Assembles the record (the session id, the run's capability set, and every recorded model-I/O and
/// tool-result entry in global sequence order), creates the `.gg/` directory, and writes the record
/// pretty-printed. Best-effort: any I/O or serialization failure is logged on the root stream rather
/// than failing the run, since the record is a debugging aid that must never abort the run it observes.
fn write_replay_record(recorder: &GgRecorder, invocation: &GgInvocation, emitter: &Emitter) {
    let record = recorder.to_record(
        invocation.session_id.clone(),
        invocation.capability_set.clone(),
    );
    let path = invocation
        .workspace_dir
        .join(test_cabinet_core::gg::GG_REPLAY_ARTIFACT_PATH);
    let write = (|| -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_vec_pretty(&record)
            .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err))?;
        std::fs::write(&path, json)
    })();
    match write {
        Ok(()) => emitter.emit(log(
            "info",
            format!(
                "replay capture: wrote {} entries to `{}`.",
                record.entries.len(),
                path.display()
            ),
        )),
        Err(err) => emitter.emit(log(
            "warn",
            format!(
                "replay capture: could not write the replay record to `{}`: {err}",
                path.display()
            ),
        )),
    }
}

/// The dispatch facts recorded for one [issue](test_cabinet_core::gg::GgBoardIssue) the first time
/// it is dispatched to a subagent, so a later [Code Review](handle_code_review) of it has an
/// issue-level baseline and knows where to run a fix agent.
struct IssueDispatchMeta {
    /// The commit `HEAD` sat at when the issue's work began — its review baseline. `None` when no
    /// git baseline was established this run (the review falls back to the run baseline, which is
    /// then also `None`).
    initial_commit: Option<String>,
    /// The [slot](GgSlotBinding) the issue's work was dispatched on, so a Code Review's fix agent
    /// re-runs the work on the same kind of model rather than defaulting to primary.
    work_slot: String,
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
    /// Whether [multi-model](CAPABILITY_MULTI_MODEL) is on — decides whether a subagent may run on
    /// a non-primary [slot](GgSlotBinding) or collapses to primary.
    multi_model: bool,
    /// Whether the [subagents](CAPABILITY_SUBAGENTS) capability is on — gates the spawn tools, the
    /// per-agent delegation context, and the agent-tree telemetry.
    subagents_enabled: bool,
    /// Whether the [project-management](CAPABILITY_PROJECT_MANAGEMENT) capability is on — gates the
    /// board tools, the `wait_for_issue` tool, and the auto-[dispatch](Self::pump_dispatch) of an
    /// actionable issue to a freshly spawned top-level agent. A run with it on is multi-agent even
    /// with [`subagents`](CAPABILITY_SUBAGENTS) off (see [`multi_agent`](Self::multi_agent)).
    project_management_enabled: bool,
    /// Whether the [workflows](CAPABILITY_WORKFLOWS) capability is on — gates the `run_workflow`
    /// tool. Workflows are built on the subagent machinery, so a run with workflows on (even if
    /// [`subagents`](CAPABILITY_SUBAGENTS) is off) still gets the per-agent delegation context and
    /// the agent-tree telemetry (see [`delegation_enabled`](Self::delegation_enabled)).
    workflows_enabled: bool,
    /// Whether the [worktrees](CAPABILITY_WORKTREES) capability is on (the raw toggle), gating the
    /// `worktree` spawn option. Distinct from whether isolation is actually *usable* this run —
    /// that is [`worktrees_root`](Self::worktrees_root)`.is_some()` — so a `worktree: true` spawn
    /// can tell "capability off" from "capability on but git unavailable".
    worktrees_capability: bool,
    /// Where per-agent [worktree](Worktree) checkouts are created (a sibling of the workspace),
    /// `Some` only when worktree isolation is usable (capability on, git present, baseline
    /// committed, root created). `None` disables worktree dispatch even if the capability is on.
    worktrees_root: Option<PathBuf>,
    /// The run's **baseline commit** — the seeded workspace committed at session start when the
    /// worktrees capability made the workspace a git repo. Every [worktree](Worktree) branches from
    /// it, and it is the "original commit for the run" Phase 5 Code Reviews diff against; recorded
    /// here (see [`baseline_commit`](Self::baseline_commit)) so that phase can reuse it. `None` when
    /// worktrees are off or git could not initialize a baseline.
    baseline_commit: Option<String>,
    /// Whether the [code-reviews](CAPABILITY_CODE_REVIEWS) capability is on — gates whether
    /// `complete_issue` triggers a [Code Review](handle_code_review) (which needs the delegation
    /// machinery to run a reviewer, so it only engages when [`delegation_enabled`](Self::delegation_enabled)).
    code_reviews_enabled: bool,
    /// Whether the [speculative-execution](CAPABILITY_SPECULATIVE) capability is on — gates the
    /// `speculate` tool (best-of-K). Like a Code Review it needs the delegation machinery (to fan out
    /// the attempts and run the judge), so it only engages when
    /// [`delegation_enabled`](Self::delegation_enabled); worktree isolation is checked at call time.
    speculative_enabled: bool,
    /// How a run conducts its turns when [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) is on:
    /// the run-wide mode flag, the per-program sandbox ceilings, and the armed
    /// [healing](crate::healing) strategies. Resolved once here and handed to every agent, because
    /// all three are properties of *how a turn is conducted*, not of a single agent.
    code: CodeSetup,
    /// Per-[issue](test_cabinet_core::gg::GgBoardIssue) dispatch facts a
    /// [Code Review](handle_code_review) needs: the commit the issue's work began at (its review
    /// baseline) and the [slot](GgSlotBinding) it was worked on (where a fix agent re-runs).
    /// Captured on the **first** dispatch of each issue and read back when the issue is completed;
    /// an issue never dispatched falls back to the run baseline and the primary slot. Guarded so
    /// concurrently-dispatching agents can record.
    issue_dispatch: Mutex<HashMap<String, IssueDispatchMeta>>,
    /// The run's **single, global** [project-management board](crate::board) — one
    /// [`BoardRuntime`] shared by every agent (each agent's board tools mutate this same store),
    /// and the queue the [dispatcher](Self::pump_dispatch) reads. [`disabled`](BoardRuntime::disabled)
    /// when the [project-management](CAPABILITY_PROJECT_MANAGEMENT) capability is off.
    board: BoardRuntime,
    /// The agents blocked in a [`wait_for_issue`](Self::begin_issue_wait), keyed by the issue id
    /// each awaits. Each entry is the [scheduler waiter tokens](WaiterToken) of the agents waiting
    /// on that issue; when the issue reaches a terminal state they are all
    /// [marked ready](Scheduler::mark_ready). Guarded so a completing agent and a fresh waiter can
    /// touch it concurrently.
    issue_waits: Mutex<HashMap<String, Vec<WaiterToken>>>,
    /// Serializes every git operation on the shared repository (worktree add/merge/remove, and a
    /// Code Review's baseline diff), since concurrently-finishing subagents would otherwise race on
    /// `.git` and the main working tree. Held only across the synchronous git calls, never across an
    /// await.
    git_lock: Mutex<()>,
    /// The resolved [parallelism and depth caps](SubagentConfig).
    config: SubagentConfig,
    /// The single global [scheduler](Scheduler) coordinating every agent's running slot.
    scheduler: Arc<Scheduler>,
    /// The per-`(slot, model)` usage/cost accounting every agent folds its total into.
    accounting: Mutex<SlotAccounting>,
    /// The base (unscoped) emitter each agent derives its scoped stream from.
    base_emitter: Emitter,
    /// The offered model factory each agent resolves its slot's client through.
    factory: Arc<dyn ClientFactory>,
    /// The shared skills library (loaded once), cloned into each agent's own skills runtime.
    skills_library: Arc<SkillLibrary>,
    /// Whether the [skills](CAPABILITY_SKILLS) capability is on.
    skills_enabled: bool,
    /// The shared token estimator (built once — the BPE vocab is expensive), backing every agent's
    /// context accounting.
    estimator: Arc<dyn TokenEstimator>,
    /// The [model catalog's context window](GgInvocation::model_windows) for each model this run
    /// can bind, as pushed in with the invocation. Consulted per agent, since a
    /// [multi-model](https://docs.testcabinet.ai/gg/multi-model/) run measures each agent against
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
    /// The join handles of every spawned subagent task, drained and awaited before the session
    /// ends. Guarded so concurrently-spawning agents can register their children.
    tasks: Mutex<Vec<JoinHandle<()>>>,
    /// A monotonic counter minting unique subagent ids.
    next_seq: AtomicU64,
    /// A monotonic counter minting unique [workflow](run_workflow) ids, so each `run_workflow`
    /// invocation's stages group under one id in the telemetry.
    next_workflow_seq: AtomicU64,
    /// The shared [replay recorder](GgRecorder) every agent's model I/O and tool results are pinned
    /// into, `Some` only when the [replay](CAPABILITY_REPLAY) capability is on. `None` (the default)
    /// means nothing extra is captured — zero overhead. Shared (`Arc`) so the root and every subagent
    /// record into one globally-ordered log; the assembled [`GgReplayRecord`](test_cabinet_core::gg::GgReplayRecord)
    /// is written to a sidecar at session end.
    replay: Option<Arc<GgRecorder>>,
}

impl Orchestrator {
    /// Build the orchestrator for `invocation`, loading the shared skills library and token
    /// estimator once and resolving the run-wide ceilings, deadline, healing strategies and
    /// subagent caps.
    ///
    /// `warnings` collects every operator-facing diagnostic the resolution produced — a ceiling that
    /// cannot bound anything, a stale `maxTurns` left on a capability, a `healing` key gg does not
    /// know. They are returned rather than emitted because this function is handed the run's
    /// **unscoped** emitter (the one it clones for every agent), while a launch diagnostic belongs
    /// on the root agent's stream alongside the rest of them; the caller has that stream and emits
    /// them there, before the first turn.
    fn build(
        invocation: &GgInvocation,
        emitter: &Emitter,
        factory: Arc<dyn ClientFactory>,
        multi_model: bool,
        worktrees: WorktreesSetup,
        warnings: &mut Vec<String>,
    ) -> Self {
        let set = &invocation.capability_set;
        // Load the skills library once (empty when the capability is off or nothing is seeded) and
        // share its Arc across agents; each agent keeps its own read-state runtime over it.
        let skills = resolve_skills(set, &invocation.workspace_dir);
        let limits = resolve_run_limits(set, warnings);
        let deadline = limits.max_runtime.map(|budget| Instant::now() + budget);
        let healing = healing::resolve_healing(set);
        // An unreadable `healing` key is reported rather than guessed at: `{"stripFences": false}`
        // would otherwise run the default arm under the disabled arm's name, and every number an
        // ablation produced would be a measurement of the wrong thing.
        for unknown in &healing.unknown_params {
            warnings.push(format!(
                "the `{CAPABILITY_RESPONSES_AS_CODE}` capability declares `{unknown}`, which gg \
                 could not read as a healing setting; it changes nothing. The strategies are {}, \
                 each set to `true` or `false`.",
                HealingStrategy::ALL.map(HealingStrategy::id).join(", ")
            ));
        }
        Self {
            caps: set.clone(),
            workspace_dir: invocation.workspace_dir.clone(),
            prompt: invocation.prompt.clone(),
            multi_model,
            subagents_enabled: set.is_enabled(CAPABILITY_SUBAGENTS),
            project_management_enabled: set.is_enabled(CAPABILITY_PROJECT_MANAGEMENT),
            workflows_enabled: set.is_enabled(CAPABILITY_WORKFLOWS),
            worktrees_capability: worktrees.capability,
            worktrees_root: worktrees.root,
            baseline_commit: worktrees.baseline_commit,
            code_reviews_enabled: set.is_enabled(CAPABILITY_CODE_REVIEWS),
            speculative_enabled: set.is_enabled(CAPABILITY_SPECULATIVE),
            code: CodeSetup {
                enabled: set.is_enabled(CAPABILITY_RESPONSES_AS_CODE),
                limits: sandbox::resolve_sandbox_limits(set),
                healing: healing.config,
            },
            issue_dispatch: Mutex::new(HashMap::new()),
            board: resolve_board(set),
            issue_waits: Mutex::new(HashMap::new()),
            git_lock: Mutex::new(()),
            config: SubagentConfig::resolve(set),
            scheduler: Scheduler::new(SubagentConfig::resolve(set).max_parallel),
            accounting: Mutex::new(SlotAccounting::default()),
            base_emitter: emitter.clone(),
            factory,
            skills_library: skills.library(),
            skills_enabled: set.is_enabled(CAPABILITY_SKILLS),
            estimator: Arc::new(BpeTokenEstimator::new()),
            model_windows: invocation.model_windows.clone(),
            vision: Arc::new(VisionSupport::new(invocation.model_modalities.clone())),
            limits,
            deadline,
            spend: Arc::new(RunSpend::default()),
            tasks: Mutex::new(Vec::new()),
            next_seq: AtomicU64::new(0),
            next_workflow_seq: AtomicU64::new(0),
            // Replay capture is opt-in and debug-only: allocate the shared recorder only when the
            // capability is on, so an ordinary run captures nothing extra.
            replay: set
                .is_enabled(CAPABILITY_REPLAY)
                .then(|| Arc::new(GgRecorder::new())),
        }
    }

    /// This agent's skills runtime over the shared library (a fresh read-state runtime per agent),
    /// or a disabled one when the capability is off.
    fn skills_runtime(&self) -> SkillsRuntime {
        if self.skills_enabled {
            SkillsRuntime::new(Arc::clone(&self.skills_library))
        } else {
            SkillsRuntime::disabled()
        }
    }

    /// The context accounting for an agent running `model_id`: the shared estimator, the model's
    /// window limit, and whether to emit the per-turn breakdown (gated on context visibility).
    fn context_setup(&self, model_id: &str) -> ContextSetup {
        ContextSetup {
            estimator: Arc::clone(&self.estimator),
            window_limit: resolve_window_limit(&self.caps, &self.model_windows, model_id),
            emit_breakdown: self.caps.is_enabled(CAPABILITY_CONTEXT_VISIBILITY),
            log_messages: self.caps.is_enabled(CAPABILITY_CONTEXT_VISIBILITY),
        }
    }

    /// Mint the next unique subagent id.
    fn next_agent_id(&self) -> String {
        format!("agent-{}", self.next_seq.fetch_add(1, Ordering::SeqCst))
    }

    /// Mint the next unique [workflow](run_workflow) id, so a `run_workflow` invocation's stage
    /// telemetry groups under one handle.
    fn next_workflow_id(&self) -> String {
        format!(
            "workflow-{}",
            self.next_workflow_seq.fetch_add(1, Ordering::SeqCst)
        )
    }

    /// Whether **delegation** is active this run — the [subagents](CAPABILITY_SUBAGENTS) capability
    /// or the [workflows](CAPABILITY_WORKFLOWS) capability (which is built on the same machinery).
    /// When it is, each agent gets a [delegation context](SubagentContext) and the agent-tree
    /// [telemetry](GgAgentStatus) (running/blocked/done/failed transitions and returns) is emitted,
    /// so a workflow's fanned-out agents animate the live tree exactly like ad-hoc subagents.
    fn delegation_enabled(&self) -> bool {
        self.subagents_enabled || self.workflows_enabled
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
    /// session start when the worktrees capability made the workspace a git repo — or `None` when
    /// worktrees are off or no baseline could be committed.
    ///
    /// This is the "original commit for the run" that
    /// [Code Reviews](https://docs.testcabinet.ai/gg/code-reviews/) diff against when an issue has no
    /// recorded [initial commit](IssueDispatchMeta::initial_commit) of its own; exposed here so the
    /// review reuses the recorded sha rather than recomputing it.
    fn baseline_commit(&self) -> Option<&str> {
        self.baseline_commit.as_deref()
    }

    /// Whether [Code Reviews](handle_code_review) actually gate issue acceptance this run: the
    /// [code-reviews](CAPABILITY_CODE_REVIEWS) capability **and** the delegation machinery a review
    /// needs to run its reviewer/fix subagents. With the capability on but delegation off, a review
    /// could not be dispatched, so `complete_issue` accepts issues directly (as without the
    /// capability) rather than silently doing nothing.
    fn code_reviews_active(&self) -> bool {
        self.code_reviews_enabled && self.delegation_enabled()
    }

    /// Whether [speculative execution](handle_speculate) can actually run this run: the
    /// [speculative-execution](CAPABILITY_SPECULATIVE) capability **and** the delegation machinery a
    /// best-of-K fan-out + judge needs. Worktree isolation is a further requirement checked at call
    /// time (with a clear refusal), so a speculation without worktrees is a runtime refusal, not a
    /// silently-withheld tool.
    fn speculative_active(&self) -> bool {
        self.speculative_enabled && self.delegation_enabled()
    }

    /// The [slot](GgSlotBinding) a [speculative execution](handle_speculate)'s **judge** runs on: the
    /// dedicated [`judge`](JUDGE_SLOT) slot when [multi-model](CAPABILITY_MULTI_MODEL) is on and it is
    /// bound, else the [`reviewer`](REVIEWER_SLOT) slot when bound (the judge is a reviewer-shaped
    /// role), else [`primary`](PRIMARY_SLOT) — so best-of-K works with no extra binding.
    fn judge_slot(&self) -> String {
        if self.multi_model {
            if slot_binding(&self.caps, JUDGE_SLOT).is_ok() {
                return JUDGE_SLOT.to_string();
            }
            if slot_binding(&self.caps, REVIEWER_SLOT).is_ok() {
                return REVIEWER_SLOT.to_string();
            }
        }
        PRIMARY_SLOT.to_string()
    }

    /// Record the [dispatch facts](IssueDispatchMeta) for `issue_id` the first time it is dispatched
    /// (`spawn_subagent { issueId }`), capturing the commit its work began at (for a later
    /// [Code Review](handle_code_review)'s baseline) and the slot it ran on. Only the **first**
    /// dispatch is recorded (`or_insert`), so a later reviewer or fix agent dispatched against the
    /// same issue does not clobber the real work baseline/slot.
    fn record_issue_dispatch(&self, issue_id: &str, work_slot: &str) {
        let initial_commit = if self.baseline_commit.is_some() {
            git::head_commit(&self.workspace_dir).ok()
        } else {
            None
        };
        self.issue_dispatch
            .lock()
            .expect("issue dispatch lock")
            .entry(issue_id.to_string())
            .or_insert_with(|| IssueDispatchMeta {
                initial_commit,
                work_slot: work_slot.to_string(),
            });
    }

    /// The baseline commit a [Code Review](handle_code_review) of `issue_id` diffs against: the
    /// issue's recorded [initial commit](IssueDispatchMeta::initial_commit) if it was dispatched,
    /// else the run [baseline](Self::baseline_commit). `None` when no git baseline exists at all.
    fn issue_baseline(&self, issue_id: &str) -> Option<String> {
        self.issue_dispatch
            .lock()
            .expect("issue dispatch lock")
            .get(issue_id)
            .and_then(|meta| meta.initial_commit.clone())
            .or_else(|| self.baseline_commit().map(str::to_string))
    }

    /// The [slot](GgSlotBinding) a [Code Review](handle_code_review)'s **fix agent** for `issue_id`
    /// runs on: the slot the issue's work was dispatched on (so the fix is done by the same kind of
    /// agent), or [`primary`](PRIMARY_SLOT) when the issue was never dispatched to a subagent.
    fn issue_work_slot(&self, issue_id: &str) -> String {
        self.issue_dispatch
            .lock()
            .expect("issue dispatch lock")
            .get(issue_id)
            .map(|meta| meta.work_slot.clone())
            .unwrap_or_else(|| PRIMARY_SLOT.to_string())
    }

    /// The [slot](GgSlotBinding) a [Code Review](handle_code_review)'s **reviewer** runs on: the
    /// dedicated [`reviewer`](REVIEWER_SLOT) slot when [multi-model](CAPABILITY_MULTI_MODEL) is on
    /// and that slot is bound, else [`primary`](PRIMARY_SLOT). (When multi-model is off,
    /// [`dispatch_child`] would collapse a `reviewer` request to primary anyway; resolving it here
    /// keeps the dispatch from failing on an unbound `reviewer` slot.)
    fn reviewer_slot(&self) -> String {
        if self.multi_model && slot_binding(&self.caps, REVIEWER_SLOT).is_ok() {
            REVIEWER_SLOT.to_string()
        } else {
            PRIMARY_SLOT.to_string()
        }
    }

    /// The textual diff of the work for `issue_id` against its [review baseline](Self::issue_baseline)
    /// — what a [Code Review](handle_code_review) hands its reviewer. Empty when no baseline exists,
    /// and empty (with a logged breadcrumb suppressed to keep the review resilient) when the git
    /// diff itself fails. Serialized on the shared [git lock](Self::git_lock) since it stages the
    /// index transiently.
    fn review_diff(&self, issue_id: &str) -> String {
        let Some(baseline) = self.issue_baseline(issue_id) else {
            return String::new();
        };
        let _guard = self.git_lock.lock().expect("git lock");
        git::diff_since(&self.workspace_dir, &baseline).unwrap_or_default()
    }

    /// The textual diff of the **whole run's** work against the run [baseline](Self::baseline_commit)
    /// — what the [`review-gated`](crate::fsm) FSM's `review` state hands its reviewer (a run-level
    /// [Code Review](handle_code_review), not scoped to a board issue). Empty when no baseline exists.
    /// Serialized on the shared [git lock](Self::git_lock) since it stages the index transiently.
    fn run_diff(&self) -> String {
        let Some(baseline) = self.baseline_commit() else {
            return String::new();
        };
        let _guard = self.git_lock.lock().expect("git lock");
        git::diff_since(&self.workspace_dir, baseline).unwrap_or_default()
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
        self.wake_ready_issue_waiters();
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
    /// Each dispatch mints a fresh agent id, atomically [claims](BoardRuntime::assign_issue) the
    /// issue for it (so two concurrent pumps cannot both take one — a lost claim just wastes the
    /// minted id), and spawns the agent with the issue's brief. The agents are top-level (no parent,
    /// depth 0), so they surface as their own roots in the Agents tree.
    fn pump_dispatch(self: &Arc<Self>, emitter: &Emitter) {
        for issue_id in self.board.dispatchable_ids() {
            let agent_id = self.next_agent_id();
            if self.board.assign_issue(&issue_id, &agent_id) {
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
        let agent_id = self.next_agent_id();
        if self.board.redispatch_issue(issue_id, &agent_id, retry) {
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
    /// client cannot resolve (a missing credential), the issue is [failed](BoardRuntime::fail_issue)
    /// and its waiters woken rather than left stuck [`InProgress`](crate::board::IssueStatus::InProgress).
    fn spawn_issue_agent(
        self: &Arc<Self>,
        agent_id: String,
        issue_id: String,
        brief: String,
        retry: u32,
        emitter: &Emitter,
    ) {
        // Dispatched issue agents run on the primary slot (collapsed when multi-model is off).
        let slot = effective_slot(PRIMARY_SLOT, self.multi_model).to_string();
        let binding = match slot_binding(&self.caps, &slot) {
            Ok(binding) => binding.clone(),
            Err(err) => return self.abort_issue_dispatch(&issue_id, &slot, &err, emitter),
        };
        let client = match self.factory.client_for(&binding) {
            Ok(client) => client,
            Err(err) => {
                return self.abort_issue_dispatch(&issue_id, &slot, &err.to_string(), emitter);
            }
        };
        // Record the issue's dispatch facts on its first dispatch (retry 0), so a later Code Review
        // has an issue-level baseline and the slot to re-run a fix agent on.
        if retry == 0 {
            self.record_issue_dispatch(&issue_id, &slot);
        }
        let agent = Agent {
            id: agent_id,
            parent_id: None,
            depth: 0,
            slot,
        };
        let role = AgentRole::Issue {
            brief,
            issue_id,
            retry,
        };
        let (_inbox_tx, inbox_rx) = mpsc::unbounded_channel();
        let orch = Arc::clone(self);
        let handle = tokio::spawn(async move {
            run_agent(orch, agent, role, client, inbox_rx).await;
        });
        self.tasks.lock().expect("subagent tasks lock").push(handle);
    }

    /// Give up on dispatching `issue_id` (its client could not resolve): mark it
    /// [`Failed`](crate::board::IssueStatus::Failed), wake its waiters, and re-emit the board — so a
    /// missing credential surfaces on the board rather than hanging every dependent.
    fn abort_issue_dispatch(
        self: &Arc<Self>,
        issue_id: &str,
        slot: &str,
        err: &str,
        emitter: &Emitter,
    ) {
        emitter.emit(log(
            "error",
            format!(
                "cannot dispatch issue `{issue_id}` on the `{slot}` slot: {err}; marking it failed."
            ),
        ));
        self.board.fail_issue(issue_id);
        self.on_issue_progress(emitter);
    }

    /// Wake every agent whose awaited issue has reached a terminal state. Called on any board
    /// change; idempotent (an already-woken issue has no waiters left).
    fn wake_ready_issue_waiters(&self) {
        // Snapshot the awaited ids without holding the waits lock across the board lock.
        let awaited: Vec<String> = {
            let waits = self.issue_waits.lock().expect("issue waits lock");
            waits.keys().cloned().collect()
        };
        for issue_id in awaited {
            if self.board.issue_is_terminal(&issue_id) {
                self.wake_issue_waiters(&issue_id);
            }
        }
    }

    /// Mark every agent waiting on `issue_id` ready to resume (its wait condition — the issue is
    /// terminal — is met), removing them from the registry.
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
    /// does not block; otherwise **free the caller's running slot** and register it as a blocked
    /// waiter on the issue, returning the resume channel it awaits. The post-registration
    /// re-check closes the race where the issue goes terminal between the first check and the
    /// registration (the caller would otherwise never be woken).
    fn begin_issue_wait(self: &Arc<Self>, issue_id: &str) -> IssueWaitOutcome {
        if self.board.issue_is_terminal(issue_id) {
            return IssueWaitOutcome::AlreadyTerminal;
        }
        let (token, rx) = self.scheduler.block_and_release();
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
        IssueWaitOutcome::Blocked(rx)
    }
}

/// The outcome of [beginning an issue wait](Orchestrator::begin_issue_wait).
enum IssueWaitOutcome {
    /// The awaited issue is already terminal (done, failed, or gone) — the caller keeps its slot
    /// and does not block.
    AlreadyTerminal,
    /// The caller freed its running slot and must await this channel; it resolves once the awaited
    /// issue reaches a terminal state **and** a slot is free to resume on.
    Blocked(oneshot::Receiver<()>),
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
                "wait_for_issue needs a non-empty `issueId` (the id of the issue to wait for).",
            );
        }
    };
    // An agent cannot wait on the very issue it was dispatched to implement — it would block itself
    // forever (nothing else completes its issue). Guide it to do the work instead.
    if project.assigned_issue.as_deref() == Some(issue_id.as_str()) {
        return ToolOutcome::failed(
            ToolFailure::InvalidArgument,
            format!(
                "you cannot wait on issue `{issue_id}`: it is the issue you were assigned to \
                 implement. Do the work and call `complete_issue` when it is done."
            ),
        );
    }
    let Some(status) = board.issue_status(&issue_id) else {
        return ToolOutcome::failed(
            ToolFailure::NotFound,
            format!(
                "no issue `{issue_id}` is on the board (your current board is in your context); \
                 create it with `create_issue` or correct the id."
            ),
        );
    };
    if status.is_terminal() {
        return issue_wait_result(&issue_id, status);
    }
    match project.orch.begin_issue_wait(&issue_id) {
        IssueWaitOutcome::AlreadyTerminal => {}
        IssueWaitOutcome::Blocked(rx) => {
            if project.orch.multi_agent() {
                emitter.emit(agent_status(GgAgentStatus::Blocked));
            }
            // The sender is held by the scheduler until this agent is granted a slot after its
            // issue goes terminal; a dropped sender (impossible here) would also end the wait.
            let _ = rx.await;
            if project.orch.multi_agent() {
                emitter.emit(agent_status(GgAgentStatus::Running));
            }
            let _ = agent; // the agent identity is carried by the scoped `emitter`.
        }
    }
    // Report the issue's final state (it is terminal now, unless it was removed while we waited).
    match board.issue_status(&issue_id) {
        Some(status) => issue_wait_result(&issue_id, status),
        None => ToolOutcome::ok(
            format!("issue `{issue_id}` is no longer on the board."),
            format!("waited for issue `{issue_id}` (removed)"),
        ),
    }
}

/// The [`ToolOutcome`] `wait_for_issue` returns once its awaited issue is terminal (or was found
/// already terminal): a success either way — the wait *completed* — that reports whether the issue
/// was accepted or failed, so the waiting agent can branch on it.
fn issue_wait_result(issue_id: &str, status: IssueStatus) -> ToolOutcome {
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
        // Only ever called with a terminal status; a non-terminal one means the issue was replaced
        // between checks, which is reported honestly rather than asserted away.
        IssueStatus::Open | IssueStatus::InProgress => ToolOutcome::ok(
            format!("Issue `{issue_id}` is {}.", status_word(status)),
            format!("issue `{issue_id}` {}", status_word(status)),
        ),
    }
}

/// A human word for an [`IssueStatus`], for the `wait_for_issue` fallback message.
fn status_word(status: IssueStatus) -> &'static str {
    match status {
        IssueStatus::Open => "open",
        IssueStatus::InProgress => "in progress",
        IssueStatus::Done => "done",
        IssueStatus::Failed => "failed",
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
    /// the [completion path](run_agent) checks whether it marked its issue done and, if not,
    /// re-dispatches it (up to the [retry cap](crate::board::BoardCaps::max_retries)) or fails it.
    Issue {
        /// The issue's structured brief that drives the agent (its build prompt).
        brief: String,
        /// The board issue this agent was dispatched to implement (scopes its telemetry, and is
        /// what it is expected to `complete_issue`).
        issue_id: String,
        /// How many times this issue has already been re-dispatched — `0` on its first attempt.
        /// Compared against the [retry cap](crate::board::BoardCaps::max_retries) when the agent
        /// finishes without completing it.
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
        /// The isolated [worktree](Worktree) this subagent runs in, when it was dispatched with
        /// `worktree: true`. `Some` roots the subagent's tools in the worktree and reconciles it
        /// (merge on clean completion, else discard) when the subagent finishes; `None` runs the
        /// subagent in the shared main tree.
        worktree: Option<Worktree>,
        /// The spawner's wait condition the subagent signals on completion.
        parent_wait: Arc<ParentWait>,
        /// The channel the subagent's [return value](AgentReturn) is delivered on.
        result: oneshot::Sender<AgentReturn>,
        /// Flipped when the subagent's loop ends, so its spawner's `send_message` refuses.
        finished: Arc<AtomicBool>,
    },
}

/// How a finished worktree subagent's isolated branch is reconciled by [`run_agent`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WorktreeDisposition {
    /// The default (Phase 4B): on clean completion, commit the work onto the branch and
    /// [merge it back](reconcile_worktree) into the main tree (or surface a conflict), then tear the
    /// worktree down — used by ad-hoc `spawn_subagent`/workflow worktree dispatch.
    Merge,
    /// [Speculative execution](handle_speculate): the subagent is one of K best-of-K attempts, so
    /// [`run_agent`] leaves its worktree **in place** without merging — the `speculate` routine judges
    /// the attempts' work, then merges the winner's worktree and discards the losers'. Reconciling
    /// each attempt independently would defeat best-of-K (every attempt would merge).
    Speculative,
}

/// An isolated [git worktree](https://docs.testcabinet.ai/gg/worktrees/) a subagent runs in: its
/// per-agent branch and checkout path.
///
/// Created at [spawn time](make_worktree) (a `git worktree add` on a fresh branch based at the
/// [baseline](Orchestrator::baseline_commit)) so the subagent gets a private copy of the workspace
/// to mutate; how it is reconciled when the subagent finishes is set by its
/// [disposition](Worktree::disposition) — [merged back](reconcile_worktree) for ad-hoc dispatch, or
/// [left for the judge](WorktreeDisposition::Speculative) for a best-of-K attempt.
struct Worktree {
    /// The per-agent branch the worktree checks out (for example `gg/agent-3`).
    branch: String,
    /// The worktree's checkout directory — the subagent's rooted workspace while it runs.
    path: PathBuf,
    /// How this worktree is reconciled when its subagent finishes.
    disposition: WorktreeDisposition,
}

/// The resolved worktree-isolation state for a run, computed once at session start and handed to
/// [`Orchestrator::build`].
struct WorktreesSetup {
    /// Whether the [worktrees](CAPABILITY_WORKTREES) capability is enabled (the raw toggle).
    capability: bool,
    /// The committed [baseline](Orchestrator::baseline_commit) sha, when git made the workspace a
    /// repo. `Some` even if the worktree root could not be created, so Phase 5 can still reuse it.
    baseline_commit: Option<String>,
    /// The directory per-agent worktree checkouts are created under, `Some` only when isolation is
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
}

/// A single agent's [project-management](crate::board) context, threaded into [`Agent::drive`] when
/// the [project-management](CAPABILITY_PROJECT_MANAGEMENT) capability is on: the
/// [orchestrator](Orchestrator) (to auto-dispatch actionable issues after a board mutation and to
/// suspend the agent in a `wait_for_issue`) and — when this agent was *itself* auto-dispatched to
/// implement an issue — that issue's id.
struct ProjectContext {
    /// The shared orchestrator whose board this agent's tools mutate and whose dispatcher its board
    /// changes drive.
    orch: Arc<Orchestrator>,
    /// The board issue this agent was dispatched to implement, when it was — so the loop frames
    /// `finish` as "return this issue's result" rather than "end the run", and knows the agent is
    /// expected to `complete_issue`. `None` for the root and for a subagent that was not
    /// issue-dispatched.
    assigned_issue: Option<String>,
}

/// Build and drive one agent to completion: acquire a running slot, resolve its stream and
/// resources, drive its [turn loop](Agent::drive), fold its usage into the shared
/// [accounting](SlotAccounting), and — for a subagent — deliver its [return value](AgentReturn)
/// to its spawner and free its slot (waking the spawner if it was the last child it awaited).
///
/// This is the one path every agent goes through, the root and each spawned subagent alike, so
/// the tree is uniform: recursion is just a subagent whose own loop spawns more agents that come
/// back through here. `client` is resolved by the caller (the root's in [`run_with_factory`], a
/// child's at spawn time) so a resolution failure is surfaced where it belongs.
async fn run_agent(
    orch: Arc<Orchestrator>,
    agent: Agent,
    role: AgentRole,
    client: Box<dyn ModelClient>,
    inbox_rx: mpsc::UnboundedReceiver<String>,
) -> LoopEnd {
    // Acquire a running slot before doing anything: a spawned agent blocks here until the
    // scheduler grants one (the root's is granted immediately). This is the parallelism cap.
    orch.scheduler.acquire_start().await;

    let is_root = matches!(role, AgentRole::Root);
    let issue_id = match &role {
        AgentRole::Sub { issue_id, .. } => issue_id.clone(),
        AgentRole::Issue { issue_id, .. } => Some(issue_id.clone()),
        AgentRole::Root => None,
    };
    // Scope this agent's stream to its node in the tree (and to the issue it was dispatched for).
    let emitter =
        orch.base_emitter
            .for_agent_on_issue(agent.id.clone(), agent.parent_id.clone(), issue_id);
    let emitter = &emitter;

    let model_id = client.model_id().to_string();
    emitter.emit(log(
        "info",
        format!(
            "{} slot resolved to model `{model_id}` ({} provider).",
            agent.slot,
            provider_label_for(&orch, &agent.slot),
        ),
    ));

    // Announce this agent to the tree: its slot/model, depth, the brief it was dispatched with (for
    // a subagent, or an auto-dispatched issue agent), and the isolated worktree branch it runs in
    // when it was dispatched with one. The root carries no brief (it is driven by the build prompt)
    // and always runs in the main tree.
    let brief = match &role {
        AgentRole::Sub { brief, .. } => Some(brief.clone()),
        AgentRole::Issue { brief, .. } => Some(brief.clone()),
        AgentRole::Root => None,
    };
    let worktree_branch = match &role {
        AgentRole::Sub {
            worktree: Some(wt), ..
        } => Some(wt.branch.clone()),
        _ => None,
    };
    emitter.emit(GgTelemetryKind::AgentSpawned {
        slot: agent.slot.clone(),
        model_id: model_id.clone(),
        depth: agent.depth as u64,
        brief,
        worktree: worktree_branch,
    });
    // The running transition is only meaningful (and only emitted) when the run is multi-agent
    // (delegation, or project-management auto-dispatch) — it is what animates the live tree.
    if orch.multi_agent() {
        emitter.emit(agent_status(GgAgentStatus::Running));
    }

    // Build this agent's resources. The memory/task/planning runtimes and the archive are
    // **per-agent** (a subagent has its own scratchpad, task list, and plan); the skills library
    // and estimator are shared through the orchestrator; and the **project-management board is
    // shared run-wide** — every agent's board tools mutate the one [`orch.board`], the global work
    // queue the dispatcher reads (cloning a `BoardRuntime` shares its store).
    let skills = orch.skills_runtime();
    let memories = resolve_memories(&orch.caps);
    let tasks = resolve_tasks(&orch.caps);
    let board = orch.board.clone();
    let planning = PlanningRuntime::resolve(&orch.caps);
    // The FSM engine drives only the **root** agent (the run's top-level process); a subagent does
    // scoped work and is not itself driven through a machine, so it gets a disabled runtime.
    let fsm = if is_root {
        FsmRuntime::resolve(&orch.caps)
    } else {
        FsmRuntime::disabled()
    };
    let archive_store = Arc::new(Mutex::new(ArchiveStore::new()));
    let library = skills.library();
    let memory_store = memories.store();
    let task_store = tasks.store();
    let board_store = board.store();
    let registry = ToolRegistry::from_run(
        &orch.caps,
        &RuntimeSet::new(&library)
            .with_memories(&memory_store)
            .with_tasks(&task_store)
            .with_board(&board_store)
            .with_archive(&archive_store),
    );
    // Root the agent's file/shell tools in its isolated worktree when it has one, so every
    // mutation lands in the private copy rather than the shared main tree; otherwise root them in
    // the shared workspace (the default). This is the whole of the worktree isolation at the tool
    // layer — the loop is otherwise identical.
    let workspace_dir = match &role {
        AgentRole::Sub {
            worktree: Some(wt), ..
        } => wt.path.clone(),
        _ => orch.workspace_dir.clone(),
    };
    // The tool context carries this agent's model alongside its workspace root, because
    // one tool's answer depends on it: `read_file` attaches a picture only when the model
    // asking can see one. The registry behind it is the run's, not this agent's.
    let tool_ctx = ToolContext::new(workspace_dir).with_vision(&model_id, Arc::clone(&orch.vision));

    // Announce the run's configuration once, on the root's stream, so the console shows the enabled
    // capabilities from the start; subagents inherit the same configuration and stay quiet.
    if is_root {
        announce_configuration(
            emitter,
            &registry,
            &skills,
            &memories,
            &tasks,
            &board,
            &planning,
            &fsm,
            orch.code_reviews_active(),
            orch.speculative_active(),
            orch.code.enabled,
        );
        announce_fsm(emitter, &orch.caps, &fsm);
        // Record the run's effective toolset on the session summary — the exact set of tool names
        // offered to the root agent after capability gating and per-tool overrides — so the toolset
        // is a durable, slice-by ablation variable. Then warn (loudly but non-fatally) about any
        // per-tool override that names a tool gg does not offer at all, so a typo is visible.
        emitter.record_effective_tools(registry.tool_names());
        // Record the run's execution mode (code-shaped responses vs traditional tool calling) so the
        // "does responses-as-code help?" study is a durable, sliceable outcome dimension alongside
        // the capabilityEnabled facet.
        emitter.record_execution_mode(if orch.code.enabled {
            "responses_as_code"
        } else {
            "tool_calling"
        });
        for unknown in unknown_disabled_tools(&orch.caps) {
            emitter.emit(log(
                "warn",
                format!(
                    "capability set disables unknown tool `{unknown}`: it is not a tool gg offers, \
                     so it withholds nothing. Check the name against the toolset."
                ),
            ));
        }
    }

    let context_setup = orch.context_setup(&model_id);
    let compaction = CompactionSetup::resolve(&orch.caps);
    let amc = AmcSetup {
        enabled: orch.caps.is_enabled(CAPABILITY_AGENT_MANAGED_CONTEXT),
        archive: Arc::clone(&archive_store),
    };
    if is_root && compaction.enabled {
        emitter.emit(log(
            "info",
            format!(
                "compaction enabled; the thread compacts once the window reaches {:.0}% full.",
                compaction.policy.trigger_fullness() * 100.0
            ),
        ));
    }
    if is_root && amc.enabled {
        emitter.emit(log(
            "info",
            "agent-managed context enabled; the model sees a live window-fullness signal and \
             can evict file views, archive thread history, and search the archive.",
        ));
    }

    // When delegation is enabled (subagents or workflows), this agent gets a delegation context so
    // its loop can spawn/wait/message and run declared workflows; off, it is a single agent with no
    // such context (and the tools were never offered).
    let subagent_context = orch.delegation_enabled().then(|| SubagentContext {
        orch: Arc::clone(&orch),
        ctx: AgentCtx::new(inbox_rx),
    });

    // When project management is enabled, this agent gets a project context so its loop can trigger
    // auto-dispatch after a board mutation and block in `wait_for_issue`; it also carries the issue
    // this agent was itself dispatched to implement (if any), so the loop knows `finish` returns a
    // result rather than ending the run. Off, the board tools were never offered.
    let project = orch.project_management_enabled.then(|| ProjectContext {
        orch: Arc::clone(&orch),
        assigned_issue: match &role {
            AgentRole::Issue { issue_id, .. } => Some(issue_id.clone()),
            _ => None,
        },
    });

    let prompt = match &role {
        AgentRole::Root => orch.prompt.clone(),
        AgentRole::Sub { brief, .. } => brief.clone(),
        AgentRole::Issue { brief, .. } => brief.clone(),
    };

    // Replay capture: when the capability is on, wrap this agent's client so every model turn it
    // makes — including the summarizer's compaction calls, which reuse this same client — records its
    // request/response into the shared recorder, and thread the recorder into the loop so it records
    // each tool result too. The wrapping is invisible to the loop (`model_id` and errors pass
    // through); off (the default), the client is unwrapped and nothing extra is captured.
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
            LimitsSetup {
                limits: orch.limits,
                deadline: orch.deadline,
                spend: Arc::clone(&orch.spend),
            },
            context_setup,
            compaction,
            amc,
            skills,
            memories,
            tasks,
            board,
            planning,
            fsm,
            read_policy(&orch.caps),
            orch.code_reviews_active(),
            orch.speculative_active(),
            orch.code,
            subagent_context,
            project,
            orch.replay.clone(),
        )
        .await;

    // Fold this agent's usage into the shared per-slot accounting.
    orch.accounting
        .lock()
        .expect("slot accounting lock")
        .record(&end.slot, &model_id, end.tokens, end.cost);

    let failed = is_failure_status(end.status);
    if orch.multi_agent() {
        emitter.emit(agent_status(if failed {
            GgAgentStatus::Failed
        } else {
            GgAgentStatus::Done
        }));
    }

    match role {
        AgentRole::Root => {
            // The root frees its slot so any cap-limited subagents it spawned can now run to
            // completion while the session joins them.
            orch.scheduler.release();
        }
        AgentRole::Issue {
            issue_id, retry, ..
        } => {
            // Free the slot first (like the root), so a re-dispatch or a newly-unblocked issue can
            // acquire it, then reconcile the issue against what the agent did.
            orch.scheduler.release();
            if orch.board.issue_is_done(&issue_id) {
                // The agent accepted its issue (via `complete_issue`, possibly Code-Review gated).
                // Unblock any dependents and wake anyone waiting on it.
                orch.on_issue_progress(emitter);
            } else if (retry as usize) < orch.board.max_retries() {
                // It finished without completing the issue and retries remain: re-dispatch it to a
                // fresh agent. The issue stays `InProgress` (its waiters keep waiting).
                orch.redispatch_issue(&issue_id, retry + 1, emitter);
                orch.on_issue_progress(emitter);
            } else {
                // Retries exhausted: mark it failed (terminal, but not done — dependents stay
                // blocked) and wake anyone waiting on it.
                orch.board.fail_issue(&issue_id);
                emitter.emit(log(
                    "warn",
                    format!(
                        "issue `{issue_id}` could not be completed after {} attempt(s); marking it \
                         failed.",
                        retry + 1
                    ),
                ));
                orch.on_issue_progress(emitter);
            }
        }
        AgentRole::Sub {
            worktree,
            parent_wait,
            result,
            finished,
            ..
        } => {
            // The summary is the subagent's final assistant message (its return value), or a short
            // status when it produced none.
            let mut summary = end
                .final_text
                .clone()
                .unwrap_or_else(|| format!("(subagent ended: {})", end.status));

            // Reconcile an isolated worktree before returning, per its disposition:
            //
            // - `Merge` (ad-hoc `spawn_subagent`/workflow dispatch): a cleanly completed subagent's
            //   work is merged back into the main tree; anything else is discarded; the worktree is
            //   torn down either way. A merge conflict (or failure) is surfaced — appended to the
            //   return value the spawner sees and emitted as a `WorktreeMerged` outcome — never
            //   silently dropped.
            // - `Speculative` (a best-of-K attempt): the worktree is left **in place** and NOT merged.
            //   The `speculate` routine that fanned this attempt out judges the K attempts' work and
            //   then merges only the winner (discarding the rest), so merging each attempt here would
            //   defeat best-of-K. Its lifecycle is reported by `Speculation` telemetry, not
            //   `WorktreeMerged`.
            if let Some(wt) = worktree {
                match wt.disposition {
                    WorktreeDisposition::Merge => {
                        // A subagent's work is merged only when it finished on its own terms.
                        // A limit-stopped child is discarded unmerged exactly as an exhausted or
                        // timed-out one is: it holds half-finished work, and merging that can turn
                        // a working artifact into a broken one.
                        let succeeded = end.status == STATUS_COMPLETED;
                        let outcome = reconcile_worktree(&orch, &agent.id, &wt, succeeded);
                        if let Some(note) = outcome.note {
                            summary.push_str("\n\n");
                            summary.push_str(&note);
                        }
                        emitter.emit(GgTelemetryKind::WorktreeMerged {
                            branch: wt.branch,
                            merged: outcome.merged,
                            conflicts: outcome.conflicts,
                        });
                    }
                    WorktreeDisposition::Speculative => {
                        // Leave the worktree and its branch untouched for the speculate routine.
                    }
                }
            }

            if orch.delegation_enabled() {
                emitter.emit(GgTelemetryKind::AgentReturned {
                    summary: summary.clone(),
                });
            }
            // Flip finished and deliver the result *before* signalling the parent, so by the time
            // the spawner is woken its collect finds the result ready.
            finished.store(true, Ordering::SeqCst);
            let _ = result.send(AgentReturn {
                summary,
                status: end.status,
            });
            parent_wait.child_completed(&orch.scheduler, &agent.id);
        }
    }
    end
}

/// Announce the run's enabled capabilities once (on the root's stream) so the console shows the
/// configuration from the start — the offered toolset and the initial (empty) skills/memory/task/
/// board state — mirroring the per-capability announcements a single-agent run emitted.
#[allow(clippy::too_many_arguments)]
fn announce_configuration(
    emitter: &Emitter,
    registry: &ToolRegistry,
    skills: &SkillsRuntime,
    memories: &MemoriesRuntime,
    tasks: &TasksRuntime,
    board: &BoardRuntime,
    planning: &PlanningRuntime,
    fsm: &FsmRuntime,
    code_reviews: bool,
    speculative: bool,
    responses_as_code: bool,
) {
    if registry.is_empty() {
        emitter.emit(log(
            "warn",
            "no capabilities are enabled; the model is offered no tools and can only \
             talk. Enable the shell/filesystem capabilities to let it build.",
        ));
    } else {
        emitter.emit(log(
            "info",
            format!(
                "offering {} tool(s) from the enabled capabilities.",
                registry.len()
            ),
        ));
    }
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
    if let Some(state) = memories.state_event() {
        let caps = memories.caps();
        emitter.emit(log(
            "info",
            format!(
                "memory scratchpad enabled (up to {} memories, {} chars each, {} total).",
                caps.max_count, caps.max_len_per_memory, caps.max_total_len
            ),
        ));
        emitter.emit(state);
    }
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
    if let Some(state) = board.state_event() {
        let caps = board.caps();
        emitter.emit(log(
            "info",
            format!(
                "epic/issue board enabled (structured, dispatchable issues in a blocked-by DAG, \
                 up to {} epics and {} issues).",
                caps.max_epics, caps.max_issues
            ),
        ));
        emitter.emit(state);
    }
    if planning.offers_planning() {
        emitter.emit(log(
            "info",
            "planning enabled; the model can enter a read-only plan mode mid-session and \
             implement from a fresh context after submitting a plan.",
        ));
    }
    if code_reviews {
        emitter.emit(log(
            "info",
            "code reviews enabled; marking an issue done triggers a Code Review (a reviewer \
             agent inspects the diff against the issue's completion criteria) before the issue is \
             accepted, and a fix agent addresses any requested changes until a review approves.",
        ));
    }
    if speculative {
        emitter.emit(log(
            "info",
            "speculative execution enabled; the model can call `speculate` to make K parallel \
             attempts at the same task (each in its own worktree), after which a judge picks the \
             best one to merge and the rest are discarded (requires the `worktrees` capability to \
             isolate the attempts).",
        ));
    }
    if responses_as_code {
        emitter.emit(log(
            "info",
            "responses-as-code enabled; instead of calling tools one at a time, each turn the model \
             emits a TypeScript program over the available tools (loops, conditionals, composed \
             tool calls) that gg runs in a wasmtime sandbox — the tool calls the program makes still \
             stream as ToolCall/ToolResult, and the execution is streamed as a CodeExecution event.",
        ));
        // Responses-as-code does not compose with either machine that is driven by a *turn-level*
        // transition, because in code mode every turn is a program and a program cannot make one.
        // Both combinations are launchable and neither fails, so the only thing that stops a study
        // spending its whole budget on a run that can never move is saying so loudly, at the start.
        if planning.offers_planning() {
            emitter.emit(log(
                "warn",
                "responses-as-code and planning are both enabled, but they do not compose: \
                 `enter_plan_mode` and `submit_plan` are turn-level transitions a program cannot \
                 make, and a code-mode run has no turn that is not a program. Planning is inert for \
                 this run — a pass that can never be entered restricts nothing.",
            ));
        }
        if fsm.is_active() {
            emitter.emit(log(
                "warn",
                format!(
                    "responses-as-code and the `{}` FSM are both enabled, but they do not compose: \
                     `advance_state` is a turn-level transition a program cannot make, so this run \
                     is pinned in the machine's first state — that state's tool restrictions apply \
                     to every call every program makes, and the run can never advance out of it.",
                    fsm.machine_name()
                ),
            ));
        }
    }
}

/// Announce the [FSM-driven process](crate::fsm) driving the run, once on the root's stream: which
/// machine is active (and what it enforces), or a **warning** when the [`fsm`](test_cabinet_core::gg::CAPABILITY_FSM)
/// capability names a machine gg does not recognize (so the misconfiguration is loud rather than
/// silently leaving the run undriven).
fn announce_fsm(emitter: &Emitter, caps: &GgCapabilitySet, fsm: &FsmRuntime) {
    if fsm.is_active() {
        emitter.emit(log(
            "info",
            format!(
                "FSM-driven process enabled: the `{}` machine drives this run through a fixed order \
                 of states. The agent is kept in each state until its transition condition is met \
                 (it cannot skip ahead); each transition is streamed as an FsmState event.",
                fsm.machine_name()
            ),
        ));
    } else if let Some(name) = configured_machine(caps) {
        // The capability named a machine, but it is not one gg ships — warn rather than run undriven.
        if !is_builtin_machine(name) {
            emitter.emit(log(
                "warn",
                format!(
                    "the `fsm` capability named an unknown machine `{name}`; no FSM will drive this \
                     run. The built-in machines are `tdd`, `review-gated`, and `plan-first`."
                ),
            ));
        }
    }
}

/// An [`AgentStatus`](GgTelemetryKind::AgentStatus) telemetry event for `status`.
fn agent_status(status: GgAgentStatus) -> GgTelemetryKind {
    GgTelemetryKind::AgentStatus { status }
}

/// A human-readable provider label for the model bound to `slot`, for an agent's resolution log
/// line. Falls back to `"mock"` when the slot cannot be resolved (it always can here — it was
/// resolved to build the client — so this is only defensive).
fn provider_label_for(orch: &Orchestrator, slot: &str) -> &'static str {
    match slot_binding(&orch.caps, slot) {
        Ok(binding) => provider_label(binding),
        Err(_) => "mock",
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
        RUN_WORKFLOW_TOOL => run_workflow(sub, spawner, emitter, &call.arguments).await,
        // `is_subagent_tool` admits only the four arms above.
        other => ToolOutcome::error(format!("`{other}` is not a delegation tool.")),
    }
}

/// Handle `spawn_subagent`: resolve the brief and slot, [dispatch the child](dispatch_child) on the
/// scheduler (spawning its task), and return its id immediately — the parent keeps running (parallel
/// by default). A spawn at the [max depth](SubagentConfig::max_depth) is **refused** (a tool error),
/// not queued.
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
                "spawn_subagent needs a non-empty `prompt` (the subagent's brief).",
            );
        }
    };
    // Ad-hoc subagents carry no board issue (issues auto-dispatch to their own top-level agents).
    let issue_id = None;

    // The requested slot (default primary) and optional worktree isolation are dispatch properties.
    let requested_slot = args
        .get("slot")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|slot| !slot.is_empty())
        .unwrap_or(PRIMARY_SLOT);
    let want_worktree = args
        .get("worktree")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let worktree = want_worktree.then_some(WorktreeDisposition::Merge);
    match dispatch_child(sub, spawner, brief, issue_id, requested_slot, worktree) {
        Ok(child) => {
            let worktree_note = match &child.worktree_branch {
                Some(branch) => format!(
                    " It runs in an isolated worktree (branch `{branch}`), merged back into the \
                     main tree when it completes cleanly.",
                ),
                None => String::new(),
            };
            ToolOutcome::ok(
                format!(
                    "Spawned subagent `{id}` on slot `{slot}` (model `{model}`). It is running in \
                     parallel — call `wait_for_subagents` to collect its result, or `send_message` \
                     to guide it while it works.{worktree_note}",
                    id = child.id,
                    slot = child.slot,
                    model = child.model_id,
                ),
                format!("spawned subagent `{}`", child.id),
            )
            // The structured half of the same facts. Delegation never reaches a
            // [`Tool`](crate::tools::Tool), so this handler is the **only** producer of the
            // sidecar a [code program](crate::sandbox)'s `spawnSubagent` reads back — without it a
            // program would be told the call succeeded and handed nothing to name the child by.
            .with_data(ToolData::SubagentSpawned(SubagentHandleData {
                id: child.id,
                slot: child.slot,
                model_id: child.model_id,
                worktree_branch: child.worktree_branch,
            }))
        }
        Err(err) => err.into(),
    }
}

/// A subagent that [`dispatch_child`] scheduled — the facts its dispatcher (`spawn_subagent` or a
/// [workflow](run_workflow) stage) reports back.
struct DispatchedChild {
    /// The child's minted id (also the `wait`/`collect` handle in the spawner's children).
    id: String,
    /// The [effective slot](effective_slot) the child runs on.
    slot: String,
    /// The concrete model the slot resolved to.
    model_id: String,
    /// The isolated [worktree](Worktree) branch the child runs in, when it was dispatched with one.
    worktree_branch: Option<String>,
    /// The isolated [worktree](Worktree) checkout path, when the child was dispatched with one — the
    /// directory a [speculative execution](handle_speculate) reads the attempt's diff from and later
    /// merges or discards.
    worktree_path: Option<PathBuf>,
}

/// A delegation that could not be dispatched, carrying **both** halves of the answer: the sentence
/// the model reads and the class a structured consumer branches on.
///
/// The class exists because a [code program](crate::sandbox) catches a typed `ToolError` and asks
/// `e.code === "limit-exceeded"`. Every one of these failures is raised in the loop rather than in
/// a [`Tool`](crate::tools::Tool), so nothing else would classify them, and an unclassified refusal
/// reaches a program as the useless `other`. [`Display`](std::fmt::Display) renders the message
/// alone, so the many places that only quote the reason read exactly as they did before.
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

/// Dispatch one child agent — the shared spawn path behind both `spawn_subagent` and each
/// [workflow](run_workflow) stage's fan-out.
///
/// Enforces the [depth cap](SubagentConfig::max_depth) (a structural refusal, not a queue),
/// resolves the child's [effective slot](effective_slot) and client, optionally creates an isolated
/// [worktree](make_worktree) (refused with guidance when the capability is off or git is
/// unavailable), then builds the child's identity/wiring/role, schedules its task on the scheduler,
/// and registers it in the spawner's [children](AgentCtx::children) so it can be waited on and
/// messaged. Returns the [dispatched child](DispatchedChild) or a model-facing error. Every child —
/// ad-hoc or workflow — reaches [`run_agent`] through here, so the two paths stay uniform.
fn dispatch_child(
    sub: &mut SubagentContext,
    spawner: &Agent,
    brief: String,
    issue_id: Option<String>,
    requested_slot: &str,
    worktree_disposition: Option<WorktreeDisposition>,
) -> Result<DispatchedChild, DispatchError> {
    let orch = &sub.orch;

    // Depth cap: a structural refusal, not a queue. An agent at the max depth cannot delegate
    // deeper — it must do the work itself. A *ceiling*, so `limit-exceeded` rather than `refused`:
    // the request was well-formed, the run simply has no room left below this agent.
    if spawner.depth >= orch.config.max_depth {
        return Err(DispatchError::new(
            ToolFailure::LimitExceeded,
            format!(
                "cannot spawn a subagent: you are at the maximum delegation depth ({}), so you \
                 must do this work yourself rather than delegating deeper.",
                orch.config.max_depth
            ),
        ));
    }

    // The requested slot, collapsed to primary when multi-model is off. A slot this run does not
    // bind is a bad *argument*, which is what tells a program to pass a different one.
    let slot = effective_slot(requested_slot, orch.multi_model).to_string();
    let binding = slot_binding(&orch.caps, &slot)
        .map_err(|err| {
            DispatchError::new(
                ToolFailure::InvalidArgument,
                format!("cannot spawn on the `{slot}` slot: {err}"),
            )
        })?
        .clone();
    // The slot is bound but its client would not resolve — a missing credential, a provider that
    // could not be built. Nothing about the call was wrong, so it is an I/O-class failure.
    let client = orch.factory.client_for(&binding).map_err(|err| {
        DispatchError::new(
            ToolFailure::IoError,
            format!(
                "cannot spawn on the `{slot}` slot (model `{}`): {err}",
                binding.model_id
            ),
        )
    })?;
    let model_id = client.model_id().to_string();

    // Record this issue's dispatch facts on its first dispatch, so a later Code Review of it has an
    // issue-level baseline (the commit its work began at) and knows which slot to re-run a fix agent
    // on. Only the first dispatch is kept, so a reviewer/fix agent dispatched against the same issue
    // (which also carries its issueId) does not overwrite the real work baseline/slot.
    if let Some(issue_id) = &issue_id {
        orch.record_issue_dispatch(issue_id, &slot);
    }

    // Build the child's identity, wiring, and role, then schedule it. The child clones the
    // spawner's `ParentWait` so it can signal completion back up.
    let child_id = orch.next_agent_id();

    // Optional worktree isolation — a *dispatch property*. When requested, create a fresh git
    // worktree on a per-agent branch (based at the run baseline); the child's tools are then rooted
    // there and its work is reconciled when it finishes. A request without the capability (or with
    // git unavailable) is refused with guidance rather than silently ignored, so an ablation's off
    // arm is unambiguous.
    let worktree = match worktree_disposition {
        Some(disposition) => Some(make_worktree(orch, &child_id, disposition)?),
        None => None,
    };
    let worktree_branch = worktree.as_ref().map(|wt| wt.branch.clone());
    let worktree_path = worktree.as_ref().map(|wt| wt.path.clone());

    let (inbox_tx, inbox_rx) = mpsc::unbounded_channel();
    let (result_tx, result_rx) = oneshot::channel();
    let finished = Arc::new(AtomicBool::new(false));
    let child = Agent {
        id: child_id.clone(),
        parent_id: Some(spawner.id.clone()),
        depth: spawner.depth + 1,
        slot: slot.clone(),
    };
    let role = AgentRole::Sub {
        brief,
        issue_id,
        worktree,
        parent_wait: Arc::clone(&sub.ctx.wait),
        result: result_tx,
        finished: Arc::clone(&finished),
    };
    let orch_for_task = Arc::clone(orch);
    let handle = tokio::spawn(async move {
        run_agent(orch_for_task, child, role, client, inbox_rx).await;
    });
    orch.tasks.lock().expect("subagent tasks lock").push(handle);
    sub.ctx.children.push(ChildHandle {
        id: child_id.clone(),
        inbox: inbox_tx,
        finished,
        result: Some(result_rx),
        collected: false,
    });

    Ok(DispatchedChild {
        id: child_id,
        slot,
        model_id,
        worktree_branch,
        worktree_path,
    })
}

/// Create an isolated [worktree](Worktree) for the child `child_id`, or a model-facing error when
/// isolation is unavailable.
///
/// A `worktree: true` dispatch is refused (rather than silently downgraded to the shared tree) when
/// the [worktrees](CAPABILITY_WORKTREES) capability is off, or when it is on but git could not
/// establish a baseline at startup — each with guidance to spawn without `worktree: true`. On
/// success it runs `git worktree add` on branch `gg/<child_id>` based at the run
/// [baseline](Orchestrator::baseline_commit), under the [worktree root](Orchestrator::worktrees_root).
/// The git call is serialized on the shared [git lock](Orchestrator::git_lock).
fn make_worktree(
    orch: &Orchestrator,
    child_id: &str,
    disposition: WorktreeDisposition,
) -> Result<Worktree, DispatchError> {
    // The capability is off: the feature exists but this run does not offer it, which is exactly
    // what `unavailable` says.
    if !orch.worktrees_capability {
        return Err(DispatchError::new(
            ToolFailure::Unavailable,
            "cannot dispatch this subagent in a worktree: the `worktrees` capability is not \
             enabled for this run. Spawn without `worktree: true` to run in the shared workspace.",
        ));
    }
    let (root, base) = match (&orch.worktrees_root, &orch.baseline_commit) {
        (Some(root), Some(base)) => (root, base),
        _ => {
            return Err(DispatchError::new(
                ToolFailure::Unavailable,
                "cannot dispatch this subagent in a worktree: worktree isolation is unavailable \
                 this run (git could not initialize a workspace baseline at startup). Spawn \
                 without `worktree: true` to run in the shared workspace.",
            ));
        }
    };
    let branch = format!("gg/{child_id}");
    let path = root.join(child_id);
    let _guard = orch.git_lock.lock().expect("git lock");
    git::add_worktree(&orch.workspace_dir, &path, &branch, base).map_err(|err| {
        DispatchError::new(
            ToolFailure::IoError,
            format!("could not create an isolated worktree for the subagent: {err}"),
        )
    })?;
    Ok(Worktree {
        branch,
        path,
        disposition,
    })
}

/// The outcome of [reconciling](reconcile_worktree) a finished worktree subagent's branch.
struct WorktreeReconcile {
    /// Whether the branch was merged back into the main tree (a clean completion).
    merged: bool,
    /// Whether a merge conflict prevented the merge (the main tree was left unchanged).
    conflicts: bool,
    /// A note to append to the subagent's return value when the merge did not cleanly apply (a
    /// conflict, a git failure, or a cleanup hiccup), so the spawner sees it. `None` on a clean
    /// merge or a plain discard.
    note: Option<String>,
}

/// Reconcile a finished worktree subagent's isolated branch back into the main tree, then tear the
/// worktree down.
///
/// **Merge policy (Phase 4B):** a subagent that completed cleanly (`succeeded`) has its work
/// committed onto its branch and the branch merged back into the main tree with an explicit merge
/// commit. A **merge conflict** leaves the main tree unchanged and is surfaced — appended to the
/// return value and reported as `conflicts: true` — rather than silently dropped; resolving it is a
/// later concern. A subagent that failed, exhausted, or timed out is **discarded** unmerged. The
/// worktree and its branch are removed in **every** case. All git operations run under the shared
/// [git lock](Orchestrator::git_lock) (concurrent subagents finish in parallel); the whole function
/// is synchronous, so the guard never spans an await.
fn reconcile_worktree(
    orch: &Orchestrator,
    agent_id: &str,
    wt: &Worktree,
    succeeded: bool,
) -> WorktreeReconcile {
    let _guard = orch.git_lock.lock().expect("git lock");
    let mut merged = false;
    let mut conflicts = false;
    let mut note = None;

    if succeeded {
        match git::commit_worktree(&wt.path, &format!("gg subagent {agent_id}")) {
            Ok(_committed) => match git::merge_branch(&orch.workspace_dir, &wt.branch) {
                Ok(git::MergeOutcome::Merged) => merged = true,
                Ok(git::MergeOutcome::Conflict(reason)) => {
                    conflicts = true;
                    note = Some(format!(
                        "NOTE: your work in worktree `{}` could not be merged back — it conflicts \
                         with concurrent changes in the main tree, which was left unchanged. Your \
                         work remains on its branch for a later pass. ({})",
                        wt.branch,
                        first_line(&reason)
                    ));
                }
                Err(err) => {
                    note = Some(format!(
                        "NOTE: merging worktree `{}` back into the main tree failed: {err}. The \
                         main tree was left unchanged.",
                        wt.branch
                    ));
                }
            },
            Err(err) => {
                note = Some(format!(
                    "NOTE: committing the work in worktree `{}` failed: {err}. It was not merged \
                     back.",
                    wt.branch
                ));
            }
        }
    }

    // Tear the worktree down in every case — a merged, conflicted, or discarded subagent — so no
    // isolated copy or dangling branch is left behind. A cleanup failure must not fail the run; it
    // only leaves a breadcrumb in the note when there is not already a more important one.
    if let Err(err) = git::remove_worktree(&orch.workspace_dir, &wt.path, &wt.branch)
        && note.is_none()
    {
        note = Some(format!(
            "NOTE: tearing down worktree `{}` reported: {err}",
            wt.branch
        ));
    }

    WorktreeReconcile {
        merged,
        conflicts,
        note,
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
                                    "`{id}` is not one of your subagents; you can only wait for \
                                     agents you spawned."
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
        .with_data(ToolData::SubagentResults(Vec::new()));
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
    .with_data(ToolData::SubagentResults(results))
}

/// Block until every child in `awaited_ids` has returned — freeing this agent's running slot while
/// it waits so its children (and other agents) can run under the [cap](Scheduler) — then collect
/// each child's [return value](AgentReturn) (in the given order) and mark it collected. Emits the
/// [`Blocked`](GgAgentStatus::Blocked)→[`Running`](GgAgentStatus::Running) transitions only when it
/// actually blocks.
///
/// The one wait-and-collect primitive shared by [`wait_for_subagents`] and each
/// [workflow](run_workflow) stage, so both free the slot and resume identically through the
/// scheduler. Every id is expected to name one of this agent's children; an unknown id collects as
/// `None`.
async fn await_children(
    sub: &mut SubagentContext,
    emitter: &Emitter,
    awaited_ids: &[String],
) -> Vec<(String, Option<AgentReturn>)> {
    // `begin_wait` returns `None` when every awaited child has already finished, in which case
    // there is nothing to block on.
    let awaited: HashSet<String> = awaited_ids.iter().cloned().collect();
    if let Some(rx) = sub.ctx.wait.begin_wait(&sub.orch.scheduler, &awaited) {
        emitter.emit(agent_status(GgAgentStatus::Blocked));
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
                "`{agent_id}` is not one of your subagents; you can only message agents you \
                 spawned."
            ),
        ),
        // The agent exists but its lifecycle has moved past being messageable: well-formed, in
        // conflict with the current state, which is what `conflict` means.
        Some(child) if child.is_finished() => ToolOutcome::failed(
            ToolFailure::Conflict,
            format!("subagent `{agent_id}` has already returned; you cannot message it."),
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
// Code Reviews: gate issue acceptance on a reviewer subagent + a fix loop
// ---------------------------------------------------------------------------

/// The structured verdict a [Code Review](handle_code_review)'s reviewer returns, parsed from its
/// final message by [`parse_review_verdict`].
struct ReviewVerdict {
    /// Whether the reviewer **approved** the work (the issue may be accepted).
    approved: bool,
    /// When not approved, the reviewer's actionable items — the changes a fix agent must address
    /// before re-review. Always at least one item when `!approved` (a generic item is synthesized
    /// if the reviewer listed none).
    items: Vec<String>,
}

/// Handle an intercepted `complete_issue` when [Code Reviews are active](Orchestrator::code_reviews_active):
/// run a **Code Review** that gates the issue's acceptance, and return the model-facing outcome.
///
/// Rather than mark the issue done, gg:
///
/// 1. resolves the issue's brief and its [review baseline](Orchestrator::issue_baseline), and emits
///    [`CodeReview`](GgCodeReviewPhase::Requested);
/// 2. computes the [diff](Orchestrator::review_diff) of the work against that baseline and
///    [dispatches a reviewer subagent](dispatch_child) — on the [`reviewer`](Orchestrator::reviewer_slot)
///    slot — with the diff plus the issue's scope/completion criteria as its brief, then
///    [waits](await_children) for it and [parses its verdict](parse_review_verdict);
/// 3. on **approval**, marks the issue done ([`CodeReview`](GgCodeReviewPhase::Approved)) and returns
///    a success outcome — the issue is accepted;
/// 4. on **actionable items** ([`CodeReview`](GgCodeReviewPhase::ChangesRequested)), spawns a fix
///    agent with the **original issue brief plus the items**, waits for it, and loops back to
///    re-review — with **no cycle limit**.
///
/// The loop terminates on approval; it is otherwise bounded only by the run's
/// [deadline](Orchestrator::deadline) (checked each round) and the scheduler — a reviewer that ends
/// without a clean verdict, an undispatchable reviewer/fix agent, or an exhausted time budget aborts
/// the review with the issue **left unaccepted** (never silently accepted). The reviewer and fix
/// agents are ordinary subagents scoped to the issue, so they animate the agent tree normally.
async fn handle_code_review(
    sub: &mut SubagentContext,
    spawner: &Agent,
    board: &BoardRuntime,
    emitter: &Emitter,
    call: &ToolCall,
) -> ToolOutcome {
    // Clone the orchestrator Arc out so `sub` stays free to be borrowed mutably by dispatch/await.
    let orch = Arc::clone(&sub.orch);

    let issue_id = match call.arguments.get("id").and_then(Value::as_str) {
        Some(id) if !id.trim().is_empty() => id.trim().to_string(),
        _ => {
            return ToolOutcome::failed(
                ToolFailure::InvalidArgument,
                "complete_issue needs a non-empty `id`.",
            );
        }
    };
    // The original task being tackled — the issue's brief — drives both the reviewer's context and
    // (augmented with the review items) each fix agent.
    let brief = match board.issue_brief(&issue_id) {
        Some(brief) => brief,
        None => {
            return ToolOutcome::failed(
                ToolFailure::NotFound,
                format!(
                    "cannot review issue `{issue_id}`: no such issue is on your board. Create it \
                     with `create_issue` first."
                ),
            );
        }
    };
    let baseline = orch.issue_baseline(&issue_id);
    // The Code Review's lifecycle events ride on the issue's own stream (the envelope `issue_id`),
    // even though this agent (the completer) was not itself dispatched against the issue.
    let review_emitter = emitter.with_issue(&issue_id);
    review_emitter.emit(code_review_event(
        GgCodeReviewPhase::Requested,
        None,
        baseline.clone(),
    ));

    loop {
        // Termination guard: the fix→re-review loop has no cycle limit, so bound it by the run's
        // wall-clock budget. Past the deadline the review aborts with the issue unaccepted, rather
        // than spinning up agents that would each time out immediately.
        if orch
            .deadline
            .is_some_and(|deadline| Instant::now() >= deadline)
        {
            emitter.emit(log(
                "warn",
                format!(
                    "the Code Review of issue `{issue_id}` did not approve before the run's time \
                     budget ran out; the issue was not accepted."
                ),
            ));
            return ToolOutcome::failed(
                ToolFailure::LimitExceeded,
                format!(
                    "The Code Review of issue `{issue_id}` did not reach approval before the run's \
                     time budget ran out, so the issue was NOT marked done. Its work remains for a \
                     later pass."
                ),
            );
        }

        // Dispatch a reviewer against the current diff of the work and parse its verdict. Anything
        // other than a clean verdict aborts the review with the issue unaccepted (never accept work
        // no reviewer approved).
        let diff = orch.review_diff(&issue_id);
        let review_brief = build_review_brief(&brief, &diff, orch.code.enabled);
        let reviewer_slot = orch.reviewer_slot();
        let verdict = match dispatch_reviewer(
            sub,
            spawner,
            emitter,
            Some(issue_id.clone()),
            review_brief,
            &reviewer_slot,
        )
        .await
        {
            Ok(verdict) => verdict,
            Err(err) => {
                emitter.emit(log(
                    "warn",
                    format!(
                        "the Code Review of issue `{issue_id}` did not complete: {err}; the issue \
                         was not accepted."
                    ),
                ));
                return ToolOutcome::failed(
                    ToolFailure::IoError,
                    format!(
                        "The Code Review of issue `{issue_id}` did not complete ({err}), so the \
                         issue was NOT marked done. Its work remains for a later pass."
                    ),
                );
            }
        };

        if verdict.approved {
            // Accept the issue: mark it done on the board. The loop refreshes the pinned board block
            // and re-emits `BoardState` after this outcome (as it does for the tool), so the
            // acceptance is reflected in the window and the console.
            board.complete_issue(&issue_id);
            review_emitter.emit(code_review_event(
                GgCodeReviewPhase::Approved,
                None,
                baseline.clone(),
            ));
            let detail = format!(
                "The Code Review of issue `{issue_id}` approved the work; the issue is accepted \
                 and marked done."
            );
            return ToolOutcome::ok(
                detail.clone(),
                format!("code review approved issue `{issue_id}`"),
            )
            // With Code Reviews on, this handler *replaces* the `complete_issue` tool's own
            // outcome — so it also has to replace the tool's sidecar, or a
            // [code program](crate::sandbox) would be told the acceptance produced no structured
            // result. `code_reviewed` is the field the whole payload exists for: it is the only
            // way a caller can tell "accepted after a review" from a plain status change.
            .with_data(ToolData::Completion(CompletionData {
                code_reviewed: true,
                detail,
            }));
        }

        // Changes requested: record the items, then spawn a fix agent with the original brief plus
        // the items and loop back to re-review its work. No cycle limit.
        review_emitter.emit(code_review_event(
            GgCodeReviewPhase::ChangesRequested,
            Some(verdict.items.clone()),
            baseline.clone(),
        ));
        let fix_brief = build_fix_brief(&brief, &verdict.items, orch.code.enabled);
        let work_slot = orch.issue_work_slot(&issue_id);
        let fixer = match dispatch_child(
            sub,
            spawner,
            fix_brief,
            Some(issue_id.clone()),
            &work_slot,
            None,
        ) {
            Ok(child) => child,
            Err(err) => {
                emitter.emit(log(
                    "warn",
                    format!("could not dispatch a fix agent for issue `{issue_id}`: {err}"),
                ));
                let failure = err.failure;
                return ToolOutcome::failed(
                    failure,
                    format!(
                        "The Code Review of issue `{issue_id}` requested changes, but a fix agent \
                         could not be dispatched: {err} The issue was NOT marked done."
                    ),
                );
            }
        };
        let _ = await_children(sub, emitter, std::slice::from_ref(&fixer.id)).await;
        // Loop: re-review the fixed work.
    }
}

/// The reviewer's brief for a [Code Review](handle_code_review): the issue's own brief (its title,
/// scope, and completion criteria) plus the diff to review and the verdict protocol the
/// [parser](parse_review_verdict) expects. A missing/empty diff is stated plainly so the reviewer
/// does not hallucinate changes.
///
/// `code` is whether the run is in [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) mode, and it
/// changes the ending clause because under that protocol there is no "final message" to end: every
/// reply is a program, and only [`finish`](FINISH_FUNCTION) ends a session. A reviewer told to
/// stop with a verdict would never reach `completed`, [`dispatch_reviewer`] would report it as
/// having ended without one, and the issue would never be accepted — so the brief has to teach the
/// contract the run actually runs.
fn build_review_brief(issue_brief: &str, diff: &str, code: bool) -> String {
    let diff_block = if diff.trim().is_empty() {
        "(No textual diff was available — no changes were detected against the baseline. Review \
         against the completion criteria and, unless the work was clearly already present, request \
         the missing work.)"
            .to_string()
    } else {
        format!("```diff\n{diff}\n```")
    };
    // The parser reads the marker out of the child's final text either way, and under code mode
    // that final text *is* the `finish` summary — so only the instruction changes, never the
    // protocol the verdict is written in.
    let verdict = if code {
        "Review the diff carefully against the completion criteria and the in/out-of-scope \
         boundaries. When you are done, end your session by calling `finish()` from inside a \
         program, passing exactly one verdict as its summary:\n\
         - If the work fully satisfies the completion criteria and stays in scope:\n\
         `finish(\"CODE REVIEW: APPROVED\")`\n\
         - Otherwise:\n`finish(\"CODE REVIEW: CHANGES REQUESTED\\n1. …\")`\n\
         where the summary continues with a numbered list of specific, actionable items that must \
         be fixed before the work can be accepted. Be concrete: each item should say what is wrong \
         and what to change."
    } else {
        "Review the diff carefully against the completion criteria and the in/out-of-scope \
         boundaries. When you are done, end your final message with exactly one verdict:\n\
         - If the work fully satisfies the completion criteria and stays in scope, write on its own \
         line:\n`CODE REVIEW: APPROVED`\n\
         - Otherwise, write on its own line:\n`CODE REVIEW: CHANGES REQUESTED`\n\
         and then a numbered list of specific, actionable items that must be fixed before the work \
         can be accepted. Be concrete: each item should say what is wrong and what to change."
    };
    format!(
        "You are performing a **Code Review**. Inspect the changes below against the issue's \
         requirements and decide whether the work is complete and stays in scope.\n\n{issue_brief}\
         \n\n## Changes to review (diff against the baseline)\n{diff_block}\n\n## Your verdict\n\
         {verdict}"
    )
}

/// A fix agent's brief for a [Code Review](handle_code_review) round: the original issue brief plus
/// the reviewer's actionable items. The `## Requested changes from Code Review` heading is a stable
/// marker (a worker can detect it is on a fix pass).
///
/// `code` swaps the ending clause for the same reason [`build_review_brief`] does: "then stop" is
/// not a thing a [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) agent can do, and a fix agent
/// that never reaches `completed` leaves its worktree discarded unmerged.
fn build_fix_brief(issue_brief: &str, items: &[String], code: bool) -> String {
    let mut list = String::new();
    for (index, item) in items.iter().enumerate() {
        list.push_str(&format!("\n{}. {}", index + 1, item));
    }
    if list.is_empty() {
        list.push_str(
            "\n1. The reviewer requested changes but listed no specific items; re-check the \
             completion criteria and make sure every part is done.",
        );
    }
    let ending = if code {
        "then call `finish()` from inside a program with a short summary of what you changed — \
         your changes will be re-reviewed"
    } else {
        "then stop — your changes will be re-reviewed"
    };
    format!(
        "{issue_brief}\n\n## Requested changes from Code Review\nA Code Review of the work for this \
         issue found that it is not yet done. Address every item below (keeping the rest of the \
         work intact), {ending}:\n{list}"
    )
}

/// Parse a reviewer's final message into a [`ReviewVerdict`].
///
/// The contract: the reviewer ends with a `CODE REVIEW:` marker whose following word is `APPROVED`
/// (approval) or `CHANGES REQUESTED` (with a list of actionable items). Parsing is deliberately
/// lenient — the marker match is case-insensitive and the last occurrence wins — and **conservative
/// on ambiguity**: anything that is not a clear approval is treated as changes requested, so work no
/// reviewer clearly approved is never accepted. When changes are requested but no list items are
/// found, a single generic item is synthesized so a fix agent always has something to act on.
fn parse_review_verdict(text: &str) -> ReviewVerdict {
    const MARKER: &str = "code review:";
    let lower = text.to_ascii_lowercase();
    if let Some(pos) = lower.rfind(MARKER) {
        let after = lower[pos + MARKER.len()..].trim_start();
        if after.starts_with("approve") {
            return ReviewVerdict {
                approved: true,
                items: Vec::new(),
            };
        }
    }
    let mut items = collect_actionable_items(text);
    if items.is_empty() {
        items.push(
            "The Code Review did not approve the work; revisit the completion criteria and address \
             the reviewer's feedback."
                .to_string(),
        );
    }
    ReviewVerdict {
        approved: false,
        items,
    }
}

/// Collect the actionable items from a reviewer's message: every line that reads as a list item —
/// a `-`/`*`/`+` bullet or a `N.`/`N)` numbered entry — with its marker stripped. Order preserved;
/// empty entries dropped.
fn collect_actionable_items(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            for bullet in ["- ", "* ", "+ "] {
                if let Some(rest) = trimmed.strip_prefix(bullet) {
                    let rest = rest.trim();
                    if !rest.is_empty() {
                        return Some(rest.to_string());
                    }
                    return None;
                }
            }
            // A numbered entry: leading ASCII digits followed by `.` or `)`.
            let digits: String = trimmed.chars().take_while(char::is_ascii_digit).collect();
            if !digits.is_empty() {
                let rest = &trimmed[digits.len()..];
                if let Some(after) = rest.strip_prefix('.').or_else(|| rest.strip_prefix(')')) {
                    let after = after.trim();
                    if !after.is_empty() {
                        return Some(after.to_string());
                    }
                }
            }
            None
        })
        .collect()
}

/// A [`CodeReview`](GgTelemetryKind::CodeReview) telemetry event for one lifecycle transition. The
/// issue under review rides on the emitter's [issue scope](Emitter::with_issue), not the payload.
fn code_review_event(
    phase: GgCodeReviewPhase,
    items: Option<Vec<String>>,
    baseline: Option<String>,
) -> GgTelemetryKind {
    GgTelemetryKind::CodeReview {
        phase,
        items,
        baseline,
    }
}

/// Dispatch one **reviewer** subagent against `review_brief` on `reviewer_slot`, await it, and parse
/// its [verdict](parse_review_verdict) — the reusable core of a Code Review shared by the issue-level
/// [Code Review](handle_code_review) (P5a) and the [`review-gated`](crate::fsm) FSM's `review` state.
///
/// Returns the verdict, or a model-facing error when the reviewer could not be dispatched or returned
/// without a clean verdict; the caller then leaves the work **unaccepted** (work no reviewer approved
/// is never accepted). The reviewer is an ordinary [subagent](dispatch_child) scoped to `issue_id`
/// (when any).
async fn dispatch_reviewer(
    sub: &mut SubagentContext,
    spawner: &Agent,
    emitter: &Emitter,
    issue_id: Option<String>,
    review_brief: String,
    reviewer_slot: &str,
) -> Result<ReviewVerdict, String> {
    let reviewer = dispatch_child(sub, spawner, review_brief, issue_id, reviewer_slot, None)
        .map_err(|err| format!("the reviewer could not be dispatched: {err}"))?;
    let collected = await_children(sub, emitter, std::slice::from_ref(&reviewer.id)).await;
    match collected.into_iter().next() {
        Some((_, Some(ret))) if ret.status == STATUS_COMPLETED => {
            Ok(parse_review_verdict(&ret.summary))
        }
        Some((_, Some(ret))) => Err(format!("the reviewer {} without a verdict", ret.status)),
        _ => Err("the reviewer produced no result".to_string()),
    }
}

// ---------------------------------------------------------------------------
// Speculative execution: best-of-K over isolated worktrees + a judge
// ---------------------------------------------------------------------------

/// One of the K attempts a [speculative execution](handle_speculate) fanned out — the facts the
/// routine needs to judge it, then merge or discard it.
struct SpeculationAttempt {
    /// The attempt subagent's agent id (also the [`winner`](GgTelemetryKind::Speculation) id when it
    /// wins).
    id: String,
    /// The isolated [worktree](Worktree) branch the attempt's work lives on.
    branch: String,
    /// The attempt's worktree checkout path — where its diff is read from and, if it wins, its work
    /// is committed and merged from.
    path: PathBuf,
    /// How the attempt's loop ended (`"completed"`, `"model_error"`, `"timed_out"`, …). Only a
    /// cleanly `"completed"` attempt that produced changes is a candidate to win.
    status: String,
    /// The attempt's return value (its final message), shown to the judge for context.
    summary: String,
    /// The attempt's diff against the run [baseline](Orchestrator::baseline_commit) — what the judge
    /// scores and what is merged if it wins. Empty when the attempt produced no changes.
    diff: String,
}

/// The judge's verdict for a [speculative execution](handle_speculate): which candidate attempt won,
/// and why — the judge contract (parsed from its final message by [`parse_judge_verdict`]).
struct JudgeVerdict {
    /// The 1-based index of the winning attempt **among the candidates the judge was shown** (not the
    /// original attempt index).
    winner: usize,
    /// The judge's one-line rationale for the pick.
    rationale: String,
}

/// Handle an intercepted `speculate` call ([speculative execution](https://docs.testcabinet.ai/gg/speculative-execution/)):
/// run a **best-of-K** attempt of a task and merge the best result.
///
/// The routine — `fan-out → judge → merge/discard`:
///
/// 1. requires worktree isolation (each attempt runs in its own [worktree](Worktree) so they do not
///    collide) — refused clearly when unavailable — and resolves the task (a board
///    [issue](BoardRuntime::issue_brief) or a free-form `prompt`) and `K`;
/// 2. **fans out** K [attempt subagents](dispatch_child), each in an isolated worktree left in place
///    for judging ([`Speculative`](WorktreeDisposition::Speculative) disposition), optionally on
///    per-attempt [slots](GgSlotBinding) or with per-attempt approach hints, over the same
///    [scheduler](Scheduler) (honoring the global parallelism + depth caps), emitting
///    [`Speculation`](GgSpeculationPhase::FannedOut);
/// 3. [waits](await_children) for them, computes each attempt's [diff](git::diff_since) against the
///    baseline, and takes the **candidates** (attempts that completed and produced changes);
/// 4. **judges** the candidates — a [judge subagent](dispatch_judge) scores their diffs against the
///    task's completion criteria and picks a [winner](JudgeVerdict) (a lone candidate needs no judge)
///    — emitting [`Speculation`](GgSpeculationPhase::Judged);
/// 5. **merges** the winner's worktree back into the main tree and **discards** every attempt's
///    worktree (the losers' unmerged branches and the winner's now-merged one), emitting
///    [`Speculation`](GgSpeculationPhase::Merged) — so the main tree ends with exactly the winning
///    attempt applied.
///
/// A speculation that produces no usable work, or whose judge does not render a verdict, discards
/// every attempt and returns an error with the workspace **unchanged** (best-of-K never merges an
/// unjudged or empty attempt). The attempts and the judge are ordinary subagents scoped to the issue
/// (when any), so they animate the agent tree normally.
async fn handle_speculate(
    sub: &mut SubagentContext,
    spawner: &Agent,
    board: &BoardRuntime,
    emitter: &Emitter,
    call: &ToolCall,
) -> ToolOutcome {
    // Clone the orchestrator Arc out so `sub` stays free to be borrowed mutably by dispatch/await.
    let orch = Arc::clone(&sub.orch);

    // Best-of-K runs each attempt in an isolated worktree so they cannot collide; refuse clearly when
    // worktree isolation is unavailable (capability off, or git could not establish a baseline).
    let baseline = match (orch.baseline_commit(), &orch.worktrees_root) {
        (Some(base), Some(_root)) => base.to_string(),
        _ => {
            return ToolOutcome::failed(
                ToolFailure::Unavailable,
                "cannot speculate: best-of-K runs each attempt in an isolated worktree, but \
                 worktree isolation is unavailable this run (enable the `worktrees` capability, \
                 and ensure git is available in the run environment). Do the work with a single \
                 attempt instead.",
            );
        }
    };

    // The task: a dispatched board issue (its structured brief) or a free-form prompt.
    let (base_brief, issue_id) = match call.arguments.get("issueId").and_then(Value::as_str) {
        Some(id) if !id.trim().is_empty() => {
            let id = id.trim().to_string();
            match board.issue_brief(&id) {
                Some(brief) => (brief, Some(id)),
                None => {
                    return ToolOutcome::failed(
                        ToolFailure::NotFound,
                        format!(
                            "cannot speculate on issue `{id}`: no such issue is on your board (or \
                             you have no board). Create it with `create_issue`, or pass a `prompt` \
                             instead."
                        ),
                    );
                }
            }
        }
        _ => match call.arguments.get("prompt").and_then(Value::as_str) {
            Some(prompt) if !prompt.trim().is_empty() => (prompt.trim().to_string(), None),
            _ => {
                return ToolOutcome::failed(
                    ToolFailure::InvalidArgument,
                    "speculate needs a non-empty `prompt` (the task to attempt K times) or an \
                     `issueId` to speculate on.",
                );
            }
        },
    };

    // K — clamped into [2, MAX]; fewer than two would not be best-of-anything.
    let attempts = call
        .arguments
        .get("attempts")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_SPECULATION_ATTEMPTS)
        .clamp(2, MAX_SPECULATION_ATTEMPTS);
    let approaches = parse_string_array(&call.arguments, "approaches");
    let slots = parse_string_array(&call.arguments, "slots");

    // Depth cap up front: every attempt is `spawner.depth + 1`, so an agent at the max depth cannot
    // speculate at all — refuse rather than failing on the first attempt's dispatch.
    if spawner.depth >= orch.config.max_depth {
        return ToolOutcome::failed(
            ToolFailure::LimitExceeded,
            format!(
                "cannot speculate: you are at the maximum delegation depth ({}), so the parallel \
                 attempts (which run one level deeper) cannot be spawned. Do this work yourself.",
                orch.config.max_depth
            ),
        );
    }

    // The speculation lifecycle rides on this agent's stream, scoped to the issue when there is one.
    let spec_emitter = match &issue_id {
        Some(id) => emitter.with_issue(id),
        None => emitter.clone(),
    };
    spec_emitter.emit(speculation_event(
        attempts,
        GgSpeculationPhase::FannedOut,
        None,
        None,
    ));

    // Fan out K attempts, each in its own isolated worktree left in place for judging.
    let mut fanned: Vec<SpeculationAttempt> = Vec::with_capacity(attempts as usize);
    for i in 0..attempts as usize {
        let brief = build_attempt_brief(
            &base_brief,
            i,
            attempts as usize,
            approaches.get(i),
            orch.code.enabled,
        );
        let slot = slots
            .get(i)
            .map(String::as_str)
            .filter(|slot| !slot.is_empty())
            .unwrap_or(PRIMARY_SLOT);
        match dispatch_child(
            sub,
            spawner,
            brief,
            issue_id.clone(),
            slot,
            Some(WorktreeDisposition::Speculative),
        ) {
            Ok(child) => match (child.worktree_branch, child.worktree_path) {
                (Some(branch), Some(path)) => fanned.push(SpeculationAttempt {
                    id: child.id,
                    branch,
                    path,
                    status: String::new(),
                    summary: String::new(),
                    diff: String::new(),
                }),
                // Isolation is required and was checked above, so every attempt gets a worktree; a
                // child without one is only defensively possible. Wind down and abort.
                _ => {
                    abort_speculation(sub, &orch, emitter, &fanned).await;
                    return ToolOutcome::failed(
                        ToolFailure::Unavailable,
                        "cannot speculate: an attempt could not be given an isolated worktree; the \
                         speculation was aborted and the workspace left unchanged.",
                    );
                }
            },
            Err(err) => {
                abort_speculation(sub, &orch, emitter, &fanned).await;
                let failure = err.failure;
                return ToolOutcome::failed(
                    failure,
                    format!(
                        "cannot speculate: attempt {} of {attempts} could not be dispatched: {err} \
                         The speculation was aborted and the workspace left unchanged.",
                        i + 1
                    ),
                );
            }
        }
    }

    // Wait for every attempt (freeing this agent's slot while they run under the cap), then record
    // each attempt's outcome and its diff against the baseline.
    let ids: Vec<String> = fanned.iter().map(|a| a.id.clone()).collect();
    let collected = await_children(sub, emitter, &ids).await;
    let mut returns: HashMap<String, AgentReturn> = collected
        .into_iter()
        .filter_map(|(id, ret)| ret.map(|ret| (id, ret)))
        .collect();
    for attempt in &mut fanned {
        match returns.remove(&attempt.id) {
            Some(ret) => {
                attempt.status = ret.status.to_string();
                attempt.summary = ret.summary;
            }
            None => attempt.status = "(no result)".to_string(),
        }
        attempt.diff = {
            let _guard = orch.git_lock.lock().expect("git lock");
            git::diff_since(&attempt.path, &baseline).unwrap_or_default()
        };
    }

    // Candidates: attempts that completed cleanly AND produced real changes to merge.
    let candidates: Vec<usize> = fanned
        .iter()
        .enumerate()
        .filter(|(_, a)| a.status == STATUS_COMPLETED && !a.diff.trim().is_empty())
        .map(|(i, _)| i)
        .collect();

    if candidates.is_empty() {
        discard_attempts(&orch, &fanned);
        spec_emitter.emit(speculation_event(
            attempts,
            GgSpeculationPhase::Judged,
            None,
            Some("no attempt produced usable work to merge".to_string()),
        ));
        return ToolOutcome::failed(
            ToolFailure::Conflict,
            format!(
                "The speculation ran {attempts} attempt(s) but none produced usable work to merge \
                 (each failed, timed out, or made no changes). The workspace is unchanged."
            ),
        );
    }

    // Judge the candidates and pick the winner. A lone candidate needs no judge.
    let (winner_index, rationale) = if candidates.len() == 1 {
        (
            candidates[0],
            "only one attempt produced usable work".to_string(),
        )
    } else {
        let judge_brief = build_judge_brief(&base_brief, &fanned, &candidates, orch.code.enabled);
        let judge_slot = orch.judge_slot();
        match dispatch_judge(
            sub,
            spawner,
            emitter,
            issue_id.clone(),
            judge_brief,
            &judge_slot,
        )
        .await
        {
            Ok(verdict) => {
                // The judge numbers the candidates 1..N; map back to the attempt index, clamping a
                // stray index into range so a well-formed-but-out-of-bounds pick still merges a real
                // candidate rather than aborting the whole speculation.
                let picked = verdict.winner.clamp(1, candidates.len());
                (candidates[picked - 1], verdict.rationale)
            }
            Err(err) => {
                // The judge could not render a verdict: abort rather than merge an unjudged attempt.
                discard_attempts(&orch, &fanned);
                emitter.emit(log(
                    "warn",
                    format!(
                        "the speculation judge did not complete: {err}; no attempt was merged."
                    ),
                ));
                spec_emitter.emit(speculation_event(
                    attempts,
                    GgSpeculationPhase::Judged,
                    None,
                    Some(format!("the judge did not complete: {err}")),
                ));
                return ToolOutcome::failed(
                    ToolFailure::IoError,
                    format!(
                        "The speculation's judge did not render a verdict ({err}), so no attempt \
                         was merged. The workspace is unchanged."
                    ),
                );
            }
        }
    };

    let winner_id = fanned[winner_index].id.clone();
    spec_emitter.emit(speculation_event(
        attempts,
        GgSpeculationPhase::Judged,
        Some(winner_id.clone()),
        Some(rationale.clone()),
    ));

    // Merge the winner's worktree back into the main tree, then discard every attempt's worktree (the
    // winner's now-merged branch and the losers' unmerged branches alike). The main tree, untouched
    // while the attempts ran in isolation, now holds exactly the winning attempt's changes.
    let merged = merge_speculation_winner(&orch, &fanned[winner_index]);
    discard_attempts(&orch, &fanned);

    match merged {
        Ok(()) => {
            spec_emitter.emit(speculation_event(
                attempts,
                GgSpeculationPhase::Merged,
                Some(winner_id.clone()),
                None,
            ));
            let summary = format!(
                "Ran best-of-{attempts}: attempt `{winner_id}` won ({rationale}) and its work was \
                 merged into your workspace; the other attempts were discarded. Continue from the \
                 merged result."
            );
            ToolOutcome::ok(
                summary.clone(),
                format!("speculation merged winner `{winner_id}` of {attempts}"),
            )
            // The structured half: `speculate` never reaches a [`Tool`](crate::tools::Tool), so
            // this is its only producer. `attempts` is the clamped count that actually ran, not
            // the one that was asked for.
            .with_data(ToolData::Speculation(SpeculationData {
                winner_id,
                attempts: u8::try_from(attempts).unwrap_or(u8::MAX),
                rationale: Some(rationale),
                summary,
            }))
        }
        Err(err) => {
            emitter.emit(log(
                "warn",
                format!("the speculation winner `{winner_id}` could not be merged back: {err}."),
            ));
            ToolOutcome::failed(
                ToolFailure::Conflict,
                format!(
                    "The speculation chose attempt `{winner_id}`, but its work could not be merged \
                     back into your workspace: {err}. The workspace is unchanged."
                ),
            )
        }
    }
}

/// Wind a partially fanned-out speculation down after a dispatch failure: wait for the attempts
/// already running (so none is leaked) then discard their worktrees. Shared by the two abort paths in
/// [`handle_speculate`].
async fn abort_speculation(
    sub: &mut SubagentContext,
    orch: &Orchestrator,
    emitter: &Emitter,
    fanned: &[SpeculationAttempt],
) {
    let ids: Vec<String> = fanned.iter().map(|a| a.id.clone()).collect();
    let _ = await_children(sub, emitter, &ids).await;
    discard_attempts(orch, fanned);
}

/// Build one [attempt](SpeculationAttempt)'s brief for a [speculative execution](handle_speculate):
/// the shared task, a note that it is one of K independent attempts (judged best-of-K), and the
/// attempt's assigned approach hint when one was given.
///
/// `code` swaps the ending clause, because an attempt that does not reach `completed` is filtered
/// out of the candidate set entirely — a [responses-as-code](CAPABILITY_RESPONSES_AS_CODE)
/// speculation told to "stop" would produce K attempts and no candidates.
fn build_attempt_brief(
    base: &str,
    index: usize,
    k: usize,
    approach: Option<&String>,
    code: bool,
) -> String {
    let ending = if code {
        "When you are done, call `finish()` from inside a program with a short summary of what you \
         built and why it is a strong solution"
    } else {
        "When you are done, stop with a short summary of what you built and why it is a strong \
         solution"
    };
    let mut brief = format!(
        "{base}\n\n## Speculative attempt {} of {k}\nYou are ONE of {k} independent attempts at this \
         exact task, each running in its own isolated copy of the workspace (you cannot see the \
         others, and they cannot see you). Produce your best, complete implementation of the task \
         above. {ending} — a judge will compare all attempts and keep only the best one, discarding \
         the rest.",
        index + 1
    );
    if let Some(approach) = approach.map(String::as_str).filter(|a| !a.is_empty()) {
        brief.push_str(&format!(
            "\n\n### Your assigned approach\nTake this approach for your attempt (the other attempts \
             are trying different ones): {approach}"
        ));
    }
    brief
}

/// Build the **judge**'s brief for a [speculative execution](handle_speculate): the task, each
/// candidate attempt's summary and diff, and the verdict protocol [`parse_judge_verdict`] expects.
/// The candidates are renumbered 1..N (the judge does not see the discarded attempts), and the caller
/// maps the judge's pick back to the original attempt index.
///
/// `code` swaps the ending clause: a judge that never reaches `completed` renders no verdict, and a
/// speculation with no verdict merges nothing at all.
fn build_judge_brief(
    task: &str,
    attempts: &[SpeculationAttempt],
    candidates: &[usize],
    code: bool,
) -> String {
    let n = candidates.len();
    let mut brief = format!(
        "You are the **judge** of a best-of-{n} speculative execution. {n} independent attempts each \
         tried the SAME task below; your job is to pick the single BEST one against its completion \
         criteria.\n\n## The task\n{task}\n\n## The attempts"
    );
    for (label, &idx) in candidates.iter().enumerate() {
        let attempt = &attempts[idx];
        let diff_block = if attempt.diff.trim().is_empty() {
            "(no changes)".to_string()
        } else {
            format!("```diff\n{}\n```", attempt.diff)
        };
        let summary = if attempt.summary.trim().is_empty() {
            "(no summary)"
        } else {
            attempt.summary.trim()
        };
        brief.push_str(&format!(
            "\n\n### Attempt {}\nThe attempt's own summary:\n{summary}\n\nIts changes (diff against \
             the baseline):\n{diff_block}",
            label + 1
        ));
    }
    if code {
        brief.push_str(&format!(
            "\n\n## Your verdict\nCompare the {n} attempts against the task's completion criteria — \
             correctness, completeness, and quality — and pick the single best one. End your \
             session by calling `finish()` from inside a program whose summary begins with exactly \
             one line:\n`SPECULATION JUDGE: WINNER <n>`\nwhere <n> is the attempt number (1–{n}) \
             you chose — followed by a one-sentence rationale for your choice."
        ));
    } else {
        brief.push_str(&format!(
            "\n\n## Your verdict\nCompare the {n} attempts against the task's completion criteria — \
             correctness, completeness, and quality — and pick the single best one. End your final \
             message with exactly one line:\n`SPECULATION JUDGE: WINNER <n>`\nwhere <n> is the \
             attempt number (1–{n}) you chose, followed by a one-sentence rationale for your choice."
        ));
    }
    brief
}

/// Dispatch one **judge** subagent against `judge_brief` on `judge_slot`, await it, and parse its
/// [verdict](parse_judge_verdict) — the [speculative execution](handle_speculate) analogue of
/// [`dispatch_reviewer`] (a judge that *selects among* K attempts rather than approving one diff).
///
/// Returns the verdict, or a model-facing error when the judge could not be dispatched or returned
/// without a parseable pick; the caller then merges nothing (best-of-K never merges an unjudged
/// attempt). The judge is an ordinary [subagent](dispatch_child) scoped to `issue_id` (when any) and
/// runs in the shared tree (it only reads the diffs in its brief).
async fn dispatch_judge(
    sub: &mut SubagentContext,
    spawner: &Agent,
    emitter: &Emitter,
    issue_id: Option<String>,
    judge_brief: String,
    judge_slot: &str,
) -> Result<JudgeVerdict, String> {
    let judge = dispatch_child(sub, spawner, judge_brief, issue_id, judge_slot, None)
        .map_err(|err| format!("the judge could not be dispatched: {err}"))?;
    let collected = await_children(sub, emitter, std::slice::from_ref(&judge.id)).await;
    match collected.into_iter().next() {
        Some((_, Some(ret))) if ret.status == STATUS_COMPLETED => parse_judge_verdict(&ret.summary),
        Some((_, Some(ret))) => Err(format!("the judge {} without a verdict", ret.status)),
        _ => Err("the judge produced no result".to_string()),
    }
}

/// Parse a judge's final message into a [`JudgeVerdict`].
///
/// The contract: the judge ends with a `SPECULATION JUDGE: WINNER <n>` marker naming the 1-based
/// candidate it chose, followed by a rationale. Parsing is lenient — the marker match is
/// case-insensitive and the last occurrence wins — but a message with **no** winner marker (or a
/// non-numeric / zero winner) is an **error**, so a judge that did not clearly pick never causes a
/// silent or arbitrary merge.
fn parse_judge_verdict(text: &str) -> Result<JudgeVerdict, String> {
    const MARKER: &str = "speculation judge: winner";
    let lower = text.to_ascii_lowercase();
    let pos = lower.rfind(MARKER).ok_or_else(|| {
        "the judge did not report a `SPECULATION JUDGE: WINNER <n>` verdict".to_string()
    })?;
    let after = &text[pos + MARKER.len()..];
    // The winner number is the first run of ASCII digits after the marker.
    let Some(start) = after.find(|c: char| c.is_ascii_digit()) else {
        return Err("the judge's verdict did not name a numeric winner".to_string());
    };
    let digits: String = after[start..]
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    let winner: usize = digits
        .parse()
        .map_err(|_| "the judge's verdict did not name a numeric winner".to_string())?;
    if winner == 0 {
        return Err("the judge named winner 0 (attempts are numbered from 1)".to_string());
    }
    // The rationale is whatever follows the winner number, else the first line of the message.
    let rest = after[start + digits.len()..]
        .trim()
        .trim_start_matches([':', '.', '-', ')', '\n'])
        .trim();
    let rationale = if rest.is_empty() {
        first_line(text).to_string()
    } else {
        first_line(rest).to_string()
    };
    let rationale = if rationale.is_empty() {
        "the judge selected this attempt".to_string()
    } else {
        rationale
    };
    Ok(JudgeVerdict { winner, rationale })
}

/// Merge a [speculative execution](handle_speculate)'s winning attempt back into the main tree:
/// commit its worktree's work onto its branch (its index was reset by the earlier
/// [diff](git::diff_since)), then [merge that branch](git::merge_branch) into the workspace with an
/// explicit merge commit. Returns an error (leaving the main tree unchanged) on a conflict or git
/// failure. Serialized on the shared [git lock](Orchestrator::git_lock).
fn merge_speculation_winner(
    orch: &Orchestrator,
    winner: &SpeculationAttempt,
) -> Result<(), String> {
    let _guard = orch.git_lock.lock().expect("git lock");
    git::commit_worktree(
        &winner.path,
        &format!("gg speculation winner {}", winner.id),
    )
    .map_err(|err| format!("committing the winning attempt failed: {err}"))?;
    match git::merge_branch(&orch.workspace_dir, &winner.branch) {
        Ok(git::MergeOutcome::Merged) => Ok(()),
        Ok(git::MergeOutcome::Conflict(reason)) => Err(format!(
            "the merge conflicted with the main tree: {}",
            first_line(&reason)
        )),
        Err(err) => Err(err.to_string()),
    }
}

/// Tear down every [attempt](SpeculationAttempt)'s worktree and branch — run after a speculation
/// merges its winner, or aborts — so no isolated copy or dangling branch is left behind. Cleanup must
/// not fail the run, so per-worktree failures are ignored (a stray worktree is only noise).
/// Serialized on the shared [git lock](Orchestrator::git_lock).
fn discard_attempts(orch: &Orchestrator, attempts: &[SpeculationAttempt]) {
    let _guard = orch.git_lock.lock().expect("git lock");
    for attempt in attempts {
        let _ = git::remove_worktree(&orch.workspace_dir, &attempt.path, &attempt.branch);
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

/// A [`Speculation`](GgTelemetryKind::Speculation) telemetry event for one lifecycle transition. The
/// issue under speculation (when any) rides on the emitter's [issue scope](Emitter::with_issue), not
/// the payload.
fn speculation_event(
    attempts: u64,
    phase: GgSpeculationPhase,
    winner: Option<String>,
    rationale: Option<String>,
) -> GgTelemetryKind {
    GgTelemetryKind::Speculation {
        attempts,
        phase,
        winner,
        rationale,
    }
}

// ---------------------------------------------------------------------------
// FSM-driven processes: drive the agent through a fixed, ordered machine
// ---------------------------------------------------------------------------

/// The result of an intercepted `advance_state` call: the model-facing [outcome](ToolOutcome) plus,
/// for a [`plan-first`](crate::fsm) plan reset, the plan text to seed after the turn's tool results
/// are recorded (mirroring how `submit_plan` defers its context reset, so the conversation stays
/// valid).
struct AdvanceResult {
    /// What the model sees for its `advance_state` call — the state entered, or a refusal explaining
    /// the unmet condition.
    outcome: ToolOutcome,
    /// The plan to reset the context with after this turn (the `plan-first` `plan → implement`
    /// reset), or `None` for every other transition.
    submit_plan: Option<String>,
}

impl AdvanceResult {
    /// A result carrying only an outcome (no deferred plan reset).
    fn just(outcome: ToolOutcome) -> Self {
        Self {
            outcome,
            submit_plan: None,
        }
    }
}

/// Handle an intercepted `advance_state` by driving the [FSM](crate::fsm): check the current state's
/// [transition condition](StateExit) and, when it holds, move the machine to the next state (emitting
/// [`FsmState`](GgTelemetryKind::FsmState) and injecting the new state's guidance); when it does not,
/// **refuse** the advance so the agent stays put and cannot skip ahead.
///
/// The three exit kinds:
/// - [`Advance`](StateExit::Advance) — evaluate the [guard](crate::fsm::AdvanceGuard) against the
///   workspace (for `tdd`, tests/implementation must exist); on success step forward, and if the
///   state entered is the transient [`review`](StateExit::ReviewGate) state, run its
///   [Code Review](process_review_gate) inline;
/// - [`PlanReset`](StateExit::PlanReset) — `plan-first`'s `plan` state: take the plan from the call's
///   `note`, step to `implement`, and defer the [context reset](AdvanceResult::submit_plan) (reusing
///   the planning flow);
/// - [`ReviewGate`](StateExit::ReviewGate)/[`Terminal`](StateExit::Terminal) — not agent-advanced, so
///   `advance_state` is refused (these were never offered while resting).
async fn handle_advance_state(
    fsm: &mut FsmRuntime,
    context: &mut ContextModel,
    subagents: Option<&mut SubagentContext>,
    spawner: &Agent,
    tool_ctx: &ToolContext,
    emitter: &Emitter,
    call: &ToolCall,
) -> AdvanceResult {
    // The current state's exit decides how (and whether) the machine moves. Copied out so no borrow
    // of `fsm` is held across the mutation below.
    let Some(exit) = fsm.current_state().map(|state| state.exit) else {
        return AdvanceResult::just(ToolOutcome::error(
            "advance_state: no state machine is driving this run.",
        ));
    };

    match exit {
        StateExit::Advance(guard) => {
            // Enforce the order: the guard's evidence must be present in the workspace, else the
            // advance is refused and the agent stays in this state.
            if let Err(reason) = guard.evaluate(&tool_ctx.workspace_dir) {
                return AdvanceResult::just(ToolOutcome::error(reason));
            }
            let (name, guidance, new_exit) = advance_owned(fsm);
            if name.is_empty() {
                return AdvanceResult::just(ToolOutcome::ok(
                    "You are already at the final state; finish your work and stop.",
                    "fsm already at final state",
                ));
            }
            emitter.emit(fsm_state_event(
                fsm.machine_name(),
                name,
                fsm.current_index(),
            ));
            // Entering the transient `review` state triggers a Code Review, which decides the next
            // move (to `accept`, or back to `develop`). The `review` state is not rested in.
            if matches!(new_exit, StateExit::ReviewGate) {
                return process_review_gate(fsm, context, subagents, spawner, emitter).await;
            }
            push_state_guidance(context, guidance, new_exit);
            AdvanceResult::just(ToolOutcome::ok(
                format!("Advanced to the `{name}` state. Follow its guidance."),
                format!("advanced to `{name}`"),
            ))
        }
        StateExit::PlanReset => {
            // plan-first: the plan comes from the call's `note`. The reset (clearing the exploration
            // and seeding the framed plan) is deferred to after this turn's tool results, like
            // `submit_plan`, so the conversation stays valid.
            let plan = call
                .arguments
                .get("note")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim()
                .to_string();
            if plan.is_empty() {
                return AdvanceResult::just(ToolOutcome::error(
                    "advance_state: include your implementation plan in the `note` before advancing \
                     from the plan state — it seeds your fresh implementation context.",
                ));
            }
            emitter.emit(GgTelemetryKind::Planning {
                phase: GgPlanPhase::Submitted,
                plan: Some(plan.clone()),
            });
            let (name, guidance, new_exit) = advance_owned(fsm);
            emitter.emit(fsm_state_event(
                fsm.machine_name(),
                name,
                fsm.current_index(),
            ));
            // The implement-state guidance is pinned, so it survives the deferred `clear_ephemeral`.
            push_state_guidance(context, guidance, new_exit);
            AdvanceResult {
                outcome: ToolOutcome::ok(
                    "Plan accepted. Clearing your exploration and starting implementation from a \
                     clean context with the original request and your plan.",
                    "advanced to `implement`",
                ),
                submit_plan: Some(plan),
            }
        }
        StateExit::ReviewGate => AdvanceResult::just(ToolOutcome::error(
            "advance_state is not available while a Code Review is running.",
        )),
        StateExit::Terminal => AdvanceResult::just(ToolOutcome::error(
            "advance_state: you are in the final state of the process; finish your work and stop.",
        )),
    }
}

/// Process the transient [`review`](StateExit::ReviewGate) state of the [`review-gated`](crate::fsm)
/// machine, just entered from `develop`: run a run-level [Code Review](dispatch_reviewer) of the
/// work, then move the machine on — to `accept` on **approval**, or **back to `develop`** with the
/// reviewer's items on changes. This is the composition of the Code Review capability into the FSM.
///
/// The reviewer is an ordinary subagent, so delegation must be available; when it is not (a
/// misconfigured `review-gated` run, already warned at start), the review is skipped and the machine
/// passes through to `accept` so the run can still finish.
async fn process_review_gate(
    fsm: &mut FsmRuntime,
    context: &mut ContextModel,
    subagents: Option<&mut SubagentContext>,
    spawner: &Agent,
    emitter: &Emitter,
) -> AdvanceResult {
    let Some(sub) = subagents else {
        emitter.emit(log(
            "warn",
            "the `review-gated` machine reached its `review` state, but no subagents are available \
             to run the Code Review; the work is accepted without one (enable the `subagents` \
             capability for a real Code Review).",
        ));
        let (name, guidance, new_exit) = advance_owned(fsm);
        emitter.emit(fsm_state_event(
            fsm.machine_name(),
            name,
            fsm.current_index(),
        ));
        push_state_guidance(context, guidance, new_exit);
        return AdvanceResult::just(ToolOutcome::ok(
            "Advanced to `accept` (no reviewer was available to run a Code Review).",
            "advanced to `accept`",
        ));
    };

    let orch = Arc::clone(&sub.orch);
    let baseline = orch.baseline_commit().map(str::to_string);
    // The Code Review lifecycle rides on the root's (run-level) stream — a review-gated run reviews
    // the whole run's diff, not a board issue.
    emitter.emit(code_review_event(
        GgCodeReviewPhase::Requested,
        None,
        baseline.clone(),
    ));
    let diff = orch.run_diff();
    let review_brief = build_review_brief(&orch.prompt, &diff, orch.code.enabled);
    let reviewer_slot = orch.reviewer_slot();
    let verdict = match dispatch_reviewer(sub, spawner, emitter, None, review_brief, &reviewer_slot)
        .await
    {
        Ok(verdict) => verdict,
        Err(err) => {
            // The review could not complete: leave the machine back in `develop` so the agent can
            // fix things and try again, rather than accepting unreviewed work.
            emitter.emit(log(
                "warn",
                format!("the `review-gated` Code Review did not complete: {err}."),
            ));
            let develop_index = fsm.index_of("develop").unwrap_or(0);
            let (name, _guidance, _exit) = revert_owned(fsm, develop_index);
            emitter.emit(fsm_state_event(
                fsm.machine_name(),
                name,
                fsm.current_index(),
            ));
            return AdvanceResult::just(ToolOutcome::error(format!(
                "The Code Review could not complete ({err}); you are back in the `develop` state. \
                 Address anything outstanding and call `advance_state` to try again."
            )));
        }
    };

    if verdict.approved {
        emitter.emit(code_review_event(
            GgCodeReviewPhase::Approved,
            None,
            baseline,
        ));
        let (name, guidance, new_exit) = advance_owned(fsm);
        emitter.emit(fsm_state_event(
            fsm.machine_name(),
            name,
            fsm.current_index(),
        ));
        push_state_guidance(context, guidance, new_exit);
        AdvanceResult::just(ToolOutcome::ok(
            "The Code Review approved your work; advanced to `accept`. Summarize and stop.",
            "code review approved; advanced to `accept`",
        ))
    } else {
        // Changes requested: loop back to `develop` with the reviewer's items injected as guidance.
        emitter.emit(code_review_event(
            GgCodeReviewPhase::ChangesRequested,
            Some(verdict.items.clone()),
            baseline,
        ));
        let develop_index = fsm.index_of("develop").unwrap_or(0);
        let (name, _guidance, _exit) = revert_owned(fsm, develop_index);
        emitter.emit(fsm_state_event(
            fsm.machine_name(),
            name,
            fsm.current_index(),
        ));
        let items_guidance = build_review_items_guidance(&verdict.items);
        context.push(
            GgContextSource::System,
            Retention::Pinned,
            Message::user(items_guidance),
        );
        AdvanceResult::just(ToolOutcome::error(format!(
            "The Code Review requested changes; you are back in the `develop` state (`{name}`). \
             Address the reviewer's items (now in your guidance), then call `advance_state` to \
             re-submit for review."
        )))
    }
}

/// Step the machine to the next state and return the entered state's `(name, guidance, exit)` as
/// owned/copied values, so the caller holds no borrow of the runtime across the emit/inject that
/// follow. A machine already at its last state returns an empty name.
fn advance_owned(fsm: &mut FsmRuntime) -> (&'static str, String, StateExit) {
    match fsm.advance() {
        Some(state) => (state.name, state.guidance.clone(), state.exit),
        None => ("", String::new(), StateExit::Terminal),
    }
}

/// Move the machine **back** to the state at `index` (a `review-gated` loop-back to `develop`),
/// returning the entered state's `(name, guidance, exit)` as owned/copied values.
fn revert_owned(fsm: &mut FsmRuntime, index: usize) -> (&'static str, String, StateExit) {
    match fsm.revert_to(index) {
        Some(state) => (state.name, state.guidance.clone(), state.exit),
        None => ("", String::new(), StateExit::Terminal),
    }
}

/// Inject a state's `guidance` into the context on entering it. A [`PlanReset`](StateExit::PlanReset)
/// (plan-first `plan`) state's guidance is **ephemeral** — the plan → implement reset clears it —
/// while every other state's guidance is **pinned** (it frames what the agent must do for the rest of
/// that state and survives compaction). Tagged [`System`](GgContextSource::System) as process-level
/// instruction. An empty guidance (a machine past its last state) injects nothing.
fn push_state_guidance(context: &mut ContextModel, guidance: String, exit: StateExit) {
    if guidance.trim().is_empty() {
        return;
    }
    let retention = if matches!(exit, StateExit::PlanReset) {
        Retention::Ephemeral
    } else {
        Retention::Pinned
    };
    context.push(GgContextSource::System, retention, Message::user(guidance));
}

/// A [`FsmState`](GgTelemetryKind::FsmState) telemetry event for a transition into `state` (index
/// `index`) of `machine`.
fn fsm_state_event(machine: &str, state: &str, index: usize) -> GgTelemetryKind {
    GgTelemetryKind::FsmState {
        machine: machine.to_string(),
        state: state.to_string(),
        state_index: index as u64,
    }
}

/// The model-facing message for a tool call the current [FSM](crate::fsm) state withholds — a
/// defensive guard (the tool was not offered this turn). Explains the state and how to proceed
/// (explore then advance, for a read-only state; complete the work then advance, otherwise).
fn fsm_refusal(name: &str, fsm: &FsmRuntime) -> String {
    match fsm.current_state() {
        Some(state) => {
            let how = match state.tool_policy {
                ToolPolicy::ReadOnly => {
                    "This state is read-only: explore with `read_file`, `list_dir`, `read_skill`, \
                     and `search_archive`, then call `advance_state` to move on."
                }
                ToolPolicy::All => {
                    "Do this state's work, then call `advance_state` once its condition is met."
                }
            };
            format!(
                "`{name}` is not available in the `{}` state of the `{}` process. {how}",
                state.name,
                fsm.machine_name(),
            )
        }
        None => format!("`{name}` is not available right now."),
    }
}

/// The guidance injected when a [`review-gated`](crate::fsm) Code Review requests changes and the
/// machine loops back to `develop`: the reviewer's actionable items the agent must address before
/// re-submitting.
fn build_review_items_guidance(items: &[String]) -> String {
    let mut list = String::new();
    for (index, item) in items.iter().enumerate() {
        list.push_str(&format!("\n{}. {}", index + 1, item));
    }
    if list.is_empty() {
        list.push_str(
            "\n1. The Code Review did not approve the work but listed no specific items; re-check \
             the task and make sure every part is done.",
        );
    }
    format!(
        "# Code Review requested changes\n\nA Code Review of your work did not approve it. You are \
         back in the `develop` state. Address every item below, then call `advance_state` to submit \
         for re-review:{list}"
    )
}

// ---------------------------------------------------------------------------
// Declared workflows: fan-out + sequencing over the subagent scheduler
// ---------------------------------------------------------------------------

/// One parsed stage of a declared [workflow](run_workflow): its name, per-item brief template, the
/// items it fans out over (or `None` to fan over the prior stage's results), and its dispatch
/// options (slot, worktree).
struct WorkflowStageSpec {
    /// The stage's name, for the [`WorkflowStage`](GgTelemetryKind::WorkflowStage) timeline label.
    name: String,
    /// The per-item brief template (`{{item}}` / `{{prior}}` placeholders are substituted per item).
    prompt: String,
    /// The explicit items to fan out over, or `None` to fan out over the prior stage's results (one
    /// subagent per result). The first stage must supply items.
    items: Option<Vec<String>>,
    /// The requested [model slot](GgSlotBinding) for this stage's subagents (default primary).
    slot: String,
    /// Whether each of this stage's subagents runs in its own isolated [worktree](Worktree).
    worktree: bool,
}

/// Handle `run_workflow`: execute a **declared** multi-stage subagent fan-out as one unit, driving
/// the [same scheduler](Scheduler) ad-hoc subagents use — so a workflow honors the one global
/// parallelism cap and the depth cap and gets no separate budget.
///
/// Each stage [fans out](dispatch_child) one subagent per item (each brief rendered from the stage
/// template with `{{item}}`/`{{prior}}` substituted), [waits](await_children) for all of them
/// (freeing this agent's slot while it waits, exactly like `wait_for_subagents`), collects their
/// results in dispatch order, and feeds them to the next stage. The first stage lists its items; a
/// later stage with no items fans out over the prior stage's results. The fanned-out agents are
/// ordinary subagents — they animate the tree with the usual spawn/status/return telemetry — and
/// the workflow's own structure is streamed as [`WorkflowStage`](GgTelemetryKind::WorkflowStage)
/// start/finish boundaries. Returns the final stage's collected results to the caller. A malformed
/// declaration or a stage-dispatch failure ends the workflow with a model-facing error (after
/// waiting for any already-dispatched agents of the failing stage so none are leaked).
async fn run_workflow(
    sub: &mut SubagentContext,
    spawner: &Agent,
    emitter: &Emitter,
    args: &Value,
) -> ToolOutcome {
    let stages = match parse_workflow_stages(args) {
        Ok(stages) => stages,
        Err(err) => return ToolOutcome::failed(ToolFailure::InvalidArgument, err),
    };

    // Depth cap up front: every fanned-out agent is `spawner.depth + 1`, so an agent already at the
    // max depth cannot run a workflow at all — refuse the whole thing rather than failing on the
    // first stage's first dispatch.
    if spawner.depth >= sub.orch.config.max_depth {
        return ToolOutcome::failed(
            ToolFailure::LimitExceeded,
            format!(
                "cannot run a workflow: you are at the maximum delegation depth ({}), so a \
                 workflow's subagents (which run one level deeper) cannot be spawned. Do this work \
                 yourself.",
                sub.orch.config.max_depth
            ),
        );
    }

    let workflow_id = sub.orch.next_workflow_id();
    // The previous stage's collected results, fed into the next stage. Empty before the first stage.
    let mut prior_results: Vec<String> = Vec::new();

    for (index, stage) in stages.iter().enumerate() {
        // The items this stage fans out over: its explicit list, or (for a later stage) the prior
        // stage's results, one subagent each.
        let items: Vec<String> = match &stage.items {
            Some(items) => items.clone(),
            None => {
                if index == 0 {
                    return ToolOutcome::failed(
                        ToolFailure::InvalidArgument,
                        format!(
                            "workflow stage `{}` (the first stage) has no `items` to fan out over; \
                             the first stage must list its items.",
                            stage.name
                        ),
                    );
                }
                prior_results.clone()
            }
        };
        if items.is_empty() {
            return ToolOutcome::failed(
                ToolFailure::InvalidArgument,
                format!(
                    "workflow stage `{}` has no items to fan out over (the previous stage produced \
                     no results to feed it).",
                    stage.name
                ),
            );
        }

        // The prior stage's results, rendered once for this stage's `{{prior}}` substitutions.
        let prior_block = join_prior_results(&prior_results);

        emitter.emit(workflow_stage_event(
            &workflow_id,
            &stage.name,
            index,
            items.len(),
            GgWorkflowPhase::Started,
        ));

        // Fan out: dispatch one subagent per item, each with its own rendered brief.
        let mut ids = Vec::with_capacity(items.len());
        for item in &items {
            let brief = render_template(&stage.prompt, item, &prior_block);
            let stage_worktree = stage.worktree.then_some(WorktreeDisposition::Merge);
            match dispatch_child(sub, spawner, brief, None, &stage.slot, stage_worktree) {
                Ok(child) => ids.push(child.id),
                Err(err) => {
                    // A dispatch failure aborts the workflow, but the already-dispatched agents of
                    // this stage are running — wait for them so none is leaked, close the stage
                    // boundary, and report the failure.
                    let _ = await_children(sub, emitter, &ids).await;
                    emitter.emit(workflow_stage_event(
                        &workflow_id,
                        &stage.name,
                        index,
                        items.len(),
                        GgWorkflowPhase::Finished,
                    ));
                    let failure = err.failure;
                    return ToolOutcome::failed(
                        failure,
                        format!(
                            "workflow stage `{}` could not dispatch a subagent: {err}",
                            stage.name
                        ),
                    );
                }
            }
        }

        // Wait for the whole stage and collect its results in dispatch order to feed the next stage.
        let collected = await_children(sub, emitter, &ids).await;
        prior_results = collected
            .into_iter()
            .map(|(id, returned)| match returned {
                Some(ret) => ret.summary,
                None => format!("(subagent `{id}` returned no result)"),
            })
            .collect();

        emitter.emit(workflow_stage_event(
            &workflow_id,
            &stage.name,
            index,
            items.len(),
            GgWorkflowPhase::Finished,
        ));
    }

    let final_block = prior_results
        .iter()
        .enumerate()
        .map(|(i, result)| format!("[result {}]\n{result}", i + 1))
        .collect::<Vec<_>>()
        .join("\n\n");
    ToolOutcome::ok(
        format!(
            "Workflow `{workflow_id}` completed {} stage(s). The final stage produced {} \
             result(s):\n\n{final_block}",
            stages.len(),
            prior_results.len(),
        ),
        format!("ran workflow `{workflow_id}` ({} stage(s))", stages.len()),
    )
    // The structured half: the workflow driver is the only producer of it, since `run_workflow`
    // never reaches a [`Tool`](crate::tools::Tool). The final stage's results are handed over as a
    // list so a [code program](crate::sandbox) can feed them straight into whatever it does next,
    // instead of re-parsing the `[result N]` blocks out of the prose.
    .with_data(ToolData::Workflow(WorkflowData {
        workflow_id,
        stages: saturating_u32(stages.len()),
        results: prior_results,
    }))
}

/// Parse `run_workflow`'s `stages` argument into [`WorkflowStageSpec`]s, or a model-facing error
/// naming the problem. Each stage needs a non-empty `prompt`; `name` defaults to `stage-N`, `items`
/// is optional (an array of non-empty strings), `slot` defaults to [`PRIMARY_SLOT`], and `worktree`
/// defaults to `false`.
fn parse_workflow_stages(args: &Value) -> Result<Vec<WorkflowStageSpec>, String> {
    let raw = match args.get("stages") {
        Some(Value::Array(stages)) => stages,
        Some(_) => return Err("run_workflow's `stages` must be an array of stage objects.".into()),
        None => {
            return Err(
                "run_workflow needs a `stages` array (the ordered workflow stages).".into(),
            );
        }
    };
    if raw.is_empty() {
        return Err("run_workflow needs at least one stage.".into());
    }

    let mut stages = Vec::with_capacity(raw.len());
    for (index, stage) in raw.iter().enumerate() {
        let name = stage
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("stage-{}", index + 1));

        let prompt = stage
            .get("prompt")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|prompt| !prompt.is_empty())
            .ok_or_else(|| format!("workflow stage `{name}` needs a non-empty `prompt` template."))?
            .to_string();

        let items = match stage.get("items") {
            None | Some(Value::Null) => None,
            Some(Value::Array(raw_items)) => {
                let mut items = Vec::with_capacity(raw_items.len());
                for entry in raw_items {
                    match entry.as_str().map(str::trim) {
                        Some(item) if !item.is_empty() => items.push(item.to_string()),
                        Some(_) => {
                            return Err(format!(
                                "workflow stage `{name}`: every `items` entry must be a non-empty \
                                 string."
                            ));
                        }
                        None => {
                            return Err(format!(
                                "workflow stage `{name}`: every `items` entry must be a string."
                            ));
                        }
                    }
                }
                Some(items)
            }
            Some(_) => {
                return Err(format!(
                    "workflow stage `{name}`: `items` must be an array of strings."
                ));
            }
        };

        let slot = stage
            .get("slot")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|slot| !slot.is_empty())
            .unwrap_or(PRIMARY_SLOT)
            .to_string();
        let worktree = stage
            .get("worktree")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        stages.push(WorkflowStageSpec {
            name,
            prompt,
            items,
            slot,
            worktree,
        });
    }
    Ok(stages)
}

/// Render a workflow stage's per-item brief by substituting the `{{item}}` and `{{prior}}`
/// placeholders in `template` (whitespace inside the braces is tolerated). An unknown placeholder is
/// left verbatim so a template that legitimately contains `{{…}}` is not mangled.
fn render_template(template: &str, item: &str, prior: &str) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(open) = rest.find("{{") {
        out.push_str(&rest[..open]);
        let after = &rest[open + 2..];
        match after.find("}}") {
            Some(close) => {
                match after[..close].trim() {
                    "item" => out.push_str(item),
                    "prior" => out.push_str(prior),
                    // Not a known placeholder — keep the original braces verbatim.
                    _ => {
                        out.push_str("{{");
                        out.push_str(&after[..close]);
                        out.push_str("}}");
                    }
                }
                rest = &after[close + 2..];
            }
            // An unterminated `{{` — emit it literally and stop scanning.
            None => {
                out.push_str("{{");
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Render a stage's collected results into the block a later stage's `{{prior}}` placeholder
/// expands to — each result labeled and separated so a consolidating subagent can tell them apart.
/// Empty before the first stage has run.
fn join_prior_results(results: &[String]) -> String {
    results
        .iter()
        .enumerate()
        .map(|(i, result)| format!("[result {}]\n{result}", i + 1))
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// A [`WorkflowStage`](GgTelemetryKind::WorkflowStage) boundary event for a stage.
fn workflow_stage_event(
    workflow_id: &str,
    name: &str,
    index: usize,
    item_count: usize,
    phase: GgWorkflowPhase,
) -> GgTelemetryKind {
    GgTelemetryKind::WorkflowStage {
        workflow_id: workflow_id.to_string(),
        stage: name.to_string(),
        stage_index: index as u64,
        item_count: item_count as u64,
        phase,
    }
}

/// How a driven turn loop ended, plus the usage it accumulated.
struct LoopEnd {
    /// The terminal [`SessionEnded`](GgTelemetryKind::SessionEnded) status.
    status: &'static str,
    /// Turns actually executed (model calls made).
    turns: usize,
    /// Running total of token usage across the session.
    tokens: TokenCounts,
    /// Running total of cost across the session, when any turn reported one.
    cost: Option<Cost>,
    /// The [slot](GgSlotBinding) the agent ran on, so the orchestrator can attribute this
    /// usage/cost to the right slot in the [per-slot accounting](SlotAccounting).
    slot: String,
    /// The agent's **final word** — its [return value](AgentReturn) to its spawner, the run's last
    /// text, and what a Code Review verdict or a speculation judge's pick is parsed out of.
    ///
    /// It is filled by two different rules, because the two execution modes mean two different
    /// things by "final":
    ///
    /// * **tool calling** — the last natural-language assistant message the agent produced, exactly
    ///   as it always has been. `None` when the loop produced no assistant text at all (an immediate
    ///   timeout, say).
    /// * **[responses-as-code](CAPABILITY_RESPONSES_AS_CODE)** — the summary the program passed to
    ///   [`finish`](FINISH_FUNCTION) when the agent finished, and otherwise a
    ///   [status line](stopped_text) gg wrote itself. It is never the last assistant message,
    ///   because under that protocol every assistant message is a page of TypeScript: a spawner, a
    ///   run record and a judge's brief would each be handed program source where an answer belongs.
    final_text: Option<String>,
    /// The [execution ceiling](RunLimits) that stopped this agent, when one did.
    ///
    /// Present for all five ceilings, including the two whose terminal statuses predate this
    /// vocabulary (`exhausted`, `timed_out`) — so "which ceiling stopped it, at what value?" is one
    /// question with one answer rather than three parallel ways of inferring it from a status. The
    /// **root's** breach is what a run records as its own; a subagent's is its alone.
    limit: Option<GgLimitBreach>,
}

impl LoopEnd {
    /// A human-readable one-line summary of the session for a closing `Log` event.
    /// (Emitted as a log, not a second [`Usage`](GgTelemetryKind::Usage): per-turn
    /// `Usage` events are incremental deltas that consumers sum, so a total `Usage`
    /// would double-count.)
    fn summary(&self) -> String {
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
            "session ended ({}) after {} turn(s); {tokens} total tokens{cost}.",
            self.status, self.turns
        )
    }
}

impl Agent {
    /// Drive this agent's turn loop to completion, returning how it ended and the usage it
    /// accrued (tagged with the agent's [`slot`](Self::slot) for the
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
    /// the capability runtimes (`skills`/`memories`/`tasks`/`board`/`planning`), the
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
        limits: LimitsSetup,
        context_setup: ContextSetup,
        compaction: CompactionSetup,
        amc: AmcSetup,
        mut skills: SkillsRuntime,
        memories: MemoriesRuntime,
        tasks: TasksRuntime,
        board: BoardRuntime,
        planning: PlanningRuntime,
        mut fsm: FsmRuntime,
        read_policy: ReadPolicy,
        code_reviews: bool,
        speculative: bool,
        code: CodeSetup,
        mut subagents: Option<SubagentContext>,
        project: Option<ProjectContext>,
        replay: Option<Arc<GgRecorder>>,
    ) -> LoopEnd {
        let max_turns = limits.limits.max_turns;
        // Code Reviews gate `complete_issue` only when the capability is on *and* this agent has the
        // delegation machinery to run a reviewer (i.e. `subagents` is `Some`); otherwise
        // `complete_issue` accepts issues directly. Computed once here since `subagents` never
        // toggles over the loop.
        let code_reviews_active = code_reviews && subagents.is_some();
        // Speculative execution (`speculate`) likewise needs the delegation machinery to fan out the
        // attempts and run the judge; with it off, the tool (if offered) falls through to a defensive
        // refusal rather than engaging.
        let speculative_active = speculative && subagents.is_some();
        // The full offered toolset. When planning is on, each turn's request is filtered from this
        // by the loop's plan-mode state (read-only tools only while planning); otherwise the whole
        // set is offered every turn.
        let all_tools = registry.definitions();

        // Build the source-tagged context model in place of a flat transcript, seeded with
        // the two pinned items every session opens with: the system prompt (which lists any
        // available skills' descriptions and explains the memory scratchpad and task list) and
        // the build prompt. Every later contribution (assistant turns, tool output, file views,
        // read skills, the memory block, the task list) is appended as a tagged item, so the
        // window can be accounted by source and the pinned/ephemeral split is available for
        // Phase 2 compaction.
        let mut context = ContextModel::new(context_setup.estimator, context_setup.window_limit);
        context.push_system(system_prompt(PromptInputs {
            registry,
            skills: &skills,
            memories: &memories,
            tasks: &tasks,
            board: &board,
            planning: &planning,
            fsm: &fsm,
            read_policy,
            vision: &tool_ctx.vision,
            code_reviews: code_reviews_active,
            speculative: speculative_active,
            responses_as_code: code.enabled,
            // A subagent renders this same prompt, and the ending section has to say what `finish`
            // actually ends *for the reader*: a root agent's summary is the run's last word, a
            // delegated worker's is the answer it hands back. A worker told "this ends the run" has
            // a strong reason not to call it — and a worker that never calls it never returns a
            // verdict. A top-level agent auto-dispatched for a board issue (depth 0, but with an
            // assigned issue) is a worker too: `finish` returns its issue's result, not the run's.
            delegated: self.depth > 0
                || project
                    .as_ref()
                    .is_some_and(|project| project.assigned_issue.is_some()),
            fences_are_stripped: code.healing.enabled(HealingStrategy::StripFences),
        }));
        context.push_user_prompt(prompt);

        // FSM start: emit the machine's entry state and inject its guidance, so the run is driven
        // through the process from the very first turn. Only the root carries an active machine.
        let fsm_active = fsm.is_active();
        if fsm_active && let Some(state) = fsm.current_state() {
            let event = fsm_state_event(fsm.machine_name(), state.name, fsm.current_index());
            let guidance = state.guidance.clone();
            let exit = state.exit;
            emitter.emit(event);
            push_state_guidance(&mut context, guidance, exit);
        }

        let mut total_tokens = TokenCounts::default();
        let mut total_cost: Option<Cost> = None;
        // The last natural-language assistant message. It is this agent's final text on the
        // tool-calling path; in code mode every assistant message is program source, so that path
        // never reads it — see [`LoopEnd::final_text`].
        let mut last_text: Option<String> = None;
        // What this agent's last code turn produced, in gg's own words — the one line a stopped
        // code-mode agent returns to its spawner in place of a page of TypeScript. `None` until it
        // has taken a code turn, which is also the honest answer for an agent stopped before it
        // could take one.
        let mut last_report: Option<String> = None;
        // Plan mode is loop state: while `true`, the offered toolset is restricted to read-only
        // tools (plus `submit_plan`). It flips on a successful `enter_plan_mode` and back off once a
        // submitted plan has seeded the fresh implementation context. Only meaningful when planning
        // is enabled.
        let mut in_plan_mode = false;
        // This agent's error accounting against the run's ceilings. One per agent, owned outright,
        // because "consecutive" and "the last N turns" are only definable within one agent's turn
        // sequence — see [`crate::limits`].
        let mut agent_limits = AgentLimits::new(limits.limits);

        for turn in 0..max_turns {
            // Stop cleanly at a turn boundary once the run's wall-clock budget is spent. Nothing is
            // in flight here, so nothing is abandoned mid-turn.
            if let Some(breach) = limits.check_deadline(&self.id, agent_limits.turns_recorded()) {
                return self.stop_on_limit(
                    emitter,
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
                    breach,
                    turn,
                    total_tokens,
                    total_cost,
                    code.enabled,
                    last_report.as_deref(),
                    last_text,
                );
            }

            emitter.emit(GgTelemetryKind::TurnStarted {});

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

            // Refresh the pinned memory block from the store so the window reflects the
            // memories the model curated on previous turns (and Phase 2 compaction retains
            // them). Rebuilt here, at the turn boundary, so it never lands between an
            // assistant tool-call message and the tool results answering it. When memories are
            // off, or none exist, this removes the block (a no-op when there was none).
            if memories.offers_memories() {
                context.replace_source(
                    GgContextSource::Memory,
                    Retention::Pinned,
                    memories.context_block(),
                );
            }

            // Refresh the pinned task list from the store the same way, so the window always
            // shows the model's current plan (with what is ready vs blocked) and Phase 2
            // compaction retains it. Also rebuilt at the turn boundary, never between an
            // assistant tool-call message and its tool results.
            if tasks.offers_tasks() {
                context.replace_source(
                    GgContextSource::TaskList,
                    Retention::Pinned,
                    tasks.context_block(),
                );
            }

            // Refresh the pinned epic/issue board the same way, so the window always shows the
            // model's current decomposition (epics, issues, and what is ready vs blocked) and
            // compaction retains it. Also rebuilt at the turn boundary, never between an assistant
            // tool-call message and its tool results.
            if board.offers_board() {
                context.replace_source(
                    GgContextSource::Board,
                    Retention::Pinned,
                    board.context_block(),
                );
            }

            // With the pinned blocks refreshed, the window for this turn is fully assembled.
            // If the compaction backstop is on and fullness has crossed its threshold, compact
            // now — at the turn boundary, before this turn's model call, never between an
            // assistant tool-call message and its results. Compaction summarizes the ephemeral
            // history and keeps the pinned prefix verbatim, so the breakdown emitted just below
            // reflects the reclaimed window.
            if let Some(event) = compact_if_needed(
                &mut context,
                client,
                &compaction,
                RetainedCounts {
                    skills: skills.read_count() as u64,
                    tasks: tasks.count() as u64,
                    memories: memories.count() as u64,
                    issues: board.issue_count() as u64,
                },
            )
            .await
            {
                emitter.emit(event);
            }

            // Agent-managed context: rebuild the pinned, system-adjacent fullness signal from the
            // now fully-assembled (and possibly just-compacted) window, so the model sees an
            // up-to-date "how full is my window, and what is filling it" line it can act on this
            // turn. Cheap by design (one short line) and refreshed in place each turn.
            if amc.enabled {
                context.refresh_fullness_signal();
            }

            // The offered toolset for this turn — the intersection of every active restriction, so
            // what the model is shown and what it may run agree (the same predicates guard dispatch
            // below). In plan mode gg restricts it to the read-only tools (plus `submit_plan`, the way
            // out); an active FSM state restricts it to what that state allows (a read-only plan
            // state, and `advance_state` only while the current state is one the agent leaves by
            // calling it).
            // In responses-as-code mode the model is offered **no** native tool definitions — it
            // composes the tools as functions inside a program instead (the toolset is described in
            // the system prompt, and each program tool call is bridged to the real registry). In the
            // ordinary tool-calling mode the offered set is the intersection of every active
            // restriction, so what the model is shown and what it may run agree.
            let tools: Vec<ToolDefinition> = if code.enabled {
                Vec::new()
            } else {
                all_tools
                    .iter()
                    .filter(|tool| {
                        let planning_ok = !planning.offers_planning()
                            || plan_mode_offers(&tool.name, in_plan_mode);
                        planning_ok && fsm.offers(&tool.name)
                    })
                    .cloned()
                    .collect()
            };

            // The context for this turn is fully assembled (every prior item is in the
            // model). Emit its per-source breakdown when context visibility is on; the
            // accounting itself was computed regardless.
            if context_setup.emit_breakdown {
                emitter.emit(context.breakdown_event());
            }

            let response = match complete_with_vision_recovery(
                client,
                &mut context,
                &tools,
                &tool_ctx.vision.support,
                emitter,
            )
            .await
            {
                Ok(response) => response,
                Err(err) => {
                    // Surface the failure loudly — a `Log(error)` and a `model_error`
                    // session end — rather than discarding the run silently. A
                    // retry-exhausted transient failure and a fatal one both end the
                    // session here; the client has already exhausted its own retries, so
                    // there is nothing left to retry at the turn level in Phase 0.
                    let kind = if err.is_retryable_exhausted() {
                        "transient failure (retries exhausted)"
                    } else if err.is_auth_failure() {
                        "authentication failure"
                    } else {
                        "fatal error"
                    };
                    emitter.emit(log(
                        "error",
                        format!("model turn {turn} failed — {kind}: {err}"),
                    ));
                    // The turn is recorded before the loop leaves, so the accounting never drifts
                    // from the number of model calls the run made — and it can never breach a
                    // ceiling, because the session is already ending on the next line. A model API
                    // failure stays fatal on its first occurrence: the client has already retried
                    // with backoff over every retryable class, so counting this one and looping
                    // again would be a second, undocumented retry layer with a worse backoff and no
                    // jitter.
                    let _ =
                        agent_limits.record(TurnOutcome::Error(TurnErrorKind::ModelApi), &self.id);
                    let status = if err.is_auth_failure() {
                        // An auth failure is the run's credential being refused, not the model
                        // failing at its work, so it ends the session under its own status — which
                        // the session runner turns into a launch failure.
                        STATUS_AUTH_ERROR
                    } else {
                        STATUS_MODEL_ERROR
                    };
                    return LoopEnd {
                        status,
                        turns: turn + 1,
                        tokens: total_tokens,
                        cost: total_cost,
                        slot: self.slot.clone(),
                        final_text: ended_text(
                            code.enabled,
                            status,
                            last_report.as_deref(),
                            last_text,
                        ),
                        limit: None,
                    };
                }
            };

            record_usage(&response, emitter);
            total_tokens = add_counts(total_tokens, response.usage);
            total_cost = add_cost(total_cost, response.cost);
            // The same figure, folded into the run-wide total every agent's cost ceiling reads. Fed
            // here rather than at the agent's end, because a subagent forty turns deep must
            // contribute to the run's spend while it is still running.
            limits.spend.add(response.cost);

            if let Some(text) = &response.text {
                emitter.emit(GgTelemetryKind::AssistantMessage { text: text.clone() });
                last_text = Some(text.clone());
            }

            // Record the assistant turn (text + any tool calls) into the context.
            //
            // In responses-as-code mode a turn *is* a program, and the model was offered no native
            // tool definitions at all — so a `tool_calls` it emitted anyway (a reflex some models
            // bring from their tool-use training) is never dispatched and never answered. Keeping
            // it would leave an assistant `tool_calls` entry with no `tool` message following it,
            // which an OpenAI-shaped provider rejects for the whole request on every later turn. It
            // is therefore dropped from the window and named in a `warn`, so the anomaly is
            // measurable rather than invisible.
            if code.enabled && !response.tool_calls.is_empty() {
                emitter.emit(log(
                    "warn",
                    format!(
                        "the model requested {} native tool call(s) ({}) on a responses-as-code \
                         turn, which offers none; they are ignored — the turn's program is what \
                         runs.",
                        response.tool_calls.len(),
                        response
                            .tool_calls
                            .iter()
                            .map(|call| call.name.as_str())
                            .collect::<Vec<_>>()
                            .join(", "),
                    ),
                ));
            }
            // Log this turn's exact request and response to the message log — the
            // de-duplicated ContextMessage/Prompt stream the console renders as the
            // per-message Requests view — when context visibility is on. Captured here,
            // *before* the assistant reply is appended, so `prompt_items` is exactly the
            // window that was sent this turn (post vision-recovery, if any). The reply is
            // built the same way `push_assistant` will record it (no native tool calls in
            // responses-as-code mode) and pooled too, so it reappears — id unchanged — as a
            // request pointer on the next turn.
            if context_setup.log_messages {
                let reply = Message::assistant(
                    response.text.clone(),
                    if code.enabled {
                        Vec::new()
                    } else {
                        response.tool_calls.clone()
                    },
                );
                let reply_tokens = context.estimate(&reply);
                let has_reply = reply.content.is_some() || !reply.tool_calls.is_empty();
                let request: Vec<(GgContextSource, &Message, usize)> =
                    context.prompt_items().collect();
                emitter.log_prompt(
                    &request,
                    has_reply.then_some((&reply, reply_tokens)),
                    response.usage,
                    response.cost,
                    finish_reason_token(&response.finish_reason),
                );
            }

            context.push_assistant(
                response.text.clone(),
                if code.enabled {
                    Vec::new()
                } else {
                    response.tool_calls.clone()
                },
            );

            // Responses-as-code turn: the model was offered no native tools, so its **whole reply**
            // is a TypeScript program. Heal it, run it in the wasmtime sandbox — bridging every
            // typed call to the real toolset (and, for a delegation tool, the scheduler) — and act
            // on what the turn asks for. There is no implicit ending here: a session under this
            // capability ends only when a program calls `finish`, or when a ceiling stops the run.
            if code.enabled {
                let turn_ctx = CodeTurn {
                    spawner: self,
                    registry,
                    tool_ctx,
                    board: &board,
                    project: project.as_ref(),
                    memories: &memories,
                    tasks: &tasks,
                    planning: &planning,
                    fsm: &fsm,
                    amc: &amc,
                    emitter,
                    replay: replay.as_ref(),
                    fsm_active,
                    in_plan_mode,
                    code_reviews_active,
                    speculative_active,
                };
                let decision = run_code_turn(
                    response.text.as_deref().unwrap_or_default(),
                    !response.tool_calls.is_empty(),
                    &code,
                    limits.deadline,
                    &turn_ctx,
                    &mut context,
                    &mut skills,
                    &mut subagents,
                )
                .await;
                // Every code turn is recorded, including the one that finishes and the one that
                // ends fatally, so the rate window is fed uniformly and the accounting cannot drift
                // from the number of model calls made. Neither of those two ever breaches.
                let breach = agent_limits.record(decision.turn_outcome(), &self.id);
                match decision {
                    CodeTurnOutcome::Finished { summary } => {
                        return LoopEnd {
                            status: STATUS_COMPLETED,
                            turns: turn + 1,
                            tokens: total_tokens,
                            cost: total_cost,
                            slot: self.slot.clone(),
                            final_text: Some(summary),
                            limit: None,
                        };
                    }
                    CodeTurnOutcome::Fatal { message, .. } => {
                        emitter.emit(log("error", message));
                        return LoopEnd {
                            status: STATUS_MODEL_ERROR,
                            turns: turn + 1,
                            tokens: total_tokens,
                            cost: total_cost,
                            slot: self.slot.clone(),
                            final_text: ended_text(
                                true,
                                STATUS_MODEL_ERROR,
                                last_report.as_deref(),
                                last_text,
                            ),
                            limit: None,
                        };
                    }
                    CodeTurnOutcome::Continue {
                        feedback,
                        images,
                        report,
                        ..
                    } => {
                        last_report = Some(report);
                        // The turn's feedback is pushed **before** the breach return, so a stopped
                        // run's context still contains everything the turn produced. The program's
                        // pictures ride on it, which is what restores vision inside a program: a
                        // `readFile` of a reference mockup shows the model the picture, exactly as
                        // the native path does.
                        context.push(
                            GgContextSource::ToolOutput,
                            Retention::Ephemeral,
                            Message::user(feedback).with_images(images),
                        );
                        if let Some(breach) = breach {
                            return self.stop_on_limit(
                                emitter,
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
                }
            }

            // The **tool-calling** mode's termination rule, untouched: a turn that requested no
            // tools is the model saying it is done. It is reached only when the code branch above
            // did not run, and the responses-as-code protocol has no equivalent — every reply there
            // is a program, so there is no shape of reply that could mean "finished".
            if response.tool_calls.is_empty() {
                let _ = agent_limits.record(TurnOutcome::Finished, &self.id);
                return LoopEnd {
                    status: STATUS_COMPLETED,
                    turns: turn + 1,
                    tokens: total_tokens,
                    cost: total_cost,
                    slot: self.slot.clone(),
                    final_text: last_text,
                    limit: None,
                };
            }

            // A plan submitted this turn, captured during dispatch and applied once the turn's tool
            // results are all recorded (so the conversation stays valid before the context is reset).
            let mut submitted_plan: Option<String> = None;

            // Dispatch each requested tool call against the workspace and feed the result
            // back so the model can proceed on its next turn.
            for call in &response.tool_calls {
                emitter.emit(GgTelemetryKind::ToolCall {
                    name: call.name.clone(),
                    args: call.arguments.clone(),
                });

                // In plan mode the loop is read-only, and an active FSM state may restrict the toolset
                // further: a tool either filter withheld is refused here too (a defensive guard — the
                // model was not offered it) rather than dispatched. `advance_state` and the subagent
                // tools are intercepted here (never routed through `registry.dispatch`, whose
                // registered validators are defensive placeholders): the loop drives the state machine
                // / the scheduler / the agent tree, which the tools cannot reach.
                let mut outcome =
                    if planning.offers_planning() && !plan_mode_offers(&call.name, in_plan_mode) {
                        ToolOutcome::failed(
                            ToolFailure::Refused,
                            plan_mode_refusal(&call.name, in_plan_mode),
                        )
                    } else if fsm_active && !fsm.offers(&call.name) {
                        // The FSM's current state withholds this tool this turn (a read-only plan state,
                        // or a tool that is not the state's exit) — refuse it with guidance.
                        ToolOutcome::failed(ToolFailure::Refused, fsm_refusal(&call.name, &fsm))
                    } else if fsm_active && is_fsm_tool(&call.name) {
                        // Drive the state machine: check the current state's transition guard, move on
                        // when it holds (and — for `review-gated` — run the Code Review that gates the
                        // move), and refuse the advance otherwise so the agent cannot skip ahead. A
                        // `plan-first` plan reset is captured here and applied after the turn's tool
                        // results are recorded, exactly like `submit_plan`.
                        let advance = handle_advance_state(
                            &mut fsm,
                            &mut context,
                            subagents.as_mut(),
                            self,
                            tool_ctx,
                            emitter,
                            call,
                        )
                        .await;
                        if let Some(plan) = advance.submit_plan {
                            submitted_plan = Some(plan);
                        }
                        advance.outcome
                    } else if let Some(project) = project
                        .as_ref()
                        .filter(|_| call.name == WAIT_FOR_ISSUE_TOOL)
                    {
                        // Project management: `wait_for_issue` suspends this agent until the named
                        // board issue reaches a terminal state. Intercepted here (like the
                        // delegation tools) because it must free this agent's scheduler slot and
                        // block on the orchestrator's issue-wait registry, which the tool cannot
                        // reach.
                        handle_wait_for_issue(project, self, &board, emitter, call).await
                    } else if let Some(sub) = subagents.as_mut() {
                        if is_subagent_tool(&call.name) {
                            handle_subagent_call(sub, self, emitter, call).await
                        } else if speculative_active && call.name == SPECULATE_TOOL {
                            // Speculative execution: `speculate` is intercepted here (like the
                            // delegation tools) so gg runs the best-of-K fan-out → judge → merge
                            // routine against the orchestrator, scheduler, and worktree machinery,
                            // which the tool itself cannot reach.
                            handle_speculate(sub, self, &board, emitter, call).await
                        } else if code_reviews_active
                            && call.name == COMPLETE_ISSUE_TOOL
                            && board.offers_board()
                        {
                            // Code Reviews gate acceptance: `complete_issue` is intercepted here (like
                            // the delegation tools) so that instead of marking the issue done
                            // immediately, gg runs a Code Review — dispatching a reviewer subagent and
                            // fix agents against the orchestrator, which the tool itself cannot reach —
                            // and only accepts the issue once the review approves.
                            handle_code_review(sub, self, &board, emitter, call).await
                        } else {
                            registry.dispatch(call, tool_ctx).await
                        }
                    } else {
                        registry.dispatch(call, tool_ctx).await
                    };

                // Agent-managed context: `evict_file_view`/`archive_thread` act on the live
                // window, which the tools cannot hold — the tool only validated the args, so the
                // loop performs the reclaim against the context model here, rewrites the tool
                // result with what was actually reclaimed, and emits the `ContextManaged` effect
                // (the tool `ToolCall`/`ToolResult` still stream too). `search_archive` needs no
                // special handling — it read the shared archive in its own `invoke`.
                let managed_event =
                    if amc.enabled && outcome.ok && is_context_reclaim_tool(&call.name) {
                        apply_context_reclaim(&mut context, &amc.archive, call, &mut outcome)
                    } else {
                        None
                    };

                emitter.emit(GgTelemetryKind::ToolResult {
                    name: call.name.clone(),
                    ok: outcome.ok,
                    summary: outcome.summary.clone(),
                });
                if let Some(event) = managed_event {
                    emitter.emit(event);
                }

                // Replay capture: this is the one point every dispatched tool call funnels through
                // with its final outcome (after any agent-managed-context reclaim rewrote it), so
                // recording here pins ordinary registry dispatch and the intercepted
                // delegation/speculate/review/advance tools alike — a decorator at the choke point,
                // not a call scattered per tool. Recorded before the outcome is moved into the
                // context.
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

                // Planning transitions: like the agent-managed-context reclaim, the tool only
                // validated the call — the loop owns plan mode and the context window, so it applies
                // the effect here (after recording the tool result keeps the conversation valid).
                let planning_ok = outcome.ok;
                record_tool_result(
                    &mut context,
                    &mut skills,
                    &memories,
                    &tasks,
                    &board,
                    call,
                    outcome,
                    emitter,
                );
                if planning.offers_planning() && planning_ok && is_planning_tool(&call.name) {
                    match call.name.as_str() {
                        ENTER_PLAN_MODE_TOOL => {
                            // Enter read-only mode and inject the plan-mode guidance as an ephemeral
                            // item (dropped when the plan is submitted and the context is cleared).
                            in_plan_mode = true;
                            context.push(
                                GgContextSource::Plan,
                                Retention::Ephemeral,
                                crate::model::Message::user(planning.plan_mode_guidance()),
                            );
                            emitter.emit(GgTelemetryKind::Planning {
                                phase: GgPlanPhase::Entered,
                                plan: None,
                            });
                        }
                        SUBMIT_PLAN_TOOL => {
                            // Capture the plan; the reset is applied after the turn's tool results
                            // are all recorded.
                            let plan = call
                                .arguments
                                .get("plan")
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                .trim()
                                .to_string();
                            emitter.emit(GgTelemetryKind::Planning {
                                phase: GgPlanPhase::Submitted,
                                plan: Some(plan.clone()),
                            });
                            submitted_plan = Some(plan);
                        }
                        // `is_planning_tool` admits only the two arms above.
                        _ => {}
                    }
                }
            }

            // A plan was submitted this turn — either via `submit_plan` (the planning capability) or
            // an `advance_state` out of a `plan-first` FSM plan state (both defer here). Clear the
            // exploration history (keeping the pinned prefix — system, original prompt, skills,
            // memories, tasks, board, and any pinned FSM guidance) via the shared context-reset
            // primitive, seed the fresh implementation context with the framed plan as a pinned item,
            // leave plan mode, and restore the full toolset for the next turn. The plan is framed by
            // the FSM's own planner when a machine drives the run (so a `plan-first` machine reuses
            // the planning flow even with the standalone planning capability off), else by the
            // planning runtime.
            if let Some(plan) = submitted_plan {
                in_plan_mode = false;
                context.clear_ephemeral();
                let framed = match fsm.planner() {
                    Some(planner) => planner.frame_plan(&plan),
                    None => planning.frame_plan(&plan),
                };
                context.push(
                    GgContextSource::Plan,
                    Retention::Pinned,
                    crate::model::Message::user(framed),
                );
                emitter.emit(GgTelemetryKind::Planning {
                    phase: GgPlanPhase::Implementing,
                    plan: Some(plan),
                });
            }

            // The tool-calling turn is done: every requested call was dispatched and answered, and
            // every state transition the turn asked for has been applied. Recorded **last** for
            // exactly that reason — a stop must not land between a plan submission and the context
            // reset that completes it — and recorded at all because a `Progressed` turn can be the
            // one that first *fills* the error-rate window, and a window that becomes judgeable at
            // three errors in four must breach then rather than waiting for a fourth failure.
            if let Some(breach) = agent_limits.record(TurnOutcome::Progressed, &self.id) {
                return self.stop_on_limit(
                    emitter,
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
        // answer rather than one per status.
        let breach = GgLimitBreach {
            limit: GgLimitKind::Turns,
            threshold: max_turns as f64,
            observed: max_turns as f64,
            turns: agent_limits.turns_recorded(),
            agent_id: self.id.clone(),
            window: None,
        };
        self.stop_on_limit(
            emitter,
            breach,
            max_turns,
            total_tokens,
            total_cost,
            code.enabled,
            last_report.as_deref(),
            last_text,
        )
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
    #[allow(clippy::too_many_arguments)]
    fn stop_on_limit(
        &self,
        emitter: &Emitter,
        breach: GgLimitBreach,
        turns: usize,
        tokens: TokenCounts,
        cost: Option<Cost>,
        code_mode: bool,
        last_report: Option<&str>,
        last_text: Option<String>,
    ) -> LoopEnd {
        let status = status_for_breach(breach.limit);
        emitter.emit(log("warn", breach_message(&breach)));
        emitter.emit(GgTelemetryKind::LimitExceeded {
            breach: breach.clone(),
        });
        LoopEnd {
            status,
            turns,
            tokens,
            cost,
            slot: self.slot.clone(),
            final_text: ended_text(code_mode, status, last_report, last_text),
            limit: Some(breach),
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

/// This agent's [return value](LoopEnd::final_text) for a loop ending the model did **not** choose.
///
/// The two execution modes answer it differently, and the difference is the whole of
/// [`stopped_text`]'s reason for existing. In tool calling the last assistant message is a sentence,
/// and it has always been what a stopped agent hands back. Under
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) it is a page of TypeScript.
fn ended_text(
    code_mode: bool,
    status: &str,
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
/// Every assistant message on that path is a TypeScript program, so the loop's `last_text` would
/// hand a subagent's spawner — and the run record, and a speculation judge's brief — a page of
/// source instead of an answer. This is the answer gg can honestly give instead: how the agent
/// ended, and what its last turn actually produced.
fn stopped_text(status: &str, report: Option<&str>) -> Option<String> {
    Some(match report {
        Some(report) => format!("(agent ended: {status}; {report})"),
        None => format!("(agent ended: {status}; it produced no program)"),
    })
}

/// The resolved [ceilings](RunLimits) as the run **records** them on its session summary.
///
/// The turn ceiling is written out even when it came from
/// [`DEFAULT_MAX_TURNS`](crate::limits::DEFAULT_MAX_TURNS), because that is
/// exactly what makes a default honest: "what ceiling was this run under?" has to be answerable from
/// the record, and a default that is recorded is not a hidden one. Everything else is `None` when
/// the ceiling is off, which is the same thing the declaration said.
fn recorded_limits(limits: &RunLimits) -> GgRunLimits {
    GgRunLimits {
        max_turns: Some(limits.max_turns as u64),
        max_runtime_secs: limits.max_runtime.map(|budget| budget.as_secs()),
        max_consecutive_errors: limits.max_consecutive_errors.map(u64::from),
        max_error_rate: limits.error_rate.map(|rate| rate.max_rate),
        error_rate_window: limits.error_rate.map(|rate| rate.window as u64),
        max_cost: limits.max_cost,
    }
}

/// The context-accounting configuration threaded into the [turn loop](Agent::drive): the
/// [token estimator](TokenEstimator), the active model's window limit, and whether to
/// emit the per-turn [`ContextBreakdown`](GgTelemetryKind::ContextBreakdown).
struct ContextSetup {
    /// The estimator every context item is measured with. Shared (`Arc`) so it can back
    /// the async loop and, in later phases, spawned subagents.
    estimator: Arc<dyn TokenEstimator>,
    /// The active model's context-window limit in tokens, when known — the fullness
    /// denominator.
    window_limit: Option<u64>,
    /// Whether to emit the per-turn context breakdown. Gated on the context-visibility
    /// capability; the accounting itself is computed regardless.
    emit_breakdown: bool,
    /// Whether to log each turn's exact request/response to the
    /// [message log](crate::message_log) — the de-duplicated
    /// [`ContextMessage`](GgTelemetryKind::ContextMessage)/[`Prompt`](GgTelemetryKind::Prompt)
    /// stream the console renders as the per-message Requests view. Gated on the same
    /// context-visibility capability as the breakdown (the message log is its itemized form).
    log_messages: bool,
}

/// The agent-managed-context configuration threaded into the [turn loop](Agent::drive): whether the
/// capability is on and the shared thread [archive](ArchiveStore) that `archive_thread` fills
/// and `search_archive` reads.
struct AmcSetup {
    /// Whether the [agent-managed-context](CAPABILITY_AGENT_MANAGED_CONTEXT) capability is on.
    /// When on the loop injects the per-turn fullness signal and applies the reclaim tools;
    /// off, it does neither (and the tools were never offered).
    enabled: bool,
    /// The shared thread archive the reclaim applies to. Bound to the same store the
    /// `search_archive` tool reads, so archived material is immediately searchable.
    archive: Arc<Mutex<ArchiveStore>>,
}

/// How a run conducts its turns when [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) is on: the
/// run-wide mode flag, the per-program [sandbox ceilings](SandboxLimits), and which
/// [healing](crate::healing) strategies are armed.
///
/// Resolved once on the [orchestrator](Orchestrator) and handed to every agent, because all three
/// are properties of *how a turn is conducted*, not of one agent — and grouped into one struct
/// because a loop that took them separately would let two of them disagree at a call site.
#[derive(Debug, Clone, Copy)]
struct CodeSetup {
    /// Whether the capability is on. When off, nothing in [`crate::sandbox`] or
    /// [`crate::healing`] is reachable at all and the loop drives ordinary tool calling.
    enabled: bool,
    /// The wasmtime fuel ceiling and linear-memory cap one program runs under, resolved from the
    /// capability's `fuel` / `maxMemoryBytes` params with measured defaults.
    limits: SandboxLimits,
    /// The [healing](crate::healing) strategies armed for this run — the ablation lever that decides
    /// which malformations of a reply gg repairs before compiling it, and which it lets fail.
    healing: HealingConfig,
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
}

impl LimitsSetup {
    /// The [breach](GgLimitBreach) to stop `agent_id` on if the run has already spent its
    /// [cost ceiling](RunLimits::max_cost) — the turn-boundary check, on exactly the same terms as
    /// the deadline check beside it.
    fn check_cost(&self, agent_id: &str, turns: u64) -> Option<GgLimitBreach> {
        self.limits.check_cost(&self.spend, agent_id, turns)
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

/// Apply an agent-managed-context reclaim tool (`evict_file_view` or `archive_thread`) to the
/// live `context`: perform the reclaim, rewrite `outcome` with what was reclaimed (the tool's
/// own `invoke` only validated the arguments), and return the
/// [`ContextManaged`](GgTelemetryKind::ContextManaged) effect event to emit.
///
/// The rewrite carries a [`ToolData::Reclaim`] sidecar as well as the prose, because this is the
/// **only** producer of one: the two reclaim tools return an outcome with no data at all, so a
/// [code program](crate::sandbox)'s `evictFileView` would otherwise be handed nothing to compute
/// with. The numbers and the sentence come from the same locals, so they cannot disagree.
///
/// The reclaim runs **here**, in the loop, because it mutates the context window the tools
/// cannot hold. `search_archive` is not routed through this — it read the shared archive in its
/// own `invoke`. The arguments were already validated by the tool, so the shared parsers are
/// re-run with their defaults on the (unreachable) error path rather than failing.
fn apply_context_reclaim(
    context: &mut ContextModel,
    archive: &Arc<Mutex<ArchiveStore>>,
    call: &ToolCall,
    outcome: &mut ToolOutcome,
) -> Option<GgTelemetryKind> {
    match call.name.as_str() {
        EVICT_FILE_VIEW_TOOL => {
            let path = parse_evict_path(&call.arguments).unwrap_or(None);
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
            .with_data(ToolData::Reclaim(ReclaimData {
                items: saturating_u32(result.items),
                // The reclaim's own counters are `u64`; the sidecar is declared in the `u32` its
                // structured consumers use, and saturates rather than wrapping a preposterous
                // figure into a small plausible one.
                reclaimed_tokens: u32::try_from(result.tokens).unwrap_or(u32::MAX),
                paths: result.paths.clone(),
                detail: detail.clone(),
            }));
            Some(GgTelemetryKind::ContextManaged {
                action: GgContextAction::EvictFileViews,
                reclaimed_tokens: result.tokens,
                items: result.items as u64,
                detail,
            })
        }
        ARCHIVE_THREAD_TOOL => {
            let keep =
                parse_archive_keep_recent(&call.arguments).unwrap_or(DEFAULT_ARCHIVE_KEEP_RECENT);
            let result = context.archive_thread(keep);
            let count = result.items.len();
            let archive_total = {
                let mut store = archive.lock().expect("archive store lock");
                store.archive(result.items.iter().map(|item| (item.source, &item.message)));
                store.len()
            };
            let detail = if count == 0 {
                "No older thread history to archive — the recent turns are kept live.".to_string()
            } else {
                format!(
                    "Archived {count} older thread item(s), reclaiming ~{} tokens. They are out \
                     of your window but still searchable with search_archive (the archive now \
                     holds {archive_total} item(s)).",
                    result.tokens
                )
            };
            *outcome = ToolOutcome::ok(detail.clone(), format!("archived {count} thread item(s)"))
                .with_data(ToolData::Reclaim(ReclaimData {
                    items: saturating_u32(count),
                    reclaimed_tokens: u32::try_from(result.tokens).unwrap_or(u32::MAX),
                    // A thread archival frees whole conversation items, not file views, so it has
                    // no paths to name. An empty list here is a fact, not a gap.
                    paths: Vec::new(),
                    detail: detail.clone(),
                }));
            Some(GgTelemetryKind::ContextManaged {
                action: GgContextAction::ArchiveThread,
                reclaimed_tokens: result.tokens,
                items: count as u64,
                detail,
            })
        }
        // Not a reclaim tool (the caller gates this to `is_context_reclaim_tool`), so nothing
        // to apply.
        _ => None,
    }
}

/// Resolve the context window the active model's fullness ratio is measured against, in two
/// steps:
///
/// 1. **The model's window**, from `windows` — the model catalog's figure for each bound
///    model, [pushed in with the invocation](GgInvocation::model_windows) — **narrowed** by
///    an explicit [`PARAM_WINDOW_LIMIT`] override. The override may only make the window
///    *smaller*: the model's real window is a hard limit, so a larger "override" is not a
///    configuration gg can honor — it is clamped rather than rejected, so a study that
///    raises a window it misjudged still runs.
/// 2. **The working window**, [reduced by the summary headroom](crate::compaction::working_window)
///    when compaction is on, reserving room for the summarization call itself.
///
/// Returns `None` when `windows` carries no figure for `model_id`. **There is no fallback**:
/// gg keeps no model table of its own and will not guess a window from a model id, because a
/// guessed denominator silently mis-scales every fullness figure, the compaction trigger, and
/// the agent's own fullness signal. A run whose window cannot be resolved must not start —
/// [`validate_model_windows`] refuses it at launch, so this `None` is unreachable once a
/// session is running.
fn resolve_window_limit(
    set: &GgCapabilitySet,
    windows: &BTreeMap<String, u64>,
    model_id: &str,
) -> Option<u64> {
    let model_window = windows.get(model_id).copied()?;
    // The override lives on context-visibility by convention, but it governs compaction and the
    // fullness signal too — so it is honored on any capability that carries it rather than being
    // silently ignored when visibility is ablated off. It is the last param read this way: the run's
    // execution ceilings moved to `capabilitySet.limits`, where they are declared once and recorded
    // on the run, and this one stays here because it is genuinely a property of one capability's
    // configuration rather than of the run.
    let configured = set
        .capabilities
        .iter()
        .find_map(|capability| {
            capability
                .params
                .get(PARAM_WINDOW_LIMIT)
                .and_then(Value::as_u64)
        })
        .filter(|&n| n > 0)
        .map_or(model_window, |limit| limit.min(model_window));
    Some(compaction::working_window(set, configured))
}

/// Check that every model `set` binds has a [context window](GgInvocation::model_windows) —
/// the launch check that makes gg's lack of a fallback safe.
///
/// The window is the denominator of every fullness figure, the basis of the
/// [compaction](crate::compaction) trigger, and part of the fullness signal the agent itself
/// reads. Running without it would mean inventing one, so a session that cannot measure its
/// own window does not start: the run fails loudly here rather than producing a run whose
/// context accounting is quietly wrong.
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

/// Build the run's [`SkillsRuntime`] from the capability set and workspace: when the
/// [`skills`](CAPABILITY_SKILLS) capability is enabled, load the library from the resolved
/// [skills directory](resolve_skills_dir); otherwise the runtime is
/// [disabled](SkillsRuntime::disabled) (an ablation's off arm) and offers nothing.
fn resolve_skills(set: &GgCapabilitySet, workspace_dir: &Path) -> SkillsRuntime {
    if !set.is_enabled(CAPABILITY_SKILLS) {
        return SkillsRuntime::disabled();
    }
    let dir = resolve_skills_dir(set, workspace_dir);
    SkillsRuntime::new(Arc::new(SkillLibrary::load(&dir)))
}

/// Resolve the directory skills are loaded from: the skills capability's
/// [`dir`](PARAM_SKILLS_DIR) param when set (relative to the workspace, or absolute as
/// given), else [`DEFAULT_SKILLS_DIR`] under the workspace.
fn resolve_skills_dir(set: &GgCapabilitySet, workspace_dir: &Path) -> PathBuf {
    let configured = set
        .capability(CAPABILITY_SKILLS)
        .and_then(|cap| cap.params.get(PARAM_SKILLS_DIR))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|dir| !dir.is_empty())
        .unwrap_or(DEFAULT_SKILLS_DIR);
    let path = Path::new(configured);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        workspace_dir.join(path)
    }
}

/// Build the run's [`MemoriesRuntime`] from the capability set: when the
/// [`memories`](CAPABILITY_MEMORIES) capability is enabled, an enabled runtime with an
/// empty store bounded by the [caps resolved](MemoryCaps::resolve) from the capability's
/// params; otherwise a [disabled](MemoriesRuntime::disabled) runtime (an ablation's off
/// arm) that offers nothing.
fn resolve_memories(set: &GgCapabilitySet) -> MemoriesRuntime {
    if !set.is_enabled(CAPABILITY_MEMORIES) {
        return MemoriesRuntime::disabled();
    }
    let caps = set
        .capability(CAPABILITY_MEMORIES)
        .map(|cap| MemoryCaps::resolve(&cap.params))
        .unwrap_or_default();
    MemoriesRuntime::new(caps)
}

/// Build the run's [`TasksRuntime`] from the capability set: when the
/// [`tasks`](CAPABILITY_TASKS) capability is enabled, an enabled runtime with an empty task
/// DAG holding at most the [count resolved](resolve_max_tasks) from the capability's params;
/// otherwise a [disabled](TasksRuntime::disabled) runtime (an ablation's off arm) that
/// offers nothing.
fn resolve_tasks(set: &GgCapabilitySet) -> TasksRuntime {
    if !set.is_enabled(CAPABILITY_TASKS) {
        return TasksRuntime::disabled();
    }
    let params = set.capability(CAPABILITY_TASKS).map(|cap| &cap.params);
    let max_tasks = params
        .map(resolve_max_tasks)
        .unwrap_or(crate::tasks::DEFAULT_MAX_TASKS);
    let mode = params.map(resolve_task_mode).unwrap_or_default();
    TasksRuntime::with_mode(max_tasks, mode)
}

/// Build the run's [`BoardRuntime`] from the capability set: when the
/// [`project-management`](CAPABILITY_PROJECT_MANAGEMENT) capability is enabled, an enabled runtime with
/// an empty board bounded by the [caps resolved](BoardCaps::resolve) from the capability's
/// params; otherwise a [disabled](BoardRuntime::disabled) runtime (an ablation's off arm) that
/// offers nothing.
fn resolve_board(set: &GgCapabilitySet) -> BoardRuntime {
    if !set.is_enabled(CAPABILITY_PROJECT_MANAGEMENT) {
        return BoardRuntime::disabled();
    }
    let caps = set
        .capability(CAPABILITY_PROJECT_MANAGEMENT)
        .map(|cap| BoardCaps::resolve(&cap.params))
        .unwrap_or_default();
    BoardRuntime::new(caps)
}

/// Resolve the run's git-backed [isolation and baseline](WorktreesSetup) at session start, reporting
/// on `emitter`.
///
/// A git **baseline** is committed whenever either the [worktrees](CAPABILITY_WORKTREES) capability
/// (every worktree branches from it) or the [code-reviews](CAPABILITY_CODE_REVIEWS) capability (a
/// Code Review diffs the work against it) is on. On top of that, the [worktree
/// root](worktrees_root_for) is created **only** when worktrees is on. When neither capability wants
/// git, isolation is inert (no baseline, no root).
///
/// Any problem — git absent, a failed baseline, or an uncreatable worktree root — is logged
/// **loudly** at error level and leaves the affected feature unusable (a later `worktree: true`
/// spawn is refused; a Code Review runs against an empty diff) rather than crashing the run; a
/// committed baseline is still recorded even if the worktree root could not be created, so Code
/// Reviews can still reuse it. The [`capability`](WorktreesSetup::capability) field always reflects
/// the **worktrees** capability specifically (it gates the `worktree` spawn option), independent of
/// whether the baseline was committed for code-reviews.
fn resolve_worktrees(
    set: &GgCapabilitySet,
    workspace_dir: &Path,
    emitter: &Emitter,
) -> WorktreesSetup {
    let worktrees = set.is_enabled(CAPABILITY_WORKTREES);
    // A baseline is needed for a Code Review to diff against — whether triggered by the
    // `code-reviews` capability (per-issue) or by the `review-gated` FSM's `review` state (the whole
    // run's diff).
    let code_reviews = set.is_enabled(CAPABILITY_CODE_REVIEWS)
        || configured_machine(set) == Some(MACHINE_REVIEW_GATED);
    // A short, accurate description of why git is needed, for the diagnostics.
    let reason = match (worktrees, code_reviews) {
        (true, true) => "the `worktrees` capability is enabled and a Code Review may run",
        (true, false) => "the `worktrees` capability is enabled",
        (false, true) => "a Code Review may run (the `code-reviews` or `review-gated` capability)",
        (false, false) => "",
    };
    if !worktrees && !code_reviews {
        return WorktreesSetup {
            capability: false,
            baseline_commit: None,
            root: None,
        };
    }

    if !git::git_available() {
        emitter.emit(log(
            "error",
            format!(
                "{reason} but the `git` binary is not available; a workspace baseline could not be \
                 committed, so worktree isolation is disabled (any `worktree: true` spawn is \
                 refused) and Code Reviews run against an empty diff. (The rest of the run is \
                 unaffected.)"
            ),
        ));
        return WorktreesSetup {
            capability: worktrees,
            baseline_commit: None,
            root: None,
        };
    }

    let baseline = match git::ensure_baseline(workspace_dir) {
        Ok(sha) => sha,
        Err(err) => {
            emitter.emit(log(
                "error",
                format!(
                    "{reason} but git could not initialize a baseline of the workspace: {err}; \
                     worktree isolation is disabled and Code Reviews run against an empty diff."
                ),
            ));
            return WorktreesSetup {
                capability: worktrees,
                baseline_commit: None,
                root: None,
            };
        }
    };

    // The worktree checkout root is only needed by the worktrees capability. Code-reviews-only runs
    // keep the baseline but need no root.
    let root = if worktrees {
        let root = worktrees_root_for(workspace_dir);
        match std::fs::create_dir_all(&root) {
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
                // Keep the baseline: Code Reviews can still diff against it even though no worktree
                // can be made.
                None
            }
        }
    } else {
        None
    };

    emitter.emit(log(
        "info",
        format!(
            "committed the seeded workspace as the baseline `{}`{}. {}",
            short_sha(&baseline),
            if code_reviews {
                " (Code Reviews diff issue work against it)"
            } else {
                ""
            },
            if worktrees {
                "A subagent dispatched with `worktree: true` runs in an isolated copy that is \
                 merged back into the main tree on clean completion (or discarded otherwise)."
            } else {
                "Marking an issue done triggers a Code Review against this baseline before it is \
                 accepted."
            },
        ),
    ));
    WorktreesSetup {
        capability: worktrees,
        baseline_commit: Some(baseline),
        root,
    }
}

/// The directory per-agent [worktree](Worktree) checkouts are created under: a sibling of the
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
    /// The epic/issue board capability, for its ceilings.
    board: &'a BoardRuntime,
    /// The planning capability.
    planning: &'a PlanningRuntime,
    /// The FSM driving the run, when one does.
    fsm: &'a FsmRuntime,
    /// How much of a file one `read_file` call returns, so a capped run says so up front.
    read_policy: ReadPolicy,
    /// This agent's model and the run's vision registry, so the prompt can state whether a
    /// reference image can actually be shown to it.
    vision: &'a VisionContext,
    /// Whether Code Reviews gate issue acceptance this run.
    code_reviews: bool,
    /// Whether `speculate` is available this run.
    speculative: bool,
    /// Whether the run responds with programs rather than native tool calls.
    responses_as_code: bool,
    /// Whether the agent this prompt is for is a **delegated** worker rather than the run's root,
    /// which decides what the ending section says `finish` ends: the run, or this worker's task.
    delegated: bool,
    /// Whether [healing](crate::healing)'s fence-stripping strategy is armed, which decides how the
    /// prompt states the no-code-fence rule — as a repair gg will make and disclose, or as a syntax
    /// error the model will be handed.
    fences_are_stripped: bool,
}

/// The system prompt for a run: the [`system.hbs`](crate::prompts) template rendered against the
/// run's actual configuration.
///
/// Every capability section is gated on that capability being enabled, so the prompt describes
/// exactly what this run can do — the tools it offers (and, when it offers none, that the model
/// can only reply in text), the catalog of available [skills](crate::skills), and how to use the
/// [memories](crate::memories), [tasks](crate::tasks), [board](crate::board), and
/// [planning](crate::planning) capabilities, each stating that run's configured limits. A
/// disabled capability contributes nothing at all: no tools, no prose, no context.
fn system_prompt(inputs: PromptInputs<'_>) -> String {
    let PromptInputs {
        registry,
        skills,
        memories,
        tasks,
        board,
        planning,
        fsm,
        read_policy,
        vision,
        code_reviews,
        speculative,
        responses_as_code,
        delegated,
        fences_are_stripped,
    } = inputs;

    // The code-mode surface, reflected out of the sandbox SDK's own emitted declarations and
    // filtered to exactly the tools this run binds into a program's scope — so the prompt can
    // never describe a signature the sandbox does not have, and a withheld capability contributes
    // no signature, no helper and no type declaration.
    let views = sandbox::prompt_views(&scope_tools(registry));
    let signatures: BTreeMap<&str, &ToolView> = views
        .tools
        .iter()
        .map(|view| (view.name.as_str(), view))
        .collect();
    // One view per **offered** tool, in registry order: the tool-calling arm lists every name
    // (which is what keeps `enter_plan_mode` visible to a run with planning on), while the code arm
    // renders signatures and skips the entries that have none — precisely the turn-level
    // transitions, which it names separately as things a program cannot call.
    let tools: Vec<ToolView> = registry
        .definitions()
        .into_iter()
        .map(|def| {
            let bound = signatures.get(def.name.as_str());
            ToolView {
                signature: bound.map(|view| view.signature.clone()).unwrap_or_default(),
                doc: bound.map(|view| view.doc.clone()).unwrap_or_default(),
                name: def.name,
            }
        })
        .collect();
    let turn_level_tools: Vec<String> = TURN_LEVEL_TOOLS
        .iter()
        .filter(|name| registry.offers(name))
        .map(|name| (*name).to_string())
        .collect();
    // The read cap is only worth stating when `read_file` is actually offered and actually
    // capped; an unlimited (or withheld) read contributes no prompt text. Whether the model
    // can be shown an image is stated whenever `read_file` is offered at all — a text-only
    // model that is not told so spends turns re-reading a mockup it will never see.
    let offers_read = registry.offers(READ_FILE_TOOL);
    let read_file = ReadFileView {
        offered: offers_read,
        capped: offers_read && read_policy.line_cap().is_some(),
        hard_cap: matches!(read_policy, ReadPolicy::HardCap(_)),
        line_cap: read_policy.line_cap().unwrap_or_default(),
        images: offers_read && !vision.declared_text_only(),
    };

    prompts::render_system(&SystemContext {
        tools,
        responses_as_code,
        // How a program ends the run, shown to every code-mode run whatever it enables — the one
        // entry here that is not a projection of the enabled set, because no capability offers it
        // and no ablation withholds it. A tool-calling run is told `None`, and its ending rule is
        // the untouched "stop calling tools" one.
        session: responses_as_code.then_some(views.session),
        delegated,
        fences_are_stripped,
        code: views.teaching,
        types: views.types,
        helpers: views.helpers,
        turn_level_tools,
        read_file,
        skills: skills.prompt_entries(),
        memories: memories.offers_memories().then(|| {
            let caps = memories.caps();
            MemoriesView {
                max_count: caps.max_count,
                max_len_per_memory: caps.max_len_per_memory,
                max_total_len: caps.max_total_len,
            }
        }),
        tasks: tasks.offers_tasks().then(|| TasksView {
            max_tasks: tasks.max_tasks(),
        }),
        board: board.offers_board().then(|| {
            let caps = board.caps();
            BoardView {
                max_epics: caps.max_epics,
                max_issues: caps.max_issues,
                max_retries: caps.max_retries,
            }
        }),
        planning: planning.offers_planning(),
        fsm: fsm.is_active().then(|| FsmView {
            machine: fsm.machine_name().to_string(),
        }),
        code_reviews,
        speculative,
    })
}

/// The model-facing message for a tool call refused by the loop's plan-mode guard.
///
/// While planning, every mutating tool is withheld (the pass is read-only) and a second
/// `enter_plan_mode` is meaningless; outside plan mode, only `submit_plan` is withheld (there is
/// no plan pass in progress). Each message tells the model how to proceed.
fn plan_mode_refusal(name: &str, in_plan_mode: bool) -> String {
    if in_plan_mode {
        if name == ENTER_PLAN_MODE_TOOL {
            "you are already in plan mode; explore with the read-only tools (`read_file`, \
             `list_dir`, `read_skill`, `search_archive`) and call `submit_plan` when your plan is \
             ready."
                .to_string()
        } else {
            format!(
                "`{name}` is unavailable in plan mode, which is read-only. You can read the \
                 workspace (`read_file`, `list_dir`), read skills, and search your archive. When \
                 your plan is ready, call `submit_plan` to clear your exploration and start \
                 implementing with your full toolset."
            )
        }
    } else {
        format!(
            "`{name}` is only available in plan mode; call `enter_plan_mode` first to start a \
             read-only planning pass."
        )
    }
}

/// Record one tool call's outcome into the context, giving the memory-curation tools and
/// `read_skill` their special treatment:
///
/// - a successful `write_memory`/`update_memory`/`delete_memory` (the store was already
///   mutated by the tool) re-emits the [`MemoryState`](GgTelemetryKind::MemoryState) so the
///   console reflects the change; the pinned [`Memory`](GgContextSource::Memory) block
///   itself is rebuilt from the store at the next turn boundary. Its confirmation is
///   ordinary ephemeral tool output;
/// - a successful `add_task`/`update_task`/`set_blocked_by`/`complete_task`/`remove_task`
///   likewise re-emits the [`TasksState`](GgTelemetryKind::TasksState); the pinned
///   [`TaskList`](GgContextSource::TaskList) block is rebuilt at the next turn boundary;
/// - a successful
///   `create_epic`/`create_issue`/`update_issue`/`set_issue_blocked_by`/`complete_issue`/`remove_epic`/`remove_issue`
///   likewise re-emits the [`BoardState`](GgTelemetryKind::BoardState); the pinned
///   [`Board`](GgContextSource::Board) block is rebuilt at the next turn boundary;
/// - a **fresh** skill read is pinned as a [`Skill`](GgContextSource::Skill)-sourced item
///   (retained across compaction) and the updated
///   [`SkillsState`](GgTelemetryKind::SkillsState) is emitted; a **repeat** read is
///   answered with a short note rather than a second pinned copy of the body;
/// - every other tool result is ordinary ephemeral working material tagged by
///   [`source`](tool_output_source).
#[allow(clippy::too_many_arguments)]
fn record_tool_result(
    context: &mut ContextModel,
    skills: &mut SkillsRuntime,
    memories: &MemoriesRuntime,
    tasks: &TasksRuntime,
    board: &BoardRuntime,
    call: &ToolCall,
    outcome: ToolOutcome,
    emitter: &Emitter,
) {
    // A successful memory mutation changed the store (the tool did the mutation and cap
    // enforcement); re-emit the state so the console tracks the curated set live. The
    // memory context block is refreshed at the next turn boundary, not here, so it never
    // interrupts this turn's tool results.
    if is_memory_tool(&call.name) && outcome.ok {
        if let Some(state) = memories.state_event() {
            emitter.emit(state);
        }
        context.push_tool_result(tool_output_source(&call.name), &call.id, outcome.output);
        return;
    }

    // A successful task mutation changed the DAG (the tool did the mutation and the cycle
    // check); re-emit the state so the console tracks the live DAG. The pinned task block
    // is refreshed at the next turn boundary, like the memory block.
    if is_task_tool(&call.name) && outcome.ok {
        if let Some(state) = tasks.state_event() {
            emitter.emit(state);
        }
        context.push_tool_result(tool_output_source(&call.name), &call.id, outcome.output);
        return;
    }

    // A successful board mutation changed the epic/issue board (the tool did the mutation, the
    // invariant checks, and the cycle check); re-emit the state so the console tracks the live
    // board. The pinned board block is refreshed at the next turn boundary, like the task block.
    if is_board_tool(&call.name) && outcome.ok {
        if let Some(state) = board.state_event() {
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
        match skills.record_read(name) {
            ReadRecord::Fresh => {
                // Pin the skill body so context accounting attributes it to skills and
                // compaction retains it verbatim.
                context.push(
                    GgContextSource::Skill,
                    Retention::Pinned,
                    crate::model::Message::tool_result(&call.id, outcome.output),
                );
                if let Some(state) = skills.state_event() {
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
        context.push_file_view(path, &call.id, outcome.output, outcome.images);
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
    vision: &Arc<VisionSupport>,
    emitter: &Emitter,
) -> Result<ModelResponse, ModelError> {
    let err = match client.complete(&context.messages(), tools).await {
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
    client.complete(&context.messages(), tools).await
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
/// tokens or cost.
fn record_usage(response: &ModelResponse, emitter: &Emitter) {
    if response.usage == TokenCounts::default() && response.cost.is_none() {
        return;
    }
    emitter.emit(GgTelemetryKind::Usage {
        tokens: response.usage,
        cost: response.cost,
    });
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

/// The [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) execution path: healing the reply into a
/// program, the sandbox run, the servicing seam, and the turn feedback.
///
/// Split out under the repo's `foo.<concern>.rs` convention rather than left inline: it is one
/// self-contained concern of some size, and this file is already the largest in the crate. Its items
/// are `use`d back into this module so the loop calls them unqualified, exactly as it did when they
/// lived here.
#[path = "agent.code.rs"]
mod code;

use code::{CodeTurn, CodeTurnOutcome, run_code_turn};

#[cfg(test)]
#[path = "agent.test.rs"]
mod tests;
