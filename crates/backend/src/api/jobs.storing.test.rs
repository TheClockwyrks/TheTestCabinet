//! Tests for a run waiting to store its artifact tree: the driver's `storing`
//! report, the hold it puts on the run claim, and every way the wait ends.
//!
//! The hold is counted from the job table, so each test moves real job rows
//! through the routes a driver, an operator and the dispatcher use. They run
//! against the real database and so on the real clock; nothing here depends on
//! time, because every reading is recorded under settings whose poll interval
//! outlasts the test.

use std::time::Duration;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};

use super::*;
use crate::api::flow_harness::{GREAT, jobs, owner, run_of, test_state};
use crate::capacity::{
    ArtifactStorageState, CapacityMonitor, CapacitySettings, HoldReason, MIB, StoreCapacity,
};
use crate::db::tests::{new_job, new_publish_job};

const GIB: u64 = 1024 * MIB;

/// The reason a driver reports while its upload is refused.
const REASON: &str = "the artifact service rejected the upload: HTTP 500: no space left";

/// A store with room whose write check passed.
fn green() -> StoreCapacity {
    StoreCapacity::writable(10 * GIB, 20 * GIB)
}

fn launchable_job(id: &str, created_at: &str) -> crate::db::NewJob {
    crate::db::NewJob {
        request_json: r#"{"testCase":"pong","version":"v1.0.0","variant":"base","harness":"claude","model":"m"}"#
            .to_string(),
        ..new_job(id, created_at)
    }
}

/// A watched, green store with three runs queued, the first of them claimed and
/// running as `j1`.
async fn state_with_a_running_job() -> (tempfile::TempDir, AppState) {
    let (dir, mut state) = test_state().await;
    state.capacity = CapacityMonitor::watching(CapacitySettings {
        poll_interval: Duration::from_secs(24 * 3600),
        ..CapacitySettings::default()
    });
    for (id, at) in [
        ("j1", "2026-10-01T00:00:00Z"),
        ("j2", "2026-10-01T00:01:00Z"),
        ("j3", "2026-10-01T00:02:00Z"),
    ] {
        state.db.enqueue_job(launchable_job(id, at)).await.unwrap();
    }
    state.capacity.record(green());
    assert_eq!(claim_run(&state).await.as_deref(), Some("j1"));
    assert_eq!(
        report(&state, "j1", DriverState::Running, None, None).await,
        StatusCode::NO_CONTENT
    );
    (dir, state)
}

/// Claim once as the dispatcher does, returning the claimed job's id.
async fn claim_run(state: &AppState) -> Option<String> {
    let response = claim(State(state.clone()), ServiceAuth).await.unwrap();
    if response.status() == StatusCode::NO_CONTENT {
        return None;
    }
    let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    Some(body["jobId"].as_str().unwrap().to_string())
}

/// Post a status as `job_id`'s driver does, with its per-job token.
async fn report(
    state: &AppState,
    job_id: &str,
    driver_state: DriverState,
    detail: Option<&str>,
    record: Option<RunRecord>,
) -> StatusCode {
    let token = state.db.get_job(job_id).await.unwrap().unwrap().job_token;
    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::AUTHORIZATION,
        format!("Bearer {token}").parse().unwrap(),
    );
    update_status(
        State(state.clone()),
        Path(job_id.to_string()),
        headers,
        Json(StatusUpdate {
            state: driver_state,
            record,
            detail: detail.map(str::to_string),
            artifacts_stored: None,
            store_fault: None,
            run_failure: None,
        }),
    )
    .await
    .unwrap()
}

/// Post `update` as `job_id`'s driver does, with its per-job token.
async fn post(state: &AppState, job_id: &str, update: StatusUpdate) -> StatusCode {
    let token = state.db.get_job(job_id).await.unwrap().unwrap().job_token;
    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::AUTHORIZATION,
        format!("Bearer {token}").parse().unwrap(),
    );
    update_status(
        State(state.clone()),
        Path(job_id.to_string()),
        headers,
        Json(update),
    )
    .await
    .unwrap()
}

async fn report_storing(state: &AppState, job_id: &str) {
    assert_eq!(
        report(state, job_id, DriverState::Storing, Some(REASON), None).await,
        StatusCode::NO_CONTENT
    );
}

async fn job(state: &AppState, id: &str) -> job::Model {
    state.db.get_job(id).await.unwrap().unwrap()
}

/// Each job's state, in queue order.
async fn states(state: &AppState) -> Vec<String> {
    jobs(state)
        .await
        .into_iter()
        .map(|job| format!("{}={}", job.id, job.state))
        .collect()
}

#[tokio::test]
async fn a_storing_report_shows_the_run_as_waiting_and_holds_the_queue() {
    let (_dir, state) = state_with_a_running_job().await;
    let mut stream = state.relay.notifier().open_stream();
    state
        .relay
        .notifier()
        .set_topics(&stream.id, None, Some(true));

    report_storing(&state, "j1").await;

    // The run is visibly waiting, with the driver's reason.
    let stored = job(&state, "j1").await;
    assert_eq!(stored.state, "storing");
    assert_eq!(stored.detail.as_deref(), Some(REASON));
    let Json(active) = active(State(state.clone())).await.unwrap();
    let row = active.iter().find(|row| row.run_id == "j1").unwrap();
    assert_eq!(row.state, JobState::Storing);
    assert_eq!(row.detail.as_deref(), Some(REASON));
    assert!(
        active
            .iter()
            .filter(|row| row.run_id != "j1")
            .all(|row| row.detail.is_none()),
        "only a storing run carries a reason"
    );

    // The console hears of both the run and the hold as they happen.
    let mut run_event = None;
    let mut storage = None;
    while let Ok(message) = stream.receiver.try_recv() {
        match message {
            crate::relay::StreamMessage::Run(event) => {
                run_event = Some(serde_json::to_value(event.as_ref()).unwrap());
            }
            crate::relay::StreamMessage::Storage(status) => storage = Some(status),
            crate::relay::StreamMessage::Notification(_) => {}
        }
    }
    let run_event = run_event.expect("a run event");
    assert_eq!(run_event["kind"], "state-changed");
    assert_eq!(run_event["state"], "storing");
    assert_eq!(run_event["detail"], REASON);
    let storage = storage.expect("a storage frame");
    assert_eq!(storage.hold_reason, Some(HoldReason::UploadsWaiting));
    assert_eq!(storage.runs_waiting_to_store, 1);
    assert_eq!(storage.detail.as_deref(), Some(REASON));

    // And nothing is dispatched, though the store itself reads green.
    assert_eq!(state.capacity.status().state, ArtifactStorageState::Ok);
    assert_eq!(claim_run(&state).await, None);
    assert_eq!(
        states(&state).await,
        ["j1=storing", "j2=pending", "j3=pending"],
        "the queued runs wait in order; none is failed"
    );
}

#[tokio::test]
async fn the_hold_ends_when_the_upload_lands() {
    let (_dir, state) = state_with_a_running_job().await;
    report_storing(&state, "j1").await;
    // The driver repeats the report after each failed attempt.
    report_storing(&state, "j1").await;
    assert_eq!(state.capacity.status().runs_waiting_to_store, 1);

    // The upload lands: the driver reports `validating` again, and says so.
    assert_eq!(
        post(&state, "j1", wait_over(true)).await,
        StatusCode::NO_CONTENT
    );
    let landed = job(&state, "j1").await;
    assert_eq!(landed.state, "validating");
    assert_eq!(landed.detail, None, "the wait's reason goes with the wait");

    // A tree landed, which is the one thing that proves the store took an upload.
    let status = state.capacity.status();
    assert_eq!(status.runs_waiting_to_store, 0);
    assert!(!status.runs_on_hold);
    assert_eq!(status.detail, None);
    assert_eq!(claim_run(&state).await.as_deref(), Some("j2"));
    assert_eq!(claim_run(&state).await.as_deref(), Some("j3"));
    assert_eq!(
        states(&state).await,
        ["j1=validating", "j2=dispatched", "j3=dispatched"]
    );
}

#[tokio::test]
async fn a_wait_that_ends_without_a_word_about_the_tree_proves_nothing() {
    // A driver that says only `validating`.
    let (_dir, state) = state_with_a_running_job().await;
    report_storing(&state, "j1").await;

    assert_eq!(
        report(&state, "j1", DriverState::Validating, None, None).await,
        StatusCode::NO_CONTENT
    );

    assert_eq!(job(&state, "j1").await.state, "validating");
    assert_eq!(
        state.capacity.status().hold_reason,
        Some(HoldReason::ProvingStore)
    );
    assert_eq!(claim_run(&state).await, None, "j1 is still in flight");

    // Its terminal report says the tree was stored.
    assert_eq!(
        post(
            &state,
            "j1",
            StatusUpdate {
                record: Some(run_of("r1", "pong", GREAT)),
                artifacts_stored: Some(true),
                ..StatusUpdate::of(DriverState::Succeeded)
            }
        )
        .await,
        StatusCode::NO_CONTENT
    );
    assert!(!state.capacity.runs_on_hold());
    assert_eq!(claim_run(&state).await.as_deref(), Some("j2"));
}

/// The terminal report of a run whose driver gave up on the store.
fn gave_up(run_id: &str) -> StatusUpdate {
    StatusUpdate {
        record: Some(run_of(run_id, "pong", GREAT)),
        artifacts_stored: Some(false),
        store_fault: Some(REASON.to_string()),
        ..StatusUpdate::of(DriverState::Succeeded)
    }
}

#[tokio::test]
async fn after_a_waiter_gives_up_the_store_is_proved_one_run_at_a_time() {
    let (_dir, state) = state_with_a_running_job().await;
    report_storing(&state, "j1").await;

    // The driver gave up after its wait and reports the run without a tree.
    assert_eq!(
        post(&state, "j1", gave_up("r1")).await,
        StatusCode::NO_CONTENT
    );
    let finished = job(&state, "j1").await;
    assert_eq!(finished.state, "succeeded");
    assert_eq!(finished.detail, None);
    assert_eq!(finished.held_report_json, None);

    let status = state.capacity.status();
    assert_eq!(status.runs_waiting_to_store, 0);
    assert!(
        status.runs_on_hold,
        "giving up is not evidence the store works"
    );
    assert_eq!(status.hold_reason, Some(HoldReason::ProvingStore));
    assert_eq!(status.detail.as_deref(), Some(REASON));

    // The store reads green, and did the whole time: no number of passing
    // readings opens the queue.
    for _ in 0..5 {
        state.capacity.record(green());
    }
    assert_eq!(
        state.capacity.status().hold_reason,
        Some(HoldReason::ProvingStore)
    );

    // One run is let through, and only one.
    assert_eq!(claim_run(&state).await.as_deref(), Some("j2"));
    assert_eq!(claim_run(&state).await, None);
    assert_eq!(
        states(&state).await,
        ["j1=succeeded", "j2=dispatched", "j3=pending"],
        "the rest wait, and read as deliberately held"
    );
    report(&state, "j2", DriverState::Running, None, None).await;
    assert_eq!(claim_run(&state).await, None);

    // It stores its tree. The queue is open.
    assert_eq!(
        post(
            &state,
            "j2",
            StatusUpdate {
                record: Some(run_of("r2", "pong", GREAT)),
                artifacts_stored: Some(true),
                ..StatusUpdate::of(DriverState::Succeeded)
            }
        )
        .await,
        StatusCode::NO_CONTENT
    );
    assert!(!state.capacity.runs_on_hold());
    assert_eq!(claim_run(&state).await.as_deref(), Some("j3"));
}

#[tokio::test]
async fn a_proving_run_whose_upload_fails_too_holds_the_queue_again() {
    let (_dir, state) = state_with_a_running_job().await;
    report_storing(&state, "j1").await;
    post(&state, "j1", gave_up("r1")).await;
    assert_eq!(claim_run(&state).await.as_deref(), Some("j2"));
    report(&state, "j2", DriverState::Running, None, None).await;

    // The store is still broken: one run found out, not the whole lane.
    report_storing(&state, "j2").await;

    let status = state.capacity.status();
    assert_eq!(status.hold_reason, Some(HoldReason::UploadsWaiting));
    assert_eq!(status.runs_waiting_to_store, 1);
    assert_eq!(claim_run(&state).await, None);
    assert_eq!(
        states(&state).await,
        ["j1=succeeded", "j2=storing", "j3=pending"]
    );
}

#[tokio::test]
async fn a_run_that_ends_without_a_tree_holds_the_queue_though_it_never_waited() {
    // A driver configured not to wait, or one whose wait began and ended between
    // two reports: the terminal report is the only word of the failure.
    let (_dir, state) = state_with_a_running_job().await;

    assert_eq!(
        post(&state, "j1", gave_up("r1")).await,
        StatusCode::NO_CONTENT
    );

    let status = state.capacity.status();
    assert_eq!(status.hold_reason, Some(HoldReason::ProvingStore));
    assert_eq!(status.detail.as_deref(), Some(REASON));
}

#[tokio::test]
async fn a_tree_the_store_refused_as_the_runs_own_fault_holds_nothing() {
    // Not stored, and no fault of the store's named: an archive it could not
    // read, say. The next run's tree has nothing to fear from it.
    let (_dir, state) = state_with_a_running_job().await;

    assert_eq!(
        post(
            &state,
            "j1",
            StatusUpdate {
                record: Some(run_of("r1", "pong", GREAT)),
                artifacts_stored: Some(false),
                ..StatusUpdate::of(DriverState::Succeeded)
            }
        )
        .await,
        StatusCode::NO_CONTENT
    );

    assert!(!state.capacity.runs_on_hold());
    assert_eq!(claim_run(&state).await.as_deref(), Some("j2"));
    assert_eq!(claim_run(&state).await.as_deref(), Some("j3"));
}

#[tokio::test]
async fn canceling_a_waiter_recounts_the_hold_at_once() {
    let (_dir, state) = state_with_a_running_job().await;
    report_storing(&state, "j1").await;
    let mut stream = state.relay.notifier().open_stream();

    let Json(canceled) = cancel(State(state.clone()), owner(), Path("j1".to_string()))
        .await
        .unwrap();
    assert_eq!(canceled.state, JobState::Canceled);

    // No claim and no poll in between: the cancel route counted.
    let status = state.capacity.status();
    assert_eq!(status.runs_waiting_to_store, 0);
    assert_eq!(
        status.hold_reason,
        Some(HoldReason::ProvingStore),
        "nothing landed, so the store is still to be proved"
    );
    let mut announced = None;
    while let Ok(message) = stream.receiver.try_recv() {
        if let crate::relay::StreamMessage::Storage(status) = message {
            announced = Some(status);
        }
    }
    let announced = announced.expect("the console is told as the cancel lands");
    assert_eq!(announced.runs_waiting_to_store, 0);
    assert_eq!(announced.hold_reason, Some(HoldReason::ProvingStore));

    // One run is let through to prove it.
    assert_eq!(claim_run(&state).await.as_deref(), Some("j2"));
    assert_eq!(claim_run(&state).await, None);

    // The driver's late reports cannot bring the canceled job back, and they are
    // still word of a store that failed an upload.
    report_storing(&state, "j1").await;
    assert_eq!(job(&state, "j1").await.state, "canceled");
    assert_eq!(state.capacity.status().runs_waiting_to_store, 0);
    assert_eq!(
        state.capacity.status().hold_reason,
        Some(HoldReason::ProvingStore)
    );
}

#[tokio::test]
async fn the_failed_upload_of_a_canceled_run_holds_the_queue() {
    // A run canceled while it ran still uploads what it built. Its job is
    // terminal and never reads `storing`; the store it failed on is the same one.
    let (_dir, state) = state_with_a_running_job().await;
    let Json(canceled) = cancel(State(state.clone()), owner(), Path("j1".to_string()))
        .await
        .unwrap();
    assert_eq!(canceled.state, JobState::Canceled);
    assert!(!state.capacity.runs_on_hold());

    report_storing(&state, "j1").await;

    assert_eq!(job(&state, "j1").await.state, "canceled");
    let status = state.capacity.status();
    assert_eq!(status.runs_waiting_to_store, 0);
    assert_eq!(status.hold_reason, Some(HoldReason::ProvingStore));
    assert_eq!(status.detail.as_deref(), Some(REASON));

    // And its `canceled` report, when the tree did land, is what clears it.
    assert_eq!(
        post(
            &state,
            "j1",
            StatusUpdate {
                record: Some(run_of("r1", "pong", GREAT)),
                artifacts_stored: Some(true),
                ..StatusUpdate::of(DriverState::Canceled)
            }
        )
        .await,
        StatusCode::NO_CONTENT
    );
    assert!(!state.capacity.runs_on_hold());
}

#[tokio::test]
async fn a_bulk_cancel_of_the_active_runs_reaches_a_waiting_one() {
    let (_dir, state) = state_with_a_running_job().await;
    report_storing(&state, "j1").await;

    let canceled = sweep_cancel(
        &state,
        &global_filter(&crate::db::CANCELABLE_ACTIVE_STATES),
        "canceled by an operator killing the active runs",
        CancelFeed::Nothing,
    )
    .await
    .unwrap();

    assert_eq!(canceled, 1);
    assert_eq!(job(&state, "j1").await.state, "canceled");
    assert_eq!(
        state.capacity.status().runs_waiting_to_store,
        0,
        "the sweep recounts the waiting runs"
    );
}

/// What the dispatcher reports for a driven job with no live driver.
async fn lose(state: &AppState, job_id: &str) -> StatusCode {
    report_lost(
        State(state.clone()),
        ServiceAuth,
        Path(job_id.to_string()),
        Json(StatusUpdate {
            detail: Some("the driver Job no longer exists".to_string()),
            ..StatusUpdate::of(DriverState::Failed)
        }),
    )
    .await
    .unwrap()
}

/// The `storing` report a driver opens its wait with: the reason, and the report
/// it is holding.
fn handover(run_id: &str, run_failure: Option<&str>) -> StatusUpdate {
    StatusUpdate {
        record: Some(run_of(run_id, "pong", GREAT)),
        detail: Some(REASON.to_string()),
        run_failure: run_failure.map(str::to_string),
        ..StatusUpdate::of(DriverState::Storing)
    }
}

/// The reason a driver's wait ended.
fn wait_over(stored: bool) -> StatusUpdate {
    StatusUpdate {
        artifacts_stored: Some(stored),
        ..StatusUpdate::of(DriverState::Validating)
    }
}

#[tokio::test]
async fn a_waiter_lost_before_it_handed_anything_over_fails_and_stops_holding_the_queue() {
    let (_dir, state) = state_with_a_running_job().await;
    report_storing(&state, "j1").await;

    // The driver pod is gone and never reports again. The dispatcher finds a
    // driven job with no live Job and reports it.
    assert_eq!(lose(&state, "j1").await, StatusCode::NO_CONTENT);
    let lost = job(&state, "j1").await;
    assert_eq!(lost.state, "failed");
    assert_eq!(
        lost.detail.as_deref(),
        Some("the driver Job no longer exists")
    );
    assert_eq!(lost.record_id, None);

    // No driver cleared anything, and the count is gone with the job's state. The
    // store has still to take a tree.
    let status = state.capacity.status();
    assert_eq!(status.runs_waiting_to_store, 0);
    assert_eq!(status.hold_reason, Some(HoldReason::ProvingStore));
    assert!(claim_run(&state).await.is_some());
    assert_eq!(claim_run(&state).await, None);
}

#[tokio::test]
async fn a_waiter_lost_after_it_handed_its_report_over_finishes_as_the_run_it_was() {
    let (_dir, state) = state_with_a_running_job().await;
    assert_eq!(
        post(&state, "j1", handover("r1", None)).await,
        StatusCode::NO_CONTENT
    );
    let waiting = job(&state, "j1").await;
    assert_eq!(waiting.state, "storing");
    assert!(waiting.held_report_json.is_some());
    // Each later attempt repeats the reason alone; the report is kept.
    report_storing(&state, "j1").await;
    assert_eq!(
        job(&state, "j1").await.held_report_json,
        waiting.held_report_json
    );
    let before = jobs(&state).await.len();

    // Hours in, the node is drained.
    assert_eq!(lose(&state, "j1").await, StatusCode::NO_CONTENT);

    let finished = job(&state, "j1").await;
    assert_eq!(finished.state, "succeeded", "the run had finished");
    assert_eq!(finished.record_id.as_deref(), Some("r1"));
    assert_eq!(finished.held_report_json, None);
    assert!(state.db.get_run("r1").await.unwrap().is_some());
    assert_eq!(
        state.db.run_artifacts_stored("r1").await.unwrap(),
        Some(false),
        "its tree went with the pod"
    );
    assert_eq!(
        jobs(&state).await.len(),
        before,
        "a finished run is not run again as an infrastructure failure"
    );
    assert_eq!(
        state.capacity.status().hold_reason,
        Some(HoldReason::ProvingStore)
    );
}

#[tokio::test]
async fn a_failed_run_handed_over_finishes_as_failed_with_its_own_reason() {
    let (_dir, state) = state_with_a_running_job().await;
    post(
        &state,
        "j1",
        handover("r1", Some("the harness exited with status 2")),
    )
    .await;

    lose(&state, "j1").await;

    let finished = job(&state, "j1").await;
    assert_eq!(finished.state, "failed");
    assert_eq!(
        finished.detail.as_deref(),
        Some("the harness exited with status 2"),
        "not the dispatcher's word that the pod is gone"
    );
    assert_eq!(finished.record_id.as_deref(), Some("r1"));
}

#[tokio::test]
async fn a_driver_lost_after_its_tree_landed_keeps_the_tree() {
    let (_dir, state) = state_with_a_running_job().await;
    post(&state, "j1", handover("r1", None)).await;
    post(&state, "j1", wait_over(true)).await;
    assert_eq!(job(&state, "j1").await.state, "validating");

    // Lost between the upload and the terminal report.
    lose(&state, "j1").await;

    let finished = job(&state, "j1").await;
    assert_eq!(finished.state, "succeeded");
    assert_eq!(
        state.db.run_artifacts_stored("r1").await.unwrap(),
        Some(true)
    );
    assert!(!state.capacity.runs_on_hold());
}

#[tokio::test]
async fn the_drivers_own_terminal_report_wins_over_the_one_it_handed_over() {
    let (_dir, state) = state_with_a_running_job().await;
    post(&state, "j1", handover("r1", None)).await;
    post(&state, "j1", wait_over(true)).await;

    post(
        &state,
        "j1",
        StatusUpdate {
            record: Some(run_of("r1", "pong", GREAT)),
            artifacts_stored: Some(true),
            ..StatusUpdate::of(DriverState::Succeeded)
        },
    )
    .await;
    // The dispatcher's report raced it and lost.
    assert_eq!(lose(&state, "j1").await, StatusCode::NO_CONTENT);

    let finished = job(&state, "j1").await;
    assert_eq!(finished.state, "succeeded");
    assert_eq!(finished.held_report_json, None);
    assert_eq!(
        state.db.run_artifacts_stored("r1").await.unwrap(),
        Some(true)
    );
}

#[tokio::test]
async fn a_storing_report_for_a_job_no_driver_exists_for_moves_no_job() {
    let (_dir, state) = state_with_a_running_job().await;

    // Still queued: nothing has been claimed for it.
    report_storing(&state, "j2").await;
    assert_eq!(job(&state, "j2").await.state, "queued");

    // Already failed.
    assert_eq!(
        report(
            &state,
            "j1",
            DriverState::Failed,
            Some("harness unavailable"),
            None
        )
        .await,
        StatusCode::NO_CONTENT
    );
    report_storing(&state, "j1").await;
    let failed = job(&state, "j1").await;
    assert_eq!(failed.state, "failed");
    assert_eq!(failed.detail.as_deref(), Some("harness unavailable"));
    assert_eq!(failed.held_report_json, None);

    // No job waits. The reports are still word of a failed upload.
    let status = state.capacity.status();
    assert_eq!(status.runs_waiting_to_store, 0);
    assert_eq!(status.hold_reason, Some(HoldReason::ProvingStore));
}

#[tokio::test]
async fn the_moves_into_and_out_of_storing_touch_only_the_jobs_they_are_for() {
    let (_dir, state) = state_with_a_running_job().await;
    let now = "2026-10-01T02:00:00Z";

    // Out of `storing` applies to a storing job alone.
    assert!(
        state
            .db
            .set_job_stored("j1", now, None)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(job(&state, "j1").await.state, "running");

    // Into it, to a job a driver exists for.
    assert!(
        state
            .db
            .set_job_storing("j2", now, Some("x"), Some("{}"))
            .await
            .unwrap()
            .is_none(),
        "queued"
    );
    let queued = job(&state, "j2").await;
    assert_eq!(
        (
            queued.state.as_str(),
            queued.detail,
            queued.held_report_json
        ),
        ("queued", None, None)
    );
    let storing = state
        .db
        .set_job_storing("j1", now, Some("first"), Some(r#"{"held":1}"#))
        .await
        .unwrap()
        .expect("running");
    assert_eq!(storing.state, "storing");
    assert_eq!(storing.detail.as_deref(), Some("first"));

    // A repeat without a report keeps the one held, and takes the new reason.
    let again = state
        .db
        .set_job_storing("j1", now, Some("second"), None)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(again.detail.as_deref(), Some("second"));
    assert_eq!(again.held_report_json.as_deref(), Some(r#"{"held":1}"#));

    // A cancellation that commits first leaves nothing for the move to match.
    state
        .db
        .cancel_job("j1", now, "canceled by operator")
        .await
        .unwrap()
        .unwrap();
    assert!(
        state
            .db
            .set_job_storing("j1", now, Some("late"), None)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        state
            .db
            .set_job_stored("j1", now, None)
            .await
            .unwrap()
            .is_none()
    );
    let canceled = job(&state, "j1").await;
    assert_eq!(canceled.state, "canceled");
    assert_eq!(canceled.detail.as_deref(), Some("canceled by operator"));
}

#[tokio::test]
async fn the_jobs_a_driver_exists_for_are_counted() {
    let (_dir, state) = state_with_a_running_job().await;
    assert_eq!(state.db.driven_job_count().await.unwrap(), 1);

    report_storing(&state, "j1").await;
    assert_eq!(state.db.driven_job_count().await.unwrap(), 1, "storing");

    post(&state, "j1", gave_up("r1")).await;
    assert_eq!(state.db.driven_job_count().await.unwrap(), 0);
}

#[tokio::test]
async fn the_last_finished_runs_tree_is_what_a_starting_backend_reads() {
    let (_dir, state) = state_with_a_running_job().await;
    assert_eq!(state.db.latest_finished_tree_stored().await.unwrap(), None);

    post(&state, "j1", gave_up("r1")).await;
    assert_eq!(
        state.db.latest_finished_tree_stored().await.unwrap(),
        Some(false)
    );

    // A canceled job's run says nothing; a later finished one does.
    assert_eq!(claim_run(&state).await.as_deref(), Some("j2"));
    post(
        &state,
        "j2",
        StatusUpdate {
            record: Some(run_of("r2", "pong", GREAT)),
            artifacts_stored: Some(true),
            ..StatusUpdate::of(DriverState::Succeeded)
        },
    )
    .await;
    assert_eq!(
        state.db.latest_finished_tree_stored().await.unwrap(),
        Some(true)
    );
}

#[tokio::test]
async fn a_storing_report_needs_the_jobs_token() {
    let (_dir, state) = state_with_a_running_job().await;
    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::AUTHORIZATION,
        "Bearer not-the-token".parse().unwrap(),
    );

    let refused = update_status(
        State(state.clone()),
        Path("j1".to_string()),
        headers,
        Json(StatusUpdate {
            state: DriverState::Storing,
            record: None,
            detail: Some(REASON.to_string()),
            artifacts_stored: None,
            store_fault: None,
            run_failure: None,
        }),
    )
    .await;

    assert!(refused.is_err());
    assert_eq!(job(&state, "j1").await.state, "running");
    assert!(!state.capacity.runs_on_hold());
}

#[tokio::test]
async fn the_publish_lane_is_claimed_while_runs_wait_to_store() {
    let (_dir, state) = state_with_a_running_job().await;
    state
        .db
        .enqueue_publish_job(new_publish_job("p1", "r1", "2026-10-01T00:00:00Z"))
        .await
        .unwrap();
    report_storing(&state, "j1").await;
    assert!(state.capacity.runs_on_hold());

    let response = crate::api::publish_jobs::claim(State(state.clone()), ServiceAuth)
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(claim_run(&state).await, None, "the run lane is still held");
}

#[tokio::test]
async fn the_job_token_verifies_for_as_long_as_the_wait_can_last() {
    // The artifact service verifies every upload attempt's token here. The token
    // has no expiry and is checked against the job row alone, so an attempt made
    // hours into a wait, or after the job was canceled under the driver, is
    // refused for no reason of the token's.
    let (_dir, state) = state_with_a_running_job().await;
    let token = job(&state, "j1").await.job_token;
    let verify = |state: AppState, token: String| async move {
        verify_token(
            State(state),
            Path("j1".to_string()),
            Json(VerifyTokenBody { token }),
        )
        .await
    };

    report_storing(&state, "j1").await;
    assert_eq!(
        verify(state.clone(), token.clone()).await.unwrap(),
        StatusCode::NO_CONTENT
    );

    state
        .db
        .cancel_job("j1", "2026-10-01T01:00:00Z", "canceled by operator")
        .await
        .unwrap();
    assert_eq!(
        verify(state.clone(), token).await.unwrap(),
        StatusCode::NO_CONTENT
    );
    assert!(verify(state, "wrong".to_string()).await.is_err());
}

#[tokio::test]
async fn the_status_route_names_the_condition_and_the_number_waiting() {
    use tower::ServiceExt;

    let (_dir, state) = state_with_a_running_job().await;
    report_storing(&state, "j1").await;

    let response = crate::api::router(state)
        .oneshot(
            axum::http::Request::builder()
                .uri("/artifacts/capacity")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
        .await
        .unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&bytes).unwrap(),
        serde_json::json!({
            "state": "ok",
            "runsOnHold": true,
            "holdReason": "uploads-waiting",
            "runsWaitingToStore": 1,
            "detail": REASON,
            "freeBytes": 10 * GIB,
            "totalBytes": 20 * GIB,
            "writable": true,
            "warnBytes": 3 * GIB,
            "stopBytes": 2 * GIB,
        })
    );
}
