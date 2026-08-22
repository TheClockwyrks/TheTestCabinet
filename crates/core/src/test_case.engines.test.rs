//! Tests for the **engine version ranges** a test case version declares: the
//! `[[engine]]` table form beside the bare `engines` list, the validations that
//! hold an authored range to being one a run can be checked against, and the
//! half-open comparison itself.
//!
//! Split out of `test_case.test.rs`, which already carries the slug-only engine
//! checks (the resolved set always leading with `none`, an unknown slug, a
//! duplicate, the workspace `package.json` a runtime engine owes), because these
//! drive a distinct axis — the version — and that file is already long.

use semver::Version;

use super::tests::{
    ENGINE_WORKSPACE_FILES, VALID_ASSET_MANIFEST, asset_catalog, catalog_with_files,
    engines_manifest_with,
};
use super::*;

/// A manifest declaring the engine tables in `tables`, with the workspace a
/// runtime engine owes. The tables land after `[build]` because `[[engine]]` is a
/// table and every root key must precede the first table header.
fn engine_table_manifest(tables: &str) -> String {
    engines_manifest_with("", tables, &["simple-2d"])
}

/// Resolve a manifest declaring `tables`, expecting it to resolve.
fn resolve_tables(tables: &str) -> TestCaseVersion {
    let manifest = engine_table_manifest(tables);
    let (_dir, catalog) = catalog_with_files(&manifest, ENGINE_WORKSPACE_FILES);
    catalog.resolve("demo", "v1.0.0").expect("resolve")
}

/// Resolve a manifest declaring `tables`, expecting it to be refused, and return
/// the rendered failure.
fn reject_tables(tables: &str) -> String {
    let manifest = engine_table_manifest(tables);
    let (_dir, catalog) = catalog_with_files(&manifest, ENGINE_WORKSPACE_FILES);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("the manifest should be refused");
    format!("{err}")
}

// --- the two manifest forms -------------------------------------------------

#[test]
fn the_bare_slug_form_resolves_to_support_at_any_version() {
    // The form every shipped (frozen) case is written in. It states a slug and
    // nothing else, so it must resolve to a support entry that constrains nothing
    // — otherwise a frozen case would start refusing runs the day this landed.
    let manifest = engines_manifest_with(
        "engines = [\"none\", \"simple-2d\"]\n",
        "",
        &["none", "simple-2d"],
    );
    let (_dir, catalog) = catalog_with_files(&manifest, ENGINE_WORKSPACE_FILES);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");

    let support = version
        .engine_support("simple-2d")
        .expect("the case declares simple-2d");
    assert_eq!(support.min_version, None);
    assert_eq!(support.max_version, None);
    assert!(!support.is_bounded());
    assert!(support.accepts(&Version::parse("0.0.1").expect("version")));
    assert!(support.accepts(&Version::parse("99.0.0").expect("version")));
}

#[test]
fn an_engine_table_with_only_a_minimum_is_unbounded_above() {
    // "The earliest contract our specs were written against, and every later one":
    // a case that states a floor accepts every version the catalogue later offers.
    let version = resolve_tables("[[engine]]\nslug = \"simple-2d\"\nmin_version = \"1.2.0\"\n");

    let support = version.engine_support("simple-2d").expect("declared");
    assert_eq!(support.min_version, Some(Version::parse("1.2.0").unwrap()));
    assert_eq!(support.max_version, None);
    assert!(support.is_bounded());
    assert_eq!(support.range_display(), ">= 1.2.0");
}

#[test]
fn an_engine_table_carries_both_ends_of_the_range() {
    let version = resolve_tables(
        "[[engine]]\nslug = \"simple-2d\"\nmin_version = \"1.0.0\"\nmax_version = \"2.0.0\"\n",
    );

    let support = version.engine_support("simple-2d").expect("declared");
    assert_eq!(support.min_version, Some(Version::parse("1.0.0").unwrap()));
    assert_eq!(support.max_version, Some(Version::parse("2.0.0").unwrap()));
    assert_eq!(support.range_display(), ">= 1.0.0, < 2.0.0");
}

#[test]
fn both_forms_may_appear_in_one_manifest() {
    // `none` carries no version so it is declared in the list; the runtime engine
    // carries a range so it is declared as a table. The resolved set merges them,
    // still led by `none`.
    let manifest = engines_manifest_with(
        "engines = [\"none\"]\n",
        "[[engine]]\nslug = \"simple-2d\"\nmin_version = \"1.0.0\"\n",
        &["none", "simple-2d"],
    );
    let (_dir, catalog) = catalog_with_files(&manifest, ENGINE_WORKSPACE_FILES);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");

    assert_eq!(
        version.engine_slugs(),
        vec!["none".to_string(), "simple-2d".to_string()]
    );
    assert!(version.supports_engine("simple-2d"));
    assert!(version.supports_engine("none"));
    assert!(!version.engine_support("none").expect("none").is_bounded());
    assert!(
        version
            .engine_support("simple-2d")
            .expect("simple-2d")
            .is_bounded()
    );
}

#[test]
fn an_engine_table_still_requires_the_workspace_package_json() {
    // The engine's `file:` dependency is written into the seeded workspace's
    // `package.json` at seed time, so the table form owes the same file the bare
    // list form does.
    let manifest =
        engine_table_manifest("[[engine]]\nslug = \"simple-2d\"\nmin_version = \"1.0.0\"\n");
    let (_dir, catalog) =
        catalog_with_files(&manifest, &[("workspaces/simple-2d/README.md", "hi")]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a runtime engine without a workspace package.json is refused");
    assert!(format!("{err}").contains("package.json"), "got: {err}");
}

#[test]
fn an_engine_table_is_end_to_end_only() {
    let manifest = format!(
        "{VALID_ASSET_MANIFEST}\n         [[engine]]\nslug = \"simple-2d\"\nmin_version = \"1.0.0\"\n"
    );
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("`[[engine]]` on an asset-generation case is rejected");
    assert!(
        format!("{err}").contains("only valid for an end-to-end, full-stack, or game-jam case"),
        "got: {err}"
    );
}

// --- validation -------------------------------------------------------------

#[test]
fn an_engine_table_rejects_an_unknown_slug() {
    let message = reject_tables("[[engine]]\nslug = \"unreal\"\nmin_version = \"1.0.0\"\n");
    assert!(message.contains("not a known engine"), "got: {message}");
    for slug in crate::engine::BUILT_IN_SLUGS {
        assert!(message.contains(*slug), "expected `{slug}` in: {message}");
    }
}

#[test]
fn an_engine_table_rejects_a_slug_the_bare_list_already_declared() {
    // Two entries for one engine would be two answers to the same question, so the
    // slug is held to appearing once across both spellings.
    let manifest = engines_manifest_with(
        "engines = [\"simple-2d\"]\n",
        "[[engine]]\nslug = \"simple-2d\"\nmin_version = \"1.0.0\"\n",
        &["simple-2d"],
    );
    let (_dir, catalog) = catalog_with_files(&manifest, ENGINE_WORKSPACE_FILES);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("one slug may be declared in only one of the two forms");
    let message = format!("{err}");
    assert!(
        message.contains("declared more than once"),
        "got: {message}"
    );
    assert!(message.contains("simple-2d"), "got: {message}");
}

#[test]
fn two_engine_tables_for_one_slug_are_rejected() {
    let message = reject_tables(
        "[[engine]]\nslug = \"simple-2d\"\nmin_version = \"1.0.0\"\n\
         [[engine]]\nslug = \"simple-2d\"\nmin_version = \"2.0.0\"\n",
    );
    assert!(
        message.contains("declared more than once"),
        "got: {message}"
    );
}

#[test]
fn an_engine_table_rejects_a_maximum_equal_to_the_minimum() {
    // The ceiling is exclusive, so `max == min` admits no version at all — every
    // run of the case would be refused, which is never what the author meant.
    let message = reject_tables(
        "[[engine]]\nslug = \"simple-2d\"\nmin_version = \"1.0.0\"\nmax_version = \"1.0.0\"\n",
    );
    assert!(message.contains("max_version"), "got: {message}");
    assert!(
        message.contains("supports no version at all"),
        "got: {message}"
    );
}

#[test]
fn an_engine_table_rejects_a_maximum_below_the_minimum() {
    let message = reject_tables(
        "[[engine]]\nslug = \"simple-2d\"\nmin_version = \"2.0.0\"\nmax_version = \"1.0.0\"\n",
    );
    assert!(
        message.contains("supports no version at all"),
        "got: {message}"
    );
}

#[test]
fn an_engine_table_rejects_a_malformed_minimum() {
    // The usual slip: a two-component npm-style range rather than a version.
    let message = reject_tables("[[engine]]\nslug = \"simple-2d\"\nmin_version = \"1.0\"\n");
    assert!(message.contains("min_version"), "got: {message}");
    assert!(message.contains("not a semantic version"), "got: {message}");
}

#[test]
fn an_engine_table_rejects_a_malformed_maximum() {
    let message = reject_tables(
        "[[engine]]\nslug = \"simple-2d\"\nmin_version = \"1.0.0\"\nmax_version = \"v2\"\n",
    );
    assert!(message.contains("max_version"), "got: {message}");
    assert!(message.contains("not a semantic version"), "got: {message}");
}

#[test]
fn the_engineless_engine_cannot_declare_a_range() {
    // `none` supplies no runtime, so there is no package and no version for a
    // range to be about. The refusal points at the spelling that says what the
    // author meant.
    let message = reject_tables("[[engine]]\nslug = \"none\"\nmin_version = \"1.0.0\"\n");
    assert!(message.contains("supplies no runtime"), "got: {message}");
    assert!(message.contains("`engines`"), "got: {message}");
}

#[test]
fn an_engine_table_rejects_an_unknown_key() {
    // A misspelled `max-version` that silently did nothing would leave a case
    // pinned by a ceiling it believes it declared.
    let message = reject_tables(
        "[[engine]]\nslug = \"simple-2d\"\nmin_version = \"1.0.0\"\nmax-version = \"2.0.0\"\n",
    );
    assert!(message.contains("max-version"), "got: {message}");
}

#[test]
fn an_engine_table_without_a_minimum_is_rejected() {
    // A table exists precisely to state a floor; a case with nothing to pin
    // belongs in the bare list.
    let message = reject_tables("[[engine]]\nslug = \"simple-2d\"\n");
    assert!(message.contains("min_version"), "got: {message}");
}

// --- the comparison ---------------------------------------------------------

/// Support for `simple-2d` over the half-open range `[min, max)`.
fn bounded(min: &str, max: Option<&str>) -> EngineSupport {
    EngineSupport {
        slug: "simple-2d".to_string(),
        min_version: Some(Version::parse(min).expect("min")),
        max_version: max.map(|raw| Version::parse(raw).expect("max")),
    }
}

#[test]
fn the_minimum_is_inclusive_and_the_maximum_is_exclusive() {
    let support = bounded("1.2.0", Some("2.0.0"));

    // Below the floor.
    assert!(!support.accepts(&Version::parse("1.1.9").unwrap()));
    // Exactly the floor: supported, because the minimum is inclusive.
    assert!(support.accepts(&Version::parse("1.2.0").unwrap()));
    // Inside.
    assert!(support.accepts(&Version::parse("1.9.9").unwrap()));
    // Immediately below the ceiling.
    assert!(support.accepts(&Version::parse("1.999.999").unwrap()));
    // Exactly the ceiling: refused, because the maximum is exclusive.
    assert!(!support.accepts(&Version::parse("2.0.0").unwrap()));
    // Above.
    assert!(!support.accepts(&Version::parse("2.0.1").unwrap()));
}

#[test]
fn an_unbounded_ceiling_accepts_every_later_version() {
    let support = bounded("1.0.0", None);
    assert!(!support.accepts(&Version::parse("0.9.9").unwrap()));
    assert!(support.accepts(&Version::parse("1.0.0").unwrap()));
    assert!(support.accepts(&Version::parse("14.3.1").unwrap()));
    assert_eq!(support.range_display(), ">= 1.0.0");
}

#[test]
fn comparison_is_semver_ordering_not_string_ordering() {
    // `10.0.0` sorts *before* `9.0.0` as a string and after it as a version; a
    // lexicographic gate would refuse every run once the engine reached 10.
    let support = bounded("9.0.0", None);
    assert!(support.accepts(&Version::parse("10.0.0").unwrap()));

    // And the numeric-identifier rule inside a component: 1.10.0 > 1.9.0.
    let support = bounded("1.9.0", Some("1.11.0"));
    assert!(support.accepts(&Version::parse("1.10.0").unwrap()));
    assert!(!support.accepts(&Version::parse("1.11.0").unwrap()));
}

#[test]
fn an_unbounded_entry_constrains_nothing_and_says_so() {
    let support = EngineSupport::unbounded("simple-2d");
    assert!(!support.is_bounded());
    assert_eq!(support.range_display(), "any version");
    assert!(support.accepts(&Version::parse("0.0.0").unwrap()));
}

// --- the stored wire form ---------------------------------------------------

#[test]
fn an_unbounded_entry_round_trips_through_the_bare_slug_it_was_written_as() {
    // A resolved version is serialized into the definition store and read back, so
    // a case that pins nothing must still be stored — and read by anything older —
    // as the plain string array it always was.
    let support = EngineSupport::unbounded("simple-2d");
    let json = serde_json::to_string(&support).expect("serialize");
    assert_eq!(json, "\"simple-2d\"");
    assert_eq!(
        serde_json::from_str::<EngineSupport>(&json).expect("deserialize"),
        support
    );
}

#[test]
fn a_bounded_entry_round_trips_through_the_table_form() {
    let support = bounded("1.0.0", Some("2.0.0"));
    let json = serde_json::to_string(&support).expect("serialize");
    assert_eq!(
        json,
        "{\"slug\":\"simple-2d\",\"minVersion\":\"1.0.0\",\"maxVersion\":\"2.0.0\"}"
    );
    assert_eq!(
        serde_json::from_str::<EngineSupport>(&json).expect("deserialize"),
        support
    );

    // The ceiling is omitted rather than nulled when it is unbounded.
    let open = bounded("1.0.0", None);
    assert_eq!(
        serde_json::to_string(&open).expect("serialize"),
        "{\"slug\":\"simple-2d\",\"minVersion\":\"1.0.0\"}"
    );
}

#[test]
fn a_stored_record_written_before_ranges_existed_still_reads() {
    // The compatibility that matters: every `TestCaseVersion` already in a
    // definition store carries `engines` as an array of plain strings.
    let engines: Vec<EngineSupport> =
        serde_json::from_str("[\"none\",\"simple-2d\"]").expect("deserialize");
    assert_eq!(
        engines,
        vec![
            EngineSupport::unbounded("none"),
            EngineSupport::unbounded("simple-2d"),
        ]
    );
}
