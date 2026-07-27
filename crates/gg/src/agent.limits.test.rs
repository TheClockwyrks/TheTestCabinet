//! The [execution ceilings](crate::limits) driven through the **live loop**.
//!
//! `limits.test.rs` proves the arithmetic — when a counter breaches, what a declaration resolves to,
//! how the window slides — with no loop, no model and no clock behind it. Nothing there can prove
//! the thing this design actually exists for: that a breached ceiling **stops a session** rather
//! than being recorded beside one that carried on regardless. Those two are indistinguishable from
//! telemetry alone, because both emit the breach. The evidence is how many times the model was
//! asked for a turn, which is what [`MockClient::turns_taken`] is for.
//!
//! # Why these are cheap
//!
//! A ceiling needs error turns to count, and in the tool-calling mode the only error a turn can have
//! is a model-API failure, which is separately fatal on its first occurrence. So the error ceilings
//! are driven under responses-as-code with **prose** replies: a reply that is not a program never
//! reaches the sandbox at all — no component, no store, no fuel — so these are ordinary loop tests
//! despite exercising the code-shaped protocol. The ones that need the whole session (for its
//! `SessionSummary` and its process outcome) go through [`run_with_factory`] and pay the
//! session-start sandbox warm-up; every other one calls [`Agent::drive`] directly and pays nothing.

use super::*;
use crate::limits::DEFAULT_MAX_TURNS;

/// A reply that is not a program — the shape a model sends when it narrates a finished task instead
/// of ending the run, and therefore an error turn under this protocol.
const PROSE: &str = "The scaffold is already complete; nothing left to do.";

/// A [`CodeSetup`] with responses-as-code on and every healing strategy armed — a real run's
/// default, so a prose reply is classified here exactly as it would be in production.
fn code_on() -> CodeSetup {
    CodeSetup {
        enabled: true,
        limits: SandboxLimits::default(),
        healing: HealingConfig::default(),
    }
}

/// A [`LimitsSetup`] over `declared`, resolved through the real resolver so a test's declaration and
/// a run's declaration cannot come to mean different things.
fn setup_from(declared: GgRunLimits) -> LimitsSetup {
    let mut set = GgCapabilitySet::minimal("mock/primary");
    set.limits = declared;
    let mut warnings = Vec::new();
    let limits = resolve_run_limits(&set, &mut warnings);
    assert!(
        warnings.is_empty(),
        "this helper is for usable declarations; got {warnings:?}"
    );
    LimitsSetup {
        limits,
        deadline: limits.max_runtime.map(|budget| Instant::now() + budget),
        spend: Arc::new(RunSpend::default()),
    }
}

/// How many turns the loop actually started.
fn turns_started(events: &[GgTelemetryEvent]) -> usize {
    events
        .iter()
        .filter(|e| matches!(e.kind, GgTelemetryKind::TurnStarted {}))
        .count()
}

/// A script of `n` prose replies — `n` error turns in a row.
fn prose_script(n: usize) -> Vec<ModelResponse> {
    std::iter::repeat_with(|| code_reply(PROSE))
        .take(n)
        .collect()
}

// ---------------------------------------------------------------------------
// The headline: a ceiling stops a live session
// ---------------------------------------------------------------------------

/// **A consecutive-error ceiling stops a live session rather than only recording it.**
///
/// This is the test the whole execution-limits design exists for. Ten prose replies are scripted;
/// under a ceiling of three the loop must ask for exactly three and then stop. Every other assertion
/// here is bookkeeping that would pass just as well if the loop had run all ten and reported a
/// breach at the end — [`MockClient::turns_taken`] is the one that cannot.
#[tokio::test]
async fn a_consecutive_error_ceiling_stops_a_live_session_rather_than_only_recording_it() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-limits".to_string()), Box::new(sink.clone()));
    let mut set = GgCapabilitySet::minimal("mock/primary");
    set.agents[0]
        .capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_RESPONSES_AS_CODE));
    set.limits = GgRunLimits {
        max_turns: Some(20),
        max_consecutive_errors: Some(3),
        ..GgRunLimits::default()
    };
    let inv = invocation(dir.path(), set);
    let client = Arc::new(MockClient::new("mock/primary", prose_script(10)));
    let shared = Arc::clone(&client);
    let factory = ScriptedFactory::new().slot(ROOT_AGENT, move |_| {
        Box::new(SharedMockClient(Arc::clone(&shared)))
    });

    let outcome = run_with_factory(&inv, &emitter, Arc::new(factory)).await;
    let events = sink.events();
    let breaches = limit_breaches(&events);

    // 1. the session ended on the ceiling.
    assert!(matches!(
        &events.last().expect("a terminal event").kind,
        GgTelemetryKind::SessionEnded { status } if status == "limit_exceeded"
    ));
    // 2. exactly three turns were started...
    assert_eq!(turns_started(&events), 3);
    // 3. ...and the model was asked for exactly three. This is the liveness proof: a loop that ran
    //    on and reported the breach afterwards would have asked for all ten.
    assert_eq!(client.turns_taken(), 3);
    // 4. one breach, naming the ceiling, its threshold, what was observed, and where.
    assert_eq!(breaches.len(), 1, "{breaches:?}");
    assert_eq!(breaches[0].limit, GgLimitKind::ConsecutiveErrors);
    assert_eq!(breaches[0].threshold, 3.0);
    assert_eq!(breaches[0].observed, 3.0);
    assert_eq!(breaches[0].turns, 3);
    assert_eq!(breaches[0].agent_id, ROOT_AGENT_ID);
    assert!(breaches[0].window.is_none(), "not a rate ceiling");
    // 5. the same breach is on the run's summary, beside the ceilings that were in force.
    let summary = session_summary(&events).expect("a session summary");
    assert_eq!(summary.terminal_status, "limit_exceeded");
    assert_eq!(summary.limit_hit.as_ref(), Some(&breaches[0]));
    assert_eq!(summary.limits.max_consecutive_errors, Some(3));
    assert_eq!(summary.limits.max_turns, Some(20));
    // 6. a spent ceiling is the operator's bound, not a harness failure: the process exits 0.
    assert_eq!(outcome, SessionOutcome::Ran);
}

/// **An unlimited run burns its turn ceiling instead.**
///
/// The explicit proof that the three new ceilings are opt-in — the same all-error script, with no
/// `limits` declared at all, is asked for every turn it is allowed — and that the one ceiling with a
/// default is *recorded* rather than hidden, which is what makes that default honest.
#[tokio::test]
async fn an_unlimited_run_burns_its_turn_ceiling_instead() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());
    let client = MockClient::new("mock/primary", prose_script(DEFAULT_MAX_TURNS + 5));

    let end = drive_root(
        &client,
        dir.path(),
        &registry,
        &emitter,
        // The resolved default: fifty turns, and nothing else armed.
        setup_from(GgRunLimits::default()),
        code_on(),
    )
    .await;

    assert_eq!(end.status, "exhausted");
    assert_eq!(end.turns, DEFAULT_MAX_TURNS);
    assert_eq!(
        client.turns_taken(),
        DEFAULT_MAX_TURNS,
        "an unbounded model is asked for every turn it is allowed"
    );
    let breach = end.limit.expect("the turn ceiling records a breach too");
    assert_eq!(breach.limit, GgLimitKind::Turns);
    assert_eq!(breach.threshold, DEFAULT_MAX_TURNS as f64);
    // And a run bounded by the default reports the default, so "what ceiling was this run under?"
    // is answerable rather than inferred.
    assert_eq!(
        recorded_limits(&setup_from(GgRunLimits::default()).limits).max_turns,
        Some(DEFAULT_MAX_TURNS as u64)
    );
}

/// **An error-rate ceiling stops a run that is mostly failing**, and cannot fire before its window
/// is full.
///
/// The window is both the lookback and the minimum sample, which is what makes a run provably unable
/// to die on its first bad turn: with a window of four, the earliest possible stop is turn four.
#[tokio::test]
async fn an_error_rate_ceiling_stops_a_run_that_is_mostly_failing() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());
    let client = MockClient::new("mock/primary", prose_script(8));

    let end = drive_root(
        &client,
        dir.path(),
        &registry,
        &emitter,
        setup_from(GgRunLimits {
            max_turns: Some(12),
            max_error_rate: Some(0.5),
            error_rate_window: Some(4),
            ..GgRunLimits::default()
        }),
        code_on(),
    )
    .await;

    assert_eq!(end.status, "limit_exceeded");
    assert_eq!(
        end.turns, 4,
        "the ceiling cannot fire before its window is full"
    );
    assert_eq!(client.turns_taken(), 4, "and the loop really stopped there");
    let breach = end.limit.expect("a breach");
    assert_eq!(breach.limit, GgLimitKind::ErrorRate);
    assert_eq!(breach.threshold, 0.5);
    assert_eq!(breach.observed, 1.0);
    assert_eq!(breach.window, Some(4));
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

/// A tool-calling turn that asks for one harmless tool call and costs `dollars`.
fn priced_turn(dollars: f64) -> ModelResponse {
    ModelResponse {
        text: Some("working".to_string()),
        tool_calls: vec![ToolCall {
            id: "call_list".to_string(),
            name: "list_dir".to_string(),
            arguments: json!({ "path": "." }),
        }],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: Some(Cost {
            comparable: Some(dollars),
            actual: Some(dollars),
        }),
    }
}

/// **A cost ceiling stops the run at the next turn boundary**, never mid-turn.
///
/// The turn that crosses the line completes in full — gg has already paid for that response, and
/// discarding it would waste the money *and* abandon work the model asked for — so the run's final
/// cost exceeds the ceiling, and the breach records the spend already accumulated rather than the
/// threshold. That is the whole content of the decision, and it is what this pins.
#[tokio::test]
async fn a_cost_ceiling_stops_the_run_at_the_next_turn_boundary() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());
    let client = MockClient::new("mock/primary", vec![priced_turn(1.0); 6]);

    let end = drive_root(
        &client,
        dir.path(),
        &registry,
        &emitter,
        setup_from(GgRunLimits {
            max_turns: Some(6),
            max_cost: Some(1.5),
            ..GgRunLimits::default()
        }),
        no_code(),
    )
    .await;

    assert_eq!(end.status, "limit_exceeded");
    assert_eq!(
        end.turns, 2,
        "the turn that crossed the line completed; the next one never started"
    );
    assert_eq!(client.turns_taken(), 2);
    let breach = end.limit.expect("a breach");
    assert_eq!(breach.limit, GgLimitKind::Cost);
    assert_eq!(breach.threshold, 1.5);
    assert_eq!(
        breach.observed, 2.0,
        "the observation is the spend already accumulated, which is over the ceiling"
    );
    assert_eq!(
        end.cost.and_then(|cost| cost.comparable),
        Some(2.0),
        "and the run's recorded cost says the same"
    );
}

/// **A cost ceiling is shared across every agent**, and read at each agent's own turn boundary.
///
/// Three agents share one [`RunSpend`] and a ceiling of $1.50. The first spends $1 and finishes
/// under the ceiling. The second is stopped after **one** turn — which is the proof of sharing,
/// because $1 of its own would not have breached anything. The third never calls the model at all:
/// the ceiling is checked at a boundary, before any work is started.
///
/// A per-agent cost ceiling would be trivially defeated by delegating, which is why this one is not.
#[tokio::test]
async fn a_cost_ceiling_is_shared_across_every_agent() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());
    let shared = setup_from(GgRunLimits {
        max_turns: Some(4),
        max_cost: Some(1.5),
        ..GgRunLimits::default()
    });

    // The first agent spends $1 and finishes of its own accord, comfortably under the ceiling.
    let first = drive_root(
        &MockClient::new(
            "mock/primary",
            vec![priced_turn(1.0), code_reply("that is everything")],
        ),
        dir.path(),
        &registry,
        &emitter,
        shared.clone(),
        no_code(),
    )
    .await;
    assert_eq!(first.status, "completed");
    assert_eq!(first.turns, 2);
    assert!(first.limit.is_none(), "$1 is under a $1.50 ceiling");

    // The second spends $1 of its own — and is stopped, because the *run* has now spent $2.
    let second_client = MockClient::new("mock/primary", vec![priced_turn(1.0); 3]);
    let second = drive_root(
        &second_client,
        dir.path(),
        &registry,
        &emitter,
        shared.clone(),
        no_code(),
    )
    .await;
    assert_eq!(second.status, "limit_exceeded");
    assert_eq!(
        second.turns, 1,
        "one turn of its own was enough, because it inherited the first agent's spend"
    );
    assert_eq!(second_client.turns_taken(), 1);
    assert_eq!(second.limit.expect("a breach").observed, 2.0);

    // The third reads the run's spend at its very first boundary and never calls the model.
    let third_client = MockClient::new("mock/primary", vec![priced_turn(1.0)]);
    let third = drive_root(
        &third_client,
        dir.path(),
        &registry,
        &emitter,
        shared,
        no_code(),
    )
    .await;
    assert_eq!(third.status, "limit_exceeded");
    assert_eq!(third.turns, 0);
    assert_eq!(
        third_client.turns_taken(),
        0,
        "the third agent never asked the model for a turn"
    );
    assert_eq!(third.limit.expect("a breach").observed, 2.0);
}

/// An unpriced run can never be cost-limited: gg will not invent a figure to stop a run with.
#[tokio::test]
async fn an_unpriced_run_is_never_stopped_by_a_cost_ceiling() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());
    let mut unpriced = priced_turn(1.0);
    unpriced.cost = None;
    let client = MockClient::new("mock/primary", vec![unpriced; 3]);

    let end = drive_root(
        &client,
        dir.path(),
        &registry,
        &emitter,
        setup_from(GgRunLimits {
            max_turns: Some(3),
            max_cost: Some(0.000_001),
            ..GgRunLimits::default()
        }),
        no_code(),
    )
    .await;

    assert_eq!(end.status, "exhausted");
    assert_eq!(end.turns, 3);
    assert_eq!(end.limit.expect("a breach").limit, GgLimitKind::Turns);
}

// ---------------------------------------------------------------------------
// The two ceilings that predate the vocabulary
// ---------------------------------------------------------------------------

/// **The turn ceiling and the deadline now record a breach too**, without changing the status either
/// has always ended under.
///
/// Which ceiling stopped a run becomes one question with one answer — the breach — rather than one
/// answer per terminal status; and `exhausted`/`timed_out` keep their own statuses, because
/// re-labelling them would rewrite the meaning of every historical run.
#[tokio::test]
async fn the_turn_ceiling_and_the_deadline_now_record_a_breach_too() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());

    let exhausted = drive_root(
        &MockClient::new("mock/primary", vec![priced_turn(0.0); 4]),
        dir.path(),
        &registry,
        &emitter,
        setup_from(GgRunLimits {
            max_turns: Some(2),
            ..GgRunLimits::default()
        }),
        no_code(),
    )
    .await;
    assert_eq!(exhausted.status, "exhausted");
    let breach = exhausted.limit.expect("a breach");
    assert_eq!(breach.limit, GgLimitKind::Turns);
    assert_eq!(breach.threshold, 2.0);
    assert_eq!(breach.turns, 2);

    // A deadline already in the past stops the loop before its first turn, exactly as it always has.
    let mut passed = setup_from(GgRunLimits {
        max_turns: Some(5),
        max_runtime_secs: Some(30),
        ..GgRunLimits::default()
    });
    passed.deadline = Some(Instant::now());
    let timed_out = drive_root(
        &MockClient::with_default_script("mock/primary"),
        dir.path(),
        &registry,
        &emitter,
        passed,
        no_code(),
    )
    .await;
    assert_eq!(timed_out.status, "timed_out");
    assert_eq!(timed_out.turns, 0);
    let breach = timed_out.limit.expect("a breach");
    assert_eq!(breach.limit, GgLimitKind::Runtime);
    assert_eq!(breach.threshold, 30.0);
    assert!(
        breach.observed >= 30.0,
        "the observation is the elapsed wall clock, not the budget: {}",
        breach.observed
    );
}

// ---------------------------------------------------------------------------
// What a ceiling does not do
// ---------------------------------------------------------------------------

/// **A model API error is still fatal on the first occurrence.**
///
/// It is named in the turn-error taxonomy so the definition stays whole, not because a ceiling ever
/// gets to observe two of them: the client has already retried with backoff over every retryable
/// class, the fatal kinds recur identically, and a rejected credential must stay the process's one
/// non-zero exit. Pinned so a later reader does not "fix" it by accident.
#[tokio::test]
async fn a_model_api_error_is_still_fatal_on_the_first_occurrence() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());

    let end = drive_root(
        &FailingClient {
            mode: FailureMode::Fatal,
        },
        dir.path(),
        &registry,
        &emitter,
        setup_from(GgRunLimits {
            max_turns: Some(10),
            max_consecutive_errors: Some(5),
            ..GgRunLimits::default()
        }),
        no_code(),
    )
    .await;

    assert_eq!(
        end.status, "model_error",
        "a failed model call ends the session on its own terms, not on a ceiling"
    );
    assert_eq!(end.turns, 1, "the failed turn is still counted");
    assert!(
        end.limit.is_none(),
        "and no ceiling is credited with stopping it"
    );
    assert!(limit_breaches(&sink.events()).is_empty());
}

/// **A host fault ends the session without charging the model.**
///
/// The [`Fatal`](TurnOutcome::Fatal) arm is the one place gg's own failures are kept off the model's
/// error budget, and it is the arm a regression is silent in — its whole job is to *not* count
/// something. So it is driven end to end: the sandbox reports a failure of gg's plumbing, and the
/// loop must end the session on gg's terms, credit no ceiling with it, and leave a ceiling armed at
/// **one** error unbreached, because a defect in the harness is not a failed turn by the model.
///
/// A fault this shape cannot be provoked honestly — the committed component compiles, the engine
/// config is a constant, and the blocking task only fails to join if the host panicked — so it is
/// armed through the [seam](crate::sandbox::force_next_program_fault) that exists for exactly this.
#[tokio::test]
async fn a_host_fault_ends_the_session_without_charging_the_model() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());

    crate::sandbox::force_next_program_fault(SandboxError::Host(
        "the code sandbox task did not complete: task panicked".to_string(),
    ));

    let end = drive_root(
        &MockClient::new(
            "mock/primary",
            vec![code_reply("fs.writeFile(\"a.txt\", \"hi\");"); 3],
        ),
        dir.path(),
        &registry,
        &emitter,
        setup_from(GgRunLimits {
            max_turns: Some(10),
            // Armed at the tightest setting there is: one error turn would stop the run. A fatal
            // fault must not be that error turn.
            max_consecutive_errors: Some(1),
            ..GgRunLimits::default()
        }),
        code_on(),
    )
    .await;

    assert_eq!(
        end.status, "model_error",
        "a fault in gg's own machinery ends the session loudly rather than burning the run"
    );
    assert_eq!(end.turns, 1, "the turn is still counted");
    assert!(
        end.limit.is_none(),
        "no ceiling may be credited with stopping a run gg's own defect stopped"
    );
    let events = sink.events();
    assert!(
        limit_breaches(&events).is_empty(),
        "the error budget was charged for gg's own failure"
    );
    // The operator is told which fault it was, in gg's own words rather than the model's.
    let errors: Vec<String> = events
        .iter()
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::Log { level, message } if level == "error" => Some(message.clone()),
            _ => None,
        })
        .collect();
    assert!(
        errors
            .iter()
            .any(|message| message.contains("gg's own plumbing")),
        "the fault was not named on the operator's stream: {errors:?}"
    );
    // And the turn's own event reports the failure rather than a program that ran.
    let executions: Vec<bool> = events
        .iter()
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::CodeExecution { ok, .. } => Some(*ok),
            _ => None,
        })
        .collect();
    assert_eq!(executions, vec![false], "{executions:?}");
    assert!(
        end.final_text
            .as_deref()
            .is_some_and(|text| !text.is_empty()),
        "a stopped agent still returns something to its spawner"
    );
}

/// **A limit-stopped run keeps everything it built.** gg rolls nothing back: the workspace is
/// exactly as the last completed turn left it, which is what makes a stopped run scoreable at all.
#[tokio::test]
async fn a_limit_stopped_run_keeps_everything_it_built() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());
    let write = ModelResponse {
        text: Some("writing".to_string()),
        tool_calls: vec![ToolCall {
            id: "call_write".to_string(),
            name: "write_file".to_string(),
            arguments: json!({ "path": "kept.txt", "contents": "built\n" }),
        }],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: Some(Cost {
            comparable: Some(1.0),
            actual: Some(1.0),
        }),
    };
    let client = MockClient::new(
        "mock/primary",
        vec![write, priced_turn(1.0), priced_turn(1.0)],
    );

    let end = drive_root(
        &client,
        dir.path(),
        &registry,
        &emitter,
        setup_from(GgRunLimits {
            max_turns: Some(6),
            max_cost: Some(0.5),
            ..GgRunLimits::default()
        }),
        no_code(),
    )
    .await;

    assert_eq!(end.status, "limit_exceeded");
    assert_eq!(
        std::fs::read_to_string(dir.path().join("kept.txt")).unwrap(),
        "built\n",
        "the work the run did before the ceiling stopped it is still there"
    );
}

/// **Every turn records exactly one outcome**, for a run ending each of the five ways.
///
/// The accounting can never drift from the number of model calls the run made — which is what makes
/// a breach's `turns` figure meaningful, and what stops a ceiling from being off by one against the
/// loop it bounds. The observable form of the invariant: the loop's own turn count equals the number
/// of turns it started, and a breach is stamped with the same number.
#[tokio::test]
async fn every_turn_records_exactly_one_outcome() {
    let dir = TempDir::new().unwrap();
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());

    let arms: Vec<(&str, Box<dyn ModelClient>, LimitsSetup, CodeSetup)> = vec![
        (
            "completed",
            Box::new(MockClient::new(
                "mock/primary",
                vec![priced_turn(0.0), code_reply("all done")],
            )),
            setup_from(GgRunLimits {
                max_turns: Some(5),
                ..GgRunLimits::default()
            }),
            no_code(),
        ),
        (
            "exhausted",
            Box::new(MockClient::new("mock/primary", vec![priced_turn(0.0); 5])),
            setup_from(GgRunLimits {
                max_turns: Some(3),
                ..GgRunLimits::default()
            }),
            no_code(),
        ),
        (
            "model_error",
            Box::new(FailingClient {
                mode: FailureMode::Fatal,
            }),
            setup_from(GgRunLimits {
                max_turns: Some(5),
                ..GgRunLimits::default()
            }),
            no_code(),
        ),
        (
            "limit_exceeded",
            Box::new(MockClient::new("mock/primary", prose_script(6))),
            setup_from(GgRunLimits {
                max_turns: Some(9),
                max_consecutive_errors: Some(2),
                ..GgRunLimits::default()
            }),
            code_on(),
        ),
    ];

    for (label, client, limits, code) in arms {
        let sink = CollectingSink::new();
        let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
        let end = drive_root(
            client.as_ref(),
            dir.path(),
            &registry,
            &emitter,
            limits,
            code,
        )
        .await;
        assert_eq!(end.status, label);
        assert_eq!(
            turns_started(&sink.events()),
            end.turns,
            "{label}: the loop's turn count and the turns it started disagree"
        );
        if let Some(breach) = end.limit {
            assert_eq!(
                breach.turns as usize, end.turns,
                "{label}: the breach is stamped with a different turn count"
            );
        }
    }

    // The fifth way: a deadline already spent, which ends the loop before it starts a turn.
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let mut passed = setup_from(GgRunLimits {
        max_turns: Some(5),
        max_runtime_secs: Some(1),
        ..GgRunLimits::default()
    });
    passed.deadline = Some(Instant::now());
    let end = drive_root(
        &MockClient::with_default_script("mock/primary"),
        dir.path(),
        &registry,
        &emitter,
        passed,
        no_code(),
    )
    .await;
    assert_eq!(end.status, "timed_out");
    assert_eq!(turns_started(&sink.events()), end.turns);
    assert_eq!(end.limit.expect("a breach").turns as usize, end.turns);
}

// ---------------------------------------------------------------------------
// Scope: a subagent's ceiling is its own
// ---------------------------------------------------------------------------

/// **A subagent's error ceiling ends that subagent, not the run** — and its isolated worktree is
/// discarded unmerged, exactly as an exhausted or timed-out one is.
///
/// "Consecutive" and "the last N turns" are only definable within one agent's turn sequence, so the
/// error ceilings are per agent; it is also substantively right, because a speculation fans out K
/// attempts precisely so that some may fail. A stopped child hands back its status line, the run
/// carries on, and the run's own outcome is the parent's.
#[tokio::test]
async fn a_subagents_error_ceiling_ends_it_alone_and_discards_its_worktree() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-sub-limits".to_string()), Box::new(sink.clone()));
    let mut set = subagent_set(2, 3, &["subagent"]);
    set.agents[0]
        .capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_WORKTREES));
    // Both the parent and the child run programs, so responses-as-code is on for every profile.
    for agent in &mut set.agents {
        agent
            .capabilities
            .push(GgCapabilityConfig::enabled(CAPABILITY_RESPONSES_AS_CODE));
    }
    set.limits = GgRunLimits {
        max_turns: Some(6),
        max_consecutive_errors: Some(2),
        ..GgRunLimits::default()
    };
    let inv = invocation(dir.path(), set);
    let factory = ScriptedFactory::new()
        .slot(ROOT_AGENT, |b| {
            Box::new(MockClient::new(
                &b.model_id,
                vec![
                    code_reply(
                        "const child = agents.spawnSubagent({ agent: \"subagent\", prompt: \
                         \"Do the work.\", worktree: true });\nreturn agents.waitForSubagents([child.id]);",
                    ),
                    code_reply(FINISHING_PROGRAM),
                ],
            ))
        })
        .slot("subagent", |b| {
            Box::new(MockClient::new(
                &b.model_id,
                vec![
                    // The child's first turn does real work in its worktree...
                    code_reply("fs.writeFile(\"child-work.txt\", \"work\\n\");\nreturn 1;"),
                    // ...and then it stops being able to write a program at all.
                    code_reply(PROSE),
                    code_reply(PROSE),
                    code_reply(PROSE),
                ],
            ))
        });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran
    );

    let events = sink.events();
    // The run ended on the parent's own `finish`, not on the child's ceiling.
    assert!(matches!(
        &events.last().expect("a terminal event").kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
    // The child breached, on its own stream and nowhere else.
    let breaches = limit_breaches(&events);
    assert_eq!(breaches.len(), 1, "{breaches:?}");
    assert_eq!(breaches[0].limit, GgLimitKind::ConsecutiveErrors);
    assert_ne!(
        breaches[0].agent_id, ROOT_AGENT_ID,
        "the breach belongs to the subagent"
    );
    // ...and the run does not report a subagent's ceiling as its own outcome.
    let summary = session_summary(&events).expect("a session summary");
    assert_eq!(summary.terminal_status, "completed");
    assert!(summary.limit_hit.is_none());
    // A child cut off mid-task holds half-finished work, so its worktree is discarded unmerged.
    assert!(
        !dir.path().join("child-work.txt").exists(),
        "a limit-stopped subagent's worktree is discarded, exactly as an exhausted one is"
    );
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::WorktreeMerged { merged, .. } if !*merged
        )),
        "and the discard is reported"
    );
}

// ---------------------------------------------------------------------------
// Resolution diagnostics
// ---------------------------------------------------------------------------

/// **Unusable limit declarations warn on the root stream and launch anyway.**
///
/// A sweep's one shared configuration document has to stay interpretable by every arm, so a ceiling
/// that cannot bound anything is a loud no-op rather than a refused launch — the same terms an
/// unknown name in `disabled_tools` is read on. The stale capability params are the migration half:
/// a configuration stored before the ceilings had a home may still carry `maxTurns` where gg no
/// longer looks, and saying so is what turns a silent behaviour change into a loud one.
#[tokio::test]
async fn unusable_limit_declarations_warn_on_the_root_stream_and_launch_anyway() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-warn".to_string()), Box::new(sink.clone()));
    let mut set = GgCapabilitySet::minimal("mock/echo");
    set.agents[0].capabilities[0].params = json!({ "maxTurns": 8 });
    let mut code = GgCapabilityConfig::enabled(CAPABILITY_RESPONSES_AS_CODE);
    code.params = json!({ "healing": { "stripFences": false } });
    code.enabled = false;
    set.agents[0].capabilities.push(code);
    set.limits = GgRunLimits {
        max_consecutive_errors: Some(0),
        max_error_rate: Some(0.5),
        max_cost: Some(-1.0),
        ..GgRunLimits::default()
    };
    let inv = invocation(dir.path(), set);

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);

    let events = sink.events();
    let warned = warn_messages(&events).join("\n");
    for expected in [
        "maxConsecutiveErrors: 0",
        "maxErrorRate is set but errorRateWindow is not",
        "maxCost must be greater than zero",
        "which gg no longer reads",
    ] {
        assert!(
            warned.contains(expected),
            "no warning named `{expected}`:\n{warned}"
        );
    }
    // Nothing armed, so the run is bounded by the turn ceiling's default — and says so.
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::Log { level, message }
                if level == "info" && message.contains("no execution ceiling is armed")
        )),
        "the ceilings actually in force are named too"
    );
    let summary = session_summary(&events).expect("a session summary");
    assert_eq!(summary.limits.max_turns, Some(DEFAULT_MAX_TURNS as u64));
    assert!(summary.limits.max_consecutive_errors.is_none());
}
