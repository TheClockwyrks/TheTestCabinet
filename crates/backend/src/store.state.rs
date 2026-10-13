//! What the [state reclamation sweep](crate::state_reclaim) reads and removes in
//! the store's `runs/` directory, and the free space of the volume the store is
//! on.
//!
//! Nothing here decides what is deleted. The store lists a run's folder, removes
//! the files it is told to by name, and removes the directories that emptied.

use std::path::Path;
use std::time::SystemTime;

use super::{DefinitionStore, is_safe_segment};
use crate::error::{BackendError, Result};

/// The name of a gg run's session record in its run's folder (`replay.json`).
///
/// The one file of a run with no copy anywhere else: it is never published, so no
/// [manifest](crate::db::MediaManifest) names it and no sweep removes it.
pub const SESSION_RECORD_FILE: &str = "replay.json";

/// One file in a run's folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunFolderFile {
    /// The file's path under the run's folder, forward-slashed: the name a
    /// [manifest](crate::db::MediaManifestFile::name) records it under.
    pub name: String,
    /// The file's size.
    pub bytes: u64,
}

/// What a run's folder in the store holds.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RunFolder {
    /// Every regular file under the folder, sorted by name.
    pub files: Vec<RunFolderFile>,
    /// The entries that are neither a regular file nor a directory, and those
    /// whose name is not text, as best they can be named. The store writes
    /// neither, so a folder holding one is not a folder the store understands.
    pub irregular: Vec<String>,
    /// When the most recently written file was written. `None` for a folder with
    /// no file.
    pub modified: Option<SystemTime>,
}

impl RunFolder {
    /// The files other than the [session record](SESSION_RECORD_FILE).
    pub fn reclaimable(&self) -> impl Iterator<Item = &RunFolderFile> {
        self.files
            .iter()
            .filter(|file| file.name != SESSION_RECORD_FILE)
    }

    /// The session record's size, when the folder holds one.
    pub fn session_record_bytes(&self) -> Option<u64> {
        self.files
            .iter()
            .find(|file| file.name == SESSION_RECORD_FILE)
            .map(|file| file.bytes)
    }
}

/// The free and total bytes of the filesystem the store is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StateVolume {
    /// Bytes the backend can still write.
    pub free_bytes: u64,
    /// The size of the filesystem.
    pub total_bytes: u64,
}

impl DefinitionStore {
    /// Write one file of a run at `path`, creating its directory.
    ///
    /// Every write of a run's file goes through here, holding the store's write
    /// lock shared from before the directory is made sure of until the bytes are
    /// written. [`prune_run_dirs`](Self::prune_run_dirs) holds it exclusively, so
    /// it never removes a directory between those two steps.
    pub(super) fn write_run_file(&self, path: &Path, bytes: &[u8]) -> Result<()> {
        let _writing = self
            .run_writes
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, bytes)?;
        Ok(())
    }

    /// The ids of the runs the store holds a folder for: the names of the
    /// directories under `runs/`, sorted. A store with no `runs/` directory holds
    /// none. An entry that is not a directory, or whose name is not a safe path
    /// segment, is no run's folder and is left out.
    pub fn list_run_folders(&self) -> Result<Vec<String>> {
        let read = match std::fs::read_dir(self.root.join("runs")) {
            Ok(read) => read,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(err) => return Err(err.into()),
        };
        let mut ids = Vec::new();
        for entry in read {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            if let Some(name) = entry.file_name().to_str()
                && is_safe_segment(name)
            {
                ids.push(name.to_string());
            }
        }
        ids.sort();
        Ok(ids)
    }

    /// Everything run `run_id`'s folder holds. A run with no folder holds
    /// nothing. Any entry that cannot be read is an error: a caller that deletes
    /// on what this returns must not take a folder it half saw for the whole of
    /// it.
    pub fn run_folder(&self, run_id: &str) -> Result<RunFolder> {
        if !is_safe_segment(run_id) {
            return Err(BackendError::BadRequest("invalid run id".to_string()));
        }
        let root = self.run_dir(run_id);
        let mut folder = RunFolder::default();
        walk_run_folder(&root, &root, &mut folder)?;
        folder.files.sort_by(|a, b| a.name.cmp(&b.name));
        folder.irregular.sort();
        Ok(folder)
    }

    /// Remove the file of run `run_id` named `name`, a path under the run's
    /// folder as [`run_folder`](Self::run_folder) reports it. Returns whether a
    /// file was removed: `false` for one that was already gone.
    ///
    /// The [session record](SESSION_RECORD_FILE) is refused, whatever the caller
    /// decided: it has no other copy.
    pub fn remove_run_file(&self, run_id: &str, name: &str) -> Result<bool> {
        if name == SESSION_RECORD_FILE {
            return Err(BackendError::BadRequest(format!(
                "run `{run_id}`'s session record is never removed from the store"
            )));
        }
        let path = self.run_file_path(run_id, name).ok_or_else(|| {
            BackendError::BadRequest(format!("invalid run file `{run_id}/{name}`"))
        })?;
        #[cfg(test)]
        if self.fail_removals.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(BackendError::Internal(format!(
                "removing `{run_id}/{name}` was made to fail"
            )));
        }
        match std::fs::remove_file(&path) {
            Ok(()) => Ok(true),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(err) => Err(err.into()),
        }
    }

    /// Remove the directories of run `run_id`'s folder that hold nothing, the
    /// folder itself included. A directory that holds anything is left as it is,
    /// so this removes no file.
    ///
    /// Best-effort: an emptied directory that could not be removed costs an
    /// inode, and the next call removes it.
    pub fn prune_run_dirs(&self, run_id: &str) {
        if !is_safe_segment(run_id) {
            return;
        }
        let _pruning = self
            .run_writes
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        prune_empty_dirs(&self.run_dir(run_id));
    }

    /// The free and total bytes of the filesystem the store is on.
    pub fn state_volume(&self) -> std::io::Result<StateVolume> {
        filesystem_capacity(&self.root)
    }
}

/// Add everything under `dir` to `folder`, naming each file by its path under
/// `root`. A `dir` that is not there adds nothing.
fn walk_run_folder(root: &Path, dir: &Path, folder: &mut RunFolder) -> Result<()> {
    let read = match std::fs::read_dir(dir) {
        Ok(read) => read,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(err.into()),
    };
    for entry in read {
        let entry = entry?;
        let path = entry.path();
        let name = path
            .strip_prefix(root)
            .ok()
            .and_then(|rel| rel.to_str())
            .map(|rel| rel.replace('\\', "/"));
        // `symlink_metadata`, so a link is seen as a link and never followed out
        // of the folder.
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            // Removed while the folder was walked: it is not there to list.
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(err) => return Err(err.into()),
        };
        let Some(name) = name else {
            folder
                .irregular
                .push(path.to_string_lossy().replace('\\', "/"));
            continue;
        };
        if metadata.is_dir() {
            walk_run_folder(root, &path, folder)?;
        } else if metadata.is_file() {
            let modified = metadata.modified()?;
            folder.modified = Some(folder.modified.map_or(modified, |seen| seen.max(modified)));
            folder.files.push(RunFolderFile {
                name,
                bytes: metadata.len(),
            });
        } else {
            folder.irregular.push(name);
        }
    }
    Ok(())
}

/// Remove `dir` and every directory under it that holds nothing. Returns whether
/// `dir` itself is gone.
fn prune_empty_dirs(dir: &Path) -> bool {
    let Ok(read) = std::fs::read_dir(dir) else {
        return false;
    };
    let mut empty = true;
    for entry in read {
        let Ok(entry) = entry else {
            return false;
        };
        let is_dir = std::fs::symlink_metadata(entry.path()).is_ok_and(|meta| meta.is_dir());
        if !is_dir || !prune_empty_dirs(&entry.path()) {
            empty = false;
        }
    }
    // `remove_dir` removes only an empty directory, so a file written since the
    // listing above keeps its directory.
    empty && std::fs::remove_dir(dir).is_ok()
}

/// The free and total bytes of the filesystem `path` is on.
#[cfg(unix)]
fn filesystem_capacity(path: &Path) -> std::io::Result<StateVolume> {
    let stat = rustix::fs::statvfs(path)?;
    // Both counts are in fragments. `f_bavail` is what an unprivileged process may
    // still allocate, which on a filesystem with reserved blocks is less than
    // `f_bfree`, and the backend does not run as root.
    Ok(StateVolume {
        free_bytes: stat.f_bavail.saturating_mul(stat.f_frsize),
        total_bytes: stat.f_blocks.saturating_mul(stat.f_frsize),
    })
}

/// The free and total bytes of the filesystem `path` is on.
#[cfg(not(unix))]
fn filesystem_capacity(_path: &Path) -> std::io::Result<StateVolume> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "the state volume's free space can only be read on a unix host",
    ))
}
