//! The `ladder_dispatch` table: one Run of a [`ladder`](crate::ladder) configuration.
//!
//! Running a ladder snapshots its rungs, gate, order and runs-in-flight limit into a
//! dispatch, which then owns every job it launches (their origin is
//! `ladder:<ladder_id>/<dispatch_id>/<rung_id>`) and counts only those jobs' runs.
//! Editing the configuration never reaches a dispatch.
//!
//! A ladder keeps at most one dispatch — its latest — so `ladder_id` is the primary key.
//! A new Run replaces an ended one (its climbers and outcomes go with it), and is refused
//! while one is still running. There is no dispatch history.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "ladder_dispatch")]
pub struct Model {
    /// The ladder this dispatch ran. The primary key: one dispatch per ladder.
    #[sea_orm(primary_key, auto_increment = false)]
    pub ladder_id: String,
    /// The dispatch's own opaque id, minted at Run. Unique, and part of the origin of
    /// every job the dispatch launches.
    #[sea_orm(unique)]
    pub id: String,
    /// `running`, `finished` (every climber completed or failed and nothing is in
    /// flight) or `stopped` (the owner ended it).
    pub status: String,
    /// RFC 3339 of the Run.
    pub started_at: String,
    /// RFC 3339 of when the dispatch finished or was stopped, `NULL` while running.
    #[sea_orm(nullable)]
    pub ended_at: Option<String>,
    /// The configuration as it stood at Run, as JSON: the rungs with their resolved run
    /// targets, the gate, the outer axis and the resolved runs-in-flight limit.
    #[sea_orm(column_type = "Text")]
    pub snapshot_json: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
