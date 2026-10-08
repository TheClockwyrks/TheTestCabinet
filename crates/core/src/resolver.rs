//! The one place a caller turns a test case name and a version into the
//! [`TestCaseVersion`] the rest of the system executes, whether the case was
//! authored under `test-cases/` or offered by a
//! [test suite](https://docs.testcabinet.ai/test-suites/overview/) under
//! `test-suites/`.
//!
//! The two catalogs share one identity space: an authored case is named by the
//! `slug` its manifest declares, and a suite-defined case by
//! `<suite slug>-<definition file stem>` at the suite's own version. A caller
//! therefore names one thing — an identity and a version — and this decides which
//! catalog answers, so nothing above it branches on where a case came from.
//!
//! A name neither catalog claims is an error naming what was asked for, rather
//! than the error of whichever catalog happened to be consulted last.

use std::path::{Path, PathBuf};

use crate::error::{Error, Result};
use crate::test_case::{TestCaseCatalog, TestCaseVersion};
use crate::test_suite::{TEST_SUITES_DIR, TestSuiteCatalog};

/// Resolves a named test case version against the authored catalog and the suites
/// checkout beside it.
#[derive(Debug, Clone)]
pub struct TestCaseResolver {
    /// The authored catalog, rooted at `test-cases/`.
    cases: TestCaseCatalog,
    /// The suites checkout, rooted at `test-suites/`.
    suites: TestSuiteCatalog,
}

/// One suite-defined case the resolver matched an identity to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SuiteDefinitionRef {
    /// The suite's slug.
    pub suite: String,
    /// The suite version folder's name, carrying its leading `v`.
    pub version: String,
    /// The definition's file stem.
    pub definition: String,
}

impl TestCaseResolver {
    /// Open a resolver over an explicit pair of roots.
    pub fn new(cases_root: impl Into<PathBuf>, suites_root: impl Into<PathBuf>) -> Self {
        Self {
            cases: TestCaseCatalog::new(cases_root),
            suites: TestSuiteCatalog::new(suites_root),
        }
    }

    /// Open a resolver over an authored catalog root, finding the suites checkout
    /// beside it.
    ///
    /// A checkout holds `test-cases/` and `test-suites/` as siblings, so naming the
    /// first locates the second. An authored root with no parent (the bare relative
    /// `test-cases`) pairs with the bare relative `test-suites`, which is the same
    /// sibling relationship read from the working directory.
    pub fn beside(cases_root: impl Into<PathBuf>) -> Self {
        let cases_root = cases_root.into();
        let suites_root = match cases_root.parent() {
            Some(parent) => parent.join(TEST_SUITES_DIR),
            None => PathBuf::from(TEST_SUITES_DIR),
        };
        Self::new(cases_root, suites_root)
    }

    /// The authored catalog this resolver reads.
    pub fn cases(&self) -> &TestCaseCatalog {
        &self.cases
    }

    /// The suite catalog this resolver reads.
    pub fn suites(&self) -> &TestSuiteCatalog {
        &self.suites
    }

    /// The authored catalog root.
    pub fn cases_root(&self) -> &Path {
        self.cases.root()
    }

    /// The suites checkout root.
    pub fn suites_root(&self) -> &Path {
        self.suites.root()
    }

    /// Resolve one named test case version.
    ///
    /// The authored catalog answers first, because its slugs are the identities a
    /// suite-defined case is refused for colliding with — so a name both could claim
    /// is already impossible, and asking the authored catalog first never shadows a
    /// suite. A name the authored catalog does not claim is looked for among the
    /// definitions the suites offer.
    pub fn resolve(&self, id: &str, version: &str) -> Result<TestCaseVersion> {
        if self.cases.versions(id).is_ok() {
            return self.cases.resolve(id, version);
        }
        let matches = self.suite_definitions(id)?;
        if let Some(found) = matches.iter().find(|found| found.version == version) {
            return self.suites.resolve_beside(
                &found.suite,
                &found.version,
                &found.definition,
                &self.cases,
            );
        }
        if let Some(found) = matches.first() {
            // The identity is a real one, at some other version of its suite. That is
            // the version error it is, rather than an unknown name.
            return Err(Error::TestCaseVersionNotFound {
                slug: format!("{id} (suite `{}`)", found.suite),
                version: version.to_string(),
            });
        }
        Err(Error::TestCaseNotFound {
            slug: id.to_string(),
        })
    }

    /// Every suite-defined case whose catalog identity is `id`, newest version of
    /// each suite first.
    ///
    /// Normally none or one. Two suites can only both claim an identity when one
    /// suite's slug and definition stem split the same string differently (suite
    /// `carom` with `end-to-end`, and a suite `carom-end` with `to-end`), which is a
    /// genuine ambiguity and is refused rather than silently decided.
    pub fn suite_definitions(&self, id: &str) -> Result<Vec<SuiteDefinitionRef>> {
        let mut found: Vec<SuiteDefinitionRef> = Vec::new();
        for suite in self.suites.list()? {
            let Some(rest) = id.strip_prefix(&format!("{}-", suite.slug)) else {
                continue;
            };
            for version in &suite.versions {
                let definitions = self.suites.definitions(&suite.slug, version)?;
                if definitions.iter().any(|definition| definition == rest) {
                    found.push(SuiteDefinitionRef {
                        suite: suite.slug.clone(),
                        version: version.clone(),
                        definition: rest.to_string(),
                    });
                }
            }
        }
        let ambiguous = found
            .iter()
            .map(|found| found.suite.as_str())
            .collect::<std::collections::BTreeSet<_>>();
        if ambiguous.len() > 1 {
            let suites = ambiguous.into_iter().collect::<Vec<_>>().join("`, `");
            return Err(Error::InvalidTestSuite {
                suite: found[0].suite.clone(),
                version: found[0].version.clone(),
                file: "test-cases".to_string(),
                detail: format!("identity `{id}` is offered by more than one suite (`{suites}`)"),
            });
        }
        Ok(found)
    }
}

#[cfg(test)]
#[path = "resolver.test.rs"]
mod tests;
