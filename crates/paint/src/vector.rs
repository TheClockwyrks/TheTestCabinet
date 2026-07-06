//! Crisp, anti-aliased vector shapes for the `ui` binary: rectangle, rounded
//! rectangle, ellipse, line, and polygon, each with an optional fill and a stroked
//! outline. Coverage comes from a signed-distance field (or, for a polygon,
//! supersampled inside-tests plus edge distance), so a shape rasterizes crisply at
//! any size — the structural counterpart to `paint`'s painterly brushwork.

use crate::blend::{BlendMode, composite_over};
use crate::color::Color;
use crate::layer::{Document, Selection};
use crate::raster::WrapMode;
use crate::select::point_in_polygon;

/// The fill and stroke a vector shape is drawn with.
#[derive(Debug, Clone, Copy)]
pub struct ShapeStyle {
    /// The interior fill, if any.
    pub fill: Option<Color>,
    /// The outline color, if any.
    pub stroke: Option<Color>,
    /// The outline width in pixels (centered on the edge).
    pub stroke_width: f32,
}

impl Document {
    /// Deposit a fill/stroke pair over a bounding box using a signed-distance
    /// function `sd` (negative inside the shape).
    fn draw_sdf(
        &mut self,
        layer: usize,
        style: ShapeStyle,
        bbox: (i64, i64, i64, i64),
        wrap: WrapMode,
        sd: impl Fn(f32, f32) -> f32,
    ) {
        let (min_x, min_y, max_x, max_y) = bbox;
        let half = (style.stroke_width * 0.5).max(0.0);
        let w = self.width as i64;
        let h = self.height as i64;
        let Document {
            layers, selection, ..
        } = self;
        let sel: Option<&Selection> = selection.as_ref();
        let raster = &mut layers[layer].raster;
        for py in min_y..=max_y {
            for px in min_x..=max_x {
                let Some(i) = raster.index(px, py, wrap) else {
                    continue;
                };
                if wrap == WrapMode::Clamp && (px < 0 || py < 0 || px >= w || py >= h) {
                    continue;
                }
                let d = sd(px as f32 + 0.5, py as f32 + 0.5);
                let s = sel.map(|sel| sel.coverage[i]).unwrap_or(1.0);
                if let Some(fill) = style.fill {
                    let cov = (0.5 - d).clamp(0.0, 1.0);
                    if cov > 0.0 {
                        raster.pixels[i] = composite_over(
                            raster.pixels[i],
                            fill,
                            BlendMode::Normal,
                            cov * fill.a * s,
                        );
                    }
                }
                if let Some(stroke) = style.stroke.filter(|_| style.stroke_width > 0.0) {
                    let cov = (0.5 - (d.abs() - half)).clamp(0.0, 1.0);
                    if cov > 0.0 {
                        raster.pixels[i] = composite_over(
                            raster.pixels[i],
                            stroke,
                            BlendMode::Normal,
                            cov * stroke.a * s,
                        );
                    }
                }
            }
        }
    }

    /// An axis-aligned rectangle with top-left `(x, y)`.
    #[allow(clippy::too_many_arguments)]
    pub fn shape_rect(
        &mut self,
        layer: usize,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
        style: ShapeStyle,
        wrap: WrapMode,
    ) {
        self.shape_rounded_rect(layer, x, y, width, height, 0.0, style, wrap);
    }

    /// A rounded rectangle with corner radius `r`.
    #[allow(clippy::too_many_arguments)]
    pub fn shape_rounded_rect(
        &mut self,
        layer: usize,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
        r: f32,
        style: ShapeStyle,
        wrap: WrapMode,
    ) {
        let (cx, cy) = (x + width * 0.5, y + height * 0.5);
        let (hx, hy) = (width * 0.5, height * 0.5);
        let r = r.clamp(0.0, hx.min(hy));
        let pad = style.stroke_width.ceil() as i64 + 1;
        let bbox = (
            x.floor() as i64 - pad,
            y.floor() as i64 - pad,
            (x + width).ceil() as i64 + pad,
            (y + height).ceil() as i64 + pad,
        );
        self.draw_sdf(layer, style, bbox, wrap, move |px, py| {
            // Signed distance to a rounded box.
            let qx = (px - cx).abs() - (hx - r);
            let qy = (py - cy).abs() - (hy - r);
            let ox = qx.max(0.0);
            let oy = qy.max(0.0);
            (ox * ox + oy * oy).sqrt() + qx.max(qy).min(0.0) - r
        });
    }

    /// An ellipse centered at `(cx, cy)` with radii `(rx, ry)`.
    #[allow(clippy::too_many_arguments)]
    pub fn shape_ellipse(
        &mut self,
        layer: usize,
        cx: f32,
        cy: f32,
        rx: f32,
        ry: f32,
        style: ShapeStyle,
        wrap: WrapMode,
    ) {
        let (rx, ry) = (rx.max(0.5), ry.max(0.5));
        let pad = style.stroke_width.ceil() as i64 + 2;
        let bbox = (
            (cx - rx).floor() as i64 - pad,
            (cy - ry).floor() as i64 - pad,
            (cx + rx).ceil() as i64 + pad,
            (cy + ry).ceil() as i64 + pad,
        );
        self.draw_sdf(layer, style, bbox, wrap, move |px, py| {
            // Approximate ellipse SDF: scale into unit space, correct by the local
            // radius so the distance reads in pixels.
            let nx = (px - cx) / rx;
            let ny = (py - cy) / ry;
            let k = (nx * nx + ny * ny).sqrt();
            (k - 1.0) * rx.min(ry)
        });
    }

    /// A straight line (a stroked segment) between two points.
    #[allow(clippy::too_many_arguments)]
    pub fn shape_line(
        &mut self,
        layer: usize,
        x0: f32,
        y0: f32,
        x1: f32,
        y1: f32,
        color: Color,
        width: f32,
        wrap: WrapMode,
    ) {
        let style = ShapeStyle {
            fill: None,
            stroke: Some(color),
            stroke_width: width.max(1.0),
        };
        let pad = width.ceil() as i64 + 2;
        let bbox = (
            x0.min(x1).floor() as i64 - pad,
            y0.min(y1).floor() as i64 - pad,
            x0.max(x1).ceil() as i64 + pad,
            y0.max(y1).ceil() as i64 + pad,
        );
        self.draw_sdf(layer, style, bbox, wrap, move |px, py| {
            segment_distance(px, py, x0, y0, x1, y1)
        });
    }

    /// A closed polygon with an optional fill and stroked edges.
    pub fn shape_polygon(
        &mut self,
        layer: usize,
        points: &[(f32, f32)],
        style: ShapeStyle,
        wrap: WrapMode,
    ) {
        if points.len() < 2 {
            return;
        }
        let min_x = points.iter().map(|p| p.0).fold(f32::MAX, f32::min);
        let min_y = points.iter().map(|p| p.1).fold(f32::MAX, f32::min);
        let max_x = points.iter().map(|p| p.0).fold(f32::MIN, f32::max);
        let max_y = points.iter().map(|p| p.1).fold(f32::MIN, f32::max);
        let pad = style.stroke_width.ceil() as i64 + 2;
        let bbox = (
            min_x.floor() as i64 - pad,
            min_y.floor() as i64 - pad,
            max_x.ceil() as i64 + pad,
            max_y.ceil() as i64 + pad,
        );
        let pts = points.to_vec();
        self.draw_sdf(layer, style, bbox, wrap, move |px, py| {
            // Signed distance: unsigned edge distance, negated when inside.
            let mut best = f32::MAX;
            for i in 0..pts.len() {
                let a = pts[i];
                let b = pts[(i + 1) % pts.len()];
                best = best.min(segment_distance(px, py, a.0, a.1, b.0, b.1));
            }
            if point_in_polygon(px, py, &pts) {
                -best
            } else {
                best
            }
        });
    }
}

/// The distance from `(px, py)` to the line segment `(x0,y0)–(x1,y1)`.
fn segment_distance(px: f32, py: f32, x0: f32, y0: f32, x1: f32, y1: f32) -> f32 {
    let (dx, dy) = (x1 - x0, y1 - y0);
    let len2 = dx * dx + dy * dy;
    let t = if len2 <= f32::EPSILON {
        0.0
    } else {
        (((px - x0) * dx + (py - y0) * dy) / len2).clamp(0.0, 1.0)
    };
    let cx = x0 + dx * t;
    let cy = y0 + dy * t;
    ((px - cx).powi(2) + (py - cy).powi(2)).sqrt()
}

#[cfg(test)]
#[path = "vector.test.rs"]
mod tests;
