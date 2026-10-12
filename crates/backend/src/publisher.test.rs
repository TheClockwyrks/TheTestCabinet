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
            engine_slug: "none".to_string(),
            engine_version: None,
            model_id: "m".to_string(),
            gg_capability_set: None,
            gg_summary: None,
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
        tool_calls: Default::default(),
        game_jam_prior_entries: Vec::new(),
        seed_commit: None,
        code_analysis: None,
        toolchain: None,
        showcase: None,
    }
}

/// Push, review, and publish a run so it lands in the published set the snapshot
/// is built from.
async fn seed_published(db: &Db, id: &str, published_at: &str) {
    db.push(&record(id), &RunLinks::default(), None, None)
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
            aesthetics: vec![],
            aesthetic: None,
            writeup: "ok".to_string(),
            checklist: vec![],
            reviewed_at: "2026-06-17T22:00:00Z".to_string(),
            edited_at: None,
            revisions: Vec::new(),
        },
        None,
        None,
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
    // A short quiet window, so the loop acts within the test.
    let publisher = dev_publisher_on(&dir, &db, Duration::from_millis(10));
    (dir, publisher, db)
}

/// A dev-mode publisher over an existing database and store directory, releasing
/// a batch below the threshold after `quiet_window`. Building a second one on the
/// same database is a backend that restarted.
fn dev_publisher_on(dir: &TempDir, db: &Arc<Db>, quiet_window: Duration) -> Publisher {
    let store = DefinitionStore::open(dir.path().join("store")).unwrap();
    Publisher::new(
        Arc::clone(db),
        store,
        None,
        None,
        None,
        Arc::new(test_cabinet_core::AccountsClient::new(
            "http://auth.invalid",
        )),
        PublisherTiming {
            // No hold between releases, so the loop acts within the test.
            batch: BatchTiming {
                threshold: 20,
                quiet_window,
                min_interval: Duration::ZERO,
                refresh_timeout: Duration::from_secs(30 * 60),
            },
            // Retention is irrelevant to the dev publisher: with no R2 there is no
            // bucket to prune.
            snapshot_retention: Duration::from_secs(24 * 3600),
        },
    )
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

#[tokio::test]
async fn coalesced_refresher_folds_a_burst_into_one_clear() {
    let (_dir, publisher, db) = dev_publisher().await;
    let mut refreshes = publisher.refreshes();
    let handle = publisher.spawn();

    // A burst of three publishes, each counting one request.
    for i in 0..3 {
        seed_published(&db, &format!("r{i}"), &format!("2026-06-17T21:4{i}:00Z")).await;
        publisher.queue_refresh();
    }

    // The batching loop folds the burst, converging on a clean snapshot over
    // the full three-run set. Each check follows a refresh the loop finished, and
    // waiting on the converged count rather than the first cleared flag tolerates
    // an early refresh that snapshots a row mid-burst — the loop always runs a
    // final refresh once the last publish has landed. A loop that never got there
    // would leave this waiting, and nextest would stop the test.
    let mut state = db.snapshot_state().await.unwrap();
    while state.dirty || state.last_run_count != Some(3) {
        refreshes
            .changed()
            .await
            .expect("the refresher is still running");
        state = db.snapshot_state().await.unwrap();
    }
    assert!(!state.dirty, "the coalesced refresh cleared the dirty flag");
    assert_eq!(state.last_run_count, Some(3));

    handle.join().await;
}

#[tokio::test]
async fn a_request_that_set_no_dirty_flag_is_recorded_and_survives_a_restart() {
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    // A quiet window the test never reaches, so the request stays pending.
    let publisher = dev_publisher_on(&dir, &db, Duration::from_secs(24 * 3600));
    let mut recordings = publisher.recordings();
    let refreshes = publisher.refreshes();
    let handle = publisher.spawn();

    // A catalog change requests a refresh without touching the dirty flag, which
    // only a publish sets in its own transaction.
    assert!(!db.snapshot_state().await.unwrap().dirty);
    publisher.queue_refresh();
    recordings
        .changed()
        .await
        .expect("the refresher is still running");
    assert!(
        db.snapshot_state().await.unwrap().dirty,
        "the pending request is recorded in the database"
    );

    // The backend stops with the request unreleased.
    handle.join().await;
    assert!(!refreshes.has_changed().unwrap_or(false));
    assert!(db.snapshot_state().await.unwrap().dirty);

    // The one that starts on the same database releases it, with no new request.
    let restarted = dev_publisher_on(&dir, &db, Duration::from_secs(24 * 3600));
    let mut refreshes = restarted.refreshes();
    let handle = restarted.spawn();
    refreshes
        .changed()
        .await
        .expect("the refresher is still running");
    let state = db.snapshot_state().await.unwrap();
    assert!(!state.dirty, "the refresh cleared the recorded request");
    assert_eq!(state.last_run_count, Some(0));

    handle.join().await;
}

#[test]
fn a_recovery_waits_out_what_the_last_upload_left_of_the_minimum_interval() {
    let now = OffsetDateTime::parse("2026-10-12T12:00:00Z", &Rfc3339).unwrap();
    let ten_minutes = Duration::from_secs(600);
    let hold = |uploaded: Option<&str>| recovery_hold(uploaded, now, ten_minutes);

    // Four minutes ago leaves six.
    assert_eq!(hold(Some("2026-10-12T11:56:00Z")), Duration::from_secs(360));
    // Longer ago than the interval, never uploaded, or unreadable: no wait.
    assert_eq!(hold(Some("2026-10-12T11:00:00Z")), Duration::ZERO);
    assert_eq!(hold(None), Duration::ZERO);
    assert_eq!(hold(Some("yesterday")), Duration::ZERO);
    // An upload stamped in the future is a clock that moved, not a reason to wait.
    assert_eq!(hold(Some("2026-10-12T13:00:00Z")), Duration::ZERO);
    // No minimum interval, no wait.
    assert_eq!(
        recovery_hold(Some("2026-10-12T11:59:59Z"), now, Duration::ZERO),
        Duration::ZERO
    );
}

#[tokio::test]
async fn a_refresh_pending_at_the_last_stop_is_released_at_startup() {
    let (_dir, publisher, db) = dev_publisher().await;
    seed_published(&db, "r1", "2026-06-17T21:40:00Z").await;
    assert!(db.snapshot_state().await.unwrap().dirty);

    // No request is queued: the persisted dirty flag alone releases a refresh.
    let mut refreshes = publisher.refreshes();
    let handle = publisher.spawn();
    refreshes
        .changed()
        .await
        .expect("the refresher is still running");
    let state = db.snapshot_state().await.unwrap();
    assert!(!state.dirty);
    assert_eq!(state.last_run_count, Some(1));

    handle.join().await;
}
