//! the epic/issue board — decompose work into dispatchable issues
//!
//! An issue is the heavyweight unit of work — its scope, non-scope and completion criteria are
//! exactly what a delegated child agent is briefed from — which is why
//! [`create_issue`] asks for more than [`tasks::add_task`](crate::tasks::add_task) does.
//!
//! Two of [`IssuePatch`]'s fields are **three-way**, and Rust has an `enum` for exactly that:
//! [`TextEdit`](crate::types::TextEdit) leaves, empties or replaces a description, and
//! [`EpicAssignment`](crate::types::EpicAssignment) leaves, detaches or regroups an epic. Neither
//! needs a sentinel.

use crate::bindings::test_cabinet::gg::board;
use crate::error::ToolError;
use crate::options::{IssueOptions, IssuePatch};
use crate::types::{BoardUsage, EpicCreated, IssueCreated};
use crate::wire;

/// The gg tools this object dispatches — see [`fs::TOOLS`](crate::fs::TOOLS).
pub(crate) const TOOLS: &[&str] = &[
    "create_epic",
    "create_issue",
    "update_issue",
    "set_issue_blocked_by",
    "remove_epic",
    "remove_issue",
    "wait_for_issue",
];

crate::meta::directory_of!("project");

/// Create an epic to group related issues, and hand back the id its prefix resolved to together with
/// the board budget.
///
/// `prefix` is 3-6 letters naming the epic; it is upper-cased and becomes the epic's id, which is
/// also what its issues are numbered from — a prefix of `auth` gives issues `AUTH-1`, `AUTH-2`, and
/// so on.
///
/// # Arguments
///
/// * `prefix` — 3-6 letters naming it. Upper-cased, it becomes the epic's id and the stem its issues
///   are numbered from.
/// * `title` — A short line naming the body of work.
/// * `description` — What the epic covers, for a reader who has not seen its issues.
///
/// # Errors
///
/// `InvalidArgument` when the prefix is not 3-6 letters, and `Conflict` when another epic already
/// holds it.
pub fn create_epic(prefix: &str, title: &str, description: &str) -> Result<EpicCreated, ToolError> {
    wire::lift(board::create_epic(&board::EpicInput {
        prefix: prefix.to_string(),
        title: title.to_string(),
        description: description.to_string(),
    }))
    .map(wire::epic_created)
}

/// Create a self-contained, dispatchable issue, and hand back the id the board **assigned** it
/// together with the board budget.
///
/// The id is numbered under its epic's prefix (`AUTH-1`, `AUTH-2`, …), or under `ISSUE` when it has
/// no epic; you do not choose it, so keep the returned one to block a later issue on this one or to
/// wait for it. `in_scope`, `out_of_scope` and `completion_criteria` are what a child agent is
/// briefed from, so write them for a reader with no other context.
///
/// # Arguments
///
/// * `title` — A short line naming the work.
/// * `in_scope` — What the issue covers, precisely. Part of the brief a child agent is given.
/// * `out_of_scope` — What the issue deliberately does not cover, so the work stops where you meant
///   it to.
/// * `completion_criteria` — What must be true for the issue to be done. It is what a reviewer
///   checks the work against.
/// * `agent` — The agent the issue is dispatched to. It must be one you may spawn.
/// * `options` — The parts you may leave out: a description, blockers, an epic, reviewers.
///
/// # Errors
///
/// `InvalidArgument` when `agent` or a reviewer is not yours to assign, and `Conflict` on a blocker
/// edge that would close a cycle.
pub fn create_issue(
    title: &str,
    in_scope: &str,
    out_of_scope: &str,
    completion_criteria: &str,
    agent: &str,
    options: IssueOptions<'_>,
) -> Result<IssueCreated, ToolError> {
    wire::lift(board::create_issue(&board::IssueInput {
        title: title.to_string(),
        description: options.description.map(str::to_string),
        in_scope: in_scope.to_string(),
        out_of_scope: out_of_scope.to_string(),
        completion_criteria: completion_criteria.to_string(),
        blocked_by: wire::strings(options.blocked_by),
        epic_id: options.epic_id.map(str::to_string),
        agent: agent.to_string(),
        reviewers: wire::strings(options.reviewers),
    }))
    .map(wire::issue_created)
}

/// Revise an issue; supply at least one field.
///
/// A field left at its default is left alone, `description: TextEdit::Clear` empties the
/// description, and `epic: EpicAssignment::Ungroup` detaches the issue from its epic.
///
/// # Arguments
///
/// * `id` — The issue to revise.
/// * `patch` — The fields to change. Supply at least one; a field left at its default is left alone.
///
/// # Errors
///
/// `NotFound` for an unknown id.
pub fn update_issue(id: &str, patch: IssuePatch<'_>) -> Result<(), ToolError> {
    wire::lift(board::update_issue(id, &patch.to_wire()))
}

/// Replace an issue's whole blocker set; an empty slice clears every blocker.
///
/// # Arguments
///
/// * `id` — The issue whose blockers to replace.
/// * `blocked_by` — The ids of every issue that must now be done before it. An empty slice clears
///   them all.
///
/// # Errors
///
/// `NotFound` for an unknown id, and `Conflict` when an edge would close a cycle.
pub fn set_issue_blocked_by(id: &str, blocked_by: &[&str]) -> Result<(), ToolError> {
    wire::lift(board::set_issue_blocked_by(id, &wire::strings(blocked_by)))
}

/// Remove an epic, keeping its issues and ungrouping them, and hand back the board budget.
///
/// # Arguments
///
/// * `id` — The epic to remove.
///
/// # Errors
///
/// `NotFound` for an unknown id.
pub fn remove_epic(id: &str) -> Result<BoardUsage, ToolError> {
    wire::lift(board::remove_epic(id)).map(wire::board_usage)
}

/// Remove an issue and every blocker edge pointing at it, and hand back the board budget.
///
/// # Arguments
///
/// * `id` — The issue to remove.
///
/// # Errors
///
/// `NotFound` for an unknown id.
pub fn remove_issue(id: &str) -> Result<BoardUsage, ToolError> {
    wire::lift(board::remove_issue(id)).map(wire::board_usage)
}

/// Register a wait on an issue and hand back an acknowledgement.
///
/// It does not block inside your program — it records the wait and returns at once, so the rest of
/// your program still runs; the suspension happens after the program ends, between turns. Once the
/// program finishes the run suspends, freeing this agent's slot for others, until the issue is
/// terminal (done, or failed if its assigned agent could not complete it), then resumes on the next
/// turn. Use it to sequence your next turn's work behind an issue you depend on. You cannot wait on
/// the issue you were assigned to implement.
///
/// # Arguments
///
/// * `id` — The issue to wait on. It may not be the issue you were assigned.
///
/// # Errors
///
/// `NotFound` for an unknown id.
pub fn wait_for_issue(id: &str) -> Result<String, ToolError> {
    wire::lift(board::wait_for_issue(id))
}
