//! The saved **gg configuration** endpoints (`/gg/configs`).
//!
//! A gg run is configured by a declarative
//! [capability set](test_cabinet_core::gg::GgCapabilitySet) rather than the flat
//! `(harness, model, orchestrator)` tuple a third-party-harness run carries — so
//! the configuration, not the harness, is the thing worth naming and reusing. An
//! operator registers configurations here (the account section's gg tab), and the
//! new-run form offers them in the harness slot once `gg` is picked as the
//! orchestrator: the picked configuration supplies the capability set and the row's
//! model binds its [primary slot](test_cabinet_core::gg::PRIMARY_SLOT).
//!
//! Everything is per-account (attributed to the token's account via [`AuthUser`])
//! and private to that operator, exactly like the reviewer's
//! [coverage](super::coverage) tooling. The console additionally offers a handful
//! of code-defined *built-in* configurations (`full`, `minimal`, `no-compaction`,
//! `shell-only`); those are read-only and never stored here, so this surface only
//! ever holds what the operator authored.
//!
//! Deleting a configuration does not disturb runs launched from it: every gg run
//! records its own resolved capability set, so the analysis surfaces keep slicing
//! by what actually ran.

#[cfg(test)]
#[path = "gg_config.test.rs"]
mod tests;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use test_cabinet_core::gg::GgCapabilitySet;

use crate::auth::AuthUser;
use crate::error::ApiError;

use super::AppState;

/// The longest a configuration's display name may be. Names are shown in a
/// dropdown, so a pasted wall of text is rejected rather than truncated.
const MAX_NAME_LEN: usize = 80;

/// The longest a configuration's description may be — a one-line note, not a
/// document.
const MAX_DESCRIPTION_LEN: usize = 280;

/// An operator's saved, reusable gg configuration: a named
/// [capability set](GgCapabilitySet) the new-run form can launch as-is.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgConfig {
    /// The configuration's opaque id (minted on create).
    pub id: String,
    /// The operator-chosen display name.
    pub name: String,
    /// A one-line note on what the configuration is for. Empty when unset.
    pub description: String,
    /// The capability set a run launched from this configuration carries.
    pub capability_set: GgCapabilitySet,
    /// RFC 3339 of when the configuration was last saved.
    pub updated_at: String,
}

/// The create/update body for a gg configuration (the server assigns `id` and
/// `updatedAt`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgConfigInput {
    /// The operator-chosen display name.
    pub name: String,
    /// A one-line note on what the configuration is for.
    #[serde(default)]
    pub description: String,
    /// The capability set to save.
    pub capability_set: GgCapabilitySet,
}

/// `GET /gg/configs` — every configuration the token account owns, by name.
pub async fn list_configs(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Vec<GgConfig>>, ApiError> {
    let configs = state
        .db
        .list_gg_configs(&user.0.id)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(configs))
}

/// `POST /gg/configs` — register a configuration.
pub async fn create_config(
    State(state): State<AppState>,
    user: AuthUser,
    Json(input): Json<GgConfigInput>,
) -> Result<Json<GgConfig>, ApiError> {
    let config = config_from_input(new_id(), input, &now()?)?;
    state
        .db
        .insert_gg_config(&user.0.id, &config)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(config))
}

/// `PUT /gg/configs/{id}` — update a configuration in place. 404 when the id is not
/// the caller's.
pub async fn update_config(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(input): Json<GgConfigInput>,
) -> Result<Json<GgConfig>, ApiError> {
    let config = config_from_input(id, input, &now()?)?;
    let updated = state
        .db
        .update_gg_config(&user.0.id, &config)
        .await
        .map_err(ApiError::from)?;
    if !updated {
        return Err(ApiError::not_found("gg configuration not found"));
    }
    Ok(Json(config))
}

/// `DELETE /gg/configs/{id}` — delete a configuration. Runs already launched from
/// it keep their own recorded capability set. 404 when the id is not the caller's.
pub async fn delete_config(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let deleted = state
        .db
        .delete_gg_config(&user.0.id, &id)
        .await
        .map_err(ApiError::from)?;
    if !deleted {
        return Err(ApiError::not_found("gg configuration not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}

/// A fresh opaque id for a configuration.
fn new_id() -> String {
    cuid2::create_id()
}

/// The current time as an RFC 3339 `updatedAt` string.
fn now() -> Result<String, ApiError> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| ApiError::internal(format!("formatting updatedAt: {e}")))
}

/// Build a stored configuration from a create/update body, validating the name and
/// description. Unlike a launch, an *unbound* primary slot is fine here: a saved
/// configuration is a reusable capability set, and the new-run form binds the
/// primary slot from the row's model picker at launch.
pub(crate) fn config_from_input(
    id: String,
    input: GgConfigInput,
    updated_at: &str,
) -> Result<GgConfig, ApiError> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::bad_request("a gg configuration needs a name"));
    }
    if name.chars().count() > MAX_NAME_LEN {
        return Err(ApiError::bad_request(format!(
            "a gg configuration name may be at most {MAX_NAME_LEN} characters"
        )));
    }
    let description = input.description.trim().to_string();
    if description.chars().count() > MAX_DESCRIPTION_LEN {
        return Err(ApiError::bad_request(format!(
            "a gg configuration description may be at most {MAX_DESCRIPTION_LEN} characters"
        )));
    }
    Ok(GgConfig {
        id,
        name,
        description,
        capability_set: input.capability_set,
        updated_at: updated_at.to_string(),
    })
}
