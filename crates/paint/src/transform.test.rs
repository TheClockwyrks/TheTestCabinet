use super::*;
use crate::color::Background;

fn opaque(r: f32, g: f32, b: f32) -> Color {
    Color::new(r, g, b, 1.0)
}

#[test]
fn flip_horizontal_swaps_columns() {
    let mut doc = Document::new(4, 1, Background::Transparent);
    doc.layers[0].raster.pixels[0] = opaque(1.0, 0.0, 0.0);
    doc.flip(0, true);
    assert_eq!(doc.layers[0].raster.pixels[3].to_rgba8()[0], 255);
    assert_eq!(doc.layers[0].raster.pixels[0].a, 0.0);
}

#[test]
fn mirror_reflects_left_onto_right() {
    let mut doc = Document::new(4, 1, Background::Transparent);
    doc.layers[0].raster.pixels[0] = opaque(1.0, 0.0, 0.0); // column 0
    doc.mirror(0, 2);
    // Column 3 mirrors column 0.
    assert_eq!(doc.layers[0].raster.pixels[3].to_rgba8()[0], 255);
}

#[test]
fn translate_moves_content() {
    let mut doc = Document::new(8, 8, Background::Transparent);
    doc.fill_rect(0, false, 0, 0, 2, 2, opaque(0.0, 1.0, 0.0), WrapMode::Clamp);
    doc.transform_layer(0, (4.0, 4.0), (1.0, 1.0), 0.0, WrapMode::Clamp);
    assert!(doc.layers[0].raster.get(4, 4, WrapMode::Clamp).unwrap().g > 0.5);
    assert_eq!(
        doc.layers[0].raster.get(0, 0, WrapMode::Clamp).unwrap().a,
        0.0
    );
}

#[test]
fn resize_nearest_scales_dimensions() {
    let src = Raster::filled(2, 2, opaque(0.5, 0.5, 0.5));
    let out = resize_nearest(&src, 6, 4);
    assert_eq!((out.width, out.height), (6, 4));
}
