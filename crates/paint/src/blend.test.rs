use super::*;

fn approx(a: f32, b: f32) {
    assert!((a - b).abs() < 1e-4, "{a} != {b}");
}

#[test]
fn opaque_multiply_is_product() {
    approx(BlendMode::Multiply.blend_channel(0.5, 0.5), 0.25);
    approx(BlendMode::Multiply.blend_channel(1.0, 0.7), 0.7);
    approx(BlendMode::Multiply.blend_channel(0.0, 0.9), 0.0);
}

#[test]
fn screen_lightens() {
    approx(BlendMode::Screen.blend_channel(0.5, 0.5), 0.75);
    approx(BlendMode::Screen.blend_channel(0.0, 0.3), 0.3);
}

#[test]
fn darken_lighten() {
    approx(BlendMode::Darken.blend_channel(0.2, 0.8), 0.2);
    approx(BlendMode::Lighten.blend_channel(0.2, 0.8), 0.8);
}

#[test]
fn add_and_subtract_clamp() {
    approx(BlendMode::Add.blend_channel(0.7, 0.7), 1.0);
    approx(BlendMode::Subtract.blend_channel(0.3, 0.7), 0.0);
    approx(BlendMode::Subtract.blend_channel(0.7, 0.3), 0.4);
}

#[test]
fn overlay_and_hardlight_edges() {
    // Overlay against black backdrop stays dark; against white stays light.
    approx(BlendMode::Overlay.blend_channel(0.0, 0.5), 0.0);
    approx(BlendMode::Overlay.blend_channel(1.0, 0.5), 1.0);
}

#[test]
fn color_dodge_burn_extremes() {
    approx(BlendMode::ColorDodge.blend_channel(0.5, 1.0), 1.0);
    approx(BlendMode::ColorBurn.blend_channel(0.5, 0.0), 0.0);
}

#[test]
fn opaque_normal_over_replaces() {
    let dst = Color::new(1.0, 0.0, 0.0, 1.0);
    let src = Color::new(0.0, 0.0, 1.0, 1.0);
    let out = composite_over(dst, src, BlendMode::Normal, 1.0);
    approx(out.b, 1.0);
    approx(out.r, 0.0);
    approx(out.a, 1.0);
}

#[test]
fn half_alpha_normal_averages() {
    let dst = Color::new(0.0, 0.0, 0.0, 1.0);
    let src = Color::new(1.0, 1.0, 1.0, 1.0);
    let out = composite_over(dst, src, BlendMode::Normal, 0.5);
    approx(out.r, 0.5);
    approx(out.a, 1.0);
}

#[test]
fn zero_coverage_is_noop() {
    let dst = Color::new(0.2, 0.4, 0.6, 1.0);
    let out = composite_over(dst, Color::new(1.0, 0.0, 0.0, 1.0), BlendMode::Normal, 0.0);
    assert_eq!(out, dst);
}

#[test]
fn over_transparent_backdrop_keeps_source() {
    let out = composite_over(
        Color::TRANSPARENT,
        Color::new(0.2, 0.4, 0.8, 1.0),
        BlendMode::Multiply,
        1.0,
    );
    // With no backdrop coverage, multiply must not darken the source to black.
    approx(out.r, 0.2);
    approx(out.g, 0.4);
    approx(out.b, 0.8);
    approx(out.a, 1.0);
}
