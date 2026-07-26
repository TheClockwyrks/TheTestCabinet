//! The membrane's knowledge families: the skill library, durable memories, the task DAG, and the
//! epic/issue board — sixteen of the thirty-two functions.
//!
//! They are grouped because they share one shape (a small record in, a usage figure out) and two
//! lowerings that exist nowhere else:
//!
//! * **`in-progress` ⇄ `in_progress`.** WIT identifiers cannot contain an underscore, but gg's
//!   stores and its native tool schemas spell that status with one. The seam is closed here, in
//!   both directions, so a model sees gg's spelling in both execution modes and never learns that
//!   the membrane had an opinion about it.
//! * **Three-way text edits.** gg's schemas use a stringly sentinel — an empty description *clears*
//!   it — which cannot express "leave it alone" except by omitting the key. The membrane's
//!   `text-edit` variant says all three plainly, and this is where `keep` becomes an omitted key,
//!   `clear` becomes the empty string, and `set` becomes the text. The `epic-assignment` variant is
//!   the same idea for an issue's grouping.

use serde_json::{Map, Value, json};

use super::MembraneState;
use super::test_cabinet::gg::board::{
    BoardUsage, CompletionReport, EpicAssignment, EpicInput, Host as BoardHost, IssueInput,
    IssuePatch, IssueStatus,
};
use super::test_cabinet::gg::memories::{Host as MemoriesHost, MemoryInput, MemoryUsage};
use super::test_cabinet::gg::skills::Host as SkillsHost;
use super::test_cabinet::gg::tasks::{
    Host as TasksHost, TaskInput, TaskPatch, TaskStatus, TaskUsage,
};
use super::test_cabinet::gg::types::{TextEdit, ToolError};
use crate::tools::{COMPLETE_ISSUE_TOOL, READ_SKILL_TOOL, ToolData};

/// The `write_memory` tool name.
const WRITE_MEMORY_TOOL: &str = "write_memory";
/// The `update_memory` tool name.
const UPDATE_MEMORY_TOOL: &str = "update_memory";
/// The `delete_memory` tool name.
const DELETE_MEMORY_TOOL: &str = "delete_memory";
/// The `add_task` tool name.
const ADD_TASK_TOOL: &str = "add_task";
/// The `update_task` tool name.
const UPDATE_TASK_TOOL: &str = "update_task";
/// The `set_blocked_by` tool name.
const SET_BLOCKED_BY_TOOL: &str = "set_blocked_by";
/// The `complete_task` tool name.
const COMPLETE_TASK_TOOL: &str = "complete_task";
/// The `remove_task` tool name.
const REMOVE_TASK_TOOL: &str = "remove_task";
/// The `create_epic` tool name.
const CREATE_EPIC_TOOL: &str = "create_epic";
/// The `create_issue` tool name.
const CREATE_ISSUE_TOOL: &str = "create_issue";
/// The `update_issue` tool name.
const UPDATE_ISSUE_TOOL: &str = "update_issue";
/// The `set_issue_blocked_by` tool name.
const SET_ISSUE_BLOCKED_BY_TOOL: &str = "set_issue_blocked_by";
/// The `remove_epic` tool name.
const REMOVE_EPIC_TOOL: &str = "remove_epic";
/// The `remove_issue` tool name.
const REMOVE_ISSUE_TOOL: &str = "remove_issue";

impl SkillsHost for MembraneState {
    fn read_skill(&mut self, name: String) -> Result<String, ToolError> {
        // A skill's body *is* its structured result — there is nothing to describe that the text
        // does not already say — so this is the one tool whose typed result is `outcome.output`
        // itself rather than a sidecar.
        let outcome = self.call(READ_SKILL_TOOL, json!({ "name": name }))?;
        Ok(outcome.output)
    }
}

impl MemoriesHost for MembraneState {
    fn write_memory(&mut self, memory: MemoryInput) -> Result<MemoryUsage, ToolError> {
        let outcome = self.call(WRITE_MEMORY_TOOL, memory_args(memory))?;
        memory_usage(self, WRITE_MEMORY_TOOL, outcome.data)
    }

    fn update_memory(&mut self, memory: MemoryInput) -> Result<MemoryUsage, ToolError> {
        let outcome = self.call(UPDATE_MEMORY_TOOL, memory_args(memory))?;
        memory_usage(self, UPDATE_MEMORY_TOOL, outcome.data)
    }

    fn delete_memory(&mut self, name: String) -> Result<MemoryUsage, ToolError> {
        let outcome = self.call(DELETE_MEMORY_TOOL, json!({ "name": name }))?;
        memory_usage(self, DELETE_MEMORY_TOOL, outcome.data)
    }
}

impl TasksHost for MembraneState {
    fn add_task(&mut self, task: TaskInput) -> Result<TaskUsage, ToolError> {
        let outcome = self.call(
            ADD_TASK_TOOL,
            json!({
                "id": task.id,
                "title": task.title,
                "description": task.description,
                "blockedBy": task.blocked_by,
            }),
        )?;
        task_usage(self, ADD_TASK_TOOL, outcome.data)
    }

    fn update_task(&mut self, id: String, patch: TaskPatch) -> Result<(), ToolError> {
        let mut args = Map::new();
        args.insert("id".to_string(), json!(id));
        args.insert("title".to_string(), json!(patch.title));
        args.insert("status".to_string(), json!(patch.status.map(task_status)));
        insert_text_edit(&mut args, "description", patch.description);
        self.call(UPDATE_TASK_TOOL, Value::Object(args))?;
        Ok(())
    }

    fn set_blocked_by(&mut self, id: String, blocked_by: Vec<String>) -> Result<(), ToolError> {
        self.call(
            SET_BLOCKED_BY_TOOL,
            json!({ "id": id, "blockedBy": blocked_by }),
        )?;
        Ok(())
    }

    fn complete_task(&mut self, id: String) -> Result<(), ToolError> {
        self.call(COMPLETE_TASK_TOOL, json!({ "id": id }))?;
        Ok(())
    }

    fn remove_task(&mut self, id: String) -> Result<TaskUsage, ToolError> {
        let outcome = self.call(REMOVE_TASK_TOOL, json!({ "id": id }))?;
        task_usage(self, REMOVE_TASK_TOOL, outcome.data)
    }
}

impl BoardHost for MembraneState {
    fn create_epic(&mut self, epic: EpicInput) -> Result<BoardUsage, ToolError> {
        let outcome = self.call(
            CREATE_EPIC_TOOL,
            json!({ "id": epic.id, "title": epic.title, "description": epic.description }),
        )?;
        board_usage(self, CREATE_EPIC_TOOL, outcome.data)
    }

    fn create_issue(&mut self, issue: IssueInput) -> Result<BoardUsage, ToolError> {
        let outcome = self.call(
            CREATE_ISSUE_TOOL,
            json!({
                "id": issue.id,
                "title": issue.title,
                "description": issue.description,
                "inScope": issue.in_scope,
                "outOfScope": issue.out_of_scope,
                "completionCriteria": issue.completion_criteria,
                "blockedBy": issue.blocked_by,
                "epicId": issue.epic_id,
            }),
        )?;
        board_usage(self, CREATE_ISSUE_TOOL, outcome.data)
    }

    fn update_issue(&mut self, id: String, patch: IssuePatch) -> Result<(), ToolError> {
        let mut args = Map::new();
        args.insert("id".to_string(), json!(id));
        args.insert("title".to_string(), json!(patch.title));
        args.insert("inScope".to_string(), json!(patch.in_scope));
        args.insert("outOfScope".to_string(), json!(patch.out_of_scope));
        args.insert(
            "completionCriteria".to_string(),
            json!(patch.completion_criteria),
        );
        args.insert("status".to_string(), json!(patch.status.map(issue_status)));
        insert_text_edit(&mut args, "description", patch.description);
        insert_epic_assignment(&mut args, patch.epic);
        self.call(UPDATE_ISSUE_TOOL, Value::Object(args))?;
        Ok(())
    }

    fn set_issue_blocked_by(
        &mut self,
        id: String,
        blocked_by: Vec<String>,
    ) -> Result<(), ToolError> {
        self.call(
            SET_ISSUE_BLOCKED_BY_TOOL,
            json!({ "id": id, "blockedBy": blocked_by }),
        )?;
        Ok(())
    }

    fn complete_issue(&mut self, id: String) -> Result<CompletionReport, ToolError> {
        // With Code Reviews enabled this is the one cheap-looking call that transitively spawns a
        // reviewer (and possibly a fix loop), so the report says whether that happened — a program
        // otherwise has no way to tell a gated acceptance from a plain status change.
        let outcome = self.call(COMPLETE_ISSUE_TOOL, json!({ "id": id }))?;
        match outcome.data {
            Some(ToolData::Completion(completion)) => Ok(CompletionReport {
                code_reviewed: completion.code_reviewed,
                detail: completion.detail,
            }),
            other => Err(self.missing_data(COMPLETE_ISSUE_TOOL, other.as_ref())),
        }
    }

    fn remove_epic(&mut self, id: String) -> Result<BoardUsage, ToolError> {
        let outcome = self.call(REMOVE_EPIC_TOOL, json!({ "id": id }))?;
        board_usage(self, REMOVE_EPIC_TOOL, outcome.data)
    }

    fn remove_issue(&mut self, id: String) -> Result<BoardUsage, ToolError> {
        let outcome = self.call(REMOVE_ISSUE_TOOL, json!({ "id": id }))?;
        board_usage(self, REMOVE_ISSUE_TOOL, outcome.data)
    }
}

/// The three fields both memory mutations take, under the key names their schemas declare.
fn memory_args(memory: MemoryInput) -> Value {
    json!({
        "name": memory.name,
        "description": memory.description,
        "body": memory.body,
    })
}

/// The memory budget a mutation reported, or the defect diagnostic if it reported none.
///
/// It takes the state because that diagnostic also corrects the roster entry the dispatch
/// already wrote, which until this point says the call succeeded.
fn memory_usage(
    state: &mut MembraneState,
    tool: &'static str,
    data: Option<ToolData>,
) -> Result<MemoryUsage, ToolError> {
    match data {
        Some(ToolData::MemoryUsage(usage)) => Ok(MemoryUsage {
            count: usage.count,
            max_count: usage.max_count,
            total_chars: usage.total_chars,
            max_total_chars: usage.max_total_chars,
        }),
        other => Err(state.missing_data(tool, other.as_ref())),
    }
}

/// The task budget a mutation reported, or the defect diagnostic if it reported none — with the
/// same roster correction [`memory_usage`] makes.
fn task_usage(
    state: &mut MembraneState,
    tool: &'static str,
    data: Option<ToolData>,
) -> Result<TaskUsage, ToolError> {
    match data {
        Some(ToolData::TaskUsage(usage)) => Ok(TaskUsage {
            count: usage.count,
            max_tasks: usage.max,
        }),
        other => Err(state.missing_data(tool, other.as_ref())),
    }
}

/// The board budget a mutation reported, or the defect diagnostic if it reported none — with the
/// same roster correction [`memory_usage`] makes.
fn board_usage(
    state: &mut MembraneState,
    tool: &'static str,
    data: Option<ToolData>,
) -> Result<BoardUsage, ToolError> {
    match data {
        Some(ToolData::BoardUsage(usage)) => Ok(BoardUsage {
            epics: usage.epics,
            max_epics: usage.max_epics,
            issues: usage.issues,
            max_issues: usage.max_issues,
        }),
        other => Err(state.missing_data(tool, other.as_ref())),
    }
}

/// A task status in the spelling gg's schema declares — `in_progress`, with the underscore WIT
/// identifiers cannot carry.
fn task_status(status: TaskStatus) -> &'static str {
    match status {
        TaskStatus::Pending => "pending",
        TaskStatus::InProgress => "in_progress",
        TaskStatus::Done => "done",
    }
}

/// An issue status in the spelling gg's schema declares.
fn issue_status(status: IssueStatus) -> &'static str {
    match status {
        IssueStatus::Open => "open",
        IssueStatus::InProgress => "in_progress",
        IssueStatus::Done => "done",
    }
}

/// Lower a three-way [`TextEdit`] onto the schema's stringly sentinel.
///
/// `keep` **omits the key entirely**, which is the only way gg's schemas express "leave this
/// alone"; `clear` sends the empty string the schema documents as "empty clears it"; `set` sends
/// the text. This is the one place the sandbox's clearer vocabulary meets the older one.
fn insert_text_edit(args: &mut Map<String, Value>, key: &str, edit: TextEdit) {
    match edit {
        TextEdit::Keep => {}
        TextEdit::Clear => {
            args.insert(key.to_string(), Value::String(String::new()));
        }
        TextEdit::Set(text) => {
            args.insert(key.to_string(), Value::String(text));
        }
    }
}

/// Lower an [`EpicAssignment`] onto `update_issue`'s `epicId` sentinel: omit to leave the grouping
/// alone, empty string to ungroup, an id to re-group.
fn insert_epic_assignment(args: &mut Map<String, Value>, epic: EpicAssignment) {
    match epic {
        EpicAssignment::Keep => {}
        EpicAssignment::Ungroup => {
            args.insert("epicId".to_string(), Value::String(String::new()));
        }
        EpicAssignment::Set(id) => {
            args.insert("epicId".to_string(), Value::String(id));
        }
    }
}

#[cfg(test)]
#[path = "knowledge.test.rs"]
mod tests;
