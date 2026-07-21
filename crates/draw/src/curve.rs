//! F-curves: keyframes and how a value is interpolated between them.
//!
//! This mirrors the F-curve model the voxel/mesh animation tools use (see
//! `crates/model-core/src/rig.rs` and the
//! [F-curves](../../apps/docs/src/content/docs/testing/asset-generation/voxel-binaries.md)
//! docs) so a model that has learned one animation vocabulary in this repository
//! already knows this one: each keyframe's [`Interp`] describes the segment
//! **leaving** it, `bezier` is shaped by tangent handles, and the easing presets
//! expand to standard handles.
//!
//! The differences are local to sprite sheets: time is a **frame index** rather
//! than milliseconds, values are integers because every animatable layer property
//! is one, and evaluation is done in [fixed point](crate::fixed) so a curve samples
//! identically in the container and in the post-run regeneration.

use serde::{Deserialize, Serialize};

use crate::fixed::{self, ONE};

/// How the curve leaves a keyframe.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Interp {
    /// Hold the value until the next key (a step).
    Constant,
    /// A straight line to the next key.
    Linear,
    /// A smooth cubic Bézier shaped by tangent handles (auto tangents when
    /// omitted).
    #[default]
    Bezier,
    /// Preset Bézier: start slow and accelerate into the next key.
    EaseIn,
    /// Preset Bézier: start fast and decelerate into the next key.
    EaseOut,
    /// Preset Bézier: ease both ends.
    EaseInOut,
}

/// A single keyframe: a property's value at a frame, plus how the curve leaves it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Keyframe {
    /// The frame index this key sits on.
    pub frame: u32,
    /// The property's value at this frame.
    pub value: i64,
    /// Interpolation of the segment **leaving** this key.
    #[serde(default)]
    pub interp: Interp,
    /// Bézier out-handle on this key as `[dframes, dvalue]`; `None` = auto tangent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub out_handle: Option<[i64; 2]>,
    /// Bézier in-handle on this key as `[dframes, dvalue]`; `None` = auto tangent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub in_handle: Option<[i64; 2]>,
}

/// Sample a keyframe list at `frame`, returning the interpolated integer value.
///
/// Keys are assumed sorted by frame (the CLI keeps them that way on insert). An
/// empty list has no value of its own — the caller substitutes the layer's resting
/// value. Before the first key the curve holds the first value and after the last
/// it holds the last, so a single key pins a property for the whole sheet.
pub fn evaluate(keys: &[Keyframe], frame: u32) -> Option<i64> {
    match keys {
        [] => None,
        [only] => Some(only.value),
        _ => {
            let first = keys[0];
            let last = keys[keys.len() - 1];
            if frame <= first.frame {
                return Some(first.value);
            }
            if frame >= last.frame {
                return Some(last.value);
            }
            // The segment containing `frame`: the last key at or before it. The
            // early returns above guarantee one exists and that it is not the last.
            let index = keys
                .iter()
                .rposition(|key| key.frame <= frame)
                .expect("a key at or before `frame` exists");
            Some(segment_value(keys, index, frame))
        }
    }
}

/// Interpolate within the segment from `keys[index]` to `keys[index + 1]`.
fn segment_value(keys: &[Keyframe], index: usize, frame: u32) -> i64 {
    let start = keys[index];
    let end = keys[index + 1];
    let span = (end.frame - start.frame) as i64;
    if span == 0 {
        return end.value;
    }

    match start.interp {
        Interp::Constant => start.value,
        Interp::Linear => {
            let t = fixed::div(
                fixed::from_int((frame - start.frame) as i64),
                fixed::from_int(span),
            );
            fixed::round_to_int(lerp(
                fixed::from_int(start.value),
                fixed::from_int(end.value),
                t,
            ))
        }
        _ => {
            let (out_handle, in_handle) = handles(keys, index, span);
            bezier_value(start, end, out_handle, in_handle, frame)
        }
    }
}

/// The out-handle of `keys[index]` and the in-handle of `keys[index + 1]`, as
/// fixed-point `(dframes, dvalue)` offsets from their own keys.
///
/// An easing preset ignores any authored handles and expands to its standard
/// control points; a plain `bezier` key uses its authored handles, falling back to
/// an auto tangent per side.
fn handles(keys: &[Keyframe], index: usize, span: i64) -> ([i64; 2], [i64; 2]) {
    let start = keys[index];
    let end = keys[index + 1];
    let dx = fixed::from_int(span);

    // The CSS easing curves, as control-point offsets: ease-in is (0.42, 0) →
    // (1, 1), ease-out is (0, 0) → (0.58, 1), ease-in-out eases both ends. The
    // value offset is zero on an eased end because the curve leaves and arrives
    // flat in value while time carries on.
    const EASE: i64 = (ONE * 42) / 100;
    match start.interp {
        Interp::EaseIn => ([fixed::mul(dx, EASE), 0], [0, 0]),
        Interp::EaseOut => ([0, 0], [-fixed::mul(dx, EASE), 0]),
        Interp::EaseInOut => ([fixed::mul(dx, EASE), 0], [-fixed::mul(dx, EASE), 0]),
        _ => {
            let out = start
                .out_handle
                .map(to_fixed_handle)
                .unwrap_or_else(|| auto_handle(keys, index, span, true));
            let in_ = end
                .in_handle
                .map(to_fixed_handle)
                .unwrap_or_else(|| auto_handle(keys, index + 1, span, false));
            // Clamp the time component into the segment so the curve's x stays
            // monotonic and the solve below always converges on one answer. Blender
            // clamps its handles for the same reason.
            (
                [out[0].clamp(0, dx), out[1]],
                [in_[0].clamp(-dx, 0), in_[1]],
            )
        }
    }
}

/// Convert an authored integer `[dframes, dvalue]` handle to fixed point.
fn to_fixed_handle(handle: [i64; 2]) -> [i64; 2] {
    [fixed::from_int(handle[0]), fixed::from_int(handle[1])]
}

/// A smooth auto tangent for the key at `index`, as a fixed-point
/// `(dframes, dvalue)` offset.
///
/// The tangent's slope is the Catmull-Rom estimate — the secant between the key's
/// neighbours, or the one-sided secant at an end — and the handle extends a third
/// of the segment, the usual convention that makes consecutive auto-tangent
/// segments join without a visible kink.
fn auto_handle(keys: &[Keyframe], index: usize, span: i64, outgoing: bool) -> [i64; 2] {
    let previous = keys[index.saturating_sub(1)];
    let next = keys[(index + 1).min(keys.len() - 1)];
    let frame_span = next.frame as i64 - previous.frame as i64;
    let slope = if frame_span == 0 {
        0
    } else {
        fixed::div(
            fixed::from_int(next.value - previous.value),
            fixed::from_int(frame_span),
        )
    };
    let third = fixed::from_int(span) / 3;
    let dx = if outgoing { third } else { -third };
    [dx, fixed::mul(slope, dx)]
}

/// Evaluate the cubic Bézier segment at `frame`.
///
/// The curve is parametric in `t`, but we are asked for a value at a *frame*, so
/// the frame is first solved back to its `t` by bisection on the curve's time
/// component. Handle clamping keeps that component monotonic, so the search is
/// well-posed; a fixed iteration count keeps it deterministic.
fn bezier_value(
    start: Keyframe,
    end: Keyframe,
    out_handle: [i64; 2],
    in_handle: [i64; 2],
    frame: u32,
) -> i64 {
    let x0 = fixed::from_int(start.frame as i64);
    let x3 = fixed::from_int(end.frame as i64);
    let x1 = x0 + out_handle[0];
    let x2 = x3 + in_handle[0];

    let y0 = fixed::from_int(start.value);
    let y3 = fixed::from_int(end.value);
    let y1 = y0 + out_handle[1];
    let y2 = y3 + in_handle[1];

    let target = fixed::from_int(frame as i64);

    // 24 bisections resolve `t` far below one frame for any realistic sheet: the
    // interval shrinks by 2^-24, and the widest span here is a few hundred frames.
    let mut low = 0;
    let mut high = ONE;
    for _ in 0..24 {
        let mid = (low + high) / 2;
        if cubic(x0, x1, x2, x3, mid) < target {
            low = mid;
        } else {
            high = mid;
        }
    }
    fixed::round_to_int(cubic(y0, y1, y2, y3, (low + high) / 2))
}

/// A cubic Bézier's value at `t`, in fixed point.
fn cubic(p0: i64, p1: i64, p2: i64, p3: i64, t: i64) -> i64 {
    let inverse = ONE - t;
    let a = fixed::mul(fixed::mul(inverse, inverse), inverse);
    let b = 3 * fixed::mul(fixed::mul(inverse, inverse), t);
    let c = 3 * fixed::mul(fixed::mul(inverse, t), t);
    let d = fixed::mul(fixed::mul(t, t), t);
    fixed::mul(p0, a) + fixed::mul(p1, b) + fixed::mul(p2, c) + fixed::mul(p3, d)
}

/// Linear interpolation between two fixed-point values.
fn lerp(from: i64, to: i64, t: i64) -> i64 {
    from + fixed::mul(to - from, t)
}

#[cfg(test)]
#[path = "curve.test.rs"]
mod tests;
