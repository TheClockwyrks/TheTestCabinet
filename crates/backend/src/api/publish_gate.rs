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
use crate::db::PublishEnqueue;
use crate::error::Result;

/// What [`enqueue_publish`] did for a run.
#[derive(Debug)]
pub(crate) enum GatedEnqueue {
    /// The run's release is queued or already under way.
    Enqueued(PublishEnqueue),
    /// The artifact service holds no tree for the run. No publish job was
    /// recorded, and none can succeed until the run has a tree.
    NoStoredTree,
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
    Ok(GatedEnqueue::Enqueued(
        state.db.enqueue_publish_job_once(run_id, now).await?,
    ))
}

#[cfg(test)]
#[path = "publish_gate.test.rs"]
mod tests;
