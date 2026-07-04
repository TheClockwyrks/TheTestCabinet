//! The cube surface mesher: a [`VoxelSet`] to a face-culled triangle [`PartMesh`].
//!
//! This is the Rust port of `packages/voxel-runtime/src/mesh.ts`'s `buildPartMesh`,
//! emitting the identical [`PartMesh`] shape (flat `positions`/`normals`/`colors`/
//! `indices` arrays). Each occupied voxel contributes only the unit-cube faces not
//! shared with an adjacent occupied voxel — interior faces are culled, so just the
//! visible surface is emitted (one quad → two triangles per exposed face). Colors
//! are baked per vertex as linear-order `[r, g, b]` in `0..1`, the same
//! normalization the TypeScript runtime uses, so the Rust mesher can run once and
//! the geometry it emits is what every consumer (the wgpu preview, the TS runtime,
//! and the glTF exporter) renders.

use serde::{Deserialize, Serialize};

use crate::VoxelSet;

/// A part's surface mesh as flat arrays: an indexed triangle list with a position,
/// normal, and linear `0..1` RGB color per vertex. Matches the runtime's `PartMesh`
/// so it encodes straight to a per-part `.glb` (four floats per exposed
/// face vertex, six indices per exposed face).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PartMesh {
    /// Vertex positions, 3 floats (x, y, z) per vertex, in voxel units.
    pub positions: Vec<f32>,
    /// Vertex normals, 3 floats per vertex (unit face normals).
    pub normals: Vec<f32>,
    /// Vertex colors, 3 floats (r, g, b) in `0..1` per vertex.
    pub colors: Vec<f32>,
    /// Triangle indices into the vertex arrays, 3 per triangle.
    pub indices: Vec<u32>,
}

/// One cube face: its outward normal and four corner offsets in CCW order (as seen
/// from outside), so standard front-facing winding keeps the outward faces.
struct Face {
    dir: [i32; 3],
    corners: [[i32; 3]; 4],
}

// Unit-cube faces from (x,y,z) to (x+1,y+1,z+1), matching `mesh.ts`'s `FACES`
// winding exactly so the emitted geometry is identical.
const FACES: [Face; 6] = [
    Face {
        dir: [-1, 0, 0],
        corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
    },
    Face {
        dir: [1, 0, 0],
        corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
    },
    Face {
        dir: [0, -1, 0],
        corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    },
    Face {
        dir: [0, 1, 0],
        corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
    },
    Face {
        dir: [0, 0, -1],
        corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
    },
    Face {
        dir: [0, 0, 1],
        corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    },
];

/// Build the surface mesh for a voxel set, culling interior faces and baking each
/// voxel's color into per-vertex `0..1` RGB. Voxels are visited in dense scan order
/// (x fastest, then y, then z — the dense cell index order); vertex numbering follows
/// that order, which affects only the index labels, not the geometry.
pub fn build_part_mesh(set: &VoxelSet) -> PartMesh {
    let (w, h) = (set.dims.width as i64, set.dims.height as i64);
    let mut positions: Vec<f32> = Vec::new();
    let mut normals: Vec<f32> = Vec::new();
    let mut colors: Vec<f32> = Vec::new();
    let mut indices: Vec<u32> = Vec::new();
    let mut base: u32 = 0;

    for (index, cell) in set.cells.iter().enumerate() {
        let Some(color) = cell else { continue };
        let i = index as i64;
        let x = i % w;
        let y = (i / w) % h;
        let z = i / (w * h);
        let [r, g, b] = color.0;
        let (rf, gf, bf) = (r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0);

        for face in FACES.iter() {
            let [dx, dy, dz] = face.dir;
            // Cull the face if the neighbor across it is occupied (an interior face).
            if set
                .get(x + dx as i64, y + dy as i64, z + dz as i64)
                .is_some()
            {
                continue;
            }
            for corner in face.corners.iter() {
                positions.push((x + corner[0] as i64) as f32);
                positions.push((y + corner[1] as i64) as f32);
                positions.push((z + corner[2] as i64) as f32);
                normals.push(dx as f32);
                normals.push(dy as f32);
                normals.push(dz as f32);
                colors.push(rf);
                colors.push(gf);
                colors.push(bf);
            }
            indices.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
            base += 4;
        }
    }

    PartMesh {
        positions,
        normals,
        colors,
        indices,
    }
}
