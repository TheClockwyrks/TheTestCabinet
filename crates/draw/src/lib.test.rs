//! Unit tests for the drawing library: each operation rasterizes as expected,
//! everything clips at the canvas edge, and the wire form round-trips.

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

/// A layer of `size` painted solid in `color`, placed at `(x, y)`.
fn solid_layer(name: &str, x: i64, y: i64, size: u32, color: Rgba) -> Layer {
    let mut layer = Layer::new(name.to_string(), x, y, size, size);
    layer.ops.push(Operation::FillBackground { color });
    layer
}

#[test]
fn render_frame_with_no_layers_is_exactly_render() {
    // The compatibility guarantee the whole design rests on: every case authored
    // before layers existed, and every run that simply never registers one, must
    // regenerate byte for byte as it always did.
    let operations = [
        Operation::FillBackground { color: OPAQUE_BLUE },
        Operation::FillRect {
            x: 1,
            y: 1,
            width: 2,
            height: 2,
            color: OPAQUE_RED,
        },
    ];
    let plain = render(&canvas(), &operations);
    let framed = render_frame(&canvas(), &operations, &Document::new(), 0);
    assert_eq!(framed, plain);

    // And that holds on every frame index, since an empty document has nothing to
    // resolve differently.
    for frame in 0..8 {
        assert_eq!(
            render_frame(&canvas(), &operations, &Document::new(), frame),
            plain
        );
    }
}

#[test]
fn a_layer_composites_above_the_canvas_log() {
    // Direct drawing is the backdrop; layers sit over it. A model that paints a
    // background then puts a character on a layer expects exactly this order.
    let document = Document {
        layers: vec![solid_layer("spot", 1, 1, 2, OPAQUE_RED)],
    };
    let image = render_frame(
        &canvas(),
        &[Operation::FillBackground { color: OPAQUE_BLUE }],
        &document,
        0,
    );
    assert_eq!(image.get(1, 1), Some(OPAQUE_RED), "the layer is on top");
    assert_eq!(
        image.get(0, 0),
        Some(OPAQUE_BLUE),
        "the log shows elsewhere"
    );
    assert_eq!(image.get(4, 4), Some(OPAQUE_BLUE));
}

#[test]
fn a_layer_starts_transparent_regardless_of_the_canvas_background() {
    // A layer is a surface laid over the image, so its unpainted area must let the
    // canvas through rather than stamping the background over it.
    let opaque_canvas = Canvas {
        width: 5,
        height: 5,
        background: Background::Color(OPAQUE_BLUE),
    };
    let mut layer = Layer::new("dot".to_string(), 0, 0, 5, 5);
    layer.ops.push(Operation::SetPixel {
        x: 2,
        y: 2,
        color: OPAQUE_RED,
    });
    let document = Document {
        layers: vec![layer],
    };

    let image = render_frame(&opaque_canvas, &[], &document, 0);
    assert_eq!(image.get(2, 2), Some(OPAQUE_RED));
    assert_eq!(image.get(0, 0), Some(OPAQUE_BLUE), "no hole punched");
}

#[test]
fn a_keyframed_layer_moves_between_frames() {
    // The feature in one test: one painted layer, no per-frame drawing, and the
    // shape is somewhere different on every frame.
    let mut layer = solid_layer("ball", 0, 0, 1, OPAQUE_RED);
    layer.set_keyframe(
        Property::X,
        Keyframe {
            frame: 0,
            value: 0,
            interp: Interp::Linear,
            out_handle: None,
            in_handle: None,
        },
    );
    layer.set_keyframe(
        Property::X,
        Keyframe {
            frame: 4,
            value: 4,
            interp: Interp::Linear,
            out_handle: None,
            in_handle: None,
        },
    );
    let document = Document {
        layers: vec![layer],
    };

    for frame in 0..=4u32 {
        let image = render_frame(&canvas(), &[], &document, frame);
        let x = frame as i64;
        assert_eq!(
            image.get(x, 0),
            Some(OPAQUE_RED),
            "frame {frame} places the layer"
        );
        // Nothing was left behind at the previous position.
        if x > 0 {
            assert_eq!(
                image.get(x - 1, 0),
                Some(Rgba::TRANSPARENT),
                "frame {frame} smears"
            );
        }
    }
}

#[test]
fn layers_composite_in_z_then_registration_order() {
    let mut over = solid_layer("over", 0, 0, 2, OPAQUE_RED);
    over.z = 1;
    let under = solid_layer("under", 0, 0, 2, OPAQUE_BLUE);
    // Registered with the top layer first, so only `z` can produce the right order.
    let document = Document {
        layers: vec![over, under],
    };
    let image = render_frame(&canvas(), &[], &document, 0);
    assert_eq!(image.get(0, 0), Some(OPAQUE_RED), "higher z wins");
}

#[test]
fn render_frame_is_deterministic() {
    // The property cheat detection depends on: core regenerating a frame must
    // reproduce what the binary previewed, exactly.
    let mut layer = solid_layer("ball", 1, 1, 3, OPAQUE_RED);
    layer.rotation = 37;
    layer.opacity = 200;
    layer.scale_x = 140;
    layer.set_keyframe(
        Property::Y,
        Keyframe {
            frame: 0,
            value: 0,
            interp: Interp::EaseInOut,
            out_handle: None,
            in_handle: None,
        },
    );
    layer.set_keyframe(
        Property::Y,
        Keyframe {
            frame: 5,
            value: 3,
            interp: Interp::EaseInOut,
            out_handle: None,
            in_handle: None,
        },
    );
    let document = Document {
        layers: vec![layer],
    };
    let operations = [Operation::FillBackground { color: OPAQUE_BLUE }];

    for frame in 0..=5 {
        let first = render_frame(&canvas(), &operations, &document, frame);
        let second = render_frame(&canvas(), &operations, &document, frame);
        assert_eq!(first, second, "frame {frame} did not reproduce");
    }
}

#[test]
fn a_layer_document_survives_a_json_round_trip_into_the_same_pixels() {
    // The document is written to disk between operations and re-read by core, so
    // what matters is not just that it parses but that it renders the same.
    let mut layer = solid_layer("ball", 2, 1, 2, OPAQUE_RED);
    layer.rotation = 45;
    layer.set_keyframe(
        Property::X,
        Keyframe {
            frame: 0,
            value: -1,
            interp: Interp::Bezier,
            out_handle: Some([2, 3]),
            in_handle: None,
        },
    );
    let document = Document {
        layers: vec![layer],
    };

    let json = serde_json::to_string(&document).expect("serialize");
    let parsed: Document = serde_json::from_str(&json).expect("deserialize");
    for frame in 0..4 {
        assert_eq!(
            render_frame(&canvas(), &[], &parsed, frame),
            render_frame(&canvas(), &[], &document, frame),
            "frame {frame} changed across the round trip"
        );
    }
}
