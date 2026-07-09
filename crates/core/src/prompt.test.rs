use std::path::PathBuf;

use super::{ASSET_QUALITY_PREAMBLE, FULL_STACK_PREAMBLE, render_prompt, render_spec};
use crate::test_case::{BuildCommands, SpecFile, TestCaseVersion, TestType, Variant};

/// A minimal resolved version pointing at `prompt_path`, with a single common
/// spec so rendered prompts have something to list. Defaults to an end-to-end
/// case; use [`version_with_prompt_typed`] to render as another test type.
fn version_with_prompt(prompt_path: PathBuf) -> TestCaseVersion {
    version_with_prompt_typed(prompt_path, TestType::EndToEnd)
}

/// As [`version_with_prompt`], but with an explicit test type — the discriminator
/// that decides whether the asset-generation quality preamble is prepended.
fn version_with_prompt_typed(prompt_path: PathBuf, test_type: TestType) -> TestCaseVersion {
    TestCaseVersion {
        slug: "pong".to_string(),
        version: "v1.0.0".to_string(),
        experimental: false,
        name: "Carom".to_string(),
        difficulty: "easy".to_string(),
        tags: vec![],
        summary: None,
        description_path: None,
        changelog_path: std::path::PathBuf::new(),
        root: PathBuf::from("/tmp/pong"),
        prompt_path,
        max_runtime_seconds: 1800,
        test_type,
        build: Some(BuildCommands {
            install: "npm ci".to_string(),
            build: "npm run build".to_string(),
            module: None,
        }),
        canvas: None,
        tool: None,
        output: None,
        contract: None,
        sandbox: None,
        simulation: None,
        r#match: None,
        replay: None,
        asset_kind: crate::test_case::AssetKind::Sprite,
        sheet: None,
        voxel: None,
        model: None,
        ui: None,
        material: None,
        particle: None,
        audio: None,
        common_specs: vec![SpecFile {
            source_path: PathBuf::from("/host/specs/overview.md"),
            dest: PathBuf::from("specs/overview.md"),
            kind: Default::default(),
        }],
        common_workspace: vec![],
        init: None,
        asset_paths: vec![],
        packages: Vec::new(),
        variants: vec![],
        common_references: vec![],
        common_proofs: vec![],
        checks: vec![],
        common_review_items: vec![],
        domains: vec![],
        cases: vec![],
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
            kind: Default::default(),
        }],
        workspace: None,
        references: vec![],
        proofs: vec![],
        review_items: vec![],
        domains: vec![],
        voxel: None,
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
fn asset_generation_prompts_open_with_the_quality_preamble() {
    let dir = tempfile::tempdir().expect("temp dir");
    let prompt = dir.path().join("prompt.hbs");
    std::fs::write(&prompt, "Sculpt in {{workspace}}.").expect("write prompt");

    let version = version_with_prompt_typed(prompt, TestType::AssetGeneration);
    let out = render_prompt(&version, &frenzy()).expect("render prompt");

    // The shared directive is prepended verbatim, ahead of the case's own text,
    // and the authored template still renders after it.
    assert!(
        out.starts_with(ASSET_QUALITY_PREAMBLE),
        "an asset-generation prompt must open with the quality preamble",
    );
    assert!(out.contains("Sculpt in /work."));
}

#[test]
fn full_stack_prompts_open_with_the_full_stack_preamble() {
    let dir = tempfile::tempdir().expect("temp dir");
    let prompt = dir.path().join("prompt.hbs");
    std::fs::write(&prompt, "Build in {{workspace}}.").expect("write prompt");

    let version = version_with_prompt_typed(prompt, TestType::FullStack);
    let out = render_prompt(&version, &frenzy()).expect("render prompt");

    // A full-stack case opens with its own standing directive — not the
    // asset-generation one — and the authored template still renders after it.
    assert!(
        out.starts_with(FULL_STACK_PREAMBLE),
        "a full-stack prompt must open with the full-stack preamble",
    );
    assert!(!out.contains(ASSET_QUALITY_PREAMBLE));
    assert!(out.contains("Build in /work."));
}

#[test]
fn non_asset_prompts_have_no_quality_preamble() {
    let dir = tempfile::tempdir().expect("temp dir");
    let prompt = dir.path().join("prompt.hbs");
    std::fs::write(&prompt, "Build in {{workspace}}.").expect("write prompt");

    // An end-to-end case renders exactly its template, with nothing prepended.
    let version = version_with_prompt_typed(prompt, TestType::EndToEnd);
    let out = render_prompt(&version, &frenzy()).expect("render prompt");

    assert_eq!(out, "Build in /work.");
    assert!(!out.contains(ASSET_QUALITY_PREAMBLE));
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
        domains: vec![],
        voxel: None,
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

/// A voxel `voxel-model` version at the given volume, so a spec/prompt template
/// can be rendered with `{{voxel}}` in scope.
fn voxel_version(prompt_path: PathBuf, width: u32, height: u32, depth: u32) -> TestCaseVersion {
    let mut version = version_with_prompt_typed(prompt_path, TestType::AssetGeneration);
    version.asset_kind = crate::test_case::AssetKind::VoxelModel;
    version.voxel = Some(crate::test_case::VoxelSpec {
        width,
        height,
        depth,
        background: "transparent".to_string(),
    });
    version
}

#[test]
fn spec_template_injects_the_voxel_dimensions() {
    let dir = tempfile::tempdir().expect("temp dir");
    let spec = dir.path().join("brief.md.hbs");
    // A brief states its volume and axis ranges from the injected context — the
    // max-index fields give the inclusive `0`–N span without template arithmetic.
    std::fs::write(
        &spec,
        "{{voxel.width}}x{{voxel.height}}x{{voxel.depth}}, x 0-{{voxel.maxX}} \
         y 0-{{voxel.maxY}} z 0-{{voxel.maxZ}}",
    )
    .expect("write spec");

    let version = voxel_version(dir.path().join("prompt.hbs"), 50, 20, 76);
    let out = render_spec(&version, &frenzy(), &spec).expect("render spec");

    assert_eq!(out, "50x20x76, x 0-49 y 0-19 z 0-75");
}

#[test]
fn spec_template_uses_the_variant_volume_override() {
    let dir = tempfile::tempdir().expect("temp dir");
    let spec = dir.path().join("brief.md.hbs");
    std::fs::write(&spec, "{{voxel.width}}x{{voxel.height}}x{{voxel.depth}}").expect("write spec");

    // The case's [voxel] is 50x20x76, but the selected variant halves it — the
    // brief renders the size the run actually gets.
    let version = voxel_version(dir.path().join("prompt.hbs"), 50, 20, 76);
    let mut half = frenzy();
    half.voxel = Some(crate::test_case::VoxelSpec {
        width: 25,
        height: 10,
        depth: 38,
        background: "transparent".to_string(),
    });

    let out = render_spec(&version, &half, &spec).expect("render spec");
    assert_eq!(out, "25x10x38");
}

#[test]
fn prompt_template_injects_the_voxel_dimensions() {
    let dir = tempfile::tempdir().expect("temp dir");
    let prompt = dir.path().join("prompt.hbs");
    std::fs::write(
        &prompt,
        "Sculpt in a {{voxel.width}}x{{voxel.height}}x{{voxel.depth}} volume.",
    )
    .expect("write prompt");

    let version = voxel_version(prompt, 40, 30, 80);
    let out = render_prompt(&version, &frenzy()).expect("render prompt");

    // Asset-generation prompts carry the shared preamble, then the rendered body.
    assert!(out.starts_with(ASSET_QUALITY_PREAMBLE));
    assert!(out.contains("Sculpt in a 40x30x80 volume."));
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
