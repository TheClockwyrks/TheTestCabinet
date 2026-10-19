//! The public dataset's store: the bucket the gallery reads, which only this
//! service writes.
//!
//! In a deployment it is the environment's Cloudflare R2 bucket, written over
//! the S3 API ([`R2Client`]). On the local stack it is a container of the
//! Azurite emulator the run trees live in too ([`BlobClient`]), so nothing local
//! reaches Cloudflare. [`PublicStore`] is the one interface over both, and
//! [`PublicStoreConfig`] says which one an environment has.
//!
//! Every write is whole: an object of more than one
//! [piece](crate::object::PIECE_SIZE) is staged and committed at once, so a
//! reader sees the previous object or the new one, never a part.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use bytes::Bytes;

use crate::blob::{BlobClient, BlobError};
use crate::object::{
    ByteRange, ObjectBody, ObjectProperties, ObjectStream, body_from_bytes, collect_body,
};
use crate::r2::{R2Client, R2Config, R2Error};

/// A public-store request failed.
#[derive(Debug, thiserror::Error)]
pub enum PublicStoreError {
    /// The R2 bucket failed the request.
    #[error(transparent)]
    R2(#[from] R2Error),
    /// The Blob container failed the request.
    #[error(transparent)]
    Blob(#[from] BlobError),
}

/// Which store an environment's public dataset lives in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PublicStoreConfig {
    /// The Cloudflare R2 bucket named by the `TCAB_R2_*` variables.
    R2(R2Config),
    /// A container of the run-tree storage account
    /// (`TCAB_ARTIFACTS_PUBLIC_BLOB_CONTAINER`), the local stack's stand-in.
    Blob {
        /// The container's name.
        container: String,
    },
}

/// The public dataset's store.
#[async_trait::async_trait]
pub trait PublicStore: Send + Sync {
    /// What the store is, for the startup log: `r2` or `blob`.
    fn kind(&self) -> &'static str;

    /// Write `body` whole as object `key`, replacing any object of that name,
    /// with the content type and encoding stored on it. Returns the number of
    /// bytes written.
    async fn put(
        &self,
        key: &str,
        body: ObjectBody,
        content_type: &str,
        content_encoding: Option<&str>,
    ) -> Result<u64, PublicStoreError>;

    /// Read object `key`, or `range` of it, as a stream; `Ok(None)` when there
    /// is no such object.
    async fn get(
        &self,
        key: &str,
        range: Option<ByteRange>,
    ) -> Result<Option<ObjectStream>, PublicStoreError>;

    /// Read object `key`'s properties; `Ok(None)` when there is no such object.
    async fn head(&self, key: &str) -> Result<Option<ObjectProperties>, PublicStoreError>;

    /// Every object key under `prefix`, in name order.
    async fn list_keys(&self, prefix: &str) -> Result<Vec<String>, PublicStoreError>;
}

#[async_trait::async_trait]
impl PublicStore for R2Client {
    fn kind(&self) -> &'static str {
        "r2"
    }

    async fn put(
        &self,
        key: &str,
        body: ObjectBody,
        content_type: &str,
        content_encoding: Option<&str>,
    ) -> Result<u64, PublicStoreError> {
        Ok(self
            .upload(key, body, content_type, content_encoding)
            .await?)
    }

    async fn get(
        &self,
        key: &str,
        range: Option<ByteRange>,
    ) -> Result<Option<ObjectStream>, PublicStoreError> {
        Ok(self.get_object(key, range).await?)
    }

    async fn head(&self, key: &str) -> Result<Option<ObjectProperties>, PublicStoreError> {
        Ok(self.head_object(key).await?)
    }

    async fn list_keys(&self, prefix: &str) -> Result<Vec<String>, PublicStoreError> {
        Ok(R2Client::list_keys(self, prefix).await?)
    }
}

#[async_trait::async_trait]
impl PublicStore for BlobClient {
    fn kind(&self) -> &'static str {
        "blob"
    }

    async fn put(
        &self,
        key: &str,
        body: ObjectBody,
        content_type: &str,
        content_encoding: Option<&str>,
    ) -> Result<u64, PublicStoreError> {
        Ok(self
            .upload(key, body, content_type, content_encoding)
            .await?)
    }

    async fn get(
        &self,
        key: &str,
        range: Option<ByteRange>,
    ) -> Result<Option<ObjectStream>, PublicStoreError> {
        Ok(BlobClient::get(self, key, range).await?)
    }

    async fn head(&self, key: &str) -> Result<Option<ObjectProperties>, PublicStoreError> {
        Ok(self.properties(key).await?)
    }

    async fn list_keys(&self, prefix: &str) -> Result<Vec<String>, PublicStoreError> {
        Ok(self
            .list(prefix, None)
            .await?
            .blobs
            .into_iter()
            .map(|blob| blob.name)
            .collect())
    }
}

/// Open the configured public store. A Blob public store is a container of the
/// run-tree account, so it shares `runs`'s endpoint and credential.
pub fn open(config: &PublicStoreConfig, runs: &BlobClient) -> Arc<dyn PublicStore> {
    match config {
        PublicStoreConfig::R2(r2) => Arc::new(R2Client::new(r2.clone())),
        PublicStoreConfig::Blob { container } => Arc::new(runs.for_container(container)),
    }
}

/// One object a [`MemoryPublicStore`] holds: its bytes and the labels stored
/// on it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryObject {
    /// The object's bytes.
    pub body: Vec<u8>,
    /// The content type stored on it.
    pub content_type: String,
    /// The content encoding stored on it, when one was.
    pub content_encoding: Option<String>,
}

/// A [`PublicStore`] held in memory, for tests.
///
/// A write lands whole once its body has been read to the end, so a body that
/// fails leaves any earlier object in place, as the real stores' staged writes
/// do. It counts every write, so a test can assert that a key already held was
/// not written again.
#[derive(Debug, Clone, Default)]
pub struct MemoryPublicStore {
    objects: Arc<Mutex<BTreeMap<String, MemoryObject>>>,
    writes: Arc<Mutex<Vec<String>>>,
}

impl MemoryPublicStore {
    /// An empty store.
    pub fn new() -> Self {
        Self::default()
    }

    /// Store `body` at `key` directly, as an earlier publish left it, without
    /// counting it as a write.
    pub fn insert(&self, key: &str, body: &[u8], content_type: &str) {
        self.lock().insert(
            key.to_string(),
            MemoryObject {
                body: body.to_vec(),
                content_type: content_type.to_string(),
                content_encoding: None,
            },
        );
    }

    /// The object at `key`, when the store holds one.
    pub fn object(&self, key: &str) -> Option<MemoryObject> {
        self.lock().get(key).cloned()
    }

    /// Every key the store holds, in order.
    pub fn keys(&self) -> Vec<String> {
        self.lock().keys().cloned().collect()
    }

    /// Every key written through [`PublicStore::put`], in the order written.
    pub fn writes(&self) -> Vec<String> {
        self.writes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
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
            content_encoding: object.content_encoding.clone(),
            last_modified: None,
            etag: None,
        }
    }
}

#[async_trait::async_trait]
impl PublicStore for MemoryPublicStore {
    fn kind(&self) -> &'static str {
        "memory"
    }

    async fn put(
        &self,
        key: &str,
        body: ObjectBody,
        content_type: &str,
        content_encoding: Option<&str>,
    ) -> Result<u64, PublicStoreError> {
        let body = collect_body(body).await.map_err(|source| {
            PublicStoreError::Blob(BlobError::Body {
                target: key.to_string(),
                source,
            })
        })?;
        let length = body.len() as u64;
        self.lock().insert(
            key.to_string(),
            MemoryObject {
                body,
                content_type: content_type.to_string(),
                content_encoding: content_encoding.map(str::to_string),
            },
        );
        self.writes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(key.to_string());
        Ok(length)
    }

    async fn get(
        &self,
        key: &str,
        range: Option<ByteRange>,
    ) -> Result<Option<ObjectStream>, PublicStoreError> {
        let Some(object) = self.object(key) else {
            return Ok(None);
        };
        let mut body = Bytes::from(object.body.clone());
        if let Some(range) = range {
            let start = (range.start as usize).min(body.len());
            let end = range
                .end
                .map_or(body.len(), |end| (end as usize + 1).min(body.len()));
            body = body.slice(start..end.max(start));
        }
        let mut properties = Self::properties(&object);
        properties.content_length = body.len() as u64;
        Ok(Some(ObjectStream {
            properties,
            body: body_from_bytes(body),
        }))
    }

    async fn head(&self, key: &str) -> Result<Option<ObjectProperties>, PublicStoreError> {
        Ok(self.lock().get(key).map(Self::properties))
    }

    async fn list_keys(&self, prefix: &str) -> Result<Vec<String>, PublicStoreError> {
        Ok(self
            .lock()
            .keys()
            .filter(|key| key.starts_with(prefix))
            .cloned()
            .collect())
    }
}

#[cfg(test)]
#[path = "public.test.rs"]
mod tests;
