//! Reading and writing a whole suite tree.
//!
//! A suite tree is the layout an exported version folder
//! (`<slug>/versions/v<major>.<minor>.<patch>/`) and a draft folder
//! (`<slug>/drafts/<draft>/`) both hold, and it is self-contained: every path a
//! file inside it names resolves within it. The suite's identity is declared once
//! beside the trees, in `<slug>/suite.toml`, so a read takes that manifest and a
//! tree path and produces one [`SuiteVersion`] holding every entity the tree
//! declares plus the paths of the trees that are not TOML. Where a tree sits, and
//! so which `suite.toml` it belongs to, is the [catalog](super::catalog)'s to say. A save writes every
//! one of those entities back through the
//! [canonical emitter](super::to_canonical_toml) and leaves everything else —
//! the Markdown prose, the validator project, the workspaces, the reference
//! implementations — exactly as it found them.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::canonical::to_canonical_toml;
use super::model::{
    AssetManifest, DebugApiModule, DemoManifest, ShowcaseManifest, SpecificationManifest,
    SuiteManifest, SuiteTestCaseDefinition, VersionManifest,
};
use super::partial::{
    ASSET_MANIFEST_FILE, DEMO_MANIFEST_FILE, PartialSpecificationFolder, PartialSuiteTree,
    SHOWCASE_MANIFEST_FILE, SPECIFICATION_MANIFEST_FILE,
};
use super::{TestSuiteError, TestSuiteResult};

/// The suite manifest, at the root of the suite folder.
pub const SUITE_MANIFEST_FILE: &str = "suite.toml";
/// The version manifest, at the root of a suite tree.
pub const VERSION_MANIFEST_FILE: &str = "version.toml";
/// The root debug API module, at the root of the version folder.
pub const DEBUG_API_FILE: &str = "debug-api.toml";
/// The directory holding one file per non-root debug API module.
pub const DEBUG_API_DIR: &str = "debug-api";
/// The directory specification folders live under.
pub const SPECIFICATIONS_DIR: &str = "specifications";
/// The directory holding one test case definition per file.
pub const TEST_CASES_DIR: &str = "test-cases";
/// The directory holding one folder per bundled asset.
pub const ASSETS_DIR: &str = "assets";
/// The directory holding the shared demonstration library and one folder per
/// demonstration.
pub const DEMOS_DIR: &str = "demos";
/// The TypeScript library the demonstrations depend on.
pub const SHARED_DEMOS_DIR: &str = "demos/shared";
/// The showcase directory: the player-facing prose, the carousel, and its media.
pub const SHOWCASE_DIR: &str = "showcase";
/// The Vitest project holding the validators and their own tests.
pub const VALIDATORS_DIR: &str = "validators";
/// The validator-facing TypeScript declaration of the debug API tree, inside
/// [`VALIDATORS_DIR`].
///
/// Derived output rather than an authored module: The Spec Cabinet assembles it
/// from the debug API files, which is why a validator imports it as `../debug-api`
/// and why it is no more a validator than the Vitest configuration beside it.
pub const DEBUG_API_DECLARATION_FILE: &str = "debug-api.ts";
/// The directory holding one complete buildable project per engine.
pub const REFERENCE_IMPLEMENTATIONS_DIR: &str = "reference-implementations";
/// The directory holding the starter workspaces runs are seeded with.
pub const WORKSPACES_DIR: &str = "workspaces";
/// The directory holding the Handlebars prompt templates.
pub const PROMPTS_DIR: &str = "prompts";

/// One whole suite tree: the suite it belongs to, every entity the tree declares,
/// and the paths of the trees that hold no TOML.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct SuiteVersion {
    /// `suite.toml`: the identity of the suite this tree belongs to. It is read from
    /// the suite folder rather than from the tree, so a save of the tree leaves it
    /// alone.
    pub suite: SuiteManifest,
    /// `version.toml`: the version's identity and the prose describing it.
    pub manifest: VersionManifest,
    /// The specification folders under `specifications/`, nested as they are on
    /// disk.
    pub specifications: Vec<SpecificationFolder>,
    /// The debug API, when the version declares one. A version declaring no test
    /// case whose subject is a model-written build declares none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub debug_api: Option<SuiteDebugApi>,
    /// The test case definitions under `test-cases/`, one per file.
    pub test_cases: Vec<SuiteTestCaseFile>,
    /// The bundled assets under `assets/`, one per folder.
    pub assets: Vec<AssetFolder>,
    /// The demonstrations under `demos/`, one per folder.
    pub demos: Vec<DemoFolder>,
    /// The showcase, when the version holds one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub showcase: Option<SuiteShowcase>,
    /// The trees the model references but does not hold.
    pub trees: SuiteTrees,
}

/// One specification folder: its manifest, the prose beside it, and the
/// specification folders nested inside it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct SpecificationFolder {
    /// The folder, relative to the suite tree.
    pub dir: String,
    /// `specification.toml`.
    pub manifest: SpecificationManifest,
    /// The declared path of `specification.md`, relative to the suite tree.
    /// The prose itself is referenced rather than held, and a save leaves its
    /// bytes alone.
    pub prose: String,
    /// The specification folders nested inside this one. Specification folders
    /// nest freely.
    pub children: Vec<SpecificationFolder>,
}

/// The debug API tree: the root module and every module file the version holds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct SuiteDebugApi {
    /// `debug-api.toml`, the only module declaring a `handle`.
    pub root: DebugApiModule,
    /// The module files under `debug-api/`, keyed by their path relative to the
    /// version folder — which is exactly the string a parent's `[[module]]`
    /// table names.
    pub modules: BTreeMap<String, DebugApiModule>,
}

/// One test case definition file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct SuiteTestCaseFile {
    /// The file stem, which is the definition's slug.
    pub slug: String,
    /// The definition itself.
    pub definition: SuiteTestCaseDefinition,
}

/// One asset folder.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct AssetFolder {
    /// The folder, relative to the suite tree. Its last segment is the
    /// asset's id.
    pub dir: String,
    /// `asset.toml`.
    pub manifest: AssetManifest,
}

/// One demonstration folder.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct DemoFolder {
    /// The folder, relative to the suite tree.
    pub dir: String,
    /// `demo.toml`.
    pub manifest: DemoManifest,
}

/// The suite showcase: the carousel, and the declared path of the prose beside
/// it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct SuiteShowcase {
    /// `showcase/showcase.toml`, the carousel.
    pub manifest: ShowcaseManifest,
    /// The declared path of `showcase.md`, relative to the suite tree.
    pub description: String,
    /// The media files sitting in the showcase directory, relative to the version
    /// folder.
    pub media: Vec<String>,
}

/// The paths of the trees a version folder holds that are not TOML entities.
///
/// They are recorded rather than parsed: what a reader needs from them is which
/// files are there, and the files themselves belong to the toolchains that
/// consume them.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct SuiteTrees {
    /// Every file under `validators/`, relative to the suite tree. The Vitest
    /// project rooted there holds the validator modules and their own tests.
    pub validators: Vec<String>,
    /// The reference implementations, keyed by the engine folder name under
    /// `reference-implementations/`, each holding that project's files relative
    /// to the suite tree.
    pub reference_implementations: BTreeMap<String, Vec<String>>,
    /// The starter workspaces, keyed by the workspace slug under `workspaces/`,
    /// each holding that workspace's files relative to the suite tree.
    pub workspaces: BTreeMap<String, Vec<String>>,
    /// Every file under `prompts/`, relative to the suite tree.
    pub prompts: Vec<String>,
    /// Every file under `demos/shared/`, the TypeScript library the
    /// demonstrations depend on, relative to the suite tree.
    pub shared_demos: Vec<String>,
}

/// Read a suite folder's `suite.toml` alone.
pub fn load_suite_manifest(suite_dir: &Path) -> TestSuiteResult<SuiteManifest> {
    read_toml(suite_dir, SUITE_MANIFEST_FILE)
}

/// Read a suite tree's `version.toml` alone.
///
/// The whole-tree read is the expensive one: it walks every tree the folder
/// holds. A caller that only needs the version's identity and the prose it names
/// — a listing that builds one entry per exported version — reads the manifests
/// and nothing else.
pub fn load_version_manifest(root: &Path) -> TestSuiteResult<VersionManifest> {
    read_toml(root, VERSION_MANIFEST_FILE)
}

impl SuiteVersion {
    /// Read the suite tree at `root`, belonging to `suite`, refusing one that holds
    /// a file it could not read.
    ///
    /// The strict half of `load_tolerant` below, for a caller a partly-read
    /// suite is no use to: a catalog listing what a deployment can run would
    /// rather name the broken file than serve a version with a specification
    /// silently missing from it. The Spec Cabinet wants the opposite, because it
    /// opens a suite in order to repair it.
    pub fn load(suite: &SuiteManifest, root: &Path) -> TestSuiteResult<Self> {
        let (version, failures) = Self::load_tolerant(suite, root)?;
        match failures.into_iter().next() {
            Some(failure) => Err(failure),
            None => Ok(version),
        }
    }

    /// Read the suite tree at `root`, belonging to `suite`, keeping every entity
    /// that is complete and reporting every file that is not.
    ///
    /// The tree is read through the [partial model](PartialSuiteTree) and each
    /// entity converted to the complete one. A file that cannot be read or parsed,
    /// or that leaves a required key out, is a failure for that file alone: the
    /// entity it declares is absent from the returned model and the error naming it
    /// is returned beside it, so the reader can say which file broke the suite.
    ///
    /// `version.toml` is the one exception. It carries the version's identity, and
    /// a version with no identity is not a thing a complete model can describe, so
    /// a tree whose `version.toml` is absent, unparsed or incomplete fails the whole
    /// read.
    ///
    /// Nothing else is checked here, because whether the result is a *valid*
    /// suite is a separate question from whether it parsed. That question is
    /// answered by [`validate`](super::validate).
    pub(super) fn load_tolerant(
        suite: &SuiteManifest,
        root: &Path,
    ) -> TestSuiteResult<(Self, Vec<TestSuiteError>)> {
        let (partial, failures) =
            PartialSuiteTree::load_with_failures(suite, root, &BTreeMap::new());
        Self::from_partial(partial, failures, root)
    }

    /// The complete model of a tree already read through the partial one, keeping
    /// every entity that is complete and adding a failure for every one that is not
    /// to the `failures` the read produced. See
    /// [`load_tolerant`](Self::load_tolerant).
    pub(super) fn from_partial(
        partial: PartialSuiteTree,
        mut failures: Vec<TestSuiteError>,
        root: &Path,
    ) -> TestSuiteResult<(Self, Vec<TestSuiteError>)> {
        let manifest = match &partial.manifest {
            Some(manifest) => manifest
                .complete()
                .map_err(|keys| TestSuiteError::Incomplete {
                    path: VERSION_MANIFEST_FILE.to_owned(),
                    keys,
                })?,
            None => {
                let position = failures.iter().position(|failure| {
                    matches!(failure, TestSuiteError::Parse { path, .. } | TestSuiteError::Io { path, .. } if path == VERSION_MANIFEST_FILE)
                });
                return Err(match position {
                    Some(position) => failures.swap_remove(position),
                    None => TestSuiteError::Io {
                        path: root.join(VERSION_MANIFEST_FILE).display().to_string(),
                        source: std::io::Error::new(
                            std::io::ErrorKind::NotFound,
                            "the suite tree holds no version manifest",
                        ),
                    },
                });
            }
        };
        let mut incomplete = |path: String, keys: Vec<String>| {
            failures.push(TestSuiteError::Incomplete { path, keys });
        };
        let specifications = complete_folders(partial.specifications, &mut incomplete);
        let debug_api = partial.debug_api.and_then(|debug_api| {
            let root_module = match debug_api.root.complete() {
                Ok(module) => module,
                Err(keys) => {
                    incomplete(DEBUG_API_FILE.to_owned(), keys);
                    return None;
                }
            };
            let mut modules = BTreeMap::new();
            for (path, module) in debug_api.modules {
                match module.complete() {
                    Ok(module) => {
                        modules.insert(path, module);
                    }
                    Err(keys) => incomplete(path, keys),
                }
            }
            Some(SuiteDebugApi {
                root: root_module,
                modules,
            })
        });
        let mut test_cases = Vec::new();
        for case in partial.test_cases {
            match case.definition.complete() {
                Ok(definition) => test_cases.push(SuiteTestCaseFile {
                    slug: case.slug,
                    definition,
                }),
                Err(keys) => incomplete(format!("{TEST_CASES_DIR}/{}.toml", case.slug), keys),
            }
        }
        let mut assets = Vec::new();
        for asset in partial.assets {
            match asset.manifest.complete() {
                Ok(manifest) => assets.push(AssetFolder {
                    dir: asset.dir,
                    manifest,
                }),
                Err(keys) => incomplete(format!("{}/{ASSET_MANIFEST_FILE}", asset.dir), keys),
            }
        }
        let mut demos = Vec::new();
        for demo in partial.demos {
            match demo.manifest.complete() {
                Ok(manifest) => demos.push(DemoFolder {
                    dir: demo.dir,
                    manifest,
                }),
                Err(keys) => incomplete(format!("{}/{DEMO_MANIFEST_FILE}", demo.dir), keys),
            }
        }
        let showcase = partial
            .showcase
            .and_then(|showcase| match showcase.manifest.complete() {
                Ok(manifest) => Some(SuiteShowcase {
                    manifest,
                    description: showcase.description,
                    media: showcase.media,
                }),
                Err(keys) => {
                    incomplete(format!("{SHOWCASE_DIR}/{SHOWCASE_MANIFEST_FILE}"), keys);
                    None
                }
            });
        Ok((
            Self {
                suite: partial.suite.clone(),
                manifest,
                specifications,
                debug_api,
                test_cases,
                assets,
                demos,
                showcase,
                trees: partial.trees,
            },
            failures,
        ))
    }

    /// Write every entity of this tree back into `root` through the canonical
    /// emitter.
    ///
    /// Only the TOML files inside the tree are written, so `suite.toml` is not. The Markdown prose, the media, the
    /// validator project, the workspaces and the reference implementations are
    /// left untouched, so a save can never disturb a byte it did not model.
    pub fn save(&self, root: &Path) -> TestSuiteResult<()> {
        for (rel, text) in self.canonical_files()? {
            let path = root.join(&rel);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|source| TestSuiteError::Io {
                    path: parent.display().to_string(),
                    source,
                })?;
            }
            std::fs::write(&path, text).map_err(|source| TestSuiteError::Io {
                path: path.display().to_string(),
                source,
            })?;
        }
        Ok(())
    }

    /// Every TOML file this version owns, as the path relative to the version
    /// folder paired with the canonical text of the entity it holds.
    ///
    /// The bytes are a function of the model alone, which is what makes a save a
    /// whole-file rewrite rather than a patch: the same suite state produces the
    /// same files however the edit that produced it was reached. Handing the
    /// caller the pairs rather than writing them is what lets a caller that needs
    /// to write atomically — The Spec Cabinet's save path — do its own writing
    /// without reimplementing the emitter's file layout.
    pub fn canonical_files(&self) -> TestSuiteResult<Vec<(String, String)>> {
        let mut files = Vec::new();
        canonical_file(&mut files, VERSION_MANIFEST_FILE.to_owned(), &self.manifest)?;
        for folder in &self.specifications {
            folder.canonical_files(&mut files)?;
        }
        if let Some(debug_api) = &self.debug_api {
            canonical_file(&mut files, DEBUG_API_FILE.to_owned(), &debug_api.root)?;
            for (path, module) in &debug_api.modules {
                canonical_file(&mut files, path.clone(), module)?;
            }
        }
        for case in &self.test_cases {
            canonical_file(
                &mut files,
                format!("{TEST_CASES_DIR}/{}.toml", case.slug),
                &case.definition,
            )?;
        }
        for asset in &self.assets {
            canonical_file(
                &mut files,
                format!("{}/{ASSET_MANIFEST_FILE}", asset.dir),
                &asset.manifest,
            )?;
        }
        for demo in &self.demos {
            canonical_file(
                &mut files,
                format!("{}/{DEMO_MANIFEST_FILE}", demo.dir),
                &demo.manifest,
            )?;
        }
        if let Some(showcase) = &self.showcase {
            canonical_file(
                &mut files,
                format!("{SHOWCASE_DIR}/{SHOWCASE_MANIFEST_FILE}"),
                &showcase.manifest,
            )?;
        }
        Ok(files)
    }
}

impl SpecificationFolder {
    /// Emit this specification's manifest and then every specification nested
    /// inside it.
    fn canonical_files(&self, files: &mut Vec<(String, String)>) -> TestSuiteResult<()> {
        canonical_file(
            files,
            format!("{}/{SPECIFICATION_MANIFEST_FILE}", self.dir),
            &self.manifest,
        )?;
        for child in &self.children {
            child.canonical_files(files)?;
        }
        Ok(())
    }
}

/// Serialize one model through the canonical emitter and push it onto the file
/// list, naming the file it was destined for on failure.
fn canonical_file<T: Serialize + ?Sized>(
    files: &mut Vec<(String, String)>,
    rel: String,
    value: &T,
) -> TestSuiteResult<()> {
    let text = to_canonical_toml(value).map_err(|source| TestSuiteError::Serialize {
        path: rel.clone(),
        source: Box::new(source),
    })?;
    files.push((rel, text));
    Ok(())
}

/// Convert a specification tree to the complete model, keeping every folder whose
/// manifest is complete.
///
/// A folder whose manifest is not complete is transparent, exactly as one whose
/// manifest does not parse is: the specifications nested inside it are lifted into
/// the list its parent gets, because they are complete in their own right.
fn complete_folders(
    folders: Vec<PartialSpecificationFolder>,
    incomplete: &mut impl FnMut(String, Vec<String>),
) -> Vec<SpecificationFolder> {
    let mut complete = Vec::new();
    for folder in folders {
        let children = complete_folders(folder.children, incomplete);
        match folder.manifest.complete() {
            Ok(manifest) => complete.push(SpecificationFolder {
                dir: folder.dir,
                manifest,
                prose: folder.prose,
                children,
            }),
            Err(keys) => {
                incomplete(
                    format!("{}/{SPECIFICATION_MANIFEST_FILE}", folder.dir),
                    keys,
                );
                complete.extend(children);
            }
        }
    }
    complete
}

/// Parse one TOML file into its model, naming the file on either failure.
fn read_toml<T: serde::de::DeserializeOwned>(root: &Path, rel: &str) -> TestSuiteResult<T> {
    let path = root.join(rel);
    let text = std::fs::read_to_string(&path).map_err(|source| TestSuiteError::Io {
        path: path.display().to_string(),
        source,
    })?;
    toml::from_str(&text).map_err(|source| TestSuiteError::Parse {
        path: rel.to_owned(),
        source: Box::new(source),
    })
}

/// The immediate subdirectory names of `rel`, sorted. An absent directory has
/// none.
pub(super) fn list_dirs(root: &Path, rel: &str) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(root.join(rel)) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    names.sort();
    names
}

/// Every file under `rel`, recursively, as version-folder-relative paths in
/// sorted order. An absent directory has none.
pub(super) fn list_files(root: &Path, rel: &str) -> Vec<String> {
    let mut found = Vec::new();
    collect_files(root, &root.join(rel), &mut found);
    found.sort();
    found
}

/// Walk `dir`, pushing each file it holds as a path relative to `root`.
fn collect_files(root: &Path, dir: &PathBuf, found: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files(root, &path, found);
        } else if let Ok(relative) = path.strip_prefix(root) {
            found.push(relative.to_string_lossy().replace('\\', "/"));
        }
    }
}

#[cfg(test)]
#[path = "version.test.rs"]
mod tests;
