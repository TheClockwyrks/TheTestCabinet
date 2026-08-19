//! The **harness comparison** (A/B) data contract and its automated-only scorer.
//!
//! A comparison runs the same benchmark under several **configurations** — a
//! third-party harness on a model, or a [gg](crate::gg) capability set with a model
//! per slot — holds the case and every other variable constant, and presents the
//! cost, token, and score data side by side so a reader can judge for themselves.
//! This module defines the stored [`ComparisonConfig`] (its controls and arms) and
//! the computed read model ([`Comparison`] / [`ComparisonArmResult`]) that
//! [`crate::comparison_aggregate`] fills in from an arm's runs, summarizing each
//! with [`crate::comparison_stats`].
//!
//! Two principles are load-bearing (see `docs/comparisons/overview.md`) and are
//! encoded here rather than left to the UI:
//! - **Never merge harnesses.** Each arm keeps its own runs, distribution, and
//!   diagnostics; nothing is reduced to a single blended bar or rank.
//! - **Present data; never declare a winner.** The read model carries
//!   distributions, spreads, and sample sizes — never a verdict, a "winner", or a
//!   significance flag.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::comparison_stats::{MetricSummary, PassRate};
use crate::metrics::TokenCounts;
use crate::review::{ReviewVerdict, Score, VerdictStatus, score_checklist};
use crate::run_record::HarnessSlug;
use crate::test_case::ReviewItem;
use crate::validation::DebugScriptResult;

/// The variables a comparison holds constant across every arm — the identifying
/// dimensions of a [run](crate::run_record::RunSubject) minus the
/// [configuration](ComparisonArm) each arm names for itself. Drift on any of these
/// across an arm's runs is surfaced as a [`Confound`], never silently folded in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ComparisonControls {
    /// The test case slug every arm runs.
    pub case_slug: String,
    /// The exact case version every arm runs.
    pub version: String,
    /// The variant every arm runs.
    pub variant: String,
    /// The orchestrator every arm runs. Held constant (in practice `one-shot`, the
    /// only built-in); a stray mismatch is surfaced as a [`Confound`].
    pub orchestrator_slug: String,
    /// The [engine](crate::engine) every arm runs — the runtime the produced build
    /// is written against, `none` for a build that supplies its own frame loop,
    /// input, audio, assets, and diagnostics.
    ///
    /// A control rather than a per-arm dimension, because **an A/B that varies the
    /// engine is not measuring what it claims to**: runs of one case under different
    /// engines measure different work. Under an engine the model is handed a frame
    /// loop, an input layer, an audio bus, an asset loader, and diagnostics, so it
    /// writes the game and not the runtime beneath it, and the case's available
    /// checklist points differ accordingly. Two arms that disagree on the engine
    /// would report a difference in cost, tokens, and score that belongs to the
    /// runtime rather than to the configurations under test — so a mismatch is
    /// surfaced as a [`Confound`] instead of being folded in.
    ///
    /// Defaults to `none` when absent, so a comparison stored before engine
    /// selection existed still deserializes — and reads as what it was, since every
    /// such run built against no runtime at all.
    #[serde(default = "default_engine_slug")]
    pub engine_slug: String,
    /// The container/run-image build every arm runs, when pinned. `None` leaves it
    /// unconstrained.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub container_build: Option<String>,
}

/// The engine a comparison stored before engine selection existed held constant:
/// [`NONE_SLUG`](crate::engine::NONE_SLUG), because every run it aggregates was
/// built against no runtime at all. Spelled through the catalogue's own constant so
/// the control and the [record](crate::run_record::RunSubject::engine_slug) it is
/// compared against cannot drift apart.
fn default_engine_slug() -> String {
    crate::engine::NONE_SLUG.to_string()
}

/// One arm of a comparison: **one configuration**, run `N` times. An arm is either
/// a *harness* configuration — a [harness](HarnessSlug) plus the model it runs — or
/// a *gg* configuration — a [gg](crate::gg) capability set plus a model for every
/// [model slot](crate::gg::GgCapabilitySet::model_slots) it leaves deferred. The two
/// shapes sit side by side in the same comparison, which is the point: a gg
/// configuration is compared head-to-head against a third-party harness, and two gg
/// configurations (or the same one on different models) are compared against each
/// other, in one experiment.
///
/// The model is therefore **per arm**, not a global control: a comparison of "Pi on
/// model A vs gg on model B" is a legitimate (if wider) experiment, and any variable
/// that drifts *within* an arm's own runs is still surfaced as a [`Confound`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ComparisonArm {
    /// A stable id for this arm, unique within the comparison.
    pub id: String,
    /// A human label for the arm (defaults to the harness or configuration name).
    pub label: String,
    /// The harness this arm runs, for a harness-configuration arm.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub harness_slug: Option<HarnessSlug>,
    /// The model [`harness_slug`](Self::harness_slug) runs, for a harness-configuration
    /// arm.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub model_id: Option<String>,
    /// The gg [configuration](crate::gg) this arm runs, for a gg-configuration arm —
    /// the launcher's key for it (`builtin:<name>` for a shared built-in,
    /// `saved:<id>` for one registered on the account), so a built-in is as usable
    /// as an account's own.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub gg_config_id: Option<String>,
    /// The model bound to each deferred [model slot](crate::gg::GgModelSlot) the gg
    /// configuration declares, keyed by slot name. A gg configuration can span
    /// several models (one per agent role), so an arm names one per slot rather than
    /// a single [`model_id`](Self::model_id).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub gg_slot_models: BTreeMap<String, String>,
    /// The ids of the runs launched for this arm, in launch order. Aggregation reads
    /// exactly these runs, so an arm's membership is explicit and unambiguous — the
    /// only reliable way to tell two gg arms apart (they can share a root model but
    /// differ in capability set, which no run tuple distinguishes).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub run_ids: Vec<String>,
}

/// The stored configuration of a comparison: its controls, the dimension it varies,
/// its arms, and the desired sample size per arm. Persisted whole as the
/// `comparison.config_json` column.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ComparisonConfig {
    /// The held-constant controls.
    pub controls: ComparisonControls,
    /// The arms — one configuration each — in display order.
    pub arms: Vec<ComparisonArm>,
    /// The desired number of runs per arm. A single run of a harness says almost
    /// nothing because the spread is large, so multiple runs are mandatory; the
    /// operator picks `n`.
    pub n: u32,
}

/// A run's automated-only score point — earned over total, restricted to the
/// machine-checkable checklist points (so a Carom run reads 68/68, not 68/70).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ScorePoint {
    /// The auto-covered weight the run earned.
    pub earned: f64,
    /// The auto-covered weight available — the denominator, restricted to points a
    /// machine can check.
    pub total: u32,
}

/// An arm's automated-only score across its runs. The score is bounded, so it is
/// reported as a mean with **the individual run points shown** — with small `n` the
/// points matter more than any single summary.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ArmScore {
    /// The number of scored runs.
    pub n: usize,
    /// The mean fraction earned (`earned / total`) across the runs, in `[0, 1]`.
    pub mean_fraction: f64,
    /// Each run's own score point, so the raw points are shown, not just the mean.
    pub points: Vec<ScorePoint>,
}

/// The tool-call and token diagnostics that explain *why* one arm costs more than
/// another, summed across the arm's runs. Ratios (cache-hit, reasoning share) are
/// left to the view to derive from these raw classes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ArmDiagnostics {
    /// The four normalized token classes summed across the arm's runs.
    pub tokens: TokenCounts,
    /// Tool-call counts by lowercased raw tool name, summed across the arm's runs —
    /// including consumed todo tools (see [`crate::run_record::RunRecord::tool_calls`]),
    /// which a count off the event stream alone would miss.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub tool_calls: BTreeMap<String, u64>,
}

/// A control that slipped: two of an arm's runs disagreed on a variable that was
/// meant to be held constant. Surfaced so a comparison whose arms are not truly
/// comparable reads as compromised rather than quietly folding the runs together.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct Confound {
    /// The control that drifted (e.g. `auth_mode`, `orchestrator`, `engine`,
    /// `model`).
    pub variable: String,
    /// The distinct values observed across the arm's runs.
    pub values: Vec<String>,
}

/// One arm's computed outcome: its runs, their distributions, diagnostics, and any
/// confounds. Every summary is `Option` because an arm may have no runs yet (the
/// view shows "no runs" rather than a fabricated zero).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ComparisonArmResult {
    /// The arm this result is for (carries its identity and run ids).
    pub arm: ComparisonArm,
    /// The desired sample size (from [`ComparisonConfig::n`]), echoed for display.
    pub n_desired: u32,
    /// The number of runs actually observed for this arm.
    pub n_observed: usize,
    /// The comparable-cost (USD) distribution across the arm's runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub cost: Option<MetricSummary>,
    /// The total-token distribution across the arm's runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub tokens: Option<MetricSummary>,
    /// The automated-only score across the arm's runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub score: Option<ArmScore>,
    /// The pass rate (all covered validators passed) with its Wilson interval.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub pass_rate: Option<PassRate>,
    /// The token/tool-call diagnostics summed across the arm's runs.
    pub diagnostics: ArmDiagnostics,
    /// Any controls that drifted across the arm's runs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub confounds: Vec<Confound>,
}

/// The full read model of a comparison: its identity and stored config, plus the
/// computed per-arm results. Folded into the public snapshot when published.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct Comparison {
    /// The comparison's stable id.
    pub id: String,
    /// The owning account's id.
    pub user_id: String,
    /// The comparison's name.
    pub name: String,
    /// A description of what is being compared and why.
    pub description: String,
    /// Whether the comparison has been published to the public site.
    pub published: bool,
    /// When it was published, if it has been.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub published_at: Option<String>,
    /// When it was created (RFC 3339).
    pub created_at: String,
    /// When it was last updated (RFC 3339).
    pub updated_at: String,
    /// The stored controls, varied dimension, arms, and `N`.
    pub config: ComparisonConfig,
    /// The computed per-arm results, in the config's arm order.
    pub arms: Vec<ComparisonArmResult>,
}

/// A run's **automated-only** score: `score_checklist` restricted to the checklist
/// points a machine actually checked, so both numerator and denominator drop the
/// human-only points. A Carom run whose 68 automated points all pass reads **68/68**
/// (not 68/70) — full marks on everything a machine can verify, the human-only points
/// excluded rather than failed.
///
/// `items` must already be the run's **effective** review items (common + variant,
/// with errata score-exclusions applied), exactly as the human scorer receives them.
/// The auto-covered set is read off the per-run `debug_scripts` — never off the case's
/// declared items — because the item-level "is automated" flag is not serialized onto
/// the record.
///
/// Coverage rules, mirroring the reviewer UI's `autoVerdictMap` plus the
/// [`gates`](crate::validation::DebugScriptResult::gates)/[`ran`](crate::validation::DebugScriptResult::ran)
/// semantics:
/// - A script with decided [verdicts](crate::validation::AutoVerdict) contributes each
///   as a synthetic [`ReviewVerdict`] (`pass` → `Pass`, else `Fail`) and covers its id.
/// - A script that suffered a contract failure ([`ran`](crate::validation::DebugScriptResult::ran)
///   `== false`) with no decided verdict still **fails** its backing point, so a `Fail`
///   is synthesized for its verdict id and the point is covered.
/// - A script whose [precondition went unmet](crate::validation::DebugScriptResult::precondition_unmet)
///   is inconclusive: it is skipped entirely and contributes to neither the numerator
///   nor the denominator (the point is left for a human).
pub fn automated_only_score(items: &[ReviewItem], debug_scripts: &[DebugScriptResult]) -> Score {
    let mut covered: BTreeSet<String> = BTreeSet::new();
    let mut verdicts: Vec<ReviewVerdict> = Vec::new();
    for script in debug_scripts {
        // An unmet precondition is inconclusive about the model — leave the point for
        // a human and count it toward neither side.
        if script.precondition_unmet {
            continue;
        }
        if script.verdicts.is_empty() {
            // No decided verdict. A contract failure still fails the point it backs;
            // a clean run that simply emitted no verdict decides nothing, so skip it.
            if !script.ran {
                let id = verdict_id_of(script);
                covered.insert(id.clone());
                verdicts.push(fail(id));
            }
            continue;
        }
        for v in &script.verdicts {
            covered.insert(v.id.clone());
            verdicts.push(ReviewVerdict {
                id: v.id.clone(),
                status: if v.pass {
                    VerdictStatus::Pass
                } else {
                    VerdictStatus::Fail
                },
                note: None,
            });
        }
    }
    let restricted = restrict_items_to_covered(items, &covered);
    score_checklist(&restricted, &verdicts)
}

/// The verdict id a debug-script result backs: `<item>.<sub>` for a per-sub-item
/// driver, else the item id.
fn verdict_id_of(script: &DebugScriptResult) -> String {
    match &script.sub_item_id {
        Some(sub) => ReviewItem::sub_item_verdict_id(&script.item_id, sub),
        None => script.item_id.clone(),
    }
}

/// A synthesized failing verdict for `id`.
fn fail(id: String) -> ReviewVerdict {
    ReviewVerdict {
        id,
        status: VerdictStatus::Fail,
        note: None,
    }
}

/// Restrict `items` to only the checklist points in `covered`, so the score's
/// denominator is exactly the auto-checkable weight. A binary or graded item is kept
/// iff its own id is covered; a category keeps only its covered sub-items and is
/// dropped entirely when none are covered. Mirrors how [`score_checklist`] branches
/// (graded first, then whole-item, then per-sub-item) so the restriction lines up
/// with how the score is computed.
fn restrict_items_to_covered(items: &[ReviewItem], covered: &BTreeSet<String>) -> Vec<ReviewItem> {
    let mut out = Vec::new();
    for item in items {
        if item.graded || item.sub_items.is_empty() {
            if covered.contains(&item.id) {
                out.push(item.clone());
            }
        } else {
            let subs: Vec<_> = item
                .sub_items
                .iter()
                .filter(|sub| covered.contains(&ReviewItem::sub_item_verdict_id(&item.id, &sub.id)))
                .cloned()
                .collect();
            if !subs.is_empty() {
                let mut kept = item.clone();
                kept.sub_items = subs;
                out.push(kept);
            }
        }
    }
    out
}

#[cfg(test)]
#[path = "comparison.test.rs"]
mod tests;
