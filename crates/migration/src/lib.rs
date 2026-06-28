//! The schema migration for the backend's SeaORM store.
//!
//! A single migration creates the four tables of `design/v0.2.0-contracts.md` §2
//! (`run`, `review`, `run_link`, `snapshot_state`) and the `run` indices. It is
//! run at backend startup via [`Migrator::up`], and applies identically to the
//! SQLite (local/tests) and PostgreSQL (deployment) backends because it is built
//! from SeaORM's portable schema builder rather than backend-specific SQL.
//!
//! There is no data-migration logic: this is the initial schema for a store that
//! has never held data worth keeping.

pub use sea_orm_migration::prelude::*;

mod m20260619_000001_create_initial_schema;
mod m20260621_000002_create_tournament;
mod m20260623_000003_create_job;
mod m20260628_000004_create_publish_job;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20260619_000001_create_initial_schema::Migration),
            Box::new(m20260621_000002_create_tournament::Migration),
            Box::new(m20260623_000003_create_job::Migration),
            Box::new(m20260628_000004_create_publish_job::Migration),
        ]
    }
}
