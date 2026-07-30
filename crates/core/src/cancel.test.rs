use super::*;

#[test]
fn a_fresh_latch_is_not_raised() {
    assert!(!RunCancellation::new().is_canceled());
    // The default is the "nothing can cancel this run" shape, so it must read the same.
    assert!(!RunCancellation::default().is_canceled());
}

#[test]
fn cancel_latches_and_is_idempotent() {
    let cancel = RunCancellation::new();
    cancel.cancel();
    assert!(cancel.is_canceled());
    // Latching: it only ever goes one way, and a duplicate observation is a no-op.
    cancel.cancel();
    assert!(cancel.is_canceled());
}

#[test]
fn a_clone_shares_the_same_latch() {
    // The driver's watcher and the engine stage that acts on the signal hold clones, so
    // raising either must be seen by both.
    let cancel = RunCancellation::new();
    let clone = cancel.clone();
    cancel.cancel();
    assert!(clone.is_canceled());
}

#[tokio::test]
async fn canceled_resolves_immediately_when_already_raised() {
    // A caller that starts awaiting after the kill must not park forever on a signal
    // that has already been sent.
    let cancel = RunCancellation::new();
    cancel.cancel();
    tokio::time::timeout(std::time::Duration::from_secs(5), cancel.canceled())
        .await
        .expect("an already-raised latch resolves at once");
}

#[tokio::test]
async fn canceled_resolves_when_raised_afterwards() {
    let cancel = RunCancellation::new();
    let waiter = cancel.clone();
    let task = tokio::spawn(async move { waiter.canceled().await });
    // Let the waiter register, then raise the latch from here.
    tokio::task::yield_now().await;
    cancel.cancel();
    tokio::time::timeout(std::time::Duration::from_secs(5), task)
        .await
        .expect("the waiter wakes on the raise")
        .expect("the waiter task did not panic");
}

#[tokio::test]
async fn canceled_does_not_resolve_while_the_run_is_live() {
    // The engine races this against the session itself, so a latch that resolved early
    // would kill every run at its first await.
    let cancel = RunCancellation::new();
    let raced = tokio::time::timeout(std::time::Duration::from_millis(50), cancel.canceled()).await;
    assert!(raced.is_err(), "an un-raised latch must never resolve");
}
