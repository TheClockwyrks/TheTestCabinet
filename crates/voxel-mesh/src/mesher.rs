//! The [`Mesher`] trait — a [`Field`] to a triangle [`Mesh`] — and a trivial
//! bounding-box [`StubMesher`].
//!
//! A mesher is the surface-extraction half of a meshing tool: it reads the composited
//! signed-distance field and emits the flat `positions`/`normals`/`colors`/`indices`
//! arrays the `PartMesh` contract carries (encoded to `.glb`; the same shape the
//! runtime's `PartMesh` and the shared preview renderer's `MeshView` use). The three real algorithms —
//! marching cubes, surface nets, and dual contouring — are each a `Mesher`
//! implementation added on top of this crate; they key off the per-algorithm
//! [`GridConfig`](crate::config::GridConfig) (the field's resolution, and whether
//! sharp-feature tags are honored). Until then this crate ships one [`StubMesher`]
//! that emits the field's occupied bounding box, so the crate compiles and the whole
//! record/preview pipeline can be wired now.

use serde::{Deserialize, Serialize};

use test_cabinet_model_core::color::Rgb;

use crate::field::Field;

/// A part's surface mesh as flat arrays: an indexed triangle list with a position,
/// normal, and linear `0..1` RGB color per vertex. This is the `PartMesh` shape,
/// so it encodes straight to a per-part `.glb` (a binary glTF) and every
/// consumer (the wgpu preview, the TypeScript runtime, the glTF exporter) reads the
/// mesh the Rust mesher emitted once.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Mesh {
    /// Vertex positions, 3 floats (x, y, z) per vertex, in world units.
    pub positions: Vec<f32>,
    /// Vertex normals, 3 floats per vertex.
    pub normals: Vec<f32>,
    /// Vertex colors, 3 floats (r, g, b) in `0..1` per vertex.
    pub colors: Vec<f32>,
    /// Triangle indices into the vertex arrays, 3 per triangle.
    pub indices: Vec<u32>,
}

impl Mesh {
    /// Whether this mesh has no triangles.
    pub fn is_empty(&self) -> bool {
        self.indices.is_empty()
    }

    /// Borrow this mesh's flat arrays as the shared renderer's [`MeshView`]. Available
    /// with the `cli` feature, which links the renderer stack.
    ///
    /// [`MeshView`]: test_cabinet_model_core::render::MeshView
    #[cfg(feature = "cli")]
    pub fn view(&self) -> test_cabinet_model_core::render::MeshView<'_> {
        test_cabinet_model_core::render::MeshView {
            positions: &self.positions,
            normals: &self.normals,
            colors: &self.colors,
            indices: &self.indices,
        }
    }
}

/// The surface-extraction half of a meshing tool: turn a composited field into a
/// triangle [`Mesh`]. Each of `mc`/`sn`/`dc` supplies one implementation, keyed off
/// the field's resolution (and, for dual contouring, the sharp-feature tags the field
/// carries).
pub trait Mesher {
    /// Extract the surface of `field` as a triangle mesh.
    fn mesh(&self, field: &Field) -> Mesh;
}

/// A placeholder mesher that emits the axis-aligned bounding box of the field's
/// occupied region (every node whose signed distance is negative), colored by the
/// deepest-inside node. It exists so the crate compiles and the record/preview
/// pipeline can be wired before the real surface-extraction algorithms land; it is
/// not one of the three shipped characters.
pub struct StubMesher;

impl Mesher for StubMesher {
    fn mesh(&self, field: &Field) -> Mesh {
        let (nx, ny, nz) = (field.res.nx, field.res.ny, field.res.nz);
        let mut min = [f32::INFINITY; 3];
        let mut max = [f32::NEG_INFINITY; 3];
        let mut best = f32::INFINITY;
        let mut color = Rgb([200, 200, 200]);
        let mut any = false;

        for k in 0..nz {
            for j in 0..ny {
                for i in 0..nx {
                    let idx = field.index(i, j, k);
                    if field.sdf[idx] >= 0.0 {
                        continue;
                    }
                    any = true;
                    let p = field.node_world(i, j, k);
                    for a in 0..3 {
                        min[a] = min[a].min(p[a]);
                        max[a] = max[a].max(p[a]);
                    }
                    // The deepest-inside node gives the box a representative color.
                    if field.sdf[idx] < best {
                        best = field.sdf[idx];
                        color = field.color[idx];
                    }
                }
            }
        }

        if !any {
            return Mesh::default();
        }
        box_mesh(min, max, color)
    }
}

/// One box face: its outward normal and four corners, each selecting the min (`0`) or
/// max (`1`) extreme per axis, in CCW order as seen from outside.
struct Face {
    normal: [f32; 3],
    corners: [[u8; 3]; 4],
}

// The six faces of an axis-aligned box, wound CCW outward (matching the cube mesher's
// winding), so the shared renderer lights the outward faces.
const FACES: [Face; 6] = [
    Face {
        normal: [-1.0, 0.0, 0.0],
        corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
    },
    Face {
        normal: [1.0, 0.0, 0.0],
        corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
    },
    Face {
        normal: [0.0, -1.0, 0.0],
        corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    },
    Face {
        normal: [0.0, 1.0, 0.0],
        corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
    },
    Face {
        normal: [0.0, 0.0, -1.0],
        corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
    },
    Face {
        normal: [0.0, 0.0, 1.0],
        corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    },
];

/// Build a solid axis-aligned box mesh spanning `min`..`max`, every vertex colored
/// `color` (normalized to `0..1`).
fn box_mesh(min: [f32; 3], max: [f32; 3], color: Rgb) -> Mesh {
    let extremes = [min, max];
    let [r, g, b] = color.0;
    let rgb = [r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0];

    let mut mesh = Mesh::default();
    let mut base: u32 = 0;
    for face in FACES.iter() {
        for corner in face.corners.iter() {
            for a in 0..3 {
                mesh.positions.push(extremes[corner[a] as usize][a]);
            }
            mesh.normals.extend_from_slice(&face.normal);
            mesh.colors.extend_from_slice(&rgb);
        }
        mesh.indices
            .extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
        base += 4;
    }
    mesh
}
