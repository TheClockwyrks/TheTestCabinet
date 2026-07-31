//! The **succession** tools: `transition_state`, `exec` and `fork` — the three ways one agent
//! instance becomes another.
//!
//! All three are one operation over [modules](crate::modules) — carry these, drop those, initialize
//! the rest — differing only in who chooses the successor and what happens to the predecessor. A
//! [machine transition](TransitionStateTool) is chosen by a declared [FSM](crate::fsm) and carries
//! exactly the modules the edge names; an [`exec`](ExecTool) is chosen by the model and carries
//! everything both profiles have; a [`fork`](ForkTool) copies everything into a *child* and leaves
//! the original running.
//!
//! Like the [delegation tools](super::subagents) none of these is self-contained: a succession
//! tears an agent instance down (or stands a second one up) against the scheduler, the emitter and
//! the module set, none of which a [`Tool`] can see. So the implementations here exist only to
//! **declare** the calls to the model, and their [`invoke`](Tool::invoke) is a defensive fallback
//! that never runs in a correctly wired session — the [loop](crate::transitions) judges and applies
//! every one of them.
//!
//! # Why each is offered
//!
//! `transition_state` is offered from the agent's [position](crate::fsm::FsmPosition) rather than
//! from a capability on its own profile, because the machine is declared on the **shell** that
//! drives it and the state agent knows nothing about it. A terminal state is offered nothing at
//! all: there is nowhere to go, and a tool whose every call would be refused is worse than an
//! absent one.
//!
//! `exec` and `fork` come from the
//! [`agent-transitions`](test_cabinet_core::gg::CAPABILITY_AGENT_TRANSITIONS) capability on the
//! agent's own profile. `exec` additionally needs a non-empty
//! [roster](test_cabinet_core::gg::GgAgentConfig::subagents) (there has to be something to become)
//! and is withheld from an agent standing in a machine state, where the machine decides where the
//! run goes next. `fork` additionally needs the delegation machinery, because a copy nobody can
//! wait on or message is a leak rather than a feature.

use async_trait::async_trait;
use serde_json::{Value, json};
use test_cabinet_core::gg::GgSubagentRef;

use super::{Tool, ToolContext, ToolOutcome, handled_by_loop};
use crate::fsm::FsmPosition;
use crate::model::ToolDefinition;

/// The `transition_state` tool name.
pub const TRANSITION_STATE_TOOL: &str = "transition_state";

/// The `exec` tool name.
pub const EXEC_TOOL: &str = "exec";

/// The `fork` tool name.
pub const FORK_TOOL: &str = "fork";

/// Render an agent's [roster](GgSubagentRef) as a sentence for the `exec` description, so the model
/// is told exactly which names it may become and the caller-scoped guidance for each.
///
/// Deliberately the same shape as the delegation tools' menu: naming an agent to become and naming
/// an agent to spawn are the same act from the model's side, and a model that has learned one
/// spelling should not have to learn a second.
fn agent_menu(agents: &[GgSubagentRef]) -> String {
    if agents.is_empty() {
        return "(no agents are available to you)".to_string();
    }
    agents
        .iter()
        .map(|reference| {
            if reference.description.trim().is_empty() {
                format!("`{}`", reference.agent)
            } else {
                format!("`{}` ({})", reference.agent, reference.description.trim())
            }
        })
        .collect::<Vec<_>>()
        .join("; ")
}

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

/// Declares `exec` — **become** another agent, in place, carrying everything both profiles hold.
///
/// Carries the agent's [roster](GgSubagentRef) so its description names exactly the profiles it may
/// become, for the same reason `spawn_subagent`'s does: the model cannot discover an allowlist by
/// trial, and a refusal that arrives after the model has committed to a name has already cost a
/// turn.
pub struct ExecTool {
    /// The agents this agent may become — its delegation roster, which is also the allowlist an
    /// `exec` target is validated against.
    agents: Vec<GgSubagentRef>,
}

impl ExecTool {
    /// Declare `exec` for an agent whose roster is `agents`.
    pub fn new(agents: Vec<GgSubagentRef>) -> Self {
        Self { agents }
    }
}

#[async_trait]
impl Tool for ExecTool {
    fn name(&self) -> &str {
        EXEC_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            EXEC_TOOL,
            format!(
                "Continue this session as a different agent. You are replaced: the named agent's \
                 model, tools and instructions take over from your next turn, and it keeps \
                 everything the two of you both have — your whole conversation above all, so it \
                 does not need to be caught up. Anything it does not have (a capability its profile \
                 turns off) is dropped, and anything only it has starts empty; its opening message \
                 says which. The agents you may become: {menu}. Use it when the work has changed \
                 shape rather than merely grown — a different toolset, a different model, a \
                 different set of instructions — and use `spawn_subagent` instead when you want the \
                 other agent to work *for* you and report back. The change happens once this turn's \
                 tool results are recorded, so finish the turn normally; your session does not end, \
                 the other agent continues it, and whatever put you to work sees one agent \
                 throughout.",
                menu = agent_menu(&self.agents),
            ),
            json!({
                "type": "object",
                "properties": {
                    "agent": {
                        "type": "string",
                        "description": "The name of the agent to continue as (one of the agents you \
                                        may become). This selects its model, tools, and \
                                        instructions."
                    },
                    "prompt": {
                        "type": "string",
                        "description": "Optional. What the agent taking over should do first. It is \
                                        shown to it as its opening message; anything already in the \
                                        conversation it inherits does not need repeating here."
                    }
                },
                "required": ["agent"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, _args: Value, _ctx: &ToolContext) -> ToolOutcome {
        handled_by_loop(EXEC_TOOL)
    }
}

/// Declares `fork` — run a **copy of yourself** on a second line of work.
///
/// It takes no `agent`: a fork can only ever be the agent making it. That is the whole difference
/// from `spawn_subagent`, and it is what makes the copy worth having — it starts knowing everything
/// the forker knows instead of from a brief someone had to write.
pub struct ForkTool;

#[async_trait]
impl Tool for ForkTool {
    fn name(&self) -> &str {
        FORK_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            FORK_TOOL,
            "Run a copy of yourself, in parallel, on something you will not do yourself. The copy \
             is you: your model, your tools, your instructions, and a private copy of your whole \
             conversation, so it already knows everything you know and needs no briefing — pass \
             only what it should do *differently*. It is an ordinary subagent from there: it gets \
             its own id, works in your workspace, and you collect it with `wait_for_subagents` or \
             guide it with `send_message`. Prefer it over `spawn_subagent` exactly when the context \
             is the expensive part — when briefing a fresh agent would mean re-explaining what you \
             have already worked out. Its own copies of your task list, notes and thread archive \
             diverge from yours the moment either of you writes; shared memories stay shared. The \
             copy starts once this turn's tool results are recorded, so wait for it on a later turn \
             rather than this one. Refused at the maximum delegation depth."
                .to_string(),
            json!({
                "type": "object",
                "properties": {
                    "prompt": {
                        "type": "string",
                        "description": "What the copy of you should do that you will not. It is \
                                        shown to it as its opening message, on top of the \
                                        conversation it inherits from you."
                    }
                },
                "required": ["prompt"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, _args: Value, _ctx: &ToolContext) -> ToolOutcome {
        handled_by_loop(FORK_TOOL)
    }
}
