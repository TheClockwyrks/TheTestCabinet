//! The `gg_dashboard` table: an operator's named board of TCQ panels.
//!
//! Many rows per account (keyed by the auth-service `user_id`), with the same shape
//! as a [saved query](super::gg_saved_query) — opaque `id`, name, description,
//! `updated_at` — plus the panel list as JSON text, read and written whole like the
//! coverage plans' list columns.
//!
//! A board carries **one** range for the whole board (`range_id`), never one per
//! panel: the range is the thing an operator changes while leaving every question
//! alone, and a board whose panels each answered over a different window would not
//! be a board. Each panel holds its own query text, so a board renders the same
//! figures a year later whether or not the saved query it was built from still
//! exists.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "gg_dashboard")]
pub struct Model {
    /// The dashboard's opaque id (minted on create). The primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    /// The owning account's id (from the auth service, via the verified bearer
    /// token).
    pub user_id: String,
    /// The operator-chosen display name (e.g. `compaction ablation`).
    pub name: String,
    /// A one-line note on what the board is for. Empty when unset.
    pub description: String,
    /// The board's panels as a JSON array of `{ title, query, width }`.
    #[sea_orm(column_type = "Text")]
    pub panels_json: String,
    /// The id of the board-level time range (a `TimeRangePicker` token such as
    /// `30d`, or `all`). One per board, not one per panel.
    pub range_id: String,
    /// RFC 3339 of when the dashboard was last saved.
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
