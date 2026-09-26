//! The `comparison` table: an operator's saved harness comparison (A/B experiment).
//!
//! Many rows per account (keyed by the auth-service `user_id`), each with an opaque
//! `id`, a display name, an optional description, and the whole core
//! `ComparisonConfig` (controls, varied dimension, arms with their run ids) as JSON
//! text. A comparison holds every run variable constant and varies one — the harness,
//! a gg configuration, or the model — into N-run arms; the per-arm distributions and
//! diagnostics are computed on read from the arms' runs, so only the configuration is
//! stored here. `published`/`published_at` gate whether it is folded into the public
//! snapshot. The config is read and written whole, like the other JSON columns.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "comparison")]
pub struct Model {
    /// The comparison's opaque id (a UUID minted on create). The primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    /// The owning account's id (from the auth service, via the verified bearer
    /// token).
    pub user_id: String,
    /// The operator-chosen display name (e.g. `carom-pi-vs-kilo`).
    pub name: String,
    /// A one-line note on what is being compared and why. Empty when unset.
    pub description: String,
    /// The whole `ComparisonConfig` as JSON (controls, varied dimension, arms).
    #[sea_orm(column_type = "Text")]
    pub config_json: String,
    /// Whether the comparison has been published to the public site.
    pub published: bool,
    /// RFC 3339 of when it was published, or `NULL` while unpublished.
    pub published_at: Option<String>,
    /// RFC 3339 of when the comparison was created.
    pub created_at: String,
    /// RFC 3339 of when the comparison was last saved.
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
