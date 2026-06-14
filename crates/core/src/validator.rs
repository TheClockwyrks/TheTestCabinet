//! Concrete load-check [`Validator`].
//!
//! See `docs/validation.md`. This performs the cheap first pass: it installs and
//! builds the produced implementation as a static site, then — when a headless
//! Chromium is available — serves the build and screenshots the declared views
//! at 1280x720. It is a signal, not a pass/fail gate, so a missing browser
//! degrades to a build-only signal rather than failing the run.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc;
use std::thread;

use crate::error::Result;
use crate::execution::ArtifactCollection;
use crate::test_case::TestCaseVersion;
use crate::validation::{CapturedView, LoadCheck, ReferenceComparison, Validator};

/// The viewport every reference and capture is rendered at.
const VIEWPORT: (u32, u32) = (1280, 720);

/// Candidate output directories a static build may produce.
const BUILD_OUTPUTS: [&str; 3] = ["dist", "build", "out"];

/// Candidate headless-browser binaries, in preference order.
const BROWSERS: [&str; 4] = [
    "chromium",
    "chromium-browser",
    "google-chrome-stable",
    "google-chrome",
];

/// A validator that builds the implementation and load-checks it in a browser.
#[derive(Debug, Clone)]
pub struct BuildValidator {
    /// Directory captured screenshots are written under.
    screenshot_dir: PathBuf,
}

impl BuildValidator {
    /// Write captured screenshots under `screenshot_dir`.
    pub fn new(screenshot_dir: impl Into<PathBuf>) -> Self {
        Self {
            screenshot_dir: screenshot_dir.into(),
        }
    }
}

impl Validator for BuildValidator {
    fn load_check(&self, artifacts: &ArtifactCollection) -> Result<LoadCheck> {
        let repo = &artifacts.repo_path;
        if !repo.join("package.json").is_file() {
            return Ok(LoadCheck {
                loaded: false,
                detail: Some("no package.json found in the produced implementation".to_string()),
                screenshots: Vec::new(),
            });
        }

        if let Err(detail) = run_build(repo) {
            return Ok(LoadCheck {
                loaded: false,
                detail: Some(detail),
                screenshots: Vec::new(),
            });
        }

        let Some(output_dir) = BUILD_OUTPUTS
            .iter()
            .map(|d| repo.join(d))
            .find(|p| p.is_dir())
        else {
            return Ok(LoadCheck {
                loaded: false,
                detail: Some("build produced no dist/build/out directory".to_string()),
                screenshots: Vec::new(),
            });
        };

        // The build succeeded. Capturing a rendered screenshot is best-effort: a
        // missing browser leaves the run with a build-only signal.
        match capture_title(&output_dir, &self.screenshot_dir) {
            Ok(Some(view)) => Ok(LoadCheck {
                loaded: true,
                detail: None,
                screenshots: vec![view],
            }),
            Ok(None) => Ok(LoadCheck {
                loaded: true,
                detail: Some(
                    "built successfully; no headless browser available for capture".to_string(),
                ),
                screenshots: Vec::new(),
            }),
            Err(err) => Ok(LoadCheck {
                loaded: true,
                detail: Some(format!(
                    "built successfully; screenshot capture failed: {err}"
                )),
                screenshots: Vec::new(),
            }),
        }
    }

    fn compare_references(
        &self,
        _test_case: &TestCaseVersion,
        _load_check: &LoadCheck,
    ) -> Result<Vec<ReferenceComparison>> {
        // Pixel/structural similarity scoring against the reference visuals is not
        // implemented yet; the load check above is the active signal.
        Ok(Vec::new())
    }
}

/// Install dependencies and run the production build for a project.
fn run_build(repo: &Path) -> std::result::Result<(), String> {
    let install = if repo.join("package-lock.json").is_file() {
        &["ci"][..]
    } else {
        &["install"][..]
    };
    run_npm(repo, install)?;
    run_npm(repo, &["run", "build"])?;
    Ok(())
}

/// Run an npm command in `repo`, returning a description of any failure.
fn run_npm(repo: &Path, args: &[&str]) -> std::result::Result<(), String> {
    let output = Command::new("npm")
        .args(args)
        .current_dir(repo)
        .output()
        .map_err(|err| format!("failed to run `npm {}`: {err}", args.join(" ")))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: String = stderr.lines().rev().take(5).collect::<Vec<_>>().join("; ");
        Err(format!("`npm {}` failed: {tail}", args.join(" ")))
    }
}

/// Serve a built site and screenshot its initial (title) view.
///
/// Returns `Ok(None)` when no headless browser is installed.
fn capture_title(
    output_dir: &Path,
    screenshot_dir: &Path,
) -> std::result::Result<Option<CapturedView>, String> {
    let Some(browser) = BROWSERS.iter().copied().find(on_path) else {
        return Ok(None);
    };

    let server = StaticServer::start(output_dir.to_path_buf())
        .map_err(|err| format!("starting static server: {err}"))?;
    let url = format!("http://127.0.0.1:{}/", server.port());

    std::fs::create_dir_all(screenshot_dir)
        .map_err(|err| format!("creating screenshot dir: {err}"))?;
    let image_path = screenshot_dir.join("title.png");

    let status = Command::new(browser)
        .args([
            "--headless=new",
            "--no-sandbox",
            "--disable-gpu",
            "--hide-scrollbars",
            &format!("--window-size={},{}", VIEWPORT.0, VIEWPORT.1),
            &format!("--screenshot={}", image_path.display()),
            &url,
        ])
        .output()
        .map_err(|err| format!("running {browser}: {err}"))?;

    if !status.status.success() || !image_path.is_file() {
        return Err(format!(
            "{browser} did not produce a screenshot: {}",
            String::from_utf8_lossy(&status.stderr).trim()
        ));
    }

    Ok(Some(CapturedView {
        view: "title".to_string(),
        image_path,
    }))
}

/// Whether a binary resolves on `PATH`.
fn on_path(binary: &&str) -> bool {
    std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).any(|dir| dir.join(binary).is_file()))
        .unwrap_or(false)
}

/// A minimal blocking static file server used only for load-check screenshots.
///
/// It serves files from a root directory and falls back to `index.html` so that
/// single-page builds load. It runs on a background thread and is torn down when
/// dropped.
struct StaticServer {
    port: u16,
    shutdown: Option<mpsc::Sender<()>>,
    handle: Option<thread::JoinHandle<()>>,
}

impl StaticServer {
    /// Bind an ephemeral port and start serving `root`.
    fn start(root: PathBuf) -> std::io::Result<Self> {
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
    fn port(&self) -> u16 {
        self.port
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

// (no extra error helpers needed; validator failures are mapped inline)

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
