//! Shared test support: building `tar` uploads and seeding a store held in
//! memory.

use std::sync::Arc;

use super::{ArtifactStore, MemoryStore, RunTree};
use crate::object::{ObjectBody, body_from_bytes, collect_body};

/// A limit no test upload comes near.
pub(crate) const NO_LIMIT: u64 = u64::MAX;

/// A `tar` archive of `(path, contents)` entries, as the driver frames a run
/// directory: paths relative to the run root.
pub(crate) fn tar_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut builder = tar::Builder::new(Vec::new());
    for (path, contents) in entries {
        let mut header = tar::Header::new_gnu();
        header.set_size(contents.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        builder
            .append_data(&mut header, path, *contents)
            .expect("append entry");
    }
    builder.into_inner().expect("finish tar")
}

/// A run-tree store over a fresh [`MemoryStore`], and the memory store itself
/// for asserting on the keys it holds.
pub(crate) fn memory_store() -> (ArtifactStore, MemoryStore) {
    let objects = MemoryStore::new();
    (ArtifactStore::new(Arc::new(objects.clone())), objects)
}

/// Store run `id`'s tree of `entries`, failing the test on a refusal.
pub(crate) async fn seed(store: &ArtifactStore, id: &str, entries: &[(&str, &[u8])]) {
    store
        .store_run(id, body_from_bytes(tar_of(entries)), NO_LIMIT)
        .await
        .expect("store the run tree");
}

/// A body of `bytes` as `parts` chunks, as a network upload arrives.
pub(crate) fn chunked(bytes: Vec<u8>, parts: usize) -> ObjectBody {
    let size = bytes.len().div_ceil(parts.max(1)).max(1);
    let chunks: Vec<std::io::Result<bytes::Bytes>> = bytes
        .chunks(size)
        .map(|chunk| Ok(bytes::Bytes::copy_from_slice(chunk)))
        .collect();
    Box::pin(futures_util::stream::iter(chunks))
}

/// Read the file at `path` of `tree` whole, `None` when absent.
pub(crate) async fn read_file(tree: &RunTree, path: &str) -> Option<Vec<u8>> {
    let object = tree.get(path).await.expect("read the tree")?;
    Some(collect_body(object.body).await.expect("read the body"))
}
