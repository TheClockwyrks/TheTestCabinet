use super::*;
use crate::color::Background;
use crate::raster::WrapMode;

fn params(size: f32, color: Color) -> EffectParams {
    EffectParams {
        size,
        color,
        angle: 135.0,
        distance: 4.0,
    }
}

#[test]
fn drop_shadow_adds_coverage_outside_the_shape() {
    let mut doc = Document::new(24, 24, Background::Transparent);
    doc.fill_rect(
        0,
        false,
        8,
        8,
        8,
        8,
        Color::new(1.0, 1.0, 1.0, 1.0),
        WrapMode::Clamp,
    );
    let before = doc.layers[0]
        .raster
        .pixels
        .iter()
        .filter(|c| c.a > 0.0)
        .count();
    doc.layer_effect(
        0,
        EffectKind::DropShadow,
        params(4.0, Color::new(0.0, 0.0, 0.0, 1.0)),
    );
    let after = doc.layers[0]
        .raster
        .pixels
        .iter()
        .filter(|c| c.a > 0.0)
        .count();
    assert!(after > before, "shadow should add covered pixels");
}

#[test]
fn stroke_outlines_the_edge() {
    let mut doc = Document::new(16, 16, Background::Transparent);
    doc.fill_rect(
        0,
        false,
        6,
        6,
        4,
        4,
        Color::new(1.0, 1.0, 1.0, 1.0),
        WrapMode::Clamp,
    );
    doc.layer_effect(
        0,
        EffectKind::Stroke,
        params(2.0, Color::new(1.0, 0.0, 0.0, 1.0)),
    );
    // A pixel just outside the original square now carries the stroke color.
    let c = doc.layers[0].raster.get(5, 8, WrapMode::Clamp).unwrap();
    assert!(c.r > 0.5 && c.a > 0.0);
}

#[test]
fn glow_does_not_panic_on_empty_layer() {
    let mut doc = Document::new(8, 8, Background::Transparent);
    doc.layer_effect(
        0,
        EffectKind::Glow,
        params(3.0, Color::new(1.0, 1.0, 0.0, 1.0)),
    );
}
