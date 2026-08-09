//! Tests for the [shared substring-relevance core](super).

use super::*;

/// Normalization trims, lowercases, de-duplicates and drops empties — in the order the caller gave
/// what survived.
#[test]
fn normalization_trims_lowercases_and_deduplicates() {
    assert_eq!(
        normalize(["  Cargo ", "cargo", "NEXTEST", "", "   "]),
        vec!["cargo".to_string(), "nextest".to_string()]
    );
    assert!(normalize(["", "   "]).is_empty());
}

/// **A term is matched as a substring, case-insensitively** — which is the whole of the rule both
/// searches rest on, and the reason `foobar` finds `getFoobar`.
#[test]
fn a_term_matches_as_a_case_insensitive_substring() {
    let scored = relevance("getFoobar", &normalize(["FOOBAR"]));
    assert!(scored.is_match());
    assert_eq!(scored.matched, 1);
    assert_eq!(scored.occurrences, 1);
}

/// Breadth and frequency are counted separately: distinct terms matched, and total occurrences.
#[test]
fn breadth_counts_terms_and_frequency_counts_occurrences() {
    let scored = relevance(
        "read the file, then read the file again",
        &normalize(["read the file", "again"]),
    );
    assert_eq!(scored.matched, 2, "two distinct terms occur");
    assert_eq!(scored.occurrences, 3, "one of them occurs twice");
}

/// Text matching nothing scores zero and says so, so a caller can drop it rather than rank it last.
#[test]
fn text_matching_nothing_is_not_a_match() {
    let scored = relevance("nothing relevant here", &normalize(["cargo"]));
    assert!(!scored.is_match());
    assert_eq!(scored.first_at, None);
}

/// The first-match offset is the **earliest** of any term's, counted in characters — so an excerpt
/// cut at it never splits a multi-byte character.
#[test]
fn the_first_match_offset_is_the_earliest_in_characters() {
    // Four multi-byte characters precede `beta`, which precedes `alpha`.
    let scored = relevance("————beta gamma alpha", &normalize(["alpha", "beta"]));
    assert_eq!(scored.first_at, Some(4));
}

/// **Breadth outranks frequency**: matching two terms once beats matching one term twenty times.
#[test]
fn breadth_outranks_frequency() {
    let broad = Relevance {
        matched: 2,
        occurrences: 2,
        first_at: Some(0),
    };
    let frequent = Relevance {
        matched: 1,
        occurrences: 20,
        first_at: Some(0),
    };
    assert_eq!(
        breadth_then_frequency(&broad, &frequent),
        std::cmp::Ordering::Less,
        "the broader match sorts first"
    );
    let equal = Relevance {
        matched: 2,
        occurrences: 1,
        first_at: Some(0),
    };
    assert_eq!(
        breadth_then_frequency(&broad, &equal),
        std::cmp::Ordering::Less,
        "at equal breadth, the more frequent match sorts first"
    );
}

/// Two identical scores are ordered by nothing at all here, which is what leaves the caller's stable
/// key deciding — the property that makes a search reproducible across runs.
#[test]
fn identical_scores_are_left_for_the_callers_key_to_break() {
    let scored = Relevance {
        matched: 1,
        occurrences: 1,
        first_at: Some(0),
    };
    assert_eq!(
        breadth_then_frequency(&scored, &scored),
        std::cmp::Ordering::Equal
    );
}

/// An excerpt keeps a window around the match, collapses newlines, and elides only the side that
/// does not reach an end.
#[test]
fn an_excerpt_windows_elides_and_collapses_newlines() {
    let text = "alpha\nbravo charlie delta echo";
    assert_eq!(
        excerpt_around(text, 0, 11),
        "alpha bravo…",
        "the head is not elided, the tail is, and the newline is a space"
    );
    assert_eq!(
        excerpt_around(text, 20, 100),
        "alpha bravo charlie delta echo",
        "a radius covering the whole text elides neither end"
    );
    assert_eq!(
        excerpt_around(text, 25, 5),
        "…delta echo",
        "only the head is elided at the end of the text"
    );
}
