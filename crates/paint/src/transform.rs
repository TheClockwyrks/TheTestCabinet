//! Layer transforms: an affine translate/scale/rotate resample, an axis flip, and a
//! half-mirror that reflects one side of a layer onto the other for a symmetric
//! frame. Each rewrites the target layer's raster by inverse-sampling the source.

use crate::color::Color;
use crate::layer::Document;
use crate::raster::{Raster, WrapMode};

impl Document {
    /// Translate, scale (about the document center), then rotate the layer by
    /// `degrees`, resampling with bilinear filtering.
    pub fn transform_layer(
        &mut self,
        layer: usize,
        translate: (f32, f32),
        scale: (f32, f32),
        degrees: f32,
        wrap: WrapMode,
    ) {
        let (w, h) = (self.width, self.height);
        let src = self.layers[layer].raster.clone();
        let (cx, cy) = (w as f32 * 0.5, h as f32 * 0.5);
        let rad = degrees.to_radians();
        let (sin, cos) = rad.sin_cos();
        let (sx, sy) = (scale.0.abs().max(1e-3), scale.1.abs().max(1e-3));
        let dst = &mut self.layers[layer].raster;
        for y in 0..h {
            for x in 0..w {
                // Map the destination pixel back into source space: undo translate,
                // undo rotation about center, undo scale.
                let px = x as f32 + 0.5 - translate.0 - cx;
                let py = y as f32 + 0.5 - translate.1 - cy;
                let rx = px * cos + py * sin;
                let ry = -px * sin + py * cos;
                let ux = rx / sx + cx;
                let uy = ry / sy + cy;
                let sampled = if wrap == WrapMode::Wrap {
                    src.sample(ux - 0.5, uy - 0.5, WrapMode::Wrap)
                } else if ux >= 0.0 && uy >= 0.0 && ux < w as f32 && uy < h as f32 {
                    src.sample(ux - 0.5, uy - 0.5, WrapMode::Clamp)
                } else {
                    Color::TRANSPARENT
                };
                dst.pixels[(y * w + x) as usize] = sampled;
            }
        }
    }

    /// Flip the layer horizontally (`h`) or vertically (`v`).
    pub fn flip(&mut self, layer: usize, horizontal: bool) {
        let (w, h) = (self.width, self.height);
        let raster = &mut self.layers[layer].raster;
        let src = raster.pixels.clone();
        for y in 0..h {
            for x in 0..w {
                let (sx, sy) = if horizontal {
                    (w - 1 - x, y)
                } else {
                    (x, h - 1 - y)
                };
                raster.pixels[(y * w + x) as usize] = src[(sy * w + sx) as usize];
            }
        }
    }

    /// Reflect the columns left of `axis_x` onto the columns to its right, for a
    /// left/right-symmetric frame.
    pub fn mirror(&mut self, layer: usize, axis_x: u32) {
        let (w, h) = (self.width, self.height);
        let raster = &mut self.layers[layer].raster;
        let src = raster.pixels.clone();
        for y in 0..h {
            for x in axis_x..w {
                let mirror = axis_x as i64 - 1 - (x as i64 - axis_x as i64);
                if mirror >= 0 && (mirror as u32) < w {
                    raster.pixels[(y * w + x) as usize] = src[(y * w + mirror as u32) as usize];
                }
            }
        }
    }
}

/// Nearest-neighbor upscale/downscale of a raster to `(width, height)`, used by the
/// nine-slice stretch preview. Wrap-agnostic (clamped).
pub fn resize_nearest(src: &Raster, width: u32, height: u32) -> Raster {
    let mut out = Raster::filled(width, height, Color::TRANSPARENT);
    if width == 0 || height == 0 {
        return out;
    }
    for y in 0..height {
        for x in 0..width {
            let sx = (x as u64 * src.width as u64 / width as u64) as i64;
            let sy = (y as u64 * src.height as u64 / height as u64) as i64;
            out.pixels[(y * width + x) as usize] = src.get_or_transparent(sx, sy, WrapMode::Clamp);
        }
    }
    out
}

#[cfg(test)]
#[path = "transform.test.rs"]
mod tests;
