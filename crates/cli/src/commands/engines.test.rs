//! Unit tests for the engine resolution `tcab seed`, `tcab validate`, and
//! `tcab prompt` share.
//!
//! The catalogue itself is `core`'s to test (`crates/core/src/engine.test.rs`);
//! what is pinned here is the part this crate owns — the *order* the two refusals
//! are reported in, which is what decides whether a mistyped flag sends someone
//! looking at the flag or at the case's manifest.
//!
//! These resolve a real case out of the repository's catalog rather than building
//! a `TestCaseVersion` literal, the same way `analyze`'s test reads this crate off
//! disk: the case is a **frozen** version, so what it supports cannot drift, and
//! reading it exercises the resolution that actually puts `none` in a case's
//! supported set.

use std::path::PathBuf;

use test_cabinet_core::TestCaseCatalog;

use super::*;

/// Resolve `carom` at the frozen `v2.1.0` — authored before engines existed, so
/// it declares no `engines` and supports exactly the engineless run.
fn engineless_case() -> TestCaseVersion {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../test-cases");
    TestCaseCatalog::new(root)
        .resolve("carom", "v2.1.0")
        .expect("carom v2.1.0 is a frozen case version in this repository")
}

#[test]
fn the_engineless_run_is_supported_by_a_case_that_declares_no_engines() {
    let test_case = engineless_case();
    assert_eq!(test_case.engines, vec!["none".to_string()]);

    let engine = resolve_for_case("none", &test_case).expect("every case supports `none`");
    assert_eq!(engine.slug(), "none");
    assert!(
        !engine.provides_runtime(),
        "`none` vendors no runtime, which is the whole point of it"
    );
}

#[test]
fn an_unknown_slug_is_reported_as_an_unknown_engine_not_an_unsupported_one() {
    // `simple2d` is a typo for `simple-2d`, and it is *also* an engine this case
    // does not support. The unknown-engine failure has to win: telling someone
    // their typo is "not supported by this case" would send them to the manifest
    // to add it, which would not help.
    let err = resolve_for_case("simple2d", &engineless_case())
        .expect_err("a slug the catalogue does not carry should be refused");
    let message = format!("{err:#}");
    assert!(
        message.contains("unknown engine `simple2d`"),
        "expected the unknown-engine failure, got: {message}"
    );
    assert!(
        message.contains("none, simple-2d"),
        "the failure should name every engine that would have worked, got: {message}"
    );
}

#[test]
fn a_known_engine_the_case_does_not_declare_is_refused_naming_what_it_supports() {
    let err = resolve_for_case("simple-2d", &engineless_case())
        .expect_err("a case that declares no engines supports only `none`");
    let message = format!("{err:#}");
    assert!(
        message.contains("is not supported by test case"),
        "expected the unsupported-engine failure, got: {message}"
    );
    assert!(
        message.contains("supported engines: none"),
        "the failure should name the engines the case does support, got: {message}"
    );
}
