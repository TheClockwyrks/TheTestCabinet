//! The scalar signed-distance [`Field`] sampled on a uniform grid, and the volume
//! bounds ([`Dims`]) and grid [`Resolution`] that frame it.
//!
//! A field is the continuous analog of the cube tool's `VoxelSet`: instead of a
//! dense grid of opaque cells, it stores, at each node of a uniform grid over the
//! declared volume, the **signed distance** to the composited surface (negative
//! inside the solid, positive outside, zero on the surface) plus an opaque `#rrggbb`
//! [`Rgb`] color carried from the nearest contributing region and a DC-only sharp
//! flag. The field is *authored by CSG primitives*: it starts empty (every node far
//! outside) and each [`FieldOp`](crate::ops::FieldOp) composites a primitive into
//! the grid. The volume is framed the same way as the cube volume — `x` across, `y`
//! up, `z` depth — but sampled at a resolution chosen per algorithm (MC coarse, SN
//! medium, DC fine), which is what makes the same authored field mesh at each
//! algorithm's characteristic fidelity.

use test_cabinet_model_core::color::Rgb;

/// The signed distance stored at a node no primitive has reached yet: a large but
/// finite positive value, so the smooth-blend (soft-min) arithmetic that composites
/// primitives stays finite.
pub const OUTSIDE: f32 = 1.0e30;

/// The placeholder color of a node no primitive has colored yet. Only nodes on or
/// inside the composited surface carry a meaningful color; this is what the empty
/// exterior reads as.
pub const EMPTY_COLOR: Rgb = Rgb([128, 128, 128]);

/// The bounding volume a field is sampled over: world-space extents along each axis.
/// `y` is the up axis. These match the manifest `[voxel]` volume table (the cube
/// tool's `width`/`height`/`depth`), read here as floats because the field is
/// continuous.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Dims {
    /// Extent along x (across).
    pub width: f32,
    /// Extent along y (up).
    pub height: f32,
    /// Extent along z (depth).
    pub depth: f32,
}

impl Dims {
    /// A volume of the given world-space extents.
    pub fn new(width: f32, height: f32, depth: f32) -> Dims {
        Dims {
            width,
            height,
            depth,
        }
    }

    /// The extents as an `[x, y, z]` array.
    pub fn as_array(&self) -> [f32; 3] {
        [self.width, self.height, self.depth]
    }
}

/// The number of grid nodes along each axis. A field with `n` nodes on an axis has
/// `n - 1` cells spanning the volume's extent on that axis; a node count is always at
/// least 2 so every axis has a well-defined spacing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Resolution {
    /// Node count along x.
    pub nx: u32,
    /// Node count along y.
    pub ny: u32,
    /// Node count along z.
    pub nz: u32,
}

impl Resolution {
    /// The total number of grid nodes (`nx * ny * nz`).
    pub fn count(&self) -> usize {
        self.nx as usize * self.ny as usize * self.nz as usize
    }
}

/// A scalar signed-distance field sampled on a uniform grid over [`Self::bounds`].
///
/// Every parallel array holds one entry per grid node in `x`-fastest scan order
/// (`i + j*nx + k*nx*ny`): [`Self::sdf`] the signed distance (negative inside),
/// [`Self::color`] the opaque color carried from the nearest additive primitive, and
/// [`Self::sharp`] whether a sharp-tagged primitive shaped that node (a DC-only hint
/// mc/sn ignore). The field always starts empty via [`Field::empty`]; the ops in
/// [`crate::ops`] composite primitives into it.
#[derive(Debug, Clone, PartialEq)]
pub struct Field {
    /// The world-space volume the grid spans.
    pub bounds: Dims,
    /// The grid node counts per axis.
    pub res: Resolution,
    /// Signed distance at each node: negative inside the solid, positive outside.
    pub sdf: Vec<f32>,
    /// The opaque color carried at each node (from the nearest additive primitive).
    pub color: Vec<Rgb>,
    /// Whether each node was shaped by a sharp-tagged primitive (DC-only).
    pub sharp: Vec<bool>,
}

impl Field {
    /// A new, fully empty field of `res` nodes over `bounds`: every node far outside,
    /// uncolored, and not sharp.
    pub fn empty(bounds: Dims, res: Resolution) -> Field {
        let count = res.count();
        Field {
            bounds,
            res,
            sdf: vec![OUTSIDE; count],
            color: vec![EMPTY_COLOR; count],
            sharp: vec![false; count],
        }
    }

    /// The flat array index of node `(i, j, k)` in `x`-fastest scan order.
    pub fn index(&self, i: u32, j: u32, k: u32) -> usize {
        let (nx, ny) = (self.res.nx as usize, self.res.ny as usize);
        i as usize + j as usize * nx + k as usize * nx * ny
    }

    /// The node spacing `[dx, dy, dz]` — the world distance between adjacent nodes on
    /// each axis. An axis with a single node (which [`Resolution`] does not produce)
    /// would report a spacing of `0`.
    pub fn spacing(&self) -> [f32; 3] {
        let [w, h, d] = self.bounds.as_array();
        [
            axis_spacing(w, self.res.nx),
            axis_spacing(h, self.res.ny),
            axis_spacing(d, self.res.nz),
        ]
    }

    /// The world-space position of node `(i, j, k)`.
    pub fn node_world(&self, i: u32, j: u32, k: u32) -> [f32; 3] {
        let [dx, dy, dz] = self.spacing();
        [i as f32 * dx, j as f32 * dy, k as f32 * dz]
    }

    /// Sample the field at the node nearest `world`, returning its `(sdf, color,
    /// sharp)`. Returns `None` when `world` falls outside the volume bounds — so a
    /// whole-field op that reads from a vacated region reads it as empty rather than
    /// smearing an edge node across it.
    pub fn sample_nearest(&self, world: [f32; 3]) -> Option<(f32, Rgb, bool)> {
        let [dx, dy, dz] = self.spacing();
        let [w, h, d] = self.bounds.as_array();
        let i = nearest_node(world[0], dx, w, self.res.nx)?;
        let j = nearest_node(world[1], dy, h, self.res.ny)?;
        let k = nearest_node(world[2], dz, d, self.res.nz)?;
        let idx = self.index(i, j, k);
        Some((self.sdf[idx], self.color[idx], self.sharp[idx]))
    }
}

/// The spacing between adjacent nodes on an axis of `extent` world units with `n`
/// nodes: `extent / (n - 1)`, or `0` for a degenerate single-node axis.
fn axis_spacing(extent: f32, n: u32) -> f32 {
    if n <= 1 { 0.0 } else { extent / (n - 1) as f32 }
}

/// The index of the node nearest `coord` on an axis of `extent` world units with `n`
/// nodes at spacing `step`, or `None` when `coord` lies outside `[0, extent]` (with a
/// small tolerance). The returned index is clamped into `0..n`.
fn nearest_node(coord: f32, step: f32, extent: f32, n: u32) -> Option<u32> {
    let eps = step * 0.5 + 1.0e-3;
    if !(-eps..=extent + eps).contains(&coord) {
        return None;
    }
    if step <= 0.0 {
        return Some(0);
    }
    let idx = (coord / step).round();
    let clamped = idx.clamp(0.0, (n - 1) as f32);
    Some(clamped as u32)
}
