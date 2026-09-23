//! Tests for the task tools: the happy paths, the cycle guard surfaced as a tool error,
//! and argument validation. No network.

use std::sync::{Arc, Mutex};

use serde_json::json;
use tempfile::TempDir;

use super::*;
use crate::tasks::{TaskMode, TaskStore};
use crate::tools::ToolFailure;

/// A shared store plus a throwaway workspace context.
fn fixture(max_tasks: usize) -> (Arc<Mutex<TaskStore>>, ToolContext, TempDir) {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    (Arc::new(Mutex::new(TaskStore::new(max_tasks))), ctx, dir)
}

/// The same triple over an [issues](TaskMode::Issues)-mode store — the shape that requires every
/// task to carry its three structured sections.
fn issues_fixture(max_tasks: usize) -> (Arc<Mutex<TaskStore>>, ToolContext, TempDir) {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    (
        Arc::new(Mutex::new(TaskStore::with_mode(
            max_tasks,
            TaskMode::Issues,
        ))),
        ctx,
        dir,
    )
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
        Some(ApiData::TaskUsage(UsagePair { count: 1, max: 10 }))
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
        Some(ApiData::TaskUsage(UsagePair { count: 0, max: 10 }))
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

// ---------------------------------------------------------------------------
// Issues mode: the three structured sections
// ---------------------------------------------------------------------------

/// The arguments an issues-mode `add_task` must carry, as a whole, well-formed call.
fn issues_add_args() -> Value {
    json!({
        "id": "a",
        "title": "A",
        "inScope": "the parser",
        "outOfScope": "the renderer",
        "completionCriteria": "the suite is green"
    })
}

#[tokio::test]
async fn an_issues_mode_task_carries_its_three_sections() {
    let (store, ctx, _dir) = issues_fixture(10);
    let outcome = AddTaskTool::new(Arc::clone(&store))
        .invoke(issues_add_args(), &ctx)
        .await;
    assert!(outcome.ok, "{}", outcome.output);

    let store = store.lock().unwrap();
    let task = &store.tasks()[0];
    assert_eq!(task.in_scope(), Some("the parser"));
    assert_eq!(task.out_of_scope(), Some("the renderer"));
    assert_eq!(task.completion_criteria(), Some("the suite is green"));
}

#[tokio::test]
async fn an_issues_mode_task_missing_a_section_is_an_argument_error() {
    for field in ["inScope", "outOfScope", "completionCriteria"] {
        let (store, ctx, _dir) = issues_fixture(10);
        let mut args = issues_add_args();
        args.as_object_mut().unwrap().remove(field);
        let outcome = AddTaskTool::new(Arc::clone(&store))
            .invoke(args, &ctx)
            .await;
        assert_eq!(
            outcome.failure,
            Some(ToolFailure::InvalidArgument),
            "{field}: {}",
            outcome.output
        );
        assert!(
            outcome.output.contains(field),
            "the refusal names the absent section: {}",
            outcome.output
        );
        assert_eq!(store.lock().unwrap().count(), 0, "nothing was added");
    }
}

#[tokio::test]
async fn an_issues_mode_section_that_is_not_a_string_is_an_argument_error() {
    let (store, ctx, _dir) = issues_fixture(10);
    let mut args = issues_add_args();
    args.as_object_mut()
        .unwrap()
        .insert("inScope".to_string(), json!(7));
    let outcome = AddTaskTool::new(Arc::clone(&store))
        .invoke(args, &ctx)
        .await;
    assert_eq!(outcome.failure, Some(ToolFailure::InvalidArgument));
    assert!(
        outcome.output.contains("inScope") && outcome.output.contains("string"),
        "{}",
        outcome.output
    );
    // `read_structured` refused before the store was reached.
    assert_eq!(store.lock().unwrap().count(), 0);
}

#[tokio::test]
async fn the_add_task_schema_declares_its_sections_only_in_issues_mode() {
    let sections = ["inScope", "outOfScope", "completionCriteria"];

    let (simple, _ctx, _dir) = fixture(10);
    let simple = AddTaskTool::new(simple).definition();
    let properties = simple.parameters["properties"].as_object().unwrap();
    let required = simple.parameters["required"].as_array().unwrap();
    for section in sections {
        assert!(
            !properties.contains_key(section),
            "simple mode declares no `{section}` property"
        );
        assert!(
            !required.iter().any(|name| name == section),
            "simple mode does not require `{section}`"
        );
    }

    let (issues, _ctx, _dir) = issues_fixture(10);
    let issues = AddTaskTool::new(issues).definition();
    let properties = issues.parameters["properties"].as_object().unwrap();
    let required = issues.parameters["required"].as_array().unwrap();
    for section in sections {
        assert_eq!(
            properties[section]["type"], "string",
            "issues mode declares `{section}` as a string"
        );
        assert!(
            required.iter().any(|name| name == section),
            "issues mode requires `{section}`"
        );
    }
}

#[tokio::test]
async fn an_issues_mode_update_may_revise_one_section() {
    let (store, ctx, _dir) = issues_fixture(10);
    AddTaskTool::new(Arc::clone(&store))
        .invoke(issues_add_args(), &ctx)
        .await;

    let outcome = UpdateTaskTool::new(Arc::clone(&store))
        .invoke(
            json!({ "id": "a", "completionCriteria": "the gates are green" }),
            &ctx,
        )
        .await;
    assert!(outcome.ok, "{}", outcome.output);

    let store = store.lock().unwrap();
    let task = &store.tasks()[0];
    assert_eq!(task.completion_criteria(), Some("the gates are green"));
    assert_eq!(task.in_scope(), Some("the parser"));
    assert_eq!(task.out_of_scope(), Some("the renderer"));
}

#[tokio::test]
async fn an_issues_mode_update_with_an_ill_typed_section_is_an_argument_error() {
    let (store, ctx, _dir) = issues_fixture(10);
    AddTaskTool::new(Arc::clone(&store))
        .invoke(issues_add_args(), &ctx)
        .await;

    let outcome = UpdateTaskTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a", "outOfScope": [] }), &ctx)
        .await;
    assert_eq!(outcome.failure, Some(ToolFailure::InvalidArgument));
    assert!(outcome.output.contains("outOfScope"), "{}", outcome.output);
    assert_eq!(
        store.lock().unwrap().tasks()[0].out_of_scope(),
        Some("the renderer"),
        "the refused revision applied nothing"
    );
}

// ---------------------------------------------------------------------------
// Unknown ids and the per-tool argument diagnostics
// ---------------------------------------------------------------------------

/// A store holding one task `a`, for the calls that need a subject that does exist.
async fn one_task(max_tasks: usize) -> (Arc<Mutex<TaskStore>>, ToolContext, TempDir) {
    let (store, ctx, dir) = fixture(max_tasks);
    AddTaskTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a", "title": "A" }), &ctx)
        .await;
    (store, ctx, dir)
}

#[tokio::test]
async fn an_update_of_an_unknown_task_is_not_found() {
    let (store, ctx, _dir) = one_task(10).await;
    let outcome = UpdateTaskTool::new(store)
        .invoke(json!({ "id": "ghost", "title": "T" }), &ctx)
        .await;
    assert_eq!(outcome.failure, Some(ToolFailure::NotFound));
    assert!(outcome.output.contains("ghost"), "{}", outcome.output);
}

#[tokio::test]
async fn an_update_missing_its_id_is_an_argument_error() {
    let (store, ctx, _dir) = one_task(10).await;
    let outcome = UpdateTaskTool::new(store)
        .invoke(json!({ "title": "T" }), &ctx)
        .await;
    assert_eq!(outcome.failure, Some(ToolFailure::InvalidArgument));
    assert!(outcome.output.contains("id"), "{}", outcome.output);
}

#[tokio::test]
async fn an_update_with_an_ill_typed_title_is_an_argument_error() {
    let (store, ctx, _dir) = one_task(10).await;

    let title = UpdateTaskTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a", "title": 7 }), &ctx)
        .await;
    assert_eq!(title.failure, Some(ToolFailure::InvalidArgument));
    assert!(
        title.output.contains("title") && title.output.contains("string"),
        "{}",
        title.output
    );

    let description = UpdateTaskTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a", "description": 7 }), &ctx)
        .await;
    assert_eq!(description.failure, Some(ToolFailure::InvalidArgument));
    assert!(
        description.output.contains("description") && description.output.contains("string"),
        "{}",
        description.output
    );

    assert_eq!(
        store.lock().unwrap().tasks()[0].title(),
        "A",
        "neither refused revision applied"
    );
}

#[tokio::test]
async fn blocking_an_unknown_task_is_not_found() {
    let (store, ctx, _dir) = one_task(10).await;
    let outcome = SetBlockedByTool::new(store)
        .invoke(json!({ "id": "ghost", "blockedBy": ["a"] }), &ctx)
        .await;
    assert_eq!(outcome.failure, Some(ToolFailure::NotFound));
    assert!(outcome.output.contains("ghost"), "{}", outcome.output);
}

#[tokio::test]
async fn a_set_blocked_by_missing_its_id_is_an_argument_error() {
    let (store, ctx, _dir) = one_task(10).await;

    let absent = SetBlockedByTool::new(Arc::clone(&store))
        .invoke(json!({ "blockedBy": [] }), &ctx)
        .await;
    assert_eq!(absent.failure, Some(ToolFailure::InvalidArgument));
    assert!(absent.output.contains("id"), "{}", absent.output);

    let ill_typed = SetBlockedByTool::new(store)
        .invoke(json!({ "id": 1, "blockedBy": [] }), &ctx)
        .await;
    assert_eq!(ill_typed.failure, Some(ToolFailure::InvalidArgument));
    assert!(ill_typed.output.contains("string"), "{}", ill_typed.output);
}

#[tokio::test]
async fn completing_an_unknown_task_is_not_found() {
    let (store, ctx, _dir) = one_task(10).await;
    let outcome = CompleteTaskTool::new(store)
        .invoke(json!({ "id": "ghost" }), &ctx)
        .await;
    assert_eq!(outcome.failure, Some(ToolFailure::NotFound));
    assert!(outcome.output.contains("ghost"), "{}", outcome.output);
}

#[tokio::test]
async fn a_complete_missing_its_id_is_an_argument_error() {
    let (store, ctx, _dir) = one_task(10).await;

    let absent = CompleteTaskTool::new(Arc::clone(&store))
        .invoke(json!({}), &ctx)
        .await;
    assert_eq!(absent.failure, Some(ToolFailure::InvalidArgument));
    assert!(absent.output.contains("id"), "{}", absent.output);

    let ill_typed = CompleteTaskTool::new(store)
        .invoke(json!({ "id": 1 }), &ctx)
        .await;
    assert_eq!(ill_typed.failure, Some(ToolFailure::InvalidArgument));
    assert!(ill_typed.output.contains("string"), "{}", ill_typed.output);
}

#[tokio::test]
async fn removing_an_unknown_task_is_not_found() {
    let (store, ctx, _dir) = one_task(10).await;
    let outcome = RemoveTaskTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "ghost" }), &ctx)
        .await;
    assert_eq!(outcome.failure, Some(ToolFailure::NotFound));
    assert_eq!(store.lock().unwrap().count(), 1, "nothing was removed");
}

#[tokio::test]
async fn a_remove_missing_its_id_is_an_argument_error() {
    let (store, ctx, _dir) = one_task(10).await;

    let absent = RemoveTaskTool::new(Arc::clone(&store))
        .invoke(json!({}), &ctx)
        .await;
    assert_eq!(absent.failure, Some(ToolFailure::InvalidArgument));
    assert!(absent.output.contains("id"), "{}", absent.output);

    let ill_typed = RemoveTaskTool::new(Arc::clone(&store))
        .invoke(json!({ "id": null }), &ctx)
        .await;
    assert_eq!(ill_typed.failure, Some(ToolFailure::InvalidArgument));
    assert!(ill_typed.output.contains("id"), "{}", ill_typed.output);

    assert_eq!(store.lock().unwrap().count(), 1);
}

/// `remove_task` strips the removed id from every other task's blockers, so removing a blocker
/// leaves the tasks it blocked unblocked rather than pointing at a task that is gone.
#[tokio::test]
async fn removing_a_blocker_unblocks_the_tasks_it_blocked() {
    let (store, ctx, _dir) = fixture(10);
    let add = AddTaskTool::new(Arc::clone(&store));
    add.invoke(json!({ "id": "a", "title": "A" }), &ctx).await;
    add.invoke(json!({ "id": "b", "title": "B", "blockedBy": ["a"] }), &ctx)
        .await;
    assert_eq!(
        store.lock().unwrap().tasks()[1].blocked_by(),
        &["a".to_string()]
    );

    let removed = RemoveTaskTool::new(Arc::clone(&store))
        .invoke(json!({ "id": "a" }), &ctx)
        .await;
    assert!(removed.ok, "{}", removed.output);

    let store = store.lock().unwrap();
    assert_eq!(store.count(), 1);
    assert!(
        store.tasks()[0].blocked_by().is_empty(),
        "the dependent is left unblocked"
    );
}
