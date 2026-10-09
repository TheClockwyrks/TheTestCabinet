//! Rendering the prompt a run hands the harness for a suite-defined test case.
//!
//! A suite definition's template sees a different context from an authored case's
//! — the specifications it covers rather than a variant, a bounding volume and a
//! time budget — so which context a template is rendered against is decided by
//! where the resolved case came from. That decision lives here, beside the suite
//! model, and core's `render_case_prompt` (`test_cabinet_core::prompt`) is the one
//! entry point a caller reaches for so nothing above it branches.
//!
//! The rendering itself is [`crate::prompt::render_suite_prompt`]: the same strict,
//! no-escape registry a run renders through, against exactly the context the
//! [definition page](https://docs.testcabinet.ai/test-suites/test-case-definition/)
//! documents. A template naming any variable outside that context is a render
//! error.

use std::path::Path;

use crate::engine::ResolvedEngine;
use crate::error::{Error, Result};
use crate::prompt::{SuiteSpecification, render_suite_prompt};
use crate::test_case::TestCaseVersion;

use super::load_suite_manifest_of;
use super::lowering::{SPECS_DIR, catalog_identity, flatten_specifications, select_by_id};
use super::{SpecificationManifest, SuiteTestCaseDefinition};

use super::{SuiteVersion, VERSION_MANIFEST_FILE};

/// Whether a resolved test case was lowered from a suite definition.
///
/// A suite-defined case resolves with its `root` at the suite tree it was lowered
/// from, so the version manifest standing there is what tells the two apart: an
/// authored case's version folder holds a `test-case.toml` and never a
/// `version.toml`. This is the same test the validator runner makes, stated once.
pub fn is_suite_defined(test_case: &TestCaseVersion) -> bool {
    test_case.root.join(VERSION_MANIFEST_FILE).is_file()
}

/// Render a suite-defined case's prompt for `engine`.
///
/// The covered specifications come from the suite version the case was lowered
/// from, in the order the definition lists them, each naming the document seeding
/// writes at `specs/<path>` — so the paths the template interpolates are the paths
/// the harness finds in its workspace.
pub fn render_definition_prompt(
    test_case: &TestCaseVersion,
    engine: Option<&ResolvedEngine>,
) -> Result<String> {
    let root = &test_case.root;
    let loaded = load_suite_manifest_of(root)
        .and_then(|suite| SuiteVersion::load(&suite, root))
        .map_err(|err| suite_error(test_case, root, err))?;
    let suite = loaded.suite.slug.clone();
    // The resolved version is the exported version folder's name, which is what the
    // tree was lowered at, whether it is read from the checkout or from a store.
    let version = test_case.version.clone();
    let definition = loaded
        .test_cases
        .iter()
        .find(|case| catalog_identity(&suite, &case.slug) == test_case.slug)
        .map(|case| &case.definition)
        .ok_or_else(|| Error::InvalidTestSuite {
            suite: suite.clone(),
            version: version.clone(),
            file: "test-cases".to_string(),
            detail: format!(
                "no definition of this suite resolves as `{}`",
                test_case.slug
            ),
        })?;

    let template =
        std::fs::read_to_string(&test_case.prompt_path).map_err(|err| Error::PromptRender {
            slug: test_case.slug.clone(),
            version: test_case.version.clone(),
            detail: format!("could not read {}: {err}", test_case.prompt_path.display()),
        })?;

    let mut folders = Vec::new();
    flatten_specifications(&loaded.specifications, &mut folders);
    let declared: Vec<&SpecificationManifest> =
        folders.iter().map(|folder| &folder.manifest).collect();
    render_suite_definition_prompt(
        &suite,
        &version,
        &definition_stem(&suite, test_case),
        definition,
        &declared,
        &template,
        engine,
    )
}

/// Render a suite definition's prompt from the suite version's records rather than
/// from its tree on disk.
///
/// This is what a reader that holds a suite version as data — the backend's stored
/// suite record — renders a version's prompt through, so the prompt it shows is the
/// prompt a run of that version receives: the same selection rule, the same
/// documented context, and no standing preamble.
///
/// `declared` is every specification the suite version declares, flattened in walk
/// order; `definition_slug` is the definition's file stem, naming the file a
/// specification the suite does not declare is reported against; and `version` is
/// the resolved test-case version, the coordinate a failure is reported at.
pub fn render_suite_definition_prompt(
    suite: &str,
    version: &str,
    definition_slug: &str,
    definition: &SuiteTestCaseDefinition,
    declared: &[&SpecificationManifest],
    template: &str,
    engine: Option<&ResolvedEngine>,
) -> Result<String> {
    let (selected, missing) = select_by_id(declared, definition, |spec| spec.id.as_str());
    if let Some(id) = missing.first() {
        return Err(Error::InvalidTestSuite {
            suite: suite.to_string(),
            version: version.to_string(),
            file: format!("test-cases/{definition_slug}.toml"),
            detail: format!("specification `{id}` is not declared by the suite"),
        });
    }

    let specifications: Vec<SuiteSpecification> = selected
        .iter()
        .map(|spec| SuiteSpecification {
            id: spec.id.clone(),
            name: spec.name.clone(),
            summary: spec.summary.clone(),
            dest: format!("{SPECS_DIR}/{}", spec.path),
        })
        .collect();
    render_suite_prompt(suite, version, template, &specifications, engine)
}

/// Render a definition's template as a run would, over a suite tree in any state.
///
/// The Spec Cabinet previews a template while the draft holding it is still being
/// written, so this reads the [partial model](super::PartialSuiteTree): the
/// specifications the definition selects are listed with whatever keys they
/// declare, an id the draft does not declare is left out of the listing, and a key
/// a specification leaves out renders empty. What the preview cannot stand in for
/// is a template naming a variable outside the documented context, which is the
/// render error a run would raise too.
pub fn preview_definition_prompt(
    tree: &super::PartialSuiteTree,
    definition: &super::PartialTestCaseDefinition,
    template: &str,
    engine: Option<&ResolvedEngine>,
) -> Result<String> {
    let declared = tree.flat_specifications();
    let selected: Vec<&super::PartialSpecificationFolder> = match &definition.specifications {
        None => declared,
        Some(ids) => ids
            .iter()
            .filter_map(|id| {
                declared
                    .iter()
                    .copied()
                    .find(|folder| folder.manifest.id.as_deref() == Some(id.as_str()))
            })
            .collect(),
    };
    let specifications: Vec<SuiteSpecification> = selected
        .iter()
        .map(|folder| SuiteSpecification {
            id: folder.manifest.id.clone().unwrap_or_default(),
            name: folder.manifest.name.clone().unwrap_or_default(),
            summary: folder.manifest.summary.clone().unwrap_or_default(),
            dest: format!(
                "{SPECS_DIR}/{}",
                folder.manifest.path.as_deref().unwrap_or_default()
            ),
        })
        .collect();
    // A draft declares no version yet, so a preview of one names none.
    let named = tree
        .manifest
        .as_ref()
        .and_then(|manifest| manifest.version.as_deref())
        .map(|declared| format!("v{declared}"))
        .unwrap_or_default();
    render_suite_prompt(&tree.suite.slug, &named, template, &specifications, engine)
}

/// The definition's file stem, recovered from the catalog identity the suite slug
/// qualifies. Used only to name the file a failure is reported against.
fn definition_stem(suite: &str, test_case: &TestCaseVersion) -> String {
    test_case
        .slug
        .strip_prefix(&format!("{suite}-"))
        .unwrap_or(&test_case.slug)
        .to_string()
}

/// A suite tree that could not be read, reported against the tree.
fn suite_error(test_case: &TestCaseVersion, root: &Path, err: super::TestSuiteError) -> Error {
    Error::InvalidTestSuite {
        suite: test_case.slug.clone(),
        version: test_case.version.clone(),
        file: root.display().to_string(),
        detail: err.to_string(),
    }
}

#[cfg(test)]
#[path = "prompt.test.rs"]
mod tests;
