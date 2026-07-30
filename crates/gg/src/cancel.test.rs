use super::*;

#[test]
fn a_run_with_no_sentinel_path_is_never_canceled() {
    // The shape a run whose host cannot cancel it takes: no path, no stat, no stop.
    let watch = CancelWatch::disabled();
    assert!(!watch.is_canceled());
    assert!(!watch.is_canceled());
}

#[test]
fn an_absent_sentinel_is_not_a_cancellation() {
    let dir = tempfile::tempdir().expect("temp dir");
    let watch = CancelWatch::new(dir.path().join("gg-cancel"));
    assert!(!watch.is_canceled());
}

#[test]
fn the_sentinel_appearing_cancels_the_run() {
    // The host writes the file when an operator kills the run; the next turn boundary
    // sees it.
    let dir = tempfile::tempdir().expect("temp dir");
    let sentinel = dir.path().join("gg-cancel");
    let watch = CancelWatch::new(sentinel.clone());
    assert!(!watch.is_canceled());

    std::fs::write(&sentinel, b"").expect("write the sentinel");
    assert!(watch.is_canceled());
}

#[test]
fn the_observation_latches_past_the_sentinel_being_removed() {
    // Agents reach their turn boundaries at different times. If the sentinel vanished
    // mid-wind-down, the ones that had not looked yet would carry on running while the
    // rest stopped — so the decision, once made, is the run's.
    let dir = tempfile::tempdir().expect("temp dir");
    let sentinel = dir.path().join("gg-cancel");
    let watch = CancelWatch::new(sentinel.clone());

    std::fs::write(&sentinel, b"").expect("write the sentinel");
    assert!(watch.is_canceled());

    std::fs::remove_file(&sentinel).expect("remove the sentinel");
    assert!(watch.is_canceled(), "the cancellation must not be undone");
}

#[test]
fn a_clone_shares_the_latch_with_every_other_agent() {
    // The root and every subagent hold clones, so one observation is the whole run's.
    let dir = tempfile::tempdir().expect("temp dir");
    let sentinel = dir.path().join("gg-cancel");
    let root = CancelWatch::new(sentinel.clone());
    let subagent = root.clone();

    std::fs::write(&sentinel, b"").expect("write the sentinel");
    assert!(root.is_canceled());

    std::fs::remove_file(&sentinel).expect("remove the sentinel");
    assert!(
        subagent.is_canceled(),
        "a subagent reaching its boundary later must see the same decision",
    );
}
