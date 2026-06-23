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
        variant: "base".to_string(),
        harness_slug: "claude".to_string(),
        model_id: "claude-sonnet-4-5".to_string(),
        job_token: format!("token-{id}"),
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
    assert_eq!(first.unwrap().id, "older", "oldest enqueued is claimed first");
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
    assert_eq!(ids, vec!["a", "c"], "terminal jobs are excluded, oldest first");
}

#[tokio::test]
async fn publish_refuses_a_non_completed_run_even_with_a_review() {
    let db = Db::connect_in_memory().await.unwrap();
    // A retained-but-unevaluable run: stored and reviewable, but not yet
    // publishable (the interim "completed only" guard).
    let mut rec = record("u1");
    rec.status.state = RunState::Unevaluable;
    db.push(&rec, &RunLinks::default(), None).await.unwrap();
    db.add_review("u1", &review()).await.unwrap();

    let err = db
        .publish("u1", "2026-06-23T00:00:00Z")
        .await
        .expect_err("an unevaluable run must not be publishable");
    assert!(
        matches!(err, crate::error::BackendError::Unprocessable(_)),
        "got {err:?}"
    );
}
