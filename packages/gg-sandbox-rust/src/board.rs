//! The epic and issue board, on which work is decomposed into dispatchable units.
//!
//! An issue is heavyweight and self-contained: its scope, non-scope and completion criteria are
//! exactly what a delegated child agent is briefed from, which is why [`create_issue`] asks for more
//! than [`tasks::add_task`](crate::tasks::add_task) does.
//!
//! Two of [`IssuePatch`]'s fields are three-way, and Rust has an `enum` for exactly that:
//! [`TextEdit`] leaves, empties or replaces a description, and
//! [`EpicAssignment`] leaves, detaches or regroups an epic. Neither needs a sentinel.

use crate::bindings::test_cabinet::gg::board;
use crate::core::ToolError;
use crate::tasks::TextEdit;
use crate::wire;

/// The gg tools this module dispatches — see [`files::TOOLS`](crate::files::TOOLS).
pub(crate) const TOOLS: &[&str] = &[
    "create_epic",
    "create_issue",
    "update_issue",
    "set_issue_blocked_by",
    "remove_epic",
    "remove_issue",
    "wait_for_issue",
];


/// Create an epic to group related issues, and hand back the id its prefix resolved to.
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
/// `InvalidArgument` when the prefix is not 3-6 letters or a required field is blank, `Conflict`
/// when another epic already holds the prefix, and `LimitExceeded` at the board's epic cap.
#[doc(alias = "ggop:board.create_epic")]
pub fn create_epic(prefix: &str, title: &str, description: &str) -> Result<EpicCreated, ToolError> {
    wire::lift(board::create_epic(&board::EpicInput {
        prefix: prefix.to_string(),
        title: title.to_string(),
        description: description.to_string(),
    }))
    .map(wire::epic_created)
}

/// Create a self-contained, dispatchable issue, and hand back the id the board assigned it.
///
/// The id is numbered under its epic's prefix (`AUTH-1`, `AUTH-2`, …), or under `ISSUE` when it has
/// no epic. It is the board's to choose, so it is worth keeping: blocking a later issue on this one,
/// and waiting for it, both take it. `in_scope`, `out_of_scope` and `completion_criteria` are what a
/// child agent is briefed from, so they are written for a reader with no other context.
///
/// # Arguments
///
/// * `title` — A short line naming the work.
/// * `in_scope` — What the issue covers, precisely. Part of the brief a child agent is given.
/// * `out_of_scope` — What the issue deliberately does not cover, so the work stops where it was
///   meant to.
/// * `completion_criteria` — What must be true for the issue to be done. It is what a reviewer checks
///   the work against.
/// * `agent` — The agent the issue is dispatched to. It must be one this agent may spawn.
/// * `options` — The parts that may be left out: a description, blockers, an epic, reviewers.
///
/// # Errors
///
/// `InvalidArgument` when a required field is blank or `agent`/a reviewer is not one this agent may
/// assign, `NotFound` for an unknown epic or blocker, and `LimitExceeded` at the board's issue cap.
#[doc(alias = "ggop:board.create_issue")]
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

/// Revise an issue; at least one field must be supplied.
///
/// A field left at its default is left alone, `description: TextEdit::Clear` empties the description,
/// and `epic: EpicAssignment::Ungroup` detaches the issue from its epic.
///
/// # Arguments
///
/// * `id` — The issue to revise.
/// * `patch` — The fields to change. At least one; a field left at its default is left alone.
///
/// # Errors
///
/// `InvalidArgument` when no field was supplied or one was blanked, and `NotFound` for an unknown
/// issue or epic id.
#[doc(alias = "ggop:board.update_issue")]
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
/// `InvalidArgument` for a blank id or blocker, `NotFound` for an issue or blocker the board does not
/// hold, and `Conflict` when an edge would close a cycle or block the issue on itself.
#[doc(alias = "ggop:board.set_issue_blocked_by")]
pub fn set_issue_blocked_by(id: &str, blocked_by: &[&str]) -> Result<(), ToolError> {
    wire::lift(board::set_issue_blocked_by(id, &wire::strings(blocked_by)))
}

/// Remove an epic, keeping its issues and ungrouping them.
///
/// # Arguments
///
/// * `id` — The epic to remove.
///
/// # Errors
///
/// `NotFound` for an unknown id.
#[doc(alias = "ggop:board.remove_epic")]
pub fn remove_epic(id: &str) -> Result<BoardUsage, ToolError> {
    wire::lift(board::remove_epic(id)).map(wire::board_usage)
}

/// Remove an issue and every blocker edge pointing at it.
///
/// # Arguments
///
/// * `id` — The issue to remove.
///
/// # Errors
///
/// `NotFound` for an unknown id.
#[doc(alias = "ggop:board.remove_issue")]
pub fn remove_issue(id: &str) -> Result<BoardUsage, ToolError> {
    wire::lift(board::remove_issue(id)).map(wire::board_usage)
}

/// Register a wait on an issue and hand back an acknowledgement.
///
/// Nothing blocks inside the program: the wait is recorded and the call returns at once, so the rest
/// of the program still runs. The suspension happens after the program ends, between turns — the run
/// frees this agent's slot until the issue is terminal, done or failed, then resumes on the next
/// turn. It is how a turn's work is sequenced behind an issue it depends on. The issue this agent was
/// assigned to implement is the one issue it may not wait on.
///
/// # Arguments
///
/// * `id` — The issue to wait on. It may not be the issue this agent was assigned.
///
/// # Errors
///
/// `InvalidArgument` for a blank id, or for this agent's own assigned issue, `NotFound` for an id
/// the board does not hold, and `Unavailable` when the run has no board.
#[doc(alias = "ggop:board.wait_for_issue")]
pub fn wait_for_issue(id: &str) -> Result<String, ToolError> {
    wire::lift(board::wait_for_issue(id))
}

/// How much of the run's board budget is used, after the call that returned it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BoardUsage {
    /// Epics currently on the board.
    pub epics: u32,
    /// The most epics this run allows.
    pub max_epics: u32,
    /// Issues currently on the board.
    pub issues: u32,
    /// The most issues this run allows.
    pub max_issues: u32,
}

/// An epic that was just created: the id its prefix resolved to, and the board budget.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EpicCreated {
    /// The epic's id — the given prefix, upper-cased (`auth` → `AUTH`).
    ///
    /// It is what groups issues under the epic, and the stem its issues are numbered from (`AUTH-1`).
    pub id: String,
    /// How much of the board budget is used.
    pub board: BoardUsage,
}

/// An issue that was just created: the id the board assigned it, and the board budget.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IssueCreated {
    /// The id the board assigned (`AUTH-1`), which is the board's to choose rather than the caller's.
    ///
    /// It is what blocks a later issue on this one, and what waits for it.
    pub id: String,
    /// How much of the board budget is used.
    pub board: BoardUsage,
}

/// Where an issue stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum IssueStatus {
    /// Not started, and dispatchable once its blockers are done.
    Open,
    /// Dispatched, with its assigned agent working on it.
    InProgress,
    /// Finished and, where this run requires reviewers, approved.
    Done,
}

/// The parts of a new issue that may be left out.
///
/// [`Default`] creates an ungrouped issue with no description, no blockers and no reviewers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct IssueOptions<'a> {
    /// What the work is. Written for a child agent with no other context.
    pub description: Option<&'a str>,
    /// The ids of every issue that must be done before this one.
    pub blocked_by: &'a [&'a str],
    /// The id of an existing epic to group it under.
    ///
    /// Left out, the issue is ungrouped and numbered under `ISSUE`.
    pub epic_id: Option<&'a str>,
    /// The agents that must approve the work, from the set this agent may spawn.
    ///
    /// Required when this run's reviewers feature is on.
    pub reviewers: &'a [&'a str],
}

/// The fields an issue revision may change.
///
/// [`Default`] changes nothing, which the call refuses — at least one field must be supplied.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct IssuePatch<'a> {
    /// The title to replace the old one with.
    pub title: Option<&'a str>,
    /// A three-way edit of the description.
    ///
    /// [`TextEdit::Keep`] leaves it, [`TextEdit::Clear`] empties it, [`TextEdit::Set`] replaces
    /// it.
    pub description: TextEdit<'a>,
    /// The scope statement to replace the old one with.
    pub in_scope: Option<&'a str>,
    /// The non-scope statement to replace the old one with.
    pub out_of_scope: Option<&'a str>,
    /// The completion criteria to replace the old ones with.
    pub completion_criteria: Option<&'a str>,
    /// Where the issue now stands.
    pub status: Option<IssueStatus>,
    /// A three-way change of epic grouping.
    ///
    /// [`EpicAssignment::Keep`] leaves it, [`EpicAssignment::Ungroup`] detaches the issue,
    /// [`EpicAssignment::Set`] regroups it.
    pub epic: EpicAssignment<'a>,
}

/// How an issue's epic grouping changes.
///
/// The same three-way shape as [`TextEdit`], for a field whose value is an epic id.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum EpicAssignment<'a> {
    /// Leave the grouping alone.
    #[default]
    Keep,
    /// Detach the issue from its epic, leaving it ungrouped.
    Ungroup,
    /// Group the issue under this epic, by its id.
    Set(&'a str),
}
