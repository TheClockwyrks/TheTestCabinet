//! The `model_price` table: the observed comparable-price history for a model.
//!
//! A row is one price observation for a **canonical model id** (see
//! `test_cabinet_core::model_id`), captured when a run completes or a periodic
//! refresh runs. Observations are appended only when the price changes from the
//! previous one, so the series is already deduplicated. The context window and
//! release date OpenRouter reports ride along on each observation but do not, on
//! their own, trigger a new row.

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
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
