use std::path::PathBuf;

use super::{
    ASSET_QUALITY_PREAMBLE, FULL_STACK_PREAMBLE, GAME_JAM_DIVIDER, GAME_JAM_PREAMBLE,
    GAME_JAM_README_DIRECTIVE, render_prompt, render_spec,
};
use crate::engine::{EngineCatalog, EngineSelection, NONE_SLUG, ResolvedEngine};
use crate::execution::GAME_JAM_PRIOR_ENTRIES_DIR;
use crate::run_record::PriorGameJamEntry;
use crate::test_case::{BuildCommands, SpecFile, TestCaseVersion, TestType, Variant};

/// A prior game-jam entry with the given README, for exercising the distinctness
/// section. The finished-at stamp is fixed so tests need not thread a clock.
fn prior_entry(readme: &str) -> PriorGameJamEntry {
    PriorGameJamEntry {
        run_id: "run-123".to_string(),
        finished_at: "2026-01-01T00:00:00Z".to_string(),
        readme: readme.to_string(),
    }
}

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
        toolchain: None,
        instrumentation: None,
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
        engines: vec![crate::EngineSupport::unbounded(crate::engine::NONE_SLUG)],
        variants: vec![],
        common_references: vec![],
        common_proofs: vec![],
        checks: vec![],
        common_review_items: vec![],
        domains: vec![],
        cases: vec![],
        errata: vec![],
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
        reference_impls: Default::default(),
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
    let out = render_prompt(&version, &frenzy(), &[], None).expect("render prompt");

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
    let out = render_prompt(&version, &frenzy(), &[], None).expect("render prompt");

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
    let out = render_prompt(&version, &frenzy(), &[], None).expect("render prompt");

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
fn game_jam_prompts_open_with_the_preamble_then_a_divider() {
    let dir = tempfile::tempdir().expect("temp dir");
    let prompt = dir.path().join("prompt.hbs");
    std::fs::write(&prompt, "# My theme\n\nBuild in {{workspace}}.").expect("write prompt");

    let version = version_with_prompt_typed(prompt, TestType::GameJam);
    let out = render_prompt(&version, &frenzy(), &[], None).expect("render prompt");

    // A game jam opens with its standing preamble, then a divider fences that
    // general framing off from the jam's own rendered brief.
    assert!(
        out.starts_with(GAME_JAM_PREAMBLE),
        "a game-jam prompt must open with the game-jam preamble",
    );
    assert!(
        out.contains(&format!("{GAME_JAM_PREAMBLE}\n\n{GAME_JAM_DIVIDER}\n\n")),
        "the divider must sit between the preamble and the body",
    );
    // The model never sees another test type, so the preamble must not lean on
    // "full-stack" as a point of reference.
    assert!(!GAME_JAM_PREAMBLE.contains("full-stack"));
    assert!(out.contains("Build in /work."));
    assert!(!out.contains(ASSET_QUALITY_PREAMBLE));
    // Every jam prompt closes with the standing README requirement, after the body.
    assert!(
        out.contains(GAME_JAM_README_DIRECTIVE),
        "a game-jam prompt must carry the standing README directive",
    );
    let body_index = out.find("Build in /work.").expect("body present");
    let readme_index = out
        .find(GAME_JAM_README_DIRECTIVE)
        .expect("directive present");
    assert!(
        readme_index > body_index,
        "the README directive must follow the jam's own brief",
    );
}

#[test]
fn game_jam_prompt_adds_a_distinctness_section_only_when_prior_entries_exist() {
    let dir = tempfile::tempdir().expect("temp dir");
    let prompt = dir.path().join("prompt.hbs");
    std::fs::write(&prompt, "# My theme\n\nBuild in {{workspace}}.").expect("write prompt");
    let version = version_with_prompt_typed(prompt, TestType::GameJam);

    // With no prior entries, there is no distinctness section: nothing points the
    // model at the previous-entries folder. (The standing README directive mentions
    // making an entry "distinct", so the folder pointer is the reliable signal.)
    let none = render_prompt(&version, &frenzy(), &[], None).expect("render prompt");
    assert!(!none.contains(GAME_JAM_PRIOR_ENTRIES_DIR));

    // With prior entries, the section appears — after the README directive — and
    // points the model at the seeded (git-ignored) previous-entries folder.
    let entries = [
        prior_entry("# Space Miner\n\nDig for ore."),
        prior_entry("# Tide Pool"),
    ];
    let out = render_prompt(&version, &frenzy(), &entries, None).expect("render prompt");
    assert!(
        out.contains(GAME_JAM_PRIOR_ENTRIES_DIR),
        "the distinctness section must point at the previous-entries folder",
    );
    assert!(
        out.contains("2 earlier entries"),
        "it states how many entries exist"
    );
    assert!(out.to_uppercase().contains("DISTINCT"));
    let readme_index = out
        .find(GAME_JAM_README_DIRECTIVE)
        .expect("directive present");
    let distinct_index = out
        .find(GAME_JAM_PRIOR_ENTRIES_DIR)
        .expect("section present");
    assert!(
        distinct_index > readme_index,
        "the distinctness section comes after the standing README directive",
    );
}

#[test]
fn game_jam_distinctness_section_singularizes_a_lone_prior_entry() {
    let dir = tempfile::tempdir().expect("temp dir");
    let prompt = dir.path().join("prompt.hbs");
    std::fs::write(&prompt, "# My theme\n\nBuild in {{workspace}}.").expect("write prompt");
    let version = version_with_prompt_typed(prompt, TestType::GameJam);

    let out =
        render_prompt(&version, &frenzy(), &[prior_entry("# Only one")], None).expect("render");
    assert!(
        out.contains("one earlier entry"),
        "a single prior entry reads in the singular"
    );
    assert!(!out.contains("1 earlier entries"));
}

#[test]
fn non_game_jam_prompts_ignore_prior_entries() {
    let dir = tempfile::tempdir().expect("temp dir");
    let prompt = dir.path().join("prompt.hbs");
    std::fs::write(&prompt, "Build in {{workspace}}.").expect("write prompt");

    // Even if prior entries are somehow supplied, a non-jam type never grows a
    // distinctness section or the README directive — those are game-jam-only.
    let version = version_with_prompt_typed(prompt, TestType::EndToEnd);
    let out =
        render_prompt(&version, &frenzy(), &[prior_entry("# Ignored")], None).expect("render");
    assert_eq!(out, "Build in /work.");
}

#[test]
fn non_asset_prompts_have_no_quality_preamble() {
    let dir = tempfile::tempdir().expect("temp dir");
    let prompt = dir.path().join("prompt.hbs");
    std::fs::write(&prompt, "Build in {{workspace}}.").expect("write prompt");

    // An end-to-end case renders exactly its template, with nothing prepended.
    let version = version_with_prompt_typed(prompt, TestType::EndToEnd);
    let out = render_prompt(&version, &frenzy(), &[], None).expect("render prompt");

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
        reference_impls: Default::default(),
    };
    assert!(
        render_prompt(&version, &variant, &[], None).is_err(),
        "an unknown template variable must be a render error",
    );
}

#[test]
fn missing_prompt_file_is_an_error() {
    let version = version_with_prompt(PathBuf::from("/does/not/exist/prompt.hbs"));
    assert!(render_prompt(&version, &frenzy(), &[], None).is_err());
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
    let out = render_spec(&version, &frenzy(), &spec, None).expect("render spec");

    // The version and variant come from The Test Cabinet, not the spec text.
    assert_eq!(
        out,
        "Version v1.0.0 — the Frenzy build (frenzy): Standard plus Frenzy."
    );
}

#[test]
fn spec_template_branches_on_the_variant_slug() {
    let dir = tempfile::tempdir().expect("temp dir");
    let spec = dir.path().join("instrumentation.md.hbs");
    // The `eq`/`ne` helpers let one common spec carry variant-specific wording,
    // selected by the resolved variant's slug rather than duplicating the file.
    // Block tags standing alone on a line are stripped whole (Mustache standalone
    // handling), so the rendered Markdown carries no blank-line artifacts — the
    // shape a real spec uses to carry a variant-specific paragraph.
    std::fs::write(
        &spec,
        "Intro line.\n\
         {{#if (eq variant.slug \"frenzy\")}}\n\
         - three balls in play\n\
         {{else}}\n\
         - one ball in play\n\
         {{/if}}\n\
         Outro line.\n",
    )
    .expect("write spec");

    let version = version_with_prompt(dir.path().join("prompt.hbs"));

    let frenzy_out = render_spec(&version, &frenzy(), &spec, None).expect("render spec");
    assert_eq!(
        frenzy_out,
        "Intro line.\n- three balls in play\nOutro line.\n"
    );

    let mut other = frenzy();
    other.slug = "base".to_string();
    let base_out = render_spec(&version, &other, &spec, None).expect("render spec");
    assert_eq!(base_out, "Intro line.\n- one ball in play\nOutro line.\n");
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
    let out = render_spec(&version, &frenzy(), &spec, None).expect("render spec");

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

    let out = render_spec(&version, &half, &spec, None).expect("render spec");
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
    let out = render_prompt(&version, &frenzy(), &[], None).expect("render prompt");

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
        render_spec(&version, &frenzy(), &spec, None).is_err(),
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
            &PathBuf::from("/does/not/exist/overview.hbs"),
            None,
        )
        .is_err()
    );
}

/// Resolve a built-in engine by slug, for the tests that render with one
/// selected. Resolution is what a real run does, so these exercise the actual
/// catalogue manifests rather than a hand-built [`ResolvedEngine`] that could
/// drift from them.
fn engine(slug: &str) -> ResolvedEngine {
    EngineCatalog::new()
        .resolve(&EngineSelection::new(slug))
        .expect("built-in engine resolves")
}

/// A prompt template that prints the whole engine context, so a test can assert
/// on all three fields at once.
const ENGINE_PROBE: &str = "{{engine.slug}}|{{engine.name}}|{{engine.docs}}|";

#[test]
fn prompt_template_renders_the_sentinel_engine_for_an_engineless_run() {
    let dir = tempfile::tempdir().expect("temp dir");
    let prompt = dir.path().join("prompt.hbs");
    std::fs::write(&prompt, ENGINE_PROBE).expect("write prompt");

    let version = version_with_prompt(prompt);
    let out = render_prompt(&version, &frenzy(), &[], None).expect("render prompt");

    // The engine field is always present — strict mode would make an absent one a
    // render error — so a run with no engine gets the sentinel, and `docs` is
    // empty because nothing was seeded for the build to read.
    assert_eq!(out, "none|None||");
}

#[test]
fn prompt_template_renders_the_selected_engine_and_its_docs_path() {
    let dir = tempfile::tempdir().expect("temp dir");
    let prompt = dir.path().join("prompt.hbs");
    std::fs::write(&prompt, ENGINE_PROBE).expect("write prompt");

    let version = version_with_prompt(prompt);
    let out =
        render_prompt(&version, &frenzy(), &[], Some(&engine("simple-2d"))).expect("render prompt");

    // The docs path is the in-container one, built from the workspace root and the
    // fixed directory seeding flattens the engine's documentation into — never the
    // `docs` directory name from inside the package.
    assert_eq!(out, "simple-2d|Simple 2D|/work/engine|");
}

#[test]
fn prompt_template_branches_on_the_engine_slug() {
    let dir = tempfile::tempdir().expect("temp dir");
    let prompt = dir.path().join("prompt.hbs");
    // The shape a real `prompt.hbs` uses: one template that grows an engine
    // section only when an engine is selected, guarded by the registered `ne`
    // helper rather than by the field being absent.
    std::fs::write(
        &prompt,
        "Build in {{workspace}}.\n\
         {{#if (ne engine.slug \"none\")}}\n\
         Read the {{engine.name}} docs at {{engine.docs}}.\n\
         {{/if}}\n",
    )
    .expect("write prompt");
    let version = version_with_prompt(prompt);

    let engineless = render_prompt(&version, &frenzy(), &[], None).expect("render prompt");
    assert_eq!(engineless, "Build in /work.\n");

    let with_engine =
        render_prompt(&version, &frenzy(), &[], Some(&engine("simple-2d"))).expect("render prompt");
    assert_eq!(
        with_engine,
        "Build in /work.\nRead the Simple 2D docs at /work/engine.\n"
    );
}

#[test]
fn spec_template_renders_the_engine_too() {
    let dir = tempfile::tempdir().expect("temp dir");
    let spec = dir.path().join("instrumentation.md.hbs");
    std::fs::write(&spec, ENGINE_PROBE).expect("write spec");

    let version = version_with_prompt(dir.path().join("prompt.hbs"));

    // A spec sees the engine on exactly the same terms as the prompt: always
    // present, sentinel when there is none. That is what lets one authored spec
    // state what the build must implement itself and what the engine provides.
    let engineless = render_spec(&version, &frenzy(), &spec, None).expect("render spec");
    assert_eq!(engineless, "none|None||");

    let with_engine =
        render_spec(&version, &frenzy(), &spec, Some(&engine("simple-2d"))).expect("render spec");
    assert_eq!(with_engine, "simple-2d|Simple 2D|/work/engine|");
}

#[test]
fn spec_template_branches_on_the_engine_slug() {
    let dir = tempfile::tempdir().expect("temp dir");
    let spec = dir.path().join("balls.md.hbs");
    std::fs::write(
        &spec,
        "Intro line.\n\
         {{#if (ne engine.slug \"none\")}}\n\
         - integrate against the delta time the engine hands you\n\
         {{else}}\n\
         - integrate at a fixed 120 Hz timestep\n\
         {{/if}}\n\
         Outro line.\n",
    )
    .expect("write spec");
    let version = version_with_prompt(dir.path().join("prompt.hbs"));

    let engineless = render_spec(&version, &frenzy(), &spec, None).expect("render spec");
    assert_eq!(
        engineless,
        "Intro line.\n- integrate at a fixed 120 Hz timestep\nOutro line.\n"
    );

    let with_engine =
        render_spec(&version, &frenzy(), &spec, Some(&engine("simple-2d"))).expect("render spec");
    assert_eq!(
        with_engine,
        "Intro line.\n- integrate against the delta time the engine hands you\nOutro line.\n"
    );
}

#[test]
fn engineless_context_matches_the_none_engine() {
    let dir = tempfile::tempdir().expect("temp dir");
    let prompt = dir.path().join("prompt.hbs");
    std::fs::write(&prompt, ENGINE_PROBE).expect("write prompt");
    let version = version_with_prompt(prompt);

    // Selecting `none` explicitly and selecting nothing at all must be
    // indistinguishable to a template, which is what lets a case declare `none` in
    // its `engines` list for readability without changing a single rendered word.
    // This is also the guard on the hardcoded sentinel name in `prompt.rs`: if
    // `engines/none/engine.toml` were renamed, these two would diverge.
    let selected =
        render_prompt(&version, &frenzy(), &[], Some(&engine(NONE_SLUG))).expect("render prompt");
    let unselected = render_prompt(&version, &frenzy(), &[], None).expect("render prompt");

    assert_eq!(selected, unselected);
    assert_eq!(selected, "none|None||");
}

#[test]
fn an_engine_without_a_docs_directory_renders_an_empty_docs_path() {
    let dir = tempfile::tempdir().expect("temp dir");
    let prompt = dir.path().join("prompt.hbs");
    std::fs::write(&prompt, "[{{engine.docs}}]").expect("write prompt");
    let version = version_with_prompt(prompt);

    // `docs` tracks what seeding actually wrote, not whether an engine exists: an
    // engine that ships no documentation tree has nothing seeded, so the path is
    // blank and a template must guard on `engine.slug` instead.
    let mut docless = engine("simple-2d");
    docless.manifest.docs = None;

    let out = render_prompt(&version, &frenzy(), &[], Some(&docless)).expect("render prompt");
    assert_eq!(out, "[]");
}
