//! Live asset-generation previews: streaming a sprite as the model draws it.
//!
//! An asset-generation run draws through the `draw`/`draw-sheet` binary, which
//! re-renders the preview image after every operation (see
//! `docs/testing/asset-generation/binaries.md`). Those intermediate frames live
//! inside the run container, out of reach of the host while the run is in
//! progress, and the binary's stdout is mediated by the harness — so neither is a
//! reliable channel for showing a viewer the drawing as it happens.
//!
//! Instead, when a viewer is observing a run, the orchestrator opens a small TCP
//! listener on the host and seeds its address into the binary's `draw.config.json`
//! (as `live.endpoint`/`live.token`). After each operation the binary connects
//! back and streams the freshly rendered frame here; the listener decodes it into
//! an [`AssetPreview`] and hands it to a [`PreviewSink`] — the worker relays it
//! over the run's event stream, the desktop shell emits it to the webview, and the
//! command line ignores it. This rides the same per-run live channel every other
//! update uses; the frames are deliberately **not** recorded, since the post-run
//! view regenerates everything authoritatively from the action log.
//!
//! The channel is best-effort by design. A drawing operation never fails because
//! the listener is slow or gone, and a missed frame is simply skipped — the
//! recorded action log, not these previews, is the run's authoritative output.

use std::sync::Arc;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;
use tokio::time::{Duration, timeout};

/// The hostname the run container resolves to reach the run host. The container is
/// started with `--add-host host.docker.internal:host-gateway` (see
/// [`HOST_GATEWAY_ADD_HOST`]), which both Docker and Podman map to a host-reachable
/// address, so the drawing binary connects to `host.docker.internal:<port>`.
pub const HOST_INTERNAL: &str = "host.docker.internal";

/// The `--add-host` mapping the run container is started with so a process inside
/// it can reach the run host as [`HOST_INTERNAL`]. `host-gateway` is a special
/// value both Docker and Podman resolve to a host-reachable address.
pub const HOST_GATEWAY_ADD_HOST: &str = "host.docker.internal:host-gateway";

/// The largest preview frame the listener will accept, as a guard against a
/// malformed or hostile header advertising an enormous body. Asset-generation
/// canvases are small (tens of pixels square), so even a generous cap is far above
/// any real frame; a header over it is dropped rather than allocated.
const MAX_FRAME_BYTES: usize = 4 * 1024 * 1024;

/// A cap on the `.glb` mesh body a voxel frame may append after its PNG. A
/// face-culled surface mesh is far smaller than this even at the largest declared
/// dimensions, so a header advertising more is dropped rather than allocated.
const MAX_MESH_BYTES: usize = 32 * 1024 * 1024;

/// A cap on the `system.json` body a particle run appends after its PNG frame — the
/// authored emitter/force/curve definition the live viewer simulates. Compact
/// metadata, so a small bound.
const MAX_SYSTEM_BYTES: usize = 4 * 1024 * 1024;

/// A cap on reading one frame off a connection, so a client that opens a socket
/// and then stalls cannot tie up the listener.
const READ_TIMEOUT: Duration = Duration::from_secs(5);

/// One re-rendered asset-generation frame, streamed live as the model draws.
///
/// This is what a viewer renders to watch the asset take shape: the `image` is
/// the frame's PNG, base64-encoded so it travels in the same JSON transport as
/// every other live update, and `frame`/`operationCount` let the UI show which
/// frame changed and how far along it is. A voxel run additionally carries the
/// frame's current [`mesh`](Self::mesh) — decoded from the `PartMesh`-shaped `.glb`
/// every voxel-family binary emits — so the live viewer can rebuild the part in 3D and
/// assemble the scene; a 2D sprite run leaves it `None`. It is never persisted — the
/// post-run view regenerates the asset from the recorded action log instead.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetPreview {
    /// The frame this preview belongs to. A single sprite (or static voxel model) is
    /// always frame `0`; a sprite sheet uses the `draw-sheet --frame` index, and an
    /// animated voxel model uses the part's declared index.
    pub frame: u32,
    /// How many operations the frame's action log holds after this one — the
    /// frame's progress, shown alongside the image.
    pub operation_count: usize,
    /// The drawing operation that produced this frame (for example `fill_rect`),
    /// when reported.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation: Option<String>,
    /// The frame's PNG, base64-encoded (no `data:` prefix; a viewer builds the
    /// data URL).
    pub image: String,
    /// The frame's current surface mesh, for a voxel run — decoded from the same
    /// `PartMesh`-shaped `.glb` the post-run viewer loads, so the live viewer can
    /// rebuild the part in 3D directly (it never re-meshes). `None` for a 2D sprite run
    /// (which streams only the PNG).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mesh: Option<test_cabinet_voxel_mesh::Mesh>,
    /// The frame's current authored `system.json`, for a particle run — so the live
    /// viewer can **simulate** the effect as it is authored, rather than show only the
    /// rendered still. `None` for every other kind.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system: Option<serde_json::Value>,
}

/// Receives [`AssetPreview`]s as the drawing binary streams them during a run.
///
/// A runner implements this to relay live frames to its viewer: the worker
/// broadcasts them on the run's event stream, the desktop shell emits them to the
/// webview. It takes `&self` (not `&mut`) so the orchestrator can share it with the
/// listener task that runs concurrently with the harness session, which owns the
/// run's [`EventSink`](crate::event::EventSink) exclusively.
pub trait PreviewSink: Send + Sync {
    /// Handle one streamed frame. Called as frames arrive, before the run finishes.
    fn preview(&self, preview: AssetPreview);
}

/// The seeded coordinates of a run's live-preview listener: the `host:port` the
/// drawing binary connects to and the per-run token it echoes. Written into
/// `draw.config.json` by the seeder (see [`crate::seeding`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LivePreviewEndpoint {
    /// The `host:port` the binary connects to, as `host.docker.internal:<port>`.
    pub endpoint: String,
    /// The opaque per-run token the binary echoes with each frame.
    pub token: String,
}

/// A running live-preview listener bound to the host for the duration of a run.
///
/// Created by [`LivePreview::start`] before the run container is seeded, so its
/// address can be written into `draw.config.json`. The accept loop runs on a
/// background task forwarding each decoded frame to the supplied [`PreviewSink`];
/// dropping this handle aborts that task, so a run that finishes (or fails) tears
/// the listener down with it.
pub struct LivePreview {
    endpoint: LivePreviewEndpoint,
    task: JoinHandle<()>,
}

impl LivePreview {
    /// Bind a listener on an ephemeral host port and start forwarding frames to
    /// `sink`.
    ///
    /// Binds `0.0.0.0` so the run container can reach it on the host-gateway
    /// address (a loopback bind would be unreachable from the container), and mints
    /// a fresh per-run token the binary must echo. Returns an error only if the
    /// bind itself fails; the caller treats that as "no live preview for this run"
    /// and proceeds, since the preview is non-essential.
    pub async fn start(sink: Arc<dyn PreviewSink>) -> std::io::Result<Self> {
        let listener = TcpListener::bind(("0.0.0.0", 0)).await?;
        let port = listener.local_addr()?.port();
        let token = uuid::Uuid::new_v4().to_string();
        let endpoint = LivePreviewEndpoint {
            endpoint: format!("{HOST_INTERNAL}:{port}"),
            token: token.clone(),
        };
        let task = tokio::spawn(serve(listener, token, sink));
        Ok(Self { endpoint, task })
    }

    /// The seeded coordinates to write into the run's `draw.config.json`.
    pub fn endpoint(&self) -> &LivePreviewEndpoint {
        &self.endpoint
    }
}

impl Drop for LivePreview {
    fn drop(&mut self) {
        // The accept loop is an infinite server; abort it when the run is done so a
        // finished or failed run never leaves a listening socket behind.
        self.task.abort();
    }
}

/// Accept connections and forward each decoded frame to `sink`. Each connection
/// carries exactly one frame, so it is handled on its own task with a read cap —
/// drawing operations are serial within a run, but a per-connection task keeps a
/// single slow or malformed client from stalling the next frame.
async fn serve(listener: TcpListener, token: String, sink: Arc<dyn PreviewSink>) {
    loop {
        let Ok((stream, _addr)) = listener.accept().await else {
            // A transient accept error should not kill the listener for the rest of
            // the run; yield and keep serving.
            continue;
        };
        let token = token.clone();
        let sink = sink.clone();
        tokio::spawn(async move {
            if let Ok(Some(preview)) = timeout(READ_TIMEOUT, read_frame(stream, &token)).await {
                sink.preview(preview);
            }
        });
    }
}

/// The JSON header line the drawing binary sends before a frame's PNG bytes.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FrameHeader {
    /// The per-run token; a frame whose token does not match this run is dropped.
    token: String,
    /// The frame index the operation drew into.
    frame: u32,
    /// The frame's operation count after the operation.
    operation_count: usize,
    /// The operation that produced the frame, when reported.
    #[serde(default)]
    operation: Option<String>,
    /// The number of PNG bytes that follow the header line.
    length: usize,
    /// The number of `.glb` mesh bytes that follow the PNG body, for a voxel
    /// run. `0` (or absent, for a 2D sprite run) means no mesh body follows.
    #[serde(default)]
    mesh_length: usize,
    /// The number of `system.json` bytes that follow the PNG body, for a particle
    /// run — the authored system the live viewer simulates. `0`/absent for every
    /// other kind. A frame carries at most one body (mesh XOR system).
    #[serde(default)]
    system_length: usize,
}

/// Read one framed preview off a connection: a JSON header line, then exactly
/// `length` PNG bytes. Returns `None` (the frame is dropped) on any malformed
/// input, a token mismatch, or an oversized body, so a bad client never produces a
/// bogus preview.
async fn read_frame(stream: TcpStream, token: &str) -> Option<AssetPreview> {
    let mut reader = BufReader::new(stream);

    // The header is a single newline-terminated JSON object. Read it byte by byte
    // up to the newline rather than line-buffering the whole stream, since the PNG
    // body that follows is binary.
    let mut header_line = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        if reader.read_exact(&mut byte).await.is_err() {
            return None;
        }
        if byte[0] == b'\n' {
            break;
        }
        header_line.push(byte[0]);
        // A header that never terminates is malformed; bound it well under any real
        // header so a runaway client cannot grow this unbounded.
        if header_line.len() > 64 * 1024 {
            return None;
        }
    }

    let header: FrameHeader = serde_json::from_slice(&header_line).ok()?;
    if header.token != token
        || header.length > MAX_FRAME_BYTES
        || header.mesh_length > MAX_MESH_BYTES
        || header.system_length > MAX_SYSTEM_BYTES
    {
        return None;
    }

    let mut image = vec![0u8; header.length];
    reader.read_exact(&mut image).await.ok()?;

    // A voxel run appends its current part `.glb` after the PNG so the live viewer
    // can rebuild the model in 3D. Read and decode it when present; a malformed or
    // oversized body simply drops the mesh (the PNG preview still stands) rather
    // than the whole frame.
    let mesh = if header.mesh_length > 0 {
        let mut buf = vec![0u8; header.mesh_length];
        reader.read_exact(&mut buf).await.ok()?;
        test_cabinet_model_core::glb_to_part_mesh(&buf)
            .ok()
            .map(|arrays| test_cabinet_voxel_mesh::Mesh {
                positions: arrays.positions,
                normals: arrays.normals,
                colors: arrays.colors,
                indices: arrays.indices,
            })
    } else {
        None
    };

    // A particle run appends its current `system.json` after the PNG so the live
    // viewer can simulate the effect (rather than show only the rendered still).
    // A malformed body drops the system (the PNG preview still stands).
    let system = if header.system_length > 0 {
        let mut buf = vec![0u8; header.system_length];
        reader.read_exact(&mut buf).await.ok()?;
        serde_json::from_slice::<serde_json::Value>(&buf).ok()
    } else {
        None
    };

    Some(AssetPreview {
        frame: header.frame,
        operation_count: header.operation_count,
        operation: header.operation,
        image: base64::engine::general_purpose::STANDARD.encode(&image),
        mesh,
        system,
    })
}

/// Send one frame to a live-preview listener, in the wire form [`read_frame`]
/// expects. Used by tests on this side of the channel; the in-container drawing
/// binary has its own dependency-light sender in `crates/draw`.
#[cfg(test)]
async fn send_frame(
    endpoint: &str,
    token: &str,
    frame: u32,
    operation_count: usize,
    image: &[u8],
) -> std::io::Result<()> {
    use tokio::io::AsyncWriteExt as _;

    let mut stream = TcpStream::connect(endpoint).await?;
    let mut header = serde_json::to_vec(&serde_json::json!({
        "token": token,
        "frame": frame,
        "operationCount": operation_count,
        "length": image.len(),
    }))?;
    header.push(b'\n');
    stream.write_all(&header).await?;
    stream.write_all(image).await?;
    stream.flush().await
}

#[cfg(test)]
#[path = "preview.test.rs"]
mod tests;
