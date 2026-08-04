//! Tests for the task tools: the happy paths, the cycle guard surfaced as a tool error,
//! and argument validation. No network.

use std::sync::{Arc, Mutex};

use serde_json::json;
use tempfile::TempDir;

use super::*;
use crate::tasks::TaskStore;
use crate::tools::ToolFailure;

/// A shared store plus a throwaway workspace context.
fn fixture(max_tasks: usize) -> (Arc<Mutex<TaskStore>>, ToolContext, TempDir) {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    (Arc::new(Mutex::new(TaskStore::new(max_tasks))), ctx, dir)
}

#[tokio::test]
async fn add_task_creates_and_reports_usage() {
    let (store, ctx, _dir) = fixture(10);
    let tool = AddTaskTool::new(Arc::clone(&store));
    let outcome = tool
        .invoke(json!({ "id": "a", "title": "Build A" }), &ctx)
        .await;
    assert!(outcome.ok);
    assert!(outcome.output.contains("Added task `a`"));
    assert!(outcome.output.contains("1 of 10"));
    assert_eq!(store.lock().unwrap().count(), 1);
}

#[tokio::test]
async fn add_task_with_blocked_by_records_the_edge() {
    let (store, ctx, _dir) = fixture(10);
    AddTaskTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a", "title": "A" }), &ctx)
        .await;
    let outcome = AddTaskTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "b", "title": "B", "blockedBy": ["a"] }), &ctx)
        .await;
    assert!(outcome.ok);
    assert_eq!(
        store.lock().unwrap().tasks()[1].blocked_by(),
        &["a".to_string()]
    );
}

#[tokio::test]
async fn set_blocked_by_surfaces_a_cycle_as_a_tool_error_without_mutating() {
    let (store, ctx, _dir) = fixture(10);
    let add = |args| {
        let store = Arc::clone(&store);
        async move {
            AddTaskTool::new(store)
                .invoke(args, &ToolContext::new("."))
                .await
        }
    };
    add(json!({ "id": "a", "title": "A" })).await;
    add(json!({ "id": "b", "title": "B" })).await;

    // b blocked by a is fine.
    let ok = SetBlockedByTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "b", "blockedBy": ["a"] }), &ctx)
        .await;
    assert!(ok.ok);

    // a blocked by b would close a 2-cycle: refused, with guidance, and nothing changes.
    let cyclic = SetBlockedByTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a", "blockedBy": ["b"] }), &ctx)
        .await;
    assert!(!cyclic.ok, "a cycle-inducing edge must be refused");
    assert!(
        cyclic.output.contains("cycle"),
        "the refusal explains it would create a cycle: {}",
        cyclic.output
    );
    // `a` was left with no blockers — the refused edge did not partially apply.
    assert!(store.lock().unwrap().tasks()[0].blocked_by().is_empty());
}

#[tokio::test]
async fn update_and_complete_and_remove_round_trip() {
    let (store, ctx, _dir) = fixture(10);
    AddTaskTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a", "title": "A" }), &ctx)
        .await;

    // update status
    let updated = UpdateTaskTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a", "status": "in_progress" }), &ctx)
        .await;
    assert!(updated.ok);

    // an invalid status is refused with guidance
    let bad = UpdateTaskTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a", "status": "nope" }), &ctx)
        .await;
    assert!(!bad.ok);
    assert!(bad.output.contains("valid status"));

    // complete
    let done = CompleteTaskTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a" }), &ctx)
        .await;
    assert!(done.ok);

    // remove
    let removed = RemoveTaskTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a" }), &ctx)
        .await;
    assert!(removed.ok);
    assert_eq!(store.lock().unwrap().count(), 0);

    // removing a now-missing task fails
    let missing = RemoveTaskTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a" }), &ctx)
        .await;
    assert!(!missing.ok);
    assert!(missing.output.contains("no task"));
}

#[tokio::test]
async fn tools_validate_their_arguments() {
    let (store, ctx, _dir) = fixture(10);

    // add_task needs an id and title.
    let no_id = AddTaskTool::new(Arc::clone(&store))
        .invoke(json!({ "title": "A" }), &ctx)
        .await;
    assert!(!no_id.ok);
    assert!(no_id.output.contains("id"));

    // blockedBy must be an array of strings.
    let bad_blockers = AddTaskTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a", "title": "A", "blockedBy": "a" }), &ctx)
        .await;
    assert!(!bad_blockers.ok);
    assert!(bad_blockers.output.contains("array"));

    // set_blocked_by requires the blockedBy key (a missing one is a malformed call).
    AddTaskTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a", "title": "A" }), &ctx)
        .await;
    let missing_list = SetBlockedByTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a" }), &ctx)
        .await;
    assert!(!missing_list.ok);
    assert!(missing_list.output.contains("blockedBy"));
}

// ---------------------------------------------------------------------------
// The structured sidecar and the classified failures
// ---------------------------------------------------------------------------

/// The two tools that change how many tasks exist report the count and the cap; the three that
/// only revise one report nothing, because nothing structured changed.
#[tokio::test]
async fn the_task_count_is_reported_by_exactly_the_tools_that_change_it() {
    let (store, ctx, _dir) = fixture(10);

    let added = AddTaskTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a", "title": "A" }), &ctx)
        .await;
    assert_eq!(
        added.data,
        Some(ToolData::TaskUsage(UsagePair { count: 1, max: 10 }))
    );

    for outcome in [
        UpdateTaskTool::new(Arc::clone(&store))
            .invoke(json!({ "id": "a", "title": "A2" }), &ctx)
            .await,
        SetBlockedByTool::new(Arc::clone(&store))
            .invoke(json!({ "id": "a", "blockedBy": [] }), &ctx)
            .await,
        CompleteTaskTool::new(Arc::clone(&store))
            .invoke(json!({ "id": "a" }), &ctx)
            .await,
    ] {
        assert!(outcome.ok, "{}", outcome.output);
        assert_eq!(
            outcome.data, None,
            "a revision changes no count: {}",
            outcome.output
        );
    }

    let removed = RemoveTaskTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a" }), &ctx)
        .await;
    assert_eq!(
        removed.data,
        Some(ToolData::TaskUsage(UsagePair { count: 0, max: 10 }))
    );
}

/// Each way the store can refuse is classified from its own error variant.
#[tokio::test]
async fn each_store_refusal_is_classified_from_its_variant() {
    let (store, ctx, _dir) = fixture(2);
    let add = AddTaskTool::new(Arc::clone(&store));

    add.invoke(json!({ "id": "a", "title": "A" }), &ctx).await;

    // A taken id, and an edge that would close a loop, are both conflicts with the DAG as it
    // stands rather than malformed calls.
    let duplicate = add
        .invoke(json!({ "id": "a", "title": "again" }), &ctx)
        .await;
    assert_eq!(duplicate.failure, Some(ToolFailure::Conflict));

    add.invoke(json!({ "id": "b", "title": "B" }), &ctx).await;
    SetBlockedByTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "b", "blockedBy": ["a"] }), &ctx)
        .await;
    let cycle = SetBlockedByTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a", "blockedBy": ["b"] }), &ctx)
        .await;
    assert_eq!(cycle.failure, Some(ToolFailure::Conflict));

    let self_block = SetBlockedByTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a", "blockedBy": ["a"] }), &ctx)
        .await;
    assert_eq!(self_block.failure, Some(ToolFailure::Conflict));

    // A task that is not there — whether named as the subject or as a blocker — is not-found.
    let unknown = CompleteTaskTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "ghost" }), &ctx)
        .await;
    assert_eq!(unknown.failure, Some(ToolFailure::NotFound));

    let unknown_blocker = SetBlockedByTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a", "blockedBy": ["ghost"] }), &ctx)
        .await;
    assert_eq!(unknown_blocker.failure, Some(ToolFailure::NotFound));

    // The count cap is gg's ceiling, not a malformed call.
    let too_many = add.invoke(json!({ "id": "c", "title": "C" }), &ctx).await;
    assert_eq!(too_many.failure, Some(ToolFailure::LimitExceeded));

    // Everything the caller got wrong about the call itself is one class.
    for outcome in [
        add.invoke(json!({ "title": "no id" }), &ctx).await,
        add.invoke(json!({ "id": "d", "title": "D", "blockedBy": "a" }), &ctx)
            .await,
        SetBlockedByTool::new(Arc::clone(&store))
            .invoke(json!({ "id": "a" }), &ctx)
            .await,
        UpdateTaskTool::new(Arc::clone(&store))
            .invoke(json!({ "id": "a", "status": "nope" }), &ctx)
            .await,
        UpdateTaskTool::new(Arc::clone(&store))
            .invoke(json!({ "id": "a" }), &ctx)
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
fn is_task_tool_recognizes_the_mutators() {
    for name in [
        "add_task",
        "update_task",
        "set_blocked_by",
        "complete_task",
        "remove_task",
    ] {
        assert!(is_task_tool(name), "{name} should be a task tool");
    }
    assert!(!is_task_tool("write_file"));
    assert!(!is_task_tool("write_memory"));
}
