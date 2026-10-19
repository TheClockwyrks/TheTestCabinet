//! The object view the run-tree store is written over: a flat namespace of
//! keys, each naming one object written whole.
//!
//! [`ObjectStore`] is the handful of operations [`ArtifactStore`](super::ArtifactStore)
//! needs, and nothing a particular store offers beyond them. [`BlobStore`] is
//! the production impl, the private Azure Blob container the run trees live in.
//! [`MemoryStore`] holds the objects in a map, so the store's own rules (the
//! generation layout, the pointer written last, the archive walks) are tested
//! by the code that runs in production rather than by a second implementation
//! of them.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use bytes::Bytes;
use futures_util::StreamExt as _;
use time::OffsetDateTime;

use super::StoreError;
use crate::blob::{BlobClient, ListPage, ListedBlob};
use crate::object::{ObjectBody, ObjectProperties, ObjectStream, body_from_bytes, collect_body};

/// The operations the run-tree store needs of an object store.
///
/// A key is a `/`-separated name; the store has no directories, only names
/// that share a prefix. Every write is whole: a reader sees the previous
/// object or the new one, never a part.
#[async_trait::async_trait]
pub trait ObjectStore: Send + Sync {
    /// What the store is, for the startup log: the container it writes to.
    fn describe(&self) -> String;

    /// Write `body` whole as object `key` with `content_type` stored on it,
    /// replacing any object of that name. Returns the number of bytes written.
    async fn put(&self, key: &str, body: ObjectBody, content_type: &str)
    -> Result<u64, StoreError>;

    /// Read object `key` as a stream, `Ok(None)` when there is no such object.
    async fn get(&self, key: &str) -> Result<Option<ObjectStream>, StoreError>;

    /// Read object `key`'s properties, `Ok(None)` when there is no such object.
    async fn head(&self, key: &str) -> Result<Option<ObjectProperties>, StoreError>;

    /// Every object whose key starts with `prefix`. With a `delimiter`, keys
    /// continuing past it after the prefix are rolled up into
    /// [`ListPage::prefixes`] (each ending in the delimiter) instead.
    async fn list(&self, prefix: &str, delimiter: Option<&str>) -> Result<ListPage, StoreError>;

    /// Delete object `key`. `Ok(true)` when it existed.
    async fn delete(&self, key: &str) -> Result<bool, StoreError>;
}

/// The private Blob container the run trees live in.
#[derive(Debug, Clone)]
pub struct BlobStore {
    client: BlobClient,
}

impl BlobStore {
    /// The store over `client`'s container.
    pub fn new(client: BlobClient) -> Self {
        Self { client }
    }
}

/// A Blob failure as a store failure.
fn backend(err: crate::blob::BlobError) -> StoreError {
    StoreError::Backend(Box::new(err))
}

#[async_trait::async_trait]
impl ObjectStore for BlobStore {
    fn describe(&self) -> String {
        format!("blob container `{}`", self.client.container())
    }

    async fn put(
        &self,
        key: &str,
        body: ObjectBody,
        content_type: &str,
    ) -> Result<u64, StoreError> {
        self.client
            .upload(key, body, content_type, None)
            .await
            .map_err(backend)
    }

    async fn get(&self, key: &str) -> Result<Option<ObjectStream>, StoreError> {
        self.client.get(key, None).await.map_err(backend)
    }

    async fn head(&self, key: &str) -> Result<Option<ObjectProperties>, StoreError> {
        self.client.properties(key).await.map_err(backend)
    }

    async fn list(&self, prefix: &str, delimiter: Option<&str>) -> Result<ListPage, StoreError> {
        self.client.list(prefix, delimiter).await.map_err(backend)
    }

    async fn delete(&self, key: &str) -> Result<bool, StoreError> {
        self.client.delete(key).await.map_err(backend)
    }
}

/// One object a [`MemoryStore`] holds.
#[derive(Debug, Clone)]
struct MemoryObject {
    body: Bytes,
    content_type: String,
    last_modified: OffsetDateTime,
}

/// An [`ObjectStore`] held in memory, for tests.
///
/// It keeps the semantics the run-tree store relies on: a write lands whole
/// once its body has been read to the end (a body that fails leaves any
/// earlier object in place), a listing is in key order, and every object
/// carries the time it was written.
#[derive(Debug, Clone, Default)]
pub struct MemoryStore {
    objects: Arc<Mutex<BTreeMap<String, MemoryObject>>>,
    /// Writes to a key ending with this suffix fail, standing in for a store
    /// that faults part-way through an upload.
    failing_suffix: Arc<Mutex<Option<String>>>,
}

impl MemoryStore {
    /// An empty store.
    pub fn new() -> Self {
        Self::default()
    }

    /// Every key the store holds, in order.
    pub fn keys(&self) -> Vec<String> {
        self.lock().keys().cloned().collect()
    }

    /// Make every write to a key ending with `suffix` fail, or, with `None`,
    /// none.
    pub fn fail_writes_ending_with(&self, suffix: Option<&str>) {
        *self
            .failing_suffix
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = suffix.map(str::to_string);
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, BTreeMap<String, MemoryObject>> {
        self.objects
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn properties(object: &MemoryObject) -> ObjectProperties {
        ObjectProperties {
            content_length: object.body.len() as u64,
            content_type: Some(object.content_type.clone()),
            content_encoding: None,
            last_modified: Some(object.last_modified),
            etag: None,
        }
    }
}

#[async_trait::async_trait]
impl ObjectStore for MemoryStore {
    fn describe(&self) -> String {
        "memory store".to_string()
    }

    async fn put(
        &self,
        key: &str,
        body: ObjectBody,
        content_type: &str,
    ) -> Result<u64, StoreError> {
        let failing = self
            .failing_suffix
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        if let Some(suffix) = failing
            && key.ends_with(&suffix)
        {
            return Err(StoreError::Backend(
                format!("the memory store refuses writes to `{key}`").into(),
            ));
        }
        let body = Bytes::from(collect_body(body).await.map_err(StoreError::Body)?);
        let length = body.len() as u64;
        self.lock().insert(
            key.to_string(),
            MemoryObject {
                body,
                content_type: content_type.to_string(),
                last_modified: OffsetDateTime::now_utc(),
            },
        );
        Ok(length)
    }

    async fn get(&self, key: &str) -> Result<Option<ObjectStream>, StoreError> {
        let Some(object) = self.lock().get(key).cloned() else {
            return Ok(None);
        };
        // Hand the body out in several chunks, as a network store does, so a
        // reader that assumed one chunk per object is caught here.
        let properties = Self::properties(&object);
        let chunks: Vec<std::io::Result<Bytes>> = object
            .body
            .chunks(64 * 1024)
            .map(|chunk| Ok(object.body.slice_ref(chunk)))
            .collect();
        let body: ObjectBody = if chunks.is_empty() {
            body_from_bytes(Bytes::new())
        } else {
            Box::pin(futures_util::stream::iter(chunks))
        };
        Ok(Some(ObjectStream { properties, body }))
    }

    async fn head(&self, key: &str) -> Result<Option<ObjectProperties>, StoreError> {
        Ok(self.lock().get(key).map(Self::properties))
    }

    async fn list(&self, prefix: &str, delimiter: Option<&str>) -> Result<ListPage, StoreError> {
        let objects = self.lock();
        let mut page = ListPage::default();
        for (key, object) in objects.range(prefix.to_string()..) {
            let Some(rest) = key.strip_prefix(prefix) else {
                break;
            };
            if let Some(delimiter) = delimiter
                && let Some(at) = rest.find(delimiter)
            {
                let rolled = format!("{prefix}{}", &rest[..at + delimiter.len()]);
                if page.prefixes.last() != Some(&rolled) {
                    page.prefixes.push(rolled);
                }
                continue;
            }
            page.blobs.push(ListedBlob {
                name: key.clone(),
                properties: Self::properties(object),
            });
        }
        Ok(page)
    }

    async fn delete(&self, key: &str) -> Result<bool, StoreError> {
        Ok(self.lock().remove(key).is_some())
    }
}

/// Delete every object whose key starts with `prefix`, a few at a time.
/// Answers how many were deleted.
pub(super) async fn delete_prefix(
    objects: &dyn ObjectStore,
    prefix: &str,
) -> Result<usize, StoreError> {
    /// How many deletes are in flight at once.
    const CONCURRENT_DELETES: usize = 16;

    let listing = objects.list(prefix, None).await?;
    let results: Vec<Result<bool, StoreError>> = futures_util::stream::iter(listing.blobs)
        .map(|blob| async move { objects.delete(&blob.name).await })
        .buffer_unordered(CONCURRENT_DELETES)
        .collect()
        .await;
    let mut deleted = 0;
    for result in results {
        if result? {
            deleted += 1;
        }
    }
    Ok(deleted)
}
