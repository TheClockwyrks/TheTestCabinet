//! Content digests: what a stored version was ingested from, so a
//! [`changed`](test_cabinet_contracts::ingest::IngestMode::Changed) scan can tell an
//! edited version from one the store already holds, and a client reading the stored
//! digest back can tell whether the checkout still matches it.
//!
//! [API](https://docs.testcabinet.ai/components/backend/api/#post-ingest) is
//! authoritative. A digest is SHA-256 over a version folder's files, visiting their
//! relative paths in sorted order and hashing each path followed by its bytes, then
//! over the companion files outside the folder the stored record also depends on.
//! The walk sees what the backend's ingest copies: hidden entries are skipped except
//! the dotfiles a case ships, and a symlink contributes its target rather than what
//! it points at.
//!
//! The backend's ingest computes it, and The Spec Cabinet computes it over its own
//! checkout, so the two are one function rather than two that could disagree.

use std::path::Path;

use std::io::Result;

use sha2::{Digest, Sha256};

use crate::test_case::is_seeded_dotfile;
use test_cabinet_contracts::layout::REFERENCE_LOCK_FILENAME;

/// Framing tags, so a file's bytes can never be read as the next path and a
/// companion can never be read as a folder file.
const FILE: u8 = b'F';
const LINK: u8 = b'L';
const COMPANION: u8 = b'C';
const ABSENT: u8 = b'A';

/// The digest of an authored test case or game jam version: its folder, plus the
/// committed reference-builds lockfile the backend reconciles beside it.
///
/// `definitions_root` is the directory holding `test-cases/`: the repository
/// checkout by default, or the backend's `TCAB_DEFINITIONS_ROOT`. The lockfile is
/// read from `<definitions_root>/test-cases/`.
pub fn authored_version_digest(version_dir: &Path, definitions_root: &Path) -> Result<String> {
    let lock = definitions_root
        .join("test-cases")
        .join(REFERENCE_LOCK_FILENAME);
    digest_version(version_dir, &[(REFERENCE_LOCK_FILENAME, &lock)])
}

/// The digest of one suite version: its folder, plus the suite's `suite.toml`, whose
/// display name every lowered definition reports.
///
/// The manifest is passed as a path so the digest does not depend on where a suite
/// layout keeps it.
pub fn suite_version_digest(version_dir: &Path, suite_manifest: &Path) -> Result<String> {
    digest_version(version_dir, &[("suite.toml", suite_manifest)])
}

/// SHA-256 over `version_dir`'s files in sorted relative-path order, then over each
/// companion under its key, rendered as lowercase hex. A companion that does not
/// exist contributes its key alone, so creating it changes the digest.
pub fn digest_version(version_dir: &Path, companions: &[(&str, &Path)]) -> Result<String> {
    let mut entries = Vec::new();
    collect(version_dir, "", &mut entries)?;
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    let mut hasher = Sha256::new();
    for (relative, path, is_link) in &entries {
        if *is_link {
            let target = std::fs::read_link(path)?;
            frame(
                &mut hasher,
                LINK,
                relative,
                target.to_string_lossy().as_bytes(),
            );
        } else {
            frame(&mut hasher, FILE, relative, &std::fs::read(path)?);
        }
    }
    for (key, path) in companions {
        match std::fs::read(path) {
            Ok(bytes) => frame(&mut hasher, COMPANION, key, &bytes),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                frame(&mut hasher, ABSENT, key, &[]);
            }
            Err(err) => return Err(err),
        }
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Hash one entry: its tag, its path, and its length-prefixed bytes.
fn frame(hasher: &mut Sha256, tag: u8, path: &str, bytes: &[u8]) {
    hasher.update([tag]);
    hasher.update((path.len() as u64).to_le_bytes());
    hasher.update(path.as_bytes());
    hasher.update((bytes.len() as u64).to_le_bytes());
    hasher.update(bytes);
}

/// Gather every file and symlink under `dir` as `(relative path, host path, is a
/// symlink)`, with `/`-separated relative paths.
fn collect(
    dir: &Path,
    prefix: &str,
    into: &mut Vec<(String, std::path::PathBuf, bool)>,
) -> Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') && !is_seeded_dotfile(&name) {
            continue;
        }
        let relative = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            into.push((relative, entry.path(), true));
        } else if file_type.is_dir() {
            collect(&entry.path(), &relative, into)?;
        } else {
            into.push((relative, entry.path(), false));
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "content_digest.test.rs"]
mod tests;
