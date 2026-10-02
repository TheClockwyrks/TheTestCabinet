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
