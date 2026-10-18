//! Tests for the `validating` state: a run whose harness session has ended and
//! whose driver is collecting and validating it.
//!
//! The driver's `validating` report moves a job forward from `dispatched`,
//! `starting` or `running` only, and a job in the state is in flight and driven
//! exactly as a `running` one is: it is listed as active, holds its harness's
//! parallelism slot and its cell, is reached by every sweep of the active runs,
//! and can be reported lost. The tests move real job rows through the routes a
//! driver, an operator and the dispatcher use.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};

use super::*;
use crate::api::flow_harness::{GREAT, run_of, test_state};
use crate::db::tests::new_job;
use crate::db::{JobOrigin, OriginScope};

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

/// Post a bare `driver_state` report as `job_id`'s driver does.
async fn report(state: &AppState, job_id: &str, driver_state: DriverState) -> StatusCode {
    post(state, job_id, StatusUpdate::of(driver_state)).await
}

async fn job_state(state: &AppState, id: &str) -> String {
    state.db.get_job(id).await.unwrap().unwrap().state
}

/// Enqueue `ids` in order and claim every one, as the dispatcher does.
async fn claimed(state: &AppState, ids: &[&str]) {
    for (index, id) in ids.iter().enumerate() {
        state
            .db
            .enqueue_job(new_job(id, &format!("2026-10-01T00:0{index}:00Z")))
            .await
            .unwrap();
    }
    for id in ids {
        let claimed = state
            .db
            .claim_next_job("2026-10-01T00:10:00Z")
            .await
            .unwrap()
            .expect("a claimable job");
        assert_eq!(&claimed.id, id);
    }
}

/// A claimed job `id` that has reported `running` then `validating`.
async fn validating_job(state: &AppState, id: &str) {
    claimed(state, &[id]).await;
    assert_eq!(
        report(state, id, DriverState::Running).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        report(state, id, DriverState::Validating).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(job_state(state, id).await, "validating");
}

/// The state of every run-state change the console stream carried, in order.
fn announced_states(stream: &mut crate::relay::StreamHandle) -> Vec<String> {
    let mut states = Vec::new();
    while let Ok(message) = stream.receiver.try_recv() {
        if let crate::relay::StreamMessage::Run(event) = message {
            let event = serde_json::to_value(event.as_ref()).unwrap();
            if event["kind"] == "state-changed" {
                states.push(event["state"].as_str().unwrap().to_string());
            }
        }
    }
    states
}

#[tokio::test]
async fn a_validating_report_moves_a_running_job_on_and_announces_it() {
    let (_dir, state) = test_state().await;
    claimed(&state, &["j1"]).await;
    report(&state, "j1", DriverState::Running).await;
    let mut stream = state.relay.notifier().open_stream();
    state
        .relay
        .notifier()
        .set_topics(&stream.id, None, Some(true));

    assert_eq!(
        report(&state, "j1", DriverState::Validating).await,
        StatusCode::NO_CONTENT
    );

    assert_eq!(job_state(&state, "j1").await, "validating");
    assert_eq!(announced_states(&mut stream), ["validating"]);
    let Json(active) = active(State(state.clone())).await.unwrap();
    let row = active.iter().find(|row| row.run_id == "j1").unwrap();
    assert_eq!(row.state, JobState::Validating);
    assert_eq!(row.detail, None);

    // A repeat moves nothing and announces nothing.
    report(&state, "j1", DriverState::Validating).await;
    assert_eq!(job_state(&state, "j1").await, "validating");
    assert!(announced_states(&mut stream).is_empty());
}

#[tokio::test]
async fn a_validating_report_stamps_the_start_of_a_run_that_reported_none() {
    let (_dir, state) = test_state().await;
    claimed(&state, &["j1"]).await;
    assert_eq!(
        state.db.get_job("j1").await.unwrap().unwrap().started_at,
        None
    );

    report(&state, "j1", DriverState::Validating).await;

    let job = state.db.get_job("j1").await.unwrap().unwrap();
    assert_eq!(job.state, "validating");
    assert!(
        job.started_at.is_some(),
        "a run whose session ended has started"
    );
}

#[tokio::test]
async fn a_late_validating_report_never_moves_a_finished_or_waiting_job() {
    let (_dir, state) = test_state().await;
    claimed(&state, &["canceled", "succeeded", "failed"]).await;
    state
        .db
        .enqueue_job(new_job("queued", "2026-10-01T00:20:00Z"))
        .await
        .unwrap();
    for id in ["canceled", "succeeded", "failed"] {
        report(&state, id, DriverState::Running).await;
    }
    state
        .db
        .cancel_job("canceled", "2026-10-01T01:00:00Z", "canceled by operator")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        post(
            &state,
            "succeeded",
            StatusUpdate {
                record: Some(run_of("r-succeeded", "pong", GREAT)),
                ..StatusUpdate::of(DriverState::Succeeded)
            },
        )
        .await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        post(
            &state,
            "failed",
            StatusUpdate {
                detail: Some("harness unavailable".to_string()),
                ..StatusUpdate::of(DriverState::Failed)
            },
        )
        .await,
        StatusCode::NO_CONTENT
    );
    let mut stream = state.relay.notifier().open_stream();
    state
        .relay
        .notifier()
        .set_topics(&stream.id, None, Some(true));

    for id in ["canceled", "succeeded", "failed", "queued"] {
        assert_eq!(
            report(&state, id, DriverState::Validating).await,
            StatusCode::NO_CONTENT,
            "{id}"
        );
    }

    assert_eq!(job_state(&state, "canceled").await, "canceled");
    assert_eq!(job_state(&state, "succeeded").await, "succeeded");
    assert_eq!(job_state(&state, "failed").await, "failed");
    assert_eq!(job_state(&state, "queued").await, "queued");
    assert!(
        announced_states(&mut stream).is_empty(),
        "nothing moved, so nothing is announced"
    );
}

#[tokio::test]
async fn the_move_to_validating_is_from_the_states_before_it_alone() {
    let (_dir, state) = test_state().await;
    claimed(&state, &["dispatched", "starting", "running", "storing"]).await;
    let now = "2026-10-01T02:00:00Z";
    state
        .db
        .set_job_state("starting", "starting", now, None, None)
        .await
        .unwrap();
    state
        .db
        .set_job_state("running", "running", now, None, None)
        .await
        .unwrap();
    state
        .db
        .set_job_storing("storing", now, Some("HTTP 500"), None)
        .await
        .unwrap()
        .unwrap();

    for id in ["dispatched", "starting", "running"] {
        let moved = state.db.set_job_validating(id, now).await.unwrap();
        assert_eq!(moved.expect(id).state, "validating", "{id}");
    }
    // A `storing` job's wait ends only through the wait-over report, and a job
    // already `validating` is not moved again.
    assert!(
        state
            .db
            .set_job_validating("storing", now)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(job_state(&state, "storing").await, "storing");
    assert!(
        state
            .db
            .set_job_validating("running", now)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        state
            .db
            .set_job_validating("nope", now)
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn the_end_of_a_wait_on_the_store_returns_the_job_to_validating() {
    let (_dir, state) = test_state().await;
    validating_job(&state, "j1").await;
    assert_eq!(
        post(
            &state,
            "j1",
            StatusUpdate {
                record: Some(run_of("r1", "pong", GREAT)),
                detail: Some("HTTP 500".to_string()),
                ..StatusUpdate::of(DriverState::Storing)
            },
        )
        .await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(job_state(&state, "j1").await, "storing");
    let mut stream = state.relay.notifier().open_stream();
    state
        .relay
        .notifier()
        .set_topics(&stream.id, None, Some(true));

    assert_eq!(
        post(
            &state,
            "j1",
            StatusUpdate {
                artifacts_stored: Some(true),
                ..StatusUpdate::of(DriverState::Validating)
            },
        )
        .await,
        StatusCode::NO_CONTENT
    );

    let job = state.db.get_job("j1").await.unwrap().unwrap();
    assert_eq!(job.state, "validating");
    assert_eq!(job.detail, None, "the wait's reason goes with the wait");
    let held: serde_json::Value =
        serde_json::from_str(job.held_report_json.as_deref().expect("still held")).unwrap();
    assert_eq!(
        held["artifactsStored"], true,
        "the held report says the tree landed"
    );
    assert_eq!(announced_states(&mut stream), ["validating"]);
}

#[tokio::test]
async fn a_wait_ended_as_running_by_an_older_driver_lands_the_same_way() {
    let (_dir, state) = test_state().await;
    validating_job(&state, "j1").await;
    post(
        &state,
        "j1",
        StatusUpdate {
            detail: Some("HTTP 500".to_string()),
            ..StatusUpdate::of(DriverState::Storing)
        },
    )
    .await;
    assert_eq!(job_state(&state, "j1").await, "storing");

    report(&state, "j1", DriverState::Running).await;

    let job = state.db.get_job("j1").await.unwrap().unwrap();
    assert_eq!(job.state, "validating");
    assert_eq!(job.detail, None);
}

#[tokio::test]
async fn a_validating_job_is_in_flight_and_driven() {
    let (_dir, state) = test_state().await;
    validating_job(&state, "j1").await;

    assert!(crate::db::DRIVEN_STATES.contains(&"validating"));
    assert!(crate::db::CANCELABLE_ACTIVE_STATES.contains(&"validating"));
    assert!(!crate::db::CANCELABLE_WAITING_STATES.contains(&"validating"));
    assert_eq!(state.db.driven_job_count().await.unwrap(), 1);
    let active: Vec<String> = state
        .db
        .active_jobs()
        .await
        .unwrap()
        .into_iter()
        .map(|job| job.id)
        .collect();
    assert_eq!(active, ["j1"]);
    let counts = state
        .db
        .count_in_flight_jobs_by_cell(&["pong".to_string()])
        .await
        .unwrap();
    assert_eq!(
        counts.values().sum::<u32>(),
        1,
        "a validating run holds its cell"
    );
}

#[tokio::test]
async fn a_validating_run_holds_its_harness_slot() {
    let (_dir, state) = test_state().await;
    state
        .db
        .set_harness_max_parallelism("claude", Some(1), "2026-10-01T00:00:00Z")
        .await
        .unwrap();
    validating_job(&state, "j1").await;
    state
        .db
        .enqueue_job(new_job("j2", "2026-10-01T00:20:00Z"))
        .await
        .unwrap();

    assert!(
        state
            .db
            .claim_next_job("2026-10-01T00:21:00Z")
            .await
            .unwrap()
            .is_none(),
        "the harness's one slot is still taken"
    );
    assert_eq!(job_state(&state, "j2").await, "pending");

    post(
        &state,
        "j1",
        StatusUpdate {
            record: Some(run_of("r1", "pong", GREAT)),
            ..StatusUpdate::of(DriverState::Succeeded)
        },
    )
    .await;
    let released = state
        .db
        .claim_next_job("2026-10-01T00:22:00Z")
        .await
        .unwrap();
    assert_eq!(released.expect("the slot freed").id, "j2");
}

#[tokio::test]
async fn killing_the_active_runs_reaches_a_validating_one() {
    let (_dir, state) = test_state().await;
    validating_job(&state, "j1").await;

    let Json(out) = cancel_active(State(state.clone()), crate::api::flow_harness::owner())
        .await
        .unwrap();

    assert_eq!(out.canceled, 1);
    assert_eq!(job_state(&state, "j1").await, "canceled");
}

#[tokio::test]
async fn halting_everything_a_plan_launched_reaches_its_validating_run() {
    let (_dir, state) = test_state().await;
    state
        .db
        .enqueue_job(crate::db::NewJob {
            origin: Some(JobOrigin::plan("p1")),
            ..new_job("j1", "2026-10-01T00:00:00Z")
        })
        .await
        .unwrap();
    state
        .db
        .claim_next_job("2026-10-01T00:01:00Z")
        .await
        .unwrap()
        .unwrap();
    report(&state, "j1", DriverState::Validating).await;
    assert_eq!(job_state(&state, "j1").await, "validating");
    let plan = OriginScope::Prefix("plan:p1".to_string());

    // A plain halt spares it: it is already paid for.
    let halted = crate::api::coverage::halt_jobs(&state, &plan, false, "halted")
        .await
        .unwrap();
    assert_eq!(halted, 0);
    assert_eq!(job_state(&state, "j1").await, "validating");

    // Halt all (and a ladder's stop with `cancelRunning`, which is the same sweep)
    // reaches it.
    let halted = crate::api::coverage::halt_jobs(&state, &plan, true, "halted")
        .await
        .unwrap();
    assert_eq!(halted, 1);
    assert_eq!(job_state(&state, "j1").await, "canceled");
}

#[tokio::test]
async fn a_validating_job_whose_driver_is_gone_is_failed_as_lost() {
    let (_dir, state) = test_state().await;
    validating_job(&state, "j1").await;

    let status = report_lost(
        State(state.clone()),
        ServiceAuth,
        Path("j1".to_string()),
        Json(StatusUpdate {
            detail: Some("the driver Job no longer exists".to_string()),
            ..StatusUpdate::of(DriverState::Failed)
        }),
    )
    .await
    .unwrap();

    assert_eq!(status, StatusCode::NO_CONTENT);
    let lost = state.db.get_job("j1").await.unwrap().unwrap();
    assert_eq!(lost.state, "failed");
    assert_eq!(
        lost.detail.as_deref(),
        Some("the driver Job no longer exists")
    );
}

#[tokio::test]
async fn a_late_running_report_never_moves_a_validating_job_back() {
    let (_dir, state) = test_state().await;
    validating_job(&state, "j1").await;
    let mut stream = state.relay.notifier().open_stream();
    state
        .relay
        .notifier()
        .set_topics(&stream.id, None, Some(true));

    assert_eq!(
        report(&state, "j1", DriverState::Running).await,
        StatusCode::NO_CONTENT
    );

    assert_eq!(job_state(&state, "j1").await, "validating");
    assert!(
        announced_states(&mut stream).is_empty(),
        "nothing moved, so nothing is announced"
    );
}

#[tokio::test]
async fn the_move_to_running_is_from_the_states_before_validating_alone() {
    let (_dir, state) = test_state().await;
    claimed(
        &state,
        &[
            "dispatched",
            "starting",
            "running",
            "validating",
            "storing",
            "succeeded",
        ],
    )
    .await;
    state
        .db
        .enqueue_job(new_job("queued", "2026-10-01T00:20:00Z"))
        .await
        .unwrap();
    let now = "2026-10-01T02:00:00Z";
    state
        .db
        .set_job_state("starting", "starting", now, None, None)
        .await
        .unwrap();
    for id in ["running", "validating", "storing", "succeeded"] {
        state.db.set_job_running(id, now).await.unwrap().expect(id);
    }
    state
        .db
        .set_job_validating("validating", now)
        .await
        .unwrap()
        .unwrap();
    state
        .db
        .set_job_storing("storing", now, Some("HTTP 500"), None)
        .await
        .unwrap()
        .unwrap();
    state
        .db
        .set_job_state("succeeded", "succeeded", now, None, None)
        .await
        .unwrap();

    // A repeat `running` report refreshes a `running` job.
    for id in ["dispatched", "starting", "running"] {
        let moved = state.db.set_job_running(id, now).await.unwrap();
        let moved = moved.expect(id);
        assert_eq!(moved.state, "running", "{id}");
        assert!(moved.started_at.is_some(), "{id}");
    }
    for id in ["validating", "storing", "succeeded", "queued", "nope"] {
        assert!(
            state.db.set_job_running(id, now).await.unwrap().is_none(),
            "{id}"
        );
    }
    assert_eq!(job_state(&state, "validating").await, "validating");
    assert_eq!(job_state(&state, "storing").await, "storing");
    assert_eq!(job_state(&state, "succeeded").await, "succeeded");
    assert_eq!(job_state(&state, "queued").await, "queued");
}
