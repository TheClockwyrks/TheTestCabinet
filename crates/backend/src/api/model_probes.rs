//! The model-probe endpoints: trigger a responses-as-code readiness probe of a
//! catalog model, read its history, and enumerate the providers it can be
//! pinned to.
//!
//! The probe itself — the per-language case fixtures, the two scenarios, the
//! classification of each submitted program, and the verdict — is
//! [`crate::probe`]; these handlers own only the HTTP surface and the row
//! lifecycle. Triggering takes a person's assertion (the backend spends the
//! operator's OpenRouter credit on their behalf), as does the provider
//! enumeration (a third-party reach, like the OpenRouter form fill); the reads
//! are open like the rest of the catalog. Probe results are console-only data
//! and never feed the public snapshot.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use test_cabinet_entities::{model_probe, model_probe_item};

use crate::auth::Person;
use crate::error::ApiError;
use crate::probe;

use super::AppState;

pub use test_cabinet_contracts::backend_api::models::{
    ModelProbeDetailResponse, ModelProbeItemOut, ModelProbeOut, ModelProbesResponse,
    ProbeProviderOut, ProbeProvidersResponse, ProbeTriggerInput, ProbeTriggerResponse,
};

/// `POST /models/{slug}/probes` — trigger a probe. Takes a person's assertion; the
/// probe runs in the background and the row is returned `running` immediately.
#[tracing::instrument(name = "model_probes.trigger", skip(state, user, input), fields(model.slug = %slug), err(Debug))]
pub async fn trigger(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    user: Person,
    input: Option<Json<ProbeTriggerInput>>,
) -> Result<(StatusCode, Json<ProbeTriggerResponse>), ApiError> {
    let Some(api_key) = state.config.openrouter_api_key.clone() else {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "openrouter_key_missing",
            "TCAB_OPENROUTER_API_KEY is not configured on this backend",
        ));
    };
    let Json(input) = input.unwrap_or_default();
    let samples = input.samples.unwrap_or(probe::DEFAULT_SAMPLES);
    if !(1..=probe::MAX_SAMPLES).contains(&samples) {
        return Err(ApiError::unprocessable(format!(
            "samples must be between 1 and {}",
            probe::MAX_SAMPLES
        )));
    }
    let max_tokens = input.max_tokens.unwrap_or(probe::DEFAULT_MAX_TOKENS);
    if !(256..=probe::MAX_MAX_TOKENS).contains(&max_tokens) {
        return Err(ApiError::unprocessable(format!(
            "maxTokens must be between 256 and {}",
            probe::MAX_MAX_TOKENS
        )));
    }
    let provider = input
        .provider
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty());
    let language = input
        .language
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty());
    // The one authority on which arms exist: the embedded fixtures. An unknown
    // id is refused here rather than failing the probe after it was accepted.
    let requests = probe::probe_requests(language.as_deref()).map_err(ApiError::unprocessable)?;

    let openrouter_slug = resolve_openrouter_slug(&state, &slug).await?;
    if state
        .db
        .model_probe_running(&slug)
        .await
        .map_err(ApiError::from)?
    {
        return Err(ApiError::conflict(format!(
            "a probe of `{slug}` is already running"
        )));
    }

    // The trigger hands the probe to its runner under a fresh lease, renewed while
    // the runner runs, so a probe whose backend is gone is seen to have lost it.
    let created_at = now()?;
    let holder = cuid2::create_id();
    let lease_expires_at = crate::db::probe_lease_expiry(&created_at).map_err(ApiError::from)?;
    let row = model_probe::Model {
        id: cuid2::create_id(),
        model_slug: slug,
        openrouter_slug,
        provider,
        user_id: user.0.clone(),
        language,
        samples,
        max_tokens,
        request_json: serde_json::to_string(&requests)
            .map_err(|e| ApiError::internal(format!("encoding the probe requests: {e}")))?,
        status: "running".to_string(),
        error: None,
        verdict: None,
        pass_rate: None,
        spend: 0.0,
        created_at,
        finished_at: None,
        lease_expires_at: Some(lease_expires_at),
        lease_holder: Some(holder.clone()),
    };
    state
        .db
        .insert_model_probe(row.clone())
        .await
        .map_err(ApiError::from)?;

    // Detached, like the completion-time observation: the operator gets the row
    // back immediately and polls it; the runner records everything on the rows.
    let runner = probe::ProbeRunner {
        db: std::sync::Arc::clone(&state.db),
        http: state.http.clone(),
        endpoint: probe::DEFAULT_COMPLETIONS_ENDPOINT.to_string(),
        api_key,
        holder,
        renew_every: probe::PROBE_LEASE_RENEWAL,
    };
    let spawned = row.clone();
    tokio::spawn(async move { runner.run(spawned).await });

    Ok((
        StatusCode::ACCEPTED,
        Json(ProbeTriggerResponse {
            probe: probe_out(row),
        }),
    ))
}

/// `GET /models/{slug}/probes` — the model's probe history, newest first. Open
/// read.
#[tracing::instrument(name = "model_probes.list", skip(state), fields(model.slug = %slug), err(Debug))]
pub async fn list(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<ModelProbesResponse>, ApiError> {
    let probes = state
        .db
        .list_model_probes(&slug)
        .await
        .map_err(ApiError::from)?
        .into_iter()
        .map(probe_out)
        .collect();
    Ok(Json(ModelProbesResponse { probes }))
}

/// `GET /model-probes/{id}` — one probe with its items, raw replies, and the
/// per-case requests as sent. Open read.
#[tracing::instrument(name = "model_probes.get", skip(state), fields(probe.id = %id), err(Debug))]
pub async fn get(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ModelProbeDetailResponse>, ApiError> {
    let row = state
        .db
        .get_model_probe(&id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found(format!("probe `{id}` not found")))?;
    let items = state
        .db
        .list_model_probe_items(&id)
        .await
        .map_err(ApiError::from)?
        .into_iter()
        .map(item_out)
        .collect();
    let requests: Vec<probe::ProbeRequestOut> = serde_json::from_str(&row.request_json)
        .map_err(|e| ApiError::internal(format!("decoding the stored probe requests: {e}")))?;
    Ok(Json(ModelProbeDetailResponse {
        probe: probe_out(row),
        items,
        requests,
    }))
}

/// `GET /models/{slug}/probe-providers` — the providers OpenRouter lists for
/// the model, so a probe can be pinned to one. Takes a person's assertion (a
/// third-party reach on the caller's behalf, like the OpenRouter form fill).
#[tracing::instrument(name = "model_probes.providers", skip(state, _user), fields(model.slug = %slug), err(Debug))]
pub async fn providers(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    _user: Person,
) -> Result<Json<ProbeProvidersResponse>, ApiError> {
    let openrouter_slug = resolve_openrouter_slug(&state, &slug).await?;
    let routes = state
        .prices
        .provider_routes(&openrouter_slug)
        .await
        .map_err(|err| {
            ApiError::not_found(format!(
                "looking up `{openrouter_slug}` on OpenRouter: {err}"
            ))
        })?;
    Ok(Json(ProbeProvidersResponse {
        openrouter_slug,
        providers: routes
            .into_iter()
            .map(|route| ProbeProviderOut {
                name: route.name,
                context_length: route.context_length,
            })
            .collect(),
    }))
}

/// The OpenRouter slug a probe of `slug` targets: a curated model's configured
/// OpenRouter slug, and otherwise the catalog slug itself when it already reads
/// as an OpenRouter id (a derived model's canonical `provider/model`). A model
/// with neither cannot be probed — the probe speaks OpenRouter only.
pub(super) async fn resolve_openrouter_slug(
    state: &AppState,
    slug: &str,
) -> Result<String, ApiError> {
    let config = state
        .db
        .get_model_config(slug)
        .await
        .map_err(ApiError::from)?;
    if let Some(stored) = config
        && let Some(openrouter_slug) = stored.config.openrouter_slug
    {
        return Ok(openrouter_slug);
    }
    if slug.contains('/') {
        return Ok(slug.to_string());
    }
    Err(ApiError::unprocessable(format!(
        "model `{slug}` has no OpenRouter slug"
    )))
}

/// Map a stored probe row to the wire shape.
fn probe_out(row: model_probe::Model) -> ModelProbeOut {
    ModelProbeOut {
        id: row.id,
        model_slug: row.model_slug,
        openrouter_slug: row.openrouter_slug,
        provider: row.provider,
        language: row.language,
        samples: row.samples,
        max_tokens: row.max_tokens,
        status: row.status,
        error: row.error,
        verdict: row.verdict,
        pass_rate: row.pass_rate,
        spend: row.spend,
        created_at: row.created_at,
        finished_at: row.finished_at,
    }
}

/// Map a stored probe item row to the wire shape.
fn item_out(row: model_probe_item::Model) -> ModelProbeItemOut {
    ModelProbeItemOut {
        id: row.id,
        language: row.language,
        scenario: row.scenario,
        prompt: row.prompt,
        sample: row.sample,
        provider: row.provider,
        finish_reason: row.finish_reason,
        native_finish_reason: row.native_finish_reason,
        label: row.label,
        pass: row.pass,
        program_text: row.program_text,
        response_text: row.response_text,
        reasoning_text: row.reasoning_text,
        prompt_tokens: row.prompt_tokens,
        completion_tokens: row.completion_tokens,
        cost: row.cost,
        duration_ms: row.duration_ms,
        error: row.error,
        created_at: row.created_at,
    }
}

/// The current time as an RFC 3339 string.
fn now() -> Result<String, ApiError> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| ApiError::internal(format!("formatting timestamp: {e}")))
}
