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
//! - [`api`] — the HTTP surface: the driver's upload (per-job-token), the
//!   publisher's source-tree pull (per-publish-job token), the backend's tree
//!   management (service token), and the reviewer's build/media reads, the reads
//!   built on the **shared core resolvers** so serving logic is reused, not
//!   reinvented. Every route is served at the root and under the edge's
//!   `/artifacts` prefix.
//! - [`auth`] — who is calling: the Access assertion every edge request carries
//!   (checked by [`access`]), or one of the in-cluster tokens, with no route
//!   reachable without one but the health probe.
//! - [`access`] — the verification of the Cloudflare Access assertion.
//! - [`config`] — the environment-sourced configuration.

pub mod access;
pub mod api;
pub mod auth;
pub mod config;
pub mod error;
pub mod store;

use std::sync::Arc;

use crate::access::AccessVerifier;
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
/// (creating its root if missing), build the verify HTTP client and the Access
/// verifier, and construct the router. Fails only if the store root cannot be created (an unwritable PVC) — the
/// service refuses to start rather than fail every upload later.
pub fn build(config: Config) -> Result<ArtifactService, store::StoreError> {
    let store = LocalFsStore::new(&config.root)?;
    let bind = config.bind.clone();
    let http = reqwest::Client::new();
    let access = config
        .access
        .as_ref()
        .map(|access| Arc::new(AccessVerifier::new(access, http.clone())));
    let state = AppState {
        store: Arc::new(store),
        backend_url: Arc::new(config.backend_url),
        http,
        service_token: config.service_token.map(Arc::new),
        access,
    };
    Ok(ArtifactService {
        router: api::router(state),
        bind,
    })
}
