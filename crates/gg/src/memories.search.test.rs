//! Tests for the [keyword-search](super::MemoryStrategy::KeywordSearch) ranking: what is searched,
//! what order hits come back in, and what an excerpt shows.

use super::super::{MemoryCaps, MemoryError, MemoryStore, MemoryStrategy};
use super::*;

/// A keyword-search store holding `memories`, each `(slug, description, body)`.
fn store_of(memories: &[(&str, &str, &str)]) -> MemoryStore {
    let strategy = MemoryStrategy::KeywordSearch;
    let mut store = MemoryStore::new(strategy, MemoryCaps::for_strategy(strategy));
    for (name, description, body) in memories {
        store.create(name, description, body).unwrap();
    }
    store
}

/// The keywords a caller passes, as the owned strings the API takes.
fn keywords(words: &[&str]) -> Vec<String> {
    words.iter().map(|word| word.to_string()).collect()
}

#[test]
fn normalization_trims_lowercases_and_dedupes() {
    assert_eq!(
        normalize_keywords(&keywords(&["  Cargo ", "cargo", "NEXTEST", ""])),
        vec!["cargo".to_string(), "nextest".to_string()]
    );
    // Nothing usable survives an all-empty list, which the store reports as a bad call.
    assert!(normalize_keywords(&keywords(&["", "   "])).is_empty());
}

#[test]
fn search_refuses_a_call_with_no_usable_keyword() {
    let store = store_of(&[("a", "d", "body")]);
    assert_eq!(
        store.search(&keywords(&["  "])),
        Err(MemoryError::NoKeywords)
    );
}

/// Matching more of the caller's keywords outranks matching one of them more often: breadth is the
/// better signal for "this is the memory you meant".
#[test]
fn breadth_outranks_frequency() {
    let store = store_of(&[
        ("narrow", "d", "cargo cargo cargo cargo cargo"),
        ("broad", "d", "cargo and nextest"),
    ]);
    let hits = store.search(&keywords(&["cargo", "nextest"])).unwrap();
    assert_eq!(hits.len(), 2);
    assert_eq!(hits[0].name, "broad");
    assert_eq!(hits[0].matched, 2);
    assert_eq!(hits[1].name, "narrow");
    assert_eq!(hits[1].matched, 1);
    assert_eq!(hits[1].occurrences, 5);
}

/// Frequency is the tiebreak between two memories that matched the same keywords, and the slug is
/// the tiebreak after that — so a search is reproducible rather than dependent on insertion order.
#[test]
fn frequency_then_slug_break_the_tie() {
    let store = store_of(&[
        ("beta", "d", "cargo"),
        ("alpha", "d", "cargo"),
        ("often", "d", "cargo cargo"),
    ]);
    let hits = store.search(&keywords(&["cargo"])).unwrap();
    let names: Vec<&str> = hits.iter().map(|hit| hit.name.as_str()).collect();
    assert_eq!(names, vec!["often", "alpha", "beta"]);
}

/// A memory is findable by the words in its slug and description, not only by its contents — a
/// model that names a memory well should be able to find it by that name.
#[test]
fn the_slug_and_description_are_searched_too() {
    let store = store_of(&[("deploy-runbook", "How to ship a release", "step one")]);
    assert_eq!(store.search(&keywords(&["runbook"])).unwrap().len(), 1);
    assert_eq!(store.search(&keywords(&["release"])).unwrap().len(), 1);
    assert!(store.search(&keywords(&["unrelated"])).unwrap().is_empty());
}

#[test]
fn matching_is_case_insensitive() {
    let store = store_of(&[("a", "d", "The Gate Command")]);
    let hits = store.search(&keywords(&["GATE"])).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].occurrences, 1);
}

/// A search returns at most `maxResults` hits, so a large store cannot answer one call with a
/// hundred memories' worth of excerpts.
#[test]
fn results_are_capped_at_max_results() {
    let strategy = MemoryStrategy::KeywordSearch;
    let caps = MemoryCaps {
        max_results: Some(2),
        ..MemoryCaps::for_strategy(strategy)
    };
    let mut store = MemoryStore::new(strategy, caps);
    for n in 0..5 {
        store.create(&format!("m{n}"), "d", "cargo").unwrap();
    }
    assert_eq!(store.search(&keywords(&["cargo"])).unwrap().len(), 2);
}

/// With the page size disabled (`maxResults: 0`) every match comes back.
#[test]
fn an_unlimited_page_size_returns_every_match() {
    let strategy = MemoryStrategy::KeywordSearch;
    let caps = MemoryCaps {
        max_results: None,
        ..MemoryCaps::for_strategy(strategy)
    };
    let mut store = MemoryStore::new(strategy, caps);
    for n in 0..30 {
        store.create(&format!("m{n}"), "d", "cargo").unwrap();
    }
    assert_eq!(store.search(&keywords(&["cargo"])).unwrap().len(), 30);
}

/// The excerpt is a one-line window around the first match, elided when it does not reach the ends
/// — enough to judge relevance, not enough to be the memory itself.
#[test]
fn the_excerpt_windows_the_first_match_on_one_line() {
    let body = format!(
        "{}\nthe needle is here\n{}",
        "a ".repeat(100),
        "b ".repeat(100)
    );
    let store = store_of(&[("m", "d", &body)]);
    let hits = store.search(&keywords(&["needle"])).unwrap();
    let excerpt = &hits[0].excerpt;
    assert!(excerpt.contains("the needle is here"), "{excerpt}");
    assert!(!excerpt.contains('\n'), "an excerpt is one line: {excerpt}");
    assert!(
        excerpt.starts_with('…') && excerpt.ends_with('…'),
        "{excerpt}"
    );
}

/// A memory matched by its slug alone still gets an excerpt: the window simply starts at the top of
/// the body rather than at an offset the body does not have.
#[test]
fn a_slug_match_excerpts_from_the_top() {
    let store = store_of(&[("needle", "d", "the body says something else")]);
    let hits = store.search(&keywords(&["needle"])).unwrap();
    assert!(hits[0].excerpt.starts_with("the body says"));
}

/// A search that matched nothing is an empty list, not an error — "no memory says that" is an
/// answer, and one a model acts on differently from a refusal.
#[test]
fn no_match_is_an_empty_result() {
    let store = store_of(&[("a", "d", "one thing")]);
    assert!(store.search(&keywords(&["absent"])).unwrap().is_empty());
}

/// Multi-byte text is windowed by characters, not bytes: an excerpt must never split one.
#[test]
fn excerpts_are_character_safe() {
    let body = format!("{}needle{}", "é".repeat(200), "ü".repeat(200));
    let store = store_of(&[("m", "d", &body)]);
    let hits = store.search(&keywords(&["needle"])).unwrap();
    assert!(hits[0].excerpt.contains("needle"));
}
