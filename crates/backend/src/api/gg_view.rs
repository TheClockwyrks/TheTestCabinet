//! The saved **gg view** endpoints (`/gg/saved-queries`, `/gg/dashboards`) — the
//! per-account objects that sit over the deployment-wide analysis corpus.
//!
//! The asymmetry is deliberate and is the whole model: a gg run belongs to the
//! deployment (the [query endpoints](super::gg_query) take a bearer token and ignore
//! whose it is, exactly as the run listings and the coverage matrix already treat
//! runs), while a *view* over the corpus — a question worth keeping, a board worth
//! opening every morning — is personal. So these follow the
//! [gg configuration](super::gg_config) and coverage-plan precedent to the letter:
//! `user_id` from the verified token, an opaque id minted on create, name and
//! description validated the same way, 404 rather than 403 when an id is not the
//! caller's.
//!
//! Two decisions here are load-bearing enough to state:
//!
//! - **A view stores query *source text*, never a compiled query.** That is what
//!   keeps a relative `started >= now-30d` relative — a saved question re-resolves on
//!   every run rather than freezing the window it was written in — and it is what
//!   stops a later grammar addition from invalidating something already saved. The
//!   backend never parses text; the client compiles and sends the tree.
//! - **A dashboard panel carries a *copy* of its text, not a reference to a saved
//!   query.** A board is a thing an operator returns to, and a reference that can be
//!   edited or deleted out from under it turns a saved board into a dangling one.
//!   "Build a panel from a saved query" is therefore an editing affordance in the
//!   console (the text is copied in), not a stored relationship — nothing here has to
//!   resolve, cascade, or fail.
//!
//! The board-level [range](GgDashboard::range_id) is stored as the picker's token
//! rather than as absolute milliseconds for the same reason the text is: a board
//! saved on "last 30 days" means the last thirty days whenever it is opened.

#[cfg(test)]
#[path = "gg_view.test.rs"]
mod tests;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::auth::AuthUser;
use crate::error::ApiError;

use super::AppState;

/// The longest a view's display name may be. Names are shown in a list and in a
/// panel heading, so a pasted wall of text is rejected rather than truncated.
const MAX_NAME_LEN: usize = 80;

/// The longest a view's description may be — a one-line note, not a document.
const MAX_DESCRIPTION_LEN: usize = 280;

/// The longest a stored query's source text may be.
///
/// Generous by the standard of the grammar (the longest worked example in the design
/// is under 120 characters) and deliberately so: the ceiling exists to stop a paste
/// accident from becoming a row, not to police how someone writes a question.
const MAX_QUERY_LEN: usize = 4_000;

/// The most panels one dashboard may carry.
///
/// Matches [`GG_QUERY_MAX_BATCH`](super::gg_query::GG_QUERY_MAX_BATCH) — a board is
/// rendered by exactly one batched request, so a board that could hold more panels
/// than a batch can carry would be a board that cannot be drawn. Keeping the two
/// numbers equal means the failure is impossible rather than merely unlikely.
pub const MAX_DASHBOARD_PANELS: usize = super::gg_query::GG_QUERY_MAX_BATCH;

/// The dashboard grid's width, in columns.
///
/// Twelve because it divides by 2, 3, 4 and 6, so halves, thirds and quarters are all
/// exact — the same reason every other twelve-column grid is twelve columns.
pub const DASHBOARD_COLUMNS: u32 = 12;

/// An operator's saved TCQ query: a question worth keeping, with the range it was
/// asked over.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSavedQuery {
    /// The query's opaque id (minted on create).
    pub id: String,
    /// The operator-chosen display name.
    pub name: String,
    /// A one-line note on what the query answers. Empty when unset.
    pub description: String,
    /// The query as TCQ **source text**, exactly as it was typed — never its
    /// compiled form, so `now-30d` re-resolves on every run.
    pub query: String,
    /// The time range the query was saved with, as the picker's token (`24h`, `7d`,
    /// `30d`, `90d`, `1y`, `all`). Beside the text rather than inside it, because the
    /// range is a control rather than an edit.
    pub range_id: String,
    /// RFC 3339 of when the query was last saved.
    pub updated_at: String,
}

/// The create/update body for a saved query (the server assigns `id` and
/// `updatedAt`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSavedQueryInput {
    /// The operator-chosen display name.
    pub name: String,
    /// A one-line note on what the query answers.
    #[serde(default)]
    pub description: String,
    /// The query as TCQ source text.
    pub query: String,
    /// The time range token to save with it. Defaults to the whole corpus.
    #[serde(default = "default_range")]
    pub range_id: String,
}

/// One panel of a [dashboard](GgDashboard): a heading, a query, and how wide it sits.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgDashboardPanel {
    /// The panel's heading.
    pub title: String,
    /// The panel's query, as TCQ **source text**. A copy, even when the panel was
    /// built from a saved query — see the module docs.
    pub query: String,
    /// How many of the [twelve](DASHBOARD_COLUMNS) grid columns the panel spans,
    /// clamped to `1..=12`.
    pub width: u32,
}

/// An operator's saved dashboard: panels of TCQ over one board-level range.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgDashboard {
    /// The dashboard's opaque id (minted on create).
    pub id: String,
    /// The operator-chosen display name.
    pub name: String,
    /// A one-line note on what the board is for. Empty when unset.
    pub description: String,
    /// The board's panels, in render order, at most [`MAX_DASHBOARD_PANELS`].
    pub panels: Vec<GgDashboardPanel>,
    /// The board-level time range, as the picker's token. **One per board** — a panel
    /// never gets its own.
    pub range_id: String,
    /// RFC 3339 of when the dashboard was last saved.
    pub updated_at: String,
}

/// The create/update body for a dashboard (the server assigns `id` and `updatedAt`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgDashboardInput {
    /// The operator-chosen display name.
    pub name: String,
    /// A one-line note on what the board is for.
    #[serde(default)]
    pub description: String,
    /// The board's panels, in render order.
    #[serde(default)]
    pub panels: Vec<GgDashboardPanel>,
    /// The board-level time range token. Defaults to the whole corpus.
    #[serde(default = "default_range")]
    pub range_id: String,
}

/// The range token a view carries when none was sent: the whole corpus.
///
/// The same default Discover opens on, and for the same reason — gg runs are
/// experiment material recorded in bursts, so a view that silently defaulted to a
/// recent window would greet most operators with an empty result and no clue that the
/// corpus is fine.
fn default_range() -> String {
    "all".to_string()
}

/// `GET /gg/saved-queries` — every saved query the token account owns, by name.
pub async fn list_saved_queries(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Vec<GgSavedQuery>>, ApiError> {
    let saved = state
        .db
        .list_gg_saved_queries(&user.0.id)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(saved))
}

/// `POST /gg/saved-queries` — save a query.
pub async fn create_saved_query(
    State(state): State<AppState>,
    user: AuthUser,
    Json(input): Json<GgSavedQueryInput>,
) -> Result<Json<GgSavedQuery>, ApiError> {
    let saved = saved_query_from_input(new_id(), input, &now()?)?;
    state
        .db
        .insert_gg_saved_query(&user.0.id, &saved)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(saved))
}

/// `PUT /gg/saved-queries/{id}` — update a saved query in place. 404 when the id is
/// not the caller's.
pub async fn update_saved_query(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(input): Json<GgSavedQueryInput>,
) -> Result<Json<GgSavedQuery>, ApiError> {
    let saved = saved_query_from_input(id, input, &now()?)?;
    let updated = state
        .db
        .update_gg_saved_query(&user.0.id, &saved)
        .await
        .map_err(ApiError::from)?;
    if !updated {
        return Err(ApiError::not_found("saved query not found"));
    }
    Ok(Json(saved))
}

/// `DELETE /gg/saved-queries/{id}` — delete a saved query. Dashboards built from it
/// are unaffected: a panel carries its own copy of the text. 404 when the id is not
/// the caller's.
pub async fn delete_saved_query(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let deleted = state
        .db
        .delete_gg_saved_query(&user.0.id, &id)
        .await
        .map_err(ApiError::from)?;
    if !deleted {
        return Err(ApiError::not_found("saved query not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}

/// `GET /gg/dashboards` — every dashboard the token account owns, by name.
pub async fn list_dashboards(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Vec<GgDashboard>>, ApiError> {
    let boards = state
        .db
        .list_gg_dashboards(&user.0.id)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(boards))
}

/// `GET /gg/dashboards/{id}` — one dashboard by id, so a board is deep-linkable
/// without loading every board the account owns. 404 when the id is not the caller's.
pub async fn get_dashboard(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<GgDashboard>, ApiError> {
    state
        .db
        .get_gg_dashboard(&user.0.id, &id)
        .await
        .map_err(ApiError::from)?
        .map(Json)
        .ok_or_else(|| ApiError::not_found("dashboard not found"))
}

/// `POST /gg/dashboards` — save a dashboard.
pub async fn create_dashboard(
    State(state): State<AppState>,
    user: AuthUser,
    Json(input): Json<GgDashboardInput>,
) -> Result<Json<GgDashboard>, ApiError> {
    let board = dashboard_from_input(new_id(), input, &now()?)?;
    state
        .db
        .insert_gg_dashboard(&user.0.id, &board)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(board))
}

/// `PUT /gg/dashboards/{id}` — update a dashboard in place. 404 when the id is not
/// the caller's.
pub async fn update_dashboard(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(input): Json<GgDashboardInput>,
) -> Result<Json<GgDashboard>, ApiError> {
    let board = dashboard_from_input(id, input, &now()?)?;
    let updated = state
        .db
        .update_gg_dashboard(&user.0.id, &board)
        .await
        .map_err(ApiError::from)?;
    if !updated {
        return Err(ApiError::not_found("dashboard not found"));
    }
    Ok(Json(board))
}

/// `DELETE /gg/dashboards/{id}` — delete a dashboard. 404 when the id is not the
/// caller's.
pub async fn delete_dashboard(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let deleted = state
        .db
        .delete_gg_dashboard(&user.0.id, &id)
        .await
        .map_err(ApiError::from)?;
    if !deleted {
        return Err(ApiError::not_found("dashboard not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}

/// A fresh opaque id for a saved view.
fn new_id() -> String {
    cuid2::create_id()
}

/// The current time as an RFC 3339 `updatedAt` string.
fn now() -> Result<String, ApiError> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| ApiError::internal(format!("formatting updatedAt: {e}")))
}

/// Build a stored saved query from a create/update body.
///
/// The query text is trimmed but **not parsed**: the parser is TypeScript-only by
/// design, and a server-side syntax check would be a second grammar to keep in step
/// with the first. An unparseable query saved by a broken client surfaces as an error
/// on the surface that runs it, which is where an operator can actually fix it.
pub(crate) fn saved_query_from_input(
    id: String,
    input: GgSavedQueryInput,
    updated_at: &str,
) -> Result<GgSavedQuery, ApiError> {
    let name = validated_name(&input.name, "a saved query")?;
    let description = validated_description(&input.description, "a saved query")?;
    let query = validated_query(&input.query, "a saved query")?;
    Ok(GgSavedQuery {
        id,
        name,
        description,
        query,
        range_id: input.range_id.trim().to_string(),
        updated_at: updated_at.to_string(),
    })
}

/// Build a stored dashboard from a create/update body, validating the board and every
/// panel on it.
///
/// A panel's width is **clamped** rather than rejected, because a width is a layout
/// hint whose only failure mode is an ugly row — refusing to save an entire board
/// over one is the wrong trade. Its title and query are validated like the board's own,
/// because those are the parts an operator reads and the surface runs.
pub(crate) fn dashboard_from_input(
    id: String,
    input: GgDashboardInput,
    updated_at: &str,
) -> Result<GgDashboard, ApiError> {
    let name = validated_name(&input.name, "a dashboard")?;
    let description = validated_description(&input.description, "a dashboard")?;
    if input.panels.len() > MAX_DASHBOARD_PANELS {
        return Err(ApiError::bad_request(format!(
            "a dashboard carries at most {MAX_DASHBOARD_PANELS} panels; this one carries {}",
            input.panels.len()
        )));
    }
    let panels = input
        .panels
        .into_iter()
        .map(|panel| {
            Ok(GgDashboardPanel {
                title: validated_name(&panel.title, "a dashboard panel")?,
                query: validated_query(&panel.query, "a dashboard panel")?,
                width: panel.width.clamp(1, DASHBOARD_COLUMNS),
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    Ok(GgDashboard {
        id,
        name,
        description,
        panels,
        range_id: input.range_id.trim().to_string(),
        updated_at: updated_at.to_string(),
    })
}

/// Trim and bound a display name, naming the object in the rejection so the message
/// is useful on either surface.
fn validated_name(raw: &str, what: &str) -> Result<String, ApiError> {
    let name = raw.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::bad_request(format!("{what} needs a name")));
    }
    if name.chars().count() > MAX_NAME_LEN {
        return Err(ApiError::bad_request(format!(
            "{what} name may be at most {MAX_NAME_LEN} characters"
        )));
    }
    Ok(name)
}

/// Trim and bound a one-line description. An empty one is legal — it is a note, not a
/// requirement.
fn validated_description(raw: &str, what: &str) -> Result<String, ApiError> {
    let description = raw.trim().to_string();
    if description.chars().count() > MAX_DESCRIPTION_LEN {
        return Err(ApiError::bad_request(format!(
            "{what} description may be at most {MAX_DESCRIPTION_LEN} characters"
        )));
    }
    Ok(description)
}

/// Trim and bound query source text.
///
/// An **empty** query is legal and means "every recorded session" — the same thing an
/// empty Discover editor means, and the language's least obvious rule. Rejecting it
/// here would make the one query that is guaranteed to return something unsavable.
fn validated_query(raw: &str, what: &str) -> Result<String, ApiError> {
    let query = raw.trim().to_string();
    if query.chars().count() > MAX_QUERY_LEN {
        return Err(ApiError::bad_request(format!(
            "{what} may be at most {MAX_QUERY_LEN} characters of query text"
        )));
    }
    Ok(query)
}
