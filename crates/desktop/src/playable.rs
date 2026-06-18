//! Serving a produced run's playable build to the webview.
//!
//! A reviewer must be able to play a run's build *before* it is published — that
//! is the point of reviewing — but an unpublished run has no deployed Cloudflare
//! URL yet. Its static build does sit on disk beside the collected implementation,
//! so the desktop shell serves it to the webview over a custom URI scheme,
//! `tcab-build://localhost/{id}/…`. The run list points each unpublished run's
//! `playableBuild` link at this scheme (see [`crate::commands`]), and the embed in
//! the reporter loads it like any other build.
//!
//! The heavy lifting — locating the build output, MIME types, and relocating the
//! build's HTML under the per-run base path so its absolute asset references
//! resolve — lives in [`test_cabinet_core::playable`], shared with the HTTP
//! worker so both serve a build identically.

use tauri::http::{Request, Response, StatusCode, header};
use test_cabinet_core::{find_build_output, serve_build_file};

use crate::config;

/// The custom URI scheme produced-run builds are served under. The webview reaches
/// a build at `tcab-build://localhost/{id}/` (its `index.html`) and the build's
/// own assets resolve beneath that.
pub const SCHEME: &str = "tcab-build";

/// The base URL a produced run's build is mounted at, used both as the
/// `playableBuild` link and as the base its HTML is relocated under.
pub fn build_base_url(run_id: &str) -> String {
    format!("{SCHEME}://localhost/{run_id}/")
}

/// Handle a `tcab-build://` request: resolve `/{id}/{path}` to a file in that
/// run's static build output and return it, relocating HTML under the run's base.
/// An unknown run, a run with no build, or a path that does not resolve to a file
/// inside the build all return a `404`.
pub fn handle_request(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    // The path is `/{id}/{rest…}`; the host (`localhost`) is ignored.
    let path = request.uri().path();
    let trimmed = path.trim_start_matches('/');
    let (id, rest) = match trimmed.split_once('/') {
        Some((id, rest)) => (id, rest),
        None => (trimmed, ""),
    };
    if id.is_empty() {
        return not_found();
    }

    let impl_dir = config::output_dir().join(id).join("implementation");
    let Some(build_dir) = find_build_output(&impl_dir) else {
        return not_found();
    };
    match serve_build_file(&build_dir, rest, &build_base_url(id)) {
        Some(file) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, file.content_type)
            .body(file.body)
            .unwrap_or_else(|_| not_found()),
        None => not_found(),
    }
}

/// A bare `404` response for a build file that could not be served.
fn not_found() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Vec::new())
        .expect("a status-only response is always valid")
}
