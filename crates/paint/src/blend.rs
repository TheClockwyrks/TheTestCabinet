//! The twelve blend modes and the top-to-bottom alpha compositing that turns a
//! layer stack into one flattened image.
//!
//! Each blend mode is a separable per-channel function `B(cb, cs)` of the backdrop
//! and source channel; [`BlendMode::blend_channel`] evaluates it. Compositing a
//! source over a backdrop uses the W3C compositing-and-blending formula: the source
//! color is first mixed toward `B(cb, cs)` by the backdrop's alpha, then combined
//! with the backdrop by ordinary source-over. Fully-opaque layers therefore reduce
//! to the familiar Photoshop result (`multiply` of two opaques is their product),
//! while partial alpha behaves as a painting tool expects.

use serde::{Deserialize, Serialize};

use crate::color::Color;

/// One of the twelve blend modes a layer can carry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BlendMode {
    /// Source-over: the source simply covers the backdrop by its alpha.
    Normal,
    /// `cb * cs` — darkens.
    Multiply,
    /// `1 - (1-cb)(1-cs)` — lightens.
    Screen,
    /// Multiply the darks, screen the lights (hard-light with roles swapped).
    Overlay,
    /// `min(1, cb + cs)` — linear dodge.
    Add,
    /// `max(0, cb - cs)`.
    Subtract,
    /// `min(cb, cs)`.
    Darken,
    /// `max(cb, cs)`.
    Lighten,
    /// A soft, photographic contrast increase.
    SoftLight,
    /// Overlay with source and backdrop swapped.
    HardLight,
    /// Brighten the backdrop toward the source.
    ColorDodge,
    /// Darken the backdrop toward the source.
    ColorBurn,
}

impl BlendMode {
    /// Evaluate the mode's per-channel function on backdrop `cb` and source `cs`
    /// (both `0..=1`).
    pub fn blend_channel(self, cb: f32, cs: f32) -> f32 {
        match self {
            BlendMode::Normal => cs,
            BlendMode::Multiply => cb * cs,
            BlendMode::Screen => cb + cs - cb * cs,
            BlendMode::Overlay => hard_light(cs, cb),
            BlendMode::Add => (cb + cs).min(1.0),
            BlendMode::Subtract => (cb - cs).max(0.0),
            BlendMode::Darken => cb.min(cs),
            BlendMode::Lighten => cb.max(cs),
            BlendMode::SoftLight => soft_light(cb, cs),
            BlendMode::HardLight => hard_light(cb, cs),
            BlendMode::ColorDodge => {
                if cs >= 1.0 {
                    1.0
                } else {
                    (cb / (1.0 - cs)).min(1.0)
                }
            }
            BlendMode::ColorBurn => {
                if cs <= 0.0 {
                    0.0
                } else {
                    1.0 - ((1.0 - cb) / cs).min(1.0)
                }
            }
        }
    }
}

/// The overlay/hard-light kernel: `hard_light(cb, cs)` is overlay's shape with the
/// contrast driven by `cs`.
fn hard_light(cb: f32, cs: f32) -> f32 {
    if cs <= 0.5 {
        2.0 * cb * cs
    } else {
        1.0 - 2.0 * (1.0 - cb) * (1.0 - cs)
    }
}

/// The W3C soft-light function.
fn soft_light(cb: f32, cs: f32) -> f32 {
    if cs <= 0.5 {
        cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb)
    } else {
        let d = if cb <= 0.25 {
            ((16.0 * cb - 12.0) * cb + 4.0) * cb
        } else {
            cb.sqrt()
        };
        cb + (2.0 * cs - 1.0) * (d - cb)
    }
}

/// Composite `src` (the source pixel, straight RGBA) over `dst` (the accumulated
/// backdrop) with blend `mode` and an extra `coverage` (`0..=1`) that scales the
/// source's alpha — used for per-layer opacity, a layer mask, and a selection clip
/// all at once. Returns the new backdrop pixel (straight RGBA).
pub fn composite_over(dst: Color, src: Color, mode: BlendMode, coverage: f32) -> Color {
    let a_s = (src.a * coverage).clamp(0.0, 1.0);
    let a_b = dst.a;
    if a_s <= 0.0 {
        return dst;
    }
    let blended = |cb: f32, cs: f32| {
        // Mix the raw source toward the blended color by the backdrop's alpha, so a
        // blend mode only "sees" the backdrop where the backdrop is opaque.
        (1.0 - a_b) * cs + a_b * mode.blend_channel(cb, cs)
    };
    let cs_r = blended(dst.r, src.r);
    let cs_g = blended(dst.g, src.g);
    let cs_b = blended(dst.b, src.b);
    let a_o = a_s + a_b * (1.0 - a_s);
    if a_o <= 0.0 {
        return Color::TRANSPARENT;
    }
    let mix = |cb: f32, cs: f32| (a_s * cs + a_b * (1.0 - a_s) * cb) / a_o;
    Color {
        r: mix(dst.r, cs_r),
        g: mix(dst.g, cs_g),
        b: mix(dst.b, cs_b),
        a: a_o,
    }
}

#[cfg(test)]
#[path = "blend.test.rs"]
mod tests;
