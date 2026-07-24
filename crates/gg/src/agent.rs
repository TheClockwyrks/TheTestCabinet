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
//! Phase 0 wires the [client](crate::client), the [message
//! abstraction](crate::model), and the capability-gated [toolset](crate::tools) into a
//! minimal, **offline** turn loop. It resolves the run's `primary` slot to a concrete
//! [`ModelClient`]; when that resolves to the scripted
//! [`MockClient`](crate::client::MockClient) it drives a real (if minimal) loop against
//! it, emitting the live telemetry the console renders (`TurnStarted`,
//! `AssistantMessage`, `ToolCall`, `ToolResult`, `Usage`). Tool calls are **dispatched
//! for real** through the [`ToolRegistry`] — the offered
//! toolset is assembled from the run's enabled capabilities, and each call executes on
//! the workspace and its result is fed back to the model. For a live (OpenRouter)
//! binding the loop resolves the client and defers the networked turn loop to the next
//! stage rather than making a real call from the skeleton.
//!
//! TODO(gg-integration): drive live providers through the same loop (not just the
//! mock) and account usage/cost per model-slot.

use test_cabinet_core::gg::{GgSlotBinding, GgTelemetryKind, PRIMARY_SLOT};
use test_cabinet_core::metrics::TokenCounts;

use crate::client::{client_for_slot, provider_for};
use crate::config::GgInvocation;
use crate::model::{Message, ModelClient, ModelResponse};
use crate::telemetry::Emitter;
use crate::tools::{ToolContext, ToolRegistry};

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

    // Assemble the offered toolset from the run's enabled capabilities (the basis for
    // toolset ablation) and root every tool at the seeded workspace.
    let registry = ToolRegistry::from_capabilities(&invocation.capability_set);
    let context = ToolContext::new(invocation.workspace_dir.clone());
    if registry.is_empty() {
        emitter.emit(log(
            "warn",
            "no capabilities are enabled; the model is offered no tools and can only \
             talk. Enable the shell/filesystem capabilities to let it build.",
        ));
    } else {
        emitter.emit(log(
            "info",
            format!(
                "offering {} tool(s) from the enabled capabilities.",
                registry.len()
            ),
        ));
    }

    let status = drive(
        client.as_ref(),
        &invocation.prompt,
        &registry,
        &context,
        emitter,
    )
    .await;
    emitter.emit(session_ended(status));
}

/// Drive the offline turn loop to completion, returning the `SessionEnded` status.
///
/// Each turn the offered [`registry`](ToolRegistry) definitions are handed to the
/// model; any tool calls the turn returns are dispatched against `context` and their
/// results fed back on the next turn, until the model stops calling tools.
async fn drive(
    client: &dyn ModelClient,
    prompt: &str,
    registry: &ToolRegistry,
    context: &ToolContext,
    emitter: &Emitter,
) -> &'static str {
    let tools = registry.definitions();
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

        // Dispatch each requested tool call against the workspace and feed the result
        // back so the model can proceed on its next turn.
        for call in &response.tool_calls {
            emitter.emit(GgTelemetryKind::ToolCall {
                name: call.name.clone(),
                args: call.arguments.clone(),
            });
            let outcome = registry.dispatch(call, context).await;
            emitter.emit(GgTelemetryKind::ToolResult {
                name: call.name.clone(),
                ok: outcome.ok,
                summary: outcome.summary.clone(),
            });
            conversation.push(Message::tool_result(&call.id, outcome.output));
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
