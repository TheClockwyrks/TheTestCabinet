//! Tests for parsing a run's `writeup.md` into per-domain ratings and a body,
//! rendering the canonical file back out, and scoring a run.

use super::*;
use crate::test_case::{Domain, ReviewItem, SubReviewItem};

/// A review item with the given id and weight, in no domain — the common shape
/// for these tests.
fn item(id: &str, weight: u32) -> ReviewItem {
    ReviewItem {
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
        validation: None,
        sub_items: sub_ids
            .iter()
            .map(|sub_id| SubReviewItem {
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
fn parses_rating_and_body() {
    let raw =
        "---\nrating.gameplay: great\n---\n\nMovement feels right.\nThe pause menu is rough.\n";
    let writeup = parse_writeup(raw).expect("parse");
    assert_eq!(
        writeup.ratings,
        vec![DomainRating {
            domain: "gameplay".to_string(),
            rating: Rating::Great,
        }]
    );
    assert_eq!(
        writeup.body,
        "Movement feels right.\nThe pause menu is rough."
    );
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
fn rating_token_is_case_and_whitespace_insensitive() {
    let raw = "---\nrating.gameplay:   Broken \n---\n\nUnplayable.\n";
    assert_eq!(
        parse_writeup(raw).expect("parse").overall_rating(),
        Some(Rating::Broken)
    );
}

#[test]
fn tolerates_a_bom_and_leading_blank_lines() {
    let raw = "\u{feff}\n\n---\nrating.gameplay: flawless\n---\n\nSpotless.\n";
    assert_eq!(
        parse_writeup(raw).expect("parse").overall_rating(),
        Some(Rating::Flawless)
    );
}

#[test]
fn overall_rating_is_the_worst_across_domains() {
    let raw =
        "---\nrating.single-player: flawless\nrating.versus: scuffed\n---\n\nVersus is rough.\n";
    let writeup = parse_writeup(raw).expect("parse");
    assert_eq!(writeup.ratings.len(), 2);
    // The overall rating is the worst across the two domains.
    assert_eq!(writeup.overall_rating(), Some(Rating::Scuffed));
}

#[test]
fn rejects_a_missing_frontmatter_block() {
    let err = parse_writeup("Just some prose, no frontmatter.\n").expect_err("no frontmatter");
    assert!(matches!(err, Error::Review(_)));
    assert!(err.to_string().contains("frontmatter"));
}

#[test]
fn rejects_an_unterminated_frontmatter_block() {
    let err = parse_writeup("---\nrating.gameplay: great\n\nbody with no closing fence\n")
        .expect_err("unterminated");
    assert!(err.to_string().contains("not closed"));
}

#[test]
fn rejects_a_missing_rating() {
    let err = parse_writeup("---\nnote: hi\n---\n\nBody.\n").expect_err("no rating");
    assert!(err.to_string().contains("rating"));
}

#[test]
fn rejects_an_unknown_rating() {
    let err =
        parse_writeup("---\nrating.gameplay: amazing\n---\n\nBody.\n").expect_err("unknown rating");
    assert!(err.to_string().contains("amazing"));
}

#[test]
fn rejects_an_empty_body() {
    let err = parse_writeup("---\nrating.gameplay: great\n---\n\n   \n").expect_err("empty body");
    assert!(err.to_string().contains("body"));
}

#[test]
fn renders_a_canonical_file_that_reparses() {
    let writeup = Writeup {
        ratings: vec![DomainRating {
            domain: "gameplay".to_string(),
            rating: Rating::Scuffed,
        }],
        body: "Plays, but the score resets on pause.".to_string(),
        checklist: vec![],
    };
    let file = writeup.to_file_string();
    assert_eq!(
        file,
        "---\nrating.gameplay: scuffed\n---\n\nPlays, but the score resets on pause.\n"
    );
    assert_eq!(parse_writeup(&file).expect("reparse"), writeup);
}

#[test]
fn renders_multiple_domain_ratings_in_order() {
    let writeup = Writeup {
        ratings: vec![
            DomainRating {
                domain: "single-player".to_string(),
                rating: Rating::Flawless,
            },
            DomainRating {
                domain: "versus".to_string(),
                rating: Rating::Broken,
            },
        ],
        body: "Single player is great; versus is broken.".to_string(),
        checklist: vec![],
    };
    let file = writeup.to_file_string();
    assert!(file.contains("rating.single-player: flawless\n"));
    assert!(file.contains("rating.versus: broken\n"));
    assert_eq!(parse_writeup(&file).expect("reparse"), writeup);
}

#[test]
fn parses_checklist_verdicts_with_and_without_notes() {
    let raw = "---\nrating.gameplay: great\n\
               review.ball-spin: pass\n\
               review.bank-shot: fail ball clips the top obstacle\n\
               ---\n\nPlays well.\n";
    let writeup = parse_writeup(raw).expect("parse");
    assert_eq!(
        writeup.checklist,
        vec![
            ReviewVerdict {
                id: "ball-spin".to_string(),
                status: VerdictStatus::Pass,
                note: None,
            },
            ReviewVerdict {
                id: "bank-shot".to_string(),
                status: VerdictStatus::Fail,
                note: Some("ball clips the top obstacle".to_string()),
            },
        ]
    );
}

#[test]
fn a_writeup_with_verdicts_round_trips() {
    let writeup = Writeup {
        ratings: vec![DomainRating {
            domain: "gameplay".to_string(),
            rating: Rating::Scuffed,
        }],
        body: "Bank shots are off.".to_string(),
        checklist: vec![
            ReviewVerdict {
                id: "ball-spin".to_string(),
                status: VerdictStatus::Pass,
                note: None,
            },
            ReviewVerdict {
                id: "bank-shot".to_string(),
                status: VerdictStatus::Fail,
                note: Some("clips the corner".to_string()),
            },
        ],
    };
    let file = writeup.to_file_string();
    assert_eq!(parse_writeup(&file).expect("reparse"), writeup);
}

#[test]
fn a_note_with_a_stray_newline_is_normalized_to_one_line() {
    // A note must never break the frontmatter block: newlines collapse to spaces.
    let writeup = Writeup {
        ratings: vec![DomainRating {
            domain: "gameplay".to_string(),
            rating: Rating::Broken,
        }],
        body: "Unplayable.".to_string(),
        checklist: vec![ReviewVerdict {
            id: "load".to_string(),
            status: VerdictStatus::Fail,
            note: Some("throws\non load".to_string()),
        }],
    };
    let file = writeup.to_file_string();
    assert!(file.contains("review.load: fail throws on load\n"));
    let reparsed = parse_writeup(&file).expect("reparse");
    assert_eq!(
        reparsed.checklist[0].note.as_deref(),
        Some("throws on load")
    );
}

#[test]
fn an_unrecognized_verdict_status_is_rejected() {
    let raw = "---\nrating.gameplay: great\nreview.x: maybe\n---\n\nBody.\n";
    let err = parse_writeup(raw).expect_err("bad status");
    assert!(err.to_string().contains("pass or fail"));
}

#[test]
fn na_is_no_longer_a_valid_verdict() {
    // Verdicts are binary now; `na` must be rejected so every item counts toward
    // the score one way or the other.
    let raw = "---\nrating.gameplay: great\nreview.x: na\n---\n\nBody.\n";
    assert!(parse_writeup(raw).is_err());
}

#[test]
fn missing_verdicts_reports_unaddressed_items() {
    let items = vec![item("ball-spin", 1), item("bank-shot", 1)];
    let writeup = Writeup {
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
    crate::test_case::apply_score_exclusions(
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
    crate::test_case::apply_score_exclusions(
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
    crate::test_case::apply_score_exclusions(
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
        &prior_ratings,
        "Old body.",
        &prior_checklist,
        &next_ratings,
        "New body.",
        &next_checklist,
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
    let unchanged = diff_reviews(&ratings, "Body.", &checklist, &ratings, "Body.", &checklist);
    assert!(unchanged.is_empty());

    // Dropping the `b` verdict records it as a removal (`to = None`).
    let removed = diff_reviews(
        &ratings,
        "Body.",
        &checklist,
        &ratings,
        "Body.",
        &[pass("a")],
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
        grade("fun", VerdictStatus::Great),        // 5 × 1 = 5, of 10
        grade("theme", VerdictStatus::Incredible), // 10 × 2 = 20, of 20
    ];
    let score = score_checklist(&items, &checklist);
    assert_eq!(score.total, 30);
    assert_eq!(score.earned, 25.0);
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
    assert_eq!(VerdictStatus::Poor.grade_points(), Some(1));
    assert_eq!(VerdictStatus::Neutral.grade_points(), Some(3));
    assert_eq!(VerdictStatus::Great.grade_points(), Some(5));
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

#[test]
fn writeup_with_only_graded_verdicts_parses() {
    // A game-jam writeup has no `rating.<domain>` lines — only graded categories
    // and the overall mark — and must still parse.
    let raw = "---\nreview.fun: great\nreview.overall: incredible\n---\n\nGreat jam entry.\n";
    let writeup = parse_writeup(raw).expect("jam writeup parses");
    assert!(writeup.ratings.is_empty());
    assert_eq!(writeup.overall_grade(), Some(VerdictStatus::Incredible));
    assert_eq!(writeup.checklist.len(), 2);
}
