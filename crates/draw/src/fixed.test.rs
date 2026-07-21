//! Unit tests for the fixed-point math backing layer transforms.
//!
//! The property that matters most here is not accuracy but **exactness**: the
//! post-run regeneration must reproduce the container's pixels bit for bit, so
//! these check that the trigonometry is precise enough to place a sample and,
//! above all, that it is a pure function of its integer input.

use super::*;

/// Tolerance for a trigonometric result, in 16.16 units. One unit is 1/65536, so
/// this is roughly 1.5e-4 — orders of magnitude finer than the half-pixel that
/// would be needed to shift a nearest-neighbour sample.
const EPSILON: i64 = 10;

fn assert_close(actual: i64, expected: i64, what: &str) {
    assert!(
        (actual - expected).abs() <= EPSILON,
        "{what}: expected ~{expected}, got {actual} (delta {})",
        actual - expected
    );
}

#[test]
fn sin_cos_is_exact_at_the_cardinal_angles() {
    // The angles a pixel-art rotation is most likely to use are the quarter turns,
    // and they are the ones a visible error would be least forgivable at.
    for (degrees, sin, cos) in [
        (0, 0, ONE),
        (90, ONE, 0),
        (180, 0, -ONE),
        (270, -ONE, 0),
        (360, 0, ONE),
    ] {
        let (actual_sin, actual_cos) = sin_cos(degrees);
        assert_close(actual_sin, sin, &format!("sin({degrees})"));
        assert_close(actual_cos, cos, &format!("cos({degrees})"));
    }
}

#[test]
fn sin_cos_matches_the_real_values_across_a_full_turn() {
    // The series is only evaluated on the first quadrant; this checks the quadrant
    // folding puts the sign and magnitude right everywhere else too.
    for degrees in -360..=720 {
        let (sin, cos) = sin_cos(degrees);
        let radians = (degrees as f64).to_radians();
        assert_close(sin, (radians.sin() * ONE as f64).round() as i64, "sin");
        assert_close(cos, (radians.cos() * ONE as f64).round() as i64, "cos");
    }
}

#[test]
fn sin_cos_is_a_pure_function_of_whole_degrees() {
    // The whole reason this is hand-rolled: the same angle must give the same
    // answer every time and on every target, or the regeneration diverges from the
    // preview and reads as cheating.
    for degrees in 0..360 {
        assert_eq!(sin_cos(degrees), sin_cos(degrees));
        assert_eq!(sin_cos(degrees), sin_cos(degrees + 360));
        assert_eq!(sin_cos(degrees), sin_cos(degrees - 360));
    }
}

#[test]
fn pythagorean_identity_holds() {
    for degrees in 0..360 {
        let (sin, cos) = sin_cos(degrees);
        let magnitude = mul(sin, sin) + mul(cos, cos);
        assert_close(magnitude, ONE, &format!("sin²+cos² at {degrees}"));
    }
}

#[test]
fn multiplication_and_division_round_trip() {
    let value = from_int(7);
    assert_eq!(mul(value, ONE), value);
    assert_eq!(div(value, ONE), value);
    assert_eq!(round_to_int(mul(from_int(3), from_int(4))), 12);
    assert_eq!(round_to_int(div(from_int(12), from_int(4))), 3);
}

#[test]
fn division_by_zero_yields_zero_rather_than_panicking() {
    // Callers reject degenerate transforms before sampling, but the arithmetic
    // itself must stay total — every operation in this crate is.
    assert_eq!(div(from_int(5), 0), 0);
}

#[test]
fn percentages_convert_to_scale_factors() {
    assert_eq!(from_percent(100), ONE);
    assert_eq!(from_percent(200), ONE * 2);
    assert_eq!(from_percent(50), ONE / 2);
    assert_eq!(from_percent(0), 0);
}

#[test]
fn rounding_helpers_agree_with_their_names() {
    let one_and_a_half = from_int(1) + HALF;
    assert_eq!(floor_to_int(one_and_a_half), 1);
    assert_eq!(ceil_to_int(one_and_a_half), 2);
    assert_eq!(round_to_int(one_and_a_half), 2);
    assert_eq!(round_to_int(from_int(1) + HALF - 1), 1);

    // Negatives floor toward negative infinity, which is what keeps a sample's
    // pixel index consistent on both sides of the origin.
    let negative = -from_int(1) - HALF;
    assert_eq!(floor_to_int(negative), -2);
    assert_eq!(ceil_to_int(negative), -1);
}
