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
//!   configured bucket under the current version, and the bucket lists every
//!   object the run's manifest names. Each file is then decided on its own: it is
//!   removed when the manifest records an object for it and that object holds the
//!   file's bytes, by its size and, where the bucket reports one, its MD5. A file
//!   the manifest does not account for, and a file whose bytes differ from the
//!   object under its name, is the only copy of what it holds and stays.
//! - **failed** and **canceled**: the run is unpublished, its retention has run
//!   out by the artifact sweep's clocks, and the backend's record says the
//!   artifact service holds no tree for it. A failed run can be published only
//!   from its tree, so its files here are kept for as long as that could happen.
//!   Its code-analysis document and its controller module are kept beyond that:
//!   the console and the arena read them from the backend alone, and no bucket
//!   holds a copy.
//! - **orphan**: no run row names the folder, nothing is working on a run of that
//!   id, and its newest file is older than the artifact sweep's grace window.
//!
//! Every other folder is kept, above all that of a completed run that is not
//! published.
//!
//! A gg run's [session record](crate::store::SESSION_RECORD_FILE) is removed for
//! the published reason alone, under the rule of every other published file: a
//! refresh publishes the record of a published run and of no other. For the
//! other three reasons it has no copy anywhere else, so a folder that held one
//! keeps it, and a folder that holds nothing else is not looked at further.
//! A published run's record that its manifest does not name is kept too, and
//! the run's confirmation is withdrawn so that a refresh publishes it.
//!
//! Every removal is decided twice. The pass selects from the run facts it read at
//! its start, and [`reclaim_run_state`] reads the run, its jobs, its manifest, the
//! folder and the bucket again immediately before it removes anything. It records
//! the reclaim on the run first, naming the facts it decided from, reads the
//! run's jobs once more, and only then removes the files it listed, one by one.
//! Files are removed by name and never by directory, and each only while it is
//! still the file that was listed ([`DefinitionStore::remove_run_file_as_listed`]),
//! so a file an upload wrote in the meantime is left where it is, under a new
//! name or an old one.
//!
//! A pass that cannot read the run set, the busy set or the `runs/` directory
//! does nothing, and neither does one whose run set is empty, for the reason the
//! artifact sweep gives: an empty set makes every folder an orphan. Orphans are
//! also left alone, all of them, when a pass finds an implausible number of them
//! ([`orphans_held`]), which is what a database older than the store looks like.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::artifacts::{RetentionPolicy, SweepRules, SweepTiming, retention_reason};
use crate::db::{Db, MediaManifest, ReclaimReason, RetentionRun};
use crate::store::{DefinitionStore, PublishedCopy, Removal, RunFolder, RunFolderFile};

/// How long after startup the first pass runs: a little after the artifact
/// sweep's first, so a run whose tree that pass reclaims is seen as reclaimed by
/// this one.
const FIRST_SWEEP_DELAY: Duration = Duration::from_secs(90);

/// The label an orphan's removal is counted and logged under.
const ORPHAN: &str = "orphan";

/// How long the bucket may take to list one run's objects. A listing that takes
/// longer fails that run's reclaim for this pass ([`run_objects_within`]).
const BUCKET_LISTING_TIMEOUT: Duration = Duration::from_secs(120);

/// How many orphans a pass removes without question.
const ORPHAN_HOLD_FLOOR: usize = 20;

/// The share of the listed folders, as one in this many, above which the orphans
/// of a pass are held instead of removed.
const ORPHAN_HOLD_SHARE: usize = 4;

/// Whether `orphans` folders with no run row, out of `folders` listed, are too
/// many to be believed: more than twenty, and more than one in four of the
/// folders.
///
/// A folder loses its run row when its run is deleted without the folder, or when
/// a driver mirrored files and never reported. Both are rare. A backend started
/// against a database older than its volume, restored from a backup or simply the
/// wrong one, sees every run made since as an orphan, and removing those files
/// removes the only copy of every unpublished run among them. So a pass that
/// finds this many removes none of them and says so at `error`, every pass, until
/// the database and the volume agree again or an operator deletes the folders.
pub fn orphans_held(orphans: usize, folders: usize) -> bool {
    orphans > ORPHAN_HOLD_FLOOR && orphans.saturating_mul(ORPHAN_HOLD_SHARE) > folders
}

/// One object the bucket holds for a run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BucketObject {
    /// The object's size, or `None` when the bucket did not say.
    pub size: Option<u64>,
    /// The MD5 of the object's bytes, when the bucket reported one.
    pub md5: Option<[u8; 16]>,
}

/// What a pass reads of the bucket: the objects it holds for one run.
///
/// A trait so the decision is exercised without a bucket. The backend's
/// implementation is [`R2Client`](test_cabinet_core::r2::R2Client)'s listing of
/// the run's prefix.
pub trait RunBucket: Send + Sync {
    /// Every object under run `run_id`'s media prefix by its key, or why the
    /// bucket could not say.
    fn run_objects(
        &self,
        run_id: &str,
    ) -> impl Future<Output = Result<HashMap<String, BucketObject>, String>> + Send;
}

impl RunBucket for test_cabinet_core::r2::R2Client {
    async fn run_objects(&self, run_id: &str) -> Result<HashMap<String, BucketObject>, String> {
        let prefix = format!("{}/{run_id}/", crate::snapshot::MEDIA_PREFIX);
        self.list_objects(&prefix)
            .await
            .map(|objects| {
                objects
                    .into_iter()
                    .map(|object| {
                        let found = BucketObject {
                            size: object.size,
                            md5: object.md5(),
                        };
                        (object.key, found)
                    })
                    .collect()
            })
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
    /// Folders that keep something nothing accounts for: a file the run's
    /// manifest records no object for, a file whose bytes differ from the object
    /// under its name, or an entry that is neither a file nor a directory.
    pub kept_unaccounted: usize,
    /// Files of published runs kept because the object under their name holds
    /// other bytes, or because the bucket could not say what it holds.
    pub differing_files: u64,
    /// Published runs whose confirmation the pass withdrew, because their folder
    /// holds a file their manifest records as existing nowhere. The next refresh
    /// publishes the file and confirms the run again.
    pub withdrawn: usize,
    /// Folders with no run row, past the grace window, that the pass left alone
    /// because there were too many of them to believe ([`orphans_held`]).
    pub orphans_held: usize,
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
    /// Session records the folders held when the pass listed them.
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

/// One file a pass may remove, with what the bucket must hold for it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Removable {
    /// The file as the folder listing found it.
    pub file: RunFolderFile,
    /// The object the file must be what is held in: its bytes, or for a
    /// [scrubbed document](crate::store::is_scrubbed_document) its published
    /// form. `None` for a file removed without a comparison, which for a
    /// published run is an empty one.
    pub published: Option<PublishedCopy>,
}

/// How a published run's folder divides against the run's manifest and the
/// bucket's listing.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Accounting {
    /// The files the manifest records an object for, which may be removed once
    /// each is found to be what its object holds.
    pub remove: Vec<Removable>,
    /// The code-analysis document and the session record, each when the manifest
    /// records an object for it. Such an object is the scrubbed, uncompressed
    /// form of the file, so the two are compared by publishing the file again
    /// in memory, not byte for byte.
    pub transformed: Vec<(RunFolderFile, BucketObject)>,
    /// The files the manifest does not name. Nothing has published them.
    pub unaccounted: Vec<String>,
    /// The files the manifest records as existing nowhere, although the folder
    /// holds them. A refresh would publish them now.
    pub unpublished: Vec<String>,
    /// The files whose size is not their object's, or whose object's size the
    /// bucket did not report. The object under the name holds other bytes.
    pub differing: Vec<String>,
}

impl Accounting {
    /// Every file the accounting keeps, for the log line.
    fn kept(&self) -> impl Iterator<Item = &str> {
        self.unaccounted
            .iter()
            .chain(&self.unpublished)
            .chain(&self.differing)
            .map(String::as_str)
    }
}

/// Divide the files of `folder` by what `manifest` records for each and what
/// `objects`, the bucket's listing of the run, holds. The [session
/// record](crate::store::SESSION_RECORD_FILE) is divided like every other file,
/// so one the manifest does not name is unaccounted and stays. An empty one the
/// manifest does not name is in no part: it is what a refresh reads as no
/// record, so nothing will ever name it, and it is a copy of nothing.
///
/// A file may be removed when the manifest names it, every entry of that name
/// carries the key of the object holding its bytes, and that object is the
/// file's size. An entry recorded as unrecoverable has no key, so a file that
/// turned up after a refresh wrote it off is kept: nothing has uploaded it.
///
/// An empty file the manifest names is removed whatever its entry says. It is
/// what a write cut off by a full volume left, and a copy of nothing.
pub fn account_folder(
    folder: &RunFolder,
    manifest: &MediaManifest,
    objects: &HashMap<String, BucketObject>,
) -> Accounting {
    let mut accounting = Accounting::default();
    for file in &folder.files {
        let entries: Vec<_> = manifest
            .files
            .iter()
            .filter(|entry| entry.name == file.name)
            .collect();
        if entries.is_empty() {
            if file.bytes > 0 || file.name != crate::store::SESSION_RECORD_FILE {
                accounting.unaccounted.push(file.name.clone());
            }
            continue;
        }
        if file.bytes == 0 {
            accounting.remove.push(Removable {
                file: file.clone(),
                published: None,
            });
            continue;
        }
        if entries.iter().any(|entry| entry.key.is_none()) {
            accounting.unpublished.push(file.name.clone());
            continue;
        }
        // Every entry of one name records the same object for the file's own
        // bytes; were two to differ, the file is held to each.
        let held: Vec<Option<&BucketObject>> = entries
            .iter()
            .filter_map(|entry| entry.key.as_deref())
            .map(|key| objects.get(key))
            .collect();
        if entries
            .iter()
            .all(|entry| entry.kind.is_scrubbed_document())
        {
            match held.first().copied().flatten() {
                Some(object) if held.iter().all(|other| *other == Some(object)) => {
                    accounting.transformed.push((file.clone(), *object));
                }
                _ => accounting.differing.push(file.name.clone()),
            }
            continue;
        }
        let same_bytes = held
            .iter()
            .all(|object| object.is_some_and(|object| object.size == Some(file.bytes)));
        match held.first().copied().flatten() {
            Some(object) if same_bytes => accounting.remove.push(Removable {
                file: file.clone(),
                published: Some(PublishedCopy {
                    size: file.bytes,
                    md5: object.md5,
                }),
            }),
            _ => accounting.differing.push(file.name.clone()),
        }
    }
    accounting
}

/// Whether a folder with no run row is old enough to be an orphan: its newest
/// file was written more than `grace` before `now`. A file written after `now`,
/// and a grace window that cannot be represented, each keep the folder. So does
/// a window of zero, which turns the orphan rule off as it does the artifact
/// sweep's: with no window, the files a driver is mirroring for a run it has not
/// reported yet would be an orphan's.
pub fn orphan_expired(modified: OffsetDateTime, now: OffsetDateTime, grace: Duration) -> bool {
    if grace.is_zero() {
        return false;
    }
    let Ok(grace) = time::Duration::try_from(grace) else {
        return false;
    };
    modified <= now && now - modified > grace
}

/// How one folder's reclaim ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StateReclaim {
    /// Files were removed.
    Reclaimed {
        /// How many files were removed.
        files: u64,
        /// The bytes they held.
        bytes: u64,
        /// How many of the selected files could not be removed.
        failed: u64,
        /// How many files of the folder were kept because nothing accounts for
        /// them.
        kept: u64,
        /// How many of those hold other bytes than the object under their name.
        differing: u64,
    },
    /// The run, read again, no longer qualified. Nothing was written and nothing
    /// removed.
    Skipped,
    /// The folder holds only files nothing accounts for, `differing` of which
    /// hold other bytes than the object under their name. Nothing was removed.
    KeptUnaccounted {
        /// How many files hold other bytes than the object under their name.
        differing: u64,
    },
    /// The bucket's listing lacks an object the run's manifest names, so a refresh
    /// would read the run from this folder again. Nothing was removed.
    KeptUnlisted,
    /// The folder holds a file the run's manifest records as existing nowhere, so
    /// the run's confirmation was withdrawn for a refresh to publish the file.
    /// Nothing was removed.
    Withdrawn,
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

/// The files of an unpublished run's folder a pass removes: all but the
/// [session record](crate::store::SESSION_RECORD_FILE) and the two files at the
/// folder's root ([`TREE_ROOT_FILES`](test_cabinet_core::TREE_ROOT_FILES)). The
/// console reads the code-analysis document, and the arena the controller
/// module, from the backend alone, and an unpublished run has no bucket copy of
/// either.
fn unpublished_removals(folder: &RunFolder) -> Vec<Removable> {
    folder
        .reclaimable()
        .filter(|file| !test_cabinet_core::TREE_ROOT_FILES.contains(&file.name.as_str()))
        .map(|file| Removable {
            file: file.clone(),
            published: None,
        })
        .collect()
}

/// What removing a list of files came to.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct Removed {
    /// Files removed.
    files: u64,
    /// The bytes they held.
    bytes: u64,
    /// Files that could not be removed.
    failed: u64,
    /// Files left because they were written again since the listing.
    changed: u64,
    /// Files left because their bytes are not their object's.
    differing: u64,
}

/// Remove `removals` from run `run_id`'s folder one by one, each only while it is
/// the file that was listed and holds what its object does, then the directories
/// that emptied.
///
/// `published` is whether the run is a published one whose every removal was
/// held against the bucket. A [scrubbed
/// document](crate::store::is_scrubbed_document) of such a run is compared by
/// its published form, by the removal itself and on the file it removes. Only
/// then is a [session record](crate::store::SESSION_RECORD_FILE) among
/// `removals` removed; the store refuses it otherwise.
async fn remove_files(
    store: &DefinitionStore,
    run_id: &str,
    removals: Vec<Removable>,
    published: bool,
) -> Removed {
    let id = run_id.to_string();
    let removed = on_disk(store, move |store| {
        let mut removed = Removed::default();
        for removal in &removals {
            let name = &removal.file.name;
            let outcome = if published && crate::store::is_scrubbed_document(name) {
                store.remove_published_document(&id, &removal.file, removal.published.as_ref())
            } else {
                store.remove_run_file_as_listed(&id, &removal.file, removal.published.as_ref())
            };
            match outcome {
                Ok(Removal::Removed) => {
                    removed.files += 1;
                    removed.bytes += removal.file.bytes;
                }
                // Gone already, which is what the removal was for.
                Ok(Removal::Gone) => {}
                Ok(Removal::Changed) => {
                    removed.changed += 1;
                    tracing::info!(run.id = %id, file = %name, "kept a run's file in the backend store: it was written again as it was being reclaimed");
                }
                Ok(Removal::Differs) => {
                    removed.differing += 1;
                    warn_once(&id, name, "its bytes are not the ones the bucket holds under its name");
                }
                Err(error) => {
                    removed.failed += 1;
                    tracing::warn!(run.id = %id, file = %name, %error, "could not remove a run's file from the backend store");
                }
            }
        }
        store.prune_run_dirs(&id);
        Ok(removed)
    })
    .await;
    removed.unwrap_or_else(|error| {
        tracing::warn!(run.id = %run_id, %error, "removing a run's files from the backend store did not finish");
        Removed {
            failed: 1,
            ..Removed::default()
        }
    })
}

/// Log at `warn` that `file` of run `run_id` is kept in the store because of
/// `why`, the first time this process finds it so, and at `debug` after that.
///
/// A file kept for one of these reasons is kept at every pass until someone acts
/// on it, and a pass runs every few minutes.
fn warn_once(run_id: &str, file: &str, why: &'static str) {
    static SEEN: std::sync::OnceLock<std::sync::Mutex<HashSet<String>>> =
        std::sync::OnceLock::new();
    let first = SEEN
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .insert(format!("{run_id}/{file}"));
    if first {
        tracing::warn!(
            run.id = %run_id,
            file,
            why,
            "kept a published run's file in the backend store; it is the only copy of its bytes"
        );
    } else {
        tracing::debug!(run.id = %run_id, file, why, "kept a published run's file in the backend store");
    }
}

/// Whether the file of run `run_id` named `name`, its code-analysis document or
/// its session record, is what `object` holds: published again in memory, it has
/// the object's size and, where the bucket reported one, its MD5. `Ok(false)` as
/// well for a file that does not publish, and for one that is gone.
///
/// This spares a folder whose document differs the record of a reclaim that
/// removes nothing. It does not decide the removal: the store compares the file
/// once more as it removes it
/// ([`remove_published_document`](DefinitionStore::remove_published_document)).
///
/// One file is read at a time, on a blocking thread, and a session record is
/// hashed as it is scrubbed, so a pass holds no record however large.
async fn scrubbed_document_matches(
    store: &DefinitionStore,
    run_id: &str,
    name: &str,
    object: BucketObject,
) -> crate::error::Result<bool> {
    let id = run_id.to_string();
    let name = name.to_string();
    on_disk(store, move |store| {
        let Some(mut stored) = store.open_run_file(&id, &name)? else {
            return Ok(false);
        };
        let Some((size, md5)) = crate::snapshot::published_document_digest(&name, &mut stored)
        else {
            return Ok(false);
        };
        Ok(object.size == Some(size) && object.md5.is_none_or(|held| held == md5))
    })
    .await
}

/// The objects `bucket` holds for run `run_id`, or why it could not say within
/// `within`. A listing that has not answered by then is an error like any other:
/// without the bound, one connection that stalls would hold the only task that
/// runs passes for ever.
async fn run_objects_within<B: RunBucket>(
    bucket: &B,
    run_id: &str,
    within: Duration,
) -> Result<HashMap<String, BucketObject>, String> {
    match tokio::time::timeout(within, bucket.run_objects(run_id)).await {
        Ok(listing) => listing,
        Err(_) => Err(format!(
            "the bucket did not answer within {}s",
            within.as_secs()
        )),
    }
}

/// Remove the files of run `run_id`, a run a pass selected for `reason`, once the
/// run still qualifies as it stands now.
///
/// In order: read the run's facts and whether anything is working on it, list its
/// folder, decide the rule again, and for a published run read its manifest,
/// list the bucket, require every object the manifest names in that listing, and
/// [account](account_folder) for every file. Then record the reclaim on the run,
/// read once more whether anything is working on it, and only then remove the
/// files that were listed, each only while it is still the listed file and, for
/// a published run, holds what its object holds.
///
/// The record is written by a statement that names the facts just read, so a run
/// stored again, published, or whose confirmation was withdrawn since is left
/// alone. It is taken back when work on the run began as it was written, and when
/// the removal removed nothing. A removal that removed some files keeps it: the
/// files that are gone are gone on purpose, and the next pass removes the rest.
///
/// A published folder holding a file the manifest records as existing nowhere
/// has its run's confirmation withdrawn instead: the file is there to publish,
/// and the refresh the withdrawal brings about publishes it.
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
        return StateReclaim::KeptUnaccounted { differing: 0 };
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
    let (remove, kept, mut differing) = match reason {
        ReclaimReason::Published => {
            let manifest = match db.run_media_manifest(run_id, policy.bucket).await {
                Ok(Some(manifest)) => manifest,
                Ok(None) => return StateReclaim::Skipped,
                Err(error) => {
                    tracing::error!(run.id = %run_id, %error, "a confirmed run's file manifest could not be read; its files are kept");
                    return StateReclaim::Failed;
                }
            };
            // Without a bucket to ask there is no published reason to begin with.
            let Some(bucket) = bucket else {
                return StateReclaim::Skipped;
            };
            let objects = match run_objects_within(bucket, run_id, BUCKET_LISTING_TIMEOUT).await {
                Ok(objects) => objects,
                Err(error) => {
                    tracing::warn!(run.id = %run_id, %error, "could not list a run's objects in the bucket before reclaiming its files; they are kept and the next pass tries again");
                    return StateReclaim::Failed;
                }
            };
            let unlisted: Vec<&str> = manifest
                .keys()
                .filter(|key| !objects.contains_key(*key))
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
            let mut accounting = account_folder(&folder, &manifest, &objects);
            if !accounting.unpublished.is_empty() {
                return withdraw_for_unpublished(db, &fresh, &accounting.unpublished).await;
            }
            // A session record the manifest does not name is one no refresh
            // has read: the run was confirmed while its folder held none. A
            // confirmed run is built from its manifest, so nothing would ever
            // publish the record while the confirmation stands.
            if accounting
                .unaccounted
                .iter()
                .any(|file| file == crate::store::SESSION_RECORD_FILE)
            {
                return withdraw_for_unrecorded_session_record(db, &fresh).await;
            }
            for (file, object) in std::mem::take(&mut accounting.transformed) {
                let Some(size) = object.size else {
                    accounting.differing.push(file.name);
                    continue;
                };
                match scrubbed_document_matches(store, run_id, &file.name, object).await {
                    Ok(true) => accounting.remove.push(Removable {
                        file,
                        published: Some(PublishedCopy {
                            size,
                            md5: object.md5,
                        }),
                    }),
                    Ok(false) => accounting.differing.push(file.name),
                    Err(error) => {
                        tracing::warn!(run.id = %run_id, file = %file.name, %error, "could not compare a run's scrubbed document with its object; retrying next pass");
                        return StateReclaim::Failed;
                    }
                }
            }
            for file in &accounting.unaccounted {
                warn_once(run_id, file, "the run's manifest records no object for it");
            }
            for file in &accounting.differing {
                warn_once(
                    run_id,
                    file,
                    "the object under its name is another size, or the bucket did not say",
                );
            }
            let kept = accounting.kept().count() as u64;
            let differing = accounting.differing.len() as u64;
            (accounting.remove, kept, differing)
        }
        ReclaimReason::Failed | ReclaimReason::Canceled => (unpublished_removals(&folder), 0, 0),
    };
    if remove.is_empty() {
        return if kept > 0 {
            StateReclaim::KeptUnaccounted { differing }
        } else {
            StateReclaim::Skipped
        };
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
    let removed = remove_files(store, run_id, remove, reason == ReclaimReason::Published).await;
    differing += removed.differing;
    let kept = kept + removed.differing + removed.changed;
    if removed.files == 0 {
        restore().await;
        return if removed.failed > 0 {
            StateReclaim::Failed
        } else if kept > 0 {
            StateReclaim::KeptUnaccounted { differing }
        } else {
            StateReclaim::Skipped
        };
    }
    log_reclaimed(
        run_id,
        reason.as_str(),
        removed.files,
        removed.bytes,
        removed.failed,
    );
    StateReclaim::Reclaimed {
        files: removed.files,
        bytes: removed.bytes,
        failed: removed.failed,
        kept,
        differing,
    }
}

/// Withdraw the confirmation of `run`, a published run whose folder holds
/// `files` although its manifest records them as existing nowhere.
///
/// That record was true of what the refresh could reach when it was made: a
/// volume mounted empty for one start, or a file restored since, makes it
/// untrue. The manifest stays as the record of where the run's other files are.
/// The run reads as one no refresh has evaluated, so the publisher requests a
/// refresh, which finds the files in the store, publishes them and confirms the
/// run with a manifest that names their objects.
async fn withdraw_for_unpublished(db: &Db, run: &RetentionRun, files: &[String]) -> StateReclaim {
    match db.withdraw_media_confirmation(run).await {
        Ok(true) => {
            tracing::warn!(
                run.id = %run.id,
                files = %files.join(", "),
                "a published run's folder holds files its manifest records as existing \
                 nowhere; withdrew its media confirmation so a refresh publishes them"
            );
            StateReclaim::Withdrawn
        }
        // The confirmation moved since it was read.
        Ok(false) => StateReclaim::Skipped,
        Err(error) => {
            tracing::warn!(run.id = %run.id, %error, "could not withdraw a run's media confirmation; retrying next pass");
            StateReclaim::Failed
        }
    }
}

/// Withdraw the confirmation of `run`, a published run whose folder holds a
/// session record its manifest does not name, so that the next refresh reads the
/// folder, publishes the record and enters it. Nothing is removed.
///
/// The refresh that follows either names the record, or leaves the run
/// unconfirmed for a record it cannot publish. Neither brings the run back here
/// as it is, so a run is withdrawn for its record once.
async fn withdraw_for_unrecorded_session_record(db: &Db, run: &RetentionRun) -> StateReclaim {
    match db.withdraw_media_confirmation(run).await {
        Ok(true) => {
            tracing::warn!(
                run.id = %run.id,
                file = crate::store::SESSION_RECORD_FILE,
                "a published run's folder holds a session record its manifest does not \
                 name; withdrew its media confirmation so a refresh publishes it"
            );
            StateReclaim::Withdrawn
        }
        // The confirmation moved since it was read.
        Ok(false) => StateReclaim::Skipped,
        Err(error) => {
            tracing::warn!(run.id = %run.id, %error, "could not withdraw a run's media confirmation; retrying next pass");
            StateReclaim::Failed
        }
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
        return StateReclaim::KeptUnaccounted { differing: 0 };
    }
    let expired = modified_at(&folder).is_some_and(|modified| orphan_expired(modified, now, grace));
    if !expired {
        return StateReclaim::Skipped;
    }
    let remove: Vec<Removable> = folder
        .reclaimable()
        .map(|file| Removable {
            file: file.clone(),
            published: None,
        })
        .collect();
    if remove.is_empty() {
        return StateReclaim::Skipped;
    }
    let removed = remove_files(store, run_id, remove, false).await;
    if removed.files == 0 {
        return if removed.failed > 0 {
            StateReclaim::Failed
        } else {
            StateReclaim::Skipped
        };
    }
    log_reclaimed(run_id, ORPHAN, removed.files, removed.bytes, removed.failed);
    StateReclaim::Reclaimed {
        files: removed.files,
        bytes: removed.bytes,
        failed: removed.failed,
        kept: removed.changed,
        differing: 0,
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
///
/// The folders of runs are decided as they are met. The orphans are gathered and
/// decided together once every folder has been seen, because whether any of them
/// is removed depends on how many there are ([`orphans_held`]).
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
    let mut orphans: Vec<&String> = Vec::new();
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
        if folder.files.is_empty() && folder.irregular.is_empty() {
            continue;
        }
        // Only a published run's session record is removed, so the folder of
        // any other run that holds nothing else has nothing to remove.
        let only_record = folder.reclaimable().next().is_none() && folder.irregular.is_empty();
        let Some(modified) = modified_at(&folder) else {
            // Entries the store did not write, and no file to date them by.
            outcome.kept_unaccounted += 1;
            warn_irregular(run_id, &folder);
            continue;
        };
        let Some(run) = by_id.get(run_id.as_str()) else {
            if !only_record && !busy.contains(run_id) && orphan_expired(modified, now, rules.grace)
            {
                orphans.push(run_id);
            }
            continue;
        };
        let selected = state_retention_reason(run, busy.contains(run_id), modified, now, policy);
        let Some(reason) = selected else {
            if run.published && policy.published {
                outcome.unconfirmed += 1;
            }
            continue;
        };
        // What is left of an unpublished run once its files were reclaimed is
        // kept on purpose, and is not a folder to decide again every pass.
        if reason != ReclaimReason::Published
            && folder.irregular.is_empty()
            && unpublished_removals(&folder).is_empty()
        {
            continue;
        }
        let reclaim = reclaim_run_state(db, store, bucket, run_id, reason, now, policy).await;
        if matches!(reclaim, StateReclaim::Reclaimed { .. }) {
            match reason {
                ReclaimReason::Published => outcome.reclaimed_published += 1,
                ReclaimReason::Failed => outcome.reclaimed_failed += 1,
                ReclaimReason::Canceled => outcome.reclaimed_canceled += 1,
            }
        }
        if matches!(reclaim, StateReclaim::KeptUnaccounted { .. }) {
            warn_irregular(run_id, &folder);
        }
        outcome.count(&reclaim);
    }
    if orphans_held(orphans.len(), folders.len()) {
        outcome.orphans_held = orphans.len();
        tracing::error!(
            orphans = orphans.len(),
            folders = folders.len(),
            "the backend store holds an implausible number of folders with no run; none \
             was removed. A database older than the store looks like this"
        );
    } else {
        for run_id in orphans {
            let reclaim = reclaim_orphan_folder(db, store, run_id, now, rules.grace).await;
            if matches!(reclaim, StateReclaim::Reclaimed { .. }) {
                outcome.reclaimed_orphans += 1;
            }
            outcome.count(&reclaim);
        }
    }
    crate::metrics::record_state_kept_unaccounted(outcome.kept_unaccounted as u64);
    outcome
}

/// Log that `folder` holds entries the store does not write, when it does.
fn warn_irregular(run_id: &str, folder: &RunFolder) {
    for entry in &folder.irregular {
        warn_once(
            run_id,
            entry,
            "the store does not write entries of this kind",
        );
    }
}

impl StateSweepOutcome {
    /// Count how one folder's reclaim ended.
    fn count(&mut self, reclaim: &StateReclaim) {
        match reclaim {
            StateReclaim::Reclaimed {
                files,
                bytes,
                failed,
                kept,
                differing,
            } => {
                self.reclaimed += 1;
                self.removed_files += files;
                self.freed_bytes += bytes;
                self.differing_files += differing;
                if *failed > 0 {
                    self.failed += 1;
                }
                if *kept > 0 {
                    self.kept_unaccounted += 1;
                }
            }
            StateReclaim::Skipped => self.skipped += 1,
            StateReclaim::KeptUnaccounted { differing } => {
                self.kept_unaccounted += 1;
                self.differing_files += differing;
            }
            StateReclaim::KeptUnlisted => self.kept_unlisted += 1,
            StateReclaim::Withdrawn => self.withdrawn += 1,
            StateReclaim::Failed => self.failed += 1,
        }
    }
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
                differing_files = outcome.differing_files,
                withdrawn = outcome.withdrawn,
                orphans_held = outcome.orphans_held,
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
