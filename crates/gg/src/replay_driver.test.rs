use serde_json::json;
use test_cabinet_core::gg::{
    GgCapabilitySet, GgReplayEntryKindV1, GgReplayEntryV1, GgReplayRecordV1, GgTelemetryEvent,
    GgTelemetryKind,
};

use super::*;
use crate::model::{FinishReason, ToolCall};
use crate::telemetry::CollectingSink;

// ---------------------------------------------------------------------------
// Record builders — hand-construct records so each property is tested in isolation
// ---------------------------------------------------------------------------

fn call(id: &str, name: &str, args: serde_json::Value) -> ToolCall {
    ToolCall {
        id: id.to_string(),
        name: name.to_string(),
        arguments: args,
    }
}

/// A response that requests exactly one tool `call` (a working turn).
fn resp_calling(text: &str, tool: ToolCall) -> ModelResponse {
    ModelResponse {
        text: Some(text.to_string()),
        tool_calls: vec![tool],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: None,
    }
}

/// A response with no tool calls (a completing turn).
fn resp_stop(text: &str) -> ModelResponse {
    ModelResponse {
        text: Some(text.to_string()),
        tool_calls: Vec::new(),
        finish_reason: FinishReason::Stop,
        usage: TokenCounts::default(),
        cost: None,
    }
}

fn model_io(agent: &str, seq: u64, response: &ModelResponse) -> GgReplayEntryV1 {
    GgReplayEntryV1 {
        agent_id: agent.to_string(),
        seq,
        kind: GgReplayEntryKindV1::ModelIo {
            request: json!({ "messages": [{ "role": "user", "content": "build it" }], "tools": [] }),
            response: serde_json::to_value(response).unwrap(),
        },
    }
}

fn tool_result(agent: &str, seq: u64, tool: &ToolCall, outcome: &ToolOutcome) -> GgReplayEntryV1 {
    GgReplayEntryV1 {
        agent_id: agent.to_string(),
        seq,
        kind: GgReplayEntryKindV1::ToolResult {
            call: serde_json::to_value(tool).unwrap(),
            outcome: serde_json::to_value(outcome).unwrap(),
        },
    }
}

fn record(entries: Vec<GgReplayEntryV1>) -> GgReplayRecordV1 {
    GgReplayRecordV1 {
        session_id: "run-replay".to_string(),
        capability_set: GgCapabilitySet::minimal("mock/echo"),
        entries,
    }
}

/// The core, replayable telemetry kinds of one agent's stream, as compact `(tag, detail)` pairs — the
/// per-turn model/tool sequence the reconstruction reproduces.
fn core_stream(events: &[GgTelemetryEvent], agent: &str) -> Vec<(&'static str, String)> {
    events
        .iter()
        .filter(|e| e.agent_id.as_deref() == Some(agent))
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::TurnStarted {} => Some(("turn", String::new())),
            GgTelemetryKind::AssistantMessage { text } => Some(("assistant", text.clone())),
            GgTelemetryKind::ToolCall { name, .. } => Some(("call", name.clone())),
            GgTelemetryKind::ToolResult { name, ok, .. } => {
                Some(("result", format!("{name}:{ok}")))
            }
            _ => None,
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Reconstruction reproduces the run, deterministically
// ---------------------------------------------------------------------------

/// A complete single-agent record reconstructs: the driver reproduces the same steps the pure
/// [`GgReplayRecordV1::steps`] derivation gives, and re-emits the run's per-turn telemetry in order.
#[test]
fn reconstructs_a_single_agent_run_and_reproduces_its_telemetry() {
    let write = call("c1", "write_file", json!({ "path": "index.html" }));
    let rec = record(vec![
        model_io("root", 0, &resp_calling("building the page", write.clone())),
        tool_result(
            "root",
            1,
            &write,
            &ToolOutcome::ok("wrote index.html", "wrote index.html"),
        ),
        model_io("root", 2, &resp_stop("done")),
    ]);

    let sink = CollectingSink::new();
    let out = reconstruct_with_sink(&rec, Box::new(sink.clone())).expect("reconstructs");

    // Two model turns, one tool result, one agent.
    assert_eq!(out.model_calls, 2);
    assert_eq!(out.tool_calls, 1);
    assert_eq!(out.agent_count, 1);

    // The driver's steps equal the pure derivation the UI consumes.
    assert_eq!(out.steps, rec.steps());
    assert_eq!(out.steps.len(), 2);
    assert_eq!(out.steps[0].agent_id, "root");
    assert_eq!(out.steps[0].tool_results.len(), 1);
    assert_eq!(out.steps[0].tool_results[0].call["name"], "write_file");
    assert_eq!(out.steps[0].tool_results[0].outcome["ok"], true);
    assert!(out.steps[1].tool_results.is_empty());

    // The reconstructed telemetry reproduces the real loop's per-turn sequence.
    assert_eq!(
        core_stream(&sink.events(), "root"),
        vec![
            ("turn", String::new()),
            ("assistant", "building the page".to_string()),
            ("call", "write_file".to_string()),
            ("result", "write_file:true".to_string()),
            ("turn", String::new()),
            ("assistant", "done".to_string()),
        ],
    );
}

/// Reconstruction is deterministic: the same record always yields the identical step list, with no
/// live model or tool calls between runs.
#[test]
fn reconstruction_is_deterministic() {
    let write = call("c1", "write_file", json!({ "path": "a.txt" }));
    let rec = record(vec![
        model_io("root", 0, &resp_calling("writing", write.clone())),
        tool_result("root", 1, &write, &ToolOutcome::ok("ok", "ok")),
        model_io("root", 2, &resp_stop("done")),
    ]);

    let first = reconstruct_with_sink(&rec, Box::new(CollectingSink::new())).unwrap();
    let second = reconstruct_with_sink(&rec, Box::new(CollectingSink::new())).unwrap();
    assert_eq!(
        first.steps, second.steps,
        "the step list is byte-for-byte repeatable"
    );
    assert_eq!(
        serde_json::to_string(&first.steps).unwrap(),
        serde_json::to_string(&second.steps).unwrap(),
    );
}

/// A multi-agent record reconstructs the concurrent tree: entries interleaved under one global
/// sequence route to the right agent, and each agent's telemetry is reproduced on its own stream.
#[test]
fn reconstructs_multi_agent_interleaving() {
    let spawn = call("c1", "spawn_subagent", json!({ "brief": "write the page" }));
    let write = call("c2", "write_file", json!({ "path": "index.html" }));
    // The root spawns a child (seq 0), the child works and finishes (seq 1-3), then the root's spawn
    // result lands and the root finishes (seq 4-5) — the true interleaving, in global seq order.
    let rec = record(vec![
        model_io("root", 0, &resp_calling("delegating", spawn.clone())),
        model_io("agent-0", 1, &resp_calling("building", write.clone())),
        tool_result(
            "agent-0",
            2,
            &write,
            &ToolOutcome::ok("wrote it", "wrote it"),
        ),
        model_io("agent-0", 3, &resp_stop("child done")),
        tool_result(
            "root",
            4,
            &spawn,
            &ToolOutcome::ok("agent-0 returned", "spawned agent-0"),
        ),
        model_io("root", 5, &resp_stop("all done")),
    ]);

    let sink = CollectingSink::new();
    let out = reconstruct_with_sink(&rec, Box::new(sink.clone())).expect("reconstructs");

    assert_eq!(out.agent_count, 2);
    assert_eq!(out.model_calls, 4);
    assert_eq!(out.tool_calls, 2);
    assert_eq!(out.steps, rec.steps());
    // Steps are ordered on the global timeline (opening seq), spanning both agents.
    let agents: Vec<&str> = out.steps.iter().map(|s| s.agent_id.as_str()).collect();
    assert_eq!(agents, vec!["root", "agent-0", "agent-0", "root"]);

    // Each agent's stream is reproduced independently.
    let events = sink.events();
    assert_eq!(
        core_stream(&events, "root"),
        vec![
            ("turn", String::new()),
            ("assistant", "delegating".to_string()),
            ("call", "spawn_subagent".to_string()),
            ("result", "spawn_subagent:true".to_string()),
            ("turn", String::new()),
            ("assistant", "all done".to_string()),
        ],
    );
    assert_eq!(
        core_stream(&events, "agent-0"),
        vec![
            ("turn", String::new()),
            ("assistant", "building".to_string()),
            ("call", "write_file".to_string()),
            ("result", "write_file:true".to_string()),
            ("turn", String::new()),
            ("assistant", "child done".to_string()),
        ],
    );
}

// ---------------------------------------------------------------------------
// Gap detection — a record missing a step is reported, never guessed
// ---------------------------------------------------------------------------

/// A record whose turn requested a tool call but pinned no outcome for it is detected as an
/// incomplete capture — the reconstruction stops with the exact gap, not a guessed result.
#[test]
fn detects_a_missing_tool_result() {
    let write = call("c1", "write_file", json!({ "path": "a.txt" }));
    // The model called `write_file`, but the record has no tool result for it (truncated capture).
    let rec = record(vec![model_io("root", 0, &resp_calling("writing", write))]);

    let err = reconstruct_with_sink(&rec, Box::new(CollectingSink::new())).unwrap_err();
    assert_eq!(
        err,
        ReplayError::MissingToolResult {
            agent_id: "root".to_string(),
            seq: 0,
            tool: "write_file".to_string(),
            call_id: "c1".to_string(),
        },
    );
    // The error names the gap clearly.
    assert!(err.to_string().contains("no recorded outcome"), "{err}");
}

/// A missing tool result is also caught when a *new* turn opens before the previous turn's call was
/// answered — the record skipped the pinned outcome.
#[test]
fn detects_a_missing_tool_result_before_the_next_turn() {
    let write = call("c1", "write_file", json!({ "path": "a.txt" }));
    let rec = record(vec![
        model_io("root", 0, &resp_calling("writing", write)),
        // Jumps straight to a completing turn — the write_file outcome was never recorded.
        model_io("root", 1, &resp_stop("done")),
    ]);

    let err = reconstruct_with_sink(&rec, Box::new(CollectingSink::new())).unwrap_err();
    assert!(
        matches!(err, ReplayError::MissingToolResult { seq: 0, .. }),
        "expected a missing-tool-result gap at seq 0, got {err:?}"
    );
}

/// A recorded tool result with no model turn that requested it is a structural divergence (the
/// record is missing the model call), reported rather than mis-attributed.
#[test]
fn detects_a_tool_result_without_a_model_turn() {
    let write = call("c1", "write_file", json!({ "path": "a.txt" }));
    let rec = record(vec![tool_result(
        "root",
        0,
        &write,
        &ToolOutcome::ok("ok", "ok"),
    )]);

    let err = reconstruct_with_sink(&rec, Box::new(CollectingSink::new())).unwrap_err();
    assert_eq!(
        err,
        ReplayError::ToolResultWithoutTurn {
            agent_id: "root".to_string(),
            seq: 0,
            tool: "write_file".to_string(),
        },
    );
}

/// A recorded tool result that does not match the call the model made at that point is reported as a
/// misalignment, not silently replayed against the wrong call.
#[test]
fn detects_a_mismatched_tool_result() {
    let called = call("c1", "write_file", json!({ "path": "a.txt" }));
    let recorded = call("c1", "shell", json!({ "command": "ls" }));
    let rec = record(vec![
        model_io("root", 0, &resp_calling("writing", called)),
        // The model called `write_file`, but the record's result is for `shell`.
        tool_result("root", 1, &recorded, &ToolOutcome::ok("a.txt", "listed")),
    ]);

    let err = reconstruct_with_sink(&rec, Box::new(CollectingSink::new())).unwrap_err();
    assert_eq!(
        err,
        ReplayError::ToolResultMismatch {
            agent_id: "root".to_string(),
            seq: 1,
            expected: "write_file".to_string(),
            recorded: "shell".to_string(),
        },
    );
}

/// A malformed entry payload (a response that is not a `ModelResponse`) is reported with its
/// location before any telemetry is emitted, rather than crashing the driver.
#[test]
fn detects_a_malformed_entry() {
    let rec = record(vec![GgReplayEntryV1 {
        agent_id: "root".to_string(),
        seq: 0,
        kind: GgReplayEntryKindV1::ModelIo {
            request: json!({ "messages": [], "tools": [] }),
            response: json!("not a model response"),
        },
    }]);

    let err = reconstruct_with_sink(&rec, Box::new(CollectingSink::new())).unwrap_err();
    assert!(
        matches!(err, ReplayError::MalformedEntry { seq: 0, .. }),
        "expected a malformed-entry error, got {err:?}"
    );
}

/// An empty record reconstructs to an empty run — no steps, no error.
#[test]
fn an_empty_record_reconstructs_to_nothing() {
    let rec = record(Vec::new());
    let out = reconstruct_with_sink(&rec, Box::new(CollectingSink::new())).expect("reconstructs");
    assert!(out.steps.is_empty());
    assert_eq!(out.agent_count, 0);
    assert_eq!(out.model_calls, 0);
    assert_eq!(out.tool_calls, 0);
}
