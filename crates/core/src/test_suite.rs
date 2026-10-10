//! Test suites: the [format](https://docs.testcabinet.ai/test-suites/overview/) and
//! the runtime that runs one.
//!
//! The format is `test_cabinet_contracts::test_suite` and the runtime that reads a
//! `test-suites/` checkout, lowers its definitions onto runnable test cases, renders
//! their prompts and runs their validators is `test_cabinet_suites::test_suite`,
//! which re-exports the format. This module re-exports that whole, so
//! `test_cabinet_core::test_suite::TestSuiteCatalog`,
//! `test_cabinet_core::test_suite::SuiteVersion` and the rest name the same items
//! they always did. What is core's is the authored catalog a definition's identity is
//! checked against ([`AuthoredLookup`] for [`TestCaseCatalog`]), and every form that
//! holds a suite to the built-in engines ([`built_in_catalog`]): the export rules
//! ([`validate`], [`validate_tree`], [`validate_preview_tree`] and
//! [`load_and_validate`]), a partial tree's conversion ([`PartialSuiteTreeExt`]), the
//! catalog's resolution of a definition ([`TestSuiteCatalogExt`]) and a draft's
//! [`preview_completeness`]. The suites crate takes the engines as an argument in each
//! (the `*_with` forms), because the built-in table is core's to name.

use std::path::Path;

pub use test_cabinet_suites::test_suite::*;

use crate::engine::built_in_catalog;
use crate::test_case::{TestCaseCatalog, TestCaseVersion};

/// A suite definition's identity collides with an authored test case exactly when
/// the authored catalog holds a version of that slug.
impl AuthoredLookup for TestCaseCatalog {
    fn has_authored(&self, identity: &str) -> bool {
        self.versions(identity).is_ok()
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
    load_and_validate_with(suite, root, &built_in_catalog())
}

/// Every export rule, checked over one complete suite tree.
///
/// The complete model is viewed through the partial one, so a complete tree and a
/// draft are held to exactly the same rules.
pub fn validate(root: &Path, version: &SuiteVersion) -> Vec<SuiteDiagnostic> {
    validate_with(root, version, &built_in_catalog())
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
    validate_tree_with(root, tree, &built_in_catalog())
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
    validate_preview_tree_with(root, tree, &built_in_catalog())
}

/// A partial suite tree's conversion to the complete model, under the export rules
/// held to the built-in engine catalog.
///
/// In scope wherever `test_cabinet_core::test_suite::*` is imported, so
/// `tree.complete(root)` reads as it always did.
pub trait PartialSuiteTreeExt {
    /// The complete model of this tree, or every problem standing between the tree
    /// and it: [`PartialSuiteTree::complete_with`] over the built-in engines.
    fn complete(&self, root: &Path) -> Result<SuiteVersion, Vec<SuiteDiagnostic>>;

    /// The complete model of this tree as a preview, or every problem standing
    /// between the tree and it: [`PartialSuiteTree::complete_preview_with`] over
    /// the built-in engines. The tree is the one [`preview_tree`]
    /// restricted a draft to, and `root` is that draft's folder.
    fn complete_preview(&self, root: &Path) -> Result<SuiteVersion, Vec<SuiteDiagnostic>>;
}

impl PartialSuiteTreeExt for PartialSuiteTree {
    fn complete(&self, root: &Path) -> Result<SuiteVersion, Vec<SuiteDiagnostic>> {
        self.complete_with(root, &built_in_catalog())
    }

    fn complete_preview(&self, root: &Path) -> Result<SuiteVersion, Vec<SuiteDiagnostic>> {
        self.complete_preview_with(root, &built_in_catalog())
    }
}

/// A suite catalog's resolution of an offered definition, with its declared engines
/// held to the built-in engines.
///
/// In scope wherever `test_cabinet_core::test_suite::*` is imported, so
/// `catalog.resolve(slug, version, definition)` reads as it always did.
pub trait TestSuiteCatalogExt {
    /// Resolve one offered definition into the [`TestCaseVersion`] a run executes:
    /// [`TestSuiteCatalog::resolve_with`] over the built-in engines.
    fn resolve(
        &self,
        slug: &str,
        version: &str,
        definition: &str,
    ) -> test_cabinet_suites::Result<TestCaseVersion>;

    /// Resolve one offered definition, refusing an identity the authored catalog
    /// already claims: [`TestSuiteCatalog::resolve_beside_with`] over the built-in
    /// engines.
    fn resolve_beside(
        &self,
        slug: &str,
        version: &str,
        definition: &str,
        authored: &impl AuthoredLookup,
    ) -> test_cabinet_suites::Result<TestCaseVersion>;
}

impl TestSuiteCatalogExt for TestSuiteCatalog {
    fn resolve(
        &self,
        slug: &str,
        version: &str,
        definition: &str,
    ) -> test_cabinet_suites::Result<TestCaseVersion> {
        self.resolve_with(slug, version, definition, &built_in_catalog())
    }

    fn resolve_beside(
        &self,
        slug: &str,
        version: &str,
        definition: &str,
        authored: &impl AuthoredLookup,
    ) -> test_cabinet_suites::Result<TestCaseVersion> {
        self.resolve_beside_with(slug, version, definition, authored, &built_in_catalog())
    }
}

/// Whether each test case definition of the draft `tree` is complete, in slug order,
/// with declared engines held to the built-in engines:
/// [`preview_completeness_with`] over [`built_in_catalog`].
///
/// `root` is the draft's folder, `diagnostics` every problem the export rules found
/// in it, and `draft` its name.
pub fn preview_completeness(
    root: &Path,
    tree: &PartialSuiteTree,
    diagnostics: &[SuiteDiagnostic],
    draft: &str,
) -> Vec<DefinitionCompleteness> {
    preview_completeness_with(root, tree, diagnostics, draft, &built_in_catalog())
}

#[cfg(test)]
#[path = "test_suite.core.test.rs"]
mod tests;
