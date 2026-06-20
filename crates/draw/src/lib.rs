//! The drawing tool for asset-generation test cases.
//!
//! See `apps/docs/src/content/docs/testing/asset-generation/`. The model draws a
//! sprite by issuing [`Operation`]s through the `draw` binary; the recorded list
//! of operations — not the pixels left on disk — is the authoritative output of a
//! run. [`render`] turns that list back into an image, and it is the **one**
//! drawing implementation: the binary calls it to re-render the preview after
//! every operation, and `crates/core` calls it to regenerate the scored image
//! from the recorded log. Because both go through the same code, an image
//! produced by any other means cannot match the regeneration — which is what
//! makes the constrained drawing channel enforceable.

use std::path::Path;

pub mod color;
pub mod ops;

pub use color::{Background, ColorError, Rgba};
pub use ops::Operation;

/// The fixed image the model draws on: its dimensions and initial background.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Canvas {
    /// Canvas width in pixels.
    pub width: u32,
    /// Canvas height in pixels.
    pub height: u32,
    /// The state every pixel starts in before any operation runs.
    pub background: Background,
}

/// An in-memory straight-RGBA8 image: `width * height * 4` bytes, row-major.
///
/// This is the working surface every [`Operation`] mutates and the thing
/// [`encode_png`](Self::encode_png) writes out. It is a deliberately small,
/// dependency-light buffer rather than a general image type so the drawing logic
/// stays trivial to reason about and identical between the binary and core.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageBuffer {
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// Row-major RGBA bytes, four per pixel.
    pub rgba: Vec<u8>,
}

impl ImageBuffer {
    /// A new image with every pixel set to `fill`.
    pub fn filled(width: u32, height: u32, fill: Rgba) -> ImageBuffer {
        let count = width as usize * height as usize;
        let mut rgba = Vec::with_capacity(count * 4);
        for _ in 0..count {
            rgba.extend_from_slice(&fill.0);
        }
        ImageBuffer {
            width,
            height,
            rgba,
        }
    }

    /// The byte offset of pixel `(x, y)`, or `None` if it lies off-canvas.
    fn offset(&self, x: i64, y: i64) -> Option<usize> {
        if x < 0 || y < 0 || x >= self.width as i64 || y >= self.height as i64 {
            return None;
        }
        Some(((y as usize) * self.width as usize + x as usize) * 4)
    }

    /// The color at `(x, y)`, or `None` if it lies off-canvas.
    pub fn get(&self, x: i64, y: i64) -> Option<Rgba> {
        let offset = self.offset(x, y)?;
        Some(Rgba([
            self.rgba[offset],
            self.rgba[offset + 1],
            self.rgba[offset + 2],
            self.rgba[offset + 3],
        ]))
    }

    /// Set the pixel at `(x, y)`, replacing it. Off-canvas writes are ignored.
    pub fn set(&mut self, x: i64, y: i64, color: Rgba) {
        if let Some(offset) = self.offset(x, y) {
            self.rgba[offset..offset + 4].copy_from_slice(&color.0);
        }
    }

    /// Encode the image as PNG bytes (RGBA, 8-bit).
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

    /// Encode the image and write it to `path`.
    pub fn encode_png(&self, path: &Path) -> std::io::Result<()> {
        std::fs::write(path, self.to_png_bytes())
    }
}

/// Render an operation log into an image: start from the canvas background and
/// apply each operation in order. This is the authoritative drawing logic shared
/// by the `draw` binary's preview and core's post-run regeneration.
pub fn render(canvas: &Canvas, operations: &[Operation]) -> ImageBuffer {
    let mut image = ImageBuffer::filled(canvas.width, canvas.height, canvas.background.fill());
    for operation in operations {
        operation.apply(&mut image);
    }
    image
}

/// The JSON Schema describing the operation set, as a pretty-printed string.
///
/// Emitted by `draw schema` and seeded verbatim as each asset-generation case's
/// `[tool].operations` contract. Generated from [`Operation`] via `schemars`, so
/// it cannot drift from the actual operations the binary accepts.
#[cfg(feature = "cli")]
pub fn operations_schema() -> serde_json::Value {
    let schema = schemars::schema_for!(Operation);
    serde_json::to_value(schema).expect("the operations schema serializes to JSON")
}

/// The operations schema as the canonical pretty-printed string that is seeded
/// into test cases and compared against in tests.
#[cfg(feature = "cli")]
pub fn operations_schema_string() -> String {
    let mut text = serde_json::to_string_pretty(&operations_schema())
        .expect("the operations schema serializes to JSON");
    text.push('\n');
    text
}

#[cfg(test)]
#[path = "lib.test.rs"]
mod tests;
