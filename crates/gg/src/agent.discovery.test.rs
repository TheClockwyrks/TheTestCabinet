//! [Discovery](crate::discovery) through the **whole loop**: a model writes a program, gg runs it in
//! the wasmtime sandbox, and the turn's record says whether the model had read what it was calling.
//!
//! What is being held here is the one rule the mechanism rests on and cannot be checked anywhere
//! else: **only a view the model could actually have read clears a call**. That is a statement about
//! the boundary between two turns, so it needs two turns and a real window — the unit tests around
//! the bracket (`recording.test.rs`) can prove that an answer is recorded, and only a session can
//! prove that the answer is the right one.
//!
//! # One scenario
//!
//! The cases are turns of one run — a model that guesses, then guesses again while opening the page
//! in the same breath, then finally calls what it read last turn — because what is under test is the
//! boundary *between* turns, and only a run that carries a window from one turn to the next has
//! one.

use super::*;

/// A model that writes `programs[n]` on turn *n* and then ends the session.
fn scripted(model_id: &str, programs: &[&str]) -> Box<dyn ModelClient> {
    let mut script: Vec<ModelResponse> = programs.iter().map(|p| code_reply(p)).collect();
    script.push(code_reply(FINISHING_PROGRAM));
    Box::new(MockClient::new(model_id, script))
}

/// Every `CodeExecution`'s discovery record, in turn order.
fn undocumented(events: &[GgTelemetryEvent]) -> Vec<GgUndocumentedCalls> {
    events
        .iter()
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::CodeExecution {
                undocumented_calls, ..
            } => Some(undocumented_calls.clone()),
            _ => None,
        })
        .collect()
}

/// The `warn` lines gg logged over the run.
fn warnings(events: &[GgTelemetryEvent]) -> Vec<String> {
    events
        .iter()
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::Log { level, message } if level == "warn" => Some(message.clone()),
            _ => None,
        })
        .collect()
}

/// **The whole rule, in one run of four turns.**
///
/// 1. A call with no documentation view open is a violation.
/// 2. A call whose view this very program opened, one line earlier, is **still** a violation — the
///    model wrote the whole program before any of it ran, so it had read nothing.
/// 3. The same call on the next turn is not: the view opened on turn 2 is in the window the model
///    read before writing turn 3.
/// 4. `finish` is never a violation, because gg's own prompt spells it.
///
/// It also holds the two things that make the finding usable: the count reaches the session summary
/// with the operation named, and the operator is warned **once** rather than once per call.
#[tokio::test]
async fn only_a_view_the_model_could_have_read_clears_a_call() {
    let dir = TempDir::new().unwrap();
    let (outcome, events) = drive_discovery_run(
        &dir,
        &[
            // Turn 1 — nothing open for `writeFile`: a guess.
            "import * as gg from \"gg\";\ngg.files.writeFile(\"guessed.txt\", \"never looked up\");",
            // Turn 2 — the view is opened and the call written in the same program. The open is a
            // real one and the page lands in the window, but the model has not read it: it wrote
            // both lines at once.
            "import * as gg from \"gg\";\ngg.views.openDocsView(\"writeFile\");\n\
             gg.files.writeFile(\"same-turn.txt\", \"opened one line up\");",
            // Turn 3 — the same call, now written on a turn that began holding the page.
            "import * as gg from \"gg\";\ngg.files.writeFile(\"read-first.txt\", \"discovered\");",
        ],
    )
    .await;
    assert_eq!(outcome, SessionOutcome::Ran);
    assert_eq!(ended_with(&events), "completed");

    let per_turn = undocumented(&events);
    assert_eq!(per_turn.len(), 4, "four code turns, four records");

    // (1) A call nothing documented, named by the operation rather than by the arm's spelling.
    assert_eq!(per_turn[0].calls, 1);
    assert_eq!(per_turn[0].operations.get("files.write_file"), Some(&1));

    // (2) The interesting half: opening the page in the same program does not clear the call it
    // documents — and the `openDocsView` beside it is itself clean, because the bootstrap opened a
    // view of *that* before the model's first turn.
    assert_eq!(
        per_turn[1].operations.keys().collect::<Vec<_>>(),
        vec!["files.write_file"],
        "the open is not a violation (the bootstrap documented it); the call it opened for is"
    );
    assert_eq!(per_turn[1].calls, 1);

    // (3) The page the model was holding when it wrote this turn clears the call.
    assert!(
        per_turn[2].is_empty(),
        "a view opened on an earlier turn is a view the model read: {:?}",
        per_turn[2]
    );

    // (4) The ending call gg spells in its own prompt is never counted.
    assert!(
        per_turn[3].is_empty(),
        "`finish` is named in the prompt, so calling it is following an instruction: {:?}",
        per_turn[3]
    );

    // The run rollup is the sum, with the breakdown intact — which is what makes the finding
    // actionable rather than a bare number.
    let summary = session_summary(&events).expect("a session summary");
    assert_eq!(summary.undocumented_calls.calls, 2);
    assert_eq!(
        summary
            .undocumented_calls
            .operations
            .get("files.write_file"),
        Some(&2),
        "the rollup names which call the model guessed at, not just how often"
    );
    assert_eq!(
        summary.undocumented_calls.calls,
        summary.undocumented_calls.operations.values().sum::<u64>(),
        "the count and its breakdown are written by one statement and cannot disagree"
    );

    // One line for the run, however many calls it took — and worded so a reader knows what it says
    // about the model rather than about the call.
    let warned: Vec<String> = warnings(&events)
        .into_iter()
        .filter(|line| line.contains("documentation"))
        .collect();
    assert_eq!(
        warned.len(),
        1,
        "the operator is told once per run, not once per call: {warned:?}"
    );
    let line = &warned[0];
    assert!(
        line.contains("gg.files.writeFile"),
        "the line spells the call the way this arm's programs write it: {line}"
    );
    assert!(
        line.contains("files.write_file"),
        "and names gg's own id beside it, which is what the telemetry counts under: {line}"
    );
    assert!(
        line.contains("writing calls from memory"),
        "the line says what it means about the model: {line}"
    );
}

/// [`drive_code_run`](super::sandbox_tests) is private to its own file; this is the same three
/// lines, so the scenario above can live beside the mechanism it tests rather than inside the
/// sandbox suite.
async fn drive_discovery_run(
    dir: &TempDir,
    programs: &[&str],
) -> (SessionOutcome, Vec<GgTelemetryEvent>) {
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-code".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), code_set("mock/primary", json!({})));
    let owned: Vec<String> = programs.iter().map(|p| (*p).to_string()).collect();
    let factory = ScriptedFactory::new().slot(ROOT_PROFILE_ID, move |b| {
        scripted(
            &b.model_id,
            &owned.iter().map(String::as_str).collect::<Vec<_>>(),
        )
    });
    let outcome = run_with_factory(&inv, &emitter, Arc::new(factory)).await;
    (outcome, sink.events())
}

/// The terminal session status.
fn ended_with(events: &[GgTelemetryEvent]) -> String {
    match &events.last().expect("a terminal event").kind {
        GgTelemetryKind::SessionEnded { status } => status.clone(),
        other => panic!("the stream must end with SessionEnded, got {other:?}"),
    }
}
