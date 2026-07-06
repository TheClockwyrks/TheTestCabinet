//! The generic op-log record plumbing and the best-effort live-preview stream the
//! audio binaries share.
//!
//! Recording is all an authoring operation does: it appends itself to the op log and
//! renders nothing. Rendering is on-request (`render`), which mixes the whole log down
//! to the `.wav` and draws the preview. This module owns the record half (pure log
//! I/O, generic over the op type) plus the live stream `render` reuses — it knows
//! nothing about DSP.

use std::fs;
use std::path::Path;

use serde::Serialize;
use serde::de::DeserializeOwned;

/// Read an op log, treating an absent file as an empty log so the first operation of a
/// run does not need a separate `init`.
pub fn read_actions<Op: DeserializeOwned>(path: &Path) -> Result<Vec<Op>, String> {
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|err| format!("invalid op log {}: {err}", path.display())),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(err) => Err(format!("reading {}: {err}", path.display())),
    }
}

/// Write an op log as pretty JSON, creating parent directories as needed.
pub fn write_actions<Op: Serialize>(path: &Path, operations: &[Op]) -> Result<(), String> {
    ensure_parent(path)?;
    let mut json = serde_json::to_string_pretty(operations)
        .map_err(|err| format!("serializing op log: {err}"))?;
    json.push('\n');
    fs::write(path, json).map_err(|err| format!("writing {}: {err}", path.display()))
}

/// Initialize a run's op log to empty. Renders nothing — rendering is on-request.
pub fn init_log<Op: Serialize>(actions: &Path) -> Result<(), String> {
    write_actions::<Op>(actions, &[])
}

/// Append one operation to `actions`, returning the log's new operation count. This is
/// all an authoring operation does — no mix, no preview, no stream.
pub fn record<Op: Serialize + DeserializeOwned>(
    actions: &Path,
    operation: Op,
) -> Result<usize, String> {
    let mut operations = read_actions::<Op>(actions)?;
    operations.push(operation);
    write_actions(actions, &operations)?;
    Ok(operations.len())
}

/// Stream a just-rendered preview to the run's live-preview endpoint, best-effort.
///
/// `render` must never fail because the live view is unavailable, so every error here
/// is swallowed. The wire form is one JSON header line (`{ token, frame, operation,
/// operationCount, length, audioLength }`) followed by exactly `length` PNG bytes and
/// then `audioLength` bytes of the current clip `.wav`; the listener validates the
/// token before accepting the frame. `frame` carries the target index (0 for a single
/// clip). The audio body lets a watcher play the clip as it is built; a preview-only
/// viewer ignores it.
#[allow(clippy::too_many_arguments)]
pub fn send_live_preview(
    endpoint: &str,
    token: &str,
    frame: u32,
    operation: &str,
    operation_count: usize,
    image: &[u8],
    audio: &[u8],
) {
    let _ = try_send_live_preview(
        endpoint,
        token,
        frame,
        operation,
        operation_count,
        image,
        audio,
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
    audio: &[u8],
) -> std::io::Result<()> {
    use std::io::{Error, ErrorKind, Write};
    use std::net::{TcpStream, ToSocketAddrs};
    use std::time::Duration;

    // A short cap on every step so a stalled or absent listener can never hold up the
    // `render` that triggered the update.
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
        "audioLength": audio.len(),
    }))?;
    header.push(b'\n');
    stream.write_all(&header)?;
    stream.write_all(image)?;
    stream.write_all(audio)?;
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
