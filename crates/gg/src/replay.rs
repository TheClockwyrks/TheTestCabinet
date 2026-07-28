//! gg **replay capture**: recording the non-deterministic inputs of a run so it can be
//! [replayed exactly](https://docs.testcabinet.ai/gg/replay/) afterward.
//!
//! The [telemetry stream](crate::telemetry) is already most of the capture, but it carries
//! *summaries*, not the exact inputs a faithful re-run needs. When the
//! [replay](test_cabinet_core::gg::CAPABILITY_REPLAY) capability is on, gg additionally pins the two
//! things a run's own logic cannot reproduce — each agent's **model I/O** and every **tool result** —
//! into a [`GgRecorder`], and writes the accumulated [`GgReplayRecord`] to a sidecar the backend
//! serves per run.
//!
//! # The recording seams (decorators, not scattered calls)
//!
//! Capture is deliberately a **decorator around the existing choke points**, never a spray of record
//! calls through the [turn loop](crate::agent):
//!
//! - **Model I/O** is captured by wrapping the [`ModelClient`] in a [`RecordingClient`]: every
//!   `complete` a wrapped agent makes — including the summarizer's compaction calls, which use the
//!   same client — records its request (the messages and offered tool definitions) and the response.
//! - **Tool results** are captured at the one point every dispatched call funnels through as its
//!   outcome is finalized (the loop's per-call completion, and the responses-as-code program's
//!   serviced-call completion), by calling [`GgRecorder::record_tool_result`] — so an intercepted
//!   delegation/speculate/review tool and a code-program-composed call are all captured alongside
//!   ordinary registry dispatch.
//!
//! Every entry is stamped with the recording agent's id and a **globally monotonic** sequence minted
//! across all agents from one counter, so ordering the entries by sequence reconstructs the true
//! interleaving of concurrently-running agents.

use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use serde_json::Value;
use test_cabinet_core::gg::{GgCapabilitySet, GgReplayEntry, GgReplayEntryKind, GgReplayRecord};

use crate::model::{Message, ModelClient, ModelError, ModelResponse, ToolCall, ToolDefinition};
use crate::tools::ToolOutcome;

/// The serializable shape of one recorded model **request** — the conversation and the offered tool
/// definitions passed to [`ModelClient::complete`]. Serialized (camelCase) into the
/// [`ModelIo`](GgReplayEntryKind::ModelIo)`.request` value so a replay driver can reconstruct exactly
/// what the agent saw this turn.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReplayModelRequest<'a> {
    /// The conversation sent to the model this turn.
    messages: &'a [Message],
    /// The tool definitions offered to the model this turn.
    tools: &'a [ToolDefinition],
}

/// The run-wide recorder every [replay](test_cabinet_core::gg::CAPABILITY_REPLAY) entry is appended
/// to.
///
/// Held behind an [`Arc`](std::sync::Arc) on the orchestrator and shared across every agent (the root
/// and each subagent), so all agents' model I/O and tool results accumulate into one ordered log. The
/// [`seq`](GgReplayEntry::seq) counter is global — minted here across all agents — so the interleaving
/// of concurrent agents is reconstructable by sorting on it. Guarded by a [`Mutex`] since
/// concurrently-running agents record into it.
#[derive(Default)]
pub struct GgRecorder {
    /// The recorded entries, in recording order (which is already `seq` order).
    entries: Mutex<Vec<GgReplayEntry>>,
    /// The global monotonic sequence counter minting each entry's [`seq`](GgReplayEntry::seq).
    next_seq: AtomicU64,
}

impl GgRecorder {
    /// A fresh, empty recorder.
    pub fn new() -> Self {
        Self::default()
    }

    /// Record one agent turn's **model I/O**: the `messages`/`tools` request sent to the model and
    /// the `response` it returned, tagged with the recording `agent_id` and the next global sequence.
    pub fn record_model_io(
        &self,
        agent_id: &str,
        messages: &[Message],
        tools: &[ToolDefinition],
        response: &ModelResponse,
    ) {
        let request =
            serde_json::to_value(ReplayModelRequest { messages, tools }).unwrap_or(Value::Null);
        let response = serde_json::to_value(response).unwrap_or(Value::Null);
        self.push(agent_id, GgReplayEntryKind::ModelIo { request, response });
    }

    /// Record one **tool result**: the `call` the agent (or a code program) made and the exact
    /// `outcome` the dispatch returned, tagged with the recording `agent_id` and the next global
    /// sequence.
    ///
    /// A program-composed call arrives here under the synthetic id the loop minted for it
    /// ([`PROGRAM_CALL_ID_PREFIX`](crate::sandbox::PROGRAM_CALL_ID_PREFIX)), and that prefix is the
    /// only thing distinguishing the two in the record — it is what lets the
    /// [replay driver](crate::replay_driver) attribute the entry to the open turn's *program*
    /// instead of to a native tool call the model never made.
    pub fn record_tool_result(&self, agent_id: &str, call: &ToolCall, outcome: &ToolOutcome) {
        let call = serde_json::to_value(call).unwrap_or(Value::Null);
        let outcome = serde_json::to_value(outcome).unwrap_or(Value::Null);
        self.push(agent_id, GgReplayEntryKind::ToolResult { call, outcome });
    }

    /// Append `kind` under `agent_id` at the next global sequence number.
    fn push(&self, agent_id: &str, kind: GgReplayEntryKind) {
        let seq = self.next_seq.fetch_add(1, Ordering::SeqCst);
        self.entries
            .lock()
            .expect("replay recorder lock")
            .push(GgReplayEntry {
                agent_id: agent_id.to_string(),
                seq,
                kind,
            });
    }

    /// Assemble the final [`GgReplayRecord`] for a run: its `session_id`, `capability_set`, and every
    /// recorded entry in `seq` order (recording order already is `seq` order, but the entries are
    /// sorted defensively so the record is well-ordered regardless of lock arrival order).
    pub fn to_record(
        &self,
        session_id: impl Into<String>,
        capability_set: GgCapabilitySet,
    ) -> GgReplayRecord {
        let mut entries = self.entries.lock().expect("replay recorder lock").clone();
        entries.sort_by_key(|entry| entry.seq);
        GgReplayRecord {
            session_id: session_id.into(),
            capability_set,
            entries,
        }
    }

    /// A snapshot of the recorded entries so far, in `seq` order — for tests asserting on capture.
    #[cfg(test)]
    pub fn entries(&self) -> Vec<GgReplayEntry> {
        let mut entries = self.entries.lock().expect("replay recorder lock").clone();
        entries.sort_by_key(|entry| entry.seq);
        entries
    }
}

/// A [`ModelClient`] decorator that records each turn's **model I/O** into a [`GgRecorder`].
///
/// It wraps the agent's real client and is the sole model-I/O recording seam: every `complete` the
/// agent makes — an ordinary turn or a summarizer compaction call — flows through here, so the
/// recorded request/response pairs pin every non-deterministic model step for a faithful replay. The
/// `model_id` and error behavior pass straight through, so wrapping is invisible to the loop.
pub struct RecordingClient {
    /// The wrapped real client.
    inner: Box<dyn ModelClient>,
    /// The shared recorder this client's I/O is appended to.
    recorder: std::sync::Arc<GgRecorder>,
    /// The id of the agent this client drives, stamped onto every recorded entry.
    agent_id: String,
}

impl RecordingClient {
    /// Wrap `inner` so each of its `complete` calls is recorded under `agent_id` into `recorder`.
    pub fn new(
        inner: Box<dyn ModelClient>,
        recorder: std::sync::Arc<GgRecorder>,
        agent_id: impl Into<String>,
    ) -> Self {
        Self {
            inner,
            recorder,
            agent_id: agent_id.into(),
        }
    }
}

#[async_trait::async_trait]
impl ModelClient for RecordingClient {
    async fn complete(
        &self,
        messages: &[Message],
        tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        // Only a *successful* turn is a replayable input: an errored turn ends the session, and a
        // `ModelError` is not a `ModelResponse` a replay could feed back. Record on the way out so the
        // captured response is exactly what the loop consumed.
        let response = self.inner.complete(messages, tools).await?;
        self.recorder
            .record_model_io(&self.agent_id, messages, tools, &response);
        Ok(response)
    }

    /// Recorded exactly as an ordinary turn is, and delegated to the inner client's own
    /// implementation rather than to the trait default — otherwise wrapping a run in replay capture
    /// would quietly downgrade a required tool call to an offered one, and the recorded run would
    /// not be the run that happened.
    async fn complete_requiring(
        &self,
        messages: &[Message],
        tool: &ToolDefinition,
    ) -> Result<ModelResponse, ModelError> {
        let response = self.inner.complete_requiring(messages, tool).await?;
        self.recorder.record_model_io(
            &self.agent_id,
            messages,
            std::slice::from_ref(tool),
            &response,
        );
        Ok(response)
    }

    fn model_id(&self) -> &str {
        self.inner.model_id()
    }
}

#[cfg(test)]
#[path = "replay.test.rs"]
mod tests;
