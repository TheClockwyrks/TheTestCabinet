//! The working raster: a straight-RGBA `f32` image with wrap-aware addressing.
//!
//! Every layer, mask, and composited preview is a [`Raster`]. Addressing goes
//! through [`WrapMode`] so a **material** map (authored seamlessly) samples and
//! writes toroidally — a stroke that runs off the right edge continues on the left —
//! while a **UI** element clips at its bounds. That single switch is what makes the
//! `texture` binary's brushes, gradients, filters, and patterns tile by
//! construction with no separate "make seamless" pass.

use std::path::Path;

use crate::color::Color;

/// How out-of-bounds pixel coordinates are resolved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WrapMode {
    /// Clip: an off-image coordinate has no pixel (UI elements).
    Clamp,
    /// Toroidal wrap: every coordinate maps into the image modulo its size
    /// (seamless material maps).
    Wrap,
}

/// An in-memory straight-RGBA `f32` image, row-major, four channels per pixel.
#[derive(Debug, Clone, PartialEq)]
pub struct Raster {
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// Row-major straight-RGBA pixels.
    pub pixels: Vec<Color>,
}

impl Raster {
    /// A new image with every pixel set to `fill`.
    pub fn filled(width: u32, height: u32, fill: Color) -> Raster {
        Raster {
            width,
            height,
            pixels: vec![fill; width as usize * height as usize],
        }
    }

    /// Resolve `(x, y)` to a storage index under `wrap`, or `None` when clamped
    /// out of bounds.
    pub fn index(&self, x: i64, y: i64, wrap: WrapMode) -> Option<usize> {
        let (w, h) = (self.width as i64, self.height as i64);
        if w == 0 || h == 0 {
            return None;
        }
        let (x, y) = match wrap {
            WrapMode::Clamp => {
                if x < 0 || y < 0 || x >= w || y >= h {
                    return None;
                }
                (x, y)
            }
            WrapMode::Wrap => (x.rem_euclid(w), y.rem_euclid(h)),
        };
        Some((y as usize) * self.width as usize + x as usize)
    }

    /// The pixel at `(x, y)` under `wrap`, or `None` when clamped off-image.
    pub fn get(&self, x: i64, y: i64, wrap: WrapMode) -> Option<Color> {
        self.index(x, y, wrap).map(|i| self.pixels[i])
    }

    /// The pixel at `(x, y)`, treating off-image as transparent (wrap-aware).
    pub fn get_or_transparent(&self, x: i64, y: i64, wrap: WrapMode) -> Color {
        self.get(x, y, wrap).unwrap_or(Color::TRANSPARENT)
    }

    /// Replace the pixel at `(x, y)` under `wrap` (off-image clamped writes are
    /// dropped).
    pub fn set(&mut self, x: i64, y: i64, color: Color, wrap: WrapMode) {
        if let Some(i) = self.index(x, y, wrap) {
            self.pixels[i] = color;
        }
    }

    /// Bilinearly sample the image at continuous `(x, y)` under `wrap` — the reader
    /// gradients, warps, and transforms use so a resampled result stays smooth and
    /// (for a material) seamless.
    pub fn sample(&self, x: f32, y: f32, wrap: WrapMode) -> Color {
        let x0 = x.floor() as i64;
        let y0 = y.floor() as i64;
        let fx = x - x0 as f32;
        let fy = y - y0 as f32;
        let c00 = self.get_or_transparent(x0, y0, wrap);
        let c10 = self.get_or_transparent(x0 + 1, y0, wrap);
        let c01 = self.get_or_transparent(x0, y0 + 1, wrap);
        let c11 = self.get_or_transparent(x0 + 1, y0 + 1, wrap);
        let top = lerp_color(c00, c10, fx);
        let bottom = lerp_color(c01, c11, fx);
        lerp_color(top, bottom, fy)
    }

    /// Encode to 8-bit RGBA PNG bytes.
    pub fn to_png_bytes(&self) -> Vec<u8> {
        let mut rgba = Vec::with_capacity(self.pixels.len() * 4);
        for pixel in &self.pixels {
            rgba.extend_from_slice(&pixel.to_rgba8());
        }
        encode_png(self.width.max(1), self.height.max(1), &rgba)
    }

    /// Encode and write the image to `path`.
    pub fn write_png(&self, path: &Path) -> std::io::Result<()> {
        std::fs::write(path, self.to_png_bytes())
    }

    /// Build a raster from decoded 8-bit RGBA bytes.
    pub fn from_rgba8(width: u32, height: u32, rgba: &[u8]) -> Raster {
        let pixels = rgba
            .chunks_exact(4)
            .map(|c| Color::from_rgba8([c[0], c[1], c[2], c[3]]))
            .collect();
        Raster {
            width,
            height,
            pixels,
        }
    }
}

/// Linearly interpolate two colors (straight RGBA) by `t` in `0..=1`.
pub fn lerp_color(a: Color, b: Color, t: f32) -> Color {
    Color {
        r: a.r + (b.r - a.r) * t,
        g: a.g + (b.g - a.g) * t,
        b: a.b + (b.b - a.b) * t,
        a: a.a + (b.a - a.a) * t,
    }
}

/// Encode row-major RGBA8 bytes as a PNG.
pub fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Vec<u8> {
    let mut buf = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut buf, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .expect("writing a PNG header to an in-memory buffer cannot fail");
        writer
            .write_image_data(rgba)
            .expect("writing PNG data to an in-memory buffer cannot fail");
    }
    buf
}

#[cfg(test)]
#[path = "raster.test.rs"]
mod tests;
