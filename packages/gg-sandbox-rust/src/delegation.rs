//! Delegate work to child agents, and hand this session's own turn to another agent.
//!
//! Waiting on children can dominate a turn's wall clock — it blocks while real agents run — and the
//! run's budget keeps ticking while it does. A program should therefore spawn broadly and wait once,
//! rather than spawn-and-wait in a loop.
//!
//! The brief is where this arm's types earn their keep: a child is briefed either with a
//! self-contained [`Brief::Prompt`] or with a board [`Brief::Issue`], and because that choice is an
//! `enum` rather than two optional arguments, "both" and "neither" are programs that do not compile.

use crate::bindings::test_cabinet::gg::delegation;
use crate::core::ApiError;
use crate::wire;

/// The gg tools this module dispatches — see [`files::OPERATIONS`](crate::files::OPERATIONS).
pub(crate) const OPERATIONS: &[&str] = &[
    "spawn_subagent",
    "wait_for_subagents",
    "send_message",
    "transition_state",
    "exec",
    "fork",
];

/// Delegate scoped work to a child agent and hand back its handle immediately.
///
/// The child runs in parallel while the program continues. `agent` names one of the agent profiles
/// this agent may spawn — the system prompt lists them, and the profile selects the child's model,
/// tools and instructions. The brief is either `Brief::Prompt("self-contained instructions")` or
/// `Brief::Issue("AUTH-1")`. The child shares the workspace.
///
/// # Arguments
///
/// * `agent` — The agent profile to run the child as, from the ones this agent may spawn. It selects
///   the child's model, tools and instructions.
/// * `brief` — What the child is to do: `Brief::Prompt` with self-contained instructions, or
///   `Brief::Issue` with the id of a board issue to brief it from.
///
/// # Returns
///
/// The child's handle — its id, the profile it runs as and the model actually bound to it — which is
/// what waits on it and what messages it.
///
/// # Errors
///
/// `LimitExceeded` at the delegation depth cap, and `InvalidArgument` when `agent` is not one this
/// agent may spawn.
#[doc(alias = "ggop:delegation.spawn_subagent")]
pub fn spawn_subagent(agent: &str, brief: Brief<'_>) -> Result<SubagentHandle, ApiError> {
    wire::lift(delegation::spawn_subagent(&delegation::SpawnRequest {
        agent: agent.to_string(),
        task: brief.to_wire(),
    }))
    .map(wire::subagent_handle)
}

/// Block until the named children have finished and collect their results in dispatch order.
///
/// With `None` it waits for every outstanding child. The run's wall-clock budget keeps running
/// throughout, so one wait for many children costs far less than one wait per child.
///
/// # Arguments
///
/// * `ids` — The children to wait for, as [`spawn_subagent`] returned them; `None` waits for every
///   one still outstanding.
///
/// # Returns
///
/// One result per child waited on, in dispatch order rather than in the order they finished.
///
/// # Errors
///
/// `NotFound` for an id this agent did not spawn.
#[doc(alias = "ggop:delegation.wait_for_subagents")]
pub fn wait_for_subagents(ids: Option<&[&str]>) -> Result<Vec<SubagentResult>, ApiError> {
    let ids = ids.map(wire::strings);
    wire::lift(delegation::wait_for_subagents(ids.as_deref()))
        .map(|results| results.into_iter().map(wire::subagent_result).collect())
}

/// Deliver a message to a running child agent's inbox, which it reads at its next turn.
///
/// [`SubagentHandle::send`] is the same call with the id already supplied, for the common case where
/// the handle is in hand.
///
/// # Arguments
///
/// * `agent_id` — The child to deliver to, as [`spawn_subagent`] returned it.
/// * `message` — What to put in its inbox. It reads it at its next turn.
///
/// # Errors
///
/// `NotFound` for an unknown agent id, and `Conflict` when that child has already returned.
#[doc(alias = "ggop:delegation.send_message")]
pub fn send_message(agent_id: &str, message: &str) -> Result<(), ApiError> {
    wire::lift(delegation::send_message(agent_id, message))
}

/// Move the process this session is running inside on to another of its states.
///
/// The state is named the way an agent to spawn is named. It is bound only when a state machine is
/// driving the session and the current state has somewhere to go. Like a compaction it is
/// registered rather than performed: the call validates the target, returns, and the program runs on
/// to its end, because replacing the agent —
/// and its window — mid-program would pull every remaining call out from under it. The first
/// declaration in a turn is the one that stands.
///
/// # Arguments
///
/// * `state` — The state to move on to, named the way an agent to spawn is named.
/// * `note` — The opening message the next state's agent sees; `None` tells it nothing.
///
/// # Errors
///
/// `InvalidArgument` for a state this session may not move to, `Refused` for a second declaration in
/// one turn, and `Unavailable` when this agent is not running inside a state machine at all.
#[doc(alias = "ggop:delegation.transition_state")]
pub fn transition_state(state: &str, note: Option<&str>) -> Result<(), ApiError> {
    wire::lift(delegation::transition_state(state, note))
}

/// Continue this session as a different agent, from the next turn.
///
/// The named agent takes over with its own model, tools and instructions, keeping every capability
/// the two of them share — the whole conversation above all, so it needs no catching up. Registered
/// rather than performed, exactly as a state transition is and for the same reason: the window
/// would otherwise be pulled out from under the program still composing into it. A session makes one
/// succession per turn. It is bound only when this agent may make agent transitions and has agents it
/// may become, and never while a state machine is driving the session.
///
/// # Arguments
///
/// * `agent` — The agent to become, from the ones this agent may become.
/// * `prompt` — Its opening message. It already has the whole conversation, so this is the
///   instruction rather than a briefing; `None` tells it nothing.
///
/// # Errors
///
/// `InvalidArgument` for an agent this session may not become, `Refused` for a second succession in
/// one turn, and `Unavailable` when this agent is running inside a machine, which is left by a
/// state transition instead.
#[doc(alias = "ggop:delegation.exec")]
pub fn exec(agent: &str, prompt: Option<&str>) -> Result<(), ApiError> {
    wire::lift(delegation::exec(agent, prompt))
}

/// Run a copy of this agent, in parallel, on something it will not do itself.
///
/// The copy has the same model, the same tools and a private copy of the whole conversation, so
/// `prompt` is the *difference* rather than a briefing — everything already worked out is already
/// there.
///
/// Its handle comes back immediately, but the copy itself starts once this turn's tool results are
/// recorded, because the conversation it inherits has to be a complete one. So it can only be
/// collected on a later turn, and waiting on it in the program that made it never returns it.
///
/// # Arguments
///
/// * `prompt` — What the copy is to do instead. It has the whole conversation already, so this is the
///   difference rather than a briefing.
///
/// # Returns
///
/// The copy's handle, immediately — before the copy itself has started, which is why it can be
/// collected only on a later turn.
///
/// # Errors
///
/// `InvalidArgument` for a blank prompt, `LimitExceeded` at the delegation depth cap, and
/// `Unavailable` when the run has no delegation runtime to copy this agent into.
#[doc(alias = "ggop:delegation.fork")]
pub fn fork(prompt: &str) -> Result<SubagentHandle, ApiError> {
    wire::lift(delegation::fork(prompt)).map(wire::subagent_handle)
}

/// What a child agent is briefed with.
///
/// The choice is an `enum` rather than a pair of optional arguments, so "both" and "neither" are
/// programs that do not compile instead of calls that fail at run time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Brief<'a> {
    /// Self-contained instructions for a child that needs no other context.
    Prompt(&'a str),
    /// The id of a board issue to brief the child from, as the board assigned it.
    Issue(&'a str),
}

/// A child agent that was spawned and is now running in parallel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubagentHandle {
    /// The child's id — what [`wait_for_subagents`] and [`send_message`] take.
    pub id: String,
    /// The agent profile it runs as.
    pub slot: String,
    /// The model actually bound to that agent.
    pub model_id: String,
}

impl SubagentHandle {
    /// Deliver a message to this child's inbox, which it reads at its next turn.
    ///
    /// [`send_message`] with the id already supplied, for the common case where the handle is in
    /// hand.
    ///
    /// # Arguments
    ///
    /// * `message` — What to put in its inbox.
    ///
    /// # Errors
    ///
    /// `Conflict` when this child has already returned.
    #[doc(alias = "ggop-alias:delegation.send_message")]
    pub fn send(&self, message: &str) -> Result<(), ApiError> {
        send_message(&self.id, message)
    }
}

/// How a child agent's loop ended — gg's own six words, as the tool-calling path also reports them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AgentStatus {
    /// It finished normally, and its summary is what it returned.
    Completed,
    /// It reached the per-run turn ceiling.
    Exhausted,
    /// It passed its wall-clock deadline.
    TimedOut,
    /// A model turn failed.
    ModelError,
    /// The run's credential was refused.
    AuthError,
    /// An execution ceiling stopped it — consecutive errors, error rate, or cost.
    LimitExceeded,
}

/// One child agent's collected result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubagentResult {
    /// The child's id.
    pub id: String,
    /// How it finished; `None` when it produced no return value at all.
    pub status: Option<AgentStatus>,
    /// Its final message.
    pub summary: String,
}
