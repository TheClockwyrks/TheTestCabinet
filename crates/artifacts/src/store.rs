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
    /// The uploaded bytes are not an archive the store can read: a header that
    /// does not parse, or a body that ends part way through an entry. Distinct
    /// from an I/O fault because it is the upload's own, and sending the same
    /// bytes to a healthy store gets the same answer. The HTTP layer maps it to a
    /// `422`.
    #[error("the uploaded archive cannot be read: {0}")]
    Malformed(String),
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

/// How full the store is, as [`ArtifactStore::capacity`] reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StoreCapacity {
    /// Bytes an upload can still be written into.
    pub free_bytes: u64,
    /// The size of the whole store, used and free.
    pub total_bytes: u64,
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
    ///
    /// The replacement is **all or nothing**. A run's tree becomes visible to
    /// [`run_dir`](ArtifactStore::run_dir), [`list_runs`](ArtifactStore::list_runs)
    /// and [`ensure_run_tree`](ArtifactStore::ensure_run_tree) only once every entry
    /// has been written, and an `Err` leaves the run exactly as it was before the
    /// call: with its prior tree, or with none. A store that fills part way through
    /// an unpack must not leave a directory that later reads as a stored tree.
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
    /// [`scratch_dir`](ArtifactStore::scratch_dir) as an unnamed file, and
    /// [`store_run`](ArtifactStore::store_run) makes it a run directory only once
    /// it has been unpacked whole.
    fn list_runs(&self) -> Result<Vec<StoredTree>, StoreError>;

    /// How much room the store has left, read at the moment of the call.
    ///
    /// The backend holds new runs back on this figure, so it must be the space an
    /// upload can actually use: what this process may still write, rather than what
    /// the volume reserves for a privileged user.
    fn capacity(&self) -> Result<StoreCapacity, StoreError>;

    /// Check that the store can take an upload right now, by taking a small one
    /// through every step [`store_run`](ArtifactStore::store_run) takes: spool a
    /// file in [`scratch_dir`](ArtifactStore::scratch_dir) and sync it to the
    /// volume, unpack a one-file archive into a staging directory, move the
    /// unpacked tree to where run trees live, and remove it.
    ///
    /// [`capacity`](ArtifactStore::capacity) says how much room there is, which a
    /// read-only volume, a disk fault or lost permissions leave untouched. This is
    /// what establishes that an upload could land before a run's tree depends on
    /// it. An `Err` carries the fault as the operating system reported it.
    ///
    /// What it cannot establish is anything about a real tree's size, or about
    /// the service's path to the backend that verifies an upload's token. An
    /// upload that fails for one of those is evidence the backend takes from the
    /// driver that made it.
    ///
    /// The tree it stores is never visible as a run: its name is dot-led, which
    /// [`list_runs`](ArtifactStore::list_runs) and every read refuse.
    fn probe_write(&self) -> Result<(), StoreError>;

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

    /// Whether run `id` has a stored tree: [`ensure_run_tree`](Self::ensure_run_tree)
    /// with absence as an answer rather than an error. An id that is not a single
    /// safe path segment is still a [`StoreError::Traversal`].
    ///
    /// The backend asks this before it enqueues a publish, where "no tree" and "could
    /// not find out" lead to different decisions and so must not share a shape.
    fn has_run_tree(&self, id: &str) -> Result<bool, StoreError> {
        match self.ensure_run_tree(id) {
            Ok(()) => Ok(true),
            Err(StoreError::NotFound(_)) => Ok(false),
            Err(err) => Err(err),
        }
    }

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

/// The directory under the store root that in-flight uploads are unpacked into
/// before they are renamed into place, and that a replaced tree is moved to before
/// it is removed.
///
/// It sits inside the root so a staged tree is on the run trees' filesystem, which
/// is what makes the final `rename` atomic. Its leading dot is what keeps it out of
/// the store's key space: [`is_safe_id`] refuses every dot-led name, so it is never
/// listed, never answered for as a run, and never the target of a delete.
const STAGING_DIR: &str = ".staging";

/// The name a staged tree is unpacked under, inside its own staging directory.
const STAGED_TREE: &str = "tree";

/// What the name of a staging directory ends in when it holds a run's prior tree,
/// moved aside while its replacement takes the run directory. It is how startup
/// tells a complete tree it must put back from a partial one it must remove.
const REPLACED_SUFFIX: &str = ".replaced";

impl LocalFsStore {
    /// Build a store rooted at `root`, creating the directory if it does not yet
    /// exist (the first upload otherwise races on the parent). A failure to create
    /// it is surfaced so the service refuses to start against an unwritable root
    /// rather than failing every upload later.
    ///
    /// Whatever a previous process left staged is removed: an upload the service
    /// died in the middle of never reached its run directory, and its partial tree
    /// would otherwise hold space on the volume for good. The store has one owner,
    /// so nothing else can be staging into it at startup.
    ///
    /// The one thing put back first is a prior tree a replacement had moved aside
    /// when the process died, where the run directory it came from is missing: that
    /// tree is complete, and it is the only copy.
    pub fn new(root: impl Into<PathBuf>) -> Result<Self, StoreError> {
        let root = root.into();
        std::fs::create_dir_all(&root)?;
        restore_replaced_trees(&root)?;
        remove_stale_write_checks(&root)?;
        match std::fs::remove_dir_all(root.join(STAGING_DIR)) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => return Err(err.into()),
        }
        Ok(Self { root })
    }

    /// A fresh, uniquely named directory under [`STAGING_DIR`] for one upload of run
    /// `id`. It removes itself, and whatever is still inside it, when dropped.
    fn staging_dir(&self, id: &str) -> Result<tempfile::TempDir, StoreError> {
        let staging = self.root.join(STAGING_DIR);
        std::fs::create_dir_all(&staging)?;
        Ok(tempfile::Builder::new()
            .prefix(&format!("{id}."))
            .tempdir_in(staging)?)
    }

    /// A staging directory for run `id`'s prior tree, named so that startup
    /// [puts it back](restore_replaced_trees) if the process dies before the
    /// replacement has taken the run directory.
    fn replaced_dir(&self, id: &str) -> Result<tempfile::TempDir, StoreError> {
        let staging = self.root.join(STAGING_DIR);
        std::fs::create_dir_all(&staging)?;
        Ok(tempfile::Builder::new()
            .prefix(&format!("{id}."))
            .suffix(REPLACED_SUFFIX)
            .tempdir_in(staging)?)
    }

    /// Make the complete tree at `staged_tree` run `id`'s tree, replacing a prior
    /// one. On an `Err` the run directory holds what it held before.
    ///
    /// With no prior tree this is one `rename`. With one, the two directories are
    /// exchanged in a single step where the filesystem can do that, so the run
    /// directory holds a complete tree at every instant and the prior tree leaves
    /// with the staging directory. Elsewhere the prior tree is moved aside and the
    /// new one renamed in, which leaves an instant with no run directory; a process
    /// that dies in it has its prior tree put back at the next start.
    fn swap_into_place(
        &self,
        id: &str,
        staged_tree: &Path,
        run_dir: &Path,
    ) -> Result<(), StoreError> {
        if !run_dir.exists() {
            return Ok(std::fs::rename(staged_tree, run_dir)?);
        }
        match exchange(staged_tree, run_dir) {
            Ok(()) => return Ok(()),
            Err(err) if err.kind() == std::io::ErrorKind::Unsupported => {}
            Err(err) => return Err(err.into()),
        }
        let replaced = self.replaced_dir(id)?;
        let aside = replaced.path().join(STAGED_TREE);
        std::fs::rename(run_dir, &aside)?;
        if let Err(err) = std::fs::rename(staged_tree, run_dir) {
            // Best effort: the error being returned is the one that matters.
            let _ = std::fs::rename(&aside, run_dir);
            return Err(err.into());
        }
        Ok(())
    }
}

/// Exchange the directories at `a` and `b` in one atomic step.
/// [`Unsupported`](std::io::ErrorKind::Unsupported) when the platform or the
/// filesystem has no such step.
#[cfg(target_os = "linux")]
fn exchange(a: &Path, b: &Path) -> std::io::Result<()> {
    use rustix::fs::{CWD, RenameFlags, renameat_with};
    use rustix::io::Errno;
    match renameat_with(CWD, a, CWD, b, RenameFlags::EXCHANGE) {
        Ok(()) => Ok(()),
        // A kernel without `renameat2`, or a filesystem that takes no flags.
        Err(Errno::NOSYS | Errno::INVAL | Errno::OPNOTSUPP) => {
            Err(std::io::ErrorKind::Unsupported.into())
        }
        Err(err) => Err(err.into()),
    }
}

/// Exchange the directories at `a` and `b` in one atomic step.
/// [`Unsupported`](std::io::ErrorKind::Unsupported) when the platform or the
/// filesystem has no such step.
#[cfg(not(target_os = "linux"))]
fn exchange(_a: &Path, _b: &Path) -> std::io::Result<()> {
    Err(std::io::ErrorKind::Unsupported.into())
}

/// Put back each prior tree a replacement had moved aside under `root`'s staging
/// directory, where the run directory it came from is missing.
///
/// Only a directory named by [`LocalFsStore::replaced_dir`] is considered: it
/// holds a tree that was complete when it was moved. Anything else staged is an
/// unpack that never finished.
fn restore_replaced_trees(root: &Path) -> Result<(), StoreError> {
    let entries = match std::fs::read_dir(root.join(STAGING_DIR)) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(err.into()),
    };
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name();
        // `<id>.<random>.replaced`: the random part carries no dot.
        let Some(id) = name
            .to_str()
            .and_then(|name| name.strip_suffix(REPLACED_SUFFIX))
            .and_then(|name| name.rsplit_once('.'))
            .map(|(id, _)| id)
        else {
            continue;
        };
        let aside = entry.path().join(STAGED_TREE);
        let run_dir = root.join(id);
        if is_safe_id(id) && aside.is_dir() && !run_dir.exists() {
            std::fs::rename(&aside, &run_dir)?;
            tracing::warn!(
                run_id = %id,
                "restored a run tree that was moved aside for a replacement which never landed"
            );
        }
    }
    Ok(())
}

/// Remove each tree a [write check](ArtifactStore::probe_write) left under `root`
/// when the process died between storing it and removing it.
fn remove_stale_write_checks(root: &Path) -> Result<(), StoreError> {
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        if entry
            .file_name()
            .to_str()
            .is_some_and(|name| name.starts_with(WRITE_CHECK_PREFIX))
        {
            match std::fs::remove_dir_all(entry.path()) {
                Ok(()) => {}
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => return Err(err.into()),
            }
        }
    }
    Ok(())
}

/// Whether `err`, or anything it wraps, is an error the operating system
/// reported.
fn carries_os_error(err: &std::io::Error) -> bool {
    if err.raw_os_error().is_some() {
        return true;
    }
    let mut source: Option<&(dyn std::error::Error + 'static)> = match err.get_ref() {
        Some(inner) => Some(inner),
        None => None,
    };
    while let Some(inner) = source {
        if let Some(io) = inner.downcast_ref::<std::io::Error>()
            && carries_os_error(io)
        {
            return true;
        }
        source = inner.source();
    }
    false
}

/// Sort a failure to read or unpack the archive: [`StoreError::Malformed`] when
/// the archive is at fault, [`StoreError::Io`] when the volume is.
///
/// The `tar` reader wraps an operating-system error, from the spool file it reads
/// or the tree it writes, in an error of its own that keeps it as the source. It
/// makes an error with nothing beneath it for a header that does not parse and
/// for an archive that ends part way through an entry. So an error that carries
/// no OS error anywhere is the archive's, and anything the volume refused is not:
/// a full or faulted volume is never mistaken for a bad upload.
fn archive_error(err: std::io::Error) -> StoreError {
    if carries_os_error(&err) {
        StoreError::Io(err)
    } else {
        StoreError::Malformed(err.to_string())
    }
}

/// Unpack `tar` under `dest`, entry by entry, refusing any entry whose path would
/// land outside it.
///
/// A directory is created with the service's own default mode rather than the one
/// the archive records for it. A tree can hold a directory its owner may not write
/// to, which a package cache makes as a matter of course, and unpacking that mode
/// before the directory's contents would fail the upload of a sound tree on a
/// sound store.
fn unpack_tree(tar: &mut dyn Read, dest: &Path) -> Result<(), StoreError> {
    std::fs::create_dir_all(dest)?;
    // `tar`'s own `unpack` would honor `..`/absolute entries up to its internal
    // checks, but we guard explicitly and unpack entry-by-entry so a single bad
    // path aborts the whole upload with a precise error. `dest` is the extraction
    // base; every entry must resolve strictly inside it.
    let mut archive = tar::Archive::new(tar);
    for entry in archive.entries().map_err(archive_error)? {
        let mut entry = entry.map_err(archive_error)?;
        let path = entry.path().map_err(archive_error)?.into_owned();
        let target = safe_join(dest, &path)
            .ok_or_else(|| StoreError::Traversal(path.display().to_string()))?;
        if entry.header().entry_type().is_dir() {
            std::fs::create_dir_all(&target)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        // `unpack` writes the entry (file, dir, or symlink) at `target`; symlink
        // targets are not followed during write, and the resolver's own
        // canonicalize-and-`starts_with` check (in `serve_build_file`) catches a
        // symlink that points outside the tree at *read* time.
        entry.unpack(&target).map_err(archive_error)?;
    }
    Ok(())
}

/// What [`ArtifactStore::probe_write`] writes. One filesystem block is enough to
/// need an allocation, which a full volume refuses.
const WRITE_PROBE: &[u8] = &[0x5a; 4096];

/// What the name of the tree a [write check](ArtifactStore::probe_write) stores
/// begins with. Dot-led, so [`is_safe_id`] keeps it out of the store's key space
/// for the instant it exists.
const WRITE_CHECK_PREFIX: &str = ".write-check.";

/// Numbers the write checks of this process, for the name each one's tree takes.
static WRITE_CHECK_SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// The one file in the tree a write check stores.
const WRITE_CHECK_FILE: &str = "write-check";

/// A one-file `tar` archive of [`WRITE_PROBE`]: the upload a write check makes.
fn write_check_archive() -> std::io::Result<Vec<u8>> {
    let mut builder = tar::Builder::new(Vec::new());
    let mut header = tar::Header::new_gnu();
    header.set_size(WRITE_PROBE.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    builder.append_data(&mut header, WRITE_CHECK_FILE, WRITE_PROBE)?;
    builder.into_inner()
}

/// The free and total bytes of the filesystem `path` is on.
#[cfg(unix)]
fn filesystem_capacity(path: &Path) -> std::io::Result<StoreCapacity> {
    let stat = rustix::fs::statvfs(path)?;
    // Both counts are in fragments. `f_bavail` is what an unprivileged process may
    // still allocate, which on a filesystem with reserved blocks is less than
    // `f_bfree`, and the service does not run as root.
    Ok(StoreCapacity {
        free_bytes: stat.f_bavail.saturating_mul(stat.f_frsize),
        total_bytes: stat.f_blocks.saturating_mul(stat.f_frsize),
    })
}

/// The free and total bytes of the filesystem `path` is on.
#[cfg(not(unix))]
fn filesystem_capacity(_path: &Path) -> std::io::Result<StoreCapacity> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "the artifact store's free space can only be read on a unix host",
    ))
}

impl ArtifactStore for LocalFsStore {
    fn capacity(&self) -> Result<StoreCapacity, StoreError> {
        Ok(filesystem_capacity(&self.root)?)
    }

    fn probe_write(&self) -> Result<(), StoreError> {
        use std::io::{Seek, Write};
        // An unnamed file where an upload is spooled, exactly as the spool makes
        // one, so the check exercises the same create an upload starts with. It has
        // no directory entry, so dropping it is the removal.
        let mut spooled = tempfile::tempfile_in(self.scratch_dir())?;
        spooled.write_all(&write_check_archive()?)?;
        // Without the sync a write to a faulted or full volume can sit in the page
        // cache and read as a success.
        spooled.sync_all()?;
        spooled.rewind()?;

        // Then what `store_run` does with a spooled upload: unpack it into a
        // staging directory and move the tree to where run trees live. Each step
        // needs something of its own from the volume, and a store that has lost any
        // of them fails every upload after a spool that succeeded.
        let staged = self.staging_dir("write-check")?;
        let staged_tree = staged.path().join(STAGED_TREE);
        unpack_tree(&mut spooled, &staged_tree)?;
        // Named for this process and this check, so two never collide. A check the
        // process dies in the middle of leaves the tree for the next start to
        // remove.
        let landed = self.root.join(format!(
            "{WRITE_CHECK_PREFIX}{}.{}",
            std::process::id(),
            WRITE_CHECK_SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::rename(&staged_tree, &landed)?;
        let read_back = std::fs::read(landed.join(WRITE_CHECK_FILE));
        std::fs::remove_dir_all(&landed)?;
        if read_back? != WRITE_PROBE {
            return Err(std::io::Error::other(
                "the write check's tree did not read back as it was written",
            )
            .into());
        }
        Ok(())
    }

    fn scratch_dir(&self) -> PathBuf {
        // The store root itself: every run tree is a subdirectory of it, so it is by
        // construction the same filesystem. A spooled upload is an unnamed temp file,
        // so it adds no entry here for `run_dir` lookups to trip over. (The tree it
        // is then unpacked into is staged under `STAGING_DIR`, not here.)
        self.root.clone()
    }

    fn store_run(&self, id: &str, tar: &mut dyn Read) -> Result<(), StoreError> {
        // The id becomes a directory name that is renamed over and removed, so it is
        // held to the same rule as a delete's.
        if !is_safe_id(id) {
            return Err(StoreError::Traversal(id.to_string()));
        }
        let run_dir = self.run_dir(id);

        // Unpack into a staging directory first. Unpacking straight into the run
        // directory would make a failure part way through — the volume filling is the
        // one that happens — leave a directory that every reader then takes for a
        // stored tree, with the prior tree already removed to make room for it. A
        // failure here instead drops `staged`, which removes the partial tree, and
        // the run directory has not been touched.
        let staged = self.staging_dir(id)?;
        let staged_tree = staged.path().join(STAGED_TREE);
        unpack_tree(tar, &staged_tree)?;

        // Swap it in. Whatever the swap leaves staged, the prior tree included, is
        // removed as the staging directories drop.
        self.swap_into_place(id, &staged_tree, &run_dir)
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
/// not dot-led, and free of any path separator or NUL. A run id is a UUID, so this
/// only ever rejects a malformed or hostile path.
///
/// Refusing every dot-led name covers `.` and `..` and reserves the rest for the
/// store's own use: [`STAGING_DIR`] lives beside the run trees, and this is the one
/// rule that keeps it from being listed, served, or deleted as a run.
fn is_safe_id(id: &str) -> bool {
    !id.is_empty() && !id.starts_with('.') && !id.contains(['/', '\\', '\0'])
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
