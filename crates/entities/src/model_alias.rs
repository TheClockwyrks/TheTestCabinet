//! The `model_alias` table: the canonical model ids a curated [`model`](super::model)
//! claims.
//!
//! Each row binds one canonical model id (see `test_cabinet_core::model_id`) to a
//! curated model. The `alias` column is globally unique — an id belongs to at
//! most one curated model — which is how the catalog merges a model's runs onto
//! its config and rejects two configs fighting over the same id.
//!
//! `harness_family` records which family of harnesses that slug is usable with
//! (`test_cabinet_core::run_record::HarnessFamily` — `claude`, `codex`,
//! `antigravity`, or `openrouter`), so a run form can offer only the slugs the
//! selected harness can actually launch. It is stored as the family's wire slug.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "model_alias")]
pub struct Model {
    /// Surrogate id (uuid); the primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    /// The curated model this alias belongs to (`model.slug`).
    pub model_slug: String,
    /// A canonical model id this curated model covers. Globally unique.
    #[sea_orm(unique)]
    pub alias: String,
    /// The harness family this slug is usable with, as a
    /// [`HarnessFamily`](test_cabinet_core::run_record::HarnessFamily) wire slug
    /// (`claude` / `codex` / `antigravity` / `openrouter`).
    pub harness_family: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    /// An alias belongs to exactly one model.
    #[sea_orm(
        belongs_to = "super::model::Entity",
        from = "Column::ModelSlug",
        to = "super::model::Column::Slug",
        on_delete = "Cascade"
    )]
    Model,
}

impl Related<super::model::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Model.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
