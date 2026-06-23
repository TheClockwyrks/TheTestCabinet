//! The Test Cabinet backend: the centralized source of truth for v0.2.0.
//!
//! See `design/v0.2.0-contracts.md` (authoritative) and the backend overview at
//! `apps/docs/src/content/docs/components/backend/overview.md`. The backend:
//!
//! - serves test-case version definitions resolved from a repo checkout it is
//!   pointed at, copied into an immutable on-disk store on ingest (with reference
//!   screenshots rendered on the backend so every runner shares one baseline);
//! - plays **no part in container distribution**: every run executes in one
//!   shared base run-container image that runners pull by digest from a registry
//!   per their own configuration (and install the harness CLI into at run time);
//! - is the **system of record** for published runs + reviews in a SeaORM store
//!   (SQLite locally and in tests, PostgreSQL in deployments); and
//! - owns the **synchronized publish path**: a publish ingests into SQLite, then
//!   a coalesced background task regenerates the full public snapshot, uploads it
//!   atomically to R2, and fires the site deploy hook.
//!
//! There is **no app-level auth**: the backend sits on a private network and
//! trusts every caller that can reach it.

pub mod api;
pub mod auth;
pub mod config;
pub mod db;
pub mod error;
pub mod ingest;
pub mod metrics;
pub mod publisher;
pub mod r2;
pub mod relay;
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

/// Assemble a backend from a configuration: open the definition store, connect
/// the database and migrate its schema, build the publisher (with R2 when
/// configured), spawn the coalescing refresher, and construct the router. The
/// `TCAB_REFERENCE_BROWSER` override is exported into the environment the bundled
/// driver reads, so ingest renders with it.
pub async fn build(config: Config) -> error::Result<Backend> {
    use test_cabinet_migration::MigratorTrait;

    if let Some(browser) = &config.reference_browser {
        // The bundled driver honors this when launching Chromium for the ingest
        // reference render (the render that moved off the runner).
        // SAFETY: set once at startup, before any threads render references.
        unsafe {
            std::env::set_var("TCAB_REFERENCE_BROWSER", browser);
        }
    }

    let store = DefinitionStore::open(&config.store)?;
    let db = Db::connect(&config.database_url).await?;
    // Apply the schema before serving. The migration is idempotent, so an
    // already-migrated store (a restart, or a shared deployment database) is a
    // no-op beyond the version check.
    test_cabinet_migration::Migrator::up(db.connection(), None).await?;
    let db = Arc::new(db);
    let r2 = config.r2.clone().map(R2Client::new);

    let publisher = Publisher::new(
        Arc::clone(&db),
        store.clone(),
        r2,
        config.deploy_hook_url.clone(),
        config.coalesce,
    );
    let refresher = publisher.spawn();

    // The client the auth middleware verifies bearer tokens against. Constructed
    // once and shared; it holds only the auth service base URL.
    let auth = Arc::new(test_cabinet_core::AccountsClient::new(
        config.auth_url.clone(),
    ));

    let bind = config.bind.clone();
    let state = AppState {
        db,
        store,
        publisher,
        auth,
        relay: crate::relay::Relay::new(),
        config: Arc::new(config),
    };
    let router = api::router(state);

    Ok(Backend {
        router,
        bind,
        refresher,
    })
}
