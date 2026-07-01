//! Unit tests for the sculpting library: each operation applies as expected,
//! everything clips at the volume edge, the wire form round-trips, and
//! `voxels.json` serializes in the shape core's `VoxelsFile` reads.

use super::*;
use crate::color::PreviewBackground;
use crate::ops::{Axis, Operation};

const RED: Rgb = Rgb([0xff, 0, 0]);
const BLUE: Rgb = Rgb([0, 0, 0xff]);

/// A 5x5x5 empty volume — small enough to assert cells by hand.
fn dims() -> Dims {
    Dims {
        width: 5,
        height: 5,
        depth: 5,
    }
}

fn render_one(op: Operation) -> VoxelSet {
    render(&dims(), &[op])
}

#[test]
fn fresh_volume_is_empty() {
    let set = VoxelSet::empty(dims());
    assert_eq!(set.occupied_count(), 0);
    assert_eq!(set.get(0, 0, 0), None);
}

#[test]
fn set_voxel_sets_only_its_cell_and_clips_off_volume() {
    let set = render(
        &dims(),
        &[
            Operation::SetVoxel {
                x: 2,
                y: 3,
                z: 1,
                color: RED,
            },
            // Off-volume writes are silently clipped, never panicking.
            Operation::SetVoxel {
                x: 99,
                y: -4,
                z: 0,
                color: BLUE,
            },
        ],
    );
    assert_eq!(set.get(2, 3, 1), Some(RED));
    assert_eq!(set.get(0, 0, 0), None);
    assert_eq!(set.occupied_count(), 1);
}

#[test]
fn fill_box_clips_to_the_volume() {
    // A box larger than the volume, offset partly off the minimum corner, fills
    // only the in-volume overlap and never panics.
    let set = render_one(Operation::FillBox {
        x: -1,
        y: -1,
        z: -1,
        width: 3,
        height: 3,
        depth: 3,
        color: RED,
    });
    assert_eq!(set.get(0, 0, 0), Some(RED));
    assert_eq!(set.get(1, 1, 1), Some(RED));
    assert_eq!(set.get(2, 2, 2), None);
    // The 2x2x2 in-volume overlap.
    assert_eq!(set.occupied_count(), 8);
}

#[test]
fn stroke_box_fills_only_the_edges() {
    let set = render(
        &dims(),
        &[Operation::StrokeBox {
            x: 0,
            y: 0,
            z: 0,
            width: 3,
            height: 3,
            depth: 3,
            color: RED,
        }],
    );
    assert_eq!(set.get(0, 0, 0), Some(RED), "corner is on an edge");
    assert_eq!(set.get(1, 0, 0), Some(RED), "edge midpoint");
    assert_eq!(set.get(1, 1, 0), None, "face center is hollow");
    assert_eq!(set.get(1, 1, 1), None, "interior is hollow");
    // A 3x3x3 cube has 12 edges of length 3, sharing 8 corners: 12*3 - 8*2 = 20.
    assert_eq!(set.occupied_count(), 20);
}

#[test]
fn fill_sphere_fills_center_not_corners() {
    let set = render(
        &Dims {
            width: 7,
            height: 7,
            depth: 7,
        },
        &[Operation::FillSphere {
            cx: 3,
            cy: 3,
            cz: 3,
            r: 2,
            color: RED,
        }],
    );
    assert_eq!(set.get(3, 3, 3), Some(RED), "center");
    assert_eq!(set.get(3, 1, 3), Some(RED), "pole");
    assert_eq!(set.get(1, 1, 1), None, "corner is outside the ball");
}

#[test]
fn line_connects_its_endpoints() {
    let set = render_one(Operation::Line {
        x0: 0,
        y0: 0,
        z0: 0,
        x1: 4,
        y1: 4,
        z1: 4,
        color: RED,
    });
    for i in 0..5 {
        assert_eq!(set.get(i, i, i), Some(RED), "diagonal cell {i}");
    }
    assert_eq!(set.occupied_count(), 5);
}

#[test]
fn line_steps_along_the_dominant_axis() {
    // A shallow line along x sets exactly one cell per x step.
    let set = render(
        &Dims {
            width: 5,
            height: 5,
            depth: 1,
        },
        &[Operation::Line {
            x0: 0,
            y0: 0,
            z0: 0,
            x1: 4,
            y1: 2,
            z1: 0,
            color: RED,
        }],
    );
    assert_eq!(set.get(0, 0, 0), Some(RED));
    assert_eq!(set.get(4, 2, 0), Some(RED));
    assert_eq!(set.occupied_count(), 5, "one cell per dominant-axis step");
}

#[test]
fn clear_voxel_and_clear_box_empty_cells() {
    let set = render(
        &dims(),
        &[
            Operation::FillBox {
                x: 0,
                y: 0,
                z: 0,
                width: 3,
                height: 3,
                depth: 3,
                color: RED,
            },
            Operation::ClearVoxel { x: 0, y: 0, z: 0 },
            Operation::ClearBox {
                x: 1,
                y: 1,
                z: 1,
                width: 2,
                height: 2,
                depth: 2,
            },
        ],
    );
    assert_eq!(set.get(0, 0, 0), None, "single cleared voxel");
    assert_eq!(set.get(2, 2, 2), None, "box-cleared voxel");
    assert_eq!(set.get(1, 0, 0), Some(RED), "untouched voxel remains");
    // 27 filled, minus 1 single clear, minus the 2x2x2 box (8): 27 - 1 - 8 = 18.
    assert_eq!(set.occupied_count(), 18);
}

#[test]
fn mirror_reflects_low_onto_high() {
    let set = render(
        &Dims {
            width: 4,
            height: 1,
            depth: 1,
        },
        &[
            Operation::SetVoxel {
                x: 0,
                y: 0,
                z: 0,
                color: RED,
            },
            Operation::Mirror {
                plane: Axis::X,
                at: 2,
            },
        ],
    );
    // Slice x=0 reflects across the plane between x=1 and x=2 onto x=3.
    assert_eq!(set.get(3, 0, 0), Some(RED));
    assert_eq!(set.get(2, 0, 0), None);
}

#[test]
fn color_hex_round_trips_and_rejects_alpha() {
    assert_eq!(Rgb::parse_hex("#ff0000"), Ok(RED));
    assert_eq!(RED.to_hex(), "#ff0000");
    assert!(Rgb::parse_hex("ff0000").is_err(), "leading # is required");
    assert!(Rgb::parse_hex("#xyz").is_err());
    assert!(
        Rgb::parse_hex("#ff000080").is_err(),
        "an alpha component is rejected"
    );
}

#[test]
fn preview_background_parses_transparent_and_hex() {
    assert_eq!(
        PreviewBackground::parse("transparent"),
        Ok(PreviewBackground::Transparent)
    );
    assert_eq!(
        PreviewBackground::parse("#ff0000"),
        Ok(PreviewBackground::Color(RED))
    );
    assert_eq!(PreviewBackground::Transparent.fill(), [0, 0, 0, 0]);
    assert_eq!(
        PreviewBackground::Color(RED).fill(),
        [0xff, 0, 0, 0xff],
        "a color background is opaque"
    );
}

#[test]
fn operation_round_trips_through_json_with_hex_colors() {
    let op = Operation::FillBox {
        x: 1,
        y: 2,
        z: 3,
        width: 4,
        height: 5,
        depth: 6,
        color: RED,
    };
    let json = serde_json::to_string(&op).unwrap();
    assert!(
        json.contains("\"op\":\"fill_box\""),
        "internally tagged: {json}"
    );
    assert!(
        json.contains("\"#ff0000\""),
        "color is a hex string: {json}"
    );
    let back: Operation = serde_json::from_str(&json).unwrap();
    assert_eq!(back, op);
}

#[test]
fn mirror_op_serializes_axis_as_snake_case() {
    let json = serde_json::to_string(&Operation::Mirror {
        plane: Axis::Z,
        at: 8,
    })
    .unwrap();
    assert!(json.contains("\"op\":\"mirror\""), "{json}");
    assert!(json.contains("\"plane\":\"z\""), "{json}");
}

/// A local mirror of core's `VoxelsFile`/`VoxelDims`/`VoxelCell` shape, used to
/// confirm `to_voxels_json` deserializes into exactly that contract shape.
#[derive(serde::Deserialize)]
struct VoxelsFile {
    dims: VoxelDims,
    voxels: Vec<VoxelCell>,
}

#[derive(serde::Deserialize)]
struct VoxelDims {
    width: u32,
    height: u32,
    depth: u32,
}

#[derive(serde::Deserialize)]
struct VoxelCell {
    x: i64,
    y: i64,
    z: i64,
    color: String,
}

#[test]
fn to_voxels_json_matches_the_contract_shape() {
    let set = render(
        &Dims {
            width: 3,
            height: 2,
            depth: 2,
        },
        &[
            Operation::SetVoxel {
                x: 0,
                y: 0,
                z: 0,
                color: RED,
            },
            Operation::SetVoxel {
                x: 2,
                y: 1,
                z: 1,
                color: BLUE,
            },
        ],
    );
    let json = set.to_voxels_json();
    let parsed: VoxelsFile = serde_json::from_str(&json).expect("valid VoxelsFile shape");
    assert_eq!(
        (parsed.dims.width, parsed.dims.height, parsed.dims.depth),
        (3, 2, 2)
    );
    assert_eq!(parsed.voxels.len(), 2);
    // Scan order is x fastest, then y, then z, so (0,0,0) precedes (2,1,1).
    let first = &parsed.voxels[0];
    assert_eq!((first.x, first.y, first.z), (0, 0, 0));
    assert_eq!(first.color, "#ff0000");
    let second = &parsed.voxels[1];
    assert_eq!((second.x, second.y, second.z), (2, 1, 1));
    assert_eq!(second.color, "#0000ff");
}

#[test]
fn to_voxels_json_of_an_empty_volume_has_no_voxels() {
    let json = VoxelSet::empty(dims()).to_voxels_json();
    let parsed: VoxelsFile = serde_json::from_str(&json).expect("valid shape");
    assert!(parsed.voxels.is_empty());
}
