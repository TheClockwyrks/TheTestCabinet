//! The Axum HTTP surface: shared state and router wiring (§1 of
//! `design/v0.2.0-contracts.md`).
//!
//! There is **no app-level auth** — the backend trusts every caller that can
//! reach it (the private-network model). Handlers are grouped by area into the
//! submodules below; this module owns the shared [`AppState`] and assembles the
//! router every endpoint is mounted on.

use std::sync::Arc;

use axum::Router;
use axum::routing::{get, post};

use crate::config::Config;
use crate::db::Db;
use crate::publisher::Publisher;
use crate::store::DefinitionStore;

mod containers;
mod ingest_api;
mod runs;
mod test_cases;

/// Shared application state handed to every handler.
#[derive(Clone)]
pub struct AppState {
    /// The system-of-record SQLite store.
    pub db: Arc<Db>,
    /// The on-disk definition store.
    pub store: DefinitionStore,
    /// The coalescing snapshot publisher.
    pub publisher: Publisher,
    /// The resolved configuration (checkout path for ingest, etc.).
    pub config: Arc<Config>,
}

/// Build the Axum router with every contract endpoint mounted.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(health))
        .route("/ingest", post(ingest_api::ingest))
        .route("/test-cases", get(test_cases::catalog))
        .route("/test-cases/{slug}/versions", get(test_cases::versions))
        .route(
            "/test-cases/{slug}/versions/{version}",
            get(test_cases::resolve_version),
        )
        .route(
            "/test-cases/{slug}/versions/{version}/artifacts/{*path}",
            get(test_cases::artifact),
        )
        .route(
            "/test-cases/{slug}/versions/{version}/references/{scope}/{view}",
            get(test_cases::reference),
        )
        .route("/containers", get(containers::list))
        .route("/containers/{harness}", get(containers::resolve))
        .route("/containers/{harness}/files/{*path}", get(containers::file))
        .route("/runs", post(runs::publish).get(runs::list))
        .route("/runs/{id}", get(runs::get))
        .route("/snapshot/refresh", post(runs::refresh))
        .with_state(state)
}

/// The contract version this backend implements, reported by `/healthz`. This
/// is the API contract milestone (§1.1's literal `"0.2.0"`), independent of the
/// crate's `version` (the workspace pins all crates at a placeholder `0.0.0`).
const CONTRACT_VERSION: &str = "0.2.0";

/// `GET /healthz` — liveness/readiness probe (§1.1).
async fn health() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "status": "ok",
        "version": CONTRACT_VERSION,
        "store": "ready",
    }))
}
