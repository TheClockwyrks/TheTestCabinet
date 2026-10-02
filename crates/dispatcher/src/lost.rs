//! Lost-driver detection: which backend jobs no live driver `Job` is executing.
//!
//! The backend believes a driver is executing every job it holds as `dispatched`,
//! `starting` or `running`. That belief outlives the driver when the driver dies with
//! no one to report it: the whole machine restarted (a local cluster's node container,
//! taking every driver pod and the dispatcher down together), or a driver `Job` failed
//! while no dispatcher held its per-job token, or a driver exited after its final
//! report failed to reach the backend. Left alone such a job stays in flight for good,
//! holding its cell, its plan's or dispatch's limit, and its harness's capacity.
//!
//! The dispatcher therefore compares the two each tick. A driven job with no `Active`
//! driver `Job` is **missing**; one missing continuously for [`LOST_GRACE`] is
//! **lost**, and is reported to the backend, which fails it as the driver's own
//! `failed` report would. The grace covers the moment between a claim and its `Job`
//! appearing (another dispatcher process mid-rollout, a slow API server) and the
//! moment between a driver's last report and its `Job` completing.

use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

/// How long a driven job must have had no live driver `Job` before it is reported
/// lost.
pub const LOST_GRACE: Duration = Duration::from_secs(120);

/// Tracks, across ticks, since when each driven job has had no live driver `Job`.
#[derive(Debug, Default)]
pub struct LostTracker {
    missing_since: HashMap<String, Instant>,
}

impl LostTracker {
    /// Observe one tick: `driven` are the backend's driven job ids, read **before**
    /// `live`, the job ids with an `Active` driver `Job` — so a job claimed in between
    /// is simply not seen as driven yet. Answers the jobs missing for at least
    /// `grace` as of `now`, in id order. A job that is live again, or no longer driven,
    /// is forgotten; one answered stays tracked until the backend stops driving it,
    /// so a report that failed is made again on the next tick.
    pub fn observe(
        &mut self,
        driven: &[String],
        live: &HashSet<String>,
        now: Instant,
        grace: Duration,
    ) -> Vec<String> {
        let missing: HashSet<&String> = driven.iter().filter(|id| !live.contains(*id)).collect();
        self.missing_since.retain(|id, _| missing.contains(id));
        for id in &missing {
            self.missing_since.entry((*id).clone()).or_insert(now);
        }
        let mut lost: Vec<String> = self
            .missing_since
            .iter()
            .filter(|(_, since)| now.duration_since(**since) >= grace)
            .map(|(id, _)| id.clone())
            .collect();
        lost.sort();
        lost
    }
}

#[cfg(test)]
#[path = "lost.test.rs"]
mod tests;
