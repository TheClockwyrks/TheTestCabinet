//! Tests for the field-op apply logic and the stub mesher.

use crate::field::Dims;
use crate::mesher::{Mesher, StubMesher};
use crate::{Axis, FieldOp, GridConfig, Rgb, render};

/// The bounds used across these tests: a 10x10x10 world volume.
fn bounds() -> Dims {
    Dims::new(10.0, 10.0, 10.0)
}

/// The count of nodes strictly inside the composited surface.
fn inside_count(field: &crate::Field) -> usize {
    field.sdf.iter().filter(|&&d| d < 0.0).count()
}

#[test]
fn empty_field_has_no_inside_nodes() {
    let field = render(bounds(), &GridConfig::surface_nets(), &[]);
    assert_eq!(inside_count(&field), 0);
    // The stub mesher emits nothing for an empty field.
    assert!(StubMesher.mesh(&field).is_empty());
}

#[test]
fn add_sphere_fills_inside_and_colors_it() {
    let color = Rgb([200, 30, 30]);
    let ops = vec![FieldOp::AddSphere {
        cx: 5.0,
        cy: 5.0,
        cz: 5.0,
        r: 3.0,
        color,
        blend: 0.0,
        sharp: false,
    }];
    let field = render(bounds(), &GridConfig::surface_nets(), &ops);
    assert!(
        inside_count(&field) > 0,
        "the sphere should carve out inside nodes"
    );

    // The center node is inside and carries the sphere's color.
    let center = field
        .sample_nearest([5.0, 5.0, 5.0])
        .expect("center is in bounds");
    assert!(center.0 < 0.0);
    assert_eq!(center.1, color);

    // The stub mesher produces a (non-empty) bounding-box mesh.
    let mesh = StubMesher.mesh(&field);
    assert!(!mesh.is_empty());
    assert_eq!(mesh.positions.len() / 3, 24);
    assert_eq!(mesh.indices.len(), 36);
}

#[test]
fn subtract_carves_material_away() {
    let ops = vec![
        FieldOp::AddSphere {
            cx: 5.0,
            cy: 5.0,
            cz: 5.0,
            r: 4.0,
            color: Rgb([100, 100, 100]),
            blend: 0.0,
            sharp: false,
        },
        FieldOp::SubtractSphere {
            cx: 5.0,
            cy: 5.0,
            cz: 5.0,
            r: 2.0,
            blend: 0.0,
            sharp: false,
        },
    ];
    let field = render(bounds(), &GridConfig::surface_nets(), &ops);
    // The core is carved back out, so the very center is no longer inside.
    let center = field
        .sample_nearest([5.0, 5.0, 5.0])
        .expect("center is in bounds");
    assert!(center.0 >= 0.0, "the subtracted core should not be solid");
}

#[test]
fn sharp_tag_is_carried_through_the_field() {
    let ops = vec![FieldOp::AddBox {
        cx: 5.0,
        cy: 5.0,
        cz: 5.0,
        width: 4.0,
        height: 4.0,
        depth: 4.0,
        color: Rgb([50, 50, 200]),
        blend: 0.0,
        sharp: true,
    }];
    let field = render(bounds(), &GridConfig::dual_contouring(), &ops);
    assert!(
        field.sharp.iter().any(|&s| s),
        "a sharp-tagged primitive should mark sharp nodes"
    );
}

#[test]
fn clear_empties_the_field() {
    let ops = vec![
        FieldOp::AddSphere {
            cx: 5.0,
            cy: 5.0,
            cz: 5.0,
            r: 3.0,
            color: Rgb([10, 20, 30]),
            blend: 0.0,
            sharp: false,
        },
        FieldOp::Clear,
    ];
    let field = render(bounds(), &GridConfig::surface_nets(), &ops);
    assert_eq!(inside_count(&field), 0);
}

#[test]
fn mirror_reflects_across_the_plane() {
    let ops = vec![
        FieldOp::AddSphere {
            cx: 2.0,
            cy: 5.0,
            cz: 5.0,
            r: 1.5,
            color: Rgb([10, 200, 10]),
            blend: 0.0,
            sharp: false,
        },
        FieldOp::Mirror {
            plane: Axis::X,
            at: 5.0,
        },
    ];
    let field = render(bounds(), &GridConfig::surface_nets(), &ops);
    // The reflected sphere appears on the far side of the plane, at x = 8.
    let reflected = field.sample_nearest([8.0, 5.0, 5.0]).expect("in bounds");
    assert!(
        reflected.0 < 0.0,
        "the mirror should place solid at the reflected center"
    );
}

#[test]
fn op_round_trips_through_json() {
    let op = FieldOp::AddCylinder {
        cx: 1.0,
        cy: 2.0,
        cz: 3.0,
        r: 1.0,
        height: 4.0,
        axis: Axis::Y,
        color: Rgb([1, 2, 3]),
        blend: 0.5,
        sharp: true,
    };
    let json = serde_json::to_string(&op).expect("serialize");
    let back: FieldOp = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(op, back);
}
