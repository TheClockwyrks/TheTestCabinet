//! The reviewer coverage endpoints: reusable groups, multiple declarative plans,
//! and the coverage matrix computed from a plan.
//!
//! A reviewer builds **groups** — named, reusable sets of harness+model
//! **combinations** (`kind = "combo"`) or version-pinned test **cases**
//! (`kind = "case"`) — and **plans** that reference those groups as pointers, so
//! editing a group reshapes every plan that references it. A plan is **hybrid**: it
//! references groups *and* may pin individual one-off combinations/cases; the
//! backend resolves the referenced groups, unions them with the one-offs, and
//! de-dupes before crossing cases × combinations into cells. Each plan carries its
//! own target runs-per-cell, so the model space can be split into smaller,
//! separately triggerable plans.
//!
//! Everything is per-account (attributed to the token's account via [`AuthUser`])
//! and private to the reviewer. `GET /coverage-plans/{id}/coverage` expands one
//! plan into its cells, counting **completed** runs and **in-flight** jobs for each
//! (both count toward the target) and flagging a case whose pinned version is no
//! longer the newest ingested one; the counts are global, so a run someone else
//! already produced is never re-requested. `GET /coverage-plans/summary` returns
//! the per-plan roll-ups the account's Coverage tab and the Home widget show.
//!
//! This is console-only reviewer tooling: the public static site never reaches it
//! (it carries no bearer token and never mounts this transport).

use std::collections::{HashMap, HashSet};

use axum::Json;
use axum::extract::{Path, State};
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

/// One test case in a plan or a case group, pinned to an exact version (and
/// variant). Coverage is counted against exactly this version; the matrix flags it
/// when a newer version has since been ingested.
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

/// One harness+model combination in a plan or a combo group. The optional provider
/// mirrors the new-run form's per-combination provider for provider-routed
/// harnesses.
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

/// Which kind of members a coverage group holds: harness+model combinations or
/// version-pinned cases. A group holds one kind; a plan references groups of both.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum CoverageGroupKind {
    /// A group of harness+model combinations.
    Combo,
    /// A group of version-pinned test cases.
    Case,
}

impl CoverageGroupKind {
    /// The stored/wire token for the kind.
    pub fn as_str(self) -> &'static str {
        match self {
            CoverageGroupKind::Combo => "combo",
            CoverageGroupKind::Case => "case",
        }
    }

    /// Parse a stored kind token, erroring on an unknown value (a corrupt row).
    pub fn parse(s: &str) -> Result<Self, ApiError> {
        match s {
            "combo" => Ok(CoverageGroupKind::Combo),
            "case" => Ok(CoverageGroupKind::Case),
            other => Err(ApiError::internal(format!(
                "unknown coverage group kind: {other}"
            ))),
        }
    }
}

/// A reviewer's saved, reusable group of combinations or cases. Referenced by plans
/// as a pointer; editing the group reshapes every plan that references it. Exactly
/// one of `combos`/`cases` is populated, per `kind`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoverageGroup {
    /// The group's opaque id (minted on create).
    pub id: String,
    /// The reviewer-chosen display name.
    pub name: String,
    /// The member kind.
    pub kind: CoverageGroupKind,
    /// The harness+model combinations, when `kind` is `combo` (else empty).
    pub combos: Vec<ReviewPlanCombo>,
    /// The version-pinned cases, when `kind` is `case` (else empty).
    pub cases: Vec<ReviewPlanCase>,
    /// RFC 3339 of when the group was last saved.
    pub updated_at: String,
}

/// The create/update body for a coverage group (the server assigns `id` and
/// `updatedAt`). Only the members matching `kind` are kept.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoverageGroupInput {
    /// The reviewer-chosen display name.
    pub name: String,
    /// The member kind.
    pub kind: CoverageGroupKind,
    /// The harness+model combinations (kept only when `kind` is `combo`).
    #[serde(default)]
    pub combos: Vec<ReviewPlanCombo>,
    /// The version-pinned cases (kept only when `kind` is `case`).
    #[serde(default)]
    pub cases: Vec<ReviewPlanCase>,
}

/// A reviewer's named coverage plan: the groups it references, any one-off members,
/// and the target runs-per-cell. Persisted whole; one account may hold many.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoveragePlan {
    /// The plan's opaque id (minted on create).
    pub id: String,
    /// The reviewer-chosen display name.
    pub name: String,
    /// The target number of runs desired for each `case × combination` cell.
    pub runs_per_cell: u32,
    /// The referenced combination groups' ids.
    pub combo_group_ids: Vec<String>,
    /// The referenced case groups' ids.
    pub case_group_ids: Vec<String>,
    /// One-off combinations pinned directly on the plan (unioned with the groups).
    pub combos: Vec<ReviewPlanCombo>,
    /// One-off cases pinned directly on the plan (unioned with the groups).
    pub cases: Vec<ReviewPlanCase>,
    /// RFC 3339 of when the plan was last saved.
    pub updated_at: String,
}

/// The create/update body for a coverage plan (the server assigns `id` and
/// `updatedAt`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoveragePlanInput {
    /// The reviewer-chosen display name.
    pub name: String,
    /// The target number of runs desired for each `case × combination` cell.
    pub runs_per_cell: u32,
    /// The referenced combination groups' ids.
    #[serde(default)]
    pub combo_group_ids: Vec<String>,
    /// The referenced case groups' ids.
    #[serde(default)]
    pub case_group_ids: Vec<String>,
    /// One-off combinations pinned directly on the plan.
    #[serde(default)]
    pub combos: Vec<ReviewPlanCombo>,
    /// One-off cases pinned directly on the plan.
    #[serde(default)]
    pub cases: Vec<ReviewPlanCase>,
}

/// One cell of the coverage matrix: a plan case (at its pinned version) crossed
/// with a resolved combination, with the run/job counts that say how close it is to
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

/// The coverage matrix `GET /coverage-plans/{id}/coverage` returns: every cell plus
/// the rollups the plan dashboard header shows.
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

/// One plan's coverage roll-up for the plans list and the Home widget: the cell
/// counts without the per-cell detail the dashboard fetches on open.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CoveragePlanSummary {
    /// The plan's id.
    pub id: String,
    /// The plan's display name.
    pub name: String,
    /// The plan's target runs-per-cell.
    pub runs_per_cell: u32,
    /// How many cells have met their target.
    pub cells_satisfied: u32,
    /// The total number of cells.
    pub cells_total: u32,
    /// The total runs still to trigger across the plan.
    pub runs_missing: u32,
}

// ---- Groups ---------------------------------------------------------------

/// `GET /coverage-groups` — every group the token account owns, both kinds.
pub async fn list_groups(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Vec<CoverageGroup>>, ApiError> {
    let groups = state
        .db
        .list_coverage_groups(&user.0.id)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(groups))
}

/// `POST /coverage-groups` — create a group. Only the members matching `kind` are
/// kept, so a `combo` group never carries stray cases and vice versa.
pub async fn create_group(
    State(state): State<AppState>,
    user: AuthUser,
    Json(input): Json<CoverageGroupInput>,
) -> Result<Json<CoverageGroup>, ApiError> {
    let group = group_from_input(new_id(), input, &now()?);
    state
        .db
        .insert_coverage_group(&user.0.id, &group)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(group))
}

/// `PUT /coverage-groups/{id}` — update a group in place. 404 when the id is not the
/// caller's.
pub async fn update_group(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(input): Json<CoverageGroupInput>,
) -> Result<Json<CoverageGroup>, ApiError> {
    let group = group_from_input(id, input, &now()?);
    let updated = state
        .db
        .update_coverage_group(&user.0.id, &group)
        .await
        .map_err(ApiError::from)?;
    if !updated {
        return Err(ApiError::not_found("coverage group not found"));
    }
    Ok(Json(group))
}

/// `DELETE /coverage-groups/{id}` — delete a group. Plans that still reference it
/// simply ignore the dangling id at coverage time, so no cascade is needed. 404
/// when the id is not the caller's.
pub async fn delete_group(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let deleted = state
        .db
        .delete_coverage_group(&user.0.id, &id)
        .await
        .map_err(ApiError::from)?;
    if !deleted {
        return Err(ApiError::not_found("coverage group not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---- Plans ----------------------------------------------------------------

/// `GET /coverage-plans` — every plan the token account owns.
pub async fn list_plans(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Vec<CoveragePlan>>, ApiError> {
    let plans = state
        .db
        .list_coverage_plans(&user.0.id)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(plans))
}

/// `POST /coverage-plans` — create a plan. The runs-per-cell target is clamped to a
/// sane maximum so a mistyped value cannot fan out into thousands of queued runs.
pub async fn create_plan(
    State(state): State<AppState>,
    user: AuthUser,
    Json(input): Json<CoveragePlanInput>,
) -> Result<Json<CoveragePlan>, ApiError> {
    let plan = plan_from_input(new_id(), input, &now()?);
    state
        .db
        .insert_coverage_plan(&user.0.id, &plan)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(plan))
}

/// `PUT /coverage-plans/{id}` — update a plan in place. 404 when the id is not the
/// caller's.
pub async fn update_plan(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    Json(input): Json<CoveragePlanInput>,
) -> Result<Json<CoveragePlan>, ApiError> {
    let plan = plan_from_input(id, input, &now()?);
    let updated = state
        .db
        .update_coverage_plan(&user.0.id, &plan)
        .await
        .map_err(ApiError::from)?;
    if !updated {
        return Err(ApiError::not_found("coverage plan not found"));
    }
    Ok(Json(plan))
}

/// `DELETE /coverage-plans/{id}` — delete a plan. 404 when the id is not the
/// caller's.
pub async fn delete_plan(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let deleted = state
        .db
        .delete_coverage_plan(&user.0.id, &id)
        .await
        .map_err(ApiError::from)?;
    if !deleted {
        return Err(ApiError::not_found("coverage plan not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}

/// `GET /coverage-plans/summary` — the per-plan roll-ups for the plans list and the
/// Home widget. Resolves every plan's members, gathers the union of their case slugs
/// so the two grouped count queries run once for the whole account, then tallies
/// each plan against those counts.
pub async fn plans_summary(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Vec<CoveragePlanSummary>>, ApiError> {
    let plans = state
        .db
        .list_coverage_plans(&user.0.id)
        .await
        .map_err(ApiError::from)?;
    let groups = group_index(&state, &user.0.id).await?;

    let resolved: Vec<(&CoveragePlan, Vec<ReviewPlanCombo>, Vec<ReviewPlanCase>)> = plans
        .iter()
        .map(|plan| {
            let (combos, cases) = resolve_members(plan, &groups);
            (plan, combos, cases)
        })
        .collect();

    let all_slugs: Vec<String> = resolved
        .iter()
        .flat_map(|(_, _, cases)| cases.iter().map(|c| c.slug.clone()))
        .collect();
    let ctx = MatrixCtx::load(&state, all_slugs).await?;

    let summaries = resolved
        .iter()
        .map(|(plan, combos, cases)| {
            let roll = ctx.tally(plan.runs_per_cell, combos, cases);
            CoveragePlanSummary {
                id: plan.id.clone(),
                name: plan.name.clone(),
                runs_per_cell: plan.runs_per_cell,
                cells_satisfied: roll.cells_satisfied,
                cells_total: roll.cells_total,
                runs_missing: roll.runs_missing,
            }
        })
        .collect();
    Ok(Json(summaries))
}

/// `GET /coverage-plans/{id}/coverage` — the coverage matrix for one plan. 404 when
/// the id is not the caller's.
pub async fn plan_coverage(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<CoverageMatrix>, ApiError> {
    let plan = state
        .db
        .get_coverage_plan(&user.0.id, &id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("coverage plan not found"))?;
    let groups = group_index(&state, &user.0.id).await?;
    let (combos, cases) = resolve_members(&plan, &groups);

    let slugs: Vec<String> = cases.iter().map(|c| c.slug.clone()).collect();
    let ctx = MatrixCtx::load(&state, slugs).await?;
    Ok(Json(ctx.matrix(plan.runs_per_cell, &combos, &cases)))
}

// ---- Resolution + matrix helpers ------------------------------------------

/// Build the id → group map the resolver reads, from the account's groups.
async fn group_index(
    state: &AppState,
    user_id: &str,
) -> Result<HashMap<String, CoverageGroup>, ApiError> {
    let groups = state
        .db
        .list_coverage_groups(user_id)
        .await
        .map_err(ApiError::from)?;
    Ok(groups.into_iter().map(|g| (g.id.clone(), g)).collect())
}

/// Resolve a plan's referenced groups and one-off members into the de-duped
/// combinations and cases the matrix crosses. Group members come first (in
/// reference order), then the plan's one-offs; a combo is identified by
/// `(harness, model, provider)` and a case by `(slug, version, variant)`, so the
/// same member declared in two groups (or a group and a one-off) appears once.
/// A referenced id that no longer names a group is silently skipped.
fn resolve_members(
    plan: &CoveragePlan,
    groups: &HashMap<String, CoverageGroup>,
) -> (Vec<ReviewPlanCombo>, Vec<ReviewPlanCase>) {
    let mut combos = Vec::new();
    let mut combo_seen: HashSet<(String, String, String)> = HashSet::new();
    let mut push_combo = |c: &ReviewPlanCombo, combos: &mut Vec<ReviewPlanCombo>| {
        let key = (
            c.harness.as_str().to_string(),
            c.model.clone(),
            c.provider.clone().unwrap_or_default(),
        );
        if combo_seen.insert(key) {
            combos.push(c.clone());
        }
    };
    for id in &plan.combo_group_ids {
        if let Some(group) = groups.get(id) {
            for c in &group.combos {
                push_combo(c, &mut combos);
            }
        }
    }
    for c in &plan.combos {
        push_combo(c, &mut combos);
    }

    let mut cases = Vec::new();
    let mut case_seen: HashSet<(String, String, String)> = HashSet::new();
    let mut push_case = |c: &ReviewPlanCase, cases: &mut Vec<ReviewPlanCase>| {
        let key = (c.slug.clone(), c.version.clone(), c.variant.clone());
        if case_seen.insert(key) {
            cases.push(c.clone());
        }
    };
    for id in &plan.case_group_ids {
        if let Some(group) = groups.get(id) {
            for c in &group.cases {
                push_case(c, &mut cases);
            }
        }
    }
    for c in &plan.cases {
        push_case(c, &mut cases);
    }

    (combos, cases)
}

/// A roll-up of a plan's cells without the per-cell detail.
struct MatrixRollup {
    cells_satisfied: u32,
    cells_total: u32,
    runs_missing: u32,
}

/// The run/job counts and latest-version resolution a coverage computation needs,
/// loaded once so a plan (or every plan, for the summary) can be tallied without
/// further DB round-trips. The two grouped counts and the per-slug latest version
/// are the only reads; the cross-product itself is pure.
struct MatrixCtx {
    completed: crate::db::CellCounts,
    in_flight: crate::db::CellCounts,
    latest_by_slug: HashMap<String, String>,
}

impl MatrixCtx {
    /// Load the counts and latest-version map for a set of case slugs (deduped
    /// internally). The two grouped queries scope to these slugs; the latest version
    /// per slug honors the deployment's experimental visibility so "latest" matches
    /// what the catalog offers.
    async fn load(state: &AppState, mut slugs: Vec<String>) -> Result<Self, ApiError> {
        slugs.sort();
        slugs.dedup();
        let completed = state
            .db
            .count_completed_runs_by_cell(&slugs)
            .await
            .map_err(ApiError::from)?;
        let in_flight = state
            .db
            .count_in_flight_jobs_by_cell(&slugs)
            .await
            .map_err(ApiError::from)?;
        let mut latest_by_slug = HashMap::new();
        for slug in slugs {
            let version = state
                .store
                .list_visible_versions(&slug, state.config.allow_experimental)
                .map_err(ApiError::from)?
                .pop()
                .unwrap_or_default();
            latest_by_slug.insert(slug, version);
        }
        Ok(Self {
            completed,
            in_flight,
            latest_by_slug,
        })
    }

    /// The full coverage matrix for one plan's resolved members.
    fn matrix(
        &self,
        runs_per_cell: u32,
        combos: &[ReviewPlanCombo],
        cases: &[ReviewPlanCase],
    ) -> CoverageMatrix {
        let mut cells = Vec::with_capacity(cases.len() * combos.len());
        let mut cells_satisfied = 0u32;
        let mut runs_missing = 0u32;
        for case in cases {
            let latest_version = self
                .latest_by_slug
                .get(&case.slug)
                .cloned()
                .unwrap_or_default();
            let stale = !latest_version.is_empty() && latest_version != case.version;
            for combo in combos {
                let (completed, in_flight) = self.counts_for(case, combo);
                let remaining = runs_per_cell.saturating_sub(completed + in_flight);
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
                    desired: runs_per_cell,
                    completed,
                    in_flight,
                    remaining,
                    latest_version: latest_version.clone(),
                    stale,
                });
            }
        }
        CoverageMatrix {
            cells_total: cells.len() as u32,
            cells,
            cells_satisfied,
            runs_missing,
        }
    }

    /// The roll-up (satisfied/total/missing) for one plan's resolved members, without
    /// materializing the per-cell detail.
    fn tally(
        &self,
        runs_per_cell: u32,
        combos: &[ReviewPlanCombo],
        cases: &[ReviewPlanCase],
    ) -> MatrixRollup {
        let mut cells_satisfied = 0u32;
        let mut runs_missing = 0u32;
        for case in cases {
            for combo in combos {
                let (completed, in_flight) = self.counts_for(case, combo);
                let remaining = runs_per_cell.saturating_sub(completed + in_flight);
                if remaining == 0 {
                    cells_satisfied += 1;
                }
                runs_missing += remaining;
            }
        }
        MatrixRollup {
            cells_satisfied,
            cells_total: (cases.len() * combos.len()) as u32,
            runs_missing,
        }
    }

    /// The completed-run and in-flight-job counts for one cell. Runs and jobs store
    /// the model id they were *launched* with, which for a provider-routed harness
    /// carries the `openrouter/` prefix the plan's canonical `combo.model` omits;
    /// match against that same launched id so provider-routed cells count their runs
    /// instead of always reading zero.
    fn counts_for(&self, case: &ReviewPlanCase, combo: &ReviewPlanCombo) -> (u32, u32) {
        let launch_model = test_cabinet_core::model_id::launch_model_id(
            &combo.model,
            combo.harness,
            combo.provider.as_deref(),
        );
        let key = (
            case.slug.clone(),
            case.version.clone(),
            case.variant.clone(),
            combo.harness.as_str().to_string(),
            launch_model,
        );
        let completed = self.completed.get(&key).copied().unwrap_or(0);
        let in_flight = self.in_flight.get(&key).copied().unwrap_or(0);
        (completed, in_flight)
    }
}

// ---- Small constructors ---------------------------------------------------

/// Mint a fresh opaque id for a new group or plan.
fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// The current time as an RFC 3339 `updatedAt` string.
fn now() -> Result<String, ApiError> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| ApiError::internal(format!("formatting updatedAt: {e}")))
}

/// Build a stored group from a create/update body, keeping only the members that
/// match the declared kind.
fn group_from_input(id: String, input: CoverageGroupInput, updated_at: &str) -> CoverageGroup {
    let (combos, cases) = match input.kind {
        CoverageGroupKind::Combo => (input.combos, Vec::new()),
        CoverageGroupKind::Case => (Vec::new(), input.cases),
    };
    CoverageGroup {
        id,
        name: input.name,
        kind: input.kind,
        combos,
        cases,
        updated_at: updated_at.to_string(),
    }
}

/// Build a stored plan from a create/update body, clamping the runs-per-cell target.
fn plan_from_input(id: String, input: CoveragePlanInput, updated_at: &str) -> CoveragePlan {
    CoveragePlan {
        id,
        name: input.name,
        runs_per_cell: input.runs_per_cell.clamp(1, MAX_RUNS_PER_CELL),
        combo_group_ids: input.combo_group_ids,
        case_group_ids: input.case_group_ids,
        combos: input.combos,
        cases: input.cases,
        updated_at: updated_at.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn combo(model: &str) -> ReviewPlanCombo {
        ReviewPlanCombo {
            harness: HarnessSlug::Claude,
            model: model.to_string(),
            provider: None,
        }
    }

    fn case(slug: &str) -> ReviewPlanCase {
        ReviewPlanCase {
            slug: slug.to_string(),
            version: "v1.0.0".to_string(),
            variant: "base".to_string(),
        }
    }

    fn combo_group(id: &str, combos: Vec<ReviewPlanCombo>) -> CoverageGroup {
        CoverageGroup {
            id: id.to_string(),
            name: id.to_string(),
            kind: CoverageGroupKind::Combo,
            combos,
            cases: vec![],
            updated_at: "2026-07-15T00:00:00Z".to_string(),
        }
    }

    fn case_group(id: &str, cases: Vec<ReviewPlanCase>) -> CoverageGroup {
        CoverageGroup {
            id: id.to_string(),
            name: id.to_string(),
            kind: CoverageGroupKind::Case,
            combos: vec![],
            cases,
            updated_at: "2026-07-15T00:00:00Z".to_string(),
        }
    }

    fn plan(
        combo_group_ids: Vec<&str>,
        case_group_ids: Vec<&str>,
        combos: Vec<ReviewPlanCombo>,
        cases: Vec<ReviewPlanCase>,
    ) -> CoveragePlan {
        CoveragePlan {
            id: "p1".to_string(),
            name: "plan".to_string(),
            runs_per_cell: 3,
            combo_group_ids: combo_group_ids.into_iter().map(String::from).collect(),
            case_group_ids: case_group_ids.into_iter().map(String::from).collect(),
            combos,
            cases,
            updated_at: "2026-07-15T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn resolve_dedupes_a_member_shared_by_two_groups() {
        let groups: HashMap<String, CoverageGroup> = [
            combo_group("g1", vec![combo("opus"), combo("sonnet")]),
            combo_group("g2", vec![combo("sonnet"), combo("haiku")]),
            case_group("c1", vec![case("pong")]),
            case_group("c2", vec![case("pong"), case("carom")]),
        ]
        .into_iter()
        .map(|g| (g.id.clone(), g))
        .collect();
        let p = plan(vec!["g1", "g2"], vec!["c1", "c2"], vec![], vec![]);

        let (combos, cases) = resolve_members(&p, &groups);
        // `sonnet` is in both combo groups; `pong` in both case groups — each once.
        assert_eq!(
            combos.iter().map(|c| c.model.as_str()).collect::<Vec<_>>(),
            vec!["opus", "sonnet", "haiku"]
        );
        assert_eq!(
            cases.iter().map(|c| c.slug.as_str()).collect::<Vec<_>>(),
            vec!["pong", "carom"]
        );
    }

    #[test]
    fn resolve_dedupes_a_one_off_that_repeats_a_group_member() {
        let groups: HashMap<String, CoverageGroup> = [combo_group("g1", vec![combo("opus")])]
            .into_iter()
            .map(|g| (g.id.clone(), g))
            .collect();
        // The one-off `opus` duplicates the group's member and must not double it.
        let p = plan(
            vec!["g1"],
            vec![],
            vec![combo("opus"), combo("sonnet")],
            vec![],
        );

        let (combos, _) = resolve_members(&p, &groups);
        assert_eq!(
            combos.iter().map(|c| c.model.as_str()).collect::<Vec<_>>(),
            vec!["opus", "sonnet"]
        );
    }

    #[test]
    fn resolve_skips_a_dangling_group_reference() {
        let groups: HashMap<String, CoverageGroup> = [combo_group("g1", vec![combo("opus")])]
            .into_iter()
            .map(|g| (g.id.clone(), g))
            .collect();
        // `gX` no longer names a group (deleted); it is silently skipped, not an error.
        let p = plan(vec!["g1", "gX"], vec!["cX"], vec![], vec![case("pong")]);

        let (combos, cases) = resolve_members(&p, &groups);
        assert_eq!(combos.len(), 1);
        assert_eq!(combos[0].model, "opus");
        // The dangling case group contributes nothing; only the one-off case remains.
        assert_eq!(cases.len(), 1);
        assert_eq!(cases[0].slug, "pong");
    }

    #[test]
    fn provider_distinguishes_two_otherwise_identical_combos() {
        let with_provider = ReviewPlanCombo {
            harness: HarnessSlug::Opencode,
            model: "anthropic/claude-opus-4.8".to_string(),
            provider: Some("openrouter".to_string()),
        };
        let no_provider = ReviewPlanCombo {
            harness: HarnessSlug::Opencode,
            model: "anthropic/claude-opus-4.8".to_string(),
            provider: None,
        };
        let p = plan(vec![], vec![], vec![with_provider, no_provider], vec![]);
        let (combos, _) = resolve_members(&p, &HashMap::new());
        // Same harness+model but different provider → two distinct combinations.
        assert_eq!(combos.len(), 2);
    }
}
