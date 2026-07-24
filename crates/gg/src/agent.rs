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
//! session ([`"completed"`](Agent::drive)).
//!
//! # Termination and error surfacing
//!
//! The loop always ends, and always says how in the
//! [`SessionEnded`](GgTelemetryKind::SessionEnded) status:
//!
//! - `"completed"` — the model stopped calling tools;
//! - `"exhausted"` — the per-run turn ceiling was reached;
//! - `"timed_out"` — the optional wall-clock deadline was passed;
//! - `"model_error"` — a model turn failed (retryable-exhausted **or** fatal). gg
//!   ends the session **loudly** — a `Log(error)` plus this status — never silently:
//!   a known failure mode of another harness is discarding a whole run on one API
//!   error, and gg's whole point is that the failure is visible in the stream;
//! - `"error"` — a launch failure (no bound slot, or the client could not resolve).
//!
//! Only a launch failure (`"error"`) exits the process non-zero; a session that ran
//! and ended for any other reason is a *run outcome* recorded in the telemetry, not a
//! process failure, and exits `0`.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::Value;
use test_cabinet_core::gg::{
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_CONTEXT_VISIBILITY, CAPABILITY_EPICS_ISSUES,
    CAPABILITY_MEMORIES, CAPABILITY_MULTI_MODEL, CAPABILITY_SKILLS, CAPABILITY_SUBAGENTS,
    CAPABILITY_TASKS, CAPABILITY_WORKFLOWS, CAPABILITY_WORKTREES, GgAgentStatus, GgCapabilitySet,
    GgContextAction, GgContextSource, GgPlanPhase, GgSlotBinding, GgTelemetryKind, GgWorkflowPhase,
    PRIMARY_SLOT,
};
use test_cabinet_core::metrics::{Cost, TokenCounts};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

use crate::archive::ArchiveStore;
use crate::board::{BoardCaps, BoardRuntime};
use crate::client::{ClientFactory, DefaultClientFactory, provider_for};
use crate::compaction::{CompactionSetup, RetainedCounts, compact_if_needed};
use crate::config::GgInvocation;
use crate::context::{
    BpeTokenEstimator, ContextModel, Retention, TokenEstimator, tool_output_source,
};
use crate::git;
use crate::memories::{MemoriesRuntime, MemoryCaps};
use crate::model::{Message, ModelClient, ModelResponse, ToolCall, ToolDefinition};
use crate::planning::PlanningRuntime;
use crate::skills::{DEFAULT_SKILLS_DIR, ReadRecord, SkillLibrary, SkillsRuntime};
use crate::subagents::{AgentCtx, AgentReturn, ChildHandle, ParentWait, Scheduler, SubagentConfig};
use crate::tasks::{TasksRuntime, resolve_max_tasks};
use crate::telemetry::Emitter;
use crate::tools::{
    ARCHIVE_THREAD_TOOL, DEFAULT_ARCHIVE_KEEP_RECENT, ENTER_PLAN_MODE_TOOL, EVICT_FILE_VIEW_TOOL,
    READ_SKILL_TOOL, RUN_WORKFLOW_TOOL, RuntimeSet, SEND_MESSAGE_TOOL, SPAWN_SUBAGENT_TOOL,
    SUBMIT_PLAN_TOOL, ToolContext, ToolOutcome, ToolRegistry, WAIT_FOR_SUBAGENTS_TOOL,
    is_board_tool, is_context_reclaim_tool, is_memory_tool, is_planning_tool, is_subagent_tool,
    is_task_tool, parse_archive_keep_recent, parse_evict_path, plan_mode_offers,
};

/// The default per-run turn ceiling, used when no `maxTurns` capability param sets
/// one. Bounds a runaway loop so a session always terminates cleanly.
const DEFAULT_MAX_TURNS: usize = 50;

/// Capability param naming the per-run turn ceiling (read from any capability that
/// carries it). A value of `0` or a non-integer is ignored in favor of the default.
const PARAM_MAX_TURNS: &str = "maxTurns";

/// Capability param naming a self-imposed wall-clock budget in seconds. gg is also
/// wrapped in an external runtime cap by `core`; this is a belt-and-suspenders bound
/// so a runaway loop ends with `"timed_out"` rather than being killed from outside.
const PARAM_MAX_RUNTIME_SECS: &str = "maxRuntimeSecs";

/// Context-visibility capability param naming the active model's context-window limit
/// in tokens. When present it overrides the [built-in table](builtin_window_for); a
/// value of `0` or a non-integer is ignored.
const PARAM_WINDOW_LIMIT: &str = "windowLimit";

/// Skills capability param naming the directory authored skills are loaded from. A
/// relative value is resolved against the run workspace; an absolute one is used as
/// given. When absent, [`DEFAULT_SKILLS_DIR`] under the workspace is used.
const PARAM_SKILLS_DIR: &str = "dir";

/// The context-window limit assumed when neither the [`PARAM_WINDOW_LIMIT`] param nor
/// the [built-in table](builtin_window_for) resolves one. A conservative modern default
/// (128k) — the accounting is an estimate and the exact figure only sets the fullness
/// denominator, so a run without a configured window still reports a plausible ratio.
const DEFAULT_CONTEXT_WINDOW: u64 = 128_000;

/// The base system prompt seeding the loop. The available tools are appended per run
/// (see [`system_prompt`]) so the prompt reflects the enabled capabilities.
const GG_SYSTEM_PROMPT_BASE: &str = "You are gg, The Test Cabinet's autonomous coding agent. \
    You are building a game in the current workspace directory. Work incrementally: inspect \
    the workspace, then create and edit files to implement the game the user describes. When \
    the game is complete and the task is done, stop calling tools and give a short final \
    summary of what you built.";

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
    /// The invocation could not launch a session (no bound `primary` slot, or the
    /// client could not be resolved — for example a missing credential). The process
    /// exits non-zero.
    LaunchFailed,
}

/// The stable id of the **root** agent — the top of the [subagent
/// tree](https://docs.testcabinet.ai/gg/subagents/), created from the run invocation. A
/// single-agent run has only this agent; Phase 4B gives spawned subagents generated ids
/// beneath it.
pub const ROOT_AGENT_ID: &str = "root";

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
/// validation and the root's client resolution — the only two [launch failures](SessionOutcome)),
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
    root_emitter.emit(GgTelemetryKind::SessionStarted {});

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

    // Launch check 2: the root's model client must resolve (a missing credential fails here). A
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
    // model factory, the shared skills library and token estimator, the resolved bounds/deadline,
    // the worktree isolation state, and the spawned-task registry the session joins on before ending.
    let orch = Arc::new(Orchestrator::build(
        invocation,
        emitter,
        factory,
        multi_model,
        worktrees,
    ));

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
            status = if end.status == "model_error" {
                "failed"
            } else {
                "done"
            }
        ),
    ));
    root_emitter.emit(session_ended(end.status));
    SessionOutcome::Ran
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
    /// Serializes every git operation on the shared repository (worktree add/merge/remove), since
    /// concurrently-finishing subagents would otherwise race on `.git` and the main working tree.
    /// Held only across the synchronous git calls, never across an await.
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
    /// The resolved loop bounds shared by every agent.
    bounds: LoopBounds,
    /// The optional shared wall-clock deadline (from run start) every agent stops at.
    deadline: Option<Instant>,
    /// The join handles of every spawned subagent task, drained and awaited before the session
    /// ends. Guarded so concurrently-spawning agents can register their children.
    tasks: Mutex<Vec<JoinHandle<()>>>,
    /// A monotonic counter minting unique subagent ids.
    next_seq: AtomicU64,
    /// A monotonic counter minting unique [workflow](run_workflow) ids, so each `run_workflow`
    /// invocation's stages group under one id in the telemetry.
    next_workflow_seq: AtomicU64,
}

impl Orchestrator {
    /// Build the orchestrator for `invocation`, loading the shared skills library and token
    /// estimator once and resolving the run-wide bounds/deadline and subagent caps.
    fn build(
        invocation: &GgInvocation,
        emitter: &Emitter,
        factory: Arc<dyn ClientFactory>,
        multi_model: bool,
        worktrees: WorktreesSetup,
    ) -> Self {
        let set = &invocation.capability_set;
        // Load the skills library once (empty when the capability is off or nothing is seeded) and
        // share its Arc across agents; each agent keeps its own read-state runtime over it.
        let skills = resolve_skills(set, &invocation.workspace_dir);
        let bounds = resolve_bounds(set);
        let deadline = bounds
            .max_runtime_secs
            .map(|secs| Instant::now() + Duration::from_secs(secs));
        Self {
            caps: set.clone(),
            workspace_dir: invocation.workspace_dir.clone(),
            prompt: invocation.prompt.clone(),
            multi_model,
            subagents_enabled: set.is_enabled(CAPABILITY_SUBAGENTS),
            workflows_enabled: set.is_enabled(CAPABILITY_WORKFLOWS),
            worktrees_capability: worktrees.capability,
            worktrees_root: worktrees.root,
            baseline_commit: worktrees.baseline_commit,
            git_lock: Mutex::new(()),
            config: SubagentConfig::resolve(set),
            scheduler: Scheduler::new(SubagentConfig::resolve(set).max_parallel),
            accounting: Mutex::new(SlotAccounting::default()),
            base_emitter: emitter.clone(),
            factory,
            skills_library: skills.library(),
            skills_enabled: set.is_enabled(CAPABILITY_SKILLS),
            estimator: Arc::new(BpeTokenEstimator::new()),
            bounds,
            deadline,
            tasks: Mutex::new(Vec::new()),
            next_seq: AtomicU64::new(0),
            next_workflow_seq: AtomicU64::new(0),
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
            window_limit: resolve_window_limit(&self.caps, model_id),
            emit_breakdown: self.caps.is_enabled(CAPABILITY_CONTEXT_VISIBILITY),
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

    /// The run's [baseline commit](Self::baseline_commit) sha — the seeded workspace committed at
    /// session start when the worktrees capability made the workspace a git repo — or `None` when
    /// worktrees are off or no baseline could be committed.
    ///
    /// This is the "original commit for the run" that Phase 5
    /// [Code Reviews](https://docs.testcabinet.ai/gg/code-reviews/) diff against; exposed here so
    /// that phase reuses the recorded sha rather than recomputing it. (Unused until Phase 5.)
    #[allow(dead_code)]
    fn baseline_commit(&self) -> Option<&str> {
        self.baseline_commit.as_deref()
    }
}

/// How an agent driven by [`run_agent`] is dispatched: the [`Root`](Self::Root) driven by the
/// run's build prompt, or a [`Sub`](Self::Sub)agent driven by a delegated brief and wired to
/// signal its spawner on completion.
enum AgentRole {
    /// The root agent, driven by the run's build prompt.
    Root,
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

/// An isolated [git worktree](https://docs.testcabinet.ai/gg/worktrees/) a subagent runs in: its
/// per-agent branch and checkout path.
///
/// Created at [spawn time](make_worktree) (a `git worktree add` on a fresh branch based at the
/// [baseline](Orchestrator::baseline_commit)) so the subagent gets a private copy of the workspace
/// to mutate; [reconciled](reconcile_worktree) — merged back or discarded — and torn down when the
/// subagent finishes.
struct Worktree {
    /// The per-agent branch the worktree checks out (for example `gg/agent-3`).
    branch: String,
    /// The worktree's checkout directory — the subagent's rooted workspace while it runs.
    path: PathBuf,
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

    // Announce this agent to the tree: its slot/model, depth, (for a subagent) the brief it was
    // dispatched with, and the isolated worktree branch it runs in when it was dispatched with one.
    // The root carries no brief (it is driven by the build prompt) and always runs in the main tree.
    let brief = match &role {
        AgentRole::Sub { brief, .. } => Some(brief.clone()),
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
    // The running transition is only meaningful (and only emitted) when delegation is on (subagents
    // or workflows) — it is what animates the live tree.
    if orch.delegation_enabled() {
        emitter.emit(agent_status(GgAgentStatus::Running));
    }

    // Build this agent's resources the same way for every agent. The runtimes (memories, tasks,
    // board, planning) and the archive are per-agent (a subagent has its own scratchpad/board);
    // the skills library and estimator are shared through the orchestrator.
    let skills = orch.skills_runtime();
    let memories = resolve_memories(&orch.caps);
    let tasks = resolve_tasks(&orch.caps);
    let board = resolve_board(&orch.caps);
    let planning = PlanningRuntime::resolve(&orch.caps);
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
    let tool_ctx = ToolContext::new(workspace_dir);

    // Announce the run's configuration once, on the root's stream, so the console shows the enabled
    // capabilities from the start; subagents inherit the same configuration and stay quiet.
    if is_root {
        announce_configuration(
            emitter, &registry, &skills, &memories, &tasks, &board, &planning,
        );
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
                compaction.policy.trigger_fullness * 100.0
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

    let prompt = match &role {
        AgentRole::Root => orch.prompt.clone(),
        AgentRole::Sub { brief, .. } => brief.clone(),
    };

    let end = agent
        .drive(
            client.as_ref(),
            &prompt,
            &registry,
            &tool_ctx,
            emitter,
            orch.bounds.max_turns,
            orch.deadline,
            context_setup,
            compaction,
            amc,
            skills,
            memories,
            tasks,
            board,
            planning,
            subagent_context,
        )
        .await;

    // Fold this agent's usage into the shared per-slot accounting.
    orch.accounting
        .lock()
        .expect("slot accounting lock")
        .record(&end.slot, &model_id, end.tokens, end.cost);

    let failed = end.status == "model_error";
    if orch.delegation_enabled() {
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

            // Reconcile an isolated worktree back into the main tree before returning: a cleanly
            // completed subagent's work is merged back; anything else is discarded; and the worktree
            // is torn down either way. A merge conflict (or failure) is surfaced — appended to the
            // return value the spawner sees and emitted as a `WorktreeMerged` outcome — never
            // silently dropped.
            if let Some(wt) = worktree {
                let succeeded = end.status == "completed";
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
fn announce_configuration(
    emitter: &Emitter,
    registry: &ToolRegistry,
    skills: &SkillsRuntime,
    memories: &MemoriesRuntime,
    tasks: &TasksRuntime,
    board: &BoardRuntime,
    planning: &PlanningRuntime,
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
    board: &BoardRuntime,
    emitter: &Emitter,
    call: &ToolCall,
) -> ToolOutcome {
    match call.name.as_str() {
        SPAWN_SUBAGENT_TOOL => spawn_subagent(sub, spawner, board, &call.arguments),
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
fn spawn_subagent(
    sub: &mut SubagentContext,
    spawner: &Agent,
    board: &BoardRuntime,
    args: &Value,
) -> ToolOutcome {
    // The brief comes from a dispatched board issue (its structured scope is the brief) or from a
    // free-form `prompt`.
    let (brief, issue_id) = match args.get("issueId").and_then(Value::as_str) {
        Some(issue_id) if !issue_id.trim().is_empty() => {
            let issue_id = issue_id.trim().to_string();
            match board.issue_brief(&issue_id) {
                Some(brief) => (brief, Some(issue_id)),
                None => {
                    return ToolOutcome::error(format!(
                        "cannot dispatch issue `{issue_id}`: no such issue is on your board (or \
                         you have no board). Create it with `create_issue`, or pass a `prompt` \
                         instead."
                    ));
                }
            }
        }
        _ => match args.get("prompt").and_then(Value::as_str) {
            Some(prompt) if !prompt.trim().is_empty() => (prompt.trim().to_string(), None),
            _ => {
                return ToolOutcome::error(
                    "spawn_subagent needs a non-empty `prompt` (the subagent's brief) or an \
                     `issueId` to dispatch."
                        .to_string(),
                );
            }
        },
    };

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

    match dispatch_child(sub, spawner, brief, issue_id, requested_slot, want_worktree) {
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
        }
        Err(err) => ToolOutcome::error(err),
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
    want_worktree: bool,
) -> Result<DispatchedChild, String> {
    let orch = &sub.orch;

    // Depth cap: a structural refusal, not a queue. An agent at the max depth cannot delegate
    // deeper — it must do the work itself.
    if spawner.depth >= orch.config.max_depth {
        return Err(format!(
            "cannot spawn a subagent: you are at the maximum delegation depth ({}), so you must \
             do this work yourself rather than delegating deeper.",
            orch.config.max_depth
        ));
    }

    // The requested slot, collapsed to primary when multi-model is off.
    let slot = effective_slot(requested_slot, orch.multi_model).to_string();
    let binding = slot_binding(&orch.caps, &slot)
        .map_err(|err| format!("cannot spawn on the `{slot}` slot: {err}"))?
        .clone();
    let client = orch.factory.client_for(&binding).map_err(|err| {
        format!(
            "cannot spawn on the `{slot}` slot (model `{}`): {err}",
            binding.model_id
        )
    })?;
    let model_id = client.model_id().to_string();

    // Build the child's identity, wiring, and role, then schedule it. The child clones the
    // spawner's `ParentWait` so it can signal completion back up.
    let child_id = orch.next_agent_id();

    // Optional worktree isolation — a *dispatch property*. When requested, create a fresh git
    // worktree on a per-agent branch (based at the run baseline); the child's tools are then rooted
    // there and its work is reconciled when it finishes. A request without the capability (or with
    // git unavailable) is refused with guidance rather than silently ignored, so an ablation's off
    // arm is unambiguous.
    let worktree = if want_worktree {
        Some(make_worktree(orch, &child_id)?)
    } else {
        None
    };
    let worktree_branch = worktree.as_ref().map(|wt| wt.branch.clone());

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
fn make_worktree(orch: &Orchestrator, child_id: &str) -> Result<Worktree, String> {
    if !orch.worktrees_capability {
        return Err(
            "cannot dispatch this subagent in a worktree: the `worktrees` capability is not \
             enabled for this run. Spawn without `worktree: true` to run in the shared workspace."
                .to_string(),
        );
    }
    let (root, base) = match (&orch.worktrees_root, &orch.baseline_commit) {
        (Some(root), Some(base)) => (root, base),
        _ => {
            return Err(
                "cannot dispatch this subagent in a worktree: worktree isolation is unavailable \
                 this run (git could not initialize a workspace baseline at startup). Spawn \
                 without `worktree: true` to run in the shared workspace."
                    .to_string(),
            );
        }
    };
    let branch = format!("gg/{child_id}");
    let path = root.join(child_id);
    let _guard = orch.git_lock.lock().expect("git lock");
    git::add_worktree(&orch.workspace_dir, &path, &branch, base)
        .map_err(|err| format!("could not create an isolated worktree for the subagent: {err}"))?;
    Ok(Worktree { branch, path })
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
                            return ToolOutcome::error(format!(
                                "`{id}` is not one of your subagents; you can only wait for agents \
                                 you spawned."
                            ));
                        }
                        ids.push(id.to_string());
                    }
                    None => {
                        return ToolOutcome::error(
                            "each entry in `ids` must be a subagent id string.".to_string(),
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
            return ToolOutcome::error(
                "`ids` must be an array of subagent id strings (or omit it to wait for all)."
                    .to_string(),
            );
        }
    };

    if awaited_ids.is_empty() {
        return ToolOutcome::ok(
            "You have no outstanding subagents to wait for.",
            "no subagents to wait for",
        );
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

    ToolOutcome::ok(
        format!(
            "Collected {} subagent result(s):\n\n{}",
            collected.len(),
            lines.join("\n\n")
        ),
        format!("collected {} subagent result(s)", collected.len()),
    )
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
        _ => return ToolOutcome::error("send_message needs a non-empty `agentId`.".to_string()),
    };
    let message = match args.get("message").and_then(Value::as_str) {
        Some(message) if !message.trim().is_empty() => message.to_string(),
        _ => return ToolOutcome::error("send_message needs a non-empty `message`.".to_string()),
    };
    match sub.ctx.children.iter().find(|c| c.id == agent_id) {
        None => ToolOutcome::error(format!(
            "`{agent_id}` is not one of your subagents; you can only message agents you spawned."
        )),
        Some(child) if child.is_finished() => ToolOutcome::error(format!(
            "subagent `{agent_id}` has already returned; you cannot message it."
        )),
        Some(child) => match child.inbox.send(message) {
            Ok(()) => ToolOutcome::ok(
                format!(
                    "Sent your message to subagent `{agent_id}`; it will receive it at its next \
                     turn."
                ),
                format!("messaged subagent `{agent_id}`"),
            ),
            Err(_) => ToolOutcome::error(format!(
                "subagent `{agent_id}` is no longer receiving messages (it has returned)."
            )),
        },
    }
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
        Err(err) => return ToolOutcome::error(err),
    };

    // Depth cap up front: every fanned-out agent is `spawner.depth + 1`, so an agent already at the
    // max depth cannot run a workflow at all — refuse the whole thing rather than failing on the
    // first stage's first dispatch.
    if spawner.depth >= sub.orch.config.max_depth {
        return ToolOutcome::error(format!(
            "cannot run a workflow: you are at the maximum delegation depth ({}), so a workflow's \
             subagents (which run one level deeper) cannot be spawned. Do this work yourself.",
            sub.orch.config.max_depth
        ));
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
                    return ToolOutcome::error(format!(
                        "workflow stage `{}` (the first stage) has no `items` to fan out over; the \
                         first stage must list its items.",
                        stage.name
                    ));
                }
                prior_results.clone()
            }
        };
        if items.is_empty() {
            return ToolOutcome::error(format!(
                "workflow stage `{}` has no items to fan out over (the previous stage produced no \
                 results to feed it).",
                stage.name
            ));
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
            match dispatch_child(sub, spawner, brief, None, &stage.slot, stage.worktree) {
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
                    return ToolOutcome::error(format!(
                        "workflow stage `{}` could not dispatch a subagent: {err}",
                        stage.name
                    ));
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
    /// The agent's **final assistant message** — the last natural-language text it produced. For a
    /// subagent this is its [return value](AgentReturn) to its spawner; `None` when the loop
    /// produced no assistant text (for example an immediate timeout).
    final_text: Option<String>,
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
    /// hit, or a turn errors. A `deadline` (when set) ends the loop with `"timed_out"` at
    /// the next turn boundary once passed.
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
        max_turns: usize,
        deadline: Option<Instant>,
        context_setup: ContextSetup,
        compaction: CompactionSetup,
        amc: AmcSetup,
        mut skills: SkillsRuntime,
        memories: MemoriesRuntime,
        tasks: TasksRuntime,
        board: BoardRuntime,
        planning: PlanningRuntime,
        mut subagents: Option<SubagentContext>,
    ) -> LoopEnd {
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
        context.push_system(system_prompt(
            registry, &skills, &memories, &tasks, &board, &planning,
        ));
        context.push_user_prompt(prompt);

        let mut total_tokens = TokenCounts::default();
        let mut total_cost: Option<Cost> = None;
        // The last natural-language assistant message, carried out as this agent's final text (a
        // subagent's return value to its spawner).
        let mut last_text: Option<String> = None;
        // Plan mode is loop state: while `true`, the offered toolset is restricted to read-only
        // tools (plus `submit_plan`). It flips on a successful `enter_plan_mode` and back off once a
        // submitted plan has seeded the fresh implementation context. Only meaningful when planning
        // is enabled.
        let mut in_plan_mode = false;

        for turn in 0..max_turns {
            // Stop cleanly at a turn boundary once the self-imposed budget is spent.
            if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
                emitter.emit(log(
                    "warn",
                    format!("wall-clock budget exceeded after {turn} turn(s); stopping."),
                ));
                return LoopEnd {
                    status: "timed_out",
                    turns: turn,
                    tokens: total_tokens,
                    cost: total_cost,
                    slot: self.slot.clone(),
                    final_text: last_text,
                };
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

            // The offered toolset for this turn. In plan mode gg restricts it to the read-only
            // tools (plus `submit_plan`, the way out); otherwise the whole set is offered. The same
            // predicate guards dispatch below, so what the model is shown and what it may run agree.
            let tools: Vec<ToolDefinition> = if planning.offers_planning() {
                all_tools
                    .iter()
                    .filter(|tool| plan_mode_offers(&tool.name, in_plan_mode))
                    .cloned()
                    .collect()
            } else {
                all_tools.clone()
            };

            // The context for this turn is fully assembled (every prior item is in the
            // model). Emit its per-source breakdown when context visibility is on; the
            // accounting itself was computed regardless.
            if context_setup.emit_breakdown {
                emitter.emit(context.breakdown_event());
            }

            let response = match client.complete(&context.messages(), &tools).await {
                Ok(response) => response,
                Err(err) => {
                    // Surface the failure loudly — a `Log(error)` and a `model_error`
                    // session end — rather than discarding the run silently. A
                    // retry-exhausted transient failure and a fatal one both end the
                    // session here; the client has already exhausted its own retries, so
                    // there is nothing left to retry at the turn level in Phase 0.
                    let kind = if err.is_retryable_exhausted() {
                        "transient failure (retries exhausted)"
                    } else {
                        "fatal error"
                    };
                    emitter.emit(log(
                        "error",
                        format!("model turn {turn} failed — {kind}: {err}"),
                    ));
                    return LoopEnd {
                        status: "model_error",
                        turns: turn,
                        tokens: total_tokens,
                        cost: total_cost,
                        slot: self.slot.clone(),
                        final_text: last_text,
                    };
                }
            };

            record_usage(&response, emitter);
            total_tokens = add_counts(total_tokens, response.usage);
            total_cost = add_cost(total_cost, response.cost);

            if let Some(text) = &response.text {
                emitter.emit(GgTelemetryKind::AssistantMessage { text: text.clone() });
                last_text = Some(text.clone());
            }

            // Record the assistant turn (text + any tool calls) into the context.
            context.push_assistant(response.text.clone(), response.tool_calls.clone());

            if response.tool_calls.is_empty() {
                return LoopEnd {
                    status: "completed",
                    turns: turn + 1,
                    tokens: total_tokens,
                    cost: total_cost,
                    slot: self.slot.clone(),
                    final_text: last_text,
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

                // In plan mode the loop is read-only: a tool the plan-mode filter withheld is
                // refused here too (a defensive guard — the model was not offered it) with guidance,
                // rather than dispatched. Outside plan mode this only ever withholds `submit_plan`.
                // A subagent tool is intercepted here (never routed through `registry.dispatch`,
                // whose registered validators are defensive placeholders): the loop performs the
                // spawn/wait/message against the orchestrator, which the tools cannot reach.
                let mut outcome =
                    if planning.offers_planning() && !plan_mode_offers(&call.name, in_plan_mode) {
                        ToolOutcome::error(plan_mode_refusal(&call.name, in_plan_mode))
                    } else if let Some(sub) = subagents.as_mut()
                        && is_subagent_tool(&call.name)
                    {
                        handle_subagent_call(sub, self, &board, emitter, call).await
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

            // A plan was submitted this turn: clear the exploration history (keeping the pinned
            // prefix — system, original prompt, skills, memories, tasks, board) via the shared
            // context-reset primitive, seed the fresh implementation context with the framed plan as
            // a pinned item, leave plan mode, and restore the full toolset for the next turn.
            if let Some(plan) = submitted_plan {
                in_plan_mode = false;
                context.clear_ephemeral();
                context.push(
                    GgContextSource::Plan,
                    Retention::Pinned,
                    crate::model::Message::user(planning.frame_plan(&plan)),
                );
                emitter.emit(GgTelemetryKind::Planning {
                    phase: GgPlanPhase::Implementing,
                    plan: Some(plan),
                });
            }
        }

        emitter.emit(log(
            "warn",
            format!("reached the {max_turns}-turn ceiling without the model finishing."),
        ));
        LoopEnd {
            status: "exhausted",
            turns: max_turns,
            tokens: total_tokens,
            cost: total_cost,
            slot: self.slot.clone(),
            final_text: last_text,
        }
    }
}

/// The resolved per-run loop bounds, read from the capability set's params.
struct LoopBounds {
    /// The turn ceiling.
    max_turns: usize,
    /// A self-imposed wall-clock budget in seconds, when configured.
    max_runtime_secs: Option<u64>,
}

/// Resolve the loop bounds from `set`'s capability params, falling back to the
/// defaults. `maxTurns`/`maxRuntimeSecs` may live on any capability; the first that
/// carries a positive integer wins. Pure, so the resolution is unit tested directly.
fn resolve_bounds(set: &GgCapabilitySet) -> LoopBounds {
    let max_turns = param_u64(set, PARAM_MAX_TURNS)
        .filter(|&n| n > 0)
        .map(|n| n as usize)
        .unwrap_or(DEFAULT_MAX_TURNS);
    let max_runtime_secs = param_u64(set, PARAM_MAX_RUNTIME_SECS).filter(|&n| n > 0);
    LoopBounds {
        max_turns,
        max_runtime_secs,
    }
}

/// The first positive-integer value of `key` found across any capability's params.
fn param_u64(set: &GgCapabilitySet, key: &str) -> Option<u64> {
    set.capabilities
        .iter()
        .find_map(|capability| capability.params.get(key).and_then(Value::as_u64))
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

/// Apply an agent-managed-context reclaim tool (`evict_file_view` or `archive_thread`) to the
/// live `context`: perform the reclaim, rewrite `outcome` with what was reclaimed (the tool's
/// own `invoke` only validated the arguments), and return the
/// [`ContextManaged`](GgTelemetryKind::ContextManaged) effect event to emit.
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
            );
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
            *outcome = ToolOutcome::ok(detail.clone(), format!("archived {count} thread item(s)"));
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

/// Resolve the active model's context-window limit for the fullness ratio: an explicit
/// [`PARAM_WINDOW_LIMIT`] on the context-visibility capability wins, else the
/// [built-in per-model table](builtin_window_for), else [`DEFAULT_CONTEXT_WINDOW`]. The
/// limit is always known (the default backstops it); it is an [`Option`] on the wire so
/// a future estimator can report "unknown" without a schema change.
fn resolve_window_limit(set: &GgCapabilitySet, model_id: &str) -> Option<u64> {
    if let Some(limit) = set
        .capability(CAPABILITY_CONTEXT_VISIBILITY)
        .and_then(|cap| cap.params.get(PARAM_WINDOW_LIMIT))
        .and_then(Value::as_u64)
        .filter(|&n| n > 0)
    {
        return Some(limit);
    }
    Some(builtin_window_for(model_id).unwrap_or(DEFAULT_CONTEXT_WINDOW))
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
    let max_tasks = set
        .capability(CAPABILITY_TASKS)
        .map(|cap| resolve_max_tasks(&cap.params))
        .unwrap_or(crate::tasks::DEFAULT_MAX_TASKS);
    TasksRuntime::new(max_tasks)
}

/// Build the run's [`BoardRuntime`] from the capability set: when the
/// [`epics-and-issues`](CAPABILITY_EPICS_ISSUES) capability is enabled, an enabled runtime with
/// an empty board bounded by the [caps resolved](BoardCaps::resolve) from the capability's
/// params; otherwise a [disabled](BoardRuntime::disabled) runtime (an ablation's off arm) that
/// offers nothing.
fn resolve_board(set: &GgCapabilitySet) -> BoardRuntime {
    if !set.is_enabled(CAPABILITY_EPICS_ISSUES) {
        return BoardRuntime::disabled();
    }
    let caps = set
        .capability(CAPABILITY_EPICS_ISSUES)
        .map(|cap| BoardCaps::resolve(&cap.params))
        .unwrap_or_default();
    BoardRuntime::new(caps)
}

/// Resolve the run's [worktree isolation](WorktreesSetup) at session start, reporting on `emitter`.
///
/// When the [worktrees](CAPABILITY_WORKTREES) capability is off, isolation is inert (no baseline,
/// no root). When it is on, gg checks for git, [commits the baseline](git::ensure_baseline) of the
/// seeded workspace (the commit Phase 5 Code Reviews diff against and every worktree branches
/// from), and creates the [worktree root](worktrees_root_for) alongside the workspace. Any
/// problem — git absent, a failed baseline, or an uncreatable root — is logged **loudly** at error
/// level and leaves isolation unusable (a later `worktree: true` spawn is refused with a clear
/// message) rather than crashing the run; a committed baseline is still recorded even if the root
/// could not be created, so Phase 5 can reuse it.
fn resolve_worktrees(
    set: &GgCapabilitySet,
    workspace_dir: &Path,
    emitter: &Emitter,
) -> WorktreesSetup {
    let capability = set.is_enabled(CAPABILITY_WORKTREES);
    if !capability {
        return WorktreesSetup {
            capability: false,
            baseline_commit: None,
            root: None,
        };
    }

    if !git::git_available() {
        emitter.emit(log(
            "error",
            "the `worktrees` capability is enabled but the `git` binary is not available; \
             worktree isolation is disabled for this run and any `worktree: true` spawn will be \
             refused. (The rest of the run is unaffected.)",
        ));
        return WorktreesSetup {
            capability: true,
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
                    "the `worktrees` capability is enabled but git could not initialize a baseline \
                     of the workspace: {err}; worktree isolation is disabled for this run."
                ),
            ));
            return WorktreesSetup {
                capability: true,
                baseline_commit: None,
                root: None,
            };
        }
    };

    let root = worktrees_root_for(workspace_dir);
    if let Err(err) = std::fs::create_dir_all(&root) {
        emitter.emit(log(
            "error",
            format!(
                "the `worktrees` capability is enabled and a baseline was committed, but the \
                 worktree root `{}` could not be created: {err}; worktree isolation is disabled \
                 for this run.",
                root.display()
            ),
        ));
        // Keep the baseline: Phase 5 can still diff against it even though no worktree can be made.
        return WorktreesSetup {
            capability: true,
            baseline_commit: Some(baseline),
            root: None,
        };
    }

    emitter.emit(log(
        "info",
        format!(
            "worktrees enabled; committed the seeded workspace as the baseline `{}`. A subagent \
             dispatched with `worktree: true` runs in an isolated copy that is merged back into \
             the main tree on clean completion (or discarded otherwise).",
            short_sha(&baseline)
        ),
    ));
    WorktreesSetup {
        capability: true,
        baseline_commit: Some(baseline),
        root: Some(root),
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

/// A small built-in table of **approximate** context-window sizes keyed by a substring
/// of the model id (matched case-insensitively). Deliberately coarse: it only sets the
/// fullness denominator, and a run can override it with [`PARAM_WINDOW_LIMIT`]. Returns
/// `None` for an id it does not recognize, so the caller can fall back to a default.
fn builtin_window_for(model_id: &str) -> Option<u64> {
    /// `(id substring, window tokens)`, first match wins; ordered most-specific first.
    const TABLE: &[(&str, u64)] = &[
        ("gpt-4.1", 1_047_576),
        ("gpt-4o", 128_000),
        ("o200k", 128_000),
        ("claude", 200_000),
        ("gemini", 1_048_576),
        ("llama", 128_000),
    ];
    let id = model_id.to_ascii_lowercase();
    TABLE
        .iter()
        .find(|(needle, _)| id.contains(needle))
        .map(|&(_, window)| window)
}

/// The system prompt for a run, reflecting the tools the enabled capabilities offer
/// so the model is told exactly what it can do (and, when nothing is enabled, that it
/// can only reply in text), plus the catalog of any available [skills](crate::skills)
/// (their names and descriptions), and — when the [memories](crate::memories) and
/// [tasks](crate::tasks) capabilities are on — how to curate memories and how to plan with
/// the task DAG.
fn system_prompt(
    registry: &ToolRegistry,
    skills: &SkillsRuntime,
    memories: &MemoriesRuntime,
    tasks: &TasksRuntime,
    board: &BoardRuntime,
    planning: &PlanningRuntime,
) -> String {
    let names: Vec<String> = registry
        .definitions()
        .into_iter()
        .map(|tool| tool.name)
        .collect();
    let tools = if names.is_empty() {
        "You have no tools available this run, so you can only reply in text.".to_string()
    } else {
        format!(
            "You have these tools available: {}. Use them to inspect the workspace and \
             build the game.",
            names.join(", ")
        )
    };
    let mut prompt = format!("{GG_SYSTEM_PROMPT_BASE}\n\n{tools}");
    if let Some(section) = skills.prompt_section() {
        prompt.push_str("\n\n");
        prompt.push_str(&section);
    }
    if let Some(section) = memories.prompt_section() {
        prompt.push_str("\n\n");
        prompt.push_str(&section);
    }
    if let Some(section) = tasks.prompt_section() {
        prompt.push_str("\n\n");
        prompt.push_str(&section);
    }
    if let Some(section) = board.prompt_section() {
        prompt.push_str("\n\n");
        prompt.push_str(&section);
    }
    if let Some(section) = planning.prompt_section() {
        prompt.push_str("\n\n");
        prompt.push_str(&section);
    }
    prompt
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
    let source = tool_output_source(&call.name);
    if source == GgContextSource::FileView {
        let path = call
            .arguments
            .get("path")
            .and_then(Value::as_str)
            .map(str::to_string);
        context.push_file_view(path, &call.id, outcome.output);
    } else {
        context.push_tool_result(source, &call.id, outcome.output);
    }
}

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

#[cfg(test)]
#[path = "agent.test.rs"]
mod tests;
