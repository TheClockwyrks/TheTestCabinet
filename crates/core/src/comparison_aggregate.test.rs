//! Tests for [`aggregate_comparison`]: an arm's runs fold into distributions, an
//! automated-only score and pass rate, summed diagnostics, and confound detection —
//! and two harnesses' arms never merge.

use std::collections::BTreeMap;

use super::*;
use crate::comparison::{ComparisonArm, ComparisonConfig, ComparisonControls};
use crate::engine::NONE_SLUG;
use crate::metrics::{Cost, RunMetrics, TokenCounts};
use crate::run_record::{
    AuthMode, HarnessSlug, RunEnvironment, RunLinks, RunState, RunStatus, RunSubject, RunTooling,
};
use crate::test_case::{ReviewItem, TestType};
use crate::validation::{AutoVerdict, DebugScriptResult, ValidationSummary};

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
                run_ids: vec!["pi-1".into(), "pi-2".into(), "pi-3".into()],
            },
            ComparisonArm {
                id: "kilo".into(),
                label: "Kilo".into(),
                harness_slug: Some(HarnessSlug::Kilo),
                model_id: Some("anthropic/claude-opus-4.8".into()),
                gg_config_id: None,
                gg_slot_models: BTreeMap::new(),
                run_ids: vec!["kilo-1".into(), "kilo-2".into()],
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
    let arms = aggregate_comparison(&config, &items, &runs);
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
    config.arms[0].run_ids = vec!["pi-1".into(), "pi-2".into()];

    let arms = aggregate_comparison(&config, &items, &runs);
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
    config.arms[0].run_ids = vec!["pi-1".into()];
    config.arms.push(ComparisonArm {
        id: "gg".into(),
        label: "gg — configuration A".into(),
        harness_slug: None,
        model_id: None,
        gg_config_id: Some("builtin:default".into()),
        gg_slot_models: BTreeMap::from([(
            "primary".to_string(),
            "anthropic/claude-opus-4.8".to_string(),
        )]),
        run_ids: vec!["gg-1".into(), "gg-2".into()],
    });

    let arms = aggregate_comparison(&config, &items, &runs);
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
    config.arms[0].run_ids = vec!["pi-1".into()];

    let arms = aggregate_comparison(&config, &items, &runs);
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
    let arms = aggregate_comparison(&config, &items, &runs);
    assert_eq!(arms[0].n_observed, 0);
    assert!(arms[0].cost.is_none());
    assert!(arms[0].score.is_none());
    assert!(arms[0].pass_rate.is_none());
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
    config.arms[0].run_ids = vec!["pi-1".into(), "pi-2".into()];

    let arms = aggregate_comparison(&config, &items, &runs);
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
    config.arms[0].run_ids = vec!["pi-1".into(), "pi-2".into()];

    let arms = aggregate_comparison(&config, &items, &runs);
    assert!(
        arms[0].confounds.is_empty(),
        "an arm that held every control constant must report nothing: {:?}",
        arms[0].confounds
    );
}
