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
//!   is a real reachability search over the dependency graph (the shared
//!   [`dag`] machinery, reused by the [`board`](crate::board)) — a refused edge
//!   leaves the list unchanged and returns a [`TaskError::Cycle`] naming the offending pair.
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
//!   store, and the derivations the loop needs (the count cap the system prompt states, the
//!   [`TasksState`](test_cabinet_core::gg::GgTelemetryKind::TasksState) telemetry, and the
//!   pinned context block).
//!
//! The capability is **switchable**: when it is off the loop builds a
//! [`disabled`](TasksRuntime::disabled) runtime, so there are no task tools, no prompt
//! section, no context block, and no telemetry — the feature vanishes.

use std::fmt;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use test_cabinet_core::gg::{
    CAPABILITY_TASKS, GgAgentConfig, GgContextSource, GgModuleOrigin, GgTaskEntry, GgTaskStatus,
    GgTelemetryKind,
};

use crate::dag::{self, DagNode};
use crate::model::Message;
use crate::modules::{
    AdoptError, Module, ModuleHandle, ModuleIds, ModuleKind, ModuleResolveCtx, Ownership, Refresh,
    detached_ids,
};
use crate::prompts::{self, TaskItemView, TasksBlockContext};

/// Default ceiling on the number of tasks the list may hold at once. Generous — a task
/// list is the model's plan, not a transcript — but bounded so a runaway loop cannot fill
/// the window with tasks. Overridable via the tasks capability's `maxTasks` param.
pub const DEFAULT_MAX_TASKS: usize = 100;

/// The tasks capability param naming the [maximum number of tasks](TaskStore::max_tasks).
const PARAM_MAX_TASKS: &str = "maxTasks";

/// The tasks capability param naming the list [mode](TaskMode).
const PARAM_MODE: &str = "mode";

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

/// The shape a [task](Task) takes, selected by the tasks capability's `mode` param.
///
/// The two modes are the same list — an agent-scoped, compaction-surviving blocked-by DAG —
/// differing only in what a task **must** carry:
///
/// - [`Simple`](Self::Simple) (the default): a lightweight to-do — a title and an optional
///   description.
/// - [`Issues`](Self::Issues): the task requires the same **structured sections** as a
///   [project-management board issue](crate::board) — an in-scope, an out-of-scope, and a
///   completion criteria (a title stays required, a description stays optional) — so a task is
///   scoped and acceptance-criteria'd without pulling in the global board and its auto-dispatch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TaskMode {
    /// A lightweight to-do: title (+ optional description).
    #[default]
    Simple,
    /// A structured item: title, in-scope, out-of-scope, and completion criteria required (like a
    /// board [issue](crate::board)).
    Issues,
}

impl TaskMode {
    /// Parse a `mode` param token, tolerating a couple of natural spellings. An unknown or absent
    /// value keeps the default ([`Simple`](Self::Simple)).
    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "issues" | "issue" | "structured" => TaskMode::Issues,
            _ => TaskMode::Simple,
        }
    }

    /// Whether this mode requires a task's structured scope/completion sections.
    fn requires_structure(self) -> bool {
        matches!(self, TaskMode::Issues)
    }
}

/// Resolve the list [mode](TaskMode) from a tasks-capability `params` object: `mode` selects
/// `simple` (the default) or `issues`; a missing or unrecognized value keeps `simple`.
pub fn resolve_task_mode(params: &Value) -> TaskMode {
    params
        .get(PARAM_MODE)
        .and_then(Value::as_str)
        .map(TaskMode::parse)
        .unwrap_or_default()
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
    /// What the task **is** responsible for — required (and `Some`) in
    /// [issues](TaskMode::Issues) mode, always `None` in [simple](TaskMode::Simple) mode.
    in_scope: Option<String>,
    /// What the task is **not** responsible for — required in issues mode, else `None`.
    out_of_scope: Option<String>,
    /// How the task will be judged **done** — required in issues mode, else `None`.
    completion_criteria: Option<String>,
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

    /// What the task is responsible for, in [issues](TaskMode::Issues) mode.
    pub fn in_scope(&self) -> Option<&str> {
        self.in_scope.as_deref()
    }

    /// What the task is not responsible for, in issues mode.
    pub fn out_of_scope(&self) -> Option<&str> {
        self.out_of_scope.as_deref()
    }

    /// How the task is judged done, in issues mode.
    pub fn completion_criteria(&self) -> Option<&str> {
        self.completion_criteria.as_deref()
    }
}

impl DagNode for Task {
    fn node_id(&self) -> &str {
        &self.id
    }

    fn blockers(&self) -> &[String] {
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
            TaskError::EmptyField(field) => write!(f, "`{field}` must not be empty"),
            TaskError::Duplicate(id) => {
                write!(f, "a task with id `{id}` already exists")
            }
            TaskError::NotFound(id) => write!(f, "no task with id `{id}`"),
            TaskError::BlockerNotFound(id) => {
                write!(f, "`blockedBy`: no task with id `{id}`")
            }
            TaskError::SelfBlock(id) => {
                write!(f, "task `{id}` cannot be blocked by itself")
            }
            TaskError::Cycle { task, blocker } => write!(
                f,
                "blocking `{task}` on `{blocker}` would create a cycle: `{blocker}` already \
                 depends on `{task}`"
            ),
            TaskError::CountCap { cap } => {
                write!(f, "at the maximum of {cap} tasks")
            }
            TaskError::NoUpdateFields => write!(
                f,
                "`update_task` needs one of `title`, `description`, `status`, `inScope`, \
                 `outOfScope` or `completionCriteria`"
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

/// The three structured sections a task carries in [issues](TaskMode::Issues) mode, as supplied
/// to [`add`](TaskStore::add) / [`update`](TaskStore::update). Each is `None` when the caller did
/// not supply it (in simple mode they are ignored; in issues mode a missing one on `add` is
/// refused). Mirrors a [board issue](crate::board)'s scope fields.
#[derive(Debug, Clone, Copy, Default)]
pub struct StructuredFields<'a> {
    /// What the task is responsible for.
    pub in_scope: Option<&'a str>,
    /// What the task is not responsible for.
    pub out_of_scope: Option<&'a str>,
    /// How the task is judged done.
    pub completion_criteria: Option<&'a str>,
}

impl StructuredFields<'_> {
    /// Whether any of the three sections was supplied.
    fn any(&self) -> bool {
        self.in_scope.is_some() || self.out_of_scope.is_some() || self.completion_criteria.is_some()
    }
}

/// The cleaned, stored form of a task's [structured sections](StructuredFields) after
/// [mode](TaskMode) resolution — every field `Some` in issues mode, every field `None` in simple
/// mode.
#[derive(Debug, Clone, Default)]
struct ResolvedStructured {
    in_scope: Option<String>,
    out_of_scope: Option<String>,
    completion_criteria: Option<String>,
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
    mode: TaskMode,
    tasks: Vec<Task>,
}

impl TaskStore {
    /// An empty [simple](TaskMode::Simple)-mode store holding at most `max_tasks` tasks.
    #[allow(dead_code)] // the tests' shorthand; the runtime always resolves a mode.
    pub fn new(max_tasks: usize) -> Self {
        Self::with_mode(max_tasks, TaskMode::Simple)
    }

    /// An empty store holding at most `max_tasks` tasks, in list [mode](TaskMode) `mode`.
    pub fn with_mode(max_tasks: usize, mode: TaskMode) -> Self {
        Self {
            max_tasks,
            mode,
            tasks: Vec::new(),
        }
    }

    /// The task-count ceiling this store enforces.
    pub fn max_tasks(&self) -> usize {
        self.max_tasks
    }

    /// Re-point the ceiling and the list [mode](TaskMode) — what a
    /// [transfer](crate::modules::transfer) does when a different agent profile
    /// [adopts](crate::modules::Module::adopt) this list, so the limits in force are the
    /// *receiving* profile's rather than the ones the donor happened to resolve.
    ///
    /// A list already longer than a newly-tightened ceiling is **kept**: the ordinary cap check
    /// refuses the next `add_task`, but deleting work the predecessor planned because the
    /// successor's profile is stingier would lose exactly the plan the transfer was for.
    pub fn reconfigure(&mut self, max_tasks: usize, mode: TaskMode) {
        self.max_tasks = max_tasks;
        self.mode = mode;
    }

    /// The list [mode](TaskMode) this store enforces.
    pub fn mode(&self) -> TaskMode {
        self.mode
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
    #[allow(clippy::too_many_arguments)]
    pub fn add(
        &mut self,
        id: &str,
        title: &str,
        description: Option<&str>,
        structured: StructuredFields<'_>,
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
        // In issues mode the three structured sections are required; in simple mode they are
        // absent (any supplied value is ignored). Validated before any mutation.
        let structured = self.resolve_structured(structured)?;
        if self.position(id).is_some() {
            return Err(TaskError::Duplicate(id.to_string()));
        }
        if self.tasks.len() >= self.max_tasks {
            return Err(TaskError::CountCap {
                cap: self.max_tasks,
            });
        }
        let blockers = self.normalize_blockers(id, blocked_by)?;
        if let Some(blocker) = dag::first_cycle(&self.tasks, id, &blockers) {
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
            in_scope: structured.in_scope,
            out_of_scope: structured.out_of_scope,
            completion_criteria: structured.completion_criteria,
        });
        Ok(TaskChange::Added)
    }

    /// Validate and normalize a task's structured sections against the store's [mode](TaskMode).
    ///
    /// In [issues](TaskMode::Issues) mode all three are required (a missing or empty one is an
    /// [`EmptyField`](TaskError::EmptyField)); in [simple](TaskMode::Simple) mode they are ignored
    /// and the result is empty, so a simple-mode task never carries structure. Returns the cleaned
    /// `Some` values to store.
    fn resolve_structured(
        &self,
        structured: StructuredFields<'_>,
    ) -> Result<ResolvedStructured, TaskError> {
        if !self.mode.requires_structure() {
            return Ok(ResolvedStructured::default());
        }
        Ok(ResolvedStructured {
            in_scope: Some(require_field(structured.in_scope, "inScope")?),
            out_of_scope: Some(require_field(structured.out_of_scope, "outOfScope")?),
            completion_criteria: Some(require_field(
                structured.completion_criteria,
                "completionCriteria",
            )?),
        })
    }

    /// Revise a task's `title`, `description`, `status`, and — in [issues](TaskMode::Issues) mode
    /// — its `structured` scope/completion sections, in place. At least one must be supplied. A
    /// `None` field is left unchanged; an empty `description` clears it. A structured section
    /// supplied in issues mode must be non-empty (it cannot be cleared — issues-mode tasks must
    /// always carry it); supplied in simple mode it is ignored. The blocked-by set is not touched
    /// here (use [`set_blocked_by`](Self::set_blocked_by)).
    pub fn update(
        &mut self,
        id: &str,
        title: Option<&str>,
        description: Option<&str>,
        status: Option<TaskStatus>,
        structured: StructuredFields<'_>,
    ) -> Result<TaskChange, TaskError> {
        let id = id.trim();
        if id.is_empty() {
            return Err(TaskError::EmptyField("id"));
        }
        // Structured fields count as a change only in issues mode; in simple mode they are ignored,
        // so an update carrying only them is "no fields".
        let structured_changes = self.mode.requires_structure() && structured.any();
        if title.is_none() && description.is_none() && status.is_none() && !structured_changes {
            return Err(TaskError::NoUpdateFields);
        }
        // Validate everything before mutating so a refused update applies nothing.
        if let Some(title) = title
            && title.trim().is_empty()
        {
            return Err(TaskError::EmptyField("title"));
        }
        if self.mode.requires_structure() {
            require_non_empty_when_present(structured.in_scope, "inScope")?;
            require_non_empty_when_present(structured.out_of_scope, "outOfScope")?;
            require_non_empty_when_present(structured.completion_criteria, "completionCriteria")?;
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
        if structured_changes {
            if let Some(in_scope) = structured.in_scope {
                self.tasks[index].in_scope = Some(in_scope.trim().to_string());
            }
            if let Some(out_of_scope) = structured.out_of_scope {
                self.tasks[index].out_of_scope = Some(out_of_scope.trim().to_string());
            }
            if let Some(completion_criteria) = structured.completion_criteria {
                self.tasks[index].completion_criteria =
                    Some(completion_criteria.trim().to_string());
            }
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
        if let Some(blocker) = dag::first_cycle(&self.tasks, id, &normalized) {
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

    /// The [`TasksState`](GgTelemetryKind::TasksState) telemetry for the current list, attributed
    /// to the [module instance](crate::modules::Module::instance_id) `module_id` — which is the
    /// store's identity, not the holder's, so two agents holding one list report one id.
    fn state_event(&self, module_id: &str) -> GgTelemetryKind {
        let tasks = self
            .tasks
            .iter()
            .map(|task| GgTaskEntry {
                id: task.id.clone(),
                title: task.title.clone(),
                description: task.description.clone(),
                in_scope: task.in_scope.clone(),
                out_of_scope: task.out_of_scope.clone(),
                completion_criteria: task.completion_criteria.clone(),
                status: task.status.to_contract(),
                blocked_by: task.blocked_by.clone(),
            })
            .collect();
        GgTelemetryKind::TasksState {
            module_id: module_id.to_string(),
            tasks,
        }
    }

    /// The pinned context block rendering the whole list — each task's status, title, and
    /// whether it is *ready* or *blocked by* specific incomplete tasks — or `None` when
    /// there are no tasks to show.
    ///
    /// The block is **state only**: a heading and the current list. How to build and revise the
    /// list is stated once, in the [system prompt](crate::prompts::SystemContext::tasks), gated on
    /// the capability being enabled — so the tool instructions are not re-sent every turn the
    /// block is refreshed.
    fn context_block(&self) -> Option<Message> {
        if self.tasks.is_empty() {
            return None;
        }
        let tasks = self
            .tasks
            .iter()
            .map(|task| {
                let open = task.status != TaskStatus::Done;
                let ready = open && self.is_ready(task);
                TaskItemView {
                    id: task.id.clone(),
                    title: task.title.clone(),
                    description: task.description.clone(),
                    status: task.status.word().to_string(),
                    marker: task.status.marker().to_string(),
                    ready,
                    blocked_by: (open && !ready).then(|| {
                        self.incomplete_blockers(task)
                            .iter()
                            .map(|id| format!("`{id}`"))
                            .collect::<Vec<_>>()
                            .join(", ")
                    }),
                    in_scope: task.in_scope.clone(),
                    out_of_scope: task.out_of_scope.clone(),
                    completion_criteria: task.completion_criteria.clone(),
                }
            })
            .collect();
        Some(Message::user(prompts::render_tasks(&TasksBlockContext {
            tasks,
        })))
    }
}

/// Trim a supplied description, treating an empty (or whitespace-only) one as absent.
fn clean_description(description: Option<&str>) -> Option<String> {
    description
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .map(str::to_string)
}

/// Trim a required structured field, refusing an absent or empty (whitespace-only) value.
fn require_field(value: Option<&str>, field: &'static str) -> Result<String, TaskError> {
    match value.map(str::trim) {
        Some(trimmed) if !trimmed.is_empty() => Ok(trimmed.to_string()),
        _ => Err(TaskError::EmptyField(field)),
    }
}

/// Refuse an empty (whitespace-only) value when a structured field is present in an update; a
/// `None` (unchanged) field is fine.
fn require_non_empty_when_present(
    value: Option<&str>,
    field: &'static str,
) -> Result<(), TaskError> {
    match value {
        Some(v) if v.trim().is_empty() => Err(TaskError::EmptyField(field)),
        _ => Ok(()),
    }
}

/// The loop's live view of the tasks capability: whether it is on and the shared
/// [`TaskStore`].
///
/// Constructed [enabled](Self::new) with a count cap or [disabled](Self::disabled) (an
/// configuration with the capability off). It hands the [`store`](Self::store) to the task tools,
/// produces the
/// count cap the [system prompt](crate::prompts::SystemContext::tasks) states, the
/// [`TasksState`](GgTelemetryKind::TasksState) [telemetry](Self::state_event), and the
/// pinned [context block](Self::context_block) the loop keeps in the window.
///
/// It is a [module](crate::modules::Module): it can be [forked](Self::forked) into an independent
/// list, [shared](Self::shared) so two agent instances work one, and handed to the agent that
/// succeeds this one — which is what lets a machine's next state pick up exactly the plan the last
/// state left. It is deliberately **not** `Clone`; see [the module model](crate::modules).
#[derive(Debug)]
pub struct TasksRuntime {
    /// Whether the tasks capability is enabled for this run.
    enabled: bool,
    /// The [identity](crate::modules::ModuleIdMint) of the store below — what tells a reader that
    /// a successor's list is the very one its predecessor built rather than a second list that
    /// happens to hold the same tasks.
    id: Arc<str>,
    /// The mint a copy of this list takes its id from — see [`ModuleIds`].
    ids: ModuleIds,
    /// How this holder came by the list.
    origin: GgModuleOrigin,
    /// The shared, mutable store — the same handle the tools mutate.
    store: Arc<Mutex<TaskStore>>,
}

impl TasksRuntime {
    /// An enabled runtime with an empty [simple](TaskMode::Simple)-mode store holding at most
    /// `max_tasks` tasks. (The binary always resolves a mode through
    /// [`with_mode`](Self::with_mode); this simple-mode shorthand is the tests' convenience.)
    #[allow(dead_code)]
    pub fn new(max_tasks: usize) -> Self {
        Self::with_mode(max_tasks, TaskMode::Simple)
    }

    /// An enabled runtime with an empty store holding at most `max_tasks` tasks, in list
    /// [mode](TaskMode) `mode`, identified out of a [detached](detached_ids) sequence — the
    /// by-hand constructor, which in practice means the tests. A run's lists are built through
    /// [`Self::resolve`].
    pub fn with_mode(max_tasks: usize, mode: TaskMode) -> Self {
        Self::with_mode_in(max_tasks, mode, &detached_ids())
    }

    /// The same, identified out of the run's [mint](ModuleIds).
    fn with_mode_in(max_tasks: usize, mode: TaskMode, ids: &ModuleIds) -> Self {
        Self {
            enabled: true,
            store: Arc::new(Mutex::new(TaskStore::with_mode(max_tasks, mode))),
            id: ids.next(ModuleKind::Tasks),
            ids: Arc::clone(ids),
            origin: GgModuleOrigin::Created,
        }
    }

    /// A disabled runtime (the tasks capability is off): no tools, no prompt text, no
    /// context block, no telemetry.
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            ..Self::with_mode(DEFAULT_MAX_TASKS, TaskMode::Simple)
        }
    }

    /// Build the tasks module `profile` configures: when the [tasks](CAPABILITY_TASKS) capability
    /// is enabled, an empty DAG holding at most the [count](resolve_max_tasks) its params resolve
    /// in the [mode](TaskMode) they name; otherwise a [disabled](Self::disabled) module (an
    /// configuration with the capability off).
    pub fn resolve(profile: &GgAgentConfig, ctx: &ModuleResolveCtx<'_>) -> Self {
        if !profile.is_enabled(CAPABILITY_TASKS) {
            return Self::disabled();
        }
        let params = profile.capability(CAPABILITY_TASKS).map(|cap| &cap.params);
        let max_tasks = params.map(resolve_max_tasks).unwrap_or(DEFAULT_MAX_TASKS);
        let mode = params.map(resolve_task_mode).unwrap_or_default();
        Self::with_mode_in(max_tasks, mode, ctx.ids)
    }

    /// An **independent** list holding a copy of everything this one holds. Task ids are
    /// model-authored and two copies never merge, so nothing has to be re-minted.
    pub fn forked(&self) -> Self {
        Self {
            enabled: self.enabled,
            store: Arc::new(Mutex::new(
                self.store.lock().expect("task store lock").clone(),
            )),
            // A new store, so a new id: the two lists diverge from here.
            id: self.ids.next(ModuleKind::Tasks),
            ids: Arc::clone(&self.ids),
            origin: self.origin,
        }
    }

    /// A **linked** handle onto the same list: what one holder adds, the other sees.
    pub fn shared(&self) -> Self {
        Self {
            enabled: self.enabled,
            store: Arc::clone(&self.store),
            // The same store, so the same id.
            id: Arc::clone(&self.id),
            ids: Arc::clone(&self.ids),
            origin: self.origin,
        }
    }

    /// The list [mode](TaskMode) this run enforces.
    #[allow(dead_code)] // a read surface for the module tests, which assert what an adopt re-resolved.
    pub fn mode(&self) -> TaskMode {
        self.store.lock().expect("task store lock").mode()
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

    /// The [`TasksState`](GgTelemetryKind::TasksState) telemetry for the current store, or
    /// `None` when the capability is off. Emitted at session start (empty) and after every
    /// successful mutation.
    pub fn state_event(&self) -> Option<GgTelemetryKind> {
        if !self.enabled {
            return None;
        }
        Some(
            self.store
                .lock()
                .expect("task store lock")
                .state_event(&self.id),
        )
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

impl Module for TasksRuntime {
    fn kind(&self) -> ModuleKind {
        ModuleKind::Tasks
    }

    fn instance_id(&self) -> &str {
        &self.id
    }

    fn origin(&self) -> GgModuleOrigin {
        self.origin
    }

    fn set_origin(&mut self, origin: GgModuleOrigin) {
        self.origin = origin;
    }

    fn enabled(&self) -> bool {
        self.enabled
    }

    /// Always [owned](Ownership::Owned). The list is what the agent steers its work by from
    /// turn to turn, so it is carried in its holder's prompt as its own message — there is no
    /// `ownership` param on the tasks capability, and nothing to resolve.
    fn ownership(&self) -> Ownership {
        Ownership::Owned
    }

    fn context_source(&self) -> Option<GgContextSource> {
        Some(GgContextSource::TaskList)
    }

    fn refresh(&self) -> Refresh {
        Refresh::EveryTurn
    }

    fn context_block(&self) -> Option<Message> {
        TasksRuntime::context_block(self)
    }

    fn state_events(&self) -> Vec<GgTelemetryKind> {
        self.state_event().into_iter().collect()
    }

    /// Nothing: the task list's telemetry is **snapshot-only**. There is no per-mutation record to
    /// stream — the whole DAG is re-emitted after each successful call by the loop that made it —
    /// so a drain has nothing of its own to hand over, and [`state_events`](Self::state_events) is
    /// what an agent adopting the list re-emits.
    fn drain_events(&mut self) -> Vec<GgTelemetryKind> {
        Vec::new()
    }

    fn retained(&self) -> u64 {
        self.count() as u64
    }

    fn fork(&self) -> ModuleHandle {
        ModuleHandle::Tasks(self.forked())
    }

    fn share(&self) -> ModuleHandle {
        ModuleHandle::Tasks(self.shared())
    }

    /// Re-resolve the count ceiling and the list mode from the receiving profile.
    ///
    /// Unlike the memory strategy, the list [mode](TaskMode) is not a compatibility barrier: both
    /// modes are the same DAG, differing only in which fields a *new* task must carry, so a list
    /// written in one mode reads perfectly well in the other and only the next `add_task` is held
    /// to the successor's rule.
    fn adopt(
        &mut self,
        profile: &GgAgentConfig,
        ctx: &ModuleResolveCtx<'_>,
    ) -> Result<(), AdoptError> {
        if !profile.is_enabled(CAPABILITY_TASKS) {
            return Err(AdoptError::Disabled);
        }
        let params = profile.capability(CAPABILITY_TASKS).map(|cap| &cap.params);
        let max_tasks = params.map(resolve_max_tasks).unwrap_or(DEFAULT_MAX_TASKS);
        let mode = params.map(resolve_task_mode).unwrap_or_default();
        self.store
            .lock()
            .expect("task store lock")
            .reconfigure(max_tasks, mode);
        self.enabled = true;
        self.ids = Arc::clone(ctx.ids);
        self.origin = GgModuleOrigin::Transferred;
        Ok(())
    }
}

#[cfg(test)]
#[path = "tasks.test.rs"]
mod tests;
