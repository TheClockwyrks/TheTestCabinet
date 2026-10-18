//! The **harness comparison** (A/B) data contract and its automated-only scorer.
//!
//! A comparison runs the same benchmark under several **configurations** — a
//! third-party harness on a model, or a [gg](crate::gg) capability set with a model
//! per slot — holds the case and every other variable constant, and presents the
//! cost, token, session-duration, and score data side by side so a reader can
//! judge for themselves. This module defines the stored [`ComparisonConfig`] (its controls and arms) and
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

use std::collections::BTreeSet;

pub use test_cabinet_contracts::comparison::*;

use crate::review::{ReviewVerdict, Score, VerdictStatus, score_checklist};
use crate::test_case::ReviewItem;
use crate::validation::DebugScriptResult;

/// Whether a comparison is **complete**: it has arms, and every one holds at least `n`
/// counted runs that have landed and none still in flight. A comparison whose case
/// could not be resolved has no arm results and is never complete.
pub fn is_complete(n: u32, arms: &[ComparisonArmResult]) -> bool {
    !arms.is_empty()
        && arms
            .iter()
            .all(|arm| arm.n_observed >= n as usize && arm.live_run_ids.len() == arm.n_observed)
}

/// Decide which recorded run ids each arm of an edited comparison keeps, in place on
/// `incoming` (docs/comparisons/experiments.md, "Editing a comparison").
///
/// `stored` is the configuration being replaced and `stored_complete` whether it was
/// [complete](is_complete). An arm of `incoming` keeps the ids the request carries
/// when the stored arm of the same id has the
/// [same launch identity](ComparisonArm::same_launch_identity); an added arm and a
/// changed arm start empty. A change to the controls empties every arm, and so does
/// adding, removing or changing an arm of a complete comparison. Changing `n`, the
/// name or the description is not a change to any arm.
pub fn carry_run_ids(
    stored: &ComparisonConfig,
    stored_complete: bool,
    incoming: &mut ComparisonConfig,
) {
    let unchanged = |arm: &ComparisonArm| {
        stored
            .arms
            .iter()
            .find(|s| s.id == arm.id)
            .is_some_and(|s| s.same_launch_identity(arm))
    };
    let arms_changed =
        stored.arms.len() != incoming.arms.len() || incoming.arms.iter().any(|arm| !unchanged(arm));
    let reset_all = stored.controls != incoming.controls || (stored_complete && arms_changed);
    for arm in &mut incoming.arms {
        if reset_all || !unchanged(arm) {
            arm.run_ids.clear();
        }
    }
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
/// - A script recorded [inconclusive](crate::validation::DebugScriptResult::precondition_unmet)
///   — an unmet precondition, or a check the host could not execute — is skipped
///   entirely and contributes to neither the numerator nor the denominator (the point
///   is left for a human).
pub fn automated_only_score(items: &[ReviewItem], debug_scripts: &[DebugScriptResult]) -> Score {
    covered_score(items, &automated_verdicts(debug_scripts))
}

/// Score a slice of `verdicts` over `items`, restricting **both** numerator and
/// denominator to the points the verdicts actually decide: the covered set is
/// exactly the verdict ids, an undecided point is excluded rather than failed,
/// and an erratum-excluded point (`scored == false`) counts toward neither side.
///
/// The verdict-slice core of [`automated_only_score`], generalized so a review's
/// [effective checklist](crate::review::effective_verdicts) — the validators'
/// verdicts overlaid with the reviewer's overrides — scores through the identical
/// rule (see [`crate::review::validator_review_score`]). Mirrors `coveredScore`
/// in `packages/run-stats/src/scoring.ts`.
pub fn covered_score(items: &[ReviewItem], verdicts: &[ReviewVerdict]) -> Score {
    let covered: BTreeSet<String> = verdicts.iter().map(|v| v.id.clone()).collect();
    let restricted = restrict_items_to_covered(items, &covered);
    score_checklist(&restricted, verdicts)
}

/// The verdicts a run's validators decided, synthesized as [`ReviewVerdict`]s —
/// the **failure semantics** shared by [`automated_only_score`] and the
/// [validator-decided functional rating](crate::review::validator_domain_ratings):
/// - A script with decided [verdicts](crate::validation::AutoVerdict) contributes
///   each (`pass` → [`Pass`](VerdictStatus::Pass), else [`Fail`](VerdictStatus::Fail)).
/// - A script that suffered a contract failure ([`ran`](DebugScriptResult::ran)
///   `== false`) with no decided verdict **fails** the point it backs.
/// - A script recorded [inconclusive](DebugScriptResult::precondition_unmet) is
///   skipped entirely, as is a clean run that emitted no verdict.
///
/// The ids of the returned verdicts are exactly the auto-covered points.
pub fn automated_verdicts(debug_scripts: &[DebugScriptResult]) -> Vec<ReviewVerdict> {
    let mut verdicts: Vec<ReviewVerdict> = Vec::new();
    for script in debug_scripts {
        // An inconclusive check says nothing about the model — leave the point for a
        // human and count it toward neither side.
        if script.precondition_unmet {
            continue;
        }
        if script.verdicts.is_empty() {
            // No decided verdict. A contract failure still fails the point it backs;
            // a clean run that simply emitted no verdict decides nothing, so skip it.
            if !script.ran {
                verdicts.push(fail(verdict_id_of(script)));
            }
            continue;
        }
        for v in &script.verdicts {
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
    verdicts
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

#[cfg(test)]
#[path = "comparison.editing.test.rs"]
mod editing_tests;
