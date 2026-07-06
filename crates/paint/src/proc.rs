//! The procedural generators the `texture` binary leans on: tiling noise
//! (perlin/worley/fbm/ridged), regular patterns (bricks/hex/planks/checker/weave),
//! a domain warp, and a grayscale→color gradient map. Every generator is **tileable
//! by construction** — its lattice, feature cells, and pattern period all wrap at
//! the map edge — so a material authored with them repeats without a seam.

use crate::color::Color;
use crate::layer::Document;
use crate::paint_core::eval_stops;
use crate::raster::WrapMode;

/// Which coherent-noise basis a `noise` operation uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NoiseKind {
    /// Classic gradient (Perlin) noise.
    Perlin,
    /// Cellular (Worley) F1 noise.
    Worley,
    /// Fractal Brownian motion (summed Perlin octaves).
    Fbm,
    /// Ridged multifractal (sharp ridges from inverted absolute noise).
    Ridged,
}

/// Which regular pattern a `pattern` operation stamps.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PatternKind {
    /// A running-bond brick course.
    Bricks,
    /// A hex grid.
    Hex,
    /// Parallel planks.
    Planks,
    /// A checkerboard.
    Checker,
    /// An over/under basket weave.
    Weave,
}

impl Document {
    /// Fill the active layer with tiling coherent noise as grayscale, replacing its
    /// content. `scale` is the number of noise cells across the map (the tiling
    /// period); `octaves` applies to fbm/ridged.
    pub fn gen_noise(
        &mut self,
        layer: usize,
        kind: NoiseKind,
        scale: f32,
        octaves: u32,
        seed: u64,
    ) {
        let period = (scale.max(1.0)).round() as i64;
        let (w, h) = (self.width, self.height);
        let raster = &mut self.layers[layer].raster;
        for py in 0..h {
            for px in 0..w {
                let x = px as f32 / w as f32 * period as f32;
                let y = py as f32 / h as f32 * period as f32;
                let v = match kind {
                    NoiseKind::Perlin => perlin(x, y, period, seed) * 0.5 + 0.5,
                    NoiseKind::Worley => worley(x, y, period, seed),
                    NoiseKind::Fbm => fbm(x, y, period, octaves.max(1), seed, false),
                    NoiseKind::Ridged => fbm(x, y, period, octaves.max(1), seed, true),
                };
                let g = v.clamp(0.0, 1.0);
                raster.pixels[(py * w + px) as usize] = Color::new(g, g, g, 1.0);
            }
        }
    }

    /// Fill the active layer with a tiling structural pattern as grayscale. `scale`
    /// is the number of pattern repeats across the map.
    pub fn gen_pattern(&mut self, layer: usize, kind: PatternKind, scale: f32) {
        let s = scale.max(1.0);
        let (w, h) = (self.width, self.height);
        let raster = &mut self.layers[layer].raster;
        for py in 0..h {
            for px in 0..w {
                let u = px as f32 / w as f32 * s;
                let v = py as f32 / h as f32 * s;
                let g = pattern_value(kind, u, v).clamp(0.0, 1.0);
                raster.pixels[(py * w + px) as usize] = Color::new(g, g, g, 1.0);
            }
        }
    }

    /// Remap the active layer's grayscale (luma) through a color ramp.
    pub fn gradient_map(&mut self, layer: usize, stops: &[(f32, Color)]) {
        let raster = &mut self.layers[layer].raster;
        for pixel in &mut raster.pixels {
            let t = pixel.luma();
            let mapped = eval_stops(stops, t);
            *pixel = Color {
                a: pixel.a.max(mapped.a),
                ..mapped
            };
        }
    }

    /// Displace the active layer by a per-pixel `field` (a source map's luma,
    /// remapped to `-1..1`), scaled by `amount` pixels — an organic domain warp.
    pub fn warp_by(&mut self, layer: usize, field: &[f32], amount: f32, wrap: WrapMode) {
        let (w, h) = (self.width, self.height);
        let src = self.layers[layer].raster.clone();
        let raster = &mut self.layers[layer].raster;
        for py in 0..h {
            for px in 0..w {
                let i = (py * w + px) as usize;
                // Central-difference the field to get a displacement direction.
                let fx = sample_field(field, w, h, px as i64 + 1, py as i64)
                    - sample_field(field, w, h, px as i64 - 1, py as i64);
                let fy = sample_field(field, w, h, px as i64, py as i64 + 1)
                    - sample_field(field, w, h, px as i64, py as i64 - 1);
                let sx = px as f32 - fx * amount;
                let sy = py as f32 - fy * amount;
                raster.pixels[i] = src.sample(sx, sy, wrap);
            }
        }
    }
}

fn sample_field(field: &[f32], w: u32, h: u32, x: i64, y: i64) -> f32 {
    let xi = x.rem_euclid(w as i64) as u32;
    let yi = y.rem_euclid(h as i64) as u32;
    field[(yi * w + xi) as usize]
}

// ---- Noise bases ---------------------------------------------------------------

fn hash2(ix: i64, iy: i64, period: i64, seed: u64) -> u64 {
    let x = ix.rem_euclid(period.max(1)) as u64;
    let y = iy.rem_euclid(period.max(1)) as u64;
    let mut h = seed ^ x.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    h = h.rotate_left(29) ^ y.wrapping_mul(0xC2B2_AE3D_27D4_EB4F);
    h = h.wrapping_mul(0x1656_67B1_9E37_79F9);
    h ^ (h >> 29)
}

fn gradient(ix: i64, iy: i64, period: i64, seed: u64) -> (f32, f32) {
    let angle = (hash2(ix, iy, period, seed) >> 40) as f32 / ((1u32 << 24) as f32) * std::f32::consts::TAU;
    (angle.cos(), angle.sin())
}

fn fade(t: f32) -> f32 {
    t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
}

/// Tiling Perlin gradient noise in `-1..1`, periodic with `period` cells.
fn perlin(x: f32, y: f32, period: i64, seed: u64) -> f32 {
    let x0 = x.floor() as i64;
    let y0 = y.floor() as i64;
    let fx = x - x0 as f32;
    let fy = y - y0 as f32;
    let dot = |gx: i64, gy: i64, dx: f32, dy: f32| {
        let (gxv, gyv) = gradient(gx, gy, period, seed);
        gxv * dx + gyv * dy
    };
    let n00 = dot(x0, y0, fx, fy);
    let n10 = dot(x0 + 1, y0, fx - 1.0, fy);
    let n01 = dot(x0, y0 + 1, fx, fy - 1.0);
    let n11 = dot(x0 + 1, y0 + 1, fx - 1.0, fy - 1.0);
    let u = fade(fx);
    let v = fade(fy);
    let nx0 = n00 + (n10 - n00) * u;
    let nx1 = n01 + (n11 - n01) * u;
    (nx0 + (nx1 - nx0) * v).clamp(-1.0, 1.0)
}

/// Tiling Worley (cellular) F1 noise in `0..1`.
fn worley(x: f32, y: f32, period: i64, seed: u64) -> f32 {
    let cx = x.floor() as i64;
    let cy = y.floor() as i64;
    let mut best = f32::MAX;
    for dy in -1..=1 {
        for dx in -1..=1 {
            let (gx, gy) = (cx + dx, cy + dy);
            let h = hash2(gx, gy, period, seed);
            let fx = gx as f32 + ((h >> 40) as f32 / ((1u32 << 24) as f32));
            let fy = gy as f32 + (((h >> 16) & 0xFF_FFFF) as f32 / ((1u32 << 24) as f32));
            let d = ((x - fx).powi(2) + (y - fy).powi(2)).sqrt();
            best = best.min(d);
        }
    }
    best.clamp(0.0, 1.0)
}

/// Fractal Brownian motion (or ridged, when `ridged`) summed from tiling octaves.
fn fbm(x: f32, y: f32, period: i64, octaves: u32, seed: u64, ridged: bool) -> f32 {
    let mut sum = 0.0;
    let mut amp = 0.5;
    let mut norm = 0.0;
    for o in 0..octaves {
        let freq = 1 << o;
        let p = period * freq as i64;
        let n = perlin(x * freq as f32, y * freq as f32, p, seed ^ (o as u64 + 1));
        let v = if ridged { 1.0 - n.abs() } else { n * 0.5 + 0.5 };
        sum += v * amp;
        norm += amp;
        amp *= 0.5;
    }
    (sum / norm.max(1e-6)).clamp(0.0, 1.0)
}

// ---- Patterns ------------------------------------------------------------------

fn pattern_value(kind: PatternKind, u: f32, v: f32) -> f32 {
    match kind {
        PatternKind::Checker => {
            let cx = u.floor() as i64;
            let cy = v.floor() as i64;
            if (cx + cy).rem_euclid(2) == 0 { 1.0 } else { 0.0 }
        }
        PatternKind::Bricks => {
            let row = v.floor() as i64;
            // Offset every other course by half a brick (running bond).
            let shift = if row.rem_euclid(2) == 0 { 0.0 } else { 0.5 };
            let bx = (u + shift).fract();
            let by = v.fract();
            let mortar = 0.08;
            if bx < mortar || by < mortar { 0.25 } else { 1.0 }
        }
        PatternKind::Planks => {
            let bx = u.fract();
            let gap = 0.06;
            if bx < gap { 0.3 } else { 0.9 - (u.floor() as i64).rem_euclid(3) as f32 * 0.1 }
        }
        PatternKind::Hex => {
            // Distance to the nearest of two offset hex-lattice centers.
            let row = (v * 1.1547).floor();
            let shift = if (row as i64).rem_euclid(2) == 0 { 0.0 } else { 0.5 };
            let hx = (u + shift).fract() - 0.5;
            let hy = (v * 1.1547).fract() - 0.5;
            let d = (hx * hx + hy * hy).sqrt();
            (1.0 - d * 1.6).clamp(0.0, 1.0)
        }
        PatternKind::Weave => {
            let over = ((u.floor() as i64 + v.floor() as i64).rem_euclid(2)) == 0;
            let strand = if over { u.fract() } else { v.fract() };
            let s = (strand - 0.5).abs() * 2.0;
            (1.0 - s).clamp(0.0, 1.0)
        }
    }
}

#[cfg(test)]
#[path = "proc.test.rs"]
mod tests;
