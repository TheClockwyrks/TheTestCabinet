//! Automatic publishing: a completed, validator-rated run publishes itself.
//!
//! Three things hand runs to [`auto_publish_runs`]. The driver's terminal status
//! report hands it the run that just landed, which covers every run however it was
//! launched. A ladder launch pass hands it the runs its board counts, which covers
//! a run a dispatch inherited rather than launched. The [periodic
//! retry](spawn_auto_publish_retry) hands it the runs an earlier pass could not
//! publish. The rule that decides which of those runs publish lives in the
//! database layer
//! ([`Db::auto_publish_candidates`](crate::db::Db::auto_publish_candidates)), and
//! the enqueue is the one a person's publish goes through ([`enqueue_publish`]),
//! which first checks that the run has a stored artifact tree to release.
//!
//! A run with no stored tree is passed over with no publish job recorded, and so
//! is a run the artifact service could not be asked about. Neither uses up the
//! run's one automatic attempt, since the candidate rule counts publish jobs and
//! none was written. The run is marked deferred instead, which does two things.
//! The retry offers it again every [`RETRY_INTERVAL`], so a run that finished
//! during an outage of the artifact service publishes once the service answers,
//! with no trigger of its own left to fire. And the two triggers leave it to the
//! retry, so an outage costs a status report or a launch pass one unanswered
//! question, not one per run it has already asked about.
//!
//! Automatic publishing is best-effort: nothing here returns an error, so the
//! status report or launch pass that called it is never failed by it. It can wait
//! on the artifact service once per call, for as long as one presence query may
//! take, because a pass stops asking at the first unanswered question. A run it
//! could not enqueue stays in the Unpublished worklist for a person.

use std::time::Duration;

use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use super::AppState;
use super::publish_gate::{GatedEnqueue, enqueue_publish};
use crate::db::PublishEnqueue;

/// How often the retry offers the deferred runs to automatic publishing again.
/// Short next to how long an outage of the artifact service lasts, and long enough
/// that the one question a pass asks of a service still down is no load on it.
pub(crate) const RETRY_INTERVAL: Duration = Duration::from_secs(5 * 60);

/// What handed a run to [`auto_publish_runs`], named in its log lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AutoPublishCause {
    /// The run's driver reported it terminal.
    RunFinished,
    /// A ladder launch pass counted the run toward a rung.
    LadderPass,
    /// The periodic retry offered a run an earlier pass could not publish.
    Retry,
}

impl AutoPublishCause {
    fn as_str(self) -> &'static str {
        match self {
            Self::RunFinished => "run_finished",
            Self::LadderPass => "ladder_pass",
            Self::Retry => "retry",
        }
    }
}

/// Enqueue a publish job for each of `run_ids` that publishes itself, and return
/// the ids of the runs a job was newly enqueued for.
///
/// A run that does not qualify is passed over silently, and a failure to read
/// the candidates or to enqueue one of them is logged and swallowed, the rest
/// still being tried. A qualifying run with no stored artifact tree, or whose tree
/// the artifact service could not be asked about, is passed over with a `warn`
/// and marked deferred.
///
/// Which candidates are asked about depends on `cause`:
///
/// - A trigger leaves a run already deferred to the retry.
/// - A run recorded as not stored is deferred unasked, and the retry leaves it
///   alone while the record stands. A lost tree stays lost, and the run is asked
///   about again once the reclamation sweep's reconciliation finds a tree for it.
/// - Once the artifact service fails to answer, the rest of the pass is deferred
///   unasked.
pub(crate) async fn auto_publish_runs(
    state: &AppState,
    run_ids: &[String],
    cause: AutoPublishCause,
) -> Vec<String> {
    if run_ids.is_empty() {
        return Vec::new();
    }
    let candidates = match state.db.auto_publish_candidates(run_ids).await {
        Ok(candidates) => candidates,
        Err(error) => {
            tracing::warn!(
                cause = cause.as_str(),
                %error,
                "automatic publishing could not read its candidate runs"
            );
            return Vec::new();
        }
    };
    let retrying = cause == AutoPublishCause::Retry;
    let mut enqueued = Vec::new();
    let mut deferred = Vec::new();
    let mut service_unavailable = false;
    for candidate in candidates {
        let run_id = candidate.run_id;
        if !retrying && candidate.deferred {
            continue;
        }
        if candidate.artifacts_stored == Some(false) {
            // Nothing to ask: the driver's report or a reconciliation has already
            // said so. Marked for the retry, which takes it up if a tree is found.
            if !candidate.deferred {
                deferred.push(run_id);
            }
            continue;
        }
        if service_unavailable {
            deferred.push(run_id);
            continue;
        }
        let now = match OffsetDateTime::now_utc().format(&Rfc3339) {
            Ok(now) => now,
            Err(error) => {
                tracing::warn!(run.id = %run_id, %error, "formatting the enqueue time");
                continue;
            }
        };
        match enqueue_publish(state, &run_id, &now).await {
            Ok(GatedEnqueue::Enqueued(PublishEnqueue::Enqueued(publish_job_id))) => {
                tracing::info!(
                    run.id = %run_id,
                    publish_job.id = %publish_job_id,
                    cause = cause.as_str(),
                    "run published automatically: publish job enqueued"
                );
                enqueued.push(run_id);
            }
            // Another trigger enqueued it between the candidate read and here.
            Ok(GatedEnqueue::Enqueued(PublishEnqueue::Attached(_))) => {}
            Ok(GatedEnqueue::NoStoredTree) => {
                tracing::warn!(
                    run.id = %run_id,
                    cause = cause.as_str(),
                    reason = "no_stored_tree",
                    "automatic publishing passed over a run: its artifact tree is not \
                     stored, so there is nothing to release"
                );
                deferred.push(run_id);
            }
            Ok(GatedEnqueue::ArtifactsUnavailable(error)) => {
                tracing::warn!(
                    run.id = %run_id,
                    cause = cause.as_str(),
                    reason = "artifacts_unavailable",
                    %error,
                    "automatic publishing passed over a run: the artifact service could \
                     not say whether its tree is stored; the run is retried"
                );
                deferred.push(run_id);
                service_unavailable = true;
            }
            Err(error) => tracing::warn!(
                run.id = %run_id,
                cause = cause.as_str(),
                %error,
                "automatic publishing could not enqueue a publish job; \
                 the run stays unpublished until it is published by hand"
            ),
        }
    }
    if let Err(error) = state.db.defer_auto_publish(&deferred).await {
        tracing::warn!(
            cause = cause.as_str(),
            runs = deferred.len(),
            %error,
            "could not mark the runs automatic publishing passed over; \
             they are not retried until a trigger reaches them again"
        );
    }
    enqueued
}

/// One pass of the periodic retry: offer every deferred run to automatic
/// publishing again, then clear the mark on each that no longer waits on it.
/// Returns the ids of the runs a publish job was newly enqueued for.
pub(crate) async fn retry_deferred_runs(state: &AppState) -> Vec<String> {
    let deferred = match state.db.auto_publish_deferred_runs().await {
        Ok(deferred) => deferred,
        Err(error) => {
            tracing::warn!(%error, "could not read the runs automatic publishing deferred");
            return Vec::new();
        }
    };
    if deferred.is_empty() {
        return Vec::new();
    }
    let enqueued = auto_publish_runs(state, &deferred, AutoPublishCause::Retry).await;
    match state.db.settle_auto_publish_deferred(&deferred).await {
        // Logged only when the pass changed something: a run whose tree is lost
        // for good stays deferred, and would otherwise log this every interval.
        Ok(settled) if settled > 0 || !enqueued.is_empty() => tracing::info!(
            deferred = deferred.len(),
            enqueued = enqueued.len(),
            settled,
            "automatic publishing retried its deferred runs"
        ),
        Ok(_) => {}
        Err(error) => tracing::warn!(
            %error,
            "could not clear the mark on the deferred runs that were published"
        ),
    }
    enqueued
}

/// Spawn the periodic retry: one [`retry_deferred_runs`] pass every
/// [`RETRY_INTERVAL`], for the life of the process.
pub(crate) fn spawn_auto_publish_retry(state: AppState) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(RETRY_INTERVAL).await;
            retry_deferred_runs(&state).await;
        }
    })
}

#[cfg(test)]
#[path = "auto_publish.test.rs"]
mod tests;
