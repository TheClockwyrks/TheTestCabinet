//! Tests for the single resolution entry point, driven by a minimal authored
//! catalog and the committed fixture suite at `src/testdata/test-suite/`.

use std::fs;
use std::path::PathBuf;

use super::*;
use crate::test_suite::SUITE_VARIANT_SLUG;

/// The committed fixture checkout — the directory holding the `carom/` suite.
fn suites_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/testdata/test-suite")
}

/// A temporary authored catalog holding one resolvable `demo` case.
fn authored() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let version = dir.path().join("end-to-end/easy/demo/v1.0.0");
    fs::create_dir_all(version.join("variants")).expect("the version directory is created");
    fs::write(version.join("prompt.hbs"), "Build it.").expect("the prompt is written");
    fs::write(version.join("changelog.md"), "Introduced.").expect("the changelog is written");
    fs::write(
        version.join("test-case.toml"),
        "slug = \"demo\"\nname = \"Demo\"\ndifficulty = \"easy\"\ntags = []\n\
         prompt = \"prompt.hbs\"\nchangelog = \"changelog.md\"\n\
         variants = [\"variants/base.toml\"]\n\
         [build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n\
         [[domain]]\nid = \"gameplay\"\ndescription = \"Core gameplay.\"\n",
    )
    .expect("the manifest is written");
    fs::write(version.join("variants/base.toml"), "slug = \"base\"\n")
        .expect("the variant is written");
    dir
}

/// A resolver over that authored catalog and the fixture suites checkout.
fn resolver(cases: &tempfile::TempDir) -> TestCaseResolver {
    TestCaseResolver::new(cases.path(), suites_root())
}

#[test]
fn resolves_an_authored_case() {
    let cases = authored();
    let resolved = resolver(&cases)
        .resolve("demo", "v1.0.0")
        .expect("the authored case resolves");
    assert_eq!(resolved.slug, "demo");
    assert_eq!(resolved.version, "v1.0.0");
}

#[test]
fn resolves_a_suite_defined_case_by_its_catalog_identity() {
    let cases = authored();
    let resolved = resolver(&cases)
        .resolve("carom-end-to-end", "v1.0.0")
        .expect("the suite-defined case resolves");
    assert_eq!(resolved.slug, "carom-end-to-end");
    assert_eq!(resolved.version, "v1.0.0");
    // A definition declares no variants, so the one it carries is the implicit one.
    assert_eq!(resolved.variants.len(), 1);
    assert_eq!(resolved.variants[0].slug, SUITE_VARIANT_SLUG);
}

#[test]
fn an_unresolvable_name_names_what_was_asked_for() {
    let cases = authored();
    let err = resolver(&cases)
        .resolve("carom-nonexistent", "v1.0.0")
        .expect_err("an unknown identity is refused");
    assert!(
        format!("{err}").contains("carom-nonexistent"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_known_identity_at_an_undeclared_version_reports_the_version() {
    let cases = authored();
    let err = resolver(&cases)
        .resolve("carom-end-to-end", "v9.9.9")
        .expect_err("an undeclared suite version is refused");
    let message = format!("{err}");
    assert!(message.contains("v9.9.9"), "unexpected error: {message}");
    assert!(
        message.contains("carom-end-to-end"),
        "unexpected error: {message}"
    );
}

#[test]
fn the_suites_checkout_is_found_beside_the_authored_catalog() {
    let resolver = TestCaseResolver::beside(PathBuf::from("/checkout/test-cases"));
    assert_eq!(
        resolver.suites_root(),
        PathBuf::from("/checkout/test-suites")
    );
    // A bare relative root pairs with the bare relative sibling.
    let relative = TestCaseResolver::beside(PathBuf::from("test-cases"));
    assert_eq!(relative.suites_root(), PathBuf::from("test-suites"));
}

#[test]
fn a_suite_identity_lists_the_definition_it_came_from() {
    let cases = authored();
    let found = resolver(&cases)
        .suite_definitions("carom-ball")
        .expect("the lookup runs");
    assert_eq!(
        found,
        vec![SuiteDefinitionRef {
            suite: "carom".to_string(),
            version: "v1.0.0".to_string(),
            definition: "ball".to_string(),
        }]
    );
}
