//! The `harness_config` table: the operator-tunable, per-harness configuration
//! the dispatcher and backend consult at run time.
//!
//! Harness *identity* (name, binary, install command) is static and lives in the
//! checked-in `harnesses/<slug>/harness.toml` + the code adapter — it is not stored
//! here. This table holds only the small, mutable knobs an operator sets from the
//! console's Harnesses settings, keyed by harness slug. Today that is a single
//! knob: the maximum number of runs of the harness the Test Cabinet will drive at
//! once (`NULL` = unlimited). A harness with no row is fully default (unlimited).

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "harness_config")]
pub struct Model {
    /// The harness slug (for example `claude`); the primary key. Matches a
    /// `HarnessSlug` the core layer knows.
    #[sea_orm(primary_key, auto_increment = false)]
    pub harness_slug: String,
    /// The maximum number of runs of this harness the Test Cabinet will drive
    /// concurrently, or `NULL` for no limit. When set, the backend holds additional
    /// runs of the harness in the `pending` state until an in-flight one finishes.
    #[sea_orm(nullable)]
    pub max_parallelism: Option<i32>,
    /// RFC 3339 of the last update to this row.
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
