use std::time::Duration;

use super::{Clock, ManualClock, SystemClock};

/// A manual clock moves only by what it is advanced, and every clone moves with it.
#[test]
fn a_manual_clock_moves_only_when_advanced_and_clones_share_it() {
    let clock = ManualClock::new();
    let shared = clock.clone();
    assert_eq!(clock.now(), Duration::ZERO);

    shared.advance(Duration::from_millis(1_200));
    shared.advance(Duration::from_nanos(7));
    assert_eq!(
        clock.now(),
        Duration::from_millis(1_200) + Duration::from_nanos(7)
    );
    assert_eq!(shared.now(), clock.now());
}

/// The system clock never runs backwards.
#[test]
fn the_system_clock_is_monotonic() {
    let first = SystemClock.now();
    let second = SystemClock.now();
    assert!(second >= first);
}
