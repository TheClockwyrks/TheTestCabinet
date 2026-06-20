use std::path::PathBuf;

use super::{render_prompt, render_spec};
use crate::test_case::{BuildCommands, SpecFile, TestCaseVersion, TestType, Variant};

/// A minimal resolved version pointing at `prompt_path`, with a single common
/// spec so rendered prompts have something to list.
fn version_with_prompt(prompt_path: PathBuf) -> TestCaseVersion {
    TestCaseVersion {
        slug: "pong".to_string(),
        version: "v1.0.0".to_string(),
        name: "Carom".to_string(),
        difficulty: "easy".to_string(),
        tags: vec![],
        summary: None,
        description_path: None,
        root: PathBuf::from("/tmp/pong"),
        prompt_path,
        max_runtime_seconds: 1800,
        test_type: TestType::EndToEnd,
        build: Some(BuildCommands {
            install: "npm ci".to_string(),
            build: "npm run build".to_string(),
        }),
        canvas: None,
        tool: None,
        output: None,
        common_specs: vec![SpecFile {
            source_path: PathBuf::from("/host/specs/overview.md"),
            dest: PathBuf::from("specs/overview.md"),
        }],
        common_workspace: vec![],
        init: None,
        asset_paths: vec![],
        variants: vec![],
        common_references: vec![],
        common_proofs: vec![],
        checks: vec![],
        common_review_items: vec![],
        domains: vec![],
    }
}

fn frenzy() -> Variant {
    Variant {
        slug: "frenzy".to_string(),
        name: "Frenzy".to_string(),
        description: Some("Standard plus Frenzy.".to_string()),
        specs: vec![SpecFile {
            source_path: PathBuf::from("/host/specs/modes/frenzy.md"),
            dest: PathBuf::from("specs/modes/frenzy.md"),
        }],
        workspace: None,
        references: vec![],
        proofs: vec![],
        review_items: vec![],
    }
}

#[test]
fn renders_workspace_variant_and_spec_paths() {
    let dir = tempfile::tempdir().expect("temp dir");
    let prompt = dir.path().join("prompt.hbs");
    std::fs::write(
        &prompt,
        "Build in {{workspace}} ({{variant.name}}).\n\
         {{#each specs}}- {{this.path}} [{{this.name}}]\n{{/each}}",
    )
    .expect("write prompt");

    let version = version_with_prompt(prompt);
    let out = render_prompt(&version, &frenzy()).expect("render prompt");

    // The workspace and variant come from The Test Cabinet, not the template.
    assert!(out.contains("Build in /work (Frenzy)."));
    // The common spec and the variant's own spec are listed as absolute
    // in-container paths, in seed order (common first).
    assert!(out.contains("- /work/specs/overview.md [overview]"));
    assert!(out.contains("- /work/specs/modes/frenzy.md [frenzy]"));
}

#[test]
fn strict_mode_rejects_unknown_variables() {
    let dir = tempfile::tempdir().expect("temp dir");
    let prompt = dir.path().join("prompt.hbs");
    std::fs::write(&prompt, "{{nope}}").expect("write prompt");

    let version = version_with_prompt(prompt);
    let variant = Variant {
        slug: "base".to_string(),
        name: "Base".to_string(),
        description: None,
        specs: vec![],
        workspace: None,
        references: vec![],
        proofs: vec![],
        review_items: vec![],
    };
    assert!(
        render_prompt(&version, &variant).is_err(),
        "an unknown template variable must be a render error",
    );
}

#[test]
fn missing_prompt_file_is_an_error() {
    let version = version_with_prompt(PathBuf::from("/does/not/exist/prompt.hbs"));
    assert!(render_prompt(&version, &frenzy()).is_err());
}

#[test]
fn render_spec_exposes_the_variant_and_version() {
    let dir = tempfile::tempdir().expect("temp dir");
    let spec = dir.path().join("overview.hbs");
    std::fs::write(
        &spec,
        "Version {{version}} — the {{variant.name}} build ({{variant.slug}}): \
         {{variant.description}}",
    )
    .expect("write spec");

    let version = version_with_prompt(dir.path().join("prompt.hbs"));
    let out = render_spec(&version, &frenzy(), &spec).expect("render spec");

    // The version and variant come from The Test Cabinet, not the spec text.
    assert_eq!(
        out,
        "Version v1.0.0 — the Frenzy build (frenzy): Standard plus Frenzy."
    );
}

#[test]
fn render_spec_rejects_unknown_variables() {
    let dir = tempfile::tempdir().expect("temp dir");
    let spec = dir.path().join("overview.hbs");
    // A spec template sees only the variant and version; the prompt-only
    // `workspace` is not in scope, so referencing it is a strict-mode error.
    std::fs::write(&spec, "{{workspace}}").expect("write spec");

    let version = version_with_prompt(dir.path().join("prompt.hbs"));
    assert!(
        render_spec(&version, &frenzy(), &spec).is_err(),
        "a spec template referencing an unknown variable must be a render error",
    );
}

#[test]
fn render_spec_missing_file_is_an_error() {
    let version = version_with_prompt(PathBuf::from("/tmp/prompt.hbs"));
    assert!(
        render_spec(
            &version,
            &frenzy(),
            &PathBuf::from("/does/not/exist/overview.hbs")
        )
        .is_err()
    );
}
