//! Tests for [`aggregate_comparison`]: an arm's runs fold into distributions, an
//! automated-only score and pass rate, summed diagnostics, and confound detection —
//! and two harnesses' arms never merge.

use std::collections::BTreeMap;

use super::*;
use crate::comparison::{ComparisonArm, ComparisonConfig, ComparisonControls, VariedDimension};
use crate::metrics::{Cost, RunMetrics, TokenCounts};
use crate::run_record::{
    AuthMode, HarnessSlug, RunEnvironment, RunLinks, RunState, RunStatus, RunSubject, RunTooling,
};
use crate::test_case::{ReviewItem, TestType};
use crate::validation::{AutoVerdict, DebugScriptResult, ValidationSummary};

/// A binary review item worth `weight`.
fn item(id: &str, weight: u32) -> ReviewItem {
    ReviewItem {
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
    }
}

/// A comparison of Pi vs Kilo on Carom, model held constant.
fn pi_vs_kilo() -> ComparisonConfig {
    ComparisonConfig {
        controls: ComparisonControls {
            case_slug: "carom".into(),
            version: "v2.0.0".into(),
            variant: "base".into(),
            model_id: Some("anthropic/claude-opus-4.8".into()),
            auth_mode: AuthMode::ApiKey,
            orchestrator_slug: "one-shot".into(),
            container_build: None,
        },
        varied: VariedDimension::Harness,
        arms: vec![
            ComparisonArm {
                id: "pi".into(),
                label: "Pi".into(),
                harness_slug: Some(HarnessSlug::Pi),
                gg_config_id: None,
                model_id: None,
                run_ids: vec!["pi-1".into(), "pi-2".into(), "pi-3".into()],
            },
            ComparisonArm {
                id: "kilo".into(),
                label: "Kilo".into(),
                harness_slug: Some(HarnessSlug::Kilo),
                gg_config_id: None,
                model_id: None,
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
    // Two Pi runs; the second ran under a subscription instead of the declared
    // API-key control.
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
