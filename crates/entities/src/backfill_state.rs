//! The `backfill_state` table: which startup backfills have already run to completion.
//!
//! A row exists only for a pass that finished without error, keyed by that pass's name. It
//! is what makes a backfill one-shot: a backfill whose answer is resolved from data an
//! operator keeps editing must ask its question once, at the boot the migration landed on,
//! and leave the rows it could not resolve alone from then on.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "backfill_state")]
pub struct Model {
    /// The backfill's name. The primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    /// RFC 3339 of the pass that completed.
    pub completed_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
