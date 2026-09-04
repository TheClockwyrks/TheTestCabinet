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
fn an_inconclusive_script_is_not_a_fault() {
    // An unmet precondition, a suite the project does not contain and a run the host
    // stopped on time all say nothing about the build, so they leave the point for a
    // human rather than failing the command.
    let mut summary = clean();
    let mut skipped = script("ball.spin");
    skipped.ran = false;
    skipped.precondition_unmet = true;
    skipped.verdicts.clear();
    summary.debug_scripts = vec![skipped];
    assert!(end_to_end(&summary).is_empty());
}

#[test]
fn an_erratum_excluded_point_is_not_a_fault() {
    // `gates == false` is the case's own erratum saying this point is not scored for
    // the version, so neither a broken drive nor a failing verdict on it costs
    // anything.
    let mut summary = clean();
    let mut excluded = script("ball.spin");
    excluded.gates = false;
    excluded.ran = false;
    excluded.verdicts[0].pass = false;
    summary.debug_scripts = vec![excluded];
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
