//! The `run` table: one published run, holding the verbatim `RunRecord` JSON
//! blob plus the columns lifted out of it for ordering, pagination, and
//! filtering. The review and links live in sibling tables keyed by `id`.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "run")]
pub struct Model {
    /// The run id (`RunRecord.id`); the primary key, assigned by the caller.
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub started_at: String,
    pub finished_at: String,
    /// RFC 3339 of the first publish; the newest-first sort/pagination key.
    pub published_at: String,
    pub test_case_slug: String,
    pub test_case_version: String,
    pub variant: String,
    pub harness_slug: String,
    pub harness_version: Option<String>,
    pub model_id: String,
    pub run_state: String,
    /// Whether the produced build loaded (lifted from the validation summary).
    pub loaded: bool,
    /// The full `RunRecord` serialized verbatim (links populated).
    #[sea_orm(column_type = "Text")]
    pub record_json: String,
    /// The run's recorded normalized event stream as a JSON array, or `NULL`.
    #[sea_orm(column_type = "Text", nullable)]
    pub events_json: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_one = "super::review::Entity")]
    Review,
    #[sea_orm(has_one = "super::run_link::Entity")]
    RunLink,
}

impl Related<super::review::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Review.def()
    }
}

impl Related<super::run_link::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::RunLink.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
