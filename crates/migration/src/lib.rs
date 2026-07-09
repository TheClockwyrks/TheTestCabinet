//! The schema migrations for the backend's SeaORM store.
//!
//! The initial migration creates the four tables of `design/v0.2.0-contracts.md`
//! §2 (`run`, `review`, `run_link`, `snapshot_state`) and the `run` indices;
//! later migrations add the tournament, job, and publish-job tables and the
//! model-catalog tables (`model`, `model_alias`, `model_price`). They run at
//! backend startup via [`Migrator::up`], and apply identically to the SQLite
//! (local/tests) and PostgreSQL (deployment) backends because they are built from
//! SeaORM's portable schema builder rather than backend-specific SQL.
//!
//! Data normalization that needs application logic or network access (such as
//! re-associating `:free`-tagged runs to their base model and re-pricing them)
//! runs as an idempotent startup routine in the backend, not as a migration here.

pub use sea_orm_migration::prelude::*;

mod m20260619_000001_create_initial_schema;
mod m20260621_000002_create_tournament;
mod m20260623_000003_create_job;
mod m20260628_000004_create_publish_job;
mod m20260707_000005_add_job_test_case_version;
mod m20260709_000006_create_model_catalog;
mod m20260709_000007_add_run_sort_columns;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20260619_000001_create_initial_schema::Migration),
            Box::new(m20260621_000002_create_tournament::Migration),
            Box::new(m20260623_000003_create_job::Migration),
            Box::new(m20260628_000004_create_publish_job::Migration),
            Box::new(m20260707_000005_add_job_test_case_version::Migration),
            Box::new(m20260709_000006_create_model_catalog::Migration),
            Box::new(m20260709_000007_add_run_sort_columns::Migration),
        ]
    }
}
