//! The board tools: `create_epic`, `create_issue`, `update_issue`, `set_issue_blocked_by`,
//! `remove_epic`, and `remove_issue` — how the model builds and maintains its
//! [epic/issue board](crate::board).
//!
//! There is no tool for *finishing* an issue: an issue is finished exactly when the agent gg
//! dispatched to implement it makes its own [ending call](crate::completion). See
//! [the board's own docs](crate::board#completion-is-the-agents-own-and-acceptance-is-ggs).
//!
//! Each tool mutates the shared [`BoardStore`] (behind an `Arc<Mutex<…>>` the tool shares with
//! the [loop](crate::agent)) and returns a [`ToolOutcome`]: a confirmation on success, or — when
//! a mutation is refused (a duplicate id, an unknown epic/issue, or, crucially, a
//! [cycle](crate::board::BoardError::Cycle)) — an **error outcome carrying the store's
//! guidance**, with the board left unchanged. The loop owns the context-window consequences:
//! after a successful mutation it re-emits the
//! [`BoardState`](test_cabinet_core::gg::GgTelemetryKind::BoardState) telemetry and rebuilds the
//! pinned [`Board`](test_cabinet_core::gg::GgContextSource::Board) block.
//!
//! The tools are contributed to the registry only when the
//! [`project-management`](test_cabinet_core::gg::CAPABILITY_PROJECT_MANAGEMENT) capability is enabled and
//! a store is bound; when it is off, none are offered.

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::{Value, json};

use super::{
    ArgumentError, BoardNodeData, BoardUsageData, Tool, ToolContext, ToolData, ToolFailure,
    ToolOutcome, invalid_argument, optional_str, required_str, saturating_u32,
};
use crate::board::{
    BoardChange, BoardError, BoardStore, IssuePolicy, IssueStatus, IssueUpdate, NewIssue,
};
use crate::model::ToolDefinition;

/// The `create_epic` tool name.
pub const CREATE_EPIC_TOOL: &str = "create_epic";
/// The `create_issue` tool name.
pub const CREATE_ISSUE_TOOL: &str = "create_issue";
/// The `update_issue` tool name.
pub const UPDATE_ISSUE_TOOL: &str = "update_issue";
/// The `set_issue_blocked_by` tool name.
pub const SET_ISSUE_BLOCKED_BY_TOOL: &str = "set_issue_blocked_by";
/// The `remove_epic` tool name.
pub const REMOVE_EPIC_TOOL: &str = "remove_epic";
/// The `remove_issue` tool name.
pub const REMOVE_ISSUE_TOOL: &str = "remove_issue";

/// Whether `name` is one of the board-mutating tools — the loop uses this to know when a
/// successful tool call should refresh the board block and re-emit its state.
pub fn is_board_tool(name: &str) -> bool {
    matches!(
        name,
        CREATE_EPIC_TOOL
            | CREATE_ISSUE_TOOL
            | UPDATE_ISSUE_TOOL
            | SET_ISSUE_BLOCKED_BY_TOOL
            | REMOVE_EPIC_TOOL
            | REMOVE_ISSUE_TOOL
    )
}

/// A short line describing how full the board is after a mutation.
fn usage_note(store: &BoardStore) -> String {
    let caps = store.caps();
    format!(
        "The board now holds {} of {} epic(s) and {} of {} issue(s).",
        store.epic_count(),
        caps.max_epics,
        store.issue_count(),
        caps.max_issues
    )
}

/// The four numbers [`usage_note`] renders into a sentence, as the structured sidecar every board
/// mutation that changes a population carries.
fn usage_data(store: &BoardStore) -> ToolData {
    let caps = store.caps();
    ToolData::BoardUsage(BoardUsageData {
        epics: saturating_u32(store.epic_count()),
        max_epics: saturating_u32(caps.max_epics),
        issues: saturating_u32(store.issue_count()),
        max_issues: saturating_u32(caps.max_issues),
    })
}

/// The [board usage](usage_data) plus the id the store just assigned — the sidecar the two creations
/// carry, since their caller cannot name what it filed otherwise.
fn board_node_data(id: &str, store: &BoardStore) -> ToolData {
    let ToolData::BoardUsage(board) = usage_data(store) else {
        unreachable!("usage_data yields BoardUsage")
    };
    ToolData::BoardNode(BoardNodeData {
        id: id.to_string(),
        board,
    })
}

/// Classify a [`BoardStore`] refusal, at the one place its error type is matched.
///
/// The store's [`Display`](std::fmt::Display) is the model-facing guidance; this mapping is what a
/// caller branches on, and it is derived from the variant rather than from that text.
fn failure_for(err: &BoardError) -> ToolFailure {
    match err {
        // The call itself was malformed: an empty field, a prefix that is not one, or a revision
        // that revises nothing.
        BoardError::EmptyField(_) | BoardError::InvalidPrefix(_) | BoardError::NoUpdateFields => {
            ToolFailure::InvalidArgument
        }
        // A named epic or issue is simply not on the board — the same recovery whether it was
        // named as the subject, as a blocker, or as an `epicId`.
        BoardError::EpicNotFound(_)
        | BoardError::IssueNotFound(_)
        | BoardError::BlockerNotFound(_)
        | BoardError::UnknownEpic(_) => ToolFailure::NotFound,
        // Well-formed, but irreconcilable with the board as it stands: a taken prefix, or an edge
        // that would close a loop (a self-block being the one-node case of exactly that).
        BoardError::DuplicateEpic(_) | BoardError::SelfBlock(_) | BoardError::Cycle { .. } => {
            ToolFailure::Conflict
        }
        BoardError::CountCap { .. } => ToolFailure::LimitExceeded,
    }
}

/// A list-of-names argument, `noun` naming what one entry is (`"issue id"`, `"agent name"`) so a
/// refusal reads as the field's own contract. When `required`, an absent key is an error;
/// otherwise it yields an empty list. Every entry must be a string.
fn name_array(
    args: &Value,
    field: &str,
    noun: &str,
    required: bool,
) -> Result<Vec<String>, ArgumentError> {
    match args.get(field) {
        None | Some(Value::Null) => {
            if required {
                Err(ArgumentError(format!(
                    "missing required argument `{field}` (a list of {noun}s)"
                )))
            } else {
                Ok(Vec::new())
            }
        }
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| match item {
                Value::String(id) => Ok(id.clone()),
                _ => Err(ArgumentError(format!(
                    "every entry in `{field}` must be a {noun} string"
                ))),
            })
            .collect(),
        Some(_) => Err(ArgumentError(format!(
            "argument `{field}` must be an array of {noun}s"
        ))),
    }
}

// ---------------------------------------------------------------------------
// create_epic
// ---------------------------------------------------------------------------

/// Creates an epic — a grouping of related issues.
pub struct CreateEpicTool {
    store: Arc<Mutex<BoardStore>>,
}

impl CreateEpicTool {
    /// A tool creating epics in `store`.
    pub fn new(store: Arc<Mutex<BoardStore>>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Tool for CreateEpicTool {
    fn name(&self) -> &str {
        CREATE_EPIC_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            CREATE_EPIC_TOOL,
            "Create an epic to group related issues. Provide a `prefix` of 3-6 letters naming the \
             epic (upper-cased for you — a prefix of `auth` becomes `AUTH`), a `title`, and a \
             `description` of what the epic covers. The prefix is the epic's id, and the issues you \
             file under it are numbered from it: `AUTH-1`, `AUTH-2`, and so on.",
            json!({
                "type": "object",
                "properties": {
                    "prefix": {
                        "type": "string",
                        "description": "A 3-6 letter prefix naming the epic (upper-cased); its \
                                        issues are numbered from it, e.g. `AUTH-1`."
                    },
                    "title": { "type": "string", "description": "A short title for the epic." },
                    "description": {
                        "type": "string",
                        "description": "What this epic covers."
                    }
                },
                "required": ["prefix", "title", "description"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let prefix = match required_str(&args, "prefix") {
            Ok(v) => v,
            Err(error) => return error.into(),
        };
        let title = match required_str(&args, "title") {
            Ok(v) => v,
            Err(error) => return error.into(),
        };
        let description = match required_str(&args, "description") {
            Ok(v) => v,
            Err(error) => return error.into(),
        };
        self.create_epic(prefix, title, description)
    }
}

impl CreateEpicTool {
    /// Create an epic — the **standard, typed** `create_epic` API function both the JSON
    /// [adapter](Tool::invoke) and the [responses-as-code membrane](crate::sandbox) reach.
    ///
    /// The confirmation states the id the prefix resolved to (`auth` → `AUTH`) and how its issues
    /// will be numbered, since that id is what every later call has to reference.
    pub(crate) fn create_epic(
        &self,
        prefix: String,
        title: String,
        description: String,
    ) -> ToolOutcome {
        let mut store = self.store.lock().expect("board store lock");
        match store.create_epic(&prefix, &title, &description) {
            Ok(id) => ToolOutcome::ok(
                format!(
                    "Created epic `{id}`; its issues will be numbered `{id}-1`, `{id}-2`, and so \
                     on. {}",
                    usage_note(&store)
                ),
                format!("created epic `{id}`"),
            )
            .with_data(board_node_data(&id, &store)),
            Err(err) => ToolOutcome::failed(failure_for(&err), err.to_string()),
        }
    }
}

// ---------------------------------------------------------------------------
// create_issue
// ---------------------------------------------------------------------------

/// Creates a structured, dispatchable issue, assigned to one of the filing agent's own
/// [implementer profiles](IssuePolicy::implementers).
pub struct CreateIssueTool {
    store: Arc<Mutex<BoardStore>>,
    /// The filing agent's own rules: who it may assign work to, who it may name as a reviewer,
    /// and whether reviewers are demanded.
    /// Per agent, so it is bound onto the tool rather than read off the shared store.
    policy: IssuePolicy,
}

impl CreateIssueTool {
    /// A tool creating issues in `store` under the filing agent's `policy`.
    pub fn new(store: Arc<Mutex<BoardStore>>, policy: IssuePolicy) -> Self {
        Self { store, policy }
    }

    /// The `agent`/`reviewers` half of the tool's description — the profiles this agent may
    /// assign the work to, the ones it may name as reviewers, and whether naming reviewers is
    /// required.
    fn assignment_guidance(&self) -> String {
        let implementers = self.policy.implementer_list();
        let reviewer_list = self.policy.reviewer_list();
        let reviewers = if self.policy.require_reviewers {
            format!(
                " You must also name one or more `reviewers`, drawn from: {reviewer_list}. Each of \
                 them reviews the finished work, and all of them must approve it before the issue \
                 is accepted."
            )
        } else {
            format!(
                " You may name one or more `reviewers`, drawn from: {reviewer_list}. Each of them \
                 reviews the finished work, and all of them must approve it before the issue is \
                 accepted."
            )
        };
        format!(
            " Name in `agent` the agent this issue is dispatched to; you may assign to: \
             {implementers}.{reviewers}"
        )
    }

    /// Refuse a profile this agent may not assign the issue to, naming the ones it may.
    fn check_implementer(&self, name: &str) -> Option<ToolOutcome> {
        if self.policy.allows_implementer(name.trim()) {
            return None;
        }
        Some(ToolOutcome::failed(
            ToolFailure::InvalidArgument,
            format!(
                "`agent`: unknown agent `{name}`; expected one of: {}",
                self.policy.implementer_list()
            ),
        ))
    }

    /// Refuse a profile this agent may not name as a reviewer, naming the ones it may.
    fn check_reviewer(&self, name: &str) -> Option<ToolOutcome> {
        if self.policy.allows_reviewer(name.trim()) {
            return None;
        }
        Some(ToolOutcome::failed(
            ToolFailure::InvalidArgument,
            format!(
                "`reviewers`: unknown agent `{name}`; expected one of: {}",
                self.policy.reviewer_list()
            ),
        ))
    }
}

#[async_trait]
impl Tool for CreateIssueTool {
    fn name(&self) -> &str {
        CREATE_ISSUE_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        let mut required = vec![
            "title",
            "inScope",
            "outOfScope",
            "completionCriteria",
            "agent",
        ];
        if self.policy.require_reviewers {
            required.push("reviewers");
        }
        ToolDefinition::new(
            CREATE_ISSUE_TOOL,
            format!(
                "Create an issue — a heavyweight, self-contained unit of work. Provide a `title` \
                 and the structured sections that make it safe to hand off: `inScope` (what this \
                 issue is responsible for), `outOfScope` (what it is not), and \
                 `completionCriteria` (how it will be judged done). Optionally add a \
                 `description` overview, a `blockedBy` list of issue ids that must finish first \
                 (a cycle is refused — issues form a DAG), and an `epicId` to group it under an \
                 epic. You do not choose the issue's id: it is assigned from its epic's prefix \
                 (`AUTH-1`, `AUTH-2`, …) and reported back to you.{}",
                self.assignment_guidance()
            ),
            json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string", "description": "A short title for the issue." },
                    "description": {
                        "type": "string",
                        "description": "An optional longer overview of the issue."
                    },
                    "inScope": {
                        "type": "string",
                        "description": "What this issue is responsible for."
                    },
                    "outOfScope": {
                        "type": "string",
                        "description": "What this issue is explicitly not responsible for."
                    },
                    "completionCriteria": {
                        "type": "string",
                        "description": "How the issue will be judged done (its acceptance criteria)."
                    },
                    "blockedBy": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional ids of issues that must be done before this one."
                    },
                    "epicId": {
                        "type": "string",
                        "description": "Optional id of the epic to group this issue under."
                    },
                    "agent": {
                        "type": "string",
                        "enum": self.policy.implementers,
                        "description": "The agent to dispatch this issue to."
                    },
                    "reviewers": {
                        "type": "array",
                        "items": { "type": "string", "enum": self.policy.reviewers },
                        "description": "The agents that must each approve this issue's work \
                                        before it is accepted."
                    }
                },
                "required": required,
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let title = match required_str(&args, "title") {
            Ok(v) => v,
            Err(error) => return error.into(),
        };
        let in_scope = match required_str(&args, "inScope") {
            Ok(v) => v,
            Err(error) => return error.into(),
        };
        let out_of_scope = match required_str(&args, "outOfScope") {
            Ok(v) => v,
            Err(error) => return error.into(),
        };
        let completion_criteria = match required_str(&args, "completionCriteria") {
            Ok(v) => v,
            Err(error) => return error.into(),
        };
        let agent = match required_str(&args, "agent") {
            Ok(v) => v,
            Err(error) => return error.into(),
        };
        let description = match optional_str(&args, "description") {
            Ok(v) => v,
            Err(error) => return error.into(),
        };
        let epic_id = match optional_str(&args, "epicId") {
            Ok(v) => v,
            Err(error) => return error.into(),
        };
        let blocked_by = match name_array(&args, "blockedBy", "issue id", false) {
            Ok(v) => v,
            Err(error) => return error.into(),
        };
        let reviewers = match name_array(&args, "reviewers", "agent name", false) {
            Ok(v) => v,
            Err(error) => return error.into(),
        };
        self.create_issue(
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
    }
}

impl CreateIssueTool {
    /// Create an issue — the **standard, typed** `create_issue` API function both the JSON
    /// [adapter](Tool::invoke) and the [responses-as-code membrane](crate::sandbox) reach.
    ///
    /// The assignment rules are enforced here, before the store is touched: `agent` must be one of
    /// this agent's [implementers](IssuePolicy::implementers), every reviewer one of its
    /// [reviewers](IssuePolicy::reviewers), and a
    /// [reviewers-required](IssuePolicy::require_reviewers) agent must name at least one.
    ///
    /// The id the store assigned is both stated in the confirmation and carried structurally on the
    /// [`BoardNode`](ToolData::BoardNode) sidecar, so a program that files an issue can go on to
    /// reference it (as a blocker, or in a `wait_for_issue`) without parsing prose.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn create_issue(
        &self,
        title: String,
        description: Option<String>,
        in_scope: String,
        out_of_scope: String,
        completion_criteria: String,
        blocked_by: Vec<String>,
        epic_id: Option<String>,
        agent: String,
        reviewers: Vec<String>,
    ) -> ToolOutcome {
        if let Some(refusal) = self.check_implementer(&agent) {
            return refusal;
        }
        if self.policy.require_reviewers && reviewers.iter().all(|r| r.trim().is_empty()) {
            return ToolOutcome::failed(
                ToolFailure::InvalidArgument,
                format!(
                    "`reviewers` must name at least one reviewer; expected one of: {}",
                    self.policy.reviewer_list()
                ),
            );
        }
        for reviewer in &reviewers {
            if let Some(refusal) = self.check_reviewer(reviewer) {
                return refusal;
            }
        }
        let mut store = self.store.lock().expect("board store lock");
        match store.create_issue(NewIssue {
            title: &title,
            description: description.as_deref(),
            in_scope: &in_scope,
            out_of_scope: &out_of_scope,
            completion_criteria: &completion_criteria,
            blocked_by: &blocked_by,
            epic_id: epic_id.as_deref(),
            agent: &agent,
            reviewers: &reviewers,
        }) {
            Ok(id) => ToolOutcome::ok(
                format!(
                    "Created issue `{id}`, assigned to `{agent}`. {}",
                    usage_note(&store)
                ),
                format!("created issue `{id}`"),
            )
            .with_data(board_node_data(&id, &store)),
            Err(err) => ToolOutcome::failed(failure_for(&err), err.to_string()),
        }
    }
}

// ---------------------------------------------------------------------------
// update_issue
// ---------------------------------------------------------------------------

/// Revises an issue's fields or status.
pub struct UpdateIssueTool {
    store: Arc<Mutex<BoardStore>>,
}

impl UpdateIssueTool {
    /// A tool updating issues in `store`.
    pub fn new(store: Arc<Mutex<BoardStore>>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Tool for UpdateIssueTool {
    fn name(&self) -> &str {
        UPDATE_ISSUE_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            UPDATE_ISSUE_TOOL,
            "Revise an issue by `id`: change its `title`, `description`, `inScope`, \
             `outOfScope`, `completionCriteria`, `status` (`open`, `in_progress`, or `done`), \
             and/or `epicId` (pass an empty string to ungroup it). Supply at least one field to \
             change. To change what an issue is blocked by, use `set_issue_blocked_by` instead.",
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "The id of the issue to revise." },
                    "title": { "type": "string", "description": "A new title." },
                    "description": {
                        "type": "string",
                        "description": "A new overview (empty clears it)."
                    },
                    "inScope": { "type": "string", "description": "A new in-scope statement." },
                    "outOfScope": { "type": "string", "description": "A new out-of-scope statement." },
                    "completionCriteria": {
                        "type": "string",
                        "description": "New completion criteria."
                    },
                    "status": {
                        "type": "string",
                        "enum": ["open", "in_progress", "done"],
                        "description": "A new status."
                    },
                    "epicId": {
                        "type": "string",
                        "description": "Re-group under this epic (empty string ungroups)."
                    }
                },
                "required": ["id"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let id = match required_str(&args, "id") {
            Ok(v) => v,
            Err(error) => return error.into(),
        };
        let title = match optional_str(&args, "title") {
            Ok(v) => v,
            Err(error) => return error.into(),
        };
        let description = match optional_str(&args, "description") {
            Ok(v) => v,
            Err(error) => return error.into(),
        };
        let in_scope = match optional_str(&args, "inScope") {
            Ok(v) => v,
            Err(error) => return error.into(),
        };
        let out_of_scope = match optional_str(&args, "outOfScope") {
            Ok(v) => v,
            Err(error) => return error.into(),
        };
        let completion_criteria = match optional_str(&args, "completionCriteria") {
            Ok(v) => v,
            Err(error) => return error.into(),
        };
        let epic_id = match optional_str(&args, "epicId") {
            Ok(v) => v,
            Err(error) => return error.into(),
        };
        let status = match optional_str(&args, "status") {
            Ok(Some(raw)) => match IssueStatus::parse(&raw) {
                Some(status) => Some(status),
                None => {
                    return invalid_argument(format!(
                        "`{raw}` is not a valid status; expected `open`, \
                         `in_progress` or `done`"
                    ));
                }
            },
            Ok(None) => None,
            Err(error) => return error.into(),
        };
        self.update_issue(
            id,
            title,
            description,
            in_scope,
            out_of_scope,
            completion_criteria,
            status,
            epic_id,
        )
    }
}

impl UpdateIssueTool {
    /// Revise an issue in place — the **standard, typed** `update_issue` API function both the JSON
    /// [adapter](Tool::invoke) and the [responses-as-code membrane](crate::sandbox) reach. A `None`
    /// field is left alone; an empty `description`/`epic_id` clears (ungroups) it.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn update_issue(
        &self,
        id: String,
        title: Option<String>,
        description: Option<String>,
        in_scope: Option<String>,
        out_of_scope: Option<String>,
        completion_criteria: Option<String>,
        status: Option<IssueStatus>,
        epic_id: Option<String>,
    ) -> ToolOutcome {
        let update = IssueUpdate {
            title: title.as_deref(),
            description: description.as_deref(),
            in_scope: in_scope.as_deref(),
            out_of_scope: out_of_scope.as_deref(),
            completion_criteria: completion_criteria.as_deref(),
            status,
            epic_id: epic_id.as_deref(),
        };
        let mut store = self.store.lock().expect("board store lock");
        match store.update_issue(&id, update) {
            // A revision changes neither population, so there is no usage figure worth reporting.
            Ok(BoardChange::IssueUpdated) => ToolOutcome::ok(
                format!("Updated issue `{id}`."),
                format!("updated issue `{id}`"),
            ),
            Ok(_) => unreachable!("update_issue yields IssueUpdated"),
            Err(err) => ToolOutcome::failed(failure_for(&err), err.to_string()),
        }
    }
}

// ---------------------------------------------------------------------------
// set_issue_blocked_by
// ---------------------------------------------------------------------------

/// Replaces an issue's blocked-by set, rejecting any cycle.
pub struct SetIssueBlockedByTool {
    store: Arc<Mutex<BoardStore>>,
}

impl SetIssueBlockedByTool {
    /// A tool setting blocked-by edges in `store`.
    pub fn new(store: Arc<Mutex<BoardStore>>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Tool for SetIssueBlockedByTool {
    fn name(&self) -> &str {
        SET_ISSUE_BLOCKED_BY_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            SET_ISSUE_BLOCKED_BY_TOOL,
            "Set which issues an issue is blocked by. Provide the issue `id` and the full \
             `blockedBy` list of issue ids that must finish first (pass `[]` to clear all \
             blockers). This replaces the issue's current blockers. Any edge that would create a \
             cycle is refused and nothing changes — issues form a DAG.",
            json!({
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string",
                        "description": "The id of the issue whose blockers to set."
                    },
                    "blockedBy": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "The full set of issue ids this issue is blocked by (`[]` clears)."
                    }
                },
                "required": ["id", "blockedBy"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let id = match required_str(&args, "id") {
            Ok(v) => v,
            Err(error) => return error.into(),
        };
        let blocked_by = match name_array(&args, "blockedBy", "issue id", true) {
            Ok(v) => v,
            Err(error) => return error.into(),
        };
        self.set_issue_blocked_by(id, blocked_by)
    }
}

impl SetIssueBlockedByTool {
    /// Replace an issue's blockers — the **standard, typed** `set_issue_blocked_by` API function both
    /// the JSON [adapter](Tool::invoke) and the [responses-as-code membrane](crate::sandbox) reach.
    pub(crate) fn set_issue_blocked_by(&self, id: String, blocked_by: Vec<String>) -> ToolOutcome {
        let mut store = self.store.lock().expect("board store lock");
        match store.set_issue_blocked_by(&id, &blocked_by) {
            Ok(BoardChange::BlockersSet) => {
                let summary = if blocked_by.is_empty() {
                    format!("cleared blockers of `{id}`")
                } else {
                    format!("set blockers of `{id}`")
                };
                ToolOutcome::ok(format!("Updated the blockers of issue `{id}`."), summary)
            }
            Ok(_) => unreachable!("set_issue_blocked_by yields BlockersSet"),
            Err(err) => ToolOutcome::failed(failure_for(&err), err.to_string()),
        }
    }
}

// ---------------------------------------------------------------------------
// remove_epic
// ---------------------------------------------------------------------------

/// Removes an epic, ungrouping any issues under it.
pub struct RemoveEpicTool {
    store: Arc<Mutex<BoardStore>>,
}

impl RemoveEpicTool {
    /// A tool removing epics from `store`.
    pub fn new(store: Arc<Mutex<BoardStore>>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Tool for RemoveEpicTool {
    fn name(&self) -> &str {
        REMOVE_EPIC_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            REMOVE_EPIC_TOOL,
            "Remove an epic by `id`. Any issue grouped under it is ungrouped (its issues are \
             kept). Fails if no epic of that id exists.",
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "The id of the epic to remove." }
                },
                "required": ["id"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let id = match required_str(&args, "id") {
            Ok(v) => v,
            Err(error) => return error.into(),
        };
        self.remove_epic(id)
    }
}

impl RemoveEpicTool {
    /// Remove an epic — the **standard, typed** `remove_epic` API function both the JSON
    /// [adapter](Tool::invoke) and the [responses-as-code membrane](crate::sandbox) reach.
    pub(crate) fn remove_epic(&self, id: String) -> ToolOutcome {
        let mut store = self.store.lock().expect("board store lock");
        match store.remove_epic(&id) {
            Ok(BoardChange::EpicRemoved) => ToolOutcome::ok(
                format!("Removed epic `{id}`. {}", usage_note(&store)),
                format!("removed epic `{id}`"),
            )
            .with_data(usage_data(&store)),
            Ok(_) => unreachable!("remove_epic yields EpicRemoved"),
            Err(err) => ToolOutcome::failed(failure_for(&err), err.to_string()),
        }
    }
}

// ---------------------------------------------------------------------------
// remove_issue
// ---------------------------------------------------------------------------

/// Removes an issue, dropping any edges pointing at it.
pub struct RemoveIssueTool {
    store: Arc<Mutex<BoardStore>>,
}

impl RemoveIssueTool {
    /// A tool removing issues from `store`.
    pub fn new(store: Arc<Mutex<BoardStore>>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl Tool for RemoveIssueTool {
    fn name(&self) -> &str {
        REMOVE_ISSUE_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            REMOVE_ISSUE_TOOL,
            "Remove an issue by `id`. It is also dropped from any other issue's blockers, so no \
             dangling dependency is left. Fails if no issue of that id exists.",
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "The id of the issue to remove." }
                },
                "required": ["id"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let id = match required_str(&args, "id") {
            Ok(v) => v,
            Err(error) => return error.into(),
        };
        self.remove_issue(id)
    }
}

impl RemoveIssueTool {
    /// Remove an issue — the **standard, typed** `remove_issue` API function both the JSON
    /// [adapter](Tool::invoke) and the [responses-as-code membrane](crate::sandbox) reach.
    pub(crate) fn remove_issue(&self, id: String) -> ToolOutcome {
        let mut store = self.store.lock().expect("board store lock");
        match store.remove_issue(&id) {
            Ok(BoardChange::IssueRemoved) => ToolOutcome::ok(
                format!("Removed issue `{id}`. {}", usage_note(&store)),
                format!("removed issue `{id}`"),
            )
            .with_data(usage_data(&store)),
            Ok(_) => unreachable!("remove_issue yields IssueRemoved"),
            Err(err) => ToolOutcome::failed(failure_for(&err), err.to_string()),
        }
    }
}

// ---------------------------------------------------------------------------
// wait_for_issue
// ---------------------------------------------------------------------------

/// The `wait_for_issue` tool name.
pub const WAIT_FOR_ISSUE_TOOL: &str = "wait_for_issue";

/// Declares `wait_for_issue` — suspend the agent until a board issue reaches a terminal state.
///
/// Like the [delegation tools](crate::tools::subagents), this is **not** self-contained: waiting
/// frees the agent's scheduler slot and blocks on the orchestrator's issue-wait registry, which a
/// [`Tool`] cannot reach. So the [turn loop](crate::agent) **intercepts** the call and performs the
/// wait; this declaration exists only so the tool is offered, listed, and granted uniformly. Its
/// [`invoke`](Tool::invoke) is a defensive fallback that never runs in a correctly wired session.
pub struct WaitForIssueTool;

#[async_trait]
impl Tool for WaitForIssueTool {
    fn name(&self) -> &str {
        WAIT_FOR_ISSUE_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            WAIT_FOR_ISSUE_TOOL,
            "Wait until a board issue is finished before continuing. Provide the `issueId`. Your \
             turn is suspended (freeing capacity for other agents) until that issue reaches a \
             terminal state — done, or failed if its assigned agent could not complete it — then \
             resumes and tells you which. Use this to sequence your own work behind an issue you \
             depend on. You cannot wait on the issue you were assigned to implement (do the work \
             and finish — your issue is completed when you are).",
            json!({
                "type": "object",
                "properties": {
                    "issueId": {
                        "type": "string",
                        "description": "The id of the board issue to wait for."
                    }
                },
                "required": ["issueId"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, _args: Value, _ctx: &ToolContext) -> ToolOutcome {
        ToolOutcome::error(format!(
            "`{WAIT_FOR_ISSUE_TOOL}` is handled by the loop; it \
             cannot be dispatched here."
        ))
    }
}

#[cfg(test)]
#[path = "board.test.rs"]
mod tests;
