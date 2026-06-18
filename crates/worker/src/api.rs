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
use axum::routing::{get, post};

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
        // Submit a run (returns a job id) and look one up by id.
        .route("/runs", post(runs::submit))
        .route("/runs/{job}", get(runs::status))
        // The live harness-event stream for a job, as NDJSON.
        .route("/runs/{job}/events", get(runs::events))
        // Publish a finished run: release code, deploy the build, submit to the
        // backend — the same terms a local `tcab publish` uses.
        .route("/publish", post(publish_api::publish))
        .with_state(state)
}

/// `GET /healthz` — liveness/readiness probe.
async fn health() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "status": "ok",
        "version": CONTRACT_VERSION,
        "role": "worker",
    }))
}
