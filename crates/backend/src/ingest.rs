//! Ingest: scanning the configured checkout and copying definitions into the
//! store (§0/§1.1 of `design/v0.2.0-contracts.md`).
//!
//! On `POST /ingest` the backend reads `test-cases/` from the checkout it is
//! pointed at and **copies** each version into the immutable definition store,
//! served verbatim afterward (publishing caches, it does not transform). It also
//! renders the reference mockups to screenshots at this point, so every runner
//! shares the same baseline.
//!
//! Container images are **not** ingested from the checkout: they are distributed
//! via a registry and pulled by digest by each runner from its own
//! configuration. The backend is out of the container path entirely.
//!
//! Ingest is idempotent: an already-present, unchanged `(slug, version)` is a
//! no-op. `force` re-ingests and re-renders even when unchanged.

use std::path::Path;

use test_cabinet_core::test_case::{TestCaseCatalog, TestCaseVersion};

use crate::error::{BackendError, Result};
use crate::render;
use crate::store::{
    DefinitionStore, StoredAsset, StoredBuild, StoredCheck, StoredManifest, StoredProof,
    StoredReference, StoredReviewItem, StoredSpec, StoredVariant, StoredWorkspaceFile,
};

/// Optional restrictions on an ingest scan (the `POST /ingest` request body).
#[derive(Debug, Clone, Default)]
pub struct IngestRequest {
    /// Restrict to these case slugs (a full scan when empty).
    pub test_cases: Option<Vec<String>>,
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

/// The full result of an ingest scan.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct IngestReport {
    /// One entry per scanned test-case version.
    pub test_case_versions: Vec<IngestedVersion>,
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

    /// Store every reference view (common + per-variant) of a resolved version
    /// into the store's reference sidecar. An HTML mockup is rendered to a
    /// screenshot; a static image/video is copied as-is. A failure aborts the
    /// version's ingest, since serving a version with a missing baseline would let
    /// a runner validate against a hole. Returns the number of references stored.
    fn render_references(&self, resolved: &TestCaseVersion) -> Result<usize> {
        let slug = &resolved.slug;
        let version = &resolved.version;
        let mut count = 0;

        // Common references store once under the `_common` scope.
        for reference in &resolved.common_references {
            self.store_one_reference(slug, version, "_common", reference)?;
            count += 1;
        }
        // Variant-specific references store under each variant's slug scope, so a
        // view shared across variants (e.g. a per-variant `title`) does not clobber.
        for variant in &resolved.variants {
            for reference in &variant.references {
                self.store_one_reference(slug, version, &variant.slug, reference)?;
                count += 1;
            }
        }
        Ok(count)
    }

    /// Store one reference under `scope`: render an HTML mockup to a `.png`, or
    /// copy a static image/video as-is to `<view>.<ext>`.
    fn store_one_reference(
        &self,
        slug: &str,
        version: &str,
        scope: &str,
        reference: &test_cabinet_core::ReferenceView,
    ) -> Result<()> {
        let file = format!("{}.{}", reference.view, reference.extension());
        let out = self.store.reference_path(slug, version, scope, &file);
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent)?;
        }
        if reference.kind.is_rendered() {
            render::render_reference(&reference.source_path, &out).map_err(|detail| {
                BackendError::Snapshot(format!(
                    "could not render reference `{}`: {detail}",
                    reference.view
                ))
            })
        } else {
            std::fs::copy(&reference.source_path, &out).map_err(|err| {
                BackendError::Snapshot(format!(
                    "could not store reference media `{}`: {err}",
                    reference.view
                ))
            })?;
            Ok(())
        }
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

    // The starter workspace files (common + each variant's override) are keyed by
    // their store-relative source path; the runner fetches each like an asset and
    // seeds it at the file's run-relative `dest`.
    let workspace = resolved
        .common_workspace
        .iter()
        .map(|file| stored_workspace(root, file))
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
            let workspace = variant
                .workspace
                .as_ref()
                .map(|files| {
                    files
                        .iter()
                        .map(|file| stored_workspace(root, file))
                        .collect::<Result<Vec<_>>>()
                })
                .transpose()?;
            Ok(StoredVariant {
                slug: variant.slug.clone(),
                name: variant.name.clone(),
                description: variant.description.clone(),
                specs,
                workspace,
                references: variant.references.iter().map(stored_reference).collect(),
                proofs: variant.proofs.iter().map(stored_proof).collect(),
                review_items: variant
                    .review_items
                    .iter()
                    .map(stored_review_item)
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
        workspace,
        init: resolved.init.clone(),
        assets,
        variants,
        common_references: resolved
            .common_references
            .iter()
            .map(stored_reference)
            .collect(),
        common_proofs: resolved.common_proofs.iter().map(stored_proof).collect(),
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
        common_review_items: resolved
            .common_review_items
            .iter()
            .map(stored_review_item)
            .collect(),
    })
}

/// Build a [`StoredReviewItem`] from a resolved reviewer checklist item.
fn stored_review_item(item: &test_cabinet_core::ReviewItem) -> StoredReviewItem {
    StoredReviewItem {
        id: item.id.clone(),
        title: item.title.clone(),
        text: item.text.clone(),
        reference: item.reference.clone(),
        proof: item.proof.clone(),
    }
}

/// Build a [`StoredReference`] from a resolved reference view, recording its kind
/// and the extension its media is served under.
fn stored_reference(reference: &test_cabinet_core::ReferenceView) -> StoredReference {
    StoredReference {
        view: reference.view.clone(),
        kind: reference.kind,
        extension: reference.extension(),
    }
}

/// Build a [`StoredProof`] from a resolved proof-of-implementation declaration.
fn stored_proof(proof: &test_cabinet_core::ProofFile) -> StoredProof {
    StoredProof {
        id: proof.id.clone(),
        name: proof.name.clone(),
        kind: proof.kind,
        dest: to_forward_slash(&proof.dest),
    }
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

/// Build a [`StoredWorkspaceFile`] from a resolved workspace file: the
/// store-relative `source` key plus the run-relative `dest` (already computed at
/// resolution as the file's path within the workspace directory).
fn stored_workspace(
    root: &Path,
    file: &test_cabinet_core::WorkspaceFile,
) -> Result<StoredWorkspaceFile> {
    Ok(StoredWorkspaceFile {
        source: relative_key(root, &file.source_path)?,
        dest: to_forward_slash(&file.dest),
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
