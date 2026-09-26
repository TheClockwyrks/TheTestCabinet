//! Unit tests for `tcab validate`'s pass/fail decision.
//!
//! The pass itself builds a tree, drives a browser and runs a case's validators, all
//! of which `core` exercises in its own tests. What is pinned here is the criteria the
//! command reads off the finished [`ValidationSummary`]: which fields make the command
//! exit non-zero, which are recorded and deliberately do not, and that a fault is
//! named once rather than counted twice.

use test_cabinet_core::{
    AdversarialResult, AdversarialTeam, AutoVerdict, CheckResult, MediaKind, ProofResult,
};

use super::*;

/// A summary of an end-to-end pass where everything held: it loaded, both build steps
/// succeeded, and nothing else is declared. Every test starts from this and introduces
/// exactly one fault, so a failing assertion names the field responsible.
fn clean() -> ValidationSummary {
    ValidationSummary {
        loaded: true,
        install: Some(step("npm ci", true)),
        build: Some(step("npm run build", true)),
        ..Default::default()
    }
}

/// A build step that ran the given command and succeeded or failed.
fn step(command: &str, succeeded: bool) -> StepResult {
    StepResult {
        command: command.to_string(),
        succeeded,
        detail: (!succeeded).then(|| "exit status 1".to_string()),
        output: None,
        attempts: None,
    }
}

/// A debug-script result for `verdict_id`, with the outcome fields left at the shape a
/// clean drive produces. Each test overrides only what it is about.
fn script(verdict_id: &str) -> DebugScriptResult {
    DebugScriptResult {
        item_id: verdict_id.to_string(),
        sub_item_id: None,
        title: verdict_id.to_string(),
        category_title: verdict_id.to_string(),
        script: format!("validation/{verdict_id}.mjs"),
        gates: true,
        ran: true,
        precondition_unmet: false,
        inconclusive: None,
        detail: None,
        verdicts: vec![AutoVerdict {
            id: verdict_id.to_string(),
            pass: true,
            assertions: Vec::new(),
        }],
        outputs: Vec::new(),
    }
}

/// A gating script recorded inconclusive of the given kind for `reason`, in the shape
/// the runner records one: it did not run and no verdict was synthesized. `None` is a
/// record from before the kinds were told apart.
fn inconclusive(verdict_id: &str, kind: Option<Inconclusive>, reason: &str) -> DebugScriptResult {
    DebugScriptResult {
        ran: false,
        precondition_unmet: true,
        inconclusive: kind,
        detail: Some(reason.to_string()),
        verdicts: Vec::new(),
        ..script(verdict_id)
    }
}

/// The faults an end-to-end summary yields, which is the shape every case but the
/// adversarial and asset-generation ones takes.
fn end_to_end(summary: &ValidationSummary) -> Vec<String> {
    faults(summary, TestType::EndToEnd)
}

#[test]
fn a_clean_pass_has_no_faults() {
    assert!(end_to_end(&clean()).is_empty());
}

#[test]
fn a_tree_that_did_not_load_fails() {
    let summary = ValidationSummary {
        loaded: false,
        detail: Some("uncaught TypeError on load".to_string()),
        ..clean()
    };
    let faults = end_to_end(&summary);
    assert_eq!(faults.len(), 1);
    assert!(faults[0].contains("did not load"), "{faults:?}");
    // The recorded detail rides along, so the summary line alone says what happened.
    assert!(faults[0].contains("uncaught TypeError"), "{faults:?}");
}

#[test]
fn a_failed_build_step_fails() {
    let summary = ValidationSummary {
        build: Some(step("npm run build", false)),
        ..clean()
    };
    assert_eq!(
        end_to_end(&summary),
        vec!["the build step failed (`npm run build`)"]
    );
}

#[test]
fn a_build_step_that_was_never_reached_fails() {
    let summary = ValidationSummary {
        build: None,
        ..clean()
    };
    assert_eq!(
        end_to_end(&summary),
        vec!["the build step was never reached"]
    );
}

#[test]
fn a_type_that_never_runs_the_build_steps_does_not_fail_on_their_absence() {
    // An adversarial case declares a `[build]` table but compiles its submission to
    // wasm through its own path, recording neither step. Demanding them there would
    // fail every adversarial pass ever run.
    let summary = ValidationSummary {
        loaded: true,
        install: None,
        build: None,
        ..Default::default()
    };
    assert!(faults(&summary, TestType::Adversarial).is_empty());
}

#[test]
fn a_check_that_was_not_reached_fails() {
    let mut summary = clean();
    summary.checks = vec![
        CheckResult {
            view: "title".to_string(),
            name: "Title screen".to_string(),
            reached: true,
            similarity: 0.91,
            detail: None,
        },
        CheckResult {
            view: "gameplay".to_string(),
            name: "Gameplay".to_string(),
            reached: false,
            similarity: 0.0,
            detail: Some("the start button was never found".to_string()),
        },
    ];
    assert_eq!(
        end_to_end(&summary),
        vec!["declared check(s) not reached: gameplay"]
    );
}

#[test]
fn a_low_similarity_on_a_reached_check_is_not_a_fault() {
    // A declared check carries no similarity threshold, so any cutoff applied here
    // would be one this command invented rather than one the case asked for.
    let mut summary = clean();
    summary.checks = vec![CheckResult {
        view: "title".to_string(),
        name: "Title screen".to_string(),
        reached: true,
        similarity: 0.02,
        detail: None,
    }];
    assert!(end_to_end(&summary).is_empty());
}

#[test]
fn a_missing_proof_fails() {
    let mut summary = clean();
    summary.proofs = vec![
        ProofResult {
            id: "screenshot".to_string(),
            name: "Screenshot".to_string(),
            kind: MediaKind::Image,
            dest: "proof/screenshot.png".to_string(),
            present: true,
            detail: None,
        },
        ProofResult {
            id: "clip".to_string(),
            name: "Clip".to_string(),
            kind: MediaKind::Video,
            dest: "proof/clip.webm".to_string(),
            present: false,
            detail: Some("`proof/clip.webm` does not exist".to_string()),
        },
    ];
    assert_eq!(
        end_to_end(&summary),
        vec!["declared proof(s) missing: clip"]
    );
}

#[test]
fn a_failing_verdict_fails() {
    let mut summary = clean();
    let mut failing = script("ball.spin");
    failing.verdicts[0].pass = false;
    summary.debug_scripts = vec![script("ball.bounce"), failing];
    assert_eq!(end_to_end(&summary), vec!["1 verdict(s) failed: ball.spin"]);
}

#[test]
fn a_gating_script_that_did_not_run_fails() {
    let mut summary = clean();
    let mut broken = script("ball.spin");
    broken.ran = false;
    // A contract failure synthesizes a failing verdict for the point it backs. The
    // script must be named once as a validator that did not run, never a second time
    // through that synthesized verdict.
    broken.verdicts[0].pass = false;
    summary.debug_scripts = vec![broken];
    assert_eq!(
        end_to_end(&summary),
        vec!["validator(s) did not run: ball.spin"]
    );
}

#[test]
fn a_sub_item_driver_is_named_by_its_composite_verdict_id() {
    let mut summary = clean();
    let mut broken = script("ball");
    broken.sub_item_id = Some("spin".to_string());
    broken.ran = false;
    broken.verdicts.clear();
    summary.debug_scripts = vec![broken];
    assert_eq!(
        end_to_end(&summary),
        vec!["validator(s) did not run: ball.spin"]
    );
}

#[test]
fn an_inconclusive_script_fails() {
    // Scoring skips an inconclusive unit because it decided nothing about the build.
    // This command asks whether the tree satisfied everything the case declares, and
    // a unit that decided nothing did not, so it fails here: the alternative is a
    // clean exit from a host that could not run anything.
    let mut summary = clean();
    summary.debug_scripts = vec![inconclusive(
        "ball.spin",
        Some(Inconclusive::PreconditionUnmet),
        "the board never spawned a gas pocket to pose the spin on",
    )];
    assert_eq!(
        end_to_end(&summary),
        vec![
            "1 validator(s) inconclusive (precondition unmet): ball.spin — the board never \
             spawned a gas pocket to pose the spin on"
        ]
    );
}

#[test]
fn every_inconclusive_kind_fails_and_is_named_by_its_kind() {
    // The kind is what tells an operator whether to fix the host, the tree or the
    // validator, so each one is quoted in words rather than folded into one label. A
    // record from before the kinds were told apart still fails; it just cannot say
    // which kind it was.
    for (kind, label) in [
        (Some(Inconclusive::NotRun), "not run"),
        (Some(Inconclusive::TimedOut), "timed out"),
        (Some(Inconclusive::PreconditionUnmet), "precondition unmet"),
        (None, "unknown kind"),
    ] {
        let mut summary = clean();
        summary.debug_scripts = vec![inconclusive("ball.spin", kind, "reason")];
        assert_eq!(
            end_to_end(&summary),
            vec![format!(
                "1 validator(s) inconclusive ({label}): ball.spin — reason"
            )],
            "{kind:?}"
        );
    }
}

#[test]
fn inconclusive_units_that_share_a_reason_are_reported_as_one_fault() {
    // The symptom this rule exists for: the produced tree had no vitest binary, so
    // the runner never started and every one of the case's 401 suites was recorded
    // inconclusive with the same reason. That is one finding, named once with its
    // count, not 401 repetitions of a reason the operator needs to read exactly once.
    let reason = "`node_modules/.bin/vitest` is not present in the produced tree, so the validators \
         could not be run";
    let mut summary = clean();
    summary.debug_scripts = (0..401)
        .map(|n| inconclusive(&format!("unit{n}"), Some(Inconclusive::NotRun), reason))
        .collect();
    assert_eq!(
        end_to_end(&summary),
        vec![format!("401 validator(s) inconclusive (not run): {reason}")]
    );
}

#[test]
fn a_few_inconclusive_units_are_listed_by_id_and_many_are_counted() {
    // Up to the cap the ids ride on the line; past it only the count does, and the
    // per-script body above the verdict is where the ids are read.
    let reason = "the runner was stopped at its wall-clock cap";
    let units = |count: usize| {
        (0..count)
            .map(|n| inconclusive(&format!("unit{n}"), Some(Inconclusive::TimedOut), reason))
            .collect::<Vec<_>>()
    };

    let mut summary = clean();
    summary.debug_scripts = units(INCONCLUSIVE_IDS_LISTED);
    let listed = end_to_end(&summary);
    assert_eq!(listed.len(), 1, "{listed:?}");
    assert!(
        listed[0].starts_with(&format!(
            "{INCONCLUSIVE_IDS_LISTED} validator(s) inconclusive (timed out): unit0, unit1"
        )),
        "{listed:?}"
    );
    assert!(listed[0].ends_with(&format!(" — {reason}")), "{listed:?}");

    summary.debug_scripts = units(INCONCLUSIVE_IDS_LISTED + 1);
    assert_eq!(
        end_to_end(&summary),
        vec![format!(
            "{} validator(s) inconclusive (timed out): {reason}",
            INCONCLUSIVE_IDS_LISTED + 1
        )]
    );
}

#[test]
fn inconclusive_units_are_grouped_by_kind_and_reason() {
    // Two units that went inconclusive for different reasons, or for the same reason
    // of different kinds, are different findings and get a line each. Environment
    // kinds come first, so a host problem is read before a check's own decision, and
    // the order is stable regardless of the order the scripts were recorded in.
    let mut summary = clean();
    summary.debug_scripts = vec![
        inconclusive(
            "ball.spin",
            Some(Inconclusive::PreconditionUnmet),
            "no gas pocket spawned",
        ),
        inconclusive(
            "ball.bounce",
            Some(Inconclusive::NotRun),
            "the report would not parse",
        ),
        inconclusive(
            "paddle.move",
            Some(Inconclusive::PreconditionUnmet),
            "no gas pocket spawned",
        ),
        inconclusive(
            "paddle.size",
            Some(Inconclusive::PreconditionUnmet),
            "the paddle never left the wall",
        ),
    ];
    assert_eq!(
        end_to_end(&summary),
        vec![
            "1 validator(s) inconclusive (not run): ball.bounce — the report would not parse",
            "2 validator(s) inconclusive (precondition unmet): ball.spin, paddle.move — no gas \
             pocket spawned",
            "1 validator(s) inconclusive (precondition unmet): paddle.size — the paddle never \
             left the wall",
        ]
    );
}

#[test]
fn an_inconclusive_unit_with_no_detail_still_fails() {
    // The reason is prose the runner records; a record without one is still a unit
    // that decided nothing, and the line says the detail is missing rather than
    // quoting an empty string.
    let mut summary = clean();
    let mut undetailed = inconclusive("ball.spin", Some(Inconclusive::NotRun), "");
    undetailed.detail = None;
    summary.debug_scripts = vec![undetailed];
    assert_eq!(
        end_to_end(&summary),
        vec!["1 validator(s) inconclusive (not run): ball.spin — no detail recorded"]
    );
}

#[test]
fn a_contract_failure_and_an_inconclusive_unit_are_named_apart() {
    // Both fail the command, but one is the build's fault and the other is the host's
    // or the tree's, and the summary line has to let the operator tell which without
    // reading the body.
    let mut summary = clean();
    let mut broken = script("ball.spin");
    broken.ran = false;
    broken.verdicts[0].pass = false;
    summary.debug_scripts = vec![
        broken,
        inconclusive(
            "ball.bounce",
            Some(Inconclusive::NotRun),
            "the report would not parse",
        ),
    ];
    assert_eq!(
        end_to_end(&summary),
        vec![
            "validator(s) did not run: ball.spin",
            "1 validator(s) inconclusive (not run): ball.bounce — the report would not parse",
        ]
    );
}

#[test]
fn an_erratum_excluded_point_is_not_a_fault() {
    // `gates == false` is the case's own erratum saying this point is not scored for
    // the version, so neither a broken drive, a failing verdict nor an inconclusive
    // drive on it costs anything.
    let mut summary = clean();
    let mut excluded = script("ball.spin");
    excluded.gates = false;
    excluded.ran = false;
    excluded.verdicts[0].pass = false;
    let mut excluded_inconclusive = inconclusive(
        "ball.bounce",
        Some(Inconclusive::NotRun),
        "the report would not parse",
    );
    excluded_inconclusive.gates = false;
    summary.debug_scripts = vec![excluded, excluded_inconclusive];
    assert!(end_to_end(&summary).is_empty());
}

#[test]
fn an_adversarial_loss_is_a_result_and_not_a_fault() {
    for outcome in [
        AdversarialOutcome::Win,
        AdversarialOutcome::Loss,
        AdversarialOutcome::Draw,
    ] {
        let summary = ValidationSummary {
            adversarial: Some(match_result(outcome)),
            ..clean()
        };
        assert!(
            faults(&summary, TestType::Adversarial).is_empty(),
            "{outcome:?} should not be a validation fault"
        );
    }
}

#[test]
fn an_adversarial_forfeit_fails() {
    // A forfeit is the submission failing to present a playable controller, which is a
    // contract failure rather than a match it lost on the board.
    let summary = ValidationSummary {
        adversarial: Some(match_result(AdversarialOutcome::Forfeit)),
        ..clean()
    };
    assert_eq!(
        faults(&summary, TestType::Adversarial),
        vec!["the submission forfeited its adversarial match"]
    );
}

#[test]
fn every_fault_is_reported_together() {
    // A failing pass names all of its faults at once, so one run tells the operator
    // everything to fix rather than one thing per re-run.
    let mut summary = ValidationSummary {
        loaded: false,
        detail: Some("build produced no dist/build/out directory".to_string()),
        build: Some(step("npm run build", false)),
        ..clean()
    };
    summary.proofs = vec![ProofResult {
        id: "clip".to_string(),
        name: "Clip".to_string(),
        kind: MediaKind::Video,
        dest: "proof/clip.webm".to_string(),
        present: false,
        detail: None,
    }];
    let mut failing = script("ball.spin");
    failing.verdicts[0].pass = false;
    summary.debug_scripts = vec![failing];

    let faults = end_to_end(&summary);
    assert_eq!(faults.len(), 4, "{faults:?}");
    assert!(faults[0].contains("did not load"), "{faults:?}");
    assert!(faults[1].contains("build step failed"), "{faults:?}");
    assert!(faults[2].contains("proof(s) missing"), "{faults:?}");
    assert!(faults[3].contains("verdict(s) failed"), "{faults:?}");
}

/// A canonical-match result with the given outcome; only the outcome is read.
fn match_result(outcome: AdversarialOutcome) -> AdversarialResult {
    AdversarialResult {
        replay_json: "replay.json".to_string(),
        opponent: "baseline".to_string(),
        submission_team: AdversarialTeam::Red,
        winner: Some(AdversarialTeam::Blue),
        red_score: 3,
        blue_score: 7,
        ended: "timeLimit".to_string(),
        ticks: 4_000,
        outcome,
        detail: None,
        controller_module: "dist/controller.wasm".to_string(),
        replays: Vec::new(),
    }
}
