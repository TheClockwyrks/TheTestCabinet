//! Rescuing a **dying** run container's [replay journal](crate::gg_replay_journal)
//! before the container is torn down.
//!
//! Every other post-session read of a run goes through the collected working tree: the
//! engine copies `/work` out, stops the container, and hands the tree to the
//! [post-run stages](crate::post_run). A run that *hangs* or *runs past its cap* never
//! gets there. Its session ends in an [`Err`](crate::Error) — [`HarnessHung`] or
//! [`RunTimedOut`] — and the engine's error path stops the container and returns
//! immediately, without collecting anything. So the one run whose replay would be most
//! worth reading is precisely the one that has none.
//!
//! [`HarnessHung`]: crate::Error::HarnessHung
//! [`RunTimedOut`]: crate::Error::RunTimedOut
//!
//! This module closes that gap with the narrowest possible copy:
//! [`ArtifactCollector::collect_file`] pulls the single journal file out of the container
//! into a scratch directory shaped exactly like a collected tree, and the ordinary
//! [replay assembly stage](crate::gg_replay_assembly::GgReplayAssembler) folds it into the
//! run tree's `replay.json.gz` as if the run had ended normally. The assembled record
//! reports itself
//! [`SessionKilled`](crate::gg_replay::GgReplayTruncationReason::SessionKilled), because a
//! journal cut off mid-session carries no terminating line — which is the honest
//! description of what happened.
//!
//! # Why only the journal, and not the tree
//!
//! Salvaging the *implementation tree* from a hung container was considered and
//! deliberately rejected. It would change what a hung run **means** to validation,
//! publishing and the review worklist: a hung run would suddenly carry a half-written
//! build that reviewers could open, score and publish, with no way to tell it apart from
//! one the model finished. The journal has no such problem — it is a diagnostic that
//! renders no verdict and reaches no score — so it is the only thing rescued here.
//!
//! # Why a failure here is never a failure
//!
//! This runs on a path that is *already* failing a run. Anything it does must be
//! subordinate to reporting that failure accurately, so every outcome short of success is
//! swallowed: an unreachable container, a run that never recorded, a scratch directory
//! that cannot be made. The absent artifact is the signal. Turning a diagnosable timeout
//! into an unexplained collection error would destroy the very information the salvage
//! exists to preserve.

use tempfile::TempDir;

use crate::execution::{ArtifactCollector, ContainerHandle, WORKSPACE_DIR};
use crate::gg_replay_journal::GG_REPLAY_JOURNAL_PATH;

/// The absolute in-container path a recording gg session writes its journal to.
///
/// [`GG_REPLAY_JOURNAL_PATH`] is workspace-relative because that is how every host-side
/// reader wants it — joined onto a collected tree. Salvage is the one caller that needs
/// the container's own view of it, since it copies the file *before* any tree exists.
pub fn journal_container_path() -> String {
    format!("{WORKSPACE_DIR}/{GG_REPLAY_JOURNAL_PATH}")
}

/// Copy the replay journal out of a still-running `handle` into a fresh scratch directory,
/// laid out like a collected working tree with the journal at its usual relative path.
///
/// Returns the scratch directory on success — the caller keeps it alive for as long as it
/// reads from it, and its contents vanish with it. `None` means there is nothing to
/// assemble, for any reason at all: the collector cannot reach the container, the run
/// wrote no journal, or the copy produced an empty file (a session that died before its
/// header line reached disk assembles into nothing, so it is reported as absent rather
/// than handed on to fail).
pub(crate) async fn salvage_journal_tree(
    collector: &dyn ArtifactCollector,
    handle: &ContainerHandle,
) -> Option<TempDir> {
    let scratch = match tempfile::tempdir() {
        Ok(scratch) => scratch,
        Err(err) => {
            tracing::warn!(error = %err, "could not create a scratch directory to salvage into");
            return None;
        }
    };
    let dest = scratch.path().join(GG_REPLAY_JOURNAL_PATH);
    // The journal lives under `.gg/`, so the scratch tree needs that directory before the
    // collector can write into it — a collector copies a file, it does not build a tree.
    if let Some(parent) = dest.parent()
        && let Err(err) = std::fs::create_dir_all(parent)
    {
        tracing::warn!(error = %err, "could not prepare the salvage scratch tree");
        return None;
    }

    let container_path = journal_container_path();
    match collector.collect_file(handle, &container_path, &dest).await {
        Ok(true) => {}
        Ok(false) => {
            // The overwhelmingly common case for a hung *third-party* harness run and for
            // any gg run that never started capturing. Debug, not warn: there is nothing
            // wrong here.
            tracing::debug!(
                path = %container_path,
                "no replay journal to salvage from the run container",
            );
            return None;
        }
        Err(err) => {
            tracing::warn!(error = %err, "salvaging the replay journal failed");
            return None;
        }
    }

    match std::fs::metadata(&dest) {
        Ok(meta) if meta.len() > 0 => {
            tracing::info!(
                bytes = meta.len(),
                "salvaged the replay journal from the run container",
            );
            Some(scratch)
        }
        Ok(_) => {
            tracing::debug!("the salvaged replay journal was empty; nothing to assemble");
            None
        }
        Err(err) => {
            tracing::warn!(error = %err, "the salvaged replay journal could not be read back");
            None
        }
    }
}

#[cfg(test)]
#[path = "salvage.test.rs"]
mod tests;
