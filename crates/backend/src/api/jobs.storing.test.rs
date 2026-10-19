//! Tests for the held record: the driver's `storing` report, finishing a job whose
//! driver is lost or dead from the record it held, terminal reports repeated after
//! their answer was lost, terminal reports that supersede a lost outcome, and
//! `artifactsStored` on the run.
//!
//! Each test moves real job rows through the routes a driver and the dispatcher use,
//! over the flow tests' in-memory backend.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use test_cabinet_contracts::run_record::{RunRecord, RunState};

use super::*;
use crate::api::flow_harness::{GREAT, ended_run, enqueue_other, jobs, run_of, test_state};
use crate::relay::StreamMessage;

/// A failure detail a driver reports beside a failed run's record.
const FAILURE: &str = "the harness exited with status 1";

/// Post `update` as `job_id`'s driver does, with its per-job token.
async fn post(
    state: &AppState,
    job_id: &str,
    update: StatusUpdate,
) -> Result<StatusCode, ApiError> {
    let token = state.db.get_job(job_id).await.unwrap().unwrap().job_token;
    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::AUTHORIZATION,
        format!("Bearer {token}").parse().unwrap(),
    );
    // Boxed: the handler's future is large, and a test awaiting several reports in a
    // row would otherwise hold it on the test thread's stack.
    Box::pin(update_status(
        State(state.clone()),
        Path(job_id.to_string()),
        headers,
        Json(update),
    ))
    .await
}

/// A status update of `driver_state` carrying `record` and `detail`.
fn update(
    driver_state: DriverState,
    record: Option<RunRecord>,
    detail: Option<&str>,
) -> StatusUpdate {
    StatusUpdate {
        state: driver_state,
        record,
        detail: detail.map(str::to_string),
        artifacts_stored: None,
        store_fault: None,
    }
}

/// Post `update` and assert it was answered `204`.
async fn accepted(state: &AppState, job_id: &str, update: StatusUpdate) {
    assert_eq!(
        post(state, job_id, update).await.unwrap(),
        StatusCode::NO_CONTENT
    );
}

/// Report `job_id` lost as the dispatcher does, with the service token.
async fn lose(state: &AppState, job_id: &str) {
    let status = Box::pin(report_lost(
        State(state.clone()),
        ServiceAuth,
        Path(job_id.to_string()),
        Json(update(
            DriverState::Failed,
            None,
            Some("the driver Job no longer exists"),
        )),
    ))
    .await
    .unwrap();
    assert_eq!(status, StatusCode::NO_CONTENT);
}

/// Enqueue `job_id` and move it to `running` as a claimed, executing run is.
async fn running_job(state: &AppState, job_id: &str) {
    enqueue_other(state, job_id, "pong", None).await;
    accepted(state, job_id, update(DriverState::Running, None, None)).await;
}

async fn job(state: &AppState, job_id: &str) -> job::Model {
    state.db.get_job(job_id).await.unwrap().unwrap()
}

/// The record a job holds, decoded.
fn held(job: &job::Model) -> Option<RunRecord> {
    job.held_record
        .as_deref()
        .map(|json| serde_json::from_str(json).unwrap())
}

/// Every alert published on `stream` since it was opened or last drained.
fn notifications(stream: &mut crate::relay::StreamHandle) -> usize {
    let mut count = 0;
    while let Ok(message) = stream.receiver.try_recv() {
        if matches!(message, StreamMessage::Notification(_)) {
            count += 1;
        }
    }
    count
}

#[tokio::test]
async fn a_storing_report_holds_the_record_and_a_repeat_replaces_it() {
    let (_dir, state) = test_state().await;
    running_job(&state, "j").await;

    let first = ended_run("run-j", "pong", RunState::HarnessError);
    accepted(
        &state,
        "j",
        update(DriverState::Storing, Some(first.clone()), Some(FAILURE)),
    )
    .await;
    let stored = job(&state, "j").await;
    assert_eq!(stored.state, "storing");
    assert_eq!(held(&stored), Some(first));
    assert_eq!(stored.held_detail.as_deref(), Some(FAILURE));
    // Still in flight: listed as active and holding its parallelism slot.
    assert!(
        state
            .db
            .active_jobs()
            .await
            .unwrap()
            .iter()
            .any(|job| job.id == "j" && job.state == "storing")
    );

    let second = run_of("run-j", "pong", GREAT);
    accepted(
        &state,
        "j",
        update(DriverState::Storing, Some(second.clone()), None),
    )
    .await;
    let replaced = job(&state, "j").await;
    assert_eq!(replaced.state, "storing");
    assert_eq!(held(&replaced), Some(second));
    assert_eq!(replaced.held_detail, None);
}

#[tokio::test]
async fn a_storing_report_without_a_record_is_refused() {
    let (_dir, state) = test_state().await;
    running_job(&state, "j").await;

    let refused = post(&state, "j", update(DriverState::Storing, None, None))
        .await
        .unwrap_err();
    assert_eq!(refused.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(job(&state, "j").await.state, "running");
}

#[tokio::test]
async fn a_storing_report_on_a_canceled_job_is_discarded() {
    let (_dir, state) = test_state().await;
    running_job(&state, "j").await;
    state
        .db
        .cancel_job("j", "2026-10-02T00:00:00Z", "canceled by operator")
        .await
        .unwrap()
        .unwrap();

    accepted(
        &state,
        "j",
        update(
            DriverState::Storing,
            Some(run_of("run-j", "pong", GREAT)),
            None,
        ),
    )
    .await;
    let canceled = job(&state, "j").await;
    assert_eq!(canceled.state, "canceled");
    assert_eq!(canceled.held_record, None);
}

#[tokio::test]
async fn a_storing_job_can_be_canceled() {
    let (_dir, state) = test_state().await;
    running_job(&state, "j").await;
    accepted(
        &state,
        "j",
        update(
            DriverState::Storing,
            Some(run_of("run-j", "pong", GREAT)),
            None,
        ),
    )
    .await;

    let canceled = state
        .db
        .cancel_job("j", "2026-10-02T00:00:00Z", "canceled by operator")
        .await
        .unwrap();
    assert_eq!(canceled.map(|job| job.state).as_deref(), Some("canceled"));
}

#[tokio::test]
async fn a_job_lost_after_its_held_report_is_recorded_from_it_with_no_retry() {
    let (_dir, state) = test_state().await;
    running_job(&state, "j").await;
    let record = run_of("run-j", "pong", GREAT);
    accepted(
        &state,
        "j",
        update(DriverState::Storing, Some(record.clone()), None),
    )
    .await;

    lose(&state, "j").await;

    let finished = job(&state, "j").await;
    assert_eq!(finished.state, "succeeded");
    assert_eq!(finished.record_id.as_deref(), Some("run-j"));
    assert_eq!(finished.retried_by, None);
    assert!(finished.lost_at.is_some());
    assert_eq!(finished.held_record, None);
    assert_eq!(jobs(&state).await.len(), 1, "no retry is enqueued");
    let run = state.db.get_run("run-j").await.unwrap().unwrap();
    assert_eq!(run.record.status.state, RunState::Completed);
}

#[tokio::test]
async fn a_lost_failed_run_keeps_its_state_and_detail_and_is_not_retried() {
    let (_dir, state) = test_state().await;
    running_job(&state, "j").await;
    // A harness error is retryable when the driver reports it; finished from the held
    // record it is not.
    let record = ended_run("run-j", "pong", RunState::HarnessError);
    accepted(
        &state,
        "j",
        update(DriverState::Storing, Some(record), Some(FAILURE)),
    )
    .await;

    lose(&state, "j").await;

    let finished = job(&state, "j").await;
    assert_eq!(finished.state, "failed");
    assert_eq!(finished.detail.as_deref(), Some(FAILURE));
    assert_eq!(finished.record_id.as_deref(), Some("run-j"));
    assert_eq!(finished.retried_by, None);
    assert_eq!(jobs(&state).await.len(), 1);
    let run = state.db.get_run("run-j").await.unwrap().unwrap();
    assert_eq!(run.record.status.state, RunState::HarnessError);
}

#[tokio::test]
async fn a_dead_report_on_a_storing_job_finishes_it_from_the_held_record() {
    let (_dir, state) = test_state().await;
    running_job(&state, "j").await;
    accepted(
        &state,
        "j",
        update(
            DriverState::Storing,
            Some(run_of("run-j", "pong", GREAT)),
            None,
        ),
    )
    .await;

    // The dispatcher's death report: `failed`, no record, the per-job token.
    accepted(
        &state,
        "j",
        update(DriverState::Failed, None, Some("pod failed: OOMKilled")),
    )
    .await;

    let finished = job(&state, "j").await;
    assert_eq!(finished.state, "succeeded");
    assert_eq!(finished.record_id.as_deref(), Some("run-j"));
    assert_eq!(finished.retried_by, None);
    assert_eq!(jobs(&state).await.len(), 1, "no retry is enqueued");
}

#[tokio::test]
async fn a_job_lost_with_no_held_record_fails_as_infrastructure_and_is_retried() {
    let (_dir, state) = test_state().await;
    running_job(&state, "j").await;

    lose(&state, "j").await;

    let lost = job(&state, "j").await;
    assert_eq!(lost.state, "failed");
    assert_eq!(lost.record_id, None);
    assert!(lost.lost_at.is_some());
    let retry = lost.retried_by.expect("the lost job is retried");
    assert_eq!(job(&state, &retry).await.state, "queued");
}

#[tokio::test]
async fn a_terminal_report_after_a_lost_report_keeps_the_record_and_removes_the_queued_retry() {
    let (_dir, state) = test_state().await;
    running_job(&state, "j").await;
    lose(&state, "j").await;
    let retry = job(&state, "j").await.retried_by.unwrap();

    accepted(
        &state,
        "j",
        update(
            DriverState::Succeeded,
            Some(run_of("run-j", "pong", GREAT)),
            None,
        ),
    )
    .await;

    let superseded = job(&state, "j").await;
    assert_eq!(superseded.state, "succeeded");
    assert_eq!(superseded.record_id.as_deref(), Some("run-j"));
    assert_eq!(superseded.retried_by, None);
    assert_eq!(superseded.lost_at, None);
    assert!(state.db.get_job(&retry).await.unwrap().is_none());
    assert_eq!(jobs(&state).await.len(), 1);
    assert!(state.db.get_run("run-j").await.unwrap().is_some());

    // The same report repeated after its answer was lost changes nothing more.
    accepted(
        &state,
        "j",
        update(
            DriverState::Succeeded,
            Some(run_of("run-j", "pong", GREAT)),
            None,
        ),
    )
    .await;
    assert_eq!(jobs(&state).await.len(), 1);
}

#[tokio::test]
async fn a_terminal_report_after_a_lost_report_cancels_a_claimed_retry() {
    let (_dir, state) = test_state().await;
    running_job(&state, "j").await;
    lose(&state, "j").await;
    let retry = job(&state, "j").await.retried_by.unwrap();
    let claimed = state
        .db
        .claim_next_job("2026-10-02T00:00:00Z")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(claimed.id, retry);
    accepted(&state, &retry, update(DriverState::Running, None, None)).await;

    // A failed run whose record says the model's own failure: not retryable, and the
    // superseding report enqueues no retry of its own either way.
    accepted(
        &state,
        "j",
        update(
            DriverState::Failed,
            Some(ended_run("run-j", "pong", RunState::HarnessError)),
            Some(FAILURE),
        ),
    )
    .await;

    let superseded = job(&state, "j").await;
    assert_eq!(superseded.state, "failed");
    assert_eq!(superseded.detail.as_deref(), Some(FAILURE));
    assert_eq!(superseded.record_id.as_deref(), Some("run-j"));
    assert_eq!(superseded.retried_by, None);
    assert_eq!(job(&state, &retry).await.state, "canceled");
    assert_eq!(jobs(&state).await.len(), 2, "no new retry is enqueued");
}

#[tokio::test]
async fn a_recordless_terminal_report_after_a_lost_report_changes_nothing() {
    let (_dir, state) = test_state().await;
    running_job(&state, "j").await;
    lose(&state, "j").await;
    let before = job(&state, "j").await;

    accepted(
        &state,
        "j",
        update(
            DriverState::Failed,
            None,
            Some("driver interrupted by SIGTERM"),
        ),
    )
    .await;

    assert_eq!(job(&state, "j").await, before);
    let retry = before.retried_by.unwrap();
    assert_eq!(job(&state, &retry).await.state, "queued");
}

#[tokio::test]
async fn a_repeated_terminal_report_answers_204_and_changes_nothing() {
    let (_dir, state) = test_state().await;
    running_job(&state, "j").await;
    let mut stream = state.relay.notifier().open_stream();

    let record = run_of("run-j", "pong", GREAT);
    accepted(
        &state,
        "j",
        update(DriverState::Succeeded, Some(record.clone()), None),
    )
    .await;
    let first = job(&state, "j").await;
    assert_eq!(first.state, "succeeded");
    assert_eq!(notifications(&mut stream), 1);

    accepted(
        &state,
        "j",
        update(DriverState::Succeeded, Some(record), None),
    )
    .await;
    assert_eq!(job(&state, "j").await, first);
    assert_eq!(notifications(&mut stream), 0, "no second notification");
}

#[tokio::test]
async fn a_repeated_failed_report_enqueues_no_second_retry() {
    let (_dir, state) = test_state().await;
    running_job(&state, "j").await;
    let failed = || {
        update(
            DriverState::Failed,
            Some(ended_run("run-j", "pong", RunState::Infrastructure)),
            Some("couldn't pull the run-container image"),
        )
    };

    accepted(&state, "j", failed()).await;
    let first = job(&state, "j").await;
    assert!(first.retried_by.is_some());
    accepted(&state, "j", failed()).await;

    assert_eq!(job(&state, "j").await, first);
    assert_eq!(jobs(&state).await.len(), 2);
}

/// Report `job_id` succeeded with `artifacts_stored`, returning what its run records.
async fn report_stored(
    state: &AppState,
    job_id: &str,
    artifacts_stored: Option<bool>,
) -> Option<bool> {
    let run_id = format!("run-{job_id}");
    accepted(
        state,
        job_id,
        StatusUpdate {
            artifacts_stored,
            ..update(
                DriverState::Succeeded,
                Some(run_of(&run_id, "pong", GREAT)),
                None,
            )
        },
    )
    .await;
    artifacts_stored_of(state, &run_id).await
}

async fn artifacts_stored_of(state: &AppState, run_id: &str) -> Option<bool> {
    use sea_orm::EntityTrait;
    test_cabinet_entities::run::Entity::find_by_id(run_id.to_string())
        .one(&state.db.connection())
        .await
        .unwrap()
        .unwrap()
        .artifacts_stored
}

#[tokio::test]
async fn artifacts_stored_is_recorded_on_the_run_and_left_alone_when_absent() {
    let (_dir, state) = test_state().await;
    for id in ["stored", "unstored", "absent"] {
        running_job(&state, id).await;
    }

    assert_eq!(
        report_stored(&state, "stored", Some(true)).await,
        Some(true)
    );
    assert_eq!(
        report_stored(&state, "unstored", Some(false)).await,
        Some(false)
    );
    assert_eq!(report_stored(&state, "absent", None).await, None);

    // A repeat that omits the field leaves what the first report recorded.
    assert_eq!(report_stored(&state, "unstored", None).await, Some(false));
}

#[tokio::test]
async fn a_store_fault_is_accepted_beside_a_terminal_report() {
    let (_dir, state) = test_state().await;
    running_job(&state, "j").await;

    accepted(
        &state,
        "j",
        StatusUpdate {
            artifacts_stored: Some(false),
            store_fault: Some("HTTP 507: no space left on device".to_string()),
            ..update(
                DriverState::Succeeded,
                Some(run_of("run-j", "pong", GREAT)),
                None,
            )
        },
    )
    .await;

    assert_eq!(job(&state, "j").await.state, "succeeded");
    assert_eq!(artifacts_stored_of(&state, "run-j").await, Some(false));
}
