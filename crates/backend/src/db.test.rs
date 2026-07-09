use super::*;
use test_cabinet_core::metrics::RunMetrics;
use test_cabinet_core::review::{DomainRating, Rating};
use test_cabinet_core::run_record::{
    HarnessSlug, RunEnvironment, RunState, RunStatus, RunSubject, RunTooling,
};
use test_cabinet_core::validation::ValidationSummary;

/// Build a minimal valid run record with the given id.
fn record(id: &str) -> RunRecord {
    RunRecord {
        id: id.to_string(),
        started_at: "2026-06-17T20:40:00Z".to_string(),
        finished_at: "2026-06-17T21:30:00Z".to_string(),
        subject: RunSubject {
            test_case_slug: "pong".to_string(),
            test_case_version: "v1.0.0".to_string(),
            test_type: test_cabinet_core::TestType::EndToEnd,
            variant: "base".to_string(),
            harness_slug: HarnessSlug::Claude,
            harness_version: Some("1.2.3".to_string()),
            orchestrator_slug: "one-shot".to_string(),
            model_id: "claude-sonnet-4-5".to_string(),
        },
        tooling: RunTooling::default(),
        environment: RunEnvironment {
            os: "Debian".to_string(),
            container_image: "test-cabinet/claude:abcd".to_string(),
            node_version: Some("v22.11.0".to_string()),
            auth_mode: test_cabinet_core::AuthMode::ApiKey,
        },
        metrics: RunMetrics::default(),
        validation: ValidationSummary {
            loaded: true,
            ..ValidationSummary::default()
        },
        links: RunLinks::default(),
        status: RunStatus {
            state: RunState::Completed,
            detail: None,
        },
    }
}

/// A reviewer identity for tests, derived from a stable account id.
fn reviewer(id: &str) -> Reviewer {
    Reviewer {
        user_id: id.to_string(),
        username: format!("{id}-handle"),
        display_name: format!("{id} Display"),
    }
}

/// A review from account `u1` rating `gameplay` great.
fn review() -> StoredReview {
    review_by("u1", Rating::Great)
}

/// A review from `account` giving `rating` to the `gameplay` domain.
fn review_by(account: &str, rating: Rating) -> StoredReview {
    use test_cabinet_core::review::VerdictStatus;
    StoredReview {
        reviewer: reviewer(account),
        ratings: vec![DomainRating {
            domain: "gameplay".to_string(),
            rating,
        }],
        writeup: "Plays well.".to_string(),
        checklist: vec![ReviewVerdict {
            id: "ball-spin".to_string(),
            status: VerdictStatus::Pass,
            note: Some("spin curves the ball".to_string()),
        }],
        reviewed_at: "2026-06-17T22:00:00Z".to_string(),
    }
}

fn links() -> RunLinks {
    RunLinks {
        source_repo: Some("https://github.com/x/y".to_string()),
        playable_build: Some("https://abc.pages.dev".to_string()),
    }
}

/// Push, review (account `u1`), and publish a run at `published_at` — the common
/// "now public" setup for these tests.
async fn push_review_publish(db: &Db, id: &str, published_at: &str) {
    db.push(&record(id), &links(), None).await.unwrap();
    db.add_review(id, &review()).await.unwrap();
    db.publish(id, published_at).await.unwrap();
}

#[tokio::test]
async fn a_pushed_run_is_unpublished_with_no_reviews_and_absent_from_the_public_list() {
    let db = Db::connect_in_memory().await.unwrap();
    let outcome = db.push(&record("r1"), &links(), None).await.unwrap();
    assert!(outcome.newly_pushed);

    let stored = db.get_run("r1").await.unwrap().unwrap();
    assert!(!stored.published);
    assert!(stored.reviews.is_empty());
    assert!(stored.published_at.is_none());
    // The stored record carries the resolved links even though the submitted
    // record's links were empty.
    assert_eq!(
        stored.record.links.playable_build.as_deref(),
        Some("https://abc.pages.dev")
    );

    // A pending run is not in the public list, but is in the reviewer worklist.
    assert!(db.list_published(50, None).await.unwrap().0.is_empty());
    assert_eq!(db.list_for_review(50, None).await.unwrap().0.len(), 1);
}

#[tokio::test]
async fn a_record_that_no_longer_deserializes_is_skipped_not_fatal() {
    // A stored record can predate a contract change and no longer parse as a
    // `RunRecord` (e.g. an animated-voxel run recorded before F-curve keyframes
    // gained their required `interp` field). Such a row must not blank an entire
    // worklist; it is skipped, and its still-valid siblings return normally.
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record("good"), &links(), None).await.unwrap();
    db.push(&record("legacy"), &links(), None).await.unwrap();

    // Corrupt `legacy`'s stored blob so it can no longer be parsed as a RunRecord,
    // standing in for a row written under an older, incompatible schema.
    run::Entity::update_many()
        .col_expr(
            run::Column::RecordJson,
            Expr::value(r#"{"id":"legacy","schema":"from-before-a-contract-change"}"#),
        )
        .filter(run::Column::Id.eq("legacy"))
        .exec(&db.conn)
        .await
        .unwrap();

    // The reviewer worklist still returns the good run instead of erroring on the
    // undeserializable sibling.
    let (runs, _) = db.list_for_review(50, None).await.unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].record.id, "good");

    // A direct read of the corrupt run is a clean not-found (it is skipped in
    // assembly), while the good run still reads back.
    assert!(db.get_run("legacy").await.unwrap().is_none());
    assert!(db.get_run("good").await.unwrap().is_some());
}

#[tokio::test]
async fn publish_is_refused_until_a_run_has_a_review() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record("r1"), &links(), None).await.unwrap();

    let err = db.publish("r1", "2026-06-17T21:40:00Z").await.unwrap_err();
    assert!(matches!(err, crate::error::BackendError::Unprocessable(_)));

    // After a review, publish succeeds and the run becomes public.
    db.add_review("r1", &review()).await.unwrap();
    let outcome = db.publish("r1", "2026-06-17T21:40:00Z").await.unwrap();
    assert!(outcome.newly_published);
    let stored = db.get_run("r1").await.unwrap().unwrap();
    assert!(stored.published);
    assert_eq!(stored.published_at.as_deref(), Some("2026-06-17T21:40:00Z"));
    assert_eq!(stored.reviews[0].ratings, review().ratings);
    assert_eq!(stored.reviews[0].checklist, review().checklist);
}

#[tokio::test]
async fn add_review_is_per_account_upsert_and_a_run_can_carry_many() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record("r1"), &links(), None).await.unwrap();

    // Two distinct accounts → two reviews.
    db.add_review("r1", &review_by("u1", Rating::Great))
        .await
        .unwrap();
    db.add_review("r1", &review_by("u2", Rating::Broken))
        .await
        .unwrap();
    assert_eq!(db.get_run("r1").await.unwrap().unwrap().reviews.len(), 2);

    // The same account re-reviewing updates in place rather than adding another.
    db.add_review("r1", &review_by("u1", Rating::Scuffed))
        .await
        .unwrap();
    let stored = db.get_run("r1").await.unwrap().unwrap();
    assert_eq!(stored.reviews.len(), 2);
    let u1 = stored
        .reviews
        .iter()
        .find(|r| r.reviewer.user_id == "u1")
        .unwrap();
    assert_eq!(u1.ratings[0].rating, Rating::Scuffed);
}

#[tokio::test]
async fn add_review_for_an_unknown_run_is_not_found() {
    let db = Db::connect_in_memory().await.unwrap();
    let err = db.add_review("nope", &review()).await.unwrap_err();
    assert!(matches!(err, crate::error::BackendError::NotFound(_)));
}

#[tokio::test]
async fn push_stores_events_json_and_get_run_returns_it() {
    let db = Db::connect_in_memory().await.unwrap();
    let events = r#"[{"timestamp":"2026-06-17T20:41:00Z","type":"agent","message":"hi"}]"#;
    db.push(&record("r1"), &links(), Some(events))
        .await
        .unwrap();
    let stored = db.get_run("r1").await.unwrap().unwrap();
    assert_eq!(stored.events_json.as_deref(), Some(events));

    // A run pushed without an event log stores NULL and reads back as None.
    db.push(&record("r2"), &links(), None).await.unwrap();
    assert_eq!(db.get_run("r2").await.unwrap().unwrap().events_json, None);
}

#[tokio::test]
async fn republish_is_idempotent_and_keeps_first_published_at() {
    let db = Db::connect_in_memory().await.unwrap();
    push_review_publish(&db, "r1", "2026-06-17T21:40:00Z").await;

    let outcome = db.publish("r1", "2026-06-18T09:00:00Z").await.unwrap();
    assert!(!outcome.newly_published);

    let stored = db.get_run("r1").await.unwrap().unwrap();
    // published_at is preserved from the first publish.
    assert_eq!(stored.published_at.as_deref(), Some("2026-06-17T21:40:00Z"));
    assert_eq!(db.run_count().await.unwrap(), 1);
}

#[tokio::test]
async fn list_published_orders_newest_first_paginates_and_excludes_pending() {
    let db = Db::connect_in_memory().await.unwrap();
    push_review_publish(&db, "r1", "2026-06-17T10:00:00Z").await;
    push_review_publish(&db, "r2", "2026-06-17T11:00:00Z").await;
    push_review_publish(&db, "r3", "2026-06-17T12:00:00Z").await;
    // A pending (pushed-only) run must never appear in the public list.
    db.push(&record("pending"), &links(), None).await.unwrap();

    let (page, next) = db.list_published(2, None).await.unwrap();
    assert_eq!(page.len(), 2);
    assert_eq!(page[0].record.id, "r3");
    assert_eq!(page[1].record.id, "r2");
    let next = next.expect("a next cursor");

    let (page2, next2) = db.list_published(2, Some(&next)).await.unwrap();
    assert_eq!(page2.len(), 1);
    assert_eq!(page2[0].record.id, "r1");
    assert!(next2.is_none());
}

#[tokio::test]
async fn publish_marks_snapshot_dirty_but_pushing_a_pending_run_does_not() {
    let db = Db::connect_in_memory().await.unwrap();
    assert!(!db.snapshot_state().await.unwrap().dirty);

    // Pushing and reviewing a pending run touches nothing public.
    db.push(&record("r1"), &links(), None).await.unwrap();
    db.add_review("r1", &review()).await.unwrap();
    assert!(!db.snapshot_state().await.unwrap().dirty);

    // Publishing flips it public and marks the snapshot dirty.
    db.publish("r1", "2026-06-17T10:00:00Z").await.unwrap();
    assert!(db.snapshot_state().await.unwrap().dirty);

    db.mark_uploaded("2026-06-17T10:05:00Z", 1).await.unwrap();
    let state = db.snapshot_state().await.unwrap();
    assert!(!state.dirty);
    assert_eq!(state.last_run_count, Some(1));
    assert_eq!(state.last_uploaded.as_deref(), Some("2026-06-17T10:05:00Z"));
}

#[tokio::test]
async fn all_published_returns_only_published_runs_newest_first() {
    let db = Db::connect_in_memory().await.unwrap();
    push_review_publish(&db, "r1", "2026-06-17T10:00:00Z").await;
    push_review_publish(&db, "r2", "2026-06-17T11:00:00Z").await;
    db.push(&record("pending"), &links(), None).await.unwrap();

    let all = db.all_published().await.unwrap();
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].record.id, "r2");
    assert_eq!(db.run_count().await.unwrap(), 2);
}

#[tokio::test]
async fn delete_run_removes_an_unpublished_run_and_cascades_its_reviews() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record("r1"), &links(), None).await.unwrap();
    db.add_review("r1", &review()).await.unwrap();
    // A second pending run is left untouched, to prove the delete is scoped.
    db.push(&record("r2"), &links(), None).await.unwrap();

    db.delete_run("r1").await.unwrap();

    // The run is gone from every read path, and its review cascaded away with it.
    assert!(db.get_run("r1").await.unwrap().is_none());
    let worklist = db.list_for_review(50, None).await.unwrap().0;
    assert_eq!(worklist.len(), 1);
    assert_eq!(worklist[0].record.id, "r2");
    assert!(db.get_run("r2").await.unwrap().unwrap().reviews.is_empty());
}

#[tokio::test]
async fn delete_run_also_removes_its_run_and_publish_queue_rows() {
    let db = Db::connect_in_memory().await.unwrap();

    // A run produced by a job (the job carries the produced run's id in
    // `record_id`, a plain column with no foreign key back to `run`), with a
    // publish job enqueued against it by `run_id` (likewise no foreign key).
    db.push(&record("r1"), &links(), None).await.unwrap();
    db.enqueue_job(new_job("j1", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();
    db.set_job_state("j1", "succeeded", "2026-06-23T00:05:00Z", None, Some("r1"))
        .await
        .unwrap();
    db.enqueue_publish_job(NewPublishJob {
        id: "p1".to_string(),
        run_id: "r1".to_string(),
        job_token: "token-p1".to_string(),
        created_at: "2026-06-23T00:06:00Z".to_string(),
    })
    .await
    .unwrap();

    // A second run and its queue rows are left untouched, to prove the delete is
    // scoped to the deleted run.
    db.push(&record("r2"), &links(), None).await.unwrap();
    db.enqueue_job(new_job("j2", "2026-06-23T00:10:00Z"))
        .await
        .unwrap();
    db.set_job_state("j2", "succeeded", "2026-06-23T00:15:00Z", None, Some("r2"))
        .await
        .unwrap();
    db.enqueue_publish_job(NewPublishJob {
        id: "p2".to_string(),
        run_id: "r2".to_string(),
        job_token: "token-p2".to_string(),
        created_at: "2026-06-23T00:16:00Z".to_string(),
    })
    .await
    .unwrap();

    db.delete_run("r1").await.unwrap();

    // The deleted run leaves no orphan in either queue...
    assert!(db.get_run("r1").await.unwrap().is_none());
    assert!(db.get_job("j1").await.unwrap().is_none());
    assert!(db.get_publish_job("p1").await.unwrap().is_none());
    // ...while the untouched run's queue rows remain.
    assert!(db.get_job("j2").await.unwrap().is_some());
    assert!(db.get_publish_job("p2").await.unwrap().is_some());
}

#[tokio::test]
async fn delete_run_is_refused_for_a_published_run() {
    let db = Db::connect_in_memory().await.unwrap();
    push_review_publish(&db, "r1", "2026-06-17T10:00:00Z").await;

    let err = db.delete_run("r1").await.unwrap_err();
    assert!(matches!(err, crate::error::BackendError::Unprocessable(_)));
    // The published run is untouched.
    assert!(db.get_run("r1").await.unwrap().unwrap().published);
}

#[tokio::test]
async fn delete_run_for_an_unknown_run_is_not_found() {
    let db = Db::connect_in_memory().await.unwrap();
    let err = db.delete_run("nope").await.unwrap_err();
    assert!(matches!(err, crate::error::BackendError::NotFound(_)));
}

fn tournament_record(id: &str) -> TournamentRecord {
    use test_cabinet_core::match_play::{ControllerKind, ControllerRef, MatchSummary, Standing};
    use test_cabinet_core::validation::AdversarialOutcome;

    let participant = |pid: &str| ControllerRef {
        id: pid.to_string(),
        kind: ControllerKind::Baseline,
        label: None,
    };
    TournamentRecord {
        id: id.to_string(),
        created_at: "2026-06-21T00:00:00Z".to_string(),
        test_case_slug: "foray".to_string(),
        test_case_version: "v1.0.0".to_string(),
        variant: "base".to_string(),
        participants: vec![participant("border-soldier"), participant("random")],
        standings: vec![
            Standing {
                participant_id: "border-soldier".to_string(),
                wins: 1,
                losses: 0,
                draws: 0,
                rank: 1,
            },
            Standing {
                participant_id: "random".to_string(),
                wins: 0,
                losses: 1,
                draws: 0,
                rank: 2,
            },
        ],
        matches: vec![MatchSummary {
            match_id: "border-soldier__vs__random".to_string(),
            red_id: "border-soldier".to_string(),
            blue_id: "random".to_string(),
            winner: Some("border-soldier".to_string()),
            win_type: "swept".to_string(),
            outcome_for_red: AdversarialOutcome::Win,
            red_score: 20,
            blue_score: 3,
            ticks: 1234,
            red_kills: 4,
            blue_kills: 1,
            red_fuel: 8_000,
            blue_fuel: 12_000,
            replay_key: Some("border-soldier__vs__random".to_string()),
            detail: None,
        }],
    }
}

#[tokio::test]
async fn publish_then_get_tournament_round_trips() {
    let db = Db::connect_in_memory().await.unwrap();
    let outcome = db
        .publish_tournament(&tournament_record("t1"), "2026-06-21T00:00:00Z")
        .await
        .unwrap();
    assert!(outcome.newly_published);

    let stored = db.get_tournament("t1").await.unwrap().unwrap();
    assert_eq!(stored.record.standings[0].participant_id, "border-soldier");
    assert_eq!(stored.record.matches[0].red_kills, 4);
    assert_eq!(stored.published_at, "2026-06-21T00:00:00Z");
}

#[tokio::test]
async fn republish_tournament_keeps_first_published_at() {
    let db = Db::connect_in_memory().await.unwrap();
    db.publish_tournament(&tournament_record("t1"), "2026-06-21T00:00:00Z")
        .await
        .unwrap();
    let outcome = db
        .publish_tournament(&tournament_record("t1"), "2026-06-22T00:00:00Z")
        .await
        .unwrap();
    assert!(!outcome.newly_published, "re-publish is idempotent");
    let stored = db.get_tournament("t1").await.unwrap().unwrap();
    assert_eq!(stored.published_at, "2026-06-21T00:00:00Z");
}

#[tokio::test]
async fn list_tournaments_orders_newest_first_and_paginates() {
    let db = Db::connect_in_memory().await.unwrap();
    db.publish_tournament(&tournament_record("t1"), "2026-06-21T10:00:00Z")
        .await
        .unwrap();
    db.publish_tournament(&tournament_record("t2"), "2026-06-21T11:00:00Z")
        .await
        .unwrap();

    let (page, next) = db.list_tournaments(1, None).await.unwrap();
    assert_eq!(page.len(), 1);
    assert_eq!(page[0].record.id, "t2", "newest first");
    let cursor = next.expect("a second page remains");
    let (page2, _) = db.list_tournaments(1, Some(&cursor)).await.unwrap();
    assert_eq!(page2[0].record.id, "t1");
}

// --- Run queue (the `job` table) -------------------------------------------

/// A queued run with the given id and enqueue time. The lifted identity columns
/// are fixed; tests that care about ordering vary `created_at`.
fn new_job(id: &str, created_at: &str) -> NewJob {
    NewJob {
        id: id.to_string(),
        request_json: format!("{{\"jobId\":\"{id}\"}}"),
        test_case_slug: "pong".to_string(),
        test_case_version: "v1.0.0".to_string(),
        variant: "base".to_string(),
        harness_slug: "claude".to_string(),
        model_id: "claude-sonnet-4-5".to_string(),
        job_token: format!("token-{id}"),
        attempt: 0,
        created_at: created_at.to_string(),
    }
}

#[tokio::test]
async fn enqueue_then_claim_flips_queued_to_dispatched_then_drains() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_job(new_job("j1", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();

    let claimed = db
        .claim_next_job("2026-06-23T00:00:05Z")
        .await
        .unwrap()
        .expect("the queued job is claimable");
    assert_eq!(claimed.id, "j1");
    assert_eq!(claimed.state, "dispatched");
    assert_eq!(claimed.job_token, "token-j1");

    // A claimed job is no longer queued, so a second claim finds nothing.
    assert!(
        db.claim_next_job("2026-06-23T00:00:06Z")
            .await
            .unwrap()
            .is_none(),
        "the queue is drained"
    );
}

#[tokio::test]
async fn claim_takes_the_oldest_queued_job_first() {
    let db = Db::connect_in_memory().await.unwrap();
    // Enqueue out of chronological order to prove the claim sorts by created_at.
    db.enqueue_job(new_job("newer", "2026-06-23T00:10:00Z"))
        .await
        .unwrap();
    db.enqueue_job(new_job("older", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();

    let first = db.claim_next_job("2026-06-23T01:00:00Z").await.unwrap();
    assert_eq!(
        first.unwrap().id,
        "older",
        "oldest enqueued is claimed first"
    );
    let second = db.claim_next_job("2026-06-23T01:00:01Z").await.unwrap();
    assert_eq!(second.unwrap().id, "newer");
}

#[tokio::test]
async fn set_job_state_records_terminal_detail_and_record_id() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_job(new_job("j1", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();

    db.set_job_state("j1", "running", "2026-06-23T00:01:00Z", None, None)
        .await
        .unwrap()
        .expect("the job exists");
    let succeeded = db
        .set_job_state(
            "j1",
            "succeeded",
            "2026-06-23T00:50:00Z",
            None,
            Some("record-7"),
        )
        .await
        .unwrap()
        .expect("the job exists");
    assert_eq!(succeeded.state, "succeeded");
    assert_eq!(succeeded.record_id.as_deref(), Some("record-7"));
    assert!(succeeded.detail.is_none());

    // An unknown job yields None rather than erroring.
    assert!(
        db.set_job_state("missing", "running", "2026-06-23T00:00:00Z", None, None)
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn cancel_job_moves_a_non_terminal_job_to_canceled_with_its_reason() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_job(new_job("j1", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();
    db.set_job_state("j1", "running", "2026-06-23T00:01:00Z", None, None)
        .await
        .unwrap();

    let canceled = db
        .cancel_job("j1", "2026-06-23T00:02:00Z", "canceled by operator")
        .await
        .unwrap()
        .expect("a running job is cancelable");
    assert_eq!(canceled.state, "canceled");
    assert_eq!(canceled.detail.as_deref(), Some("canceled by operator"));

    // A canceled job no longer counts as in flight.
    assert!(db.active_jobs().await.unwrap().is_empty());
}

#[tokio::test]
async fn cancel_job_refuses_a_terminal_or_unknown_job() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_job(new_job("done", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();
    db.set_job_state(
        "done",
        "succeeded",
        "2026-06-23T00:05:00Z",
        None,
        Some("r1"),
    )
    .await
    .unwrap();

    // A finished job cannot be canceled — `cancel_job` transitions only from a
    // non-terminal state, so it reports no change and leaves the row untouched.
    assert!(
        db.cancel_job("done", "2026-06-23T00:06:00Z", "canceled by operator")
            .await
            .unwrap()
            .is_none()
    );
    let still = db.get_job("done").await.unwrap().expect("the job exists");
    assert_eq!(still.state, "succeeded");

    // An unknown job is likewise a no-op None rather than an error.
    assert!(
        db.cancel_job("missing", "2026-06-23T00:06:00Z", "canceled by operator")
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn set_job_state_never_overwrites_a_canceled_job() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_job(new_job("j1", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();
    db.cancel_job("j1", "2026-06-23T00:01:00Z", "canceled by operator")
        .await
        .unwrap()
        .expect("a queued job is cancelable");

    // A late report from the still-winding-down driver must not resurrect or
    // overwrite the canceled run: `set_job_state` leaves it untouched (None).
    assert!(
        db.set_job_state("j1", "succeeded", "2026-06-23T00:02:00Z", None, Some("r1"))
            .await
            .unwrap()
            .is_none()
    );
    let still = db.get_job("j1").await.unwrap().expect("the job exists");
    assert_eq!(still.state, "canceled");
    assert!(still.record_id.is_none());
}

#[tokio::test]
async fn active_jobs_excludes_terminal_jobs_oldest_first() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_job(new_job("a", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();
    db.enqueue_job(new_job("b", "2026-06-23T00:01:00Z"))
        .await
        .unwrap();
    db.enqueue_job(new_job("c", "2026-06-23T00:02:00Z"))
        .await
        .unwrap();
    // b finishes; a and c stay in flight.
    db.set_job_state("b", "succeeded", "2026-06-23T00:30:00Z", None, Some("r-b"))
        .await
        .unwrap();

    let active = db.active_jobs().await.unwrap();
    let ids: Vec<&str> = active.iter().map(|j| j.id.as_str()).collect();
    assert_eq!(
        ids,
        vec!["a", "c"],
        "terminal jobs are excluded, oldest first"
    );
}

#[tokio::test]
async fn fail_in_flight_jobs_reaps_only_executing_jobs() {
    let db = Db::connect_in_memory().await.unwrap();
    // q stays queued (no driver yet); d is dispatched; r is running; s succeeded.
    db.enqueue_job(new_job("q", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();
    db.enqueue_job(new_job("d", "2026-06-23T00:01:00Z"))
        .await
        .unwrap();
    db.set_job_state("d", "dispatched", "2026-06-23T00:01:30Z", None, None)
        .await
        .unwrap();
    db.enqueue_job(new_job("r", "2026-06-23T00:02:00Z"))
        .await
        .unwrap();
    db.set_job_state("r", "running", "2026-06-23T00:02:30Z", None, None)
        .await
        .unwrap();
    db.enqueue_job(new_job("s", "2026-06-23T00:03:00Z"))
        .await
        .unwrap();
    db.set_job_state("s", "succeeded", "2026-06-23T00:30:00Z", None, Some("r-s"))
        .await
        .unwrap();

    let reaped = db
        .fail_in_flight_jobs("2026-06-23T01:00:00Z", "interrupted")
        .await
        .unwrap();
    assert_eq!(reaped, 2, "only the dispatched and running jobs are reaped");

    // The two executing jobs are now terminal failures with the stamped detail.
    for id in ["d", "r"] {
        let job = db.get_job(id).await.unwrap().expect("the job exists");
        assert_eq!(job.state, "failed");
        assert_eq!(job.detail.as_deref(), Some("interrupted"));
        assert_eq!(job.updated_at, "2026-06-23T01:00:00Z");
    }
    // The queued job is untouched, ready for the dispatcher to drain.
    assert_eq!(db.get_job("q").await.unwrap().unwrap().state, "queued");
    // The already-terminal succeeded job keeps its outcome.
    let s = db.get_job("s").await.unwrap().unwrap();
    assert_eq!(s.state, "succeeded");
    assert_eq!(s.record_id.as_deref(), Some("r-s"));

    // The active-run list is now just the still-queued job.
    let active = db.active_jobs().await.unwrap();
    let ids: Vec<&str> = active.iter().map(|j| j.id.as_str()).collect();
    assert_eq!(ids, vec!["q"]);
}

#[tokio::test]
async fn fail_in_flight_jobs_is_a_noop_with_nothing_executing() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_job(new_job("q", "2026-06-23T00:00:00Z"))
        .await
        .unwrap();

    let reaped = db
        .fail_in_flight_jobs("2026-06-23T01:00:00Z", "interrupted")
        .await
        .unwrap();
    assert_eq!(reaped, 0);
    assert_eq!(db.get_job("q").await.unwrap().unwrap().state, "queued");
}

#[tokio::test]
async fn publish_refuses_an_infrastructure_failure_even_with_a_review() {
    let db = Db::connect_in_memory().await.unwrap();
    // An infrastructure failure is the Test Cabinet's fault, never publishable —
    // even if someone attached a review.
    let mut rec = record("i1");
    rec.status.state = RunState::Infrastructure;
    db.push(&rec, &RunLinks::default(), None).await.unwrap();
    db.add_review("i1", &review()).await.unwrap();

    let err = db
        .publish("i1", "2026-06-23T00:00:00Z")
        .await
        .expect_err("an infrastructure failure must never be publishable");
    assert!(
        matches!(err, crate::error::BackendError::Unprocessable(_)),
        "got {err:?}"
    );
}

#[tokio::test]
async fn publish_allows_a_failure_tier_without_any_review() {
    let db = Db::connect_in_memory().await.unwrap();
    // Catastrophic and timed-out runs are publishable model signal with no review
    // checklist — they publish through the failures path with zero reviews.
    for (id, state) in [
        ("cat1", RunState::Catastrophic),
        ("to1", RunState::TimedOut),
    ] {
        let mut rec = record(id);
        rec.status.state = state;
        db.push(&rec, &RunLinks::default(), None).await.unwrap();

        let outcome = db.publish(id, "2026-06-23T00:00:00Z").await.unwrap();
        assert!(
            outcome.newly_published,
            "{id} should publish with no review"
        );
        assert!(db.get_run(id).await.unwrap().unwrap().published);
    }
}

#[tokio::test]
async fn worklist_holds_completed_runs_and_failures_path_holds_the_rest() {
    let db = Db::connect_in_memory().await.unwrap();
    for (id, state) in [
        ("done", RunState::Completed),
        ("cat", RunState::Catastrophic),
        ("slow", RunState::TimedOut),
        ("infra", RunState::Infrastructure),
    ] {
        let mut rec = record(id);
        rec.status.state = state;
        db.push(&rec, &RunLinks::default(), None).await.unwrap();
    }

    let (review, _) = db.list_for_review(50, None).await.unwrap();
    let review_ids: Vec<&str> = review.iter().map(|r| r.record.id.as_str()).collect();
    assert_eq!(
        review_ids,
        vec!["done"],
        "only completed runs are reviewable"
    );

    let (failures, _) = db.list_publishable_failures(50, None).await.unwrap();
    let mut failure_ids: Vec<&str> = failures.iter().map(|r| r.record.id.as_str()).collect();
    failure_ids.sort_unstable();
    assert_eq!(
        failure_ids,
        vec!["cat", "slow"],
        "publishable failures exclude infrastructure failures"
    );

    // The console's produced worklist carries every unpublished run whatever its
    // tier — including the infrastructure failure that appears in neither worklist
    // above — so an infrastructure failure stays inspectable rather than vanishing.
    let (unpublished, _) = db.list_unpublished(50, None).await.unwrap();
    let mut unpublished_ids: Vec<&str> = unpublished.iter().map(|r| r.record.id.as_str()).collect();
    unpublished_ids.sort_unstable();
    assert_eq!(
        unpublished_ids,
        vec!["cat", "done", "infra", "slow"],
        "every unpublished run, all tiers, is in the produced worklist"
    );

    // Publishing one drops it from the produced worklist (it is now the public
    // read side), leaving the worklist disjoint from the published listing.
    db.publish("cat", "2026-06-23T00:00:00Z").await.unwrap();
    let (after, _) = db.list_unpublished(50, None).await.unwrap();
    let mut after_ids: Vec<&str> = after.iter().map(|r| r.record.id.as_str()).collect();
    after_ids.sort_unstable();
    assert_eq!(
        after_ids,
        vec!["done", "infra", "slow"],
        "a published run leaves the unpublished worklist"
    );
}

// --- Publish queue ----------------------------------------------------------

fn new_publish_job(id: &str, run_id: &str, created_at: &str) -> NewPublishJob {
    NewPublishJob {
        id: id.to_string(),
        run_id: run_id.to_string(),
        job_token: format!("ptoken-{id}"),
        created_at: created_at.to_string(),
    }
}

#[tokio::test]
async fn enqueue_then_claim_publish_job_flips_queued_to_dispatched_then_drains() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_publish_job(new_publish_job("p1", "r1", "2026-06-27T00:00:00Z"))
        .await
        .unwrap();

    let claimed = db
        .claim_next_publish_job("2026-06-27T00:00:05Z")
        .await
        .unwrap()
        .expect("the queued publish job is claimable");
    assert_eq!(claimed.id, "p1");
    assert_eq!(claimed.run_id, "r1");
    assert_eq!(claimed.state, "dispatched");
    assert_eq!(claimed.job_token, "ptoken-p1");

    // A claimed publish job is no longer queued, so a second claim finds nothing.
    assert!(
        db.claim_next_publish_job("2026-06-27T00:00:06Z")
            .await
            .unwrap()
            .is_none(),
        "the publish queue is drained"
    );
}

#[tokio::test]
async fn claim_takes_the_oldest_queued_publish_job_first() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_publish_job(new_publish_job("newer", "r2", "2026-06-27T00:10:00Z"))
        .await
        .unwrap();
    db.enqueue_publish_job(new_publish_job("older", "r1", "2026-06-27T00:00:00Z"))
        .await
        .unwrap();

    let first = db
        .claim_next_publish_job("2026-06-27T01:00:00Z")
        .await
        .unwrap();
    assert_eq!(
        first.unwrap().id,
        "older",
        "oldest enqueued is claimed first"
    );
    let second = db
        .claim_next_publish_job("2026-06-27T01:00:01Z")
        .await
        .unwrap();
    assert_eq!(second.unwrap().id, "newer");
}

#[tokio::test]
async fn ensure_publishable_mirrors_the_publish_gate() {
    let db = Db::connect_in_memory().await.unwrap();

    // A completed run with no review is refused, exactly like `publish`.
    db.push(&record("r1"), &links(), None).await.unwrap();
    let err = db.ensure_publishable("r1").await.unwrap_err();
    assert!(matches!(err, crate::error::BackendError::Unprocessable(_)));

    // With a review it passes (without flipping anything).
    db.add_review("r1", &review()).await.unwrap();
    db.ensure_publishable("r1").await.unwrap();
    assert!(
        !db.get_run("r1").await.unwrap().unwrap().published,
        "the gate does not publish"
    );

    // An infrastructure failure is refused even with a review.
    let mut infra = record("infra");
    infra.status.state = RunState::Infrastructure;
    db.push(&infra, &RunLinks::default(), None).await.unwrap();
    db.add_review("infra", &review()).await.unwrap();
    let err = db.ensure_publishable("infra").await.unwrap_err();
    assert!(matches!(err, crate::error::BackendError::Unprocessable(_)));

    // A publishable failure tier passes with no review at all.
    let mut cat = record("cat");
    cat.status.state = RunState::Catastrophic;
    db.push(&cat, &RunLinks::default(), None).await.unwrap();
    db.ensure_publishable("cat").await.unwrap();

    // An unknown run is not found.
    let err = db.ensure_publishable("nope").await.unwrap_err();
    assert!(matches!(err, crate::error::BackendError::NotFound(_)));
}

#[tokio::test]
async fn complete_publish_job_attaches_links_flips_published_and_marks_the_job() {
    let db = Db::connect_in_memory().await.unwrap();
    // A reviewed but not-yet-published run, pushed with no links.
    db.push(&record("r1"), &RunLinks::default(), None)
        .await
        .unwrap();
    db.add_review("r1", &review()).await.unwrap();
    db.enqueue_publish_job(new_publish_job("p1", "r1", "2026-06-27T00:00:00Z"))
        .await
        .unwrap();

    let outcome = db
        .complete_publish_job(
            "p1",
            "r1",
            Some("https://github.com/x/y"),
            Some("https://abc.pages.dev"),
            "2026-06-27T01:00:00Z",
        )
        .await
        .unwrap();
    assert!(outcome.newly_published);

    // The run is published, the links are on both the sibling and the record blob,
    // and the snapshot is dirty.
    let stored = db.get_run("r1").await.unwrap().unwrap();
    assert!(stored.published);
    assert_eq!(stored.published_at.as_deref(), Some("2026-06-27T01:00:00Z"));
    assert_eq!(
        stored.links.source_repo.as_deref(),
        Some("https://github.com/x/y")
    );
    assert_eq!(
        stored.record.links.playable_build.as_deref(),
        Some("https://abc.pages.dev"),
        "the record blob's links agree with the sibling"
    );
    assert!(db.snapshot_state().await.unwrap().dirty);

    // The publish job is marked succeeded with the same links.
    let job = db.get_publish_job("p1").await.unwrap().unwrap();
    assert_eq!(job.state, "succeeded");
    assert_eq!(job.source_repo.as_deref(), Some("https://github.com/x/y"));
    assert_eq!(job.updated_at, "2026-06-27T01:00:00Z");
}

#[tokio::test]
async fn complete_publish_job_preserves_an_existing_published_at() {
    let db = Db::connect_in_memory().await.unwrap();
    push_review_publish(&db, "r1", "2026-06-27T00:00:00Z").await;
    db.enqueue_publish_job(new_publish_job("p1", "r1", "2026-06-27T00:30:00Z"))
        .await
        .unwrap();

    let outcome = db
        .complete_publish_job("p1", "r1", None, None, "2026-06-27T02:00:00Z")
        .await
        .unwrap();
    assert!(
        !outcome.newly_published,
        "re-publishing an already-published run is not newly published"
    );
    let stored = db.get_run("r1").await.unwrap().unwrap();
    assert_eq!(
        stored.published_at.as_deref(),
        Some("2026-06-27T00:00:00Z"),
        "the first publish's timestamp is preserved"
    );
}

#[tokio::test]
async fn complete_publish_job_is_not_found_for_a_missing_run() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_publish_job(new_publish_job("p1", "missing", "2026-06-27T00:00:00Z"))
        .await
        .unwrap();
    let err = db
        .complete_publish_job("p1", "missing", None, None, "2026-06-27T01:00:00Z")
        .await
        .unwrap_err();
    assert!(matches!(err, crate::error::BackendError::NotFound(_)));
}

#[tokio::test]
async fn set_publish_job_state_records_a_failure_detail() {
    let db = Db::connect_in_memory().await.unwrap();
    db.enqueue_publish_job(new_publish_job("p1", "r1", "2026-06-27T00:00:00Z"))
        .await
        .unwrap();

    let failed = db
        .set_publish_job_state(
            "p1",
            "failed",
            "2026-06-27T01:00:00Z",
            Some("wrangler exploded"),
        )
        .await
        .unwrap()
        .expect("the publish job exists");
    assert_eq!(failed.state, "failed");
    assert_eq!(failed.detail.as_deref(), Some("wrangler exploded"));

    // An unknown publish job yields None rather than erroring.
    assert!(
        db.set_publish_job_state("missing", "failed", "2026-06-27T01:00:00Z", None)
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn referenced_cases_returns_distinct_pairs_including_pending_runs() {
    let db = Db::connect_in_memory().await.unwrap();

    // Two pending runs of pong@v1.0.0 (should collapse to one pair), one run of a
    // different case, and one of a different version of pong.
    db.push(&record("r1"), &links(), None).await.unwrap();
    db.push(&record("r2"), &links(), None).await.unwrap();
    let mut other = record("r3");
    other.subject.test_case_slug = "carom".to_string();
    other.subject.test_case_version = "v2.0.0".to_string();
    db.push(&other, &links(), None).await.unwrap();
    let mut pong_v2 = record("r4");
    pong_v2.subject.test_case_version = "v1.1.0".to_string();
    db.push(&pong_v2, &links(), None).await.unwrap();

    let refs = db.referenced_cases().await.unwrap();
    // Pending runs count — a definition a pushed-but-unpublished run needs must be
    // spared too — and duplicate pairs collapse.
    assert_eq!(
        refs,
        std::collections::HashSet::from([
            ("pong".to_string(), "v1.0.0".to_string()),
            ("pong".to_string(), "v1.1.0".to_string()),
            ("carom".to_string(), "v2.0.0".to_string()),
        ])
    );
}

// --- Model catalog store ---

use std::collections::HashMap;
use test_cabinet_core::metrics::{Cost, TokenCounts, TokenPrices};

/// A model-config write with the common fields defaulted.
fn model_write(slug: &str, name: &str, aliases: &[&str]) -> ModelConfigWrite {
    ModelConfigWrite {
        slug: slug.to_string(),
        display_name: name.to_string(),
        provider: "Anthropic".to_string(),
        provider_logo_url: None,
        provider_logo_svg: None,
        description_md: None,
        openrouter_slug: aliases.first().map(|a| a.to_string()),
        aliases: aliases.iter().map(|a| a.to_string()).collect(),
        now: "2026-07-09T00:00:00Z".to_string(),
    }
}

/// A run record with an explicit model id + harness (and, optionally, token
/// counts), for the derive/normalize tests.
fn run_with_model(
    id: &str,
    model_id: &str,
    harness: HarnessSlug,
    tokens: TokenCounts,
) -> RunRecord {
    let mut r = record(id);
    r.subject.model_id = model_id.to_string();
    r.subject.harness_slug = harness;
    r.metrics.tokens = tokens;
    r
}

#[tokio::test]
async fn model_config_crud_and_alias_conflict() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(model_write(
        "opus",
        "Claude Opus 4.8",
        &["claude-opus-4-8", "anthropic/claude-opus-4.8"],
    ))
    .await
    .unwrap();

    let got = db.get_model_config("opus").await.unwrap().unwrap();
    assert_eq!(got.config.display_name, "Claude Opus 4.8");
    assert_eq!(
        got.aliases,
        vec!["anthropic/claude-opus-4.8", "claude-opus-4-8"]
    );

    // A second model claiming an alias the first owns is a conflict.
    let err = db
        .upsert_model_config(model_write(
            "sonnet",
            "Claude Sonnet 5",
            &["anthropic/claude-opus-4.8"],
        ))
        .await
        .unwrap_err();
    assert!(
        matches!(err, crate::error::BackendError::Conflict(_)),
        "{err:?}"
    );

    // Updating the same model replaces its alias set and keeps created_at.
    db.upsert_model_config(ModelConfigWrite {
        display_name: "Opus (renamed)".to_string(),
        aliases: vec!["claude-opus-4-8".to_string()],
        now: "2026-08-01T00:00:00Z".to_string(),
        ..model_write("opus", "ignored", &[])
    })
    .await
    .unwrap();
    let updated = db.get_model_config("opus").await.unwrap().unwrap();
    assert_eq!(updated.config.display_name, "Opus (renamed)");
    assert_eq!(updated.config.created_at, "2026-07-09T00:00:00Z");
    assert_eq!(updated.aliases, vec!["claude-opus-4-8"]);

    assert!(db.delete_model_config("opus").await.unwrap());
    assert!(db.get_model_config("opus").await.unwrap().is_none());
    assert!(!db.delete_model_config("opus").await.unwrap());
}

#[tokio::test]
async fn price_observations_dedup_and_latest() {
    let db = Db::connect_in_memory().await.unwrap();
    let obs = |input: f64, at: &str| PriceWrite {
        model_id: "x/y".to_string(),
        observed_at: at.to_string(),
        uncached_input: Some(input),
        cached_input: None,
        output: Some(2.0),
        context_length: Some(200_000),
        released_at: None,
    };
    db.insert_price_observation(obs(1.0, "2026-01-01T00:00:00Z"))
        .await
        .unwrap();
    db.insert_price_observation(obs(1.5, "2026-01-02T00:00:00Z"))
        .await
        .unwrap();

    let latest = db.latest_price("x/y").await.unwrap().unwrap();
    assert_eq!(latest.uncached_input, Some(1.5));
    assert_eq!(db.all_model_prices().await.unwrap().len(), 2);
    assert!(db.latest_price("nope").await.unwrap().is_none());
}

#[tokio::test]
async fn distinct_run_models_returns_pairs() {
    let db = Db::connect_in_memory().await.unwrap();
    let z = TokenCounts::default();
    db.push(
        &run_with_model("r1", "anthropic/claude-opus-4.8", HarnessSlug::Kilo, z),
        &links(),
        None,
    )
    .await
    .unwrap();
    db.push(
        &run_with_model("r2", "anthropic/claude-opus-4.8", HarnessSlug::Kilo, z),
        &links(),
        None,
    )
    .await
    .unwrap();
    db.push(
        &run_with_model("r3", "gpt-5.5", HarnessSlug::Codex, z),
        &links(),
        None,
    )
    .await
    .unwrap();
    let mut pairs = db.distinct_run_models().await.unwrap();
    pairs.sort();
    assert_eq!(
        pairs,
        vec![
            ("anthropic/claude-opus-4.8".to_string(), "kilo".to_string()),
            ("gpt-5.5".to_string(), "codex".to_string()),
        ]
        .into_iter()
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>()
    );
}

#[tokio::test]
async fn normalize_free_model_ids_reprices_openrouter_runs_only() {
    let db = Db::connect_in_memory().await.unwrap();
    let tokens = TokenCounts {
        uncached_input: Some(1_000_000),
        cached_input: None,
        output: Some(1_000_000),
        reasoning: None,
    };
    // An OpenRouter-accessed run tagged `:free` with a $0 recorded cost.
    let mut kilo = run_with_model(
        "free-run",
        "deepseek/deepseek-v4:free",
        HarnessSlug::Kilo,
        tokens,
    );
    kilo.metrics.cost = Cost {
        comparable: Some(0.0),
        actual: Some(0.0),
    };
    db.push(&kilo, &links(), None).await.unwrap();
    // A provider-native Codex run whose id happens to contain a colon is left alone.
    let codex = run_with_model("codex-run", "gpt-5.5:preview", HarnessSlug::Codex, tokens);
    db.push(&codex, &links(), None).await.unwrap();

    let mut base_prices = HashMap::new();
    base_prices.insert(
        "deepseek/deepseek-v4".to_string(),
        TokenPrices {
            uncached_input: Some(0.000_002),
            cached_input: None,
            output: Some(0.000_006),
        },
    );
    let rewritten = db.normalize_free_model_ids(&base_prices).await.unwrap();
    assert_eq!(rewritten, 1);

    let run = db.get_run("free-run").await.unwrap().unwrap();
    assert_eq!(run.record.subject.model_id, "deepseek/deepseek-v4");
    // Re-priced at the base rate: 1e6 * 2e-6 + 1e6 * 6e-6 = 8.0, not $0.
    assert_eq!(run.record.metrics.cost.comparable, Some(8.0));

    let codex_run = db.get_run("codex-run").await.unwrap().unwrap();
    assert_eq!(codex_run.record.subject.model_id, "gpt-5.5:preview");

    // Idempotent: a second pass rewrites nothing.
    assert_eq!(db.normalize_free_model_ids(&base_prices).await.unwrap(), 0);
}

/// A run record carrying non-default metrics, for the lifted sort/filter columns.
/// Total tokens sum to 175; comparable cost is `$1.50`; run time is 42s.
fn record_with_metrics(id: &str) -> RunRecord {
    let mut r = record(id);
    r.subject.test_type = test_cabinet_core::TestType::AssetGeneration;
    r.metrics = RunMetrics {
        run_time_seconds: 42.0,
        tokens: TokenCounts {
            uncached_input: Some(100),
            cached_input: Some(20),
            output: Some(50),
            reasoning: Some(5),
        },
        cost: Cost {
            comparable: Some(1.5),
            actual: Some(1.5),
        },
    };
    r
}

/// Read the lifted sort/filter columns off the raw `run` row.
async fn lifted(db: &Db, id: &str) -> run::Model {
    run::Entity::find_by_id(id.to_string())
        .one(db.connection())
        .await
        .unwrap()
        .expect("the run row exists")
}

#[tokio::test]
async fn push_lifts_the_record_sort_columns_and_starts_unrated() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record_with_metrics("r1"), &links(), None)
        .await
        .unwrap();

    let row = lifted(&db, "r1").await;
    assert_eq!(row.test_type, "asset-generation");
    assert_eq!(row.run_time_seconds, 42.0);
    assert_eq!(row.total_tokens, 175);
    assert_eq!(row.cost_comparable, Some(1.5));
    // A freshly pushed run carries no reviews yet.
    assert_eq!(row.rating, None);
    assert_eq!(row.review_count, 0);
}

#[tokio::test]
async fn add_review_maintains_the_lifted_rating_and_count() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record_with_metrics("r1"), &links(), None)
        .await
        .unwrap();

    // First review (great) sets the aggregate; the count reaches one.
    db.add_review("r1", &review_by("u1", Rating::Great))
        .await
        .unwrap();
    let row = lifted(&db, "r1").await;
    assert_eq!(row.rating.as_deref(), Some("great"));
    assert_eq!(row.review_count, 1);

    // A second, harsher review drags the aggregate to the worst rating.
    db.add_review("r1", &review_by("u2", Rating::Scuffed))
        .await
        .unwrap();
    let row = lifted(&db, "r1").await;
    assert_eq!(row.rating.as_deref(), Some("scuffed"));
    assert_eq!(row.review_count, 2);

    // Re-pushing the run refreshes the record-derived columns but preserves the
    // review-derived aggregate (a re-push carries no reviews).
    db.push(&record_with_metrics("r1"), &links(), None)
        .await
        .unwrap();
    let row = lifted(&db, "r1").await;
    assert_eq!(row.rating.as_deref(), Some("scuffed"));
    assert_eq!(row.review_count, 2);
    assert_eq!(row.total_tokens, 175);
}

#[tokio::test]
async fn backfill_sort_columns_fills_rows_from_record_and_reviews() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record_with_metrics("r1"), &links(), None)
        .await
        .unwrap();
    db.add_review("r1", &review_by("u1", Rating::Great))
        .await
        .unwrap();
    db.add_review("r1", &review_by("u2", Rating::Scuffed))
        .await
        .unwrap();
    // A second run with no reviews, to prove the null-rating path is backfilled too.
    db.push(&record_with_metrics("r2"), &links(), None)
        .await
        .unwrap();

    // Simulate rows that predate the sort columns: reset every lifted value to the
    // migration's defaults (empty test_type is the "un-backfilled" sentinel).
    for id in ["r1", "r2"] {
        let mut active = lifted(&db, id).await.into_active_model();
        active.test_type = Set(String::new());
        active.run_time_seconds = Set(0.0);
        active.total_tokens = Set(0);
        active.cost_comparable = Set(None);
        active.rating = Set(None);
        active.review_count = Set(0);
        active.update(db.connection()).await.unwrap();
    }

    let filled = db.backfill_sort_columns().await.unwrap();
    assert_eq!(filled, 2);

    let r1 = lifted(&db, "r1").await;
    assert_eq!(r1.test_type, "asset-generation");
    assert_eq!(r1.run_time_seconds, 42.0);
    assert_eq!(r1.total_tokens, 175);
    assert_eq!(r1.cost_comparable, Some(1.5));
    assert_eq!(r1.rating.as_deref(), Some("scuffed"));
    assert_eq!(r1.review_count, 2);

    let r2 = lifted(&db, "r2").await;
    assert_eq!(r2.total_tokens, 175);
    assert_eq!(r2.rating, None);
    assert_eq!(r2.review_count, 0);

    // Idempotent: a second pass finds nothing un-backfilled.
    assert_eq!(db.backfill_sort_columns().await.unwrap(), 0);
}

// --- list_summaries: filter / free-text / sort / offset + total ---------------

/// Push an unpublished run with the given identity columns and token count (cost
/// `Some(1.0)`, no review) for the filter/free-text tests. Left unpublished so the
/// tests can query it via the [`SummaryState::Unpublished`] slice.
async fn seed_ident(
    db: &Db,
    id: &str,
    test_case: &str,
    model: &str,
    harness: HarnessSlug,
    variant: &str,
    tokens: u64,
) {
    let mut r = record(id);
    r.subject.test_case_slug = test_case.to_string();
    r.subject.model_id = model.to_string();
    r.subject.harness_slug = harness;
    r.subject.variant = variant.to_string();
    r.metrics.run_time_seconds = 1.0;
    r.metrics.tokens = TokenCounts {
        uncached_input: Some(tokens),
        cached_input: None,
        output: None,
        reasoning: None,
    };
    r.metrics.cost = Cost {
        comparable: Some(1.0),
        actual: Some(1.0),
    };
    db.push(&r, &links(), None).await.unwrap();
}

/// Push an unpublished `pong`/`m`/claude/`base` run varying only the sort metrics:
/// token count, comparable cost (`None` = unknown), and rating (`None` = unrated,
/// otherwise one review at that rating). For the sort/offset/total tests.
async fn seed_metric(db: &Db, id: &str, tokens: u64, cost: Option<f64>, rating: Option<Rating>) {
    let mut r = record(id);
    r.subject.test_case_slug = "pong".to_string();
    r.subject.model_id = "m".to_string();
    r.subject.variant = "base".to_string();
    r.metrics.run_time_seconds = 1.0;
    r.metrics.tokens = TokenCounts {
        uncached_input: Some(tokens),
        cached_input: None,
        output: None,
        reasoning: None,
    };
    r.metrics.cost = Cost {
        comparable: cost,
        actual: cost,
    };
    db.push(&r, &links(), None).await.unwrap();
    if let Some(rating) = rating {
        db.add_review(id, &review_by("u1", rating)).await.unwrap();
    }
}

/// The `SummaryFilter` for the unpublished slice (where these tests seed).
fn unpublished_filter() -> SummaryFilter {
    SummaryFilter {
        state: SummaryState::Unpublished,
        ..SummaryFilter::default()
    }
}

/// The run ids of an assembled page, in order.
fn run_ids(runs: &[StoredRun]) -> Vec<String> {
    runs.iter().map(|run| run.record.id.clone()).collect()
}

/// A [`Db::list_summaries`] call over the unpublished slice with the given filter,
/// sort, and direction (no paging), returning just the ordered run ids.
async fn summary_ids(
    db: &Db,
    filter: &SummaryFilter,
    sort: SummarySort,
    dir: SortDir,
) -> Vec<String> {
    let (runs, _) = db.list_summaries(filter, sort, dir, 50, 0).await.unwrap();
    run_ids(&runs)
}

#[tokio::test]
async fn list_summaries_filters_by_test_case_model_and_harness() {
    let db = Db::connect_in_memory().await.unwrap();
    // pong/sonnet/claude, pong/opus/codex, snake/sonnet/claude — distinct axes.
    seed_ident(&db, "a", "pong", "sonnet", HarnessSlug::Claude, "base", 10).await;
    seed_ident(&db, "b", "pong", "opus", HarnessSlug::Codex, "base", 20).await;
    seed_ident(&db, "c", "snake", "sonnet", HarnessSlug::Claude, "base", 30).await;

    // test_case narrows to the two pong runs.
    let filter = SummaryFilter {
        test_case: Some("pong".to_string()),
        ..unpublished_filter()
    };
    let (runs, total) = db
        .list_summaries(&filter, SummarySort::Tokens, SortDir::Asc, 50, 0)
        .await
        .unwrap();
    assert_eq!(run_ids(&runs), ["a", "b"]);
    assert_eq!(total, 2);

    // model narrows to the two sonnet runs.
    let filter = SummaryFilter {
        model: Some("sonnet".to_string()),
        ..unpublished_filter()
    };
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Tokens, SortDir::Asc).await,
        ["a", "c"]
    );

    // harness narrows to the single codex run.
    let filter = SummaryFilter {
        harness: Some("codex".to_string()),
        ..unpublished_filter()
    };
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Tokens, SortDir::Asc).await,
        ["b"]
    );

    // Filters AND together: pong AND sonnet is just `a`.
    let filter = SummaryFilter {
        test_case: Some("pong".to_string()),
        model: Some("sonnet".to_string()),
        ..unpublished_filter()
    };
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Tokens, SortDir::Asc).await,
        ["a"]
    );
}

#[tokio::test]
async fn list_summaries_free_text_matches_across_fields_case_insensitively() {
    let db = Db::connect_in_memory().await.unwrap();
    seed_ident(&db, "a", "pong", "sonnet", HarnessSlug::Claude, "base", 10).await;
    seed_ident(&db, "b", "snake", "opus", HarnessSlug::Codex, "hard", 20).await;
    seed_ident(&db, "c", "tetris", "haiku", HarnessSlug::Claude, "base", 30).await;

    let q = |text: &str| SummaryFilter {
        q: Some(text.to_string()),
        ..unpublished_filter()
    };

    // Model column, matched case-insensitively ("OP" -> opus).
    assert_eq!(
        summary_ids(&db, &q("OP"), SummarySort::Tokens, SortDir::Asc).await,
        ["b"]
    );
    // Variant column.
    assert_eq!(
        summary_ids(&db, &q("hard"), SummarySort::Tokens, SortDir::Asc).await,
        ["b"]
    );
    // Harness column, across two runs.
    assert_eq!(
        summary_ids(&db, &q("claude"), SummarySort::Tokens, SortDir::Asc).await,
        ["a", "c"]
    );
    // Test-case column.
    assert_eq!(
        summary_ids(&db, &q("tetris"), SummarySort::Tokens, SortDir::Asc).await,
        ["c"]
    );
}

#[tokio::test]
async fn list_summaries_sorts_by_tokens_and_reverses_with_dir() {
    let db = Db::connect_in_memory().await.unwrap();
    seed_metric(&db, "a", 10, Some(1.0), None).await;
    seed_metric(&db, "b", 30, Some(1.0), None).await;
    seed_metric(&db, "c", 20, Some(1.0), None).await;

    let filter = unpublished_filter();
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Tokens, SortDir::Asc).await,
        ["a", "c", "b"]
    );
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Tokens, SortDir::Desc).await,
        ["b", "c", "a"]
    );
}

#[tokio::test]
async fn list_summaries_sorts_cost_with_unknown_cost_last_in_both_directions() {
    let db = Db::connect_in_memory().await.unwrap();
    seed_metric(&db, "hi", 1, Some(3.0), None).await;
    seed_metric(&db, "lo", 1, Some(1.0), None).await;
    seed_metric(&db, "no", 1, None, None).await;
    seed_metric(&db, "mid", 1, Some(2.0), None).await;

    let filter = unpublished_filter();
    // Ascending by cost, unknown-cost NULL pinned last.
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Cost, SortDir::Asc).await,
        ["lo", "mid", "hi", "no"]
    );
    // Descending by cost, unknown-cost NULL STILL last.
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Cost, SortDir::Desc).await,
        ["hi", "mid", "lo", "no"]
    );
}

#[tokio::test]
async fn list_summaries_sorts_rating_by_tier_with_unrated_last() {
    let db = Db::connect_in_memory().await.unwrap();
    seed_metric(&db, "flaw", 1, Some(1.0), Some(Rating::Flawless)).await;
    seed_metric(&db, "scuf", 1, Some(1.0), Some(Rating::Scuffed)).await;
    seed_metric(&db, "unr", 1, Some(1.0), None).await;
    seed_metric(&db, "grea", 1, Some(1.0), Some(Rating::Great)).await;

    let filter = unpublished_filter();
    // Ascending by tier rank: best (flawless) first, unrated NULL last.
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Rating, SortDir::Asc).await,
        ["flaw", "grea", "scuf", "unr"]
    );
    // Descending by tier rank: worst (scuffed) first, unrated NULL STILL last —
    // proving NULLs are pinned, not merely lexically ordered.
    assert_eq!(
        summary_ids(&db, &filter, SummarySort::Rating, SortDir::Desc).await,
        ["scuf", "grea", "flaw", "unr"]
    );
}

#[tokio::test]
async fn list_summaries_windows_by_offset_and_limit_with_a_full_total() {
    let db = Db::connect_in_memory().await.unwrap();
    // Five runs with strictly increasing token counts -> a deterministic order.
    for (i, id) in ["a", "b", "c", "d", "e"].iter().enumerate() {
        seed_metric(&db, id, (i as u64 + 1) * 10, Some(1.0), None).await;
    }

    // Page 2 (offset 2, limit 2) of the ascending-by-tokens order is [c, d]; the
    // total reflects every matching row, not the page size.
    let (page, total) = db
        .list_summaries(
            &unpublished_filter(),
            SummarySort::Tokens,
            SortDir::Asc,
            2,
            2,
        )
        .await
        .unwrap();
    assert_eq!(run_ids(&page), ["c", "d"]);
    assert_eq!(total, 5);

    // The tail page is short but the total is unchanged.
    let (tail, total) = db
        .list_summaries(
            &unpublished_filter(),
            SummarySort::Tokens,
            SortDir::Asc,
            2,
            4,
        )
        .await
        .unwrap();
    assert_eq!(run_ids(&tail), ["e"]);
    assert_eq!(total, 5);
}

#[tokio::test]
async fn list_summaries_total_counts_the_filtered_set_not_the_page() {
    let db = Db::connect_in_memory().await.unwrap();
    // Six pong runs and two snake runs; a filtered-and-paged pong query reports
    // total 6 (the filtered count) even though the page holds only 2.
    for i in 0..6 {
        seed_ident(
            &db,
            &format!("p{i}"),
            "pong",
            "m",
            HarnessSlug::Claude,
            "base",
            i,
        )
        .await;
    }
    for i in 0..2 {
        seed_ident(
            &db,
            &format!("s{i}"),
            "snake",
            "m",
            HarnessSlug::Claude,
            "base",
            i,
        )
        .await;
    }

    let filter = SummaryFilter {
        test_case: Some("pong".to_string()),
        ..unpublished_filter()
    };
    let (page, total) = db
        .list_summaries(&filter, SummarySort::Tokens, SortDir::Asc, 2, 0)
        .await
        .unwrap();
    assert_eq!(page.len(), 2);
    assert_eq!(total, 6);
}

#[tokio::test]
async fn reference_build_upserts_in_place_and_reads_back_per_variant() {
    let db = Db::connect_in_memory().await.unwrap();

    // A triple with no deployed build reads back as absent, both singly and in the
    // per-version map.
    assert_eq!(
        db.reference_build("carom", "v1.0.1", "base").await.unwrap(),
        None
    );
    assert!(
        db.reference_builds_for_version("carom", "v1.0.1")
            .await
            .unwrap()
            .is_empty()
    );

    // First deploy records the URL for the variant.
    db.upsert_reference_build(
        "carom",
        "v1.0.1",
        "base",
        "https://carom-base.example.pages.dev",
        "2026-07-09T00:00:00Z",
    )
    .await
    .unwrap();
    assert_eq!(
        db.reference_build("carom", "v1.0.1", "base").await.unwrap(),
        Some("https://carom-base.example.pages.dev".to_string())
    );

    // A re-deploy of the SAME triple upserts the URL in place (composite PK), it
    // does not accumulate a second row.
    db.upsert_reference_build(
        "carom",
        "v1.0.1",
        "base",
        "https://carom-base-2.example.pages.dev",
        "2026-07-09T01:00:00Z",
    )
    .await
    .unwrap();

    // A different variant of the same version is an independent row.
    db.upsert_reference_build(
        "carom",
        "v1.0.1",
        "tight",
        "https://carom-tight.example.pages.dev",
        "2026-07-09T02:00:00Z",
    )
    .await
    .unwrap();

    let map = db
        .reference_builds_for_version("carom", "v1.0.1")
        .await
        .unwrap();
    assert_eq!(map.len(), 2);
    assert_eq!(
        map.get("base").map(String::as_str),
        Some("https://carom-base-2.example.pages.dev")
    );
    assert_eq!(
        map.get("tight").map(String::as_str),
        Some("https://carom-tight.example.pages.dev")
    );

    // A different version does not see this version's rows.
    assert!(
        db.reference_builds_for_version("carom", "v1.0.0")
            .await
            .unwrap()
            .is_empty()
    );
}
