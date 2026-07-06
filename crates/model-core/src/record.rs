//! The generic record / preview / live-preview plumbing every voxel-family tool
//! shares.
//!
//! A tool records the model's operations to an action log. Recording is **all** an
//! operation does: appending to the log is cheap and the log is the single source of
//! truth, so — unlike the 2D `draw` tools — the voxel family does **not** re-render
//! after every call. Meshing a field and rasterizing it through the wgpu+Mesa
//! renderer is far more expensive than stamping pixels, and the voxel cases run many
//! more operations, so rendering is a separate, **on-request** step (the tools'
//! `render` command) rather than an automatic side effect of every mark.
//!
//! This module owns the record half — read the log, append one operation, write it
//! back ([`record`]) — which is pure log I/O and knows nothing about geometry. The
//! render half (mesh a target's log, write its preview PNG and per-part `.glb`) is
//! domain-specific and lives in each tool's `cli` module; this module only supplies
//! the shared [`Rendered`] return shape and the best-effort live-preview stream those
//! renderers reuse. It knows nothing about voxel cubes or signed-distance fields.

use std::fs;
use std::path::Path;

use serde::Serialize;
use serde::de::DeserializeOwned;

/// The rendered artifacts of one target: the preview PNG bytes and the live-stream
/// body (the geometry payload — every voxel tool sends its part's `.glb` bytes, the
/// same glTF geometry the 3D client renders).
pub struct Rendered {
    /// The re-rendered preview PNG.
    pub image: Vec<u8>,
    /// The live-stream body appended after the PNG on the wire: the part's `.glb`
    /// bytes.
    pub live_body: Vec<u8>,
}

/// Read an action log, treating an absent file as an empty log so the first
/// operation of a run does not need a separate `init`.
pub fn read_actions<Op: DeserializeOwned>(path: &Path) -> Result<Vec<Op>, String> {
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|err| format!("invalid action log {}: {err}", path.display())),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(err) => Err(format!("reading {}: {err}", path.display())),
    }
}

/// Write an action log as pretty JSON, creating parent directories as needed.
pub fn write_actions<Op: Serialize>(path: &Path, operations: &[Op]) -> Result<(), String> {
    ensure_parent(path)?;
    let mut json = serde_json::to_string_pretty(operations)
        .map_err(|err| format!("serializing action log: {err}"))?;
    json.push('\n');
    fs::write(path, json).map_err(|err| format!("writing {}: {err}", path.display()))
}

/// Initialize one target's action log to an empty log, so the target starts from a
/// known, empty state. No artifacts are rendered — rendering is on-request (the
/// tool's `render` command), never a side effect of setup.
pub fn init_log<Op: Serialize>(actions: &Path) -> Result<(), String> {
    write_actions::<Op>(actions, &[])
}

/// Append one operation to `actions`, returning the log's new operation count.
///
/// This is **all** a sculpting operation does: no meshing, no preview, no live
/// stream. The recorded log stays the single source of truth, and the model calls
/// `render` when it wants to regenerate the mesh and preview from the whole log.
pub fn record<Op: Serialize + DeserializeOwned>(
    actions: &Path,
    operation: Op,
) -> Result<usize, String> {
    let mut operations = read_actions::<Op>(actions)?;
    operations.push(operation);
    write_actions(actions, &operations)?;
    Ok(operations.len())
}

/// Stream a just-rendered frame to the run's live-preview endpoint, best-effort.
///
/// A sculpting operation must never fail because the live view is unavailable, so
/// every error here is swallowed — the recorded action log remains the run's
/// authoritative output regardless of whether a frame reaches a viewer. The wire
/// form is one JSON header line (`{ token, frame, operation, operationCount,
/// length, meshLength, rigLength }`) followed by exactly `length` raw PNG bytes and
/// then `meshLength` bytes of the live body (the part's `.glb` bytes); the listener
/// validates the token before accepting the frame. `frame` carries the part index
/// (0 for a single static model). The body lets the live viewer rebuild the model in
/// 3D — a PNG-only viewer simply ignores it. This sender appends no rig
/// (`rigLength: 0`); a skinned tool uses [`send_live_preview_with_rig`] instead.
pub fn send_live_preview(
    endpoint: &str,
    token: &str,
    frame: u32,
    operation: &str,
    operation_count: usize,
    image: &[u8],
    body: &[u8],
) {
    let _ = try_send_live_preview(
        endpoint,
        token,
        frame,
        operation,
        operation_count,
        image,
        body,
        &[],
    );
}

/// Like [`send_live_preview`], but appends the skinned run's `rig.json` as a second
/// body (after the glb) so the live viewer can **deform** the skin rather than show
/// the undeformed rest mesh — the one frame that carries two bodies (glb + rig). Used
/// only by the skinning binaries; every other voxel tool sends no rig. Best-effort,
/// exactly like the base sender.
#[allow(clippy::too_many_arguments)]
pub fn send_live_preview_with_rig(
    endpoint: &str,
    token: &str,
    frame: u32,
    operation: &str,
    operation_count: usize,
    image: &[u8],
    body: &[u8],
    rig: &[u8],
) {
    let _ = try_send_live_preview(
        endpoint,
        token,
        frame,
        operation,
        operation_count,
        image,
        body,
        rig,
    );
}

#[allow(clippy::too_many_arguments)]
fn try_send_live_preview(
    endpoint: &str,
    token: &str,
    frame: u32,
    operation: &str,
    operation_count: usize,
    image: &[u8],
    body: &[u8],
    rig: &[u8],
) -> std::io::Result<()> {
    use std::io::{Error, ErrorKind, Write};
    use std::net::{TcpStream, ToSocketAddrs};
    use std::time::Duration;

    // A short cap on every step so a stalled or absent listener can never hold up
    // the sculpting operation that triggered the update.
    const TIMEOUT: Duration = Duration::from_millis(750);
    let addr = endpoint
        .to_socket_addrs()?
        .next()
        .ok_or_else(|| Error::new(ErrorKind::NotFound, "live endpoint resolved to no address"))?;
    let mut stream = TcpStream::connect_timeout(&addr, TIMEOUT)?;
    stream.set_write_timeout(Some(TIMEOUT))?;
    let mut header = serde_json::to_vec(&serde_json::json!({
        "token": token,
        "frame": frame,
        "operation": operation,
        "operationCount": operation_count,
        "length": image.len(),
        "meshLength": body.len(),
        "rigLength": rig.len(),
    }))?;
    header.push(b'\n');
    stream.write_all(&header)?;
    stream.write_all(image)?;
    stream.write_all(body)?;
    stream.write_all(rig)?;
    stream.flush()
}

/// Create a path's parent directory tree if it has one.
pub fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        fs::create_dir_all(parent)
            .map_err(|err| format!("creating {}: {err}", parent.display()))?;
    }
    Ok(())
}
