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
    fs::create_dir_all(&version).expect("create version dir");
    fs::write(version.join("prompt.hbs"), "Build it.").expect("write prompt");
    let manifest = format!(
        "name = \"Demo\"\ndifficulty = \"easy\"\ntags = []\nprompt = \"prompt.hbs\"\n{manifest_extra}\n\
         [[variant]]\nslug = \"base\"\n\
         [[domain]]\nid = \"gameplay\"\ndescription = \"Core gameplay.\"\n"
    );
    fs::write(version.join("test-case.toml"), manifest).expect("write manifest");
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

// --- asset-generation resolution -------------------------------------------

/// A complete, valid asset-generation manifest. Tests clone this and mutate one
/// thing to exercise a single validation rule.
const VALID_ASSET_MANIFEST: &str = "\
name = \"Sprite\"\n\
difficulty = \"medium\"\n\
tags = [\"asset-generation\"]\n\
prompt = \"prompt.hbs\"\n\
type = \"asset-generation\"\n\
[canvas]\nwidth = 64\nheight = 64\nbackground = \"transparent\"\n\
[tool]\nbinary = \"draw\"\npreview = \"canvas.png\"\n\
[output]\nactions = \"actions.json\"\n\
[[spec]]\nsource = \"specs/brief.md\"\ndest = \"specs/brief.md\"\n\
[[variant]]\nslug = \"base\"\n\
[[domain]]\nid = \"fidelity\"\ndescription = \"How close the sprite is to the brief.\"\n";

/// Write an asset-generation version with all the files a valid one needs
/// (prompt, seeded brief) and the given manifest, then return the catalog. An
/// asset-generation case has no target image, so none is written. No operations
/// schema is written either — the binary's `--help` is the contract.
fn asset_catalog(manifest: &str) -> (tempfile::TempDir, TestCaseCatalog) {
    let dir = tempfile::tempdir().expect("temp dir");
    let version = dir.path().join("sprite/v1.0.0");
    fs::create_dir_all(version.join("specs")).expect("specs dir");
    fs::write(version.join("prompt.hbs"), "Draw it.").expect("prompt");
    fs::write(version.join("specs/brief.md"), "The brief.").expect("brief");
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
name = \"Sheet\"\n\
difficulty = \"medium\"\n\
tags = [\"asset-generation\"]\n\
prompt = \"prompt.hbs\"\n\
type = \"asset-generation\"\n\
asset_kind = \"sprite-sheet\"\n\
[canvas]\nwidth = 32\nheight = 32\nbackground = \"transparent\"\n\
[tool]\nbinary = \"draw-sheet\"\npreview = \"frames/{frame}.png\"\n\
[output]\nactions = \"frames/{frame}.actions.json\"\n\
[sheet]\n\
[[sheet.frame]]\nindex = 0\n\
[[sheet.frame]]\nindex = 1\n\
[[sheet.sequence]]\nslug = \"walk-right\"\nframes = [0, 1]\nfps = 4.0\n\
[[spec]]\nsource = \"specs/brief.md\"\ndest = \"specs/brief.md\"\n\
[[variant]]\nslug = \"base\"\n\
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
    assert!(format!("{err}").contains("sequence `walk-left`"), "got: {err}");
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

// --- adversarial resolution ------------------------------------------------

/// A complete, valid adversarial manifest. Tests clone this and mutate one thing
/// to exercise a single validation rule.
const VALID_ADVERSARIAL_MANIFEST: &str = "\
name = \"Foray\"\n\
difficulty = \"hard\"\n\
tags = [\"adversarial\"]\n\
prompt = \"prompt.hbs\"\n\
type = \"adversarial\"\n\
[build]\ninstall = \"cargo fetch\"\nbuild = \"cargo build --release --target wasm32-unknown-unknown\"\nmodule = \"target/wasm32-unknown-unknown/release/controller.wasm\"\n\
[contract]\nentry = \"tick\"\nworld = \"schemas/world.json\"\naction = \"schemas/action.json\"\n\
[sandbox]\nfuel_per_tick = 5000000\nmax_memory_bytes = 67108864\n\
[simulation]\ntimestep_ms = 16\nmax_ticks = 37500\n\
[match]\nparticipants = 2\nstructure = \"round-robin\"\nrounds = 1\n\
[replay]\nrenderer = \"replay/index.html\"\n\
[[variant]]\nslug = \"base\"\n\
[[domain]]\nid = \"play\"\ndescription = \"How well the controller plays.\"\n";

/// Write an adversarial version with all the files a valid one needs (prompt,
/// world/action schemas, replay renderer) and the given manifest, then return the
/// catalog.
fn adversarial_catalog(manifest: &str) -> (tempfile::TempDir, TestCaseCatalog) {
    let dir = tempfile::tempdir().expect("temp dir");
    let version = dir.path().join("foray/v1.0.0");
    fs::create_dir_all(version.join("schemas")).expect("schemas dir");
    fs::create_dir_all(version.join("replay")).expect("replay dir");
    fs::write(version.join("prompt.hbs"), "Write a controller.").expect("prompt");
    fs::write(version.join("schemas/world.json"), "{}").expect("world schema");
    fs::write(version.join("schemas/action.json"), "{}").expect("action schema");
    fs::write(version.join("replay/index.html"), "<html></html>").expect("renderer");
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
    assert_eq!(sandbox.fuel_per_tick, 5_000_000);
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
        "[sandbox]\nfuel_per_tick = 5000000\nmax_memory_bytes = 67108864\n",
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
        format!("{err}").contains("only valid for an adversarial case"),
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
        format!("{err}").contains("build.module is only valid for an adversarial case"),
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

/// A `[build]` table plus the given trailing TOML, for review-item tests that
/// also declare their own `[[variant]]` (the helper still appends a `base`).
fn build_and(extra: &str) -> String {
    format!("[build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n{extra}")
}

#[test]
fn resolves_common_and_variant_review_items() {
    let (_dir, catalog) = catalog_with_manifest(&build_and(
        "[[review_item]]\n\
         id = \"ball-spin\"\n\
         title = \"Paddle spin\"\n\
         text = \"Swinging a paddle imparts spin on the ball.\"\n\
         weight = 1\n\n\
         [[variant]]\n\
         slug = \"frenzy\"\n\
         review_item = [{ id = \"frenzy-escalation\", title = \"Frenzy escalation\", text = \"Ball speed escalates uncapped.\", weight = 1 }]",
    ));
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
    let (_dir, catalog) = catalog_with_manifest(&build_and(
        "[[review_item]]\n\
         id = \"dup\"\n\
         title = \"A common item\"\n\
         text = \"A common item.\"\n\
         weight = 1\n\n\
         [[variant]]\n\
         slug = \"frenzy\"\n\
         review_item = [{ id = \"dup\", title = \"Collides\", text = \"Collides with the common id.\", weight = 1 }]",
    ));
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
    // `catalog_with_files` supplies the whole manifest, so we can omit domains.
    let manifest = "name = \"Demo\"\ndifficulty = \"easy\"\ntags = []\nprompt = \"prompt.hbs\"\n\
         [build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n\
         [[variant]]\nslug = \"base\"\n"
        .to_string();
    let (_dir, catalog) = catalog_with_files(&manifest, &[]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a case with no domains is rejected");
    assert!(
        format!("{err}").contains("at least one [[domain]]"),
        "unexpected error: {err}"
    );
}

#[test]
fn resolves_domains_with_humanized_default_names() {
    let manifest = "name = \"Demo\"\ndifficulty = \"easy\"\ntags = []\nprompt = \"prompt.hbs\"\n\
         [build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n\
         [[variant]]\nslug = \"base\"\n\
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
    fs::write(version.join("test-case.toml"), manifest).expect("write manifest");
    let catalog = TestCaseCatalog::new(dir.path());
    (dir, catalog)
}

/// The required header plus a `[build]` table, with `body` (top-level keys and
/// tables) spliced in between so a test can declare `workspace`/`init` before the
/// build table and append variants/specs after it.
fn manifest_with(body: &str, after_build: &str) -> String {
    format!(
        "name = \"Demo\"\ndifficulty = \"easy\"\ntags = []\nprompt = \"prompt.hbs\"\n\
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
        "[[variant]]\nslug = \"base\"\n",
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
fn workspace_dotfiles_are_not_seeded() {
    // A dotfile in the workspace is skipped (matching how the backend copies a
    // version into its store), so it is not listed as a seeded workspace file.
    let manifest = manifest_with(
        "workspace = \"workspaces/base\"\n",
        "[[variant]]\nslug = \"base\"\n",
    );
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[
            ("workspaces/base/package.json", "{}"),
            ("workspaces/base/.gitignore", "node_modules/"),
        ],
    );
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    let dests: Vec<String> = version
        .common_workspace
        .iter()
        .map(|f| f.dest.display().to_string())
        .collect();
    assert_eq!(
        dests,
        ["package.json"],
        "dotfiles must be skipped: {dests:?}"
    );
}

#[test]
fn a_variant_workspace_overrides_the_common_one() {
    let manifest = manifest_with(
        "workspace = \"workspaces/base\"\n",
        "[[variant]]\nslug = \"base\"\n\
         [[variant]]\nslug = \"special\"\nworkspace = \"workspaces/special\"\n",
    );
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[
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
        "[[spec]]\nsource = \"overview.md\"\ndest = \"specs/overview.md\"\n\
         [[variant]]\nslug = \"base\"\n",
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
    let manifest = manifest_with("init = \"   \"\n", "[[variant]]\nslug = \"base\"\n");
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
    let manifest = manifest_with(
        "workspace = \"workspaces/base\"\n",
        "[[variant]]\nslug = \"base\"\n",
    );
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
