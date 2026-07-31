//! Tests for the project-management board store, its cycle guard, its invariants, and its
//! derivations.

use serde_json::json;

use super::*;
use test_cabinet_core::gg::{GgIssueStatus, GgTelemetryKind};

/// A store with generous caps for the board tests.
fn store() -> BoardStore {
    BoardStore::new(BoardCaps::default())
}

/// Create an epic from `prefix`, with a synthetic title/description, returning its id (the
/// upper-cased prefix).
fn add_epic(store: &mut BoardStore, prefix: &str) -> String {
    store
        .create_epic(prefix, prefix, "covers some work")
        .expect("create epic")
}

/// The agent profile the board tests assign every issue to. The store only requires an assignee to
/// be *named* — whether the filing agent may assign to it is the tool's check, not the store's — so
/// one stand-in name serves every case here.
const ASSIGNEE: &str = "worker";

/// A [`NewIssue`] from the fields the store tests vary, assigned to [`ASSIGNEE`] with no reviewers.
/// There is no id: the store assigns one (see [`add_issue`]).
#[allow(clippy::too_many_arguments)]
fn new_issue<'a>(
    title: &'a str,
    description: Option<&'a str>,
    in_scope: &'a str,
    out_of_scope: &'a str,
    completion_criteria: &'a str,
    blocked_by: &'a [String],
    epic_id: Option<&'a str>,
) -> NewIssue<'a> {
    NewIssue {
        title,
        description,
        in_scope,
        out_of_scope,
        completion_criteria,
        blocked_by,
        epic_id,
        agent: ASSIGNEE,
        reviewers: &[],
    }
}

/// Create a minimal-but-complete issue (all required structured fields present) with the given
/// blockers and no epic, returning the id the store assigned it.
fn add_issue(store: &mut BoardStore, title: &str, blocked_by: &[&str]) -> String {
    let blockers: Vec<String> = blocked_by.iter().map(|s| s.to_string()).collect();
    store
        .create_issue(new_issue(
            title,
            None,
            "in scope",
            "out of scope",
            "done when x",
            &blockers,
            None,
        ))
        .expect("create issue")
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
    let id = store
        .create_epic("core", "Core loop", "the heart of the game")
        .unwrap();
    assert_eq!(id, "CORE", "the prefix is the id, upper-cased");
    assert_eq!(store.epic_count(), 1);
    let epic = &store.epics()[0];
    assert_eq!(epic.id(), "CORE");
    assert_eq!(epic.title(), "Core loop");
    assert_eq!(epic.description(), "the heart of the game");

    assert_eq!(
        store.create_epic("core", "  ", "d"),
        Err(BoardError::EmptyField("title"))
    );
    assert_eq!(
        store.create_epic("core", "t", "  "),
        Err(BoardError::EmptyField("description"))
    );
    // Duplicates are judged on the normalized prefix, so a differently-cased one is the same epic.
    assert_eq!(
        store.create_epic("CoRe", "again", "dup"),
        Err(BoardError::DuplicateEpic("CORE".to_string()))
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
    let id = store
        .create_issue(new_issue(
            "Render loop",
            Some("draws the frame"),
            "clear and draw the canvas each frame",
            "input handling (separate issue)",
            "the player and goal are visible at 60fps",
            &[],
            Some("CORE"),
        ))
        .unwrap();
    assert_eq!(id, "CORE-1", "the store numbers the issue under its epic");
    let issue = &store.issues()[0];
    assert_eq!(issue.id(), "CORE-1");
    assert_eq!(issue.title(), "Render loop");
    assert_eq!(issue.description(), Some("draws the frame"));
    assert_eq!(issue.in_scope(), "clear and draw the canvas each frame");
    assert_eq!(issue.out_of_scope(), "input handling (separate issue)");
    assert_eq!(
        issue.completion_criteria(),
        "the player and goal are visible at 60fps"
    );
    assert_eq!(issue.status(), IssueStatus::Open);
    assert_eq!(issue.epic_id(), Some("CORE"));
    assert_eq!(issue.agent(), ASSIGNEE);
    assert!(issue.reviewers().is_empty());
}

#[test]
fn create_issue_records_its_assignee_and_deduplicated_reviewers() {
    let mut store = store();
    let id = store
        .create_issue(NewIssue {
            agent: "implementer",
            reviewers: &[
                "critic".to_string(),
                // A trimmed duplicate is one reviewer, not two.
                " critic ".to_string(),
                "auditor".to_string(),
            ],
            ..new_issue("Render", None, "in", "out", "done", &[], None)
        })
        .unwrap();
    let issue = &store.issues()[0];
    assert_eq!(issue.agent(), "implementer");
    assert_eq!(
        issue.reviewers(),
        ["critic".to_string(), "auditor".to_string()]
    );
    assert_eq!(store.issue_agent(&id), Some("implementer"));
    assert_eq!(store.issue_reviewers(&id).unwrap().len(), 2);
}

#[test]
fn create_issue_requires_an_assignee_and_refuses_a_blank_reviewer() {
    let mut store = store();
    // An issue with nobody to dispatch it to is refused — the assignee is what auto-dispatch runs.
    assert_eq!(
        store.create_issue(NewIssue {
            agent: "  ",
            ..new_issue("t", None, "in", "out", "done", &[], None)
        }),
        Err(BoardError::EmptyField("agent"))
    );
    assert_eq!(
        store.create_issue(NewIssue {
            reviewers: &[String::new()],
            ..new_issue("t", None, "in", "out", "done", &[], None)
        }),
        Err(BoardError::EmptyField("reviewers"))
    );
    assert_eq!(store.issue_count(), 0, "no partial issue was stored");
}

#[test]
fn create_issue_requires_the_dispatch_fields() {
    let mut store = store();
    // Missing title / inScope / outOfScope / completionCriteria are each refused, by name.
    assert_eq!(
        store.create_issue(new_issue("  ", None, "in", "out", "done", &[], None)),
        Err(BoardError::EmptyField("title"))
    );
    assert_eq!(
        store.create_issue(new_issue("t", None, "  ", "out", "done", &[], None)),
        Err(BoardError::EmptyField("inScope"))
    );
    assert_eq!(
        store.create_issue(new_issue("t", None, "in", "  ", "done", &[], None)),
        Err(BoardError::EmptyField("outOfScope"))
    );
    assert_eq!(
        store.create_issue(new_issue("t", None, "in", "out", "  ", &[], None)),
        Err(BoardError::EmptyField("completionCriteria"))
    );
    assert_eq!(store.issue_count(), 0, "no partial issue was stored");
}

/// Two issues with the same title are two issues — there is no duplicate-id failure left, because
/// the model does not supply one. An unknown epic is still refused, and refusing it must not consume
/// a number from any sequence.
#[test]
fn create_issue_numbers_duplicates_apart_and_rejects_an_unknown_epic() {
    let mut store = store();
    let first = add_issue(&mut store, "a", &[]);
    let second = add_issue(&mut store, "a", &[]);
    assert_eq!((first.as_str(), second.as_str()), ("ISSUE-1", "ISSUE-2"));
    assert_eq!(
        store.create_issue(new_issue(
            "t",
            None,
            "in",
            "out",
            "done",
            &[],
            Some("GHOST")
        )),
        Err(BoardError::UnknownEpic("GHOST".to_string()))
    );
    assert_eq!(issue_ids(&store), vec!["ISSUE-1", "ISSUE-2"]);
    assert_eq!(
        add_issue(&mut store, "a", &[]),
        "ISSUE-3",
        "a refused call did not burn a number"
    );
}

// ---------------------------------------------------------------------------
// Blocked-by edges and the cycle guard
// ---------------------------------------------------------------------------

#[test]
fn create_issue_with_a_blocked_by_edge_records_it() {
    let mut store = store();
    let a = add_issue(&mut store, "a", &[]);
    add_issue(&mut store, "b", &[&a]);
    assert_eq!(store.issues()[1].blocked_by(), &[a]);
}

#[test]
fn blocked_by_rejects_self_and_unknown_blockers() {
    let mut store = store();
    let a = add_issue(&mut store, "a", &[]);
    assert_eq!(
        store.set_issue_blocked_by(&a, std::slice::from_ref(&a)),
        Err(BoardError::SelfBlock(a.clone()))
    );
    assert_eq!(
        store.set_issue_blocked_by(&a, &["ghost".to_string()]),
        Err(BoardError::BlockerNotFound("ghost".to_string()))
    );
}

/// The heart of the DAG guard: an edge that would close a cycle is refused, and the board is
/// left unchanged.
#[test]
fn set_issue_blocked_by_rejects_a_cycle_without_mutating() {
    let mut store = store();
    let a = add_issue(&mut store, "a", &[]);
    let b = add_issue(&mut store, "b", &[&a]); // b depends on a
    // Blocking a on b would create a <-> b.
    assert_eq!(
        store.set_issue_blocked_by(&a, std::slice::from_ref(&b)),
        Err(BoardError::Cycle {
            issue: a.clone(),
            blocker: b,
        })
    );
    // Nothing changed: a still has no blockers.
    assert!(store.issues()[0].blocked_by().is_empty());
}

#[test]
fn a_chain_of_issues_builds_cleanly_and_closing_it_is_refused() {
    let mut store = store();
    let a = add_issue(&mut store, "a", &[]);
    let b = add_issue(&mut store, "b", &[&a]);
    // A newly created issue has no dependents, so the create path cannot close a cycle at all — a
    // longer chain simply builds.
    let c = add_issue(&mut store, "c", &[&b]);
    assert_eq!(issue_ids(&store), vec!["ISSUE-1", "ISSUE-2", "ISSUE-3"]);
    // Now a -> ... -> c is acyclic; blocking a on c closes a cycle a<-...<-c<-a.
    assert!(matches!(
        store.set_issue_blocked_by(&a, &[c]),
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
    let a = add_issue(&mut store, "a", &[]);
    assert_eq!(
        store.update_issue(&a, IssueUpdate::default()),
        Err(BoardError::NoUpdateFields)
    );
    store
        .update_issue(
            &a,
            IssueUpdate {
                title: Some("New title"),
                in_scope: Some("new scope"),
                status: Some(IssueStatus::InProgress),
                epic_id: Some("CORE"),
                ..IssueUpdate::default()
            },
        )
        .unwrap();
    let issue = &store.issues()[0];
    assert_eq!(issue.title(), "New title");
    assert_eq!(issue.in_scope(), "new scope");
    assert_eq!(issue.status(), IssueStatus::InProgress);
    assert_eq!(issue.epic_id(), Some("CORE"));
    // An empty epicId clears the grouping; a required field cannot be blanked.
    store
        .update_issue(
            &a,
            IssueUpdate {
                epic_id: Some(""),
                ..IssueUpdate::default()
            },
        )
        .unwrap();
    assert_eq!(store.issues()[0].epic_id(), None);
    assert_eq!(
        store.update_issue(
            &a,
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
    let a = add_issue(&mut store, "a", &[]);
    assert_eq!(
        store.update_issue(
            &a,
            IssueUpdate {
                epic_id: Some("GHOST"),
                ..IssueUpdate::default()
            }
        ),
        Err(BoardError::UnknownEpic("GHOST".to_string()))
    );
}

/// An agent finishing its issue is the **claim** that the work is done, not the acceptance:
/// gg moves the issue to `in review`, which does **not** unblock its dependents. Only
/// `accept_issue` — which the orchestrator calls after every reviewer approves and the issue's
/// worktree merges — marks it done and unblocks them.
///
/// The split is the whole point: a dependent dispatched off an issue whose work was still sitting
/// on an unmerged branch would be building on something that is not there.
#[test]
fn completing_an_issue_moves_it_to_review_and_only_acceptance_unblocks_dependents() {
    let mut store = store();
    let a = add_issue(&mut store, "a", &[]);
    add_issue(&mut store, "b", &[&a]);
    // b is not ready while a is open.
    assert!(!store.is_ready(&store.issues()[1].clone()));

    assert!(store.submit_issue_for_review(&a));
    assert_eq!(store.issues()[0].status(), IssueStatus::InReview);
    assert!(
        !store.issues()[0].status().is_terminal(),
        "an issue in review is not terminal — a review can send it back"
    );
    assert!(
        !store.is_ready(&store.issues()[1].clone()),
        "a dependent stays blocked while its blocker is only claimed complete"
    );

    assert!(store.accept_issue(&a));
    assert_eq!(store.issues()[0].status(), IssueStatus::Done);
    assert!(store.is_ready(&store.issues()[1].clone()));
    // Acceptance is idempotent-safe: an already-terminal issue is left alone.
    assert!(!store.accept_issue(&a));
    assert!(
        !store.submit_issue_for_review("ghost"),
        "an unknown id moves nothing"
    );
}

#[test]
fn remove_issue_strips_dangling_edges() {
    let mut store = store();
    let a = add_issue(&mut store, "a", &[]);
    let b = add_issue(&mut store, "b", &[&a]);
    store.remove_issue(&a).unwrap();
    assert_eq!(issue_ids(&store), vec![b.as_str()]);
    assert!(
        store.issues()[0].blocked_by().is_empty(),
        "the edge to the removed issue was dropped"
    );
}

#[test]
fn remove_epic_ungroups_its_issues() {
    let mut store = store();
    let core = add_epic(&mut store, "core");
    store
        .create_issue(new_issue("a", None, "in", "out", "done", &[], Some(&core)))
        .unwrap();
    store.remove_epic(&core).unwrap();
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
        ..BoardCaps::default()
    });
    add_epic(&mut store, "one");
    assert_eq!(
        store.create_epic("two", "t", "d"),
        Err(BoardError::CountCap {
            kind: "epic",
            cap: 1
        })
    );
    add_issue(&mut store, "i1", &[]);
    assert_eq!(
        store.create_issue(new_issue("t", None, "in", "out", "done", &[], None)),
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
    let core = add_epic(&mut store, "core");
    let render = store
        .create_issue(new_issue(
            "Render",
            None,
            "draw",
            "input",
            "visible",
            &[],
            Some(&core),
        ))
        .unwrap();
    store
        .create_issue(new_issue(
            "Input",
            None,
            "keys",
            "draw",
            "moves",
            std::slice::from_ref(&render),
            None,
        ))
        .unwrap();
    match store.state_event("board-0") {
        GgTelemetryKind::BoardState { epics, issues, .. } => {
            assert_eq!(epics.len(), 1);
            assert_eq!(epics[0].id, "CORE");
            assert_eq!(issues.len(), 2);
            assert_eq!(issues[0].id, "CORE-1");
            assert_eq!(issues[0].epic_id.as_deref(), Some("CORE"));
            assert_eq!(issues[0].status, GgIssueStatus::Open);
            assert_eq!(
                issues[1].id, "ISSUE-1",
                "an ungrouped issue is numbered apart"
            );
            assert_eq!(issues[1].blocked_by, vec![render]);
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
    let a = add_issue(&mut store, "a", &[]);
    add_issue(&mut store, "b", &[&a]);
    let block = store.context_block().expect("a non-empty board renders");
    let text = block.content.clone().expect("the block has content");
    // The board block names the epics and issues and shows the ready/blocked state.
    assert!(text.contains("## Epics"));
    assert!(text.contains("`CORE`"));
    assert!(text.contains("`ISSUE-1`"));
    assert!(text.contains("[ready]"), "an unblocked open issue is ready");
    assert!(
        text.contains("[blocked by `ISSUE-1`]"),
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
        .create_issue(new_issue("a", None, "in", "out", "done", &[], None))
        .unwrap();
    assert_eq!(runtime.issue_count(), 1);
    assert!(runtime.context_block().is_some());
}

// ---------------------------------------------------------------------------
// Auto-dispatch: dispatchable, assignment, retry, and failure
// ---------------------------------------------------------------------------

#[test]
fn max_retries_resolves_from_params_and_defaults() {
    assert_eq!(BoardCaps::default().max_retries, DEFAULT_MAX_RETRIES);
    assert_eq!(
        BoardCaps::resolve(&json!({ "maxRetries": 3 })).max_retries,
        3
    );
    // Zero is a valid retry count (one attempt only); a missing value keeps the default.
    assert_eq!(
        BoardCaps::resolve(&json!({ "maxRetries": 0 })).max_retries,
        0
    );
    assert_eq!(
        BoardCaps::resolve(&json!({})).max_retries,
        DEFAULT_MAX_RETRIES
    );
}

#[test]
fn only_open_unassigned_issues_with_done_blockers_are_dispatchable() {
    let mut store = store();
    let a = add_issue(&mut store, "a", &[]);
    let b = add_issue(&mut store, "b", &[&a]);
    // `a` is actionable (no blockers); `b` is blocked by the not-yet-done `a`.
    assert_eq!(store.dispatchable_ids(), vec![a.clone()]);

    // Claim `a`: it moves to in-progress, names its implementer, and is no longer dispatchable
    // (nor re-claimable).
    assert_eq!(store.assign_issue(&a).as_deref(), Some("ISSUE-1.0i"));
    assert_eq!(store.issue_status(&a), Some(IssueStatus::InProgress));
    assert!(store.dispatchable_ids().is_empty());
    assert_eq!(
        store.assign_issue(&a),
        None,
        "a second claim of the same issue is refused, and mints no id"
    );

    // Completing `a` only claims it; accepting it is what unblocks `b`.
    assert!(store.submit_issue_for_review(&a));
    assert!(
        store.dispatchable_ids().is_empty(),
        "a dependent is not dispatchable until its blocker is accepted"
    );
    assert!(store.accept_issue(&a));
    assert_eq!(store.dispatchable_ids(), vec![b]);
}

#[test]
fn a_failed_blocker_leaves_dependents_blocked() {
    let mut store = store();
    let a = add_issue(&mut store, "a", &[]);
    add_issue(&mut store, "b", &[&a]);
    store.assign_issue(&a);
    // `a` fails: it is terminal but not done, so `b` never becomes dispatchable.
    assert!(store.fail_issue(&a));
    assert_eq!(store.issue_status(&a), Some(IssueStatus::Failed));
    assert!(store.issue_status(&a).unwrap().is_terminal());
    assert_ne!(store.issue_status(&a), Some(IssueStatus::Done));
    assert!(
        store.dispatchable_ids().is_empty(),
        "a dependent of a failed issue stays blocked"
    );
}

#[test]
fn redispatch_reassigns_and_records_the_retry_count() {
    let mut store = store();
    let a = add_issue(&mut store, "a", &[]);
    assert_eq!(store.assign_issue(&a).as_deref(), Some("ISSUE-1.0i"));
    // A second attempt mints the next implementer and records the retry.
    assert_eq!(store.redispatch_issue(&a, 1).as_deref(), Some("ISSUE-1.1i"));
    let issue = store.issues().iter().find(|i| i.id() == a).unwrap();
    assert_eq!(issue.status(), IssueStatus::InProgress);
    assert_eq!(issue.assigned_agent(), Some("ISSUE-1.1i"));
    assert_eq!(issue.retries(), 1);
    // An issue in review IS re-dispatchable — that is how a review round sends it back for
    // rework, with its retry count carried through unchanged.
    assert!(store.submit_issue_for_review(&a));
    assert_eq!(
        store.redispatch_issue(&a, 1).as_deref(),
        Some("ISSUE-1.2i"),
        "every attempt at an issue is numbered, whether or not it was a retry"
    );
    let issue = store.issues().iter().find(|i| i.id() == a).unwrap();
    assert_eq!(issue.status(), IssueStatus::InProgress);
    assert_eq!(issue.retries(), 1, "rework does not burn the retry budget");
    // A terminal issue is never re-dispatched.
    assert!(store.accept_issue(&a));
    assert_eq!(store.redispatch_issue(&a, 2), None);
}

#[test]
fn a_failed_issue_status_round_trips_to_the_contract() {
    let mut store = store();
    let id = add_issue(&mut store, "a", &[]);
    store.assign_issue(&id);
    store.fail_issue(&id);
    let GgTelemetryKind::BoardState { issues, .. } = runtime_state(&store) else {
        panic!("board state");
    };
    let a = issues.iter().find(|i| i.id == id).unwrap();
    assert_eq!(a.status, GgIssueStatus::Failed);
    assert_eq!(
        a.assigned_agent_id.as_deref(),
        Some("ISSUE-1.0i"),
        "the last agent that worked it is kept after a terminal state"
    );
}

/// The board's telemetry state, for the contract-mapping assertions.
fn runtime_state(store: &BoardStore) -> GgTelemetryKind {
    let runtime = BoardRuntime::new(store.caps());
    *runtime.store().lock().unwrap() = store.clone();
    runtime.state_event().expect("enabled runtime state")
}
