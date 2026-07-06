use super::*;
use crate::color::Background;
use crate::raster::WrapMode;

/// A tiling noise basis must agree at coordinates a whole period apart, which is
/// exactly what makes a generated map seamless.
#[test]
fn perlin_is_periodic() {
    let period = 8;
    for &(x, y) in &[(0.0, 0.0), (1.3, 2.7), (5.5, 6.1)] {
        let a = perlin(x, y, period, 99);
        let b = perlin(x + period as f32, y, period, 99);
        let c = perlin(x, y + period as f32, period, 99);
        assert!((a - b).abs() < 1e-4, "x-period: {a} {b}");
        assert!((a - c).abs() < 1e-4, "y-period: {a} {c}");
    }
}

#[test]
fn worley_is_periodic() {
    let period = 6;
    let a = worley(1.2, 3.4, period, 5);
    let b = worley(1.2 + period as f32, 3.4, period, 5);
    assert!((a - b).abs() < 1e-4, "{a} {b}");
}

#[test]
fn generated_noise_map_tiles_at_edges() {
    let mut doc = Document::new(32, 32, Background::Transparent);
    doc.gen_noise(0, NoiseKind::Fbm, 4.0, 3, 7);
    let r = &doc.layers[0].raster;
    // A tiling map: the wrapped neighbor of the last column matches the first.
    for y in 0..32 {
        let left = r.get(0, y, WrapMode::Clamp).unwrap().r;
        let wrapped = r.get(-1, y, WrapMode::Wrap).unwrap().r; // == column 31
        let right = r.get(31, y, WrapMode::Clamp).unwrap().r;
        assert_eq!(wrapped, right);
        // Continuity across the seam: column 0 and column 31 should be close.
        assert!(
            (left - right).abs() < 0.35,
            "seam jump at y={y}: {left} {right}"
        );
    }
}

#[test]
fn checker_alternates() {
    let mut doc = Document::new(16, 16, Background::Transparent);
    doc.gen_pattern(0, PatternKind::Checker, 4.0);
    let a = doc.layers[0].raster.get(0, 0, WrapMode::Clamp).unwrap().r;
    let b = doc.layers[0].raster.get(4, 0, WrapMode::Clamp).unwrap().r;
    assert!((a - b).abs() > 0.5);
}

#[test]
fn gradient_map_recolors_by_luma() {
    let mut doc = Document::new(2, 1, Background::Transparent);
    doc.layers[0].raster.pixels[0] = Color::new(0.0, 0.0, 0.0, 1.0);
    doc.layers[0].raster.pixels[1] = Color::new(1.0, 1.0, 1.0, 1.0);
    let stops = [
        (0.0, Color::new(1.0, 0.0, 0.0, 1.0)),
        (1.0, Color::new(0.0, 0.0, 1.0, 1.0)),
    ];
    doc.gradient_map(0, &stops);
    assert!(doc.layers[0].raster.pixels[0].r > 0.9); // dark -> red
    assert!(doc.layers[0].raster.pixels[1].b > 0.9); // light -> blue
}
