//! The saved **harness comparison** (A/B) endpoints (`/comparisons`).
//!
//! A comparison holds every run variable constant and varies one — the harness, a
//! [gg configuration](test_cabinet_contracts::gg::GgCapabilitySet), or the model — into
//! `N`-run arms, then presents the cost/token/score distributions side by side. Only
//! the [configuration](crate::comparison::ComparisonConfig) is stored;
//! the per-arm statistics and diagnostics are **computed on read** from the arms'
//! runs (see [`crate::comparison_aggregate`]), so a comparison always
//! reflects whatever runs have since landed. An arm holds the runs of its
//! [coverage cell](super::coverage), whoever launched them, exactly as a coverage plan's
//! cell and a ladder's rung slot do.
//!
//! Everything is per-account (attributed to the caller's email via [`Person`])
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
use serde::Serialize;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::comparison::{Comparison, ComparisonArm, ComparisonConfig, is_complete};
use crate::comparison_aggregate::{ArmHolding, aggregate_comparison};
use test_cabinet_contracts::run_record::{HarnessSlug, RunRecord};

use crate::auth::Person;
use crate::db::{CellKey, PublishEnqueue, StoredComparison};
use crate::error::ApiError;

use super::AppState;
use super::ReviewPlanCombo;
use super::coverage::{
    GgLibrary, cell_in_flight, cell_key_of, cell_runs, member_cell_identity, resolve_member,
};

pub use test_cabinet_contracts::backend_api::comparisons::ComparisonInput;

/// The longest a comparison's display name may be.
const MAX_NAME_LEN: usize = 80;

/// The longest a comparison's description may be — a one-line note, not a document.
const MAX_DESCRIPTION_LEN: usize = 280;

/// The fewest runs per arm a comparison may ask for. One run says almost nothing
/// (the spread across runs is large), but it is a legitimate first look.
const MIN_N: u32 = 1;

/// The most runs per arm a comparison may ask for. Every run is a container, a
/// model session, and a bill, and an arm launches `n` of them at a time.
const MAX_N: u32 = 50;

/// The fewest arms a comparison may carry: a comparison of one configuration
/// compares it against nothing.
const MIN_ARMS: usize = 2;

/// `GET /comparisons` — every comparison the token account owns, most recently
/// updated first, each with its per-arm results computed from its runs.
pub async fn list_comparisons(
    State(state): State<AppState>,
    user: Person,
) -> Result<Json<Vec<Comparison>>, ApiError> {
    let stored = state
        .db
        .list_comparisons(&user.0)
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
    user: Person,
    Json(input): Json<ComparisonInput>,
) -> Result<Json<Comparison>, ApiError> {
    let now = now()?;
    ensure_engine_control_supported(&state.store, &input.config)?;
    let stored = stored_from_input(new_id(), &user.0, input, &now, &now)?;
    ensure_distinct_cells(state.db.as_ref(), &user.0, &stored.config).await?;
    state
        .db
        .insert_comparison(&user.0, &stored)
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
    user: Person,
    Path(id): Path<String>,
) -> Result<Json<Comparison>, ApiError> {
    let Some(stored) = state
        .db
        .get_comparison(&user.0, &id)
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
    user: Person,
    Path(id): Path<String>,
    Json(input): Json<ComparisonInput>,
) -> Result<Json<Comparison>, ApiError> {
    // The existing row supplies the created_at / published state the update
    // preserves; a missing row is a 404 before any write.
    let Some(existing) = state
        .db
        .get_comparison(&user.0, &id)
        .await
        .map_err(ApiError::from)?
    else {
        return Err(ApiError::not_found("comparison not found"));
    };
    ensure_engine_control_supported(&state.store, &input.config)?;
    // An arm's runs follow from its cell, so the configuration is stored as sent
    // (docs/comparisons/experiments.md, "Editing a comparison").
    let stored = stored_from_input(id, &user.0, input, &existing.created_at, &now()?)?;
    ensure_distinct_cells(state.db.as_ref(), &user.0, &stored.config).await?;
    let updated = state
        .db
        .update_comparison(&user.0, &stored)
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
    user: Person,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let deleted = state
        .db
        .delete_comparison(&user.0, &id)
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
/// enqueue a publish job for each of its arm runs that is publishable, unpublished
/// and has no release already under way. Marks the
/// comparison published (so the next snapshot folds it in) and best-effort enqueues
/// the runs behind it; an un-publishable run (an infrastructure failure, or a
/// review-less run with no automated verdicts) is skipped and reported rather than
/// failing the whole publish. 404 when the id is not the caller's.
pub async fn publish_comparison(
    State(state): State<AppState>,
    user: Person,
    Path(id): Path<String>,
) -> Result<Json<ComparisonPublishOutcome>, ApiError> {
    let Some(stored) = state
        .db
        .get_comparison(&user.0, &id)
        .await
        .map_err(ApiError::from)?
    else {
        return Err(ApiError::not_found("comparison not found"));
    };

    // Every run the arms hold, deduplicated, in arm order and the order each arm's runs
    // finished. Each publishable one is enqueued through the ordinary publish queue (one
    // pod/repo/deploy per run — publishing is expensive, so it is a real job, not a flag
    // flip); an un-publishable one is recorded rather than aborting the batch.
    let holdings = arm_holdings(state.db.as_ref(), &stored)
        .await
        .map_err(ApiError::from)?;
    let mut seen = BTreeSet::new();
    let mut enqueued = Vec::new();
    let mut skipped = Vec::new();
    for arm in &stored.config.arms {
        let Some(holding) = holdings.get(&arm.id) else {
            continue;
        };
        for run_id in &holding.run_ids {
            if !seen.insert(run_id.clone()) {
                continue;
            }
            // A run that is already public has nothing left to release: most arm
            // runs publish themselves on completion, and a second publish job would
            // deploy a second, orphaned build of the same run.
            if state
                .db
                .is_run_published(run_id)
                .await
                .map_err(ApiError::from)?
            {
                continue;
            }
            match state.db.ensure_publishable_comparison_run(run_id).await {
                Ok(()) => {
                    // The shared enqueue: a run whose release is already under way
                    // (its own automatic publish, say) keeps that job and is not
                    // counted as enqueued here.
                    let outcome = state
                        .db
                        .enqueue_publish_job_once(run_id, &now()?)
                        .await
                        .map_err(ApiError::from)?;
                    if matches!(outcome, PublishEnqueue::Enqueued(_)) {
                        enqueued.push(run_id.clone());
                    }
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
        .set_comparison_published(&user.0, &id, true, Some(&now()?))
        .await
        .map_err(ApiError::from)?;
    state.publisher.queue_refresh().await;

    Ok(Json(ComparisonPublishOutcome { enqueued, skipped }))
}

/// Assemble the read model: read the runs every arm's coverage cell holds, resolve the
/// case's effective review items, and aggregate. A comparison whose case can no longer be
/// resolved (removed, or an unreadable manifest) still lists — it comes back with empty
/// arm results rather than a 500, so a stale comparison stays inspectable.
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
    let holdings = arm_holdings(db, &stored).await?;
    let held: Vec<String> = holdings
        .values()
        .flat_map(|holding| holding.run_ids.iter().cloned())
        .collect::<BTreeSet<String>>()
        .into_iter()
        .collect();
    // A held run whose record this build cannot decode is absent here, and keeps its
    // place in the arm's `run_ids` without contributing a figure. The runs are read
    // without their event streams, which only a run still to be counted needs.
    let mut runs: BTreeMap<String, RunRecord> = db
        .get_runs_without_events(&held)
        .await?
        .into_iter()
        .map(|stored| (stored.record.id.clone(), stored.record))
        .collect();
    // A Codex or gg run stored before its harness was counted is counted now, once
    // (docs/comparisons/diagnostics.md, "Counting an earlier run").
    db.count_uncounted_tool_calls(&mut runs).await?;
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
            aggregate_comparison(
                &stored.config,
                &items,
                manifest.validator_rated(),
                &holdings,
                &runs,
            )
        }
        Err(_) => Vec::new(),
    };
    let complete = is_complete(stored.config.n, &arms);
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
        complete,
    })
}

/// The runs each arm of `stored` holds, by arm id (docs/comparisons/experiments.md,
/// "Which runs an arm holds"): the first `n` counted runs of the arm's coverage cell to
/// finish, whoever launched them, and the cell's jobs in flight up to what the arm still
/// needs. The rule a coverage plan's cell and a ladder's rung slot take their runs by.
///
/// An arm with no cell (a gg arm whose configuration is gone or leaves a launch slot
/// unbound) holds nothing, and carries why it cannot be launched.
async fn arm_holdings(
    db: &crate::db::Db,
    stored: &StoredComparison,
) -> crate::error::Result<BTreeMap<String, ArmHolding>> {
    let targets = arm_targets(db, &stored.user_id, &stored.config).await?;
    let slugs = [stored.config.controls.case_slug.clone()];
    let (counted, in_flight) = if targets.values().any(|t| t.cell.is_some()) {
        (
            db.counted_runs_by_cell(&slugs, None).await?,
            db.count_in_flight_jobs_by_cell(&slugs).await?,
        )
    } else {
        Default::default()
    };
    let n = stored.config.n;
    Ok(targets
        .into_iter()
        .map(|(arm_id, target)| {
            let (run_ids, in_flight) = match &target.cell {
                Some(cell) => {
                    let run_ids: Vec<String> = cell_runs(&counted, cell, n)
                        .iter()
                        .map(|run| run.id.clone())
                        .collect();
                    let in_flight = cell_in_flight(&in_flight, cell, n, run_ids.len() as u32);
                    (run_ids, in_flight)
                }
                None => (Vec::new(), 0),
            };
            (
                arm_id,
                ArmHolding {
                    run_ids,
                    in_flight,
                    unlaunchable: target.unlaunchable,
                },
            )
        })
        .collect())
}

/// What one arm reads its runs from and whether it can be launched.
struct ArmTarget {
    /// The coverage cell the arm's runs are counted in, or `None` when it has none.
    cell: Option<CellKey>,
    /// Why the arm cannot be launched now, by the rule a coverage member follows
    /// ([`resolve_member`]), or `None` when it can.
    unlaunchable: Option<String>,
}

/// Every arm of `config`'s [target](ArmTarget), by arm id. A gg arm is resolved against
/// `user_id`'s gg library as it stands now, which is read only when the comparison has
/// a gg arm.
async fn arm_targets(
    db: &crate::db::Db,
    user_id: &str,
    config: &ComparisonConfig,
) -> crate::error::Result<BTreeMap<String, ArmTarget>> {
    let library = if config.arms.iter().any(|arm| arm.gg_config_id.is_some()) {
        GgLibrary::from_parts(
            db.list_gg_configs(user_id).await?,
            db.list_gg_agents(user_id).await?,
        )
    } else {
        GgLibrary::default()
    };
    let case = config_case(config);
    Ok(config
        .arms
        .iter()
        .map(|arm| {
            let member = arm_member(arm);
            let cell = member_cell_identity(&member, &library)
                .map(|identity| cell_key_of(&case, identity));
            let unlaunchable = resolve_member(&member, &library).unlaunchable;
            (arm.id.clone(), ArmTarget { cell, unlaunchable })
        })
        .collect())
}

/// The case pin a comparison's controls name, as a coverage cell keys it.
fn config_case(config: &ComparisonConfig) -> super::ReviewPlanCase {
    let controls = &config.controls;
    super::ReviewPlanCase {
        slug: controls.case_slug.clone(),
        version: controls.version.clone(),
        variant: controls.variant.clone(),
        engine: Some(controls.engine_slug.clone()),
    }
}

/// An arm as the coverage member it launches: a harness on a model, or a saved gg
/// configuration with its slot models.
fn arm_member(arm: &ComparisonArm) -> ReviewPlanCombo {
    match &arm.gg_config_id {
        Some(config_id) => ReviewPlanCombo {
            harness: HarnessSlug::Gg,
            model: String::new(),
            provider: None,
            gg_config_id: Some(config_id.clone()),
            gg_slot_models: arm.gg_slot_models.clone(),
            gg_config_name: None,
        },
        None => ReviewPlanCombo {
            harness: arm.harness_slug.unwrap_or(HarnessSlug::Gg),
            model: arm.model_id.clone().unwrap_or_default(),
            provider: None,
            gg_config_id: None,
            gg_slot_models: BTreeMap::new(),
            gg_config_name: None,
        },
    }
}

/// Refuse (`400`) a comparison two of whose arms read one coverage cell: they would hold
/// the same runs, so the comparison would compare a configuration against itself.
async fn ensure_distinct_cells(
    db: &crate::db::Db,
    user_id: &str,
    config: &ComparisonConfig,
) -> Result<(), ApiError> {
    let targets = arm_targets(db, user_id, config)
        .await
        .map_err(ApiError::from)?;
    let mut seen: BTreeMap<&CellKey, &str> = BTreeMap::new();
    for arm in &config.arms {
        let Some(cell) = targets.get(&arm.id).and_then(|t| t.cell.as_ref()) else {
            continue;
        };
        if let Some(first) = seen.insert(cell, arm.id.as_str()) {
            return Err(ApiError::bad_request(format!(
                "arms `{first}` and `{}` run the same configuration, so they would hold the \
                 same runs",
                arm.id
            )));
        }
    }
    Ok(())
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

/// Hold the comparison's [engine](test_cabinet_suites::engine) control against the
/// engines its anchored case version declares support for, the same gate a run is
/// held to before any container starts
/// (the driver's `ensure_engine_supported`) and worded the same way.
///
/// The engine is a control, so every arm's runs launch under it and the review
/// checklist `assemble_comparison` resolves is the one that engine carries. A
/// comparison anchored to an engine the case never declared would therefore score
/// every arm against points written for a different runtime, and would do it after
/// the runs were paid for.
///
/// The slug half of the gate only: the engine *version* a run stages is a property of
/// the host that runs it, not of the comparison, so a comparison pins none and has
/// nothing to hold against the declared range.
///
/// A case version the store cannot resolve (de-ingested since the comparison was
/// saved) is not checked, matching [`assemble_comparison`]: a stale comparison stays
/// editable and deletable rather than becoming a row nobody can save.
fn ensure_engine_control_supported(
    store: &crate::store::DefinitionStore,
    config: &ComparisonConfig,
) -> Result<(), ApiError> {
    let controls = &config.controls;
    let Ok(manifest) = store.read_manifest(&controls.case_slug, &controls.version) else {
        return Ok(());
    };
    if manifest
        .engines
        .iter()
        .any(|engine| engine.slug == controls.engine_slug)
    {
        return Ok(());
    }
    let supported: Vec<&str> = manifest
        .engines
        .iter()
        .map(|engine| engine.slug.as_str())
        .collect();
    Err(ApiError::bad_request(format!(
        "engine `{}` is not supported by test case `{}` {} (supported engines: {})",
        controls.engine_slug,
        controls.case_slug,
        controls.version,
        supported.join(", "),
    )))
}

/// Hold a comparison's stored config to the shape every reader of it assumes: a
/// sample size the queue can carry, at least two configurations to compare, arm ids
/// that identify an arm, and an arm that names something launchable.
///
/// Every one of these is otherwise discovered far downstream — an arm naming no
/// harness launches nothing, two arms sharing an id share one set of runs — so they
/// are refused at the save.
fn validate_config(config: &ComparisonConfig) -> Result<(), ApiError> {
    if config.n < MIN_N {
        return Err(ApiError::bad_request(format!(
            "a comparison runs at least {MIN_N} run per arm (got {})",
            config.n
        )));
    }
    if config.n > MAX_N {
        return Err(ApiError::bad_request(format!(
            "a comparison runs at most {MAX_N} runs per arm (got {})",
            config.n
        )));
    }
    if config.arms.len() < MIN_ARMS {
        return Err(ApiError::bad_request(format!(
            "a comparison needs at least {MIN_ARMS} arms (got {})",
            config.arms.len()
        )));
    }
    let mut seen = BTreeSet::new();
    for arm in &config.arms {
        if !seen.insert(arm.id.as_str()) {
            return Err(ApiError::bad_request(format!(
                "arm id `{}` is listed twice",
                arm.id
            )));
        }
        // A gg arm is one that names a gg configuration; a harness arm is anything
        // else, and it launches through the batch path on its own harness and model.
        // An arm running gg without a configuration is neither: gg has no launch to
        // make without a capability set.
        if arm.gg_config_id.is_some() {
            continue;
        }
        if arm.harness_slug == Some(HarnessSlug::Gg) {
            return Err(ApiError::bad_request(format!(
                "gg arm `{}` names no configuration",
                arm.id
            )));
        }
        if arm.harness_slug.is_none() {
            return Err(ApiError::bad_request(format!(
                "arm `{}` names neither a harness nor a gg configuration",
                arm.id
            )));
        }
        if arm
            .model_id
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
        {
            return Err(ApiError::bad_request(format!(
                "harness arm `{}` names no model",
                arm.id
            )));
        }
    }
    Ok(())
}

/// Build a stored comparison from a create/update body, validating the name, the
/// description, and the [config](validate_config). `created_at` is the row's original
/// creation time (preserved on update); `updated_at` is now. A new comparison starts
/// unpublished.
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
    validate_config(&input.config)?;
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
