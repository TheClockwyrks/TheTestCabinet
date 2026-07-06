//! A small RGBA8 drawing surface for the preview PNGs.
//!
//! The audio previews (waveform, spectrogram, piano-roll) are 2D images — there is no
//! 3D render here — so a dependency-light straight-RGBA8 buffer with a handful of
//! primitives (fill, rect, line, per-pixel blend) plus a `png`-crate encode is all
//! the render surface needs. It mirrors the `draw` crate's `ImageBuffer`.

/// An opaque RGB color (previews are always drawn on an opaque background).
pub type Rgb = [u8; 3];

/// A straight-RGBA8 image, row-major, four bytes per pixel.
pub struct Canvas {
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    rgba: Vec<u8>,
}

impl Canvas {
    /// A new canvas flooded with an opaque `fill` color.
    pub fn new(width: u32, height: u32, fill: Rgb) -> Canvas {
        let count = width as usize * height as usize;
        let mut rgba = Vec::with_capacity(count * 4);
        for _ in 0..count {
            rgba.extend_from_slice(&[fill[0], fill[1], fill[2], 255]);
        }
        Canvas {
            width,
            height,
            rgba,
        }
    }

    /// Set a pixel to an opaque color; off-canvas writes are ignored.
    pub fn set(&mut self, x: i64, y: i64, color: Rgb) {
        if x < 0 || y < 0 || x >= self.width as i64 || y >= self.height as i64 {
            return;
        }
        let o = ((y as usize) * self.width as usize + x as usize) * 4;
        self.rgba[o] = color[0];
        self.rgba[o + 1] = color[1];
        self.rgba[o + 2] = color[2];
        self.rgba[o + 3] = 255;
    }

    /// Fill an axis-aligned rectangle (clipped to the canvas).
    pub fn fill_rect(&mut self, x: i64, y: i64, w: i64, h: i64, color: Rgb) {
        for yy in y..y + h {
            for xx in x..x + w {
                self.set(xx, yy, color);
            }
        }
    }

    /// A vertical 1px line from `y0` to `y1` at column `x`.
    pub fn vline(&mut self, x: i64, y0: i64, y1: i64, color: Rgb) {
        let (a, b) = if y0 <= y1 { (y0, y1) } else { (y1, y0) };
        for y in a..=b {
            self.set(x, y, color);
        }
    }

    /// A horizontal 1px line from `x0` to `x1` at row `y`.
    pub fn hline(&mut self, x0: i64, x1: i64, y: i64, color: Rgb) {
        let (a, b) = if x0 <= x1 { (x0, x1) } else { (x1, x0) };
        for x in a..=b {
            self.set(x, y, color);
        }
    }

    /// Encode the canvas as PNG bytes (RGBA, 8-bit).
    pub fn to_png_bytes(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut buf, self.width, self.height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder
                .write_header()
                .expect("writing a PNG header to an in-memory buffer cannot fail");
            writer
                .write_image_data(&self.rgba)
                .expect("writing PNG data to an in-memory buffer cannot fail");
        }
        buf
    }
}
