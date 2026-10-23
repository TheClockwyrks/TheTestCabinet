//! The schedule of the retry of failed publishes: which unpublished runs whose
//! latest publish job failed are due another one, and when.
//!
//! Everything here is a pure function of a run's publish job rows and an instant,
//! so the same rows always give the same answer and a restart loses nothing. The
//! retry pass (`crate::api::publish_retry`) reads the rows, asks [`failed_runs`]
//! and [`FailedRun::due`], and enqueues. The rules are the backend results page's
//! "Retrying a failed publish":
//!
//! - A run whose latest publish job failed waits [`retry_wait`] after that failure:
//!   [`FIRST_RETRY_WAIT`] after the first consecutive failure, doubled with each
//!   consecutive failure after it, never more than [`MAX_RETRY_WAIT`].
//! - Its retries end [`RETRY_BUDGET`] after its first failed publish job, whoever
//!   enqueued that job.
//! - A run with a publish job `queued` or `dispatched` is not retried, so a run has
//!   at most one publish job in flight.
//!
//! A job's failure instant is its `updated_at`, which recording it `failed` sets
//! last (and which the sweep of abandoned jobs sets to the dispatch instant plus an
//! hour). The jobs of a run are ordered by `created_at`, ties broken by id, with
//! every instant parsed rather than compared as text.

use std::collections::BTreeMap;

use test_cabinet_entities::publish_job;
use time::format_description::well_known::Rfc3339;
use time::{Duration, OffsetDateTime};

/// The wait after a run's first consecutive publish failure before it is retried.
pub const FIRST_RETRY_WAIT: Duration = Duration::minutes(5);

/// The longest wait between a failure and the retry that follows it.
pub const MAX_RETRY_WAIT: Duration = Duration::hours(4);

/// How long after a run's first failed publish job its retries go on. Past it the
/// run waits in the Unpublished worklist for an operator.
pub const RETRY_BUDGET: Duration = Duration::hours(24);

/// The wait after a run's `consecutive_failures`-th consecutive failure:
/// [`FIRST_RETRY_WAIT`] doubled `consecutive_failures - 1` times, capped at
/// [`MAX_RETRY_WAIT`]. Zero failures are read as one.
pub fn retry_wait(consecutive_failures: u32) -> Duration {
    let mut wait = FIRST_RETRY_WAIT;
    for _ in 1..consecutive_failures {
        if wait >= MAX_RETRY_WAIT {
            break;
        }
        wait = wait.saturating_mul(2);
    }
    wait.min(MAX_RETRY_WAIT)
}

/// An unpublished run whose latest publish job failed and that has no publish job
/// in flight.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FailedRun {
    /// The run's id.
    pub run_id: String,
    /// How many of the run's latest publish jobs failed in a row, the latest
    /// included.
    pub consecutive_failures: u32,
    /// When the run's first failed publish job failed: the start of its
    /// [`RETRY_BUDGET`].
    pub first_failed_at: OffsetDateTime,
    /// When the run's latest publish job failed.
    pub last_failed_at: OffsetDateTime,
}

impl FailedRun {
    /// When the run's next retry falls due: its latest failure plus the
    /// [`retry_wait`] of its consecutive failures.
    pub fn retry_at(&self) -> OffsetDateTime {
        self.last_failed_at + retry_wait(self.consecutive_failures)
    }

    /// When the run's retries end: its first failure plus [`RETRY_BUDGET`].
    pub fn retries_end_at(&self) -> OffsetDateTime {
        self.first_failed_at + RETRY_BUDGET
    }

    /// Whether the run is due a retry at `now`: its wait has passed and its
    /// retries have not ended.
    pub fn due(&self, now: OffsetDateTime) -> bool {
        now >= self.retry_at() && now < self.retries_end_at()
    }
}

/// Parse an RFC 3339 column value.
fn instant(value: &str) -> Option<OffsetDateTime> {
    OffsetDateTime::parse(value, &Rfc3339).ok()
}

/// The runs among `jobs`' runs whose latest publish job failed and that have no
/// publish job `queued` or `dispatched`, ordered by run id. `jobs` holds every
/// publish job of the runs to consider, in any order; the caller decides which
/// runs those are (the retry reads the unpublished runs that are not attempts an
/// automatic retry replaced).
///
/// A run any of whose jobs carries an instant that does not parse is left out:
/// its order or its failure instants cannot be stated, and a retry scheduled on a
/// guess could repeat without end.
pub fn failed_runs(jobs: &[publish_job::Model]) -> Vec<FailedRun> {
    let mut by_run: BTreeMap<&str, Vec<&publish_job::Model>> = BTreeMap::new();
    for job in jobs {
        by_run.entry(job.run_id.as_str()).or_default().push(job);
    }
    by_run
        .into_iter()
        .filter_map(|(run_id, jobs)| failed_run(run_id, jobs))
        .collect()
}

/// [`failed_runs`] for one run's jobs.
fn failed_run(run_id: &str, jobs: Vec<&publish_job::Model>) -> Option<FailedRun> {
    if jobs
        .iter()
        .any(|job| job.state == "queued" || job.state == "dispatched")
    {
        return None;
    }
    let mut ordered = jobs
        .into_iter()
        .map(|job| instant(&job.created_at).map(|created| (created, job)))
        .collect::<Option<Vec<_>>>()?;
    ordered.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.id.cmp(&b.1.id)));

    let (_, latest) = ordered.last()?;
    if latest.state != "failed" {
        return None;
    }
    let consecutive = ordered
        .iter()
        .rev()
        .take_while(|(_, job)| job.state == "failed")
        .count();
    let last_failed_at = instant(&latest.updated_at)?;
    let (_, first_failed) = ordered.iter().find(|(_, job)| job.state == "failed")?;
    let first_failed_at = instant(&first_failed.updated_at)?;
    Some(FailedRun {
        run_id: run_id.to_string(),
        consecutive_failures: u32::try_from(consecutive).unwrap_or(u32::MAX),
        first_failed_at,
        last_failed_at,
    })
}

#[cfg(test)]
#[path = "publish_retry.test.rs"]
mod tests;
