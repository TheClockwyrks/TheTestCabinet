//! The shared, headless mesh preview renderer every voxel-family tool draws with.
//!
//! This is the generic replacement for the retired integer isometric rasterizer:
//! it takes one or more surface meshes (the flat `positions`/`normals`/`colors`/
//! `indices` arrays each tool's `mesh.json` already carries), an [orbit/iso
//! camera][View], and a single fixed directional light, and produces the preview
//! PNG bytes. It knows nothing about voxels, signed-distance fields, or cubes —
//! only triangles — so the cube tool and the meshing tools share one preview path
//! and their previews are apples-to-apples.
//!
//! Rendering runs on **`wgpu` targeting Mesa lavapipe** (software Vulkan, CPU-only,
//! headless — there is no GPU and no window/surface in the run container). The
//! scene is drawn offscreen to a color+depth texture and the color target is read
//! back to CPU memory and PNG-encoded. Because the renderer no longer feeds a
//! cheat-detection regeneration, it does not need to be deterministic; it only
//! needs to read cleanly for a human reviewer.

use std::borrow::Cow;

use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Vec3};
use wgpu::util::DeviceExt;

use crate::color::PreviewBackground;

/// The default edge length, in pixels, of a square preview or scene image.
pub const PREVIEW_SIZE: u32 = 512;

/// A borrowed view of one surface mesh: the same flat arrays the `mesh.json`
/// contract carries. Positions and normals are 3 floats per vertex; colors are 3
/// floats (linear `0..1`) per vertex; indices are triangle-vertex indices, 3 per
/// triangle. The renderer reads these directly — no re-meshing.
#[derive(Debug, Clone, Copy)]
pub struct MeshView<'a> {
    /// Vertex positions, 3 floats (x, y, z) per vertex.
    pub positions: &'a [f32],
    /// Vertex normals, 3 floats per vertex.
    pub normals: &'a [f32],
    /// Vertex colors, 3 floats (r, g, b) in `0..1` per vertex.
    pub colors: &'a [f32],
    /// Triangle indices into the vertex arrays, 3 per triangle.
    pub indices: &'a [u32],
}

/// A viewpoint onto the assembled model. [`View::Iso`] is the 3D orbit view used
/// for the per-operation preview (front-top-right, like the old isometric preview);
/// the three elevations look straight down a principal axis for checking a part's
/// placement. The camera auto-frames the combined bounding box of every mesh, so a
/// view never depends on the image size.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum View {
    /// The 3/4 orbit view, from the front-top-right.
    Iso,
    /// The front elevation: the camera sits toward `+z` looking along `-z`.
    Front,
    /// The side elevation: the camera sits toward `+x` looking along `-x`.
    Side,
    /// The plan (top) view: the camera sits above looking straight down `-y`.
    Top,
}

impl View {
    /// The camera offset direction (from the scene center toward the eye) and the
    /// up vector for this view. The eye distance is derived from the scene radius.
    fn eye_dir_and_up(self) -> (Vec3, Vec3) {
        match self {
            // A classic 3/4 view: azimuth 45deg, a moderate downward tilt.
            View::Iso => (Vec3::new(1.0, 0.85, 1.0).normalize(), Vec3::Y),
            View::Front => (Vec3::Z, Vec3::Y),
            View::Side => (Vec3::X, Vec3::Y),
            // Looking straight down, so up cannot be +y; use -z so +z reads toward
            // the top of the image.
            View::Top => (Vec3::Y, Vec3::new(0.0, 0.0, -1.0)),
        }
    }
}

/// One vertex handed to the GPU: position, normal, and linear RGB color.
#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
struct Vertex {
    position: [f32; 3],
    normal: [f32; 3],
    color: [f32; 3],
}

/// The per-draw uniform block: the model-view-projection matrix and the world-space
/// light direction (xyz; w is padding to keep the 16-byte alignment WGSL requires).
#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
struct Uniforms {
    mvp: [[f32; 4]; 4],
    light_dir: [f32; 4],
}

/// The world-space direction the single directional light shines *from* (toward the
/// front-top-right), so the lit faces read the way the old isometric shading did.
const LIGHT_DIR: [f32; 4] = [0.4, 0.85, 0.6, 0.0];

/// The vertex+fragment shader: transform by the MVP, then shade the vertex color by
/// one directional light plus a constant ambient term.
const SHADER: &str = r#"
struct Uniforms {
    mvp: mat4x4<f32>,
    light_dir: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) normal: vec3<f32>,
    @location(1) color: vec3<f32>,
};

@vertex
fn vs_main(
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) color: vec3<f32>,
) -> VsOut {
    var out: VsOut;
    out.clip = u.mvp * vec4<f32>(position, 1.0);
    out.normal = normal;
    out.color = color;
    return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    let n = normalize(in.normal);
    let l = normalize(u.light_dir.xyz);
    let diffuse = max(dot(n, l), 0.0);
    let ambient = 0.4;
    let shade = ambient + (1.0 - ambient) * diffuse;
    return vec4<f32>(in.color * shade, 1.0);
}
"#;

/// Render `meshes` from `view` to a square PNG of `size` pixels a side, cleared to
/// `background`, and return the encoded bytes.
///
/// Every mesh is drawn into one scene (this is how the animated tool composes an
/// assembled model from its per-part meshes); the camera frames the union of their
/// bounding boxes. An empty scene (no geometry yet) renders as a cleared image.
pub fn render_png(
    meshes: &[MeshView<'_>],
    view: View,
    background: PreviewBackground,
    size: u32,
) -> Result<Vec<u8>, String> {
    let size = size.max(1);
    let vertices = collect_vertices(meshes);
    let indices = collect_indices(meshes);
    let mvp = camera_mvp(&vertices, view);
    pollster::block_on(render_offscreen(&vertices, &indices, mvp, background, size))
}

/// Flatten every mesh's parallel arrays into one interleaved vertex buffer.
fn collect_vertices(meshes: &[MeshView<'_>]) -> Vec<Vertex> {
    let mut vertices = Vec::new();
    for mesh in meshes {
        for (i, pos) in mesh.positions.chunks_exact(3).enumerate() {
            let p = i * 3;
            vertices.push(Vertex {
                position: [pos[0], pos[1], pos[2]],
                normal: normal_at(mesh.normals, p),
                color: color_at(mesh.colors, p),
            });
        }
    }
    vertices
}

/// The normal triple at flat offset `p`, defaulting to `+y` when a mesh omits
/// normals (so a degenerate mesh still shades rather than going black).
fn normal_at(normals: &[f32], p: usize) -> [f32; 3] {
    if p + 2 < normals.len() {
        [normals[p], normals[p + 1], normals[p + 2]]
    } else {
        [0.0, 1.0, 0.0]
    }
}

/// The color triple at flat offset `p`, defaulting to mid-grey when a mesh omits
/// colors.
fn color_at(colors: &[f32], p: usize) -> [f32; 3] {
    if p + 2 < colors.len() {
        [colors[p], colors[p + 1], colors[p + 2]]
    } else {
        [0.5, 0.5, 0.5]
    }
}

/// Concatenate every mesh's indices into one index buffer, offsetting each mesh's
/// indices by the running vertex count so the meshes share one draw.
fn collect_indices(meshes: &[MeshView<'_>]) -> Vec<u32> {
    let mut indices = Vec::new();
    let mut base: u32 = 0;
    for mesh in meshes {
        for &index in mesh.indices {
            indices.push(base + index);
        }
        base += (mesh.positions.len() / 3) as u32;
    }
    indices
}

/// Build the model-view-projection matrix that frames every vertex for `view`.
fn camera_mvp(vertices: &[Vertex], view: View) -> Mat4 {
    // The scene's bounding box; an empty scene gets a unit box so the matrix is
    // still finite (nothing is drawn anyway).
    let mut min = Vec3::splat(f32::INFINITY);
    let mut max = Vec3::splat(f32::NEG_INFINITY);
    for v in vertices {
        let p = Vec3::from(v.position);
        min = min.min(p);
        max = max.max(p);
    }
    if !min.is_finite() || !max.is_finite() {
        min = Vec3::ZERO;
        max = Vec3::ONE;
    }
    let center = (min + max) * 0.5;
    // Half the box diagonal, floored so a flat or single-voxel scene still has a
    // positive framing radius.
    let radius = ((max - min).length() * 0.5).max(1.0);

    let fov_y = 45f32.to_radians();
    // Distance that fits a sphere of `radius` in the vertical field of view, with a
    // little margin so the model does not touch the frame edges.
    let distance = (radius / (fov_y * 0.5).sin()) * 1.2;

    let (dir, up) = view.eye_dir_and_up();
    let eye = center + dir * distance;

    // The preview is always square, so the aspect ratio is 1.
    let aspect = 1.0;
    let near = (distance - radius).max(0.01);
    let far = distance + radius * 2.0 + 1.0;
    let proj = Mat4::perspective_rh(fov_y, aspect, near, far);
    let camera = Mat4::look_at_rh(eye, center, up);
    proj * camera
}

/// The wgpu offscreen render: pick a (software-allowed) adapter, draw the scene to a
/// color+depth texture, copy the color target back to CPU memory, and PNG-encode it.
async fn render_offscreen(
    vertices: &[Vertex],
    indices: &[u32],
    mvp: Mat4,
    background: PreviewBackground,
    size: u32,
) -> Result<Vec<u8>, String> {
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
        // Prefer Vulkan (Mesa lavapipe) and allow the GL fallback; the container
        // image provides the software Vulkan ICD.
        backends: wgpu::Backends::VULKAN | wgpu::Backends::GL,
        ..Default::default()
    });

    let adapter = match instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::LowPower,
            force_fallback_adapter: false,
            compatible_surface: None,
        })
        .await
    {
        Some(adapter) => adapter,
        // No hardware adapter: ask explicitly for a software/fallback one.
        None => instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::LowPower,
                force_fallback_adapter: true,
                compatible_surface: None,
            })
            .await
            .ok_or_else(|| {
                "no wgpu adapter available (expected Mesa lavapipe software Vulkan)".to_string()
            })?,
    };

    let (device, queue) = adapter
        .request_device(
            &wgpu::DeviceDescriptor {
                label: Some("mesh-preview"),
                required_features: wgpu::Features::empty(),
                // Downlevel limits are comfortably within a software adapter's caps.
                required_limits: wgpu::Limits::downlevel_defaults(),
                memory_hints: wgpu::MemoryHints::default(),
            },
            None,
        )
        .await
        .map_err(|err| format!("requesting a wgpu device: {err}"))?;

    // The offscreen color target. A plain (non-sRGB) format so the shader's output
    // is stored verbatim, matching the `0..1` normalization the mesh colors use.
    let format = wgpu::TextureFormat::Rgba8Unorm;
    let extent = wgpu::Extent3d {
        width: size,
        height: size,
        depth_or_array_layers: 1,
    };
    let color = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("color"),
        size: extent,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let color_view = color.create_view(&wgpu::TextureViewDescriptor::default());

    let depth = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("depth"),
        size: extent,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Depth32Float,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    let depth_view = depth.create_view(&wgpu::TextureViewDescriptor::default());

    let uniforms = Uniforms {
        mvp: mvp.to_cols_array_2d(),
        light_dir: LIGHT_DIR,
    };
    let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("uniforms"),
        contents: bytemuck::bytes_of(&uniforms),
        usage: wgpu::BufferUsages::UNIFORM,
    });

    let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("uniforms-layout"),
        entries: &[wgpu::BindGroupLayoutEntry {
            binding: 0,
            visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        }],
    });
    let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("uniforms-bind-group"),
        layout: &bind_group_layout,
        entries: &[wgpu::BindGroupEntry {
            binding: 0,
            resource: uniform_buffer.as_entire_binding(),
        }],
    });

    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("mesh-shader"),
        source: wgpu::ShaderSource::Wgsl(Cow::Borrowed(SHADER)),
    });

    let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("pipeline-layout"),
        bind_group_layouts: &[&bind_group_layout],
        push_constant_ranges: &[],
    });

    let vertex_layout = wgpu::VertexBufferLayout {
        array_stride: std::mem::size_of::<Vertex>() as wgpu::BufferAddress,
        step_mode: wgpu::VertexStepMode::Vertex,
        attributes: &[
            wgpu::VertexAttribute {
                offset: 0,
                shader_location: 0,
                format: wgpu::VertexFormat::Float32x3,
            },
            wgpu::VertexAttribute {
                offset: 12,
                shader_location: 1,
                format: wgpu::VertexFormat::Float32x3,
            },
            wgpu::VertexAttribute {
                offset: 24,
                shader_location: 2,
                format: wgpu::VertexFormat::Float32x3,
            },
        ],
    };

    let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("mesh-pipeline"),
        layout: Some(&pipeline_layout),
        vertex: wgpu::VertexState {
            module: &shader,
            entry_point: Some("vs_main"),
            buffers: &[vertex_layout],
            compilation_options: Default::default(),
        },
        fragment: Some(wgpu::FragmentState {
            module: &shader,
            entry_point: Some("fs_main"),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: None,
                write_mask: wgpu::ColorWrites::ALL,
            })],
            compilation_options: Default::default(),
        }),
        primitive: wgpu::PrimitiveState {
            topology: wgpu::PrimitiveTopology::TriangleList,
            // Draw both sides: mesh winding is trusted for lighting, not culling, so
            // no surface goes missing if a mesher emits a face wound the other way.
            cull_mode: None,
            ..Default::default()
        },
        depth_stencil: Some(wgpu::DepthStencilState {
            format: wgpu::TextureFormat::Depth32Float,
            depth_write_enabled: true,
            depth_compare: wgpu::CompareFunction::Less,
            stencil: wgpu::StencilState::default(),
            bias: wgpu::DepthBiasState::default(),
        }),
        multisample: wgpu::MultisampleState::default(),
        multiview: None,
        cache: None,
    });

    let vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("vertices"),
        contents: bytemuck::cast_slice(vertices),
        usage: wgpu::BufferUsages::VERTEX,
    });
    let index_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("indices"),
        contents: bytemuck::cast_slice(indices),
        usage: wgpu::BufferUsages::INDEX,
    });

    // The readback buffer: each row is padded up to the 256-byte copy alignment.
    let bytes_per_pixel = 4u32;
    let unpadded_bytes_per_row = size * bytes_per_pixel;
    let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let padded_bytes_per_row = unpadded_bytes_per_row.div_ceil(align) * align;
    let readback = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("readback"),
        size: (padded_bytes_per_row * size) as wgpu::BufferAddress,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });

    let clear = clear_color(background);
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("frame"),
    });
    {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("mesh-pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &color_view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(clear),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: &depth_view,
                depth_ops: Some(wgpu::Operations {
                    load: wgpu::LoadOp::Clear(1.0),
                    store: wgpu::StoreOp::Discard,
                }),
                stencil_ops: None,
            }),
            timestamp_writes: None,
            occlusion_query_set: None,
        });
        if !indices.is_empty() {
            pass.set_pipeline(&pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            pass.set_vertex_buffer(0, vertex_buffer.slice(..));
            pass.set_index_buffer(index_buffer.slice(..), wgpu::IndexFormat::Uint32);
            pass.draw_indexed(0..indices.len() as u32, 0, 0..1);
        }
    }

    encoder.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture: &color,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyBufferInfo {
            buffer: &readback,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(padded_bytes_per_row),
                rows_per_image: Some(size),
            },
        },
        extent,
    );

    queue.submit(std::iter::once(encoder.finish()));

    // Map the readback buffer and wait for the GPU (lavapipe: the CPU) to finish.
    let slice = readback.slice(..);
    let (tx, rx) = std::sync::mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |result| {
        let _ = tx.send(result);
    });
    let _ = device.poll(wgpu::Maintain::Wait);
    rx.recv()
        .map_err(|_| "readback map channel dropped".to_string())?
        .map_err(|err| format!("mapping the readback buffer: {err}"))?;

    let mapped = slice.get_mapped_range();
    // Strip the per-row padding into a tight RGBA8 buffer.
    let mut pixels = Vec::with_capacity((size * size * bytes_per_pixel) as usize);
    for row in 0..size {
        let start = (row * padded_bytes_per_row) as usize;
        let end = start + unpadded_bytes_per_row as usize;
        pixels.extend_from_slice(&mapped[start..end]);
    }
    drop(mapped);
    readback.unmap();

    encode_png(&pixels, size)
}

/// The wgpu clear color for a preview background: transparent black, or the opaque
/// background color normalized to `0..1`.
fn clear_color(background: PreviewBackground) -> wgpu::Color {
    let [r, g, b, a] = background.fill();
    wgpu::Color {
        r: r as f64 / 255.0,
        g: g as f64 / 255.0,
        b: b as f64 / 255.0,
        a: a as f64 / 255.0,
    }
}

/// Encode a tight straight-RGBA8 buffer of `size` x `size` pixels as PNG bytes.
fn encode_png(pixels: &[u8], size: u32) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut buf, size, size);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|err| format!("writing the PNG header: {err}"))?;
        writer
            .write_image_data(pixels)
            .map_err(|err| format!("writing the PNG data: {err}"))?;
    }
    Ok(buf)
}
