//! Deterministic fixed-point arithmetic for layer transforms.
//!
//! Layer placement needs fractional math — a rotation matrix, a scale factor, the
//! inverse map from a destination pixel back into a layer — but the drawing
//! library has a hard requirement that floating point cannot meet: the image
//! `crates/core` regenerates after a run must be **bit-identical** to the one the
//! in-container binary rendered, or the difference registers as
//! [cheat divergence](../../apps/docs/src/content/docs/testing/asset-generation/evaluation.md).
//! Container and host are separate builds, and `sin`/`cos` are not guaranteed
//! identical across libm implementations — a one-ULP disagreement is enough to move
//! a nearest-neighbour sample by a pixel and manufacture a phantom divergence.
//!
//! So every transform value is a 16.16 fixed-point integer and the trigonometry is
//! computed here, in integer arithmetic, rather than taken from the platform. The
//! result is exact by construction on any target.

/// Number of fractional bits in the 16.16 representation.
pub const SHIFT: u32 = 16;

/// The fixed-point representation of `1`.
pub const ONE: i64 = 1 << SHIFT;

/// The fixed-point representation of `0.5`, the offset to a pixel's centre.
pub const HALF: i64 = ONE / 2;

/// π in 16.16, used to convert whole degrees to radians.
const PI: i64 = 205887;

/// Lift a plain integer into fixed point.
pub const fn from_int(value: i64) -> i64 {
    value << SHIFT
}

/// Multiply two fixed-point values.
///
/// The shift is arithmetic, so truncation is toward negative infinity for every
/// input — a consistent rule is what matters here, not a particular one, since both
/// the preview and the regeneration run this same code.
pub fn mul(a: i64, b: i64) -> i64 {
    (a * b) >> SHIFT
}

/// Divide two fixed-point values. A zero divisor yields `0`; callers reject
/// degenerate transforms before sampling, so this only guards the arithmetic.
pub fn div(a: i64, b: i64) -> i64 {
    if b == 0 { 0 } else { (a << SHIFT) / b }
}

/// The greatest integer not exceeding `value`.
pub fn floor_to_int(value: i64) -> i64 {
    value >> SHIFT
}

/// The least integer not below `value`.
pub fn ceil_to_int(value: i64) -> i64 {
    floor_to_int(value + ONE - 1)
}

/// Round a fixed-point value to the nearest integer, halves rounding up.
pub fn round_to_int(value: i64) -> i64 {
    floor_to_int(value + HALF)
}

/// A percentage (`100` = actual size) as a fixed-point scale factor.
pub fn from_percent(percent: i64) -> i64 {
    from_int(percent) / 100
}

/// The sine and cosine of a whole-degree angle, as fixed-point values.
///
/// Rotation is only ever expressed in whole degrees, so this reduces to one of 360
/// angles: the argument is folded into `0..90` using quadrant symmetry and the
/// first-quadrant sine comes from a Taylor series evaluated in fixed point.
pub fn sin_cos(degrees: i64) -> (i64, i64) {
    (sin_degrees(degrees), sin_degrees(degrees + 90))
}

/// Sine of a whole-degree angle, folded into the first quadrant.
fn sin_degrees(degrees: i64) -> i64 {
    // `rem_euclid` keeps a negative angle positive, so -90 and 270 agree.
    let degrees = degrees.rem_euclid(360);
    match degrees {
        0..=90 => sin_first_quadrant(degrees),
        91..=180 => sin_first_quadrant(180 - degrees),
        181..=270 => -sin_first_quadrant(degrees - 180),
        _ => -sin_first_quadrant(360 - degrees),
    }
}

/// Sine of an angle in `0..=90` degrees, by Taylor series in fixed point.
///
/// Radians are formed from the integer degree count in one exact step
/// (`degrees * π / 180`) rather than by multiplying through a rounded π/180
/// constant, which would accumulate visible error by 90°. The series runs to the
/// ninth power; its next term is under `4e-6` across this range, well below the
/// `1.5e-5` resolution of 16.16.
fn sin_first_quadrant(degrees: i64) -> i64 {
    let x = (degrees * PI) / 180;
    let x2 = mul(x, x);
    let x3 = mul(x2, x);
    let x5 = mul(x2, x3);
    let x7 = mul(x2, x5);
    let x9 = mul(x2, x7);
    x - x3 / 6 + x5 / 120 - x7 / 5040 + x9 / 362_880
}

#[cfg(test)]
#[path = "fixed.test.rs"]
mod tests;
