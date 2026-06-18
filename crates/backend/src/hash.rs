//! Content hashing for container build contexts (§4 of
//! `design/v0.2.0-contracts.md`).
//!
//! The aggregate hash is the tag a runner applies to the image it builds from a
//! served definition, and the value the backend exposes as `contentHash`. Both
//! sides must compute it identically, so the recipe is fixed here and mirrored by
//! `core::backend_client::container_content_hash`:
//!
//!   1. For each file, compute `sha256(bytes)`.
//!   2. Sort the `(path, sha256)` pairs by path (byte order, forward-slash
//!      separators).
//!   3. Feed each pair into a running SHA-256 as `"{path}\n{sha256hex}\n"`.
//!   4. The aggregate is `"sha256:" + hex(digest)`.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// One file of a build context for hashing: its forward-slash store-relative
/// path, the hex SHA-256 of its bytes, and its size in bytes (surfaced in the
/// container resolution manifest).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HashedFile {
    /// Build-context-relative path, forward-slash separated.
    pub path: String,
    /// Lowercase hex SHA-256 of the file's bytes (no `sha256:` prefix).
    pub sha256: String,
    /// The file's size in bytes.
    pub size: u64,
}

/// The hex SHA-256 of a byte slice (lowercase, no prefix).
pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    hex::encode(digest)
}

/// The aggregate content hash over a set of build-context files, following the
/// §4 recipe. The input order is irrelevant — the files are sorted by path
/// first, so a runner and the backend agree regardless of traversal order.
pub fn aggregate_content_hash(files: &[HashedFile]) -> String {
    let mut sorted: Vec<&HashedFile> = files.iter().collect();
    sorted.sort_by(|a, b| a.path.as_bytes().cmp(b.path.as_bytes()));

    let mut hasher = Sha256::new();
    for file in sorted {
        hasher.update(file.path.as_bytes());
        hasher.update(b"\n");
        hasher.update(file.sha256.as_bytes());
        hasher.update(b"\n");
    }
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

#[cfg(test)]
#[path = "hash.test.rs"]
mod tests;
