//! The artifact backing store: where a run's collected artifact tree is held
//! between run-finish and publish-or-discard.
//!
//! A run's artifacts — its generated source tree, the built playable output, and
//! any proof/asset media — survive the ephemeral driver pod by being uploaded
//! here. The store is keyed per run id: each run's tree lives under a single
//! `<root>/<id>/` directory whose layout mirrors what the driver produced
//! (`run-record.json`, the `implementation/` tree, and optionally the
//! `events.jsonl`/`raw.jsonl` logs), so the shared [core resolvers]
//! (`find_build_output`/`serve_build_file`/`serve_proof_file`/`serve_asset_file`,
//! which take a `&Path`) read it unchanged.
//!
//! The store is an [`ArtifactStore`] trait with one impl today, [`LocalFsStore`],
//! a plain directory on a PVC. It is deliberately small — write one run's tree
//! from an uploaded tarball, and resolve a run's on-disk root path for the core
//! resolvers to serve from — so an **R2** (object-storage) impl is an obvious
//! later addition: it would download-and-cache (or stream) the same per-run tree
//! and expose the same root path. Because the store is internal to this service,
//! that swap never touches the backend or the clients. Until serving load demands
//! it, local disk is the zero-config choice (a plain directory on k3d, a PVC in a
//! cluster).
//!
//! [core resolvers]: test_cabinet_core::serve_build_file

use std::io::Read;
use std::path::{Path, PathBuf};

/// A failure reading from or writing to the artifact store.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    /// An I/O operation against the backing store failed.
    #[error("artifact store io error: {0}")]
    Io(#[from] std::io::Error),
    /// The uploaded tarball contained an entry whose path escaped the run's
    /// directory (a `..` segment or absolute path) — a traversal attempt, refused.
    #[error("rejected artifact entry `{0}`: path escapes the run directory")]
    Traversal(String),
}

/// The backing store for run artifacts, keyed per run id. Small by design (see the
/// module docs) so an R2 impl can be slotted in later behind the same interface.
pub trait ArtifactStore: Send + Sync {
    /// Write run `id`'s uploaded artifact tree, supplied as a `tar` archive
    /// (optionally gzip-framed is *not* assumed here — the caller hands a plain
    /// `tar` stream), under this run's directory. Every entry is unpacked relative
    /// to the run root; an entry whose path escapes it is a [`StoreError::Traversal`]
    /// and aborts the upload. An existing tree for the same id is replaced (a run
    /// id is unique, so this only matters for an idempotent re-upload).
    fn store_run(&self, id: &str, tar: &mut dyn Read) -> Result<(), StoreError>;

    /// The on-disk root directory for run `id` (`<root>/<id>/`), the path the core
    /// resolvers read a run's `run-record.json`, `implementation/`, and logs from.
    /// Returns the path whether or not the run has been uploaded; the resolvers map
    /// a missing tree to a `404`.
    fn run_dir(&self, id: &str) -> PathBuf;

    /// Remove run `id`'s entire artifact tree (`<root>/<id>/`). Idempotent: a run
    /// that was never uploaded (no directory) is treated as already gone. Called
    /// when the control plane deletes a run, so the data plane drops its build and
    /// media too rather than leaving an orphaned tree behind.
    fn delete_run(&self, id: &str) -> Result<(), StoreError>;
}

/// A [`LocalFsStore`] convenience: the implementation directory of a run
/// (`<root>/<id>/implementation/`), where the built playable output and the
/// collected source tree live. Free function (not a trait method) because it is
/// derived purely from [`ArtifactStore::run_dir`] and every store shares it.
pub fn impl_dir(store: &dyn ArtifactStore, id: &str) -> PathBuf {
    store.run_dir(id).join("implementation")
}

/// The local-filesystem [`ArtifactStore`]: a root directory (a PVC in a
/// deployment, a plain directory in local dev) with one `<root>/<id>/` subtree per
/// run. Zero-config and the right default for the bounded pre-publish working set;
/// an R2 impl supersedes it only when serving load demands a CDN/cache.
#[derive(Debug, Clone)]
pub struct LocalFsStore {
    /// The store root; each run's tree is a `<root>/<id>/` subdirectory.
    root: PathBuf,
}

impl LocalFsStore {
    /// Build a store rooted at `root`, creating the directory if it does not yet
    /// exist (the first upload otherwise races on the parent). A failure to create
    /// it is surfaced so the service refuses to start against an unwritable root
    /// rather than failing every upload later.
    pub fn new(root: impl Into<PathBuf>) -> Result<Self, StoreError> {
        let root = root.into();
        std::fs::create_dir_all(&root)?;
        Ok(Self { root })
    }
}

impl ArtifactStore for LocalFsStore {
    fn store_run(&self, id: &str, tar: &mut dyn Read) -> Result<(), StoreError> {
        let run_dir = self.run_dir(id);
        // Replace any prior tree for this id so a re-upload is clean rather than a
        // merge of two runs' files. A missing dir is fine to "remove".
        if run_dir.exists() {
            std::fs::remove_dir_all(&run_dir)?;
        }
        std::fs::create_dir_all(&run_dir)?;

        // `tar`'s own `unpack` would honor `..`/absolute entries up to its internal
        // checks, but we guard explicitly and unpack entry-by-entry so a single bad
        // path aborts the whole upload with a precise error rather than partially
        // extracting. The run root is the extraction base; every entry must resolve
        // strictly inside it.
        let mut archive = tar::Archive::new(tar);
        for entry in archive.entries()? {
            let mut entry = entry?;
            let path = entry.path()?.into_owned();
            let target = safe_join(&run_dir, &path)
                .ok_or_else(|| StoreError::Traversal(path.display().to_string()))?;
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)?;
            }
            // `unpack` writes the entry (file, dir, or symlink) at `target`; symlink
            // targets are not followed during write, and the resolver's own
            // canonicalize-and-`starts_with` check (in `serve_build_file`) catches a
            // symlink that points outside the tree at *read* time.
            entry.unpack(&target)?;
        }
        Ok(())
    }

    fn run_dir(&self, id: &str) -> PathBuf {
        self.root.join(id)
    }

    fn delete_run(&self, id: &str) -> Result<(), StoreError> {
        // `delete_run` removes a whole directory, so — unlike the read paths, which
        // hand `run_dir` to the canonicalizing core resolvers — guard the id here:
        // an id that is not a single safe path segment (`.`, `..`, or one carrying a
        // separator) could escape the store root and delete an unrelated tree.
        if !is_safe_id(id) {
            return Err(StoreError::Traversal(id.to_string()));
        }
        match std::fs::remove_dir_all(self.run_dir(id)) {
            Ok(()) => Ok(()),
            // A run with no stored tree is already in the desired state.
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(err) => Err(err.into()),
        }
    }
}

/// Whether `id` is a single safe path segment usable as a store key: non-empty,
/// neither `.` nor `..`, and free of any path separator or NUL. A run id is a
/// UUID, so this only ever rejects a malformed or hostile path.
fn is_safe_id(id: &str) -> bool {
    !id.is_empty() && id != "." && id != ".." && !id.contains(['/', '\\', '\0'])
}

/// Join a tar entry's relative `path` onto `base`, refusing anything that would
/// escape `base`: an absolute path, a `..` component, or a Windows prefix/root.
/// Returns the joined path on success, `None` on a traversal attempt. Plain `.`
/// and normal components are kept; empty input maps to `base` itself.
fn safe_join(base: &Path, path: &Path) -> Option<PathBuf> {
    use std::path::Component;
    let mut out = base.to_path_buf();
    for component in path.components() {
        match component {
            Component::Normal(segment) => out.push(segment),
            Component::CurDir => {}
            // `..`, an absolute root, or a Windows drive prefix could climb out of
            // the run directory — refuse the whole entry.
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    Some(out)
}

#[cfg(test)]
#[path = "store.test.rs"]
mod tests;
