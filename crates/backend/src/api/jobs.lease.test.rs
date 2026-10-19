//! Claim leases over the routes the dispatcher and a driver use: the lease a claim
//! stores and `GET /jobs/active` reports, the renewal (`POST /jobs/leases`), and a
//! lapsed claim's return to the queue, after which the old per-job token is refused.

use axum::Json;
use axum::body::to_bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use sea_orm::{ActiveModelTrait, IntoActiveModel, Set};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use super::*;
use crate::api::flow_harness::test_state;

/// Enqueue a `pong` run on Claude as `job_id`, carrying a launch request a claim can
/// hand over.
async fn enqueue(state: &AppState, job_id: &str) {
    state
        .db
        .enqueue_job(crate::db::NewJob {
            request_json: r#"{"testCase":"pong","version":"v1.0.0","variant":"base","harness":"claude","model":"m"}"#
                .to_string(),
            ..crate::db::tests::new_job(job_id, "2026-10-01T00:00:00Z")
        })
        .await
        .unwrap();
}

/// Claim through `POST /jobs/next` as the dispatcher does, and return what it handed
/// over, or `None` when it answered `204`.
async fn claim_next(state: &AppState) -> Option<ClaimedJob> {
    let response = claim(State(state.clone()), ServiceAuth).await.unwrap();
    if response.status() == StatusCode::NO_CONTENT {
        return None;
    }
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    Some(serde_json::from_slice(&body).unwrap())
}

/// Post a `starting` report for `job_id` with `token`, as a driver does first.
async fn report_starting(
    state: &AppState,
    job_id: &str,
    token: &str,
) -> Result<StatusCode, ApiError> {
    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::AUTHORIZATION,
        format!("Bearer {token}").parse().unwrap(),
    );
    Box::pin(update_status(
        State(state.clone()),
        Path(job_id.to_string()),
        headers,
        Json(StatusUpdate {
            state: DriverState::Starting,
            record: None,
            detail: None,
            artifacts_stored: None,
            store_fault: None,
        }),
    ))
    .await
}

/// Write `lease` straight onto `job_id`'s row: how a test lapses a lease without
/// waiting for it.
async fn set_lease(state: &AppState, job_id: &str, lease: Option<&str>) {
    let mut row = state
        .db
        .get_job(job_id)
        .await
        .unwrap()
        .unwrap()
        .into_active_model();
    row.lease_expires_at = Set(lease.map(str::to_string));
    row.update(&state.db.connection()).await.unwrap();
}

/// The lease `GET /jobs/active` reports for `job_id`.
async fn active_lease(state: &AppState, job_id: &str) -> Option<String> {
    let Json(rows) = active(State(state.clone())).await.unwrap();
    rows.into_iter()
        .find(|row| row.run_id == job_id)
        .expect("the job is active")
        .lease_expires_at
}

/// Seconds from now until the RFC 3339 instant `at`.
fn seconds_until(at: &str) -> i64 {
    (OffsetDateTime::parse(at, &Rfc3339).unwrap() - OffsetDateTime::now_utc()).whole_seconds()
}

#[tokio::test]
async fn a_claim_leases_the_job_for_two_minutes_and_active_reports_it() {
    let (_dir, state) = test_state().await;
    enqueue(&state, "j1").await;
    enqueue(&state, "j2").await;
    assert_eq!(active_lease(&state, "j1").await, None);

    let claimed = claim_next(&state).await.unwrap();
    assert_eq!(claimed.job_id, "j1");
    let lease = active_lease(&state, "j1")
        .await
        .expect("a claimed job is leased");
    let left = seconds_until(&lease);
    assert!((110..=120).contains(&left), "{left}s left on {lease}");
    // A waiting job holds no lease.
    assert_eq!(active_lease(&state, "j2").await, None);
}

#[tokio::test]
async fn a_lapsed_claims_old_token_is_refused_and_its_new_one_accepted() {
    let (_dir, state) = test_state().await;
    enqueue(&state, "j1").await;
    enqueue(&state, "j2").await;
    let first = claim_next(&state).await.unwrap();
    assert_eq!(first.job_id, "j1");
    // The dispatcher's `Job` creation failed and nothing renewed the lease.
    set_lease(&state, "j1", Some("2000-01-01T00:00:00Z")).await;

    let again = claim_next(&state).await.unwrap();
    assert_eq!(again.job_id, "j1", "taken again ahead of j2");
    assert_ne!(again.job_token, first.job_token);
    let row = state.db.get_job("j1").await.unwrap().unwrap();
    assert_eq!(row.attempt, 0);
    assert_eq!(row.retried_by, None);
    assert_eq!(jobs_in_queue(&state).await, 2, "no retry was enqueued");

    // A driver created for the first claim presents a token the backend no longer
    // accepts.
    let refused = report_starting(&state, "j1", &first.job_token)
        .await
        .unwrap_err();
    assert_eq!(refused.status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        state.db.get_job("j1").await.unwrap().unwrap().state,
        "dispatched"
    );
    assert_eq!(
        report_starting(&state, "j1", &again.job_token)
            .await
            .unwrap(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        state.db.get_job("j1").await.unwrap().unwrap().state,
        "starting"
    );
}

/// How many job rows exist.
async fn jobs_in_queue(state: &AppState) -> usize {
    crate::api::flow_harness::jobs(state).await.len()
}

#[tokio::test]
async fn a_lapsed_claim_is_announced_back_in_the_queue() {
    let (_dir, state) = test_state().await;
    enqueue(&state, "j1").await;
    claim_next(&state).await.unwrap();
    set_lease(&state, "j1", None).await;
    // Hold the harness back so the returned job is not claimed again at once.
    state
        .db
        .set_harness_max_parallelism("claude", Some(0), "2026-10-19T00:00:00Z")
        .await
        .unwrap();
    let mut stream = state.relay.notifier().open_stream();

    assert!(claim_next(&state).await.is_none());
    let StreamMessage::Run(event) = stream.receiver.try_recv().unwrap() else {
        panic!("a run event is announced");
    };
    let event = serde_json::to_value(&event).unwrap();
    assert_eq!(event["runId"], "j1", "{event}");
    assert_eq!(event["state"], "pending", "{event}");
}

#[tokio::test]
async fn a_renewal_extends_the_driven_jobs_and_ignores_the_rest() {
    let (_dir, state) = test_state().await;
    enqueue(&state, "j1").await;
    enqueue(&state, "j2").await;
    claim_next(&state).await.unwrap();
    set_lease(&state, "j1", Some("2000-01-01T00:00:00Z")).await;

    let status = renew_leases(
        State(state.clone()),
        ServiceAuth,
        Json(LeaseRenewal {
            job_ids: vec!["j1".into(), "j2".into(), "unknown".into()],
        }),
    )
    .await
    .unwrap();
    assert_eq!(status, StatusCode::NO_CONTENT);

    let lease = active_lease(&state, "j1").await.unwrap();
    let left = seconds_until(&lease);
    assert!((110..=120).contains(&left), "{left}s left on {lease}");
    assert_eq!(
        active_lease(&state, "j2").await,
        None,
        "a queued job holds none"
    );

    // Renewed in time, the claim stands: the next claim takes j2, not j1 again.
    assert_eq!(claim_next(&state).await.unwrap().job_id, "j2");
}
