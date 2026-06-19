//! The Test Cabinet backend: the centralized source of truth for v0.2.0.
//!
//! See `design/v0.2.0-contracts.md` (authoritative) and the backend overview at
//! `apps/docs/src/content/docs/components/backend/overview.md`. The backend:
//!
//! - serves test-case version definitions resolved from a repo checkout it is
//!   pointed at, copied into an immutable on-disk store on ingest (with reference
//!   screenshots rendered on the backend so every runner shares one baseline);
//! - tracks the latest pullable **image reference** per harness (posted by the
//!   image build/push step), which runners pull by digest from a registry;
//! - is the **system of record** for published runs + reviews in an embedded
//!   SQLite file; and
//! - owns the **synchronized publish path**: a publish ingests into SQLite, then
//!   a coalesced background task regenerates the full public snapshot, uploads it
//!   atomically to R2, and fires the site deploy hook.
//!
//! There is **no app-level auth**: the backend sits on a private network and
//! trusts every caller that can reach it.

pub mod api;
pub mod config;
pub mod db;
pub mod error;
pub mod ingest;
pub mod metrics;
pub mod publisher;
pub mod r2;
pub mod render;
pub mod snapshot;
pub mod store;

use std::sync::Arc;

use crate::api::AppState;
use crate::config::Config;
use crate::db::Db;
use crate::publisher::Publisher;
use crate::r2::R2Client;
use crate::store::DefinitionStore;

/// A fully wired, runnable backend: the Axum router plus the spawned background
/// refresher that keeps the snapshot up to date.
pub struct Backend {
    /// The Axum router, ready to be served.
    pub router: axum::Router,
    /// The bind address resolved from configuration.
    pub bind: String,
    /// The background refresher handle; kept alive for the server's lifetime.
    pub refresher: crate::publisher::RefresherHandle,
}

/// Assemble a backend from a configuration: open the store and SQLite db, build
/// the publisher (with R2 when configured), spawn the coalescing refresher, and
/// construct the router. The `TCAB_REFERENCE_BROWSER` override is exported into
/// the environment the bundled driver reads, so ingest renders with it.
pub fn build(config: Config) -> error::Result<Backend> {
    if let Some(browser) = &config.reference_browser {
        // The bundled driver honors this when launching Chromium for the ingest
        // reference render (the render that moved off the runner).
        // SAFETY: set once at startup, before any threads render references.
        unsafe {
            std::env::set_var("TCAB_REFERENCE_BROWSER", browser);
        }
    }

    let store = DefinitionStore::open(&config.store)?;
    let db = Arc::new(Db::open(&config.db_path)?);
    let r2 = config.r2.clone().map(R2Client::new);

    let publisher = Publisher::new(
        Arc::clone(&db),
        store.clone(),
        r2,
        config.deploy_hook_url.clone(),
        config.coalesce,
    );
    let refresher = publisher.spawn();

    let bind = config.bind.clone();
    let state = AppState {
        db,
        store,
        publisher,
        config: Arc::new(config),
    };
    let router = api::router(state);

    Ok(Backend {
        router,
        bind,
        refresher,
    })
}
