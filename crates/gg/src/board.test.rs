//! Tests for the epics-and-issues board store, its cycle guard, its invariants, and its
//! derivations.

use serde_json::json;

use super::*;
use test_cabinet_core::gg::{GgIssueStatus, GgTelemetryKind};

/// A store with generous caps for the board tests.
fn store() -> BoardStore {
    BoardStore::new(BoardCaps::default())
}

/// Create an epic with a synthetic title/description.
fn add_epic(store: &mut BoardStore, id: &str) {
    store
        .create_epic(id, id, "covers some work")
        .expect("create epic");
}

/// Create a minimal-but-complete issue (all required structured fields present), with the given
/// blockers and no epic.
fn add_issue(store: &mut BoardStore, id: &str, blocked_by: &[&str]) {
    let blockers: Vec<String> = blocked_by.iter().map(|s| s.to_string()).collect();
    store
        .create_issue(
            id,
            id,
            None,
            "in scope",
            "out of scope",
            "done when x",
            &blockers,
            None,
        )
        .expect("create issue");
}

/// The issue ids in board order.
fn issue_ids(store: &BoardStore) -> Vec<&str> {
    store.issues().iter().map(Issue::id).collect()
}

// ---------------------------------------------------------------------------
// Epics
// ---------------------------------------------------------------------------

#[test]
fn create_epic_stores_it_and_rejects_empties_and_duplicates() {
    let mut store = store();
    store
        .create_epic("core", "Core loop", "the heart of the game")
        .unwrap();
    assert_eq!(store.epic_count(), 1);
    let epic = &store.epics()[0];
    assert_eq!(epic.title(), "Core loop");
    assert_eq!(epic.description(), "the heart of the game");

    assert_eq!(
        store.create_epic("", "t", "d"),
        Err(BoardError::EmptyField("id"))
    );
    assert_eq!(
        store.create_epic("x", "  ", "d"),
        Err(BoardError::EmptyField("title"))
    );
    assert_eq!(
        store.create_epic("x", "t", "  "),
        Err(BoardError::EmptyField("description"))
    );
    assert_eq!(
        store.create_epic("core", "again", "dup"),
        Err(BoardError::DuplicateEpic("core".to_string()))
    );
    assert_eq!(store.epic_count(), 1, "no rejected epic was stored");
}

// ---------------------------------------------------------------------------
// Issues: structured fields
// ---------------------------------------------------------------------------

#[test]
fn create_issue_captures_every_structured_section() {
    let mut store = store();
    add_epic(&mut store, "core");
    store
        .create_issue(
            "render",
            "Render loop",
            Some("draws the frame"),
            "clear and draw the canvas each frame",
            "input handling (separate issue)",
            "the player and goal are visible at 60fps",
            &[],
            Some("core"),
        )
        .unwrap();
    let issue = &store.issues()[0];
    assert_eq!(issue.title(), "Render loop");
    assert_eq!(issue.description(), Some("draws the frame"));
    assert_eq!(issue.in_scope(), "clear and draw the canvas each frame");
    assert_eq!(issue.out_of_scope(), "input handling (separate issue)");
    assert_eq!(
        issue.completion_criteria(),
        "the player and goal are visible at 60fps"
    );
    assert_eq!(issue.status(), IssueStatus::Open);
    assert_eq!(issue.epic_id(), Some("core"));
}

#[test]
fn create_issue_requires_the_dispatch_fields() {
    let mut store = store();
    // Missing title / inScope / outOfScope / completionCriteria are each refused, by name.
    assert_eq!(
        store.create_issue("i", "  ", None, "in", "out", "done", &[], None),
        Err(BoardError::EmptyField("title"))
    );
    assert_eq!(
        store.create_issue("i", "t", None, "  ", "out", "done", &[], None),
        Err(BoardError::EmptyField("inScope"))
    );
    assert_eq!(
        store.create_issue("i", "t", None, "in", "  ", "done", &[], None),
        Err(BoardError::EmptyField("outOfScope"))
    );
    assert_eq!(
        store.create_issue("i", "t", None, "in", "out", "  ", &[], None),
        Err(BoardError::EmptyField("completionCriteria"))
    );
    assert_eq!(store.issue_count(), 0, "no partial issue was stored");
}

#[test]
fn create_issue_rejects_a_duplicate_and_an_unknown_epic() {
    let mut store = store();
    add_issue(&mut store, "a", &[]);
    assert_eq!(
        store.create_issue("a", "again", None, "in", "out", "done", &[], None),
        Err(BoardError::DuplicateIssue("a".to_string()))
    );
    assert_eq!(
        store.create_issue("b", "t", None, "in", "out", "done", &[], Some("ghost")),
        Err(BoardError::UnknownEpic("ghost".to_string()))
    );
    assert_eq!(issue_ids(&store), vec!["a"]);
}

// ---------------------------------------------------------------------------
// Blocked-by edges and the cycle guard
// ---------------------------------------------------------------------------

#[test]
fn create_issue_with_a_blocked_by_edge_records_it() {
    let mut store = store();
    add_issue(&mut store, "a", &[]);
    add_issue(&mut store, "b", &["a"]);
    assert_eq!(store.issues()[1].blocked_by(), &["a".to_string()]);
}

#[test]
fn blocked_by_rejects_self_and_unknown_blockers() {
    let mut store = store();
    add_issue(&mut store, "a", &[]);
    assert_eq!(
        store.set_issue_blocked_by("a", &["a".to_string()]),
        Err(BoardError::SelfBlock("a".to_string()))
    );
    assert_eq!(
        store.set_issue_blocked_by("a", &["ghost".to_string()]),
        Err(BoardError::BlockerNotFound("ghost".to_string()))
    );
}

/// The heart of the DAG guard: an edge that would close a cycle is refused, and the board is
/// left unchanged.
#[test]
fn set_issue_blocked_by_rejects_a_cycle_without_mutating() {
    let mut store = store();
    add_issue(&mut store, "a", &[]);
    add_issue(&mut store, "b", &["a"]); // b depends on a
    // Blocking a on b would create a <-> b.
    assert_eq!(
        store.set_issue_blocked_by("a", &["b".to_string()]),
        Err(BoardError::Cycle {
            issue: "a".to_string(),
            blocker: "b".to_string(),
        })
    );
    // Nothing changed: a still has no blockers.
    assert!(store.issues()[0].blocked_by().is_empty());
}

#[test]
fn create_issue_rejects_a_cycle_through_its_initial_blockers() {
    let mut store = store();
    add_issue(&mut store, "a", &[]);
    add_issue(&mut store, "b", &["a"]);
    // A three-node chain would be fine; but blocking a fresh `c` on b, then trying to also make
    // b depend on c via set is the cycle. Here we check the create path rejects a self-cycle
    // only through existing edges (a new node has no dependents, so it cannot cycle) — instead
    // verify a longer chain builds cleanly.
    add_issue(&mut store, "c", &["b"]);
    assert_eq!(issue_ids(&store), vec!["a", "b", "c"]);
    // Now a -> ... -> c is acyclic; blocking a on c closes a cycle a<-...<-c<-a.
    assert!(matches!(
        store.set_issue_blocked_by("a", &["c".to_string()]),
        Err(BoardError::Cycle { .. })
    ));
}

// ---------------------------------------------------------------------------
// Update / complete / remove
// ---------------------------------------------------------------------------

#[test]
fn update_issue_changes_fields_and_rejects_empty_updates() {
    let mut store = store();
    add_epic(&mut store, "core");
    add_issue(&mut store, "a", &[]);
    assert_eq!(
        store.update_issue("a", IssueUpdate::default()),
        Err(BoardError::NoUpdateFields)
    );
    store
        .update_issue(
            "a",
            IssueUpdate {
                title: Some("New title"),
                in_scope: Some("new scope"),
                status: Some(IssueStatus::InProgress),
                epic_id: Some("core"),
                ..IssueUpdate::default()
            },
        )
        .unwrap();
    let issue = &store.issues()[0];
    assert_eq!(issue.title(), "New title");
    assert_eq!(issue.in_scope(), "new scope");
    assert_eq!(issue.status(), IssueStatus::InProgress);
    assert_eq!(issue.epic_id(), Some("core"));
    // An empty epicId clears the grouping; a required field cannot be blanked.
    store
        .update_issue(
            "a",
            IssueUpdate {
                epic_id: Some(""),
                ..IssueUpdate::default()
            },
        )
        .unwrap();
    assert_eq!(store.issues()[0].epic_id(), None);
    assert_eq!(
        store.update_issue(
            "a",
            IssueUpdate {
                in_scope: Some("   "),
                ..IssueUpdate::default()
            }
        ),
        Err(BoardError::EmptyField("inScope"))
    );
}

#[test]
fn update_issue_rejects_regrouping_under_an_unknown_epic() {
    let mut store = store();
    add_issue(&mut store, "a", &[]);
    assert_eq!(
        store.update_issue(
            "a",
            IssueUpdate {
                epic_id: Some("ghost"),
                ..IssueUpdate::default()
            }
        ),
        Err(BoardError::UnknownEpic("ghost".to_string()))
    );
}

#[test]
fn complete_issue_marks_done_and_unblocks_dependents() {
    let mut store = store();
    add_issue(&mut store, "a", &[]);
    add_issue(&mut store, "b", &["a"]);
    // b is not ready while a is open.
    assert!(!store.is_ready(&store.issues()[1].clone()));
    store.complete_issue("a").unwrap();
    assert_eq!(store.issues()[0].status(), IssueStatus::Done);
    assert!(store.is_ready(&store.issues()[1].clone()));
    assert_eq!(
        store.complete_issue("ghost"),
        Err(BoardError::IssueNotFound("ghost".to_string()))
    );
}

#[test]
fn remove_issue_strips_dangling_edges() {
    let mut store = store();
    add_issue(&mut store, "a", &[]);
    add_issue(&mut store, "b", &["a"]);
    store.remove_issue("a").unwrap();
    assert_eq!(issue_ids(&store), vec!["b"]);
    assert!(
        store.issues()[0].blocked_by().is_empty(),
        "the edge to the removed issue was dropped"
    );
}

#[test]
fn remove_epic_ungroups_its_issues() {
    let mut store = store();
    add_epic(&mut store, "core");
    store
        .create_issue("a", "a", None, "in", "out", "done", &[], Some("core"))
        .unwrap();
    store.remove_epic("core").unwrap();
    assert_eq!(store.epic_count(), 0);
    assert_eq!(
        store.issues()[0].epic_id(),
        None,
        "the issue was ungrouped, not removed"
    );
    assert_eq!(store.issue_count(), 1);
}

// ---------------------------------------------------------------------------
// Count caps
// ---------------------------------------------------------------------------

#[test]
fn count_caps_are_enforced_per_kind() {
    let mut store = BoardStore::new(BoardCaps {
        max_epics: 1,
        max_issues: 1,
    });
    add_epic(&mut store, "e1");
    assert_eq!(
        store.create_epic("e2", "t", "d"),
        Err(BoardError::CountCap {
            kind: "epic",
            cap: 1
        })
    );
    add_issue(&mut store, "i1", &[]);
    assert_eq!(
        store.create_issue("i2", "t", None, "in", "out", "done", &[], None),
        Err(BoardError::CountCap {
            kind: "issue",
            cap: 1
        })
    );
}

// ---------------------------------------------------------------------------
// Derivations: telemetry, prompt, and the pinned context block
// ---------------------------------------------------------------------------

#[test]
fn state_event_reports_the_whole_board() {
    let mut store = store();
    add_epic(&mut store, "core");
    store
        .create_issue(
            "render",
            "Render",
            None,
            "draw",
            "input",
            "visible",
            &[],
            Some("core"),
        )
        .unwrap();
    store
        .create_issue(
            "input",
            "Input",
            None,
            "keys",
            "draw",
            "moves",
            &["render".to_string()],
            None,
        )
        .unwrap();
    match store.state_event() {
        GgTelemetryKind::BoardState { epics, issues } => {
            assert_eq!(epics.len(), 1);
            assert_eq!(epics[0].id, "core");
            assert_eq!(issues.len(), 2);
            assert_eq!(issues[0].id, "render");
            assert_eq!(issues[0].epic_id.as_deref(), Some("core"));
            assert_eq!(issues[0].status, GgIssueStatus::Open);
            assert_eq!(issues[1].blocked_by, vec!["render".to_string()]);
            assert_eq!(issues[1].in_scope, "keys");
        }
        other => panic!("expected BoardState, got {other:?}"),
    }
}

#[test]
fn context_block_is_none_when_empty_and_renders_the_board_otherwise() {
    let mut store = store();
    assert!(store.context_block().is_none());
    add_epic(&mut store, "core");
    add_issue(&mut store, "a", &[]);
    add_issue(&mut store, "b", &["a"]);
    let block = store.context_block().expect("a non-empty board renders");
    let text = block.content.clone().expect("the block has content");
    // The board block names the epics and issues and shows the ready/blocked state.
    assert!(text.contains("## Epics"));
    assert!(text.contains("`core`"));
    assert!(text.contains("`a`"));
    assert!(text.contains("[ready]"), "an unblocked open issue is ready");
    assert!(
        text.contains("[blocked by `a`]"),
        "b is shown blocked by a: {text}"
    );
    // The structured brief is rendered so the model always sees each issue's scope.
    assert!(text.contains("in scope:"));
    assert!(text.contains("out of scope:"));
    assert!(text.contains("done when:"));
}

// ---------------------------------------------------------------------------
// Caps resolution and the runtime
// ---------------------------------------------------------------------------

#[test]
fn caps_resolve_from_params_or_default() {
    assert_eq!(BoardCaps::resolve(&json!({})), BoardCaps::default());
    let caps = BoardCaps::resolve(&json!({ "maxEpics": 3, "maxIssues": 9 }));
    assert_eq!(caps.max_epics, 3);
    assert_eq!(caps.max_issues, 9);
    // Zero / non-integer are ignored in favor of the default.
    assert_eq!(
        BoardCaps::resolve(&json!({ "maxEpics": 0 })).max_epics,
        DEFAULT_MAX_EPICS
    );
}

#[test]
fn disabled_runtime_offers_nothing() {
    let runtime = BoardRuntime::disabled();
    assert!(!runtime.offers_board());
    assert!(runtime.state_event().is_none());
    assert!(runtime.context_block().is_none());
    assert_eq!(runtime.issue_count(), 0);
}

#[test]
fn enabled_runtime_offers_caps_and_state() {
    let runtime = BoardRuntime::new(BoardCaps::default());
    assert!(runtime.offers_board());
    // The ceilings the system prompt states come from the runtime.
    assert_eq!(runtime.caps(), BoardCaps::default());
    // At session start the board is empty: a state event exists, but no context block yet.
    assert!(matches!(
        runtime.state_event(),
        Some(GgTelemetryKind::BoardState { .. })
    ));
    assert!(runtime.context_block().is_none());
    // After a mutation through the shared store, the count and block reflect it.
    runtime
        .store()
        .lock()
        .unwrap()
        .create_issue("a", "a", None, "in", "out", "done", &[], None)
        .unwrap();
    assert_eq!(runtime.issue_count(), 1);
    assert!(runtime.context_block().is_some());
}
