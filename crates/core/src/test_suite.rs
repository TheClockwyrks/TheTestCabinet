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
//! checked against ([`AuthoredLookup`] for [`TestCaseCatalog`]).

pub use test_cabinet_suites::test_suite::*;

use crate::test_case::TestCaseCatalog;

/// A suite definition's identity collides with an authored test case exactly when
/// the authored catalog holds a version of that slug.
impl AuthoredLookup for TestCaseCatalog {
    fn has_authored(&self, identity: &str) -> bool {
        self.versions(identity).is_ok()
    }
}

#[cfg(test)]
#[path = "test_suite.core.test.rs"]
mod tests;
