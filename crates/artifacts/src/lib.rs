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
//! - [`store`] — the [`ArtifactStore`]: run trees as objects
//!   in the private Blob container, keyed per run id, each upload written under a
//!   fresh generation and made current by a pointer written last. The service
//!   holds no state of its own, so any replica answers any request.
//! - [`api`] — the HTTP surface: the driver's upload (per-job-token), the
//!   publisher's source-tree pull (per-publish-job token), the backend's tree
//!   management (service token), and the reviewer's build/media reads, the reads
//!   built on the [`playable`] resolvers. Every route is served at the root and
//!   under the edge's `/artifacts` prefix.
//! - [`build_rule`] — the pure pieces of the build-serving rule (traversal
//!   guard, content type by name, HTML base relocation, build-output choice)
//!   for serving a build held as objects, held to the contracts rule by golden
//!   tests.
//! - [`playable`] — resolving a run's build, proof, validation, showcase and
//!   asset files for serving.
//! - [`blob`] — the Azure Blob client over the private run-tree container,
//!   authenticated by workload identity in a cluster and by Shared Key against
//!   Azurite.
//! - [`r2`] — the R2 object-store client. The backend's snapshot writes and the
//!   CLI's `tcab publish-asset-reference` still call it directly, an interim edge
//!   until those writes go through this service.
//! - [`public`] — the public dataset's store: the R2 bucket, or an Azurite
//!   container on the local stack, behind one interface.
//! - [`publish`] — the two writes into the public store: a published run's
//!   media copied from its tree (`publish-media`), and the key rule of a
//!   public dataset object (`PUT /public/{key}`).
//! - [`object`] — the shapes both object stores read and write in.
//! - [`auth`] — who is calling: the Access assertion every edge request carries
//!   (checked by [`access`]), or one of the in-cluster tokens, with no route
//!   reachable without one but the health probe.
//! - [`access`] — the verification of the Cloudflare Access assertion.
//! - [`config`] — the environment-sourced configuration.

pub mod access;
pub mod api;
pub mod auth;
pub mod blob;
pub mod build_rule;
pub mod config;
pub mod error;
pub mod object;
pub mod playable;
pub mod public;
pub mod publish;
pub mod r2;
pub mod store;

use std::sync::Arc;

use crate::access::AccessVerifier;
use crate::api::AppState;
use crate::blob::{BlobClient, BlobError};
use crate::config::Config;
use crate::store::{ArtifactStore, BlobStore};

/// A fully wired, runnable artifact service: the Axum router plus its resolved
/// bind address.
pub struct ArtifactService {
    /// The Axum router, ready to be served.
    pub router: axum::Router,
    /// The bind address resolved from configuration.
    pub bind: String,
}

/// Assemble the artifact service from a configuration: the Blob client of the
/// private run-tree container, the public store, the verify HTTP client and the
/// Access verifier, and the router over them. Fails when the container's
/// credential cannot be set up (a workload identity the pod was not given), so
/// the service refuses to start rather than fail every request later.
pub fn build(config: Config) -> Result<ArtifactService, BlobError> {
    let bind = config.bind.clone();
    let http = reqwest::Client::new();
    let runs = BlobClient::new(&config.blob, http.clone())?;
    let public = public::open(&config.public_store, &runs);
    let store = ArtifactStore::new(Arc::new(BlobStore::new(runs)));
    let access = config
        .access
        .as_ref()
        .map(|access| Arc::new(AccessVerifier::new(access, http.clone())));
    let state = AppState {
        store: Arc::new(store),
        upload_limit: api::MAX_UPLOAD_BYTES,
        backend_url: Arc::new(config.backend_url),
        http,
        service_token: config.service_token.map(Arc::new),
        access,
        public,
        transcoder: Arc::new(publish::Ffmpeg::new()),
    };
    Ok(ArtifactService {
        router: api::router(state),
        bind,
    })
}
