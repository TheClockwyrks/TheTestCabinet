//! The `ladder_outcome` table: one combination's verdict on one
//! [`ladder_rung`](crate::ladder_rung).
//!
//! This is where a [`ladder`](crate::ladder)'s progress lives. There is no global
//! rung pointer anywhere: a combination has climbed as far as its outcome rows say
//! it has, which is what lets a model added to a standing ladder next month start at
//! rung 1 while the models already halfway up carry on.
//!
//! A row appears when the gate **resolves** for that combination on that rung; a
//! rung with no row is still undecided (climbing, or awaiting this account's
//! reviews). Only completed runs feed the gate — a failed or canceled *job* is an
//! infrastructure problem that retries (`job.attempt`), never a wall.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "ladder_outcome")]
pub struct Model {
    /// The owning ladder's id. Part of the composite primary key and its leading
    /// column, so "every outcome on this ladder" — the dashboard's read — is a prefix
    /// scan of the key rather than a join through `ladder_rung`.
    #[sea_orm(primary_key, auto_increment = false)]
    pub ladder_id: String,
    /// The rung this verdict is about, by its stable id.
    #[sea_orm(primary_key, auto_increment = false)]
    pub rung_id: String,
    /// The canonical `harness|model|provider` key of the combination this verdict is
    /// about — the same encoding [`ladder_climber`](crate::ladder_climber) uses.
    #[sea_orm(primary_key, auto_increment = false)]
    pub combination_key: String,
    /// The exact case version the verdict was decided against.
    ///
    /// Part of the key, not merely recorded, so that bumping a rung to a newer case
    /// version neither erases the verdict earned on the old one nor silently inherits
    /// it — different content deserves a fresh judgement — and re-pinning back
    /// restores the original. A rung's *current* verdict is the row whose version
    /// matches the rung's present pin.
    #[sea_orm(primary_key, auto_increment = false)]
    pub decided_version: String,
    /// The automatically computed gate result: `advanced` or `walled`. Recomputable
    /// at any time from this account's reviews of the rung's runs.
    pub outcome: String,
    /// The reviewer's manual override of that result (same vocabulary as
    /// [`outcome`](Self::outcome); typically `advanced`, a promote past a gate the
    /// runs failed), or `NULL` for none.
    ///
    /// Kept in its own column rather than overwriting `outcome` for two reasons: a
    /// recomputed automatic outcome must never silently undo a human decision, and
    /// clearing this column reverses the override exactly, restoring whatever the
    /// gate itself says. The effective verdict is this column when set, else
    /// `outcome`.
    #[sea_orm(nullable)]
    pub override_outcome: Option<String>,
    /// RFC 3339 of when the override was applied, or `NULL` when there is none.
    #[sea_orm(nullable)]
    pub override_at: Option<String>,
    /// RFC 3339 of when the automatic outcome was last computed.
    pub decided_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
