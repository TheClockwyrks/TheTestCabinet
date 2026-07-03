//! The sculpting operations and how each one applies to the voxel volume.
//!
//! [`Operation`] is the wire form recorded in `actions.json`: an internally
//! tagged enum (`{ "op": "fill_box", … }`) mirroring the `Operation` convention in
//! `crates/draw`. Every operation is **total** — out-of-bounds writes are clipped,
//! never panics — so regenerating a volume from an arbitrary (even hostile) log
//! can always run to completion. All coordinate math is integer-only, so the
//! in-container preview and core's post-run regeneration produce identical voxels.

use serde::{Deserialize, Serialize};

use crate::VoxelSet;
use crate::axis::Axis;
use crate::color::Rgb;

/// A single sculpting operation the model issues through the `voxel` binary.
///
/// Coordinates are signed so a shape may be placed partially outside the volume
/// (the outside portion is clipped); sizes and radii are unsigned. Filling
/// operations **replace** the cells they touch and clearing operations empty them,
/// keeping regeneration an exact, order-only function of the log. Voxels are
/// opaque: there is no compositing to reproduce.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Operation {
    /// Set a single voxel.
    SetVoxel {
        /// Position along x (0 at the left).
        x: i64,
        /// Position along y (0 at the bottom, up is positive).
        y: i64,
        /// Position along z (0 at the front).
        z: i64,
        /// The voxel color.
        color: Rgb,
    },
    /// Fill an axis-aligned box. `(x, y, z)` is the minimum corner.
    FillBox {
        /// Minimum-corner x.
        x: i64,
        /// Minimum-corner y.
        y: i64,
        /// Minimum-corner z.
        z: i64,
        /// Extent along x, in voxels.
        width: u32,
        /// Extent along y, in voxels.
        height: u32,
        /// Extent along z, in voxels.
        depth: u32,
        /// The fill color.
        color: Rgb,
    },
    /// Fill only the shell (the 12 edges) of an axis-aligned box, leaving its
    /// interior and faces empty — the 3D analog of a rectangle outline.
    StrokeBox {
        /// Minimum-corner x.
        x: i64,
        /// Minimum-corner y.
        y: i64,
        /// Minimum-corner z.
        z: i64,
        /// Extent along x, in voxels.
        width: u32,
        /// Extent along y, in voxels.
        height: u32,
        /// Extent along z, in voxels.
        depth: u32,
        /// The edge color.
        color: Rgb,
    },
    /// Fill a solid ball centered at `(cx, cy, cz)` with radius `r`.
    FillSphere {
        /// Center x.
        cx: i64,
        /// Center y.
        cy: i64,
        /// Center z.
        cz: i64,
        /// Radius in voxels.
        r: u32,
        /// The fill color.
        color: Rgb,
    },
    /// Draw a 1-voxel-thick line between two points (inclusive of both endpoints)
    /// using 3D Bresenham.
    Line {
        /// Start x.
        x0: i64,
        /// Start y.
        y0: i64,
        /// Start z.
        z0: i64,
        /// End x.
        x1: i64,
        /// End y.
        y1: i64,
        /// End z.
        z1: i64,
        /// The line color.
        color: Rgb,
    },
    /// Mirror the voxels on the low side of a plane onto the high side, reflecting
    /// across the plane between slice `at - 1` and slice `at` along `plane`. The
    /// single highest-leverage op for a symmetric model.
    Mirror {
        /// The plane's normal axis: slices `0..at` are copied onto `at..`.
        plane: Axis,
        /// The mirror position along `plane`.
        at: u32,
    },
    /// Clear a single voxel, emptying its cell.
    ClearVoxel {
        /// Position along x.
        x: i64,
        /// Position along y.
        y: i64,
        /// Position along z.
        z: i64,
    },
    /// Clear an axis-aligned box, emptying every cell it covers. `(x, y, z)` is the
    /// minimum corner.
    ClearBox {
        /// Minimum-corner x.
        x: i64,
        /// Minimum-corner y.
        y: i64,
        /// Minimum-corner z.
        z: i64,
        /// Extent along x, in voxels.
        width: u32,
        /// Extent along y, in voxels.
        height: u32,
        /// Extent along z, in voxels.
        depth: u32,
    },
    /// Fill a solid cylinder of radius `r` and length `height` extending from the
    /// base plane through `(cx, cy, cz)` along the positive `axis` direction; the
    /// disc is centered on the two off-axis coordinates of `(cx, cy, cz)`. Ideal for
    /// barrels, legs, poles, and wheels.
    FillCylinder {
        /// Center x of the base disc (and, for `axis = x`, the base plane).
        cx: i64,
        /// Center y of the base disc (and, for `axis = y`, the base plane).
        cy: i64,
        /// Center z of the base disc (and, for `axis = z`, the base plane).
        cz: i64,
        /// Disc radius in voxels (in the plane perpendicular to `axis`).
        r: u32,
        /// Length along `axis` in voxels.
        height: u32,
        /// The axis the cylinder extends along.
        axis: Axis,
        /// The fill color.
        color: Rgb,
    },
    /// Fill a solid ellipsoid centered at `(cx, cy, cz)` with per-axis radii
    /// `(rx, ry, rz)` — the generalization of [`Operation::FillSphere`] to unequal
    /// radii (a dome, an egg, a squashed boulder).
    FillEllipsoid {
        /// Center x.
        cx: i64,
        /// Center y.
        cy: i64,
        /// Center z.
        cz: i64,
        /// Radius along x, in voxels.
        rx: u32,
        /// Radius along y, in voxels.
        ry: u32,
        /// Radius along z, in voxels.
        rz: u32,
        /// The fill color.
        color: Rgb,
    },
    /// Recolor every occupied voxel of color `from` to color `to`, across the whole
    /// volume, leaving empty cells and other colors untouched — a whole-model
    /// palette swap or shading pass.
    ReplaceColor {
        /// The color to match.
        from: Rgb,
        /// The color to write in its place.
        to: Rgb,
    },
    /// Shift every occupied voxel by `(dx, dy, dz)`, clearing the cells they vacate;
    /// voxels pushed outside the volume are dropped. Repositions an entire part.
    Translate {
        /// Shift along x, in voxels.
        dx: i64,
        /// Shift along y, in voxels.
        dy: i64,
        /// Shift along z, in voxels.
        dz: i64,
    },
    /// Copy the occupied voxels in a source box to a destination offset by
    /// `(dx, dy, dz)`, overwriting the destination cells (empty source cells do not
    /// clear the destination). Source and destination may overlap. `(x, y, z)` is
    /// the source box's minimum corner — handy to duplicate a detail (a second
    /// wheel, a repeated rivet).
    CopyBox {
        /// Source minimum-corner x.
        x: i64,
        /// Source minimum-corner y.
        y: i64,
        /// Source minimum-corner z.
        z: i64,
        /// Source extent along x, in voxels.
        width: u32,
        /// Source extent along y, in voxels.
        height: u32,
        /// Source extent along z, in voxels.
        depth: u32,
        /// Destination offset along x, in voxels.
        dx: i64,
        /// Destination offset along y, in voxels.
        dy: i64,
        /// Destination offset along z, in voxels.
        dz: i64,
    },
}

impl Operation {
    /// Apply this operation to the voxel set in place. Always succeeds: anything
    /// that would fall outside the volume is clipped.
    pub fn apply(&self, set: &mut VoxelSet) {
        match *self {
            Operation::SetVoxel { x, y, z, color } => set.set(x, y, z, color),
            Operation::FillBox {
                x,
                y,
                z,
                width,
                height,
                depth,
                color,
            } => {
                for dz in 0..depth as i64 {
                    for dy in 0..height as i64 {
                        for dx in 0..width as i64 {
                            set.set(x + dx, y + dy, z + dz, color);
                        }
                    }
                }
            }
            Operation::StrokeBox {
                x,
                y,
                z,
                width,
                height,
                depth,
                color,
            } => {
                if width == 0 || height == 0 || depth == 0 {
                    return;
                }
                let (w, h, d) = (width as i64, height as i64, depth as i64);
                for dz in 0..d {
                    for dy in 0..h {
                        for dx in 0..w {
                            // A cell is on an edge when at least two of its three
                            // coordinates sit on an extreme face of the box.
                            let on_x = dx == 0 || dx == w - 1;
                            let on_y = dy == 0 || dy == h - 1;
                            let on_z = dz == 0 || dz == d - 1;
                            if u8::from(on_x) + u8::from(on_y) + u8::from(on_z) >= 2 {
                                set.set(x + dx, y + dy, z + dz, color);
                            }
                        }
                    }
                }
            }
            Operation::FillSphere {
                cx,
                cy,
                cz,
                r,
                color,
            } => {
                let r = r as i64;
                for dz in -r..=r {
                    for dy in -r..=r {
                        for dx in -r..=r {
                            if dx * dx + dy * dy + dz * dz <= r * r {
                                set.set(cx + dx, cy + dy, cz + dz, color);
                            }
                        }
                    }
                }
            }
            Operation::Line {
                x0,
                y0,
                z0,
                x1,
                y1,
                z1,
                color,
            } => draw_line(set, x0, y0, z0, x1, y1, z1, color),
            Operation::Mirror { plane, at } => mirror(set, plane, at),
            Operation::ClearVoxel { x, y, z } => set.clear(x, y, z),
            Operation::ClearBox {
                x,
                y,
                z,
                width,
                height,
                depth,
            } => {
                for dz in 0..depth as i64 {
                    for dy in 0..height as i64 {
                        for dx in 0..width as i64 {
                            set.clear(x + dx, y + dy, z + dz);
                        }
                    }
                }
            }
            Operation::FillCylinder {
                cx,
                cy,
                cz,
                r,
                height,
                axis,
                color,
            } => fill_cylinder(set, cx, cy, cz, r, height, axis, color),
            Operation::FillEllipsoid {
                cx,
                cy,
                cz,
                rx,
                ry,
                rz,
                color,
            } => {
                let (rx, ry, rz) = (rx as i64, ry as i64, rz as i64);
                // Integer ellipsoid test, cross-multiplied to avoid division (and
                // division by a zero radius): a cell is inside when
                //   (dx·ry·rz)² + (dy·rx·rz)² + (dz·rx·ry)² <= (rx·ry·rz)².
                let bound = rx * rx * ry * ry * rz * rz;
                for dz in -rz..=rz {
                    for dy in -ry..=ry {
                        for dx in -rx..=rx {
                            let ex = dx * ry * rz;
                            let ey = dy * rx * rz;
                            let ez = dz * rx * ry;
                            if ex * ex + ey * ey + ez * ez <= bound {
                                set.set(cx + dx, cy + dy, cz + dz, color);
                            }
                        }
                    }
                }
            }
            Operation::ReplaceColor { from, to } => {
                for cell in set.cells.iter_mut() {
                    if *cell == Some(from) {
                        *cell = Some(to);
                    }
                }
            }
            Operation::Translate { dx, dy, dz } => {
                // Snapshot the occupied voxels, clear the volume, then rewrite each
                // at its shifted position (off-volume targets are clipped away).
                let source = set.clone();
                for cell in set.cells.iter_mut() {
                    *cell = None;
                }
                let (w, h) = (set.dims.width as i64, set.dims.height as i64);
                for (index, cell) in source.cells.iter().enumerate() {
                    let Some(color) = cell else { continue };
                    let i = index as i64;
                    let x = i % w;
                    let y = (i / w) % h;
                    let z = i / (w * h);
                    set.set(x + dx, y + dy, z + dz, *color);
                }
            }
            Operation::CopyBox {
                x,
                y,
                z,
                width,
                height,
                depth,
                dx,
                dy,
                dz,
            } => {
                // Read the source region first, so an overlapping destination copies
                // the original voxels rather than ones it just wrote.
                let mut samples = Vec::new();
                for sz in 0..depth as i64 {
                    for sy in 0..height as i64 {
                        for sx in 0..width as i64 {
                            if let Some(color) = set.get(x + sx, y + sy, z + sz) {
                                samples.push((sx, sy, sz, color));
                            }
                        }
                    }
                }
                for (sx, sy, sz, color) in samples {
                    set.set(x + sx + dx, y + sy + dy, z + sz + dz, color);
                }
            }
        }
    }

    /// The wire tag of this operation, for the human-readable confirmation line the
    /// binaries print.
    pub fn name(&self) -> &'static str {
        match self {
            Operation::SetVoxel { .. } => "set_voxel",
            Operation::FillBox { .. } => "fill_box",
            Operation::StrokeBox { .. } => "stroke_box",
            Operation::FillSphere { .. } => "fill_sphere",
            Operation::Line { .. } => "line",
            Operation::Mirror { .. } => "mirror",
            Operation::ClearVoxel { .. } => "clear_voxel",
            Operation::ClearBox { .. } => "clear_box",
            Operation::FillCylinder { .. } => "fill_cylinder",
            Operation::FillEllipsoid { .. } => "fill_ellipsoid",
            Operation::ReplaceColor { .. } => "replace_color",
            Operation::Translate { .. } => "translate",
            Operation::CopyBox { .. } => "copy_box",
        }
    }
}

/// Fill a solid cylinder of radius `r` and length `height` from the base plane
/// through `(cx, cy, cz)` along the positive `axis` direction. The disc is centered
/// on the two coordinates of `(cx, cy, cz)` off the extrusion axis; a cell is inside
/// when its in-plane distance from that center is within `r`. Off-volume cells clip.
#[allow(clippy::too_many_arguments)]
fn fill_cylinder(
    set: &mut VoxelSet,
    cx: i64,
    cy: i64,
    cz: i64,
    r: u32,
    height: u32,
    axis: Axis,
    color: Rgb,
) {
    let r = r as i64;
    let height = height as i64;
    for len in 0..height {
        for a in -r..=r {
            for b in -r..=r {
                if a * a + b * b > r * r {
                    continue;
                }
                // `a`/`b` span the plane perpendicular to `axis`; `len` runs along it.
                let (x, y, z) = match axis {
                    Axis::X => (cx + len, cy + a, cz + b),
                    Axis::Y => (cx + a, cy + len, cz + b),
                    Axis::Z => (cx + a, cy + b, cz + len),
                };
                set.set(x, y, z, color);
            }
        }
    }
}

/// 3D Bresenham's line algorithm between two inclusive endpoints, stepping along
/// the dominant axis so every intermediate cell is set exactly once.
#[allow(clippy::too_many_arguments)]
fn draw_line(set: &mut VoxelSet, x0: i64, y0: i64, z0: i64, x1: i64, y1: i64, z1: i64, color: Rgb) {
    let (mut x, mut y, mut z) = (x0, y0, z0);
    let dx = (x1 - x0).abs();
    let dy = (y1 - y0).abs();
    let dz = (z1 - z0).abs();
    let sx = if x1 >= x0 { 1 } else { -1 };
    let sy = if y1 >= y0 { 1 } else { -1 };
    let sz = if z1 >= z0 { 1 } else { -1 };

    if dx >= dy && dx >= dz {
        // x is the dominant axis.
        let mut ey = 2 * dy - dx;
        let mut ez = 2 * dz - dx;
        for _ in 0..=dx {
            set.set(x, y, z, color);
            if ey >= 0 {
                y += sy;
                ey -= 2 * dx;
            }
            if ez >= 0 {
                z += sz;
                ez -= 2 * dx;
            }
            ey += 2 * dy;
            ez += 2 * dz;
            x += sx;
        }
    } else if dy >= dx && dy >= dz {
        // y is the dominant axis.
        let mut ex = 2 * dx - dy;
        let mut ez = 2 * dz - dy;
        for _ in 0..=dy {
            set.set(x, y, z, color);
            if ex >= 0 {
                x += sx;
                ex -= 2 * dy;
            }
            if ez >= 0 {
                z += sz;
                ez -= 2 * dy;
            }
            ex += 2 * dx;
            ez += 2 * dz;
            y += sy;
        }
    } else {
        // z is the dominant axis.
        let mut ex = 2 * dx - dz;
        let mut ey = 2 * dy - dz;
        for _ in 0..=dz {
            set.set(x, y, z, color);
            if ex >= 0 {
                x += sx;
                ex -= 2 * dz;
            }
            if ey >= 0 {
                y += sy;
                ey -= 2 * dz;
            }
            ex += 2 * dx;
            ey += 2 * dy;
            z += sz;
        }
    }
}

/// Reflect the occupied voxels on the low side of a plane onto the high side.
///
/// Slice `s` in `0..at` along `plane` is copied to slice `2*at - 1 - s`, mirroring
/// draw's `MirrorHorizontal`: only occupied source cells are copied, so a partial
/// model reflects cleanly without wiping the far half's existing detail with holes.
fn mirror(set: &mut VoxelSet, plane: Axis, at: u32) {
    let at = at as i64;
    let (w, h, d) = (
        set.dims.width as i64,
        set.dims.height as i64,
        set.dims.depth as i64,
    );
    match plane {
        Axis::X => {
            for s in 0..at {
                let m = 2 * at - 1 - s;
                for y in 0..h {
                    for z in 0..d {
                        if let Some(c) = set.get(s, y, z) {
                            set.set(m, y, z, c);
                        }
                    }
                }
            }
        }
        Axis::Y => {
            for s in 0..at {
                let m = 2 * at - 1 - s;
                for x in 0..w {
                    for z in 0..d {
                        if let Some(c) = set.get(x, s, z) {
                            set.set(x, m, z, c);
                        }
                    }
                }
            }
        }
        Axis::Z => {
            for s in 0..at {
                let m = 2 * at - 1 - s;
                for x in 0..w {
                    for y in 0..h {
                        if let Some(c) = set.get(x, y, s) {
                            set.set(x, y, m, c);
                        }
                    }
                }
            }
        }
    }
}
