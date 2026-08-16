//! The `ladder_rung` table: one step of a [`ladder`](crate::ladder)'s climb.
//!
//! A rung is exactly one test case, pinned to an exact `(slug, version, variant)` —
//! the same triple a coverage plan's cases carry — plus its place in the ordering.
//! Rungs are real rows rather than a JSON list on the ladder because they are
//! ordered, individually reorderable, individually re-pinnable, and referenced by id
//! from every recorded outcome.
//!
//! The case a rung names must be a **reviewable** test type: the gate reads this
//! account's reviews, and the auto-graded types are excluded from the unreviewed
//! queue entirely, so a rung holding one would never resolve. That is enforced where
//! rungs are written, not by the schema.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "ladder_rung")]
pub struct Model {
    /// The rung's stable opaque id (a UUID minted when the rung is added). The
    /// primary key.
    ///
    /// Deliberately not the position: rungs get reordered and re-pinned to newer case
    /// versions, and every [`ladder_outcome`](crate::ladder_outcome) references this
    /// id, so it has to survive both. A positional identifier would silently
    /// reattribute a combination's recorded verdicts to a different case the moment
    /// the ladder was reordered.
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    /// The owning ladder's id.
    pub ladder_id: String,
    /// The rung's place in the climb, low to high. Rewritten on a reorder while `id`
    /// stays put.
    pub position: i32,
    /// The test-case slug (e.g. `caldera`).
    pub slug: String,
    /// The pinned, exact version (e.g. `v1.2.0`). Coverage is counted against exactly
    /// this version, and a gate outcome records the version it was decided against so
    /// a later bump does not inherit an old verdict.
    pub version: String,
    /// The variant to climb (e.g. `base`).
    pub variant: String,
    /// This rung's override of the ladder's `runs_per_cell`, or `NULL` to inherit it.
    /// Lets a pivotal step demand more evidence than the rest of the climb without
    /// making every rung more expensive.
    #[sea_orm(nullable)]
    pub runs_override: Option<i32>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
