use super::Readiness;

#[test]
fn an_empty_store_starts_unready() {
    assert!(!Readiness::new(false).is_ready());
}

#[test]
fn a_populated_store_starts_ready() {
    // A store that survived into this process — a durable volume, or a restart
    // that kept /state — has nothing to wait for.
    assert!(Readiness::new(true).is_ready());
}

#[test]
fn a_completed_ingest_makes_an_empty_store_ready() {
    let readiness = Readiness::new(false);
    readiness.mark_store_populated();
    assert!(readiness.is_ready());
}

#[test]
fn marking_populated_is_idempotent() {
    let readiness = Readiness::new(false);
    readiness.mark_store_populated();
    readiness.mark_store_populated();
    assert!(readiness.is_ready());
}

#[test]
fn clones_share_one_flag() {
    // The ingest handler holds a clone of the latch the probe reads; marking
    // through either must be visible to the other.
    let readiness = Readiness::new(false);
    let clone = readiness.clone();
    assert!(!clone.is_ready());
    readiness.mark_store_populated();
    assert!(clone.is_ready());
}

#[test]
fn a_running_state_move_holds_a_populated_store_unready() {
    let readiness = Readiness::new(true);
    readiness.mark_state_moving();
    assert!(!readiness.is_ready());
    assert!(readiness.is_store_populated());
    readiness.mark_state_moved();
    assert!(readiness.is_ready());
}

#[test]
fn a_finished_state_move_leaves_an_empty_store_unready() {
    let readiness = Readiness::new(false);
    readiness.mark_state_moving();
    readiness.mark_state_moved();
    assert!(!readiness.is_ready());
}

#[tokio::test]
async fn a_draining_backend_is_unready_and_ends_its_streams() {
    let readiness = Readiness::new(true);
    assert!(readiness.is_ready());
    let drained = tokio::spawn(readiness.drained());

    readiness.mark_draining();

    assert!(!readiness.is_ready());
    tokio::time::timeout(std::time::Duration::from_secs(5), drained)
        .await
        .expect("a stream waiting on the drain was never ended")
        .unwrap();
    // A stream opened while draining ends at once.
    tokio::time::timeout(std::time::Duration::from_secs(5), readiness.drained())
        .await
        .expect("a stream opened while draining was never ended");
}
