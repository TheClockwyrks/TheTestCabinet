//! Tests for the periodic check that requests a refresh while published runs
//! wait on a media confirmation, the schedule a run a refresh left unconfirmed
//! is retried on, and what a refresh that fails part-way leaves for the next.

use std::sync::Arc;

use tempfile::TempDir;

use super::tests::{
    BUCKET, Bucket, Trees, bucket_publisher, run_columns, seed_published, seed_published_with_proof,
};
use super::*;

#[tokio::test(start_paused = true)]
async fn an_unconfirmed_run_is_retried_on_a_delay_that_doubles_to_a_day() {
    let start = tokio::time::Instant::now();
    let mut retry = UnconfirmedRetry::default();

    // The first check that finds a run unconfirmed asks at once.
    assert!(retry.due(1, start));
    // The next is due one check interval later, and not before.
    assert!(!retry.due(1, start + CONFIRMATION_RECHECK - Duration::from_secs(1)));
    assert!(retry.due(1, start + CONFIRMATION_RECHECK));
    // Then two intervals after that one, and so on.
    let second = start + CONFIRMATION_RECHECK;
    assert!(!retry.due(3, second + CONFIRMATION_RECHECK));
    assert!(retry.due(3, second + CONFIRMATION_RECHECK * 2));

    // However long runs stay unconfirmed, the delay stops at a day.
    let mut at = second + CONFIRMATION_RECHECK * 2;
    let mut longest = Duration::ZERO;
    for _ in 0..20 {
        let asked = at;
        while !retry.due(1, at) {
            at += CONFIRMATION_RECHECK;
        }
        longest = longest.max(at - asked);
    }
    assert_eq!(longest, UNCONFIRMED_RETRY_MAX);

    // No run left unconfirmed starts the schedule over.
    assert!(!retry.due(0, at));
    assert_eq!(retry, UnconfirmedRetry::default());
    assert!(retry.due(1, at));
}

#[tokio::test]
async fn a_check_requests_a_refresh_for_runs_no_refresh_has_evaluated() {
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    let trees = Arc::new(Trees::default());
    seed_published(&db, "a", "2026-06-17T21:40:00Z").await;
    let publisher = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;
    let mut retry = UnconfirmedRetry::default();
    let now = tokio::time::Instant::now();

    // Unevaluated runs are asked for at every check: one refresh evaluates them
    // all, and until it has run there is nothing to back off from.
    assert!(
        publisher
            .inner
            .request_pending_confirmation(&mut retry, now)
            .await
    );
    assert!(
        publisher
            .inner
            .request_pending_confirmation(&mut retry, now)
            .await
    );
    assert_eq!(publisher.inner.batcher.pending(), 2);

    // Once a refresh has confirmed the run, a check asks for nothing.
    publisher.refresh_now().await.unwrap();
    assert!(run_columns(&db, "a").await.media_confirmed_at.is_some());
    let after = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;
    assert!(
        !after
            .inner
            .request_pending_confirmation(&mut retry, now)
            .await
    );
    assert_eq!(after.inner.batcher.pending(), 0);
}

#[tokio::test]
async fn a_check_retries_a_run_a_refresh_left_unconfirmed_on_the_schedule() {
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    let trees = Arc::new(Trees::default());
    seed_published_with_proof(&db, "proven").await;
    // The artifact service is down, so the refresh evaluates the run and cannot
    // confirm it.
    trees.set_down(true);
    let publisher = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;
    publisher.refresh_now().await.unwrap();
    let row = run_columns(&db, "proven").await;
    assert!(row.media_checked_at.is_some());
    assert_eq!(row.media_confirmed_at, None);
    assert_eq!(db.published_runs_unchecked(BUCKET).await.unwrap(), 0);
    assert_eq!(db.published_runs_unconfirmed(BUCKET).await.unwrap(), 1);

    let checker = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;
    let mut retry = UnconfirmedRetry::default();
    let now = tokio::time::Instant::now();
    let inner = &checker.inner;
    assert!(inner.request_pending_confirmation(&mut retry, now).await);
    // The check ten minutes on would be the second request; one sooner is not.
    assert!(
        !inner
            .request_pending_confirmation(&mut retry, now + Duration::from_secs(60))
            .await
    );
    assert!(
        inner
            .request_pending_confirmation(&mut retry, now + CONFIRMATION_RECHECK)
            .await
    );
    assert_eq!(inner.batcher.pending(), 2);

    // The service answers again; the refresh confirms the run and the checks
    // go quiet.
    trees.set_down(false);
    trees.store("proven", &[("proof/title.png", b"png")]);
    checker.refresh_now().await.unwrap();
    assert!(
        run_columns(&db, "proven")
            .await
            .media_confirmed_at
            .is_some()
    );
    assert_eq!(db.published_runs_unconfirmed(BUCKET).await.unwrap(), 0);
}

#[tokio::test]
async fn a_check_requests_nothing_where_no_confirmation_is_recorded() {
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    seed_published(&db, "a", "2026-06-17T21:40:00Z").await;
    // The deployment records no confirmations: nothing reclaims on one.
    let off = bucket_publisher(&dir, &db, &bucket, None).await;
    let mut retry = UnconfirmedRetry::default();

    assert!(
        !off.inner
            .request_pending_confirmation(&mut retry, tokio::time::Instant::now())
            .await
    );
    assert_eq!(off.inner.batcher.pending(), 0);
}

#[tokio::test]
async fn a_refresh_that_fails_keeps_the_run_files_it_had_already_uploaded() {
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    let trees = Arc::new(Trees::default());
    seed_published_with_proof(&db, "proven").await;
    trees.store("proven", &[("proof/title.png", b"png")]);
    let publisher = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;
    // The bucket takes the run's own objects and refuses the snapshot's.
    *bucket.refused.lock().unwrap() = Some("snapshots/".to_string());

    publisher
        .refresh_now()
        .await
        .expect_err("the refresh fails");

    const TITLE: &str = "media/runs/proven/proof/title.png";
    assert!(bucket.keys().iter().any(|key| key == TITLE));
    assert!(!bucket.keys().iter().any(|key| key == "index.json"));
    assert_eq!(run_columns(&db, "proven").await.media_confirmed_at, None);

    // The next refresh finds the still in the bucket's listing and uploads only
    // what is left.
    *bucket.refused.lock().unwrap() = None;
    publisher.refresh_now().await.unwrap();

    let puts = bucket.put_keys.lock().unwrap().clone();
    assert_eq!(
        puts.iter().filter(|key| *key == TITLE).count(),
        1,
        "{puts:?}"
    );
    assert!(bucket.keys().iter().any(|key| key == "index.json"));
    assert!(
        run_columns(&db, "proven")
            .await
            .media_confirmed_at
            .is_some()
    );
}
