//! The **recorded model seam**: a `ClientFactory` that answers every call from the record and can
//! reach no provider at all.
//!
//! This is one of the two seams a playback substitutes, and the one that carries ~all of a run's
//! cost. Nothing here constructs a live client, so a reconstruction cannot make a paid call by any
//! path, including one taken by a code path added later.
//!
//! # Binding, and why it is not by id
//!
//! Subagent ids come off a **global counter** in the order agents reach their spawn, and a playback
//! removes model latency entirely — so two concurrent agents interleave differently than they did
//! and an id-keyed lookup would hand agent A the responses recorded for agent B. Silent,
//! catastrophic, and exactly the failure class this feature exists to eliminate.
//!
//! So a client is bound through the record's
//! [provenance table](test_cabinet_core::gg_replay::GgReplayRecord::agents), on the
//! [origin](GgReplayAgentOrigin) the live resolution states: a spawner and a spawn ordinal (a
//! parent's spawns are strictly ordered within its own turn loop), a predecessor and an ordinal, or
//! board state (an issue and an attempt, a review round and position, a merge ordinal). Every one of
//! those is a function of something a reconstruction re-derives on its own; none of them is the
//! counter.
//!
//! **The fingerprint is the second, independent defence.** A mis-bound agent's very first request
//! carries a different profile's system prompt and toolset, so two components move immediately and
//! the reconstruction says so on turn one. Neither mechanism has to be perfect alone — which
//! matters, because the binding table is only as complete as the capture that wrote it.
//!
//! # The unbound client
//!
//! `ClientFactory::client_for` — the **anonymous** resolution, which states no identity — cannot
//! be bound to a queue, and it is not an error either. gg's one anonymous resolution is the `fork`
//! tool re-resolving its forker's own binding purely to *name* a model in the answer it hands back,
//! and an `Err` there would make every fork fail under playback while the recorded success was fed
//! forward — the parent's reconstructed context would claim a fork that does not exist. So the
//! anonymous resolution yields a client with the right `model_id` and a playback-specific model
//! error on any attempt to *call* it: naming works, calling is impossible.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;
use test_cabinet_core::gg::GgSlotBinding;
use test_cabinet_core::gg_replay::{
    GgClientRole, GgFingerprintComponent, GgReplayAgentOrigin, GgReplayInterner,
    GgReplayModelError, GgReplayModelErrorKind, GgReplayPools, GgReplayRequest,
    GgReplayRequestShape,
};

use super::drift::{Drift, DriftKind, DriftLedger, DriftVerdict, Strictness, prompt_diff_region};
use crate::client::{AgentIdentity, ClientFactory};
use crate::model::{Message, ModelClient, ModelError, ModelResponse, ToolDefinition};
use crate::replay_inputs::{RecordedModelOutcome, ReplayInputs};

/// The `ClientFactory` a playback runs under: every agent's turns come from its recorded queue,
/// and no live client exists to fall back to.
pub struct RecordedClientFactory {
    /// The record, transposed per agent — where the answers come from.
    inputs: Arc<ReplayInputs>,
    /// Where every divergence this factory's clients find is written down.
    ledger: Arc<DriftLedger>,
    /// How much of a recorded request a live one must still match.
    strictness: Strictness,
}

impl RecordedClientFactory {
    /// A factory answering from `inputs`, reporting into `ledger` under `strictness`.
    pub fn new(
        inputs: Arc<ReplayInputs>,
        ledger: Arc<DriftLedger>,
        strictness: Strictness,
    ) -> Self {
        Self {
            inputs,
            ledger,
            strictness,
        }
    }

    /// The recorded agent whose queue answers an agent created by `origin`, or `None` when the
    /// record's table has no such row.
    ///
    /// A linear scan over the table rather than a map: an origin is a small enum with no `Hash`,
    /// the table is one row per agent (tens, at the very most), and the scan is made once per
    /// client resolution rather than once per turn. Building an index would trade a real
    /// derive-or-encode decision for nothing measurable.
    fn bind(&self, origin: &GgReplayAgentOrigin) -> Option<&str> {
        self.inputs
            .record()
            .agents
            .iter()
            .find(|agent| &agent.origin == origin)
            .map(|agent| agent.agent_id.as_str())
    }
}

impl ClientFactory for RecordedClientFactory {
    /// The anonymous resolution: an [unbound](UnboundClient) client. See the
    /// [module docs](self#the-unbound-client) — an `Err` here would break the `fork` tool's model
    /// naming, and a bound client would answer from a queue nobody said belonged to it.
    fn client_for(&self, binding: &GgSlotBinding) -> Result<Box<dyn ModelClient>, ModelError> {
        Ok(Box::new(UnboundClient::new(
            binding.model_id.clone(),
            "this resolution named no agent, so there is no recorded queue to answer from (a \
             playback binds a client through the record's agent table, on the agent's provenance)",
        )))
    }

    /// The resolution gg's turn loop actually makes: bound to the recorded agent whose
    /// [provenance](AgentIdentity::origin) matches.
    ///
    /// An origin the record's table has no row for yields an **unbound** client and a reported
    /// divergence rather than an `Err`. An `Err` at the root's launch check would abort the session
    /// before a single telemetry event, and at a spawn site it would report a dispatch failure the
    /// recorded run never had; the unbound client instead lets the loop keep its shape and ends
    /// that one agent, loudly, on its first turn.
    fn client_for_agent(
        &self,
        binding: &GgSlotBinding,
        identity: &AgentIdentity,
    ) -> Result<Box<dyn ModelClient>, ModelError> {
        let Some(agent_id) = self.bind(&identity.origin) else {
            self.ledger.record(Drift::reported(
                DriftKind::UnboundAgent,
                "",
                format!(
                    "a live agent on slot `{}` was created by {} and the record's agent table has \
                     no row for it, so nothing can answer its turns",
                    binding.slot,
                    describe_origin(&identity.origin),
                ),
            ));
            return Ok(Box::new(UnboundClient::new(
                binding.model_id.clone(),
                format!(
                    "the record's agent table has no row for an agent created by {}",
                    describe_origin(&identity.origin)
                ),
            )));
        };
        Ok(Box::new(RecordedClient {
            inputs: Arc::clone(&self.inputs),
            ledger: Arc::clone(&self.ledger),
            strictness: self.strictness,
            agent_id: agent_id.to_string(),
            model_id: binding.model_id.clone(),
            role: identity.role,
        }))
    }
}

/// A [`ModelClient`] that answers one recorded agent's turns from the record.
struct RecordedClient {
    /// The record, transposed per agent.
    inputs: Arc<ReplayInputs>,
    /// Where divergences go.
    ledger: Arc<DriftLedger>,
    /// How much of the recorded request the live one must match.
    strictness: Strictness,
    /// The **recorded** agent whose queue this client draws from — not the live agent's id, which
    /// a reconstruction legitimately assigns differently.
    agent_id: String,
    /// The model the live binding names, reported verbatim so telemetry and per-slot accounting are
    /// this run's rather than the record's.
    model_id: String,
    /// Which of gg's two clients this is, so a summarizer's call and the agent's own next turn are
    /// distinguishable when they are served from one queue.
    role: GgClientRole,
}

impl RecordedClient {
    /// Answer one call from the record: check that the live request is still the recorded question,
    /// then hand back what the recorded call returned.
    ///
    /// Both `ModelClient` methods come through here so the staleness check cannot be applied to one
    /// call shape and not the other — `complete_requiring` is the compaction summarizer's whole
    /// interface, and a reconstruction that skipped the check there would drift precisely where a
    /// handoff rewrote the window.
    async fn answer(
        &self,
        shape: GgReplayRequestShape,
        messages: &[Message],
        tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        // The live request, interned and folded by exactly the code the recorder used — one
        // function on both sides is the whole guarantee. A fresh pool per call is correct and
        // cheap: a pooled id is a content address computed *before* blob substitution, so it does
        // not depend on what else is in the pool.
        let live = live_request(self.role, shape, messages, tools);

        let call = match self.inputs.next_model(&self.agent_id) {
            Ok(call) => call,
            Err(err) => {
                self.ledger.record(
                    Drift::reported(
                        DriftKind::RecordExhausted,
                        &self.agent_id,
                        format!(
                            "the agent asked for another model turn and the record has none left \
                             ({err}). A recorded run that ended on its wall-clock deadline looks \
                             exactly like this: a playback takes seconds, so it never reaches one."
                        ),
                    )
                    .with_verdict(DriftVerdict::Fatal),
                );
                return Err(ModelError::Playback(format!(
                    "no recorded turn left for agent `{}`",
                    self.agent_id
                )));
            }
        };

        // Which client issued the recorded call, and under which shape. Reported rather than fatal:
        // the discriminators say the *wrong queue* was consumed, and the fingerprint — which is
        // about to be compared — is the authority on whether that actually changed the question.
        if call.request.role != self.role {
            self.ledger.record(Drift::reported(
                DriftKind::ClientRole,
                &self.agent_id,
                format!(
                    "the recorded call at seq {} was issued by the {:?} client and this one is the \
                     {:?} client",
                    call.seq, call.request.role, self.role,
                ),
            ));
        }
        if call.request.shape != shape {
            self.ledger.record(Drift::reported(
                DriftKind::RequestShape,
                &self.agent_id,
                format!(
                    "the recorded call at seq {} was made as {:?} and this one as {shape:?} — a \
                     required tool call and an offered one are not the same question",
                    call.seq, call.request.shape,
                ),
            ));
        }

        // The staleness check proper, component by component, in the order the first mover is the
        // most informative one.
        if let Some(component) = call.request.fingerprint.first_difference(&live.fingerprint) {
            let verdict = self.strictness.verdict(component);
            let diff = (component == GgFingerprintComponent::System)
                .then(|| {
                    prompt_diff_region(
                        &self.recorded_system(&call.request).unwrap_or_default(),
                        &live_system(messages).unwrap_or_default(),
                    )
                })
                .flatten();
            self.ledger.record(
                Drift::reported(
                    DriftKind::Fingerprint(component),
                    &self.agent_id,
                    format!(
                        "the request built for the turn recorded at seq {} is not the recorded \
                         question: the {} moved ({} recorded message(s), {} live)",
                        call.seq,
                        DriftKind::Fingerprint(component).label(),
                        call.request.fingerprint.messages,
                        live.fingerprint.messages,
                    ),
                )
                .with_verdict(verdict)
                .with_diff(diff),
            );
            if matches!(verdict, DriftVerdict::Fatal) {
                return Err(ModelError::Playback(format!(
                    "the recorded response for agent `{}` (seq {}) is no longer an answer to the \
                     question this build asks: the {} moved",
                    self.agent_id,
                    call.seq,
                    DriftKind::Fingerprint(component).label(),
                )));
            }
        }

        match call.outcome {
            RecordedModelOutcome::Response(response) => Ok(*response),
            // Served as an error, not swallowed: a vision refusal strips images and re-runs the
            // same turn and a retry exhaustion counts against the run's error ceiling, so both are
            // control flow the reconstruction has to take for itself.
            RecordedModelOutcome::Failed(error) => {
                Err(recorded_model_error(&error, &self.model_id))
            }
        }
    }

    /// The text of the recorded request's first `system`-role message, resolved out of the record's
    /// message pool — the left-hand side of a rendered [prompt diff](Drift::diff).
    fn recorded_system(&self, request: &GgReplayRequest) -> Option<String> {
        request
            .messages
            .iter()
            .filter_map(|index| self.inputs.message(*index))
            .find(|body| body.get("role").and_then(Value::as_str) == Some("system"))
            .and_then(|body| {
                body.get("content")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
    }
}

#[async_trait]
impl ModelClient for RecordedClient {
    async fn complete(
        &self,
        messages: &[Message],
        tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        self.answer(GgReplayRequestShape::Complete, messages, tools)
            .await
    }

    /// Answered as the **required** shape it is, rather than falling through to the trait default —
    /// which would compare a required call against the record as if it had been an offered one.
    async fn complete_requiring(
        &self,
        messages: &[Message],
        tool: &ToolDefinition,
    ) -> Result<ModelResponse, ModelError> {
        self.answer(
            GgReplayRequestShape::CompleteRequiring,
            messages,
            std::slice::from_ref(tool),
        )
        .await
    }

    fn model_id(&self) -> &str {
        &self.model_id
    }
}

/// A client that names a model and cannot call one.
///
/// The answer to every resolution a playback cannot bind to a recorded queue: the
/// [anonymous](ClientFactory::client_for) one, and an agent whose provenance the record has no row
/// for. It is not an `Err` because a failed *resolution* is a different event from a failed *call* —
/// the loop reports the first as a dispatch failure the recorded run never had, and the second as
/// the agent ending, which is what actually happened.
struct UnboundClient {
    /// The model the binding named. Correct, because naming is the one thing this client is for.
    model_id: String,
    /// Why it is unbound, carried into the error any call raises.
    reason: String,
}

impl UnboundClient {
    /// An unbound client for `model_id`, explaining itself with `reason`.
    fn new(model_id: String, reason: impl Into<String>) -> Self {
        Self {
            model_id,
            reason: reason.into(),
        }
    }
}

#[async_trait]
impl ModelClient for UnboundClient {
    async fn complete(
        &self,
        _messages: &[Message],
        _tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        Err(ModelError::Playback(format!(
            "an unbound client for `{}` was asked to complete a turn: {}",
            self.model_id, self.reason,
        )))
    }

    fn model_id(&self) -> &str {
        &self.model_id
    }
}

/// Intern and fold the **live** request, through the same
/// [interner](GgReplayInterner::intern_request) the recorder used.
///
/// The serialization has to match the recorder's exactly, which is why it is one function rather
/// than an inline `to_value` at each of the two call shapes: an empty `tools` slice records **no
/// toolset at all** rather than an empty one, and a live request that folded an empty array where
/// the recorder folded nothing would report a `tools` divergence on every turn of every
/// tool-less run.
fn live_request(
    role: GgClientRole,
    shape: GgReplayRequestShape,
    messages: &[Message],
    tools: &[ToolDefinition],
) -> GgReplayRequest {
    let bodies: Vec<Value> = messages
        .iter()
        .map(|message| serde_json::to_value(message).unwrap_or(Value::Null))
        .collect();
    let tools = (!tools.is_empty()).then(|| serde_json::to_value(tools).unwrap_or(Value::Null));
    GgReplayPools::new().intern_request(role, shape, &bodies, tools.as_ref())
}

/// The text of the live request's first `system`-role message — the right-hand side of a rendered
/// [prompt diff](Drift::diff).
fn live_system(messages: &[Message]) -> Option<String> {
    messages
        .iter()
        .find(|message| matches!(message.role, crate::model::Role::System))
        .and_then(|message| message.content.clone())
}

/// Rebuild the [`ModelError`] a recorded failure was, so the loop branches on it exactly as the run
/// did.
///
/// The inverse of the recorder's own mapping, and it has to be: a
/// [vision refusal](ModelError::VisionUnsupported) is the one error gg *recovers* from, by denying
/// the model images and re-running the same turn — a reconstruction handed a generic failure
/// instead would end the agent where the run carried on.
///
/// `binding_model` stands in when the record did not name a model (only a vision refusal does),
/// which keeps the reconstructed error pointed at the model this reconstruction actually bound.
fn recorded_model_error(error: &GgReplayModelError, binding_model: &str) -> ModelError {
    let message = error.message.clone();
    match error.kind {
        GgReplayModelErrorKind::MissingApiKey => ModelError::MissingApiKey,
        GgReplayModelErrorKind::Fatal => ModelError::Fatal {
            status: error.status.unwrap_or_default(),
            message,
        },
        GgReplayModelErrorKind::RetryExhausted => ModelError::RetryExhausted {
            attempts: error.attempts.unwrap_or(1),
            last: message,
        },
        GgReplayModelErrorKind::VisionUnsupported => ModelError::VisionUnsupported {
            model_id: error
                .model_id
                .clone()
                .unwrap_or_else(|| binding_model.to_string()),
            message,
        },
        GgReplayModelErrorKind::Parse => ModelError::Parse(message),
    }
}

/// How an [origin](GgReplayAgentOrigin) reads in a divergence a human has to act on.
///
/// Written out rather than `{:?}`-formatted because this is the sentence that tells a developer
/// *which* agent could not be bound, and "IssueAttempt { issue: \"AUTH-1\", attempt: 2 }" is a
/// debug dump rather than an explanation.
fn describe_origin(origin: &GgReplayAgentOrigin) -> String {
    match origin {
        GgReplayAgentOrigin::Root => "the run's root".to_string(),
        GgReplayAgentOrigin::Spawn { parent, ordinal } => {
            format!("spawn #{ordinal} of agent `{parent}`")
        }
        GgReplayAgentOrigin::Succession {
            predecessor,
            ordinal,
        } => format!("succession #{ordinal} of agent `{predecessor}`"),
        GgReplayAgentOrigin::IssueAttempt { issue, attempt } => {
            format!("attempt {attempt} at issue `{issue}`")
        }
        GgReplayAgentOrigin::Reviewer {
            issue,
            round,
            position,
        } => format!("reviewer {position} of round {round} on issue `{issue}`"),
        GgReplayAgentOrigin::Merge { issue, ordinal } => {
            format!("merge #{ordinal} of issue `{issue}`")
        }
    }
}

#[cfg(test)]
#[path = "client.test.rs"]
mod tests;
