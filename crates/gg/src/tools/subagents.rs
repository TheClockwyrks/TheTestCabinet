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
//! model (their name, description, and schema, so capability gating and the system-prompt listing
//! work uniformly). Their [`invoke`](Tool::invoke) is a defensive fallback that never runs in a
//! correctly wired session (whenever these tools are offered, the loop holds the subagent runtime
//! and handles them before dispatch).
//!
//! The tools are contributed to the registry only when the
//! [`subagents`](test_cabinet_core::gg::CAPABILITY_SUBAGENTS) capability is enabled; when it is
//! off, none are offered, and a run stays single-agent.

use async_trait::async_trait;
use serde_json::{Value, json};
use test_cabinet_core::gg::GgRosterEntry;

use super::{Tool, ToolContext, ToolOutcome};
use crate::model::ToolDefinition;

/// Render an agent's [resolved roster](GgRosterEntry) as a sentence for a delegation tool's
/// description, so the model is told — in both execution modes — exactly which ids it may pass as
/// `agent`, and the caller-scoped guidance for each. Never empty in practice: a delegation tool is
/// only offered to an agent whose roster has at least one entry.
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
        "`{name}` cannot be dispatched here; this is a gg defect."
    ))
}

/// Declares `spawn_subagent` — schedule a child agent and return immediately. Carries the spawning
/// agent's [resolved roster](GgRosterEntry) so its description names the agents that may be
/// spawned.
pub struct SpawnSubagentTool {
    /// The profiles this agent may spawn, each with the id the model names it by, listed in the
    /// tool's description.
    agents: Vec<GgRosterEntry>,
}

impl SpawnSubagentTool {
    /// Declare `spawn_subagent` for an agent whose resolved roster is `agents`.
    pub fn new(agents: Vec<GgRosterEntry>) -> Self {
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
                "Delegate scoped work to a child agent that runs in parallel with you. Returns \
                 the new subagent's id; collect its result with `wait_for_subagents`, or steer it \
                 with `send_message` while it runs. Subagents share your workspace, so give \
                 concurrent subagents non-overlapping briefs. Agents you may spawn: {menu}.",
                menu = agent_menu(&self.agents),
            ),
            json!({
                "type": "object",
                "properties": {
                    "agent": {
                        "type": "string",
                        "description": "The id of an agent you may spawn, copied exactly, \
                                        selecting the subagent's model, tools and instructions."
                    },
                    "prompt": {
                        "type": "string",
                        "description": "A self-contained brief: what to do, and what counts as done."
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
            "Suspend until subagents finish and collect their return values.",
            json!({
                "type": "object",
                "properties": {
                    "ids": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Subagent ids to wait for; omit to wait for all \
                                        outstanding ones."
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
            "Send a message to one of your running subagents. It arrives at that subagent's next \
             turn, so you can course-correct or add context while it works.",
            json!({
                "type": "object",
                "properties": {
                    "agentId": {
                        "type": "string",
                        "description": "The subagent to message."
                    },
                    "message": {
                        "type": "string",
                        "description": "Text to deliver."
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
