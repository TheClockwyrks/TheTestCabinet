//! The publish gate, on each of the paths that enqueue a publish: the shared
//! enqueue itself, a person's `POST /runs/{id}/publish`, and automatic publishing
//! through the driver's status report. The comparison path is covered beside the
//! other comparison flows, in `comparisons.test.rs`.

use axum::extract::{Path, State};
use axum::http::StatusCode;

use super::{GatedEnqueue, enqueue_publish, reclaimed_message};
use crate::api::AppState;
use crate::api::auto_publish::{AutoPublishCause, auto_publish_runs, retry_deferred_runs};
use crate::api::flow_harness::*;
use crate::artifacts::presence_tests::{STUB_TOKEN, spawn_artifact_stub, unreachable_base};
use crate::db::PublishEnqueue;

const NOW: &str = "2026-10-12T00:00:00Z";

/// Store a completed validator-rated run with no status report behind it, so
/// nothing has tried to publish it yet.
async fn stored_run(state: &AppState, job_id: &str) -> String {
    let run_id = format!("run-{job_id}");
    enqueue_other(state, job_id, "pong", None).await;
    finish(state, job_id, run_of(&run_id, "pong", GREAT)).await;
    run_id
}

#[tokio::test]
async fn a_run_with_a_stored_tree_is_enqueued_and_recorded_as_stored() {
    let (_dir, mut state) = test_state().await;
    let run_id = stored_run(&state, "j").await;
    let (base, stub) = spawn_artifact_stub(&[&run_id]).await;
    with_artifact_service(&mut state, &base, STUB_TOKEN);

    let outcome = enqueue_publish(&state, &run_id, NOW).await.unwrap();

    assert!(matches!(
        outcome,
        GatedEnqueue::Enqueued(PublishEnqueue::Enqueued(_))
    ));
    assert_eq!(publishing(&state).await, std::slice::from_ref(&run_id));
    assert_eq!(stub.asked(), std::slice::from_ref(&run_id));
    assert_eq!(
        state.db.run_artifacts_stored(&run_id).await.unwrap(),
        Some(true)
    );
}

#[tokio::test]
async fn a_run_with_no_stored_tree_records_no_publish_job() {
    let (_dir, mut state) = test_state().await;
    let run_id = stored_run(&state, "j").await;
    let (base, _stub) = spawn_artifact_stub(&[]).await;
    with_artifact_service(&mut state, &base, STUB_TOKEN);

    let outcome = enqueue_publish(&state, &run_id, NOW).await.unwrap();

    assert!(matches!(outcome, GatedEnqueue::NoStoredTree), "{outcome:?}");
    assert!(publish_jobs(&state).await.is_empty());
    assert_eq!(
        state.db.run_artifacts_stored(&run_id).await.unwrap(),
        Some(false),
        "the answer is recorded, so the console marks the run at once"
    );
}

#[tokio::test]
async fn an_unreachable_service_is_not_read_as_a_missing_tree() {
    let (_dir, mut state) = test_state().await;
    let run_id = stored_run(&state, "j").await;
    with_artifact_service(&mut state, &unreachable_base().await, STUB_TOKEN);

    let outcome = enqueue_publish(&state, &run_id, NOW).await.unwrap();

    assert!(
        matches!(outcome, GatedEnqueue::ArtifactsUnavailable(_)),
        "{outcome:?}"
    );
    assert!(publish_jobs(&state).await.is_empty());
    assert_eq!(
        state.db.run_artifacts_stored(&run_id).await.unwrap(),
        None,
        "nothing was learned about the run, so nothing is recorded"
    );
}

#[tokio::test]
async fn a_service_that_answers_an_error_is_not_read_as_a_missing_tree() {
    let (_dir, mut state) = test_state().await;
    let run_id = stored_run(&state, "j").await;
    let (base, stub) = spawn_artifact_stub(&[&run_id]).await;
    *stub.presence_status.lock().unwrap() = StatusCode::NOT_FOUND;
    with_artifact_service(&mut state, &base, STUB_TOKEN);

    let outcome = enqueue_publish(&state, &run_id, NOW).await.unwrap();

    assert!(
        matches!(outcome, GatedEnqueue::ArtifactsUnavailable(_)),
        "{outcome:?}"
    );
    assert!(publish_jobs(&state).await.is_empty());
    assert_eq!(state.db.run_artifacts_stored(&run_id).await.unwrap(), None);
}

#[tokio::test]
async fn with_no_artifact_service_configured_the_check_is_skipped() {
    // The single-box development setup: nothing to ask, so a run is enqueued as it
    // always was. A URL with no service token to present is the same case.
    let (_dir, mut state) = test_state().await;
    let first = stored_run(&state, "a").await;
    let outcome = enqueue_publish(&state, &first, NOW).await.unwrap();
    assert!(matches!(
        outcome,
        GatedEnqueue::Enqueued(PublishEnqueue::Enqueued(_))
    ));

    let second = stored_run(&state, "b").await;
    let (base, stub) = spawn_artifact_stub(&[]).await;
    let mut config = (*state.config).clone();
    config.artifacts_internal_url = Some(base);
    config.service_token = None;
    state.config = std::sync::Arc::new(config);
    let outcome = enqueue_publish(&state, &second, NOW).await.unwrap();
    assert!(matches!(
        outcome,
        GatedEnqueue::Enqueued(PublishEnqueue::Enqueued(_))
    ));
    assert!(stub.asked().is_empty());
    assert_eq!(state.db.run_artifacts_stored(&second).await.unwrap(), None);
}

#[tokio::test]
async fn a_run_already_releasing_keeps_its_job_and_is_not_asked_about() {
    let (_dir, mut state) = test_state().await;
    let run_id = stored_run(&state, "j").await;
    let first = state
        .db
        .enqueue_publish_job_once(&run_id, NOW)
        .await
        .unwrap();
    // The service would now say the run has no tree.
    let (base, stub) = spawn_artifact_stub(&[]).await;
    with_artifact_service(&mut state, &base, STUB_TOKEN);

    let outcome = enqueue_publish(&state, &run_id, NOW).await.unwrap();

    match outcome {
        GatedEnqueue::Enqueued(PublishEnqueue::Attached(job_id)) => {
            assert_eq!(job_id, first.job_id());
        }
        other => panic!("expected to attach to the running publish, got {other:?}"),
    }
    assert!(stub.asked().is_empty());
    assert_eq!(publish_jobs(&state).await.len(), 1);
}

// ---- a person's publish ----------------------------------------------------

/// `POST /runs/{id}/publish` as the signed-in owner, answering the status and, for
/// a refusal, the error's code and message.
async fn publish_by_hand(state: &AppState, run_id: &str) -> (StatusCode, String, String) {
    match crate::api::runs::publish(State(state.clone()), Path(run_id.to_string()), owner()).await {
        Ok(response) => (response.status(), String::new(), String::new()),
        Err(error) => (error.status, error.code.to_string(), error.message),
    }
}

#[tokio::test]
async fn a_persons_publish_of_a_run_with_a_stored_tree_is_accepted() {
    let (_dir, mut state) = test_state().await;
    let run_id = stored_run(&state, "j").await;
    let (base, _stub) = spawn_artifact_stub(&[&run_id]).await;
    with_artifact_service(&mut state, &base, STUB_TOKEN);

    let (status, _, _) = publish_by_hand(&state, &run_id).await;

    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(publishing(&state).await, [run_id]);
}

#[tokio::test]
async fn a_persons_publish_of_a_run_with_no_stored_tree_is_refused() {
    let (_dir, mut state) = test_state().await;
    let run_id = stored_run(&state, "j").await;
    let (base, _stub) = spawn_artifact_stub(&[]).await;
    with_artifact_service(&mut state, &base, STUB_TOKEN);

    let (status, code, message) = publish_by_hand(&state, &run_id).await;

    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(code, "conflict");
    assert!(
        message.contains("artifact tree is not stored"),
        "the refusal says why: {message}"
    );
    assert!(publish_jobs(&state).await.is_empty());
}

#[tokio::test]
async fn a_persons_publish_reports_an_unreachable_service_as_unavailable() {
    let (_dir, mut state) = test_state().await;
    let run_id = stored_run(&state, "j").await;
    with_artifact_service(&mut state, &unreachable_base().await, STUB_TOKEN);

    let (status, code, message) = publish_by_hand(&state, &run_id).await;

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(code, "unavailable");
    assert!(
        message.contains("could not check"),
        "the refusal is about the service, not the run: {message}"
    );
    assert!(publish_jobs(&state).await.is_empty());
}

#[tokio::test]
async fn a_persons_publish_still_refuses_an_unpublishable_run_first() {
    // The publish gate proper runs before the tree check, so a run that may never
    // be published is refused as such and the artifact service is not asked.
    let (_dir, mut state) = test_state().await;
    enqueue_other(&state, "j", "pong", None).await;
    finish(
        &state,
        "j",
        ended_run(
            "run-j",
            "pong",
            test_cabinet_core::run_record::RunState::Infrastructure,
        ),
    )
    .await;
    let (base, stub) = spawn_artifact_stub(&["run-j"]).await;
    with_artifact_service(&mut state, &base, STUB_TOKEN);

    let (status, _, _) = publish_by_hand(&state, "run-j").await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(stub.asked().is_empty());
}

// ---- automatic publishing --------------------------------------------------

#[tokio::test]
async fn a_reported_run_with_a_stored_tree_publishes_itself() {
    let (_dir, mut state) = test_state().await;
    let (base, _stub) = spawn_artifact_stub(&["run-j"]).await;
    with_artifact_service(&mut state, &base, STUB_TOKEN);
    enqueue_other(&state, "j", "pong", None).await;

    report_with_artifacts(&state, "j", run_of("run-j", "pong", GREAT), Some(true)).await;

    assert_eq!(publishing(&state).await, ["run-j"]);
    assert_eq!(
        state.db.run_artifacts_stored("run-j").await.unwrap(),
        Some(true)
    );
}

#[tokio::test]
async fn a_run_reported_without_a_stored_tree_is_stored_and_never_enqueued() {
    // The driver's every upload attempt failed. The run is recorded with the
    // outcome it reached, its presence is recorded as not stored, and no publish
    // job is written. The service is not even asked: the report is the answer.
    let (_dir, mut state) = test_state().await;
    let (base, stub) = spawn_artifact_stub(&[]).await;
    with_artifact_service(&mut state, &base, STUB_TOKEN);
    enqueue_other(&state, "j", "pong", None).await;

    report_with_artifacts(&state, "j", run_of("run-j", "pong", GREAT), Some(false)).await;

    let job = state.db.get_job("j").await.unwrap().unwrap();
    assert_eq!(job.state, "succeeded", "the run still completed");
    assert_eq!(
        state.db.run_artifacts_stored("run-j").await.unwrap(),
        Some(false)
    );
    assert!(publish_jobs(&state).await.is_empty());
    assert!(stub.asked().is_empty());
}

#[tokio::test]
async fn a_report_that_says_nothing_about_the_tree_leaves_the_record_alone() {
    let (_dir, state) = test_state().await;
    enqueue_other(&state, "j", "pong", None).await;
    report_with_artifacts(&state, "j", run_of("run-j", "pong", GREAT), Some(false)).await;

    // The same run reported again, by a driver with nothing to say about the tree.
    report_with_artifacts(&state, "j", run_of("run-j", "pong", GREAT), None).await;

    assert_eq!(
        state.db.run_artifacts_stored("run-j").await.unwrap(),
        Some(false)
    );
}

#[tokio::test]
async fn automatic_publishing_passes_over_a_run_the_service_holds_no_tree_for() {
    // The run predates the driver's report of its tree, so its presence is unknown
    // and the gate is what finds out.
    let (_dir, mut state) = test_state().await;
    let (base, stub) = spawn_artifact_stub(&[]).await;
    with_artifact_service(&mut state, &base, STUB_TOKEN);
    enqueue_other(&state, "j", "pong", None).await;

    report(&state, "j", run_of("run-j", "pong", GREAT)).await;

    assert!(publish_jobs(&state).await.is_empty());
    assert_eq!(stub.asked(), ["run-j"]);
    assert_eq!(
        state.db.run_artifacts_stored("run-j").await.unwrap(),
        Some(false)
    );
}

#[tokio::test]
async fn a_run_passed_over_for_an_unreachable_service_is_published_by_a_later_pass() {
    let (_dir, mut state) = test_state().await;
    with_artifact_service(&mut state, &unreachable_base().await, STUB_TOKEN);
    enqueue_other(&state, "j", "pong", None).await;
    report(&state, "j", run_of("run-j", "pong", GREAT)).await;
    assert!(
        publish_jobs(&state).await.is_empty(),
        "nothing is enqueued while the service cannot be asked"
    );

    assert_eq!(
        state.db.auto_publish_deferred_runs().await.unwrap(),
        ["run-j"],
        "the run is left to the retry"
    );

    // A retry while the service is still down asks, gets no answer, and keeps it.
    assert!(retry_deferred_runs(&state).await.is_empty());
    assert_eq!(
        state.db.auto_publish_deferred_runs().await.unwrap(),
        ["run-j"]
    );

    // The service is back. No trigger is left to fire for a run launched by hand,
    // so the retry is what publishes it.
    let (base, stub) = spawn_artifact_stub(&["run-j"]).await;
    with_artifact_service(&mut state, &base, STUB_TOKEN);
    assert_eq!(retry_deferred_runs(&state).await, ["run-j"]);
    assert_eq!(publishing(&state).await, ["run-j"]);
    assert_eq!(stub.asked(), ["run-j"]);
    assert!(
        state
            .db
            .auto_publish_deferred_runs()
            .await
            .unwrap()
            .is_empty(),
        "a run with a publish job no longer waits on the retry"
    );

    // The pass after it has nothing to do and asks nothing.
    assert!(retry_deferred_runs(&state).await.is_empty());
    assert_eq!(stub.asked(), ["run-j"]);
}

#[tokio::test]
async fn a_trigger_leaves_a_deferred_run_to_the_retry() {
    let (_dir, mut state) = test_state().await;
    with_artifact_service(&mut state, &unreachable_base().await, STUB_TOKEN);
    enqueue_other(&state, "j", "pong", None).await;
    report(&state, "j", run_of("run-j", "pong", GREAT)).await;

    // The service answers again, and a ladder pass counts the run. It is the
    // retry's by now, so the pass asks nothing and enqueues nothing: an outage
    // costs a pass one unanswered question, not one per run on its board.
    let (base, stub) = spawn_artifact_stub(&["run-j"]).await;
    with_artifact_service(&mut state, &base, STUB_TOKEN);
    let ids = ["run-j".to_string()];
    assert!(
        auto_publish_runs(&state, &ids, AutoPublishCause::LadderPass)
            .await
            .is_empty()
    );
    assert!(stub.asked().is_empty());
}

#[tokio::test]
async fn a_pass_stops_asking_once_the_service_gives_no_answer() {
    let (_dir, mut state) = test_state().await;
    // Three runs stored with no status report behind them, so nothing has asked
    // about any of them yet.
    let mut ids = Vec::new();
    for job in ["a", "b", "c"] {
        ids.push(stored_run(&state, job).await);
    }

    // A pass over all three against a service that does not answer: the first is
    // asked, and the other two are deferred with it, unasked.
    with_artifact_service(&mut state, &unreachable_base().await, STUB_TOKEN);
    assert!(
        auto_publish_runs(&state, &ids, AutoPublishCause::LadderPass)
            .await
            .is_empty()
    );
    let mut deferred = state.db.auto_publish_deferred_runs().await.unwrap();
    deferred.sort();
    assert_eq!(deferred, ids);

    // The retry publishes all three once the service answers.
    let (base, stub) = spawn_artifact_stub(&["run-a", "run-b", "run-c"]).await;
    with_artifact_service(&mut state, &base, STUB_TOKEN);
    assert!(stub.asked().is_empty());
    let mut enqueued = retry_deferred_runs(&state).await;
    enqueued.sort();
    assert_eq!(enqueued, ids);
    assert_eq!(stub.asked().len(), 3);
}

#[tokio::test]
async fn a_run_whose_tree_appears_becomes_eligible_again() {
    // Recorded as not stored, then found by a reconciliation: the run is offered to
    // automatic publishing again, because no publish job was ever written for it.
    let (_dir, mut state) = test_state().await;
    let (base, stub) = spawn_artifact_stub(&[]).await;
    with_artifact_service(&mut state, &base, STUB_TOKEN);
    enqueue_other(&state, "j", "pong", None).await;
    report_with_artifacts(&state, "j", run_of("run-j", "pong", GREAT), Some(false)).await;
    let ids = ["run-j".to_string()];
    assert!(
        auto_publish_runs(&state, &ids, AutoPublishCause::LadderPass)
            .await
            .is_empty(),
        "a run recorded as not stored is not a candidate"
    );

    // While the run is recorded as not stored the retry leaves it alone, so a tree
    // lost for good is not asked about every interval.
    let asked_before = stub.asked().len();
    assert!(retry_deferred_runs(&state).await.is_empty());
    assert_eq!(stub.asked().len(), asked_before);

    stub.trees.lock().unwrap().insert("run-j".to_string());
    state
        .db
        .set_run_artifacts_stored("run-j", true)
        .await
        .unwrap();

    assert_eq!(retry_deferred_runs(&state).await, ["run-j"]);
}

// ---------------------------------------------------------------------------
// A run whose tree was reclaimed
// ---------------------------------------------------------------------------

/// Record run `run_id`'s tree as reclaimed by the sweep, as a failed run's is.
async fn reclaim(state: &AppState, run_id: &str) {
    let seen = state
        .db
        .retention_run(run_id, None)
        .await
        .unwrap()
        .expect("the run exists");
    assert!(
        state
            .db
            .mark_artifacts_reclaimed(&seen, crate::db::ReclaimReason::Failed, NOW)
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn a_reclaimed_run_is_refused_without_asking_the_service() {
    let (_dir, mut state) = test_state().await;
    let run_id = stored_run(&state, "j").await;
    // The service would even answer that it holds a tree, one that landed late.
    let (base, stub) = spawn_artifact_stub(&[&run_id]).await;
    with_artifact_service(&mut state, &base, STUB_TOKEN);
    reclaim(&state, &run_id).await;

    let outcome = enqueue_publish(&state, &run_id, NOW).await.unwrap();

    assert!(matches!(outcome, GatedEnqueue::Reclaimed(_)), "{outcome:?}");
    assert!(publish_jobs(&state).await.is_empty());
    assert!(stub.asked().is_empty(), "the record already says why");
    // The refusal changed nothing about the record.
    assert_eq!(
        state.db.run_artifacts_stored(&run_id).await.unwrap(),
        Some(false)
    );
    assert!(
        state
            .db
            .run_artifacts_reclaimed(&run_id)
            .await
            .unwrap()
            .is_some()
    );
}

#[tokio::test]
async fn a_persons_publish_of_a_reclaimed_run_says_the_tree_was_removed_on_purpose() {
    let (_dir, mut state) = test_state().await;
    let run_id = stored_run(&state, "j").await;
    let (base, _stub) = spawn_artifact_stub(&[]).await;
    with_artifact_service(&mut state, &base, STUB_TOKEN);
    reclaim(&state, &run_id).await;

    let (status, code, message) = publish_by_hand(&state, &run_id).await;

    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(code, "conflict");
    assert!(
        message.contains("retention"),
        "the refusal says the tree was removed after its retention: {message}"
    );
    assert!(
        !message.contains("not stored"),
        "and does not read as a lost tree: {message}"
    );
    assert!(publish_jobs(&state).await.is_empty());
}

#[test]
fn the_refusal_of_a_published_runs_republish_names_what_removed_the_tree() {
    // A published run's tree is not removed by a retention period, so the message
    // a failed run gets would send its reader looking at the wrong setting.
    let published = reclaimed_message("r1", crate::db::ReclaimReason::Published);
    assert!(published.contains("published again"), "{published}");
    assert!(published.contains("release was confirmed"), "{published}");
    assert!(
        published.contains("TCAB_ARTIFACT_RECLAIM_PUBLISHED=false"),
        "{published}"
    );
    assert!(!published.contains("retention"), "{published}");

    for reason in [
        crate::db::ReclaimReason::Failed,
        crate::db::ReclaimReason::Canceled,
    ] {
        let message = reclaimed_message("r1", reason);
        assert!(message.contains("retention period"), "{message}");
        assert!(
            !message.contains("TCAB_ARTIFACT_RECLAIM_PUBLISHED"),
            "{message}"
        );
    }
}

#[tokio::test]
async fn the_gate_answers_with_the_reason_the_tree_was_reclaimed_for() {
    let (_dir, state) = test_state().await;
    let run_id = stored_run(&state, "j").await;
    reclaim(&state, &run_id).await;

    let outcome = enqueue_publish(&state, &run_id, NOW).await.unwrap();

    assert!(
        matches!(
            outcome,
            GatedEnqueue::Reclaimed(crate::db::ReclaimReason::Failed)
        ),
        "{outcome:?}"
    );
}

#[tokio::test]
async fn the_deferred_retry_settles_a_reclaimed_run_instead_of_asking_again() {
    // Passed over while the service was unreachable, then reclaimed before the
    // retry reached it.
    let (_dir, mut state) = test_state().await;
    with_artifact_service(&mut state, &unreachable_base().await, STUB_TOKEN);
    enqueue_other(&state, "j", "pong", None).await;
    report(&state, "j", run_of("run-j", "pong", GREAT)).await;
    assert!(publish_jobs(&state).await.is_empty());
    reclaim(&state, "run-j").await;

    let (base, stub) = spawn_artifact_stub(&["run-j"]).await;
    with_artifact_service(&mut state, &base, STUB_TOKEN);
    retry_deferred_runs(&state).await;
    retry_deferred_runs(&state).await;

    assert!(publish_jobs(&state).await.is_empty());
    assert!(stub.asked().is_empty(), "{:?}", stub.asked());
}
