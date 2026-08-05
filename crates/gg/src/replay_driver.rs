//! The gg **replay driver**: re-running a session from its
//! [replay record](GgReplayRecord) so it reconstructs
//! [exactly](https://docs.testcabinet.ai/gg/replay/), deterministically, with **no live model and
//! no real tools**.
//!
//! Replay capture (`crate::replay`) pins a run's non-deterministic inputs — each agent's model I/O,
//! every tool result, gg's own subprocesses, the turn-boundary probes — into a record. This driver
//! plays that record back: it draws each agent's inputs from the
//! [shared index](crate::replay_inputs) instead of from a provider and a shell, then walks the run
//! turn by turn, re-emitting the telemetry the run produced and yielding the per-agent
//! [step-through](GgReplayStep) list a developer walks.
//!
//! # Why a dedicated walk, not the production orchestrator
//!
//! The record pins exactly what a faithful re-run needs, and the interleaving of concurrent agents
//! is recoverable by ordering the entries on their globally-monotonic
//! [`seq`](test_cabinet_core::gg_replay::GgReplayEntry::seq). Re-invoking the real
//! orchestrator (`crate::agent`) would instead drive the scheduler, git, and worktree machinery for
//! real — spawning child tasks, adding/merging worktrees — which is precisely the *side-effecting,
//! non-deterministic* behavior this passive reconstruction exists to avoid. So the driver
//! reconstructs the run from the record directly: it drives each agent's turn loop from the recorded
//! queues, reproducing the same per-turn telemetry the real loop emits
//! ([`TurnStarted`](GgTelemetryKind::TurnStarted), usage, the assistant message, and each tool
//! call's [`ToolCall`](GgTelemetryKind::ToolCall)/[`ToolResult`](GgTelemetryKind::ToolResult) pair)
//! and interleaving the agents in recorded `seq` order.
//!
//! That is also why the driver never [awaits its turn](crate::replay_inputs::ReplayInputs::await_turn):
//! it *is* the global order, walking one entry at a time. The barrier exists for a **driving**
//! playback, whose agents run concurrently on the real loop and must be constrained back into the
//! recorded interleaving.
//!
//! # Completeness is proven, not guessed
//!
//! The whole point of replay is to expose a surprising outcome, so the driver never *guesses* a
//! missing input. It tracks each agent's open turn: if a turn's model response requested a tool call
//! for which the record holds no outcome (the capture was truncated or incomplete), or a recorded
//! tool result has no model turn that called it, the reconstruction stops with a precise
//! [`ReplayError`] naming the agent, the `seq`, and the tool — the exact gap the record failed to
//! pin. A record that reconstructs without error is *provably complete* for the run it captured.
//!
//! # What a v1 record does here
//!
//! Nothing special, and deliberately: [`GgReplayRecord`] **upgrades** a v1 body to the v2 shape as
//! it deserializes, so the driver sees one format. A pre-v2 record simply carries none of the four
//! input categories v1 had no seam for — no model errors, no subprocesses, no probes — and
//! reconstructs from the two it does have.
//!
//! # A program's calls are attributed by their id prefix, not matched to a request
//!
//! [Responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) turns do not have the
//! one-to-one shape those checks assume. A code turn's model response requests **no** tool calls at
//! all — a model in code mode is offered no native tools, it writes a program instead —
//! yet the turn still dispatches every call that program composed, and the capture seam pins each of
//! them as its own tool result. Matched against the response's (empty) call list, every single one
//! would be reported as an [`ExtraToolResult`](ReplayError::ExtraToolResult), which is exactly what
//! a code-mode record did before this rule existed.
//!
//! So in a run the record's own [capability set](GgReplayRecord::capability_set) says was in code
//! mode, a recorded call whose id carries the sandbox's synthetic `program:{ordinal}:{tool}` prefix
//! is attributed to the open turn's *program*: it does not consume one of the turn's requested
//! calls, and it is not matched on `id` or `name`, because there is no requested call for it to
//! match. It is otherwise replayed identically — it still requires an open turn (a program only runs
//! inside one), still drives that turn's step entry, and still re-emits the same
//! `ToolCall`/`ToolResult` pair the run streamed.
//!
//! The relaxation is scoped to the *turn's shape*, never to the id alone. The completeness guarantee
//! is therefore untouched for every other run: a turn that requested calls must still see every one
//! of them answered, in order, by id and name, and a `program:` id arriving inside such a turn — a
//! shape no run can produce, since a turn either offers native tools or runs a program — is reported
//! as the divergence it is.
//!
//! # Why a code turn replays exactly
//!
//! Because the driver **reconstructs** it rather than re-running it: it walks the record and
//! re-emits the recorded `(call, outcome)` pairs the program composed, in recorded order. No
//! program is transpiled and no sandbox is instantiated here, so replay is exact for the same
//! reason the native path is — the record pins the answer to every non-deterministic question.

use std::collections::{BTreeMap, VecDeque};
use std::sync::Arc;

use serde_json::Value;
use test_cabinet_core::gg::{
    CAPABILITY_RESPONSES_AS_CODE, GgReplayStep, GgReplayToolStep, GgTelemetryKind,
};
use test_cabinet_core::gg_replay::{GgReplayEntry, GgReplayEntryKind, GgReplayRecord};
use test_cabinet_core::metrics::TokenCounts;

use crate::model::{ModelResponse, ToolCall};
use crate::replay_inputs::{RecordedModelOutcome, ReplayInputs};
use crate::sandbox::PROGRAM_CALL_ID_PREFIX;
use crate::telemetry::{Emitter, EventSink, StdoutSink};

pub use crate::replay_inputs::ReplayError;

/// The result of [reconstructing](reconstruct) a run from its replay record.
///
/// Carries the ordered, per-agent [step-through](GgReplayStep) list the debug entrypoint writes out,
/// alongside a few totals for its summary line.
#[derive(Debug, Clone, PartialEq)]
pub struct ReplayReconstruction {
    /// The session id of the reconstructed run (the record's).
    pub session_id: String,
    /// The reconstructed steps, in global `seq` order across the whole agent tree — driven through
    /// the replay seams and validated for completeness.
    pub steps: Vec<GgReplayStep>,
    /// How many distinct agents the run's record spans.
    pub agent_count: usize,
    /// How many model turns were replayed across all agents.
    pub model_calls: usize,
    /// How many model calls the record captured as **failed** — the calls the loop branched on
    /// rather than answered from. Zero for every v1 record, which had no seam for them.
    pub model_errors: usize,
    /// How many tool results were replayed across all agents.
    pub tool_calls: usize,
    /// How many of gg's own subprocesses — `sh -c` commands and `git` invocations — the record
    /// pinned. They produce no step: they are inputs a *driving* playback stubs, and here they are
    /// walked only to prove the record accounts for them.
    pub commands: usize,
}

/// An agent's live reconstruction state during the [walk](reconstruct_with_sink).
///
/// Only the turn-shape bookkeeping lives here now. The recorded inputs themselves — parsed,
/// per-agent, per-category — belong to the [shared index](ReplayInputs), so this driver and a
/// driving playback read one record exactly one way.
struct AgentReplay {
    /// The agent-scoped emitter its reconstructed telemetry streams on.
    emitter: Emitter,
    /// The turn currently awaiting tool results, if any.
    pending: Option<PendingTurn>,
}

/// A model turn whose tool calls are being matched to their recorded outcomes.
struct PendingTurn {
    /// The index (in the produced step list) of the step this turn opened.
    step_index: usize,
    /// The `seq` of the turn's model call — for a precise gap error if a call goes unanswered.
    seq: u64,
    /// The **native** calls the response requested that have not yet been matched to a recorded
    /// outcome, in order. Always empty for a [code turn](Self::code_turn) — the loop dispatches no
    /// native call in code mode, so even a response that requested one (a model reflex the loop
    /// warns about and ignores) leaves nothing to answer.
    remaining: VecDeque<ToolCall>,
    /// Whether this turn ran a **program** rather than requesting native tool calls — the only
    /// shape a `program:`-prefixed result can belong to.
    ///
    /// It is a property of the *run*, not of the individual turn: responses-as-code is a capability
    /// the whole session is configured with, so every turn of such a run is a program and no turn
    /// of any other run is. Carrying it here rather than consulting the capability set at each
    /// result keeps the rule where the check is, which is what stops "attributed by id prefix" from
    /// quietly becoming "accepted anywhere".
    code_turn: bool,
}

/// Reconstruct a run from its [replay record](GgReplayRecord), streaming the reconstructed telemetry
/// to **stdout** (the same NDJSON channel a live gg run emits on).
///
/// Returns the per-agent [step-through](GgReplayStep) list on success, or the precise
/// [`ReplayError`] the reconstruction diverged at — the gap the record failed to pin. The
/// reconstruction is fully deterministic: the same record always produces the same steps and the
/// same telemetry (modulo the emitter's wall-clock timestamps), with no live model or tool calls.
pub fn reconstruct(
    record: impl Into<Arc<GgReplayRecord>>,
) -> Result<ReplayReconstruction, ReplayError> {
    reconstruct_with_sink(record, Box::new(StdoutSink))
}

/// [`reconstruct`], but writing the reconstructed telemetry to an arbitrary `sink` — so a test can
/// capture the exact stream the reconstruction re-emits.
pub(crate) fn reconstruct_with_sink(
    record: impl Into<Arc<GgReplayRecord>>,
    sink: Box<dyn EventSink>,
) -> Result<ReplayReconstruction, ReplayError> {
    let record: Arc<GgReplayRecord> = record.into();

    // The index parses every pinned payload up front, so a malformed or dangling entry is reported
    // before a single telemetry event is emitted for a session that cannot finish.
    let inputs = ReplayInputs::new(Arc::clone(&record))?;
    let base = Emitter::with_sink(Some(record.session_id.clone()), sink);

    // Whether the recorded run answered its turns with **programs** rather than with native tool
    // calls. Read from the record's own capability set — which is why the record carries one — so
    // the shape of every turn is known before a single entry is walked, rather than guessed at from
    // an empty `toolCalls` list (which a native turn that simply finished also has).
    let code_mode = record
        .capability_set
        .is_enabled(CAPABILITY_RESPONSES_AS_CODE);

    // The entries in true recording order — sorting on the globally-monotonic `seq` recovers the
    // exact interleaving of concurrently-running agents. This walk *is* the barrier: each entry is
    // served in seq order, so no agent can read ahead of another.
    let mut order: Vec<&GgReplayEntry> = record.entries.iter().collect();
    order.sort_by_key(|entry| entry.seq);

    let mut states: BTreeMap<&str, AgentReplay> = inputs
        .agent_ids()
        .iter()
        .map(|agent_id| {
            (
                agent_id.as_str(),
                AgentReplay {
                    emitter: base.for_agent(agent_id.clone(), None),
                    pending: None,
                },
            )
        })
        .collect();

    base.emit(GgTelemetryKind::Log {
        level: "info".to_string(),
        message: format!(
            "replay: reconstructing session `{}` — {} agent(s), {} recorded input(s).",
            record.session_id,
            inputs.agent_ids().len(),
            order.len(),
        ),
    });

    // Walk the entries in `seq` order, drawing each one through the shared index and re-emitting the
    // per-turn telemetry the real loop produced.
    let mut steps: Vec<GgReplayStep> = Vec::new();
    let mut model_calls = 0usize;
    let mut model_errors = 0usize;
    let mut tool_calls = 0usize;
    let mut commands = 0usize;
    for entry in &order {
        let agent_id = entry.agent_id.as_str();
        let state = states.get_mut(agent_id).expect("agent state");
        match &entry.kind {
            GgReplayEntryKind::ModelIo { .. } | GgReplayEntryKind::ModelError { .. } => {
                // A new model call must not be issued while the previous turn still has calls
                // awaiting a recorded outcome — that would be a truncated capture. It holds for a
                // *failed* call too: the loop only asks again once the turn it is on is finished
                // with its tools.
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

                // Pull this call from the model seam (in place of a live provider call).
                let call = inputs.next_model(agent_id)?;
                let response = match call.outcome {
                    RecordedModelOutcome::Response(response) => *response,
                    RecordedModelOutcome::Failed(error) => {
                        // A failed call opens no turn: the loop recovered (a vision refusal strips
                        // images and re-asks, and the retry is its own recorded call) or gave up.
                        // Which arm it took is loop behaviour a *driving* playback re-runs; a
                        // passive reconstruction reports the failure the record pinned and moves on
                        // rather than inventing the branch.
                        state.emitter.emit(GgTelemetryKind::Log {
                            level: "error".to_string(),
                            message: format!(
                                "replay: the recorded model call at seq {} failed ({:?}): {}",
                                entry.seq, error.kind, error.message,
                            ),
                        });
                        model_errors += 1;
                        continue;
                    }
                };

                // Re-emit exactly what the real loop emits at a turn: the turn marker, usage (under
                // the same "unreported is silent" guard), and the assistant message when present.
                state.emitter.emit(GgTelemetryKind::TurnStarted {});
                emit_usage(&response, &state.emitter);
                if let Some(text) = &response.text {
                    state
                        .emitter
                        .emit(GgTelemetryKind::AssistantMessage { text: text.clone() });
                }

                // Open this turn's step: what the agent saw (the recorded request, resolved out of
                // the message pool) and did (the response, re-serialized from the seam so `did`
                // flows through the model seam).
                let step_index = steps.len();
                steps.push(GgReplayStep {
                    agent_id: entry.agent_id.clone(),
                    seq: entry.seq,
                    saw: inputs.request_view(&call.request),
                    did: serde_json::to_value(&response).unwrap_or(Value::Null),
                    tool_results: Vec::new(),
                });
                state.pending = Some(PendingTurn {
                    step_index,
                    seq: entry.seq,
                    // A code turn dispatches nothing the response requested: the model was offered
                    // no native tools, and the loop drops any call it emitted regardless. Matching
                    // against them would report a run that behaved correctly as a truncated
                    // capture.
                    remaining: if code_mode {
                        VecDeque::new()
                    } else {
                        response.tool_calls.iter().cloned().collect()
                    },
                    code_turn: code_mode,
                });
                model_calls += 1;
            }
            GgReplayEntryKind::ToolResult { .. } => {
                // Pull the recorded call + outcome from the tool seam (in place of dispatching).
                let served = inputs.next_tool(agent_id)?;
                let (call, outcome) = (served.call, served.outcome);

                let Some(pending) = state.pending.as_mut() else {
                    return Err(ReplayError::ToolResultWithoutTurn {
                        agent_id: entry.agent_id.clone(),
                        seq: entry.seq,
                        tool: call.name.clone(),
                    });
                };
                // A program-composed call answers no requested call: the turn that ran the program
                // requested none (the model was offered no native tools), and the loop minted the
                // call's `program:{ordinal}:{tool}` id itself because a program's call has no
                // provider-assigned one. It is therefore attributed to the open turn on the strength
                // of that prefix alone: it takes nothing from `remaining`, and there is no requested
                // call to match its id or name against. That is what makes a code turn replayable at
                // all. A native call keeps the full one-to-one check.
                //
                // The relaxation is scoped to a **code turn**, not to the id: a `program:` id inside
                // a turn that requested native calls is a shape no run can produce (a turn either
                // offers native tools or runs a program), so it falls through to the ordinary checks
                // and is reported as the divergence it is.
                if !(pending.code_turn && call.id.starts_with(PROGRAM_CALL_ID_PREFIX)) {
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
                    // Re-read off the recorded outcome, which round-trips the class it was captured
                    // with. Deriving it here rather than leaving it unset is what keeps a
                    // reconstruction's error record equal to the recorded run's instead of
                    // reporting every failure as unclassified.
                    failure: outcome.wire_failure(),
                });
                steps[pending.step_index]
                    .tool_results
                    .push(GgReplayToolStep {
                        call: serde_json::to_value(&call).unwrap_or(Value::Null),
                        outcome: serde_json::to_value(&outcome).unwrap_or(Value::Null),
                    });
                tool_calls += 1;
            }
            // gg's own subprocesses are drawn through their seams so the record is proven to
            // account for every one of them, but they open no step and re-emit nothing: neither
            // path produced telemetry of its own in the run being reconstructed.
            GgReplayEntryKind::Shell { .. } => {
                inputs.next_shell(agent_id)?;
                commands += 1;
            }
            GgReplayEntryKind::Git { .. } => {
                inputs.next_git(agent_id)?;
                commands += 1;
            }
            GgReplayEntryKind::Clock { .. } => {
                inputs.next_clock(agent_id)?;
            }
            GgReplayEntryKind::CancelProbe { .. } => {
                let probe = inputs.next_probe(agent_id)?;
                // The one probe reading worth saying out loud: it is why the session stopped.
                if probe.canceled {
                    state.emitter.emit(GgTelemetryKind::Log {
                        level: "warn".to_string(),
                        message: format!(
                            "replay: the recorded run was canceled at seq {}.",
                            entry.seq,
                        ),
                    });
                }
            }
            // Not an input: a prompt frame is gg's record of the window it *built* for the turn
            // just sent, which the console renders from the record directly.
            GgReplayEntryKind::PromptFrame { .. } => {}
        }
    }

    // Any turn still holding an unanswered call at the end of the record is a truncated capture.
    // Swept in first-appearance order so the reported gap is the earliest agent's.
    for agent_id in inputs.agent_ids() {
        let state = states.get(agent_id.as_str()).expect("agent state");
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
            inputs.agent_ids().len(),
        ),
    });

    Ok(ReplayReconstruction {
        session_id: record.session_id.clone(),
        steps,
        agent_count: inputs.agent_ids().len(),
        model_calls,
        model_errors,
        tool_calls,
        commands,
    })
}

/// Emit a turn's [`Usage`](GgTelemetryKind::Usage) under the same guard the real loop uses — silent
/// when nothing was reported (usage is default and no cost), so the reconstructed stream matches the
/// original turn for turn.
///
/// Unattributed: a reconstruction never calls a model at all, and naming one the replay did not
/// call would be a fabricated attribution on a stream whose whole point is fidelity to what was
/// recorded.
fn emit_usage(response: &ModelResponse, emitter: &Emitter) {
    if response.usage == TokenCounts::default() && response.cost.is_none() {
        return;
    }
    emitter.emit(GgTelemetryKind::Usage {
        slot: None,
        model_id: None,
        tokens: response.usage,
        cost: response.cost,
    });
}

#[cfg(test)]
#[path = "replay_driver.test.rs"]
mod tests;

#[cfg(test)]
#[path = "replay_driver.code.test.rs"]
mod code_tests;
