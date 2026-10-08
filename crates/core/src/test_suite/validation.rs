//! The export rules: every invariant the
//! [test suite format](https://docs.testcabinet.ai/test-suites/overview/) states,
//! checked over a suite tree and reported against the entity responsible for the
//! failure.
//!
//! # One pass, many problems
//!
//! [`validate_tree`] returns a list rather than stopping at the first failure, so
//! one pass tells an author everything the tree carries. Nothing here fails a load
//! or refuses a save: a draft that breaks an export rule still loads and still
//! saves, because The Spec Cabinet opens an incomplete draft in order to finish it
//! one edit at a time. The export rules are exactly what stands between a draft and
//! an export, which is why a tree [converts to the complete
//! model](super::PartialSuiteTree::complete) exactly when they find nothing.
//!
//! The pass runs over the [partial model](super::PartialSuiteTree), so a required
//! file or key that is absent, and a file that does not parse, are problems like any
//! other. [`validate`] applies the same pass to a complete model.
//!
//! # Rule classes
//!
//! Every problem names the [`SuiteRule`] it belongs to. This module produces the
//! export rules; the save rules, which refuse a change outright, are
//! [`save_problems`](super::save_problems).
//!
//! # Addressing
//!
//! Every problem names the [entity](SuiteEntity) it belongs to, by the identity the
//! format gives that entity: a specification by its `id`, a requirement by
//! `<specification id>/<requirement id>`, a validator by its module path relative to
//! `validators/`, a debug API node by the file that declares it. An entity that does
//! not declare the identity it is known by is addressed by where it sits instead: a
//! specification by its folder, an asset or a demonstration by its folder name, and
//! a requirement or a function by the specification or module declaring it. A
//! problem addressed to the wrong entity is a bug, because the address is what the
//! editing UI turns into the field it puts the user in front of.
//!
//! # What is not here
//!
//! [`validation`](crate::validation) is the automated pass over a *finished
//! implementation* — a different subject entirely. This module never looks at a
//! produced build; it looks at the authored suite that describes one.

use std::collections::BTreeMap;
use std::fmt;
use std::path::{Component, Path};

use serde::{Deserialize, Serialize};

use super::catalog::{DRAFTS_DIR, PREVIEWS_DIR, VERSIONS_DIR, is_preview_version, suite_dir_of};
use super::model::{SuiteManifest, SuiteRequirementKind, SuiteTestCaseType, VersionManifest};
use super::partial::{
    PartialSpecificationFolder, PartialSuiteTree, PartialTestCaseDefinition, PartialVersionManifest,
};
use super::save_rules::is_kebab_case;
use super::version::{
    DEBUG_API_DECLARATION_FILE, DEBUG_API_DIR, DEBUG_API_FILE, SHOWCASE_DIR, SuiteVersion,
    VALIDATORS_DIR, VERSION_MANIFEST_FILE,
};
use super::{PartialDebugApiModule, TestSuiteResult};
use crate::engine::{EngineCatalog, EngineSelection};
use crate::showcase::description_image_references;
use crate::test_case::MediaKind;
use crate::{
    MAX_SHOWCASE_DESCRIPTION_BYTES, MAX_SHOWCASE_MEDIA_ENTRIES, MAX_SHOWCASE_MEDIA_FILE_BYTES,
};

/// The Vitest configuration every validator project is rooted at.
pub(super) const VITEST_CONFIG_FILE: &str = "vitest.config.ts";

/// The entity a problem is addressed to.
///
/// One variant per entity kind the format defines, each carrying the identity
/// that kind is known by. The suite and the showcase are singular within a
/// version and carry none.
///
/// The serde form is adjacently tagged — `{ "kind": "specification", "id": … }`,
/// with the `id` absent for the two variants that carry no identity — because The
/// Spec Cabinet's API hands a problem to a frontend that turns the address into
/// the editor surface it renders the message on.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
#[serde(tag = "kind", content = "id", rename_all = "kebab-case")]
pub enum SuiteEntity {
    /// The suite tree itself: its version manifest, and the invariants that are
    /// about the tree as a whole rather than about one file inside it.
    Suite,
    /// One specification, by its `id` — or, when it declares no readable id, by the
    /// folder that declares it.
    Specification(String),
    /// One requirement of one specification.
    Requirement {
        /// The `id` of the specification declaring it.
        specification: String,
        /// The requirement's own `id`, unique within that specification.
        requirement: String,
    },
    /// One validator module, by its path relative to `validators/`.
    Validator(String),
    /// One node of the debug API tree: a module, by the path of the file
    /// declaring it, or a function, by `<module path>#<function name>`.
    DebugApiNode(String),
    /// One test case definition, by its slug, which is its file stem.
    TestCase(String),
    /// One bundled asset, by its `id` — or its folder name while it declares none.
    Asset(String),
    /// One demonstration, by its `id` — or its folder name while it declares none.
    Demonstration(String),
    /// One reference implementation, by the engine its folder is named for.
    ReferenceImplementation(String),
    /// The suite showcase.
    Showcase,
}

impl fmt::Display for SuiteEntity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Suite => write!(f, "the suite"),
            Self::Specification(id) => write!(f, "specification `{id}`"),
            Self::Requirement {
                specification,
                requirement,
            } => write!(f, "requirement `{specification}/{requirement}`"),
            Self::Validator(path) => write!(f, "validator `{path}`"),
            Self::DebugApiNode(path) => write!(f, "debug API node `{path}`"),
            Self::TestCase(slug) => write!(f, "test case `{slug}`"),
            Self::Asset(id) => write!(f, "asset `{id}`"),
            Self::Demonstration(id) => write!(f, "demonstration `{id}`"),
            Self::ReferenceImplementation(engine) => {
                write!(f, "reference implementation `{engine}`")
            }
            Self::Showcase => write!(f, "the showcase"),
        }
    }
}

/// Which set of rules a problem broke.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
#[serde(rename_all = "kebab-case")]
pub enum SuiteRule {
    /// A rule deciding whether a change can be written at all. A change breaking
    /// one is refused and nothing is written.
    Save,
    /// An invariant of a complete suite. A draft breaking one still saves and is
    /// reported; an export is refused while any is broken.
    Export,
}

/// Where in a file a problem sits, for a problem that is about one file's text.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct SuiteLocation {
    /// The file, relative to the suite tree.
    pub path: String,
    /// The one-based line, when it is known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub line: Option<u32>,
    /// The one-based column, when it is known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub column: Option<u32>,
}

/// One problem: the rule it broke, and the entity that broke it.
///
/// Serializable because every read and save response from The Spec Cabinet's API
/// carries the problems beside the model they were produced from.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct SuiteDiagnostic {
    /// Who the problem belongs to.
    pub entity: SuiteEntity,
    /// Whether the problem refuses a save or stands between a draft and an export.
    pub rule: SuiteRule,
    /// What the entity got wrong, as one sentence naming the value at fault.
    pub message: String,
    /// Where in a file the problem sits, for a file that does not parse.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub location: Option<SuiteLocation>,
}

impl SuiteDiagnostic {
    /// An export-rule problem against `entity`.
    pub fn export(entity: SuiteEntity, message: impl Into<String>) -> Self {
        Self {
            entity,
            rule: SuiteRule::Export,
            message: message.into(),
            location: None,
        }
    }

    /// A save-rule problem against `entity`.
    pub fn save(entity: SuiteEntity, message: impl Into<String>) -> Self {
        Self {
            entity,
            rule: SuiteRule::Save,
            message: message.into(),
            location: None,
        }
    }
}

impl fmt::Display for SuiteDiagnostic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.entity, self.message)
    }
}

/// Read the suite tree at `root`, belonging to `suite`, and validate it in one call.
///
/// The tree is read once, through the partial model, and the export rules run over
/// that read, so a file that does not parse and a required key that is absent are
/// problems against the entity they belong to. The complete model returned beside
/// the problems holds every entity that is complete. Only a tree whose
/// `version.toml` is absent, unparsed or incomplete fails outright: a version with
/// no identity has no complete model.
pub fn load_and_validate(
    suite: &SuiteManifest,
    root: &Path,
) -> TestSuiteResult<(SuiteVersion, Vec<SuiteDiagnostic>)> {
    let (partial, failures) = PartialSuiteTree::load_with_failures(suite, root, &BTreeMap::new());
    let problems = validate_tree(root, &partial);
    let (version, _) = SuiteVersion::from_partial(partial, failures, root)?;
    Ok((version, problems))
}

/// Every export rule, checked over one complete suite tree.
///
/// The complete model is viewed through the partial one, so a complete tree and a
/// draft are held to exactly the same rules.
pub fn validate(root: &Path, version: &SuiteVersion) -> Vec<SuiteDiagnostic> {
    validate_tree(root, &PartialSuiteTree::from(version.clone()))
}

/// Every export rule, checked over one suite tree in any state.
///
/// `root` is the suite tree the model was read from. It is needed because half the
/// invariants are about the relationship between the model and the tree: a
/// declared path exists, the slug agrees with the directory holding it, a
/// validator module on disk is claimed by a requirement.
///
/// A tree read from a preview folder, `.previews/<slug>/v0.0.0-preview.<draft>/`, is
/// held to the rules a preview is held to, as [`validate_preview_tree`] states them.
pub fn validate_tree(root: &Path, tree: &PartialSuiteTree) -> Vec<SuiteDiagnostic> {
    run(root, tree, is_preview_tree(root))
}

/// Every export rule a preview is held to, checked over one suite tree in any state.
///
/// A [preview](https://docs.testcabinet.ai/test-suites/overview/#previews)
/// holds a draft's complete test case definitions and every entity they reference,
/// and nothing else. Every rule about an entity it holds applies to it exactly as it
/// applies to an exported version. The one rule that does not is the suite-wide
/// requirement that the tree declare a reference implementation: no definition
/// references one, so a preview never holds one, and a reference implementation is
/// played from a preview by uploading its build instead.
///
/// `root` is the tree the model's declared paths are checked against, which for a
/// preview being assembled is the draft it is assembled from.
pub fn validate_preview_tree(root: &Path, tree: &PartialSuiteTree) -> Vec<SuiteDiagnostic> {
    run(root, tree, true)
}

/// Whether `root` is a preview folder: a `v0.0.0-preview.<draft>` folder of a suite
/// folder inside `.previews/`.
fn is_preview_tree(root: &Path) -> bool {
    let named = root
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(is_preview_version);
    let previews = root
        .parent()
        .and_then(Path::parent)
        .and_then(Path::file_name)
        .is_some_and(|name| name == PREVIEWS_DIR);
    named && previews
}

/// One whole pass over a tree, holding it to a preview's rules when `preview` is set.
fn run(root: &Path, tree: &PartialSuiteTree, preview: bool) -> Vec<SuiteDiagnostic> {
    let mut pass = Pass::new(root, tree, preview);
    pass.unparsed();
    pass.identity();
    pass.specifications();
    pass.validators();
    pass.test_cases();
    pass.debug_api();
    pass.assets();
    pass.demonstrations();
    pass.showcase();
    pass.reference_implementations();
    pass.diagnostics
}

/// The invariants a suite tree's identity carries, checked against the folders the
/// manifests were read from: the `suite.toml` slug is kebab-case and agrees with
/// the suite folder, an exported version's `version.toml` declares the version its
/// folder is named for, the summary is one line, and the prose the version
/// manifest names is there.
///
/// Split out of the whole-tree pass because a caller that has read nothing but the
/// two manifests — a listing that builds one entry per version from them alone —
/// asks exactly this question, and a listing entry saying a folder and its
/// manifest disagree must say it in the same words the editor does.
pub fn validate_identity(
    root: &Path,
    suite: &SuiteManifest,
    manifest: &VersionManifest,
) -> Vec<SuiteDiagnostic> {
    identity_problems(
        root,
        suite,
        Some(&PartialVersionManifest::from(manifest.clone())),
    )
}

/// [`validate_identity`] over a version manifest that may be incomplete, or absent
/// altogether.
fn identity_problems(
    root: &Path,
    suite: &SuiteManifest,
    manifest: Option<&PartialVersionManifest>,
) -> Vec<SuiteDiagnostic> {
    let mut diagnostics = Vec::new();
    let mut report = |message: String| {
        diagnostics.push(SuiteDiagnostic::export(SuiteEntity::Suite, message));
    };
    if !is_kebab_case(&suite.slug) {
        report(format!("slug `{}` is not kebab-case", suite.slug));
    }
    let folder_name = |path: &Path| {
        path.file_name()
            .map(|name| name.to_string_lossy().into_owned())
    };
    if let Some(suite_dir) = suite_dir_of(root).as_deref().and_then(folder_name)
        && suite_dir != suite.slug
    {
        report(format!(
            "slug `{}` does not match the suite folder `{suite_dir}`",
            suite.slug
        ));
    }
    let Some(manifest) = manifest else {
        return diagnostics;
    };
    for key in manifest.missing() {
        report(missing_message(&key));
    }
    // An exported version is named for the version it declares. A draft declares
    // none until export writes it, so only a tree outside `drafts/` that declares one
    // is held to its folder name.
    let group = root.parent().and_then(folder_name);
    let exported = group.as_deref() == Some(VERSIONS_DIR);
    let draft = group.as_deref() == Some(DRAFTS_DIR);
    let version_dir = folder_name(root);
    match (&manifest.version, version_dir) {
        (None, Some(version_dir)) if exported => report(format!(
            "version is not declared, and the exported version folder `{version_dir}` requires one"
        )),
        (Some(declared), Some(version_dir)) if !draft && version_dir != format!("v{declared}") => {
            report(format!(
                "version `{declared}` does not match the version folder `{version_dir}`"
            ));
        }
        _ => {}
    }
    // `summary` is a one-line abstract authored inline as plain text, so a value
    // carrying a newline is not one. Reported rather than normalized, because what
    // the abstract should say on one line is the author's call and silently
    // dropping the rest of it would be the wrong one.
    if manifest
        .summary
        .as_deref()
        .is_some_and(|summary| summary.contains('\n'))
    {
        report("summary is not a single line".to_owned());
    }
    for declared in [&manifest.description, &manifest.changelog]
        .into_iter()
        .flatten()
    {
        if !resolves_inside(declared) {
            report(format!(
                "declared path `{declared}` does not resolve inside the suite tree"
            ));
        } else if !root.join(declared).exists() {
            report(format!("declared path `{declared}` does not exist"));
        }
    }
    diagnostics
}

/// The sentence a required key that is absent is reported with.
///
/// A key is named the way the partial model's `missing` lists name it: a bare key,
/// a key of a table as `[table] key`, or a key of a repeated table as
/// `<table> <position> key`.
pub(super) fn missing_message(key: &str) -> String {
    let parts: Vec<&str> = key.split(' ').collect();
    match parts.as_slice() {
        [table, key] if table.starts_with('[') => format!("`{table}` declares no `{key}`"),
        [noun, position, rest @ ..] if !rest.is_empty() => {
            format!("{noun} {position} declares no `{}`", rest.join(" "))
        }
        _ => format!("`{key}` is not declared"),
    }
}

/// The entity a tree-relative file path declares.
///
/// A file that did not parse has no declared identity to be known by, so the
/// entity is identified by where the file sits: the folder name an asset or a
/// demonstration takes its id from, the file stem a test case definition takes
/// its slug from, and the folder a specification lives in.
pub(super) fn declaring_entity(path: &str) -> SuiteEntity {
    let segments: Vec<&str> = path.split('/').collect();
    match segments.as_slice() {
        [super::TEST_CASES_DIR, file] => match file.strip_suffix(".toml") {
            Some(slug) => SuiteEntity::TestCase(slug.to_owned()),
            None => SuiteEntity::Suite,
        },
        [super::ASSETS_DIR, id, "asset.toml"] => SuiteEntity::Asset((*id).to_owned()),
        [super::DEMOS_DIR, id, "demo.toml"] => SuiteEntity::Demonstration((*id).to_owned()),
        [SHOWCASE_DIR, "showcase.toml"] => SuiteEntity::Showcase,
        [DEBUG_API_FILE] => SuiteEntity::DebugApiNode(path.to_owned()),
        [DEBUG_API_DIR, ..] => SuiteEntity::DebugApiNode(path.to_owned()),
        [super::SPECIFICATIONS_DIR, .., "specification.toml"] => {
            let folder = path.trim_end_matches("/specification.toml");
            SuiteEntity::Specification(folder.to_owned())
        }
        _ => SuiteEntity::Suite,
    }
}

/// The entity a requirement is addressed by, and the prefix a problem about it
/// carries: the requirement itself when it declares an `id`, and otherwise the
/// specification declaring it, with the requirement named by position.
pub(super) fn requirement_address(
    folder: &PartialSpecificationFolder,
    index: usize,
    id: Option<&str>,
) -> (SuiteEntity, String) {
    match id {
        Some(id) => (
            SuiteEntity::Requirement {
                specification: folder.identity(),
                requirement: id.to_owned(),
            },
            String::new(),
        ),
        None => (folder.entity(), format!("requirement {}: ", index + 1)),
    }
}

/// The entity a debug API function is addressed by, and the prefix a problem about
/// it carries: the function itself when it declares a `name`, and otherwise the
/// module declaring it, with the function named by position.
pub(super) fn function_address(
    module: &str,
    index: usize,
    name: Option<&str>,
) -> (SuiteEntity, String) {
    match name {
        Some(name) => (
            SuiteEntity::DebugApiNode(format!("{module}#{name}")),
            String::new(),
        ),
        None => (
            SuiteEntity::DebugApiNode(module.to_owned()),
            format!("function {}: ", index + 1),
        ),
    }
}

/// One validation pass, holding what every check needs and the problems they have
/// produced so far.
struct Pass<'a> {
    /// The suite tree the model was read from.
    root: &'a Path,
    /// The model being checked.
    tree: &'a PartialSuiteTree,
    /// Every specification the tree declares, nesting flattened away, in the
    /// order the folders were read.
    specifications: Vec<&'a PartialSpecificationFolder>,
    /// The engine catalog every declared engine slug is resolved through.
    engines: EngineCatalog,
    /// Whether the tree is held to a preview's rules rather than an exported
    /// version's. See [`validate_preview_tree`].
    preview: bool,
    /// What the pass has found.
    diagnostics: Vec<SuiteDiagnostic>,
}

impl<'a> Pass<'a> {
    /// Start a pass over one suite tree.
    fn new(root: &'a Path, tree: &'a PartialSuiteTree, preview: bool) -> Self {
        Self {
            root,
            tree,
            specifications: tree.flat_specifications(),
            engines: EngineCatalog::new(),
            preview,
            diagnostics: Vec::new(),
        }
    }

    /// Record one failed invariant against one entity.
    fn report(&mut self, entity: SuiteEntity, message: impl Into<String>) {
        self.diagnostics
            .push(SuiteDiagnostic::export(entity, message));
    }

    /// Record every required key `missing` lists against `entity`, each message
    /// carrying `prefix`.
    fn missing(&mut self, entity: &SuiteEntity, prefix: &str, missing: Vec<String>) {
        for key in missing {
            self.report(entity.clone(), format!("{prefix}{}", missing_message(&key)));
        }
    }

    /// Check one path a suite file declares: it resolves inside the suite tree,
    /// and the file it names is there.
    ///
    /// `base` is the directory the path is declared relative to — the suite tree
    /// for most, the asset's own folder for an asset's files, and `validators/` for
    /// a requirement's validator modules.
    fn declared_path(&mut self, entity: SuiteEntity, base: &str, declared: &str) {
        if !resolves_inside(declared) {
            self.report(
                entity,
                format!("declared path `{declared}` does not resolve inside the suite tree"),
            );
        } else if !self.root.join(base).join(declared).exists() {
            self.report(entity, format!("declared path `{declared}` does not exist"));
        }
    }

    /// Whether the suite declares a specification with this id.
    fn declares_specification(&self, id: &str) -> bool {
        self.specifications
            .iter()
            .any(|folder| folder.manifest.id.as_deref() == Some(id))
    }

    /// Every file that does not parse is a problem against the entity it would
    /// declare, located where the parse stopped.
    fn unparsed(&mut self) {
        for file in &self.tree.unparsed {
            let mut problem = SuiteDiagnostic::export(
                file.entity.clone(),
                format!("`{}` does not parse: {}", file.path, file.message),
            );
            problem.location = Some(SuiteLocation {
                path: file.path.clone(),
                line: file.line,
                column: file.column,
            });
            self.diagnostics.push(problem);
        }
    }

    /// The suite's identity and the prose it names, checked against the folder the
    /// tree was read from, and the version manifest being there at all.
    fn identity(&mut self) {
        if self.tree.manifest.is_none() && !self.tree.is_unparsed(VERSION_MANIFEST_FILE) {
            self.report(
                SuiteEntity::Suite,
                format!("`{VERSION_MANIFEST_FILE}` is missing"),
            );
        }
        let found = identity_problems(self.root, &self.tree.suite, self.tree.manifest.as_ref());
        self.diagnostics.extend(found);
    }

    /// Every specification and every requirement inside it.
    fn specifications(&mut self) {
        let mut ids: BTreeMap<String, String> = BTreeMap::new();
        let mut seeded: BTreeMap<String, String> = BTreeMap::new();
        for folder in self.specifications.clone() {
            let manifest = &folder.manifest;
            let entity = folder.entity();
            self.missing(&entity, "", manifest.missing());
            if let Some(id) = &manifest.id {
                if !is_kebab_case(id) {
                    self.report(
                        entity.clone(),
                        format!("specification id `{id}` is not kebab-case"),
                    );
                }
                match ids.get(id) {
                    Some(first) => self.report(
                        entity.clone(),
                        format!("specification id `{id}` is already declared by `{first}`"),
                    ),
                    None => {
                        ids.insert(id.clone(), folder.dir.clone());
                    }
                }
            }
            self.declared_path(entity.clone(), "", &folder.prose);
            if let Some(path) = &manifest.path {
                self.seeded_path(&entity, &folder.identity(), path, &mut seeded);
            }
            self.requirements(folder);
        }
    }

    /// A specification's seeded output path: a Markdown file, inside `specs/`,
    /// and claimed by no other specification.
    fn seeded_path(
        &mut self,
        entity: &SuiteEntity,
        identity: &str,
        path: &str,
        seen: &mut BTreeMap<String, String>,
    ) {
        if !path.ends_with(".md") {
            self.report(
                entity.clone(),
                format!("seeded path `{path}` does not end in `.md`"),
            );
        }
        if !resolves_inside(path) {
            self.report(
                entity.clone(),
                format!("seeded path `{path}` does not stay within `specs/`"),
            );
        }
        match seen.get(path) {
            Some(first) => self.report(
                entity.clone(),
                format!("seeded path `{path}` is already declared by specification `{first}`"),
            ),
            None => {
                seen.insert(path.to_owned(), identity.to_owned());
            }
        }
    }

    /// Every requirement of one specification: its keys, its identity, the
    /// validators its kind obliges it to declare, and that each of those modules is
    /// there.
    fn requirements(&mut self, folder: &PartialSpecificationFolder) {
        let mut ids: Vec<String> = Vec::new();
        for (index, requirement) in folder.manifest.requirements.iter().enumerate() {
            let (entity, prefix) = requirement_address(folder, index, requirement.id.as_deref());
            self.missing(&entity, &prefix, requirement.missing());
            if let Some(id) = &requirement.id {
                if !is_kebab_case(id) {
                    self.report(
                        entity.clone(),
                        format!("requirement id `{id}` is not kebab-case"),
                    );
                }
                if ids.contains(id) {
                    self.report(
                        entity.clone(),
                        format!("requirement id `{id}` is declared more than once"),
                    );
                }
                ids.push(id.clone());
            }
            match requirement.kind {
                Some(SuiteRequirementKind::Functional) if requirement.validators.is_empty() => {
                    self.report(
                        entity.clone(),
                        format!("{prefix}a functional requirement declares no validator"),
                    );
                }
                Some(SuiteRequirementKind::NonFunctional) if !requirement.validators.is_empty() => {
                    self.report(
                        entity.clone(),
                        format!("{prefix}a non-functional requirement declares a validator"),
                    );
                }
                _ => {}
            }
            for validator in &requirement.validators {
                self.declared_path(entity.clone(), VALIDATORS_DIR, validator);
            }
        }
    }

    /// Each validator module path is claimed by exactly one requirement, and a
    /// suite holding validators holds the Vitest configuration that runs them.
    ///
    /// Two claims are reported against both claiming requirements, because each
    /// of them is equally the reason the module is no longer attributable to one
    /// requirement. No claim at all is reported against the module itself, which
    /// is the only entity there is to report it against.
    fn validators(&mut self) {
        let mut claims: BTreeMap<String, Vec<SuiteEntity>> = BTreeMap::new();
        for folder in self.specifications.clone() {
            for (index, requirement) in folder.manifest.requirements.iter().enumerate() {
                let (entity, _) = requirement_address(folder, index, requirement.id.as_deref());
                for validator in &requirement.validators {
                    let claimants = claims.entry(validator.clone()).or_default();
                    if !claimants.contains(&entity) {
                        claimants.push(entity.clone());
                    }
                }
            }
        }
        for (path, claimants) in &claims {
            if claimants.len() < 2 {
                continue;
            }
            for entity in claimants {
                self.report(
                    entity.clone(),
                    format!("validator `{path}` is claimed by more than one requirement"),
                );
            }
        }
        let modules = self.validator_modules();
        for module in &modules {
            if !claims.contains_key(module) {
                self.report(
                    SuiteEntity::Validator(module.clone()),
                    format!("validator `{module}` is claimed by no requirement"),
                );
            }
        }
        let config = format!("{VALIDATORS_DIR}/{VITEST_CONFIG_FILE}");
        if (!modules.is_empty() || !claims.is_empty())
            && !self.tree.trees.validators.contains(&config)
        {
            self.report(SuiteEntity::Suite, format!("`{config}` is missing"));
        }
    }

    /// The validator modules the tree holds, as paths relative to `validators/`.
    ///
    /// The Vitest project rooted there holds each validator's own test beside it,
    /// the configuration that runs them, and the generated declaration of the
    /// debug API the validators drive the implementation through. None of the
    /// three is a validator, so none of them is claimed by a requirement.
    fn validator_modules(&self) -> Vec<String> {
        self.tree
            .trees
            .validators
            .iter()
            .filter_map(|path| path.strip_prefix(&format!("{VALIDATORS_DIR}/")))
            .filter(|path| path.ends_with(".ts") && !path.ends_with(".test.ts"))
            .filter(|path| *path != VITEST_CONFIG_FILE && *path != DEBUG_API_DECLARATION_FILE)
            .map(str::to_owned)
            .collect()
    }

    /// Every test case definition: its keys, the tables its type obliges it to
    /// carry, its engines and their workspaces, and everything it names by id.
    fn test_cases(&mut self) {
        for case in &self.tree.test_cases {
            let entity = SuiteEntity::TestCase(case.slug.clone());
            let definition = &case.definition;
            self.missing(&entity, "", definition.missing());
            if let Some(init) = &definition.init
                && init.trim().is_empty()
            {
                self.report(entity.clone(), "`init` must not be empty when declared");
            }
            if let Some(test_type) = definition.test_type {
                self.type_tables(&entity, test_type, definition);
            }
            self.workspaces(&entity, definition);
            for slug in &definition.engines {
                if self
                    .engines
                    .resolve(&EngineSelection::new(slug.clone()))
                    .is_err()
                {
                    self.report(
                        entity.clone(),
                        format!("engine `{slug}` is not a known engine"),
                    );
                }
            }
            if let Some(prompt) = &definition.prompt {
                self.declared_path(entity.clone(), "", prompt);
            }
            for id in definition.specifications.iter().flatten() {
                if !self.declares_specification(id) {
                    self.report(
                        entity.clone(),
                        format!("specification `{id}` is not declared by the suite"),
                    );
                }
            }
            if let Some(asset) = targeted_asset(definition)
                && !self
                    .tree
                    .assets
                    .iter()
                    .any(|folder| folder.manifest.id.as_deref() == Some(asset))
            {
                self.report(
                    entity.clone(),
                    format!("asset `{asset}` is not declared by the suite"),
                );
            }
        }
    }

    /// A definition carries the one type table its type requires and that table
    /// alone, and a code-producing definition declares its engines and the tables
    /// that build and check what the model wrote.
    fn type_tables(
        &mut self,
        entity: &SuiteEntity,
        test_type: SuiteTestCaseType,
        definition: &PartialTestCaseDefinition,
    ) {
        let required = required_table(test_type);
        let type_name = type_name(test_type);
        for (table, present) in type_tables(definition) {
            match (Some(table) == required, present) {
                (true, false) => self.report(
                    entity.clone(),
                    format!("a `{type_name}` definition carries no `[{table}]` table"),
                ),
                (false, true) => self.report(
                    entity.clone(),
                    format!("a `{type_name}` definition carries a `[{table}]` table"),
                ),
                _ => {}
            }
        }
        if matches!(
            test_type,
            SuiteTestCaseType::EndToEnd | SuiteTestCaseType::FullStack
        ) {
            if definition.engines.is_empty() {
                self.report(
                    entity.clone(),
                    format!("a `{type_name}` definition declares no `engines`"),
                );
            }
            for (table, present) in [
                ("build", definition.build.is_some()),
                ("toolchain", definition.toolchain.is_some()),
            ] {
                if !present {
                    self.report(
                        entity.clone(),
                        format!("a `{type_name}` definition carries no `[{table}]` table"),
                    );
                }
            }
        }
    }

    /// `[workspaces]` carries an entry for every engine the definition declares,
    /// and each entry names a starter workspace that is there.
    fn workspaces(&mut self, entity: &SuiteEntity, definition: &PartialTestCaseDefinition) {
        let workspaces = definition.workspaces.clone().unwrap_or_default();
        for slug in &definition.engines {
            if !workspaces.contains_key(slug) {
                self.report(
                    entity.clone(),
                    format!("`[workspaces]` declares no entry for engine `{slug}`"),
                );
            }
        }
        for (slug, directory) in &workspaces {
            if !definition.engines.contains(slug) {
                self.report(
                    entity.clone(),
                    format!(
                        "`[workspaces]` declares an entry for engine `{slug}`, which the \
                         definition does not declare"
                    ),
                );
            }
            self.declared_path(entity.clone(), "", directory);
        }
    }

    /// The debug API: that the tree declares one exactly when it needs one, that
    /// `handle` sits on the root module alone, that every module and function
    /// declares its keys, that the module files form the tree, and that a module's
    /// function names are its own.
    fn debug_api(&mut self) {
        let drives_an_implementation = self.tree.test_cases.iter().any(|case| {
            matches!(
                case.definition.test_type,
                Some(SuiteTestCaseType::EndToEnd | SuiteTestCaseType::FullStack)
            )
        });
        let Some(debug_api) = &self.tree.debug_api else {
            // A root module that does not parse is already a problem of its own, and
            // repairing it is what makes the debug API appear.
            if drives_an_implementation && !self.tree.is_unparsed(DEBUG_API_FILE) {
                self.report(
                    SuiteEntity::Suite,
                    "the version declares an `end-to-end` or `full-stack` test case but no debug \
                     API",
                );
            }
            return;
        };
        if !drives_an_implementation {
            self.report(
                SuiteEntity::Suite,
                "the version declares a debug API but no `end-to-end` or `full-stack` test case",
            );
        }
        if debug_api.root.handle.is_none() {
            self.report(
                SuiteEntity::DebugApiNode(DEBUG_API_FILE.to_owned()),
                format!("`{DEBUG_API_FILE}` declares no `handle`"),
            );
        }
        let mut references: BTreeMap<String, Vec<SuiteEntity>> = BTreeMap::new();
        let modules: Vec<(String, &PartialDebugApiModule)> =
            std::iter::once((DEBUG_API_FILE.to_owned(), &debug_api.root))
                .chain(debug_api.modules.iter().map(|(k, v)| (k.clone(), v)))
                .collect();
        for (path, module) in modules {
            let entity = SuiteEntity::DebugApiNode(path.clone());
            self.missing(&entity, "", module.missing());
            if path != DEBUG_API_FILE && module.handle.is_some() {
                self.report(
                    entity.clone(),
                    format!("a module file under `{DEBUG_API_DIR}/` declares a `handle`"),
                );
            }
            let mut names: Vec<String> = Vec::new();
            for (index, function) in module.functions.iter().enumerate() {
                let (function_entity, prefix) =
                    function_address(&path, index, function.name.as_deref());
                self.missing(&function_entity, &prefix, function.missing());
                let Some(name) = &function.name else {
                    continue;
                };
                if names.contains(name) {
                    self.report(
                        function_entity,
                        format!("function name `{name}` is declared more than once"),
                    );
                }
                names.push(name.clone());
            }
            for (index, child) in module.modules.iter().enumerate() {
                self.missing(&entity, &format!("module {}: ", index + 1), child.missing());
                let Some(child_path) = &child.path else {
                    continue;
                };
                references
                    .entry(child_path.clone())
                    .or_default()
                    .push(entity.clone());
                self.declared_path(entity.clone(), "", child_path);
            }
        }
        for path in debug_api.modules.keys() {
            let entity = SuiteEntity::DebugApiNode(path.clone());
            let referencing = references.get(path).cloned().unwrap_or_default();
            match referencing.len() {
                1 => {}
                0 => self.report(
                    entity,
                    format!("the module file `{path}` is referenced by no parent"),
                ),
                _ => {
                    let message =
                        format!("the module file `{path}` is referenced by more than one parent");
                    // Reported against the file and against every module declaring
                    // a `[[module]]` table naming it, exactly as a validator
                    // claimed twice is reported against both claimants: each of
                    // them is equally the reason the file no longer sits in one
                    // place in the tree, and each is where the reference is edited.
                    self.report(entity, message.clone());
                    for parent in referencing {
                        self.report(parent, message.clone());
                    }
                }
            }
        }
    }

    /// Every bundled asset: its keys, its identity, its files, and the
    /// specification that describes it.
    fn assets(&mut self) {
        let mut ids: BTreeMap<String, String> = BTreeMap::new();
        for folder in &self.tree.assets {
            let manifest = &folder.manifest;
            let entity = folder.entity();
            self.missing(&entity, "", manifest.missing());
            if let Some(id) = &manifest.id {
                let name = folder.dir.rsplit('/').next().unwrap_or(&folder.dir);
                if name != id {
                    self.report(
                        entity.clone(),
                        format!("asset id `{id}` does not match its folder `{}`", folder.dir),
                    );
                }
                if !is_kebab_case(id) {
                    self.report(entity.clone(), format!("asset id `{id}` is not kebab-case"));
                }
                match ids.get(id) {
                    Some(first) => self.report(
                        entity.clone(),
                        format!("asset id `{id}` is already declared by `{first}`"),
                    ),
                    None => {
                        ids.insert(id.clone(), folder.dir.clone());
                    }
                }
            }
            if let Some(files) = &manifest.files {
                if files.is_empty() {
                    self.report(entity.clone(), "the asset declares no files");
                }
                for file in files {
                    self.declared_path(entity.clone(), &folder.dir, file);
                }
            }
            if let Some(specification) = &manifest.specification {
                self.asset_specification(&entity, specification);
            }
        }
    }

    /// An asset's specification resolves suite-wide, and every requirement it
    /// carries is non-functional, because an asset is judged by review.
    fn asset_specification(&mut self, entity: &SuiteEntity, id: &str) {
        let Some(folder) = self
            .specifications
            .iter()
            .find(|folder| folder.manifest.id.as_deref() == Some(id))
        else {
            self.report(
                entity.clone(),
                format!("specification `{id}` is not declared by the suite"),
            );
            return;
        };
        let functional = folder
            .manifest
            .requirements
            .iter()
            .any(|requirement| requirement.kind == Some(SuiteRequirementKind::Functional));
        if functional {
            self.report(
                entity.clone(),
                format!(
                    "specification `{id}` declares a functional requirement, and an asset \
                     specification declares none"
                ),
            );
        }
    }

    /// Every demonstration: its keys, its identity, and the specification whose
    /// mechanic it illustrates.
    fn demonstrations(&mut self) {
        for folder in &self.tree.demos {
            let manifest = &folder.manifest;
            let entity = folder.entity();
            self.missing(&entity, "", manifest.missing());
            if let Some(id) = &manifest.id {
                let name = folder.dir.rsplit('/').next().unwrap_or(&folder.dir);
                if name != id {
                    self.report(
                        entity.clone(),
                        format!(
                            "demonstration id `{id}` does not match its folder `{}`",
                            folder.dir
                        ),
                    );
                }
                if !is_kebab_case(id) {
                    self.report(
                        entity.clone(),
                        format!("demonstration id `{id}` is not kebab-case"),
                    );
                }
            }
            if let Some(specification) = &manifest.specification
                && !self.declares_specification(specification)
            {
                self.report(
                    entity.clone(),
                    format!("specification `{specification}` is not declared by the suite"),
                );
            }
        }
    }

    /// The showcase: the shared caps, a carousel naming files that are in the
    /// showcase directory itself, media the extension-to-kind mapping knows, and a
    /// description whose references resolve against the directory beside it.
    ///
    /// A suite showcase is authored rather than model-written, so every problem is
    /// reported here. The lenient degradation the
    /// [showcase format](https://docs.testcabinet.ai/components/core/showcase/)
    /// describes belongs to the run showcase, which is captured from a tree a
    /// model wrote.
    fn showcase(&mut self) {
        let Some(showcase) = &self.tree.showcase else {
            return;
        };
        self.missing(&SuiteEntity::Showcase, "", showcase.manifest.missing());
        self.declared_path(SuiteEntity::Showcase, "", &showcase.description);
        if let Ok(metadata) = std::fs::metadata(self.root.join(&showcase.description))
            && metadata.len() > MAX_SHOWCASE_DESCRIPTION_BYTES as u64
        {
            self.report(
                SuiteEntity::Showcase,
                format!("the showcase description exceeds {MAX_SHOWCASE_DESCRIPTION_BYTES} bytes"),
            );
        }
        let entries = showcase.manifest.media.len();
        if entries > MAX_SHOWCASE_MEDIA_ENTRIES {
            self.report(
                SuiteEntity::Showcase,
                format!(
                    "the showcase carousel declares {entries} entries, more than the \
                     {MAX_SHOWCASE_MEDIA_ENTRIES} allowed"
                ),
            );
        }
        for file in showcase
            .manifest
            .media
            .iter()
            .filter_map(|entry| entry.file.as_ref())
        {
            if !is_bare_file_name(file) {
                self.report(
                    SuiteEntity::Showcase,
                    format!("media file `{file}` is not a bare file name"),
                );
                continue;
            }
            let path = self.root.join(SHOWCASE_DIR).join(file);
            let Ok(metadata) = std::fs::metadata(&path) else {
                self.report(
                    SuiteEntity::Showcase,
                    format!("media file `{file}` is not present in the showcase directory"),
                );
                continue;
            };
            if metadata.len() > MAX_SHOWCASE_MEDIA_FILE_BYTES {
                self.report(
                    SuiteEntity::Showcase,
                    format!("media file `{file}` exceeds {MAX_SHOWCASE_MEDIA_FILE_BYTES} bytes"),
                );
            }
        }
        // Every file beside the description and the carousel is media, and a
        // showcase's media is rendered by the kind its extension names. A file the
        // mapping does not know is therefore a file no surface can present, which
        // is a problem with the directory rather than with whoever reads it.
        for path in &showcase.media {
            if MediaKind::from_path(Path::new(path)).is_none() {
                self.report(
                    SuiteEntity::Showcase,
                    format!("media file `{path}` has no media kind this format knows"),
                );
            }
        }
        // The description references media by bare relative path, resolved against
        // the showcase directory alone, so a reference with no file behind it is a
        // broken picture on the suite's landing page. The references are in the
        // prose rather than in a key, so the file is read to find them.
        let description =
            std::fs::read_to_string(self.root.join(&showcase.description)).unwrap_or_default();
        for file in description_image_references(&description) {
            if !self.root.join(SHOWCASE_DIR).join(&file).is_file() {
                self.report(
                    SuiteEntity::Showcase,
                    format!(
                        "the description references `{file}`, which is not present in the \
                         showcase directory"
                    ),
                );
            }
        }
    }

    /// A tree declares a reference implementation, and each folder under
    /// `reference-implementations/` is named for an engine its test case
    /// definitions declare.
    ///
    /// The folders are keyed by name, so naming one engine twice is not a state
    /// a read can produce and there is nothing to check for it.
    fn reference_implementations(&mut self) {
        if self.tree.trees.reference_implementations.is_empty() && !self.preview {
            self.report(
                SuiteEntity::Suite,
                "the version declares no reference implementation",
            );
        }
        let declared: Vec<&String> = self
            .tree
            .test_cases
            .iter()
            .flat_map(|case| case.definition.engines.iter())
            .collect();
        for engine in self.tree.trees.reference_implementations.keys() {
            if !declared.contains(&engine) {
                self.report(
                    SuiteEntity::ReferenceImplementation(engine.clone()),
                    format!(
                        "`{engine}` is not an engine the version's test case definitions declare"
                    ),
                );
            }
        }
    }
}

/// Whether a declared path stays inside the directory it is declared against.
///
/// Only ordinary segments are accepted: an absolute path, a `..` and a bare `.`
/// each name something outside the folder that declared it, and a suite tree is
/// self-contained.
pub(super) fn resolves_inside(declared: &str) -> bool {
    !declared.is_empty()
        && Path::new(declared)
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

/// Whether a value is a plain file name: one ordinary path segment and nothing
/// else.
fn is_bare_file_name(value: &str) -> bool {
    resolves_inside(value) && Path::new(value).components().count() == 1
}

/// Every type table the definition format defines, paired with whether this
/// definition carries it.
fn type_tables(definition: &PartialTestCaseDefinition) -> [(&'static str, bool); 6] {
    [
        ("sprite", definition.sprite.is_some()),
        ("voxel", definition.voxel.is_some()),
        ("blender", definition.blender.is_some()),
        ("particle", definition.particle.is_some()),
        ("music", definition.music.is_some()),
        ("audio-fx", definition.audio_fx.is_some()),
    ]
}

/// The table a type requires, or `None` for a type that requires none: the two
/// code-producing types, and the three the format leaves TBD.
fn required_table(test_type: SuiteTestCaseType) -> Option<&'static str> {
    match test_type {
        SuiteTestCaseType::Sprite => Some("sprite"),
        SuiteTestCaseType::Voxel => Some("voxel"),
        SuiteTestCaseType::Blender => Some("blender"),
        SuiteTestCaseType::Particle => Some("particle"),
        SuiteTestCaseType::Music => Some("music"),
        SuiteTestCaseType::AudioFx => Some("audio-fx"),
        SuiteTestCaseType::EndToEnd
        | SuiteTestCaseType::FullStack
        | SuiteTestCaseType::Performance
        | SuiteTestCaseType::Adversarial
        | SuiteTestCaseType::Puzzle => None,
    }
}

/// The asset id a definition's required type table names, for the types that
/// produce an asset and a table that declares one.
pub(super) fn targeted_asset(definition: &PartialTestCaseDefinition) -> Option<&str> {
    let id = match required_table(definition.test_type?)? {
        "sprite" => definition.sprite.as_ref()?.id.as_ref(),
        "voxel" => definition.voxel.as_ref()?.id.as_ref(),
        "blender" => definition.blender.as_ref()?.id.as_ref(),
        "particle" => definition.particle.as_ref()?.id.as_ref(),
        "music" => definition.music.as_ref()?.id.as_ref(),
        _ => definition.audio_fx.as_ref()?.id.as_ref(),
    };
    id.map(String::as_str)
}

/// A test case type's `type` value, as the definition file spells it.
fn type_name(test_type: SuiteTestCaseType) -> &'static str {
    match test_type {
        SuiteTestCaseType::EndToEnd => "end-to-end",
        SuiteTestCaseType::FullStack => "full-stack",
        SuiteTestCaseType::Sprite => "sprite",
        SuiteTestCaseType::Voxel => "voxel",
        SuiteTestCaseType::Blender => "blender",
        SuiteTestCaseType::Particle => "particle",
        SuiteTestCaseType::Music => "music",
        SuiteTestCaseType::AudioFx => "audio-fx",
        SuiteTestCaseType::Performance => "performance",
        SuiteTestCaseType::Adversarial => "adversarial",
        SuiteTestCaseType::Puzzle => "puzzle",
    }
}

#[cfg(test)]
#[path = "validation.test.rs"]
mod tests;
