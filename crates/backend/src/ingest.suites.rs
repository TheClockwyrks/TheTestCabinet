//! The suite half of ingest: reading `test-suites/` out of the checkout, lowering
//! every definition a suite version offers into the keyed test-case tree, and
//! writing the suite's own entities into the [suite key space](crate::suite_store).
//!
//! # One lowering path
//!
//! A definition resolves through [`TestSuiteCatalog`] into exactly the
//! [`TestCaseVersion`] an authored case resolves to, so it is built into the store
//! by the same [`build_version`](super::Ingestor::build_version) and served by the
//! same fetch family. The only thing the stored record says about its origin is the
//! [coordinate](StoredSuiteCoordinate) on its manifest.
//!
//! # Where a suite is read from
//!
//! Every suite tree is reached through [`TestSuiteCatalog`]: the catalog lists the
//! exported versions at `<slug>/versions/v<x.y.z>/` of every folder holding a
//! `suite.toml`, composes each tree's path, and reads nothing under `drafts/`. An
//! ingestor configured for previews hands the catalog the `.previews/` folder too,
//! and a preview is then one more suite version, read against the suite manifest
//! copy beside it.
//!
//! # What a broken suite costs
//!
//! A suite version that does not resolve or validate, and a definition that cannot
//! be lowered — a `performance` definition, whose keys the format leaves to be
//! determined — is logged and reported with a `problem` naming the file and the
//! failure rather than failing the scan. A whole-catalog scan is how the entire
//! catalog reaches the store, and one unresolvable definition must cost that
//! definition rather than every case the deployment serves. A reported problem is
//! not a present version, so the prune drops whatever it had left behind.

use std::collections::{BTreeMap, HashSet};

use test_cabinet_core::test_suite::{
    ASSETS_DIR, AssetFolder, DEBUG_API_DIR, DEBUG_API_FILE, DemoFolder, PROMPTS_DIR, SHOWCASE_DIR,
    SPECIFICATIONS_DIR, SUITE_MANIFEST_FILE, SpecificationFolder, SuiteVersion,
    TEST_CASES_DIR as SUITE_TEST_CASES_DIR, VALIDATORS_DIR, VERSION_MANIFEST_FILE, WORKSPACES_DIR,
    catalog_identity, load_and_validate, suite_manifest_path_of,
};

use crate::store::{manifest_in, write_ingest_stamp_in};
use crate::suite_store::{
    StoredSuite, StoredSuiteAsset, StoredSuiteDefinition, StoredSuiteDemo, StoredSuiteShowcase,
    StoredSuiteSpecification,
};

use super::*;

/// The outcome of ingesting one suite version's own record.
#[derive(Debug, Clone, PartialEq)]
pub struct IngestedSuite {
    /// The suite's slug.
    pub slug: String,
    /// The version folder name, carrying its leading `v`.
    pub version: String,
    /// Whether this call wrote it, vs. skipped it as already present or refused.
    pub ingested: bool,
    /// Why a skipped version was skipped, when the scan names a reason (see
    /// [`IngestedVersion::reason`]).
    pub reason: Option<SkipReason>,
    /// Why the version could not be ingested, naming the file and the failure. Set
    /// only on a refused version, whose definitions the scan drops with it.
    pub problem: Option<String>,
}

impl Ingestor<'_> {
    /// Ingest one suite version's own entities into the suite key space.
    ///
    /// A version that could not be ingested at all — its manifests do not resolve,
    /// it does not read back, or it fails validation — is logged against the suite
    /// and reported with its `problem`, so a whole-catalog scan prunes whatever it
    /// holds.
    pub(super) fn ingest_suite(
        &self,
        slug: &str,
        version: &str,
        decider: &Decider,
        digests: &SuiteDigests,
    ) -> Result<IngestedSuite> {
        let outcome =
            |ingested: bool, reason: Option<SkipReason>, problem: Option<String>| IngestedSuite {
                slug: slug.to_string(),
                version: version.to_string(),
                ingested,
                reason,
                problem,
            };
        let refuse = |problem: String| {
            tracing::error!(%slug, %version, %problem, "skipping a suite version");
            Ok(outcome(false, None, Some(problem)))
        };
        // The identity read is what checks the folder layout against what the
        // manifests declare, so it runs before the whole tree is parsed. It also runs
        // before the already-present skip and the content decision: a stored version
        // whose checkout copy no longer resolves is not a present version, so it is
        // refused with its problem and a whole-catalog scan prunes it along with the
        // cases it was lowered into.
        let catalog = self.suite_catalog();
        let identity = match catalog.identity(slug, version) {
            Ok(identity) => identity,
            Err(error) => return refuse(error.to_string()),
        };
        let has_record = self.store.has_suite_version(slug, version);
        if decider.skips_as_stored(has_record) {
            return Ok(outcome(false, None, None));
        }
        let digest = &digests.get(self, slug, version)?;
        let decision = decider.decide(has_record, || self.store.suite_stamp(slug, version), digest);
        if let Decision::Skip(reason) = decision {
            return Ok(outcome(false, reason, None));
        }
        let root = catalog.version_tree(slug, version);
        let location = to_forward_slash(root.strip_prefix(self.checkout).unwrap_or(&root));
        let (loaded, diagnostics) = match load_and_validate(&identity.suite, &root) {
            Ok(loaded) => loaded,
            Err(error) => return refuse(format!("`{location}` does not read back: {error}")),
        };
        if !diagnostics.is_empty() {
            let failures: Vec<String> = diagnostics.iter().map(ToString::to_string).collect();
            return refuse(format!(
                "`{location}` does not validate: {}",
                failures.join("; ")
            ));
        }

        let record = build_stored_suite(slug, version, &root, &loaded)?;
        let staged = self.store.new_suite_staging_dir(slug, version)?;
        let built = self
            .build_suite(&staged, &root, &record)
            .and_then(|()| write_ingest_stamp_in(&staged, &decider.stamp(digest.to_string())));
        if let Err(err) = built {
            // Discard the partial build so a failed ingest never publishes one.
            let _ = std::fs::remove_dir_all(&staged);
            return Err(err);
        }
        self.store.publish_staged_suite(slug, version, &staged)?;
        Ok(outcome(true, None, None))
    }

    /// Build one suite version's stored tree into `staged`: the byte trees a reader
    /// of the record fetches from, then the record itself.
    ///
    /// Only the showcase and the assets are copied. Every other entity is *in* the
    /// record — the manifest, the prose, the specifications, the definitions, the
    /// demonstrations and the reference implementations are served as values — and
    /// the files a run needs ride the stored test-case versions the definitions were
    /// lowered into.
    fn build_suite(
        &self,
        staged: &std::path::Path,
        root: &std::path::Path,
        record: &StoredSuite,
    ) -> Result<()> {
        for dir in [SHOWCASE_DIR, ASSETS_DIR] {
            let from = root.join(dir);
            if from.is_dir() {
                copy_tree(&from, &staged.join(dir))?;
            }
        }
        self.store.write_suite_in(staged, record)
    }

    /// Ingest one definition of one suite version as the test-case version it lowers
    /// to.
    ///
    /// A definition that could not be lowered is logged against the suite and
    /// reported with its `problem`.
    pub(super) fn ingest_definition(
        &self,
        suite: &str,
        version: &str,
        definition: &str,
        decider: &Decider,
        digests: &SuiteDigests,
    ) -> Result<IngestedVersion> {
        let slug = catalog_identity(suite, definition);
        let skipped = |slug: String, reason| {
            Ok(IngestedVersion {
                slug,
                version: version.to_string(),
                ingested: false,
                rendered_references: 0,
                reason,
                problem: None,
            })
        };
        let has_record = self.store.has_version(&slug, version);
        if decider.skips_as_stored(has_record) {
            return skipped(slug, None);
        }
        let digest = &digests.get(self, suite, version)?;
        let decision = decider.decide(
            has_record,
            || self.store.version_stamp(&slug, version),
            digest,
        );
        if let Decision::Skip(reason) = decision {
            return skipped(slug, reason);
        }

        // The rendered specifications land here rather than in the suites checkout,
        // which The Spec Cabinet owns and ingest never writes to. They are copied
        // into the stored version under the path they seed at (see
        // [`copy_suite_version`]) and this directory is dropped afterwards.
        let materials = self
            .store
            .new_staging_dir(&format!("materials-{slug}"), version)?;
        let catalog = self.reading_previews(TestSuiteCatalog::with_materials(
            self.checkout.join(TEST_SUITES_DIR),
            materials.clone(),
        ));
        let stamp = decider.stamp(digest.to_string());
        let result = self.build_definition(&catalog, suite, version, definition, &slug, &stamp);
        let _ = std::fs::remove_dir_all(&materials);
        result
    }

    /// Resolve one definition and build it into the store, reporting the problem of
    /// one that cannot be lowered.
    fn build_definition(
        &self,
        catalog: &TestSuiteCatalog,
        suite: &str,
        version: &str,
        definition: &str,
        slug: &str,
        stamp: &crate::store::IngestStamp,
    ) -> Result<IngestedVersion> {
        let authored = self.case_catalog();
        // Resolved beside the authored catalog, so an identity both catalogs claim is
        // reported as the ambiguity it is rather than quietly overwriting a case.
        let resolved = match catalog.resolve_beside(suite, version, definition, &authored) {
            Ok(resolved) => resolved,
            Err(error) => {
                tracing::error!(
                    %suite,
                    %version,
                    %definition,
                    %error,
                    "skipping a suite definition: it does not resolve"
                );
                return Ok(IngestedVersion {
                    slug: slug.to_string(),
                    version: version.to_string(),
                    ingested: false,
                    rendered_references: 0,
                    reason: None,
                    problem: Some(error.to_string()),
                });
            }
        };
        let coordinate = StoredSuiteCoordinate {
            suite: suite.to_string(),
            suite_version: version.to_string(),
            definition: definition.to_string(),
        };

        let staged = self.store.new_staging_dir(slug, version)?;
        let built = self
            .build_version(&staged, &resolved, Some(&coordinate))
            .and_then(|rendered| {
                verify_stored_files(&staged)?;
                write_ingest_stamp_in(&staged, stamp)?;
                Ok(rendered)
            });
        let rendered = match built {
            Ok(rendered) => rendered,
            Err(err) => {
                let _ = std::fs::remove_dir_all(&staged);
                return Err(err);
            }
        };
        self.store.publish_staged_version(slug, version, &staged)?;
        Ok(IngestedVersion {
            slug: slug.to_string(),
            version: version.to_string(),
            ingested: true,
            rendered_references: rendered,
            reason: None,
            problem: None,
        })
    }

    /// Drop every stored suite version the just-completed whole-catalog scan did not
    /// touch — the checkout no longer declares it — except one a run still
    /// references, which is kept so the run's case keeps the suite it names.
    ///
    /// A run references a suite version transitively: it references a stored
    /// test-case version, and that version's manifest carries the coordinate it was
    /// lowered from. The protected set is read through those manifests rather than
    /// guessed from the identity, because the identity is a name and the coordinate
    /// is the fact.
    pub(super) fn prune_absent_suites(&self, report: &IngestReport) -> Result<()> {
        let present: HashSet<(&str, &str)> = report
            .suite_versions
            .iter()
            .filter(|suite| suite.problem.is_none())
            .map(|suite| (suite.slug.as_str(), suite.version.as_str()))
            .collect();
        let protected: HashSet<(String, String)> = self
            .protected
            .iter()
            .filter_map(|(slug, version)| {
                self.store
                    .read_manifest(slug, version)
                    .ok()
                    .and_then(|manifest| manifest.suite)
                    .map(|coordinate| (coordinate.suite, coordinate.suite_version))
            })
            .collect();
        for (slug, versions) in self.store.list_suites()? {
            for version in versions {
                if present.contains(&(slug.as_str(), version.as_str())) {
                    continue;
                }
                if protected.contains(&(slug.clone(), version.clone())) {
                    continue;
                }
                self.store.remove_suite_version(&slug, &version)?;
            }
        }
        Ok(())
    }

    /// The `suite.toml` one suite version is read against, declaring the suite's
    /// identity and the display name its lowered definitions report: the suite
    /// folder's own, which every exported version of the suite shares, or the copy
    /// beside a preview.
    pub(super) fn suite_manifest_path(&self, slug: &str, version: &str) -> PathBuf {
        self.suite_catalog().suite_manifest_path(slug, version)
    }

    /// The content digest of one suite version as the checkout holds it now: its
    /// version tree plus the `suite.toml` it is read against.
    pub(super) fn suite_digest(&self, slug: &str, version: &str) -> Result<String> {
        Ok(digest::suite_version_digest(
            &self.suite_catalog().version_tree(slug, version),
            &self.suite_manifest_path(slug, version),
        )?)
    }
}

/// Copy the files a suite-defined version's entities reference into `dest`, and
/// report the keys they are stored under.
///
/// A suite tree holds the whole suite rather than one case, so it is not copied
/// verbatim the way an authored version folder is. What a run needs is
/// copied: the starter workspaces, the prompt templates, the asset files, the
/// validator project, the debug API declaration, and the rendered specification
/// documents — which are the one thing that has no path inside the version folder,
/// so they are copied in under the path they seed at and keyed there.
///
/// The suite's own declaration travels with them — `version.toml`, a copy of the
/// `suite.toml` the tree belongs to, the specification folders, and the definition
/// files — because a run is judged against the suite, not only seeded from it. The
/// copied `suite.toml` sits beside `version.toml`, so the stored tree names its
/// suite without the suite folder it was read from. The driver rebuilds the tree out
/// of these files in its per-job definition store (see
/// `test_cabinet_core::materialize_version`), and the prompt it renders and the
/// requirement outcomes it records are read from that model. Everything the suite
/// holds that no run reads — the demonstrations, the reference implementations, the
/// showcase — stays out, so a driver job fetches the suite rather than the whole
/// repository.
pub(super) fn copy_suite_version<'a>(
    dest: &Path,
    resolved: &'a TestCaseVersion,
) -> Result<Keys<'a>> {
    let root = &resolved.root;
    for dir in [
        WORKSPACES_DIR,
        PROMPTS_DIR,
        ASSETS_DIR,
        VALIDATORS_DIR,
        DEBUG_API_DIR,
        SPECIFICATIONS_DIR,
        SUITE_TEST_CASES_DIR,
    ] {
        let from = root.join(dir);
        if from.is_dir() {
            copy_tree(&from, &dest.join(dir))?;
        }
    }
    for file in [DEBUG_API_FILE, VERSION_MANIFEST_FILE] {
        let declaration = root.join(file);
        if declaration.is_file() {
            std::fs::copy(&declaration, dest.join(file))?;
        }
    }
    let suite_manifest = suite_manifest_path_of(root)
        .filter(|path| path.is_file())
        .ok_or_else(|| {
            BackendError::Snapshot(format!("`{}` belongs to no suite manifest", root.display()))
        })?;
    std::fs::copy(&suite_manifest, dest.join(SUITE_MANIFEST_FILE))?;

    let mut relocated = BTreeMap::new();
    let specs = resolved
        .common_specs
        .iter()
        .chain(resolved.variants.iter().flat_map(|variant| &variant.specs));
    for spec in specs {
        if spec.source_path.starts_with(root) {
            continue;
        }
        let to = dest.join(&spec.dest);
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(&spec.source_path, &to).map_err(|err| {
            BackendError::Snapshot(format!(
                "could not store the rendered specification `{}`: {err}",
                spec.dest.display()
            ))
        })?;
        relocated.insert(spec.source_path.clone(), to_forward_slash(&spec.dest));
    }
    Ok(Keys::relocated(root, relocated))
}

/// Check that every file the just-built manifest keys is actually in the staged
/// tree.
///
/// The keys are what a runner fetches by, and a suite declares the paths they come
/// from (a `[workspaces]` directory, an asset's files), so a definition naming
/// something outside the trees copied above would otherwise publish a version whose
/// seed 404s mid-run. Failing here costs that definition instead.
fn verify_stored_files(staged: &Path) -> Result<()> {
    let bytes = std::fs::read(manifest_in(staged))?;
    let manifest: StoredManifest = serde_json::from_slice(&bytes).map_err(|err| {
        BackendError::Internal(format!("the staged manifest does not read: {err}"))
    })?;
    let workspaces = std::iter::once(&manifest.workspace)
        .chain(
            manifest
                .variants
                .iter()
                .filter_map(|v| v.workspace.as_ref()),
        )
        .flat_map(|workspace| workspace.files())
        .map(|file| file.source.clone());
    let specs = manifest
        .common_specs
        .iter()
        .chain(manifest.variants.iter().flat_map(|variant| &variant.specs))
        .map(|spec| spec.source.clone());
    for key in specs.chain(workspaces) {
        if !staged.join(&key).is_file() {
            return Err(BackendError::Snapshot(format!(
                "`{key}` is declared by the definition but is not in the version it was \
                 lowered into"
            )));
        }
    }
    Ok(())
}

/// Build one suite version's resolved record from its loaded folder.
fn build_stored_suite(
    slug: &str,
    version: &str,
    root: &Path,
    loaded: &SuiteVersion,
) -> Result<StoredSuite> {
    let read = |relative: &str| -> Result<String> {
        std::fs::read_to_string(root.join(relative)).map_err(|err| {
            BackendError::Snapshot(format!(
                "could not read `{relative}` of suite `{slug}@{version}`: {err}"
            ))
        })
    };

    let mut folders = Vec::new();
    flatten_specifications(&loaded.specifications, &mut folders);
    let specifications = folders
        .into_iter()
        .map(|folder| {
            Ok(StoredSuiteSpecification {
                dir: folder.dir.clone(),
                manifest: folder.manifest.clone(),
                prose: read(&folder.prose)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;

    let showcase = loaded
        .showcase
        .as_ref()
        .map(|showcase| -> Result<StoredSuiteShowcase> {
            Ok(StoredSuiteShowcase {
                manifest: showcase.manifest.clone(),
                description: read(&showcase.description)?,
                // The media paths are recorded relative to the showcase directory,
                // which is exactly what the showcase byte route takes.
                media: showcase
                    .media
                    .iter()
                    .map(|file| {
                        file.strip_prefix(&format!("{SHOWCASE_DIR}/"))
                            .unwrap_or(file)
                            .to_string()
                    })
                    .collect(),
            })
        })
        .transpose()?;

    Ok(StoredSuite {
        slug: slug.to_string(),
        version: version.to_string(),
        suite: loaded.suite.clone(),
        manifest: loaded.manifest.clone(),
        description: read(&loaded.manifest.description)?,
        changelog: read(&loaded.manifest.changelog)?,
        specifications,
        test_cases: loaded
            .test_cases
            .iter()
            .map(|case| StoredSuiteDefinition {
                slug: case.slug.clone(),
                id: catalog_identity(slug, &case.slug),
                definition: case.definition.clone(),
            })
            .collect(),
        assets: loaded.assets.iter().map(stored_asset).collect(),
        demos: loaded.demos.iter().map(stored_demo).collect(),
        reference_implementations: loaded
            .trees
            .reference_implementations
            .keys()
            .cloned()
            .collect(),
        showcase,
    })
}

/// Flatten the specification tree into walk order: a folder before the folders
/// nested inside it, which is the order the suite presents them in.
fn flatten_specifications<'a>(
    folders: &'a [SpecificationFolder],
    into: &mut Vec<&'a SpecificationFolder>,
) {
    for folder in folders {
        into.push(folder);
        flatten_specifications(&folder.children, into);
    }
}

/// One bundled asset, as the record carries it.
fn stored_asset(asset: &AssetFolder) -> StoredSuiteAsset {
    StoredSuiteAsset {
        dir: asset.dir.clone(),
        manifest: asset.manifest.clone(),
    }
}

/// One demonstration, as the record carries it.
fn stored_demo(demo: &DemoFolder) -> StoredSuiteDemo {
    StoredSuiteDemo {
        dir: demo.dir.clone(),
        manifest: demo.manifest.clone(),
    }
}

#[cfg(test)]
#[path = "ingest.suites.test.rs"]
mod tests;
