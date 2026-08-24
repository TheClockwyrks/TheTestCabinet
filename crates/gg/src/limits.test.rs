//! Tests for the [execution ceilings](super): the resolution truth table, the turn-outcome
//! taxonomy, the two per-agent error ceilings, and the run-wide spend the cost ceiling is measured
//! against.
//!
//! Every case here is pure. There is no loop, no model, no wasm engine, no clock and no filesystem
//! behind any of them — [`AgentLimits`] is fed turn outcomes by hand and asked what it would stop,
//! which is exactly how a state machine that *decides* rather than *acts* should be pinned. The
//! liveness half — that the loop actually stops on the breach this module hands it, rather than
//! recording one and running on — lives in `agent.limits.test.rs`, where there is a loop to stop.

// `GgTurnOutcome` and `GgTurnErrorKind` arrive through the `super::*` glob below — the module under
// test imports them for its own wire mapping.
use test_cabinet_core::gg::{
    AUTHORED_REPLAY_MAX_BYTES, GgAgentConfig, GgCapabilityConfig, GgCapabilitySet, GgRunLimits,
};

use crate::validate::{LaunchDefect, LaunchReport};

use super::*;

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/// The agent id every breach in this file is stamped with — short, so an assertion reads.
const AGENT: &str = "root";

/// Resolve `declared` on an otherwise ordinary capability set, returning the ceilings, every value
/// gg refused, and every advisory warning it produced.
fn resolve(declared: GgRunLimits) -> (RunLimits, Vec<LaunchDefect>, Vec<String>) {
    let set = GgCapabilitySet {
        limits: declared,
        ..GgCapabilitySet::default()
    };
    let mut report = LaunchReport::collecting();
    let mut warnings = Vec::new();
    let limits = resolve_run_limits(&set, &mut report, &mut warnings);
    (limits, report.into_defects(), warnings)
}

/// The ceilings `declared` resolves to, asserting gg honoured every one of them exactly as written:
/// nothing refused, and nothing to advise about either.
fn resolve_cleanly(declared: GgRunLimits) -> RunLimits {
    let (limits, defects, warnings) = resolve(declared);
    assert!(defects.is_empty(), "unexpected refusals: {defects:?}");
    assert!(warnings.is_empty(), "unexpected warnings: {warnings:?}");
    limits
}

/// The single refusal `declared` earned, rendered as the operator reads it, asserting there was
/// exactly one.
fn sole_refusal(declared: GgRunLimits) -> String {
    let (_, mut defects, _) = resolve(declared);
    assert_eq!(defects.len(), 1, "expected one refusal, got {defects:?}");
    defects.remove(0).to_string()
}

/// The single advisory warning `declared` produced, asserting there was exactly one and that
/// nothing was refused — a warning is only ever about a value gg **honoured**.
fn sole_warning(declared: GgRunLimits) -> String {
    let (_, defects, mut warnings) = resolve(declared);
    assert!(defects.is_empty(), "unexpected refusals: {defects:?}");
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
/// accounting test varies one field of, built directly rather than through the resolver so a test
/// isolates the one ceiling it is about and owes nothing to the launch pass.
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

/// The smallest limits block a launch accepts — the two required run-level values and no ceiling
/// armed beyond them. Every resolution case varies one field of it, so each test is about the
/// ceiling it names rather than about the values every configuration owes whatever it measures.
fn required_only() -> GgRunLimits {
    GgRunLimits::authored()
}

/// One error turn, of the type that carries no special meaning to any ceiling.
const ERROR: TurnOutcome = TurnOutcome::Error(TurnErrorType::TranspileSyntax);

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

/// A set that writes no ceiling at all arms none of them — gg arms nothing nobody wrote — and is
/// refused for the one run-level value that has no "off": the journal ceiling capture runs under.
#[test]
fn an_absent_limits_block_arms_nothing_and_owes_the_journal_ceiling() {
    let (limits, defects, warnings) = resolve(GgRunLimits::default());

    assert_eq!(
        limits,
        bare_limits(),
        "every ceiling off, and the journal ceiling at its placeholder"
    );
    assert_eq!(limits.max_turns, None, "turns are unbounded");
    assert_eq!(limits.max_runtime, None);
    assert_eq!(
        limits.max_consecutive_errors, None,
        "gg arms no error ceiling nobody wrote"
    );
    assert_eq!(limits.error_rate, None);
    assert_eq!(limits.max_cost, None);
    assert!(warnings.is_empty(), "{warnings:?}");

    assert_eq!(defects.len(), 1, "{defects:?}");
    assert_eq!(
        defects[0].to_string(),
        "limits.replayMaxBytes — the run writes no `replayMaxBytes`, which is the byte ceiling gg \
         writes this run's capture journal under. gg substitutes nothing for a value nobody wrote, \
         and every run is conducted under this one, so there is no absence for gg to read as \
         \"off\"."
    );
}

/// The smallest block a launch accepts arms nothing but the journal ceiling, and is refused for
/// nothing — which is what makes "declares no ceiling" a configuration rather than an omission.
#[test]
fn the_required_values_alone_are_a_complete_declaration() {
    let limits = resolve_cleanly(required_only());

    assert_eq!(limits.max_turns, None);
    assert_eq!(limits.max_runtime, None);
    assert_eq!(limits.max_consecutive_errors, None);
    assert_eq!(limits.error_rate, None);
    assert_eq!(limits.max_cost, None);
    assert_eq!(limits.replay_max_bytes, Some(AUTHORED_REPLAY_MAX_BYTES));
}

#[test]
fn every_declared_ceiling_resolves_when_it_is_usable() {
    let limits = resolve_cleanly(GgRunLimits {
        max_turns: Some(60),
        max_runtime_secs: Some(5400),
        max_consecutive_errors: Some(5),
        max_error_rate: Some(0.5),
        error_rate_window: Some(10),
        max_cost: Some(25.0),
        replay_max_bytes: Some(1_024),
        ..required_only()
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
    assert_eq!(limits.replay_max_bytes, Some(1_024));
}

#[test]
fn a_zero_turn_ceiling_is_refused_rather_than_read_as_unbounded() {
    // The two spellings are not the same: an **absent** turn ceiling leaves the ceiling unarmed,
    // which is a declaration, while a declared `0` is a ceiling nothing could run under. Reading
    // the second as the first is reading a ceiling as its own opposite — and the run that results
    // is one nobody bounded, burning money, with a `maxTurns` in its own record.
    assert_eq!(
        sole_refusal(GgRunLimits {
            max_turns: Some(0),
            ..required_only()
        }),
        "limits.maxTurns = `0` — a run in which no agent may take a turn has nothing to do, so gg \
         cannot arm the ceiling `maxTurns` declares. Omit the key to leave the ceiling unarmed, or \
         give it a value a run can be bounded by."
    );
}

#[test]
fn a_zero_runtime_budget_is_refused() {
    assert!(
        sole_refusal(GgRunLimits {
            max_runtime_secs: Some(0),
            ..required_only()
        })
        .starts_with(
            "limits.maxRuntimeSecs = `0` — a budget of no seconds is spent before the run"
        )
    );
}

/// An absent consecutive-error ceiling is **unarmed**, not five: an agent stopped after failing
/// several turns in a row was stopped by a threshold its operator chose.
#[test]
fn an_absent_consecutive_error_ceiling_leaves_it_unarmed() {
    let limits = resolve_cleanly(GgRunLimits {
        max_consecutive_errors: None,
        ..required_only()
    });

    assert_eq!(limits.max_consecutive_errors, None);
    assert!(
        !limits.armed_summary().contains("consecutive"),
        "and the launch line says so: {}",
        limits.armed_summary()
    );
}

#[test]
fn a_zero_consecutive_error_ceiling_is_refused() {
    let declared = GgRunLimits {
        max_consecutive_errors: Some(0),
        ..required_only()
    };

    let (limits, _, _) = resolve(declared);
    assert_eq!(limits.max_consecutive_errors, None);
    assert_eq!(
        sole_refusal(declared),
        "limits.maxConsecutiveErrors = `0` — it would end an agent before its first turn, so gg \
         cannot arm the ceiling `maxConsecutiveErrors` declares. Omit the key to leave the ceiling \
         unarmed, or give it a value a run can be bounded by."
    );
}

#[test]
fn a_count_past_what_gg_holds_it_in_is_refused() {
    // The consecutive-error count is a `u32`. Saturating to its maximum would arm a ceiling nobody
    // wrote — effectively none — which is the same silence a dropped ceiling leaves.
    assert!(
        sole_refusal(GgRunLimits {
            max_consecutive_errors: Some(u64::from(u32::MAX) + 1),
            ..required_only()
        })
        .contains("cannot hold a ceiling above 4294967295")
    );
}

/// **Neither half is the off switch.** A set that writes no error rate and no window arms no
/// error-rate ceiling, and is refused for nothing: there is no figure gg would rather have.
#[test]
fn neither_half_of_the_error_rate_leaves_it_unarmed() {
    assert_eq!(resolve_cleanly(required_only()).error_rate, None);
}

/// **Half a ceiling is refused**, because the only thing that could complete it is a figure gg
/// chose — and a rate over a window nobody wrote is a ceiling the operator believes they set.
#[test]
fn a_rate_without_a_window_is_refused() {
    let declared = GgRunLimits {
        max_error_rate: Some(0.5),
        ..required_only()
    };

    let (limits, _, _) = resolve(declared);
    assert_eq!(limits.error_rate, None);
    assert_eq!(
        sole_refusal(declared),
        "limits.errorRateWindow — `maxErrorRate` is declared and `errorRateWindow` is not. \
         `errorRateWindow` is the lookback the rate is measured over, and the minimum sample \
         before it can fire, and the two halves stand or fall together: write both to arm the \
         ceiling, or neither to leave it unarmed. gg will not complete a half-written ceiling with \
         a figure of its own."
    );
}

#[test]
fn a_window_without_a_rate_is_refused() {
    let declared = GgRunLimits {
        error_rate_window: Some(10),
        ..required_only()
    };

    let (limits, _, _) = resolve(declared);
    assert_eq!(limits.error_rate, None);
    assert!(
        sole_refusal(declared).starts_with(
            "limits.maxErrorRate — `errorRateWindow` is declared and `maxErrorRate` is not."
        ),
        "{}",
        sole_refusal(declared)
    );
}

#[test]
fn a_rate_outside_zero_to_one_is_refused() {
    let declared = GgRunLimits {
        max_error_rate: Some(1.5),
        error_rate_window: Some(10),
        ..required_only()
    };

    let (limits, _, _) = resolve(declared);
    assert_eq!(limits.error_rate, None);
    assert!(sole_refusal(declared).starts_with(
        "limits.maxErrorRate = `1.5` — an error rate is a fraction of the window between 0.0 \
             and 1.0"
    ));
}

#[test]
fn a_rate_that_is_not_a_number_is_refused() {
    // JSON has no NaN, but a `f64` field deserialised from a sweep's generated configuration can
    // still arrive as one through any producer that is not `serde_json` — and a NaN threshold is
    // never greater than anything, so the ceiling would silently never fire.
    for rate in [f64::NAN, f64::INFINITY, -1.0] {
        let declared = GgRunLimits {
            max_error_rate: Some(rate),
            error_rate_window: Some(10),
            ..required_only()
        };

        let (limits, defects, _) = resolve(declared);
        assert_eq!(limits.error_rate, None, "{rate} should arm nothing");
        assert_eq!(defects.len(), 1, "{rate}: {defects:?}");
        assert_eq!(defects[0].locus, "limits.maxErrorRate", "{rate}");
    }
}

#[test]
fn a_zero_window_is_refused() {
    let declared = GgRunLimits {
        max_error_rate: Some(0.5),
        error_rate_window: Some(0),
        ..required_only()
    };

    let (limits, _, _) = resolve(declared);
    assert_eq!(limits.error_rate, None);
    assert!(
        sole_refusal(declared)
            .starts_with("limits.errorRateWindow = `0` — a window of no turns has nothing to")
    );
}

#[test]
fn both_halves_of_an_unusable_error_rate_are_refused_at_once() {
    // A rate and a window are edited in the same place, so an operator fixing one wants to be told
    // about the other in the same pass rather than on the next launch.
    let (_, defects, _) = resolve(GgRunLimits {
        max_error_rate: Some(2.0),
        error_rate_window: Some(0),
        ..required_only()
    });

    assert_eq!(
        defects
            .iter()
            .map(|defect| defect.locus.as_str())
            .collect::<Vec<_>>(),
        ["limits.maxErrorRate", "limits.errorRateWindow"]
    );
}

#[test]
fn a_window_not_smaller_than_the_turn_ceiling_is_armed_but_warned_about() {
    let declared = GgRunLimits {
        max_turns: Some(8),
        max_error_rate: Some(0.5),
        error_rate_window: Some(8),
        ..required_only()
    };

    let (limits, _, _) = resolve(declared);
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
fn a_non_positive_cost_ceiling_is_refused() {
    for max_cost in [0.0, -1.0, f64::NAN] {
        let declared = GgRunLimits {
            max_cost: Some(max_cost),
            ..required_only()
        };

        let (limits, _, _) = resolve(declared);
        assert_eq!(limits.max_cost, None, "{max_cost} should arm nothing");
        assert!(
            sole_refusal(declared).contains(
                "a spend ceiling must be a finite figure greater than zero, so gg cannot arm the \
                 ceiling `maxCost` declares"
            ),
            "{max_cost}"
        );
    }
}

/// **The journal ceiling is required**, and its refusal says why in the one sentence an operator
/// meeting it will want: capture runs on every session, so there is no absence to read as "off".
#[test]
fn an_absent_journal_ceiling_is_refused() {
    let declared = GgRunLimits {
        replay_max_bytes: None,
        ..required_only()
    };

    let (limits, _, _) = resolve(declared);
    assert_eq!(
        limits.replay_max_bytes, None,
        "the placeholder a refused launch carries; nothing is conducted under it"
    );
    let refusal = sole_refusal(declared);
    assert!(
        refusal.starts_with("limits.replayMaxBytes — the run writes no"),
        "{refusal}"
    );
    assert!(
        refusal.contains("no absence for gg to read as \"off\""),
        "{refusal}"
    );
}

#[test]
fn a_zero_journal_ceiling_is_refused() {
    // The one ceiling that bounds the *observation* of a run rather than the run, and read on the
    // same terms: a `0` would stop capture before its first line, and there is deliberately no
    // spelling of "no journal ceiling" for it to be read as.
    let declared = GgRunLimits {
        replay_max_bytes: Some(0),
        ..required_only()
    };

    let (limits, _, _) = resolve(declared);
    assert_eq!(
        limits.replay_max_bytes, None,
        "the placeholder; the launch is over either way"
    );
    let refusal = sole_refusal(declared);
    assert!(
        refusal.starts_with("limits.replayMaxBytes = `0` — it would stop session capture before"),
        "{refusal}"
    );
    assert!(
        refusal.contains("there is no reading of this run under which the journal has no ceiling"),
        "the remedy does not offer an omission that is itself refused: {refusal}"
    );
}

#[test]
fn every_unusable_ceiling_is_named_in_one_refusal() {
    // Every unusable declaration at once, and every one of them named. This is the operator-facing
    // property the whole refusal exists for: a sweep shares one configuration document across its
    // arms, so the operator fixing it wants the whole list in one pass rather than a dozen launches
    // each revealing the next.
    let set = GgCapabilitySet {
        agents: vec![GgAgentConfig {
            capabilities: vec![GgCapabilityConfig::enabled("shell")],
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

    let mut report = LaunchReport::collecting();
    let mut warnings = Vec::new();
    let limits = resolve_run_limits(&set, &mut report, &mut warnings);

    assert_eq!(
        report
            .into_defects()
            .iter()
            .map(|defect| defect.locus.clone())
            .collect::<Vec<_>>(),
        [
            "limits.maxTurns",
            "limits.maxRuntimeSecs",
            "limits.maxConsecutiveErrors",
            "limits.maxErrorRate",
            "limits.errorRateWindow",
            "limits.maxCost",
            "limits.replayMaxBytes",
        ]
    );
    assert!(
        warnings.is_empty(),
        "nothing here was honoured, so there is nothing to advise about: {warnings:?}"
    );
    // The values that come back no longer decide anything — the run is refused — but the resolver
    // stays total, so every mid-run caller of it still gets an answer. Every one of them is the
    // named placeholder, and none is a figure gg picked.
    assert_eq!(limits, bare_limits());
}

#[test]
fn the_armed_summary_names_every_ceiling_in_force() {
    let armed = resolve_cleanly(GgRunLimits {
        max_turns: Some(60),
        max_runtime_secs: Some(5400),
        max_consecutive_errors: Some(5),
        max_error_rate: Some(0.5),
        error_rate_window: Some(10),
        max_cost: Some(25.0),
        ..required_only()
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
    // is the point — a new outcome must be classified deliberately, not inherit an answer. The
    // error arm is exhaustive over the *specific* type rather than the base kind, because the
    // specific type is what an error outcome carries.
    let every_outcome = [
        TurnOutcome::Progressed,
        TurnOutcome::Finished,
        TurnOutcome::Error(TurnErrorType::ModelRetryExhausted),
        TurnOutcome::Error(TurnErrorType::TranspileSyntax),
        TurnOutcome::Error(TurnErrorType::ProgramApiError),
        TurnOutcome::Error(TurnErrorType::SandboxTimeout),
        TurnOutcome::Error(TurnErrorType::MissingCompletionNoCall),
        TurnOutcome::Fatal(FatalFault::ArtifactDefect),
        TurnOutcome::Fatal(FatalFault::HostFault),
        TurnOutcome::Fatal(FatalFault::Lowering),
        TurnOutcome::Fatal(FatalFault::Toolchain),
        TurnOutcome::Fatal(FatalFault::RunBroken),
    ];

    for outcome in every_outcome {
        let expected = match outcome {
            TurnOutcome::Progressed | TurnOutcome::Finished | TurnOutcome::Fatal(_) => false,
            TurnOutcome::Error(error) => match error {
                TurnErrorType::ModelAuth
                | TurnErrorType::ModelRejected
                | TurnErrorType::ModelRetryExhausted
                | TurnErrorType::ModelResponseLoop
                | TurnErrorType::ModelVisionUnsupported
                | TurnErrorType::ModelParse
                | TurnErrorType::ModelTimeout
                | TurnErrorType::ModelLengthCapped
                | TurnErrorType::TranspileSyntax
                | TurnErrorType::TranspileCompile
                | TurnErrorType::TranspileUnsupported
                | TurnErrorType::ProgramApiError
                | TurnErrorType::ProgramUnknownName
                | TurnErrorType::ProgramThrow
                | TurnErrorType::SandboxTimeout
                | TurnErrorType::SandboxOutOfMemory
                | TurnErrorType::SandboxTrap
                | TurnErrorType::MissingCompletionNoCall
                | TurnErrorType::MissingCompletionCompaction => true,
            },
        };
        assert_eq!(outcome.is_error(), expected, "{outcome:?}");
    }
}

/// Every outcome publishes itself, and publishes its kind **and its type** exactly when it has one
/// — the invariant the contract states as "`error != null`, `errorType != null` and
/// `outcome == "error"` are the same statement".
///
/// Exhaustive over the taxonomy on purpose: a variant added here without a decision about what it
/// looks like on the wire would otherwise be published as whatever the nearest arm happened to say.
#[test]
fn every_outcome_publishes_itself_and_carries_a_kind_exactly_when_it_is_an_error() {
    let cases = [
        (
            TurnOutcome::Progressed,
            GgTurnOutcome::Progressed,
            None::<GgTurnErrorKind>,
            None::<GgTurnErrorType>,
        ),
        (TurnOutcome::Finished, GgTurnOutcome::Finished, None, None),
        (
            TurnOutcome::Error(TurnErrorType::ModelAuth),
            GgTurnOutcome::Error,
            Some(GgTurnErrorKind::ModelApi),
            Some(GgTurnErrorType::ModelAuth),
        ),
        (
            TurnOutcome::Error(TurnErrorType::TranspileCompile),
            GgTurnOutcome::Error,
            Some(GgTurnErrorKind::Transpile),
            Some(GgTurnErrorType::TranspileCompile),
        ),
        (
            TurnOutcome::Error(TurnErrorType::ProgramApiError),
            GgTurnOutcome::Error,
            Some(GgTurnErrorKind::ProgramFault),
            Some(GgTurnErrorType::ProgramApiError),
        ),
        (
            TurnOutcome::Error(TurnErrorType::SandboxOutOfMemory),
            GgTurnOutcome::Error,
            Some(GgTurnErrorKind::SandboxLimit),
            Some(GgTurnErrorType::SandboxOutOfMemory),
        ),
        (
            TurnOutcome::Error(TurnErrorType::MissingCompletionCompaction),
            GgTurnOutcome::Error,
            Some(GgTurnErrorKind::MissingCompletion),
            Some(GgTurnErrorType::MissingCompletionCompaction),
        ),
        // Every fault publishes the same `fatal`: *which* piece of gg's machinery broke is a defect
        // report the `error` log carries in sentences, not a dimension a study slices on. What
        // matters here is the `None`s beside it — a fatal turn carries no error type at all, which
        // is what keeps gg's defect out of the model's error record.
        (
            TurnOutcome::Fatal(FatalFault::ArtifactDefect),
            GgTurnOutcome::Fatal,
            None,
            None,
        ),
        (
            TurnOutcome::Fatal(FatalFault::HostFault),
            GgTurnOutcome::Fatal,
            None,
            None,
        ),
        (
            TurnOutcome::Fatal(FatalFault::Lowering),
            GgTurnOutcome::Fatal,
            None,
            None,
        ),
        (
            TurnOutcome::Fatal(FatalFault::Toolchain),
            GgTurnOutcome::Fatal,
            None,
            None,
        ),
        (
            TurnOutcome::Fatal(FatalFault::RunBroken),
            GgTurnOutcome::Fatal,
            None,
            None,
        ),
    ];

    for (outcome, expected_outcome, expected_kind, expected_type) in cases {
        let (published, kind, error_type) = outcome.wire();
        assert_eq!(published, expected_outcome, "{outcome:?}");
        assert_eq!(kind, expected_kind, "{outcome:?}");
        assert_eq!(error_type, expected_type, "{outcome:?}");
        assert_eq!(
            kind.is_some(),
            outcome.is_error(),
            "{outcome:?}: a kind is published exactly when the turn was an error"
        );
        assert_eq!(
            error_type.is_some(),
            outcome.is_error(),
            "{outcome:?}: a type is published exactly when the turn was an error"
        );
    }
}

/// The two levels can never disagree, because they are derived from one value: whatever an outcome
/// publishes as its type, that type's own base is what it publishes as its kind.
///
/// Asserted over **every** type rather than the handful the case table above spells out, so a type
/// added to gg without a base — or with the wrong one — fails here rather than in a console that
/// shows a `transpile` row under `model call`.
#[test]
fn a_published_type_always_agrees_with_the_kind_beside_it() {
    for error in every_turn_error_type() {
        let (outcome, kind, error_type) = TurnOutcome::Error(error).wire();
        assert_eq!(outcome, GgTurnOutcome::Error, "{error:?}");
        assert_eq!(
            error_type.map(GgTurnErrorType::kind),
            kind,
            "{error:?}: the published type's base must be the published kind"
        );
        assert_eq!(
            kind,
            Some(error.kind().wire()),
            "{error:?}: and gg's own base must be the one it publishes"
        );
    }
}

/// A reply abandoned by loop detection has **no** wire kind of its own, and that is a decision
/// rather than an omission: it never reaches this taxonomy at all, because the attempt is discarded
/// and retried, and a loop that survives every attempt arrives as an exhausted model call — which
/// is a `model_api` *kind*, published under its own `model_response_loop` **type**.
///
/// Pinned as the set of kinds gg can publish, so adding a sixth is a deliberate act with a test to
/// change rather than a silent widening of every console's bucket list.
#[test]
fn the_published_kinds_are_exactly_the_five_gg_can_produce() {
    let published: Vec<GgTurnErrorKind> = [
        TurnErrorKind::ModelApi,
        TurnErrorKind::Transpile,
        TurnErrorKind::ProgramFault,
        TurnErrorKind::SandboxLimit,
        TurnErrorKind::MissingCompletion,
    ]
    .into_iter()
    .map(TurnErrorKind::wire)
    .collect();

    assert_eq!(
        published,
        vec![
            GgTurnErrorKind::ModelApi,
            GgTurnErrorKind::Transpile,
            GgTurnErrorKind::ProgramFault,
            GgTurnErrorKind::SandboxLimit,
            GgTurnErrorKind::MissingCompletion,
        ]
    );

    // And every published kind is the base of at least one published type: a bucket a console
    // shows and nothing can ever fall into is the defect this taxonomy is built to avoid, and it
    // would be introduced by a base with no leaf just as surely as by a leaf with no producer.
    for kind in GgTurnErrorKind::ALL {
        assert!(
            every_turn_error_type().any(|error| error.kind().wire() == kind),
            "{kind:?} has no type under it"
        );
    }
}

/// gg's own type list, exhaustively — the compiler-checked source for the tests above.
///
/// Written as a `match` over a value rather than as a bare array so that adding a type to gg fails
/// to compile here, which is what makes "every type is exercised" true rather than hoped for.
fn every_turn_error_type() -> impl Iterator<Item = TurnErrorType> {
    let all = [
        TurnErrorType::ModelAuth,
        TurnErrorType::ModelRejected,
        TurnErrorType::ModelRetryExhausted,
        TurnErrorType::ModelResponseLoop,
        TurnErrorType::ModelVisionUnsupported,
        TurnErrorType::ModelParse,
        TurnErrorType::ModelTimeout,
        TurnErrorType::ModelLengthCapped,
        TurnErrorType::TranspileSyntax,
        TurnErrorType::TranspileCompile,
        TurnErrorType::TranspileUnsupported,
        TurnErrorType::ProgramApiError,
        TurnErrorType::ProgramUnknownName,
        TurnErrorType::ProgramThrow,
        TurnErrorType::SandboxTimeout,
        TurnErrorType::SandboxOutOfMemory,
        TurnErrorType::SandboxTrap,
        TurnErrorType::MissingCompletionNoCall,
        TurnErrorType::MissingCompletionCompaction,
    ];
    // The exhaustiveness guard: this match has no wildcard, so a new variant breaks the build here.
    for error in all {
        match error {
            TurnErrorType::ModelAuth
            | TurnErrorType::ModelRejected
            | TurnErrorType::ModelRetryExhausted
            | TurnErrorType::ModelResponseLoop
            | TurnErrorType::ModelVisionUnsupported
            | TurnErrorType::ModelParse
            | TurnErrorType::ModelTimeout
            | TurnErrorType::ModelLengthCapped
            | TurnErrorType::TranspileSyntax
            | TurnErrorType::TranspileCompile
            | TurnErrorType::TranspileUnsupported
            | TurnErrorType::ProgramApiError
            | TurnErrorType::ProgramUnknownName
            | TurnErrorType::ProgramThrow
            | TurnErrorType::SandboxTimeout
            | TurnErrorType::SandboxOutOfMemory
            | TurnErrorType::SandboxTrap
            | TurnErrorType::MissingCompletionNoCall
            | TurnErrorType::MissingCompletionCompaction => {}
        }
    }
    assert_eq!(
        all.len(),
        GgTurnErrorType::ALL.len(),
        "gg's type list and the contract's must name the same number of types"
    );
    all.into_iter()
}

// ---------------------------------------------------------------------------------------------
// The consecutive-error ceiling
// ---------------------------------------------------------------------------------------------

/// The consecutive count is **readable**, not merely enforceable — the per-agent figure each turn's
/// event publishes, so a run-wide stream can be folded into a maximum over agents rather than into a
/// streak that never happened.
///
/// It tracks exactly what the ceiling counts: it rises on every error kind, is cleared only by a
/// turn that progressed, and survives a terminal turn (which is recorded but clears nothing).
#[test]
fn the_consecutive_count_is_readable_after_every_recorded_turn() {
    let mut accounting = AgentLimits::new(bare_limits());
    assert_eq!(
        accounting.consecutive_errors(),
        0,
        "an agent that has taken no turns has no streak"
    );

    accounting.record(ERROR, AGENT);
    assert_eq!(accounting.consecutive_errors(), 1);
    accounting.record(TurnOutcome::Error(TurnErrorType::SandboxTimeout), AGENT);
    assert_eq!(
        accounting.consecutive_errors(),
        2,
        "every kind of failure is a failure"
    );

    accounting.record(TurnOutcome::Progressed, AGENT);
    assert_eq!(
        accounting.consecutive_errors(),
        0,
        "only a turn that carried out its declared work clears the count"
    );

    accounting.record(ERROR, AGENT);
    accounting.record(TurnOutcome::Finished, AGENT);
    assert_eq!(
        accounting.consecutive_errors(),
        1,
        "a session that ended on purpose neither failed nor recovered"
    );
}

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
            TurnOutcome::Error(TurnErrorType::TranspileSyntax),
            TurnOutcome::Error(TurnErrorType::ProgramThrow),
            TurnOutcome::Error(TurnErrorType::SandboxTimeout),
            TurnOutcome::Error(TurnErrorType::MissingCompletionNoCall),
            TurnOutcome::Error(TurnErrorType::ModelRetryExhausted),
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

// ---------------------------------------------------------------------------------------------
// The run's ceiling latch
// ---------------------------------------------------------------------------------------------

/// One breach of `limit`, as a stopping agent would raise it.
fn breach_of(limit: GgLimitKind, threshold: f64) -> GgLimitBreach {
    GgLimitBreach {
        limit,
        threshold,
        observed: threshold,
        turns: 1,
        agent_id: AGENT.to_string(),
        window: None,
    }
}

#[test]
fn a_run_inside_every_ceiling_raises_nothing() {
    // The shape of most runs, and the reason the latch needs no `Option` at any call site: a
    // default latch is a run that stayed inside every ceiling it armed, and the session epilogue
    // reads it as "exit 0" without asking whether a latch exists.
    assert!(CeilingLatch::default().raised().is_none());
}

#[test]
fn the_first_ceiling_breached_is_the_one_the_run_answers_with() {
    // A run-wide breach stops several agents at their own boundaries, and every later breach is
    // downstream of the first — an agent given less room by a run that was already ending. The
    // breach worth keeping names where the run first ran out.
    let latch = CeilingLatch::default();
    latch.raise(&breach_of(GgLimitKind::Cost, 25.0));
    latch.raise(&breach_of(GgLimitKind::Turns, 60.0));

    let raised = latch.raised().expect("the run breached a ceiling");
    assert_eq!(raised.limit, GgLimitKind::Cost);
    assert_eq!(raised.threshold, 25.0);
}

#[test]
fn a_clone_of_the_latch_is_the_same_latch() {
    // Every agent's ceilings carry a clone of the run's latch, and the session epilogue reads the
    // orchestrator's. A clone that answered separately would let a subagent breach a ceiling that
    // the run then exited as though it had never met.
    let latch = CeilingLatch::default();
    let agents_copy = latch.clone();
    agents_copy.raise(&breach_of(GgLimitKind::ErrorRate, 0.5));

    assert_eq!(
        latch.raised().expect("the run breached a ceiling").limit,
        GgLimitKind::ErrorRate
    );
}
