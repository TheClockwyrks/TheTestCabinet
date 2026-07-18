use super::*;
use tempfile::TempDir;

use test_cabinet_core::metrics::RunMetrics;
use test_cabinet_core::review::{DomainRating, Rating};
use test_cabinet_core::run_record::{
    HarnessSlug, RunEnvironment, RunLinks, RunRecord, RunState, RunStatus, RunSubject, RunTooling,
};
use test_cabinet_core::validation::ValidationSummary;

use crate::db::StoredReview;

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
            harness_version: None,
            orchestrator_slug: "one-shot".to_string(),
            model_id: "m".to_string(),
        },
        tooling: RunTooling::default(),
        environment: RunEnvironment {
            os: "Debian".to_string(),
            container_image: "img".to_string(),
            node_version: None,
            auth_mode: test_cabinet_core::AuthMode::ApiKey,
        },
        metrics: RunMetrics::default(),
        validation: ValidationSummary::default(),
        links: RunLinks::default(),
        status: RunStatus {
            state: RunState::Completed,
            detail: None,
        },
        game_jam_readme: None,
    }
}

/// Push, review, and publish a run so it lands in the published set the snapshot
/// is built from.
async fn seed_published(db: &Db, id: &str, published_at: &str) {
    db.push(&record(id), &RunLinks::default(), None)
        .await
        .unwrap();
    db.add_review(
        id,
        &StoredReview {
            reviewer: crate::db::Reviewer {
                user_id: "u1".to_string(),
                username: "ada".to_string(),
                display_name: "Ada".to_string(),
            },
            ratings: vec![DomainRating {
                domain: "gameplay".to_string(),
                rating: Rating::Great,
            }],
            writeup: "ok".to_string(),
            checklist: vec![],
            reviewed_at: "2026-06-17T22:00:00Z".to_string(),
        },
    )
    .await
    .unwrap();
    db.publish(id, published_at).await.unwrap();
}

/// Build a publisher in dev mode (no R2, no hook): an in-memory database and a
/// fresh temp definition store. The `TempDir` is returned so the store outlives
/// the publisher.
async fn dev_publisher() -> (TempDir, Publisher, Arc<Db>) {
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let store = DefinitionStore::open(dir.path().join("store")).unwrap();
    let publisher = Publisher::new(
        Arc::clone(&db),
        store,
        None,
        None,
        None,
        Arc::new(test_cabinet_core::AccountsClient::new(
            "http://auth.invalid",
        )),
        Duration::from_millis(10),
    );
    (dir, publisher, db)
}

#[tokio::test]
async fn forced_refresh_regenerates_and_clears_dirty_in_dev_mode() {
    let (_dir, publisher, db) = dev_publisher().await;
    seed_published(&db, "r1", "2026-06-17T21:40:00Z").await;
    assert!(db.snapshot_state().await.unwrap().dirty);

    let outcome = publisher.refresh_now().await.unwrap();
    assert_eq!(outcome.run_count, 1);
    // No hook configured in dev mode.
    assert!(!outcome.deploy_hook_fired);
    // The refresh clears the dirty flag and records the run count.
    let state = db.snapshot_state().await.unwrap();
    assert!(!state.dirty);
    assert_eq!(state.last_run_count, Some(1));
}

// Real time (not the paused clock): the async SQLite pool the refresher drives
// does its work on a blocking thread, which a paused clock cannot advance through
// deterministically. The coalescing window is only 10ms (see `dev_publisher`), so
// a generous real-time poll for the cleared flag is both reliable and fast.
#[tokio::test]
async fn coalesced_refresher_folds_a_burst_into_one_clear() {
    let (_dir, publisher, db) = dev_publisher().await;
    let handle = publisher.spawn();

    // A burst of three publishes, each waking the debounce loop.
    for i in 0..3 {
        seed_published(&db, &format!("r{i}"), &format!("2026-06-17T21:4{i}:00Z")).await;
        publisher.queue_refresh();
    }

    // The debounce loop coalesces the burst, converging on a clean snapshot over
    // the full three-run set. Poll up to ~2s (far longer than the 10ms window) for
    // that terminal state. Waiting on the converged count, rather than the first
    // cleared flag, tolerates an early refresh that snapshots a row mid-burst —
    // the loop always runs a final refresh once the last publish has landed.
    let mut state = db.snapshot_state().await.unwrap();
    for _ in 0..100 {
        if !state.dirty && state.last_run_count == Some(3) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
        state = db.snapshot_state().await.unwrap();
    }
    assert!(!state.dirty, "the coalesced refresh cleared the dirty flag");
    assert_eq!(state.last_run_count, Some(3));

    handle.join().await;
}
