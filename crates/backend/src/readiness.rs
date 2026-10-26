//! Serving readiness: whether this backend's definition store is populated enough
//! to resolve test-case versions, and whether the start's move of an earlier
//! release's on-disk state ([`crate::state_move`]) has finished.
//!
//! This is **not** liveness. The process is alive and correct from the moment it
//! binds — it simply has nothing to resolve against until its definition store has
//! been filled. The two must stay separate probes: a deployment whose `/state` is
//! ephemeral repopulates the store by ingesting the whole catalog on start, which
//! takes minutes, and a *liveness* probe that failed for that long would kill the
//! pod mid-ingest and never converge.
//!
//! See [`Readiness`] for why the signal latches rather than tracking the store
//! continuously.
//!
//! The move runs after the backend binds rather than before, for the same reason:
//! it calls the artifact service once per moved match replay, and a start held off
//! its liveness probe for that long would be killed mid-move. It holds only
//! readiness, and only until it finishes.
//!
//! A backend told to stop drains: it fails readiness at once, so its endpoint
//! leaves the Service, and ends every long-lived stream it serves, so each client
//! reconnects to a ready replica, while the server finishes the requests in flight
//! (the control plane's "Graceful termination").

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use tokio::sync::watch;

/// A monotonic latch: whether the definition store has been populated at least
/// once during this process's lifetime.
///
/// Cloneable and cheap — every clone shares one flag, so the ingest handler and
/// the readiness probe see the same value.
///
/// **Why it latches instead of re-reading the store per probe.** The condition
/// that matters is "has the store ever been filled", not "is it full right now".
/// A re-ingest rewrites versions through
/// [`publish_staged_version`](crate::store::DefinitionStore::publish_staged_version),
/// which swaps each version into place atomically, so resolution keeps working
/// throughout one — there is no moment a re-ingest makes the backend unservable.
/// Dropping out of readiness for the duration would therefore buy nothing and cost
/// a great deal: a SQLite backend runs one replica, so an unready pod empties its
/// Service of endpoints and every caller fails outright, which is strictly worse
/// than the per-case 404 it would replace. Once populated, stay ready.
#[derive(Clone, Debug)]
pub struct Readiness {
    populated: Arc<AtomicBool>,
    /// Set while the start's move of an earlier release's state is running.
    moving: Arc<AtomicBool>,
    /// Set once the backend was told to stop; never cleared.
    draining: Arc<watch::Sender<bool>>,
}

impl Readiness {
    /// A latch seeded from whether the store already holds versions at startup.
    ///
    /// Pass `true` when the store survived into this process — a durable volume, or
    /// a container restart that kept `/state` — since there is nothing to wait for
    /// and the backend can serve immediately. Pass `false` for an empty store, which
    /// holds the backend out of its Service until an ingest fills it.
    pub fn new(store_populated: bool) -> Self {
        Self {
            populated: Arc::new(AtomicBool::new(store_populated)),
            moving: Arc::new(AtomicBool::new(false)),
            draining: Arc::new(watch::channel(false).0),
        }
    }

    /// Whether the backend is ready to serve: the store is populated and no move of
    /// an earlier release's state is running.
    pub fn is_ready(&self) -> bool {
        self.is_store_populated() && !self.moving.load(Ordering::Acquire) && !self.is_draining()
    }

    /// Whether the backend was told to stop.
    pub fn is_draining(&self) -> bool {
        *self.draining.borrow()
    }

    /// Start draining: fail readiness from now on and end every stream waiting on
    /// [`Self::drained`]. Idempotent.
    pub fn mark_draining(&self) {
        self.draining.send_replace(true);
    }

    /// A future that resolves once the backend drains, which a long-lived stream
    /// ends on.
    pub fn drained(&self) -> impl std::future::Future<Output = ()> + Send + use<> {
        let mut draining = self.draining.subscribe();
        async move {
            let _ = draining.wait_for(|draining| *draining).await;
        }
    }

    /// Whether the definition store has been populated, regardless of the move.
    pub fn is_store_populated(&self) -> bool {
        self.populated.load(Ordering::Acquire)
    }

    /// Hold readiness while the start moves an earlier release's state; released by
    /// [`Self::mark_state_moved`].
    pub fn mark_state_moving(&self) {
        self.moving.store(true, Ordering::Release);
    }

    /// Release the hold [`Self::mark_state_moving`] placed.
    pub fn mark_state_moved(&self) {
        self.moving.store(false, Ordering::Release);
    }

    /// Record that the definition store now holds versions. Idempotent, and never
    /// reversed (see the type docs).
    pub fn mark_store_populated(&self) {
        self.populated.store(true, Ordering::Release);
    }
}

#[cfg(test)]
#[path = "readiness.test.rs"]
mod tests;
