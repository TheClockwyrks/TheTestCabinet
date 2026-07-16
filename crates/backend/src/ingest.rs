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

use test_cabinet_core::test_case::{TestCaseCatalog, TestCaseVersion, is_seeded_dotfile};

use crate::error::{BackendError, Result};
use crate::render;
use crate::store::{
    DefinitionStore, StoredAsset, StoredBuild, StoredCanvas, StoredCase, StoredCheck,
    StoredContract, StoredDomain, StoredManifest, StoredMatch, StoredOutput, StoredProof,
    StoredReference, StoredReplay, StoredReviewItem, StoredSandbox, StoredSimulation, StoredSpec,
    StoredSubReviewItem, StoredTool, StoredVariant, StoredWorkspaceFile, reference_in,
    write_manifest_in,
};

/// Optional restrictions on an ingest scan (the `POST /ingest` request body).
#[derive(Debug, Clone, Default)]
pub struct IngestRequest {
    /// Restrict to these entries (a full scan when `None`). Each entry is either a
    /// bare case `id` — its slug or folder name, expanding to every version the case
    /// declares — or a version-qualified `id@version`, targeting exactly that one
    /// version so a single edited version can be re-ingested without re-rendering the
    /// case's other versions.
    pub test_cases: Option<Vec<String>>,
    /// Re-ingest and re-render even when unchanged.
    pub force: bool,
    /// An opaque version token identifying the catalog content of a whole-catalog
    /// ingest (the client's build commit). When supplied and unchanged from the
    /// store's recorded marker, the scan reuses the already-ingested versions
    /// instead of re-rendering them; when changed (or first-seen) it forces a full
    /// re-ingest and records the new token. Ignored for a partial (`test_cases`)
    /// scan, which neither consults nor moves the whole-catalog marker.
    pub catalog_version: Option<String>,
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

/// A progress event emitted as a [`Ingestor::scan_with_progress`] scan advances, so
/// a caller can stream per-version progress rather than wait for the whole report.
/// Events are advisory; the returned [`IngestReport`] is the authoritative outcome.
#[derive(Debug, Clone, PartialEq)]
pub enum IngestEvent<'a> {
    /// Emitted once before the first version, carrying the count to be scanned.
    Start {
        /// Total test-case versions this scan will touch.
        total: usize,
    },
    /// Emitted after each version is ingested (or skipped as unchanged).
    Version {
        /// 1-based position of this version within the scan.
        index: usize,
        /// Total versions in the scan (the same value as [`IngestEvent::Start`]).
        total: usize,
        /// The just-finished version's outcome.
        version: &'a IngestedVersion,
    },
}

/// Ingests definitions from a checkout into a definition store.
pub struct Ingestor<'a> {
    checkout: &'a Path,
    store: &'a DefinitionStore,
    /// `(slug, version)` pairs a whole-catalog scan must never prune even when the
    /// checkout no longer declares them — the definitions still-referencing runs
    /// depend on. Empty by default (prune everything absent); set via
    /// [`with_protected_cases`](Self::with_protected_cases).
    protected: std::collections::HashSet<(String, String)>,
}

impl<'a> Ingestor<'a> {
    /// Create an ingestor over a checkout path and a target store.
    pub fn new(checkout: &'a Path, store: &'a DefinitionStore) -> Self {
        Self {
            checkout,
            store,
            protected: std::collections::HashSet::new(),
        }
    }

    /// Protect these `(slug, version)` pairs from the whole-catalog prune — the set a
    /// run references (see [`crate::db::Db::referenced_cases`]), so a stale definition
    /// a published or pending run still needs is kept rather than dropped.
    pub fn with_protected_cases(
        mut self,
        protected: std::collections::HashSet<(String, String)>,
    ) -> Self {
        self.protected = protected;
        self
    }

    /// Run a scan, honoring the request's restrictions and `force` flag.
    pub fn scan(&self, request: &IngestRequest) -> Result<IngestReport> {
        self.scan_with_progress(request, |_| {})
    }

    /// Like [`scan`](Self::scan), but invoke `on_event` as each version completes so
    /// the caller can stream progress. A whole-catalog scan renders every case's
    /// references and otherwise answers only once the last one is done; emitting a
    /// [`IngestEvent`] per version lets the trigger report progress instead of
    /// stalling silently for the minute-plus a full re-render takes.
    pub fn scan_with_progress(
        &self,
        request: &IngestRequest,
        mut on_event: impl FnMut(IngestEvent),
    ) -> Result<IngestReport> {
        // A whole-catalog ingest can carry a version token (the client's build
        // commit). When it matches what the store last ingested, the catalog is
        // unchanged and the per-version skip path (below) does the cheap thing; when
        // it differs or is first-seen, the content may have changed under unchanged
        // version strings, so the whole catalog is force re-ingested. A partial scan
        // (`test_cases` set) never participates — its marker would falsely claim the
        // whole catalog.
        let whole_catalog = request.test_cases.is_none();
        let tagged = whole_catalog
            .then_some(request.catalog_version.as_deref())
            .flatten();
        let unchanged = tagged.is_some() && self.store.catalog_version().as_deref() == tagged;
        let force = request.force || (tagged.is_some() && !unchanged);

        let targets = self.version_targets(request)?;
        let total = targets.len();
        on_event(IngestEvent::Start { total });

        let mut report = IngestReport::default();
        for (index, (slug, version)) in targets.into_iter().enumerate() {
            let ingested = self.ingest_version(&slug, &version, force)?;
            on_event(IngestEvent::Version {
                index: index + 1,
                total,
                version: &ingested,
            });
            report.test_case_versions.push(ingested);
        }

        // A whole-catalog scan has enumerated every case the checkout declares, so it
        // can also drop definitions the checkout no longer has — the prune that keeps
        // a folder rename (or a deleted version) from leaving the old slug served
        // alongside the new one. A partial (`test_cases`) scan cannot: it has not seen
        // the whole catalog, so it must not conclude anything is absent. Run-
        // referenced definitions are spared regardless (see `prune_absent`).
        if whole_catalog {
            self.prune_absent(&report)?;
        }

        // Stamp the marker only after a clean full scan, so a fresh store (no marker)
        // and a changed catalog both end at the token they were just ingested to.
        if let Some(version) = tagged {
            self.store.set_catalog_version(version)?;
        }

        Ok(report)
    }

    /// Drop every stored `(slug, version)` the just-completed whole-catalog scan did
    /// not touch — i.e. the checkout no longer declares — except any pair a run still
    /// references (the `protected` set), which is kept so the run stays resolvable and
    /// keeps its case metadata. `report` lists exactly the versions present in the
    /// checkout (each keyed by its resolved slug), so anything in the store outside
    /// that set and outside `protected` is stale and removed.
    fn prune_absent(&self, report: &IngestReport) -> Result<()> {
        let present: std::collections::HashSet<(&str, &str)> = report
            .test_case_versions
            .iter()
            .map(|v| (v.slug.as_str(), v.version.as_str()))
            .collect();
        for (slug, versions) in self.store.list_cases()? {
            for version in versions {
                if present.contains(&(slug.as_str(), version.as_str())) {
                    continue;
                }
                if self.protected.contains(&(slug.clone(), version.clone())) {
                    continue;
                }
                self.store.remove_version(&slug, &version)?;
            }
        }
        Ok(())
    }

    /// Resolve the set of `(slug, version)` pairs to scan from the checkout.
    ///
    /// A whole-catalog scan (no restriction) enumerates every declared case as a bare
    /// entry; a partial scan takes the request's entries verbatim. Each entry is then
    /// resolved to targets: a bare `id` (slug or folder name) expands to every version
    /// the case declares, while a version-qualified `id@version` targets exactly that
    /// one version — so an edit to a single version re-renders only it, not every
    /// version of the case. `@` cannot occur in a slug/folder name or a version string,
    /// so it is an unambiguous separator.
    fn version_targets(&self, request: &IngestRequest) -> Result<Vec<(String, String)>> {
        let catalog = TestCaseCatalog::new(self.checkout.join("test-cases"));
        let entries: Vec<String> = match &request.test_cases {
            Some(entries) => entries.clone(),
            None => catalog
                .list()
                .map_err(BackendError::Core)?
                .into_iter()
                .map(|case| case.slug)
                .collect(),
        };
        let mut targets = Vec::new();
        for entry in entries {
            if let Some((id, version)) = entry.split_once('@') {
                targets.push((id.to_string(), version.to_string()));
            } else {
                for version in catalog.versions(&entry).map_err(BackendError::Core)? {
                    targets.push((entry.clone(), version));
                }
            }
        }
        Ok(targets)
    }

    // --- Test-case versions -------------------------------------------------

    /// Ingest one test-case version: resolve it (which validates structure), copy
    /// the version folder verbatim, render its references, and write the resolved
    /// store-relative manifest. Idempotent unless `force`.
    ///
    /// The build happens in a staging directory that is then swapped into place
    /// atomically (see [`DefinitionStore::publish_staged_version`]). A re-ingest
    /// therefore never leaves the served version half-built or manifest-less, even
    /// for the seconds-to-minutes its references take to render — the window a prior
    /// destructive in-place rebuild opened, which a run resolving its version during
    /// a force re-ingest saw as a spurious 404 "is not ingested". Building fresh also
    /// guarantees a file removed in the checkout does not linger in the store.
    fn ingest_version(&self, id: &str, version: &str, force: bool) -> Result<IngestedVersion> {
        let catalog = TestCaseCatalog::new(self.checkout.join("test-cases"));

        // The store is keyed by the case's resolved slug (its manifest identity),
        // which can differ from `id` — the folder name a targeted scan named, or the
        // slug a whole-catalog scan enumerated. Resolve it cheaply up front so the
        // unchanged-skip check and every store key below use the true identity rather
        // than the lookup key, keeping the store directory and the manifest it holds
        // in agreement.
        let slug = catalog.slug_of(id, version).map_err(BackendError::Core)?;

        if !force && self.store.has_version(&slug, version) {
            return Ok(IngestedVersion {
                slug,
                version: version.to_string(),
                ingested: false,
                rendered_references: 0,
            });
        }

        let resolved = catalog.resolve(id, version).map_err(BackendError::Core)?;

        let staged = self.store.new_staging_dir(&slug, version)?;
        let rendered = match self.build_version(&staged, &resolved) {
            Ok(rendered) => rendered,
            Err(err) => {
                // Discard the partial build so a failed ingest leaves no debris and
                // never publishes an incomplete version.
                let _ = std::fs::remove_dir_all(&staged);
                return Err(err);
            }
        };
        self.store.publish_staged_version(&slug, version, &staged)?;

        Ok(IngestedVersion {
            slug,
            version: version.to_string(),
            ingested: true,
            rendered_references: rendered,
        })
    }

    /// Build a resolved version's full tree — sources, rendered references, and the
    /// resolved manifest — into `dest`, returning the number of references stored.
    /// `dest` is a staging directory the caller swaps into place; on any error the
    /// caller discards it, so a partial build is never served.
    fn build_version(&self, dest: &Path, resolved: &TestCaseVersion) -> Result<usize> {
        copy_tree(&resolved.root, dest)?;
        let rendered = self.render_references(dest, resolved)?;
        let manifest = build_stored_manifest(resolved)?;
        write_manifest_in(dest, &manifest)?;
        Ok(rendered)
    }

    /// Store every reference view (common + per-variant) of a resolved version into
    /// `dest`'s reference sidecar (a staging directory; see [`build_version`]). An
    /// HTML mockup is rendered to a screenshot; a static image/video is copied as-is.
    /// A failure aborts the version's ingest, since serving a version with a missing
    /// baseline would let a runner validate against a hole. Returns the number of
    /// references stored.
    fn render_references(&self, dest: &Path, resolved: &TestCaseVersion) -> Result<usize> {
        let mut count = 0;

        // Common references store once under the `_common` scope.
        for reference in &resolved.common_references {
            self.store_one_reference(dest, "_common", reference)?;
            count += 1;
        }
        // Variant-specific references store under each variant's slug scope, so a
        // view shared across variants (e.g. a per-variant `title`) does not clobber.
        for variant in &resolved.variants {
            for reference in &variant.references {
                self.store_one_reference(dest, &variant.slug, reference)?;
                count += 1;
            }
        }
        Ok(count)
    }

    /// Store one reference into `dest` under `scope`: render an HTML mockup to a
    /// `.png`, or copy a static image/video as-is to `<view>.<ext>`.
    fn store_one_reference(
        &self,
        dest: &Path,
        scope: &str,
        reference: &test_cabinet_core::ReferenceView,
    ) -> Result<()> {
        let file = format!("{}.{}", reference.view, reference.extension());
        let out = reference_in(dest, scope, &file);
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
    // The changelog is required, so it is always present to read.
    let changelog = std::fs::read_to_string(&resolved.changelog_path)?;

    let common_specs = resolved
        .common_specs
        .iter()
        .map(|spec| stored_spec(root, spec))
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
                .map(|spec| stored_spec(root, spec))
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
                domains: variant.domains.iter().map(stored_domain).collect(),
                voxel: variant.voxel.clone(),
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
        changelog,
        max_runtime_seconds: resolved.max_runtime_seconds,
        test_type: resolved.test_type,
        experimental: resolved.experimental,
        build: resolved.build.as_ref().map(|build| StoredBuild {
            install: build.install.clone(),
            build: build.build.clone(),
            module: build
                .module
                .as_ref()
                .map(|module| module.to_string_lossy().replace('\\', "/")),
        }),
        canvas: resolved.canvas.as_ref().map(|canvas| StoredCanvas {
            width: canvas.width,
            height: canvas.height,
            background: canvas.background.clone(),
        }),
        tool: resolved.tool.as_ref().map(|tool| StoredTool {
            binary: tool.binary.clone(),
            preview: tool.preview.to_string_lossy().replace('\\', "/"),
        }),
        output: resolved.output.as_ref().map(|output| StoredOutput {
            actions: output.actions.to_string_lossy().replace('\\', "/"),
        }),
        contract: resolved.contract.as_ref().map(|contract| {
            let forward = |path: &std::path::Path| path.to_string_lossy().replace('\\', "/");
            StoredContract {
                entry: contract.entry.clone(),
                world: contract.world.as_deref().map(forward),
                action: contract.action.as_deref().map(forward),
                input: contract.input.as_deref().map(forward),
                output: contract.output.as_deref().map(forward),
            }
        }),
        sandbox: resolved.sandbox.as_ref().map(|sandbox| StoredSandbox {
            fuel_per_tick: sandbox.fuel_per_tick,
            fuel_limit: sandbox.fuel_limit,
            max_memory_bytes: sandbox.max_memory_bytes,
        }),
        cases: resolved
            .cases
            .iter()
            .map(|case| stored_case(root, case))
            .collect::<Result<Vec<_>>>()?,
        simulation: resolved
            .simulation
            .as_ref()
            .map(|simulation| StoredSimulation {
                timestep_ms: simulation.timestep_ms,
                max_ticks: simulation.max_ticks,
            }),
        r#match: resolved.r#match.as_ref().map(|m| StoredMatch {
            participants: m.participants,
            structure: m.structure.clone(),
            rounds: m.rounds,
        }),
        replay: resolved.replay.as_ref().map(|replay| StoredReplay {
            renderer: replay.renderer.to_string_lossy().replace('\\', "/"),
        }),
        asset_kind: resolved.asset_kind,
        sheet: resolved.sheet.clone(),
        voxel: resolved.voxel.clone(),
        model: resolved.model.clone(),
        ui: resolved.ui.clone(),
        material: resolved.material.clone(),
        particle: resolved.particle.clone(),
        audio: resolved.audio.clone(),
        prompt_template,
        common_specs,
        workspace,
        init: resolved.init.clone(),
        assets,
        packages: resolved.packages.clone(),
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
        domains: resolved.domains.iter().map(stored_domain).collect(),
    })
}

/// Build a [`StoredDomain`] from a resolved scoring domain (the wire shape matches
/// field for field). Shared by the case's common domains and each variant's own.
fn stored_domain(domain: &test_cabinet_core::Domain) -> StoredDomain {
    StoredDomain {
        id: domain.id.clone(),
        name: domain.name.clone(),
        description: domain.description.clone(),
    }
}

/// Build a [`StoredReviewItem`] from a resolved reviewer checklist item.
fn stored_review_item(item: &test_cabinet_core::ReviewItem) -> StoredReviewItem {
    StoredReviewItem {
        id: item.id.clone(),
        title: item.title.clone(),
        text: item.text.clone(),
        reference: item.reference.clone(),
        proof: item.proof.clone(),
        sequences: item.sequences.clone(),
        frames: item.frames.clone(),
        weight: item.weight,
        graded: item.graded,
        domain: item.domain.clone(),
        sub_items: item
            .sub_items
            .iter()
            .map(|sub| StoredSubReviewItem {
                id: sub.id.clone(),
                title: sub.title.clone(),
            })
            .collect(),
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

/// Build a `StoredSpec` from a resolved [`SpecFile`], deriving the store-relative
/// `source` key and the `template` flag (a `.hbs` source) and carrying its `kind`.
fn stored_spec(root: &Path, spec: &test_cabinet_core::SpecFile) -> Result<StoredSpec> {
    let source = relative_key(root, &spec.source_path)?;
    let template = spec
        .source_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("hbs"))
        .unwrap_or(false);
    Ok(StoredSpec {
        source,
        dest: to_forward_slash(&spec.dest),
        template,
        kind: spec.kind,
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

/// Build a [`StoredCase`] from a resolved performance case: the held-out `input`
/// scenario and `expected` oracle state, each keyed by its **store-relative** path
/// exactly as specs, workspace files, and assets are. The runner fetches both like
/// any other definition file and the [`PerformanceValidator`] scores against them;
/// they are never seeded into a run. Keying them absolutely (as this once did)
/// leaves the driver's [`materialize_version`] unable to fetch or locate them, so
/// every backend-driven performance run resolves an empty scored set and aborts.
fn stored_case(
    root: &Path,
    case: &test_cabinet_core::test_case::PerformanceCase,
) -> Result<StoredCase> {
    Ok(StoredCase {
        input: relative_key(root, &case.input)?,
        expected: relative_key(root, &case.expected)?,
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
///
/// The exceptions are the dotfiles a case legitimately ships (`.gitignore`,
/// `.cargo`): they are preserved so a backend-driven run seeds the same set a
/// local run does. The allowlist is shared with `core`'s `collect_workspace_files`
/// via [`is_seeded_dotfile`], which keeps the two in lockstep.
fn copy_tree(src: &Path, dst: &Path) -> Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with('.') && !is_seeded_dotfile(&name_str) {
            continue;
        }
        let from = entry.path();
        let to = dst.join(&name);
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            // `entry.file_type()` (from `read_dir`) never follows the link, so a
            // symlink is handled here before the dir/file split below. Recreate it
            // as a symlink rather than dereferencing it: `std::fs::copy` follows the
            // link and errors on a symlink-to-directory ("the source path is neither
            // a regular file nor a symlink to a regular file") — e.g. a
            // reference-impl's `node_modules/@test-cabinet/voxel-runtime` link.
            copy_symlink(&from, &to)?;
        } else if file_type.is_dir() {
            copy_tree(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

/// Recreate the symlink at `from` at the new location `to`, preserving its target
/// verbatim. The target is kept as-is (typically relative to the link's own
/// directory) so the recreated link resolves the same way the original did. Mirrors
/// `core`'s `copy_symlink`.
fn copy_symlink(from: &Path, to: &Path) -> Result<()> {
    let target = std::fs::read_link(from)?;
    #[cfg(unix)]
    std::os::unix::fs::symlink(&target, to)?;
    #[cfg(windows)]
    if from.is_dir() {
        std::os::windows::fs::symlink_dir(&target, to)?;
    } else {
        std::os::windows::fs::symlink_file(&target, to)?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "ingest.test.rs"]
mod tests;
