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
    let mut canceled = std::pin::pin!(cancel.canceled());
    let mut context = std::task::Context::from_waker(std::task::Waker::noop());
    assert!(
        std::future::Future::poll(canceled.as_mut(), &mut context).is_ready(),
        "an already-raised latch resolves on its first poll"
    );
}

#[tokio::test]
async fn canceled_resolves_when_raised_afterwards() {
    let cancel = RunCancellation::new();
    let waiter = cancel.clone();
    let task = tokio::spawn(async move { waiter.canceled().await });
    // Let the waiter register, then raise the latch from here.
    tokio::task::yield_now().await;
    cancel.cancel();
    // A waiter the raise did not wake would hang here, and nextest would stop the test.
    task.await.expect("the waiter task did not panic");
}

#[tokio::test]
async fn canceled_does_not_resolve_while_the_run_is_live() {
    // The engine races this against the session itself, so a latch that resolved early
    // would kill every run at its first await.
    let cancel = RunCancellation::new();
    let mut canceled = std::pin::pin!(cancel.canceled());
    let mut context = std::task::Context::from_waker(std::task::Waker::noop());
    assert!(
        std::future::Future::poll(canceled.as_mut(), &mut context).is_pending(),
        "an un-raised latch must never resolve"
    );
}
