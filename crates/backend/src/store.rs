//! The on-disk definition store (§4/§5 of `design/v0.2.0-contracts.md`).
//!
//! This is where the backend keeps the **copies** of every ingested test-case
//! version, plus the reference screenshots it renders at ingest. It is keyed by
//! `(slug, version)` and is **immutable once written**: a key is never
//! overwritten, which is what makes a resolved definition stable for the lifetime
//! of a run that referenced it.
//!
//! Definitions are **not** in SQLite (which holds only published runs); they live
//! here and are referenced by key. The store is content-addressed enough that a
//! re-ingest of an unchanged definition is a no-op (the key already exists).
//!
//! Layout:
//! ```text
//! <store>/test-cases/<slug>/<version>/          verbatim copy of the version folder
//! <store>/test-cases/<slug>/<version>/.tcab/manifest.json   resolved, store-relative manifest
//! <store>/test-cases/<slug>/<version>/.tcab/references/<scope>/<view>.png   rendered baselines
//! ```
//!
//! Container images are not stored here: they are distributed via a registry and
//! resolved by the runner directly from its configured registry, so the backend
//! plays no part in container distribution (see
//! `docs/components/core/execution.md`).
//!
//! The `.tcab/` sidecar holds backend-generated metadata for a test-case version;
//! it is kept inside the keyed directory (not seeded) so a definition and its
//! derived artifacts move and expire as a unit.

use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{BackendError, Result};

/// The sidecar directory holding backend-generated metadata inside a keyed
/// definition directory.
const SIDECAR: &str = ".tcab";

/// Owns the on-disk definition store rooted at a single directory.
#[derive(Debug, Clone)]
pub struct DefinitionStore {
    root: PathBuf,
}

/// The resolved, store-relative manifest persisted alongside a copied test-case
/// version. Paths in here are relative to the version's store directory (not host
/// paths), so it can be served to a runner that has no checkout.
///
/// This is the backend's own serialization, distinct from the wire shape the API
/// emits — the API layer maps this into the §1.2 response. Keeping a resolved
/// manifest on disk means a version resolves without re-parsing TOML on every
/// request and without touching the original checkout.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredManifest {
    /// The owning test-case slug.
    pub slug: String,
    /// The exact version string.
    pub version: String,
    /// Display name.
    pub name: String,
    /// Relative difficulty.
    pub difficulty: String,
    /// Classification tags.
    pub tags: Vec<String>,
    /// Optional short site-facing abstract.
    pub summary: Option<String>,
    /// The resolved `description.md` body, inlined (the site shows it; it is not
    /// seeded). `None` when the manifest declared no description.
    pub description: Option<String>,
    /// Per-case maximum harness runtime, in seconds.
    pub max_runtime_seconds: u64,
    /// Build commands.
    pub build: StoredBuild,
    /// The prompt template source, inlined (the runner renders it locally).
    pub prompt_template: String,
    /// Common specs (`source` is a store-relative artifact key, `dest` the
    /// workspace destination, `template` whether it is a `.hbs` the runner renders).
    pub common_specs: Vec<StoredSpec>,
    /// Asset files, directories already expanded to individual files.
    pub assets: Vec<StoredAsset>,
    /// Variants, each with additive specs and references.
    pub variants: Vec<StoredVariant>,
    /// Common references rendered for every variant.
    pub common_references: Vec<StoredReference>,
    /// Declared validation checks.
    pub checks: Vec<StoredCheck>,
    /// Reviewer checklist items declared for every variant. Reporter-side
    /// material (not seeded): served to the reporter so a reviewer is presented
    /// the items to work through. Defaulted for manifests stored before the field
    /// existed.
    #[serde(default)]
    pub common_review_items: Vec<StoredReviewItem>,
}

/// Build commands persisted in a [`StoredManifest`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredBuild {
    /// Dependency-install command.
    pub install: String,
    /// Static-build command.
    pub build: String,
}

/// A spec mapping persisted in a [`StoredManifest`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredSpec {
    /// Store-relative artifact key (fetched via the artifact endpoint).
    pub source: String,
    /// Workspace destination path.
    pub dest: String,
    /// Whether the source is a Handlebars template the runner renders.
    pub template: bool,
}

/// An asset mapping persisted in a [`StoredManifest`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredAsset {
    /// Store-relative artifact key.
    pub source: String,
    /// Workspace destination path.
    pub dest: String,
}

/// A variant persisted in a [`StoredManifest`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredVariant {
    /// Variant slug.
    pub slug: String,
    /// Display name.
    pub name: String,
    /// Optional site-facing prose.
    pub description: Option<String>,
    /// Additive specs.
    pub specs: Vec<StoredSpec>,
    /// Additive references.
    pub references: Vec<StoredReference>,
    /// Additive reviewer checklist items. Defaulted for manifests stored before
    /// the field existed.
    #[serde(default)]
    pub review_items: Vec<StoredReviewItem>,
}

/// A reference persisted in a [`StoredManifest`]. The rendered screenshot lives
/// under the version's `.tcab/references/<scope>/<view>.png`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredReference {
    /// The view slug.
    pub view: String,
}

/// A reviewer checklist item persisted in a [`StoredManifest`]. Reporter-side
/// material (not seeded); served to the reporter so a reviewer is presented the
/// items to work through.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredReviewItem {
    /// Stable slug identifying the item; recorded with the reviewer's verdict.
    pub id: String,
    /// A short heading shown above the item in the reviewer UI. Defaulted for
    /// manifests stored before the field existed.
    #[serde(default)]
    pub title: String,
    /// The prose a reviewer reads — what to check.
    pub text: String,
}

/// A check persisted in a [`StoredManifest`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredCheck {
    /// View slug the check records under.
    pub view: String,
    /// Display name.
    pub name: String,
    /// Reference view that is the comparison baseline.
    pub reference_view: String,
    /// Actions driving the implementation into the view before capture.
    pub actions: Vec<test_cabinet_core::test_case::CheckAction>,
}

impl DefinitionStore {
    /// Open (creating the root if necessary) a store at the given directory.
    pub fn open(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        std::fs::create_dir_all(&root)?;
        Ok(Self { root })
    }

    /// The store root directory.
    pub fn root(&self) -> &Path {
        &self.root
    }

    // --- Test-case versions -------------------------------------------------

    /// The directory a `(slug, version)` is stored under.
    pub fn version_dir(&self, slug: &str, version: &str) -> PathBuf {
        self.root.join("test-cases").join(slug).join(version)
    }

    /// Whether a `(slug, version)` is already ingested (its manifest exists).
    pub fn has_version(&self, slug: &str, version: &str) -> bool {
        self.manifest_path(slug, version).is_file()
    }

    /// List every ingested case slug and its versions, in insertion (mtime) order
    /// so the newest is listed last per the catalog contract.
    pub fn list_cases(&self) -> Result<Vec<(String, Vec<String>)>> {
        let cases_root = self.root.join("test-cases");
        let mut out = Vec::new();
        for slug in sorted_dir_names(&cases_root)? {
            let versions = self.list_versions(&slug)?;
            if !versions.is_empty() {
                out.push((slug, versions));
            }
        }
        Ok(out)
    }

    /// List the ingested versions for a slug, ordered oldest-first by directory
    /// modification time so the newest is listed last (matches the catalog
    /// contract's "newest-listed-last (insertion order)").
    pub fn list_versions(&self, slug: &str) -> Result<Vec<String>> {
        let slug_dir = self.root.join("test-cases").join(slug);
        if !slug_dir.is_dir() {
            return Ok(Vec::new());
        }
        let mut versioned: Vec<(std::time::SystemTime, String)> = Vec::new();
        for name in raw_dir_names(&slug_dir)? {
            let dir = slug_dir.join(&name);
            if !self.manifest_path(slug, &name).is_file() {
                continue;
            }
            let mtime = dir
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(std::time::UNIX_EPOCH);
            versioned.push((mtime, name));
        }
        versioned.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
        Ok(versioned.into_iter().map(|(_, name)| name).collect())
    }

    /// Path to a version's resolved manifest sidecar.
    pub fn manifest_path(&self, slug: &str, version: &str) -> PathBuf {
        self.version_dir(slug, version)
            .join(SIDECAR)
            .join("manifest.json")
    }

    /// Read a version's stored manifest.
    pub fn read_manifest(&self, slug: &str, version: &str) -> Result<StoredManifest> {
        let path = self.manifest_path(slug, version);
        let bytes = std::fs::read(&path).map_err(|_| {
            BackendError::NotFound(format!(
                "test-case version `{slug}@{version}` is not ingested"
            ))
        })?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    /// Persist a version's resolved manifest sidecar.
    pub fn write_manifest(&self, manifest: &StoredManifest) -> Result<()> {
        let path = self.manifest_path(&manifest.slug, &manifest.version);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, serde_json::to_vec_pretty(manifest)?)?;
        Ok(())
    }

    /// Resolve a store-relative artifact key inside a version directory, guarding
    /// against traversal, and read its bytes. The `.tcab` sidecar is off-limits.
    pub fn read_artifact(&self, slug: &str, version: &str, key: &str) -> Result<Vec<u8>> {
        let base = self.version_dir(slug, version);
        let path = safe_join(&base, key)?;
        if first_component_is_sidecar(key) {
            return Err(BackendError::NotFound(format!("unknown artifact `{key}`")));
        }
        std::fs::read(&path)
            .map_err(|_| BackendError::NotFound(format!("unknown artifact `{key}`")))
    }

    /// Path to a rendered reference screenshot for a version. `scope` is
    /// `_common` or a variant slug.
    pub fn reference_path(&self, slug: &str, version: &str, scope: &str, view: &str) -> PathBuf {
        self.version_dir(slug, version)
            .join(SIDECAR)
            .join("references")
            .join(scope)
            .join(format!("{view}.png"))
    }

    /// Read a rendered reference screenshot.
    pub fn read_reference(
        &self,
        slug: &str,
        version: &str,
        scope: &str,
        view: &str,
    ) -> Result<Vec<u8>> {
        // `scope` and `view` are validated to be single, traversal-free path
        // segments so a crafted request cannot read outside the references dir.
        if !is_safe_segment(scope) || !is_safe_segment(view) {
            return Err(BackendError::BadRequest(
                "invalid reference scope or view".to_string(),
            ));
        }
        let path = self.reference_path(slug, version, scope, view);
        std::fs::read(&path)
            .map_err(|_| BackendError::NotFound(format!("reference `{scope}/{view}` not rendered")))
    }

}

/// Read a directory's immediate subdirectory names, sorted lexically.
fn sorted_dir_names(dir: &Path) -> Result<Vec<String>> {
    let mut names = raw_dir_names(dir)?;
    names.sort();
    Ok(names)
}

/// Read a directory's immediate subdirectory names, ignoring files and hidden
/// entries. A missing directory yields an empty list (an empty store is valid).
fn raw_dir_names(dir: &Path) -> Result<Vec<String>> {
    let mut names = Vec::new();
    let read = match std::fs::read_dir(dir) {
        Ok(read) => read,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(names),
        Err(err) => return Err(err.into()),
    };
    for entry in read {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        if let Some(name) = entry.file_name().to_str()
            && !name.starts_with('.')
        {
            names.push(name.to_string());
        }
    }
    Ok(names)
}

/// Join a forward-slash relative key onto a base directory, rejecting any key
/// that is absolute or escapes the base via `..`. Returns the resolved path.
fn safe_join(base: &Path, key: &str) -> Result<PathBuf> {
    let rel = Path::new(key);
    let mut depth: i32 = 0;
    for component in rel.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => {
                return Err(BackendError::BadRequest(format!(
                    "path `{key}` is not relative"
                )));
            }
            Component::ParentDir => {
                depth -= 1;
                if depth < 0 {
                    return Err(BackendError::BadRequest(format!(
                        "path `{key}` escapes the definition store"
                    )));
                }
            }
            Component::CurDir => {}
            Component::Normal(_) => depth += 1,
        }
    }
    Ok(base.join(rel))
}

/// Whether a key's first path component is the reserved `.tcab` sidecar.
fn first_component_is_sidecar(key: &str) -> bool {
    Path::new(key)
        .components()
        .find_map(|c| match c {
            Component::Normal(name) => Some(name.to_string_lossy() == SIDECAR),
            _ => None,
        })
        .unwrap_or(false)
}

/// Whether a string is a single safe path segment (no separators, no `.`/`..`,
/// non-empty). Used to validate a reference scope/view before joining.
fn is_safe_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment != "."
        && segment != ".."
        && !segment.contains('/')
        && !segment.contains('\\')
}

#[cfg(test)]
#[path = "store.test.rs"]
mod tests;
