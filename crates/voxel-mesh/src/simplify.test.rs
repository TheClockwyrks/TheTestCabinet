//! Tests for QEM mesh simplification: extract a real surface with one of the three
//! meshers, simplify it, and assert the three properties the pipeline depends on hold
//! — the triangle count drops, the surface stays a watertight 2-manifold, per-vertex
//! colors are only ever *carried through* (never interpolated into a new value), sharp
//! features survive, and normals stay unit length.

use std::collections::HashMap;

use crate::dual_contouring::DualContouringMesher;
use crate::field::Dims;
use crate::mesher::{Mesh, Mesher};
use crate::simplify::simplify_mesh;
use crate::surface_nets::SurfaceNetsMesher;
use crate::{FieldOp, GridConfig, Rgb, render};

/// The world volume these tests author fields in: a 20-unit cube, comfortably larger
/// than the primitives so their surfaces close inside the bounds.
fn bounds() -> Dims {
    Dims::new(20.0, 20.0, 20.0)
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

/// Assert a watertight, 2-manifold surface: every undirected edge shared by exactly two
/// triangles. This is the invariant simplification must not break.
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

/// Assert the shared, algorithm-independent well-formedness invariants on a simplified
/// mesh: parallel arrays of equal length, triangle-aligned in-range indices, unit-length
/// normals, and `0..1` colors.
fn assert_well_formed(mesh: &Mesh) {
    assert!(
        !mesh.is_empty(),
        "simplified mesh should still have triangles"
    );
    assert_eq!(mesh.positions.len() % 3, 0);
    assert_eq!(mesh.normals.len(), mesh.positions.len());
    assert_eq!(mesh.colors.len(), mesh.positions.len());
    assert_eq!(mesh.indices.len() % 3, 0);

    let vertex_count = (mesh.positions.len() / 3) as u32;
    for &idx in &mesh.indices {
        assert!(
            idx < vertex_count,
            "index {idx} out of range {vertex_count}"
        );
    }
    // Normals are carried through from the extractor, which emits unit gradient normals.
    for n in mesh.normals.chunks_exact(3) {
        let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
        assert!((len - 1.0).abs() < 1.0e-3, "normal not unit length: {len}");
    }
    for &c in &mesh.colors {
        assert!((0.0..=1.0).contains(&c), "color channel {c} outside 0..1");
    }
}

/// The max, over the box's eight corners, of the distance to the nearest mesh vertex —
/// a preserved sharp corner has a vertex essentially on it (small value).
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

/// A single hard, sharp-tagged box centered in the volume — mostly flat faces (highly
/// redundant triangles) plus twelve genuine sharp edges.
fn box_ops(color: Rgb) -> Vec<FieldOp> {
    vec![FieldOp::AddBox {
        cx: 10.0,
        cy: 10.0,
        cz: 10.0,
        width: 9.4,
        height: 9.4,
        depth: 9.4,
        color,
        blend: 0.0,
        sharp: true,
    }]
}

#[test]
fn flat_heavy_box_is_reduced_and_stays_a_watertight_manifold() {
    let color = Rgb([60, 80, 200]);
    let field = render(bounds(), &GridConfig::dual_contouring(), &box_ops(color));
    let raw = DualContouringMesher.mesh(&field);
    let simplified = simplify_mesh(&raw);

    assert_well_formed(&simplified);
    // The whole point: a box is nearly all flat, coplanar triangles, so decimation
    // removes a large majority of them.
    let raw_tris = raw.indices.len() / 3;
    let simplified_tris = simplified.indices.len() / 3;
    assert!(
        simplified_tris <= raw_tris / 2,
        "expected the flat box to lose at least half its triangles: {raw_tris} -> {simplified_tris}"
    );

    // Requirement: the simplified surface is still a closed 2-manifold (no cracks/holes).
    assert_watertight_manifold(&simplified);

    // Requirement: sharp edges/corners survive — their high collapse error keeps them.
    let h = 9.4 * 0.5;
    let (min, max) = ([10.0 - h; 3], [10.0 + h; 3]);
    let cell = GridConfig::dual_contouring().cell_size;
    assert!(
        max_corner_miss(&simplified, min, max) < 0.5 * cell,
        "sharp corners should survive simplification (a vertex stays on each corner)"
    );

    // Requirement: every color is carried through unchanged from the single-color box —
    // no channel is ever blended to an in-between value.
    let expected = [60.0 / 255.0, 80.0 / 255.0, 200.0 / 255.0];
    for c in simplified.colors.chunks_exact(3) {
        for a in 0..3 {
            assert!(
                (c[a] - expected[a]).abs() < 1.0e-6,
                "color {c:?} was altered from the box's single color {expected:?}"
            );
        }
    }
}

#[test]
fn a_color_boundary_is_preserved_and_never_interpolated() {
    // Two hard boxes of different colors sharing a face union into one bar with a color
    // seam down the middle.
    let red = Rgb([220, 40, 40]);
    let blue = Rgb([40, 60, 220]);
    let ops = vec![
        FieldOp::AddBox {
            cx: 7.0,
            cy: 10.0,
            cz: 10.0,
            width: 6.0,
            height: 6.0,
            depth: 6.0,
            color: red,
            blend: 0.0,
            sharp: true,
        },
        FieldOp::AddBox {
            cx: 13.0,
            cy: 10.0,
            cz: 10.0,
            width: 6.0,
            height: 6.0,
            depth: 6.0,
            color: blue,
            blend: 0.0,
            sharp: true,
        },
    ];
    let field = render(bounds(), &GridConfig::dual_contouring(), &ops);
    let simplified = simplify_mesh(&DualContouringMesher.mesh(&field));

    assert_well_formed(&simplified);
    assert_watertight_manifold(&simplified);

    // Every surviving vertex is *exactly* one of the two source colors — never a blend —
    // and both colors are still present (the boundary patch was not decimated away).
    let red_lin = [220.0 / 255.0, 40.0 / 255.0, 40.0 / 255.0];
    let blue_lin = [40.0 / 255.0, 60.0 / 255.0, 220.0 / 255.0];
    let matches = |c: &[f32], want: &[f32; 3]| (0..3).all(|a| (c[a] - want[a]).abs() < 1.0e-6);
    let (mut reds, mut blues) = (0usize, 0usize);
    for c in simplified.colors.chunks_exact(3) {
        if matches(c, &red_lin) {
            reds += 1;
        } else if matches(c, &blue_lin) {
            blues += 1;
        } else {
            panic!("vertex color {c:?} is neither source color — colors were interpolated");
        }
    }
    assert!(
        reds > 0 && blues > 0,
        "both color regions must survive: {reds} red, {blues} blue"
    );
}

#[test]
fn smooth_sphere_reduces_while_staying_manifold() {
    // Surface nets oversamples a smooth sphere; QEM should thin it while keeping the
    // shell closed and the gradient normals (carried through) unit length.
    let ops = vec![FieldOp::AddSphere {
        cx: 10.0,
        cy: 10.0,
        cz: 10.0,
        r: 7.0,
        color: Rgb([200, 200, 60]),
        blend: 0.0,
        sharp: false,
    }];
    let field = render(bounds(), &GridConfig::surface_nets(), &ops);
    let raw = SurfaceNetsMesher.mesh(&field);
    let simplified = simplify_mesh(&raw);

    assert_well_formed(&simplified);
    assert_watertight_manifold(&simplified);
    assert!(
        simplified.indices.len() < raw.indices.len(),
        "simplification should remove some triangles even on a curved surface"
    );
}

#[test]
fn empty_mesh_passes_through_unchanged() {
    assert!(simplify_mesh(&Mesh::default()).is_empty());
}

#[test]
fn a_mesh_below_the_threshold_is_left_untouched() {
    // A lone triangle is well under MIN_TRIANGLES, so it must survive verbatim rather
    // than being collapsed to nothing.
    let tiny = Mesh {
        positions: vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
        normals: vec![0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0],
        colors: vec![1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        indices: vec![0, 1, 2],
    };
    let out = simplify_mesh(&tiny);
    assert_eq!(out.indices, tiny.indices);
    assert_eq!(out.positions, tiny.positions);
}
