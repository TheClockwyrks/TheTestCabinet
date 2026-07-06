//! Pure PBR map derivations the `pbr` binary bakes from a painted **height** field:
//! a tangent-space normal map, an ambient-occlusion map, and a curvature map. These
//! are ordinary raster math (no GPU), so they live in the pure engine and replay in
//! a preview exactly as they will in core — only the lit 3D `pbr render` needs the
//! renderer stack. Every bake reads and writes toroidally so a seamless height map
//! yields seamless derived maps.

use crate::color::Color;
use crate::raster::Raster;

/// Read a document's composited grayscale as a height field (`0..=1` luma).
pub fn height_field(raster: &Raster) -> Vec<f32> {
    raster.pixels.iter().map(|c| c.luma()).collect()
}

fn at(field: &[f32], w: u32, h: u32, x: i64, y: i64) -> f32 {
    let xi = x.rem_euclid(w as i64) as u32;
    let yi = y.rem_euclid(h as i64) as u32;
    field[(yi * w + xi) as usize]
}

/// Bake a tangent-space normal map from a height field. `strength` scales the
/// relief; the RGB encodes the unit normal as `(n*0.5+0.5)`, with +Z (flat) as the
/// familiar `#8080ff`.
pub fn bake_normal(height: &[f32], w: u32, h: u32, strength: f32) -> Raster {
    let mut out = Raster::filled(w, h, Color::TRANSPARENT);
    for y in 0..h {
        for x in 0..w {
            // Sobel gradient of the height field.
            let (xi, yi) = (x as i64, y as i64);
            let gx = (at(height, w, h, xi + 1, yi - 1)
                + 2.0 * at(height, w, h, xi + 1, yi)
                + at(height, w, h, xi + 1, yi + 1))
                - (at(height, w, h, xi - 1, yi - 1)
                    + 2.0 * at(height, w, h, xi - 1, yi)
                    + at(height, w, h, xi - 1, yi + 1));
            let gy = (at(height, w, h, xi - 1, yi + 1)
                + 2.0 * at(height, w, h, xi, yi + 1)
                + at(height, w, h, xi + 1, yi + 1))
                - (at(height, w, h, xi - 1, yi - 1)
                    + 2.0 * at(height, w, h, xi, yi - 1)
                    + at(height, w, h, xi + 1, yi - 1));
            let nx = -gx * strength;
            let ny = -gy * strength;
            let nz = 1.0;
            let len = (nx * nx + ny * ny + nz * nz).sqrt().max(1e-6);
            out.pixels[(y * w + x) as usize] = Color::new(
                (nx / len) * 0.5 + 0.5,
                (ny / len) * 0.5 + 0.5,
                (nz / len) * 0.5 + 0.5,
                1.0,
            );
        }
    }
    out
}

/// Bake an ambient-occlusion map from a height field: a texel is occluded when its
/// neighborhood (within `radius`) rises above it.
pub fn bake_ao(height: &[f32], w: u32, h: u32, radius: u32) -> Raster {
    let r = radius.max(1) as i64;
    let mut out = Raster::filled(w, h, Color::TRANSPARENT);
    for y in 0..h {
        for x in 0..w {
            let center = at(height, w, h, x as i64, y as i64);
            let mut occ = 0.0;
            let mut count = 0.0;
            for dy in -r..=r {
                for dx in -r..=r {
                    if dx == 0 && dy == 0 {
                        continue;
                    }
                    let neighbor = at(height, w, h, x as i64 + dx, y as i64 + dy);
                    let dist = ((dx * dx + dy * dy) as f32).sqrt();
                    occ += ((neighbor - center) / dist).max(0.0);
                    count += 1.0;
                }
            }
            let ao = (1.0 - (occ / count) * 4.0).clamp(0.0, 1.0);
            out.pixels[(y * w + x) as usize] = Color::new(ao, ao, ao, 1.0);
        }
    }
    out
}

/// Bake a curvature map from a height field (the Laplacian): convex ridges bright,
/// concave valleys dark, flats mid-grey.
pub fn bake_curvature(height: &[f32], w: u32, h: u32) -> Raster {
    let mut out = Raster::filled(w, h, Color::TRANSPARENT);
    for y in 0..h {
        for x in 0..w {
            let (xi, yi) = (x as i64, y as i64);
            let lap = at(height, w, h, xi - 1, yi)
                + at(height, w, h, xi + 1, yi)
                + at(height, w, h, xi, yi - 1)
                + at(height, w, h, xi, yi + 1)
                - 4.0 * at(height, w, h, xi, yi);
            let c = (0.5 + lap * 4.0).clamp(0.0, 1.0);
            out.pixels[(y * w + x) as usize] = Color::new(c, c, c, 1.0);
        }
    }
    out
}

#[cfg(test)]
#[path = "bake.test.rs"]
mod tests;
