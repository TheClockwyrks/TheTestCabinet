//! The retry pass over a real database: the sweep of abandoned publish jobs, the
//! schedule it enqueues on, the gate it applies again, and the runs it leaves
//! alone.

use axum::extract::{Path, State};
use sea_orm::ConnectionTrait;
use time::format_description::well_known::Rfc3339;
use time::{Duration, OffsetDateTime};

use super::{PassOutcome, failed_publish_pass};
use crate::api::AppState;
use crate::api::flow_harness::*;
use crate::db::PUBLISHER_NEVER_REPORTED;
use test_cabinet_entities::publish_job;

/// The instant every test measures from: now, so the publish jobs automatic
/// publishing enqueues (at the real clock) are older than everything the test
/// writes after them.
fn base() -> OffsetDateTime {
    OffsetDateTime::now_utc()
}

fn text(at: OffsetDateTime) -> String {
    at.format(&Rfc3339).unwrap()
}

/// A completed, validator-rated run `run_id` (job `job_id`) that published itself,
/// returning the publish job automatic publishing enqueued for it.
async fn published_automatically(
    state: &AppState,
    job_id: &str,
    run_id: &str,
) -> publish_job::Model {
    enqueue_other(state, job_id, "pong", None).await;
    report(state, job_id, run_of(run_id, "pong", GREAT)).await;
    let jobs = run_publish_jobs(state, run_id).await;
    assert_eq!(jobs.len(), 1, "the run published itself");
    jobs.into_iter().next().unwrap()
}

/// Record publish job `id` failed at `at`, as a publisher's failed report does.
async fn fail(state: &AppState, id: &str, at: OffsetDateTime) {
    state
        .db
        .set_publish_job_state(id, "failed", &text(at), Some("boom"))
        .await
        .unwrap()
        .expect("the publish job exists");
}

/// `run_id`'s publish jobs, oldest first.
async fn run_publish_jobs(state: &AppState, run_id: &str) -> Vec<publish_job::Model> {
    publish_jobs(state)
        .await
        .into_iter()
        .filter(|job| job.run_id == run_id)
        .collect()
}

/// A run whose one publish job failed at `failed_at`.
async fn failed_once(state: &AppState, failed_at: OffsetDateTime) -> publish_job::Model {
    let job = published_automatically(state, "j", "run-j").await;
    fail(state, &job.id, failed_at).await;
    job
}

fn retried(run_ids: &[&str]) -> PassOutcome {
    PassOutcome {
        retried: run_ids.iter().map(|id| id.to_string()).collect(),
        ..PassOutcome::default()
    }
}

#[tokio::test]
async fn a_failed_publish_is_retried_five_minutes_after_it_failed() {
    let (_dir, state) = test_state().await;
    let t = base();
    failed_once(&state, t).await;

    for at in [t, t + Duration::minutes(5) - Duration::seconds(1)] {
        assert_eq!(
            failed_publish_pass(&state, at).await,
            PassOutcome::default()
        );
    }
    assert_eq!(run_publish_jobs(&state, "run-j").await.len(), 1);

    let due = t + Duration::minutes(5);
    assert_eq!(failed_publish_pass(&state, due).await, retried(&["run-j"]));
    let jobs = run_publish_jobs(&state, "run-j").await;
    assert_eq!(jobs.len(), 2);
    assert_eq!(jobs[1].state, "queued");
    assert_eq!(jobs[1].created_at, text(due));

    // The retry is in flight, so a later pass adds nothing.
    let later = due + Duration::hours(1);
    assert_eq!(
        failed_publish_pass(&state, later).await,
        PassOutcome::default()
    );
    assert_eq!(run_publish_jobs(&state, "run-j").await.len(), 2);
}

#[tokio::test]
async fn each_consecutive_failure_doubles_the_wait() {
    let (_dir, state) = test_state().await;
    let t = base();
    failed_once(&state, t).await;

    // Fail each retry the moment it is enqueued: the n-th failure waits
    // 5 * 2^(n-1) minutes, at most four hours.
    let mut failed_at = t;
    for (n, wait_minutes) in [(1, 5), (2, 10), (3, 20), (4, 40), (5, 80)] {
        let due = failed_at + Duration::minutes(wait_minutes);
        assert_eq!(
            failed_publish_pass(&state, due - Duration::seconds(1)).await,
            PassOutcome::default(),
            "not due before the wait after failure {n}"
        );
        assert_eq!(
            failed_publish_pass(&state, due).await,
            retried(&["run-j"]),
            "due once the wait after failure {n} has passed"
        );
        let latest = run_publish_jobs(&state, "run-j").await.pop().unwrap();
        failed_at = due + Duration::minutes(1);
        fail(&state, &latest.id, failed_at).await;
    }
}

#[tokio::test]
async fn the_retries_end_a_day_after_the_first_failed_publish() {
    let (_dir, state) = test_state().await;
    let t = base();
    let first = failed_once(&state, t).await;

    // A retry that failed shortly before the day ran out.
    assert_eq!(
        failed_publish_pass(&state, t + Duration::minutes(5)).await,
        retried(&["run-j"])
    );
    let second = run_publish_jobs(&state, "run-j").await.pop().unwrap();
    assert_ne!(second.id, first.id);
    fail(
        &state,
        &second.id,
        t + Duration::hours(23) + Duration::minutes(55),
    )
    .await;

    // Its ten-minute wait ends past the day: no further retry, then or ever.
    for at in [
        t + Duration::hours(24) - Duration::seconds(1),
        t + Duration::hours(24) + Duration::minutes(5),
        t + Duration::hours(48),
    ] {
        assert_eq!(
            failed_publish_pass(&state, at).await,
            PassOutcome::default()
        );
    }
    assert_eq!(run_publish_jobs(&state, "run-j").await.len(), 2);
}

/// An operator's publish is accepted at any time, and its job's failure counts as
/// one more consecutive failure of the run.
#[tokio::test]
async fn an_operators_failed_publish_counts_as_a_consecutive_failure() {
    let (_dir, state) = test_state().await;
    let t = base();
    failed_once(&state, t).await;

    // Before the run's own retry falls due, an operator publishes it by hand.
    crate::api::runs::publish(State(state.clone()), Path("run-j".to_string()), owner())
        .await
        .unwrap();
    let operator = run_publish_jobs(&state, "run-j").await.pop().unwrap();
    assert_eq!(operator.state, "queued");
    // In flight: the pass leaves the run alone.
    assert_eq!(
        failed_publish_pass(&state, t + Duration::minutes(5)).await,
        PassOutcome::default()
    );
    let operator_failed = t + Duration::minutes(6);
    fail(&state, &operator.id, operator_failed).await;

    // Two consecutive failures: ten minutes after the operator's.
    let due = operator_failed + Duration::minutes(10);
    assert_eq!(
        failed_publish_pass(&state, due - Duration::seconds(1)).await,
        PassOutcome::default()
    );
    assert_eq!(failed_publish_pass(&state, due).await, retried(&["run-j"]));
}

/// The gate is applied again before each retry: a run that stopped being
/// publishable after its publish failed is left unpublished.
#[tokio::test]
async fn a_run_no_longer_publishable_is_not_retried() {
    for run_state in ["infrastructure", "canceled"] {
        let (_dir, state) = test_state().await;
        let t = base();
        failed_once(&state, t).await;
        state
            .db
            .connection()
            .execute_unprepared(&format!(
                "UPDATE run SET run_state = '{run_state}' WHERE id = 'run-j'"
            ))
            .await
            .unwrap();

        let outcome = failed_publish_pass(&state, t + Duration::minutes(5)).await;
        assert_eq!(
            outcome,
            PassOutcome {
                refused: vec!["run-j".to_string()],
                ..PassOutcome::default()
            },
            "{run_state}"
        );
        assert_eq!(
            run_publish_jobs(&state, "run-j").await.len(),
            1,
            "{run_state}"
        );
    }
}

#[tokio::test]
async fn a_run_with_a_publish_job_in_flight_is_not_retried() {
    for in_flight in ["queued", "dispatched"] {
        let (_dir, state) = test_state().await;
        let t = base();
        failed_once(&state, t).await;
        let live = state
            .db
            .enqueue_publish_job_once("run-j", &text(t + Duration::minutes(1)))
            .await
            .unwrap();
        if in_flight == "dispatched" {
            let claimed = state
                .db
                .claim_next_publish_job(&text(t + Duration::minutes(2)))
                .await
                .unwrap()
                .unwrap();
            assert_eq!(claimed.id, live.job_id());
        }

        let outcome = failed_publish_pass(&state, t + Duration::minutes(10)).await;
        assert_eq!(outcome, PassOutcome::default(), "{in_flight}");
        let jobs = run_publish_jobs(&state, "run-j").await;
        assert_eq!(jobs.len(), 2, "{in_flight}");
        assert_eq!(jobs[1].state, in_flight);
    }
}

#[tokio::test]
async fn a_published_run_is_not_retried() {
    let (_dir, state) = test_state().await;
    let t = base();
    failed_once(&state, t).await;
    state.db.publish("run-j", &text(t)).await.unwrap();

    assert_eq!(
        failed_publish_pass(&state, t + Duration::minutes(5)).await,
        PassOutcome::default()
    );
    assert_eq!(run_publish_jobs(&state, "run-j").await.len(), 1);
}

/// A run an automatic retry of its launch replaced counts as no run, so its failed
/// publish is not retried either.
#[tokio::test]
async fn a_retried_attempt_is_not_retried() {
    let (_dir, state) = test_state().await;
    let t = base();
    failed_once(&state, t).await;
    let job = state.db.get_job("j").await.unwrap().unwrap();
    assert_eq!(job.record_id.as_deref(), Some("run-j"));
    state
        .db
        .connection()
        .execute_unprepared("UPDATE job SET retried_by = 'j-retry' WHERE id = 'j'")
        .await
        .unwrap();

    assert_eq!(
        failed_publish_pass(&state, t + Duration::minutes(5)).await,
        PassOutcome::default()
    );
    assert_eq!(run_publish_jobs(&state, "run-j").await.len(), 1);
}

/// A publish job whose publisher never reported is recorded failed an hour after
/// its dispatch, notified like any failure, and retried five minutes after that.
#[tokio::test]
async fn an_abandoned_publish_job_is_swept_then_retried() {
    let (_dir, state) = test_state().await;
    let t = base();
    let job = published_automatically(&state, "j", "run-j").await;
    let dispatched_at = t + Duration::minutes(1);
    let claimed = state
        .db
        .claim_next_publish_job(&text(dispatched_at))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(claimed.id, job.id);
    let mut feed = state.relay.notifier().open_stream();

    let hour = dispatched_at + Duration::hours(1);
    assert_eq!(
        failed_publish_pass(&state, hour - Duration::seconds(1)).await,
        PassOutcome::default()
    );
    // The pass runs a little after the hour; the failure is recorded at the hour.
    let swept_at = hour + Duration::seconds(20);
    assert_eq!(
        failed_publish_pass(&state, swept_at).await,
        PassOutcome {
            abandoned: vec![job.id.clone()],
            ..PassOutcome::default()
        }
    );
    let swept = state.db.get_publish_job(&job.id).await.unwrap().unwrap();
    assert_eq!(swept.state, "failed");
    assert_eq!(swept.detail.as_deref(), Some(PUBLISHER_NEVER_REPORTED));
    assert_eq!(
        OffsetDateTime::parse(&swept.updated_at, &Rfc3339).unwrap(),
        hour
    );

    let crate::relay::StreamMessage::Notification(notification) = feed.receiver.try_recv().unwrap()
    else {
        panic!("a notification is raised");
    };
    let notification = serde_json::to_value(&notification).unwrap();
    assert_eq!(notification["kind"], "publish-failed", "{notification}");
    assert_eq!(
        notification["message"], PUBLISHER_NEVER_REPORTED,
        "{notification}"
    );
    let live = state.publish_relay.live(&job.id).subscribe();
    assert!(live.terminated, "the live stream is closed");
    let Some(crate::publish_relay::PublishStreamItem::Result(result)) = live.backlog.last() else {
        panic!("the live stream ends in a result: {:?}", live.backlog.len());
    };
    assert_eq!(
        result.state,
        test_cabinet_contracts::publish_job_api::PublishState::Failed
    );
    assert_eq!(result.detail.as_deref(), Some(PUBLISHER_NEVER_REPORTED));

    let due = hour + Duration::minutes(5);
    assert_eq!(
        failed_publish_pass(&state, due - Duration::seconds(1)).await,
        PassOutcome::default()
    );
    assert_eq!(failed_publish_pass(&state, due).await, retried(&["run-j"]));
    let jobs = run_publish_jobs(&state, "run-j").await;
    assert_eq!(jobs.len(), 2);
    assert_eq!(jobs[1].state, "queued");
}

/// Several runs are retried in one pass, each on its own schedule.
#[tokio::test]
async fn each_run_is_retried_on_its_own_schedule() {
    let (_dir, state) = test_state().await;
    let t = base();
    let early = published_automatically(&state, "a", "run-a").await;
    let late = published_automatically(&state, "b", "run-b").await;
    fail(&state, &early.id, t).await;
    fail(&state, &late.id, t + Duration::minutes(3)).await;

    assert_eq!(
        failed_publish_pass(&state, t + Duration::minutes(5)).await,
        retried(&["run-a"])
    );
    assert_eq!(
        failed_publish_pass(&state, t + Duration::minutes(8)).await,
        retried(&["run-b"])
    );
}
