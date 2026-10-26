//! Tests for [`aggregate_comparison`]: an arm's runs fold into distributions, an
//! automated-only score and pass rate, summed diagnostics, and confound detection —
//! and two harnesses' arms never merge.

use std::collections::BTreeMap;

use super::*;
use crate::comparison::{ComparisonArm, ComparisonConfig, ComparisonControls};
use test_cabinet_contracts::engine::NONE_SLUG;
use test_cabinet_contracts::metrics::{Cost, RunMetrics, TokenCounts};
use test_cabinet_contracts::run_record::{
    AuthMode, HarnessSlug, RunEnvironment, RunLinks, RunState, RunStatus, RunSubject, RunTooling,
};
use test_cabinet_contracts::test_case::{ReviewItem, TestType};
use test_cabinet_contracts::validation::{AutoVerdict, DebugScriptResult, ValidationSummary};

/// The runs each arm holds, by arm id, with nothing in flight.
fn holding(arms: &[(&str, &[&str])]) -> BTreeMap<String, ArmHolding> {
    arms.iter()
        .map(|(arm, ids)| {
            (
                arm.to_string(),
                ArmHolding {
                    run_ids: ids.iter().map(|id| id.to_string()).collect(),
                    in_flight: 0,
                    unlaunchable: None,
                },
            )
        })
        .collect()
}

/// What [`pi_vs_kilo`]'s arms hold: three Pi runs and two Kilo runs.
fn pi_vs_kilo_held() -> BTreeMap<String, ArmHolding> {
    holding(&[
        ("pi", &["pi-1", "pi-2", "pi-3"]),
        ("kilo", &["kilo-1", "kilo-2"]),
    ])
}

/// A binary review item worth `weight`.
fn item(id: &str, weight: u32) -> ReviewItem {
    ReviewItem {
        failure_cap: None,
        domains: Vec::new(),
        id: id.into(),
        title: id.into(),
        text: String::new(),
        reference: None,
        proof: None,
        sequences: vec![],
        frames: vec![],
        weight,
        graded: false,
        domain: None,
        sub_items: vec![],
        scored: true,
        validation: None,
    }
}

/// A passing/failing debug-script result backing a whole item.
fn script(item_id: &str, pass: bool) -> DebugScriptResult {
    DebugScriptResult {
        item_id: item_id.into(),
        sub_item_id: None,
        title: String::new(),
        category_title: String::new(),
        script: String::new(),
        gates: true,
        ran: true,
        precondition_unmet: false,
        inconclusive: None,
        detail: None,
        verdicts: vec![AutoVerdict {
            id: item_id.into(),
            pass,
            assertions: vec![],
        }],
        outputs: vec![],
    }
}

/// A minimal validation summary carrying only the debug scripts.
fn validation(debug_scripts: Vec<DebugScriptResult>) -> ValidationSummary {
    ValidationSummary {
        debug_scripts,
        loaded: true,
        requirements: Vec::new(),
        detail: None,
        install: None,
        build: None,
        checks: vec![],
        proofs: vec![],
        asset: None,
        voxel: None,
        ui: None,
        material: None,
        particle: None,
        audio: None,
        adversarial: None,
        performance: None,
    }
}

/// Fields a test run varies; the rest are fixed defaults.
struct Run<'a> {
    id: &'a str,
    harness: HarnessSlug,
    model: &'a str,
    cost: f64,
    tokens: u64,
    tool_calls: &'a [(&'a str, u64)],
    scripts: Vec<DebugScriptResult>,
    auth: AuthMode,
}

fn record(r: Run) -> RunRecord {
    RunRecord {
        id: r.id.into(),
        started_at: "2026-07-27T00:00:00Z".into(),
        finished_at: "2026-07-27T00:05:00Z".into(),
        subject: RunSubject {
            test_case_slug: "carom".into(),
            test_case_version: "v2.0.0".into(),
            test_type: TestType::EndToEnd,
            variant: "base".into(),
            harness_slug: r.harness,
            harness_version: None,
            orchestrator_slug: "one-shot".into(),
            engine_slug: NONE_SLUG.into(),
            engine_version: None,
            model_id: r.model.into(),
            gg_capability_set: None,
            gg_summary: None,
        },
        tooling: RunTooling {
            test_cabinet_commit: None,
        },
        environment: RunEnvironment {
            os: "linux".into(),
            container_image: "img".into(),
            node_version: None,
            auth_mode: r.auth,
        },
        metrics: RunMetrics {
            run_time_seconds: 1.0,
            tokens: TokenCounts {
                uncached_input: Some(r.tokens),
                cached_input: None,
                output: None,
                reasoning: None,
            },
            cost: Cost {
                comparable: Some(r.cost),
                actual: Some(r.cost),
            },
            ..RunMetrics::default()
        },
        validation: validation(r.scripts),
        links: RunLinks {
            source_repo: None,
            playable_build: None,
            code: None,
        },
        status: RunStatus {
            state: RunState::Completed,
            detail: None,
        },
        game_jam_readme: None,
        tool_calls: r
            .tool_calls
            .iter()
            .map(|(n, c)| ((*n).to_string(), *c))
            .collect(),
        game_jam_prior_entries: Vec::new(),
        seed_commit: None,
        code_analysis: None,
        toolchain: None,
        showcase: None,
    }
}

/// A comparison of two configurations on Carom: Pi and Kilo, each on the same model.
fn pi_vs_kilo() -> ComparisonConfig {
    ComparisonConfig {
        controls: ComparisonControls {
            case_slug: "carom".into(),
            version: "v2.0.0".into(),
            variant: "base".into(),
            orchestrator_slug: "one-shot".into(),
            engine_slug: NONE_SLUG.into(),
            container_build: None,
        },
        arms: vec![
            ComparisonArm {
                id: "pi".into(),
                label: "Pi".into(),
                harness_slug: Some(HarnessSlug::Pi),
                model_id: Some("anthropic/claude-opus-4.8".into()),
                gg_config_id: None,
                gg_slot_models: BTreeMap::new(),
            },
            ComparisonArm {
                id: "kilo".into(),
                label: "Kilo".into(),
                harness_slug: Some(HarnessSlug::Kilo),
                model_id: Some("anthropic/claude-opus-4.8".into()),
                gg_config_id: None,
                gg_slot_models: BTreeMap::new(),
            },
        ],
        n: 3,
    }
}

#[test]
fn folds_each_arm_into_its_own_distribution_and_never_merges_them() {
    let items = [item("a", 3), item("b", 2)];
    let mut runs = BTreeMap::new();
    for (id, cost, tokens) in [
        ("pi-1", 0.51, 272_000),
        ("pi-2", 0.53, 291_000),
        ("pi-3", 0.56, 320_000),
    ] {
        runs.insert(
            id.to_string(),
            record(Run {
                id,
                harness: HarnessSlug::Pi,
                model: "anthropic/claude-opus-4.8",
                cost,
                tokens,
                tool_calls: &[("read", 4)],
                scripts: vec![script("a", true), script("b", true)],
                auth: AuthMode::ApiKey,
            }),
        );
    }
    for (id, cost, tokens, b_pass) in [
        ("kilo-1", 3.5, 3_100_000, true),
        ("kilo-2", 3.9, 3_400_000, false),
    ] {
        runs.insert(
            id.to_string(),
            record(Run {
                id,
                harness: HarnessSlug::Kilo,
                model: "openrouter/anthropic/claude-opus-4.8",
                cost,
                tokens,
                tool_calls: &[("todowrite", 53), ("read", 10)],
                scripts: vec![script("a", true), script("b", b_pass)],
                auth: AuthMode::ApiKey,
            }),
        );
    }

    let config = pi_vs_kilo();
    let arms = aggregate_comparison(&config, &items, false, &pi_vs_kilo_held(), &runs);
    assert_eq!(arms.len(), 2);

    let pi = &arms[0];
    assert_eq!(pi.n_observed, 3);
    assert_eq!(pi.n_desired, 3);
    // Pi's cost median is its own — never blended with Kilo's ~$3.70.
    let pi_cost = pi.cost.as_ref().unwrap();
    assert!((pi_cost.median - 0.53).abs() < 1e-9);
    // All three Pi runs earned full marks → 100% pass rate.
    let pi_pass = pi.pass_rate.as_ref().unwrap();
    assert_eq!((pi_pass.passed, pi_pass.n), (3, 3));
    assert!((pi.score.as_ref().unwrap().mean_fraction - 1.0).abs() < 1e-9);

    let kilo = &arms[1];
    assert_eq!(kilo.n_observed, 2);
    let kilo_cost = kilo.cost.as_ref().unwrap();
    assert!(kilo_cost.median >= 3.5 && kilo_cost.median <= 3.9);
    // One of Kilo's two runs failed item b → 1 of 2 passed.
    let kilo_pass = kilo.pass_rate.as_ref().unwrap();
    assert_eq!((kilo_pass.passed, kilo_pass.n), (1, 2));
    // The consumed todo tool is counted and summed across the arm's runs.
    assert_eq!(kilo.diagnostics.tool_calls.get("todowrite"), Some(&106));
    assert_eq!(kilo.diagnostics.tool_calls.get("read"), Some(&20));
    // Kilo's OpenRouter-prefixed model canonicalizes to the declared control, so
    // no model confound is raised despite the raw id differing.
    assert!(kilo.confounds.is_empty());
}

#[test]
fn a_run_that_drifts_from_a_control_is_surfaced_as_a_confound() {
    let items = [item("a", 3)];
    let mut runs = BTreeMap::new();
    // Two Pi runs of the one arm; the second ran under a subscription. Auth mode
    // comes from the harness's own configuration rather than being declared on the
    // comparison, so it is the *drift within the arm* that makes these two runs'
    // costs incomparable — and that is what must surface.
    runs.insert(
        "pi-1".into(),
        record(Run {
            id: "pi-1",
            harness: HarnessSlug::Pi,
            model: "anthropic/claude-opus-4.8",
            cost: 0.5,
            tokens: 100,
            tool_calls: &[],
            scripts: vec![script("a", true)],
            auth: AuthMode::ApiKey,
        }),
    );
    runs.insert(
        "pi-2".into(),
        record(Run {
            id: "pi-2",
            harness: HarnessSlug::Pi,
            model: "anthropic/claude-opus-4.8",
            cost: 0.5,
            tokens: 100,
            tool_calls: &[],
            scripts: vec![script("a", true)],
            auth: AuthMode::Subscription,
        }),
    );

    let mut config = pi_vs_kilo();
    config.arms.truncate(1);
    let held = holding(&[("pi", &["pi-1", "pi-2"])]);

    let arms = aggregate_comparison(&config, &items, false, &held, &runs);
    let confound = arms[0]
        .confounds
        .iter()
        .find(|c| c.variable == "auth_mode")
        .expect("auth_mode confound");
    assert_eq!(
        confound.values,
        vec!["apiKey".to_string(), "subscription".to_string()]
    );
}

#[test]
fn a_harness_arm_and_a_gg_arm_are_aggregated_side_by_side() {
    let items = [item("a", 3)];
    let mut runs = BTreeMap::new();
    runs.insert(
        "pi-1".into(),
        record(Run {
            id: "pi-1",
            harness: HarnessSlug::Pi,
            model: "anthropic/claude-opus-4.8",
            cost: 0.5,
            tokens: 300_000,
            tool_calls: &[("read", 4)],
            scripts: vec![script("a", true)],
            auth: AuthMode::ApiKey,
        }),
    );
    // The gg arm's runs span two models (one per agent role), which is exactly why a
    // gg arm declares slot models rather than a single model — and why its model is
    // checked for drift only, not against a declaration.
    for (id, model) in [
        ("gg-1", "anthropic/claude-opus-4.8"),
        ("gg-2", "anthropic/claude-opus-4.8"),
    ] {
        runs.insert(
            id.to_string(),
            record(Run {
                id,
                harness: HarnessSlug::Gg,
                model,
                cost: 0.9,
                tokens: 835_000,
                tool_calls: &[("read", 9)],
                scripts: vec![script("a", true)],
                auth: AuthMode::ApiKey,
            }),
        );
    }

    let mut config = pi_vs_kilo();
    config.arms.truncate(1);
    let held = holding(&[("pi", &["pi-1"]), ("gg", &["gg-1", "gg-2"])]);
    config.arms.push(ComparisonArm {
        id: "gg".into(),
        label: "gg — configuration A".into(),
        harness_slug: None,
        model_id: None,
        gg_config_id: Some("saved:cfg-a".into()),
        gg_slot_models: BTreeMap::from([(
            "primary".to_string(),
            "anthropic/claude-opus-4.8".to_string(),
        )]),
    });

    let arms = aggregate_comparison(&config, &items, false, &held, &runs);
    assert_eq!(arms.len(), 2);
    // Each arm keeps its own runs and its own distribution — never merged.
    assert_eq!(arms[0].n_observed, 1);
    assert_eq!(arms[1].n_observed, 2);
    assert!((arms[1].cost.as_ref().unwrap().median - 0.9).abs() < 1e-9);
    // Neither arm is confounded: the harness arm's runs match its declared harness
    // and model, and the gg arm's runs are internally consistent.
    assert!(arms[0].confounds.is_empty());
    assert!(arms[1].confounds.is_empty());
}

#[test]
fn a_run_under_a_different_harness_than_the_arm_declares_is_a_confound() {
    let items = [item("a", 3)];
    let mut runs = BTreeMap::new();
    runs.insert(
        "pi-1".into(),
        record(Run {
            id: "pi-1",
            harness: HarnessSlug::Opencode,
            model: "anthropic/claude-opus-4.8",
            cost: 0.5,
            tokens: 100,
            tool_calls: &[],
            scripts: vec![script("a", true)],
            auth: AuthMode::ApiKey,
        }),
    );

    let mut config = pi_vs_kilo();
    config.arms.truncate(1);
    let held = holding(&[("pi", &["pi-1"])]);

    let arms = aggregate_comparison(&config, &items, false, &held, &runs);
    let confound = arms[0]
        .confounds
        .iter()
        .find(|c| c.variable == "harness")
        .expect("harness confound");
    assert_eq!(confound.values, vec!["opencode".to_string()]);
}

#[test]
fn an_arm_with_no_present_runs_summarizes_to_nothing() {
    let items = [item("a", 3)];
    let runs: BTreeMap<String, RunRecord> = BTreeMap::new();
    let config = pi_vs_kilo();
    let arms = aggregate_comparison(&config, &items, false, &BTreeMap::new(), &runs);
    assert_eq!(arms[0].n_observed, 0);
    assert!(arms[0].run_ids.is_empty());
    assert!(arms[0].cost.is_none());
    assert!(arms[0].tokens.is_none());
    assert!(arms[0].session_duration.is_none());
    assert!(arms[0].score.is_none());
    assert!(arms[0].pass_rate.is_none());
}

/// Session duration is summarized on the same terms as cost: the harness session
/// alone, and a run recorded before the stage durations were measured contributes
/// nothing rather than a zero that would drag the median down.
#[test]
fn session_duration_summarizes_measured_runs_and_skips_unmeasured_ones() {
    let items = [item("a", 3)];
    let mut runs = BTreeMap::new();
    for (id, session) in [
        ("pi-1", Some(90.0)),
        ("pi-2", Some(150.0)),
        // Written before stage durations were measured.
        ("pi-3", None),
    ] {
        let mut run = record(Run {
            id,
            harness: HarnessSlug::Pi,
            model: "anthropic/claude-opus-4.8",
            cost: 0.5,
            tokens: 100,
            tool_calls: &[],
            scripts: vec![script("a", true)],
            auth: AuthMode::ApiKey,
        });
        run.metrics.session_seconds = session;
        runs.insert(id.to_string(), run);
    }

    let mut config = pi_vs_kilo();
    config.arms.truncate(1);
    let held = holding(&[("pi", &["pi-1", "pi-2", "pi-3"])]);

    let arms = aggregate_comparison(&config, &items, false, &held, &runs);
    let summary = arms[0]
        .session_duration
        .as_ref()
        .expect("a session distribution");
    // The unmeasured run is out of the sample entirely.
    assert_eq!(summary.n, 2);
    assert!((summary.median - 120.0).abs() < 1e-9);
    assert!((summary.mean - 120.0).abs() < 1e-9);
    assert!((summary.min - 90.0).abs() < 1e-9);
    assert!((summary.max - 150.0).abs() < 1e-9);
}

/// Every held run is reported as a raw point, in sorted run-id order rather than the
/// order the runs finished, carrying the values its distributions summarize, with an
/// unreported metric left absent.
#[test]
fn an_arm_reports_each_held_run_as_a_raw_point() {
    let items = [item("a", 3)];
    let mut runs = BTreeMap::new();
    for (id, cost, session) in [("run-z", 0.5, Some(90.0)), ("run-b", 0.75, None)] {
        let mut run = record(Run {
            id,
            harness: HarnessSlug::Pi,
            model: "anthropic/claude-opus-4.8",
            cost,
            tokens: 100,
            tool_calls: &[],
            scripts: vec![script("a", true)],
            auth: AuthMode::ApiKey,
        });
        run.metrics.session_seconds = session;
        runs.insert(id.to_string(), run);
    }

    let mut config = pi_vs_kilo();
    config.arms.truncate(1);
    let held = holding(&[("pi", &["run-z", "run-b"])]);

    let arms = aggregate_comparison(&config, &items, false, &held, &runs);
    assert_eq!(
        arms[0].run_points,
        vec![
            ArmRunPoint {
                run_id: "run-b".into(),
                cost: Some(0.75),
                tokens: Some(100.0),
                session_seconds: None,
            },
            ArmRunPoint {
                run_id: "run-z".into(),
                cost: Some(0.5),
                tokens: Some(100.0),
                session_seconds: Some(90.0),
            },
        ]
    );
}

/// The same run, moved onto an engine. Written as a mutation rather than another
/// [`Run`] field because the engine is fixed for every other test in this file:
/// only the two below vary it, and a field would put `engine: "none"` on a dozen
/// construction sites that have nothing to say about engines.
fn on_engine(mut record: RunRecord, slug: &str) -> RunRecord {
    record.subject.engine_slug = slug.to_string();
    // The version is read out of the staged package at seed time, so it exists
    // exactly when the engine vendors a runtime.
    record.subject.engine_version = (slug != NONE_SLUG).then(|| "1.0.0".to_string());
    record
}

/// **The engine is a control, not a dimension an A/B may vary.**
///
/// Runs of one case under different engines measure different work — an engine hands
/// the model the frame loop, input, audio, assets and diagnostics an engineless build
/// has to write for itself — so an arm that mixes them reports a runtime difference as
/// though it were a difference between the configurations under test. That has to read
/// as compromised rather than being quietly folded into one distribution.
#[test]
fn a_run_on_a_different_engine_than_the_comparison_declares_is_a_confound() {
    let items = [item("a", 3)];
    let mut runs = BTreeMap::new();
    for (id, engine) in [("pi-1", NONE_SLUG), ("pi-2", "simple-2d")] {
        runs.insert(
            id.to_string(),
            on_engine(
                record(Run {
                    id,
                    harness: HarnessSlug::Pi,
                    model: "anthropic/claude-opus-4.8",
                    cost: 0.5,
                    tokens: 100,
                    tool_calls: &[],
                    scripts: vec![script("a", true)],
                    auth: AuthMode::ApiKey,
                }),
                engine,
            ),
        );
    }

    let mut config = pi_vs_kilo();
    config.arms.truncate(1);
    let held = holding(&[("pi", &["pi-1", "pi-2"])]);

    let arms = aggregate_comparison(&config, &items, false, &held, &runs);
    let confound = arms[0]
        .confounds
        .iter()
        .find(|c| c.variable == "engine")
        .expect("engine confound");
    assert_eq!(
        confound.values,
        vec!["none".to_string(), "simple-2d".to_string()]
    );
}

/// The other half of the rule: an arm whose runs all ran the engine the comparison
/// declares is not confounded — including when that engine is not the default, because
/// a comparison *of* `simple-2d` builds is exactly the experiment the control exists to
/// make possible.
#[test]
fn an_arm_whose_runs_all_ran_the_declared_engine_is_not_confounded() {
    let items = [item("a", 3)];
    let mut runs = BTreeMap::new();
    for id in ["pi-1", "pi-2"] {
        runs.insert(
            id.to_string(),
            on_engine(
                record(Run {
                    id,
                    harness: HarnessSlug::Pi,
                    model: "anthropic/claude-opus-4.8",
                    cost: 0.5,
                    tokens: 100,
                    tool_calls: &[],
                    scripts: vec![script("a", true)],
                    auth: AuthMode::ApiKey,
                }),
                "simple-2d",
            ),
        );
    }

    let mut config = pi_vs_kilo();
    config.controls.engine_slug = "simple-2d".into();
    config.arms.truncate(1);
    let held = holding(&[("pi", &["pi-1", "pi-2"])]);

    let arms = aggregate_comparison(&config, &items, false, &held, &runs);
    assert!(
        arms[0].confounds.is_empty(),
        "an arm that held every control constant must report nothing: {:?}",
        arms[0].confounds
    );
}

/// An arm reports the runs it holds in the order they finished and its jobs in flight
/// as it was handed them. A held run whose record no longer decodes keeps its place in
/// `run_ids` and contributes no figure, so `n_observed` falls below it.
#[test]
fn an_arm_reports_its_held_runs_and_its_jobs_in_flight() {
    let items = [item("a", 3)];
    let mut runs = BTreeMap::new();
    for id in ["pi-2", "pi-1"] {
        runs.insert(
            id.to_string(),
            record(Run {
                id,
                harness: HarnessSlug::Pi,
                model: "anthropic/claude-opus-4.8",
                cost: 0.5,
                tokens: 100,
                tool_calls: &[],
                scripts: vec![script("a", true)],
                auth: AuthMode::ApiKey,
            }),
        );
    }

    // `pi-2` finished first, and `pi-unreadable` is held but has no record this build
    // can read.
    let config = pi_vs_kilo();
    let held = BTreeMap::from([
        (
            "pi".to_string(),
            ArmHolding {
                run_ids: vec!["pi-2".into(), "pi-1".into(), "pi-unreadable".into()],
                in_flight: 0,
                unlaunchable: None,
            },
        ),
        (
            "kilo".to_string(),
            ArmHolding {
                run_ids: Vec::new(),
                in_flight: 2,
                unlaunchable: None,
            },
        ),
    ]);
    let arms = aggregate_comparison(&config, &items, false, &held, &runs);

    assert_eq!(arms[0].run_ids, vec!["pi-2", "pi-1", "pi-unreadable"]);
    assert_eq!(arms[0].n_observed, 2);
    assert_eq!(arms[0].in_flight, 0);
    assert_eq!(arms[1].run_ids, Vec::<String>::new());
    assert_eq!(arms[1].in_flight, 2);
    assert_eq!(arms[1].n_observed, 0);
}

/// A run another arm holds is never read into this one, even though every record sits in
/// one shared map.
#[test]
fn an_arm_reads_only_the_runs_it_holds() {
    let items = [item("a", 3)];
    let mut runs = BTreeMap::new();
    for id in ["pi-1", "kilo-1"] {
        runs.insert(
            id.to_string(),
            record(Run {
                id,
                harness: HarnessSlug::Pi,
                model: "anthropic/claude-opus-4.8",
                cost: 0.5,
                tokens: 100,
                tool_calls: &[],
                scripts: vec![script("a", true)],
                auth: AuthMode::ApiKey,
            }),
        );
    }
    let config = pi_vs_kilo();
    let held = holding(&[("pi", &["pi-1"])]);
    let arms = aggregate_comparison(&config, &items, false, &held, &runs);
    assert_eq!(arms[0].n_observed, 1);
    assert_eq!(arms[1].n_observed, 0);
    assert!(arms[1].run_ids.is_empty());
}

/// A debug-script result whose suite never finished: the whole-run cap stopped it,
/// so it decided nothing.
fn timed_out_script(item_id: &str) -> DebugScriptResult {
    DebugScriptResult {
        ran: false,
        precondition_unmet: true,
        inconclusive: Some(test_cabinet_contracts::validation::Inconclusive::TimedOut),
        detail: Some("the vitest step exceeded its 2700s cap".into()),
        verdicts: vec![],
        ..script(item_id, true)
    }
}

/// On a validator-rated version a completed run whose validators decided no scored
/// point is broken, so a comparison scores it zero over the declared weight and fails
/// it on the pass rate, as every other seam does. A run that never completed has no
/// build to judge and stays out of both, and a version that is not validator-rated
/// keeps leaving a run with no covered point out.
#[test]
fn a_validator_rated_run_that_decided_nothing_scores_zero_over_the_declared_weight() {
    let items = [item("a", 3), item("b", 2)];
    let mut runs = BTreeMap::new();
    for (id, scripts, state) in [
        (
            "pi-1",
            vec![script("a", true), script("b", true)],
            RunState::Completed,
        ),
        (
            "pi-2",
            vec![timed_out_script("a"), timed_out_script("b")],
            RunState::Completed,
        ),
        ("pi-3", vec![], RunState::TimedOut),
    ] {
        let mut run = record(Run {
            id,
            harness: HarnessSlug::Pi,
            model: "anthropic/claude-opus-4.8",
            cost: 0.5,
            tokens: 100,
            tool_calls: &[],
            scripts,
            auth: AuthMode::ApiKey,
        });
        run.status.state = state;
        runs.insert(id.to_string(), run);
    }
    let mut config = pi_vs_kilo();
    config.arms.truncate(1);
    let held = holding(&[("pi", &["pi-1", "pi-2", "pi-3"])]);

    let arms = aggregate_comparison(&config, &items, true, &held, &runs);
    let score = arms[0].score.as_ref().expect("two scored runs");
    assert_eq!(score.n, 2, "the run that never completed is not scored");
    let totals: Vec<(f64, u32)> = score.points.iter().map(|p| (p.earned, p.total)).collect();
    assert_eq!(totals, [(5.0, 5), (0.0, 5)]);
    assert!((score.mean_fraction - 0.5).abs() < 1e-9);
    let pass = arms[0].pass_rate.as_ref().expect("a pass rate");
    assert_eq!((pass.passed, pass.n), (1, 2));

    let arms = aggregate_comparison(&config, &items, false, &held, &runs);
    let score = arms[0].score.as_ref().expect("one scored run");
    assert_eq!(score.n, 1, "a legacy version leaves an uncovered run out");
    let pass = arms[0].pass_rate.as_ref().expect("a pass rate");
    assert_eq!((pass.passed, pass.n), (1, 1));
}
