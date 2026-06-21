//! Shared CLI plumbing for the drawing binaries.
//!
//! Both `draw` (a single sprite) and `draw-sheet` (one separate file per frame)
//! drive the **same** drawing operations through `clap`; this module defines
//! those operation subcommands and the file plumbing they share. The only
//! difference between the binaries is whether an operation targets one canvas or
//! one of many independent per-frame canvases — the operations themselves, and
//! how each one rasterizes, are identical.
//!
//! The operation subcommands' help text is the contract a model reads: an
//! asset-generation case seeds no operations schema, it tells the model to run
//! the binary's `--help`. So the doc comments here mirror [`Operation`]'s and are
//! the authoritative description of the drawing vocabulary.

use std::fs;
use std::path::{Path, PathBuf};

use clap::{Args, Subcommand};
use serde::Deserialize;

use crate::color::Rgba;
use crate::{Background, Canvas, Operation, render};

/// A single drawing operation, expressed as a `clap` subcommand.
///
/// The variants and their arguments mirror [`Operation`] one-for-one;
/// [`OpCommand::into_operation`] is the single place the CLI form and the
/// recorded wire form meet. Coordinates are signed so a shape may be placed
/// partially off-canvas (the off-canvas portion is clipped); sizes and radii are
/// unsigned. Operations **replace** the pixels they touch rather than
/// alpha-compositing, so the recorded log regenerates to an exact, order-only
/// image.
#[derive(Debug, Clone, PartialEq, Eq, Subcommand)]
pub enum OpCommand {
    /// Flood the entire canvas with one color, discarding everything drawn so
    /// far. Useful as a first call to lay down a base.
    FillBackground {
        /// The fill color, as `#rrggbb` or `#rrggbbaa`.
        #[arg(long, value_parser = parse_color)]
        color: Rgba,
    },
    /// Set a single pixel.
    SetPixel {
        /// Column (0 at the left).
        #[arg(long)]
        x: i64,
        /// Row (0 at the top).
        #[arg(long)]
        y: i64,
        /// The pixel color, as `#rrggbb` or `#rrggbbaa`.
        #[arg(long, value_parser = parse_color)]
        color: Rgba,
    },
    /// Fill an axis-aligned rectangle. `(x, y)` is the top-left corner.
    FillRect {
        /// Left edge column.
        #[arg(long)]
        x: i64,
        /// Top edge row.
        #[arg(long)]
        y: i64,
        /// Width in pixels.
        #[arg(long)]
        width: u32,
        /// Height in pixels.
        #[arg(long)]
        height: u32,
        /// The fill color, as `#rrggbb` or `#rrggbbaa`.
        #[arg(long, value_parser = parse_color)]
        color: Rgba,
    },
    /// Draw the 1px outline of an axis-aligned rectangle.
    StrokeRect {
        /// Left edge column.
        #[arg(long)]
        x: i64,
        /// Top edge row.
        #[arg(long)]
        y: i64,
        /// Width in pixels.
        #[arg(long)]
        width: u32,
        /// Height in pixels.
        #[arg(long)]
        height: u32,
        /// The outline color, as `#rrggbb` or `#rrggbbaa`.
        #[arg(long, value_parser = parse_color)]
        color: Rgba,
    },
    /// Draw a 1px line between two points (inclusive of both endpoints).
    Line {
        /// Start column.
        #[arg(long)]
        x0: i64,
        /// Start row.
        #[arg(long)]
        y0: i64,
        /// End column.
        #[arg(long)]
        x1: i64,
        /// End row.
        #[arg(long)]
        y1: i64,
        /// The line color, as `#rrggbb` or `#rrggbbaa`.
        #[arg(long, value_parser = parse_color)]
        color: Rgba,
    },
    /// Fill a disc centered at `(cx, cy)` with radius `r`.
    FillCircle {
        /// Center column.
        #[arg(long)]
        cx: i64,
        /// Center row.
        #[arg(long)]
        cy: i64,
        /// Radius in pixels.
        #[arg(long)]
        r: u32,
        /// The fill color, as `#rrggbb` or `#rrggbbaa`.
        #[arg(long, value_parser = parse_color)]
        color: Rgba,
    },
    /// Draw the 1px outline of a circle centered at `(cx, cy)` with radius `r`.
    StrokeCircle {
        /// Center column.
        #[arg(long)]
        cx: i64,
        /// Center row.
        #[arg(long)]
        cy: i64,
        /// Radius in pixels.
        #[arg(long)]
        r: u32,
        /// The outline color, as `#rrggbb` or `#rrggbbaa`.
        #[arg(long, value_parser = parse_color)]
        color: Rgba,
    },
    /// Replace the contiguous, 4-connected region of pixels sharing the start
    /// pixel's current color with a new color. No-op if the start is off-canvas
    /// or already the target color.
    FloodFill {
        /// Seed column.
        #[arg(long)]
        x: i64,
        /// Seed row.
        #[arg(long)]
        y: i64,
        /// The replacement color, as `#rrggbb` or `#rrggbbaa`.
        #[arg(long, value_parser = parse_color)]
        color: Rgba,
    },
    /// Mirror the columns left of `axis_x` onto the columns to its right,
    /// reflecting across the vertical line between column `axis_x - 1` and column
    /// `axis_x`. The single highest-leverage op for a left/right-symmetric sprite.
    MirrorHorizontal {
        /// The mirror axis: columns `0..axis_x` are copied onto `axis_x..`.
        #[arg(long)]
        axis_x: u32,
    },
}

impl OpCommand {
    /// Convert the parsed subcommand into the [`Operation`] recorded in the
    /// action log and replayed by the renderer.
    pub fn into_operation(self) -> Operation {
        match self {
            OpCommand::FillBackground { color } => Operation::FillBackground { color },
            OpCommand::SetPixel { x, y, color } => Operation::SetPixel { x, y, color },
            OpCommand::FillRect {
                x,
                y,
                width,
                height,
                color,
            } => Operation::FillRect {
                x,
                y,
                width,
                height,
                color,
            },
            OpCommand::StrokeRect {
                x,
                y,
                width,
                height,
                color,
            } => Operation::StrokeRect {
                x,
                y,
                width,
                height,
                color,
            },
            OpCommand::Line {
                x0,
                y0,
                x1,
                y1,
                color,
            } => Operation::Line {
                x0,
                y0,
                x1,
                y1,
                color,
            },
            OpCommand::FillCircle { cx, cy, r, color } => {
                Operation::FillCircle { cx, cy, r, color }
            }
            OpCommand::StrokeCircle { cx, cy, r, color } => {
                Operation::StrokeCircle { cx, cy, r, color }
            }
            OpCommand::FloodFill { x, y, color } => Operation::FloodFill { x, y, color },
            OpCommand::MirrorHorizontal { axis_x } => Operation::MirrorHorizontal { axis_x },
        }
    }

    /// The wire tag of the operation this subcommand produces, for the
    /// human-readable confirmation line the binaries print.
    pub fn name(&self) -> &'static str {
        match self {
            OpCommand::FillBackground { .. } => "fill_background",
            OpCommand::SetPixel { .. } => "set_pixel",
            OpCommand::FillRect { .. } => "fill_rect",
            OpCommand::StrokeRect { .. } => "stroke_rect",
            OpCommand::Line { .. } => "line",
            OpCommand::FillCircle { .. } => "fill_circle",
            OpCommand::StrokeCircle { .. } => "stroke_circle",
            OpCommand::FloodFill { .. } => "flood_fill",
            OpCommand::MirrorHorizontal { .. } => "mirror_horizontal",
        }
    }
}

/// Parse a `--color` value (`#rrggbb` or `#rrggbbaa`) into an [`Rgba`], mapping a
/// parse error to the string `clap` shows the user.
fn parse_color(value: &str) -> Result<Rgba, String> {
    Rgba::parse_hex(value).map_err(|err| err.to_string())
}

/// The shared `render` subcommand: regenerate an image from an action log without
/// modifying it — the same rendering `crates/core` performs to produce the scored
/// image. Identical for both binaries; it operates on one log and one output and
/// needs no canvas config, so authors can render any log (including a per-frame
/// target log) at an explicit size.
#[derive(Debug, Args)]
pub struct RenderArgs {
    /// Path to the action log JSON (an array of operations).
    #[arg(long)]
    pub actions: PathBuf,
    /// Where to write the rendered PNG.
    #[arg(long)]
    pub out: PathBuf,
    /// Canvas width in pixels.
    #[arg(long)]
    pub width: u32,
    /// Canvas height in pixels.
    #[arg(long)]
    pub height: u32,
    /// Initial background: `transparent` or a hex color.
    #[arg(long, default_value = "transparent")]
    pub background: String,
}

impl RenderArgs {
    /// Render the action log to the output PNG at the requested size.
    pub fn run(&self) -> Result<(), String> {
        let background = Background::parse(&self.background)
            .map_err(|err| format!("invalid background: {err}"))?;
        let canvas = Canvas {
            width: self.width,
            height: self.height,
            background,
        };
        let operations = read_actions(&self.actions)?;
        render(&canvas, &operations)
            .encode_png(&self.out)
            .map_err(|err| format!("writing {}: {err}", self.out.display()))
    }
}

/// The canvas configuration the orchestrator seeds next to a single-sprite run so
/// `draw`'s operations and `init` need no canvas flags.
#[derive(Debug, Deserialize)]
pub struct Config {
    /// Canvas width in pixels.
    pub width: u32,
    /// Canvas height in pixels.
    pub height: u32,
    /// Initial canvas state: `transparent` or a hex color.
    #[serde(default = "default_background")]
    pub background: String,
    /// Run-workspace-relative path of the recorded action log.
    #[serde(default = "default_actions")]
    pub actions: PathBuf,
    /// Run-workspace-relative path the current image is re-rendered to.
    #[serde(default = "default_preview")]
    pub preview: PathBuf,
    /// The live-preview endpoint, when a viewer is observing this run. Absent for
    /// an unobserved run (a plain `tcab run` or `tcab validate`).
    #[serde(default)]
    pub live: Option<LiveConfig>,
}

/// The live-preview endpoint seeded next to a run that a viewer is observing.
///
/// When present, the drawing binary streams each re-rendered frame here so the
/// viewer can watch the sprite take shape between operations. It is absent for an
/// unobserved run, and streaming is always best-effort: a drawing operation never
/// fails because the live view is slow or unreachable, since the recorded action
/// log — not these frames — is the run's authoritative output.
#[derive(Debug, Clone, Deserialize)]
pub struct LiveConfig {
    /// The `host:port` the binary connects to. This is the run host, reachable
    /// from inside the run container as `host.docker.internal`.
    pub endpoint: String,
    /// An opaque per-run token echoed with each update, so the listener accepts
    /// only the frames belonging to its own run.
    pub token: String,
}

impl Config {
    /// The canvas described by this config.
    pub fn canvas(&self) -> Result<Canvas, String> {
        canvas(self.width, self.height, &self.background)
    }
}

/// The canvas configuration the orchestrator seeds next to a sprite-sheet run.
///
/// A sheet's frames are **completely separate files**: each declared frame has
/// its own action log and preview, derived from the `{frame}` templates below by
/// substituting the frame index. The canvas dimensions describe **one frame** (a
/// sheet has no whole-sheet image).
#[derive(Debug, Deserialize)]
pub struct SheetConfig {
    /// Frame width in pixels.
    pub width: u32,
    /// Frame height in pixels.
    pub height: u32,
    /// Initial frame state: `transparent` or a hex color.
    #[serde(default = "default_background")]
    pub background: String,
    /// The frame indices this sheet declares. `init` initializes each; an
    /// operation must target one of these.
    pub frames: Vec<u32>,
    /// Template for a frame's action-log path, with `{frame}` replaced by the
    /// frame index (for example `frames/{frame}.actions.json`).
    #[serde(default = "default_sheet_actions")]
    pub actions: String,
    /// Template for a frame's preview-image path, with `{frame}` replaced by the
    /// frame index (for example `frames/{frame}.png`).
    #[serde(default = "default_sheet_preview")]
    pub preview: String,
    /// The live-preview endpoint, when a viewer is observing this run. See
    /// [`Config::live`].
    #[serde(default)]
    pub live: Option<LiveConfig>,
}

impl SheetConfig {
    /// The canvas described by this config (the size of one frame).
    pub fn canvas(&self) -> Result<Canvas, String> {
        canvas(self.width, self.height, &self.background)
    }

    /// The action-log path for `frame`.
    pub fn actions_for(&self, frame: u32) -> PathBuf {
        PathBuf::from(self.actions.replace("{frame}", &frame.to_string()))
    }

    /// The preview-image path for `frame`.
    pub fn preview_for(&self, frame: u32) -> PathBuf {
        PathBuf::from(self.preview.replace("{frame}", &frame.to_string()))
    }

    /// Whether `frame` is one of the declared frames.
    pub fn has_frame(&self, frame: u32) -> bool {
        self.frames.contains(&frame)
    }
}

fn canvas(width: u32, height: u32, background: &str) -> Result<Canvas, String> {
    let background =
        Background::parse(background).map_err(|err| format!("invalid background: {err}"))?;
    Ok(Canvas {
        width,
        height,
        background,
    })
}

fn default_background() -> String {
    "transparent".to_string()
}

fn default_actions() -> PathBuf {
    PathBuf::from("actions.json")
}

fn default_preview() -> PathBuf {
    PathBuf::from("canvas.png")
}

fn default_sheet_actions() -> String {
    "frames/{frame}.actions.json".to_string()
}

fn default_sheet_preview() -> String {
    "frames/{frame}.png".to_string()
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
    canvas: &Canvas,
    operations: &[Operation],
    preview: &Path,
) -> Result<(), String> {
    ensure_parent(preview)?;
    render(canvas, operations)
        .encode_png(preview)
        .map_err(|err| format!("writing preview {}: {err}", preview.display()))
}

/// Initialize one canvas: write an empty action log and render its blank preview,
/// so the surface starts from a known, empty state.
pub fn init_canvas(canvas: &Canvas, actions: &Path, preview: &Path) -> Result<(), String> {
    write_actions(actions, &[])?;
    render_preview(canvas, &[], preview)
}

/// Append one operation to `actions` and re-render `preview` from the **whole**
/// log, keeping the recorded log the single source of truth and the preview a
/// faithful reflection of it. Returns the new operation count and the PNG bytes
/// the preview was written from, so a caller streaming a live view can forward the
/// exact rendered frame without re-reading it from disk.
pub fn apply(
    canvas: &Canvas,
    actions: &Path,
    preview: &Path,
    operation: Operation,
) -> Result<(usize, Vec<u8>), String> {
    let mut operations = read_actions(actions)?;
    operations.push(operation);
    write_actions(actions, &operations)?;
    let bytes = render(canvas, &operations).to_png_bytes();
    ensure_parent(preview)?;
    fs::write(preview, &bytes)
        .map_err(|err| format!("writing preview {}: {err}", preview.display()))?;
    Ok((operations.len(), bytes))
}

/// Stream a just-rendered frame to the run's live-preview endpoint, best-effort.
///
/// A drawing operation must never fail because the live view is unavailable, so
/// every error here is swallowed — the recorded action log remains the run's
/// authoritative output regardless of whether a frame reaches a viewer. The wire
/// form is one JSON header line (`{ token, frame, operation, operationCount,
/// length }`) followed by exactly `length` raw PNG bytes; the listener validates
/// the token before accepting the frame.
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
    // the drawing operation that triggered the update.
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
