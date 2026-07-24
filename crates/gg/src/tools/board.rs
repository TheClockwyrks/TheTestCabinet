//! The board tools: `create_epic`, `create_issue`, `update_issue`, `set_issue_blocked_by`,
//! `complete_issue`, `remove_epic`, and `remove_issue` — how the model builds and maintains its
//! [epic/issue board](crate::board).
//!
//! Each tool mutates the shared [`BoardStore`] (behind an `Arc<Mutex<…>>` the tool shares with
//! the [loop](crate::agent)) and returns a [`ToolOutcome`]: a confirmation on success, or — when
//! a mutation is refused (a duplicate id, an unknown epic/issue, or, crucially, a
//! [cycle](crate::board::BoardError::Cycle)) — an **error outcome carrying the store's
//! guidance**, with the board left unchanged. The loop owns the context-window consequences:
//! after a successful mutation it re-emits the
//! [`BoardState`](test_cabinet_core::gg::GgTelemetryKind::BoardState) telemetry and rebuilds the
//! pinned [`Board`](test_cabinet_core::gg::GgContextSource::Board) block.
//!
//! The tools are contributed to the registry only when the
//! [`epics-and-issues`](test_cabinet_core::gg::CAPABILITY_EPICS_ISSUES) capability is enabled and
//! a store is bound; when it is off, none are offered (ablation).

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::{Value, json};

use super::{Tool, ToolContext, ToolOutcome, required_str};
use crate::board::{BoardChange, BoardStore, IssueStatus, IssueUpdate};
use crate::model::ToolDefinition;

/// The `create_epic` tool name.
pub const CREATE_EPIC_TOOL: &str = "create_epic";
/// The `create_issue` tool name.
pub const CREATE_ISSUE_TOOL: &str = "create_issue";
/// The `update_issue` tool name.
pub const UPDATE_ISSUE_TOOL: &str = "update_issue";
/// The `set_issue_blocked_by` tool name.
pub const SET_ISSUE_BLOCKED_BY_TOOL: &str = "set_issue_blocked_by";
/// The `complete_issue` tool name.
pub const COMPLETE_ISSUE_TOOL: &str = "complete_issue";
/// The `remove_epic` tool name.
pub const REMOVE_EPIC_TOOL: &str = "remove_epic";
/// The `remove_issue` tool name.
pub const REMOVE_ISSUE_TOOL: &str = "remove_issue";

/// Whether `name` is one of the board-mutating tools — the loop uses this to know when a
/// successful tool call should refresh the board block and re-emit its state.
pub fn is_board_tool(name: &str) -> bool {
    matches!(
        name,
        CREATE_EPIC_TOOL
            | CREATE_ISSUE_TOOL
            | UPDATE_ISSUE_TOOL
            | SET_ISSUE_BLOCKED_BY_TOOL
            | COMPLETE_ISSUE_TOOL
            | REMOVE_EPIC_TOOL
            | REMOVE_ISSUE_TOOL
    )
}

/// A short line describing how full the board is after a mutation.
fn usage_note(store: &BoardStore) -> String {
    let caps = store.caps();
    format!(
        "The board now holds {} of {} epic(s) and {} of {} issue(s).",
        store.epic_count(),
        caps.max_epics,
        store.issue_count(),
        caps.max_issues
    )
}

/// An optional string argument: absent (or JSON `null`) yields `None`; a non-string is an error.
fn optional_str(args: &Value, field: &str, tool: &str) -> Result<Option<String>, String> {
    match args.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(_) => Err(format!("`{tool}`: argument `{field}` must be a string")),
    }
}

/// A list-of-issue-ids argument. When `required`, an absent key is an error; otherwise it yields
/// an empty list. Every entry must be a string.
fn id_array(args: &Value, field: &str, tool: &str, required: bool) -> Result<Vec<String>, String> {
    match args.get(field) {
        None | Some(Value::Null) => {
            if required {
                Err(format!(
                    "`{tool}`: missing required argument `{field}` (a list of issue ids; pass \
                     `[]` to clear)"
                ))
            } else {
                Ok(Vec::new())
            }
        }
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| match item {
                Value::String(id) => Ok(id.clone()),
                _ => Err(format!(
                    "`{tool}`: every entry in `{field}` must be an issue id string"
                )),
            })
            .collect(),
        Some(_) => Err(format!(
            "`{tool}`: argument `{field}` must be an array of issue ids"
        )),
    }
}

// ---------------------------------------------------------------------------
// create_epic
// ---------------------------------------------------------------------------

/// Creates an epic — a grouping of related issues.
pub struct CreateEpicTool {
    store: Arc<Mutex<BoardStore>>,
}

impl CreateEpicTool {
    /// A tool creating epics in `store`.
    pub fn new(store: Arc<Mutex<BoardStore>>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Tool for CreateEpicTool {
    fn name(&self) -> &str {
        CREATE_EPIC_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            CREATE_EPIC_TOOL,
            "Create an epic to group related issues. Provide a unique `id` (a short slug you \
             will reference from issues), a `title`, and a `description` of what the epic \
             covers.",
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "A short, unique id for the epic." },
                    "title": { "type": "string", "description": "A short title for the epic." },
                    "description": {
                        "type": "string",
                        "description": "What this epic covers."
                    }
                },
                "required": ["id", "title", "description"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let id = match required_str(&args, "id", CREATE_EPIC_TOOL) {
            Ok(v) => v,
            Err(m) => return ToolOutcome::error(m),
        };
        let title = match required_str(&args, "title", CREATE_EPIC_TOOL) {
            Ok(v) => v,
            Err(m) => return ToolOutcome::error(m),
        };
        let description = match required_str(&args, "description", CREATE_EPIC_TOOL) {
            Ok(v) => v,
            Err(m) => return ToolOutcome::error(m),
        };
        let mut store = self.store.lock().expect("board store lock");
        match store.create_epic(&id, &title, &description) {
            Ok(BoardChange::EpicCreated) => ToolOutcome::ok(
                format!("Created epic `{id}`. {}", usage_note(&store)),
                format!("created epic `{id}`"),
            ),
            Ok(_) => unreachable!("create_epic yields EpicCreated"),
            Err(err) => ToolOutcome::error(format!("create_epic: {err}")),
        }
    }
}

// ---------------------------------------------------------------------------
// create_issue
// ---------------------------------------------------------------------------

/// Creates a structured, dispatchable issue.
pub struct CreateIssueTool {
    store: Arc<Mutex<BoardStore>>,
}

impl CreateIssueTool {
    /// A tool creating issues in `store`.
    pub fn new(store: Arc<Mutex<BoardStore>>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Tool for CreateIssueTool {
    fn name(&self) -> &str {
        CREATE_ISSUE_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            CREATE_ISSUE_TOOL,
            "Create an issue — a heavyweight, self-contained unit of work. Provide a unique \
             `id`, a `title`, and the structured sections that make it safe to hand off: \
             `inScope` (what this issue is responsible for), `outOfScope` (what it is not), and \
             `completionCriteria` (how it will be judged done). Optionally add a `description` \
             overview, a `blockedBy` list of issue ids that must finish first (a cycle is \
             refused — issues form a DAG), and an `epicId` to group it under an epic.",
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "A short, unique id for the issue." },
                    "title": { "type": "string", "description": "A short title for the issue." },
                    "description": {
                        "type": "string",
                        "description": "An optional longer overview of the issue."
                    },
                    "inScope": {
                        "type": "string",
                        "description": "What this issue is responsible for."
                    },
                    "outOfScope": {
                        "type": "string",
                        "description": "What this issue is explicitly not responsible for."
                    },
                    "completionCriteria": {
                        "type": "string",
                        "description": "How the issue will be judged done (its acceptance criteria)."
                    },
                    "blockedBy": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional ids of issues that must be done before this one."
                    },
                    "epicId": {
                        "type": "string",
                        "description": "Optional id of the epic to group this issue under."
                    }
                },
                "required": ["id", "title", "inScope", "outOfScope", "completionCriteria"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let id = match required_str(&args, "id", CREATE_ISSUE_TOOL) {
            Ok(v) => v,
            Err(m) => return ToolOutcome::error(m),
        };
        let title = match required_str(&args, "title", CREATE_ISSUE_TOOL) {
            Ok(v) => v,
            Err(m) => return ToolOutcome::error(m),
        };
        let in_scope = match required_str(&args, "inScope", CREATE_ISSUE_TOOL) {
            Ok(v) => v,
            Err(m) => return ToolOutcome::error(m),
        };
        let out_of_scope = match required_str(&args, "outOfScope", CREATE_ISSUE_TOOL) {
            Ok(v) => v,
            Err(m) => return ToolOutcome::error(m),
        };
        let completion_criteria = match required_str(&args, "completionCriteria", CREATE_ISSUE_TOOL)
        {
            Ok(v) => v,
            Err(m) => return ToolOutcome::error(m),
        };
        let description = match optional_str(&args, "description", CREATE_ISSUE_TOOL) {
            Ok(v) => v,
            Err(m) => return ToolOutcome::error(m),
        };
        let epic_id = match optional_str(&args, "epicId", CREATE_ISSUE_TOOL) {
            Ok(v) => v,
            Err(m) => return ToolOutcome::error(m),
        };
        let blocked_by = match id_array(&args, "blockedBy", CREATE_ISSUE_TOOL, false) {
            Ok(v) => v,
            Err(m) => return ToolOutcome::error(m),
        };
        let mut store = self.store.lock().expect("board store lock");
        match store.create_issue(
            &id,
            &title,
            description.as_deref(),
            &in_scope,
            &out_of_scope,
            &completion_criteria,
            &blocked_by,
            epic_id.as_deref(),
        ) {
            Ok(BoardChange::IssueCreated) => ToolOutcome::ok(
                format!("Created issue `{id}`. {}", usage_note(&store)),
                format!("created issue `{id}`"),
            ),
            Ok(_) => unreachable!("create_issue yields IssueCreated"),
            Err(err) => ToolOutcome::error(format!("create_issue: {err}")),
        }
    }
}

// ---------------------------------------------------------------------------
// update_issue
// ---------------------------------------------------------------------------

/// Revises an issue's fields or status.
pub struct UpdateIssueTool {
    store: Arc<Mutex<BoardStore>>,
}

impl UpdateIssueTool {
    /// A tool updating issues in `store`.
    pub fn new(store: Arc<Mutex<BoardStore>>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Tool for UpdateIssueTool {
    fn name(&self) -> &str {
        UPDATE_ISSUE_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            UPDATE_ISSUE_TOOL,
            "Revise an issue by `id`: change its `title`, `description`, `inScope`, \
             `outOfScope`, `completionCriteria`, `status` (`open`, `in_progress`, or `done`), \
             and/or `epicId` (pass an empty string to ungroup it). Supply at least one field to \
             change. To change what an issue is blocked by, use `set_issue_blocked_by` instead.",
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "The id of the issue to revise." },
                    "title": { "type": "string", "description": "A new title." },
                    "description": {
                        "type": "string",
                        "description": "A new overview (empty clears it)."
                    },
                    "inScope": { "type": "string", "description": "A new in-scope statement." },
                    "outOfScope": { "type": "string", "description": "A new out-of-scope statement." },
                    "completionCriteria": {
                        "type": "string",
                        "description": "New completion criteria."
                    },
                    "status": {
                        "type": "string",
                        "enum": ["open", "in_progress", "done"],
                        "description": "A new status."
                    },
                    "epicId": {
                        "type": "string",
                        "description": "Re-group under this epic (empty string ungroups)."
                    }
                },
                "required": ["id"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let id = match required_str(&args, "id", UPDATE_ISSUE_TOOL) {
            Ok(v) => v,
            Err(m) => return ToolOutcome::error(m),
        };
        let title = match optional_str(&args, "title", UPDATE_ISSUE_TOOL) {
            Ok(v) => v,
            Err(m) => return ToolOutcome::error(m),
        };
        let description = match optional_str(&args, "description", UPDATE_ISSUE_TOOL) {
            Ok(v) => v,
            Err(m) => return ToolOutcome::error(m),
        };
        let in_scope = match optional_str(&args, "inScope", UPDATE_ISSUE_TOOL) {
            Ok(v) => v,
            Err(m) => return ToolOutcome::error(m),
        };
        let out_of_scope = match optional_str(&args, "outOfScope", UPDATE_ISSUE_TOOL) {
            Ok(v) => v,
            Err(m) => return ToolOutcome::error(m),
        };
        let completion_criteria = match optional_str(&args, "completionCriteria", UPDATE_ISSUE_TOOL)
        {
            Ok(v) => v,
            Err(m) => return ToolOutcome::error(m),
        };
        let epic_id = match optional_str(&args, "epicId", UPDATE_ISSUE_TOOL) {
            Ok(v) => v,
            Err(m) => return ToolOutcome::error(m),
        };
        let status = match optional_str(&args, "status", UPDATE_ISSUE_TOOL) {
            Ok(Some(raw)) => match IssueStatus::parse(&raw) {
                Some(status) => Some(status),
                None => {
                    return ToolOutcome::error(format!(
                        "update_issue: `{raw}` is not a valid status; use `open`, `in_progress`, \
                         or `done`."
                    ));
                }
            },
            Ok(None) => None,
            Err(m) => return ToolOutcome::error(m),
        };
        let update = IssueUpdate {
            title: title.as_deref(),
            description: description.as_deref(),
            in_scope: in_scope.as_deref(),
            out_of_scope: out_of_scope.as_deref(),
            completion_criteria: completion_criteria.as_deref(),
            status,
            epic_id: epic_id.as_deref(),
        };
        let mut store = self.store.lock().expect("board store lock");
        match store.update_issue(&id, update) {
            Ok(BoardChange::IssueUpdated) => ToolOutcome::ok(
                format!("Updated issue `{id}`."),
                format!("updated issue `{id}`"),
            ),
            Ok(_) => unreachable!("update_issue yields IssueUpdated"),
            Err(err) => ToolOutcome::error(format!("update_issue: {err}")),
        }
    }
}

// ---------------------------------------------------------------------------
// set_issue_blocked_by
// ---------------------------------------------------------------------------

/// Replaces an issue's blocked-by set, rejecting any cycle.
pub struct SetIssueBlockedByTool {
    store: Arc<Mutex<BoardStore>>,
}

impl SetIssueBlockedByTool {
    /// A tool setting blocked-by edges in `store`.
    pub fn new(store: Arc<Mutex<BoardStore>>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Tool for SetIssueBlockedByTool {
    fn name(&self) -> &str {
        SET_ISSUE_BLOCKED_BY_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            SET_ISSUE_BLOCKED_BY_TOOL,
            "Set which issues an issue is blocked by. Provide the issue `id` and the full \
             `blockedBy` list of issue ids that must finish first (pass `[]` to clear all \
             blockers). This replaces the issue's current blockers. Any edge that would create a \
             cycle is refused and nothing changes — issues form a DAG.",
            json!({
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string",
                        "description": "The id of the issue whose blockers to set."
                    },
                    "blockedBy": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "The full set of issue ids this issue is blocked by (`[]` clears)."
                    }
                },
                "required": ["id", "blockedBy"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let id = match required_str(&args, "id", SET_ISSUE_BLOCKED_BY_TOOL) {
            Ok(v) => v,
            Err(m) => return ToolOutcome::error(m),
        };
        let blocked_by = match id_array(&args, "blockedBy", SET_ISSUE_BLOCKED_BY_TOOL, true) {
            Ok(v) => v,
            Err(m) => return ToolOutcome::error(m),
        };
        let mut store = self.store.lock().expect("board store lock");
        match store.set_issue_blocked_by(&id, &blocked_by) {
            Ok(BoardChange::BlockersSet) => {
                let summary = if blocked_by.is_empty() {
                    format!("cleared blockers of `{id}`")
                } else {
                    format!("set blockers of `{id}`")
                };
                ToolOutcome::ok(format!("Updated the blockers of issue `{id}`."), summary)
            }
            Ok(_) => unreachable!("set_issue_blocked_by yields BlockersSet"),
            Err(err) => ToolOutcome::error(format!("set_issue_blocked_by: {err}")),
        }
    }
}

// ---------------------------------------------------------------------------
// complete_issue
// ---------------------------------------------------------------------------

/// Marks an issue done.
pub struct CompleteIssueTool {
    store: Arc<Mutex<BoardStore>>,
}

impl CompleteIssueTool {
    /// A tool completing issues in `store`.
    pub fn new(store: Arc<Mutex<BoardStore>>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Tool for CompleteIssueTool {
    fn name(&self) -> &str {
        COMPLETE_ISSUE_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            COMPLETE_ISSUE_TOOL,
            "Mark an issue done by `id`. Issues blocked by it become actionable once all of \
             their blockers are done. Fails if no issue of that id exists.",
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "The id of the issue to mark done." }
                },
                "required": ["id"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let id = match required_str(&args, "id", COMPLETE_ISSUE_TOOL) {
            Ok(v) => v,
            Err(m) => return ToolOutcome::error(m),
        };
        let mut store = self.store.lock().expect("board store lock");
        match store.complete_issue(&id) {
            Ok(BoardChange::IssueCompleted) => ToolOutcome::ok(
                format!("Marked issue `{id}` done."),
                format!("completed issue `{id}`"),
            ),
            Ok(_) => unreachable!("complete_issue yields IssueCompleted"),
            Err(err) => ToolOutcome::error(format!("complete_issue: {err}")),
        }
    }
}

// ---------------------------------------------------------------------------
// remove_epic
// ---------------------------------------------------------------------------

/// Removes an epic, ungrouping any issues under it.
pub struct RemoveEpicTool {
    store: Arc<Mutex<BoardStore>>,
}

impl RemoveEpicTool {
    /// A tool removing epics from `store`.
    pub fn new(store: Arc<Mutex<BoardStore>>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Tool for RemoveEpicTool {
    fn name(&self) -> &str {
        REMOVE_EPIC_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            REMOVE_EPIC_TOOL,
            "Remove an epic by `id`. Any issue grouped under it is ungrouped (its issues are \
             kept). Fails if no epic of that id exists.",
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "The id of the epic to remove." }
                },
                "required": ["id"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let id = match required_str(&args, "id", REMOVE_EPIC_TOOL) {
            Ok(v) => v,
            Err(m) => return ToolOutcome::error(m),
        };
        let mut store = self.store.lock().expect("board store lock");
        match store.remove_epic(&id) {
            Ok(BoardChange::EpicRemoved) => ToolOutcome::ok(
                format!("Removed epic `{id}`. {}", usage_note(&store)),
                format!("removed epic `{id}`"),
            ),
            Ok(_) => unreachable!("remove_epic yields EpicRemoved"),
            Err(err) => ToolOutcome::error(format!("remove_epic: {err}")),
        }
    }
}

// ---------------------------------------------------------------------------
// remove_issue
// ---------------------------------------------------------------------------

/// Removes an issue, dropping any edges pointing at it.
pub struct RemoveIssueTool {
    store: Arc<Mutex<BoardStore>>,
}

impl RemoveIssueTool {
    /// A tool removing issues from `store`.
    pub fn new(store: Arc<Mutex<BoardStore>>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Tool for RemoveIssueTool {
    fn name(&self) -> &str {
        REMOVE_ISSUE_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            REMOVE_ISSUE_TOOL,
            "Remove an issue by `id`. It is also dropped from any other issue's blockers, so no \
             dangling dependency is left. Fails if no issue of that id exists.",
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "The id of the issue to remove." }
                },
                "required": ["id"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let id = match required_str(&args, "id", REMOVE_ISSUE_TOOL) {
            Ok(v) => v,
            Err(m) => return ToolOutcome::error(m),
        };
        let mut store = self.store.lock().expect("board store lock");
        match store.remove_issue(&id) {
            Ok(BoardChange::IssueRemoved) => ToolOutcome::ok(
                format!("Removed issue `{id}`. {}", usage_note(&store)),
                format!("removed issue `{id}`"),
            ),
            Ok(_) => unreachable!("remove_issue yields IssueRemoved"),
            Err(err) => ToolOutcome::error(format!("remove_issue: {err}")),
        }
    }
}

#[cfg(test)]
#[path = "board.test.rs"]
mod tests;
