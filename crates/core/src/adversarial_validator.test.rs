//! Tests for the adversarial validator's non-match paths (forfeit/failed-load)
//! and its result mapping. Running a real match requires compiling a wasm
//! controller, which is exercised by the integration build, not here; these unit
//! tests cover the branches that need no wasm.

use std::path::PathBuf;

use foray_core::board::Team;
use foray_core::replay::ReplayResult;
use foray_core::state::{Ended, Kills, Score};

use super::{AdversarialValidator, ended_to, summarize};
use crate::execution::ArtifactCollection;
use crate::test_case::{
    AssetKind, BuildCommands, ContractSpec, SandboxSpec, SimulationSpec, TestCaseVersion, TestType,
};
use crate::validation::{AdversarialOutcome, AdversarialTeam, Validator};

/// A minimal adversarial version rooted at `root`, whose submission module path
/// is `module_rel` (relative to the run root).
fn adversarial_version(root: PathBuf, module_rel: &str) -> TestCaseVersion {
    TestCaseVersion {
        slug: "foray".to_string(),
        version: "v1.0.0".to_string(),
        name: "Foray".to_string(),
        difficulty: "hard".to_string(),
        tags: Vec::new(),
        summary: None,
        description_path: None,
        root,
        prompt_path: PathBuf::from("prompt.hbs"),
        max_runtime_seconds: 1800,
        test_type: TestType::Adversarial,
        build: Some(BuildCommands {
            install: "cargo fetch".to_string(),
            build: "cargo build".to_string(),
            module: Some(PathBuf::from(module_rel)),
        }),
        canvas: None,
        tool: None,
        output: None,
        contract: Some(ContractSpec {
            entry: "tick".to_string(),
            world: PathBuf::from("schemas/world.json"),
            action: PathBuf::from("schemas/action.json"),
        }),
        sandbox: Some(SandboxSpec {
            fuel_per_tick: 5_000_000,
            max_memory_bytes: 67_108_864,
        }),
        simulation: Some(SimulationSpec {
            timestep_ms: 16,
            max_ticks: 37_500,
        }),
        r#match: None,
        replay: None,
        asset_kind: AssetKind::Sprite,
        sheet: None,
        common_specs: Vec::new(),
        common_workspace: Vec::new(),
        init: None,
        asset_paths: Vec::new(),
        variants: Vec::new(),
        common_references: Vec::new(),
        common_proofs: Vec::new(),
        checks: Vec::new(),
        common_review_items: Vec::new(),
        domains: Vec::new(),
    }
}

#[test]
fn a_missing_submission_module_is_a_forfeit_loss() {
    let dir = tempfile::tempdir().expect("temp dir");
    let repo = dir.path().join("impl");
    std::fs::create_dir_all(&repo).expect("repo");
    // No module file at the declared path: the build emitted no controller.
    let version = adversarial_version(
        dir.path().to_path_buf(),
        "target/wasm32-unknown-unknown/release/controller.wasm",
    );

    let summary = AdversarialValidator::new()
        .validate(&version, &ArtifactCollection { repo_path: repo }, &[], &[])
        .expect("validate");

    // A submission that produced no module forfeits — it is recorded, not a crash.
    assert!(!summary.loaded, "no controller means nothing playable");
    let result = summary.adversarial.expect("adversarial result");
    assert_eq!(result.outcome, AdversarialOutcome::Forfeit);
    assert_eq!(result.winner, Some(AdversarialTeam::Blue));
    assert_eq!(result.submission_team, AdversarialTeam::Red);
    assert!(result.detail.is_some(), "forfeit carries a reason");
}

#[test]
fn a_missing_baseline_opponent_is_a_failed_load() {
    let dir = tempfile::tempdir().expect("temp dir");
    let repo = dir.path().join("impl");
    std::fs::create_dir_all(&repo).expect("repo");
    // A module exists (even garbage bytes), but the case ships no baseline, so the
    // match cannot be set up — a case-authoring failure, not the submission's.
    std::fs::write(repo.join("controller.wasm"), b"\0asm").expect("module");
    let version = adversarial_version(dir.path().to_path_buf(), "controller.wasm");

    let summary = AdversarialValidator::new()
        .validate(&version, &ArtifactCollection { repo_path: repo }, &[], &[])
        .expect("validate");

    assert!(!summary.loaded);
    assert!(summary.adversarial.is_none(), "no match was scored");
    assert!(
        summary
            .detail
            .as_deref()
            .unwrap_or_default()
            .contains("baseline opponent"),
        "detail names the missing baseline: {:?}",
        summary.detail
    );
}

#[test]
fn summarize_maps_a_red_sweep_to_a_submission_win() {
    let result = ReplayResult {
        winner: Some(Team::Red),
        score: Score { red: 41, blue: 39 },
        kills: Kills::default(),
        ended: Ended::Swept,
        ticks: 9123,
    };
    let summary = summarize(&result);
    assert_eq!(summary.outcome, AdversarialOutcome::Win);
    assert_eq!(summary.winner, Some(AdversarialTeam::Red));
    assert_eq!((summary.red_score, summary.blue_score), (41, 39));
    assert_eq!(summary.ended, "swept");
    assert_eq!(summary.ticks, 9123);
}

#[test]
fn recorded_ended_matches_the_replays_own_spelling_for_every_variant() {
    // The run record's `ended` string and the published `replay.json`'s `ended`
    // describe the same match and must read identically. Assert `ended_to` produces
    // exactly what serde serializes `Ended` to in the replay, for every variant, so
    // a future rename of one cannot silently desync the two artifacts.
    for ended in [Ended::Swept, Ended::TimeLimit, Ended::Forfeit] {
        let replay_spelling = serde_json::to_value(ended)
            .unwrap()
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(
            ended_to(ended),
            replay_spelling,
            "recorded `ended` must match the replay's spelling for {ended:?}",
        );
    }
}

#[test]
fn summarize_maps_a_blue_win_to_a_submission_loss() {
    let result = ReplayResult {
        winner: Some(Team::Blue),
        score: Score { red: 10, blue: 20 },
        kills: Kills::default(),
        ended: Ended::TimeLimit,
        ticks: 37_500,
    };
    let summary = summarize(&result);
    assert_eq!(summary.outcome, AdversarialOutcome::Loss);
    // The recorded `ended` is the *same* snake_case spelling the published
    // `replay.json` carries (serde's `rename_all = "snake_case"` on `Ended`), so
    // the run record and the replay never disagree on how the match ended.
    assert_eq!(summary.ended, "time_limit");
}

#[test]
fn summarize_maps_a_draw() {
    let result = ReplayResult {
        winner: None,
        score: Score { red: 5, blue: 5 },
        kills: Kills::default(),
        ended: Ended::TimeLimit,
        ticks: 37_500,
    };
    assert_eq!(summarize(&result).outcome, AdversarialOutcome::Draw);
}

#[test]
fn summarize_maps_a_red_forfeit_to_a_submission_forfeit() {
    // Blue wins by forfeit (Red forfeited): the submission owns the forfeit.
    let result = ReplayResult {
        winner: Some(Team::Blue),
        score: Score { red: 3, blue: 7 },
        kills: Kills::default(),
        ended: Ended::Forfeit,
        ticks: 400,
    };
    let summary = summarize(&result);
    assert_eq!(summary.outcome, AdversarialOutcome::Forfeit);
    assert_eq!(summary.winner, Some(AdversarialTeam::Blue));
}
