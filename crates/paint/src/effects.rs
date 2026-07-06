//! Layer effects — the finishing passes that read as "professional": a bevel, an
//! inner shadow, a drop shadow, an edge stroke, and an outer glow. Each is derived
//! from the layer's own alpha coverage and baked back into the layer (a drop shadow
//! and glow sit *under* the existing content; a bevel, inner shadow, and stroke sit
//! *over* it), so the flattened element carries the effect without a separate layer.

use crate::blend::{BlendMode, composite_over};
use crate::color::Color;
use crate::filters::blur_rgba;
use crate::layer::Document;
use crate::raster::{Raster, WrapMode};

/// Which layer effect to apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EffectKind {
    /// A raised edge lit from `angle`.
    Bevel,
    /// A shadow cast inward from the shape's edge.
    InnerShadow,
    /// A shadow cast behind the shape.
    DropShadow,
    /// A solid outline around the shape's edge.
    Stroke,
    /// An outer halo of light around the shape.
    Glow,
}

/// The tunable parameters an effect reads (not every effect uses every field).
#[derive(Debug, Clone, Copy)]
pub struct EffectParams {
    /// Effect radius / thickness in pixels.
    pub size: f32,
    /// The effect color (shadow, stroke, or glow color).
    pub color: Color,
    /// Light / cast angle in degrees.
    pub angle: f32,
    /// Cast distance in pixels (shadows).
    pub distance: f32,
}

impl Document {
    /// Apply a layer effect to the layer's current content.
    pub fn layer_effect(&mut self, layer: usize, kind: EffectKind, params: EffectParams) {
        let (w, h) = (self.width, self.height);
        let raster = self.layers[layer].raster.clone();
        let alpha: Vec<f32> = raster.pixels.iter().map(|c| c.a).collect();
        let radius = params.size.max(0.0).round() as u32;
        let (dx, dy) = offset(params.angle, params.distance);
        let out = match kind {
            EffectKind::DropShadow => {
                let shadow = shadow_layer(&alpha, w, h, radius, params.color, dx, dy);
                under(&shadow, &raster)
            }
            EffectKind::Glow => {
                let glow = shadow_layer(&alpha, w, h, radius.max(1), params.color, 0.0, 0.0);
                under(&glow, &raster)
            }
            EffectKind::Stroke => {
                let stroke = stroke_layer(&alpha, w, h, params.size.max(1.0), params.color);
                over(&raster, &stroke)
            }
            EffectKind::InnerShadow => {
                let inner = inner_shadow_layer(&alpha, w, h, radius.max(1), params.color, dx, dy);
                over(&raster, &inner)
            }
            EffectKind::Bevel => bevel(&raster, &alpha, w, h, params),
        };
        self.layers[layer].raster = out;
    }
}

fn offset(angle_deg: f32, distance: f32) -> (f32, f32) {
    let rad = angle_deg.to_radians();
    (rad.cos() * distance, -rad.sin() * distance)
}

/// A blurred, offset, colorized copy of the alpha coverage — the raw material of a
/// shadow or glow.
fn shadow_layer(
    alpha: &[f32],
    w: u32,
    h: u32,
    radius: u32,
    color: Color,
    dx: f32,
    dy: f32,
) -> Raster {
    let mut field = Raster::filled(w, h, Color::TRANSPARENT);
    for (i, px) in field.pixels.iter_mut().enumerate() {
        *px = Color {
            r: color.r,
            g: color.g,
            b: color.b,
            a: alpha[i] * color.a,
        };
    }
    // Offset by sampling the source shifted.
    let shifted = {
        let src = field.clone();
        for y in 0..h {
            for x in 0..w {
                field.pixels[(y * w + x) as usize] =
                    src.sample(x as f32 - dx, y as f32 - dy, WrapMode::Clamp);
            }
        }
        field
    };
    if radius == 0 {
        return shifted;
    }
    let blurred = blur_rgba(&shifted, radius, WrapMode::Clamp);
    Raster {
        width: w,
        height: h,
        pixels: blurred,
    }
}

/// An outline hugging the shape's edge: the dilated alpha minus the original.
fn stroke_layer(alpha: &[f32], w: u32, h: u32, size: f32, color: Color) -> Raster {
    let r = size.max(1.0).round() as i64;
    let idx =
        |x: i64, y: i64| (y.clamp(0, h as i64 - 1) * w as i64 + x.clamp(0, w as i64 - 1)) as usize;
    let mut out = Raster::filled(w, h, Color::TRANSPARENT);
    for y in 0..h as i64 {
        for x in 0..w as i64 {
            let mut maxa = 0.0f32;
            for dy in -r..=r {
                for dx in -r..=r {
                    if dx * dx + dy * dy <= r * r {
                        maxa = maxa.max(alpha[idx(x + dx, y + dy)]);
                    }
                }
            }
            let ring = (maxa - alpha[idx(x, y)]).clamp(0.0, 1.0);
            out.pixels[idx(x, y)] = Color {
                r: color.r,
                g: color.g,
                b: color.b,
                a: ring * color.a,
            };
        }
    }
    out
}

/// A shadow that falls *inside* the shape near its edge.
fn inner_shadow_layer(
    alpha: &[f32],
    w: u32,
    h: u32,
    radius: u32,
    color: Color,
    dx: f32,
    dy: f32,
) -> Raster {
    // Invert the coverage, blur+offset it, then keep only the part inside the shape.
    let inverted: Vec<f32> = alpha.iter().map(|a| 1.0 - a).collect();
    let shadow = shadow_layer(&inverted, w, h, radius, color, dx, dy);
    let mut out = Raster::filled(w, h, Color::TRANSPARENT);
    for (i, px) in out.pixels.iter_mut().enumerate() {
        *px = Color {
            a: shadow.pixels[i].a * alpha[i],
            ..shadow.pixels[i]
        };
    }
    out
}

/// A cheap bevel: shade the layer by the sign of its alpha gradient projected onto
/// the light direction — lit toward the light, darkened away from it, only inside
/// the shape.
fn bevel(raster: &Raster, alpha: &[f32], w: u32, h: u32, params: EffectParams) -> Raster {
    let (lx, ly) = {
        let rad = params.angle.to_radians();
        (rad.cos(), -rad.sin())
    };
    let idx =
        |x: i64, y: i64| (y.clamp(0, h as i64 - 1) * w as i64 + x.clamp(0, w as i64 - 1)) as usize;
    let strength = (params.size / 8.0).clamp(0.1, 1.0);
    let mut out = raster.clone();
    for y in 0..h as i64 {
        for x in 0..w as i64 {
            let i = idx(x, y);
            if alpha[i] <= 0.0 {
                continue;
            }
            let gx = alpha[idx(x + 1, y)] - alpha[idx(x - 1, y)];
            let gy = alpha[idx(x, y + 1)] - alpha[idx(x, y - 1)];
            let lit = (gx * lx + gy * ly) * strength;
            let mut c = out.pixels[i];
            let shade = 1.0 + lit;
            c.r = (c.r * shade).clamp(0.0, 1.0);
            c.g = (c.g * shade).clamp(0.0, 1.0);
            c.b = (c.b * shade).clamp(0.0, 1.0);
            out.pixels[i] = c;
        }
    }
    out
}

/// Composite `top` over `bottom`, returning a new raster.
fn over(bottom: &Raster, top: &Raster) -> Raster {
    let mut out = bottom.clone();
    for i in 0..out.pixels.len() {
        out.pixels[i] = composite_over(bottom.pixels[i], top.pixels[i], BlendMode::Normal, 1.0);
    }
    out
}

/// Composite `top` under `bottom` (i.e. `bottom` over `top`).
fn under(under_layer: &Raster, content: &Raster) -> Raster {
    over(under_layer, content)
}

#[cfg(test)]
#[path = "effects.test.rs"]
mod tests;
