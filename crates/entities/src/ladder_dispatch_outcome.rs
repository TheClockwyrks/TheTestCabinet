//! The `ladder_dispatch_outcome` table: a climber's recorded verdict on one rung of a
//! [`ladder_dispatch`](crate::ladder_dispatch).
//!
//! A row appears when the gate decides, from the dispatch's own runs of that rung slot,
//! and it stands for the rest of the dispatch. A new Run starts with none.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "ladder_dispatch_outcome")]
pub struct Model {
    /// The dispatch's id (`ladder_dispatch.id`).
    #[sea_orm(primary_key, auto_increment = false)]
    pub dispatch_id: String,
    /// The rung the verdict is about, by its stable id in the dispatch's snapshot.
    #[sea_orm(primary_key, auto_increment = false)]
    pub rung_id: String,
    /// The climber the verdict is about (`ladder_dispatch_climber.climber_key`).
    #[sea_orm(primary_key, auto_increment = false)]
    pub climber_key: String,
    /// The gate's verdict: `passed` or `failed`.
    pub outcome: String,
    /// RFC 3339 of when the gate decided.
    pub decided_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
