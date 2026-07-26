//! The task tools: `add_task`, `update_task`, `set_blocked_by`, `complete_task`, and
//! `remove_task` — how the model builds and maintains its [task DAG](crate::tasks).
//!
//! Each tool mutates the shared [`TaskStore`] (behind an `Arc<Mutex<…>>` the tool shares
//! with the [loop](crate::agent)) and returns a [`ToolOutcome`]: a confirmation on success,
//! or — when a mutation is refused (a duplicate id, an unknown task, or, crucially, a
//! [cycle](crate::tasks::TaskError::Cycle)) — an **error outcome carrying the store's
//! guidance**, with the list left unchanged. The loop owns the context-window consequences:
//! after a successful mutation it re-emits the
//! [`TasksState`](test_cabinet_core::gg::GgTelemetryKind::TasksState) telemetry and rebuilds
//! the pinned [`TaskList`](test_cabinet_core::gg::GgContextSource::TaskList) block.
//!
//! The tools are contributed to the registry only when the
//! [`tasks`](test_cabinet_core::gg::CAPABILITY_TASKS) capability is enabled and a store is
//! bound; when it is off, none are offered (ablation).

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::{Value, json};

use super::{
    ArgumentError, Tool, ToolContext, ToolData, ToolFailure, ToolOutcome, UsagePair,
    invalid_argument, required_str, saturating_u32,
};
use crate::model::ToolDefinition;
use crate::tasks::{TaskChange, TaskError, TaskStatus, TaskStore};

/// The `add_task` tool name.
pub const ADD_TASK_TOOL: &str = "add_task";
/// The `update_task` tool name.
pub const UPDATE_TASK_TOOL: &str = "update_task";
/// The `set_blocked_by` tool name.
pub const SET_BLOCKED_BY_TOOL: &str = "set_blocked_by";
/// The `complete_task` tool name.
pub const COMPLETE_TASK_TOOL: &str = "complete_task";
/// The `remove_task` tool name.
pub const REMOVE_TASK_TOOL: &str = "remove_task";

/// Whether `name` is one of the task-mutating tools — the loop uses this to know when a
/// successful tool call should refresh the task block and re-emit its state.
pub fn is_task_tool(name: &str) -> bool {
    matches!(
        name,
        ADD_TASK_TOOL
            | UPDATE_TASK_TOOL
            | SET_BLOCKED_BY_TOOL
            | COMPLETE_TASK_TOOL
            | REMOVE_TASK_TOOL
    )
}

/// A short line describing how many tasks the list holds after a mutation.
fn usage_note(store: &TaskStore) -> String {
    format!(
        "You now have {} of {} task(s).",
        store.count(),
        store.max_tasks()
    )
}

/// The two numbers [`usage_note`] renders into a sentence, as the structured sidecar the two
/// tools that change how many tasks exist carry.
fn usage_data(store: &TaskStore) -> ToolData {
    ToolData::TaskUsage(UsagePair {
        count: saturating_u32(store.count()),
        max: saturating_u32(store.max_tasks()),
    })
}

/// Classify a [`TaskStore`] refusal, at the one place its error type is matched.
///
/// The store's [`Display`](std::fmt::Display) is the model-facing guidance; this mapping is what a
/// caller branches on, and it is derived from the variant rather than from that text.
fn failure_for(err: &TaskError) -> ToolFailure {
    match err {
        // The call itself was malformed: an empty field, or a revision that revises nothing.
        TaskError::EmptyField(_) | TaskError::NoUpdateFields => ToolFailure::InvalidArgument,
        // A named task is simply not there — including one named as a blocker, which is the same
        // recovery (create it, or correct the id).
        TaskError::NotFound(_) | TaskError::BlockerNotFound(_) => ToolFailure::NotFound,
        // Well-formed, but irreconcilable with the DAG as it stands: a taken id, or an edge that
        // would close a loop (a self-block being the one-node case of exactly that).
        TaskError::Duplicate(_) | TaskError::SelfBlock(_) | TaskError::Cycle { .. } => {
            ToolFailure::Conflict
        }
        TaskError::CountCap { .. } => ToolFailure::LimitExceeded,
    }
}

/// An optional string argument: absent (or JSON `null`) yields `None`; a non-string is an
/// [invalid-argument](ToolFailure::InvalidArgument) error.
fn optional_str(args: &Value, field: &str, tool: &str) -> Result<Option<String>, ArgumentError> {
    match args.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(_) => Err(ArgumentError(format!(
            "`{tool}`: argument `{field}` must be a string"
        ))),
    }
}

/// A list-of-task-ids argument. When `required`, an absent key is an error; otherwise it
/// yields an empty list. Every entry must be a string.
fn id_array(
    args: &Value,
    field: &str,
    tool: &str,
    required: bool,
) -> Result<Vec<String>, ArgumentError> {
    match args.get(field) {
        None | Some(Value::Null) => {
            if required {
                Err(ArgumentError(format!(
                    "`{tool}`: missing required argument `{field}` (a list of task ids; pass \
                     `[]` to clear)"
                )))
            } else {
                Ok(Vec::new())
            }
        }
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| match item {
                Value::String(id) => Ok(id.clone()),
                _ => Err(ArgumentError(format!(
                    "`{tool}`: every entry in `{field}` must be a task id string"
                ))),
            })
            .collect(),
        Some(_) => Err(ArgumentError(format!(
            "`{tool}`: argument `{field}` must be an array of task ids"
        ))),
    }
}

// ---------------------------------------------------------------------------
// add_task
// ---------------------------------------------------------------------------

/// Adds a task to the model's DAG.
pub struct AddTaskTool {
    store: Arc<Mutex<TaskStore>>,
}

impl AddTaskTool {
    /// A tool adding tasks to `store`.
    pub fn new(store: Arc<Mutex<TaskStore>>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Tool for AddTaskTool {
    fn name(&self) -> &str {
        ADD_TASK_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            ADD_TASK_TOOL,
            "Add a task to your plan. Provide a unique `id` (a short slug you will use to \
             reference it), a `title`, an optional `description`, and an optional \
             `blockedBy` list of the ids of tasks that must finish first. The list is a DAG \
             — a blocker that would create a cycle is refused.",
            json!({
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string",
                        "description": "A short, unique id for the task (used to reference it)."
                    },
                    "title": {
                        "type": "string",
                        "description": "A short title for the task."
                    },
                    "description": {
                        "type": "string",
                        "description": "An optional longer description of the task."
                    },
                    "blockedBy": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional ids of tasks that must be done before this one."
                    }
                },
                "required": ["id", "title"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let id = match required_str(&args, "id", ADD_TASK_TOOL) {
            Ok(id) => id,
            Err(error) => return error.into(),
        };
        let title = match required_str(&args, "title", ADD_TASK_TOOL) {
            Ok(title) => title,
            Err(error) => return error.into(),
        };
        let description = match optional_str(&args, "description", ADD_TASK_TOOL) {
            Ok(description) => description,
            Err(error) => return error.into(),
        };
        let blocked_by = match id_array(&args, "blockedBy", ADD_TASK_TOOL, false) {
            Ok(blocked_by) => blocked_by,
            Err(error) => return error.into(),
        };
        let mut store = self.store.lock().expect("task store lock");
        match store.add(&id, &title, description.as_deref(), &blocked_by) {
            Ok(TaskChange::Added) => ToolOutcome::ok(
                format!("Added task `{id}`. {}", usage_note(&store)),
                format!("added task `{id}`"),
            )
            .with_data(usage_data(&store)),
            Ok(_) => unreachable!("add yields Added"),
            Err(err) => ToolOutcome::failed(failure_for(&err), format!("add_task: {err}")),
        }
    }
}

// ---------------------------------------------------------------------------
// update_task
// ---------------------------------------------------------------------------

/// Revises a task's title, description, or status.
pub struct UpdateTaskTool {
    store: Arc<Mutex<TaskStore>>,
}

impl UpdateTaskTool {
    /// A tool updating tasks in `store`.
    pub fn new(store: Arc<Mutex<TaskStore>>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Tool for UpdateTaskTool {
    fn name(&self) -> &str {
        UPDATE_TASK_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            UPDATE_TASK_TOOL,
            "Revise a task by `id`: change its `title`, `description`, and/or `status` \
             (`pending`, `in_progress`, or `done`). Supply at least one field to change. To \
             change what a task is blocked by, use `set_blocked_by` instead.",
            json!({
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string",
                        "description": "The id of the task to revise."
                    },
                    "title": {
                        "type": "string",
                        "description": "A new title (replaces the old one)."
                    },
                    "description": {
                        "type": "string",
                        "description": "A new description (empty clears it)."
                    },
                    "status": {
                        "type": "string",
                        "enum": ["pending", "in_progress", "done"],
                        "description": "A new status."
                    }
                },
                "required": ["id"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let id = match required_str(&args, "id", UPDATE_TASK_TOOL) {
            Ok(id) => id,
            Err(error) => return error.into(),
        };
        let title = match optional_str(&args, "title", UPDATE_TASK_TOOL) {
            Ok(title) => title,
            Err(error) => return error.into(),
        };
        let description = match optional_str(&args, "description", UPDATE_TASK_TOOL) {
            Ok(description) => description,
            Err(error) => return error.into(),
        };
        let status = match optional_str(&args, "status", UPDATE_TASK_TOOL) {
            Ok(Some(raw)) => match TaskStatus::parse(&raw) {
                Some(status) => Some(status),
                None => {
                    return invalid_argument(format!(
                        "update_task: `{raw}` is not a valid status; use `pending`, \
                         `in_progress`, or `done`."
                    ));
                }
            },
            Ok(None) => None,
            Err(error) => return error.into(),
        };
        let mut store = self.store.lock().expect("task store lock");
        match store.update(&id, title.as_deref(), description.as_deref(), status) {
            // A revision changes no count, so there is nothing structured to report: the caller
            // asked for a change and got one.
            Ok(TaskChange::Updated) => ToolOutcome::ok(
                format!("Updated task `{id}`."),
                format!("updated task `{id}`"),
            ),
            Ok(_) => unreachable!("update yields Updated"),
            Err(err) => ToolOutcome::failed(failure_for(&err), format!("update_task: {err}")),
        }
    }
}

// ---------------------------------------------------------------------------
// set_blocked_by
// ---------------------------------------------------------------------------

/// Replaces a task's blocked-by set, rejecting any cycle.
pub struct SetBlockedByTool {
    store: Arc<Mutex<TaskStore>>,
}

impl SetBlockedByTool {
    /// A tool setting blocked-by edges in `store`.
    pub fn new(store: Arc<Mutex<TaskStore>>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Tool for SetBlockedByTool {
    fn name(&self) -> &str {
        SET_BLOCKED_BY_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            SET_BLOCKED_BY_TOOL,
            "Set which tasks a task is blocked by. Provide the task `id` and the full \
             `blockedBy` list of task ids that must finish first (pass `[]` to clear all \
             blockers). This replaces the task's current blockers. Any edge that would \
             create a cycle is refused and nothing changes — tasks form a DAG.",
            json!({
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string",
                        "description": "The id of the task whose blockers to set."
                    },
                    "blockedBy": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "The full set of task ids this task is blocked by (`[]` clears)."
                    }
                },
                "required": ["id", "blockedBy"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let id = match required_str(&args, "id", SET_BLOCKED_BY_TOOL) {
            Ok(id) => id,
            Err(error) => return error.into(),
        };
        let blocked_by = match id_array(&args, "blockedBy", SET_BLOCKED_BY_TOOL, true) {
            Ok(blocked_by) => blocked_by,
            Err(error) => return error.into(),
        };
        let mut store = self.store.lock().expect("task store lock");
        match store.set_blocked_by(&id, &blocked_by) {
            Ok(TaskChange::BlockersSet) => {
                let summary = if blocked_by.is_empty() {
                    format!("cleared blockers of `{id}`")
                } else {
                    format!("set blockers of `{id}`")
                };
                ToolOutcome::ok(format!("Updated the blockers of task `{id}`."), summary)
            }
            Ok(_) => unreachable!("set_blocked_by yields BlockersSet"),
            Err(err) => ToolOutcome::failed(failure_for(&err), format!("set_blocked_by: {err}")),
        }
    }
}

// ---------------------------------------------------------------------------
// complete_task
// ---------------------------------------------------------------------------

/// Marks a task done.
pub struct CompleteTaskTool {
    store: Arc<Mutex<TaskStore>>,
}

impl CompleteTaskTool {
    /// A tool completing tasks in `store`.
    pub fn new(store: Arc<Mutex<TaskStore>>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Tool for CompleteTaskTool {
    fn name(&self) -> &str {
        COMPLETE_TASK_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            COMPLETE_TASK_TOOL,
            "Mark a task done by `id`. Tasks blocked by it become actionable once all of \
             their blockers are done. Fails if no task of that id exists.",
            json!({
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string",
                        "description": "The id of the task to mark done."
                    }
                },
                "required": ["id"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let id = match required_str(&args, "id", COMPLETE_TASK_TOOL) {
            Ok(id) => id,
            Err(error) => return error.into(),
        };
        let mut store = self.store.lock().expect("task store lock");
        match store.complete(&id) {
            // Completing a task leaves the list the same size, so — like `update_task` — there is
            // no usage figure worth reporting.
            Ok(TaskChange::Completed) => ToolOutcome::ok(
                format!("Marked task `{id}` done."),
                format!("completed task `{id}`"),
            ),
            Ok(_) => unreachable!("complete yields Completed"),
            Err(err) => ToolOutcome::failed(failure_for(&err), format!("complete_task: {err}")),
        }
    }
}

// ---------------------------------------------------------------------------
// remove_task
// ---------------------------------------------------------------------------

/// Removes a task, dropping any edges pointing at it.
pub struct RemoveTaskTool {
    store: Arc<Mutex<TaskStore>>,
}

impl RemoveTaskTool {
    /// A tool removing tasks from `store`.
    pub fn new(store: Arc<Mutex<TaskStore>>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Tool for RemoveTaskTool {
    fn name(&self) -> &str {
        REMOVE_TASK_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            REMOVE_TASK_TOOL,
            "Remove a task by `id`. It is also dropped from any other task's blockers, so \
             no dangling dependency is left. Fails if no task of that id exists.",
            json!({
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string",
                        "description": "The id of the task to remove."
                    }
                },
                "required": ["id"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let id = match required_str(&args, "id", REMOVE_TASK_TOOL) {
            Ok(id) => id,
            Err(error) => return error.into(),
        };
        let mut store = self.store.lock().expect("task store lock");
        match store.remove(&id) {
            Ok(TaskChange::Removed) => ToolOutcome::ok(
                format!("Removed task `{id}`. {}", usage_note(&store)),
                format!("removed task `{id}`"),
            )
            .with_data(usage_data(&store)),
            Ok(_) => unreachable!("remove yields Removed"),
            Err(err) => ToolOutcome::failed(failure_for(&err), format!("remove_task: {err}")),
        }
    }
}

#[cfg(test)]
#[path = "tasks.test.rs"]
mod tests;
