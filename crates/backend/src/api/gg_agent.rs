//! The saved **gg agent** endpoints (`/gg/agents`) — the operator's agent library.
//!
//! A gg configuration declares the agents a run is conducted by. A saved agent is one
//! such profile authored on its own, under its own name: the
//! [configuration editor](super::GgConfig) imports one, and may override fields on its
//! own copy while leaving the profile stored here as it is. A reviewer used by four
//! configurations is therefore authored once and edited in one place.
//!
//! **Data only.** A saved agent is an authoring convenience and nothing else. It owns no
//! run-time resources: memories, skills and every other per-agent store stay scoped to
//! the run that created them exactly as they were, so two configurations importing the
//! same agent share nothing when they run, any more than two runs of one configuration
//! do.
//!
//! **gg never sees this surface.** A configuration is stored — and launched — with every
//! agent written out in full, because gg is handed a configuration whose agents are
//! already whole; the console resolves an import into that form before anything leaves
//! it. What the console additionally records on the configuration is *where* each agent
//! came from ([`GgAgentSource`](super::GgAgentSource)), which is what makes an
//! import a live reference rather than a copy.
//!
//! Everything is per-account (attributed to the token's account via [`AuthUser`]) and
//! private to that operator, exactly like the configurations themselves.
//!
//! Deleting a saved agent does not disturb the configurations that imported it: each
//! carries its own resolved copy, which simply stops following this one.

#[cfg(test)]
#[path = "gg_agent.test.rs"]
mod tests;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};

use test_cabinet_core::gg::{GgAgentConfig, GgModelSlot};

use crate::auth::AuthUser;
use crate::error::ApiError;

use super::AppState;
use super::gg_config::{MAX_DESCRIPTION_LEN, MAX_NAME_LEN, new_id, now};

/// An operator's saved, reusable agent profile: one agent authored on its own, ready to
/// be imported into any number of gg configurations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSavedAgent {
    /// The saved agent's opaque id (minted on create). This is what an importing
    /// configuration points at, so renaming the agent never breaks an import.
    pub id: String,
    /// The profile's name — the agent's own [`name`](GgAgentConfig::name), lifted out so
    /// the library can be listed and ordered by it. Display text: two saved agents may
    /// carry one name, and the [id](Self::id) is what tells them apart. There is
    /// deliberately no second name: the thing an operator names in the editor is the
    /// agent.
    pub name: String,
    /// A one-line note on what the agent is for. Empty when unset. The library's own
    /// note — not the caller-scoped description a roster entry carries, which says when
    /// *one particular* agent should put this one to work.
    pub description: String,
    /// The profile itself, in exactly the form a configuration's agent list holds.
    pub agent: GgAgentConfig,
    /// The model slots this agent's bindings defer to. Carried with the agent because a
    /// binding names a slot the *configuration* declares: importing this agent into one
    /// that does not declare a named slot declares it, with the default given here.
    pub model_slots: Vec<GgModelSlot>,
    /// RFC 3339 of when the agent was last saved.
    pub updated_at: String,
}

/// The create/update body for a saved agent (the server assigns `id` and `updatedAt`,
/// and lifts `name` off the agent itself).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSavedAgentInput {
    /// A one-line note on what the agent is for.
    #[serde(default)]
    pub description: String,
    /// The profile to save. Its `name` becomes the library entry's name.
    pub agent: GgAgentConfig,
    /// The model slots this agent's bindings defer to.
    #[serde(default)]
    pub model_slots: Vec<GgModelSlot>,
}

/// `GET /gg/agents` — every saved agent the token account owns, by name.
pub async fn list_agents(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Vec<GgSavedAgent>>, ApiError> {
    let agents = state
        .db
        .list_gg_agents(&user.0.id)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(agents))
}

/// `POST /gg/agents` — save an agent.
pub async fn create_agent(
    State(state): State<AppState>,
    user: AuthUser,
    Json(input): Json<GgSavedAgentInput>,
) -> Result<Json<GgSavedAgent>, ApiError> {
    let agent = agent_from_input(new_id(), input, &now()?)?;
    state
        .db
        .insert_gg_agent(&user.0.id, &agent)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(agent))
}

/// `PUT /gg/agents/{id}` — update a saved agent in place. Every configuration that
/// imported it follows the change, except in the fields it overrides. 404 when the id is
/// not the caller's.
pub async fn update_agent(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(input): Json<GgSavedAgentInput>,
) -> Result<Json<GgSavedAgent>, ApiError> {
    let agent = agent_from_input(id, input, &now()?)?;
    let updated = state
        .db
        .update_gg_agent(&user.0.id, &agent)
        .await
        .map_err(ApiError::from)?;
    if !updated {
        return Err(ApiError::not_found("gg agent not found"));
    }
    Ok(Json(agent))
}

/// `DELETE /gg/agents/{id}` — delete a saved agent. A configuration that imported it
/// keeps its own resolved copy and simply stops following this one. 404 when the id is
/// not the caller's.
pub async fn delete_agent(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let deleted = state
        .db
        .delete_gg_agent(&user.0.id, &id)
        .await
        .map_err(ApiError::from)?;
    if !deleted {
        return Err(ApiError::not_found("gg agent not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Build a stored agent from a create/update body, checking that the name (which is the
/// agent's own) is present and short enough to list, and the description likewise. A
/// binding deferred to a model slot is what a saved agent normally carries: it is a
/// reusable profile, and which model it runs on is settled by the configuration that
/// imports it and the launch that fills that slot.
pub(crate) fn agent_from_input(
    id: String,
    input: GgSavedAgentInput,
    updated_at: &str,
) -> Result<GgSavedAgent, ApiError> {
    let mut agent = input.agent;
    let name = agent.name.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::bad_request("a gg agent needs a name"));
    }
    if name.chars().count() > MAX_NAME_LEN {
        return Err(ApiError::bad_request(format!(
            "a gg agent name may be at most {MAX_NAME_LEN} characters"
        )));
    }
    agent.name = name.clone();
    let description = input.description.trim().to_string();
    if description.chars().count() > MAX_DESCRIPTION_LEN {
        return Err(ApiError::bad_request(format!(
            "a gg agent description may be at most {MAX_DESCRIPTION_LEN} characters"
        )));
    }
    Ok(GgSavedAgent {
        id,
        name,
        description,
        agent,
        model_slots: input.model_slots,
        updated_at: updated_at.to_string(),
    })
}
