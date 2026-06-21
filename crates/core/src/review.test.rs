//! Tests for parsing a run's `writeup.md` into per-domain ratings and a body,
//! rendering the canonical file back out, and scoring a run.

use super::*;
use crate::test_case::{Domain, ReviewItem};

/// A review item with the given id and weight, in no domain — the common shape
/// for these tests.
fn item(id: &str, weight: u32) -> ReviewItem {
    ReviewItem {
        id: id.to_string(),
        title: id.to_string(),
        text: format!("Check {id}."),
        reference: None,
        proof: None,
        sequences: Vec::new(),
        frames: Vec::new(),
        weight,
        domain: None,
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
            earned: 3,
            total: 6
        }
    );
}

#[test]
fn aggregate_score_averages_earned_over_the_shared_total() {
    // Two reviewers scored the same 6-point checklist: one earned 6, one earned 3.
    let scores = [
        Score {
            earned: 6,
            total: 6,
        },
        Score {
            earned: 3,
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
