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

fn review() -> StoredReview {
    use test_cabinet_core::review::VerdictStatus;
    StoredReview {
        ratings: vec![DomainRating {
            domain: "gameplay".to_string(),
            rating: Rating::Great,
        }],
        writeup: "Plays well.".to_string(),
        checklist: vec![ReviewVerdict {
            id: "ball-spin".to_string(),
            status: VerdictStatus::Pass,
            note: Some("spin curves the ball".to_string()),
        }],
    }
}

fn links() -> RunLinks {
    RunLinks {
        source_repo: Some("https://github.com/x/y".to_string()),
        playable_build: Some("https://abc.pages.dev".to_string()),
    }
}

#[tokio::test]
async fn publish_then_get_round_trips_with_links_populated() {
    let db = Db::connect_in_memory().await.unwrap();
    let outcome = db
        .publish(
            &record("r1"),
            &review(),
            &links(),
            "2026-06-17T21:40:00Z",
            None,
        )
        .await
        .unwrap();
    assert!(outcome.newly_published);

    let stored = db.get_run("r1").await.unwrap().unwrap();
    assert_eq!(stored.review.ratings, review().ratings);
    // The checklist verdicts round-trip through the JSON column.
    assert_eq!(stored.review.checklist, review().checklist);
    // The stored record carries the resolved links, even though the submitted
    // record's links were empty.
    assert_eq!(
        stored.record.links.playable_build.as_deref(),
        Some("https://abc.pages.dev")
    );
    assert_eq!(stored.published_at, "2026-06-17T21:40:00Z");
}

#[tokio::test]
async fn publish_stores_events_json_and_get_run_returns_it() {
    let db = Db::connect_in_memory().await.unwrap();
    let events = r#"[{"timestamp":"2026-06-17T20:41:00Z","type":"agent","message":"hi"}]"#;
    db.publish(
        &record("r1"),
        &review(),
        &links(),
        "2026-06-17T21:40:00Z",
        Some(events),
    )
    .await
    .unwrap();
    let stored = db.get_run("r1").await.unwrap().unwrap();
    assert_eq!(stored.events_json.as_deref(), Some(events));

    // A run published without an event log stores NULL and reads back as None.
    db.publish(
        &record("r2"),
        &review(),
        &links(),
        "2026-06-17T21:41:00Z",
        None,
    )
    .await
    .unwrap();
    assert_eq!(db.get_run("r2").await.unwrap().unwrap().events_json, None);
}

#[tokio::test]
async fn republish_is_idempotent_and_keeps_first_published_at() {
    let db = Db::connect_in_memory().await.unwrap();
    db.publish(
        &record("r1"),
        &review(),
        &links(),
        "2026-06-17T21:40:00Z",
        None,
    )
    .await
    .unwrap();

    let updated_review = StoredReview {
        ratings: vec![DomainRating {
            domain: "gameplay".to_string(),
            rating: Rating::Flawless,
        }],
        writeup: "Even better on a second look.".to_string(),
        checklist: vec![],
    };
    let outcome = db
        .publish(
            &record("r1"),
            &updated_review,
            &links(),
            "2026-06-18T09:00:00Z",
            None,
        )
        .await
        .unwrap();
    assert!(!outcome.newly_published);

    let stored = db.get_run("r1").await.unwrap().unwrap();
    assert_eq!(stored.review.ratings, updated_review.ratings);
    // published_at is preserved from the first publish.
    assert_eq!(stored.published_at, "2026-06-17T21:40:00Z");
    assert_eq!(db.run_count().await.unwrap(), 1);
}

#[tokio::test]
async fn list_runs_orders_newest_first_and_paginates() {
    let db = Db::connect_in_memory().await.unwrap();
    db.publish(
        &record("r1"),
        &review(),
        &links(),
        "2026-06-17T10:00:00Z",
        None,
    )
    .await
    .unwrap();
    db.publish(
        &record("r2"),
        &review(),
        &links(),
        "2026-06-17T11:00:00Z",
        None,
    )
    .await
    .unwrap();
    db.publish(
        &record("r3"),
        &review(),
        &links(),
        "2026-06-17T12:00:00Z",
        None,
    )
    .await
    .unwrap();

    let (page, next) = db.list_runs(2, None).await.unwrap();
    assert_eq!(page.len(), 2);
    assert_eq!(page[0].record.id, "r3");
    assert_eq!(page[1].record.id, "r2");
    let next = next.expect("a next cursor");

    let (page2, next2) = db.list_runs(2, Some(&next)).await.unwrap();
    assert_eq!(page2.len(), 1);
    assert_eq!(page2[0].record.id, "r1");
    assert!(next2.is_none());
}

#[tokio::test]
async fn publish_marks_snapshot_dirty() {
    let db = Db::connect_in_memory().await.unwrap();
    assert!(!db.snapshot_state().await.unwrap().dirty);
    db.publish(
        &record("r1"),
        &review(),
        &links(),
        "2026-06-17T10:00:00Z",
        None,
    )
    .await
    .unwrap();
    assert!(db.snapshot_state().await.unwrap().dirty);

    db.mark_uploaded("2026-06-17T10:05:00Z", 1).await.unwrap();
    let state = db.snapshot_state().await.unwrap();
    assert!(!state.dirty);
    assert_eq!(state.last_run_count, Some(1));
    assert_eq!(state.last_uploaded.as_deref(), Some("2026-06-17T10:05:00Z"));
}

#[tokio::test]
async fn all_runs_returns_everything_newest_first() {
    let db = Db::connect_in_memory().await.unwrap();
    db.publish(
        &record("r1"),
        &review(),
        &links(),
        "2026-06-17T10:00:00Z",
        None,
    )
    .await
    .unwrap();
    db.publish(
        &record("r2"),
        &review(),
        &links(),
        "2026-06-17T11:00:00Z",
        None,
    )
    .await
    .unwrap();
    let all = db.all_runs().await.unwrap();
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].record.id, "r2");
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
                points: 20,
                wins: 1,
                losses: 0,
                draws: 0,
                rank: 1,
            },
            Standing {
                participant_id: "random".to_string(),
                points: 3,
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
