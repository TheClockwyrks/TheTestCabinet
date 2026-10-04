//! Tests for [`carry_run_ids`] and [`is_complete`]: which recorded runs each arm of an
//! edited comparison keeps (docs/comparisons/experiments.md, "Editing a comparison"),
//! and when a comparison is complete.

use super::*;
use crate::comparison_aggregate::aggregate_comparison;
use crate::engine::NONE_SLUG;
use std::collections::BTreeSet;

fn harness_arm(id: &str, harness: HarnessSlug, runs: &[&str]) -> ComparisonArm {
    ComparisonArm {
        id: id.into(),
        label: id.into(),
        harness_slug: Some(harness),
        model_id: Some("anthropic/claude-opus-4.8".into()),
        gg_config_id: None,
        gg_slot_models: BTreeMap::new(),
        run_ids: runs.iter().map(|r| r.to_string()).collect(),
    }
}

fn gg_arm(id: &str, runs: &[&str]) -> ComparisonArm {
    ComparisonArm {
        id: id.into(),
        label: id.into(),
        harness_slug: None,
        model_id: None,
        gg_config_id: Some("saved:cfg".into()),
        gg_slot_models: BTreeMap::from([("primary".into(), "openai/gpt-5.6".into())]),
        run_ids: runs.iter().map(|r| r.to_string()).collect(),
    }
}

/// A gg arm and a Codex arm, each with its runs launched.
fn gg_vs_codex() -> ComparisonConfig {
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
            gg_arm("gg", &["gg-1", "gg-2"]),
            harness_arm("codex", HarnessSlug::Codex, &["codex-1", "codex-2"]),
        ],
        n: 2,
    }
}

fn run_ids(config: &ComparisonConfig) -> Vec<Vec<String>> {
    config.arms.iter().map(|a| a.run_ids.clone()).collect()
}

/// The case the rule exists for: an in-progress comparison swaps its Codex arm for
/// Claude Code. The gg arm keeps its runs, still in flight or not, and only the new
/// arm starts empty.
#[test]
fn an_in_progress_edit_keeps_the_unchanged_arms_runs() {
    let stored = gg_vs_codex();
    let mut incoming = stored.clone();
    incoming.arms[1] = harness_arm("claude", HarnessSlug::Claude, &[]);

    carry_run_ids(&stored, false, &mut incoming);
    assert_eq!(
        run_ids(&incoming),
        vec![vec!["gg-1".to_string(), "gg-2".to_string()], vec![]]
    );
}

/// An arm that keeps its id but changes its model launches different runs, so the
/// runs it recorded no longer belong to it.
#[test]
fn an_arm_whose_launch_identity_changed_starts_empty() {
    let stored = gg_vs_codex();
    let mut incoming = stored.clone();
    incoming.arms[1].model_id = Some("openai/gpt-5.6".into());
    incoming.arms[0].gg_slot_models =
        BTreeMap::from([("primary".into(), "anthropic/claude-opus-4.8".into())]);

    carry_run_ids(&stored, false, &mut incoming);
    assert_eq!(run_ids(&incoming), vec![Vec::<String>::new(), vec![]]);
}

/// The same edit on a complete comparison runs the whole comparison again.
#[test]
fn an_arm_edit_on_a_complete_comparison_empties_every_arm() {
    let stored = gg_vs_codex();
    let mut incoming = stored.clone();
    incoming.arms[1] = harness_arm("claude", HarnessSlug::Claude, &[]);

    carry_run_ids(&stored, true, &mut incoming);
    assert_eq!(run_ids(&incoming), vec![Vec::<String>::new(), vec![]]);

    // Removing an arm is an edit to the arms too.
    let mut three = gg_vs_codex();
    three
        .arms
        .push(harness_arm("pi", HarnessSlug::Pi, &["pi-1", "pi-2"]));
    let mut incoming = three.clone();
    incoming.arms.pop();
    carry_run_ids(&three, true, &mut incoming);
    assert_eq!(run_ids(&incoming), vec![Vec::<String>::new(), vec![]]);
}

/// The controls are what every arm runs, so changing one empties every arm whether
/// or not the comparison was complete.
#[test]
fn a_control_change_empties_every_arm() {
    let stored = gg_vs_codex();
    let mut incoming = stored.clone();
    incoming.controls.version = "v2.1.0".into();

    carry_run_ids(&stored, false, &mut incoming);
    assert_eq!(run_ids(&incoming), vec![Vec::<String>::new(), vec![]]);
}

/// Raising `n` or relabelling an arm launches nothing different, so even a complete
/// comparison keeps every run and leaves the difference to the next trigger. The ids
/// the request carries are kept as sent, which is how a trigger appends its launches.
#[test]
fn n_and_labels_are_not_arm_edits() {
    let stored = gg_vs_codex();
    let mut incoming = stored.clone();
    incoming.n = 5;
    incoming.arms[0].label = "gg (renamed)".into();
    incoming.arms[1].run_ids.push("codex-3".into());

    carry_run_ids(&stored, true, &mut incoming);
    assert_eq!(
        run_ids(&incoming),
        vec![
            vec!["gg-1".to_string(), "gg-2".to_string()],
            vec![
                "codex-1".to_string(),
                "codex-2".to_string(),
                "codex-3".to_string()
            ],
        ]
    );
}

/// The arm results of `config` with each arm's held and landed counts set by hand.
fn results(config: &ComparisonConfig, counts: &[(usize, usize)]) -> Vec<ComparisonArmResult> {
    let mut arms = aggregate_comparison(config, &[], &BTreeMap::new(), &BTreeSet::new());
    for (arm, (held, landed)) in arms.iter_mut().zip(counts) {
        arm.live_run_ids = (0..*held).map(|i| format!("{}-{i}", arm.arm.id)).collect();
        arm.n_observed = *landed;
    }
    arms
}

#[test]
fn complete_needs_every_arm_at_n_with_nothing_in_flight() {
    let config = gg_vs_codex();
    assert!(is_complete(2, &results(&config, &[(2, 2), (2, 2)])));
    // One arm short.
    assert!(!is_complete(2, &results(&config, &[(2, 2), (1, 1)])));
    // Every arm held at n, but one run has not landed.
    assert!(!is_complete(2, &results(&config, &[(2, 2), (2, 1)])));
    // A comparison with no arm results (its case unresolvable) is never complete.
    assert!(!is_complete(2, &[]));
}
