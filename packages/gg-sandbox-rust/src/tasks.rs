//! A private task list, kept as a directed acyclic graph rather than as a list of lines.
//!
//! Every task may name the tasks that must finish before it, and an edge that would close a cycle is
//! refused.
//!
//! One spelling here is worth reading twice. [`TaskPatch`]'s description is a three-way edit, and
//! [`TextEdit`] says all three without a sentinel: [`Keep`](TextEdit::Keep) keeps the description
//! that is there, [`Clear`](TextEdit::Clear) empties it, [`Set`](TextEdit::Set) replaces it.

use crate::bindings::test_cabinet::gg::tasks;
use crate::core::ToolError;
use crate::wire;

/// The gg tools this module dispatches — see [`files::TOOLS`](crate::files::TOOLS).
pub(crate) const TOOLS: &[&str] = &[
    "add_task",
    "update_task",
    "set_blocked_by",
    "complete_task",
    "remove_task",
];

crate::directory::directory_of!();

/// Add a task to the task graph and hand back the task budget.
///
/// `options.blocked_by` names the tasks that must finish before this one, and defaults to none.
///
/// # Arguments
///
/// * `id` — The id chosen for it. Every other task call takes it, and no two tasks may share one.
/// * `title` — A short line naming the work.
/// * `options` — The parts that may be left out: a description, and the tasks this one waits on.
///
/// # Errors
///
/// `InvalidArgument` for a blank id or title, `Conflict` on a duplicate id or an edge that would
/// close a cycle, `NotFound` for an unknown blocker, and `LimitExceeded` at the task cap.
#[doc(alias = "ggop:tasks.add_task")]
pub fn add_task(id: &str, title: &str, options: TaskOptions<'_>) -> Result<TaskUsage, ToolError> {
    wire::lift(tasks::add_task(&tasks::TaskInput {
        id: id.to_string(),
        title: title.to_string(),
        description: options.description.map(str::to_string),
        blocked_by: wire::strings(options.blocked_by),
    }))
    .map(wire::task_usage)
}

/// Revise a task's title, description or status; at least one must be supplied.
///
/// A field left at its default is left alone, `description: TextEdit::Clear` empties it, and
/// `description: TextEdit::Set(…)` replaces it.
///
/// # Arguments
///
/// * `id` — The task to revise.
/// * `patch` — The fields to change. At least one; a field left at its default is left alone.
///
/// # Errors
///
/// `InvalidArgument` when no field was supplied or one was blanked, and `NotFound` for an unknown
/// id.
#[doc(alias = "ggop:tasks.update_task")]
pub fn update_task(id: &str, patch: TaskPatch<'_>) -> Result<(), ToolError> {
    wire::lift(tasks::update_task(id, &patch.to_wire()))
}

/// Replace a task's whole blocker set; an empty slice clears every blocker.
///
/// # Arguments
///
/// * `id` — The task whose blockers to replace.
/// * `blocked_by` — The ids of every task that must now be done before it. An empty slice clears them
///   all.
///
/// # Errors
///
/// `InvalidArgument` for a blank id or blocker, `NotFound` for a task or blocker that is not on the
/// list, and `Conflict` when an edge would close a cycle or block the task on itself.
#[doc(alias = "ggop:tasks.set_blocked_by")]
pub fn set_blocked_by(id: &str, blocked_by: &[&str]) -> Result<(), ToolError> {
    wire::lift(tasks::set_blocked_by(id, &wire::strings(blocked_by)))
}

/// Mark a task done.
///
/// Tasks it was blocking become actionable once every one of their blockers is done.
///
/// # Arguments
///
/// * `id` — The task to mark done.
///
/// # Errors
///
/// `NotFound` for an unknown id.
#[doc(alias = "ggop:tasks.complete_task")]
pub fn complete_task(id: &str) -> Result<(), ToolError> {
    wire::lift(tasks::complete_task(id))
}

/// Remove a task and every blocker edge pointing at it.
///
/// # Arguments
///
/// * `id` — The task to remove.
///
/// # Errors
///
/// `NotFound` for an unknown id.
#[doc(alias = "ggop:tasks.remove_task")]
pub fn remove_task(id: &str) -> Result<TaskUsage, ToolError> {
    wire::lift(tasks::remove_task(id)).map(wire::task_usage)
}

/// Where a task stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TaskStatus {
    /// Not started. Every task begins here.
    Pending,
    /// Being worked on now.
    InProgress,
    /// Finished. Tasks blocked on it become actionable once all their blockers are done.
    Done,
}

/// How much of the run's task budget is used, after the call that returned it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TaskUsage {
    /// Tasks currently on the list.
    pub count: u32,
    /// The most tasks this run allows.
    pub max_tasks: u32,
}

/// The parts of a new task that may be left out.
///
/// [`Default`] adds a task with no description and no blockers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TaskOptions<'a> {
    /// What the work is, at whatever length is useful.
    pub description: Option<&'a str>,
    /// The ids of the tasks that must be done before this one.
    pub blocked_by: &'a [&'a str],
}

/// The fields a task revision may change.
///
/// [`Default`] changes nothing, which the call refuses — at least one field must be supplied.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TaskPatch<'a> {
    /// The title to replace the old one with.
    pub title: Option<&'a str>,
    /// A three-way edit of the description.
    ///
    /// [`TextEdit::Keep`] leaves it, [`TextEdit::Clear`] empties it, [`TextEdit::Set`] replaces it.
    pub description: TextEdit<'a>,
    /// Where the task now stands.
    pub status: Option<TaskStatus>,
}

/// A three-way edit of an optional text field: leave it, empty it, or replace it.
///
/// It is an `enum` because the field really has three states: an `Option<&str>` could say only two,
/// and would make "clear it" and "set it to the empty string" one request.
///
/// [`Keep`](Self::Keep) is the [`Default`], so a patch built with `..Default::default()` leaves the
/// field alone — which is what leaving a field out of a patch has to mean. The board's
/// [`IssuePatch`](crate::board::IssuePatch) takes the same type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TextEdit<'a> {
    /// Leave the field as it is.
    #[default]
    Keep,
    /// Empty the field.
    Clear,
    /// Replace the field with this text.
    Set(&'a str),
}
