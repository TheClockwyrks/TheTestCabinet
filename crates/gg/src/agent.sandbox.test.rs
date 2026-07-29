//! Responses as code, through the **whole loop**: a model emits TypeScript, gg type-strips it,
//! runs it in the committed wasmtime component, and services every call it composes on the async
//! loop.
//!
//! These are the tests that hold the seam between the sandbox and the loop. The sandbox's own
//! suite (`sandbox.test.rs`) proves that a program runs and that the membrane is typed; nothing
//! there can prove that a program's `spawnSubagent` reaches the **scheduler**, that its
//! `evictFileView` really shrinks the live window, or that a picture it read reaches the model —
//! because all three of those live in [`run_code_program`], not in the sandbox.
//!
//! # These cost a component compile each
//!
//! `cargo nextest` runs one process per test, and any test here compiles the ~13 MB artifact once
//! (~1.2 s with the root manifest's cranelift `[profile.dev.package.*]` pins). Each function
//! therefore asserts everything its scenario can support rather than being split one assertion per
//! function; add an assertion to an existing scenario before adding a scenario.

use super::*;
use crate::model::Role;

/// A client that answers the first turn with `program` — its whole reply, exactly as this protocol
/// asks — and then ends the session by calling `finish`.
///
/// One program per test is the shape almost every scenario here needs: the loop's contract is that a
/// turn *is* a program, so driving one program and then finishing is the smallest complete run.
fn one_program(model_id: &str, program: &str) -> Box<dyn ModelClient> {
    scripted_programs(model_id, &[program])
}

/// A client that answers turn *n* with `programs[n]` and then finishes.
fn scripted_programs(model_id: &str, programs: &[&str]) -> Box<dyn ModelClient> {
    Box::new(MockClient::new(model_id, program_script(programs)))
}

/// The script behind [`scripted_programs`]: one program per turn — the whole reply, with no fence
/// and nothing around it — and then the program that ends the session.
///
/// There is no prose turn at the end and there cannot be: under this protocol nothing but
/// [`finish`](crate::sandbox::FINISH_FUNCTION) ends a session, and a reply that is not a program is
/// a failed turn fed back to the model.
fn program_script(programs: &[&str]) -> Vec<ModelResponse> {
    let mut script: Vec<ModelResponse> =
        programs.iter().map(|program| code_reply(program)).collect();
    script.push(code_reply(FINISHING_PROGRAM));
    script
}

/// The `tool`-role messages in `messages` that **no preceding assistant turn requested** — the shape
/// an OpenAI-shaped provider rejects the whole request for (*"messages with role 'tool' must be a
/// response to a preceding message with 'tool_calls'"*).
fn dangling_tool_messages(messages: &[Message]) -> Vec<String> {
    let mut requested: Vec<&str> = Vec::new();
    let mut dangling: Vec<String> = Vec::new();
    for message in messages {
        for call in &message.tool_calls {
            requested.push(call.id.as_str());
        }
        if message.role == Role::Tool {
            let id = message.tool_call_id.as_deref().unwrap_or("<no id>");
            if !requested.contains(&id) {
                dangling.push(id.to_string());
            }
        }
    }
    dangling
}

/// The assistant `tool_calls` in `messages` that **no `tool` message answers** — the mirror-image
/// invalid shape, which a model emitting a native call on a code turn would otherwise produce.
fn unanswered_tool_calls(messages: &[Message]) -> Vec<String> {
    let answered: Vec<&str> = messages
        .iter()
        .filter(|message| message.role == Role::Tool)
        .filter_map(|message| message.tool_call_id.as_deref())
        .collect();
    messages
        .iter()
        .flat_map(|message| message.tool_calls.iter())
        .filter(|call| !answered.contains(&call.id.as_str()))
        .map(|call| call.id.clone())
        .collect()
}

/// Assert every request gg built is a conversation a provider will accept.
fn assert_valid_conversations(requests: &[Vec<Message>]) {
    assert!(!requests.is_empty(), "no request was recorded");
    for (turn, messages) in requests.iter().enumerate() {
        assert!(
            dangling_tool_messages(messages).is_empty(),
            "turn {turn} sent a `tool` message answering a call no assistant turn made: {:?}",
            dangling_tool_messages(messages)
        );
        assert!(
            unanswered_tool_calls(messages).is_empty(),
            "turn {turn} left an assistant `tool_calls` entry unanswered: {:?}",
            unanswered_tool_calls(messages)
        );
    }
}

/// Run `client`'s script against a fresh workspace under `set`, returning the workspace, the
/// session outcome and the emitted stream.
async fn drive_code_run(
    dir: &TempDir,
    set: GgCapabilitySet,
    client: impl Fn(&GgSlotBinding) -> Box<dyn ModelClient> + Send + Sync + 'static,
) -> (SessionOutcome, Vec<GgTelemetryEvent>) {
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-code".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), set);
    let factory = ScriptedFactory::new().slot(ROOT_AGENT, client);
    let outcome = run_with_factory(&inv, &emitter, Arc::new(factory)).await;
    (outcome, sink.events())
}

/// The single `CodeExecution` payload a code-mode turn emits, or `None`.
fn first_code_execution(
    events: &[GgTelemetryEvent],
) -> Option<(bool, u64, Option<u64>, Option<String>)> {
    code_executions(events).into_iter().next()
}

/// Every `CodeExecution` payload in the stream, in order.
fn code_executions(events: &[GgTelemetryEvent]) -> Vec<(bool, u64, Option<u64>, Option<String>)> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::CodeExecution {
                ok,
                tool_calls,
                duration_ms,
                error,
                ..
            } => Some((*ok, *tool_calls, *duration_ms, error.clone())),
            _ => None,
        })
        .collect()
}

/// Every `CodeExecution`'s completion summary, in order — `Some` on exactly the turn that ended the
/// run, and absent on every other, which is what makes "did this run end because the model said so?"
/// answerable from the stream alone.
fn code_completions(events: &[GgTelemetryEvent]) -> Vec<Option<String>> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::CodeExecution { finished, .. } => Some(finished.clone()),
            _ => None,
        })
        .collect()
}

/// The summaries subagents returned to their spawners, in order.
fn agent_returns(events: &[GgTelemetryEvent]) -> Vec<String> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::AgentReturned { summary } => Some(summary.clone()),
            _ => None,
        })
        .collect()
}

/// The `ToolCall`/`ToolResult` names in stream order, tagged with which kind they were — the
/// evidence that a program's composed calls are as visible as a native call's.
fn tool_telemetry(events: &[GgTelemetryEvent]) -> Vec<(&'static str, String)> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::ToolCall { name, .. } => Some(("call", name.clone())),
            GgTelemetryKind::ToolResult { name, .. } => Some(("result", name.clone())),
            _ => None,
        })
        .collect()
}

/// The terminal session status.
fn ended_with(events: &[GgTelemetryEvent]) -> String {
    match &events.last().expect("a terminal event").kind {
        GgTelemetryKind::SessionEnded { status } => status.clone(),
        other => panic!("the stream must end with SessionEnded, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// The headline path
// ---------------------------------------------------------------------------

/// The headline offline e2e: with responses-as-code on, the turn is driven through the sandbox —
/// the model emits TypeScript (a loop, a conditional, a type annotation that only runs because the
/// types were stripped, and composed typed calls), gg runs it, its calls fire against the real
/// toolset, and the program's result feeds back so the loop continues to a clean finish.
#[tokio::test]
async fn responses_as_code_routes_the_turn_through_the_sandbox() {
    let dir = TempDir::new().unwrap();
    let (outcome, events) = drive_code_run(&dir, code_set("mock/primary", json!({})), |b| {
        Box::new(MockClient::with_responses_as_code_script(&b.model_id))
    })
    .await;
    assert_eq!(outcome, SessionOutcome::Ran);

    // (a) the program's composed `writeFile` calls really wrote the `.txt` level files, and its
    // conditional skipped the `.md` name — proof the loop + conditional ran in the sandbox.
    for level in MOCK_CODE_LEVEL_FILES {
        assert!(
            dir.path().join(level).exists(),
            "the program should have written {level}"
        );
    }
    assert!(
        !dir.path().join("notes.md").exists(),
        "the conditional should have skipped the .md name"
    );

    // (b) exactly one code execution, successful, with the four composed tool calls counted
    // (listDir + three writeFile) and the time it ran reported.
    let (ok, tool_calls, duration_ms, error) =
        first_code_execution(&events).expect("a CodeExecution event");
    assert!(ok, "the program ran successfully");
    assert_eq!(tool_calls, 4, "listDir + three writeFile were composed");
    assert!(
        duration_ms.is_some_and(|ms| ms > 0),
        "a successful run reports the time it took"
    );
    assert!(error.is_none(), "a clean run carries no error");

    // (c) the session completed because the model said so — the second program called `finish` —
    // and the summary records the code-shaped mode and both code-shaped turns.
    assert_eq!(ended_with(&events), "completed");
    assert_eq!(
        code_completions(&events),
        vec![
            None,
            Some("The level files are written; the game scaffold is complete.".to_string())
        ],
        "only the finishing turn carries a completion"
    );
    let summary = session_summary(&events).expect("a session summary");
    assert_eq!(summary.execution_mode, "responses_as_code");
    assert_eq!(summary.code_executions, 2);
}

/// Completion **validation** gates a code-mode `finish`: a program that calls `finish` before the
/// validation commands pass does not end the run — the failure is fed back and the run continues —
/// and a later program that satisfies validation and finishes ends it. Proves the same completion
/// gate the tool-calling path uses composes with responses-as-code.
/// A program compacts its own context: `context.compact(summary, files)` reaches the loop, the
/// window is rewritten around the summary, and the file the program named is re-read into it.
///
/// It also pins the half of self-compaction that only code mode has. The call is bound into every
/// program's scope under this strategy, so a program may compact itself **unprompted** — gg does not
/// have to have asked — and the rewrite is deferred until the program has ended, because resetting
/// the context a program is running in would pull the window out from under the turn still using it.
#[tokio::test]
async fn a_program_compacts_its_own_context_window() {
    use test_cabinet_core::gg::{CAPABILITY_COMPACTION, COMPACTION_STRATEGY_SELF_COMPACTION};

    const SUMMARY: &str = "scaffolded main.ts; next is the render loop";
    let dir = TempDir::new().unwrap();
    let mut set = code_set("mock/primary", json!({}));
    set.agents[0].capabilities.push(GgCapabilityConfig {
        id: CAPABILITY_COMPACTION.to_string(),
        enabled: true,
        implementation: Some(COMPACTION_STRATEGY_SELF_COMPACTION.to_string()),
        params: json!({}),
    });

    let program = format!(
        "fs.writeFile(\"main.ts\", \"export const KEPT = 1;\");\n\
         context.compact(\"{SUMMARY}\", [\"main.ts\"]);\n\
         console.log(\"compaction requested\");"
    );
    let (outcome, events) = drive_code_run(&dir, set, move |b| {
        scripted_programs(&b.model_id, &[program.as_str()])
    })
    .await;
    assert_eq!(outcome, SessionOutcome::Ran);

    let boundary = events
        .iter()
        .find_map(|event| match &event.kind {
            GgTelemetryKind::Compaction {
                strategy, summary, ..
            } => Some((strategy.clone(), summary.clone())),
            _ => None,
        })
        .expect("the program's compaction reached the loop");
    assert_eq!(boundary.0, COMPACTION_STRATEGY_SELF_COMPACTION);
    assert!(boundary.1.contains(SUMMARY), "got {:?}", boundary.1);

    // The program ran to its end before the window was rewritten — the log line it printed *after*
    // the call is the proof, since a compaction performed mid-program would have taken the store
    // with it.
    assert!(
        events
            .iter()
            .any(|event| matches!(&event.kind, GgTelemetryKind::CodeExecution { ok: true, .. })),
        "the program ran cleanly to its end"
    );
    // The file it asked to keep is in the restarted window.
    let after = events
        .iter()
        .skip_while(|event| !matches!(event.kind, GgTelemetryKind::Compaction { .. }))
        .find_map(|event| match &event.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } => Some(by_source.clone()),
            _ => None,
        })
        .expect("a breakdown follows the boundary");
    let file_views = after
        .iter()
        .find(|band| band.source == GgContextSource::FileView)
        .map(|band| band.tokens)
        .unwrap_or(0);
    assert!(
        file_views > 0,
        "the re-read file is in the window: {after:?}"
    );
}

#[tokio::test]
async fn responses_as_code_completion_is_gated_by_validation() {
    let dir = TempDir::new().unwrap();
    let mut set = code_set("mock/primary", json!({}));
    // Gate completion on a file the program must create before its `finish` is accepted.
    let mut completion = GgCapabilityConfig::enabled(test_cabinet_core::gg::CAPABILITY_COMPLETION);
    completion.params = json!({ "validation": ["test -f ready.txt"] });
    set.agents[0].capabilities.push(completion);

    // Turn 1 finishes without creating the file (validation rejects it, the run continues); turn 2
    // creates the file and finishes (validation passes, the run ends).
    let script = vec![
        code_reply("harness.finish(\"attempt one\");"),
        code_reply("fs.writeFile(\"ready.txt\", \"x\");\nharness.finish(\"attempt two\");"),
    ];
    let (outcome, events) = drive_code_run(&dir, set, move |b| {
        Box::new(MockClient::new(&b.model_id, script.clone()))
    })
    .await;

    assert_eq!(outcome, SessionOutcome::Ran);
    assert_eq!(
        ended_with(&events),
        "completed",
        "the second finish passed validation"
    );
    assert!(
        dir.path().join("ready.txt").exists(),
        "the second program created the file validation checks for"
    );
    // The first `finish` was rejected: gg says so on the operator stream and the run took a second
    // code turn rather than ending on the first.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::Log { level, message }
                if level == "warn" && message.contains("validation") && message.contains("rejected")
        )),
        "a rejected completion is announced on the stream"
    );
    let summary = session_summary(&events).expect("a session summary");
    assert_eq!(summary.code_executions, 2, "both code turns ran");
}

/// The off arm is unchanged: a run **without** responses-as-code drives the ordinary tool-calling
/// path, emits no `CodeExecution`, and records the tool-calling execution mode.
#[tokio::test]
async fn tool_calling_mode_is_unchanged_and_records_its_mode() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-tc".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), GgCapabilitySet::minimal("mock/echo"));

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);

    let events = sink.events();
    // The tool-calling path still wrote the default script's file...
    assert!(dir.path().join("index.html").exists());
    // ...and emitted no code execution.
    assert!(
        first_code_execution(&events).is_none(),
        "a tool-calling run runs no program"
    );
    let summary = session_summary(&events).expect("a session summary");
    assert_eq!(summary.execution_mode, "tool_calling");
    assert_eq!(summary.code_executions, 0);
}

// ---------------------------------------------------------------------------
// What counts as a program, and what counts as "finished"
// ---------------------------------------------------------------------------

/// A model that emits a **native tool call** on a code turn — a reflex some models bring from their
/// tool-use training, despite being offered no tool definitions at all — is ignored loudly, and the
/// conversation stays valid.
///
/// Keeping the call would put an assistant `tool_calls` entry in the window that nothing ever
/// answers, because the loop dispatches the *program*, not the call. That is the shape a provider
/// rejects the whole request for, so it is dropped; the `warn` is what keeps it measurable.
#[tokio::test]
async fn a_native_tool_call_on_a_code_turn_is_ignored_loudly() {
    let dir = TempDir::new().unwrap();
    let mut script = program_script(&["return fs.writeFile(\"from-program.txt\", \"hi\");"]);
    script[0].tool_calls = vec![ToolCall {
        id: "call_habit".to_string(),
        name: "write_file".to_string(),
        arguments: json!({ "path": "from-tool-call.txt", "contents": "hi" }),
    }];
    script[0].finish_reason = FinishReason::ToolCalls;
    let (outcome, events, requests) =
        drive_recorded_code_run(&dir, code_set("mock/primary", json!({})), script).await;

    assert_eq!(outcome, SessionOutcome::Ran);
    assert_eq!(ended_with(&events), "completed");
    assert_valid_conversations(&requests);
    assert!(
        dir.path().join("from-program.txt").exists(),
        "the program is what runs"
    );
    assert!(
        !dir.path().join("from-tool-call.txt").exists(),
        "the ignored call must not be dispatched"
    );
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::Log { level, message }
                if level == "warn" && message.contains("requested 1 native tool call(s)")
                    && message.contains("write_file")
        )),
        "the anomaly is named rather than silently swallowed"
    );
}

// ---------------------------------------------------------------------------
// Failures are turn outcomes, never crashes
// ---------------------------------------------------------------------------

/// A program that runs past its execution timeout surfaces cleanly: the failed execution is fed back
/// as the turn's outcome and the run continues to a clean finish rather than crashing.
#[tokio::test]
async fn timeout_surfaces_cleanly() {
    let dir = TempDir::new().unwrap();
    let (outcome, events) = drive_code_run(
        &dir,
        code_set(
            "mock/primary",
            json!({ "timeoutSecs": RUNAWAY_TIMEOUT_SECS }),
        ),
        |b| {
            Box::new(MockClient::with_responses_as_code_runaway_script(
                &b.model_id,
            ))
        },
    )
    .await;

    // The run did not crash — it ran to a terminal session.
    assert_eq!(outcome, SessionOutcome::Ran);
    let (ok, _tool_calls, duration, error) =
        first_code_execution(&events).expect("a CodeExecution event");
    assert!(!ok, "a timed-out program is not a clean execution");
    assert!(
        duration.is_some_and(|ms| ms > 0),
        "the time it ran is reported even on a timeout"
    );
    let error = error.expect("the sandbox failure is reported");
    assert!(
        error.contains("timeout"),
        "the failure names the ceiling it hit: {error}"
    );
    assert_eq!(ended_with(&events), "completed");
}

/// A program that could not be run at all is still a turn outcome. A transpile error is the model's
/// to fix, so it is fed back and the loop carries on — and the feedback says the thing that makes
/// it different from every other failure: nothing ran.
#[tokio::test]
async fn a_sandbox_failure_is_a_turn_outcome_not_a_crash() {
    let dir = TempDir::new().unwrap();
    let (outcome, events) = drive_code_run(&dir, code_set("mock/primary", json!({})), |b| {
        scripted_programs(
            &b.model_id,
            &[
                // Not parseable at all.
                "const x = ;",
                // A module feature the sandbox has no implementation of. It is written across
                // several lines deliberately: `drop-imports` declines a multi-line import (deciding
                // where one ends is a parse), so this reaches the transpiler exactly as the model
                // wrote it and fails there, which is the shape this test is about.
                "import {\n  readFileSync,\n} from \"node:fs\";\nreturn 1;",
            ],
        )
    })
    .await;

    assert_eq!(outcome, SessionOutcome::Ran);
    let executions = code_executions(&events);
    assert_eq!(
        executions.len(),
        3,
        "both failures were measured, and so was the turn that finished"
    );
    for (ok, tool_calls, _, error) in &executions[..2] {
        assert!(!ok, "a program that never ran is not a clean execution");
        assert_eq!(*tool_calls, 0, "nothing was dispatched");
        assert!(
            error.as_ref().is_some_and(|e| e.contains("compile")),
            "the failure is reported as a compile failure: {error:?}"
        );
    }
    assert_eq!(ended_with(&events), "completed");
}

// ---------------------------------------------------------------------------
// Shell output offloading, through the program surface
// ---------------------------------------------------------------------------

/// **A program's `system.shell` is offloaded on the same terms a tool call is.**
///
/// The policy is applied inside `run_command`, which both execution modes reach — so this is the
/// test that the code path actually *gets* there rather than running the chatty command straight
/// into the program's hands. The program writes the `output` field it was handed to a workspace
/// file, so the assertion is about what the program saw, not about what gg printed around it.
#[tokio::test]
async fn a_program_gets_the_offloaded_tail_and_the_paths_to_the_rest() {
    let dir = TempDir::new().unwrap();
    let mut set = code_set("mock/primary", json!({}));
    let shell = set.agents[0]
        .capabilities
        .iter_mut()
        .find(|capability| capability.id == CAPABILITY_SHELL)
        .expect("the minimal set enables shell");
    shell.implementation = Some(SHELL_OUTPUT_OFFLOAD.to_string());
    shell.params = json!({ "maxLines": 3 });

    let program = "const out = system.shell(\"for i in $(seq 1 60); do echo line-$i; done\").output;\n\
                   fs.writeFile(\"seen.txt\", out);";
    let (outcome, events) =
        drive_code_run(&dir, set, move |b| one_program(&b.model_id, program)).await;

    assert_eq!(outcome, SessionOutcome::Ran);
    assert_eq!(ended_with(&events), "completed");
    let seen = std::fs::read_to_string(dir.path().join("seen.txt")).expect("the program wrote it");
    assert!(
        seen.starts_with("line-58\nline-59\nline-60\n"),
        "the program was handed the last three lines: {seen}"
    );
    assert!(!seen.contains("line-57"), "{seen}");
    // ...and the note that tells it where the other fifty-seven are, so the remainder is one grep
    // away rather than gone.
    assert!(seen.contains("Output truncated"), "{seen}");
    // The gg-managed directory the pair went to (`OFFLOAD_DIR`), spelled out: this run resolved
    // its policy from a real capability set, so the path is the production one.
    assert!(seen.contains("/tmp/gg/shell"), "{seen}");
    for suffix in [".stdout", ".stderr"] {
        assert!(seen.contains(suffix), "the note names both files: {seen}");
    }
}

// ---------------------------------------------------------------------------
// The servicing seam: telemetry, ids, delegation, context, skills, images
// ---------------------------------------------------------------------------

/// Composed calls stay as visible as native ones: every call streams a `ToolCall` immediately
/// followed by its `ToolResult`, in the order the program made them.
#[tokio::test]
async fn composed_calls_stream_call_then_result_telemetry_in_order() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("seed.txt"), "hello\n").unwrap();
    let (outcome, events) = drive_code_run(&dir, code_set("mock/primary", json!({})), |b| {
        one_program(
            &b.model_id,
            "const text = fs.readTextFile(\"seed.txt\");\n\
             fs.writeFile(\"copy.txt\", text.toUpperCase());\n\
             const entries = fs.listDir(\".\");\n\
             return entries.length;",
        )
    })
    .await;

    assert_eq!(outcome, SessionOutcome::Ran);
    assert_eq!(
        tool_telemetry(&events),
        vec![
            ("call", "read_file".to_string()),
            ("result", "read_file".to_string()),
            ("call", "write_file".to_string()),
            ("result", "write_file".to_string()),
            ("call", "list_dir".to_string()),
            ("result", "list_dir".to_string()),
        ],
        "each composed call streams its own pair, in program order"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("copy.txt")).unwrap(),
        "HELLO\n"
    );
}

/// The `CodeExecution` event's `tool_calls` is the number of `ToolCall`/`ToolResult` pairs the turn
/// actually streamed — the invariant that makes the measurement comparable with the tool-calling
/// path, where one turn's calls are counted the same way.
#[tokio::test]
async fn code_execution_tool_calls_equals_the_telemetry_pair_count() {
    let dir = TempDir::new().unwrap();
    let (outcome, events) = drive_code_run(&dir, code_set("mock/primary", json!({})), |b| {
        one_program(
            &b.model_id,
            "for (let i = 0; i < 5; i += 1) {\n  fs.writeFile(`out-${i}.txt`, String(i));\n}\n\
             return fs.listDir(\".\").length;",
        )
    })
    .await;

    assert_eq!(outcome, SessionOutcome::Ran);
    let (_, tool_calls, _, _) = first_code_execution(&events).expect("a CodeExecution event");
    let pairs = tool_telemetry(&events);
    assert_eq!(
        pairs.len() as u64,
        tool_calls * 2,
        "one ToolCall and one ToolResult per counted call: {pairs:?}"
    );
    assert_eq!(tool_calls, 6, "five writes plus the closing list");
}

/// A program that calls one tool repeatedly must not mint one id twice: the synthetic id is
/// ordinal-keyed, and anything recorded against it (the replay driver most of all) is keyed by that
/// id. This asserts against the **replay record**, which is the consumer that would be corrupted.
#[tokio::test]
async fn the_synthetic_call_ids_are_unique_within_a_turn() {
    let dir = TempDir::new().unwrap();
    let mut set = code_set("mock/primary", json!({}));
    set.agents[0]
        .capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_REPLAY));
    let (outcome, _events) = drive_code_run(&dir, set, |b| {
        one_program(
            &b.model_id,
            "fs.writeFile(\"a.txt\", \"1\");\nfs.writeFile(\"b.txt\", \"2\");\n\
             fs.writeFile(\"c.txt\", \"3\");\nreturn 3;",
        )
    })
    .await;
    assert_eq!(outcome, SessionOutcome::Ran);

    let record: GgReplayRecord = serde_json::from_str(
        &std::fs::read_to_string(dir.path().join(GG_REPLAY_ARTIFACT_PATH)).unwrap(),
    )
    .unwrap();
    let ids: Vec<String> = record
        .entries
        .iter()
        .filter_map(|entry| match &entry.kind {
            GgReplayEntryKind::ToolResult { call, .. } => {
                Some(call["id"].as_str().expect("a recorded call id").to_string())
            }
            _ => None,
        })
        .collect();
    assert_eq!(
        ids,
        vec![
            "program:0:write_file",
            "program:1:write_file",
            "program:2:write_file"
        ],
        "each composed call is recorded under its own ordinal id"
    );
}

/// A program's delegation still goes through the scheduler: the code-mode parent's program spawns a
/// subagent (also code-driven) and waits for it, the child runs and writes its file, and the agent
/// tree records the spawn — exactly as a tool-calling delegation would.
#[tokio::test]
async fn a_program_subagent_still_honours_the_scheduler() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-code-sub".to_string()), Box::new(sink.clone()));
    // Subagents + multi-model + responses-as-code, under a cap of 1 (so the child only runs once
    // the waiting parent frees its slot — the scheduler's blocked-frees-slot rule).
    let mut set = subagent_set(1, 3, &["subagent"]);
    for agent in &mut set.agents {
        agent
            .capabilities
            .push(GgCapabilityConfig::enabled(CAPABILITY_RESPONSES_AS_CODE));
    }
    let inv = invocation(dir.path(), set);
    let factory = ScriptedFactory::new()
        .slot(ROOT_AGENT, |b| {
            Box::new(MockClient::with_responses_as_code_parent_script(
                &b.model_id,
            ))
        })
        .slot("subagent", |b| {
            Box::new(MockClient::with_responses_as_code_child_script(&b.model_id))
        });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    // The child actually ran (its program wrote the greeting file in the shared workspace).
    assert!(
        dir.path().join(MOCK_SUBAGENT_FILE).exists(),
        "the code-driven subagent wrote its file, so it ran under the scheduler"
    );

    let events = sink.events();
    // A subagent was spawned at depth 1 on the `subagent` slot — the spawn went through the tree.
    let spawns = agent_spawns(&events);
    assert!(
        spawns
            .iter()
            .any(|(_, parent, slot, depth, _)| parent.is_some()
                && slot == "subagent"
                && *depth == 1),
        "a subagent was spawned from the program at depth 1: {spawns:?}"
    );
    // Both agents ran code-shaped turns (the parent's and the child's programs), and the parent's
    // `waitForSubagents` composed onto the same turn as its `spawnSubagent`.
    assert!(
        code_executions(&events).len() >= 2,
        "both the parent and the subagent ran a program"
    );
    let parent_calls = tool_telemetry(&events);
    assert!(
        parent_calls.contains(&("call", "spawn_subagent".to_string()))
            && parent_calls.contains(&("call", "wait_for_subagents".to_string())),
        "the spawn and the wait were both composed by one program: {parent_calls:?}"
    );
    // The child ended its own session by calling `finish`, and that summary — not its program
    // source — is what its spawner collected.
    assert!(
        agent_returns(&events).contains(&MOCK_SUBAGENT_RETURN.to_string()),
        "the child's `finish` summary is its return value: {:?}",
        agent_returns(&events)
    );
    let summary = session_summary(&events).expect("a session summary");
    assert_eq!(summary.execution_mode, "responses_as_code");
}

/// A program that reads a picture shows it to the model. Vision is the one thing a program cannot
/// carry in its return value — an image is worth looking at, not base64'ing into a variable — so it
/// rides out on the outcome and is attached to the turn's feedback.
///
/// The proof is the *provider's* view: the second request carries an image, which only happens if
/// the loop attached one.
#[tokio::test]
async fn a_program_read_of_a_picture_shows_it_to_the_model() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("ref.png"), TEST_PNG).unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-code-image".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), code_set("mock/primary", json!({})));

    let seen = Arc::new(Mutex::new(Vec::<bool>::new()));
    let recorded = Arc::clone(&seen);
    let factory = ScriptedFactory::new().slot(ROOT_AGENT, move |b| {
        Box::new(ImageWatchingClient {
            model_id: b.model_id.clone(),
            turn: AtomicUsize::new(0),
            seen: Arc::clone(&recorded),
        })
    });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let requests = seen.lock().unwrap().clone();
    assert_eq!(
        requests,
        vec![false, true],
        "the turn after the program carries the picture it read"
    );
    let (ok, _, _, _) = first_code_execution(&sink.events()).expect("a CodeExecution event");
    assert!(ok, "the read succeeded inside the program");
}

/// A client that records whether each request carried an image, emits one program that reads a
/// picture, and then finishes.
struct ImageWatchingClient {
    model_id: String,
    turn: AtomicUsize,
    seen: Arc<Mutex<Vec<bool>>>,
}

#[async_trait::async_trait]
impl ModelClient for ImageWatchingClient {
    async fn complete(
        &self,
        messages: &[Message],
        _tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        self.seen
            .lock()
            .unwrap()
            .push(messages.iter().any(|m| !m.images.is_empty()));
        let text = if self.turn.fetch_add(1, Ordering::SeqCst) == 0 {
            "const read = fs.readFile(\"ref.png\");\nreturn read.kind;"
        } else {
            "harness.finish(\"I have seen the mockup.\");"
        };
        Ok(code_reply(text))
    }

    fn model_id(&self) -> &str {
        &self.model_id
    }
}

/// A program's context reclaim really acts on the **live window**. Without the loop performing it,
/// the two reclaim tools are a lie in code mode: they validate their argument, return an outcome
/// with no structured result at all, and free nothing — so a program calling either would be thrown
/// into with a gg-defect diagnostic instead of being handed a report.
///
/// This asserts both halves. The program calls `evictFileView` and `archiveThread` and *returns
/// their reports*, which it can only do if the loop rewrote each outcome with what it actually
/// freed; and the stream carries the `ContextManaged` effects the native path emits, one of them
/// with a non-zero reclaim.
///
/// `evictFileView` truthfully reports **nothing to evict**, and that is the correct answer: a
/// code-mode `readFile` is deliberately not pushed into the window as a file view (a program that
/// reads forty files must not put forty files in the context — consuming reads inside the program
/// is half the point of responses-as-code). `archiveThread` is the reclaim with real work to do
/// here, and it is the one asserted to free tokens.
#[tokio::test]
async fn a_program_reclaim_really_acts_on_the_live_window() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("big.txt"), "a line\n".repeat(400)).unwrap();
    let mut set = code_set("mock/primary", json!({}));
    set.agents[0].capabilities.push(GgCapabilityConfig::enabled(
        CAPABILITY_AGENT_MANAGED_CONTEXT,
    ));
    let (outcome, events) = drive_code_run(&dir, set, |b| {
        scripted_programs(
            &b.model_id,
            &[
                // Turn 1: read a large file, so the thread carries a large turn.
                "return fs.readTextFile(\"big.txt\").length;",
                // Turn 2: both reclaims, reporting what each one says it freed. Returning the
                // reports at all proves the loop rewrote the outcomes: an un-rewritten outcome has
                // no structured result and would have thrown.
                "const evicted = context.evictFileView();\n\
                 const archived = context.archiveThread(0);\n\
                 console.log(evicted.detail);\n\
                 return { evicted: evicted.items, archived: archived.items, \
                 freed: archived.reclaimedTokens };",
            ],
        )
    })
    .await;

    assert_eq!(outcome, SessionOutcome::Ran);
    let executions = code_executions(&events);
    assert!(
        executions.iter().all(|(ok, ..)| *ok),
        "both programs ran cleanly, so both reclaims returned a report: {executions:?}"
    );

    // The loop performed each reclaim and emitted the same effect events the native path does.
    let managed: Vec<(GgContextAction, u64, u64)> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::ContextManaged {
                action,
                reclaimed_tokens,
                items,
                ..
            } => Some((*action, *reclaimed_tokens, *items)),
            _ => None,
        })
        .collect();
    assert_eq!(
        managed.len(),
        2,
        "each reclaim the program composed emitted its own ContextManaged effect: {managed:?}"
    );
    assert_eq!(managed[0].0, GgContextAction::EvictFileViews);
    assert_eq!(
        managed[0].2, 0,
        "a code-mode read is not a file view, so there is nothing to evict — reported honestly"
    );
    assert_eq!(managed[1].0, GgContextAction::ArchiveThread);
    assert!(
        managed[1].2 > 0 && managed[1].1 > 0,
        "archiving the thread really freed items and tokens: {managed:?}"
    );
    assert_eq!(ended_with(&events), "completed");
}

/// A program's `readSkill` pins the skill into the context and emits the updated skills state,
/// exactly as a native read does — the behaviour that makes a skill stay available for the rest of
/// the session instead of being read once into a variable and lost.
///
/// It also pins it under an envelope a provider will accept. The native path pins the body as the
/// `tool` message answering its `read_skill` call; a code turn has no assistant `tool_calls` for
/// such a message to answer, so pinning one would dangle from the moment it entered the window and
/// every later turn would be rejected outright. The conversation gg actually builds is therefore
/// asserted here, not only the events it emitted.
#[tokio::test]
async fn a_program_read_skill_pins_the_skill_and_emits_skills_state() {
    let dir = TempDir::new().unwrap();
    seed_default_skill(dir.path());
    let (outcome, events, requests) = drive_recorded_code_run(
        &dir,
        code_set("mock/primary", json!({})),
        program_script(&[
            &format!("return skills.readSkill(\"{DEFAULT_MOCK_SKILL}\").length;"),
            // A second read of the same skill must not pin a second copy.
            &format!("return skills.readSkill(\"{DEFAULT_MOCK_SKILL}\").length;"),
        ]),
    )
    .await;

    assert_eq!(outcome, SessionOutcome::Ran);
    // Every turn's conversation is one a provider accepts — the property the pinned skill body
    // would break if it were pinned as a `tool` message the way the native path pins it.
    assert_valid_conversations(&requests);
    // ...and the body really did reach the window: the last request carries the skill's text.
    let last = requests.last().expect("a recorded request");
    assert!(
        last.iter().any(|message| message
            .content
            .as_deref()
            .is_some_and(|text| text.contains("scaffolding an index.html"))),
        "the pinned skill body must reach the model: {last:?}"
    );
    // A `SkillsState` is emitted once at session start (nothing read yet) and once more by the
    // FRESH read; the repeat read emits nothing, because nothing changed.
    let read_flags: Vec<Vec<bool>> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::SkillsState { skills } => {
                Some(skills.iter().map(|skill| skill.read).collect())
            }
            _ => None,
        })
        .collect();
    assert_eq!(
        read_flags,
        vec![vec![false], vec![true]],
        "the fresh read emits the state once; the repeat read pins nothing new"
    );
    // The pinned body is accounted to the Skill band, which is what proves it entered the window
    // as pinned context rather than as ordinary tool output.
    let skill_tokens: Vec<u64> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::ContextBreakdown { by_source, .. } => Some(
                by_source
                    .iter()
                    .find(|band| band.source == GgContextSource::Skill)
                    .map(|band| band.tokens)
                    .unwrap_or(0),
            ),
            _ => None,
        })
        .collect();
    assert!(
        skill_tokens.iter().any(|&tokens| tokens > 0),
        "the skill body is pinned into the Skill band: {skill_tokens:?}"
    );
}

// ---------------------------------------------------------------------------
// `finish` is the only ending
// ---------------------------------------------------------------------------

/// Drive `script` under `set` through one shared [`MockClient`], returning the stream and the client
/// so a test can ask how many turns the loop actually took.
async fn drive_counted_code_run(
    dir: &TempDir,
    set: GgCapabilitySet,
    script: Vec<ModelResponse>,
) -> (SessionOutcome, Vec<GgTelemetryEvent>, Arc<MockClient>) {
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-code".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), set);
    let client = Arc::new(MockClient::new("mock/primary", script));
    let shared = Arc::clone(&client);
    let factory = ScriptedFactory::new().slot(ROOT_AGENT, move |_| {
        Box::new(SharedMockClient(Arc::clone(&shared)))
    });
    let outcome = run_with_factory(&inv, &emitter, Arc::new(factory)).await;
    (outcome, sink.events(), client)
}

/// **`finish` ends the run, and nothing else does.**
///
/// The one ending this protocol has, driven end to end: a program that calls `finish` stops the
/// session on the spot, its summary rides out on the turn's `CodeExecution`, and the loop asks the
/// model for nothing further. The second scenario is the edge case the design turns on — a program
/// that declares the run over and then throws has **not** finished it: the flag `finish` set is
/// revoked, because the summary describes checks the program never ran to the end of, and the model
/// is given the turn in which to make it true.
#[tokio::test]
async fn a_program_that_finishes_ends_the_session_as_completed() {
    // (a) the plain case: one program, one `finish`, one turn.
    let dir = TempDir::new().unwrap();
    let (outcome, events, client) = drive_counted_code_run(
        &dir,
        code_set("mock/primary", json!({})),
        vec![
            code_reply("harness.finish(\"wrote the scaffold\");"),
            // Never reached: the loop must not ask for another turn after a completion.
            code_reply("fs.writeFile(\"after-the-end.txt\", \"nope\");"),
        ],
    )
    .await;

    assert_eq!(outcome, SessionOutcome::Ran);
    assert_eq!(ended_with(&events), "completed");
    assert_eq!(
        client.turns_taken(),
        1,
        "the loop stopped at the completion rather than taking another turn"
    );
    assert!(
        !dir.path().join("after-the-end.txt").exists(),
        "no turn ran after the run was finished"
    );
    assert_eq!(
        code_completions(&events),
        vec![Some("wrote the scaffold".to_string())],
        "the finishing turn carries the summary"
    );
    let summary = session_summary(&events).expect("a session summary");
    assert_eq!(summary.terminal_status, "completed");
    assert_eq!(summary.code_executions, 1);

    // (b) a completion the program declared and then lost by throwing. The run carries on: the
    //     model is asked for another turn, and told why.
    let dir = TempDir::new().unwrap();
    let (outcome, events, client) = drive_counted_code_run(
        &dir,
        code_set("mock/primary", json!({})),
        vec![
            code_reply("harness.finish(\"done despite myself\");\nthrow new Error(\"boom\");"),
            code_reply("harness.finish(\"and this time it really is done\");"),
        ],
    )
    .await;

    assert_eq!(outcome, SessionOutcome::Ran);
    assert_eq!(
        client.turns_taken(),
        2,
        "the revoked ending costs a turn rather than ending the run"
    );
    assert_eq!(
        ended_with(&events),
        "completed",
        "and the second turn's ending is the one the run ends on"
    );
    assert_eq!(
        code_completions(&events),
        vec![None, Some("and this time it really is done".to_string())],
        "the turn that threw carries no completion at all"
    );
    let (ok, _, _, error) = first_code_execution(&events).expect("a CodeExecution event");
    assert!(!ok, "the throw is still reported honestly");
    assert!(
        error.is_some_and(|error| error.contains("boom")),
        "and it is the throw that is reported"
    );
}

/// **A reply that is not a program is a failed turn, never a completion.**
///
/// This is the round-1 failure inverted. Three of four real models narrated a finished task in prose
/// and gg read that as "done", reporting a completed run over a workspace with no deliverable in it.
/// Now prose is an error turn whose feedback tells the model exactly what to do instead, the run
/// carries on, and the model's *next* program is what ends it.
#[tokio::test]
async fn a_reply_that_is_not_a_program_does_not_end_the_session() {
    let dir = TempDir::new().unwrap();
    let (outcome, events, requests) = drive_recorded_code_run(
        &dir,
        code_set("mock/primary", json!({})),
        vec![
            // The modal round-1 terminal reply.
            code_reply("The scaffold is already complete; nothing left to do."),
            // An empty reply is not a completion either.
            ModelResponse {
                text: None,
                tool_calls: Vec::new(),
                finish_reason: FinishReason::Stop,
                usage: TokenCounts::default(),
                cost: None,
            },
            // ...and only now does the run end, because the model wrote a program that says so.
            code_reply(FINISHING_PROGRAM),
        ],
    )
    .await;

    assert_eq!(outcome, SessionOutcome::Ran);
    assert_eq!(
        ended_with(&events),
        "completed",
        "the session ended on the finishing program, not on either non-program reply"
    );
    assert_valid_conversations(&requests);

    let executions = code_executions(&events);
    assert_eq!(
        executions.len(),
        3,
        "a turn with no program is still a code-shaped turn, and is still measured"
    );
    for (ok, tool_calls, duration_ms, error) in &executions[..2] {
        assert!(!ok, "a reply that was not a program is not a clean turn");
        assert_eq!(*tool_calls, 0);
        assert!(
            duration_ms.is_none(),
            "nothing ran, so there is no duration to report: {duration_ms:?}"
        );
        assert!(error.is_some(), "the shape is named");
    }
    assert!(
        executions[0]
            .3
            .as_deref()
            .is_some_and(|e| e.contains("prose")),
        "the prose reply is reported as prose: {:?}",
        executions[0].3
    );
    assert!(
        executions[1]
            .3
            .as_deref()
            .is_some_and(|e| e.contains("empty")),
        "the empty reply is reported as empty: {:?}",
        executions[1].3
    );
    assert_eq!(
        code_completions(&events),
        vec![None, None, Some(FINISHING_SUMMARY.to_string())],
        "only the program that called `finish` finished anything"
    );

    // The feedback really reached the model: its second and third requests carry the instruction.
    for (turn, messages) in requests.iter().enumerate().skip(1) {
        assert!(
            messages.iter().any(|message| message
                .content
                .as_deref()
                .is_some_and(|text| text.contains("Every turn of this run is a program"))),
            "turn {turn} was not told what a turn is supposed to look like"
        );
    }
    assert!(
        requests[1].iter().any(|message| message
            .content
            .as_deref()
            .is_some_and(|text| text.contains("harness.finish("))),
        "and it was told the one thing that does end the run"
    );
}

/// **A session that never finishes is `exhausted`, not `completed`.**
///
/// The whole point of Decision B: nothing implicitly ends a code-mode run. A model that keeps
/// writing perfectly good programs and never declares itself done burns its turn ceiling — and the
/// run says so, both in its status and in the breach it records.
///
/// It also pins §3.5's `stopped_text`: a stopped agent's final word is a status line gg wrote, never
/// the TypeScript of its last program.
#[tokio::test]
async fn a_session_that_never_finishes_is_exhausted_not_completed() {
    let dir = TempDir::new().unwrap();
    let mut set = code_set("mock/primary", json!({}));
    set.limits.max_turns = Some(2);
    let (outcome, events, client) = drive_counted_code_run(
        &dir,
        set,
        vec![
            code_reply("fs.writeFile(\"one.txt\", \"1\");\nreturn 1;"),
            code_reply("fs.writeFile(\"two.txt\", \"2\");\nreturn 2;"),
            code_reply(FINISHING_PROGRAM),
        ],
    )
    .await;

    assert_eq!(outcome, SessionOutcome::Ran);
    assert_eq!(ended_with(&events), "exhausted");
    assert_eq!(client.turns_taken(), 2, "the turn ceiling stopped the loop");
    assert!(
        code_completions(&events).iter().all(Option::is_none),
        "no turn finished anything"
    );
    // Everything the run built is still there: gg rolls nothing back.
    assert!(dir.path().join("one.txt").exists() && dir.path().join("two.txt").exists());
    let breach = limit_breaches(&events);
    assert_eq!(breach.len(), 1, "the turn ceiling records a breach too");
    assert_eq!(breach[0].limit, GgLimitKind::Turns);
    assert_eq!(breach[0].threshold, 2.0);
    let summary = session_summary(&events).expect("a session summary");
    assert_eq!(summary.terminal_status, "exhausted");
    assert_eq!(summary.limits.max_turns, Some(2));
    assert!(summary.limit_hit.is_some());
}

/// **A stopped subagent hands its spawner a status line, not its program source.**
///
/// Under this protocol every assistant message is a page of TypeScript, so a subagent that is
/// stopped before it can `finish` would otherwise return its last program to whoever asked for the
/// work — and that return value is what a Code Review verdict, a speculation judge's brief and the
/// run record are all read out of.
#[tokio::test]
async fn a_stopped_subagent_returns_a_status_line_not_its_program_source() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-code-stop".to_string()), Box::new(sink.clone()));
    let mut set = subagent_set(2, 3, &["subagent"]);
    for agent in &mut set.agents {
        agent
            .capabilities
            .push(GgCapabilityConfig::enabled(CAPABILITY_RESPONSES_AS_CODE));
    }
    // Two turns each: the parent spawns-and-waits then finishes; the child never gets to.
    set.limits.max_turns = Some(2);
    let inv = invocation(dir.path(), set);
    let factory = ScriptedFactory::new()
        .slot(ROOT_AGENT, |b| {
            Box::new(MockClient::new(
                &b.model_id,
                vec![
                    code_reply(
                        "const child = agents.spawnSubagent({ agent: \"subagent\", prompt: \
                         \"Do the work.\" });\nreturn agents.waitForSubagents([child.id]);",
                    ),
                    code_reply(FINISHING_PROGRAM),
                ],
            ))
        })
        .slot("subagent", |b| {
            Box::new(MockClient::new(
                &b.model_id,
                vec![
                    code_reply("const marker = \"kept-going\";\nconsole.log(marker.length);"),
                    code_reply("const marker = \"still-going\";\nconsole.log(marker.length);"),
                ],
            ))
        });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();
    let returns = agent_returns(&events);
    assert_eq!(returns.len(), 1, "one subagent returned: {returns:?}");
    assert!(
        returns[0].starts_with("(agent ended: exhausted;"),
        "a stopped agent returns how it ended: {}",
        returns[0]
    );
    assert!(
        returns[0].contains("its last program logged"),
        "...and what its last turn produced: {}",
        returns[0]
    );
    assert!(
        !returns[0].contains("const marker"),
        "...and never its program source: {}",
        returns[0]
    );
}

// ---------------------------------------------------------------------------
// What the ceilings count, against the real sandbox
// ---------------------------------------------------------------------------

/// **A sandbox limit stop counts as an error turn; a tool failure the program handled does not.**
///
/// The two halves of the turn-outcome rule, driven against the real component under a consecutive
/// ceiling of one — the tightest setting there is, so a single miscounted turn stops the run and a
/// single missed one lets it through.
///
/// A timeout trap **is** an error: the program's declared work was cut short and the model must
/// re-declare it. That reverses the counter this design replaces, which exempted a trap; nothing is
/// lost by dropping the exemption, because the case it protected is exactly what the error-*rate*
/// ceiling expresses and a consecutive counter cannot.
///
/// A tool call that failed **inside** a program that carried on is **not** an error: the program
/// handled it, which is the entire point of the typed surface, and counting it would make the one
/// capability that expects failures the one capability that cannot survive them.
#[tokio::test]
async fn a_sandbox_limit_counts_as_an_error_turn_but_a_handled_tool_failure_does_not() {
    // (a) the trap counts: one trapped turn breaches a ceiling of one.
    let dir = TempDir::new().unwrap();
    let mut set = code_set(
        "mock/primary",
        json!({ "timeoutSecs": RUNAWAY_TIMEOUT_SECS }),
    );
    set.limits.max_consecutive_errors = Some(1);
    let (outcome, events, client) = drive_counted_code_run(
        &dir,
        set,
        vec![
            code_reply("let x = 0;\nwhile (true) {\n  x += 1;\n}\nreturn x;"),
            code_reply(FINISHING_PROGRAM),
        ],
    )
    .await;

    assert_eq!(outcome, SessionOutcome::Ran, "a stopped run still exits 0");
    assert_eq!(ended_with(&events), "limit_exceeded");
    assert_eq!(
        client.turns_taken(),
        1,
        "the loop stopped rather than taking the finishing turn"
    );
    let breaches = limit_breaches(&events);
    assert_eq!(breaches.len(), 1);
    assert_eq!(breaches[0].limit, GgLimitKind::ConsecutiveErrors);

    // (b) a failure the program caught does not count: the same ceiling, and the run finishes.
    let dir = TempDir::new().unwrap();
    let mut set = code_set("mock/primary", json!({}));
    set.limits.max_consecutive_errors = Some(1);
    let (outcome, events, client) = drive_counted_code_run(
        &dir,
        set,
        vec![
            code_reply(
                "let caught = false;\ntry {\n  fs.readTextFile(\"absent.txt\");\n} catch (e) {\n  \
                 caught = true;\n}\nfs.writeFile(\"handled.txt\", String(caught));\nreturn caught;",
            ),
            code_reply(FINISHING_PROGRAM),
        ],
    )
    .await;

    assert_eq!(outcome, SessionOutcome::Ran);
    assert_eq!(
        ended_with(&events),
        "completed",
        "a program that anticipated a failure is a turn that progressed"
    );
    assert_eq!(client.turns_taken(), 2, "the run took its finishing turn");
    assert!(
        limit_breaches(&events).is_empty(),
        "no ceiling was breached"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("handled.txt")).unwrap(),
        "true",
        "the program really did catch the failure and carry on"
    );
}

// ---------------------------------------------------------------------------
// The delegation routines under the code protocol
// ---------------------------------------------------------------------------

/// **A code-mode reviewer's verdict parses, and the issue is accepted.**
///
/// Every brief gg generates used to tell its agent to end by *stopping*, which this protocol
/// abolishes — a reviewer that never calls `finish` never reaches `completed`, so gg would report it
/// as having ended without a verdict and the issue would never be accepted. This drives a whole
/// issue review through the code path: the root program files the board issue (which auto-dispatches
/// an agent to implement it), the dispatched agent's program does the work and completes the issue,
/// and the reviewer's program finishes with the verdict.
#[tokio::test]
async fn a_code_mode_reviewer_verdict_parses() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-code-review".to_string()), Box::new(sink.clone()));
    let mut set = issue_review_set(&["reviewer"]);
    for agent in &mut set.agents {
        agent
            .capabilities
            .push(GgCapabilityConfig::enabled(CAPABILITY_RESPONSES_AS_CODE));
    }
    let inv = invocation(dir.path(), set);
    // The primary slot serves the root (agent 0: build the board, then finish — creating the issue
    // auto-dispatches an agent to implement it) then that dispatched issue agent (agent 1: write the
    // work, then finish — which is what triggers the gating review).
    let primary_counter = Arc::new(AtomicUsize::new(0));
    let factory = ScriptedFactory::new()
        .slot(ROOT_AGENT, move |b| {
            let n = primary_counter.fetch_add(1, Ordering::SeqCst);
            let programs = if n == 0 {
                vec![
                    code_reply(&format!(
                        "project.createEpic({{ id: \"e1\", title: \"Build\", description: \"the build\" \
                         }});\nproject.createIssue({{ id: \"{REVIEW_ISSUE_ID}\", title: \"Add the widget\", \
                         inScope: \"Implement the widget.\", outOfScope: \"Unrelated changes.\", \
                         completionCriteria: \"The widget is fully implemented.\", epicId: \"e1\", \
                         agent: \"{ROOT_AGENT}\", reviewers: [\"reviewer\"] }});"
                    )),
                    code_reply(FINISHING_PROGRAM),
                ]
            } else {
                vec![
                    code_reply("fs.writeFile(\"widget.txt\", \"the widget\\n\");"),
                    code_reply(FINISHING_PROGRAM),
                ]
            };
            Box::new(MockClient::new(&b.model_id, programs))
        })
        .slot("reviewer", |b| {
            Box::new(MockClient::new(
                &b.model_id,
                vec![code_reply("harness.finish(\"REVIEW: APPROVED\");")],
            ))
        });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();
    let phases: Vec<GgIssueReviewPhase> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::IssueReview { phase, .. } => Some(*phase),
            _ => None,
        })
        .collect();
    assert_eq!(
        phases,
        vec![GgIssueReviewPhase::Requested, GgIssueReviewPhase::Approved],
        "the reviewer's `finish` summary parsed as an approval: {phases:?}"
    );
    // The reviewer was told the contract it actually runs under.
    let review_brief = agent_spawns(&events)
        .into_iter()
        .find(|(_, _, slot, _, _)| slot == "reviewer")
        .and_then(|(_, _, _, _, brief)| brief)
        .expect("a reviewer was dispatched");
    assert!(
        review_brief.contains("harness.finish(\"REVIEW: APPROVED\")"),
        "the code-mode brief asks for the verdict the way a program gives one: {review_brief}"
    );
    assert_eq!(ended_with(&events), "completed");
}

/// **A code-mode speculation attempt is a candidate, and its worktree is merged.**
///
/// Two consumers of a child's terminal status at once: an attempt that never reaches `completed` is
/// filtered out of the candidate set entirely, and a subagent whose worktree is merged is merged
/// only on that same status. Both are driven here through programs that end with `finish`.
#[tokio::test]
async fn a_code_mode_speculation_merges_the_winners_worktree() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-code-spec".to_string()), Box::new(sink.clone()));
    let mut set = speculative_set(&["attempt", "judge"]);
    for agent in &mut set.agents {
        agent
            .capabilities
            .push(GgCapabilityConfig::enabled(CAPABILITY_RESPONSES_AS_CODE));
    }
    let inv = invocation(dir.path(), set);
    let counter = Arc::new(AtomicUsize::new(0));
    let attempts = Arc::clone(&counter);
    let factory = ScriptedFactory::new()
        .slot(ROOT_AGENT, |b| {
            Box::new(MockClient::new(
                &b.model_id,
                vec![
                    code_reply(
                        "return agents.speculate({ agent: \"attempt\", prompt: \"Implement the widget.\", \
                         attempts: 2 });",
                    ),
                    code_reply(FINISHING_PROGRAM),
                ],
            ))
        })
        .slot("attempt", move |b| {
            let n = attempts.fetch_add(1, Ordering::SeqCst);
            Box::new(MockClient::new(
                &b.model_id,
                vec![code_reply(&format!(
                    "fs.writeFile(\"attempt-{n}.txt\", \"attempt {n}\\n\");\nharness.finish(\"attempt {n} \
                     built the widget\");"
                ))],
            ))
        })
        .slot("judge", |b| {
            Box::new(MockClient::new(
                &b.model_id,
                vec![code_reply(
                    "harness.finish(\"SPECULATION JUDGE: WINNER 1\\nIt is the most complete.\");",
                )],
            ))
        });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();
    let phases: Vec<GgSpeculationPhase> = speculations(&events)
        .iter()
        .map(|(_, _, phase, _, _)| *phase)
        .collect();
    assert_eq!(
        phases,
        vec![
            GgSpeculationPhase::FannedOut,
            GgSpeculationPhase::Judged,
            GgSpeculationPhase::Merged,
        ],
        "both attempts finished, so both were candidates and the judge's pick was merged"
    );
    assert!(
        dir.path().join("attempt-0.txt").exists(),
        "the winner's worktree was merged into the main tree"
    );
    assert!(
        !dir.path().join("attempt-1.txt").exists(),
        "the loser's was discarded"
    );
    assert_eq!(ended_with(&events), "completed");
}

/// **A code-mode issue agent's isolated worktree is merged back.**
///
/// An issue's work happens on a branch, and the merge gate is the issue's acceptance — which under
/// this protocol is reached by the agent's program calling `finish`. An agent whose program could
/// not reach that call would have its work discarded silently, which is the failure this asserts is
/// gone.
#[tokio::test]
async fn a_code_mode_issue_agents_worktree_is_merged() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-code-wt".to_string()), Box::new(sink.clone()));
    let mut set = issue_review_set(&[]);
    for agent in &mut set.agents {
        agent
            .capabilities
            .push(GgCapabilityConfig::enabled(CAPABILITY_RESPONSES_AS_CODE));
    }
    let inv = invocation(dir.path(), set);
    let counter = Arc::new(AtomicUsize::new(0));
    let factory = ScriptedFactory::new().slot(ROOT_AGENT, move |b| {
        let n = counter.fetch_add(1, Ordering::SeqCst);
        let programs = if n == 0 {
            vec![
                code_reply(&format!(
                    "project.createIssue({{ id: \"{REVIEW_ISSUE_ID}\", title: \"Write the file\", \
                     inScope: \"Write isolated.txt.\", outOfScope: \"Nothing else.\", \
                     completionCriteria: \"isolated.txt exists.\", agent: \"{ROOT_AGENT}\" }});"
                )),
                code_reply(FINISHING_PROGRAM),
            ]
        } else {
            vec![code_reply(
                "fs.writeFile(\"isolated.txt\", \"from the worktree\\n\");\n\
                 harness.finish(\"wrote the file in my worktree\");",
            )]
        };
        Box::new(MockClient::new(&b.model_id, programs))
    });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::WorktreeMerged { merged, .. } if *merged
        )),
        "the issue was accepted, so its worktree was merged"
    );
    assert!(
        dir.path().join("isolated.txt").exists(),
        "and its work reached the main tree"
    );
    assert_eq!(ended_with(&events), "completed");
}

// ---------------------------------------------------------------------------
// Statements the reply wrote that could not run
// ---------------------------------------------------------------------------

/// **A program whose reply carried a second draft after its top-level `return` is told so.**
///
/// The exact round-2 shape, from the model that sent it: two drafts pasted one after the other, the
/// first ending in a `return`. It compiles, it runs, and the whole second half — including the
/// `writeFile` of the deliverable and the `finish` that would have ended the run — never executes.
/// The turn is a clean success by every other measure, which is precisely why the silence was
/// unrecoverable: the model was told "your program ran to completion" and had no way to learn
/// otherwise.
///
/// Both audiences are asserted, because they need it for different reasons: the model, so it can
/// send one program next turn, and the operator's stream, so a run whose program is not the whole
/// reply is visible while it is happening.
#[tokio::test]
async fn statements_after_a_top_level_return_are_disclosed_to_the_model_and_the_stream() {
    let dir = TempDir::new().unwrap();
    std::fs::create_dir_all(dir.path().join("src")).unwrap();
    std::fs::write(dir.path().join("src/a.ts"), "export const a = 1;\n").unwrap();
    let (outcome, events, requests) = drive_recorded_code_run(
        &dir,
        code_set("mock/primary", json!({})),
        vec![
            code_reply(
                "const src = fs.listDir(\"src\");\n\
                 return { count: src.length };\n\n\
                 fs.writeFile(\"MANIFEST.md\", \"- a.ts (1 lines)\\n\");\n\
                 harness.finish(\"wrote the manifest\");",
            ),
            code_reply(FINISHING_PROGRAM),
        ],
    )
    .await;
    assert_eq!(outcome, SessionOutcome::Ran);

    // The first half ran: the reply was a program, and nothing about the disclosure refuses it.
    let executions: Vec<bool> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::CodeExecution { ok, .. } => Some(*ok),
            _ => None,
        })
        .collect();
    assert_eq!(executions.first(), Some(&true), "the program itself ran");
    // ...and the second half did not, which is the whole point.
    assert!(
        !dir.path().join("MANIFEST.md").exists(),
        "the dead half wrote the deliverable, so it must not exist"
    );

    let feedback = requests[1]
        .iter()
        .filter_map(|message| message.content.clone())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(
        feedback.contains(
            "2 statements after your top-level `return` did not run — the first is line 4"
        ),
        "the model was not told what did not run:\n{feedback}"
    );
    assert!(
        feedback.contains("fs.writeFile(\"MANIFEST.md\""),
        "the model was not shown WHICH statement, so it cannot recognise the half that was lost:\n\
         {feedback}"
    );
    assert!(
        feedback.contains("Send exactly one program per reply."),
        "the model was not told what to do differently:\n{feedback}"
    );

    assert!(
        warn_messages(&events).iter().any(|message| {
            message.contains("wrote 2 statements after its top-level `return` that could not run")
        }),
        "the operator's stream never mentioned it: {:?}",
        warn_messages(&events)
    );
}

/// **A program with no dead tail says nothing about one** — the disclosure must not become noise on
/// the turns that got it right.
#[tokio::test]
async fn a_program_with_nothing_after_its_return_is_not_told_about_unreachable_statements() {
    let dir = TempDir::new().unwrap();
    let (_, events, requests) = drive_recorded_code_run(
        &dir,
        code_set("mock/primary", json!({})),
        vec![
            code_reply("const a = 1;\nreturn a + 1;"),
            code_reply(FINISHING_PROGRAM),
        ],
    )
    .await;
    let feedback = requests[1]
        .iter()
        .filter_map(|message| message.content.clone())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(
        !feedback.contains("did not run"),
        "a clean program was told about statements that do not exist:\n{feedback}"
    );
    assert!(
        !warn_messages(&events)
            .iter()
            .any(|message| message.contains("did not run")),
        "{:?}",
        warn_messages(&events)
    );
}

/// **A program that calls `finish` and then keeps going does the rest of the work**, and nothing is
/// reported about it.
///
/// This is the shape that used to lose a run its deliverable: `finish` unwound the program, so the
/// `writeFile` below it never ran, and the run ended "completed" over a workspace with no artifact
/// in it. gg could only warn about it on the operator's stream, after the fact. Now the statement
/// runs, the file exists, and there is nothing to warn about — which is why the warning is asserted
/// **absent** here rather than reworded.
#[tokio::test]
async fn a_program_that_finishes_and_keeps_going_still_does_the_work() {
    let dir = TempDir::new().unwrap();
    let (outcome, events, _) = drive_recorded_code_run(
        &dir,
        code_set("mock/primary", json!({})),
        vec![code_reply(
            "harness.finish(\"all done\");\nfs.writeFile(\"MANIFEST.md\", \"- a.ts (1 lines)\\n\");",
        )],
    )
    .await;
    assert_eq!(outcome, SessionOutcome::Ran);
    assert_eq!(ended_with(&events), "completed", "the completion stands");
    assert_eq!(
        std::fs::read_to_string(dir.path().join("MANIFEST.md"))
            .expect("the deliverable was written"),
        "- a.ts (1 lines)\n",
        "the statement after `finish` is ordinary work and runs"
    );
    assert!(
        !warn_messages(&events)
            .iter()
            .any(|message| message.contains("could not run")),
        "nothing was unreachable, so nothing may be reported as such: {:?}",
        warn_messages(&events)
    );
}

// ---------------------------------------------------------------------------
// What the run records about its own configuration
// ---------------------------------------------------------------------------

/// **The healing configuration in force is on the launch log and on the session summary.**
///
/// Every other healing figure counts what *fired*, and a run in which nothing fired is
/// byte-identical whether its strategies were all armed or all off — so without this the two arms of
/// the ablation this subsystem exists to serve are indistinguishable in the telemetry, and a study
/// has to go back to the invocation files that produced the runs.
#[tokio::test]
async fn the_armed_healing_strategies_are_logged_and_recorded() {
    let dir = TempDir::new().unwrap();
    let (_, events, _) = drive_recorded_code_run(
        &dir,
        code_set(
            "mock/primary",
            json!({ "healing": { "strip-prose": false } }),
        ),
        vec![code_reply(FINISHING_PROGRAM)],
    )
    .await;

    let logs: Vec<String> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::Log { message, .. } => Some(message.clone()),
            _ => None,
        })
        .collect();
    let line = logs
        .iter()
        .find(|message| message.starts_with("response healing:"))
        .unwrap_or_else(|| panic!("no healing line on the launch log: {logs:?}"));
    assert_eq!(
        line,
        "response healing: strip-fences, drop-duplicate-program, drop-imports, unwrap-async, \
         strip-comment-only",
        "the log must name the armed set, and only the armed set"
    );

    let summary = session_summary(&events).expect("a run emits one session summary");
    assert_eq!(
        summary.healing.enabled,
        vec![
            GgHealingStrategy::StripFences,
            GgHealingStrategy::DropDuplicateProgram,
            GgHealingStrategy::DropImports,
            GgHealingStrategy::UnwrapAsync,
            GgHealingStrategy::StripCommentOnly,
        ],
        "the summary must carry the same resolved set the log named"
    );
}

/// **The disabled arm says so explicitly, rather than by saying nothing — and it says it on the
/// wire.**
///
/// `healing: false` and "this run happened not to need any repair" produce identical counters, and
/// the whole reason the resolved set is recorded is to tell them apart. The assertion is therefore
/// made against the **serialized** summary rather than the struct: a real healing-off run once
/// emitted a summary carrying no `enabled` key at all — byte-identical to one from a build that had
/// no such field — while a struct-level `enabled.is_empty()` passed happily over it. Reading the
/// arm back out of the JSON is the only assertion that could have caught that, so it is the one
/// made here.
#[tokio::test]
async fn the_disabled_healing_arm_is_named_on_the_log_and_empty_on_the_summary() {
    let dir = TempDir::new().unwrap();
    let (_, events, _) = drive_recorded_code_run(
        &dir,
        code_set("mock/primary", json!({ "healing": false })),
        vec![code_reply(FINISHING_PROGRAM)],
    )
    .await;

    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::Log { message, .. } if message.starts_with("response healing: disabled")
        )),
        "a run with every strategy off must say so"
    );
    let summary = session_summary(&events).expect("a run emits one session summary");
    let healing = &serde_json::to_value(&summary).expect("serialize the summary")["healing"];
    assert_eq!(
        healing.get("enabled"),
        Some(&json!([])),
        "the disabled arm must be readable from the recorded summary alone: {healing}"
    );
}
