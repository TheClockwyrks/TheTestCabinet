//! Replay of a **responses-as-code** turn: a turn whose model response requests no tool calls at
//! all, yet whose program composes several.
//!
//! These live apart from `replay_driver.test.rs` (which covers the native, one-call-per-request
//! shape) because they assert the opposite structure: the calls being replayed were never requested
//! by the response, so they are attributed to the open turn by the
//! [program id prefix](PROGRAM_CALL_ID_PREFIX) rather than matched against
//! [`PendingTurn::remaining`]. The final test here is the guard on that rule — it must not have
//! loosened the native path, which is still one recorded result per requested call, matched by id
//! and name.

use serde_json::json;
use test_cabinet_core::gg::{
    CAPABILITY_RESPONSES_AS_CODE, GgCapabilityConfig, GgCapabilitySet, GgReplayEntry,
    GgReplayEntryKind, GgReplayRecord, GgTelemetryEvent, GgTelemetryKind,
};

use super::*;
use crate::model::{FinishReason, ToolCall};
use crate::telemetry::CollectingSink;

// ---------------------------------------------------------------------------
// Record builders — a code turn, hand-built exactly as the run would have recorded it
// ---------------------------------------------------------------------------

/// The TypeScript a model emits in code mode: fenced, calling the typed tool functions directly.
/// The driver never evaluates it — the sandbox is not in the replay path, the recorded outcomes are
/// — but the record's model turn is only faithful if it carries the real program text.
const PROGRAM: &str = "\
Reading the sources and leaving a note:

```ts
const entries = listDir(\"src\");
const first = readFile(`src/${entries[0].name}`);
writeFile(\"notes.md\", `${first.text.length} bytes`);
return entries.length;
```
";

/// A program-composed call as the loop mints it: the synthetic `program:{ordinal}:{tool}` id, built
/// from the shared prefix so this test breaks if the discriminator ever moves.
fn program_call(ordinal: u64, name: &str, args: serde_json::Value) -> ToolCall {
    ToolCall {
        id: format!("{PROGRAM_CALL_ID_PREFIX}{ordinal}:{name}"),
        name: name.to_string(),
        arguments: args,
    }
}

/// A native call as a provider assigns it — an opaque id that carries no program prefix.
fn native_call(id: &str, name: &str, args: serde_json::Value) -> ToolCall {
    ToolCall {
        id: id.to_string(),
        name: name.to_string(),
        arguments: args,
    }
}

/// A code-mode turn's response. Every turn in code mode has this one wire shape — assistant text,
/// **no** tool calls (a model in code mode is offered none), a plain stop — whether the text carries
/// a fenced program or the prose that ends the session. That sameness is precisely why the record
/// cannot tell the two apart from the response alone, and why attribution has to come from the
/// recorded call's id.
fn resp_code_turn(text: &str) -> ModelResponse {
    ModelResponse {
        text: Some(text.to_string()),
        tool_calls: Vec::new(),
        finish_reason: FinishReason::Stop,
        usage: TokenCounts::default(),
        cost: None,
    }
}

/// A turn that requests exactly one native tool call — the shape the prefix rule must leave alone.
fn resp_calling(text: &str, tool: ToolCall) -> ModelResponse {
    ModelResponse {
        text: Some(text.to_string()),
        tool_calls: vec![tool],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: None,
    }
}

fn model_io(agent: &str, seq: u64, response: &ModelResponse) -> GgReplayEntry {
    GgReplayEntry {
        agent_id: agent.to_string(),
        seq,
        kind: GgReplayEntryKind::ModelIo {
            request: json!({ "messages": [{ "role": "user", "content": "leave a note" }], "tools": [] }),
            response: serde_json::to_value(response).unwrap(),
        },
    }
}

fn tool_result(agent: &str, seq: u64, tool: &ToolCall, outcome: &ToolOutcome) -> GgReplayEntry {
    GgReplayEntry {
        agent_id: agent.to_string(),
        seq,
        kind: GgReplayEntryKind::ToolResult {
            call: serde_json::to_value(tool).unwrap(),
            outcome: serde_json::to_value(outcome).unwrap(),
        },
    }
}

/// A record of a run that answered its turns with **programs**.
///
/// The capability set is what says so, and it is what the driver reads: responses-as-code is
/// configured for the whole session, so the record itself carries the shape of every one of its
/// turns. Building it here rather than inferring "code turn" from an empty `toolCalls` list is the
/// difference between a rule scoped to a run and a rule that fires on any id that looks right.
fn code_record(entries: Vec<GgReplayEntry>) -> GgReplayRecord {
    let mut caps = GgCapabilitySet::minimal("mock/echo");
    caps.agents[0]
        .capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_RESPONSES_AS_CODE));
    GgReplayRecord {
        session_id: "run-replay-code".to_string(),
        capability_set: caps,
        entries,
    }
}

/// A record of an ordinary **tool-calling** run, for the guards that prove the prefix exemption did
/// not loosen the native path.
fn native_record(entries: Vec<GgReplayEntry>) -> GgReplayRecord {
    GgReplayRecord {
        session_id: "run-replay-native".to_string(),
        capability_set: GgCapabilitySet::minimal("mock/echo"),
        entries,
    }
}

/// The core, replayable telemetry kinds of one agent's stream, as compact `(tag, detail)` pairs —
/// the per-turn model/tool sequence a code turn must reproduce exactly as a tool-calling turn does.
fn core_stream(events: &[GgTelemetryEvent], agent: &str) -> Vec<(&'static str, String)> {
    events
        .iter()
        .filter(|e| e.agent_id.as_deref() == Some(agent))
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::TurnStarted {} => Some(("turn", String::new())),
            GgTelemetryKind::AssistantMessage { .. } => Some(("assistant", String::new())),
            GgTelemetryKind::ToolCall { name, .. } => Some(("call", name.clone())),
            GgTelemetryKind::ToolResult { name, ok, .. } => {
                Some(("result", format!("{name}:{ok}")))
            }
            _ => None,
        })
        .collect()
}

/// The `(id, name)` of every tool step attached to a reconstructed step, in order.
fn tool_steps(step: &GgReplayStep) -> Vec<(String, String)> {
    step.tool_results
        .iter()
        .map(|t| {
            (
                t.call["id"].as_str().unwrap_or_default().to_string(),
                t.call["name"].as_str().unwrap_or_default().to_string(),
            )
        })
        .collect()
}

// ---------------------------------------------------------------------------
// A code turn replays step for step
// ---------------------------------------------------------------------------

/// The whole point of this stage: a run in code mode reconstructs end to end. A turn whose response
/// requested **zero** tool calls is followed by three recorded results for the calls its program
/// composed; each is attributed to that turn, in order, and the reconstruction completes — where
/// before it stopped at the first one with [`ReplayError::ExtraToolResult`].
#[test]
fn a_code_mode_run_replays_end_to_end() {
    let list = program_call(0, "list_dir", json!({ "path": "src" }));
    let read = program_call(1, "read_file", json!({ "path": "src/main.ts" }));
    let write = program_call(
        2,
        "write_file",
        json!({ "path": "notes.md", "contents": "19 bytes" }),
    );
    let rec = code_record(vec![
        model_io("root", 0, &resp_code_turn(PROGRAM)),
        tool_result("root", 1, &list, &ToolOutcome::ok("main.ts", "listed src")),
        tool_result(
            "root",
            2,
            &read,
            &ToolOutcome::ok("export const x = 1;", "read src/main.ts"),
        ),
        tool_result(
            "root",
            3,
            &write,
            &ToolOutcome::ok("wrote notes.md (8 bytes)", "wrote notes.md"),
        ),
        // A second turn opens with the previous one still holding no unanswered *requested* call —
        // the code turn requested none — so the truncated-capture guard must stay silent.
        model_io("root", 4, &resp_code_turn("Done — one source file.")),
    ]);

    let sink = CollectingSink::new();
    let out = reconstruct_with_sink(&rec, Box::new(sink.clone())).expect("a code run reconstructs");

    // Two model turns, three program-composed calls, one agent.
    assert_eq!(out.model_calls, 2);
    assert_eq!(out.tool_calls, 3);
    assert_eq!(out.agent_count, 1);

    // The driver's steps still equal the pure derivation the UI consumes — the seam-driven walk and
    // the record's own `steps()` agree on a code turn exactly as they do on a tool-calling one.
    assert_eq!(out.steps, rec.steps());
    assert_eq!(out.steps.len(), 2);

    // The turn really did request no native calls: `toolCalls` is absent from what it `did`. This is
    // the condition that used to make the reconstruction fail.
    assert!(
        out.steps[0].did.get("toolCalls").is_none(),
        "a code turn's response requests no tool calls: {}",
        out.steps[0].did,
    );

    // All three composed calls hang off that turn's step, in composition order, under their
    // ordinal-keyed synthetic ids.
    assert_eq!(
        tool_steps(&out.steps[0]),
        vec![
            ("program:0:list_dir".to_string(), "list_dir".to_string()),
            ("program:1:read_file".to_string(), "read_file".to_string()),
            ("program:2:write_file".to_string(), "write_file".to_string()),
        ],
    );
    assert_eq!(
        out.steps[0].tool_results[1].outcome["output"],
        "export const x = 1;"
    );
    assert!(out.steps[1].tool_results.is_empty());

    // And the reconstructed telemetry is the same `ToolCall`/`ToolResult` pairing the live code turn
    // streamed, in the order the program composed the calls.
    assert_eq!(
        core_stream(&sink.events(), "root"),
        vec![
            ("turn", String::new()),
            ("assistant", String::new()),
            ("call", "list_dir".to_string()),
            ("result", "list_dir:true".to_string()),
            ("call", "read_file".to_string()),
            ("result", "read_file:true".to_string()),
            ("call", "write_file".to_string()),
            ("result", "write_file:true".to_string()),
            ("turn", String::new()),
            ("assistant", String::new()),
        ],
    );
}

/// A program that calls the **same tool twice** replays as two distinct steps. This is why the
/// synthetic id is ordinal-keyed rather than named after the tool: two entries under one id would
/// be indistinguishable in the record, and the reconstruction would have no way to order them.
#[test]
fn a_program_calling_one_tool_twice_replays_both_calls() {
    let first = program_call(0, "write_file", json!({ "path": "a.txt", "contents": "a" }));
    let second = program_call(1, "write_file", json!({ "path": "b.txt", "contents": "b" }));
    let rec = code_record(vec![
        model_io("root", 0, &resp_code_turn(PROGRAM)),
        tool_result(
            "root",
            1,
            &first,
            &ToolOutcome::ok("wrote a.txt", "wrote a"),
        ),
        tool_result(
            "root",
            2,
            &second,
            &ToolOutcome::ok("wrote b.txt", "wrote b"),
        ),
    ]);

    let out = reconstruct_with_sink(&rec, Box::new(CollectingSink::new()))
        .expect("both calls reconstruct");

    assert_eq!(out.tool_calls, 2);
    assert_eq!(
        tool_steps(&out.steps[0]),
        vec![
            ("program:0:write_file".to_string(), "write_file".to_string()),
            ("program:1:write_file".to_string(), "write_file".to_string()),
        ],
    );
    assert_eq!(
        out.steps[0].tool_results[0].call["arguments"]["path"],
        "a.txt"
    );
    assert_eq!(
        out.steps[0].tool_results[1].call["arguments"]["path"],
        "b.txt"
    );
}

/// Attribution by prefix is not attribution to *nothing*: a program only ever runs inside a turn, so
/// a program-composed result with no open turn is still the structural divergence it always was.
#[test]
fn a_program_result_without_an_open_turn_is_still_a_divergence() {
    let write = program_call(0, "write_file", json!({ "path": "a.txt", "contents": "a" }));
    let rec = code_record(vec![tool_result(
        "root",
        0,
        &write,
        &ToolOutcome::ok("wrote a.txt", "wrote a"),
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

/// The guard on the rule: the prefix exemption did **not** loosen the native path. A turn that
/// requested one call, followed by two recorded native results, is still an over-supplied record —
/// the surplus result answers a call the model never made and is reported, not absorbed.
#[test]
fn a_native_tool_result_still_requires_a_matching_pending_call() {
    let called = native_call("call_abc", "write_file", json!({ "path": "a.txt" }));
    let surplus = native_call("call_def", "shell", json!({ "command": "ls" }));
    let rec = native_record(vec![
        model_io("root", 0, &resp_calling("writing", called.clone())),
        tool_result("root", 1, &called, &ToolOutcome::ok("wrote a.txt", "wrote")),
        tool_result("root", 2, &surplus, &ToolOutcome::ok("a.txt", "listed")),
    ]);

    let err = reconstruct_with_sink(&rec, Box::new(CollectingSink::new())).unwrap_err();
    assert_eq!(
        err,
        ReplayError::ExtraToolResult {
            agent_id: "root".to_string(),
            seq: 2,
            tool: "shell".to_string(),
        },
    );
}

/// The discriminator is a **prefix**, not a substring: a provider-assigned id that merely contains
/// `program:` is a native call and is still matched by id and name. Nothing about a program's calls
/// may be inferred from an id the model's provider chose.
#[test]
fn a_native_id_that_merely_contains_the_prefix_is_still_matched() {
    let called = native_call("call_program:7", "write_file", json!({ "path": "a.txt" }));
    let recorded = native_call("call_program:7", "shell", json!({ "command": "ls" }));
    let rec = native_record(vec![
        model_io("root", 0, &resp_calling("writing", called)),
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

/// The other half of the same guard: the exemption is scoped to a **code turn**, not to the id.
///
/// A record whose run was tool-calling — its response requested a native call — cannot also contain
/// a program-composed result: a turn either offers native tools or runs a program, never both. Such
/// a result is therefore structurally impossible, and it is checked exactly as any other surplus
/// result is rather than being waved through on the strength of its id.
#[test]
fn a_program_result_inside_a_native_turn_is_a_divergence() {
    let called = native_call("call_abc", "shell", json!({ "command": "ls" }));
    let composed = program_call(0, "write_file", json!({ "path": "a.txt", "contents": "a" }));
    let rec = native_record(vec![
        model_io("root", 0, &resp_calling("listing", called.clone())),
        tool_result(
            "root",
            1,
            &composed,
            &ToolOutcome::ok("wrote a.txt", "wrote"),
        ),
        tool_result("root", 2, &called, &ToolOutcome::ok("a.txt", "listed")),
    ]);

    let err = reconstruct_with_sink(&rec, Box::new(CollectingSink::new())).unwrap_err();
    assert_eq!(
        err,
        ReplayError::ToolResultMismatch {
            agent_id: "root".to_string(),
            seq: 1,
            expected: "shell".to_string(),
            recorded: "write_file".to_string(),
        },
    );
}

/// A code-mode turn ignores a `toolCalls` its response happened to carry.
///
/// Some models emit a native tool call from habit even when offered none; the loop drops it with a
/// warning and never dispatches it, so the record holds no outcome for it. Matching against it here
/// would report a run that behaved correctly as a truncated capture — the record's completeness is
/// judged by what the loop *dispatches*, which in code mode is exactly the program's calls.
#[test]
fn a_code_turn_ignores_a_tool_call_its_response_carried() {
    let hallucinated = native_call("call_abc", "shell", json!({ "command": "ls" }));
    let composed = program_call(0, "write_file", json!({ "path": "a.txt", "contents": "a" }));
    let rec = code_record(vec![
        model_io("root", 0, &resp_calling(PROGRAM, hallucinated)),
        tool_result(
            "root",
            1,
            &composed,
            &ToolOutcome::ok("wrote a.txt", "wrote"),
        ),
        model_io("root", 2, &resp_code_turn("Done.")),
    ]);

    let out = reconstruct_with_sink(&rec, Box::new(CollectingSink::new()))
        .expect("the ignored call is not a gap");
    assert_eq!(out.tool_calls, 1);
    assert_eq!(
        tool_steps(&out.steps[0]),
        vec![("program:0:write_file".to_string(), "write_file".to_string())],
    );
}
