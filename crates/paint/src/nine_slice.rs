//! Nine-slice insets: the fixed border margins of a UI element that stay unscaled
//! while its center and edges stretch, so a game can resize one authored panel or
//! button to any size without distorting its corners. The insets travel in
//! `ui.json`; [`stretch`] renders the on-request `nine-slice-preview` a model uses
//! to confirm the insets hold before finishing.

use serde::{Deserialize, Serialize};

use crate::color::Color;
use crate::raster::{Raster, WrapMode};
use crate::transform::resize_nearest;

/// The four stretchable insets, in pixels from each edge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct NineSlice {
    /// Fixed margin from the left edge.
    pub left: u32,
    /// Fixed margin from the right edge.
    pub right: u32,
    /// Fixed margin from the top edge.
    pub top: u32,
    /// Fixed margin from the bottom edge.
    pub bottom: u32,
}

impl NineSlice {
    /// Whether the insets fit within an element of `width`×`height` (opposite
    /// margins must not overlap) — the check the validator also applies.
    pub fn fits(&self, width: u32, height: u32) -> bool {
        self.left + self.right < width && self.top + self.bottom < height
    }
}

/// Stretch a source element to `(out_w, out_h)` honoring `ns`: the four corners
/// stay pixel-fixed, the four edges stretch along one axis, and the center stretches
/// on both. A degenerate target (smaller than the fixed margins) falls back to a
/// plain nearest-neighbor resize.
pub fn stretch(src: &Raster, ns: NineSlice, out_w: u32, out_h: u32) -> Raster {
    if out_w == 0 || out_h == 0 {
        return Raster::filled(out_w.max(1), out_h.max(1), Color::TRANSPARENT);
    }
    let (sw, sh) = (src.width, src.height);
    if !ns.fits(sw, sh) || ns.left + ns.right >= out_w || ns.top + ns.bottom >= out_h {
        return resize_nearest(src, out_w, out_h);
    }
    let mut out = Raster::filled(out_w, out_h, Color::TRANSPARENT);
    // Source and destination column/row band boundaries.
    let sx = [0, ns.left, sw - ns.right, sw];
    let sy = [0, ns.top, sh - ns.bottom, sh];
    let dx = [0, ns.left, out_w - ns.right, out_w];
    let dy = [0, ns.top, out_h - ns.bottom, out_h];
    for by in 0..3 {
        for bx in 0..3 {
            let src_band = crop(src, sx[bx], sy[by], sx[bx + 1] - sx[bx], sy[by + 1] - sy[by]);
            let dw = dx[bx + 1] - dx[bx];
            let dh = dy[by + 1] - dy[by];
            let resized = resize_nearest(&src_band, dw, dh);
            blit(&mut out, &resized, dx[bx], dy[by]);
        }
    }
    out
}

/// Copy a sub-rectangle of a raster into a new raster.
fn crop(src: &Raster, x: u32, y: u32, w: u32, h: u32) -> Raster {
    let mut out = Raster::filled(w.max(1), h.max(1), Color::TRANSPARENT);
    for oy in 0..h {
        for ox in 0..w {
            out.pixels[(oy * w + ox) as usize] =
                src.get_or_transparent((x + ox) as i64, (y + oy) as i64, WrapMode::Clamp);
        }
    }
    out
}

/// Blit `patch` onto `dst` with its top-left at `(x, y)` (opaque copy).
fn blit(dst: &mut Raster, patch: &Raster, x: u32, y: u32) {
    for py in 0..patch.height {
        for px in 0..patch.width {
            let (dx, dy) = (x + px, y + py);
            if dx < dst.width && dy < dst.height {
                dst.pixels[(dy * dst.width + dx) as usize] =
                    patch.pixels[(py * patch.width + px) as usize];
            }
        }
    }
}

#[cfg(test)]
#[path = "nine_slice.test.rs"]
mod tests;
