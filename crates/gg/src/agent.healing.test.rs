//! The seam between [response healing](crate::healing) and the turn loop.
//!
//! Healing's own suite proves the algorithm — what each strategy matches, what it declines, that a
//! healed program is always a subsequence of the reply — over pure inputs with no loop behind it.
//! What it cannot prove is the wiring, and the wiring is where this subsystem's honesty lives: that
//! what gg repaired is **counted on the turn's telemetry** and never disclosed to the model, and
//! that every reply — repaired or not — goes on to the type-strip.
//!
//! The round-1 captures are used verbatim here as well as in the healing suite, because the two
//! answer different questions about them: there, "what does the algorithm do with this?"; here,
//! "what does the model see, and what does the run record, when a real model sends it?".

use test_cabinet_core::gg::GgProgramLanguage;

use super::*;

/// The modal round-1 terminal reply: prose that healing leaves alone (its `strip-prose` predicate
/// declines, because that strategy *deletes*) and that then fails to type-strip, which is the
/// diagnostic the model is answered with.
const TERMINAL_PROSE: &str = include_str!("testdata/round1-haiku-turn-04.txt");

/// A real single-block round-1 reply: prose, one `ts` block, prose. The positive case.
const FENCED_PROGRAM: &str = include_str!("testdata/round1-haiku-turn-03.txt");

/// A capability set with responses-as-code enabled and `params` on it.
fn healing_set(params: serde_json::Value) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal("mock/primary");
    let mut capability = GgCapabilityConfig::enabled(CAPABILITY_RESPONSES_AS_CODE);
    capability.params = params;
    crate::tools::grant_configured(&mut set.agents[0], capability);
    set
}

/// A [`CodeSetup`] with responses-as-code on and `healing` armed as given.
fn code_with(healing: HealingConfig) -> CodeSetup {
    CodeSetup {
        enabled: true,
        language: GgProgramLanguage::TypeScript,
        limits: SandboxLimits::default(),
        healing,
        assistant_messages: AssistantMessageMode::None,
        doc_view_types: crate::docs::DocViewTypes::default(),
    }
}

/// Every `CodeExecution`'s healing record, in order.
fn healing_records(events: &[GgTelemetryEvent]) -> Vec<GgResponseHealing> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::CodeExecution { healing, .. } => Some(healing.clone()),
            _ => None,
        })
        .collect()
}

/// Every `CodeExecution`'s `(ok, duration_ms, error)`, in order.
fn executions(events: &[GgTelemetryEvent]) -> Vec<(bool, Option<u64>, Option<String>)> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::CodeExecution {
                ok,
                duration_ms,
                error,
                ..
            } => Some((*ok, *duration_ms, error.clone())),
            _ => None,
        })
        .collect()
}

// ---------------------------------------------------------------------------
// What the run records
// ---------------------------------------------------------------------------

/// **A healed turn reports what was healed, and a clean turn reports nothing at all.**
///
/// The healing record is defaulted and omitted from the wire for a clean reply, so the *presence* of
/// the object on an event is itself "something was unusual about this response" — which is what lets
/// a study count how often each model still wraps its program in a fence after being told not to.
///
/// Both replies here are real: the fenced one is a captured round-1 turn, and the bare one is the
/// same program with the wrapper the model should not have sent.
#[tokio::test]
async fn a_healed_turn_reports_what_was_healed_on_its_code_execution() {
    let dir = TempDir::new().unwrap();
    std::fs::create_dir_all(dir.path().join("src")).unwrap();
    std::fs::write(dir.path().join("src/a.ts"), "export const a = 1;\n").unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());
    let client = MockClient::new(
        "mock/primary",
        vec![
            // A real fenced reply, with prose either side of the block.
            code_reply(FENCED_PROGRAM),
            // The same shape, sent the way the prompt asks for it.
            code_reply("import * as gg from \"gg\";\ngg.files.listDir(\"src\").length;"),
            code_reply(FINISHING_PROGRAM),
        ],
    );

    let end = drive_root(
        &client,
        dir.path(),
        &registry,
        &emitter,
        no_limits(5),
        code_with(HealingConfig::default()),
    )
    .await;
    assert_eq!(end.status, "completed");

    let records = healing_records(&sink.events());
    assert_eq!(records.len(), 3, "one record per code-shaped turn");
    assert_eq!(
        records[0].strategies,
        vec![GgHealingStrategy::StripFences],
        "the fence was stripped, and the run says which strategy did it"
    );

    assert!(
        records[1].is_clean() && records[2].is_clean(),
        "a reply that needed nothing carries the default, which the wire omits: {records:?}"
    );

    // The repaired turn carries the reply as the model sent it. Nothing else on the wire does: the
    // program is what the model's own history now holds and what every location gg reports counts
    // lines of, so this is the operator's only route back to what healing started from.
    let original = records[0]
        .original
        .as_deref()
        .expect("a rewritten reply carries the text it was rewritten from");
    assert_eq!(original, FENCED_PROGRAM);
    assert!(
        records[1].original.is_none() && records[2].original.is_none(),
        "a clean reply and its program are the same string, so neither is carried twice: {records:?}"
    );
}

/// **Healing never reaches the model.**
///
/// Every code feedback path is driven here over a repaired reply — a program that ran, one that did
/// not compile, one that ran and did nothing, and one the sandbox stopped — and none of the turns
/// that follow says a word about the repair, or names the harness at all.
///
/// The note it replaces described a mechanism the model cannot invoke, disable or reason about, in
/// gg's own name, on every repaired turn. It also had to stay honest about whether the repaired reply
/// then *ran* — and on the two paths where nothing ran, an unconditional wording contradicted the
/// very feedback it opened. What the model needs is the diagnostic, which it still gets, located in
/// the healed source gg actually compiled.
#[tokio::test]
async fn healing_is_never_disclosed_to_the_model() {
    // Three of them in one run: a program that ran, one that did not compile, and one that ran and
    // did nothing — each wrapped in the fence healing strips.
    let dir = TempDir::new().unwrap();
    let (_, _, requests) = drive_recorded_code_run(
        &dir,
        healing_set(json!({})),
        vec![
            code_reply("```ts\n1;\n```"),
            code_reply("```ts\nconst x = ;\n```"),
            code_reply("```ts\n// nothing but a note to myself\n```"),
            code_reply(FINISHING_PROGRAM),
        ],
    )
    .await;

    let leaks = |messages: &[Message]| {
        messages.iter().any(|message| {
            message.content.as_deref().is_some_and(|text| {
                text.contains("repaired your reply")
                    || text.contains("Markdown code fence you wrapped")
                    || text.contains("Only text was removed")
            })
        })
    };
    for (turn, messages) in requests.iter().enumerate().skip(1) {
        assert!(!leaks(messages), "turn {turn} was told what gg repaired");
    }

    // The last one: a program the sandbox stopped. Its own run, because it needs an execution
    // timeout short enough to trip and that timeout would strand the ordinary programs above.
    let dir = TempDir::new().unwrap();
    let (_, _, requests) = drive_recorded_code_run(
        &dir,
        healing_set(json!({ "timeoutSecs": RUNAWAY_TIMEOUT_SECS })),
        vec![
            code_reply("```ts\nlet x = 0;\nwhile (true) {\n  x += 1;\n}\nx;\n```"),
            code_reply(FINISHING_PROGRAM),
        ],
    )
    .await;
    assert!(
        !leaks(&requests[1]),
        "a turn the sandbox stopped was told what gg repaired"
    );
}

// ---------------------------------------------------------------------------
// Every reply reaches the type-strip
// ---------------------------------------------------------------------------

/// **gg performs no analysis of the reply's text beyond healing.**
///
/// Three replies that gg used to refuse without compiling — comments only, several candidate blocks,
/// and two programs pasted together — each reach the sandbox. The comment-only one compiles and runs
/// to a clean, empty turn; the other two are compiled as sent and answered with the compiler's own
/// diagnostic. What none of them earns is a sentence of gg's about how many programs it thinks the
/// reply was.
#[tokio::test]
async fn every_reply_is_compiled_rather_than_judged() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());
    let client = MockClient::new(
        "mock/primary",
        vec![
            // Comments only: a program that does nothing, which is what it is.
            code_reply("// I will write the manifest next turn."),
            // Several candidate blocks: healing declines and the whole reply is compiled.
            code_reply("```ts\n1;\n```\n\nor perhaps\n\n```ts\n2;\n```"),
            // Two programs pasted together with no fence anywhere: a redeclaration, which the
            // type-strip reports as one.
            code_reply(
                "import * as gg from \"gg\";\nconst files = gg.files.listDir(\"src\");\nfiles.length;\n\n\
                 const files = gg.files.listDir(\".\");\nfiles.map((e) => e.name);",
            ),
        ],
    );

    let end = drive_root(
        &client,
        dir.path(),
        &registry,
        &emitter,
        no_limits(3),
        code_with(HealingConfig::default()),
    )
    .await;
    assert_eq!(end.status, "exhausted", "no reply ended the session");

    let events = sink.events();
    let executions = executions(&events);
    // Every turn reached the engine or the transpile, so every one carries a duration figure — the
    // observable proof that nothing short-circuited ahead of the sandbox.
    for (index, (_, duration_ms, _)) in executions.iter().enumerate() {
        assert!(
            duration_ms.is_some(),
            "turn {index} never reached the sandbox: {duration_ms:?}"
        );
    }
    let (ok, _, error) = &executions[0];
    assert!(
        ok,
        "a comment-only program is a program that runs: {error:?}"
    );
    for (index, (ok, _, error)) in executions.iter().enumerate().skip(1) {
        assert!(!ok, "turn {index} was expected to fail to compile");
        let error = error.as_deref().unwrap_or_default();
        assert!(
            !error.contains("separate programs") && !error.contains("separate code blocks"),
            "turn {index} was answered with gg's opinion rather than the compiler's: {error}"
        );
    }

    // And nothing about any of it is claimed as a repair beyond the fence that really came off.
    let records = healing_records(&events);
    assert!(records[0].is_clean(), "{records:?}");
    assert!(records[1].is_clean(), "{records:?}");
    assert!(records[2].is_clean(), "{records:?}");
}

/// **A reply of pure prose is answered with the compiler's diagnostic.**
///
/// This is the modal round-1 failure, driven end to end with the reply a real model actually sent.
/// `strip-prose` declines on it (it deletes, so it has to be severe), the reply is compiled exactly
/// as sent, and the turn's error is the type-strip's — not gg's reading of whether the text was
/// "really" a program.
#[tokio::test]
async fn a_prose_reply_is_answered_by_the_type_strip() {
    let dir = TempDir::new().unwrap();
    let (_, events, _) = drive_recorded_code_run(
        &dir,
        healing_set(json!({})),
        vec![code_reply(TERMINAL_PROSE), code_reply(FINISHING_PROGRAM)],
    )
    .await;

    let records = healing_records(&events);
    assert!(
        records[0].is_clean(),
        "no strategy touched it, and none is claimed: {records:?}"
    );
    let (ok, duration_ms, error) = executions(&events).remove(0);
    assert!(!ok);
    assert_eq!(
        duration_ms,
        Some(0),
        "the reply reached the transpile — it just did not survive it"
    );
    let error = error.unwrap_or_default();
    assert!(
        !error.contains("prose"),
        "the turn carried gg's verdict rather than the compiler's: {error}"
    );
}

// ---------------------------------------------------------------------------
// The healing lever
// ---------------------------------------------------------------------------

/// **Turning a strategy off changes only what healing returns.**
///
/// The comparison has to be honest to be worth running: with `strip-fences` disarmed the same fenced
/// reply is compiled exactly as the model sent it, fails, and is reported as a compile failure with
/// no repair claimed. That is precisely the cost the strategy exists to measure.
#[tokio::test]
async fn disarming_a_strategy_changes_only_what_healing_returns() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());
    let mut healing = HealingConfig::default();
    healing.set(HealingStrategy::StripFences, false);
    // Prose, then a fenced program — the shape a model actually sends. With the strategy armed the
    // wrapper comes off and this runs; with it disarmed the whole reply goes to the compiler.
    let client = MockClient::new(
        "mock/primary",
        vec![code_reply("Here is the program:\n\n```ts\n1;\n```")],
    );

    let end = drive_root(
        &client,
        dir.path(),
        &registry,
        &emitter,
        no_limits(1),
        code_with(healing),
    )
    .await;
    assert_eq!(end.status, "exhausted");

    let events = sink.events();
    let records = healing_records(&events);
    assert!(
        records[0].is_clean(),
        "nothing was repaired, and nothing is claimed: {records:?}"
    );
    let (ok, duration_ms, error) = executions(&events).remove(0);
    assert!(!ok);
    assert_eq!(
        duration_ms,
        Some(0),
        "the reply reached the transpile — it just did not survive it"
    );
    assert!(error.is_some());
}

/// **An unreadable `healing` key refuses the launch.**
///
/// A typo in a healing configuration is the one failure this subsystem cannot survive:
/// `{"stripFences": false}` would otherwise run the default arm silently, under the disabled arm's
/// name, and every number the study produced would be a measurement of the wrong thing. Both
/// classes — a key that names nothing and a known key whose value is not a toggle — are named in the
/// same refusal, before a token is spent.
#[tokio::test]
async fn an_unreadable_healing_param_refuses_the_launch() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-healing".to_string()), Box::new(sink.clone()));
    let inv = invocation(
        dir.path(),
        healing_set(json!({ "healing": { "stripFences": false, "strip-prose": 0 } })),
    );
    let factory = ScriptedFactory::new().slot(ROOT_AGENT, |b| {
        Box::new(MockClient::new(
            &b.model_id,
            vec![code_reply(FINISHING_PROGRAM)],
        ))
    });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::HarnessError
    );

    let events = sink.events();
    let refused = error_messages(&events).join("\n");
    assert!(
        refused.contains("healing.stripFences"),
        "a key that names nothing gg knows is named back: {refused}"
    );
    assert!(
        refused.contains("healing.strip-prose"),
        "and so is a known key whose value is not a toggle: {refused}"
    );
    // ...and the run did not start: the refusal is the terminal event.
    assert!(matches!(
        &events.last().expect("a terminal event").kind,
        GgTelemetryKind::SessionEnded { status } if status == "error"
    ));
}

// ---------------------------------------------------------------------------
// The assistant-message mode, end to end
// ---------------------------------------------------------------------------

/// The **last** `assistant`-role message in a recorded turn's request — the prior turn's reply, as
/// the transcript stored it.
///
/// The last rather than the first, and that is not incidental. A code agent's window opens with a
/// synthesized assistant turn of gg's own: the [bootstrap](crate::bootstrap) program that lists
/// every module the run granted this agent and opens the documentation of the two calls discovery is
/// made of. It sits ahead of every reply the model has
/// actually sent, so reading the first assistant message here would read gg's program and never the
/// model's.
fn assistant_message(request: &[Message]) -> String {
    request
        .iter()
        .rev()
        .find(|message| message.role == crate::model::Role::Assistant)
        .and_then(|message| message.content.clone())
        .expect("the turn's request carries the prior assistant turn")
}

/// **Post-response healing records the healed program as the assistant turn.**
///
/// Under `assistantMessages: "response-healing"` the message the model re-reads next turn is the
/// program gg actually ran — the fence and the prose either side of it gone — not the malformed reply
/// it sent. (The reply is still healed and still disclosed in the feedback under either mode; the mode
/// governs only what the transcript stores.)
#[tokio::test]
async fn response_healing_mode_records_the_healed_program() {
    let dir = TempDir::new().unwrap();
    std::fs::create_dir_all(dir.path().join("src")).unwrap();
    let (_, _, requests) = drive_recorded_code_run(
        &dir,
        healing_set(json!({ "assistantMessages": "response-healing" })),
        vec![code_reply(FENCED_PROGRAM), code_reply(FINISHING_PROGRAM)],
    )
    .await;

    // The second turn's request carries the first turn's assistant message — the healed program.
    let assistant = assistant_message(&requests[1]);
    assert!(
        !assistant.contains("```"),
        "the fence is gone:\n{assistant}"
    );
    assert!(
        !assistant.contains("I see the issue"),
        "the prose either side is gone:\n{assistant}"
    );
    assert!(
        assistant.trim_start().starts_with("const srcFiles"),
        "the healed program stands on its own:\n{assistant}"
    );
}

/// **No post-processing records the reply verbatim, fence and prose and all.**
///
/// The mirror of the above, and the arm a study of a model's code-only compliance reads. It is asked
/// for explicitly, because the default is the healed program.
#[tokio::test]
async fn no_post_processing_records_the_raw_reply() {
    let dir = TempDir::new().unwrap();
    std::fs::create_dir_all(dir.path().join("src")).unwrap();
    let (_, _, requests) = drive_recorded_code_run(
        &dir,
        healing_set(json!({ "assistantMessages": "none" })),
        vec![code_reply(FENCED_PROGRAM), code_reply(FINISHING_PROGRAM)],
    )
    .await;

    let assistant = assistant_message(&requests[1]);
    assert!(
        assistant.contains("```ts"),
        "the reply is stored as sent, fence and all:\n{assistant}"
    );
    assert!(
        assistant.contains("I see the issue"),
        "including its prose:\n{assistant}"
    );
}

/// **A code run heads every user message it synthesizes.**
///
/// The task the model works on and the output of its program each arrive under their heading — the
/// vocabulary the system prompt names — so a plain-text transcript reads as structured turns rather
/// than an undifferentiated wall.
#[tokio::test]
async fn a_code_run_heads_the_task_and_gg_s_reply() {
    let dir = TempDir::new().unwrap();
    let (_, _, requests) = drive_recorded_code_run(
        &dir,
        healing_set(json!({})),
        vec![code_reply("1;"), code_reply(FINISHING_PROGRAM)],
    )
    .await;

    let contents: Vec<&str> = requests[1]
        .iter()
        .filter_map(|message| message.content.as_deref())
        .collect();
    assert!(
        contents.iter().any(|c| c.starts_with("Task\n----\n")),
        "the task is headed:\n{contents:#?}"
    );
    // A program that ran and put nothing in the window earns the one notice a *successful* program
    // can, headed `Notice` — and not `Output`, which heads the tool-calling path's tool results and
    // so is a heading no code run's reply may wear.
    assert!(
        contents.iter().any(|c| c.starts_with("Notice\n----\n")),
        "gg's message back is headed:\n{contents:#?}"
    );
    assert!(
        !contents.iter().any(|c| c.starts_with("Output\n----\n")),
        "a code run's reply is never headed `Output`:\n{contents:#?}"
    );
}
