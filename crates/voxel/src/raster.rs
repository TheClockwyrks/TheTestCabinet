//! The deterministic, integer-only isometric preview rasterizer.
//!
//! There is no 2D analog of this module in `crates/draw` — a voxel volume has no
//! natural pixel image, so we project it. [`rasterize`] renders a [`VoxelSet`] to
//! PNG bytes with a fixed isometric [`Camera`] using an integer painter's
//! algorithm: occupied voxels are drawn back-to-front, and each cube's three
//! visible faces (top, left, right) are filled parallelograms with fixed integer
//! shading multipliers. Every step is integer arithmetic and every constant is
//! fixed, so the in-container preview and core's post-run regeneration produce
//! byte-identical PNGs — the invariant that makes cheat-divergence meaningful. The
//! PNG encoder settings match `crates/draw` so the validator's decoder round-trips
//! the output.

use crate::color::{PreviewBackground, Rgb};
use crate::{Dims, VoxelSet};

/// A fixed isometric projection from voxel space to preview-image pixels.
///
/// The camera looks at the volume from the front-top-right. A world step maps to a
/// screen step (with `+y` pointing **down** in image space) by these integer basis
/// vectors, all derived from the cube's projected diamond:
///
/// - `+x` → `(+HALF_W, +HALF_H)`
/// - `+z` → `(-HALF_W, +HALF_H)`
/// - `+y` (up) → `(0, -CUBE_H)`
///
/// A single voxel therefore projects to a `2*HALF_W`-wide, `2*HALF_H`-tall top
/// diamond (a 2:1 isometric tile) with `CUBE_H`-tall side faces. The output PNG
/// size is derived deterministically from the volume [`Dims`] and these constants
/// (see [`Camera::image_size`]), independent of which voxels are occupied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Camera {
    /// Half the projected width of one voxel's top diamond, in pixels.
    pub half_w: i64,
    /// Half the projected height of one voxel's top diamond, in pixels.
    pub half_h: i64,
    /// The projected height of one voxel's vertical (side) faces, in pixels.
    pub cube_h: i64,
    /// Transparent border kept around the projected volume, in pixels.
    pub margin: i64,
}

impl Camera {
    /// The fixed preview camera every run uses. A 2:1 isometric tile (`half_w =
    /// 2 * half_h`) with cube-tall sides and a small margin — chunky enough to read
    /// as a solid model yet compact enough that a large volume stays a reasonable
    /// PNG.
    pub const PREVIEW: Camera = Camera {
        half_w: 4,
        half_h: 2,
        cube_h: 4,
        margin: 2,
    };

    /// Project world voxel coordinates to image-pixel coordinates.
    ///
    /// `(ox, oy)` is the screen origin (the projection of world `(0, 0, 0)`) chosen
    /// by [`rasterize`] so the whole volume, plus [`Self::margin`], fits with its
    /// minimum corner at the top-left.
    fn project(&self, ox: i64, oy: i64, x: i64, y: i64, z: i64) -> (i64, i64) {
        (
            ox + (x - z) * self.half_w,
            oy + (x + z) * self.half_h - y * self.cube_h,
        )
    }

    /// The output PNG dimensions `(width, height)` for a volume of the given
    /// extents, derived purely from the extents and this camera's constants so the
    /// canvas size never depends on the occupied voxels.
    pub fn image_size(&self, dims: &Dims) -> (u32, u32) {
        let (w, h, d) = (dims.width as i64, dims.height as i64, dims.depth as i64);
        // x ranges over 0..=w and z over 0..=d, so screen x spans (w + d)*half_w;
        // (x + z) spans 0..=(w + d) and y over 0..=h, so screen y spans
        // (w + d)*half_h + h*cube_h.
        let width = (w + d) * self.half_w + 2 * self.margin;
        let height = (w + d) * self.half_h + h * self.cube_h + 2 * self.margin;
        (width.max(1) as u32, height.max(1) as u32)
    }

    /// The screen origin `(ox, oy)` that places the volume's minimum projected
    /// corner at `(margin, margin)`.
    fn origin(&self, dims: &Dims) -> (i64, i64) {
        // The leftmost screen x is at x=0, z=depth: (0 - depth)*half_w.
        // The topmost screen y is at x=z=0, y=height: -height*cube_h.
        (
            self.margin + dims.depth as i64 * self.half_w,
            self.margin + dims.height as i64 * self.cube_h,
        )
    }
}

/// An in-memory straight-RGBA8 image the rasterizer paints into before encoding.
struct Rgba8 {
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

impl Rgba8 {
    fn cleared(width: u32, height: u32, fill: [u8; 4]) -> Rgba8 {
        let count = width as usize * height as usize;
        let mut pixels = Vec::with_capacity(count * 4);
        for _ in 0..count {
            pixels.extend_from_slice(&fill);
        }
        Rgba8 {
            width,
            height,
            pixels,
        }
    }

    fn set(&mut self, x: i64, y: i64, color: [u8; 4]) {
        if x < 0 || y < 0 || x >= self.width as i64 || y >= self.height as i64 {
            return;
        }
        let offset = (y as usize * self.width as usize + x as usize) * 4;
        self.pixels[offset..offset + 4].copy_from_slice(&color);
    }

    fn to_png_bytes(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut buf, self.width, self.height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder
                .write_header()
                .expect("writing a PNG header to an in-memory buffer cannot fail");
            writer
                .write_image_data(&self.pixels)
                .expect("writing PNG data to an in-memory buffer cannot fail");
        }
        buf
    }
}

/// Rasterize a voxel volume to PNG bytes with the given camera and background.
///
/// The image is cleared to `bg` and each occupied voxel is drawn back-to-front (by
/// ascending `x + y + z`, the depth order for the front-top-right camera), painting
/// the three faces the camera can see. Nearer cubes overpaint farther ones, giving
/// a solid isometric model. Deterministic and integer-only end to end.
pub fn rasterize(set: &VoxelSet, camera: &Camera, bg: PreviewBackground) -> Vec<u8> {
    let (img_w, img_h) = camera.image_size(&set.dims);
    let mut image = Rgba8::cleared(img_w, img_h, bg.fill());
    let (ox, oy) = camera.origin(&set.dims);

    // Collect the occupied voxels and sort them back-to-front. Ties break on
    // (y, z, x) so the order is fully deterministic regardless of iteration.
    let (w, h) = (set.dims.width as i64, set.dims.height as i64);
    let mut voxels: Vec<(i64, i64, i64, Rgb)> = Vec::with_capacity(set.occupied_count());
    for (index, cell) in set.cells.iter().enumerate() {
        if let Some(color) = cell {
            let i = index as i64;
            let x = i % w;
            let y = (i / w) % h;
            let z = i / (w * h);
            voxels.push((x, y, z, *color));
        }
    }
    voxels.sort_by_key(|&(x, y, z, _)| (x + y + z, y, z, x));

    for (x, y, z, color) in voxels {
        draw_cube(&mut image, camera, ox, oy, x, y, z, color);
    }

    image.to_png_bytes()
}

/// Fixed integer shading, as a percentage, applied per visible face so the three
/// faces of a solid-colored cube read as distinct planes: the top is brightest,
/// then the left face, then the right face.
const SHADE_TOP: u32 = 100;
const SHADE_LEFT: u32 = 80;
const SHADE_RIGHT: u32 = 60;

/// Draw the three visible faces of the unit cube occupying cell `(x, y, z)`.
#[allow(clippy::too_many_arguments)]
fn draw_cube(
    image: &mut Rgba8,
    camera: &Camera,
    ox: i64,
    oy: i64,
    x: i64,
    y: i64,
    z: i64,
    color: Rgb,
) {
    let p = |cx: i64, cy: i64, cz: i64| camera.project(ox, oy, cx, cy, cz);

    // Top face (the +y face), the brightest plane.
    fill_quad(
        image,
        [
            p(x, y + 1, z),
            p(x + 1, y + 1, z),
            p(x + 1, y + 1, z + 1),
            p(x, y + 1, z + 1),
        ],
        shade(color, SHADE_TOP),
    );
    // Left face (the +z face), toward the front-left.
    fill_quad(
        image,
        [
            p(x, y, z + 1),
            p(x + 1, y, z + 1),
            p(x + 1, y + 1, z + 1),
            p(x, y + 1, z + 1),
        ],
        shade(color, SHADE_LEFT),
    );
    // Right face (the +x face), toward the front-right.
    fill_quad(
        image,
        [
            p(x + 1, y, z),
            p(x + 1, y + 1, z),
            p(x + 1, y + 1, z + 1),
            p(x + 1, y, z + 1),
        ],
        shade(color, SHADE_RIGHT),
    );
}

/// Multiply an opaque color by an integer percentage, clamping into a byte, and
/// return it as opaque RGBA.
fn shade(color: Rgb, percent: u32) -> [u8; 4] {
    let [r, g, b] = color.0;
    let scale = |c: u8| ((c as u32 * percent) / 100).min(255) as u8;
    [scale(r), scale(g), scale(b), 0xff]
}

/// Fill a convex quad (four screen-space corners in order) with a solid color by
/// splitting it into two triangles that share the `p0`–`p2` diagonal.
fn fill_quad(image: &mut Rgba8, corners: [(i64, i64); 4], color: [u8; 4]) {
    let [p0, p1, p2, p3] = corners;
    fill_triangle(image, p0, p1, p2, color);
    fill_triangle(image, p0, p2, p3, color);
}

/// Fill a triangle with a solid color using integer edge functions over the
/// triangle's bounding box (inclusive edge test, so adjacent triangles leave no
/// seam; a shared edge painted twice is harmless since the color matches).
fn fill_triangle(image: &mut Rgba8, a: (i64, i64), b: (i64, i64), c: (i64, i64), color: [u8; 4]) {
    let area = edge(a, b, c);
    if area == 0 {
        return;
    }
    let min_x = a.0.min(b.0).min(c.0).max(0);
    let max_x = a.0.max(b.0).max(c.0).min(image.width as i64 - 1);
    let min_y = a.1.min(b.1).min(c.1).max(0);
    let max_y = a.1.max(b.1).max(c.1).min(image.height as i64 - 1);
    for y in min_y..=max_y {
        for x in min_x..=max_x {
            let p = (x, y);
            let w0 = edge(b, c, p);
            let w1 = edge(c, a, p);
            let w2 = edge(a, b, p);
            let inside = if area > 0 {
                w0 >= 0 && w1 >= 0 && w2 >= 0
            } else {
                w0 <= 0 && w1 <= 0 && w2 <= 0
            };
            if inside {
                image.set(x, y, color);
            }
        }
    }
}

/// The signed area (times two) of the triangle `(a, b, p)` — positive when `p` is
/// on the left of the directed edge `a -> b`.
fn edge(a: (i64, i64), b: (i64, i64), p: (i64, i64)) -> i64 {
    (p.0 - a.0) * (b.1 - a.1) - (p.1 - a.1) * (b.0 - a.0)
}

#[cfg(test)]
#[path = "raster.test.rs"]
mod tests;
