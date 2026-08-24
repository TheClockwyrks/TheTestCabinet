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
use test_cabinet_core::gg::GgRosterEntry;

use super::{
    ApiData, ArgumentError, BoardNodeData, BoardUsageData, Tool, ToolContext, ToolFailure,
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
fn usage_data(store: &BoardStore) -> ApiData {
    let caps = store.caps();
    ApiData::BoardUsage(BoardUsageData {
        epics: saturating_u32(store.epic_count()),
        max_epics: saturating_u32(caps.max_epics),
        issues: saturating_u32(store.issue_count()),
        max_issues: saturating_u32(caps.max_issues),
    })
}

/// The [board usage](usage_data) plus the id the store just assigned — the sidecar the two creations
/// carry, since their caller cannot name what it filed otherwise.
fn board_node_data(id: &str, store: &BoardStore) -> ApiData {
    let ApiData::BoardUsage(board) = usage_data(store) else {
        unreachable!("usage_data yields BoardUsage")
    };
    ApiData::BoardNode(BoardNodeData {
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

/// A list-of-ids argument, `noun` naming what one entry is (`"issue id"`, `"agent id"`) so a
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

/// One profile as a confirmation names it: its id, and — when the roster carries a display name that
/// says more than the id already does — that name in parentheses after it.
///
/// The id leads because it is what the model's next call has to pass; the name never stands alone,
/// for the same reason.
fn named(agents: &[GgRosterEntry], agent_id: &str) -> String {
    let id = agent_id.trim();
    match agents
        .iter()
        .find(|entry| entry.agent_id == id)
        .map(|entry| entry.name.trim())
        .filter(|name| !name.is_empty() && *name != id)
    {
        Some(name) => format!("`{id}` ({name})"),
        None => format!("`{id}`"),
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
            "Create an epic grouping related issues.",
            json!({
                "type": "object",
                "properties": {
                    "prefix": {
                        "type": "string",
                        "description": "3-6 letters, upper-cased to form the epic's id."
                    },
                    "title": { "type": "string", "description": "A short title." },
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

    /// Refuse an id this agent may not assign the issue to, listing the ids it may.
    ///
    /// The refusal lists ids rather than display names because an id is exactly what the model has
    /// to pass on the retry — a name would be one more thing for it to resolve, and two profiles may
    /// share one.
    fn check_implementer(&self, agent_id: &str) -> Option<ToolOutcome> {
        if self.policy.allows_implementer(agent_id) {
            return None;
        }
        Some(ToolOutcome::failed(
            ToolFailure::InvalidArgument,
            format!(
                "`agent`: unknown agent `{agent_id}`; expected one of: {}",
                self.policy.implementer_list()
            ),
        ))
    }

    /// Refuse an id this agent may not name as a reviewer, listing the ids it may.
    fn check_reviewer(&self, agent_id: &str) -> Option<ToolOutcome> {
        if self.policy.allows_reviewer(agent_id) {
            return None;
        }
        Some(ToolOutcome::failed(
            ToolFailure::InvalidArgument,
            format!(
                "`reviewers`: unknown agent `{agent_id}`; expected one of: {}",
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
            "Create an issue: one self-contained unit of work, dispatched to `agent`.",
            json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string", "description": "A short title." },
                    "description": {
                        "type": "string",
                        "description": "A longer overview."
                    },
                    "inScope": {
                        "type": "string",
                        "description": "What this issue is responsible for."
                    },
                    "outOfScope": {
                        "type": "string",
                        "description": "What it is not responsible for."
                    },
                    "completionCriteria": {
                        "type": "string",
                        "description": "How the work is judged done."
                    },
                    "blockedBy": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Ids of issues that must finish first."
                    },
                    "epicId": {
                        "type": "string",
                        "description": "The epic to group this issue under."
                    },
                    "agent": {
                        "type": "string",
                        "enum": GgRosterEntry::ids(&self.policy.implementers),
                        "description": "The id of the agent to dispatch this issue to."
                    },
                    "reviewers": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": GgRosterEntry::ids(&self.policy.reviewers)
                        },
                        "description": "The ids of the agents that must each approve the work \
                                        before the issue is accepted."
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
        let reviewers = match name_array(&args, "reviewers", "agent id", false) {
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
    /// The assignment rules are enforced here, before the store is touched: `agent` must be the id
    /// of one of this agent's [implementers](IssuePolicy::implementers), every reviewer the id of
    /// one of its [reviewers](IssuePolicy::reviewers), and a
    /// [reviewers-required](IssuePolicy::require_reviewers) agent must name at least one. What the
    /// model passed is what the board stores, so the issue carries the ids dispatch resolves
    /// profiles from.
    ///
    /// The id the store assigned is both stated in the confirmation and carried structurally on the
    /// [`BoardNode`](ApiData::BoardNode) sidecar, so a program that files an issue can go on to
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
                    "Created issue `{id}`, assigned to {}. {}",
                    named(&self.policy.implementers, &agent),
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
            "Revise an issue. Supply at least one field to change.",
            json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "The id of the issue to revise." },
                    "title": { "type": "string", "description": "A new title." },
                    "description": {
                        "type": "string",
                        "description": "A new overview; empty clears it."
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
                        "description": "The epic to re-group under; empty ungroups."
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
            "Replace the set of issues an issue is blocked by.",
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
                        "description": "The full set of issue ids this issue is blocked by; `[]` clears them."
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
            "Remove an epic. The issues grouped under it are kept, ungrouped.",
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
            "Remove an issue, dropping it from every other issue's blockers.",
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
            "Suspend your turn until a board issue finishes, then resume.",
            json!({
                "type": "object",
                "properties": {
                    "issueId": {
                        "type": "string",
                        "description": "The id of the issue to wait for."
                    }
                },
                "required": ["issueId"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, _args: Value, _ctx: &ToolContext) -> ToolOutcome {
        ToolOutcome::error(format!(
            "`{WAIT_FOR_ISSUE_TOOL}` cannot be dispatched here; this is a gg defect."
        ))
    }
}

#[cfg(test)]
#[path = "board.test.rs"]
mod tests;
