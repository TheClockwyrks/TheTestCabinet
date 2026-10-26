//! The `relay_overflow` table: a replica's announcement whose payload exceeds
//! PostgreSQL's notification limit, announced by its key instead.
//!
//! Every other replica reads the row back when the announcement arrives, so a row
//! is needed only briefly; the announcing replica deletes rows older than a few
//! minutes as it writes new ones.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "relay_overflow")]
pub struct Model {
    /// The key the announcement names.
    #[sea_orm(primary_key)]
    pub id: i64,
    /// The announcement, serialized verbatim.
    #[sea_orm(column_type = "Text")]
    pub payload: String,
    /// When the row was written (RFC 3339).
    pub created_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
