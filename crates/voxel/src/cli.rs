//! Shared CLI plumbing for the voxel binaries.
//!
//! Both `voxel` (a single static model) and `voxel-anim` (a rigged model, one
//! separate file per part) drive the **same** sculpting operations through `clap`;
//! this module defines those operation subcommands and the file plumbing they
//! share. The only difference between the binaries is whether an operation targets
//! one volume or one of many independent per-part volumes — the operations
//! themselves, and how each one applies, are identical.
//!
//! The operation subcommands' help text is the contract a model reads: an
//! asset-generation case seeds no operations schema, it tells the model to run the
//! binary's `--help`. So the doc comments here mirror [`Operation`]'s and are the
//! authoritative description of the sculpting vocabulary.

use std::fs;
use std::path::{Path, PathBuf};

use clap::{Args, Subcommand};
use serde::Deserialize;

use crate::color::Rgb;
use crate::{
    Axis, Camera, Dims, Operation, PreviewBackground, SceneView, VoxelSet, rasterize,
    rasterize_scene, render,
};

/// A single sculpting operation, expressed as a `clap` subcommand.
///
/// The variants and their arguments mirror [`Operation`] one-for-one;
/// [`OpCommand::into_operation`] is the single place the CLI form and the recorded
/// wire form meet. Coordinates are signed so a shape may be placed partially
/// outside the volume (the outside portion is clipped); sizes and radii are
/// unsigned. Voxels are opaque and replace whatever they touch, so the recorded log
/// regenerates to an exact, order-only volume.
#[derive(Debug, Clone, PartialEq, Eq, Subcommand)]
pub enum OpCommand {
    /// Set a single voxel.
    SetVoxel {
        /// Position along x (0 at the left).
        #[arg(long)]
        x: i64,
        /// Position along y (0 at the bottom, up is positive).
        #[arg(long)]
        y: i64,
        /// Position along z (0 at the front).
        #[arg(long)]
        z: i64,
        /// The voxel color, as `#rrggbb`.
        #[arg(long, value_parser = parse_color)]
        color: Rgb,
    },
    /// Fill an axis-aligned box. `(x, y, z)` is the minimum corner.
    FillBox {
        /// Minimum-corner x.
        #[arg(long)]
        x: i64,
        /// Minimum-corner y.
        #[arg(long)]
        y: i64,
        /// Minimum-corner z.
        #[arg(long)]
        z: i64,
        /// Extent along x, in voxels.
        #[arg(long)]
        width: u32,
        /// Extent along y, in voxels.
        #[arg(long)]
        height: u32,
        /// Extent along z, in voxels.
        #[arg(long)]
        depth: u32,
        /// The fill color, as `#rrggbb`.
        #[arg(long, value_parser = parse_color)]
        color: Rgb,
    },
    /// Fill only the shell (the 12 edges) of an axis-aligned box, leaving its
    /// interior and faces empty — the 3D analog of a rectangle outline.
    StrokeBox {
        /// Minimum-corner x.
        #[arg(long)]
        x: i64,
        /// Minimum-corner y.
        #[arg(long)]
        y: i64,
        /// Minimum-corner z.
        #[arg(long)]
        z: i64,
        /// Extent along x, in voxels.
        #[arg(long)]
        width: u32,
        /// Extent along y, in voxels.
        #[arg(long)]
        height: u32,
        /// Extent along z, in voxels.
        #[arg(long)]
        depth: u32,
        /// The edge color, as `#rrggbb`.
        #[arg(long, value_parser = parse_color)]
        color: Rgb,
    },
    /// Fill a solid ball centered at `(cx, cy, cz)` with radius `r`.
    FillSphere {
        /// Center x.
        #[arg(long)]
        cx: i64,
        /// Center y.
        #[arg(long)]
        cy: i64,
        /// Center z.
        #[arg(long)]
        cz: i64,
        /// Radius in voxels.
        #[arg(long)]
        r: u32,
        /// The fill color, as `#rrggbb`.
        #[arg(long, value_parser = parse_color)]
        color: Rgb,
    },
    /// Draw a 1-voxel-thick line between two points (inclusive of both endpoints).
    Line {
        /// Start x.
        #[arg(long)]
        x0: i64,
        /// Start y.
        #[arg(long)]
        y0: i64,
        /// Start z.
        #[arg(long)]
        z0: i64,
        /// End x.
        #[arg(long)]
        x1: i64,
        /// End y.
        #[arg(long)]
        y1: i64,
        /// End z.
        #[arg(long)]
        z1: i64,
        /// The line color, as `#rrggbb`.
        #[arg(long, value_parser = parse_color)]
        color: Rgb,
    },
    /// Mirror the voxels on the low side of a plane onto the high side, reflecting
    /// across the plane between slice `at - 1` and slice `at`. The single
    /// highest-leverage op for a symmetric model.
    Mirror {
        /// The plane's normal axis (`x`, `y`, or `z`).
        #[arg(long, value_enum)]
        plane: Axis,
        /// The mirror position along `plane`: slices `0..at` are copied onto `at..`.
        #[arg(long)]
        at: u32,
    },
    /// Clear a single voxel, emptying its cell.
    ClearVoxel {
        /// Position along x.
        #[arg(long)]
        x: i64,
        /// Position along y.
        #[arg(long)]
        y: i64,
        /// Position along z.
        #[arg(long)]
        z: i64,
    },
    /// Clear an axis-aligned box, emptying every cell it covers. `(x, y, z)` is the
    /// minimum corner.
    ClearBox {
        /// Minimum-corner x.
        #[arg(long)]
        x: i64,
        /// Minimum-corner y.
        #[arg(long)]
        y: i64,
        /// Minimum-corner z.
        #[arg(long)]
        z: i64,
        /// Extent along x, in voxels.
        #[arg(long)]
        width: u32,
        /// Extent along y, in voxels.
        #[arg(long)]
        height: u32,
        /// Extent along z, in voxels.
        #[arg(long)]
        depth: u32,
    },
}

impl OpCommand {
    /// Convert the parsed subcommand into the [`Operation`] recorded in the action
    /// log and replayed by the renderer.
    pub fn into_operation(self) -> Operation {
        match self {
            OpCommand::SetVoxel { x, y, z, color } => Operation::SetVoxel { x, y, z, color },
            OpCommand::FillBox {
                x,
                y,
                z,
                width,
                height,
                depth,
                color,
            } => Operation::FillBox {
                x,
                y,
                z,
                width,
                height,
                depth,
                color,
            },
            OpCommand::StrokeBox {
                x,
                y,
                z,
                width,
                height,
                depth,
                color,
            } => Operation::StrokeBox {
                x,
                y,
                z,
                width,
                height,
                depth,
                color,
            },
            OpCommand::FillSphere {
                cx,
                cy,
                cz,
                r,
                color,
            } => Operation::FillSphere {
                cx,
                cy,
                cz,
                r,
                color,
            },
            OpCommand::Line {
                x0,
                y0,
                z0,
                x1,
                y1,
                z1,
                color,
            } => Operation::Line {
                x0,
                y0,
                z0,
                x1,
                y1,
                z1,
                color,
            },
            OpCommand::Mirror { plane, at } => Operation::Mirror { plane, at },
            OpCommand::ClearVoxel { x, y, z } => Operation::ClearVoxel { x, y, z },
            OpCommand::ClearBox {
                x,
                y,
                z,
                width,
                height,
                depth,
            } => Operation::ClearBox {
                x,
                y,
                z,
                width,
                height,
                depth,
            },
        }
    }

    /// The wire tag of the operation this subcommand produces, for the
    /// human-readable confirmation line the binaries print.
    pub fn name(&self) -> &'static str {
        match self {
            OpCommand::SetVoxel { .. } => "set_voxel",
            OpCommand::FillBox { .. } => "fill_box",
            OpCommand::StrokeBox { .. } => "stroke_box",
            OpCommand::FillSphere { .. } => "fill_sphere",
            OpCommand::Line { .. } => "line",
            OpCommand::Mirror { .. } => "mirror",
            OpCommand::ClearVoxel { .. } => "clear_voxel",
            OpCommand::ClearBox { .. } => "clear_box",
        }
    }
}

/// Parse a `--color` value (`#rrggbb`) into an [`Rgb`], mapping a parse error to
/// the string `clap` shows the user.
fn parse_color(value: &str) -> Result<Rgb, String> {
    Rgb::parse_hex(value).map_err(|err| err.to_string())
}

/// The shared `render` subcommand: regenerate a preview from an action log without
/// modifying it — the same rendering `crates/core` performs to produce the scored
/// image. Identical for both binaries; it operates on one log and one output and
/// needs no config, so authors can render any log (including a per-part target log)
/// at an explicit size.
#[derive(Debug, Args)]
pub struct RenderArgs {
    /// Path to the action log JSON (an array of operations).
    #[arg(long)]
    pub actions: PathBuf,
    /// Where to write the rendered preview PNG.
    #[arg(long)]
    pub out: PathBuf,
    /// Volume width in voxels.
    #[arg(long)]
    pub width: u32,
    /// Volume height in voxels.
    #[arg(long)]
    pub height: u32,
    /// Volume depth in voxels.
    #[arg(long)]
    pub depth: u32,
    /// Preview clear color: `transparent` or a hex color.
    #[arg(long, default_value = "transparent")]
    pub background: String,
}

impl RenderArgs {
    /// Render the action log to the output PNG at the requested size.
    pub fn run(&self) -> Result<(), String> {
        let background = PreviewBackground::parse(&self.background)
            .map_err(|err| format!("invalid background: {err}"))?;
        let dims = Dims {
            width: self.width,
            height: self.height,
            depth: self.depth,
        };
        let operations = read_actions(&self.actions)?;
        let set = render(&dims, &operations);
        let bytes = rasterize(&set, &Camera::PREVIEW, background);
        ensure_parent(&self.out)?;
        fs::write(&self.out, &bytes).map_err(|err| format!("writing {}: {err}", self.out.display()))
    }
}

/// The volume configuration the orchestrator seeds next to a single static-model
/// run so `voxel`'s operations and `init` need no volume flags.
#[derive(Debug, Deserialize)]
pub struct Config {
    /// Volume width in voxels.
    pub width: u32,
    /// Volume height in voxels.
    pub height: u32,
    /// Volume depth in voxels.
    pub depth: u32,
    /// Preview clear color: `transparent` or a hex color.
    #[serde(default = "default_background")]
    pub background: String,
    /// Run-workspace-relative path of the recorded action log.
    #[serde(default = "default_actions")]
    pub actions: PathBuf,
    /// Run-workspace-relative path the current preview is re-rendered to.
    #[serde(default = "default_preview")]
    pub preview: PathBuf,
    /// The live-preview endpoint, when a viewer is observing this run. Absent for
    /// an unobserved run (a plain `tcab run` or `tcab validate`).
    #[serde(default)]
    pub live: Option<LiveConfig>,
}

/// The live-preview endpoint seeded next to a run that a viewer is observing.
///
/// When present, the sculpting binary streams each re-rendered preview here so the
/// viewer can watch the model take shape between operations. It is absent for an
/// unobserved run, and streaming is always best-effort: a sculpting operation never
/// fails because the live view is slow or unreachable, since the recorded action
/// log — not these frames — is the run's authoritative output.
#[derive(Debug, Clone, Deserialize)]
pub struct LiveConfig {
    /// The `host:port` the binary connects to. This is the run host, reachable from
    /// inside the run container as `host.docker.internal`.
    pub endpoint: String,
    /// An opaque per-run token echoed with each update, so the listener accepts only
    /// the frames belonging to its own run.
    pub token: String,
}

impl Config {
    /// The volume described by this config.
    pub fn dims(&self) -> Dims {
        Dims {
            width: self.width,
            height: self.height,
            depth: self.depth,
        }
    }

    /// The parsed preview background.
    pub fn background(&self) -> Result<PreviewBackground, String> {
        PreviewBackground::parse(&self.background)
            .map_err(|err| format!("invalid background: {err}"))
    }
}

/// The rig configuration the orchestrator seeds next to an animated-model run.
///
/// A rig's parts are **completely separate files**: each declared part has its own
/// action log and preview, derived from the `{part}` templates below by
/// substituting the part name. The volume dimensions describe the shared coordinate
/// space all parts are sculpted in. The rig's structure (parts + joints) lives in
/// [`Self::rig`] (`rig.json`), pre-seeded from the manifest's required contract.
#[derive(Debug, Deserialize)]
pub struct AnimConfig {
    /// Volume width in voxels.
    pub width: u32,
    /// Volume height in voxels.
    pub height: u32,
    /// Volume depth in voxels.
    pub depth: u32,
    /// Preview clear color: `transparent` or a hex color.
    #[serde(default = "default_background")]
    pub background: String,
    /// The part names this rig declares. `init` initializes each; an operation must
    /// target one of these.
    pub parts: Vec<String>,
    /// Template for a part's action-log path, with `{part}` replaced by the part
    /// name (for example `parts/{part}.actions.json`).
    #[serde(default = "default_anim_actions")]
    pub actions: String,
    /// Template for a part's preview-image path, with `{part}` replaced by the part
    /// name (for example `parts/{part}.png`).
    #[serde(default = "default_anim_preview")]
    pub preview: String,
    /// Template for the **assembled-scene** preview path, with `{view}` replaced by
    /// the view name (`iso`, `front`, `side`, `top`). The whole rig composed at rest
    /// and re-rendered after every operation, so the model can check how its
    /// separately sculpted parts fit together on the finished model. Not a scored
    /// artifact (the per-part previews are); defaults to `scene/{view}.png`.
    #[serde(default = "default_anim_scene")]
    pub scene: String,
    /// Run-workspace-relative path of the rig structure (`rig.json`).
    #[serde(default = "default_rig")]
    pub rig: PathBuf,
    /// The live-preview endpoint, when a viewer is observing this run. See
    /// [`Config::live`].
    #[serde(default)]
    pub live: Option<LiveConfig>,
}

impl AnimConfig {
    /// The volume described by this config (the shared space all parts sculpt in).
    pub fn dims(&self) -> Dims {
        Dims {
            width: self.width,
            height: self.height,
            depth: self.depth,
        }
    }

    /// The parsed preview background.
    pub fn background(&self) -> Result<PreviewBackground, String> {
        PreviewBackground::parse(&self.background)
            .map_err(|err| format!("invalid background: {err}"))
    }

    /// The action-log path for `part`.
    pub fn actions_for(&self, part: &str) -> PathBuf {
        PathBuf::from(self.actions.replace("{part}", part))
    }

    /// The preview-image path for `part`.
    pub fn preview_for(&self, part: &str) -> PathBuf {
        PathBuf::from(self.preview.replace("{part}", part))
    }

    /// The assembled-scene preview path for `view` (`iso`, `front`, `side`, `top`).
    pub fn scene_for(&self, view: &str) -> PathBuf {
        PathBuf::from(self.scene.replace("{view}", view))
    }

    /// Whether `part` is one of the declared parts.
    pub fn has_part(&self, part: &str) -> bool {
        self.parts.iter().any(|p| p == part)
    }
}

fn default_background() -> String {
    "transparent".to_string()
}

fn default_actions() -> PathBuf {
    PathBuf::from("actions.json")
}

fn default_preview() -> PathBuf {
    PathBuf::from("model.png")
}

fn default_anim_actions() -> String {
    "parts/{part}.actions.json".to_string()
}

fn default_anim_preview() -> String {
    "parts/{part}.png".to_string()
}

fn default_anim_scene() -> String {
    "scene/{view}.png".to_string()
}

fn default_rig() -> PathBuf {
    PathBuf::from("rig.json")
}

/// Read a JSON config file into `T`.
pub fn read_config<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let raw =
        fs::read_to_string(path).map_err(|err| format!("reading {}: {err}", path.display()))?;
    serde_json::from_str(&raw).map_err(|err| format!("invalid config {}: {err}", path.display()))
}

/// Read the action log, treating an absent file as an empty log so the first
/// operation of a run does not need a separate `init`.
pub fn read_actions(path: &Path) -> Result<Vec<Operation>, String> {
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|err| format!("invalid action log {}: {err}", path.display())),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(err) => Err(format!("reading {}: {err}", path.display())),
    }
}

/// Write the action log as pretty JSON, creating parent directories as needed.
pub fn write_actions(path: &Path, operations: &[Operation]) -> Result<(), String> {
    ensure_parent(path)?;
    let mut json = serde_json::to_string_pretty(operations)
        .map_err(|err| format!("serializing action log: {err}"))?;
    json.push('\n');
    fs::write(path, json).map_err(|err| format!("writing {}: {err}", path.display()))
}

/// Re-render the whole log to `preview`, creating parent directories as needed.
pub fn render_preview(
    dims: &Dims,
    background: PreviewBackground,
    operations: &[Operation],
    preview: &Path,
) -> Result<(), String> {
    ensure_parent(preview)?;
    let set = render(dims, operations);
    let bytes = rasterize(&set, &Camera::PREVIEW, background);
    fs::write(preview, &bytes)
        .map_err(|err| format!("writing preview {}: {err}", preview.display()))
}

/// Initialize one target: write an empty action log and render its blank preview
/// (an empty volume), so the surface starts from a known, empty state.
pub fn init_target(
    dims: &Dims,
    background: PreviewBackground,
    actions: &Path,
    preview: &Path,
) -> Result<(), String> {
    write_actions(actions, &[])?;
    render_preview(dims, background, &[], preview)
}

/// Append one operation to `actions` and re-render `preview` from the **whole** log,
/// keeping the recorded log the single source of truth and the preview a faithful
/// reflection of it. Returns the new operation count and the PNG bytes the preview
/// was written from, so a caller streaming a live view can forward the exact
/// rendered frame without re-reading it from disk.
pub fn apply(
    dims: &Dims,
    background: PreviewBackground,
    actions: &Path,
    preview: &Path,
    operation: Operation,
) -> Result<(usize, Vec<u8>), String> {
    let mut operations = read_actions(actions)?;
    operations.push(operation);
    write_actions(actions, &operations)?;
    let set = render(dims, &operations);
    let bytes = rasterize(&set, &Camera::PREVIEW, background);
    ensure_parent(preview)?;
    fs::write(preview, &bytes)
        .map_err(|err| format!("writing preview {}: {err}", preview.display()))?;
    Ok((operations.len(), bytes))
}

/// Rasterize an arbitrary voxel set to PNG bytes with the preview camera and the
/// given background — the exact rendering `apply`/`render_preview` and core's
/// validator produce, exposed for callers holding a set directly.
pub fn preview_bytes(set: &VoxelSet, background: PreviewBackground) -> Vec<u8> {
    rasterize(set, &Camera::PREVIEW, background)
}

/// The assembled-scene views the animated tool renders, as `(name, view)` pairs in
/// output order. The name substitutes the `{view}` token of `AnimConfig::scene`.
pub const SCENE_VIEWS: [(&str, SceneView); 4] = [
    ("iso", SceneView::Iso),
    ("front", SceneView::Front),
    ("side", SceneView::Side),
    ("top", SceneView::Top),
];

/// Compose every part's action log into one assembled volume, posed at **rest**.
///
/// Each part is rendered from its own log in the shared volume's coordinates (where
/// the model sculpted it) and unioned in `part_logs` order, so a later part's
/// voxels overpaint an earlier part's where they coincide. At rest the rig applies
/// no per-part transform (parts are sculpted in place), so this union *is* the
/// assembled model; joint motion is not applied here (rotating voxels in the grid
/// is lossy), which for the required rest pose is exact.
pub fn compose_scene(dims: &Dims, part_logs: &[Vec<Operation>]) -> VoxelSet {
    let mut set = VoxelSet::empty(*dims);
    for operations in part_logs {
        let part = render(dims, operations);
        for (cell, part_cell) in set.cells.iter_mut().zip(part.cells.iter()) {
            if let Some(color) = part_cell {
                *cell = Some(*color);
            }
        }
    }
    set
}

/// Re-render the assembled scene from the current per-part logs: compose every
/// declared part and write one PNG per [`SCENE_VIEWS`] entry to the config's
/// `scene` path. Returns the composed volume so a caller can reuse it. A scene view
/// is a non-scored aid — the per-part previews remain the scored artifacts.
pub fn render_scene(config: &AnimConfig) -> Result<VoxelSet, String> {
    let dims = config.dims();
    let background = config.background()?;
    let mut logs = Vec::with_capacity(config.parts.len());
    for part in &config.parts {
        logs.push(read_actions(&config.actions_for(part))?);
    }
    let set = compose_scene(&dims, &logs);
    for (name, view) in SCENE_VIEWS {
        let path = config.scene_for(name);
        ensure_parent(&path)?;
        let bytes = rasterize_scene(&set, view, background);
        fs::write(&path, &bytes)
            .map_err(|err| format!("writing scene {}: {err}", path.display()))?;
    }
    Ok(set)
}

/// Stream a just-rendered frame to the run's live-preview endpoint, best-effort.
///
/// A sculpting operation must never fail because the live view is unavailable, so
/// every error here is swallowed — the recorded action log remains the run's
/// authoritative output regardless of whether a frame reaches a viewer. The wire
/// form is one JSON header line (`{ token, frame, operation, operationCount,
/// length }`) followed by exactly `length` raw PNG bytes; the listener validates
/// the token before accepting the frame. `frame` carries the part index (0 for a
/// single static model).
pub fn send_live_preview(
    live: &LiveConfig,
    frame: u32,
    operation: &str,
    operation_count: usize,
    image: &[u8],
) {
    let _ = try_send_live_preview(live, frame, operation, operation_count, image);
}

fn try_send_live_preview(
    live: &LiveConfig,
    frame: u32,
    operation: &str,
    operation_count: usize,
    image: &[u8],
) -> std::io::Result<()> {
    use std::io::{Error, ErrorKind, Write};
    use std::net::{TcpStream, ToSocketAddrs};
    use std::time::Duration;

    // A short cap on every step so a stalled or absent listener can never hold up
    // the sculpting operation that triggered the update.
    const TIMEOUT: Duration = Duration::from_millis(750);
    let addr =
        live.endpoint.to_socket_addrs()?.next().ok_or_else(|| {
            Error::new(ErrorKind::NotFound, "live endpoint resolved to no address")
        })?;
    let mut stream = TcpStream::connect_timeout(&addr, TIMEOUT)?;
    stream.set_write_timeout(Some(TIMEOUT))?;
    let mut header = serde_json::to_vec(&serde_json::json!({
        "token": live.token,
        "frame": frame,
        "operation": operation,
        "operationCount": operation_count,
        "length": image.len(),
    }))?;
    header.push(b'\n');
    stream.write_all(&header)?;
    stream.write_all(image)?;
    stream.flush()
}

fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        fs::create_dir_all(parent)
            .map_err(|err| format!("creating {}: {err}", parent.display()))?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "cli.test.rs"]
mod tests;
