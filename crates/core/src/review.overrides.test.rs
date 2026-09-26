//! Tests for reviewer overrides on a validator-rated run: the effective
//! checklist ([`effective_verdicts`]), the per-review figures that fold a
//! review's overrides into the validators' verdicts, and the run-level
//! aggregation across reviews (whose fixed point — no reviews, or reviews with
//! no overrides — reproduces the validators' own figures exactly).

use super::*;
use crate::test_case::{Domain, ReviewItem, SubReviewItem};
use crate::validation::{AutoVerdict, DebugScriptResult, Inconclusive};

/// A scoring domain with the given id.
fn domain(id: &str) -> Domain {
    Domain {
        id: id.to_string(),
        name: id.to_string(),
        description: format!("The {id} mode."),
    }
}

/// A validator-rated whole-item point worth 1: scored, with a cap and domains.
fn capped_item(id: &str, cap: FailureCap, domains: &[&str]) -> ReviewItem {
    ReviewItem {
        failure_cap: Some(cap),
        domains: domains.iter().map(|d| d.to_string()).collect(),
        validation: None,
        id: id.to_string(),
        title: id.to_string(),
        text: format!("Check {id}."),
        reference: None,
        proof: None,
        sequences: Vec::new(),
        frames: Vec::new(),
        weight: 1,
        graded: false,
        domain: None,
        sub_items: Vec::new(),
        scored: true,
    }
}

/// A validator-rated category whose points each carry `(id, cap, domains)`.
fn capped_category(id: &str, points: &[(&str, FailureCap, &[&str])]) -> ReviewItem {
    ReviewItem {
        sub_items: points
            .iter()
            .map(|(sub_id, cap, domains)| SubReviewItem {
                id: sub_id.to_string(),
                title: sub_id.to_string(),
                description: None,
                weight: 1,
                reference: None,
                proof: None,
                scored: true,
                validation: None,
                failure_cap: Some(*cap),
                domains: domains.iter().map(|d| d.to_string()).collect(),
            })
            .collect(),
        weight: points.len() as u32,
        ..capped_item(id, FailureCap::Broken, &[])
    }
}

/// A debug-script result that decided `id` under `item`, passing or failing.
fn decided(item: &str, id: &str, pass: bool) -> DebugScriptResult {
    DebugScriptResult {
        item_id: item.into(),
        sub_item_id: id.strip_prefix(&format!("{item}.")).map(Into::into),
        title: String::new(),
        category_title: String::new(),
        script: String::new(),
        gates: true,
        ran: true,
        precondition_unmet: false,
        inconclusive: None,
        detail: None,
        verdicts: vec![AutoVerdict {
            id: id.into(),
            pass,
            assertions: vec![],
        }],
        outputs: vec![],
    }
}

/// A debug-script result recorded inconclusive (`precondition_unmet`): the
/// validators leave the point undecided.
fn inconclusive(item: &str) -> DebugScriptResult {
    DebugScriptResult {
        ran: false,
        precondition_unmet: true,
        inconclusive: Some(Inconclusive::PreconditionUnmet),
        verdicts: vec![],
        ..decided(item, item, true)
    }
}

/// A reviewer's pass verdict for the checklist id.
fn pass(id: &str) -> ReviewVerdict {
    ReviewVerdict {
        id: id.to_string(),
        status: VerdictStatus::Pass,
        note: None,
    }
}

/// A reviewer's fail verdict for the checklist id.
fn fail(id: &str) -> ReviewVerdict {
    ReviewVerdict {
        id: id.to_string(),
        status: VerdictStatus::Fail,
        note: None,
    }
}

#[test]
fn effective_verdicts_overlay_the_reviewers_overrides_per_id() {
    let auto = [pass("a"), fail("b"), pass("c")];
    // `b` is overridden to pass (with a note), `d` — a point the validators left
    // undecided — is decided by the reviewer; `a` and `c` are untouched.
    let overrides = [
        ReviewVerdict {
            id: "b".to_string(),
            status: VerdictStatus::Pass,
            note: Some("works when driven by hand".to_string()),
        },
        fail("d"),
    ];
    let effective = effective_verdicts(&auto, &overrides);
    assert_eq!(
        effective.iter().map(|v| v.id.as_str()).collect::<Vec<_>>(),
        vec!["a", "b", "c", "d"],
        "the validators' order holds, reviewer-only points append"
    );
    assert_eq!(effective[0].status, VerdictStatus::Pass);
    assert_eq!(effective[1].status, VerdictStatus::Pass);
    assert_eq!(
        effective[1].note.as_deref(),
        Some("works when driven by hand"),
        "the override replaces the verdict wholesale, note included"
    );
    assert_eq!(effective[3].status, VerdictStatus::Fail);
}

#[test]
fn effective_verdicts_with_no_overrides_are_exactly_the_validators() {
    let auto = [pass("a"), fail("b")];
    assert_eq!(effective_verdicts(&auto, &[]), auto.to_vec());
}

#[test]
fn an_override_raises_the_reviews_rating_and_score() {
    // `serve` (broken cap) failed under the validators; the reviewer overrides it
    // to pass, which recomputes both figures.
    let domains = [domain("gameplay")];
    let items = [capped_category(
        "gameplay",
        &[
            ("serve", FailureCap::Broken, &["gameplay"]),
            ("hud", FailureCap::Great, &["gameplay"]),
        ],
    )];
    let scripts = [
        decided("gameplay", "gameplay.serve", false),
        decided("gameplay", "gameplay.hud", true),
    ];
    let auto = crate::comparison::automated_verdicts(&scripts);
    assert_eq!(
        validator_rating(false, &validator_domain_ratings(&domains, &items, &scripts)),
        Some(Rating::Broken)
    );

    let overrides = [pass("gameplay.serve")];
    assert_eq!(
        validator_review_rating(false, &domains, &items, &auto, &overrides),
        Some(Rating::Flawless)
    );
    let score = validator_review_score(false, &items, &auto, &overrides);
    assert_eq!(score.total, 2);
    assert!((score.earned - 2.0).abs() < f64::EPSILON);
}

#[test]
fn an_override_can_also_lower_the_reviews_figures() {
    let domains = [domain("gameplay")];
    let items = [
        capped_item("serve", FailureCap::Scuffed, &["gameplay"]),
        capped_item("hud", FailureCap::Great, &["gameplay"]),
    ];
    let scripts = [decided("serve", "serve", true), decided("hud", "hud", true)];
    let auto = crate::comparison::automated_verdicts(&scripts);

    let overrides = [fail("serve")];
    assert_eq!(
        validator_review_rating(false, &domains, &items, &auto, &overrides),
        Some(Rating::Scuffed)
    );
    let score = validator_review_score(false, &items, &auto, &overrides);
    assert_eq!(score.total, 2);
    assert!((score.earned - 1.0).abs() < f64::EPSILON);
}

#[test]
fn a_reviewer_deciding_an_undecided_point_grows_the_denominator() {
    // The validators covered only `hud` (`serve`'s precondition was unmet), so
    // their score reads over 1 point. A reviewer deciding `serve` covers it:
    // both sides of that review's ratio now include the point.
    let items = [
        capped_item("serve", FailureCap::Broken, &["gameplay"]),
        capped_item("hud", FailureCap::Great, &["gameplay"]),
    ];
    let scripts = [inconclusive("serve"), decided("hud", "hud", true)];
    let auto = crate::comparison::automated_verdicts(&scripts);
    let untouched = validator_review_score(false, &items, &auto, &[]);
    assert_eq!(untouched.total, 1);

    let score = validator_review_score(false, &items, &auto, &[pass("serve")]);
    assert_eq!(score.total, 2);
    assert!((score.earned - 2.0).abs() < f64::EPSILON);
}

#[test]
fn an_erratum_excluded_point_counts_toward_neither_side_even_when_overridden() {
    let mut excluded = capped_item("serve", FailureCap::Broken, &["gameplay"]);
    excluded.scored = false;
    let items = [
        excluded,
        capped_item("hud", FailureCap::Great, &["gameplay"]),
    ];
    let scripts = [
        decided("serve", "serve", false),
        decided("hud", "hud", true),
    ];
    let auto = crate::comparison::automated_verdicts(&scripts);
    let score = validator_review_score(false, &items, &auto, &[pass("serve")]);
    assert_eq!(score.total, 1, "the excluded point stays out of the total");
    assert!((score.earned - 1.0).abs() < f64::EPSILON);
}

#[test]
fn zero_reviews_aggregate_to_the_validators_own_figures() {
    let domains = [domain("gameplay")];
    let items = [capped_category(
        "gameplay",
        &[
            ("serve", FailureCap::Broken, &["gameplay"]),
            ("ai", FailureCap::Scuffed, &["gameplay"]),
            ("hud", FailureCap::Great, &["gameplay"]),
        ],
    )];
    let scripts = [
        decided("gameplay", "gameplay.serve", true),
        decided("gameplay", "gameplay.ai", false),
        decided("gameplay", "gameplay.hud", true),
    ];
    let auto = crate::comparison::automated_verdicts(&scripts);
    let none: [&[ReviewVerdict]; 0] = [];

    assert_eq!(
        validator_aggregate_rating(false, &domains, &items, &auto, none),
        validator_rating(false, &validator_domain_ratings(&domains, &items, &scripts))
    );
    assert_eq!(
        validator_aggregate_score(false, &items, &auto, none),
        validator_score(false, &items, &scripts)
    );
    // The gate still applies with no reviews at all.
    assert_eq!(
        validator_aggregate_rating(true, &domains, &items, &auto, none),
        Some(Rating::Broken)
    );
    let gated = validator_aggregate_score(true, &items, &auto, none);
    assert_eq!(gated.earned, 0.0);
    assert_eq!(gated.total, 3);
}

#[test]
fn a_review_with_no_overrides_is_the_aggregations_fixed_point() {
    let domains = [domain("gameplay")];
    let items = [capped_category(
        "gameplay",
        &[
            ("serve", FailureCap::Broken, &["gameplay"]),
            ("ai", FailureCap::Scuffed, &["gameplay"]),
        ],
    )];
    let scripts = [
        decided("gameplay", "gameplay.serve", true),
        decided("gameplay", "gameplay.ai", false),
    ];
    let auto = crate::comparison::automated_verdicts(&scripts);
    let reviews: [&[ReviewVerdict]; 1] = [&[]];

    assert_eq!(
        validator_aggregate_rating(false, &domains, &items, &auto, reviews),
        Some(Rating::Scuffed)
    );
    let score = validator_aggregate_score(false, &items, &auto, reviews);
    assert_eq!(score.reviews, 1);
    assert_eq!(score.total, 2);
    assert!((score.earned - 1.0).abs() < f64::EPSILON);
}

#[test]
fn the_aggregate_takes_the_worst_rating_and_the_average_score_across_reviews() {
    let domains = [domain("gameplay")];
    let items = [capped_category(
        "gameplay",
        &[
            ("serve", FailureCap::Broken, &["gameplay"]),
            ("hud", FailureCap::Great, &["gameplay"]),
        ],
    )];
    let scripts = [
        decided("gameplay", "gameplay.serve", false),
        decided("gameplay", "gameplay.hud", true),
    ];
    let auto = crate::comparison::automated_verdicts(&scripts);
    // One reviewer overrides the failing `serve` to pass (flawless, 2/2); the
    // other leaves the validators' verdicts (broken, 1/2).
    let generous = [pass("gameplay.serve")];
    let reviews: [&[ReviewVerdict]; 2] = [&generous, &[]];

    assert_eq!(
        validator_aggregate_rating(false, &domains, &items, &auto, reviews),
        Some(Rating::Broken),
        "one harsh review cannot be masked by a generous one"
    );
    let score = validator_aggregate_score(false, &items, &auto, reviews);
    assert_eq!(score.reviews, 2);
    assert_eq!(score.total, 2);
    assert!((score.earned - 1.5).abs() < f64::EPSILON);

    // The toolchain gate applies at the aggregation seam.
    assert_eq!(
        validator_aggregate_rating(true, &domains, &items, &auto, reviews),
        Some(Rating::Broken)
    );
    let gated = validator_aggregate_score(true, &items, &auto, reviews);
    assert_eq!(gated.earned, 0.0);
    assert_eq!(gated.total, 2);
    assert_eq!(gated.reviews, 2);
}
