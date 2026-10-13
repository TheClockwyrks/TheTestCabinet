//! What the publish job table says about publishing: which failed publishes are
//! due another attempt, and whether publishing is failing broadly enough to hold
//! new runs.
//!
//! Everything here is a pure function of the publish job rows and an instant, so
//! the same rows always give the same answer: a restart loses nothing, and there
//! is no flag to reset. [`assess`] is the one entry point. The database layer
//! gathers its input ([`Db::publish_facts`](crate::db::Db::publish_facts)), the
//! retry pass (`crate::api::publish_retry`) acts on its output, and the
//! [capacity monitor](crate::capacity::CapacityMonitor) reports the hold it finds.
//!
//! # Retrying one run
//!
//! A run whose latest publish job failed gets another one after a wait that
//! starts at [`FIRST_RETRY_WAIT`] and doubles with each consecutive failure of
//! that run, up to [`MAX_RETRY_WAIT`]. Its retries end [`RETRY_BUDGET`] after the
//! first failure of the streak ([`FailedRun::due`]).
//!
//! # The hold
//!
//! An unpublished completed run keeps its artifact tree until it is published, so
//! a release path that has stopped working fills the artifact store with every run
//! that finishes. New runs are held while the most recent finished publish jobs
//! are failures of [`hold_runs`](assess) different runs with no success among
//! them. Runs are counted, not jobs, so one run failing on every retry never trips
//! it. Only a failure of a run that can still be released counts, which is what
//! guarantees that a held queue always has a run to probe with.
//!
//! # Probing
//!
//! The first publish job that succeeds ends the hold. So that one is attempted
//! without a person, a held queue is probed: whenever no publish job is in flight
//! and none has finished for the [probe interval](probe_interval), one is due for
//! the failed run whose latest attempt is oldest, whatever that run's own wait or
//! age ([`Assessment::probe_order`]). A probe that fails makes its run the most
//! recently attempted, so the probes go round the failed runs in turn and one run
//! that fails for a reason of its own does not keep the rest from being tried.

use std::collections::{HashMap, HashSet};

use test_cabinet_entities::publish_job;
use time::format_description::well_known::Rfc3339;
use time::{Duration, OffsetDateTime};

/// The wait before the first retry of a run's failed publish.
pub const FIRST_RETRY_WAIT: Duration = Duration::minutes(5);

/// The longest wait between two retries of one run.
pub const MAX_RETRY_WAIT: Duration = Duration::hours(4);

/// How long after a run's first failed publish its retries go on. Past it the run
/// waits for a person.
pub const RETRY_BUDGET: Duration = Duration::hours(24);

/// The probe interval of a hold that has just begun.
pub const FIRST_PROBE_INTERVAL: Duration = Duration::minutes(5);

/// The longest a held queue goes without a publish attempt.
pub const MAX_PROBE_INTERVAL: Duration = Duration::minutes(30);

/// How many different runs must fail in a row before new runs are held, unless
/// `TCAB_PUBLISH_FAILURE_HOLD_RUNS` says otherwise.
pub const DEFAULT_HOLD_RUNS: u32 = 5;

/// The hold publish failures put on new runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublishHold {
    /// How many different runs have failed to publish since a publish last
    /// succeeded.
    pub failing_runs: u32,
    /// The reason the most recent failed publish job recorded.
    pub latest_error: Option<String>,
}

/// An unpublished run whose latest publish job failed, with no publish job in
/// flight.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FailedRun {
    /// The run's id.
    pub run_id: String,
    /// How many of the run's publish jobs have failed in a row, the latest
    /// included.
    pub consecutive_failures: u32,
    /// When the first job of that streak failed.
    pub first_failed_at: OffsetDateTime,
    /// When the latest job failed.
    pub last_failed_at: OffsetDateTime,
}

impl FailedRun {
    /// When the run's next retry is due: the latest failure plus the wait its
    /// streak has earned.
    pub fn retry_at(&self) -> OffsetDateTime {
        self.last_failed_at + retry_wait(self.consecutive_failures)
    }

    /// Whether the run's retries are still going at `now`: less than
    /// [`RETRY_BUDGET`] has passed since its first failure.
    pub fn within_budget(&self, now: OffsetDateTime) -> bool {
        now - self.first_failed_at < RETRY_BUDGET
    }

    /// Whether the run is retried at `now` on its own schedule.
    pub fn due(&self, now: OffsetDateTime) -> bool {
        self.within_budget(now) && now >= self.retry_at()
    }
}

/// The wait after a run's `consecutive_failures`-th consecutive failure:
/// [`FIRST_RETRY_WAIT`] doubled once per failure after the first, capped at
/// [`MAX_RETRY_WAIT`].
pub fn retry_wait(consecutive_failures: u32) -> Duration {
    doubled(
        FIRST_RETRY_WAIT,
        consecutive_failures.saturating_sub(1),
        MAX_RETRY_WAIT,
    )
}

/// The probe interval of a hold that has seen `failures_since_tripped` further
/// failures since the one that began it: [`FIRST_PROBE_INTERVAL`] doubled once per
/// failure, capped at [`MAX_PROBE_INTERVAL`].
pub fn probe_interval(failures_since_tripped: u32) -> Duration {
    doubled(
        FIRST_PROBE_INTERVAL,
        failures_since_tripped,
        MAX_PROBE_INTERVAL,
    )
}

/// `first` doubled `times` times, never above `cap`.
fn doubled(first: Duration, times: u32, cap: Duration) -> Duration {
    let mut wait = first;
    for _ in 0..times {
        if wait >= cap {
            break;
        }
        wait = wait.saturating_mul(2);
    }
    wait.min(cap)
}

/// What [`assess`] reads: the publish jobs of the unpublished runs, and the two
/// facts about the rest of the table and the run table that the rules need.
#[derive(Debug, Clone, Default)]
pub struct PublishFacts {
    /// Every publish job of every unpublished run, in any order.
    pub jobs: Vec<publish_job::Model>,
    /// The unpublished runs among them that can still be released: the run
    /// exists, its tree is neither reclaimed nor recorded as not stored, it is the
    /// attempt that stands, and it passes the publish gate as it stands now.
    pub releasable: HashSet<String>,
    /// When the most recently finished successful publish job, of any run,
    /// finished.
    pub last_success: Option<OffsetDateTime>,
}

/// What the publish job table amounts to at one instant.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Assessment {
    /// The hold on new runs, when publish failures call for one.
    pub hold: Option<PublishHold>,
    /// The releasable runs whose latest publish job failed and that have no
    /// publish job in flight, the one whose streak began first leading.
    pub failed_runs: Vec<FailedRun>,
    /// Whether any publish job is queued or dispatched.
    pub in_flight: bool,
    /// Whether a held queue is due a probe: nothing is in flight and nothing has
    /// finished for the probe interval. Always `false` without a hold.
    pub probe_due: bool,
}

impl Assessment {
    /// The failed runs in the order a held queue probes them: the run whose
    /// latest attempt is oldest first.
    ///
    /// A probe that fails moves its run to the back, so successive probes take
    /// each failed run in turn.
    pub fn probe_order(&self) -> Vec<&FailedRun> {
        let mut runs: Vec<&FailedRun> = self.failed_runs.iter().collect();
        runs.sort_by(|a, b| {
            a.last_failed_at
                .cmp(&b.last_failed_at)
                .then_with(|| a.first_failed_at.cmp(&b.first_failed_at))
                .then_with(|| a.run_id.cmp(&b.run_id))
        });
        runs
    }
}

/// A publish job that finished in failure, with its instant parsed.
struct Failure<'a> {
    job: &'a publish_job::Model,
    at: OffsetDateTime,
}

/// Parse an RFC 3339 column value.
fn instant(value: &str) -> Option<OffsetDateTime> {
    OffsetDateTime::parse(value, &Rfc3339).ok()
}

/// Assess `facts` at `now`. `hold_runs` is how many different runs must fail in a
/// row before new runs are held, `0` meaning never.
///
/// A job's finishing instant is its `updated_at`, which a terminal state stamps
/// last. A finished job whose instant does not parse cannot be placed in the
/// order, so it counts toward nothing: it neither holds the queue nor schedules a
/// retry. A failure at the very instant of the latest success is taken as before
/// it.
pub fn assess(facts: &PublishFacts, hold_runs: u32, now: OffsetDateTime) -> Assessment {
    let in_flight = facts
        .jobs
        .iter()
        .any(|job| job.state == "queued" || job.state == "dispatched");

    // Each run's finished jobs, oldest first, and whether it has one in flight.
    let mut by_run: HashMap<&str, Vec<(&publish_job::Model, OffsetDateTime)>> = HashMap::new();
    let mut busy: HashSet<&str> = HashSet::new();
    for job in &facts.jobs {
        match job.state.as_str() {
            "queued" | "dispatched" => {
                busy.insert(job.run_id.as_str());
            }
            "succeeded" | "failed" => {
                if let Some(at) = instant(&job.updated_at) {
                    by_run
                        .entry(job.run_id.as_str())
                        .or_default()
                        .push((job, at));
                }
            }
            _ => {}
        }
    }

    let mut failed_runs = Vec::new();
    for (run_id, jobs) in &mut by_run {
        if busy.contains(run_id) || !facts.releasable.contains(*run_id) {
            continue;
        }
        jobs.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.id.cmp(&b.0.id)));
        let streak: Vec<OffsetDateTime> = jobs
            .iter()
            .rev()
            .take_while(|(job, _)| job.state == "failed")
            .map(|(_, at)| *at)
            .collect();
        let (Some(last), Some(first)) = (streak.first(), streak.last()) else {
            continue;
        };
        failed_runs.push(FailedRun {
            run_id: run_id.to_string(),
            consecutive_failures: u32::try_from(streak.len()).unwrap_or(u32::MAX),
            first_failed_at: *first,
            last_failed_at: *last,
        });
    }
    failed_runs.sort_by(|a, b| {
        a.first_failed_at
            .cmp(&b.first_failed_at)
            .then_with(|| a.run_id.cmp(&b.run_id))
    });

    // The failures since publishing last worked, oldest first.
    let mut failures: Vec<Failure<'_>> = facts
        .jobs
        .iter()
        .filter(|job| job.state == "failed" && facts.releasable.contains(&job.run_id))
        .filter_map(|job| instant(&job.updated_at).map(|at| Failure { job, at }))
        .filter(|failure| {
            facts
                .last_success
                .is_none_or(|success| failure.at > success)
        })
        .collect();
    failures.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| a.job.id.cmp(&b.job.id)));

    let mut runs: HashSet<&str> = HashSet::new();
    let mut tripped_at = None;
    for (index, failure) in failures.iter().enumerate() {
        runs.insert(failure.job.run_id.as_str());
        if tripped_at.is_none() && hold_runs > 0 && runs.len() >= hold_runs as usize {
            tripped_at = Some(index);
        }
    }
    let (hold, probe_due) = match (tripped_at, failures.last()) {
        (Some(tripped), Some(latest)) => {
            let since = u32::try_from(failures.len() - 1 - tripped).unwrap_or(u32::MAX);
            (
                Some(PublishHold {
                    failing_runs: u32::try_from(runs.len()).unwrap_or(u32::MAX),
                    latest_error: latest.job.detail.clone(),
                }),
                !in_flight && now >= latest.at + probe_interval(since),
            )
        }
        _ => (None, false),
    };

    Assessment {
        hold,
        failed_runs,
        in_flight,
        probe_due,
    }
}

#[cfg(test)]
#[path = "publish_health.test.rs"]
mod tests;
