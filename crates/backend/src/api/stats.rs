//! The `/stats` endpoints: per-provider health and per-model accuracy,
//! aggregated across every stored gg run plus the probe store.
//!
//! The division of labour follows the gg query endpoints: [`crate::stats`]
//! owns the folds and the response contract, and these handlers own only the
//! corpus — the facts half of the [document index](crate::gg_docs::GgDocIndex)
//! and one probe-item projection. Both reads are open, like the rest of the
//! catalog: they carry aggregate counts only, never a prompt, a reply, or an
//! account.

use axum::Json;
use axum::extract::State;

use crate::error::ApiError;
use crate::gg_docs::CatalogScores;
use crate::stats::{
    CabinetStatsResponse, ModelAccuracyResponse, ProviderStatsResponse, fold_cabinet_stats,
    fold_model_accuracy, fold_probe_providers, fold_provider_stats,
};

use super::AppState;

/// `GET /stats/providers` — per-provider health across every stored gg run
/// (which models each provider served, calls, spend, rejections, and turn
/// outcomes), with the probe store's per-provider evidence reported beside the
/// run evidence, never folded into it. An open read.
#[tracing::instrument(name = "stats.providers", skip(state), err(Debug))]
pub async fn providers(
    State(state): State<AppState>,
) -> Result<Json<ProviderStatsResponse>, ApiError> {
    let facts = facts_corpus(&state).await?;
    let probe_rows = state
        .db
        .probe_item_provider_rows()
        .await
        .map_err(ApiError::from)?;
    let (runs_scanned, runs_with_provider_data, providers) = fold_provider_stats(&facts);
    Ok(Json(ProviderStatsResponse {
        runs_scanned,
        runs_with_provider_data,
        providers,
        probes: fold_probe_providers(&probe_rows),
    }))
}

/// `GET /stats/model-accuracy` — per-model accuracy across every stored gg
/// run, split into responses-as-code turn accounting and tool-calling dispatch
/// accounting. An open read.
#[tracing::instrument(name = "stats.model_accuracy", skip(state), err(Debug))]
pub async fn model_accuracy(
    State(state): State<AppState>,
) -> Result<Json<ModelAccuracyResponse>, ApiError> {
    let facts = facts_corpus(&state).await?;
    Ok(Json(fold_model_accuracy(&facts)))
}

/// `GET /stats/cabinet` — the cabinet's whole-of-corpus headline figures (run,
/// token, and spend totals, distinct cases and models, and the weekly activity
/// series), folded over **every** stored run whatever its state or publication.
/// An open read: the figures are aggregate counts only, backing the public home
/// page's totals band and activity chart.
///
/// The corpus is one five-column projection over the lifted `run` columns (see
/// [`crate::db::Db::cabinet_stat_rows`]); the fold and the week bucketing are
/// pure Rust in [`crate::stats`], with "now" — the anchor of the 52-week window
/// — supplied here so the fold stays testable against a fixed instant.
#[tracing::instrument(name = "stats.cabinet", skip(state), err(Debug))]
pub async fn cabinet(
    State(state): State<AppState>,
) -> Result<Json<CabinetStatsResponse>, ApiError> {
    let rows = state.db.cabinet_stat_rows().await.map_err(ApiError::from)?;
    Ok(Json(fold_cabinet_stats(
        &rows,
        time::OffsetDateTime::now_utc(),
    )))
}

/// Resolve the facts corpus, refreshing the index if its last reconcile has
/// aged out — the facts-side twin of the gg query endpoints' corpus resolver,
/// threading the same score resolver because the reconcile that builds both is
/// shared.
async fn facts_corpus(
    state: &AppState,
) -> Result<std::sync::Arc<Vec<std::sync::Arc<crate::stats::GgRunFacts>>>, ApiError> {
    let mut scores = CatalogScores::new(&state.store);
    state
        .gg_docs
        .facts(&state.db, &mut |run| scores.score(run))
        .await
        .map_err(ApiError::from)
}
