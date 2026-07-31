//! Game-jam-specific read endpoints.
//!
//! Today this is the *previous entries* lookup a repeated jam run is seeded from:
//! the gameplay READMEs of earlier runs of the same jam by the same model, whichever
//! harness drove them. The driver calls it before seeding so the new run can be
//! briefed on what was already built and asked for something distinct.

use axum::Json;
use axum::extract::{Path, Query, State};
use serde::Deserialize;

use test_cabinet_core::run_record::PriorGameJamEntry;

use super::AppState;
use crate::error::ApiError;

/// Query for [`prior_readmes`]: the model to match earlier entries on. The match is
/// deliberately **not** harness-scoped — a model repeats its own ideas whichever
/// harness drives it.
#[derive(Debug, Deserialize)]
pub struct PriorReadmesParams {
    /// The opaque model id to match.
    pub model: String,
}

/// `GET /game-jams/{slug}/prior-readmes?model=`
///
/// The gameplay READMEs of earlier game-jam runs of jam `slug` built by `model`,
/// oldest first, across every harness — the material the driver seeds so a repeated
/// jam run builds something distinct. Spans all prior runs regardless of publish
/// state; only runs that captured a README appear.
pub async fn prior_readmes(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    Query(params): Query<PriorReadmesParams>,
) -> Result<Json<Vec<PriorGameJamEntry>>, ApiError> {
    let entries = state
        .db
        .game_jam_prior_readmes(&slug, &params.model)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(entries))
}
