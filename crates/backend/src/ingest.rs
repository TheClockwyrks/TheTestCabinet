//! Ingest: scanning the configured checkout and copying definitions into the
//! store (§0/§1.1 of `design/v0.2.0-contracts.md`).
//!
//! On `POST /ingest` the backend reads `test-cases/` and `containers/` from the
//! checkout it is pointed at and **copies** each version and container build
//! context into the immutable definition store, served verbatim afterward
//! (publishing caches, it does not transform). For a test-case version it also
//! renders the reference mockups to screenshots at this point, so every runner
//! shares the same baseline.
//!
//! Ingest is idempotent: an already-present, unchanged `(slug, version)` or
//! `(harness, contentHash)` is a no-op. `force` re-ingests and re-renders even
//! when unchanged.

use std::path::Path;

use test_cabinet_core::test_case::{TestCaseCatalog, TestCaseVersion};

use crate::error::{BackendError, Result};
use crate::hash::{HashedFile, aggregate_content_hash, sha256_hex};
use crate::render;
use crate::store::{
    DefinitionStore, StoredAsset, StoredBuild, StoredCheck, StoredContainer, StoredManifest,
    StoredReference, StoredSpec, StoredVariant,
};

/// Optional restrictions on an ingest scan (the `POST /ingest` request body).
#[derive(Debug, Clone, Default)]
pub struct IngestRequest {
    /// Restrict to these case slugs (a full scan when empty).
    pub test_cases: Option<Vec<String>>,
    /// Restrict to these harness slugs (a full scan when empty).
    pub containers: Option<Vec<String>>,
    /// Re-ingest and re-render even when unchanged.
    pub force: bool,
}

/// The outcome of ingesting one test-case version.
#[derive(Debug, Clone, PartialEq)]
pub struct IngestedVersion {
    /// Case slug.
    pub slug: String,
    /// Version string.
    pub version: String,
    /// Whether this call ingested (copied/rendered) it, vs. skipped as unchanged.
    pub ingested: bool,
    /// How many reference screenshots were rendered (0 when skipped).
    pub rendered_references: usize,
}

/// The outcome of ingesting one container definition.
#[derive(Debug, Clone, PartialEq)]
pub struct IngestedContainer {
    /// Harness slug.
    pub harness: String,
    /// Whether this call ingested it, vs. skipped as unchanged.
    pub ingested: bool,
    /// The aggregate content hash of the build context.
    pub content_hash: String,
}

/// The full result of an ingest scan.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct IngestReport {
    /// One entry per scanned test-case version.
    pub test_case_versions: Vec<IngestedVersion>,
    /// One entry per scanned container definition.
    pub container_definitions: Vec<IngestedContainer>,
}

/// Ingests definitions from a checkout into a definition store.
pub struct Ingestor<'a> {
    checkout: &'a Path,
    store: &'a DefinitionStore,
}

impl<'a> Ingestor<'a> {
    /// Create an ingestor over a checkout path and a target store.
    pub fn new(checkout: &'a Path, store: &'a DefinitionStore) -> Self {
        Self { checkout, store }
    }

    /// Run a scan, honoring the request's restrictions and `force` flag.
    pub fn scan(&self, request: &IngestRequest) -> Result<IngestReport> {
        let mut report = IngestReport::default();

        // Containers first, so a per-harness definition's `base` dependency is
        // ingested before it (mirrors the build order a runner follows).
        for harness in self.container_targets(request)? {
            report
                .container_definitions
                .push(self.ingest_container(&harness, request.force)?);
        }

        for (slug, version) in self.version_targets(request)? {
            report
                .test_case_versions
                .push(self.ingest_version(&slug, &version, request.force)?);
        }

        Ok(report)
    }

    /// Resolve the set of `(slug, version)` pairs to scan from the checkout.
    fn version_targets(&self, request: &IngestRequest) -> Result<Vec<(String, String)>> {
        let catalog = TestCaseCatalog::new(self.checkout.join("test-cases"));
        let slugs: Vec<String> = match &request.test_cases {
            Some(slugs) => slugs.clone(),
            None => catalog
                .list()
                .map_err(BackendError::Core)?
                .into_iter()
                .map(|case| case.slug)
                .collect(),
        };
        let mut targets = Vec::new();
        for slug in slugs {
            let versions = catalog.versions(&slug).map_err(BackendError::Core)?;
            for version in versions {
                targets.push((slug.clone(), version));
            }
        }
        Ok(targets)
    }

    /// Resolve the set of harness slugs to scan from the checkout's `containers/`.
    fn container_targets(&self, request: &IngestRequest) -> Result<Vec<String>> {
        if let Some(harnesses) = &request.containers {
            return Ok(harnesses.clone());
        }
        let containers_dir = self.checkout.join("containers");
        let mut harnesses = Vec::new();
        let read = match std::fs::read_dir(&containers_dir) {
            Ok(read) => read,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(harnesses),
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
                harnesses.push(name.to_string());
            }
        }
        harnesses.sort();
        Ok(harnesses)
    }

    // --- Test-case versions -------------------------------------------------

    /// Ingest one test-case version: resolve it (which validates structure), copy
    /// the version folder verbatim, render its references, and write the resolved
    /// store-relative manifest. Idempotent unless `force`.
    fn ingest_version(&self, slug: &str, version: &str, force: bool) -> Result<IngestedVersion> {
        if !force && self.store.has_version(slug, version) {
            return Ok(IngestedVersion {
                slug: slug.to_string(),
                version: version.to_string(),
                ingested: false,
                rendered_references: 0,
            });
        }

        let catalog = TestCaseCatalog::new(self.checkout.join("test-cases"));
        let resolved = catalog.resolve(slug, version).map_err(BackendError::Core)?;

        let dest = self.store.version_dir(slug, version);
        // Re-ingest is destructive only on the keyed dir for this version. A fresh
        // copy guarantees the store reflects exactly the current checkout (a
        // removed file in the checkout must not linger in the store).
        if dest.exists() {
            std::fs::remove_dir_all(&dest)?;
        }
        std::fs::create_dir_all(&dest)?;
        copy_tree(&resolved.root, &dest)?;

        let rendered = self.render_references(&resolved)?;
        let manifest = build_stored_manifest(&resolved)?;
        self.store.write_manifest(&manifest)?;

        Ok(IngestedVersion {
            slug: slug.to_string(),
            version: version.to_string(),
            ingested: true,
            rendered_references: rendered,
        })
    }

    /// Render every reference view (common + per-variant) of a resolved version
    /// into the store's reference sidecar. A render failure aborts the version's
    /// ingest, since serving a version with a missing baseline would let a runner
    /// validate against a hole. Returns the number of screenshots rendered.
    fn render_references(&self, resolved: &TestCaseVersion) -> Result<usize> {
        let slug = &resolved.slug;
        let version = &resolved.version;
        let mut count = 0;

        // Common references render once under the `_common` scope.
        for reference in &resolved.common_references {
            let out = self
                .store
                .reference_path(slug, version, "_common", &reference.view);
            self.render_one(&reference.source_path, &out, &reference.view)?;
            count += 1;
        }
        // Variant-specific references render under each variant's slug scope, so a
        // view shared across variants (e.g. a per-variant `title`) does not clobber.
        for variant in &resolved.variants {
            for reference in &variant.references {
                let out = self
                    .store
                    .reference_path(slug, version, &variant.slug, &reference.view);
                self.render_one(&reference.source_path, &out, &reference.view)?;
                count += 1;
            }
        }
        Ok(count)
    }

    /// Render one reference, mapping a browser failure to a backend error naming
    /// the view that failed.
    fn render_one(&self, source: &Path, out: &Path, view: &str) -> Result<()> {
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent)?;
        }
        render::render_reference(source, out).map_err(|detail| {
            BackendError::Snapshot(format!("could not render reference `{view}`: {detail}"))
        })
    }

    // --- Container definitions ----------------------------------------------

    /// Ingest one container definition: hash its build context, and if that hash
    /// is not already stored, copy the build context verbatim and write its
    /// metadata. Idempotent: an unchanged definition (same content hash) is a
    /// no-op unless `force`.
    fn ingest_container(&self, harness: &str, force: bool) -> Result<IngestedContainer> {
        let context_dir = self.checkout.join("containers").join(harness);
        if !context_dir.is_dir() {
            return Err(BackendError::NotFound(format!(
                "container `{harness}` is not present in the checkout"
            )));
        }

        let files = hash_build_context(&context_dir)?;
        let content_hash = aggregate_content_hash(&files);
        let builds_from = parse_builds_from(&context_dir)?;

        let already = self.store.has_container(harness, &content_hash);
        if already && !force {
            return Ok(IngestedContainer {
                harness: harness.to_string(),
                ingested: false,
                content_hash,
            });
        }

        let dest = self.store.container_dir(harness, &content_hash);
        if dest.exists() {
            std::fs::remove_dir_all(&dest)?;
        }
        std::fs::create_dir_all(&dest)?;
        copy_tree(&context_dir, &dest)?;

        self.store.write_container_meta(&StoredContainer {
            harness: harness.to_string(),
            content_hash: content_hash.clone(),
            builds_from,
            files,
        })?;

        Ok(IngestedContainer {
            harness: harness.to_string(),
            ingested: true,
            content_hash,
        })
    }
}

/// Build the store-relative resolved manifest from a resolved version. Paths are
/// rewritten from host-absolute to version-root-relative keys, the prompt and
/// description are inlined, and `.hbs` specs are flagged as templates.
fn build_stored_manifest(resolved: &TestCaseVersion) -> Result<StoredManifest> {
    let root = &resolved.root;

    let prompt_template = std::fs::read_to_string(&resolved.prompt_path)?;
    let description = match &resolved.description_path {
        Some(path) => Some(std::fs::read_to_string(path)?),
        None => None,
    };

    let common_specs = resolved
        .common_specs
        .iter()
        .map(|spec| stored_spec(root, &spec.source_path, &spec.dest))
        .collect::<Result<Vec<_>>>()?;

    // Asset *paths* in a resolved version may be files or directories; the
    // contract expands directories to individual files. Each becomes an artifact
    // keyed by its store-relative path, with `dest` mirroring the source layout.
    let mut assets = Vec::new();
    for asset_path in &resolved.asset_paths {
        expand_asset(root, asset_path, &mut assets)?;
    }

    let variants = resolved
        .variants
        .iter()
        .map(|variant| -> Result<StoredVariant> {
            let specs = variant
                .specs
                .iter()
                .map(|spec| stored_spec(root, &spec.source_path, &spec.dest))
                .collect::<Result<Vec<_>>>()?;
            Ok(StoredVariant {
                slug: variant.slug.clone(),
                name: variant.name.clone(),
                description: variant.description.clone(),
                specs,
                references: variant
                    .references
                    .iter()
                    .map(|r| StoredReference {
                        view: r.view.clone(),
                    })
                    .collect(),
            })
        })
        .collect::<Result<Vec<_>>>()?;

    Ok(StoredManifest {
        slug: resolved.slug.clone(),
        version: resolved.version.clone(),
        name: resolved.name.clone(),
        difficulty: resolved.difficulty.clone(),
        tags: resolved.tags.clone(),
        summary: resolved.summary.clone(),
        description,
        max_runtime_seconds: resolved.max_runtime_seconds,
        build: StoredBuild {
            install: resolved.build.install.clone(),
            build: resolved.build.build.clone(),
        },
        prompt_template,
        common_specs,
        assets,
        variants,
        common_references: resolved
            .common_references
            .iter()
            .map(|r| StoredReference {
                view: r.view.clone(),
            })
            .collect(),
        checks: resolved
            .checks
            .iter()
            .map(|c| StoredCheck {
                view: c.view.clone(),
                name: c.name.clone(),
                reference_view: c.reference_view.clone(),
                actions: c.actions.clone(),
            })
            .collect(),
    })
}

/// Build a `StoredSpec` from a host source path and a workspace dest, deriving
/// the store-relative `source` key and the `template` flag (a `.hbs` source).
fn stored_spec(root: &Path, source_path: &Path, dest: &Path) -> Result<StoredSpec> {
    let source = relative_key(root, source_path)?;
    let template = source_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("hbs"))
        .unwrap_or(false);
    Ok(StoredSpec {
        source,
        dest: to_forward_slash(dest),
        template,
    })
}

/// Expand an asset path (file or directory) into one `StoredAsset` per file. A
/// directory is walked recursively; the `dest` mirrors each file's path relative
/// to the version root, matching how the runner seeds assets.
fn expand_asset(root: &Path, asset_path: &Path, out: &mut Vec<StoredAsset>) -> Result<()> {
    if asset_path.is_dir() {
        for entry in std::fs::read_dir(asset_path)? {
            expand_asset(root, &entry?.path(), out)?;
        }
    } else {
        let key = relative_key(root, asset_path)?;
        out.push(StoredAsset {
            dest: key.clone(),
            source: key,
        });
    }
    Ok(())
}

/// The forward-slash path of `path` relative to `root`, used as a store key.
fn relative_key(root: &Path, path: &Path) -> Result<String> {
    let rel = path.strip_prefix(root).map_err(|_| {
        BackendError::BadRequest(format!(
            "path `{}` is not inside the version folder",
            path.display()
        ))
    })?;
    Ok(to_forward_slash(rel))
}

/// Render a path with forward-slash separators (the store key convention).
fn to_forward_slash(path: &Path) -> String {
    path.components()
        .filter_map(|c| match c {
            std::path::Component::Normal(name) => Some(name.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// Hash every file of a build context (recursively), returning the per-file
/// `(path, sha256)` pairs the aggregate hash is computed from.
fn hash_build_context(dir: &Path) -> Result<Vec<HashedFile>> {
    let mut files = Vec::new();
    collect_hashed(dir, dir, &mut files)?;
    Ok(files)
}

/// Recursively collect hashed files under `dir`, keying each by its path relative
/// to `base` (forward-slash). Hidden entries are skipped so an editor's dotfiles
/// never enter the hash and change the image tag.
fn collect_hashed(base: &Path, dir: &Path, out: &mut Vec<HashedFile>) -> Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            collect_hashed(base, &path, out)?;
        } else {
            let bytes = std::fs::read(&path)?;
            out.push(HashedFile {
                path: relative_key(base, &path)?,
                sha256: sha256_hex(&bytes),
                size: bytes.len() as u64,
            });
        }
    }
    Ok(())
}

/// Parse the in-cabinet `FROM` base of a container's Dockerfile, if any.
///
/// A per-harness Dockerfile builds `FROM` a `test-cabinet/<harness>:...` image
/// (possibly via an `ARG BASE_IMAGE=test-cabinet/base:...` default). This returns
/// the harness slug it depends on within the cabinet (`base` in practice), or
/// `None` when it `FROM`s an external image — letting a runner build that base
/// first. The parse is deliberately tolerant: it scans `FROM`/`ARG` lines for a
/// `test-cabinet/<slug>` reference.
fn parse_builds_from(context_dir: &Path) -> Result<Option<String>> {
    let dockerfile = context_dir.join("Dockerfile");
    let contents = match std::fs::read_to_string(&dockerfile) {
        Ok(contents) => contents,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err.into()),
    };
    Ok(find_cabinet_base(&contents))
}

/// Scan Dockerfile text for the first `test-cabinet/<slug>` reference on a `FROM`
/// or `ARG ...=` line, returning the `<slug>`.
fn find_cabinet_base(contents: &str) -> Option<String> {
    const MARKER: &str = "test-cabinet/";
    for line in contents.lines() {
        let trimmed = line.trim();
        let upper = trimmed.to_ascii_uppercase();
        if !(upper.starts_with("FROM ") || upper.starts_with("ARG ")) {
            continue;
        }
        if let Some(idx) = trimmed.find(MARKER) {
            let after = &trimmed[idx + MARKER.len()..];
            let slug: String = after
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
                .collect();
            if !slug.is_empty() {
                return Some(slug);
            }
        }
    }
    None
}

/// Recursively copy a directory tree, skipping hidden entries (so the checkout's
/// dotfiles and the store's own `.tcab` sidecar never enter a copied definition).
fn copy_tree(src: &Path, dst: &Path) -> Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let from = entry.path();
        let to = dst.join(&name);
        if entry.file_type()?.is_dir() {
            copy_tree(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "ingest.test.rs"]
mod tests;
