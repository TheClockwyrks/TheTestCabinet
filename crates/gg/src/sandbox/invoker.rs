//! The **native API surface** the typed membrane calls, and the records a run keeps of what a
//! program composed.
//!
//! Everything above this file is typed all the way to the model: a WIT function per tool, a
//! TypeScript function per tool, typed arguments and a typed result. [`ToolApi`] is the near side
//! of that surface *inside* the host — **one standard, typed method per API function**, so a
//! program's `fs.readFile(path, { limit })` reaches [`ToolApi::read_file`] with its arguments still
//! typed, never lowered into a bag of JSON to be re-parsed. That is the whole of the inversion:
//! responses-as-code is the richer interface, so it calls these functions directly; the JSON
//! tool-calling path is the one that parses its arguments and calls the same standard functions
//! ([`Tool::invoke`](crate::tools::Tool)).
//!
//! The production implementation (the loop's `LoopToolApi`, in [`crate::agent`]) performs each call
//! against gg's real tools and does the loop servicing — plan-mode/FSM gating, `ToolCall`/
//! `ToolResult` telemetry, replay capture, agent-managed-context reclaim, skill pinning, and — for
//! the delegation family — routing through the subagent scheduler. Because it holds the agent's
//! loop state and the sandbox runs on a blocking thread, it drives the async parts (`shell`,
//! delegation) with a [`Handle`](tokio::runtime::Handle)`::block_on`. The in-memory `FakeToolApi`
//! stands in for it in the sandbox's own tests.

use std::time::Duration;

use crate::board::IssueStatus;
use crate::context::TurnRange;
use crate::tasks::TaskStatus;
use crate::tools::ToolOutcome;

/// One function in an API object's directory, as [`list_functions`](ToolApi::list_functions)
/// returns it: the name a program calls it by and a one-line summary. The host counterpart of the
/// guest's `FunctionSummary` WIT record, kept free of the bindgen types so the trait has no
/// dependency on the generated membrane.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FunctionSummary {
    /// The function name on its object — `readFile` in `fs.readFile(...)`.
    pub name: String,
    /// A one-line description of what the function does.
    pub summary: String,
}

/// One tool call a program made and the loop serviced — the composed-calls record the loop feeds
/// back to the model and telemetry counts.
///
/// It deliberately does **not** carry the arguments. The loop already sends the same `Value` to the
/// servicing seam, which emits it as `ToolCall` telemetry and hands it to the replay recorder, so a
/// second full copy retained for the whole turn would be pure waste — a program that rewrites forty
/// 64 KiB files would hold ~2.5 MiB of dead clones, uncapped, for a field nothing renders.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxToolCall {
    /// The gg tool name the program called.
    pub name: String,
    /// Whether the tool reported success.
    pub ok: bool,
    /// The tool's short summary, when it recorded one.
    pub summary: Option<String>,
    /// The failure message, when it failed — so the feedback can say *how* a call failed even when
    /// the program caught the throw and carried on to return a value.
    pub error: Option<String>,
}

/// A call the membrane refused before it reached the loop: a turn-level transition, or a tool this
/// run does not offer.
///
/// Refusals are kept apart from [serviced calls](SandboxToolCall) because they produce no telemetry
/// and no replay entry — nothing was dispatched — so counting them together would make the
/// `CodeExecution` event's `tool_calls` disagree with the number of `ToolCall`/`ToolResult` pairs
/// the turn actually streamed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxRefusal {
    /// The gg tool name that was refused.
    pub name: String,
    /// Why — the same text the program's `ToolError` carried.
    pub message: String,
}

/// The prefix of the synthetic call id a program-composed tool call is recorded under:
/// `program:{ordinal}:{tool}`.
///
/// A program's call has no provider-assigned id, so the loop mints one. The **ordinal** is what
/// makes it unique within a turn: an id named only after the tool would collide whenever one
/// program called one tool twice, which is wrong for anything keyed by it. The
/// [replay driver](crate::replay_driver) recognises this prefix to attribute a recorded
/// `ToolResult` to the open turn's program rather than to a native tool call the model never made.
pub const PROGRAM_CALL_ID_PREFIX: &str = "program:";

/// The native, typed surface the membrane calls — one standard method per gg API function, plus the
/// two documentation carve-outs. No method takes a serde_json::Value: a program's typed call reaches
/// gg's tools without a round trip through JSON. `&mut self` because a call records what it composed.
pub trait ToolApi: Send + 'static {
    fn shell(&mut self, command: String, timeout: Duration) -> ToolOutcome;
    fn read_file(
        &mut self,
        path: String,
        offset: Option<usize>,
        limit: Option<usize>,
    ) -> ToolOutcome;
    fn write_file(&mut self, path: String, contents: String) -> ToolOutcome;
    fn edit_file(&mut self, path: String, old_string: String, new_string: String) -> ToolOutcome;
    fn list_dir(&mut self, path: Option<String>) -> ToolOutcome;
    fn read_skill(&mut self, name: String) -> ToolOutcome;
    fn write_memory(&mut self, name: String, description: String, body: String) -> ToolOutcome;
    fn update_memory(&mut self, name: String, description: String, body: String) -> ToolOutcome;
    fn create_memory(&mut self, name: String, description: String, contents: String)
    -> ToolOutcome;
    fn read_memory(&mut self, name: String) -> ToolOutcome;
    fn edit_memory(&mut self, name: String, search: String, replace: String) -> ToolOutcome;
    fn search_memories(&mut self, keywords: Vec<String>) -> ToolOutcome;
    fn delete_memory(&mut self, name: String) -> ToolOutcome;
    fn add_task(
        &mut self,
        id: String,
        title: String,
        description: Option<String>,
        blocked_by: Vec<String>,
    ) -> ToolOutcome;
    fn update_task(
        &mut self,
        id: String,
        title: Option<String>,
        description: Option<String>,
        status: Option<TaskStatus>,
    ) -> ToolOutcome;
    fn set_blocked_by(&mut self, id: String, blocked_by: Vec<String>) -> ToolOutcome;
    fn complete_task(&mut self, id: String) -> ToolOutcome;
    fn remove_task(&mut self, id: String) -> ToolOutcome;
    fn create_epic(&mut self, prefix: String, title: String, description: String) -> ToolOutcome;
    #[allow(clippy::too_many_arguments)]
    fn create_issue(
        &mut self,
        title: String,
        description: Option<String>,
        in_scope: String,
        out_of_scope: String,
        completion_criteria: String,
        blocked_by: Vec<String>,
        epic_id: Option<String>,
        agent: String,
        reviewers: Vec<String>,
    ) -> ToolOutcome;
    #[allow(clippy::too_many_arguments)]
    fn update_issue(
        &mut self,
        id: String,
        title: Option<String>,
        description: Option<String>,
        in_scope: Option<String>,
        out_of_scope: Option<String>,
        completion_criteria: Option<String>,
        status: Option<IssueStatus>,
        epic_id: Option<String>,
    ) -> ToolOutcome;
    fn set_issue_blocked_by(&mut self, id: String, blocked_by: Vec<String>) -> ToolOutcome;
    fn remove_epic(&mut self, id: String) -> ToolOutcome;
    fn remove_issue(&mut self, id: String) -> ToolOutcome;
    /// Register a deferred wait on a board issue and return the acknowledgement. Unlike the
    /// delegation family, this does **not** block on the calling thread: it records the requested
    /// wait (validating the id) and returns at once, and the loop performs the actual suspension
    /// after the program ends. A composed program has no shape for a mid-execution control-flow
    /// wait, so the wait is deferred to a place that does — between turns.
    fn wait_for_issue(&mut self, id: String) -> ToolOutcome;
    fn evict_file_view(&mut self, path: Option<String>) -> ToolOutcome;
    fn archive_thread(&mut self, ranges: Vec<TurnRange>) -> ToolOutcome;
    fn search_archive(&mut self, query: String) -> ToolOutcome;
    /// Register a compaction of the agent's own window and return. Deferred exactly as
    /// [`wait_for_issue`](Self::wait_for_issue) is, and for the same reason: rewriting the context
    /// a program is running in would pull the window out from under the turn still using it, so the
    /// call validates and records the request and the loop performs the rewrite once the program
    /// has ended.
    fn compact(&mut self, summary: String, files: Vec<String>) -> ToolOutcome;
    fn spawn_subagent(
        &mut self,
        agent: String,
        prompt: Option<String>,
        issue_id: Option<String>,
    ) -> ToolOutcome;
    fn wait_for_subagents(&mut self, ids: Option<Vec<String>>) -> ToolOutcome;
    fn send_message(&mut self, agent_id: String, message: String) -> ToolOutcome;
    fn run_workflow(&mut self, stages: Vec<WorkflowStageInput>) -> ToolOutcome;
    fn speculate(
        &mut self,
        agent: String,
        prompt: Option<String>,
        issue_id: Option<String>,
        attempts: u8,
        approaches: Vec<String>,
    ) -> ToolOutcome;
    fn list_functions(&mut self, object: &str) -> Vec<FunctionSummary>;
    fn read_docs(&mut self, name: &str) -> Option<String>;
}

/// One stage of a declared run_workflow, lowered from the WIT record to primitive fields.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkflowStageInput {
    pub name: String,
    pub prompt: String,
    pub items: Option<Vec<String>>,
    pub agent: String,
}
