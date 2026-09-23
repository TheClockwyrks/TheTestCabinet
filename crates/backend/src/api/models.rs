//! The model-catalog endpoints: the merged catalog read plus the operator-driven
//! config CRUD, seed-from-run helper, OpenRouter fill-in lookup, and svgl.app
//! logo fetch.
//!
//! The catalog is composed on the fly from three sources: the operator-curated
//! `model` configs (display name, provider, logo, prose, aliases), the observed
//! `model_price` history, and the distinct models the stored runs reference. Any
//! model with at least one run appears — curated or not — so a newly-run model
//! shows up without a release. Curated config is layered on by alias; an
//! uncurated model is shown, derived, under its canonical id.
//!
//! Reads are open (the private-network model); the config mutations, the
//! OpenRouter lookup, and the logo fetch require a bearer token (see
//! [`AuthUser`]) — the last two because they reach a third party. The same
//! [`compose_catalog`] the read uses also builds the public snapshot's catalog, so
//! the two never disagree.

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use test_cabinet_core::model_id::canonical_model_id;
use test_cabinet_core::run_record::{HarnessFamily, HarnessSlug};
use test_cabinet_entities::model_price;

use crate::auth::AuthUser;
use crate::db::{AliasEntry, ModelConfigWrite, StoredModel};
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
    /// The canonical model ids this entry claims, each tagged with the harness
    /// family it is usable with (so a run form can offer only the slugs the
    /// selected harness can launch).
    pub aliases: Vec<AliasOut>,
    /// The latest observed comparable price, or null when none is recorded.
    pub price: Option<ModelPricesOut>,
    /// The observed price history, ascending, consecutive-equal deduped.
    pub price_history: Vec<PriceObservationOut>,
    /// The latest observed context window in tokens, or null.
    pub context_length: Option<u64>,
    /// The OpenRouter provider this model's requests are pinned to: the hand-set
    /// override when one is set, otherwise the official endpoint observed on the listing.
    /// Null means no official endpoint is known, and a launch of the model is refused.
    pub provider_pin: Option<String>,
    /// Whether [`provider_pin`](Self::provider_pin) is the curated override rather than
    /// the observed official endpoint.
    pub provider_pin_set_by_hand: bool,
    /// The latest observed release date (RFC 3339), or null.
    pub released_at: Option<String>,
    /// The input modalities OpenRouter reports the model accepts (`text`,
    /// `image`, `file`, …), lowercased. **Empty means unobserved**, not "text
    /// only" — the catalog has simply not recorded a modality list for this model
    /// yet, and a consumer deciding whether it may send an image treats that as
    /// unknown rather than as a refusal.
    pub input_modalities: Vec<String>,
}

/// One canonical model id a catalog entry claims, with the harness family it is
/// usable with. The run form filters the models it offers a harness by matching
/// the harness's family against these.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct AliasOut {
    /// The canonical model id (an OpenRouter id like `anthropic/claude-opus-4.8`,
    /// or a provider-native id like `claude-opus-4-8`).
    pub slug: String,
    /// The harness family this slug is usable with.
    pub harness_family: HarnessFamily,
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

/// One slug ↔ harness-family pairing in a config write. The operator supplies a
/// slug and picks the harness family it belongs to; a model with slugs across
/// several families carries one entry per (slug, family).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct AliasInput {
    /// The canonical model id (the `openrouter/` routing prefix is stripped on
    /// write so it matches a run's canonical id).
    pub slug: String,
    /// The harness family this slug is usable with.
    pub harness_family: HarnessFamily,
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
    /// The canonical model ids this model covers, each paired with the harness
    /// family it is usable with (at least one).
    pub aliases: Vec<AliasInput>,
    pub openrouter_slug: Option<String>,
    /// The OpenRouter provider this model's requests are pinned to, set by hand where
    /// the endpoints listing's name does not match the model id's author segment. Absent
    /// means the observed listing name is the pin.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub provider_pin: Option<String>,
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
    /// Suggested aliases (the canonical and raw forms), deduped, each tagged with
    /// the family of the harness the seed run used.
    pub aliases: Vec<AliasOut>,
    /// The canonical id as an OpenRouter slug, when it looks like one.
    pub openrouter_slug: Option<String>,
}

/// The `GET /models/openrouter` response: the descriptive facts OpenRouter
/// publishes about a model, for the config form to fill itself in with.
///
/// Only the fields a curator would otherwise retype are here. Prices, the context
/// window, and the modalities are deliberately absent: the backend records those
/// itself from the same catalog (on save, on launch, and on the 24-hour refresh),
/// so they are never form state to begin with.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ModelListingOut {
    /// The display name, with OpenRouter's `Provider: ` prefix stripped.
    pub name: String,
    /// The provider's presentational name (`Anthropic`), from that same prefix.
    pub provider: String,
    /// OpenRouter's prose description, or null when it publishes none.
    pub description: Option<String>,
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
    let configs = state
        .db
        .list_model_configs()
        .await
        .map_err(ApiError::from)?;
    let prices = state.db.all_model_prices().await.map_err(ApiError::from)?;
    let run_models = state
        .db
        .distinct_run_models()
        .await
        .map_err(ApiError::from)?;
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
    // A slug is meaningless without a valid family; a run form can't offer it
    // under any harness otherwise. `normalize_aliases` already drops blank slugs,
    // so any surviving pair is a real (slug, family).

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

    let openrouter_slug = input
        .openrouter_slug
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    state
        .db
        .upsert_model_config(ModelConfigWrite {
            slug: slug.clone(),
            display_name: name,
            provider: input.provider.trim().to_string(),
            provider_logo_url: input.provider_logo_url.filter(|u| !u.trim().is_empty()),
            provider_logo_svg: logo_svg,
            description_md: input.description.filter(|d| !d.trim().is_empty()),
            openrouter_slug: openrouter_slug.clone(),
            provider_pin: input
                .provider_pin
                .map(|slug| slug.trim().to_string())
                .filter(|slug| !slug.is_empty()),
            aliases,
            now,
        })
        .await
        .map_err(ApiError::from)?;

    // Price a newly-configured OpenRouter slug right now, so the model shows its prices
    // (and its context window) the moment it is saved rather than staying blank until
    // its first run completes. Best-effort and missing-only: a slug already on record
    // costs nothing and keeps its history.
    if let Some(slug) = &openrouter_slug {
        crate::bootstrap::seed_curated_price(&state.db, &state.prices, slug).await;
    }

    // The catalog changed, so the public snapshot must be regenerated — after the
    // seeding above, so the snapshot carries the price too.
    state.publisher.queue_refresh();

    // Re-compose just this model for the response.
    let config = state
        .db
        .get_model_config(&slug)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::internal("model vanished after write"))?;
    let prices = state.db.all_model_prices().await.map_err(ApiError::from)?;
    let run_models = state
        .db
        .distinct_run_models()
        .await
        .map_err(ApiError::from)?;
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

    // Every seeded id came from the same run, so it belongs to that harness's
    // family — the operator can retag it in the form before saving.
    let family = harness.family();
    let mut slugs = vec![canonical.clone()];
    if raw != canonical {
        slugs.push(raw);
    }
    slugs.dedup();
    let aliases = slugs
        .into_iter()
        .map(|slug| AliasOut {
            slug,
            harness_family: family,
        })
        .collect();

    Ok(Json(ModelSeedOut {
        slug: canonical.clone(),
        name: String::new(),
        provider: guess_provider(&canonical),
        aliases,
        openrouter_slug: canonical.contains('/').then(|| canonical.clone()),
    }))
}

/// The `GET /models/openrouter` query.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRouterLookupQuery {
    /// The OpenRouter slug to look up, e.g. `anthropic/claude-opus-4.8`.
    pub slug: String,
}

/// `GET /models/openrouter?slug=` — the descriptive facts OpenRouter publishes
/// about a model, so the config form can fill itself in instead of the operator
/// retyping what OpenRouter already knows. Requires a bearer token.
///
/// Bearer-gated like the logo fetch, and for the same reason: both make the
/// backend reach out to a third party on the caller's behalf, so both are limited
/// to signed-in operators rather than open like the catalog read.
///
/// A slug OpenRouter does not list is a `404` — the operator mistyped it, or the
/// model is not on OpenRouter at all, and either way the form should say so rather
/// than silently fill nothing in.
#[tracing::instrument(name = "models.openrouter", skip(state, _user), fields(model.openrouter_slug = %query.slug), err(Debug))]
pub async fn openrouter(
    State(state): State<AppState>,
    _user: AuthUser,
    Query(query): Query<OpenRouterLookupQuery>,
) -> Result<Json<ModelListingOut>, ApiError> {
    let slug = lookup_slug(&query.slug)
        .ok_or_else(|| ApiError::unprocessable("slug must be non-empty"))?;
    let listing =
        state.prices.model_listing(slug).await.map_err(|err| {
            ApiError::not_found(format!("looking up `{slug}` on OpenRouter: {err}"))
        })?;
    Ok(Json(ModelListingOut {
        name: listing.name,
        provider: listing.provider,
        description: listing.description,
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

/// The hand-set provider of the curated model that claims `model_id`, when one is set.
///
/// This is the override for a listing whose provider name does not match the author segment
/// of the model id. Absent means the observed listing name is the pin.
pub async fn curated_provider_pin(
    db: &crate::db::Db,
    model_id: &str,
    harness: HarnessSlug,
) -> crate::error::Result<Option<String>> {
    let canonical = canonical_model_id(model_id, harness);
    db.provider_pin_for_alias(&canonical).await
}

/// The catalog's [launch facts](test_cabinet_core::ModelLaunchFacts) for the model a
/// run names — the latest observed context window and input modalities for it — or
/// empty fields where the catalog has recorded nothing.
///
/// The catalog is the **single store of model facts**, so this is the one place they
/// are looked up: a run that needs them (a [gg](test_cabinet_core::gg) run, whose
/// fullness accounting and compaction trigger are measured against the window, and
/// whose reference-image reads are gated on the modalities) is told the answers at
/// launch rather than keeping a table of its own.
///
/// The lookup mirrors how prices are recorded: observations are keyed by the run's
/// canonical model id, except for a **curated** model, whose observations are stored
/// under its configured OpenRouter slug so every alias shares one history. So the
/// canonical id is tried first and the curated slug second.
///
/// Best-effort by construction: a model with no price observation yet (the catalog
/// learns one when the model is first priced) simply has no facts, which the caller
/// treats as "unknown" rather than an error.
pub async fn launch_facts_for(
    db: &crate::db::Db,
    model_id: &str,
    harness: HarnessSlug,
) -> crate::error::Result<test_cabinet_core::ModelLaunchFacts> {
    let canonical = canonical_model_id(model_id, harness);
    if let Some(facts) = latest_launch_facts(db, &canonical).await? {
        return Ok(facts);
    }
    let Some(slug) = db.openrouter_slug_for_alias(&canonical).await? else {
        return Ok(test_cabinet_core::ModelLaunchFacts::default());
    };
    Ok(latest_launch_facts(db, &slug).await?.unwrap_or_default())
}

/// The catalog facts on the latest price observation stored under `key`, or `None`
/// when there is no observation at all. An observation recorded before a column
/// existed simply carries an empty field for it.
async fn latest_launch_facts(
    db: &crate::db::Db,
    key: &str,
) -> crate::error::Result<Option<test_cabinet_core::ModelLaunchFacts>> {
    Ok(db
        .latest_price(key)
        .await?
        .map(|row| test_cabinet_core::ModelLaunchFacts {
            context_window: row
                .context_length
                .and_then(|length| u64::try_from(length).ok()),
            input_modalities: crate::bootstrap::decode_modalities(row.input_modalities.as_deref()),
            provider_pin: row
                .provider_pin
                .filter(|provider| !provider.trim().is_empty()),
        }))
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
    // canonical id -> the harness family that reported it (for a derived entry's
    // alias tag). Native and OpenRouter ids canonicalize to disjoint forms, so a
    // canonical id maps to a single family; the first run to name it wins.
    let mut covered_family: std::collections::BTreeMap<String, HarnessFamily> =
        std::collections::BTreeMap::new();
    for (model_id, harness_slug) in run_models {
        let harness = parse_harness(harness_slug);
        let canonical = canonical_model_id(model_id, harness);
        covered_family
            .entry(canonical.clone())
            .or_insert_with(|| harness.family());
        let ids = covered.entry(canonical).or_default();
        if !ids.contains(model_id) {
            ids.push(model_id.clone());
        }
    }

    // Which canonical ids are claimed by a curated model's alias set.
    let mut claimed: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut out: Vec<ModelOut> = Vec::new();

    for stored in configs {
        let alias_set = &stored.aliases;
        let mut covered_ids: Vec<String> = Vec::new();
        for entry in alias_set {
            claimed.insert(entry.alias.clone());
            if let Some(ids) = covered.get(&entry.alias) {
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
            .filter_map(|a| history.get(a.alias.as_str()))
            .flatten()
            .copied()
            .collect();
        rows.sort_by(|a, b| a.observed_at.cmp(&b.observed_at).then(a.id.cmp(&b.id)));
        let series = observations(&rows);
        let facts = latest_facts(&rows);
        let config = &stored.config;
        let hand_set_pin = config
            .provider_pin
            .clone()
            .filter(|provider| !provider.trim().is_empty());
        out.push(ModelOut {
            slug: config.slug.clone(),
            name: config.display_name.clone(),
            provider: config.provider.clone(),
            curated: true,
            openrouter_url: config.openrouter_slug.as_deref().map(openrouter_url),
            description: config.description_md.clone(),
            logo_svg: config.provider_logo_svg.clone(),
            covered_model_ids: covered_ids,
            aliases: alias_set
                .iter()
                .map(|entry| AliasOut {
                    slug: entry.alias.clone(),
                    harness_family: entry.family,
                })
                .collect(),
            price: facts.price,
            price_history: series,
            context_length: facts.context_length,
            released_at: facts.released_at,
            input_modalities: facts.input_modalities,
            provider_pin_set_by_hand: hand_set_pin.is_some(),
            provider_pin: hand_set_pin.or(facts.provider_pin),
        });
    }

    // Every canonical id no curated model claims becomes a derived entry.
    for (canonical, ids) in &covered {
        if claimed.contains(canonical) {
            continue;
        }
        let rows: Vec<&model_price::Model> =
            history.get(canonical.as_str()).cloned().unwrap_or_default();
        let series = observations(&rows);
        let facts = latest_facts(&rows);
        let family = covered_family
            .get(canonical)
            .copied()
            .unwrap_or(HarnessFamily::Openrouter);
        out.push(ModelOut {
            slug: canonical.clone(),
            name: canonical.clone(),
            provider: guess_provider(canonical),
            curated: false,
            openrouter_url: canonical.contains('/').then(|| openrouter_url(canonical)),
            description: None,
            logo_svg: None,
            covered_model_ids: ids.clone(),
            aliases: vec![AliasOut {
                slug: canonical.clone(),
                harness_family: family,
            }],
            price: facts.price,
            price_history: series,
            context_length: facts.context_length,
            released_at: facts.released_at,
            input_modalities: facts.input_modalities,
            provider_pin: facts.provider_pin,
            provider_pin_set_by_hand: false,
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

/// The catalog facts carried on the newest of `rows` (time-ordered): the latest
/// price, context window, release date, and accepted input modalities.
#[derive(Debug, Default)]
struct LatestFacts {
    price: Option<ModelPricesOut>,
    context_length: Option<u64>,
    released_at: Option<String>,
    input_modalities: Vec<String>,
    provider_pin: Option<String>,
}

/// The latest price and catalog facts from time-ordered rows.
fn latest_facts(rows: &[&model_price::Model]) -> LatestFacts {
    match rows.last() {
        Some(row) => LatestFacts {
            price: Some(ModelPricesOut {
                uncached_input: row.uncached_input,
                cached_input: row.cached_input,
                output: row.output,
            }),
            context_length: row.context_length.and_then(|c| u64::try_from(c).ok()),
            released_at: row.released_at.clone(),
            input_modalities: crate::bootstrap::decode_modalities(row.input_modalities.as_deref()),
            provider_pin: row
                .provider_pin
                .clone()
                .filter(|provider| !provider.trim().is_empty()),
        },
        None => LatestFacts::default(),
    }
}

/// Normalize the (slug, family) pairs a config claims: trim the slug, drop the
/// `openrouter/` routing prefix (so it matches a run's canonical id), drop blanks,
/// and dedup by slug (first family wins, since a canonical id belongs to one
/// family).
fn normalize_aliases(aliases: &[AliasInput]) -> Vec<AliasEntry> {
    let mut out: Vec<AliasEntry> = Vec::new();
    for entry in aliases {
        let trimmed = entry.slug.trim();
        let base = trimmed.strip_prefix("openrouter/").unwrap_or(trimmed);
        if !base.is_empty() && !out.iter().any(|a| a.alias == base) {
            out.push(AliasEntry {
                alias: base.to_string(),
                family: entry.harness_family,
            });
        }
    }
    out
}

/// The OpenRouter slug to look a listing up under: trimmed, with the
/// `openrouter/` routing prefix dropped, or `None` when nothing is left.
///
/// The prefix is stripped for the same reason an alias write strips it — it is
/// how some harnesses spell a routed id, and OpenRouter's own catalog does not
/// carry it — so a slug pasted straight out of a run resolves rather than 404s.
fn lookup_slug(raw: &str) -> Option<&str> {
    let trimmed = raw.trim();
    let base = trimmed.strip_prefix("openrouter/").unwrap_or(trimmed);
    (!base.is_empty()).then_some(base)
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
    // `from_wire` recognizes every variant (gg included), so canonicalization is
    // correct for a gg run rather than defaulting to Claude for an unknown slug.
    HarnessSlug::from_wire(slug).unwrap_or(HarnessSlug::Claude)
}

#[cfg(test)]
#[path = "models.test.rs"]
mod tests;
