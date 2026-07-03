//! The naive dual **surface nets** mesher — the smooth, uniform, mid-fidelity
//! character of the `sn` tool.
//!
//! [`SurfaceNetsMesher`] places **one vertex per grid cell** that straddles the
//! surface (a cell whose eight corner distances are not all the same sign),
//! positioning that vertex at the **centroid of the cell's zero crossings** — the
//! points where the surface cuts the cell's edges, each found by linear
//! interpolation of the two corner distances. It then walks every interior grid
//! edge that changes sign and emits one **quad** (two triangles) joining the four
//! cells that share that edge, wound by the sign direction so the surface is
//! consistently oriented. Because every cell contributes at most one welded vertex
//! and every crossing edge exactly one quad, a closed field meshes to a watertight,
//! 2-manifold surface of uniform triangle density.
//!
//! Per the algorithm's character it samples at the medium
//! [`GridConfig::surface_nets`](crate::config::GridConfig::surface_nets) resolution
//! and **rounds every feature** — it ignores the field's sharp tags entirely, which
//! is what gives its output the smooth, rounded look (sharp edges and corners are
//! the province of dual contouring). Normals are the central-difference gradient of
//! the trilinearly sampled distance field, so the smoothed surface is lit by its
//! true normal; each vertex takes the opaque color of the nearest inside corner of
//! its cell, normalized to `0..1` for the `PartMesh` contract (encoded to `.glb`).

use test_cabinet_model_core::color::Rgb;

use crate::field::{Field, PAD};
use crate::mesher::{Mesh, Mesher};

/// The medium-resolution surface-nets surface extractor. Meshes a field sampled at
/// the [`GridConfig::surface_nets`](crate::config::GridConfig::surface_nets) preset
/// into the smooth, rounded, watertight surface of uniform density that
/// characterizes the `sn` tool.
pub struct SurfaceNetsMesher;

impl Mesher for SurfaceNetsMesher {
    fn mesh(&self, field: &Field) -> Mesh {
        surface_nets(field)
    }
}

/// The `(i, j, k)` offset of each of a cell's eight corners, numbered
/// `dx + 2*dy + 4*dz` so that corners `1`, `2`, and `4` are the `+x`, `+y`, and `+z`
/// neighbours of corner `0` (the cell's minimum corner). The quad pass keys off that
/// numbering.
const CORNERS: [[u32; 3]; 8] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
];

/// The two corner indices spanned by each of a cell's twelve edges. The first three
/// entries are the axis edges leaving corner `0` along `+x`, `+y`, `+z`; the
/// remaining nine complete the cube. Every crossing edge contributes its zero-crossing
/// point to the cell's vertex centroid.
const EDGES: [[usize; 2]; 12] = [
    [0, 1],
    [0, 2],
    [0, 4],
    [1, 3],
    [1, 5],
    [2, 3],
    [2, 6],
    [3, 7],
    [4, 5],
    [4, 6],
    [5, 7],
    [6, 7],
];

/// Extract the zero-isosurface of `field` with naive dual surface nets.
fn surface_nets(field: &Field) -> Mesh {
    let (nx, ny, nz) = (field.res.nx, field.res.ny, field.res.nz);
    if nx < 2 || ny < 2 || nz < 2 {
        return Mesh::default();
    }
    // Cell counts per axis (one fewer than the node count on each axis).
    let (cnx, cny, cnz) = (nx - 1, ny - 1, nz - 1);
    let cell_stride = [1usize, cnx as usize, cnx as usize * cny as usize];
    let cell_lin = |cx: u32, cy: u32, cz: u32| -> usize {
        cx as usize * cell_stride[0] + cy as usize * cell_stride[1] + cz as usize * cell_stride[2]
    };

    let mut mesh = Mesh::default();
    // The welded vertex index for each cell, or `-1` where the cell has no vertex.
    let mut vertex_index: Vec<i32> = vec![-1; cnx as usize * cny as usize * cnz as usize];

    // Pass 1: one vertex per straddling cell, at the centroid of its edge crossings.
    for cz in 0..cnz {
        for cy in 0..cny {
            for cx in 0..cnx {
                let mut val = [0f32; 8];
                let mut pos = [[0f32; 3]; 8];
                let mut col = [Rgb([128, 128, 128]); 8];
                let mut mask = 0u32;
                for (c, off) in CORNERS.iter().enumerate() {
                    let (i, j, k) = (cx + off[0], cy + off[1], cz + off[2]);
                    let idx = field.index(i, j, k);
                    val[c] = field.sdf[idx];
                    pos[c] = field.node_world(i, j, k);
                    col[c] = field.color[idx];
                    if val[c] < 0.0 {
                        mask |= 1 << c;
                    }
                }
                // No sign change (wholly inside or wholly outside): no vertex.
                if mask == 0 || mask == 0xff {
                    continue;
                }

                // Average the zero crossings of every sign-changing edge.
                let mut sum = [0f32; 3];
                let mut crossings = 0u32;
                for edge in EDGES.iter() {
                    let (a, b) = (edge[0], edge[1]);
                    if (val[a] < 0.0) == (val[b] < 0.0) {
                        continue;
                    }
                    let denom = val[b] - val[a];
                    let t = if denom.abs() < 1.0e-9 {
                        0.5
                    } else {
                        (-val[a] / denom).clamp(0.0, 1.0)
                    };
                    for ax in 0..3 {
                        sum[ax] += pos[a][ax] + t * (pos[b][ax] - pos[a][ax]);
                    }
                    crossings += 1;
                }
                let inv = 1.0 / crossings as f32;
                let vpos = [sum[0] * inv, sum[1] * inv, sum[2] * inv];

                // Color from the inside corner nearest the vertex (there is always at
                // least one inside corner here), so the surface carries material color
                // rather than the empty exterior's placeholder.
                let mut best = f32::INFINITY;
                let mut vcolor = Rgb([128, 128, 128]);
                for ((v, p), c) in val.iter().zip(pos.iter()).zip(col.iter()) {
                    if *v < 0.0 {
                        let d = dist2(*p, vpos);
                        if d < best {
                            best = d;
                            vcolor = *c;
                        }
                    }
                }
                let [r, g, b] = vcolor.0;
                let rgb = [r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0];

                let normal = gradient_normal(field, vpos);
                let vi = (mesh.positions.len() / 3) as u32;
                mesh.positions.extend_from_slice(&vpos);
                mesh.normals.extend_from_slice(&normal);
                mesh.colors.extend_from_slice(&rgb);
                vertex_index[cell_lin(cx, cy, cz)] = vi as i32;
            }
        }
    }

    // Pass 2: one quad per interior grid edge that changes sign, joining the four
    // cells sharing that edge. Each interior edge is the corner-0 axis edge of exactly
    // one cell, so every quad is generated once.
    for cz in 0..cnz {
        for cy in 0..cny {
            for cx in 0..cnx {
                let m = cell_lin(cx, cy, cz);
                if vertex_index[m] < 0 {
                    continue;
                }
                let corner0_solid = field.sdf[field.index(cx, cy, cz)] < 0.0;
                let coord = [cx, cy, cz];
                // The three edges leaving corner 0 along +x (corner 1), +y (corner 2),
                // and +z (corner 4).
                for (axis, &corner_d) in [1usize, 2, 4].iter().enumerate() {
                    let off = CORNERS[corner_d];
                    let (i, j, k) = (cx + off[0], cy + off[1], cz + off[2]);
                    let cd_solid = field.sdf[field.index(i, j, k)] < 0.0;
                    if corner0_solid == cd_solid {
                        continue; // this edge does not change sign
                    }
                    let iu = (axis + 1) % 3;
                    let iv = (axis + 2) % 3;
                    // The two perpendicular neighbour cells must exist for the quad.
                    if coord[iu] == 0 || coord[iv] == 0 {
                        continue;
                    }
                    let (du, dv) = (cell_stride[iu], cell_stride[iv]);
                    let quad = [
                        vertex_index[m],
                        vertex_index[m - du],
                        vertex_index[m - du - dv],
                        vertex_index[m - dv],
                    ];
                    // A closed surface always has all four; guard defensively.
                    if quad.iter().any(|&v| v < 0) {
                        continue;
                    }
                    let [a, b, c, d] = [
                        quad[0] as u32,
                        quad[1] as u32,
                        quad[2] as u32,
                        quad[3] as u32,
                    ];
                    // Flip winding with the sign direction so faces orient outward.
                    if corner0_solid {
                        push_quad(&mut mesh, a, b, c, d);
                    } else {
                        push_quad(&mut mesh, a, d, c, b);
                    }
                }
            }
        }
    }

    mesh
}

/// Append a quad `(a, b, c, d)` as two triangles sharing the `a`–`c` diagonal.
fn push_quad(mesh: &mut Mesh, a: u32, b: u32, c: u32, d: u32) {
    mesh.indices.extend_from_slice(&[a, b, c, a, c, d]);
}

/// Squared Euclidean distance between two world points.
fn dist2(a: [f32; 3], b: [f32; 3]) -> f32 {
    let dx = a[0] - b[0];
    let dy = a[1] - b[1];
    let dz = a[2] - b[2];
    dx * dx + dy * dy + dz * dz
}

/// The outward unit normal at world point `p`: the central-difference gradient of
/// the trilinearly sampled distance field (distance increases outward, so the raw
/// gradient already points out of the solid). Falls back to `+y` where the gradient
/// vanishes.
fn gradient_normal(field: &Field, p: [f32; 3]) -> [f32; 3] {
    let [sx, sy, sz] = field.spacing();
    let h = 0.5 * sx.max(sy).max(sz).max(f32::EPSILON);
    let grad = [
        sample_sdf(field, [p[0] + h, p[1], p[2]]) - sample_sdf(field, [p[0] - h, p[1], p[2]]),
        sample_sdf(field, [p[0], p[1] + h, p[2]]) - sample_sdf(field, [p[0], p[1] - h, p[2]]),
        sample_sdf(field, [p[0], p[1], p[2] + h]) - sample_sdf(field, [p[0], p[1], p[2] - h]),
    ];
    normalize_gradient(grad)
}

/// Normalize a raw field gradient into an outward unit normal, robust to the very
/// large distances the sealed exterior border carries: divide out the largest
/// component first so squaring it can't overflow `f32` (a border gradient can reach
/// `~1e29`, whose square exceeds `f32::MAX`). Falls back to `+y` where the gradient
/// vanishes or is non-finite.
fn normalize_gradient(grad: [f32; 3]) -> [f32; 3] {
    let m = grad[0].abs().max(grad[1].abs()).max(grad[2].abs());
    if !m.is_finite() || m < 1.0e-12 {
        return [0.0, 1.0, 0.0];
    }
    let g = [grad[0] / m, grad[1] / m, grad[2] / m];
    let len = (g[0] * g[0] + g[1] * g[1] + g[2] * g[2]).sqrt();
    [g[0] / len, g[1] / len, g[2] / len]
}

/// Trilinearly interpolate the field's signed distance at world point `p`, clamping
/// the sample to the grid so points on or just past the boundary read the nearest
/// interior value.
fn sample_sdf(field: &Field, p: [f32; 3]) -> f32 {
    let (nx, ny, nz) = (field.res.nx, field.res.ny, field.res.nz);
    let [sx, sy, sz] = field.spacing();
    let (i0, fx) = axis_sample(p[0], sx, nx);
    let (j0, fy) = axis_sample(p[1], sy, ny);
    let (k0, fz) = axis_sample(p[2], sz, nz);
    let (i1, j1, k1) = (i0 + 1, j0 + 1, k0 + 1);

    let c000 = field.sdf[field.index(i0, j0, k0)];
    let c100 = field.sdf[field.index(i1, j0, k0)];
    let c010 = field.sdf[field.index(i0, j1, k0)];
    let c110 = field.sdf[field.index(i1, j1, k0)];
    let c001 = field.sdf[field.index(i0, j0, k1)];
    let c101 = field.sdf[field.index(i1, j0, k1)];
    let c011 = field.sdf[field.index(i0, j1, k1)];
    let c111 = field.sdf[field.index(i1, j1, k1)];

    let c00 = c000 + (c100 - c000) * fx;
    let c10 = c010 + (c110 - c010) * fx;
    let c01 = c001 + (c101 - c001) * fx;
    let c11 = c011 + (c111 - c011) * fx;
    let c0 = c00 + (c10 - c00) * fy;
    let c1 = c01 + (c11 - c01) * fy;
    c0 + (c1 - c0) * fz
}

/// The lower node index and fractional offset for `coord` on an axis of `n` nodes at
/// spacing `step`, clamped so the returned index has a valid `+1` neighbour. World `0`
/// maps to interior node [`PAD`], matching [`Field::node_world`].
fn axis_sample(coord: f32, step: f32, n: u32) -> (u32, f32) {
    if step <= 0.0 || n < 2 {
        return (0, 0.0);
    }
    let g = (coord / step + PAD as f32).clamp(0.0, (n - 1) as f32);
    let i0 = (g.floor() as u32).min(n - 2);
    (i0, (g - i0 as f32).clamp(0.0, 1.0))
}

#[cfg(test)]
#[path = "surface_nets.test.rs"]
mod tests;
