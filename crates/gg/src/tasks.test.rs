//! Tests for the tasks capability's DAG store, its cycle guard, and its derivations.

use serde_json::json;

use super::*;
use crate::validate::{LaunchDefect, LaunchReport};
use test_cabinet_core::gg::{GgTaskStatus, GgTelemetryKind};

/// The ceiling `params` resolves to, asserting gg honoured it exactly as written.
fn max_tasks(params: Value) -> usize {
    let mut report = LaunchReport::collecting();
    let max = resolve_max_tasks(&params, &mut report);
    let defects = report.into_defects();
    assert!(defects.is_empty(), "unexpected refusals: {defects:?}");
    max
}

/// The mode `params` resolves to, asserting gg honoured it exactly as written.
fn task_mode(params: Value) -> TaskMode {
    let mut report = LaunchReport::collecting();
    let mode = resolve_task_mode(&params, &mut report);
    let defects = report.into_defects();
    assert!(defects.is_empty(), "unexpected refusals: {defects:?}");
    mode
}

/// Everything `read` reports, for the cases whose subject is the refusal.
fn reported(read: impl FnOnce(&mut LaunchReport)) -> Vec<LaunchDefect> {
    let mut report = LaunchReport::collecting();
    read(&mut report);
    report.into_defects()
}

/// A store with a generous cap for the DAG tests.
fn store() -> TaskStore {
    TaskStore::new(DEFAULT_MAX_TASKS)
}

/// Add a task with just an id and title (no description, no blockers).
fn add(store: &mut TaskStore, id: &str) {
    store
        .add(id, id, None, StructuredFields::default(), &[])
        .expect("add task");
}

/// The tasks' ids in list order.
fn ids(store: &TaskStore) -> Vec<&str> {
    store.tasks().iter().map(Task::id).collect()
}

// ---------------------------------------------------------------------------
// Add / update / complete / remove
// ---------------------------------------------------------------------------

#[test]
fn add_creates_a_pending_task_in_add_order() {
    let mut store = store();
    add(&mut store, "a");
    store
        .add(
            "b",
            "Build B",
            Some("the second task"),
            StructuredFields::default(),
            &[],
        )
        .unwrap();
    assert_eq!(ids(&store), vec!["a", "b"]);
    let b = &store.tasks()[1];
    assert_eq!(b.title(), "Build B");
    assert_eq!(b.description(), Some("the second task"));
    assert_eq!(b.status(), TaskStatus::Pending);
    assert!(b.blocked_by().is_empty());
}

#[test]
fn add_rejects_empty_fields_and_duplicates() {
    let mut store = store();
    assert_eq!(
        store.add("", "t", None, StructuredFields::default(), &[]),
        Err(TaskError::EmptyField("id"))
    );
    assert_eq!(
        store.add("a", "  ", None, StructuredFields::default(), &[]),
        Err(TaskError::EmptyField("title"))
    );
    add(&mut store, "a");
    assert_eq!(
        store.add("a", "again", None, StructuredFields::default(), &[]),
        Err(TaskError::Duplicate("a".to_string()))
    );
    // The rejected duplicate did not add a second entry.
    assert_eq!(store.count(), 1);
}

#[test]
fn add_enforces_the_count_cap() {
    let mut store = TaskStore::new(1);
    add(&mut store, "a");
    assert_eq!(
        store.add("b", "B", None, StructuredFields::default(), &[]),
        Err(TaskError::CountCap { cap: 1 })
    );
    assert_eq!(store.count(), 1);
}

#[test]
fn update_changes_fields_and_requires_at_least_one() {
    let mut store = store();
    add(&mut store, "a");
    assert_eq!(
        store.update("a", None, None, None, StructuredFields::default()),
        Err(TaskError::NoUpdateFields)
    );
    store
        .update(
            "a",
            Some("New title"),
            None,
            Some(TaskStatus::InProgress),
            StructuredFields::default(),
        )
        .unwrap();
    assert_eq!(store.tasks()[0].title(), "New title");
    assert_eq!(store.tasks()[0].status(), TaskStatus::InProgress);
    // An empty description clears it.
    store
        .update("a", None, Some(""), None, StructuredFields::default())
        .unwrap();
    assert_eq!(store.tasks()[0].description(), None);
    // Updating an unknown task fails.
    assert_eq!(
        store.update(
            "missing",
            Some("x"),
            None,
            None,
            StructuredFields::default()
        ),
        Err(TaskError::NotFound("missing".to_string()))
    );
}

#[test]
fn complete_marks_done_and_unblocks_dependents() {
    let mut store = store();
    add(&mut store, "a");
    add(&mut store, "b");
    store.set_blocked_by("b", &["a".to_string()]).unwrap();
    // `b` is blocked until `a` is done.
    assert!(!store.is_ready(&store.tasks()[1]));
    store.complete("a").unwrap();
    assert_eq!(store.tasks()[0].status(), TaskStatus::Done);
    // Now `b` is actionable.
    assert!(store.is_ready(&store.tasks()[1]));
}

#[test]
fn remove_strips_dangling_blocked_by_edges() {
    let mut store = store();
    add(&mut store, "a");
    add(&mut store, "b");
    store.set_blocked_by("b", &["a".to_string()]).unwrap();
    store.remove("a").unwrap();
    assert_eq!(ids(&store), vec!["b"]);
    // The edge to the removed task is gone, so `b` is not left blocked by a ghost.
    assert!(store.tasks()[0].blocked_by().is_empty());
    assert_eq!(
        store.remove("missing"),
        Err(TaskError::NotFound("missing".to_string()))
    );
}

// ---------------------------------------------------------------------------
// Blocked-by edges and existence
// ---------------------------------------------------------------------------

#[test]
fn set_blocked_by_replaces_the_set_and_dedupes() {
    let mut store = store();
    add(&mut store, "a");
    add(&mut store, "b");
    add(&mut store, "c");
    // A duplicate blocker collapses to one; order is preserved.
    store
        .set_blocked_by("c", &["a".to_string(), "b".to_string(), "a".to_string()])
        .unwrap();
    assert_eq!(
        store.tasks()[2].blocked_by(),
        &["a".to_string(), "b".to_string()]
    );
    // Setting again replaces (does not append).
    store.set_blocked_by("c", &["b".to_string()]).unwrap();
    assert_eq!(store.tasks()[2].blocked_by(), &["b".to_string()]);
    // Clearing with an empty set.
    store.set_blocked_by("c", &[]).unwrap();
    assert!(store.tasks()[2].blocked_by().is_empty());
}

#[test]
fn blocked_by_rejects_unknown_and_self_references() {
    let mut store = store();
    add(&mut store, "a");
    assert_eq!(
        store.set_blocked_by("a", &["ghost".to_string()]),
        Err(TaskError::BlockerNotFound("ghost".to_string()))
    );
    assert_eq!(
        store.set_blocked_by("a", &["a".to_string()]),
        Err(TaskError::SelfBlock("a".to_string()))
    );
    // A refused edge left the task's blockers untouched.
    assert!(store.tasks()[0].blocked_by().is_empty());
    // Adding a task that references a non-existent blocker also fails.
    assert_eq!(
        store.add(
            "b",
            "B",
            None,
            StructuredFields::default(),
            &["ghost".to_string()]
        ),
        Err(TaskError::BlockerNotFound("ghost".to_string()))
    );
    assert_eq!(store.count(), 1);
}

// ---------------------------------------------------------------------------
// The cycle guard — the hard requirement
// ---------------------------------------------------------------------------

#[test]
fn set_blocked_by_rejects_a_cycle_and_mutates_nothing() {
    let mut store = store();
    add(&mut store, "a");
    add(&mut store, "b");
    add(&mut store, "c");
    // Build a chain a <- b <- c (b blocked by a, c blocked by b).
    store.set_blocked_by("b", &["a".to_string()]).unwrap();
    store.set_blocked_by("c", &["b".to_string()]).unwrap();
    // Closing the loop — a blocked by c — is refused: c already depends on a.
    assert_eq!(
        store.set_blocked_by("a", &["c".to_string()]),
        Err(TaskError::Cycle {
            task: "a".to_string(),
            blocker: "c".to_string(),
        })
    );
    // Nothing changed: `a` still has no blockers, and the chain is intact.
    assert!(store.tasks()[0].blocked_by().is_empty());
    assert_eq!(store.tasks()[1].blocked_by(), &["a".to_string()]);
    assert_eq!(store.tasks()[2].blocked_by(), &["b".to_string()]);
}

#[test]
fn direct_two_cycle_is_rejected() {
    let mut store = store();
    add(&mut store, "a");
    add(&mut store, "b");
    store.set_blocked_by("a", &["b".to_string()]).unwrap();
    // b blocked by a would close a 2-cycle a <-> b.
    assert!(matches!(
        store.set_blocked_by("b", &["a".to_string()]),
        Err(TaskError::Cycle { .. })
    ));
}

#[test]
fn add_with_a_forward_blocker_is_acyclic_and_allowed() {
    let mut store = store();
    add(&mut store, "a");
    // A brand-new task can be blocked by an existing one without any cycle risk (it has no
    // dependents yet).
    store
        .add(
            "b",
            "B",
            None,
            StructuredFields::default(),
            &["a".to_string()],
        )
        .expect("forward edge is fine");
    assert_eq!(store.tasks()[1].blocked_by(), &["a".to_string()]);
}

// ---------------------------------------------------------------------------
// Derivations: telemetry, the pinned context block, caps resolution
// ---------------------------------------------------------------------------

#[test]
fn state_event_reports_the_dag_in_add_order() {
    let mut store = store();
    add(&mut store, "a");
    add(&mut store, "b");
    store.set_blocked_by("b", &["a".to_string()]).unwrap();
    store.complete("a").unwrap();
    let GgTelemetryKind::TasksState { tasks, .. } = store.state_event("tasks-0") else {
        panic!("expected TasksState");
    };
    assert_eq!(tasks.len(), 2);
    assert_eq!(tasks[0].id, "a");
    assert_eq!(tasks[0].status, GgTaskStatus::Done);
    assert_eq!(tasks[1].id, "b");
    assert_eq!(tasks[1].blocked_by, vec!["a".to_string()]);
}

#[test]
fn context_block_surfaces_ready_vs_blocked() {
    let mut store = store();
    add(&mut store, "scaffold");
    add(&mut store, "movement");
    store
        .set_blocked_by("movement", &["scaffold".to_string()])
        .unwrap();

    // While the scaffold is pending, movement is blocked by it.
    let blocked = store.context_block().expect("a block").content.unwrap();
    assert!(blocked.contains("`scaffold`"));
    assert!(
        blocked.contains("[ready]"),
        "an unblocked task is marked ready"
    );
    assert!(
        blocked.contains("[blocked by `scaffold`]"),
        "the blocked task names its incomplete blocker"
    );

    // Completing the scaffold flips movement to ready.
    store.complete("scaffold").unwrap();
    let ready = store.context_block().expect("a block").content.unwrap();
    assert!(
        !ready.contains("[blocked by"),
        "no task remains blocked once the blocker is done"
    );

    // An empty store has no block.
    assert!(TaskStore::new(10).context_block().is_none());
}

#[test]
fn resolve_max_tasks_reads_the_param_or_defaults() {
    assert_eq!(max_tasks(json!({})), DEFAULT_MAX_TASKS);
    assert_eq!(max_tasks(json!({ "maxTasks": 5 })), 5);
    // An integral float names the same count, and an explicit `null` is an absence.
    assert_eq!(max_tasks(json!({ "maxTasks": 5.0 })), 5);
    assert_eq!(max_tasks(json!({ "maxTasks": null })), DEFAULT_MAX_TASKS);
}

#[test]
fn a_max_tasks_gg_cannot_honour_is_refused() {
    // A list the model may never add to offers `add_task` and refuses every use of it, and a
    // ceiling gg cannot read at all would silently bound the plan at a number nobody wrote.
    for params in [json!({ "maxTasks": 0 }), json!({ "maxTasks": "lots" })] {
        let defects = reported(|report| {
            resolve_max_tasks(&params, report);
        });
        assert_eq!(defects.len(), 1, "{params}: {defects:?}");
        assert_eq!(defects[0].locus, "tasks.params.maxTasks", "{params}");
    }
}

// ---------------------------------------------------------------------------
// The capability switch
// ---------------------------------------------------------------------------

#[test]
fn disabled_runtime_offers_nothing() {
    let runtime = TasksRuntime::disabled();
    assert!(!runtime.offers_tasks());
    assert!(runtime.state_event().is_none());
    assert!(runtime.context_block().is_none());
}

#[test]
fn enabled_runtime_emits_empty_state_and_no_block_until_a_task_exists() {
    let runtime = TasksRuntime::new(50);
    assert!(runtime.offers_tasks());
    // The count cap the system prompt states comes from the runtime.
    assert_eq!(runtime.max_tasks(), 50);
    assert!(runtime.context_block().is_none(), "no tasks yet, no block");
    let GgTelemetryKind::TasksState { tasks, .. } = runtime.state_event().unwrap() else {
        panic!("expected TasksState");
    };
    assert!(tasks.is_empty());

    // Once a task is added through the shared store, the block and state reflect it.
    runtime
        .store()
        .lock()
        .unwrap()
        .add("a", "A", None, StructuredFields::default(), &[])
        .unwrap();
    assert!(runtime.context_block().is_some());
    let GgTelemetryKind::TasksState { tasks, .. } = runtime.state_event().unwrap() else {
        panic!("expected TasksState");
    };
    assert_eq!(tasks.len(), 1);
}

// ---------------------------------------------------------------------------
// Issues mode
// ---------------------------------------------------------------------------

#[test]
fn task_mode_resolves_from_params_and_defaults_to_simple() {
    assert_eq!(task_mode(json!({})), TaskMode::Simple);
    assert_eq!(task_mode(json!({ "mode": "issues" })), TaskMode::Issues);
    assert_eq!(task_mode(json!({ "mode": "simple" })), TaskMode::Simple);
    // The alternate spellings the parse deliberately tolerates.
    assert_eq!(
        task_mode(json!({ "mode": " Structured " })),
        TaskMode::Issues
    );
    assert_eq!(task_mode(json!({ "mode": null })), TaskMode::Simple);
}

#[test]
fn a_mode_gg_does_not_recognize_is_refused() {
    // Reading `isues` as `simple` would hold every task in the run to the wrong shape while the
    // record named the other arm — and the two modes are the axis this capability is studied on.
    for params in [json!({ "mode": "isues" }), json!({ "mode": 2 })] {
        let defects = reported(|report| {
            resolve_task_mode(&params, report);
        });
        assert_eq!(defects.len(), 1, "{params}: {defects:?}");
        assert_eq!(defects[0].locus, "tasks.params.mode", "{params}");
        assert_eq!(defects[0].known, ["simple", "issues"], "{params}");
    }
}

#[test]
fn simple_mode_ignores_structured_fields() {
    let mut store = TaskStore::with_mode(DEFAULT_MAX_TASKS, TaskMode::Simple);
    // Even if structured fields are passed, a simple-mode task stores none of them.
    store
        .add(
            "a",
            "A",
            None,
            StructuredFields {
                in_scope: Some("scope"),
                out_of_scope: Some("nope"),
                completion_criteria: Some("done"),
            },
            &[],
        )
        .expect("simple add");
    let task = &store.tasks()[0];
    assert_eq!(task.in_scope(), None);
    assert_eq!(task.out_of_scope(), None);
    assert_eq!(task.completion_criteria(), None);
}

#[test]
fn issues_mode_requires_the_structured_fields() {
    let mut store = TaskStore::with_mode(DEFAULT_MAX_TASKS, TaskMode::Issues);
    // A missing structured field is refused (nothing is added).
    assert_eq!(
        store.add("a", "A", None, StructuredFields::default(), &[]),
        Err(TaskError::EmptyField("inScope"))
    );
    assert_eq!(store.count(), 0);

    // A complete structured item is accepted and carries its sections.
    store
        .add(
            "a",
            "A",
            Some("overview"),
            StructuredFields {
                in_scope: Some("the widget"),
                out_of_scope: Some("everything else"),
                completion_criteria: Some("the widget works"),
            },
            &[],
        )
        .expect("issues add");
    let task = &store.tasks()[0];
    assert_eq!(task.in_scope(), Some("the widget"));
    assert_eq!(task.out_of_scope(), Some("everything else"));
    assert_eq!(task.completion_criteria(), Some("the widget works"));

    // The structured sections reach the telemetry contract.
    let GgTelemetryKind::TasksState { tasks, .. } = store.state_event("tasks-0") else {
        panic!("tasks state");
    };
    assert_eq!(tasks[0].in_scope.as_deref(), Some("the widget"));
    assert_eq!(
        tasks[0].completion_criteria.as_deref(),
        Some("the widget works")
    );
}

#[test]
fn issues_mode_update_rejects_clearing_a_structured_field() {
    let mut store = TaskStore::with_mode(DEFAULT_MAX_TASKS, TaskMode::Issues);
    store
        .add(
            "a",
            "A",
            None,
            StructuredFields {
                in_scope: Some("scope"),
                out_of_scope: Some("nope"),
                completion_criteria: Some("done"),
            },
            &[],
        )
        .unwrap();
    // An empty structured field on update is refused (issues-mode tasks must always carry it).
    assert_eq!(
        store.update(
            "a",
            None,
            None,
            None,
            StructuredFields {
                in_scope: Some(""),
                ..StructuredFields::default()
            },
        ),
        Err(TaskError::EmptyField("inScope"))
    );
    // A non-empty revision is applied.
    store
        .update(
            "a",
            None,
            None,
            None,
            StructuredFields {
                in_scope: Some("a sharper scope"),
                ..StructuredFields::default()
            },
        )
        .expect("structured update");
    assert_eq!(store.tasks()[0].in_scope(), Some("a sharper scope"));
}
