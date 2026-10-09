//! The suite catalog: the `test-suites/` checkout, read the way core's
//! `TestCaseCatalog` (`test_cabinet_core::test_case`) reads `test-cases/`.
//!
//! A checkout holds one folder per suite. A folder is a suite exactly when it holds
//! a `suite.toml`, and a suite holds its exported versions at
//! `versions/v<major>.<minor>.<patch>/` and its drafts at `drafts/<draft>/`. The
//! catalog lists exported versions and nothing under `drafts/`, because The Test
//! Cabinet runs only what has been exported. It reads a version's identity without
//! resolving the whole tree, and lowers an offered
//! [test case definition](https://docs.testcabinet.ai/test-suites/test-case-definition/)
//! onto the [`TestCaseVersion`] the run pipeline executes — so a suite runs through
//! the dispatcher, the driver, the definition store and the run record with no
//! suite branch anywhere in them.
//!
//! # Paths
//!
//! This module is the one place a suite tree path is composed. Ingest, lowering,
//! prompt rendering and the validator runner reach a tree through
//! [`TestSuiteCatalog::version_tree`], or find the suite a tree they were handed
//! belongs to through [`load_suite_manifest_of`](super::load_suite_manifest_of).
//!
//! # Identity
//!
//! A definition's catalog identity is `<suite slug>-<definition file stem>` at the
//! suite's version, so `carom/versions/v1.0.0/test-cases/end-to-end.toml` resolves
//! as `carom-end-to-end` at `v1.0.0`. That identity shares one space with the
//! authored catalog's slugs, so a collision between the two is a real ambiguity;
//! [`TestSuiteCatalog::resolve_beside`] refuses one it is asked about, and
//! catalog-wide collision detection runs where both catalogs are held at once.
//!
//! # Previews
//!
//! The Spec Cabinet writes a draft's preview into the checkout's `.previews/`
//! folder: a suite tree at `.previews/<slug>/v0.0.0-preview.<draft>/` beside a copy
//! of the suite manifest at `.previews/<slug>/suite.toml`. A catalog reads them only
//! when it is handed that folder through [`TestSuiteCatalog::with_previews`], and
//! then enumerates them the way it enumerates `versions/`: a preview is listed under
//! its suite's slug with its prerelease version string, and its identity is read
//! against the suite manifest copy beside it. A catalog without a previews root
//! never reads the folder.
//!
//! A preview version is recognized by its name, so the version string alone decides
//! which folder a version lives in. An exported version never carries the preview
//! prerelease, and a folder under `versions/` that does is not listed.
//!
//! # Resolved materials
//!
//! A seeded specification is rendered rather than copied, and the suite checkout is
//! a submodule The Spec Cabinet owns, so nothing is written into it. Rendered
//! documents land in the catalog's *materials* directory instead, and the resolved
//! [`SpecFile`](crate::test_case::SpecFile)s name them as their source. A caller
//! that wants them somewhere of its own — an ingest copying them into a store, a
//! test — names the directory with [`TestSuiteCatalog::with_materials`].

use std::path::{Path, PathBuf};

use crate::error::{Error, Result};
use crate::fs::read_dir_names;
use crate::test_case::{TestCaseVersion, version_key};

use super::lowering::{SuiteContext, catalog_identity, lower};
use super::{
    SUITE_MANIFEST_FILE, SuiteVersion, TEST_CASES_DIR, VERSION_MANIFEST_FILE, load_suite_manifest,
};
use super::{SuiteManifest, VersionManifest};
use super::{VERSIONS_DIR, is_preview_version};

/// The name of the directory rendered specifications are written into when a
/// caller names none.
const MATERIALS_DIR: &str = "tcab-suite-materials";

/// One suite in the catalog: its slug, and the exported versions it holds newest
/// first.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TestSuite {
    /// The suite's slug, which is both its folder name and what `suite.toml`
    /// declares.
    pub slug: String,
    /// The exported version folder names, carrying their leading `v`, newest
    /// first.
    pub versions: Vec<String>,
}

/// One exported version's identity: the suite manifest it belongs to and its own
/// version manifest, both checked against the folders holding them.
#[derive(Debug, Clone, PartialEq)]
pub struct VersionIdentity {
    /// `<slug>/suite.toml`.
    pub suite: SuiteManifest,
    /// `<slug>/versions/v<version>/version.toml`.
    pub manifest: VersionManifest,
}

/// Resolves suites, versions and offered definitions against an on-disk checkout.
///
/// The catalog is the `test-suites/` directory laid out as
/// `<slug>/suite.toml` beside `<slug>/versions/v<major>.<minor>.<patch>/`. Unlike
/// the authored catalog's `<type>/<difficulty>/<slug>/` grouping, nothing here is
/// organizational: the suite folder is the suite's slug and the version folder is
/// its version, and resolution checks that both agree with what the manifests
/// declare.
#[derive(Debug, Clone)]
pub struct TestSuiteCatalog {
    /// Root of the catalog (the `test-suites/` checkout).
    root: PathBuf,
    /// Where rendered specification documents are written.
    materials: PathBuf,
    /// The `.previews/` folder previews are read from, or `None` when this catalog
    /// reads no previews at all.
    previews: Option<PathBuf>,
}

impl TestSuiteCatalog {
    /// Open a catalog rooted at the given `test-suites/` checkout, rendering
    /// specification documents into a directory of the host's temporary space.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            materials: std::env::temp_dir().join(MATERIALS_DIR),
            previews: None,
        }
    }

    /// Open a catalog writing its rendered specification documents under
    /// `materials` rather than into temporary space.
    pub fn with_materials(root: impl Into<PathBuf>, materials: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            materials: materials.into(),
            previews: None,
        }
    }

    /// Also read the previews held in `previews` — conventionally the checkout's
    /// [`PREVIEWS_DIR`](super::PREVIEWS_DIR) — listing each beside its suite's exported versions.
    pub fn with_previews(mut self, previews: impl Into<PathBuf>) -> Self {
        self.previews = Some(previews.into());
        self
    }

    /// The folder previews are read from, when this catalog reads them.
    pub fn previews_root(&self) -> Option<&Path> {
        self.previews.as_deref()
    }

    /// The catalog root directory.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The directory rendered specification documents are written into.
    pub fn materials_root(&self) -> &Path {
        &self.materials
    }

    /// The folder of one suite, whether or not it is there.
    pub fn suite_dir(&self, slug: &str) -> PathBuf {
        self.root.join(slug)
    }

    /// The suite tree of one version, whether or not it is there.
    ///
    /// `version` is the folder name, carrying its leading `v`. A preview version
    /// lives at `<previews>/<slug>/<version>/` when this catalog reads previews, and
    /// every other version at `<slug>/versions/<version>/`.
    pub fn version_tree(&self, slug: &str, version: &str) -> PathBuf {
        match self.preview_suite_dir(slug, version) {
            Some(dir) => dir.join(version),
            None => self.suite_dir(slug).join(VERSIONS_DIR).join(version),
        }
    }

    /// The `suite.toml` one version is read against, whether or not it is there: the
    /// copy beside a preview, or the suite folder's own for an exported version.
    pub fn suite_manifest_path(&self, slug: &str, version: &str) -> PathBuf {
        self.version_suite_dir(slug, version)
            .join(SUITE_MANIFEST_FILE)
    }

    /// The folder holding the `suite.toml` one version belongs to.
    fn version_suite_dir(&self, slug: &str, version: &str) -> PathBuf {
        self.preview_suite_dir(slug, version)
            .unwrap_or_else(|| self.suite_dir(slug))
    }

    /// `<previews>/<slug>/`, when `version` names a preview and this catalog reads
    /// previews.
    fn preview_suite_dir(&self, slug: &str, version: &str) -> Option<PathBuf> {
        let previews = self.previews.as_ref()?;
        is_preview_version(version).then(|| previews.join(slug))
    }

    /// Every suite in the checkout, each with its exported versions newest first,
    /// followed by its previews when this catalog reads them.
    ///
    /// A folder holding no `suite.toml` is not a suite and is not listed, whatever
    /// else it holds. A suite with no exported version yet is listed with none, and
    /// a suite only a preview holds is listed with that preview. An absent checkout
    /// — the submodule was never initialized — lists nothing rather than failing, so
    /// a deployment without one behaves as one with no suites.
    pub fn list(&self) -> Result<Vec<TestSuite>> {
        let mut slugs = std::collections::BTreeSet::new();
        if self.root.is_dir() {
            slugs.extend(
                read_dir_names(&self.root)?
                    .into_iter()
                    .filter(|slug| self.is_suite(slug)),
            );
        }
        if let Some(previews) = self.previews.as_ref().filter(|dir| dir.is_dir()) {
            slugs.extend(
                read_dir_names(previews)?
                    .into_iter()
                    .filter(|slug| self.is_previewed_suite(slug)),
            );
        }
        Ok(slugs
            .into_iter()
            .map(|slug| TestSuite {
                versions: self.version_names(&slug),
                slug,
            })
            .collect())
    }

    /// The versions a suite holds: its exported versions newest first, then its
    /// previews when this catalog reads them.
    pub fn versions(&self, slug: &str) -> Result<Vec<String>> {
        if !self.is_suite(slug) && !self.is_previewed_suite(slug) {
            return Err(self.invalid(slug, "", SUITE_MANIFEST_FILE, "suite not found"));
        }
        Ok(self.version_names(slug))
    }

    /// Whether the checkout holds this version: a folder holding a `suite.toml`, and
    /// a version folder beside or inside it holding a `version.toml`. A preview is
    /// held only when this catalog reads previews.
    ///
    /// Only presence is checked. Whether the manifests parse and agree with the
    /// folders is [`identity`](Self::identity)'s question.
    pub fn has_version(&self, slug: &str, version: &str) -> bool {
        // A preview name only ever lives in the previews folder, so a catalog reading
        // none holds no such version and looks nowhere for one.
        if is_preview_version(version) && self.previews.is_none() {
            return false;
        }
        self.suite_manifest_path(slug, version).is_file()
            && self
                .version_tree(slug, version)
                .join(VERSION_MANIFEST_FILE)
                .is_file()
    }

    /// Whether `slug` names a suite: a folder holding a `suite.toml`.
    fn is_suite(&self, slug: &str) -> bool {
        self.suite_dir(slug).join(SUITE_MANIFEST_FILE).is_file()
    }

    /// Whether `slug` names a previewed suite: a folder of the previews root holding
    /// the copy of a `suite.toml`. Always `false` for a catalog reading no previews.
    fn is_previewed_suite(&self, slug: &str) -> bool {
        self.previews
            .as_ref()
            .is_some_and(|previews| previews.join(slug).join(SUITE_MANIFEST_FILE).is_file())
    }

    /// The version folder names of one suite: its exported versions newest first,
    /// then its previews by name.
    ///
    /// A folder counts only when it holds a `version.toml`: a version's build
    /// artifacts can linger after the manifest itself has moved, and a directory
    /// holding only those is not a version at all. Nothing under `drafts/` is read,
    /// a folder under `versions/` carrying the preview prerelease is not an exported
    /// version, and a folder of the previews root is a preview only when its name is
    /// one.
    fn version_names(&self, slug: &str) -> Vec<String> {
        let exported = self.suite_dir(slug).join(VERSIONS_DIR);
        let mut versions = versions_in(&exported, |version| !is_preview_version(version));
        // Newest first, compared component-wise so `v1.10.0` sorts after `v1.9.0`.
        versions.sort_by_key(|version| std::cmp::Reverse(version_key(version)));
        if self.is_previewed_suite(slug)
            && let Some(previews) = &self.previews
        {
            let mut previewed = versions_in(&previews.join(slug), is_preview_version);
            previewed.sort();
            versions.extend(previewed);
        }
        versions
    }

    /// Read one suite's `suite.toml`, checked against the folder holding it.
    pub fn suite(&self, slug: &str) -> Result<SuiteManifest> {
        self.suite_in(slug, &self.suite_dir(slug))
    }

    /// Read the `suite.toml` held in `dir`, checked against the slug it is read
    /// for.
    fn suite_in(&self, slug: &str, dir: &Path) -> Result<SuiteManifest> {
        let suite = load_suite_manifest(dir).map_err(|err| {
            self.invalid(
                slug,
                "",
                SUITE_MANIFEST_FILE,
                format!("the suite manifest does not read: {err}"),
            )
        })?;
        if suite.slug != slug {
            return Err(self.invalid(
                slug,
                "",
                SUITE_MANIFEST_FILE,
                format!(
                    "slug `{}` disagrees with the suite folder `{slug}`",
                    suite.slug
                ),
            ));
        }
        Ok(suite)
    }

    /// Read one version's identity: its suite's `suite.toml` and its own
    /// `version.toml`, parsed and checked against the folders holding them.
    ///
    /// An exported version is a frozen unit, so the suite folder must be the slug
    /// `suite.toml` declares and the version folder must be `v` followed by the
    /// `version` its `version.toml` declares. A preview is read against the suite
    /// manifest copy beside it under the same checks, and must declare itself
    /// `experimental`, since a preview surfaces only where experimental versions are
    /// allowed. This is the lightweight read a listing does; it parses no other file.
    pub fn identity(&self, slug: &str, version: &str) -> Result<VersionIdentity> {
        let suite = self
            .suite_in(slug, &self.version_suite_dir(slug, version))
            .map_err(|err| self.relocate(err, version))?;
        let tree = self.version_tree(slug, version);
        let manifest = super::load_version_manifest(&tree).map_err(|err| {
            self.invalid(
                slug,
                version,
                VERSION_MANIFEST_FILE,
                format!("the version manifest does not read: {err}"),
            )
        })?;
        match manifest.version.as_deref() {
            None => {
                return Err(self.invalid(
                    slug,
                    version,
                    VERSION_MANIFEST_FILE,
                    "an exported version declares its `version`, and this one declares none",
                ));
            }
            Some(declared) if version != format!("v{declared}") => {
                return Err(self.invalid(
                    slug,
                    version,
                    VERSION_MANIFEST_FILE,
                    format!("version `{declared}` disagrees with the version folder `{version}`"),
                ));
            }
            Some(_) => {}
        }
        if is_preview_version(version) && !manifest.experimental {
            return Err(self.invalid(
                slug,
                version,
                VERSION_MANIFEST_FILE,
                "a preview declares `experimental = true`, and this one does not",
            ));
        }
        Ok(VersionIdentity { suite, manifest })
    }

    /// The definitions one exported version offers, in file-stem order.
    pub fn definitions(&self, slug: &str, version: &str) -> Result<Vec<String>> {
        self.identity(slug, version)?;
        let dir = self.version_tree(slug, version).join(TEST_CASES_DIR);
        let Ok(entries) = std::fs::read_dir(&dir) else {
            return Ok(Vec::new());
        };
        let mut slugs: Vec<String> = entries
            .flatten()
            .filter(|entry| entry.path().is_file())
            .filter_map(|entry| {
                entry
                    .file_name()
                    .into_string()
                    .ok()?
                    .strip_suffix(".toml")
                    .map(str::to_string)
            })
            .collect();
        slugs.sort();
        Ok(slugs)
    }

    /// The catalog identity one offered definition resolves under.
    ///
    /// The name a run, a store key and a command line use. It is derived rather
    /// than read, so a caller can ask before resolving anything.
    pub fn identity_of(&self, slug: &str, definition: &str) -> String {
        catalog_identity(slug, definition)
    }

    /// Whether a resolved identity collides with a slug the authored catalog
    /// already claims.
    ///
    /// The two catalogs share one identity space, so a collision is a genuine
    /// ambiguity rather than a preference. This answers the question for one
    /// identity; the catalog-wide sweep runs where both catalogs are held at once.
    pub fn collides_with_authored(identity: &str, authored: &impl AuthoredLookup) -> bool {
        authored.has_authored(identity)
    }

    /// Load one exported version whole, after its identity checks out.
    pub fn load(&self, slug: &str, version: &str) -> Result<SuiteVersion> {
        let identity = self.identity(slug, version)?;
        SuiteVersion::load(&identity.suite, &self.version_tree(slug, version))
            .map_err(|err| self.invalid(slug, version, VERSION_MANIFEST_FILE, err.to_string()))
    }

    /// Resolve one offered definition into the [`TestCaseVersion`] a run executes.
    pub fn resolve(&self, slug: &str, version: &str, definition: &str) -> Result<TestCaseVersion> {
        let loaded = self.load(slug, version)?;
        let root = self.version_tree(slug, version);
        let file = format!("{TEST_CASES_DIR}/{definition}.toml");
        let offered = loaded
            .test_cases
            .iter()
            .find(|case| case.slug == definition)
            .ok_or_else(|| {
                self.invalid(slug, version, &file, "the suite offers no such definition")
            })?;
        let materials = self.materials.join(&loaded.suite.slug).join(version);
        let context = SuiteContext::new(&root, version, &loaded, &materials);
        lower(&context, &offered.slug, &offered.definition)
    }

    /// Resolve one offered definition, refusing an identity the authored catalog
    /// already claims.
    ///
    /// The collision is checked before the folder is read, so an ambiguous identity
    /// is reported as the ambiguity it is rather than as whatever the resolve would
    /// have found.
    pub fn resolve_beside(
        &self,
        slug: &str,
        version: &str,
        definition: &str,
        authored: &impl AuthoredLookup,
    ) -> Result<TestCaseVersion> {
        let identity = catalog_identity(slug, definition);
        if Self::collides_with_authored(&identity, authored) {
            return Err(self.invalid(
                slug,
                version,
                &format!("{TEST_CASES_DIR}/{definition}.toml"),
                format!("identity `{identity}` is already claimed by an authored test case"),
            ));
        }
        self.resolve(slug, version, definition)
    }

    /// Report a failure against one file of one suite version.
    fn invalid(&self, slug: &str, version: &str, file: &str, detail: impl Into<String>) -> Error {
        Error::InvalidTestSuite {
            suite: slug.to_string(),
            version: version.to_string(),
            file: file.to_string(),
            detail: detail.into(),
        }
    }

    /// Address a suite-level failure to the version whose read ran into it.
    fn relocate(&self, err: Error, version: &str) -> Error {
        match err {
            Error::InvalidTestSuite {
                suite,
                file,
                detail,
                ..
            } => Error::InvalidTestSuite {
                suite,
                version: version.to_string(),
                file,
                detail,
            },
            other => other,
        }
    }
}

/// The authored catalog a suite definition's identity is checked against.
///
/// A definition's catalog identity shares one space with the authored catalog's
/// slugs, and the authored catalog (core's `TestCaseCatalog`, which implements this)
/// is runtime this crate does not hold. It is asked one thing: whether an identity is
/// already an authored test case's slug.
pub trait AuthoredLookup {
    /// Whether `identity` names a test case the authored catalog holds.
    fn has_authored(&self, identity: &str) -> bool;
}

/// The folder names in `dir` that hold a `version.toml` and satisfy `keep`. An
/// absent or unreadable `dir` holds none.
fn versions_in(dir: &Path, keep: impl Fn(&str) -> bool) -> Vec<String> {
    let Ok(names) = read_dir_names(dir) else {
        return Vec::new();
    };
    names
        .into_iter()
        .filter(|version| keep(version))
        .filter(|version| dir.join(version).join(VERSION_MANIFEST_FILE).is_file())
        .collect()
}

#[cfg(test)]
#[path = "catalog.test.rs"]
mod tests;

#[cfg(test)]
#[path = "catalog.previews.test.rs"]
mod preview_tests;
