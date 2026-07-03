//! The voxel-sculpting tool for 3D asset-generation test cases.
//!
//! See `apps/docs/src/content/docs/testing/asset-generation/`. The model sculpts a
//! model by issuing [`Operation`]s through the `voxel` (static) or `voxel-anim`
//! (rigged) binary; the recorded list of operations — not the voxels left on disk —
//! is the authoritative output of a run. [`render`] turns that list back into a
//! voxel volume, and it is the **one** sculpting implementation: the binary calls
//! it to re-render the isometric preview after every operation, and `crates/core`
//! calls it to regenerate the scored voxel data and image from the recorded log.
//! Because both go through the same code, a volume produced by any other means
//! cannot match the regeneration — which is what makes the constrained sculpting
//! channel enforceable. This mirrors `crates/draw`, the 2D pixel analog.

#[cfg(feature = "cli")]
pub mod cli;
pub mod mesh;
pub mod ops;

// The generic model types live in `test-cabinet-model-core`. Re-export them (and
// their modules) here so this crate's public surface — and its downstream consumers
// like `crates/core`, which reach them as `test_cabinet_voxel::Rig`,
// `test_cabinet_voxel::rig::Keyframe`, `test_cabinet_voxel::color::Rgb`, etc. — is
// unchanged by the split.
pub use test_cabinet_model_core::{axis, color, rig};

pub use axis::Axis;
pub use color::{ColorError, PreviewBackground, Rgb};
pub use mesh::{PartMesh, build_part_mesh};
pub use ops::Operation;
pub use rig::{Animation, Drive, Interp, Joint, JointKind, Keyframe, Part, Rig, Track};

/// The bounding volume the model sculpts within: extents along each axis, in
/// voxels. `y` is the up axis.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Dims {
    /// Extent along x, in voxels.
    pub width: u32,
    /// Extent along y (up), in voxels.
    pub height: u32,
    /// Extent along z, in voxels.
    pub depth: u32,
}

/// A dense, row-major voxel grid: `width * height * depth` cells, each either empty
/// or a single opaque [`Rgb`].
///
/// This is the working volume every [`Operation`] mutates and the thing the cube
/// mesher turns into the surface mesh the preview renderer draws. It is a
/// deliberately small,
/// dependency-light structure rather than a general voxel type so the sculpting
/// logic stays trivial to reason about and identical between the binary and core.
/// The volume always starts empty; there is no "background voxel". Cell `(x, y, z)`
/// lives at index `x + y*width + z*width*height`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoxelSet {
    /// The volume's bounding extents.
    pub dims: Dims,
    /// Row-major cells, one per `(x, y, z)`; `None` is empty.
    pub cells: Vec<Option<Rgb>>,
}

impl VoxelSet {
    /// A new, fully empty volume of the given dimensions.
    pub fn empty(dims: Dims) -> VoxelSet {
        let count = dims.width as usize * dims.height as usize * dims.depth as usize;
        VoxelSet {
            dims,
            cells: vec![None; count],
        }
    }

    /// The cell index of `(x, y, z)`, or `None` if it lies outside the volume.
    fn offset(&self, x: i64, y: i64, z: i64) -> Option<usize> {
        let (w, h, d) = (
            self.dims.width as i64,
            self.dims.height as i64,
            self.dims.depth as i64,
        );
        if x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d {
            return None;
        }
        Some((x + y * w + z * w * h) as usize)
    }

    /// The color at `(x, y, z)`, or `None` if the cell is empty or off-volume.
    pub fn get(&self, x: i64, y: i64, z: i64) -> Option<Rgb> {
        self.cells[self.offset(x, y, z)?]
    }

    /// Set the voxel at `(x, y, z)`, replacing it. Off-volume writes are ignored.
    pub fn set(&mut self, x: i64, y: i64, z: i64, color: Rgb) {
        if let Some(offset) = self.offset(x, y, z) {
            self.cells[offset] = Some(color);
        }
    }

    /// Clear the voxel at `(x, y, z)`, emptying its cell. Off-volume clears are
    /// ignored.
    pub fn clear(&mut self, x: i64, y: i64, z: i64) {
        if let Some(offset) = self.offset(x, y, z) {
            self.cells[offset] = None;
        }
    }

    /// The number of occupied (non-empty) voxels in the volume.
    pub fn occupied_count(&self) -> usize {
        self.cells.iter().filter(|cell| cell.is_some()).count()
    }

    /// Serialize the occupied voxels as the sparse `voxels.json` document core's
    /// `VoxelsFile` reads: `{ "dims": { width, height, depth }, "voxels": [ { x, y,
    /// z, color } ] }`, in `x`/`y`/`z` scan order (x fastest, then y, then z — the
    /// dense index order), so the output is byte-stable.
    ///
    /// Built by hand rather than through `serde_json` so this stays available to
    /// core's validator, which links this crate with `default-features = false`
    /// (no `serde_json`). The shape is asserted against core's type in the tests.
    pub fn to_voxels_json(&self) -> String {
        let mut out = String::new();
        out.push_str(&format!(
            "{{\"dims\":{{\"width\":{},\"height\":{},\"depth\":{}}},\"voxels\":[",
            self.dims.width, self.dims.height, self.dims.depth
        ));
        let (w, h) = (self.dims.width as i64, self.dims.height as i64);
        let mut first = true;
        for (index, cell) in self.cells.iter().enumerate() {
            let Some(color) = cell else { continue };
            let i = index as i64;
            let x = i % w;
            let y = (i / w) % h;
            let z = i / (w * h);
            if !first {
                out.push(',');
            }
            first = false;
            out.push_str(&format!(
                "{{\"x\":{},\"y\":{},\"z\":{},\"color\":\"{}\"}}",
                x,
                y,
                z,
                color.to_hex()
            ));
        }
        out.push_str("]}");
        out
    }
}

/// Render an operation log into a voxel volume: start empty and apply each
/// operation in order. This is the authoritative sculpting logic shared by the
/// binaries' preview and core's post-run regeneration.
pub fn render(dims: &Dims, operations: &[Operation]) -> VoxelSet {
    let mut set = VoxelSet::empty(*dims);
    for operation in operations {
        operation.apply(&mut set);
    }
    set
}

#[cfg(test)]
#[path = "lib.test.rs"]
mod tests;
