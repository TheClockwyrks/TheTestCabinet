//! The `model_price` table: the catalog facts observed for a model.
//!
//! A row is one observation of a **canonical model id** (see
//! `test_cabinet_core::model_id`) on OpenRouter: its context window, its release
//! date, the input modalities it accepts, and its developer's provider. It is
//! captured when the catalog first meets a model, when a run completes, and on the
//! periodic refresh, and appended only when a fact differs from the previous
//! observation's. The newest row is what the catalog serves and a launch is told.
//!
//! Despite its name the table holds no price: it once carried a rate beside the
//! facts, and kept its name when the rate columns were dropped. A model's only
//! price is the list price on its `model` row.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "model_price")]
pub struct Model {
    /// Surrogate auto-incrementing id; the primary key.
    #[sea_orm(primary_key)]
    pub id: i32,
    /// The canonical model id this observation is of.
    pub model_id: String,
    /// RFC 3339 of when the facts were observed.
    pub observed_at: String,
    /// Maximum context window in tokens OpenRouter reported at observation time,
    /// or `NULL`.
    #[sea_orm(nullable)]
    pub context_length: Option<i64>,
    /// Model release date (RFC 3339) OpenRouter reported, or `NULL`.
    #[sea_orm(nullable)]
    pub released_at: Option<String>,
    /// The input modalities OpenRouter reported the model accepts, as a
    /// comma-separated lowercase list (`text,image,file`), or `NULL` when none was
    /// observed. `NULL` and the empty string both mean **unknown**, not "text
    /// only": a caller deciding whether to send an image treats an unannotated
    /// model as "try it and find out" rather than refusing up front.
    #[sea_orm(nullable)]
    pub input_modalities: Option<String>,
    /// The developer provider observed on the model's endpoints listing — the provider name
    /// of its developer's own endpoint — or `NULL` when none has been observed. A curated
    /// override lives on the model row and wins over this when both are set.
    #[sea_orm(nullable)]
    pub provider_pin: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
