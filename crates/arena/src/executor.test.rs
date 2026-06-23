//! Tests for the capacity guard: a saturated executor rejects the next match with
//! `503`, and recovers once a permit frees.

use axum::http::StatusCode;
use std::time::Duration;

use super::*;

#[tokio::test]
async fn saturated_executor_rejects_then_recovers() {
    let executor = MatchExecutor::new(1);

    // Hold the single permit inside a blocking match until told to release. A
    // synchronous channel lets the blocking closure park without touching the async
    // runtime.
    let (started_tx, started_rx) = std::sync::mpsc::channel::<()>();
    let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
    let executor_for_task = executor.clone();
    let holder = tokio::spawn(async move {
        executor_for_task
            .run_match(move || {
                // Signal the permit is held, then block until released.
                started_tx.send(()).unwrap();
                release_rx.recv().unwrap();
            })
            .await
            .unwrap();
    });

    // Wait until the holder is actually running (permit acquired).
    tokio::task::spawn_blocking(move || started_rx.recv().unwrap())
        .await
        .unwrap();

    // The next acquisition must be rejected with a 503 while the permit is held.
    let rejected = executor.run_match(|| ()).await;
    let err = rejected.expect_err("a saturated executor rejects the next match");
    assert_eq!(err.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(err.code, "at_capacity");

    // Release the held permit and let the holder finish.
    release_tx.send(()).unwrap();
    holder.await.unwrap();

    // The slot is free again, so a fresh match runs to completion.
    let value = executor
        .run_match(|| 7)
        .await
        .expect("a freed permit admits the next match");
    assert_eq!(value, 7);
}

#[tokio::test]
async fn acquire_holds_a_permit_until_dropped() {
    let executor = MatchExecutor::new(1);

    // A tournament holds its permit for the whole drive.
    let permit = executor.acquire().expect("the first acquire succeeds");

    // While held, both a match and another tournament are rejected.
    assert_eq!(
        executor.run_match(|| ()).await.unwrap_err().status,
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert!(executor.acquire().is_err());

    // Dropping the permit frees the slot.
    drop(permit);
    // Give the runtime a moment to register the released permit.
    tokio::time::sleep(Duration::from_millis(10)).await;
    assert!(executor.acquire().is_ok());
}
