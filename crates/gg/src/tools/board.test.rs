//! Tests for the board tools: the happy paths, the cycle guard surfaced as a tool error, and
//! argument validation. No network.

use std::sync::{Arc, Mutex};

use serde_json::json;
use tempfile::TempDir;

use super::*;
use crate::board::{BoardCaps, BoardStore, IssueStatus};
use crate::tools::ToolFailure;

/// The [`BoardUsageData`] an outcome carries, or a failure naming what it carried instead.
fn usage(outcome: &ToolOutcome) -> &BoardUsageData {
    match outcome.data.as_ref() {
        Some(ToolData::BoardUsage(data)) => data,
        other => panic!("expected board usage, got {other:?}"),
    }
}

/// A shared board store plus a throwaway workspace context.
fn fixture() -> (Arc<Mutex<BoardStore>>, ToolContext, TempDir) {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    (
        Arc::new(Mutex::new(BoardStore::new(BoardCaps::default()))),
        ctx,
        dir,
    )
}

/// The full argument set for a well-formed `create_issue` call.
fn issue_args(id: &str) -> serde_json::Value {
    json!({
        "id": id,
        "title": format!("Issue {id}"),
        "inScope": "the in-scope work",
        "outOfScope": "the out-of-scope work",
        "completionCriteria": "the acceptance criteria",
    })
}

#[tokio::test]
async fn create_epic_and_issue_report_usage() {
    let (store, ctx, _dir) = fixture();
    let epic = CreateEpicTool::new(Arc::clone(&store))
        .invoke(
            json!({ "id": "core", "title": "Core", "description": "the loop" }),
            &ctx,
        )
        .await;
    assert!(epic.ok);
    assert!(epic.output.contains("Created epic `core`"));

    let mut args = issue_args("render");
    args["epicId"] = json!("core");
    let issue = CreateIssueTool::new(Arc::clone(&store))
        .invoke(args, &ctx)
        .await;
    assert!(issue.ok, "{}", issue.output);
    assert!(issue.output.contains("Created issue `render`"));

    let store = store.lock().unwrap();
    assert_eq!(store.epic_count(), 1);
    assert_eq!(store.issue_count(), 1);
    assert_eq!(store.issues()[0].epic_id(), Some("core"));
}

#[tokio::test]
async fn create_issue_requires_the_structured_fields() {
    let (store, ctx, _dir) = fixture();
    // Missing completionCriteria => argument error from the tool.
    let outcome = CreateIssueTool::new(Arc::clone(&store))
        .invoke(
            json!({ "id": "i", "title": "t", "inScope": "a", "outOfScope": "b" }),
            &ctx,
        )
        .await;
    assert!(!outcome.ok);
    assert!(outcome.output.contains("completionCriteria"));
    assert_eq!(store.lock().unwrap().issue_count(), 0);
}

#[tokio::test]
async fn create_issue_with_blocked_by_records_the_edge() {
    let (store, ctx, _dir) = fixture();
    CreateIssueTool::new(Arc::clone(&store))
        .invoke(issue_args("a"), &ctx)
        .await;
    let mut args = issue_args("b");
    args["blockedBy"] = json!(["a"]);
    let outcome = CreateIssueTool::new(Arc::clone(&store))
        .invoke(args, &ctx)
        .await;
    assert!(outcome.ok);
    assert_eq!(
        store.lock().unwrap().issues()[1].blocked_by(),
        &["a".to_string()]
    );
}

#[tokio::test]
async fn set_issue_blocked_by_surfaces_a_cycle_as_a_tool_error_without_mutating() {
    let (store, ctx, _dir) = fixture();
    CreateIssueTool::new(Arc::clone(&store))
        .invoke(issue_args("a"), &ctx)
        .await;
    CreateIssueTool::new(Arc::clone(&store))
        .invoke(issue_args("b"), &ctx)
        .await;

    // b blocked by a is fine.
    let ok = SetIssueBlockedByTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "b", "blockedBy": ["a"] }), &ctx)
        .await;
    assert!(ok.ok);

    // a blocked by b would close a 2-cycle: refused, with guidance, nothing changes.
    let cyclic = SetIssueBlockedByTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a", "blockedBy": ["b"] }), &ctx)
        .await;
    assert!(!cyclic.ok);
    assert!(cyclic.output.contains("cycle"), "{}", cyclic.output);
    assert!(
        store.lock().unwrap().issues()[0].blocked_by().is_empty(),
        "the refused edge left the board unchanged"
    );
}

#[tokio::test]
async fn update_complete_and_remove_flow() {
    let (store, ctx, _dir) = fixture();
    CreateIssueTool::new(Arc::clone(&store))
        .invoke(issue_args("a"), &ctx)
        .await;

    let updated = UpdateIssueTool::new(Arc::clone(&store))
        .invoke(
            json!({ "id": "a", "status": "in_progress", "title": "Renamed" }),
            &ctx,
        )
        .await;
    assert!(updated.ok);
    assert_eq!(
        store.lock().unwrap().issues()[0].status(),
        IssueStatus::InProgress
    );

    let completed = CompleteIssueTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a" }), &ctx)
        .await;
    assert!(completed.ok);
    assert_eq!(
        store.lock().unwrap().issues()[0].status(),
        IssueStatus::Done
    );

    let removed = RemoveIssueTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a" }), &ctx)
        .await;
    assert!(removed.ok);
    assert_eq!(store.lock().unwrap().issue_count(), 0);
}

#[tokio::test]
async fn unknown_issue_is_a_recoverable_tool_error() {
    let (store, ctx, _dir) = fixture();
    let outcome = CompleteIssueTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "ghost" }), &ctx)
        .await;
    assert!(!outcome.ok);
    assert!(outcome.output.contains("ghost"));
}

// ---------------------------------------------------------------------------
// The structured sidecar and the classified failures
// ---------------------------------------------------------------------------

/// The four tools that change a population report both populations and both caps; a revision
/// reports nothing, because neither changed.
#[tokio::test]
async fn the_board_populations_are_reported_by_the_tools_that_change_them() {
    let (store, ctx, _dir) = fixture();
    let caps = BoardCaps::default();

    let epic = CreateEpicTool::new(Arc::clone(&store))
        .invoke(
            json!({ "id": "core", "title": "Core", "description": "the loop" }),
            &ctx,
        )
        .await;
    assert_eq!(
        usage(&epic),
        &BoardUsageData {
            epics: 1,
            max_epics: caps.max_epics as u32,
            issues: 0,
            max_issues: caps.max_issues as u32,
        }
    );

    let issue = CreateIssueTool::new(Arc::clone(&store))
        .invoke(issue_args("a"), &ctx)
        .await;
    assert_eq!(usage(&issue).issues, 1);

    let revised = UpdateIssueTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a", "title": "Renamed" }), &ctx)
        .await;
    assert_eq!(revised.data, None);

    let removed_issue = RemoveIssueTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a" }), &ctx)
        .await;
    assert_eq!(usage(&removed_issue).issues, 0);

    let removed_epic = RemoveEpicTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "core" }), &ctx)
        .await;
    assert_eq!(usage(&removed_epic).epics, 0);
}

/// Accepting an issue reports whether a Code Review gated it. On this path — the store's own,
/// with no reviewer in the loop — it did not, and a caller is told so rather than left to infer it
/// from the absence of a verdict.
#[tokio::test]
async fn completing_an_issue_reports_whether_a_review_gated_it() {
    let (store, ctx, _dir) = fixture();
    CreateIssueTool::new(Arc::clone(&store))
        .invoke(issue_args("a"), &ctx)
        .await;

    let completed = CompleteIssueTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a" }), &ctx)
        .await;

    assert_eq!(
        completed.data,
        Some(ToolData::Completion(CompletionData {
            code_reviewed: false,
            detail: "Marked issue `a` done.".to_string(),
        })),
        "the detail is the same text the model is shown"
    );
    assert_eq!(completed.output, "Marked issue `a` done.");
}

/// Each way the store can refuse is classified from its own error variant.
#[tokio::test]
async fn each_store_refusal_is_classified_from_its_variant() {
    let (store, ctx, _dir) = fixture();
    let create_issue = CreateIssueTool::new(Arc::clone(&store));

    create_issue.invoke(issue_args("a"), &ctx).await;
    create_issue.invoke(issue_args("b"), &ctx).await;

    // Taken ids and cycle-closing edges are conflicts with the board as it stands.
    let duplicate = create_issue.invoke(issue_args("a"), &ctx).await;
    assert_eq!(duplicate.failure, Some(ToolFailure::Conflict));

    let duplicate_epic = {
        let epic = json!({ "id": "core", "title": "Core", "description": "d" });
        CreateEpicTool::new(Arc::clone(&store))
            .invoke(epic.clone(), &ctx)
            .await;
        CreateEpicTool::new(Arc::clone(&store))
            .invoke(epic, &ctx)
            .await
    };
    assert_eq!(duplicate_epic.failure, Some(ToolFailure::Conflict));

    SetIssueBlockedByTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "b", "blockedBy": ["a"] }), &ctx)
        .await;
    let cycle = SetIssueBlockedByTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a", "blockedBy": ["b"] }), &ctx)
        .await;
    assert_eq!(cycle.failure, Some(ToolFailure::Conflict));

    // Anything named but absent — issue, epic, or blocker — is not-found.
    let unknown_issue = CompleteIssueTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "ghost" }), &ctx)
        .await;
    assert_eq!(unknown_issue.failure, Some(ToolFailure::NotFound));

    let unknown_epic = RemoveEpicTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "ghost" }), &ctx)
        .await;
    assert_eq!(unknown_epic.failure, Some(ToolFailure::NotFound));

    let unknown_grouping = UpdateIssueTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a", "epicId": "ghost" }), &ctx)
        .await;
    assert_eq!(unknown_grouping.failure, Some(ToolFailure::NotFound));

    let unknown_blocker = SetIssueBlockedByTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a", "blockedBy": ["ghost"] }), &ctx)
        .await;
    assert_eq!(unknown_blocker.failure, Some(ToolFailure::NotFound));

    // And everything the caller got wrong about the call itself is one class.
    for outcome in [
        create_issue
            .invoke(json!({ "id": "c", "title": "t", "inScope": "a" }), &ctx)
            .await,
        UpdateIssueTool::new(Arc::clone(&store))
            .invoke(json!({ "id": "a", "status": "nope" }), &ctx)
            .await,
        UpdateIssueTool::new(Arc::clone(&store))
            .invoke(json!({ "id": "a" }), &ctx)
            .await,
        SetIssueBlockedByTool::new(Arc::clone(&store))
            .invoke(json!({ "id": "a", "blockedBy": "b" }), &ctx)
            .await,
    ] {
        assert_eq!(
            outcome.failure,
            Some(ToolFailure::InvalidArgument),
            "{}",
            outcome.output
        );
    }
}

#[test]
fn is_board_tool_covers_every_mutator() {
    for name in [
        "create_epic",
        "create_issue",
        "update_issue",
        "set_issue_blocked_by",
        "complete_issue",
        "remove_epic",
        "remove_issue",
    ] {
        assert!(is_board_tool(name), "`{name}` should be a board tool");
    }
    assert!(!is_board_tool("add_task"));
    assert!(!is_board_tool("write_file"));
}
