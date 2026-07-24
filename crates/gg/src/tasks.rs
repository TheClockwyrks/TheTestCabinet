//! The gg **tasks** capability: the model's lightweight to-do list, a **blocked-by DAG**
//! that is **retained across compaction**.
//!
//! A [task](https://docs.testcabinet.ai/gg/tasks/) is one item of work the model wants to
//! do. The model builds and revises the list itself — `add_task` to add one, `update_task`
//! to revise its title/description/status, `set_blocked_by` to declare which other tasks
//! must finish first, `complete_task` to mark one done, and `remove_task` to drop one. The
//! whole list is pushed into the context window as a single
//! [`TaskList`](test_cabinet_core::gg::GgContextSource)-sourced,
//! [`Pinned`](crate::context::Retention::Pinned) item, so the
//! [context accounting](crate::context) attributes it to the task list and Phase 2
//! compaction carries the model's plan across the boundary verbatim.
//!
//! # Two hard requirements
//!
//! - **It is a DAG.** The blocked-by relation must be **acyclic**: gg rejects any edge that
//!   would introduce a cycle (`a` blocked by `b` blocked by `c` blocked by `a`). The check
//!   is a real reachability search over the dependency graph
//!   ([`TaskStore::depends_on`]) — a refused edge leaves the list unchanged and returns a
//!   [`TaskError::Cycle`] naming the offending pair.
//! - **It survives compaction.** Because the list is a pinned context item, it is retained
//!   verbatim across a compaction boundary — the model never loses its plan just because
//!   the run went long.
//!
//! # Actionable vs blocked
//!
//! A task is **actionable** only when every task it is blocked by is
//! [`Done`](TaskStatus::Done). The rendered [context block](TaskStore::context_block)
//! surfaces this — each open task is marked *ready* or *blocked by* the specific incomplete
//! blockers — so the model always knows what it can pick up next.
//!
//! # Shapes
//!
//! - [`Task`] — one node (id, title, optional description, [status](TaskStatus), and the
//!   ids it is blocked by).
//! - [`TaskStore`] — the mutable, cycle-rejecting DAG, shared (`Arc<Mutex>`) between the
//!   loop and the [task tools](crate::tools).
//! - [`TasksRuntime`] — the loop's live view: whether the capability is on, the shared
//!   store, and the derivations the loop needs (the system-prompt section, the
//!   [`TasksState`](test_cabinet_core::gg::GgTelemetryKind::TasksState) telemetry, and the
//!   pinned context block).
//!
//! The capability is **ablatable**: when it is off the loop builds a
//! [`disabled`](TasksRuntime::disabled) runtime, so there are no task tools, no prompt
//! section, no context block, and no telemetry — the feature vanishes.

use std::collections::HashSet;
use std::fmt;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use test_cabinet_core::gg::{GgTaskEntry, GgTaskStatus, GgTelemetryKind};

use crate::model::Message;

/// Default ceiling on the number of tasks the list may hold at once. Generous — a task
/// list is the model's plan, not a transcript — but bounded so a runaway loop cannot fill
/// the window with tasks. Overridable via the tasks capability's `maxTasks` param.
pub const DEFAULT_MAX_TASKS: usize = 100;

/// The tasks capability param naming the [maximum number of tasks](TaskStore::max_tasks).
const PARAM_MAX_TASKS: &str = "maxTasks";

/// Resolve the task-count ceiling from a tasks-capability `params` object: `maxTasks`
/// overrides [`DEFAULT_MAX_TASKS`] when present as a positive integer; a missing, zero, or
/// non-integer value keeps the default.
pub fn resolve_max_tasks(params: &Value) -> usize {
    params
        .get(PARAM_MAX_TASKS)
        .and_then(Value::as_u64)
        .filter(|&n| n > 0)
        .map(|n| n as usize)
        .unwrap_or(DEFAULT_MAX_TASKS)
}

/// The lifecycle status of a [`Task`].
///
/// A task is *actionable* only when it is not [`Done`](Self::Done) and every task it is
/// blocked by is [`Done`](Self::Done).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskStatus {
    /// Not started.
    Pending,
    /// Being worked on.
    InProgress,
    /// Complete.
    Done,
}

impl TaskStatus {
    /// Parse a model-supplied status token (`"pending"`, `"in_progress"`, `"done"`),
    /// tolerating a couple of natural spellings. Returns `None` for anything else so the
    /// tool can reject it with guidance.
    pub fn parse(raw: &str) -> Option<Self> {
        match raw
            .trim()
            .to_ascii_lowercase()
            .replace([' ', '-'], "_")
            .as_str()
        {
            "pending" | "todo" => Some(TaskStatus::Pending),
            "in_progress" | "inprogress" | "doing" => Some(TaskStatus::InProgress),
            "done" | "complete" | "completed" => Some(TaskStatus::Done),
            _ => None,
        }
    }

    /// The contract form of the status for the
    /// [`TasksState`](GgTelemetryKind::TasksState) telemetry.
    fn to_contract(self) -> GgTaskStatus {
        match self {
            TaskStatus::Pending => GgTaskStatus::Pending,
            TaskStatus::InProgress => GgTaskStatus::InProgress,
            TaskStatus::Done => GgTaskStatus::Done,
        }
    }

    /// A human-readable word for the status, for the rendered context block.
    fn word(self) -> &'static str {
        match self {
            TaskStatus::Pending => "pending",
            TaskStatus::InProgress => "in progress",
            TaskStatus::Done => "done",
        }
    }

    /// The checkbox-style marker for the status, for the rendered context block.
    fn marker(self) -> &'static str {
        match self {
            TaskStatus::Pending => "[ ]",
            TaskStatus::InProgress => "[~]",
            TaskStatus::Done => "[x]",
        }
    }
}

/// One task on the model's list: a node of the blocked-by DAG.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Task {
    /// The task's stable id — the handle the tools and every blocked-by edge reference.
    id: String,
    /// The task's short title.
    title: String,
    /// An optional longer description.
    description: Option<String>,
    /// The task's status.
    status: TaskStatus,
    /// The ids of the tasks this one is blocked by (deduplicated, existence-checked, and
    /// kept acyclic).
    blocked_by: Vec<String>,
}

// Field accessors are the task's read surface for the tests and console-facing
// derivations; the loop reaches the fields internally, so the binary sees these as unused.
#[allow(dead_code)]
impl Task {
    /// The task's id.
    pub fn id(&self) -> &str {
        &self.id
    }

    /// The task's title.
    pub fn title(&self) -> &str {
        &self.title
    }

    /// The task's optional description.
    pub fn description(&self) -> Option<&str> {
        self.description.as_deref()
    }

    /// The task's status.
    pub fn status(&self) -> TaskStatus {
        self.status
    }

    /// The ids this task is blocked by.
    pub fn blocked_by(&self) -> &[String] {
        &self.blocked_by
    }
}

/// Why a [`TaskStore`] mutation was refused. Its [`Display`](fmt::Display) is the
/// **model-facing** message the tool returns: every variant tells the model how to
/// proceed, and — critically — a refused mutation never partially applies.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TaskError {
    /// A required field (`id`, `title`, or a `blockedBy` entry) was empty.
    EmptyField(&'static str),
    /// `add_task` named a task whose id already exists (use `update_task` instead).
    Duplicate(String),
    /// A tool named a task id that does not exist.
    NotFound(String),
    /// A `blockedBy` list referenced a task id that does not exist.
    BlockerNotFound(String),
    /// A task was declared blocked by itself.
    SelfBlock(String),
    /// The edge would introduce a cycle: `blocker` already depends (directly or
    /// transitively) on `task`, so blocking `task` on `blocker` would close a loop.
    Cycle {
        /// The task the edge was being added to.
        task: String,
        /// The blocker that already depends on `task`.
        blocker: String,
    },
    /// Adding a task would exceed the count cap.
    CountCap {
        /// The count cap (already reached).
        cap: usize,
    },
    /// `update_task` was called with no field to change.
    NoUpdateFields,
}

impl fmt::Display for TaskError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TaskError::EmptyField(field) => write!(f, "`{field}` must not be empty."),
            TaskError::Duplicate(id) => write!(
                f,
                "a task with id `{id}` already exists; use `update_task` to revise it, or \
                 choose a different id."
            ),
            TaskError::NotFound(id) => write!(
                f,
                "no task with id `{id}` exists (your current tasks are listed in your \
                 context); use `add_task` to create it."
            ),
            TaskError::BlockerNotFound(id) => write!(
                f,
                "`blockedBy` references task `{id}`, which does not exist; add it first, or \
                 correct the id."
            ),
            TaskError::SelfBlock(id) => {
                write!(f, "task `{id}` cannot be blocked by itself.")
            }
            TaskError::Cycle { task, blocker } => write!(
                f,
                "blocking `{task}` on `{blocker}` would create a cycle: `{blocker}` already \
                 depends (directly or indirectly) on `{task}`. Tasks form a DAG, so this \
                 edge is refused."
            ),
            TaskError::CountCap { cap } => write!(
                f,
                "you already hold the maximum of {cap} tasks; complete or remove one with \
                 `complete_task`/`remove_task` before adding another."
            ),
            TaskError::NoUpdateFields => write!(
                f,
                "`update_task` needs at least one of `title`, `description`, or `status` to \
                 change."
            ),
        }
    }
}

/// What a successful [`TaskStore`] mutation did — the tool reports this in its confirmation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskChange {
    /// A task was added.
    Added,
    /// A task was revised.
    Updated,
    /// A task's blocked-by set was replaced.
    BlockersSet,
    /// A task was marked done.
    Completed,
    /// A task was removed.
    Removed,
}

/// The mutable, cycle-rejecting DAG of the model's tasks.
///
/// The store is the single owner of the task list; the [tools](crate::tools) and the
/// [loop](crate::agent) share it behind an `Arc<Mutex<…>>`. Tasks are kept in the order
/// they were added (a stable order for the rendered list and the telemetry). Every
/// blocked-by mutation is validated — existence, no self-block, and **acyclicity** — before
/// it takes effect, so the DAG invariant always holds; a refused mutation leaves the list
/// untouched.
#[derive(Debug, Clone)]
pub struct TaskStore {
    max_tasks: usize,
    tasks: Vec<Task>,
}

impl TaskStore {
    /// An empty store holding at most `max_tasks` tasks.
    pub fn new(max_tasks: usize) -> Self {
        Self {
            max_tasks,
            tasks: Vec::new(),
        }
    }

    /// The task-count ceiling this store enforces.
    pub fn max_tasks(&self) -> usize {
        self.max_tasks
    }

    /// The number of tasks currently held.
    pub fn count(&self) -> usize {
        self.tasks.len()
    }

    /// The tasks, in add order. (A read surface for the tests; the loop reaches the store
    /// through the runtime's derivations.)
    #[allow(dead_code)]
    pub fn tasks(&self) -> &[Task] {
        &self.tasks
    }

    /// Add a new task. Refused if `id`/`title` is empty, a task of that id already exists,
    /// the store is at the count cap, a `blocked_by` entry is empty/self/unknown, or an
    /// edge would create a cycle. A newly added task has no dependents, so its only failure
    /// mode against the DAG is referencing a non-existent blocker.
    pub fn add(
        &mut self,
        id: &str,
        title: &str,
        description: Option<&str>,
        blocked_by: &[String],
    ) -> Result<TaskChange, TaskError> {
        let id = id.trim();
        if id.is_empty() {
            return Err(TaskError::EmptyField("id"));
        }
        let title = title.trim();
        if title.is_empty() {
            return Err(TaskError::EmptyField("title"));
        }
        if self.position(id).is_some() {
            return Err(TaskError::Duplicate(id.to_string()));
        }
        if self.tasks.len() >= self.max_tasks {
            return Err(TaskError::CountCap {
                cap: self.max_tasks,
            });
        }
        let blockers = self.normalize_blockers(id, blocked_by)?;
        if let Some(blocker) = self.first_cycle(id, &blockers) {
            return Err(TaskError::Cycle {
                task: id.to_string(),
                blocker,
            });
        }
        self.tasks.push(Task {
            id: id.to_string(),
            title: title.to_string(),
            description: clean_description(description),
            status: TaskStatus::Pending,
            blocked_by: blockers,
        });
        Ok(TaskChange::Added)
    }

    /// Revise a task's `title`, `description`, and/or `status` in place. At least one must
    /// be supplied. A `None` field is left unchanged; an empty `description` clears it. The
    /// blocked-by set is not touched here (use [`set_blocked_by`](Self::set_blocked_by)).
    pub fn update(
        &mut self,
        id: &str,
        title: Option<&str>,
        description: Option<&str>,
        status: Option<TaskStatus>,
    ) -> Result<TaskChange, TaskError> {
        let id = id.trim();
        if id.is_empty() {
            return Err(TaskError::EmptyField("id"));
        }
        if title.is_none() && description.is_none() && status.is_none() {
            return Err(TaskError::NoUpdateFields);
        }
        // Validate the title before mutating so a refused update applies nothing.
        if let Some(title) = title
            && title.trim().is_empty()
        {
            return Err(TaskError::EmptyField("title"));
        }
        let Some(index) = self.position(id) else {
            return Err(TaskError::NotFound(id.to_string()));
        };
        if let Some(title) = title {
            self.tasks[index].title = title.trim().to_string();
        }
        if let Some(description) = description {
            self.tasks[index].description = clean_description(Some(description));
        }
        if let Some(status) = status {
            self.tasks[index].status = status;
        }
        Ok(TaskChange::Updated)
    }

    /// Replace a task's blocked-by set with `blockers`. Refused if the task does not exist,
    /// a blocker is empty/self/unknown, or the resulting graph would contain a cycle — in
    /// which case the task's existing blockers are left unchanged.
    pub fn set_blocked_by(
        &mut self,
        id: &str,
        blockers: &[String],
    ) -> Result<TaskChange, TaskError> {
        let id = id.trim();
        if id.is_empty() {
            return Err(TaskError::EmptyField("id"));
        }
        let Some(index) = self.position(id) else {
            return Err(TaskError::NotFound(id.to_string()));
        };
        let normalized = self.normalize_blockers(id, blockers)?;
        if let Some(blocker) = self.first_cycle(id, &normalized) {
            return Err(TaskError::Cycle {
                task: id.to_string(),
                blocker,
            });
        }
        self.tasks[index].blocked_by = normalized;
        Ok(TaskChange::BlockersSet)
    }

    /// Mark a task [`Done`](TaskStatus::Done). Refused if no task of that id exists.
    pub fn complete(&mut self, id: &str) -> Result<TaskChange, TaskError> {
        let id = id.trim();
        if id.is_empty() {
            return Err(TaskError::EmptyField("id"));
        }
        let Some(index) = self.position(id) else {
            return Err(TaskError::NotFound(id.to_string()));
        };
        self.tasks[index].status = TaskStatus::Done;
        Ok(TaskChange::Completed)
    }

    /// Remove a task. Refused if no task of that id exists. The removed id is also stripped
    /// from every other task's blocked-by set, so no dangling edge is left behind.
    pub fn remove(&mut self, id: &str) -> Result<TaskChange, TaskError> {
        let id = id.trim();
        if id.is_empty() {
            return Err(TaskError::EmptyField("id"));
        }
        let Some(index) = self.position(id) else {
            return Err(TaskError::NotFound(id.to_string()));
        };
        self.tasks.remove(index);
        for task in &mut self.tasks {
            task.blocked_by.retain(|blocker| blocker != id);
        }
        Ok(TaskChange::Removed)
    }

    /// The index of the task with id `id`, if any.
    fn position(&self, id: &str) -> Option<usize> {
        self.tasks.iter().position(|task| task.id == id)
    }

    /// The status of the task with id `id`, if it exists.
    fn status_of(&self, id: &str) -> Option<TaskStatus> {
        self.tasks
            .iter()
            .find(|task| task.id == id)
            .map(|task| task.status)
    }

    /// Trim, validate, and deduplicate a blocked-by list for `subject`: every entry must be
    /// non-empty, must not be `subject` itself, and must name an existing task. Order is
    /// preserved and duplicates are dropped.
    fn normalize_blockers(&self, subject: &str, raw: &[String]) -> Result<Vec<String>, TaskError> {
        let mut out: Vec<String> = Vec::new();
        for entry in raw {
            let entry = entry.trim();
            if entry.is_empty() {
                return Err(TaskError::EmptyField("blockedBy"));
            }
            if entry == subject {
                return Err(TaskError::SelfBlock(subject.to_string()));
            }
            if self.position(entry).is_none() {
                return Err(TaskError::BlockerNotFound(entry.to_string()));
            }
            if !out.iter().any(|existing| existing == entry) {
                out.push(entry.to_string());
            }
        }
        Ok(out)
    }

    /// The first blocker in `blockers` that already depends on `subject` — meaning blocking
    /// `subject` on it would close a cycle — or `None` when the edges are all acyclic.
    ///
    /// Because the stored graph is always acyclic, a new blocked-by edge can only create a
    /// cycle by pointing at a task that (transitively) already depends on `subject`; each
    /// candidate blocker is tested with [`depends_on`](Self::depends_on).
    fn first_cycle(&self, subject: &str, blockers: &[String]) -> Option<String> {
        blockers
            .iter()
            .find(|blocker| self.depends_on(blocker, subject))
            .cloned()
    }

    /// Whether `from` depends on `target` — i.e. `target` is reachable from `from` by
    /// following blocked-by edges. A depth-first search with a visited set, so it
    /// terminates even if the stored graph were somehow inconsistent.
    fn depends_on(&self, from: &str, target: &str) -> bool {
        let mut stack: Vec<&str> = vec![from];
        let mut seen: HashSet<&str> = HashSet::new();
        while let Some(current) = stack.pop() {
            if current == target {
                return true;
            }
            if !seen.insert(current) {
                continue;
            }
            if let Some(task) = self.tasks.iter().find(|task| task.id == current) {
                for blocker in &task.blocked_by {
                    stack.push(blocker);
                }
            }
        }
        false
    }

    /// Whether a task is actionable: not done, and every task it is blocked by is done.
    fn is_ready(&self, task: &Task) -> bool {
        task.status != TaskStatus::Done
            && task
                .blocked_by
                .iter()
                .all(|blocker| self.status_of(blocker) == Some(TaskStatus::Done))
    }

    /// The ids of a task's blockers that are not yet done — what is holding it up.
    fn incomplete_blockers<'a>(&self, task: &'a Task) -> Vec<&'a str> {
        task.blocked_by
            .iter()
            .filter(|blocker| self.status_of(blocker) != Some(TaskStatus::Done))
            .map(String::as_str)
            .collect()
    }

    /// The [`TasksState`](GgTelemetryKind::TasksState) telemetry for the current list.
    fn state_event(&self) -> GgTelemetryKind {
        let tasks = self
            .tasks
            .iter()
            .map(|task| GgTaskEntry {
                id: task.id.clone(),
                title: task.title.clone(),
                description: task.description.clone(),
                status: task.status.to_contract(),
                blocked_by: task.blocked_by.clone(),
            })
            .collect();
        GgTelemetryKind::TasksState { tasks }
    }

    /// The pinned context block rendering the whole list — each task's status, title, and
    /// whether it is *ready* or *blocked by* specific incomplete tasks — or `None` when
    /// there are no tasks to show.
    fn context_block(&self) -> Option<Message> {
        if self.tasks.is_empty() {
            return None;
        }
        let mut block = String::from(
            "# Your tasks\n\nThis is your plan for the rest of this session. You maintain it \
             with `add_task`, `update_task`, `set_blocked_by`, `complete_task`, and \
             `remove_task`. It is retained even when your context is compacted. A task is \
             ready to work only once every task it is blocked by is done; the DAG cannot \
             contain cycles.",
        );
        for task in &self.tasks {
            let title = &task.title;
            let mut line = format!(
                "\n\n- {} `{}` ({}) — {}",
                task.status.marker(),
                task.id,
                task.status.word(),
                title
            );
            if let Some(description) = &task.description {
                line.push_str(&format!(": {description}"));
            }
            if task.status != TaskStatus::Done {
                if self.is_ready(task) {
                    line.push_str("  [ready]");
                } else {
                    let blockers: Vec<String> = self
                        .incomplete_blockers(task)
                        .iter()
                        .map(|id| format!("`{id}`"))
                        .collect();
                    line.push_str(&format!("  [blocked by {}]", blockers.join(", ")));
                }
            }
            block.push_str(&line);
        }
        Some(Message::user(block))
    }
}

/// Trim a supplied description, treating an empty (or whitespace-only) one as absent.
fn clean_description(description: Option<&str>) -> Option<String> {
    description
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .map(str::to_string)
}

/// The loop's live view of the tasks capability: whether it is on and the shared
/// [`TaskStore`].
///
/// Constructed [enabled](Self::new) with a count cap or [disabled](Self::disabled) (an
/// ablation's off arm). It hands the [`store`](Self::store) to the task tools, produces the
/// system-prompt [section](Self::prompt_section), the
/// [`TasksState`](GgTelemetryKind::TasksState) [telemetry](Self::state_event), and the
/// pinned [context block](Self::context_block) the loop keeps in the window.
#[derive(Debug, Clone)]
pub struct TasksRuntime {
    /// Whether the tasks capability is enabled for this run.
    enabled: bool,
    /// The shared, mutable store — the same handle the tools mutate.
    store: Arc<Mutex<TaskStore>>,
}

impl TasksRuntime {
    /// An enabled runtime with an empty store holding at most `max_tasks` tasks.
    pub fn new(max_tasks: usize) -> Self {
        Self {
            enabled: true,
            store: Arc::new(Mutex::new(TaskStore::new(max_tasks))),
        }
    }

    /// A disabled runtime (the tasks capability is off): no tools, no prompt section, no
    /// context block, no telemetry.
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            store: Arc::new(Mutex::new(TaskStore::new(DEFAULT_MAX_TASKS))),
        }
    }

    /// Whether the capability offers task tools this run (simply whether it is enabled — the
    /// model creates its own tasks, so no pre-existing content is required).
    pub fn offers_tasks(&self) -> bool {
        self.enabled
    }

    /// The shared store, for binding into the task tools.
    pub fn store(&self) -> Arc<Mutex<TaskStore>> {
        Arc::clone(&self.store)
    }

    /// The count cap this run enforces.
    pub fn max_tasks(&self) -> usize {
        self.store.lock().expect("task store lock").max_tasks()
    }

    /// The number of tasks on the list — reported as the tasks figure of a
    /// [compaction](https://docs.testcabinet.ai/gg/compaction/) boundary's retention proof.
    /// Zero when the capability is off (the store is empty).
    pub fn count(&self) -> usize {
        self.store.lock().expect("task store lock").count()
    }

    /// The system-prompt section telling the model it can plan with tasks and how the DAG
    /// behaves, or `None` when the capability is off. The current tasks themselves are
    /// injected as the pinned [context block](Self::context_block), not the prompt.
    pub fn prompt_section(&self) -> Option<String> {
        if !self.enabled {
            return None;
        }
        Some(format!(
            "You can keep a **task list** — your plan for this session. Call `add_task` \
             (with a unique `id`, a `title`, optional `description`, and an optional \
             `blockedBy` list of task ids) to add work; `update_task` to change a task's \
             title/description/status; `set_blocked_by` to declare which tasks must finish \
             first; `complete_task` to mark one done; and `remove_task` to drop one. The \
             list is a **DAG**: a task can be blocked by others, and gg refuses any edge \
             that would create a cycle. A task is ready to work only once all of its \
             blockers are done. Your current tasks (with what is ready vs blocked) are \
             shown back to you under \"Your tasks\", and the list survives context \
             compaction, so keep it up to date as your plan. Hold at most {} tasks.",
            self.max_tasks()
        ))
    }

    /// The [`TasksState`](GgTelemetryKind::TasksState) telemetry for the current store, or
    /// `None` when the capability is off. Emitted at session start (empty) and after every
    /// successful mutation.
    pub fn state_event(&self) -> Option<GgTelemetryKind> {
        if !self.enabled {
            return None;
        }
        Some(self.store.lock().expect("task store lock").state_event())
    }

    /// The pinned context block rendering the current task list, or `None` when the
    /// capability is off or there are no tasks. The loop keeps this as the single
    /// [`TaskList`](test_cabinet_core::gg::GgContextSource::TaskList)-sourced item in the
    /// window.
    pub fn context_block(&self) -> Option<Message> {
        if !self.enabled {
            return None;
        }
        self.store.lock().expect("task store lock").context_block()
    }
}

#[cfg(test)]
#[path = "tasks.test.rs"]
mod tests;
