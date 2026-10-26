//! The `run_link` table: a run's resolved external links, one row per run.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "run_link")]
pub struct Model {
    /// The run these links belong to (FK to `run.id`); also the primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub run_id: String,
    pub source_repo: Option<String>,
    pub playable_build: Option<String>,
    /// The run's short code, minted the first time it publishes and never
    /// reassigned; unique across every row. `None` until then.
    pub code: Option<String>,
    /// The JSON the artifacts service answered the run's
    /// `POST /runs/{id}/publish-media` with: the public keys of its media. `None`
    /// until that copy first succeeds.
    pub public_media: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::run::Entity",
        from = "Column::RunId",
        to = "super::run::Column::Id",
        on_delete = "Cascade"
    )]
    Run,
}

impl Related<super::run::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Run.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
