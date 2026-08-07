//! The **optional arguments** of the calls that have more than one of them.
//!
//! Rust has no default arguments and no keyword arguments, and the idiom it reaches for instead is a
//! struct that implements [`Default`], filled in with functional-update syntax:
//!
//! ```ignore
//! let head = fs::read_file("src/main.rs", ReadOptions { limit: Some(40), ..Default::default() })?;
//! let all = fs::read_file("src/main.rs", ReadOptions::default())?;
//! ```
//!
//! Two rules decide whether an argument is here at all, and they are the seam's rather than this
//! arm's: **required arguments stay positional**, and an optional one uses the language's own idiom.
//! So a call with exactly one optional argument takes an `Option<T>` in that position —
//! [`system::shell`](crate::system::shell)'s `timeout_secs`, [`programs::get`](crate::programs::get)'s
//! `turn` — because in Rust that *is* the idiom, and an options struct with one field would be
//! ceremony rather than clarity. A call with two or more takes one of these.
//!
//! Every field borrows. A struct built at a call site out of string literals and slices of them is
//! what a Rust author writes, and it is what makes `IssueOptions { blocked_by: &["AUTH-1"],
//! ..Default::default() }` a line rather than four allocations — which is why these types carry a
//! lifetime and why their names appear in signatures as `IssueOptions<'_>`.

use crate::types::{EpicAssignment, IssueStatus, TaskStatus, TextEdit};

/// The window of lines a read covers. [`Default`] reads the whole file.
///
/// Both fields are honoured only under a **capped** read policy; under the unlimited policy the
/// whole file comes back and both are ignored. The system prompt says which policy this run uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ReadOptions {
    /// The 1-based line to start at.
    pub offset: Option<u32>,
    /// How many lines to return from `offset`.
    pub limit: Option<u32>,
}

/// The parts of a new task you may leave out. [`Default`] adds a task with no description and no
/// blockers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TaskOptions<'a> {
    /// What the work is, at whatever length is useful.
    pub description: Option<&'a str>,
    /// The ids of the tasks that must be done before this one.
    pub blocked_by: &'a [&'a str],
}

/// The fields a task revision may change. [`Default`] changes nothing, which the call refuses —
/// supply at least one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TaskPatch<'a> {
    /// The title to replace the old one with.
    pub title: Option<&'a str>,
    /// A three-way edit of the description: [`TextEdit::Keep`] leaves it, [`TextEdit::Clear`] empties
    /// it, [`TextEdit::Set`] replaces it.
    pub description: TextEdit<'a>,
    /// Where the task now stands.
    pub status: Option<TaskStatus>,
}

/// The parts of a new issue you may leave out. [`Default`] creates an ungrouped issue with no
/// description, no blockers and no reviewers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct IssueOptions<'a> {
    /// What the work is. Written for a child agent with no other context.
    pub description: Option<&'a str>,
    /// The ids of every issue that must be done before this one.
    pub blocked_by: &'a [&'a str],
    /// The id of an existing epic to group it under. Leave it out to leave the issue ungrouped and
    /// numbered under `ISSUE`.
    pub epic_id: Option<&'a str>,
    /// The agents that must approve the work, from the set you may spawn. Required when this run's
    /// reviewers feature is on.
    pub reviewers: &'a [&'a str],
}

/// The fields an issue revision may change. [`Default`] changes nothing, which the call refuses —
/// supply at least one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct IssuePatch<'a> {
    /// The title to replace the old one with.
    pub title: Option<&'a str>,
    /// A three-way edit of the description: [`TextEdit::Keep`] leaves it, [`TextEdit::Clear`] empties
    /// it, [`TextEdit::Set`] replaces it.
    pub description: TextEdit<'a>,
    /// The scope statement to replace the old one with.
    pub in_scope: Option<&'a str>,
    /// The non-scope statement to replace the old one with.
    pub out_of_scope: Option<&'a str>,
    /// The completion criteria to replace the old ones with.
    pub completion_criteria: Option<&'a str>,
    /// Where the issue now stands.
    pub status: Option<IssueStatus>,
    /// A three-way change of epic grouping: [`EpicAssignment::Keep`] leaves it,
    /// [`EpicAssignment::Ungroup`] detaches the issue, [`EpicAssignment::Set`] regroups it.
    pub epic: EpicAssignment<'a>,
}

/// The two code halves every write of a memory accepts, and may leave out. [`Default`] records a
/// memory that is only prose.
///
/// Neither is context: they cost you no window, are never shown back to you, and count against no
/// body limit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct MemoryOptions<'a> {
    /// A Rust module whose items are bound at `lib::<name>` in every later program you write, so a
    /// helper you get right once you never write again.
    pub code: Option<&'a str>,
    /// A program gg runs the first time the memory comes into use, whose views reach you on your
    /// next turn.
    pub on_use: Option<&'a str>,
}
