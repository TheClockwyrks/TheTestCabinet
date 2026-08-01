//! Tests for the [execution ceilings](super): the resolution truth table, the turn-outcome
//! taxonomy, the two per-agent error ceilings, and the run-wide spend the cost ceiling is measured
//! against.
//!
//! Every case here is pure. There is no loop, no model, no wasm engine, no clock and no filesystem
//! behind any of them — [`AgentLimits`] is fed turn outcomes by hand and asked what it would stop,
//! which is exactly how a state machine that *decides* rather than *acts* should be pinned. The
//! liveness half — that the loop actually stops on the breach this module hands it, rather than
//! recording one and running on — lives in `agent.limits.test.rs`, where there is a loop to stop.

use serde_json::json;
use test_cabinet_core::gg::{GgAgentConfig, GgCapabilityConfig, GgCapabilitySet, GgRunLimits};

use super::*;

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/// The agent id every breach in this file is stamped with — short, so an assertion reads.
const AGENT: &str = "root";

/// Resolve `declared` on an otherwise ordinary capability set, returning the ceilings and every
/// warning the resolution produced.
fn resolve(declared: GgRunLimits) -> (RunLimits, Vec<String>) {
    let set = GgCapabilitySet {
        limits: declared,
        ..GgCapabilitySet::default()
    };
    let mut warnings = Vec::new();
    let limits = resolve_run_limits(&set, &mut warnings);
    (limits, warnings)
}

/// The ceilings `declared` resolves to, asserting it produced no warning at all.
fn resolve_cleanly(declared: GgRunLimits) -> RunLimits {
    let (limits, warnings) = resolve(declared);
    assert!(warnings.is_empty(), "unexpected warnings: {warnings:?}");
    limits
}

/// The single warning `declared` produced, asserting there was exactly one.
fn sole_warning(declared: GgRunLimits) -> String {
    let (_, mut warnings) = resolve(declared);
    assert_eq!(warnings.len(), 1, "expected one warning, got {warnings:?}");
    warnings.remove(0)
}

/// Ceilings with only the error-rate half configured, for the accounting tests.
fn rate_limits(max_rate: f64, window: usize) -> RunLimits {
    RunLimits {
        error_rate: Some(ErrorRateLimit { max_rate, window }),
        ..bare_limits()
    }
}

/// Ceilings with nothing armed at all — turns unbounded and every ceiling off. The baseline every
/// accounting test varies one field of, built directly (not through the resolver, which arms gg's
/// defaults) so a test isolates the one ceiling it is about.
fn bare_limits() -> RunLimits {
    RunLimits {
        max_turns: None,
        max_runtime: None,
        max_consecutive_errors: None,
        error_rate: None,
        max_cost: None,
        replay_max_bytes: None,
    }
}

/// One error turn, of the kind that carries no special meaning to any ceiling.
const ERROR: TurnOutcome = TurnOutcome::Error(TurnErrorKind::Transpile);

/// Feed `outcomes` in order, returning the breach each one produced.
fn record_all(limits: RunLimits, outcomes: &[TurnOutcome]) -> Vec<Option<GgLimitBreach>> {
    let mut accounting = AgentLimits::new(limits);
    outcomes
        .iter()
        .map(|outcome| accounting.record(*outcome, AGENT))
        .collect()
}

/// A cost reporting both figures.
fn cost(comparable: f64, actual: f64) -> Option<Cost> {
    Some(Cost {
        comparable: Some(comparable),
        actual: Some(actual),
    })
}

// ---------------------------------------------------------------------------------------------
// Resolution — the truth table, row by row
// ---------------------------------------------------------------------------------------------

#[test]
fn an_absent_limits_block_arms_the_error_defaults_and_leaves_turns_unbounded() {
    // The host caps the wall-clock, so an unset turn ceiling is unbounded; what gg arms by default
    // instead are the two error ceilings that end a run whose model has stopped making progress.
    let limits = resolve_cleanly(GgRunLimits::default());

    assert_eq!(limits.max_turns, None, "turns are unbounded by default");
    assert_eq!(limits.max_runtime, None);
    assert_eq!(
        limits.max_consecutive_errors,
        Some(DEFAULT_MAX_CONSECUTIVE_ERRORS)
    );
    assert_eq!(
        limits.error_rate,
        Some(ErrorRateLimit {
            max_rate: DEFAULT_MAX_ERROR_RATE,
            window: DEFAULT_ERROR_RATE_WINDOW,
        })
    );
    assert_eq!(limits.max_cost, None);
}

#[test]
fn every_declared_ceiling_resolves_when_it_is_usable() {
    let limits = resolve_cleanly(GgRunLimits {
        max_parallel: None,
        max_turns: Some(60),
        max_runtime_secs: Some(5400),
        max_consecutive_errors: Some(5),
        max_error_rate: Some(0.5),
        error_rate_window: Some(10),
        max_cost: Some(25.0),
        replay_max_bytes: Some(1_024),
    });

    assert_eq!(limits.max_turns, Some(60));
    assert_eq!(limits.max_runtime, Some(Duration::from_secs(5400)));
    assert_eq!(limits.max_consecutive_errors, Some(5));
    assert_eq!(
        limits.error_rate,
        Some(ErrorRateLimit {
            max_rate: 0.5,
            window: 10
        })
    );
    assert_eq!(limits.max_cost, Some(25.0));
}

#[test]
fn a_zero_turn_ceiling_is_unbounded() {
    // Zero is read as "not configured" rather than "no turns at all", and not-configured is now
    // unbounded — quietly, because it is not a new mistake to warn a study about.
    let limits = resolve_cleanly(GgRunLimits {
        max_turns: Some(0),
        ..GgRunLimits::default()
    });

    assert_eq!(limits.max_turns, None);
}

#[test]
fn a_zero_runtime_budget_is_no_budget() {
    let limits = resolve_cleanly(GgRunLimits {
        max_runtime_secs: Some(0),
        ..GgRunLimits::default()
    });

    assert_eq!(limits.max_runtime, None);
}

#[test]
fn a_zero_consecutive_error_ceiling_is_off_and_says_so() {
    let declared = GgRunLimits {
        max_consecutive_errors: Some(0),
        ..GgRunLimits::default()
    };

    let (limits, _) = resolve(declared);
    assert_eq!(limits.max_consecutive_errors, None);
    assert_eq!(
        sole_warning(declared),
        "maxConsecutiveErrors: 0 cannot bound anything (it would stop a run before its first \
         turn); the ceiling is off."
    );
}

#[test]
fn a_rate_without_a_window_is_off_and_says_so() {
    let declared = GgRunLimits {
        max_error_rate: Some(0.5),
        ..GgRunLimits::default()
    };

    let (limits, _) = resolve(declared);
    assert_eq!(limits.error_rate, None);
    assert_eq!(
        sole_warning(declared),
        "maxErrorRate is set but errorRateWindow is not; a rate needs a window to be measured \
         over, so the ceiling is off."
    );
}

#[test]
fn a_window_without_a_rate_is_off_and_says_so() {
    let declared = GgRunLimits {
        error_rate_window: Some(10),
        ..GgRunLimits::default()
    };

    let (limits, _) = resolve(declared);
    assert_eq!(limits.error_rate, None);
    assert_eq!(
        sole_warning(declared),
        "errorRateWindow is set but maxErrorRate is not; a window needs a rate to be judged \
         against, so the ceiling is off."
    );
}

#[test]
fn a_rate_outside_zero_to_one_is_off_and_says_so() {
    let declared = GgRunLimits {
        max_error_rate: Some(1.5),
        error_rate_window: Some(10),
        ..GgRunLimits::default()
    };

    let (limits, _) = resolve(declared);
    assert_eq!(limits.error_rate, None);
    assert_eq!(
        sole_warning(declared),
        "maxErrorRate must be a fraction between 0.0 and 1.0; 1.5 can never be exceeded, so the \
         ceiling is off."
    );
}

#[test]
fn a_rate_that_is_not_a_number_is_off_and_says_so() {
    // JSON has no NaN, but a `f64` field deserialised from a sweep's generated configuration can
    // still arrive as one through any producer that is not `serde_json` — and a NaN threshold is
    // never greater than anything, so the ceiling would silently never fire.
    for rate in [f64::NAN, f64::INFINITY, -1.0] {
        let declared = GgRunLimits {
            max_error_rate: Some(rate),
            error_rate_window: Some(10),
            ..GgRunLimits::default()
        };

        let (limits, warnings) = resolve(declared);
        assert_eq!(limits.error_rate, None, "{rate} should arm nothing");
        assert_eq!(warnings.len(), 1, "{rate}: {warnings:?}");
        assert!(
            warnings[0].starts_with("maxErrorRate must be a fraction between 0.0 and 1.0;"),
            "{rate}: {warnings:?}"
        );
    }
}

#[test]
fn a_zero_window_is_off_and_says_so() {
    let declared = GgRunLimits {
        max_error_rate: Some(0.5),
        error_rate_window: Some(0),
        ..GgRunLimits::default()
    };

    let (limits, _) = resolve(declared);
    assert_eq!(limits.error_rate, None);
    assert_eq!(
        sole_warning(declared),
        "errorRateWindow: 0 has no turns to measure; the ceiling is off."
    );
}

#[test]
fn a_window_not_smaller_than_the_turn_ceiling_is_armed_but_warned_about() {
    let declared = GgRunLimits {
        max_turns: Some(8),
        max_error_rate: Some(0.5),
        error_rate_window: Some(8),
        ..GgRunLimits::default()
    };

    let (limits, _) = resolve(declared);
    assert_eq!(
        limits.error_rate,
        Some(ErrorRateLimit {
            max_rate: 0.5,
            window: 8
        }),
        "the ceiling is armed — it can fire, on the last turn"
    );
    assert_eq!(
        sole_warning(declared),
        "errorRateWindow (8) is not smaller than the turn ceiling (8), so the error-rate ceiling \
         can only ever fire on the run's last turn."
    );
}

#[test]
fn a_non_positive_cost_ceiling_is_off_and_says_so() {
    for max_cost in [0.0, -1.0, f64::NAN] {
        let declared = GgRunLimits {
            max_cost: Some(max_cost),
            ..GgRunLimits::default()
        };

        let (limits, _) = resolve(declared);
        assert_eq!(limits.max_cost, None, "{max_cost} should arm nothing");
        assert_eq!(
            sole_warning(declared),
            "maxCost must be greater than zero; the ceiling is off."
        );
    }
}

#[test]
fn legacy_params_on_a_capability_are_warned_about() {
    // The migration hazard: `maxTurns` used to be read from any capability's params, and the
    // console round-trips undeclared params losslessly, so a stored configuration can still carry
    // one. Silently running unbounded when the operator meant to set a ceiling is the failure this
    // warning exists to prevent.
    let set = GgCapabilitySet {
        agents: vec![GgAgentConfig {
            capabilities: vec![
                GgCapabilityConfig {
                    params: json!({ "maxTurns": 8 }),
                    ..GgCapabilityConfig::enabled("shell")
                },
                GgCapabilityConfig {
                    params: json!({ "maxRuntimeSecs": 600, "dir": "skills" }),
                    ..GgCapabilityConfig::enabled("skills")
                },
            ],
            ..GgAgentConfig::root()
        }],
        ..GgCapabilitySet::default()
    };

    let mut warnings = Vec::new();
    let limits = resolve_run_limits(&set, &mut warnings);

    assert_eq!(
        limits.max_turns, None,
        "the stale param configures nothing, so the run is unbounded"
    );
    assert_eq!(limits.max_runtime, None);
    assert_eq!(
        warnings,
        vec![
            "capability `shell` carries a `maxTurns` param, which gg no longer reads; move it to \
             `capabilitySet.limits`."
                .to_string(),
            "capability `skills` carries a `maxRuntimeSecs` param, which gg no longer reads; move \
             it to `capabilitySet.limits`."
                .to_string(),
        ]
    );
}

#[test]
fn resolution_never_fails_a_launch() {
    // Every unusable declaration at once, on a set that also carries both legacy params. The run
    // still resolves to a launchable configuration — here one with nothing armed, bounded only by
    // the host's clock — because an ablation sweep shares one document across arms, and an arm that
    // cannot launch measures nothing at all. (Every ceiling was declared unusable, so even the
    // error defaults are suppressed: a half-declared rate is a mistake, not an unset field.)
    let set = GgCapabilitySet {
        agents: vec![GgAgentConfig {
            capabilities: vec![GgCapabilityConfig {
                params: json!({ "maxTurns": 8, "maxRuntimeSecs": 600 }),
                ..GgCapabilityConfig::enabled("shell")
            }],
            ..GgAgentConfig::root()
        }],
        limits: GgRunLimits {
            max_parallel: None,
            max_turns: Some(0),
            max_runtime_secs: Some(0),
            max_consecutive_errors: Some(0),
            max_error_rate: Some(-3.0),
            error_rate_window: Some(0),
            max_cost: Some(-1.0),
            replay_max_bytes: Some(0),
        },
        ..GgCapabilitySet::default()
    };

    let mut warnings = Vec::new();
    let limits = resolve_run_limits(&set, &mut warnings);

    assert_eq!(limits, bare_limits());
    assert_eq!(warnings.len(), 6, "{warnings:?}");
}

#[test]
fn the_armed_summary_names_every_ceiling_in_force() {
    let armed = resolve_cleanly(GgRunLimits {
        max_parallel: None,
        max_turns: Some(60),
        max_runtime_secs: Some(5400),
        max_consecutive_errors: Some(5),
        max_error_rate: Some(0.5),
        error_rate_window: Some(10),
        max_cost: Some(25.0),
        replay_max_bytes: None,
    });

    assert_eq!(
        armed.armed_summary(),
        "execution ceilings in force: 60 turns, 5400s of runtime, 5 consecutive errors, an error \
         rate above 0.5 over the last 10 turns, $25 of cost"
    );
    assert_eq!(
        bare_limits().armed_summary(),
        "no execution ceiling is armed; the run is bounded only by the host's clock",
        "an unbounded run says so rather than saying nothing"
    );
}

// ---------------------------------------------------------------------------------------------
// The taxonomy
// ---------------------------------------------------------------------------------------------

#[test]
fn only_error_outcomes_count_as_errors() {
    // Exhaustive over `TurnOutcome`: the match below fails to compile if a variant is added, which
    // is the point — a new outcome must be classified deliberately, not inherit an answer.
    let every_outcome = [
        TurnOutcome::Progressed,
        TurnOutcome::Finished,
        TurnOutcome::Error(TurnErrorKind::ModelApi),
        TurnOutcome::Error(TurnErrorKind::NotAProgram),
        TurnOutcome::Error(TurnErrorKind::Transpile),
        TurnOutcome::Error(TurnErrorKind::ProgramFault),
        TurnOutcome::Error(TurnErrorKind::SandboxLimit),
        TurnOutcome::Error(TurnErrorKind::MissingCompletion),
        TurnOutcome::Fatal(FatalFault::ArtifactDefect),
        TurnOutcome::Fatal(FatalFault::HostFault),
    ];

    for outcome in every_outcome {
        let expected = match outcome {
            TurnOutcome::Progressed | TurnOutcome::Finished | TurnOutcome::Fatal(_) => false,
            TurnOutcome::Error(kind) => match kind {
                TurnErrorKind::ModelApi
                | TurnErrorKind::NotAProgram
                | TurnErrorKind::Transpile
                | TurnErrorKind::ProgramFault
                | TurnErrorKind::SandboxLimit
                | TurnErrorKind::MissingCompletion => true,
            },
        };
        assert_eq!(outcome.is_error(), expected, "{outcome:?}");
    }
}

// ---------------------------------------------------------------------------------------------
// The consecutive-error ceiling
// ---------------------------------------------------------------------------------------------

#[test]
fn consecutive_errors_breach_at_exactly_the_configured_count() {
    let limits = RunLimits {
        max_consecutive_errors: Some(3),
        ..bare_limits()
    };

    let breaches = record_all(limits, &[ERROR, ERROR, ERROR]);

    assert!(breaches[0].is_none(), "one error is not three");
    assert!(breaches[1].is_none(), "two errors are not three");
    let breach = breaches[2].as_ref().expect("the third error breaches");
    assert_eq!(breach.limit, GgLimitKind::ConsecutiveErrors);
    assert_eq!(breach.threshold, 3.0);
    assert_eq!(breach.observed, 3.0);
    assert_eq!(breach.turns, 3, "the breaching turn ran, and is counted");
    assert_eq!(breach.agent_id, AGENT);
    assert_eq!(breach.window, None, "a window is the rate ceiling's field");
}

#[test]
fn any_turn_that_progressed_resets_the_consecutive_count() {
    let limits = RunLimits {
        max_consecutive_errors: Some(3),
        ..bare_limits()
    };

    // Two errors, a recovery, then two more errors: five error turns in a session that never once
    // failed three times running.
    let breaches = record_all(
        limits,
        &[ERROR, ERROR, TurnOutcome::Progressed, ERROR, ERROR],
    );

    assert!(
        breaches.iter().all(Option::is_none),
        "the recovery cleared the count: {breaches:?}"
    );
}

#[test]
fn every_error_kind_counts_towards_the_consecutive_ceiling() {
    // Including `SandboxLimit`, which the counter this replaces exempted: a program the sandbox
    // stopped did not carry out the work it declared, whatever calls it landed first. (`ModelApi`
    // is here for completeness of the kind list; the loop ends the session on its first occurrence,
    // so no run reaches a ceiling by accumulating them.)
    let limits = RunLimits {
        max_consecutive_errors: Some(5),
        ..bare_limits()
    };

    let breaches = record_all(
        limits,
        &[
            TurnOutcome::Error(TurnErrorKind::NotAProgram),
            TurnOutcome::Error(TurnErrorKind::Transpile),
            TurnOutcome::Error(TurnErrorKind::ProgramFault),
            TurnOutcome::Error(TurnErrorKind::SandboxLimit),
            TurnOutcome::Error(TurnErrorKind::ModelApi),
        ],
    );

    assert!(breaches[..4].iter().all(Option::is_none));
    assert_eq!(
        breaches[4].as_ref().map(|breach| breach.observed),
        Some(5.0),
        "five different ways of failing are still five failures"
    );
}

#[test]
fn an_unconfigured_consecutive_ceiling_never_breaches() {
    // The machinery in isolation: an `AgentLimits` with no consecutive ceiling records any number
    // of errors without ever breaching. (The resolver arms a default, but the accounting itself
    // must honour "off means off" when handed a bare ceiling set.)
    let breaches = record_all(bare_limits(), &[ERROR; 200]);

    assert!(breaches.iter().all(Option::is_none));
}

#[test]
fn a_finished_turn_never_breaches_a_ceiling() {
    // A session that ends on purpose has not failed, however the turns before it went. Three
    // errors then `finish`, under "no more than half of the last four": the finishing turn is the
    // one that fills the window, at 0.75, so a ceiling that did not exempt it would fire on it.
    let limits = RunLimits {
        max_consecutive_errors: Some(4),
        ..rate_limits(0.5, 4)
    };
    let mut accounting = AgentLimits::new(limits);
    for _ in 0..3 {
        assert!(accounting.record(ERROR, AGENT).is_none());
    }

    let breach = accounting.record(TurnOutcome::Finished, AGENT);

    assert!(breach.is_none(), "{breach:?}");
    assert_eq!(
        accounting.turns_recorded(),
        4,
        "the finishing turn is recorded, not skipped"
    );
}

#[test]
fn a_fatal_turn_never_breaches_a_ceiling() {
    // gg's own defect is never charged to the model's error budget — the same misattribution the
    // `auth_error` status exists to prevent. As above, the fatal turn is the one that fills a
    // window already holding an error, so only the exemption keeps it from breaching.
    let limits = RunLimits {
        max_consecutive_errors: Some(2),
        ..rate_limits(0.4, 2)
    };
    let mut accounting = AgentLimits::new(limits);
    assert!(accounting.record(ERROR, AGENT).is_none());

    let breach = accounting.record(TurnOutcome::Fatal(FatalFault::HostFault), AGENT);

    assert!(breach.is_none(), "{breach:?}");
    assert_eq!(
        accounting.turns_recorded(),
        2,
        "the fatal turn is recorded, not skipped"
    );
}

#[test]
fn every_recorded_outcome_counts_towards_the_turn_total() {
    let mut accounting = AgentLimits::new(bare_limits());
    for outcome in [
        TurnOutcome::Progressed,
        ERROR,
        TurnOutcome::Fatal(FatalFault::ArtifactDefect),
        TurnOutcome::Finished,
    ] {
        accounting.record(outcome, AGENT);
    }

    assert_eq!(accounting.turns_recorded(), 4);
}

// ---------------------------------------------------------------------------------------------
// The error-rate ceiling
// ---------------------------------------------------------------------------------------------

#[test]
fn the_rate_ceiling_cannot_fire_before_its_window_is_full() {
    // Nine errors out of nine, under "no more than half of the last ten": a rate of 1.0 that must
    // not fire, because the window is also the minimum sample.
    let breaches = record_all(rate_limits(0.5, 10), &[ERROR; 9]);

    assert!(breaches.iter().all(Option::is_none), "{breaches:?}");
}

#[test]
fn a_single_early_error_cannot_kill_a_run() {
    // The property the window-as-minimum-sample rule exists for: one bad turn at the very start of
    // a run is never fatal, even against the strictest legal rate.
    let breaches = record_all(rate_limits(0.0, 10), &[ERROR]);

    assert!(breaches[0].is_none());
}

/// The property stated exactly: the earliest turn this ceiling can stop a run on is turn `window`.
///
/// Pinned at both ends of the range because the general claim — "a run cannot be killed by its first
/// bad turn" — is only true *relative to the configured window*. At a window of one the declaration
/// says "stop on any error", and behaving as written there is correct: it is a legitimate thing to
/// ask for, and silently refusing to honour it would be the quieter defect.
#[test]
fn the_earliest_possible_stop_is_the_window_itself() {
    let at_one = record_all(rate_limits(0.5, 1), &[ERROR]);
    let breach = at_one[0]
        .as_ref()
        .expect("a window of one arms on the first turn, as declared");
    assert_eq!(breach.limit, GgLimitKind::ErrorRate);
    assert_eq!(breach.observed, 1.0);
    assert_eq!(breach.turns, 1);
    assert_eq!(breach.window, Some(1));

    // And a window of three cannot fire before turn three, however bad the first two are.
    let at_three = record_all(rate_limits(0.0, 3), &[ERROR, ERROR, ERROR]);
    assert!(at_three[0].is_none());
    assert!(at_three[1].is_none());
    assert_eq!(
        at_three[2]
            .as_ref()
            .expect("the window is full on turn three")
            .turns,
        3
    );
}

#[test]
fn the_rate_ceiling_breaches_only_strictly_above_the_threshold() {
    // "More than X%", exactly: at 0.5 over ten, five errors is not a breach and six is.
    let five_of_ten = [
        ERROR,
        TurnOutcome::Progressed,
        ERROR,
        TurnOutcome::Progressed,
        ERROR,
        TurnOutcome::Progressed,
        ERROR,
        TurnOutcome::Progressed,
        ERROR,
        TurnOutcome::Progressed,
    ];
    let breaches = record_all(rate_limits(0.5, 10), &five_of_ten);
    assert!(breaches.iter().all(Option::is_none), "{breaches:?}");

    let mut six_of_ten = five_of_ten;
    six_of_ten[9] = ERROR;
    let breaches = record_all(rate_limits(0.5, 10), &six_of_ten);
    let breach = breaches[9].as_ref().expect("six of ten is more than half");
    assert_eq!(breach.limit, GgLimitKind::ErrorRate);
    assert_eq!(breach.threshold, 0.5);
    assert_eq!(breach.observed, 0.6);
    assert_eq!(breach.turns, 10);
    assert_eq!(breach.agent_id, AGENT);
    assert_eq!(
        breach.window,
        Some(10),
        "the rate is only readable beside the window it was measured over"
    );
}

#[test]
fn a_zero_rate_breaches_on_any_error_once_the_window_is_full() {
    // `0.0` is a legal configuration meaning "any error at all, once there is enough history to
    // judge" — which is only distinguishable from "off" because it still waits for the window.
    let breaches = record_all(
        rate_limits(0.0, 3),
        &[
            TurnOutcome::Progressed,
            TurnOutcome::Progressed,
            TurnOutcome::Progressed,
            ERROR,
        ],
    );

    assert!(breaches[..3].iter().all(Option::is_none));
    assert_eq!(
        breaches[3].as_ref().map(|breach| breach.observed),
        Some(1.0 / 3.0)
    );
}

#[test]
fn the_window_slides_so_old_errors_stop_counting() {
    // Four errors, then four good turns, under "no more than half of the last four". The run
    // recovers: by the fourth good turn the window holds no error at all, and no turn along the way
    // breaches, because the errors leave the window as fast as they entered it.
    let limits = rate_limits(0.5, 4);
    let mut accounting = AgentLimits::new(limits);
    for _ in 0..3 {
        assert!(accounting.record(ERROR, AGENT).is_none());
    }

    // The fourth error fills the window at 100% and breaches; a run that ignored the breach would
    // then walk the window back down to zero, which is what the rest of this asserts.
    assert!(accounting.record(ERROR, AGENT).is_some());

    let mut observed = Vec::new();
    for _ in 0..4 {
        observed.push(
            accounting
                .record(TurnOutcome::Progressed, AGENT)
                .map(|breach| breach.observed),
        );
    }

    assert_eq!(
        observed,
        vec![Some(0.75), None, None, None],
        "0.75 still breaches; 0.5 is not strictly above 0.5, and the window empties from there"
    );
}

#[test]
fn a_progressed_turn_can_be_the_turn_that_fills_the_window() {
    // Three errors then a good turn, under "no more than half of the last four". The good turn is
    // what makes the window judgeable, and three in four is above half — so the ceiling must fire
    // on a turn that itself succeeded, rather than waiting for a fourth failure that may never
    // come.
    let breaches = record_all(
        rate_limits(0.5, 4),
        &[ERROR, ERROR, ERROR, TurnOutcome::Progressed],
    );

    assert!(breaches[..3].iter().all(Option::is_none));
    let breach = breaches[3].as_ref().expect("the window is full at 0.75");
    assert_eq!(breach.limit, GgLimitKind::ErrorRate);
    assert_eq!(breach.observed, 0.75);
}

#[test]
fn an_unconfigured_rate_ceiling_never_breaches() {
    let breaches = record_all(bare_limits(), &[ERROR; 100]);

    assert!(breaches.iter().all(Option::is_none));
}

#[test]
fn the_consecutive_ceiling_is_reported_when_a_turn_breaches_both() {
    // Both fire on the same turn; the breach recorded is the one describing the present rather than
    // a window that is mostly history.
    let limits = RunLimits {
        max_consecutive_errors: Some(2),
        ..rate_limits(0.5, 2)
    };

    let breaches = record_all(limits, &[ERROR, ERROR]);

    assert_eq!(
        breaches[1].as_ref().map(|breach| breach.limit),
        Some(GgLimitKind::ConsecutiveErrors)
    );
}

// ---------------------------------------------------------------------------------------------
// The run's shared spend, and the cost ceiling
// ---------------------------------------------------------------------------------------------

#[test]
fn run_spend_sums_costs_on_the_unreported_is_not_zero_terms() {
    let spend = RunSpend::default();
    assert_eq!(spend.charged(), None, "nothing reported yet is not $0");

    spend.add(None);
    assert_eq!(spend.charged(), None, "an unreported turn reports nothing");

    spend.add(cost(1.5, 2.0));
    spend.add(cost(0.25, 0.5));
    assert_eq!(spend.charged(), Some(1.75));

    spend.add(None);
    assert_eq!(
        spend.charged(),
        Some(1.75),
        "an unreported turn leaves the total alone rather than zeroing it"
    );

    // One side unreported on the delta: the reported side accumulates, the unreported one is
    // treated as zero for this addition only.
    spend.add(Some(Cost {
        comparable: None,
        actual: Some(1.0),
    }));
    assert_eq!(spend.charged(), Some(1.75));
}

#[test]
fn run_spend_prefers_the_comparable_figure() {
    let spend = RunSpend::default();
    spend.add(Some(Cost {
        comparable: Some(3.0),
        actual: Some(9.0),
    }));
    assert_eq!(
        spend.charged(),
        Some(3.0),
        "the comparable figure is the one the run record shows"
    );

    let fallback = RunSpend::default();
    fallback.add(Some(Cost {
        comparable: None,
        actual: Some(9.0),
    }));
    assert_eq!(
        fallback.charged(),
        Some(9.0),
        "a harness reporting only what it was charged is still measurable"
    );
}

#[test]
fn every_agents_turn_is_counted_once_in_the_shared_spend() {
    // The concurrency property a run-wide ceiling stands on: agents run on the scheduler and add
    // from several threads at once, and the total must be exact — a cost ceiling that double-counts
    // or drops a turn under contention is a broken ceiling.
    let spend = std::sync::Arc::new(RunSpend::default());
    let agents: Vec<_> = (0..8)
        .map(|_| {
            let spend = std::sync::Arc::clone(&spend);
            std::thread::spawn(move || {
                for _ in 0..500 {
                    spend.add(cost(0.001, 0.002));
                }
            })
        })
        .collect();
    for agent in agents {
        agent.join().expect("agent thread");
    }

    let charged = spend.charged().expect("every turn reported a cost");
    assert!(
        (charged - 4.0).abs() < 1e-9,
        "8 agents x 500 turns x $0.001 = $4.00, got {charged}"
    );
}

#[test]
fn an_unpriced_run_can_never_breach_a_cost_ceiling() {
    // gg does not invent a figure to stop a run with: a model whose prices could not be resolved
    // accumulates `None`, and `None` is not "zero, so far".
    let limits = RunLimits {
        max_cost: Some(0.01),
        ..bare_limits()
    };
    let spend = RunSpend::default();
    spend.add(None);
    spend.add(None);

    assert!(limits.check_cost(&spend, AGENT, 7).is_none());
}

#[test]
fn the_cost_check_fires_only_once_the_ceiling_is_already_crossed() {
    // The before/after decision, locked: the check is at the turn boundary, so the turn that
    // crosses the line has already completed and been paid for. `observed` is therefore the spend
    // that is already over, never the threshold.
    let limits = RunLimits {
        max_cost: Some(1.0),
        ..bare_limits()
    };
    let spend = RunSpend::default();

    spend.add(cost(0.9, 0.9));
    assert!(
        limits.check_cost(&spend, AGENT, 1).is_none(),
        "under the ceiling, the next turn starts"
    );

    spend.add(cost(0.2, 0.2));
    let breach = limits
        .check_cost(&spend, AGENT, 2)
        .expect("the ceiling is crossed");
    assert_eq!(breach.limit, GgLimitKind::Cost);
    assert_eq!(breach.threshold, 1.0);
    assert!(
        (breach.observed - 1.1).abs() < 1e-9,
        "observed is the accumulated spend, already over: {}",
        breach.observed
    );
    assert_eq!(breach.turns, 2);
    assert_eq!(breach.agent_id, AGENT);
    assert_eq!(breach.window, None);
}

#[test]
fn a_cost_exactly_at_the_ceiling_stops_the_next_turn() {
    // "At or above": a run that has spent precisely its budget has none left to start a turn with.
    let limits = RunLimits {
        max_cost: Some(1.0),
        ..bare_limits()
    };
    let spend = RunSpend::default();
    spend.add(cost(1.0, 1.0));

    assert!(limits.check_cost(&spend, AGENT, 1).is_some());
}

#[test]
fn an_unconfigured_cost_ceiling_never_breaches() {
    let spend = RunSpend::default();
    spend.add(cost(1_000.0, 1_000.0));

    assert!(bare_limits().check_cost(&spend, AGENT, 1).is_none());
}
