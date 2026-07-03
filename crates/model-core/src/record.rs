//! The generic record / preview / live-preview plumbing every voxel-family tool
//! shares.
//!
//! A tool records the model's operations to an action log and, after every
//! operation, re-renders the derived artifacts (a preview PNG and a `mesh.json`)
//! from the **whole** log so the recorded log is always the single source of truth.
//! That loop — read the log, append one operation, write it back, re-render, and
//! (best-effort) stream the frame to a live viewer — is identical across the cube
//! tool and the meshing tools. It is captured here, parameterized over a
//! [`SculptBackend`]: the one domain-specific thing a tool supplies, turning its
//! recorded operations into the rendered artifacts. This module knows nothing about
//! voxel cubes or signed-distance fields.

use std::fs;
use std::path::Path;

use serde::Serialize;
use serde::de::DeserializeOwned;

/// The domain-specific half of the record/preview loop: given a target's recorded
/// operations, render its preview PNG and `mesh.json` to disk and return the PNG
/// bytes plus the live-stream body.
///
/// A concrete tool (the cube tool today; the meshing tools later) implements this
/// once; the generic [`apply`]/[`init_target`] plumbing drives it. The [`Op`] type
/// is the tool's recorded operation, which must round-trip through the JSON action
/// log.
///
/// [`Op`]: SculptBackend::Op
pub trait SculptBackend {
    /// The recorded operation this tool logs and replays.
    type Op: Clone + Serialize + DeserializeOwned;

    /// Render `ops` into this target's artifacts: write the preview PNG to `preview`
    /// and the surface mesh (`PartMesh` shape) to `mesh`, returning the PNG bytes
    /// (so a caller streaming a live frame need not re-read them) and the
    /// live-stream body (the geometry payload a live viewer rebuilds the model
    /// from).
    fn render_target(
        &self,
        ops: &[Self::Op],
        preview: &Path,
        mesh: &Path,
    ) -> Result<Rendered, String>;
}

/// The rendered artifacts of one target: the preview PNG bytes and the live-stream
/// body (the geometry payload — the cube tool sends its sparse `voxels.json` text).
pub struct Rendered {
    /// The re-rendered preview PNG.
    pub image: Vec<u8>,
    /// The live-stream body appended after the PNG on the wire.
    pub live_body: String,
}

/// The outcome of applying one operation: the running operation count plus the
/// re-rendered preview PNG and live-stream body, so a caller streaming a live view
/// can forward the exact rendered frame without re-reading it from disk.
pub struct ApplyResult {
    /// How many operations the target's action log now holds.
    pub count: usize,
    /// The re-rendered preview PNG.
    pub image: Vec<u8>,
    /// The live-stream body (the geometry payload — sparse `voxels.json` for the
    /// cube tool).
    pub live_body: String,
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

/// Initialize one target: write an empty action log and render its blank artifacts
/// (an empty volume), so the target starts from a known, empty state.
pub fn init_target<B: SculptBackend>(
    backend: &B,
    actions: &Path,
    preview: &Path,
    mesh: &Path,
) -> Result<(), String> {
    write_actions::<B::Op>(actions, &[])?;
    backend.render_target(&[], preview, mesh)?;
    Ok(())
}

/// Append one operation to `actions` and re-render the target's artifacts from the
/// **whole** log, keeping the recorded log the single source of truth and the
/// preview/mesh a faithful reflection of it.
pub fn apply<B: SculptBackend>(
    backend: &B,
    actions: &Path,
    preview: &Path,
    mesh: &Path,
    operation: B::Op,
) -> Result<ApplyResult, String> {
    let mut operations = read_actions::<B::Op>(actions)?;
    operations.push(operation);
    write_actions(actions, &operations)?;
    let Rendered { image, live_body } = backend.render_target(&operations, preview, mesh)?;
    Ok(ApplyResult {
        count: operations.len(),
        image,
        live_body,
    })
}

/// Stream a just-rendered frame to the run's live-preview endpoint, best-effort.
///
/// A sculpting operation must never fail because the live view is unavailable, so
/// every error here is swallowed — the recorded action log remains the run's
/// authoritative output regardless of whether a frame reaches a viewer. The wire
/// form is one JSON header line (`{ token, frame, operation, operationCount,
/// length, voxelLength }`) followed by exactly `length` raw PNG bytes and then
/// `voxelLength` bytes of the live body text; the listener validates the token
/// before accepting the frame. `frame` carries the part index (0 for a single
/// static model). The body lets the live viewer rebuild the model in 3D — a
/// PNG-only viewer simply ignores it.
pub fn send_live_preview(
    endpoint: &str,
    token: &str,
    frame: u32,
    operation: &str,
    operation_count: usize,
    image: &[u8],
    body: &str,
) {
    let _ = try_send_live_preview(
        endpoint,
        token,
        frame,
        operation,
        operation_count,
        image,
        body,
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
    body: &str,
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
    let body_bytes = body.as_bytes();
    let mut header = serde_json::to_vec(&serde_json::json!({
        "token": token,
        "frame": frame,
        "operation": operation,
        "operationCount": operation_count,
        "length": image.len(),
        "voxelLength": body_bytes.len(),
    }))?;
    header.push(b'\n');
    stream.write_all(&header)?;
    stream.write_all(image)?;
    stream.write_all(body_bytes)?;
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
