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
use crate::color::Rgb;

/// A principal axis, used as the plane normal of a [`Operation::Mirror`].
///
/// `y` is the up axis, matching the voxel volume's `height`; `x`/`z` are the two
/// horizontal axes (`width`/`depth`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "cli", derive(clap::ValueEnum))]
pub enum Axis {
    /// The x axis (volume width).
    X,
    /// The y axis (volume height, up).
    Y,
    /// The z axis (volume depth).
    Z,
}

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
