//! The backend's reclamation of its **own** store: the periodic sweep that removes
//! a run's files from `runs/<id>/` on the state volume once nothing needs them
//! there.
//!
//! The store is a staging area. A driver mirrors a run's files into it, a
//! snapshot refresh publishes them to the bucket and records which object holds
//! each ([the file manifest](crate::db::MediaManifest)), and from then on every
//! reader is answered from the bucket. This sweep is what gives the space back.
//! It is the counterpart on the backend's volume of the [artifact
//! sweep](crate::artifacts) on the artifact service's, and decides by the same
//! rule ([`retention_reason`]) with conditions of its own on top.
//!
//! A pass walks the folders under `runs/` and removes files from a folder for one
//! of four reasons:
//!
//! - **published**: the run is published, its media confirmation holds for the
//!   configured bucket under the current version, every file in the folder is one
//!   the run's manifest records an object for, and the bucket lists every object
//!   the manifest names. A folder holding a file the manifest does not account for
//!   is kept whole.
//! - **failed** and **canceled**: the run is unpublished, its retention has run
//!   out by the artifact sweep's clocks, and the backend's record says the
//!   artifact service holds no tree for it. A failed run can be published only
//!   from its tree, so its files here are kept for as long as that could happen.
//! - **orphan**: no run row names the folder, nothing is working on a run of that
//!   id, and its newest file is older than the artifact sweep's grace window.
//!
//! Every other folder is kept, above all that of a completed run that is not
//! published.
//!
//! A gg run's [session record](crate::store::SESSION_RECORD_FILE) is never removed, by any
//! reason: it has no copy anywhere else. A folder that held one keeps it, and a
//! folder that holds nothing else is not looked at further.
//!
//! Every removal is decided twice. The pass selects from the run facts it read at
//! its start, and [`reclaim_run_state`] reads the run, its jobs, its manifest, the
//! folder and the bucket again immediately before it removes anything. It records
//! the reclaim on the run first, naming the facts it decided from, reads the
//! run's jobs once more, and only then removes the files it listed, one by one.
//! Files are removed by name and never by directory, so a file an upload wrote in
//! the meantime is left where it is.
//!
//! A pass that cannot read the run set, the busy set or the `runs/` directory
//! does nothing, and neither does one whose run set is empty, for the reason the
//! artifact sweep gives: an empty set makes every folder an orphan.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::artifacts::{RetentionPolicy, SweepRules, SweepTiming, retention_reason};
use crate::db::{Db, MediaManifest, ReclaimReason, RetentionRun};
use crate::store::{DefinitionStore, RunFolder};

/// How long after startup the first pass runs: a little after the artifact
/// sweep's first, so a run whose tree that pass reclaims is seen as reclaimed by
/// this one.
const FIRST_SWEEP_DELAY: Duration = Duration::from_secs(90);

/// The label an orphan's removal is counted and logged under.
const ORPHAN: &str = "orphan";

/// What a pass reads of the bucket: the keys of the objects it holds for one
/// run.
///
/// A trait so the decision is exercised without a bucket. The backend's
/// implementation is [`R2Client`](test_cabinet_core::r2::R2Client)'s listing of
/// the run's prefix.
pub trait RunBucket: Send + Sync {
    /// Every object key under run `run_id`'s media prefix, or why the bucket
    /// could not say.
    fn run_keys(
        &self,
        run_id: &str,
    ) -> impl Future<Output = Result<HashSet<String>, String>> + Send;
}

impl RunBucket for test_cabinet_core::r2::R2Client {
    async fn run_keys(&self, run_id: &str) -> Result<HashSet<String>, String> {
        let prefix = format!("{}/{run_id}/", crate::snapshot::MEDIA_PREFIX);
        self.list_keys(&prefix)
            .await
            .map(|keys| keys.into_iter().collect())
            .map_err(|err| err.to_string())
    }
}

/// What one pass did, for the log line the caller emits.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct StateSweepOutcome {
    /// Run folders the store listed.
    pub folders: usize,
    /// Folders the pass removed files from, for any reason.
    pub reclaimed: usize,
    /// Folders of published runs the pass removed files from.
    pub reclaimed_published: usize,
    /// Folders of failed runs the pass removed files from.
    pub reclaimed_failed: usize,
    /// Folders of canceled runs the pass removed files from.
    pub reclaimed_canceled: usize,
    /// Folders with no run row the pass removed files from.
    pub reclaimed_orphans: usize,
    /// Folders a rule selected that the read made immediately before the removal
    /// no longer qualified. Nothing was removed from them.
    pub skipped: usize,
    /// Folders that could not be read, whose run could not be read again, or
    /// some file of which could not be removed. They are retried next pass.
    pub failed: usize,
    /// Folders kept because they hold something nothing accounts for: a file the
    /// run's manifest records no object for, or an entry that is neither a file
    /// nor a directory.
    pub kept_unaccounted: usize,
    /// Folders of published runs kept because the bucket's listing lacks an
    /// object the run's manifest names.
    pub kept_unlisted: usize,
    /// Folders of published runs with files to remove whose run no refresh has
    /// confirmed, counted only while the published rule is on.
    pub unconfirmed: usize,
    /// Files removed this pass.
    pub removed_files: u64,
    /// Bytes the removed files held, each measured before its removal.
    pub freed_bytes: u64,
    /// Session records the folders hold, which no pass removes.
    pub session_records: u64,
    /// Bytes those session records hold.
    pub session_record_bytes: u64,
}

/// Decide whether the files of `run`, a run that still exists, are to be removed
/// from the backend's own store at `now`, and for which reason. `busy` is as for
/// [`retention_reason`], and `modified` is when the newest file of the run's
/// folder was written.
///
/// The artifact sweep's rule decides first, with `modified` in the place of the
/// tree's storing time, so the two sweeps measure a failed or a canceled run's
/// retention from the same instants by the same settings and floor. Two
/// conditions are then this sweep's own:
///
/// - A run in a state this build cannot name keeps its files, published or not.
/// - A **failed** or **canceled** run's files are removed only once the backend's
///   record says the artifact service holds no tree for it
///   ([`RetentionRun::tree_recorded_absent`]): the tree was reclaimed, or was
///   recorded as not stored. Until then the run could still be published.
///
/// `policy.published` here is whether this sweep removes published runs' files,
/// which is not the artifact sweep's switch.
pub fn state_retention_reason(
    run: &RetentionRun,
    busy: bool,
    modified: OffsetDateTime,
    now: OffsetDateTime,
    policy: &RetentionPolicy,
) -> Option<ReclaimReason> {
    use test_cabinet_core::run_record::RunState;

    serde_json::from_value::<RunState>(serde_json::Value::String(run.run_state.clone())).ok()?;
    let reason = retention_reason(run, busy, modified, now, policy)?;
    match reason {
        ReclaimReason::Published => Some(reason),
        ReclaimReason::Failed | ReclaimReason::Canceled => {
            run.tree_recorded_absent().then_some(reason)
        }
    }
}

/// How a published run's folder divides against the run's manifest.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Accounting {
    /// The files the manifest records an object for, which may be removed.
    pub remove: Vec<String>,
    /// The files nothing accounts for: ones the manifest does not name, and ones
    /// it records as unrecoverable although the folder holds them.
    pub unaccounted: Vec<String>,
}

/// Divide the files of `folder` into those `manifest` records an object for and
/// those it does not. The [session record](crate::store::SESSION_RECORD_FILE) is in neither: it
/// is kept, and does not keep the rest.
///
/// A file is accounted for when the manifest names it and every entry of that
/// name carries the key of the object holding its bytes. An entry recorded as
/// unrecoverable has none, so a file that turned up after a refresh wrote it off
/// is kept: nothing has uploaded it.
pub fn account_folder(folder: &RunFolder, manifest: &MediaManifest) -> Accounting {
    let mut accounting = Accounting::default();
    for file in folder.reclaimable() {
        let mut entries = manifest
            .files
            .iter()
            .filter(|entry| entry.name == file.name)
            .peekable();
        let uploaded = entries.peek().is_some() && entries.all(|entry| entry.key.is_some());
        if uploaded {
            accounting.remove.push(file.name.clone());
        } else {
            accounting.unaccounted.push(file.name.clone());
        }
    }
    accounting
}

/// Whether a folder with no run row is old enough to be an orphan: its newest
/// file was written more than `grace` before `now`. A file written after `now`,
/// and a grace window that cannot be represented, each keep the folder.
pub fn orphan_expired(modified: OffsetDateTime, now: OffsetDateTime, grace: Duration) -> bool {
    let Ok(grace) = time::Duration::try_from(grace) else {
        return false;
    };
    modified <= now && now - modified > grace
}

/// How one folder's reclaim ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StateReclaim {
    /// Files were removed. `failed` is how many more could not be.
    Reclaimed {
        /// How many files were removed.
        files: u64,
        /// The bytes they held.
        bytes: u64,
        /// How many of the selected files could not be removed.
        failed: u64,
    },
    /// The run, read again, no longer qualified. Nothing was written and nothing
    /// removed.
    Skipped,
    /// The folder holds something nothing accounts for, and is kept whole.
    KeptUnaccounted,
    /// The bucket's listing lacks an object the run's manifest names, and the
    /// folder is kept whole.
    KeptUnlisted,
    /// The run, its manifest, the folder or the bucket could not be read, or no
    /// selected file could be removed. Nothing was removed, and the next pass
    /// tries again.
    Failed,
}

/// Run `job` against the store on a blocking thread: a folder walk and a file
/// removal are disk work.
async fn on_disk<T, F>(store: &DefinitionStore, job: F) -> crate::error::Result<T>
where
    T: Send + 'static,
    F: FnOnce(&DefinitionStore) -> crate::error::Result<T> + Send + 'static,
{
    let store = store.clone();
    tokio::task::spawn_blocking(move || job(&store))
        .await
        .map_err(|err| crate::error::BackendError::Internal(format!("store task failed: {err}")))?
}

/// When the newest file of `folder` was written, as an instant the rules compare.
fn modified_at(folder: &RunFolder) -> Option<OffsetDateTime> {
    folder.modified.map(OffsetDateTime::from)
}

/// Remove `names` from run `run_id`'s folder one by one, then the directories
/// that emptied. Returns the files removed, the bytes they held as `folder`
/// measured them, and how many could not be removed.
async fn remove_files(
    store: &DefinitionStore,
    run_id: &str,
    folder: &RunFolder,
    names: Vec<String>,
) -> (u64, u64, u64) {
    let sizes: HashMap<String, u64> = folder
        .files
        .iter()
        .map(|file| (file.name.clone(), file.bytes))
        .collect();
    let id = run_id.to_string();
    let removed = on_disk(store, move |store| {
        let (mut files, mut bytes, mut failed) = (0u64, 0u64, 0u64);
        for name in &names {
            match store.remove_run_file(&id, name) {
                Ok(true) => {
                    files += 1;
                    bytes += sizes.get(name).copied().unwrap_or(0);
                }
                // Gone already, which is what the removal was for.
                Ok(false) => {}
                Err(error) => {
                    failed += 1;
                    tracing::warn!(run.id = %id, file = %name, %error, "could not remove a run's file from the backend store");
                }
            }
        }
        store.prune_run_dirs(&id);
        Ok((files, bytes, failed))
    })
    .await;
    removed.unwrap_or_else(|error| {
        tracing::warn!(run.id = %run_id, %error, "removing a run's files from the backend store did not finish");
        (0, 0, 1)
    })
}

/// Remove the files of run `run_id`, a run a pass selected for `reason`, once the
/// run still qualifies as it stands now.
///
/// In order: read the run's facts and whether anything is working on it, list its
/// folder, decide the rule again, and for a published run read its manifest,
/// [account](account_folder) for every file and require every object the manifest
/// names in the bucket's listing. Then record the reclaim on the run, read once
/// more whether anything is working on it, and only then remove the files that
/// were listed.
///
/// The record is written by a statement that names the facts just read, so a run
/// stored again, published, or whose confirmation was withdrawn since is left
/// alone. It is taken back when work on the run began as it was written, and when
/// the removal removed nothing. A removal that removed some files keeps it: the
/// files that are gone are gone on purpose, and the next pass removes the rest.
pub async fn reclaim_run_state<B: RunBucket>(
    db: &Db,
    store: &DefinitionStore,
    bucket: Option<&B>,
    run_id: &str,
    reason: ReclaimReason,
    now: OffsetDateTime,
    policy: &RetentionPolicy,
) -> StateReclaim {
    let Ok(at) = now.format(&Rfc3339) else {
        return StateReclaim::Failed;
    };
    let fresh = match db.retention_run(run_id, policy.bucket).await {
        Ok(Some(run)) => run,
        // Deleted since the pass read it, which removes its folder too.
        Ok(None) => return StateReclaim::Skipped,
        Err(error) => {
            tracing::warn!(run.id = %run_id, %error, "could not read a run again before reclaiming its files; retrying next pass");
            return StateReclaim::Failed;
        }
    };
    let busy = match db.run_is_busy(run_id, &at).await {
        Ok(busy) => busy,
        Err(error) => {
            tracing::warn!(run.id = %run_id, %error, "could not read a run's jobs before reclaiming its files; retrying next pass");
            return StateReclaim::Failed;
        }
    };
    let id = run_id.to_string();
    let folder = match on_disk(store, move |store| store.run_folder(&id)).await {
        Ok(folder) => folder,
        Err(error) => {
            tracing::warn!(run.id = %run_id, %error, "could not list a run's folder before reclaiming its files; retrying next pass");
            return StateReclaim::Failed;
        }
    };
    if !folder.irregular.is_empty() {
        return StateReclaim::KeptUnaccounted;
    }
    let Some(modified) = modified_at(&folder) else {
        // Nothing is left in the folder.
        return StateReclaim::Skipped;
    };
    if state_retention_reason(&fresh, busy, modified, now, policy) != Some(reason) {
        tracing::info!(
            run.id = %run_id,
            reason = reason.as_str(),
            "kept a run's files selected for reclaiming: the run no longer qualifies"
        );
        return StateReclaim::Skipped;
    }
    let remove = match reason {
        ReclaimReason::Published => {
            let manifest = match db.run_media_manifest(run_id, policy.bucket).await {
                Ok(Some(manifest)) => manifest,
                Ok(None) => return StateReclaim::Skipped,
                Err(error) => {
                    tracing::error!(run.id = %run_id, %error, "a confirmed run's file manifest could not be read; its files are kept");
                    return StateReclaim::Failed;
                }
            };
            let accounting = account_folder(&folder, &manifest);
            if !accounting.unaccounted.is_empty() {
                tracing::warn!(
                    run.id = %run_id,
                    files = %accounting.unaccounted.join(", "),
                    "kept a published run's folder in the backend store: it holds files the \
                     run's manifest records no object for"
                );
                return StateReclaim::KeptUnaccounted;
            }
            // Without a bucket to ask there is no published reason to begin with.
            let Some(bucket) = bucket else {
                return StateReclaim::Skipped;
            };
            let listed = match bucket.run_keys(run_id).await {
                Ok(listed) => listed,
                Err(error) => {
                    tracing::warn!(run.id = %run_id, %error, "could not list a run's objects in the bucket before reclaiming its files; retrying next pass");
                    return StateReclaim::Failed;
                }
            };
            let unlisted: Vec<&str> = manifest
                .keys()
                .filter(|key| !listed.contains(*key))
                .collect();
            if !unlisted.is_empty() {
                tracing::warn!(
                    run.id = %run_id,
                    objects = %unlisted.join(", "),
                    "kept a published run's folder in the backend store: the bucket does \
                     not list objects the run's manifest names"
                );
                return StateReclaim::KeptUnlisted;
            }
            accounting.remove
        }
        ReclaimReason::Failed | ReclaimReason::Canceled => {
            folder.reclaimable().map(|file| file.name.clone()).collect()
        }
    };
    if remove.is_empty() {
        return StateReclaim::Skipped;
    }
    match db.mark_state_reclaimed(&fresh, reason, &at).await {
        Ok(true) => {}
        // The row moved between the read and the write.
        Ok(false) => return StateReclaim::Skipped,
        Err(error) => {
            tracing::warn!(run.id = %run_id, %error, "could not record the reclaim of a run's files; retrying next pass");
            return StateReclaim::Failed;
        }
    }
    let restore = async || {
        if let Err(error) = db.restore_state_record(&fresh, &at).await {
            tracing::warn!(
                run.id = %run_id,
                %error,
                "could not restore the record of a run whose files were not reclaimed; \
                 the next pass reclaims them"
            );
        }
    };
    // Anything enqueued for the run between the first read of its jobs and the
    // record did not see the record. Keep the files for it.
    match db.run_is_busy(run_id, &at).await {
        Ok(false) => {}
        Ok(true) => {
            restore().await;
            tracing::info!(
                run.id = %run_id,
                reason = reason.as_str(),
                "kept a run's files selected for reclaiming: work on the run began as it was recorded"
            );
            return StateReclaim::Skipped;
        }
        Err(error) => {
            restore().await;
            tracing::warn!(run.id = %run_id, %error, "could not read a run's jobs after recording its files' reclaim; retrying next pass");
            return StateReclaim::Failed;
        }
    }
    let (files, bytes, failed) = remove_files(store, run_id, &folder, remove).await;
    if files == 0 && failed > 0 {
        restore().await;
        return StateReclaim::Failed;
    }
    log_reclaimed(run_id, reason.as_str(), files, bytes, failed);
    StateReclaim::Reclaimed {
        files,
        bytes,
        failed,
    }
}

/// Remove the files of `run_id`'s folder, a folder a pass found no run row for,
/// once it is still an orphan as it stands now: no run row names it, nothing is
/// working on a run of that id, and its newest file is past the grace window.
pub async fn reclaim_orphan_folder(
    db: &Db,
    store: &DefinitionStore,
    run_id: &str,
    now: OffsetDateTime,
    grace: Duration,
) -> StateReclaim {
    let Ok(at) = now.format(&Rfc3339) else {
        return StateReclaim::Failed;
    };
    match db.retention_run(run_id, None).await {
        Ok(None) => {}
        // A driver reported the run since the pass read the run set.
        Ok(Some(_)) => return StateReclaim::Skipped,
        Err(error) => {
            tracing::warn!(run.id = %run_id, %error, "could not confirm a folder in the backend store has no run; retrying next pass");
            return StateReclaim::Failed;
        }
    }
    match db.run_is_busy(run_id, &at).await {
        Ok(false) => {}
        Ok(true) => return StateReclaim::Skipped,
        Err(error) => {
            tracing::warn!(run.id = %run_id, %error, "could not read the jobs of a folder in the backend store with no run; retrying next pass");
            return StateReclaim::Failed;
        }
    }
    let id = run_id.to_string();
    let folder = match on_disk(store, move |store| store.run_folder(&id)).await {
        Ok(folder) => folder,
        Err(error) => {
            tracing::warn!(run.id = %run_id, %error, "could not list a folder in the backend store with no run; retrying next pass");
            return StateReclaim::Failed;
        }
    };
    if !folder.irregular.is_empty() {
        return StateReclaim::KeptUnaccounted;
    }
    let expired = modified_at(&folder).is_some_and(|modified| orphan_expired(modified, now, grace));
    if !expired {
        return StateReclaim::Skipped;
    }
    let remove: Vec<String> = folder.reclaimable().map(|file| file.name.clone()).collect();
    if remove.is_empty() {
        return StateReclaim::Skipped;
    }
    let (files, bytes, failed) = remove_files(store, run_id, &folder, remove).await;
    if files == 0 && failed > 0 {
        return StateReclaim::Failed;
    }
    log_reclaimed(run_id, ORPHAN, files, bytes, failed);
    StateReclaim::Reclaimed {
        files,
        bytes,
        failed,
    }
}

/// Log and count one folder's removal.
fn log_reclaimed(run_id: &str, reason: &'static str, files: u64, bytes: u64, failed: u64) {
    crate::metrics::record_state_reclaimed(reason, bytes);
    tracing::info!(
        run.id = %run_id,
        reason,
        files,
        freed_bytes = bytes,
        failed,
        "reclaimed a run's files from the backend store"
    );
}

/// Run one pass over `folders`, the run folders the store listed.
///
/// `runs` are the retention facts of every stored run and `busy` the ids of the
/// runs something is working on, both read by the caller before the folders were
/// listed. An empty `runs` removes nothing: it would make every folder an orphan.
#[allow(clippy::too_many_arguments)]
pub async fn sweep_pass<B: RunBucket>(
    db: &Db,
    store: &DefinitionStore,
    bucket: Option<&B>,
    folders: &[String],
    runs: &[RetentionRun],
    busy: &HashSet<String>,
    now: OffsetDateTime,
    rules: &SweepRules,
) -> StateSweepOutcome {
    let mut outcome = StateSweepOutcome {
        folders: folders.len(),
        ..StateSweepOutcome::default()
    };
    if runs.is_empty() {
        return outcome;
    }
    let by_id: HashMap<&str, &RetentionRun> =
        runs.iter().map(|run| (run.id.as_str(), run)).collect();
    let policy = &rules.retention;
    for run_id in folders {
        let id = run_id.clone();
        let folder = match on_disk(store, move |store| store.run_folder(&id)).await {
            Ok(folder) => folder,
            Err(error) => {
                outcome.failed += 1;
                tracing::warn!(run.id = %run_id, %error, "could not list a run's folder in the backend store; retrying next pass");
                continue;
            }
        };
        if let Some(bytes) = folder.session_record_bytes() {
            outcome.session_records += 1;
            outcome.session_record_bytes += bytes;
        }
        // A folder holding nothing but a session record has nothing to remove.
        if folder.reclaimable().next().is_none() && folder.irregular.is_empty() {
            continue;
        }
        let Some(modified) = modified_at(&folder) else {
            // Entries the store did not write, and no file to date them by.
            outcome.kept_unaccounted += 1;
            tracing::warn!(
                run.id = %run_id,
                entries = %folder.irregular.join(", "),
                "kept a folder in the backend store: it holds entries the store does not write"
            );
            continue;
        };
        let reclaim = match by_id.get(run_id.as_str()) {
            Some(run) => {
                let selected =
                    state_retention_reason(run, busy.contains(run_id), modified, now, policy);
                let Some(reason) = selected else {
                    if run.published && policy.published {
                        outcome.unconfirmed += 1;
                    }
                    continue;
                };
                let reclaim =
                    reclaim_run_state(db, store, bucket, run_id, reason, now, policy).await;
                if matches!(reclaim, StateReclaim::Reclaimed { .. }) {
                    match reason {
                        ReclaimReason::Published => outcome.reclaimed_published += 1,
                        ReclaimReason::Failed => outcome.reclaimed_failed += 1,
                        ReclaimReason::Canceled => outcome.reclaimed_canceled += 1,
                    }
                }
                reclaim
            }
            None => {
                if busy.contains(run_id) || !orphan_expired(modified, now, rules.grace) {
                    continue;
                }
                let reclaim = reclaim_orphan_folder(db, store, run_id, now, rules.grace).await;
                if matches!(reclaim, StateReclaim::Reclaimed { .. }) {
                    outcome.reclaimed_orphans += 1;
                }
                reclaim
            }
        };
        match reclaim {
            StateReclaim::Reclaimed {
                files,
                bytes,
                failed,
            } => {
                outcome.reclaimed += 1;
                outcome.removed_files += files;
                outcome.freed_bytes += bytes;
                if failed > 0 {
                    outcome.failed += 1;
                }
            }
            StateReclaim::Skipped => outcome.skipped += 1,
            StateReclaim::KeptUnaccounted => {
                outcome.kept_unaccounted += 1;
                if !folder.irregular.is_empty() {
                    tracing::warn!(
                        run.id = %run_id,
                        entries = %folder.irregular.join(", "),
                        "kept a folder in the backend store: it holds entries the store does not write"
                    );
                }
            }
            StateReclaim::KeptUnlisted => outcome.kept_unlisted += 1,
            StateReclaim::Failed => outcome.failed += 1,
        }
    }
    crate::metrics::record_state_kept_unaccounted(outcome.kept_unaccounted as u64);
    outcome
}

/// How one scheduled pass ended. Every pass ends as exactly one of these and
/// [logs](Self::log) exactly one line for it.
#[derive(Debug)]
pub enum ScheduledPass {
    /// The pass listed the store's run folders and acted on the listing.
    Complete(StateSweepOutcome),
    /// The pass was abandoned before it changed anything, and is retried at the
    /// next interval.
    Abandoned(AbandonedPass),
}

/// Why a scheduled pass was abandoned.
#[derive(Debug)]
pub enum AbandonedPass {
    /// The backend holds no run rows, which would make every folder an orphan.
    NoRuns,
    /// The stored runs, or the runs something is working on, could not be read.
    RunsUnreadable(crate::error::BackendError),
    /// The store's `runs/` directory could not be listed.
    ListingFailed(crate::error::BackendError),
}

impl AbandonedPass {
    /// The reason as the log line's `reason` field spells it.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NoRuns => "no_runs",
            Self::RunsUnreadable(_) => "runs_unreadable",
            Self::ListingFailed(_) => "listing_failed",
        }
    }
}

impl ScheduledPass {
    /// Log the pass's one line: `info` for a pass that completed, a pass that
    /// removed nothing included, and `warn` for one that was abandoned.
    pub fn log(&self) {
        match self {
            Self::Complete(outcome) => tracing::info!(
                folders = outcome.folders,
                reclaimed = outcome.reclaimed,
                reclaimed_published = outcome.reclaimed_published,
                reclaimed_failed = outcome.reclaimed_failed,
                reclaimed_canceled = outcome.reclaimed_canceled,
                reclaimed_orphans = outcome.reclaimed_orphans,
                skipped = outcome.skipped,
                failed = outcome.failed,
                kept_unaccounted = outcome.kept_unaccounted,
                kept_unlisted = outcome.kept_unlisted,
                unconfirmed = outcome.unconfirmed,
                removed_files = outcome.removed_files,
                freed_bytes = outcome.freed_bytes,
                session_records = outcome.session_records,
                session_record_bytes = outcome.session_record_bytes,
                "state sweep pass complete"
            ),
            Self::Abandoned(why) => {
                let error = match why {
                    AbandonedPass::NoRuns => None,
                    AbandonedPass::RunsUnreadable(err) | AbandonedPass::ListingFailed(err) => {
                        Some(err.to_string())
                    }
                };
                tracing::warn!(
                    reason = why.as_str(),
                    error,
                    "state sweep pass abandoned; retrying at the next interval"
                );
            }
        }
    }
}

/// Run one scheduled pass: read every run's retention facts and the runs
/// something is working on, list the store's run folders, then [`sweep_pass`]
/// over them.
///
/// The runs are read before the folders are listed, so a run reported in between
/// has a row the pass does not know, and the read [`reclaim_orphan_folder`] makes
/// before it removes anything finds it.
pub async fn scheduled_pass<B: RunBucket>(
    db: &Db,
    store: &DefinitionStore,
    bucket: Option<&B>,
    now: OffsetDateTime,
    rules: &SweepRules,
) -> ScheduledPass {
    let runs = match db.retention_runs(rules.retention.bucket).await {
        Ok(runs) if !runs.is_empty() => runs,
        Ok(_) => return ScheduledPass::Abandoned(AbandonedPass::NoRuns),
        Err(err) => return ScheduledPass::Abandoned(AbandonedPass::RunsUnreadable(err)),
    };
    let busy = match now.format(&Rfc3339) {
        Ok(at) => db.busy_run_ids(&at).await,
        Err(err) => Err(err.into()),
    };
    let busy = match busy {
        Ok(busy) => busy,
        Err(err) => return ScheduledPass::Abandoned(AbandonedPass::RunsUnreadable(err)),
    };
    let folders = match on_disk(store, |store| store.list_run_folders()).await {
        Ok(folders) => folders,
        Err(err) => return ScheduledPass::Abandoned(AbandonedPass::ListingFailed(err)),
    };
    ScheduledPass::Complete(sweep_pass(db, store, bucket, &folders, &runs, &busy, now, rules).await)
}

/// Spawn the periodic state sweep, returning its task handle so the caller can
/// hold it for the server's lifetime (dropping it aborts the loop).
///
/// `None` when `timing` is `None`, which is `TCAB_STATE_RECLAIM` turned off, and
/// when the interval is zero. Neither removes anything from the store.
///
/// One task runs every pass and sleeps the interval after each, so a pass never
/// overlaps the one before it however long that one took.
pub fn spawn_state_sweeper<B: RunBucket + 'static>(
    db: Arc<Db>,
    store: DefinitionStore,
    bucket: Option<B>,
    timing: Option<SweepTiming>,
) -> Option<tokio::task::JoinHandle<()>> {
    let timing = timing.filter(|timing| !timing.interval.is_zero())?;
    Some(tokio::spawn(async move {
        tokio::time::sleep(FIRST_SWEEP_DELAY).await;
        loop {
            scheduled_pass(
                &db,
                &store,
                bucket.as_ref(),
                OffsetDateTime::now_utc(),
                &timing.rules,
            )
            .await
            .log();
            tokio::time::sleep(timing.interval).await;
        }
    }))
}

#[cfg(test)]
#[path = "state_reclaim.test.rs"]
mod tests;

#[cfg(test)]
#[path = "state_reclaim.sweep.test.rs"]
mod sweep_tests;
