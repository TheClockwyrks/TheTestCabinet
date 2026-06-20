//! Unit tests for the drawing library: each operation rasterizes as expected,
//! everything clips at the canvas edge, the wire form round-trips, and the
//! generated operations schema covers every operation.

use super::*;
use crate::color::Background;
use crate::ops::Operation;

const OPAQUE_RED: Rgba = Rgba([0xff, 0, 0, 0xff]);
const OPAQUE_BLUE: Rgba = Rgba([0, 0, 0xff, 0xff]);

/// A 5x5 transparent canvas — small enough to assert pixels by hand.
fn canvas() -> Canvas {
    Canvas {
        width: 5,
        height: 5,
        background: Background::Transparent,
    }
}

fn render_one(op: Operation) -> ImageBuffer {
    render(&canvas(), &[op])
}

#[test]
fn fresh_canvas_is_the_background_color() {
    let image = render(
        &Canvas {
            width: 2,
            height: 2,
            background: Background::Color(OPAQUE_RED),
        },
        &[],
    );
    assert!(
        (0..2).all(|y| (0..2).all(|x| image.get(x, y) == Some(OPAQUE_RED))),
        "every pixel starts as the background color"
    );
}

#[test]
fn set_pixel_sets_only_its_pixel_and_clips_off_canvas() {
    let image = render(
        &canvas(),
        &[
            Operation::SetPixel {
                x: 2,
                y: 3,
                color: OPAQUE_RED,
            },
            // Off-canvas writes are silently clipped, never panicking.
            Operation::SetPixel {
                x: 99,
                y: -4,
                color: OPAQUE_BLUE,
            },
        ],
    );
    assert_eq!(image.get(2, 3), Some(OPAQUE_RED));
    assert_eq!(image.get(0, 0), Some(Rgba::TRANSPARENT));
}

#[test]
fn fill_rect_clips_to_the_canvas() {
    // A rect larger than the canvas, offset partly off the top-left, fills only
    // the on-canvas overlap and never panics.
    let image = render_one(Operation::FillRect {
        x: -1,
        y: -1,
        width: 3,
        height: 3,
        color: OPAQUE_RED,
    });
    assert_eq!(image.get(0, 0), Some(OPAQUE_RED));
    assert_eq!(image.get(1, 1), Some(OPAQUE_RED));
    assert_eq!(image.get(2, 2), Some(Rgba::TRANSPARENT));
}

#[test]
fn stroke_rect_draws_only_the_border() {
    let image = render_one(Operation::StrokeRect {
        x: 0,
        y: 0,
        width: 3,
        height: 3,
        color: OPAQUE_RED,
    });
    assert_eq!(image.get(0, 0), Some(OPAQUE_RED), "corner is on the border");
    assert_eq!(image.get(2, 1), Some(OPAQUE_RED), "right edge");
    assert_eq!(image.get(1, 1), Some(Rgba::TRANSPARENT), "center is hollow");
}

#[test]
fn line_connects_its_endpoints() {
    let image = render_one(Operation::Line {
        x0: 0,
        y0: 0,
        x1: 4,
        y1: 4,
        color: OPAQUE_RED,
    });
    for i in 0..5 {
        assert_eq!(image.get(i, i), Some(OPAQUE_RED), "diagonal pixel {i}");
    }
    assert_eq!(image.get(0, 4), Some(Rgba::TRANSPARENT));
}

#[test]
fn fill_circle_fills_center_not_corners() {
    let image = render(
        &Canvas {
            width: 7,
            height: 7,
            background: Background::Transparent,
        },
        &[Operation::FillCircle {
            cx: 3,
            cy: 3,
            r: 2,
            color: OPAQUE_RED,
        }],
    );
    assert_eq!(image.get(3, 3), Some(OPAQUE_RED), "center");
    assert_eq!(image.get(3, 1), Some(OPAQUE_RED), "top of disc");
    assert_eq!(
        image.get(0, 0),
        Some(Rgba::TRANSPARENT),
        "corner is outside"
    );
}

#[test]
fn stroke_circle_is_hollow() {
    let image = render(
        &Canvas {
            width: 9,
            height: 9,
            background: Background::Transparent,
        },
        &[Operation::StrokeCircle {
            cx: 4,
            cy: 4,
            r: 3,
            color: OPAQUE_RED,
        }],
    );
    assert_eq!(image.get(4, 1), Some(OPAQUE_RED), "ring edge");
    assert_eq!(image.get(4, 4), Some(Rgba::TRANSPARENT), "center is hollow");
}

#[test]
fn flood_fill_replaces_the_contiguous_region() {
    // Lay down a solid block, then recolor it via a single flood from inside.
    let image = render(
        &canvas(),
        &[
            Operation::FillRect {
                x: 0,
                y: 0,
                width: 3,
                height: 3,
                color: OPAQUE_RED,
            },
            Operation::FloodFill {
                x: 1,
                y: 1,
                color: OPAQUE_BLUE,
            },
        ],
    );
    assert_eq!(
        image.get(0, 0),
        Some(OPAQUE_BLUE),
        "filled region recolored"
    );
    assert_eq!(image.get(2, 2), Some(OPAQUE_BLUE));
    assert_eq!(
        image.get(4, 4),
        Some(Rgba::TRANSPARENT),
        "outside untouched"
    );
}

#[test]
fn flood_fill_on_matching_color_terminates() {
    // Filling with the color already present must be a no-op, not loop forever.
    let image = render_one(Operation::FloodFill {
        x: 0,
        y: 0,
        color: Rgba::TRANSPARENT,
    });
    assert_eq!(image.get(0, 0), Some(Rgba::TRANSPARENT));
}

#[test]
fn mirror_horizontal_reflects_left_onto_right() {
    let image = render(
        &Canvas {
            width: 4,
            height: 1,
            background: Background::Transparent,
        },
        &[
            Operation::SetPixel {
                x: 0,
                y: 0,
                color: OPAQUE_RED,
            },
            Operation::MirrorHorizontal { axis_x: 2 },
        ],
    );
    // Column 0 reflects across the axis between columns 1 and 2 onto column 3.
    assert_eq!(image.get(3, 0), Some(OPAQUE_RED));
    assert_eq!(image.get(2, 0), Some(Rgba::TRANSPARENT));
}

#[test]
fn color_hex_round_trips() {
    assert_eq!(Rgba::parse_hex("#ff0000"), Ok(OPAQUE_RED));
    assert_eq!(Rgba::parse_hex("#FF000080"), Ok(Rgba([0xff, 0, 0, 0x80])));
    assert_eq!(OPAQUE_RED.to_hex(), "#ff0000ff");
    assert!(Rgba::parse_hex("ff0000").is_err(), "leading # is required");
    assert!(Rgba::parse_hex("#xyz").is_err());
}

#[test]
fn background_parses_transparent_and_hex() {
    assert_eq!(
        Background::parse("transparent"),
        Ok(Background::Transparent)
    );
    assert_eq!(
        Background::parse("#ff0000"),
        Ok(Background::Color(OPAQUE_RED))
    );
}

#[test]
fn operation_round_trips_through_json_with_hex_colors() {
    let op = Operation::FillRect {
        x: 1,
        y: 2,
        width: 3,
        height: 4,
        color: OPAQUE_RED,
    };
    let json = serde_json::to_string(&op).unwrap();
    assert!(
        json.contains("\"op\":\"fill_rect\""),
        "internally tagged: {json}"
    );
    assert!(
        json.contains("\"#ff0000ff\""),
        "color is a hex string: {json}"
    );
    let back: Operation = serde_json::from_str(&json).unwrap();
    assert_eq!(back, op);
}

#[test]
fn rendered_image_encodes_to_a_decodable_png() {
    let bytes = render_one(Operation::FillBackground { color: OPAQUE_RED }).to_png_bytes();
    let decoder = png::Decoder::new(bytes.as_slice());
    let mut reader = decoder.read_info().expect("valid PNG");
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).expect("PNG frame");
    assert_eq!((info.width, info.height), (5, 5));
    assert_eq!(info.color_type, png::ColorType::Rgba);
    assert_eq!(&buf[0..4], &OPAQUE_RED.0, "first pixel is the fill color");
}

#[test]
fn operations_schema_covers_every_operation() {
    let schema = operations_schema_string();
    for tag in [
        "fill_background",
        "set_pixel",
        "fill_rect",
        "stroke_rect",
        "line",
        "fill_circle",
        "stroke_circle",
        "flood_fill",
        "mirror_horizontal",
    ] {
        assert!(schema.contains(tag), "schema is missing `{tag}`");
    }
    // It must be valid JSON.
    serde_json::from_str::<serde_json::Value>(&schema).expect("schema is valid JSON");
}

#[test]
fn committed_schema_matches_the_generated_one() {
    // `operations.schema.json` is the canonical artifact each asset-generation
    // test case seeds verbatim as its `[tool].operations` contract. If this fails
    // the operation set changed: regenerate with `draw schema --out
    // crates/draw/operations.schema.json` and re-copy it into every case.
    let committed = include_str!("../operations.schema.json");
    assert_eq!(
        operations_schema_string(),
        committed,
        "operations.schema.json is stale; regenerate it with `draw schema`"
    );
}
