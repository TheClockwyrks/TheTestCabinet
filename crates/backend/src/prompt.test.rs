//! Tests for rendering a stored version's prompt the way a run of it receives it.

use super::fixture::{CASE, EXPORTED, IngestedSuite, PREVIEW, engine};
use super::*;

use test_cabinet_core::test_suite::SUITE_VARIANT_SLUG;

/// The prompt a run of `version` on `engine` is handed, rendered through the run
/// path off the resolved checkout.
fn run_prompt(suite: &IngestedSuite, version: &str, engine: Option<&ResolvedEngine>) -> String {
    let resolved = suite.resolve(version);
    let variant = resolved
        .variant(SUITE_VARIANT_SLUG)
        .expect("the implicit variant");
    test_cabinet_core::render_case_prompt(&resolved, variant, &[], engine)
        .expect("the run renders the prompt")
}

/// The prompt the store renders for `version` on `engine`.
fn stored_prompt(suite: &IngestedSuite, version: &str, engine: Option<&ResolvedEngine>) -> String {
    let manifest = suite
        .store
        .read_manifest(CASE, version)
        .expect("the version is stored");
    let record = suite
        .store
        .read_suite_of(&manifest)
        .expect("the suite record reads")
        .expect("a suite-defined version names its suite version");
    render_stored_prompt(&manifest, &manifest.variants[0], Some(&record), engine)
        .expect("the stored version renders its prompt")
}

#[test]
fn an_exported_version_renders_the_prompt_its_runs_receive() {
    let suite = IngestedSuite::new();
    let simple = engine("simple-2d");
    for engine in [None, Some(&simple)] {
        let stored = stored_prompt(&suite, EXPORTED, engine);
        assert_eq!(stored, run_prompt(&suite, EXPORTED, engine));
    }

    let rendered = stored_prompt(&suite, EXPORTED, Some(&simple));
    // No authored-case preamble: the template is handed over exactly as it renders.
    assert!(
        rendered.starts_with("Build Carom in the workspace at `/work`."),
        "unexpected prompt: {rendered}"
    );
    assert!(
        rendered.contains(
            "- Ball Physics (`ball-physics`, How the ball moves, collides and comes to rest.): `/work/specs/ball-physics.md`"
        ),
        "unexpected prompt: {rendered}"
    );
    assert!(
        rendered.contains("`/work/specs/ball-physics/spin.md`"),
        "unexpected prompt: {rendered}"
    );
    assert!(
        rendered.contains("on the Simple 2D engine (`simple-2d`)"),
        "unexpected prompt: {rendered}"
    );
}

#[test]
fn a_preview_renders_the_prompt_its_runs_receive() {
    let suite = IngestedSuite::new();
    let simple = engine("simple-2d");
    for engine in [None, Some(&simple)] {
        let stored = stored_prompt(&suite, PREVIEW, engine);
        assert_eq!(stored, run_prompt(&suite, PREVIEW, engine));
    }
    let engineless = stored_prompt(&suite, PREVIEW, None);
    assert!(
        engineless.contains("The build runs on no engine"),
        "unexpected prompt: {engineless}"
    );
}

#[test]
fn a_suite_defined_version_without_its_suite_record_is_refused() {
    let suite = IngestedSuite::new();
    let manifest = suite
        .store
        .read_manifest(CASE, EXPORTED)
        .expect("the version is stored");
    let err = render_stored_prompt(&manifest, &manifest.variants[0], None, None)
        .expect_err("the render is refused rather than rendered as an authored case");
    assert!(
        err.to_string().contains("carom@v1.0.0"),
        "unexpected error: {err}"
    );

    // Nor is the record of a different suite version accepted in its place.
    let preview = suite
        .store
        .read_suite("carom", PREVIEW)
        .expect("the preview record reads");
    render_stored_prompt(&manifest, &manifest.variants[0], Some(&preview), None)
        .expect_err("another suite version's record is refused");
}

#[test]
fn an_authored_version_renders_against_the_authored_context() {
    let suite = IngestedSuite::new();
    let mut manifest = suite
        .store
        .read_manifest(CASE, EXPORTED)
        .expect("the version is stored");
    // The same manifest without a suite coordinate is an authored case: its template
    // sees the variant, and a full-stack one opens with the standing directive.
    manifest.suite = None;
    manifest.test_type = test_cabinet_core::TestType::FullStack;
    manifest.prompt_template = "Variant {{variant.slug}} in {{workspace}}.".to_string();
    let variant = &manifest.variants[0];
    let rendered =
        render_stored_prompt(&manifest, variant, None, None).expect("the authored prompt renders");
    let expected = test_cabinet_core::render_prompt_from_template(
        &manifest.slug,
        &manifest.version,
        &manifest.prompt_template,
        &variant.slug,
        &variant.name,
        variant.description.as_deref(),
        &[],
        manifest.test_type,
        manifest.asset_dimension,
        manifest.max_runtime_seconds,
        None,
        0,
        None,
    )
    .expect("the core renders the authored prompt");
    assert_eq!(rendered, expected);
    assert!(
        rendered.ends_with(&format!("Variant {} in /work.", variant.slug)),
        "unexpected prompt: {rendered}"
    );
    assert_ne!(rendered, format!("Variant {} in /work.", variant.slug));
}
