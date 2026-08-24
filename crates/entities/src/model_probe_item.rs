//! The `model_probe_item` table: one completion call inside a model probe.
//!
//! Each item is a single OpenRouter chat/completions call from one (condition,
//! sample) cell of the probe's matrix: which provider actually served it, how it
//! finished, the classified shape of the reply, and the model's raw response
//! text (with any separate reasoning stream). A call the gateway refused stores
//! the error instead of a classification.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "model_probe_item")]
pub struct Model {
    /// The item's opaque id (a UUID minted on create). The primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    /// The owning probe's id.
    pub probe_id: String,
    /// The prompt condition (`base`, `no-tools`, `notice`, `combo`).
    pub condition: String,
    /// The sample index within the condition, from 0.
    pub sample: i32,
    /// The provider OpenRouter reported serving the call, or `NULL` on error.
    #[sea_orm(nullable)]
    pub provider: Option<String>,
    /// The gateway `finish_reason`, or `NULL` on error.
    #[sea_orm(nullable)]
    pub finish_reason: Option<String>,
    /// The provider-native finish reason, or `NULL`.
    #[sea_orm(nullable)]
    pub native_finish_reason: Option<String>,
    /// The classified reply shape (`clean-program`, `tool-token`, …), or `NULL`
    /// on error.
    #[sea_orm(nullable)]
    pub label: Option<String>,
    /// Whether the reply counts as clean (a bare program over the gg modules).
    pub clean: bool,
    /// The model's raw reply content, verbatim.
    #[sea_orm(column_type = "Text")]
    pub response_text: String,
    /// The reply's separate reasoning stream, or `NULL` when none was returned.
    #[sea_orm(column_type = "Text", nullable)]
    pub reasoning_text: Option<String>,
    /// Prompt tokens as OpenRouter reported them, or `NULL`.
    #[sea_orm(nullable)]
    pub prompt_tokens: Option<i64>,
    /// Completion tokens as OpenRouter reported them, or `NULL`.
    #[sea_orm(nullable)]
    pub completion_tokens: Option<i64>,
    /// The call's USD cost as OpenRouter reported it, or `NULL`.
    #[sea_orm(nullable)]
    pub cost: Option<f64>,
    /// Wall-clock duration of the call in milliseconds.
    pub duration_ms: i64,
    /// The transport or gateway error that voided the call, or `NULL`.
    #[sea_orm(column_type = "Text", nullable)]
    pub error: Option<String>,
    /// RFC 3339 of when the call completed.
    pub created_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    /// The probe this item belongs to.
    #[sea_orm(
        belongs_to = "super::model_probe::Entity",
        from = "Column::ProbeId",
        to = "super::model_probe::Column::Id"
    )]
    Probe,
}

impl Related<super::model_probe::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Probe.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
