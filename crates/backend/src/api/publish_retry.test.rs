//! Tests for the retry of failed publishes and the hold publish failures put on
//! new runs, against the real database and the real run claim.
//!
//! The database's pool waits on a worker thread, so these cannot run on a paused
//! clock (see `jobs.capacity.test.rs`). They do not need one: a pass is handed its
//! instant, and every publish job's instants are written here, so no test reads
//! the time of day. The schedule's boundaries are tested as pure functions in
//! `publish_health.test.rs`.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, header};
use time::format_description::well_known::Rfc3339;
use time::macros::datetime;
use time::{Duration, OffsetDateTime};

use super::{PassOutcome, failed_publish_pass, refresh_publish_hold};
use crate::api::flow_harness::*;
use crate::api::publish_gate::{GatedEnqueue, enqueue_publish};
use crate::api::publish_jobs::{PublishResult, PublishState, report_result};
use crate::api::{AppState, HoldReason};
use crate::artifacts::presence_tests::{STUB_TOKEN, spawn_artifact_stub, unreachable_base};
use crate::auth::ServiceAuth;
use crate::db::retention_tests::seed_publish_job;
use crate::db::tests::new_job;
use crate::db::{PUBLISHER_NEVER_REPORTED, PublishEnqueue};

/// The instant every test counts its minutes from.
const T0: OffsetDateTime = datetime!(2026-10-01 00:00:00 UTC);

fn at(minutes: i64) -> OffsetDateTime {
    T0 + Duration::minutes(minutes)
}

fn stamp(minutes: i64) -> String {
    at(minutes).format(&Rfc3339).unwrap()
}

/// Store a completed validator-rated run with no status report behind it, so
/// nothing has tried to publish it yet.
async fn stored_run(state: &AppState, name: &str) -> String {
    let run_id = format!("run-{name}");
    let job_id = format!("job-{name}");
    enqueue_other(state, &job_id, "pong", None).await;
    finish(state, &job_id, run_of(&run_id, "pong", GREAT)).await;
    run_id
}

/// Record a publish job of `run_id` that failed `minutes` after [`T0`].
async fn failed_job(state: &AppState, id: &str, run_id: &str, minutes: i64) {
    seed_publish_job(&state.db, id, run_id, "failed", &stamp(minutes)).await;
    state
        .db
        .set_publish_job_state(
            id,
            "failed",
            &stamp(minutes),
            Some(&format!("error of {id}")),
        )
        .await
        .unwrap();
}

/// Store `count` runs, `a` onwards, each with one publish job that failed: the
/// first at minute 0, the next a minute later, and so on.
async fn failing_runs(state: &AppState, count: usize) -> Vec<String> {
    let mut runs = Vec::new();
    for (index, name) in ["a", "b", "c", "d", "e", "f"]
        .iter()
        .take(count)
        .enumerate()
    {
        let run_id = stored_run(state, name).await;
        failed_job(state, &format!("p-{name}"), &run_id, index as i64).await;
        runs.push(run_id);
    }
    runs
}

/// The publish jobs of `run_id`, oldest first, as their states.
async fn job_states(state: &AppState, run_id: &str) -> Vec<String> {
    publish_jobs(state)
        .await
        .into_iter()
        .filter(|job| job.run_id == run_id)
        .map(|job| job.state)
        .collect()
}

/// The one queued publish job, which a test then ends.
async fn queued_job(state: &AppState) -> test_cabinet_entities::publish_job::Model {
    let mut queued: Vec<_> = publish_jobs(state)
        .await
        .into_iter()
        .filter(|job| job.state == "queued")
        .collect();
    assert_eq!(queued.len(), 1, "exactly one publish job is queued");
    queued.remove(0)
}

/// End the one queued publish job as failed `minutes` after [`T0`].
async fn fail_queued(state: &AppState, minutes: i64) {
    let job = queued_job(state).await;
    state
        .db
        .set_publish_job_state(&job.id, "failed", &stamp(minutes), Some("still failing"))
        .await
        .unwrap();
}

/// Report `result` for publish job `id` as its publisher would.
async fn report(state: &AppState, id: &str, token: &str, result: PublishResult) {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::AUTHORIZATION,
        format!("Bearer {token}").parse().unwrap(),
    );
    let status = report_result(
        State(state.clone()),
        Path(id.to_string()),
        headers,
        Json(result),
    )
    .await
    .unwrap();
    assert_eq!(status, StatusCode::NO_CONTENT);
}

fn succeeded() -> PublishResult {
    PublishResult {
        state: PublishState::Succeeded,
        source_repo: Some("https://github.com/x/y".to_string()),
        playable_build: None,
        detail: None,
    }
}

fn failed(detail: &str) -> PublishResult {
    PublishResult {
        state: PublishState::Failed,
        source_repo: None,
        playable_build: None,
        detail: Some(detail.to_string()),
    }
}

/// Queue a run the claim can hand to a driver.
async fn queue_run(state: &AppState, id: &str) {
    state
        .db
        .enqueue_job(crate::db::NewJob {
            request_json: r#"{"testCase":"pong","version":"v1.0.0","variant":"base","harness":"claude","model":"m"}"#
                .to_string(),
            ..new_job(id, "2026-10-01T00:00:00Z")
        })
        .await
        .unwrap();
}

/// Claim once as the dispatcher does, returning the claimed job's id.
async fn claim_run(state: &AppState) -> Option<String> {
    let response = crate::api::jobs::claim(State(state.clone()), ServiceAuth)
        .await
        .unwrap();
    if response.status() == StatusCode::NO_CONTENT {
        return None;
    }
    let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    Some(body["jobId"].as_str().unwrap().to_string())
}

/// Claim a publish job as the dispatcher's publish lane does.
async fn claim_publish(state: &AppState) -> bool {
    let response = crate::api::publish_jobs::claim(State(state.clone()), ServiceAuth)
        .await
        .unwrap();
    response.status() == StatusCode::OK
}

async fn job_state(state: &AppState, id: &str) -> String {
    state.db.get_job(id).await.unwrap().unwrap().state
}

// --- One run's retries ------------------------------------------------------

#[tokio::test]
async fn a_failed_publish_is_retried_five_minutes_later_and_not_before() {
    let (_dir, state) = test_state().await;
    let runs = failing_runs(&state, 1).await;

    let early = failed_publish_pass(&state, at(4)).await;
    assert_eq!(early, PassOutcome::default());
    assert_eq!(job_states(&state, &runs[0]).await, ["failed"]);

    let due = failed_publish_pass(&state, at(5)).await;
    assert_eq!(due.retried, runs);
    assert_eq!(due.probed, None);
    assert_eq!(job_states(&state, &runs[0]).await, ["failed", "queued"]);
}

#[tokio::test]
async fn a_run_never_has_two_publish_jobs_in_flight() {
    let (_dir, state) = test_state().await;
    let runs = failing_runs(&state, 1).await;
    failed_publish_pass(&state, at(5)).await;

    // The retry is queued, then dispatched, for a long while.
    for minutes in [6, 30, 55] {
        let again = failed_publish_pass(&state, at(minutes)).await;
        assert_eq!(again, PassOutcome::default());
    }
    assert!(claim_publish(&state).await);
    let again = failed_publish_pass(&state, at(6)).await;
    assert_eq!(again, PassOutcome::default());
    assert_eq!(job_states(&state, &runs[0]).await, ["failed", "dispatched"]);
}

#[tokio::test]
async fn the_wait_doubles_with_each_consecutive_failure() {
    let (_dir, state) = test_state().await;
    let runs = failing_runs(&state, 1).await;

    // Retried at minute 5, failing at once; then 10 minutes, then 20.
    let mut failed_at = 0;
    for wait in [5, 10, 20, 40] {
        let before = failed_publish_pass(&state, at(failed_at + wait - 1)).await;
        assert!(before.retried.is_empty(), "not before {wait} minutes");
        let due = failed_publish_pass(&state, at(failed_at + wait)).await;
        assert_eq!(due.retried, runs, "after {wait} minutes");
        failed_at += wait;
        fail_queued(&state, failed_at).await;
    }
    assert_eq!(job_states(&state, &runs[0]).await.len(), 5);
}

#[tokio::test]
async fn retries_stop_a_day_after_the_first_failure() {
    let (_dir, state) = test_state().await;
    let runs = failing_runs(&state, 1).await;
    let day = 24 * 60;

    assert_eq!(
        failed_publish_pass(&state, at(day - 1)).await.retried,
        runs,
        "a minute inside the day the run is still retried"
    );
    fail_queued(&state, day - 1).await;

    // Ten minutes after its second failure the wait has passed. The day has too.
    for minutes in [day + 9, day + 600, 30 * day] {
        let late = failed_publish_pass(&state, at(minutes)).await;
        assert_eq!(late, PassOutcome::default());
    }
    assert_eq!(job_states(&state, &runs[0]).await, ["failed", "failed"]);
}

#[tokio::test]
async fn a_person_can_publish_at_any_time() {
    let (_dir, state) = test_state().await;
    let runs = failing_runs(&state, 2).await;

    // The first run a minute after it failed, well inside its wait.
    let waiting = enqueue_publish(&state, &runs[0], &stamp(1)).await.unwrap();
    assert!(matches!(
        waiting,
        GatedEnqueue::Enqueued(PublishEnqueue::Enqueued(_))
    ));
    // The second a month later, long past its day.
    let spent = enqueue_publish(&state, &runs[1], &stamp(30 * 24 * 60))
        .await
        .unwrap();
    assert!(matches!(
        spent,
        GatedEnqueue::Enqueued(PublishEnqueue::Enqueued(_))
    ));
    // And the pass adds nothing beside either.
    let pass = failed_publish_pass(&state, at(30 * 24 * 60)).await;
    assert_eq!(pass, PassOutcome::default());
}

#[tokio::test]
async fn a_persons_failed_publish_counts_as_the_runs_next_failure() {
    let (_dir, state) = test_state().await;
    let runs = failing_runs(&state, 1).await;
    enqueue_publish(&state, &runs[0], &stamp(1)).await.unwrap();
    fail_queued(&state, 2).await;

    // Two failures: ten minutes from the second.
    assert!(failed_publish_pass(&state, at(11)).await.retried.is_empty());
    assert_eq!(failed_publish_pass(&state, at(12)).await.retried, runs);
}

#[tokio::test]
async fn a_run_with_no_stored_tree_is_not_retried() {
    let (_dir, mut state) = test_state().await;
    let runs = failing_runs(&state, 2).await;
    // The artifact service holds the second run's tree only.
    let (base, stub) = spawn_artifact_stub(&[&runs[1]]).await;
    with_artifact_service(&mut state, &base, STUB_TOKEN);

    let pass = failed_publish_pass(&state, at(10)).await;

    assert_eq!(pass.retried, std::slice::from_ref(&runs[1]));
    assert_eq!(job_states(&state, &runs[0]).await, ["failed"], "no job");
    assert_eq!(stub.asked(), runs, "both were asked about");

    // The gate recorded the answer, so the run is not asked about again.
    let later = failed_publish_pass(&state, at(60)).await;
    assert_eq!(later, PassOutcome::default());
    assert_eq!(stub.asked(), runs);
}

#[tokio::test]
async fn an_artifact_service_that_does_not_answer_ends_the_pass() {
    let (_dir, mut state) = test_state().await;
    let runs = failing_runs(&state, 3).await;
    with_artifact_service(&mut state, &unreachable_base().await, STUB_TOKEN);

    let pass = failed_publish_pass(&state, at(10)).await;

    assert_eq!(pass, PassOutcome::default());
    for run in &runs {
        assert_eq!(job_states(&state, run).await, ["failed"]);
        assert_eq!(
            state.db.run_artifacts_stored(run).await.unwrap(),
            None,
            "an unanswered question records nothing about the tree"
        );
    }
}

#[tokio::test]
async fn a_published_run_is_left_alone() {
    let (_dir, state) = test_state().await;
    let runs = failing_runs(&state, 1).await;
    enqueue_publish(&state, &runs[0], &stamp(1)).await.unwrap();
    let job = queued_job(&state).await;
    report(&state, &job.id, &job.job_token, succeeded()).await;

    let pass = failed_publish_pass(&state, at(600)).await;

    assert_eq!(pass, PassOutcome::default());
    assert_eq!(job_states(&state, &runs[0]).await, ["failed", "succeeded"]);
}

// --- A publisher that never reported -----------------------------------------

#[tokio::test]
async fn a_publish_job_whose_publisher_never_reported_fails_and_is_retried() {
    let (_dir, state) = test_state().await;
    let run_id = stored_run(&state, "a").await;
    seed_publish_job(&state.db, "p", &run_id, "dispatched", &stamp(0)).await;
    let mut stream = state.relay.notifier().open_stream();

    // An hour on it is still the run's publish.
    assert_eq!(
        failed_publish_pass(&state, at(60)).await,
        PassOutcome::default()
    );

    let pass = failed_publish_pass(&state, at(61)).await;
    assert_eq!(pass.abandoned, ["p"]);
    assert!(pass.retried.is_empty(), "the failure is a minute old");
    let job = state.db.get_publish_job("p").await.unwrap().unwrap();
    assert_eq!(job.state, "failed");
    assert_eq!(job.detail.as_deref(), Some(PUBLISHER_NEVER_REPORTED));
    let mut notified = false;
    while let Ok(message) = stream.receiver.try_recv() {
        notified |= matches!(message, crate::relay::StreamMessage::Notification(_));
    }
    assert!(notified, "the failure is announced like a reported one");

    let retry = failed_publish_pass(&state, at(66)).await;
    assert_eq!(retry.retried, std::slice::from_ref(&run_id));
    assert_eq!(job_states(&state, &run_id).await, ["failed", "queued"]);
}

#[tokio::test]
async fn publishers_that_died_before_a_publish_succeeded_do_not_hold_new_runs() {
    // What a first start beside an old database finds: publish jobs left
    // `dispatched` by publishers long dead, and a publish that has succeeded since.
    let (_dir, state) = test_state().await;
    queue_run(&state, "next").await;
    for name in ["a", "b", "c", "d", "e"] {
        let run_id = stored_run(&state, name).await;
        seed_publish_job(
            &state.db,
            &format!("p-{name}"),
            &run_id,
            "dispatched",
            &stamp(0),
        )
        .await;
    }
    let published = stored_run(&state, "f").await;
    seed_publish_job(&state.db, "p-f", &published, "dispatched", &stamp(120)).await;
    let job = state.db.get_publish_job("p-f").await.unwrap().unwrap();
    report(&state, "p-f", &job.job_token, succeeded()).await;

    // Three days on, the first pass ends the five abandoned jobs.
    let pass = failed_publish_pass(&state, at(3 * 24 * 60)).await;

    assert_eq!(pass.abandoned.len(), 5);
    assert!(pass.retried.is_empty(), "their runs are past their retries");
    assert_eq!(pass.probed, None);
    assert!(!state.capacity.runs_on_hold());
    assert_eq!(claim_run(&state).await.as_deref(), Some("next"));
}

#[tokio::test]
async fn a_late_failure_for_a_job_already_recorded_as_failed_changes_nothing() {
    let (_dir, state) = test_state().await;
    let run_id = stored_run(&state, "a").await;
    seed_publish_job(&state.db, "p", &run_id, "dispatched", &stamp(0)).await;
    assert_eq!(failed_publish_pass(&state, at(61)).await.abandoned, ["p"]);
    let recorded = state.db.get_publish_job("p").await.unwrap().unwrap();

    // The publisher was only slow, and now reports its own failure.
    report(&state, "p", &recorded.job_token, failed("gh: HTTP 502")).await;

    assert_eq!(
        state.db.get_publish_job("p").await.unwrap().unwrap(),
        recorded,
        "neither the instant the schedule runs from nor the reason is rewritten"
    );
}

// --- The hold ---------------------------------------------------------------

#[tokio::test]
async fn five_runs_failing_in_a_row_hold_new_runs_and_nothing_else() {
    let (_dir, state) = test_state().await;
    queue_run(&state, "next").await;
    failing_runs(&state, 4).await;
    refresh_publish_hold(&state).await.unwrap();
    assert!(!state.capacity.runs_on_hold(), "four runs are one short");

    let run_id = stored_run(&state, "e").await;
    seed_publish_job(&state.db, "p-e", &run_id, "dispatched", &stamp(4)).await;
    report(&state, "p-e", "ptoken-p-e", failed("gh: HTTP 502")).await;

    // The fifth run's failed result is what begins the hold, as it is accepted.
    let status = state.capacity.status();
    assert!(status.runs_on_hold);
    assert_eq!(status.hold_reason, Some(HoldReason::PublishFailing));
    assert_eq!(status.detail.as_deref(), Some("gh: HTTP 502"));
    assert_eq!(status.publish_failing_runs, Some(5));

    // No run is handed out, and the queued one waits rather than fails.
    assert_eq!(claim_run(&state).await, None);
    assert_eq!(claim_run(&state).await, None);
    assert_eq!(job_state(&state, "next").await, "pending");

    // The publish lane is claimed as ever.
    let pass = failed_publish_pass(&state, at(5)).await;
    assert_eq!(pass.retried.len(), 1, "the first run's retry is due");
    assert!(claim_publish(&state).await);
}

#[tokio::test]
async fn the_claim_reads_the_hold_from_the_table_not_from_memory() {
    let (_dir, mut state) = test_state().await;
    queue_run(&state, "next").await;
    failing_runs(&state, 5).await;

    // A backend that has just started: its monitor has been told nothing.
    state.capacity = crate::capacity::CapacityMonitor::unmonitored(state.config.artifact_capacity);
    assert!(!state.capacity.runs_on_hold());

    assert_eq!(claim_run(&state).await, None);
    assert!(state.capacity.runs_on_hold());
}

#[tokio::test]
async fn one_run_failing_over_and_over_holds_nothing() {
    let (_dir, state) = test_state().await;
    queue_run(&state, "next").await;
    let run_id = stored_run(&state, "a").await;
    for index in 0..8 {
        failed_job(&state, &format!("p{index}"), &run_id, index).await;
    }

    assert_eq!(claim_run(&state).await.as_deref(), Some("next"));
    assert!(!state.capacity.runs_on_hold());
}

#[tokio::test]
async fn a_refused_publish_counts_for_nothing() {
    let (_dir, mut state) = test_state().await;
    queue_run(&state, "next").await;
    failing_runs(&state, 4).await;
    // A fifth and a sixth run whose trees the artifact service does not hold.
    let (base, _stub) = spawn_artifact_stub(&[]).await;
    with_artifact_service(&mut state, &base, STUB_TOKEN);
    for name in ["e", "f"] {
        let run_id = stored_run(&state, name).await;
        let refused = enqueue_publish(&state, &run_id, &stamp(10)).await.unwrap();
        assert!(matches!(refused, GatedEnqueue::NoStoredTree));
    }

    refresh_publish_hold(&state).await.unwrap();

    assert_eq!(
        publish_jobs(&state).await.len(),
        4,
        "a refusal records no job"
    );
    assert!(!state.capacity.runs_on_hold());
}

#[tokio::test]
async fn the_threshold_is_the_setting_and_zero_turns_the_hold_off() {
    let (_dir, mut state) = test_state().await;
    queue_run(&state, "next").await;
    failing_runs(&state, 6).await;
    let with_threshold = |state: &mut AppState, runs: u32| {
        let mut config = (*state.config).clone();
        config.publish_failure_hold_runs = runs;
        state.config = std::sync::Arc::new(config);
    };

    with_threshold(&mut state, 7);
    refresh_publish_hold(&state).await.unwrap();
    assert!(!state.capacity.runs_on_hold());

    with_threshold(&mut state, 6);
    refresh_publish_hold(&state).await.unwrap();
    assert!(state.capacity.runs_on_hold());

    with_threshold(&mut state, 0);
    refresh_publish_hold(&state).await.unwrap();
    assert!(!state.capacity.runs_on_hold());
    assert_eq!(claim_run(&state).await.as_deref(), Some("next"));
}

#[tokio::test]
async fn the_first_publish_that_succeeds_ends_the_hold() {
    let (_dir, state) = test_state().await;
    queue_run(&state, "next").await;
    failing_runs(&state, 5).await;
    assert_eq!(claim_run(&state).await, None);

    // A sixth run, which never failed, is published by hand and succeeds.
    let other = stored_run(&state, "other").await;
    enqueue_publish(&state, &other, &stamp(6)).await.unwrap();
    let job = queued_job(&state).await;
    assert!(claim_publish(&state).await);
    report(&state, &job.id, &job.job_token, succeeded()).await;

    // Cleared as the result is accepted, with no claim or pass in between.
    let status = state.capacity.status();
    assert!(!status.runs_on_hold);
    assert_eq!(status.publish_failing_runs, None);
    assert_eq!(claim_run(&state).await.as_deref(), Some("next"));
}

#[tokio::test]
async fn failures_after_the_success_are_counted_from_one_again() {
    let (_dir, state) = test_state().await;
    let runs = failing_runs(&state, 5).await;
    let other = stored_run(&state, "other").await;
    enqueue_publish(&state, &other, &stamp(6)).await.unwrap();
    let job = queued_job(&state).await;
    report(&state, &job.id, &job.job_token, succeeded()).await;
    assert!(!state.capacity.runs_on_hold());

    // Each run's next publish fails, reported after the success. The results are
    // stamped as they are accepted, so they follow it in the order given here.
    for (index, run_id) in runs.iter().enumerate() {
        let id = format!("again-{index}");
        seed_publish_job(&state.db, &id, run_id, "dispatched", &stamp(10)).await;
        report(&state, &id, &format!("ptoken-{id}"), failed("gh: HTTP 502")).await;
        assert_eq!(
            state.capacity.runs_on_hold(),
            index == 4,
            "{} runs have failed since the success",
            index + 1
        );
    }
    assert_eq!(state.capacity.status().publish_failing_runs, Some(5));
}

#[tokio::test]
async fn the_status_route_reads_the_hold_from_the_table() {
    use tower::ServiceExt;
    let (_dir, state) = test_state().await;
    failing_runs(&state, 5).await;

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
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

    assert_eq!(body["state"], "unmonitored");
    assert_eq!(body["runsOnHold"], true);
    assert_eq!(body["holdReason"], "publish-failing");
    assert_eq!(body["detail"], "error of p-e");
    assert_eq!(body["publishFailingRuns"], 5);
}

// --- Probing a held queue ----------------------------------------------------

#[tokio::test]
async fn a_held_queue_is_probed_with_the_oldest_run_however_old_it_is() {
    let (_dir, state) = test_state().await;
    let runs = failing_runs(&state, 5).await;
    let week = 7 * 24 * 60;

    // A week on, every run's own retries ended days ago.
    let pass = failed_publish_pass(&state, at(week)).await;

    assert!(pass.retried.is_empty(), "none is due on its own schedule");
    assert_eq!(pass.probed.as_ref(), Some(&runs[0]));
    assert_eq!(job_states(&state, &runs[0]).await, ["failed", "queued"]);
    assert_eq!(publish_jobs(&state).await.len(), 6, "one probe, not five");
    assert!(state.capacity.runs_on_hold(), "held until it succeeds");
}

#[tokio::test]
async fn the_probe_backs_off_from_five_minutes_to_thirty() {
    let (_dir, state) = test_state().await;
    let runs = failing_runs(&state, 5).await;
    let week = 7 * 24 * 60;

    let mut failed_at = week;
    assert!(failed_publish_pass(&state, at(week)).await.probed.is_some());
    fail_queued(&state, failed_at).await;
    for (probe, interval) in [10, 20, 30, 30].into_iter().enumerate() {
        let before = failed_publish_pass(&state, at(failed_at + interval - 1)).await;
        assert_eq!(
            before,
            PassOutcome::default(),
            "not before {interval} minutes"
        );
        let due = failed_publish_pass(&state, at(failed_at + interval)).await;
        assert_eq!(
            due.probed.as_ref(),
            Some(&runs[(probe + 1) % runs.len()]),
            "the run attempted longest ago, {interval} minutes on"
        );
        failed_at += interval;
        fail_queued(&state, failed_at).await;
    }
    assert!(state.capacity.runs_on_hold());
}

#[tokio::test]
async fn a_run_that_keeps_failing_does_not_keep_the_others_from_being_probed() {
    let (_dir, state) = test_state().await;
    queue_run(&state, "next").await;
    let runs = failing_runs(&state, 5).await;
    let week = 7 * 24 * 60;

    // The oldest run cannot be published for a reason of its own: its probe fails
    // although the release path has been repaired.
    let first = failed_publish_pass(&state, at(week)).await;
    assert_eq!(first.probed.as_ref(), Some(&runs[0]));
    fail_queued(&state, week).await;
    assert_eq!(claim_run(&state).await, None, "still held");

    // The next probe takes another run, whose publish succeeds and ends the hold.
    let second = failed_publish_pass(&state, at(week + 10)).await;
    assert_eq!(second.probed.as_ref(), Some(&runs[1]));
    let job = queued_job(&state).await;
    assert!(claim_publish(&state).await);
    report(&state, &job.id, &job.job_token, succeeded()).await;

    assert_eq!(claim_run(&state).await.as_deref(), Some("next"));
}

#[tokio::test]
async fn every_failed_run_is_probed_before_any_is_probed_twice() {
    let (_dir, state) = test_state().await;
    let runs = failing_runs(&state, 6).await;
    let mut minute = 7 * 24 * 60;

    let mut probed = Vec::new();
    for _ in 0..runs.len() {
        let pass = failed_publish_pass(&state, at(minute)).await;
        probed.push(pass.probed.expect("a probe is due"));
        fail_queued(&state, minute).await;
        minute += 30;
    }

    assert_eq!(
        probed, runs,
        "each run once, least recently attempted first"
    );
    let again = failed_publish_pass(&state, at(minute)).await;
    assert_eq!(again.probed.as_ref(), Some(&runs[0]), "then round again");
}

#[tokio::test]
async fn nothing_is_probed_while_a_publish_is_in_flight() {
    let (_dir, state) = test_state().await;
    failing_runs(&state, 5).await;
    let week = 7 * 24 * 60;
    assert!(failed_publish_pass(&state, at(week)).await.probed.is_some());

    for minutes in [week + 1, week + 31, week + 59] {
        let pass = failed_publish_pass(&state, at(minutes)).await;
        assert_eq!(pass, PassOutcome::default());
    }
}

#[tokio::test]
async fn a_probe_the_gate_refuses_passes_to_the_next_oldest_run() {
    let (_dir, mut state) = test_state().await;
    let runs = failing_runs(&state, 5).await;
    // The oldest run's tree is gone from the artifact service.
    let stored: Vec<&str> = runs[1..].iter().map(String::as_str).collect();
    let (base, _stub) = spawn_artifact_stub(&stored).await;
    with_artifact_service(&mut state, &base, STUB_TOKEN);

    let pass = failed_publish_pass(&state, at(7 * 24 * 60)).await;

    assert_eq!(pass.probed.as_ref(), Some(&runs[1]));
    assert_eq!(job_states(&state, &runs[0]).await, ["failed"]);
    // Four runs that can still be released are one short of the hold.
    assert!(!state.capacity.runs_on_hold());
}

#[tokio::test]
async fn a_probe_that_succeeds_ends_the_hold_without_a_person() {
    let (_dir, state) = test_state().await;
    queue_run(&state, "next").await;
    failing_runs(&state, 5).await;
    assert_eq!(claim_run(&state).await, None);

    assert!(
        failed_publish_pass(&state, at(7 * 24 * 60))
            .await
            .probed
            .is_some()
    );
    let job = queued_job(&state).await;
    assert!(claim_publish(&state).await);
    report(&state, &job.id, &job.job_token, succeeded()).await;

    assert_eq!(claim_run(&state).await.as_deref(), Some("next"));
}

// --- Retention ---------------------------------------------------------------

#[tokio::test]
async fn a_run_keeps_its_tree_through_every_failed_publish() {
    let (_dir, state) = test_state().await;
    let runs = failing_runs(&state, 5).await;
    let week = 7 * 24 * 60;
    failed_publish_pass(&state, at(week)).await;
    fail_queued(&state, week).await;
    failed_publish_pass(&state, at(week + 10)).await;

    let policy = state.config.artifact_retention;
    for run_id in &runs {
        let run = state.db.retention_run(run_id, None).await.unwrap().unwrap();
        assert_eq!(run.artifacts_reclaimed_at, None);
        assert_eq!(
            crate::artifacts::retention_reason(&run, false, at(0), at(52 * week), &policy),
            None,
            "an unpublished completed run's tree is kept, a year on"
        );
    }
}
