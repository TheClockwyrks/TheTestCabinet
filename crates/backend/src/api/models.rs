//! The model-catalog endpoints: the merged catalog read plus the operator-driven
//! config CRUD, seed-from-run helper, and svgl.app logo fetch.
//!
//! The catalog is composed on the fly from three sources: the operator-curated
//! `model` configs (display name, provider, logo, prose, aliases), the observed
//! `model_price` history, and the distinct models the stored runs reference. Any
//! model with at least one run appears — curated or not — so a newly-run model
//! shows up without a release. Curated config is layered on by alias; an
//! uncurated model is shown, derived, under its canonical id.
//!
//! Reads are open (the private-network model); the config mutations, the seed
//! helper, and the logo fetch require a bearer token (see [`AuthUser`]). The same
//! [`compose_catalog`] the read uses also builds the public snapshot's catalog, so
//! the two never disagree.

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use test_cabinet_core::model_id::canonical_model_id;
use test_cabinet_core::run_record::HarnessSlug;
use test_cabinet_entities::model_price;

use crate::auth::AuthUser;
use crate::db::{ModelConfigWrite, StoredModel};
use crate::error::ApiError;

use super::AppState;

/// The base of a model's OpenRouter page / price listing.
const OPENROUTER_BASE: &str = "https://openrouter.ai/";

/// `GET /models` — the merged model catalog.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ModelCatalogResponse {
    pub models: Vec<ModelOut>,
}

/// One catalog entry: a curated model merged with its runs and price history, or
/// a model derived from runs with no curated config.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ModelOut {
    /// The curated slug, or the canonical model id for a derived model.
    pub slug: String,
    /// The display name (a derived model uses its canonical id).
    pub name: String,
    /// The provider (guessed from the id for a derived model).
    pub provider: String,
    /// Whether this entry has curated config, as opposed to being derived from
    /// runs alone.
    pub curated: bool,
    /// `https://openrouter.ai/<slug>` when the model is on OpenRouter, else null.
    pub openrouter_url: Option<String>,
    /// Curated description markdown, or null.
    pub description: Option<String>,
    /// The curated, sanitized provider-logo SVG, or null.
    pub logo_svg: Option<String>,
    /// The raw `subject.modelId` strings from runs this entry absorbs — what the
    /// console matches a run against.
    pub covered_model_ids: Vec<String>,
    /// The canonical model ids this entry claims.
    pub aliases: Vec<String>,
    /// The latest observed comparable price, or null when none is recorded.
    pub price: Option<ModelPricesOut>,
    /// The observed price history, ascending, consecutive-equal deduped.
    pub price_history: Vec<PriceObservationOut>,
    /// The latest observed context window in tokens, or null.
    pub context_length: Option<u64>,
    /// The latest observed release date (RFC 3339), or null.
    pub released_at: Option<String>,
}

/// A comparable per-token price triple.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ModelPricesOut {
    pub uncached_input: Option<f64>,
    pub cached_input: Option<f64>,
    pub output: Option<f64>,
}

/// One price observation in a model's history.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PriceObservationOut {
    pub observed_at: String,
    pub prices: ModelPricesOut,
}

/// The `POST /models` / `PUT /models/{slug}` request body.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ModelConfigInput {
    /// The curated slug (used on create; the path wins on update).
    pub slug: String,
    pub name: String,
    pub provider: String,
    /// The canonical model ids this model covers (at least one).
    pub aliases: Vec<String>,
    pub openrouter_slug: Option<String>,
    pub description: Option<String>,
    /// The stored provider-logo SVG (already fetched via `POST /models/logo`).
    pub logo_svg: Option<String>,
    /// The svgl.app URL the logo was fetched from, kept for reference.
    pub provider_logo_url: Option<String>,
}

/// The `GET /models/seed` response: a blank-form seed derived from a run.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ModelSeedOut {
    /// Suggested slug (the canonical id), which the operator may change.
    pub slug: String,
    /// Empty — the operator must set a display name explicitly.
    pub name: String,
    /// Provider guessed from the model id, possibly empty.
    pub provider: String,
    /// Suggested aliases (the canonical and raw forms), deduped.
    pub aliases: Vec<String>,
    /// The canonical id as an OpenRouter slug, when it looks like one.
    pub openrouter_slug: Option<String>,
}

/// The `POST /models/logo` request/response.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LogoFetchInput {
    pub url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LogoFetchOut {
    pub logo_svg: String,
}

/// `GET /models` — the merged catalog across all runs. Open read.
#[tracing::instrument(name = "models.list", skip(state), err(Debug))]
pub async fn list(State(state): State<AppState>) -> Result<Json<ModelCatalogResponse>, ApiError> {
    let configs = state.db.list_model_configs().await.map_err(ApiError::from)?;
    let prices = state.db.all_model_prices().await.map_err(ApiError::from)?;
    let run_models = state.db.distinct_run_models().await.map_err(ApiError::from)?;
    let models = compose_catalog(&configs, &prices, &run_models);
    Ok(Json(ModelCatalogResponse { models }))
}

/// `POST /models` — create a curated model config. Requires a bearer token.
#[tracing::instrument(name = "models.create", skip(state, _user, input), err(Debug))]
pub async fn create(
    State(state): State<AppState>,
    _user: AuthUser,
    Json(input): Json<ModelConfigInput>,
) -> Result<Json<ModelOut>, ApiError> {
    let slug = input.slug.trim().to_string();
    if slug.is_empty() {
        return Err(ApiError::unprocessable("model.slug must be non-empty"));
    }
    if state
        .db
        .get_model_config(&slug)
        .await
        .map_err(ApiError::from)?
        .is_some()
    {
        return Err(ApiError::conflict(format!("model `{slug}` already exists")));
    }
    write_config(&state, slug, input).await
}

/// `PUT /models/{slug}` — update a curated model config. Requires a bearer token.
#[tracing::instrument(name = "models.update", skip(state, _user, input), fields(model.slug = %slug), err(Debug))]
pub async fn update(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    _user: AuthUser,
    Json(input): Json<ModelConfigInput>,
) -> Result<Json<ModelOut>, ApiError> {
    write_config(&state, slug, input).await
}

/// Validate, (optionally) fetch the logo, persist, refresh the snapshot, and
/// return the composed entry. Shared by create and update.
async fn write_config(
    state: &AppState,
    slug: String,
    input: ModelConfigInput,
) -> Result<Json<ModelOut>, ApiError> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::unprocessable("model.name must be non-empty"));
    }
    let aliases = normalize_aliases(&input.aliases);
    if aliases.is_empty() {
        return Err(ApiError::unprocessable(
            "model.aliases must include at least one id",
        ));
    }

    // Fetch the logo now if a URL is given and no SVG was pre-fetched, so the
    // stored config is self-contained.
    let logo_svg = match (input.logo_svg, &input.provider_logo_url) {
        (Some(svg), _) if !svg.trim().is_empty() => Some(svg),
        (_, Some(url)) if !url.trim().is_empty() => {
            Some(crate::logo::fetch_logo_svg(&state.http, url).await?)
        }
        _ => None,
    };

    let now = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| ApiError::internal(format!("formatting timestamp: {e}")))?;

    state
        .db
        .upsert_model_config(ModelConfigWrite {
            slug: slug.clone(),
            display_name: name,
            provider: input.provider.trim().to_string(),
            provider_logo_url: input
                .provider_logo_url
                .filter(|u| !u.trim().is_empty()),
            provider_logo_svg: logo_svg,
            description_md: input.description.filter(|d| !d.trim().is_empty()),
            openrouter_slug: input
                .openrouter_slug
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            aliases,
            now,
        })
        .await
        .map_err(ApiError::from)?;

    // The catalog changed, so the public snapshot must be regenerated. Best-effort
    // price seeding for a newly-configured openrouter slug happens on the next
    // run completion or periodic refresh.
    state.publisher.queue_refresh();

    // Re-compose just this model for the response.
    let config = state
        .db
        .get_model_config(&slug)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::internal("model vanished after write"))?;
    let prices = state.db.all_model_prices().await.map_err(ApiError::from)?;
    let run_models = state.db.distinct_run_models().await.map_err(ApiError::from)?;
    let composed = compose_catalog(std::slice::from_ref(&config), &prices, &run_models);
    let out = composed
        .into_iter()
        .find(|m| m.slug == slug)
        .ok_or_else(|| ApiError::internal("composed model missing after write"))?;
    Ok(Json(out))
}

/// `DELETE /models/{slug}` — remove a curated model config. Requires a bearer
/// token. The model may reappear as a derived entry if it still has runs.
#[tracing::instrument(name = "models.delete", skip(state, _user), fields(model.slug = %slug), err(Debug))]
pub async fn delete(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    _user: AuthUser,
) -> Result<StatusCode, ApiError> {
    let removed = state
        .db
        .delete_model_config(&slug)
        .await
        .map_err(ApiError::from)?;
    if !removed {
        return Err(ApiError::not_found(format!("model `{slug}` not found")));
    }
    state.publisher.queue_refresh();
    Ok(StatusCode::NO_CONTENT)
}

/// The `GET /models/seed` query.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeedQuery {
    /// Seed from this run's model id + harness.
    pub run_id: String,
}

/// `GET /models/seed?runId=` — a blank-form seed derived from a run's model id.
/// An open read (an authoring aid deriving only from a stored run's model id).
#[tracing::instrument(name = "models.seed", skip(state), fields(run.id = %query.run_id), err(Debug))]
pub async fn seed(
    State(state): State<AppState>,
    Query(query): Query<SeedQuery>,
) -> Result<Json<ModelSeedOut>, ApiError> {
    let run = state
        .db
        .get_run(&query.run_id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found(format!("run `{}` not found", query.run_id)))?;
    let raw = run.record.subject.model_id.clone();
    let harness = run.record.subject.harness_slug;
    let canonical = canonical_model_id(&raw, harness);

    let mut aliases = vec![canonical.clone()];
    if raw != canonical {
        aliases.push(raw);
    }
    aliases.dedup();

    Ok(Json(ModelSeedOut {
        slug: canonical.clone(),
        name: String::new(),
        provider: guess_provider(&canonical),
        aliases,
        openrouter_slug: canonical.contains('/').then(|| canonical.clone()),
    }))
}

/// `POST /models/logo` — fetch and sanitize an svgl.app logo for the config form
/// to preview and store. Requires a bearer token.
#[tracing::instrument(name = "models.logo", skip(state, _user, input), err(Debug))]
pub async fn logo(
    State(state): State<AppState>,
    _user: AuthUser,
    Json(input): Json<LogoFetchInput>,
) -> Result<Json<LogoFetchOut>, ApiError> {
    let logo_svg = crate::logo::fetch_logo_svg(&state.http, &input.url).await?;
    Ok(Json(LogoFetchOut { logo_svg }))
}

/// Compose the merged catalog from curated configs, the full price history, and
/// the distinct `(model_id, harness_slug)` pairs some runs reference.
///
/// This is the single composition the `GET /models` read and the public snapshot
/// share, so the console and the static site show the same catalog. Curated
/// configs absorb the runs whose canonical id matches one of their aliases;
/// every remaining canonical id becomes a derived entry.
pub fn compose_catalog(
    configs: &[StoredModel],
    prices: &[model_price::Model],
    run_models: &[(String, String)],
) -> Vec<ModelOut> {
    // Price history grouped by (canonical) model id, ascending, consecutive-equal
    // deduped.
    let mut history: std::collections::HashMap<&str, Vec<&model_price::Model>> =
        std::collections::HashMap::new();
    for row in prices {
        history.entry(row.model_id.as_str()).or_default().push(row);
    }

    // canonical id -> the raw model_id strings runs reported for it.
    let mut covered: std::collections::BTreeMap<String, Vec<String>> =
        std::collections::BTreeMap::new();
    for (model_id, harness_slug) in run_models {
        let harness = parse_harness(harness_slug);
        let canonical = canonical_model_id(model_id, harness);
        let ids = covered.entry(canonical).or_default();
        if !ids.contains(model_id) {
            ids.push(model_id.clone());
        }
    }

    // Which canonical ids are claimed by a curated model's alias set.
    let mut claimed: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut out: Vec<ModelOut> = Vec::new();

    for stored in configs {
        let alias_set: Vec<String> = stored.aliases.clone();
        let mut covered_ids: Vec<String> = Vec::new();
        for alias in &alias_set {
            claimed.insert(alias.clone());
            if let Some(ids) = covered.get(alias) {
                for id in ids {
                    if !covered_ids.contains(id) {
                        covered_ids.push(id.clone());
                    }
                }
            }
        }
        // Merge the histories of every alias into one series.
        let mut rows: Vec<&model_price::Model> = alias_set
            .iter()
            .filter_map(|a| history.get(a.as_str()))
            .flatten()
            .copied()
            .collect();
        rows.sort_by(|a, b| a.observed_at.cmp(&b.observed_at).then(a.id.cmp(&b.id)));
        let series = observations(&rows);
        let (price, context_length, released_at) = latest_facts(&rows);
        let config = &stored.config;
        out.push(ModelOut {
            slug: config.slug.clone(),
            name: config.display_name.clone(),
            provider: config.provider.clone(),
            curated: true,
            openrouter_url: config.openrouter_slug.as_deref().map(openrouter_url),
            description: config.description_md.clone(),
            logo_svg: config.provider_logo_svg.clone(),
            covered_model_ids: covered_ids,
            aliases: alias_set,
            price,
            price_history: series,
            context_length,
            released_at,
        });
    }

    // Every canonical id no curated model claims becomes a derived entry.
    for (canonical, ids) in &covered {
        if claimed.contains(canonical) {
            continue;
        }
        let rows: Vec<&model_price::Model> = history
            .get(canonical.as_str())
            .cloned()
            .unwrap_or_default();
        let series = observations(&rows);
        let (price, context_length, released_at) = latest_facts(&rows);
        out.push(ModelOut {
            slug: canonical.clone(),
            name: canonical.clone(),
            provider: guess_provider(canonical),
            curated: false,
            openrouter_url: canonical.contains('/').then(|| openrouter_url(canonical)),
            description: None,
            logo_svg: None,
            covered_model_ids: ids.clone(),
            aliases: vec![canonical.clone()],
            price,
            price_history: series,
            context_length,
            released_at,
        });
    }

    out.sort_by_key(|model| model.name.to_lowercase());
    out
}

/// Build the deduped observation series (consecutive-equal price triples
/// collapsed) from time-ordered rows.
fn observations(rows: &[&model_price::Model]) -> Vec<PriceObservationOut> {
    let mut series: Vec<PriceObservationOut> = Vec::new();
    for row in rows {
        let prices = ModelPricesOut {
            uncached_input: row.uncached_input,
            cached_input: row.cached_input,
            output: row.output,
        };
        if series.last().map(|o| &o.prices) == Some(&prices) {
            continue;
        }
        series.push(PriceObservationOut {
            observed_at: row.observed_at.clone(),
            prices,
        });
    }
    series
}

/// The latest price, context window, and release date from time-ordered rows.
fn latest_facts(rows: &[&model_price::Model]) -> (Option<ModelPricesOut>, Option<u64>, Option<String>) {
    match rows.last() {
        Some(row) => (
            Some(ModelPricesOut {
                uncached_input: row.uncached_input,
                cached_input: row.cached_input,
                output: row.output,
            }),
            row.context_length.and_then(|c| u64::try_from(c).ok()),
            row.released_at.clone(),
        ),
        None => (None, None, None),
    }
}

/// Normalize the alias strings a config claims: trim, drop the `openrouter/`
/// routing prefix (so it matches a run's canonical id), drop blanks, dedup.
fn normalize_aliases(aliases: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for alias in aliases {
        let trimmed = alias.trim();
        let base = trimmed.strip_prefix("openrouter/").unwrap_or(trimmed);
        if !base.is_empty() && !out.iter().any(|a| a == base) {
            out.push(base.to_string());
        }
    }
    out
}

/// `https://openrouter.ai/<slug>` for a model slug.
fn openrouter_url(slug: &str) -> String {
    format!("{OPENROUTER_BASE}{slug}")
}

/// Guess a provider name from a canonical model id: the segment before the first
/// `/` (for example `anthropic/claude-...` → `anthropic`), or empty when the id
/// carries no provider segment.
fn guess_provider(canonical: &str) -> String {
    match canonical.split_once('/') {
        Some((provider, _)) => provider.to_string(),
        None => String::new(),
    }
}

/// Parse a stored harness slug string back into a [`HarnessSlug`], defaulting to
/// Claude for an unrecognized value (only reached if the DB holds a slug the
/// current build does not know, which does not affect the openrouter/-prefix
/// strip that canonicalization applies to every harness).
fn parse_harness(slug: &str) -> HarnessSlug {
    HarnessSlug::ALL
        .into_iter()
        .find(|h| h.as_str() == slug)
        .unwrap_or(HarnessSlug::Claude)
}

#[cfg(test)]
#[path = "models.test.rs"]
mod tests;
