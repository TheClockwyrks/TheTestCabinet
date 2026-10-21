//! Tests for parsing a run's `writeup.md` into per-domain ratings and a body,
//! rendering the canonical file back out, and scoring a run.

use super::*;
use test_cabinet_contracts::test_case::{Domain, ReviewItem, SubReviewItem};

/// A review item with the given id and weight, in no domain — the common shape
/// for these tests.
fn item(id: &str, weight: u32) -> ReviewItem {
    ReviewItem {
        failure_cap: None,
        domains: Vec::new(),
        validation: None,
        id: id.to_string(),
        title: id.to_string(),
        text: format!("Check {id}."),
        reference: None,
        proof: None,
        sequences: Vec::new(),
        frames: Vec::new(),
        weight,
        graded: false,
        domain: None,
        sub_items: Vec::new(),
        scored: true,
    }
}

/// A game-jam category: a graded review item with the given id and weight.
fn graded_item(id: &str, weight: u32) -> ReviewItem {
    ReviewItem {
        failure_cap: None,
        domains: Vec::new(),
        validation: None,
        graded: true,
        ..item(id, weight)
    }
}

/// A graded verdict for the checklist id.
fn grade(id: &str, status: VerdictStatus) -> ReviewVerdict {
    ReviewVerdict {
        id: id.to_string(),
        status,
        note: None,
    }
}

/// A review item graded by sub-items — a category of review items. Each named
/// sub-item is worth one point, and the category's weight is their count (the sum
/// of their weights).
fn item_with_sub_items(id: &str, sub_ids: &[&str]) -> ReviewItem {
    ReviewItem {
        failure_cap: None,
        domains: Vec::new(),
        validation: None,
        sub_items: sub_ids
            .iter()
            .map(|sub_id| SubReviewItem {
                failure_cap: None,
                domains: Vec::new(),
                id: sub_id.to_string(),
                title: sub_id.to_string(),
                description: None,
                weight: 1,
                reference: None,
                proof: None,
                scored: true,
                validation: None,
            })
            .collect(),
        ..item(id, sub_ids.len() as u32)
    }
}

/// A pass verdict for the checklist id (an item id, or a `<item>.<sub>` composite).
fn pass(id: &str) -> ReviewVerdict {
    ReviewVerdict {
        id: id.to_string(),
        status: VerdictStatus::Pass,
        note: None,
    }
}

/// A fail verdict for the checklist id.
fn fail(id: &str) -> ReviewVerdict {
    ReviewVerdict {
        id: id.to_string(),
        status: VerdictStatus::Fail,
        note: None,
    }
}

#[test]
fn every_tier_round_trips_through_its_token() {
    for rating in Rating::ALL {
        assert_eq!(Rating::parse(rating.as_str()), Some(rating));
    }
}

#[test]
fn passable_ranks_between_great_and_scuffed() {
    assert!(Rating::Great.rank() < Rating::Passable.rank());
    assert!(Rating::Passable.rank() < Rating::Scuffed.rank());
    // The worst across a mix leads with the lower tier, so a passable domain
    // pulls a great one down but is itself masked by a scuffed one.
    assert_eq!(
        Rating::worst([Rating::Great, Rating::Passable]),
        Some(Rating::Passable)
    );
    assert_eq!(
        Rating::worst([Rating::Passable, Rating::Scuffed]),
        Some(Rating::Scuffed)
    );
}

#[test]
fn missing_verdicts_reports_unaddressed_items() {
    let items = vec![item("ball-spin", 1), item("bank-shot", 1)];
    let writeup = Writeup {
        aesthetic: None,
        ratings: vec![DomainRating {
            domain: "gameplay".to_string(),
            rating: Rating::Great,
        }],
        body: "Body.".to_string(),
        checklist: vec![ReviewVerdict {
            id: "ball-spin".to_string(),
            status: VerdictStatus::Pass,
            note: None,
        }],
    };
    assert_eq!(
        missing_verdicts(&items, &writeup),
        vec!["bank-shot".to_string()]
    );

    // Once every item has a verdict, nothing is missing — a stale extra verdict
    // for an unknown id does not change that.
    let complete = Writeup {
        aesthetic: None,
        checklist: vec![
            ReviewVerdict {
                id: "ball-spin".to_string(),
                status: VerdictStatus::Pass,
                note: None,
            },
            ReviewVerdict {
                id: "bank-shot".to_string(),
                status: VerdictStatus::Fail,
                note: None,
            },
            ReviewVerdict {
                id: "stale".to_string(),
                status: VerdictStatus::Pass,
                note: None,
            },
        ],
        ..writeup
    };
    assert!(missing_verdicts(&items, &complete).is_empty());
}

#[test]
fn missing_ratings_reports_unrated_domains() {
    let domains = vec![
        Domain {
            id: "single-player".to_string(),
            name: "Single Player".to_string(),
            description: "Solo play.".to_string(),
        },
        Domain {
            id: "versus".to_string(),
            name: "Versus".to_string(),
            description: "Two-player play.".to_string(),
        },
    ];
    let writeup = Writeup {
        aesthetic: None,
        ratings: vec![DomainRating {
            domain: "single-player".to_string(),
            rating: Rating::Great,
        }],
        body: "Body.".to_string(),
        checklist: vec![],
    };
    assert_eq!(
        missing_ratings(&domains, &writeup),
        vec!["versus".to_string()]
    );
}

#[test]
fn score_sums_the_weight_of_passed_items() {
    let items = vec![item("a", 2), item("b", 3), item("c", 1)];
    let writeup = Writeup {
        aesthetic: None,
        ratings: vec![DomainRating {
            domain: "gameplay".to_string(),
            rating: Rating::Great,
        }],
        body: "Body.".to_string(),
        checklist: vec![
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
                id: "c".to_string(),
                status: VerdictStatus::Pass,
                note: None,
            },
        ],
    };
    // a (2) and c (1) pass; b (3) fails. Earned 3 of 6 total.
    assert_eq!(
        score(&items, &writeup),
        Score {
            earned: 3.0,
            total: 6
        }
    );
}

#[test]
fn score_credits_each_passed_sub_item_by_its_weight() {
    // One plain item (weight 2) and one category of two sub-items (each worth 1,
    // so the category totals 2). The plain item passes; of the category's two
    // sub-items, one passes and one fails.
    let items = vec![
        item("plain", 2),
        item_with_sub_items("spin", &["stationary", "moving"]),
    ];
    let checklist = vec![pass("plain"), pass("spin.stationary"), fail("spin.moving")];
    // plain earns 2; spin earns stationary's 1 of its 2. Total is 2 + 2 = 4.
    let scored = score_checklist(&items, &checklist);
    assert_eq!(scored.total, 4);
    assert!((scored.earned - 3.0).abs() < f64::EPSILON);
}

#[test]
fn score_of_a_category_sums_its_passed_sub_item_weights() {
    let items = vec![item_with_sub_items("q", &["a", "b", "c"])];
    // All three sub-items pass: the category earns its whole weight (3).
    let all = score_checklist(&items, &[pass("q.a"), pass("q.b"), pass("q.c")]);
    assert!((all.earned - 3.0).abs() < f64::EPSILON);
    // None pass: the category earns nothing.
    let none = score_checklist(&items, &[fail("q.a"), fail("q.b"), fail("q.c")]);
    assert_eq!(none.earned, 0.0);
    // One of three passes: one point of the three.
    let some = score_checklist(&items, &[pass("q.a"), fail("q.b"), fail("q.c")]);
    assert!((some.earned - 1.0).abs() < f64::EPSILON);
    assert_eq!(some.total, 3);
}

#[test]
fn an_item_excluded_from_scoring_drops_out_of_both_earned_and_total() {
    // A whole item marked non-scoring (an erratum's `exclude_from_score`, applied via
    // `apply_score_exclusions`) contributes to neither side of the ratio — even when
    // the reviewer passed it — so a run collected before the exclusion re-scores as if
    // the point were never declared.
    let mut items = vec![item("a", 2), item("b", 3), item("c", 1)];
    test_cabinet_contracts::test_case::apply_score_exclusions(
        &mut items,
        &std::collections::HashSet::from(["b".to_string()]),
    );
    // `a` and `c` both pass; `b` (excluded) passes too but must not count.
    let scored = score_checklist(&items, &[pass("a"), pass("b"), pass("c")]);
    assert_eq!(scored.total, 3);
    assert!((scored.earned - 3.0).abs() < f64::EPSILON);
}

#[test]
fn a_sub_item_excluded_from_scoring_drops_out_while_the_rest_of_the_category_scores() {
    // Excluding one sub-item of a category by its composite `<item>.<sub>` id removes
    // only that point; the category's other sub-items still score normally.
    let mut items = vec![item_with_sub_items("cat", &["x", "y", "z"])];
    test_cabinet_contracts::test_case::apply_score_exclusions(
        &mut items,
        &std::collections::HashSet::from(["cat.y".to_string()]),
    );
    // x passes, z fails; y (excluded) passes but must not count. Total is x + z = 2.
    let scored = score_checklist(&items, &[pass("cat.x"), pass("cat.y"), fail("cat.z")]);
    assert_eq!(scored.total, 2);
    assert!((scored.earned - 1.0).abs() < f64::EPSILON);
}

#[test]
fn excluding_a_whole_category_by_its_item_id_drops_every_sub_item() {
    // An exclusion naming the category's own id removes the entire category — all its
    // sub-items — from the score, not just a single point.
    let mut items = vec![item("plain", 2), item_with_sub_items("cat", &["x", "y"])];
    test_cabinet_contracts::test_case::apply_score_exclusions(
        &mut items,
        &std::collections::HashSet::from(["cat".to_string()]),
    );
    let scored = score_checklist(&items, &[pass("plain"), pass("cat.x"), pass("cat.y")]);
    // Only `plain` (weight 2) remains; the whole `cat` category is excluded.
    assert_eq!(scored.total, 2);
    assert!((scored.earned - 2.0).abs() < f64::EPSILON);
}

#[test]
fn diff_reviews_captures_rating_verdict_and_writeup_changes() {
    let prior_ratings = vec![DomainRating {
        domain: "gameplay".to_string(),
        rating: Rating::Great,
    }];
    let prior_checklist = vec![pass("a"), fail("b")];
    let next_ratings = vec![DomainRating {
        domain: "gameplay".to_string(),
        rating: Rating::Scuffed,
    }];
    // `a` flips to fail; `b`'s status holds but its note changes; `c` is newly added.
    let next_checklist = vec![
        fail("a"),
        ReviewVerdict {
            id: "b".to_string(),
            status: VerdictStatus::Fail,
            note: Some("still broken, now with detail".to_string()),
        },
        pass("c"),
    ];
    let diff = diff_reviews(
        ReviewContent {
            ratings: &prior_ratings,
            aesthetic: None,
            writeup: "Old body.",
            checklist: &prior_checklist,
        },
        ReviewContent {
            ratings: &next_ratings,
            aesthetic: None,
            writeup: "New body.",
            checklist: &next_checklist,
        },
    );

    assert_eq!(diff.ratings.len(), 1);
    assert_eq!(diff.ratings[0].domain, "gameplay");
    assert_eq!(diff.ratings[0].from, Some(Rating::Great));
    assert_eq!(diff.ratings[0].to, Some(Rating::Scuffed));

    // `a` (status flip), `b` (note-only change), `c` (added) — in the new order.
    assert_eq!(
        diff.verdicts
            .iter()
            .map(|v| v.id.as_str())
            .collect::<Vec<_>>(),
        vec!["a", "b", "c"]
    );
    let b = diff.verdicts.iter().find(|v| v.id == "b").unwrap();
    assert!(b.note_changed);
    assert_eq!(b.from, Some(VerdictStatus::Fail));
    assert_eq!(b.to, Some(VerdictStatus::Fail));
    let c = diff.verdicts.iter().find(|v| v.id == "c").unwrap();
    assert_eq!(c.from, None);
    assert_eq!(c.to, Some(VerdictStatus::Pass));

    let writeup = diff.writeup.as_ref().unwrap();
    assert_eq!(writeup.from, "Old body.");
    assert_eq!(writeup.to, "New body.");
    assert!(!diff.is_empty());
}

#[test]
fn diff_reviews_records_removals_and_is_empty_when_unchanged() {
    let ratings = vec![DomainRating {
        domain: "gameplay".to_string(),
        rating: Rating::Great,
    }];
    let checklist = vec![pass("a"), pass("b")];

    // An identical review diffs to nothing.
    let content = ReviewContent {
        ratings: &ratings,
        aesthetic: None,
        writeup: "Body.",
        checklist: &checklist,
    };
    let unchanged = diff_reviews(content, content);
    assert!(unchanged.is_empty());

    // Dropping the `b` verdict records it as a removal (`to = None`).
    let removed = diff_reviews(
        content,
        ReviewContent {
            checklist: &[pass("a")],
            ..content
        },
    );
    assert_eq!(removed.verdicts.len(), 1);
    assert_eq!(removed.verdicts[0].id, "b");
    assert_eq!(removed.verdicts[0].from, Some(VerdictStatus::Pass));
    assert_eq!(removed.verdicts[0].to, None);
}

#[test]
fn missing_verdicts_requires_every_sub_item_of_a_sub_itemed_item() {
    let items = vec![
        item("plain", 1),
        item_with_sub_items("spin", &["stationary", "moving"]),
    ];
    let writeup = Writeup {
        aesthetic: None,
        ratings: vec![DomainRating {
            domain: "gameplay".to_string(),
            rating: Rating::Great,
        }],
        body: "Body.".to_string(),
        // The plain item and one of the two sub-items are addressed; the other
        // sub-item ("spin.moving") is not, and a verdict on the parent id "spin"
        // does not count for it.
        checklist: vec![pass("plain"), pass("spin.stationary"), pass("spin")],
    };
    assert_eq!(
        missing_verdicts(&items, &writeup),
        vec!["spin.moving".to_string()]
    );
}

#[test]
fn aggregate_score_averages_earned_over_the_shared_total() {
    // Two reviewers scored the same 6-point checklist: one earned 6, one earned 3.
    let scores = [
        Score {
            earned: 6.0,
            total: 6,
        },
        Score {
            earned: 3.0,
            total: 6,
        },
    ];
    let aggregate = aggregate_score(&scores).expect("two reviews aggregate");
    assert_eq!(aggregate.total, 6);
    assert_eq!(aggregate.reviews, 2);
    assert!((aggregate.earned - 4.5).abs() < f64::EPSILON);
}

#[test]
fn aggregate_score_is_none_without_reviews() {
    assert!(aggregate_score(&[]).is_none());
}

#[test]
fn aggregate_rating_is_the_worst_across_every_review_and_domain() {
    // One generous review (all flawless) and one harsh review (one broken domain):
    // the aggregate is the worst any reviewer gave any domain.
    let generous = vec![
        DomainRating {
            domain: "single-player".to_string(),
            rating: Rating::Flawless,
        },
        DomainRating {
            domain: "versus".to_string(),
            rating: Rating::Flawless,
        },
    ];
    let harsh = vec![
        DomainRating {
            domain: "single-player".to_string(),
            rating: Rating::Great,
        },
        DomainRating {
            domain: "versus".to_string(),
            rating: Rating::Broken,
        },
    ];
    let reviews = [generous.as_slice(), harsh.as_slice()];
    assert_eq!(
        aggregate_rating(reviews.iter().copied()),
        Some(Rating::Broken)
    );
}

#[test]
fn aggregate_rating_is_none_without_ratings() {
    let empty: [&[DomainRating]; 0] = [];
    assert_eq!(aggregate_rating(empty), None);
}

#[test]
fn graded_item_scores_by_tier_points_times_weight() {
    // A graded item is worth `weight × 10`; it earns the tier's points × weight.
    let items = [graded_item("fun", 1), graded_item("theme", 2)];
    let checklist = [
        grade("fun", VerdictStatus::Great),        // 8 × 1 = 8, of 10
        grade("theme", VerdictStatus::Incredible), // 10 × 2 = 20, of 20
    ];
    let score = score_checklist(&items, &checklist);
    assert_eq!(score.total, 30);
    assert_eq!(score.earned, 28.0);
}

#[test]
fn graded_item_unjudged_earns_nothing_but_counts_its_max() {
    let items = [graded_item("fun", 1)];
    let score = score_checklist(&items, &[]);
    assert_eq!(score.total, 10);
    assert_eq!(score.earned, 0.0);
}

#[test]
fn broken_grade_earns_zero() {
    let items = [graded_item("fun", 1)];
    let score = score_checklist(&items, &[grade("fun", VerdictStatus::Broken)]);
    assert_eq!(score.total, 10);
    assert_eq!(score.earned, 0.0);
}

#[test]
fn grade_points_match_the_five_tiers() {
    assert_eq!(VerdictStatus::Broken.grade_points(), Some(0));
    assert_eq!(VerdictStatus::Poor.grade_points(), Some(2));
    assert_eq!(VerdictStatus::Neutral.grade_points(), Some(5));
    assert_eq!(VerdictStatus::Great.grade_points(), Some(8));
    assert_eq!(VerdictStatus::Incredible.grade_points(), Some(10));
    assert_eq!(VerdictStatus::Pass.grade_points(), None);
    assert_eq!(VerdictStatus::Fail.grade_points(), None);
}

#[test]
fn aggregate_overall_grade_is_the_worst_across_reviews() {
    let generous = [grade(OVERALL_VERDICT_ID, VerdictStatus::Incredible)];
    let harsh = [grade(OVERALL_VERDICT_ID, VerdictStatus::Neutral)];
    let reviews = [generous.as_slice(), harsh.as_slice()];
    assert_eq!(
        aggregate_overall_grade(reviews.iter().copied()),
        Some(VerdictStatus::Neutral)
    );
    let none: [&[ReviewVerdict]; 0] = [];
    assert_eq!(aggregate_overall_grade(none), None);
}

// --- the aesthetic channel and the validator-decided functional rating ---------

use test_cabinet_contracts::validation::{AutoVerdict, DebugScriptResult, Inconclusive};

/// A scoring domain with the given id.
fn domain(id: &str) -> Domain {
    Domain {
        id: id.to_string(),
        name: id.to_string(),
        description: format!("The {id} mode."),
    }
}

/// A validator-rated whole-item point: scored, validated, with a cap and domains.
fn capped_item(id: &str, cap: FailureCap, domains: &[&str]) -> ReviewItem {
    ReviewItem {
        failure_cap: Some(cap),
        domains: domains.iter().map(|d| d.to_string()).collect(),
        ..item(id, 1)
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
        ..item(id, points.len() as u32)
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

/// A decided verdict for `id` under item `item`, passing or failing.
fn decided(item: &str, id: &str, pass: bool) -> DebugScriptResult {
    let sub = id.strip_prefix(&format!("{item}."));
    script(item, sub, &[(id, pass)], true, false)
}

#[test]
fn every_aesthetic_tier_round_trips_through_its_token() {
    for rating in AestheticRating::ALL {
        assert_eq!(AestheticRating::parse(rating.as_str()), Some(rating));
        let json = serde_json::to_string(&rating).expect("serialize");
        assert_eq!(json, format!("\"{}\"", rating.as_str()));
    }
    assert_eq!(
        AestheticRating::parse("  Amazing "),
        Some(AestheticRating::Amazing)
    );
    assert_eq!(AestheticRating::parse("flawless"), None);
}

#[test]
fn aesthetic_ratings_rank_best_to_worst_and_worst_picks_the_lowest() {
    assert!(AestheticRating::Legendary.rank() < AestheticRating::Amazing.rank());
    assert!(AestheticRating::Amazing.rank() < AestheticRating::Good.rank());
    assert!(AestheticRating::Good.rank() < AestheticRating::Okay.rank());
    assert!(AestheticRating::Okay.rank() < AestheticRating::Slop.rank());
    assert_eq!(
        AestheticRating::worst([
            AestheticRating::Legendary,
            AestheticRating::Okay,
            AestheticRating::Good
        ]),
        Some(AestheticRating::Okay)
    );
    assert_eq!(AestheticRating::worst([]), None);
}

#[test]
fn a_failure_cap_maps_onto_its_functional_rating_and_is_never_flawless() {
    assert_eq!(FailureCap::Broken.rating(), Rating::Broken);
    assert_eq!(FailureCap::Scuffed.rating(), Rating::Scuffed);
    assert_eq!(FailureCap::Passable.rating(), Rating::Passable);
    assert_eq!(FailureCap::Great.rating(), Rating::Great);
    for cap in FailureCap::ALL {
        assert_eq!(FailureCap::parse(cap.as_str()), Some(cap));
        assert_eq!(
            serde_json::to_string(&cap).expect("serialize"),
            format!("\"{}\"", cap.as_str())
        );
    }
    assert_eq!(FailureCap::parse("flawless"), None);
    assert!(serde_json::from_str::<FailureCap>("\"flawless\"").is_err());
}

#[test]
fn needs_aesthetic_is_a_run_wide_presence_check() {
    let unrated = Writeup {
        ratings: Vec::new(),
        aesthetic: None,
        body: "Body.".to_string(),
        checklist: vec![pass("a")],
    };
    assert!(needs_aesthetic(&unrated));
    let rated = Writeup {
        aesthetic: Some(AestheticRating::Okay),
        ..unrated.clone()
    };
    assert!(!needs_aesthetic(&rated));
    // The functional-channel gate is untouched by the aesthetic tier: it still
    // reports every domain as unrated, which is exactly right for a
    // validator-rated run (whose functional ratings come from the validators).
    let domains = [domain("single-player"), domain("versus")];
    assert_eq!(
        missing_ratings(&domains, &rated),
        vec!["single-player".to_string(), "versus".to_string()]
    );
}

#[test]
fn aggregate_aesthetic_is_the_worst_across_the_reviews_run_wide_tiers() {
    assert_eq!(
        aggregate_aesthetic([
            Some(AestheticRating::Okay),
            Some(AestheticRating::Legendary)
        ]),
        Some(AestheticRating::Okay)
    );
    // A review with no tier (a legacy run's, say) contributes nothing.
    assert_eq!(
        aggregate_aesthetic([None, Some(AestheticRating::Amazing)]),
        Some(AestheticRating::Amazing)
    );
    assert_eq!(aggregate_aesthetic([None]), None);
    assert_eq!(aggregate_aesthetic(std::iter::empty()), None);
}

#[test]
fn diff_reviews_captures_the_run_wide_aesthetic_change_alongside_ratings() {
    let diff = diff_reviews(
        ReviewContent {
            ratings: &[],
            aesthetic: Some(AestheticRating::Good),
            writeup: "Body.",
            checklist: &[],
        },
        ReviewContent {
            ratings: &[],
            aesthetic: Some(AestheticRating::Amazing),
            writeup: "Body.",
            checklist: &[],
        },
    );
    assert!(diff.ratings.is_empty());
    assert!(diff.verdicts.is_empty());
    assert!(diff.writeup.is_none());
    assert_eq!(
        diff.aesthetics,
        vec![AestheticChange {
            domain: None,
            from: Some(AestheticRating::Good),
            to: Some(AestheticRating::Amazing),
        }]
    );
    assert!(!diff.is_empty(), "an aesthetic-only change is a change");
    let json = serde_json::to_value(&diff).expect("serialize");
    assert!(
        json.get("ratings").is_none(),
        "empty channels stay off the wire"
    );
    assert!(
        json["aesthetics"][0].get("domain").is_none(),
        "the run-wide entry carries no domain on the wire"
    );

    // An unchanged tier records nothing.
    let held = diff_reviews(
        ReviewContent {
            ratings: &[],
            aesthetic: Some(AestheticRating::Good),
            writeup: "Body.",
            checklist: &[],
        },
        ReviewContent {
            ratings: &[],
            aesthetic: Some(AestheticRating::Good),
            writeup: "Body.",
            checklist: &[],
        },
    );
    assert!(held.is_empty());

    // An old stored revision row (domain present, from the per-domain era) still
    // deserializes.
    let legacy: AestheticChange =
        serde_json::from_str(r#"{"domain":"versus","from":"good","to":"okay"}"#).expect("legacy");
    assert_eq!(legacy.domain.as_deref(), Some("versus"));
    assert_eq!(legacy.from, Some(AestheticRating::Good));
    assert_eq!(legacy.to, Some(AestheticRating::Okay));
}

#[test]
fn validator_domain_ratings_start_flawless_and_take_the_lowest_cap_per_domain() {
    let domains = [domain("single-player"), domain("versus")];
    let items = [capped_category(
        "gameplay",
        &[
            ("serve", FailureCap::Broken, &["single-player", "versus"]),
            ("ai", FailureCap::Scuffed, &["single-player"]),
            ("controls", FailureCap::Great, &["versus"]),
            ("hud", FailureCap::Passable, &["single-player", "versus"]),
        ],
    )];

    // No failures at all: every domain is flawless.
    let scripts = [
        decided("gameplay", "gameplay.serve", true),
        decided("gameplay", "gameplay.ai", true),
        decided("gameplay", "gameplay.controls", true),
        decided("gameplay", "gameplay.hud", true),
    ];
    let ratings = validator_domain_ratings(&domains, &items, &scripts);
    assert_eq!(
        ratings,
        vec![
            DomainRating {
                domain: "single-player".to_string(),
                rating: Rating::Flawless
            },
            DomainRating {
                domain: "versus".to_string(),
                rating: Rating::Flawless
            },
        ]
    );
    assert_eq!(validator_rating(false, &ratings), Some(Rating::Flawless));

    // `ai` (scuffed, single-player only) and `controls` (great, versus only) fail:
    // each lowers only its own domains, and the run's rating is the worst domain.
    let scripts = [
        decided("gameplay", "gameplay.serve", true),
        decided("gameplay", "gameplay.ai", false),
        decided("gameplay", "gameplay.controls", false),
        decided("gameplay", "gameplay.hud", true),
    ];
    let ratings = validator_domain_ratings(&domains, &items, &scripts);
    assert_eq!(ratings[0].rating, Rating::Scuffed);
    assert_eq!(ratings[1].rating, Rating::Great);
    assert_eq!(validator_rating(false, &ratings), Some(Rating::Scuffed));

    // Two failures on one domain capped at great and passable → passable (the
    // lowest cap wins); a third capped at broken → broken.
    let scripts = [
        decided("gameplay", "gameplay.controls", false),
        decided("gameplay", "gameplay.hud", false),
    ];
    let ratings = validator_domain_ratings(&domains, &items, &scripts);
    assert_eq!(ratings[0].rating, Rating::Passable);
    assert_eq!(ratings[1].rating, Rating::Passable);
    let scripts = [
        decided("gameplay", "gameplay.controls", false),
        decided("gameplay", "gameplay.hud", false),
        decided("gameplay", "gameplay.serve", false),
    ];
    let ratings = validator_domain_ratings(&domains, &items, &scripts);
    assert_eq!(ratings[0].rating, Rating::Broken);
    assert_eq!(ratings[1].rating, Rating::Broken);
}

#[test]
fn validator_domain_ratings_use_the_automated_only_failure_semantics() {
    let domains = [domain("gameplay")];
    let items = [
        capped_item("crashed", FailureCap::Broken, &["gameplay"]),
        capped_item("unmet", FailureCap::Broken, &["gameplay"]),
        capped_item("silent", FailureCap::Broken, &["gameplay"]),
        capped_item("unscripted", FailureCap::Broken, &["gameplay"]),
        capped_item("decided", FailureCap::Broken, &["gameplay"]),
    ];
    // An inconclusive point (`precondition_unmet`), a clean run that decided
    // nothing, and a point with no script result at all never lower a domain
    // while another scored point is decided.
    let scripts = [
        script("unmet", None, &[], false, true),
        script("silent", None, &[], true, false),
        decided("decided", "decided", true),
    ];
    let ratings = validator_domain_ratings(&domains, &items, &scripts);
    assert_eq!(ratings[0].rating, Rating::Flawless);
    // A contract failure (`ran == false`, not inconclusive) fails its point.
    let scripts = [script("crashed", None, &[], false, false)];
    let ratings = validator_domain_ratings(&domains, &items, &scripts);
    assert_eq!(ratings[0].rating, Rating::Broken);
}

#[test]
fn an_unscored_point_or_an_unknown_domain_never_lowers_a_rating() {
    let domains = [domain("gameplay")];
    // An erratum excluded `serve` from scoring: its failure is not the model's.
    let mut excluded = capped_item("serve", FailureCap::Broken, &["gameplay"]);
    excluded.scored = false;
    let items = [
        excluded,
        // A point naming a domain outside the effective set (defensive: resolution
        // forbids it) lowers nothing.
        capped_item("stray", FailureCap::Broken, &["elsewhere"]),
        // A legacy point with no cap cannot lower anything either.
        item("uncapped", 1),
    ];
    let scripts = [
        decided("serve", "serve", false),
        decided("stray", "stray", false),
        decided("uncapped", "uncapped", false),
        decided("ghost", "ghost", false),
    ];
    let ratings = validator_domain_ratings(&domains, &items, &scripts);
    assert_eq!(
        ratings,
        vec![DomainRating {
            domain: "gameplay".to_string(),
            rating: Rating::Flawless
        }]
    );

    // Within a category, an excluded sub-item is skipped while its siblings count.
    let mut category = capped_category(
        "gameplay",
        &[
            ("serve", FailureCap::Broken, &["gameplay"]),
            ("hud", FailureCap::Great, &["gameplay"]),
        ],
    );
    category.sub_items[0].scored = false;
    let scripts = [
        decided("gameplay", "gameplay.serve", false),
        decided("gameplay", "gameplay.hud", false),
    ];
    let ratings = validator_domain_ratings(&domains, &[category], &scripts);
    assert_eq!(ratings[0].rating, Rating::Great);
}

#[test]
fn validator_rating_composes_with_the_toolchain_gate() {
    let flawless = [DomainRating {
        domain: "gameplay".to_string(),
        rating: Rating::Flawless,
    }];
    assert_eq!(validator_rating(true, &flawless), Some(Rating::Broken));
    assert_eq!(validator_rating(false, &flawless), Some(Rating::Flawless));
    // A validator-rated run always has a domain set, but an empty one is still
    // only ever `None` when ungated.
    assert_eq!(validator_rating(false, &[]), None);
    assert_eq!(validator_rating(true, &[]), Some(Rating::Broken));
}

#[test]
fn validator_score_is_the_automated_only_score_with_zero_reviews() {
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
    let score = validator_score(false, &items, &scripts);
    assert_eq!(
        score,
        AggregateScore {
            earned: 2.0,
            total: 3,
            reviews: 0
        }
    );
    // The gate zeroes the numerator and keeps the denominator, exactly as it does
    // over a reviewed score.
    let gated = validator_score(true, &items, &scripts);
    assert_eq!(
        gated,
        AggregateScore {
            earned: 0.0,
            total: 3,
            reviews: 0
        }
    );
}

// --- a checklist that decides no scored point -----------------------------------

#[test]
fn a_run_whose_validators_decide_no_scored_point_is_broken_in_every_domain() {
    let domains = [domain("single-player"), domain("versus")];
    let items = [
        capped_item("serve", FailureCap::Great, &["single-player"]),
        capped_category(
            "gameplay",
            &[
                ("ai", FailureCap::Great, &["single-player"]),
                ("controls", FailureCap::Great, &["versus"]),
            ],
        ),
    ];
    let broken = vec![
        DomainRating {
            domain: "single-player".to_string(),
            rating: Rating::Broken,
        },
        DomainRating {
            domain: "versus".to_string(),
            rating: Rating::Broken,
        },
    ];

    // Every point inconclusive (an unmet precondition, a suite cut short by the
    // whole-run cap, a suite that never ran): nothing is decided.
    let timed_out = DebugScriptResult {
        inconclusive: Some(Inconclusive::TimedOut),
        ..script("gameplay", Some("ai"), &[], false, true)
    };
    let not_run = DebugScriptResult {
        inconclusive: Some(Inconclusive::NotRun),
        ..script("gameplay", Some("controls"), &[], false, true)
    };
    let scripts = [script("serve", None, &[], false, true), timed_out, not_run];
    let ratings = validator_domain_ratings(&domains, &items, &scripts);
    assert_eq!(ratings, broken);
    assert_eq!(validator_rating(false, &ratings), Some(Rating::Broken));

    // No script result at all, and a clean run that emitted no verdict.
    assert_eq!(validator_domain_ratings(&domains, &items, &[]), broken);
    let silent = [script("serve", None, &[], true, false)];
    assert_eq!(validator_domain_ratings(&domains, &items, &silent), broken);

    // A verdict naming an undeclared point decides nothing either.
    let ghost = [decided("ghost", "ghost", true)];
    assert_eq!(validator_domain_ratings(&domains, &items, &ghost), broken);

    // One decided pass lifts the rule: the ordinary failure-cap rule applies.
    let one = [decided("gameplay", "gameplay.ai", true)];
    let ratings = validator_domain_ratings(&domains, &items, &one);
    assert!(ratings.iter().all(|r| r.rating == Rating::Flawless));
}

#[test]
fn an_erratum_excluded_point_never_counts_as_decided() {
    let domains = [domain("gameplay")];
    let mut excluded = capped_item("serve", FailureCap::Great, &["gameplay"]);
    excluded.scored = false;
    let mut category = capped_category(
        "gameplay",
        &[
            ("ai", FailureCap::Great, &["gameplay"]),
            ("hud", FailureCap::Great, &["gameplay"]),
        ],
    );
    category.sub_items[0].scored = false;
    let items = [
        excluded,
        category,
        capped_item("pause", FailureCap::Great, &["gameplay"]),
    ];

    // Only the excluded whole item and the excluded sub-item are decided.
    let scripts = [
        decided("serve", "serve", true),
        decided("gameplay", "gameplay.ai", true),
    ];
    let ratings = validator_domain_ratings(&domains, &items, &scripts);
    assert_eq!(ratings[0].rating, Rating::Broken);
    let score = validator_score(false, &items, &scripts);
    assert_eq!(
        score,
        AggregateScore {
            earned: 0.0,
            total: 2,
            reviews: 0
        },
        "every scored point counts as lost, the excluded ones toward neither side"
    );

    // A checklist that declares no scored point at all keeps the ordinary rule.
    let mut only = capped_item("serve", FailureCap::Great, &["gameplay"]);
    only.scored = false;
    let ratings = validator_domain_ratings(&domains, &[only.clone()], &[]);
    assert_eq!(ratings[0].rating, Rating::Flawless);
    assert_eq!(
        validator_score(false, &[only], &[]),
        AggregateScore {
            earned: 0.0,
            total: 0,
            reviews: 0
        }
    );
}

#[test]
fn decides_a_scored_point_reads_whole_items_and_sub_items() {
    let verdict = |id: &str| ReviewVerdict {
        id: id.to_string(),
        status: VerdictStatus::Fail,
        note: None,
    };
    let mut excluded_sub = capped_category("gameplay", &[("ai", FailureCap::Great, &[])]);
    excluded_sub.sub_items[0].scored = false;
    let mut excluded_item = item("legacy", 1);
    excluded_item.scored = false;
    let mut weightless = item("weightless", 0);
    weightless.failure_cap = None;
    let items = [
        capped_item("serve", FailureCap::Great, &[]),
        capped_category("menu", &[("start", FailureCap::Great, &[])]),
        excluded_sub,
        excluded_item,
        weightless,
    ];

    assert!(decides_a_scored_point(&items, &[verdict("serve")]));
    assert!(decides_a_scored_point(&items, &[verdict("menu.start")]));
    // An uncapped, weight-zero scored point still counts as decided.
    assert!(decides_a_scored_point(&items, &[verdict("weightless")]));
    // A category's own id names no point; the points are its sub-items.
    assert!(!decides_a_scored_point(&items, &[verdict("menu")]));
    assert!(!decides_a_scored_point(&items, &[verdict("gameplay.ai")]));
    assert!(!decides_a_scored_point(&items, &[verdict("legacy")]));
    assert!(!decides_a_scored_point(&items, &[verdict("ghost")]));
    assert!(!decides_a_scored_point(
        &items,
        &[verdict(OVERALL_VERDICT_ID)]
    ));
    assert!(!decides_a_scored_point(&items, &[]));
}

#[test]
fn a_run_that_decides_no_scored_point_scores_zero_over_the_declared_weight() {
    let mut weighted = capped_item("serve", FailureCap::Great, &["gameplay"]);
    weighted.weight = 3;
    let items = [
        weighted,
        capped_category(
            "gameplay",
            &[
                ("ai", FailureCap::Great, &["gameplay"]),
                ("hud", FailureCap::Great, &["gameplay"]),
            ],
        ),
    ];
    let scripts = [
        script("serve", None, &[], false, true),
        script("gameplay", Some("ai"), &[], false, true),
    ];
    let zero = AggregateScore {
        earned: 0.0,
        total: 5,
        reviews: 0,
    };
    assert_eq!(validator_score(false, &items, &scripts), zero);
    // The toolchain gate composes: still broken, still zero over the declared total.
    assert_eq!(validator_score(true, &items, &scripts), zero);
    let ratings = validator_domain_ratings(&[domain("gameplay")], &items, &scripts);
    assert_eq!(validator_rating(true, &ratings), Some(Rating::Broken));
    assert_eq!(validator_rating(false, &ratings), Some(Rating::Broken));

    let auto = crate::comparison::automated_verdicts(&scripts);
    assert_eq!(
        validator_review_score(false, &items, &auto, &[]),
        Score {
            earned: 0.0,
            total: 5
        }
    );
    let none: [&[ReviewVerdict]; 0] = [];
    assert_eq!(validator_aggregate_score(false, &items, &auto, none), zero);
    assert_eq!(
        validator_aggregate_rating(false, &[domain("gameplay")], &items, &auto, none),
        Some(Rating::Broken)
    );

    // The comparison core keeps counting only decided points: 0/0.
    assert_eq!(
        crate::comparison::covered_score(&items, &auto),
        Score {
            earned: 0.0,
            total: 0
        }
    );
}
