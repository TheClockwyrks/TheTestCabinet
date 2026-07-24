//! The gg **agent turn loop**.
//!
//! This is gg's core — the one coarse-grained plug point of the design (all other
//! modularity comes from [which tools](crate::tools) are offered). The loop runs one
//! logical session: build a model request from the conversation and the offered
//! toolset, send it via the [client](crate::client), record the assistant's message
//! and tool calls, dispatch each tool, append the results, and repeat until the model
//! stops calling tools — emitting [telemetry](crate::telemetry) throughout.
//!
//! # Control flow
//!
//! [`run`] frames one session:
//!
//! 1. emit [`SessionStarted`](GgTelemetryKind::SessionStarted);
//! 2. resolve the [`primary`](PRIMARY_SLOT) slot to a concrete
//!    [`ModelClient`] (mock or OpenRouter). A missing slot
//!    or an unresolvable client is a **launch failure**: it emits a
//!    [`Log`](GgTelemetryKind::Log)`(error)` and
//!    [`SessionEnded`](GgTelemetryKind::SessionEnded)`{status:"error"}` and returns
//!    [`SessionOutcome::LaunchFailed`] so the process exits non-zero;
//! 3. assemble the offered [toolset](ToolRegistry) from the run's enabled
//!    capabilities and drive the [turn loop](drive) against the client;
//! 4. emit a summary [`Log`](GgTelemetryKind::Log) and the terminal
//!    [`SessionEnded`](GgTelemetryKind::SessionEnded).
//!
//! Each turn the loop emits [`TurnStarted`](GgTelemetryKind::TurnStarted), calls the
//! model, emits [`Usage`](GgTelemetryKind::Usage) and (when present)
//! [`AssistantMessage`](GgTelemetryKind::AssistantMessage), then for every requested
//! tool emits [`ToolCall`](GgTelemetryKind::ToolCall), dispatches it, and emits
//! [`ToolResult`](GgTelemetryKind::ToolResult). A turn with no tool calls ends the
//! session ([`"completed"`](drive)).
//!
//! # Termination and error surfacing
//!
//! The loop always ends, and always says how in the
//! [`SessionEnded`](GgTelemetryKind::SessionEnded) status:
//!
//! - `"completed"` — the model stopped calling tools;
//! - `"exhausted"` — the per-run turn ceiling was reached;
//! - `"timed_out"` — the optional wall-clock deadline was passed;
//! - `"model_error"` — a model turn failed (retryable-exhausted **or** fatal). gg
//!   ends the session **loudly** — a `Log(error)` plus this status — never silently:
//!   a known failure mode of another harness is discarding a whole run on one API
//!   error, and gg's whole point is that the failure is visible in the stream;
//! - `"error"` — a launch failure (no bound slot, or the client could not resolve).
//!
//! Only a launch failure (`"error"`) exits the process non-zero; a session that ran
//! and ended for any other reason is a *run outcome* recorded in the telemetry, not a
//! process failure, and exits `0`.

use std::time::{Duration, Instant};

use serde_json::Value;
use test_cabinet_core::gg::{GgCapabilitySet, GgSlotBinding, GgTelemetryKind, PRIMARY_SLOT};
use test_cabinet_core::metrics::{Cost, TokenCounts};

use crate::client::{client_for_slot, provider_for};
use crate::config::GgInvocation;
use crate::model::{Message, ModelClient, ModelResponse};
use crate::telemetry::Emitter;
use crate::tools::{ToolContext, ToolRegistry};

/// The default per-run turn ceiling, used when no `maxTurns` capability param sets
/// one. Bounds a runaway loop so a session always terminates cleanly.
const DEFAULT_MAX_TURNS: usize = 50;

/// Capability param naming the per-run turn ceiling (read from any capability that
/// carries it). A value of `0` or a non-integer is ignored in favor of the default.
const PARAM_MAX_TURNS: &str = "maxTurns";

/// Capability param naming a self-imposed wall-clock budget in seconds. gg is also
/// wrapped in an external runtime cap by `core`; this is a belt-and-suspenders bound
/// so a runaway loop ends with `"timed_out"` rather than being killed from outside.
const PARAM_MAX_RUNTIME_SECS: &str = "maxRuntimeSecs";

/// The base system prompt seeding the loop. The available tools are appended per run
/// (see [`system_prompt`]) so the prompt reflects the enabled capabilities.
const GG_SYSTEM_PROMPT_BASE: &str = "You are gg, The Test Cabinet's autonomous coding agent. \
    You are building a game in the current workspace directory. Work incrementally: inspect \
    the workspace, then create and edit files to implement the game the user describes. When \
    the game is complete and the task is done, stop calling tools and give a short final \
    summary of what you built.";

/// Whether one gg session launched at all.
///
/// This is the only thing the process exit code reflects: a session that *ran* — no
/// matter how it ended (completed, model error, exhausted, timed out) — is a success
/// at the process level, with the real outcome carried in the telemetry stream. Only
/// a [`LaunchFailed`](Self::LaunchFailed) (no model to run) exits non-zero.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionOutcome {
    /// A session was driven to a [`SessionEnded`](GgTelemetryKind::SessionEnded). The
    /// process exits `0`; the session's status is in the telemetry.
    Ran,
    /// The invocation could not launch a session (no bound `primary` slot, or the
    /// client could not be resolved — for example a missing credential). The process
    /// exits non-zero.
    LaunchFailed,
}

/// Run one gg session for `invocation`, emitting telemetry throughout, and report
/// whether it launched.
///
/// All outcomes — success, a misconfigured slot, a model error, or hitting a bound —
/// are reported as telemetry and end with a
/// [`SessionEnded`](GgTelemetryKind::SessionEnded). The function itself never panics;
/// a model error is a *run* outcome, not a launch failure (see [`SessionOutcome`]).
pub async fn run(invocation: &GgInvocation, emitter: &Emitter) -> SessionOutcome {
    emitter.emit(GgTelemetryKind::SessionStarted {});

    let Some(binding) = invocation
        .capability_set
        .slots
        .iter()
        .find(|binding| binding.slot == PRIMARY_SLOT)
    else {
        emitter.emit(log(
            "error",
            "no `primary` model slot is bound; there is no model to run.",
        ));
        emitter.emit(session_ended("error"));
        return SessionOutcome::LaunchFailed;
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
            return SessionOutcome::LaunchFailed;
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

    // Resolve the loop bounds and the optional wall-clock deadline. `core` also caps
    // the run externally; the deadline is a self-imposed bound so a runaway loop ends
    // cleanly on its own.
    let bounds = resolve_bounds(&invocation.capability_set);
    let deadline = bounds
        .max_runtime_secs
        .map(|secs| Instant::now() + Duration::from_secs(secs));

    let end = drive(
        client.as_ref(),
        &invocation.prompt,
        &registry,
        &context,
        emitter,
        bounds.max_turns,
        deadline,
    )
    .await;

    emitter.emit(log("info", end.summary()));
    emitter.emit(session_ended(end.status));
    SessionOutcome::Ran
}

/// How a driven turn loop ended, plus the usage it accumulated.
struct LoopEnd {
    /// The terminal [`SessionEnded`](GgTelemetryKind::SessionEnded) status.
    status: &'static str,
    /// Turns actually executed (model calls made).
    turns: usize,
    /// Running total of token usage across the session.
    tokens: TokenCounts,
    /// Running total of cost across the session, when any turn reported one.
    cost: Option<Cost>,
}

impl LoopEnd {
    /// A human-readable one-line summary of the session for a closing `Log` event.
    /// (Emitted as a log, not a second [`Usage`](GgTelemetryKind::Usage): per-turn
    /// `Usage` events are incremental deltas that consumers sum, so a total `Usage`
    /// would double-count.)
    fn summary(&self) -> String {
        let tokens = self
            .tokens
            .total()
            .map(|n| n.to_string())
            .unwrap_or_else(|| "unknown".to_string());
        let cost = match self.cost.and_then(|c| c.comparable) {
            Some(cost) => format!(", ${cost:.4} cost"),
            None => String::new(),
        };
        format!(
            "session ended ({}) after {} turn(s); {tokens} total tokens{cost}.",
            self.status, self.turns
        )
    }
}

/// Drive the turn loop to completion, returning how it ended and the usage it
/// accrued.
///
/// Each turn the offered [`registry`](ToolRegistry) definitions are handed to the
/// model; any tool calls the turn returns are dispatched against `context` and their
/// results fed back on the next turn, until the model stops calling tools, a bound is
/// hit, or a turn errors. A `deadline` (when set) ends the loop with `"timed_out"` at
/// the next turn boundary once passed.
#[allow(clippy::too_many_arguments)]
async fn drive(
    client: &dyn ModelClient,
    prompt: &str,
    registry: &ToolRegistry,
    context: &ToolContext,
    emitter: &Emitter,
    max_turns: usize,
    deadline: Option<Instant>,
) -> LoopEnd {
    let tools = registry.definitions();
    let mut conversation = vec![
        Message::system(system_prompt(registry)),
        Message::user(prompt),
    ];
    let mut total_tokens = TokenCounts::default();
    let mut total_cost: Option<Cost> = None;

    for turn in 0..max_turns {
        // Stop cleanly at a turn boundary once the self-imposed budget is spent.
        if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            emitter.emit(log(
                "warn",
                format!("wall-clock budget exceeded after {turn} turn(s); stopping."),
            ));
            return LoopEnd {
                status: "timed_out",
                turns: turn,
                tokens: total_tokens,
                cost: total_cost,
            };
        }

        emitter.emit(GgTelemetryKind::TurnStarted {});

        let response = match client.complete(&conversation, &tools).await {
            Ok(response) => response,
            Err(err) => {
                // Surface the failure loudly — a `Log(error)` and a `model_error`
                // session end — rather than discarding the run silently. A
                // retry-exhausted transient failure and a fatal one both end the
                // session here; the client has already exhausted its own retries, so
                // there is nothing left to retry at the turn level in Phase 0.
                let kind = if err.is_retryable_exhausted() {
                    "transient failure (retries exhausted)"
                } else {
                    "fatal error"
                };
                emitter.emit(log(
                    "error",
                    format!("model turn {turn} failed — {kind}: {err}"),
                ));
                return LoopEnd {
                    status: "model_error",
                    turns: turn,
                    tokens: total_tokens,
                    cost: total_cost,
                };
            }
        };

        record_usage(&response, emitter);
        total_tokens = add_counts(total_tokens, response.usage);
        total_cost = add_cost(total_cost, response.cost);

        if let Some(text) = &response.text {
            emitter.emit(GgTelemetryKind::AssistantMessage { text: text.clone() });
        }

        // Record the assistant turn (text + any tool calls) into the conversation.
        conversation.push(Message::assistant(
            response.text.clone(),
            response.tool_calls.clone(),
        ));

        if response.tool_calls.is_empty() {
            return LoopEnd {
                status: "completed",
                turns: turn + 1,
                tokens: total_tokens,
                cost: total_cost,
            };
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
        format!("reached the {max_turns}-turn ceiling without the model finishing."),
    ));
    LoopEnd {
        status: "exhausted",
        turns: max_turns,
        tokens: total_tokens,
        cost: total_cost,
    }
}

/// The resolved per-run loop bounds, read from the capability set's params.
struct LoopBounds {
    /// The turn ceiling.
    max_turns: usize,
    /// A self-imposed wall-clock budget in seconds, when configured.
    max_runtime_secs: Option<u64>,
}

/// Resolve the loop bounds from `set`'s capability params, falling back to the
/// defaults. `maxTurns`/`maxRuntimeSecs` may live on any capability; the first that
/// carries a positive integer wins. Pure, so the resolution is unit tested directly.
fn resolve_bounds(set: &GgCapabilitySet) -> LoopBounds {
    let max_turns = param_u64(set, PARAM_MAX_TURNS)
        .filter(|&n| n > 0)
        .map(|n| n as usize)
        .unwrap_or(DEFAULT_MAX_TURNS);
    let max_runtime_secs = param_u64(set, PARAM_MAX_RUNTIME_SECS).filter(|&n| n > 0);
    LoopBounds {
        max_turns,
        max_runtime_secs,
    }
}

/// The first positive-integer value of `key` found across any capability's params.
fn param_u64(set: &GgCapabilitySet, key: &str) -> Option<u64> {
    set.capabilities
        .iter()
        .find_map(|capability| capability.params.get(key).and_then(Value::as_u64))
}

/// The system prompt for a run, reflecting the tools the enabled capabilities offer
/// so the model is told exactly what it can do (and, when nothing is enabled, that it
/// can only reply in text).
fn system_prompt(registry: &ToolRegistry) -> String {
    let names: Vec<String> = registry
        .definitions()
        .into_iter()
        .map(|tool| tool.name)
        .collect();
    let tools = if names.is_empty() {
        "You have no tools available this run, so you can only reply in text.".to_string()
    } else {
        format!(
            "You have these tools available: {}. Use them to inspect the workspace and \
             build the game.",
            names.join(", ")
        )
    };
    format!("{GG_SYSTEM_PROMPT_BASE}\n\n{tools}")
}

/// Emit a [`Usage`](GgTelemetryKind::Usage) event for a turn when it reported any
/// tokens or cost.
fn record_usage(response: &ModelResponse, emitter: &Emitter) {
    if response.usage == TokenCounts::default() && response.cost.is_none() {
        return;
    }
    emitter.emit(GgTelemetryKind::Usage {
        tokens: response.usage,
        cost: response.cost,
    });
}

/// Add two [`TokenCounts`], summing each reported class and keeping a class `None`
/// only when it is unreported on both sides (matching the metrics contract's
/// "unreported is distinct from zero").
fn add_counts(acc: TokenCounts, delta: TokenCounts) -> TokenCounts {
    TokenCounts {
        uncached_input: add_opt_u64(acc.uncached_input, delta.uncached_input),
        cached_input: add_opt_u64(acc.cached_input, delta.cached_input),
        output: add_opt_u64(acc.output, delta.output),
        reasoning: add_opt_u64(acc.reasoning, delta.reasoning),
    }
}

/// Sum two optional token counts, treating an unreported side as zero but staying
/// `None` when both are unreported.
fn add_opt_u64(a: Option<u64>, b: Option<u64>) -> Option<u64> {
    match (a, b) {
        (None, None) => None,
        (a, b) => Some(a.unwrap_or(0) + b.unwrap_or(0)),
    }
}

/// Add two optional [`Cost`]s, summing the `comparable`/`actual` figures on the same
/// "unreported-is-not-zero" terms as [`add_counts`].
fn add_cost(acc: Option<Cost>, delta: Option<Cost>) -> Option<Cost> {
    match (acc, delta) {
        (None, other) | (other, None) => other,
        (Some(acc), Some(delta)) => Some(Cost {
            comparable: add_opt_f64(acc.comparable, delta.comparable),
            actual: add_opt_f64(acc.actual, delta.actual),
        }),
    }
}

/// Sum two optional costs, treating an unreported side as zero but staying `None`
/// when both are unreported.
fn add_opt_f64(a: Option<f64>, b: Option<f64>) -> Option<f64> {
    match (a, b) {
        (None, None) => None,
        (a, b) => Some(a.unwrap_or(0.0) + b.unwrap_or(0.0)),
    }
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

#[cfg(test)]
#[path = "agent.test.rs"]
mod tests;
