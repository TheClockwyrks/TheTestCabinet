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

use super::test_cabinet::gg::board::{
    BoardUsage, EpicAssignment, EpicInput, Host as BoardHost, IssueInput, IssuePatch, IssueStatus,
};
use super::test_cabinet::gg::memories::{
    Host as MemoriesHost, MemoryEdit, MemoryHit, MemoryInput, MemoryUsage,
};
use super::test_cabinet::gg::skills::Host as SkillsHost;
use super::test_cabinet::gg::tasks::{
    Host as TasksHost, TaskInput, TaskPatch, TaskStatus, TaskUsage,
};
use super::test_cabinet::gg::types::{TextEdit, ToolError};
use super::{MembraneState, ToolApi};
use crate::tools::{READ_SKILL_TOOL, ToolData};

/// The `write_memory` tool name.
const WRITE_MEMORY_TOOL: &str = "write_memory";
/// The `update_memory` tool name.
const UPDATE_MEMORY_TOOL: &str = "update_memory";
/// The `delete_memory` tool name.
const DELETE_MEMORY_TOOL: &str = "delete_memory";
/// The `create_memory` tool name.
const CREATE_MEMORY_TOOL: &str = "create_memory";
/// The `read_memory` tool name.
const READ_MEMORY_TOOL: &str = "read_memory";
/// The `edit_memory` tool name.
const EDIT_MEMORY_TOOL: &str = "edit_memory";
/// The `search_memories` tool name.
const SEARCH_MEMORIES_TOOL: &str = "search_memories";
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
/// The `wait_for_issue` tool name.
const WAIT_FOR_ISSUE_TOOL: &str = "wait_for_issue";

impl<A: ToolApi> SkillsHost for MembraneState<A> {
    fn read_skill(&mut self, name: String) -> Result<String, ToolError> {
        // A skill's body *is* its structured result — there is nothing to describe that the text
        // does not already say — so this is the one tool whose typed result is `outcome.output`
        // itself rather than a sidecar.
        let outcome = self.call(READ_SKILL_TOOL, |api| api.read_skill(name))?;
        Ok(outcome.output)
    }
}

impl<A: ToolApi> MemoriesHost for MembraneState<A> {
    fn write_memory(&mut self, memory: MemoryInput) -> Result<MemoryUsage, ToolError> {
        let MemoryInput {
            name,
            description,
            body,
        } = memory;
        let outcome = self.call(WRITE_MEMORY_TOOL, |api| {
            api.write_memory(name, description, body)
        })?;
        memory_usage(self, WRITE_MEMORY_TOOL, outcome.data)
    }

    fn update_memory(&mut self, memory: MemoryInput) -> Result<MemoryUsage, ToolError> {
        let MemoryInput {
            name,
            description,
            body,
        } = memory;
        let outcome = self.call(UPDATE_MEMORY_TOOL, |api| {
            api.update_memory(name, description, body)
        })?;
        memory_usage(self, UPDATE_MEMORY_TOOL, outcome.data)
    }

    fn create_memory(&mut self, memory: MemoryInput) -> Result<MemoryUsage, ToolError> {
        let MemoryInput {
            name,
            description,
            body,
        } = memory;
        let outcome = self.call(CREATE_MEMORY_TOOL, |api| {
            api.create_memory(name, description, body)
        })?;
        memory_usage(self, CREATE_MEMORY_TOOL, outcome.data)
    }

    fn read_memory(&mut self, name: String) -> Result<String, ToolError> {
        // Like a skill's body, a memory's contents *are* the result: there is nothing to describe
        // that the text does not already say, so this is the second tool whose typed result is
        // `outcome.output` itself rather than a sidecar.
        let outcome = self.call(READ_MEMORY_TOOL, |api| api.read_memory(name))?;
        Ok(outcome.output)
    }

    fn edit_memory(&mut self, edit: MemoryEdit) -> Result<MemoryUsage, ToolError> {
        let MemoryEdit {
            name,
            search,
            replace,
        } = edit;
        let outcome = self.call(EDIT_MEMORY_TOOL, |api| {
            api.edit_memory(name, search, replace)
        })?;
        memory_usage(self, EDIT_MEMORY_TOOL, outcome.data)
    }

    fn search_memories(&mut self, keywords: Vec<String>) -> Result<Vec<MemoryHit>, ToolError> {
        let outcome = self.call(SEARCH_MEMORIES_TOOL, |api| api.search_memories(keywords))?;
        match outcome.data {
            Some(ToolData::MemoryHits(hits)) => Ok(hits
                .into_iter()
                .map(|hit| MemoryHit {
                    name: hit.name,
                    description: hit.description,
                    matched: hit.matched,
                    occurrences: hit.occurrences,
                    excerpt: hit.excerpt,
                })
                .collect()),
            other => Err(self.missing_data(SEARCH_MEMORIES_TOOL, other.as_ref())),
        }
    }

    fn delete_memory(&mut self, name: String) -> Result<MemoryUsage, ToolError> {
        let outcome = self.call(DELETE_MEMORY_TOOL, |api| api.delete_memory(name))?;
        memory_usage(self, DELETE_MEMORY_TOOL, outcome.data)
    }
}

impl<A: ToolApi> TasksHost for MembraneState<A> {
    fn add_task(&mut self, task: TaskInput) -> Result<TaskUsage, ToolError> {
        let TaskInput {
            id,
            title,
            description,
            blocked_by,
        } = task;
        let outcome = self.call(ADD_TASK_TOOL, |api| {
            api.add_task(id, title, description, blocked_by)
        })?;
        task_usage(self, ADD_TASK_TOOL, outcome.data)
    }

    fn update_task(&mut self, id: String, patch: TaskPatch) -> Result<(), ToolError> {
        let description = text_edit(patch.description);
        let status = patch.status.map(task_status);
        self.call(UPDATE_TASK_TOOL, |api| {
            api.update_task(id, patch.title, description, status)
        })?;
        Ok(())
    }

    fn set_blocked_by(&mut self, id: String, blocked_by: Vec<String>) -> Result<(), ToolError> {
        self.call(SET_BLOCKED_BY_TOOL, |api| {
            api.set_blocked_by(id, blocked_by)
        })?;
        Ok(())
    }

    fn complete_task(&mut self, id: String) -> Result<(), ToolError> {
        self.call(COMPLETE_TASK_TOOL, |api| api.complete_task(id))?;
        Ok(())
    }

    fn remove_task(&mut self, id: String) -> Result<TaskUsage, ToolError> {
        let outcome = self.call(REMOVE_TASK_TOOL, |api| api.remove_task(id))?;
        task_usage(self, REMOVE_TASK_TOOL, outcome.data)
    }
}

impl<A: ToolApi> BoardHost for MembraneState<A> {
    fn create_epic(&mut self, epic: EpicInput) -> Result<BoardUsage, ToolError> {
        let EpicInput {
            id,
            title,
            description,
        } = epic;
        let outcome = self.call(CREATE_EPIC_TOOL, |api| {
            api.create_epic(id, title, description)
        })?;
        board_usage(self, CREATE_EPIC_TOOL, outcome.data)
    }

    fn create_issue(&mut self, issue: IssueInput) -> Result<BoardUsage, ToolError> {
        let IssueInput {
            id,
            title,
            description,
            in_scope,
            out_of_scope,
            completion_criteria,
            blocked_by,
            epic_id,
            agent,
            reviewers,
        } = issue;
        let outcome = self.call(CREATE_ISSUE_TOOL, |api| {
            api.create_issue(
                id,
                title,
                description,
                in_scope,
                out_of_scope,
                completion_criteria,
                blocked_by,
                epic_id,
                agent,
                reviewers,
            )
        })?;
        board_usage(self, CREATE_ISSUE_TOOL, outcome.data)
    }

    fn update_issue(&mut self, id: String, patch: IssuePatch) -> Result<(), ToolError> {
        let IssuePatch {
            title,
            description,
            in_scope,
            out_of_scope,
            completion_criteria,
            status,
            epic,
        } = patch;
        let description = text_edit(description);
        let status = status.map(issue_status);
        let epic_id = epic_assignment(epic);
        self.call(UPDATE_ISSUE_TOOL, |api| {
            api.update_issue(
                id,
                title,
                description,
                in_scope,
                out_of_scope,
                completion_criteria,
                status,
                epic_id,
            )
        })?;
        Ok(())
    }

    fn set_issue_blocked_by(
        &mut self,
        id: String,
        blocked_by: Vec<String>,
    ) -> Result<(), ToolError> {
        self.call(SET_ISSUE_BLOCKED_BY_TOOL, |api| {
            api.set_issue_blocked_by(id, blocked_by)
        })?;
        Ok(())
    }

    fn remove_epic(&mut self, id: String) -> Result<BoardUsage, ToolError> {
        let outcome = self.call(REMOVE_EPIC_TOOL, |api| api.remove_epic(id))?;
        board_usage(self, REMOVE_EPIC_TOOL, outcome.data)
    }

    fn remove_issue(&mut self, id: String) -> Result<BoardUsage, ToolError> {
        let outcome = self.call(REMOVE_ISSUE_TOOL, |api| api.remove_issue(id))?;
        board_usage(self, REMOVE_ISSUE_TOOL, outcome.data)
    }

    fn wait_for_issue(&mut self, id: String) -> Result<String, ToolError> {
        // The wait is *deferred*: the api records the requested wait and returns its acknowledgement
        // at once, and the loop suspends the agent after the program ends. So this is a plain
        // string-returning call — the acknowledgement is `outcome.output`, exactly as `read_skill`'s
        // body is — not a blocking one like `wait_for_subagents`.
        let outcome = self.call(WAIT_FOR_ISSUE_TOOL, |api| api.wait_for_issue(id))?;
        Ok(outcome.output)
    }
}

/// The memory budget a mutation reported, or the defect diagnostic if it reported none.
///
/// It takes the state because that diagnostic also corrects the roster entry the dispatch
/// already wrote, which until this point says the call succeeded.
fn memory_usage<A: ToolApi>(
    state: &mut MembraneState<A>,
    tool: &'static str,
    data: Option<ToolData>,
) -> Result<MemoryUsage, ToolError> {
    match data {
        Some(ToolData::MemoryUsage(usage)) => Ok(MemoryUsage {
            count: usage.count,
            max_count: usage.max_count,
            total_chars: usage.total_chars,
            max_total_chars: usage.max_total_chars,
            index_chars: usage.index_chars,
            max_index_chars: usage.max_index_chars,
        }),
        other => Err(state.missing_data(tool, other.as_ref())),
    }
}

/// The task budget a mutation reported, or the defect diagnostic if it reported none — with the
/// same roster correction [`memory_usage`] makes.
fn task_usage<A: ToolApi>(
    state: &mut MembraneState<A>,
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
fn board_usage<A: ToolApi>(
    state: &mut MembraneState<A>,
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

/// The membrane's [`TaskStatus`] as gg's native [task status](crate::tasks::TaskStatus) — the same
/// value the JSON tool-calling path parses from its schema word, now handed to the typed function
/// directly.
fn task_status(status: TaskStatus) -> crate::tasks::TaskStatus {
    match status {
        TaskStatus::Pending => crate::tasks::TaskStatus::Pending,
        TaskStatus::InProgress => crate::tasks::TaskStatus::InProgress,
        TaskStatus::Done => crate::tasks::TaskStatus::Done,
    }
}

/// The membrane's [`IssueStatus`] as gg's native [issue status](crate::board::IssueStatus). The WIT
/// enum carries only the three statuses a program may set; `failed` is a loop-only ending, never a
/// value the guest names.
fn issue_status(status: IssueStatus) -> crate::board::IssueStatus {
    match status {
        IssueStatus::Open => crate::board::IssueStatus::Open,
        IssueStatus::InProgress => crate::board::IssueStatus::InProgress,
        IssueStatus::Done => crate::board::IssueStatus::Done,
    }
}

/// Lower a three-way [`TextEdit`] onto the `Option<String>` the typed functions take, which carries
/// the same stringly sentinel gg's schemas do: `keep` is `None` (leave it alone), `clear` is the
/// empty string (which clears it), `set` is the text. This is the one place the sandbox's clearer
/// vocabulary meets the older one.
fn text_edit(edit: TextEdit) -> Option<String> {
    match edit {
        TextEdit::Keep => None,
        TextEdit::Clear => Some(String::new()),
        TextEdit::Set(text) => Some(text),
    }
}

/// Lower an [`EpicAssignment`] onto `update_issue`'s `epic_id` sentinel: `None` leaves the grouping
/// alone, the empty string ungroups, an id re-groups.
fn epic_assignment(epic: EpicAssignment) -> Option<String> {
    match epic {
        EpicAssignment::Keep => None,
        EpicAssignment::Ungroup => Some(String::new()),
        EpicAssignment::Set(id) => Some(id),
    }
}

#[cfg(test)]
#[path = "knowledge.test.rs"]
mod tests;
