//! delegate work to child agents
//!
//! [`wait_for_subagents`] can dominate a turn's wall clock — it blocks while real agents run — and
//! the run's budget keeps ticking while it does. A program should therefore spawn broadly and wait
//! once, not spawn-and-wait in a loop.
//!
//! The brief is where this arm's types earn their keep: a child is briefed either with a
//! self-contained [`Brief::Prompt`] or with a board [`Brief::Issue`], and because that choice is an
//! `enum` rather than two optional arguments, "both" and "neither" are programs that do not compile.

use crate::bindings::test_cabinet::gg::delegation;
use crate::error::ToolError;
use crate::types::{Brief, SubagentHandle, SubagentResult};
use crate::wire;

/// The gg tools this object dispatches — see [`fs::TOOLS`](crate::fs::TOOLS).
pub(crate) const TOOLS: &[&str] = &[
    "spawn_subagent",
    "wait_for_subagents",
    "send_message",
    "transition_state",
    "exec",
    "fork",
];

crate::meta::directory_of!("agents");

/// Delegate scoped work to a child agent and hand back its handle immediately — the child runs in
/// parallel while your program continues.
///
/// Name the `agent` to run it as (one of the agents you may spawn — the system prompt lists them; it
/// selects the child's model, tools, and instructions) and brief it with either
/// `Brief::Prompt("self-contained instructions")` or `Brief::Issue("AUTH-1")`. The child shares your
/// workspace.
///
/// # Arguments
///
/// * `agent` — The agent profile to run the child as, from the ones you may spawn. It selects the
///   child's model, tools and instructions.
/// * `brief` — What the child is to do: `Brief::Prompt` with self-contained instructions, or
///   `Brief::Issue` with the id of a board issue to brief it from.
///
/// # Errors
///
/// `LimitExceeded` at the delegation depth cap, and `InvalidArgument` if `agent` is not one you may
/// spawn.
pub fn spawn_subagent(agent: &str, brief: Brief<'_>) -> Result<SubagentHandle, ToolError> {
    wire::lift(delegation::spawn_subagent(&delegation::SpawnRequest {
        agent: agent.to_string(),
        task: brief.to_wire(),
    }))
    .map(wire::subagent_handle)
}

/// Block until the named children have finished — or, with `None`, until every outstanding child has
/// — and collect their results in dispatch order.
///
/// The run's wall-clock budget keeps running while you wait, so wait once for many children rather
/// than once per child.
///
/// # Arguments
///
/// * `ids` — The children to wait for, as `agents::spawn_subagent` returned them; `None` waits for
///   every one still outstanding.
///
/// # Errors
///
/// `NotFound` for an unknown id.
pub fn wait_for_subagents(ids: Option<&[&str]>) -> Result<Vec<SubagentResult>, ToolError> {
    let ids = ids.map(wire::strings);
    wire::lift(delegation::wait_for_subagents(ids.as_deref()))
        .map(|results| results.into_iter().map(wire::subagent_result).collect())
}

/// Deliver a message to a running child agent's inbox; it reads the message at its next turn.
///
/// # Arguments
///
/// * `agent_id` — The child to deliver to, as `agents::spawn_subagent` returned it.
/// * `message` — What to put in its inbox. It reads it at its next turn.
///
/// # Errors
///
/// `NotFound` for an unknown agent id, and `Conflict` when that child has already returned.
pub fn send_message(agent_id: &str, message: &str) -> Result<(), ToolError> {
    wire::lift(delegation::send_message(agent_id, message))
}

/// Move the process you are running inside on to another of its states, naming the state the way you
/// name an agent to spawn.
///
/// Bound only when a state machine is driving you and the state you are in has somewhere to go. Like
/// `context::compact` it is registered rather than performed: the call validates the target,
/// returns, and your program runs on to its end — the transition happens after that, because
/// replacing your agent (and your window) mid-program would pull every remaining call out from under
/// it. The FIRST declaration stands.
///
/// # Arguments
///
/// * `state` — The state to move on to, named the way you name an agent to spawn.
/// * `note` — The opening message the next state's agent sees; `None` tells it nothing.
///
/// # Errors
///
/// `InvalidArgument` for a state you may not move to, and `Refused` for a second declaration in one
/// turn.
pub fn transition_state(state: &str, note: Option<&str>) -> Result<(), ToolError> {
    wire::lift(delegation::transition_state(state, note))
}

/// Continue this session as a different agent: the named agent takes over from your next turn with
/// its own model, tools and instructions, keeping every capability the two of you both have — your
/// whole conversation above all, so it needs no catching up.
///
/// Registered rather than performed, exactly as `agents::transition_state` is and for the same
/// reason: your window would otherwise be pulled out from under the program still composing into it.
/// A session makes one succession per turn. Bound only when your agent may make agent transitions
/// and has agents it may become, and never while a state machine is driving you.
///
/// # Arguments
///
/// * `agent` — The agent to become, from the ones you may become.
/// * `prompt` — Its opening message. It already has your whole conversation, so this is the
///   instruction rather than a briefing; `None` tells it nothing.
///
/// # Errors
///
/// `InvalidArgument` for an agent you may not become, and `Refused` for a second succession in one
/// turn.
pub fn exec(agent: &str, prompt: Option<&str>) -> Result<(), ToolError> {
    wire::lift(delegation::exec(agent, prompt))
}

/// Run a copy of yourself, in parallel, on something you will not do yourself.
///
/// The copy has your model, your tools and a private copy of your whole conversation, so `prompt` is
/// the *difference* rather than a briefing — everything you have worked out is already there.
///
/// Its handle comes back immediately, but the copy itself starts once this turn's tool results are
/// recorded (the conversation it inherits has to be a complete one), so `agents::wait_for_subagents`
/// can only collect it on a later turn — do not wait on it in the program that made it.
///
/// # Arguments
///
/// * `prompt` — What the copy is to do instead of what you are doing. It has your whole conversation
///   already, so write the difference rather than a briefing.
///
/// # Errors
///
/// `LimitExceeded` at the delegation depth cap.
pub fn fork(prompt: &str) -> Result<SubagentHandle, ToolError> {
    wire::lift(delegation::fork(prompt)).map(wire::subagent_handle)
}
