//! The run-tree store: where a run's collected tree is held between run-finish
//! and publish-or-discard, as objects in the private Blob container.
//!
//! A run's artifacts — its generated source tree, the built playable output, its
//! proof, asset, validation and showcase media, and its recorded logs — survive
//! the ephemeral driver pod by being uploaded here. Every object of a run lives
//! under the run id, and the tree's layout below that mirrors what the driver
//! produced (`run-record.json`, the `implementation/` tree, the
//! `events.jsonl`/`raw.jsonl` logs), so a file of the tree is an object whose key
//! ends in the file's relative path.
//!
//! # Layout
//!
//! ```text
//! <id>/current                     the pointer: the generation that is the tree
//! <id>/g/<generation>/<path>       one object per file of an uploaded tree
//! ```
//!
//! An upload writes every file of the tree under a fresh generation, and only
//! once all of them are stored does it write the pointer naming that generation.
//! A write of one key is whole, so the pointer is the moment the new tree
//! replaces the old one: until it lands every read resolves to the previous
//! generation, and an upload that fails or is refused leaves nothing a read can
//! see. The previous generation is deleted after the pointer moves. A tree
//! exists exactly when its pointer does, which is what [`ArtifactStore::list_runs`]
//! reports, and the pointer's last-modified time is when the tree was uploaded.
//!
//! Every read resolves the pointer once and reads the generation it names, through
//! a [`RunTree`]. The objects themselves live in an [`ObjectStore`]: the
//! [`BlobStore`] in production and the [`MemoryStore`] in tests, so the rules
//! here are tested by the code that runs.
//!
//! The service holds no state of its own: everything a replica knows about a
//! tree it reads from the container, so any replica answers any request.

use std::sync::Arc;

use bytes::Bytes;
use time::OffsetDateTime;

use crate::object::{ObjectBody, ObjectStream, body_from_bytes, collect_body};

#[path = "store.objects.rs"]
mod objects;
pub use objects::{BlobStore, MemoryStore, ObjectStore};

#[path = "store.upload.rs"]
mod upload;
pub use upload::StoredUpload;

#[path = "store.archive.rs"]
mod archive;
pub use archive::{ArchiveFeed, ArchiveShape, start_archive, write_archive};

/// The name of a run's pointer object, below its id.
const POINTER: &str = "current";

/// The segment the generations of a run sit under, below its id.
const GENERATIONS: &str = "g";

/// The largest object the store reads whole into memory: a run record, or a
/// build's HTML document being relocated. Anything served verbatim is streamed
/// instead, whatever its size.
pub const MAX_WHOLE_READ_BYTES: u64 = 64 * 1024 * 1024;

/// A failure reading from or writing to the run-tree store.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    /// The object store failed a request.
    #[error("the object store failed: {0}")]
    Backend(#[source] Box<dyn std::error::Error + Send + Sync>),
    /// A body being read or written failed part-way.
    #[error("reading an object body: {0}")]
    Body(#[source] std::io::Error),
    /// An uploaded entry's path, or a run id, would escape the run's tree: a
    /// `..` segment, an absolute path, or an id that is not a single safe path
    /// segment. Refused.
    #[error("`{0}` escapes the run's tree")]
    Traversal(String),
    /// The upload is not a readable `tar` archive, or holds no files.
    #[error("the upload is not a usable tar archive: {0}")]
    Archive(String),
    /// The upload exceeded the byte limit it was accepted under.
    #[error("the upload exceeds the {0} byte limit")]
    TooLarge(u64),
    /// The upload's request body failed before it had been read to the end.
    #[error("reading the upload body: {0}")]
    UploadBody(#[source] std::io::Error),
    /// A read was requested for a run with no stored tree. Distinct from a
    /// store fault so the HTTP layer can map it to a `404` rather than a `500`.
    #[error("no stored tree for run `{0}`")]
    NotFound(String),
    /// An object the store reads whole is larger than [`MAX_WHOLE_READ_BYTES`].
    #[error("`{0}` is too large to read whole")]
    TooLargeToRead(String),
    /// The pointer object names something that is not a generation.
    #[error("the pointer of run `{0}` is corrupt")]
    CorruptPointer(String),
}

/// One stored run tree, as [`ArtifactStore::list_runs`] reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredTree {
    /// The run id the tree is keyed by.
    pub id: String,
    /// When the tree was uploaded: its pointer's last-modified time. The
    /// backend's reclamation sweep measures its grace window against this.
    pub modified: OffsetDateTime,
}

/// The store of run trees over an [`ObjectStore`]. See the module docs for the
/// layout and why a replace is atomic.
#[derive(Clone)]
pub struct ArtifactStore {
    objects: Arc<dyn ObjectStore>,
}

impl std::fmt::Debug for ArtifactStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ArtifactStore")
            .field("objects", &self.objects.describe())
            .finish()
    }
}

impl ArtifactStore {
    /// The store over `objects`.
    pub fn new(objects: Arc<dyn ObjectStore>) -> Self {
        Self { objects }
    }

    /// What the store is written to, for the startup log.
    pub fn describe(&self) -> String {
        self.objects.describe()
    }

    /// Store run `id`'s tree from `body`, a plain `tar` archive of the run
    /// directory, reading at most `limit` bytes of it. The archive is streamed
    /// into objects as it arrives, one per file, and never held whole.
    ///
    /// The tree replaces any earlier tree of the same id atomically: the files
    /// land under a fresh generation, the pointer is written last, and the
    /// previous generation is deleted after it. An upload that fails or is
    /// refused (a traversal entry, an unreadable archive, an archive with no
    /// files, a body over `limit`) leaves the earlier tree as it was and the
    /// partly written generation is deleted.
    pub async fn store_run(
        &self,
        id: &str,
        body: ObjectBody,
        limit: u64,
    ) -> Result<StoredUpload, StoreError> {
        ensure_safe_id(id)?;
        let generation = new_generation();
        let prefix = generation_prefix(id, &generation);
        let stored = match upload::unpack(self.objects.as_ref(), &prefix, body, limit).await {
            Ok(stored) => stored,
            Err(err) => {
                self.discard(id, &prefix).await;
                return Err(err);
            }
        };

        // The pointer is read just before it is replaced, so the generation
        // deleted afterwards is the one this upload superseded, never one a
        // concurrent upload of the same id is still writing.
        let previous = match self.pointer(id).await {
            Ok(previous) => previous,
            Err(err) => {
                self.discard(id, &prefix).await;
                return Err(err);
            }
        };
        if let Err(err) = self
            .objects
            .put(
                &pointer_key(id),
                body_from_bytes(Bytes::from(generation.clone())),
                "text/plain; charset=utf-8",
            )
            .await
        {
            self.discard(id, &prefix).await;
            return Err(err);
        }

        if let Some(previous) = previous.filter(|previous| *previous != generation) {
            let old = generation_prefix(id, &previous);
            if let Err(err) = objects::delete_prefix(self.objects.as_ref(), &old).await {
                // The new tree is in place; what is left is unreachable and the
                // next replace or the run's delete removes it.
                tracing::warn!(run.id = %id, generation = %previous, error = %err, "could not delete a replaced generation");
            }
        }
        Ok(stored)
    }

    /// Delete a partly written generation, logging rather than failing: the
    /// generation is unreachable without a pointer naming it, and the run's
    /// delete removes whatever is left under its id.
    async fn discard(&self, id: &str, prefix: &str) {
        if let Err(err) = objects::delete_prefix(self.objects.as_ref(), prefix).await {
            tracing::warn!(run.id = %id, prefix = %prefix, error = %err, "could not delete an abandoned generation");
        }
    }

    /// The generation run `id`'s pointer names, `None` when it has no tree.
    async fn pointer(&self, id: &str) -> Result<Option<String>, StoreError> {
        let Some(object) = self.objects.get(&pointer_key(id)).await? else {
            return Ok(None);
        };
        let bytes = read_whole(object, &pointer_key(id), 1024).await?;
        let generation = String::from_utf8(bytes)
            .ok()
            .map(|text| text.trim().to_string())
            .filter(|generation| is_safe_segment(generation))
            .ok_or_else(|| StoreError::CorruptPointer(id.to_string()))?;
        Ok(Some(generation))
    }

    /// The stored tree of run `id`: [`StoreError::NotFound`] when it has none,
    /// [`StoreError::Traversal`] for an id that is not a single safe path
    /// segment.
    ///
    /// The two whole-tree downloads stream, so the HTTP layer asks this before
    /// the response begins: once the first byte is on the wire the status code
    /// is spent, and a `404` can no longer be sent.
    pub async fn run_tree(&self, id: &str) -> Result<RunTree, StoreError> {
        ensure_safe_id(id)?;
        let generation = self
            .pointer(id)
            .await?
            .ok_or_else(|| StoreError::NotFound(id.to_string()))?;
        Ok(RunTree {
            objects: Arc::clone(&self.objects),
            id: id.to_string(),
            prefix: generation_prefix(id, &generation),
        })
    }

    /// Remove run `id`'s tree: the pointer first, so no read resolves to the
    /// tree while its objects are deleted, then every object under the id,
    /// including any generation an abandoned upload left. Idempotent: a run with
    /// no tree is already gone.
    pub async fn delete_run(&self, id: &str) -> Result<(), StoreError> {
        ensure_safe_id(id)?;
        self.objects.delete(&pointer_key(id)).await?;
        objects::delete_prefix(self.objects.as_ref(), &format!("{id}/")).await?;
        Ok(())
    }

    /// Every run tree the store holds, with each tree's upload time.
    ///
    /// The backend's reclamation sweep is the caller: it intersects these ids
    /// against its own run rows and deletes what nothing references. A tree is a
    /// run whose pointer exists, so an upload still in flight (its generation
    /// written, its pointer not) is not reported, and an id the store could not
    /// key by is skipped rather than handed to the sweep.
    pub async fn list_runs(&self) -> Result<Vec<StoredTree>, StoreError> {
        use futures_util::StreamExt as _;

        /// How many pointers are read at once.
        const CONCURRENT_READS: usize = 16;

        let listing = self.objects.list("", Some("/")).await?;
        let ids: Vec<String> = listing
            .prefixes
            .into_iter()
            .filter_map(|prefix| prefix.strip_suffix('/').map(str::to_string))
            .filter(|id| is_safe_segment(id))
            .collect();
        let objects = &self.objects;
        let results: Vec<Result<Option<StoredTree>, StoreError>> = futures_util::stream::iter(ids)
            .map(|id| async move {
                let properties = objects.head(&pointer_key(&id)).await?;
                Ok(properties.map(|properties| StoredTree {
                    modified: properties
                        .last_modified
                        .unwrap_or(OffsetDateTime::UNIX_EPOCH),
                    id,
                }))
            })
            .buffered(CONCURRENT_READS)
            .collect()
            .await;
        let mut trees = Vec::new();
        for result in results {
            if let Some(tree) = result? {
                trees.push(tree);
            }
        }
        Ok(trees)
    }
}

/// One object of a stored tree, as [`RunTree::list`] reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TreeObject {
    /// The object's path within the tree (`implementation/dist/index.html`).
    pub path: String,
    /// The object's size in bytes.
    pub size: u64,
    /// When the object was written.
    pub modified: Option<OffsetDateTime>,
}

/// A run's stored tree, resolved through its pointer to one generation. Every
/// read through it sees that generation, whatever an upload does meanwhile.
#[derive(Clone)]
pub struct RunTree {
    objects: Arc<dyn ObjectStore>,
    id: String,
    /// `<id>/g/<generation>/`.
    prefix: String,
}

impl std::fmt::Debug for RunTree {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RunTree")
            .field("id", &self.id)
            .field("prefix", &self.prefix)
            .finish_non_exhaustive()
    }
}

impl RunTree {
    /// The run id.
    pub fn id(&self) -> &str {
        &self.id
    }

    /// Read the file at `path` within the tree as a stream, `Ok(None)` when the
    /// tree holds no such file. A path that would leave the tree (a `..`
    /// segment) names nothing; empty and `.` segments are skipped, so a leading
    /// slash cannot leave it either.
    pub async fn get(&self, path: &str) -> Result<Option<ObjectStream>, StoreError> {
        match self.key(path) {
            Some(key) => self.objects.get(&key).await,
            None => Ok(None),
        }
    }

    /// Read the file at `path` whole, `Ok(None)` when it is absent. Refuses a
    /// file larger than [`MAX_WHOLE_READ_BYTES`].
    pub async fn read(&self, path: &str) -> Result<Option<Vec<u8>>, StoreError> {
        match self.get(path).await? {
            Some(object) => Ok(Some(read_whole(object, path, MAX_WHOLE_READ_BYTES).await?)),
            None => Ok(None),
        }
    }

    /// Every file of the tree under the directory `dir` (`""` for the whole
    /// tree), in path order.
    pub async fn list(&self, dir: &str) -> Result<Vec<TreeObject>, StoreError> {
        let Some(prefix) = self.dir_prefix(dir) else {
            return Ok(Vec::new());
        };
        let listing = self.objects.list(&prefix, None).await?;
        Ok(listing
            .blobs
            .into_iter()
            .filter_map(|blob| {
                let path = blob.name.strip_prefix(&self.prefix)?.to_string();
                Some(TreeObject {
                    path,
                    size: blob.properties.content_length,
                    modified: blob.properties.last_modified,
                })
            })
            .collect())
    }

    /// The names of the directories directly inside the directory `dir`.
    pub async fn subdirectories(&self, dir: &str) -> Result<Vec<String>, StoreError> {
        let Some(prefix) = self.dir_prefix(dir) else {
            return Ok(Vec::new());
        };
        let listing = self.objects.list(&prefix, Some("/")).await?;
        Ok(listing
            .prefixes
            .into_iter()
            .filter_map(|rolled| {
                rolled
                    .strip_prefix(&prefix)
                    .and_then(|rest| rest.strip_suffix('/'))
                    .map(str::to_string)
            })
            .collect())
    }

    /// The object key of the file at `path`, `None` when the path names no file
    /// of the tree (it leaves the tree, or it is the tree's root).
    fn key(&self, path: &str) -> Option<String> {
        let path = normalize_tree_path(path)?;
        (!path.is_empty()).then(|| format!("{}{path}", self.prefix))
    }

    /// The key prefix of the directory `dir`, ending in `/`.
    fn dir_prefix(&self, dir: &str) -> Option<String> {
        let dir = normalize_tree_path(dir)?;
        Some(if dir.is_empty() {
            self.prefix.clone()
        } else {
            format!("{}{dir}/", self.prefix)
        })
    }
}

/// Read `object` whole, refusing one larger than `limit` bytes. `name` labels
/// the refusal.
async fn read_whole(object: ObjectStream, name: &str, limit: u64) -> Result<Vec<u8>, StoreError> {
    if object.properties.content_length > limit {
        return Err(StoreError::TooLargeToRead(name.to_string()));
    }
    let bytes = collect_body(object.body).await.map_err(StoreError::Body)?;
    if bytes.len() as u64 > limit {
        return Err(StoreError::TooLargeToRead(name.to_string()));
    }
    Ok(bytes)
}

/// Normalize a path within a tree into the `/`-joined relative path it names,
/// or `None` when it would leave the tree. The build-serving traversal rule:
/// empty and `.` segments are skipped and a `..` segment is refused outright.
pub fn normalize_tree_path(path: &str) -> Option<String> {
    crate::build_rule::normalize_build_path(path)
}

/// Whether `id` is a single safe path segment usable as a key segment:
/// non-empty, neither `.` nor `..`, and free of any path separator or NUL. A run
/// id is a UUID, so this only ever rejects a malformed or hostile id.
fn is_safe_segment(id: &str) -> bool {
    !id.is_empty() && id != "." && id != ".." && !id.contains(['/', '\\', '\0'])
}

/// Refuse an id that is not a single safe path segment.
fn ensure_safe_id(id: &str) -> Result<(), StoreError> {
    if is_safe_segment(id) {
        Ok(())
    } else {
        Err(StoreError::Traversal(id.to_string()))
    }
}

/// The key of run `id`'s pointer.
fn pointer_key(id: &str) -> String {
    format!("{id}/{POINTER}")
}

/// The key prefix of run `id`'s `generation`, ending in `/`.
fn generation_prefix(id: &str, generation: &str) -> String {
    format!("{id}/{GENERATIONS}/{generation}/")
}

/// A fresh generation name: the upload's start time, so a listing of a run's
/// generations reads in upload order, then random bytes, so two replicas
/// starting an upload of the same run in the same instant cannot collide.
fn new_generation() -> String {
    let mut random = [0u8; 8];
    // Entropy failing leaves zeros; the timestamp alone still separates
    // uploads that do not start in the same nanosecond.
    let _ = getrandom::fill(&mut random);
    format!(
        "{:024x}-{}",
        OffsetDateTime::now_utc().unix_timestamp_nanos(),
        hex::encode(random)
    )
}

#[cfg(test)]
#[path = "store.testing.rs"]
pub(crate) mod testing;

#[cfg(test)]
#[path = "store.test.rs"]
mod tests;
