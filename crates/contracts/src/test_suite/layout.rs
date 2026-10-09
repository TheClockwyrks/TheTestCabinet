//! The suites checkout's layout: where a suite's exported versions, drafts and
//! previews live, how a tree's place in it is read back, and the suite manifest a
//! tree belongs to.
//!
//! The catalog that lists and resolves them lives in
//! `test_cabinet_core::test_suite`; the names are here because the export rules
//! read a tree's place to decide which rules it is held to.

use std::path::{Path, PathBuf};

use super::model::SuiteManifest;
use super::version::{SUITE_MANIFEST_FILE, load_suite_manifest};
use super::{TestSuiteError, TestSuiteResult};

/// The directory name of the suites checkout inside a repository or a worker's
/// working copy, beside `test-cases/`.
pub const TEST_SUITES_DIR: &str = "test-suites";

/// The folder inside a suite that holds one folder per exported version.
pub const VERSIONS_DIR: &str = "versions";

/// The folder inside a suite that holds one folder per draft.
pub const DRAFTS_DIR: &str = "drafts";

/// The folder of the suites checkout The Spec Cabinet writes previews to.
pub const PREVIEWS_DIR: &str = ".previews";

/// The version folder name every preview carries before its draft's name:
/// `v0.0.0-preview.<draft>`.
pub const PREVIEW_VERSION_PREFIX: &str = "v0.0.0-preview.";

/// Whether a version folder name names a preview: the preview prerelease followed by
/// a non-empty draft name.
pub fn is_preview_version(version: &str) -> bool {
    version
        .strip_prefix(PREVIEW_VERSION_PREFIX)
        .is_some_and(|draft| !draft.is_empty())
}

/// The suite folder a suite tree belongs to, by where the layout places the tree.
///
/// An exported version at `<slug>/versions/<version>/` and a draft at
/// `<slug>/drafts/<draft>/` belong to `<slug>/`, and any other tree belongs to the
/// folder directly holding it. `None` for a path with too few ancestors to hold a
/// suite folder at all.
pub fn suite_dir_of(tree: &Path) -> Option<PathBuf> {
    let parent = tree.parent()?;
    let grouped = parent
        .file_name()
        .is_some_and(|name| name == VERSIONS_DIR || name == DRAFTS_DIR);
    match grouped {
        true => parent.parent().map(Path::to_path_buf),
        false => Some(parent.to_path_buf()),
    }
}

/// The `suite.toml` a suite tree belongs to.
///
/// A tree that carries its own copy of `suite.toml` beside `version.toml` — a
/// stored suite-defined version, or the definition store a driver rebuilds one in —
/// belongs to that copy, because it has left the suite folder behind. Every other
/// tree belongs to the `suite.toml` of the suite folder [`suite_dir_of`] places it
/// in. `None` for a path with too few ancestors to hold a suite folder.
pub fn suite_manifest_path_of(tree: &Path) -> Option<PathBuf> {
    let carried = tree.join(SUITE_MANIFEST_FILE);
    if carried.is_file() {
        return Some(carried);
    }
    suite_dir_of(tree).map(|dir| dir.join(SUITE_MANIFEST_FILE))
}

/// Read the suite manifest a suite tree belongs to, as [`suite_manifest_path_of`]
/// locates it.
pub fn load_suite_manifest_of(tree: &Path) -> TestSuiteResult<SuiteManifest> {
    let path = suite_manifest_path_of(tree).ok_or_else(|| TestSuiteError::Io {
        path: tree.display().to_string(),
        source: std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "the suite tree sits in no suite folder",
        ),
    })?;
    load_suite_manifest(path.parent().unwrap_or(tree))
}
