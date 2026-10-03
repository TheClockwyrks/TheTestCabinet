//! The `coverage_plan_cell_retry` table: when the owner last retried a plan cell that was
//! blocked on infrastructure failures.
//!
//! A cell is blocked when its three newest finished jobs all failed on infrastructure and
//! produced no counted run. Retrying it records the time here; only jobs that ended after
//! it count toward the cell's streak, so three more such failures block it again.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "coverage_plan_cell_retry")]
pub struct Model {
    /// The plan's id. Half of the composite primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub plan_id: String,
    /// The cell's canonical key: the backend's `CellKey` fields joined with `\u{1f}`.
    #[sea_orm(primary_key, auto_increment = false)]
    pub cell_key: String,
    /// RFC 3339 of the retry.
    pub retried_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
