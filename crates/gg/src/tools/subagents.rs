//! The subagent tools: `spawn_subagent`, `wait_for_subagents`, and `send_message` — how the
//! model **delegates** to child agents (the [subagents](https://docs.testcabinet.ai/gg/subagents/)
//! capability).
//!
//! Unlike the workspace tools, these are **not** self-contained: spawning, waiting, and messaging
//! act on the live [subagent scheduler](crate::subagents) and the agent tree, which a [`Tool`]
//! (which only sees its parsed args and the workspace [`ToolContext`]) cannot reach. So — like the
//! [agent-managed-context](crate::tools::context) tools —
//! the [turn loop](crate::agent) **intercepts** these calls and performs the real work against the
//! orchestrator; the [`Tool`] implementations here exist only to **declare** the tools to the
//! model (their name, description, and schema, so toolset ablation and the system-prompt listing
//! work uniformly). Their [`invoke`](Tool::invoke) is a defensive fallback that never runs in a
//! correctly wired session (whenever these tools are offered, the loop holds the subagent runtime
//! and handles them before dispatch).
//!
//! The tools are contributed to the registry only when the
//! [`subagents`](test_cabinet_core::gg::CAPABILITY_SUBAGENTS) capability is enabled; when it is
//! off, none are offered (ablation), and a run stays single-agent.

use async_trait::async_trait;
use serde_json::{Value, json};
use test_cabinet_core::gg::GgSubagentRef;

use super::{Tool, ToolContext, ToolOutcome};
use crate::model::ToolDefinition;

/// Render an agent's [delegation allowlist](GgSubagentRef) as a sentence for a delegation tool's
/// description, so the model is told — in both execution modes — exactly which names it may pass as
/// `agent`, and the caller-scoped guidance for each. Never empty in practice: a delegation tool is
/// only offered to an agent whose allowlist has at least one entry.
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

/// The `spawn_subagent` tool name.
pub const SPAWN_SUBAGENT_TOOL: &str = "spawn_subagent";
/// The `wait_for_subagents` tool name.
pub const WAIT_FOR_SUBAGENTS_TOOL: &str = "wait_for_subagents";
/// The `send_message` tool name.
pub const SEND_MESSAGE_TOOL: &str = "send_message";

/// Whether `name` is one of the delegation tools the [loop](crate::agent) **intercepts** —
/// `spawn_subagent`/`wait_for_subagents`/`send_message` — routing the call to the
/// [orchestrator](crate::agent) instead of ordinary [dispatch](super::ToolRegistry::dispatch).
/// All of them act on the scheduler and the agent tree, which a self-contained [`Tool`] cannot
/// reach.
pub fn is_subagent_tool(name: &str) -> bool {
    matches!(
        name,
        SPAWN_SUBAGENT_TOOL | WAIT_FOR_SUBAGENTS_TOOL | SEND_MESSAGE_TOOL
    )
}

/// The model-facing error returned if a subagent tool is ever dispatched normally (it should be
/// intercepted by the loop). Never seen in a correctly wired session.
pub(crate) fn handled_by_loop(name: &str) -> ToolOutcome {
    ToolOutcome::error(format!(
        "`{name}` is handled by the loop; it cannot be dispatched here."
    ))
}

/// Declares `spawn_subagent` — schedule a child agent and return immediately. Carries the spawning
/// agent's [delegation allowlist](GgSubagentRef) so its description names the agents that may be
/// spawned.
pub struct SpawnSubagentTool {
    /// The agents this agent may spawn, listed in its `agent` argument's description.
    agents: Vec<GgSubagentRef>,
}

impl SpawnSubagentTool {
    /// Declare `spawn_subagent` for an agent whose allowlist is `agents`.
    pub fn new(agents: Vec<GgSubagentRef>) -> Self {
        Self { agents }
    }
}

#[async_trait]
impl Tool for SpawnSubagentTool {
    fn name(&self) -> &str {
        SPAWN_SUBAGENT_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            SPAWN_SUBAGENT_TOOL,
            format!(
                "Delegate a scoped piece of work to a child agent that runs in parallel with you. \
                 Provide an `agent` — the name of the agent to run it as, which configures the \
                 subagent's model, tools, and instructions — and a `prompt`, a self-contained brief \
                 telling the subagent exactly what to do and what 'done' means. The agents you may \
                 spawn: {menu}. (Board issues are not dispatched this way: submitting an issue \
                 automatically spawns an agent for it once its blockers are done.) Returns the new \
                 subagent's id immediately — it is scheduled and runs on its own; call \
                 `wait_for_subagents` to collect its result, or `send_message` to guide it while it \
                 runs. A subagent shares your workspace, so give concurrent subagents \
                 non-overlapping briefs. Spawning fails if you are already at the maximum \
                 delegation depth.",
                menu = agent_menu(&self.agents),
            ),
            json!({
                "type": "object",
                "properties": {
                    "agent": {
                        "type": "string",
                        "description": "The name of the agent to run the subagent as (one of the \
                                        agents you may spawn). This selects its model, tools, and \
                                        instructions."
                    },
                    "prompt": {
                        "type": "string",
                        "description": "A self-contained brief for the subagent (what to do and \
                                        how it will be judged done)."
                    }
                },
                "required": ["agent", "prompt"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, _args: Value, _ctx: &ToolContext) -> ToolOutcome {
        handled_by_loop(SPAWN_SUBAGENT_TOOL)
    }
}

/// Declares `wait_for_subagents` — block until named (or all) children return, then collect them.
pub struct WaitForSubagentsTool;

#[async_trait]
impl Tool for WaitForSubagentsTool {
    fn name(&self) -> &str {
        WAIT_FOR_SUBAGENTS_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            WAIT_FOR_SUBAGENTS_TOOL,
            "Wait for one or more of your subagents to finish and collect their return values. \
             Pass `ids` (a list of subagent ids) to wait for specific children, or omit it to \
             wait for all of your outstanding subagents. While you wait you free your run slot so \
             your subagents (and other agents) can run; you resume once the awaited subagents have \
             all returned. The result contains each subagent's final message.",
            json!({
                "type": "object",
                "properties": {
                    "ids": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional ids of the subagents to wait for (omit to wait \
                                        for all outstanding ones)."
                    }
                },
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, _args: Value, _ctx: &ToolContext) -> ToolOutcome {
        handled_by_loop(WAIT_FOR_SUBAGENTS_TOOL)
    }
}

/// Declares `send_message` — deliver a message to a running child's inbox.
pub struct SendMessageTool;

#[async_trait]
impl Tool for SendMessageTool {
    fn name(&self) -> &str {
        SEND_MESSAGE_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            SEND_MESSAGE_TOOL,
            "Send a message to one of your running subagents. Provide the subagent's `agentId` \
             and the `message` text. The subagent receives your message at its next turn (as a \
             message from you), so you can course-correct or add context while it works. Fails if \
             the agent is not one of your subagents or has already returned.",
            json!({
                "type": "object",
                "properties": {
                    "agentId": {
                        "type": "string",
                        "description": "The id of the subagent to message (one you spawned)."
                    },
                    "message": {
                        "type": "string",
                        "description": "The message to deliver to the subagent."
                    }
                },
                "required": ["agentId", "message"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, _args: Value, _ctx: &ToolContext) -> ToolOutcome {
        handled_by_loop(SEND_MESSAGE_TOOL)
    }
}
