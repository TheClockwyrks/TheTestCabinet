use super::*;
use crate::color::Background;

fn opaque(r: f32, g: f32, b: f32) -> Color {
    Color::new(r, g, b, 1.0)
}

#[test]
fn desaturate_makes_gray() {
    let mut doc = Document::new(1, 1, Background::Transparent);
    doc.layers[0].raster.pixels[0] = opaque(1.0, 0.0, 0.0);
    doc.desaturate(0);
    let c = doc.layers[0].raster.pixels[0];
    assert!((c.r - c.g).abs() < 1e-5 && (c.g - c.b).abs() < 1e-5);
}

#[test]
fn hsl_roundtrip() {
    for (r, g, b) in [(0.2, 0.5, 0.8), (0.9, 0.1, 0.3), (0.5, 0.5, 0.5)] {
        let (h, s, l) = rgb_to_hsl(r, g, b);
        let (r2, g2, b2) = hsl_to_rgb(h, s, l);
        assert!((r - r2).abs() < 1e-3, "{r} {r2}");
        assert!((g - g2).abs() < 1e-3);
        assert!((b - b2).abs() < 1e-3);
    }
}

#[test]
fn levels_clips_black_and_white() {
    let mut doc = Document::new(2, 1, Background::Transparent);
    doc.layers[0].raster.pixels[0] = opaque(0.1, 0.1, 0.1);
    doc.layers[0].raster.pixels[1] = opaque(0.9, 0.9, 0.9);
    doc.levels(0, 0.2, 0.8, 1.0);
    assert_eq!(doc.layers[0].raster.pixels[0].r, 0.0);
    assert!((doc.layers[0].raster.pixels[1].r - 1.0).abs() < 1e-4);
}

#[test]
fn blur_averages_a_spike() {
    let mut doc = Document::new(5, 1, Background::Solid(opaque(0.0, 0.0, 0.0)));
    doc.layers[0].raster.pixels[2] = opaque(1.0, 1.0, 1.0);
    doc.blur(0, 1, WrapMode::Clamp);
    // The spike spreads to its neighbors.
    assert!(doc.layers[0].raster.pixels[1].r > 0.0);
    assert!(doc.layers[0].raster.pixels[2].r < 1.0);
}

#[test]
fn noise_is_reproducible() {
    let mut a = Document::new(4, 4, Background::Solid(opaque(0.5, 0.5, 0.5)));
    let mut b = Document::new(4, 4, Background::Solid(opaque(0.5, 0.5, 0.5)));
    a.noise_filter(0, 0.2, 123);
    b.noise_filter(0, 0.2, 123);
    assert_eq!(a.layers[0].raster.pixels, b.layers[0].raster.pixels);
}
