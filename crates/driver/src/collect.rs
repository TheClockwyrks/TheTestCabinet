//! The driver end of the run-tree collection channel.
//!
//! A finished run's working tree is the product of every API call the run paid
//! for, so it leaves the sandbox over a connection the driver owns and verifies,
//! following the pattern the live-streaming design sets out: a pod exec carries
//! only the command that starts the transfer, and the bytes travel over a direct
//! TCP connection from the sandbox to a listener on the driver's own pod IP. Exec
//! stdout is not that channel — it can be cut short while the exit status still
//! reports success — and this module exists so the tree never rides it.
//!
//! The sandbox end is [`UPLOADER_SCRIPT`], a Node script the driver ships inside
//! its own binary and runs with the sandbox image's Node runtime, so the two ends
//! always come from the same build. It streams a `tar` of the tree as
//! length-framed chunks and terminates the stream with the archive's byte count
//! and SHA-256 digest; the listener accepts the tree only when that terminator
//! arrives and both match what it received, and only then acknowledges. See the
//! protocol summary at the top of the script.

use std::path::Path;
use std::time::Duration;

use sha2::{Digest, Sha256};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;

use test_cabinet_core::{Error, Result};

/// The sandbox end of the channel, run in the pod with `node`. See
/// [`uploader_command`].
pub const UPLOADER_SCRIPT: &str = include_str!("collect-uploader.mjs");

/// The protocol name the uploader announces in its header line.
pub const PROTOCOL: &str = "tcab-collect/1";

/// A frame carrying archive bytes.
const KIND_DATA: u8 = 0;
/// The terminator: the archive's total length and SHA-256 digest.
const KIND_END: u8 = 1;
/// `tar` did not produce the archive; the payload says why.
const KIND_FAILURE: u8 = 2;

/// The terminator's payload: a `u64` byte count and a 32-byte SHA-256 digest.
const END_PAYLOAD_LEN: u32 = 8 + 32;

/// A cap on one frame's payload. The uploader frames in 1 MiB chunks; anything far
/// beyond that is a corrupt or foreign stream, refused before it is allocated.
const MAX_FRAME_LEN: u32 = 16 * 1024 * 1024;

/// A cap on the header line, well over any real one.
const MAX_HEADER_LEN: usize = 256;

/// How long the listener waits for the uploader to connect, and then for the next
/// bytes of its upload, before it gives the attempt up. A tree streams
/// continuously once `tar` starts, and the uploader connects within moments of
/// its exec starting; a gap this long is a dead peer, not a slow one.
const IDLE_TIMEOUT: Duration = Duration::from_secs(120);

/// The argv that starts the uploader in the sandbox: the script is passed inline
/// to `node -e` and its parameters follow as plain arguments, so the exec carries
/// nothing that needs a shell and no byte of the tree.
///
/// An exec's command travels to the API server as URL query parameters, so the
/// script goes without its comment and blank lines: the same program, a fraction
/// of the request line.
pub fn uploader_command(
    host: &str,
    port: u16,
    token: &str,
    workdir: &str,
    excludes: &[&str],
) -> Vec<String> {
    let mut command = vec![
        "node".to_string(),
        "--input-type=module".to_string(),
        "-e".to_string(),
        uploader_program(),
        "--".to_string(),
        host.to_string(),
        port.to_string(),
        token.to_string(),
        workdir.to_string(),
    ];
    command.extend(excludes.iter().map(|dir| dir.to_string()));
    command
}

/// [`UPLOADER_SCRIPT`] with its comment lines, blank lines and indentation
/// removed. Only whole lines are dropped and only leading whitespace is trimmed,
/// so nothing inside a string literal is touched: the script keeps every string on
/// one line for exactly this reason.
fn uploader_program() -> String {
    UPLOADER_SCRIPT
        .lines()
        .map(str::trim_start)
        .filter(|line| !line.is_empty() && !line.starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// The size of `argv` once it has travelled as an exec request's `command` query
/// parameters, percent-encoding everything but the unreserved characters. That is
/// the most any encoder spends, so a bound on this holds for the real one.
pub fn encoded_command_len(argv: &[String]) -> usize {
    argv.iter()
        .map(|arg| {
            "&command=".len()
                + arg
                    .bytes()
                    .map(|byte| {
                        if byte.is_ascii_alphanumeric() || b"-_.~".contains(&byte) {
                            1
                        } else {
                            3
                        }
                    })
                    .sum::<usize>()
        })
        .sum()
}

/// What a verified upload delivered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Received {
    /// The archive's length in bytes, as verified against the terminator.
    pub bytes: u64,
}

/// A listener bound for one run's collection, with the per-run token the uploader
/// must present.
#[derive(Debug)]
pub struct CollectListener {
    listener: TcpListener,
    port: u16,
    token: String,
    idle: Duration,
}

impl CollectListener {
    /// Bind an ephemeral port on every interface, so the sandbox can reach it on
    /// the driver's pod IP, and mint the run's token.
    pub async fn bind() -> std::io::Result<Self> {
        let listener = TcpListener::bind(("0.0.0.0", 0)).await?;
        let port = listener.local_addr()?.port();
        Ok(Self {
            listener,
            port,
            token: cuid2::create_id(),
            idle: IDLE_TIMEOUT,
        })
    }

    /// Shorten the idle bound, so a test of a peer that never connects or stalls
    /// does not wait out the production one.
    #[cfg(test)]
    fn with_idle(mut self, idle: Duration) -> Self {
        self.idle = idle;
        self
    }

    /// The bound port.
    pub fn port(&self) -> u16 {
        self.port
    }

    /// The token the uploader must present.
    pub fn token(&self) -> &str {
        &self.token
    }

    /// Accept one upload into the file at `archive`, returning once it has been
    /// verified whole and acknowledged.
    ///
    /// A connection that never presents this run's token is dropped and the
    /// listener keeps accepting, since the uploader has not spoken yet. Once a
    /// connection has authenticated, its outcome is the outcome of this call: a
    /// stream that ends without its terminator, a count or digest that does not
    /// match, a stall, or a `tar` failure reported by the uploader is an error, and
    /// the caller decides whether to start another upload. So is an uploader that
    /// has not connected within the idle bound: this call always returns.
    pub async fn receive(&self, archive: &Path) -> Result<Received> {
        loop {
            let (stream, peer) = match timeout(self.idle, self.listener.accept()).await {
                Ok(accepted) => accepted.map_err(|err| {
                    Error::ArtifactCollection(format!("accepting the upload connection: {err}"))
                })?,
                Err(_elapsed) => {
                    return Err(Error::ArtifactCollection(format!(
                        "no uploader connected within {}s",
                        self.idle.as_secs()
                    )));
                }
            };
            match receive_upload(stream, &self.token, archive, self.idle).await {
                Ok(Some(received)) => return Ok(received),
                Ok(None) => {
                    tracing::warn!(
                        %peer,
                        "a connection to the collection listener presented no valid token; ignoring it",
                    );
                }
                Err(err) => return Err(err),
            }
        }
    }
}

/// Receive one connection's upload. `Ok(None)` is a connection that never
/// authenticated; everything after the header is this run's upload and reports as
/// itself.
async fn receive_upload(
    stream: TcpStream,
    token: &str,
    archive: &Path,
    idle: Duration,
) -> Result<Option<Received>> {
    let mut reader = BufReader::with_capacity(256 * 1024, stream);

    let mut header = Vec::new();
    let mut limited = (&mut reader).take(MAX_HEADER_LEN as u64);
    match timeout(idle, limited.read_until(b'\n', &mut header)).await {
        Ok(Ok(_)) if header.last() == Some(&b'\n') => {}
        _ => return Ok(None),
    }
    header.pop();
    let expected = format!("{PROTOCOL} {token}");
    if header != expected.as_bytes() {
        return Ok(None);
    }

    let file = tokio::fs::File::create(archive)
        .await
        .map_err(|err| Error::ArtifactCollection(format!("creating the archive: {err}")))?;
    let mut writer = BufWriter::with_capacity(1024 * 1024, file);
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;
    let mut chunk = vec![0u8; 256 * 1024];

    loop {
        let mut frame_header = [0u8; 5];
        read_exactly(&mut reader, &mut frame_header, received, idle).await?;
        let kind = frame_header[0];
        let len = u32::from_be_bytes([
            frame_header[1],
            frame_header[2],
            frame_header[3],
            frame_header[4],
        ]);
        if len > MAX_FRAME_LEN {
            return Err(Error::ArtifactCollection(format!(
                "upload frame over the size cap ({len} bytes, cap {MAX_FRAME_LEN})"
            )));
        }
        match kind {
            KIND_DATA => {
                let mut remaining = len as usize;
                while remaining > 0 {
                    let want = remaining.min(chunk.len());
                    read_exactly(&mut reader, &mut chunk[..want], received, idle).await?;
                    hasher.update(&chunk[..want]);
                    writer.write_all(&chunk[..want]).await.map_err(|err| {
                        Error::ArtifactCollection(format!("writing the archive: {err}"))
                    })?;
                    received += want as u64;
                    remaining -= want;
                }
            }
            KIND_END => {
                if len != END_PAYLOAD_LEN {
                    return Err(Error::ArtifactCollection(format!(
                        "upload terminator is {len} bytes, not {END_PAYLOAD_LEN}"
                    )));
                }
                let mut payload = [0u8; END_PAYLOAD_LEN as usize];
                read_exactly(&mut reader, &mut payload, received, idle).await?;
                let claimed = u64::from_be_bytes(payload[..8].try_into().expect("8 bytes"));
                if claimed != received {
                    return Err(Error::ArtifactCollection(format!(
                        "upload byte count mismatch (received {received}, uploader claimed {claimed})"
                    )));
                }
                let digest = hasher.finalize();
                if digest.as_slice() != &payload[8..] {
                    return Err(Error::ArtifactCollection(format!(
                        "upload SHA-256 digest mismatch (over {received} bytes)"
                    )));
                }
                writer.flush().await.map_err(|err| {
                    Error::ArtifactCollection(format!("flushing the archive: {err}"))
                })?;
                writer.into_inner().sync_all().await.map_err(|err| {
                    Error::ArtifactCollection(format!("syncing the archive: {err}"))
                })?;
                // The acknowledgement is what lets the uploader exit 0; a lost reply
                // costs nothing here, since the archive is already verified.
                let mut stream = reader.into_inner();
                let _ = stream.write_all(b"ok\n").await;
                let _ = stream.shutdown().await;
                return Ok(Some(Received { bytes: received }));
            }
            KIND_FAILURE => {
                let mut message = vec![0u8; len as usize];
                read_exactly(&mut reader, &mut message, received, idle).await?;
                return Err(Error::ArtifactCollection(format!(
                    "tar failed in the sandbox: {}",
                    String::from_utf8_lossy(&message).trim()
                )));
            }
            other => {
                return Err(Error::ArtifactCollection(format!(
                    "unknown upload frame kind {other}"
                )));
            }
        }
    }
}

/// Fill `buf` from the stream, reporting an end of stream or a stall as the
/// truncated upload it is, with how much of the archive had arrived.
async fn read_exactly(
    reader: &mut BufReader<TcpStream>,
    buf: &mut [u8],
    received: u64,
    idle: Duration,
) -> Result<()> {
    match timeout(idle, reader.read_exact(buf)).await {
        Ok(Ok(_)) => Ok(()),
        Ok(Err(err)) if err.kind() == std::io::ErrorKind::UnexpectedEof => {
            Err(Error::ArtifactCollection(format!(
                "upload ended without its terminator (after {received} bytes)"
            )))
        }
        Ok(Err(err)) => Err(Error::ArtifactCollection(format!(
            "reading the upload after {received} bytes: {err}"
        ))),
        Err(_elapsed) => Err(Error::ArtifactCollection(format!(
            "upload stalled for {}s (after {received} bytes)",
            idle.as_secs()
        ))),
    }
}

#[cfg(test)]
#[path = "collect.test.rs"]
mod tests;
