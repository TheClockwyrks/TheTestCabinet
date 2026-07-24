//! The `gg_config` table: an operator's named, reusable gg capability set.
//!
//! Many rows per account (keyed by the auth-service `user_id`), each with an opaque
//! `id`, a display name, an optional description, and the whole core
//! `GgCapabilitySet` as JSON text. gg is
//! its own run mode — configured by a capability set rather than the flat
//! `(harness, model, orchestrator)` tuple — so a saved configuration is what the
//! new-run form picks in the harness slot once `gg` is chosen as the orchestrator.
//! The capability set is read and written whole, like the other JSON columns.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "gg_config")]
pub struct Model {
    /// The configuration's opaque id (a UUID minted on create). The primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    /// The owning account's id (from the auth service, via the verified bearer
    /// token).
    pub user_id: String,
    /// The operator-chosen display name (e.g. `no-compaction`).
    pub name: String,
    /// A one-line note on what the configuration is for. Empty when unset.
    pub description: String,
    /// The whole capability set as JSON (capabilities, slot bindings, disabled
    /// tools).
    #[sea_orm(column_type = "Text")]
    pub capability_set_json: String,
    /// RFC 3339 of when the configuration was last saved.
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
