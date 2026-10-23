//! The move, on start, of what an earlier release kept on the pod's disk into its
//! durable home (the backend overview's "Durable state").
//!
//! An earlier release wrote two kinds of durable file into the definition store:
//!
//! ```text
//! <store>/runs/<run-id>/controller.wasm                          a pushed controller
//! <store>/tournaments/<tournament-id>/matches/<match-id>/replay.json   a match replay
//! ```
//!
//! [`move_legacy_state`] moves each controller whose run has a row into the
//! database, and each match replay through the artifact service, removing a file
//! once its new home holds it. A file that cannot move stays, and is logged, for the
//! next start to try again. A store holding neither costs two directory reads. The
//! other files an earlier release kept under `runs/<run-id>/` (the session record,
//! the code analysis and the run media) are left where they are and never read, since
//! the run's tree on the artifact service holds them.

use std::path::{Path, PathBuf};

use crate::artifacts::{ArtifactsClient, ArtifactsError};
use crate::db::Db;

#[cfg(test)]
#[path = "state_move.test.rs"]
mod tests;

/// What one start's move did, for its log line and for tests.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct MoveOutcome {
    /// Controllers now in the database whose files were removed.
    pub controllers_moved: usize,
    /// Controller files left in place: no run row, or a failure.
    pub controllers_left: usize,
    /// Match replays now on the artifact service whose files were removed.
    pub replays_moved: usize,
    /// Match replay files left in place: no artifact service, or a failure.
    pub replays_left: usize,
}

impl MoveOutcome {
    /// Whether the store held anything to move.
    fn found_any(&self) -> bool {
        self.controllers_moved + self.controllers_left + self.replays_moved + self.replays_left > 0
    }
}

/// Move the controllers and match replays an earlier release kept under
/// `store_root` into the database and through `artifacts`, logging one line when
/// there was anything to move. Never fails: whatever cannot move is left for the
/// next start, so a backend whose artifact service is unreachable still starts.
pub async fn move_legacy_state(
    store_root: &Path,
    db: &Db,
    artifacts: Option<&ArtifactsClient>,
) -> MoveOutcome {
    let mut outcome = MoveOutcome::default();
    move_controllers(store_root, db, &mut outcome).await;
    move_replays(store_root, artifacts, &mut outcome).await;
    if outcome.found_any() {
        tracing::info!(
            controllers_moved = outcome.controllers_moved,
            controllers_left = outcome.controllers_left,
            replays_moved = outcome.replays_moved,
            replays_left = outcome.replays_left,
            "moved the controllers and match replays an earlier release kept on disk"
        );
    }
    outcome
}

/// Move each `runs/<id>/controller.wasm` whose run has a row into the database.
async fn move_controllers(store_root: &Path, db: &Db, outcome: &mut MoveOutcome) {
    let runs = store_root.join("runs");
    for run_id in subdirectories(&runs) {
        let file = runs.join(&run_id).join("controller.wasm");
        if !file.is_file() {
            continue;
        }
        match move_controller(db, &run_id, &file).await {
            Ok(true) => {
                outcome.controllers_moved += 1;
                remove_moved(&file, &runs);
            }
            Ok(false) => {
                outcome.controllers_left += 1;
                tracing::debug!(
                    run.id = %run_id,
                    "a controller on disk has no run row; leaving it in place"
                );
            }
            Err(err) => {
                outcome.controllers_left += 1;
                tracing::warn!(
                    run.id = %run_id,
                    error = %err,
                    "could not move a controller into the database; leaving it for the next start"
                );
            }
        }
    }
}

/// Put one controller file into the database. `Ok(true)` once the database holds
/// the run's controller, already holding one included, and `Ok(false)` when the run
/// has no row to keep it beside.
async fn move_controller(db: &Db, run_id: &str, file: &Path) -> crate::error::Result<bool> {
    if !db.run_exists(run_id).await? {
        return Ok(false);
    }
    if db.run_controller(run_id).await?.is_none() {
        db.store_run_controller(run_id, &std::fs::read(file)?)
            .await?;
    }
    Ok(true)
}

/// Move each `tournaments/<id>/matches/<matchId>/replay.json` through the artifact
/// service. With no service configured every file stays; once the service cannot be
/// reached, the remaining files stay without being tried, so an unreachable service
/// costs the start one request.
async fn move_replays(
    store_root: &Path,
    artifacts: Option<&ArtifactsClient>,
    outcome: &mut MoveOutcome,
) {
    let tournaments = store_root.join("tournaments");
    let mut files: Vec<(String, String, PathBuf)> = Vec::new();
    for tournament_id in subdirectories(&tournaments) {
        let matches = tournaments.join(&tournament_id).join("matches");
        for match_id in subdirectories(&matches) {
            let file = matches.join(&match_id).join("replay.json");
            if file.is_file() {
                files.push((tournament_id.clone(), match_id, file));
            }
        }
    }
    let Some(artifacts) = artifacts else {
        if !files.is_empty() {
            outcome.replays_left += files.len();
            tracing::warn!(
                replays = files.len(),
                "match replays on disk wait for an artifact service \
                 (TCAB_ARTIFACTS_URL and TCAB_BACKEND_SERVICE_TOKEN) to move to"
            );
        }
        return;
    };
    let mut remaining = files.into_iter();
    while let Some((tournament_id, match_id, file)) = remaining.next() {
        let bytes = match std::fs::read(&file) {
            Ok(bytes) => bytes,
            Err(err) => {
                outcome.replays_left += 1;
                tracing::warn!(
                    tournament.id = %tournament_id,
                    match.id = %match_id,
                    error = %err,
                    "could not read a match replay on disk; leaving it for the next start"
                );
                continue;
            }
        };
        match artifacts
            .put_match_replay(&tournament_id, &match_id, bytes)
            .await
        {
            Ok(()) => {
                outcome.replays_moved += 1;
                remove_moved(&file, &tournaments);
            }
            Err(ArtifactsError::Transport(err)) => {
                let left = 1 + remaining.len();
                outcome.replays_left += left;
                tracing::warn!(
                    replays = left,
                    error = %err,
                    "could not reach the artifact service to move the match replays on \
                     disk; leaving them for the next start"
                );
                return;
            }
            Err(err) => {
                outcome.replays_left += 1;
                tracing::warn!(
                    tournament.id = %tournament_id,
                    match.id = %match_id,
                    error = %err,
                    "could not move a match replay to the artifact service; leaving it \
                     for the next start"
                );
            }
        }
    }
}

/// Remove `file`, which has moved, then each directory above it that it leaves
/// empty, up to and including `root`. A removal that fails is logged and leaves the
/// file to be found, and found already moved, by the next start.
fn remove_moved(file: &Path, root: &Path) {
    if let Err(err) = std::fs::remove_file(file) {
        tracing::warn!(
            path = %file.display(),
            error = %err,
            "moved a file but could not remove it"
        );
        return;
    }
    let mut dir = file.parent();
    while let Some(current) = dir {
        // `remove_dir` refuses a directory that still holds anything, which is what
        // keeps the other files of a run's directory in place.
        if !current.starts_with(root) || std::fs::remove_dir(current).is_err() {
            break;
        }
        dir = current.parent();
    }
}

/// The names of `dir`'s immediate subdirectories, sorted. A missing or unreadable
/// directory has none.
fn subdirectories(dir: &Path) -> Vec<String> {
    crate::store::sorted_dir_names(dir).unwrap_or_else(|err| {
        tracing::warn!(
            path = %dir.display(),
            error = %err,
            "could not list a directory of the store"
        );
        Vec::new()
    })
}
