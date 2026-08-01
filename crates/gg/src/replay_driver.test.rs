use serde_json::json;
use test_cabinet_core::gg::{
    GgCapabilitySet, GgReplayEntryKindV1, GgReplayEntryV1, GgReplayRecordV1, GgTelemetryEvent,
    GgTelemetryKind,
};
use test_cabinet_core::gg_replay::{
    GG_REPLAY_FORMAT_VERSION, GgClientRole, GgReplayCommand, GgReplayEntry, GgReplayEntryKind,
    GgReplayInterner, GgReplayModelError, GgReplayModelErrorKind, GgReplayPools,
    GgReplayRequestShape, GgReplayToolCall, GgReplayToolOutcome, GgShellCwd, GgShellOrigin,
};

use super::*;
use crate::model::{FinishReason, ToolCall};
use crate::telemetry::CollectingSink;
use crate::tools::ToolOutcome;

// ---------------------------------------------------------------------------
// Record builders — hand-construct records so each property is tested in isolation
// ---------------------------------------------------------------------------

/// Builds a **format-v2** record the way capture does: every payload goes through the one
/// [interner](GgReplayInterner), so the pools these tests reconstruct from are the pools an
/// assembled record carries. Hand-writing pool indices instead would let a test agree with a
/// mistake the real capture cannot make.
pub(super) struct RecordBuilder {
    session_id: String,
    capability_set: GgCapabilitySet,
    pools: GgReplayPools,
    entries: Vec<GgReplayEntry>,
}

impl RecordBuilder {
    pub(super) fn new(session_id: &str, capability_set: GgCapabilitySet) -> Self {
        Self {
            session_id: session_id.to_string(),
            capability_set,
            pools: GgReplayPools::new(),
            entries: Vec::new(),
        }
    }

    fn push(&mut self, agent: &str, seq: u64, kind: GgReplayEntryKind) -> &mut Self {
        self.entries.push(GgReplayEntry {
            agent_id: agent.to_string(),
            seq,
            kind,
        });
        self
    }

    /// One successful model turn, over a one-message conversation offering no tools.
    pub(super) fn model_io(
        &mut self,
        agent: &str,
        seq: u64,
        response: &ModelResponse,
    ) -> &mut Self {
        self.model_io_asking(agent, seq, "build it", response)
    }

    /// One successful model turn whose conversation carries `prompt` — so a test can prove the
    /// request a step reports is the request that was recorded, not a placeholder.
    pub(super) fn model_io_asking(
        &mut self,
        agent: &str,
        seq: u64,
        prompt: &str,
        response: &ModelResponse,
    ) -> &mut Self {
        let request = self.pools.intern_request(
            GgClientRole::Agent,
            GgReplayRequestShape::Complete,
            &[json!({ "role": "user", "content": prompt })],
            Some(&json!([])),
        );
        self.push(
            agent,
            seq,
            GgReplayEntryKind::ModelIo {
                request,
                response: serde_json::to_value(response).unwrap(),
                duration_ms: None,
            },
        )
    }

    /// One model call that **failed** — the category v1 had no seam for at all.
    pub(super) fn model_error(
        &mut self,
        agent: &str,
        seq: u64,
        kind: GgReplayModelErrorKind,
        message: &str,
    ) -> &mut Self {
        let request = self.pools.intern_request(
            GgClientRole::Agent,
            GgReplayRequestShape::Complete,
            &[json!({ "role": "user", "content": "build it" })],
            Some(&json!([])),
        );
        self.push(
            agent,
            seq,
            GgReplayEntryKind::ModelError {
                request,
                error: GgReplayModelError {
                    kind,
                    message: message.to_string(),
                    status: None,
                    attempts: None,
                    model_id: None,
                },
                duration_ms: None,
            },
        )
    }

    /// One dispatched tool call and the outcome it returned, with the outcome's payloads pooled.
    pub(super) fn tool_result(
        &mut self,
        agent: &str,
        seq: u64,
        call: &ToolCall,
        outcome: &ToolOutcome,
    ) -> &mut Self {
        let output = self.pools.intern_text(&outcome.output);
        let summary = outcome
            .summary
            .as_deref()
            .map(|summary| self.pools.intern_text(summary));
        self.push(
            agent,
            seq,
            GgReplayEntryKind::ToolResult {
                call: GgReplayToolCall {
                    id: call.id.clone(),
                    name: call.name.clone(),
                    arguments: call.arguments.clone(),
                    cwd: None,
                },
                outcome: GgReplayToolOutcome {
                    ok: outcome.ok,
                    output,
                    summary,
                    images: Vec::new(),
                    data: None,
                    failure: None,
                },
            },
        )
    }

    /// One `git` subprocess gg's own orchestration ran.
    pub(super) fn git(&mut self, agent: &str, seq: u64, command: &str, stdout: &str) -> &mut Self {
        let command = self.command(command, stdout);
        self.push(agent, seq, GgReplayEntryKind::Git { command })
    }

    /// One `sh -c` command, tagged with the path that issued it.
    pub(super) fn shell(
        &mut self,
        agent: &str,
        seq: u64,
        origin: GgShellOrigin,
        command: &str,
        stdout: &str,
    ) -> &mut Self {
        let command = self.command(command, stdout);
        self.push(agent, seq, GgReplayEntryKind::Shell { origin, command })
    }

    fn command(&mut self, command: &str, stdout: &str) -> GgReplayCommand {
        GgReplayCommand {
            command: command.to_string(),
            cwd: GgShellCwd::Workspace,
            exit_code: 0,
            stdout: self.pools.intern_text(stdout),
            stderr: self.pools.intern_text(""),
        }
    }

    /// One read of the wall-clock deadline.
    pub(super) fn clock(&mut self, agent: &str, seq: u64, elapsed_ms: u64) -> &mut Self {
        self.push(
            agent,
            seq,
            GgReplayEntryKind::Clock {
                elapsed_ms,
                remaining_ms: None,
            },
        )
    }

    /// One read of the cancel file.
    pub(super) fn probe(&mut self, agent: &str, seq: u64, canceled: bool) -> &mut Self {
        self.push(agent, seq, GgReplayEntryKind::CancelProbe { canceled })
    }

    /// One prompt frame — an entry nothing consumes, which must therefore neither open a step nor
    /// break the walk.
    pub(super) fn prompt_frame(&mut self, agent: &str, seq: u64) -> &mut Self {
        self.push(
            agent,
            seq,
            GgReplayEntryKind::PromptFrame { items: Vec::new() },
        )
    }

    pub(super) fn build(&mut self) -> GgReplayRecord {
        let pools = std::mem::take(&mut self.pools).into_parts();
        let mut record = GgReplayRecord::new(self.session_id.clone(), self.capability_set.clone());
        record.messages = pools.messages;
        record.toolsets = pools.toolsets;
        record.texts = pools.texts;
        record.clips = pools.clips;
        record.blobs = pools.blobs;
        record.entries = std::mem::take(&mut self.entries);
        record
    }
}

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

/// A builder for an ordinary, tool-calling run.
fn record() -> RecordBuilder {
    RecordBuilder::new("run-replay", GgCapabilitySet::minimal("mock/echo"))
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
            GgTelemetryKind::Log { level, .. } if level != "info" => Some(("log", level.clone())),
            _ => None,
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Reconstruction reproduces the run, deterministically
// ---------------------------------------------------------------------------

/// A complete single-agent record reconstructs: the driver produces the per-agent step list and
/// re-emits the run's per-turn telemetry in order.
#[test]
fn reconstructs_a_single_agent_run_and_reproduces_its_telemetry() {
    let write = call("c1", "write_file", json!({ "path": "index.html" }));
    let rec = record()
        .model_io("root", 0, &resp_calling("building the page", write.clone()))
        .tool_result(
            "root",
            1,
            &write,
            &ToolOutcome::ok("wrote index.html", "wrote index.html"),
        )
        .model_io("root", 2, &resp_stop("done"))
        .build();

    let sink = CollectingSink::new();
    let out = reconstruct_with_sink(rec, Box::new(sink.clone())).expect("reconstructs");

    // Two model turns, one tool result, one agent.
    assert_eq!(out.model_calls, 2);
    assert_eq!(out.tool_calls, 1);
    assert_eq!(out.agent_count, 1);

    assert_eq!(out.steps.len(), 2);
    assert_eq!(out.steps[0].agent_id, "root");
    assert_eq!(out.steps[0].seq, 0);
    assert_eq!(out.steps[0].tool_results.len(), 1);
    assert_eq!(out.steps[0].tool_results[0].call["name"], "write_file");
    assert_eq!(out.steps[0].tool_results[0].outcome["ok"], true);
    assert_eq!(
        out.steps[0].tool_results[0].outcome["output"],
        "wrote index.html"
    );
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

/// What a step reports the agent **saw** is the recorded request, resolved out of the message pool —
/// not the pool indices the entry carries.
///
/// This is the property the pooled format most easily loses: a v2 request holds `messages: [0, 1]`,
/// and a driver that passed it through untouched would render a step-through in which every agent
/// saw a list of small integers.
#[test]
fn a_step_reports_the_request_resolved_out_of_the_pool() {
    let rec = record()
        .model_io_asking("root", 0, "build the landing page", &resp_stop("done"))
        .build();

    let out = reconstruct_with_sink(rec, Box::new(CollectingSink::new())).expect("reconstructs");
    let saw = &out.steps[0].saw;
    assert_eq!(
        saw["messages"][0]["content"], "build the landing page",
        "the conversation is inflated from the message pool: {saw}"
    );
    assert_eq!(saw["role"], "agent");
    assert_eq!(saw["shape"], "complete");
    assert!(
        saw["fingerprint"]["conversation"].is_string(),
        "the request's fingerprint travels with the step: {saw}"
    );
}

/// Reconstruction is deterministic: the same record always yields the identical step list, with no
/// live model or tool calls between runs.
#[test]
fn reconstruction_is_deterministic() {
    let write = call("c1", "write_file", json!({ "path": "a.txt" }));
    let rec = record()
        .model_io("root", 0, &resp_calling("writing", write.clone()))
        .tool_result("root", 1, &write, &ToolOutcome::ok("ok", "ok"))
        .model_io("root", 2, &resp_stop("done"))
        .build();
    let rec = std::sync::Arc::new(rec);

    let first = reconstruct_with_sink(Arc::clone(&rec), Box::new(CollectingSink::new())).unwrap();
    let second = reconstruct_with_sink(Arc::clone(&rec), Box::new(CollectingSink::new())).unwrap();
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
    let rec = record()
        .model_io("root", 0, &resp_calling("delegating", spawn.clone()))
        .model_io("agent-0", 1, &resp_calling("building", write.clone()))
        .tool_result(
            "agent-0",
            2,
            &write,
            &ToolOutcome::ok("wrote it", "wrote it"),
        )
        .model_io("agent-0", 3, &resp_stop("child done"))
        .tool_result(
            "root",
            4,
            &spawn,
            &ToolOutcome::ok("agent-0 returned", "spawned agent-0"),
        )
        .model_io("root", 5, &resp_stop("all done"))
        .build();

    let sink = CollectingSink::new();
    let out = reconstruct_with_sink(rec, Box::new(sink.clone())).expect("reconstructs");

    assert_eq!(out.agent_count, 2);
    assert_eq!(out.model_calls, 4);
    assert_eq!(out.tool_calls, 2);
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
// The categories v1 had no seam for
// ---------------------------------------------------------------------------

/// A record carrying every v2 entry kind walks end to end: the failed call, the subprocesses, the
/// probes and the prompt frame are all accounted for, and only the successful call opens a step.
///
/// The counts are the point. A driver that ignored an unfamiliar entry would reconstruct exactly the
/// same steps and report a record as complete while silently skipping four categories of input.
#[test]
fn walks_every_v2_entry_kind_and_accounts_for_it() {
    let write = call("c1", "write_file", json!({ "path": "a.txt" }));
    let rec = record()
        .clock("root", 0, 1_000)
        .probe("root", 1, false)
        .git("root", 2, "git rev-parse HEAD", "cafe1234")
        .model_error(
            "root",
            3,
            GgReplayModelErrorKind::VisionUnsupported,
            "this model does not accept image input",
        )
        .model_io("root", 4, &resp_calling("writing", write.clone()))
        .prompt_frame("root", 5)
        .tool_result("root", 6, &write, &ToolOutcome::ok("wrote a.txt", "wrote"))
        .shell(
            "root",
            7,
            GgShellOrigin::CompletionValidation,
            "npm run build",
            "built",
        )
        .model_io("root", 8, &resp_stop("done"))
        .build();

    let sink = CollectingSink::new();
    let out = reconstruct_with_sink(rec, Box::new(sink.clone())).expect("reconstructs");

    assert_eq!(out.model_calls, 2, "only the two answered calls open turns");
    assert_eq!(out.model_errors, 1);
    assert_eq!(out.tool_calls, 1);
    assert_eq!(out.commands, 2, "one git invocation and one shell command");
    assert_eq!(out.steps.len(), 2, "a failed call opens no step");

    // The failure is reported on the agent's own stream rather than swallowed.
    let events = sink.events();
    let failure = events
        .iter()
        .find(|e| {
            matches!(&e.kind, GgTelemetryKind::Log { level, message }
                if level == "error" && message.contains("VisionUnsupported"))
        })
        .expect("the recorded model failure is reported");
    assert_eq!(failure.agent_id.as_deref(), Some("root"));
}

/// A recorded cancellation is reported: it is why the session stopped, and a reconstruction that
/// showed a run simply ending would be describing a different run.
#[test]
fn a_recorded_cancellation_is_reported() {
    let rec = record()
        .model_io("root", 0, &resp_stop("working"))
        .probe("root", 1, true)
        .build();

    let sink = CollectingSink::new();
    reconstruct_with_sink(rec, Box::new(sink.clone())).expect("reconstructs");
    assert!(
        sink.events().iter().any(|e| matches!(&e.kind,
            GgTelemetryKind::Log { level, message } if level == "warn" && message.contains("canceled"))),
        "the cancel probe that ended the run is reported",
    );
}

/// A **v1** record still reconstructs — through the same driver, because
/// [`GgReplayRecord`] upgrades a v1 body as it deserializes.
///
/// This is the compatibility guarantee `tcab gg-replay --record <v1 record>` rests on: every record
/// captured before format v2 is served by the backend exactly as it was written.
#[test]
fn a_v1_record_still_reconstructs() {
    let write = call("c1", "write_file", json!({ "path": "index.html" }));
    let legacy = GgReplayRecordV1 {
        session_id: "run-legacy".to_string(),
        capability_set: GgCapabilitySet::minimal("mock/echo"),
        entries: vec![
            GgReplayEntryV1 {
                agent_id: "root".to_string(),
                seq: 0,
                kind: GgReplayEntryKindV1::ModelIo {
                    request: json!({
                        "messages": [{ "role": "user", "content": "build the page" }],
                        "tools": [],
                    }),
                    response: serde_json::to_value(resp_calling("building", write.clone()))
                        .unwrap(),
                },
            },
            GgReplayEntryV1 {
                agent_id: "root".to_string(),
                seq: 1,
                kind: GgReplayEntryKindV1::ToolResult {
                    call: serde_json::to_value(&write).unwrap(),
                    outcome: serde_json::to_value(ToolOutcome::ok("wrote it", "wrote it")).unwrap(),
                },
            },
        ],
    };

    // Exactly what the CLI does: read the served document as the one record type.
    let raw = serde_json::to_string(&legacy).unwrap();
    let record: GgReplayRecord = serde_json::from_str(&raw).expect("a v1 body upgrades");
    assert!(record.captured_before_v2());
    assert_eq!(record.format_version, GG_REPLAY_FORMAT_VERSION);

    let out = reconstruct_with_sink(record, Box::new(CollectingSink::new()))
        .expect("a v1 record reconstructs");
    assert_eq!(out.model_calls, 1);
    assert_eq!(out.tool_calls, 1);
    assert_eq!(out.model_errors, 0, "v1 had no seam for a failed call");
    assert_eq!(out.commands, 0, "nor for gg's own subprocesses");
    assert_eq!(
        out.steps[0].saw["messages"][0]["content"], "build the page",
        "the upgraded request resolves back to the conversation v1 inlined",
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
    let rec = record()
        .model_io("root", 0, &resp_calling("writing", write))
        .build();

    let err = reconstruct_with_sink(rec, Box::new(CollectingSink::new())).unwrap_err();
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
    let rec = record()
        .model_io("root", 0, &resp_calling("writing", write))
        // Jumps straight to a completing turn — the write_file outcome was never recorded.
        .model_io("root", 1, &resp_stop("done"))
        .build();

    let err = reconstruct_with_sink(rec, Box::new(CollectingSink::new())).unwrap_err();
    assert!(
        matches!(err, ReplayError::MissingToolResult { seq: 0, .. }),
        "expected a missing-tool-result gap at seq 0, got {err:?}"
    );
}

/// The same guard applies when the next recorded call **failed**: the loop only asks the model again
/// once the turn it is on has finished with its tools, so a failed call arriving on an unanswered
/// turn is the same truncated capture.
#[test]
fn detects_a_missing_tool_result_before_a_failed_call() {
    let write = call("c1", "write_file", json!({ "path": "a.txt" }));
    let rec = record()
        .model_io("root", 0, &resp_calling("writing", write))
        .model_error(
            "root",
            1,
            GgReplayModelErrorKind::RetryExhausted,
            "upstream returned 503 five times",
        )
        .build();

    let err = reconstruct_with_sink(rec, Box::new(CollectingSink::new())).unwrap_err();
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
    let rec = record()
        .tool_result("root", 0, &write, &ToolOutcome::ok("ok", "ok"))
        .build();

    let err = reconstruct_with_sink(rec, Box::new(CollectingSink::new())).unwrap_err();
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
    let rec = record()
        .model_io("root", 0, &resp_calling("writing", called))
        // The model called `write_file`, but the record's result is for `shell`.
        .tool_result("root", 1, &recorded, &ToolOutcome::ok("a.txt", "listed"))
        .build();

    let err = reconstruct_with_sink(rec, Box::new(CollectingSink::new())).unwrap_err();
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
/// location **before any telemetry is emitted**, rather than crashing the driver — the index parses
/// every payload up front for exactly this reason.
#[test]
fn detects_a_malformed_entry_before_emitting_anything() {
    let mut rec = record().model_io("root", 0, &resp_stop("done")).build();
    let GgReplayEntryKind::ModelIo { response, .. } = &mut rec.entries[0].kind else {
        panic!("the builder wrote a model_io entry");
    };
    *response = json!("not a model response");

    let sink = CollectingSink::new();
    let err = reconstruct_with_sink(rec, Box::new(sink.clone())).unwrap_err();
    assert!(
        matches!(err, ReplayError::MalformedEntry { seq: 0, .. }),
        "expected a malformed-entry error, got {err:?}"
    );
    assert!(
        sink.events().is_empty(),
        "nothing is emitted for a session that cannot be reconstructed",
    );
}

/// An entry pointing at a pool slot the record does not carry is reported as the dangling reference
/// it is, rather than reconstructing a tool result whose output is silently empty.
#[test]
fn detects_a_dangling_pool_reference() {
    let write = call("c1", "write_file", json!({ "path": "a.txt" }));
    let mut rec = record()
        .model_io("root", 0, &resp_calling("writing", write.clone()))
        .tool_result("root", 1, &write, &ToolOutcome::ok("wrote it", "wrote it"))
        .build();
    let GgReplayEntryKind::ToolResult { outcome, .. } = &mut rec.entries[1].kind else {
        panic!("the builder wrote a tool_result entry");
    };
    outcome.output = 99;

    let err = reconstruct_with_sink(rec, Box::new(CollectingSink::new())).unwrap_err();
    assert!(
        matches!(
            err,
            ReplayError::DanglingPoolRef {
                seq: 1,
                index: 99,
                ..
            }
        ),
        "expected a dangling text reference, got {err:?}"
    );
}

/// An empty record reconstructs to an empty run — no steps, no error.
#[test]
fn an_empty_record_reconstructs_to_nothing() {
    let rec = record().build();
    let out = reconstruct_with_sink(rec, Box::new(CollectingSink::new())).expect("reconstructs");
    assert!(out.steps.is_empty());
    assert_eq!(out.agent_count, 0);
    assert_eq!(out.model_calls, 0);
    assert_eq!(out.tool_calls, 0);
}
