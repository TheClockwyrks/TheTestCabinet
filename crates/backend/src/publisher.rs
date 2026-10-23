//! The synchronized publish path: coalesced snapshot regeneration + upload
//! (§1.4, §3 and the backend overview's "Publishing and
//! Synchronization").
//!
//! Being a single central entity is the point: the backend serializes publishes
//! so two operators cannot race on the shared snapshot state, and it **coalesces**
//! a burst of publishes into one regeneration, one upload, and one site rebuild.
//!
//! The coalescing is a debounce: whatever requests a refresh first marks the
//! snapshot state dirty in the database, then pings the refresher; the refresher
//! waits the coalescing window, draining any further pings that arrive during it,
//! then regenerates the **full** published set (idempotent — re-running converges
//! on the same snapshot), uploads it atomically, and fires the hook. A forced
//! refresh (`POST /snapshot/refresh`) bypasses the debounce and runs immediately.
//!
//! The queue is durable because the mark is written before the ping. A backend
//! that stops inside the coalescing window, or while a refresh runs, starts with
//! the flag set and runs the refresh then. A refresh clears the flag only when no
//! mark landed after it read the state (the state's generation is unchanged), so a
//! request that arrives while a refresh is already regenerating is not lost.
//!
//! Regenerating the full set is a statement about *correctness*, not about work: the
//! run and case media, and each run's own JSON document, are content-addressed under
//! snapshot-independent prefixes, so a refresh lists what the bucket already holds and
//! uploads only what genuinely differs. A publish therefore costs roughly the runs
//! that changed rather than the runs that exist — see
//! [`crate::snapshot::RUN_DOCUMENT_PREFIX`].

use std::sync::Arc;
use std::time::Duration;

use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use tokio::sync::{Notify, mpsc};
use tracing::Instrument;

use crate::artifacts::ArtifactsClient;
use crate::db::Db;
use crate::error::{BackendError, Result};
use crate::r2::R2Client;
use crate::snapshot::SnapshotBuilder;
use crate::store::DefinitionStore;

/// The outcome of a forced refresh (`POST /snapshot/refresh`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RefreshOutcome {
    /// Runs in the regenerated snapshot.
    pub run_count: usize,
}

/// Drives snapshot regeneration. Cloneable (it is `Arc`-backed) so handlers and
/// the background refresher share one instance.
#[derive(Clone)]
pub struct Publisher {
    inner: Arc<PublisherInner>,
}

struct PublisherInner {
    db: Arc<Db>,
    store: DefinitionStore,
    r2: Option<R2Client>,
    http: reqwest::Client,
    /// The artifact service's **in-cluster** base URL
    /// ([`Config::artifacts_internal_url`](crate::config::Config::artifacts_internal_url)),
    /// through which the snapshot builder publishes each run's media and reads its
    /// code-analysis document. `None` in a dev/single-box setup with no separate
    /// artifact service, and in any deployment that supplies no in-cluster URL.
    artifacts_url: Option<String>,
    /// The shared service token (`TCAB_BACKEND_SERVICE_TOKEN`) the snapshot builder
    /// presents on its artifact-service calls.
    artifacts_service_token: Option<String>,
    coalesce: Duration,
    /// How long a superseded snapshot generation is kept before the post-upload
    /// prune removes it (see [`prune_stale_snapshots`]).
    snapshot_retention: Duration,
    /// Pinged when a publish marks the store dirty, waking the debounce loop.
    wake: Notify,
    /// How many refreshes the background loop has finished (the startup refresh included), so a
    /// test can wait for the loop to act rather than poll the database on a timer.
    #[cfg(test)]
    refreshes: tokio::sync::watch::Sender<u64>,
}

/// The timing knobs a publisher is built with, grouped so the two `Duration`s
/// cannot be transposed at the call site (they are adjacent, same-typed and mean
/// very different things) and so adding a third does not widen
/// [`Publisher::new`] again.
#[derive(Debug, Clone, Copy)]
pub struct PublisherTiming {
    /// The sliding debounce a burst of publishes is coalesced over
    /// (`TCAB_SNAPSHOT_COALESCE_MS`).
    pub coalesce: Duration,
    /// How long a superseded snapshot generation is kept before the post-upload
    /// prune removes it (`TCAB_SNAPSHOT_RETENTION_HOURS`).
    pub snapshot_retention: Duration,
}

impl Publisher {
    /// Build a publisher. `r2` is `None` in the dev mode where the R2 credentials
    /// were not configured: the snapshot is still regenerated into SQLite-derived
    /// form and the dirty flag cleared, but no upload happens.
    ///
    /// `artifacts_url` is the artifact service's **in-cluster** base URL, the one the
    /// backend itself can reach — not the address advertised to consoles — and
    /// `artifacts_service_token` the shared service token presented on its calls.
    pub fn new(
        db: Arc<Db>,
        store: DefinitionStore,
        r2: Option<R2Client>,
        artifacts_url: Option<String>,
        artifacts_service_token: Option<String>,
        timing: PublisherTiming,
    ) -> Self {
        Self {
            inner: Arc::new(PublisherInner {
                db,
                store,
                r2,
                http: reqwest::Client::new(),
                artifacts_url,
                artifacts_service_token,
                coalesce: timing.coalesce,
                snapshot_retention: timing.snapshot_retention,
                wake: Notify::new(),
                #[cfg(test)]
                refreshes: tokio::sync::watch::channel(0).0,
            }),
        }
    }

    /// Queue a refresh: mark the snapshot state dirty in the database, then wake
    /// the refresher. The regeneration itself is coalesced and run on the
    /// background task. The mark is written first so the request survives a
    /// restart: a backend that starts with the flag set runs the refresh.
    ///
    /// Returns whether a refresh was queued: `false` only when the mark could not
    /// be written (logged), in which case the refresher is not woken either.
    pub async fn queue_refresh(&self) -> bool {
        if let Err(err) = self.inner.db.mark_dirty().await {
            tracing::error!("marking the snapshot dirty failed; refresh not queued: {err}");
            return false;
        }
        self.inner.wake.notify_one();
        true
    }

    /// [`queue_refresh`](Self::queue_refresh) from a synchronous callback (a list
    /// price fill or a price refresh's change report, which fire where nothing can
    /// be awaited): the queuing runs on its own task, which still writes the dirty
    /// mark before it wakes the refresher. Must be called within a Tokio runtime.
    pub fn queue_refresh_detached(&self) {
        let publisher = self.clone();
        tokio::spawn(async move {
            publisher.queue_refresh().await;
        });
    }

    /// Spawn the background debounce loop. It runs until the returned shutdown
    /// channel is dropped or signaled. On startup it checks the persisted dirty
    /// flag so a refresh pending at the last restart is not lost.
    pub fn spawn(&self) -> RefresherHandle {
        let inner = Arc::clone(&self.inner);
        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
        // Give the detached coalescing task its own span. It is the root of every
        // background refresh's trace (a refresh is not tied to one request), so
        // `run_refresh`'s spans nest under it rather than floating free.
        let task_span = tracing::info_span!("publisher.refresher");
        #[cfg(test)]
        let refreshes = inner.refreshes.subscribe();
        let handle = tokio::spawn(
            async move {
                // Recover a refresh that was pending when the process last stopped: one
                // queued (its dirty mark written) but not yet run, or one that was running.
                if matches!(inner.db.snapshot_state().await, Ok(state) if state.dirty) {
                    if let Err(err) = run_refresh(&inner).await {
                        tracing::error!("startup snapshot refresh failed: {err}");
                    }
                    #[cfg(test)]
                    inner.refreshes.send_modify(|finished| *finished += 1);
                }
                loop {
                    tokio::select! {
                        _ = inner.wake.notified() => {
                            // Debounce: wait the coalescing window, draining further
                            // wakes that arrive during it into this one refresh. A
                            // shutdown inside the window leaves the refresh to the next
                            // start: its dirty mark is already written.
                            loop {
                                tokio::select! {
                                    _ = tokio::time::sleep(inner.coalesce) => break,
                                    _ = inner.wake.notified() => continue,
                                    _ = shutdown_rx.recv() => return,
                                }
                            }
                            if let Err(err) = run_refresh(&inner).await {
                                tracing::error!("coalesced snapshot refresh failed: {err}");
                            }
                            #[cfg(test)]
                            inner.refreshes.send_modify(|finished| *finished += 1);
                        }
                        _ = shutdown_rx.recv() => break,
                    }
                }
            }
            .instrument(task_span),
        );
        RefresherHandle {
            _shutdown: shutdown_tx,
            handle,
            #[cfg(test)]
            refreshes,
        }
    }

    /// A receiver that changes each time the background loop finishes a coalesced refresh.
    #[cfg(test)]
    pub(crate) fn refreshes(&self) -> tokio::sync::watch::Receiver<u64> {
        self.inner.refreshes.subscribe()
    }

    /// Force an immediate refresh, bypassing the debounce (operator recovery via
    /// `POST /snapshot/refresh`). Regenerates, uploads, and fires the hook now.
    pub async fn refresh_now(&self) -> Result<RefreshOutcome> {
        run_refresh(&self.inner).await
    }
}

/// A handle keeping the background refresher alive; dropping it stops the loop.
pub struct RefresherHandle {
    _shutdown: mpsc::Sender<()>,
    handle: tokio::task::JoinHandle<()>,
    /// Subscribed before the loop started, so it sees every refresh the loop
    /// finishes, the startup refresh included.
    #[cfg(test)]
    refreshes: tokio::sync::watch::Receiver<u64>,
}

impl RefresherHandle {
    /// A receiver that changes each time this loop finishes a refresh, from its
    /// startup refresh on.
    #[cfg(test)]
    pub(crate) fn refreshes(&self) -> tokio::sync::watch::Receiver<u64> {
        self.refreshes.clone()
    }

    /// Await the refresher task (used in graceful shutdown / tests).
    ///
    /// Drops the shutdown sender first so the loop's `shutdown_rx.recv()` arm
    /// resolves and the task breaks; awaiting the handle while still holding the
    /// sender would deadlock, since nothing would ever signal the loop to stop.
    pub async fn join(self) {
        let Self {
            _shutdown, handle, ..
        } = self;
        drop(_shutdown);
        let _ = handle.await;
    }
}

/// Regenerate the full snapshot, upload it (when R2 is configured), and clear
/// the dirty flag unless a mark landed while it ran. This
/// is the one place the snapshot is produced; both the debounce loop and the
/// forced path call it.
#[tracing::instrument(
    name = "snapshot.run_refresh",
    skip(inner),
    fields(run_count = tracing::field::Empty),
    err,
)]
async fn run_refresh(inner: &PublisherInner) -> Result<RefreshOutcome> {
    // Read the state before anything is regenerated: the dirty flag is cleared at the
    // end only if no mark landed after this read.
    let generation = inner.db.snapshot_state().await?.generation;
    let runs = inner.db.all_published().await?;
    let cases = load_case_manifests(&inner.store)?;
    let generated_at = OffsetDateTime::now_utc();

    // Compose the model catalog for the public site: curated configs merged with
    // the models the **published** runs reference (the public derived set), and
    // the observed catalog facts. The same composition the `GET /models` read
    // uses, so the console and the site show one catalog.
    let configs = inner.db.list_model_configs().await?;
    let prices = inner.db.all_model_prices().await?;
    let run_models = inner.db.distinct_published_run_models().await?;
    let models = crate::api::compose_catalog(&configs, &prices, &run_models);

    // The reference-implementation URLs live in the `case_reference_build` table
    // (written out-of-band by `tcab publish-reference`), not the definition store,
    // so read them per ingested case and hand the builder a `(slug, version)` →
    // (variant → URL) map to fold onto each case's variants. A case with no recorded
    // reference build simply contributes an empty inner map.
    // The published asset-reference frame sets live in the `case_reference_sheet`
    // table (reconciled at ingest from the bucket `tcab publish-reference` uploads
    // to), likewise not in the definition store. Read alongside the build URLs — an
    // asset case contributes sheets where a playable case contributes a build, and a
    // case with neither contributes nothing to either map.
    let mut reference_builds = std::collections::HashMap::new();
    let mut reference_sheets = std::collections::HashMap::new();
    for case in &cases {
        let builds = inner
            .db
            .reference_builds_for_version(&case.slug, &case.version)
            .await?;
        if !builds.is_empty() {
            reference_builds.insert((case.slug.clone(), case.version.clone()), builds);
        }
        let sheets = inner
            .db
            .reference_sheets_for_version(&case.slug, &case.version)
            .await?;
        if !sheets.is_empty() {
            reference_sheets.insert((case.slug.clone(), case.version.clone()), sheets);
        }
    }

    // Media that lives outside any one snapshot's prefix: a published run's proof and
    // asset files (`media/runs/<id>/…`, immutable per run) and a case version's
    // rendered/committed baselines (`media/cases/<slug>/<version>/…`, content-addressed).
    // Learn what is already uploaded so the builder references those objects instead of
    // re-reading, re-transcoding and re-uploading them. The whole `media/` prefix is
    // listed in one pass — it also covers the reference sheets `tcab publish-reference`
    // writes, which are simply never looked up here — and the `files/` prefix with it,
    // covering a case version's content-addressed starter-workspace files
    // (`files/cases/<slug>/<version>/…`).
    //
    // Only when R2 is configured — the dev path has no bucket to list, and re-uploads
    // nothing anyway. A list failure is not fatal: fall back to an empty set (re-export
    // everything) rather than abort the whole refresh, so a transient list error
    // degrades to the old behavior.
    let existing_media = match &inner.r2 {
        Some(r2) => {
            let mut keys = std::collections::HashSet::new();
            for prefix in ["media/", "files/"] {
                match r2.list_keys(prefix).await {
                    Ok(listed) => keys.extend(listed),
                    Err(err) => {
                        tracing::warn!(
                            "listing existing snapshot `{prefix}` objects failed ({err}); \
                             re-exporting everything under it"
                        );
                    }
                }
            }
            keys
        }
        None => std::collections::HashSet::new(),
    };

    // The per-run **documents**, on the same principle and for the bigger win: they
    // are content-addressed under `documents/runs/<id>/<digest>.json`, so learning
    // which are already uploaded is what stops a refresh from re-PUTting one object
    // per published run every time anything at all is published.
    //
    // As with media, a list failure is not fatal: an empty set re-uploads every
    // document (landing on exactly the keys the next refresh will skip) rather than
    // aborting the refresh.
    let existing_documents = match &inner.r2 {
        Some(r2) => match r2.list_keys(crate::snapshot::RUN_DOCUMENT_PREFIX).await {
            Ok(keys) => keys.into_iter().collect(),
            Err(err) => {
                tracing::warn!(
                    "listing existing run documents failed ({err}); re-exporting every run document"
                );
                std::collections::HashSet::new()
            }
        },
        None => std::collections::HashSet::new(),
    };

    // The published harness comparisons, each assembled to its full read model over
    // the whole experiment's runs (not only the published ones) with the same
    // computation the internal `/comparisons` API uses, so the public numbers match
    // the console's exactly.
    let mut comparisons = Vec::new();
    for stored in inner.db.all_published_comparisons().await? {
        comparisons
            .push(crate::api::assemble_comparison(inner.db.as_ref(), &inner.store, stored).await?);
    }

    // The gg document corpus the public Discover surface evaluates in the browser.
    // Decoupled from publication (a document carries configuration ids and outcome
    // numbers, so gating it on publication would export almost nothing), filtered
    // against the experimental catalog gate, and field-redacted — all three composed in
    // `gg_docs::public_documents`, which is the only door the site's gg data comes
    // through. **Replay records are never exported**; nothing here loads one.
    let gg_documents = crate::gg_docs::public_documents(inner.db.as_ref(), &inner.store).await?;

    // The ingested test-case-group set, read from the store slot the whole-catalog
    // ingest reconciles and mapped to the same wire shape `GET /test-case-groups`
    // serves — so the public home page and the consoles render one set.
    let test_case_groups = inner
        .store
        .read_test_case_groups()?
        .into_iter()
        .map(crate::api::test_case_group_out)
        .collect();

    let snapshot = SnapshotBuilder::new(runs, cases, inner.store.clone())
        .with_artifacts(ArtifactsClient::from_config(
            inner.http.clone(),
            inner.artifacts_url.as_deref(),
            inner.artifacts_service_token.as_deref(),
        ))
        .with_models(models)
        .with_reference_builds(reference_builds)
        .with_reference_sheets(reference_sheets)
        .with_existing_media(existing_media)
        .with_existing_documents(existing_documents)
        .with_comparisons(comparisons)
        .with_gg_documents(gg_documents)
        .with_test_case_groups(test_case_groups)
        .build(generated_at)
        .await?;
    let run_count = snapshot.run_count;
    tracing::Span::current().record("run_count", run_count);

    match &inner.r2 {
        Some(r2) => {
            crate::snapshot::upload_snapshot(&snapshot, r2).await?;
            // Only after the atomic `index.json` cut-over: until it lands, the
            // previous generation is still the live one and must not be touched.
            prune_stale_snapshots(r2, &snapshot.snapshot_id, inner.snapshot_retention).await;
        }
        None => {
            // Dev mode: no R2 credentials. The snapshot was still regenerated
            // (proving it is well-formed) but is not uploaded.
            tracing::warn!(
                "snapshot regenerated ({run_count} runs) but R2 is not configured; skipping upload"
            );
        }
    }

    let uploaded_at = generated_at
        .format(&Rfc3339)
        .map_err(|e| BackendError::Snapshot(format!("formatting uploaded_at: {e}")))?;
    inner
        .db
        .mark_uploaded(&uploaded_at, run_count as i64, generation)
        .await?;

    tracing::info!(run_count, "snapshot refresh complete");

    Ok(RefreshOutcome { run_count })
}

/// Delete the snapshot generations nothing points at any more, keeping the one just
/// uploaded and anything inside the retention window (see
/// [`crate::snapshot::stale_generation_keys`] for the exact rule).
///
/// Every refresh writes a whole new generation, so without this the bucket grows by a
/// generation per publish and never shrinks — which is precisely how it reached ~7.8 GB
/// of which 96% was unreachable.
///
/// **Best-effort by design.** A prune failure must never fail a refresh: the snapshot
/// is already uploaded and live at this point, and the only consequence of a skipped
/// prune is that the next refresh has more to clean up. Every path therefore logs and
/// returns rather than propagating.
#[tracing::instrument(
    name = "snapshot.prune",
    skip(r2),
    fields(pruned_keys = tracing::field::Empty),
)]
async fn prune_stale_snapshots(r2: &R2Client, live_snapshot_id: &str, retention: Duration) {
    let keys = match r2.list_keys(crate::snapshot::SNAPSHOT_PREFIX).await {
        Ok(keys) => keys,
        Err(err) => {
            tracing::warn!("listing snapshot generations failed ({err}); skipping the prune");
            return;
        }
    };
    let stale = crate::snapshot::stale_generation_keys(
        &keys,
        live_snapshot_id,
        OffsetDateTime::now_utc(),
        retention,
    );
    if stale.is_empty() {
        return;
    }
    tracing::Span::current().record("pruned_keys", stale.len());
    match r2.delete_objects(&stale).await {
        Ok(deleted) => tracing::info!(
            deleted,
            live = %live_snapshot_id,
            "pruned superseded snapshot generations"
        ),
        Err(err) => tracing::warn!(
            "pruning superseded snapshot generations failed ({err}); \
             the next refresh will retry"
        ),
    }
}

/// Load every ingested case version's stored manifest, for the snapshot's case
/// metadata files and the denormalized card names.
fn load_case_manifests(store: &DefinitionStore) -> Result<Vec<crate::store::StoredManifest>> {
    let mut manifests = Vec::new();
    for (slug, versions) in store.list_cases()? {
        for version in versions {
            manifests.push(store.read_manifest(&slug, &version)?);
        }
    }
    Ok(manifests)
}

#[cfg(test)]
#[path = "publisher.test.rs"]
mod tests;
