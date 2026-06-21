//! The `tournament` table: one persisted adversarial tournament, holding the
//! verbatim `TournamentRecord` JSON blob plus the columns lifted out of it for
//! ordering, pagination, and filtering.
//!
//! Unlike a `run`, a tournament has no review or links siblings — it is a
//! self-contained record of a field's standings and per-match summaries. The
//! per-match replays live on disk in the [`crate::store`](../../backend/src/store.rs)
//! (`tournaments/<id>/matches/<match_id>/replay.json`), referenced by the record.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "tournament")]
pub struct Model {
    /// The tournament id (`TournamentRecord.id`); the primary key, caller-assigned.
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    /// RFC 3339 of the first publish; the newest-first sort/pagination key.
    pub published_at: String,
    /// RFC 3339 of when the tournament was run (from the record).
    pub created_at: String,
    pub test_case_slug: String,
    pub test_case_version: String,
    pub variant: String,
    /// How many controllers competed (lifted so a list card need not parse JSON).
    pub participant_count: i32,
    /// The full `TournamentRecord` serialized verbatim.
    #[sea_orm(column_type = "Text")]
    pub record_json: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
