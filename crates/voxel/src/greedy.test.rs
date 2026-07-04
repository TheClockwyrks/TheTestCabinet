//! Tests for greedy quad-merged cube meshing: the merged mesh describes the identical
//! surface as the reference per-face mesher (same faces, same colors, same winding),
//! never has more triangles, and collapses flat regions the way greedy meshing should.

use std::collections::BTreeSet;

use super::build_greedy_part_mesh;
use crate::mesh::{PartMesh, build_part_mesh};
use crate::{Dims, Rgb, VoxelSet};

const RED: Rgb = Rgb([0xff, 0, 0]);
const BLUE: Rgb = Rgb([0, 0, 0xff]);

/// A canonical descriptor of one exposed unit face: its outward normal, the plane it
/// lies in (the constant-axis coordinate), the two in-plane integer cell coordinates,
/// and its color. Two meshes that cover the same surface produce the same set of these.
type FaceCell = ([i8; 3], i64, i64, i64, [u8; 3]);

/// Decompose a [`PartMesh`] (quads emitted as vertex groups of four) into the set of
/// unit `FaceCell`s it covers. A reference quad contributes one cell; a merged greedy
/// quad contributes every unit cell of its rectangle. Equal sets ⇒ identical surfaces.
fn face_cells(mesh: &PartMesh) -> BTreeSet<FaceCell> {
    let mut cells = BTreeSet::new();
    let quads = mesh.positions.len() / 12; // 4 vertices * 3 floats per quad
    for q in 0..quads {
        let vbase = q * 12;
        let corners: Vec<[i64; 3]> = (0..4)
            .map(|c| {
                let o = vbase + c * 3;
                [
                    mesh.positions[o] as i64,
                    mesh.positions[o + 1] as i64,
                    mesh.positions[o + 2] as i64,
                ]
            })
            .collect();
        let nbase = vbase; // normals are parallel to positions
        let normal = [
            mesh.normals[nbase] as i8,
            mesh.normals[nbase + 1] as i8,
            mesh.normals[nbase + 2] as i8,
        ];
        let cbase = vbase;
        let color = [
            (mesh.colors[cbase] * 255.0).round() as u8,
            (mesh.colors[cbase + 1] * 255.0).round() as u8,
            (mesh.colors[cbase + 2] * 255.0).round() as u8,
        ];
        // The constant axis is the one the normal points along; the other two span the
        // rectangle.
        let const_axis = (0..3)
            .find(|&a| normal[a] != 0)
            .expect("axis-aligned normal");
        let plane = corners[0][const_axis];
        let in_plane: Vec<usize> = (0..3).filter(|&a| a != const_axis).collect();
        let (a, b) = (in_plane[0], in_plane[1]);
        let amin = corners.iter().map(|p| p[a]).min().unwrap();
        let amax = corners.iter().map(|p| p[a]).max().unwrap();
        let bmin = corners.iter().map(|p| p[b]).min().unwrap();
        let bmax = corners.iter().map(|p| p[b]).max().unwrap();
        for ai in amin..amax {
            for bi in bmin..bmax {
                cells.insert((normal, plane, ai, bi, color));
            }
        }
    }
    cells
}

/// Sum of triangle areas — a scalar invariant a faithful re-triangulation preserves.
fn surface_area(mesh: &PartMesh) -> f64 {
    let mut area = 0.0;
    for tri in mesh.indices.chunks_exact(3) {
        let p: Vec<[f64; 3]> = tri
            .iter()
            .map(|&i| {
                let o = i as usize * 3;
                [
                    mesh.positions[o] as f64,
                    mesh.positions[o + 1] as f64,
                    mesh.positions[o + 2] as f64,
                ]
            })
            .collect();
        let u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
        let v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
        let cross = [
            u[1] * v[2] - u[2] * v[1],
            u[2] * v[0] - u[0] * v[2],
            u[0] * v[1] - u[1] * v[0],
        ];
        area += (cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2]).sqrt() / 2.0;
    }
    area
}

/// Assert the shared well-formedness invariants `core`'s validator also enforces.
fn assert_well_formed(mesh: &PartMesh) {
    assert_eq!(mesh.positions.len() % 3, 0);
    assert_eq!(mesh.normals.len(), mesh.positions.len());
    assert_eq!(mesh.colors.len(), mesh.positions.len());
    assert_eq!(mesh.indices.len() % 3, 0);
    let vertices = (mesh.positions.len() / 3) as u32;
    for &i in &mesh.indices {
        assert!(i < vertices, "index {i} out of range {vertices}");
    }
    for &f in mesh
        .positions
        .iter()
        .chain(&mesh.normals)
        .chain(&mesh.colors)
    {
        assert!(f.is_finite(), "non-finite value {f}");
    }
}

fn dims(n: u32) -> Dims {
    Dims {
        width: n,
        height: n,
        depth: n,
    }
}

/// A fully solid `n`×`n`×`n` block of a single color.
fn solid_block(n: u32, color: Rgb) -> VoxelSet {
    let mut set = VoxelSet::empty(dims(n));
    for z in 0..n as i64 {
        for y in 0..n as i64 {
            for x in 0..n as i64 {
                set.set(x, y, z, color);
            }
        }
    }
    set
}

#[test]
fn merged_mesh_covers_the_same_surface_as_the_reference() {
    // An irregular, multi-color shape exercises culling, color boundaries, and partial
    // merges: a solid block with a bite taken out and a second-color slab on top.
    let mut set = VoxelSet::empty(dims(6));
    for z in 0..6i64 {
        for y in 0..4i64 {
            for x in 0..6i64 {
                set.set(x, y, z, RED);
            }
        }
    }
    // Carve an interior-facing notch.
    for z in 2..4i64 {
        for x in 2..4i64 {
            set.clear(x, 3, z);
        }
    }
    // A blue cap on part of the top.
    for z in 0..3i64 {
        for x in 0..6i64 {
            set.set(x, 4, z, BLUE);
        }
    }

    let reference = build_part_mesh(&set);
    let greedy = build_greedy_part_mesh(&set);

    assert_well_formed(&greedy);
    // The whole point of the equivalence: the two meshes cover exactly the same unit
    // faces, with the same normals and colors — greedy is a pure re-triangulation.
    assert_eq!(
        face_cells(&greedy),
        face_cells(&reference),
        "greedy mesh must cover the identical exposed-face surface"
    );
    // A re-triangulation of the same surface has the same total area.
    assert!((surface_area(&greedy) - surface_area(&reference)).abs() < 1.0e-6);
    // Merging never produces more triangles than the reference.
    assert!(greedy.indices.len() <= reference.indices.len());
}

#[test]
fn a_solid_block_collapses_each_face_to_a_single_quad() {
    // Every face of a solid block is one flat, single-color rectangle, so greedy meshing
    // merges each to one quad: 6 faces * 2 triangles = 12.
    let set = solid_block(8, RED);
    let greedy = build_greedy_part_mesh(&set);

    assert_well_formed(&greedy);
    assert_eq!(
        greedy.indices.len() / 3,
        12,
        "a solid block should merge to 12 triangles"
    );
    // The reference mesh, by contrast, emits a quad (two triangles) per unit face:
    // 6 sides * 8 * 8 faces = 384 faces = 768 triangles.
    assert_eq!(build_part_mesh(&set).indices.len() / 3, 768);

    // Every vertex keeps the block's single color, never blended.
    let expected = [1.0, 0.0, 0.0];
    for c in greedy.colors.chunks_exact(3) {
        assert_eq!(c, expected);
    }
    // Normals stay hard axis units.
    for n in greedy.normals.chunks_exact(3) {
        let nonzero = n.iter().filter(|&&x| x != 0.0).count();
        assert_eq!(nonzero, 1, "cube normals are axis-aligned: {n:?}");
        assert!(n.iter().all(|&x| x == -1.0 || x == 0.0 || x == 1.0));
    }
}

#[test]
fn a_color_boundary_blocks_a_merge() {
    // Two color halves in one flat slab: each color's faces merge among themselves but
    // never across the seam, so the top gets two quads, not one.
    let mut set = VoxelSet::empty(Dims {
        width: 4,
        height: 1,
        depth: 2,
    });
    for z in 0..2i64 {
        for x in 0..4i64 {
            set.set(x, 0, z, if x < 2 { RED } else { BLUE });
        }
    }
    let greedy = build_greedy_part_mesh(&set);
    assert_well_formed(&greedy);
    assert_eq!(
        face_cells(&greedy),
        face_cells(&build_part_mesh(&set)),
        "same surface as the reference"
    );

    // The +Y (top) face: two merged quads (one per color), never one blended rectangle.
    let top_quads = greedy
        .normals
        .chunks_exact(12) // one quad = 4 vertices * 3 normal floats
        .filter(|q| q[0..3] == [0.0, 1.0, 0.0])
        .count();
    assert_eq!(top_quads, 2, "the top must split at the color seam");
}

#[test]
fn an_empty_volume_meshes_to_nothing() {
    let set = VoxelSet::empty(dims(4));
    let greedy = build_greedy_part_mesh(&set);
    assert!(greedy.positions.is_empty());
    assert!(greedy.indices.is_empty());
}
