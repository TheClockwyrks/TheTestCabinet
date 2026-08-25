//! The `model_probe` table: one responses-as-code readiness probe of a catalog
//! model.
//!
//! A probe replays gg's RaC turn-1 request against a model through OpenRouter —
//! the one `submit_program` tool offered, `tool_choice` forced to it — across
//! the probe's cases: two scenarios (`baseline`, with the needed functions'
//! documentation views open, and `missing-docview`, with a needed function's
//! view withheld) over several input prompts, sampled `samples` times per
//! prompt, on one program-language arm or on every arm. Each submitted program
//! is classified against its case's expectations and the results reduce to a
//! verdict. This row records what was launched — the catalog slug it was
//! triggered from, the OpenRouter slug actually sent, an optional pinned
//! provider, the language selection, the sampling parameters, and the requests
//! as sent — and the outcome: status, verdict, pass rate, and total spend. The
//! per-call replies live in the sibling `model_probe_item` table. Probes are
//! append-only history; re-running one adds a new row.

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
    /// The probed program-language arm's wire id, or `NULL` for every language.
    #[sea_orm(nullable)]
    pub language: Option<String>,
    /// Completion calls requested per input prompt.
    pub samples: i32,
    /// The completion-token cap each call was sent with.
    pub max_tokens: i32,
    /// The per-case request message arrays exactly as sent (JSON), so the
    /// console can show what the model received even after the baked fixtures
    /// change.
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
    /// The probe's overall pass rate (0..=1) across the scored calls, or `NULL`
    /// until complete.
    #[sea_orm(nullable)]
    pub pass_rate: Option<f64>,
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
