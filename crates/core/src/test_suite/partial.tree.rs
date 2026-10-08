//! A whole suite tree read through the partial model.
//!
//! [`PartialSuiteTree`] is to [`SuiteVersion`] what the partial entity types are
//! to the complete ones: it holds a draft or an exported version in any state it
//! can reach. Every TOML file that parses is held as its partial entity, whatever
//! keys it leaves out, and every file that does not parse is held as
//! [`UnparsedFile`] — its raw text and where the parse failed — while the rest of
//! the tree loads around it. Nothing about a tree's contents fails a read.
//!
//! A tree converts to the complete model through
//! [`complete`](PartialSuiteTree::complete) exactly when the
//! [export rules](super::super::validate_tree) find no problem with it, which is what an
//! export and a preview produce their trees from.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::super::canonical::to_canonical_toml;
use super::super::model::SuiteManifest;
use super::super::validation::{
    SuiteDiagnostic, SuiteEntity, declaring_entity, validate_preview_tree, validate_tree,
};
use super::super::version::{
    AssetFolder, DEBUG_API_DIR, DEBUG_API_FILE, DemoFolder, PROMPTS_DIR,
    REFERENCE_IMPLEMENTATIONS_DIR, SHARED_DEMOS_DIR, SHOWCASE_DIR, SPECIFICATIONS_DIR,
    SpecificationFolder, SuiteDebugApi, SuiteShowcase, SuiteTestCaseFile, SuiteTrees, SuiteVersion,
    TEST_CASES_DIR, VALIDATORS_DIR, VERSION_MANIFEST_FILE, WORKSPACES_DIR, list_dirs, list_files,
};
use super::super::{ASSETS_DIR, DEMOS_DIR, TestSuiteError, TestSuiteResult};
use super::{
    PartialAssetManifest, PartialDebugApiModule, PartialDemoManifest, PartialShowcaseManifest,
    PartialSpecificationManifest, PartialTestCaseDefinition, PartialVersionManifest,
};

/// The file a specification folder is recognized by.
pub const SPECIFICATION_MANIFEST_FILE: &str = "specification.toml";
/// The prose a specification folder carries beside its manifest.
pub const SPECIFICATION_PROSE_FILE: &str = "specification.md";
/// The manifest an asset folder carries.
pub const ASSET_MANIFEST_FILE: &str = "asset.toml";
/// The manifest a demonstration folder carries.
pub const DEMO_MANIFEST_FILE: &str = "demo.toml";
/// The carousel of a showcase directory.
pub const SHOWCASE_MANIFEST_FILE: &str = "showcase.toml";
/// The description of a showcase directory.
pub const SHOWCASE_DESCRIPTION_FILE: &str = "showcase.md";

/// One whole suite tree — a draft or an exported version — in whatever state it is
/// in.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PartialSuiteTree {
    /// `suite.toml`, the identity of the suite the tree belongs to. Read from the
    /// suite folder rather than from the tree, so a save of the tree leaves it
    /// alone.
    pub suite: SuiteManifest,
    /// `version.toml`, or `None` when the tree holds none or holds one that does
    /// not parse.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub manifest: Option<PartialVersionManifest>,
    /// The specification folders under `specifications/`, nested as they are on
    /// disk.
    pub specifications: Vec<PartialSpecificationFolder>,
    /// The debug API, when the tree holds a `debug-api.toml` that parses.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub debug_api: Option<PartialDebugApi>,
    /// The test case definitions under `test-cases/`, one per file.
    pub test_cases: Vec<PartialTestCaseFile>,
    /// The bundled assets under `assets/`, one per folder.
    pub assets: Vec<PartialAssetFolder>,
    /// The demonstrations under `demos/`, one per folder.
    pub demos: Vec<PartialDemoFolder>,
    /// The showcase, when the tree holds a `showcase/showcase.toml` that parses.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub showcase: Option<PartialShowcase>,
    /// The trees the model references but does not hold.
    pub trees: SuiteTrees,
    /// Every TOML file the tree holds that does not parse, in the order the read
    /// found them. The entity such a file would declare is absent from the model,
    /// and a save of the model never writes over the file: its text is replaced
    /// the way prose is, byte for byte.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unparsed: Vec<UnparsedFile>,
}

/// One specification folder, read through the partial model.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PartialSpecificationFolder {
    /// The folder, relative to the suite tree.
    pub dir: String,
    /// `specification.toml`.
    pub manifest: PartialSpecificationManifest,
    /// The declared path of `specification.md`, relative to the suite tree.
    pub prose: String,
    /// The specification folders nested inside this one.
    pub children: Vec<PartialSpecificationFolder>,
}

/// The debug API tree, read through the partial model.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PartialDebugApi {
    /// `debug-api.toml`.
    pub root: PartialDebugApiModule,
    /// The module files under `debug-api/` that parse, keyed by their path
    /// relative to the suite tree.
    pub modules: BTreeMap<String, PartialDebugApiModule>,
}

/// One test case definition file, read through the partial model.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PartialTestCaseFile {
    /// The file stem, which is the definition's slug.
    pub slug: String,
    /// The definition itself.
    pub definition: PartialTestCaseDefinition,
}

/// One asset folder, read through the partial model.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PartialAssetFolder {
    /// The folder, relative to the suite tree. Its last segment is the asset's
    /// id.
    pub dir: String,
    /// `asset.toml`.
    pub manifest: PartialAssetManifest,
}

/// One demonstration folder, read through the partial model.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PartialDemoFolder {
    /// The folder, relative to the suite tree. Its last segment is the
    /// demonstration's id.
    pub dir: String,
    /// `demo.toml`.
    pub manifest: PartialDemoManifest,
}

/// The suite showcase, read through the partial model.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PartialShowcase {
    /// `showcase/showcase.toml`, the carousel.
    pub manifest: PartialShowcaseManifest,
    /// The declared path of `showcase.md`, relative to the suite tree.
    pub description: String,
    /// The media files sitting in the showcase directory, relative to the suite
    /// tree.
    pub media: Vec<String>,
}

/// A TOML file of the tree that does not parse.
///
/// Carried whole, so the file can be shown as it is and repaired in place, with
/// where the parse stopped so the repair starts at the right line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct UnparsedFile {
    /// The file, relative to the suite tree.
    pub path: String,
    /// The entity the file would declare, identified by where it sits.
    pub entity: SuiteEntity,
    /// The file's text as it is on disk. Bytes that are not UTF-8 are replaced.
    pub text: String,
    /// What the parser said.
    pub message: String,
    /// The one-based line the parse failed at, when the parser located it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub line: Option<u32>,
    /// The one-based column the parse failed at, when the parser located it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub column: Option<u32>,
}

impl PartialSpecificationFolder {
    /// The identity problems about this specification are addressed by: its `id`,
    /// or the folder that declares it while it declares none.
    pub fn identity(&self) -> String {
        self.manifest.id.clone().unwrap_or_else(|| self.dir.clone())
    }

    /// The entity this specification is.
    pub fn entity(&self) -> SuiteEntity {
        SuiteEntity::Specification(self.identity())
    }
}

impl PartialAssetFolder {
    /// The identity problems about this asset are addressed by: its `id`, or the
    /// folder name the id is required to match while it declares none.
    pub fn identity(&self) -> String {
        self.manifest
            .id
            .clone()
            .unwrap_or_else(|| folder_name(&self.dir).to_owned())
    }

    /// The entity this asset is.
    pub fn entity(&self) -> SuiteEntity {
        SuiteEntity::Asset(self.identity())
    }
}

impl PartialDemoFolder {
    /// The identity problems about this demonstration are addressed by: its `id`,
    /// or the folder name the id is required to match while it declares none.
    pub fn identity(&self) -> String {
        self.manifest
            .id
            .clone()
            .unwrap_or_else(|| folder_name(&self.dir).to_owned())
    }

    /// The entity this demonstration is.
    pub fn entity(&self) -> SuiteEntity {
        SuiteEntity::Demonstration(self.identity())
    }
}

/// The last segment of a tree-relative folder path.
fn folder_name(dir: &str) -> &str {
    dir.rsplit('/').next().unwrap_or(dir)
}

impl PartialSuiteTree {
    /// Read the suite tree at `root`, belonging to `suite`.
    ///
    /// Nothing fails the read: a file that does not parse is recorded in
    /// [`unparsed`](Self::unparsed), a required file or key that is absent is simply
    /// absent, and a folder that is not there holds nothing. What the result lacks is
    /// the [export rules](super::super::validate_tree)' to report.
    pub fn load(suite: &SuiteManifest, root: &Path) -> Self {
        Self::load_overlaid(suite, root, &BTreeMap::new())
    }

    /// [`load`](Self::load), reading each file named in `overlay` from the bytes
    /// given for it rather than from disk.
    ///
    /// What a save uses to see the tree a raw write of a TOML file would produce
    /// before a byte of it lands, so the same rules decide a raw write and a model
    /// change.
    pub fn load_overlaid(
        suite: &SuiteManifest,
        root: &Path,
        overlay: &BTreeMap<String, Vec<u8>>,
    ) -> Self {
        let staged = overlay
            .iter()
            .map(|(path, bytes)| (path.clone(), Some(bytes.clone())))
            .collect();
        Self::load_with_failures(suite, root, &staged).0
    }

    /// [`load`](Self::load), as the tree would read once every file named in
    /// `staged` held the bytes given for it, or was gone where it names `None`.
    ///
    /// Unlike [`load_overlaid`](Self::load_overlaid), a staged file needs no file on
    /// disk to be found: a folder or a file a write creates is listed as the read
    /// would list it after the write, and one it deletes is not. What a write path
    /// uses to hold the tree a list of file changes produces to the save rules before
    /// a byte of it lands.
    pub fn load_staged(
        suite: &SuiteManifest,
        root: &Path,
        staged: &BTreeMap<String, Option<Vec<u8>>>,
    ) -> Self {
        Self::load_with_failures(suite, root, staged).0
    }

    /// The read, with the failure behind each unparsed or unreadable file kept as
    /// the error it was, which is what the complete read reports.
    pub(in super::super) fn load_with_failures(
        suite: &SuiteManifest,
        root: &Path,
        overlay: &BTreeMap<String, Option<Vec<u8>>>,
    ) -> (Self, Vec<TestSuiteError>) {
        let mut reader = Reader {
            root,
            overlay,
            unparsed: Vec::new(),
            failures: Vec::new(),
        };
        let manifest = match reader.exists(VERSION_MANIFEST_FILE) {
            true => reader.read(VERSION_MANIFEST_FILE),
            false => None,
        };
        let specifications = reader.specification_folders(SPECIFICATIONS_DIR);
        let debug_api = reader.debug_api();
        let test_cases = reader.test_cases();
        let assets = reader.folders(ASSETS_DIR, ASSET_MANIFEST_FILE, |dir, manifest| {
            PartialAssetFolder { dir, manifest }
        });
        let demos = reader.folders(DEMOS_DIR, DEMO_MANIFEST_FILE, |dir, manifest| {
            PartialDemoFolder { dir, manifest }
        });
        let showcase = reader.showcase();
        let trees = SuiteTrees {
            validators: reader.files(VALIDATORS_DIR),
            reference_implementations: reader.subtrees(REFERENCE_IMPLEMENTATIONS_DIR),
            workspaces: reader.subtrees(WORKSPACES_DIR),
            prompts: reader.files(PROMPTS_DIR),
            shared_demos: reader.files(SHARED_DEMOS_DIR),
        };
        let tree = Self {
            suite: suite.clone(),
            manifest,
            specifications,
            debug_api,
            test_cases,
            assets,
            demos,
            showcase,
            trees,
            unparsed: reader.unparsed,
        };
        (tree, reader.failures)
    }

    /// Whether the TOML file at `path`, relative to the tree, is one the read could
    /// not parse.
    pub fn is_unparsed(&self, path: &str) -> bool {
        self.unparsed.iter().any(|file| file.path == path)
    }

    /// Every specification folder, nesting flattened away, in the order the folders
    /// were read.
    pub fn flat_specifications(&self) -> Vec<&PartialSpecificationFolder> {
        let mut found = Vec::new();
        flatten(&self.specifications, &mut found);
        found
    }

    /// Every TOML file this tree's model owns, as the path relative to the tree
    /// paired with the canonical text of the entity it holds.
    ///
    /// A key the model does not hold is not emitted, and an entity the model does
    /// not hold — one whose file did not parse, or a `version.toml` the tree does
    /// not have — emits no file at all, so a save of the model never writes over a
    /// file it could not read.
    pub fn canonical_files(&self) -> TestSuiteResult<Vec<(String, String)>> {
        let mut files = Vec::new();
        if let Some(manifest) = &self.manifest {
            canonical_file(&mut files, VERSION_MANIFEST_FILE.to_owned(), manifest)?;
        }
        for folder in self.flat_specifications() {
            canonical_file(
                &mut files,
                format!("{}/{SPECIFICATION_MANIFEST_FILE}", folder.dir),
                &folder.manifest,
            )?;
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

    /// The complete model of this tree, or every problem standing between the tree
    /// and it.
    ///
    /// The conversion succeeds exactly when the [export rules](validate_tree) find
    /// nothing, because the export rules are the definition of a complete suite:
    /// every required file and key is there, every reference resolves, and every
    /// invariant holds. `root` is the tree the model was read from, which the rules
    /// read to check the paths it declares.
    pub fn complete(&self, root: &Path) -> Result<SuiteVersion, Vec<SuiteDiagnostic>> {
        let problems = validate_tree(root, self);
        if !problems.is_empty() {
            return Err(problems);
        }
        self.convert()
    }

    /// The complete model of this tree as a preview, or every problem standing
    /// between the tree and it.
    ///
    /// [`complete`](Self::complete), under the rules a preview is held to
    /// ([`validate_preview_tree`]) rather than an exported version's. The tree is
    /// the one [`preview_tree`](super::super::preview_tree) restricted a draft to, and
    /// `root` is that draft's folder.
    pub fn complete_preview(&self, root: &Path) -> Result<SuiteVersion, Vec<SuiteDiagnostic>> {
        let problems = validate_preview_tree(root, self);
        if !problems.is_empty() {
            return Err(problems);
        }
        self.convert()
    }

    /// Convert every entity to the complete model, once the rules have found
    /// nothing, naming the first entity whose keys stand in the way.
    fn convert(&self) -> Result<SuiteVersion, Vec<SuiteDiagnostic>> {
        let incomplete = |entity: SuiteEntity, keys: Vec<String>| {
            vec![SuiteDiagnostic::export(
                entity,
                format!("does not convert: {} not declared", keys.join(", ")),
            )]
        };
        let manifest = match &self.manifest {
            Some(manifest) => manifest
                .complete()
                .map_err(|keys| incomplete(SuiteEntity::Suite, keys))?,
            None => {
                return Err(vec![SuiteDiagnostic::export(
                    SuiteEntity::Suite,
                    format!("`{VERSION_MANIFEST_FILE}` is missing"),
                )]);
            }
        };
        let specifications = complete_specifications(&self.specifications)
            .map_err(|(entity, keys)| incomplete(entity, keys))?;
        let debug_api = match &self.debug_api {
            None => None,
            Some(debug_api) => {
                let entity = SuiteEntity::DebugApiNode(DEBUG_API_FILE.to_owned());
                let root = debug_api
                    .root
                    .complete()
                    .map_err(|keys| incomplete(entity, keys))?;
                let mut modules = BTreeMap::new();
                for (path, module) in &debug_api.modules {
                    let complete = module.complete().map_err(|keys| {
                        incomplete(SuiteEntity::DebugApiNode(path.clone()), keys)
                    })?;
                    modules.insert(path.clone(), complete);
                }
                Some(SuiteDebugApi { root, modules })
            }
        };
        let mut test_cases = Vec::with_capacity(self.test_cases.len());
        for case in &self.test_cases {
            let definition = case
                .definition
                .complete()
                .map_err(|keys| incomplete(SuiteEntity::TestCase(case.slug.clone()), keys))?;
            test_cases.push(SuiteTestCaseFile {
                slug: case.slug.clone(),
                definition,
            });
        }
        let mut assets = Vec::with_capacity(self.assets.len());
        for asset in &self.assets {
            let manifest = asset
                .manifest
                .complete()
                .map_err(|keys| incomplete(asset.entity(), keys))?;
            assets.push(AssetFolder {
                dir: asset.dir.clone(),
                manifest,
            });
        }
        let mut demos = Vec::with_capacity(self.demos.len());
        for demo in &self.demos {
            let manifest = demo
                .manifest
                .complete()
                .map_err(|keys| incomplete(demo.entity(), keys))?;
            demos.push(DemoFolder {
                dir: demo.dir.clone(),
                manifest,
            });
        }
        let showcase = match &self.showcase {
            None => None,
            Some(showcase) => Some(SuiteShowcase {
                manifest: showcase
                    .manifest
                    .complete()
                    .map_err(|keys| incomplete(SuiteEntity::Showcase, keys))?,
                description: showcase.description.clone(),
                media: showcase.media.clone(),
            }),
        };
        Ok(SuiteVersion {
            suite: self.suite.clone(),
            manifest,
            specifications,
            debug_api,
            test_cases,
            assets,
            demos,
            showcase,
            trees: self.trees.clone(),
        })
    }
}

impl From<SuiteVersion> for PartialSuiteTree {
    fn from(version: SuiteVersion) -> Self {
        Self {
            suite: version.suite,
            manifest: Some(version.manifest.into()),
            specifications: version.specifications.into_iter().map(Into::into).collect(),
            debug_api: version.debug_api.map(|debug_api| PartialDebugApi {
                root: debug_api.root.into(),
                modules: debug_api
                    .modules
                    .into_iter()
                    .map(|(path, module)| (path, module.into()))
                    .collect(),
            }),
            test_cases: version
                .test_cases
                .into_iter()
                .map(|case| PartialTestCaseFile {
                    slug: case.slug,
                    definition: case.definition.into(),
                })
                .collect(),
            assets: version
                .assets
                .into_iter()
                .map(|asset| PartialAssetFolder {
                    dir: asset.dir,
                    manifest: asset.manifest.into(),
                })
                .collect(),
            demos: version
                .demos
                .into_iter()
                .map(|demo| PartialDemoFolder {
                    dir: demo.dir,
                    manifest: demo.manifest.into(),
                })
                .collect(),
            showcase: version.showcase.map(|showcase| PartialShowcase {
                manifest: showcase.manifest.into(),
                description: showcase.description,
                media: showcase.media,
            }),
            trees: version.trees,
            unparsed: Vec::new(),
        }
    }
}

impl From<SpecificationFolder> for PartialSpecificationFolder {
    fn from(folder: SpecificationFolder) -> Self {
        Self {
            dir: folder.dir,
            manifest: folder.manifest.into(),
            prose: folder.prose,
            children: folder.children.into_iter().map(Into::into).collect(),
        }
    }
}

/// Convert a specification tree to the complete model, or name the first
/// specification standing in the way with the keys it lacks.
fn complete_specifications(
    folders: &[PartialSpecificationFolder],
) -> Result<Vec<SpecificationFolder>, (SuiteEntity, Vec<String>)> {
    folders
        .iter()
        .map(|folder| {
            Ok(SpecificationFolder {
                dir: folder.dir.clone(),
                manifest: folder
                    .manifest
                    .complete()
                    .map_err(|keys| (folder.entity(), keys))?,
                prose: folder.prose.clone(),
                children: complete_specifications(&folder.children)?,
            })
        })
        .collect()
}

/// Collect every specification folder, including nested ones, into one flat list.
fn flatten<'a>(
    folders: &'a [PartialSpecificationFolder],
    into: &mut Vec<&'a PartialSpecificationFolder>,
) {
    for folder in folders {
        into.push(folder);
        flatten(&folder.children, into);
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

/// One read of a tree: where it is, the bytes standing in for files, and what did
/// not parse so far.
struct Reader<'a> {
    /// The tree being read.
    root: &'a Path,
    /// Bytes read in place of the file at each tree-relative path, or `None` for a
    /// file read as gone.
    overlay: &'a BTreeMap<String, Option<Vec<u8>>>,
    /// The files that did not parse.
    unparsed: Vec<UnparsedFile>,
    /// The error behind each file that did not parse or could not be read.
    failures: Vec<TestSuiteError>,
}

impl Reader<'_> {
    /// Whether the tree holds a file at `rel`, counting the overlay.
    fn exists(&self, rel: &str) -> bool {
        match self.overlay.get(rel) {
            Some(staged) => staged.is_some(),
            None => self.root.join(rel).is_file(),
        }
    }

    /// The immediate subdirectories of `rel`, counting the directories a staged
    /// file sits in.
    fn dirs(&self, rel: &str) -> Vec<String> {
        let mut names: std::collections::BTreeSet<String> =
            list_dirs(self.root, rel).into_iter().collect();
        let prefix = format!("{rel}/");
        for (path, staged) in self.overlay {
            if staged.is_none() {
                continue;
            }
            if let Some((name, _)) = path
                .strip_prefix(&prefix)
                .and_then(|inside| inside.split_once('/'))
            {
                names.insert(name.to_owned());
            }
        }
        names.into_iter().collect()
    }

    /// Every file under `rel`, recursively, counting staged files and leaving out
    /// the ones staged as gone.
    fn files(&self, rel: &str) -> Vec<String> {
        let mut found: std::collections::BTreeSet<String> =
            list_files(self.root, rel).into_iter().collect();
        let prefix = format!("{rel}/");
        for (path, staged) in self.overlay {
            if !path.starts_with(&prefix) {
                continue;
            }
            match staged {
                Some(_) => found.insert(path.clone()),
                None => found.remove(path),
            };
        }
        found.into_iter().collect()
    }

    /// The immediate subdirectories of `rel`, each mapped to the files it holds. A
    /// directory every file of which is staged as gone is gone too.
    fn subtrees(&self, rel: &str) -> BTreeMap<String, Vec<String>> {
        self.dirs(rel)
            .into_iter()
            .filter_map(|name| {
                let dir = format!("{rel}/{name}");
                let files = self.files(&dir);
                let emptied = files.is_empty() && {
                    let inside = format!("{dir}/");
                    self.overlay
                        .iter()
                        .any(|(path, staged)| staged.is_none() && path.starts_with(&inside))
                };
                (!emptied).then_some((name, files))
            })
            .collect()
    }

    /// Parse the file at `rel` into its partial model, recording it as unparsed —
    /// or as unreadable — when that fails.
    fn read<T: serde::de::DeserializeOwned>(&mut self, rel: &str) -> Option<T> {
        let bytes = match self.overlay.get(rel) {
            Some(Some(bytes)) => bytes.clone(),
            _ => match std::fs::read(self.root.join(rel)) {
                Ok(bytes) => bytes,
                Err(source) => {
                    // Recorded as unparsed with no text, so the file is still a
                    // problem against its entity and a save of the model still
                    // leaves it alone.
                    self.unparsed.push(UnparsedFile {
                        path: rel.to_owned(),
                        entity: declaring_entity(rel),
                        text: String::new(),
                        message: format!("the file could not be read: {source}"),
                        line: None,
                        column: None,
                    });
                    self.failures.push(TestSuiteError::Io {
                        path: rel.to_owned(),
                        source,
                    });
                    return None;
                }
            },
        };
        let text = String::from_utf8_lossy(&bytes).into_owned();
        let (message, line, column, failure) = match std::str::from_utf8(&bytes) {
            Ok(utf8) => match toml::from_str::<T>(utf8) {
                Ok(value) => return Some(value),
                Err(source) => {
                    let (line, column) = source
                        .span()
                        .map_or((None, None), |span| location(utf8, span.start));
                    let failure = TestSuiteError::Parse {
                        path: rel.to_owned(),
                        source: Box::new(source.clone()),
                    };
                    (source.message().to_owned(), line, column, failure)
                }
            },
            Err(error) => {
                let message = format!("the file is not UTF-8: {error}");
                let failure = TestSuiteError::Io {
                    path: rel.to_owned(),
                    source: std::io::Error::new(std::io::ErrorKind::InvalidData, message.clone()),
                };
                (message, None, None, failure)
            }
        };
        self.failures.push(failure);
        self.unparsed.push(UnparsedFile {
            path: rel.to_owned(),
            entity: declaring_entity(rel),
            text,
            message,
            line,
            column,
        });
        None
    }

    /// Collect the specification folders reachable under `dir`.
    ///
    /// A folder is a specification folder if and only if it holds a
    /// `specification.toml`, so a folder without one is transparent and the
    /// folders beneath it are lifted into its parent's list. A folder whose manifest
    /// does not parse is transparent for the same reason: the specifications nested
    /// inside it parsed perfectly well.
    fn specification_folders(&mut self, dir: &str) -> Vec<PartialSpecificationFolder> {
        let mut folders = Vec::new();
        for child in self.dirs(dir) {
            let child_dir = format!("{dir}/{child}");
            let manifest_path = format!("{child_dir}/{SPECIFICATION_MANIFEST_FILE}");
            if !self.exists(&manifest_path) {
                folders.extend(self.specification_folders(&child_dir));
                continue;
            }
            let manifest = self.read::<PartialSpecificationManifest>(&manifest_path);
            let children = self.specification_folders(&child_dir);
            match manifest {
                Some(manifest) => folders.push(PartialSpecificationFolder {
                    prose: format!("{child_dir}/{SPECIFICATION_PROSE_FILE}"),
                    dir: child_dir,
                    manifest,
                    children,
                }),
                None => folders.extend(children),
            }
        }
        folders
    }

    /// Read the debug API, or `None` when the tree holds no `debug-api.toml` that
    /// parses.
    ///
    /// Every `.toml` under `debug-api/` is read, whether or not a parent module
    /// references it: deciding that a module file is referenced by exactly one
    /// parent is a validation question.
    fn debug_api(&mut self) -> Option<PartialDebugApi> {
        if !self.exists(DEBUG_API_FILE) {
            return None;
        }
        // The root module is the tree's only entry point. Without it there is no
        // tree for the module files to hang from.
        let root = self.read::<PartialDebugApiModule>(DEBUG_API_FILE)?;
        let mut modules = BTreeMap::new();
        for path in self.files(DEBUG_API_DIR) {
            if !path.ends_with(".toml") {
                continue;
            }
            if let Some(module) = self.read::<PartialDebugApiModule>(&path) {
                modules.insert(path, module);
            }
        }
        Some(PartialDebugApi { root, modules })
    }

    /// Read every test case definition under `test-cases/`, in slug order.
    fn test_cases(&mut self) -> Vec<PartialTestCaseFile> {
        let mut cases = Vec::new();
        for path in self.files(TEST_CASES_DIR) {
            let Some(slug) = path
                .strip_prefix(&format!("{TEST_CASES_DIR}/"))
                .and_then(|name| name.strip_suffix(".toml"))
                .map(str::to_owned)
            else {
                continue;
            };
            if let Some(definition) = self.read::<PartialTestCaseDefinition>(&path) {
                cases.push(PartialTestCaseFile { slug, definition });
            }
        }
        cases
    }

    /// Read every folder under `parent` holding a `manifest` file, in folder-name
    /// order. A folder holding no manifest is not one of these entities — which is
    /// what keeps `demos/shared/` out of the demonstrations.
    fn folders<M: serde::de::DeserializeOwned, F>(
        &mut self,
        parent: &str,
        manifest: &str,
        build: impl Fn(String, M) -> F,
    ) -> Vec<F> {
        let mut found = Vec::new();
        for child in self.dirs(parent) {
            let dir = format!("{parent}/{child}");
            let path = format!("{dir}/{manifest}");
            if !self.exists(&path) {
                continue;
            }
            if let Some(parsed) = self.read::<M>(&path) {
                found.push(build(dir, parsed));
            }
        }
        found
    }

    /// Read the showcase directory, or `None` when the tree holds no
    /// `showcase.toml` that parses.
    fn showcase(&mut self) -> Option<PartialShowcase> {
        let manifest_path = format!("{SHOWCASE_DIR}/{SHOWCASE_MANIFEST_FILE}");
        if !self.exists(&manifest_path) {
            return None;
        }
        let manifest = self.read::<PartialShowcaseManifest>(&manifest_path)?;
        let description = format!("{SHOWCASE_DIR}/{SHOWCASE_DESCRIPTION_FILE}");
        let media = self
            .files(SHOWCASE_DIR)
            .into_iter()
            .filter(|path| *path != manifest_path && *path != description)
            .collect();
        Some(PartialShowcase {
            manifest,
            description,
            media,
        })
    }
}

/// The one-based line and column of a byte offset into `text`.
fn location(text: &str, offset: usize) -> (Option<u32>, Option<u32>) {
    let offset = offset.min(text.len());
    let before = text.get(..offset).unwrap_or(text);
    let line = before.matches('\n').count() + 1;
    let column = before
        .rsplit('\n')
        .next()
        .map_or(0, |current| current.chars().count())
        + 1;
    (u32::try_from(line).ok(), u32::try_from(column).ok())
}
