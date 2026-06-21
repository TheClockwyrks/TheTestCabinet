//! Serving a tournament match's replay to the webview.
//!
//! A persisted tournament's per-match replays sit in the local store at
//! `<output_dir>/tournaments/<tid>/matches/<mid>/replay.json`. A *published*
//! tournament's replays are served by the backend; a locally-run one has no HTTP
//! origin, so the desktop shell serves them to the webview over a custom URI
//! scheme, `tcab-tournament://localhost/{tid}/{mid}/replay.json`, mirroring
//! [`asset`](crate::asset). The path shape differs from `tcab-asset`'s
//! `{id}/{file}` (a tournament has two ids), so it is its own scheme.

use tauri::http::{Request, Response, StatusCode, header};

use crate::config;

/// The custom URI scheme a tournament match's replay is served under. The webview
/// loads `tcab-tournament://localhost/{tid}/{mid}/replay.json` (the URL the desktop
/// transport builds — see `tauriWorker.ts`).
pub const SCHEME: &str = "tcab-tournament";

/// Reject a path segment that is empty or could escape the store.
fn is_safe_segment(segment: &str) -> bool {
    !segment.is_empty() && segment != "." && segment != ".." && !segment.contains('\\')
}

/// Handle a `tcab-tournament://` request: resolve `/{tid}/{mid}/replay.json` to
/// that match's replay on disk and return it. Anything malformed or not on disk
/// returns a `404`.
pub fn handle_request(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    // The path is `/{tid}/{mid}/replay.json`; the host (`localhost`) is ignored.
    let path = request.uri().path();
    let trimmed = path.trim_start_matches('/');
    let segments: Vec<&str> = trimmed.split('/').collect();
    let [tid, mid, "replay.json"] = segments.as_slice() else {
        return not_found();
    };
    if !is_safe_segment(tid) || !is_safe_segment(mid) {
        return not_found();
    }

    let replay_path = config::output_dir()
        .join("tournaments")
        .join(tid)
        .join("matches")
        .join(mid)
        .join("replay.json");
    match std::fs::read(&replay_path) {
        Ok(body) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/json")
            .body(body)
            .unwrap_or_else(|_| not_found()),
        Err(_) => not_found(),
    }
}

/// A bare `404` response for a replay that could not be served.
fn not_found() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Vec::new())
        .expect("a status-only response is always valid")
}
