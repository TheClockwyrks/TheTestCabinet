//! Tests for parsing a run's `writeup.md` into a rating and body, and rendering
//! the canonical file back out.

use super::*;

#[test]
fn parses_rating_and_body() {
    let raw = "---\nrating: great\n---\n\nMovement feels right.\nThe pause menu is rough.\n";
    let writeup = parse_writeup(raw).expect("parse");
    assert_eq!(writeup.rating, Rating::Great);
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
    let raw = "---\nrating:   Broken \n---\n\nUnplayable.\n";
    assert_eq!(parse_writeup(raw).expect("parse").rating, Rating::Broken);
}

#[test]
fn tolerates_a_bom_and_leading_blank_lines() {
    let raw = "\u{feff}\n\n---\nrating: flawless\n---\n\nSpotless.\n";
    assert_eq!(parse_writeup(raw).expect("parse").rating, Rating::Flawless);
}

#[test]
fn rejects_a_missing_frontmatter_block() {
    let err = parse_writeup("Just some prose, no frontmatter.\n").expect_err("no frontmatter");
    assert!(matches!(err, Error::Review(_)));
    assert!(err.to_string().contains("frontmatter"));
}

#[test]
fn rejects_an_unterminated_frontmatter_block() {
    let err = parse_writeup("---\nrating: great\n\nbody with no closing fence\n")
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
    let err = parse_writeup("---\nrating: amazing\n---\n\nBody.\n").expect_err("unknown rating");
    assert!(err.to_string().contains("amazing"));
}

#[test]
fn rejects_an_empty_body() {
    let err = parse_writeup("---\nrating: great\n---\n\n   \n").expect_err("empty body");
    assert!(err.to_string().contains("body"));
}

#[test]
fn renders_a_canonical_file_that_reparses() {
    let writeup = Writeup {
        rating: Rating::Scuffed,
        body: "Plays, but the score resets on pause.".to_string(),
        checklist: vec![],
    };
    let file = writeup.to_file_string();
    assert_eq!(
        file,
        "---\nrating: scuffed\n---\n\nPlays, but the score resets on pause.\n"
    );
    assert_eq!(parse_writeup(&file).expect("reparse"), writeup);
}

#[test]
fn parses_checklist_verdicts_with_and_without_notes() {
    let raw = "---\nrating: great\n\
               review.ball-spin: pass\n\
               review.bank-shot: fail ball clips the top obstacle\n\
               review.frenzy: na\n\
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
            ReviewVerdict {
                id: "frenzy".to_string(),
                status: VerdictStatus::NotApplicable,
                note: None,
            },
        ]
    );
}

#[test]
fn a_writeup_with_verdicts_round_trips() {
    let writeup = Writeup {
        rating: Rating::Scuffed,
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
        rating: Rating::Broken,
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
    let raw = "---\nrating: great\nreview.x: maybe\n---\n\nBody.\n";
    let err = parse_writeup(raw).expect_err("bad status");
    assert!(err.to_string().contains("pass, fail, or na"));
}

#[test]
fn missing_verdicts_reports_unaddressed_items() {
    use crate::test_case::ReviewItem;
    let items = vec![
        ReviewItem {
            id: "ball-spin".to_string(),
            title: "Paddle spin".to_string(),
            text: "Spin curves the ball.".to_string(),
            reference: None,
            proof: None,
        },
        ReviewItem {
            id: "bank-shot".to_string(),
            title: "Bank shots".to_string(),
            text: "Obstacles enable bank shots.".to_string(),
            reference: None,
            proof: None,
        },
    ];
    let writeup = Writeup {
        rating: Rating::Great,
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
