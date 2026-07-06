use super::*;
use crate::color::Background;

fn opaque(r: f32, g: f32, b: f32) -> Color {
    Color::new(r, g, b, 1.0)
}

fn filled(fill: Color) -> ShapeStyle {
    ShapeStyle {
        fill: Some(fill),
        stroke: None,
        stroke_width: 0.0,
    }
}

#[test]
fn rect_fills_interior() {
    let mut doc = Document::new(32, 32, Background::Transparent);
    doc.shape_rect(
        0,
        8.0,
        8.0,
        16.0,
        16.0,
        filled(opaque(0.2, 0.5, 0.9)),
        WrapMode::Clamp,
    );
    assert!(doc.layers[0].raster.get(16, 16, WrapMode::Clamp).unwrap().a > 0.9);
    assert_eq!(
        doc.layers[0].raster.get(0, 0, WrapMode::Clamp).unwrap().a,
        0.0
    );
}

#[test]
fn rounded_rect_clips_corners() {
    let mut doc = Document::new(40, 40, Background::Transparent);
    doc.shape_rounded_rect(
        0,
        4.0,
        4.0,
        32.0,
        32.0,
        12.0,
        filled(opaque(1.0, 1.0, 1.0)),
        WrapMode::Clamp,
    );
    // The extreme corner is rounded away, the center is filled.
    assert!(doc.layers[0].raster.get(20, 20, WrapMode::Clamp).unwrap().a > 0.9);
    assert!(doc.layers[0].raster.get(5, 5, WrapMode::Clamp).unwrap().a < 0.5);
}

#[test]
fn ellipse_is_round() {
    let mut doc = Document::new(40, 40, Background::Transparent);
    doc.shape_ellipse(
        0,
        20.0,
        20.0,
        15.0,
        15.0,
        filled(opaque(0.0, 1.0, 0.0)),
        WrapMode::Clamp,
    );
    assert!(doc.layers[0].raster.get(20, 20, WrapMode::Clamp).unwrap().a > 0.9);
    // A point outside the circle but inside the bbox corner is empty.
    assert!(doc.layers[0].raster.get(6, 6, WrapMode::Clamp).unwrap().a < 0.5);
}

#[test]
fn line_draws_a_stroke() {
    let mut doc = Document::new(32, 32, Background::Transparent);
    doc.shape_line(
        0,
        2.0,
        2.0,
        30.0,
        30.0,
        opaque(1.0, 0.0, 0.0),
        2.0,
        WrapMode::Clamp,
    );
    assert!(doc.layers[0].raster.get(16, 16, WrapMode::Clamp).unwrap().a > 0.5);
    assert!(doc.layers[0].raster.get(2, 30, WrapMode::Clamp).unwrap().a < 0.2);
}

#[test]
fn polygon_fills_a_triangle() {
    let mut doc = Document::new(32, 32, Background::Transparent);
    let tri = [(16.0, 4.0), (28.0, 28.0), (4.0, 28.0)];
    doc.shape_polygon(0, &tri, filled(opaque(0.9, 0.9, 0.1)), WrapMode::Clamp);
    assert!(doc.layers[0].raster.get(16, 20, WrapMode::Clamp).unwrap().a > 0.9);
    assert!(doc.layers[0].raster.get(2, 2, WrapMode::Clamp).unwrap().a < 0.5);
}
