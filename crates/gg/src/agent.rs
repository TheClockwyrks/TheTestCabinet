//! The gg **agent turn loop**.
//!
//! This is gg's core — the one coarse-grained plug point of the design (all other
//! modularity comes from [which tools](crate::tools) are offered). The loop runs one
//! logical session: build a model request from the conversation and the offered
//! toolset, send it via the [client](crate::client), record the assistant's message
//! and tool calls, dispatch each tool, append the results, and repeat until the model
//! stops calling tools — emitting [telemetry](crate::telemetry) throughout.
//!
//! # Control flow
//!
//! [`run`] frames one session:
//!
//! 1. emit [`SessionStarted`](GgTelemetryKind::SessionStarted);
//! 2. resolve the [`primary`](PRIMARY_SLOT) slot to a concrete
//!    [`ModelClient`] (mock or OpenRouter). A missing slot
//!    or an unresolvable client is a **launch failure**: it emits a
//!    [`Log`](GgTelemetryKind::Log)`(error)` and
//!    [`SessionEnded`](GgTelemetryKind::SessionEnded)`{status:"error"}` and returns
//!    [`SessionOutcome::LaunchFailed`] so the process exits non-zero;
//! 3. assemble the offered [toolset](ToolRegistry) from the run's enabled
//!    capabilities and drive the [turn loop](drive) against the client;
//! 4. emit a summary [`Log`](GgTelemetryKind::Log) and the terminal
//!    [`SessionEnded`](GgTelemetryKind::SessionEnded).
//!
//! Each turn the loop emits [`TurnStarted`](GgTelemetryKind::TurnStarted), calls the
//! model, emits [`Usage`](GgTelemetryKind::Usage) and (when present)
//! [`AssistantMessage`](GgTelemetryKind::AssistantMessage), then for every requested
//! tool emits [`ToolCall`](GgTelemetryKind::ToolCall), dispatches it, and emits
//! [`ToolResult`](GgTelemetryKind::ToolResult). A turn with no tool calls ends the
//! session ([`"completed"`](drive)).
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

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::Value;
use test_cabinet_core::gg::{
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_CONTEXT_VISIBILITY, CAPABILITY_EPICS_ISSUES,
    CAPABILITY_MEMORIES, CAPABILITY_SKILLS, CAPABILITY_TASKS, GgCapabilitySet, GgContextAction,
    GgContextSource, GgSlotBinding, GgTelemetryKind, PRIMARY_SLOT,
};
use test_cabinet_core::metrics::{Cost, TokenCounts};

use crate::archive::ArchiveStore;
use crate::board::{BoardCaps, BoardRuntime};
use crate::client::{client_for_slot, provider_for};
use crate::compaction::{CompactionSetup, RetainedCounts, compact_if_needed};
use crate::config::GgInvocation;
use crate::context::{
    BpeTokenEstimator, ContextModel, Retention, TokenEstimator, tool_output_source,
};
use crate::memories::{MemoriesRuntime, MemoryCaps};
use crate::model::{ModelClient, ModelResponse, ToolCall};
use crate::skills::{DEFAULT_SKILLS_DIR, ReadRecord, SkillLibrary, SkillsRuntime};
use crate::tasks::{TasksRuntime, resolve_max_tasks};
use crate::telemetry::Emitter;
use crate::tools::{
    ARCHIVE_THREAD_TOOL, DEFAULT_ARCHIVE_KEEP_RECENT, EVICT_FILE_VIEW_TOOL, READ_SKILL_TOOL,
    RuntimeSet, ToolContext, ToolOutcome, ToolRegistry, is_board_tool, is_context_reclaim_tool,
    is_memory_tool, is_task_tool, parse_archive_keep_recent, parse_evict_path,
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

/// Run one gg session for `invocation`, emitting telemetry throughout, and report
/// whether it launched.
///
/// All outcomes — success, a misconfigured slot, a model error, or hitting a bound —
/// are reported as telemetry and end with a
/// [`SessionEnded`](GgTelemetryKind::SessionEnded). The function itself never panics;
/// a model error is a *run* outcome, not a launch failure (see [`SessionOutcome`]).
pub async fn run(invocation: &GgInvocation, emitter: &Emitter) -> SessionOutcome {
    emitter.emit(GgTelemetryKind::SessionStarted {});

    let Some(binding) = invocation
        .capability_set
        .slots
        .iter()
        .find(|binding| binding.slot == PRIMARY_SLOT)
    else {
        emitter.emit(log(
            "error",
            "no `primary` model slot is bound; there is no model to run.",
        ));
        emitter.emit(session_ended("error"));
        return SessionOutcome::LaunchFailed;
    };

    let client = match client_for_slot(binding) {
        Ok(client) => client,
        Err(err) => {
            emitter.emit(log(
                "error",
                format!(
                    "could not resolve the `primary` slot (model `{}`): {err}",
                    binding.model_id
                ),
            ));
            emitter.emit(session_ended("error"));
            return SessionOutcome::LaunchFailed;
        }
    };

    emitter.emit(log(
        "info",
        format!(
            "primary slot resolved to model `{}` ({} provider).",
            client.model_id(),
            provider_label(binding),
        ),
    ));

    // Load the run's skills (an authored, compaction-retained affordance). Off, or with
    // no skills directory, this is an empty library and the capability vanishes: no
    // `read_skill` tool, no prompt listing, no telemetry.
    let skills = resolve_skills(&invocation.capability_set, &invocation.workspace_dir);

    // Set up the run's memories (a bounded, model-curated, compaction-retained
    // scratchpad). Off, this is a disabled runtime and the capability vanishes: no memory
    // tools, no prompt section, no context block, no telemetry.
    let memories = resolve_memories(&invocation.capability_set);

    // Set up the run's tasks (a blocked-by DAG the model plans with, retained across
    // compaction). Off, this is a disabled runtime and the capability vanishes: no task
    // tools, no prompt section, no context block, no telemetry.
    let tasks = resolve_tasks(&invocation.capability_set);

    // Set up the run's epic/issue board (the heavyweight work-decomposition counterpart to
    // tasks: structured, dispatchable issues in a blocked-by DAG, grouped into epics, retained
    // across compaction). Off, this is a disabled runtime and the capability vanishes: no board
    // tools, no prompt section, no context block, no telemetry.
    let board = resolve_board(&invocation.capability_set);

    // Assemble the offered toolset from the run's enabled capabilities (the basis for
    // toolset ablation) and root every tool at the seeded workspace. The runtime set binds the
    // shared stores each stateful capability's tools mutate — the skill library (so a
    // skills-enabled run with authored skills offers `read_skill`), the memory store, the task
    // store, the epic/issue board store, and the thread archive — and the registry gates each
    // on its capability, so binding a store when the capability is off is inert.
    // The searchable thread archive backing agent-managed context (`archive_thread` moves
    // removed thread material into it; `search_archive` reads it). Always created (cheap and
    // empty); the tools that use it are only offered when the capability is enabled.
    let archive_store = Arc::new(Mutex::new(ArchiveStore::new()));
    let library = skills.library();
    let memory_store = memories.store();
    let task_store = tasks.store();
    let board_store = board.store();
    let registry = ToolRegistry::from_run(
        &invocation.capability_set,
        &RuntimeSet::new(&library)
            .with_memories(&memory_store)
            .with_tasks(&task_store)
            .with_board(&board_store)
            .with_archive(&archive_store),
    );
    let context = ToolContext::new(invocation.workspace_dir.clone());
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

    // Announce the run's skills up front (when any are offered) so the console shows the
    // catalog from the start; each is unread until the model calls `read_skill`.
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

    // Announce the memories capability up front (when enabled) so the console shows the
    // — initially empty — curated set and its caps from the start; the model fills it in
    // as it works.
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

    // Announce the tasks capability up front (when enabled) so the console shows the —
    // initially empty — task DAG from the start; the model plans it as it works.
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

    // Announce the epics-and-issues capability up front (when enabled) so the console shows the
    // — initially empty — board from the start; the model decomposes the build as it works.
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

    // Resolve the loop bounds and the optional wall-clock deadline. `core` also caps
    // the run externally; the deadline is a self-imposed bound so a runaway loop ends
    // cleanly on its own.
    let bounds = resolve_bounds(&invocation.capability_set);
    let deadline = bounds
        .max_runtime_secs
        .map(|secs| Instant::now() + Duration::from_secs(secs));

    // Set up the context accounting: the token estimator, the active model's window
    // limit, and whether to emit the per-turn breakdown telemetry. The accounting is
    // always computed (compaction needs it); only the emission is gated on the
    // context-visibility capability so an ablation's off arm stops streaming it.
    let context_setup = ContextSetup {
        estimator: Arc::new(BpeTokenEstimator::new()),
        window_limit: resolve_window_limit(&invocation.capability_set, client.model_id()),
        emit_breakdown: invocation
            .capability_set
            .is_enabled(CAPABILITY_CONTEXT_VISIBILITY),
    };

    // Resolve the compaction backstop (opt-in): when enabled, the loop summarizes and
    // restarts the thread once window fullness crosses the threshold, carrying pinned state
    // across verbatim. Off, the loop never compacts.
    let compaction = CompactionSetup::resolve(&invocation.capability_set);
    if compaction.enabled {
        emitter.emit(log(
            "info",
            format!(
                "compaction enabled; the thread compacts once the window reaches {:.0}% full.",
                compaction.policy.trigger_fullness * 100.0
            ),
        ));
    }

    // Resolve agent-managed context (opt-in): when enabled the model is offered the
    // evict/archive/search tools and is shown a per-turn fullness signal it can act on — the
    // model-facing complement to compaction. Off, none of that appears.
    let amc = AmcSetup {
        enabled: invocation
            .capability_set
            .is_enabled(CAPABILITY_AGENT_MANAGED_CONTEXT),
        archive: Arc::clone(&archive_store),
    };
    if amc.enabled {
        emitter.emit(log(
            "info",
            "agent-managed context enabled; the model sees a live window-fullness signal and \
             can evict file views, archive thread history, and search the archive.",
        ));
    }

    let end = drive(
        client.as_ref(),
        &invocation.prompt,
        &registry,
        &context,
        emitter,
        bounds.max_turns,
        deadline,
        context_setup,
        compaction,
        amc,
        skills,
        memories,
        tasks,
        board,
    )
    .await;

    emitter.emit(log("info", end.summary()));
    emitter.emit(session_ended(end.status));
    SessionOutcome::Ran
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

/// Drive the turn loop to completion, returning how it ended and the usage it
/// accrued.
///
/// Each turn the offered [`registry`](ToolRegistry) definitions are handed to the
/// model; any tool calls the turn returns are dispatched against `context` and their
/// results fed back on the next turn, until the model stops calling tools, a bound is
/// hit, or a turn errors. A `deadline` (when set) ends the loop with `"timed_out"` at
/// the next turn boundary once passed.
#[allow(clippy::too_many_arguments)]
async fn drive(
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
) -> LoopEnd {
    let tools = registry.definitions();

    // Build the source-tagged context model in place of a flat transcript, seeded with
    // the two pinned items every session opens with: the system prompt (which lists any
    // available skills' descriptions and explains the memory scratchpad and task list) and
    // the build prompt. Every later contribution (assistant turns, tool output, file views,
    // read skills, the memory block, the task list) is appended as a tagged item, so the
    // window can be accounted by source and the pinned/ephemeral split is available for
    // Phase 2 compaction.
    let mut context = ContextModel::new(context_setup.estimator, context_setup.window_limit);
    context.push_system(system_prompt(registry, &skills, &memories, &tasks, &board));
    context.push_user_prompt(prompt);

    let mut total_tokens = TokenCounts::default();
    let mut total_cost: Option<Cost> = None;

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
            };
        }

        emitter.emit(GgTelemetryKind::TurnStarted {});

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
                };
            }
        };

        record_usage(&response, emitter);
        total_tokens = add_counts(total_tokens, response.usage);
        total_cost = add_cost(total_cost, response.cost);

        if let Some(text) = &response.text {
            emitter.emit(GgTelemetryKind::AssistantMessage { text: text.clone() });
        }

        // Record the assistant turn (text + any tool calls) into the context.
        context.push_assistant(response.text.clone(), response.tool_calls.clone());

        if response.tool_calls.is_empty() {
            return LoopEnd {
                status: "completed",
                turns: turn + 1,
                tokens: total_tokens,
                cost: total_cost,
            };
        }

        // Dispatch each requested tool call against the workspace and feed the result
        // back so the model can proceed on its next turn.
        for call in &response.tool_calls {
            emitter.emit(GgTelemetryKind::ToolCall {
                name: call.name.clone(),
                args: call.arguments.clone(),
            });
            let mut outcome = registry.dispatch(call, tool_ctx).await;

            // Agent-managed context: `evict_file_view`/`archive_thread` act on the live
            // window, which the tools cannot hold — the tool only validated the args, so the
            // loop performs the reclaim against the context model here, rewrites the tool
            // result with what was actually reclaimed, and emits the `ContextManaged` effect
            // (the tool `ToolCall`/`ToolResult` still stream too). `search_archive` needs no
            // special handling — it read the shared archive in its own `invoke`.
            let managed_event = if amc.enabled && outcome.ok && is_context_reclaim_tool(&call.name)
            {
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

/// The context-accounting configuration threaded into the [turn loop](drive): the
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

/// The agent-managed-context configuration threaded into the [turn loop](drive): whether the
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
    prompt
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
