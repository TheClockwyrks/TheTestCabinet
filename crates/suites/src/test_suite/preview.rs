//! Previews: the part of a draft that runs before the draft is complete.
//!
//! [Previews](https://docs.testcabinet.ai/test-suites/overview/#previews)
//! is authoritative. A test case definition is complete when neither it nor any
//! entity it references carries a problem, and a preview holds a draft's complete
//! definitions and every entity they reference. The references of a definition are:
//!
//! - its prompt;
//! - the workspaces its `[workspaces]` map names;
//! - the specifications it covers — every one the suite declares while it names none
//!   — and the validators their requirements claim;
//! - the debug API, when its type is code-producing;
//! - the asset its type table names, or every asset for `end-to-end`.
//!
//! An asset names the specification describing it, so a specification an asset
//! the preview holds names is held with it.
//!
//! This module answers the three questions a preview asks of a draft, over the
//! [partial model](PartialSuiteTree) and without writing anything:
//!
//! - which definitions are complete, and what holds back each one that is not
//!   ([`preview_completeness_with`], against the engines a definition's declared
//!   slugs are checked against; `test_cabinet_core::test_suite::preview_completeness`
//!   is its form over the built-in engines);
//! - the tree a preview of some definitions is, restricted to those definitions and
//!   what they reference ([`preview_tree`]), which converts to the complete model
//!   through [`PartialSuiteTree::complete_preview_with`];
//! - the files beside that model's TOML that the preview copies from the draft
//!   ([`preview_files`]).
//!
//! A definition's problems are the draft's problems addressed to the definition or
//! to an entity it references, together with every problem the tree restricted to it
//! carries. The second half is what attributes a problem addressed to the suite
//! itself — a version manifest missing a key, a validator project with no Vitest
//! configuration — to exactly the definitions it stands in the way of, and it is
//! what makes a complete definition one whose preview validates.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use super::PREVIEW_VERSION_PREFIX;
use super::SuiteTestCaseType;
use super::{
    ASSET_MANIFEST_FILE, PartialAssetFolder, PartialSpecificationFolder, PartialSuiteTree,
    PartialVersionManifest, SPECIFICATION_MANIFEST_FILE,
};
use super::{DEBUG_API_DECLARATION_FILE, SuiteTrees, VALIDATORS_DIR, WORKSPACES_DIR};
use super::{
    SuiteDiagnostic, SuiteEntity, VITEST_CONFIG_FILE, targeted_asset, validate_preview_tree_with,
};
use crate::engine::EngineLookup;

/// The directory no preview copies: what a package manager installed is not
/// authored, and it is reinstalled wherever the preview is built.
const INSTALLED_DEPENDENCIES_DIR: &str = "node_modules";

/// The version a preview of `draft` declares in its `version.toml`:
/// `0.0.0-preview.<draft>`.
pub fn preview_version(draft: &str) -> String {
    format!("{}{draft}", &PREVIEW_VERSION_PREFIX[1..])
}

/// The folder a preview of `draft` is written to beside its suite manifest copy:
/// `v0.0.0-preview.<draft>`.
pub fn preview_folder(draft: &str) -> String {
    format!("{PREVIEW_VERSION_PREFIX}{draft}")
}

/// Whether one test case definition of a draft is complete, and what holds it back
/// when it is not.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DefinitionCompleteness {
    /// The definition's slug, its file stem.
    pub definition: String,
    /// Every problem addressed to the definition or to an entity it references,
    /// and every problem the preview restricted to it would carry. Empty for a
    /// complete definition.
    pub problems: Vec<SuiteDiagnostic>,
}

impl DefinitionCompleteness {
    /// Whether the definition is complete.
    pub fn is_complete(&self) -> bool {
        self.problems.is_empty()
    }
}

/// Whether each test case definition of the draft `tree` is complete, in slug order.
///
/// `root` is the draft's folder, `diagnostics` every problem the export rules found
/// in it, `draft` its name, and `engines` the engines a declared engine slug is
/// checked against. A definition file that does not parse is listed too,
/// incomplete, with its parse problem.
pub fn preview_completeness_with(
    root: &Path,
    tree: &PartialSuiteTree,
    diagnostics: &[SuiteDiagnostic],
    draft: &str,
    engines: &dyn EngineLookup,
) -> Vec<DefinitionCompleteness> {
    let mut slugs: BTreeSet<String> = tree
        .test_cases
        .iter()
        .map(|case| case.slug.clone())
        .collect();
    slugs.extend(tree.unparsed.iter().filter_map(|file| match &file.entity {
        SuiteEntity::TestCase(slug) => Some(slug.clone()),
        _ => None,
    }));
    slugs
        .into_iter()
        .map(|definition| {
            let references = References::of(tree, std::slice::from_ref(&definition));
            let mut problems: Vec<SuiteDiagnostic> = diagnostics
                .iter()
                .filter(|problem| references.includes(&problem.entity))
                .cloned()
                .collect();
            let restricted = references.restrict(tree, draft);
            for problem in validate_preview_tree_with(root, &restricted, engines) {
                if !problems.contains(&problem) {
                    problems.push(problem);
                }
            }
            DefinitionCompleteness {
                definition,
                problems,
            }
        })
        .collect()
}

/// The preview of `definitions` from the draft `tree`: those definitions and every
/// entity they reference, and nothing else, with the version manifest declaring the
/// preview version of `draft` and `experimental = true`.
///
/// What it holds and nothing more is what [`preview_files`] copies and what the
/// complete model it converts to writes, so the tree validated is the tree written.
pub fn preview_tree(
    tree: &PartialSuiteTree,
    definitions: &[String],
    draft: &str,
) -> PartialSuiteTree {
    References::of(tree, definitions).restrict(tree, draft)
}

/// Every file of a preview `tree` that its model does not write, as a path relative
/// to the draft folder `root` it is copied from, sorted.
///
/// The version manifest's prose, each specification's files, the validator project
/// files the tree holds, each definition's prompt and starter workspaces, and each
/// asset's files. The TOML each of those entities is declared by is written from the
/// complete model instead, and what a package manager installed is never copied.
pub fn preview_files(root: &Path, tree: &PartialSuiteTree) -> Vec<String> {
    let mut found = BTreeSet::new();
    let file = |relative: &str, found: &mut BTreeSet<String>| {
        if root.join(relative).is_file() {
            found.insert(relative.to_owned());
        }
    };
    if let Some(manifest) = &tree.manifest {
        for declared in [&manifest.description, &manifest.changelog]
            .into_iter()
            .flatten()
        {
            file(declared, &mut found);
        }
    }
    for folder in tree.flat_specifications() {
        walk(
            root,
            &folder.dir,
            Some(SPECIFICATION_MANIFEST_FILE),
            &mut found,
        );
    }
    for validator in &tree.trees.validators {
        file(validator, &mut found);
    }
    for case in &tree.test_cases {
        if let Some(prompt) = &case.definition.prompt {
            file(prompt, &mut found);
        }
        for directory in case.definition.workspaces.iter().flat_map(BTreeMap::values) {
            walk(root, directory.trim_end_matches('/'), None, &mut found);
        }
    }
    for asset in &tree.assets {
        walk(root, &asset.dir, Some(ASSET_MANIFEST_FILE), &mut found);
    }
    found.into_iter().collect()
}

/// Collect every file under `dir`, relative to `root`, into `found`.
///
/// `manifest` names the file an entity's folder is declared by. The one at the top
/// of `dir` is left out, because the model writes it, and a folder beneath `dir`
/// holding one is another entity of the same kind — a nested specification — and is
/// left out whole. What a package manager installed is never walked into.
fn walk(root: &Path, dir: &str, manifest: Option<&str>, found: &mut BTreeSet<String>) {
    walk_below(root, dir, manifest, true, found);
}

/// [`walk`], leaving out the manifest file only when `top` is set: below an entity's
/// own folder, a file named like its manifest is an ordinary file of the entity.
fn walk_below(
    root: &Path,
    dir: &str,
    manifest: Option<&str>,
    top: bool,
    found: &mut BTreeSet<String>,
) {
    let Ok(entries) = std::fs::read_dir(root.join(dir)) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let relative = format!("{dir}/{name}");
        let path = entry.path();
        if path.is_dir() {
            let nested = manifest.is_some_and(|manifest| path.join(manifest).is_file());
            if name != INSTALLED_DEPENDENCIES_DIR && !nested {
                walk_below(root, &relative, manifest, false, found);
            }
        } else if !(top && manifest == Some(name.as_str())) {
            found.insert(relative);
        }
    }
}

/// What a set of definitions references in one draft.
#[derive(Debug, Default)]
struct References {
    /// The definitions themselves, by slug.
    definitions: BTreeSet<String>,
    /// Whether a definition covers every specification, by naming none.
    all_specifications: bool,
    /// The identities of the specifications held, when not every one is.
    specifications: BTreeSet<String>,
    /// Whether an `end-to-end` definition references every asset.
    all_assets: bool,
    /// The ids of the assets held, when not every one is.
    assets: BTreeSet<String>,
    /// Whether a code-producing definition references the debug API.
    debug_api: bool,
    /// The validator module paths, relative to `validators/`, the held
    /// specifications' requirements claim.
    validators: BTreeSet<String>,
}

impl References {
    /// Everything `definitions` reference in `tree`.
    fn of(tree: &PartialSuiteTree, definitions: &[String]) -> Self {
        let mut references = Self {
            definitions: definitions.iter().cloned().collect(),
            ..Self::default()
        };
        let mut specification_ids = BTreeSet::new();
        for case in tree
            .test_cases
            .iter()
            .filter(|case| references.definitions.contains(&case.slug))
        {
            let definition = &case.definition;
            match definition.test_type {
                Some(SuiteTestCaseType::EndToEnd) => {
                    references.debug_api = true;
                    references.all_assets = true;
                }
                Some(SuiteTestCaseType::FullStack) => references.debug_api = true,
                _ => {
                    if let Some(id) = targeted_asset(definition) {
                        references.assets.insert(id.to_owned());
                    }
                }
            }
            match &definition.specifications {
                None => references.all_specifications = true,
                Some(ids) => specification_ids.extend(ids.iter().cloned()),
            }
        }
        for asset in tree
            .assets
            .iter()
            .filter(|asset| references.holds_asset(asset))
        {
            if let Some(specification) = &asset.manifest.specification {
                specification_ids.insert(specification.clone());
            }
        }
        for folder in tree.flat_specifications() {
            let held = references.all_specifications
                || folder
                    .manifest
                    .id
                    .as_ref()
                    .is_some_and(|id| specification_ids.contains(id));
            if held {
                references.specifications.insert(folder.identity());
                for requirement in &folder.manifest.requirements {
                    references
                        .validators
                        .extend(requirement.validators.iter().cloned());
                }
            }
        }
        references
    }

    /// Whether a problem addressed to `entity` stands in the way of these
    /// definitions.
    fn includes(&self, entity: &SuiteEntity) -> bool {
        match entity {
            SuiteEntity::TestCase(slug) => self.definitions.contains(slug),
            SuiteEntity::Specification(identity) => self.holds_specification(identity),
            SuiteEntity::Requirement { specification, .. } => {
                self.holds_specification(specification)
            }
            SuiteEntity::Validator(path) => self.validators.contains(path),
            SuiteEntity::DebugApiNode(_) => self.debug_api,
            SuiteEntity::Asset(id) => self.all_assets || self.assets.contains(id),
            SuiteEntity::Suite
            | SuiteEntity::Demonstration(_)
            | SuiteEntity::ReferenceImplementation(_)
            | SuiteEntity::Showcase => false,
        }
    }

    /// Whether the specification known by `identity` is held.
    fn holds_specification(&self, identity: &str) -> bool {
        self.all_specifications || self.specifications.contains(identity)
    }

    /// Whether `asset` is held.
    fn holds_asset(&self, asset: &PartialAssetFolder) -> bool {
        self.all_assets
            || asset
                .manifest
                .id
                .as_ref()
                .is_some_and(|id| self.assets.contains(id))
    }

    /// Whether a file of the validator project, relative to the tree, is held: a
    /// claimed module and its own test, and every file of the project that is not a
    /// validator module — its Vitest configuration and its package files — with the
    /// generated debug API declaration held only beside the debug API.
    fn holds_validator_file(&self, path: &str) -> bool {
        let Some(relative) = path.strip_prefix(&format!("{VALIDATORS_DIR}/")) else {
            return false;
        };
        if relative
            .split('/')
            .any(|segment| segment == INSTALLED_DEPENDENCIES_DIR)
        {
            return false;
        }
        if relative == VITEST_CONFIG_FILE {
            return true;
        }
        if relative == DEBUG_API_DECLARATION_FILE {
            return self.debug_api;
        }
        if let Some(stem) = relative.strip_suffix(".test.ts") {
            return self.validators.contains(&format!("{stem}.ts"));
        }
        if relative.ends_with(".ts") {
            return self.validators.contains(relative);
        }
        true
    }

    /// The tree these definitions and what they reference make up, as the preview of
    /// `draft`.
    fn restrict(&self, tree: &PartialSuiteTree, draft: &str) -> PartialSuiteTree {
        let test_cases: Vec<_> = tree
            .test_cases
            .iter()
            .filter(|case| self.definitions.contains(&case.slug))
            .cloned()
            .collect();
        let prompts: BTreeSet<&str> = test_cases
            .iter()
            .filter_map(|case| case.definition.prompt.as_deref())
            .collect();
        let workspaces: BTreeSet<&str> = test_cases
            .iter()
            .flat_map(|case| case.definition.workspaces.iter().flat_map(BTreeMap::values))
            .map(|directory| directory.trim_end_matches('/'))
            .collect();
        let validators = match self.validators.is_empty() {
            true => Vec::new(),
            false => tree
                .trees
                .validators
                .iter()
                .filter(|path| self.holds_validator_file(path))
                .cloned()
                .collect(),
        };
        let trees = SuiteTrees {
            validators,
            reference_implementations: BTreeMap::new(),
            workspaces: tree
                .trees
                .workspaces
                .iter()
                .filter(|(slug, _)| {
                    workspaces.contains(format!("{WORKSPACES_DIR}/{slug}").as_str())
                })
                .map(|(slug, files)| {
                    let files = files
                        .iter()
                        .filter(|file| {
                            !file
                                .split('/')
                                .any(|segment| segment == INSTALLED_DEPENDENCIES_DIR)
                        })
                        .cloned()
                        .collect();
                    (slug.clone(), files)
                })
                .collect(),
            prompts: tree
                .trees
                .prompts
                .iter()
                .filter(|path| prompts.contains(path.as_str()))
                .cloned()
                .collect(),
            shared_demos: Vec::new(),
        };
        PartialSuiteTree {
            suite: tree.suite.clone(),
            manifest: tree
                .manifest
                .clone()
                .map(|manifest| PartialVersionManifest {
                    version: Some(preview_version(draft)),
                    experimental: true,
                    ..manifest
                }),
            specifications: restrict_specifications(&tree.specifications, &|folder| {
                self.holds_specification(&folder.identity())
            }),
            debug_api: tree.debug_api.clone().filter(|_| self.debug_api),
            test_cases,
            assets: tree
                .assets
                .iter()
                .filter(|asset| self.holds_asset(asset))
                .cloned()
                .collect(),
            demos: Vec::new(),
            showcase: None,
            trees,
            unparsed: Vec::new(),
        }
    }
}

/// The specification folders `holds` keeps, with a folder it does not keep lifted
/// out of the way of the ones nested inside it — exactly as a read treats a folder
/// holding no `specification.toml`.
fn restrict_specifications(
    folders: &[PartialSpecificationFolder],
    holds: &dyn Fn(&PartialSpecificationFolder) -> bool,
) -> Vec<PartialSpecificationFolder> {
    let mut kept = Vec::new();
    for folder in folders {
        let children = restrict_specifications(&folder.children, holds);
        match holds(folder) {
            true => kept.push(PartialSpecificationFolder {
                dir: folder.dir.clone(),
                manifest: folder.manifest.clone(),
                prose: folder.prose.clone(),
                children,
            }),
            false => kept.extend(children),
        }
    }
    kept
}

#[cfg(test)]
#[path = "preview.test.rs"]
mod tests;
