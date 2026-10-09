//! The ingest trigger handler (§1.1's `POST /ingest`).

use std::convert::Infallible;
use std::path::PathBuf;

use axum::Json;
use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, header};
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use futures_util::stream;
use test_cabinet_core::asset_reference::{REFERENCE_MEDIA_PREFIX, parse_reference_image_key};
use test_cabinet_core::backend_client::{
    IngestBody, IngestBodyMode, IngestProgress, IngestResponse, IngestResponseSuite,
    IngestResponseVersion,
};
use test_cabinet_core::r2::R2Client;
use test_cabinet_core::reference_lock::{REFERENCE_LOCK_FILENAME, ReferenceLock};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::db::ReferenceSheetEntry;
use crate::error::ApiError;
use crate::ingest::{IngestEvent, IngestReport, IngestRequest, Ingestor};
use crate::publisher::Publisher;
use crate::readiness::Readiness;
use crate::store::DefinitionStore;
use test_cabinet_core::IngestMode;

use super::AppState;

/// `POST /ingest` — scan the configured checkout, copying any new/changed
/// test-case versions into the store and rendering reference screenshots.
/// Container images are distributed via a registry and pulled by runners by digest
/// from their own configuration; the backend is out of the container path and
/// ingest does not touch them.
///
/// The scan touches the filesystem and renders references (CPU/process-bound), so
/// it runs on a blocking thread to keep the async runtime responsive.
///
/// A whole-catalog scan can take a minute-plus, so the response shape is content
/// negotiated: a client that sends `Accept: application/x-ndjson` gets a streamed
/// progress feed (one NDJSON line per version as it completes, then a `done` line),
/// while the default answers once with the full JSON report. The streaming and
/// default paths run the identical scan; only the framing differs.
#[tracing::instrument(name = "ingest", skip(state, headers, body), err(Debug))]
pub async fn ingest(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Option<Json<IngestBody>>,
) -> Result<Response, ApiError> {
    let body = body.map(|Json(b)| b).unwrap_or_default();
    let request = promote_for_store_readiness(
        IngestRequest {
            test_cases: body.test_cases,
            force: body.force,
            mode: IngestBodyMode::scan_mode(body.mode),
            catalog_version: body.catalog_version,
        },
        state.ready.is_ready(),
    );

    // Reconcile the reference-build table from the committed lockfile before the
    // definition scan. It reads the same freshly-fetched checkout and is independent
    // of the version scan, so it runs identically for both response framings (the
    // streamed scan below only reports on definitions).
    reconcile_reference_builds(&state).await?;
    reconcile_reference_sheets(&state).await;

    // The whole-catalog prune must never drop a definition a run still references, so
    // fetch that protected set here (async, before the blocking scan) and hand it to
    // the ingestor. Cheap and harmless on a partial scan, which does not prune.
    let protected = state.db.referenced_cases().await.map_err(ApiError::from)?;
    let scan = Scan {
        checkout: state.config.checkout.clone(),
        store: state.store.clone(),
        previews: state.config.ingest_previews,
        protected,
    };

    if wants_ndjson(&headers) {
        return Ok(ingest_streaming(
            scan,
            request,
            state.publisher.clone(),
            state.gg_docs.clone(),
            state.ready.clone(),
        ));
    }

    // Default: run the scan to completion and answer with the full report.
    let report = tokio::task::spawn_blocking(move || scan.run(&request, |_| {}))
        .await
        .map_err(|e| ApiError::internal(format!("ingest task panicked: {e}")))?
        .map_err(ApiError::from)?;

    // A scan that actually (re)ingested a version changed the definition store the
    // public snapshot's case metadata is exported from, so queue a refresh (see
    // `scan_changed_store`). This is what makes repopulating an emptied store — the
    // ephemeral `/state` volume's self-heal after a reschedule, or a manual
    // `tcab ingest --env` — republish a corrected snapshot instead of leaving the
    // gallery frozen on whatever was built while the store was momentarily empty.
    if scan_changed_store(&report) {
        state.publisher.queue_refresh();
        // ...and the gg document index holds a `score` per run that is a fraction of the
        // case manifest's checklist weights. A re-ingest can change those weights (or an
        // erratum's `exclude_from_score`) without touching a single `run` row, which is
        // precisely the change the index's per-id freshness rule cannot observe.
        state.gg_docs.invalidate_all().await;
    }

    // A backend that started on an empty store, or one written in another record
    // format, is held out of its Service until one of these scans leaves it servable
    // (see `crate::readiness`). Gate on what the store now holds rather than on the
    // scan merely succeeding: a scan against an empty or broken checkout returns Ok
    // having ingested nothing, and must not flip an still-empty backend Ready.
    if state.store.is_servable() {
        state.ready.mark_store_populated();
    }

    Ok(Json(ingest_response(report)).into_response())
}

/// Force a `changed` scan against a backend whose store is not ready.
///
/// `store_ready` is what `/healthz` reports as `storeReady`. While it is false no
/// stored record is servable, so there is nothing a `changed` scan can safely leave
/// in place and every target is ingested.
fn promote_for_store_readiness(mut request: IngestRequest, store_ready: bool) -> IngestRequest {
    if request.mode == IngestMode::Changed && !store_ready {
        request.force = true;
    }
    request
}

/// Whether an ingest scan actually (re)ingested any version, versus a no-op scan
/// that found every version already present and unchanged. A scan that copied or
/// re-rendered at least one version has changed the definition store, so the public
/// snapshot's case metadata — a case's name, specs, prompt, review items, and the
/// very presence of its `cases/<slug>/<version>.json` file — may now differ and
/// must be re-exported.
///
/// This is deliberately quiet on a no-op scan (every version unchanged), so the
/// non-forced periodic ingest does not fire a gallery rebuild every cycle; only a
/// scan that moved something republishes. A forced re-ingest re-writes every version
/// (all `ingested`), so it always refreshes — which is exactly what an operator
/// running `tcab ingest --env` or publishing from The Spec Cabinet to push catalog
/// edits to the site wants.
fn scan_changed_store(report: &IngestReport) -> bool {
    // A changed test-case-group set counts too: the snapshot exports the set as
    // its own object, so a group-only edit must republish even though no version
    // moved. (The gg-index invalidation this gates alongside is superfluous on a
    // group-only change but merely re-parses once, so the two triggers stay one.)
    report.test_case_versions.iter().any(|v| v.ingested) || report.test_case_groups_changed
}

/// Reconcile `case_reference_build` from the committed reference-builds lockfile to
/// this backend's environment, queuing a snapshot refresh when the set changes.
///
/// This is the ingest half of the reference-implementation **pull** model: rather
/// than a client pushing a URL to a (private, VPN-only) backend, `tcab
/// publish-reference` commits each deployed URL into
/// `test-cases/reference-builds.lock.json`, and the backend — which git-fetches its
/// checkout before ingesting — reads the entries for its own `TCAB_ENV` and makes
/// the table match them. This runs on the same pull path
/// (`tcab ingest --env`, or a publish from The Spec Cabinet) that refreshes
/// definitions.
///
/// A **missing** lockfile means it has not been committed yet, so the table is left
/// untouched (never wiped). An env **absent** from an existing lockfile likewise
/// leaves the table alone; a present-but-empty env reconciles to empty.
async fn reconcile_reference_builds(state: &AppState) -> Result<(), ApiError> {
    let path = state
        .config
        .checkout
        .join("test-cases")
        .join(REFERENCE_LOCK_FILENAME);
    let Some(lock) = ReferenceLock::load(&path)
        .map_err(|e| ApiError::internal(format!("reading {}: {e}", path.display())))?
    else {
        return Ok(());
    };
    let Some(desired) = lock.entries_for_env(&state.config.env) else {
        return Ok(());
    };
    let now = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| ApiError::internal(format!("formatting timestamp: {e}")))?;
    let changed = state
        .db
        .sync_reference_builds(&desired, &now)
        .await
        .map_err(ApiError::from)?;
    if changed {
        // The public snapshot folds each variant's reference-build URL onto its case
        // metadata, so a changed set must be re-exported.
        state.publisher.queue_refresh();
    }
    Ok(())
}

/// Reconcile `case_reference_sheet` from the snapshot bucket to the frames actually
/// published there, queuing a snapshot refresh when the set changes.
///
/// The asset-generation half of the reference **pull** model, and the one place it
/// diverges from [`reconcile_reference_builds`]. A deployed reference *build* has an
/// opaque URL only Cloudflare knows, so it must be committed into a lockfile for the
/// backend to learn it. A published reference *sheet* has no such secret: every
/// frame's key is derived from `(slug, version, variant, index)` by
/// [`test_cabinet_core::asset_reference`], so the bucket itself is the register of
/// what exists, and listing it is both simpler and more truthful than a lockfile —
/// it cannot claim a frame that was never uploaded or has since been deleted.
///
/// **When R2 is not configured** (the single-box dev setup) this returns having
/// touched nothing. That is deliberate and mirrors how the lockfile path treats a
/// *missing* lockfile: an unconfigured backend has no knowledge of the published set,
/// which is a different fact from knowing the set is empty, and reconciling an
/// unknown to empty would silently wipe rows a real deployment's data shares. Only a
/// successful listing — the analogue of a lockfile that is present but lists nothing
/// for this env — is allowed to reconcile the table to empty.
///
/// Failures are logged and swallowed rather than returned. Ingest's primary job is to
/// pick up the freshly-fetched git checkout; a transient R2 list error (or an
/// unformattable timestamp) must not fail the whole scan and leave the catalog stale.
/// The next ingest reconciles again.
async fn reconcile_reference_sheets(state: &AppState) {
    // No bucket configured: we cannot know the published set, so leave the table as
    // it is. See the doc comment — this is not the same as reconciling to empty.
    let Some(r2_config) = state.config.r2.clone() else {
        return;
    };
    let r2 = R2Client::new(r2_config);

    let keys = match r2.list_keys(REFERENCE_MEDIA_PREFIX).await {
        Ok(keys) => keys,
        Err(err) => {
            tracing::warn!(
                "listing published asset references failed ({err}); leaving the \
                 reference-sheet table unchanged"
            );
            return;
        }
    };

    // Group the frame images by the triple they belong to. Only image keys parse —
    // the action logs published beside them (and anything else under the prefix)
    // yield `None` — because an image is what proves a frame is viewable.
    let mut by_variant: std::collections::HashMap<(String, String, String), Vec<u32>> =
        std::collections::HashMap::new();
    for key in &keys {
        if let Some(parsed) = parse_reference_image_key(key) {
            by_variant
                .entry((parsed.slug, parsed.version, parsed.variant))
                .or_default()
                .push(parsed.index);
        }
    }
    // The store canonicalizes (sorts and de-duplicates) each frame list on the way
    // in, so the arbitrary order R2 lists keys in cannot make an unchanged set look
    // changed.
    let desired: Vec<ReferenceSheetEntry> = by_variant
        .into_iter()
        .map(|((slug, version, variant), frames)| ReferenceSheetEntry {
            slug,
            version,
            variant,
            frames,
        })
        .collect();

    let now = match OffsetDateTime::now_utc().format(&Rfc3339) {
        Ok(now) => now,
        Err(err) => {
            tracing::warn!(
                "formatting timestamp failed ({err}); leaving the reference-sheet \
                 table unchanged"
            );
            return;
        }
    };
    match state.db.sync_reference_sheets(&desired, &now).await {
        // The public snapshot folds each variant's published frame list onto its case
        // metadata, so a changed set must be re-exported.
        Ok(true) => {
            state.publisher.queue_refresh();
        }
        Ok(false) => {}
        Err(err) => tracing::warn!("reconciling the reference-sheet table failed ({err})"),
    }
}

/// What one ingest scan runs against, taken from the backend's state before the
/// scan moves onto a blocking thread.
struct Scan {
    /// The checkout the scan reads (`TCAB_BACKEND_CHECKOUT`).
    checkout: PathBuf,
    /// The definition store the scan writes.
    store: DefinitionStore,
    /// Whether the suites checkout's `.previews/` is read
    /// (`TCAB_BACKEND_INGEST_PREVIEWS`).
    previews: bool,
    /// The `(slug, version)` pairs a stored run references, which a whole-catalog
    /// prune keeps.
    protected: std::collections::HashSet<(String, String)>,
}

impl Scan {
    /// Run the scan, reporting each version to `on_event` as it completes.
    fn run(
        self,
        request: &IngestRequest,
        on_event: impl FnMut(IngestEvent),
    ) -> crate::error::Result<IngestReport> {
        Ingestor::new(&self.checkout, &self.store)
            .with_protected_cases(self.protected)
            .with_previews(self.previews)
            .scan_with_progress(request, on_event)
    }
}

/// True when the request asks for the streamed NDJSON progress feed.
fn wants_ndjson(headers: &HeaderMap) -> bool {
    headers
        .get(header::ACCEPT)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|accept| accept.contains("application/x-ndjson"))
}

/// Run the scan on a blocking thread, streaming an NDJSON progress line per version
/// as it completes (plus a closing `done`, or an `error` line if the scan aborts).
/// The scan outpaces no realistic consumer here, so an unbounded channel buffers the
/// handful of small lines without backpressure; the response ends when the blocking
/// task drops its sender.
fn ingest_streaming(
    scan: Scan,
    request: IngestRequest,
    publisher: Publisher,
    gg_docs: crate::gg_docs::GgDocIndex,
    readiness: Readiness,
) -> Response {
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Bytes>();

    tokio::task::spawn_blocking(move || {
        let store = scan.store.clone();
        let result = scan.run(&request, |event| {
            let _ = tx.send(encode_event(&progress_line(event)));
        });
        // A single closing line conveys the outcome in-band: the stream has already
        // sent a 200, so a late failure cannot become an HTTP error code.
        let closing = match result {
            Ok(report) => {
                // Same as the non-streaming path: a scan that changed the definition
                // store must re-export the snapshot's case metadata (see
                // `scan_changed_store`).
                if scan_changed_store(&report) {
                    publisher.queue_refresh();
                    // ...and, also as the non-streaming path, drop the gg document
                    // index: a manifest's checklist weights are an input to every gg
                    // run's `score` and are invisible to that index's per-run
                    // freshness rule. Blocking on it rather than spawning it keeps the
                    // invalidation ordered *before* the `done` line, so a client that
                    // queries the moment ingest reports finished cannot be served the
                    // pre-ingest scores.
                    tokio::runtime::Handle::current().block_on(gg_docs.invalidate_all());
                }
                // …and, as on the non-streaming path, a scan that leaves the store
                // servable releases the readiness latch.
                if store.is_servable() {
                    readiness.mark_store_populated();
                }
                done_line(&report)
            }
            Err(err) => IngestProgress::Error {
                message: err.to_string(),
            },
        };
        let _ = tx.send(encode_event(&closing));
    });

    let stream = stream::unfold(rx, |mut rx| async move {
        rx.recv()
            .await
            .map(|line| (Ok::<Bytes, Infallible>(line), rx))
    });

    (
        [
            (header::CONTENT_TYPE, "application/x-ndjson"),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        Body::from_stream(stream),
    )
        .into_response()
}

/// Encode one progress event as a `\n`-terminated NDJSON line. The fields are
/// JSON-safe scalars, so a defensive empty line stands in for the impossible
/// serialization error rather than aborting the stream.
fn encode_event(event: &IngestProgress) -> Bytes {
    match serde_json::to_string(event) {
        Ok(mut line) => {
            line.push('\n');
            Bytes::from(line)
        }
        Err(_) => Bytes::from_static(b"\n"),
    }
}

// --- Wire shapes (§1.1) -----------------------------------------------------
//
// The request body, the report and the feed lines are the ingest API's contract,
// `test_cabinet_contracts::ingest` (re-exported by `test_cabinet_core::backend_client`),
// which the client writes and reads with too. What the scan's own report comes to on
// the wire is decided here.

/// The report a finished scan answers with when the feed was not asked for.
fn ingest_response(report: IngestReport) -> IngestResponse {
    IngestResponse {
        test_case_versions: report
            .test_case_versions
            .into_iter()
            .map(|v| IngestResponseVersion {
                slug: v.slug,
                version: v.version,
                ingested: v.ingested,
                rendered_references: v.rendered_references,
                reason: v.reason.map(|reason| reason.as_str().to_owned()),
                problem: v.problem,
            })
            .collect(),
        test_suites: report
            .suite_versions
            .into_iter()
            .map(|suite| IngestResponseSuite {
                slug: suite.slug,
                version: suite.version,
                ingested: suite.ingested,
                reason: suite.reason.map(|reason| reason.as_str().to_owned()),
                problem: suite.problem,
            })
            .collect(),
    }
}

/// The closing summary for a successful scan: how many versions were (re)ingested
/// vs. skipped, as unchanged or for a problem. A refused suite version is one
/// `version` line of the feed, so it counts here too.
fn done_line(report: &IngestReport) -> IngestProgress {
    let refused = report
        .suite_versions
        .iter()
        .filter(|suite| suite.problem.is_some())
        .count();
    let total = report.test_case_versions.len() + refused;
    let ingested = report
        .test_case_versions
        .iter()
        .filter(|v| v.ingested)
        .count();
    IngestProgress::Done {
        total,
        ingested,
        skipped: total - ingested,
    }
}

/// The feed line one scan event is reported as.
fn progress_line(event: IngestEvent<'_>) -> IngestProgress {
    match event {
        IngestEvent::Start { total } => IngestProgress::Start { total },
        IngestEvent::Version {
            index,
            total,
            version,
        } => IngestProgress::Version {
            index,
            total,
            slug: version.slug.clone(),
            version: version.version.clone(),
            ingested: version.ingested,
            rendered_references: version.rendered_references,
            reason: version.reason.map(|reason| reason.as_str().to_owned()),
            problem: version.problem.clone(),
        },
    }
}

#[cfg(test)]
#[path = "ingest_api.test.rs"]
mod tests;
