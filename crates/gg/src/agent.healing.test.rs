//! The seam between [response healing](crate::healing) and the turn loop.
//!
//! Healing's own suite proves the algorithm — what each strategy matches, what it declines, that a
//! healed program is always a subsequence of the reply — over pure inputs with no loop behind it.
//! What it cannot prove is the wiring, and the wiring is where this subsystem's honesty lives: that
//! what gg repaired is **disclosed to the model** in the same turn, **counted on the turn's
//! telemetry**, and that a reply healing refused as not-a-program never reaches the sandbox at all.
//!
//! The round-1 captures are used verbatim here as well as in the healing suite, because the two
//! answer different questions about them: there, "what does the algorithm do with this?"; here,
//! "what does the model see, and what does the run record, when a real model sends it?".

use super::*;

/// The modal round-1 terminal reply: prose that healing calls a program (its `strip-prose` predicate
/// declines, because that strategy *deletes*), which then fails to type-strip, and which the loop
/// reclassifies as prose because not one of its lines is certainly code.
const TERMINAL_PROSE: &str = include_str!("testdata/round1-haiku-turn-04.txt");

/// A real single-block round-1 reply: prose, one `ts` block, prose. The positive case.
const FENCED_PROGRAM: &str = include_str!("testdata/round1-haiku-turn-03.txt");

/// A capability set with responses-as-code enabled and `params` on it.
fn healing_set(params: serde_json::Value) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal("mock/primary");
    let mut capability = GgCapabilityConfig::enabled(CAPABILITY_RESPONSES_AS_CODE);
    capability.params = params;
    set.agents[0].capabilities.push(capability);
    set
}

/// A [`CodeSetup`] with responses-as-code on and `healing` armed as given.
fn code_with(healing: HealingConfig) -> CodeSetup {
    CodeSetup {
        enabled: true,
        limits: SandboxLimits::default(),
        healing,
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

/// Every `CodeExecution`'s `(ok, fuel_used, error)`, in order.
fn executions(events: &[GgTelemetryEvent]) -> Vec<(bool, Option<u64>, Option<String>)> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::CodeExecution {
                ok,
                fuel_used,
                error,
                ..
            } => Some((*ok, *fuel_used, error.clone())),
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
            code_reply("return listDir(\"src\").length;"),
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
    assert!(records[0].not_a_program.is_none(), "and it then ran");
    assert!(
        records[1].is_clean() && records[2].is_clean(),
        "a reply that needed nothing carries the default, which the wire omits: {records:?}"
    );
}

/// **The healing note reaches the model, on every one of the four code feedback templates.**
///
/// What healing did happened to the model's *message*, not to its program, so it is equally true of
/// a turn that ran, one that failed to compile, one the sandbox stopped, and one that was not a
/// program at all. Repair without disclosure teaches the model nothing and corrupts the ablation —
/// the whole question this capability exists to answer is whether models learn the contract.
#[tokio::test]
async fn the_healing_note_reaches_the_turn_feedback() {
    // Three of the four, in one run: a program that ran, one that did not compile, and a reply that
    // was not a program — each wrapped in the fence healing strips.
    let dir = TempDir::new().unwrap();
    let (_, _, requests) = drive_recorded_code_run(
        &dir,
        healing_set(json!({})),
        vec![
            code_reply("```ts\nreturn 1;\n```"),
            code_reply("```ts\nconst x = ;\n```"),
            code_reply("```ts\n// nothing but a note to myself\n```"),
            code_reply(FINISHING_PROGRAM),
        ],
    )
    .await;

    // Each of the three turns after the first carries the note about the reply that preceded it.
    for (turn, messages) in requests.iter().enumerate().skip(1) {
        assert!(
            messages.iter().any(|message| message
                .content
                .as_deref()
                .is_some_and(|text| text.contains("gg repaired your reply before running it"))),
            "turn {turn} was not told what gg did to its previous reply"
        );
        assert!(
            messages.iter().any(|message| message
                .content
                .as_deref()
                .is_some_and(|text| text.contains("removed the Markdown code fence"))),
            "turn {turn} was not told *what* was repaired"
        );
    }

    // The fourth template: a program the sandbox stopped. Its own run, because it needs a fuel
    // ceiling low enough to trip and that ceiling would strand the ordinary programs above.
    let dir = TempDir::new().unwrap();
    let (_, _, requests) = drive_recorded_code_run(
        &dir,
        healing_set(json!({ "fuel": RUNAWAY_FUEL })),
        vec![
            code_reply("```ts\nlet x = 0;\nwhile (true) {\n  x += 1;\n}\nreturn x;\n```"),
            code_reply(FINISHING_PROGRAM),
        ],
    )
    .await;
    assert!(
        requests[1].iter().any(|message| message
            .content
            .as_deref()
            .is_some_and(|text| text.contains("gg repaired your reply before running it"))),
        "a turn the sandbox stopped is still told what was repaired in its reply"
    );
}

// ---------------------------------------------------------------------------
// A reply that was never a program
// ---------------------------------------------------------------------------

/// **A reply that is not a program never reaches the sandbox.**
///
/// No component, no store, no fuel — the verdict short-circuits before anything under `sandbox/` is
/// entered at all. The observable half is the fuel figure: it is **absent** rather than zero,
/// because a turn that ran nothing has no fuel reading to average into a run's efficiency, and a
/// fabricated zero would quietly halve one.
#[tokio::test]
async fn a_not_a_program_response_never_reaches_the_sandbox() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());
    let client = MockClient::new(
        "mock/primary",
        vec![
            // Comments only: it would type-strip cleanly into a program that does nothing, run to a
            // silent success, and leave the model believing it had done something.
            code_reply("// I will write the manifest next turn."),
            // Several candidate blocks: gg refuses to guess between them rather than running the
            // first and silently discarding the rest.
            code_reply("```ts\nreturn 1;\n```\n\nor perhaps\n\n```ts\nreturn 2;\n```"),
            // The same refusal in its other shape: two programs pasted together with no fence
            // anywhere, which is what a model sends once fences are gone from the contract.
            code_reply(
                "const files = listDir(\"src\");\nreturn files.length;\n\n\
                 const files = listDir(\".\");\nreturn files.map((e) => e.name);",
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
    assert_eq!(end.status, "exhausted", "neither reply ended the session");

    let events = sink.events();
    for (ok, fuel_used, error) in executions(&events) {
        assert!(!ok);
        assert!(
            fuel_used.is_none(),
            "nothing ran, so there is no fuel figure: {fuel_used:?}"
        );
        assert!(error.is_some());
    }
    let records = healing_records(&events);
    assert_eq!(records[0].not_a_program, Some(GgNotAProgram::CommentOnly));
    assert_eq!(records[0].candidate_shape, None, "nothing was counted");
    // How many programs the model sent in one turn is the signal itself, and how it presented them
    // is the other half of it: the same count and the same reason, from two different mistakes.
    assert_eq!(records[1].not_a_program, Some(GgNotAProgram::SeveralBlocks));
    assert_eq!(records[1].blocks, Some(2));
    assert_eq!(
        records[1].candidate_shape,
        Some(GgCandidateShape::Fenced),
        "a reply that fenced its programs is a model still formatting a reply it was told not to"
    );
    assert_eq!(records[2].not_a_program, Some(GgNotAProgram::SeveralBlocks));
    assert_eq!(records[2].blocks, Some(2));
    assert_eq!(
        records[2].candidate_shape,
        Some(GgCandidateShape::Bare),
        "a reply that pasted its programs together is a model sending two answers in one turn"
    );
}

/// **A transpile failure over a reply with no code in it is reported as prose, not as a syntax
/// error.**
///
/// This is the modal round-1 failure, driven end to end with the reply a real model actually sent.
/// It is the one place healing's question ("was this a program?") and the transpile's ("is this
/// program valid?") meet, and the route is forced by measurement: `strip-prose` has to be severe
/// because it deletes, so on real terminal replies it declines — and a model whose prose came back
/// as a syntax error would never be told the one thing it needs, which is that saying "task
/// complete" does not end the run.
#[tokio::test]
async fn a_transpile_failure_over_prose_is_reported_as_not_a_program() {
    let dir = TempDir::new().unwrap();
    let (_, events, requests) = drive_recorded_code_run(
        &dir,
        healing_set(json!({})),
        vec![code_reply(TERMINAL_PROSE), code_reply(FINISHING_PROGRAM)],
    )
    .await;

    let records = healing_records(&events);
    assert_eq!(
        records[0].not_a_program,
        Some(GgNotAProgram::Prose),
        "the reply is reported for what it was: {records:?}"
    );
    assert!(
        records[0].strategies.is_empty(),
        "no strategy touched it — it is a classification the loop made, not a repair"
    );
    let (ok, fuel_used, error) = executions(&events).remove(0);
    assert!(!ok);
    assert!(fuel_used.is_none(), "nothing ran");
    assert!(
        error
            .as_deref()
            .is_some_and(|error| error.contains("prose")),
        "and the operator's stream says so too: {error:?}"
    );
    // The feedback the model got is the one that fixes the failure: it names what a turn must look
    // like, and it names the only thing that ends the run.
    assert!(
        requests[1].iter().any(|message| message
            .content
            .as_deref()
            .is_some_and(|text| text.contains("Every turn of this run is a program")
                && text.contains("finish("))),
        "the model was told what to do instead"
    );
}

// ---------------------------------------------------------------------------
// The ablation lever
// ---------------------------------------------------------------------------

/// **Turning a strategy off changes only what healing returns.**
///
/// The ablation has to be honest to be worth running: with `strip-fences` disarmed the same fenced
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
        vec![code_reply("Here is the program:\n\n```ts\nreturn 1;\n```")],
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
    let (ok, fuel_used, error) = executions(&events).remove(0);
    assert!(!ok);
    assert_eq!(
        fuel_used,
        Some(0),
        "the reply reached the transpile — it just did not survive it"
    );
    assert!(error.is_some());
}

/// **An unreadable `healing` key is reported rather than guessed at.**
///
/// A typo in an ablation's configuration is the one failure this subsystem cannot survive:
/// `{"stripFences": false}` would otherwise run the default arm silently, under the disabled arm's
/// name, and every number the study produced would be a measurement of the wrong thing.
#[tokio::test]
async fn an_unreadable_healing_param_is_logged_at_warn() {
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
        SessionOutcome::Ran
    );

    let events = sink.events();
    let warned = warn_messages(&events).join("\n");
    assert!(
        warned.contains("healing.stripFences"),
        "a key that names nothing gg knows is named back: {warned}"
    );
    assert!(
        warned.contains("healing.strip-prose"),
        "and so is a known key whose value is not a toggle: {warned}"
    );
    // ...and the run launched anyway: a warning never fails a launch.
    assert!(matches!(
        &events.last().expect("a terminal event").kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
}
