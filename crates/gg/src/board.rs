//! The gg **project management** capability: the run's single, **global** work-decomposition
//! board — a [blocked-by DAG](crate::dag) of structured, dispatchable issues grouped into
//! epics, **shared by every agent in the run** and **retained across compaction** like the
//! [task list](crate::tasks).
//!
//! Where a [task](crate::tasks) is an agent-scoped to-do, an
//! [issue](https://docs.testcabinet.ai/gg/project-management/) is a run-global work item
//! substantial enough to organize a large build and **safe to dispatch to an agent**. An
//! [`Issue`] carries structured sections — a title, an optional description, and the three that
//! make it dispatchable: **in-scope**, **out-of-scope**, and **completion criteria** — that
//! tell the agent gg assigns it exactly what it is and is not responsible for and how it will be
//! judged done. It also names the [agent profile](Issue::agent) gg dispatches it under and the
//! [profiles](Issue::reviewers) that must approve it. Related issues are grouped under an
//! [`Epic`] for organization.
//!
//! Any agent may build and revise the board — `create_epic`/`create_issue` to add,
//! `update_issue` to revise an issue's fields or status, `set_issue_blocked_by` to declare the
//! DAG edges, and `remove_epic`/`remove_issue` to drop one. There is deliberately **no**
//! "complete issue" move (see [below](#completion-is-the-agents-own-and-acceptance-is-ggs)).
//! The whole board is pushed into each agent's context window as a single
//! [`Board`](test_cabinet_core::gg::GgContextSource::Board)-sourced,
//! [`Pinned`](crate::context::Retention::Pinned) item, so the
//! [context accounting](crate::context) attributes it to the board and
//! [compaction](crate::compaction) carries the decomposition across the boundary verbatim.
//!
//! # Identifiers are gg's, and they nest
//!
//! An [`Epic`] is created from a **prefix** — 3–6 letters, upper-cased — and that is its id. Every
//! [`Issue`] filed under it is **numbered by the store** from that prefix (`AUTH-1`, `AUTH-2`, …;
//! `ISSUE-1` for an issue filed with no epic), and the agents gg dispatches for an issue are named
//! from *its* id in turn: the *n*th [implementer](BoardStore::assign_issue) of `AUTH-1` is
//! `AUTH-1.0i`, `AUTH-1.1i`, … and the [reviewers](BoardStore::next_review_agent_id) of one
//! implementer's work are `AUTH-1.0i.0r`, `AUTH-1.0i.1r`, ….
//!
//! So one name locates a piece of work, which attempt at it, and which review of that attempt —
//! which is what makes a fleet of concurrent agents legible in a log, a telemetry stream, and the
//! console's tree. Letting the model choose these ids instead would give up all of that: it cannot
//! know what the other agents sharing the board have already used, and an id it invented says
//! nothing about where the work sits.
//!
//! # The shared DAG
//!
//! Issues use the **same acyclic blocked-by relation as tasks**: gg rejects any edge that would
//! introduce a cycle. Rather than mirror the reachability search, the board reuses the shared
//! [`dag`] machinery ([`Issue`] implements [`DagNode`]); the store owns only its
//! existence/self-block checks and its [`BoardError`] messages. A refused edge leaves the board
//! unchanged.
//!
//! # Auto-dispatch
//!
//! Submitting an issue **enqueues** it. gg — not the agent — dispatches the work: the
//! [orchestrator](crate::agent) watches the board, and once every issue an [`Issue`] is blocked
//! by is [`Done`](IssueStatus::Done), it [assigns](BoardStore::assign_issue) a freshly spawned
//! **top-level agent** to implement it (its structured fields become that agent's brief, and its
//! [`agent`](Issue::agent) the profile that agent runs under), moving
//! the issue to [`InProgress`](IssueStatus::InProgress). Because issues run concurrently, each is
//! dispatched into its **own git worktree** — the orchestrator's half of the arrangement — so two
//! issues cannot trample one another's files.
//!
//! An assigned agent that ends **without finishing successfully** — it exhausted its turns, spent
//! the run's wall-clock, breached an [execution ceiling](crate::limits), or failed on a model error
//! — is re-dispatched up to [`max_retries`](BoardCaps::max_retries) times
//! (default 1); once those are exhausted the issue is marked [`Failed`](IssueStatus::Failed) — a
//! terminal-but-not-done state that leaves its dependents blocked. The store owns the
//! bookkeeping (each issue's [assignment](Issue::assigned_agent) and
//! [retry count](Issue::retries)); the orchestrator owns the spawning.
//!
//! # Completion is the agent's own, and acceptance is gg's
//!
//! An issue is finished exactly when **the agent implementing it finished** — under whatever
//! [completion rule](crate::completion) that agent's profile configures, which is the one place a
//! run says how an agent signals it is done. There is deliberately no separate "complete issue"
//! tool: an agent that ended successfully has, by definition, said its work is complete, and asking
//! it to say so a second way only adds a step it can forget and lose its work to.
//!
//! Finishing does not mark the issue done. gg moves it to [`InReview`](IssueStatus::InReview)
//! ([`submit_issue_for_review`](BoardStore::submit_issue_for_review)) and runs the issue's
//! [reviewers](Issue::reviewers) in turn — each of which either approves or returns actionable
//! items, which send the issue back to [`InProgress`](IssueStatus::InProgress) under its own
//! assigned agent — and, once every reviewer approves, merges its worktree back and
//! [accepts](BoardStore::accept_issue) it. Only then is it [`Done`](IssueStatus::Done), which is
//! what keeps a dependent from being dispatched against work that never landed.
//!
//! # Shapes
//!
//! - [`Epic`] / [`Issue`] — the board's nodes.
//! - [`NewIssue`] — the fields [`create_issue`](BoardStore::create_issue) takes.
//! - [`IssuePolicy`] — the **per-agent** rules on filing one: which profiles that agent may
//!   assign an issue to, which it may name as reviewers, and whether reviewers are required at
//!   all.
//! - [`BoardStore`] — the mutable, invariant-enforcing, cycle-rejecting owner of the board,
//!   shared (`Arc<Mutex>`) across the whole run — one board, held by the orchestrator and handed
//!   to every agent's [board tools](crate::tools).
//! - [`BoardRuntime`] — the run's live view: whether the capability is on, the shared store,
//!   and the derivations the loop needs (the caps the system prompt states, the
//!   [`BoardState`](test_cabinet_core::gg::GgTelemetryKind::BoardState) telemetry, and the
//!   pinned context block).
//!
//! The capability is **ablatable**: when it is off the run builds a
//! [`disabled`](BoardRuntime::disabled) runtime, so there are no board tools, no prompt
//! text, no context block, no telemetry, and no auto-dispatch — the feature vanishes.

use std::collections::BTreeMap;
use std::fmt;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use test_cabinet_core::gg::{
    CAPABILITY_PROJECT_MANAGEMENT, GgAgentConfig, GgBoardEpic, GgBoardIssue, GgContextSource,
    GgIssueStatus, GgModuleOrigin, GgSubagentScope, GgTelemetryKind,
};

use crate::dag::{self, DagNode};
use crate::model::Message;
use crate::modules::{
    AdoptError, Module, ModuleHandle, ModuleIds, ModuleKind, ModuleResolveCtx, Ownership, Refresh,
    detached_ids,
};
use crate::prompts::{self, BoardBlockContext, EpicItemView, IssueBriefContext, IssueItemView};

/// Default ceiling on the number of epics the board may hold at once.
pub const DEFAULT_MAX_EPICS: usize = 50;

/// Default ceiling on the number of issues the board may hold at once. Generous — the board is
/// the run's decomposition of a large build, and a long run legitimately files thousands of
/// issues against it — but bounded so a runaway loop cannot fill the window with issues.
pub const DEFAULT_MAX_ISSUES: usize = 2000;

/// The fewest letters an [epic](Epic)'s prefix may have. Three is enough to be a mnemonic
/// (`API`, `WEB`) and short enough that nothing shorter would be.
pub const MIN_PREFIX_LEN: usize = 3;

/// The most letters an [epic](Epic)'s prefix may have. Six keeps an issue id short enough to read
/// inline and to carry its [agent ids](BoardStore::assign_issue) as a suffix.
pub const MAX_PREFIX_LEN: usize = 6;

/// The prefix issues filed **without** an epic are numbered under (`ISSUE-1`, `ISSUE-2`, …). Issue
/// numbering is per prefix, so an epic that happens to be called `ISSUE` shares the sequence rather
/// than colliding with it.
pub const UNGROUPED_PREFIX: &str = "ISSUE";

/// Default number of times gg re-dispatches an issue whose assigned agent finished without
/// completing it before giving up and marking it [`Failed`](IssueStatus::Failed). One retry (so
/// two attempts in all) is a middle ground: it absorbs a single flaky attempt without letting a
/// genuinely-stuck issue respawn agents without end.
pub const DEFAULT_MAX_RETRIES: usize = 1;

/// The project-management capability param naming the [epic ceiling](BoardCaps::max_epics).
const PARAM_MAX_EPICS: &str = "maxEpics";

/// The project-management capability param naming the [issue ceiling](BoardCaps::max_issues).
const PARAM_MAX_ISSUES: &str = "maxIssues";

/// The project-management capability param naming the [retry ceiling](BoardCaps::max_retries).
const PARAM_MAX_RETRIES: &str = "maxRetries";

/// The project-management capability param switching the **reviewers** feature on: when true,
/// this agent cannot file an issue without naming at least one
/// [reviewer](IssuePolicy::require_reviewers). Off by default.
const PARAM_REVIEWERS: &str = "reviewers";

/// The ceilings the [`BoardStore`] enforces, resolved from the capability's params.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BoardCaps {
    /// The maximum number of epics the board may hold at once.
    pub max_epics: usize,
    /// The maximum number of issues the board may hold at once.
    pub max_issues: usize,
    /// How many times an issue is re-dispatched after an assigned agent fails to complete it
    /// before it is marked [`Failed`](IssueStatus::Failed). Zero means no retry — one attempt
    /// only.
    pub max_retries: usize,
}

impl Default for BoardCaps {
    fn default() -> Self {
        Self {
            max_epics: DEFAULT_MAX_EPICS,
            max_issues: DEFAULT_MAX_ISSUES,
            max_retries: DEFAULT_MAX_RETRIES,
        }
    }
}

impl BoardCaps {
    /// Resolve the caps from a project-management-capability `params` object: `maxEpics` /
    /// `maxIssues` / `maxRetries` override the defaults when present as integers; a missing or
    /// non-integer value keeps the default. `maxEpics`/`maxIssues` additionally require a
    /// positive value (a board must be able to hold at least one), while `maxRetries` accepts
    /// zero (no retry).
    pub fn resolve(params: &Value) -> Self {
        let default = Self::default();
        Self {
            max_epics: positive_usize(params, PARAM_MAX_EPICS).unwrap_or(default.max_epics),
            max_issues: positive_usize(params, PARAM_MAX_ISSUES).unwrap_or(default.max_issues),
            max_retries: nonnegative_usize(params, PARAM_MAX_RETRIES)
                .unwrap_or(default.max_retries),
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

/// A non-negative-integer param value (zero allowed), or `None` when absent or non-integer.
fn nonnegative_usize(params: &Value, key: &str) -> Option<usize> {
    params.get(key).and_then(Value::as_u64).map(|n| n as usize)
}

/// The **per-agent** rules on filing an issue, resolved from one agent's own configuration.
///
/// The board itself is run-global, but who may be *put to work by* it is not: an agent may only
/// name a profile its own [roster](GgAgentConfig::subagents) lists **for that job** — an
/// [implementer](GgSubagentScope::Implementer) for the issue's `agent`, a
/// [reviewer](GgSubagentScope::Reviewer) for each of its `reviewers` — so no agent can conjure
/// workers it was never given, and a profile trusted to write code is not automatically trusted to
/// review it. Whether reviewers are *demanded* at all is the capability's
/// [`reviewers`](PARAM_REVIEWERS) feature, likewise per agent.
///
/// The policy lives with the [tools](crate::tools::board), not the [store](BoardStore): the store
/// is shared by every agent in the run, so a rule that differs per agent cannot be enforced there.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct IssuePolicy {
    /// The profiles this agent may assign an issue to — its roster entries carrying the
    /// [implementer](GgSubagentScope::Implementer) scope, in declaration order. Empty means it may
    /// file no issue at all, which is why a configuration that lets an agent create issues without
    /// giving it any implementers is [refused at launch](crate::agent).
    pub implementers: Vec<String>,
    /// The profiles this agent may name as an issue's reviewers — its roster entries carrying the
    /// [reviewer](GgSubagentScope::Reviewer) scope, in declaration order.
    pub reviewers: Vec<String>,
    /// Whether `create_issue` demands at least one reviewer.
    pub require_reviewers: bool,
}

impl IssuePolicy {
    /// The policy for `agent`: the [implementer](GgSubagentScope::Implementer) and
    /// [reviewer](GgSubagentScope::Reviewer) halves of its [roster](GgAgentConfig::subagents), and
    /// whether its project-management configuration switches the [reviewers](PARAM_REVIEWERS)
    /// feature on.
    pub fn resolve(agent: &GgAgentConfig) -> Self {
        Self {
            implementers: names(agent, GgSubagentScope::Implementer),
            reviewers: names(agent, GgSubagentScope::Reviewer),
            require_reviewers: agent
                .capability(CAPABILITY_PROJECT_MANAGEMENT)
                .and_then(|cap| cap.params.get(PARAM_REVIEWERS))
                .and_then(Value::as_bool)
                .unwrap_or(false),
        }
    }

    /// Whether `name` is a profile this agent may assign an issue to.
    pub fn allows_implementer(&self, name: &str) -> bool {
        self.implementers.iter().any(|a| a == name)
    }

    /// Whether `name` is a profile this agent may name as an issue's reviewer.
    pub fn allows_reviewer(&self, name: &str) -> bool {
        self.reviewers.iter().any(|a| a == name)
    }

    /// The assignable implementer profiles as a comma-separated, backticked list for a
    /// model-facing message, or `"(none)"` when the agent may assign to nobody.
    pub fn implementer_list(&self) -> String {
        backticked(&self.implementers)
    }

    /// The assignable reviewer profiles as a comma-separated, backticked list for a model-facing
    /// message, or `"(none)"` when the agent may name no reviewer.
    pub fn reviewer_list(&self) -> String {
        backticked(&self.reviewers)
    }
}

/// Whether `agent`'s project-management configuration switches the [reviewers](PARAM_REVIEWERS)
/// feature on — i.e. whether it must name at least one reviewer on every issue it files. Exposed
/// for [launch validation](crate::agent), which refuses an agent that is required to name reviewers
/// but has none in its roster.
pub fn requires_reviewers(agent: &GgAgentConfig) -> bool {
    IssuePolicy::resolve(agent).require_reviewers
}

/// The names, in declaration order, of the profiles `agent`'s roster lists in `scope`.
fn names(agent: &GgAgentConfig, scope: GgSubagentScope) -> Vec<String> {
    agent
        .agents_in_scope(scope)
        .into_iter()
        .map(str::to_string)
        .collect()
}

/// `names` as a comma-separated, backticked list, or `"(none)"` when empty.
fn backticked(names: &[String]) -> String {
    if names.is_empty() {
        return "(none)".to_string();
    }
    names
        .iter()
        .map(|a| format!("`{a}`"))
        .collect::<Vec<_>>()
        .join(", ")
}

/// The lifecycle status of an [`Issue`].
///
/// An issue is *actionable* only when it is not [terminal](Self::is_terminal) and every issue it
/// is blocked by is [`Done`](Self::Done). Its assigned agent moves it to
/// [`InReview`](Self::InReview) by completing it, and gg then either accepts it
/// ([`Done`](Self::Done), after every reviewer approves and its worktree merges) or sends it back to
/// [`InProgress`](Self::InProgress) with the reviewer's items. It reaches a terminal state either by
/// being accepted ([`Done`](Self::Done)) or by exhausting its retries ([`Failed`](Self::Failed)); a
/// [`Failed`](Self::Failed) blocker is terminal but not done, so it leaves its dependents
/// permanently blocked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssueStatus {
    /// Enqueued, not yet dispatched.
    Open,
    /// An agent has been assigned and is working it.
    InProgress,
    /// Its assigned agent called the work complete and gg is reconciling it — running the issue's
    /// reviewers and merging its worktree. Not terminal: a review that requests changes sends the
    /// issue back to [`InProgress`](Self::InProgress).
    InReview,
    /// Accepted complete, and its worktree merged back.
    Done,
    /// The assigned agent could not complete it within its retries. Terminal, but not
    /// [`Done`](Self::Done).
    Failed,
}

impl IssueStatus {
    /// Parse a model-supplied status token (`"open"`, `"in_progress"`, `"in_review"`, `"done"`,
    /// `"failed"`), tolerating a couple of natural spellings. Returns `None` for anything else so
    /// the tool can reject it with guidance.
    pub fn parse(raw: &str) -> Option<Self> {
        match raw
            .trim()
            .to_ascii_lowercase()
            .replace([' ', '-'], "_")
            .as_str()
        {
            "open" | "todo" | "pending" => Some(IssueStatus::Open),
            "in_progress" | "inprogress" | "doing" => Some(IssueStatus::InProgress),
            "in_review" | "inreview" | "reviewing" => Some(IssueStatus::InReview),
            "done" | "complete" | "completed" => Some(IssueStatus::Done),
            "failed" | "failure" | "abandoned" => Some(IssueStatus::Failed),
            _ => None,
        }
    }

    /// Whether the status is **terminal** — the issue will not be worked further. Both
    /// [`Done`](Self::Done) and [`Failed`](Self::Failed) are terminal; only [`Done`](Self::Done)
    /// unblocks dependents.
    pub fn is_terminal(self) -> bool {
        matches!(self, IssueStatus::Done | IssueStatus::Failed)
    }

    /// The contract form of the status for the
    /// [`BoardState`](GgTelemetryKind::BoardState) telemetry.
    fn to_contract(self) -> GgIssueStatus {
        match self {
            IssueStatus::Open => GgIssueStatus::Open,
            IssueStatus::InProgress => GgIssueStatus::InProgress,
            IssueStatus::InReview => GgIssueStatus::InReview,
            IssueStatus::Done => GgIssueStatus::Done,
            IssueStatus::Failed => GgIssueStatus::Failed,
        }
    }

    /// A human-readable word for the status, for the rendered context block.
    fn word(self) -> &'static str {
        match self {
            IssueStatus::Open => "open",
            IssueStatus::InProgress => "in progress",
            IssueStatus::InReview => "in review",
            IssueStatus::Done => "done",
            IssueStatus::Failed => "failed",
        }
    }

    /// The checkbox-style marker for the status, for the rendered context block.
    fn marker(self) -> &'static str {
        match self {
            IssueStatus::Open => "[ ]",
            IssueStatus::InProgress => "[~]",
            IssueStatus::InReview => "[?]",
            IssueStatus::Done => "[x]",
            IssueStatus::Failed => "[!]",
        }
    }
}

/// One epic on the board: an organizational grouping of related [`Issue`]s.
///
/// An epic is created from a **prefix** — 3–6 letters, upper-cased — and that prefix *is* its
/// [id](Self::id): every issue filed under the epic is numbered from it (`AUTH-1`, `AUTH-2`, …), so
/// an issue id says which epic its work belongs to without a lookup.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Epic {
    /// The epic's stable id — its upper-cased prefix, the handle an issue's `epic_id` references
    /// and the stem its issue ids are numbered from.
    id: String,
    /// The epic's short title.
    title: String,
    /// A longer description of what the epic covers.
    description: String,
}

// Field accessors are the epic's read surface for the tests and console-facing derivations.
#[allow(dead_code)]
impl Epic {
    /// The epic's id — equivalently, its prefix.
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
/// hand to an agent — they are the assigned agent's brief.
///
/// Its [id](Self::id) is **gg's**, not the model's: the store numbers it under its
/// [epic](Self::epic_id)'s prefix ([`AUTH-1`](BoardStore::create_issue)), and the ids of the agents
/// that work it are derived from *that* ([`AUTH-1.0i`](BoardStore::assign_issue), whose reviewers
/// are [`AUTH-1.0i.0r`](BoardStore::next_review_agent_id) …). One name therefore places a piece of
/// work, the attempt at it, and the review of that attempt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Issue {
    /// The issue's stable id — the handle the tools and every blocked-by edge reference. Assigned
    /// by the store as `PREFIX-N`; never supplied by the model.
    id: String,
    /// The issue's short title.
    title: String,
    /// An optional longer overview (the scope fields carry the dispatch-relevant detail).
    description: Option<String>,
    /// What the issue **is** responsible for.
    in_scope: String,
    /// What the issue is **not** responsible for — the explicit exclusions bounding the
    /// dispatched agent's work.
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
    /// The [agent profile](GgAgentConfig) this issue is **assigned to** — named by whoever filed
    /// it, from that agent's [implementers](IssuePolicy::implementers), and the profile the
    /// [dispatcher](crate::agent) runs it (and each retry and review round) under.
    agent: String,
    /// The [agent profiles](GgAgentConfig) that must each approve this issue before it is
    /// accepted, named at creation from the filing agent's
    /// [reviewers](IssuePolicy::reviewers). Empty when it was filed without any.
    reviewers: Vec<String>,
    /// The id of the agent gg [dispatched](crate::agent) to implement this issue, set when the
    /// issue is [assigned](BoardStore::assign_issue) (moving it to
    /// [`InProgress`](IssueStatus::InProgress)) and left in place after a terminal state as the
    /// last agent that worked it. `None` while the issue is [`Open`](IssueStatus::Open).
    assigned_agent: Option<String>,
    /// How many times this issue has been **re-dispatched** after an assigned agent finished
    /// without completing it. `0` until the first retry; bounded by
    /// [`max_retries`](BoardCaps::max_retries).
    retries: u32,
    /// How many **implementer** agents the store has minted for this issue — the counter its
    /// [agent ids](BoardStore::assign_issue) are numbered from, so the *n*th attempt (a first
    /// dispatch, a retry, or a post-review rework pass) is `{id}.{n}i`. Counts attempts, not
    /// retries: rework a reviewer asked for mints an agent without charging the
    /// [retry budget](Self::retries).
    agent_seq: u32,
    /// How many **reviewer** agents the store has minted under the *current*
    /// [implementer](Self::assigned_agent) — the counter
    /// [`next_review_agent_id`](BoardStore::next_review_agent_id) numbers from. Reset whenever a new
    /// implementer is minted, since a reviewer's id is suffixed onto that implementer's.
    review_seq: u32,
}

// Field accessors are the issue's read surface for the tests, the console-facing derivations,
// and the dispatcher (which reads the brief off these fields).
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

    /// The [agent profile](GgAgentConfig) this issue is assigned to — what the dispatcher runs it
    /// under.
    pub fn agent(&self) -> &str {
        &self.agent
    }

    /// The [agent profiles](GgAgentConfig) that must each approve this issue, or empty
    /// when it was filed without reviewers.
    pub fn reviewers(&self) -> &[String] {
        &self.reviewers
    }

    /// The agent gg dispatched to implement this issue, if one is (or was) assigned.
    pub fn assigned_agent(&self) -> Option<&str> {
        self.assigned_agent.as_deref()
    }

    /// How many times this issue has been re-dispatched after a failed attempt.
    pub fn retries(&self) -> u32 {
        self.retries
    }

    /// Mint the id of this issue's **next implementer** — `{id}.{n}i`, `n` counting the attempts
    /// made at it — record it as the issue's [assignment](Self::assigned_agent), and restart the
    /// reviewer numbering (a reviewer is named under the implementer whose work it reviews, so a new
    /// implementer starts a new reviewer sequence).
    fn mint_implementer(&mut self) -> String {
        let agent_id = format!("{}.{}i", self.id, self.agent_seq);
        self.agent_seq += 1;
        self.review_seq = 0;
        self.assigned_agent = Some(agent_id.clone());
        agent_id
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
    /// `create_epic` was given something that is not a 3–6 letter prefix.
    InvalidPrefix(String),
    /// `create_epic` named an epic whose prefix is already taken.
    DuplicateEpic(String),
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
            BoardError::InvalidPrefix(raw) => write!(
                f,
                "`prefix` must be {MIN_PREFIX_LEN} to {MAX_PREFIX_LEN} letters (a-z) and nothing \
                 else; `{raw}` is not. It names this epic's issues (a prefix of `AUTH` numbers them \
                 `AUTH-1`, `AUTH-2`, …), so choose a short mnemonic for what the epic covers."
            ),
            BoardError::DuplicateEpic(id) => write!(
                f,
                "an epic with the prefix `{id}` already exists; choose a different prefix (it is \
                 what this epic's issues are numbered under)."
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
///
/// The two **creations** are absent: they hand back the id the store assigned
/// ([`create_epic`](BoardStore::create_epic), [`create_issue`](BoardStore::create_issue)) rather than
/// a bare "it worked", because the caller cannot name what it just made otherwise.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BoardChange {
    /// An issue was revised.
    IssueUpdated,
    /// An issue's blocked-by set was replaced.
    BlockersSet,
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

/// The fields [`create_issue`](BoardStore::create_issue) takes — a named record rather than a
/// positional list, because an issue is the one board node with ten of them.
///
/// [`agent`](Self::agent) and [`reviewers`](Self::reviewers) are the assignment half: who gg
/// dispatches the issue to, and who must approve it. The rest are the issue's own content. There is
/// no `id`: the store [assigns](BoardStore::create_issue) one from the issue's epic prefix.
#[derive(Debug, Clone, Copy, Default)]
pub struct NewIssue<'a> {
    /// The issue's short title.
    pub title: &'a str,
    /// An optional longer overview.
    pub description: Option<&'a str>,
    /// What the issue is responsible for.
    pub in_scope: &'a str,
    /// What the issue is explicitly not responsible for.
    pub out_of_scope: &'a str,
    /// How the issue will be judged done.
    pub completion_criteria: &'a str,
    /// The ids of the issues that must finish first.
    pub blocked_by: &'a [String],
    /// The epic to group the issue under, when any.
    pub epic_id: Option<&'a str>,
    /// The [agent profile](Issue::agent) to dispatch the issue under.
    pub agent: &'a str,
    /// The [agent profiles](Issue::reviewers) that must approve it, when the filing agent's
    /// [policy](IssuePolicy::require_reviewers) demands them.
    pub reviewers: &'a [String],
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
    /// The next issue number to hand out per prefix. Kept as a **counter** rather than derived from
    /// the issues on the board, so removing an issue never lets its id be handed out a second time —
    /// an id already quoted in a log, a brief, or an agent's name must not come back meaning
    /// something else.
    next_number: BTreeMap<String, u32>,
}

impl BoardStore {
    /// Re-point the board's limits — what a [transfer](crate::modules::transfer) does when a
    /// different agent profile [adopts](crate::modules::Module::adopt) the board. Contents already
    /// over a newly-tightened cap are kept and further filings refused, never deleted.
    #[allow(dead_code)] // used by `Module::adopt`, which a transfer reaches — see `crate::modules`.
    pub fn set_caps(&mut self, caps: BoardCaps) {
        self.caps = caps;
    }

    /// An empty board bounded by `caps`.
    pub fn new(caps: BoardCaps) -> Self {
        Self {
            caps,
            epics: Vec::new(),
            issues: Vec::new(),
            next_number: BTreeMap::new(),
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

    /// Create a new epic from `prefix` — 3–6 letters, **upper-cased**, which becomes the epic's
    /// [id](Epic::id) and the stem its issues are numbered from — returning that id.
    ///
    /// Refused if `prefix` is not 3–6 letters, `title`/`description` is empty, an epic already holds
    /// that prefix, or the board is at the epic cap.
    pub fn create_epic(
        &mut self,
        prefix: &str,
        title: &str,
        description: &str,
    ) -> Result<String, BoardError> {
        let id = normalize_prefix(prefix)?;
        let title = require_field(title, "title")?;
        let description = require_field(description, "description")?;
        if self.epic_position(&id).is_some() {
            return Err(BoardError::DuplicateEpic(id));
        }
        if self.epics.len() >= self.caps.max_epics {
            return Err(BoardError::CountCap {
                kind: "epic",
                cap: self.caps.max_epics,
            });
        }
        self.epics.push(Epic {
            id: id.clone(),
            title: title.to_string(),
            description: description.to_string(),
        });
        Ok(id)
    }

    /// Create a new issue with its structured sections, **assigning its id** and returning it.
    ///
    /// The id is the issue's [epic](NewIssue::epic_id)'s prefix and the next number under that
    /// prefix — `AUTH-1`, `AUTH-2`, … — or the same under [`ISSUE`](UNGROUPED_PREFIX) for an issue
    /// filed without an epic. The model does not choose it: an id it invented would say nothing
    /// about where the work sits, and two agents filing against one shared board would collide on it.
    ///
    /// Refused if a required field (`title`/`inScope`/`outOfScope`/`completionCriteria`/`agent`) is
    /// empty, the board is at the issue cap, an `epic_id` names a non-existent epic, or a
    /// `blocked_by` entry is empty or unknown. A newly created issue has no dependents and no id the
    /// caller could have referenced, so it cannot close a cycle or block itself: naming a
    /// non-existent blocker is its only DAG failure.
    ///
    /// The store checks that the [assignee](NewIssue::agent) and each
    /// [reviewer](NewIssue::reviewers) is *named*; checking that they are profiles the **filing
    /// agent** may assign to is the [tool](crate::tools::board)'s job, since the store is shared
    /// by every agent in the run and that rule is per agent.
    pub fn create_issue(&mut self, issue: NewIssue<'_>) -> Result<String, BoardError> {
        let title = require_field(issue.title, "title")?;
        let in_scope = require_field(issue.in_scope, "inScope")?;
        let out_of_scope = require_field(issue.out_of_scope, "outOfScope")?;
        let completion_criteria = require_field(issue.completion_criteria, "completionCriteria")?;
        let agent = require_field(issue.agent, "agent")?;
        let reviewers = normalize_names(issue.reviewers, "reviewers")?;
        if self.issues.len() >= self.caps.max_issues {
            return Err(BoardError::CountCap {
                kind: "issue",
                cap: self.caps.max_issues,
            });
        }
        let epic_id = self.resolve_epic_grouping(issue.epic_id)?;
        let blockers = self.normalize_blockers("", issue.blocked_by)?;
        // The number is handed out only once every other field has passed validation, so a refused
        // call never burns one and leaves a hole in the epic's sequence. A newly created issue has no
        // dependents, so there is no cycle to check for — only the blocker existence checked above.
        let id = self.allocate_issue_id(epic_id.as_deref());
        self.issues.push(Issue {
            id: id.clone(),
            title: title.to_string(),
            description: clean_optional(issue.description),
            in_scope: in_scope.to_string(),
            out_of_scope: out_of_scope.to_string(),
            completion_criteria: completion_criteria.to_string(),
            status: IssueStatus::Open,
            blocked_by: blockers,
            epic_id,
            agent: agent.to_string(),
            reviewers,
            assigned_agent: None,
            retries: 0,
            agent_seq: 0,
            review_seq: 0,
        });
        Ok(id)
    }

    /// Hand out the next id under `epic_id`'s prefix (or [`ISSUE`](UNGROUPED_PREFIX) when the issue
    /// is ungrouped), advancing that prefix's counter. Skips any number a live issue already holds —
    /// which a board built only through this method never has, and which keeps the invariant true
    /// even so.
    fn allocate_issue_id(&mut self, epic_id: Option<&str>) -> String {
        let prefix = epic_id.unwrap_or(UNGROUPED_PREFIX).to_string();
        loop {
            let next = self.next_number.entry(prefix.clone()).or_insert(1);
            let id = format!("{prefix}-{next}");
            *next += 1;
            if self.issue_position(&id).is_none() {
                return id;
            }
        }
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

    /// Move an issue to [`InReview`](IssueStatus::InReview) — its assigned agent finished
    /// **successfully**, so gg now reconciles it (reviewers, then the merge of its worktree).
    /// Returns whether it moved (`false` for an unknown id).
    ///
    /// Called by the [orchestrator](crate::agent) alone, off the agent's own completion: there is
    /// no tool for it, because an issue is finished exactly when the agent implementing it
    /// finished. [`accept_issue`](Self::accept_issue) is what actually accepts it once the review
    /// has approved and the branch has landed. Keeping the two apart is what stops a dependent
    /// issue being dispatched against work that has not merged yet.
    pub fn submit_issue_for_review(&mut self, id: &str) -> bool {
        let Some(index) = self.issue_position(id) else {
            return false;
        };
        self.issues[index].status = IssueStatus::InReview;
        true
    }

    /// **Accept** the issue `id`: mark it [`Done`](IssueStatus::Done), unblocking its dependents.
    /// Returns `false` (untouched) if no such issue exists or it is already terminal. Called by the
    /// [orchestrator](crate::agent) only after every reviewer approved and the issue's worktree
    /// merged back — never by a tool.
    pub fn accept_issue(&mut self, id: &str) -> bool {
        let Some(index) = self.issue_position(id) else {
            return false;
        };
        let issue = &mut self.issues[index];
        if issue.status.is_terminal() {
            return false;
        }
        issue.status = IssueStatus::Done;
        true
    }

    /// The caps' [retry ceiling](BoardCaps::max_retries).
    pub fn max_retries(&self) -> usize {
        self.caps.max_retries
    }

    /// The status of the issue with id `id`, if it exists — the read the
    /// [dispatcher](crate::agent) consults to decide an assigned agent's issue is done, or to
    /// answer a [wait](crate::agent).
    pub fn issue_status(&self, id: &str) -> Option<IssueStatus> {
        self.issue_status_of(id)
    }

    /// The ids of every issue that is **dispatchable right now**: [`Open`](IssueStatus::Open),
    /// not yet [assigned](Issue::assigned_agent), and with every blocker
    /// [`Done`](IssueStatus::Done). These are the issues the [dispatcher](crate::agent) spawns an
    /// agent for. The assignment itself is a separate, re-validating step
    /// ([`assign_issue`](Self::assign_issue)), so two concurrent pumps cannot both claim one.
    pub fn dispatchable_ids(&self) -> Vec<String> {
        self.issues
            .iter()
            .filter(|issue| {
                issue.status == IssueStatus::Open
                    && issue.assigned_agent.is_none()
                    && self.is_ready(issue)
            })
            .map(|issue| issue.id.clone())
            .collect()
    }

    /// **Claim** the [`Open`](IssueStatus::Open) issue `id`: mint the agent id of its next
    /// implementer, move the issue to [`InProgress`](IssueStatus::InProgress), record the
    /// assignment, and return that agent id. Returns `None` — the issue left untouched, no id
    /// minted — if no such issue exists or it is no longer open-and-unassigned (a concurrent pump
    /// already claimed it, or it reached a terminal state).
    ///
    /// Minting and claiming are one step precisely because the id is **derived from the issue**
    /// (`AUTH-1` → `AUTH-1.0i`, then `AUTH-1.1i`): a caller that minted first and lost the claim
    /// would have consumed an attempt number the winning agent then skipped. That the two cannot be
    /// separated is what keeps dispatch race-free *and* the numbering dense.
    pub fn assign_issue(&mut self, id: &str) -> Option<String> {
        let index = self.issue_position(id)?;
        let issue = &mut self.issues[index];
        if issue.status != IssueStatus::Open || issue.assigned_agent.is_some() {
            return None;
        }
        issue.status = IssueStatus::InProgress;
        Some(issue.mint_implementer())
    }

    /// **Re-dispatch** the issue `id` to a fresh agent — after a failed attempt, or after a review
    /// requested changes: mint the next implementer's agent id, move the issue back to
    /// [`InProgress`](IssueStatus::InProgress), record its new [retry count](Issue::retries) (a
    /// review round passes the count through unchanged, since rework is not a failed attempt), and
    /// return that agent id. Returns `None` (untouched) if no such issue exists or it has already
    /// reached a terminal state. Unlike [`assign_issue`](Self::assign_issue) this does not require
    /// the issue to be [`Open`](IssueStatus::Open) — a re-dispatch follows an agent that left it
    /// [`InProgress`](IssueStatus::InProgress) or [`InReview`](IssueStatus::InReview).
    pub fn redispatch_issue(&mut self, id: &str, retries: u32) -> Option<String> {
        let index = self.issue_position(id)?;
        let issue = &mut self.issues[index];
        if issue.status.is_terminal() {
            return None;
        }
        issue.status = IssueStatus::InProgress;
        issue.retries = retries;
        Some(issue.mint_implementer())
    }

    /// Mint the agent id of the next **reviewer** of issue `id`'s current attempt — the assigned
    /// implementer's own id with a reviewer suffix (`AUTH-1.0i` → `AUTH-1.0i.0r`, `AUTH-1.0i.1r`),
    /// so a verdict names both the review pass and the work it was passed on. `None` when no such
    /// issue exists.
    ///
    /// An issue with no implementer recorded (which a review cannot normally follow) is numbered
    /// directly under the issue instead of under a missing agent, so a reviewer always gets a
    /// unique, issue-scoped name.
    pub fn next_review_agent_id(&mut self, id: &str) -> Option<String> {
        let index = self.issue_position(id)?;
        let issue = &mut self.issues[index];
        let stem = issue
            .assigned_agent
            .clone()
            .unwrap_or_else(|| issue.id.clone());
        let seq = issue.review_seq;
        issue.review_seq += 1;
        Some(format!("{stem}.{seq}r"))
    }

    /// Mark the issue `id` [`Failed`](IssueStatus::Failed) — its retries are exhausted. Returns
    /// `false` (untouched) if no such issue exists or it is already terminal. The assignment is
    /// left in place as the last agent that worked it.
    pub fn fail_issue(&mut self, id: &str) -> bool {
        let Some(index) = self.issue_position(id) else {
            return false;
        };
        let issue = &mut self.issues[index];
        if issue.status.is_terminal() {
            return false;
        }
        issue.status = IssueStatus::Failed;
        true
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

    /// Whether an issue is actionable: not [terminal](IssueStatus::is_terminal), and every issue
    /// it is blocked by is [`Done`](IssueStatus::Done). A [`Failed`](IssueStatus::Failed) blocker
    /// is terminal but not done, so it never satisfies this.
    fn is_ready(&self, issue: &Issue) -> bool {
        !issue.status.is_terminal()
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

    /// The [`BoardState`](GgTelemetryKind::BoardState) telemetry for the current board, attributed
    /// to the [module instance](crate::modules::Module::instance_id) `module_id` — which every
    /// holder in the run reports identically, the board being run-global by construction.
    fn state_event(&self, module_id: &str) -> GgTelemetryKind {
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
                agent: issue.agent.clone(),
                reviewers: issue.reviewers.clone(),
                assigned_agent_id: issue.assigned_agent.clone(),
                retries: issue.retries,
            })
            .collect();
        GgTelemetryKind::BoardState {
            module_id: module_id.to_string(),
            epics,
            issues,
        }
    }

    /// The pinned context block rendering the whole board — its epics, then each issue's
    /// status, title, epic grouping, ready/blocked state, and structured scope sections — or
    /// `None` when the board is empty.
    fn context_block(&self) -> Option<Message> {
        if self.epics.is_empty() && self.issues.is_empty() {
            return None;
        }
        let epics = self
            .epics
            .iter()
            .map(|epic| EpicItemView {
                id: epic.id.clone(),
                title: epic.title.clone(),
                description: epic.description.clone(),
            })
            .collect();
        let issues = self
            .issues
            .iter()
            .map(|issue| self.issue_view(issue))
            .collect();
        Some(Message::user(prompts::render_board(&BoardBlockContext {
            epics,
            issues,
        })))
    }

    /// The dispatch **brief** for the issue with id `id` — its title, optional overview, and the
    /// three structured sections that bound the assigned agent's work (in-scope, out-of-scope,
    /// completion criteria) — or `None` when no issue of that id exists. The
    /// [dispatcher](crate::agent) reads the brief straight off the board (a read, not a
    /// reshaping), matching the [dispatch seam](self) the issue fields were designed for.
    fn issue_brief(&self, id: &str) -> Option<String> {
        let issue = self.issues.iter().find(|issue| issue.id == id)?;
        Some(prompts::render_issue_brief(&IssueBriefContext {
            id: issue.id.clone(),
            title: issue.title.clone(),
            description: issue.description.clone(),
            in_scope: issue.in_scope.clone(),
            out_of_scope: issue.out_of_scope.clone(),
            completion_criteria: issue.completion_criteria.clone(),
        }))
    }

    /// One issue as the pinned [context block](Self::context_block) renders it: its line (status,
    /// epic grouping, ready/blocked state) plus the structured brief. The DAG derivations are done
    /// here, in the store that owns the graph; the template only lays the result out.
    fn issue_view(&self, issue: &Issue) -> IssueItemView {
        let open = !issue.status.is_terminal();
        let ready = open && self.is_ready(issue);
        IssueItemView {
            id: issue.id.clone(),
            title: issue.title.clone(),
            description: issue.description.clone(),
            status: issue.status.word().to_string(),
            marker: issue.status.marker().to_string(),
            epic_id: issue.epic_id.clone(),
            ready,
            blocked_by: (open && !ready).then(|| {
                self.incomplete_blockers(issue)
                    .iter()
                    .map(|id| format!("`{id}`"))
                    .collect::<Vec<_>>()
                    .join(", ")
            }),
            in_scope: issue.in_scope.clone(),
            out_of_scope: issue.out_of_scope.clone(),
            completion_criteria: issue.completion_criteria.clone(),
            agent: issue.agent.clone(),
            reviewers: (!issue.reviewers.is_empty()).then(|| {
                issue
                    .reviewers
                    .iter()
                    .map(|name| format!("`{name}`"))
                    .collect::<Vec<_>>()
                    .join(", ")
            }),
        }
    }

    /// The [profile](Issue::agent) the issue with id `id` is assigned to, if it exists.
    fn issue_agent(&self, id: &str) -> Option<&str> {
        self.issues
            .iter()
            .find(|issue| issue.id == id)
            .map(Issue::agent)
    }

    /// The [reviewer profiles](Issue::reviewers) of the issue with id `id`, if it exists.
    fn issue_reviewers(&self, id: &str) -> Option<&[String]> {
        self.issues
            .iter()
            .find(|issue| issue.id == id)
            .map(Issue::reviewers)
    }
}

/// Normalize an [epic](Epic) prefix: trim it, **upper-case** it, and require 3–6 ASCII letters and
/// nothing else — no digits, no punctuation, no spaces, because the prefix is joined to a number with
/// a `-` to make an issue id (and to `.0i` to make an agent's name), and anything else there makes
/// those unparseable by eye.
///
/// Upper-casing rather than refusing lower case is deliberate: `auth` is unambiguously the prefix the
/// model meant, and rejecting it would spend a turn on a formality.
fn normalize_prefix(prefix: &str) -> Result<String, BoardError> {
    let trimmed = prefix.trim();
    let len = trimmed.chars().count();
    if !(MIN_PREFIX_LEN..=MAX_PREFIX_LEN).contains(&len)
        || !trimmed.chars().all(|c| c.is_ascii_alphabetic())
    {
        return Err(BoardError::InvalidPrefix(trimmed.to_string()));
    }
    Ok(trimmed.to_ascii_uppercase())
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

/// Trim, validate, and deduplicate a list of agent-profile names: every entry must be non-empty,
/// order is preserved, and duplicates are dropped (naming one reviewer twice is one reviewer).
fn normalize_names(raw: &[String], field: &'static str) -> Result<Vec<String>, BoardError> {
    let mut out: Vec<String> = Vec::new();
    for entry in raw {
        let entry = entry.trim();
        if entry.is_empty() {
            return Err(BoardError::EmptyField(field));
        }
        if !out.iter().any(|existing| existing == entry) {
            out.push(entry.to_string());
        }
    }
    Ok(out)
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
/// [caps](Self::caps) the [system prompt](crate::prompts::SystemContext::board) states, the
/// [`BoardState`](GgTelemetryKind::BoardState)
/// [telemetry](Self::state_event), and the pinned [context block](Self::context_block) the loop
/// keeps in the window.
///
/// It is the one [module](crate::modules::Module) that is **run-global by construction**: the board
/// is the run's single work queue, and every agent's handle on it is a [share](Self::shared) of the
/// one the orchestrator built. Forking it would fork the per-prefix issue counter and hand out
/// `ABC-4` twice, so [`Module::fork`] deliberately shares as well. What *is* per agent is
/// [ownership](Ownership): a profile without the authoring capability holds the board unowned, so
/// it is not shown a decomposition it has no tool to act on. It is deliberately not `Clone`; see
/// [the module model](crate::modules).
#[derive(Debug)]
pub struct BoardRuntime {
    /// Whether the epics-and-issues capability is enabled for this run.
    enabled: bool,
    /// Whether this holder's prompt carries the board.
    ownership: Ownership,
    /// The shared, mutable store — the same handle the tools mutate.
    store: Arc<Mutex<BoardStore>>,
    /// The [identity](crate::modules::ModuleIdMint) of that store. There is exactly one per run,
    /// minted with the run's board and carried by every holder of it — which is what makes the
    /// board legible as one module the whole run shares rather than as one board per agent.
    id: Arc<str>,
    /// The mint, carried for uniformity with the other modules; nothing ever mints a second board.
    ids: ModuleIds,
    /// How this holder came by the board. Always [`Run`](GgModuleOrigin::Run) in practice — see
    /// [`Module::origin_when_forked`].
    origin: GgModuleOrigin,
}

impl BoardRuntime {
    /// An enabled runtime with an empty board bounded by `caps`, identified out of a
    /// [detached](detached_ids) sequence — the by-hand constructor, which in practice means the
    /// tests. A run builds its one board through [`Self::new_in`].
    pub fn new(caps: BoardCaps) -> Self {
        Self::new_in(caps, &detached_ids())
    }

    /// The run's single board, identified out of the run's [mint](ModuleIds). Built once, by the
    /// orchestrator; every agent's handle on it is a [share](Self::shared) of this one.
    pub fn new_in(caps: BoardCaps, ids: &ModuleIds) -> Self {
        Self {
            enabled: true,
            ownership: Ownership::Owned,
            store: Arc::new(Mutex::new(BoardStore::new(caps))),
            id: ids.next(ModuleKind::Board),
            ids: Arc::clone(ids),
            origin: GgModuleOrigin::Run,
        }
    }

    /// A disabled runtime (the capability is off): no tools, no prompt text, no context
    /// block, no telemetry.
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            ..Self::new(BoardCaps::default())
        }
    }

    /// This runtime with its [ownership](Ownership) set.
    pub fn with_ownership(mut self, ownership: Ownership) -> Self {
        self.ownership = ownership;
        self
    }

    /// A **linked** handle onto the same board — the only way an agent ever gets one, since the
    /// board is the run's single work queue.
    pub fn shared(&self) -> Self {
        Self {
            enabled: self.enabled,
            ownership: self.ownership,
            store: Arc::clone(&self.store),
            id: Arc::clone(&self.id),
            ids: Arc::clone(&self.ids),
            origin: self.origin,
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

    /// The [`BoardState`](GgTelemetryKind::BoardState) telemetry for the current board, or
    /// `None` when the capability is off. Emitted at session start (empty) and after every
    /// successful mutation.
    pub fn state_event(&self) -> Option<GgTelemetryKind> {
        if !self.enabled {
            return None;
        }
        Some(
            self.store
                .lock()
                .expect("board store lock")
                .state_event(&self.id),
        )
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

    /// The [dispatch brief](BoardStore::issue_brief) for the issue with id `id` — the brief gg
    /// hands the agent it [dispatches](crate::agent) to implement it — or `None` when the
    /// capability is off or no such issue exists.
    pub fn issue_brief(&self, id: &str) -> Option<String> {
        if !self.enabled {
            return None;
        }
        self.store.lock().expect("board store lock").issue_brief(id)
    }

    /// The [agent profile](Issue::agent) the issue with id `id` is assigned to — the profile the
    /// [dispatcher](crate::agent) spawns it under — or `None` when the capability is off, no such
    /// issue exists, or it carries no assignee (a board recorded before issues named one).
    pub fn issue_agent(&self, id: &str) -> Option<String> {
        if !self.enabled {
            return None;
        }
        self.store
            .lock()
            .expect("board store lock")
            .issue_agent(id)
            .filter(|agent| !agent.is_empty())
            .map(str::to_string)
    }

    /// The [reviewer profiles](Issue::reviewers) of the issue with id `id` — the profiles its
    /// [review](crate::agent) must be approved by — or an empty list when the
    /// capability is off, no such issue exists, or it was filed without reviewers.
    pub fn issue_reviewers(&self, id: &str) -> Vec<String> {
        if !self.enabled {
            return Vec::new();
        }
        self.store
            .lock()
            .expect("board store lock")
            .issue_reviewers(id)
            .map(<[String]>::to_vec)
            .unwrap_or_default()
    }

    /// [Accept](BoardStore::accept_issue) the issue with id `id` — mark it
    /// [done](IssueStatus::Done) — returning whether it was (an unknown id, an already-terminal
    /// issue, or a disabled runtime yields `false`).
    ///
    /// The [orchestrator](crate::agent) calls this once every reviewer has approved and the issue's
    /// worktree has merged back, which is the only path to `Done`: an agent that finished its issue
    /// only moves it to [`InReview`](IssueStatus::InReview).
    pub fn accept_issue(&self, id: &str) -> bool {
        if !self.enabled {
            return false;
        }
        self.store
            .lock()
            .expect("board store lock")
            .accept_issue(id)
    }

    /// Move the issue with id `id` to [`InReview`](IssueStatus::InReview) — its assigned agent
    /// finished successfully — returning whether it moved (an unknown id, or a disabled runtime,
    /// yields `false`).
    ///
    /// The [orchestrator](crate::agent) calls this from an issue agent's completion path; nothing
    /// the model can call reaches it, because
    /// [an issue is finished when its agent is](self#completion-is-the-agents-own-and-acceptance-is-ggs).
    pub fn submit_issue_for_review(&self, id: &str) -> bool {
        if !self.enabled {
            return false;
        }
        self.store
            .lock()
            .expect("board store lock")
            .submit_issue_for_review(id)
    }

    /// The caps' [retry ceiling](BoardCaps::max_retries) — how many times the
    /// [dispatcher](crate::agent) re-dispatches a failed issue before marking it
    /// [`Failed`](IssueStatus::Failed). Zero when the capability is off.
    pub fn max_retries(&self) -> usize {
        if !self.enabled {
            return 0;
        }
        self.store.lock().expect("board store lock").max_retries()
    }

    /// The status of the issue with id `id`, or `None` when the capability is off or no such issue
    /// exists — the read the [dispatcher](crate::agent) and a [wait](crate::agent) consult.
    pub fn issue_status(&self, id: &str) -> Option<IssueStatus> {
        if !self.enabled {
            return None;
        }
        self.store
            .lock()
            .expect("board store lock")
            .issue_status(id)
    }

    /// Whether the issue with id `id` has reached a terminal state
    /// ([`Done`](IssueStatus::Done) or [`Failed`](IssueStatus::Failed)) — what a
    /// [wait](crate::agent) resolves on. A missing issue reads as terminal so a wait on an id that
    /// was removed does not hang.
    pub fn issue_is_terminal(&self, id: &str) -> bool {
        match self.issue_status(id) {
            Some(status) => status.is_terminal(),
            None => true,
        }
    }

    /// The [retry count](Issue::retries) of the issue with id `id`, or `0` when the capability is
    /// off or no such issue exists.
    pub fn issue_retries(&self, id: &str) -> u32 {
        if !self.enabled {
            return 0;
        }
        self.store
            .lock()
            .expect("board store lock")
            .issues()
            .iter()
            .find(|issue| issue.id() == id)
            .map(Issue::retries)
            .unwrap_or(0)
    }

    /// The ids of every issue that is [dispatchable right now](BoardStore::dispatchable_ids), or
    /// an empty list when the capability is off.
    pub fn dispatchable_ids(&self) -> Vec<String> {
        if !self.enabled {
            return Vec::new();
        }
        self.store
            .lock()
            .expect("board store lock")
            .dispatchable_ids()
    }

    /// [Claim](BoardStore::assign_issue) the issue `id`, returning the id of the implementer agent
    /// the store minted for it, or `None` when the claim was lost (or the capability is off).
    pub fn assign_issue(&self, id: &str) -> Option<String> {
        if !self.enabled {
            return None;
        }
        self.store
            .lock()
            .expect("board store lock")
            .assign_issue(id)
    }

    /// [Re-dispatch](BoardStore::redispatch_issue) the issue `id` with a new retry count, returning
    /// the id of the implementer agent the store minted for the attempt, or `None` when the issue is
    /// terminal or gone (or the capability is off).
    pub fn redispatch_issue(&self, id: &str, retries: u32) -> Option<String> {
        if !self.enabled {
            return None;
        }
        self.store
            .lock()
            .expect("board store lock")
            .redispatch_issue(id, retries)
    }

    /// Mint the [next reviewer's agent id](BoardStore::next_review_agent_id) for issue `id`, or
    /// `None` when no such issue exists (or the capability is off).
    pub fn next_review_agent_id(&self, id: &str) -> Option<String> {
        if !self.enabled {
            return None;
        }
        self.store
            .lock()
            .expect("board store lock")
            .next_review_agent_id(id)
    }

    /// Mark the issue `id` [`Failed`](IssueStatus::Failed), returning whether it was applied.
    /// `false` when the capability is off.
    pub fn fail_issue(&self, id: &str) -> bool {
        if !self.enabled {
            return false;
        }
        self.store.lock().expect("board store lock").fail_issue(id)
    }
}

impl Module for BoardRuntime {
    fn kind(&self) -> ModuleKind {
        ModuleKind::Board
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

    /// The run's, however its holder came by it. The board is run-global by construction, so
    /// "this copy received it when its forker was copied" would be a true statement that says
    /// nothing: every agent in the run holds this one board.
    fn origin_when_forked(&self) -> GgModuleOrigin {
        GgModuleOrigin::Run
    }

    fn enabled(&self) -> bool {
        self.enabled
    }

    fn ownership(&self) -> Ownership {
        self.ownership
    }

    fn context_source(&self) -> Option<GgContextSource> {
        Some(GgContextSource::Board)
    }

    fn refresh(&self) -> Refresh {
        Refresh::EveryTurn
    }

    fn context_block(&self) -> Option<Message> {
        if self.ownership != Ownership::Owned {
            return None;
        }
        BoardRuntime::context_block(self)
    }

    fn state_events(&self) -> Vec<GgTelemetryKind> {
        self.state_event().into_iter().collect()
    }

    /// Nothing: like the task list, the board's telemetry is **snapshot-only** — the whole board is
    /// re-emitted after each successful mutation by the agent that made it, and the board being
    /// run-global means that agent is by definition the one whose stream should carry it.
    fn drain_events(&mut self) -> Vec<GgTelemetryKind> {
        Vec::new()
    }

    fn retained(&self) -> u64 {
        self.issue_count() as u64
    }

    /// A **share**, not a copy. Two boards would each keep their own per-prefix issue counter and
    /// would both hand out `ABC-4`, for two different pieces of work, in a run whose logs, briefs
    /// and agent names all quote that id.
    fn fork(&self) -> ModuleHandle {
        self.share()
    }

    fn share(&self) -> ModuleHandle {
        ModuleHandle::Board(self.shared())
    }

    /// Always. A copy of an agent is a second worker on the *same* run, and the board is that
    /// run's single work queue.
    fn links_when_forked(&self) -> bool {
        true
    }

    /// Re-resolve the caps and the ownership from the receiving profile.
    ///
    /// A profile without the authoring capability does **not** refuse the board: it holds the same
    /// run-global queue [unowned](Ownership::Unowned), exactly as it would have been handed one at
    /// its own construction. Refusing would leave an agent that is working an issue unable to see
    /// the board its issue is on.
    fn adopt(
        &mut self,
        profile: &GgAgentConfig,
        ctx: &ModuleResolveCtx<'_>,
    ) -> Result<(), AdoptError> {
        self.ids = Arc::clone(ctx.ids);
        self.origin = GgModuleOrigin::Run;
        if profile.is_enabled(CAPABILITY_PROJECT_MANAGEMENT) {
            let caps = profile
                .capability(CAPABILITY_PROJECT_MANAGEMENT)
                .map(|cap| BoardCaps::resolve(&cap.params))
                .unwrap_or_default();
            self.store.lock().expect("board store lock").set_caps(caps);
            self.ownership =
                crate::modules::resolve_ownership(profile, CAPABILITY_PROJECT_MANAGEMENT).0;
        } else {
            self.ownership = Ownership::Unowned;
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "board.test.rs"]
mod tests;

#[cfg(test)]
#[path = "board.identifiers.test.rs"]
mod identifier_tests;
