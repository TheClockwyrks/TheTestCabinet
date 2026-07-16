//! The `review_plan` table: a reviewer's declarative coverage plan.
//!
//! One row per account (the auth-service user id is the primary key). A plan
//! declares the harness+model combinations and the version-pinned test cases the
//! reviewer wants covered, plus a single target number of runs per
//! `case × combination` cell. The console reads it back to render the coverage
//! matrix and trigger the still-missing runs. Reviewer tooling is console-only;
//! this table never feeds the public snapshot.
//!
//! The two list fields are stored as JSON text (like `review.ratings`/`checklist`
//! and `run.record_json`) rather than normalized child tables: a plan is small,
//! read and written whole, and never queried by its contents.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "review_plan")]
pub struct Model {
    /// The owning account's id (from the auth service, via the verified bearer
    /// token). The primary key — one plan per account.
    #[sea_orm(primary_key, auto_increment = false)]
    pub user_id: String,
    /// The target number of runs desired for each `case × combination` cell.
    pub runs_per_cell: i32,
    /// The plan's version-pinned test cases as a JSON array of
    /// `{ slug, version, variant }`.
    #[sea_orm(column_type = "Text")]
    pub cases_json: String,
    /// The plan's harness+model combinations as a JSON array of
    /// `{ harness, model, provider? }`.
    #[sea_orm(column_type = "Text")]
    pub combinations_json: String,
    /// RFC 3339 of when the plan was last saved.
    pub updated_at: String,
    /// Whether the idempotent startup backfill has copied this legacy plan into the
    /// multi-plan `coverage_plan` table. Set once the copy succeeds so a restart is
    /// a no-op and a deleted migrated plan is not recreated.
    pub migrated: bool,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
