//! The shared CSG-style field vocabulary and how each operation composites into the
//! [`Field`].
//!
//! [`FieldOp`] is the wire form recorded in `actions.json`: an internally tagged enum
//! (`{ "op": "add_sphere", … }`) mirroring the cube tool's `Operation`, but building
//! a **continuous signed-distance field by compositing primitives** rather than
//! painting discrete cells. Every op is *total* — it composites over the whole grid,
//! clipping nothing and never panicking — so regenerating a field from an arbitrary
//! (even hostile) log always runs to completion.
//!
//! This is the vocabulary all of `mc`/`sn`/`dc` share: the additive primitives
//! (`add_sphere`/`add_box`/`add_ellipsoid`/`add_cylinder`) unioned into the field,
//! the subtractive primitives (`subtract_*`) carving material away, an optional
//! smooth-`blend` radius (soft-min union/subtraction) on every primitive, and the
//! whole-field `replace_color`/`mirror`/`translate`/`copy`/`clear`. Each primitive
//! also carries a `sharp` tag: pure carry-through here — only dual contouring honors
//! it (see [`crate::config::GridConfig::honor_sharp`]); mc/sn never set it.

use serde::{Deserialize, Serialize};

use test_cabinet_model_core::axis::Axis;
use test_cabinet_model_core::color::Rgb;

use crate::field::{EMPTY_COLOR, Field, OUTSIDE};

/// A single field operation the model issues through a meshing binary.
///
/// Primitive placements are center/extent based (`c*` is the center; radii and
/// extents are world-space sizes); `blend` is the smooth-union radius (`0` = a hard
/// union, which leaves a genuine crease in the field); `sharp` tags the primitive as
/// a sharp feature for dual contouring to preserve. The whole-field ops
/// (`replace_color`/`mirror`/`translate`/`copy`/`clear`) transform the already
/// composited field.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum FieldOp {
    /// Union a solid sphere centered at `(cx, cy, cz)` with radius `r` into the field.
    AddSphere {
        /// Center x.
        cx: f32,
        /// Center y.
        cy: f32,
        /// Center z.
        cz: f32,
        /// Radius in world units.
        r: f32,
        /// The material color.
        color: Rgb,
        /// Smooth-union radius; `0` is a hard union.
        #[serde(default)]
        blend: f32,
        /// Tag this primitive as a sharp feature (dual contouring only).
        #[serde(default)]
        sharp: bool,
    },
    /// Union a solid axis-aligned box centered at `(cx, cy, cz)` with the given
    /// extents into the field.
    AddBox {
        /// Center x.
        cx: f32,
        /// Center y.
        cy: f32,
        /// Center z.
        cz: f32,
        /// Full extent along x.
        width: f32,
        /// Full extent along y.
        height: f32,
        /// Full extent along z.
        depth: f32,
        /// The material color.
        color: Rgb,
        /// Smooth-union radius; `0` is a hard union.
        #[serde(default)]
        blend: f32,
        /// Tag this primitive as a sharp feature (dual contouring only).
        #[serde(default)]
        sharp: bool,
    },
    /// Union a solid ellipsoid centered at `(cx, cy, cz)` with per-axis radii into the
    /// field — a sphere with unequal radii (a dome, an egg).
    AddEllipsoid {
        /// Center x.
        cx: f32,
        /// Center y.
        cy: f32,
        /// Center z.
        cz: f32,
        /// Radius along x.
        rx: f32,
        /// Radius along y.
        ry: f32,
        /// Radius along z.
        rz: f32,
        /// The material color.
        color: Rgb,
        /// Smooth-union radius; `0` is a hard union.
        #[serde(default)]
        blend: f32,
        /// Tag this primitive as a sharp feature (dual contouring only).
        #[serde(default)]
        sharp: bool,
    },
    /// Union a solid capped cylinder centered at `(cx, cy, cz)`, radius `r` and full
    /// length `height` along `axis`, into the field (barrels, legs, poles, wheels).
    AddCylinder {
        /// Center x.
        cx: f32,
        /// Center y.
        cy: f32,
        /// Center z.
        cz: f32,
        /// Disc radius (perpendicular to `axis`).
        r: f32,
        /// Full length along `axis`.
        height: f32,
        /// The axis the cylinder extends along.
        axis: Axis,
        /// The material color.
        color: Rgb,
        /// Smooth-union radius; `0` is a hard union.
        #[serde(default)]
        blend: f32,
        /// Tag this primitive as a sharp feature (dual contouring only).
        #[serde(default)]
        sharp: bool,
    },
    /// Carve a sphere out of the field (smooth subtraction when `blend > 0`).
    SubtractSphere {
        /// Center x.
        cx: f32,
        /// Center y.
        cy: f32,
        /// Center z.
        cz: f32,
        /// Radius in world units.
        r: f32,
        /// Smooth-subtraction radius; `0` is a hard cut.
        #[serde(default)]
        blend: f32,
        /// Tag the carved edge as a sharp feature (dual contouring only).
        #[serde(default)]
        sharp: bool,
    },
    /// Carve an axis-aligned box out of the field (smooth when `blend > 0`).
    SubtractBox {
        /// Center x.
        cx: f32,
        /// Center y.
        cy: f32,
        /// Center z.
        cz: f32,
        /// Full extent along x.
        width: f32,
        /// Full extent along y.
        height: f32,
        /// Full extent along z.
        depth: f32,
        /// Smooth-subtraction radius; `0` is a hard cut.
        #[serde(default)]
        blend: f32,
        /// Tag the carved edge as a sharp feature (dual contouring only).
        #[serde(default)]
        sharp: bool,
    },
    /// Carve an ellipsoid out of the field (smooth when `blend > 0`).
    SubtractEllipsoid {
        /// Center x.
        cx: f32,
        /// Center y.
        cy: f32,
        /// Center z.
        cz: f32,
        /// Radius along x.
        rx: f32,
        /// Radius along y.
        ry: f32,
        /// Radius along z.
        rz: f32,
        /// Smooth-subtraction radius; `0` is a hard cut.
        #[serde(default)]
        blend: f32,
        /// Tag the carved edge as a sharp feature (dual contouring only).
        #[serde(default)]
        sharp: bool,
    },
    /// Carve a capped cylinder out of the field (smooth when `blend > 0`).
    SubtractCylinder {
        /// Center x.
        cx: f32,
        /// Center y.
        cy: f32,
        /// Center z.
        cz: f32,
        /// Disc radius (perpendicular to `axis`).
        r: f32,
        /// Full length along `axis`.
        height: f32,
        /// The axis the cylinder extends along.
        axis: Axis,
        /// Smooth-subtraction radius; `0` is a hard cut.
        #[serde(default)]
        blend: f32,
        /// Tag the carved edge as a sharp feature (dual contouring only).
        #[serde(default)]
        sharp: bool,
    },
    /// Recolor every node currently carrying color `from` to color `to`, across the
    /// whole field — a palette swap or shading pass. The distance field is untouched.
    ReplaceColor {
        /// The color to match.
        from: Rgb,
        /// The color to write in its place.
        to: Rgb,
    },
    /// Mirror the field across the plane at `at` along `plane`, reflecting the low
    /// side (coordinate `< at`) onto the high side by union — the single
    /// highest-leverage op for a symmetric model.
    Mirror {
        /// The plane's normal axis.
        plane: Axis,
        /// The mirror position along `plane`, in world units.
        at: f32,
    },
    /// Shift the whole field by `(dx, dy, dz)` world units; regions shifted in from
    /// outside the volume read as empty. Repositions an entire part.
    Translate {
        /// Shift along x.
        dx: f32,
        /// Shift along y.
        dy: f32,
        /// Shift along z.
        dz: f32,
    },
    /// Copy the field within a source box (min corner `(x, y, z)`, the given extents)
    /// to a destination offset by `(dx, dy, dz)`, unioning it into the destination —
    /// handy to duplicate a detail. Source and destination may overlap.
    Copy {
        /// Source minimum-corner x.
        x: f32,
        /// Source minimum-corner y.
        y: f32,
        /// Source minimum-corner z.
        z: f32,
        /// Source extent along x.
        width: f32,
        /// Source extent along y.
        height: f32,
        /// Source extent along z.
        depth: f32,
        /// Destination offset along x.
        dx: f32,
        /// Destination offset along y.
        dy: f32,
        /// Destination offset along z.
        dz: f32,
    },
    /// Reset the field to empty (every node far outside, uncolored, not sharp).
    Clear,
}

impl FieldOp {
    /// Apply this operation to the field in place. Always succeeds: every op
    /// composites over the whole grid, so an arbitrary log regenerates to completion.
    pub fn apply(&self, field: &mut Field) {
        match *self {
            FieldOp::AddSphere {
                cx,
                cy,
                cz,
                r,
                color,
                blend,
                sharp,
            } => add(
                field,
                Primitive::Sphere { r },
                [cx, cy, cz],
                color,
                blend,
                sharp,
            ),
            FieldOp::AddBox {
                cx,
                cy,
                cz,
                width,
                height,
                depth,
                color,
                blend,
                sharp,
            } => add(
                field,
                Primitive::Box {
                    ext: [width, height, depth],
                },
                [cx, cy, cz],
                color,
                blend,
                sharp,
            ),
            FieldOp::AddEllipsoid {
                cx,
                cy,
                cz,
                rx,
                ry,
                rz,
                color,
                blend,
                sharp,
            } => add(
                field,
                Primitive::Ellipsoid { r: [rx, ry, rz] },
                [cx, cy, cz],
                color,
                blend,
                sharp,
            ),
            FieldOp::AddCylinder {
                cx,
                cy,
                cz,
                r,
                height,
                axis,
                color,
                blend,
                sharp,
            } => add(
                field,
                Primitive::Cylinder { r, height, axis },
                [cx, cy, cz],
                color,
                blend,
                sharp,
            ),
            FieldOp::SubtractSphere {
                cx,
                cy,
                cz,
                r,
                blend,
                sharp,
            } => subtract(field, Primitive::Sphere { r }, [cx, cy, cz], blend, sharp),
            FieldOp::SubtractBox {
                cx,
                cy,
                cz,
                width,
                height,
                depth,
                blend,
                sharp,
            } => subtract(
                field,
                Primitive::Box {
                    ext: [width, height, depth],
                },
                [cx, cy, cz],
                blend,
                sharp,
            ),
            FieldOp::SubtractEllipsoid {
                cx,
                cy,
                cz,
                rx,
                ry,
                rz,
                blend,
                sharp,
            } => subtract(
                field,
                Primitive::Ellipsoid { r: [rx, ry, rz] },
                [cx, cy, cz],
                blend,
                sharp,
            ),
            FieldOp::SubtractCylinder {
                cx,
                cy,
                cz,
                r,
                height,
                axis,
                blend,
                sharp,
            } => subtract(
                field,
                Primitive::Cylinder { r, height, axis },
                [cx, cy, cz],
                blend,
                sharp,
            ),
            FieldOp::ReplaceColor { from, to } => {
                for color in field.color.iter_mut() {
                    if *color == from {
                        *color = to;
                    }
                }
            }
            FieldOp::Mirror { plane, at } => mirror(field, plane, at),
            FieldOp::Translate { dx, dy, dz } => translate(field, [dx, dy, dz]),
            FieldOp::Copy {
                x,
                y,
                z,
                width,
                height,
                depth,
                dx,
                dy,
                dz,
            } => copy(field, [x, y, z], [width, height, depth], [dx, dy, dz]),
            FieldOp::Clear => clear(field),
        }
    }

    /// The wire tag of this operation, for the human-readable confirmation line the
    /// binaries print.
    pub fn name(&self) -> &'static str {
        match self {
            FieldOp::AddSphere { .. } => "add_sphere",
            FieldOp::AddBox { .. } => "add_box",
            FieldOp::AddEllipsoid { .. } => "add_ellipsoid",
            FieldOp::AddCylinder { .. } => "add_cylinder",
            FieldOp::SubtractSphere { .. } => "subtract_sphere",
            FieldOp::SubtractBox { .. } => "subtract_box",
            FieldOp::SubtractEllipsoid { .. } => "subtract_ellipsoid",
            FieldOp::SubtractCylinder { .. } => "subtract_cylinder",
            FieldOp::ReplaceColor { .. } => "replace_color",
            FieldOp::Mirror { .. } => "mirror",
            FieldOp::Translate { .. } => "translate",
            FieldOp::Copy { .. } => "copy",
            FieldOp::Clear => "clear",
        }
    }
}

/// A CSG primitive shape, evaluated as a signed distance about its own center. The
/// additive/subtractive ops share these — only how the resulting distance composites
/// into the field differs.
#[derive(Debug, Clone, Copy)]
enum Primitive {
    /// A ball of radius `r`.
    Sphere { r: f32 },
    /// An axis-aligned box of full extents `ext`.
    Box { ext: [f32; 3] },
    /// An ellipsoid with per-axis radii `r`.
    Ellipsoid { r: [f32; 3] },
    /// A capped cylinder of radius `r` and full length `height` along `axis`.
    Cylinder { r: f32, height: f32, axis: Axis },
}

impl Primitive {
    /// The signed distance from world point `p` to this primitive centered at
    /// `center`: negative inside, positive outside, zero on the surface.
    fn distance(&self, p: [f32; 3], center: [f32; 3]) -> f32 {
        let q = sub(p, center);
        match *self {
            Primitive::Sphere { r } => length(q) - r,
            Primitive::Box { ext } => box_distance(q, ext),
            Primitive::Ellipsoid { r } => ellipsoid_distance(q, r),
            Primitive::Cylinder { r, height, axis } => cylinder_distance(q, r, height, axis),
        }
    }
}

/// Union `primitive` (centered at `center`, colored `color`) into the field: each
/// node takes the smooth-min of its current distance and the primitive's, and any
/// node the primitive is now nearer than the prior surface takes the primitive's
/// color (and, if `sharp`, its sharp tag).
fn add(
    field: &mut Field,
    primitive: Primitive,
    center: [f32; 3],
    color: Rgb,
    blend: f32,
    sharp: bool,
) {
    for_each_node(field, |field, i, j, k| {
        let idx = field.index(i, j, k);
        let d = primitive.distance(field.node_world(i, j, k), center);
        let current = field.sdf[idx];
        if d < current {
            field.color[idx] = color;
            if sharp {
                field.sharp[idx] = true;
            }
        }
        field.sdf[idx] = smin(current, d, blend);
    });
}

/// Carve `primitive` (centered at `center`) out of the field: each node takes the
/// smooth-max of its current distance and the primitive's negated distance. A node
/// whose new surface is the carve boundary takes the sharp tag when `sharp` is set;
/// color is left untouched (removing material adds no color).
fn subtract(field: &mut Field, primitive: Primitive, center: [f32; 3], blend: f32, sharp: bool) {
    for_each_node(field, |field, i, j, k| {
        let idx = field.index(i, j, k);
        let removed = -primitive.distance(field.node_world(i, j, k), center);
        let current = field.sdf[idx];
        if sharp && removed > current {
            field.sharp[idx] = true;
        }
        field.sdf[idx] = smax(current, removed, blend);
    });
}

/// Reflect the low side of the field (coordinate `< at` along `plane`) onto the high
/// side, unioning it in — the far half's existing detail survives where the
/// reflection is farther.
fn mirror(field: &mut Field, plane: Axis, at: f32) {
    let axis = axis_index(plane);
    let source = field.clone();
    for_each_node(field, |field, i, j, k| {
        let mut p = field.node_world(i, j, k);
        if p[axis] <= at {
            return;
        }
        p[axis] = 2.0 * at - p[axis];
        if let Some((sd, color, sharp)) = source.sample_nearest(p) {
            let idx = field.index(i, j, k);
            if sd < field.sdf[idx] {
                field.sdf[idx] = sd;
                field.color[idx] = color;
                field.sharp[idx] = field.sharp[idx] || sharp;
            }
        }
    });
}

/// Shift the whole field by `delta`: each node resamples the pre-shift field at its
/// source position, reading empty where that falls outside the volume.
fn translate(field: &mut Field, delta: [f32; 3]) {
    let source = field.clone();
    for_each_node(field, |field, i, j, k| {
        let idx = field.index(i, j, k);
        let p = field.node_world(i, j, k);
        let src = [p[0] - delta[0], p[1] - delta[1], p[2] - delta[2]];
        match source.sample_nearest(src) {
            Some((sd, color, sharp)) => {
                field.sdf[idx] = sd;
                field.color[idx] = color;
                field.sharp[idx] = sharp;
            }
            None => {
                field.sdf[idx] = OUTSIDE;
                field.color[idx] = EMPTY_COLOR;
                field.sharp[idx] = false;
            }
        }
    });
}

/// Copy the field within the source box (`min`/`ext`) to a destination offset by
/// `delta`, unioning it into the destination.
fn copy(field: &mut Field, min: [f32; 3], ext: [f32; 3], delta: [f32; 3]) {
    let source = field.clone();
    let dest_min = [min[0] + delta[0], min[1] + delta[1], min[2] + delta[2]];
    for_each_node(field, |field, i, j, k| {
        let p = field.node_world(i, j, k);
        if !in_box(p, dest_min, ext) {
            return;
        }
        let src = [p[0] - delta[0], p[1] - delta[1], p[2] - delta[2]];
        if let Some((sd, color, sharp)) = source.sample_nearest(src) {
            let idx = field.index(i, j, k);
            if sd < field.sdf[idx] {
                field.sdf[idx] = sd;
                field.color[idx] = color;
                field.sharp[idx] = field.sharp[idx] || sharp;
            }
        }
    });
}

/// Reset every node to empty.
fn clear(field: &mut Field) {
    for value in field.sdf.iter_mut() {
        *value = OUTSIDE;
    }
    for color in field.color.iter_mut() {
        *color = EMPTY_COLOR;
    }
    for sharp in field.sharp.iter_mut() {
        *sharp = false;
    }
}

/// Visit every grid node `(i, j, k)`, calling `f` with the field and the node
/// indices. `f` re-borrows the field so it can both read node positions and mutate
/// the parallel arrays.
fn for_each_node(field: &mut Field, mut f: impl FnMut(&mut Field, u32, u32, u32)) {
    let (nx, ny, nz) = (field.res.nx, field.res.ny, field.res.nz);
    for k in 0..nz {
        for j in 0..ny {
            for i in 0..nx {
                f(field, i, j, k);
            }
        }
    }
}

/// Whether world point `p` lies within the box of minimum corner `min` and extents
/// `ext`, with a small tolerance so nodes on the boundary count.
fn in_box(p: [f32; 3], min: [f32; 3], ext: [f32; 3]) -> bool {
    const EPS: f32 = 1.0e-3;
    (0..3).all(|a| (min[a] - EPS..=min[a] + ext[a] + EPS).contains(&p[a]))
}

/// The array index (`0`/`1`/`2`) of a principal axis.
fn axis_index(axis: Axis) -> usize {
    match axis {
        Axis::X => 0,
        Axis::Y => 1,
        Axis::Z => 2,
    }
}

/// The smooth minimum of `a` and `b` with radius `k` (a polynomial soft-min). A
/// non-positive `k` is a hard `min`, which leaves a genuine crease in the field.
fn smin(a: f32, b: f32, k: f32) -> f32 {
    if k <= 0.0 {
        return a.min(b);
    }
    let h = (0.5 + 0.5 * (b - a) / k).clamp(0.0, 1.0);
    mix(b, a, h) - k * h * (1.0 - h)
}

/// The smooth maximum of `a` and `b` with radius `k`, as the dual of [`smin`]. Used
/// for smooth subtraction (max of the solid and the negated carve).
fn smax(a: f32, b: f32, k: f32) -> f32 {
    -smin(-a, -b, k)
}

/// Linear interpolation from `a` to `b` by `t`.
fn mix(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

/// The signed distance from `q` (a point relative to the box center) to an
/// axis-aligned box of full extents `ext`.
fn box_distance(q: [f32; 3], ext: [f32; 3]) -> f32 {
    let d = [
        q[0].abs() - ext[0] * 0.5,
        q[1].abs() - ext[1] * 0.5,
        q[2].abs() - ext[2] * 0.5,
    ];
    let outside = length([d[0].max(0.0), d[1].max(0.0), d[2].max(0.0)]);
    let inside = d[0].max(d[1]).max(d[2]).min(0.0);
    outside + inside
}

/// The approximate signed distance from `q` (relative to the ellipsoid center) to an
/// ellipsoid of per-axis radii `r` (the standard IQ approximation). A zero radius
/// degrades gracefully rather than dividing by zero.
fn ellipsoid_distance(q: [f32; 3], r: [f32; 3]) -> f32 {
    let safe = [
        r[0].max(f32::EPSILON),
        r[1].max(f32::EPSILON),
        r[2].max(f32::EPSILON),
    ];
    let k0 = length([q[0] / safe[0], q[1] / safe[1], q[2] / safe[2]]);
    let k1 = length([
        q[0] / (safe[0] * safe[0]),
        q[1] / (safe[1] * safe[1]),
        q[2] / (safe[2] * safe[2]),
    ]);
    if k1 <= f32::EPSILON {
        // At the exact center the ratio is undefined; the nearest surface is the
        // smallest radius away.
        return -safe[0].min(safe[1]).min(safe[2]);
    }
    k0 * (k0 - 1.0) / k1
}

/// The signed distance from `q` (relative to the cylinder center) to a capped
/// cylinder of radius `r` and full length `height` extending along `axis`.
fn cylinder_distance(q: [f32; 3], r: f32, height: f32, axis: Axis) -> f32 {
    let a = axis_index(axis);
    let axial = q[a];
    // The two off-axis components form the radial plane.
    let radial: Vec<f32> = (0..3).filter(|&i| i != a).map(|i| q[i]).collect();
    let radial_len = (radial[0] * radial[0] + radial[1] * radial[1]).sqrt();
    let dx = radial_len - r;
    let dy = axial.abs() - height * 0.5;
    let outside = (dx.max(0.0).powi(2) + dy.max(0.0).powi(2)).sqrt();
    let inside = dx.max(dy).min(0.0);
    outside + inside
}

/// `a - b`, componentwise.
fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

/// The Euclidean length of a 3-vector.
fn length(v: [f32; 3]) -> f32 {
    (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt()
}

#[cfg(test)]
#[path = "ops.test.rs"]
mod tests;
