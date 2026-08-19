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
//! that never runs in a correctly wired session — the [loop](crate::agent::transitions) judges and applies
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
//! `exec` and `fork` each come from their own capability
//! ([`exec`](test_cabinet_core::gg::CAPABILITY_EXEC) and
//! [`fork`](test_cabinet_core::gg::CAPABILITY_FORK)) on the
//! agent's own profile. `exec` additionally needs a non-empty
//! [roster](test_cabinet_core::gg::GgAgentConfig::subagents) (there has to be something to become)
//! and is withheld from an agent standing in a machine state, where the machine decides where the
//! run goes next. `fork` additionally needs the delegation machinery, because a copy nobody can
//! wait on or message is a leak rather than a feature.

use async_trait::async_trait;
use serde_json::{Value, json};
use test_cabinet_core::gg::GgRosterEntry;

use super::{Tool, ToolContext, ToolOutcome, handled_by_loop};
use crate::fsm::FsmPosition;
use crate::model::ToolDefinition;

/// The `transition_state` tool name.
pub const TRANSITION_STATE_TOOL: &str = "transition_state";

/// The `exec` tool name.
pub const EXEC_TOOL: &str = "exec";

/// The `fork` tool name.
pub const FORK_TOOL: &str = "fork";

/// Render an agent's [resolved roster](GgRosterEntry) as a sentence for the `exec` description, so the model
/// is told exactly which ids it may become and the caller-scoped guidance for each.
///
/// Deliberately the same shape as the delegation tools' menu: naming an agent to become and naming
/// an agent to spawn are the same act from the model's side, and a model that has learned one
/// spelling should not have to learn a second.
fn agent_menu(agents: &[GgRosterEntry]) -> String {
    if agents.is_empty() {
        return "(no agents are available to you)".to_string();
    }
    agents
        .iter()
        .map(|entry| {
            // The id is what the model passes; the name is only here so the menu reads as prose.
            let name = entry.name.trim();
            match (name.is_empty(), entry.description.trim()) {
                (true, "") => format!("`{}`", entry.agent_id),
                (true, why) => format!("`{}` ({why})", entry.agent_id),
                (false, "") => format!("`{}` ({name})", entry.agent_id),
                (false, why) => format!("`{}` ({name}: {why})", entry.agent_id),
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
                "Move this process from its `{state}` state to the state you name, which runs its \
                 own agent with its own model, tools and instructions. States you may move to: \
                 {menu}. The process decides what carries over, so put anything the next agent \
                 must have in `note`.",
                state = self.position.state(),
                menu = self.position.legal_targets(),
            ),
            json!({
                "type": "object",
                "properties": {
                    "state": {
                        "type": "string",
                        "description": "State to move to."
                    },
                    "note": {
                        "type": "string",
                        "description": "Opening message for the next state's agent."
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
/// Carries the agent's [resolved roster](GgRosterEntry) so its description names exactly the profiles it may
/// become, for the same reason `spawn_subagent`'s does: the model cannot discover an allowlist by
/// trial, and a refusal that arrives after the model has committed to a name has already cost a
/// turn.
pub struct ExecTool {
    /// The agents this agent may become — its delegation roster, which is also the allowlist an
    /// `exec` target is validated against.
    agents: Vec<GgRosterEntry>,
    /// Whether this agent is offered [`spawn_subagent`](super::subagents::SpawnSubagentTool) as
    /// well, which decides whether the description contrasts the two.
    ///
    /// `exec` is bought by its own capability and never implies the delegation one, and the
    /// profile's tool allowlist can strip a spawn call this one keeps — so the contrast is
    /// rendered only for an agent that holds both.
    spawn_subagent: bool,
}

impl ExecTool {
    /// Declare `exec` for an agent whose roster is `agents`, which also holds `spawn_subagent`
    /// when `spawn_subagent`.
    pub fn new(agents: Vec<GgRosterEntry>, spawn_subagent: bool) -> Self {
        Self {
            agents,
            spawn_subagent,
        }
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
                "Continue this session as a different agent: its model, tools and instructions \
                 take over from your next turn, and it inherits your conversation. Use it when the \
                 work needs a different toolset, model or instructions{delegation}. Agents you may \
                 become: {menu}.",
                delegation = if self.spawn_subagent {
                    "; use `spawn_subagent` instead to have another agent work for you and report \
                     back"
                } else {
                    ""
                },
                menu = agent_menu(&self.agents),
            ),
            json!({
                "type": "object",
                "properties": {
                    "agent": {
                        "type": "string",
                        "description": "Agent to continue as."
                    },
                    "prompt": {
                        "type": "string",
                        "description": "Opening message for the agent taking over."
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
pub struct ForkTool {
    /// Whether this agent is offered [`spawn_subagent`](super::subagents::SpawnSubagentTool) as
    /// well, which decides whether the description contrasts the two.
    ///
    /// `fork` needs only the delegation machinery, while a spawn additionally needs a non-empty
    /// roster and can be stripped by the profile's tool allowlist — so an agent holding `fork`
    /// routinely holds no spawn call to be preferred over.
    spawn_subagent: bool,
    /// Whether this agent holds a [task list](crate::tasks).
    tasks: bool,
    /// Whether this agent holds a [thread archive](crate::archive).
    archive: bool,
    /// This agent's [memory](crate::memories) binding: `None` without memories at all, and
    /// otherwise whether that binding links the copy's notebook to this one's.
    memories: Option<bool>,
}

impl ForkTool {
    /// Declare `fork` for an agent that also holds `spawn_subagent` when `spawn_subagent`, holds a
    /// task list when `tasks` and a thread archive when `archive`, and whose memory binding is
    /// `memories`.
    pub fn new(spawn_subagent: bool, tasks: bool, archive: bool, memories: Option<bool>) -> Self {
        Self {
            spawn_subagent,
            tasks,
            archive,
            memories,
        }
    }

    /// The sentence naming the modules the copy gets its **own** of, or the empty string for an
    /// agent holding none of them — so a fork description never names a module its caller has no
    /// way to hold.
    fn divergence(&self) -> String {
        let mut own: Vec<&str> = Vec::new();
        if self.tasks {
            own.push("task list");
        }
        if self.memories == Some(false) {
            own.push("memories");
        }
        if self.archive {
            own.push("thread archive");
        }
        match own.split_last() {
            None => String::new(),
            Some((last, [])) => format!(" Its copy of your {last} diverges from yours."),
            Some((last, rest)) => format!(
                " Its copies of your {} and {last} diverge from yours.",
                rest.join(", ")
            ),
        }
    }
}

#[async_trait]
impl Tool for ForkTool {
    fn name(&self) -> &str {
        FORK_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            FORK_TOOL,
            format!(
                "Run a copy of yourself in parallel on work you will not do yourself. The copy \
                 works in your workspace and has your model, tools, instructions and a private \
                 copy of your conversation, so brief it only on what it should do \
                 differently{delegation}. \
                 Collect it with `wait_for_subagents` or steer it with \
                 `send_message`.{divergence}{shared}",
                delegation = if self.spawn_subagent {
                    "; prefer it over `spawn_subagent` whenever briefing a fresh agent would mean \
                     re-explaining what you have already worked out"
                } else {
                    ""
                },
                divergence = self.divergence(),
                shared = if self.memories == Some(true) {
                    " Your memories stay shared with it."
                } else {
                    ""
                },
            ),
            json!({
                "type": "object",
                "properties": {
                    "prompt": {
                        "type": "string",
                        "description": "What the copy should do differently from you."
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
