//! Tests for the dual-contouring mesher: build a field with a CSG primitive, mesh it,
//! and assert the output is a well-formed, in-range, watertight *manifold* surface of
//! the expected shape — and, crucially, that a hard box's sharp edges and corners
//! **survive** (the QEF places vertices on the true corners), which is what
//! distinguishes dual contouring from the rounding surface nets does.

use std::collections::HashMap;

use crate::dual_contouring::DualContouringMesher;
use crate::field::Dims;
use crate::mesher::{Mesh, Mesher};
use crate::surface_nets::SurfaceNetsMesher;
use crate::{FieldOp, GridConfig, Rgb, render};

/// The world volume these tests author fields in: a 20-unit cube, comfortably larger
/// than the primitives so their surfaces close inside the bounds.
fn bounds() -> Dims {
    Dims::new(20.0, 20.0, 20.0)
}

/// Mesh `ops` at the dual-contouring preset.
fn mesh_of(ops: &[FieldOp]) -> Mesh {
    let field = render(bounds(), &GridConfig::dual_contouring(), ops);
    DualContouringMesher.mesh(&field)
}

/// Mesh `ops` at the surface-nets preset (for the sharp-vs-rounded comparison).
fn surface_nets_mesh_of(ops: &[FieldOp]) -> Mesh {
    let field = render(bounds(), &GridConfig::surface_nets(), ops);
    SurfaceNetsMesher.mesh(&field)
}

/// The axis-aligned bounding box of a mesh's vertices as `(min, max)`.
fn vertex_bbox(mesh: &Mesh) -> ([f32; 3], [f32; 3]) {
    let mut min = [f32::INFINITY; 3];
    let mut max = [f32::NEG_INFINITY; 3];
    for v in mesh.positions.chunks_exact(3) {
        for a in 0..3 {
            min[a] = min[a].min(v[a]);
            max[a] = max[a].max(v[a]);
        }
    }
    (min, max)
}

/// Every undirected triangle edge and how many triangles reference it. A closed,
/// 2-manifold surface has every edge shared by exactly two triangles.
fn edge_use_counts(mesh: &Mesh) -> HashMap<(u32, u32), u32> {
    let mut counts: HashMap<(u32, u32), u32> = HashMap::new();
    for tri in mesh.indices.chunks_exact(3) {
        for &(a, b) in &[(tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])] {
            let key = if a <= b { (a, b) } else { (b, a) };
            *counts.entry(key).or_insert(0) += 1;
        }
    }
    counts
}

/// Assert the shared, algorithm-independent invariants: non-empty, indices in range,
/// well-formed triangle count, unit-length normals, `0..1` colors, and vertices
/// inside the volume.
fn assert_well_formed(mesh: &Mesh, bounds: Dims) {
    assert!(!mesh.is_empty(), "mesher should emit triangles");
    assert_eq!(mesh.positions.len() % 3, 0);
    assert_eq!(mesh.normals.len(), mesh.positions.len());
    assert_eq!(mesh.colors.len(), mesh.positions.len());
    assert_eq!(mesh.indices.len() % 3, 0);

    let vertex_count = (mesh.positions.len() / 3) as u32;
    assert!(vertex_count > 0);
    for &idx in &mesh.indices {
        assert!(
            idx < vertex_count,
            "index {idx} out of range {vertex_count}"
        );
    }

    // Normals are unit length (gradient normals, normalized).
    for n in mesh.normals.chunks_exact(3) {
        let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
        assert!((len - 1.0).abs() < 1.0e-3, "normal not unit length: {len}");
    }

    // Colors are baked in 0..1.
    for &c in &mesh.colors {
        assert!((0.0..=1.0).contains(&c), "color channel {c} outside 0..1");
    }

    // Vertices lie within the volume bounds (with a small tolerance).
    let ext = bounds.as_array();
    let eps = 1.0e-3;
    for v in mesh.positions.chunks_exact(3) {
        for a in 0..3 {
            assert!(
                v[a] >= -eps && v[a] <= ext[a] + eps,
                "vertex axis {a} = {} outside [0, {}]",
                v[a],
                ext[a]
            );
        }
    }
}

/// A watertight, 2-manifold surface: every undirected edge is shared by exactly two
/// triangles. Dual contouring uses the same one-vertex-per-cell / one-quad-per-
/// crossing-edge connectivity as surface nets, so a closed field meshes 2-manifold
/// with no caveats — only the vertex *positions* differ.
fn assert_watertight_manifold(mesh: &Mesh) {
    let bad: Vec<_> = edge_use_counts(mesh)
        .into_iter()
        .filter(|&(_, n)| n != 2)
        .collect();
    assert!(
        bad.is_empty(),
        "{} non-manifold edges (each should be used by exactly 2 triangles): {:?}",
        bad.len(),
        &bad[..bad.len().min(8)]
    );
}

/// The maximum, over the eight corners of the box `[min, max]`, of the distance from
/// that ideal corner to the *nearest mesh vertex*. A mesher that preserves the box's
/// corners places a vertex right on each one (small value); a mesher that rounds them
/// leaves the nearest vertex pulled inward (large value).
fn max_corner_miss(mesh: &Mesh, min: [f32; 3], max: [f32; 3]) -> f32 {
    let extremes = [min, max];
    let mut worst = 0f32;
    for corner in 0..8 {
        let target = [
            extremes[corner & 1][0],
            extremes[(corner >> 1) & 1][1],
            extremes[(corner >> 2) & 1][2],
        ];
        let mut nearest = f32::INFINITY;
        for v in mesh.positions.chunks_exact(3) {
            let d = ((v[0] - target[0]).powi(2)
                + (v[1] - target[1]).powi(2)
                + (v[2] - target[2]).powi(2))
            .sqrt();
            nearest = nearest.min(d);
        }
        worst = worst.max(nearest);
    }
    worst
}

/// The fraction of the mesh's triangles whose *geometric* face normal is within
/// `tol_deg` degrees of an axis direction (±x, ±y, ±z). A box built from flat,
/// axis-aligned faces scores high; a rounded surface, whose facets tilt away from the
/// axes, scores low.
fn axis_aligned_face_fraction(mesh: &Mesh, tol_deg: f32) -> f32 {
    let cos_tol = (tol_deg.to_radians()).cos();
    let mut aligned = 0usize;
    let mut total = 0usize;
    for tri in mesh.indices.chunks_exact(3) {
        let p = |i: u32| {
            let b = i as usize * 3;
            [
                mesh.positions[b],
                mesh.positions[b + 1],
                mesh.positions[b + 2],
            ]
        };
        let (a, b, c) = (p(tri[0]), p(tri[1]), p(tri[2]));
        let u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        let v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        let n = [
            u[1] * v[2] - u[2] * v[1],
            u[2] * v[0] - u[0] * v[2],
            u[0] * v[1] - u[1] * v[0],
        ];
        let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
        if len < 1.0e-12 {
            continue; // degenerate triangle
        }
        total += 1;
        let max_axis = (n[0].abs()).max(n[1].abs()).max(n[2].abs()) / len;
        if max_axis >= cos_tol {
            aligned += 1;
        }
    }
    if total == 0 {
        return 0.0;
    }
    aligned as f32 / total as f32
}

#[test]
fn empty_field_meshes_to_nothing() {
    let field = render(bounds(), &GridConfig::dual_contouring(), &[]);
    assert!(DualContouringMesher.mesh(&field).is_empty());
}

#[test]
fn box_reaching_the_floor_is_capped_not_left_open() {
    // A box whose bottom spills past the y=0 volume floor (y spans [-2, 8]) must be
    // capped by the exterior border ring, not left open — the foot-on-ground regression.
    let ops = vec![FieldOp::AddBox {
        cx: 10.0,
        cy: 3.0,
        cz: 10.0,
        width: 8.0,
        height: 10.0,
        depth: 8.0,
        color: Rgb([60, 80, 200]),
        blend: 0.0,
        sharp: false,
    }];
    let mesh = mesh_of(&ops);

    assert_well_formed(&mesh, bounds());
    assert_watertight_manifold(&mesh);

    let (min, max) = vertex_bbox(&mesh);
    let cell = GridConfig::dual_contouring().cell_size;
    assert!(
        min[1] >= -cell,
        "mesh dips below the floor: min y = {}",
        min[1]
    );
    assert!(min[1] <= cell, "mesh floor is missing: min y = {}", min[1]);
    assert!(max[1] > 6.0, "mesh top should reach the box top near y=8");

    let has_downward_cap = mesh
        .positions
        .chunks_exact(3)
        .zip(mesh.normals.chunks_exact(3))
        .any(|(p, n)| p[1] < cell && n[1] < -0.5);
    assert!(
        has_downward_cap,
        "the floor cap should have downward-facing normals"
    );
}

#[test]
fn sphere_is_a_watertight_manifold_shell_of_the_right_size() {
    let color = Rgb([220, 40, 40]);
    let radius = 6.0;
    let center = [10.0, 10.0, 10.0];
    let ops = vec![FieldOp::AddSphere {
        cx: center[0],
        cy: center[1],
        cz: center[2],
        r: radius,
        color,
        blend: 0.0,
        sharp: false,
    }];
    let mesh = mesh_of(&ops);

    assert_well_formed(&mesh, bounds());
    assert_watertight_manifold(&mesh);

    // The fine dual-contouring grid gives a dense shell.
    let tris = mesh.indices.len() / 3;
    assert!(
        (1000..60000).contains(&tris),
        "dual-contouring sphere triangle count {tris} outside the expected fine-density range"
    );

    // The mesh's bounding box approximates the sphere's diameter, within a cell.
    let cell = GridConfig::dual_contouring().cell_size;
    let (min, max) = vertex_bbox(&mesh);
    for a in 0..3 {
        let span = max[a] - min[a];
        assert!(
            (span - 2.0 * radius).abs() <= cell,
            "axis {a} span {span} not within a cell of diameter {}",
            2.0 * radius
        );
        let mid = 0.5 * (min[a] + max[a]);
        assert!(
            (mid - center[a]).abs() <= cell,
            "axis {a} center {mid} not within a cell of {}",
            center[a]
        );
    }

    // Every vertex sits near the sphere shell: its distance from the center is ~radius.
    for v in mesh.positions.chunks_exact(3) {
        let d =
            ((v[0] - center[0]).powi(2) + (v[1] - center[1]).powi(2) + (v[2] - center[2]).powi(2))
                .sqrt();
        assert!(
            (d - radius).abs() <= cell,
            "vertex distance {d} not within a cell of radius {radius}"
        );
    }

    // The sphere is one color, baked in 0..1.
    let expected = [220.0 / 255.0, 40.0 / 255.0, 40.0 / 255.0];
    for c in mesh.colors.chunks_exact(3) {
        for a in 0..3 {
            assert!((c[a] - expected[a]).abs() < 1.0e-6);
        }
    }
}

#[test]
fn box_meshes_to_a_watertight_manifold_surface() {
    // A hard box whose faces avoid the fine grid's nodes, so no corner sample sits
    // exactly on the surface.
    let ops = box_ops();
    let mesh = mesh_of(&ops);

    assert_well_formed(&mesh, bounds());
    assert_watertight_manifold(&mesh);

    // The box's mesh bounding box approximates its 9.4-unit extent within a cell.
    let cell = GridConfig::dual_contouring().cell_size;
    let (min, max) = vertex_bbox(&mesh);
    for a in 0..3 {
        let span = max[a] - min[a];
        assert!(
            (span - BOX_EXTENT).abs() <= cell,
            "axis {a} span {span} not within a cell of the {BOX_EXTENT}-unit box extent"
        );
    }
}

/// The full extent of the hard box the sharpness tests build. Chosen so its faces
/// (at `10 ± BOX_EXTENT/2`) land off the grid nodes of *both* the DC (0.5) and SN
/// (1.0) presets, so neither mesher gets a corner sample sitting exactly on a face.
const BOX_EXTENT: f32 = 9.4;

/// A single hard (blend `0`), sharp-tagged box centered in the volume — a genuine
/// crease at every edge and corner for dual contouring to preserve.
fn box_ops() -> Vec<FieldOp> {
    vec![FieldOp::AddBox {
        cx: 10.0,
        cy: 10.0,
        cz: 10.0,
        width: BOX_EXTENT,
        height: BOX_EXTENT,
        depth: BOX_EXTENT,
        color: Rgb([60, 80, 200]),
        blend: 0.0,
        sharp: true,
    }]
}

/// The ideal min/max corner of the hard box.
fn box_corners() -> ([f32; 3], [f32; 3]) {
    let h = BOX_EXTENT * 0.5;
    ([10.0 - h; 3], [10.0 + h; 3])
}

#[test]
fn box_preserves_its_sharp_corners_unlike_surface_nets() {
    let ops = box_ops();
    let dc = mesh_of(&ops);
    let sn = surface_nets_mesh_of(&ops);

    assert_well_formed(&dc, bounds());
    assert_watertight_manifold(&dc);

    let (min, max) = box_corners();
    let dc_miss = max_corner_miss(&dc, min, max);
    let sn_miss = max_corner_miss(&sn, min, max);

    // Dual contouring places a vertex essentially on each true corner; surface nets
    // rounds them, so its nearest vertex is pulled measurably inward. DC's worst
    // corner miss is a small fraction of a DC cell, and well under surface nets'.
    let dc_cell = GridConfig::dual_contouring().cell_size;
    assert!(
        dc_miss < 0.5 * dc_cell,
        "DC corner miss {dc_miss} should be well within half a cell ({dc_cell}) — corners preserved"
    );
    assert!(
        dc_miss < 0.5 * sn_miss,
        "DC corner miss {dc_miss} should be much smaller than surface-nets miss {sn_miss} \
         (DC preserves the sharp corners SN rounds)"
    );

    // The box's faces stay flat under dual contouring: the vast majority of its
    // triangles are axis-aligned. Surface nets, rounding the whole surface, aligns far
    // fewer.
    let dc_flat = axis_aligned_face_fraction(&dc, 5.0);
    let sn_flat = axis_aligned_face_fraction(&sn, 5.0);
    assert!(
        dc_flat > 0.75,
        "DC box should be mostly flat axis-aligned faces (only its sharp-edge seams tilt), \
         got {dc_flat}"
    );
    assert!(
        dc_flat > sn_flat + 0.1,
        "DC box faces ({dc_flat}) should be measurably flatter/sharper than surface nets \
         ({sn_flat})"
    );
}
