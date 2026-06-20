//! The drawing operations and how each one rasterizes onto the canvas.
//!
//! [`Operation`] is the wire form recorded in `actions.json`: an internally
//! tagged enum (`{ "op": "fill_rect", … }`) mirroring the `CheckAction`
//! convention in `crates/core`. Every operation is **total** — out-of-bounds
//! writes are clipped, never panics — so regenerating an image from an arbitrary
//! (even hostile) log can always run to completion.

use serde::{Deserialize, Serialize};

use crate::ImageBuffer;
use crate::color::Rgba;

/// A single drawing operation the model issues through the `draw` binary.
///
/// Coordinates are signed so a shape may be placed partially off-canvas (the
/// off-canvas portion is clipped); sizes and radii are unsigned. Operations
/// **replace** the pixels they touch rather than alpha-compositing, keeping
/// regeneration an exact, order-only function of the log.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "cli", derive(schemars::JsonSchema))]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Operation {
    /// Flood the entire canvas with one color, discarding everything drawn so
    /// far. Useful as a first call to lay down a base.
    FillBackground {
        /// The fill color.
        color: Rgba,
    },
    /// Set a single pixel.
    SetPixel {
        /// Column (0 at the left).
        x: i64,
        /// Row (0 at the top).
        y: i64,
        /// The pixel color.
        color: Rgba,
    },
    /// Fill an axis-aligned rectangle. `(x, y)` is the top-left corner.
    FillRect {
        /// Left edge column.
        x: i64,
        /// Top edge row.
        y: i64,
        /// Width in pixels.
        width: u32,
        /// Height in pixels.
        height: u32,
        /// The fill color.
        color: Rgba,
    },
    /// Draw the 1px outline of an axis-aligned rectangle.
    StrokeRect {
        /// Left edge column.
        x: i64,
        /// Top edge row.
        y: i64,
        /// Width in pixels.
        width: u32,
        /// Height in pixels.
        height: u32,
        /// The outline color.
        color: Rgba,
    },
    /// Draw a 1px line between two points (inclusive of both endpoints).
    Line {
        /// Start column.
        x0: i64,
        /// Start row.
        y0: i64,
        /// End column.
        x1: i64,
        /// End row.
        y1: i64,
        /// The line color.
        color: Rgba,
    },
    /// Fill a disc centered at `(cx, cy)` with radius `r`.
    FillCircle {
        /// Center column.
        cx: i64,
        /// Center row.
        cy: i64,
        /// Radius in pixels.
        r: u32,
        /// The fill color.
        color: Rgba,
    },
    /// Draw the 1px outline of a circle centered at `(cx, cy)` with radius `r`.
    StrokeCircle {
        /// Center column.
        cx: i64,
        /// Center row.
        cy: i64,
        /// Radius in pixels.
        r: u32,
        /// The outline color.
        color: Rgba,
    },
    /// Replace the contiguous, 4-connected region of pixels sharing the start
    /// pixel's current color with a new color. No-op if the start is off-canvas
    /// or already the target color.
    FloodFill {
        /// Seed column.
        x: i64,
        /// Seed row.
        y: i64,
        /// The replacement color.
        color: Rgba,
    },
    /// Mirror the columns left of `axis_x` onto the columns to its right,
    /// reflecting across the vertical line between column `axis_x - 1` and column
    /// `axis_x`. The single highest-leverage op for a left/right-symmetric sprite.
    MirrorHorizontal {
        /// The mirror axis: columns `0..axis_x` are copied onto `axis_x..`.
        axis_x: u32,
    },
}

impl Operation {
    /// Apply this operation to the image in place. Always succeeds: anything that
    /// would fall outside the canvas is clipped.
    pub fn apply(&self, image: &mut ImageBuffer) {
        match *self {
            Operation::FillBackground { color } => {
                for y in 0..image.height as i64 {
                    for x in 0..image.width as i64 {
                        image.set(x, y, color);
                    }
                }
            }
            Operation::SetPixel { x, y, color } => image.set(x, y, color),
            Operation::FillRect {
                x,
                y,
                width,
                height,
                color,
            } => {
                for dy in 0..height as i64 {
                    for dx in 0..width as i64 {
                        image.set(x + dx, y + dy, color);
                    }
                }
            }
            Operation::StrokeRect {
                x,
                y,
                width,
                height,
                color,
            } => {
                if width == 0 || height == 0 {
                    return;
                }
                let (w, h) = (width as i64, height as i64);
                for dx in 0..w {
                    image.set(x + dx, y, color);
                    image.set(x + dx, y + h - 1, color);
                }
                for dy in 0..h {
                    image.set(x, y + dy, color);
                    image.set(x + w - 1, y + dy, color);
                }
            }
            Operation::Line {
                x0,
                y0,
                x1,
                y1,
                color,
            } => draw_line(image, x0, y0, x1, y1, color),
            Operation::FillCircle { cx, cy, r, color } => {
                let r = r as i64;
                for dy in -r..=r {
                    for dx in -r..=r {
                        if dx * dx + dy * dy <= r * r {
                            image.set(cx + dx, cy + dy, color);
                        }
                    }
                }
            }
            Operation::StrokeCircle { cx, cy, r, color } => {
                if r == 0 {
                    image.set(cx, cy, color);
                    return;
                }
                let r = r as i64;
                let inner = (r - 1) * (r - 1);
                let outer = r * r;
                for dy in -r..=r {
                    for dx in -r..=r {
                        let d2 = dx * dx + dy * dy;
                        if d2 <= outer && d2 > inner {
                            image.set(cx + dx, cy + dy, color);
                        }
                    }
                }
            }
            Operation::FloodFill { x, y, color } => flood_fill(image, x, y, color),
            Operation::MirrorHorizontal { axis_x } => {
                let axis = axis_x as i64;
                for x in 0..axis {
                    let mirrored = 2 * axis - 1 - x;
                    for y in 0..image.height as i64 {
                        if let Some(src) = image.get(x, y) {
                            image.set(mirrored, y, src);
                        }
                    }
                }
            }
        }
    }
}

/// Bresenham's line algorithm between two inclusive endpoints.
fn draw_line(image: &mut ImageBuffer, x0: i64, y0: i64, x1: i64, y1: i64, color: Rgba) {
    let dx = (x1 - x0).abs();
    let dy = -(y1 - y0).abs();
    let sx = if x0 < x1 { 1 } else { -1 };
    let sy = if y0 < y1 { 1 } else { -1 };
    let mut err = dx + dy;
    let (mut x, mut y) = (x0, y0);
    loop {
        image.set(x, y, color);
        if x == x1 && y == y1 {
            break;
        }
        let e2 = 2 * err;
        if e2 >= dy {
            err += dy;
            x += sx;
        }
        if e2 <= dx {
            err += dx;
            y += sy;
        }
    }
}

/// 4-connected flood fill bounded by the canvas. Replaces the contiguous region
/// of pixels equal to the seed's current color with `color`. Terminates: the
/// frontier never revisits a pixel because each filled pixel no longer matches
/// the original color, and a seed already equal to `color` is a no-op.
fn flood_fill(image: &mut ImageBuffer, x: i64, y: i64, color: Rgba) {
    let Some(target) = image.get(x, y) else {
        return;
    };
    if target == color {
        return;
    }
    let mut stack = vec![(x, y)];
    while let Some((px, py)) = stack.pop() {
        match image.get(px, py) {
            Some(current) if current == target => image.set(px, py, color),
            _ => continue,
        }
        stack.push((px + 1, py));
        stack.push((px - 1, py));
        stack.push((px, py + 1));
        stack.push((px, py - 1));
    }
}
