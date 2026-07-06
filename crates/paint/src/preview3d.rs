//! The `pbr render` lit 3D preview: apply the assembled material to a test surface
//! by **triplanar projection** and render it with the shared wgpu + Mesa lavapipe
//! renderer (`model-core`'s [`render_png`]).
//!
//! The renderer shades per-vertex color under one directional light, so the material
//! response is baked into vertex colors here: the base color is triplanar-sampled
//! from the map, multiplied by ambient occlusion, and lifted by emissive — the same
//! projection a mesh consumes, so the preview reads apples-to-apples with a finished
//! surface. The preview surface geometry is a [`test_cabinet_voxel_mesh::Mesh`] so it
//! borrows into the renderer's `MeshView` directly.
//!
//! [`render_png`]: test_cabinet_model_core::render::render_png

use std::f32::consts::{PI, TAU};

use test_cabinet_model_core::color::PreviewBackground;
use test_cabinet_model_core::render::{View, render_png};
use test_cabinet_voxel_mesh::Mesh;

use crate::raster::{Raster, WrapMode};

/// The test surface a preview applies the material to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Shape {
    /// A UV sphere — the default swatch surface.
    Sphere,
    /// A cube — shows the material across three principal faces.
    Cube,
    /// A capped cylinder.
    Cylinder,
    /// A flat plane, tilted to catch the light.
    Plane,
}

impl Shape {
    /// Parse a `--shape` value.
    pub fn parse(value: &str) -> Result<Shape, String> {
        match value {
            "sphere" => Ok(Shape::Sphere),
            "cube" => Ok(Shape::Cube),
            "cylinder" => Ok(Shape::Cylinder),
            "plane" => Ok(Shape::Plane),
            other => Err(format!("unknown shape `{other}` (sphere|cube|cylinder|plane)")),
        }
    }
}

/// The material maps a preview reads (each already composited to a flat raster).
pub struct MaterialMaps<'a> {
    /// The required base color.
    pub base_color: &'a Raster,
    /// Optional ambient occlusion (multiplied into the color).
    pub ao: Option<&'a Raster>,
    /// Optional emissive (added to the color).
    pub emissive: Option<&'a Raster>,
    /// World-space tiles per unit (the triplanar frequency).
    pub tiling: f32,
}

/// Render the material on `shape` to a PNG, applying it by triplanar projection.
pub fn render(
    shape: Shape,
    maps: &MaterialMaps<'_>,
    background: PreviewBackground,
    size: u32,
) -> Result<Vec<u8>, String> {
    let (positions, normals, indices) = build_surface(shape);
    let colors = triplanar_colors(&positions, &normals, maps);
    let mesh = Mesh {
        positions,
        normals,
        colors,
        indices,
    };
    render_png(&[mesh.view()], View::Iso, background, size)
}

/// Compute per-vertex color by triplanar-projecting the base color, then modulating
/// by AO and adding emissive.
fn triplanar_colors(positions: &[f32], normals: &[f32], maps: &MaterialMaps<'_>) -> Vec<f32> {
    let mut colors = Vec::with_capacity(positions.len());
    for i in (0..positions.len()).step_by(3) {
        let p = [positions[i], positions[i + 1], positions[i + 2]];
        let n = [normals[i], normals[i + 1], normals[i + 2]];
        let base = triplanar_sample(maps.base_color, p, n, maps.tiling);
        let mut rgb = [base[0], base[1], base[2]];
        if let Some(ao) = maps.ao {
            let a = triplanar_sample(ao, p, n, maps.tiling)[0];
            rgb = [rgb[0] * a, rgb[1] * a, rgb[2] * a];
        }
        if let Some(em) = maps.emissive {
            let e = triplanar_sample(em, p, n, maps.tiling);
            rgb = [
                (rgb[0] + e[0]).min(1.0),
                (rgb[1] + e[1]).min(1.0),
                (rgb[2] + e[2]).min(1.0),
            ];
        }
        colors.extend_from_slice(&rgb);
    }
    colors
}

/// Sample a map at a world position by triplanar projection, blending the three
/// axis projections by the surface normal.
fn triplanar_sample(map: &Raster, p: [f32; 3], n: [f32; 3], tiling: f32) -> [f32; 3] {
    let w = [n[0].abs(), n[1].abs(), n[2].abs()];
    let sum = (w[0] + w[1] + w[2]).max(1e-4);
    let w = [w[0] / sum, w[1] / sum, w[2] / sum];
    let f = tiling.max(0.01);
    let sample = |u: f32, v: f32| {
        let x = (u * f).rem_euclid(1.0) * map.width as f32;
        let y = (v * f).rem_euclid(1.0) * map.height as f32;
        map.sample(x - 0.5, y - 0.5, WrapMode::Wrap)
    };
    let cx = sample(p[1], p[2]);
    let cy = sample(p[0], p[2]);
    let cz = sample(p[0], p[1]);
    [
        cx.r * w[0] + cy.r * w[1] + cz.r * w[2],
        cx.g * w[0] + cy.g * w[1] + cz.g * w[2],
        cx.b * w[0] + cy.b * w[1] + cz.b * w[2],
    ]
}

/// Build a test surface as flat position/normal arrays plus triangle indices.
fn build_surface(shape: Shape) -> (Vec<f32>, Vec<f32>, Vec<u32>) {
    match shape {
        Shape::Sphere => uv_sphere(24, 32, 1.0),
        Shape::Cube => cube(1.0),
        Shape::Cylinder => cylinder(32, 1.0, 1.2),
        Shape::Plane => plane(1.4),
    }
}

fn push_vertex(pos: &mut Vec<f32>, nrm: &mut Vec<f32>, p: [f32; 3], n: [f32; 3]) -> u32 {
    let idx = (pos.len() / 3) as u32;
    pos.extend_from_slice(&p);
    nrm.extend_from_slice(&n);
    idx
}

fn uv_sphere(stacks: u32, slices: u32, r: f32) -> (Vec<f32>, Vec<f32>, Vec<u32>) {
    let mut pos = Vec::new();
    let mut nrm = Vec::new();
    let mut idx = Vec::new();
    for i in 0..=stacks {
        let phi = PI * i as f32 / stacks as f32;
        for j in 0..=slices {
            let theta = TAU * j as f32 / slices as f32;
            let n = [
                phi.sin() * theta.cos(),
                phi.cos(),
                phi.sin() * theta.sin(),
            ];
            push_vertex(&mut pos, &mut nrm, [n[0] * r, n[1] * r, n[2] * r], n);
        }
    }
    let ring = slices + 1;
    for i in 0..stacks {
        for j in 0..slices {
            let a = i * ring + j;
            let b = a + ring;
            idx.extend_from_slice(&[a, b, a + 1, a + 1, b, b + 1]);
        }
    }
    (pos, nrm, idx)
}

fn cube(h: f32) -> (Vec<f32>, Vec<f32>, Vec<u32>) {
    let mut pos = Vec::new();
    let mut nrm = Vec::new();
    let mut idx = Vec::new();
    let faces = [
        ([1.0, 0.0, 0.0], [[h, -h, -h], [h, h, -h], [h, h, h], [h, -h, h]]),
        ([-1.0, 0.0, 0.0], [[-h, -h, h], [-h, h, h], [-h, h, -h], [-h, -h, -h]]),
        ([0.0, 1.0, 0.0], [[-h, h, -h], [-h, h, h], [h, h, h], [h, h, -h]]),
        ([0.0, -1.0, 0.0], [[-h, -h, h], [-h, -h, -h], [h, -h, -h], [h, -h, h]]),
        ([0.0, 0.0, 1.0], [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]]),
        ([0.0, 0.0, -1.0], [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]]),
    ];
    for (n, quad) in faces {
        let base = (pos.len() / 3) as u32;
        for v in quad {
            push_vertex(&mut pos, &mut nrm, v, n);
        }
        idx.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
    }
    (pos, nrm, idx)
}

fn cylinder(slices: u32, r: f32, half_h: f32) -> (Vec<f32>, Vec<f32>, Vec<u32>) {
    let mut pos = Vec::new();
    let mut nrm = Vec::new();
    let mut idx = Vec::new();
    // Side wall.
    for j in 0..=slices {
        let theta = TAU * j as f32 / slices as f32;
        let n = [theta.cos(), 0.0, theta.sin()];
        push_vertex(&mut pos, &mut nrm, [n[0] * r, half_h, n[2] * r], n);
        push_vertex(&mut pos, &mut nrm, [n[0] * r, -half_h, n[2] * r], n);
    }
    for j in 0..slices {
        let a = j * 2;
        idx.extend_from_slice(&[a, a + 1, a + 2, a + 2, a + 1, a + 3]);
    }
    // Caps.
    for (sign, ny) in [(half_h, 1.0f32), (-half_h, -1.0f32)] {
        let center = push_vertex(&mut pos, &mut nrm, [0.0, sign, 0.0], [0.0, ny, 0.0]);
        let mut ring = Vec::new();
        for j in 0..=slices {
            let theta = TAU * j as f32 / slices as f32;
            ring.push(push_vertex(
                &mut pos,
                &mut nrm,
                [theta.cos() * r, sign, theta.sin() * r],
                [0.0, ny, 0.0],
            ));
        }
        for j in 0..slices as usize {
            if ny > 0.0 {
                idx.extend_from_slice(&[center, ring[j], ring[j + 1]]);
            } else {
                idx.extend_from_slice(&[center, ring[j + 1], ring[j]]);
            }
        }
    }
    (pos, nrm, idx)
}

fn plane(h: f32) -> (Vec<f32>, Vec<f32>, Vec<u32>) {
    let n = [0.0, 1.0, 0.0];
    let mut pos = Vec::new();
    let mut nrm = Vec::new();
    for v in [[-h, 0.0, -h], [-h, 0.0, h], [h, 0.0, h], [h, 0.0, -h]] {
        push_vertex(&mut pos, &mut nrm, v, n);
    }
    (pos, nrm, vec![0, 1, 2, 0, 2, 3])
}

#[cfg(test)]
#[path = "preview3d.test.rs"]
mod tests;
