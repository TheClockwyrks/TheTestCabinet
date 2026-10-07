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

use flate2::Compression;
use flate2::write::GzEncoder;

/// A failure reading from or writing to the artifact store.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    /// An I/O operation against the backing store failed.
    #[error("artifact store io error: {0}")]
    Io(#[from] std::io::Error),
    /// The uploaded tarball contained an entry whose path escaped the run's
    /// directory (a `..` segment or absolute path) — a traversal attempt, refused.
    #[error("artifact entry `{0}` escapes the run directory")]
    Traversal(String),
    /// A read was requested for a run with no stored tree. Distinct from an I/O
    /// fault so the HTTP layer can map it to a `404` rather than a `500`.
    #[error("no stored tree for run `{0}`")]
    NotFound(String),
}

/// One stored run tree, as [`ArtifactStore::list_runs`] reports it.
#[derive(Debug, Clone)]
pub struct StoredTree {
    /// The run id the tree is keyed by (`<root>/<id>/`).
    pub id: String,
    /// When the tree was last written, which is the moment the driver's upload
    /// finished unpacking. The backend's reclamation sweep measures its grace window
    /// against this, so a store impl must report the tree's own write time rather
    /// than the time of the listing.
    pub modified: std::time::SystemTime,
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

    /// A directory the service may spool an in-flight upload into before unpacking
    /// it, on the **same filesystem** as the run trees.
    ///
    /// Same filesystem is the requirement, not a preference: the spooled tarball and
    /// the tree it unpacks into draw on one pool of free space, so a store with room
    /// for the tree has room for the archive of it, and neither can be exhausted by
    /// the other's volume filling independently. It also keeps the unpack a local
    /// read rather than a copy across mounts.
    ///
    /// This exists so `store_run` can be fed from a file instead of a buffer — see
    /// the upload handler in `api.rs` for why holding an upload in memory is the one
    /// allocation this service must not make.
    fn scratch_dir(&self) -> PathBuf;

    /// Remove run `id`'s entire artifact tree (`<root>/<id>/`). Idempotent: a run
    /// that was never uploaded (no directory) is treated as already gone. Called
    /// when the control plane deletes a run, so the data plane drops its build and
    /// media too rather than leaving an orphaned tree behind.
    fn delete_run(&self, id: &str) -> Result<(), StoreError>;

    /// Every run tree the store currently holds, with each tree's last-write time.
    ///
    /// The backend's reclamation sweep is the caller: it intersects these ids against
    /// its own run rows and deletes what nothing references. That makes the listing
    /// the control plane's only view of what the data plane is holding, so it must
    /// report exactly the trees a [`delete_run`](ArtifactStore::delete_run) would
    /// remove — an id the store cannot key by is skipped rather than reported.
    ///
    /// An upload in flight carries no entry here: it is spooled into
    /// [`scratch_dir`](ArtifactStore::scratch_dir) as an unnamed file and becomes a
    /// run directory only once it has been unpacked.
    fn list_runs(&self) -> Result<Vec<StoredTree>, StoreError>;

    /// Answer `Ok(())` when run `id` has a stored tree, [`StoreError::NotFound`] when
    /// it does not, and [`StoreError::Traversal`] for an id that is not a single safe
    /// path segment.
    ///
    /// This exists because the two archive writers below **stream**: they are handed
    /// a sink and fill it as they walk. Once the first byte is on the wire the status
    /// code is spent, so a `404` for an unknown run can no longer be sent — the
    /// question has to be asked *before* the response begins. Every caller that
    /// streams therefore calls this first, and the writers call it again themselves
    /// so a direct caller cannot skip it.
    fn ensure_run_tree(&self, id: &str) -> Result<(), StoreError>;

    /// Write run `id`'s tree — the whole `implementation/` directory plus
    /// `run-record.json` and (when present) `events.jsonl` — into `out` as a `tar`
    /// archive, building it as it goes: the inverse of
    /// [`store_run`](ArtifactStore::store_run). The publisher Job downloads this to
    /// drive the GitHub-repo + Pages release: it needs the generated **source**
    /// (which `release_code` gits into a public repo) *and* the built playable output
    /// under `implementation/` (which `release_playable_build` deploys to Pages),
    /// plus the record and recorded events without extra round-trips. So the
    /// `implementation/` tree is archived whole — only the run's *separately
    /// addressed* proof/asset media endpoints are not bundled here (they live under
    /// the run root, not under `implementation/`, and the publisher does not
    /// republish them).
    ///
    /// The archive is written rather than returned so the service never holds a whole
    /// run tree in memory: `out` is the response body's sink, and the walk proceeds
    /// at the rate the client drains it. A sink that fails — the usual cause being a
    /// client that hung up — aborts the walk with that [`StoreError::Io`] rather than
    /// finishing an archive nobody is reading.
    ///
    /// An `Err` out of this means the archive in `out` is PARTIAL, and the caller must
    /// make its reader see that. It cannot be inferred from the bytes: `tar::Builder`
    /// terminates the archive from its own `Drop` on the way out of a failing walk, so
    /// a truncated tar is a well-formed tar. The streaming caller answers it by
    /// aborting the response body — see `ChannelWriter` in `api.rs`.
    ///
    /// Returns [`StoreError::NotFound`] when the run has no stored tree, and the entry
    /// paths are relative to the run root (`implementation/...`, `run-record.json`,
    /// `events.jsonl`), matching the layout `store_run` unpacks — so the publisher
    /// untars it back to the same shape the driver produced.
    fn write_run_tree(&self, id: &str, out: &mut dyn std::io::Write) -> Result<(), StoreError>;

    /// Write run `id`'s **entire** stored directory into `out` as one gzip-tar,
    /// building and compressing it as it goes, for a reviewer downloading the run's
    /// produced tree in one request.
    ///
    /// Deliberately *not* [`write_run_tree`](ArtifactStore::write_run_tree)'s subset.
    /// That one is shaped for the publisher, which wants only what it republishes
    /// (`implementation/` + the record + normalized events). A reviewer downloading
    /// a run wants what the run actually produced — which for an asset-generation
    /// or full-stack case is largely the proof/asset/validation media sitting
    /// *beside* `implementation/`, plus `raw.jsonl`. So this walks the run root
    /// whole, matching what `scripts/extract-cluster-assets.sh` pulls out of the
    /// cluster; the point of the endpoint is to make that script's job a single
    /// download.
    ///
    /// Entries are prefixed with the run id (so the archive unpacks to
    /// `<run-id>/…` rather than spraying the caller's working directory), and the
    /// stream is gzip-framed — a run tree is source, JSON, and NDJSON, which
    /// compresses hard, and the transfer is the whole cost being optimized here.
    ///
    /// Same streaming contract as `write_run_tree`, and the same reason: this is the
    /// **ungated** route the console links as a plain download, so any reviewer can
    /// ask for the largest tree the store holds and must not be able to set the
    /// service's peak allocation by doing so.
    ///
    /// Returns [`StoreError::NotFound`] when the run has no stored tree, and
    /// [`StoreError::Traversal`] for an id that is not a single safe path segment.
    fn write_run_archive(&self, id: &str, out: &mut dyn std::io::Write) -> Result<(), StoreError>;
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
    fn scratch_dir(&self) -> PathBuf {
        // The store root itself: every run tree is a subdirectory of it, so it is by
        // construction the same filesystem. A spooled upload is an unnamed temp file,
        // so it adds no entry here for `run_dir` lookups to trip over.
        self.root.clone()
    }

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

    fn list_runs(&self) -> Result<Vec<StoredTree>, StoreError> {
        let mut trees = Vec::new();
        for entry in std::fs::read_dir(&self.root)? {
            let entry = entry?;
            // Only directories are run trees. A spooled upload is an unnamed temp
            // file in this same root, and it must never be reported as a tree the
            // sweep could delete.
            if !entry.file_type()?.is_dir() {
                continue;
            }
            // A name that is not a usable store key could not be deleted through
            // `delete_run` anyway, so reporting it would only hand the sweep an id it
            // cannot act on.
            let Some(id) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if !is_safe_id(&id) {
                continue;
            }
            trees.push(StoredTree {
                id,
                modified: entry.metadata()?.modified()?,
            });
        }
        Ok(trees)
    }

    fn ensure_run_tree(&self, id: &str) -> Result<(), StoreError> {
        // Guard the id here rather than only in the archive walk: both writers reach
        // the filesystem by joining the id onto the store root instead of going
        // through the canonicalizing core resolvers, so an id that is not a single
        // safe path segment must be refused before either of them starts.
        if !is_safe_id(id) {
            return Err(StoreError::Traversal(id.to_string()));
        }
        // An absent run directory is an unknown run, mapped to a `404` upstream —
        // not a `500`. (An id with no stored tree never created the directory.)
        if !self.run_dir(id).is_dir() {
            return Err(StoreError::NotFound(id.to_string()));
        }
        Ok(())
    }

    fn write_run_tree(&self, id: &str, out: &mut dyn std::io::Write) -> Result<(), StoreError> {
        self.ensure_run_tree(id)?;
        let run_dir = self.run_dir(id);

        let mut builder = tar::Builder::new(out);
        // The whole `implementation/` tree: the generated source `release_code` gits
        // into the public repo *and* the built playable output `release_playable_build`
        // deploys to Pages both live under it. `append_dir_all` keeps the
        // `implementation/` prefix, so the archive untars back to the same layout the
        // driver produced.
        let impl_dir = run_dir.join("implementation");
        if impl_dir.is_dir() {
            builder.append_dir_all("implementation", &impl_dir)?;
        }
        // The record and the recorded events sit beside `implementation/` and the
        // publisher reads them without an extra round-trip; each is optional, so a
        // missing file is simply skipped rather than failing the archive.
        for file in ["run-record.json", "events.jsonl"] {
            let path = run_dir.join(file);
            match std::fs::File::open(&path) {
                Ok(mut handle) => builder.append_file(file, &mut handle)?,
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => return Err(err.into()),
            }
        }
        // `finish` writes the two zero blocks that terminate a tar. Calling it
        // explicitly, rather than letting the builder's `Drop` do it and swallow the
        // result, is what makes a sink failure on the *last* write reach the caller.
        //
        // IT IS NOT WHAT SIGNALS A TRUNCATED ARCHIVE. `Drop` writes those same blocks
        // on the way out of a failing walk, so an archive that stopped half way is
        // terminated just as neatly as one that finished. The signal therefore lives
        // one layer out, in the response body: see `ChannelWriter` in `api.rs`, which
        // withholds the buffered tail and pushes an error into the stream so the
        // download fails as a download.
        builder.finish()?;
        Ok(())
    }

    fn write_run_archive(&self, id: &str, out: &mut dyn std::io::Write) -> Result<(), StoreError> {
        self.ensure_run_tree(id)?;
        let run_dir = self.run_dir(id);

        // Compress into the sink as the archive is built rather than gzipping a
        // finished tar, so neither the tar nor its compressed form is ever held whole.
        let encoder = GzEncoder::new(out, Compression::default());
        let mut builder = tar::Builder::new(encoder);
        // `append_dir_all(id, run_dir)` archives the directory's contents *under* an
        // `<id>/` prefix, which is what `tar -C /artifacts -czf … "$run"` produces —
        // so an archive downloaded here unpacks to the same `<run-id>/` layout the
        // extract script's output has, and existing tooling reads it unchanged.
        builder.append_dir_all(id, &run_dir)?;
        // Terminate the tar, then flush the gzip trailer. Both have to happen against
        // the live sink, and both can fail against a client that hung up mid-download.
        builder.finish()?;
        builder.into_inner()?.finish()?;
        Ok(())
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
