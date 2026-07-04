//! Greedy quad-merged cube meshing: a [`VoxelSet`] to an optimized [`PartMesh`].
//!
//! [`build_part_mesh`](crate::mesh::build_part_mesh) emits the *reference* surface —
//! one two-triangle quad per exposed unit-cube face — which is faithful but highly
//! redundant: a flat wall of `N`×`N` voxels ships `2 N²` coplanar triangles that all
//! describe the same rectangle. This module is the cube analog of the meshing tools'
//! post-extraction QEM decimation, but built for the shape cube surfaces actually
//! have: axis-aligned, flat-shaded, one solid color per face. It runs the classic
//! **greedy meshing** pass — sweep each axis-aligned slice, mark the faces the slice
//! exposes, and merge same-color adjacent faces into the largest possible rectangles —
//! so that flat wall collapses to a single quad (two triangles).
//!
//! The result describes the **identical surface**: every merged rectangle covers
//! exactly the unit faces [`build_part_mesh`](crate::mesh::build_part_mesh) would emit,
//! with the same outward winding (so the geometry the preview renderer and the shipped
//! `.glb` carry is unchanged apart from triangle count), the same **hard per-face
//! normals** (a merged rectangle inherits its faces' shared axis normal, so flat cube
//! shading is preserved exactly), and the same per-vertex colors (a rectangle only ever
//! spans one voxel color — color boundaries are never crossed). It is a pure win: the
//! merged mesh is never larger than the reference and is gap-free by construction, since
//! merging only ever unions faces that already tile the same plane.
//!
//! This is what every voxel-family binary emits and streams; the reference mesher
//! remains the readable definition of *which* faces the surface has (and the parity
//! point with the TypeScript runtime's face-culling).

use crate::Rgb;
use crate::VoxelSet;
use crate::mesh::PartMesh;

/// One of the six axis-aligned face directions greedy meshing sweeps.
struct GreedyFace {
    /// The axis the face's normal points along: `0` = x, `1` = y, `2` = z.
    normal_axis: usize,
    /// `+1` if the face looks toward increasing `normal_axis`, `-1` toward decreasing.
    /// A face is exposed when the neighbor one step along `sign` is empty.
    sign: i64,
    /// The lower-indexed in-plane axis the rectangle spans (the mask's `u`).
    u_axis: usize,
    /// The higher-indexed in-plane axis the rectangle spans (the mask's `v`).
    v_axis: usize,
    /// The outward unit normal every vertex of this face carries.
    normal: [f32; 3],
    /// The four rectangle corners, each picking the rectangle's low (`0`) or high (`1`)
    /// extent along `(u, v)`, wound CCW as seen from outside — the same winding as
    /// [`crate::mesh`]'s unit-cube `FACES`, generalized from a unit square to the merged
    /// rectangle. Emitted as triangles `(0, 1, 2)` and `(0, 2, 3)`.
    corners: [(u8, u8); 4],
}

// The six faces, matching `mesh.rs`'s `FACES` winding exactly (a merged rectangle of one
// voxel reproduces that face's four vertices), so the greedy mesh's orientation is
// identical to the reference mesher's. A negative face sits on its layer's base plane,
// a positive face on the plane one step further along its normal axis.
const GREEDY_FACES: [GreedyFace; 6] = [
    GreedyFace {
        normal_axis: 0,
        sign: -1,
        u_axis: 1,
        v_axis: 2,
        normal: [-1.0, 0.0, 0.0],
        corners: [(0, 0), (0, 1), (1, 1), (1, 0)],
    },
    GreedyFace {
        normal_axis: 0,
        sign: 1,
        u_axis: 1,
        v_axis: 2,
        normal: [1.0, 0.0, 0.0],
        corners: [(0, 1), (0, 0), (1, 0), (1, 1)],
    },
    GreedyFace {
        normal_axis: 1,
        sign: -1,
        u_axis: 0,
        v_axis: 2,
        normal: [0.0, -1.0, 0.0],
        corners: [(0, 0), (1, 0), (1, 1), (0, 1)],
    },
    GreedyFace {
        normal_axis: 1,
        sign: 1,
        u_axis: 0,
        v_axis: 2,
        normal: [0.0, 1.0, 0.0],
        corners: [(0, 1), (1, 1), (1, 0), (0, 0)],
    },
    GreedyFace {
        normal_axis: 2,
        sign: -1,
        u_axis: 0,
        v_axis: 1,
        normal: [0.0, 0.0, -1.0],
        corners: [(1, 0), (0, 0), (0, 1), (1, 1)],
    },
    GreedyFace {
        normal_axis: 2,
        sign: 1,
        u_axis: 0,
        v_axis: 1,
        normal: [0.0, 0.0, 1.0],
        corners: [(0, 0), (1, 0), (1, 1), (0, 1)],
    },
];

/// Build the greedy quad-merged surface mesh for `set`: the same exposed-face surface
/// [`build_part_mesh`](crate::mesh::build_part_mesh) produces, with coplanar same-color
/// faces merged into maximal rectangles. Interior faces are culled (their neighbor is
/// occupied); each merged rectangle keeps its faces' hard axis normal and single color.
pub fn build_greedy_part_mesh(set: &VoxelSet) -> PartMesh {
    let dim = [
        set.dims.width as i64,
        set.dims.height as i64,
        set.dims.depth as i64,
    ];
    let mut mesh = PartMesh {
        positions: Vec::new(),
        normals: Vec::new(),
        colors: Vec::new(),
        indices: Vec::new(),
    };
    let mut base: u32 = 0;

    for face in &GREEDY_FACES {
        let (na, ua, va) = (face.normal_axis, face.u_axis, face.v_axis);
        let (dn, du, dv) = (dim[na], dim[ua], dim[va]);

        // Sweep every slice perpendicular to the normal axis.
        for kn in 0..dn {
            // The exposed-face mask over the slice's (u, v) plane: each cell holds the
            // color of the voxel here whose `face`-side neighbor is empty (an exposed
            // face), or `None` where there is no face to draw.
            let mut mask: Vec<Option<Rgb>> = vec![None; (du * dv) as usize];
            for iv in 0..dv {
                for iu in 0..du {
                    let mut coord = [0i64; 3];
                    coord[na] = kn;
                    coord[ua] = iu;
                    coord[va] = iv;
                    let Some(color) = set.get(coord[0], coord[1], coord[2]) else {
                        continue;
                    };
                    // Cull the face if the neighbor across it is occupied.
                    let mut neighbor = coord;
                    neighbor[na] += face.sign;
                    if set.get(neighbor[0], neighbor[1], neighbor[2]).is_some() {
                        continue;
                    }
                    mask[(iv * du + iu) as usize] = Some(color);
                }
            }

            // Greedy-merge the mask into maximal same-color rectangles.
            let mut visited = vec![false; (du * dv) as usize];
            for j in 0..dv {
                for i in 0..du {
                    let start = (j * du + i) as usize;
                    if visited[start] {
                        continue;
                    }
                    let Some(color) = mask[start] else {
                        continue;
                    };

                    // Grow the rectangle along u while cells match and are unclaimed.
                    let mut width = 1;
                    while i + width < du {
                        let cell = (j * du + i + width) as usize;
                        if visited[cell] || mask[cell] != Some(color) {
                            break;
                        }
                        width += 1;
                    }
                    // Grow along v while every cell of the [i, i+width) row matches.
                    let mut height = 1;
                    'grow: while j + height < dv {
                        for x in i..i + width {
                            let cell = ((j + height) * du + x) as usize;
                            if visited[cell] || mask[cell] != Some(color) {
                                break 'grow;
                            }
                        }
                        height += 1;
                    }
                    for y in j..j + height {
                        for x in i..i + width {
                            visited[(y * du + x) as usize] = true;
                        }
                    }

                    // Emit the merged rectangle as one quad (two triangles). A negative
                    // face sits on the slice's base plane, a positive face one step
                    // further along its normal axis.
                    let plane = if face.sign > 0 { kn + 1 } else { kn };
                    let [r, g, b] = color.0;
                    let rgb = [r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0];
                    for &(cu, cv) in &face.corners {
                        let mut p = [0i64; 3];
                        p[na] = plane;
                        p[ua] = i + cu as i64 * width;
                        p[va] = j + cv as i64 * height;
                        mesh.positions
                            .extend_from_slice(&[p[0] as f32, p[1] as f32, p[2] as f32]);
                        mesh.normals.extend_from_slice(&face.normal);
                        mesh.colors.extend_from_slice(&rgb);
                    }
                    mesh.indices.extend_from_slice(&[
                        base,
                        base + 1,
                        base + 2,
                        base,
                        base + 2,
                        base + 3,
                    ]);
                    base += 4;
                }
            }
        }
    }

    mesh
}

#[cfg(test)]
#[path = "greedy.test.rs"]
mod tests;
