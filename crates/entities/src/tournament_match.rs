//! The `tournament_match` table: one pairing of a tournament's field, recorded with
//! the tournament before it is played, and its result once it is.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "tournament_match")]
pub struct Model {
    /// The tournament the pairing belongs to.
    #[sea_orm(primary_key, auto_increment = false)]
    pub tournament_id: String,
    /// The match id (`red__vs__blue`), unique within its tournament.
    #[sea_orm(primary_key, auto_increment = false)]
    pub match_id: String,
    /// The pairing's place in the order the field is played, from `0`.
    pub ordinal: i32,
    /// The controller that plays Red.
    pub red_id: String,
    /// The controller that plays Blue.
    pub blue_id: String,
    /// The recorded `MatchSummary`, or `None` until the match is recorded.
    #[sea_orm(column_type = "Text", nullable)]
    pub summary_json: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
