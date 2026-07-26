//! The on-request `render`: simulate the authored system, render the preview frames,
//! pack the GIF, and emit `system.json`.
//!
//! Recording an operation is cheap; simulating a whole effect and rendering it is not,
//! so — like the voxel/meshing tools — this runs only on the explicit `render` command.
//! It folds the op log into a [`System`], writes `system.json` (the run's authoritative
//! output, which every consumer simulates), then plays the system with the
//! [simulator](crate::sim) and turns the captured frames into a preview: `particle-3d`
//! billboards each particle through `model-core`'s `wgpu` + Mesa renderer from an orbit
//! camera; `particle-2d` composites them in a 2D raster path. The per-frame images are
//! packed into a GIF (looping for a steady-state effect, one-shot for a decaying one).
//! When a viewer is watching, a representative frame plus the `system.json` payload is
//! streamed back best-effort so the viewer can simulate the effect live.

use std::fs;
use std::io::Write;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::time::Duration;

use test_cabinet_model_core::color::PreviewBackground;
use test_cabinet_model_core::record::{ensure_parent, read_actions};
use test_cabinet_model_core::render::{MeshView, PREVIEW_SIZE, View, render_png};

use crate::budget;
use crate::config::ParticleConfig;
use crate::op::{Op, build_system};
use crate::sim::{Frame, Simulation, simulate};
use crate::system::{Dimensionality, System};

/// A fixed seed for the preview simulation, so a model re-running `render` sees a
/// stable capture of its effect (the live-playing runtime is free to re-seed per play).
const PREVIEW_SEED: u64 = 0x50FA_11ED_5EED_1234;

/// The most billboards `particle-3d` draws per frame, and the most points
/// `particle-2d` composites — a bound on the preview's render cost when a system emits
/// a very dense cloud. The first particles are drawn; the rest are represented by them.
const DRAW_CAP_3D: usize = 8_000;
const DRAW_CAP_2D: usize = 40_000;

/// The `render` arguments shared by both binaries.
#[derive(Debug, Clone, Default)]
pub struct RenderRequest {
    /// Capture only this single frame index to a still PNG instead of the whole GIF.
    pub frame: Option<u32>,
    /// Override the output path (the GIF, or the still for `--frame`).
    pub out: Option<PathBuf>,
}

/// Run `render`: emit `system.json`, simulate, and write the preview (GIF, or a single
/// still for `--frame`). Streams a representative frame + the system to a watching
/// viewer, best-effort.
pub fn run(
    config: &ParticleConfig,
    dims: Dimensionality,
    request: &RenderRequest,
) -> Result<(), String> {
    let ops: Vec<Op> = read_actions(&config.actions)?;
    let field = config.field(dims);
    let system = build_system(
        &ops,
        dims,
        field,
        config.duration_ms,
        config.fps(),
        config.looping,
    );

    // `system.json` is the authoritative output — write it first so it exists even if
    // a later render step is interrupted.
    let system_json = serde_json::to_vec_pretty(&system)
        .map_err(|err| format!("serializing system.json: {err}"))?;
    ensure_parent(&config.system)?;
    fs::write(&config.system, &system_json)
        .map_err(|err| format!("writing {}: {err}", config.system.display()))?;

    // Authoring rejects an over-budget operation, so a log built through the tool is
    // already within the ceiling. A log that arrived another way is still rendered —
    // the simulator simply stops spawning at the cap — but say so, since the preview
    // would otherwise quietly under-represent what was authored.
    let projection = budget::project(&system);
    if projection.exceeds_budget() {
        eprintln!(
            "warning: {}\n\nthe preview simulates the first {} particles; the rest are \
             dropped.",
            projection.over_budget_message(),
            budget::MAX_LIVE_PARTICLES
        );
    }

    let background = config.background()?;
    let simulation = simulate(&system, PREVIEW_SEED);
    let frames = render_frames(&system, dims, background, &simulation)?;

    if let Some(index) = request.frame {
        let idx = (index as usize).min(frames.len().saturating_sub(1));
        let still = frames.get(idx).ok_or("no frames to capture")?;
        let png = still.to_png()?;
        let out = request
            .out
            .clone()
            .unwrap_or_else(|| PathBuf::from("frame.png"));
        ensure_parent(&out)?;
        fs::write(&out, &png).map_err(|err| format!("writing {}: {err}", out.display()))?;
        stream_live(config, &frames, &system_json, ops.len());
        return Ok(());
    }

    let gif = encode_gif(&frames, background, config.fps(), system.looping)?;
    let out = request
        .out
        .clone()
        .unwrap_or_else(|| config.preview.clone());
    ensure_parent(&out)?;
    fs::write(&out, &gif).map_err(|err| format!("writing {}: {err}", out.display()))?;

    stream_live(config, &frames, &system_json, ops.len());
    Ok(())
}

/// A straight-alpha RGBA8 preview frame.
struct RgbaFrame {
    width: u32,
    height: u32,
    /// Row-major RGBA8 pixels.
    pixels: Vec<u8>,
}

impl RgbaFrame {
    /// Encode this frame as a PNG (preserving transparency).
    fn to_png(&self) -> Result<Vec<u8>, String> {
        let mut buf = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut buf, self.width, self.height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder
                .write_header()
                .map_err(|err| format!("writing the PNG header: {err}"))?;
            writer
                .write_image_data(&self.pixels)
                .map_err(|err| format!("writing the PNG data: {err}"))?;
        }
        Ok(buf)
    }

    /// This frame composited onto an opaque `bg`, for the GIF (which has no alpha).
    fn composite_opaque(&self, bg: [u8; 3]) -> Vec<u8> {
        let mut out = vec![0u8; self.pixels.len()];
        for (dst, src) in out.chunks_exact_mut(4).zip(self.pixels.chunks_exact(4)) {
            let a = src[3] as f32 / 255.0;
            let over = |s: u8, b: u8| (s as f32 * a + b as f32 * (1.0 - a)).round() as u8;
            dst[0] = over(src[0], bg[0]);
            dst[1] = over(src[1], bg[1]);
            dst[2] = over(src[2], bg[2]);
            dst[3] = 255;
        }
        out
    }
}

/// Render every simulated frame into an [`RgbaFrame`], via the 3D billboard path or the
/// 2D raster path.
fn render_frames(
    system: &System,
    dims: Dimensionality,
    background: PreviewBackground,
    simulation: &Simulation,
) -> Result<Vec<RgbaFrame>, String> {
    let mut frames = Vec::with_capacity(simulation.frames.len());
    for frame in &simulation.frames {
        let rgba = match dims {
            Dimensionality::D2 => raster_2d(system, background, frame),
            Dimensionality::D3 => billboard_3d(system, background, frame)?,
        };
        frames.push(rgba);
    }
    Ok(frames)
}

/// Composite one frame's particles in the 2D raster path: soft alpha-over discs in the
/// planar field, mapped into the square preview canvas.
fn raster_2d(system: &System, background: PreviewBackground, frame: &Frame) -> RgbaFrame {
    let size = PREVIEW_SIZE;
    let clear = background.fill();
    let mut pixels = vec![0u8; (size * size * 4) as usize];
    for px in pixels.chunks_exact_mut(4) {
        px.copy_from_slice(&clear);
    }

    let fw = system.field.width as f32;
    let fh = system.field.height as f32;
    let scale = size as f32 / fw.max(fh);
    // Center the field in the square canvas.
    let ox = (size as f32 - fw * scale) * 0.5;
    let oy = (size as f32 - fh * scale) * 0.5;
    let base_radius = size as f32 * 0.016;

    for particle in frame.particles.iter().take(DRAW_CAP_2D) {
        let cx = ox + particle.position[0] * scale;
        // y is up in the field, down in the image.
        let cy = size as f32 - (oy + particle.position[1] * scale);
        let radius = (base_radius * particle.size).max(0.75);
        let [r, g, b] = to_bytes(particle.color);
        stamp_disc(
            &mut pixels,
            size,
            cx,
            cy,
            radius,
            [r, g, b],
            particle.opacity,
        );
    }

    RgbaFrame {
        width: size,
        height: size,
        pixels,
    }
}

/// Alpha-over a soft disc into an RGBA canvas: opacity falls off quadratically toward
/// the rim, giving particles a soft edge without a sprite.
fn stamp_disc(
    pixels: &mut [u8],
    size: u32,
    cx: f32,
    cy: f32,
    radius: f32,
    color: [u8; 3],
    opacity: f32,
) {
    let min_x = ((cx - radius).floor() as i32).max(0);
    let max_x = ((cx + radius).ceil() as i32).min(size as i32 - 1);
    let min_y = ((cy - radius).floor() as i32).max(0);
    let max_y = ((cy + radius).ceil() as i32).min(size as i32 - 1);
    let r2 = radius * radius;
    for y in min_y..=max_y {
        for x in min_x..=max_x {
            let dx = x as f32 + 0.5 - cx;
            let dy = y as f32 + 0.5 - cy;
            let d2 = dx * dx + dy * dy;
            if d2 > r2 {
                continue;
            }
            let falloff = 1.0 - (d2 / r2);
            let a = (opacity * falloff).clamp(0.0, 1.0);
            if a <= 0.0 {
                continue;
            }
            let i = ((y as u32 * size + x as u32) * 4) as usize;
            let over = |c: u8, dst: u8| (c as f32 * a + dst as f32 * (1.0 - a)).round() as u8;
            pixels[i] = over(color[0], pixels[i]);
            pixels[i + 1] = over(color[1], pixels[i + 1]);
            pixels[i + 2] = over(color[2], pixels[i + 2]);
            let da = pixels[i + 3] as f32 / 255.0;
            pixels[i + 3] = ((a + da * (1.0 - a)) * 255.0).round() as u8;
        }
    }
}

/// Render one frame's particles as camera-facing billboards through the shared `wgpu`
/// mesh renderer: each particle is a quad facing the orbit camera, its color faded
/// toward the background by its opacity (the opaque renderer has no alpha blend, so the
/// fade is baked into the color). The field's eight corners are added as degenerate
/// (zero-area) triangles so the camera frames the whole field volume consistently
/// across frames rather than jittering with the particle cloud's bounding box.
fn billboard_3d(
    system: &System,
    background: PreviewBackground,
    frame: &Frame,
) -> Result<RgbaFrame, String> {
    // The Iso orbit camera's eye direction (matching `model-core`'s `View::Iso`).
    let view_dir = normalize([1.0, 0.85, 1.0]);
    let world_up = [0.0, 1.0, 0.0];
    let right = normalize(cross(world_up, view_dir));
    let up = normalize(cross(view_dir, right));

    let base = system.field.max_extent() * 0.03;
    let bg = background.fill();
    let bg_rgb = [
        bg[0] as f32 / 255.0,
        bg[1] as f32 / 255.0,
        bg[2] as f32 / 255.0,
    ];

    let count = frame.particles.len().min(DRAW_CAP_3D);
    let mut positions: Vec<f32> = Vec::with_capacity(count * 12 + 24);
    let mut normals: Vec<f32> = Vec::with_capacity(count * 12 + 24);
    let mut colors: Vec<f32> = Vec::with_capacity(count * 12 + 24);
    let mut indices: Vec<u32> = Vec::with_capacity(count * 6 + 24);

    // Eight field corners as degenerate triangles: they pin the framing box.
    let (fw, fh, fd) = (
        system.field.width as f32,
        system.field.height as f32,
        system.field.depth.unwrap_or(0) as f32,
    );
    for cx in [0.0, fw] {
        for cy in [0.0, fh] {
            for cz in [0.0, fd] {
                let base_index = (positions.len() / 3) as u32;
                positions.extend_from_slice(&[cx, cy, cz]);
                normals.extend_from_slice(&view_dir);
                colors.extend_from_slice(&bg_rgb);
                indices.extend_from_slice(&[base_index, base_index, base_index]);
            }
        }
    }

    for particle in frame.particles.iter().take(count) {
        let half = (base * particle.size).max(base * 0.15) * 0.5;
        // Screen-space axes, elongated along the screen velocity when stretched.
        let (axis_a, axis_b) = quad_axes(right, up, particle.velocity, particle.stretch, half);
        let color = [
            bg_rgb[0] + (particle.color[0] - bg_rgb[0]) * particle.opacity,
            bg_rgb[1] + (particle.color[1] - bg_rgb[1]) * particle.opacity,
            bg_rgb[2] + (particle.color[2] - bg_rgb[2]) * particle.opacity,
        ];
        let p = particle.position;
        let corners = [
            sub3(sub3(p, axis_a), axis_b),
            sub3(add3(p, axis_a), axis_b),
            add3(add3(p, axis_a), axis_b),
            add3(sub3(p, axis_a), axis_b),
        ];
        let base_index = (positions.len() / 3) as u32;
        for corner in corners {
            positions.extend_from_slice(&corner);
            normals.extend_from_slice(&view_dir);
            colors.extend_from_slice(&color);
        }
        indices.extend_from_slice(&[
            base_index,
            base_index + 1,
            base_index + 2,
            base_index,
            base_index + 2,
            base_index + 3,
        ]);
    }

    let mesh = MeshView {
        positions: &positions,
        normals: &normals,
        colors: &colors,
        indices: &indices,
    };
    let png = render_png(&[mesh], View::Iso, background, PREVIEW_SIZE)?;
    decode_png_rgba(&png)
}

/// The two half-axes of a particle billboard: the screen `(right, up)` axes, or — when
/// stretched and moving — a major axis along the screen-space velocity scaled by
/// `stretch` and a minor axis across it.
fn quad_axes(
    right: [f32; 3],
    up: [f32; 3],
    velocity: [f32; 3],
    stretch: f32,
    half: f32,
) -> ([f32; 3], [f32; 3]) {
    let vr = dot(velocity, right);
    let vu = dot(velocity, up);
    let speed = (vr * vr + vu * vu).sqrt();
    if stretch <= 1.001 || speed < 1e-3 {
        return (scale3(right, half), scale3(up, half));
    }
    let (dr, du) = (vr / speed, vu / speed);
    // Major axis along the screen velocity; minor axis perpendicular.
    let major = add3(scale3(right, dr), scale3(up, du));
    let minor = add3(scale3(right, -du), scale3(up, dr));
    (scale3(major, half * stretch), scale3(minor, half))
}

/// Decode a straight-RGBA8 PNG back into an [`RgbaFrame`] (the 3D preview PNGs, so they
/// can be packed into the GIF).
fn decode_png_rgba(bytes: &[u8]) -> Result<RgbaFrame, String> {
    let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    let mut reader = decoder
        .read_info()
        .map_err(|err| format!("decoding preview PNG: {err}"))?;
    let mut buf = vec![0u8; reader.output_buffer_size()];
    let info = reader
        .next_frame(&mut buf)
        .map_err(|err| format!("decoding preview PNG frame: {err}"))?;
    buf.truncate(info.buffer_size());
    Ok(RgbaFrame {
        width: info.width,
        height: info.height,
        pixels: buf,
    })
}

/// Pack the preview frames into a GIF: looping (infinite) for a steady-state effect,
/// one-shot (played once) for a decaying one. Frames are composited onto the opaque
/// background first, since a GIF frame has no partial alpha.
fn encode_gif(
    frames: &[RgbaFrame],
    background: PreviewBackground,
    fps: u32,
    looping: bool,
) -> Result<Vec<u8>, String> {
    let first = frames.first().ok_or("no frames to encode")?;
    let width = first.width as u16;
    let height = first.height as u16;
    let bg = {
        let f = background.fill();
        [f[0], f[1], f[2]]
    };
    let delay = (100 / fps.max(1)).max(1) as u16;

    let mut out = Vec::new();
    {
        let mut encoder = gif::Encoder::new(&mut out, width, height, &[])
            .map_err(|err| format!("starting the GIF: {err}"))?;
        if looping {
            encoder
                .set_repeat(gif::Repeat::Infinite)
                .map_err(|err| format!("setting GIF loop: {err}"))?;
        }
        for frame in frames {
            let mut rgba = frame.composite_opaque(bg);
            let mut gif_frame = gif::Frame::from_rgba_speed(width, height, &mut rgba, 10);
            gif_frame.delay = delay;
            encoder
                .write_frame(&gif_frame)
                .map_err(|err| format!("writing a GIF frame: {err}"))?;
        }
    }
    Ok(out)
}

/// Stream a representative preview frame and the `system.json` payload to a watching
/// viewer, best-effort. The header is one JSON line — `{ token, frame, operation,
/// operationCount, length, systemLength }` — followed by exactly `length` PNG bytes
/// and then `systemLength` bytes of `system.json`, letting the viewer simulate the
/// effect live rather than showing only the flat frame. Every error is swallowed: a
/// render must never fail because the live view is unavailable.
fn stream_live(config: &ParticleConfig, frames: &[RgbaFrame], system_json: &[u8], op_count: usize) {
    let Some(live) = &config.live else {
        return;
    };
    // A representative frame: about 40% into the playback, where the effect is active.
    let idx = frames.len().saturating_mul(2) / 5;
    let Some(frame) = frames.get(idx.min(frames.len().saturating_sub(1))) else {
        return;
    };
    let Ok(png) = frame.to_png() else {
        return;
    };
    let _ = try_stream(&live.endpoint, &live.token, &png, system_json, op_count);
}

/// The best-effort TCP write behind [`stream_live`].
fn try_stream(
    endpoint: &str,
    token: &str,
    png: &[u8],
    system_json: &[u8],
    op_count: usize,
) -> std::io::Result<()> {
    use std::io::{Error, ErrorKind};
    const TIMEOUT: Duration = Duration::from_millis(750);
    let addr = endpoint
        .to_socket_addrs()?
        .next()
        .ok_or_else(|| Error::new(ErrorKind::NotFound, "live endpoint resolved to no address"))?;
    let mut stream = TcpStream::connect_timeout(&addr, TIMEOUT)?;
    stream.set_write_timeout(Some(TIMEOUT))?;
    let mut header = serde_json::to_vec(&serde_json::json!({
        "token": token,
        "frame": 0,
        "operation": "render",
        "operationCount": op_count,
        "length": png.len(),
        "systemLength": system_json.len(),
    }))?;
    header.push(b'\n');
    stream.write_all(&header)?;
    stream.write_all(png)?;
    stream.write_all(system_json)?;
    stream.flush()
}

/// An opaque `0..1` RGB as bytes.
fn to_bytes(c: [f32; 3]) -> [u8; 3] {
    [
        (c[0].clamp(0.0, 1.0) * 255.0).round() as u8,
        (c[1].clamp(0.0, 1.0) * 255.0).round() as u8,
        (c[2].clamp(0.0, 1.0) * 255.0).round() as u8,
    ]
}

// --- small vector helpers ---

fn add3(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

fn sub3(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn scale3(a: [f32; 3], s: f32) -> [f32; 3] {
    [a[0] * s, a[1] * s, a[2] * s]
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn normalize(a: [f32; 3]) -> [f32; 3] {
    let len = dot(a, a).sqrt();
    if len > 1e-6 {
        scale3(a, 1.0 / len)
    } else {
        [0.0, 0.0, 1.0]
    }
}
