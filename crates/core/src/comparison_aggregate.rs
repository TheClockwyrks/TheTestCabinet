//! Aggregation: fold a [comparison](crate::comparison)'s arms and their runs into
//! the computed [`ComparisonArmResult`]s a view renders.
//!
//! This is the bridge from stored runs to presented distributions. It is
//! **deterministic** — an arm's runs are read in sorted-id order and the bootstrap
//! is seeded from those ids — so a comparison recomputes identically every time,
//! whether live in the console or baked into the public snapshot. It computes; it
//! never judges: every output is a distribution, a count, or a diagnostic, never a
//! winner.

use std::collections::{BTreeMap, BTreeSet};

use crate::comparison::{
    ArmDiagnostics, ArmScore, ComparisonArm, ComparisonArmResult, ComparisonConfig, Confound,
    ScorePoint, VariedDimension, automated_only_score,
};
use crate::comparison_stats::{MetricSummary, PassRate, seed_from_run_ids};
use crate::metrics::TokenCounts;
use crate::model_id::canonical_model_id;
use crate::review::Score;
use crate::run_record::{AuthMode, RunRecord};
use crate::test_case::ReviewItem;

/// A run counts as passing only when it earned every auto-covered point; this is
/// the float tolerance for that all-or-nothing check.
const FULL_MARKS_EPSILON: f64 = 1e-9;

/// Fold every arm of `config` into its result. `items` is the case's **effective**
/// review items (common + variant, errata applied) — shared by every arm, since a
/// comparison holds the case and variant constant. `runs` maps run id → record; an
/// arm reads exactly the runs its [`run_ids`](ComparisonArm::run_ids) name that are
/// present in the map.
pub fn aggregate_comparison(
    config: &ComparisonConfig,
    items: &[ReviewItem],
    runs: &BTreeMap<String, RunRecord>,
) -> Vec<ComparisonArmResult> {
    config
        .arms
        .iter()
        .map(|arm| aggregate_arm(config, arm, items, runs))
        .collect()
}

/// Fold one arm's runs into its result.
fn aggregate_arm(
    config: &ComparisonConfig,
    arm: &ComparisonArm,
    items: &[ReviewItem],
    runs: &BTreeMap<String, RunRecord>,
) -> ComparisonArmResult {
    // The arm's present runs, in a deterministic sorted-id order so the bootstrap
    // seed and every derived figure are independent of arrival order.
    let mut ids: Vec<String> = arm
        .run_ids
        .iter()
        .filter(|id| runs.contains_key(*id))
        .cloned()
        .collect();
    ids.sort();
    let arm_runs: Vec<&RunRecord> = ids.iter().map(|id| &runs[id]).collect();
    let seed = seed_from_run_ids(&ids);

    // Cost (comparable USD) and total-token distributions, over the runs that
    // report each metric — a run missing the figure is left out rather than folded
    // in as a zero that would drag the distribution down.
    let costs: Vec<f64> = arm_runs
        .iter()
        .filter_map(|r| r.metrics.cost.comparable)
        .collect();
    let tokens: Vec<f64> = arm_runs
        .iter()
        .filter_map(|r| r.metrics.tokens.total().map(|t| t as f64))
        .collect();
    let cost = MetricSummary::compute(&costs, seed);
    let tokens_summary = MetricSummary::compute(&tokens, seed);

    // Automated-only scores, over the runs that carry validators. A run whose
    // covered denominator is zero (no auto-checkable points ran) contributes to
    // neither the score nor the pass rate.
    let mut points: Vec<ScorePoint> = Vec::new();
    let mut passed = 0u64;
    for r in &arm_runs {
        let scripts = &r.validation.debug_scripts;
        if scripts.is_empty() {
            continue;
        }
        let Score { earned, total } = automated_only_score(items, scripts);
        if total == 0 {
            continue;
        }
        if (earned - f64::from(total)).abs() < FULL_MARKS_EPSILON {
            passed += 1;
        }
        points.push(ScorePoint { earned, total });
    }
    let scored_n = points.len();
    let score = (!points.is_empty()).then(|| {
        let mean_fraction = points
            .iter()
            .map(|p| p.earned / f64::from(p.total))
            .sum::<f64>()
            / scored_n as f64;
        ArmScore {
            n: scored_n,
            mean_fraction,
            points,
        }
    });
    let pass_rate = PassRate::compute(passed, scored_n as u64);

    ComparisonArmResult {
        arm: arm.clone(),
        n_desired: config.n,
        n_observed: arm_runs.len(),
        cost,
        tokens: tokens_summary,
        score,
        pass_rate,
        diagnostics: diagnostics_of(&arm_runs),
        confounds: detect_confounds(config, &arm_runs),
    }
}

/// Sum the token classes and tool-call counts across an arm's runs.
fn diagnostics_of(arm_runs: &[&RunRecord]) -> ArmDiagnostics {
    let mut tokens = TokenCounts::default();
    let mut tool_calls: BTreeMap<String, u64> = BTreeMap::new();
    for r in arm_runs {
        tokens = tokens.plus(r.metrics.tokens);
        for (name, count) in &r.tool_calls {
            *tool_calls.entry(name.clone()).or_default() += count;
        }
    }
    ArmDiagnostics { tokens, tool_calls }
}

/// Detect controls that slipped across an arm's runs: a held-constant variable whose
/// observed value drifted, or differs from the comparison's declared control. The
/// model is only a control when the comparison does **not** vary the model.
fn detect_confounds(config: &ComparisonConfig, arm_runs: &[&RunRecord]) -> Vec<Confound> {
    let controls = &config.controls;
    let mut out = Vec::new();

    let auth: Vec<String> = arm_runs
        .iter()
        .map(|r| auth_mode_slug(r.environment.auth_mode).to_string())
        .collect();
    if let Some(c) = confound_for("auth_mode", Some(auth_mode_slug(controls.auth_mode)), &auth) {
        out.push(c);
    }

    let orch: Vec<String> = arm_runs
        .iter()
        .map(|r| r.subject.orchestrator_slug.clone())
        .collect();
    if let Some(c) = confound_for("orchestrator", Some(&controls.orchestrator_slug), &orch) {
        out.push(c);
    }

    // The model is held constant only when the arms vary something else.
    if config.varied != VariedDimension::Model {
        let models: Vec<String> = arm_runs
            .iter()
            .map(|r| canonical_model_id(&r.subject.model_id, r.subject.harness_slug))
            .collect();
        if let Some(c) = confound_for("model", controls.model_id.as_deref(), &models) {
            out.push(c);
        }
    }

    out
}

/// A confound for `variable` when the `observed` values are anything other than the
/// single declared value (drift within the arm, or a wholesale mismatch with the
/// control). `None` when every observation equals `declared` (or there are none).
fn confound_for(variable: &str, declared: Option<&str>, observed: &[String]) -> Option<Confound> {
    let distinct: BTreeSet<&str> = observed.iter().map(String::as_str).collect();
    let consistent = match declared {
        Some(d) => distinct.iter().all(|v| *v == d),
        None => distinct.len() <= 1,
    };
    if consistent {
        return None;
    }
    Some(Confound {
        variable: variable.to_string(),
        values: distinct.into_iter().map(str::to_string).collect(),
    })
}

/// The stable slug for an auth mode, used in confound values and to compare against
/// the declared control.
fn auth_mode_slug(mode: AuthMode) -> &'static str {
    match mode {
        AuthMode::ApiKey => "apiKey",
        AuthMode::Subscription => "subscription",
    }
}

#[cfg(test)]
#[path = "comparison_aggregate.test.rs"]
mod tests;
