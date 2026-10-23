//! Probe leases: the lease a probe's runner holds on its row, its renewal, the
//! compare-and-swap takeover of a lapsed one, the fenced recording of a call, and
//! finishing under the lease (the backend overview's "Replicas", the API's "Model
//! probes").

use test_cabinet_entities::{model_probe, model_probe_item};

use super::*;

/// When each test's probe is triggered.
const T0: &str = "2026-10-19T12:00:00Z";

/// A `running` probe triggered at [`T0`], its lease held by `holder` when given.
fn probe(id: &str, holder: Option<&str>) -> model_probe::Model {
    model_probe::Model {
        id: id.to_string(),
        model_slug: format!("model-{id}"),
        openrouter_slug: "test/model".to_string(),
        provider: None,
        user_id: "user-1".to_string(),
        language: Some("typescript".to_string()),
        samples: 1,
        max_tokens: 3500,
        request_json: "[]".to_string(),
        status: "running".to_string(),
        error: None,
        verdict: None,
        pass_rate: None,
        spend: 0.0,
        created_at: T0.to_string(),
        finished_at: None,
        lease_expires_at: holder.map(|_| probe_lease_expiry(T0).unwrap()),
        lease_holder: holder.map(str::to_string),
    }
}

/// One call of probe `probe_id` at `sample`.
fn item(id: &str, probe_id: &str, sample: i32) -> model_probe_item::Model {
    model_probe_item::Model {
        id: id.to_string(),
        probe_id: probe_id.to_string(),
        language: "typescript".to_string(),
        scenario: "baseline".to_string(),
        prompt: "write-plan".to_string(),
        sample,
        provider: Some("acme".to_string()),
        finish_reason: Some("tool_calls".to_string()),
        native_finish_reason: None,
        label: Some("correct-calls".to_string()),
        pass: true,
        program_text: None,
        response_text: String::new(),
        reasoning_text: None,
        prompt_tokens: None,
        completion_tokens: None,
        cost: Some(0.001),
        duration_ms: 1,
        error: None,
        created_at: T0.to_string(),
    }
}

async fn row(db: &Db, id: &str) -> model_probe::Model {
    db.get_model_probe(id)
        .await
        .unwrap()
        .expect("the probe exists")
}

#[test]
fn a_probe_lease_runs_two_minutes_at_whole_seconds() {
    assert_eq!(
        probe_lease_expiry("2026-10-19T12:00:00.987654+02:00").unwrap(),
        "2026-10-19T10:02:00Z"
    );
    assert!(probe_lease_expiry("yesterday").is_err());
}

#[tokio::test]
async fn renewing_extends_only_the_holders_lease() {
    let db = Db::connect_in_memory().await.unwrap();
    db.insert_model_probe(probe("p1", Some("runner-a")))
        .await
        .unwrap();

    assert!(
        db.renew_model_probe_lease("p1", "runner-a", "2026-10-19T12:01:30Z")
            .await
            .unwrap()
    );
    assert_eq!(
        row(&db, "p1").await.lease_expires_at.as_deref(),
        Some("2026-10-19T12:03:30Z")
    );

    assert!(
        !db.renew_model_probe_lease("p1", "runner-b", "2026-10-19T12:02:00Z")
            .await
            .unwrap(),
        "a runner that does not hold the lease renews nothing"
    );
    assert_eq!(
        row(&db, "p1").await.lease_expires_at.as_deref(),
        Some("2026-10-19T12:03:30Z")
    );
}

#[tokio::test]
async fn a_held_lease_is_not_taken_and_a_lapsed_one_is_taken_once() {
    let db = Db::connect_in_memory().await.unwrap();
    db.insert_model_probe(probe("p1", Some("runner-a")))
        .await
        .unwrap();

    // Held until 12:02:00.
    assert!(
        db.take_model_probe_lease("p1", "runner-b", "2026-10-19T12:01:59Z")
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        db.lapsed_running_model_probes("2026-10-19T12:01:59Z")
            .await
            .unwrap()
            .is_empty()
    );

    // Lapsed at 12:02:01: listed, and taken by exactly one runner.
    let now = "2026-10-19T12:02:01.5Z";
    let lapsed = db.lapsed_running_model_probes(now).await.unwrap();
    assert_eq!(
        lapsed.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(),
        ["p1"]
    );
    let taken = db
        .take_model_probe_lease("p1", "runner-b", now)
        .await
        .unwrap()
        .expect("a lapsed lease is taken");
    assert_eq!(taken.lease_holder.as_deref(), Some("runner-b"));
    assert_eq!(
        taken.lease_expires_at.as_deref(),
        Some("2026-10-19T12:04:01Z")
    );
    assert_eq!(row(&db, "p1").await, taken);
    assert!(
        db.take_model_probe_lease("p1", "runner-c", now)
            .await
            .unwrap()
            .is_none(),
        "the takeover holds the lease now"
    );

    // The runner that lost it can neither renew nor finish.
    assert!(
        !db.renew_model_probe_lease("p1", "runner-a", now)
            .await
            .unwrap()
    );
    assert!(
        !db.finish_model_probe("p1", "runner-a", "complete", None, None, None, 0.0, now)
            .await
            .unwrap()
    );
    assert_eq!(row(&db, "p1").await.status, "running");
}

#[tokio::test]
async fn a_probe_with_no_lease_reads_as_lapsed() {
    let db = Db::connect_in_memory().await.unwrap();
    db.insert_model_probe(probe("p1", None)).await.unwrap();
    db.insert_model_probe(model_probe::Model {
        status: "complete".to_string(),
        ..probe("p2", None)
    })
    .await
    .unwrap();

    let lapsed = db.lapsed_running_model_probes(T0).await.unwrap();
    assert_eq!(
        lapsed.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(),
        ["p1"],
        "only a running probe is listed"
    );
    assert!(
        db.take_model_probe_lease("p1", "runner-b", T0)
            .await
            .unwrap()
            .is_some()
    );
    assert!(
        db.take_model_probe_lease("p2", "runner-b", T0)
            .await
            .unwrap()
            .is_none(),
        "a finished probe is never taken"
    );
}

#[tokio::test]
async fn recording_a_call_renews_the_lease_and_is_refused_once_it_is_lost() {
    let db = Db::connect_in_memory().await.unwrap();
    db.insert_model_probe(probe("p1", Some("runner-a")))
        .await
        .unwrap();

    assert_eq!(
        db.record_model_probe_item(item("i1", "p1", 0), "runner-a", "2026-10-19T12:01:00Z")
            .await
            .unwrap(),
        ProbeItemRecorded::Stored
    );
    assert_eq!(
        row(&db, "p1").await.lease_expires_at.as_deref(),
        Some("2026-10-19T12:03:00Z")
    );
    assert_eq!(
        db.record_model_probe_item(item("i2", "p1", 0), "runner-a", "2026-10-19T12:01:10Z")
            .await
            .unwrap(),
        ProbeItemRecorded::AlreadyStored,
        "one item per call"
    );
    assert_eq!(
        row(&db, "p1").await.lease_expires_at.as_deref(),
        Some("2026-10-19T12:03:10Z"),
        "the holder still renewed its lease"
    );

    db.take_model_probe_lease("p1", "runner-b", "2026-10-19T12:03:11Z")
        .await
        .unwrap()
        .expect("the lease lapsed");
    assert_eq!(
        db.record_model_probe_item(item("i3", "p1", 1), "runner-a", "2026-10-19T12:03:12Z")
            .await
            .unwrap(),
        ProbeItemRecorded::LeaseLost
    );
    let items = db.list_model_probe_items("p1").await.unwrap();
    assert_eq!(
        items.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(),
        ["i1"]
    );
}

#[tokio::test]
async fn finishing_clears_the_lease() {
    let db = Db::connect_in_memory().await.unwrap();
    db.insert_model_probe(probe("p1", Some("runner-a")))
        .await
        .unwrap();
    assert!(
        db.finish_model_probe(
            "p1",
            "runner-a",
            "complete",
            None,
            Some("ready".to_string()),
            Some(1.0),
            0.002,
            "2026-10-19T12:01:00Z",
        )
        .await
        .unwrap()
    );
    let finished = row(&db, "p1").await;
    assert_eq!(finished.status, "complete");
    assert_eq!(finished.lease_expires_at, None);
    assert_eq!(finished.lease_holder, None);
    assert!(
        db.lapsed_running_model_probes("2026-10-19T13:00:00Z")
            .await
            .unwrap()
            .is_empty()
    );
}
