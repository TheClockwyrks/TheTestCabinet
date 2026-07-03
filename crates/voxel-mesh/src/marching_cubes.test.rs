//! Tests for the marching-cubes mesher: build a field with a CSG primitive, mesh it,
//! and assert the output is a well-formed, in-range, watertight surface of the
//! expected shape.

use std::collections::HashMap;

use crate::field::Dims;
use crate::marching_cubes::MarchingCubesMesher;
use crate::mesher::{Mesh, Mesher};
use crate::{FieldOp, GridConfig, Rgb, render};

/// The world volume these tests author fields in: a 20-unit cube, comfortably larger
/// than the primitives so their surfaces close inside the bounds.
fn bounds() -> Dims {
    Dims::new(20.0, 20.0, 20.0)
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

/// A watertight surface: every undirected edge is shared by exactly two triangles
/// (the welded per-cell marching-cubes output is 2-manifold for a closed field).
fn assert_watertight(mesh: &Mesh) {
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

#[test]
fn empty_field_meshes_to_nothing() {
    let field = render(bounds(), &GridConfig::marching_cubes(), &[]);
    assert!(MarchingCubesMesher.mesh(&field).is_empty());
}

#[test]
fn sphere_is_a_closed_shell_of_the_right_size() {
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
    let field = render(bounds(), &GridConfig::marching_cubes(), &ops);
    let mesh = MarchingCubesMesher.mesh(&field);

    assert_well_formed(&mesh, bounds());
    assert_watertight(&mesh);

    // A sane triangle count for the coarse grid: chunky, but a recognizable sphere.
    let tris = mesh.indices.len() / 3;
    assert!(
        (50..2000).contains(&tris),
        "coarse sphere triangle count {tris} outside the expected chunky range"
    );

    // The mesh's bounding box approximates the sphere's diameter, within a cell
    // (marching cubes places the shell within one coarse cell of the true surface).
    let cell = GridConfig::marching_cubes().cell_size;
    let (min, max) = vertex_bbox(&mesh);
    for a in 0..3 {
        let span = max[a] - min[a];
        assert!(
            (span - 2.0 * radius).abs() <= cell,
            "axis {a} span {span} not within a cell of diameter {}",
            2.0 * radius
        );
        // The shell is centered on the sphere.
        let mid = 0.5 * (min[a] + max[a]);
        assert!(
            (mid - center[a]).abs() <= cell,
            "axis {a} center {mid} not within a cell of {}",
            center[a]
        );
    }

    // Every vertex sits on the sphere shell: its distance from the center is ~radius.
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
fn box_reaching_the_floor_is_capped_not_left_open() {
    // A box whose bottom spills past the y=0 volume floor (y spans [-2, 8]). The
    // exterior border ring holds the floor closed, so the bottom must be capped with a
    // downward-facing wall rather than left as an open hole — the regression this
    // guards (a foot resting flat on the ground plane).
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
    let field = render(bounds(), &GridConfig::marching_cubes(), &ops);
    let mesh = MarchingCubesMesher.mesh(&field);

    assert_well_formed(&mesh, bounds());
    // The floor is capped, so the surface stays a closed 2-manifold.
    assert_watertight(&mesh);

    // The solid is clipped at the floor: no vertex dips below y=0, and the mesh
    // actually reaches it (the bottom is present, not missing).
    let (min, max) = vertex_bbox(&mesh);
    let cell = GridConfig::marching_cubes().cell_size;
    assert!(
        min[1] >= -cell,
        "mesh dips below the floor: min y = {}",
        min[1]
    );
    assert!(min[1] <= cell, "mesh floor is missing: min y = {}", min[1]);
    assert!(max[1] > 6.0, "mesh top should reach the box top near y=8");

    // The cap carries outward (downward) normals: some vertex near the floor faces -y.
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
fn box_meshes_to_a_closed_watertight_surface() {
    // A box whose faces avoid the grid nodes (nodes fall on even coordinates), so no
    // corner sample sits exactly on the surface.
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
    let field = render(bounds(), &GridConfig::marching_cubes(), &ops);
    let mesh = MarchingCubesMesher.mesh(&field);

    assert_well_formed(&mesh, bounds());
    assert_watertight(&mesh);

    // The box's mesh bounding box approximates its 9-unit extent within a cell.
    let cell = GridConfig::marching_cubes().cell_size;
    let (min, max) = vertex_bbox(&mesh);
    for a in 0..3 {
        let span = max[a] - min[a];
        assert!(
            (span - 9.0).abs() <= cell,
            "axis {a} span {span} not within a cell of the 9-unit box extent"
        );
    }
}
