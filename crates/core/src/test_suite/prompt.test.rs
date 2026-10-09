//! Tests for rendering a suite-defined case's prompt, driven by the committed
//! fixture suite at `crates/contracts/fixtures/test-suite/carom/versions/v1.0.0/`.

use std::path::{Path, PathBuf};

use super::*;
use crate::test_suite::TestSuiteCatalog;

/// The committed fixture checkout — the directory holding the `carom/` suite.
fn checkout() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../contracts/fixtures/test-suite")
}

/// Resolve one fixture definition, rendering its specifications into `dir`.
fn resolve(dir: &Path, definition: &str) -> TestCaseVersion {
    TestSuiteCatalog::with_materials(checkout(), dir)
        .resolve("carom", "v1.0.0", definition)
        .unwrap_or_else(|err| panic!("{definition} should resolve: {err}"))
}

#[test]
fn a_suite_defined_case_is_recognized_by_its_version_folder() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let resolved = resolve(dir.path(), "end-to-end");
    assert!(is_suite_defined(&resolved));
}

#[test]
fn renders_the_definitions_template_against_the_documented_context() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let resolved = resolve(dir.path(), "end-to-end");
    let rendered = render_definition_prompt(&resolved, None).expect("the prompt renders");
    // The fixture template interpolates the workspace and the engine name.
    assert!(rendered.contains("/work"), "unexpected prompt: {rendered}");
    assert!(rendered.contains("Carom"), "unexpected prompt: {rendered}");
}

#[test]
fn a_variable_outside_the_context_is_a_render_error() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let mut resolved = resolve(dir.path(), "end-to-end");
    // A template naming a variable the suite context does not expose renders as the
    // error strict mode makes of it, rather than as a blank.
    let template = dir.path().join("off-context.hbs");
    std::fs::write(&template, "{{variant.slug}}").expect("the template is written");
    resolved.prompt_path = template;
    let err = render_definition_prompt(&resolved, None).expect_err("the render is refused");
    assert!(
        format!("{err}").contains("variant"),
        "unexpected error: {err}"
    );
}

#[test]
fn the_covered_specifications_carry_their_seeded_paths() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let resolved = resolve(dir.path(), "end-to-end");
    let template = dir.path().join("specs.hbs");
    std::fs::write(
        &template,
        "{{#each specifications}}{{this.id}}={{this.path}}\n{{/each}}",
    )
    .expect("the template is written");
    let mut with_specs = resolved.clone();
    with_specs.prompt_path = template;
    let rendered = render_definition_prompt(&with_specs, None).expect("the prompt renders");
    // The definition covers `ball-physics` and `ball-spin`, in that order, each
    // named by the absolute in-container path seeding writes it at.
    assert!(
        rendered.starts_with("ball-physics=/work/specs/"),
        "unexpected prompt: {rendered}"
    );
    assert!(
        rendered.contains("ball-spin=/work/specs/"),
        "unexpected prompt: {rendered}"
    );
}

#[test]
fn a_definition_read_as_records_renders_the_prompt_its_tree_renders() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let mut resolved = resolve(dir.path(), "end-to-end");
    let template = "Build in {{workspace}} on {{engine.slug}}.\n\
        {{#each specifications}}- {{this.name}} ({{this.id}}): {{this.summary}} at {{this.path}}\n{{/each}}";
    let template_path = dir.path().join("full.hbs");
    std::fs::write(&template_path, template).expect("the template is written");
    resolved.prompt_path = template_path;
    let engine = crate::engine::EngineCatalog::default()
        .resolve(&crate::engine::EngineSelection::new(
            "simple-2d".to_string(),
        ))
        .expect("the simple-2d engine");
    let from_tree =
        render_definition_prompt(&resolved, Some(&engine)).expect("the tree renders the prompt");

    // The same suite version, held as the flattened records a store serves.
    let root = checkout().join("carom/versions/v1.0.0");
    let loaded = load_suite_manifest_of(&root)
        .and_then(|suite| SuiteVersion::load(&suite, &root))
        .expect("the fixture version loads");
    let mut folders = Vec::new();
    flatten_specifications(&loaded.specifications, &mut folders);
    let declared: Vec<&SpecificationManifest> =
        folders.iter().map(|folder| &folder.manifest).collect();
    let definition = loaded
        .test_cases
        .iter()
        .find(|case| case.slug == "end-to-end")
        .expect("the end-to-end definition");
    let from_records = render_suite_definition_prompt(
        "carom",
        "v1.0.0",
        "end-to-end",
        &definition.definition,
        &declared,
        template,
        Some(&engine),
    )
    .expect("the records render the prompt");

    assert_eq!(from_records, from_tree);
    assert!(
        from_records.starts_with("Build in /work on simple-2d.\n- Ball Physics (ball-physics):"),
        "unexpected prompt: {from_records}"
    );
    assert!(
        from_records.contains("Ball Spin (ball-spin): How spin is imparted, carried and spent. at /work/specs/ball-physics/spin.md"),
        "unexpected prompt: {from_records}"
    );
}

#[test]
fn a_record_naming_an_undeclared_specification_is_refused_by_name() {
    let root = checkout().join("carom/versions/v1.0.0");
    let loaded = load_suite_manifest_of(&root)
        .and_then(|suite| SuiteVersion::load(&suite, &root))
        .expect("the fixture version loads");
    let mut definition = loaded
        .test_cases
        .iter()
        .find(|case| case.slug == "end-to-end")
        .expect("the end-to-end definition")
        .definition
        .clone();
    definition.specifications = Some(vec!["nowhere".to_string()]);
    let err = render_suite_definition_prompt(
        "carom",
        "v1.0.0",
        "end-to-end",
        &definition,
        &[],
        "{{workspace}}",
        None,
    )
    .expect_err("the render is refused");
    let message = err.to_string();
    assert!(message.contains("nowhere"), "unexpected error: {message}");
}
