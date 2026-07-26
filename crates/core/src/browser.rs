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

use serde::{Deserialize, Serialize};
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

/// One media output the [script driver](drive_script) is asked to produce, passed
/// to the driver as JSON. `kind` is `"image"` or `"video"`.
#[derive(Debug, Clone, Serialize)]
pub struct ScriptOutputSpec {
    /// The output id — the produced file's stem (`<id>.png` or `<id>.webm`).
    pub id: String,
    /// `"image"` or `"video"`.
    pub kind: String,
}

/// One auto verdict the script decided, parsed from the driver's result.
#[derive(Debug, Clone, Deserialize)]
pub struct ScriptVerdict {
    /// The verdict id (a review item's own id, or a `<item>.<sub>` composite).
    pub id: String,
    /// Whether the mechanic passed (true iff every assertion passed).
    pub pass: bool,
    /// The individual assertions the script checked — its proof, both the parts
    /// that held and the parts that failed.
    #[serde(default)]
    pub assertions: Vec<ScriptAssertion>,
}

/// One assertion a script recorded on its way to a [`ScriptVerdict`], parsed from
/// the driver's result — a single mechanical fact, pass or fail.
#[derive(Debug, Clone, Deserialize)]
pub struct ScriptAssertion {
    /// A short human-readable statement of what was checked.
    pub label: String,
    /// Whether this individual check held.
    pub pass: bool,
    /// For a comparison assertion, the required value (what it should have been) —
    /// so a failing check can show the mismatch. `None` for a bare boolean fact.
    #[serde(default)]
    pub expected: Option<String>,
    /// For a comparison assertion, the observed value. `None` for a bare boolean fact.
    #[serde(default)]
    pub actual: Option<String>,
}

/// The result of driving a build through a validation script, parsed from the JSON
/// the [script-mode driver](drive_script) writes.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptDriveResult {
    /// Whether the script executed to completion against a conformant build and
    /// produced every declared output.
    pub ran: bool,
    /// Whether the build installed the debug-API handle at all.
    #[serde(default)]
    pub handle_found: bool,
    /// Whether a `false` [`ran`](Self::ran) is an UNMET PRECONDITION rather than a
    /// debug-API conformance failure: the API answered every call correctly and the
    /// script simply could not find a spot in this build's world to pose its
    /// scenario. Inconclusive, so it does not gate the run.
    #[serde(default)]
    pub precondition_unmet: bool,
    /// Detail about a failed or degraded drive, or `None` when it ran clean.
    #[serde(default)]
    pub detail: Option<String>,
    /// The auto verdicts the script decided.
    #[serde(default)]
    pub verdicts: Vec<ScriptVerdict>,
    /// The declared output ids the script actually produced into the out dir.
    #[serde(default)]
    pub produced_outputs: Vec<String>,
    /// Any console/page errors observed while driving, for diagnostics.
    #[serde(default)]
    pub console_errors: Vec<String>,
}

/// Drive a served build through a validation `script` against its debug-API
/// `handle`, capturing the declared `outputs` into `out_dir`.
///
/// `tick_hz` is the case's fixed simulation rate, forwarded as `--tick-hz` so the
/// driver can relate exact stepping to real time; it is `None` — and the flag is
/// omitted — for a real-time-clocked case.
///
/// Returns the parsed [`ScriptDriveResult`] whenever the driver *ran* — including a
/// non-conformant build (a missing handle or a thrown call), which comes back with
/// [`ran`](ScriptDriveResult::ran) `false` for the caller to gate on. Returns an
/// `Err` only when the driver itself could not run (no Node, no Playwright, no
/// Chromium), which the caller treats as "no browser available" and degrades —
/// exactly as [`capture`] does — so a host without a browser never trips the gate.
#[instrument(name = "browser.drive_script", skip(outputs), fields(url = %url, handle = %handle), err)]
pub fn drive_script(
    url: &str,
    script: &Path,
    handle: &str,
    tick_hz: Option<u32>,
    out_dir: &Path,
    outputs: &[ScriptOutputSpec],
) -> std::result::Result<ScriptDriveResult, String> {
    let driver = driver_path().ok_or_else(|| {
        format!("browser driver not found (set {DRIVER_ENV} or run from the repository root)")
    })?;
    std::fs::create_dir_all(out_dir).map_err(|err| format!("creating out dir: {err}"))?;

    let result_path = out_dir.join(".drive-result.json");
    let outputs_json =
        serde_json::to_string(outputs).map_err(|err| format!("encoding outputs: {err}"))?;

    let mut command = Command::new("node");
    command.arg(&driver).args([
        "--mode",
        "script",
        "--url",
        url,
        "--script",
        &script.to_string_lossy(),
        "--handle",
        handle,
        "--out-dir",
        &out_dir.to_string_lossy(),
        "--outputs",
        &outputs_json,
        "--result",
        &result_path.to_string_lossy(),
        "--width",
        &VIEWPORT.0.to_string(),
        "--height",
        &VIEWPORT.1.to_string(),
    ]);
    // The case's fixed simulation rate, when it declares one: it lets the driver
    // relate exact stepping to real time. Omitted entirely for a real-time-clocked
    // case so the driver keeps its own default timing.
    if let Some(tick_hz) = tick_hz {
        command.args(["--tick-hz", &tick_hz.to_string()]);
    }
    if let Some(traceparent) = test_cabinet_telemetry::propagation::current_traceparent() {
        command.env("TRACEPARENT", traceparent);
    }
    let output = command
        .output()
        .map_err(|err| format!("running browser driver via node: {err}"))?;

    // A non-zero exit is an infra failure (no Playwright/Chromium): the driver
    // reports a build/script failure *in the result file* and exits zero. So a
    // non-zero exit means the driver never got far enough to write a verdict — the
    // caller degrades rather than gates.
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message: String = stderr
            .lines()
            .map(str::trim)
            .filter(|line| line.chars().any(|c| c.is_ascii_alphanumeric()))
            .take(4)
            .collect::<Vec<_>>()
            .join("; ");
        return Err(format!("browser driver failed: {message}"));
    }

    let bytes =
        std::fs::read(&result_path).map_err(|err| format!("reading script drive result: {err}"))?;
    let _ = std::fs::remove_file(&result_path);
    serde_json::from_slice(&bytes).map_err(|err| format!("parsing script drive result: {err}"))
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
