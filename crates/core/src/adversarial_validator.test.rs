//! Tests for the adversarial validator's non-match paths (forfeit/failed-load)
//! and its result mapping. Running a real match requires compiling a wasm
//! controller, which is exercised by the integration build, not here; these unit
//! tests cover the branches that need no wasm.

use std::path::PathBuf;

use foray_core::board::Team;
use foray_core::config::{BoardParamsSerde, Rules, Simulation};
use foray_core::replay::{Participants, REPLAY_VERSION, Replay, ReplayResult};
use foray_core::state::{Ended, Kills, Score};
use foray_host::{Decided, DecidedBy};

use super::{AdversarialValidator, replay_entry, summarize};
use crate::execution::ArtifactCollection;
use crate::match_play::ended_to;
use crate::test_case::{
    AssetKind, BuildCommands, ContractSpec, SandboxSpec, SimulationSpec, TestCaseVersion, TestType,
    Variant,
};
use crate::validation::{AdversarialOutcome, AdversarialReplay, AdversarialTeam, Validator};

/// A bare default variant: the adversarial validator ignores the variant, so an
/// empty one (no voxel override) is all these tests need.
fn base_variant() -> Variant {
    Variant {
        slug: "base".to_string(),
        name: "Base".to_string(),
        description: None,
        specs: vec![],
        workspace: None,
        references: vec![],
        proofs: vec![],
        review_items: vec![],
        domains: vec![],
        voxel: None,
        reference_impl: None,
    }
}

/// Wrap a bare [`ReplayResult`] in a minimal [`Replay`] — the entry mapping reads
/// only the scores/kills/ticks the result already carries.
fn replay_of(result: ReplayResult) -> Replay {
    Replay {
        version: REPLAY_VERSION,
        map: "mirror-32x16".to_string(),
        seed: "0x1".to_string(),
        timestep_ms: 16,
        participants: Participants {
            red: "submission".to_string(),
            blue: "border-soldier".to_string(),
        },
        board: BoardParamsSerde::default(),
        rules: Rules::default(),
        simulation: Simulation::default(),
        ticks: Vec::new(),
        result,
    }
}

/// Build a scored replay entry for a match `decided` a given way over `result`'s
/// facts, against `border-soldier` (the opponent id and `scored` flag are
/// immaterial to the outcome derivation under test).
fn entry(result: ReplayResult, decided: Decided) -> AdversarialReplay {
    let replay = replay_of(result);
    replay_entry("border-soldier", "replay.json", true, &replay, decided)
}

/// A minimal adversarial version rooted at `root`, whose submission module path
/// is `module_rel` (relative to the run root).
fn adversarial_version(root: PathBuf, module_rel: &str) -> TestCaseVersion {
    TestCaseVersion {
        instrumentation: None,
        slug: "foray".to_string(),
        version: "v1.0.0".to_string(),
        experimental: false,
        name: "Foray".to_string(),
        difficulty: "hard".to_string(),
        tags: Vec::new(),
        summary: None,
        description_path: None,
        changelog_path: std::path::PathBuf::new(),
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
            world: Some(PathBuf::from("schemas/world.json")),
            action: Some(PathBuf::from("schemas/action.json")),
            input: None,
            output: None,
        }),
        sandbox: Some(SandboxSpec {
            fuel_per_tick: Some(5_000_000),
            fuel_limit: None,
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
        voxel: None,
        model: None,
        ui: None,
        material: None,
        particle: None,
        audio: None,
        common_specs: Vec::new(),
        common_workspace: Vec::new(),
        init: None,
        asset_paths: Vec::new(),
        packages: Vec::new(),
        variants: Vec::new(),
        common_references: Vec::new(),
        common_proofs: Vec::new(),
        checks: Vec::new(),
        common_review_items: Vec::new(),
        domains: Vec::new(),
        cases: Vec::new(),
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
        .validate(
            &version,
            &base_variant(),
            &ArtifactCollection { repo_path: repo },
            &[],
            &[],
        )
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
        .validate(
            &version,
            &base_variant(),
            &ArtifactCollection { repo_path: repo },
            &[],
            &[],
        )
        .expect("validate");

    assert!(!summary.loaded);
    assert!(summary.adversarial.is_none(), "no match was scored");
    assert!(
        summary
            .detail
            .as_deref()
            .unwrap_or_default()
            .contains("border-soldier"),
        "detail names the missing opponent: {:?}",
        summary.detail
    );
}

#[test]
fn validate_writes_a_replay_per_opponent_and_records_them() {
    // The committed Foray case root, where the reference opponents live.
    let case_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../test-cases/adversarial/hard/foray/v1.0.0");
    let dir = tempfile::tempdir().expect("temp dir");
    let repo = dir.path().join("impl");
    std::fs::create_dir_all(&repo).expect("repo");
    // A committed baseline stands in for the submission so the matches actually run.
    let submission =
        std::fs::read(case_root.join("references/random.wasm")).expect("submission wasm");
    std::fs::write(repo.join("controller.wasm"), &submission).expect("write submission");

    let mut version = adversarial_version(case_root, "controller.wasm");
    // Keep each match short so all four resolve quickly.
    version.simulation = Some(SimulationSpec {
        timestep_ms: 16,
        max_ticks: 64,
    });

    let summary = AdversarialValidator::new()
        .validate(
            &version,
            &base_variant(),
            &ArtifactCollection {
                repo_path: repo.clone(),
            },
            &[],
            &[],
        )
        .expect("validate");

    assert!(summary.loaded, "the submission presented a controller");
    let result = summary.adversarial.expect("adversarial result");
    // One replay per AUTO_REPLAY_OPPONENTS entry, canonical (border-soldier) first
    // and mirrored to the top-level fields.
    assert_eq!(result.replays.len(), 4);
    assert_eq!(result.replays[0].opponent, "border-soldier");
    assert_eq!(result.opponent, "border-soldier");
    assert_eq!(result.controller_module, "controller.wasm");
    // `random` is the unscored exhibition; every other opponent is scored.
    let random = result
        .replays
        .iter()
        .find(|r| r.opponent == "random")
        .expect("random replay");
    assert!(!random.scored, "random is an exhibition");
    assert!(
        result
            .replays
            .iter()
            .filter(|r| r.opponent != "random")
            .all(|r| r.scored),
        "every non-random opponent is scored",
    );
    // Each replay file was written into the produced tree at its recorded path.
    for replay in &result.replays {
        assert!(
            repo.join(&replay.replay_json).is_file(),
            "replay file `{}` was written",
            replay.replay_json,
        );
    }
}

#[test]
fn replay_entry_maps_a_red_sweep_to_a_submission_win() {
    let result = ReplayResult {
        winner: Some(Team::Red),
        score: Score { red: 41, blue: 39 },
        kills: Kills::default(),
        ended: Ended::Swept,
        ticks: 9123,
    };
    let summary = entry(
        result,
        Decided {
            winner: Some(Team::Red),
            by: DecidedBy::Sweep,
        },
    );
    assert_eq!(summary.outcome, AdversarialOutcome::Win);
    assert_eq!(summary.winner, Some(AdversarialTeam::Red));
    assert_eq!((summary.red_score, summary.blue_score), (41, 39));
    assert_eq!(summary.ended, "swept");
    assert_eq!(summary.ticks, 9123);
}

#[test]
fn replay_entry_maps_a_level_score_efficiency_win_to_a_submission_win() {
    // A level-score time-limit match the host broke in Red's favour (Red ran
    // leaner) is recorded as a submission win, tagged `efficiency` so a reviewer
    // can tell it from a decisive score.
    let result = ReplayResult {
        winner: None,
        score: Score { red: 12, blue: 12 },
        kills: Kills::default(),
        ended: Ended::TimeLimit,
        ticks: 37_500,
    };
    let summary = entry(
        result,
        Decided {
            winner: Some(Team::Red),
            by: DecidedBy::Efficiency,
        },
    );
    assert_eq!(summary.outcome, AdversarialOutcome::Win);
    assert_eq!(summary.winner, Some(AdversarialTeam::Red));
    assert_eq!(summary.ended, "efficiency");
}

#[test]
fn summarize_mirrors_the_canonical_opponent_and_keeps_every_replay() {
    // The top-level scored fields mirror the first (canonical) replay; every
    // opponent's replay is preserved in order, scored flags intact.
    let canonical = AdversarialReplay {
        opponent: "border-soldier".to_string(),
        replay_json: "replay.json".to_string(),
        winner: Some(AdversarialTeam::Red),
        red_score: 41,
        blue_score: 39,
        ended: "swept".to_string(),
        ticks: 9123,
        outcome: AdversarialOutcome::Win,
        scored: true,
    };
    let exhibition = AdversarialReplay {
        opponent: "random".to_string(),
        replay_json: "replay-3.json".to_string(),
        winner: Some(AdversarialTeam::Red),
        red_score: 80,
        blue_score: 1,
        ended: "swept".to_string(),
        ticks: 500,
        outcome: AdversarialOutcome::Win,
        scored: false,
    };
    let result = summarize(
        vec![canonical.clone(), exhibition.clone()],
        "target/release/controller.wasm".to_string(),
    );
    assert_eq!(result.opponent, "border-soldier");
    assert_eq!(result.replay_json, "replay.json");
    assert_eq!(result.outcome, AdversarialOutcome::Win);
    assert_eq!((result.red_score, result.blue_score), (41, 39));
    assert_eq!(result.controller_module, "target/release/controller.wasm");
    assert_eq!(result.replays, vec![canonical, exhibition]);
    assert!(!result.replays[1].scored, "random stays unscored");
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
    let summary = entry(
        result,
        Decided {
            winner: Some(Team::Blue),
            by: DecidedBy::Score,
        },
    );
    assert_eq!(summary.outcome, AdversarialOutcome::Loss);
    // The recorded `ended` is the *same* snake_case spelling the published
    // `replay.json` carries (serde's `rename_all = "snake_case"` on `Ended`), so
    // the run record and the replay never disagree on how the match ended.
    assert_eq!(summary.ended, "time_limit");
}

#[test]
fn summarize_maps_a_genuine_draw() {
    // A genuine draw is a level score the fuel tie-break could not break either
    // (equal totals) — the host reports it with no winner.
    let result = ReplayResult {
        winner: None,
        score: Score { red: 5, blue: 5 },
        kills: Kills::default(),
        ended: Ended::TimeLimit,
        ticks: 37_500,
    };
    let summary = entry(
        result,
        Decided {
            winner: None,
            by: DecidedBy::Score,
        },
    );
    assert_eq!(summary.outcome, AdversarialOutcome::Draw);
    assert_eq!(summary.winner, None);
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
    let summary = entry(
        result,
        Decided {
            winner: Some(Team::Blue),
            by: DecidedBy::Forfeit,
        },
    );
    assert_eq!(summary.outcome, AdversarialOutcome::Forfeit);
    assert_eq!(summary.winner, Some(AdversarialTeam::Blue));
}
