//! Tests for the `[toolchain]` table a test case version declares: the required
//! `typecheck`, the three optional recorded commands, what a case that declares
//! none resolves to, and the validations that hold an authored table to being one
//! a run can actually execute.
//!
//! Split out of `test_case.test.rs` (already long) because this is its own axis:
//! how a case says what checks its produced TypeScript must pass.

use super::tests::{catalog_with_files, manifest_with};
use super::*;

/// Resolve a manifest whose `[toolchain]` table (or absence of one) is `tables`.
fn resolve_tables(tables: &str) -> TestCaseVersion {
    let manifest = manifest_with("", tables);
    let (_dir, catalog) = catalog_with_files(&manifest, &[]);
    catalog.resolve("demo", "v1.0.0").expect("resolve")
}

/// Resolve a manifest expected to be refused, returning the rendered failure.
fn reject_tables(tables: &str) -> String {
    let manifest = manifest_with("", tables);
    let (_dir, catalog) = catalog_with_files(&manifest, &[]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("the manifest should be refused");
    format!("{err}")
}

/// **The property every shipped case depends on.** Every case version frozen
/// before the table existed declares none, and a frozen version cannot be edited,
/// so a case with no `[toolchain]` must keep resolving — and must resolve to *no*
/// toolchain, which is what leaves it unchecked and ungated.
#[test]
fn a_case_with_no_toolchain_table_still_resolves() {
    let version = resolve_tables("");
    assert!(version.toolchain.is_none());
}

/// The whole table: the required typecheck plus all three optional commands,
/// carried through verbatim.
#[test]
fn a_full_toolchain_table_resolves_every_command() {
    let version = resolve_tables(
        "[toolchain]\n\
         typecheck = \"npx tsc --noEmit\"\n\
         lint = \"npx eslint .\"\n\
         format = \"npx prettier --check .\"\n\
         test = \"npx vitest run --coverage\"\n",
    );
    let toolchain = version.toolchain.expect("the table resolves");
    assert_eq!(toolchain.typecheck, "npx tsc --noEmit");
    assert_eq!(toolchain.lint.as_deref(), Some("npx eslint ."));
    assert_eq!(toolchain.format.as_deref(), Some("npx prettier --check ."));
    assert_eq!(toolchain.test.as_deref(), Some("npx vitest run --coverage"));
}

/// Only `typecheck` is required; the three recorded commands are each optional and
/// simply absent when not declared.
#[test]
fn only_the_typecheck_is_required() {
    let version = resolve_tables("[toolchain]\ntypecheck = \"npx tsc --noEmit\"\n");
    let toolchain = version.toolchain.expect("the table resolves");
    assert_eq!(toolchain.typecheck, "npx tsc --noEmit");
    assert_eq!(toolchain.lint, None);
    assert_eq!(toolchain.format, None);
    assert_eq!(toolchain.test, None);
}

/// A table with no `typecheck` is not a toolchain: the one gating command has to
/// be stated.
#[test]
fn a_toolchain_table_without_a_typecheck_is_refused() {
    let error = reject_tables("[toolchain]\nlint = \"npx eslint .\"\n");
    assert!(error.contains("typecheck"), "{error}");
}

/// A blank `typecheck` would silently ungate the run — the worst possible way for
/// a manifest typo to fail — so it is refused rather than accepted as "no check".
#[test]
fn a_blank_typecheck_is_refused() {
    let error = reject_tables("[toolchain]\ntypecheck = \"   \"\n");
    assert!(error.contains("toolchain.typecheck"), "{error}");
}

/// A blank optional command would silently skip the check it names. Declaring the
/// key at all is a statement that the check should run.
#[test]
fn a_blank_optional_command_is_refused() {
    for (key, table) in [
        ("lint", "lint = \"\"\n"),
        ("format", "format = \"\"\n"),
        ("test", "test = \"  \"\n"),
    ] {
        let error = reject_tables(&format!(
            "[toolchain]\ntypecheck = \"npx tsc --noEmit\"\n{table}"
        ));
        assert!(
            error.contains(&format!("toolchain.{key}")),
            "{key}: {error}"
        );
    }
}

/// An asset-generation case produces an action log, not TypeScript, so a
/// `[toolchain]` table on one is a mistake worth refusing rather than ignoring.
#[test]
fn a_toolchain_table_is_refused_for_a_case_that_ships_no_typescript_build() {
    use super::tests::{VALID_ASSET_MANIFEST, asset_catalog};

    let manifest = format!("{VALID_ASSET_MANIFEST}\n[toolchain]\ntypecheck = \"npx tsc\"\n");
    let (_dir, catalog) = asset_catalog(&manifest);
    let err = catalog
        .resolve("sprite", "v1.0.0")
        .expect_err("an asset-generation case has no TypeScript to check");
    assert!(format!("{err}").contains("[toolchain]"), "{err}");
}
