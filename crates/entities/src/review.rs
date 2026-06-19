//! The `review` table: a run's quality review, one row per run.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "review")]
pub struct Model {
    /// The run this review belongs to (FK to `run.id`); also the primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub run_id: String,
    pub rating: String,
    #[sea_orm(column_type = "Text")]
    pub writeup: String,
    /// The reviewer's checklist verdicts as a JSON array.
    #[sea_orm(column_type = "Text")]
    pub checklist: String,
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
