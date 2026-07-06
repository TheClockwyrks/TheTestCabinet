//! Per-layer filters: blur, sharpen, additive noise, levels, curves, hue/sat, and
//! desaturate. Each rewrites the active layer's pixels, and where a selection is
//! active the filtered result is blended back by the selection's coverage so the
//! effect stays inside the masked region.

use crate::color::Color;
use crate::layer::Document;
use crate::raster::{Raster, WrapMode};
use crate::rng::Rng;
use crate::select::box_blur;

impl Document {
    /// Apply `f` to a copy of the layer's pixels and blend the result back by the
    /// selection coverage (fully where nothing is selected).
    fn map_layer(&mut self, layer: usize, f: impl FnOnce(&Raster) -> Vec<Color>) {
        let sel: Vec<f32> = (0..self.pixel_count())
            .map(|i| self.selection_at(i))
            .collect();
        let raster = &mut self.layers[layer].raster;
        let filtered = f(raster);
        for (i, out) in filtered.into_iter().enumerate() {
            let t = sel[i];
            let old = raster.pixels[i];
            raster.pixels[i] = Color {
                r: old.r + (out.r - old.r) * t,
                g: old.g + (out.g - old.g) * t,
                b: old.b + (out.b - old.b) * t,
                a: old.a + (out.a - old.a) * t,
            };
        }
    }

    /// Gaussian-ish box blur of the given radius (separable, three-tap is enough for
    /// a smooth preview).
    pub fn blur(&mut self, layer: usize, radius: u32, wrap: WrapMode) {
        if radius == 0 {
            return;
        }
        self.map_layer(layer, |raster| blur_rgba(raster, radius, wrap));
    }

    /// A 3×3 unsharp-mask sharpen.
    pub fn sharpen(&mut self, layer: usize, wrap: WrapMode) {
        self.map_layer(layer, |raster| {
            let blurred = blur_rgba(raster, 1, wrap);
            raster
                .pixels
                .iter()
                .zip(blurred)
                .map(|(&orig, soft)| Color {
                    r: (orig.r + (orig.r - soft.r)).clamp(0.0, 1.0),
                    g: (orig.g + (orig.g - soft.g)).clamp(0.0, 1.0),
                    b: (orig.b + (orig.b - soft.b)).clamp(0.0, 1.0),
                    a: orig.a,
                })
                .collect()
        });
    }

    /// Add seeded per-pixel monochrome noise of the given amount (`0..=1`).
    pub fn noise_filter(&mut self, layer: usize, amount: f32, seed: u64) {
        self.map_layer(layer, |raster| {
            let mut rng = Rng::new(seed);
            raster
                .pixels
                .iter()
                .map(|&c| {
                    let n = rng.next_signed() * amount;
                    Color {
                        r: (c.r + n).clamp(0.0, 1.0),
                        g: (c.g + n).clamp(0.0, 1.0),
                        b: (c.b + n).clamp(0.0, 1.0),
                        a: c.a,
                    }
                })
                .collect()
        });
    }

    /// Remap tonal range: everything below `black` goes to 0, above `white` to 1,
    /// with a midtone `gamma`.
    pub fn levels(&mut self, layer: usize, black: f32, white: f32, gamma: f32) {
        let (black, white) = (black.clamp(0.0, 1.0), white.clamp(0.0, 1.0));
        let span = (white - black).max(1e-4);
        let inv_gamma = 1.0 / gamma.max(1e-3);
        self.map_layer(layer, |raster| {
            raster
                .pixels
                .iter()
                .map(|&c| {
                    let f = |v: f32| (((v - black) / span).clamp(0.0, 1.0)).powf(inv_gamma);
                    Color {
                        r: f(c.r),
                        g: f(c.g),
                        b: f(c.b),
                        a: c.a,
                    }
                })
                .collect()
        });
    }

    /// A symmetric S-curve contrast adjustment; `amount > 0` steepens, `< 0` flattens.
    pub fn curves(&mut self, layer: usize, amount: f32) {
        let a = amount.clamp(-1.0, 1.0);
        self.map_layer(layer, |raster| {
            raster
                .pixels
                .iter()
                .map(|&c| {
                    let f = |v: f32| {
                        // Blend the identity with a smoothstep S-curve by `a`.
                        let s = v * v * (3.0 - 2.0 * v);
                        (v + (s - v) * a).clamp(0.0, 1.0)
                    };
                    Color {
                        r: f(c.r),
                        g: f(c.g),
                        b: f(c.b),
                        a: c.a,
                    }
                })
                .collect()
        });
    }

    /// Shift hue (degrees), scale saturation, and offset lightness.
    pub fn hue_sat(&mut self, layer: usize, hue_deg: f32, sat: f32, lightness: f32) {
        self.map_layer(layer, |raster| {
            raster
                .pixels
                .iter()
                .map(|&c| {
                    let (h, s, l) = rgb_to_hsl(c.r, c.g, c.b);
                    let h = (h + hue_deg / 360.0).rem_euclid(1.0);
                    let s = (s * (1.0 + sat)).clamp(0.0, 1.0);
                    let l = (l + lightness).clamp(0.0, 1.0);
                    let (r, g, b) = hsl_to_rgb(h, s, l);
                    Color { r, g, b, a: c.a }
                })
                .collect()
        });
    }

    /// Collapse the layer to grayscale (preserving alpha).
    pub fn desaturate(&mut self, layer: usize) {
        self.map_layer(layer, |raster| {
            raster
                .pixels
                .iter()
                .map(|&c| {
                    let y = c.luma();
                    Color {
                        r: y,
                        g: y,
                        b: y,
                        a: c.a,
                    }
                })
                .collect()
        });
    }
}

/// Blur each RGBA channel of a raster with a separable box blur.
pub fn blur_rgba(raster: &Raster, radius: u32, wrap: WrapMode) -> Vec<Color> {
    let (w, h) = (raster.width, raster.height);
    let r_ch: Vec<f32> = raster.pixels.iter().map(|c| c.r).collect();
    let g_ch: Vec<f32> = raster.pixels.iter().map(|c| c.g).collect();
    let b_ch: Vec<f32> = raster.pixels.iter().map(|c| c.b).collect();
    let a_ch: Vec<f32> = raster.pixels.iter().map(|c| c.a).collect();
    let blur = |ch: &[f32]| {
        if wrap == WrapMode::Wrap {
            wrap_box_blur(ch, w, h, radius)
        } else {
            box_blur(ch, w, h, radius)
        }
    };
    let (rb, gb, bb, ab) = (blur(&r_ch), blur(&g_ch), blur(&b_ch), blur(&a_ch));
    (0..raster.pixels.len())
        .map(|i| Color {
            r: rb[i],
            g: gb[i],
            b: bb[i],
            a: ab[i],
        })
        .collect()
}

/// A separable box blur that wraps toroidally, so a blurred material map stays
/// seamless.
fn wrap_box_blur(src: &[f32], width: u32, height: u32, radius: u32) -> Vec<f32> {
    let (w, h) = (width as i64, height as i64);
    let r = radius as i64;
    let idx = |x: i64, y: i64| (y.rem_euclid(h) * w + x.rem_euclid(w)) as usize;
    let norm = (2 * r + 1) as f32;
    let mut tmp = vec![0.0f32; src.len()];
    for y in 0..h {
        for x in 0..w {
            let mut sum = 0.0;
            for dx in -r..=r {
                sum += src[idx(x + dx, y)];
            }
            tmp[idx(x, y)] = sum / norm;
        }
    }
    let mut out = vec![0.0f32; src.len()];
    for y in 0..h {
        for x in 0..w {
            let mut sum = 0.0;
            for dy in -r..=r {
                sum += tmp[idx(x, y + dy)];
            }
            out[idx(x, y)] = sum / norm;
        }
    }
    out
}

/// RGB (`0..=1`) to HSL (`0..=1` each).
pub fn rgb_to_hsl(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    if (max - min).abs() < 1e-6 {
        return (0.0, 0.0, l);
    }
    let d = max - min;
    let s = if l > 0.5 {
        d / (2.0 - max - min)
    } else {
        d / (max + min)
    };
    let h = if max == r {
        ((g - b) / d).rem_euclid(6.0)
    } else if max == g {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    } / 6.0;
    (h, s, l)
}

/// HSL (`0..=1` each) back to RGB (`0..=1`).
pub fn hsl_to_rgb(h: f32, s: f32, l: f32) -> (f32, f32, f32) {
    if s <= 0.0 {
        return (l, l, l);
    }
    let q = if l < 0.5 {
        l * (1.0 + s)
    } else {
        l + s - l * s
    };
    let p = 2.0 * l - q;
    let hue = |t: f32| {
        let t = t.rem_euclid(1.0);
        if t < 1.0 / 6.0 {
            p + (q - p) * 6.0 * t
        } else if t < 0.5 {
            q
        } else if t < 2.0 / 3.0 {
            p + (q - p) * (2.0 / 3.0 - t) * 6.0
        } else {
            p
        }
    };
    (hue(h + 1.0 / 3.0), hue(h), hue(h - 1.0 / 3.0))
}

#[cfg(test)]
#[path = "filters.test.rs"]
mod tests;
