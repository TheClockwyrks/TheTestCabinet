//! The **ending calls** an agent is offered.
//!
//! How an agent declares it is done is **not** configurable and never was worth making so. Every
//! agent ends its session with an explicit, typed call, in both execution modes: a tool-calling reply
//! that requests no tools is an error, and a
//! [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) reply that is not a
//! program is an error. *Which* calls an agent has is decided by its [role](crate::ending::EndingRole)
//! — see [`crate::ending`], which owns the shapes; this module owns how they reach a **tool-calling**
//! model, as the [synthetic tool definitions](role_tool_definitions) the loop appends and intercepts.
//!
//! What *gates* an ending lives elsewhere: an [agent-stop hook](crate::hooks) holds a profile to
//! whatever validation must pass before its agent may stop. This module owns only the calls
//! themselves.

use serde_json::json;

use crate::ending::EndingRole;
use crate::model::ToolDefinition;
use crate::prompts;
use crate::sandbox::FINISH_FUNCTION;

/// The **ending call** names, shared by both execution modes so that ending a session is one
/// vocabulary a model learns once — `harness.finish(…)` in a program and `finish` as a tool are the
/// same call.
///
/// Each is a **loop-level synthetic**: appended to the offered set by [`Agent::drive`](crate::agent)
/// according to the agent's [role](EndingRole) and intercepted by the loop. None is a registry tool
/// or a name in [`ALL_TOOL_NAMES`](crate::tools::ALL_TOOL_NAMES), exactly as their code-mode
/// counterparts are not in the sandbox's tool catalogue.
pub(crate) const FINISH_TOOL: &str = FINISH_FUNCTION;
/// See [`FINISH_TOOL`]. A reviewer's approval.
pub(crate) const APPROVE_TOOL: &str = "approve";
/// See [`FINISH_TOOL`]. A reviewer's rejection, carrying the changes it requires.
pub(crate) const REQUEST_CHANGES_TOOL: &str = "request_changes";

/// The tool-calling definitions of `role`'s [ending calls](FINISH_TOOL) — the synthetic tools the
/// loop appends to the offered set and intercepts.
///
/// They are built here rather than in the registry for the same reason their code-mode counterparts
/// are outside the sandbox's tool catalogue: nothing dispatches them. A call to one is read by the
/// loop as a **declaration**, and its arguments are the declaration's content, which is why each
/// schema demands exactly what that role's verdict is made of and nothing more.
pub(crate) fn role_tool_definitions(role: EndingRole) -> Vec<ToolDefinition> {
    match role {
        EndingRole::Standard => vec![ToolDefinition::new(
            FINISH_TOOL,
            "End your session once the work is complete.",
            json!({
                "type": "object",
                "properties": {
                    "summary": {
                        "type": "string",
                        "description": "What you did, in a sentence or two."
                    }
                },
                "required": ["summary"],
                "additionalProperties": false
            }),
        )],
        EndingRole::Review => vec![
            ToolDefinition::new(
                APPROVE_TOOL,
                "Accept the work: it meets every completion criterion and stays in scope.",
                json!({
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }),
            ),
            ToolDefinition::new(
                REQUEST_CHANGES_TOOL,
                "Reject the work, naming every change it needs to be accepted.",
                json!({
                    "type": "object",
                    "properties": {
                        "items": {
                            "type": "array",
                            "minItems": 1,
                            "items": { "type": "string" },
                            "description": "One change per entry: what is wrong and what to change."
                        }
                    },
                    "required": ["items"],
                    "additionalProperties": false
                }),
            ),
        ],
    }
}

/// The message handed back to the model when a tool-calling turn requested no tools at all — a
/// text-only reply, which is an error rather than an ending. It names the calls `role` actually has,
/// so a reviewer is never pointed at a `finish` it was not given.
pub(crate) fn missing_completion_feedback(role: EndingRole) -> String {
    prompts::render_completion_missing(role.tools())
}

#[cfg(test)]
#[path = "completion.test.rs"]
mod tests;
