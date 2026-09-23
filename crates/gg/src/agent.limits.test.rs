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
use test_cabinet_core::gg::{
    AUTHORED_MAX_PARALLEL, GgLoopDetection, GgProgramLanguage, GgTurnErrorKind, GgTurnErrorType,
    GgTurnOutcome, SHELL_OUTPUT_MODES,
};

/// The consecutive-error ceiling the run below declares. gg arms none of its own, so a test about
/// stopping on one has to write it down exactly as an operator would.
const DECLARED_CONSECUTIVE_ERRORS: u64 = 5;

/// A reply that is not a program — the shape a model sends when it narrates a finished task instead
/// of ending the run, and therefore an error turn under this protocol.
const PROSE: &str = "The scaffold is already complete; nothing left to do.";

/// A [`CodeSetup`] with responses-as-code on — a real run's
/// default, so a prose reply is classified here exactly as it would be in production.
fn code_on() -> CodeSetup {
    CodeSetup {
        enabled: true,
        language: GgProgramLanguage::TypeScript,
        limits: SandboxLimits::AMPLE,
        doc_view_types: crate::docs::DocViewTypes::RETURN_AND_ERRORS,
    }
}

/// A [`LimitsSetup`] over `declared`, resolved through the real resolver so a test's declaration and
/// a run's declaration cannot come to mean different things.
fn setup_from(declared: GgRunLimits) -> LimitsSetup {
    let mut set = GgCapabilitySet::minimal("mock/primary");
    set.limits = declared;
    let mut report = crate::validate::LaunchReport::collecting();
    let mut warnings = Vec::new();
    let limits = resolve_run_limits(&set, &mut report, &mut warnings);
    let defects = report.into_defects();
    assert!(
        defects.is_empty(),
        "this helper is for ceilings gg can arm; got {defects:?}"
    );
    assert!(
        warnings.is_empty(),
        "this helper is for usable declarations; got {warnings:?}"
    );
    LimitsSetup {
        limits,
        deadline: limits.max_runtime.map(|budget| Instant::now() + budget),
        spend: Arc::new(RunSpend::default()),
        cancel: CancelWatch::disabled(),
        fault: FaultLatch::default(),
        ceiling: CeilingLatch::default(),
    }
}

/// How many turns the loop actually started.
fn turns_started(events: &[GgTelemetryEvent]) -> usize {
    events
        .iter()
        .filter(|e| matches!(e.kind, GgTelemetryKind::TurnStarted {}))
        .count()
}

/// Every [`TurnOutcome`](GgTelemetryKind::TurnOutcome) on the stream, in emission order, as the
/// tuple its assertions read: how the turn ended, why (on an error), the agent's streak after it,
/// its running turn count, and the replies loop detection discarded on the way.
///
/// The specific [type](GgTurnErrorType) is asserted separately by [`turn_error_types`] rather than
/// widened into this tuple: most of these assertions are about the *ceilings*, which act on the
/// base kind, and threading a sixth element through every one of them would bury the figure under
/// test.
fn turn_outcomes(
    events: &[GgTelemetryEvent],
) -> Vec<(GgTurnOutcome, Option<GgTurnErrorKind>, u64, u64, u64)> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::TurnOutcome {
                outcome,
                error,
                consecutive_errors,
                turns,
                loop_aborts,
                ..
            } => Some((*outcome, *error, *consecutive_errors, *turns, *loop_aborts)),
            _ => None,
        })
        .collect()
}

/// The generated output every turn on the stream threw away, as `(words, characters)`, in order.
///
/// Kept out of [`turn_outcomes`] rather than widened into it for the reason the error type is: the
/// assertions there are about ceilings, and two more elements in every one of them would bury the
/// figure under test.
fn discarded_output(events: &[GgTelemetryEvent]) -> Vec<(u64, u64)> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::TurnOutcome {
                loop_abort_words,
                loop_abort_chars,
                ..
            } => Some((*loop_abort_words, *loop_abort_chars)),
            _ => None,
        })
        .collect()
}

/// The specific error [type](GgTurnErrorType) of every errored turn on the stream, in order.
fn turn_error_types(events: &[GgTelemetryEvent]) -> Vec<GgTurnErrorType> {
    events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::TurnOutcome { error_type, .. } => *error_type,
            _ => None,
        })
        .collect()
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
    crate::tools::grant(&mut set.agents[0], CAPABILITY_RESPONSES_AS_CODE);
    set.limits = GgRunLimits {
        max_turns: Some(20),
        max_consecutive_errors: Some(3),
        ..GgRunLimits::authored()
    };
    let inv = invocation(dir.path(), set);
    let client = Arc::new(MockClient::new("mock/primary", prose_script(10)));
    let shared = Arc::clone(&client);
    let factory = ScriptedFactory::new().slot(ROOT_PROFILE_ID, move |_| {
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
    // 6. a spent ceiling is not a harness failure, and it is not a session that ran to a natural
    //    end either: it exits on the ceiling's own code, so the host records the run apart and
    //    never retries it.
    assert_eq!(outcome, SessionOutcome::LimitExceeded);
}

/// **A run with no turn ceiling stops on the error ceiling it declares, not by burning turns.**
///
/// With no `maxTurns`, turns are unbounded (the host caps the wall-clock), so what stops a model
/// replying prose every turn is the consecutive-error ceiling its document arms — and nothing else,
/// because gg arms no error ceiling nobody wrote. And the recorded ceilings say the turn ceiling was
/// unbounded, so "what ceiling was this run under?" is answerable rather than inferred.
#[tokio::test]
async fn a_run_with_no_turn_ceiling_stops_on_the_error_ceiling_it_declares() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());
    // More prose than the declared ceiling allows, to prove the loop stops itself rather than
    // merely running out of script.
    let client = MockClient::new(
        "mock/primary",
        prose_script(DECLARED_CONSECUTIVE_ERRORS as usize + 5),
    );
    let declared = GgRunLimits {
        max_consecutive_errors: Some(DECLARED_CONSECUTIVE_ERRORS),
        ..GgRunLimits::authored()
    };

    let end = drive_root(
        &client,
        dir.path(),
        &registry,
        &emitter,
        // Turns unbounded, one error ceiling armed — and nothing else, because nothing else is
        // written.
        setup_from(declared),
        code_on(),
    )
    .await;

    assert_eq!(end.status, "limit_exceeded");
    assert_eq!(end.turns, DECLARED_CONSECUTIVE_ERRORS as usize);
    assert_eq!(
        client.turns_taken(),
        DECLARED_CONSECUTIVE_ERRORS as usize,
        "the loop really stopped on the ceiling rather than draining its script"
    );
    let breach = end
        .limit
        .expect("the declared error ceiling records a breach");
    assert_eq!(breach.limit, GgLimitKind::ConsecutiveErrors);
    assert_eq!(
        breach.threshold, DECLARED_CONSECUTIVE_ERRORS as f64,
        "the recorded threshold is the one the document wrote"
    );
    // And a run left unbounded records the turn ceiling as absent — the setting, not a hidden fifty.
    assert_eq!(
        recorded_limits(&setup_from(declared).limits, AUTHORED_MAX_PARALLEL as usize).max_turns,
        None
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
            ..GgRunLimits::authored()
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
        provider: None,
        loop_aborts: LoopAborts::none(),
        usage_wire: None,
        usage_reconciled: false,
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
            ..GgRunLimits::authored()
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
        ..GgRunLimits::authored()
    });

    // The first agent spends $1 and finishes of its own accord, comfortably under the ceiling.
    let first = drive_root(
        &MockClient::new("mock/primary", vec![priced_turn(1.0), stop_response()]),
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
            ..GgRunLimits::authored()
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
            ..GgRunLimits::authored()
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
        ..GgRunLimits::authored()
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
// What a breached ceiling does to the process
// ---------------------------------------------------------------------------

/// **Every one of the five ceilings raises the run's ceiling latch.**
///
/// The latch is what the session epilogue turns into `SessionOutcome::LimitExceeded`, and therefore
/// into the exit code the host classifies the run by. A ceiling that stopped an agent without
/// raising it would leave the run exiting as one that ran to a natural end: collected, scored, and
/// retried against the very configuration that produced the stop.
///
/// All five are driven here rather than one, because "the one place any of the five ends an agent"
/// is a claim about all five. The whole-session half — that a raised latch really does become the
/// process's exit code — is pinned by
/// `a_consecutive_error_ceiling_stops_a_live_session_rather_than_only_recording_it` and by
/// `agent.sandbox.test.rs`'s turn-ceiling case, which go through `run` rather than `drive`.
#[tokio::test]
async fn every_one_of_the_five_ceilings_raises_the_runs_ceiling_latch() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());

    /// Drive one root to its ending under `setup`, and hand back the ceiling the run's latch ends
    /// up naming.
    async fn latched(
        client: &dyn ModelClient,
        dir: &Path,
        registry: &ToolRegistry,
        emitter: &Emitter,
        setup: LimitsSetup,
        code: CodeSetup,
    ) -> Option<GgLimitKind> {
        let latch = setup.ceiling.clone();
        drive_root(client, dir, registry, emitter, setup, code).await;
        latch.raised().map(|breach| breach.limit)
    }

    // The turn ceiling, whose status is the host's own `exhausted`.
    assert_eq!(
        latched(
            &MockClient::new("mock/primary", vec![priced_turn(0.0); 4]),
            dir.path(),
            &registry,
            &emitter,
            setup_from(GgRunLimits {
                max_turns: Some(2),
                ..GgRunLimits::authored()
            }),
            no_code(),
        )
        .await,
        Some(GgLimitKind::Turns),
    );

    // The wall-clock budget, whose status is the host's own `timed_out`. A deadline already behind
    // the loop stops it before its first turn, which is the ceiling's behaviour with no clock to
    // wait on.
    let mut passed = setup_from(GgRunLimits {
        max_turns: Some(5),
        max_runtime_secs: Some(30),
        ..GgRunLimits::authored()
    });
    passed.deadline = Some(Instant::now());
    assert_eq!(
        latched(
            &MockClient::with_default_script("mock/primary"),
            dir.path(),
            &registry,
            &emitter,
            passed,
            no_code(),
        )
        .await,
        Some(GgLimitKind::Runtime),
    );

    // The consecutive-error ceiling.
    assert_eq!(
        latched(
            &MockClient::new("mock/primary", prose_script(6)),
            dir.path(),
            &registry,
            &emitter,
            setup_from(GgRunLimits {
                max_turns: Some(12),
                max_consecutive_errors: Some(2),
                ..GgRunLimits::authored()
            }),
            code_on(),
        )
        .await,
        Some(GgLimitKind::ConsecutiveErrors),
    );

    // The error-rate ceiling.
    assert_eq!(
        latched(
            &MockClient::new("mock/primary", prose_script(8)),
            dir.path(),
            &registry,
            &emitter,
            setup_from(GgRunLimits {
                max_turns: Some(12),
                max_error_rate: Some(0.5),
                error_rate_window: Some(4),
                ..GgRunLimits::authored()
            }),
            code_on(),
        )
        .await,
        Some(GgLimitKind::ErrorRate),
    );

    // The run-wide cost ceiling.
    assert_eq!(
        latched(
            &MockClient::new("mock/primary", vec![priced_turn(1.0); 6]),
            dir.path(),
            &registry,
            &emitter,
            setup_from(GgRunLimits {
                max_turns: Some(6),
                max_cost: Some(1.5),
                ..GgRunLimits::authored()
            }),
            no_code(),
        )
        .await,
        Some(GgLimitKind::Cost),
    );
}

/// **A run that stayed inside every ceiling it armed exits 0.**
///
/// The control for the case above, and the one that decides whether the new exit code is a
/// safeguard or a tax: ceilings are armed on nearly every real run, and a run that finished under
/// them is an ordinary result. The latch stays unraised, so the process exits `0` and the host
/// collects and scores the tree.
#[tokio::test]
async fn a_run_that_stayed_inside_its_ceilings_exits_zero() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-within".to_string()), Box::new(sink.clone()));
    let mut set = GgCapabilitySet::minimal("mock/primary");
    crate::tools::grant(&mut set.agents[0], CAPABILITY_RESPONSES_AS_CODE);
    // Every ceiling armed, all of them wide: the run is bounded and finishes anyway.
    set.limits = GgRunLimits {
        max_turns: Some(20),
        max_runtime_secs: Some(3_600),
        max_consecutive_errors: Some(5),
        max_error_rate: Some(0.5),
        error_rate_window: Some(10),
        max_cost: Some(100.0),
        ..GgRunLimits::authored()
    };
    let inv = invocation(dir.path(), set);
    let factory = ScriptedFactory::new().slot(ROOT_PROFILE_ID, |b| {
        Box::new(MockClient::new(
            &b.model_id,
            vec![code_reply(FINISHING_PROGRAM)],
        ))
    });

    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::Ran,
    );

    let events = sink.events();
    assert!(matches!(
        &events.last().expect("a terminal event").kind,
        GgTelemetryKind::SessionEnded { status } if status == "completed"
    ));
    assert!(
        limit_breaches(&events).is_empty(),
        "nothing was breached, so nothing may be recorded as breached"
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
            ..GgRunLimits::authored()
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
/// loop must end the session under gg's own status, credit no ceiling with it, and leave a ceiling
/// armed at **one** error unbreached, because a defect in the harness is not a failed turn by the
/// model. The status is the other half of the same rule the budget is: `agent.faults.test.rs`
/// holds it for both faults.
///
/// A fault this shape cannot be provoked honestly — the prebuilt component compiles, the engine
/// config is a constant, and the blocking task only fails to join if the host panicked — so it is
/// armed through the [seam](crate::sandbox::force_model_program_fault) that exists for exactly this.
#[tokio::test]
async fn a_host_fault_ends_the_session_without_charging_the_model() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());

    crate::sandbox::force_model_program_fault(SandboxError::Host(
        "the code sandbox task did not complete: task panicked".to_string(),
    ));

    let end = drive_root(
        &MockClient::new(
            "mock/primary",
            vec![
                code_reply("import * as gg from \"gg\";\ngg.files.writeFile(\"a.txt\", \"hi\");");
                3
            ],
        ),
        dir.path(),
        &registry,
        &emitter,
        setup_from(GgRunLimits {
            max_turns: Some(10),
            // Armed at the tightest setting there is: one error turn would stop the run. A fatal
            // fault must not be that error turn.
            max_consecutive_errors: Some(1),
            ..GgRunLimits::authored()
        }),
        code_on(),
    )
    .await;

    assert_eq!(
        end.status, "internal_error",
        "a fault in gg's own machinery ends the session loudly, under gg's own status"
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

/// **A compiler that could not finish ends the run and is charged to nobody.**
///
/// The reading of "a defect of gg's is gg's" that costs the most, so it is the one pinned end to
/// end. The compiler crashed rather than judging the program: the model answered, nothing read the
/// answer, and gg has no diagnostic to hand back and no honest instruction to give. The alternative
/// this replaces — feed a notice back, count the turn, carry on — asks a model to fix an image it
/// cannot see and lets a compiler missing from that image end a run under `limit_exceeded` with the
/// model's name on it.
///
/// So the run must lose exactly one turn, take no further turn even though a compiling program was
/// scripted next, credit no ceiling with the stop even under the tightest one there is, and end
/// under gg's own status with the fault on the latch.
///
/// Armed through the same [seam](crate::sandbox::force_model_program_fault) the host fault is: no
/// registered language runs a compiler yet, so there is no honest way to make one fall over.
#[tokio::test]
async fn a_compiler_that_could_not_finish_ends_the_run_and_is_charged_to_nobody() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());

    crate::sandbox::force_model_program_fault(SandboxError::Toolchain(
        "`swiftc` exited with signal 11 (SIGSEGV)".to_string(),
    ));

    let mut setup = setup_from(GgRunLimits {
        max_turns: Some(10),
        // The tightest setting there is: one error turn would stop the run and be recorded as the
        // reason it stopped. A compiler's crash must not be that error turn.
        max_consecutive_errors: Some(1),
        ..GgRunLimits::authored()
    });
    let fault = FaultLatch::default();
    setup.fault = fault.clone();

    let client = MockClient::new(
        "mock/primary",
        vec![
            code_reply("import * as gg from \"gg\";\ngg.files.writeFile(\"a.txt\", \"hi\");"),
            code_reply(FINISHING_PROGRAM),
        ],
    );
    let end = drive_root(&client, dir.path(), &registry, &emitter, setup, code_on()).await;

    assert_eq!(
        end.status, "internal_error",
        "the run's environment failed, so the run ends under gg's status rather than the model's"
    );
    assert_eq!(
        client.turns_taken(),
        1,
        "the model must not be asked to write the program again"
    );
    assert!(
        end.limit.is_none(),
        "no ceiling may be credited with stopping a run gg's own environment stopped"
    );
    let events = sink.events();
    assert!(
        limit_breaches(&events).is_empty(),
        "the model's error budget was charged for a compiler that never read its program"
    );
    assert_eq!(
        turn_outcomes(&events),
        vec![(GgTurnOutcome::Fatal, None, 0, 1, 0)],
        "the turn is counted so the accounting stays whole, and carries no error kind at all"
    );
    assert!(
        turn_error_types(&events).is_empty(),
        "a fatal turn carries no error type: {:?}",
        turn_error_types(&events)
    );
    assert!(
        fault
            .raised()
            .is_some_and(|raised| raised.contains("SIGSEGV")),
        "the latch must carry the compiler's own words: {:?}",
        fault.raised()
    );

    // The operator is told what actually happened, in the compiler's own terms — the detail the
    // model is deliberately not given.
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
            .any(|message| message.contains("compiler could not finish")
                && message.contains("SIGSEGV")),
        "the failure was not named on the operator's stream: {errors:?}"
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
        provider: None,
        loop_aborts: LoopAborts::none(),
        usage_wire: None,
        usage_reconciled: false,
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
            ..GgRunLimits::authored()
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
                vec![priced_turn(0.0), stop_response()],
            )),
            setup_from(GgRunLimits {
                max_turns: Some(5),
                ..GgRunLimits::authored()
            }),
            no_code(),
        ),
        (
            "exhausted",
            Box::new(MockClient::new("mock/primary", vec![priced_turn(0.0); 5])),
            setup_from(GgRunLimits {
                max_turns: Some(3),
                ..GgRunLimits::authored()
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
                ..GgRunLimits::authored()
            }),
            no_code(),
        ),
        (
            "limit_exceeded",
            Box::new(MockClient::new("mock/primary", prose_script(6))),
            setup_from(GgRunLimits {
                max_turns: Some(9),
                max_consecutive_errors: Some(2),
                ..GgRunLimits::authored()
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
        let events = sink.events();
        assert_eq!(
            turns_started(&events),
            end.turns,
            "{label}: the loop's turn count and the turns it started disagree"
        );
        // ...and the same invariant on the wire. Every recorded outcome is published, so the count
        // of `turn_outcome` events is the count of model calls the run made — the denominator the
        // run's error rollup is read against.
        let outcomes = turn_outcomes(&events);
        assert_eq!(
            outcomes.len(),
            end.turns,
            "{label}: a turn was recorded without being published"
        );
        assert_eq!(
            outcomes.iter().map(|outcome| outcome.3).collect::<Vec<_>>(),
            (1..=end.turns as u64).collect::<Vec<_>>(),
            "{label}: each event carries that agent's own running turn count"
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
        ..GgRunLimits::authored()
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

/// **A subagent's error ceiling ends that subagent, not the run.**
///
/// "Consecutive" and "the last N turns" are only definable within one agent's turn sequence, so the
/// error ceilings are per agent; it is also substantively right, because work is delegated to a
/// child precisely so that its failures are its own. A stopped child hands back its status line, the run
/// carries on, and the run's own outcome is the parent's.
#[tokio::test]
async fn a_subagents_error_ceiling_ends_it_alone() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-sub-limits".to_string()), Box::new(sink.clone()));
    let mut set = subagent_set(2, 3, &["subagent"]);
    // Both the parent and the child run programs, so responses-as-code is on for every profile.
    for agent in &mut set.agents {
        crate::tools::grant(agent, CAPABILITY_RESPONSES_AS_CODE);
    }
    set.limits = GgRunLimits {
        max_turns: Some(6),
        max_consecutive_errors: Some(2),
        ..GgRunLimits::authored()
    };
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
                    // The child's first turn does real work...
                    code_reply("import * as gg from \"gg\";\ngg.files.writeFile(\"child-work.txt\", \"work\\n\");\n1;"),
                    // ...and then it stops being able to write a program at all.
                    code_reply(PROSE),
                    code_reply(PROSE),
                    code_reply(PROSE),
                ],
            ))
        });

    // A ceiling breached by *any* agent is a fact about the run, so the process exits on the
    // ceiling's code even though the root finished on its own terms.
    assert_eq!(
        run_with_factory(&inv, &emitter, Arc::new(factory)).await,
        SessionOutcome::LimitExceeded
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
}

// ---------------------------------------------------------------------------
// Resolution diagnostics
// ---------------------------------------------------------------------------

/// **Unusable limit declarations refuse the launch, naming every one of them.**
///
/// A ceiling is the declaration whose failure mode is silence: an operator who wrote `maxCost`
/// believes the run is bounded, and a `maxCost` gg disarmed leaves a run that behaves exactly like
/// one nobody bounded — while spending money. So it is refused before the first turn, on the same
/// terms as a name no gg tool bears in an agent's own allowlist.
#[tokio::test]
async fn unusable_limit_declarations_refuse_the_launch_naming_every_one() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-warn".to_string()), Box::new(sink.clone()));
    let mut set = GgCapabilitySet::minimal("mock/echo");
    set.limits = GgRunLimits {
        max_consecutive_errors: Some(0),
        // A rate no run could exceed. (`0.5` alone would be perfectly usable: the missing window
        // half simply takes gg's default.)
        max_error_rate: Some(1.5),
        max_cost: Some(-1.0),
        ..GgRunLimits::authored()
    };
    let inv = invocation(dir.path(), set);

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::HarnessError);

    // Every one of the three is named, in one refusal, before the first turn: an operator fixing a
    // sweep's shared document must not have to launch three times to find three typos.
    let refused = error_messages(&sink.events()).join("\n");
    for expected in [
        "limits.maxConsecutiveErrors",
        "limits.maxErrorRate",
        "limits.maxCost",
    ] {
        assert!(
            refused.contains(expected),
            "no refusal named `{expected}`:\n{refused}"
        );
    }
    assert!(
        turns_started(&sink.events()) == 0,
        "the run is refused before it spends a token"
    );
}

/// **The ceilings that *are* in force are still named**, on a run that launches. The refusal is
/// about values gg cannot honour; a run that declared nothing usable is a different thing from a
/// run that declared nothing at all, and both say what they are bounded by.
#[tokio::test]
async fn a_run_that_arms_no_ceiling_says_so_and_launches() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-unbounded".to_string()), Box::new(sink.clone()));
    let mut set = GgCapabilitySet::minimal("mock/echo");
    // The two error ceilings gg arms by default, switched off the only way they can be: by naming
    // a ceiling gg *can* arm that is wide enough never to fire.
    set.limits = GgRunLimits {
        max_consecutive_errors: Some(1_000),
        ..GgRunLimits::authored()
    };
    let inv = invocation(dir.path(), set);

    assert_eq!(run(&inv, &emitter).await, SessionOutcome::Ran);

    let events = sink.events();
    assert!(
        events.iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::Log { level, message }
                if level == "info" && message.contains("execution ceilings in force")
        )),
        "the ceilings actually in force are named"
    );
    let summary = session_summary(&events).expect("a session summary");
    assert_eq!(
        summary.limits.max_turns, None,
        "an unset turn ceiling is recorded as unbounded"
    );
    assert_eq!(summary.limits.max_consecutive_errors, Some(1_000));
    assert_eq!(
        (
            summary.limits.max_model_retries,
            summary.limits.model_retry_max_delay_secs
        ),
        (Some(10), Some(60)),
        "the retry schedule is in force on every run, and an absent one is recorded as its defaults"
    );
}

/// **An unrecognized shell output mode warns on the root stream and launches anyway.**
///
/// **A mode gg does not recognize refuses the launch.** Reading it as the default would run the
/// *default* arm under another arm's name — a silent wrong-experiment failure — so the run stops
/// before the first turn, and the refusal names the mode as it was written.
#[tokio::test]
async fn an_unknown_shell_output_mode_is_refused() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-offload".to_string()), Box::new(sink.clone()));
    let mut set = GgCapabilitySet::minimal("mock/echo");
    let shell = set.agents[0]
        .capabilities
        .iter_mut()
        .find(|capability| capability.id == CAPABILITY_SHELL)
        .expect("the minimal set enables shell");
    shell.implementation = Some("offlaod".to_string());

    assert_eq!(
        run(&invocation(dir.path(), set), &emitter).await,
        SessionOutcome::HarnessError
    );

    let refused = error_messages(&sink.events()).join("\n");
    assert!(
        refused.contains("offlaod") && refused.contains("shell.implementation"),
        "the refusal names the unreadable mode and where it is written:\n{refused}"
    );
}

/// **An unbound compaction model slot refuses the launch.**
///
/// Binding the slots is the launcher's job, and a bound launch replaces the key with the model it
/// collected. A set that reaches gg still deferring one would compact on the agent's own model — a
/// different experiment from the one the configuration describes, and one whose only other trace is
/// the cost split — so gg does not start it, and says so before a token is spent.
#[tokio::test]
async fn an_unbound_compaction_model_slot_is_refused() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-compaction".to_string()), Box::new(sink.clone()));
    let mut set = GgCapabilitySet::minimal("mock/echo");
    crate::tools::grant_configured(
        &mut set.agents[0],
        GgCapabilityConfig {
            id: CAPABILITY_COMPACTION.to_string(),
            enabled: true,
            implementation: Some("handoff-summarization".to_string()),
            params: serde_json::json!({ "modelSlot": "summarizer" }),
        },
    );

    assert_eq!(
        run(&invocation(dir.path(), set), &emitter).await,
        SessionOutcome::HarnessError
    );

    let refused = sink
        .events()
        .iter()
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::Log { level, message } if level == "error" => Some(message.clone()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n");
    assert!(
        refused.contains("summarizer") && refused.contains("modelSlot"),
        "the refusal names the slot and the key it is written on:\n{refused}"
    );
}

/// **A recognized mode does not warn.** The check is a typo detector, not a nag: each of the three
/// modes — including the two an operator has to type — launches silently.
#[tokio::test]
async fn every_recognized_shell_output_mode_launches_without_a_warning() {
    for mode in SHELL_OUTPUT_MODES {
        let dir = TempDir::new().unwrap();
        let sink = CollectingSink::new();
        let emitter = Emitter::with_sink(Some("run-offload".to_string()), Box::new(sink.clone()));
        let mut set = GgCapabilitySet::minimal("mock/echo");
        let shell = set.agents[0]
            .capabilities
            .iter_mut()
            .find(|capability| capability.id == CAPABILITY_SHELL)
            .expect("the minimal set enables shell");
        shell.implementation = Some(mode.to_string());

        assert_eq!(
            run(&invocation(dir.path(), set), &emitter).await,
            SessionOutcome::Ran
        );

        let warned = warn_messages(&sink.events()).join("\n");
        assert!(
            !warned.contains("output mode"),
            "`{mode}` is a mode gg offers:\n{warned}"
        );
    }
}

// ---------------------------------------------------------------------------
// The turn-outcome event
// ---------------------------------------------------------------------------

/// **The seam that records a turn reads the run's fault latch before it judges the turn.**
///
/// The pair, on one ceiling, from the one place every turn of both execution modes passes through.
/// A failed call is an ordinary thing for a program to meet and an uncaught one is an ordinary way
/// for a turn to fail, so the first half must keep working: an error on a healthy run is the
/// model's, and it breaches. What changes is the second half. gg refuses calls of its own when gg
/// is broken, and the turn that refusal fails would otherwise be recorded as a `program_fault` the
/// model committed and could end the run under `limit_exceeded` with the model's name on it.
///
/// Read as a unit rather than driven through a session because the mutation this guards against is
/// the *removal* of a single read: the two halves differ in nothing but the latch.
#[test]
fn an_error_turn_is_the_models_until_gg_breaks_under_it() {
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let agent = Agent::root(ROOT_PROFILE_ID);
    // Armed at one error, so the difference between the two halves is a stopped run. The whole
    // setup — not its ceilings alone — because a turn is judged against the *run* it was taken in,
    // which is the value the loop hands the seam and the only thing that can answer for a latch.
    let healthy = setup_from(GgRunLimits {
        max_consecutive_errors: Some(1),
        ..GgRunLimits::authored()
    });
    let limits = healthy.limits;
    let failed_call = TurnOutcome::Error(TurnErrorType::ProgramApiError);

    let breach = agent.record_turn(
        &mut AgentLimits::new(limits),
        &emitter,
        &healthy,
        failed_call,
        LoopAborts::none(),
        ResponseSize::none(),
    );
    assert!(
        breach.is_some(),
        "a program that let a call throw on a healthy run failed its own turn"
    );

    // A second run, identical but for its latch — not a clone of the first, whose latch is shared
    // by construction and would retroactively break the healthy half beside it.
    let broken = setup_from(GgRunLimits {
        max_consecutive_errors: Some(1),
        ..GgRunLimits::authored()
    });
    broken
        .fault
        .in_agent("agent-3", "worker", "the profile would not bind");
    let breach = agent.record_turn(
        &mut AgentLimits::new(limits),
        &emitter,
        &broken,
        failed_call,
        LoopAborts::none(),
        ResponseSize::none(),
    );
    assert!(
        breach.is_none(),
        "no ceiling may be spent on a call gg refused because gg is broken"
    );

    assert_eq!(
        turn_outcomes(&sink.events())
            .into_iter()
            .map(|(outcome, kind, streak, _, _)| (outcome, kind, streak))
            .collect::<Vec<_>>(),
        vec![
            (GgTurnOutcome::Error, Some(GgTurnErrorKind::ProgramFault), 1),
            // Counted, so the denominator stays honest, and attributed to nobody's layer.
            (GgTurnOutcome::Fatal, None, 0),
        ],
        "the published record must not carry gg's defect as the model's program faulting"
    );
}

/// **An error turn says so on the stream, with the kind that made it one.**
///
/// The outcome the ceilings act on and the outcome a reader sees come from the one seam, so they
/// cannot disagree about what an error is. Driven with prose replies under responses-as-code — a
/// reply that is not a program never reaches the sandbox — and read straight off the stream: three
/// failures in a row, each publishing its own kind and its own place in the streak, and a recovery
/// that clears the streak on the very next event.
#[tokio::test]
async fn an_error_turn_publishes_its_kind_and_the_streak_it_is_part_of() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());

    let mut script = prose_script(3);
    // A program that runs and ends the session: the recovery, and the loop's exit.
    script.push(code_reply(FINISHING_PROGRAM));
    let end = drive_root(
        &MockClient::new("mock/primary", script),
        dir.path(),
        &registry,
        &emitter,
        setup_from(GgRunLimits {
            max_turns: Some(9),
            ..GgRunLimits::authored()
        }),
        code_on(),
    )
    .await;
    assert_eq!(end.status, "completed");

    assert_eq!(
        turn_outcomes(&sink.events()),
        vec![
            // A reply that is not a program does not type-strip: the turn declared work that never
            // ran, three times over, and the streak climbs with it.
            (
                GgTurnOutcome::Error,
                Some(GgTurnErrorKind::Transpile),
                1,
                1,
                0
            ),
            (
                GgTurnOutcome::Error,
                Some(GgTurnErrorKind::Transpile),
                2,
                2,
                0
            ),
            (
                GgTurnOutcome::Error,
                Some(GgTurnErrorKind::Transpile),
                3,
                3,
                0
            ),
            // `finish` ends the session: terminal, never an error, and it clears the streak the way
            // any turn that carried out its declared work does.
            (GgTurnOutcome::Finished, None, 0, 4, 0),
        ],
    );

    // ...and each of those three carries the **specific** reason under that base kind. On this arm
    // the compiler is the whole preparation, so what a model reads is one band: `tsc` read the reply
    // and rejected it, and prose is rejected exactly as a mistyped program is.
    assert_eq!(
        turn_error_types(&sink.events()),
        vec![
            GgTurnErrorType::TranspileCompile,
            GgTurnErrorType::TranspileCompile,
            GgTurnErrorType::TranspileCompile,
        ],
    );
}

/// **A turn that ended with no tool call now says so.**
///
/// Without this event a model that replied in prose turn after turn under an explicit-call
/// completion signal would produce a stream in which nothing had gone wrong, so it is pinned
/// directly: a text-only reply publishes an `error` turn of kind `missing_completion`.
#[tokio::test]
async fn a_turn_that_made_no_tool_call_publishes_a_missing_completion_error() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());

    let end = drive_root(
        &MockClient::new(
            "mock/primary",
            vec![text_only_response(), text_only_response(), stop_response()],
        ),
        dir.path(),
        &registry,
        &emitter,
        setup_from(GgRunLimits {
            max_turns: Some(9),
            ..GgRunLimits::authored()
        }),
        no_code(),
    )
    .await;
    assert_eq!(end.status, "completed");

    assert_eq!(
        turn_outcomes(&sink.events()),
        vec![
            (
                GgTurnOutcome::Error,
                Some(GgTurnErrorKind::MissingCompletion),
                1,
                1,
                0
            ),
            (
                GgTurnOutcome::Error,
                Some(GgTurnErrorKind::MissingCompletion),
                2,
                2,
                0
            ),
            (GgTurnOutcome::Finished, None, 0, 3, 0),
        ],
        "a tool-calling run publishes the same judgement a code-shaped one does"
    );
    // The two "no work declared" sites are structurally different failures — a prose reply where an
    // ending was the only way out, and a prose reply where a compaction was pending — and they used
    // to be one indistinguishable `missing_completion` bucket. This run is the first of the two.
    assert_eq!(
        turn_error_types(&sink.events()),
        vec![
            GgTurnErrorType::MissingCompletionNoCall,
            GgTurnErrorType::MissingCompletionNoCall,
        ],
    );
}

/// **A model call that failed is published like any other error turn**, and it is the one error
/// path that can carry discarded attempts.
///
/// A reply that looped on every attempt reaches the loop as an exhausted model call — the contract
/// has no separate base *kind* for it, deliberately — so it lands under `model_api`, and says which
/// `model_api` failure it was: `model_response_loop`, not `model_retry_exhausted`. What is *not*
/// lost is what it cost: the three replies the detector threw away ride on the same event, and the
/// operator log names the loop rather than blaming a provider outage that never happened — in the
/// recorded type's own words, so the two cannot describe one failure differently.
#[tokio::test]
async fn a_reply_that_looped_on_every_attempt_ends_the_run_on_its_own_message() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());

    let end = drive_root(
        &FailingClient {
            mode: FailureMode::Looping,
        },
        dir.path(),
        &registry,
        &emitter,
        setup_from(GgRunLimits {
            max_turns: Some(5),
            ..GgRunLimits::authored()
        }),
        no_code(),
    )
    .await;

    // Ends on the same terms retry exhaustion does — the model failed at its work, so the run is a
    // `model_error` rather than a host fault or a refused credential.
    assert_eq!(end.status, "model_error");
    assert_eq!(
        end.turns, 1,
        "the failed call is still a turn that happened"
    );

    let events = sink.events();
    assert_eq!(
        turn_outcomes(&events),
        vec![(
            GgTurnOutcome::Error,
            Some(GgTurnErrorKind::ModelApi),
            1,
            1,
            3
        )],
        "the discarded attempts are counted even though no reply survived"
    );
    assert_eq!(
        turn_error_types(&events),
        vec![GgTurnErrorType::ModelResponseLoop],
        "the distinction the log line names is recorded too"
    );

    let errors: Vec<String> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::Log { level, message } if level == "error" => Some(message.clone()),
            _ => None,
        })
        .collect();
    let logged = errors.join("\n");
    assert!(
        logged.contains(GgTurnErrorType::ModelResponseLoop.label()),
        "the log names what actually happened, in the recorded type's own words:\n{logged}"
    );
    assert!(
        !logged.contains("retries exhausted"),
        "...and does not send the operator looking for a provider outage:\n{logged}"
    );
}

/// **A turn that survived a loop reports what was thrown away** — how many replies, and how much
/// generation went with them.
///
/// Loop detection discarding two replies and the third one working is a *successful* turn — the
/// outcome is `progressed`, no ceiling counts it, and nothing about the run's error rate changes.
/// The generation is still gone and still billed, so the tally rides on the turn that eventually
/// produced a reply, and the operator log says so out loud in the units gg measured: words and
/// characters, never tokens and never dollars, because the provider reports usage at the end of a
/// stream neither abandoned reply ever reached.
#[tokio::test]
async fn a_turn_that_survived_a_loop_reports_the_replies_that_were_discarded() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone()));
    let registry = ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());

    // The first turn's reply arrived only after two attempts were abandoned; the second ended the
    // session on the first attempt, as an ordinary turn does.
    let mut looped = tool_call_response(
        "call_1",
        "write_file",
        json!({ "path": "notes.md", "contents": "hello" }),
    );
    looped.loop_aborts = LoopAborts {
        attempts: 2,
        words: 6_130,
        chars: 38_900,
    };
    let end = drive_root(
        &MockClient::new("mock/primary", vec![looped, stop_response()]),
        dir.path(),
        &registry,
        &emitter,
        setup_from(GgRunLimits::authored()),
        no_code(),
    )
    .await;
    assert_eq!(end.status, "completed");

    let events = sink.events();
    assert_eq!(
        turn_outcomes(&events),
        vec![
            (GgTurnOutcome::Progressed, None, 0, 1, 2),
            (GgTurnOutcome::Finished, None, 0, 2, 0),
        ],
        "a discarded attempt is not an error, and is not a turn of its own"
    );
    assert_eq!(
        discarded_output(&events),
        vec![(6_130, 38_900), (0, 0)],
        "the size of what was thrown away rides on the same turn the count does"
    );

    let warned = warn_messages(&events).join("\n");
    assert!(
        warned.contains("loop detection discarded 2 looping model responses"),
        "the discarded replies are named on the operator's stream:\n{warned}"
    );
    assert!(
        warned.contains("6130 words") && warned.contains("38900 characters"),
        "and so is how much generation they threw away:\n{warned}"
    );
}

/// **A discarded looping reply changes nothing about what the run cost.**
///
/// The ruling this whole measure exists under: a looping reply is a model defect, so its generation
/// must not be charged to the configuration under test. Two runs, identical in every respect except
/// that one of them threw two replies away, must therefore record the same tokens, the same cost,
/// and the same run-wide spend — the figure the cost ceiling is measured against.
///
/// That holds for a reason worth stating rather than merely observing: gg's cost and tokens come
/// from the provider's usage payload, which arrives at the *end* of a stream an abandoned reply
/// never reached. There is no figure to fold in even if gg wanted to, and inventing one would put an
/// estimate where every neighbouring number is a measurement.
#[tokio::test]
async fn a_discarded_looping_reply_costs_the_run_nothing_it_can_record() {
    async fn run(discarded: LoopAborts) -> (LoopEnd, Option<f64>) {
        let dir = TempDir::new().unwrap();
        let emitter = Emitter::with_sink(None, Box::new(CollectingSink::new()));
        let registry =
            ToolRegistry::from_capabilities(GgCapabilitySet::minimal("mock/primary").root());
        let mut priced = priced_turn(0.25);
        priced.usage = TokenCounts {
            uncached_input: Some(1_200),
            cached_input: None,
            output: Some(80),
            reasoning: None,
        };
        priced.loop_aborts = discarded;
        let setup = setup_from(GgRunLimits::authored());
        let spend = Arc::clone(&setup.spend);
        let end = drive_root(
            &MockClient::new("mock/primary", vec![priced, stop_response()]),
            dir.path(),
            &registry,
            &emitter,
            setup,
            no_code(),
        )
        .await;
        (end, spend.charged())
    }

    let (clean, clean_spend) = run(LoopAborts::none()).await;
    let (looped, looped_spend) = run(LoopAborts {
        attempts: 2,
        words: 6_130,
        chars: 38_900,
    })
    .await;

    assert_eq!(
        looped.cost, clean.cost,
        "the discarded replies are absent from the turn's recorded cost"
    );
    assert_eq!(
        looped.tokens, clean.tokens,
        "and from its token counts, which are the provider's figures for the reply it served"
    );
    assert_eq!(
        looped_spend, clean_spend,
        "and from the run-wide spend the cost ceiling is measured against"
    );
    assert_eq!(
        clean_spend,
        Some(0.25),
        "a run that recorded nothing at all would satisfy the three assertions above vacuously"
    );
}

/// **The run's error rollup is folded from the very stream it summarizes.**
///
/// The whole session, through the real emitter: the summary's `turns` is the number of
/// `turn_outcome` events the run emitted, its `errors` is the number of those that were errors, and
/// the two are read against each other rather than stored as a percentage that could disagree with
/// its own denominator.
#[tokio::test]
async fn the_session_summary_carries_the_error_rollup_its_stream_reported() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-errors".to_string()), Box::new(sink.clone()));

    // Two prose replies (each an error turn) and then a program that finishes, under a ceiling wide
    // enough that nothing stops the run — the rollup must be recorded for a run that *finished*,
    // which is exactly the run the old accounting could say nothing about.
    let mut script = prose_script(2);
    script.push(code_reply(FINISHING_PROGRAM));
    let set = code_set("mock/primary", json!({}));
    let end = run_with_factory(
        &invocation(dir.path(), set),
        &emitter,
        Arc::new(ScriptedFactory::new().slot(ROOT_PROFILE_ID, move |_| {
            Box::new(MockClient::new("mock/primary", script.clone()))
        })),
    )
    .await;
    assert_eq!(end, SessionOutcome::Ran);

    let events = sink.events();
    let summary = session_summary(&events).expect("a session summary");
    let outcomes = turn_outcomes(&events);

    assert_eq!(
        summary.errors.turns,
        outcomes.len() as u64,
        "the denominator is the number of turns the run published"
    );
    assert_eq!(summary.errors.turns, 3);
    assert_eq!(summary.errors.errors, 2);
    assert_eq!(
        summary.errors.transpile, 2,
        "a prose reply does not compile"
    );
    assert_eq!(
        summary.errors.max_consecutive, 2,
        "the peak streak the one agent reached"
    );
    assert_eq!(summary.errors.loop_aborts, 0, "nothing armed the detector");
    assert_eq!(
        summary.terminal_status, "completed",
        "a run that failed two thirds of its turns and finished anyway now says so"
    );
}

// ---------------------------------------------------------------------------
// Loop detection: configuration
// ---------------------------------------------------------------------------

/// **An armed detector names its configuration in the launch log**, beside the ceilings — the
/// same kind of fact, said the same way, before the first turn.
///
/// Arming it also switches that agent's transport to streaming, which is why the line is worth
/// having at all: a run that streams and a run that does not are otherwise indistinguishable from
/// the operator's log.
#[tokio::test]
async fn an_armed_loop_detector_names_its_configuration_at_launch() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-loopguard".to_string()), Box::new(sink.clone()));
    let mut set = GgCapabilitySet::minimal("mock/echo");
    // An armed detector states all five knobs; this case is about the one it varies.
    set.agents[0].loop_detection = GgLoopDetection {
        enabled: true,
        window_words: Some(256),
        repeat_threshold: Some(8),
        min_offenders: Some(2),
        min_saturated_run: Some(3_000),
        max_response_chars: Some(250_000),
    };

    assert_eq!(
        run(&invocation(dir.path(), set), &emitter).await,
        SessionOutcome::Ran
    );

    let events = sink.events();
    let infos: Vec<String> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::Log { level, message } if level == "info" => Some(message.clone()),
            _ => None,
        })
        .collect();
    let logged = infos.join("\n");
    assert!(
        logged.contains("loop detection: armed"),
        "the armed detector says so:\n{logged}"
    );
    assert!(
        logged.contains("more than 8 times"),
        "...and names the knobs actually in force, not the defaults:\n{logged}"
    );
}

/// **A disarmed detector says nothing at all.** The default, and the shape of nearly every run: a
/// declaration nothing will read has no configuration to name, and a line saying "off" in every
/// run's log is noise in the one place an operator looks to find out what was configured.
#[tokio::test]
async fn a_disarmed_loop_detector_is_silent() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-no-loopguard".to_string()), Box::new(sink.clone()));

    assert_eq!(
        run(
            &invocation(dir.path(), GgCapabilitySet::minimal("mock/echo")),
            &emitter
        )
        .await,
        SessionOutcome::Ran
    );

    assert!(
        !sink.events().iter().any(|e| matches!(
            &e.kind,
            GgTelemetryKind::Log { message, .. } if message.contains("loop detection")
        )),
        "a run that armed nothing mentions nothing"
    );
}

/// **An unusable loop-detection knob refuses the launch** — the same terms every other declaration
/// gg cannot act on is read on, and the refusal names the agent, because the lever is per agent and
/// a run with five profiles would otherwise say which knob but not whose.
#[tokio::test]
async fn an_unusable_loop_detection_knob_refuses_the_launch() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(
        Some("run-loopguard-warn".to_string()),
        Box::new(sink.clone()),
    );
    let mut set = GgCapabilitySet::minimal("mock/echo");
    // Given its own id, so the refusal has a profile to name that is not the default one.
    set.agents[0].slug = "builder".to_string();
    set.agents[0].loop_detection = GgLoopDetection {
        enabled: true,
        window_words: Some(0),
        ..GgLoopDetection::default()
    };

    assert_eq!(
        run(&invocation(dir.path(), set), &emitter).await,
        SessionOutcome::HarnessError
    );

    // The attribution is the point: a configuration with eight profiles gives an unattributed
    // message nowhere to land.
    let refused = error_messages(&sink.events()).join("\n");
    assert!(
        refused.contains("agent `builder`") && refused.contains("loopDetection.windowWords"),
        "the refusal names the agent and the knob:\n{refused}"
    );
}

/// **A knob is judged whether or not the detector is armed.** A disarmed declaration reads nothing,
/// but it is still configuration — it records the detector the off arm *would* have run — so a knob
/// gg could not arm refuses the launch now rather than on the one that flips the switch.
#[tokio::test]
async fn a_disarmed_loop_detections_knobs_are_judged_too() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(
        Some("run-loopguard-off".to_string()),
        Box::new(sink.clone()),
    );
    let mut set = GgCapabilitySet::minimal("mock/echo");
    set.agents[0].loop_detection = GgLoopDetection {
        enabled: false,
        window_words: Some(0),
        min_offenders: Some(0),
        ..GgLoopDetection::default()
    };

    assert_eq!(
        run(&invocation(dir.path(), set), &emitter).await,
        SessionOutcome::HarnessError
    );

    let refused = error_messages(&sink.events()).join("\n");
    assert!(
        refused.contains("loopDetection.windowWords")
            && refused.contains("loopDetection.minOffenders"),
        "both knobs are named:\n{refused}"
    );
}

/// **A disarmed declaration whose knobs gg can arm is silent**: it produces no refusal (nothing is
/// unhonourable) and no warning either (there is no detector for one to be about).
#[tokio::test]
async fn a_disarmed_loop_detection_with_usable_knobs_says_nothing() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(
        Some("run-loopguard-mute".to_string()),
        Box::new(sink.clone()),
    );
    let mut set = GgCapabilitySet::minimal("mock/echo");
    set.agents[0].loop_detection = GgLoopDetection {
        enabled: false,
        window_words: Some(64),
        min_offenders: Some(300),
        ..GgLoopDetection::default()
    };

    assert_eq!(
        run(&invocation(dir.path(), set), &emitter).await,
        SessionOutcome::Ran
    );

    let warned = warn_messages(&sink.events()).join("\n");
    assert!(
        !warned.contains("minOffenders"),
        "a run with no detector has no inert detector to report:\n{warned}"
    );
}

/// **An agent's declaration reaches the client through its binding**, exactly as its prompt-cache
/// lifetime does — which is what makes loop detection a per-agent (and therefore per-model) lever
/// rather than a run-wide switch.
#[test]
fn a_profiles_loop_detection_travels_on_its_binding() {
    let mut set = GgCapabilitySet::minimal("mock/primary");
    set.agents[0].loop_detection = GgLoopDetection {
        enabled: true,
        window_words: Some(64),
        ..GgLoopDetection::default()
    };
    set.agents.push(GgAgentConfig {
        slug: "quiet".to_string(),
        name: "Quiet".to_string(),
        model_id: "mock/secondary".to_string(),
        ..GgAgentConfig::root()
    });

    let watched = profile_binding(&set, set.root_id()).expect("the root binds");
    assert!(watched.loop_detection.is_armed());
    assert_eq!(watched.loop_detection.window_words, Some(64));

    let unwatched = profile_binding(&set, "quiet").expect("the second profile binds");
    assert!(
        !unwatched.loop_detection.is_armed(),
        "a profile that declared nothing is not watched because another one is"
    );
}

// ---------------------------------------------------------------------------
// The one grammar the five ceilings report in
// ---------------------------------------------------------------------------

/// **Every ceiling reports in one grammar, and the end-to-end sentence is pinned here.**
///
/// `core`'s `gg_exec` tests assert the sentence a benchmark reader sees — `run failed: gg execution
/// ceiling hit (5 consecutive turns failed)` — against a literal of their own, with nothing tying
/// that literal to the code that renders it. This is that tie: the consecutive-errors line below is
/// the exact string those tests quote, so a change to this grammar that would silently break the
/// end-to-end sentence fails here first, in the crate that owns the wording.
#[test]
fn the_five_ceilings_report_in_one_grammar() {
    let breach = |limit, threshold: f64, observed: f64, turns, window| GgLimitBreach {
        limit,
        threshold,
        observed,
        turns,
        agent_id: "root".to_string(),
        window,
    };

    // The turn and consecutive-error ceilings are counted in whole steps of one and checked at
    // `>=`, so the breaching observation always lands exactly on the threshold. Naming the limit
    // beside it would print the same characters twice, so the clause drops.
    assert_eq!(
        breach_message(&breach(GgLimitKind::Turns, 200.0, 200.0, 200, None)),
        "200 turns taken"
    );
    assert_eq!(
        breach_message(&breach(GgLimitKind::ConsecutiveErrors, 5.0, 5.0, 12, None)),
        "5 consecutive turns failed",
        "the figures `core`'s gg_exec tests quote in the run's failure detail"
    );

    // The other three are crossed by a margin nothing bounds, so each names the ceiling beside the
    // observation — in the ceiling's own unit, on both figures.
    assert_eq!(
        breach_message(&breach(GgLimitKind::Runtime, 3600.0, 3612.0, 12, None)),
        "3612s elapsed after 12 turns, ceiling 3600s"
    );
    assert_eq!(
        breach_message(&breach(GgLimitKind::ErrorRate, 0.5, 0.6, 10, Some(10))),
        "60% of the last 10 turns failed, ceiling 50%"
    );
    assert_eq!(
        breach_message(&breach(GgLimitKind::Cost, 5.0, 5.12, 30, None)),
        "$5.1200 spent, ceiling $5.0000"
    );

    // The elision is a property of the figures, not of the arm: a spend ceiling crossed by less
    // than a hundredth of a cent renders both figures identically, and drops the clause for the
    // same reason the counted ceilings always do.
    assert_eq!(
        breach_message(&breach(GgLimitKind::Cost, 5.0, 5.000_01, 30, None)),
        "$5.0000 spent"
    );
}
