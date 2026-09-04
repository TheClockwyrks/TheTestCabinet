//! The saved **harness comparison** (A/B) endpoints (`/comparisons`).
//!
//! A comparison holds every run variable constant and varies one — the harness, a
//! [gg configuration](test_cabinet_core::gg::GgCapabilitySet), or the model — into
//! `N`-run arms, then presents the cost/token/score distributions side by side. Only
//! the [configuration](test_cabinet_core::comparison::ComparisonConfig) is stored;
//! the per-arm statistics and diagnostics are **computed on read** from the arms'
//! runs (see [`test_cabinet_core::comparison_aggregate`]), so a comparison always
//! reflects whatever runs have since landed.
//!
//! Everything is per-account (attributed to the token's account via [`AuthUser`])
//! and private to that operator, exactly like the reviewer's
//! [coverage](super::coverage) and [gg configuration](super::gg_config) tooling.
//! Comparisons are created and run only here; they are published read-only to the
//! public site (Layer 4).

#[cfg(test)]
#[path = "comparisons.test.rs"]
mod tests;

use std::collections::{BTreeMap, BTreeSet};

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use test_cabinet_core::comparison::{Comparison, ComparisonConfig};
use test_cabinet_core::comparison_aggregate::aggregate_comparison;
use test_cabinet_core::run_record::RunRecord;

use crate::auth::AuthUser;
use crate::db::{NewPublishJob, StoredComparison};
use crate::error::ApiError;

use super::AppState;

/// The longest a comparison's display name may be.
const MAX_NAME_LEN: usize = 80;

/// The longest a comparison's description may be — a one-line note, not a document.
const MAX_DESCRIPTION_LEN: usize = 280;

/// The create/update body for a comparison (the server assigns the id and
/// timestamps, and owns the published state).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ComparisonInput {
    /// The operator-chosen display name.
    pub name: String,
    /// A one-line note on what is being compared and why.
    #[serde(default)]
    pub description: String,
    /// The controls, varied dimension, and arms to save.
    pub config: ComparisonConfig,
}

/// `GET /comparisons` — every comparison the token account owns, most recently
/// updated first, each with its per-arm results computed from its runs.
pub async fn list_comparisons(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Vec<Comparison>>, ApiError> {
    let stored = state
        .db
        .list_comparisons(&user.0.id)
        .await
        .map_err(ApiError::from)?;
    let mut out = Vec::with_capacity(stored.len());
    for row in stored {
        out.push(
            assemble_comparison(state.db.as_ref(), &state.store, row)
                .await
                .map_err(ApiError::from)?,
        );
    }
    Ok(Json(out))
}

/// `POST /comparisons` — register a comparison. Returns it with its (initially
/// mostly empty) per-arm results.
pub async fn create_comparison(
    State(state): State<AppState>,
    user: AuthUser,
    Json(input): Json<ComparisonInput>,
) -> Result<Json<Comparison>, ApiError> {
    let now = now()?;
    let stored = stored_from_input(new_id(), &user.0.id, input, &now, &now)?;
    state
        .db
        .insert_comparison(&user.0.id, &stored)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(
        assemble_comparison(state.db.as_ref(), &state.store, stored)
            .await
            .map_err(ApiError::from)?,
    ))
}

/// `GET /comparisons/{id}` — one comparison with its per-arm results computed from
/// its runs. 404 when the id is not the caller's.
pub async fn get_comparison(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<Comparison>, ApiError> {
    let Some(stored) = state
        .db
        .get_comparison(&user.0.id, &id)
        .await
        .map_err(ApiError::from)?
    else {
        return Err(ApiError::not_found("comparison not found"));
    };
    Ok(Json(
        assemble_comparison(state.db.as_ref(), &state.store, stored)
            .await
            .map_err(ApiError::from)?,
    ))
}

/// `PUT /comparisons/{id}` — update a comparison's name, description, and config in
/// place. 404 when the id is not the caller's.
pub async fn update_comparison(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(input): Json<ComparisonInput>,
) -> Result<Json<Comparison>, ApiError> {
    // The existing row supplies the created_at / published state the update
    // preserves; a missing row is a 404 before any write.
    let Some(existing) = state
        .db
        .get_comparison(&user.0.id, &id)
        .await
        .map_err(ApiError::from)?
    else {
        return Err(ApiError::not_found("comparison not found"));
    };
    let stored = stored_from_input(id, &user.0.id, input, &existing.created_at, &now()?)?;
    let updated = state
        .db
        .update_comparison(&user.0.id, &stored)
        .await
        .map_err(ApiError::from)?;
    if !updated {
        return Err(ApiError::not_found("comparison not found"));
    }
    Ok(Json(
        assemble_comparison(state.db.as_ref(), &state.store, stored)
            .await
            .map_err(ApiError::from)?,
    ))
}

/// `DELETE /comparisons/{id}` — delete a comparison. Runs launched for its arms are
/// unaffected. 404 when the id is not the caller's.
pub async fn delete_comparison(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let deleted = state
        .db
        .delete_comparison(&user.0.id, &id)
        .await
        .map_err(ApiError::from)?;
    if !deleted {
        return Err(ApiError::not_found("comparison not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}

/// One arm run that could not be published, with why — so a partially-published
/// comparison never reads as if every run is inspectable.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedRun {
    /// The run that was not enqueued for publishing.
    pub run_id: String,
    /// Why it was skipped (e.g. an infrastructure failure, or a review-less run with
    /// no automated verdicts to stand in for the review).
    pub reason: String,
}

/// The outcome of publishing a comparison: which arm runs were enqueued for
/// publishing and which were skipped. The comparison record itself is always
/// published (it is the aggregate); the runs behind it are best-effort.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonPublishOutcome {
    /// The run ids enqueued for publishing (one `tcab-publisher` job each).
    pub enqueued: Vec<String>,
    /// The arm runs that could not be published, with the reason each.
    pub skipped: Vec<SkippedRun>,
}

/// `POST /comparisons/{id}/publish` — publish the comparison to the public site and
/// enqueue a publish job for each of its arm runs that is publishable. Marks the
/// comparison published (so the next snapshot folds it in) and best-effort enqueues
/// the runs behind it; an un-publishable run (an infrastructure failure, or a
/// review-less run with no automated verdicts) is skipped and reported rather than
/// failing the whole publish. 404 when the id is not the caller's.
pub async fn publish_comparison(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ComparisonPublishOutcome>, ApiError> {
    let Some(stored) = state
        .db
        .get_comparison(&user.0.id, &id)
        .await
        .map_err(ApiError::from)?
    else {
        return Err(ApiError::not_found("comparison not found"));
    };

    // Every arm run, deduplicated, in arm/launch order. Each publishable one is
    // enqueued through the ordinary publish queue (one pod/repo/deploy per run —
    // publishing is expensive, so it is a real job, not a flag flip); an
    // un-publishable one is recorded rather than aborting the batch.
    let mut seen = BTreeSet::new();
    let mut enqueued = Vec::new();
    let mut skipped = Vec::new();
    for arm in &stored.config.arms {
        for run_id in &arm.run_ids {
            if !seen.insert(run_id.clone()) {
                continue;
            }
            match state.db.ensure_publishable_comparison_run(run_id).await {
                Ok(()) => {
                    state
                        .db
                        .enqueue_publish_job(NewPublishJob {
                            id: cuid2::create_id(),
                            run_id: run_id.clone(),
                            job_token: cuid2::create_id(),
                            created_at: now()?,
                        })
                        .await
                        .map_err(ApiError::from)?;
                    enqueued.push(run_id.clone());
                }
                Err(err) => skipped.push(SkippedRun {
                    run_id: run_id.clone(),
                    reason: err.to_string(),
                }),
            }
        }
    }

    // Publish the comparison record itself and wake the snapshot debounce so the
    // public snapshot rebuilds with it (each completed run publish wakes it again).
    state
        .db
        .set_comparison_published(&user.0.id, &id, true, Some(&now()?))
        .await
        .map_err(ApiError::from)?;
    state.publisher.queue_refresh();

    Ok(Json(ComparisonPublishOutcome { enqueued, skipped }))
}

/// Assemble the read model: load every arm's runs, resolve the case's effective
/// review items, and aggregate. A comparison whose case can no longer be resolved
/// (removed, or an unreadable manifest) still lists — it comes back with empty arm
/// results rather than a 500, so a stale comparison stays inspectable.
///
/// `pub(crate)` and taking the `Db` + `DefinitionStore` directly (not `AppState`) so
/// the snapshot publisher reuses the exact same computation when it folds a published
/// comparison into the public snapshot — the internal console and the public site
/// therefore show identical numbers. Runs are loaded from the store regardless of
/// their own published state, so the aggregate reflects the whole experiment even
/// when only some of its runs are individually published for drill-down.
pub(crate) async fn assemble_comparison(
    db: &crate::db::Db,
    store: &crate::store::DefinitionStore,
    stored: StoredComparison,
) -> crate::error::Result<Comparison> {
    let runs = load_arm_runs(db, &stored.config).await?;
    let arms = match store.read_manifest(
        &stored.config.controls.case_slug,
        &stored.config.controls.version,
    ) {
        Ok(manifest) => {
            // The engine is a comparison **control**, so one effective checklist serves
            // every arm: a run whose engine disagrees with the control is surfaced as a
            // `Confound` rather than folded in, and the points a scoped validator
            // decides are the same for every run the comparison aggregates.
            let items = crate::snapshot::review_items_for_engine(
                &manifest,
                &stored.config.controls.variant,
                &stored.config.controls.engine_slug,
            );
            aggregate_comparison(&stored.config, &items, &runs)
        }
        Err(_) => Vec::new(),
    };
    Ok(Comparison {
        id: stored.id,
        user_id: stored.user_id,
        name: stored.name,
        description: stored.description,
        published: stored.published,
        published_at: stored.published_at,
        created_at: stored.created_at,
        updated_at: stored.updated_at,
        config: stored.config,
        arms,
    })
}

/// Load the run records named by every arm's `run_ids` into a lookup, skipping any
/// that are no longer stored.
async fn load_arm_runs(
    db: &crate::db::Db,
    config: &ComparisonConfig,
) -> crate::error::Result<BTreeMap<String, RunRecord>> {
    let mut runs = BTreeMap::new();
    for arm in &config.arms {
        for id in &arm.run_ids {
            if runs.contains_key(id) {
                continue;
            }
            if let Some(stored) = db.get_run(id).await? {
                runs.insert(id.clone(), stored.record);
            }
        }
    }
    Ok(runs)
}

/// A fresh opaque id for a comparison.
fn new_id() -> String {
    cuid2::create_id()
}

/// The current time as an RFC 3339 string.
fn now() -> Result<String, ApiError> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| ApiError::internal(format!("formatting timestamp: {e}")))
}

/// Build a stored comparison from a create/update body, validating the name and
/// description. `created_at` is the row's original creation time (preserved on
/// update); `updated_at` is now. A new comparison starts unpublished.
fn stored_from_input(
    id: String,
    user_id: &str,
    input: ComparisonInput,
    created_at: &str,
    updated_at: &str,
) -> Result<StoredComparison, ApiError> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::bad_request("a comparison needs a name"));
    }
    if name.chars().count() > MAX_NAME_LEN {
        return Err(ApiError::bad_request(format!(
            "a comparison name may be at most {MAX_NAME_LEN} characters"
        )));
    }
    let description = input.description.trim().to_string();
    if description.chars().count() > MAX_DESCRIPTION_LEN {
        return Err(ApiError::bad_request(format!(
            "a comparison description may be at most {MAX_DESCRIPTION_LEN} characters"
        )));
    }
    Ok(StoredComparison {
        id,
        user_id: user_id.to_string(),
        name,
        description,
        config: input.config,
        published: false,
        published_at: None,
        created_at: created_at.to_string(),
        updated_at: updated_at.to_string(),
    })
}
