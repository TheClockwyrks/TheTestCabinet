//! Tests for the task tools: the happy paths, the cycle guard surfaced as a tool error,
//! and argument validation. No network.

use std::sync::{Arc, Mutex};

use serde_json::json;
use tempfile::TempDir;

use super::*;
use crate::tasks::TaskStore;

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
        cyclic.output.contains("cycle") && cyclic.output.contains("DAG"),
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
