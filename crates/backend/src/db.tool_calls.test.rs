//! Tests for a run's tool-call tally as a push stores it and as a comparison
//! counts an earlier run's.

use std::collections::BTreeMap;

use serde_json::json;
use test_cabinet_core::event::{EventKind, HarnessEvent};
use test_cabinet_core::gg::{GgTelemetryEvent, GgTelemetryKind};
use test_cabinet_core::run_record::HarnessSlug;

use super::retention_tests::run_row;
use super::tests::{links, record};
use super::*;

/// A gg stream with two tool calls and one program function call, stored as a
/// push stores it.
fn gg_events() -> String {
    let carry = |kind: GgTelemetryKind| HarnessEvent {
        timestamp: "2026-10-17T00:00:00Z".to_string(),
        session_id: None,
        kind: EventKind::Gg {
            event: Box::new(GgTelemetryEvent {
                timestamp: "2026-10-17T00:00:00Z".to_string(),
                session_id: None,
                agent_id: Some("root".to_string()),
                parent_agent_id: None,
                issue_id: None,
                kind,
            }),
        },
    };
    let read = || GgTelemetryKind::ToolCall {
        name: "read_file".to_string(),
        args: json!({}),
    };
    let events = vec![
        carry(read()),
        carry(read()),
        carry(GgTelemetryKind::ApiCall {
            operation: "files.edit_file".to_string(),
        }),
        carry(GgTelemetryKind::AssistantMessage {
            text: "done".to_string(),
        }),
    ];
    serde_json::to_string(&events).unwrap()
}

fn run_of(id: &str, harness: HarnessSlug) -> RunRecord {
    let mut record = record(id);
    record.subject.harness_slug = harness;
    record
}

async fn counted(db: &Db, ids: &[&str]) -> BTreeMap<String, RunRecord> {
    let ids: Vec<String> = ids.iter().map(|id| id.to_string()).collect();
    let mut runs = db
        .get_runs_without_events(&ids)
        .await
        .unwrap()
        .into_iter()
        .map(|stored| (stored.record.id.clone(), stored.record))
        .collect();
    db.count_uncounted_tool_calls(&mut runs).await.unwrap();
    runs
}

#[tokio::test]
async fn a_push_flags_every_tally_but_an_empty_codex_or_gg_one_as_counted() {
    let db = Db::connect_in_memory().await.unwrap();
    let mut tallied = run_of("gg-tallied", HarnessSlug::Gg);
    tallied.tool_calls = BTreeMap::from([("shell".to_string(), 1)]);
    for record in [
        run_of("claude-empty", HarnessSlug::Claude),
        tallied,
        run_of("gg-empty", HarnessSlug::Gg),
        run_of("codex-empty", HarnessSlug::Codex),
    ] {
        db.push(&record, &links(), None, None).await.unwrap();
    }
    assert!(run_row(&db, "claude-empty").await.tool_calls_counted);
    assert!(run_row(&db, "gg-tallied").await.tool_calls_counted);
    assert!(!run_row(&db, "gg-empty").await.tool_calls_counted);
    assert!(!run_row(&db, "codex-empty").await.tool_calls_counted);
}

#[tokio::test]
async fn an_uncounted_gg_run_is_counted_once_and_stored() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(
        &run_of("gg", HarnessSlug::Gg),
        &links(),
        Some(&gg_events()),
        None,
    )
    .await
    .unwrap();
    let before = run_row(&db, "gg").await.updated_at;

    let runs = counted(&db, &["gg"]).await;
    let expected = BTreeMap::from([
        ("files.edit_file".to_string(), 1),
        ("read_file".to_string(), 2),
    ]);
    assert_eq!(runs["gg"].tool_calls, expected);

    let row = run_row(&db, "gg").await;
    assert!(row.tool_calls_counted);
    assert_ne!(row.updated_at, before);
    // The stored record carries the tally, so every later read has it.
    let stored = db.get_run("gg").await.unwrap().unwrap();
    assert_eq!(stored.record.tool_calls, expected);
    assert_eq!(counted(&db, &["gg"]).await["gg"].tool_calls, expected);
    // Nothing else in the record changed.
    assert_eq!(stored.record.subject, run_of("gg", HarnessSlug::Gg).subject);
}

#[tokio::test]
async fn a_counted_run_with_no_tool_calls_is_not_counted_again() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(
        &run_of("codex", HarnessSlug::Codex),
        &links(),
        Some("[]"),
        None,
    )
    .await
    .unwrap();
    assert!(
        counted(&db, &["codex"]).await["codex"]
            .tool_calls
            .is_empty()
    );
    let row = run_row(&db, "codex").await;
    assert!(row.tool_calls_counted);

    counted(&db, &["codex"]).await;
    assert_eq!(run_row(&db, "codex").await.updated_at, row.updated_at);
}

#[tokio::test]
async fn a_counted_published_run_marks_the_snapshot_dirty() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(
        &run_of("gg", HarnessSlug::Gg),
        &links(),
        Some(&gg_events()),
        None,
    )
    .await
    .unwrap();
    super::retention_tests::force_published(&db, "gg").await;
    db.mark_uploaded("2026-10-17T00:00:00Z", 1).await.unwrap();
    assert!(!db.snapshot_state().await.unwrap().dirty);

    counted(&db, &["gg"]).await;
    assert!(db.snapshot_state().await.unwrap().dirty);
}

#[tokio::test]
async fn a_run_whose_events_do_not_decode_stays_uncounted() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(
        &run_of("gg", HarnessSlug::Gg),
        &links(),
        Some("not json"),
        None,
    )
    .await
    .unwrap();
    assert!(counted(&db, &["gg"]).await["gg"].tool_calls.is_empty());
    assert!(!run_row(&db, "gg").await.tool_calls_counted);
}

#[tokio::test]
async fn the_comparison_read_leaves_out_events_and_keeps_the_order_asked() {
    let db = Db::connect_in_memory().await.unwrap();
    for id in ["a", "b"] {
        db.push(&record(id), &links(), Some("[]"), None)
            .await
            .unwrap();
    }
    let ids = ["b".to_string(), "missing".to_string(), "a".to_string()];
    let runs = db.get_runs_without_events(&ids).await.unwrap();
    let order: Vec<&str> = runs.iter().map(|run| run.record.id.as_str()).collect();
    assert_eq!(order, ["b", "a"]);
    assert!(runs.iter().all(|run| run.events_json.is_none()));
}
