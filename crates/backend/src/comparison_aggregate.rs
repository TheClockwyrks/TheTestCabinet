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
    ArmDiagnostics, ArmRunPoint, ArmScore, ComparisonArm, ComparisonArmResult, ComparisonConfig,
    Confound, ScorePoint, automated_only_score, automated_verdicts,
};
use crate::comparison_stats::{
    MetricSummary, MetricSummaryExt, PassRate, PassRateExt, seed_from_run_ids,
};
use crate::model_id::canonical_model_id;
use crate::review::{Score, validator_covered_score};
use test_cabinet_contracts::metrics::TokenCounts;
use test_cabinet_contracts::run_record::{AuthMode, RunRecord};
use test_cabinet_contracts::test_case::ReviewItem;

/// A run counts as passing only when it earned every auto-covered point; this is
/// the float tolerance for that all-or-nothing check.
const FULL_MARKS_EPSILON: f64 = 1e-9;

/// The runs one arm holds, as the caller read them off the arm's coverage cell
/// (docs/comparisons/experiments.md, "Which runs an arm holds").
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ArmHolding {
    /// The ids of the runs the arm holds, in the order they finished: the first `n`
    /// counted runs of its cell.
    pub run_ids: Vec<String>,
    /// The jobs of the cell in flight, up to what the arm still needs.
    pub in_flight: u32,
    /// Why the arm cannot be launched now, or `None` when it can.
    pub unlaunchable: Option<String>,
}

/// Fold every arm of `config` into its result. `items` is the case's **effective**
/// review items (common + variant, errata applied) — shared by every arm, since a
/// comparison holds the case and variant constant.
///
/// `holdings` maps an arm's id to the runs it holds; an arm absent from it holds none.
/// Which runs those are is the store's question (an arm holds the runs of its coverage
/// cell), so the caller answers it and this module computes the statistics. `runs` maps
/// a run id to its record, and an arm's statistics read exactly its held runs present in
/// it: a held run whose record no longer decodes keeps its place in
/// [`run_ids`](ComparisonArmResult::run_ids) and contributes no figure.
///
/// `validator_rated` is whether the case version is
/// [validator-rated](test_cabinet_contracts::test_case::TestCaseVersion::validator_rated): on such a
/// version a completed run whose validators decided no scored point scores zero over
/// the declared weight ([`validator_covered_score`]), exactly as it scores on its own
/// page, rather than being left out of the arm's score and pass rate.
pub fn aggregate_comparison(
    config: &ComparisonConfig,
    items: &[ReviewItem],
    validator_rated: bool,
    holdings: &BTreeMap<String, ArmHolding>,
    runs: &BTreeMap<String, RunRecord>,
) -> Vec<ComparisonArmResult> {
    let none = ArmHolding::default();
    config
        .arms
        .iter()
        .map(|arm| {
            let holding = holdings.get(&arm.id).unwrap_or(&none);
            aggregate_arm(config, arm, items, validator_rated, holding, runs)
        })
        .collect()
}

/// Fold one arm's runs into its result.
fn aggregate_arm(
    config: &ComparisonConfig,
    arm: &ComparisonArm,
    items: &[ReviewItem],
    validator_rated: bool,
    holding: &ArmHolding,
    runs: &BTreeMap<String, RunRecord>,
) -> ComparisonArmResult {
    // The arm's present runs, in a deterministic sorted-id order so the bootstrap
    // seed and every derived figure are independent of arrival order.
    let mut ids: Vec<String> = holding
        .run_ids
        .iter()
        .filter(|id| runs.contains_key(*id))
        .cloned()
        .collect();
    ids.sort();
    ids.dedup();
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
    // The harness session alone. Setup, teardown, and validation are the
    // cabinet's time, and a run recorded before the stage durations were
    // measured reports none — left out rather than folded in as a zero.
    let sessions: Vec<f64> = arm_runs
        .iter()
        .filter_map(|r| r.metrics.session_seconds)
        .collect();
    let session_duration = MetricSummary::compute(&sessions, seed);
    // The raw values the three distributions summarize, one entry per run, each
    // named by the run's id so a point links to the run's page.
    let run_points: Vec<ArmRunPoint> = arm_runs
        .iter()
        .map(|r| ArmRunPoint {
            run_id: r.id.clone(),
            cost: r.metrics.cost.comparable,
            tokens: r.metrics.tokens.total().map(|t| t as f64),
            session_seconds: r.metrics.session_seconds,
        })
        .collect();

    // Automated-only scores, over the runs that carry validators. A run whose
    // covered denominator is zero (no auto-checkable points ran) contributes to
    // neither the score nor the pass rate, except on a validator-rated version, where
    // a completed run whose validators decided no scored point is broken and scores
    // zero over the declared weight, as it does everywhere else it is shown.
    let mut points: Vec<ScorePoint> = Vec::new();
    let mut passed = 0u64;
    for r in &arm_runs {
        let scripts = &r.validation.debug_scripts;
        let Score { earned, total } = if validator_rated && r.status.state.is_scored() {
            validator_covered_score(items, &automated_verdicts(scripts))
        } else if scripts.is_empty() {
            continue;
        } else {
            automated_only_score(items, scripts)
        };
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
        run_ids: holding.run_ids.clone(),
        in_flight: holding.in_flight,
        n_observed: arm_runs.len(),
        unlaunchable: holding.unlaunchable.clone(),
        cost,
        tokens: tokens_summary,
        session_duration,
        run_points,
        score,
        pass_rate,
        diagnostics: diagnostics_of(&arm_runs),
        confounds: detect_confounds(config, arm, &arm_runs),
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

/// Detect variables that slipped across an arm's runs: a variable the arm's own
/// [configuration](ComparisonArm) fixes whose observed value drifted or differs from
/// what the arm declared, plus the comparison-wide controls.
///
/// The model and the harness are per-arm — an arm *is* one configuration — so they
/// are checked against that arm's declaration rather than a global control. The auth
/// mode comes from the harness's own configuration and is never declared here, so it
/// is only a confound when it drifted *within* the arm's runs (which does make the
/// arm's costs incomparable). A gg arm declares no single model (its capability set
/// may span one per agent role), so its model is likewise checked for drift only.
fn detect_confounds(
    config: &ComparisonConfig,
    arm: &ComparisonArm,
    arm_runs: &[&RunRecord],
) -> Vec<Confound> {
    let controls = &config.controls;
    let mut out = Vec::new();

    let auth: Vec<String> = arm_runs
        .iter()
        .map(|r| auth_mode_slug(r.environment.auth_mode).to_string())
        .collect();
    if let Some(c) = confound_for("auth_mode", None, &auth) {
        out.push(c);
    }

    let orch: Vec<String> = arm_runs
        .iter()
        .map(|r| r.subject.orchestrator_slug.clone())
        .collect();
    if let Some(c) = confound_for("orchestrator", Some(&controls.orchestrator_slug), &orch) {
        out.push(c);
    }

    // The engine, checked against the control exactly as the orchestrator is — and
    // for a blunter reason. An A/B that varies the engine is not measuring what it
    // claims to: runs of one case under different engines measure *different work*,
    // because the engine hands the model the frame loop, input, audio, assets, and
    // diagnostics the engineless build has to write for itself, and the case's
    // available checklist points differ with it. The resulting gap in cost, tokens,
    // and score belongs to the runtime rather than to the configurations under test,
    // so it is reported rather than folded in.
    let engines: Vec<String> = arm_runs
        .iter()
        .map(|r| r.subject.engine_slug.clone())
        .collect();
    if let Some(c) = confound_for("engine", Some(&controls.engine_slug), &engines) {
        out.push(c);
    }

    let harnesses: Vec<String> = arm_runs
        .iter()
        .map(|r| r.subject.harness_slug.as_str().to_string())
        .collect();
    let declared_harness = arm.harness_slug.map(|h| h.as_str().to_string());
    if let Some(c) = confound_for("harness", declared_harness.as_deref(), &harnesses) {
        out.push(c);
    }

    // The arm's declared model, canonicalized the same way an observed one is, so a
    // provider-prefixed declaration and the id a harness reports do not read as a
    // mismatch. A gg arm declares none (see the doc above), leaving a drift check.
    let declared_model = match (arm.model_id.as_deref(), arm.harness_slug) {
        (Some(model), Some(harness)) => Some(canonical_model_id(model, harness)),
        (Some(model), None) => Some(model.to_string()),
        (None, _) => None,
    };
    let models: Vec<String> = arm_runs
        .iter()
        .map(|r| canonical_model_id(&r.subject.model_id, r.subject.harness_slug))
        .collect();
    if let Some(c) = confound_for("model", declared_model.as_deref(), &models) {
        out.push(c);
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
