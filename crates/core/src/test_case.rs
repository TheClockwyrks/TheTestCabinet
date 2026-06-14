//! Test case catalog: slugs, versions, and resolution.
//!
//! See `docs/test-cases.md`. Test cases live under a top-level `test-cases/`
//! folder laid out as `test-cases/<slug>/<version>/`. Each version is
//! self-contained and immutable.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Result;

/// A test case: a single game a model is asked to build, identified by a stable
/// slug and offering one or more independently versioned revisions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestCase {
    /// The stable slug naming this test case (the `<slug>` directory).
    pub slug: String,
    /// The versions available for this test case.
    pub versions: Vec<String>,
}

/// A reference view a test case declares for visual comparison.
///
/// The reference visual itself is harness-side validation material and is
/// **never** seeded into a run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceView {
    /// The view name (for example, `main-menu`), matched against captured
    /// screenshots. See [`crate::validation::ReferenceComparison`].
    pub view: String,
    /// Path to the reference visual on the host, relative to the version folder.
    pub reference_path: PathBuf,
}

/// A resolved, exact test case version.
///
/// Holds the on-disk location and the manifest of what the version contains.
/// Only [`Self::spec_path`] and [`Self::asset_paths`] are seeded into a run;
/// [`Self::reference_views`] are deliberately withheld.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestCaseVersion {
    /// The owning test case slug.
    pub slug: String,
    /// The exact version string (the `<version>` directory).
    pub version: String,
    /// The version folder on the host: `test-cases/<slug>/<version>/`.
    pub root: PathBuf,
    /// Path to the self-contained specification (seeded).
    pub spec_path: PathBuf,
    /// Paths to assets the model should use (seeded).
    pub asset_paths: Vec<PathBuf>,
    /// Reference views available for validation (NOT seeded).
    pub reference_views: Vec<ReferenceView>,
}

/// Resolves test case slugs and versions against an on-disk catalog.
///
/// The catalog is the `test-cases/` directory laid out as
/// `test-cases/<slug>/<version>/`.
#[derive(Debug, Clone)]
pub struct TestCaseCatalog {
    /// Root of the catalog (the `test-cases/` directory).
    root: PathBuf,
}

impl TestCaseCatalog {
    /// Open a catalog rooted at the given `test-cases/` directory.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// The catalog root directory.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// List every test case slug in the catalog.
    pub fn list(&self) -> Result<Vec<TestCase>> {
        todo!("enumerate test-cases/<slug>/<version> directories")
    }

    /// List the versions available for a slug, newest first.
    pub fn versions(&self, _slug: &str) -> Result<Vec<String>> {
        todo!("enumerate version directories under test-cases/<slug>")
    }

    /// Resolve an exact `<slug>@<version>` into a [`TestCaseVersion`], reading
    /// its manifest and validating that it is self-contained.
    pub fn resolve(&self, _slug: &str, _version: &str) -> Result<TestCaseVersion> {
        todo!("resolve and validate test-cases/<slug>/<version>")
    }

    /// Resolve the latest version of a slug.
    pub fn resolve_latest(&self, _slug: &str) -> Result<TestCaseVersion> {
        todo!("pick the newest version, then resolve it")
    }
}
