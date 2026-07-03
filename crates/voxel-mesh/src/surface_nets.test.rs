//! Tests for the surface-nets mesher: build a field with a CSG primitive, mesh it,
//! and assert the output is a well-formed, in-range, watertight *manifold* surface of
//! the expected shape — and that the sphere is the smooth, uniform, rounded output
//! that characterizes surface nets.

use std::collections::HashMap;

use crate::field::Dims;
use crate::mesher::{Mesh, Mesher};
use crate::surface_nets::SurfaceNetsMesher;
use crate::{FieldOp, GridConfig, Rgb, render};

/// The world volume these tests author fields in: a 20-unit cube, comfortably larger
/// than the primitives so their surfaces close inside the bounds.
fn bounds() -> Dims {
    Dims::new(20.0, 20.0, 20.0)
}

/// Mesh `ops` at the surface-nets preset.
fn mesh_of(ops: &[FieldOp]) -> Mesh {
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
/// triangles. Naive dual surface nets welds one vertex per cell and emits one quad
/// per crossing edge, so a closed field meshes 2-manifold with no caveats.
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

/// The mean and standard deviation of the vertices' distances from `center`.
fn radial_stats(mesh: &Mesh, center: [f32; 3]) -> (f32, f32) {
    let mut dists = Vec::new();
    for v in mesh.positions.chunks_exact(3) {
        let d =
            ((v[0] - center[0]).powi(2) + (v[1] - center[1]).powi(2) + (v[2] - center[2]).powi(2))
                .sqrt();
        dists.push(d);
    }
    let n = dists.len() as f32;
    let mean = dists.iter().sum::<f32>() / n;
    let var = dists.iter().map(|d| (d - mean).powi(2)).sum::<f32>() / n;
    (mean, var.sqrt())
}

#[test]
fn empty_field_meshes_to_nothing() {
    let field = render(bounds(), &GridConfig::surface_nets(), &[]);
    assert!(SurfaceNetsMesher.mesh(&field).is_empty());
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
    let cell = GridConfig::surface_nets().cell_size;
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

    // The medium grid gives a denser, smoother shell than coarse marching cubes.
    let tris = mesh.indices.len() / 3;
    assert!(
        (200..8000).contains(&tris),
        "surface-nets sphere triangle count {tris} outside the expected mid-density range"
    );

    // The mesh's bounding box approximates the sphere's diameter, within a cell.
    let cell = GridConfig::surface_nets().cell_size;
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
    // A box whose faces avoid the grid nodes, so no corner sample sits exactly on the
    // surface.
    let ops = vec![FieldOp::AddBox {
        cx: 10.0,
        cy: 10.0,
        cz: 10.0,
        width: 9.0,
        height: 9.0,
        depth: 9.0,
        color: Rgb([60, 80, 200]),
        blend: 0.0,
        sharp: false,
    }];
    let mesh = mesh_of(&ops);

    assert_well_formed(&mesh, bounds());
    assert_watertight_manifold(&mesh);

    // The box's mesh bounding box approximates its 9-unit extent within a cell.
    let cell = GridConfig::surface_nets().cell_size;
    let (min, max) = vertex_bbox(&mesh);
    for a in 0..3 {
        let span = max[a] - min[a];
        assert!(
            (span - 9.0).abs() <= cell,
            "axis {a} span {span} not within a cell of the 9-unit box extent"
        );
    }
}

#[test]
fn sphere_is_smoother_and_more_uniform_than_a_comparable_box() {
    // A sphere and a box of comparable size, both centered in the volume.
    let center = [10.0, 10.0, 10.0];
    let radius = 6.0;
    let sphere = mesh_of(&[FieldOp::AddSphere {
        cx: center[0],
        cy: center[1],
        cz: center[2],
        r: radius,
        color: Rgb([220, 40, 40]),
        blend: 0.0,
        sharp: false,
    }]);
    // A box sized so its faces sit ~radius from the center (half-extent 6).
    let boxy = mesh_of(&[FieldOp::AddBox {
        cx: center[0],
        cy: center[1],
        cz: center[2],
        width: 12.0,
        height: 12.0,
        depth: 12.0,
        color: Rgb([60, 80, 200]),
        blend: 0.0,
        sharp: false,
    }]);

    // The sphere's vertices are near-equidistant from its center (a uniform, rounded
    // shell); the box's vertices range from its faces to its far corners, so their
    // distance-from-center is far less uniform. Compare the coefficient of variation.
    let (sphere_mean, sphere_std) = radial_stats(&sphere, center);
    let (box_mean, box_std) = radial_stats(&boxy, center);
    let sphere_cv = sphere_std / sphere_mean;
    let box_cv = box_std / box_mean;

    assert!(
        sphere_cv < box_cv,
        "sphere radial CV {sphere_cv} should be smaller (more uniform) than box CV {box_cv}"
    );
    // The sphere shell is tight: its radial spread is a small fraction of its radius.
    assert!(
        sphere_cv < 0.05,
        "sphere radial CV {sphere_cv} should be small (a rounded, uniform shell)"
    );
}
