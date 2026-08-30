//! The run lifecycle endpoints: review, publish, and reads.
//!
//! A produced run is stored privately when it finishes (the driver reports it via
//! `POST /jobs/{id}/status`) — its build playable for reviewers but absent from the
//! public snapshot. Any account may then **review** it (one review per account). An
//! explicit **publish** flips it public, and is refused unless it has at least one
//! review. Review and publish each require a valid bearer token (see
//! [`crate::auth::AuthUser`]); reads stay open on the private network.

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use test_cabinet_core::match_play::{ControllerKind, ControllerRef};
use test_cabinet_core::review::{
    AestheticRating, DomainRating, Rating, ReviewRevision, ReviewVerdict,
};
use test_cabinet_core::run_record::RunRecord;

use crate::auth::AuthUser;
use crate::db::{
    Reviewer, SortDir, StoredReview, StoredRun, SummaryFilter, SummarySort, SummaryState,
};
use crate::error::ApiError;
use crate::snapshot::{RunSummary, run_summary_score};
use crate::store::{CaseNames, DefinitionStore, StoredManifest, case_display_name};

use super::AppState;

use std::collections::HashMap;

/// The default and maximum page size for `GET /runs`.
const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = 200;

/// `POST /runs/{id}/reviews` — submit a review for a run, attributed to the
/// token's account. The review gate (at least one domain rated, a non-empty
/// writeup) applies here. An account reviews a run at most once: re-submitting
/// updates that review. Requires a bearer token. `404` for an unknown run.
#[tracing::instrument(
    name = "runs.add_review",
    skip(state, user, request),
    fields(run.id = %id, reviewer = %user.0.username),
    err(Debug),
)]
pub async fn add_review(
    State(state): State<AppState>,
    Path(id): Path<String>,
    user: AuthUser,
    Json(request): Json<ReviewRequest>,
) -> Result<Json<ReviewResponse>, ApiError> {
    // A domain-scored legacy case rates at least one domain; a game jam rates none
    // and instead records its graded categories and overall grade as checklist
    // verdicts; a validator-rated run rates the aesthetic channel. Require one of
    // the three so an empty review is still rejected.
    if request.ratings.is_empty() && request.aesthetic.is_none() && request.checklist.is_empty() {
        return Err(ApiError::unprocessable(
            "review must rate at least one domain, rate the aesthetic channel, or record a \
             checklist verdict",
        ));
    }
    if request.writeup.trim().is_empty() {
        return Err(ApiError::unprocessable("review.writeup must be non-empty"));
    }

    // The run's case version decides which channel the reviewer rates. On a
    // validator-rated run the review must carry the run-wide aesthetic tier, may
    // carry no functional rating, and its checklist verdicts are **overrides** of
    // the validators' — each naming a declared point, binary pass/fail. On a
    // legacy run the aesthetic channel does not exist. Either way the store is the
    // authority on which the run is, so the check reads the flag it lifted at push
    // time.
    let run = state
        .db
        .get_run(&id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found(format!("run `{id}` not found")))?;
    let manifest = if run.validator_rated {
        let subject = &run.record.subject;
        let manifest = state
            .store
            .read_manifest(&subject.test_case_slug, &subject.test_case_version)
            .map_err(|err| {
                ApiError::unprocessable(format!(
                    "run `{id}` is validator-rated but its case version `{}@{}` cannot be \
                     resolved from the definition store: {err}",
                    subject.test_case_slug, subject.test_case_version
                ))
            })?;
        validate_validator_rated_review(
            &request,
            &crate::snapshot::review_items_for(&manifest, &subject.variant),
        )?;
        Some(manifest)
    } else {
        if request.aesthetic.is_some() {
            return Err(ApiError::unprocessable(
                "review carries an aesthetic rating, but only a review of a validator-rated run \
                 (a case version on the engine manifest format) rates the aesthetic channel",
            ));
        }
        None
    };

    let reviewed_at = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| ApiError::internal(format!("formatting reviewedAt: {e}")))?;
    let review = StoredReview {
        reviewer: Reviewer {
            user_id: user.0.id,
            username: user.0.username,
            display_name: user.0.display_name,
        },
        ratings: request.ratings,
        aesthetics: Vec::new(),
        aesthetic: request.aesthetic,
        writeup: request.writeup.trim().to_string(),
        checklist: request.checklist,
        reviewed_at,
        // A first submission has no history; the store fills these on an edit.
        edited_at: None,
        revisions: Vec::new(),
    };

    let published = state
        .db
        .add_review(
            &id,
            &review,
            request.edit_note.as_deref(),
            manifest.as_ref(),
        )
        .await
        .map_err(ApiError::from)?;

    // A review on an already-published run changes its public aggregate, so a
    // refresh is queued; on a pending run it is not yet public.
    if published {
        state.publisher.queue_refresh();
    }

    Ok(Json(ReviewResponse { id, published }))
}

/// The completeness gate for a review of a **validator-rated** run: the review
/// must carry no `ratings` (the functional channel starts as the validators'
/// decision), must carry the run-wide `aesthetic` tier, and may carry a
/// **partial** `checklist` of overrides — each entry the reviewer's verdict for
/// one of the run's declared points (`items`, the effective checklist for its
/// variant), binary `pass`/`fail` with an optional note. Points not listed keep
/// the validators' verdicts, so an empty checklist is fine. Each violation is a
/// `422` naming what is wrong.
fn validate_validator_rated_review(
    request: &ReviewRequest,
    items: &[test_cabinet_core::ReviewItem],
) -> Result<(), ApiError> {
    if !request.ratings.is_empty() {
        return Err(ApiError::unprocessable(
            "review carries functional ratings, but on a validator-rated run the functional \
             rating is decided by the validators — override individual verdicts instead",
        ));
    }
    if request.aesthetic.is_none() {
        return Err(ApiError::unprocessable(
            "review must rate the aesthetic channel: one run-wide tier for the whole build",
        ));
    }
    let declared: Vec<String> = items.iter().flat_map(|item| item.verdict_ids()).collect();
    let unknown: Vec<&str> = request
        .checklist
        .iter()
        .map(|verdict| verdict.id.as_str())
        .filter(|id| !declared.iter().any(|known| known == id))
        .collect();
    if !unknown.is_empty() {
        return Err(ApiError::unprocessable(format!(
            "review overrides a verdict the run's case version does not declare: {}",
            unknown.join(", ")
        )));
    }
    let graded: Vec<&str> = request
        .checklist
        .iter()
        .filter(|verdict| verdict.status.is_grade())
        .map(|verdict| verdict.id.as_str())
        .collect();
    if !graded.is_empty() {
        return Err(ApiError::unprocessable(format!(
            "review overrides a verdict with a graded tier, but an override is binary — \
             pass or fail: {}",
            graded.join(", ")
        )));
    }
    Ok(())
}

/// `POST /runs/{id}/publish` — **enqueue** a publish for a run. The publish is now
/// asynchronous: the gh/wrangler release runs in a per-publish `tcab-publisher`
/// Job, so this only **gates** the run (refused with 422 unless it is publishable —
/// not an infrastructure failure, and a completed run with ≥1 review) and enqueues
/// a publish job. It no longer flips `published` synchronously — that happens when
/// the publisher reports a terminal success (see [`crate::api::publish_jobs`]).
/// Requires a bearer token. `404` for an unknown run. Returns `202 Accepted` with
/// the publish-job id and the live URL to observe it on.
///
/// **Idempotent while a release is under way.** When the run already has a live
/// publish job ([`crate::db::Db::active_publish_job_for_run`]) this answers with
/// *that* job instead of enqueuing another, so repeated calls re-attach to the
/// running publish rather than starting a second one. That is load-bearing rather
/// than a nicety: every publish job deploys a brand-new Cloudflare Pages
/// deployment, so a duplicate silently leaves an orphaned public build behind.
#[tracing::instrument(
    name = "runs.publish",
    skip(state, _user),
    fields(run.id = %id, reviewer = %_user.0.username),
    err(Debug),
)]
pub async fn publish(
    State(state): State<AppState>,
    Path(id): Path<String>,
    _user: AuthUser,
) -> Result<Response, ApiError> {
    // Gate at enqueue so the user is rejected immediately (rather than after a
    // publish Job spins up and fails). This is the same gate the legacy
    // `Db::publish` flip enforces.
    state
        .db
        .ensure_publishable(&id)
        .await
        .map_err(ApiError::from)?;

    let created_at = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| ApiError::internal(format!("formatting created_at: {e}")))?;

    // Idempotency: a run whose release is already under way answers with *that*
    // publish job rather than enqueuing a second one. A publish is not idempotent
    // externally — every job runs `wrangler pages deploy`, which mints a brand-new
    // Cloudflare Pages deployment — so a duplicate job leaves an orphaned public
    // build behind (the `gh` side reuses the repo, so only the Pages side shows it).
    // A double-click, a second console tab, or a retry after the live stream dropped
    // therefore re-attaches to the publish already running.
    if let Some(existing) = state
        .db
        .active_publish_job_for_run(&id, &created_at)
        .await
        .map_err(ApiError::from)?
    {
        tracing::info!(
            publish_job.id = %existing.id,
            publish_job.state = %existing.state,
            "publish already under way for this run; re-attaching to it"
        );
        let publish_job_id = existing.id;
        let body = PublishResponse {
            live_url: format!("/publish-jobs/{publish_job_id}/live"),
            publish_job_id,
        };
        return Ok((StatusCode::ACCEPTED, Json(body)).into_response());
    }

    let publish_job_id = cuid2::create_id();
    let job_token = cuid2::create_id();

    state
        .db
        .enqueue_publish_job(crate::db::NewPublishJob {
            id: publish_job_id.clone(),
            run_id: id.clone(),
            job_token,
            created_at,
        })
        .await
        .map_err(ApiError::from)?;

    let body = PublishResponse {
        publish_job_id: publish_job_id.clone(),
        live_url: format!("/publish-jobs/{publish_job_id}/live"),
    };
    Ok((StatusCode::ACCEPTED, Json(body)).into_response())
}

/// `DELETE /runs/{id}` — permanently delete a run. Refused with `422` when the
/// run is **published** and this build can read its record (a public run is in the
/// snapshot and gallery). Requires a bearer token. `404` for an unknown run.
/// Removes the run record, its reviews, its links, and its stored media.
///
/// Operates on the stored row rather than on the record, so it deletes a run whose
/// stored record this build can no longer read as well, published or not. The
/// consoles offer that from the runs section's Unreadable tab, which reads
/// [`unreadable`].
#[tracing::instrument(
    name = "runs.delete",
    skip(state, _user),
    fields(run.id = %id, reviewer = %_user.0.username),
    err(Debug),
)]
pub async fn delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
    _user: AuthUser,
) -> Result<Response, ApiError> {
    // The system of record is the run row: deleting it (and its cascaded reviews
    // and links) makes the run vanish from every listing. This also enforces the
    // published guard, so it runs first.
    state.db.delete_run(&id).await.map_err(ApiError::from)?;

    // Then clear the run's stored media tree so deletion leaves nothing behind.
    // The authoritative record is already gone, so a media-cleanup fault must not
    // fail the request: it is logged, and the now-unreferenced bytes stay on the
    // backend's own volume until an operator clears them, rather than the request
    // resurrecting a half-deleted run. This is the backend's store, not the artifact
    // service, so the reclamation sweep below has no part in it.
    if let Err(err) = state.store.delete_run_media(&id) {
        tracing::warn!("deleted run {id} but failed to remove its media: {err}");
    }

    // A run's playable build and recorded logs live in the separate artifact
    // service; ask it over the in-cluster artifact URL to prune the tree too.
    // Best-effort (see [`crate::artifacts`]): a failure is logged, never surfaced —
    // the record is already gone, so the run has vanished from every listing
    // regardless, and the reclamation sweep collects the tree a failure leaves.
    crate::artifacts::delete_run_tree(
        &state.http,
        state.config.artifacts_internal_url.as_deref(),
        state.config.service_token.as_deref(),
        &id,
    )
    .await;

    // Only an unpublished run can be deleted, so the run was not in the public
    // snapshot — no refresh is queued.
    Ok((StatusCode::OK, Json(DeleteResponse { id, deleted: true })).into_response())
}

/// `GET /runs?limit=&before=&state=` — list runs, newest first, paginated.
///
/// `state` defaults to `published` (the public read side: only published runs,
/// ordered by publish time). `state=review` returns **completed** runs — pending
/// and published — ordered by finish time, for the reviewer worklist.
/// `state=failures` returns the **publishable failure** runs (catastrophic,
/// timed-out, and harness-error, pending and published) for the publish-failures
/// affordance.
/// `state=unpublished` returns **every** pushed-but-unpublished run whatever its
/// state (completed, every failure tier, including the never-publishable
/// infrastructure failures), ordered by finish time — the console's "produced"
/// worklist, disjoint from the default published listing.
/// `state=publishable` narrows that to the unpublished runs that would publish
/// right now — the ones clearing the publish gate — for the console's Unpublished
/// worklist, where every listed run is meant to be selectable and published.
///
/// `state=any` applies **no** lifecycle predicate at all: every recorded run,
/// published or not, in any terminal state. That is what the consoles' run listings
/// need — an unpublished run has to sort and page alongside the published ones —
/// and what a listing scoped by something other than the publish lifecycle needs
/// (the gg analysis section's Sessions tab, narrowed by `harness=gg`). It and
/// `publishable` are offered only on the numbered-pager path below; the cursor
/// listings walk one lifecycle slice at a time.
///
/// `fields=summary` returns bounded [`RunSummary`] cards (the lightweight shape
/// the console's run log and list pages consume) instead of full
/// [`StoredRunOut`] records; the cursor (`before`/`limit`) and `state` selector
/// behave identically for both projections. Any other `fields` value (or none)
/// keeps the default full records.
///
/// Every projection and mode serves only the runs whose stored record this build
/// can read, and the offset mode's `total` counts exactly those rows, so a pager
/// sized from it offers only pages that hold rows. A run this build cannot read is
/// listed by [`unreadable`] instead.
pub async fn list(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Result<Response, ApiError> {
    let limit = params.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);

    // The numbered-pager path: a summary projection with an explicit `offset` uses
    // the OFFSET + total-COUNT listing (with filter/free-text/sort), distinct from
    // the `before`-cursor path below. Only the summary projection carries it.
    if params.fields.as_deref() == Some("summary")
        && let Some(offset) = params.offset
    {
        let filter = SummaryFilter {
            state: summary_state(params.state.as_deref()),
            test_case: params.test_case.clone(),
            test_cases: parse_comma_list(params.test_cases.as_deref()),
            model: params.model.clone(),
            harness: params.harness.clone(),
            variant: params.variant.clone(),
            version: params.version.clone(),
            versions: parse_comma_list(params.versions.as_deref()),
            engine: params.engine.clone(),
            latest_versions: params.latest_versions.unwrap_or(false),
            aesthetic: params.aesthetic.clone(),
            q: params.q.clone(),
        };
        let sort = parse_sort(params.sort.as_deref());
        let dir = parse_dir(params.dir.as_deref());
        // The cards name their case, so every listing resolves the name map once;
        // the test-case sort orders by the same names the cards show.
        let case_names = state.store.case_names().map_err(ApiError::from)?;
        let (runs, total) = state
            .db
            .list_summaries(&filter, sort, dir, &case_names, limit, offset)
            .await
            .map_err(ApiError::from)?;
        return Ok(Json(SummaryListResponse {
            runs: summary_cards(&state.store, &case_names, &runs),
            next_before: None,
            total: Some(total),
        })
        .into_response());
    }

    let (runs, next_before) = match params.state.as_deref() {
        Some("review") | Some("all") => state
            .db
            .list_for_review(limit, params.before.as_deref())
            .await
            .map_err(ApiError::from)?,
        Some("failures") => state
            .db
            .list_publishable_failures(limit, params.before.as_deref())
            .await
            .map_err(ApiError::from)?,
        Some("unpublished") => state
            .db
            .list_unpublished(limit, params.before.as_deref())
            .await
            .map_err(ApiError::from)?,
        Some("unreviewed") => state
            .db
            .list_unreviewed(limit, params.before.as_deref())
            .await
            .map_err(ApiError::from)?,
        _ => state
            .db
            .list_published(limit, params.before.as_deref())
            .await
            .map_err(ApiError::from)?,
    };
    if params.fields.as_deref() == Some("summary") {
        let case_names = state.store.case_names().map_err(ApiError::from)?;
        Ok(Json(SummaryListResponse {
            runs: summary_cards(&state.store, &case_names, &runs),
            next_before,
            total: None,
        })
        .into_response())
    } else {
        // The full projection carries each run's score and functional rating through
        // the same catalog seams as the cards, so the console's produced worklist
        // (which reads this projection) shows a validator-rated run's points the
        // moment it completes.
        let mut manifests = ManifestCache::default();
        Ok(Json(ListResponse {
            runs: runs
                .iter()
                .map(|run| stored_run_out(run, manifests.for_run(&state.store, run)))
                .collect(),
            next_before,
        })
        .into_response())
    }
}

/// A per-page cache of resolved case manifests keyed by `(slug, version)`, so a
/// listing reads each case from the definition store once rather than once per
/// run. A run whose case isn't ingested resolves to `None` (and stays `None`).
#[derive(Default)]
struct ManifestCache(HashMap<(String, String), Option<StoredManifest>>);

impl ManifestCache {
    fn for_run(&mut self, store: &DefinitionStore, run: &StoredRun) -> Option<&StoredManifest> {
        let subject = &run.record.subject;
        let key = (
            subject.test_case_slug.clone(),
            subject.test_case_version.clone(),
        );
        self.0
            .entry(key)
            .or_insert_with(|| {
                store
                    .read_manifest(&subject.test_case_slug, &subject.test_case_version)
                    .ok()
            })
            .as_ref()
    }
}

/// Build the summary cards for a page of runs, enriching each with the two fields
/// [`RunSummary::from_stored`] cannot fill without the case catalog: its case's
/// display `case_name` (from `case_names`, the same map the `testCase` sort orders
/// by) and its aggregate reviewer `score` (the checklist weights live only in the
/// catalog, not the run).
///
/// Each run's manifest is resolved from the definition store and its reviews
/// scored against that case's declared weights (see [`run_summary_score`]). The
/// resolved manifest is cached per `(slug, version)` so a case is read once per
/// page rather than once per run; a run whose case isn't ingested keeps
/// `score = None`.
fn summary_cards(
    store: &DefinitionStore,
    case_names: &CaseNames,
    runs: &[StoredRun],
) -> Vec<RunSummary> {
    let mut manifests = ManifestCache::default();
    runs.iter()
        .map(|run| {
            let mut card = RunSummary::from_stored(run);
            let subject = &run.record.subject;
            card.case_name = case_display_name(case_names, &subject.test_case_slug);
            if let Some(manifest) = manifests.for_run(store, run) {
                card.score = run_summary_score(manifest, &run.record, &run.reviews);
                // The functional rating is derived through the one seam the lifted
                // column and the snapshot share, so a validator-rated card never
                // depends on the row having been pushed with its case in the store.
                card.rating =
                    crate::db::functional_rating(Some(manifest), &run.record, &run.reviews);
                card.validator_rated = manifest.validator_rated();
            }
            card
        })
        .collect()
}

/// `GET /adversarial/controllers?testCase=<slug>` — the pushed adversarial
/// controllers for a case: every stored run (pending or published) that produced
/// an adversarial result and uploaded a controller wasm. The arena resolves these
/// as [`ControllerKind::PushedRun`] (fetching the wasm from
/// `GET /runs/{id}/controller.wasm`), so a reviewer can pit a pushed
/// implementation from any host. A read; no auth on the private network.
pub async fn adversarial_controllers(
    State(state): State<AppState>,
    Query(params): Query<ControllersParams>,
) -> Result<Json<ControllersResponse>, ApiError> {
    let runs = state
        .db
        .list_for_case(&params.test_case)
        .await
        .map_err(ApiError::from)?;
    let controllers = runs
        .into_iter()
        .filter(|run| run.record.validation.adversarial.is_some())
        // Only runs whose controller wasm actually landed can be pitted.
        .filter(|run| state.store.has_run_controller(&run.record.id))
        .map(|run| ControllerRef {
            id: run.record.id.clone(),
            kind: ControllerKind::PushedRun,
            label: Some(run.record.subject.model_id.clone()),
        })
        .collect();
    Ok(Json(ControllersResponse { controllers }))
}

/// `GET /runs/{id}` — one stored run (published or pending) with its reviews.
///
/// Answers with the record, so a run whose stored record this build cannot read
/// answers `404` here and is reached through [`unreadable`].
pub async fn get(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<StoredRunOut>, ApiError> {
    let run = state
        .db
        .get_run(&id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found(format!("run `{id}` not found")))?;
    // The run's case version, for the score and the functional rating; a run whose
    // case isn't ingested is still served, without a score.
    let subject = &run.record.subject;
    let manifest = state
        .store
        .read_manifest(&subject.test_case_slug, &subject.test_case_version)
        .ok();
    Ok(Json(stored_run_out(&run, manifest.as_ref())))
}

/// `GET /runs/unreadable?limit=&offset=` — the stored runs whose records this build
/// cannot read, as `{ runs, total }`, newest first by finish time.
///
/// Paged exactly as the numbered mode of [`list`] is: `limit` defaults to
/// [`DEFAULT_LIMIT`] and is clamped to [`MAX_LIMIT`], and `total` counts every
/// unreadable run the cabinet holds, so a pager sized from it offers only pages that
/// hold rows.
///
/// Every ordinary listing filters these out, so without this endpoint such a run is
/// reachable from nowhere while still occupying the store. Each row carries the
/// identity the run's lifted columns hold plus the error decoding its record
/// produces now; deleting one goes through [`delete`], which acts on the row. A
/// read; no auth on the private network, like the other run reads.
#[tracing::instrument(name = "runs.unreadable", skip(state), err(Debug))]
pub async fn unreadable(
    State(state): State<AppState>,
    Query(params): Query<UnreadableParams>,
) -> Result<Json<UnreadableRunsResponse>, ApiError> {
    let limit = params.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let (runs, total) = state
        .db
        .list_unreadable_runs(limit, params.offset.unwrap_or(0))
        .await
        .map_err(ApiError::from)?;
    Ok(Json(UnreadableRunsResponse {
        runs: runs.iter().map(unreadable_run_out).collect(),
        total,
    }))
}

/// Shape one unreadable run for the wire.
fn unreadable_run_out(run: &crate::db::UnreadableRun) -> UnreadableRunOut {
    UnreadableRunOut {
        id: run.id.clone(),
        started_at: run.started_at.clone(),
        finished_at: run.finished_at.clone(),
        test_case_slug: run.test_case_slug.clone(),
        test_case_version: run.test_case_version.clone(),
        variant: run.variant.clone(),
        engine_slug: run.engine_slug.clone(),
        harness_slug: run.harness_slug.clone(),
        model_id: run.model_id.clone(),
        gg_preset: run.gg_preset.clone(),
        test_type: run.test_type.clone(),
        state: run.run_state.clone(),
        published: run.published,
        review_count: run.review_count,
        error: run.error.clone(),
    }
}

/// `GET /runs/{id}/events` — the published run's recorded normalized event
/// stream, as a JSON array (an empty array when the run recorded none). Raw
/// harness output is never published, so it is not served here. `404` for an
/// unknown run.
pub async fn events(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let run = state
        .db
        .get_run(&id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found(format!("run `{id}` not found")))?;
    // Stored verbatim as a JSON array; pass it through unparsed, defaulting to an
    // empty array when the run carries no events.
    let body = run.events_json.unwrap_or_else(|| "[]".to_string());
    Ok((
        [
            (header::CONTENT_TYPE, "application/json"),
            (header::CACHE_CONTROL, "public, max-age=300"),
        ],
        body,
    )
        .into_response())
}

/// `POST /snapshot/refresh` — force an immediate regen + upload + hook fire.
#[tracing::instrument(name = "snapshot.refresh", skip(state), err(Debug))]
pub async fn refresh(State(state): State<AppState>) -> Result<Json<RefreshResponse>, ApiError> {
    let outcome = state
        .publisher
        .refresh_now()
        .await
        .map_err(ApiError::from)?;
    Ok(Json(RefreshResponse {
        refreshed: true,
        run_count: outcome.run_count,
        deploy_hook_fired: outcome.deploy_hook_fired,
    }))
}

/// `GET /account/reviews` — the signed-in account's own submitted reviews, newest
/// first (by when they reviewed), for the account page's Reviews tab. A numbered
/// pager: `limit` + `offset`, with the total count so the console can size it. Each
/// entry pairs the reviewed run's summary card with this account's review of it.
/// Requires a bearer token; an account only ever lists its own reviews.
#[tracing::instrument(
    name = "runs.my_reviews",
    skip(state, user, params),
    fields(reviewer = %user.0.username),
    err(Debug),
)]
pub async fn my_reviews(
    State(state): State<AppState>,
    user: AuthUser,
    Query(params): Query<MyReviewsParams>,
) -> Result<Json<MyReviewsResponse>, ApiError> {
    let limit = params.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let offset = params.offset.unwrap_or(0);
    let user_id = user.0.id;

    let (runs, total) = state
        .db
        .list_reviews_by_user(&user_id, limit, offset)
        .await
        .map_err(ApiError::from)?;

    let reviews = runs
        .iter()
        .filter_map(|run| {
            // Pair the run's summary card with this account's review of it. The
            // review is guaranteed present (the run was selected *because* this
            // account reviewed it), but tolerate its absence rather than panic.
            let review = run
                .reviews
                .iter()
                .find(|review| review.reviewer.user_id == user_id)?;
            Some(MyReviewOut {
                run: RunSummary::from_stored(run),
                review: review_out(review),
            })
        })
        .collect();

    Ok(Json(MyReviewsResponse { reviews, total }))
}

/// How many of the account's most recent reviews the Profile-tab breakdown charts
/// aggregate over — the "recently reviewed" window. Bounds the work and matches the
/// "recent" framing: a reviewer with thousands of reviews sees their latest activity,
/// not their all-time totals.
const REVIEW_STATS_WINDOW: usize = 100;

/// `GET /account/review-stats` — aggregate breakdowns of the signed-in account's
/// recent reviews, for the account page's Profile tab: how those reviews split across
/// **test cases** (all variants and versions of a case folded together), across
/// **models**, and across the **ratings** the account gave. Computed over the
/// account's most recent [`REVIEW_STATS_WINDOW`] reviews (the "recently reviewed"
/// window), each breakdown ordered largest-first (ratings best-to-worst). Requires a
/// bearer token; an account only ever sees its own activity.
#[tracing::instrument(
    name = "runs.review_stats",
    skip(state, user),
    fields(reviewer = %user.0.username),
    err(Debug),
)]
pub async fn review_stats(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<ReviewStatsResponse>, ApiError> {
    let (subjects, total) = state
        .db
        .recent_review_subjects(&user.0.id, REVIEW_STATS_WINDOW)
        .await
        .map_err(ApiError::from)?;

    let mut case_counts: HashMap<String, usize> = HashMap::new();
    let mut model_counts: HashMap<String, usize> = HashMap::new();
    // `Rating` is not `Hash`; tally by rank (0 = flawless … 4 = broken) so the result
    // is already ordered best-to-worst.
    let mut rating_counts = [0usize; Rating::ALL.len()];
    let mut aesthetic_counts = [0usize; AestheticRating::ALL.len()];

    for subject in &subjects {
        *case_counts
            .entry(subject.test_case_slug.clone())
            .or_default() += 1;
        *model_counts.entry(subject.model_id.clone()).or_default() += 1;
        // A review's own overall rating is the worst rating it gave across the case's
        // domains. A game jam rates no domain, so it contributes to the case/model
        // tallies but not the ratings breakdown.
        if let Some(worst) = Rating::worst(subject.ratings.iter().map(|r| r.rating)) {
            rating_counts[worst.rank()] += 1;
        }
        // The aesthetic channel: a validator-rated run's review rates no functional
        // domain and instead carries one run-wide tier (a legacy per-domain review
        // already collapsed to its worst), so it lands here instead.
        if let Some(tier) = subject.aesthetic {
            aesthetic_counts[tier.rank()] += 1;
        }
    }

    let ratings = Rating::ALL
        .iter()
        .enumerate()
        .filter(|&(rank, _)| rating_counts[rank] > 0)
        .map(|(rank, rating)| RatingSlice {
            rating: *rating,
            count: rating_counts[rank],
        })
        .collect();

    let aesthetics = AestheticRating::ALL
        .iter()
        .enumerate()
        .filter(|&(rank, _)| aesthetic_counts[rank] > 0)
        .map(|(rank, rating)| AestheticSlice {
            rating: *rating,
            count: aesthetic_counts[rank],
        })
        .collect();

    Ok(Json(ReviewStatsResponse {
        window_reviews: subjects.len(),
        total_reviews: total,
        test_cases: stat_slices(case_counts),
        models: stat_slices(model_counts),
        ratings,
        aesthetics,
    }))
}

/// Fold a `key -> count` tally into wire slices, ordered by count (desc) then key
/// (asc) so the largest slices lead and ties are deterministic.
fn stat_slices(counts: HashMap<String, usize>) -> Vec<StatSlice> {
    let mut slices: Vec<StatSlice> = counts
        .into_iter()
        .map(|(key, count)| StatSlice { key, count })
        .collect();
    slices.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.key.cmp(&b.key)));
    slices
}

/// Map a stored run to the read-side wire shape: `record` (links populated), the
/// reviews array, the resolved links, the published flag, the two rating
/// channels (the functional `rating`, the aggregate `aesthetic`) with the
/// `validator_rated` flag that says which way the functional one was decided,
/// and the run's `score`.
///
/// `manifest` is the run's case version from the definition store, when
/// ingested. With it the functional rating and the score come through the same
/// seams the summary cards and the snapshot use ([`crate::db::functional_rating`],
/// [`run_summary_score`]), so a validator-rated run's detail shows its points and
/// rating the moment it completes; without it the score is unknown (`None`) and
/// the rating falls back to the lifted column / the review aggregate.
fn stored_run_out(run: &StoredRun, manifest: Option<&StoredManifest>) -> StoredRunOut {
    let rating = match manifest {
        Some(manifest) => crate::db::functional_rating(Some(manifest), &run.record, &run.reviews),
        None if run.validator_rated => run.rating,
        None => crate::db::aggregate_review_rating(&run.record, &run.reviews),
    };
    StoredRunOut {
        record: run.record.clone(),
        reviews: run.reviews.iter().map(review_out).collect(),
        links: LinksOut {
            source_repo: run.links.source_repo.clone(),
            playable_build: run.links.playable_build.clone(),
        },
        published: run.published,
        rating,
        aesthetic: crate::db::aggregate_review_aesthetic(&run.reviews),
        validator_rated: manifest.map_or(run.validator_rated, StoredManifest::validator_rated),
        score: manifest.and_then(|manifest| run_summary_score(manifest, &run.record, &run.reviews)),
    }
}

/// Map a stored review to its read-side wire shape, exposing the reviewer's
/// public identity.
fn review_out(review: &StoredReview) -> ReviewOut {
    ReviewOut {
        reviewer_id: review.reviewer.user_id.clone(),
        reviewer: review.reviewer.display_name.clone(),
        username: review.reviewer.username.clone(),
        ratings: review.ratings.clone(),
        aesthetic: review.aesthetic,
        writeup: review.writeup.clone(),
        checklist: review.checklist.clone(),
        reviewed_at: review.reviewed_at.clone(),
        edited_at: review.edited_at.clone(),
        revisions: review.revisions.clone(),
    }
}

// --- Wire shapes ------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRequest {
    /// The reviewer's per-domain functional ratings. Required (one per effective
    /// domain) on a legacy domain-scored run; refused on a validator-rated run.
    #[serde(default)]
    ratings: Vec<DomainRating>,
    /// The reviewer's **run-wide** aesthetic tier. Required on a validator-rated
    /// run; refused on a legacy run.
    #[serde(default)]
    aesthetic: Option<AestheticRating>,
    writeup: String,
    /// The reviewer's checklist verdicts. On a legacy run the full checklist; on
    /// a validator-rated run a **partial** list of overrides (each a declared
    /// verdict id with a binary pass/fail status) — points not listed keep the
    /// validators' verdicts.
    #[serde(default)]
    checklist: Vec<ReviewVerdict>,
    /// A note explaining what changed, required when this submission edits an
    /// existing review (a first submission needs none). Enforced by the store, which
    /// alone knows whether a prior review exists and whether the content changed.
    #[serde(default)]
    edit_note: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewResponse {
    id: String,
    /// Whether the run is published (and so this review changed something public).
    published: bool,
}

/// The body of `POST /runs/{id}/publish`: the enqueued publish job's id and the
/// live URL to observe it on. Publishing is now asynchronous — the console
/// subscribes to `live_url` (an NDJSON stream ending in the terminal result) rather
/// than receiving a synchronous `newlyPublished`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublishResponse {
    publish_job_id: String,
    live_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeleteResponse {
    id: String,
    deleted: bool,
}

#[derive(Deserialize)]
pub struct ListParams {
    limit: Option<usize>,
    before: Option<String>,
    /// `published` (default) for the public listing, or `review`/`all` for the
    /// reviewer worklist (pending + published).
    state: Option<String>,
    /// `summary` returns bounded [`RunSummary`] cards instead of full
    /// [`StoredRunOut`] records; any other value (or none) keeps the full records.
    fields: Option<String>,
    /// The 0-based row offset for the numbered-pager path. Present only on the
    /// summary projection; when set, the offset + total-count listing (with the
    /// filter/free-text/sort params below) is used instead of the `before` cursor.
    /// The struct has no `rename_all`, so each field binds by its Rust name; only
    /// `test_case` needs a `rename` to reach the camelCase wire name `testCase`.
    offset: Option<usize>,
    /// Filter to one test-case slug (summary + offset path only). Wire: `testCase`.
    #[serde(rename = "testCase")]
    test_case: Option<String>,
    /// Filter to a comma-separated list of test-case slugs (summary + offset path
    /// only) — the home page's group-leaderboard slice: one query covers a
    /// test-case group's member cases. ANDs with the other filters, `testCase`
    /// included, so naming both narrows to their intersection. Wire: `testCases`.
    #[serde(rename = "testCases")]
    test_cases: Option<String>,
    /// Filter to one model id (summary + offset path only).
    model: Option<String>,
    /// Filter to one harness slug (summary + offset path only).
    harness: Option<String>,
    /// Filter to one variant slug (summary + offset path only). Paired with
    /// `testCase` — a variant slug is only unique within its case.
    variant: Option<String>,
    /// Filter to one exact test-case version (summary + offset path only).
    /// Normally paired with `testCase`, since a version only means something
    /// within a case.
    version: Option<String>,
    /// Filter to a comma-separated list of exact test-case versions (summary +
    /// offset path only) — the case-detail Runs tab's version scope: the console
    /// computes the versions in the anchored `major.minor` or major line from the
    /// catalog and sends the concrete list. Like `version`, it silences
    /// `latestVersions`.
    versions: Option<String>,
    /// Filter to one engine slug (summary + offset path only) — the slug the run
    /// was launched under, with the engineless run recording the slug `none`.
    engine: Option<String>,
    /// Filter to runs whose aggregate aesthetic rating is exactly this tier
    /// (`legendary`/`amazing`/`good`/`okay`/`slop`; summary + offset path only).
    /// A run no review has rated on that channel never matches.
    aesthetic: Option<String>,
    /// Restrict every run to its case's current `major.minor` — the newest one
    /// that case has a run for in the selected `state` slice (summary + offset
    /// path only). Ignored when `version` names an exact version. Wire:
    /// `latestVersions`.
    #[serde(rename = "latestVersions")]
    latest_versions: Option<bool>,
    /// Case-insensitive free-text query across the lifted identity columns (summary
    /// + offset path only).
    q: Option<String>,
    /// The sort column: `date` (default), `runtime`, `tokens`, `cost`, `rating`,
    /// `testType`, `testCase`, `harness`, `model`, `variant`.
    sort: Option<String>,
    /// The sort direction: `desc` (default) or `asc`.
    dir: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResponse {
    runs: Vec<StoredRunOut>,
    next_before: Option<String>,
}

/// The lightweight `fields=summary` projection of [`ListResponse`]: bounded run
/// cards plus the same cursor. Not a contract-codegen type — a plain axum
/// response reusing the [`RunSummary`] contract shape (already registered via the
/// snapshot's `runs.json` index).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryListResponse {
    runs: Vec<RunSummary>,
    next_before: Option<String>,
    /// The total number of matching rows, ignoring the page window — present only
    /// on the numbered-pager (offset) path, to size the console's pager. Absent on
    /// the `before`-cursor path (which drains rather than jumps), so that wire shape
    /// is unchanged.
    #[serde(skip_serializing_if = "Option::is_none")]
    total: Option<usize>,
}

/// One row of [`UnreadableRunsResponse`]: a stored run this build cannot decode,
/// as its lifted identity plus the error its record produces now. Not a
/// contract-codegen type — a plain axum response, like [`SummaryListResponse`].
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnreadableRunOut {
    id: String,
    started_at: String,
    finished_at: String,
    test_case_slug: String,
    test_case_version: String,
    variant: String,
    engine_slug: Option<String>,
    harness_slug: String,
    model_id: String,
    gg_preset: Option<String>,
    test_type: String,
    state: String,
    published: bool,
    review_count: i64,
    /// The error decoding the stored record produces against the current
    /// `RunRecord`.
    error: String,
}

/// The [`unreadable`] listing: one page of unreadable runs plus how many the cabinet
/// holds in total.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnreadableRunsResponse {
    runs: Vec<UnreadableRunOut>,
    total: usize,
}

/// The query parameters [`unreadable`] pages with, the numbered pair the summary
/// mode of [`list`] carries.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnreadableParams {
    /// Rows per page, defaulting to [`DEFAULT_LIMIT`] and clamped to [`MAX_LIMIT`].
    limit: Option<usize>,
    /// Rows to skip, so a pager can jump to a page.
    offset: Option<usize>,
}

/// Split a comma-separated list query param (`versions`, `testCases`) into the
/// filter's list: entries are trimmed and empties dropped, so `v1.0.0, v1.1.0`
/// and a trailing comma both parse. `None` (absent, or nothing but separators)
/// applies no filter.
fn parse_comma_list(list: Option<&str>) -> Option<Vec<String>> {
    let list: Vec<String> = list?
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    if list.is_empty() { None } else { Some(list) }
}

/// Map the `state` query param to the summary listing's lifecycle slice, mirroring
/// the cursor path's `state` handling (`review`/`all` → the reviewer worklist).
///
/// `any` and `publishable` have no cursor-path equivalent: both are summary-listing
/// slices only the numbered pager needs — the published + unpublished union
/// ([`SummaryState::Any`]) and the publish worklist ([`SummaryState::Publishable`]).
fn summary_state(state: Option<&str>) -> SummaryState {
    match state {
        Some("review") | Some("all") => SummaryState::Review,
        Some("failures") => SummaryState::Failures,
        Some("unpublished") => SummaryState::Unpublished,
        Some("publishable") => SummaryState::Publishable,
        Some("unreviewed") => SummaryState::Unreviewed,
        Some("any") => SummaryState::Any,
        _ => SummaryState::Published,
    }
}

/// Map the `sort` query param to a [`SummarySort`], defaulting to `Date`.
fn parse_sort(sort: Option<&str>) -> SummarySort {
    match sort {
        Some("runtime") => SummarySort::Runtime,
        Some("tokens") => SummarySort::Tokens,
        Some("cost") => SummarySort::Cost,
        Some("rating") => SummarySort::Rating,
        Some("testType") => SummarySort::TestType,
        Some("testCase") => SummarySort::TestCase,
        Some("harness") => SummarySort::Harness,
        Some("model") => SummarySort::Model,
        Some("variant") => SummarySort::Variant,
        _ => SummarySort::Date,
    }
}

/// Map the `dir` query param to a [`SortDir`], defaulting to `Desc`.
fn parse_dir(dir: Option<&str>) -> SortDir {
    match dir {
        Some("asc") => SortDir::Asc,
        _ => SortDir::Desc,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControllersParams {
    /// The test case slug whose pushed controllers to list.
    test_case: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControllersResponse {
    controllers: Vec<ControllerRef>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredRunOut {
    record: RunRecord,
    /// The run's reviews, oldest first. Empty while the run is pending review.
    reviews: Vec<ReviewOut>,
    links: LinksOut,
    /// Whether the run is published (in the public snapshot).
    published: bool,
    /// The run's **functional** rating: on a validator-rated run the validators'
    /// decision as overridden by its reviews (present from completion — the
    /// validators' own figure while unreviewed), the review aggregate on a legacy
    /// run (`null` while unreviewed). Composed with the toolchain gate either
    /// way. Always present, `null` when unset.
    rating: Option<Rating>,
    /// The run's aggregate **aesthetic** rating — the worst run-wide tier across
    /// its reviews — or `null` when no review has rated the aesthetic channel
    /// (every legacy run, and an unreviewed validator-rated one). Always present.
    aesthetic: Option<AestheticRating>,
    /// Whether the run is validator-rated, so the console shows its points and
    /// functional rating from the record immediately, offers publish without a
    /// review, and asks the reviewer for the run-wide aesthetic tier (plus any
    /// verdict overrides).
    validator_rated: bool,
    /// The run's score against its case version's checklist weights — the same
    /// figure the summary cards carry (see [`run_summary_score`]): the
    /// validator-decided score on a validator-rated run (`reviews` is `0`, present
    /// from completion), the mean across reviews on a legacy run (`null` while
    /// unreviewed). `null` when the run's case version isn't ingested. Always
    /// present.
    score: Option<crate::snapshot::RunScoreOut>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewOut {
    reviewer_id: String,
    reviewer: String,
    username: String,
    ratings: Vec<DomainRating>,
    /// The reviewer's run-wide aesthetic tier (a legacy per-domain row already
    /// collapsed to its worst); absent on a legacy run's review.
    #[serde(skip_serializing_if = "Option::is_none")]
    aesthetic: Option<AestheticRating>,
    writeup: String,
    checklist: Vec<ReviewVerdict>,
    /// RFC 3339 of the first submission (unchanged by later edits).
    reviewed_at: String,
    /// RFC 3339 of the last edit, or absent if never edited.
    #[serde(skip_serializing_if = "Option::is_none")]
    edited_at: Option<String>,
    /// The review's edit history, oldest first; empty if never edited.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    revisions: Vec<ReviewRevision>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LinksOut {
    source_repo: Option<String>,
    playable_build: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshResponse {
    refreshed: bool,
    run_count: usize,
    deploy_hook_fired: bool,
}

/// Query parameters for `GET /account/reviews`: the numbered-pager window.
#[derive(Deserialize)]
pub struct MyReviewsParams {
    limit: Option<usize>,
    offset: Option<usize>,
}

/// One entry in the account's Reviews-tab listing: the reviewed run's summary card
/// paired with this account's review of it. The run card is enriched (case display
/// name, per-review score) by the console against its catalog, exactly as the runs
/// listing is.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MyReviewOut {
    run: RunSummary,
    review: ReviewOut,
}

/// The body of `GET /account/reviews`: one page of the account's reviews plus the
/// total count, so the console can render a numbered pager.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MyReviewsResponse {
    reviews: Vec<MyReviewOut>,
    total: usize,
}

/// The body of `GET /account/review-stats`: the three "recently reviewed" breakdowns
/// (test cases, models, ratings) plus the window/total the charts caption themselves
/// with. Each breakdown carries only the buckets with a non-zero count.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewStatsResponse {
    /// How many recent reviews the breakdowns are computed over — the smaller of the
    /// window and the account's total review count.
    window_reviews: usize,
    /// The account's all-time review count (may exceed `window_reviews`).
    total_reviews: usize,
    /// Reviews per test case, largest first. `key` is the case slug (all variants and
    /// versions fold together); the console resolves its display name.
    test_cases: Vec<StatSlice>,
    /// Reviews per model, largest first. `key` is the raw model id.
    models: Vec<StatSlice>,
    /// Reviews per rating the account gave (the worst rating across each review's
    /// domains), best-to-worst. Reviews that rated no domain (game jams) are omitted.
    ratings: Vec<RatingSlice>,
    /// Reviews per **aesthetic** rating the account gave (each review's run-wide
    /// tier), best-to-worst. Reviews that did not rate the aesthetic channel
    /// (every legacy-run review) are omitted.
    aesthetics: Vec<AestheticSlice>,
}

/// One bucket of a keyed breakdown: an opaque `key` (a test-case slug or model id)
/// and how many of the recent reviews fell in it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatSlice {
    key: String,
    count: usize,
}

/// One bucket of the ratings breakdown: a rating tier and how many recent reviews the
/// account gave it (as their worst domain rating).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RatingSlice {
    rating: Rating,
    count: usize,
}

/// One bucket of the aesthetic-ratings breakdown: an aesthetic tier and how many
/// recent reviews the account gave it (as their run-wide tier).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AestheticSlice {
    rating: AestheticRating,
    count: usize,
}

#[cfg(test)]
#[path = "runs.test.rs"]
mod tests;
