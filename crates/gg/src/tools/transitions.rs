//! The state-transition tool: `transition_state` — how an agent inside a user-authored
//! [machine](crate::fsm) moves the machine on.
//!
//! Like the [delegation tools](super::subagents) this is **not** self-contained: a transition tears
//! the running agent instance down and stands the next state's up, carrying the
//! [modules](crate::modules) the edge names — work that belongs to the agent loop and reaches the
//! scheduler, the emitter and the module set, none of which a [`Tool`] can see. So the
//! implementation here exists only to **declare** the call to the model, and its
//! [`invoke`](Tool::invoke) is a defensive fallback that never runs in a correctly wired session.
//!
//! It is offered from the agent's [position](crate::fsm::FsmPosition) rather than from a capability
//! on its own profile, because the machine is declared on the **shell** that drives it and the state
//! agent knows nothing about it. A terminal state is offered nothing at all: there is nowhere to go,
//! and a tool whose every call would be refused is worse than an absent one.

use async_trait::async_trait;
use serde_json::{Value, json};

use super::{Tool, ToolContext, ToolOutcome, handled_by_loop};
use crate::fsm::FsmPosition;
use crate::model::ToolDefinition;

/// The `transition_state` tool name.
pub const TRANSITION_STATE_TOOL: &str = "transition_state";

/// Declares `transition_state` for an agent occupying `position`, so its description enumerates
/// exactly the states that agent may move to and the machine author's guidance for each.
///
/// The menu is built the same way [`spawn_subagent`](super::subagents)'s roster menu is, and
/// deliberately so: naming a state to become and naming an agent to spawn are the same act from the
/// model's side, and a model that has learned one spelling should not have to learn a second.
pub struct TransitionStateTool {
    /// Where the calling agent sits in its machine — the source of the legal targets.
    position: FsmPosition,
}

impl TransitionStateTool {
    /// Declare `transition_state` for an agent at `position`.
    pub fn new(position: FsmPosition) -> Self {
        Self { position }
    }
}

#[async_trait]
impl Tool for TransitionStateTool {
    fn name(&self) -> &str {
        TRANSITION_STATE_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            TRANSITION_STATE_TOOL,
            format!(
                "Move this process on to its next state. You are in the `{state}` state of the \
                 `{fsm}` process; naming a state hands the work to the agent that state runs, which \
                 has its own model, tools and instructions. The states you may move to: {menu}. \
                 What you take with you is fixed by the process, not by you — the transition you \
                 name decides which of your conversation, memories, task list, board, skills and \
                 thread archive the next agent receives, and your opening message there says what \
                 arrived and what did not. The transition happens once this turn's tool results are \
                 recorded, so finish the turn normally; you do not end your session, the next state \
                 continues it.",
                state = self.position.state(),
                fsm = self.position.fsm(),
                menu = self.position.legal_targets(),
            ),
            json!({
                "type": "object",
                "properties": {
                    "state": {
                        "type": "string",
                        "description": "The name of the state to move to (one of the states you \
                                        may move to)."
                    },
                    "note": {
                        "type": "string",
                        "description": "Optional. What the next state's agent should know or do \
                                        first. It is shown to that agent as its opening message; \
                                        anything you hand over in your conversation or task list \
                                        does not need repeating here."
                    }
                },
                "required": ["state"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, _args: Value, _ctx: &ToolContext) -> ToolOutcome {
        handled_by_loop(TRANSITION_STATE_TOOL)
    }
}
