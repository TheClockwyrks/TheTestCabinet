//! The **ending calls** an agent is offered.
//!
//! How an agent declares it is done is **not** configurable and never was worth making so. Every
//! agent ends its session with an explicit, typed call, in both execution modes: a tool-calling reply
//! that requests no tools is an error, and a
//! [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) reply that makes no
//! [`submit_program`](SUBMIT_PROGRAM_TOOL) call is an error. *Which* calls an agent has is decided by its [role](crate::ending::EndingRole)
//! — see [`crate::ending`], which owns the shapes; this module owns how they reach a **tool-calling**
//! model, as the [synthetic tool definitions](role_tool_definitions) the loop appends and intercepts.
//!
//! What *gates* an ending lives elsewhere: an [agent-stop hook](crate::hooks) holds a profile to
//! whatever validation must pass before its agent may stop. This module owns only the calls
//! themselves.

use serde_json::json;

use test_cabinet_core::gg::GgProgramLanguage;

use crate::ending::EndingRole;
use crate::model::{ToolCall, ToolDefinition};
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

/// The **one tool a [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) turn
/// offers** — and requires, via forced tool choice: the call whose `program` string **is** the
/// turn's program.
///
/// Like the ending calls above it is a loop-level synthetic, dispatched by nothing: the loop reads
/// the call's `program` argument and runs it in the sandbox. It is not a registry tool and not a
/// name in [`ALL_TOOL_NAMES`](crate::tools::ALL_TOOL_NAMES).
pub(crate) const SUBMIT_PROGRAM_TOOL: &str = "submit_program";

/// The tool result answering a [`submit_program`](SUBMIT_PROGRAM_TOOL) call that carried a program,
/// for an agent that keeps **no** [program library](crate::programs).
///
/// It is pushed **before** the program runs — the transcript needs a `tool` message directly after
/// the assistant's call for the request to stay a conversation every provider accepts, and the
/// program's own products (views, errors, notices) land as their own messages after it — so it can
/// carry no outcome, and deliberately says nothing beyond receipt. An agent that keeps a library is
/// answered with the id the library minted for the program instead — see [`submit_program_ack`] —
/// and the system prompt states both, so the model reads the body as the protocol rather than as a
/// verdict.
pub(crate) const SUBMIT_PROGRAM_ACK: &str = "ok";

/// The body of the tool result acknowledging a program: the bare id the
/// [program library](crate::programs) issued it (`k3p9`), or [`SUBMIT_PROGRAM_ACK`] for an agent
/// whose library issues none.
///
/// A receipt and not a verdict either way. The id is what `programs.get` takes for this program,
/// and a `programs.rerun` chain inside the submission keeps it.
pub(crate) fn submit_program_ack(id: Option<&str>) -> String {
    id.map_or_else(|| SUBMIT_PROGRAM_ACK.to_string(), str::to_string)
}

/// The [`SUBMIT_PROGRAM_TOOL`] definition for an agent writing `language` — the single tool a
/// responses-as-code request offers, with the request's tool choice pinned to it
/// ([`ModelClient::complete_requiring`](crate::model::ModelClient::complete_requiring)).
pub(crate) fn submit_program_tool(language: GgProgramLanguage) -> ToolDefinition {
    let display = crate::sandbox::language(language).display_name();
    ToolDefinition::new(
        SUBMIT_PROGRAM_TOOL,
        format!(
            "Run this turn's program. `program` must be one whole {display} program; it is \
             compiled and executed exactly as written."
        ),
        json!({
            "type": "object",
            "properties": {
                "program": {
                    "type": "string",
                    "description": format!("The complete {display} program to run."),
                }
            },
            "required": ["program"],
            "additionalProperties": false,
        }),
    )
}

/// A synthesized [`submit_program`](SUBMIT_PROGRAM_TOOL) call carrying `program` under the
/// deterministic id `id` — how gg writes a program **it** ran into a code-mode agent's transcript
/// (the bootstrap's opening turn, autoloaded specifications, a persistent agent's restored views),
/// so a synthetic turn has exactly the shape the model's own turns must take.
pub(crate) fn synthesized_submission(id: &str, program: &str) -> ToolCall {
    ToolCall {
        id: id.to_string(),
        name: SUBMIT_PROGRAM_TOOL.to_string(),
        arguments: json!({ "program": program }),
    }
}

#[cfg(test)]
#[path = "completion.test.rs"]
mod tests;
