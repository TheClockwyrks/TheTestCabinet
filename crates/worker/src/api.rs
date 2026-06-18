//! The worker's Axum HTTP surface: shared state and router wiring.
//!
//! The worker exposes the core run lifecycle over HTTP (`worker/overview.md`): it
//! accepts a run request, drives it through the core, streams the live harness
//! events back, produces the same run record a local run would, and can publish
//! on the same terms. There is **no app-level auth** — like the backend it sits
//! on a private network and trusts every caller that can reach it.
//!
//! Handlers are grouped by area into the submodules below; this module owns the
//! shared [`AppState`] and assembles the router.

use std::sync::Arc;

use axum::Router;
use axum::extract::State;
use axum::routing::{get, post};
use tower_http::cors::CorsLayer;

use crate::config::Config;
use crate::jobs::JobRegistry;

mod publish_api;
mod runs;

/// Shared application state handed to every handler.
#[derive(Clone)]
pub struct AppState {
    /// The resolved configuration (backend URL, staging/output dirs).
    pub config: Arc<Config>,
    /// The registry of submitted run jobs.
    pub jobs: JobRegistry,
}

/// The contract version this worker reports from `/healthz`. The worker tracks
/// the same v0.2.0 milestone as the backend; the crate `version` is the
/// workspace placeholder (`0.0.0`) and is independent of this.
const CONTRACT_VERSION: &str = "0.2.0";

/// Build the Axum router with every worker endpoint mounted.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(health))
        // Submit a run (returns a job id), list produced runs, look one up by id.
        .route("/runs", post(runs::submit).get(runs::list_produced))
        .route("/runs/{job}", get(runs::status))
        // The live harness-event stream for a job, as NDJSON.
        .route("/runs/{job}/events", get(runs::events))
        // A finished run's recorded streams, served from disk as NDJSON: the
        // normalized event log and the raw harness output. Keyed by run-record
        // id, these back the run-detail Events tab after the live job is gone.
        .route("/runs/{id}/events.jsonl", get(runs::events_file))
        .route("/runs/{id}/raw.jsonl", get(runs::raw_file))
        // Serve a produced run's playable build (the static output collected
        // beside its implementation) so a reviewer can play it before it is
        // published. `{id}` is the run-record id the produced-run list reports.
        // Both the bare and trailing-slash roots serve the build's index.html;
        // the wildcard serves the assets it references (the wildcard does not
        // match an empty tail, so the trailing-slash root is its own route).
        .route("/runs/{id}/build", get(runs::build_root))
        .route("/runs/{id}/build/", get(runs::build_root))
        .route("/runs/{id}/build/{*path}", get(runs::build_path))
        // Publish a finished run: release code, deploy the build, submit to the
        // backend — the same terms a local `tcab publish` uses.
        .route("/publish", post(publish_api::publish))
        // The browser UIs reach the worker from a different localhost origin, so
        // requests — including the best-effort `/healthz` identity probe — are
        // cross-origin. The worker shares the backend's no-auth, reachability-is-
        // the-boundary model, so mirror its permissive CORS policy. No credentials
        // are sent, so a wildcard origin is valid.
        .layer(CorsLayer::permissive())
        .with_state(state)
}

/// `GET /healthz` — liveness/readiness probe.
///
/// Reports `backendUrl`: the backend this worker resolves definitions from and
/// publishes to. The UI compares it against the backend it is itself pointed at
/// to confirm a worker shares its backend; without it the worker reads as
/// "unverified" because there is nothing to check against.
async fn health(State(state): State<AppState>) -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "status": "ok",
        "version": CONTRACT_VERSION,
        "role": "worker",
        "backendUrl": state.config.backend_url,
    }))
}
