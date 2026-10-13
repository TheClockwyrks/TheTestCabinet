//! Tests for the artifact capacity hold on the run claim (`POST /jobs/next`): the
//! one place a queued run is handed to a dispatcher.
//!
//! These run against the real database, whose pool waits on a worker thread, so
//! they cannot run on a paused clock: with the runtime idle the clock would jump
//! straight to the pool's acquire timeout. The clock's exact boundaries are tested
//! on a paused clock in `capacity.test.rs`. Here time only ever moves by
//! [`elapse`], in steps far from any boundary, and every other test uses
//! [`unhurried`] settings under which a reading cannot go stale mid-test.

use std::time::Duration;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use futures_util::StreamExt;
use tower::ServiceExt;

use super::*;
use crate::api::flow_harness::{jobs, test_state};
use crate::capacity::{
    ArtifactStorageState, CapacityMonitor, CapacitySettings, MIB, StoreCapacity,
};
use crate::db::tests::{new_job, new_publish_job};

const GIB: u64 = 1024 * MIB;

fn reading(free_bytes: u64) -> StoreCapacity {
    StoreCapacity::writable(free_bytes, 20 * GIB)
}

/// A queued job whose stored launch request is one the claim can hand to a driver.
fn launchable_job(id: &str, created_at: &str) -> crate::db::NewJob {
    crate::db::NewJob {
        request_json: r#"{"testCase":"pong","version":"v1.0.0","variant":"base","harness":"claude","model":"m"}"#
            .to_string(),
        ..new_job(id, created_at)
    }
}

/// The default thresholds with a poll interval so long that a reading stays
/// current for the whole of a test.
fn unhurried() -> CapacitySettings {
    CapacitySettings {
        poll_interval: Duration::from_secs(24 * 3600),
        ..CapacitySettings::default()
    }
}

/// Move the clock forward by `duration` without waiting for it.
async fn elapse(duration: Duration) {
    tokio::time::pause();
    tokio::time::advance(duration).await;
    tokio::time::resume();
}

/// A state whose artifact store is being watched under `settings`, with two runs
/// queued.
async fn watched_state_with(settings: CapacitySettings) -> (tempfile::TempDir, AppState) {
    let (dir, mut state) = test_state().await;
    state.capacity = CapacityMonitor::watching(settings);
    for (id, at) in [
        ("j1", "2026-10-01T00:00:00Z"),
        ("j2", "2026-10-01T00:01:00Z"),
    ] {
        state.db.enqueue_job(launchable_job(id, at)).await.unwrap();
    }
    (dir, state)
}

/// [`watched_state_with`] the [`unhurried`] settings.
async fn watched_state() -> (tempfile::TempDir, AppState) {
    watched_state_with(unhurried()).await
}

/// Claim once as the dispatcher does, returning the claimed job's id.
async fn claim_run(state: &AppState) -> Option<String> {
    let response = claim(State(state.clone()), ServiceAuth).await.unwrap();
    if response.status() == StatusCode::NO_CONTENT {
        return None;
    }
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    Some(body["jobId"].as_str().unwrap().to_string())
}

/// Each job's state, in queue order.
async fn states(state: &AppState) -> Vec<(String, String)> {
    jobs(state)
        .await
        .into_iter()
        .map(|job| (job.id, job.state))
        .collect()
}

fn pair(id: &str, state: &str) -> (String, String) {
    (id.to_string(), state.to_string())
}

#[tokio::test]
async fn nothing_is_claimed_while_the_store_is_blocked_and_claiming_resumes_after() {
    let (_dir, state) = watched_state().await;

    state.capacity.record(reading(GIB));
    assert_eq!(claim_run(&state).await, None);
    assert_eq!(claim_run(&state).await, None, "a held queue stays held");
    // Held, not failed: both runs are still waiting, and read as deliberately so.
    assert_eq!(
        states(&state).await,
        [pair("j1", "pending"), pair("j2", "pending")]
    );

    // Space returns. The queue drains in its original order.
    state.capacity.record(reading(10 * GIB));
    assert_eq!(claim_run(&state).await.as_deref(), Some("j1"));
    assert_eq!(
        states(&state).await,
        [pair("j1", "dispatched"), pair("j2", "queued")]
    );
    assert_eq!(claim_run(&state).await.as_deref(), Some("j2"));
    assert_eq!(claim_run(&state).await, None, "the queue is empty");
}

#[tokio::test]
async fn a_low_store_still_dispatches() {
    let (_dir, state) = watched_state().await;

    state.capacity.record(reading(5 * GIB / 2));
    assert_eq!(state.capacity.status().state, ArtifactStorageState::Low);
    assert_eq!(claim_run(&state).await.as_deref(), Some("j1"));
}

#[tokio::test]
async fn a_failed_read_stops_the_claim_at_once_and_holds_the_queue_once_it_lasts() {
    // A failed poll pauses the claim, and a reading three poll intervals old is
    // stale, which is the announced hold. The interval is an hour, so that no
    // amount of time this test really takes brings the reading near stale: the
    // clock that matters moves only by `elapse`.
    let (_dir, state) = watched_state_with(CapacitySettings {
        poll_interval: Duration::from_secs(3600),
        ..CapacitySettings::default()
    })
    .await;
    state.capacity.record(reading(10 * GIB));

    // The next poll fails. Nothing is claimed, and nothing about the queue moves:
    // one missed poll must not flip every waiting run to `pending` and back.
    state
        .capacity
        .record_failure(&crate::capacity::CapacityReadError::Refused(
            StatusCode::SERVICE_UNAVAILABLE,
        ));
    // The first reading is the one change so far; with it taken, anything the
    // claim announces is the claim's own.
    state.capacity.take_change().expect("the first reading");
    let mut stream = state.relay.notifier().open_stream();
    assert_eq!(
        claim_run(&state).await,
        None,
        "nothing is dispatched unseen"
    );
    assert_eq!(
        states(&state).await,
        [pair("j1", "queued"), pair("j2", "queued")]
    );
    assert_eq!(state.capacity.status().state, ArtifactStorageState::Ok);
    assert!(!state.capacity.status().runs_on_hold);
    assert!(
        stream.receiver.try_recv().is_err(),
        "a paused claim announces nothing"
    );

    // It lasts: far past the three hours at which the reading is stale.
    elapse(Duration::from_secs(10 * 3600)).await;
    assert_eq!(
        state.capacity.status().state,
        ArtifactStorageState::Unavailable
    );
    assert_eq!(claim_run(&state).await, None);
    assert_eq!(
        states(&state).await,
        [pair("j1", "pending"), pair("j2", "pending")]
    );

    // The service answers again: once is not enough to leave an announced outage.
    state.capacity.record(reading(10 * GIB));
    assert_eq!(claim_run(&state).await, None);
    state.capacity.record(reading(10 * GIB));
    state.capacity.record(reading(10 * GIB));
    assert_eq!(claim_run(&state).await.as_deref(), Some("j1"));
    assert_eq!(claim_run(&state).await.as_deref(), Some("j2"));
}

#[tokio::test]
async fn a_failed_read_followed_by_a_reading_dispatches_as_if_nothing_happened() {
    let (_dir, state) = watched_state().await;
    state.capacity.record(reading(10 * GIB));
    state
        .capacity
        .record_failure(&crate::capacity::CapacityReadError::Refused(
            StatusCode::BAD_GATEWAY,
        ));
    assert_eq!(claim_run(&state).await, None);

    state.capacity.record(reading(10 * GIB));
    assert_eq!(claim_run(&state).await.as_deref(), Some("j1"));
    assert_eq!(
        states(&state).await,
        [pair("j1", "dispatched"), pair("j2", "queued")]
    );
}

#[tokio::test]
async fn nothing_is_claimed_while_the_stores_write_check_fails() {
    let (_dir, state) = watched_state().await;

    state.capacity.record(StoreCapacity::unwritable(
        10 * GIB,
        20 * GIB,
        "Read-only file system (os error 30)",
    ));
    assert_eq!(claim_run(&state).await, None);
    assert_eq!(
        states(&state).await,
        [pair("j1", "pending"), pair("j2", "pending")],
        "held, not failed"
    );

    // One passing check is not the repair; three in a row are.
    state.capacity.record(reading(10 * GIB));
    assert_eq!(claim_run(&state).await, None);
    state.capacity.record(reading(10 * GIB));
    state.capacity.record(reading(10 * GIB));
    assert_eq!(claim_run(&state).await.as_deref(), Some("j1"));
}

#[tokio::test]
async fn the_publish_lane_is_claimed_while_runs_are_on_hold() {
    let (_dir, state) = watched_state().await;
    state
        .db
        .enqueue_publish_job(new_publish_job("p1", "r1", "2026-10-01T00:00:00Z"))
        .await
        .unwrap();
    state.capacity.record(reading(GIB));
    assert!(state.capacity.runs_on_hold());

    let response = crate::api::publish_jobs::claim(State(state.clone()), ServiceAuth)
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["jobId"], "p1");

    assert_eq!(claim_run(&state).await, None, "the run lane is still held");
}

#[tokio::test]
async fn with_no_artifact_service_configured_runs_are_never_held() {
    // The harness's own state: no artifact URL, so nothing is watched.
    let (_dir, state) = test_state().await;
    assert_eq!(
        state.capacity.status().state,
        ArtifactStorageState::Unmonitored
    );
    state
        .db
        .enqueue_job(launchable_job("j1", "2026-10-01T00:00:00Z"))
        .await
        .unwrap();

    // No reading ever arrives, for far longer than any grace.
    elapse(Duration::from_secs(24 * 3600)).await;
    assert_eq!(claim_run(&state).await.as_deref(), Some("j1"));
}

#[tokio::test]
async fn a_pass_that_holds_the_queue_announces_the_runs_it_moved_to_pending() {
    let (_dir, state) = watched_state().await;
    let mut stream = state.relay.notifier().open_stream();
    state.capacity.record(reading(GIB));

    assert_eq!(claim_run(&state).await, None);

    let mut moved = Vec::new();
    while let Ok(message) = stream.receiver.try_recv() {
        if let crate::relay::StreamMessage::Run(event) = message {
            let event = serde_json::to_value(event.as_ref()).unwrap();
            moved.push((
                event["runId"].as_str().unwrap().to_string(),
                event["state"].as_str().unwrap().to_string(),
            ));
        }
    }
    assert_eq!(moved, [pair("j1", "pending"), pair("j2", "pending")]);
}

#[tokio::test]
async fn the_status_route_reports_the_reading_and_the_thresholds() {
    let (_dir, state) = watched_state().await;
    state.capacity.record(reading(GIB));

    let response = crate::api::router(state)
        .oneshot(
            axum::http::Request::builder()
                .uri("/artifacts/capacity")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
        .await
        .unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&bytes).unwrap(),
        serde_json::json!({
            "state": "blocked",
            "runsOnHold": true,
            "holdReason": "low-space",
            "runsWaitingToStore": 0,
            "freeBytes": GIB,
            "totalBytes": 20 * GIB,
            "writable": true,
            "warnBytes": 3 * GIB,
            "stopBytes": 2 * GIB,
        })
    );
}

#[tokio::test]
async fn the_console_stream_opens_with_the_storage_status_after_the_hello_frame() {
    let (_dir, state) = watched_state().await;
    state.capacity.record(reading(5 * GIB / 2));

    let response = notifications(State(state.clone())).await.into_response();
    let mut body = response.into_body().into_data_stream();
    let mut text = String::new();
    // The two opening frames are ready at once; the stream itself never ends.
    while text.matches("\n\n").count() < 2 {
        let chunk = body.next().await.unwrap().unwrap();
        text.push_str(std::str::from_utf8(&chunk).unwrap());
    }

    let frames: Vec<&str> = text.split("\n\n").collect();
    assert!(frames[0].starts_with("event: stream\n"), "{text}");
    assert!(frames[1].starts_with("event: storage\n"), "{text}");
    let data = frames[1]
        .lines()
        .find_map(|line| line.strip_prefix("data: "))
        .unwrap();
    let status: serde_json::Value = serde_json::from_str(data).unwrap();
    assert_eq!(status["state"], "low");
    assert_eq!(status["runsOnHold"], false);
    assert_eq!(status["freeBytes"], 5 * GIB / 2);
}

#[tokio::test]
async fn a_storage_change_reaches_a_stream_whatever_its_topics() {
    let (_dir, state) = watched_state().await;
    let stream = state.relay.notifier().open_stream();
    // Both topics off: a storage change is still wanted.
    state
        .relay
        .notifier()
        .set_topics(&stream.id, Some(false), Some(false));

    state.capacity.record(reading(GIB));
    let message = crate::relay::StreamMessage::Storage(Box::new(state.capacity.status()));
    assert!(stream.wants(&message));
}
