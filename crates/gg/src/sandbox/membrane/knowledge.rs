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
    BoardUsage, EpicAssignment, EpicCreated, EpicInput, Host as BoardHost, IssueCreated,
    IssueInput, IssuePatch, IssueStatus,
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
use crate::memories::MemoryCode;
use crate::sandbox::language::{
    MEMORY_CREATE_MEMORY, MEMORY_DELETE_MEMORY, MEMORY_EDIT_MEMORY, MEMORY_READ_MEMORY,
    MEMORY_SEARCH_MEMORIES, MEMORY_UPDATE_MEMORY, MEMORY_WRITE_MEMORY, PROJECT_CREATE_EPIC,
    PROJECT_CREATE_ISSUE, PROJECT_REMOVE_EPIC, PROJECT_REMOVE_ISSUE, PROJECT_SET_ISSUE_BLOCKED_BY,
    PROJECT_UPDATE_ISSUE, PROJECT_WAIT_FOR_ISSUE, SKILLS_READ_SKILL, TASKS_ADD_TASK,
    TASKS_COMPLETE_TASK, TASKS_REMOVE_TASK, TASKS_SET_BLOCKED_BY, TASKS_UPDATE_TASK,
};
use crate::tools::{BoardUsageData, READ_SKILL_TOOL, ToolData};

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
        self.recorded(SKILLS_READ_SKILL, |state, rec| {
            let outcome = state.call(rec, READ_SKILL_TOOL, |api| api.read_skill(name))?;
            Ok(outcome.output)
        })
    }
}

impl<A: ToolApi> MemoriesHost for MembraneState<A> {
    fn write_memory(&mut self, memory: MemoryInput) -> Result<MemoryUsage, ToolError> {
        self.recorded(MEMORY_WRITE_MEMORY, |state, rec| {
            let MemoryInput {
                name,
                description,
                body,
                code,
                on_use,
            } = memory;
            let code = MemoryCode { code, on_use };
            let outcome = state.call(rec, WRITE_MEMORY_TOOL, |api| {
                api.write_memory(name, description, body, code)
            })?;
            memory_usage(state, WRITE_MEMORY_TOOL, outcome.data)
        })
    }

    fn update_memory(&mut self, memory: MemoryInput) -> Result<MemoryUsage, ToolError> {
        self.recorded(MEMORY_UPDATE_MEMORY, |state, rec| {
            let MemoryInput {
                name,
                description,
                body,
                code,
                on_use,
            } = memory;
            let code = MemoryCode { code, on_use };
            let outcome = state.call(rec, UPDATE_MEMORY_TOOL, |api| {
                api.update_memory(name, description, body, code)
            })?;
            memory_usage(state, UPDATE_MEMORY_TOOL, outcome.data)
        })
    }

    fn create_memory(&mut self, memory: MemoryInput) -> Result<MemoryUsage, ToolError> {
        self.recorded(MEMORY_CREATE_MEMORY, |state, rec| {
            let MemoryInput {
                name,
                description,
                body,
                code,
                on_use,
            } = memory;
            let code = MemoryCode { code, on_use };
            let outcome = state.call(rec, CREATE_MEMORY_TOOL, |api| {
                api.create_memory(name, description, body, code)
            })?;
            memory_usage(state, CREATE_MEMORY_TOOL, outcome.data)
        })
    }

    fn read_memory(&mut self, name: String) -> Result<String, ToolError> {
        // Like a skill's body, a memory's contents *are* the result: there is nothing to describe
        // that the text does not already say, so this is the second tool whose typed result is
        // `outcome.output` itself rather than a sidecar.
        self.recorded(MEMORY_READ_MEMORY, |state, rec| {
            let outcome = state.call(rec, READ_MEMORY_TOOL, |api| api.read_memory(name))?;
            Ok(outcome.output)
        })
    }

    fn edit_memory(&mut self, edit: MemoryEdit) -> Result<MemoryUsage, ToolError> {
        self.recorded(MEMORY_EDIT_MEMORY, |state, rec| {
            let MemoryEdit {
                name,
                search,
                replace,
            } = edit;
            let outcome = state.call(rec, EDIT_MEMORY_TOOL, |api| {
                api.edit_memory(name, search, replace)
            })?;
            memory_usage(state, EDIT_MEMORY_TOOL, outcome.data)
        })
    }

    fn search_memories(&mut self, keywords: Vec<String>) -> Result<Vec<MemoryHit>, ToolError> {
        self.recorded(MEMORY_SEARCH_MEMORIES, |state, rec| {
            let outcome = state.call(rec, SEARCH_MEMORIES_TOOL, |api| {
                api.search_memories(keywords)
            })?;
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
                other => Err(state.missing_data(SEARCH_MEMORIES_TOOL, other.as_ref())),
            }
        })
    }

    fn delete_memory(&mut self, name: String) -> Result<MemoryUsage, ToolError> {
        self.recorded(MEMORY_DELETE_MEMORY, |state, rec| {
            let outcome = state.call(rec, DELETE_MEMORY_TOOL, |api| api.delete_memory(name))?;
            memory_usage(state, DELETE_MEMORY_TOOL, outcome.data)
        })
    }
}

impl<A: ToolApi> TasksHost for MembraneState<A> {
    fn add_task(&mut self, task: TaskInput) -> Result<TaskUsage, ToolError> {
        self.recorded(TASKS_ADD_TASK, |state, rec| {
            let TaskInput {
                id,
                title,
                description,
                blocked_by,
            } = task;
            let outcome = state.call(rec, ADD_TASK_TOOL, |api| {
                api.add_task(id, title, description, blocked_by)
            })?;
            task_usage(state, ADD_TASK_TOOL, outcome.data)
        })
    }

    fn update_task(&mut self, id: String, patch: TaskPatch) -> Result<(), ToolError> {
        self.recorded(TASKS_UPDATE_TASK, |state, rec| {
            let description = text_edit(patch.description);
            let status = patch.status.map(task_status);
            state.call(rec, UPDATE_TASK_TOOL, |api| {
                api.update_task(id, patch.title, description, status)
            })?;
            Ok(())
        })
    }

    fn set_blocked_by(&mut self, id: String, blocked_by: Vec<String>) -> Result<(), ToolError> {
        self.recorded(TASKS_SET_BLOCKED_BY, |state, rec| {
            state.call(rec, SET_BLOCKED_BY_TOOL, |api| {
                api.set_blocked_by(id, blocked_by)
            })?;
            Ok(())
        })
    }

    fn complete_task(&mut self, id: String) -> Result<(), ToolError> {
        self.recorded(TASKS_COMPLETE_TASK, |state, rec| {
            state.call(rec, COMPLETE_TASK_TOOL, |api| api.complete_task(id))?;
            Ok(())
        })
    }

    fn remove_task(&mut self, id: String) -> Result<TaskUsage, ToolError> {
        self.recorded(TASKS_REMOVE_TASK, |state, rec| {
            let outcome = state.call(rec, REMOVE_TASK_TOOL, |api| api.remove_task(id))?;
            task_usage(state, REMOVE_TASK_TOOL, outcome.data)
        })
    }
}

impl<A: ToolApi> BoardHost for MembraneState<A> {
    fn create_epic(&mut self, epic: EpicInput) -> Result<EpicCreated, ToolError> {
        self.recorded(PROJECT_CREATE_EPIC, |state, rec| {
            let EpicInput {
                prefix,
                title,
                description,
            } = epic;
            let outcome = state.call(rec, CREATE_EPIC_TOOL, |api| {
                api.create_epic(prefix, title, description)
            })?;
            let (id, board) = board_node(state, CREATE_EPIC_TOOL, outcome.data)?;
            Ok(EpicCreated { id, board })
        })
    }

    fn create_issue(&mut self, issue: IssueInput) -> Result<IssueCreated, ToolError> {
        self.recorded(PROJECT_CREATE_ISSUE, |state, rec| {
            let IssueInput {
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
            let outcome = state.call(rec, CREATE_ISSUE_TOOL, |api| {
                api.create_issue(
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
            let (id, board) = board_node(state, CREATE_ISSUE_TOOL, outcome.data)?;
            Ok(IssueCreated { id, board })
        })
    }

    fn update_issue(&mut self, id: String, patch: IssuePatch) -> Result<(), ToolError> {
        self.recorded(PROJECT_UPDATE_ISSUE, |state, rec| {
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
            state.call(rec, UPDATE_ISSUE_TOOL, |api| {
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
        })
    }

    fn set_issue_blocked_by(
        &mut self,
        id: String,
        blocked_by: Vec<String>,
    ) -> Result<(), ToolError> {
        self.recorded(PROJECT_SET_ISSUE_BLOCKED_BY, |state, rec| {
            state.call(rec, SET_ISSUE_BLOCKED_BY_TOOL, |api| {
                api.set_issue_blocked_by(id, blocked_by)
            })?;
            Ok(())
        })
    }

    fn remove_epic(&mut self, id: String) -> Result<BoardUsage, ToolError> {
        self.recorded(PROJECT_REMOVE_EPIC, |state, rec| {
            let outcome = state.call(rec, REMOVE_EPIC_TOOL, |api| api.remove_epic(id))?;
            board_usage(state, REMOVE_EPIC_TOOL, outcome.data)
        })
    }

    fn remove_issue(&mut self, id: String) -> Result<BoardUsage, ToolError> {
        self.recorded(PROJECT_REMOVE_ISSUE, |state, rec| {
            let outcome = state.call(rec, REMOVE_ISSUE_TOOL, |api| api.remove_issue(id))?;
            board_usage(state, REMOVE_ISSUE_TOOL, outcome.data)
        })
    }

    fn wait_for_issue(&mut self, id: String) -> Result<String, ToolError> {
        // The wait is *deferred*: the api records the requested wait and returns its acknowledgement
        // at once, and the loop suspends the agent after the program ends. So this is a plain
        // string-returning call — the acknowledgement is `outcome.output`, exactly as `read_skill`'s
        // body is — not a blocking one like `wait_for_subagents`.
        self.recorded(PROJECT_WAIT_FOR_ISSUE, |state, rec| {
            let outcome = state.call(rec, WAIT_FOR_ISSUE_TOOL, |api| api.wait_for_issue(id))?;
            Ok(outcome.output)
        })
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
        Some(ToolData::BoardUsage(usage)) => Ok(usage_record(usage)),
        other => Err(state.missing_data(tool, other.as_ref())),
    }
}

/// The id a creation assigned plus its board budget, or the defect diagnostic if it reported
/// neither — the sidecar `create_epic`/`create_issue` carry, since gg (not the model) names what
/// they filed.
fn board_node<A: ToolApi>(
    state: &mut MembraneState<A>,
    tool: &'static str,
    data: Option<ToolData>,
) -> Result<(String, BoardUsage), ToolError> {
    match data {
        Some(ToolData::BoardNode(node)) => Ok((node.id, usage_record(node.board))),
        other => Err(state.missing_data(tool, other.as_ref())),
    }
}

/// gg's board-usage numbers as the membrane's record.
fn usage_record(usage: BoardUsageData) -> BoardUsage {
    BoardUsage {
        epics: usage.epics,
        max_epics: usage.max_epics,
        issues: usage.issues,
        max_issues: usage.max_issues,
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
