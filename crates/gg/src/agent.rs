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
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde_json::{Value, json};
use test_cabinet_core::gg::{
    AUTOLOAD_LOCKED_IMPL, CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_AUTOLOAD_SPECS,
    CAPABILITY_CONTEXT_WINDOW_OVERRIDE, CAPABILITY_MEMORIES, CAPABILITY_PROJECT_MANAGEMENT,
    CAPABILITY_REPLAY, CAPABILITY_RESPONSES_AS_CODE, CAPABILITY_SHELL, CAPABILITY_SKILLS,
    CAPABILITY_SPECULATIVE, CAPABILITY_SUBAGENTS, CAPABILITY_TASKS, CAPABILITY_WORKFLOWS,
    GgAgentConfig, GgAgentStatus, GgCandidateShape, GgCapabilitySet, GgContextAction,
    GgContextSource, GgHealingStrategy, GgIssueReviewPhase, GgLimitBreach, GgLimitKind,
    GgNotAProgram, GgPlanPhase, GgResponseHealing, GgReviewer, GgRunLimits, GgSlotBinding,
    GgSpeculationPhase, GgSubagentScope, GgTelemetryKind, GgWorkflowPhase,
    PROJECT_MANAGEMENT_PARAM_MERGE_AGENT,
};
use test_cabinet_core::metrics::{Cost, TokenCounts};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

use crate::archive::ArchiveStore;
use crate::board::{self, BoardCaps, BoardRuntime, IssuePolicy, IssueStatus};
use crate::client::{ClientFactory, DefaultClientFactory, provider_for};
use crate::compaction::{
    self, CompactionRequest, CompactionSetup, PendingCompaction, RestoredFile, RetainedCounts,
};
use crate::completion::{self, CompletionSetup};
use crate::config::GgInvocation;
use crate::context::{
    BpeTokenEstimator, ContextModel, Retention, TokenEstimator, code_heading, tool_output_source,
};
use crate::docs::DocsRuntime;
use crate::ending::{Ending, EndingRole};
use crate::fsm::{FsmRuntime, StateExit, ToolPolicy, configured_machine, is_builtin_machine};
use crate::git;
use crate::healing::{
    self, AssistantMessageMode, CandidateShape, Healed, HealingConfig, HealingStrategy,
    HealingVerdict, NotAProgramReason, plural,
};
use crate::limits::{
    AgentLimits, FatalFault, RunLimits, RunSpend, TurnErrorKind, TurnOutcome, resolve_run_limits,
};
use crate::memories::{MemoriesRuntime, MemoryCaps, MemoryStrategy};
use crate::message_log::finish_reason_token;
use crate::model::{
    ImageContent, Message, ModelClient, ModelError, ModelResponse, ToolCall, ToolDefinition,
};
use crate::planning::PlanningRuntime;
use crate::prompts::{
    self, ApiView, AssignedIssueView, AttemptBriefContext, AutoloadView, BoardView, CodeCallView,
    CodeErrorView, CodeHeadingView, CodeNotAProgramContext, CodeResultContext,
    CodeSandboxErrorContext, CodeTimeoutContext, CodeTranspileErrorContext, EndingView,
    FixBriefContext, FsmView, JudgeAttemptView, JudgeBriefContext, MemoriesView, MergeBriefContext,
    NumberedItem, ReadFileView, ReviewBriefContext, ReviewChangesView, ReviewRecordView, ShellView,
    SpawnableAgentView, SystemContext, TasksView,
};
use crate::replay::{GgRecorder, RecordingClient};
use crate::sandbox::{
    self, FunctionSummary, PROGRAM_CALL_ID_PREFIX, ProgramResult, SandboxError, SandboxLimits,
    SandboxOutcome, UnreachableTail, run_program, scope_tools,
};
use crate::skills::{DEFAULT_SKILLS_DIR, ReadRecord, SkillLibrary, SkillsRuntime};
use crate::subagents::{
    AgentCtx, AgentReturn, ChildHandle, ParentWait, Scheduler, SubagentConfig, WaiterToken,
};
use crate::tasks::{TasksRuntime, resolve_max_tasks, resolve_task_mode};
use crate::telemetry::Emitter;
use crate::tools::VisionContext;
use crate::tools::{
    ARCHIVE_THREAD_TOOL, AgentStatusData, COMPACT_TOOL, CREATE_ISSUE_TOOL,
    DEFAULT_ARCHIVE_KEEP_RECENT, ENTER_PLAN_MODE_TOOL, EVICT_FILE_VIEW_TOOL, OffloadPolicy,
    PARAM_MAX_CHARS, PARAM_MAX_LINES, READ_FILE_TOOL, READ_SKILL_TOOL, RUN_WORKFLOW_TOOL,
    ReadFileTool, ReadPolicy, ReclaimData, RuntimeSet, SEND_MESSAGE_TOOL, SHELL_OUTPUT_OFFLOAD,
    SHELL_TOOL, SPAWN_SUBAGENT_TOOL, SPECULATE_TOOL, SUBMIT_PLAN_TOOL, SpeculationData,
    SubagentHandleData, SubagentResultData, Tool, ToolContext, ToolData, ToolFailure, ToolOutcome,
    ToolRegistry, WAIT_FOR_ISSUE_TOOL, WAIT_FOR_SUBAGENTS_TOOL, WorkflowData, handled_by_loop,
    is_board_tool, is_context_reclaim_tool, is_fsm_tool, is_memory_tool, is_planning_tool,
    is_subagent_tool, is_task_tool, offload_misconfigured, parse_archive_keep_recent,
    parse_compact_request, parse_evict_path, plan_mode_offers, read_policy, saturating_u32,
    saturating_u64, shell_offload, unknown_disabled_tools,
};
use crate::turn_timing::TurnTimer;
use crate::vision::VisionSupport;

/// The [context-window-override](CAPABILITY_CONTEXT_WINDOW_OVERRIDE) capability's param
/// naming the context window to run the model against, in tokens. It may only *narrow* the
/// [catalog's figure](GgInvocation::model_windows) — the model's real window is a hard limit
/// — so a larger value is clamped to it, and a value of `0` or a non-integer is ignored.
/// Narrowing it is how a study exercises compaction against a 1M-token model without paying
/// for a million tokens of input. Read only when the capability is enabled.
const PARAM_WINDOW_LIMIT: &str = "windowLimit";

/// Skills capability param naming the directory authored skills are loaded from. A
/// relative value is resolved against the run workspace; an absolute one is used as
/// given. When absent, [`DEFAULT_SKILLS_DIR`] under the workspace is used.
const PARAM_SKILLS_DIR: &str = "dir";

/// The [slot](GgSlotBinding) name a [handoff compaction](CompactionStrategy::is_handoff)'s second
/// client is bound under, so the tokens it spends are attributed to the compaction model rather
/// than to the agent profile whose thread it condensed.
const COMPACTION_SLOT: &str = "compaction";

/// The [`SessionEnded`](GgTelemetryKind::SessionEnded) status for a session that ended because the
/// **model** said it was done — a tool-calling turn that requested no tools, or, under
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE), a program that called
/// [`finish`](FINISH_FUNCTION).
///
/// Named rather than spelled out at each of its sites because it is also what the issue-review
/// verdict and the speculation candidate filter test a child agent against: one string with several
/// readers is one string that must not be typed once per reader.
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

/// The [speculative-execution](CAPABILITY_SPECULATIVE) capability param naming the
/// [agent profile](GgAgentConfig) a [speculation](handle_speculate)'s judge runs under. Absent
/// means the run's [root](GgCapabilitySet::root).
const PARAM_JUDGE_AGENT: &str = "judgeAgent";

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
#[derive(Clone)]
pub struct Agent {
    /// The agent's stable id in the tree ([`ROOT_AGENT_ID`] for the root).
    pub id: String,
    /// The id of the agent that spawned this one, or `None` for the root.
    pub parent_id: Option<String>,
    /// The agent's depth in the tree: `0` for the root, `parent.depth + 1` for a child.
    pub depth: usize,
    /// The [agent profile](GgAgentConfig) name this agent runs under — the key its
    /// capabilities, model binding, and system prompt resolve from. The root runs under the
    /// set's [root profile](GgCapabilitySet::root), whatever it is named; a spawned child
    /// under whichever profile its spawner named. Carried under the field name `slot`
    /// because it is what the [per-profile accounting](SlotAccounting) and the
    /// `AgentSpawned`/`SlotUsage` telemetry key on.
    pub slot: String,
}

impl Agent {
    /// The **root** agent for a run: [`ROOT_AGENT_ID`], no parent, depth `0`, running under
    /// `profile` — the set's [root profile](GgCapabilitySet::root), passed in rather than
    /// assumed to be called [`ROOT_AGENT`] so a renamed root still resolves its own model,
    /// capabilities, and prompt.
    pub fn root(profile: &str) -> Self {
        Self {
            id: ROOT_AGENT_ID.to_string(),
            parent_id: None,
            depth: 0,
            slot: profile.to_string(),
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

/// Build the client [binding](GgSlotBinding) for the [agent profile](GgAgentConfig) named
/// `profile` in `set`, or an error naming what is wrong. The seam every agent resolves its client
/// through: the root resolves the [root profile](GgCapabilitySet::root); a spawned child resolves
/// whichever profile its spawner named.
///
/// A [`GgSlotBinding`] is still the [factory](ClientFactory)'s input DTO (it keys purely on the
/// model id); its `slot` field carries the profile name so the resolved model is attributed to the
/// right profile in telemetry.
fn profile_binding(set: &GgCapabilitySet, profile: &str) -> Result<GgSlotBinding, String> {
    let agent = set.agent(profile).ok_or_else(|| {
        format!("no `{profile}` agent profile is declared; there is no model to run")
    })?;
    let model_id = agent.resolved_model_id().ok_or_else(|| {
        format!("the `{profile}` agent profile has no model bound; there is no model to run")
    })?;
    Ok(GgSlotBinding::new(profile, model_id))
}

/// Validate a run's [agent profiles](GgAgentConfig) before launch: the set must declare at least
/// one profile (its [root](GgCapabilitySet::root) — the run has no model otherwise), every profile
/// must have a non-empty name and a resolved model, no name may be declared twice, every
/// [roster reference](GgAgentConfig::subagents) must name a declared profile, no profile may
/// be able to **file [issues](crate::board)** without anyone to assign them to, and a run with
/// [project management](CAPABILITY_PROJECT_MANAGEMENT) on must name a shell-capable
/// [merge agent](PROJECT_MANAGEMENT_PARAM_MERGE_AGENT). Returns a
/// human-readable error on the first problem, so a misconfiguration fails loudly at launch rather
/// than surfacing mid-run. Pure, so it is unit tested directly.
fn validate_agents(set: &GgCapabilitySet) -> Result<(), String> {
    // The root is the *first* profile, whatever it is called — an operator may rename it or
    // promote another profile to it — so what has to be true here is that there is one at all.
    // Checked up front because everything below (and `GgCapabilitySet::root`) assumes it.
    if set.agents.is_empty() {
        return Err("no agent profiles are declared; there is no model to run".to_string());
    }
    let mut seen: Vec<&str> = Vec::with_capacity(set.agents.len());
    for agent in &set.agents {
        let name = agent.name.trim();
        if name.is_empty() {
            return Err("an agent profile has an empty name".to_string());
        }
        if agent
            .model_slot
            .as_deref()
            .is_some_and(|_| !agent.is_resolved())
        {
            // A configuration is launched, not run: whoever launched it was supposed to bind a
            // model to every deferred profile. One left over means the launch skipped it.
            return Err(format!(
                "the `{name}` agent still defers to a model slot; launching must bind a model to it"
            ));
        }
        if !agent.is_resolved() {
            return Err(format!("the `{name}` agent is bound to an empty model id"));
        }
        if seen.contains(&name) {
            return Err(format!("the `{name}` agent is declared more than once"));
        }
        seen.push(name);
    }
    for agent in &set.agents {
        for reference in &agent.subagents {
            if set.agent(&reference.agent).is_none() {
                return Err(format!(
                    "the `{}` agent lists `{}` in its roster, which is not a declared agent profile",
                    agent.name, reference.agent
                ));
            }
        }
        // An issue names the profile gg dispatches it under, drawn from the filer's own
        // *implementers* — so an agent that may file issues but lists none could never write a
        // valid one. Refuse the configuration rather than offer a tool whose every call would be
        // rejected; withholding `create_issue` (read-only board access) is the intended way to
        // have one. The same argument applies to an agent that must name reviewers but has none.
        if agent.is_enabled(CAPABILITY_PROJECT_MANAGEMENT)
            && !agent.is_tool_disabled(CREATE_ISSUE_TOOL)
        {
            if agent
                .agents_in_scope(GgSubagentScope::Implementer)
                .is_empty()
            {
                return Err(format!(
                    "the `{}` agent may create issues but its roster lists no `implementer` to \
                     assign them to; give one of its agents the implementer scope, or switch its \
                     issue-creation feature off for read-only board access",
                    agent.name
                ));
            }
            if board::requires_reviewers(agent)
                && agent.agents_in_scope(GgSubagentScope::Reviewer).is_empty()
            {
                return Err(format!(
                    "the `{}` agent must name reviewers on every issue but its roster lists no \
                     `reviewer`; give one of its agents the reviewer scope, or switch the \
                     `reviewers` requirement off",
                    agent.name
                ));
            }
        }
    }
    validate_merge_agent(set)?;
    Ok(())
}

/// Validate the [merge agent](PROJECT_MANAGEMENT_PARAM_MERGE_AGENT) a
/// [project-management](CAPABILITY_PROJECT_MANAGEMENT) run must name.
///
/// Every issue works in its own worktree, so an accepted issue's branch has to be merged back — and
/// with issues running concurrently a conflicting merge is an ordinary event. gg therefore refuses
/// to launch a board without somebody to hand that conflict to. The named profile must be declared,
/// and must have the [shell](CAPABILITY_SHELL) capability: resolving a merge means running `git`,
/// which an agent without a shell cannot do.
fn validate_merge_agent(set: &GgCapabilitySet) -> Result<(), String> {
    if !set
        .agents
        .iter()
        .any(|agent| agent.is_enabled(CAPABILITY_PROJECT_MANAGEMENT))
    {
        return Ok(());
    }
    let named = merge_agent_name(set);
    let Some(name) = named else {
        return Err(format!(
            "project management is enabled but no merge agent is named; set the \
             `{PROJECT_MANAGEMENT_PARAM_MERGE_AGENT}` param of the \
             `{CAPABILITY_PROJECT_MANAGEMENT}` capability to an agent that can resolve a merge \
             conflict when an accepted issue's work does not apply cleanly"
        ));
    };
    let Some(profile) = set.agent(&name) else {
        return Err(format!(
            "the `{PROJECT_MANAGEMENT_PARAM_MERGE_AGENT}` names `{name}`, which is not a declared \
             agent profile"
        ));
    };
    if !profile.is_enabled(CAPABILITY_SHELL) {
        return Err(format!(
            "the merge agent `{name}` does not have the `{CAPABILITY_SHELL}` capability; resolving \
             a merge conflict means running `git` in the workspace, so a merge agent must have a \
             shell"
        ));
    }
    Ok(())
}

/// The [merge agent](PROJECT_MANAGEMENT_PARAM_MERGE_AGENT) `set` names, from the first profile that
/// configures one — the board is run-global, so its merge agent is too, and reading the first
/// declaration keeps a set that names it on a non-Root profile working rather than silently
/// ignored.
fn merge_agent_name(set: &GgCapabilitySet) -> Option<String> {
    set.agents
        .iter()
        .filter_map(|agent| agent.capability(CAPABILITY_PROJECT_MANAGEMENT))
        .filter_map(|cap| cap.params.get(PROJECT_MANAGEMENT_PARAM_MERGE_AGENT))
        .filter_map(Value::as_str)
        .map(str::trim)
        .find(|name| !name.is_empty())
        .map(str::to_string)
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
    // a parent and its subagents run distinct offline scripts. The factory carries the run's
    // session id as the shared `prompt_cache_key`, so every agent's requests route to one provider
    // backend and reuse each other's — and their own turns' — cached prompt prefix.
    let factory = Arc::new(DefaultClientFactory::new(Some(
        invocation.session_id.clone(),
    )));
    run_with_factory(invocation, emitter, factory).await
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

    // Scope the stream to the root up front, so every event (launch diagnostics included) is
    // attributed to it.
    let root_emitter = emitter.for_agent(ROOT_AGENT_ID, None);
    // Announce the configuration on the very first event: a console watching the stream
    // then knows which capabilities are live from the start, and can shape itself to
    // this run rather than offering every surface gg has.
    root_emitter.emit(GgTelemetryKind::SessionStarted {
        capability_set: Some(set.clone()),
    });

    // Launch check 1: the agent profiles must be well-formed, and there must be a root to run.
    if let Err(err) = validate_agents(set) {
        root_emitter.emit(log("error", err));
        root_emitter.emit(session_ended("error"));
        return SessionOutcome::LaunchFailed;
    }
    // Whatever the operator called it: the root is the first profile, not a profile named `Root`.
    let root_profile = set.root_name().to_string();
    let binding = match profile_binding(set, &root_profile) {
        Ok(binding) => binding,
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
                    "could not resolve the `{root_profile}` agent (model `{}`): {err}",
                    binding.model_id
                ),
            ));
            root_emitter.emit(session_ended("error"));
            return SessionOutcome::LaunchFailed;
        }
    };

    // Resolve worktree isolation before building the orchestrator: when the run can produce a
    // worktree (a board issue's, or a speculation attempt's), make the workspace a git repo and
    // commit its baseline, reporting any git-absent/failure loudly on the root's stream so a later
    // issue that has to fall back to the shared tree does so with a reason on the record.
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
        root_emitter.emit(log(
            "info",
            healing::assistant_messages_summary(orch.code.assistant_messages),
        ));
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
    let root_agent = Agent::root(&root_profile);
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
            "root agent `{ROOT_AGENT_ID}` (profile `{root_profile}`) {status}.",
            root_profile = end.slot,
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
    /// Whether the [workflows](CAPABILITY_WORKFLOWS) capability is on — gates the `run_workflow`
    /// tool. Workflows are built on the subagent machinery, so a run with workflows on (even if
    /// [`subagents`](CAPABILITY_SUBAGENTS) is off) still gets the per-agent delegation context and
    /// the agent-tree telemetry (see [`delegation_enabled`](Self::delegation_enabled)).
    workflows_enabled: bool,
    /// Where [worktree](Worktree) checkouts are created (a sibling of the workspace),
    /// `Some` only when worktree isolation is usable (git present, baseline committed, root
    /// created). `None` means issues run in the shared workspace and `speculate` is refused.
    worktrees_root: Option<PathBuf>,
    /// The run's **baseline commit** — the seeded workspace committed at session start when gg made
    /// the workspace a git repo. The first [worktree](Worktree) branches from it (later ones branch
    /// from whatever the main tree's `HEAD` has advanced to). `None` when git could not initialize
    /// a baseline, which is also how the rest of the orchestrator tells that isolation is off.
    baseline_commit: Option<String>,
    /// The [agent profile](GgAgentConfig) gg hands a **conflicted merge** to when an accepted
    /// [issue](crate::board)'s branch does not apply cleanly — the
    /// [`mergeAgent`](PROJECT_MANAGEMENT_PARAM_MERGE_AGENT) the capability requires. `None` only
    /// when project management is off (launch validation refuses a board without one).
    merge_agent: Option<String>,
    /// Whether the [speculative-execution](CAPABILITY_SPECULATIVE) capability is on — gates the
    /// `speculate` tool (best-of-K). It needs the delegation machinery (to fan out
    /// the attempts and run the judge), so it only engages when
    /// [`delegation_enabled`](Self::delegation_enabled); worktree isolation is checked at call time.
    speculative_enabled: bool,
    /// The **root agent's** code setup: whether its turns are conducted as
    /// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE), the per-program sandbox ceilings, and the
    /// armed [healing](crate::healing) strategies. Since responses-as-code is now a **per-agent**
    /// capability, each agent's own setup is resolved from its profile at run time (see
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
    issue_worktrees: Mutex<HashMap<String, Worktree>>,
    /// The [review verdicts](ReviewRecord) each [issue](crate::board) has already collected, keyed
    /// by issue id and in the order they were rendered. Every round's reviewers are shown the
    /// history, so a second reviewer knows what a first one already asked for and a re-review can
    /// tell whether its own earlier items were addressed.
    issue_reviews: Mutex<HashMap<String, Vec<ReviewRecord>>>,
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
    /// Serializes every **synchronous** git operation on the shared repository (worktree
    /// add/remove, a review's diff), since concurrently-finishing agents would otherwise race on
    /// `.git` and the main working tree. Held only across the synchronous git calls, never across an
    /// await — see [`merge_lock`](Self::merge_lock) for the long-running half.
    git_lock: Mutex<()>,
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
        worktrees: WorktreesSetup,
        warnings: &mut Vec<String>,
    ) -> Self {
        let set = &invocation.capability_set;
        // Load the skills library once (empty when the capability is off or nothing is seeded) and
        // share its Arc across agents; each agent keeps its own read-state runtime over it.
        let skills = resolve_skills(set, &invocation.workspace_dir);
        let limits = resolve_run_limits(set, warnings);
        let deadline = limits.max_runtime.map(|budget| Instant::now() + budget);
        // The Root agent's code setup: responses-as-code is per-agent, but the Root's is what the
        // run-level launch log and the sandbox warm-up decision key on.
        let healing = healing::resolve_healing(set.root());
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
        // A `shell` capability that asks for output offloading without naming a ceiling for it to
        // truncate past runs the *control* arm under the treatment arm's name — the same silent
        // wrong-experiment failure a stale ceiling is, so it is reported on the same terms.
        for agent in &set.agents {
            let Some(shell) = agent
                .capability(CAPABILITY_SHELL)
                .filter(|capability| capability.enabled)
            else {
                continue;
            };
            if offload_misconfigured(shell.implementation.as_deref(), &shell.params) {
                warnings.push(format!(
                    "agent `{}`: the `{CAPABILITY_SHELL}` capability's `{SHELL_OUTPUT_OFFLOAD}` \
                     mode names neither `{PARAM_MAX_LINES}` nor `{PARAM_MAX_CHARS}`, so there is no \
                     ceiling to offload past; command output is returned inline. Set at least one \
                     of them.",
                    agent.name,
                ));
            }
        }
        // The `assistantMessages` mode is read literally and reported on mismatch for the same reason
        // healing keys are: a typo would otherwise pick a mode the study did not ask for, silently.
        for unknown in &healing::resolve_assistant_messages(set.root()).unknown_params {
            warnings.push(format!(
                "the `{CAPABILITY_RESPONSES_AS_CODE}` capability declares `{unknown}`, which gg \
                 could not read as an assistant-message mode; it changes nothing. Set it to \
                 `\"none\"` (record the reply as sent) or `\"response-healing\"` (record the healed \
                 program)."
            ));
        }
        Self {
            caps: set.clone(),
            workspace_dir: invocation.workspace_dir.clone(),
            prompt: invocation.prompt.clone(),
            provided_files: invocation.provided_files.clone(),
            subagents_enabled: set.is_enabled(CAPABILITY_SUBAGENTS),
            project_management_enabled: board_owner(set).is_some(),
            workflows_enabled: set.is_enabled(CAPABILITY_WORKFLOWS),
            worktrees_root: worktrees.root,
            baseline_commit: worktrees.baseline_commit,
            merge_agent: board_owner(set)
                .is_some()
                .then(|| merge_agent_name(set))
                .flatten(),
            speculative_enabled: set.is_enabled(CAPABILITY_SPECULATIVE),
            code: CodeSetup {
                enabled: set.root().is_enabled(CAPABILITY_RESPONSES_AS_CODE),
                limits: sandbox::resolve_sandbox_limits(set.root()),
                healing: healing.config,
                assistant_messages: healing::resolve_assistant_messages(set.root()).mode,
            },
            issue_worktrees: Mutex::new(HashMap::new()),
            issue_reviews: Mutex::new(HashMap::new()),
            board: resolve_board(set),
            issue_waits: Mutex::new(HashMap::new()),
            git_lock: Mutex::new(()),
            merge_lock: tokio::sync::Mutex::new(()),
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

    /// The context accounting for an agent running `model_id`: the shared estimator and the
    /// model's window limit (its catalog window, narrowed by an enabled
    /// [context-window override](CAPABILITY_CONTEXT_WINDOW_OVERRIDE)).
    fn context_setup(&self, model_id: &str) -> ContextSetup {
        ContextSetup {
            estimator: Arc::clone(&self.estimator),
            window_limit: resolve_window_limit(&self.caps, &self.model_windows, model_id),
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
    /// session start when gg made the workspace a git repo — or `None` when git isolation is
    /// unavailable.
    fn baseline_commit(&self) -> Option<&str> {
        self.baseline_commit.as_deref()
    }

    /// Whether isolated [worktrees](Worktree) can actually be created this run: git was available,
    /// a baseline was committed, and the checkout root exists. `false` degrades issues to the shared
    /// workspace and refuses `speculate`.
    fn worktrees_usable(&self) -> bool {
        self.worktrees_root.is_some() && self.baseline_commit.is_some()
    }

    /// Whether [speculative execution](handle_speculate) can actually run this run: the
    /// [speculative-execution](CAPABILITY_SPECULATIVE) capability **and** the delegation machinery a
    /// best-of-K fan-out + judge needs. Worktree isolation is a further requirement checked at call
    /// time (with a clear refusal), so a speculation without worktrees is a runtime refusal, not a
    /// silently-withheld tool.
    fn speculative_active(&self) -> bool {
        self.speculative_enabled && self.delegation_enabled()
    }

    /// The [agent profile](GgAgentConfig) an agent named `profile` runs under: the declared profile,
    /// or the [root](GgCapabilitySet::root) when the name is not one this run declares (so a stale
    /// reference falls back to a working profile rather than refusing).
    fn profile_or_root(&self, profile: &str) -> &GgAgentConfig {
        self.caps.agent(profile).unwrap_or_else(|| self.caps.root())
    }

    /// The name of an [agent profile](GgAgentConfig) a run-level capability points a helper agent at:
    /// the string `param` on the [root](GgCapabilitySet::root)'s config for capability `cap_id`, when
    /// it names a declared profile, else the root itself. This knob (the speculation judge) is
    /// read off the root because it governs the run as a whole, not one agent's turn. An
    /// [issue](crate::board)'s agent and reviewers are deliberately **not** among them: an issue
    /// names its own when it is filed.
    fn helper_profile(&self, cap_id: &str, param: &str) -> String {
        self.caps
            .root()
            .capability(cap_id)
            .and_then(|cfg| cfg.params.get(param))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty() && self.caps.agent(name).is_some())
            .unwrap_or_else(|| self.caps.root_name())
            .to_string()
    }

    /// The [agent profile](GgAgentConfig) an auto-dispatched [issue](crate::board)'s agent runs
    /// under — the [assignee](crate::board::Issue::agent) named when the issue was filed. A
    /// profile this run does not declare (or an issue from a board recorded before issues carried
    /// an assignee) falls back to the [root](GgCapabilitySet::root), so a stale reference still
    /// dispatches rather than stalling the board.
    fn issue_profile(&self, issue_id: &str) -> String {
        self.board
            .issue_agent(issue_id)
            .filter(|name| self.caps.agent(name).is_some())
            .unwrap_or_else(|| self.caps.root_name().to_string())
    }

    /// The [agent profile](GgAgentConfig) a [speculative execution](handle_speculate)'s **judge** runs
    /// under — the [speculative-execution](CAPABILITY_SPECULATIVE) capability's
    /// [`judgeAgent`](PARAM_JUDGE_AGENT) param, defaulting to the
    /// [root](GgCapabilitySet::root).
    fn judge_profile(&self) -> String {
        self.helper_profile(CAPABILITY_SPECULATIVE, PARAM_JUDGE_AGENT)
    }

    /// The per-agent [code setup](CodeSetup) for `profile`: whether its turns run as
    /// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE), and the sandbox ceilings and
    /// [healing](crate::healing) strategies its own responses-as-code config resolves to.
    fn code_setup(&self, profile: &GgAgentConfig) -> CodeSetup {
        CodeSetup {
            enabled: profile.is_enabled(CAPABILITY_RESPONSES_AS_CODE),
            limits: sandbox::resolve_sandbox_limits(profile),
            healing: healing::resolve_healing(profile).config,
            assistant_messages: healing::resolve_assistant_messages(profile).mode,
        }
    }

    /// The isolated [worktree](Worktree) issue `issue_id` works in, creating it on first use.
    ///
    /// The branch is based at the main tree's **current `HEAD`**, not at the run baseline: an issue
    /// only becomes actionable once every issue it is blocked by is done and merged, so branching
    /// from `HEAD` is what lets it build on its blockers' work. Returns `None` when git isolation is
    /// unavailable (the issue then works in the shared workspace) or the worktree could not be
    /// created, in which case the reason is logged rather than failing the issue.
    fn ensure_issue_worktree(&self, issue_id: &str, emitter: &Emitter) -> Option<Worktree> {
        let mut worktrees = self.issue_worktrees.lock().expect("issue worktrees lock");
        if let Some(existing) = worktrees.get(issue_id) {
            return Some(existing.clone());
        }
        let root = self.worktrees_root.as_ref()?;
        self.baseline_commit.as_ref()?;
        let _guard = self.git_lock.lock().expect("git lock");
        let base = match git::head_commit(&self.workspace_dir) {
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
        if let Err(err) = git::add_worktree(&self.workspace_dir, &path, &branch, &base) {
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
        worktrees.insert(issue_id.to_string(), worktree.clone());
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
    /// named when it was filed. Profiles this run does not declare are dropped; an empty result
    /// means the issue is accepted without review.
    fn reviewer_slots(&self, issue_id: &str) -> Vec<String> {
        self.board
            .issue_reviewers(issue_id)
            .into_iter()
            .filter(|name| self.caps.agent(name).is_some())
            .collect()
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
    fn review_changes(&self, issue_id: &str) -> String {
        let Some(baseline) = self.issue_baseline(issue_id) else {
            return String::new();
        };
        let dir = self.issue_workspace(issue_id);
        let _guard = self.git_lock.lock().expect("git lock");
        git::diff_stat_since(&dir, &baseline).unwrap_or_default()
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
    /// Each dispatch atomically [claims](BoardRuntime::assign_issue) an issue and takes back the
    /// **agent id the board minted for it** — named after the issue and the attempt (`AUTH-1.0i`) —
    /// then spawns that agent with the issue's brief. Two concurrent pumps cannot both take one issue:
    /// the loser's claim simply returns `None`, and because the id is minted *by* the claim it never
    /// burns an attempt number either. The agents are top-level (no parent, depth 0), so they surface
    /// as their own roots in the Agents tree.
    fn pump_dispatch(self: &Arc<Self>, emitter: &Emitter) {
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
        // Dispatched issue agents run under the profile the issue was assigned to when it was
        // filed (falling back to Root for a stale reference).
        let slot = self.issue_profile(&issue_id);
        let binding = match profile_binding(&self.caps, &slot) {
            Ok(binding) => binding,
            Err(err) => return self.abort_issue_dispatch(&issue_id, &slot, &err, emitter),
        };
        let client = match self.factory.client_for(&binding) {
            Ok(client) => client,
            Err(err) => {
                return self.abort_issue_dispatch(&issue_id, &slot, &err.to_string(), emitter);
            }
        };
        // Every issue works in its own worktree, created on its first dispatch and reused by every
        // later agent that touches it (a retry, a review round, its reviewers). Isolation that is
        // unavailable is logged there and degrades to the shared workspace rather than failing the
        // issue.
        self.ensure_issue_worktree(&issue_id, emitter);
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
    wait_for_issue_by_id(project, agent, board, emitter, &issue_id).await
}

/// Suspend this agent until `issue_id` is terminal, then report which — the core of
/// [`handle_wait_for_issue`](handle_wait_for_issue) once the id is in hand.
///
/// It is a function of its own because two paths reach the same wait: the native tool-calling loop,
/// which parses the id off a `wait_for_issue` [`ToolCall`] and calls it through
/// [`handle_wait_for_issue`]; and the responses-as-code loop, which performs the *deferred* waits a
/// program [registered](LoopToolApi::register_issue_wait) once that program has ended, calling this
/// directly for each recorded id. Both share the self-issue guard, the not-found check, the
/// already-terminal short-circuit, and the slot-freeing block, so neither can drift from the other.
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
            format!(
                "you cannot wait on issue `{issue_id}`: it is the issue you were assigned to \
                 implement. Do the work and finish — your issue is completed when you are."
            ),
        );
    }
    let Some(status) = board.issue_status(issue_id) else {
        return ToolOutcome::failed(
            ToolFailure::NotFound,
            format!(
                "no issue `{issue_id}` is on the board (your current board is in your context); \
                 create it with `create_issue` or correct the id."
            ),
        );
    };
    if status.is_terminal() {
        return issue_wait_result(issue_id, status);
    }
    match project.orch.begin_issue_wait(issue_id) {
        IssueWaitOutcome::AlreadyTerminal => {}
        IssueWaitOutcome::Blocked(rx) => {
            if project.orch.multi_agent() {
                emitter.emit(agent_blocked_on(format!("issue `{issue_id}`")));
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
    match board.issue_status(issue_id) {
        Some(status) => issue_wait_result(issue_id, status),
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
        IssueStatus::Open | IssueStatus::InProgress | IssueStatus::InReview => ToolOutcome::ok(
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
        IssueStatus::InReview => "in review",
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
        /// dispatched into one — an issue's reviewer (which reads the tree its issue is working in)
        /// or a [speculation](handle_speculate) attempt (which gets a fresh one). `None` runs the
        /// subagent in the shared main tree.
        ///
        /// The worktree is **not** reconciled here: whoever created it owns its fate — an issue's
        /// is merged when the issue is accepted, a speculation's when its judge picks a winner —
        /// because a reviewer and its issue share one tree, and an attempt that merged itself would
        /// defeat best-of-K.
        worktree: Option<Worktree>,
        /// Which [ending calls](EndingRole) this subagent was dispatched with — how it declares the
        /// result its dispatcher is waiting for. A reviewer returns a verdict, a judge names a
        /// winner, everything else reports what it did.
        ending: EndingRole,
        /// The spawner's wait condition the subagent signals on completion.
        parent_wait: Arc<ParentWait>,
        /// The channel the subagent's [return value](AgentReturn) is delivered on.
        result: oneshot::Sender<AgentReturn>,
        /// Flipped when the subagent's loop ends, so its spawner's `send_message` refuses.
        finished: Arc<AtomicBool>,
    },
}

/// An isolated git worktree an agent runs in: its branch, its checkout path, and the commit it
/// branched from.
///
/// Two things create one. An [issue](crate::board) gets a worktree on its first dispatch
/// ([`ensure_issue_worktree`](Orchestrator::ensure_issue_worktree)) that every later agent touching
/// that issue — a retry, a review round's re-dispatch, its reviewers — shares, and which is merged
/// back into the main tree when the issue is accepted. A [speculation](handle_speculate) gives each
/// of its K attempts its own, of which only the winner's is merged.
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

    // This agent's profile — the source of its capabilities, model, execution mode, and prompt.
    // A name this run does not declare falls back to the Root (a spawned child always names a
    // declared profile; this only guards a stale internal reference).
    let profile = orch.profile_or_root(&agent.slot).clone();

    let model_id = client.model_id().to_string();
    emitter.emit(log(
        "info",
        format!(
            "agent profile `{}` resolved to model `{model_id}` ({} provider).",
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
    // The isolated worktree this agent's tools are rooted in, when it has one: an issue agent takes
    // its issue's, a reviewer or speculation attempt is handed one at dispatch, and everything else
    // works in the shared main tree.
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
    emitter.emit(GgTelemetryKind::AgentSpawned {
        slot: agent.slot.clone(),
        model_id: model_id.clone(),
        depth: agent.depth as u64,
        brief,
        worktree: worktree_branch,
        cwd: Some(workspace_dir.display().to_string()),
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
    let memories = resolve_memories(&profile);
    let tasks = resolve_tasks(&profile);
    let board = orch.board.clone();
    let planning = PlanningRuntime::resolve(&profile);
    // The FSM engine drives only the **root** agent (the run's top-level process); a subagent does
    // scoped work and is not itself driven through a machine, so it gets a disabled runtime.
    let fsm = if is_root {
        FsmRuntime::resolve(&profile)
    } else {
        FsmRuntime::disabled()
    };
    let archive_store = Arc::new(Mutex::new(ArchiveStore::new()));
    let library = skills.library();
    let memory_store = memories.store();
    let task_store = tasks.store();
    let board_store = board.store();
    // The issue this agent was auto-dispatched to implement, if any. It shapes the agent's *prompt*
    // (which names the issue it is working) and its issue-wait guard, but not its toolset: an
    // implementer hands its work back by finishing, not by making a board move, so it needs no board
    // tool it would not otherwise have.
    let assigned_issue = match &role {
        AgentRole::Issue { issue_id, .. } => Some(issue_id.clone()),
        _ => None,
    };
    // This agent's toolset, model, and prompt all come from **its own profile**, so a run can give
    // different agents different capabilities. The board store it binds is the run-global one.
    let runtimes = RuntimeSet::new(&library)
        .with_memories(&memory_store)
        .with_tasks(&task_store)
        .with_board(&board_store)
        .with_archive(&archive_store);
    let registry = ToolRegistry::from_run(&profile, &runtimes);
    // The agent's file/shell tools are rooted at the [directory it was announced with](workspace_dir)
    // — its isolated worktree when it has one, so every mutation (and every command it runs without
    // an explicit path) lands in the private copy rather than the shared main tree; otherwise the
    // shared workspace. This is the whole of the worktree isolation at the tool layer — the loop is
    // otherwise identical.
    //
    // The tool context carries this agent's model alongside its workspace root, because
    // one tool's answer depends on it: `read_file` attaches a picture only when the model
    // asking can see one. The registry behind it is the run's, not this agent's.
    let tool_ctx = ToolContext::new(workspace_dir).with_vision(&model_id, Arc::clone(&orch.vision));

    // This agent's execution mode (traditional tool calling vs a code-shaped reply) and the sandbox
    // ceilings/healing behind it come from its **own profile**, so a run can mix agents that call
    // tools with agents that write programs.
    let code = orch.code_setup(&profile);

    // What gates this agent's ending, when anything does: the validation commands its own profile
    // configures. *How* it ends is not a profile's business — that is its dispatched
    // [role](EndingRole)'s, and it is an explicit call either way.
    let completion = CompletionSetup::resolve(&profile);

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
            orch.speculative_active(),
            code.enabled,
            &completion,
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
        emitter.record_execution_mode(if code.enabled {
            "responses_as_code"
        } else {
            "tool_calling"
        });
        for unknown in unknown_disabled_tools(&profile) {
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
    let mut compaction = CompactionSetup::resolve(&profile);
    // A handoff strategy condenses on a **second** model, resolved through the same factory every
    // agent's own model is. A named model that will not resolve is a misconfiguration, not a reason
    // to stop compacting — a run that stopped compacting would overflow its window a few turns
    // later — so it is reported loudly and the agent's own client stands in.
    if let Some(model) = compaction::handoff_model_id(&profile) {
        let binding = GgSlotBinding::new(COMPACTION_SLOT, &model);
        match orch.factory.client_for(&binding) {
            Ok(client) => {
                compaction.handoff_client = Some(client);
                if is_root {
                    emitter.emit(log(
                        "info",
                        format!(
                            "compaction hands off to `{model}`; the working model's thread is \
                             condensed by it, not by the agent."
                        ),
                    ));
                }
            }
            Err(err) => emitter.emit(log(
                "warn",
                format!(
                    "compaction names the handoff model `{model}`, which could not be resolved \
                     ({err}); compacting on this agent's own model instead."
                ),
            )),
        }
    }
    let amc = AmcSetup {
        enabled: profile.is_enabled(CAPABILITY_AGENT_MANAGED_CONTEXT),
        archive: Arc::clone(&archive_store),
    };
    let autoload = AutoloadSetup::resolve(&profile);
    if is_root && autoload.enabled {
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
    if is_root && compaction.enabled {
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
        assigned_issue: assigned_issue.clone(),
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
            autoload,
            &orch.provided_files,
            skills,
            memories,
            tasks,
            board,
            planning,
            fsm,
            read_policy(&profile),
            shell_offload(&profile),
            orch.speculative_active(),
            code,
            completion,
            ending_role,
            &profile,
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
    // Whether the loop ended in a *completion* — the model signalled it was done under this agent's
    // own [completion rule](crate::completion) — rather than on a ceiling, a breached limit, or an
    // error. It is what finishes an [issue](crate::board) this agent was dispatched to implement.
    let completed = end.status == STATUS_COMPLETED;
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
            reconcile_issue(&orch, &issue_id, retry, completed, emitter).await;
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
            let summary = end
                .final_text
                .clone()
                .unwrap_or_else(|| format!("(subagent ended: {})", end.status));

            // A worktree this subagent ran in is deliberately left untouched: whoever created it
            // owns its fate. A reviewer shares its issue's tree, which the issue's own reconciliation
            // merges; a speculation attempt's tree is judged and then merged or discarded by the
            // `speculate` routine that fanned it out. Reconciling here would merge a reviewer's read
            // as if it were work, and would defeat best-of-K by merging every attempt.
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
            finished.store(true, Ordering::SeqCst);
            let _ = result.send(AgentReturn {
                summary,
                status: end.status,
                ending: end.ending.clone(),
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
    speculative: bool,
    responses_as_code: bool,
    completion: &CompletionSetup,
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
        emitter.emit(log("info", memories_startup_note(memories)));
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

    if completion.has_validation() {
        emitter.emit(log(
            "info",
            format!(
                "completion validation enabled: gg runs {} command(s) when an agent signals it is \
                 done, and only ends its session if every one exits 0 (a failure's output is fed \
                 back and the session continues).",
                completion.validation().len()
            ),
        ));
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

/// A human-readable provider label for the model the [profile](GgAgentConfig) named `profile` is
/// bound to, for an agent's resolution log line. Falls back to `"mock"` when the profile cannot be
/// resolved (it always can here — it was resolved to build the client — so this is only defensive).
fn provider_label_for(orch: &Orchestrator, profile: &str) -> &'static str {
    match profile_binding(&orch.caps, profile) {
        Ok(binding) => provider_label(&binding),
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
    // The target agent profile must be named and must be one this agent may spawn.
    let profile = match resolve_delegation_target(&sub.orch, spawner, args) {
        Ok(profile) => profile,
        Err(refusal) => return refusal,
    };
    // Ad-hoc subagents carry no board issue (issues auto-dispatch to their own top-level agents)
    // and share the spawner's tree — isolation belongs to issues and speculations, which own the
    // worktree's whole lifecycle.
    match dispatch_child(
        sub,
        spawner,
        brief,
        None,
        &profile,
        None,
        EndingRole::Standard,
    ) {
        Ok(child) => {
            ToolOutcome::ok(
                format!(
                    "Spawned subagent `{id}` as agent `{slot}` (model `{model}`). It is running in \
                     parallel — call `wait_for_subagents` to collect its result, or `send_message` \
                     to guide it while it works.",
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

/// Resolve and validate the `agent` argument of a model-invoked delegation call
/// (`spawn_subagent`/`speculate`/`run_workflow`) against the spawner's
/// [allowlist](GgAgentConfig::subagents), returning the target profile name or a model-facing
/// refusal that names the agents this agent may spawn. An agent may name itself.
// The `Err` is a `ToolOutcome` — the model-facing refusal — which is deliberately the same
// large enum every tool returns; boxing it here alone would just add an unwrap at each call site.
#[allow(clippy::result_large_err)]
fn resolve_delegation_target(
    orch: &Orchestrator,
    spawner: &Agent,
    args: &Value,
) -> Result<String, ToolOutcome> {
    let spawner_profile = orch.profile_or_root(&spawner.slot);
    let allowed = || {
        if spawner_profile.subagents.is_empty() {
            "none".to_string()
        } else {
            spawner_profile
                .subagents
                .iter()
                .map(|reference| format!("`{}`", reference.agent))
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
        Some(agent) if spawner_profile.can_spawn(agent) => Ok(agent.to_string()),
        Some(agent) => Err(ToolOutcome::failed(
            ToolFailure::InvalidArgument,
            format!(
                "cannot spawn `{agent}`: it is not one of the agents you may spawn. Pass one of: {}.",
                allowed()
            ),
        )),
        None => Err(ToolOutcome::failed(
            ToolFailure::InvalidArgument,
            format!(
                "this call needs an `agent` — the name of the agent to run. You may spawn: {}.",
                allowed()
            ),
        )),
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
    profile_name: &str,
    worktree: Option<Worktree>,
    ending: EndingRole,
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

    // The child runs under the named agent profile. A profile this run does not declare (or one
    // with no model) is a bad *argument*, which is what tells a program to pass a different one.
    let slot = profile_name.to_string();
    let binding = profile_binding(&orch.caps, &slot).map_err(|err| {
        DispatchError::new(
            ToolFailure::InvalidArgument,
            format!("cannot spawn agent `{slot}`: {err}"),
        )
    })?;
    // The profile is bound but its client would not resolve — a missing credential, a provider that
    // could not be built. Nothing about the call was wrong, so it is an I/O-class failure.
    let client = orch.factory.client_for(&binding).map_err(|err| {
        DispatchError::new(
            ToolFailure::IoError,
            format!(
                "cannot spawn agent `{slot}` (model `{}`): {err}",
                binding.model_id
            ),
        )
    })?;
    let model_id = client.model_id().to_string();

    // Build the child's identity, wiring, and role, then schedule it. The child clones the
    // spawner's `ParentWait` so it can signal completion back up.
    let child_id = orch.next_agent_id();

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
        ending,
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
    })
}

/// Create a fresh isolated [worktree](Worktree) named `name`, or a model-facing error when
/// isolation is unavailable.
///
/// Used by [speculative execution](handle_speculate), whose attempts each need their own copy of the
/// workspace. (An [issue](crate::board)'s worktree is created by
/// [`ensure_issue_worktree`](Orchestrator::ensure_issue_worktree) instead, which is keyed by issue
/// rather than by agent and degrades to the shared tree rather than refusing.) The branch is based
/// at the main tree's current `HEAD`, so an attempt starts from everything already landed. The git
/// call is serialized on the shared [git lock](Orchestrator::git_lock).
fn make_worktree(orch: &Orchestrator, name: &str) -> Result<Worktree, DispatchError> {
    let Some(root) = &orch.worktrees_root else {
        return Err(DispatchError::new(
            ToolFailure::Unavailable,
            "worktree isolation is unavailable this run (git could not initialize a workspace \
             baseline at startup), so this work cannot be run in an isolated copy of the workspace.",
        ));
    };
    let _guard = orch.git_lock.lock().expect("git lock");
    let base = git::head_commit(&orch.workspace_dir).map_err(|err| {
        DispatchError::new(
            ToolFailure::IoError,
            format!(
                "could not read the workspace `HEAD` to branch an isolated worktree from: {err}"
            ),
        )
    })?;
    let slug = worktree_slug(name);
    let branch = format!("gg/{slug}");
    let path = root.join(&slug);
    git::add_worktree(&orch.workspace_dir, &path, &branch, &base).map_err(|err| {
        DispatchError::new(
            ToolFailure::IoError,
            format!("could not create an isolated worktree: {err}"),
        )
    })?;
    Ok(Worktree { branch, path, base })
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
// Issue reconciliation: reviewers, the fix loop, and the merge back
// ---------------------------------------------------------------------------

/// What one round of an [issue's](crate::board) review concluded.
enum RoundOutcome {
    /// Every reviewer approved: the issue may be merged and accepted.
    Approved,
    /// A reviewer returned actionable items: the issue's assigned agent is re-invoked with them.
    ChangesRequested(Vec<String>),
    /// The review could not be conducted (a reviewer that would not dispatch, or one that ended
    /// without a verdict). The issue is **not** accepted — work no reviewer approved never is.
    Aborted(String),
}

/// Reconcile an [issue](crate::board) once the agent working it has finished — the whole of what
/// happens between "an agent stopped" and "the board moved".
///
/// `completed` is whether that agent's loop ended in a **completion** ([`STATUS_COMPLETED`]) rather
/// than on a ceiling or an error. That — and nothing else — is what finishes an issue: the agent
/// signalled completion under whatever [rule](crate::completion) its own profile configures, and
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
/// Every path ends by [pumping the board](Orchestrator::on_issue_progress), so dependents unblock
/// and waiters wake exactly once the issue's real state is settled.
async fn reconcile_issue(
    orch: &Arc<Orchestrator>,
    issue_id: &str,
    retry: u32,
    completed: bool,
    emitter: &Emitter,
) {
    if completed && orch.board.submit_issue_for_review(issue_id) {
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
                discard_issue_worktree(orch, issue_id, emitter);
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
        discard_issue_worktree(orch, issue_id, emitter);
    }
    orch.on_issue_progress(emitter);
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
/// An issue that named **no** reviewers is approved immediately — there is nobody to gate it — and
/// emits no review telemetry, so a board run without reviewers looks exactly as it did before.
async fn run_issue_review(
    orch: &Arc<Orchestrator>,
    issue_id: &str,
    emitter: &Emitter,
) -> RoundOutcome {
    let reviewers = orch.reviewer_slots(issue_id);
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

    let changes = orch.review_changes(issue_id);
    let history = orch.review_history(issue_id);
    let worktree = orch.issue_worktree(issue_id);
    // Who has approved so far *this round*, in the order they ran: reported on whichever event ends
    // the round, so a verdict is attributable to an agent rather than to "the review".
    let mut approvals: Vec<GgReviewer> = Vec::new();
    for profile in reviewers {
        // Each reviewer is named under the implementer whose work it is reviewing (`AUTH-1.0i.0r`),
        // so the agent id says which attempt was reviewed and in what order.
        let agent_id = orch
            .board
            .next_review_agent_id(issue_id)
            .unwrap_or_else(|| orch.next_agent_id());
        let reviewer = GgReviewer {
            agent_id: agent_id.clone(),
            profile: profile.clone(),
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
            agent_id,
            &profile,
            review_brief,
            Some(issue_id.to_string()),
            worktree.clone(),
            EndingRole::Review,
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
    if let Err(err) = git::commit_worktree(&worktree.path, &format!("gg issue {issue_id}")) {
        emitter.emit(log(
            "error",
            format!("could not commit the work for issue `{issue_id}`: {err}"),
        ));
        remove_worktree(orch, &worktree, emitter);
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
        &orch.workspace_dir,
        &worktree.branch,
        git::ConflictPolicy::Keep,
    );
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
        git::abort_merge(&orch.workspace_dir);
    }
    remove_worktree(orch, &worktree, emitter);
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
        format!("dispatching the merge agent `{merge_agent}` to resolve issue `{issue_id}`."),
    ));
    // The merge agent works in the main tree — that is where the conflicted merge lives — so it is
    // dispatched with no worktree of its own.
    match run_detached_agent(
        orch,
        orch.next_agent_id(),
        &merge_agent,
        brief,
        Some(issue_id.to_string()),
        None,
        EndingRole::Standard,
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
    if git::merge_in_progress(&orch.workspace_dir) {
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
fn discard_issue_worktree(orch: &Arc<Orchestrator>, issue_id: &str, emitter: &Emitter) {
    let Some(worktree) = orch.take_issue_worktree(issue_id) else {
        return;
    };
    remove_worktree(orch, &worktree, emitter);
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
fn remove_worktree(orch: &Orchestrator, worktree: &Worktree, emitter: &Emitter) {
    let _guard = orch.git_lock.lock().expect("git lock");
    if let Err(err) = git::remove_worktree(&orch.workspace_dir, &worktree.path, &worktree.branch) {
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
fn run_detached_agent<'a>(
    orch: &'a Arc<Orchestrator>,
    agent_id: String,
    profile: &'a str,
    brief: String,
    issue_id: Option<String>,
    worktree: Option<Worktree>,
    ending: EndingRole,
) -> Pin<Box<dyn Future<Output = Result<AgentReturn, String>> + Send + 'a>> {
    Box::pin(async move {
        let binding = profile_binding(&orch.caps, profile)
            .map_err(|err| format!("could not be dispatched: {err}"))?;
        let client = orch.factory.client_for(&binding).map_err(|err| {
            format!(
                "could not be dispatched (model `{}`): {err}",
                binding.model_id
            )
        })?;
        let (result_tx, result_rx) = oneshot::channel();
        let agent = Agent {
            id: agent_id,
            parent_id: None,
            depth: 0,
            slot: profile.to_string(),
        };
        let role = AgentRole::Sub {
            brief,
            issue_id,
            worktree,
            ending,
            parent_wait: Arc::new(ParentWait::new()),
            result: result_tx,
            finished: Arc::new(AtomicBool::new(false)),
        };
        let (_inbox_tx, inbox_rx) = mpsc::unbounded_channel();
        let orch_for_task = Arc::clone(orch);
        let handle = tokio::spawn(async move {
            run_agent(orch_for_task, agent, role, client, inbox_rx).await;
        });
        orch.tasks.lock().expect("subagent tasks lock").push(handle);
        result_rx
            .await
            .map_err(|_| "produced no result".to_string())
    })
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
/// prompt; a brief that restated them would be a second authority on the contract, and the
/// mode-dependent version of that restatement is what used to send a code-mode reviewer looking for
/// a final message its protocol does not have.
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
    /// The commit the attempt's branch was created from — what its diff is taken against.
    base: String,
    /// How the attempt's loop ended (`"completed"`, `"model_error"`, `"timed_out"`, …). Only a
    /// cleanly `"completed"` attempt that produced changes is a candidate to win.
    status: String,
    /// The attempt's return value (its final message), shown to the judge for context.
    summary: String,
    /// The attempt's diff against the commit its branch was cut from — what the judge
    /// scores and what is merged if it wins. Empty when the attempt produced no changes.
    diff: String,
}

/// The judge's verdict for a [speculative execution](handle_speculate): which candidate attempt won,
/// and why — read from the [`Winner`](Ending::Winner) the judge declared, never from its prose.
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
    // worktree isolation is unavailable (git absent, or no baseline could be committed).
    if !orch.worktrees_usable() {
        return ToolOutcome::failed(
            ToolFailure::Unavailable,
            "cannot speculate: best-of-K runs each attempt in an isolated worktree, but worktree \
             isolation is unavailable this run (git could not establish a workspace baseline at \
             startup). Do the work with a single attempt instead.",
        );
    }

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

    // The agent profile every attempt runs under, validated against this agent's allowlist.
    let attempt_profile = match resolve_delegation_target(&orch, spawner, &call.arguments) {
        Ok(profile) => profile,
        Err(refusal) => return refusal,
    };
    // K — clamped into [2, MAX]; fewer than two would not be best-of-anything.
    let attempts = call
        .arguments
        .get("attempts")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_SPECULATION_ATTEMPTS)
        .clamp(2, MAX_SPECULATION_ATTEMPTS);
    let approaches = parse_string_array(&call.arguments, "approaches");

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
        let brief = build_attempt_brief(&base_brief, i, attempts as usize, approaches.get(i));
        // Each attempt gets a fresh worktree of its own, left in place for judging: only the
        // winner's is merged, so an attempt must not be able to reach another's files.
        let worktree = match make_worktree(&orch, &format!("spec-{}-{}", spawner.id, i)) {
            Ok(worktree) => worktree,
            Err(err) => {
                abort_speculation(sub, &orch, emitter, &fanned).await;
                let failure = err.failure;
                return ToolOutcome::failed(
                    failure,
                    format!(
                        "cannot speculate: attempt {} of {attempts} could not be given an isolated \
                         worktree: {err} The speculation was aborted and the workspace left \
                         unchanged.",
                        i + 1
                    ),
                );
            }
        };
        let branch = worktree.branch.clone();
        let path = worktree.path.clone();
        let base = worktree.base.clone();
        match dispatch_child(
            sub,
            spawner,
            brief,
            issue_id.clone(),
            &attempt_profile,
            Some(worktree),
            EndingRole::Standard,
        ) {
            Ok(child) => fanned.push(SpeculationAttempt {
                id: child.id,
                branch,
                path,
                base,
                status: String::new(),
                summary: String::new(),
                diff: String::new(),
            }),
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
            git::diff_since(&attempt.path, &attempt.base).unwrap_or_default()
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
        let judge_slot = orch.judge_profile();
        let judge_brief = build_judge_brief(&base_brief, &fanned, &candidates);
        match dispatch_judge(
            sub,
            spawner,
            emitter,
            issue_id.clone(),
            judge_brief,
            &judge_slot,
            candidates.len() as u32,
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
fn build_attempt_brief(base: &str, index: usize, k: usize, approach: Option<&String>) -> String {
    prompts::render_attempt_brief(&AttemptBriefContext {
        base: base.to_string(),
        index: index + 1,
        count: k,
        approach: approach
            .map(String::as_str)
            .filter(|approach| !approach.is_empty())
            .map(str::to_string),
    })
}

/// Build the **judge**'s brief for a [speculative execution](handle_speculate): the task, each
/// candidate attempt's summary and diff, and the verdict protocol [`parse_judge_verdict`] expects.
/// The candidates are renumbered 1..N (the judge does not see the discarded attempts), and the caller
/// maps the judge's pick back to the original attempt index.
///
/// `code` swaps the ending clause: a judge that never reaches `completed` renders no verdict, and a
/// speculation with no verdict merges nothing at all.
fn build_judge_brief(task: &str, attempts: &[SpeculationAttempt], candidates: &[usize]) -> String {
    prompts::render_judge_brief(&JudgeBriefContext {
        task: task.to_string(),
        attempts: candidates
            .iter()
            .enumerate()
            .map(|(label, &idx)| {
                let attempt = &attempts[idx];
                JudgeAttemptView {
                    number: label + 1,
                    summary: (!attempt.summary.trim().is_empty())
                        .then(|| attempt.summary.trim().to_string()),
                }
            })
            .collect(),
        count: candidates.len(),
    })
}

/// Dispatch one **judge** subagent against `judge_brief` on `judge_slot`, await it, and read the
/// [verdict](JudgeVerdict) it declared — the [speculative execution](handle_speculate) analogue of an
/// issue's reviewer (a judge that *selects among* K attempts rather than approving one diff).
///
/// Returns the verdict, or a model-facing error when the judge could not be dispatched or ended
/// without declaring one; the caller then merges nothing (best-of-K never merges an unjudged
/// attempt). The judge is an ordinary [subagent](dispatch_child) scoped to `issue_id` (when any) and
/// runs in the shared tree (it only reads the summaries in its brief). It is dispatched in the
/// [judge role](EndingRole::Judge), carrying `candidates` so a pick outside the range it was shown is
/// refused at the call rather than clamped into a merge of the wrong attempt.
async fn dispatch_judge(
    sub: &mut SubagentContext,
    spawner: &Agent,
    emitter: &Emitter,
    issue_id: Option<String>,
    judge_brief: String,
    judge_slot: &str,
    candidates: u32,
) -> Result<JudgeVerdict, String> {
    let judge = dispatch_child(
        sub,
        spawner,
        judge_brief,
        issue_id,
        judge_slot,
        None,
        EndingRole::Judge {
            attempts: candidates,
        },
    )
    .map_err(|err| format!("the judge could not be dispatched: {err}"))?;
    let collected = await_children(sub, emitter, std::slice::from_ref(&judge.id)).await;
    match collected.into_iter().next() {
        Some((_, Some(ret))) if ret.status == STATUS_COMPLETED => match ret.ending {
            Some(Ending::Winner { attempt, rationale }) => Ok(JudgeVerdict {
                winner: attempt as usize,
                rationale,
            }),
            _ => Err("the judge ended without naming a winner".to_string()),
        },
        Some((_, Some(ret))) => Err(format!("the judge {} without a verdict", ret.status)),
        _ => Err("the judge produced no result".to_string()),
    }
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
    match git::merge_branch(
        &orch.workspace_dir,
        &winner.branch,
        git::ConflictPolicy::Abort,
    ) {
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

/// Read an intercepted **ending call**'s arguments into the [`Ending`] it declares.
///
/// It is the tool-calling counterpart of the [sandbox membrane](crate::sandbox)'s session host, and
/// it deliberately goes through the very same [`Ending`] constructors: an empty change list is
/// refused in one sentence, written once, whichever execution mode the reviewer that produced it was
/// running in. Nothing here re-reads prose — the arguments *are* the verdict.
fn parse_ending_call(name: &str, args: &Value, role: EndingRole) -> Result<Ending, String> {
    match name {
        completion::APPROVE_TOOL => Ok(Ending::Approved),
        completion::REQUEST_CHANGES_TOOL => {
            Ending::changes_requested(parse_string_array(args, "items"))
        }
        completion::SELECT_WINNER_TOOL => Ending::winner(
            args.get("attempt")
                .and_then(Value::as_u64)
                .and_then(|attempt| u32::try_from(attempt).ok())
                .unwrap_or_default(),
            args.get("rationale")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            role.attempts(),
        ),
        // `finish`, and — defensively — anything else the role claimed to own.
        _ => Ending::finished(
            args.get("summary")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
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
///   workspace (for `tdd`, tests/implementation must exist) and step forward on success;
/// - [`PlanReset`](StateExit::PlanReset) — `plan-first`'s `plan` state: take the plan from the call's
///   `note`, step to `implement`, and defer the [context reset](AdvanceResult::submit_plan) (reusing
///   the planning flow);
/// - [`Terminal`](StateExit::Terminal) — not agent-advanced, so `advance_state` is refused (it was
///   never offered while resting there).
fn handle_advance_state(
    fsm: &mut FsmRuntime,
    context: &mut ContextModel,
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
        StateExit::Terminal => AdvanceResult::just(ToolOutcome::error(
            "advance_state: you are in the final state of the process; finish your work and stop.",
        )),
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

// ---------------------------------------------------------------------------
// Declared workflows: fan-out + sequencing over the subagent scheduler
// ---------------------------------------------------------------------------

/// One parsed stage of a declared [workflow](run_workflow): its name, per-item brief template, the
/// items it fans out over (or `None` to fan over the prior stage's results), and the agent profile
/// its subagents run under.
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

    // Every stage names an agent to run its subagents, and each must be one this agent may spawn.
    let spawner_profile = sub.orch.profile_or_root(&spawner.slot);
    for stage in &stages {
        if !spawner_profile.can_spawn(&stage.slot) {
            let allowed = if spawner_profile.subagents.is_empty() {
                "none".to_string()
            } else {
                spawner_profile
                    .subagents
                    .iter()
                    .map(|reference| format!("`{}`", reference.agent))
                    .collect::<Vec<_>>()
                    .join(", ")
            };
            return ToolOutcome::failed(
                ToolFailure::InvalidArgument,
                format!(
                    "workflow stage `{}` names agent `{}`, which is not one you may spawn. Use one \
                     of: {allowed}.",
                    stage.name, stage.slot
                ),
            );
        }
    }

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
            match dispatch_child(
                sub,
                spawner,
                brief,
                None,
                &stage.slot,
                None,
                EndingRole::Standard,
            ) {
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
/// is optional (an array of non-empty strings), and `slot` defaults to [`PRIMARY_SLOT`].
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
            .get("agent")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|agent| !agent.is_empty())
            .ok_or_else(|| {
                format!(
                    "workflow stage `{name}` needs an `agent` — the agent to run its subagents."
                )
            })?
            .to_string();
        stages.push(WorkflowStageSpec {
            name,
            prompt,
            items,
            slot,
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
    /// The agent's **final word** — its [return value](AgentReturn) to its spawner and the run's
    /// last text.
    ///
    /// For an agent that ended cleanly it is its [`ending`](Self::ending)'s
    /// [text](Ending::final_text); for one a ceiling stopped it is a [status line](stopped_text) gg
    /// wrote itself. It is never the last assistant message: in code mode every assistant message is
    /// a page of TypeScript, so a spawner and a run record would each be handed program source where
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
        autoload: AutoloadSetup,
        provided_files: &[PathBuf],
        mut skills: SkillsRuntime,
        memories: MemoriesRuntime,
        tasks: TasksRuntime,
        board: BoardRuntime,
        planning: PlanningRuntime,
        mut fsm: FsmRuntime,
        read_policy: ReadPolicy,
        shell_offload: OffloadPolicy,
        speculative: bool,
        code: CodeSetup,
        completion: CompletionSetup,
        ending_role: EndingRole,
        profile: &GgAgentConfig,
        mut subagents: Option<SubagentContext>,
        project: Option<ProjectContext>,
        replay: Option<Arc<GgRecorder>>,
    ) -> LoopEnd {
        // The per-agent turn ceiling, or `None` for unbounded (the default — the host caps the
        // wall-clock, so gg imposes no turn backstop unless a study asks for one). An unbounded run
        // iterates to `usize::MAX`, a bound no real run reaches, so it stops only on `finish`, an
        // error/cost ceiling, or the deadline — never by falling through the loop.
        let max_turns = limits.limits.max_turns;
        let turn_bound = max_turns.unwrap_or(usize::MAX);
        // Speculative execution (`speculate`) likewise needs the delegation machinery to fan out the
        // attempts and run the judge; with it off, the tool (if offered) falls through to a defensive
        // refusal rather than engaging.
        let speculative_active = speculative && subagents.is_some();
        // The full offered toolset. When planning is on, each turn's request is filtered from this
        // by the loop's plan-mode state (read-only tools only while planning); otherwise the whole
        // set is offered every turn.
        let all_tools = registry.definitions();
        // The per-agent documentation carve-out, behind `object.list()` and `fn.docs()`. Built from
        // the same scope-bound tool set the program's objects are, and always present (docs are not a
        // capability), so a code turn can always answer a lookup. Unused on the tool-calling path.
        let mut docs = crate::docs::DocsRuntime::new(scope_tools(registry), ending_role);
        // This agent's own rules on filing a board issue — who it may assign one to, and whether
        // reviewers are demanded. The native `create_issue` tool carries these already (the registry
        // built it from the same profile); a code turn rebuilds the tool per call, so it needs them
        // too.
        let issue_policy = IssuePolicy::resolve(profile);

        // Build the source-tagged context model in place of a flat transcript, seeded with
        // the two pinned items every session opens with: the system prompt (which lists any
        // available skills' descriptions and explains the memory scratchpad and task list) and
        // the build prompt. Every later contribution (assistant turns, tool output, file views,
        // read skills, the memory block, the task list) is appended as a tagged item, so the
        // window can be accounted by source and the pinned/ephemeral split is available for
        // Phase 2 compaction.
        let mut context = ContextModel::new(
            context_setup.estimator,
            context_setup.window_limit,
            code.enabled,
        );
        context.push_system(system_prompt(PromptInputs {
            registry,
            skills: &skills,
            memories: &memories,
            tasks: &tasks,
            board: &board,
            planning: &planning,
            fsm: &fsm,
            read_policy,
            shell_offload: &shell_offload,
            vision: &tool_ctx.vision,
            speculative: speculative_active,
            responses_as_code: code.enabled,
            // Whether this agent's opening context is pre-seeded with the test case's specs and
            // reference images, so the prompt can tell the model they are already loaded (and,
            // when locked, that they stay) rather than leaving it to infer why they are there.
            autoload_specs: autoload.enabled.then_some(autoload.locked),
            profile,
            ending_role,
            assigned_issue: project
                .as_ref()
                .and_then(|project| project.assigned_issue.as_deref()),
            fences_are_stripped: code.healing.enabled(HealingStrategy::StripFences),
        }));
        context.push_user_prompt(prompt);

        // Autoload the specifications: when this agent's profile enables the capability, seed the
        // test case's provided files (its specs and reference images) into the opening context as
        // though the model had already `read_file`d each — before the first turn, so the model
        // starts with the whole brief in the window. Locked pins them across compaction.
        if autoload.enabled {
            autoload_specifications(
                &mut context,
                provided_files,
                tool_ctx,
                autoload.locked,
                emitter,
            )
            .await;
        }

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
        // Compaction that is **in flight**: an [in-loop strategy](PendingCompaction) has asked the
        // agent to condense its own window, and the loop is waiting for the turn that does it.
        //
        // It is loop state rather than a local because a compaction of this shape spans a turn
        // boundary — gg asks on one turn and the model answers on the next — and while it is set
        // the loop is narrowed: the agent may do the one thing compaction asked for and nothing
        // else, since everything else adds to a window that is already full.
        let mut pending_compaction: Option<PendingCompaction> = None;
        // This agent's error accounting against the run's ceilings. One per agent, owned outright,
        // because "consecutive" and "the last N turns" are only definable within one agent's turn
        // sequence — see [`crate::limits`].
        let mut agent_limits = AgentLimits::new(limits.limits);
        // How to name a memory call to this agent: its strategy's tools, spelled for its execution
        // mode. Resolved once, because neither the strategy nor the mode changes within a run, and
        // both of the places that need it (a memory compaction's instruction, and the refusal that
        // answers anything else while one is pending) must name calls the agent actually has.
        let memory_calls = memories.strategy().calls(code.enabled);

        for turn in 0..turn_bound {
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
            //
            // Which of the two shapes runs depends on the strategy. An **out-of-band** one is
            // performed here and now, invisibly to the agent, and this turn simply proceeds against
            // a smaller window. An **in-loop** one cannot be: the agent itself writes the summary,
            // so gg appends the instruction, records what it is waiting for, and the turn that
            // follows is the compaction. The `pending_compaction.is_none()` guard is what stops a
            // still-full window from opening a second compaction on top of the one in flight.
            if pending_compaction.is_none() && compaction::should_compact(&context, &compaction) {
                let retained = RetainedCounts {
                    skills: skills.read_count() as u64,
                    tasks: tasks.count() as u64,
                    memories: memories.count() as u64,
                    issues: board.issue_count() as u64,
                };
                match compaction.strategy.pending() {
                    None => {
                        let (request, fallback) =
                            compaction::condense_out_of_band(&context, client, &compaction).await;
                        let files = restore_compact_files(&request.files, tool_ctx, emitter).await;
                        // Current *before* the rewrite, so the stale copy goes out with the
                        // history and the fresh one crosses in the pinned prefix.
                        refresh_memory_block(&mut context, &memories);
                        emitter.emit(compaction::apply_compaction(
                            &mut context,
                            &compaction,
                            retained,
                            &request,
                            files,
                            fallback,
                        ));
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
                        // Pushed as process-level guidance, exactly as the FSM's state guidance and
                        // the plan-mode notice are: it is gg speaking about the run rather than
                        // material the agent produced, and it is ephemeral, so the compaction it
                        // opens is also what clears it.
                        context.push(
                            GgContextSource::System,
                            Retention::Ephemeral,
                            Message::user(pending.instruction(code.enabled, memory_calls)),
                        );
                        pending_compaction = Some(pending);
                    }
                }
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
                let mut tools: Vec<ToolDefinition> = all_tools
                    .iter()
                    .filter(|tool| {
                        // `compact` is exempt from every turn-level filter, so the offered set is
                        // byte-identical on every turn of a self-compaction run. That is the point:
                        // the tool list is part of the prompt a provider caches, and a tool that
                        // came and went with plan mode or an FSM state would rewrite the cached
                        // prefix — and the turn it would appear on is the one where the window, and
                        // so the cost of a cache miss, is at its largest. The loop intercepts the
                        // call ahead of those same gates, so what is offered and what may run agree.
                        if tool.name == COMPACT_TOOL {
                            return true;
                        }
                        let planning_ok = !planning.offers_planning()
                            || plan_mode_offers(&tool.name, in_plan_mode);
                        planning_ok && fsm.offers(&tool.name)
                    })
                    .cloned()
                    .collect();
                // This agent's ending calls, the one way it may end its session. Appended *after*
                // the plan-mode/FSM filter, so they are always offered — like their code-mode
                // counterparts they bypass those turn-level gates (the loop intercepts them) and can
                // end a session from a state a machine meant to hold.
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
                        ending: None,
                        limit: None,
                    };
                }
            };
            // Reaching here means the call returned a response (the error arm returns), so
            // this is its latency — the denominator for the turn's generation throughput.
            let model_call_ms = model_call_started.elapsed().as_millis() as u64;
            // Hand the phase accounting the same figure the `prompt` event carries, so the two
            // events never disagree about how long the model took.
            turn_timer.model_call_finished(model_call_ms);

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
            // Responses-as-code heals the reply *before* the assistant message is recorded, because
            // the recorded message may be the healed program rather than the raw reply — that is the
            // `assistantMessages` lever (see `AssistantMessageMode`). Healing is done here, once, and
            // the `Healed` is handed to `run_code_turn` so the turn does not re-heal the same reply.
            // On the tool-calling path there is no program and no healing; the reply is recorded as
            // sent.
            let healed = code.enabled.then(|| {
                healing::heal(
                    response.text.as_deref().unwrap_or_default(),
                    !response.tool_calls.is_empty(),
                    &code.healing,
                )
            });
            // The text the assistant turn is recorded with. Under post-response healing it is the
            // healed program gg actually ran — but only when healing changed anything
            // (`rewritten()`); a reply healing left alone, or one that was not a program, is recorded
            // verbatim. Under no-post-processing (and on the tool-calling path) it is always the raw
            // reply. The healing that runs regardless is still disclosed in the turn's feedback.
            let assistant_text = match (&healed, code.assistant_messages) {
                (Some(healed), AssistantMessageMode::ResponseHealing) if healed.rewritten() => {
                    Some(healed.program.clone())
                }
                _ => response.text.clone(),
            };

            // Log this turn's exact request and response to the message log — the
            // de-duplicated ContextMessage/Prompt stream the console renders as the
            // per-message Requests view. Emitted every turn (context visibility is
            // intrinsic). Captured here,
            // *before* the assistant reply is appended, so `prompt_items` is exactly the
            // window that was sent this turn (post vision-recovery, if any). The reply is
            // built the same way `push_assistant` will record it (no native tool calls in
            // responses-as-code mode) and pooled too, so it reappears — id unchanged — as a
            // request pointer on the next turn.
            let reply = Message::assistant(
                assistant_text.clone(),
                if code.enabled {
                    Vec::new()
                } else {
                    response.tool_calls.clone()
                },
            );
            let reply_tokens = context.estimate(&reply);
            let has_reply = reply.content.is_some() || !reply.tool_calls.is_empty();
            let request: Vec<(GgContextSource, &Message, usize)> = context.prompt_items().collect();
            emitter.log_prompt(
                &request,
                has_reply.then_some((&reply, reply_tokens)),
                response.usage,
                response.cost,
                finish_reason_token(&response.finish_reason),
                Some(model_call_ms),
            );

            context.push_assistant(
                assistant_text,
                if code.enabled {
                    Vec::new()
                } else {
                    response.tool_calls.clone()
                },
            );

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
                apply_pending_compaction(
                    &mut context,
                    &compaction,
                    &memories,
                    RetainedCounts {
                        skills: skills.read_count() as u64,
                        tasks: tasks.count() as u64,
                        memories: memories.count() as u64,
                        issues: board.issue_count() as u64,
                    },
                    &request,
                    tool_ctx,
                    emitter,
                )
                .await;
                // The turn did exactly the work it was asked for, so it counts as progress — not as
                // an error, and not as the completion a tool-less reply would otherwise be.
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
                continue;
            }

            // Responses-as-code turn: the model was offered no native tools, so its **whole reply**
            // is a TypeScript program. Run the healed program in the wasmtime sandbox — bridging every
            // typed call to the real toolset (and, for a delegation tool, the scheduler) — and act
            // on what the turn asks for. There is no implicit ending here: a session under this
            // capability ends only when a program calls `finish`, or when a ceiling stops the run.
            if code.enabled {
                let turn_ctx = CodeTurn {
                    spawner: self,
                    registry,
                    tool_ctx,
                    read_policy,
                    shell_offload: &shell_offload,
                    board: &board,
                    issue_policy: &issue_policy,
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
                    speculative_active,
                    pending_compaction,
                    ending_role,
                };
                // The per-turn state (`context`/`skills`/`docs`/`subagents`) is handed to the code
                // turn **by value** — it is moved into the program's `LoopToolApi` so the program's
                // calls act on the live window on the blocking sandbox thread — and handed back on
                // every non-fatal path. On the one path it cannot come back (the sandbox task
                // panicked, a host fault), the turn is `Fatal` and the loop returns below without
                // reading the window again.
                let (decision, state) = run_code_turn(
                    healed.expect("code mode heals the reply before recording the assistant turn"),
                    &code,
                    limits.deadline,
                    &turn_ctx,
                    context,
                    skills,
                    docs,
                    subagents,
                )
                .await;
                // Completion validation gate: a program that called `finish` must pass this run's
                // validation commands before the run ends. Run them *before* the turn is recorded,
                // so a rejected completion is accounted as the `Continue` it becomes (progress, the
                // model must fix and finish again) rather than the `Finished` the program declared.
                // A rejected completion is turned into a `Continue` carrying the failure feedback,
                // which the arm below reclaims the turn's state for, pushes, and loops on — the same
                // path an ordinary error turn takes.
                let decision = match decision {
                    CodeTurnOutcome::Finished { ending } if completion.has_validation() => {
                        match completion::run_validation(
                            completion.validation(),
                            tool_ctx,
                            &shell_offload,
                            emitter,
                        )
                        .await
                        {
                            None => CodeTurnOutcome::Finished { ending },
                            Some(feedback) => CodeTurnOutcome::Continue {
                                feedback,
                                images: Vec::new(),
                                error: None,
                                report: "its ending was rejected by validation".to_string(),
                            },
                        }
                    }
                    decision => decision,
                };
                // Every code turn is recorded, including the one that finishes and the one that
                // ends fatally, so the rate window is fed uniformly and the accounting cannot drift
                // from the number of model calls made. Neither of those two ever breaches.
                let breach = agent_limits.record(decision.turn_outcome(), &self.id);
                match decision {
                    CodeTurnOutcome::Finished { ending } => {
                        return LoopEnd {
                            status: STATUS_COMPLETED,
                            turns: turn + 1,
                            tokens: total_tokens,
                            cost: total_cost,
                            slot: self.slot.clone(),
                            final_text: Some(ending.final_text()),
                            ending: Some(ending),
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
                            ending: None,
                            limit: None,
                        };
                    }
                    CodeTurnOutcome::Continue {
                        feedback,
                        images,
                        report,
                        ..
                    } => {
                        // Reclaim the per-turn state the code turn carried by value. It is present
                        // on every non-fatal path (only a panicked sandbox loses it, and that is
                        // `Fatal`), so the loop rebinds its live window, skills/docs runtimes and
                        // delegation context here before using them again this turn or next.
                        let CodeTurnState {
                            context: turn_context,
                            skills: turn_skills,
                            docs: turn_docs,
                            subagents: turn_subagents,
                            issue_waits: turn_issue_waits,
                            compact_requested: turn_compaction,
                            compaction_calls: (turn_compaction_calls, turn_compaction_failures),
                        } = state.expect("a non-fatal code turn hands back its per-turn state");
                        context = turn_context;
                        skills = turn_skills;
                        docs = turn_docs;
                        subagents = turn_subagents;
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
                                let outcome =
                                    wait_for_issue_by_id(project, self, &board, emitter, issue_id)
                                        .await;
                                resolved.push(outcome.output);
                            }
                            context.push(
                                GgContextSource::ToolOutput,
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
                                apply_pending_compaction(
                                    &mut context,
                                    &compaction,
                                    &memories,
                                    RetainedCounts {
                                        skills: skills.read_count() as u64,
                                        tasks: tasks.count() as u64,
                                        memories: memories.count() as u64,
                                        issues: board.issue_count() as u64,
                                    },
                                    &request,
                                    tool_ctx,
                                    emitter,
                                )
                                .await;
                            }
                            // Not satisfied: the compaction stays pending and the next program is
                            // asked again. The instruction is re-stated rather than left to the one
                            // the model has already ignored once, and the run's error ceilings are
                            // what stop an agent that never complies.
                            (None, Some(pending)) => context.push(
                                GgContextSource::System,
                                Retention::Ephemeral,
                                Message::user(pending.unsatisfied(true, memory_calls)),
                            ),
                            (None, None) => {}
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
                let breach = agent_limits.record(
                    TurnOutcome::Error(TurnErrorKind::MissingCompletion),
                    &self.id,
                );
                context.push(
                    GgContextSource::System,
                    Retention::Ephemeral,
                    Message::user(pending.unsatisfied(false, memory_calls)),
                );
                if let Some(breach) = breach {
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
                continue;
            }

            // The **tool-calling** mode's termination rule, and it is the same rule the code branch
            // above enforces: a session ends on an explicit ending call and on nothing else. A reply
            // that requested no tools is therefore an *error*, not a conclusion — so a model that
            // loops emitting prose instead of ending trips the run's error ceilings and stops early
            // rather than burning to its turn budget — and it is answered by naming the calls this
            // agent's role actually gives it.
            if response.tool_calls.is_empty() {
                let breach = agent_limits.record(
                    TurnOutcome::Error(TurnErrorKind::MissingCompletion),
                    &self.id,
                );
                context.push(
                    GgContextSource::ToolOutput,
                    Retention::Ephemeral,
                    Message::user(completion::missing_completion_feedback(ending_role)),
                );
                if let Some(breach) = breach {
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
                continue;
            }

            // A plan submitted this turn, captured during dispatch and applied once the turn's tool
            // results are all recorded (so the conversation stays valid before the context is reset).
            let mut submitted_plan: Option<String> = None;

            // The ending this turn declared. Captured during dispatch (an ending call is
            // intercepted like the other loop-driven tools) and, if set, ends the session once the
            // turn's tool results are all recorded — so the intercepted call's result is answered
            // and the conversation stays valid, exactly as a submitted plan defers its context
            // reset.
            let mut declared_ending: Option<Ending> = None;

            // The compaction this turn declared with a `compact` call, deferred to after the
            // dispatch loop for exactly the reason a submitted plan's context reset is: the turn's
            // tool results must all be recorded first, or the rewrite would drop an assistant
            // `tool_calls` message whose `tool` answers had not been written yet. How this turn's
            // calls fared against a pending compaction is tallied alongside, for the memory
            // strategy's "one reply whose calls all succeeded" gate.
            let mut compact_request: Option<CompactionRequest> = None;
            let mut compaction_calls = 0u32;
            let mut compaction_failures = 0u32;

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
                let mut outcome = if let Some(pending) =
                    pending_compaction.filter(|pending| !pending.admits(&call.name, false))
                {
                    // A compaction is in flight and this is not the call it asked for. Refused
                    // ahead of every other gate — including `finish` — because the window is
                    // already full: any call that ran would make the problem worse, and a run that
                    // ended here would end from a context the model has just been told is about to
                    // be dropped.
                    ToolOutcome::failed(
                        ToolFailure::Refused,
                        pending.refusal(&call.name, false, memory_calls),
                    )
                } else if call.name == COMPACT_TOOL
                    && compaction.strategy.offers_compact_tool(false)
                {
                    // Self-compaction: the model compacts its own window. Intercepted here — ahead
                    // of the plan-mode and FSM gates, exactly as `finish` is — because the loop owns
                    // the context model the tool cannot hold, and because a machine that meant to
                    // hold the agent in a state cannot hold it in a full window. The rewrite itself
                    // is deferred until this turn's results are all recorded.
                    match parse_compact_request(&call.arguments) {
                        Ok(request) => {
                            compact_request = Some(request);
                            ToolOutcome::ok(
                                "Your context will be compacted once this turn's tool results are                                  recorded; your next turn opens on the summarized window.",
                                "compact accepted",
                            )
                        }
                        Err(message) => ToolOutcome::failed(ToolFailure::InvalidArgument, message),
                    }
                } else if !code.enabled && ending_role.owns(&call.name) {
                    // An ending call. Intercepted here (like the delegation tools) and *before* the
                    // plan-mode/FSM gates, so — like its code-mode counterpart — it can end the
                    // session from a state those machines meant to hold. The declaration is built
                    // through the same [`Ending`] constructors the sandbox membrane uses, so a
                    // malformed one is refused in the same words whichever mode the agent runs in.
                    //
                    // When the ending is validated the commands run first: on success the
                    // declaration is captured and the session ends after this turn's results are
                    // recorded; on failure the tool result carries the validation output back and
                    // the session continues, so the model fixes the problem and declares again.
                    match parse_ending_call(&call.name, &call.arguments, ending_role) {
                        Err(message) => ToolOutcome::failed(ToolFailure::InvalidArgument, message),
                        Ok(declared) => {
                            let rejected = if completion.has_validation() {
                                completion::run_validation(
                                    completion.validation(),
                                    tool_ctx,
                                    &shell_offload,
                                    emitter,
                                )
                                .await
                            } else {
                                None
                            };
                            match rejected {
                                Some(feedback) => {
                                    ToolOutcome::failed(ToolFailure::Refused, feedback)
                                }
                                None => {
                                    declared_ending = Some(declared);
                                    ToolOutcome::ok(
                                        "Your session will end once this turn's tool results are \
                                         recorded.",
                                        format!("{} accepted", call.name),
                                    )
                                }
                            }
                        }
                    }
                } else if planning.offers_planning() && !plan_mode_offers(&call.name, in_plan_mode)
                {
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
                    // when it holds, and refuse the advance otherwise so the agent cannot skip
                    // ahead. A `plan-first` plan reset is captured here and applied after the turn's
                    // tool results are recorded, exactly like `submit_plan`.
                    let advance =
                        handle_advance_state(&mut fsm, &mut context, tool_ctx, emitter, call);
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
                // The reset drops the exploration thread, which is where anything the model
                // recorded during planning was visible; the pinned block has to be current
                // before it goes, exactly as at a compaction boundary.
                refresh_memory_block(&mut context, &memories);
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

            // An ending declared this turn: every tool result — including the ending call's — is
            // now recorded, so the conversation is valid and the session may end. Recorded as a
            // `Finished` turn (which never breaches).
            if let Some(ending) = declared_ending {
                let _ = agent_limits.record(TurnOutcome::Finished, &self.id);
                return LoopEnd {
                    status: STATUS_COMPLETED,
                    turns: turn + 1,
                    tokens: total_tokens,
                    cost: total_cost,
                    slot: self.slot.clone(),
                    final_text: Some(ending.final_text()),
                    ending: Some(ending),
                    limit: None,
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
                    apply_pending_compaction(
                        &mut context,
                        &compaction,
                        &memories,
                        RetainedCounts {
                            skills: skills.read_count() as u64,
                            tasks: tasks.count() as u64,
                            memories: memories.count() as u64,
                            issues: board.issue_count() as u64,
                        },
                        &request,
                        tool_ctx,
                        emitter,
                    )
                    .await;
                }
                (None, Some(pending)) => context.push(
                    GgContextSource::System,
                    Retention::Ephemeral,
                    Message::user(pending.unsatisfied(false, memory_calls)),
                ),
                (None, None) => {}
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
            breach,
            turn_bound,
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
            ending: None,
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
/// gg's [defaults](crate::limits) are written out exactly as they were in force — the error ceilings
/// a run left unset, and an absent turn ceiling recorded as `None` (unbounded) — because that is
/// what makes a default honest: "what ceiling was this run under?" has to be answerable from the
/// record, and a default that is recorded is not a hidden one. Everything else is `None` when the
/// ceiling is off, which is the same thing the declaration said.
fn recorded_limits(limits: &RunLimits) -> GgRunLimits {
    GgRunLimits {
        max_turns: limits.max_turns.map(|turns| turns as u64),
        max_runtime_secs: limits.max_runtime.map(|budget| budget.as_secs()),
        max_consecutive_errors: limits.max_consecutive_errors.map(u64::from),
        max_error_rate: limits.error_rate.map(|rate| rate.max_rate),
        error_rate_window: limits.error_rate.map(|rate| rate.window as u64),
        max_cost: limits.max_cost,
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

/// The agent-managed-context configuration threaded into the [turn loop](Agent::drive): whether the
/// capability is on and the shared thread [archive](ArchiveStore) that `archive_thread` fills
/// and `search_archive` reads.
#[derive(Clone)]
struct AmcSetup {
    /// Whether the [agent-managed-context](CAPABILITY_AGENT_MANAGED_CONTEXT) capability is on.
    /// When on the loop injects the per-turn fullness signal and applies the reclaim tools;
    /// off, it does neither (and the tools were never offered).
    enabled: bool,
    /// The shared thread archive the reclaim applies to. Bound to the same store the
    /// `search_archive` tool reads, so archived material is immediately searchable.
    archive: Arc<Mutex<ArchiveStore>>,
}

/// Whether — and how — an agent's opening context is seeded with the test case's
/// [provided files](Orchestrator::provided_files), the
/// [autoload-specifications](CAPABILITY_AUTOLOAD_SPECS) capability.
///
/// Resolved per agent from its own profile (autoload is a per-agent capability), so a run can
/// front-load the whole spec for one agent and let another read what it needs.
#[derive(Debug, Clone, Copy)]
struct AutoloadSetup {
    /// Whether this agent front-loads the provided files. When off (the default), the agent opens
    /// with only the build prompt and reads what it needs itself.
    enabled: bool,
    /// Whether the autoloaded views are **locked** — [pinned](Retention::Pinned) into the window,
    /// kept verbatim across every [compaction](crate::compaction) boundary and immune to
    /// [eviction](ContextModel::evict_file_views). Off, they are ordinary ephemeral file reads that
    /// compaction may summarize and agent-managed context may evict.
    locked: bool,
}

impl AutoloadSetup {
    /// Resolve the autoload behavior from `profile`: on when it enables
    /// [`CAPABILITY_AUTOLOAD_SPECS`], locked when that capability's exact
    /// [implementation](GgAgentConfig::capability) is [`AUTOLOAD_LOCKED_IMPL`] (the default, empty,
    /// or any unrecognized value leaves the views ephemeral).
    fn resolve(profile: &GgAgentConfig) -> Self {
        let enabled = profile.is_enabled(CAPABILITY_AUTOLOAD_SPECS);
        let locked = enabled
            && profile
                .capability(CAPABILITY_AUTOLOAD_SPECS)
                .and_then(|cap| cap.implementation.as_deref())
                .map(str::trim)
                == Some(AUTOLOAD_LOCKED_IMPL);
        Self { enabled, locked }
    }
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
    /// The execution timeout and linear-memory cap one program runs under, resolved from the
    /// capability's `timeoutSecs` / `maxMemoryBytes` params with their defaults.
    limits: SandboxLimits,
    /// The [healing](crate::healing) strategies armed for this run — the ablation lever that decides
    /// which malformations of a reply gg repairs before compiling it, and which it lets fail.
    healing: HealingConfig,
    /// How the assistant message this run *records* is derived from the model's reply — the reply as
    /// sent, or the healed program that ran. Governs only what the next turn re-reads, never whether a
    /// reply is healed before it runs. See [`AssistantMessageMode`](crate::healing::AssistantMessageMode).
    assistant_messages: AssistantMessageMode,
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
///    the [context-window-override](CAPABILITY_CONTEXT_WINDOW_OVERRIDE) capability's
///    [`PARAM_WINDOW_LIMIT`], when that capability is enabled. The override may only make the
///    window *smaller*: the model's real window is a hard limit, so a larger "override" is not
///    a configuration gg can honor — it is clamped rather than rejected, so a study that
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
    // The narrowing override is a property of the context-window-override capability's
    // configuration and applies only when that capability is enabled — a disabled override
    // records the window it *would* have narrowed to (keeping an ablation's on/off arms
    // symmetric) without narrowing anything. Execution ceilings moved to
    // `capabilitySet.limits`; this window narrowing stays a capability param because it is
    // genuinely a lever a study toggles, not a run-wide ceiling.
    let configured = set
        .root()
        .capability(CAPABILITY_CONTEXT_WINDOW_OVERRIDE)
        .filter(|capability| capability.enabled)
        .and_then(|capability| {
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
/// [`memories`](CAPABILITY_MEMORIES) capability is enabled, an enabled runtime with an empty store
/// organized by the [strategy](MemoryStrategy::resolve) its `implementation` names and bounded by
/// the [limits resolved](MemoryCaps::resolve) from the capability's params; otherwise a
/// [disabled](MemoriesRuntime::disabled) runtime (an ablation's off arm) that offers nothing.
fn resolve_memories(profile: &GgAgentConfig) -> MemoriesRuntime {
    if !profile.is_enabled(CAPABILITY_MEMORIES) {
        return MemoriesRuntime::disabled();
    }
    let capability = profile.capability(CAPABILITY_MEMORIES);
    let strategy =
        MemoryStrategy::resolve(capability.and_then(|cap| cap.implementation.as_deref()));
    let caps = capability
        .map(|cap| MemoryCaps::resolve(strategy, &cap.params))
        .unwrap_or_else(|| MemoryCaps::for_strategy(strategy));
    MemoriesRuntime::new(strategy, caps)
}

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
    if limits.is_empty() {
        format!("{shape}; unlimited.")
    } else {
        format!("{shape}, up to {}.", limits.join(", "))
    }
}

/// Build the run's [`TasksRuntime`] from the capability set: when the
/// [`tasks`](CAPABILITY_TASKS) capability is enabled, an enabled runtime with an empty task
/// DAG holding at most the [count resolved](resolve_max_tasks) from the capability's params;
/// otherwise a [disabled](TasksRuntime::disabled) runtime (an ablation's off arm) that
/// offers nothing.
fn resolve_tasks(profile: &GgAgentConfig) -> TasksRuntime {
    if !profile.is_enabled(CAPABILITY_TASKS) {
        return TasksRuntime::disabled();
    }
    let params = profile.capability(CAPABILITY_TASKS).map(|cap| &cap.params);
    let max_tasks = params
        .map(resolve_max_tasks)
        .unwrap_or(crate::tasks::DEFAULT_MAX_TASKS);
    let mode = params.map(resolve_task_mode).unwrap_or_default();
    TasksRuntime::with_mode(max_tasks, mode)
}

/// The [agent profile](GgAgentConfig) whose [project-management](CAPABILITY_PROJECT_MANAGEMENT)
/// configuration governs the run's **one shared board** — the first profile that has the capability
/// on, or `None` when no profile does and the run therefore has no board at all.
///
/// Read across every profile rather than off the [root](GgCapabilitySet::root) because the board is
/// run-global while the capability is per-agent: a set that puts project management on a dedicated
/// planning profile (a perfectly ordinary shape — the root need not be the agent that files work)
/// would otherwise offer that profile the board tools while the run around it had no board runtime,
/// no auto-dispatch, and no worktrees, so every issue it filed would sit on the board forever.
/// Mirrors how [`merge_agent_name`] reads the same capability's merge-agent param.
fn board_owner(set: &GgCapabilitySet) -> Option<&GgAgentConfig> {
    set.agents
        .iter()
        .find(|agent| agent.is_enabled(CAPABILITY_PROJECT_MANAGEMENT))
}

/// Build the run's [`BoardRuntime`] from the capability set: when some profile
/// [owns the board](board_owner), an enabled runtime with an empty board bounded by the
/// [caps resolved](BoardCaps::resolve) from that profile's capability params; otherwise a
/// [disabled](BoardRuntime::disabled) runtime (an ablation's off arm) that offers nothing.
fn resolve_board(set: &GgCapabilitySet) -> BoardRuntime {
    let Some(owner) = board_owner(set) else {
        return BoardRuntime::disabled();
    };
    let caps = owner
        .capability(CAPABILITY_PROJECT_MANAGEMENT)
        .map(|cap| BoardCaps::resolve(&cap.params))
        .unwrap_or_default();
    BoardRuntime::new(caps)
}

/// Resolve the run's git-backed [isolation and baseline](WorktreesSetup) at session start, reporting
/// on `emitter`.
///
/// Isolation is wanted whenever the run can produce a worktree: the
/// [project-management](CAPABILITY_PROJECT_MANAGEMENT) capability (every issue works in its own) or
/// the [speculative-execution](CAPABILITY_SPECULATIVE) capability (every attempt does). When neither
/// is on, git is left alone entirely — no baseline, no root.
///
/// Any problem — git absent, a failed baseline, or an uncreatable worktree root — is logged
/// **loudly** at error level and leaves isolation unusable (issues run in the shared workspace and
/// merge nothing; a `speculate` call is refused) rather than crashing the run.
fn resolve_worktrees(
    set: &GgCapabilitySet,
    workspace_dir: &Path,
    emitter: &Emitter,
) -> WorktreesSetup {
    let issues = board_owner(set).is_some();
    let speculative = set.is_enabled(CAPABILITY_SPECULATIVE);
    // A short, accurate description of why git is needed, for the diagnostics.
    let reason = match (issues, speculative) {
        (true, true) => "issues and speculation attempts each work in an isolated git worktree",
        (true, false) => "every issue works in an isolated git worktree",
        (false, true) => "every speculation attempt works in an isolated git worktree",
        (false, false) => "",
    };
    if !issues && !speculative {
        return WorktreesSetup {
            baseline_commit: None,
            root: None,
        };
    }

    if !git::git_available() {
        emitter.emit(log(
            "error",
            format!(
                "{reason}, but the `git` binary is not available; worktree isolation is disabled. \
                 Issues run directly in the shared workspace (nothing is merged, and reviews see an \
                 empty diff) and `speculate` is refused. (The rest of the run is unaffected.)"
            ),
        ));
        return WorktreesSetup {
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
            if issues {
                "Each issue is dispatched into its own worktree, merged back into the main tree \
                 once it is accepted."
            } else {
                "Each speculation attempt runs in its own worktree; only the winner is merged \
                 back."
            },
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
    /// The epic/issue board capability, for its ceilings.
    board: &'a BoardRuntime,
    /// The planning capability.
    planning: &'a PlanningRuntime,
    /// The FSM driving the run, when one does.
    fsm: &'a FsmRuntime,
    /// How much of a file one `read_file` call returns, so a capped run says so up front.
    read_policy: ReadPolicy,
    /// How much of a command's output one `shell` call returns, and where the rest of it is kept, so
    /// an offloading run tells the model where to grep before it needs to.
    shell_offload: &'a OffloadPolicy,
    /// This agent's model and the run's vision registry, so the prompt can state whether a
    /// reference image can actually be shown to it.
    vision: &'a VisionContext,
    /// Whether `speculate` is available this run.
    speculative: bool,
    /// Whether the run responds with programs rather than native tool calls.
    responses_as_code: bool,
    /// Whether this agent's opening context is pre-seeded with the test case's specifications and
    /// reference images ([autoload-specifications](CAPABILITY_AUTOLOAD_SPECS)), and if so whether
    /// they are **locked**: `None` off, `Some(false)` on, `Some(true)` on and locked. Gates the
    /// prompt section that tells the model the brief is already in its window.
    autoload_specs: Option<bool>,
    /// This agent's [profile](GgAgentConfig): the source of its operator custom instructions, its
    /// optional full-template override, and its [roster](GgAgentConfig::subagents) — the agents it
    /// may spawn, assign issues to, and name as reviewers (each enumerated in the prompt, scope by
    /// scope, so the model knows exactly which names each call accepts and why).
    profile: &'a GgAgentConfig,
    /// Which [ending calls](EndingRole) this agent has, so the prompt's ending section names the
    /// ones it can actually make and no others.
    ending_role: EndingRole,
    /// The [board issue](crate::board) this agent was dispatched to implement, when it was one.
    /// Renders the section that names the issue and tells the agent to record its work finished —
    /// the one thing gg needs from an implementer, and the thing it is not told anywhere else: its
    /// brief describes the work, not the protocol, and the board-authoring section it would have
    /// read the protocol from is (rightly) not rendered for a profile that may not author the board.
    assigned_issue: Option<&'a str>,
    /// Whether [healing](crate::healing)'s fence-stripping strategy is armed, which decides how the
    /// prompt states the no-code-fence rule — as a repair gg will make and disclose, or as a syntax
    /// error the model will be handed.
    fences_are_stripped: bool,
}

/// The system prompt for a run: the [system template](crate::prompts::render_system) for the run's
/// execution mode, rendered against the run's actual configuration.
///
/// Every capability section is gated on that capability being enabled, so the prompt describes
/// exactly what this run can do — the tools it offers (and, when it offers none, that the model
/// can only reply in text), the catalog of available [skills](crate::skills), and how to use the
/// [memories](crate::memories), [tasks](crate::tasks), [board](crate::board), and
/// [planning](crate::planning) capabilities, each stating that run's configured limits. A
/// disabled capability contributes nothing at all: no tools, no prose, no context.
/// The API objects a code program has this run, in a fixed display order, each with the one-line
/// description the prompt names it by.
///
/// An object appears exactly when the agent binds at least one of its functions — derived from the
/// enabled tools **and its [ending role](EndingRole)** through the
/// [signature catalogue](crate::sandbox::catalogue_functions), the same grouping the guest builds a
/// program's scope from — so a withheld capability drops its whole object rather than leaving a
/// named-but-empty one, and a reviewer is shown a `review` object where an implementer is not.
/// `harness` always appears, because it carries the documentation lookup, which nothing gates. The
/// descriptions are stable product surface authored here; the *functions* on each object are not
/// listed at all, because a model discovers those on demand with `object.list()` and `fn.docs()`.
fn api_views(registry: &ToolRegistry, role: EndingRole) -> Vec<ApiView> {
    const OBJECTS: &[(&str, &str)] = &[
        ("fs", "read, write, and edit workspace files"),
        ("system", "run shell commands in the workspace"),
        (
            "project",
            "the epic/issue board — decompose work into dispatchable issues",
        ),
        ("tasks", "your task list"),
        ("memory", "durable memories that survive context compaction"),
        ("context", "manage your own context window"),
        ("agents", "delegate work to child agents"),
        ("skills", "read authored skills"),
        ("harness", "read documentation"),
        (
            "review",
            "return your verdict on the work you are reviewing",
        ),
        ("judge", "name the attempt that wins"),
    ];
    let enabled: HashSet<String> = scope_tools(registry).into_iter().collect();
    let ending = match role {
        EndingRole::Standard => "standard",
        EndingRole::Review => "review",
        EndingRole::Judge { .. } => "judge",
    };
    let present: HashSet<&'static str> = crate::sandbox::catalogue_functions()
        .into_iter()
        .filter(|function| match (function.gate, function.ending) {
            (Some(tool), _) => enabled.contains(tool),
            (None, Some(role)) => role == ending,
            (None, None) => true,
        })
        .map(|function| function.object)
        .collect();
    OBJECTS
        .iter()
        .filter(|(object, _)| present.contains(object))
        .map(|(object, description)| ApiView {
            object: (*object).to_string(),
            description: (*description).to_string(),
        })
        .collect()
}

/// The [message headings](code_heading) a responses-as-code run documents in its system prompt, in
/// the order a model meets them: the four base headings every code run can show, then one per enabled
/// capability that synthesizes a message kind of its own.
///
/// Each heading string is read from [`code_heading`] rather than spelled out again, so the prompt and
/// the prefix a message actually carries cannot drift; this function owns only the *descriptions* and
/// the *gating*. A gate that is off drops its heading entirely — the model is never told about a
/// message kind this run cannot produce, matching every other section's ablation behaviour.
fn code_heading_views(
    memories: bool,
    tasks: bool,
    board: bool,
    plan: bool,
    files: bool,
) -> Vec<CodeHeadingView> {
    // (source, one-line description, whether this run can produce it). The heading word itself comes
    // from `code_heading(source)`, the single source of truth both this list and the prefix share.
    let rows: &[(GgContextSource, &str, bool)] = &[
        (
            GgContextSource::UserPrompt,
            "the task you are working on, or a message from a parent agent",
            true,
        ),
        (
            GgContextSource::ToolOutput,
            "the result of your last program — what it printed, and whether it ran, failed, or was \
             stopped",
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
            GgContextSource::Board,
            "the epic/issue board, as it currently stands",
            board,
        ),
        (
            GgContextSource::Plan,
            "your accepted plan, or plan-mode guidance",
            plan,
        ),
        (
            GgContextSource::FileView,
            "the contents of a file seeded into your context",
            files,
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
/// lists them: the target's name plus the caller-scoped description of when to use it.
fn roster(profile: &GgAgentConfig, scope: GgSubagentScope) -> Vec<SpawnableAgentView> {
    profile
        .subagents
        .iter()
        .filter(|reference| reference.has_scope(scope))
        .map(|reference| SpawnableAgentView {
            name: reference.agent.clone(),
            description: reference.description.clone(),
        })
        .collect()
}

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
        shell_offload,
        vision,
        speculative,
        responses_as_code,
        autoload_specs,
        profile,
        ending_role,
        assigned_issue,
        fences_are_stripped,
    } = inputs;

    // This agent's roster, split by what each entry may be used **for**. The three lists are
    // independent of one another and of the delegation capability: an agent with no `spawn_subagent`
    // still names implementers and reviewers on the issues it files, which is exactly why the
    // prompt's Subagents section is gated on the *tool* being offered rather than on the roster
    // being non-empty.
    let spawnable_agents = roster(profile, GgSubagentScope::Subagent);
    let issue_agents = roster(profile, GgSubagentScope::Implementer);
    let reviewer_agents = roster(profile, GgSubagentScope::Reviewer);
    let offers_spawn = registry.offers(SPAWN_SUBAGENT_TOOL);

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

    // What a `shell` call returns, stated only when the tool is offered *and* its output is
    // offloaded: under the default policy there is nothing to say that the tool's own description
    // does not already say. Under offloading there is — the model has to know that what it is
    // reading is a tail, and that the rest of it is a `grep` away rather than gone.
    let shell = match shell_offload
        .limits()
        .filter(|_| registry.offers(SHELL_TOOL))
    {
        Some(limits) => ShellView {
            offloaded: true,
            tail: limits.describe(),
            directory: limits.dir.display().to_string(),
        },
        None => ShellView::default(),
    };

    // The message headings this run can put in front of a synthesized `user` message — only under
    // responses-as-code, where the transcript is plain text and the model needs the vocabulary named
    // (the tool-calling path distinguishes message kinds by role). The base four are intrinsic to the
    // protocol; each remaining heading is listed exactly when the capability that produces its message
    // kind is on, so the prompt describes only what this run can actually show — the same ablation
    // discipline every other section follows.
    let code_headings = if responses_as_code {
        code_heading_views(
            memories.offers_memories(),
            tasks.offers_tasks(),
            board.offers_board(),
            planning.offers_planning() || fsm.is_active(),
            offers_read || autoload_specs.is_some(),
        )
    } else {
        Vec::new()
    };

    prompts::render_system(
        &SystemContext {
            responses_as_code,
            // The API objects the model can inspect — only under responses-as-code, where a program
            // reaches them by name; the tool-calling path puts the tools in the request instead.
            apis: if responses_as_code {
                api_views(registry, ending_role)
            } else {
                Vec::new()
            },
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
            fences_are_stripped,
            read_file,
            shell,
            skills: skills.prompt_entries(),
            // The strategy decides what the section says: what memory *is* on this run differs
            // enough between the three (all of it in the window, an index over it, or nothing
            // until you search) that they are three paragraphs rather than one with holes.
            memories: memories.offers_memories().then(|| {
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
                }
            }),
            tasks: tasks.offers_tasks().then(|| TasksView {
                max_tasks: tasks.max_tasks(),
            }),
            // The board-authoring section is gated on **this agent's own** capability, not on the
            // run having a board: the board is run-global, but describing how to file and dispatch
            // work to an agent whose profile offers none of those tools is a prompt that names
            // tools the model does not have — which is exactly how an implementer ends up reaching
            // for `create_issue` instead of doing the work it was sent to do.
            board: (board.offers_board() && profile.is_enabled(CAPABILITY_PROJECT_MANAGEMENT))
                .then(|| {
                    let caps = board.caps();
                    BoardView {
                        max_epics: caps.max_epics,
                        max_issues: caps.max_issues,
                        max_retries: caps.max_retries,
                        reviewers_required: IssuePolicy::resolve(profile).require_reviewers,
                        issue_agents,
                        reviewer_agents,
                    }
                }),
            // The issue this agent was dispatched to implement, when it was one — rendered
            // whatever its own capabilities are, since being told what it is working on has
            // nothing to do with whether it may author the board.
            assigned_issue: assigned_issue.map(|id| AssignedIssueView { id: id.to_string() }),
            planning: planning.offers_planning(),
            fsm: fsm.is_active().then(|| FsmView {
                machine: fsm.machine_name().to_string(),
            }),
            speculative,
            // On → a section telling the model the whole brief is already in its window; the
            // `locked` flag decides whether it also promises the material stays across compaction.
            autoload_specs: autoload_specs.map(|locked| AutoloadView { locked }),
            // How this agent ends its session — its role's calls, named the way this execution mode
            // writes them.
            ending: ending_view(ending_role, responses_as_code),
        },
        // A profile may override the whole prompt template; `None` uses the built-in one.
        profile.system_prompt_template.as_deref(),
    )
}

/// How this agent's ending section reads: which [role](EndingRole) it was dispatched in, and that
/// role's calls named the way `responses_as_code` writes them.
///
/// All four names are filled whatever the role. The templates render in strict mode, where a missing
/// variable is a render error, and three unread strings cost nothing against a prompt that fails.
fn ending_view(role: EndingRole, responses_as_code: bool) -> EndingView {
    // The grouped, object-qualified form a program writes, or the bare tool name a tool-calling
    // model requests. Taken from the signature catalogue's own object names, so the prompt and the
    // scope the guest builds cannot disagree about what a call is spelled.
    let call = |object: &str, code_name: &str, tool_name: &str| {
        if responses_as_code {
            format!("{object}.{code_name}")
        } else {
            tool_name.to_string()
        }
    };
    EndingView {
        standard: matches!(role, EndingRole::Standard),
        review: matches!(role, EndingRole::Review),
        judge: matches!(role, EndingRole::Judge { .. }),
        finish: call("harness", "finish", completion::FINISH_TOOL),
        approve: call("review", "approve", completion::APPROVE_TOOL),
        request_changes: call("review", "requestChanges", completion::REQUEST_CHANGES_TOOL),
        select_winner: call("judge", "selectWinner", completion::SELECT_WINNER_TOOL),
    }
}

/// The [ending calls](EndingRole) this agent may make, as it writes them — what the feedback for a
/// reply that was not a program points the model at, and the one place a role's calls are spelled for
/// a message that is not the system prompt.
fn ending_calls(role: EndingRole, responses_as_code: bool) -> Vec<String> {
    let view = ending_view(role, responses_as_code);
    match role {
        EndingRole::Standard => vec![view.finish],
        EndingRole::Review => vec![view.approve, view.request_changes],
        EndingRole::Judge { .. } => vec![view.select_winner],
    }
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

/// Seed `context` with the test case's [provided files](Orchestrator::provided_files) — its
/// specifications then its reference images — as though the agent had already `read_file`d each:
/// one synthesized `read_file` assistant call per file, immediately answered by the file's contents
/// (a [`FileView`](GgContextSource::FileView), image and all), so the model opens with the whole
/// brief already in the window. This is the [autoload-specifications](CAPABILITY_AUTOLOAD_SPECS)
/// capability's whole effect.
///
/// The files are read **whole** — an unlimited [`ReadPolicy`], independent of the run's own
/// `read_file` [line cap](ReadPolicy) — because the capability's promise is the *full* contents of
/// every spec, not a capped first window of it. Image handling is the read tool's own: a mockup is
/// attached as a picture when this agent's model can see one and described otherwise, so an
/// autoloaded reference behaves exactly like a read one. When `locked`, each view is
/// [`Pinned`](Retention::Pinned) so it survives compaction and eviction; otherwise the views are
/// ordinary ephemeral reads that compaction may summarize and agent-managed context may evict. The
/// synthesized assistant call is always ephemeral — only the file view is ever locked — mirroring
/// how a read skill pins the body but not the `read_skill` call that fetched it. A file that cannot
/// be read (a reference that failed to seed) is skipped with a warning rather than failing the run.
async fn autoload_specifications(
    context: &mut ContextModel,
    provided_files: &[PathBuf],
    tool_ctx: &ToolContext,
    locked: bool,
    emitter: &Emitter,
) {
    if provided_files.is_empty() {
        return;
    }
    let reader = ReadFileTool::new(ReadPolicy::Unlimited);
    let retention = if locked {
        Retention::Pinned
    } else {
        Retention::Ephemeral
    };
    for (index, path) in provided_files.iter().enumerate() {
        let rel = path.to_string_lossy().into_owned();
        let outcome = reader.invoke(json!({ "path": rel }), tool_ctx).await;
        if !outcome.ok {
            emitter.emit(log(
                "warn",
                format!("autoload skipped `{rel}`: {}", outcome.output),
            ));
            continue;
        }
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
            &call_id,
            outcome.output,
            outcome.images,
            retention,
        );
    }
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
/// turn would buy nothing and cost a copy of every memory per mutation. A compaction (or a
/// plan-mode reset) is where that stops being true: it sweeps the thread the model was reading
/// its memories out of, so the block has to be current *before* the sweep. Called just before
/// the rewrite for exactly that reason — the stale copy is superseded into the ephemeral history
/// the rewrite is about to discard, and the fresh one crosses in the pinned prefix.
fn refresh_memory_block(context: &mut ContextModel, memories: &MemoriesRuntime) {
    if memories.offers_memories() {
        context.replace_source(
            GgContextSource::Memory,
            Retention::Pinned,
            memories.context_block(),
        );
    }
}

/// Perform a compaction the agent's own turn has just supplied the material for — the shared tail
/// of all three [in-loop](PendingCompaction) strategies, in both execution modes.
///
/// It brings the pinned memory block up to date, re-reads whatever files the request named,
/// rewrites the window, emits the boundary's telemetry, and says on the operator's stream what was
/// reclaimed. Every caller has already decided *that* a compaction happens; this is the one place
/// it does.
async fn apply_pending_compaction(
    context: &mut ContextModel,
    setup: &CompactionSetup,
    memories: &MemoriesRuntime,
    retained: RetainedCounts,
    request: &CompactionRequest,
    tool_ctx: &ToolContext,
    emitter: &Emitter,
) {
    refresh_memory_block(context, memories);
    let files = restore_compact_files(&request.files, tool_ctx, emitter).await;
    let restored = files.len();
    let event = compaction::apply_compaction(
        context,
        setup,
        retained,
        request,
        files,
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
}

/// Record one tool call's outcome into the context, giving the memory-curation tools and
/// `read_skill` their special treatment:
///
/// - a successful `write_memory`/`update_memory`/`delete_memory` (the store was already
///   mutated by the tool) emits the [`MemoryRevision`](GgTelemetryKind::MemoryRevision)s it
///   produced and then the [`MemoryState`](GgTelemetryKind::MemoryState) the store is left in,
///   so the console has both the record of what was done and the set as it now stands; the
///   pinned [`Memory`](GgContextSource::Memory) block itself is rebuilt only at a compaction
///   boundary ([`refresh_memory_block`]). Its confirmation is ordinary ephemeral tool output;
/// - a successful `add_task`/`update_task`/`set_blocked_by`/`complete_task`/`remove_task`
///   likewise re-emits the [`TasksState`](GgTelemetryKind::TasksState); the pinned
///   [`TaskList`](GgContextSource::TaskList) block is rebuilt at the next turn boundary;
/// - a successful
///   `create_epic`/`create_issue`/`update_issue`/`set_issue_blocked_by`/`remove_epic`/`remove_issue`
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
    // enforcement); emit what it did and the set it left behind. The revisions come first: they
    // are the append-only record — including of a memory that was just deleted, which the
    // snapshot that follows can no longer show. The pinned memory block is not touched here, nor
    // at the next turn boundary; it is rebuilt at a compaction boundary (see
    // `refresh_memory_block`).
    if is_memory_tool(&call.name) && outcome.ok {
        for revision in memories.revision_events() {
            emitter.emit(revision);
        }
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

use code::{CodeTurn, CodeTurnOutcome, CodeTurnState, run_code_turn};

#[cfg(test)]
#[path = "agent.test.rs"]
mod tests;
