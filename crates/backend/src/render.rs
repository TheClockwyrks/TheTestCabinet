//! Backend-side reference rendering (resolved decision in
//! `design/v0.2.0-contracts.md` §0 and §4).
//!
//! In v0.2.0 the reference mockups are rendered to screenshots **at ingest, on
//! the backend**, not on each runner. That makes the validation baseline byte
//! identical across every runner. This reuses the same bundled headless-browser
//! driver `core::browser` already drives for the runner's load check, so there is
//! one render path, not two.
//!
//! Rendering degrades the way the runner's did: a view that cannot be rendered
//! (no browser available) is reported back to the caller, which decides whether
//! to fail the ingest. The backend treats a render failure as fatal for that
//! version's ingest, since serving a version with a missing baseline would let a
//! runner validate against a hole.

use std::path::Path;

use test_cabinet_core::browser;
use test_cabinet_core::test_case::CheckAction;

/// Render a single reference mockup file to a PNG at `out`.
///
/// `source` is the host path to the mockup HTML (inside the checkout). Returns a
/// human-readable error when the browser driver is missing or the capture fails,
/// mirroring `core::browser::capture`'s contract so the caller can attribute the
/// failure to a specific view.
pub fn render_reference(source: &Path, out: &Path) -> Result<(), String> {
    let url = file_url(source);
    // No actions: a reference mockup is a static page, captured as it loads.
    let no_actions: [CheckAction; 0] = [];
    browser::capture(&url, &no_actions, out)
}

/// Build a `file://` URL for a local mockup, resolving it to an absolute path so
/// the browser loads it regardless of the process working directory. This is the
/// same construction the retired runner-side renderer used.
fn file_url(path: &Path) -> String {
    let absolute = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    path_to_file_url(&absolute)
}

#[cfg(windows)]
fn path_to_file_url(path: &Path) -> String {
    let raw = path.to_string_lossy();
    let without_verbatim = raw
        .strip_prefix(r"\\?\")
        .or_else(|| raw.strip_prefix(r"\??\"))
        .unwrap_or(&raw);
    format!("file:///{}", without_verbatim.replace('\\', "/"))
}

#[cfg(not(windows))]
fn path_to_file_url(path: &Path) -> String {
    format!("file://{}", path.display())
}
