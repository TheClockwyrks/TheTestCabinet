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

mod context;
mod filesystem;
mod memories;
mod shell;
mod skills;
mod tasks;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::Value;
use test_cabinet_core::gg::{
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_FILESYSTEM, CAPABILITY_MEMORIES, CAPABILITY_SHELL,
    CAPABILITY_SKILLS, CAPABILITY_TASKS, GgCapabilitySet,
};

use crate::archive::ArchiveStore;
use crate::memories::MemoryStore;
use crate::model::{ToolCall, ToolDefinition};
use crate::skills::SkillLibrary;
use crate::tasks::TaskStore;

pub use context::{
    ARCHIVE_THREAD_TOOL, DEFAULT_ARCHIVE_KEEP_RECENT, EVICT_FILE_VIEW_TOOL,
    is_context_reclaim_tool, parse_archive_keep_recent, parse_evict_path,
};
pub use memories::is_memory_tool;
pub use skills::READ_SKILL_TOOL;
pub use tasks::is_task_tool;

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

impl ToolRegistry {
    /// Assemble the offered toolset from the *enabled* capabilities in `capabilities`,
    /// **without** a skill library, memory store, or task store — so the
    /// [`skills`](CAPABILITY_SKILLS) capability contributes no `read_skill` tool, the
    /// [`memories`](CAPABILITY_MEMORIES) capability contributes no memory tools, the
    /// [`tasks`](CAPABILITY_TASKS) capability contributes no task tools, and the
    /// [`agent-managed-context`](CAPABILITY_AGENT_MANAGED_CONTEXT) capability contributes no
    /// context-management tools even when enabled.
    ///
    /// This is the convenience entry point for callers that bind none of them (and for
    /// tests). The loop uses [`from_run`](Self::from_run) so a skills-, memories-, or
    /// tasks-enabled run can offer their tools.
    // The binary always goes through `from_run` (it loads the run's skill library and the
    // memory/task stores); this bare convenience is exercised by the toolset tests, so the
    // non-test build sees it as unused.
    #[allow(dead_code)]
    pub fn from_capabilities(capabilities: &GgCapabilitySet) -> Self {
        Self::from_run(
            capabilities,
            &Arc::new(SkillLibrary::empty()),
            None,
            None,
            None,
        )
    }

    /// Assemble the offered toolset from the *enabled* capabilities in `capabilities`,
    /// binding `skills` as the catalog `read_skill` resolves against, `memories` (when
    /// present) as the store the memory tools mutate, and `tasks` (when present) as the
    /// store the task tools mutate.
    ///
    /// Each capability contributes its tools only when
    /// [`is_enabled`](GgCapabilitySet::is_enabled) reports it on: the
    /// [`shell`](CAPABILITY_SHELL) capability contributes the `shell` tool; the
    /// [`filesystem`](CAPABILITY_FILESYSTEM) capability contributes the
    /// `read_file`/`write_file`/`edit_file`/`list_dir` tools; the
    /// [`skills`](CAPABILITY_SKILLS) capability contributes the `read_skill` tool — but
    /// only when `skills` is **non-empty**, since there would be nothing to read; the
    /// [`memories`](CAPABILITY_MEMORIES) capability contributes the
    /// `write_memory`/`update_memory`/`delete_memory` tools when a `memories` store is
    /// bound; and the [`tasks`](CAPABILITY_TASKS) capability contributes the
    /// `add_task`/`update_task`/`set_blocked_by`/`complete_task`/`remove_task` tools when a
    /// `tasks` store is bound (the model creates the memories and tasks, so no pre-existing
    /// content is required); and the
    /// [`agent-managed-context`](CAPABILITY_AGENT_MANAGED_CONTEXT) capability contributes the
    /// `evict_file_view`/`archive_thread`/`search_archive` tools when an `archive` store is
    /// bound (the store backs `search_archive`; the loop applies the reclaim). A disabled or
    /// absent capability contributes nothing.
    pub fn from_run(
        capabilities: &GgCapabilitySet,
        skills: &Arc<SkillLibrary>,
        memories: Option<&Arc<Mutex<MemoryStore>>>,
        tasks: Option<&Arc<Mutex<TaskStore>>>,
        archive: Option<&Arc<Mutex<ArchiveStore>>>,
    ) -> Self {
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

        if capabilities.is_enabled(CAPABILITY_SKILLS) && !skills.is_empty() {
            tools.push(Box::new(skills::ReadSkillTool::new(Arc::clone(skills))));
        }

        if capabilities.is_enabled(CAPABILITY_MEMORIES)
            && let Some(memories) = memories
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
            && let Some(tasks) = tasks
        {
            tools.push(Box::new(tasks::AddTaskTool::new(Arc::clone(tasks))));
            tools.push(Box::new(tasks::UpdateTaskTool::new(Arc::clone(tasks))));
            tools.push(Box::new(tasks::SetBlockedByTool::new(Arc::clone(tasks))));
            tools.push(Box::new(tasks::CompleteTaskTool::new(Arc::clone(tasks))));
            tools.push(Box::new(tasks::RemoveTaskTool::new(Arc::clone(tasks))));
        }

        if capabilities.is_enabled(CAPABILITY_AGENT_MANAGED_CONTEXT)
            && let Some(archive) = archive
        {
            // The two reclaim tools act on the live window (applied by the loop); the search
            // tool reads the shared archive directly.
            tools.push(Box::new(context::EvictFileViewTool));
            tools.push(Box::new(context::ArchiveThreadTool));
            tools.push(Box::new(context::SearchArchiveTool::new(Arc::clone(
                archive,
            ))));
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
