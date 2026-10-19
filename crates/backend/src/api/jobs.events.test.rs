//! Tests for a job's delivered events through the routes: each batch stored before it
//! is acknowledged and only then fanned out, the run recorded with the stored stream
//! whatever relay the backend holds by then, a resent batch read once, the live stream
//! replaying the stored events as its backlog, and a job that ends with no record
//! keeping its stored stream (the driver's events page, "Delivery to the backend";
//! the backend's overview, "Restarts").
//!
//! A backend restart is a fresh [`Relay`] over the same database: everything the
//! backend keeps in memory is gone, everything it stored is not.

use std::time::Duration;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use futures_util::StreamExt;
use test_cabinet_contracts::event::{EventKind, HarnessEvent};
use test_cabinet_contracts::run_record::{RunRecord, RunState};

use super::*;
use crate::api::flow_harness::{GREAT, ended_run, enqueue_other, run_of, set_state, test_state};
use crate::relay::Relay;

/// An agent event saying `message`.
fn event(message: &str) -> HarnessEvent {
    HarnessEvent {
        timestamp: "2026-10-19T12:00:00Z".to_string(),
        session_id: None,
        kind: EventKind::Agent {
            message: message.to_string(),
        },
    }
}

/// The batch of agent events saying each of `messages`, the first at `sequence`.
fn batch(sequence: u64, messages: &[&str]) -> EventBatch {
    EventBatch {
        sequence,
        events: messages.iter().copied().map(event).collect(),
    }
}

/// The messages of `stream`, in order.
fn messages(stream: &[HarnessEvent]) -> Vec<String> {
    stream
        .iter()
        .map(|event| match &event.kind {
            EventKind::Agent { message } => message.clone(),
            other => panic!("not an agent event: {other:?}"),
        })
        .collect()
}

/// The same backend after a restart: the database it wrote, a relay that never saw a
/// thing.
fn restarted(state: &AppState) -> AppState {
    AppState {
        relay: Relay::new(),
        ..state.clone()
    }
}

/// `job_id`'s driver's headers, carrying its per-job token.
async fn driver_headers(state: &AppState, job_id: &str) -> HeaderMap {
    let token = state.db.get_job(job_id).await.unwrap().unwrap().job_token;
    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::AUTHORIZATION,
        format!("Bearer {token}").parse().unwrap(),
    );
    headers
}

/// Deliver `batch` as `job_id`'s driver does and assert it was acknowledged.
async fn deliver(state: &AppState, job_id: &str, batch: EventBatch) {
    let headers = driver_headers(state, job_id).await;
    let status = ingest_events(
        State(state.clone()),
        Path(job_id.to_string()),
        headers,
        Json(batch),
    )
    .await
    .unwrap();
    assert_eq!(status, StatusCode::NO_CONTENT);
}

/// Post a status of `driver_state` carrying `record` and `detail` as `job_id`'s
/// driver does, and assert it was acknowledged.
async fn report(
    state: &AppState,
    job_id: &str,
    driver_state: DriverState,
    record: Option<RunRecord>,
    detail: Option<&str>,
) {
    let headers = driver_headers(state, job_id).await;
    let status = Box::pin(update_status(
        State(state.clone()),
        Path(job_id.to_string()),
        headers,
        Json(StatusUpdate {
            state: driver_state,
            record,
            detail: detail.map(str::to_string),
            artifacts_stored: None,
            store_fault: None,
        }),
    ))
    .await
    .unwrap();
    assert_eq!(status, StatusCode::NO_CONTENT);
}

/// Enqueue `job_id` and move it to `running`, as a claimed, executing run is.
async fn running_job(state: &AppState, job_id: &str) {
    enqueue_other(state, job_id, "pong", None).await;
    report(state, job_id, DriverState::Running, None, None).await;
}

/// The messages `GET /runs/{id}/events` serves for `run_id`.
async fn run_events(state: &AppState, run_id: &str) -> Vec<String> {
    let response = crate::api::runs::events(State(state.clone()), Path(run_id.to_string()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let events: Vec<HarnessEvent> = serde_json::from_slice(&body).unwrap();
    messages(&events)
}

/// The NDJSON body of `GET /jobs/{id}/live` for `job_id`, as a stream of its lines.
async fn open_live(state: &AppState, job_id: &str) -> LiveLines {
    let response = live(State(state.clone()), Path(job_id.to_string()))
        .await
        .unwrap();
    LiveLines {
        body: Box::pin(response.into_body().into_data_stream()),
        pending: String::new(),
    }
}

/// A live stream's body, read a line at a time.
struct LiveLines {
    body: std::pin::Pin<
        Box<dyn futures_util::Stream<Item = Result<Bytes, axum::Error>> + Send + 'static>,
    >,
    pending: String,
}

impl LiveLines {
    /// The next event line's message, skipping heartbeats, or `None` once the stream
    /// has closed. Fails the test if no line arrives within a few seconds.
    async fn next_message(&mut self) -> Option<String> {
        loop {
            if let Some(end) = self.pending.find('\n') {
                let line: String = self.pending.drain(..=end).collect();
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let event: HarnessEvent = serde_json::from_str(line).unwrap();
                return Some(messages(std::slice::from_ref(&event)).remove(0));
            }
            let chunk = tokio::time::timeout(Duration::from_secs(5), self.body.next())
                .await
                .expect("the live stream produced a line in time");
            match chunk {
                Some(bytes) => self
                    .pending
                    .push_str(std::str::from_utf8(&bytes.unwrap()).unwrap()),
                None => return None,
            }
        }
    }

    /// The next `count` event messages.
    async fn take(&mut self, count: usize) -> Vec<String> {
        let mut out = Vec::with_capacity(count);
        for _ in 0..count {
            out.push(self.next_message().await.expect("the stream is still open"));
        }
        out
    }

    /// Every remaining event message, until the stream closes.
    async fn rest(&mut self) -> Vec<String> {
        let mut out = Vec::new();
        while let Some(message) = self.next_message().await {
            out.push(message);
        }
        out
    }
}

fn owned(messages: &[&str]) -> Vec<String> {
    messages.iter().map(|message| message.to_string()).collect()
}

#[tokio::test]
async fn a_restart_mid_run_loses_none_of_the_recorded_stream() {
    let (_dir, state) = test_state().await;
    running_job(&state, "j").await;
    deliver(&state, "j", batch(0, &["a", "b"])).await;

    // The backend restarts between two batches; the driver carries on against the
    // new one, which never relayed the first batch.
    let state = restarted(&state);
    deliver(&state, "j", batch(2, &["c"])).await;
    report(
        &state,
        "j",
        DriverState::Succeeded,
        Some(run_of("run-j", "pong", GREAT)),
        None,
    )
    .await;

    assert_eq!(run_events(&state, "run-j").await, owned(&["a", "b", "c"]));
}

#[tokio::test]
async fn a_resent_batch_is_recorded_and_streamed_once() {
    let (_dir, state) = test_state().await;
    running_job(&state, "j").await;
    let mut viewer = open_live(&state, "j").await;

    deliver(&state, "j", batch(0, &["a", "b"])).await;
    // The acknowledgement was lost; the driver sends the same batch again, and then
    // one overlapping it.
    deliver(&state, "j", batch(0, &["a", "b"])).await;
    deliver(&state, "j", batch(1, &["b", "c"])).await;
    report(
        &state,
        "j",
        DriverState::Succeeded,
        Some(run_of("run-j", "pong", GREAT)),
        None,
    )
    .await;

    assert_eq!(viewer.rest().await, owned(&["a", "b", "c"]));
    assert_eq!(run_events(&state, "run-j").await, owned(&["a", "b", "c"]));
    let mut late = open_live(&state, "j").await;
    assert_eq!(late.rest().await, owned(&["a", "b", "c"]));
}

#[tokio::test]
async fn the_live_stream_replays_the_stored_events_after_a_restart() {
    let (_dir, state) = test_state().await;
    running_job(&state, "j").await;
    deliver(&state, "j", batch(0, &["a", "b"])).await;

    let state = restarted(&state);
    let mut viewer = open_live(&state, "j").await;
    assert_eq!(viewer.take(2).await, owned(&["a", "b"]));

    // The live tail follows the replay, without repeating it.
    deliver(&state, "j", batch(0, &["a", "b"])).await;
    deliver(&state, "j", batch(2, &["c"])).await;
    assert_eq!(viewer.take(1).await, owned(&["c"]));

    report(
        &state,
        "j",
        DriverState::Succeeded,
        Some(run_of("run-j", "pong", GREAT)),
        None,
    )
    .await;
    assert!(viewer.rest().await.is_empty());
}

#[tokio::test]
async fn a_finished_job_restarted_away_closes_after_its_stored_events() {
    let (_dir, state) = test_state().await;
    running_job(&state, "j").await;
    deliver(&state, "j", batch(0, &["a", "b"])).await;
    report(
        &state,
        "j",
        DriverState::Succeeded,
        Some(run_of("run-j", "pong", GREAT)),
        None,
    )
    .await;

    let state = restarted(&state);
    let mut viewer = open_live(&state, "j").await;
    assert_eq!(viewer.rest().await, owned(&["a", "b"]));
}

#[tokio::test]
async fn an_event_both_replayed_and_fanned_out_is_streamed_once() {
    // The race the live handler orders against: an event stored after the viewer
    // subscribed but before it read the backlog reaches it twice, once from the
    // database and once from the channel.
    let (_dir, state) = test_state().await;
    running_job(&state, "j").await;
    deliver(&state, "j", batch(0, &["a"])).await;

    let live = state.relay.live("j");
    let sub = live.subscribe();
    let stored = state
        .db
        .store_job_events("j", 1, &[event("b")])
        .await
        .unwrap();
    let backlog = state.db.job_events_after("j", None).await.unwrap();
    live.push_events(stored);
    live.push_events(vec![(2, event("c"))]);
    live.finish();

    let lines: Vec<String> =
        event_stream(Arc::clone(&state.db), "j".to_string(), sub, backlog, false)
            .map(|line| String::from_utf8(line.unwrap().to_vec()).unwrap())
            .collect()
            .await;
    let streamed: Vec<String> = lines
        .iter()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .map(|line| {
            let event: HarnessEvent = serde_json::from_str(line).unwrap();
            messages(std::slice::from_ref(&event)).remove(0)
        })
        .collect();
    assert_eq!(streamed, owned(&["a", "b", "c"]));
}

#[tokio::test]
async fn a_viewer_that_falls_behind_reads_what_it_missed_from_the_database() {
    let (_dir, state) = test_state().await;
    running_job(&state, "j").await;
    let mut viewer = open_live(&state, "j").await;

    // More events than the live channel holds arrive while the viewer reads none.
    let names: Vec<String> = (0..1500).map(|n| format!("e{n}")).collect();
    let names: Vec<&str> = names.iter().map(String::as_str).collect();
    deliver(&state, "j", batch(0, &names)).await;
    report(
        &state,
        "j",
        DriverState::Succeeded,
        Some(run_of("run-j", "pong", GREAT)),
        None,
    )
    .await;

    assert_eq!(viewer.rest().await, owned(&names));
}

#[tokio::test]
async fn a_job_that_ends_with_no_record_keeps_its_stored_stream() {
    let (_dir, state) = test_state().await;
    running_job(&state, "j").await;
    deliver(&state, "j", batch(0, &["a", "b"])).await;

    report(
        &state,
        "j",
        DriverState::Failed,
        None,
        Some("the harness could not start"),
    )
    .await;

    let job = state.db.get_job("j").await.unwrap().unwrap();
    assert_eq!(job.state, "failed");
    assert_eq!(job.record_id, None);
    assert_eq!(
        messages(&state.db.job_events("j").await.unwrap()),
        owned(&["a", "b"])
    );
    let mut viewer = open_live(&restarted(&state), "j").await;
    assert_eq!(viewer.rest().await, owned(&["a", "b"]));
}

#[tokio::test]
async fn a_canceled_report_records_the_events_already_stored() {
    let (_dir, state) = test_state().await;
    running_job(&state, "j").await;
    deliver(&state, "j", batch(0, &["a", "b"])).await;

    // The operator's kill lands while the backend restarts; the driver's partial
    // record arrives at the new one.
    set_state(&state, "j", "canceled").await;
    let state = restarted(&state);
    deliver(&state, "j", batch(2, &["c"])).await;
    report(
        &state,
        "j",
        DriverState::Canceled,
        Some(ended_run("run-j", "pong", RunState::HarnessError)),
        None,
    )
    .await;

    let job = state.db.get_job("j").await.unwrap().unwrap();
    assert_eq!(job.state, "canceled");
    assert_eq!(job.record_id.as_deref(), Some("run-j"));
    assert_eq!(run_events(&state, "run-j").await, owned(&["a", "b", "c"]));
}

#[tokio::test]
async fn a_run_with_no_events_stored_records_none() {
    let (_dir, state) = test_state().await;
    running_job(&state, "j").await;
    report(
        &state,
        "j",
        DriverState::Succeeded,
        Some(run_of("run-j", "pong", GREAT)),
        None,
    )
    .await;

    assert!(run_events(&state, "run-j").await.is_empty());
    let run = state.db.get_run("run-j").await.unwrap().unwrap();
    assert_eq!(run.events_json, None);
}
