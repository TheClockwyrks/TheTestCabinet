//! Where the local commands find the definitions they read.
//!
//! `tcab seed`, `tcab prompt`, `tcab validate`, `tcab capture-baselines`,
//! `tcab publish-reference` and `tcab test-case-groups` all read a checkout rather
//! than the backend, and they all have to answer the same question first: which
//! directory is the catalog. That answer is stated once here.
//!
//! A checkout holds the authored cases at `test-cases/` and the
//! [test suites](https://docs.testcabinet.ai/test-suites/overview/) beside them at
//! `test-suites/`, so naming the first locates the second. `TCAB_TEST_CASES_DIR`
//! relocates the pair — a container, a CI job, or a `tcab` invoked from outside the
//! repository — and the suites checkout follows it, because moving the catalog
//! moves the whole checkout.
//!
//! A command that resolves a *named* test case goes through
//! [`resolver`], which is core's single entry point over both catalogs, so a
//! suite-defined case and an authored one are named the same way on the command
//! line. A command that is authored-only by design (baseline capture, reference
//! publishing) takes [`catalog`] instead.

use std::path::{Path, PathBuf};

use test_cabinet_core::{TestCaseCatalog, TestCaseResolver};

/// The authored catalog root: `TCAB_TEST_CASES_DIR` when set, otherwise
/// `test-cases` beneath the working directory.
pub fn root() -> PathBuf {
    std::env::var_os("TCAB_TEST_CASES_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("test-cases"))
}

/// The authored catalog alone, for the commands that only ever read one.
pub fn catalog() -> TestCaseCatalog {
    TestCaseCatalog::new(root())
}

/// The resolver over the authored catalog and the suites checkout beside it.
pub fn resolver() -> TestCaseResolver {
    resolver_at(&root())
}

/// The resolver over the authored catalog at `root` and the suites checkout beside
/// it, which reads each suite's exported versions at
/// `test-suites/<slug>/versions/v<x.y.z>/`.
pub fn resolver_at(root: &Path) -> TestCaseResolver {
    TestCaseResolver::beside(root)
}
