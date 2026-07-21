//! Unit tests for F-curve evaluation.

use super::*;

fn key(frame: u32, value: i64, interp: Interp) -> Keyframe {
    Keyframe {
        frame,
        value,
        interp,
        out_handle: None,
        in_handle: None,
    }
}

#[test]
fn an_empty_track_has_no_value() {
    // The layer's resting value stands in — that substitution is the caller's job,
    // so the curve reports absence rather than inventing a zero.
    assert_eq!(evaluate(&[], 3), None);
}

#[test]
fn a_single_key_pins_the_property_everywhere() {
    let keys = [key(5, 42, Interp::Linear)];
    for frame in 0..12 {
        assert_eq!(evaluate(&keys, frame), Some(42));
    }
}

#[test]
fn the_curve_holds_its_end_values_outside_the_keyed_range() {
    let keys = [key(2, 10, Interp::Linear), key(6, 30, Interp::Linear)];
    assert_eq!(evaluate(&keys, 0), Some(10));
    assert_eq!(evaluate(&keys, 2), Some(10));
    assert_eq!(evaluate(&keys, 6), Some(30));
    assert_eq!(evaluate(&keys, 99), Some(30));
}

#[test]
fn linear_interpolation_is_an_even_ramp() {
    let keys = [key(0, 0, Interp::Linear), key(10, 100, Interp::Linear)];
    for frame in 0..=10 {
        assert_eq!(evaluate(&keys, frame), Some(frame as i64 * 10));
    }
}

#[test]
fn constant_holds_until_the_next_key() {
    let keys = [key(0, 5, Interp::Constant), key(4, 50, Interp::Constant)];
    for frame in 0..4 {
        assert_eq!(evaluate(&keys, frame), Some(5), "frame {frame} steps early");
    }
    assert_eq!(evaluate(&keys, 4), Some(50));
}

#[test]
fn every_interpolation_hits_both_of_its_keys_exactly() {
    // Whatever shape a segment takes between them, a key's own value is not
    // negotiable — a model that keys a position expects the layer to be there.
    for interp in [
        Interp::Constant,
        Interp::Linear,
        Interp::Bezier,
        Interp::EaseIn,
        Interp::EaseOut,
        Interp::EaseInOut,
    ] {
        let keys = [key(3, -20, interp), key(9, 40, interp)];
        assert_eq!(evaluate(&keys, 3), Some(-20), "{interp:?} start");
        assert_eq!(evaluate(&keys, 9), Some(40), "{interp:?} end");
    }
}

#[test]
fn every_interpolation_stays_monotonic_across_a_rising_segment() {
    // Easing changes the *rate*, never the direction; a preset that backed up
    // would read as a glitch in the motion.
    for interp in [
        Interp::Linear,
        Interp::Bezier,
        Interp::EaseIn,
        Interp::EaseOut,
        Interp::EaseInOut,
    ] {
        let keys = [key(0, 0, interp), key(20, 100, interp)];
        let mut previous = i64::MIN;
        for frame in 0..=20 {
            let value = evaluate(&keys, frame).expect("keyed");
            assert!(
                value >= previous,
                "{interp:?} dips at frame {frame}: {value} after {previous}"
            );
            previous = value;
        }
    }
}

#[test]
fn ease_in_starts_slower_than_ease_out() {
    // The defining difference between the two presets, and the thing a model is
    // choosing between when it picks one: early in the segment `ease-in` has
    // travelled less of the distance.
    let ease_in = [key(0, 0, Interp::EaseIn), key(10, 100, Interp::EaseIn)];
    let ease_out = [key(0, 0, Interp::EaseOut), key(10, 100, Interp::EaseOut)];
    let early_in = evaluate(&ease_in, 2).expect("keyed");
    let early_out = evaluate(&ease_out, 2).expect("keyed");
    assert!(
        early_in < early_out,
        "ease-in ({early_in}) should trail ease-out ({early_out}) early in the segment"
    );

    // The two curves do not cross: ease-out leads from the first frame and ease-in
    // only catches up at the very end, where both must land on the key. A crossing
    // would mean one of the presets reversed the other's character mid-segment.
    for frame in 1..10 {
        let value_in = evaluate(&ease_in, frame).expect("keyed");
        let value_out = evaluate(&ease_out, frame).expect("keyed");
        assert!(
            value_in <= value_out,
            "the presets cross at frame {frame}: ease-in {value_in}, ease-out {value_out}"
        );
    }
    assert_eq!(evaluate(&ease_in, 10), evaluate(&ease_out, 10));
}

#[test]
fn ease_in_out_is_symmetric_about_its_midpoint() {
    let keys = [
        key(0, 0, Interp::EaseInOut),
        key(10, 100, Interp::EaseInOut),
    ];
    for frame in 0..=5u32 {
        let early = evaluate(&keys, frame).expect("keyed");
        let late = evaluate(&keys, 10 - frame).expect("keyed");
        // Allow a unit of rounding slack: the two samples round independently.
        assert!(
            (early + late - 100).abs() <= 1,
            "frames {frame}/{} are asymmetric: {early} and {late}",
            10 - frame
        );
    }
}

#[test]
fn explicit_handles_shape_the_segment() {
    // A handle that holds the value flat out of the first key should keep the
    // curve below the straight line it would otherwise take.
    let mut start = key(0, 0, Interp::Bezier);
    start.out_handle = Some([5, 0]);
    let mut end = key(10, 100, Interp::Bezier);
    end.in_handle = Some([-5, 0]);
    let shaped = [start, end];
    let straight = [key(0, 0, Interp::Linear), key(10, 100, Interp::Linear)];

    let shaped_early = evaluate(&shaped, 2).expect("keyed");
    let straight_early = evaluate(&straight, 2).expect("keyed");
    assert!(
        shaped_early < straight_early,
        "flat out-handle should ease away from the key: {shaped_early} vs {straight_early}"
    );
}

#[test]
fn a_handle_reaching_past_the_next_key_is_clamped() {
    // An overlong handle would make the curve's time component non-monotonic and
    // the frame-to-t solve ambiguous. Clamping keeps it well-posed, and the keys
    // themselves still land exactly.
    let mut start = key(0, 0, Interp::Bezier);
    start.out_handle = Some([1000, 0]);
    let keys = [start, key(10, 100, Interp::Bezier)];
    assert_eq!(evaluate(&keys, 0), Some(0));
    assert_eq!(evaluate(&keys, 10), Some(100));
    for frame in 0..=10 {
        let value = evaluate(&keys, frame).expect("keyed");
        assert!(
            (0..=100).contains(&value),
            "frame {frame} left the segment's range: {value}"
        );
    }
}

#[test]
fn a_flat_segment_stays_flat() {
    // Two keys at the same value must not bulge, whatever the auto tangents make
    // of the neighbours — a held pose is a common thing to key.
    let keys = [
        key(0, 0, Interp::Bezier),
        key(5, 20, Interp::Bezier),
        key(10, 20, Interp::Bezier),
        key(15, 20, Interp::Bezier),
    ];
    for frame in 10..=15 {
        assert_eq!(evaluate(&keys, frame), Some(20), "frame {frame} drifted");
    }
}

#[test]
fn coincident_keys_resolve_deterministically() {
    // `Layer::set_keyframe` replaces rather than appends, so a track cannot hold
    // two keys on one frame in practice. A document edited by hand still can, and
    // regeneration must not depend on which one it picks — so the rule is simply
    // the one that already governs the range ends: at or before the first key, the
    // first key's value stands.
    let keys = [key(4, 10, Interp::Linear), key(4, 90, Interp::Linear)];
    assert_eq!(evaluate(&keys, 4), Some(10));
    assert_eq!(evaluate(&keys, 4), evaluate(&keys, 4));
}

#[test]
fn evaluation_is_deterministic() {
    let keys = [
        key(0, 0, Interp::EaseOut),
        key(7, 55, Interp::Bezier),
        key(13, -30, Interp::EaseInOut),
    ];
    for frame in 0..=13 {
        assert_eq!(evaluate(&keys, frame), evaluate(&keys, frame));
    }
}
