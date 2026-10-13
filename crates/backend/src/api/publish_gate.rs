//! The one enqueue every publish goes through, and the check it makes first: that
//! the run has a stored artifact tree to release.
//!
//! A publisher Job builds a release from the tree the run's driver uploaded to the
//! artifact service. A run whose upload never landed has none, so a publish job
//! for it can only fail, after a pod has been started to find that out. The three
//! paths that enqueue a publish all call [`enqueue_publish`]:
//! [automatic publishing](super::auto_publish), a person's
//! [`POST /runs/{id}/publish`](super::runs::publish), and a
//! [comparison publish](super::comparisons::publish_comparison). Each applies its
//! own rule about *whether the run may be published* first; this decides only
//! whether there is anything to publish, and what the answer means is each
//! caller's to say.
//!
//! The artifact service is asked directly, each time. The backend's recorded
//! presence (`run.artifacts_stored`) is as old as the last sweep pass or status
//! report, and a wrong answer in either direction is expensive here: a release of
//! nothing, or a run that can never be released. The answer is written back to the
//! record, so the console reflects it at once.

use super::AppState;
use crate::artifacts::{TreePresenceError, run_tree_stored};
use crate::db::{PublishEnqueue, ReclaimReason};
use crate::error::Result;

/// What [`enqueue_publish`] did for a run.
#[derive(Debug)]
pub(crate) enum GatedEnqueue {
    /// The run's release is queued or already under way.
    Enqueued(PublishEnqueue),
    /// The artifact service holds no tree for the run. No publish job was
    /// recorded, and none can succeed until the run has a tree.
    NoStoredTree,
    /// The backend reclaimed the run's tree on purpose, for the reason carried. No
    /// publish job is left recorded and none can succeed while the tree is gone.
    /// Distinct from [`NoStoredTree`](Self::NoStoredTree): nothing was lost, and
    /// nothing a later pass finds will bring the tree back.
    Reclaimed(ReclaimReason),
    /// The artifact service gave no answer, so nothing is known about the run's
    /// tree and no publish job was recorded. Not a property of the run: asking
    /// again later may well succeed.
    ArtifactsUnavailable(TreePresenceError),
}

/// The message a caller shows for [`GatedEnqueue::NoStoredTree`].
pub(crate) fn no_stored_tree_message(run_id: &str) -> String {
    format!(
        "run `{run_id}` cannot be released: its artifact tree is not stored on the \
         artifact service, so there is no source or build to publish"
    )
}

/// The message a caller shows for [`GatedEnqueue::Reclaimed`].
///
/// A published run's tree is not removed by a retention period: it goes once the
/// run's release is confirmed, so that case says so, and says what keeps such
/// trees for a deployment that publishes its runs again.
pub(crate) fn reclaimed_message(run_id: &str, reason: ReclaimReason) -> String {
    match reason {
        ReclaimReason::Published => format!(
            "run `{run_id}` cannot be published again: its artifact tree was removed \
             once its release was confirmed, so there is no source or build to publish \
             (TCAB_ARTIFACT_RECLAIM_PUBLISHED=false keeps published runs' trees)"
        ),
        ReclaimReason::Failed | ReclaimReason::Canceled => format!(
            "run `{run_id}` cannot be released: its artifacts were removed after the \
             retention period, so there is no source or build to publish"
        ),
    }
}

/// The message a caller shows for [`GatedEnqueue::ArtifactsUnavailable`].
pub(crate) fn artifacts_unavailable_message(run_id: &str, error: &TreePresenceError) -> String {
    format!(
        "could not check whether run `{run_id}`'s artifact tree is stored ({error}); \
         the run was not enqueued for publishing, try again shortly"
    )
}

/// Enqueue a publish job for `run_id`, once it is known to have a stored artifact
/// tree. `now` is the RFC 3339 enqueue instant.
///
/// A run whose release is already under way answers with that job and the service
/// is not asked: the job exists, and whether it can succeed is its own to report.
/// A run whose tree the reclamation sweep reclaimed answers
/// [`GatedEnqueue::Reclaimed`], likewise unasked.
///
/// The reclaim record is read a second time once the job is enqueued. The sweep
/// reads a run's jobs, records the reclaim, reads the jobs again and then deletes
/// ([`reclaim_run_tree`](crate::artifacts::reclaim_run_tree)); a publish that
/// read no record and was enqueued after the sweep's second read would release a
/// tree being deleted under it. With the second read here, one of the two always
/// sees the other: either the sweep finds this job and keeps the tree, or this
/// finds the sweep's record, withdraws the job it just enqueued and answers
/// [`GatedEnqueue::Reclaimed`].
/// With no artifact service configured (no in-cluster URL, or no service token to
/// present to it) the check is skipped and the run is enqueued, which is the
/// single-box development setup.
pub(crate) async fn enqueue_publish(
    state: &AppState,
    run_id: &str,
    now: &str,
) -> Result<GatedEnqueue> {
    if let Some(existing) = state.db.active_publish_job_for_run(run_id, now).await? {
        return Ok(GatedEnqueue::Enqueued(PublishEnqueue::Attached(
            existing.id,
        )));
    }
    // A reclaimed tree is known gone without asking, and asking would record the
    // answer as a presence of its own. Read before the service is consulted, and
    // whether or not one is configured.
    if let Some(reclaimed) = state.db.run_artifacts_reclaimed(run_id).await? {
        return Ok(GatedEnqueue::Reclaimed(reclaimed.reason));
    }
    if let (Some(base), Some(token)) = (
        state.config.artifacts_internal_url.as_deref(),
        state.config.service_token.as_deref(),
    ) {
        match run_tree_stored(&state.http, base, token, run_id).await {
            Ok(stored) => {
                // Keep the record in step with what was just learned. Best effort:
                // the decision below rests on the answer, not on having stored it.
                if let Err(error) = state.db.set_run_artifacts_stored(run_id, stored).await {
                    tracing::warn!(
                        run.id = %run_id,
                        %error,
                        "could not record the run's artifact presence"
                    );
                }
                if !stored {
                    return Ok(GatedEnqueue::NoStoredTree);
                }
            }
            Err(error) => return Ok(GatedEnqueue::ArtifactsUnavailable(error)),
        }
    }
    let enqueued = state.db.enqueue_publish_job_once(run_id, now).await?;
    if let PublishEnqueue::Enqueued(job_id) = &enqueued
        && let Some(reclaimed) = state.db.run_artifacts_reclaimed(run_id).await?
        // A job the dispatcher claimed in this instant is no longer ours to
        // withdraw. It reports its own failure.
        && state.db.withdraw_queued_publish_job(job_id).await?
    {
        tracing::info!(
            run.id = %run_id,
            publish_job.id = %job_id,
            reason = reclaimed.reason.as_str(),
            "withdrew a publish job enqueued as the run's artifact tree was reclaimed"
        );
        return Ok(GatedEnqueue::Reclaimed(reclaimed.reason));
    }
    Ok(GatedEnqueue::Enqueued(enqueued))
}

#[cfg(test)]
#[path = "publish_gate.test.rs"]
mod tests;
