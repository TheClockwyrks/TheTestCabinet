//! The `model` table: one operator-curated catalog entry for a model.
//!
//! Curated configuration is the display metadata The Test Cabinet attaches to a
//! model — its display name, provider, provider logo, and prose — keyed by a
//! stable `slug`. The run-record ids this entry covers live in the sibling
//! `model_alias` table; observed prices live in `model_price`, keyed by canonical
//! model id rather than by slug. A model with no curated row still appears in the
//! catalog (derived from its runs); this table only holds the human-authored
//! overlay.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "model")]
pub struct Model {
    /// The stable curated slug (the catalog identity); the primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub slug: String,
    /// The Test-Cabinet-defined display name (for example `GPT-5.5`).
    pub display_name: String,
    /// The provider that serves the model (for example `Anthropic`).
    pub provider: String,
    /// The `https://svgl.app/...` URL the provider logo was fetched from, or
    /// `NULL` when none was set.
    #[sea_orm(nullable)]
    pub provider_logo_url: Option<String>,
    /// The fetched, **sanitized** provider-logo SVG markup, or `NULL`.
    #[sea_orm(column_type = "Text", nullable)]
    pub provider_logo_svg: Option<String>,
    /// Site-facing description markdown, or `NULL`.
    #[sea_orm(column_type = "Text", nullable)]
    pub description_md: Option<String>,
    /// The slug OpenRouter lists the model under, used as the price-series key
    /// for the comparable cost, or `NULL` when the model is not on OpenRouter.
    #[sea_orm(nullable)]
    pub openrouter_slug: Option<String>,
    /// RFC 3339 of when this curated row was created.
    pub created_at: String,
    /// RFC 3339 of the last update to this curated row.
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    /// A model owns many aliases — the run-record ids it covers.
    #[sea_orm(has_many = "super::model_alias::Entity")]
    Alias,
}

impl Related<super::model_alias::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Alias.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
