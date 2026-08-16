//! The `ladder_climber` table: a reviewer's steering of one harness+model
//! combination on one [`ladder`](crate::ladder).
//!
//! This table holds **only** the manual controls — climb this one first, watch this
//! one, stop this one — never progress. Progress is derived from that combination's
//! [`ladder_outcome`](crate::ladder_outcome) rows, so there is exactly one source of
//! truth for how far a climber has got.
//!
//! A row is optional. A combination with no row is un-steered (default priority, not
//! focused, not held), which is why adding a model to a standing ladder writes
//! nothing here and simply starts it at rung 1.
//!
//! The combination is identified by the canonical `harness|model|provider` key
//! (empty trailing segment when the harness is not provider-routed) rather than by
//! three columns, because it is only ever matched whole against the resolved member
//! list the backend builds from the ladder's groups and one-offs.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "ladder_climber")]
pub struct Model {
    /// The owning ladder's id. Half of the composite primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub ladder_id: String,
    /// The canonical `harness|model|provider` key of the steered combination. The
    /// other half of the composite primary key, so one combination holds at most one
    /// steering row per ladder.
    #[sea_orm(primary_key, auto_increment = false)]
    pub combination_key: String,
    /// Climb order weight; higher goes first, `0` is the default. Lets one model be
    /// pushed to the front without reordering the ladder itself — reordering rungs
    /// would change what every *other* climber is being measured against, which is
    /// not what "run this model first" means.
    pub priority: i32,
    /// The reviewer's "watch this one" flag, surfaced by the dashboard and used to
    /// break ties between equal priorities.
    pub focused: bool,
    /// The manual downward override: stop this combination where it stands whatever
    /// its gates say. Reversible by clearing the flag; the automatic outcomes it
    /// overrides are untouched, so releasing a hold resumes the climb from exactly
    /// where it was.
    pub held: bool,
    /// RFC 3339 of when this steering was last changed.
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
