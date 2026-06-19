//! Shared headless-browser plumbing.
//!
//! Both reference rendering (see [`crate::reference`]) and the load-check
//! validator drive a headless browser through the bundled Playwright driver
//! script (`packages/browser-driver/driver.mjs`) and, for captures, serve a
//! built site over a tiny static file server. That shared machinery lives here.
//!
//! The driver is invoked out-of-process via `node`, so a host without Node, the
//! Playwright npm package, or its browser binaries simply fails the driver call;
//! callers treat that as "no browser available" and degrade rather than error.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc;
use std::thread;

use tracing::instrument;
use uuid::Uuid;

use crate::test_case::CheckAction;

/// The viewport every reference and capture is rendered at.
pub const VIEWPORT: (u32, u32) = (1280, 720);

/// Environment variable naming an explicit path to the driver script, used when
/// the harness runs from a directory the relative candidates do not cover.
const DRIVER_ENV: &str = "TCAB_BROWSER_DRIVER";

/// Candidate locations for the bundled driver, relative to the current
/// directory. Runs are launched from the repository root (so the `test-cases/`
/// catalog resolves), which is also where the npm workspace lives.
const DRIVER_CANDIDATES: [&str; 2] = [
    "packages/browser-driver/driver.mjs",
    "../packages/browser-driver/driver.mjs",
];

/// Locate the browser driver script, honoring `TCAB_BROWSER_DRIVER` first.
pub fn driver_path() -> Option<PathBuf> {
    if let Some(explicit) = std::env::var_os(DRIVER_ENV) {
        let path = PathBuf::from(explicit);
        return path.is_file().then_some(path);
    }
    DRIVER_CANDIDATES
        .iter()
        .map(PathBuf::from)
        .find(|p| p.is_file())
}

/// Open `url` in the headless browser, run `actions`, and screenshot to `out`.
///
/// `url` may be a `file://` mockup or an `http://` served build. Returns a
/// human-readable error when the driver is missing or the capture fails, so the
/// caller can record a degraded signal instead of failing the run.
#[instrument(name = "browser.capture", skip(actions), fields(url = %url, action_count = actions.len()), err)]
pub fn capture(url: &str, actions: &[CheckAction], out: &Path) -> std::result::Result<(), String> {
    let driver = driver_path().ok_or_else(|| {
        format!("browser driver not found (set {DRIVER_ENV} or run from the repository root)")
    })?;

    let parent = out.parent().unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(parent).map_err(|err| format!("creating capture dir: {err}"))?;

    // Render to a unique temporary file in the destination directory, then
    // atomically rename it into place. Reference screenshots are cached at a
    // stable path that is shared across runs; rendering is deterministic, so two
    // runs producing the same screenshot write identical bytes and the only
    // hazard is a torn file from two writers racing on one path. Writing to a
    // private temp and renaming means every reader sees a complete image.
    let temp = parent.join(format!(
        ".{}.{}.tmp",
        out.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("capture"),
        Uuid::new_v4(),
    ));

    let actions_json =
        serde_json::to_string(actions).map_err(|err| format!("encoding actions: {err}"))?;

    let mut command = Command::new("node");
    command.arg(&driver).args([
        "--url",
        url,
        "--out",
        &temp.to_string_lossy(),
        "--actions",
        &actions_json,
        "--width",
        &VIEWPORT.0.to_string(),
        "--height",
        &VIEWPORT.1.to_string(),
    ]);
    // Propagate the current trace context to the driver process so a browser
    // capture can be correlated back to its run; a no-op when nothing is in
    // scope to propagate.
    if let Some(traceparent) = test_cabinet_telemetry::propagation::current_traceparent() {
        command.env("TRACEPARENT", traceparent);
    }
    let output = command
        .output()
        .map_err(|err| format!("running browser driver via node: {err}"))?;

    if !output.status.success() || !temp.is_file() {
        // Best-effort cleanup; a partial temp must not be left behind.
        let _ = std::fs::remove_file(&temp);
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Surface the first meaningful lines. The driver prints the error message
        // first, but a Playwright failure follows it with a box-drawing banner;
        // skipping lines with no alphanumerics drops that art and keeps the
        // actual message (e.g. "Executable doesn't exist at …").
        let message: String = stderr
            .lines()
            .map(str::trim)
            .filter(|line| line.chars().any(|c| c.is_ascii_alphanumeric()))
            .take(4)
            .collect::<Vec<_>>()
            .join("; ");
        return Err(format!("browser driver failed: {message}"));
    }

    std::fs::rename(&temp, out).map_err(|err| {
        let _ = std::fs::remove_file(&temp);
        format!("finalizing capture {}: {err}", out.display())
    })?;
    Ok(())
}

/// A minimal blocking static file server used to serve builds for capture.
///
/// It serves files from a root directory and falls back to `index.html` so that
/// single-page builds load. It runs on a background thread and is torn down when
/// dropped.
pub struct StaticServer {
    port: u16,
    shutdown: Option<mpsc::Sender<()>>,
    handle: Option<thread::JoinHandle<()>>,
}

impl StaticServer {
    /// Bind an ephemeral port and start serving `root`.
    pub fn start(root: PathBuf) -> std::io::Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let port = listener.local_addr()?.port();
        listener.set_nonblocking(true)?;
        let (shutdown, rx) = mpsc::channel();

        let handle = thread::spawn(move || {
            loop {
                if rx.try_recv().is_ok() {
                    break;
                }
                match listener.accept() {
                    Ok((stream, _)) => {
                        let _ = serve_one(stream, &root);
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(std::time::Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
        });

        Ok(Self {
            port,
            shutdown: Some(shutdown),
            handle: Some(handle),
        })
    }

    /// The port the server is listening on.
    pub fn port(&self) -> u16 {
        self.port
    }

    /// The base URL the server is reachable at.
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}/", self.port)
    }
}

impl Drop for StaticServer {
    fn drop(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

/// Serve a single HTTP request, with SPA fallback to `index.html`.
fn serve_one(mut stream: TcpStream, root: &Path) -> std::io::Result<()> {
    let mut buffer = [0u8; 8192];
    let read = stream.read(&mut buffer)?;
    let request = String::from_utf8_lossy(&buffer[..read]);
    let target = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("/");
    let relative = target
        .trim_start_matches('/')
        .split('?')
        .next()
        .unwrap_or("");

    let mut path = if relative.is_empty() {
        root.join("index.html")
    } else {
        root.join(relative)
    };
    if path.is_dir() {
        path = path.join("index.html");
    }
    if !path.is_file() {
        path = root.join("index.html");
    }

    match std::fs::read(&path) {
        Ok(body) => {
            let content_type = content_type_for(&path);
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream.write_all(header.as_bytes())?;
            stream.write_all(&body)?;
        }
        Err(_) => {
            stream.write_all(
                b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            )?;
        }
    }
    stream.flush()
}

/// A best-effort content type for a static asset.
fn content_type_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript",
        Some("css") => "text/css",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("wasm") => "application/wasm",
        _ => "application/octet-stream",
    }
}
