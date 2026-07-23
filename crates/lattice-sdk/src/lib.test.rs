//! Unit tests for the SDK's playback window construction — the one bit of arithmetic
//! the playback ABI adds. (The ABI plumbing mirrors `lattice-core`'s tested
//! reference `abi`, and that a submission's `run` produces oracle-exact frames over a
//! dense window is proven in the reference engines' own cross-checks.)

use super::{PLAYBACK_WINDOW_TICKS, playback_window};

#[test]
fn a_long_scenario_is_capped_to_a_dense_window() {
    // Longer than the window: capped, one snapshot per tick, `1..=WINDOW`.
    let (window, snapshots) = playback_window(PLAYBACK_WINDOW_TICKS + 5_000);
    assert_eq!(window, PLAYBACK_WINDOW_TICKS);
    assert_eq!(snapshots.len(), PLAYBACK_WINDOW_TICKS as usize);
    assert_eq!(snapshots.first(), Some(&1));
    assert_eq!(snapshots.last(), Some(&PLAYBACK_WINDOW_TICKS));
}

#[test]
fn a_short_scenario_is_covered_whole() {
    // Shorter than the window: the whole scenario, still one snapshot per tick.
    let (window, snapshots) = playback_window(3);
    assert_eq!(window, 3);
    assert_eq!(snapshots, vec![1, 2, 3]);
}

#[test]
fn a_zero_tick_scenario_yields_no_window() {
    // Nothing to play — `dispatch_playback_load` reads this empty window as a load
    // failure rather than caching zero frames.
    let (window, snapshots) = playback_window(0);
    assert_eq!(window, 0);
    assert!(snapshots.is_empty());
}
