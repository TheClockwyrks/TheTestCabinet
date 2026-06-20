//! Serving an asset-generation run's media to the webview.
//!
//! An asset-generation run's result view shows the regenerated image, the target,
//! the model's final preview, and the recorded action log. A *published* run's
//! asset media is uploaded to the backend and served from there, but an
//! unpublished run's media sits only in its collected implementation tree on disk.
//! The web worker serves it over HTTP (`GET /runs/{id}/asset/{file}`); the desktop
//! shell has no HTTP origin, so it serves it to the webview over a custom URI
//! scheme, `tcab-asset://localhost/{id}/{file}`, mirroring [`proof`].
//!
//! Resolving the logical file name to its on-disk artifact — reading the run
//! record and the recorded `validation.asset` paths — lives in
//! [`test_cabinet_core::serve_asset_file`], shared with the HTTP worker so both
//! serve a run's asset media identically.
//!
//! [`proof`]: crate::proof

use tauri::http::{Request, Response, StatusCode, header};
use test_cabinet_core::serve_asset_file;

use crate::config;

/// The custom URI scheme an asset-generation run's media is served under. The
/// webview loads a file at `tcab-asset://localhost/{id}/{file}` where `{file}` is
/// `regenerated.png`, `preview.png`, `target.png`, or `actions.json` (the URL the
/// desktop worker transport builds — see `tauriWorker.ts`).
pub const SCHEME: &str = "tcab-asset";

/// Handle a `tcab-asset://` request: resolve `/{id}/{file}` to that run's asset
/// media on disk and return it. An unknown run, a run that is not asset-generation,
/// or media that is not on disk all return a `404`.
pub fn handle_request(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    // The path is `/{id}/{file}`; the host (`localhost`) is ignored.
    let path = request.uri().path();
    let trimmed = path.trim_start_matches('/');
    let Some((id, file)) = trimmed.split_once('/') else {
        return not_found();
    };
    if id.is_empty() || file.is_empty() {
        return not_found();
    }

    let run_dir = config::output_dir().join(id);
    match serve_asset_file(&run_dir, file) {
        Some(served) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, served.content_type)
            .body(served.body)
            .unwrap_or_else(|_| not_found()),
        None => not_found(),
    }
}

/// A bare `404` response for asset media that could not be served.
fn not_found() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Vec::new())
        .expect("a status-only response is always valid")
}
