//! The stored [test suite](https://docs.testcabinet.ai/test-suites/overview/) key
//! space: `<store>/test-suites/<slug>/<version>/`, the sibling of the keyed
//! `test-cases/` tree.
//!
//! A suite reaches the store twice. Every definition it offers is lowered onto a
//! test-case version and written into `test-cases/` like an authored one, so the
//! run pipeline never learns that suites exist. The suite's *own* entities — the
//! manifest, the prose, the changelog, the specifications with their requirements,
//! the definitions, the demonstrations, the reference implementations, the assets
//! and the showcase — have no test case to ride on, so they are written here as
//! one resolved record beside the byte trees a reader of that record fetches from.
//!
//! The record is the response. [`StoredSuite`] is what ingest writes and what the
//! suite read endpoints serve, unmapped: a deployment whose checkout is absent
//! still serves exactly what it ingested, and there is no second shape for the two
//! to drift apart on.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use test_cabinet_core::test_case::version_key;
use test_cabinet_core::test_suite::{
    AssetManifest, DemoManifest, ShowcaseManifest, SpecificationManifest, SuiteManifest,
    SuiteTestCaseDefinition, VersionManifest,
};

use crate::error::{BackendError, Result};
use crate::store::{
    DefinitionStore, SIDECAR, first_component_is_sidecar, raw_dir_names, safe_join,
    sorted_dir_names,
};

/// The directory the stored suite versions live under, inside the store root. It
/// is named for the checkout tree it mirrors.
pub const SUITES_DIR: &str = "test-suites";

/// The file one stored suite version's resolved record is written to, inside that
/// version's sidecar.
const SUITE_RECORD_FILE: &str = "suite.json";

/// One ingested suite version, resolved: every entity the version folder declares,
/// with the prose it references inlined.
///
/// This is both the stored record and the body
/// `GET /test-suites/{slug}/{version}` serves. The bytes the record points at —
/// the showcase media and the asset files — are copied into the same stored
/// version and served by the byte routes, addressed by the paths carried here.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct StoredSuite {
    /// The suite's slug, which is its directory in the suites checkout and what
    /// `suite.toml` declares.
    pub slug: String,
    /// The version folder name, carrying its leading `v`.
    pub version: String,
    /// `suite.toml`: the identity of the suite this version belongs to, read from the
    /// suite folder at ingest, so a renamed suite presents its new name on every
    /// version the next ingest writes.
    pub suite: SuiteManifest,
    /// `version.toml`: the version's identity and the paths of the prose describing
    /// it.
    pub manifest: VersionManifest,
    /// The body of the manifest's `description.md`, inlined — the prose the
    /// manifest names by path, read once at ingest so a reader needs no second
    /// fetch.
    pub description: String,
    /// The body of the manifest's `changelog.md`, inlined for the same reason.
    pub changelog: String,
    /// Every specification the version declares, flattened out of the folder tree
    /// in walk order (a folder before the folders nested inside it).
    pub specifications: Vec<StoredSuiteSpecification>,
    /// The definitions the version offers, in file-stem order.
    pub test_cases: Vec<StoredSuiteDefinition>,
    /// The bundled assets, one per folder under `assets/`.
    pub assets: Vec<StoredSuiteAsset>,
    /// The demonstrations, one per folder under `demos/`.
    pub demos: Vec<StoredSuiteDemo>,
    /// The engines the version ships a reference implementation for, in folder
    /// order. The projects themselves stay in the checkout; the static builds of
    /// them are uploaded separately (see [`reference_builds`]).
    pub reference_implementations: Vec<String>,
    /// The showcase, when the version holds one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub showcase: Option<StoredSuiteShowcase>,
}

/// One specification of a stored suite version: its manifest, the folder that
/// declares it, and its prose inlined.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct StoredSuiteSpecification {
    /// The specification folder, relative to the version folder. Specification
    /// folders nest freely, so this is what records where a nested one sits.
    pub dir: String,
    /// `specification.toml`: the identity, the seeded path, and the requirements
    /// in declaration order, each carrying the validator modules it claims.
    pub manifest: SpecificationManifest,
    /// The body of the `specification.md` beside it, inlined.
    pub prose: String,
}

/// One test case definition of a stored suite version.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct StoredSuiteDefinition {
    /// The definition's slug, which is its file stem under `test-cases/`.
    pub slug: String,
    /// The catalog identity the definition is ingested under — what a reader
    /// follows to reach the test case this definition became.
    pub id: String,
    /// The definition itself.
    pub definition: SuiteTestCaseDefinition,
}

/// One bundled asset of a stored suite version.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct StoredSuiteAsset {
    /// The asset folder, relative to the version folder. Its last segment is the
    /// asset's id, and it is the prefix the asset byte route serves its files
    /// under.
    pub dir: String,
    /// `asset.toml`.
    pub manifest: AssetManifest,
}

/// One demonstration of a stored suite version.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct StoredSuiteDemo {
    /// The demonstration folder, relative to the version folder.
    pub dir: String,
    /// `demo.toml`.
    pub manifest: DemoManifest,
}

/// The showcase of a stored suite version: the carousel, and the prose above it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct StoredSuiteShowcase {
    /// `showcase/showcase.toml`: the carousel, in declared order.
    pub manifest: ShowcaseManifest,
    /// The body of `showcase/showcase.md`, inlined.
    pub description: String,
    /// The media files the showcase directory holds, by their name inside it —
    /// exactly the path the showcase byte route takes.
    pub media: Vec<String>,
}

impl StoredSuite {
    /// The listing entry for this version: what a suite listing shows without
    /// reading anything else.
    pub fn identity(&self) -> SuiteVersionIdentity {
        SuiteVersionIdentity {
            version: self.version.clone(),
            name: self.suite.name.clone(),
            summary: self.manifest.summary.clone(),
            tags: self.manifest.tags.clone(),
            experimental: self.manifest.experimental,
        }
    }
}

/// One version's identity as a listing presents it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct SuiteVersionIdentity {
    /// The version folder name, carrying its leading `v`.
    pub version: String,
    /// The suite's display name at this version.
    pub name: String,
    /// The one-line abstract a row shows.
    pub summary: String,
    /// Classification tags.
    pub tags: Vec<String>,
    /// Whether the version is still being iterated on. A deployment that has not
    /// opted in is never served one, so a client shows what it is served.
    pub experimental: bool,
}

impl DefinitionStore {
    // --- Suite versions -----------------------------------------------------

    /// The directory one stored suite version lives in.
    pub fn suite_version_dir(&self, slug: &str, version: &str) -> PathBuf {
        self.root().join(SUITES_DIR).join(slug).join(version)
    }

    /// Whether a suite version is already ingested (its record exists).
    pub fn has_suite_version(&self, slug: &str, version: &str) -> bool {
        suite_record_in(&self.suite_version_dir(slug, version)).is_file()
    }

    /// The [ingest stamp](crate::store::IngestStamp) of a stored suite version, if
    /// it has one.
    pub fn suite_stamp(&self, slug: &str, version: &str) -> Option<crate::store::IngestStamp> {
        crate::store::read_ingest_stamp_in(&self.suite_version_dir(slug, version))
    }

    /// Create a fresh, empty staging directory for building one suite version's
    /// tree before [`publish_staged_suite`](Self::publish_staged_suite) swaps it
    /// into place. Named uniquely per call so concurrent ingests never collide.
    pub fn new_suite_staging_dir(&self, slug: &str, version: &str) -> Result<PathBuf> {
        let dir = self
            .staging_root()
            .join(format!("suite-{slug}-{version}-{}", cuid2::create_id()));
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    }

    /// Atomically publish a fully-built `staged` tree as the suite version
    /// `(slug, version)`, replacing any existing copy.
    pub fn publish_staged_suite(&self, slug: &str, version: &str, staged: &Path) -> Result<()> {
        let dest = self.suite_version_dir(slug, version);
        self.swap_into_place(&dest, staged, &format!("retired-suite-{slug}-{version}"))
    }

    /// Drop an ingested suite version and the reference builds uploaded for it — the
    /// prune half of a whole-catalog ingest, which removes suite versions the
    /// checkout no longer declares. A version
    /// already absent is a no-op, and the suite's directory is removed once its
    /// last version is gone so an emptied shell is not still listed.
    pub fn remove_suite_version(&self, slug: &str, version: &str) -> Result<()> {
        let dir = self.suite_version_dir(slug, version);
        self.retire_dir(&dir, &format!("pruned-suite-{slug}-{version}"))?;
        // The builds uploaded for the version go with it.
        self.remove_suite_reference_builds(slug, version)?;
        // `remove_dir` only succeeds on an empty directory, so a suite that still
        // holds other versions is left untouched.
        let _ = std::fs::remove_dir(self.root().join(SUITES_DIR).join(slug));
        Ok(())
    }

    /// Every ingested suite slug with its versions, oldest first by semantic
    /// version so the newest is listed last — the order the test-case catalog
    /// reports versions in.
    pub fn list_suites(&self) -> Result<Vec<(String, Vec<String>)>> {
        let root = self.root().join(SUITES_DIR);
        let mut out = Vec::new();
        for slug in sorted_dir_names(&root)? {
            let versions = self.list_suite_versions(&slug)?;
            if !versions.is_empty() {
                out.push((slug, versions));
            }
        }
        Ok(out)
    }

    /// The ingested versions of one suite, oldest first. A directory holding no
    /// record is not an ingested version (a staging leftover, or a partly-removed
    /// tree), so it is skipped.
    pub fn list_suite_versions(&self, slug: &str) -> Result<Vec<String>> {
        let dir = self.root().join(SUITES_DIR).join(slug);
        if !dir.is_dir() {
            return Ok(Vec::new());
        }
        let mut versions: Vec<String> = raw_dir_names(&dir)?
            .into_iter()
            .filter(|version| suite_record_in(&dir.join(version)).is_file())
            .collect();
        versions.sort_by(|a, b| version_key(a).cmp(&version_key(b)).then_with(|| a.cmp(b)));
        Ok(versions)
    }

    /// Read one stored suite version's resolved record.
    ///
    /// A record that is present but does not parse was written in another record
    /// format, which is a store this build cannot serve rather than a missing
    /// suite — the same answer [`read_manifest`](Self::read_manifest) gives.
    pub fn read_suite(&self, slug: &str, version: &str) -> Result<StoredSuite> {
        let path = suite_record_in(&self.suite_version_dir(slug, version));
        let bytes = std::fs::read(&path).map_err(|_| {
            BackendError::NotFound(format!("test suite `{slug}@{version}` is not ingested"))
        })?;
        serde_json::from_slice(&bytes).map_err(|error| {
            BackendError::Internal(format!(
                "stored record for suite `{slug}@{version}` was written in another \
                 record format ({error}); re-ingest the catalog"
            ))
        })
    }

    /// Read the record of the suite version a stored test-case version was lowered
    /// from, or `None` for an authored version, which names none.
    ///
    /// A suite-defined version's prompt renders against the specifications this
    /// record declares (see [`crate::prompt::render_stored_prompt`]), so a reader
    /// rendering one reads it once per version.
    pub fn read_suite_of(
        &self,
        manifest: &crate::store::StoredManifest,
    ) -> Result<Option<StoredSuite>> {
        manifest
            .suite
            .as_ref()
            .map(|coordinate| self.read_suite(&coordinate.suite, &coordinate.suite_version))
            .transpose()
    }

    /// Read one file of a stored suite version by its version-relative key — a
    /// showcase media file or an asset file — guarding against a key that escapes
    /// the version. The sidecar holding the resolved record is off-limits, so the
    /// record is served by its endpoint rather than as bytes.
    pub fn read_suite_file(&self, slug: &str, version: &str, key: &str) -> Result<Vec<u8>> {
        let base = self.suite_version_dir(slug, version);
        let path = safe_join(&base, key)?;
        if first_component_is_sidecar(key) {
            return Err(BackendError::NotFound(format!(
                "unknown suite file `{key}`"
            )));
        }
        std::fs::read(&path)
            .map_err(|_| BackendError::NotFound(format!("unknown suite file `{key}`")))
    }

    /// Write a resolved suite record into an explicit suite version directory
    /// (canonical or staging), creating its sidecar.
    pub fn write_suite_in(&self, dir: &Path, suite: &StoredSuite) -> Result<()> {
        let path = suite_record_in(dir);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, serde_json::to_vec_pretty(suite)?)?;
        Ok(())
    }
}

/// The resolved record's path inside a suite version directory (its canonical
/// directory or a staging one).
fn suite_record_in(version_dir: &Path) -> PathBuf {
    version_dir.join(SIDECAR).join(SUITE_RECORD_FILE)
}

#[path = "suite_store.reference_builds.rs"]
pub mod reference_builds;

#[cfg(test)]
#[path = "suite_store.test.rs"]
pub(crate) mod tests;
