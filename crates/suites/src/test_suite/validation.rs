//! The export rules, held to the built-in engine catalog.
//!
//! The rules themselves are `test_cabinet_contracts::test_suite`'s, and each takes
//! the engines a definition's declared slugs are checked against. These are the
//! names every caller has always used, and they check against
//! [`EngineCatalog`], the engines this build knows.

use std::path::Path;

use crate::engine::EngineCatalog;

use super::{
    PartialSuiteTree, SuiteDiagnostic, SuiteManifest, SuiteVersion, TestSuiteResult,
    load_and_validate_with, validate_preview_tree_with, validate_tree_with, validate_with,
};

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
    load_and_validate_with(suite, root, &EngineCatalog::new())
}

/// Every export rule, checked over one complete suite tree.
///
/// The complete model is viewed through the partial one, so a complete tree and a
/// draft are held to exactly the same rules.
pub fn validate(root: &Path, version: &SuiteVersion) -> Vec<SuiteDiagnostic> {
    validate_with(root, version, &EngineCatalog::new())
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
    validate_tree_with(root, tree, &EngineCatalog::new())
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
    validate_preview_tree_with(root, tree, &EngineCatalog::new())
}

/// A partial suite tree's conversion to the complete model, under the export rules
/// held to the built-in engine catalog.
///
/// In scope wherever `test_cabinet_core::test_suite::*` is imported, so
/// `tree.complete(root)` reads as it always did.
pub trait PartialSuiteTreeExt {
    /// The complete model of this tree, or every problem standing between the tree
    /// and it: [`PartialSuiteTree::complete_with`] over [`EngineCatalog`].
    fn complete(&self, root: &Path) -> Result<SuiteVersion, Vec<SuiteDiagnostic>>;

    /// The complete model of this tree as a preview, or every problem standing
    /// between the tree and it: [`PartialSuiteTree::complete_preview_with`] over
    /// [`EngineCatalog`]. The tree is the one [`preview_tree`](super::preview_tree)
    /// restricted a draft to, and `root` is that draft's folder.
    fn complete_preview(&self, root: &Path) -> Result<SuiteVersion, Vec<SuiteDiagnostic>>;
}

impl PartialSuiteTreeExt for PartialSuiteTree {
    fn complete(&self, root: &Path) -> Result<SuiteVersion, Vec<SuiteDiagnostic>> {
        self.complete_with(root, &EngineCatalog::new())
    }

    fn complete_preview(&self, root: &Path) -> Result<SuiteVersion, Vec<SuiteDiagnostic>> {
        self.complete_preview_with(root, &EngineCatalog::new())
    }
}

#[cfg(test)]
#[path = "validation.test.rs"]
mod tests;
