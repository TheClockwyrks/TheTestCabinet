//! The gg **epics & issues** capability: the model's heavyweight work-decomposition board —
//! a [blocked-by DAG](crate::dag) of structured, dispatchable issues grouped into epics, and
//! **retained across compaction** like the [task list](crate::tasks).
//!
//! Where a [task](crate::tasks) is a one-line to-do, an
//! [issue](https://docs.testcabinet.ai/gg/epics-and-issues/) is substantial enough to organize
//! a large build and **safe to hand to a subagent** (Phase 4). An [`Issue`] carries structured
//! sections — a title, an optional description, and the three that make it dispatchable:
//! **in-scope**, **out-of-scope**, and **completion criteria** — that tell a subagent exactly
//! what it is and is not responsible for and how it will be judged done. Related issues are
//! grouped under an [`Epic`] for organization.
//!
//! The model builds and revises the board itself — `create_epic`/`create_issue` to add,
//! `update_issue` to revise an issue's fields or status, `set_issue_blocked_by` to declare the
//! DAG edges, `complete_issue` to mark one done, and `remove_epic`/`remove_issue` to drop one.
//! The whole board is pushed into the context window as a single
//! [`Board`](test_cabinet_core::gg::GgContextSource::Board)-sourced,
//! [`Pinned`](crate::context::Retention::Pinned) item, so the
//! [context accounting](crate::context) attributes it to the board and
//! [compaction](crate::compaction) carries the decomposition across the boundary verbatim.
//!
//! # The shared DAG
//!
//! Issues use the **same acyclic blocked-by relation as tasks**: gg rejects any edge that would
//! introduce a cycle. Rather than mirror the reachability search, the board reuses the shared
//! [`dag`] machinery ([`Issue`] implements [`DagNode`]); the store owns only its
//! existence/self-block checks and its [`BoardError`] messages. A refused edge leaves the board
//! unchanged.
//!
//! # The dispatch seam (Phase 4)
//!
//! An issue's structured fields are, by design, everything a subagent brief needs. Phase 4's
//! subagents will read an [`Issue`] off the [`BoardStore`] and dispatch it — nothing here
//! builds subagents, but the shape is chosen so dispatch is a read of the board, not a
//! reshaping of it. See [`Issue::in_scope`]/[`Issue::out_of_scope`]/[`Issue::completion_criteria`].
//!
//! # Shapes
//!
//! - [`Epic`] / [`Issue`] — the board's nodes.
//! - [`BoardStore`] — the mutable, invariant-enforcing, cycle-rejecting owner of the board,
//!   shared (`Arc<Mutex>`) between the loop and the [board tools](crate::tools).
//! - [`BoardRuntime`] — the loop's live view: whether the capability is on, the shared store,
//!   and the derivations the loop needs (the system-prompt section, the
//!   [`BoardState`](test_cabinet_core::gg::GgTelemetryKind::BoardState) telemetry, and the
//!   pinned context block).
//!
//! The capability is **ablatable**: when it is off the loop builds a
//! [`disabled`](BoardRuntime::disabled) runtime, so there are no board tools, no prompt
//! section, no context block, and no telemetry — the feature vanishes.

use std::fmt;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use test_cabinet_core::gg::{GgBoardEpic, GgBoardIssue, GgIssueStatus, GgTelemetryKind};

use crate::dag::{self, DagNode};
use crate::model::Message;

/// Default ceiling on the number of epics the board may hold at once.
pub const DEFAULT_MAX_EPICS: usize = 50;

/// Default ceiling on the number of issues the board may hold at once. Generous — the board is
/// the model's decomposition of a large build — but bounded so a runaway loop cannot fill the
/// window with issues.
pub const DEFAULT_MAX_ISSUES: usize = 200;

/// The epics-and-issues capability param naming the [epic ceiling](BoardCaps::max_epics).
const PARAM_MAX_EPICS: &str = "maxEpics";

/// The epics-and-issues capability param naming the [issue ceiling](BoardCaps::max_issues).
const PARAM_MAX_ISSUES: &str = "maxIssues";

/// The count ceilings the [`BoardStore`] enforces, resolved from the capability's params.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BoardCaps {
    /// The maximum number of epics the board may hold at once.
    pub max_epics: usize,
    /// The maximum number of issues the board may hold at once.
    pub max_issues: usize,
}

impl Default for BoardCaps {
    fn default() -> Self {
        Self {
            max_epics: DEFAULT_MAX_EPICS,
            max_issues: DEFAULT_MAX_ISSUES,
        }
    }
}

impl BoardCaps {
    /// Resolve the caps from an epics-and-issues-capability `params` object: `maxEpics` /
    /// `maxIssues` override the defaults when present as positive integers; a missing, zero, or
    /// non-integer value keeps the default.
    pub fn resolve(params: &Value) -> Self {
        let default = Self::default();
        Self {
            max_epics: positive_usize(params, PARAM_MAX_EPICS).unwrap_or(default.max_epics),
            max_issues: positive_usize(params, PARAM_MAX_ISSUES).unwrap_or(default.max_issues),
        }
    }
}

/// A positive-integer param value, or `None` when absent, zero, or non-integer.
fn positive_usize(params: &Value, key: &str) -> Option<usize> {
    params
        .get(key)
        .and_then(Value::as_u64)
        .filter(|&n| n > 0)
        .map(|n| n as usize)
}

/// The lifecycle status of an [`Issue`].
///
/// An issue is *actionable* only when it is not [`Done`](Self::Done) and every issue it is
/// blocked by is [`Done`](Self::Done).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssueStatus {
    /// Not started.
    Open,
    /// Being worked on.
    InProgress,
    /// Complete.
    Done,
}

impl IssueStatus {
    /// Parse a model-supplied status token (`"open"`, `"in_progress"`, `"done"`), tolerating a
    /// couple of natural spellings. Returns `None` for anything else so the tool can reject it
    /// with guidance.
    pub fn parse(raw: &str) -> Option<Self> {
        match raw
            .trim()
            .to_ascii_lowercase()
            .replace([' ', '-'], "_")
            .as_str()
        {
            "open" | "todo" | "pending" => Some(IssueStatus::Open),
            "in_progress" | "inprogress" | "doing" => Some(IssueStatus::InProgress),
            "done" | "complete" | "completed" => Some(IssueStatus::Done),
            _ => None,
        }
    }

    /// The contract form of the status for the
    /// [`BoardState`](GgTelemetryKind::BoardState) telemetry.
    fn to_contract(self) -> GgIssueStatus {
        match self {
            IssueStatus::Open => GgIssueStatus::Open,
            IssueStatus::InProgress => GgIssueStatus::InProgress,
            IssueStatus::Done => GgIssueStatus::Done,
        }
    }

    /// A human-readable word for the status, for the rendered context block.
    fn word(self) -> &'static str {
        match self {
            IssueStatus::Open => "open",
            IssueStatus::InProgress => "in progress",
            IssueStatus::Done => "done",
        }
    }

    /// The checkbox-style marker for the status, for the rendered context block.
    fn marker(self) -> &'static str {
        match self {
            IssueStatus::Open => "[ ]",
            IssueStatus::InProgress => "[~]",
            IssueStatus::Done => "[x]",
        }
    }
}

/// One epic on the board: an organizational grouping of related [`Issue`]s.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Epic {
    /// The epic's stable id — the handle an issue's `epic_id` references.
    id: String,
    /// The epic's short title.
    title: String,
    /// A longer description of what the epic covers.
    description: String,
}

// Field accessors are the epic's read surface for the tests and console-facing derivations.
#[allow(dead_code)]
impl Epic {
    /// The epic's id.
    pub fn id(&self) -> &str {
        &self.id
    }

    /// The epic's title.
    pub fn title(&self) -> &str {
        &self.title
    }

    /// The epic's description.
    pub fn description(&self) -> &str {
        &self.description
    }
}

/// One issue on the board: a **heavyweight, dispatchable** node of the blocked-by DAG.
///
/// The structured [`in_scope`](Self::in_scope), [`out_of_scope`](Self::out_of_scope), and
/// [`completion_criteria`](Self::completion_criteria) fields are what make an issue safe to
/// hand to a subagent — they are the subagent's brief.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Issue {
    /// The issue's stable id — the handle the tools and every blocked-by edge reference.
    id: String,
    /// The issue's short title.
    title: String,
    /// An optional longer overview (the scope fields carry the dispatch-relevant detail).
    description: Option<String>,
    /// What the issue **is** responsible for.
    in_scope: String,
    /// What the issue is **not** responsible for — the explicit exclusions bounding a
    /// dispatched subagent.
    out_of_scope: String,
    /// How the issue will be judged **done** — the acceptance criteria.
    completion_criteria: String,
    /// The issue's status.
    status: IssueStatus,
    /// The ids of the issues this one is blocked by (deduplicated, existence-checked, kept
    /// acyclic).
    blocked_by: Vec<String>,
    /// The id of the [`Epic`] this issue is grouped under, when any.
    epic_id: Option<String>,
}

// Field accessors are the issue's read surface for the tests, the console-facing derivations,
// and the Phase 4 subagent dispatch (which reads the brief off these fields).
#[allow(dead_code)]
impl Issue {
    /// The issue's id.
    pub fn id(&self) -> &str {
        &self.id
    }

    /// The issue's title.
    pub fn title(&self) -> &str {
        &self.title
    }

    /// The issue's optional description.
    pub fn description(&self) -> Option<&str> {
        self.description.as_deref()
    }

    /// What the issue is responsible for — part of the dispatch brief.
    pub fn in_scope(&self) -> &str {
        &self.in_scope
    }

    /// What the issue is not responsible for — part of the dispatch brief.
    pub fn out_of_scope(&self) -> &str {
        &self.out_of_scope
    }

    /// How the issue is judged done — part of the dispatch brief.
    pub fn completion_criteria(&self) -> &str {
        &self.completion_criteria
    }

    /// The issue's status.
    pub fn status(&self) -> IssueStatus {
        self.status
    }

    /// The ids this issue is blocked by.
    pub fn blocked_by(&self) -> &[String] {
        &self.blocked_by
    }

    /// The epic this issue is grouped under, if any.
    pub fn epic_id(&self) -> Option<&str> {
        self.epic_id.as_deref()
    }
}

impl DagNode for Issue {
    fn node_id(&self) -> &str {
        &self.id
    }

    fn blockers(&self) -> &[String] {
        &self.blocked_by
    }
}

/// Why a [`BoardStore`] mutation was refused. Its [`Display`](fmt::Display) is the
/// **model-facing** message the tool returns: every variant tells the model how to proceed,
/// and a refused mutation never partially applies.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BoardError {
    /// A required field was empty.
    EmptyField(&'static str),
    /// `create_epic` named an epic whose id already exists.
    DuplicateEpic(String),
    /// `create_issue` named an issue whose id already exists.
    DuplicateIssue(String),
    /// A tool named an epic id that does not exist.
    EpicNotFound(String),
    /// A tool named an issue id that does not exist.
    IssueNotFound(String),
    /// A `blockedBy` list referenced an issue id that does not exist.
    BlockerNotFound(String),
    /// An issue was declared blocked by itself.
    SelfBlock(String),
    /// The edge would introduce a cycle: `blocker` already depends (directly or transitively)
    /// on `issue`, so blocking `issue` on `blocker` would close a loop.
    Cycle {
        /// The issue the edge was being added to.
        issue: String,
        /// The blocker that already depends on `issue`.
        blocker: String,
    },
    /// An `epicId` referenced an epic that does not exist.
    UnknownEpic(String),
    /// Adding an epic or issue would exceed the count cap.
    CountCap {
        /// What kind of node hit its cap (`"epic"` or `"issue"`).
        kind: &'static str,
        /// The count cap (already reached).
        cap: usize,
    },
    /// `update_issue` was called with no field to change.
    NoUpdateFields,
}

impl fmt::Display for BoardError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BoardError::EmptyField(field) => write!(f, "`{field}` must not be empty."),
            BoardError::DuplicateEpic(id) => write!(
                f,
                "an epic with id `{id}` already exists; choose a different id."
            ),
            BoardError::DuplicateIssue(id) => write!(
                f,
                "an issue with id `{id}` already exists; use `update_issue` to revise it, or \
                 choose a different id."
            ),
            BoardError::EpicNotFound(id) => write!(
                f,
                "no epic with id `{id}` exists (your current board is in your context); create \
                 it with `create_epic`."
            ),
            BoardError::IssueNotFound(id) => write!(
                f,
                "no issue with id `{id}` exists (your current board is in your context); create \
                 it with `create_issue`."
            ),
            BoardError::BlockerNotFound(id) => write!(
                f,
                "`blockedBy` references issue `{id}`, which does not exist; create it first, or \
                 correct the id."
            ),
            BoardError::SelfBlock(id) => {
                write!(f, "issue `{id}` cannot be blocked by itself.")
            }
            BoardError::Cycle { issue, blocker } => write!(
                f,
                "blocking `{issue}` on `{blocker}` would create a cycle: `{blocker}` already \
                 depends (directly or indirectly) on `{issue}`. Issues form a DAG, so this edge \
                 is refused."
            ),
            BoardError::UnknownEpic(id) => write!(
                f,
                "`epicId` references epic `{id}`, which does not exist; create it with \
                 `create_epic`, or omit `epicId` to leave the issue ungrouped."
            ),
            BoardError::CountCap { kind, cap } => write!(
                f,
                "you already hold the maximum of {cap} {kind}(s); remove one before adding \
                 another."
            ),
            BoardError::NoUpdateFields => write!(
                f,
                "`update_issue` needs at least one of `title`, `description`, `inScope`, \
                 `outOfScope`, `completionCriteria`, `status`, or `epicId` to change."
            ),
        }
    }
}

/// What a successful [`BoardStore`] mutation did — the tool reports this in its confirmation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BoardChange {
    /// An epic was created.
    EpicCreated,
    /// An issue was created.
    IssueCreated,
    /// An issue was revised.
    IssueUpdated,
    /// An issue's blocked-by set was replaced.
    BlockersSet,
    /// An issue was marked done.
    IssueCompleted,
    /// An epic was removed.
    EpicRemoved,
    /// An issue was removed.
    IssueRemoved,
}

/// The fields an [`update_issue`](BoardStore::update_issue) may change. A `None` field is left
/// unchanged. For the three scope fields (which are required to be non-empty), `Some("")` is
/// refused rather than clearing; for [`description`](Self::description) an empty string clears
/// it; for [`epic_id`](Self::epic_id) an empty string clears the grouping (`Some(id)` re-groups
/// under an existing epic).
#[derive(Debug, Clone, Default)]
pub struct IssueUpdate<'a> {
    /// A new title (must be non-empty when supplied).
    pub title: Option<&'a str>,
    /// A new description (empty clears it).
    pub description: Option<&'a str>,
    /// A new in-scope (must be non-empty when supplied).
    pub in_scope: Option<&'a str>,
    /// A new out-of-scope (must be non-empty when supplied).
    pub out_of_scope: Option<&'a str>,
    /// A new completion criteria (must be non-empty when supplied).
    pub completion_criteria: Option<&'a str>,
    /// A new status.
    pub status: Option<IssueStatus>,
    /// A new epic grouping: `Some(id)` re-groups (the epic must exist), `Some("")` clears the
    /// grouping, `None` leaves it unchanged.
    pub epic_id: Option<&'a str>,
}

impl IssueUpdate<'_> {
    /// Whether the update carries any field to change.
    fn is_empty(&self) -> bool {
        self.title.is_none()
            && self.description.is_none()
            && self.in_scope.is_none()
            && self.out_of_scope.is_none()
            && self.completion_criteria.is_none()
            && self.status.is_none()
            && self.epic_id.is_none()
    }
}

/// The mutable, invariant-enforcing, cycle-rejecting owner of the model's epic/issue board.
///
/// The store is the single owner of the board; the [tools](crate::tools) and the
/// [loop](crate::agent) share it behind an `Arc<Mutex<…>>`. Epics and issues are kept in the
/// order they were created (a stable order for the rendered board and the telemetry). Every
/// mutation is validated — required fields, id uniqueness, blocker/epic existence, no
/// self-block, count caps, and **acyclicity** — before it takes effect, so the invariants
/// always hold; a refused mutation leaves the board untouched.
#[derive(Debug, Clone)]
pub struct BoardStore {
    caps: BoardCaps,
    epics: Vec<Epic>,
    issues: Vec<Issue>,
}

impl BoardStore {
    /// An empty board bounded by `caps`.
    pub fn new(caps: BoardCaps) -> Self {
        Self {
            caps,
            epics: Vec::new(),
            issues: Vec::new(),
        }
    }

    /// The caps this board enforces.
    pub fn caps(&self) -> BoardCaps {
        self.caps
    }

    /// The number of epics currently held.
    pub fn epic_count(&self) -> usize {
        self.epics.len()
    }

    /// The number of issues currently held.
    pub fn issue_count(&self) -> usize {
        self.issues.len()
    }

    /// The epics, in creation order. (A read surface for the tests and Phase 4 dispatch.)
    #[allow(dead_code)]
    pub fn epics(&self) -> &[Epic] {
        &self.epics
    }

    /// The issues, in creation order. (A read surface for the tests and Phase 4 dispatch.)
    #[allow(dead_code)]
    pub fn issues(&self) -> &[Issue] {
        &self.issues
    }

    /// Create a new epic. Refused if `id`/`title`/`description` is empty, an epic of that id
    /// already exists, or the board is at the epic cap.
    pub fn create_epic(
        &mut self,
        id: &str,
        title: &str,
        description: &str,
    ) -> Result<BoardChange, BoardError> {
        let id = require_field(id, "id")?;
        let title = require_field(title, "title")?;
        let description = require_field(description, "description")?;
        if self.epic_position(id).is_some() {
            return Err(BoardError::DuplicateEpic(id.to_string()));
        }
        if self.epics.len() >= self.caps.max_epics {
            return Err(BoardError::CountCap {
                kind: "epic",
                cap: self.caps.max_epics,
            });
        }
        self.epics.push(Epic {
            id: id.to_string(),
            title: title.to_string(),
            description: description.to_string(),
        });
        Ok(BoardChange::EpicCreated)
    }

    /// Create a new issue with its structured sections. Refused if a required field
    /// (`id`/`title`/`inScope`/`outOfScope`/`completionCriteria`) is empty, an issue of that id
    /// already exists, the board is at the issue cap, an `epic_id` names a non-existent epic, a
    /// `blocked_by` entry is empty/self/unknown, or an edge would create a cycle. A newly
    /// created issue has no dependents, so its only DAG failure is referencing a non-existent
    /// blocker.
    #[allow(clippy::too_many_arguments)]
    pub fn create_issue(
        &mut self,
        id: &str,
        title: &str,
        description: Option<&str>,
        in_scope: &str,
        out_of_scope: &str,
        completion_criteria: &str,
        blocked_by: &[String],
        epic_id: Option<&str>,
    ) -> Result<BoardChange, BoardError> {
        let id = require_field(id, "id")?;
        let title = require_field(title, "title")?;
        let in_scope = require_field(in_scope, "inScope")?;
        let out_of_scope = require_field(out_of_scope, "outOfScope")?;
        let completion_criteria = require_field(completion_criteria, "completionCriteria")?;
        if self.issue_position(id).is_some() {
            return Err(BoardError::DuplicateIssue(id.to_string()));
        }
        if self.issues.len() >= self.caps.max_issues {
            return Err(BoardError::CountCap {
                kind: "issue",
                cap: self.caps.max_issues,
            });
        }
        let epic_id = self.resolve_epic_grouping(epic_id)?;
        let blockers = self.normalize_blockers(id, blocked_by)?;
        if let Some(blocker) = dag::first_cycle(&self.issues, id, &blockers) {
            return Err(BoardError::Cycle {
                issue: id.to_string(),
                blocker,
            });
        }
        self.issues.push(Issue {
            id: id.to_string(),
            title: title.to_string(),
            description: clean_optional(description),
            in_scope: in_scope.to_string(),
            out_of_scope: out_of_scope.to_string(),
            completion_criteria: completion_criteria.to_string(),
            status: IssueStatus::Open,
            blocked_by: blockers,
            epic_id,
        });
        Ok(BoardChange::IssueCreated)
    }

    /// Revise an issue's fields and/or status in place. At least one field must be supplied.
    /// The blocked-by set is not touched here (use
    /// [`set_issue_blocked_by`](Self::set_issue_blocked_by)). A refused update applies nothing.
    pub fn update_issue(
        &mut self,
        id: &str,
        update: IssueUpdate<'_>,
    ) -> Result<BoardChange, BoardError> {
        let id = require_field(id, "id")?;
        if update.is_empty() {
            return Err(BoardError::NoUpdateFields);
        }
        // Validate everything before mutating so a refused update applies nothing.
        require_non_empty_when_present(update.title, "title")?;
        require_non_empty_when_present(update.in_scope, "inScope")?;
        require_non_empty_when_present(update.out_of_scope, "outOfScope")?;
        require_non_empty_when_present(update.completion_criteria, "completionCriteria")?;
        // A re-group to a non-empty epic id must name an existing epic (an empty one clears).
        let regroup = match update.epic_id {
            Some(epic) if !epic.trim().is_empty() => {
                Some(self.require_epic(epic.trim())?.to_string())
            }
            Some(_) => Some(String::new()), // clear grouping
            None => None,
        };
        let Some(index) = self.issue_position(id) else {
            return Err(BoardError::IssueNotFound(id.to_string()));
        };
        if let Some(title) = update.title {
            self.issues[index].title = title.trim().to_string();
        }
        if let Some(description) = update.description {
            self.issues[index].description = clean_optional(Some(description));
        }
        if let Some(in_scope) = update.in_scope {
            self.issues[index].in_scope = in_scope.trim().to_string();
        }
        if let Some(out_of_scope) = update.out_of_scope {
            self.issues[index].out_of_scope = out_of_scope.trim().to_string();
        }
        if let Some(completion_criteria) = update.completion_criteria {
            self.issues[index].completion_criteria = completion_criteria.trim().to_string();
        }
        if let Some(status) = update.status {
            self.issues[index].status = status;
        }
        if let Some(epic_id) = regroup {
            self.issues[index].epic_id = (!epic_id.is_empty()).then_some(epic_id);
        }
        Ok(BoardChange::IssueUpdated)
    }

    /// Replace an issue's blocked-by set with `blockers`. Refused if the issue does not exist, a
    /// blocker is empty/self/unknown, or the resulting graph would contain a cycle — in which
    /// case the issue's existing blockers are left unchanged.
    pub fn set_issue_blocked_by(
        &mut self,
        id: &str,
        blockers: &[String],
    ) -> Result<BoardChange, BoardError> {
        let id = require_field(id, "id")?;
        let Some(index) = self.issue_position(id) else {
            return Err(BoardError::IssueNotFound(id.to_string()));
        };
        let normalized = self.normalize_blockers(id, blockers)?;
        if let Some(blocker) = dag::first_cycle(&self.issues, id, &normalized) {
            return Err(BoardError::Cycle {
                issue: id.to_string(),
                blocker,
            });
        }
        self.issues[index].blocked_by = normalized;
        Ok(BoardChange::BlockersSet)
    }

    /// Mark an issue [`Done`](IssueStatus::Done). Refused if no issue of that id exists.
    pub fn complete_issue(&mut self, id: &str) -> Result<BoardChange, BoardError> {
        let id = require_field(id, "id")?;
        let Some(index) = self.issue_position(id) else {
            return Err(BoardError::IssueNotFound(id.to_string()));
        };
        self.issues[index].status = IssueStatus::Done;
        Ok(BoardChange::IssueCompleted)
    }

    /// Remove an epic. Refused if no epic of that id exists. Any issue grouped under it is
    /// ungrouped (its `epic_id` cleared) so no dangling grouping is left behind.
    pub fn remove_epic(&mut self, id: &str) -> Result<BoardChange, BoardError> {
        let id = require_field(id, "id")?;
        let Some(index) = self.epic_position(id) else {
            return Err(BoardError::EpicNotFound(id.to_string()));
        };
        self.epics.remove(index);
        for issue in &mut self.issues {
            if issue.epic_id.as_deref() == Some(id) {
                issue.epic_id = None;
            }
        }
        Ok(BoardChange::EpicRemoved)
    }

    /// Remove an issue. Refused if no issue of that id exists. The removed id is also stripped
    /// from every other issue's blocked-by set, so no dangling edge is left behind.
    pub fn remove_issue(&mut self, id: &str) -> Result<BoardChange, BoardError> {
        let id = require_field(id, "id")?;
        let Some(index) = self.issue_position(id) else {
            return Err(BoardError::IssueNotFound(id.to_string()));
        };
        self.issues.remove(index);
        for issue in &mut self.issues {
            issue.blocked_by.retain(|blocker| blocker != id);
        }
        Ok(BoardChange::IssueRemoved)
    }

    /// The index of the epic with id `id`, if any.
    fn epic_position(&self, id: &str) -> Option<usize> {
        self.epics.iter().position(|epic| epic.id == id)
    }

    /// The index of the issue with id `id`, if any.
    fn issue_position(&self, id: &str) -> Option<usize> {
        self.issues.iter().position(|issue| issue.id == id)
    }

    /// The status of the issue with id `id`, if it exists.
    fn issue_status_of(&self, id: &str) -> Option<IssueStatus> {
        self.issues
            .iter()
            .find(|issue| issue.id == id)
            .map(|issue| issue.status)
    }

    /// Resolve an optional `epic_id` supplied at creation: `None`/blank leaves the issue
    /// ungrouped; a non-blank id must name an existing epic.
    fn resolve_epic_grouping(&self, epic_id: Option<&str>) -> Result<Option<String>, BoardError> {
        match epic_id.map(str::trim).filter(|id| !id.is_empty()) {
            Some(id) => Ok(Some(self.require_epic(id)?.to_string())),
            None => Ok(None),
        }
    }

    /// The id of an existing epic, or a [`UnknownEpic`](BoardError::UnknownEpic) error.
    fn require_epic<'a>(&self, id: &'a str) -> Result<&'a str, BoardError> {
        if self.epic_position(id).is_some() {
            Ok(id)
        } else {
            Err(BoardError::UnknownEpic(id.to_string()))
        }
    }

    /// Trim, validate, and deduplicate a blocked-by list for `subject`: every entry must be
    /// non-empty, must not be `subject` itself, and must name an existing issue. Order is
    /// preserved and duplicates are dropped.
    fn normalize_blockers(&self, subject: &str, raw: &[String]) -> Result<Vec<String>, BoardError> {
        let mut out: Vec<String> = Vec::new();
        for entry in raw {
            let entry = entry.trim();
            if entry.is_empty() {
                return Err(BoardError::EmptyField("blockedBy"));
            }
            if entry == subject {
                return Err(BoardError::SelfBlock(subject.to_string()));
            }
            if self.issue_position(entry).is_none() {
                return Err(BoardError::BlockerNotFound(entry.to_string()));
            }
            if !out.iter().any(|existing| existing == entry) {
                out.push(entry.to_string());
            }
        }
        Ok(out)
    }

    /// Whether an issue is actionable: not done, and every issue it is blocked by is done.
    fn is_ready(&self, issue: &Issue) -> bool {
        issue.status != IssueStatus::Done
            && issue
                .blocked_by
                .iter()
                .all(|blocker| self.issue_status_of(blocker) == Some(IssueStatus::Done))
    }

    /// The ids of an issue's blockers that are not yet done — what is holding it up.
    fn incomplete_blockers<'a>(&self, issue: &'a Issue) -> Vec<&'a str> {
        issue
            .blocked_by
            .iter()
            .filter(|blocker| self.issue_status_of(blocker) != Some(IssueStatus::Done))
            .map(String::as_str)
            .collect()
    }

    /// The [`BoardState`](GgTelemetryKind::BoardState) telemetry for the current board.
    fn state_event(&self) -> GgTelemetryKind {
        let epics = self
            .epics
            .iter()
            .map(|epic| GgBoardEpic {
                id: epic.id.clone(),
                title: epic.title.clone(),
                description: epic.description.clone(),
            })
            .collect();
        let issues = self
            .issues
            .iter()
            .map(|issue| GgBoardIssue {
                id: issue.id.clone(),
                title: issue.title.clone(),
                description: issue.description.clone(),
                in_scope: issue.in_scope.clone(),
                out_of_scope: issue.out_of_scope.clone(),
                completion_criteria: issue.completion_criteria.clone(),
                status: issue.status.to_contract(),
                blocked_by: issue.blocked_by.clone(),
                epic_id: issue.epic_id.clone(),
            })
            .collect();
        GgTelemetryKind::BoardState { epics, issues }
    }

    /// The pinned context block rendering the whole board — its epics, then each issue's
    /// status, title, epic grouping, ready/blocked state, and structured scope sections — or
    /// `None` when the board is empty.
    fn context_block(&self) -> Option<Message> {
        if self.epics.is_empty() && self.issues.is_empty() {
            return None;
        }
        let mut block = String::from(
            "# Your epic/issue board\n\nThis is your decomposition of the build for this \
             session. You maintain it with `create_epic`, `create_issue`, `update_issue`, \
             `set_issue_blocked_by`, `complete_issue`, `remove_epic`, and `remove_issue`. It is \
             retained even when your context is compacted. Issues form a **DAG**: an issue is \
             ready to work only once every issue it is blocked by is done, and gg refuses any \
             edge that would create a cycle. Each issue's in-scope, out-of-scope, and \
             completion-criteria are its brief — keep them precise enough to hand off.",
        );
        if !self.epics.is_empty() {
            block.push_str("\n\n## Epics");
            for epic in &self.epics {
                block.push_str(&format!(
                    "\n\n- `{}` — {}: {}",
                    epic.id, epic.title, epic.description
                ));
            }
        }
        if !self.issues.is_empty() {
            block.push_str("\n\n## Issues");
            for issue in &self.issues {
                block.push_str(&self.render_issue(issue));
            }
        }
        Some(Message::user(block))
    }

    /// The dispatch **brief** for the issue with id `id` — its title, optional overview, and the
    /// three structured sections that bound a subagent's work (in-scope, out-of-scope, completion
    /// criteria) — or `None` when no issue of that id exists. This is the P4 subagent dispatch
    /// seam: `spawn_subagent { issueId }` reads the brief straight off the board (a read, not a
    /// reshaping), matching the [dispatch seam](self) the issue fields were designed for.
    fn issue_brief(&self, id: &str) -> Option<String> {
        let issue = self.issues.iter().find(|issue| issue.id == id)?;
        let mut brief = format!("# Issue `{}`: {}", issue.id, issue.title);
        if let Some(description) = &issue.description {
            brief.push_str(&format!("\n\n{description}"));
        }
        brief.push_str(&format!("\n\n## In scope\n{}", issue.in_scope));
        brief.push_str(&format!("\n\n## Out of scope\n{}", issue.out_of_scope));
        brief.push_str(&format!("\n\n## Done when\n{}", issue.completion_criteria));
        Some(brief)
    }

    /// Render one issue as a block for the pinned [context block](Self::context_block).
    fn render_issue(&self, issue: &Issue) -> String {
        let mut line = format!(
            "\n\n- {} `{}` ({}) — {}",
            issue.status.marker(),
            issue.id,
            issue.status.word(),
            issue.title
        );
        if let Some(epic_id) = &issue.epic_id {
            line.push_str(&format!("  [epic: `{epic_id}`]"));
        }
        if issue.status != IssueStatus::Done {
            if self.is_ready(issue) {
                line.push_str("  [ready]");
            } else {
                let blockers: Vec<String> = self
                    .incomplete_blockers(issue)
                    .iter()
                    .map(|id| format!("`{id}`"))
                    .collect();
                line.push_str(&format!("  [blocked by {}]", blockers.join(", ")));
            }
        }
        if let Some(description) = &issue.description {
            line.push_str(&format!("\n  - overview: {description}"));
        }
        line.push_str(&format!("\n  - in scope: {}", issue.in_scope));
        line.push_str(&format!("\n  - out of scope: {}", issue.out_of_scope));
        line.push_str(&format!("\n  - done when: {}", issue.completion_criteria));
        line
    }
}

/// Trim a required field, refusing an empty (or whitespace-only) value.
fn require_field<'a>(value: &'a str, field: &'static str) -> Result<&'a str, BoardError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(BoardError::EmptyField(field))
    } else {
        Ok(trimmed)
    }
}

/// Refuse an empty (or whitespace-only) value when a field is present in an update; a `None`
/// (unchanged) field is fine.
fn require_non_empty_when_present(
    value: Option<&str>,
    field: &'static str,
) -> Result<(), BoardError> {
    match value {
        Some(v) if v.trim().is_empty() => Err(BoardError::EmptyField(field)),
        _ => Ok(()),
    }
}

/// Trim a supplied optional string, treating an empty (or whitespace-only) one as absent.
fn clean_optional(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

/// The loop's live view of the epics-and-issues capability: whether it is on and the shared
/// [`BoardStore`].
///
/// Constructed [enabled](Self::new) with caps or [disabled](Self::disabled) (an ablation's off
/// arm). It hands the [`store`](Self::store) to the board tools, produces the system-prompt
/// [section](Self::prompt_section), the [`BoardState`](GgTelemetryKind::BoardState)
/// [telemetry](Self::state_event), and the pinned [context block](Self::context_block) the loop
/// keeps in the window.
#[derive(Debug, Clone)]
pub struct BoardRuntime {
    /// Whether the epics-and-issues capability is enabled for this run.
    enabled: bool,
    /// The shared, mutable store — the same handle the tools mutate.
    store: Arc<Mutex<BoardStore>>,
}

impl BoardRuntime {
    /// An enabled runtime with an empty board bounded by `caps`.
    pub fn new(caps: BoardCaps) -> Self {
        Self {
            enabled: true,
            store: Arc::new(Mutex::new(BoardStore::new(caps))),
        }
    }

    /// A disabled runtime (the capability is off): no tools, no prompt section, no context
    /// block, no telemetry.
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            store: Arc::new(Mutex::new(BoardStore::new(BoardCaps::default()))),
        }
    }

    /// Whether the capability offers board tools this run (simply whether it is enabled — the
    /// model creates its own epics and issues, so no pre-existing content is required).
    pub fn offers_board(&self) -> bool {
        self.enabled
    }

    /// The shared store, for binding into the board tools.
    pub fn store(&self) -> Arc<Mutex<BoardStore>> {
        Arc::clone(&self.store)
    }

    /// The caps this run enforces.
    pub fn caps(&self) -> BoardCaps {
        self.store.lock().expect("board store lock").caps()
    }

    /// The number of issues on the board — reported as the issues figure of a
    /// [compaction](https://docs.testcabinet.ai/gg/compaction/) boundary's retention proof.
    /// Zero when the capability is off (the store is empty).
    pub fn issue_count(&self) -> usize {
        self.store.lock().expect("board store lock").issue_count()
    }

    /// The number of epics on the board. (A read surface for the tests and console-facing
    /// derivations; the loop reports the issue count as the retention figure.)
    #[allow(dead_code)]
    pub fn epic_count(&self) -> usize {
        self.store.lock().expect("board store lock").epic_count()
    }

    /// The system-prompt section telling the model it can decompose the build into epics and
    /// issues and how the DAG behaves, or `None` when the capability is off. The board itself is
    /// injected as the pinned [context block](Self::context_block), not the prompt.
    pub fn prompt_section(&self) -> Option<String> {
        if !self.enabled {
            return None;
        }
        let caps = self.caps();
        Some(format!(
            "For a substantial build you can decompose the work on an **epic/issue board** — \
             the heavyweight counterpart to a task list. Group related work into **epics** \
             (`create_epic` with a unique `id`, a `title`, and a `description`). Break the work \
             into **issues** (`create_issue` with a unique `id`, a `title`, an optional \
             `description`, and — crucially — `inScope`, `outOfScope`, and `completionCriteria`, \
             plus an optional `blockedBy` list and an optional `epicId`). Fill in an issue's \
             scope and completion criteria precisely: they are the brief that lets the issue be \
             handed off and judged done. Revise an issue with `update_issue`, set its \
             dependencies with `set_issue_blocked_by`, mark it done with `complete_issue`, and \
             drop epics/issues with `remove_epic`/`remove_issue`. Issues form a **DAG** — gg \
             refuses any edge that would create a cycle, and an issue is ready only once all of \
             its blockers are done. Your board is shown back to you under \"Your epic/issue \
             board\" and survives context compaction, so keep it current. Hold at most {} epics \
             and {} issues.",
            caps.max_epics, caps.max_issues
        ))
    }

    /// The [`BoardState`](GgTelemetryKind::BoardState) telemetry for the current board, or
    /// `None` when the capability is off. Emitted at session start (empty) and after every
    /// successful mutation.
    pub fn state_event(&self) -> Option<GgTelemetryKind> {
        if !self.enabled {
            return None;
        }
        Some(self.store.lock().expect("board store lock").state_event())
    }

    /// The pinned context block rendering the current board, or `None` when the capability is
    /// off or the board is empty. The loop keeps this as the single
    /// [`Board`](test_cabinet_core::gg::GgContextSource::Board)-sourced item in the window.
    pub fn context_block(&self) -> Option<Message> {
        if !self.enabled {
            return None;
        }
        self.store.lock().expect("board store lock").context_block()
    }

    /// The [dispatch brief](BoardStore::issue_brief) for the issue with id `id`, for a subagent
    /// dispatched against it (`spawn_subagent { issueId }`), or `None` when the capability is off
    /// or no such issue exists.
    pub fn issue_brief(&self, id: &str) -> Option<String> {
        if !self.enabled {
            return None;
        }
        self.store.lock().expect("board store lock").issue_brief(id)
    }

    /// Mark the issue with id `id` [done](IssueStatus::Done), returning whether it was (an unknown
    /// id, or a disabled runtime, yields `false`). Used by the
    /// [Code Reviews](https://docs.testcabinet.ai/gg/code-reviews/) capability to **accept** an
    /// issue once its Code Review approves — the acceptance the `complete_issue` tool is intercepted
    /// to gate. The loop refreshes the pinned board block and re-emits
    /// [`BoardState`](GgTelemetryKind::BoardState) after, just as it does for the tool.
    pub fn complete_issue(&self, id: &str) -> bool {
        if !self.enabled {
            return false;
        }
        self.store
            .lock()
            .expect("board store lock")
            .complete_issue(id)
            .is_ok()
    }
}

#[cfg(test)]
#[path = "board.test.rs"]
mod tests;
