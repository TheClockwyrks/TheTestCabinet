//! The retry of failed publishes, and the hold publish failures put on new runs.
//!
//! [Automatic publishing](super::auto_publish) enqueues a run's first publish job.
//! This module takes up every run whose latest publish job failed, whoever
//! enqueued it. The rules are [`crate::publish_health`]'s, pure functions of the
//! publish job table; what is here reads the table, acts on the rules' answer
//! through the one enqueue every publish goes through
//! ([`enqueue_publish`]), and hands the hold to the
//! [capacity monitor](crate::capacity::CapacityMonitor) to report.
//!
//! One [pass](failed_publish_pass) does four things, in order:
//!
//! 1. It ends each publish job whose publisher never reported, as a failure.
//! 2. It enqueues a publish job for each failed run that is due one on its own
//!    schedule.
//! 3. While publish failures hold new runs, and nothing was enqueued, nothing is in
//!    flight and nothing has finished for the probe interval, it enqueues one for
//!    the failed run whose latest attempt is oldest, whatever that run's wait or
//!    age, so successive probes take each failed run in turn. A run the gate
//!    refuses is passed over for the next.
//! 4. It derives the hold again and announces a change.
//!
//! A run never has two publish jobs in flight: a run with one is no candidate, and
//! the enqueue attaches to a live job rather than adding a second. A run with no
//! stored tree is no candidate either, and the gate's refusal records no job. An
//! operator's publish goes through the same enqueue at any time and waits on
//! nothing here.
//!
//! The pass is best-effort like automatic publishing. A step that fails is logged
//! and the next pass, [`PASS_INTERVAL`] later, does it again.

use std::time::Duration;

use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use super::AppState;
use super::publish_gate::{GatedEnqueue, enqueue_publish};
use crate::db::PublishEnqueue;
use crate::error::Result;
use crate::publish_health::{Assessment, FailedRun, assess};

/// How often the pass runs. It bounds how late a retry or a probe starts after it
/// falls due, and each pass that finds nothing due costs three small reads.
pub(crate) const PASS_INTERVAL: Duration = Duration::from_secs(30);

/// What one [`failed_publish_pass`] did.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct PassOutcome {
    /// The publish jobs ended as failures because their publishers never
    /// reported.
    pub abandoned: Vec<String>,
    /// The runs a publish job was enqueued for on their own schedule.
    pub retried: Vec<String>,
    /// The run a publish job was enqueued for as the held queue's probe.
    pub probed: Option<String>,
}

/// Why a publish job is being enqueued, named in the log line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Cause {
    /// The run's own wait has passed.
    Retry,
    /// The queue is held and due a probe.
    Probe,
}

impl Cause {
    fn as_str(self) -> &'static str {
        match self {
            Self::Retry => "retry",
            Self::Probe => "hold_probe",
        }
    }
}

/// What one attempt to enqueue a failed run's next publish job came to.
enum Attempt {
    /// A new publish job was enqueued.
    Enqueued,
    /// Nothing was enqueued for this run; the next may be tried.
    PassedOver,
    /// The artifact service gave no answer, so no other run is asked about in
    /// this pass.
    ServiceUnavailable,
}

/// Read the publish job table and assess it at `now`.
async fn assess_now(state: &AppState, now: OffsetDateTime) -> Result<Assessment> {
    let facts = state.db.publish_facts().await?;
    Ok(assess(&facts, state.config.publish_failure_hold_runs, now))
}

/// Derive the publish-failure hold from the publish job table, hand it to the
/// capacity monitor, and log and announce the change it makes, if any.
///
/// Called before every run claim, after every publish result, on every status
/// request and by every pass. The claim is the one that fails on an unreadable
/// table: it hands out no run on a hold it could not derive.
///
/// Returns whether publish failures hold new runs, as just derived. The claim
/// decides on this answer and not on the monitor's copy, which another caller
/// that read the table a moment earlier may overwrite in between.
pub(crate) async fn refresh_publish_hold(state: &AppState) -> Result<bool> {
    let assessment = assess_now(state, OffsetDateTime::now_utc()).await?;
    let held = assessment.hold.is_some();
    apply_hold(state, assessment);
    Ok(held)
}

/// [`refresh_publish_hold`] for a caller that carries on without it, logging the
/// failure.
pub(crate) async fn refresh_publish_hold_best_effort(state: &AppState) {
    if let Err(error) = refresh_publish_hold(state).await {
        tracing::warn!(%error, "could not read whether publish failures hold new runs");
    }
}

/// Hand an assessment's hold to the capacity monitor and announce a change.
fn apply_hold(state: &AppState, assessment: Assessment) {
    state.capacity.set_publish_hold(assessment.hold);
    state.capacity.announce(state.relay.notifier());
}

/// One pass of the retry at `now`; see the [module](self) for its steps. Nothing
/// here returns an error: a step that fails is logged and left to the next pass.
pub(crate) async fn failed_publish_pass(state: &AppState, now: OffsetDateTime) -> PassOutcome {
    let mut outcome = PassOutcome::default();
    let now_text = match now.format(&Rfc3339) {
        Ok(text) => text,
        Err(error) => {
            tracing::warn!(%error, "formatting the retry pass's instant");
            return outcome;
        }
    };

    match state.db.fail_abandoned_publish_jobs(&now_text).await {
        Ok(abandoned) => {
            for job in abandoned {
                tracing::warn!(
                    publish_job.id = %job.id,
                    run.id = %job.run_id,
                    "a publish job's publisher never reported; the job is recorded as failed"
                );
                super::publish_jobs::close_abandoned(state, &job).await;
                outcome.abandoned.push(job.id);
            }
        }
        Err(error) => {
            tracing::warn!(%error, "could not end the publish jobs whose publishers never reported");
        }
    }

    let assessment = match assess_now(state, now).await {
        Ok(assessment) => assessment,
        Err(error) => {
            tracing::warn!(%error, "the retry of failed publishes could not read the publish jobs");
            return outcome;
        }
    };

    let mut service_unavailable = false;
    for run in assessment.failed_runs.iter().filter(|run| run.due(now)) {
        match attempt(state, run, &now_text, Cause::Retry).await {
            Attempt::Enqueued => outcome.retried.push(run.run_id.clone()),
            Attempt::PassedOver => {}
            Attempt::ServiceUnavailable => {
                service_unavailable = true;
                break;
            }
        }
    }

    // The probe is what finds a recovery when every failed run is waiting out its
    // own schedule or has used it up. A retry enqueued above is one already.
    if assessment.probe_due && outcome.retried.is_empty() && !service_unavailable {
        for run in assessment.probe_order() {
            match attempt(state, run, &now_text, Cause::Probe).await {
                Attempt::Enqueued => {
                    outcome.probed = Some(run.run_id.clone());
                    break;
                }
                Attempt::PassedOver => {}
                Attempt::ServiceUnavailable => break,
            }
        }
    }

    // The gate may have recorded a run as having no stored tree, which takes it
    // out of the count, so the hold is derived again rather than reused.
    match assess_now(state, now).await {
        Ok(assessment) => apply_hold(state, assessment),
        Err(error) => {
            tracing::warn!(%error, "could not read whether publish failures hold new runs");
        }
    }
    outcome
}

/// Enqueue the next publish job of `run` through the shared gate.
async fn attempt(state: &AppState, run: &FailedRun, now: &str, cause: Cause) -> Attempt {
    let run_id = &run.run_id;
    match enqueue_publish(state, run_id, now).await {
        Ok(GatedEnqueue::Enqueued(PublishEnqueue::Enqueued(publish_job_id))) => {
            tracing::info!(
                run.id = %run_id,
                publish_job.id = %publish_job_id,
                cause = cause.as_str(),
                consecutive_failures = run.consecutive_failures,
                "a failed publish is being retried: publish job enqueued"
            );
            Attempt::Enqueued
        }
        // A person's publish landed between the read and here. It is the attempt.
        Ok(GatedEnqueue::Enqueued(PublishEnqueue::Attached(_))) => Attempt::PassedOver,
        Ok(GatedEnqueue::NoStoredTree) => {
            tracing::warn!(
                run.id = %run_id,
                cause = cause.as_str(),
                reason = "no_stored_tree",
                "a failed publish is not retried: the run's artifact tree is not stored"
            );
            Attempt::PassedOver
        }
        Ok(GatedEnqueue::Reclaimed(_)) => {
            tracing::info!(
                run.id = %run_id,
                cause = cause.as_str(),
                reason = "reclaimed",
                "a failed publish is not retried: the run's artifacts were removed \
                 after the retention period"
            );
            Attempt::PassedOver
        }
        Ok(GatedEnqueue::ArtifactsUnavailable(error)) => {
            tracing::warn!(
                run.id = %run_id,
                cause = cause.as_str(),
                reason = "artifacts_unavailable",
                %error,
                "a failed publish was not retried: the artifact service could not say \
                 whether the run's tree is stored; the next pass asks again"
            );
            Attempt::ServiceUnavailable
        }
        Err(error) => {
            tracing::warn!(
                run.id = %run_id,
                cause = cause.as_str(),
                %error,
                "a failed publish could not be retried; the next pass tries again"
            );
            Attempt::PassedOver
        }
    }
}

/// Spawn the retry of failed publishes: one [pass](failed_publish_pass) every
/// [`PASS_INTERVAL`], for the life of the process. The hold is derived once at the
/// start, so a backend that starts while publishing is failing says so before its
/// first pass.
pub(crate) fn spawn_failed_publish_retry(state: AppState) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        refresh_publish_hold_best_effort(&state).await;
        loop {
            tokio::time::sleep(PASS_INTERVAL).await;
            failed_publish_pass(&state, OffsetDateTime::now_utc()).await;
        }
    })
}

#[cfg(test)]
#[path = "publish_retry.test.rs"]
mod tests;
