//! The per-harness configuration endpoints: the operator-tunable knobs the console
//! edits from its Harnesses settings, keyed by harness slug.
//!
//! Harness *identity* (name, binary, install command) is static and checked in
//! (`harnesses/<slug>/harness.toml` + the core adapter), so the read here enumerates
//! the harnesses the core layer knows and layers any stored overrides on top. Today
//! the only knob is a harness's maximum parallelism — how many runs of it the Test
//! Cabinet drives at once — which the backend's [claim](crate::db::Db::claim_next_job)
//! enforces by holding surplus runs in the `pending` state.
//!
//! Reads are open (the private-network model, like the model catalog); the mutation
//! requires a bearer token (see [`AuthUser`]).

use axum::Json;
use axum::extract::{Path, State};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use test_cabinet_core::run_record::HarnessSlug;
use test_cabinet_core::{DefaultHarnessRegistry, HarnessRegistry};

use crate::auth::AuthUser;
use crate::error::ApiError;

use super::AppState;

/// The largest maximum-parallelism value accepted, clamping an absurd request. Far
/// above any realistic per-harness fleet, so it never constrains a real operator.
const MAX_PARALLELISM_LIMIT: i32 = 1024;

/// One harness's configuration, as `GET /harness-config` reports it: its identity
/// (slug + display name, from the static catalog) plus the tunable knobs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessConfigOut {
    /// The harness slug (for example `claude`).
    pub slug: String,
    /// The human-readable harness name.
    pub name: String,
    /// The maximum number of runs of this harness the Test Cabinet will drive at
    /// once, or `null` for no limit.
    pub max_parallelism: Option<i32>,
}

/// The `POST /harness-config/{slug}` request body: the harness's tunable settings.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessConfigInput {
    /// The new maximum parallelism (`>= 1`), or `null` for no limit.
    pub max_parallelism: Option<i32>,
}

/// `GET /harness-config` — every harness the Test Cabinet knows, each with its
/// current configuration. Enumerates the static harness catalog so a harness with no
/// stored overrides still appears (at its defaults); open read.
pub async fn list(
    State(state): State<AppState>,
) -> Result<Json<Vec<HarnessConfigOut>>, ApiError> {
    let stored = state.db.list_harness_configs().await.map_err(ApiError::from)?;
    let registry = DefaultHarnessRegistry::new();
    let out = HarnessSlug::ALL
        .into_iter()
        .map(|slug| {
            let name = registry
                .get(slug)
                .map(|harness| harness.name().to_string())
                .unwrap_or_else(|| slug.as_str().to_string());
            let max_parallelism = stored
                .iter()
                .find(|row| row.harness_slug == slug.as_str())
                .and_then(|row| row.max_parallelism);
            HarnessConfigOut {
                slug: slug.as_str().to_string(),
                name,
                max_parallelism,
            }
        })
        .collect();
    Ok(Json(out))
}

/// `POST /harness-config/{slug}` — set a harness's configuration. Requires a bearer
/// token. `404` for an unknown harness slug, `422` for a non-positive limit; returns
/// the refreshed full list so the console adopts one authoritative view.
#[tracing::instrument(name = "harness_config.set", skip(state, _user, input), fields(harness.slug = %slug), err(Debug))]
pub async fn set(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(slug): Path<String>,
    Json(input): Json<HarnessConfigInput>,
) -> Result<Json<Vec<HarnessConfigOut>>, ApiError> {
    // Only a harness the core layer actually knows may be configured — an unknown
    // slug would create dead config the dispatcher never consults.
    let known = HarnessSlug::ALL.iter().any(|s| s.as_str() == slug);
    if !known {
        return Err(ApiError::not_found(format!("unknown harness `{slug}`")));
    }
    if let Some(max) = input.max_parallelism {
        if max < 1 {
            return Err(ApiError::unprocessable(
                "`maxParallelism` must be at least 1 (use null for no limit)",
            ));
        }
        if max > MAX_PARALLELISM_LIMIT {
            return Err(ApiError::unprocessable(format!(
                "`maxParallelism` must not exceed {MAX_PARALLELISM_LIMIT}"
            )));
        }
    }

    let now = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| ApiError::internal(format!("formatting timestamp: {e}")))?;
    state
        .db
        .set_harness_max_parallelism(&slug, input.max_parallelism, &now)
        .await
        .map_err(ApiError::from)?;

    list(State(state)).await
}
