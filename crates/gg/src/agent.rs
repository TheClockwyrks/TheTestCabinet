//! The gg **agent turn loop**.
//!
//! This is gg's core — the one coarse-grained plug point of the design (all other
//! modularity comes from [which tools](crate::tools) are offered). The loop runs one
//! logical session: build a model request from the conversation and the offered
//! toolset, send it via the [client](crate::client), record the assistant's message
//! and tool calls, dispatch each tool, append the results, and repeat until the model
//! stops calling tools — emitting [telemetry](crate::telemetry) throughout.
//!
//! # Phase 0 status
//!
//! Phase 0 wires the [client](crate::client) and the [message
//! abstraction](crate::model) into a minimal, **offline** turn loop. It resolves the
//! run's `primary` slot to a concrete [`ModelClient`]; when
//! that resolves to the scripted [`MockClient`](crate::client::MockClient) it drives a
//! real (if minimal) loop against it, emitting the live telemetry the console renders
//! (`TurnStarted`, `AssistantMessage`, `ToolCall`, `Usage`). Tool **dispatch** is not
//! implemented yet (the [toolset](crate::tools) is still a stub), so a called tool is
//! recorded and answered with a placeholder result rather than executed. For a live
//! (OpenRouter) binding the loop resolves the client and defers the networked turn
//! loop to the next stage rather than making a real call from the skeleton.
//!
//! TODO(gg-integration): dispatch tool calls through [`crate::tools`] and drive live
//! providers; honor the enabled capabilities when assembling the toolset; account
//! usage/cost per model-slot.

use serde_json::json;
use test_cabinet_core::gg::{GgSlotBinding, GgTelemetryKind, PRIMARY_SLOT};
use test_cabinet_core::metrics::TokenCounts;

use crate::client::{client_for_slot, provider_for};
use crate::config::GgInvocation;
use crate::model::{Message, ModelClient, ModelResponse, ToolDefinition};
use crate::telemetry::Emitter;

/// A ceiling on turns for the Phase 0 offline loop, so a misbehaving script can never
/// spin forever.
const MAX_TURNS: usize = 16;

/// The system prompt seeding the Phase 0 loop.
const GG_SYSTEM_PROMPT: &str = "You are gg, The Test Cabinet's coding agent. Build the \
    requested game in the current workspace using the provided tools, then stop.";

/// Run one gg session for `invocation`, emitting telemetry throughout.
///
/// Resolves the `primary` slot to a client and, when that client is offline (the
/// scripted mock), drives a minimal turn loop against it; a live binding is resolved
/// and deferred (see the [module docs](self)). All outcomes — success, a
/// misconfigured slot, or a model error — are reported as telemetry and end with a
/// `SessionEnded`; this function never fails the process (a model error is a run
/// outcome, not a launch failure).
pub async fn run(invocation: &GgInvocation, emitter: &Emitter) {
    emitter.emit(GgTelemetryKind::SessionStarted {});

    let Some(binding) = invocation
        .capability_set
        .slots
        .iter()
        .find(|binding| binding.slot == PRIMARY_SLOT)
    else {
        emitter.emit(log(
            "error",
            "no `primary` model slot is bound; nothing to run.",
        ));
        emitter.emit(session_ended("misconfigured"));
        return;
    };

    let client = match client_for_slot(binding) {
        Ok(client) => client,
        Err(err) => {
            emitter.emit(log(
                "error",
                format!(
                    "could not resolve the `primary` slot (model `{}`): {err}",
                    binding.model_id
                ),
            ));
            emitter.emit(session_ended("error"));
            return;
        }
    };

    emitter.emit(log(
        "info",
        format!(
            "primary slot resolved to model `{}` ({} provider).",
            client.model_id(),
            provider_label(binding),
        ),
    ));

    // Only drive offline (mock) clients from the Phase 0 loop; the networked turn loop
    // over live providers lands in the next stage.
    if !provider_for(binding).is_offline() {
        emitter.emit(log(
            "info",
            "live provider resolved; the networked turn loop lands in the next stage.",
        ));
        emitter.emit(session_ended("resolved"));
        return;
    }

    let status = drive(client.as_ref(), &invocation.prompt, emitter).await;
    emitter.emit(session_ended(status));
}

/// Drive the offline turn loop to completion, returning the `SessionEnded` status.
async fn drive(client: &dyn ModelClient, prompt: &str, emitter: &Emitter) -> &'static str {
    let tools = phase0_tools();
    let mut conversation = vec![Message::system(GG_SYSTEM_PROMPT), Message::user(prompt)];

    for _turn in 0..MAX_TURNS {
        emitter.emit(GgTelemetryKind::TurnStarted {});

        let response = match client.complete(&conversation, &tools).await {
            Ok(response) => response,
            Err(err) => {
                emitter.emit(log(
                    if err.is_retryable_exhausted() {
                        "warn"
                    } else {
                        "error"
                    },
                    format!("model turn failed ({err})."),
                ));
                return "error";
            }
        };

        record_usage(&response, emitter);
        if let Some(text) = &response.text {
            emitter.emit(GgTelemetryKind::AssistantMessage { text: text.clone() });
        }

        // Record the assistant turn (text + any tool calls) into the conversation.
        conversation.push(Message::assistant(
            response.text.clone(),
            response.tool_calls.clone(),
        ));

        if response.tool_calls.is_empty() {
            return "completed";
        }

        // Phase 0: tool dispatch is not implemented, so each requested call is
        // reported and answered with a placeholder result to keep the loop honest and
        // let the scripted model proceed to its next turn.
        for call in &response.tool_calls {
            emitter.emit(GgTelemetryKind::ToolCall {
                name: call.name.clone(),
                args: call.arguments.clone(),
            });
            let result = format!(
                "(tool `{}` not executed in Phase 0; dispatch lands in the next stage)",
                call.name
            );
            emitter.emit(GgTelemetryKind::ToolResult {
                name: call.name.clone(),
                ok: false,
                summary: Some("not executed in Phase 0".to_string()),
            });
            conversation.push(Message::tool_result(&call.id, result));
        }
    }

    emitter.emit(log(
        "warn",
        format!("reached the {MAX_TURNS}-turn Phase 0 ceiling without finishing."),
    ));
    "incomplete"
}

/// Emit a `Usage` event for a turn's accounting when it reported any tokens.
fn record_usage(response: &ModelResponse, emitter: &Emitter) {
    if response.usage == TokenCounts::default() && response.cost.is_none() {
        return;
    }
    emitter.emit(GgTelemetryKind::Usage {
        tokens: response.usage,
        cost: response.cost,
    });
}

/// The single hand-written tool the Phase 0 loop advertises to the model. The real
/// toolset — assembled from the enabled capabilities — lands with tool dispatch in
/// [`crate::tools`]; here we offer just the `write_file` schema the scripted mock
/// calls, so the request is well-formed.
fn phase0_tools() -> Vec<ToolDefinition> {
    vec![ToolDefinition::new(
        "write_file",
        "Write UTF-8 text to a file in the workspace, creating it if needed.",
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Workspace-relative path." },
                "contents": { "type": "string", "description": "The file's full contents." }
            },
            "required": ["path", "contents"],
            "additionalProperties": false
        }),
    )]
}

/// A human-readable provider label for a binding, for the resolution log line.
fn provider_label(binding: &GgSlotBinding) -> &'static str {
    if provider_for(binding).is_offline() {
        "mock"
    } else {
        "openrouter"
    }
}

/// A `Log` telemetry event.
fn log(level: &str, message: impl Into<String>) -> GgTelemetryKind {
    GgTelemetryKind::Log {
        level: level.to_string(),
        message: message.into(),
    }
}

/// A `SessionEnded` telemetry event with the given status.
fn session_ended(status: impl Into<String>) -> GgTelemetryKind {
    GgTelemetryKind::SessionEnded {
        status: status.into(),
    }
}
