//! Post-extraction QEM simplification of a surface [`Mesh`].
//!
//! The three surface extractors (marching cubes, surface nets, dual contouring) emit a
//! *uniform-density* triangle mesh: every surface-straddling grid cell contributes the
//! same handful of triangles whether the surface there is a large flat slab or a tight
//! curve. On a blocky model that is mostly redundant — a flat armor plate carries
//! thousands of coplanar triangles that all describe the same plane. This module
//! collapses that redundancy with quadric-error-metric (QEM) decimation (Garland &
//! Heckbert), run once on the extracted mesh before it is encoded to a per-part `.glb`.
//! It rides the crate's `cli` feature (the meshing binaries); the library build `core`
//! links never simplifies — it only well-formedness-checks a mesh a binary emitted.
//!
//! **Why a hand-written QEM and not an off-the-shelf library.** A general simplifier
//! (meshoptimizer) reduces triangle count well but does *not* guarantee it preserves a
//! watertight surface: on these meshes — thin limbs, and the non-manifold junctions dual
//! contouring produces where two solids meet — it tears the surface into holes even at a
//! zero error budget. The pipeline's contract is a watertight model, so simplification
//! here is built around one hard, per-collapse invariant instead: an edge is collapsed
//! **only when the collapse provably preserves the local 2-manifold** (the *link
//! condition*), so a watertight input stays watertight no matter how aggressive the
//! error budget is. Correctness is structural, not a matter of tuning.
//!
//! That single rule delivers all three properties the pipeline depends on:
//!
//! - **Watertight / 2-manifold topology.** A half-edge collapse runs only when the edge
//!   is shared by exactly two triangles *and* the two vertices' neighborhoods meet in
//!   exactly the edge's two opposite vertices (the link condition), and only when no
//!   incident triangle flips. So a boundary edge, a non-manifold junction, or any
//!   collapse that would fold or puncture the surface is simply never performed — the
//!   junction cells dual contouring leaves are kept intact rather than torn open.
//! - **Per-vertex color.** A collapse merges one endpoint *into the other existing
//!   vertex* (positions are never averaged, so nothing is interpolated), and is only
//!   ever performed between two vertices of the **same color** — so color patches stay
//!   flat and their borders keep a decimation-resistant fringe.
//! - **Normals.** Because a survivor keeps its exact position, its central-difference
//!   SDF-gradient normal (the smooth "true" normal each extractor computes, deliberately
//!   not a facet normal) is still correct there, so it is carried through unchanged
//!   rather than recomputed from the coarsened triangles.

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashSet};

use crate::mesher::Mesh;

/// The simplification error budget, **relative to the mesh's bounding-box diagonal** (so
/// it is scale-independent across the coarse/medium/fine grids of the three algorithms).
/// A collapse whose quadric error exceeds `(REL_ERROR * diagonal)^2` is not performed.
/// Flat, coplanar regions collapse at essentially zero error and are removed regardless;
/// this budget only bounds how far gently-curved regions may be flattened, while sharp
/// edges (whose collapse error is large) are kept. Watertightness does **not** depend on
/// this value — the link condition guarantees it — so the budget is purely a fidelity
/// knob.
const REL_ERROR: f64 = 0.01;

/// Below this triangle count a mesh is left untouched: tiny parts (an attach socket, a
/// bolt) have nothing worth collapsing, and simplifying them risks degrading a feature
/// that is already minimal.
const MIN_TRIANGLES: usize = 64;

/// Colors closer than this per-channel (in the `0..1` linear space) are treated as the
/// same region and may be collapsed together; anything larger is a color boundary that
/// is never crossed. Extractor vertices in one region share an identical color, so this
/// only needs to shrug off float round-trip noise.
const COLOR_EPS: f32 = 1.0e-4;

/// A symmetric 4×4 error quadric, stored as its 10 unique upper-triangle entries in row
/// order: `[q00, q01, q02, q03, q11, q12, q13, q22, q23, q33]`. Evaluated at a point `v`
/// (in homogeneous form `[x, y, z, 1]`) it gives the sum of squared distances to the
/// planes that built it.
type Quadric = [f64; 10];

/// Simplify `mesh` with manifold-preserving QEM edge collapses, returning a new mesh
/// whose vertex buffer holds only the surviving vertices — each keeping its original
/// position, normal, and color — with the index buffer remapped to match. Empty or
/// sub-[`MIN_TRIANGLES`] meshes are returned unchanged.
pub fn simplify_mesh(mesh: &Mesh) -> Mesh {
    let vertex_count = mesh.positions.len() / 3;
    let triangle_count = mesh.indices.len() / 3;
    if triangle_count < MIN_TRIANGLES || vertex_count == 0 {
        return mesh.clone();
    }
    Simplifier::new(mesh).run().rebuild(mesh)
}

/// One candidate edge collapse on the priority queue: collapse `removed` into `survivor`
/// at `cost`, valid only while both endpoints still carry the versions recorded here
/// (a bumped version marks a stale entry to be skipped).
#[derive(Clone, Copy)]
struct Candidate {
    cost: f64,
    survivor: u32,
    removed: u32,
    survivor_version: u32,
    removed_version: u32,
}

impl PartialEq for Candidate {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}
impl Eq for Candidate {}
impl Ord for Candidate {
    /// Ordered so [`BinaryHeap`] (a max-heap) pops the **lowest** cost first; ties are
    /// broken by the endpoint indices purely for deterministic output.
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .cost
            .total_cmp(&self.cost)
            .then(self.survivor.cmp(&other.survivor))
            .then(self.removed.cmp(&other.removed))
    }
}
impl PartialOrd for Candidate {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// The mutable working state of a single simplification: the vertex attributes, the live
/// triangle set, the adjacency needed to test the link condition, and per-vertex
/// quadrics and versions.
struct Simplifier {
    /// Vertex positions as `[x, y, z]` in `f64` for stable geometry math.
    positions: Vec<[f64; 3]>,
    /// Vertex colors (`0..1` RGB), used to forbid collapses across a color boundary.
    colors: Vec<[f32; 3]>,
    /// Per-vertex accumulated error quadric.
    quadrics: Vec<Quadric>,
    /// Whether each vertex is still present (not yet collapsed away).
    alive: Vec<bool>,
    /// Per-vertex version, bumped whenever the vertex is touched so stale queue entries
    /// can be recognized and skipped.
    version: Vec<u32>,
    /// The set of alive triangles incident to each vertex.
    vertex_faces: Vec<HashSet<u32>>,
    /// The set of adjacent vertices of each vertex (the link-condition neighborhood).
    neighbors: Vec<HashSet<u32>>,
    /// Triangle vertex indices, three per face; a dead face has been emptied to `None`.
    faces: Vec<Option<[u32; 3]>>,
    /// The maximum squared quadric error a collapse may incur, from [`REL_ERROR`].
    max_error: f64,
}

impl Simplifier {
    /// Build the working state from `mesh`: load attributes, accumulate one plane
    /// quadric per triangle into its three vertices, and record the adjacency.
    fn new(mesh: &Mesh) -> Simplifier {
        let vertex_count = mesh.positions.len() / 3;
        let positions: Vec<[f64; 3]> = mesh
            .positions
            .chunks_exact(3)
            .map(|p| [p[0] as f64, p[1] as f64, p[2] as f64])
            .collect();
        let colors: Vec<[f32; 3]> = mesh
            .colors
            .chunks_exact(3)
            .map(|c| [c[0], c[1], c[2]])
            .collect();

        let mut quadrics = vec![[0.0f64; 10]; vertex_count];
        let mut vertex_faces = vec![HashSet::new(); vertex_count];
        let mut neighbors = vec![HashSet::new(); vertex_count];
        let mut faces: Vec<Option<[u32; 3]>> = Vec::with_capacity(mesh.indices.len() / 3);

        // The bounding-box diagonal sets the (scale-independent) error budget.
        let mut min = [f64::INFINITY; 3];
        let mut max = [f64::NEG_INFINITY; 3];
        for p in &positions {
            for a in 0..3 {
                min[a] = min[a].min(p[a]);
                max[a] = max[a].max(p[a]);
            }
        }
        let diag =
            ((max[0] - min[0]).powi(2) + (max[1] - min[1]).powi(2) + (max[2] - min[2]).powi(2))
                .sqrt();
        let max_error = (REL_ERROR * diag).powi(2);

        for tri in mesh.indices.chunks_exact(3) {
            let face_idx = faces.len() as u32;
            let (i0, i1, i2) = (tri[0], tri[1], tri[2]);
            faces.push(Some([i0, i1, i2]));

            if let Some(plane) = triangle_plane(&positions, i0, i1, i2) {
                let q = plane_quadric(&plane);
                for &v in &[i0, i1, i2] {
                    add_quadric(&mut quadrics[v as usize], &q);
                }
            }
            for &v in &[i0, i1, i2] {
                vertex_faces[v as usize].insert(face_idx);
            }
            for &(a, b) in &[(i0, i1), (i1, i2), (i2, i0)] {
                neighbors[a as usize].insert(b);
                neighbors[b as usize].insert(a);
            }
        }

        Simplifier {
            positions,
            colors,
            quadrics,
            alive: vec![true; vertex_count],
            version: vec![0; vertex_count],
            vertex_faces,
            neighbors,
            faces,
            max_error,
        }
    }

    /// Collapse edges cheapest-first until none remain under the error budget, then
    /// return `self` for the compacting rebuild.
    fn run(mut self) -> Simplifier {
        // Seed the queue with every undirected edge's best valid collapse.
        let mut heap: BinaryHeap<Candidate> = BinaryHeap::new();
        let mut seeded: HashSet<(u32, u32)> = HashSet::new();
        for v in 0..self.positions.len() as u32 {
            for &n in &self.neighbors[v as usize] {
                let key = if v < n { (v, n) } else { (n, v) };
                if seeded.insert(key) {
                    heap.extend(self.candidate(key.0, key.1));
                }
            }
        }

        while let Some(cand) = heap.pop() {
            let (s, r) = (cand.survivor as usize, cand.removed as usize);
            // Skip stale entries: an endpoint has since been collapsed or re-versioned.
            if !self.alive[s]
                || !self.alive[r]
                || self.version[s] != cand.survivor_version
                || self.version[r] != cand.removed_version
            {
                continue;
            }
            // Re-validate against the current topology before committing — distant
            // collapses may have invalidated this one — so only sound collapses run.
            if self.collapse_error(cand.survivor, cand.removed).is_none() {
                continue;
            }

            self.collapse(cand.survivor, cand.removed);

            // Every edge incident to the survivor changed; re-queue its best collapse.
            let survivor_neighbors: Vec<u32> = self.neighbors[s].iter().copied().collect();
            for n in survivor_neighbors {
                if let Some(c) = self.candidate(cand.survivor, n) {
                    heap.push(c);
                }
            }
        }

        self
    }

    /// The best valid collapse of undirected edge `(a, b)`, if either direction is sound
    /// and under the error budget — the cheaper surviving endpoint wins.
    fn candidate(&self, a: u32, b: u32) -> Option<Candidate> {
        let forward = self.collapse_error(a, b).map(|cost| (cost, a, b));
        let backward = self.collapse_error(b, a).map(|cost| (cost, b, a));
        let (cost, survivor, removed) = match (forward, backward) {
            (Some(f), Some(bk)) => {
                if f.0 <= bk.0 {
                    f
                } else {
                    bk
                }
            }
            (Some(f), None) => f,
            (None, Some(bk)) => bk,
            (None, None) => return None,
        };
        Some(Candidate {
            cost,
            survivor,
            removed,
            survivor_version: self.version[survivor as usize],
            removed_version: self.version[removed as usize],
        })
    }

    /// The quadric error of collapsing `removed` into `survivor`, or `None` if the
    /// collapse is disallowed: a color boundary, a non-manifold/boundary edge, a link-
    /// condition violation, a triangle fold-over, or an over-budget error. `Some(cost)`
    /// means the collapse provably keeps the surface a watertight 2-manifold.
    fn collapse_error(&self, survivor: u32, removed: u32) -> Option<f64> {
        let (s, r) = (survivor as usize, removed as usize);

        // Never blend two colors: only collapse within one color region.
        if !same_color(self.colors[s], self.colors[r], COLOR_EPS) {
            return None;
        }

        // The edge must be a manifold interior edge: shared by exactly two triangles.
        let shared: Vec<u32> = self.vertex_faces[r]
            .iter()
            .copied()
            .filter(|f| self.face_has(*f, survivor))
            .collect();
        if shared.len() != 2 {
            return None;
        }

        // Link condition: the two neighborhoods may meet only in the edge's two opposite
        // vertices. Any other shared neighbor means the collapse creates a non-manifold
        // edge, so reject it.
        let opposite: HashSet<u32> = shared
            .iter()
            .filter_map(|&f| self.faces[f as usize])
            .map(|tri| third_vertex(tri, survivor, removed))
            .collect();
        if opposite.len() != 2 {
            return None;
        }
        for &n in &self.neighbors[r] {
            if self.neighbors[s].contains(&n) && !opposite.contains(&n) {
                return None;
            }
        }

        // Fold-over guard: no surviving triangle around `removed` may flip when `removed`
        // moves onto `survivor`'s position (a flipped or collapsed-to-zero face would
        // pinch the surface).
        let target = self.positions[s];
        for &f in &self.vertex_faces[r] {
            if shared.contains(&f) {
                continue;
            }
            if self.faces[f as usize]
                .is_some_and(|tri| flips(&self.positions, tri, removed, target))
            {
                return None;
            }
        }

        // Sound collapse: score it by the combined quadric at the surviving position.
        let mut q = self.quadrics[s];
        add_quadric(&mut q, &self.quadrics[r]);
        let cost = quadric_error(&q, target);
        if cost > self.max_error {
            return None;
        }
        Some(cost)
    }

    /// Perform the (already validated) collapse of `removed` into `survivor`: drop the
    /// two shared triangles, rewrite the rest of `removed`'s triangles onto `survivor`,
    /// fold in its quadric, and update adjacency and versions.
    fn collapse(&mut self, survivor: u32, removed: u32) {
        let (s, r) = (survivor as usize, removed as usize);

        let removed_faces: Vec<u32> = self.vertex_faces[r].iter().copied().collect();
        for f in removed_faces {
            let Some(tri) = self.faces[f as usize] else {
                continue;
            };
            if tri.contains(&survivor) {
                // A shared triangle degenerates on collapse — delete it and detach it
                // from all three of its vertices.
                for &v in &tri {
                    self.vertex_faces[v as usize].remove(&f);
                }
                self.faces[f as usize] = None;
            } else {
                // Rewrite `removed` to `survivor` in this surviving triangle.
                let new_tri = tri.map(|v| if v == removed { survivor } else { v });
                self.faces[f as usize] = Some(new_tri);
                self.vertex_faces[s].insert(f);
                // The triangle's other two vertices become neighbors of the survivor.
                for &v in &new_tri {
                    if v != survivor {
                        self.neighbors[s].insert(v);
                        self.neighbors[v as usize].insert(survivor);
                    }
                }
            }
        }

        // Detach `removed` from the adjacency graph entirely.
        for n in self.neighbors[r].clone() {
            self.neighbors[n as usize].remove(&removed);
        }
        self.neighbors[s].remove(&removed);
        self.neighbors[r].clear();
        self.vertex_faces[r].clear();

        // Fold the removed vertex's error into the survivor and retire it.
        let removed_quadric = self.quadrics[r];
        add_quadric(&mut self.quadrics[s], &removed_quadric);
        self.alive[r] = false;
        self.version[s] += 1;
        self.version[r] += 1;
    }

    /// Whether triangle `face` still references vertex `v`.
    fn face_has(&self, face: u32, v: u32) -> bool {
        self.faces[face as usize].is_some_and(|tri| tri.contains(&v))
    }

    /// Rebuild a compact [`Mesh`] from the surviving faces and vertices of `source`,
    /// renumbered densely and carrying each survivor's original position, normal, and
    /// color through unchanged.
    fn rebuild(&self, source: &Mesh) -> Mesh {
        let mut remap = vec![u32::MAX; self.positions.len()];
        let mut out = Mesh {
            positions: Vec::new(),
            normals: Vec::new(),
            colors: Vec::new(),
            indices: Vec::new(),
        };
        for tri in self.faces.iter().flatten() {
            for &old in tri {
                let old = old as usize;
                if remap[old] == u32::MAX {
                    remap[old] = (out.positions.len() / 3) as u32;
                    out.positions
                        .extend_from_slice(&source.positions[old * 3..old * 3 + 3]);
                    out.normals
                        .extend_from_slice(&source.normals[old * 3..old * 3 + 3]);
                    out.colors
                        .extend_from_slice(&source.colors[old * 3..old * 3 + 3]);
                }
                out.indices.push(remap[old]);
            }
        }
        out
    }
}

/// The third vertex of triangle `tri`, i.e. the one that is neither `a` nor `b`.
fn third_vertex(tri: [u32; 3], a: u32, b: u32) -> u32 {
    for &v in &tri {
        if v != a && v != b {
            return v;
        }
    }
    // Unreachable for a non-degenerate triangle containing the edge `(a, b)`.
    a
}

/// Whether two `0..1` RGB colors are equal to within `eps` on every channel.
fn same_color(a: [f32; 3], b: [f32; 3], eps: f32) -> bool {
    (0..3).all(|i| (a[i] - b[i]).abs() <= eps)
}

/// Whether moving vertex `moved` to `target` flips triangle `tri`'s geometric normal
/// (or collapses it to zero area) — a fold-over the collapse must avoid.
fn flips(positions: &[[f64; 3]], tri: [u32; 3], moved: u32, target: [f64; 3]) -> bool {
    let before = tri.map(|v| positions[v as usize]);
    let after = tri.map(|v| {
        if v == moved {
            target
        } else {
            positions[v as usize]
        }
    });
    let n0 = face_normal(&before);
    let n1 = face_normal(&after);
    match (n0, n1) {
        (Some(n0), Some(n1)) => dot(n0, n1) <= 0.0,
        // The triangle was already degenerate, or becomes degenerate — treat becoming
        // degenerate as a flip so we never introduce a zero-area triangle.
        (Some(_), None) => true,
        _ => false,
    }
}

/// The (unnormalized) geometric normal of a triangle, or `None` if it is degenerate.
fn face_normal(tri: &[[f64; 3]; 3]) -> Option<[f64; 3]> {
    let u = sub(tri[1], tri[0]);
    let v = sub(tri[2], tri[0]);
    let n = cross(u, v);
    if dot(n, n).sqrt() < 1.0e-12 {
        None
    } else {
        Some(n)
    }
}

/// The plane `[a, b, c, d]` (unit normal `a,b,c`; `a*x+b*y+c*z+d = 0`) of triangle
/// `(i0, i1, i2)`, or `None` if the triangle is degenerate.
fn triangle_plane(positions: &[[f64; 3]], i0: u32, i1: u32, i2: u32) -> Option<[f64; 4]> {
    let (p0, p1, p2) = (
        positions[i0 as usize],
        positions[i1 as usize],
        positions[i2 as usize],
    );
    let n = face_normal(&[p0, p1, p2])?;
    let len = dot(n, n).sqrt();
    let n = [n[0] / len, n[1] / len, n[2] / len];
    let d = -dot(n, p0);
    Some([n[0], n[1], n[2], d])
}

/// The fundamental error quadric of a plane: the outer product `p * p^T` of its
/// coefficients, stored as the 10 unique upper-triangle entries.
fn plane_quadric(p: &[f64; 4]) -> Quadric {
    [
        p[0] * p[0],
        p[0] * p[1],
        p[0] * p[2],
        p[0] * p[3],
        p[1] * p[1],
        p[1] * p[2],
        p[1] * p[3],
        p[2] * p[2],
        p[2] * p[3],
        p[3] * p[3],
    ]
}

/// Accumulate quadric `b` into `a` in place.
fn add_quadric(a: &mut Quadric, b: &Quadric) {
    for i in 0..10 {
        a[i] += b[i];
    }
}

/// Evaluate the quadric at point `v` (as `[x, y, z, 1]`): `v^T Q v`, the sum of squared
/// distances to the planes that built `Q`.
fn quadric_error(q: &Quadric, v: [f64; 3]) -> f64 {
    let (x, y, z) = (v[0], v[1], v[2]);
    q[0] * x * x
        + 2.0 * q[1] * x * y
        + 2.0 * q[2] * x * z
        + 2.0 * q[3] * x
        + q[4] * y * y
        + 2.0 * q[5] * y * z
        + 2.0 * q[6] * y
        + q[7] * z * z
        + 2.0 * q[8] * z
        + q[9]
}

/// `a - b`.
fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

/// The cross product `a × b`.
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

/// The dot product `a · b`.
fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

#[cfg(test)]
#[path = "simplify.test.rs"]
mod tests;
