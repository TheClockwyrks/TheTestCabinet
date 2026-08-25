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
use test_cabinet_core::gg::SHELL_OUTPUT_OFFLOAD;
use test_cabinet_core::gg_session_journal::GgJournalLine;
use test_cabinet_core::gg_session_record::GgSessionEntryKind;

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
    let factory = ScriptedFactory::new().slot(ROOT_PROFILE_ID, client);
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

/// Every `CodeExecution`'s captured program output, in order: the lines and how many the capture
/// caps discarded.
fn code_logs(events: &[GgTelemetryEvent]) -> Vec<(Vec<String>, u64)> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::CodeExecution {
                logs,
                logs_suppressed,
                ..
            } => Some((logs.clone(), *logs_suppressed)),
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

/// The `ApiCall`/`ApiResult` operations in stream order, tagged with which kind they were — the
/// evidence that a program's composed calls are as visible as a tool-calling agent's are.
///
/// The pair a *program* streams is this one and only this one. A responses-as-code agent emits no
/// `ToolCall`/`ToolResult` at all: the two surfaces are independent, so a call made by a program is
/// recorded under the operation the program called and never under the tool name a different agent
/// would have written to reach the same core.
fn api_telemetry(events: &[GgTelemetryEvent]) -> Vec<(&'static str, String)> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::ApiCall { operation, .. } => Some(("call", operation.clone())),
            GgTelemetryKind::ApiResult { operation, .. } => Some(("result", operation.clone())),
            _ => None,
        })
        .collect()
}

/// Every `ToolCall`/`ToolResult` in the stream — which, on a responses-as-code turn, must be none.
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
    // The axis a cross-language study slices its arms on, asserted from a **real run** rather than
    // from a hand-built struct: nothing else in the record says which language the programs above
    // were written in, so a dropped `record_program_language` would be invisible.
    assert_eq!(
        summary.program_language,
        Some(test_cabinet_core::gg::GgProgramLanguage::TypeScript)
    );
    assert_eq!(summary.code_executions, 2);

    // (d) the instance's own surface says what it was offered, in the shape a code agent reaches it
    // through: capability modules with the functions bound in them, each naming gg's own operation
    // for what it does — which is the join a reader needs to tell "never offered" from "never
    // called", and the only one that means the same thing in another language's arm.
    let (mode, language, doc_view_types, tools, apis) = events
        .iter()
        .find_map(|event| match &event.kind {
            GgTelemetryKind::AgentSurface {
                execution_mode,
                program_language,
                doc_view_types,
                tools,
                apis,
                ..
            } => Some((
                execution_mode.clone(),
                *program_language,
                doc_view_types.clone(),
                tools.clone(),
                apis.clone(),
            )),
            _ => None,
        })
        .expect("an AgentSurface event");
    assert_eq!(mode, "responses_as_code");
    // The documentation A/B's arm, reported by an agent that configured nothing: the default is a
    // arm of the comparison like any other, and a record that omitted it would leave this run
    // unattributable rather than obviously default.
    assert_eq!(doc_view_types.as_deref(), Some("return+errors"));
    // Per instance, because the capability is per agent: the surface is where a reader learns which
    // arm *this* agent was in, and the spellings under `apis` are that language's.
    assert_eq!(
        language,
        Some(test_cabinet_core::gg::GgProgramLanguage::TypeScript)
    );
    assert!(
        tools.is_empty(),
        "a responses-as-code agent has no tool surface at all, so it reports none: {tools:?}"
    );
    let fs = apis
        .iter()
        .find(|api| api.path == "gg.files")
        .expect("the `gg.files` module the program composed its calls on");
    assert_eq!(
        fs.functions
            .iter()
            .find(|function| function.name == "writeFile")
            .map(|function| function.operation.as_str()),
        Some("files.write_file"),
        "the composed call carries gg's own identity for it, which is what its count joins on"
    );
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
    crate::tools::grant_configured(
        &mut set.agents[0],
        GgCapabilityConfig {
            implementation: Some(COMPACTION_STRATEGY_SELF_COMPACTION.to_string()),
            ..GgCapabilityConfig::enabled(CAPABILITY_COMPACTION)
        },
    );

    let program = format!(
        "import * as gg from \"gg\";\ngg.files.writeFile(\"main.ts\", \"export const KEPT = 1;\");\n\
         gg.context.compact(\"{SUMMARY}\", [\"main.ts\"]);\n\
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
async fn responses_as_code_completion_is_gated_by_an_agent_stop_hook() {
    let dir = TempDir::new().unwrap();
    let mut set = code_set("mock/primary", json!({}));
    // Gate the ending on a file the program must create before its `finish` is accepted, asserted
    // on the code path because that path applies the gate at a different point from the
    // tool-calling one.
    set.agents[0].hooks.push(test_cabinet_core::gg::GgHook {
        event: test_cabinet_core::gg::GgHookEvent::AgentStop,
        action: test_cabinet_core::gg::GgHookAction::Command {
            command: "test -f ready.txt".to_string(),
            cwd: None,
            timeout_secs: Some(30.0),
            output: None,
        },
        name: "ready".to_string(),
    });

    // Turn 1 finishes without creating the file (the hook blocks, the run continues); turn 2
    // creates the file and finishes (the hook passes, the run ends).
    let script = vec![
        code_reply("import * as gg from \"gg\";\ngg.session.finish(\"attempt one\");"),
        code_reply(
            "import * as gg from \"gg\";\ngg.files.writeFile(\"ready.txt\", \"x\");\ngg.session.finish(\"attempt two\");",
        ),
    ];
    let (outcome, events) = drive_code_run(&dir, set, move |b| {
        Box::new(MockClient::new(&b.model_id, script.clone()))
    })
    .await;

    assert_eq!(outcome, SessionOutcome::Ran);
    assert_eq!(
        ended_with(&events),
        "completed",
        "the second finish passed its stop hook"
    );
    assert!(
        dir.path().join("ready.txt").exists(),
        "the second program created the file the hook checks for"
    );
    // The first `finish` was rejected: gg names the hook that refused it on the operator stream,
    // and the run took a second code turn rather than ending on the first.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::Log { level, message }
                if level == "warn" && message.contains("hook `ready` failed")
        )),
        "a rejected completion names the hook that refused it"
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

/// A model that calls a tool other than `submit_program` on a code turn — a reflex some models
/// bring from their tool-use training — is refused loudly, and the conversation stays valid.
///
/// The call is answered by its own `tool` result (a redirect naming `submit_program`), never
/// dispatched: every assistant `tool_calls` entry gets an answer, which is what keeps the request
/// a conversation every provider accepts, and the `warn` is what keeps the anomaly measurable.
/// The program the same reply submitted runs regardless.
#[tokio::test]
async fn a_stray_tool_call_on_a_code_turn_is_refused_loudly() {
    let dir = TempDir::new().unwrap();
    let mut script = program_script(&[
        "import * as gg from \"gg\";\ngg.files.writeFile(\"from-program.txt\", \"hi\");",
    ]);
    // Pushed beside the reply's own `submit_program` call rather than in place of it: the stray
    // call rides along with a legitimate submission, which is the shape a tool-habituated model
    // actually produces.
    script[0].tool_calls.push(ToolCall {
        id: "call_habit".to_string(),
        name: "write_file".to_string(),
        arguments: json!({ "path": "from-tool-call.txt", "contents": "hi" }),
    });
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
                if level == "warn" && message.contains("the model called `write_file`")
        )),
        "the anomaly is named rather than silently swallowed"
    );
}

/// A reply that makes **several** `submit_program` calls runs every program — sequentially, in
/// submission order, whether or not an earlier one failed — and the turn counts **at most one**
/// error, typed by the first failure.
///
/// The three submissions cover the whole rule in one scenario: the first writes a file and then
/// throws (a runtime failure), the second is a program the transpiler refuses (a second failure
/// that must not be the type recorded), and the third runs cleanly and reads what the first wrote,
/// which is what proves the order and that a failure stops nothing.
#[tokio::test]
async fn several_submissions_all_run_in_order_and_count_one_error() {
    let dir = TempDir::new().unwrap();
    let mut script = program_script(&[
        "import * as gg from \"gg\";\ngg.files.writeFile(\"first.txt\", \"1\");\nthrow new Error(\"first failed\");",
    ]);
    script[0].tool_calls.push(ToolCall {
        id: "submit-second".to_string(),
        name: crate::completion::SUBMIT_PROGRAM_TOOL.to_string(),
        arguments: json!({ "program": "const x = ;" }),
    });
    script[0].tool_calls.push(ToolCall {
        id: "submit-third".to_string(),
        name: crate::completion::SUBMIT_PROGRAM_TOOL.to_string(),
        arguments: json!({
            "program": "import * as gg from \"gg\";\nconst read = gg.files.readFile(\"first.txt\");\ngg.files.writeFile(\"third.txt\", (read.kind === \"text\" ? read.contents : \"?\") + \"3\");"
        }),
    });
    let (outcome, events, requests) =
        drive_recorded_code_run(&dir, code_set("mock/primary", json!({})), script).await;

    assert_eq!(outcome, SessionOutcome::Ran);
    assert_eq!(ended_with(&events), "completed");
    assert_valid_conversations(&requests);
    // Every program ran, in submission order: the third read what the first wrote, and the
    // transpile refusal between them stopped nothing.
    assert_eq!(
        std::fs::read_to_string(dir.path().join("third.txt")).unwrap(),
        "13",
        "the third program ran after the first, past the second's failure"
    );
    let summary = session_summary(&events).expect("a session summary");
    // Three submissions plus the finishing turn's program, each its own execution.
    assert_eq!(summary.code_executions, 4);
    // The turn counts one error no matter how many of its programs failed, typed by the FIRST
    // failure: the throw, not the transpile refusal after it.
    assert_eq!(summary.errors.errors, 1, "at most one error per turn");
    assert_eq!(summary.errors.program_fault, 1);
    assert_eq!(
        summary.errors.transpile, 0,
        "the second failure is folded into the first, not counted beside it"
    );
    // The model is told the order once, up front, and both failures are fed back beneath it.
    let turn2: String = requests[1]
        .iter()
        .filter_map(|m| m.content.clone())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(
        turn2.contains("they ran in order"),
        "the ordering notice reaches the next turn: {turn2}"
    );
    assert!(
        turn2.contains("first failed"),
        "the runtime failure is fed back: {turn2}"
    );
    assert!(
        turn2.contains("Compiler error"),
        "the transpile failure is fed back too: {turn2}"
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
                // A module feature the sandbox has no implementation of. It reaches the
                // transpiler exactly as the model wrote it and fails
                // there, which is the shape this test is about.
                "import {\n  readFileSync,\n} from \"node:fs\";\n1;",
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
    shell.params = crate::tools::configured(CAPABILITY_SHELL, json!({ "maxLines": 3 })).params;

    let program = "import * as gg from \"gg\";\nconst out = gg.shell.shell(\"for i in $(seq 1 60); do echo line-$i; done\").output;\n\
                   gg.files.writeFile(\"seen.txt\", out);";
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
    assert!(seen.contains("/tmp/gg-shell"), "{seen}");
    for suffix in [".stdout", ".stderr"] {
        assert!(seen.contains(suffix), "the note names both files: {seen}");
    }
}

// ---------------------------------------------------------------------------
// The servicing seam: telemetry, ids, delegation, context, skills, images
// ---------------------------------------------------------------------------

/// Composed calls stay as visible as a tool-calling agent's are: every call streams an `ApiCall`
/// immediately followed by its `ApiResult`, in the order the program made them — and streams
/// **nothing else**, because a program never reaches a tool.
#[tokio::test]
async fn composed_calls_stream_call_then_result_telemetry_in_order() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("seed.txt"), "hello\n").unwrap();
    let (outcome, events) = drive_code_run(&dir, code_set("mock/primary", json!({})), |b| {
        one_program(
            &b.model_id,
            "import * as gg from \"gg\";\nconst read = gg.files.readFile(\"seed.txt\");\n\
             gg.files.writeFile(\"copy.txt\", read.kind === \"text\" ? read.contents.toUpperCase() : \"\");\n\
             const entries = gg.files.listDir(\".\");\n\
             console.log(String(entries.length));",
        )
    })
    .await;

    assert_eq!(outcome, SessionOutcome::Ran);
    assert_eq!(
        api_telemetry(&events),
        vec![
            ("call", "files.read_file".to_string()),
            ("result", "files.read_file".to_string()),
            ("call", "files.write_file".to_string()),
            ("result", "files.write_file".to_string()),
            ("call", "files.list_dir".to_string()),
            ("result", "files.list_dir".to_string()),
            // The ending is an operation like any other on this surface — the program called it,
            // so it is recorded here rather than being a fact only the session summary carries.
            ("call", "session.finish".to_string()),
            ("result", "session.finish".to_string()),
        ],
        "each composed call streams its own pair, in program order, under the operation it called \
         rather than under the tool that call would have been on the other surface"
    );
    assert!(
        tool_telemetry(&events).is_empty(),
        "and a program reaches no tool, so it streams no tool pair: {:?}",
        tool_telemetry(&events)
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("copy.txt")).unwrap(),
        "HELLO\n"
    );
}

/// The `CodeExecution` event's `tool_calls` is the number of `ApiCall`/`ApiResult` pairs the turn
/// actually streamed — the invariant that makes the measurement comparable with the tool-calling
/// path, where one turn's calls are counted the same way.
#[tokio::test]
async fn code_execution_tool_calls_equals_the_telemetry_pair_count() {
    let dir = TempDir::new().unwrap();
    let (outcome, events) = drive_code_run(&dir, code_set("mock/primary", json!({})), |b| {
        one_program(
            &b.model_id,
            "import * as gg from \"gg\";\nfor (let i = 0; i < 5; i += 1) {\n  gg.files.writeFile(`out-${i}.txt`, String(i));\n}\n\
             console.log(String(gg.files.listDir(\".\").length));",
        )
    })
    .await;

    assert_eq!(outcome, SessionOutcome::Ran);
    // Summed over the run's turns rather than read off the first, because the stream is the run's
    // and the closing turn is a program too.
    let counted: u64 = code_executions(&events)
        .into_iter()
        .map(|(_, tool_calls, _, _)| tool_calls)
        .sum();
    let pairs = api_telemetry(&events);
    // The ending is streamed like every other call the program made and counted by neither figure:
    // `tool_calls` is the roster of work a turn composed, and declaring the session over is not
    // work. So it is subtracted here by name rather than swept up, which keeps the identity exact
    // instead of approximately true.
    let (endings, composed): (Vec<_>, Vec<_>) = pairs
        .iter()
        .partition(|(_, operation)| operation.starts_with("session."));
    assert_eq!(
        endings.len(),
        2,
        "one ApiCall and one ApiResult for the one ending this run declared: {pairs:?}"
    );
    assert_eq!(
        composed.len() as u64,
        counted * 2,
        "one ApiCall and one ApiResult per counted call: {pairs:?}"
    );
    let (_, first, _, _) = first_code_execution(&events).expect("a CodeExecution event");
    assert_eq!(first, 6, "five writes plus the closing list");
}

/// A program that calls one tool repeatedly must not mint one id twice: the synthetic id is
/// ordinal-keyed, and anything recorded against it (a reconstruction most of all) is keyed by that
/// id. This asserts against the **capture journal**, which is the consumer that would be corrupted.
#[tokio::test]
async fn the_synthetic_call_ids_are_unique_within_a_turn() {
    let dir = TempDir::new().unwrap();
    let set = code_set("mock/primary", json!({}));
    let (outcome, _events) = drive_code_run(&dir, set, |b| {
        one_program(
            &b.model_id,
            "import * as gg from \"gg\";\ngg.files.writeFile(\"a.txt\", \"1\");\ngg.files.writeFile(\"b.txt\", \"2\");\n\
             gg.files.writeFile(\"c.txt\", \"3\");\n3;",
        )
    })
    .await;
    assert_eq!(outcome, SessionOutcome::Ran);

    let journal = std::fs::read_to_string(dir.path().join(GG_SESSION_JOURNAL_PATH)).unwrap();
    let ids: Vec<String> = journal
        .lines()
        .filter_map(|line| {
            match serde_json::from_str::<GgJournalLine>(line).expect("a journal line") {
                GgJournalLine::Entry { entry } => match entry.kind {
                    GgSessionEntryKind::ToolResult { call, .. } => Some(call.id),
                    _ => None,
                },
                _ => None,
            }
        })
        .collect();
    assert_eq!(
        ids,
        vec![
            "program:0:files.write_file",
            "program:1:files.write_file",
            "program:2:files.write_file"
        ],
        "each composed call is recorded under its own ordinal id, keyed by the operation the \
         program called rather than by a tool name no program ever wrote"
    );
}

/// A program's delegation still goes through the scheduler: the code-mode parent's program spawns a
/// subagent (also code-driven) and waits for it, the child runs and writes its file, and the agent
/// tree records the spawn — exactly as a tool-calling delegation would.
///
/// It carries the **within-run A/B** too, because it is the one scenario here that drives two agents
/// under two profiles: the parent opens documentation with every type flag on and the child
/// with `off`, and each reports its own arm on its own surface event. That is what makes the knob
/// observable rather than merely configurable — a study reads an agent's arm off the stream and
/// joins it to that agent's own documentation band, with the task, the workspace and the wall clock
/// held constant because both arms are in one run.
#[tokio::test]
async fn a_program_subagent_still_honours_the_scheduler() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-code-sub".to_string()), Box::new(sink.clone()));
    // Subagents + multi-model + responses-as-code, under a cap of 1 (so the child only runs once
    // the waiting parent frees its slot — the scheduler's blocked-frees-slot rule).
    let mut set = subagent_set(1, 3, &["subagent"]);
    for agent in &mut set.agents {
        // The documentation-view type flags are per agent, so the two profiles take opposite
        // arms of them: every type against none at all.
        let types = if agent.slug == ROOT_PROFILE_ID {
            json!({ "return": true, "parameters": true, "errors": true })
        } else {
            json!(false)
        };
        crate::tools::grant_configured(
            agent,
            crate::tools::configured(
                CAPABILITY_RESPONSES_AS_CODE,
                json!({ "docViewTypes": types }),
            ),
        );
    }
    let inv = invocation(dir.path(), set);
    let factory = ScriptedFactory::new()
        .slot(ROOT_PROFILE_ID, |b| {
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
    let parent_calls = api_telemetry(&events);
    assert!(
        parent_calls.contains(&("call", "delegation.spawn_subagent".to_string()))
            && parent_calls.contains(&("call", "delegation.wait_for_subagents".to_string())),
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

    // **The A/B is legible from the events alone.** Two agents, two documentation modes, each
    // reported on the surface of the instance it applies to and keyed by that instance's own id —
    // which is the same id its context breakdowns and its calls carry, so "which arm was this, and
    // what did its documentation cost" is a join and not an inference.
    //
    // The run-level dimension deliberately does not carry this and must not: it is one value for a
    // run that here holds two, so a study reading it would attribute both arms to one.
    let modes: Vec<(String, Option<String>)> = events
        .iter()
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::AgentSurface { doc_view_types, .. } => Some((
                event.agent_id.clone().unwrap_or_default(),
                doc_view_types.clone(),
            )),
            _ => None,
        })
        .collect();
    assert_eq!(modes.len(), 2, "one surface per instance: {modes:?}");
    assert_eq!(
        modes
            .iter()
            .map(|(_, mode)| mode.as_deref())
            .collect::<Vec<_>>(),
        vec![Some("return+parameters+errors"), Some("none")],
        "each instance reports the arm its own profile put it on: {modes:?}"
    );
    assert_ne!(
        modes[0].0, modes[1].0,
        "and each is attributed to the instance it describes: {modes:?}"
    );
}

/// **A bare `fs.readFile` of a picture shows the model nothing.**
///
/// Views are the only channel into the window, so a picture reaches the model as a *file view of an
/// image file* or not at all. The read still succeeds and still hands the program the descriptor —
/// a program that checks a mockup's format or size is unaffected — but no request that follows it
/// carries a picture. The proof is the *provider's* view: without it a picture could be attached
/// somewhere no assertion on the context model would see.
#[tokio::test]
async fn a_bare_program_read_of_a_picture_shows_the_model_nothing() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("ref.png"), TEST_PNG).unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-code-image".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), code_set("mock/primary", json!({})));

    let seen = Arc::new(Mutex::new(Vec::<bool>::new()));
    let recorded = Arc::clone(&seen);
    let factory = ScriptedFactory::new().slot(ROOT_PROFILE_ID, move |b| {
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
        vec![false, false],
        "a bare read is not a channel: no request carries the picture it read"
    );
    let (ok, _, _, _) = first_code_execution(&sink.events()).expect("a CodeExecution event");
    assert!(ok, "the read still succeeded inside the program");
    // The program returned `read.kind`, which is the descriptor it was handed — proof the read
    // reported the file as a picture rather than failing or reading it as text.
    assert!(
        std::fs::read_to_string(dir.path().join("kind.txt")).unwrap() == "image",
        "the program was still handed the image descriptor"
    );
}

/// **`view.openFile` is the channel, and no count bounds it.**
///
/// Five mockups and a program that opens all five: every one of them carries its picture into the
/// window. There is no cap on how many image views an agent may hold — what makes a window too full
/// is tokens, which the fullness signal reports per file and the agent can act on with a close, and
/// a count cap would have refused the model the fifth thing it decided to look at in exchange for a
/// bound the accounting already gives it honestly. This drives the whole loop and reads the
/// *provider's* copy of the next request, which is the only place what the run actually uploads is
/// visible.
#[tokio::test]
async fn every_image_view_a_program_opens_carries_its_picture() {
    let dir = TempDir::new().unwrap();
    for name in ["a.png", "b.png", "c.png", "d.png", "e.png"] {
        std::fs::write(dir.path().join(name), TEST_PNG).unwrap();
    }

    let (outcome, _, requests) = drive_recorded_code_run(
        &dir,
        code_set("mock/primary", json!({})),
        vec![code_reply(
            "import * as gg from \"gg\";\nconst refused = [];
             for (const p of [\"a.png\", \"b.png\", \"c.png\", \"d.png\", \"e.png\"]) {
             \x20 try {
             \x20   gg.views.openFile(p);
             \x20 } catch (error) {
             \x20   refused.push(p + \": \" + (error as gg.core.ApiError).code);
             \x20 }
             }
             gg.files.writeFile(\"refused.txt\", refused.join(\"\\n\") || \"none\");",
        )],
    )
    .await;
    assert_eq!(outcome, SessionOutcome::Ran);

    assert_eq!(
        std::fs::read_to_string(dir.path().join("refused.txt")).unwrap(),
        "none",
        "nothing is refused for want of a slot"
    );

    let after = requests.get(1).expect("a turn after the program ran");
    assert_eq!(
        after.iter().filter(|m| !m.images.is_empty()).count(),
        5,
        "all five image views are open and all five carry their picture"
    );
}

/// **Re-opening a path that is already an open image view replaces it rather than adding one.**
///
/// The property that survives the cap's removal and is what actually bounds what a run uploads: a
/// program that re-renders and re-opens one screenshot every turn leaves exactly one picture
/// resident, because the superseded copy is retagged in place *and has its picture taken out*.
#[tokio::test]
async fn re_opening_an_image_view_leaves_one_picture_resident() {
    let dir = TempDir::new().unwrap();
    for name in ["a.png", "b.png", "c.png", "d.png"] {
        std::fs::write(dir.path().join(name), TEST_PNG).unwrap();
    }

    let (outcome, _, requests) = drive_recorded_code_run(
        &dir,
        code_set("mock/primary", json!({})),
        vec![code_reply(
            "import * as gg from \"gg\";\nfor (const p of [\"a.png\", \"b.png\", \"c.png\", \"d.png\"]) {
             \x20 gg.views.openFile(p);
             }
             gg.views.openFile(\"a.png\");",
        )],
    )
    .await;
    assert_eq!(outcome, SessionOutcome::Ran);

    let after = requests.get(1).expect("a turn after the program ran");
    assert_eq!(
        after.iter().filter(|m| !m.images.is_empty()).count(),
        4,
        "the same program opened it moments ago and nothing has been sent, so the re-open replaces \
         the copy in place rather than leaving a corpse beside it"
    );
}

/// **`view.openFile` honours `offset`/`limit` under the unlimited read policy, and the view is keyed
/// by the window it actually covers.**
///
/// The drive harness runs every code-mode agent under [`ReadPolicy::Unlimited`], which only decides
/// what a call naming no `limit` gets. A program that opens one page of a file gets that page — the
/// footer says which lines — and re-opening the same page supersedes it while a different page sits
/// beside it, because the `(path, region)` key comes from what the read returned.
#[tokio::test]
async fn a_file_view_opened_with_a_window_covers_that_window_under_the_unlimited_policy() {
    let dir = TempDir::new().unwrap();
    let body: String = (1..=20).map(|n| format!("line {n}\n")).collect();
    std::fs::write(dir.path().join("lines.txt"), body).unwrap();

    let (outcome, _, requests) = drive_recorded_code_run(
        &dir,
        code_set("mock/primary", json!({})),
        vec![code_reply(
            "import * as gg from \"gg\";
             gg.views.openFile(\"lines.txt\", { offset: 5, limit: 3 });
             gg.views.openFile(\"lines.txt\", { offset: 5, limit: 3 });
             gg.views.openFile(\"lines.txt\", { offset: 8, limit: 3 });
             gg.views.openFile(\"lines.txt\", { offset: 18 });",
        )],
    )
    .await;
    assert_eq!(outcome, SessionOutcome::Ran);

    let after = requests.get(1).expect("a turn after the program ran");
    let views: Vec<&str> = after
        .iter()
        .filter_map(|m| m.content.as_deref())
        .filter(|c| c.starts_with("File: lines.txt:"))
        .collect();
    assert_eq!(
        views.len(),
        3,
        "the repeated page superseded its first copy; the other two pages sit beside it: {views:#?}"
    );
    let page = |start: usize| {
        views
            .iter()
            .find(|v| v.contains(&format!("line {start}\n")))
            .unwrap_or_else(|| panic!("no view starts at line {start}: {views:#?}"))
    };
    let first = page(5);
    assert!(
        first.starts_with("File: lines.txt:5-7 of 20 lines\n----\n"),
        "{first}"
    );
    assert!(
        first.contains("[showing lines 5-7 of 20; continue with offset: 8]"),
        "{first}"
    );
    assert!(
        !first.contains("line 4\n") && !first.contains("line 8\n"),
        "{first}"
    );
    let second = page(8);
    assert!(
        second.contains("[showing lines 8-10 of 20; continue with offset: 11]"),
        "{second}"
    );
    let tail = page(18);
    assert!(
        tail.starts_with("File: lines.txt:18-20 of 20 lines\n----\n"),
        "{tail}"
    );
    assert!(
        tail.contains("[showing lines 18-20 of 20]") && tail.contains("line 20\n"),
        "an offset alone reads to the end of the file: {tail}"
    );
}

/// **A program's output goes to the operator — which means it has to go *somewhere*.**
///
/// `console.*` is deliberately not a channel into the model's own window: what a program shows
/// itself is a view, which arrives as its own attributable context message. But a channel that
/// reaches neither the model nor any record is not a channel at all, and the sandbox's capture
/// buffer is discarded the moment the turn ends. The turn's own `CodeExecution` event is therefore
/// the one place a program's output is written down, and this asserts both halves of that: the
/// event carries every line, and no message gg hands the model contains any of them.
#[tokio::test]
async fn a_programs_logs_are_recorded_on_its_turn_and_withheld_from_its_model() {
    let dir = TempDir::new().unwrap();
    let (outcome, events, requests) = drive_recorded_code_run(
        &dir,
        code_set("mock/primary", json!({})),
        vec![code_reply(
            "console.log(\"checked 12 files\");\nconsole.error(\"3 of them changed\");",
        )],
    )
    .await;
    assert_eq!(outcome, SessionOutcome::Ran);

    let logged = code_logs(&events);
    assert_eq!(
        logged.first(),
        Some(&(
            vec![
                "checked 12 files".to_string(),
                "3 of them changed".to_string()
            ],
            0
        )),
        "the turn's own event is the only record of what its program printed: {logged:?}"
    );
    assert_eq!(
        logged.get(1).map(|(lines, _)| lines.len()),
        Some(0),
        "the finishing turn printed nothing, and says so with an empty list"
    );

    // Every message but the assistant turns, which are the model's OWN programs and of course
    // contain the source of the calls it wrote.
    for messages in &requests {
        for message in messages.iter().filter(|m| m.role != Role::Assistant) {
            let body = message.content.clone().unwrap_or_default();
            assert!(
                !body.contains("checked 12 files") && !body.contains("3 of them changed"),
                "a log line reached the model: {body}"
            );
        }
    }
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
            "import * as gg from \"gg\";\nconst read = gg.files.readFile(\"ref.png\");\ngg.files.writeFile(\"kind.txt\", read.kind);"
        } else {
            "import * as gg from \"gg\";\ngg.session.finish(\"I have seen the mockup.\");"
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
    crate::tools::grant(&mut set.agents[0], CAPABILITY_AGENT_MANAGED_CONTEXT);
    let (outcome, events) = drive_code_run(&dir, set, |b| {
        scripted_programs(
            &b.model_id,
            &[
                // Turn 1: read a large file, so the thread carries a large turn.
                "import * as gg from \"gg\";\ngg.files.readFile(\"big.txt\").kind;",
                // Turn 2: both reclaims, reporting what each one says it freed. Returning the
                // reports at all proves the loop rewrote the outcomes: an un-rewritten outcome has
                // no structured result and would have thrown.
                "import * as gg from \"gg\";\nconst evicted = gg.context.evictFileView();\n\
                 const archived = gg.context.archiveThread([{ from: 1, to: 1 }]);\n\
                 console.log(evicted.detail);\n\
                 console.log(JSON.stringify({ evicted: evicted.items, archived: archived.items, \
                 freed: archived.reclaimedTokens }));",
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

/// **A code skill really does bind its module and run its on-use script**, end to end through a
/// driven session — the one assertion that covers the whole path at once: a directory-shaped skill
/// on disk, a read that loads it, a module bound at `lib.<key>` in the *next* turn's program, and an
/// on-use script whose view reaches the model on the turn after the read.
///
/// The turn boundary is the point. A read reaches gg from inside a call the running program is still
/// in the middle of, so the module cannot be bound and the script cannot run until that program has
/// ended; a test that read and called in one program would pass against an implementation that had
/// got the deferral wrong.
#[tokio::test]
async fn a_code_skill_binds_its_module_and_runs_its_on_use_script() {
    let dir = TempDir::new().unwrap();
    let skill = dir.path().join(".gg").join("skills").join("csv-tools");
    std::fs::create_dir_all(&skill).unwrap();
    std::fs::write(
        skill.join("skill.md"),
        "---\nname: csv-tools\ndescription: Parsing comma-separated text.\n---\n",
    )
    .unwrap();
    std::fs::write(
        skill.join("skill.ts"),
        "export function parse(text: string): string[] { return text.split(\",\"); }\n",
    )
    .unwrap();
    std::fs::write(
        skill.join("on-use.ts"),
        "import * as gg from \"gg\";\nimport * as csvTools from \"lib:csvTools\";\n\
         gg.views.openText(\"csv-tools\", \"loaded \" + csvTools.parse(\"a,b\").length);\n",
    )
    .unwrap();

    let (outcome, _events, requests) = drive_recorded_code_run(
        &dir,
        code_set("mock/primary", json!({})),
        program_script(&[
            // The use and a search for what it produced, in **one** program: the registry the
            // documentation surface reads is the one the load writes to, so a module brought into
            // use mid-turn is searchable on that turn rather than on the next one.
            "import * as gg from \"gg\";\ngg.skills.readSkill(\"csv-tools\");\n\
             gg.views.openText(\"found\", JSON.stringify(gg.docs.search({ query: \"parse\" })\n\
             .hits.map((hit) => hit.key)));",
            // The next turn: the module is bound, and the on-use script's view has arrived.
            "import * as gg from \"gg\";\nimport * as csvTools from \"lib:csvTools\";\n\
             gg.views.openText(\"parsed\", JSON.stringify(csvTools.parse(\"x,y,z\")));",
        ]),
    )
    .await;

    assert_eq!(outcome, SessionOutcome::Ran);
    assert_valid_conversations(&requests);
    let text = |messages: &[crate::model::Message]| {
        messages
            .iter()
            .filter_map(|message| message.content.clone())
            .collect::<Vec<_>>()
            .join("\n")
    };

    // The use opened documentation rather than saying anything: one view per declaration the module
    // offers that a program can call, headed by the key it is filed under, carrying the specifier
    // the program imports it by. The sentence this replaced is asserted gone, because a reply is
    // exactly the wrong place for the one fact no search can answer — it goes out with the next
    // compaction, and this does not.
    let after_read = text(&requests[1]);
    assert!(
        after_read.contains("Documentation: csvTools.parse"),
        "the use opened a view of the declaration: {after_read}"
    );
    assert!(
        after_read.contains("lib:csvTools"),
        "and that view names the specifier the program imports it by: {after_read}"
    );
    assert!(
        !after_read.contains("It stays bound for the rest of your session"),
        "and nothing was appended to the read's own reply: {after_read}"
    );
    // The other half of the sentence that went: an on-use script is queued and runs, and the model
    // is told about it by what the script shows rather than by gg narrating that one exists.
    assert!(
        !after_read.contains("also runs a script"),
        "including the half about the script: {after_read}"
    );
    // And the module was on the documentation surface *before* the program that loaded it ended:
    // the search that program composed came back with the declaration's own key.
    assert!(
        after_read.contains("csvTools.parse\""),
        "a module used mid-turn is searchable on that turn: {after_read}"
    );
    // The on-use script ran after that turn's program, so its view is in the very next prompt.
    assert!(
        after_read.contains("loaded 2"),
        "the on-use script's view reaches the model on the next turn: {after_read}"
    );
    // And the module was really bound: the next program called it and got an answer.
    let last = text(requests.last().expect("a recorded request"));
    assert!(
        last.contains("[\"x\",\"y\",\"z\"]"),
        "the module is callable from a later program: {last}"
    );
}

/// **A skill whose code is spelled in no language any agent in the run writes refuses the launch.**
///
/// It used to read as prose with a `warn` on the operator's stream, and that is the shape this
/// remediation deletes: the module the author wrote was never bound, the skill still read, and the
/// run was then indistinguishable from the arm with no code skills in it at all — on the evidence
/// of one warning, on a turn nobody re-reads. The directory is right there to be fixed, so the
/// [workspace gate](crate::validate::validate_workspace) names it before a token is spent.
///
/// The refusal names the spellings the directory *does* carry, because that is the whole of what
/// the author has to change.
///
/// The fixture language stands in for a real second arm, which is exactly what it is for: with only
/// the two ECMAScript arms registered, each reads the other's spelling and this path has no way to
/// be reached at all.
#[tokio::test]
async fn a_skill_spelled_in_no_language_this_agent_writes_is_refused() {
    let dir = TempDir::new().unwrap();
    let skill = dir.path().join(".gg").join("skills").join("csv-tools");
    std::fs::create_dir_all(&skill).unwrap();
    std::fs::write(
        skill.join("skill.md"),
        "---\nname: csv-tools\ndescription: Parsing comma-separated text.\n---\n\nSplit on commas.\n",
    )
    .unwrap();
    // Authored for a language this agent does not write, and only for that one.
    std::fs::write(skill.join("skill.fixture"), "def parse(text): pass\n").unwrap();

    let (outcome, events, requests) = drive_recorded_code_run(
        &dir,
        code_set("mock/primary", json!({})),
        program_script(&["import * as gg from \"gg\";\ngg.skills.readSkill(\"csv-tools\");"]),
    )
    .await;

    assert_eq!(outcome, SessionOutcome::HarnessError);
    let errors: Vec<&String> = events
        .iter()
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::Log { level, message } if level == "error" => Some(message),
            _ => None,
        })
        .collect();
    let refused = errors
        .iter()
        .find(|message| message.contains("csv-tools"))
        .unwrap_or_else(|| panic!("the refusal names the skill: {errors:?}"));
    assert!(
        refused.contains(".fixture"),
        "the refusal names the spelling the directory carries: {refused}"
    );

    // …and nothing ran: the launch is refused before the first turn, so no request was ever made.
    assert!(
        requests.is_empty(),
        "a refused launch spends nothing: {requests:?}"
    );
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
            &format!(
                "import * as gg from \"gg\";\ngg.skills.readSkill(\"{DEFAULT_MOCK_SKILL}\").length;"
            ),
            // A second read of the same skill must not pin a second copy.
            &format!(
                "import * as gg from \"gg\";\ngg.skills.readSkill(\"{DEFAULT_MOCK_SKILL}\").length;"
            ),
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
    // FRESH read; the repeat read emits nothing, because nothing changed. Only the authored skill's
    // flag is read: the catalogue also carries the built-ins gg ships for this agent's own families,
    // and none of those was read here.
    let read_flags: Vec<bool> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::SkillsState { skills, .. } => skills
                .iter()
                .find(|skill| skill.name == DEFAULT_MOCK_SKILL)
                .map(|skill| skill.read),
            _ => None,
        })
        .collect();
    assert_eq!(
        read_flags,
        vec![false, true],
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
    let factory = ScriptedFactory::new().slot(ROOT_PROFILE_ID, move |_| {
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
            code_reply("import * as gg from \"gg\";\ngg.session.finish(\"wrote the scaffold\");"),
            // Never reached: the loop must not ask for another turn after a completion.
            code_reply(
                "import * as gg from \"gg\";\ngg.files.writeFile(\"after-the-end.txt\", \"nope\");",
            ),
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
            code_reply("import * as gg from \"gg\";\ngg.session.finish(\"done despite myself\");\nthrow new Error(\"boom\");"),
            code_reply("import * as gg from \"gg\";\ngg.session.finish(\"and this time it really is done\");"),
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

/// **Nothing but a program calling `finish` ends the session.**
///
/// This is the round-1 failure inverted. Three of four real models narrated a finished task in prose
/// and gg read that as "done", reporting a completed run over a workspace with no deliverable in it.
/// Now a reply of prose is compiled like any other — it fails, with the compiler's own diagnostic —
/// an empty reply is an empty program that runs and does nothing, the run carries on through both,
/// and the model's *next* program is what ends it.
#[tokio::test]
async fn only_a_program_that_calls_finish_ends_the_session() {
    let dir = TempDir::new().unwrap();
    let (outcome, events, requests) = drive_recorded_code_run(
        &dir,
        code_set("mock/primary", json!({})),
        vec![
            // The modal terminal reply: prose, submitted as the program.
            code_reply("The scaffold is already complete; nothing left to do."),
            // An empty submission is not a completion either.
            code_reply(""),
            // ...and only now does the run end, because the model wrote a program that says so.
            code_reply(FINISHING_PROGRAM),
        ],
    )
    .await;

    assert_eq!(outcome, SessionOutcome::Ran);
    assert_eq!(
        ended_with(&events),
        "completed",
        "the session ended on the finishing program, not on either of the two before it"
    );
    assert_valid_conversations(&requests);

    let executions = code_executions(&events);
    assert_eq!(
        executions.len(),
        3,
        "every code-shaped turn is measured, including the two that produced nothing"
    );

    // The prose reply reached the type-strip and did not survive it — and what the turn carries is
    // the compiler's error, not a sentence of gg's about whether the text was "really" a program.
    let (ok, tool_calls, duration_ms, error) = &executions[0];
    assert!(!ok, "prose does not compile");
    assert_eq!(*tool_calls, 0);
    assert_eq!(
        *duration_ms,
        Some(0),
        "the reply reached the transpile: {duration_ms:?}"
    );
    let error = error.as_deref().unwrap_or_default();
    assert!(
        !error.contains("was prose"),
        "the turn carried gg's verdict rather than the compiler's: {error}"
    );

    // The empty submission is an empty program: it compiles, it runs, and it does nothing.
    let (ok, tool_calls, _, error) = &executions[1];
    assert!(ok, "an empty program runs: {error:?}");
    assert_eq!(*tool_calls, 0);

    assert_eq!(
        code_completions(&events),
        vec![None, None, Some(FINISHING_SUMMARY.to_string())],
        "only the program that called `finish` finished anything"
    );

    // A program that put nothing in its own context earns the one notice a clean turn can produce,
    // which is what keeps a model that has stopped writing programs from looping in silence.
    assert!(
        requests[2].iter().any(|message| message
            .content
            .as_deref()
            .is_some_and(|text| text.contains("put nothing in your context"))),
        "the empty program's turn said nothing at all back"
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
            code_reply("import * as gg from \"gg\";\ngg.files.writeFile(\"one.txt\", \"1\");\n1;"),
            code_reply("import * as gg from \"gg\";\ngg.files.writeFile(\"two.txt\", \"2\");\n2;"),
            code_reply(FINISHING_PROGRAM),
        ],
    )
    .await;

    assert_eq!(
        outcome,
        SessionOutcome::LimitExceeded,
        "the turn ceiling is one of the five, so it exits on the ceiling's own code"
    );
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
/// work — and that return value is what an issue review's verdict and the run record are both read
/// out of.
#[tokio::test]
async fn a_stopped_subagent_returns_a_status_line_not_its_program_source() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-code-stop".to_string()), Box::new(sink.clone()));
    let mut set = subagent_set(2, 3, &["subagent"]);
    for agent in &mut set.agents {
        crate::tools::grant(agent, CAPABILITY_RESPONSES_AS_CODE);
    }
    // Two turns each: the parent spawns-and-waits then finishes; the child never gets to.
    set.limits.max_turns = Some(2);
    let inv = invocation(dir.path(), set);
    let factory = ScriptedFactory::new()
        .slot(ROOT_PROFILE_ID, |b| {
            Box::new(MockClient::new(
                &b.model_id,
                vec![
                    code_reply(
                        "import * as gg from \"gg\";\nconst child = gg.delegation.spawnSubagent({ agent: \"subagent\", prompt: \
                         \"Do the work.\" });\ngg.delegation.waitForSubagents([child.id]);",
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

    // The subagent spent the turn ceiling, which is a fact about the run wherever in the tree it
    // happened, so the process exits on the ceiling's own code.
    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::LimitExceeded
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
            code_reply("let x = 0;\nwhile (true) {\n  x += 1;\n}\nx;"),
            code_reply(FINISHING_PROGRAM),
        ],
    )
    .await;

    assert_eq!(
        outcome,
        SessionOutcome::LimitExceeded,
        "a run stopped by a ceiling exits on the ceiling's own code"
    );
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
                "import * as gg from \"gg\";\nlet caught = false;\ntry {\n  gg.files.readFile(\"absent.txt\");\n} catch (e) {\n  \
                 caught = true;\n}\ngg.files.writeFile(\"handled.txt\", String(caught));\ncaught;",
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

/// **A code-mode reviewer declares its verdict, and the issue is accepted.**
///
/// The reviewer's program calls `review.approve()` — the verdict *is* the call, so nothing has to be
/// read back out of prose, and a reviewer has no `harness.finish` to reach for instead. This drives a
/// whole issue review through the code path: the root program files the board issue (which
/// auto-dispatches an agent to implement it), the dispatched agent's program does the work and
/// completes the issue, and the reviewer's program declares the verdict that accepts it.
#[tokio::test]
async fn a_code_mode_reviewer_declares_its_verdict() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-code-review".to_string()), Box::new(sink.clone()));
    let mut set = issue_review_set(&["reviewer"]);
    for agent in &mut set.agents {
        crate::tools::grant(agent, CAPABILITY_RESPONSES_AS_CODE);
    }
    let inv = invocation(dir.path(), set);
    // The primary slot serves the root (agent 0: build the board, then finish — creating the issue
    // auto-dispatches an agent to implement it) then that dispatched issue agent (agent 1: write the
    // work, then finish — which is what triggers the gating review).
    let primary_counter = Arc::new(AtomicUsize::new(0));
    let factory = ScriptedFactory::new()
        .slot(ROOT_PROFILE_ID, move |b| {
            let n = primary_counter.fetch_add(1, Ordering::SeqCst);
            let programs = if n == 0 {
                vec![
                    code_reply(&format!(
                        "import * as gg from \"gg\";\nconst epic = gg.board.createEpic({{ prefix: \"{REVIEW_EPIC_PREFIX}\", \
                         title: \"Build\", description: \"the build\" }});\n\
                         gg.board.createIssue({{ title: \"Add the widget\", \
                         inScope: \"Implement the widget.\", outOfScope: \"Unrelated changes.\", \
                         completionCriteria: \"The widget is fully implemented.\", \
                         epicId: epic.id, agent: \"{ROOT_PROFILE_ID}\", reviewers: [\"reviewer\"] }});"
                    )),
                    code_reply(FINISHING_PROGRAM),
                ]
            } else {
                vec![
                    code_reply("import * as gg from \"gg\";\ngg.files.writeFile(\"widget.txt\", \"the widget\\n\");"),
                    code_reply(FINISHING_PROGRAM),
                ]
            };
            Box::new(MockClient::new(&b.model_id, programs))
        })
        .slot("reviewer", |b| {
            Box::new(MockClient::new(
                &b.model_id,
                vec![code_reply("import * as gg from \"gg\";\ngg.session.approve();")],
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
        "the reviewer's `review.approve()` is the approval: {phases:?}"
    );
    // The brief teaches **no** ending. The reviewer's verdict calls are its role's, named once in
    // its system prompt and bound into its programs' scope; a brief that restated them would be a
    // second authority on the contract, and a mode-dependent restatement would send a code-mode
    // reviewer looking for a final message its protocol does not have.
    let review_brief = agent_spawns(&events)
        .into_iter()
        .find(|(_, _, slot, _, _)| slot == "reviewer")
        .and_then(|(_, _, _, _, brief)| brief)
        .expect("a reviewer was dispatched");
    for forbidden in ["finish(", "harness.", "review.approve", "REVIEW:"] {
        assert!(
            !review_brief.contains(forbidden),
            "the brief teaches an ending (`{forbidden}`): {review_brief}"
        );
    }
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
        crate::tools::grant(agent, CAPABILITY_RESPONSES_AS_CODE);
    }
    let inv = invocation(dir.path(), set);
    let counter = Arc::new(AtomicUsize::new(0));
    let factory = ScriptedFactory::new().slot(ROOT_PROFILE_ID, move |b| {
        let n = counter.fetch_add(1, Ordering::SeqCst);
        let programs = if n == 0 {
            vec![
                code_reply(&format!(
                    "import * as gg from \"gg\";\ngg.board.createIssue({{ title: \"Write the file\", \
                     inScope: \"Write isolated.txt.\", outOfScope: \"Nothing else.\", \
                     completionCriteria: \"isolated.txt exists.\", agent: \"{ROOT_PROFILE_ID}\" }});"
                )),
                code_reply(FINISHING_PROGRAM),
            ]
        } else {
            vec![code_reply(
                "import * as gg from \"gg\";\ngg.files.writeFile(\"isolated.txt\", \"from the worktree\\n\");\n\
                 gg.session.finish(\"wrote the file in my worktree\");",
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
// A program that keeps going after it has declared the session done
// ---------------------------------------------------------------------------

/// **A program that calls `finish` and then keeps going does the rest of the work**, and nothing is
/// reported about it.
///
/// This is the shape that would lose a run its deliverable if `finish` unwound the program: the
/// `writeFile` below it would never run, and the run would end "completed" over a workspace with no
/// artifact in it. The statement runs and the file exists.
#[tokio::test]
async fn a_program_that_finishes_and_keeps_going_still_does_the_work() {
    let dir = TempDir::new().unwrap();
    let (outcome, events, _) = drive_recorded_code_run(
        &dir,
        code_set("mock/primary", json!({})),
        vec![code_reply(
            "import * as gg from \"gg\";\ngg.session.finish(\"all done\");\ngg.files.writeFile(\"MANIFEST.md\", \"- a.ts (1 lines)\\n\");",
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
}

/// **Views the program opened before it threw are still there on the next turn.**
///
/// The property that makes a `Runtime error` carrying nothing but the error survivable. A program
/// that reads three files and then throws on the fourth has done real work, and everything it showed
/// itself stands: the views were pushed as they were opened, on the live window, so the throw does
/// not roll them back. If it did, the error message would have to re-describe what the program had
/// found — which is exactly the extra text that band exists not to carry.
#[tokio::test]
async fn views_opened_before_a_throw_survive_into_the_next_prompt() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("a.ts"), "the first file").unwrap();
    std::fs::write(dir.path().join("b.ts"), "the second file").unwrap();

    let (outcome, _, requests) = drive_recorded_code_run(
        &dir,
        code_set("mock/primary", json!({})),
        vec![
            code_reply(
                "import * as gg from \"gg\";\ngg.views.openFile(\"a.ts\");\n\
                 gg.views.openFile(\"b.ts\");\n\
                 gg.views.openText(\"progress\", \"read both files\");\n\
                 throw new Error(\"the program failed after opening its views\");",
            ),
            code_reply(FINISHING_PROGRAM),
        ],
    )
    .await;
    assert_eq!(outcome, SessionOutcome::Ran);

    let after = requests.get(1).expect("a turn after the program ran");
    let bodies: Vec<String> = after
        .iter()
        .filter_map(|m| m.content.clone())
        .collect::<Vec<_>>();

    for shown in ["the first file", "the second file", "read both files"] {
        assert!(
            bodies.iter().any(|b| b.contains(shown)),
            "a view opened before the throw was lost: {bodies:#?}"
        );
    }

    // And the error is the last thing the model reads, carrying the error alone.
    let error = bodies
        .last()
        .expect("the window is not empty")
        .strip_prefix("Runtime error\n----\n")
        .unwrap_or_else(|| panic!("the turn ends on the runtime error: {bodies:#?}"));
    assert!(
        error.contains("failed after opening its views"),
        "the error names what went wrong: {error}"
    );
    for absent in ["a.ts", "the first file", "progress", "view call"] {
        assert!(
            !error.contains(absent),
            "the error leaked `{absent}`: {error}"
        );
    }
}

// ---------------------------------------------------------------------------
// The program library
// ---------------------------------------------------------------------------

/// A capability set with responses-as-code **and** the [program library](crate::programs) on.
fn library_set(model_id: &str, params: serde_json::Value) -> GgCapabilitySet {
    let mut set = code_set(model_id, json!({}));
    crate::tools::grant_configured(
        &mut set.agents[0],
        crate::tools::configured(test_cabinet_core::gg::CAPABILITY_PROGRAM_LIBRARY, params),
    );
    set
}

/// **The whole feature, through the loop: fetch the last program, patch it, hand it back, and gg
/// runs the patched one — in the same turn.**
///
/// This is the seam nothing else can prove. `sandbox.test.rs` shows that `programs.rerun` survives
/// out of a store; `programs.rs` shows what the library keeps. Only here does the *chain* run: the
/// hand-over is honoured after the registering program ends, against the same live workspace, and
/// what the turn reports is the last program's.
#[tokio::test]
async fn a_program_fetches_its_predecessor_patches_it_and_gg_runs_the_patched_one() {
    let dir = TempDir::new().unwrap();
    // Turn 1 writes the wrong contents. Turn 2 never re-emits the program: it fetches turn 1's
    // source, replaces the one wrong word, and hands it back — which is the whole point of the
    // capability, and the reason the second reply is two lines rather than one program.
    let first =
        "import * as gg from \"gg\";\ngg.files.writeFile(\"level.txt\", \"cosnt LEVELS = 3;\");";
    let second = "import * as gg from \"gg\";\nconst source = gg.programs.get(1);\n\
         gg.programs.rerun(source.replace(\"cosnt\", \"const\"));";
    let (outcome, events) =
        drive_code_run(&dir, library_set("mock/primary", json!({})), move |b| {
            scripted_programs(&b.model_id, &[first, second])
        })
        .await;
    assert_eq!(outcome, SessionOutcome::Ran);

    assert_eq!(
        std::fs::read_to_string(dir.path().join("level.txt")).unwrap(),
        "const LEVELS = 3;",
        "the PATCHED program is what ran: gg compiled what the second reply handed over"
    );

    // One `CodeExecution` per turn, not one per program: a chained turn is still one turn to
    // everything outside it, and the chain's records are folded into the turn's.
    let executions = code_executions(&events);
    assert_eq!(
        executions.len(),
        3,
        "two working turns and the finishing one"
    );
    let (ok, tool_calls, _, error) = &executions[1];
    assert!(ok, "the handed-over program ran cleanly: {error:?}");
    assert_eq!(
        *tool_calls, 1,
        "the turn's roster carries the write the handed-over program made"
    );
}

/// **The library survives what the window does not, and records the program that ran.**
///
/// Two properties in one run, because each costs a component compile. First, `history()` reports
/// what gg holds and `get()` with no argument is the most recent. Second — and this is what makes
/// fetch-patch-rerun *compose* — the source kept for a chained turn is the program that
/// **executed**, not the two lines that handed it over.
#[tokio::test]
async fn the_library_keeps_the_program_that_ran_not_the_one_that_handed_it_over() {
    let dir = TempDir::new().unwrap();
    let first = "import * as gg from \"gg\";\ngg.files.writeFile(\"a.txt\", \"one\");";
    // Turn 2 hands over a program that is itself worth fetching later.
    let second = "import * as gg from \"gg\";\n\
         gg.programs.rerun('import * as gg from \"gg\";\\ngg.files.writeFile(\"b.txt\", \"two\");');";
    // Turn 3 reads back what turn 2 *ran*, and shows it to the operator so the test can read it.
    let third = "import * as gg from \"gg\";\nconsole.log(gg.programs.get(2));\n\
         console.log(JSON.stringify(gg.programs.history().map((p) => p.turn)));";
    let (outcome, events) =
        drive_code_run(&dir, library_set("mock/primary", json!({})), move |b| {
            scripted_programs(&b.model_id, &[first, second, third])
        })
        .await;
    assert_eq!(outcome, SessionOutcome::Ran);

    let logs = code_logs(&events);
    let (third_logs, _) = &logs[2];
    assert_eq!(
        third_logs[0], "import * as gg from \"gg\";\ngg.files.writeFile(\"b.txt\", \"two\");",
        "the turn kept the program that did the work, not the `rerun` that asked for it"
    );
    assert_eq!(
        third_logs[1], "[1,2]",
        "one entry per turn that ran a program, keyed by the turn the model reads on its results"
    );
}

/// **A hand-over from a program that then throws is not run, and the model is told.**
///
/// The rule an ending already obeys, applied to the same evidence: a program that did not run to
/// its end did not decide what should run next either. Without the notice the model would be
/// waiting for a program that never ran, with nothing in its window saying so.
#[tokio::test]
async fn a_hand_over_is_cancelled_when_the_program_then_throws() {
    let dir = TempDir::new().unwrap();
    let (outcome, _, requests) = drive_recorded_code_run(
        &dir,
        library_set("mock/primary", json!({})),
        vec![
            code_reply(
                "import * as gg from \"gg\";\ngg.programs.rerun('gg.files.writeFile(\"never.txt\", \"x\");');\n\
                 throw new Error(\"the program failed after handing over\");",
            ),
            code_reply(FINISHING_PROGRAM),
        ],
    )
    .await;
    assert_eq!(outcome, SessionOutcome::Ran);

    assert!(
        !dir.path().join("never.txt").exists(),
        "the replacement was not run"
    );
    let bodies: Vec<String> = requests
        .get(1)
        .expect("a turn after the program failed")
        .iter()
        .filter_map(|m| m.content.clone())
        .collect();
    assert!(
        bodies
            .iter()
            .any(|body| body.contains("was NOT run") && body.contains("failed after handing it")),
        "the model is told its hand-over was cancelled: {bodies:#?}"
    );
}

/// **A code memory written under the scratchpad opens its documentation too**, end to end — the
/// second of the two paths that load a module, and the only one where the *write* is the use.
///
/// The scratchpad keeps every memory in the window, so there is no `read_memory` to load the code
/// later: the write is the one moment it can load, and the sentence the write used to append
/// ("it loads when you read the memory back") has gone with it. What replaces it is the same set of
/// pages a skill's use opens, which is what this asserts arrives — on the next turn's prompt, and
/// spelled the way the module is really reached.
#[tokio::test]
async fn a_code_memory_written_under_the_scratchpad_opens_its_documentation() {
    let dir = TempDir::new().unwrap();
    let mut set = code_set("mock/primary", json!({}));
    crate::tools::grant(
        &mut set.agents[0],
        test_cabinet_core::gg::CAPABILITY_MEMORIES,
    );

    let (outcome, _events, requests) = drive_recorded_code_run(
        &dir,
        set,
        program_script(&["import * as gg from \"gg\";\n\
             gg.memories.writeMemory({ name: \"csv-tools\", description: \"Parsing CSV.\", \
             body: \"Use the module.\", code: \"/** Split a CSV into rows. */\\nexport function \
             parse(text: string): string[] { return text.split(\\\",\\\"); }\\n\" });"]),
    )
    .await;

    assert_eq!(outcome, SessionOutcome::Ran);
    let after_write = requests[1]
        .iter()
        .filter_map(|message| message.content.clone())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(
        after_write.contains("Documentation: csvTools.parse"),
        "the write opened a view of the declaration it carried: {after_write}"
    );
    assert!(
        after_write.contains("Split a CSV into rows."),
        "carrying the author's own prose: {after_write}"
    );
    assert!(
        !after_write.contains("It loads — and its `lib` key is named — when you read the memory"),
        "and nothing was appended to the write's own reply: {after_write}"
    );
}
