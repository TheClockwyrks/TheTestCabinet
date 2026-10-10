//! Automatic publishing: a completed, validator-rated run publishes itself.
//!
//! Two triggers hand runs to [`auto_publish_runs`]. The driver's terminal status
//! report hands it the run that just landed, which covers every run however it was
//! launched; a ladder launch pass hands it the runs its board counts, which covers
//! a run a dispatch inherited rather than launched. The rule that decides which of
//! those runs publish lives in the database layer
//! ([`Db::auto_publishable_among`](crate::db::Db::auto_publishable_among)), and
//! the enqueue is the one a person's publish goes through
//! ([`Db::enqueue_publish_job_once`](crate::db::Db::enqueue_publish_job_once)).
//!
//! Automatic publishing is best-effort: nothing here returns an error, so the
//! status report or launch pass that called it is never failed or held up by it.
//! A run it could not enqueue stays in the Unpublished worklist for a person.

use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use super::AppState;
use crate::db::PublishEnqueue;

/// What handed a run to [`auto_publish_runs`], named in its log lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AutoPublishCause {
    /// The run's driver reported it terminal.
    RunFinished,
    /// A ladder launch pass counted the run toward a rung.
    LadderPass,
}

impl AutoPublishCause {
    fn as_str(self) -> &'static str {
        match self {
            Self::RunFinished => "run_finished",
            Self::LadderPass => "ladder_pass",
        }
    }
}

/// Enqueue a publish job for each of `run_ids` that publishes itself, and return
/// the ids of the runs a job was newly enqueued for.
///
/// A run that does not qualify is passed over silently, and a failure to read
/// the candidates or to enqueue one of them is logged and swallowed, the rest
/// still being tried.
pub(crate) async fn auto_publish_runs(
    state: &AppState,
    run_ids: &[String],
    cause: AutoPublishCause,
) -> Vec<String> {
    if run_ids.is_empty() {
        return Vec::new();
    }
    let candidates = match state.db.auto_publishable_among(run_ids).await {
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
    let mut enqueued = Vec::new();
    for run_id in candidates {
        let now = match OffsetDateTime::now_utc().format(&Rfc3339) {
            Ok(now) => now,
            Err(error) => {
                tracing::warn!(run.id = %run_id, %error, "formatting the enqueue time");
                continue;
            }
        };
        match state.db.enqueue_publish_job_once(&run_id, &now).await {
            Ok(PublishEnqueue::Enqueued(publish_job_id)) => {
                tracing::info!(
                    run.id = %run_id,
                    publish_job.id = %publish_job_id,
                    cause = cause.as_str(),
                    "run published automatically: publish job enqueued"
                );
                enqueued.push(run_id);
            }
            // Another trigger enqueued it between the candidate read and here.
            Ok(PublishEnqueue::Attached(_)) => {}
            Err(error) => tracing::warn!(
                run.id = %run_id,
                cause = cause.as_str(),
                %error,
                "automatic publishing could not enqueue a publish job; \
                 the run stays unpublished until it is published by hand"
            ),
        }
    }
    enqueued
}

#[cfg(test)]
#[path = "auto_publish.test.rs"]
mod tests;
