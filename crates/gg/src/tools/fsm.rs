//! The FSM tool: `advance_state` — how the model asks a
//! [FSM-driven process](crate::fsm) to move to the next state.
//!
//! Like the [planning tools](super::planning) it is **loop-coordinated**: its
//! [`invoke`](Tool::invoke) only *validates* the call, because the transition — checking the current
//! state's guard, injecting the next state's guidance, restricting the toolset — is a property of
//! the live [loop](crate::agent) and its [engine](crate::fsm), which a self-contained tool cannot
//! reach. The
//! loop enforces the order: it **refuses** the advance while the current state's condition is unmet,
//! so the agent cannot skip ahead.
//!
//! The tool is contributed to the registry only when the [`fsm`](test_cabinet_core::gg::CAPABILITY_FSM)
//! capability is enabled; when it is off, it is not offered (ablation). It is further withheld
//! per-turn (by the loop's toolset filter) while the current state is not one the agent advances by
//! calling it — a terminal state.

use async_trait::async_trait;
use serde_json::{Value, json};

use super::{Tool, ToolContext, ToolOutcome};
use crate::model::ToolDefinition;

/// The `advance_state` tool name.
pub const ADVANCE_STATE_TOOL: &str = "advance_state";

/// Whether `name` is the FSM transition tool — the loop uses this to route the call to its state
/// machine instead of ordinary dispatch.
pub fn is_fsm_tool(name: &str) -> bool {
    name == ADVANCE_STATE_TOOL
}

/// Advances the FSM-driven process to its next state (when the current state's condition is met).
pub struct AdvanceStateTool;

#[async_trait]
impl Tool for AdvanceStateTool {
    fn name(&self) -> &str {
        ADVANCE_STATE_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            ADVANCE_STATE_TOOL,
            "Advance the fixed process you are being driven through to its next state. It only \
             allows this when the current state's condition is met — for example, in a test-driven \
             process you cannot advance from writing tests to implementing until a test file \
             exists. If the condition is not met, the advance is refused and you stay in the current \
             state with an explanation of what is missing. Optionally include a short `note` \
             recording what you completed (a plan, or the evidence you are advancing on).",
            json!({
                "type": "object",
                "properties": {
                    "note": {
                        "type": "string",
                        "description": "Optional: a short summary of the work you completed in this \
                                        state (for a plan state, your plan)."
                    }
                },
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, _args: Value, _ctx: &ToolContext) -> ToolOutcome {
        // The loop performs the transition (it owns the engine, the context, and the offered
        // toolset); the tool only acknowledges the request. The loop overwrites this outcome with the
        // real result — the state entered, or a refusal explaining the unmet condition.
        ToolOutcome::ok(
            "Requesting a state transition.",
            "requested a state transition",
        )
    }
}
