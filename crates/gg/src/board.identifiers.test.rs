//! Tests for the board's **naming**: an epic's prefix, the issue numbers derived from it, and the
//! agent ids derived from those.
//!
//! Kept apart from [the store's own tests](super::tests) because they are about one property rather
//! than one method: that a single name locates a piece of work, the attempt at it, and the review of
//! that attempt — which is what makes a fleet of concurrent agents legible.

use super::*;

/// A store with generous caps.
fn store() -> BoardStore {
    BoardStore::new(BoardCaps::default())
}

/// A minimal-but-complete issue under `epic_id`, returning the id the store assigned.
fn file_issue(store: &mut BoardStore, epic_id: Option<&str>) -> String {
    store
        .create_issue(NewIssue {
            title: "some work",
            in_scope: "in",
            out_of_scope: "out",
            completion_criteria: "done",
            epic_id,
            agent: "worker",
            ..NewIssue::default()
        })
        .expect("create issue")
}

// ---------------------------------------------------------------------------
// Prefixes
// ---------------------------------------------------------------------------

/// A prefix is normalized, not merely validated: whatever case the model wrote, the epic's id — and
/// so every issue id under it — is upper-case, because those ids are read by people in logs and
/// briefs.
#[test]
fn a_prefix_is_trimmed_and_upper_cased() {
    let mut store = store();
    assert_eq!(store.create_epic("auth", "t", "d").unwrap(), "AUTH");
    // Only the outer whitespace is trimmed — an inner space is not a letter, so the prefix is
    // refused rather than silently squeezed into something the model did not write.
    assert_eq!(
        store.create_epic("  ui x  ", "t", "d"),
        Err(BoardError::InvalidPrefix("ui x".to_string()))
    );
    assert_eq!(store.create_epic(" Api ", "t", "d").unwrap(), "API");
    assert_eq!(store.epics()[1].id(), "API");
}

/// The bounds are inclusive, and everything that is not a letter is refused — the prefix is joined
/// to a number with a `-` and to an attempt with a `.`, so a digit or separator inside it would make
/// an id unparseable by eye.
#[test]
fn only_three_to_six_letters_is_a_prefix() {
    let mut store = store();
    // Distinct letters, since a prefix that normalizes onto one already taken is a *duplicate*
    // rather than an invalid prefix.
    for ok in ["abc", "defghi", "JkL"] {
        assert!(
            store.create_epic(ok, "t", "d").is_ok(),
            "`{ok}` is a valid prefix"
        );
    }
    for bad in ["", "a", "ab", "abcdefg", "au7h", "au-h", "a b", "authé"] {
        assert_eq!(
            store.create_epic(bad, "t", "d"),
            Err(BoardError::InvalidPrefix(bad.trim().to_string())),
            "`{bad}` is not a valid prefix"
        );
    }
}

// ---------------------------------------------------------------------------
// Issue numbers
// ---------------------------------------------------------------------------

/// Numbering is **per prefix**: each epic counts from 1, and issues with no epic count under
/// [`UNGROUPED_PREFIX`].
#[test]
fn issues_are_numbered_under_their_epics_prefix() {
    let mut store = store();
    let auth = store.create_epic("auth", "Auth", "signing in").unwrap();
    let ui = store.create_epic("ui-x", "UI", "the interface");
    assert!(ui.is_err(), "the second epic's prefix must be letters");
    let ui = store.create_epic("uix", "UI", "the interface").unwrap();

    assert_eq!(file_issue(&mut store, Some(&auth)), "AUTH-1");
    assert_eq!(file_issue(&mut store, Some(&ui)), "UIX-1");
    assert_eq!(file_issue(&mut store, Some(&auth)), "AUTH-2");
    assert_eq!(file_issue(&mut store, None), "ISSUE-1");
    assert_eq!(file_issue(&mut store, None), "ISSUE-2");
}

/// A removed issue's number is **not** handed out again. An id that has been quoted in a log, in a
/// brief, and in the names of the agents that worked it must not come back meaning something else.
#[test]
fn a_removed_issues_number_is_never_reused() {
    let mut store = store();
    let epic = store.create_epic("auth", "Auth", "signing in").unwrap();
    let first = file_issue(&mut store, Some(&epic));
    assert_eq!(first, "AUTH-1");
    store.remove_issue(&first).unwrap();
    assert_eq!(file_issue(&mut store, Some(&epic)), "AUTH-2");

    // Nor does removing the epic and re-creating it restart the sequence.
    store.remove_epic(&epic).unwrap();
    let epic = store
        .create_epic("auth", "Auth", "signing in again")
        .unwrap();
    assert_eq!(file_issue(&mut store, Some(&epic)), "AUTH-3");
}

/// An epic may legitimately be prefixed `ISSUE`, which is also where ungrouped issues are numbered.
/// They share one sequence rather than colliding.
#[test]
fn the_ungrouped_prefix_is_not_reserved() {
    let mut store = store();
    let epic = store
        .create_epic(UNGROUPED_PREFIX, "Issues", "a literal epic")
        .unwrap();
    assert_eq!(file_issue(&mut store, None), "ISSUE-1");
    assert_eq!(file_issue(&mut store, Some(&epic)), "ISSUE-2");
    assert_eq!(file_issue(&mut store, None), "ISSUE-3");
}

// ---------------------------------------------------------------------------
// Agent ids
// ---------------------------------------------------------------------------

/// The whole nesting, in one issue's life: attempts are numbered under the issue, reviews under the
/// attempt they reviewed, and a new attempt restarts the review numbering (because a review's name
/// is suffixed onto its attempt's, so it cannot collide across attempts).
#[test]
fn agents_are_numbered_under_the_issue_and_reviews_under_the_attempt() {
    let mut store = store();
    let epic = store.create_epic("auth", "Auth", "signing in").unwrap();
    let id = file_issue(&mut store, Some(&epic));

    // The first dispatch.
    assert_eq!(store.assign_issue(&id).as_deref(), Some("AUTH-1.0i"));
    assert_eq!(
        store.next_review_agent_id(&id).as_deref(),
        Some("AUTH-1.0i.0r")
    );
    assert_eq!(
        store.next_review_agent_id(&id).as_deref(),
        Some("AUTH-1.0i.1r"),
        "a second reviewer of the same attempt is numbered after the first"
    );

    // The rework pass after that round asked for changes.
    assert_eq!(store.redispatch_issue(&id, 0).as_deref(), Some("AUTH-1.1i"));
    assert_eq!(
        store.next_review_agent_id(&id).as_deref(),
        Some("AUTH-1.1i.0r"),
        "the new attempt starts its own review sequence"
    );
}

/// An unknown issue mints nothing — for either kind of agent.
#[test]
fn an_unknown_issue_mints_no_agent_id() {
    let mut store = store();
    assert_eq!(store.assign_issue("ghost"), None);
    assert_eq!(store.redispatch_issue("ghost", 0), None);
    assert_eq!(store.next_review_agent_id("ghost"), None);
}

/// A review of an issue that somehow has no implementer recorded is still named uniquely, under the
/// issue itself — a review cannot normally precede a dispatch, and if it did the reviewer must still
/// get a name nothing else holds.
#[test]
fn a_review_without_an_implementer_is_numbered_under_the_issue() {
    let mut store = store();
    let id = file_issue(&mut store, None);
    assert_eq!(
        store.next_review_agent_id(&id).as_deref(),
        Some("ISSUE-1.0r")
    );
}

/// The runtime is the seam the orchestrator actually uses, and a **disabled** board mints nothing at
/// all — a run with the capability off has no dispatch, so it has no names either.
#[test]
fn a_disabled_runtime_mints_no_names() {
    let runtime = BoardRuntime::disabled();
    assert_eq!(runtime.assign_issue("ISSUE-1"), None);
    assert_eq!(runtime.redispatch_issue("ISSUE-1", 0), None);
    assert_eq!(runtime.next_review_agent_id("ISSUE-1"), None);
}
