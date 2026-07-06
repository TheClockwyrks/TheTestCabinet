//! The core raster primitives: brush stamps and strokes, fills, the flood bucket,
//! rectangle/ellipse fills, and gradients. Every one deposits onto a chosen layer
//! (or its mask), clipped by the document's active selection, and honors the
//! workspace wrap mode so a **material** map's marks tile toroidally while a **UI**
//! element's clip at its bounds.

use crate::blend::{BlendMode, composite_over};
use crate::color::Color;
use crate::layer::{Document, Layer, Selection};
use crate::raster::{Raster, WrapMode, lerp_color};
use crate::rng::Rng;

/// The four brush profiles a stamp can take.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BrushKind {
    /// A soft round falloff governed by `hardness`.
    RoundSoft,
    /// A crisp round disc with a 1px anti-aliased edge.
    RoundHard,
    /// A very soft, low-density spray.
    Airbrush,
    /// A soft round brush whose density is broken up by seeded noise.
    Textured,
}

impl BrushKind {
    /// The per-brush stamp parameters as a single struct is overkill; this maps a
    /// normalized distance `t = dist / radius` (`0` at center, `1` at the rim) and
    /// the brush `hardness` to a coverage in `0..=1`.
    fn profile(self, t: f32, hardness: f32) -> f32 {
        if t >= 1.0 {
            return 0.0;
        }
        match self {
            BrushKind::RoundHard => {
                // Solid to the rim, one ramp-width of anti-aliasing at the edge.
                ((1.0 - t) / 0.06).clamp(0.0, 1.0)
            }
            BrushKind::RoundSoft | BrushKind::Textured => {
                let inner = hardness.clamp(0.0, 0.99);
                if t <= inner {
                    1.0
                } else {
                    let k = (t - inner) / (1.0 - inner);
                    smoothstep(1.0 - k)
                }
            }
            BrushKind::Airbrush => {
                // A gaussian-like bell, always soft.
                let x = t * 2.2;
                (-x * x).exp()
            }
        }
    }
}

fn smoothstep(x: f32) -> f32 {
    let x = x.clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}

/// The parameters shared by a brush stamp and every stamp along a stroke.
#[derive(Debug, Clone)]
pub struct Brush {
    /// The profile shape.
    pub kind: BrushKind,
    /// Diameter in pixels.
    pub size: f32,
    /// Edge hardness, `0..=1`.
    pub hardness: f32,
    /// Per-stamp density, `0..=1`.
    pub flow: f32,
    /// Overall coverage cap, `0..=1`.
    pub opacity: f32,
    /// The paint color.
    pub color: Color,
}

/// Deposit `color` at pixel index `i` with effective coverage `alpha`, either into
/// the layer's pixels (source-over within the layer) or into its grayscale mask.
fn deposit(layer: &mut Layer, into_mask: bool, i: usize, color: Color, alpha: f32) {
    if alpha <= 0.0 {
        return;
    }
    if into_mask {
        let len = layer.raster.pixels.len();
        let mask = layer.mask.get_or_insert_with(|| vec![0.0; len]);
        // Grayscale paint: white (luma 1) reveals, black hides.
        mask[i] = mask[i] * (1.0 - alpha) + color.luma() * alpha;
    } else {
        layer.raster.pixels[i] = composite_over(layer.raster.pixels[i], color, BlendMode::Normal, alpha);
    }
}

fn sel_cov(sel: Option<&Selection>, i: usize) -> f32 {
    sel.map(|s| s.coverage[i]).unwrap_or(1.0)
}

impl Document {
    /// The mutable pieces a paint primitive needs, borrowed disjointly so a
    /// primitive can read the selection while writing the target layer.
    fn parts(&mut self, layer: usize) -> (i64, i64, &mut Layer, Option<&Selection>) {
        let w = self.width as i64;
        let h = self.height as i64;
        let Document {
            layers, selection, ..
        } = self;
        (w, h, &mut layers[layer], selection.as_ref())
    }

    /// Stamp a single brush dab centered at `(cx, cy)`.
    #[allow(clippy::too_many_arguments)]
    pub fn brush_stamp(
        &mut self,
        layer: usize,
        into_mask: bool,
        brush: &Brush,
        cx: f32,
        cy: f32,
        wrap: WrapMode,
        rng: &mut Rng,
    ) {
        let radius = (brush.size * 0.5).max(0.5);
        let (_, _, layer_ref, sel) = self.parts(layer);
        let min_x = (cx - radius).floor() as i64;
        let max_x = (cx + radius).ceil() as i64;
        let min_y = (cy - radius).floor() as i64;
        let max_y = (cy + radius).ceil() as i64;
        for py in min_y..=max_y {
            for px in min_x..=max_x {
                let Some(i) = layer_ref.raster.index(px, py, wrap) else {
                    continue;
                };
                let dx = px as f32 + 0.5 - cx;
                let dy = py as f32 + 0.5 - cy;
                let t = (dx * dx + dy * dy).sqrt() / radius;
                let mut cov = brush.kind.profile(t, brush.hardness);
                if matches!(brush.kind, BrushKind::Textured) {
                    // Break up density with a stable per-pixel noise value.
                    let n = value_noise(px, py, rng_seed_of(rng));
                    cov *= 0.35 + 0.65 * n;
                }
                let alpha = cov * brush.flow * brush.opacity * sel_cov(sel, i);
                deposit(layer_ref, into_mask, i, brush.color, alpha);
            }
        }
    }

    /// Draw a smoothed polyline as a chain of brush stamps at `spacing * size`
    /// intervals, with seeded `scatter` (perpendicular jitter of the stamp center)
    /// and `jitter` (per-stamp size wobble).
    #[allow(clippy::too_many_arguments)]
    pub fn brush_stroke(
        &mut self,
        layer: usize,
        into_mask: bool,
        brush: &Brush,
        points: &[(f32, f32)],
        spacing: f32,
        scatter: f32,
        jitter: f32,
        wrap: WrapMode,
        rng: &mut Rng,
    ) {
        if points.is_empty() {
            return;
        }
        if points.len() == 1 {
            self.brush_stamp(layer, into_mask, brush, points[0].0, points[0].1, wrap, rng);
            return;
        }
        let step = (spacing.max(0.01) * brush.size).max(0.5);
        let mut carry = 0.0f32;
        for pair in points.windows(2) {
            let (ax, ay) = pair[0];
            let (bx, by) = pair[1];
            let seg = ((bx - ax).powi(2) + (by - ay).powi(2)).sqrt();
            if seg <= f32::EPSILON {
                continue;
            }
            let (nx, ny) = ((bx - ax) / seg, (by - ay) / seg);
            // The unit normal, for scatter displacement.
            let (perp_x, perp_y) = (-ny, nx);
            let mut d = carry;
            while d <= seg {
                let t = d / seg;
                let mut px = ax + (bx - ax) * t;
                let mut py = ay + (by - ay) * t;
                if scatter > 0.0 {
                    let off = rng.next_signed() * scatter * brush.size;
                    px += perp_x * off;
                    py += perp_y * off;
                }
                let mut dab = brush.clone();
                if jitter > 0.0 {
                    dab.size *= 1.0 + rng.next_signed() * jitter;
                    dab.size = dab.size.max(0.5);
                }
                self.brush_stamp(layer, into_mask, &dab, px, py, wrap, rng);
                d += step;
            }
            carry = d - seg;
        }
    }

    /// Fill the whole layer (or the active selection) with `color`, source-over.
    pub fn fill_layer(&mut self, layer: usize, into_mask: bool, color: Color) {
        let count = self.pixel_count();
        let (_, _, layer_ref, sel) = self.parts(layer);
        for i in 0..count {
            deposit(layer_ref, into_mask, i, color, color.a * sel_cov(sel, i));
        }
    }

    /// Fill an axis-aligned rectangle. `(x, y)` is the top-left corner.
    #[allow(clippy::too_many_arguments)]
    pub fn fill_rect(
        &mut self,
        layer: usize,
        into_mask: bool,
        x: i64,
        y: i64,
        width: u32,
        height: u32,
        color: Color,
        wrap: WrapMode,
    ) {
        let (_, _, layer_ref, sel) = self.parts(layer);
        for py in y..y + height as i64 {
            for px in x..x + width as i64 {
                if let Some(i) = layer_ref.raster.index(px, py, wrap) {
                    deposit(layer_ref, into_mask, i, color, color.a * sel_cov(sel, i));
                }
            }
        }
    }

    /// Fill an axis-aligned ellipse centered at `(cx, cy)` with radii `(rx, ry)`,
    /// with a 1px anti-aliased rim.
    #[allow(clippy::too_many_arguments)]
    pub fn fill_ellipse(
        &mut self,
        layer: usize,
        into_mask: bool,
        cx: f32,
        cy: f32,
        rx: f32,
        ry: f32,
        color: Color,
        wrap: WrapMode,
    ) {
        let (rx, ry) = (rx.max(0.5), ry.max(0.5));
        let (_, _, layer_ref, sel) = self.parts(layer);
        let min_x = (cx - rx - 1.0).floor() as i64;
        let max_x = (cx + rx + 1.0).ceil() as i64;
        let min_y = (cy - ry - 1.0).floor() as i64;
        let max_y = (cy + ry + 1.0).ceil() as i64;
        for py in min_y..=max_y {
            for px in min_x..=max_x {
                let Some(i) = layer_ref.raster.index(px, py, wrap) else {
                    continue;
                };
                let nx = (px as f32 + 0.5 - cx) / rx;
                let ny = (py as f32 + 0.5 - cy) / ry;
                let d = (nx * nx + ny * ny).sqrt();
                // Approximate 1px AA using the local gradient scale.
                let scale = rx.min(ry).max(1.0);
                let cov = ((1.0 - d) * scale).clamp(0.0, 1.0);
                deposit(layer_ref, into_mask, i, color, color.a * cov * sel_cov(sel, i));
            }
        }
    }

    /// A linear or radial gradient between color stops, from `from` to `to`.
    #[allow(clippy::too_many_arguments)]
    pub fn gradient(
        &mut self,
        layer: usize,
        into_mask: bool,
        radial: bool,
        stops: &[(f32, Color)],
        from: (f32, f32),
        to: (f32, f32),
    ) {
        if stops.is_empty() {
            return;
        }
        let w = self.width;
        let count = self.pixel_count();
        let (fx, fy) = from;
        let (tx, ty) = to;
        let axis = (tx - fx, ty - fy);
        let axis_len2 = (axis.0 * axis.0 + axis.1 * axis.1).max(1e-6);
        let axis_len = axis_len2.sqrt();
        let (_, _, layer_ref, sel) = self.parts(layer);
        for i in 0..count {
            let px = (i as u32 % w) as f32 + 0.5;
            let py = (i as u32 / w) as f32 + 0.5;
            let t = if radial {
                (((px - fx).powi(2) + (py - fy).powi(2)).sqrt() / axis_len).clamp(0.0, 1.0)
            } else {
                (((px - fx) * axis.0 + (py - fy) * axis.1) / axis_len2).clamp(0.0, 1.0)
            };
            let color = eval_stops(stops, t);
            deposit(layer_ref, into_mask, i, color, color.a * sel_cov(sel, i));
        }
    }

    /// Flood-fill the contiguous region of the active layer whose color is within
    /// `tolerance` of the seed pixel's, replacing it with `color`.
    #[allow(clippy::too_many_arguments)]
    pub fn bucket(
        &mut self,
        layer: usize,
        seed_x: i64,
        seed_y: i64,
        color: Color,
        tolerance: f32,
        wrap: WrapMode,
    ) {
        let w = self.width as i64;
        let h = self.height as i64;
        let (_, _, layer_ref, sel) = self.parts(layer);
        let raster = &layer_ref.raster;
        let Some(seed_idx) = raster.index(seed_x, seed_y, wrap) else {
            return;
        };
        let target = raster.pixels[seed_idx];
        let mut visited = vec![false; raster.pixels.len()];
        let mut stack = vec![(seed_x.rem_euclid(w), seed_y.rem_euclid(h))];
        let mut hits = Vec::new();
        while let Some((x, y)) = stack.pop() {
            let Some(i) = raster.index(x, y, wrap) else {
                continue;
            };
            if visited[i] {
                continue;
            }
            visited[i] = true;
            if color_dist(raster.pixels[i], target) > tolerance {
                continue;
            }
            hits.push(i);
            for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let (nx, ny) = (x + dx, y + dy);
                if wrap == WrapMode::Clamp && (nx < 0 || ny < 0 || nx >= w || ny >= h) {
                    continue;
                }
                stack.push((nx, ny));
            }
        }
        for i in hits {
            deposit(layer_ref, false, i, color, color.a * sel_cov(sel, i));
        }
    }
}

/// Interpolate a color from sorted-by-position `stops` at parameter `t`.
pub fn eval_stops(stops: &[(f32, Color)], t: f32) -> Color {
    if stops.is_empty() {
        return Color::TRANSPARENT;
    }
    if t <= stops[0].0 {
        return stops[0].1;
    }
    let last = stops.len() - 1;
    if t >= stops[last].0 {
        return stops[last].1;
    }
    for pair in stops.windows(2) {
        let (p0, c0) = pair[0];
        let (p1, c1) = pair[1];
        if t >= p0 && t <= p1 {
            let span = (p1 - p0).max(1e-6);
            return lerp_color(c0, c1, (t - p0) / span);
        }
    }
    stops[last].1
}

/// The Euclidean distance between two colors' straight RGBA channels, `0..=2`.
fn color_dist(a: Color, b: Color) -> f32 {
    ((a.r - b.r).powi(2) + (a.g - b.g).powi(2) + (a.b - b.b).powi(2) + (a.a - b.a).powi(2)).sqrt()
}

/// A stable 0..1 hash-noise value for a pixel, for the textured brush.
fn value_noise(x: i64, y: i64, seed: u64) -> f32 {
    let mut h = seed;
    h ^= (x as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    h = h.rotate_left(27);
    h ^= (y as u64).wrapping_mul(0xC2B2_AE3D_27D4_EB4F);
    h = h.wrapping_mul(0x1656_67B1_9E37_79F9);
    ((h >> 40) as f32) / ((1u32 << 24) as f32)
}

/// Peek a stable seed from an RNG without disturbing its stream position for the
/// caller's next real draw (used only to salt the textured brush's per-pixel hash).
fn rng_seed_of(rng: &mut Rng) -> u64 {
    let mut clone = *rng;
    clone.next_u64()
}

/// A helper for callers that need a blank same-size raster (e.g. effects buffers).
pub fn blank_like(raster: &Raster) -> Raster {
    Raster::filled(raster.width, raster.height, Color::TRANSPARENT)
}

#[cfg(test)]
#[path = "paint_core.test.rs"]
mod tests;
