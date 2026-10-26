//! The `tournament` table: one persisted adversarial tournament, holding the
//! verbatim `TournamentRecord` JSON blob plus the columns lifted out of it for
//! ordering, pagination, and filtering.
//!
//! A tournament is recorded when the arena accepts it, and each pairing of its
//! field is a [`tournament_match`](super::tournament_match) row, so its state
//! moves from `queued` through `running` to `succeeded` or `failed`. The per-match
//! replays live on the artifact service's private container
//! (`tournaments/<id>/matches/<match_id>/replay.json`), referenced by the record.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "tournament")]
pub struct Model {
    /// The tournament id (`TournamentRecord.id`); the primary key, caller-assigned.
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    /// RFC 3339 of when the tournament was recorded, and once it succeeds, of when
    /// it succeeded; the newest-first sort/pagination key.
    pub published_at: String,
    /// RFC 3339 of when the tournament was run (from the record).
    pub created_at: String,
    pub test_case_slug: String,
    pub test_case_version: String,
    pub variant: String,
    /// How many controllers competed (lifted so a list card need not parse JSON).
    pub participant_count: i32,
    /// The `TournamentRecord` serialized verbatim. Until the tournament succeeds
    /// it holds the field alone, with no standings and no matches, and the
    /// recorded matches are its `tournament_match` rows; once it succeeds it is
    /// the whole record.
    #[sea_orm(column_type = "Text")]
    pub record_json: String,
    /// `queued`, `running`, `succeeded` or `failed`.
    pub state: String,
    /// A failed tournament's reason.
    #[sea_orm(column_type = "Text", nullable)]
    pub detail: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
