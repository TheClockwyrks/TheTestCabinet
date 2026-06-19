//! The synchronized publish path: coalesced snapshot regeneration + upload +
//! deploy-hook fire (§1.4, §3 and the backend overview's "Publishing and
//! Synchronization").
//!
//! Being a single central entity is the point: the backend serializes publishes
//! so two operators cannot race on the shared snapshot state, and it **coalesces**
//! a burst of publishes into one regeneration, one upload, and one site rebuild.
//!
//! The coalescing is a debounce: a publish marks the store dirty and pings the
//! refresher; the refresher waits the coalescing window, draining any further
//! pings that arrive during it, then regenerates the **full** published set
//! (idempotent — re-running converges on the same snapshot), uploads it
//! atomically, and fires the hook. A forced refresh (`POST /snapshot/refresh`)
//! bypasses the debounce and runs immediately.

use std::sync::Arc;
use std::time::Duration;

use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use tokio::sync::{Notify, mpsc};
use tracing::Instrument;

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
    http: reqwest::Client,
    coalesce: Duration,
    /// Pinged when a publish marks the store dirty, waking the debounce loop.
    wake: Notify,
}

impl Publisher {
    /// Build a publisher. `r2` is `None` in the dev mode where the R2 credentials
    /// were not configured: the snapshot is still regenerated into SQLite-derived
    /// form and the dirty flag cleared, but no upload or hook fire happens.
    pub fn new(
        db: Arc<Db>,
        store: DefinitionStore,
        r2: Option<R2Client>,
        deploy_hook_url: Option<String>,
        coalesce: Duration,
    ) -> Self {
        Self {
            inner: Arc::new(PublisherInner {
                db,
                store,
                r2,
                deploy_hook_url,
                http: reqwest::Client::new(),
                coalesce,
                wake: Notify::new(),
            }),
        }
    }

    /// Notify the refresher that a publish has landed (the store is dirty). This
    /// returns immediately; the actual regeneration is coalesced and run on the
    /// background task. Returns whether a refresh was queued — always `true`
    /// here, since the debounce loop is what coalesces.
    pub fn queue_refresh(&self) -> bool {
        self.inner.wake.notify_one();
        true
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
        let handle = tokio::spawn(
            async move {
                // Recover a refresh that was pending when the process last stopped.
                if matches!(inner.db.snapshot_state(), Ok(state) if state.dirty)
                    && let Err(err) = run_refresh(&inner).await
                {
                    tracing::error!("startup snapshot refresh failed: {err}");
                }
                loop {
                    tokio::select! {
                        _ = inner.wake.notified() => {
                            // Debounce: wait the coalescing window, draining further
                            // wakes that arrive during it into this one refresh.
                            loop {
                                tokio::select! {
                                    _ = tokio::time::sleep(inner.coalesce) => break,
                                    _ = inner.wake.notified() => continue,
                                }
                            }
                            if let Err(err) = run_refresh(&inner).await {
                                tracing::error!("coalesced snapshot refresh failed: {err}");
                            }
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
        }
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
/// produced; both the debounce loop and the forced path call it.
#[tracing::instrument(
    name = "snapshot.run_refresh",
    skip(inner),
    fields(run_count = tracing::field::Empty),
    err,
)]
async fn run_refresh(inner: &PublisherInner) -> Result<RefreshOutcome> {
    let runs = inner.db.all_runs()?;
    let cases = load_case_manifests(&inner.store)?;
    let generated_at = OffsetDateTime::now_utc();

    let snapshot = SnapshotBuilder::new(runs, cases, inner.store.clone()).build(generated_at)?;
    let run_count = snapshot.run_count;
    tracing::Span::current().record("run_count", run_count);

    let deploy_hook_fired = match &inner.r2 {
        Some(r2) => {
            crate::snapshot::upload_snapshot(
                &snapshot,
                r2,
                inner.deploy_hook_url.as_deref(),
                &inner.http,
            )
            .await?
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
    inner.db.mark_uploaded(&uploaded_at, run_count as i64)?;

    Ok(RefreshOutcome {
        run_count,
        deploy_hook_fired,
    })
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
