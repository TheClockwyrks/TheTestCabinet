//! Automatic publishing, driven through the driver's status endpoint (the trigger
//! every run passes) and through the shared enqueue directly. The ladder trigger is
//! covered beside the other ladder flows, in `ladders.flow.test.rs`.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use sea_orm::ConnectionTrait;
use test_cabinet_core::run_record::RunState;

use super::{AutoPublishCause, auto_publish_runs};
use crate::api::flow_harness::*;
use crate::db::PublishEnqueue;
use crate::db::tests::{links, review_by};

/// Enqueue a job of `slug` and report it finished with `record`, as a hand launch
/// that ran to its end.
async fn launch_and_report(
    state: &crate::api::AppState,
    job_id: &str,
    slug: &str,
    origin: Option<&str>,
    record: test_cabinet_core::run_record::RunRecord,
) {
    enqueue_other(state, job_id, slug, origin).await;
    report(state, job_id, record).await;
}

#[tokio::test]
async fn a_completed_validator_rated_run_enqueues_exactly_one_publish_job() {
    let (_dir, state) = test_state().await;
    launch_and_report(&state, "j", "pong", None, run_of("run-j", "pong", GREAT)).await;

    let queued = publish_jobs(&state).await;
    assert_eq!(queued.len(), 1);
    assert_eq!(queued[0].run_id, "run-j");
    assert_eq!(queued[0].state, "queued");
}

/// A broken build is a completed, validator-rated run like any other: what it
/// scored does not decide whether it publishes.
#[tokio::test]
async fn a_completed_run_publishes_whatever_its_validators_rated_it() {
    let (_dir, state) = test_state().await;
    launch_and_report(&state, "j", "pong", None, run_of("run-j", "pong", BROKEN)).await;

    assert_eq!(publishing(&state).await, ["run-j"]);
}

/// The trigger is the status report, which every launch path shares, so the job's
/// origin makes no difference: a hand launch (which is also what a comparison arm
/// and a gg run are, as neither carries an origin), a plan's fill, and a dispatch.
#[tokio::test]
async fn a_run_publishes_itself_however_it_was_launched() {
    let (_dir, state) = test_state().await;
    for (job_id, origin) in [
        ("hand", None),
        ("plan", Some("plan:p1/f1")),
        ("ladder", Some("ladder:l1/d1/r1")),
    ] {
        launch_and_report(
            &state,
            job_id,
            "pong",
            origin,
            run_of(&format!("run-{job_id}"), "pong", GREAT),
        )
        .await;
        assert_eq!(
            state.db.get_job(job_id).await.unwrap().unwrap().origin,
            origin.map(str::to_string),
            "the job carries the origin it was launched with"
        );
    }

    let mut published = publishing(&state).await;
    published.sort();
    assert_eq!(published, ["run-hand", "run-ladder", "run-plan"]);
}

#[tokio::test]
async fn a_run_that_did_not_complete_is_never_published_automatically() {
    let (_dir, state) = test_state().await;
    for (index, run_state) in RunState::ALL
        .into_iter()
        .filter(|state| *state != RunState::Completed)
        .enumerate()
    {
        let job_id = format!("j{index}");
        launch_and_report(
            &state,
            &job_id,
            "pong",
            None,
            ended_run(&format!("run-{index}"), "pong", run_state),
        )
        .await;
        assert!(
            publish_jobs(&state).await.is_empty(),
            "a {run_state:?} run enqueued a publish job"
        );
    }
}

/// A legacy case's run is rated by its reviewers, so it waits for one and for a
/// person to publish it, review or no review.
#[tokio::test]
async fn a_legacy_run_is_never_published_automatically() {
    let (_dir, state) = test_state().await;
    launch_and_report(
        &state,
        "j",
        "breakout",
        None,
        run_of("run-j", "breakout", GREAT),
    )
    .await;
    assert!(publish_jobs(&state).await.is_empty());

    state
        .db
        .add_review(
            "run-j",
            &review_by("reviewer", test_cabinet_core::review::Rating::Great),
            None,
            None,
        )
        .await
        .unwrap();
    report(&state, "j", run_of("run-j", "breakout", GREAT)).await;
    assert!(publish_jobs(&state).await.is_empty());
}

/// A run stored before its case version was in the definition store is stored
/// unrated. The report that stores it again, once the version is there, rates it
/// and publishes it.
#[tokio::test]
async fn a_run_rated_by_a_later_report_publishes_then() {
    let (_dir, state) = test_state().await;
    launch_and_report(&state, "j", "late", None, run_of("run-j", "late", GREAT)).await;
    assert!(publish_jobs(&state).await.is_empty());

    let mut manifest = crate::db::tests::validator_manifest();
    manifest.slug = "late".to_string();
    state.store.write_manifest(&manifest).unwrap();
    report(&state, "j", run_of("run-j", "late", GREAT)).await;

    assert_eq!(publishing(&state).await, ["run-j"]);
}

#[tokio::test]
async fn a_repeated_report_enqueues_no_second_publish_job() {
    let (_dir, state) = test_state().await;
    launch_and_report(&state, "j", "pong", None, run_of("run-j", "pong", GREAT)).await;
    report(&state, "j", run_of("run-j", "pong", GREAT)).await;
    report(&state, "j", run_of("run-j", "pong", GREAT)).await;

    assert_eq!(publishing(&state).await, ["run-j"]);
}

#[tokio::test]
async fn an_already_published_run_is_not_published_again() {
    let (_dir, state) = test_state().await;
    let manifest = state.store.read_manifest("pong", "v1.0.0").unwrap();
    state
        .db
        .push(
            &run_of("run-j", "pong", GREAT),
            &links(),
            None,
            Some(&manifest),
        )
        .await
        .unwrap();
    state
        .db
        .publish("run-j", "2026-10-01T00:00:00Z")
        .await
        .unwrap();

    let enqueued = auto_publish_runs(
        &state,
        &["run-j".to_string()],
        AutoPublishCause::RunFinished,
    )
    .await;
    assert!(enqueued.is_empty());
    assert!(publish_jobs(&state).await.is_empty());
}

/// One automatic attempt per run: a publish that failed is left for a person, so
/// neither a repeated report nor anything else enqueues it again.
#[tokio::test]
async fn a_failed_publish_is_not_retried_automatically() {
    let (_dir, state) = test_state().await;
    launch_and_report(&state, "j", "pong", None, run_of("run-j", "pong", GREAT)).await;
    let job = publish_jobs(&state).await.remove(0);
    state
        .db
        .set_publish_job_state(&job.id, "failed", "2026-10-02T00:00:00Z", Some("boom"))
        .await
        .unwrap();

    report(&state, "j", run_of("run-j", "pong", GREAT)).await;
    let enqueued =
        auto_publish_runs(&state, &["run-j".to_string()], AutoPublishCause::LadderPass).await;

    assert!(enqueued.is_empty());
    let all = publish_jobs(&state).await;
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].state, "failed");
}

/// Publishing by hand goes through the same enqueue, so it attaches to the job the
/// run enqueued for itself rather than starting a second release.
#[tokio::test]
async fn publishing_by_hand_attaches_to_the_automatic_publish_job() {
    let (_dir, state) = test_state().await;
    launch_and_report(&state, "j", "pong", None, run_of("run-j", "pong", GREAT)).await;
    let automatic = publish_jobs(&state).await.remove(0);

    let response =
        crate::api::runs::publish(State(state.clone()), Path("run-j".to_string()), owner())
            .await
            .unwrap();
    assert_eq!(response.status(), StatusCode::ACCEPTED);

    let all = publish_jobs(&state).await;
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].id, automatic.id);
}

/// Two enqueues of one run racing each other leave one publish job: the one that
/// loses the insert attaches to the winner's.
#[tokio::test]
async fn two_concurrent_enqueues_of_one_run_yield_one_publish_job() {
    let (_dir, state) = test_state().await;
    let manifest = state.store.read_manifest("pong", "v1.0.0").unwrap();
    state
        .db
        .push(
            &run_of("run-j", "pong", GREAT),
            &links(),
            None,
            Some(&manifest),
        )
        .await
        .unwrap();

    let now = "2026-10-02T00:00:00Z";
    let (first, second) = tokio::join!(
        state.db.enqueue_publish_job_once("run-j", now),
        state.db.enqueue_publish_job_once("run-j", now),
    );
    let (first, second) = (first.unwrap(), second.unwrap());

    let all = publish_jobs(&state).await;
    assert_eq!(all.len(), 1);
    assert_eq!(first.job_id(), all[0].id);
    assert_eq!(second.job_id(), all[0].id);
    let enqueued = [&first, &second]
        .into_iter()
        .filter(|outcome| matches!(outcome, PublishEnqueue::Enqueued(_)))
        .count();
    assert_eq!(enqueued, 1, "one call enqueued and the other attached");

    // A third, after the fact, attaches as well.
    let third = state
        .db
        .enqueue_publish_job_once("run-j", now)
        .await
        .unwrap();
    assert_eq!(third, PublishEnqueue::Attached(all[0].id.clone()));
}

/// A publish job that cannot be inserted costs the run its automatic publish and
/// nothing else: the status report is accepted and the job lands as it would.
#[tokio::test]
async fn an_enqueue_failure_does_not_fail_the_status_report() {
    let (_dir, state) = test_state().await;
    state
        .db
        .connection()
        .execute_unprepared(
            "CREATE TRIGGER refuse_publish_jobs BEFORE INSERT ON publish_job \
             BEGIN SELECT RAISE(ABORT, 'publish queue unavailable'); END;",
        )
        .await
        .unwrap();

    // `report` asserts the endpoint answered 204.
    launch_and_report(&state, "j", "pong", None, run_of("run-j", "pong", GREAT)).await;

    assert!(publish_jobs(&state).await.is_empty());
    let job = state.db.get_job("j").await.unwrap().unwrap();
    assert_eq!(job.state, "succeeded");
    assert_eq!(job.record_id.as_deref(), Some("run-j"));
}

/// Nor does a failure to read the candidates at all.
#[tokio::test]
async fn an_unreadable_publish_queue_does_not_fail_the_status_report() {
    let (_dir, state) = test_state().await;
    state
        .db
        .connection()
        .execute_unprepared("DROP TABLE publish_job")
        .await
        .unwrap();

    launch_and_report(&state, "j", "pong", None, run_of("run-j", "pong", GREAT)).await;

    assert_eq!(
        state.db.get_job("j").await.unwrap().unwrap().state,
        "succeeded"
    );
}
