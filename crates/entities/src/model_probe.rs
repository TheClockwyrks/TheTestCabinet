//! The `model_probe` table: one responses-as-code readiness probe of a catalog
//! model.
//!
//! A probe replays gg's real RaC turn-1 request against a model through
//! OpenRouter — the one `submit_program` tool offered, `tool_choice` forced to
//! it — samples it several times, classifies each submitted program, and
//! reduces the results to a verdict on whether the model can drive RaC at all.
//! This row records what was launched — the catalog slug it was triggered from,
//! the OpenRouter slug actually sent, an optional pinned provider, the sampling
//! parameters, and the request as sent — and the outcome: status, verdict,
//! clean rate, and total spend. The per-call replies live in the sibling
//! `model_probe_item` table. Probes are append-only history; re-running one
//! adds a new row.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "model_probe")]
pub struct Model {
    /// The probe's opaque id (a UUID minted on create). The primary key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    /// The catalog slug the probe was triggered from (a curated slug, or a
    /// derived model's canonical id).
    pub model_slug: String,
    /// The OpenRouter slug the completions were requested under.
    pub openrouter_slug: String,
    /// The pinned provider (`provider.order` with fallbacks disabled), or `NULL`
    /// for the default route.
    #[sea_orm(nullable)]
    pub provider: Option<String>,
    /// The triggering account's id (from the auth service, via the verified
    /// bearer token).
    pub user_id: String,
    /// Completion calls requested.
    pub samples: i32,
    /// The completion-token cap each call was sent with.
    pub max_tokens: i32,
    /// Whether the seeded spec views were sent whole rather than trimmed.
    pub full_context: bool,
    /// The request's message array exactly as sent (JSON), so the console can
    /// show what the model received even after the baked fixture changes.
    #[sea_orm(column_type = "Text")]
    pub request_json: String,
    /// `running`, `complete`, or `failed`.
    pub status: String,
    /// Why the probe failed, or `NULL`.
    #[sea_orm(column_type = "Text", nullable)]
    pub error: Option<String>,
    /// The reduced verdict (`ready` or `not-ready`), or `NULL` until the probe
    /// completes.
    #[sea_orm(nullable)]
    pub verdict: Option<String>,
    /// The probe's clean-submission rate (0..=1), or `NULL` until complete.
    #[sea_orm(nullable)]
    pub clean_rate: Option<f64>,
    /// Total USD spend across the probe's completions, as OpenRouter reported it.
    pub spend: f64,
    /// RFC 3339 of when the probe was triggered.
    pub created_at: String,
    /// RFC 3339 of when the probe completed or failed, or `NULL` while running.
    #[sea_orm(nullable)]
    pub finished_at: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    /// A probe owns its per-call items.
    #[sea_orm(has_many = "super::model_probe_item::Entity")]
    Item,
}

impl Related<super::model_probe_item::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Item.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
