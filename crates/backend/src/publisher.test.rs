use super::*;
use tempfile::TempDir;

use test_cabinet_core::metrics::RunMetrics;
use test_cabinet_core::review::Rating;
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
            variant: "base".to_string(),
            harness_slug: HarnessSlug::Claude,
            harness_version: None,
            model_id: "m".to_string(),
        },
        tooling: RunTooling::default(),
        environment: RunEnvironment {
            os: "Debian".to_string(),
            container_image: "img".to_string(),
            node_version: None,
        },
        metrics: RunMetrics::default(),
        validation: ValidationSummary::default(),
        links: RunLinks::default(),
        status: RunStatus {
            state: RunState::Completed,
            detail: None,
        },
    }
}

/// Build a publisher in dev mode (no R2, no hook) over fresh temp paths.
fn dev_publisher() -> (TempDir, Publisher, Arc<Db>) {
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::open(dir.path().join("db.sqlite")).unwrap());
    let store = DefinitionStore::open(dir.path().join("store")).unwrap();
    let publisher = Publisher::new(
        Arc::clone(&db),
        store,
        None,
        None,
        Duration::from_millis(10),
    );
    (dir, publisher, db)
}

#[tokio::test]
async fn forced_refresh_regenerates_and_clears_dirty_in_dev_mode() {
    let (_dir, publisher, db) = dev_publisher();
    db.publish(
        &record("r1"),
        &StoredReview {
            rating: Rating::Great,
            writeup: "ok".to_string(),
            checklist: vec![],
        },
        &RunLinks::default(),
        "2026-06-17T21:40:00Z",
        None,
    )
    .unwrap();
    assert!(db.snapshot_state().unwrap().dirty);

    let outcome = publisher.refresh_now().await.unwrap();
    assert_eq!(outcome.run_count, 1);
    // No hook configured in dev mode.
    assert!(!outcome.deploy_hook_fired);
    // The refresh clears the dirty flag and records the run count.
    let state = db.snapshot_state().unwrap();
    assert!(!state.dirty);
    assert_eq!(state.last_run_count, Some(1));
}

#[tokio::test(start_paused = true)]
async fn coalesced_refresher_folds_a_burst_into_one_clear() {
    let (_dir, publisher, db) = dev_publisher();
    let handle = publisher.spawn();

    // A burst of three publishes, each waking the debounce loop.
    for i in 0..3 {
        db.publish(
            &record(&format!("r{i}")),
            &StoredReview {
                rating: Rating::Great,
                writeup: "ok".to_string(),
                checklist: vec![],
            },
            &RunLinks::default(),
            &format!("2026-06-17T21:4{i}:00Z"),
            None,
        )
        .unwrap();
        publisher.queue_refresh();
    }
    assert!(db.snapshot_state().unwrap().dirty);

    // Advance past the coalescing window; the debounce loop fires exactly one
    // refresh, which clears the dirty flag over the full set.
    tokio::time::advance(Duration::from_millis(50)).await;
    // Yield so the spawned task runs to completion of the refresh.
    tokio::task::yield_now().await;
    tokio::time::advance(Duration::from_millis(50)).await;
    tokio::task::yield_now().await;

    // Eventually the dirty flag is cleared and all three runs are accounted for.
    for _ in 0..10 {
        if !db.snapshot_state().unwrap().dirty {
            break;
        }
        tokio::time::advance(Duration::from_millis(20)).await;
        tokio::task::yield_now().await;
    }
    let state = db.snapshot_state().unwrap();
    assert!(!state.dirty, "the coalesced refresh cleared the dirty flag");
    assert_eq!(state.last_run_count, Some(3));

    handle.join().await;
}
