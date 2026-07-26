//! Unit tests for placing a layer onto the canvas.
//!
//! These are the pixel-level guarantees the feature rests on: a layer lands where
//! it was told to, does not erase what it does not cover, and reproduces exactly.

use super::*;
use crate::layer::{ACTUAL_SIZE, OPAQUE};

const RED: Rgba = Rgba([0xff, 0, 0, 0xff]);
const BLUE: Rgba = Rgba([0, 0, 0xff, 0xff]);
const CLEAR: Rgba = Rgba([0, 0, 0, 0]);

fn canvas(width: u32, height: u32, fill: Rgba) -> ImageBuffer {
    ImageBuffer::filled(width, height, fill)
}

/// A layer buffer with every pixel painted.
fn solid(width: u32, height: u32, color: Rgba) -> ImageBuffer {
    ImageBuffer::filled(width, height, color)
}

fn transform(x: i64, y: i64) -> Transform {
    Transform {
        x,
        y,
        opacity: OPAQUE,
        rotation: 0,
        scale_x: ACTUAL_SIZE,
        scale_y: ACTUAL_SIZE,
    }
}

#[test]
fn a_layer_lands_at_its_own_origin() {
    let mut dest = canvas(8, 8, BLUE);
    composite(&mut dest, &solid(2, 2, RED), &transform(3, 4));

    // Exactly the 2x2 block at (3, 4) is red and nothing else moved.
    for y in 0..8 {
        for x in 0..8 {
            let expected = if (3..5).contains(&x) && (4..6).contains(&y) {
                RED
            } else {
                BLUE
            };
            assert_eq!(dest.get(x, y), Some(expected), "pixel ({x}, {y})");
        }
    }
}

#[test]
fn a_layer_smaller_than_the_canvas_leaves_the_rest_alone() {
    // The headline property of a partial layer: it is not a full-size surface with
    // transparent padding that could stamp over the canvas.
    let mut dest = canvas(16, 16, BLUE);
    composite(&mut dest, &solid(2, 2, RED), &transform(0, 0));
    assert_eq!(dest.get(15, 15), Some(BLUE));
    assert_eq!(dest.get(2, 0), Some(BLUE));
    assert_eq!(dest.get(0, 0), Some(RED));
}

#[test]
fn a_layer_larger_than_the_canvas_is_clipped() {
    let mut dest = canvas(4, 4, BLUE);
    composite(&mut dest, &solid(16, 16, RED), &transform(-2, -2));
    for y in 0..4 {
        for x in 0..4 {
            assert_eq!(dest.get(x, y), Some(RED), "pixel ({x}, {y})");
        }
    }
    assert_eq!(dest.width, 4, "compositing never resizes the canvas");
    assert_eq!(dest.rgba.len(), 4 * 4 * 4);
}

#[test]
fn a_layer_entirely_off_canvas_changes_nothing() {
    let mut dest = canvas(4, 4, BLUE);
    let before = dest.clone();
    composite(&mut dest, &solid(2, 2, RED), &transform(100, 100));
    composite(&mut dest, &solid(2, 2, RED), &transform(-100, -100));
    assert_eq!(dest, before);
}

#[test]
fn transparent_layer_pixels_let_the_canvas_show_through() {
    // This is the difference from a drawing operation, which would replace the
    // pixel with transparency and punch a hole in the image.
    let mut dest = canvas(4, 4, BLUE);
    let mut source = solid(4, 4, CLEAR);
    source.set(1, 1, RED);
    composite(&mut dest, &source, &transform(0, 0));

    assert_eq!(dest.get(1, 1), Some(RED));
    assert_eq!(
        dest.get(0, 0),
        Some(BLUE),
        "an unpainted pixel is untouched"
    );
    assert_eq!(dest.get(3, 3), Some(BLUE));
}

#[test]
fn a_fully_transparent_layer_is_a_no_op() {
    let mut dest = canvas(4, 4, BLUE);
    let before = dest.clone();
    composite(&mut dest, &solid(4, 4, CLEAR), &transform(0, 0));
    assert_eq!(dest, before);
}

#[test]
fn zero_opacity_hides_the_layer_entirely() {
    let mut dest = canvas(4, 4, BLUE);
    let before = dest.clone();
    let mut faded = transform(0, 0);
    faded.opacity = 0;
    composite(&mut dest, &solid(4, 4, RED), &faded);
    assert_eq!(dest, before);
}

#[test]
fn full_opacity_replaces_the_pixel_exactly() {
    // No blend rounding may creep into the opaque case: a solid layer must land as
    // the exact color it was painted, or every sprite drifts a shade.
    let mut dest = canvas(4, 4, BLUE);
    composite(&mut dest, &solid(4, 4, RED), &transform(0, 0));
    assert_eq!(dest.get(0, 0), Some(RED));
}

#[test]
fn partial_opacity_blends_toward_the_canvas() {
    let mut dest = canvas(4, 4, BLUE);
    let mut half = transform(0, 0);
    half.opacity = 128;
    composite(&mut dest, &solid(4, 4, RED), &half);

    let blended = dest.get(0, 0).expect("in bounds");
    let [r, g, b, a] = blended.0;
    assert_eq!(a, 0xff, "over an opaque canvas the result stays opaque");
    assert_eq!(g, 0);
    assert!(r > 100 && r < 160, "red should be about half mixed in: {r}");
    assert!(b > 100 && b < 160, "blue should be about half left: {b}");
    // The two channels trade off against each other rather than both fading.
    assert!(
        (r as i32 + b as i32 - 255).abs() <= 2,
        "a two-color blend should conserve intensity: {r} + {b}"
    );
}

#[test]
fn a_quarter_turn_is_exact() {
    // 90° involves no resampling loss, so a rotated layer must be a clean
    // transpose — the case a model is most likely to rely on.
    let mut source = solid(4, 4, CLEAR);
    source.set(0, 0, RED);
    let mut dest = canvas(4, 4, CLEAR);
    let mut turned = transform(0, 0);
    turned.rotation = 90;
    composite(&mut dest, &source, &turned);

    // The corner pixel moved to another corner, and exactly one pixel is painted.
    let painted: Vec<(i64, i64)> = (0..4)
        .flat_map(|y| (0..4).map(move |x| (x, y)))
        .filter(|&(x, y)| dest.get(x, y) == Some(RED))
        .collect();
    assert_eq!(painted.len(), 1, "one pixel in, one pixel out: {painted:?}");
    assert_ne!(painted[0], (0, 0), "the pixel actually rotated");
}

#[test]
fn four_quarter_turns_return_to_the_start() {
    let mut source = solid(4, 4, CLEAR);
    source.set(1, 0, RED);
    source.set(0, 2, BLUE);

    let mut unrotated = canvas(4, 4, CLEAR);
    composite(&mut unrotated, &source, &transform(0, 0));

    let mut full_turn = canvas(4, 4, CLEAR);
    let mut turned = transform(0, 0);
    turned.rotation = 360;
    composite(&mut full_turn, &source, &turned);

    assert_eq!(full_turn, unrotated);
}

#[test]
fn rotation_leaves_no_holes() {
    // The reason sampling is destination-driven: a forward map would leave gaps at
    // an angle, which on a small sprite reads as the shape falling apart.
    let source = solid(8, 8, RED);
    for rotation in [15, 30, 45, 60, 137] {
        let mut dest = canvas(24, 24, CLEAR);
        let mut turned = transform(8, 8);
        turned.rotation = rotation;
        composite(&mut dest, &source, &turned);

        let painted = (0..24)
            .flat_map(|y| (0..24).map(move |x| (x, y)))
            .filter(|&(x, y)| dest.get(x, y) == Some(RED))
            .count();
        // A rotated 8x8 square covers ~64 pixels however it is turned; a
        // hole-punched result would come in far under that.
        assert!(
            painted >= 55,
            "rotation {rotation}° left holes: only {painted} pixels painted"
        );
    }
}

#[test]
fn scaling_up_covers_proportionally_more() {
    let source = solid(4, 4, RED);
    let mut dest = canvas(32, 32, CLEAR);
    let mut scaled = transform(8, 8);
    scaled.scale_x = 200;
    scaled.scale_y = 200;
    composite(&mut dest, &source, &scaled);

    let painted = (0..32)
        .flat_map(|y| (0..32).map(move |x| (x, y)))
        .filter(|&(x, y)| dest.get(x, y) == Some(RED))
        .count();
    assert_eq!(painted, 64, "a 4x4 layer at 200% covers 8x8");
}

#[test]
fn scaling_down_covers_proportionally_less() {
    let source = solid(8, 8, RED);
    let mut dest = canvas(32, 32, CLEAR);
    let mut scaled = transform(8, 8);
    scaled.scale_x = 50;
    scaled.scale_y = 50;
    composite(&mut dest, &source, &scaled);

    let painted = (0..32)
        .flat_map(|y| (0..32).map(move |x| (x, y)))
        .filter(|&(x, y)| dest.get(x, y) == Some(RED))
        .count();
    assert_eq!(painted, 16, "an 8x8 layer at 50% covers 4x4");
}

#[test]
fn a_degenerate_scale_is_a_no_op_rather_than_a_panic() {
    // Nothing in the tool may panic on a hostile or careless value: the recorded
    // document has to replay to completion during regeneration.
    let mut dest = canvas(4, 4, BLUE);
    let before = dest.clone();
    for (scale_x, scale_y) in [(0, 100), (100, 0), (0, 0)] {
        let mut degenerate = transform(0, 0);
        degenerate.scale_x = scale_x;
        degenerate.scale_y = scale_y;
        composite(&mut dest, &solid(4, 4, RED), &degenerate);
    }
    assert_eq!(dest, before);
}

#[test]
fn an_empty_layer_is_a_no_op_rather_than_a_panic() {
    let mut dest = canvas(4, 4, BLUE);
    let before = dest.clone();
    composite(&mut dest, &solid(0, 0, RED), &transform(0, 0));
    composite(&mut dest, &solid(4, 0, RED), &transform(0, 0));
    assert_eq!(dest, before);
}

#[test]
fn compositing_is_deterministic() {
    // The property the whole fixed-point apparatus exists to guarantee: the same
    // inputs must give byte-identical pixels every time.
    let source = solid(6, 6, RED);
    let mut awkward = transform(3, 2);
    awkward.rotation = 37;
    awkward.scale_x = 145;
    awkward.scale_y = 85;
    awkward.opacity = 173;

    let mut first = canvas(16, 16, BLUE);
    composite(&mut first, &source, &awkward);
    let mut second = canvas(16, 16, BLUE);
    composite(&mut second, &source, &awkward);
    assert_eq!(first, second);
}

#[test]
fn negative_rotation_matches_its_positive_complement() {
    let source = solid(6, 6, RED);
    let mut negative = transform(4, 4);
    negative.rotation = -90;
    let mut positive = transform(4, 4);
    positive.rotation = 270;

    let mut first = canvas(16, 16, CLEAR);
    composite(&mut first, &source, &negative);
    let mut second = canvas(16, 16, CLEAR);
    composite(&mut second, &source, &positive);
    assert_eq!(first, second);
}
