//! Placing a rendered layer onto the canvas: the transform and the blend.
//!
//! Two things here differ deliberately from how a bare [`Operation`](crate::Operation)
//! behaves. First, a layer is **transformed** — translated, rotated, scaled — so its
//! pixels no longer land on a one-to-one grid and must be resampled. Second, a layer
//! **composites source-over** rather than replacing pixels: transparent pixels let
//! what is underneath show through, which is the entire point of stacking layers,
//! and is why a layer's own extent can be smaller than the canvas.
//!
//! Both are done in [fixed point](crate::fixed) so the result is identical in the
//! run container and in the post-run regeneration.

use crate::fixed::{self, HALF};
use crate::layer::{OPAQUE, Transform};
use crate::{ImageBuffer, Rgba};

/// Composite `source` onto `dest` under `transform`.
///
/// Sampling is **destination-driven**: each destination pixel the layer could cover
/// is mapped *back* into the layer and sampled nearest-neighbour. The inverse
/// direction is what keeps a scaled or rotated layer solid — mapping forward from
/// source pixels instead leaves unwritten holes wherever the transform expands the
/// image.
pub fn composite(dest: &mut ImageBuffer, source: &ImageBuffer, transform: &Transform) {
    // A layer scaled to nothing, or faded out entirely, contributes nothing. This
    // also keeps the inverse map below away from a zero divisor.
    if transform.opacity <= 0
        || transform.scale_x == 0
        || transform.scale_y == 0
        || source.width == 0
        || source.height == 0
    {
        return;
    }

    let scale_x = fixed::from_percent(transform.scale_x);
    let scale_y = fixed::from_percent(transform.scale_y);
    // Rotation and scale act about the layer's own centre, so a layer spins in
    // place and grows from its middle rather than sliding away from its origin.
    let centre_x = fixed::from_int(source.width as i64) / 2;
    let centre_y = fixed::from_int(source.height as i64) / 2;
    let (sin, cos) = fixed::sin_cos(transform.rotation);
    let origin_x = fixed::from_int(transform.x);
    let origin_y = fixed::from_int(transform.y);

    let Some((min_x, min_y, max_x, max_y)) = covered_bounds(
        dest, source, scale_x, scale_y, centre_x, centre_y, sin, cos, origin_x, origin_y,
    ) else {
        return;
    };

    for y in min_y..=max_y {
        for x in min_x..=max_x {
            // Sample at the destination pixel's centre, then invert the transform:
            // undo the placement, undo the rotation, undo the scale.
            let dx = fixed::from_int(x) + HALF - origin_x - centre_x;
            let dy = fixed::from_int(y) + HALF - origin_y - centre_y;
            let unrotated_x = fixed::mul(dx, cos) + fixed::mul(dy, sin);
            let unrotated_y = fixed::mul(dy, cos) - fixed::mul(dx, sin);
            let source_x = fixed::floor_to_int(fixed::div(unrotated_x, scale_x) + centre_x);
            let source_y = fixed::floor_to_int(fixed::div(unrotated_y, scale_y) + centre_y);

            let Some(sample) = source.get(source_x, source_y) else {
                continue;
            };
            if let Some(under) = dest.get(x, y) {
                dest.set(x, y, blend(sample, under, transform.opacity));
            }
        }
    }
}

/// The destination rectangle the transformed layer can cover, clipped to the
/// canvas, or `None` when it falls entirely outside.
///
/// The bounds come from forward-transforming the layer's four corners, which is
/// exact for an affine transform: the image of an axis-aligned rectangle is a
/// parallelogram, and its axis-aligned bounding box is spanned by those corners.
#[expect(
    clippy::too_many_arguments,
    reason = "the transform is passed as its already-decomposed fixed-point terms, \
              which is cheaper and clearer than rebuilding them per corner"
)]
fn covered_bounds(
    dest: &ImageBuffer,
    source: &ImageBuffer,
    scale_x: i64,
    scale_y: i64,
    centre_x: i64,
    centre_y: i64,
    sin: i64,
    cos: i64,
    origin_x: i64,
    origin_y: i64,
) -> Option<(i64, i64, i64, i64)> {
    let width = fixed::from_int(source.width as i64);
    let height = fixed::from_int(source.height as i64);
    let corners = [(0, 0), (width, 0), (0, height), (width, height)];

    let mut min_x = i64::MAX;
    let mut min_y = i64::MAX;
    let mut max_x = i64::MIN;
    let mut max_y = i64::MIN;
    for (corner_x, corner_y) in corners {
        let ex = fixed::mul(corner_x - centre_x, scale_x);
        let ey = fixed::mul(corner_y - centre_y, scale_y);
        let x = fixed::mul(ex, cos) - fixed::mul(ey, sin) + centre_x + origin_x;
        let y = fixed::mul(ex, sin) + fixed::mul(ey, cos) + centre_y + origin_y;
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x);
        max_y = max_y.max(y);
    }

    // Widen by a pixel on each side before clipping: the bounds are computed from
    // corner centres, and a nearest-neighbour sample can legitimately claim the
    // pixel just outside them.
    let min_x = fixed::floor_to_int(min_x) - 1;
    let min_y = fixed::floor_to_int(min_y) - 1;
    let max_x = fixed::ceil_to_int(max_x) + 1;
    let max_y = fixed::ceil_to_int(max_y) + 1;

    let clipped_min_x = min_x.max(0);
    let clipped_min_y = min_y.max(0);
    let clipped_max_x = max_x.min(dest.width as i64 - 1);
    let clipped_max_y = max_y.min(dest.height as i64 - 1);
    if clipped_min_x > clipped_max_x || clipped_min_y > clipped_max_y {
        return None;
    }
    Some((clipped_min_x, clipped_min_y, clipped_max_x, clipped_max_y))
}

/// Source-over blend of `source` (scaled by `opacity`) onto `under`, in straight
/// (non-premultiplied) 8-bit RGBA.
///
/// Integer arithmetic throughout, rounding each channel at the same point, so the
/// blend reproduces exactly rather than merely closely.
fn blend(source: Rgba, under: Rgba, opacity: i64) -> Rgba {
    let [sr, sg, sb, sa] = source.0;
    let [ur, ug, ub, ua] = under.0;

    // The layer's own opacity multiplies its pixels' alpha.
    let source_alpha = (sa as i64 * opacity) / OPAQUE;
    if source_alpha <= 0 {
        return under;
    }
    if source_alpha >= OPAQUE {
        return Rgba([sr, sg, sb, OPAQUE as u8]);
    }

    let under_alpha = ua as i64;
    // out_a = sa + ua * (1 - sa), all over 255.
    let out_alpha = source_alpha + (under_alpha * (OPAQUE - source_alpha)) / OPAQUE;
    if out_alpha <= 0 {
        return Rgba([0, 0, 0, 0]);
    }

    // Straight-alpha source-over: each channel is weighted by its own coverage and
    // renormalized by the combined coverage.
    let channel = |s: u8, u: u8| -> u8 {
        let contribution =
            s as i64 * source_alpha * OPAQUE + u as i64 * under_alpha * (OPAQUE - source_alpha);
        let value = contribution / (out_alpha * OPAQUE);
        value.clamp(0, OPAQUE) as u8
    };

    Rgba([
        channel(sr, ur),
        channel(sg, ug),
        channel(sb, ub),
        out_alpha.clamp(0, OPAQUE) as u8,
    ])
}

#[cfg(test)]
#[path = "composite.test.rs"]
mod tests;
