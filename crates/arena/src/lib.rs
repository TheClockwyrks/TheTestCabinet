//! The Test Cabinet arena service: the execution host for adversarial **matches**
//! and **tournaments**.
//!
//! The adversarial test type pits controller WASM programs head-to-head. Running
//! those matches is **CPU-bound in-process wasm** (via the shared `foray-host`
//! sandbox the engine reuses) — fast, but heavy — so it lives in its own dedicated
//! service rather than the single-replica control-plane backend. This is the same
//! control-plane/data-plane split the whole service topology is built on: the
//! backend owns the data (controller inputs, published tournaments, stored
//! replays); the arena owns the *execution*.
//!
//! The service is **stateless and decoupled over HTTP**. It holds no database and no
//! disk: it fetches every controller input from the backend (resolve a version,
//! baseline `references/<id>.wasm`, a pushed run's `controller.wasm`, the
//! pushed-controller listing) and persists finished tournaments + their per-match
//! replays back to the backend — all through the shared
//! [`HttpBackendClient`](test_cabinet_core::HttpBackendClient) against the existing
//! backend endpoints. No new backend routes.
//!
//! The pieces:
//!
//! - [`api`] — the HTTP surface: list pittable controllers, run one transient match,
//!   submit a tournament, poll its status, and stream live per-match progress. These
//!   are the worker's old **execution** endpoints, ported verbatim so the console's
//!   hand-typed transport reads them unchanged.
//! - [`arena_resolve`] — resolving a controller's wasm against the backend
//!   (baselines + pushed runs only; run-local controllers are not resolvable here).
//! - [`tournaments`] — the in-memory tournament-job tracker and its live NDJSON
//!   progress channel. Per-pod, so the Deployment runs a single replica.
//! - [`executor`] — the capacity guard: a semaphore bounding concurrent CPU-bound
//!   work, rejecting with `503` (not queueing) at capacity.
//! - [`config`] — the environment-sourced configuration.
//!
//! The run endpoints are unauthenticated behind the private-network boundary,
//! faithful to the deleted worker the console still posts them token-less to.

pub mod api;
pub mod arena_resolve;
pub mod config;
pub mod error;
pub mod executor;
pub mod tournaments;

use std::sync::Arc;

use crate::api::AppState;
use crate::config::Config;
use crate::executor::MatchExecutor;
use crate::tournaments::TournamentRegistry;

/// A fully wired, runnable arena service: the Axum router plus its resolved bind
/// address.
pub struct ArenaService {
    /// The Axum router, ready to be served.
    pub router: axum::Router,
    /// The bind address resolved from configuration.
    pub bind: String,
}

/// Assemble the arena service from a configuration: an empty tournament registry, a
/// capacity-bounded executor, and the backend URL the handlers resolve and publish
/// against. It opens no store and reaches no disk — it is stateless — so this never
/// fails.
pub fn build(config: Config) -> ArenaService {
    let bind = config.bind.clone();
    let state = AppState {
        backend_url: Arc::new(config.backend_url),
        tournaments: TournamentRegistry::new(),
        executor: Arc::new(MatchExecutor::new(config.max_concurrent_matches)),
    };
    ArenaService {
        router: api::router(state),
        bind,
    }
}
