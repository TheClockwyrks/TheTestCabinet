use super::*;
use crate::color::Background;
use crate::rng::Rng;

fn opaque(r: f32, g: f32, b: f32) -> Color {
    Color::new(r, g, b, 1.0)
}

#[test]
fn fill_rect_covers_the_region() {
    let mut doc = Document::new(8, 8, Background::Transparent);
    doc.fill_rect(0, false, 2, 2, 4, 4, opaque(1.0, 0.0, 0.0), WrapMode::Clamp);
    assert_eq!(doc.layers[0].raster.get(3, 3, WrapMode::Clamp).unwrap().to_rgba8()[0], 255);
    assert_eq!(doc.layers[0].raster.get(0, 0, WrapMode::Clamp).unwrap().a, 0.0);
}

#[test]
fn brush_stamp_marks_center_opaque() {
    let mut doc = Document::new(16, 16, Background::Transparent);
    let brush = Brush {
        kind: BrushKind::RoundHard,
        size: 8.0,
        hardness: 1.0,
        flow: 1.0,
        opacity: 1.0,
        color: opaque(0.0, 0.0, 1.0),
    };
    let mut rng = Rng::new(1);
    doc.brush_stamp(0, false, &brush, 8.0, 8.0, WrapMode::Clamp, &mut rng);
    assert!(doc.layers[0].raster.get(8, 8, WrapMode::Clamp).unwrap().a > 0.9);
}

#[test]
fn seamless_brush_wraps_across_the_edge() {
    let mut doc = Document::new(16, 16, Background::Transparent);
    let brush = Brush {
        kind: BrushKind::RoundHard,
        size: 8.0,
        hardness: 1.0,
        flow: 1.0,
        opacity: 1.0,
        color: opaque(1.0, 1.0, 1.0),
    };
    let mut rng = Rng::new(1);
    // Stamp on the right edge; with wrap the left edge must also receive paint.
    doc.brush_stamp(0, false, &brush, 15.5, 8.0, WrapMode::Wrap, &mut rng);
    let left = doc.layers[0].raster.get(0, 8, WrapMode::Clamp).unwrap();
    assert!(left.a > 0.0, "left edge did not wrap");
}

#[test]
fn clamped_brush_does_not_wrap() {
    let mut doc = Document::new(16, 16, Background::Transparent);
    let brush = Brush {
        kind: BrushKind::RoundHard,
        size: 8.0,
        hardness: 1.0,
        flow: 1.0,
        opacity: 1.0,
        color: opaque(1.0, 1.0, 1.0),
    };
    let mut rng = Rng::new(1);
    doc.brush_stamp(0, false, &brush, 15.5, 8.0, WrapMode::Clamp, &mut rng);
    let left = doc.layers[0].raster.get(0, 8, WrapMode::Clamp).unwrap();
    assert_eq!(left.a, 0.0);
}

#[test]
fn bucket_fills_a_contiguous_region() {
    let mut doc = Document::new(8, 8, Background::Solid(opaque(0.0, 0.0, 0.0)));
    doc.bucket(0, 0, 0, opaque(1.0, 0.0, 0.0), 0.1, WrapMode::Clamp);
    // The whole uniform layer is one region.
    for p in &doc.layers[0].raster.pixels {
        assert_eq!(p.to_rgba8()[0], 255);
    }
}

#[test]
fn gradient_runs_between_stops() {
    let mut doc = Document::new(16, 1, Background::Transparent);
    let stops = [(0.0, opaque(0.0, 0.0, 0.0)), (1.0, opaque(1.0, 1.0, 1.0))];
    doc.gradient(0, false, false, &stops, (0.0, 0.0), (16.0, 0.0));
    let left = doc.layers[0].raster.get(0, 0, WrapMode::Clamp).unwrap();
    let right = doc.layers[0].raster.get(15, 0, WrapMode::Clamp).unwrap();
    assert!(left.r < right.r);
}

#[test]
fn eval_stops_interpolates_midpoint() {
    let stops = [(0.0, opaque(0.0, 0.0, 0.0)), (1.0, opaque(1.0, 1.0, 1.0))];
    let mid = eval_stops(&stops, 0.5);
    assert!((mid.r - 0.5).abs() < 1e-4);
}
