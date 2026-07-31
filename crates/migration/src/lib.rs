//! The schema migrations for the backend's SeaORM store.
//!
//! The initial migration creates the four tables of `design/v0.2.0-contracts.md`
//! §2 (`run`, `review`, `run_link`, `snapshot_state`) and the `run` indices;
//! later migrations add the tournament, job, and publish-job tables, the
//! model-catalog tables (`model`, `model_alias`, `model_price`), and the
//! `case_reference_build` table (a test-case variant's deployed reference
//! implementation URL), and the `case_reference_sheet` table (the published frame
//! set of an asset-generation variant's reference). They run at
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
mod m20260709_000008_add_job_attempt;
mod m20260709_000009_create_case_reference_build;
mod m20260711_000010_create_review_plan;
mod m20260712_000011_create_harness_config;
mod m20260712_000012_add_model_alias_harness_family;
mod m20260715_000013_create_coverage_group;
mod m20260715_000014_create_coverage_plan;
mod m20260715_000015_add_review_plan_migrated;
mod m20260719_000016_create_review_revision;
mod m20260721_000017_create_case_reference_sheet;
mod m20260731_000023_add_job_test_type;

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
            Box::new(m20260709_000008_add_job_attempt::Migration),
            Box::new(m20260709_000009_create_case_reference_build::Migration),
            Box::new(m20260711_000010_create_review_plan::Migration),
            Box::new(m20260712_000011_create_harness_config::Migration),
            Box::new(m20260712_000012_add_model_alias_harness_family::Migration),
            Box::new(m20260715_000013_create_coverage_group::Migration),
            Box::new(m20260715_000014_create_coverage_plan::Migration),
            Box::new(m20260715_000015_add_review_plan_migrated::Migration),
            Box::new(m20260719_000016_create_review_revision::Migration),
            Box::new(m20260721_000017_create_case_reference_sheet::Migration),
            Box::new(m20260731_000023_add_job_test_type::Migration),
        ]
    }
}
