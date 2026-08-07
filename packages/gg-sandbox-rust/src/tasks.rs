//! your task list
//!
//! A DAG rather than a list of lines: every task may name the tasks that must finish before it, and
//! an edge that would close a cycle is refused.
//!
//! One spelling in here is worth reading twice. [`TaskPatch`]'s `description` is a **three-way**
//! edit, and [`TextEdit`](crate::types::TextEdit) says all three without a sentinel: leave it at
//! [`Keep`](crate::types::TextEdit::Keep) to keep the description you have,
//! [`Clear`](crate::types::TextEdit::Clear) to empty it, [`Set`](crate::types::TextEdit::Set) to
//! replace it.

use crate::bindings::test_cabinet::gg::tasks;
use crate::error::ToolError;
use crate::options::{TaskOptions, TaskPatch};
use crate::types::TaskUsage;
use crate::wire;

/// The gg tools this object dispatches — see [`fs::TOOLS`](crate::fs::TOOLS).
pub(crate) const TOOLS: &[&str] = &[
    "add_task",
    "update_task",
    "set_blocked_by",
    "complete_task",
    "remove_task",
];

crate::meta::directory_of!("tasks");

/// Add a task to the task DAG and hand back the task budget.
///
/// `options.blocked_by` names the tasks that must finish before this one and defaults to none.
///
/// # Arguments
///
/// * `id` — The id you choose for it. It is what every other task call takes, and no two tasks may
///   share one.
/// * `title` — A short line naming the work.
/// * `options` — The parts you may leave out: a description, and the tasks this one waits on.
///
/// # Errors
///
/// `Conflict` on a duplicate id or on an edge that would close a cycle.
pub fn add_task(id: &str, title: &str, options: TaskOptions<'_>) -> Result<TaskUsage, ToolError> {
    wire::lift(tasks::add_task(&tasks::TaskInput {
        id: id.to_string(),
        title: title.to_string(),
        description: options.description.map(str::to_string),
        blocked_by: wire::strings(options.blocked_by),
    }))
    .map(wire::task_usage)
}

/// Revise a task's title, description and/or status; supply at least one.
///
/// A field left at its default is left alone, `description: TextEdit::Clear` empties it, and
/// `description: TextEdit::Set(…)` replaces it.
///
/// # Arguments
///
/// * `id` — The task to revise.
/// * `patch` — The fields to change. Supply at least one; a field left at its default is left alone.
///
/// # Errors
///
/// `NotFound` for an unknown id.
pub fn update_task(id: &str, patch: TaskPatch<'_>) -> Result<(), ToolError> {
    wire::lift(tasks::update_task(id, &patch.to_wire()))
}

/// Replace a task's whole blocker set; an empty slice clears every blocker.
///
/// # Arguments
///
/// * `id` — The task whose blockers to replace.
/// * `blocked_by` — The ids of every task that must now be done before it. An empty slice clears
///   them all.
///
/// # Errors
///
/// `NotFound` for an unknown id, and `Conflict` when an edge would close a cycle.
pub fn set_blocked_by(id: &str, blocked_by: &[&str]) -> Result<(), ToolError> {
    wire::lift(tasks::set_blocked_by(id, &wire::strings(blocked_by)))
}

/// Mark a task done. Tasks it was blocking become actionable once every one of their blockers is
/// done.
///
/// # Arguments
///
/// * `id` — The task to mark done.
///
/// # Errors
///
/// `NotFound` for an unknown id.
pub fn complete_task(id: &str) -> Result<(), ToolError> {
    wire::lift(tasks::complete_task(id))
}

/// Remove a task and every blocker edge pointing at it, and hand back the task budget.
///
/// # Arguments
///
/// * `id` — The task to remove.
///
/// # Errors
///
/// `NotFound` for an unknown id.
pub fn remove_task(id: &str) -> Result<TaskUsage, ToolError> {
    wire::lift(tasks::remove_task(id)).map(wire::task_usage)
}
