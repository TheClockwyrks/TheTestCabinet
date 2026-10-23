//! The `run_controller` table: an adversarial run's pushed `controller.wasm`, keyed by
//! the run id.
//!
//! The module arrives before the run's row (the driver pushes it ahead of its terminal
//! report), so the key is a plain column rather than a foreign key, and deleting a run
//! deletes its controller in the same transaction.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "run_controller")]
pub struct Model {
    /// The run id (`RunRecord.id`) the controller was pushed for; the primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub run_id: String,
    /// The wasm module, verbatim.
    #[sea_orm(column_type = "Blob")]
    pub module: Vec<u8>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
