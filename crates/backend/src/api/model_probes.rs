//! The model-probe endpoints: trigger a responses-as-code readiness probe of a
//! catalog model, read its history, and enumerate the providers it can be
//! pinned to.
//!
//! The probe itself — the replayed gg turn-1 request, the condition matrix, the
//! reply classification, and the verdict — is [`crate::probe`]; these handlers
//! own only the HTTP surface and the row lifecycle. Triggering requires a
//! bearer token (the backend spends the operator's OpenRouter credit on their
//! behalf), as does the provider enumeration (a third-party reach, like the
//! OpenRouter form fill); the reads are open like the rest of the catalog.
//! Probe results are console-only data and never feed the public snapshot.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use test_cabinet_entities::{model_probe, model_probe_item};

use crate::auth::AuthUser;
use crate::error::ApiError;
use crate::probe;

use super::AppState;

/// The `POST /models/{slug}/probes` request body. Everything is optional: an
/// empty body probes the default route with the default sampling.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ProbeTriggerInput {
    /// Pin every call to this provider (`provider.order` with fallbacks
    /// disabled). Absent probes the default route.
    pub provider: Option<String>,
    /// Samples per condition (default 3, at most 8).
    pub samples: Option<i32>,
    /// Completion-token cap per call (default 3500).
    pub max_tokens: Option<i32>,
    /// Send the seeded spec views whole instead of trimmed (default false).
    pub full_context: Option<bool>,
}

/// One probe, as every probe read returns it (the detail read adds the items
/// and the request).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ModelProbeOut {
    pub id: String,
    /// The catalog slug the probe was triggered from.
    pub model_slug: String,
    /// The OpenRouter slug the completions were requested under.
    pub openrouter_slug: String,
    /// The pinned provider, or null for the default route.
    pub provider: Option<String>,
    pub samples: i32,
    pub max_tokens: i32,
    pub full_context: bool,
    /// `running`, `complete`, or `failed`.
    pub status: String,
    /// Why the probe failed, or null.
    pub error: Option<String>,
    /// `ready`, `ready-with-reminders`, `tool-call-overfit`, or `not-ready`;
    /// null until the probe completes.
    pub verdict: Option<String>,
    /// The base condition's clean-reply rate (0..=1), or null.
    pub base_clean_rate: Option<f64>,
    /// The best variation condition's clean-reply rate (0..=1), or null.
    pub best_variation_clean_rate: Option<f64>,
    /// Total USD spend across the probe's calls, as OpenRouter reported it.
    pub spend: f64,
    pub created_at: String,
    pub finished_at: Option<String>,
}

/// One completion call inside a probe: which provider served it, how it
/// finished, its classification, and the model's raw reply.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ModelProbeItemOut {
    pub id: String,
    /// The prompt condition (`base`, `no-tools`, `notice`, `combo`).
    pub condition: String,
    pub sample: i32,
    /// The provider OpenRouter reported serving the call, or null on error.
    pub provider: Option<String>,
    pub finish_reason: Option<String>,
    pub native_finish_reason: Option<String>,
    /// The classified reply shape, or null when the call errored.
    pub label: Option<String>,
    /// Whether the reply counts as clean (a bare program over the gg modules).
    pub clean: bool,
    /// The model's raw reply content, verbatim.
    pub response_text: String,
    /// The reply's separate reasoning stream, or null.
    pub reasoning_text: Option<String>,
    pub prompt_tokens: Option<i64>,
    pub completion_tokens: Option<i64>,
    /// The call's USD cost, or null.
    pub cost: Option<f64>,
    pub duration_ms: i64,
    /// The transport or gateway error that voided the call, or null.
    pub error: Option<String>,
    pub created_at: String,
}

/// One condition of the probe matrix, so the console can say what each item's
/// request added on top of the base request.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ProbeConditionOut {
    pub name: String,
    /// Whether the condition appends the no-tools clause to the system prompt.
    pub no_tools_clause: bool,
    /// Whether the condition appends the trailing user notice.
    pub trailing_notice: bool,
    /// Whether the condition counts as a variation in the verdict.
    pub variation: bool,
}

/// The `POST /models/{slug}/probes` response: the probe row, already running.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ProbeTriggerResponse {
    pub probe: ModelProbeOut,
}

/// The `GET /models/{slug}/probes` response, newest first.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ModelProbesResponse {
    pub probes: Vec<ModelProbeOut>,
}

/// The `GET /model-probes/{id}` response: the probe with everything the console
/// shows — what was sent (the base request plus each condition's additions),
/// every call's classification, and the raw replies.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ModelProbeDetailResponse {
    pub probe: ModelProbeOut,
    pub items: Vec<ModelProbeItemOut>,
    /// The base condition's message array exactly as sent.
    pub request_messages: Vec<probe::ProbeMessage>,
    /// The matrix the items' `condition` names refer to.
    pub conditions: Vec<ProbeConditionOut>,
    /// The clause the `no-tools`/`combo` conditions appended to the system
    /// prompt.
    pub no_tools_clause: String,
    /// The trailing user message the `notice`/`combo` conditions appended.
    pub notice_message: String,
}

/// The `GET /models/{slug}/probe-providers` response.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ProbeProvidersResponse {
    /// The OpenRouter slug the providers were enumerated for.
    pub openrouter_slug: String,
    pub providers: Vec<ProbeProviderOut>,
}

/// One provider route OpenRouter lists for the model.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ProbeProviderOut {
    /// The provider's display name — the value a probe pins with.
    pub name: String,
    /// The route's context window in tokens, or null when unreported.
    pub context_length: Option<u64>,
}

/// `POST /models/{slug}/probes` — trigger a probe. Requires a bearer token; the
/// probe runs in the background and the row is returned `running` immediately.
#[tracing::instrument(name = "model_probes.trigger", skip(state, user, input), fields(model.slug = %slug), err(Debug))]
pub async fn trigger(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    user: AuthUser,
    input: Option<Json<ProbeTriggerInput>>,
) -> Result<(StatusCode, Json<ProbeTriggerResponse>), ApiError> {
    let Some(api_key) = state.config.openrouter_api_key.clone() else {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "openrouter_key_missing",
            "model probes are disabled: this backend has no TCAB_OPENROUTER_API_KEY configured",
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
    let full_context = input.full_context.unwrap_or(false);

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

    let request_messages = probe::build_messages(&probe::CONDITIONS[0], full_context);
    let row = model_probe::Model {
        id: cuid2::create_id(),
        model_slug: slug,
        openrouter_slug,
        provider,
        user_id: user.0.id.clone(),
        samples,
        max_tokens,
        full_context,
        request_json: serde_json::to_string(&request_messages)
            .map_err(|e| ApiError::internal(format!("encoding the probe request: {e}")))?,
        status: "running".to_string(),
        error: None,
        verdict: None,
        base_clean_rate: None,
        best_variation_clean_rate: None,
        spend: 0.0,
        created_at: now()?,
        finished_at: None,
    };
    state
        .db
        .insert_model_probe(row.clone())
        .await
        .map_err(ApiError::from)?;

    // Detached, like the completion-price observation: the operator gets the row
    // back immediately and polls it; the runner records everything on the rows.
    let runner = probe::ProbeRunner {
        db: std::sync::Arc::clone(&state.db),
        http: state.http.clone(),
        endpoint: probe::DEFAULT_COMPLETIONS_ENDPOINT.to_string(),
        api_key,
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
/// request as sent. Open read.
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
    let request_messages: Vec<probe::ProbeMessage> = serde_json::from_str(&row.request_json)
        .map_err(|e| ApiError::internal(format!("decoding the stored probe request: {e}")))?;
    Ok(Json(ModelProbeDetailResponse {
        probe: probe_out(row),
        items,
        request_messages,
        conditions: probe::CONDITIONS.iter().map(condition_out).collect(),
        no_tools_clause: probe::NO_TOOLS_CLAUSE.to_string(),
        notice_message: probe::NOTICE_MESSAGE.to_string(),
    }))
}

/// `GET /models/{slug}/probe-providers` — the providers OpenRouter lists for
/// the model, so a probe can be pinned to one. Requires a bearer token (a
/// third-party reach on the caller's behalf, like the OpenRouter form fill).
#[tracing::instrument(name = "model_probes.providers", skip(state, _user), fields(model.slug = %slug), err(Debug))]
pub async fn providers(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    _user: AuthUser,
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
async fn resolve_openrouter_slug(state: &AppState, slug: &str) -> Result<String, ApiError> {
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
        "model `{slug}` has no OpenRouter slug to probe; set one in its configuration"
    )))
}

/// Map a stored probe row to the wire shape.
fn probe_out(row: model_probe::Model) -> ModelProbeOut {
    ModelProbeOut {
        id: row.id,
        model_slug: row.model_slug,
        openrouter_slug: row.openrouter_slug,
        provider: row.provider,
        samples: row.samples,
        max_tokens: row.max_tokens,
        full_context: row.full_context,
        status: row.status,
        error: row.error,
        verdict: row.verdict,
        base_clean_rate: row.base_clean_rate,
        best_variation_clean_rate: row.best_variation_clean_rate,
        spend: row.spend,
        created_at: row.created_at,
        finished_at: row.finished_at,
    }
}

/// Map a stored probe item row to the wire shape.
fn item_out(row: model_probe_item::Model) -> ModelProbeItemOut {
    ModelProbeItemOut {
        id: row.id,
        condition: row.condition,
        sample: row.sample,
        provider: row.provider,
        finish_reason: row.finish_reason,
        native_finish_reason: row.native_finish_reason,
        label: row.label,
        clean: row.clean,
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

/// Map a matrix condition to the wire shape.
fn condition_out(condition: &probe::ProbeCondition) -> ProbeConditionOut {
    ProbeConditionOut {
        name: condition.name.to_string(),
        no_tools_clause: condition.no_tools_clause,
        trailing_notice: condition.trailing_notice,
        variation: condition.variation,
    }
}

/// The current time as an RFC 3339 string.
fn now() -> Result<String, ApiError> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| ApiError::internal(format!("formatting timestamp: {e}")))
}
