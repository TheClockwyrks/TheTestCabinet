//! Selections: a per-pixel coverage mask that clips every subsequent paint
//! operation until it is cleared. A rectangle, an ellipse, or a lasso polygon sets
//! it; `invert` flips it; `feather` softens its edge with a box blur; `none` clears
//! it back to "whole document".

use crate::layer::{Document, Selection};

/// Rasterize a polygon (even-odd rule) into a fresh `0..=1` coverage buffer with a
/// touch of edge anti-aliasing via 2×2 supersampling.
fn polygon_coverage(width: u32, height: u32, points: &[(f32, f32)]) -> Vec<f32> {
    let mut cov = vec![0.0f32; width as usize * height as usize];
    if points.len() < 3 {
        return cov;
    }
    for y in 0..height {
        for x in 0..width {
            let mut hits = 0.0;
            for sy in 0..2 {
                for sx in 0..2 {
                    let px = x as f32 + 0.25 + sx as f32 * 0.5;
                    let py = y as f32 + 0.25 + sy as f32 * 0.5;
                    if point_in_polygon(px, py, points) {
                        hits += 0.25;
                    }
                }
            }
            cov[(y * width + x) as usize] = hits;
        }
    }
    cov
}

/// Even-odd point-in-polygon test.
pub fn point_in_polygon(px: f32, py: f32, points: &[(f32, f32)]) -> bool {
    let mut inside = false;
    let n = points.len();
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = points[i];
        let (xj, yj) = points[j];
        if ((yi > py) != (yj > py))
            && (px < (xj - xi) * (py - yi) / (yj - yi + f32::EPSILON) + xi)
        {
            inside = !inside;
        }
        j = i;
    }
    inside
}

impl Document {
    /// Select an axis-aligned rectangle, replacing any existing selection.
    pub fn select_rect(&mut self, x: i64, y: i64, width: u32, height: u32) {
        let mut cov = vec![0.0f32; self.pixel_count()];
        for py in y..y + height as i64 {
            for px in x..x + width as i64 {
                if px >= 0 && py >= 0 && px < self.width as i64 && py < self.height as i64 {
                    cov[(py as u32 * self.width + px as u32) as usize] = 1.0;
                }
            }
        }
        self.selection = Some(Selection { coverage: cov });
    }

    /// Select an axis-aligned ellipse.
    pub fn select_ellipse(&mut self, cx: f32, cy: f32, rx: f32, ry: f32) {
        let (rx, ry) = (rx.max(0.5), ry.max(0.5));
        let mut cov = vec![0.0f32; self.pixel_count()];
        for py in 0..self.height {
            for px in 0..self.width {
                let nx = (px as f32 + 0.5 - cx) / rx;
                let ny = (py as f32 + 0.5 - cy) / ry;
                if nx * nx + ny * ny <= 1.0 {
                    cov[(py * self.width + px) as usize] = 1.0;
                }
            }
        }
        self.selection = Some(Selection { coverage: cov });
    }

    /// Select a freeform polygon (lasso).
    pub fn select_lasso(&mut self, points: &[(f32, f32)]) {
        let cov = polygon_coverage(self.width, self.height, points);
        self.selection = Some(Selection { coverage: cov });
    }

    /// Clear the selection (subsequent operations affect the whole document).
    pub fn select_none(&mut self) {
        self.selection = None;
    }

    /// Invert the active selection; inverting "no selection" selects nothing.
    pub fn invert_selection(&mut self) {
        if let Some(sel) = &mut self.selection {
            for c in &mut sel.coverage {
                *c = 1.0 - *c;
            }
        } else {
            self.selection = Some(Selection {
                coverage: vec![0.0; self.pixel_count()],
            });
        }
    }

    /// Soften the selection edge with a separable box blur of the given radius.
    pub fn feather_selection(&mut self, radius: u32) {
        if radius == 0 {
            return;
        }
        let (w, h) = (self.width, self.height);
        if let Some(sel) = &mut self.selection {
            sel.coverage = box_blur(&sel.coverage, w, h, radius);
        }
    }
}

/// A separable box blur over a single-channel `0..=1` field, edge-clamped.
pub fn box_blur(src: &[f32], width: u32, height: u32, radius: u32) -> Vec<f32> {
    let (w, h) = (width as i64, height as i64);
    let r = radius as i64;
    let idx = |x: i64, y: i64| (y.clamp(0, h - 1) * w + x.clamp(0, w - 1)) as usize;
    let mut tmp = vec![0.0f32; src.len()];
    let norm = (2 * r + 1) as f32;
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

#[cfg(test)]
#[path = "select.test.rs"]
mod tests;
