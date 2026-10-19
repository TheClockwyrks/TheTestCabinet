//! The retry of failed publishes: the backend enqueues another publish job for
//! every unpublished run whose latest publish job failed, on the schedule of
//! [`crate::publish_retry`] (the backend results page's "Retrying a failed
//! publish").
//!
//! One [pass](failed_publish_pass) runs every [`PASS_INTERVAL`] and does two
//! things, in order:
//!
//! 1. It records every publish job `dispatched` for an hour with no result as
//!    failed ([`Db::fail_abandoned_publish_jobs`](crate::db::Db::fail_abandoned_publish_jobs)),
//!    raising the publish-failed notification and closing its live stream as a
//!    publisher's own failure does. Such a job is then retried like any other
//!    failure.
//! 2. For each unpublished run that is not an attempt an automatic retry
//!    replaced, whose latest publish job failed, that has no publish job in
//!    flight and that is due a retry, it applies the publish gate again as the
//!    run stands now and, when the run still passes, enqueues a publish job
//!    through the one enqueue every publish goes through
//!    ([`Db::enqueue_publish_job_once`](crate::db::Db::enqueue_publish_job_once)).
//!
//! The gate is the widest one a publish job can have come through
//! ([`Db::ensure_publishable_comparison_run`](crate::db::Db::ensure_publishable_comparison_run),
//! which also admits a comparison's run on its automated verdicts), since a failed
//! job does not say which path enqueued it. A run it refuses stopped being
//! publishable after its publish failed and is left unpublished; nothing is
//! recorded for it.
//!
//! An operator's publish is untouched by any of this: it is accepted at any time,
//! and a job it enqueued that fails counts as one more consecutive failure of the
//! run. [Automatic publishing](super::auto_publish) still enqueues only a run's
//! first publish job.
//!
//! The pass is best-effort like automatic publishing: a step that fails is logged,
//! and the next pass does it again.

use std::time::Duration;

use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use super::AppState;
use crate::db::{PUBLISHER_NEVER_REPORTED, PublishEnqueue};
use crate::error::BackendError;
use crate::publish_retry::{FailedRun, failed_runs};

/// How often the pass runs, which bounds how late a retry starts after it falls
/// due and how late an abandoned publish job is recorded failed.
pub(crate) const PASS_INTERVAL: Duration = Duration::from_secs(30);

/// What one [`failed_publish_pass`] did.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct PassOutcome {
    /// The publish jobs recorded failed because their publishers never reported.
    pub abandoned: Vec<String>,
    /// The runs a publish job was enqueued for.
    pub retried: Vec<String>,
    /// The runs due a retry that the publish gate now refuses.
    pub refused: Vec<String>,
}

/// One pass of the retry at `now`; see the [module](self). Nothing here returns an
/// error: a step that fails is logged and left to the next pass.
pub(crate) async fn failed_publish_pass(state: &AppState, now: OffsetDateTime) -> PassOutcome {
    let mut outcome = PassOutcome::default();
    let now_text = match now.format(&Rfc3339) {
        Ok(text) => text,
        Err(error) => {
            tracing::warn!(%error, "formatting the publish retry pass's instant");
            return outcome;
        }
    };

    match state.db.fail_abandoned_publish_jobs(&now_text).await {
        Ok(abandoned) => {
            for job in abandoned {
                tracing::warn!(
                    publish_job.id = %job.id,
                    run.id = %job.run_id,
                    "a publish job's publisher never reported a result; the job is \
                     recorded as failed"
                );
                let detail = job.detail.as_deref().unwrap_or(PUBLISHER_NEVER_REPORTED);
                super::publish_jobs::record_publish_failed(state, &job, detail).await;
                outcome.abandoned.push(job.id);
            }
        }
        Err(error) => tracing::warn!(
            %error,
            "could not record the publish jobs whose publishers never reported"
        ),
    }

    let jobs = match state.db.publish_jobs_of_retryable_runs().await {
        Ok(jobs) => jobs,
        Err(error) => {
            tracing::warn!(
                %error,
                "the retry of failed publishes could not read the publish jobs"
            );
            return outcome;
        }
    };
    for run in failed_runs(&jobs).into_iter().filter(|run| run.due(now)) {
        retry(state, &run, &now_text, &mut outcome).await;
    }
    outcome
}

/// Gate `run` again and enqueue its next publish job, recording what came of it in
/// `outcome`.
async fn retry(state: &AppState, run: &FailedRun, now: &str, outcome: &mut PassOutcome) {
    let run_id = run.run_id.as_str();
    match state.db.ensure_publishable_comparison_run(run_id).await {
        Ok(()) => {}
        Err(BackendError::Unprocessable(reason) | BackendError::NotFound(reason)) => {
            tracing::info!(
                run.id = %run_id,
                consecutive_failures = run.consecutive_failures,
                %reason,
                "a failed publish is not retried: the run is no longer publishable"
            );
            outcome.refused.push(run.run_id.clone());
            return;
        }
        Err(error) => {
            tracing::warn!(
                run.id = %run_id,
                %error,
                "a failed publish could not be gated for its retry; the next pass \
                 tries again"
            );
            return;
        }
    }
    match state.db.enqueue_publish_job_once(run_id, now).await {
        Ok(PublishEnqueue::Enqueued(publish_job_id)) => {
            tracing::info!(
                run.id = %run_id,
                publish_job.id = %publish_job_id,
                consecutive_failures = run.consecutive_failures,
                "a failed publish is being retried: publish job enqueued"
            );
            outcome.retried.push(run.run_id.clone());
        }
        // An operator's publish landed between the read and here; it is the attempt.
        Ok(PublishEnqueue::Attached(_)) => {}
        Err(error) => tracing::warn!(
            run.id = %run_id,
            %error,
            "a failed publish could not be retried; the next pass tries again"
        ),
    }
}

/// Spawn the retry of failed publishes: one [pass](failed_publish_pass) every
/// [`PASS_INTERVAL`], for as long as the returned task runs.
pub(crate) fn spawn_failed_publish_retry(state: AppState) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(PASS_INTERVAL).await;
            failed_publish_pass(&state, OffsetDateTime::now_utc()).await;
        }
    })
}

#[cfg(test)]
#[path = "publish_retry.test.rs"]
mod tests;
