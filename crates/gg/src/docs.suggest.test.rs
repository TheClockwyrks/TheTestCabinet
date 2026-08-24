//! Tests for the near-miss matcher behind a failed documentation lookup's hint.
//!
//! Every one of these is about a *miss a real model makes*: the tool name where the spelling
//! belongs, the stem, the typo. The matcher is pure — it takes the names and returns the names — so
//! the whole of what it decides can be read here without standing up a runtime, and the one thing
//! that needs a runtime (which names are candidates at all) is asserted in `docs.test.rs` where the
//! gates are.

use super::*;

/// A full run's bound spellings, as `fs`, `memory`, `view` and the rest offer them — enough for
/// every ambiguity below to be a real one.
const BOUND: &[&str] = &[
    "readFile",
    "writeFile",
    "editFile",
    "listDir",
    "readSkill",
    "writeMemory",
    "readMemory",
    "searchMemories",
    "openFile",
    "openText",
    "openDocsView",
    "close",
    "shell",
];

/// The whole set, for the common case.
fn nearest_bound(query: &str) -> Vec<String> {
    nearest(query, BOUND.iter().copied())
}

/// **The commonest miss there is: the gg tool name where the program spelling belongs.**
///
/// `write_file` is what the model's telemetry, its capability list and gg's own sentences call the
/// function; `writeFile` is what its program has to call it. The two are one name under two
/// spellings, so the hint is exact and it is the only one offered — nothing weaker is promoted
/// beside a name that matched.
#[test]
fn a_tool_name_resolves_to_its_program_spelling() {
    assert_eq!(nearest_bound("write_file"), vec!["writeFile"]);
    assert_eq!(nearest_bound("search_memories"), vec!["searchMemories"]);
    // Case alone is a spelling too.
    assert_eq!(nearest_bound("READFILE"), vec!["readFile"]);
}

/// An object-qualified guess is answered by the function it names. `fs.writeFile` is not a name the
/// lookup binds — it is keyed on the function's own name — but it is unambiguously *about* one.
#[test]
fn a_qualified_guess_resolves_to_the_function_it_qualifies() {
    assert_eq!(nearest_bound("fs.writeFile"), vec!["writeFile"]);
    assert_eq!(
        nearest_bound("memory.search_memories"),
        vec!["searchMemories"]
    );
}

/// **A stem is completed, and every completion of it is offered.** This is the case the feature was
/// built for: `write` is a name recalled by its first word, and both functions that begin with it
/// are equally plausibly the one meant.
#[test]
fn a_stem_offers_every_name_that_begins_with_it() {
    assert_eq!(nearest_bound("write"), vec!["writeFile", "writeMemory"]);
}

/// A typo is caught, and the nearest typo wins outright: a name one edit away is offered without a
/// name two edits away beside it, because a hint padded out with worse candidates is a hint the
/// model has to adjudicate.
#[test]
fn a_typo_is_caught_and_the_nearest_one_wins() {
    assert_eq!(nearest_bound("writFile"), vec!["writeFile"]);
    assert_eq!(nearest_bound("opneText"), vec!["openText"]);
    // `close` is one edit from `clone`; nothing else is within two, so nothing else is offered.
    assert_eq!(nearest_bound("clone"), vec!["close"]);
}

/// **Only the best tier is ever offered.** A name matched exactly is not joined by the names that
/// merely open with it, which are a weaker kind of match.
///
/// The candidates here are constructed rather than taken from [`BOUND`], and that is worth saying
/// plainly: **no scope binds one function's name inside another's any more.** The per-module
/// directory was the only name that ever collided with a longer one — `list` against `listDir` —
/// and with it deleted no real agent can currently produce this ambiguity. The tier is still what
/// decides the answer the day one does, which a module gaining a `read` beside its `readFile` would
/// be enough to cause, so the rule is asserted here rather than left to be found out by the agent
/// that hits it first.
#[test]
fn a_weaker_kind_of_match_is_never_promoted_beside_a_better_one() {
    assert_eq!(
        nearest("read", ["read", "readFile", "readMemory"]),
        vec!["read"]
    );
    // Without the exact name in the set, the weaker kinds are what is left — and are offered.
    assert_eq!(
        nearest(" read ", ["readFile", "readMemory"]),
        vec!["readFile", "readMemory"]
    );
}

/// The cap holds, and what survives it is the *nearest* — the shorter name first, since it is the
/// smaller guess about what the model left off.
#[test]
fn no_more_than_three_names_are_ever_offered() {
    let offered = nearest_bound("read");
    assert_eq!(offered.len(), MAX_SUGGESTIONS);
    assert_eq!(offered, vec!["readFile", "readSkill", "readMemory"]);
}

/// The order is total and does not depend on the order the candidates arrived in: two runs of the
/// same failure must read as one answer.
#[test]
fn the_order_is_independent_of_the_candidate_order() {
    let reversed: Vec<&str> = BOUND.iter().copied().rev().collect();
    assert_eq!(nearest("read", reversed), nearest_bound("read"));
}

/// **A name that is nothing like anything bound earns no hint at all.** gg does not fill the silence
/// with its closest guess; a wrong suggestion sends the model to look up a function that has nothing
/// to do with what it wanted.
#[test]
fn a_name_unlike_anything_bound_earns_no_hint() {
    assert!(nearest_bound("compileTheProject").is_empty());
    assert!(nearest_bound("zzz").is_empty());
    // A withheld function's name is not near an unrelated bound one either: the whole point of
    // matching on spelling and edits rather than on vibes.
    assert!(nearest("archiveThread", ["readFile", "shell"]).is_empty());
}

/// Two-character queries match nothing by edit distance — inside them one edit changes half the name
/// — though they are still answered when they are genuinely part of a name.
#[test]
fn a_name_too_short_for_an_edit_to_mean_anything_is_not_matched_by_edits() {
    assert!(nearest("fk", ["fork", "close"]).is_empty());
    assert_eq!(nearest("fo", ["fork", "close"]), vec!["fork"]);
    assert_eq!(allowance(2), None);
    assert_eq!(allowance(3), Some(1));
    assert_eq!(allowance(SHORT_NAME + 1), Some(2));
}

/// A query that folds away to nothing — punctuation, a bare object qualifier — is not a name, and a
/// hint about it would be a hint about nothing.
#[test]
fn a_query_that_folds_to_nothing_earns_no_hint() {
    assert!(nearest_bound("").is_empty());
    assert!(nearest_bound("fs.").is_empty());
    assert!(nearest_bound("()").is_empty());
}

/// An empty candidate set is an answer, not a panic: an agent whose scope binds nothing has nothing
/// to suggest.
#[test]
fn an_empty_candidate_set_is_answered_with_nothing() {
    assert!(nearest("readFile", Vec::<&str>::new()).is_empty());
}

/// The fold sees through the three things a spelling varies by, and through nothing else.
#[test]
fn folding_erases_spelling_and_keeps_the_name() {
    assert_eq!(fold("write_file"), "writefile");
    assert_eq!(fold("writeFile"), "writefile");
    assert_eq!(fold("fs.write-file()"), "writefile");
    // Two different names stay different.
    assert_ne!(fold("writeFile"), fold("readFile"));
}

/// The distance is the textbook one, counted in characters.
#[test]
fn the_distance_counts_single_character_edits() {
    assert_eq!(distance("close", "close"), 0);
    assert_eq!(distance("close", "clone"), 1);
    assert_eq!(distance("", "fork"), 4);
    assert_eq!(distance("kitten", "sitting"), 3);
    // Over characters rather than bytes: one multi-byte character is one edit.
    assert_eq!(distance("readFile", "readFilé"), 1);
}
