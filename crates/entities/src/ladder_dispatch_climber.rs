//! The `ladder_dispatch_climber` table: one harness+model combination climbing in a
//! [`ladder_dispatch`](crate::ladder_dispatch).
//!
//! The climbers are resolved from the ladder's groups and one-off combinations once, at
//! Run, and stored here in their resolved order, so a group edited mid-dispatch neither
//! adds nor removes a climber.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "ladder_dispatch_climber")]
pub struct Model {
    /// The dispatch's id (`ladder_dispatch.id`). Half of the composite primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub dispatch_id: String,
    /// The climber's canonical key, as the backend's `climber_key` builds it. The other
    /// half of the composite primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub climber_key: String,
    /// The climber's place in the resolved order, from `0`.
    pub position: i32,
    /// The combination as stored on a plan or ladder (`ReviewPlanCombo`), as JSON. Re-
    /// resolved against the live catalog and gg library at every launch; see `cell_json`.
    #[sea_orm(column_type = "Text")]
    pub combo_json: String,
    /// The climber's share of every cell key its runs land in — `[harness, launch model,
    /// gg configuration id, gg models]` as JSON — pinned when it first resolved (at Run,
    /// or at the first launch pass that could resolve it), or `NULL` while it never has.
    /// The dispatch finds its own runs by this, never by resolving the combination again,
    /// so an edit to a gg configuration mid-dispatch cannot hide the runs already made.
    #[sea_orm(column_type = "Text", nullable)]
    pub cell_json: Option<String>,
    /// RFC 3339 of when the owner last retried this climber, or `NULL` for never. Only
    /// jobs that ended after it are read for its failing block.
    #[sea_orm(nullable)]
    pub retried_at: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
