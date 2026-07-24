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

mod filesystem;
mod shell;
mod skills;

use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;
use test_cabinet_core::gg::{
    CAPABILITY_FILESYSTEM, CAPABILITY_SHELL, CAPABILITY_SKILLS, GgCapabilitySet,
};

use crate::model::{ToolCall, ToolDefinition};
use crate::skills::SkillLibrary;

pub use skills::READ_SKILL_TOOL;

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
    /// **without** a skill library — so the [`skills`](CAPABILITY_SKILLS) capability
    /// contributes no `read_skill` tool even when enabled.
    ///
    /// This is the convenience entry point for callers that do not load skills (and for
    /// tests). The loop uses [`from_capabilities_with_skills`](Self::from_capabilities_with_skills)
    /// so a skills-enabled run can offer `read_skill`.
    // The binary always goes through `from_capabilities_with_skills` (it loads the run's
    // skill library); this no-skills convenience is exercised by the toolset tests, so the
    // non-test build sees it as unused.
    #[allow(dead_code)]
    pub fn from_capabilities(capabilities: &GgCapabilitySet) -> Self {
        Self::from_capabilities_with_skills(capabilities, &Arc::new(SkillLibrary::empty()))
    }

    /// Assemble the offered toolset from the *enabled* capabilities in `capabilities`,
    /// binding `skills` as the catalog the `read_skill` tool resolves against.
    ///
    /// Each capability contributes its tools only when
    /// [`is_enabled`](GgCapabilitySet::is_enabled) reports it on: the
    /// [`shell`](CAPABILITY_SHELL) capability contributes the `shell` tool; the
    /// [`filesystem`](CAPABILITY_FILESYSTEM) capability contributes the
    /// `read_file`/`write_file`/`edit_file`/`list_dir` tools; and the
    /// [`skills`](CAPABILITY_SKILLS) capability contributes the `read_skill` tool — but
    /// only when `skills` is **non-empty**, so a run with the capability on yet no
    /// authored skills offers no `read_skill` (there would be nothing to read). A disabled
    /// or absent capability contributes nothing.
    pub fn from_capabilities_with_skills(
        capabilities: &GgCapabilitySet,
        skills: &Arc<SkillLibrary>,
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
