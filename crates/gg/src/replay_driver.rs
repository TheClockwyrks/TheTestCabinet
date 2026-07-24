//! The gg **replay driver**: re-running a session from its
//! [replay record](test_cabinet_core::gg::GgReplayRecord) so it reconstructs
//! [exactly](https://docs.testcabinet.ai/gg/replay/), deterministically, with **no live model and
//! no real tools**.
//!
//! Replay capture (`crate::replay`) pins a run's two non-deterministic inputs — each agent's model
//! I/O and every tool result — into a record. This driver plays that record back: it replaces the
//! live model with a [`ReplayClient`] (which returns an agent's recorded responses in order) and
//! tool dispatch with a [`ReplayInvoker`] (which returns the recorded outcomes instead of executing
//! anything), then walks the run turn by turn, re-emitting the telemetry the run
//! produced and yielding the per-agent [step-through](test_cabinet_core::gg::GgReplayStep) list a
//! developer walks.
//!
//! # Why a dedicated walk, not the production orchestrator
//!
//! The record pins exactly what a faithful re-run needs, and the interleaving of concurrent agents
//! is recoverable by ordering the entries on their globally-monotonic
//! [`seq`](test_cabinet_core::gg::GgReplayEntry::seq). Re-invoking the real
//! orchestrator (`crate::agent`) would instead drive the scheduler, git, and worktree machinery for
//! real — spawning child tasks, adding/merging worktrees — which is precisely the *side-effecting,
//! non-deterministic* behavior replay exists to avoid. So the driver reconstructs the run from the
//! record directly: it drives each agent's turn loop through the replay seams, reproducing the same
//! per-turn telemetry the real loop emits ([`TurnStarted`](test_cabinet_core::gg::GgTelemetryKind::TurnStarted),
//! usage, the assistant message, and each tool call's [`ToolCall`](test_cabinet_core::gg::GgTelemetryKind::ToolCall)
//! /[`ToolResult`](test_cabinet_core::gg::GgTelemetryKind::ToolResult) pair) and interleaving the
//! agents in recorded `seq` order.
//!
//! # Completeness is proven, not guessed
//!
//! The whole point of replay is to expose a surprising outcome, so the driver never *guesses* a
//! missing input. It tracks each agent's open turn: if a turn's model response requested a tool call
//! for which the record holds no outcome (the capture was truncated or incomplete), or a recorded
//! tool result has no model turn that called it, the reconstruction stops with a precise
//! [`ReplayError`] naming the agent, the `seq`, and the tool — the exact gap the record failed to
//! pin. A record that reconstructs without error is *provably complete* for the run it captured.

use std::collections::HashMap;
use std::collections::VecDeque;
use std::sync::Mutex;

use serde_json::Value;
use test_cabinet_core::gg::{
    GgReplayEntry, GgReplayEntryKind, GgReplayRecord, GgReplayStep, GgReplayToolStep,
    GgTelemetryKind,
};
use test_cabinet_core::metrics::TokenCounts;

use crate::model::{Message, ModelClient, ModelError, ModelResponse, ToolCall, ToolDefinition};
use crate::telemetry::{Emitter, EventSink, StdoutSink};
use crate::tools::ToolOutcome;

/// A divergence found while reconstructing a run from its [replay record](GgReplayRecord) — the gap
/// replay exists to expose.
///
/// Every variant means the record is **not** a faithful, complete capture of the run: an input a
/// turn needed was not pinned, or the pinned inputs do not line up with the turn structure. Rather
/// than silently guess, the driver stops and reports exactly which agent, turn, and tool the
/// reconstruction diverged at.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ReplayError {
    /// A turn's model response requested a tool call for which the record holds **no** outcome — the
    /// capture is incomplete (truncated mid-turn, or a tool result was never recorded).
    #[error(
        "replay gap: agent `{agent_id}` turn (seq {seq}) called `{tool}` (id `{call_id}`) but the \
         record has no recorded outcome for it — the capture is incomplete"
    )]
    MissingToolResult {
        /// The agent whose turn is missing an outcome.
        agent_id: String,
        /// The `seq` of that turn's model call.
        seq: u64,
        /// The name of the tool whose outcome is missing.
        tool: String,
        /// The id of the unanswered tool call.
        call_id: String,
    },

    /// A recorded tool result exists for an agent that has **no open model turn** — the record is
    /// missing the model call that would have requested it.
    #[error(
        "replay divergence: agent `{agent_id}` (seq {seq}) has a recorded result for `{tool}` with \
         no open model turn — the record is missing the model call that requested it"
    )]
    ToolResultWithoutTurn {
        /// The agent the orphan result is tagged with.
        agent_id: String,
        /// The `seq` of the orphan tool-result entry.
        seq: u64,
        /// The tool the orphan result is for.
        tool: String,
    },

    /// An agent recorded **more** tool results in a turn than its model response requested calls.
    #[error(
        "replay divergence: agent `{agent_id}` (seq {seq}) recorded more tool results (`{tool}`) \
         than its turn requested calls"
    )]
    ExtraToolResult {
        /// The agent the surplus result is tagged with.
        agent_id: String,
        /// The `seq` of the surplus tool-result entry.
        seq: u64,
        /// The tool the surplus result is for.
        tool: String,
    },

    /// A recorded tool result does not match the call the model made at that point in the turn — the
    /// record's tool results are misaligned with its model I/O.
    #[error(
        "replay divergence: agent `{agent_id}` (seq {seq}) recorded a result for `{recorded}` but \
         the model called `{expected}` at this point"
    )]
    ToolResultMismatch {
        /// The agent whose turn diverged.
        agent_id: String,
        /// The `seq` of the mismatched tool-result entry.
        seq: u64,
        /// The tool call the model actually made next.
        expected: String,
        /// The tool the recorded result claims to answer.
        recorded: String,
    },

    /// The record scheduled a model turn for an agent but held no recorded response for it (the
    /// model-I/O queue underflowed) — a structurally broken record.
    #[error(
        "replay: agent `{agent_id}` (seq {seq}) has no recorded model response for a turn the \
         record scheduled"
    )]
    MissingModelResponse {
        /// The agent whose model response is missing.
        agent_id: String,
        /// The `seq` of the model-I/O entry that could not be replayed.
        seq: u64,
    },

    /// A record entry's payload did not deserialize into the gg type a replay feeds the loop.
    #[error("replay: agent `{agent_id}` entry (seq {seq}) is malformed: {detail}")]
    MalformedEntry {
        /// The agent the malformed entry is tagged with.
        agent_id: String,
        /// The `seq` of the malformed entry.
        seq: u64,
        /// What failed to parse.
        detail: String,
    },
}

/// The **model seam** of the replay: a `ModelClient` that returns an agent's recorded responses in
/// order, in place of a live model.
///
/// It is a genuine `ModelClient` — a drop-in replacement for the credentialed client the run used
/// — so the reconstruction feeds each turn its recorded response exactly where the real loop would
/// have called the model. The driver pops responses directly (the walk is synchronous); the
/// `ModelClient` impl exists so the seam is a true client and its underflow behavior is explicit.
pub struct ReplayClient {
    /// The agent's recorded responses, in `seq` order, consumed one per turn.
    responses: Mutex<VecDeque<ModelResponse>>,
}

impl ReplayClient {
    /// A client that will replay `responses` (an agent's recorded turns, in order).
    fn new(responses: Vec<ModelResponse>) -> Self {
        Self {
            responses: Mutex::new(responses.into()),
        }
    }

    /// Take the next recorded response for this agent, or `None` once the record is exhausted.
    fn pop(&self) -> Option<ModelResponse> {
        self.responses
            .lock()
            .expect("replay client lock")
            .pop_front()
    }
}

#[async_trait::async_trait]
impl ModelClient for ReplayClient {
    async fn complete(
        &self,
        _messages: &[Message],
        _tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        // A replay ignores the live conversation: the response is whatever the run recorded for this
        // turn. Underflow means the record scheduled more turns than it captured responses for.
        self.pop().ok_or_else(|| {
            ModelError::Parse("replay: no recorded response remains for this agent".to_string())
        })
    }

    fn model_id(&self) -> &str {
        "replay"
    }
}

/// The **tool seam** of the replay: returns an agent's recorded tool `(call, outcome)` pairs in
/// order, in place of dispatching (and running) a real tool.
///
/// Where the real loop dispatched a call against the workspace, the reconstruction pulls the exact
/// outcome the run recorded — so a filesystem or shell result is reproduced, never re-executed. The
/// paired `call` lets the driver verify the record's tool results line up with the model calls that
/// requested them.
pub struct ReplayInvoker {
    /// The agent's recorded `(call, outcome)` pairs, in `seq` order, consumed as the turn's calls are
    /// serviced.
    results: Mutex<VecDeque<(ToolCall, ToolOutcome)>>,
}

impl ReplayInvoker {
    /// An invoker that will replay `results` (an agent's recorded tool calls + outcomes, in order).
    fn new(results: Vec<(ToolCall, ToolOutcome)>) -> Self {
        Self {
            results: Mutex::new(results.into()),
        }
    }

    /// Take the next recorded `(call, outcome)` for this agent, or `None` once the record is
    /// exhausted.
    fn next(&self) -> Option<(ToolCall, ToolOutcome)> {
        self.results
            .lock()
            .expect("replay invoker lock")
            .pop_front()
    }
}

/// The result of [reconstructing](reconstruct) a run from its replay record.
///
/// Carries the ordered, per-agent [step-through](GgReplayStep) list the UI consumes, alongside a few
/// totals for the debug entrypoint's summary line.
#[derive(Debug, Clone, PartialEq)]
pub struct ReplayReconstruction {
    /// The session id of the reconstructed run (the record's).
    pub session_id: String,
    /// The reconstructed steps, in global `seq` order across the whole agent tree — the same
    /// derivation [`GgReplayRecord::steps`] produces, but driven through the replay seams and
    /// validated for completeness.
    pub steps: Vec<GgReplayStep>,
    /// How many distinct agents the run's record spans.
    pub agent_count: usize,
    /// How many model turns were replayed across all agents.
    pub model_calls: usize,
    /// How many tool results were replayed across all agents.
    pub tool_calls: usize,
}

/// An agent's live reconstruction state during the [walk](reconstruct_with_sink).
struct AgentReplay {
    /// The agent-scoped emitter its reconstructed telemetry streams on.
    emitter: Emitter,
    /// The model seam feeding this agent its recorded responses.
    client: ReplayClient,
    /// The tool seam feeding this agent its recorded outcomes.
    invoker: ReplayInvoker,
    /// The turn currently awaiting tool results, if any.
    pending: Option<PendingTurn>,
}

/// A model turn whose tool calls are being matched to their recorded outcomes.
struct PendingTurn {
    /// The index (in the produced step list) of the step this turn opened.
    step_index: usize,
    /// The `seq` of the turn's model call — for a precise gap error if a call goes unanswered.
    seq: u64,
    /// The calls the response requested that have not yet been matched to a recorded outcome, in
    /// order.
    remaining: VecDeque<ToolCall>,
}

/// Reconstruct a run from its [replay record](GgReplayRecord), streaming the reconstructed telemetry
/// to **stdout** (the same NDJSON channel a live gg run emits on).
///
/// Returns the per-agent [step-through](GgReplayStep) list on success, or the precise
/// [`ReplayError`] the reconstruction diverged at — the gap the record failed to pin. The
/// reconstruction is fully deterministic: the same record always produces the same steps and the
/// same telemetry (modulo the emitter's wall-clock timestamps), with no live model or tool calls.
pub fn reconstruct(record: &GgReplayRecord) -> Result<ReplayReconstruction, ReplayError> {
    reconstruct_with_sink(record, Box::new(StdoutSink))
}

/// [`reconstruct`], but writing the reconstructed telemetry to an arbitrary `sink` — so a test can
/// capture the exact stream the reconstruction re-emits.
pub(crate) fn reconstruct_with_sink(
    record: &GgReplayRecord,
    sink: Box<dyn EventSink>,
) -> Result<ReplayReconstruction, ReplayError> {
    let base = Emitter::with_sink(Some(record.session_id.clone()), sink);

    // The entries in true recording order — sorting on the globally-monotonic `seq` recovers the
    // exact interleaving of concurrently-running agents.
    let mut order: Vec<&GgReplayEntry> = record.entries.iter().collect();
    order.sort_by_key(|entry| entry.seq);

    // Pre-pass: build each agent's replay seams (parsing the pinned payloads into the gg types a
    // replay feeds the loop), so a malformed entry is reported before any telemetry is emitted.
    let mut responses: HashMap<String, Vec<ModelResponse>> = HashMap::new();
    let mut results: HashMap<String, Vec<(ToolCall, ToolOutcome)>> = HashMap::new();
    let mut agent_order: Vec<String> = Vec::new();
    for entry in &order {
        if !responses.contains_key(&entry.agent_id) {
            agent_order.push(entry.agent_id.clone());
            responses.insert(entry.agent_id.clone(), Vec::new());
            results.insert(entry.agent_id.clone(), Vec::new());
        }
        match &entry.kind {
            GgReplayEntryKind::ModelIo { response, .. } => {
                let parsed = parse::<ModelResponse>(entry, response, "model response")?;
                responses
                    .get_mut(&entry.agent_id)
                    .expect("agent bucket")
                    .push(parsed);
            }
            GgReplayEntryKind::ToolResult { call, outcome } => {
                let call = parse::<ToolCall>(entry, call, "tool call")?;
                let outcome = parse::<ToolOutcome>(entry, outcome, "tool outcome")?;
                results
                    .get_mut(&entry.agent_id)
                    .expect("agent bucket")
                    .push((call, outcome));
            }
        }
    }

    let mut states: HashMap<String, AgentReplay> = HashMap::new();
    for agent_id in &agent_order {
        states.insert(
            agent_id.clone(),
            AgentReplay {
                emitter: base.for_agent(agent_id.clone(), None),
                client: ReplayClient::new(responses.remove(agent_id).unwrap_or_default()),
                invoker: ReplayInvoker::new(results.remove(agent_id).unwrap_or_default()),
                pending: None,
            },
        );
    }

    base.emit(GgTelemetryKind::Log {
        level: "info".to_string(),
        message: format!(
            "replay: reconstructing session `{}` — {} agent(s), {} recorded input(s).",
            record.session_id,
            agent_order.len(),
            order.len(),
        ),
    });

    // Walk the entries in `seq` order, driving each agent's turn through its replay seams and
    // re-emitting the per-turn telemetry the real loop produced.
    let mut steps: Vec<GgReplayStep> = Vec::new();
    let mut model_calls = 0usize;
    let mut tool_calls = 0usize;
    for entry in &order {
        let state = states.get_mut(&entry.agent_id).expect("agent state");
        match &entry.kind {
            GgReplayEntryKind::ModelIo { request, .. } => {
                // A new model turn must not open while the previous one still has calls awaiting a
                // recorded outcome — that would be a truncated capture.
                if let Some(pending) = &state.pending
                    && let Some(next) = pending.remaining.front()
                {
                    return Err(ReplayError::MissingToolResult {
                        agent_id: entry.agent_id.clone(),
                        seq: pending.seq,
                        tool: next.name.clone(),
                        call_id: next.id.clone(),
                    });
                }

                // Pull this turn's response from the model seam (in place of a live model call).
                let response =
                    state
                        .client
                        .pop()
                        .ok_or_else(|| ReplayError::MissingModelResponse {
                            agent_id: entry.agent_id.clone(),
                            seq: entry.seq,
                        })?;

                // Re-emit exactly what the real loop emits at a turn: the turn marker, usage (under
                // the same "unreported is silent" guard), and the assistant message when present.
                state.emitter.emit(GgTelemetryKind::TurnStarted {});
                emit_usage(&response, &state.emitter);
                if let Some(text) = &response.text {
                    state
                        .emitter
                        .emit(GgTelemetryKind::AssistantMessage { text: text.clone() });
                }

                // Open this turn's step: what the agent saw (the recorded request) and did (the
                // response, re-serialized from the seam so `did` flows through the model seam).
                let step_index = steps.len();
                steps.push(GgReplayStep {
                    agent_id: entry.agent_id.clone(),
                    seq: entry.seq,
                    saw: request.clone(),
                    did: serde_json::to_value(&response).unwrap_or(Value::Null),
                    tool_results: Vec::new(),
                });
                state.pending = Some(PendingTurn {
                    step_index,
                    seq: entry.seq,
                    remaining: response.tool_calls.iter().cloned().collect(),
                });
                model_calls += 1;
            }
            GgReplayEntryKind::ToolResult { .. } => {
                // Pull the recorded call + outcome from the tool seam (in place of dispatching).
                let (call, outcome) = state.invoker.next().ok_or_else(|| {
                    // The seam was built from exactly these entries, so this is unreachable in
                    // practice; report it as a structural gap rather than panic.
                    ReplayError::ToolResultWithoutTurn {
                        agent_id: entry.agent_id.clone(),
                        seq: entry.seq,
                        tool: "<unknown>".to_string(),
                    }
                })?;

                let Some(pending) = state.pending.as_mut() else {
                    return Err(ReplayError::ToolResultWithoutTurn {
                        agent_id: entry.agent_id.clone(),
                        seq: entry.seq,
                        tool: call.name.clone(),
                    });
                };
                let Some(expected) = pending.remaining.pop_front() else {
                    return Err(ReplayError::ExtraToolResult {
                        agent_id: entry.agent_id.clone(),
                        seq: entry.seq,
                        tool: call.name.clone(),
                    });
                };
                if expected.id != call.id || expected.name != call.name {
                    return Err(ReplayError::ToolResultMismatch {
                        agent_id: entry.agent_id.clone(),
                        seq: entry.seq,
                        expected: expected.name,
                        recorded: call.name,
                    });
                }

                // Re-emit the call/result pair the real loop streamed for this dispatch.
                state.emitter.emit(GgTelemetryKind::ToolCall {
                    name: call.name.clone(),
                    args: call.arguments.clone(),
                });
                state.emitter.emit(GgTelemetryKind::ToolResult {
                    name: call.name.clone(),
                    ok: outcome.ok,
                    summary: outcome.summary.clone(),
                });
                steps[pending.step_index]
                    .tool_results
                    .push(GgReplayToolStep {
                        call: serde_json::to_value(&call).unwrap_or(Value::Null),
                        outcome: serde_json::to_value(&outcome).unwrap_or(Value::Null),
                    });
                tool_calls += 1;
            }
        }
    }

    // Any turn still holding an unanswered call at the end of the record is a truncated capture.
    for agent_id in &agent_order {
        let state = states.get(agent_id).expect("agent state");
        if let Some(pending) = &state.pending
            && let Some(next) = pending.remaining.front()
        {
            return Err(ReplayError::MissingToolResult {
                agent_id: agent_id.clone(),
                seq: pending.seq,
                tool: next.name.clone(),
                call_id: next.id.clone(),
            });
        }
    }

    base.emit(GgTelemetryKind::Log {
        level: "info".to_string(),
        message: format!(
            "replay: reconstructed {} step(s) — {} model turn(s), {} tool result(s) — across {} \
             agent(s).",
            steps.len(),
            model_calls,
            tool_calls,
            agent_order.len(),
        ),
    });

    Ok(ReplayReconstruction {
        session_id: record.session_id.clone(),
        steps,
        agent_count: agent_order.len(),
        model_calls,
        tool_calls,
    })
}

/// Deserialize a record entry's JSON payload into the gg type `T` a replay feeds the loop, turning a
/// parse failure into a located [`ReplayError::MalformedEntry`].
fn parse<T: serde::de::DeserializeOwned>(
    entry: &GgReplayEntry,
    value: &Value,
    what: &str,
) -> Result<T, ReplayError> {
    serde_json::from_value(value.clone()).map_err(|err| ReplayError::MalformedEntry {
        agent_id: entry.agent_id.clone(),
        seq: entry.seq,
        detail: format!("{what}: {err}"),
    })
}

/// Emit a turn's [`Usage`](GgTelemetryKind::Usage) under the same guard the real loop uses — silent
/// when nothing was reported (usage is default and no cost), so the reconstructed stream matches the
/// original turn for turn.
fn emit_usage(response: &ModelResponse, emitter: &Emitter) {
    if response.usage == TokenCounts::default() && response.cost.is_none() {
        return;
    }
    emitter.emit(GgTelemetryKind::Usage {
        tokens: response.usage,
        cost: response.cost,
    });
}

#[cfg(test)]
#[path = "replay_driver.test.rs"]
mod tests;
