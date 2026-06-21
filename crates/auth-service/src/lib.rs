//! The Test Cabinet auth service: the standalone account store.
//!
//! See `apps/docs/src/content/docs/components/auth/overview.md`. The auth service
//! is a small, separately-deployed HTTP service — the only holder of user
//! accounts. It offers open self-registration and password login, minting opaque
//! bearer tokens (Argon2id password hashing, SHA-256 token-at-rest hashing). The
//! backend does not store accounts; it [verifies](test_cabinet_core::AccountsClient::verify)
//! each request's token against this service and attributes the resolved account
//! to the review.
//!
//! It keeps the same posture as the backend and worker: it sits on a private
//! network. User auth is a layer on top of that reachability boundary — accounts
//! make reviews attributable and set up community contributions — not a
//! replacement for it.

pub mod api;
pub mod config;
pub mod db;
pub mod entity;
pub mod error;
pub mod migration;
pub mod secret;

use std::sync::Arc;

use crate::api::AppState;
use crate::config::Config;
use crate::db::Db;

/// A fully wired, runnable auth service: the Axum router plus its resolved bind
/// address.
pub struct AuthService {
    /// The Axum router, ready to be served.
    pub router: axum::Router,
    /// The bind address resolved from configuration.
    pub bind: String,
}

/// Assemble the auth service from a configuration: connect its database, migrate
/// the schema, and construct the router. The migration is idempotent, so a
/// restart (or a shared deployment database) is a no-op beyond the version check.
pub async fn build(config: Config) -> Result<AuthService, sea_orm::DbErr> {
    use sea_orm_migration::MigratorTrait;

    let db = Db::connect(&config.database_url).await?;
    migration::Migrator::up(db.connection(), None).await?;
    let bind = config.bind.clone();
    let state = AppState { db: Arc::new(db) };
    Ok(AuthService {
        router: api::router(state),
        bind,
    })
}
