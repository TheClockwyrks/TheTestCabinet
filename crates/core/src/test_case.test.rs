//! Tests for manifest resolution, focused on the `[build]` command table.

use std::fs;

use super::{AssetKind, BuildCommands, TestCaseCatalog, TestType};

/// Write a minimal resolvable version (`prompt.hbs` + `test-case.toml`) under a
/// fresh catalog and return both the temp dir (kept alive) and the catalog rooted
/// at it. `manifest_extra` is spliced between the required
/// `name`/`difficulty`/`tags`/`prompt` header and the single `base` variant, so a
/// test can drop in a `[build]` table.
fn catalog_with_manifest(manifest_extra: &str) -> (tempfile::TempDir, TestCaseCatalog) {
    let dir = tempfile::tempdir().expect("temp dir");
    let version = dir.path().join("demo/v1.0.0");
    fs::create_dir_all(version.join("variants")).expect("create version dir");
    fs::write(version.join("prompt.hbs"), "Build it.").expect("write prompt");
    // Variants live in their own files; the manifest lists one `base` variant. The
    // `variants` list is a root key, so it precedes `manifest_extra` (which usually
    // opens with a `[build]`/`[canvas]` table header).
    let manifest = format!(
        "slug = \"demo\"\nname = \"Demo\"\ndifficulty = \"easy\"\ntags = []\nprompt = \"prompt.hbs\"\n\
         variants = [\"variants/base.toml\"]\n{manifest_extra}\n\
         [[domain]]\nid = \"gameplay\"\ndescription = \"Core gameplay.\"\n"
    );
    fs::write(version.join("test-case.toml"), manifest).expect("write manifest");
    fs::write(version.join("variants/base.toml"), "slug = \"base\"\n").expect("write variant");
    let catalog = TestCaseCatalog::new(dir.path());
    (dir, catalog)
}

#[test]
fn build_table_is_required() {
    // No `[build]` table at all: there are no defaults, so resolution fails.
    let (_dir, catalog) = catalog_with_manifest("");
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a missing [build] table is rejected");
    assert!(
        format!("{err}").contains("the [build] table is required"),
        "unexpected error: {err}"
    );
}

#[test]
fn build_table_sets_the_commands() {
    let (_dir, catalog) = catalog_with_manifest(
        "[build]\ninstall = \"pnpm install --frozen-lockfile\"\nbuild = \"pnpm build\"",
    );
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    assert_eq!(
        version.build,
        Some(BuildCommands {
            install: "pnpm install --frozen-lockfile".to_string(),
            build: "pnpm build".to_string(),
            module: None,
        })
    );
    assert_eq!(version.test_type, TestType::EndToEnd);
}

#[test]
fn only_asset_generation_releases_no_source_repo() {
    // Code-writing types release a per-run public source repo on publish;
    // asset-generation (whose output is the recorded drawing operations, uploaded
    // separately) does not, and creates no GitHub repo. The rule is "everything but
    // asset-generation", so a new code-writing type — performance was the latest —
    // opts in automatically.
    assert!(TestType::EndToEnd.releases_source_repo());
    assert!(TestType::Adversarial.releases_source_repo());
    assert!(TestType::Performance.releases_source_repo());
    assert!(!TestType::AssetGeneration.releases_source_repo());
}

// --- asset-generation resolution -------------------------------------------

/// A complete, valid asset-generation manifest. Tests clone this and mutate one
/// thing to exercise a single validation rule.
const VALID_ASSET_MANIFEST: &str = "\
slug = \"sprite\"\n\
name = \"Sprite\"\n\
difficulty = \"medium\"\n\
tags = [\"asset-generation\"]\n\
prompt = \"prompt.hbs\"\n\
type = \"asset-generation\"\n\
variants = [\"variants/base.toml\"]\n\
[canvas]\nwidth = 64\nheight = 64\nbackground = \"transparent\"\n\
[tool]\nbinary = \"draw\"\npreview = \"canvas.png\"\n\
[output]\nactions = \"actions.json\"\n\
[[spec]]\nsource = \"specs/brief.md\"\ndest = \"specs/brief.md\"\n\
[[domain]]\nid = \"fidelity\"\ndescription = \"How close the sprite is to the brief.\"\n";

/// Write an asset-generation version with all the files a valid one needs
/// (prompt, seeded brief, the `base` variant file) and the given manifest, then
/// return the catalog. An asset-generation case has no target image, so none is
/// written. No operations schema is written either — the binary's `--help` is the
/// contract.
fn asset_catalog(manifest: &str) -> (tempfile::TempDir, TestCaseCatalog) {
    let dir = tempfile::tempdir().expect("temp dir");
    let version = dir.path().join("sprite/v1.0.0");
    fs::create_dir_all(version.join("specs")).expect("specs dir");
    fs::create_dir_all(version.join("variants")).expect("variants dir");
    fs::write(version.join("prompt.hbs"), "Draw it.").expect("prompt");
    fs::write(version.join("specs/brief.md"), "The brief.").expect("brief");
    fs::write(version.join("variants/base.toml"), "slug = \"base\"\n").expect("variant");
    fs::write(version.join("test-case.toml"), manifest).expect("manifest");
    let catalog = TestCaseCatalog::new(dir.path());
    (dir, catalog)
}

#[test]
fn asset_generation_case_resolves_its_tables() {
    let (_dir, catalog) = asset_catalog(VALID_ASSET_MANIFEST);
    let version = catalog.resolve("sprite", "v1.0.0").expect("resolve");
    assert_eq!(version.test_type, TestType::AssetGeneration);
    assert!(version.build.is_none(), "asset-gen has no build");
    let canvas = version.canvas.as_ref().expect("canvas");
    assert_eq!((canvas.width, canvas.height), (64, 64));
    let tool = version.tool.as_ref().expect("tool");
    assert_eq!(tool.binary, "draw");
    assert_eq!(
        version.output.as_ref().expect("output").actions.to_str(),
        Some("actions.json")
    );
    // No operations schema is seeded — the binary's `--help` is the contract.
    assert!(
        !version
            .common_specs
            .iter()
            .any(|spec| spec.dest.to_str() == Some("schemas/operations.json")),
        "no operations schema is seeded"
    );
}

#[test]
fn asset_generation_rejects_a_build_table() {
    let manifest = format!("{VALID_ASSET_MANIFEST}[build]\ninstall = \"x\"\nbuild = \"y\"\n");
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a [build] table on an asset-gen case is rejected");
    assert!(format!("{err}").contains("no [build] table"), "got: {err}");
}

#[test]
fn asset_generation_requires_canvas_tool_output() {
    // Drop the [output] table: resolution must fail.
    let manifest = VALID_ASSET_MANIFEST.replace("[output]\nactions = \"actions.json\"\n", "");
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("missing [output] is rejected");
    assert!(
        format!("{err}").contains("[output] table is required"),
        "got: {err}"
    );
}

#[test]
fn asset_generation_rejects_checks() {
    let manifest = format!("{VALID_ASSET_MANIFEST}[[check]]\nview = \"target\"\n");
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a [[check]] on an asset-gen case is rejected");
    assert!(format!("{err}").contains("no [[check]]"), "got: {err}");
}

#[test]
fn asset_generation_rejects_a_reference() {
    // An asset-generation case is human-reviewed against the brief and has no
    // target to score against, so any [[reference]] is rejected.
    let manifest = format!(
        "{VALID_ASSET_MANIFEST}[[reference]]\nview = \"target\"\nmedia = \"reference/target.png\"\n"
    );
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a [[reference]] on an asset-gen case is rejected");
    assert!(format!("{err}").contains("no [[reference]]"), "got: {err}");
}

#[test]
fn asset_generation_rejects_a_review_item_reference() {
    // A review item cannot pair a reference: there is no target to show as
    // expected.
    let manifest = format!(
        "{VALID_ASSET_MANIFEST}[[review_item]]\nid = \"look\"\ntitle = \"Looks right\"\n\
         text = \"Reads as the subject.\"\nweight = 1\nreference = \"target\"\ndomain = \"fidelity\"\n"
    );
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a review-item reference on an asset-gen case is rejected");
    assert!(
        format!("{err}").contains("declares no `reference`"),
        "got: {err}"
    );
}

// --- sprite-sheet resolution -----------------------------------------------

/// A complete, valid sprite-sheet manifest: a 32x32 frame canvas, two declared
/// frames, and one named sequence over them. Tests clone this and mutate one
/// thing. The preview/actions paths are `{frame}` templates since every frame is
/// a separate file.
const VALID_SHEET_MANIFEST: &str = "\
slug = \"sprite\"\n\
name = \"Sheet\"\n\
difficulty = \"medium\"\n\
tags = [\"asset-generation\"]\n\
prompt = \"prompt.hbs\"\n\
type = \"asset-generation\"\n\
asset_kind = \"sprite-sheet\"\n\
variants = [\"variants/base.toml\"]\n\
[canvas]\nwidth = 32\nheight = 32\nbackground = \"transparent\"\n\
[tool]\nbinary = \"draw-sheet\"\npreview = \"frames/{frame}.png\"\n\
[output]\nactions = \"frames/{frame}.actions.json\"\n\
[sheet]\n\
[[sheet.frame]]\nindex = 0\n\
[[sheet.frame]]\nindex = 1\n\
[[sheet.sequence]]\nslug = \"walk-right\"\nframes = [0, 1]\nfps = 4.0\n\
[[spec]]\nsource = \"specs/brief.md\"\ndest = \"specs/brief.md\"\n\
[[domain]]\nid = \"fidelity\"\ndescription = \"How close the sheet is to the brief.\"\n";

/// The `[sheet]` block of [`VALID_SHEET_MANIFEST`], for tests that delete it.
const SHEET_BLOCK: &str = "[sheet]\n\
[[sheet.frame]]\nindex = 0\n\
[[sheet.frame]]\nindex = 1\n\
[[sheet.sequence]]\nslug = \"walk-right\"\nframes = [0, 1]\nfps = 4.0\n";

#[test]
fn sprite_sheet_resolves_its_sheet_table() {
    let (_dir, catalog) = asset_catalog(VALID_SHEET_MANIFEST);
    let version = catalog.resolve("sprite", "v1.0.0").expect("resolve");
    assert_eq!(version.asset_kind, AssetKind::SpriteSheet);
    let sheet = version.sheet.as_ref().expect("sheet");
    // Frame dimensions are the canvas dimensions; the frame count is just how many
    // frames are declared.
    assert_eq!((sheet.frame_width, sheet.frame_height), (32, 32));
    assert_eq!(sheet.frames, vec![0, 1]);
    assert_eq!(sheet.sequences.len(), 1);
    let sequence = &sheet.sequences[0];
    assert_eq!(sequence.slug, "walk-right");
    // An omitted name is humanized from the slug.
    assert_eq!(sequence.name, "Walk Right");
    assert_eq!(sequence.frames, vec![0, 1]);
    assert_eq!(sequence.fps, 4.0);
    // An asset-generation case has no target image, so it synthesizes no
    // references at all.
    assert!(
        version.common_references.is_empty(),
        "a sprite sheet declares no references"
    );
}

#[test]
fn single_sprite_defaults_asset_kind() {
    // The original single-sprite manifest declares no `asset_kind`: it defaults to
    // `Sprite` and carries no sheet, so existing cases resolve unchanged.
    let (_dir, catalog) = asset_catalog(VALID_ASSET_MANIFEST);
    let version = catalog.resolve("sprite", "v1.0.0").expect("resolve");
    assert_eq!(version.asset_kind, AssetKind::Sprite);
    assert!(version.sheet.is_none());
}

#[test]
fn sprite_kind_rejects_a_sheet_table() {
    // A single-sprite case (the default kind) that declares a [sheet] table is a
    // mistake.
    let manifest = format!("{VALID_ASSET_MANIFEST}{SHEET_BLOCK}");
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a [sheet] table on a single-sprite case is rejected");
    assert!(
        format!("{err}").contains("declares no [sheet]"),
        "got: {err}"
    );
}

#[test]
fn sprite_sheet_requires_a_sheet_table() {
    let manifest = VALID_SHEET_MANIFEST.replace(SHEET_BLOCK, "");
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a sprite-sheet case without a [sheet] table is rejected");
    assert!(format!("{err}").contains("requires a"), "got: {err}");
}

#[test]
fn sprite_sheet_rejects_a_sheet_with_no_frames() {
    // Drop both [[sheet.frame]] entries but keep a sequence: a sheet must declare
    // its frames.
    let manifest = VALID_SHEET_MANIFEST.replace(
        "[[sheet.frame]]\nindex = 0\n[[sheet.frame]]\nindex = 1\n",
        "",
    );
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a [sheet] with no frames is rejected");
    assert!(
        format!("{err}").contains("at least one [[sheet.frame]]"),
        "got: {err}"
    );
}

#[test]
fn sprite_sheet_rejects_duplicate_frame_index() {
    let manifest = VALID_SHEET_MANIFEST.replace(
        "[[sheet.frame]]\nindex = 1\n",
        "[[sheet.frame]]\nindex = 0\n",
    );
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("two frames with the same index are rejected");
    assert!(
        format!("{err}").contains("duplicate sheet frame index 0"),
        "got: {err}"
    );
}

#[test]
fn sprite_sheet_rejects_undeclared_sequence_frame() {
    // The sheet declares frames 0 and 1; frame 4 is not declared.
    let manifest = VALID_SHEET_MANIFEST.replace("frames = [0, 1]", "frames = [0, 4]");
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a sequence frame that is not a declared frame is rejected");
    assert!(format!("{err}").contains("frame 4"), "got: {err}");
    assert!(format!("{err}").contains("not a declared"), "got: {err}");
}

#[test]
fn sprite_sheet_rejects_empty_sequence() {
    let manifest = VALID_SHEET_MANIFEST.replace("frames = [0, 1]", "frames = []");
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a sequence with no frames is rejected");
    assert!(format!("{err}").contains("no frames"), "got: {err}");
}

#[test]
fn sprite_sheet_rejects_nonpositive_fps() {
    let manifest = VALID_SHEET_MANIFEST.replace("fps = 4.0", "fps = 0.0");
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a non-positive fps is rejected");
    assert!(format!("{err}").contains("fps"), "got: {err}");
}

#[test]
fn sprite_sheet_rejects_duplicate_sequence_slug() {
    let manifest = VALID_SHEET_MANIFEST.replace(
        "[[sheet.sequence]]\nslug = \"walk-right\"\nframes = [0, 1]\nfps = 4.0\n",
        "[[sheet.sequence]]\nslug = \"walk-right\"\nframes = [0, 1]\nfps = 4.0\n\
         [[sheet.sequence]]\nslug = \"walk-right\"\nframes = [1, 0]\nfps = 4.0\n",
    );
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("two sequences with the same slug are rejected");
    assert!(format!("{err}").contains("duplicate"), "got: {err}");
}

#[test]
fn sprite_sheet_requires_a_sequence() {
    let manifest = VALID_SHEET_MANIFEST.replace(
        "[[sheet.sequence]]\nslug = \"walk-right\"\nframes = [0, 1]\nfps = 4.0\n",
        "",
    );
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a [sheet] with no sequences is rejected");
    assert!(format!("{err}").contains("at least one"), "got: {err}");
}

#[test]
fn sprite_sheet_review_item_carries_its_sequences_and_frames() {
    // A review item may name the sheet sequences and frames it is about so the
    // reviewer UI can surface exactly those animations/frames for it.
    let manifest = format!(
        "{VALID_SHEET_MANIFEST}[[review_item]]\n\
         id = \"walk\"\ntitle = \"Walk\"\ntext = \"Reads as walking right.\"\n\
         sequences = [\"walk-right\"]\nframes = [0]\nweight = 2\ndomain = \"fidelity\"\n"
    );
    let (_dir, catalog) = asset_catalog(&manifest);
    let version = catalog.resolve("sprite", "v1.0.0").expect("resolve");
    let item = &version.common_review_items[0];
    assert_eq!(item.sequences, vec!["walk-right".to_string()]);
    assert_eq!(item.frames, vec![0]);
}

#[test]
fn sprite_sheet_review_item_rejects_an_undeclared_sequence() {
    let manifest = format!(
        "{VALID_SHEET_MANIFEST}[[review_item]]\n\
         id = \"walk\"\ntitle = \"Walk\"\ntext = \"Reads as walking right.\"\n\
         sequences = [\"walk-left\"]\nweight = 2\ndomain = \"fidelity\"\n"
    );
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a review item naming an undeclared sequence is rejected");
    assert!(
        format!("{err}").contains("sequence `walk-left`"),
        "got: {err}"
    );
}

#[test]
fn sprite_sheet_review_item_rejects_an_undeclared_frame() {
    let manifest = format!(
        "{VALID_SHEET_MANIFEST}[[review_item]]\n\
         id = \"walk\"\ntitle = \"Walk\"\ntext = \"Reads as walking right.\"\n\
         frames = [9]\nweight = 2\ndomain = \"fidelity\"\n"
    );
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a review item naming an undeclared frame is rejected");
    assert!(format!("{err}").contains("frame `9`"), "got: {err}");
}

#[test]
fn single_sprite_review_item_rejects_sequence_or_frame_refs() {
    // A single sprite has no sheet, so a review item cannot reference sequences or
    // frames — declaring either is a manifest error rather than a dropped ref.
    let manifest = format!(
        "{VALID_ASSET_MANIFEST}[[review_item]]\n\
         id = \"look\"\ntitle = \"Looks right\"\ntext = \"Reads as the imp.\"\n\
         frames = [0]\nweight = 1\n"
    );
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("sequences/frames on a single-sprite review item are rejected");
    assert!(
        format!("{err}").contains("only valid for a sprite-sheet"),
        "got: {err}"
    );
}

#[test]
fn end_to_end_rejects_sprite_sheet_kind() {
    // An end-to-end case (the default type) that declares `asset_kind` is a mistake.
    let (_dir, catalog) = catalog_with_manifest(
        "asset_kind = \"sprite-sheet\"\n[build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"",
    );
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("asset_kind on an e2e case is rejected");
    assert!(
        format!("{err}").contains("only valid for an asset-generation case"),
        "got: {err}"
    );
}

#[test]
fn end_to_end_rejects_asset_tables() {
    // An end-to-end case (the default type) that declares a [canvas] is a mistake.
    let (_dir, catalog) = catalog_with_manifest(
        "[build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n[canvas]\nwidth = 8\nheight = 8",
    );
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("asset tables on an e2e case are rejected");
    assert!(
        format!("{err}").contains("only valid for an asset-generation case"),
        "got: {err}"
    );
}

// --- voxel resolution ------------------------------------------------------

/// A complete, valid static voxel (`voxel-model`) manifest: a bounding volume and
/// the `voxel` tool with plain (non-`{part}`) preview/action paths. Tests clone
/// this and mutate one thing.
const VALID_VOXEL_MODEL_MANIFEST: &str = "\
slug = \"sprite\"\n\
name = \"Jet\"\n\
difficulty = \"medium\"\n\
tags = [\"asset-generation\"]\n\
prompt = \"prompt.hbs\"\n\
type = \"asset-generation\"\n\
asset_kind = \"voxel-model\"\n\
variants = [\"variants/base.toml\"]\n\
[voxel]\nwidth = 24\nheight = 16\ndepth = 32\nbackground = \"transparent\"\n\
[tool]\nbinary = \"voxel\"\npreview = \"model.png\"\n\
[output]\nactions = \"actions.json\"\n\
[[spec]]\nsource = \"specs/brief.md\"\ndest = \"specs/brief.md\"\n\
[[domain]]\nid = \"fidelity\"\ndescription = \"How close the model is to the brief.\"\n";

/// A complete, valid animated voxel (`voxel-animation`) manifest. Its rig contract is
/// only the required animations — a single `walk` — because parts and joints are
/// model-invented. The preview/action paths are `{part}` templates since every part
/// is a separate file.
const VALID_VOXEL_ANIM_MANIFEST: &str = "\
slug = \"sprite\"\n\
name = \"Tank\"\n\
difficulty = \"hard\"\n\
tags = [\"asset-generation\"]\n\
prompt = \"prompt.hbs\"\n\
type = \"asset-generation\"\n\
asset_kind = \"voxel-animation\"\n\
variants = [\"variants/base.toml\"]\n\
[voxel]\nwidth = 24\nheight = 16\ndepth = 24\nbackground = \"transparent\"\n\
[tool]\nbinary = \"voxel-anim\"\npreview = \"parts/{part}.png\"\n\
[output]\nactions = \"parts/{part}.actions.json\"\n\
[[model.animation]]\nname = \"walk\"\n\
[[spec]]\nsource = \"specs/brief.md\"\ndest = \"specs/brief.md\"\n\
[[domain]]\nid = \"fidelity\"\ndescription = \"How close the tank is to the brief.\"\n";

#[test]
fn voxel_model_resolves_its_voxel_table() {
    let (_dir, catalog) = asset_catalog(VALID_VOXEL_MODEL_MANIFEST);
    let version = catalog.resolve("sprite", "v1.0.0").expect("resolve");
    assert_eq!(version.test_type, TestType::AssetGeneration);
    assert_eq!(version.asset_kind, AssetKind::VoxelModel);
    assert!(version.canvas.is_none(), "a voxel case has no [canvas]");
    let voxel = version.voxel.as_ref().expect("voxel");
    assert_eq!((voxel.width, voxel.height, voxel.depth), (24, 16, 32));
    assert_eq!(version.tool.as_ref().expect("tool").binary, "voxel");
    // A static model declares no rig.
    assert!(version.model.is_none(), "a voxel-model has no [model]");
    // An asset-generation case has no target image, so it synthesizes no references.
    assert!(version.common_references.is_empty());
}

#[test]
fn voxel_model_rejects_a_canvas_table() {
    let manifest = format!("{VALID_VOXEL_MODEL_MANIFEST}[canvas]\nwidth = 8\nheight = 8\n");
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a [canvas] on a voxel case is rejected");
    assert!(format!("{err}").contains("not [canvas]"), "got: {err}");
}

#[test]
fn voxel_model_rejects_a_part_token() {
    // A static model writes one file, so a `{part}` template is a mistake.
    let manifest = VALID_VOXEL_MODEL_MANIFEST
        .replace("preview = \"model.png\"", "preview = \"parts/{part}.png\"");
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a {part} token on a voxel-model case is rejected");
    assert!(
        format!("{err}").contains("must not contain `{part}`"),
        "got: {err}"
    );
}

#[test]
fn voxel_model_rejects_a_model_table() {
    let manifest = format!("{VALID_VOXEL_MODEL_MANIFEST}[[model.animation]]\nname = \"idle\"\n");
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a [model] on a voxel-model case is rejected");
    assert!(
        format!("{err}").contains("declares no [model] table"),
        "got: {err}"
    );
}

#[test]
fn voxel_variant_overrides_the_base_volume() {
    // A case whose `double` variant declares its own [voxel] sculpts the same
    // subject at a larger size; the default `base` variant inherits the case's
    // volume. `voxel_for` resolves each to the size that variant runs at.
    let manifest = VALID_VOXEL_MODEL_MANIFEST.replace(
        "variants = [\"variants/base.toml\"]",
        "variants = [\"variants/base.toml\", \"variants/double.toml\"]",
    );
    let (dir, catalog) = asset_catalog(&manifest);
    fs::write(
        dir.path().join("sprite/v1.0.0/variants/double.toml"),
        "slug = \"double\"\nname = \"Double Size\"\n\
         [voxel]\nwidth = 48\nheight = 32\ndepth = 64\nbackground = \"transparent\"\n",
    )
    .expect("write double variant");

    let version = catalog.resolve("sprite", "v1.0.0").expect("resolve");
    let base = version.variant("base").expect("base variant");
    let double = version.variant("double").expect("double variant");

    // The base variant declares no override and inherits the manifest volume; the
    // double variant carries its own and `voxel_for` returns it.
    assert!(base.voxel.is_none(), "base declares no override");
    let base_dims = version.voxel_for(base).expect("base volume");
    assert_eq!(
        (base_dims.width, base_dims.height, base_dims.depth),
        (24, 16, 32)
    );
    let double_dims = version.voxel_for(double).expect("double volume");
    assert_eq!(
        (double_dims.width, double_dims.height, double_dims.depth),
        (48, 32, 64)
    );
}

#[test]
fn voxel_variant_rejects_a_zero_extent() {
    let manifest = VALID_VOXEL_MODEL_MANIFEST.replace(
        "variants = [\"variants/base.toml\"]",
        "variants = [\"variants/base.toml\", \"variants/bad.toml\"]",
    );
    let (dir, catalog) = asset_catalog(&manifest);
    fs::write(
        dir.path().join("sprite/v1.0.0/variants/bad.toml"),
        "slug = \"bad\"\n[voxel]\nwidth = 0\nheight = 16\ndepth = 32\nbackground = \"transparent\"\n",
    )
    .expect("write bad variant");
    let err = catalog
        .resolve("sprite", "v1.0.0")
        .expect_err("a zero-extent variant volume is rejected");
    assert!(format!("{err}").contains("greater than zero"), "got: {err}");
}

#[test]
fn non_voxel_variant_rejects_a_voxel_table() {
    // A 2D sprite case whose variant declares a [voxel] override is a mistake:
    // only a voxel case may vary its volume per variant.
    let manifest = VALID_ASSET_MANIFEST.replace(
        "variants = [\"variants/base.toml\"]",
        "variants = [\"variants/base.toml\", \"variants/big.toml\"]",
    );
    let (dir, catalog) = asset_catalog(&manifest);
    fs::write(
        dir.path().join("sprite/v1.0.0/variants/big.toml"),
        "slug = \"big\"\n[voxel]\nwidth = 8\nheight = 8\ndepth = 8\nbackground = \"transparent\"\n",
    )
    .expect("write big variant");
    let err = catalog
        .resolve("sprite", "v1.0.0")
        .expect_err("a [voxel] override on a non-voxel case is rejected");
    assert!(
        format!("{err}").contains("only a voxel asset-generation case"),
        "got: {err}"
    );
}

#[test]
fn voxel_animation_resolves_its_model() {
    let (_dir, catalog) = asset_catalog(VALID_VOXEL_ANIM_MANIFEST);
    let version = catalog.resolve("sprite", "v1.0.0").expect("resolve");
    assert_eq!(version.asset_kind, AssetKind::VoxelAnimation);
    let voxel = version.voxel.as_ref().expect("voxel");
    assert_eq!((voxel.width, voxel.height, voxel.depth), (24, 16, 24));
    let model = version.model.as_ref().expect("model");
    // The contract is animations-only: parts and joints are model-invented, so the
    // required model declares none of them.
    assert!(model.parts.is_empty(), "parts are model-invented");
    assert!(model.joints.is_empty(), "joints are model-invented");
    // A single required animation, `walk`, defaulting to looping and non-auto-play.
    assert_eq!(model.animations.len(), 1);
    let animation = &model.animations[0];
    assert_eq!(animation.name, "walk");
    assert!(animation.looping, "loop defaults to true");
    assert!(!animation.auto_play, "auto_play defaults to false");
    // The period and driven joints are the model's to choose, so the declaration
    // carries a placeholder period and no joints/keyframes.
    assert_eq!(animation.period_ms, 0);
    assert!(animation.joints.is_empty());
    assert!(animation.tracks.is_empty());
}

#[test]
fn voxel_animation_resolves_a_self_playing_animation() {
    // A required animation may declare its identity — `loop`/`auto_play` — but never
    // parts, joints, a period, or keyframes.
    let manifest = format!(
        "{VALID_VOXEL_ANIM_MANIFEST}[[model.animation]]\nname = \"radar_spin\"\n\
         loop = true\nauto_play = true\n"
    );
    let version = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect("resolve");
    let model = version.model.as_ref().expect("model");
    assert_eq!(model.animations.len(), 2);
    let spin = &model.animations[1];
    assert_eq!(spin.name, "radar_spin");
    assert!(spin.looping);
    assert!(spin.auto_play, "a self-playing idle");
    assert_eq!(spin.period_ms, 0, "the model chooses the period");
    assert!(spin.joints.is_empty(), "joints are model-invented");
}

#[test]
fn voxel_animation_rejects_a_model_with_no_animation() {
    // A [model] whose only job is to name required animations must name at least one:
    // an empty [model] table is rejected.
    let manifest =
        VALID_VOXEL_ANIM_MANIFEST.replace("[[model.animation]]\nname = \"walk\"\n", "[model]\n");
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a [model] with no animation is rejected");
    assert!(
        format!("{err}").contains("at least one [[model.animation]]"),
        "got: {err}"
    );
}

#[test]
fn voxel_animation_rejects_a_duplicate_animation_name() {
    let manifest = format!("{VALID_VOXEL_ANIM_MANIFEST}[[model.animation]]\nname = \"walk\"\n");
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("two required animations of the same name are rejected");
    assert!(
        format!("{err}").contains("duplicate model animation name `walk`"),
        "got: {err}"
    );
}

#[test]
fn voxel_animation_requires_a_model_table() {
    // Drop the whole [model] block (its one animation declaration).
    let manifest = VALID_VOXEL_ANIM_MANIFEST.replace("[[model.animation]]\nname = \"walk\"\n", "");
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a voxel-animation case without a [model] is rejected");
    assert!(
        format!("{err}").contains("requires a [model] table"),
        "got: {err}"
    );
}

#[test]
fn voxel_animation_requires_a_part_token() {
    // An animated model writes one file per part, so a plain path is a mistake.
    let manifest = VALID_VOXEL_ANIM_MANIFEST
        .replace("preview = \"parts/{part}.png\"", "preview = \"model.png\"");
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a plain preview path on a voxel-animation case is rejected");
    assert!(
        format!("{err}").contains("must contain `{part}`"),
        "got: {err}"
    );
}

#[test]
fn sprite_rejects_a_voxel_table() {
    // A 2D sprite case that declares a [voxel] table is a mistake.
    let manifest = format!("{VALID_ASSET_MANIFEST}[voxel]\nwidth = 8\nheight = 8\ndepth = 8\n");
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a [voxel] table on a sprite case is rejected");
    assert!(
        format!("{err}").contains("only valid for a voxel asset-generation case"),
        "got: {err}"
    );
}

#[test]
fn end_to_end_rejects_voxel_tables() {
    // An end-to-end case that declares a [voxel] table is a mistake.
    let (_dir, catalog) = catalog_with_manifest(
        "[build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n\
         [voxel]\nwidth = 8\nheight = 8\ndepth = 8",
    );
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("voxel tables on an e2e case are rejected");
    assert!(
        format!("{err}").contains("only valid for a voxel asset-generation case"),
        "got: {err}"
    );
}

// --- adversarial resolution ------------------------------------------------

/// A complete, valid adversarial manifest. Tests clone this and mutate one thing
/// to exercise a single validation rule.
const VALID_ADVERSARIAL_MANIFEST: &str = "\
slug = \"foray\"\n\
name = \"Foray\"\n\
difficulty = \"hard\"\n\
tags = [\"adversarial\"]\n\
prompt = \"prompt.hbs\"\n\
type = \"adversarial\"\n\
variants = [\"variants/base.toml\"]\n\
[build]\ninstall = \"cargo fetch\"\nbuild = \"cargo build --release --target wasm32-unknown-unknown\"\nmodule = \"target/wasm32-unknown-unknown/release/controller.wasm\"\n\
[contract]\nentry = \"tick\"\nworld = \"schemas/world.json\"\naction = \"schemas/action.json\"\n\
[sandbox]\nfuel_per_tick = 50000000\nmax_memory_bytes = 67108864\n\
[simulation]\ntimestep_ms = 16\nmax_ticks = 37500\n\
[match]\nparticipants = 2\nstructure = \"round-robin\"\nrounds = 1\n\
[replay]\nrenderer = \"replay/index.html\"\n\
[[domain]]\nid = \"play\"\ndescription = \"How well the controller plays.\"\n";

/// Write an adversarial version with all the files a valid one needs (prompt,
/// world/action schemas, replay renderer) and the given manifest, then return the
/// catalog.
fn adversarial_catalog(manifest: &str) -> (tempfile::TempDir, TestCaseCatalog) {
    let dir = tempfile::tempdir().expect("temp dir");
    let version = dir.path().join("foray/v1.0.0");
    fs::create_dir_all(version.join("schemas")).expect("schemas dir");
    fs::create_dir_all(version.join("replay")).expect("replay dir");
    fs::create_dir_all(version.join("variants")).expect("variants dir");
    fs::write(version.join("prompt.hbs"), "Write a controller.").expect("prompt");
    fs::write(version.join("schemas/world.json"), "{}").expect("world schema");
    fs::write(version.join("schemas/action.json"), "{}").expect("action schema");
    fs::write(version.join("replay/index.html"), "<html></html>").expect("renderer");
    fs::write(version.join("variants/base.toml"), "slug = \"base\"\n").expect("variant");
    fs::write(version.join("test-case.toml"), manifest).expect("manifest");
    let catalog = TestCaseCatalog::new(dir.path());
    (dir, catalog)
}

#[test]
fn adversarial_case_resolves_its_tables() {
    let (_dir, catalog) = adversarial_catalog(VALID_ADVERSARIAL_MANIFEST);
    let version = catalog.resolve("foray", "v1.0.0").expect("resolve");
    assert_eq!(version.test_type, TestType::Adversarial);
    let build = version.build.as_ref().expect("build");
    assert_eq!(
        build.module.as_ref().and_then(|m| m.to_str()),
        Some("target/wasm32-unknown-unknown/release/controller.wasm")
    );
    let contract = version.contract.as_ref().expect("contract");
    assert_eq!(contract.entry, "tick");
    let sandbox = version.sandbox.as_ref().expect("sandbox");
    assert_eq!(sandbox.fuel_per_tick, Some(50_000_000));
    assert_eq!(sandbox.fuel_limit, None);
    assert_eq!(sandbox.max_memory_bytes, 67_108_864);
    let simulation = version.simulation.as_ref().expect("simulation");
    assert_eq!((simulation.timestep_ms, simulation.max_ticks), (16, 37_500));
    let r#match = version.r#match.as_ref().expect("match");
    assert_eq!(r#match.participants, 2);
    assert_eq!(r#match.structure, "round-robin");
    assert!(version.replay.is_some(), "replay table resolved");
    // The world/action contract schemas are seeded like any other spec so the
    // model can read them where the contract names them.
    assert!(
        version
            .common_specs
            .iter()
            .any(|spec| spec.dest.to_str() == Some("schemas/world.json")),
        "world schema is seeded as a common spec"
    );
    assert!(
        version
            .common_specs
            .iter()
            .any(|spec| spec.dest.to_str() == Some("schemas/action.json")),
        "action schema is seeded as a common spec"
    );
}

/// Each required adversarial table, with the substring its rejection carries when
/// the table is dropped from the manifest.
const REQUIRED_ADVERSARIAL_TABLES: &[(&str, &str)] = &[
    (
        "[contract]\nentry = \"tick\"\nworld = \"schemas/world.json\"\naction = \"schemas/action.json\"\n",
        "[contract] table is required",
    ),
    (
        "[sandbox]\nfuel_per_tick = 50000000\nmax_memory_bytes = 67108864\n",
        "[sandbox] table is required",
    ),
    (
        "[simulation]\ntimestep_ms = 16\nmax_ticks = 37500\n",
        "[simulation] table is required",
    ),
    (
        "[match]\nparticipants = 2\nstructure = \"round-robin\"\nrounds = 1\n",
        "[match] table is required",
    ),
    (
        "[replay]\nrenderer = \"replay/index.html\"\n",
        "[replay] table is required",
    ),
];

#[test]
fn adversarial_missing_each_required_table_is_rejected() {
    for (table, expected) in REQUIRED_ADVERSARIAL_TABLES {
        let manifest = VALID_ADVERSARIAL_MANIFEST.replace(table, "");
        let err = adversarial_catalog(&manifest)
            .1
            .resolve("foray", "v1.0.0")
            .expect_err("a missing required table is rejected");
        assert!(
            format!("{err}").contains(expected),
            "dropping `{table}` should mention `{expected}`, got: {err}"
        );
    }
}

#[test]
fn adversarial_requires_build_module() {
    // Drop only the `module` line from an otherwise-valid build table.
    let manifest = VALID_ADVERSARIAL_MANIFEST.replace(
        "module = \"target/wasm32-unknown-unknown/release/controller.wasm\"\n",
        "",
    );
    let err = adversarial_catalog(&manifest)
        .1
        .resolve("foray", "v1.0.0")
        .expect_err("a missing build.module is rejected");
    assert!(
        format!("{err}").contains("build.module is required"),
        "got: {err}"
    );
}

#[test]
fn adversarial_rejects_asset_tables() {
    let manifest = format!("{VALID_ADVERSARIAL_MANIFEST}[canvas]\nwidth = 8\nheight = 8\n");
    let err = adversarial_catalog(&manifest)
        .1
        .resolve("foray", "v1.0.0")
        .expect_err("asset tables on an adversarial case are rejected");
    assert!(
        format!("{err}").contains("only valid for an asset-generation case"),
        "got: {err}"
    );
}

#[test]
fn adversarial_rejects_checks() {
    let manifest = format!("{VALID_ADVERSARIAL_MANIFEST}[[check]]\nview = \"x\"\n");
    let err = adversarial_catalog(&manifest)
        .1
        .resolve("foray", "v1.0.0")
        .expect_err("a [[check]] on an adversarial case is rejected");
    assert!(format!("{err}").contains("no [[check]]"), "got: {err}");
}

#[test]
fn end_to_end_rejects_adversarial_tables() {
    // An end-to-end case (the default type) that declares a [contract] is a mistake.
    let (_dir, catalog) = catalog_with_manifest(
        "[build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n\
         [contract]\nentry = \"tick\"\nworld = \"schemas/world.json\"\naction = \"schemas/action.json\"",
    );
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("adversarial tables on an e2e case are rejected");
    assert!(
        format!("{err}").contains("only valid for an adversarial or performance case"),
        "got: {err}"
    );
}

#[test]
fn end_to_end_rejects_a_build_module() {
    // `module` is an adversarial-only field; an end-to-end build emits a static
    // site and declares none.
    let (_dir, catalog) = catalog_with_manifest(
        "[build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\nmodule = \"out.wasm\"",
    );
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a build.module on an e2e case is rejected");
    assert!(
        format!("{err}")
            .contains("build.module is only valid for an adversarial or performance case"),
        "got: {err}"
    );
}

#[test]
fn partial_build_table_is_rejected() {
    // The table is present but omits `install`: both commands must be stated, so
    // there is no default to fall back to and resolution fails.
    let (_dir, catalog) = catalog_with_manifest("[build]\nbuild = \"make site\"");
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a [build] table missing a command is rejected");
    assert!(
        format!("{err}").contains("install"),
        "unexpected error: {err}"
    );
}

#[test]
fn empty_build_command_is_rejected() {
    let (_dir, catalog) =
        catalog_with_manifest("[build]\ninstall = \"  \"\nbuild = \"npm run build\"");
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a blank build command is rejected");
    assert!(
        format!("{err}").contains("build.install must not be empty"),
        "unexpected error: {err}"
    );
}

/// A `[build]` table plus the given trailing TOML, for review-item tests whose
/// manifest needs only the default `base` variant (which [`catalog_with_manifest`]
/// lists and writes).
fn build_and(extra: &str) -> String {
    format!("[build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n{extra}")
}

#[test]
fn resolves_common_and_variant_review_items() {
    // A common item plus a `frenzy` variant (in its own file) that adds its own.
    let manifest = "slug = \"demo\"\nname = \"Demo\"\ndifficulty = \"easy\"\ntags = []\nprompt = \"prompt.hbs\"\n\
         variants = [\"variants/base.toml\", \"variants/frenzy.toml\"]\n\
         [build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n\
         [[review_item]]\nid = \"ball-spin\"\ntitle = \"Paddle spin\"\n\
         text = \"Swinging a paddle imparts spin on the ball.\"\nweight = 1\n\
         [[domain]]\nid = \"gameplay\"\ndescription = \"Core gameplay.\"\n"
        .to_string();
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[(
            "variants/frenzy.toml",
            "slug = \"frenzy\"\n[[review_item]]\nid = \"frenzy-escalation\"\n\
             title = \"Frenzy escalation\"\ntext = \"Ball speed escalates uncapped.\"\nweight = 1\n",
        )],
    );
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");

    // The common item ships to every variant; the variant's own is additive.
    assert_eq!(version.common_review_items.len(), 1);
    assert_eq!(version.common_review_items[0].id, "ball-spin");

    let frenzy = version.variant("frenzy").expect("frenzy variant");
    let frenzy_items = version.review_items_for(frenzy);
    let ids: Vec<&str> = frenzy_items.iter().map(|i| i.id.as_str()).collect();
    assert_eq!(ids, ["ball-spin", "frenzy-escalation"]);

    // The appended `base` variant sees only the common item.
    let base = version.variant("base").expect("base variant");
    assert_eq!(version.review_items_for(base).len(), 1);
}

#[test]
fn a_review_item_id_colliding_across_common_and_variant_is_rejected() {
    let manifest = "slug = \"demo\"\nname = \"Demo\"\ndifficulty = \"easy\"\ntags = []\nprompt = \"prompt.hbs\"\n\
         variants = [\"variants/base.toml\", \"variants/frenzy.toml\"]\n\
         [build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n\
         [[review_item]]\nid = \"dup\"\ntitle = \"A common item\"\ntext = \"A common item.\"\nweight = 1\n\
         [[domain]]\nid = \"gameplay\"\ndescription = \"Core gameplay.\"\n"
        .to_string();
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[(
            "variants/frenzy.toml",
            "slug = \"frenzy\"\n[[review_item]]\nid = \"dup\"\ntitle = \"Collides\"\n\
             text = \"Collides with the common id.\"\nweight = 1\n",
        )],
    );
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a colliding review-item id is rejected");
    assert!(
        format!("{err}").contains("two review items with the same id `dup`"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_review_item_with_empty_text_is_rejected() {
    let (_dir, catalog) = catalog_with_manifest(&build_and(
        "[[review_item]]\nid = \"x\"\ntitle = \"X\"\ntext = \"\"\nweight = 1",
    ));
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("an empty review-item text is rejected");
    assert!(
        format!("{err}").contains("has empty `text`"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_review_item_with_empty_title_is_rejected() {
    let (_dir, catalog) = catalog_with_manifest(&build_and(
        "[[review_item]]\nid = \"x\"\ntitle = \"\"\ntext = \"Some prose.\"\nweight = 1",
    ));
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("an empty review-item title is rejected");
    assert!(
        format!("{err}").contains("has empty `title`"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_review_item_with_zero_weight_is_rejected() {
    let (_dir, catalog) = catalog_with_manifest(&build_and(
        "[[review_item]]\nid = \"x\"\ntitle = \"X\"\ntext = \"Some prose.\"\nweight = 0",
    ));
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a zero-weight review item is rejected");
    assert!(
        format!("{err}").contains("`weight` greater than zero"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_review_item_naming_an_undeclared_domain_is_rejected() {
    let (_dir, catalog) = catalog_with_manifest(&build_and(
        "[[review_item]]\nid = \"x\"\ntitle = \"X\"\ntext = \"Some prose.\"\nweight = 1\ndomain = \"nope\"",
    ));
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("an undeclared domain reference is rejected");
    assert!(
        format!("{err}").contains("names domain `nope`"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_case_with_no_domains_is_rejected() {
    // `catalog_with_files` supplies the whole manifest (and a default base variant
    // file), so we can omit domains.
    let manifest = "slug = \"demo\"\nname = \"Demo\"\ndifficulty = \"easy\"\ntags = []\nprompt = \"prompt.hbs\"\n\
         variants = [\"variants/base.toml\"]\n\
         [build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n"
        .to_string();
    let (_dir, catalog) = catalog_with_files(&manifest, &[]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a case with no domains is rejected");
    assert!(
        format!("{err}").contains("at least one common [[domain]]"),
        "unexpected error: {err}"
    );
}

#[test]
fn resolves_domains_with_humanized_default_names() {
    let manifest = "slug = \"demo\"\nname = \"Demo\"\ndifficulty = \"easy\"\ntags = []\nprompt = \"prompt.hbs\"\n\
         variants = [\"variants/base.toml\"]\n\
         [build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n\
         [[domain]]\nid = \"single-player\"\ndescription = \"Solo play.\"\n\
         [[domain]]\nid = \"versus\"\nname = \"Versus Mode\"\ndescription = \"Two-player play.\"\n"
        .to_string();
    let (_dir, catalog) = catalog_with_files(&manifest, &[]);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    assert_eq!(version.domains.len(), 2);
    // The first domain has no `name`, so it is humanized from its id.
    assert_eq!(version.domains[0].id, "single-player");
    assert_eq!(version.domains[0].name, "Single Player");
    // The second supplies an explicit name.
    assert_eq!(version.domains[1].name, "Versus Mode");
}

/// The common-domain manifest head plus a `gyre` variant that declares its own
/// domain and a review item rolling up to it. Shared by the per-variant-domain
/// tests below; `override_gyre` replaces the gyre variant file's body.
fn per_variant_domain_catalog(gyre_body: &str) -> (tempfile::TempDir, TestCaseCatalog) {
    let manifest = "slug = \"demo\"\nname = \"Demo\"\ndifficulty = \"easy\"\ntags = []\nprompt = \"prompt.hbs\"\n\
         variants = [\"variants/base.toml\", \"variants/gyre.toml\"]\n\
         [build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n\
         [[domain]]\nid = \"single-player\"\ndescription = \"Solo play.\"\n"
        .to_string();
    catalog_with_files(&manifest, &[("variants/gyre.toml", gyre_body)])
}

#[test]
fn a_variant_declares_its_own_domain_added_to_the_common_ones() {
    // The case declares one common domain; the `gyre` variant adds its own, which
    // a variant review item rolls up to.
    let (_dir, catalog) = per_variant_domain_catalog(
        "slug = \"gyre\"\n\
         [[domain]]\nid = \"gyre\"\ndescription = \"Oriented-face bounces.\"\n\
         [[review_item]]\nid = \"gyre-bounce\"\ntitle = \"Oriented bounces\"\n\
         text = \"The ball bounces off tilted faces.\"\nweight = 1\ndomain = \"gyre\"\n",
    );
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");

    // The case-level `domains` are only the common ones; the variant's is on the
    // variant, and `domains_for` chains them.
    assert_eq!(
        version
            .domains
            .iter()
            .map(|d| d.id.as_str())
            .collect::<Vec<_>>(),
        ["single-player"]
    );
    let gyre = version.variant("gyre").expect("gyre variant");
    assert_eq!(
        gyre.domains
            .iter()
            .map(|d| d.id.as_str())
            .collect::<Vec<_>>(),
        ["gyre"]
    );
    // The gyre variant's own domain name is humanized from its id.
    assert_eq!(gyre.domains[0].name, "Gyre");
    let effective: Vec<String> = version
        .domains_for(gyre)
        .into_iter()
        .map(|d| d.id)
        .collect();
    assert_eq!(effective, ["single-player", "gyre"]);
    // The default `base` variant has only the common domain.
    let base = version.variant("base").expect("base");
    assert_eq!(version.domains_for(base).len(), 1);
}

#[test]
fn a_variant_domain_colliding_with_a_common_domain_is_rejected() {
    let (_dir, catalog) = per_variant_domain_catalog(
        "slug = \"gyre\"\n\
         [[domain]]\nid = \"single-player\"\ndescription = \"Collides with the common domain.\"\n",
    );
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a variant domain colliding with a common one is rejected");
    assert!(
        format!("{err}").contains("duplicate domain id `single-player`"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_common_review_item_cannot_name_a_variant_only_domain() {
    // A common item is rated on every variant, so it may not roll up to a domain
    // only one variant declares.
    let manifest = "slug = \"demo\"\nname = \"Demo\"\ndifficulty = \"easy\"\ntags = []\nprompt = \"prompt.hbs\"\n\
         variants = [\"variants/base.toml\", \"variants/gyre.toml\"]\n\
         [build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n\
         [[review_item]]\nid = \"x\"\ntitle = \"X\"\ntext = \"Prose.\"\nweight = 1\ndomain = \"gyre\"\n\
         [[domain]]\nid = \"single-player\"\ndescription = \"Solo play.\"\n"
        .to_string();
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[(
            "variants/gyre.toml",
            "slug = \"gyre\"\n[[domain]]\nid = \"gyre\"\ndescription = \"Gyre mode.\"\n",
        )],
    );
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a common item naming a variant-only domain is rejected");
    assert!(
        format!("{err}").contains("names domain `gyre`"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_spec_dest_defaults_to_its_source() {
    // A spec with no `dest` seeds at its `source`; a `.hbs` source drops that one
    // extension (so `x.md.hbs` renders to `x.md`); an explicit `dest` still wins.
    let (_dir, catalog) = catalog_with_files(
        &manifest_with(
            "",
            "[[spec]]\nsource = \"specs/plain.md\"\n\
             [[spec]]\nsource = \"specs/tpl.md.hbs\"\n\
             [[spec]]\nsource = \"specs/renamed.md\"\ndest = \"specs/final.md\"\n",
        ),
        &[
            ("specs/plain.md", "# plain"),
            ("specs/tpl.md.hbs", "# {{tpl}}"),
            ("specs/renamed.md", "# renamed"),
        ],
    );
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    let dests: Vec<String> = version
        .common_specs
        .iter()
        .map(|s| s.dest.display().to_string())
        .collect();
    assert!(dests.contains(&"specs/plain.md".to_string()), "{dests:?}");
    assert!(dests.contains(&"specs/tpl.md".to_string()), "{dests:?}");
    assert!(dests.contains(&"specs/final.md".to_string()), "{dests:?}");
}

/// Write a `demo/v1.0.0` version with the given manifest and supporting files
/// (relative path -> contents), returning the temp dir (kept alive) and a
/// catalog rooted at it. Unlike [`catalog_with_manifest`], the caller supplies
/// the whole manifest, so it can place top-level keys (`workspace`, `init`)
/// before the `[build]` table, and can seed the workspace directory the manifest
/// points at.
fn catalog_with_files(
    manifest: &str,
    files: &[(&str, &str)],
) -> (tempfile::TempDir, TestCaseCatalog) {
    let dir = tempfile::tempdir().expect("temp dir");
    let version = dir.path().join("demo/v1.0.0");
    fs::create_dir_all(&version).expect("create version dir");
    fs::write(version.join("prompt.hbs"), "Build it.").expect("write prompt");
    for (path, contents) in files {
        let full = version.join(path);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(full, contents).expect("write file");
    }
    // Provide a default `variants/base.toml` unless the caller supplied its own, so
    // a manifest's `variants = ["variants/base.toml"]` resolves without every test
    // spelling the file out. A test declaring extra variants adds their files via
    // `files`.
    let base_variant = version.join("variants/base.toml");
    if !base_variant.exists() {
        fs::create_dir_all(base_variant.parent().unwrap()).expect("variants dir");
        fs::write(base_variant, "slug = \"base\"\n").expect("write base variant");
    }
    fs::write(version.join("test-case.toml"), manifest).expect("write manifest");
    let catalog = TestCaseCatalog::new(dir.path());
    (dir, catalog)
}

/// The required header (including a single `base` variant, whose file
/// [`catalog_with_files`] provides) plus a `[build]` table, with `body` (top-level
/// keys and tables) spliced in between so a test can declare `workspace`/`init`
/// before the build table and append specs/tables after it. A test needing more
/// than the one `base` variant builds its manifest directly instead.
fn manifest_with(body: &str, after_build: &str) -> String {
    format!(
        "slug = \"demo\"\nname = \"Demo\"\ndifficulty = \"easy\"\ntags = []\nprompt = \"prompt.hbs\"\n\
         variants = [\"variants/base.toml\"]\n\
         {body}\
         [build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n\
         {after_build}\n\
         [[domain]]\nid = \"gameplay\"\ndescription = \"Core gameplay.\"\n"
    )
}

#[test]
fn workspace_files_resolve_with_run_relative_dests_and_init() {
    let manifest = manifest_with(
        "workspace = \"workspaces/base\"\ninit = \"npm install\"\n",
        "",
    );
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[
            ("workspaces/base/package.json", "{}"),
            ("workspaces/base/src/main.ts", "// entry"),
        ],
    );
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");

    // The init command is carried through verbatim.
    assert_eq!(version.init.as_deref(), Some("npm install"));
    // Each workspace file's dest is its path relative to the workspace dir, so it
    // seeds at the run root.
    let dests: Vec<String> = version
        .common_workspace
        .iter()
        .map(|f| f.dest.display().to_string())
        .collect();
    assert!(dests.contains(&"package.json".to_string()), "{dests:?}");
    assert!(dests.contains(&"src/main.ts".to_string()), "{dests:?}");
    // A variant with no override inherits the common workspace.
    let base = version.variant("base").expect("base");
    assert_eq!(version.workspace_for(base).len(), 2);
}

#[test]
fn workspace_dotfiles_are_not_seeded_except_the_allowlist() {
    // A dotfile in the workspace is skipped (matching how the backend copies a
    // version into its store), so it is not listed as a seeded workspace file —
    // except the allowlist a case may ship: `.gitignore` (so the published repo
    // can exclude build artifacts) and `.cargo` (Cargo build config a Rust case
    // needs). A `.cargo` directory is descended into and its contents seeded.
    let manifest = manifest_with("workspace = \"workspaces/base\"\n", "");
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[
            ("workspaces/base/Cargo.toml", "[package]"),
            ("workspaces/base/.gitignore", "/target/\n"),
            ("workspaces/base/.cargo/config.toml", "[build]\n"),
            ("workspaces/base/.env", "SECRET=1"),
        ],
    );
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    let mut dests: Vec<String> = version
        .common_workspace
        .iter()
        .map(|f| f.dest.display().to_string())
        .collect();
    dests.sort();
    assert_eq!(
        dests,
        [".cargo/config.toml", ".gitignore", "Cargo.toml"],
        "`.gitignore` and `.cargo` are seeded; other dotfiles are skipped: {dests:?}"
    );
}

#[test]
fn only_the_allowlisted_dotfiles_are_seeded() {
    use super::is_seeded_dotfile;
    assert!(is_seeded_dotfile(".gitignore"));
    assert!(is_seeded_dotfile(".cargo"));
    assert!(!is_seeded_dotfile(".git"));
    assert!(!is_seeded_dotfile(".tcab"));
    assert!(!is_seeded_dotfile(".env"));
}

#[test]
fn a_variant_workspace_overrides_the_common_one() {
    // Two variants: the default `base` (inheriting the common workspace) and
    // `special`, whose own file overrides the workspace. `base.toml` is provided by
    // `catalog_with_files`; `special.toml` is supplied here.
    let manifest = "slug = \"demo\"\nname = \"Demo\"\ndifficulty = \"easy\"\ntags = []\nprompt = \"prompt.hbs\"\n\
         variants = [\"variants/base.toml\", \"variants/special.toml\"]\n\
         workspace = \"workspaces/base\"\n\
         [build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n\
         [[domain]]\nid = \"gameplay\"\ndescription = \"Core gameplay.\"\n"
        .to_string();
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[
            (
                "variants/special.toml",
                "slug = \"special\"\nworkspace = \"workspaces/special\"\n",
            ),
            ("workspaces/base/package.json", "{\"name\":\"base\"}"),
            ("workspaces/special/package.json", "{\"name\":\"special\"}"),
            ("workspaces/special/extra.txt", "x"),
        ],
    );
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    let base = version.variant("base").expect("base");
    let special = version.variant("special").expect("special");

    // The override replaces the common workspace rather than layering on it.
    assert_eq!(version.workspace_for(base).len(), 1);
    let special_dests: Vec<String> = version
        .workspace_for(special)
        .iter()
        .map(|f| f.dest.display().to_string())
        .collect();
    assert!(
        special_dests.contains(&"extra.txt".to_string()),
        "{special_dests:?}"
    );
    assert!(!special_dests.contains(&"package.json".to_string()) || special_dests.len() == 2);
}

#[test]
fn a_workspace_file_colliding_with_a_spec_dest_is_rejected() {
    // The workspace ships a file at the same dest a spec seeds to; the two would
    // clobber each other, so resolution rejects it.
    let manifest = manifest_with(
        "workspace = \"workspaces/base\"\n",
        "[[spec]]\nsource = \"overview.md\"\ndest = \"specs/overview.md\"\n",
    );
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[
            ("overview.md", "# Overview"),
            ("workspaces/base/specs/overview.md", "clobber"),
        ],
    );
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a workspace/spec dest collision is rejected");
    assert!(
        format!("{err}").contains("same dest"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_blank_init_command_is_rejected() {
    let manifest = manifest_with("init = \"   \"\n", "");
    let (_dir, catalog) = catalog_with_files(&manifest, &[]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a blank init command is rejected");
    assert!(
        format!("{err}").contains("init must not be empty"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_missing_workspace_directory_is_rejected() {
    let manifest = manifest_with("workspace = \"workspaces/base\"\n", "");
    // The manifest points at a workspace dir that was never created.
    let (_dir, catalog) = catalog_with_files(&manifest, &[]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a missing workspace directory is rejected");
    assert!(
        format!("{err}").contains("workspace"),
        "unexpected error: {err}"
    );
}

// --- slug identity: decoupling the slug from the folder name ----------------

/// Write a minimal resolvable end-to-end version under `<folder>/<version>` with a
/// manifest declaring `slug`. Everything else is the least a version needs to
/// resolve, so these tests isolate the folder-name-vs-slug behavior.
fn write_slugged_case(root: &std::path::Path, folder: &str, version: &str, slug: &str) {
    let dir = root.join(folder).join(version);
    fs::create_dir_all(dir.join("variants")).expect("version dir");
    fs::write(dir.join("prompt.hbs"), "Build it.").expect("prompt");
    fs::write(dir.join("variants/base.toml"), "slug = \"base\"\n").expect("variant");
    let manifest = format!(
        "slug = \"{slug}\"\nname = \"Case\"\ndifficulty = \"easy\"\ntags = []\n\
         prompt = \"prompt.hbs\"\nvariants = [\"variants/base.toml\"]\n\
         [build]\ninstall = \"x\"\nbuild = \"y\"\n\
         [[domain]]\nid = \"gameplay\"\ndescription = \"Core gameplay.\"\n"
    );
    fs::write(dir.join("test-case.toml"), manifest).expect("manifest");
}

#[test]
fn resolving_by_slug_or_folder_name_both_yield_the_manifest_slug() {
    // A folder named `carom` whose manifest pins `slug = "pong"` (a rename that keeps
    // the old identity). It resolves both by its pinned slug and by its folder name,
    // and the recorded identity is the slug either way — never the folder name.
    let dir = tempfile::tempdir().expect("temp dir");
    write_slugged_case(dir.path(), "carom", "v1.0.0", "pong");
    let catalog = TestCaseCatalog::new(dir.path());

    let by_slug = catalog.resolve("pong", "v1.0.0").expect("resolve by slug");
    assert_eq!(by_slug.slug, "pong");
    let by_folder = catalog
        .resolve("carom", "v1.0.0")
        .expect("resolve by folder name");
    assert_eq!(by_folder.slug, "pong");

    // The catalog lists the case under its slug, not its folder name.
    let slugs: Vec<String> = catalog
        .list()
        .expect("list")
        .into_iter()
        .map(|c| c.slug)
        .collect();
    assert_eq!(slugs, ["pong"]);

    // A cheap identity read agrees with a full resolve.
    assert_eq!(catalog.slug_of("carom", "v1.0.0").expect("slug_of"), "pong");
    assert_eq!(catalog.slug_of("pong", "v1.0.0").expect("slug_of"), "pong");
}

#[test]
fn two_folders_declaring_the_same_slug_are_rejected() {
    let dir = tempfile::tempdir().expect("temp dir");
    write_slugged_case(dir.path(), "carom", "v1.0.0", "pong");
    write_slugged_case(dir.path(), "pong", "v1.0.0", "pong");
    let catalog = TestCaseCatalog::new(dir.path());

    let err = catalog.list().expect_err("a duplicate slug is rejected");
    assert!(
        matches!(err, super::Error::DuplicateSlug { .. }),
        "unexpected error: {err}"
    );
}

#[test]
fn a_folder_whose_versions_disagree_on_slug_is_rejected() {
    let dir = tempfile::tempdir().expect("temp dir");
    write_slugged_case(dir.path(), "carom", "v1.0.0", "pong");
    write_slugged_case(dir.path(), "carom", "v1.1.0", "carom");
    let catalog = TestCaseCatalog::new(dir.path());

    let err = catalog
        .list()
        .expect_err("inconsistent per-version slugs are rejected");
    assert!(
        format!("{err}").contains("every version of a folder must declare the same slug"),
        "unexpected error: {err}"
    );
}

#[test]
fn an_ill_formed_slug_is_rejected() {
    let dir = tempfile::tempdir().expect("temp dir");
    write_slugged_case(dir.path(), "shouty", "v1.0.0", "Not A Slug");
    let catalog = TestCaseCatalog::new(dir.path());

    let err = catalog
        .resolve("shouty", "v1.0.0")
        .expect_err("an invalid slug is rejected");
    assert!(
        format!("{err}").contains("is not a valid slug"),
        "unexpected error: {err}"
    );
}

#[test]
fn slug_validation_accepts_kebab_case_and_rejects_the_rest() {
    for good in [
        "pong",
        "carom",
        "sunfront-aegis",
        "lattice-splitter",
        "a1",
        "x",
    ] {
        assert!(super::is_valid_slug(good), "{good} should be valid");
    }
    for bad in [
        "", "-pong", "pong-", "po--ng", "Pong", "po ng", "pȯng", "foo_bar",
    ] {
        assert!(!super::is_valid_slug(bad), "{bad} should be invalid");
    }
}

// --- ui / material / skinned / particle / audio resolution ------------------

/// The shared header every new-family manifest below opens with (identity, prompt,
/// asset-generation type, and one variant). Each test appends the kind, its tables,
/// and the common spec/domain.
const NEW_FAMILY_HEADER: &str = "\
slug = \"sprite\"\n\
name = \"Asset\"\n\
difficulty = \"medium\"\n\
tags = [\"asset-generation\"]\n\
prompt = \"prompt.hbs\"\n\
type = \"asset-generation\"\n";

/// The common `[[spec]]`/`[[domain]]` tail every new-family manifest closes with.
const NEW_FAMILY_TAIL: &str = "\
[[spec]]\nsource = \"specs/brief.md\"\ndest = \"specs/brief.md\"\n\
[[domain]]\nid = \"fidelity\"\ndescription = \"How close the asset is to the brief.\"\n";

#[test]
fn ui_kit_resolves_its_elements() {
    let manifest = format!(
        "{NEW_FAMILY_HEADER}asset_kind = \"ui\"\nvariants = [\"variants/base.toml\"]\n\
         [canvas]\nwidth = 512\nheight = 512\nbackground = \"transparent\"\n\
         [tool]\nbinary = \"paint\"\npreview = \"elements/{{element}}.png\"\n\
         [output]\nactions = \"actions.json\"\n\
         [[ui.element]]\nname = \"panel\"\nwidth = 512\nheight = 320\n\
         nine_slice = {{ left = 24, right = 24, top = 24, bottom = 24 }}\n\
         [[ui.element]]\nname = \"button\"\nwidth = 256\nheight = 72\n{NEW_FAMILY_TAIL}"
    );
    let version = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect("resolve");
    assert_eq!(version.asset_kind, AssetKind::Ui);
    let ui = version.ui.as_ref().expect("ui");
    assert_eq!(ui.elements.len(), 2);
    assert_eq!(ui.elements[0].name, "panel");
    assert_eq!(ui.elements[0].nine_slice.expect("nine_slice").left, 24);
    // A `ui` case reuses the base [canvas].
    assert!(version.canvas.is_some());
}

#[test]
fn ui_single_image_needs_no_element_token() {
    // With no [ui] kit the preview is a single file (no `{element}`).
    let manifest = format!(
        "{NEW_FAMILY_HEADER}asset_kind = \"ui\"\nvariants = [\"variants/base.toml\"]\n\
         [canvas]\nwidth = 512\nheight = 512\nbackground = \"transparent\"\n\
         [tool]\nbinary = \"paint\"\npreview = \"canvas.png\"\n\
         [output]\nactions = \"actions.json\"\n{NEW_FAMILY_TAIL}"
    );
    let version = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect("resolve");
    assert!(version.ui.as_ref().expect("ui").elements.is_empty());
}

#[test]
fn ui_rejects_out_of_bounds_nine_slice() {
    let manifest = format!(
        "{NEW_FAMILY_HEADER}asset_kind = \"ui\"\nvariants = [\"variants/base.toml\"]\n\
         [canvas]\nwidth = 512\nheight = 512\nbackground = \"transparent\"\n\
         [tool]\nbinary = \"paint\"\npreview = \"elements/{{element}}.png\"\n\
         [output]\nactions = \"actions.json\"\n\
         [[ui.element]]\nname = \"panel\"\nwidth = 100\nheight = 80\n\
         nine_slice = {{ left = 60, right = 60, top = 10, bottom = 10 }}\n{NEW_FAMILY_TAIL}"
    );
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("an out-of-bounds nine_slice is rejected");
    assert!(format!("{err}").contains("exceeds width"), "got: {err}");
}

#[test]
fn material_resolves_its_maps() {
    let manifest = format!(
        "{NEW_FAMILY_HEADER}asset_kind = \"material\"\nvariants = [\"variants/base.toml\"]\n\
         [material]\nsize = 512\ntile = true\nmaps = [\"base-color\", \"normal\", \"roughness\"]\n\
         [tool]\nbinary = \"texture\"\npreview = \"maps/{{map}}.png\"\n\
         [output]\nactions = \"actions.json\"\n{NEW_FAMILY_TAIL}"
    );
    let version = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect("resolve");
    assert_eq!(version.asset_kind, AssetKind::Material);
    let material = version.material.as_ref().expect("material");
    assert_eq!(material.size, 512);
    assert!(material.tile);
    assert_eq!(material.maps, vec!["base-color", "normal", "roughness"]);
    assert!(version.canvas.is_none(), "a material case has no [canvas]");
}

#[test]
fn material_rejects_missing_base_color() {
    let manifest = format!(
        "{NEW_FAMILY_HEADER}asset_kind = \"material\"\nvariants = [\"variants/base.toml\"]\n\
         [material]\nsize = 512\nmaps = [\"normal\", \"roughness\"]\n\
         [tool]\nbinary = \"texture\"\npreview = \"maps/{{map}}.png\"\n\
         [output]\nactions = \"actions.json\"\n{NEW_FAMILY_TAIL}"
    );
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a material with no base-color map is rejected");
    assert!(format!("{err}").contains("base-color"), "got: {err}");
}

#[test]
fn material_rejects_non_power_of_two_size() {
    let manifest = format!(
        "{NEW_FAMILY_HEADER}asset_kind = \"material\"\nvariants = [\"variants/base.toml\"]\n\
         [material]\nsize = 500\nmaps = [\"base-color\"]\n\
         [tool]\nbinary = \"texture\"\npreview = \"maps/{{map}}.png\"\n\
         [output]\nactions = \"actions.json\"\n{NEW_FAMILY_TAIL}"
    );
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a non-power-of-two material size is rejected");
    assert!(format!("{err}").contains("power of two"), "got: {err}");
}

#[test]
fn skinned_resolves_single_file_and_model() {
    let manifest = format!(
        "{NEW_FAMILY_HEADER}asset_kind = \"sn-skinned\"\nvariants = [\"variants/base.toml\"]\n\
         [voxel]\nwidth = 40\nheight = 48\ndepth = 24\nbackground = \"transparent\"\n\
         [tool]\nbinary = \"sn-skin\"\npreview = \"model.png\"\n\
         [output]\nactions = \"actions.json\"\n\
         [[model.animation]]\nname = \"walk\"\n{NEW_FAMILY_TAIL}"
    );
    let version = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect("resolve");
    assert_eq!(version.asset_kind, AssetKind::SnSkinned);
    assert!(version.asset_kind.is_voxel());
    assert!(version.asset_kind.is_animated());
    assert!(!version.asset_kind.is_per_part(), "skinned is single-file");
    // A skinned case declares a [voxel] volume and a [model] (animations-only) rig.
    assert!(version.voxel.is_some());
    let model = version.model.as_ref().expect("model");
    assert_eq!(model.animations.len(), 1);
    assert_eq!(model.animations[0].name, "walk");
}

#[test]
fn skinned_rejects_a_part_token() {
    // A skinned character is one whole-body field → one file, so `{part}` is a mistake.
    let manifest = format!(
        "{NEW_FAMILY_HEADER}asset_kind = \"mc-skinned\"\nvariants = [\"variants/base.toml\"]\n\
         [voxel]\nwidth = 40\nheight = 48\ndepth = 24\nbackground = \"transparent\"\n\
         [tool]\nbinary = \"mc-skin\"\npreview = \"parts/{{part}}.png\"\n\
         [output]\nactions = \"actions.json\"\n\
         [[model.animation]]\nname = \"walk\"\n{NEW_FAMILY_TAIL}"
    );
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a {part} token on a skinned case is rejected");
    assert!(
        format!("{err}").contains("must not contain `{part}`"),
        "got: {err}"
    );
}

#[test]
fn particle_3d_resolves_its_field() {
    let manifest = format!(
        "{NEW_FAMILY_HEADER}asset_kind = \"particle-3d\"\nvariants = [\"variants/base.toml\"]\n\
         [particle]\nwidth = 48\nheight = 48\ndepth = 48\nduration_ms = 1500\nfps = 60\n\
         [tool]\nbinary = \"particle-3d\"\npreview = \"effect.gif\"\n\
         [output]\nactions = \"actions.json\"\n{NEW_FAMILY_TAIL}"
    );
    let version = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect("resolve");
    assert_eq!(version.asset_kind, AssetKind::Particle3d);
    let particle = version.particle.as_ref().expect("particle");
    assert_eq!((particle.width, particle.height), (48, 48));
    assert_eq!(particle.depth, Some(48));
    assert_eq!(particle.duration_ms, 1500);
}

#[test]
fn particle_2d_rejects_depth() {
    let manifest = format!(
        "{NEW_FAMILY_HEADER}asset_kind = \"particle-2d\"\nvariants = [\"variants/base.toml\"]\n\
         [particle]\nwidth = 48\nheight = 48\ndepth = 48\nduration_ms = 1500\nfps = 60\n\
         [tool]\nbinary = \"particle-2d\"\npreview = \"effect.gif\"\n\
         [output]\nactions = \"actions.json\"\n{NEW_FAMILY_TAIL}"
    );
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a particle-2d case with depth is rejected");
    assert!(format!("{err}").contains("no particle.depth"), "got: {err}");
}

#[test]
fn particle_3d_requires_depth() {
    let manifest = format!(
        "{NEW_FAMILY_HEADER}asset_kind = \"particle-3d\"\nvariants = [\"variants/base.toml\"]\n\
         [particle]\nwidth = 48\nheight = 48\nduration_ms = 1500\nfps = 60\n\
         [tool]\nbinary = \"particle-3d\"\npreview = \"effect.gif\"\n\
         [output]\nactions = \"actions.json\"\n{NEW_FAMILY_TAIL}"
    );
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a particle-3d case without depth is rejected");
    assert!(
        format!("{err}").contains("requires particle.depth"),
        "got: {err}"
    );
}

#[test]
fn audio_sample_resolves_its_format() {
    let manifest = format!(
        "{NEW_FAMILY_HEADER}asset_kind = \"sfx-sample\"\nvariants = [\"variants/base.toml\"]\n\
         [audio]\nsample_rate = 44100\nchannels = \"stereo\"\nmax_duration_ms = 5000\n\
         sample_pack = \"naval-weapons@1\"\n\
         [tool]\nbinary = \"sfx-sample\"\npreview = \"waveform.png\"\n\
         [output]\nactions = \"actions.json\"\n{NEW_FAMILY_TAIL}"
    );
    let version = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect("resolve");
    assert_eq!(version.asset_kind, AssetKind::SfxSample);
    let audio = version.audio.as_ref().expect("audio");
    assert_eq!(audio.sample_rate, 44100);
    assert_eq!(audio.channels, "stereo");
    assert_eq!(audio.sample_pack.as_deref(), Some("naval-weapons@1"));
    assert!(audio.instrument_bank.is_none());
}

#[test]
fn audio_sample_requires_a_sample_pack() {
    let manifest = format!(
        "{NEW_FAMILY_HEADER}asset_kind = \"sfx-sample\"\nvariants = [\"variants/base.toml\"]\n\
         [audio]\nsample_rate = 44100\nchannels = \"stereo\"\nmax_duration_ms = 5000\n\
         [tool]\nbinary = \"sfx-sample\"\npreview = \"waveform.png\"\n\
         [output]\nactions = \"actions.json\"\n{NEW_FAMILY_TAIL}"
    );
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a sfx-sample case without a sample_pack is rejected");
    assert!(format!("{err}").contains("sample_pack"), "got: {err}");
}

#[test]
fn audio_accepts_a_long_duration() {
    // There is no hard ceiling on clip length: a case may declare any positive
    // `max_duration_ms`, including one longer than five seconds.
    let manifest = format!(
        "{NEW_FAMILY_HEADER}asset_kind = \"sfx-synth\"\nvariants = [\"variants/base.toml\"]\n\
         [audio]\nsample_rate = 44100\nchannels = \"mono\"\nmax_duration_ms = 30000\n\
         [tool]\nbinary = \"sfx-synth\"\npreview = \"waveform.png\"\n\
         [output]\nactions = \"actions.json\"\n{NEW_FAMILY_TAIL}"
    );
    let version = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect("a long max_duration_ms resolves");
    assert_eq!(version.audio.as_ref().unwrap().max_duration_ms, 30000);
}

#[test]
fn audio_rejects_zero_duration() {
    let manifest = format!(
        "{NEW_FAMILY_HEADER}asset_kind = \"sfx-synth\"\nvariants = [\"variants/base.toml\"]\n\
         [audio]\nsample_rate = 44100\nchannels = \"mono\"\nmax_duration_ms = 0\n\
         [tool]\nbinary = \"sfx-synth\"\npreview = \"waveform.png\"\n\
         [output]\nactions = \"actions.json\"\n{NEW_FAMILY_TAIL}"
    );
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a zero max_duration_ms is rejected");
    assert!(format!("{err}").contains("greater than zero"), "got: {err}");
}
