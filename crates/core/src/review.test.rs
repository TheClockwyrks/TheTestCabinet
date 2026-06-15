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
    };
    let file = writeup.to_file_string();
    assert_eq!(
        file,
        "---\nrating: scuffed\n---\n\nPlays, but the score resets on pause.\n"
    );
    assert_eq!(parse_writeup(&file).expect("reparse"), writeup);
}
