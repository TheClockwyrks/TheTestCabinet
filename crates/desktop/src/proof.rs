//! Serving a produced run's proof-of-implementation media to the webview.
//!
//! A reviewer judges a run partly on the evidence the agent submitted — the
//! screenshots and short clips it wrote to the case's declared proof paths. A
//! *published* run's proofs are uploaded to the backend and served from there, but
//! an unpublished run's proofs sit only in its collected implementation tree on
//! disk. The web worker serves those over HTTP (`GET /runs/{id}/proof/{file}`); the
//! desktop shell has no HTTP origin, so it serves them to the webview over a custom
//! URI scheme, `tcab-proof://localhost/{id}/{file}`, mirroring how [`playable`]
//! serves an unpublished build.
//!
//! Resolving the proof id to its on-disk media — reading the run record, matching
//! `validation.proofs`, and reading the file at the proof's recorded `dest` — lives
//! in [`test_cabinet_core::serve_proof_file`], shared with the HTTP worker so both
//! serve a run's proofs identically.
//!
//! [`playable`]: crate::playable

use tauri::http::{Request, Response, StatusCode, header};
use test_cabinet_core::serve_proof_file;

use crate::config;

/// The custom URI scheme produced-run proof media is served under. The webview
/// loads a proof file at `tcab-proof://localhost/{id}/{proof-id}.{ext}` (the URL
/// the desktop worker transport builds for a local run — see `tauriWorker.ts`).
pub const SCHEME: &str = "tcab-proof";

/// Handle a `tcab-proof://` request: resolve `/{id}/{file}` to that run's proof
/// media on disk and return it. An unknown run, an undeclared proof, or media that
/// is not on disk all return a `404`.
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
    match serve_proof_file(&run_dir, file) {
        Some(served) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, served.content_type)
            .body(served.body)
            .unwrap_or_else(|_| not_found()),
        None => not_found(),
    }
}

/// A bare `404` response for proof media that could not be served.
fn not_found() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Vec::new())
        .expect("a status-only response is always valid")
}
