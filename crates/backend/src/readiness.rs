//! Serving readiness: whether this backend's definition store is populated enough
//! to resolve test-case versions.
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

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

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
/// a great deal: the backend runs at `replicas: 1`, so an unready pod empties its
/// Service of endpoints and every caller fails outright, which is strictly worse
/// than the per-case 404 it would replace. Once populated, stay ready.
#[derive(Clone, Debug)]
pub struct Readiness {
    populated: Arc<AtomicBool>,
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
        }
    }

    /// Whether the backend is ready to resolve test-case versions.
    pub fn is_ready(&self) -> bool {
        self.populated.load(Ordering::Acquire)
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
