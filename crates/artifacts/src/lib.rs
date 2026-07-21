//! The Test Cabinet artifact service: the data-plane store and HTTP server for a
//! run's artifacts.
//!
//! A run's artifacts — its generated **source tree**, the built **playable
//! output**, and its **proof/asset media** — must survive the ephemeral driver pod
//! that produced them, from run-finish until the run is published or discarded.
//! The worker used to serve these off its own disk (`/runs/{id}/build|proof|asset`);
//! that role moves *here*, into a dedicated service, **not** into the control-plane
//! backend — so artifact bytes (an upload, or a reviewer's heavy build pull) never
//! transit the single-replica backend and serving can scale independently. This is
//! the same control-plane/data-plane split the whole per-run-Job refactor is built
//! on: the driver sends *status* to the backend and *blobs* here.
//!
//! The pieces:
//!
//! - [`store`] — the [`ArtifactStore`](store::ArtifactStore) trait and its
//!   [`LocalFsStore`] impl (a directory on a PVC), keyed per
//!   run id. An R2 impl is a deferrable internal detail (see the trait's docs).
//! - [`api`] — the HTTP surface: the driver's upload (per-job-token) and the
//!   reviewer's ungated build/media reads, the reads built on the **shared core
//!   resolvers** so serving logic is reused, not reinvented.
//! - [`auth`] — upload auth (per-job token forwarded to the backend's verify
//!   endpoint); reads are ungated because the console loads them as browser media.
//! - [`config`] — the environment-sourced configuration.
//!
//! Like the backend and auth service it sits behind a private-network boundary.
//! The upload's per-job token is a layer on top of that; reads rely on the boundary
//! alone (plus unguessable run ids), matching the backend's signed-out run reads —
//! browser-loaded media (`<img>`/`<iframe>`) cannot present a token.

pub mod api;
pub mod auth;
pub mod config;
pub mod error;
pub mod store;

use std::sync::Arc;

use crate::api::AppState;
use crate::config::Config;
use crate::store::LocalFsStore;

/// A fully wired, runnable artifact service: the Axum router plus its resolved
/// bind address.
pub struct ArtifactService {
    /// The Axum router, ready to be served.
    pub router: axum::Router,
    /// The bind address resolved from configuration.
    pub bind: String,
}

/// Assemble the artifact service from a configuration: open the local-fs store
/// (creating its root if missing), build the verify HTTP client, and construct the
/// router. Fails only if the store root cannot be created (an unwritable PVC) — the
/// service refuses to start rather than fail every upload later.
pub fn build(config: Config) -> Result<ArtifactService, store::StoreError> {
    let store = LocalFsStore::new(&config.root)?;
    let bind = config.bind.clone();
    let state = AppState {
        store: Arc::new(store),
        backend_url: Arc::new(config.backend_url),
        http: reqwest::Client::new(),
        service_token: config.service_token.map(Arc::new),
    };
    Ok(ArtifactService {
        router: api::router(state),
        bind,
    })
}
