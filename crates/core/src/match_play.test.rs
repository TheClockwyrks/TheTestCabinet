//! Tests for shared adversarial match play: the pure outcome/summary helpers and
//! real head-to-head + tournament runs over the case's committed baselines.

use std::path::PathBuf;

use foray_core::board::Team;
use foray_core::replay::ReplayResult;
use foray_core::state::{Ended, Kills, Score};

use super::*;
use crate::test_case::{
    AssetKind, BuildCommands, ContractSpec, SandboxSpec, SimulationSpec, TestCaseVersion, TestType,
};

/// The committed Foray case folder, where the baseline `references/*.wasm` live.
fn case_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../test-cases/adversarial-pacman/v1.0.0")
}

/// A Foray version rooted at the real case, with a low `max_ticks` so a match
/// resolves quickly even when neither baseline sweeps.
fn foray_version(max_ticks: u32) -> TestCaseVersion {
    TestCaseVersion {
        slug: "foray".to_string(),
        version: "v1.0.0".to_string(),
        name: "Foray".to_string(),
        difficulty: "hard".to_string(),
        tags: Vec::new(),
        summary: None,
        description_path: None,
        root: case_root(),
        prompt_path: PathBuf::from("prompt.hbs"),
        max_runtime_seconds: 1800,
        test_type: TestType::Adversarial,
        build: Some(BuildCommands {
            install: "cargo fetch".to_string(),
            build: "cargo build".to_string(),
            module: Some(PathBuf::from(
                "target/wasm32-unknown-unknown/release/controller.wasm",
            )),
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
            max_ticks,
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

/// Resolve a baseline into a [`ResolvedController`].
fn baseline(version: &TestCaseVersion, id: &str) -> ResolvedController {
    ResolvedController {
        controller: ControllerRef {
            id: id.to_string(),
            kind: ControllerKind::Baseline,
            label: None,
        },
        wasm: resolve_baseline(version, id).expect("baseline wasm"),
    }
}

fn result(winner: Option<Team>, ended: Ended) -> ReplayResult {
    ReplayResult {
        winner,
        score: Score { red: 3, blue: 1 },
        kills: Kills::default(),
        ended,
        ticks: 100,
    }
}

#[test]
fn outcome_for_reads_each_side_of_a_decided_match() {
    let red_swept = result(Some(Team::Red), Ended::Swept);
    assert_eq!(outcome_for(&red_swept, Team::Red), AdversarialOutcome::Win);
    assert_eq!(
        outcome_for(&red_swept, Team::Blue),
        AdversarialOutcome::Loss
    );

    let draw = result(None, Ended::TimeLimit);
    assert_eq!(outcome_for(&draw, Team::Red), AdversarialOutcome::Draw);

    // A decided forfeit is the *losing* side forfeiting; the winner wins outright.
    let red_forfeited = result(Some(Team::Blue), Ended::Forfeit);
    assert_eq!(
        outcome_for(&red_forfeited, Team::Red),
        AdversarialOutcome::Forfeit
    );
    assert_eq!(
        outcome_for(&red_forfeited, Team::Blue),
        AdversarialOutcome::Win
    );

    // No winner on a forfeit means both forfeited.
    let both_forfeited = result(None, Ended::Forfeit);
    assert_eq!(
        outcome_for(&both_forfeited, Team::Red),
        AdversarialOutcome::Forfeit
    );
}

#[test]
fn match_id_is_stable_and_segment_safe() {
    let id = match_id("border-soldier", "random");
    assert_eq!(id, "border-soldier__vs__random");
    assert!(!id.contains('/'), "a match id must be a safe path segment");
}

#[test]
fn a_quick_match_between_baselines_produces_a_replay_and_summary() {
    let version = foray_version(1_500);
    let red = baseline(&version, "border-soldier");
    let blue = baseline(&version, "random");

    let outcome = run_quick_match(&version, &red, &blue).expect("quick match");
    assert!(outcome.replay.is_some(), "a played match yields a replay");
    let summary = outcome.summary;
    assert_eq!(summary.match_id, "border-soldier__vs__random");
    assert_eq!(summary.red_id, "border-soldier");
    assert_eq!(summary.blue_id, "random");
    // The replay's participants name the two controllers.
    let replay = outcome.replay.unwrap();
    assert_eq!(replay.participants.red, "border-soldier");
    assert_eq!(replay.participants.blue, "random");
}

#[test]
fn an_unloadable_controller_forfeits_with_no_replay() {
    let version = foray_version(1_500);
    let mut red = baseline(&version, "border-soldier");
    // Corrupt Red's module so it cannot load.
    red.wasm = b"not wasm".to_vec();
    let blue = baseline(&version, "random");

    let outcome = run_quick_match(&version, &red, &blue).expect("quick match");
    assert!(outcome.replay.is_none(), "no match ran, so no replay");
    let summary = outcome.summary;
    assert_eq!(summary.win_type, "forfeit");
    assert_eq!(summary.winner.as_deref(), Some("random"));
    assert_eq!(summary.outcome_for_red, AdversarialOutcome::Forfeit);
    assert!(summary.detail.is_some(), "the load failure is reported");
}

#[test]
fn a_tournament_runs_every_pair_once_and_ranks_by_points() {
    let version = foray_version(1_500);
    let participants = vec![
        baseline(&version, "border-soldier"),
        baseline(&version, "greedy-raider"),
        baseline(&version, "random"),
    ];

    let mut progress = 0usize;
    let build = run_tournament(
        &version,
        "base",
        "tourney-1",
        "2026-06-21T00:00:00Z",
        participants,
        |played, total, _summary| {
            progress += 1;
            assert_eq!(total, 3, "three participants make three pairs");
            assert_eq!(played, progress);
        },
    )
    .expect("tournament");

    // C(3,2) = 3 matches, each reported once.
    assert_eq!(build.record.matches.len(), 3);
    assert_eq!(progress, 3);

    // Every match has a distinct, deterministic seat assignment (lower id = Red).
    for summary in &build.record.matches {
        assert!(summary.red_id < summary.blue_id, "lower id seats as Red");
    }

    // Standings rank all three, 1..=3, sorted by points descending.
    let standings = &build.record.standings;
    assert_eq!(standings.len(), 3);
    let ranks: Vec<u32> = standings.iter().map(|s| s.rank).collect();
    assert_eq!(ranks, vec![1, 2, 3]);
    for pair in standings.windows(2) {
        assert!(
            pair[0].points >= pair[1].points,
            "standings are sorted by points, highest first"
        );
    }

    // A participant's points are exactly the seeds it banked across its matches.
    for standing in standings {
        let id = &standing.participant_id;
        let earned: u32 = build
            .record
            .matches
            .iter()
            .map(|m| {
                if &m.red_id == id {
                    m.red_score
                } else if &m.blue_id == id {
                    m.blue_score
                } else {
                    0
                }
            })
            .sum();
        assert_eq!(standing.points, earned, "points == summed banked seeds");
    }
}
