//! The synchronized publish path: coalesced regeneration of the public dataset
//! and its write through the artifacts service (the backend overview's "Review
//! and publish" and "The public dataset", and the [Public Snapshot] page).
//!
//! Being a single central entity is the point: the backend serializes publishes
//! so two operators cannot race on the shared snapshot state, and it **coalesces**
//! a burst of publishes into one regeneration and one rewrite of the index
//! objects. A publish is an upload: no site is rebuilt and nothing is deployed,
//! because the gallery reads the index objects at runtime.
//!
//! The coalescing is a debounce: whatever requests a refresh first marks the
//! snapshot state dirty in the database, then pings the refresher; the refresher
//! waits the coalescing window, draining any further pings that arrive during it,
//! then regenerates the **full** published set (idempotent — re-running converges
//! on the same dataset) and writes it with the `index.json` pointer last. A forced
//! refresh (`POST /snapshot/refresh`) bypasses the debounce and runs immediately.
//!
//! The queue is durable because the mark is written before the ping. A backend
//! that stops inside the coalescing window, or while a refresh runs, starts with
//! the flag set and runs the refresh then. A refresh clears the flag only when no
//! mark landed after it read the state (the state's generation is unchanged), so a
//! request that arrives while a refresh is already regenerating is not lost.
//!
//! A refresh writes in the order the results page's "Publish" states, each phase
//! concurrent within itself, and any failure before the pointer leaves the previous
//! generation live:
//!
//! 1. every published run's short code object, `codes/<code>`, that the bucket
//!    does not hold yet — written once and never overwritten;
//! 2. the artifacts service's copy of each newly published run's media
//!    (`POST /runs/{id}/publish-media`), whose answer is stored per run;
//! 3. the content-addressed objects the bucket does not hold: run documents, case
//!    media and files, code-analysis documents;
//! 4. the new generation's index objects under `snapshots/<snapshot-id>/`;
//! 5. `index.json`, the atomic cut-over;
//!
//! and then, best-effort, prunes the superseded generations.
//!
//! Regenerating the full set is a statement about *correctness*, not about work:
//! everything but the index objects is content-addressed under a
//! snapshot-independent prefix, so a refresh lists what the bucket already holds
//! and writes only what genuinely differs. A publish therefore costs roughly the
//! runs that changed rather than the runs that exist — see
//! [`crate::snapshot::RUN_DOCUMENT_PREFIX`].
//!
//! On PostgreSQL more than one replica shares the database, and each runs this
//! loop. A refresh therefore holds the snapshot's database lock while it runs
//! ([`crate::db::DbLockKey::Snapshot`]), so two replicas never write the dataset at
//! once. A coalesced or startup refresh waits for the lock and then runs only if
//! the snapshot is still dirty, since the refresh it waited behind may have covered
//! its mark; a forced refresh waits and always runs. A queued refresh is announced
//! through the [replica bus](crate::bus), which wakes every replica's loop, so a
//! replica that stops inside the coalescing window leaves the refresh to another.
//!
//! A replica whose definition store has not been populated yet regenerates nothing,
//! since the dataset's case metadata is read from it: its coalesced refresh is left
//! dirty for a replica that can serve, or for the refresh the ingest that populates
//! it queues, and its forced refresh is refused.
//!
//! [Public Snapshot]: https://docs.testcabinet.ai/components/backend/snapshot/

use std::sync::Arc;
use std::time::Duration;

use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use tokio::sync::{Notify, mpsc};
use tracing::Instrument;

use crate::artifacts::{PublicDataset, PublishedMedia};
use crate::db::{Db, DbLockKey, StoredRun};
use crate::error::{BackendError, Result};
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
    /// The public dataset, written through the artifacts service's in-cluster URL
    /// with the shared service token. `None` when either is unset: the dataset is
    /// still composed (proving it well-formed) but nothing is written.
    public: Option<PublicDataset>,
    coalesce: Duration,
    /// How long a superseded snapshot generation is kept before the post-write
    /// prune removes it (see [`prune_stale_snapshots`]).
    snapshot_retention: Duration,
    /// Pinged when a publish marks the store dirty, waking the debounce loop.
    wake: Notify,
    /// Where a queued refresh is announced to the other replicas, when shared.
    announcer: std::sync::OnceLock<crate::bus::Announcer>,
    /// This backend's readiness, whose populated store a refresh waits on. Unset,
    /// the store is taken as populated.
    ready: std::sync::OnceLock<crate::readiness::Readiness>,
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
    /// Build a publisher. `public` is `None` when the artifacts service's URL or
    /// the service token is not configured: the snapshot is still regenerated and
    /// the dirty flag cleared, but nothing is written, no code or media is
    /// published and no code-analysis document is read.
    pub fn new(
        db: Arc<Db>,
        store: DefinitionStore,
        public: Option<PublicDataset>,
        timing: PublisherTiming,
    ) -> Self {
        Self {
            inner: Arc::new(PublisherInner {
                db,
                store,
                public,
                coalesce: timing.coalesce,
                snapshot_retention: timing.snapshot_retention,
                wake: Notify::new(),
                announcer: std::sync::OnceLock::new(),
                ready: std::sync::OnceLock::new(),
                #[cfg(test)]
                refreshes: tokio::sync::watch::channel(0).0,
            }),
        }
    }

    /// Announce every queued refresh through `announcer`, for a replica that shares
    /// its database with others. Set once, before the loop runs.
    pub fn share(&self, announcer: crate::bus::Announcer) {
        let _ = self.inner.announcer.set(announcer);
    }

    /// Regenerate nothing until `ready` reports a populated definition store. Set
    /// once, before the loop runs.
    pub fn hold_until_populated(&self, ready: crate::readiness::Readiness) {
        let _ = self.inner.ready.set(ready);
    }

    /// Wake this replica's refresher for a refresh another replica queued, whose
    /// dirty mark is already written.
    pub fn wake(&self) {
        self.inner.wake.notify_one();
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
        if let Some(announcer) = self.inner.announcer.get() {
            announcer.announce(crate::bus::Announcement::RefreshQueued);
        }
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
                    if let Err(err) = refresh_if_dirty(&inner).await {
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
                            if let Err(err) = refresh_if_dirty(&inner).await {
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
    /// `POST /snapshot/refresh`). Regenerates the dataset and writes it now.
    pub async fn refresh_now(&self) -> Result<RefreshOutcome> {
        if !store_populated(&self.inner) {
            return Err(BackendError::Snapshot(
                "this backend's definition store is not populated yet; refresh once it \
                 is ready"
                    .to_string(),
            ));
        }
        let lock = self.inner.db.lock(DbLockKey::Snapshot).await?;
        let outcome = run_refresh(&self.inner).await;
        lock.release().await;
        outcome
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

/// How many runs' media the artifacts service is asked to copy at once. Each copy
/// may transcode videos, which the service queues behind a single permit, so a
/// wide fan-out would only hold connections open.
const PUBLISH_MEDIA_CONCURRENCY: usize = 4;

/// How many superseded keys the prune deletes at once.
const PRUNE_CONCURRENCY: usize = 16;

/// The content-addressed prefixes a refresh lists to learn which objects the
/// bucket already holds: run documents, case media, a run's code-analysis
/// document (the one object the backend writes under `media/runs/`), and case
/// files.
const CONTENT_PREFIXES: [&str; 4] = ["documents/runs/", "media/cases/", "media/runs/", "files/"];

/// The prefix the short-code objects live under.
pub const CODE_PREFIX: &str = "codes/";

/// Whether the definition store the dataset's case metadata is read from has been
/// populated.
fn store_populated(inner: &PublisherInner) -> bool {
    inner
        .ready
        .get()
        .is_none_or(crate::readiness::Readiness::is_store_populated)
}

/// Take the snapshot's lock, waiting while another refresh holds it, and run a
/// refresh if the snapshot is still dirty once it is held. Answers `None` when the
/// refresh that held the lock already covered every mark.
async fn refresh_if_dirty(inner: &PublisherInner) -> Result<Option<RefreshOutcome>> {
    if !store_populated(inner) {
        tracing::info!("the definition store is not populated yet; leaving the refresh queued");
        return Ok(None);
    }
    let lock = inner.db.lock(DbLockKey::Snapshot).await?;
    let outcome = match inner.db.snapshot_state().await {
        Ok(state) if state.dirty => run_refresh(inner).await.map(Some),
        Ok(_) => Ok(None),
        Err(err) => Err(err),
    };
    lock.release().await;
    outcome
}

/// Regenerate the full dataset, write it through the artifacts service (when it is
/// configured), and clear the dirty flag unless a mark landed while it ran. This
/// is the one place the dataset is produced; both the debounce loop and the
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

    // Every published run holds a short code before anything is composed, so each
    // document and card carries one. A run published before codes existed is given
    // its code here, in publication order.
    let assigned = inner.db.assign_missing_codes().await?;
    if assigned > 0 {
        tracing::info!(assigned, "minted short codes for published runs");
    }

    let runs = inner.db.all_published().await?;

    // (1) `codes/<code>` for every published run whose object the bucket does not
    // hold. Before anything names the code, so a share link never resolves to
    // nothing once a card carries it.
    if let Some(public) = &inner.public {
        write_codes(public, &runs).await?;
    }

    // (2) The media of every published run the artifacts service has not yet copied:
    // its answer is stored, so each run's media is asked for once. Before the build,
    // since each run's document names the keys.
    let published_media = published_media(inner, &runs).await?;

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

    // What the bucket already holds under the content-addressed prefixes, so the
    // builder writes only what is missing. A listing failure is not fatal: it
    // degrades to an empty set (write everything under that prefix again, landing
    // on exactly the keys the next refresh skips) rather than aborting the refresh.
    let mut existing_media = std::collections::HashSet::new();
    let mut existing_documents = std::collections::HashSet::new();
    if let Some(public) = &inner.public {
        for prefix in CONTENT_PREFIXES {
            match public.list_keys(prefix).await {
                Ok(keys) if prefix.starts_with(crate::snapshot::RUN_DOCUMENT_PREFIX) => {
                    existing_documents.extend(keys);
                }
                Ok(keys) => existing_media.extend(keys),
                Err(err) => tracing::warn!(
                    "listing the public `{prefix}` objects failed ({err}); writing everything \
                     under it again"
                ),
            }
        }
    }

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
        .with_published_media(published_media)
        .with_artifacts(inner.public.as_ref().and_then(PublicDataset::client))
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

    match &inner.public {
        Some(public) => {
            // (3)-(5): the content-addressed objects, the generation, the pointer.
            crate::snapshot::write_snapshot(&snapshot, public).await?;
            // (6) Only after the atomic `index.json` cut-over: until it lands, the
            // previous generation is still the live one and must not be touched.
            prune_stale_snapshots(public, &snapshot.snapshot_id, inner.snapshot_retention).await;
        }
        None => {
            tracing::warn!(
                run_count,
                "public dataset regenerated but not written: the artifacts service is not configured"
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

/// Write `codes/<code>` for every published run that holds a code whose object the
/// bucket does not, the body the run id as `text/plain`.
///
/// A code's object is written once and never overwritten: a key the listing reports
/// is never written again, whatever it holds, and a write that failed leaves the
/// key absent, so the next refresh writes it. A failed listing or write fails the
/// refresh before anything names a code it would have written.
async fn write_codes(public: &PublicDataset, runs: &[StoredRun]) -> Result<()> {
    use futures_util::TryStreamExt;

    let existing: std::collections::HashSet<String> =
        public.list_keys(CODE_PREFIX).await?.into_iter().collect();
    let missing: Vec<(String, String)> = runs
        .iter()
        .filter_map(|run| {
            let code = run.links.code.as_deref()?;
            let key = format!("{CODE_PREFIX}{code}");
            (!existing.contains(&key)).then(|| (key, run.record.id.clone()))
        })
        .collect();
    if missing.is_empty() {
        return Ok(());
    }
    let written = missing.len();
    futures_util::stream::iter(missing.into_iter().map(Ok::<_, BackendError>))
        .try_for_each_concurrent(
            crate::snapshot::UPLOAD_CONCURRENCY,
            |(key, run_id): (String, String)| {
                let public = public.clone();
                async move {
                    public
                        .put(&key, run_id.into_bytes(), "text/plain; charset=utf-8", None)
                        .await
                        .map_err(BackendError::from)
                }
            },
        )
        .await?;
    tracing::info!(written, "wrote short-code objects");
    Ok(())
}

/// Each published run's media keys, keyed by run id: the stored answer of the
/// artifacts service's copy for a run that has one, and for every other run the
/// answer of a fresh `POST /runs/{id}/publish-media`, stored once it succeeds.
///
/// A run the service holds no tree for (`404`) is warned about and left with empty
/// media lists, which is a valid document; nothing is stored for it, so the next
/// refresh asks again. A copy the service refuses, or a call that never gets an
/// answer, fails the refresh once every other answer is stored: publishing through
/// an outage would put a generation live whose new documents name no media, so the
/// previous generation stays live and the snapshot dirty, and the refresh is
/// retried. With the artifacts service unconfigured only the stored answers are
/// used.
async fn published_media(
    inner: &PublisherInner,
    runs: &[StoredRun],
) -> Result<std::collections::HashMap<String, PublishedMedia>> {
    use futures_util::StreamExt;

    let mut media = std::collections::HashMap::new();
    for (run_id, json) in inner.db.public_media().await? {
        match serde_json::from_str::<PublishedMedia>(&json) {
            Ok(published) => {
                media.insert(run_id, published);
            }
            Err(err) => tracing::warn!(
                run.id = %run_id,
                "the stored published media does not parse ({err}); asking for the copy again"
            ),
        }
    }
    let Some(public) = &inner.public else {
        return Ok(media);
    };
    let pending: Vec<String> = runs
        .iter()
        .map(|run| run.record.id.clone())
        .filter(|id| !media.contains_key(id))
        .collect();
    let answers: Vec<(String, std::result::Result<Option<PublishedMedia>, _>)> =
        futures_util::stream::iter(pending)
            .map(|run_id: String| {
                let public = public.clone();
                async move {
                    let answer = public.publish_media(&run_id).await;
                    (run_id, answer)
                }
            })
            .buffer_unordered(PUBLISH_MEDIA_CONCURRENCY)
            .collect()
            .await;
    let mut failed = None;
    for (run_id, answer) in answers {
        match answer {
            Ok(Some(published)) => {
                let json = serde_json::to_string(&published)?;
                inner.db.set_public_media(&run_id, &json).await?;
                media.insert(run_id, published);
            }
            Ok(None) => tracing::warn!(
                run.id = %run_id,
                "the artifacts service holds no tree for a published run; its document names \
                 no media until a later refresh copies it"
            ),
            Err(err) => {
                failed.get_or_insert(BackendError::Snapshot(format!(
                    "publishing the media of run {run_id}: {err}"
                )));
            }
        }
    }
    match failed {
        Some(err) => Err(err),
        None => Ok(media),
    }
}

/// Delete the snapshot generations nothing points at any more, keeping the one just
/// written and anything inside the retention window (see
/// [`crate::snapshot::stale_generation_keys`] for the exact rule): list
/// `snapshots/` through `GET /public?prefix=snapshots/` and delete each stale key
/// with `DELETE /public/{key}`.
///
/// Every refresh writes a whole new generation, so without this the bucket grows by a
/// generation per publish and never shrinks. Nothing outside `snapshots/` is ever a
/// candidate: `documents/`, `media/`, `files/` and `codes/` are untouched.
///
/// **Best-effort by design.** A prune failure must never fail a refresh: the
/// generation is already live at this point, and the only consequence of a skipped
/// delete is that the next refresh has more to clean up. Every path therefore logs
/// and returns rather than propagating.
#[tracing::instrument(
    name = "snapshot.prune",
    skip(public),
    fields(pruned_keys = tracing::field::Empty),
)]
async fn prune_stale_snapshots(
    public: &PublicDataset,
    live_snapshot_id: &str,
    retention: Duration,
) {
    use futures_util::StreamExt;

    let keys = match public.list_keys(crate::snapshot::SNAPSHOT_PREFIX).await {
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
    let total = stale.len();
    let failed: usize = futures_util::stream::iter(stale)
        .map(|key: String| {
            let public = public.clone();
            async move {
                match public.delete(&key).await {
                    Ok(()) => 0,
                    Err(err) => {
                        tracing::warn!(%key, "pruning a superseded snapshot object failed ({err})");
                        1
                    }
                }
            }
        })
        .buffer_unordered(PRUNE_CONCURRENCY)
        .fold(0, |failed, one| async move { failed + one })
        .await;
    tracing::info!(
        deleted = total - failed,
        failed,
        live = %live_snapshot_id,
        "pruned superseded snapshot generations"
    );
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

#[cfg(test)]
#[path = "publisher.public.test.rs"]
mod public_tests;
