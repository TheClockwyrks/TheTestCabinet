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

use std::sync::Arc;

use crate::blob::{BlobClient, BlobError};
use crate::object::{ByteRange, ObjectBody, ObjectProperties, ObjectStream};
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

#[cfg(test)]
#[path = "public.test.rs"]
mod tests;
