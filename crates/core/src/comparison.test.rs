//! Tests for [`automated_only_score`]: the automated-only score restricts both
//! numerator and denominator to the machine-checked points (68/68, not 68/70),
//! treats a contract failure as a fail, and leaves an unmet precondition to a human.

use super::*;
use crate::test_case::{ReviewItem, SubReviewItem};
use crate::validation::{AutoVerdict, DebugScriptResult, Inconclusive};

/// A binary review item worth `weight`, scored, no sub-items.
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

/// A name-only sub-item worth `weight`, scored.
fn sub(id: &str, weight: u32) -> SubReviewItem {
    SubReviewItem {
        failure_cap: None,
        domains: Vec::new(),
        id: id.into(),
        title: id.into(),
        description: None,
        weight,
        reference: None,
        proof: None,
        scored: true,
        validation: None,
    }
}

/// A debug-script result backing `item_id`(`.sub_item_id`), carrying the given
/// `(verdict id, pass)` decisions, with `ran`/`precondition_unmet` control flags.
fn script(
    item_id: &str,
    sub_item_id: Option<&str>,
    verdicts: &[(&str, bool)],
    ran: bool,
    precondition_unmet: bool,
) -> DebugScriptResult {
    DebugScriptResult {
        item_id: item_id.into(),
        sub_item_id: sub_item_id.map(Into::into),
        title: String::new(),
        category_title: String::new(),
        script: String::new(),
        gates: true,
        ran,
        precondition_unmet,
        inconclusive: precondition_unmet.then_some(Inconclusive::PreconditionUnmet),
        detail: None,
        verdicts: verdicts
            .iter()
            .map(|(id, pass)| AutoVerdict {
                id: (*id).into(),
                pass: *pass,
                assertions: vec![],
            })
            .collect(),
        outputs: vec![],
    }
}

#[test]
fn full_marks_on_covered_points_excludes_the_human_only_ones() {
    // Two auto-covered items (weights 3, 2) both pass; a third human-only item
    // (weight 5) has no script. The denominator is the covered 5, not the full 10 —
    // the human-only point is excluded, not failed (this is the 68/68 behavior).
    let items = [item("a", 3), item("b", 2), item("human", 5)];
    let scripts = [
        script("a", None, &[("a", true)], true, false),
        script("b", None, &[("b", true)], true, false),
    ];
    let score = automated_only_score(&items, &scripts);
    assert_eq!(score.total, 5);
    assert!((score.earned - 5.0).abs() < 1e-9);
}

#[test]
fn a_failed_validator_lowers_the_numerator_not_the_denominator() {
    let items = [item("a", 3), item("b", 2)];
    let scripts = [
        script("a", None, &[("a", true)], true, false),
        script("b", None, &[("b", false)], true, false),
    ];
    let score = automated_only_score(&items, &scripts);
    assert_eq!(score.total, 5);
    assert!((score.earned - 3.0).abs() < 1e-9);
}

#[test]
fn an_unmet_precondition_is_excluded_from_both_sides() {
    // b's script could not arrange its scenario against a conformant build —
    // inconclusive, so b leaves the covered set entirely and only a is scored.
    let items = [item("a", 3), item("b", 2)];
    let scripts = [
        script("a", None, &[("a", true)], true, false),
        script("b", None, &[], false, true),
    ];
    let score = automated_only_score(&items, &scripts);
    assert_eq!(score.total, 3);
    assert!((score.earned - 3.0).abs() < 1e-9);
}

#[test]
fn a_contract_failure_with_no_verdict_fails_its_point() {
    // b's script hit a debug-API contract failure (ran == false, not a
    // precondition) and emitted no verdict — the point is covered and fails.
    let items = [item("a", 3), item("b", 2)];
    let scripts = [
        script("a", None, &[("a", true)], true, false),
        script("b", None, &[], false, false),
    ];
    let score = automated_only_score(&items, &scripts);
    assert_eq!(score.total, 5);
    assert!((score.earned - 3.0).abs() < 1e-9);
}

#[test]
fn a_category_scores_only_its_covered_sub_items() {
    // A category with three sub-items; only two are driven (s1 passes, s2 fails),
    // s3 is human-only. The denominator is s1+s2 (weights 1+2), earned s1 (1).
    let mut cat = item("cat", 4);
    cat.sub_items = vec![sub("s1", 1), sub("s2", 2), sub("s3", 1)];
    let items = [cat];
    let scripts = [
        script("cat", Some("s1"), &[("cat.s1", true)], true, false),
        script("cat", Some("s2"), &[("cat.s2", false)], true, false),
    ];
    let score = automated_only_score(&items, &scripts);
    assert_eq!(score.total, 3);
    assert!((score.earned - 1.0).abs() < 1e-9);
}

#[test]
fn a_score_excluded_erratum_point_counts_toward_neither_side() {
    // b is excluded from scoring for the version (an erratum), so even though its
    // validator passed it contributes nothing — only a's 3 points count.
    let mut excluded = item("b", 2);
    excluded.scored = false;
    let items = [item("a", 3), excluded];
    let scripts = [
        script("a", None, &[("a", true)], true, false),
        script("b", None, &[("b", true)], true, false),
    ];
    let score = automated_only_score(&items, &scripts);
    assert_eq!(score.total, 3);
    assert!((score.earned - 3.0).abs() < 1e-9);
}

#[test]
fn no_debug_scripts_yields_a_zero_of_zero_score() {
    // Nothing auto-covered → nothing in either numerator or denominator.
    let items = [item("a", 3)];
    let score = automated_only_score(&items, &[]);
    assert_eq!(score.total, 0);
    assert!((score.earned - 0.0).abs() < 1e-9);
}

#[test]
fn covered_score_restricts_both_sides_to_the_verdicts_points() {
    // The verdict-slice core: any set of verdicts — a review's effective
    // checklist, say — scores over exactly the points it decides. `a` passes and
    // `b` fails (3 of 5); the undecided `human` point (weight 5) joins neither
    // side, and an unscored (erratum-excluded) decided point joins neither side
    // either.
    let mut excluded = item("errata", 4);
    excluded.scored = false;
    let items = [item("a", 3), item("b", 2), item("human", 5), excluded];
    let verdicts = [
        ReviewVerdict {
            id: "a".to_string(),
            status: VerdictStatus::Pass,
            note: None,
        },
        ReviewVerdict {
            id: "b".to_string(),
            status: VerdictStatus::Fail,
            note: None,
        },
        ReviewVerdict {
            id: "errata".to_string(),
            status: VerdictStatus::Pass,
            note: None,
        },
    ];
    let score = covered_score(&items, &verdicts);
    assert_eq!(score.total, 5);
    assert!((score.earned - 3.0).abs() < 1e-9);
}
