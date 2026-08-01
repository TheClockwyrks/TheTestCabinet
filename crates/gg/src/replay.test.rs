use std::sync::Arc;

use serde_json::json;
use test_cabinet_core::gg::{GgCapabilitySet, GgReplayEntryKindV1, GgReplayRecordV1};
use test_cabinet_core::metrics::TokenCounts;

use super::*;
use crate::model::{FinishReason, Message, ModelResponse, ToolCall};

/// A trivial [`ModelClient`] that returns a fixed response and records how many times it was
/// called — enough to prove the [`RecordingClient`] decorator delegates and records without
/// touching the network.
struct StubClient {
    model_id: String,
    response: ModelResponse,
    calls: std::sync::atomic::AtomicUsize,
}

impl StubClient {
    fn new(model_id: &str, response: ModelResponse) -> Self {
        Self {
            model_id: model_id.to_string(),
            response,
            calls: std::sync::atomic::AtomicUsize::new(0),
        }
    }
}

#[async_trait::async_trait]
impl ModelClient for StubClient {
    async fn complete(
        &self,
        _messages: &[Message],
        _tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(self.response.clone())
    }

    fn model_id(&self) -> &str {
        &self.model_id
    }
}

fn stop_response(text: &str) -> ModelResponse {
    ModelResponse {
        text: Some(text.to_string()),
        tool_calls: Vec::new(),
        finish_reason: FinishReason::Stop,
        usage: TokenCounts::default(),
        cost: None,
    }
}

/// The recorder appends model I/O and tool results in call order, each tagged with the agent id and
/// a globally monotonic sequence.
#[test]
fn records_entries_in_global_sequence_tagged_by_agent() {
    let recorder = GgRecorder::new();
    let response = stop_response("done");
    recorder.record_model_io("root", &[Message::user("hi")], &[], &response);
    recorder.record_tool_result(
        "root",
        &ToolCall {
            id: "c1".to_string(),
            name: "write_file".to_string(),
            arguments: json!({ "path": "a.txt" }),
        },
        &ToolOutcome::ok("wrote a.txt", "wrote a.txt"),
    );
    recorder.record_model_io("agent-0", &[Message::user("go")], &[], &response);

    let entries = recorder.entries();
    assert_eq!(entries.len(), 3);
    // Global sequence is 0,1,2 across both agents, in recording order.
    assert_eq!(
        entries.iter().map(|e| e.seq).collect::<Vec<_>>(),
        vec![0, 1, 2]
    );
    assert_eq!(entries[0].agent_id, "root");
    assert_eq!(entries[1].agent_id, "root");
    assert_eq!(entries[2].agent_id, "agent-0");
    assert!(matches!(
        entries[0].kind,
        GgReplayEntryKindV1::ModelIo { .. }
    ));
    assert!(matches!(
        entries[1].kind,
        GgReplayEntryKindV1::ToolResult { .. }
    ));
    assert!(matches!(
        entries[2].kind,
        GgReplayEntryKindV1::ModelIo { .. }
    ));
}

/// A recorded model-I/O entry carries the full request (messages + offered tool definitions) and the
/// full response, so a replay driver can reconstruct exactly what the agent saw and returned.
#[test]
fn model_io_entry_captures_the_full_request_and_response() {
    let recorder = GgRecorder::new();
    let tools = vec![ToolDefinition::new(
        "write_file",
        "write a file",
        json!({ "type": "object" }),
    )];
    let response = ModelResponse {
        text: Some("thinking".to_string()),
        tool_calls: vec![ToolCall {
            id: "c1".to_string(),
            name: "write_file".to_string(),
            arguments: json!({ "path": "a.txt" }),
        }],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: None,
    };
    recorder.record_model_io("root", &[Message::user("build it")], &tools, &response);

    let entries = recorder.entries();
    let GgReplayEntryKindV1::ModelIo {
        request,
        response: recorded,
    } = &entries[0].kind
    else {
        panic!("expected a model-io entry");
    };
    // The request carries both the messages and the offered tools.
    assert_eq!(request["messages"][0]["content"], "build it");
    assert_eq!(request["tools"][0]["name"], "write_file");
    // The response round-trips back to the exact `ModelResponse`.
    let round: ModelResponse = serde_json::from_value(recorded.clone()).unwrap();
    assert_eq!(round, response);
}

/// A recorded tool-result entry carries the exact call and outcome, round-tripping back to the gg
/// types a replay driver feeds the loop.
#[test]
fn tool_result_entry_captures_the_exact_call_and_outcome() {
    let recorder = GgRecorder::new();
    let call = ToolCall {
        id: "c9".to_string(),
        name: "shell".to_string(),
        arguments: json!({ "command": "ls" }),
    };
    let outcome = ToolOutcome::ok("a.txt\nb.txt", "listed 2 entries");
    recorder.record_tool_result("agent-1", &call, &outcome);

    let entries = recorder.entries();
    let GgReplayEntryKindV1::ToolResult {
        call: recorded_call,
        outcome: recorded_outcome,
    } = &entries[0].kind
    else {
        panic!("expected a tool-result entry");
    };
    let round_call: ToolCall = serde_json::from_value(recorded_call.clone()).unwrap();
    let round_outcome: ToolOutcome = serde_json::from_value(recorded_outcome.clone()).unwrap();
    assert_eq!(round_call, call);
    assert_eq!(round_outcome, outcome);
}

/// The [`RecordingClient`] delegates to the wrapped client (returning its response and model id) and
/// records the turn's model I/O as a side effect — the model-I/O recording seam.
#[tokio::test]
async fn recording_client_delegates_and_records_each_turn() {
    let recorder = Arc::new(GgRecorder::new());
    let stub = StubClient::new("mock/echo", stop_response("hi"));
    let client = RecordingClient::new(Box::new(stub), Arc::clone(&recorder), "root");

    assert_eq!(client.model_id(), "mock/echo");
    let out = client
        .complete(&[Message::user("first")], &[])
        .await
        .unwrap();
    assert_eq!(out.text.as_deref(), Some("hi"));
    let _ = client
        .complete(&[Message::user("second")], &[])
        .await
        .unwrap();

    let entries = recorder.entries();
    assert_eq!(entries.len(), 2, "each complete records one model-io entry");
    assert!(entries.iter().all(|e| e.agent_id == "root"));
    assert!(
        entries
            .iter()
            .all(|e| matches!(e.kind, GgReplayEntryKindV1::ModelIo { .. }))
    );
    // The captured requests are the exact messages each turn was called with.
    let GgReplayEntryKindV1::ModelIo { request, .. } = &entries[0].kind else {
        unreachable!()
    };
    assert_eq!(request["messages"][0]["content"], "first");
}

/// The assembled [`GgReplayRecordV1`] carries the session id, the capability set, and the entries in
/// sequence order, and round-trips through JSON (serialize → deserialize) unchanged.
#[test]
fn to_record_round_trips_through_json() {
    let recorder = GgRecorder::new();
    let response = stop_response("done");
    recorder.record_model_io("root", &[Message::user("hi")], &[], &response);
    recorder.record_tool_result(
        "root",
        &ToolCall {
            id: "c1".to_string(),
            name: "list_dir".to_string(),
            arguments: json!({ "path": "." }),
        },
        &ToolOutcome::ok("empty", "listed"),
    );

    let set = GgCapabilitySet::minimal("mock/echo");
    let record = recorder.to_record("run-xyz", set.clone());
    assert_eq!(record.session_id, "run-xyz");
    assert_eq!(record.capability_set, set);
    assert_eq!(record.entries.len(), 2);
    assert_eq!(record.entries[0].seq, 0);
    assert_eq!(record.entries[1].seq, 1);

    let json = serde_json::to_string(&record).unwrap();
    let back: GgReplayRecordV1 = serde_json::from_str(&json).unwrap();
    assert_eq!(back, record);
}
