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
//! the binary's `--help`. So the doc comments in [`OpCommand`] and
//! [`LayerCommand`] mirror the library types' and are the authoritative
//! description of the drawing vocabulary.
//!
//! The subcommands themselves live in sibling files — [`OpCommand`] in
//! `cli.ops.rs`, the layer and animation commands in `cli.layers.rs` — so no one
//! file carries the whole surface. This module holds the config the binaries read
//! and the file plumbing they share.

use std::fs;
use std::path::{Path, PathBuf};

use clap::Args;
use serde::Deserialize;

use crate::layer::Document;
use crate::{Background, Canvas, Operation, render_frame};

#[path = "cli.layers.rs"]
pub mod layers;
#[path = "cli.ops.rs"]
mod ops_command;

pub use layers::{AnimateArgs, ClearKeyframesArgs, Handle, InterpArg, LayerCommand, PropertyArg};
pub use ops_command::OpCommand;

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
    /// Path to the layer document (`layers.json`) to composite over the log.
    /// Omitted, only the log is rendered — which is the whole image only if the run
    /// registered no layer.
    #[arg(long)]
    pub layer_document: Option<PathBuf>,
}

impl RenderArgs {
    /// Render the action log — with the layer document composited over it, when one
    /// is given — to the output PNG at the requested size, resolving any keyframes
    /// at `frame`.
    ///
    /// The document is opt-in rather than assumed because this subcommand takes
    /// explicit paths instead of reading the seeded config, so it has nothing to
    /// derive a document path from. Passing it reproduces exactly what the run's
    /// preview and the post-run regeneration produce; omitting it renders the log
    /// alone, which is what this subcommand did before layers existed.
    pub fn run(&self, frame: u32) -> Result<(), String> {
        let background = Background::parse(&self.background)
            .map_err(|err| format!("invalid background: {err}"))?;
        let canvas = Canvas {
            width: self.width,
            height: self.height,
            background,
        };
        let operations = read_actions(&self.actions)?;
        let document = match &self.layer_document {
            Some(path) => read_document(path)?,
            None => Document::new(),
        };
        render_frame(&canvas, &operations, &document, frame)
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
    /// Run-workspace-relative path of the layer document. Seeded empty; a run that
    /// registers no layer never touches it.
    #[serde(default = "default_layers")]
    pub layers: PathBuf,
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
    /// Path of the layer document. Unlike the logs and previews this is **not** a
    /// `{frame}` template: layers and their keyframes are sheet-wide, which is what
    /// lets one painted layer move across frames.
    #[serde(default = "default_layers")]
    pub layers: PathBuf,
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

fn default_layers() -> PathBuf {
    PathBuf::from("layers.json")
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

/// Read the layer document, treating an absent file as an empty document so a run
/// that never registers a layer needs nothing seeded.
pub fn read_document(path: &Path) -> Result<Document, String> {
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|err| format!("invalid layer document {}: {err}", path.display())),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Document::new()),
        Err(err) => Err(format!("reading {}: {err}", path.display())),
    }
}

/// Write the layer document as pretty JSON, creating parent directories as needed.
pub fn write_document(path: &Path, document: &Document) -> Result<(), String> {
    ensure_parent(path)?;
    let mut json = serde_json::to_string_pretty(document)
        .map_err(|err| format!("serializing layer document: {err}"))?;
    json.push('\n');
    fs::write(path, json).map_err(|err| format!("writing {}: {err}", path.display()))
}

/// Render one frame — its action log with every layer composited over it — and
/// write it to `preview`. Returns the PNG bytes written, so a caller streaming a
/// live view can forward the exact frame without re-reading it from disk.
pub fn render_preview(
    canvas: &Canvas,
    operations: &[Operation],
    document: &Document,
    frame: u32,
    preview: &Path,
) -> Result<Vec<u8>, String> {
    let bytes = render_frame(canvas, operations, document, frame).to_png_bytes();
    ensure_parent(preview)?;
    fs::write(preview, &bytes)
        .map_err(|err| format!("writing preview {}: {err}", preview.display()))?;
    Ok(bytes)
}

/// Re-render one frame from the files on disk. The path a layer edit takes, since
/// changing a layer changes every frame rather than the one being drawn into.
pub fn refresh_preview(
    canvas: &Canvas,
    actions: &Path,
    preview: &Path,
    document: &Document,
    frame: u32,
) -> Result<Vec<u8>, String> {
    let operations = read_actions(actions)?;
    render_preview(canvas, &operations, document, frame, preview)
}

/// Initialize one canvas: write an empty action log and render its blank preview,
/// so the surface starts from a known, empty state.
pub fn init_canvas(canvas: &Canvas, actions: &Path, preview: &Path) -> Result<(), String> {
    write_actions(actions, &[])?;
    render_preview(canvas, &[], &Document::new(), 0, preview).map(|_| ())
}

/// Append one operation to `actions` and re-render `preview` from the **whole**
/// log plus the layer document, keeping the recorded files the single source of
/// truth and the preview a faithful reflection of them. Returns the new operation
/// count and the PNG bytes the preview was written from.
pub fn apply(
    canvas: &Canvas,
    actions: &Path,
    preview: &Path,
    document: &Document,
    frame: u32,
    operation: Operation,
) -> Result<(usize, Vec<u8>), String> {
    let mut operations = read_actions(actions)?;
    operations.push(operation);
    write_actions(actions, &operations)?;
    let bytes = render_preview(canvas, &operations, document, frame, preview)?;
    Ok((operations.len(), bytes))
}

/// Append one operation to a layer's content, returning the layer's new operation
/// count. The caller writes the document back and re-renders the affected previews.
pub fn apply_to_layer(
    document: &mut Document,
    name: &str,
    operation: Operation,
) -> Result<usize, String> {
    let layer = document
        .layer_mut(name)
        .ok_or_else(|| unknown_layer(name))?;
    layer.ops.push(operation);
    Ok(layer.ops.len())
}

/// The error a command reports when it names a layer that was never registered,
/// listing what does exist so the model can correct itself in one step.
pub fn unknown_layer(name: &str) -> String {
    format!("no layer named `{name}` — register it first with `register-layer`")
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
