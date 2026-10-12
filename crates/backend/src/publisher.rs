//! The synchronized publish path: batched snapshot regeneration + upload +
//! deploy-hook fire (§1.4, §3 and the backend overview's "Publishing and
//! Synchronization").
//!
//! Being a single central entity is the point: the backend serializes refreshes
//! so two of them cannot race on the shared snapshot state, and it **batches** the
//! requests for one, because every refresh ends in a full site rebuild.
//!
//! A change to what the snapshot shows counts one request
//! ([`Publisher::queue_refresh`]). The [`batch`] module decides when the pending
//! requests are released: at a threshold count, or once no request has arrived for
//! a quiet window, with a minimum interval between two releases. A release
//! regenerates the **full** published set (idempotent — re-running converges on
//! the same snapshot), uploads it atomically, and fires the hook. A forced refresh
//! (`POST /snapshot/refresh`) bypasses the batching and runs immediately.
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
use tokio::sync::mpsc;
use tracing::Instrument;

#[path = "publisher.batch.rs"]
pub mod batch;

pub use batch::BatchTiming;
use batch::{Batch, Batcher, RefreshTarget};

use crate::db::Db;
use crate::error::{BackendError, Result};
use crate::snapshot::SnapshotBuilder;
use crate::store::DefinitionStore;
use test_cabinet_core::r2::R2Client;

/// The outcome of a forced refresh (`POST /snapshot/refresh`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RefreshOutcome {
    /// Runs in the regenerated snapshot.
    pub run_count: usize,
    /// Whether the deploy hook fired (false when no hook is configured).
    pub deploy_hook_fired: bool,
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
    deploy_hook_url: Option<String>,
    /// The auth service client, used to fetch each reviewer's profile picture so it
    /// can be embedded in the public snapshot.
    auth: Arc<test_cabinet_core::AccountsClient>,
    http: reqwest::Client,
    /// The artifact service's **in-cluster** base URL
    /// ([`Config::artifacts_internal_url`](crate::config::Config::artifacts_internal_url)),
    /// passed to the snapshot builder so it can fall back for run media missing from
    /// the (ephemeral) store. `None` in a dev/single-box setup with no separate
    /// artifact service, and in any deployment that supplies no in-cluster URL.
    artifacts_url: Option<String>,
    /// How long a superseded snapshot generation is kept before the post-upload
    /// prune removes it (see [`prune_stale_snapshots`]).
    snapshot_retention: Duration,
    /// The bucket media confirmations are recorded against, on a backend that
    /// records them (see [`PublisherTiming::confirm_media`]).
    confirm_media: Option<&'static str>,
    /// Counts the refresh requests and decides when a batch of them is released.
    batcher: Batcher,
    /// How many refreshes have finished, so a test can wait for the loop to act
    /// rather than poll the database on a timer.
    #[cfg(test)]
    refreshes: tokio::sync::watch::Sender<u64>,
    /// How many times pending requests have been recorded durably, for the same
    /// reason.
    #[cfg(test)]
    recordings: tokio::sync::watch::Sender<u64>,
}

/// The timing knobs a publisher is built with, grouped so the `Duration`s cannot
/// be transposed at the call site (they are same-typed and mean very different
/// things) and so adding another does not widen [`Publisher::new`] again.
/// [`Config::publisher_timing`](crate::config::Config::publisher_timing) builds it
/// from the environment.
#[derive(Debug, Clone, Copy)]
pub struct PublisherTiming {
    /// When a batch of refresh requests is released (`TCAB_SNAPSHOT_BATCH_SIZE`,
    /// `TCAB_SNAPSHOT_COALESCE_MS`, `TCAB_SNAPSHOT_MIN_INTERVAL_MS`).
    pub batch: BatchTiming,
    /// How long a superseded snapshot generation is kept before the post-upload
    /// prune removes it (`TCAB_SNAPSHOT_RETENTION_HOURS`).
    pub snapshot_retention: Duration,
    /// `Some` on a backend that records [media
    /// confirmations](crate::db::Db::record_media_confirmation): the name of the
    /// bucket they are made against
    /// ([`media_bucket_identity`](crate::artifacts::media_bucket_identity)).
    ///
    /// Set for a backend whose artifact reclamation sweep deletes published runs'
    /// trees, which it does only for a run a refresh has confirmed in this bucket.
    /// Any other backend has no use for a confirmation: it records none, and its
    /// refreshes ask the artifact service for no tree listing.
    ///
    /// A publisher with this set that starts beside published runs no refresh has
    /// evaluated against the bucket requests one refresh to evaluate them. Runs
    /// published before the backend recorded confirmations have none, and on a
    /// deployment whose queue is on hold for lack of space no publish will arrive
    /// to prompt the refresh that would give them one. The request is made only
    /// while such a run exists, and a refresh records every run it evaluated, so
    /// a later start requests nothing.
    pub confirm_media: Option<&'static str>,
}

impl Publisher {
    /// Build a publisher. `r2` is `None` in the dev mode where the R2 credentials
    /// were not configured: the snapshot is still regenerated into SQLite-derived
    /// form and the dirty flag cleared, but no upload or hook fire happens.
    ///
    /// `artifacts_url` is the artifact service's **in-cluster** base URL, the one the
    /// backend itself can reach — not the address advertised to consoles.
    pub fn new(
        db: Arc<Db>,
        store: DefinitionStore,
        r2: Option<R2Client>,
        deploy_hook_url: Option<String>,
        artifacts_url: Option<String>,
        auth: Arc<test_cabinet_core::AccountsClient>,
        timing: PublisherTiming,
    ) -> Self {
        // Publishing is enabled (R2 is configured) but no site deploy hook is set:
        // every publish will upload the snapshot to R2 yet never trigger the
        // Cloudflare Pages rebuild, so the public gallery silently stays on its last
        // build. Surface it once at startup — this is otherwise an invisible skip in
        // `upload_snapshot` (see `TCAB_SITE_DEPLOY_HOOK_URL` in config.rs).
        if r2.is_some() && deploy_hook_url.is_none() {
            tracing::warn!(
                "R2 is configured but TCAB_SITE_DEPLOY_HOOK_URL is unset; snapshots \
                 will upload to R2 but the gallery site will not be redeployed"
            );
        }
        Self {
            inner: Arc::new(PublisherInner {
                db,
                store,
                r2,
                deploy_hook_url,
                auth,
                http: reqwest::Client::new(),
                artifacts_url,
                snapshot_retention: timing.snapshot_retention,
                confirm_media: timing.confirm_media,
                batcher: Batcher::new(timing.batch),
                #[cfg(test)]
                refreshes: tokio::sync::watch::channel(0).0,
                #[cfg(test)]
                recordings: tokio::sync::watch::channel(0).0,
            }),
        }
    }

    /// Count one refresh request: one change to what the public snapshot shows (a
    /// run's publish, a review on a published run, a published comparison, an
    /// ingest that changed the store, a catalog or price change). Every request
    /// counts as one, whatever its kind.
    ///
    /// Returns immediately; the background task releases the request with its
    /// batch. Returns whether a refresh was queued, which is always `true`.
    pub fn queue_refresh(&self) -> bool {
        self.inner.batcher.request();
        true
    }

    /// Spawn the background batching loop. It runs until the returned shutdown
    /// channel is dropped or signaled. On startup it checks the persisted dirty
    /// flag so a refresh pending at the last restart is not lost.
    pub fn spawn(&self) -> RefresherHandle {
        let inner = Arc::clone(&self.inner);
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);
        // Give the detached batching task its own span. It is the root of every
        // background refresh's trace (a refresh is not tied to one request), so
        // `run_refresh`'s spans nest under it rather than floating free.
        let task_span = tracing::info_span!("publisher.refresher");
        let handle = tokio::spawn(
            async move {
                let recover = inner.recovery().await;
                inner.request_startup_confirmation().await;
                inner
                    .batcher
                    .run(inner.as_ref(), recover, shutdown_rx)
                    .await;
            }
            .instrument(task_span),
        );
        RefresherHandle {
            _shutdown: shutdown_tx,
            handle,
        }
    }

    /// A receiver that changes each time a refresh finishes.
    #[cfg(test)]
    pub(crate) fn refreshes(&self) -> tokio::sync::watch::Receiver<u64> {
        self.inner.refreshes.subscribe()
    }

    /// A receiver that changes each time pending requests are recorded durably.
    #[cfg(test)]
    pub(crate) fn recordings(&self) -> tokio::sync::watch::Receiver<u64> {
        self.inner.recordings.subscribe()
    }

    /// Force an immediate refresh, bypassing the batching (operator recovery via
    /// `POST /snapshot/refresh`). Regenerates, uploads, and fires the hook now. It
    /// waits for a refresh already running, carries every pending request, and
    /// starts the minimum interval before the next batch.
    pub async fn refresh_now(&self) -> Result<RefreshOutcome> {
        self.inner.batcher.forced(self.inner.as_ref()).await
    }
}

impl PublisherInner {
    /// Whether a refresh was pending when the process last stopped, and how long
    /// the batcher holds its release for.
    ///
    /// A state that cannot be read is taken as pending. A refresh nobody needed
    /// republishes what is already live, while one skipped leaves the gallery
    /// behind until some later request.
    async fn recovery(&self) -> Option<Duration> {
        match self.db.snapshot_state().await {
            Ok(state) if state.dirty => Some(recovery_hold(
                state.last_uploaded.as_deref(),
                OffsetDateTime::now_utc(),
                self.batcher.timing().min_interval,
            )),
            Ok(_) => None,
            Err(err) => {
                tracing::warn!(
                    "could not read whether a snapshot refresh was pending ({err});                      refreshing as though one was"
                );
                Some(Duration::ZERO)
            }
        }
    }
}

impl PublisherInner {
    /// Request one refresh when published runs exist that no refresh has evaluated
    /// the media of against the configured bucket, so their confirmations are
    /// established without waiting for a publish. See
    /// [`PublisherTiming::confirm_media`].
    ///
    /// The request is an ordinary one: it is counted with any others and released
    /// by the batching, so it adds no refresh to a start that was going to refresh
    /// anyway. Without a bucket there is nothing to confirm against and nothing is
    /// requested. A count that cannot be read requests nothing either, since the
    /// next publish evaluates every run all the same.
    async fn request_startup_confirmation(&self) {
        let Some(bucket) = self.confirm_media.filter(|_| self.r2.is_some()) else {
            return;
        };
        match self.db.published_runs_unchecked(bucket).await {
            Ok(0) => {}
            Ok(runs) => {
                tracing::info!(
                    runs,
                    "published runs have no media confirmation on record; requesting a \
                     snapshot refresh to establish it"
                );
                self.batcher.request();
            }
            Err(err) => tracing::warn!(
                "could not count the published runs awaiting a media confirmation ({err}); \
                 the next refresh evaluates them"
            ),
        }
    }
}

/// How long a startup recovery waits: what is left of `min_interval` since the
/// last upload, so the interval between two releases holds across a restart.
///
/// Nothing is left when there has been no upload, when its time cannot be read,
/// or when it lies in the future, which is a clock that moved rather than an
/// upload to wait behind.
fn recovery_hold(
    last_uploaded: Option<&str>,
    now: OffsetDateTime,
    min_interval: Duration,
) -> Duration {
    let Some(uploaded) = last_uploaded.and_then(|at| OffsetDateTime::parse(at, &Rfc3339).ok())
    else {
        return Duration::ZERO;
    };
    match Duration::try_from(now - uploaded) {
        Ok(since) => min_interval.saturating_sub(since),
        Err(_) => Duration::ZERO,
    }
}

impl RefreshTarget for PublisherInner {
    type Output = RefreshOutcome;

    async fn refresh(&self, _batch: Batch) -> Result<RefreshOutcome> {
        let result = run_refresh(self).await;
        #[cfg(test)]
        self.refreshes.send_modify(|finished| *finished += 1);
        result
    }

    /// The persisted dirty flag is the durable record. A publish sets it in its
    /// own transaction; a request that changed only the catalog or the store has
    /// set nothing, and a refresh clears the flag under requests that arrived
    /// while it ran.
    async fn persist_pending(&self) {
        if let Err(err) = self.db.mark_dirty().await {
            tracing::warn!(
                "could not record the pending snapshot refresh ({err}); \
                 a restart before it is released would drop it"
            );
        }
        #[cfg(test)]
        self.recordings.send_modify(|recorded| *recorded += 1);
    }
}

/// A handle keeping the background refresher alive; dropping it stops the loop.
pub struct RefresherHandle {
    _shutdown: mpsc::Sender<()>,
    handle: tokio::task::JoinHandle<()>,
}

impl RefresherHandle {
    /// Await the refresher task (used in graceful shutdown / tests).
    ///
    /// Drops the shutdown sender first so the loop's `shutdown_rx.recv()` arm
    /// resolves and the task breaks; awaiting the handle while still holding the
    /// sender would deadlock, since nothing would ever signal the loop to stop.
    pub async fn join(self) {
        let Self { _shutdown, handle } = self;
        drop(_shutdown);
        let _ = handle.await;
    }
}

/// Regenerate the full snapshot, upload it (when R2 is configured), fire the
/// deploy hook, and clear the dirty flag. This is the one place the snapshot is
/// produced; both the batching loop and the forced path reach it.
#[tracing::instrument(
    name = "snapshot.run_refresh",
    skip(inner),
    fields(run_count = tracing::field::Empty),
    err,
)]
async fn run_refresh(inner: &PublisherInner) -> Result<RefreshOutcome> {
    // What each published run's confirmation is recorded against, read before the
    // runs themselves: a confirmation is written only for a run whose row still
    // carries the mutation timestamp read here, so the record this refresh
    // evaluates is never older than the one it vouches for.
    let confirming = match inner.confirm_media.filter(|_| inner.r2.is_some()) {
        Some(bucket) => Some((bucket, inner.db.published_media_states(bucket).await?)),
        None => None,
    };
    let runs = inner.db.all_published().await?;
    // The confirmed runs' file manifests, which those runs are built from. Read
    // after the runs: a run stored again in between has lost its manifest by
    // now and is built from its sources, where the other order could pair a new
    // record with the manifest of the one it replaced.
    //
    // A manifest that cannot be read fails the refresh, which the batching
    // retries. Building without the manifests would read every confirmed run
    // from the backend store, which may no longer hold its files, and publish
    // it with those files left out.
    let recorded_manifests: std::collections::HashMap<String, crate::db::MediaManifest> =
        match &confirming {
            Some((bucket, _)) => inner
                .db
                .confirmed_media_manifests(Some(bucket))
                .await
                .map_err(|err| {
                    BackendError::Snapshot(format!(
                        "reading the confirmed runs' file manifests failed ({err}); refusing                          to rebuild their media from sources that may have been reclaimed"
                    ))
                })?
                .into_iter()
                .collect(),
            None => std::collections::HashMap::new(),
        };
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
    // nothing anyway.
    //
    // A failure to list `media/` fails the refresh, which the batching retries.
    // Falling back to an empty set would have the builder read every run's media
    // from its source again, and the source of a published run's media may be gone
    // on purpose: the artifact reclamation sweep deletes a published run's tree
    // once a refresh has confirmed its media in this bucket. A run whose bytes are
    // only in the bucket would then be published with its media left out. The
    // `files/` prefix holds case files read from the definition store, which is
    // always there to read again, so a failure to list it degrades to re-exporting
    // them.
    let existing_media = match &inner.r2 {
        Some(r2) => {
            let mut keys: std::collections::HashSet<String> = r2
                .list_keys("media/")
                .await
                .map_err(|err| {
                    BackendError::Snapshot(format!(
                        "listing the bucket's existing `media/` objects failed ({err}); \
                         refusing to rebuild run media from sources that may have been reclaimed"
                    ))
                })?
                .into_iter()
                .collect();
            match r2.list_keys("files/").await {
                Ok(listed) => keys.extend(listed),
                Err(err) => {
                    tracing::warn!(
                        "listing existing snapshot `files/` objects failed ({err}); \
                         re-exporting everything under it"
                    );
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

    // Each distinct reviewer's profile picture, fetched from the auth service so it
    // can be embedded in the public snapshot beside their reviews. Unlike run media,
    // a picture is mutable, so it is re-fetched every refresh (the set of distinct
    // reviewers is small). Only when R2 is configured — without a bucket the snapshot
    // is not uploaded and the live console reads reviewer avatars straight from the
    // auth service, so there is nothing to embed. A reviewer with no picture (the
    // `Ok(None)` 404 path) is simply absent from the map; a transport/server fault
    // logs and skips that one reviewer rather than aborting the whole refresh.
    let mut reviewer_pictures = std::collections::HashMap::new();
    if inner.r2.is_some() {
        let reviewer_ids: std::collections::HashSet<String> = runs
            .iter()
            .flat_map(|run| run.reviews.iter().map(|r| r.reviewer.user_id.clone()))
            .collect();
        for reviewer_id in reviewer_ids {
            match inner.auth.picture(&reviewer_id).await {
                Ok(Some(picture)) => {
                    reviewer_pictures.insert(reviewer_id, picture);
                }
                Ok(None) => {}
                Err(err) => {
                    tracing::warn!(
                        reviewer = %reviewer_id,
                        "fetching a reviewer's profile picture failed ({err}); omitting it from the snapshot"
                    );
                }
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
        .map(crate::api::TestCaseGroupOut::from)
        .collect();

    let mut builder = SnapshotBuilder::new(runs, cases, inner.store.clone())
        .with_artifacts(inner.artifacts_url.clone(), inner.http.clone());
    if let Some((_, states)) = &confirming {
        builder = builder
            .with_media_confirmation(
                states
                    .iter()
                    .filter(|state| state.settled())
                    .map(|state| state.id.clone())
                    .collect(),
            )
            .with_recorded_tree_absence(
                states
                    .iter()
                    .filter(|state| state.tree_recorded_absent)
                    .map(|state| state.id.clone())
                    .collect(),
            );
    }
    let snapshot = builder
        .with_recorded_manifests(recorded_manifests)
        .with_models(models)
        .with_reference_builds(reference_builds)
        .with_reference_sheets(reference_sheets)
        .with_existing_media(existing_media)
        .with_existing_documents(existing_documents)
        .with_reviewer_pictures(reviewer_pictures)
        .with_comparisons(comparisons)
        .with_gg_documents(gg_documents)
        .with_test_case_groups(test_case_groups)
        .build(generated_at)
        .await?;
    let run_count = snapshot.run_count;
    tracing::Span::current().record("run_count", run_count);

    let mut confirmation = None;
    let deploy_hook_fired = match &inner.r2 {
        Some(r2) => {
            crate::snapshot::upload_snapshot(&snapshot, r2).await?;
            // Every object is in the bucket and `index.json` names this generation,
            // so what the build found about each run's media now holds of the
            // bucket. Recorded before the hook: a hook that fails changes nothing
            // about where the media is.
            if let Some((bucket, states)) = &confirming {
                confirmation = Some(
                    record_media_confirmation(inner, bucket, states, &snapshot, generated_at).await,
                );
            }
            // Only after the atomic `index.json` cut-over: until it lands, the
            // previous generation is still the live one and must not be touched.
            // Before the hook, so a hook that keeps failing does not also keep the
            // generations its retries upload from ever being pruned.
            prune_stale_snapshots(r2, &snapshot.snapshot_id, inner.snapshot_retention).await;
            match inner.deploy_hook_url.as_deref() {
                Some(url) => {
                    crate::snapshot::fire_deploy_hook(url, &inner.http).await?;
                    true
                }
                None => false,
            }
        }
        None => {
            // Dev mode: no R2 credentials. The snapshot was still regenerated
            // (proving it is well-formed) but is not uploaded; nothing is fired.
            tracing::warn!(
                "snapshot regenerated ({run_count} runs) but R2 is not configured; skipping upload"
            );
            false
        }
    };

    let uploaded_at = generated_at
        .format(&Rfc3339)
        .map_err(|e| BackendError::Snapshot(format!("formatting uploaded_at: {e}")))?;
    inner
        .db
        .mark_uploaded(&uploaded_at, run_count as i64)
        .await?;

    let tournament_replays = measure_tournament_replays(&inner.store).await;

    // One line per completed refresh recording whether the gallery deploy hook
    // fired. `deploy_hook_fired` is false whenever no hook is configured (R2-only)
    // or R2 itself is off — so this is the log to check when a publish uploaded the
    // snapshot to R2 but the public gallery never rebuilt.
    let (runs_confirmed, runs_unconfirmed) = confirmation.unzip();
    tracing::info!(
        run_count,
        deploy_hook_fired,
        runs_confirmed,
        runs_unconfirmed,
        tournament_replay_bytes = tournament_replays.map(|usage| usage.bytes),
        tournament_replay_files = tournament_replays.map(|usage| usage.files),
        "snapshot refresh complete"
    );

    Ok(RefreshOutcome {
        run_count,
        deploy_hook_fired,
    })
}

/// Measure what the tournaments' match replays hold in the backend store, and
/// record it as the `tcab.store.tournament_replay_*` gauges. `None` when the
/// store could not be measured, which records nothing.
///
/// Tournament replays are the one part of the store no refresh exports, so their
/// size is reported here, once per refresh: the walk is too slow for a request
/// and runs on a blocking thread.
async fn measure_tournament_replays(store: &DefinitionStore) -> Option<crate::store::StoreUsage> {
    let store = store.clone();
    let measured = tokio::task::spawn_blocking(move || store.tournament_replay_usage()).await;
    match measured {
        Ok(Ok(usage)) => {
            crate::metrics::record_tournament_replays(usage);
            Some(usage)
        }
        Ok(Err(err)) => {
            tracing::warn!("could not measure the tournament replays in the store ({err})");
            None
        }
        Err(err) => {
            tracing::warn!("measuring the tournament replays in the store did not finish ({err})");
            None
        }
    }
}

/// Record which of the runs of an uploaded snapshot have every file of theirs in
/// `bucket`, each with its [manifest](crate::db::MediaManifest), and report the
/// rest. Returns how many runs the refresh
/// found confirmed and how many it could not confirm.
///
/// A published run's tree on the artifact service is the fallback source for media
/// that is not in the bucket yet, and the reclamation sweep deletes the tree only
/// for a run recorded here as confirmed. Each run left unconfirmed is logged with
/// its files, and the count is the `tcab.artifacts.unconfirmed_runs` gauge.
///
/// `states` is what the refresh read about each published run before it read the
/// runs. Three kinds of run are left as they are:
///
/// - A **settled** run, confirmed in this bucket with its tree reclaimed. The
///   build asked nothing about it, and there is no tree left for a withdrawn
///   confirmation to keep.
/// - A run the snapshot was not built from although it was published when
///   `states` was read, and one published since: the build did not evaluate it.
/// - A run that changed while the refresh ran. The database refuses its
///   confirmation, and this requests another refresh to evaluate it.
///
/// A run whose tree was reclaimed and whose media the build did not find in the
/// bucket has no source left. That is not a state a refresh can repair, and it is
/// what a backend pointed at the wrong or an emptied bucket looks like, so it is
/// logged at `error` with the number of such runs. It is logged the same way when
/// the build could rule the missing files unrecoverable and the run is confirmed
/// without them: the record then says the files exist nowhere, which is true of
/// everything this backend can reach and may not be true of another bucket.
///
/// Each run newly confirmed with unrecoverable files is logged at `warn` with the
/// files.
///
/// Best-effort: a failure to record is logged and does not fail the refresh. The
/// snapshot is live either way, the trees are kept, and the next refresh evaluates
/// every run again.
async fn record_media_confirmation(
    inner: &PublisherInner,
    bucket: &str,
    states: &[crate::db::PublishedMediaState],
    snapshot: &crate::snapshot::Snapshot,
    uploaded_at: OffsetDateTime,
) -> (usize, usize) {
    let mut confirmed = Vec::new();
    let mut unconfirmed = Vec::new();
    let mut sourceless = 0usize;
    let mut reclaimed_with_lost_files = 0usize;
    for state in states {
        if !snapshot.run_ids.contains(&state.id) {
            continue;
        }
        let missing = snapshot.unconfirmed_media.contains_key(&state.id);
        if missing && state.reclaimed {
            sourceless += 1;
        }
        if state.settled() {
            continue;
        }
        if missing {
            unconfirmed.push(state.id.clone());
            continue;
        }
        // Every run the snapshot was built from has a manifest. One without
        // would be confirmed with no record of its files, so it is left as it
        // was for the next refresh.
        let Some(manifest) = snapshot.media_manifests.get(&state.id) else {
            continue;
        };
        if !state.confirmed {
            let lost: Vec<&str> = manifest.unrecoverable().collect();
            if !lost.is_empty() {
                tracing::warn!(
                    run.id = %state.id,
                    files = %lost.join(", "),
                    "published run confirmed with unrecoverable files; the bucket, the \
                     backend store and the artifact service each hold none of them"
                );
                if state.reclaimed {
                    reclaimed_with_lost_files += 1;
                }
            }
        }
        confirmed.push(crate::db::ConfirmedMedia {
            state: state.clone(),
            manifest: manifest.clone(),
        });
    }
    for (run_id, files) in &snapshot.unconfirmed_media {
        tracing::warn!(
            run.id = %run_id,
            files = %files.join(", "),
            "published run media not confirmed in the bucket; its artifact tree is kept"
        );
    }
    if sourceless > 0 {
        tracing::error!(
            runs = sourceless,
            bucket,
            "published runs whose artifact tree was reclaimed have media that is not in \
             the configured bucket; nothing is left to publish it from"
        );
    }
    if reclaimed_with_lost_files > 0 {
        // A run whose tree this backend reclaimed had every file that existed in
        // a bucket when it did. Files of such a run that nothing holds now were
        // never produced, or they are in the bucket the run was confirmed in and
        // this backend is configured with another.
        tracing::error!(
            runs = reclaimed_with_lost_files,
            bucket,
            "published runs whose artifact tree was reclaimed were confirmed with files \
             that neither the configured bucket nor the backend store holds; a backend \
             pointed at another bucket than the one they were confirmed in looks like this"
        );
    }
    crate::metrics::record_unconfirmed_runs(unconfirmed.len() as u64);
    let recorded = match uploaded_at.format(&Rfc3339) {
        Ok(at) => {
            inner
                .db
                .record_media_confirmation(&confirmed, &unconfirmed, &at, bucket)
                .await
        }
        Err(err) => Err(err.into()),
    };
    match recorded {
        Ok(changed) => {
            if changed.confirmed > 0 || changed.withdrawn > 0 || changed.changed > 0 {
                tracing::info!(
                    newly_confirmed = changed.confirmed,
                    withdrawn = changed.withdrawn,
                    changed_meanwhile = changed.changed,
                    "recorded the published runs' media confirmations"
                );
            }
            if changed.changed > 0 {
                // The runs that moved were evaluated from a record that may no
                // longer be theirs. Evaluate them again.
                inner.batcher.request();
            }
        }
        Err(err) => tracing::warn!(
            "could not record the published runs' media confirmations ({err}); \
             their artifact trees are kept and the next refresh records them"
        ),
    }
    (confirmed.len(), unconfirmed.len())
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

#[cfg(test)]
#[path = "publisher.manifest.test.rs"]
mod manifest_tests;
