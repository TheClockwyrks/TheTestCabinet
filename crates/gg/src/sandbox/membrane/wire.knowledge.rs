//! The [wire](super)'s knowledge half: the seven memory operations, the five task operations
//! and the seven board operations.
//!
//! This is where the WIT's two `variant`s live — `text-edit` and `epic-assignment` — and they are
//! the reason the encoding has a shape for one at all. Both exist so that "leave the field alone",
//! "empty it" and "set it to this" stop being three readings of one string, and both must survive
//! the crossing as three distinct things or the distinction was pointless. A case gg does not know
//! is a [fault](super::Failure::Fault) rather than a default, for the same reason: silently reading
//! an unknown case as `keep` would turn a drifted SDK into a call that quietly did nothing.

use super::super::test_cabinet::gg::board::{
    BoardUsage, EpicAssignment, EpicCreated, EpicInput, Host as BoardHost, IssueCreated,
    IssueInput, IssuePatch, IssueStatus,
};
use super::super::test_cabinet::gg::memories::{
    Host as MemoriesHost, MemoryEdit, MemoryHit, MemoryInput, MemoryUsage,
};
use super::super::test_cabinet::gg::tasks::{
    Host as TasksHost, TaskInput, TaskPatch, TaskStatus, TaskUsage,
};
use super::super::test_cabinet::gg::types::TextEdit;
use super::super::{MembraneState, ToolApi};
use super::wire_coding::{
    VARIANT_CASE, VARIANT_VALUE, Value, WireFault, argument, integer, optional, record, text,
};
use super::{Answer, Failure};

// ---------------------------------------------------------------------------------------------
// Memories
// ---------------------------------------------------------------------------------------------

/// `memories.write_memory` — write the scratchpad.
pub(super) fn write_memory<A: ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let memory = memory_input(argument(arguments, op, 0)?)?;
    Ok(memory_usage(MemoriesHost::write_memory(state, memory)?))
}

/// `memories.update_memory` — replace an existing memory whole.
pub(super) fn update_memory<A: ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let memory = memory_input(argument(arguments, op, 0)?)?;
    Ok(memory_usage(MemoriesHost::update_memory(state, memory)?))
}

/// `memories.create_memory` — create a memory.
pub(super) fn create_memory<A: ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let memory = memory_input(argument(arguments, op, 0)?)?;
    Ok(memory_usage(MemoriesHost::create_memory(state, memory)?))
}

/// `memories.read_memory` — read one memory.
pub(super) fn read_memory<A: ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let name = argument(arguments, op, 0)?.text("the memory's name")?;
    Ok(text(MemoriesHost::read_memory(state, name)?))
}

/// `memories.edit_memory` — replace one string inside a memory.
pub(super) fn edit_memory<A: ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let edit = argument(arguments, op, 0)?;
    let edit = MemoryEdit {
        name: edit.field("the edit", "name")?.text("the memory's name")?,
        search: edit
            .field("the edit", "search")?
            .text("the text to replace")?,
        replace: edit.field("the edit", "replace")?.text("the replacement")?,
    };
    Ok(memory_usage(MemoriesHost::edit_memory(state, edit)?))
}

/// `memories.search_memories` — search the memory index.
pub(super) fn search_memories<A: ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let keywords = argument(arguments, op, 0)?.texts("a keyword")?;
    Ok(Value::List(
        MemoriesHost::search_memories(state, keywords)?
            .into_iter()
            .map(memory_hit)
            .collect(),
    ))
}

/// `memories.delete_memory` — delete one memory.
pub(super) fn delete_memory<A: ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let name = argument(arguments, op, 0)?.text("the memory's name")?;
    Ok(memory_usage(MemoriesHost::delete_memory(state, name)?))
}

/// The `memory-input` record.
fn memory_input(value: &Value) -> Result<MemoryInput, Failure> {
    Ok(MemoryInput {
        name: value.field("the memory", "name")?.text("the name")?,
        description: value
            .field("the memory", "description")?
            .text("the description")?,
        body: value.field("the memory", "body")?.text("the body")?,
        code: value
            .field("the memory", "code")?
            .optional_text("the code")?,
        on_use: value
            .field("the memory", "on-use")?
            .optional_text("the on-use script")?,
    })
}

/// The `memory-usage` record.
fn memory_usage(usage: MemoryUsage) -> Value {
    record([
        ("count", integer(usage.count)),
        ("max-count", optional(usage.max_count, integer)),
        ("total-chars", integer(usage.total_chars)),
        ("max-total-chars", optional(usage.max_total_chars, integer)),
        ("index-chars", optional(usage.index_chars, integer)),
        ("max-index-chars", optional(usage.max_index_chars, integer)),
    ])
}

/// One `memory-hit`.
fn memory_hit(hit: MemoryHit) -> Value {
    record([
        ("name", text(hit.name)),
        ("description", text(hit.description)),
        ("matched", integer(hit.matched)),
        ("occurrences", integer(hit.occurrences)),
        ("excerpt", text(hit.excerpt)),
    ])
}

// ---------------------------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------------------------

/// `tasks.add_task` — add a task.
pub(super) fn add_task<A: ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let task = argument(arguments, op, 0)?;
    let task = TaskInput {
        id: task.field("the task", "id")?.text("the id")?,
        title: task.field("the task", "title")?.text("the title")?,
        description: task
            .field("the task", "description")?
            .optional_text("the description")?,
        blocked_by: task.field("the task", "blocked-by")?.texts("a task id")?,
    };
    Ok(task_usage(TasksHost::add_task(state, task)?))
}

/// `tasks.update_task` — patch a task.
pub(super) fn update_task<A: ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let id = argument(arguments, op, 0)?.text("the task's id")?;
    let patch = argument(arguments, op, 1)?;
    let patch = TaskPatch {
        title: patch
            .field("the patch", "title")?
            .optional_text("the title")?,
        description: text_edit(patch.field("the patch", "description")?)?,
        status: match patch.field("the patch", "status")? {
            Value::None => None,
            status => Some(task_status(status)?),
        },
    };
    TasksHost::update_task(state, id, patch)?;
    Ok(Value::None)
}

/// `tasks.set_blocked_by` — replace a task's blockers.
pub(super) fn set_blocked_by<A: ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let id = argument(arguments, op, 0)?.text("the task's id")?;
    let blocked_by = argument(arguments, op, 1)?.texts("a task id")?;
    TasksHost::set_blocked_by(state, id, blocked_by)?;
    Ok(Value::None)
}

/// `tasks.complete_task` — mark a task done.
pub(super) fn complete_task<A: ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let id = argument(arguments, op, 0)?.text("the task's id")?;
    TasksHost::complete_task(state, id)?;
    Ok(Value::None)
}

/// `tasks.remove_task` — remove a task.
pub(super) fn remove_task<A: ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let id = argument(arguments, op, 0)?.text("the task's id")?;
    Ok(task_usage(TasksHost::remove_task(state, id)?))
}

/// The `task-usage` record.
fn task_usage(usage: TaskUsage) -> Value {
    record([
        ("count", integer(usage.count)),
        ("max-tasks", integer(usage.max_tasks)),
    ])
}

/// The `task-status` enum.
fn task_status(value: &Value) -> Result<TaskStatus, Failure> {
    match value.text("the status")?.as_str() {
        "pending" => Ok(TaskStatus::Pending),
        "in-progress" => Ok(TaskStatus::InProgress),
        "done" => Ok(TaskStatus::Done),
        other => Err(unknown_case("a task status", other)),
    }
}

// ---------------------------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------------------------

/// `board.create_epic` — create an epic.
pub(super) fn create_epic<A: ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let epic = argument(arguments, op, 0)?;
    let epic = EpicInput {
        prefix: epic.field("the epic", "prefix")?.text("the prefix")?,
        title: epic.field("the epic", "title")?.text("the title")?,
        description: epic
            .field("the epic", "description")?
            .text("the description")?,
    };
    Ok(epic_created(BoardHost::create_epic(state, epic)?))
}

/// `board.create_issue` — create an issue.
pub(super) fn create_issue<A: ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let issue = argument(arguments, op, 0)?;
    let issue = IssueInput {
        title: issue.field("the issue", "title")?.text("the title")?,
        description: issue
            .field("the issue", "description")?
            .optional_text("the description")?,
        in_scope: issue
            .field("the issue", "in-scope")?
            .text("what is in scope")?,
        out_of_scope: issue
            .field("the issue", "out-of-scope")?
            .text("what is out of scope")?,
        completion_criteria: issue
            .field("the issue", "completion-criteria")?
            .text("the completion criteria")?,
        blocked_by: issue
            .field("the issue", "blocked-by")?
            .texts("an issue id")?,
        epic_id: issue
            .field("the issue", "epic-id")?
            .optional_text("the epic's id")?,
        agent: issue.field("the issue", "agent")?.text("the agent")?,
        reviewers: issue.field("the issue", "reviewers")?.texts("a reviewer")?,
    };
    Ok(issue_created(BoardHost::create_issue(state, issue)?))
}

/// `board.update_issue` — patch an issue.
pub(super) fn update_issue<A: ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let id = argument(arguments, op, 0)?.text("the issue's id")?;
    let patch = argument(arguments, op, 1)?;
    let patch = IssuePatch {
        title: patch
            .field("the patch", "title")?
            .optional_text("the title")?,
        description: text_edit(patch.field("the patch", "description")?)?,
        in_scope: patch
            .field("the patch", "in-scope")?
            .optional_text("what is in scope")?,
        out_of_scope: patch
            .field("the patch", "out-of-scope")?
            .optional_text("what is out of scope")?,
        completion_criteria: patch
            .field("the patch", "completion-criteria")?
            .optional_text("the completion criteria")?,
        status: match patch.field("the patch", "status")? {
            Value::None => None,
            status => Some(issue_status(status)?),
        },
        epic: epic_assignment(patch.field("the patch", "epic")?)?,
    };
    BoardHost::update_issue(state, id, patch)?;
    Ok(Value::None)
}

/// `board.set_issue_blocked_by` — replace an issue's blockers.
pub(super) fn set_issue_blocked_by<A: ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let id = argument(arguments, op, 0)?.text("the issue's id")?;
    let blocked_by = argument(arguments, op, 1)?.texts("an issue id")?;
    BoardHost::set_issue_blocked_by(state, id, blocked_by)?;
    Ok(Value::None)
}

/// `board.remove_epic` — remove an epic.
pub(super) fn remove_epic<A: ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let id = argument(arguments, op, 0)?.text("the epic's id")?;
    Ok(board_usage(BoardHost::remove_epic(state, id)?))
}

/// `board.remove_issue` — remove an issue.
pub(super) fn remove_issue<A: ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let id = argument(arguments, op, 0)?.text("the issue's id")?;
    Ok(board_usage(BoardHost::remove_issue(state, id)?))
}

/// `board.wait_for_issue` — park until an issue is unblocked.
pub(super) fn wait_for_issue<A: ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let id = argument(arguments, op, 0)?.text("the issue's id")?;
    Ok(text(BoardHost::wait_for_issue(state, id)?))
}

/// The `board-usage` record.
fn board_usage(usage: BoardUsage) -> Value {
    record([
        ("epics", integer(usage.epics)),
        ("max-epics", integer(usage.max_epics)),
        ("issues", integer(usage.issues)),
        ("max-issues", integer(usage.max_issues)),
    ])
}

/// The `epic-created` record.
fn epic_created(created: EpicCreated) -> Value {
    record([
        ("id", text(created.id)),
        ("board", board_usage(created.board)),
    ])
}

/// The `issue-created` record.
fn issue_created(created: IssueCreated) -> Value {
    record([
        ("id", text(created.id)),
        ("board", board_usage(created.board)),
    ])
}

/// The `issue-status` enum.
fn issue_status(value: &Value) -> Result<IssueStatus, Failure> {
    match value.text("the status")?.as_str() {
        "open" => Ok(IssueStatus::Open),
        "in-progress" => Ok(IssueStatus::InProgress),
        "done" => Ok(IssueStatus::Done),
        other => Err(unknown_case("an issue status", other)),
    }
}

/// The `epic-assignment` variant.
fn epic_assignment(value: &Value) -> Result<EpicAssignment, Failure> {
    match value
        .field("the epic assignment", VARIANT_CASE)?
        .text("the case")?
        .as_str()
    {
        "keep" => Ok(EpicAssignment::Keep),
        "ungroup" => Ok(EpicAssignment::Ungroup),
        "set" => Ok(EpicAssignment::Set(
            value
                .field("the epic assignment", VARIANT_VALUE)?
                .text("the epic's id")?,
        )),
        other => Err(unknown_case("an epic assignment", other)),
    }
}

/// The `text-edit` variant, shared by the task patch and the issue patch.
fn text_edit(value: &Value) -> Result<TextEdit, Failure> {
    match value
        .field("the edit", VARIANT_CASE)?
        .text("the case")?
        .as_str()
    {
        "keep" => Ok(TextEdit::Keep),
        "clear" => Ok(TextEdit::Clear),
        "set" => Ok(TextEdit::Set(
            value.field("the edit", VARIANT_VALUE)?.text("the text")?,
        )),
        other => Err(unknown_case("a text edit", other)),
    }
}

/// A case name gg has no arm for, which is drift between the two artifacts and not a bad argument.
fn unknown_case(what: &str, case: &str) -> Failure {
    Failure::Fault(WireFault::new(format!("`{case}` is not {what} gg has")))
}
