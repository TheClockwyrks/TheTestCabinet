//! The reviewer coverage-plan endpoints: a per-account declarative plan and the
//! coverage matrix computed from it.
//!
//! A reviewer declares, for themselves, the harness+model **combinations** and
//! the version-pinned test **cases** they want covered, plus a single target
//! number of runs per `case × combination` **cell**. `GET /review-plan` reads the
//! plan back and `PUT /review-plan` upserts it; both are attributed to the token's
//! account (see [`AuthUser`]), so the plan is private to the reviewer — two people
//! can split the model space without colliding.
//!
//! `GET /review-plan/coverage` expands the plan into its cells, counts the
//! **completed** runs and **in-flight** jobs for each (both count toward the
//! target, so triggering the missing runs immediately satisfies a cell), and flags
//! a case whose pinned version is no longer the newest ingested one. The counts
//! are global — every run/job for a cell counts regardless of who launched it — so
//! a run someone else already produced is never re-requested.
//!
//! This is console-only reviewer tooling: the public static site never reaches it
//! (it carries no bearer token and never mounts this transport).

use std::collections::HashMap;

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use test_cabinet_core::run_record::HarnessSlug;

use crate::auth::AuthUser;
use crate::error::ApiError;

use super::AppState;

/// The largest target a plan may set for its runs-per-cell count. A guard against
/// a fat-fingered value fanning out into thousands of queued runs; well above any
/// real review target.
const MAX_RUNS_PER_CELL: u32 = 100;

/// A reviewer's saved coverage plan: the combinations and version-pinned cases
/// they want covered, and how many runs they want for each `case × combination`
/// cell. Persisted whole (one row per account) and read back to render the matrix.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ReviewPlan {
    /// The target number of runs desired for each `case × combination` cell.
    pub runs_per_cell: u32,
    /// The version-pinned test cases in the plan.
    pub cases: Vec<ReviewPlanCase>,
    /// The harness+model combinations in the plan.
    pub combinations: Vec<ReviewPlanCombo>,
}

/// One test case in a plan, pinned to an exact version (and variant). Coverage is
/// counted against exactly this version; the matrix flags it when a newer version
/// has since been ingested.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ReviewPlanCase {
    /// The test-case slug (e.g. `caldera`).
    pub slug: String,
    /// The pinned, exact version (e.g. `v1.2.0`).
    pub version: String,
    /// The variant to cover (e.g. `base`).
    pub variant: String,
}

/// One harness+model combination in a plan. The optional provider mirrors the new-
/// run form's per-combination provider for provider-routed harnesses.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ReviewPlanCombo {
    /// The agent harness to drive.
    pub harness: HarnessSlug,
    /// The opaque model id passed to the harness.
    pub model: String,
    /// The provider for a provider-routed harness, or null.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub provider: Option<String>,
}

/// One cell of the coverage matrix: a plan case (at its pinned version) crossed
/// with a plan combination, with the run/job counts that say how close it is to
/// the target.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoverageCell {
    /// The test-case slug.
    pub slug: String,
    /// The pinned version this cell counts against.
    pub version: String,
    /// The variant.
    pub variant: String,
    /// The harness.
    pub harness: HarnessSlug,
    /// The model id.
    pub model: String,
    /// The provider for a provider-routed harness, or null.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub provider: Option<String>,
    /// The target run count (the plan's `runs_per_cell`).
    pub desired: u32,
    /// Completed runs for this cell.
    pub completed: u32,
    /// In-flight jobs (queued / dispatched / running) for this cell.
    pub in_flight: u32,
    /// How many more runs to trigger: `max(0, desired - (completed + in_flight))`.
    pub remaining: u32,
    /// The newest ingested version of this case (may differ from `version` when
    /// the pin is stale). Empty when the case is not ingested.
    pub latest_version: String,
    /// Whether the pinned `version` is not the newest ingested one — a hint to the
    /// reviewer that they may want to bump the pin.
    pub stale: bool,
}

/// The coverage matrix `GET /review-plan/coverage` returns: every cell plus the
/// rollups the Home widget and the matrix header show.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoverageMatrix {
    /// Every `case × combination` cell, in plan order (cases outer, combinations
    /// inner).
    pub cells: Vec<CoverageCell>,
    /// How many cells have met their target (`remaining == 0`).
    pub cells_satisfied: u32,
    /// The total number of cells.
    pub cells_total: u32,
    /// The sum of every cell's `remaining` — the total runs still to trigger.
    pub runs_missing: u32,
}

/// `GET /review-plan` — the token account's saved coverage plan, or an empty plan
/// when they have none yet.
pub async fn get_plan(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<ReviewPlan>, ApiError> {
    let plan = state
        .db
        .get_review_plan(&user.0.id)
        .await
        .map_err(ApiError::from)?
        .unwrap_or_default();
    Ok(Json(plan))
}

/// `PUT /review-plan` — upsert the token account's coverage plan. The
/// runs-per-cell target is clamped to a sane maximum so a mistyped value cannot
/// fan out into thousands of queued runs.
pub async fn put_plan(
    State(state): State<AppState>,
    user: AuthUser,
    Json(mut plan): Json<ReviewPlan>,
) -> Result<StatusCode, ApiError> {
    plan.runs_per_cell = plan.runs_per_cell.clamp(1, MAX_RUNS_PER_CELL);
    let updated_at = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| ApiError::internal(format!("formatting updatedAt: {e}")))?;
    state
        .db
        .put_review_plan(&user.0.id, &plan, &updated_at)
        .await
        .map_err(ApiError::from)?;
    Ok(StatusCode::NO_CONTENT)
}

/// `GET /review-plan/coverage` — the coverage matrix computed from the token
/// account's plan.
pub async fn coverage(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<CoverageMatrix>, ApiError> {
    let plan = state
        .db
        .get_review_plan(&user.0.id)
        .await
        .map_err(ApiError::from)?
        .unwrap_or_default();

    // The newest ingested version per case, resolved once and reused across that
    // case's cells. Honors the deployment's experimental visibility so the "latest"
    // matches what the catalog offers.
    let mut latest_by_slug: HashMap<String, String> = HashMap::new();
    let mut cells = Vec::with_capacity(plan.cases.len() * plan.combinations.len());
    let mut cells_satisfied = 0u32;
    let mut runs_missing = 0u32;

    for case in &plan.cases {
        let latest_version = match latest_by_slug.get(&case.slug) {
            Some(version) => version.clone(),
            None => {
                let version = state
                    .store
                    .list_visible_versions(&case.slug, state.config.allow_experimental)
                    .map_err(ApiError::from)?
                    .pop()
                    .unwrap_or_default();
                latest_by_slug.insert(case.slug.clone(), version.clone());
                version
            }
        };
        let stale = !latest_version.is_empty() && latest_version != case.version;

        for combo in &plan.combinations {
            let harness = combo.harness.as_str();
            let completed = state
                .db
                .count_completed_runs_for_cell(
                    &case.slug,
                    &case.version,
                    &case.variant,
                    harness,
                    &combo.model,
                )
                .await
                .map_err(ApiError::from)? as u32;
            let in_flight = state
                .db
                .count_in_flight_jobs_for_cell(
                    &case.slug,
                    &case.version,
                    &case.variant,
                    harness,
                    &combo.model,
                )
                .await
                .map_err(ApiError::from)? as u32;

            let desired = plan.runs_per_cell;
            let remaining = desired.saturating_sub(completed + in_flight);
            if remaining == 0 {
                cells_satisfied += 1;
            }
            runs_missing += remaining;

            cells.push(CoverageCell {
                slug: case.slug.clone(),
                version: case.version.clone(),
                variant: case.variant.clone(),
                harness: combo.harness,
                model: combo.model.clone(),
                provider: combo.provider.clone(),
                desired,
                completed,
                in_flight,
                remaining,
                latest_version: latest_version.clone(),
                stale,
            });
        }
    }

    let cells_total = cells.len() as u32;
    Ok(Json(CoverageMatrix {
        cells,
        cells_satisfied,
        cells_total,
        runs_missing,
    }))
}
