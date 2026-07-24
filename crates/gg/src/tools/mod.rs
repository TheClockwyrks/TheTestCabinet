//! gg **tool dispatch** and the toolset offered to the agent.
//!
//! Tools are gg's primary axis of modularity: beyond the single agent-loop plug
//! point, behavior is reconfigured by *which tools are offered* and *which
//! implementation* backs each — so a capability is, in practice, "offer this tool"
//! and an A/B is "offer a different implementation of it". The set of tools
//! exposed to the model is derived from the run's
//! [`GgCapabilitySet`]: a capability that
//! is off contributes no tools and no prompt text (the basis for
//! [ablation](test_cabinet_core::gg)).
//!
//! # The toolset abstraction
//!
//! A [`Tool`] declares itself to the model via a [`ToolDefinition`] (name,
//! description, and JSON-Schema parameters) and runs one call via
//! [`invoke`](Tool::invoke), which receives the parsed arguments and a
//! [`ToolContext`] (the workspace root the call is rooted at) and returns a
//! [`ToolOutcome`] — the `output` string fed back to the model as the tool result
//! plus a short `summary` for the [`ToolResult`](test_cabinet_core::gg::GgTelemetryKind::ToolResult)
//! telemetry event.
//!
//! # Capability gating
//!
//! [`ToolRegistry::from_capabilities`] assembles the offered toolset from *only* the
//! enabled capabilities of a [`GgCapabilitySet`]: a disabled (or absent) capability
//! contributes no tools, so the model is never shown their schemas and never sees
//! them in a prompt. This is the concrete basis for toolset ablation. The Phase 0
//! toolset is the two capabilities the core loop needs to build a test case:
//! [`shell`](test_cabinet_core::gg::CAPABILITY_SHELL) (run commands in the run
//! container) and
//! [`filesystem`](test_cabinet_core::gg::CAPABILITY_FILESYSTEM) (read/write/edit/list
//! files in the workspace).
//!
//! The loop presents the offered tools to the model via [`ToolRegistry::definitions`]
//! and routes each requested [`ToolCall`] through [`ToolRegistry::dispatch`], which
//! matches by name and returns a well-formed error [`ToolOutcome`] (never a panic)
//! for an unknown tool.

mod board;
mod context;
mod filesystem;
mod memories;
mod planning;
mod shell;
mod skills;
mod subagents;
mod tasks;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::Value;
use test_cabinet_core::gg::{
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_EPICS_ISSUES, CAPABILITY_FILESYSTEM,
    CAPABILITY_MEMORIES, CAPABILITY_PLANNING, CAPABILITY_SHELL, CAPABILITY_SKILLS,
    CAPABILITY_SUBAGENTS, CAPABILITY_TASKS, CAPABILITY_WORKFLOWS, GgCapabilitySet,
};

use crate::archive::ArchiveStore;
use crate::board::BoardStore;
use crate::memories::MemoryStore;
use crate::model::{ToolCall, ToolDefinition};
use crate::skills::SkillLibrary;
use crate::tasks::TaskStore;

pub use board::{COMPLETE_ISSUE_TOOL, is_board_tool};
pub use context::{
    ARCHIVE_THREAD_TOOL, DEFAULT_ARCHIVE_KEEP_RECENT, EVICT_FILE_VIEW_TOOL, SEARCH_ARCHIVE_TOOL,
    is_context_reclaim_tool, parse_archive_keep_recent, parse_evict_path,
};
pub use memories::is_memory_tool;
pub use planning::{ENTER_PLAN_MODE_TOOL, SUBMIT_PLAN_TOOL, is_planning_tool};
pub use skills::READ_SKILL_TOOL;
pub use subagents::{
    RUN_WORKFLOW_TOOL, SEND_MESSAGE_TOOL, SPAWN_SUBAGENT_TOOL, WAIT_FOR_SUBAGENTS_TOOL,
    is_subagent_tool,
};
pub use tasks::is_task_tool;

/// The tool names that are **read-only** — they inspect the workspace or gg's own state but
/// mutate nothing — and so remain available in [plan mode](crate::planning). Everything not on
/// this list (writes, edits, shell, and every task/memory/board/context mutation) is withheld
/// while planning. Centralized here so the loop's plan-mode toolset filter and its dispatch
/// guard share one definition.
pub fn is_read_only_tool(name: &str) -> bool {
    matches!(
        name,
        "read_file" | "list_dir" | READ_SKILL_TOOL | SEARCH_ARCHIVE_TOOL
    )
}

/// Whether `name` is offered while the loop is in the given plan-mode state — the single
/// predicate behind both the per-turn offered [toolset](ToolRegistry::definitions) filter and
/// the loop's dispatch guard, so what the model is shown and what it is allowed to run can never
/// disagree.
///
/// In plan mode only the [read-only tools](is_read_only_tool) and [`submit_plan`](SUBMIT_PLAN_TOOL)
/// (the way out) are available. Outside plan mode everything is available **except**
/// `submit_plan`, which is meaningless with no plan pass in progress — including
/// [`enter_plan_mode`](ENTER_PLAN_MODE_TOOL), which starts one.
pub fn plan_mode_offers(name: &str, in_plan_mode: bool) -> bool {
    if in_plan_mode {
        is_read_only_tool(name) || name == SUBMIT_PLAN_TOOL
    } else {
        name != SUBMIT_PLAN_TOOL
    }
}

/// The ambient state a [`Tool`] invocation runs against.
///
/// gg runs *inside* the run container, so tools operate on the local filesystem and
/// shell; every path a tool touches is resolved relative to
/// [`workspace_dir`](Self::workspace_dir) (the seeded workspace `core` prepared) and
/// prevented from escaping it.
#[derive(Debug, Clone)]
pub struct ToolContext {
    /// The workspace root every tool is rooted at — the invocation's
    /// [`workspace_dir`](crate::config::GgInvocation::workspace_dir).
    pub workspace_dir: PathBuf,
}

impl ToolContext {
    /// A context rooted at `workspace_dir`.
    pub fn new(workspace_dir: impl Into<PathBuf>) -> Self {
        Self {
            workspace_dir: workspace_dir.into(),
        }
    }
}

/// The result of one [`Tool::invoke`].
///
/// [`output`](Self::output) is the full text handed back to the model as the tool
/// result (the model reasons over it), while [`summary`](Self::summary) is the short
/// line recorded on the [`ToolResult`](test_cabinet_core::gg::GgTelemetryKind::ToolResult)
/// telemetry event for the console. [`ok`](Self::ok) reports whether the call
/// succeeded — it maps straight onto that event's `ok` field and lets the loop
/// distinguish a productive call from a failed one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolOutcome {
    /// Whether the call succeeded.
    pub ok: bool,
    /// The text fed back to the model as the tool result.
    pub output: String,
    /// A short human-readable summary for telemetry, when one is worth recording.
    pub summary: Option<String>,
}

impl ToolOutcome {
    /// A successful outcome carrying the model-facing `output` and a telemetry
    /// `summary`.
    pub fn ok(output: impl Into<String>, summary: impl Into<String>) -> Self {
        Self {
            ok: true,
            output: output.into(),
            summary: Some(summary.into()),
        }
    }

    /// A failed outcome. The `message` is both the model-facing output (so the model
    /// can recover) and the telemetry summary.
    pub fn error(message: impl Into<String>) -> Self {
        let message = message.into();
        Self {
            ok: false,
            output: message.clone(),
            summary: Some(message),
        }
    }
}

/// A single tool the agent can call.
///
/// A tool declares itself to the model with a [`ToolDefinition`] and executes one
/// call in [`invoke`](Self::invoke). Implementations are `Send + Sync` so a boxed
/// tool can live in the [`ToolRegistry`] shared across the async loop.
#[async_trait]
pub trait Tool: Send + Sync {
    /// The tool's name, matched against [`ToolCall::name`] during dispatch. Must equal
    /// the `name` in [`definition`](Self::definition).
    fn name(&self) -> &str;

    /// The declaration offered to the model: name, description, and JSON-Schema
    /// parameters.
    fn definition(&self) -> ToolDefinition;

    /// Run one call with the parsed `args` against `ctx`, returning what to feed the
    /// model and what to record. Argument validation is the tool's responsibility: a
    /// malformed `args` yields an error [`ToolOutcome`], never a panic or a process
    /// failure.
    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolOutcome;
}

/// The toolset offered to the agent for a run, assembled from the enabled
/// capabilities in a [`GgCapabilitySet`].
///
/// The registry is the concrete basis for toolset ablation: a capability that is off
/// contributes no tools, so the model is offered no schema and shown no prompt text
/// for it. Dispatch routes a [`ToolCall`] to the tool whose [`name`](Tool::name)
/// matches and answers an unknown name with an error outcome.
pub struct ToolRegistry {
    tools: Vec<Box<dyn Tool>>,
}

/// The bundle of shared runtime stores the stateful tools mutate, threaded into
/// [`ToolRegistry::from_run`].
///
/// gg's stateful capabilities each own a store the loop and their tools share behind an
/// `Arc<Mutex<…>>`; rather than grow the registry constructor a positional argument per
/// capability (skills, then memories, then tasks, then the board, then the archive, and more to
/// come — subagents and planning in later phases), they are bundled here and passed as one. A
/// store left `None` (or an empty skill library) means the matching capability offers no tools
/// even when it is enabled — there is nothing for its tools to act on.
///
/// Built with [`new`](Self::new) (skills only) and populated with the `with_*` builders, so a
/// caller names only the stores it binds and the set stays readable as capabilities are added.
pub struct RuntimeSet<'a> {
    /// The skill catalog `read_skill` resolves against (empty when skills are unseeded).
    pub skills: &'a Arc<SkillLibrary>,
    /// The memory store the memory tools mutate, when bound.
    pub memories: Option<&'a Arc<Mutex<MemoryStore>>>,
    /// The task store the task tools mutate, when bound.
    pub tasks: Option<&'a Arc<Mutex<TaskStore>>>,
    /// The epic/issue board store the board tools mutate, when bound.
    pub board: Option<&'a Arc<Mutex<BoardStore>>>,
    /// The thread archive `archive_thread` fills and `search_archive` reads, when bound.
    pub archive: Option<&'a Arc<Mutex<ArchiveStore>>>,
}

impl<'a> RuntimeSet<'a> {
    /// A runtime set binding only the skill `library`; every other store is unbound. Populate
    /// the rest with the `with_*` builders.
    pub fn new(library: &'a Arc<SkillLibrary>) -> Self {
        Self {
            skills: library,
            memories: None,
            tasks: None,
            board: None,
            archive: None,
        }
    }

    /// Bind the memory store the memory tools mutate.
    pub fn with_memories(mut self, memories: &'a Arc<Mutex<MemoryStore>>) -> Self {
        self.memories = Some(memories);
        self
    }

    /// Bind the task store the task tools mutate.
    pub fn with_tasks(mut self, tasks: &'a Arc<Mutex<TaskStore>>) -> Self {
        self.tasks = Some(tasks);
        self
    }

    /// Bind the epic/issue board store the board tools mutate.
    pub fn with_board(mut self, board: &'a Arc<Mutex<BoardStore>>) -> Self {
        self.board = Some(board);
        self
    }

    /// Bind the thread archive the agent-managed-context tools use.
    pub fn with_archive(mut self, archive: &'a Arc<Mutex<ArchiveStore>>) -> Self {
        self.archive = Some(archive);
        self
    }
}

impl ToolRegistry {
    /// Assemble the offered toolset from the *enabled* capabilities in `capabilities`,
    /// **without** any bound runtime store — so the [`skills`](CAPABILITY_SKILLS),
    /// [`memories`](CAPABILITY_MEMORIES), [`tasks`](CAPABILITY_TASKS),
    /// [`epics-and-issues`](CAPABILITY_EPICS_ISSUES), and
    /// [`agent-managed-context`](CAPABILITY_AGENT_MANAGED_CONTEXT) capabilities contribute no
    /// tools even when enabled (there is no store for them to mutate).
    ///
    /// This is the convenience entry point for callers that bind none of them (and for
    /// tests). The loop uses [`from_run`](Self::from_run) with a populated [`RuntimeSet`] so a
    /// skills-, memories-, tasks-, or board-enabled run can offer their tools.
    // The binary always goes through `from_run` (it loads the run's skill library and the
    // memory/task/board stores); this bare convenience is exercised by the toolset tests, so the
    // non-test build sees it as unused.
    #[allow(dead_code)]
    pub fn from_capabilities(capabilities: &GgCapabilitySet) -> Self {
        let skills = Arc::new(SkillLibrary::empty());
        Self::from_run(capabilities, &RuntimeSet::new(&skills))
    }

    /// Assemble the offered toolset from the *enabled* capabilities in `capabilities`, binding
    /// the runtime stores in `runtimes` (skills, memories, tasks, the epic/issue board, and the
    /// thread archive) that the stateful tools mutate.
    ///
    /// Each capability contributes its tools only when
    /// [`is_enabled`](GgCapabilitySet::is_enabled) reports it on: the
    /// [`shell`](CAPABILITY_SHELL) capability contributes the `shell` tool; the
    /// [`filesystem`](CAPABILITY_FILESYSTEM) capability contributes the
    /// `read_file`/`write_file`/`edit_file`/`list_dir` tools; the
    /// [`skills`](CAPABILITY_SKILLS) capability contributes the `read_skill` tool — but only
    /// when the bound library is **non-empty**, since there would be nothing to read; the
    /// [`memories`](CAPABILITY_MEMORIES) capability contributes the
    /// `write_memory`/`update_memory`/`delete_memory` tools when a memory store is bound; the
    /// [`tasks`](CAPABILITY_TASKS) capability contributes the
    /// `add_task`/`update_task`/`set_blocked_by`/`complete_task`/`remove_task` tools when a task
    /// store is bound; the [`epics-and-issues`](CAPABILITY_EPICS_ISSUES) capability contributes
    /// the
    /// `create_epic`/`create_issue`/`update_issue`/`set_issue_blocked_by`/`complete_issue`/`remove_epic`/`remove_issue`
    /// tools when a board store is bound (the model creates the memories, tasks, epics, and
    /// issues, so no pre-existing content is required); and the
    /// [`agent-managed-context`](CAPABILITY_AGENT_MANAGED_CONTEXT) capability contributes the
    /// `evict_file_view`/`archive_thread`/`search_archive` tools when an archive store is bound
    /// (the store backs `search_archive`; the loop applies the reclaim); and the
    /// [`planning`](CAPABILITY_PLANNING) capability contributes the `enter_plan_mode`/`submit_plan`
    /// tools (stateless, like shell/filesystem — the loop owns plan mode and the context reset);
    /// and the [`subagents`](CAPABILITY_SUBAGENTS) capability contributes the
    /// `spawn_subagent`/`wait_for_subagents`/`send_message` tools (stateless declarations — the
    /// loop intercepts and performs delegation against the scheduler and agent tree); and the
    /// [`workflows`](CAPABILITY_WORKFLOWS) capability contributes the `run_workflow` tool (likewise
    /// a declaration the loop intercepts to drive declared fan-out/sequencing over the same
    /// scheduler). A disabled or absent capability contributes nothing.
    pub fn from_run(capabilities: &GgCapabilitySet, runtimes: &RuntimeSet<'_>) -> Self {
        let mut tools: Vec<Box<dyn Tool>> = Vec::new();

        if capabilities.is_enabled(CAPABILITY_SHELL) {
            tools.push(Box::new(shell::ShellTool::new()));
        }

        if capabilities.is_enabled(CAPABILITY_FILESYSTEM) {
            tools.push(Box::new(filesystem::ReadFileTool));
            tools.push(Box::new(filesystem::WriteFileTool));
            tools.push(Box::new(filesystem::EditFileTool));
            tools.push(Box::new(filesystem::ListDirTool));
        }

        if capabilities.is_enabled(CAPABILITY_SKILLS) && !runtimes.skills.is_empty() {
            tools.push(Box::new(skills::ReadSkillTool::new(Arc::clone(
                runtimes.skills,
            ))));
        }

        if capabilities.is_enabled(CAPABILITY_MEMORIES)
            && let Some(memories) = runtimes.memories
        {
            tools.push(Box::new(memories::WriteMemoryTool::new(Arc::clone(
                memories,
            ))));
            tools.push(Box::new(memories::UpdateMemoryTool::new(Arc::clone(
                memories,
            ))));
            tools.push(Box::new(memories::DeleteMemoryTool::new(Arc::clone(
                memories,
            ))));
        }

        if capabilities.is_enabled(CAPABILITY_TASKS)
            && let Some(tasks) = runtimes.tasks
        {
            tools.push(Box::new(tasks::AddTaskTool::new(Arc::clone(tasks))));
            tools.push(Box::new(tasks::UpdateTaskTool::new(Arc::clone(tasks))));
            tools.push(Box::new(tasks::SetBlockedByTool::new(Arc::clone(tasks))));
            tools.push(Box::new(tasks::CompleteTaskTool::new(Arc::clone(tasks))));
            tools.push(Box::new(tasks::RemoveTaskTool::new(Arc::clone(tasks))));
        }

        if capabilities.is_enabled(CAPABILITY_EPICS_ISSUES)
            && let Some(board) = runtimes.board
        {
            tools.push(Box::new(board::CreateEpicTool::new(Arc::clone(board))));
            tools.push(Box::new(board::CreateIssueTool::new(Arc::clone(board))));
            tools.push(Box::new(board::UpdateIssueTool::new(Arc::clone(board))));
            tools.push(Box::new(board::SetIssueBlockedByTool::new(Arc::clone(
                board,
            ))));
            tools.push(Box::new(board::CompleteIssueTool::new(Arc::clone(board))));
            tools.push(Box::new(board::RemoveEpicTool::new(Arc::clone(board))));
            tools.push(Box::new(board::RemoveIssueTool::new(Arc::clone(board))));
        }

        if capabilities.is_enabled(CAPABILITY_AGENT_MANAGED_CONTEXT)
            && let Some(archive) = runtimes.archive
        {
            // The two reclaim tools act on the live window (applied by the loop); the search
            // tool reads the shared archive directly.
            tools.push(Box::new(context::EvictFileViewTool));
            tools.push(Box::new(context::ArchiveThreadTool));
            tools.push(Box::new(context::SearchArchiveTool::new(Arc::clone(
                archive,
            ))));
        }

        if capabilities.is_enabled(CAPABILITY_PLANNING) {
            // The planning tools are stateless validators (like shell/filesystem, they need no
            // bound store): the loop owns plan mode, the read-only toolset restriction, and the
            // context reset, and applies them when a call succeeds.
            tools.push(Box::new(planning::EnterPlanModeTool));
            tools.push(Box::new(planning::SubmitPlanTool));
        }

        if capabilities.is_enabled(CAPABILITY_SUBAGENTS) {
            // The subagent tools only *declare* themselves; the loop intercepts their calls and
            // performs the spawn/wait/message against the orchestrator and scheduler (they act on
            // the agent tree, which a self-contained tool cannot reach).
            tools.push(Box::new(subagents::SpawnSubagentTool));
            tools.push(Box::new(subagents::WaitForSubagentsTool));
            tools.push(Box::new(subagents::SendMessageTool));
        }

        if capabilities.is_enabled(CAPABILITY_WORKFLOWS) {
            // The `run_workflow` tool is declared like the subagent tools and intercepted by the
            // loop, which drives the declared stages against the same subagent scheduler. It is
            // offered independently of `subagents` (a run may declare workflows without ad-hoc
            // spawning) — the loop builds the delegation runtime whenever either capability is on.
            tools.push(Box::new(subagents::RunWorkflowTool));
        }

        Self { tools }
    }

    /// The [`ToolDefinition`]s to offer the model, in registration order.
    pub fn definitions(&self) -> Vec<ToolDefinition> {
        self.tools.iter().map(|tool| tool.definition()).collect()
    }

    /// Whether any tool is offered. An empty registry (every capability off) means the
    /// model is offered no tools at all.
    pub fn is_empty(&self) -> bool {
        self.tools.is_empty()
    }

    /// The number of offered tools.
    pub fn len(&self) -> usize {
        self.tools.len()
    }

    /// Dispatch a [`ToolCall`] to the tool whose name matches, running it against
    /// `ctx`. An unknown tool name yields an error [`ToolOutcome`] — dispatch never
    /// panics on a name the model invented or a tool a disabled capability withheld.
    pub async fn dispatch(&self, call: &ToolCall, ctx: &ToolContext) -> ToolOutcome {
        match self.tools.iter().find(|tool| tool.name() == call.name) {
            Some(tool) => tool.invoke(call.arguments.clone(), ctx).await,
            None => ToolOutcome::error(format!(
                "unknown tool `{}`; it is not offered by this run's capability set",
                call.name
            )),
        }
    }
}

/// Extract a required string field from a tool's `args`, or an error message naming
/// the tool and field. Shared by the tool implementations for uniform argument
/// diagnostics.
fn required_str(args: &Value, field: &str, tool: &str) -> Result<String, String> {
    match args.get(field) {
        Some(Value::String(value)) => Ok(value.clone()),
        Some(_) => Err(format!("`{tool}`: argument `{field}` must be a string")),
        None => Err(format!("`{tool}`: missing required argument `{field}`")),
    }
}

#[cfg(test)]
#[path = "mod.test.rs"]
mod tests;
