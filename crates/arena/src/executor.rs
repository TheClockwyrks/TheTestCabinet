//! The arena's capacity guard.
//!
//! Matches and tournaments execute **CPU-bound wasm** off the async runtime. A
//! single dedicated arena pod has finite CPU, so a [`MatchExecutor`] caps how much
//! of that work runs at once with a [`Semaphore`]. At
//! capacity the executor **rejects** rather than queues — the console sees a clean
//! `503` and can retry — so a flood of submissions can't pile up unbounded blocking
//! tasks and stall the pod.
//!
//! - A **match** holds one permit for its single `spawn_blocking` and releases it
//!   when the match returns ([`run_match`](MatchExecutor::run_match)).
//! - A **tournament** acquires one permit at submit time
//!   ([`acquire`](MatchExecutor::acquire)) and holds it across its whole background
//!   drive (every pair plus publishing), releasing it when the job finishes.

use std::sync::Arc;

use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use crate::error::ApiError;

/// Bounds concurrent CPU-bound arena work to a fixed number of permits.
#[derive(Debug, Clone)]
pub struct MatchExecutor {
    semaphore: Arc<Semaphore>,
}

impl MatchExecutor {
    /// Build an executor that admits at most `max_concurrent` matches/tournaments at
    /// once.
    pub fn new(max_concurrent: usize) -> Self {
        // A zero cap would deadlock every request; the config clamps to >=1, but
        // guard here too so a direct constructor call can't wedge the service.
        let permits = max_concurrent.max(1);
        Self {
            semaphore: Arc::new(Semaphore::new(permits)),
        }
    }

    /// Run one CPU-bound match closure off the async runtime under a permit. At
    /// capacity (`try_acquire` fails) the work is **rejected** with a `503` and a
    /// `warn` log rather than queued. The permit is held for the whole
    /// `spawn_blocking` and dropped when it returns.
    pub async fn run_match<F, T>(&self, f: F) -> Result<T, ApiError>
    where
        F: FnOnce() -> T + Send + 'static,
        T: Send + 'static,
    {
        let permit = self.try_acquire()?;
        let result = tokio::task::spawn_blocking(move || {
            // Hold the permit for the blocking work; dropped when the task ends.
            let _permit = permit;
            f()
        })
        .await
        .map_err(|err| ApiError::internal(format!("match task panicked: {err}")))?;
        Ok(result)
    }

    /// Acquire one permit for a tournament to hold across its whole background drive,
    /// or reject with a `503` (and a `warn` log) when at capacity. The returned
    /// permit must be moved into the background task so the slot stays held until the
    /// tournament finishes.
    pub fn acquire(&self) -> Result<OwnedSemaphorePermit, ApiError> {
        self.try_acquire()
    }

    /// `try_acquire_owned`, mapping exhaustion onto the `503` envelope with a `warn`
    /// log — the one place the capacity decision is made.
    fn try_acquire(&self) -> Result<OwnedSemaphorePermit, ApiError> {
        self.semaphore.clone().try_acquire_owned().map_err(|_| {
            tracing::warn!(
                permits = self.semaphore.available_permits(),
                "arena at capacity; rejecting request with 503"
            );
            ApiError::service_unavailable(
                "the arena is at capacity; retry the match or tournament shortly",
            )
        })
    }
}

#[cfg(test)]
#[path = "executor.test.rs"]
mod tests;
