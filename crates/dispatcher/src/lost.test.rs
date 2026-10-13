use super::*;

fn ids(list: &[&str]) -> Vec<String> {
    list.iter().map(|id| id.to_string()).collect()
}

fn set(list: &[&str]) -> HashSet<String> {
    list.iter().map(|id| id.to_string()).collect()
}

const GRACE: Duration = Duration::from_secs(120);

#[test]
fn a_driven_job_with_no_live_driver_is_lost_only_after_the_grace() {
    let mut tracker = LostTracker::default();
    let start = Instant::now();
    assert!(
        tracker
            .observe(&ids(&["a"]), &set(&[]), start, GRACE)
            .is_empty()
    );
    assert!(
        tracker
            .observe(
                &ids(&["a"]),
                &set(&[]),
                start + Duration::from_secs(119),
                GRACE
            )
            .is_empty()
    );
    assert_eq!(
        tracker.observe(&ids(&["a"]), &set(&[]), start + GRACE, GRACE),
        ids(&["a"])
    );
    // Still driven after the report (it failed): reported again.
    assert_eq!(
        tracker.observe(&ids(&["a"]), &set(&[]), start + GRACE * 2, GRACE),
        ids(&["a"])
    );
}

#[test]
fn a_live_driver_is_never_lost() {
    let mut tracker = LostTracker::default();
    let start = Instant::now();
    tracker.observe(&ids(&["a", "b"]), &set(&["a", "b"]), start, GRACE);
    assert!(
        tracker
            .observe(
                &ids(&["a", "b"]),
                &set(&["a", "b"]),
                start + GRACE * 3,
                GRACE
            )
            .is_empty()
    );
}

#[test]
fn reappearing_or_ending_restarts_the_clock() {
    let mut tracker = LostTracker::default();
    let start = Instant::now();
    tracker.observe(&ids(&["a", "b"]), &set(&[]), start, GRACE);
    // `a`'s Job showed up (a slow create); `b` reached a terminal state.
    tracker.observe(
        &ids(&["a"]),
        &set(&["a"]),
        start + Duration::from_secs(60),
        GRACE,
    );
    // Both missing again: each starts its grace afresh.
    assert!(
        tracker
            .observe(
                &ids(&["a", "b"]),
                &set(&[]),
                start + Duration::from_secs(90),
                GRACE
            )
            .is_empty()
    );
    assert_eq!(
        tracker.observe(
            &ids(&["a", "b"]),
            &set(&[]),
            start + Duration::from_secs(90) + GRACE,
            GRACE
        ),
        ids(&["a", "b"])
    );
}

#[test]
fn a_job_waiting_to_store_its_tree_is_driven_and_so_can_be_lost() {
    use crate::client::JobState;

    // The driver pod of a `storing` job is alive for the whole wait. One that died
    // must be found, or its job would hold the run queue with nobody left to
    // release it.
    let storing: JobState = serde_json::from_str(r#""storing""#).unwrap();
    assert_eq!(storing, JobState::Storing);
    assert!(storing.is_driven());
    assert!(!storing.is_terminal());

    for (wire, driven) in [
        ("queued", false),
        ("pending", false),
        ("dispatched", true),
        ("starting", true),
        ("running", true),
        ("succeeded", false),
        ("failed", false),
        ("canceled", false),
    ] {
        let state: JobState = serde_json::from_str(&format!("\"{wire}\"")).unwrap();
        assert_eq!(state.is_driven(), driven, "{wire}");
    }
}

#[test]
fn a_state_this_dispatcher_does_not_know_parses_and_is_not_terminal() {
    use crate::client::JobState;

    // What a dispatcher one release behind the backend reads for a state added
    // since: the poll does not fail, and a death is still reported.
    let unknown: JobState = serde_json::from_str(r#""a-state-added-later""#).unwrap();
    assert_eq!(unknown, JobState::Unknown);
    assert!(!unknown.is_terminal());
    assert!(!unknown.is_driven());
}
