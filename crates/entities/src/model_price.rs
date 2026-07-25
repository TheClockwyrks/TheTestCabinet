//! The `model_price` table: the observed comparable-price history for a model.
//!
//! A row is one price observation for a **canonical model id** (see
//! `test_cabinet_core::model_id`), captured when a run completes or a periodic
//! refresh runs. Observations are appended when the price changes from the
//! previous one — or when one of the catalog facts riding along on it does (the
//! context window, the release date, or the accepted input modalities), so a model
//! whose price has held still still records a newly-observed fact. The price
//! *series* the catalog shows collapses consecutive-equal price triples, so a
//! fact-only observation adds no visible price step.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "model_price")]
pub struct Model {
    /// Surrogate auto-incrementing id; the primary key.
    #[sea_orm(primary_key)]
    pub id: i32,
    /// The canonical model id this observation prices.
    pub model_id: String,
    /// RFC 3339 of when this price was observed.
    pub observed_at: String,
    /// USD per uncached input token, or `NULL` when OpenRouter lists no price.
    #[sea_orm(nullable)]
    pub uncached_input: Option<f64>,
    /// USD per cached input token, or `NULL`.
    #[sea_orm(nullable)]
    pub cached_input: Option<f64>,
    /// USD per output token, or `NULL`.
    #[sea_orm(nullable)]
    pub output: Option<f64>,
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
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
