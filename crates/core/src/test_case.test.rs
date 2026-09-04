//! Tests for manifest resolution, focused on the `[build]` command table.

use std::fs;
use std::path::Path;

use super::{
    AssetDimension, AssetKind, BuildCommands, ErratumSeverity, FailureCap, MediaKind, Result,
    SHIPPABLE_PACKAGES, SpecKind, TestCaseCatalog, TestCaseVersion, TestType, is_shippable_package,
    shippable_package_description,
};

/// Write a minimal resolvable version (`prompt.hbs` + `test-case.toml`) under a
/// fresh catalog and return both the temp dir (kept alive) and the catalog rooted
/// at it. `manifest_extra` is spliced between the required
/// `name`/`difficulty`/`tags`/`prompt` header and the single `base` variant, so a
/// test can drop in a `[build]` table.
pub(super) fn catalog_with_manifest(manifest_extra: &str) -> (tempfile::TempDir, TestCaseCatalog) {
    let dir = tempfile::tempdir().expect("temp dir");
    let version = dir.path().join("end-to-end/easy/demo/v1.0.0");
    fs::create_dir_all(version.join("variants")).expect("create version dir");
    fs::write(version.join("prompt.hbs"), "Build it.").expect("write prompt");
    fs::write(version.join("changelog.md"), "Introduced.").expect("write changelog");
    // Variants live in their own files; the manifest lists one `base` variant. The
    // `variants` list is a root key, so it precedes `manifest_extra` (which usually
    // opens with a `[build]`/`[canvas]` table header). A `changelog` is required.
    let manifest = format!(
        "slug = \"demo\"\nname = \"Demo\"\ndifficulty = \"easy\"\ntags = []\nprompt = \"prompt.hbs\"\n\
         changelog = \"changelog.md\"\n\
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
fn changelog_is_required() {
    // A manifest that omits `changelog` is rejected: every version must record what
    // changed in it, so no revision can ship without a changelog entry. The header
    // this manifest writes has the required keys except `changelog`.
    let manifest = "slug = \"demo\"\nname = \"Demo\"\ndifficulty = \"easy\"\ntags = []\n\
         prompt = \"prompt.hbs\"\nvariants = [\"variants/base.toml\"]\n\
         [build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n\
         [[domain]]\nid = \"g\"\ndescription = \"d\"\n";
    let (_dir, catalog) = catalog_with_files(manifest, &[]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a manifest without a changelog is rejected");
    assert!(
        format!("{err}").contains("changelog"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_missing_changelog_file_is_rejected() {
    // The `changelog` key is declared but the file it names does not exist: like
    // every other declared path, it is validated to exist.
    let manifest = "slug = \"demo\"\nname = \"Demo\"\ndifficulty = \"easy\"\ntags = []\n\
         prompt = \"prompt.hbs\"\nchangelog = \"missing.md\"\nvariants = [\"variants/base.toml\"]\n\
         [build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n\
         [[domain]]\nid = \"g\"\ndescription = \"d\"\n";
    let (_dir, catalog) = catalog_with_files(manifest, &[]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a changelog naming a missing file is rejected");
    assert!(
        format!("{err}").contains("changelog") && format!("{err}").contains("does not exist"),
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
fn experimental_defaults_to_false_when_omitted() {
    // A manifest that declares no `experimental` key resolves as non-experimental,
    // so every existing case stays offered by default.
    let (_dir, catalog) =
        catalog_with_manifest("[build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"");
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    assert!(!version.experimental);
}

#[test]
fn experimental_flag_is_carried_onto_the_resolved_version() {
    // `experimental` is a root key, so it precedes the `[build]` table header. When
    // declared `true` it is carried verbatim onto the resolved version.
    let (_dir, catalog) = catalog_with_manifest(
        "experimental = true\n[build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"",
    );
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    assert!(version.experimental);
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
pub(super) const VALID_ASSET_MANIFEST: &str = "\
slug = \"sprite\"\n\
name = \"Sprite\"\n\
difficulty = \"medium\"\n\
tags = [\"asset-generation\"]\n\
prompt = \"prompt.hbs\"\n\
         changelog = \"changelog.md\"\n\
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
pub(super) fn asset_catalog(manifest: &str) -> (tempfile::TempDir, TestCaseCatalog) {
    let dir = tempfile::tempdir().expect("temp dir");
    let version = dir.path().join("asset-generation/medium/sprite/v1.0.0");
    fs::create_dir_all(version.join("specs")).expect("specs dir");
    fs::create_dir_all(version.join("variants")).expect("variants dir");
    fs::write(version.join("prompt.hbs"), "Draw it.").expect("prompt");
    fs::write(version.join("changelog.md"), "Introduced.").expect("changelog");
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
         changelog = \"changelog.md\"\n\
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

// --- `asset_dimension` (the full-stack run image) --------------------------

/// The manifest body of a full-stack case, appended to the header
/// [`catalog_with_manifest`] writes. A full-stack case is an end-to-end case that also
/// produces its own assets, so it declares the same `[build]` table.
const FULL_STACK_BODY: &str =
    "type = \"full-stack\"\n[build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"";

#[test]
fn full_stack_resolves_a_three_dimensional_asset_dimension() {
    // `asset_dimension = "3d"` is what schedules a full-stack run onto the image that
    // has `voxel`, `voxel-anim` and `particle-3d` on `PATH`, so it has to survive
    // resolution onto the version the run image is selected from.
    let (_dir, catalog) =
        catalog_with_manifest(&format!("asset_dimension = \"3d\"\n{FULL_STACK_BODY}"));
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    assert_eq!(version.test_type, TestType::FullStack);
    assert_eq!(version.asset_dimension, AssetDimension::ThreeD);
}

#[test]
fn full_stack_defaults_asset_dimension_to_two_dimensional() {
    // A full-stack manifest that declares no `asset_dimension` — which is every one
    // written before the key existed — keeps resolving onto the 2D image.
    let (_dir, catalog) = catalog_with_manifest(FULL_STACK_BODY);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    assert_eq!(version.asset_dimension, AssetDimension::TwoD);
}

#[test]
fn asset_dimension_round_trips_as_its_two_wire_forms() {
    // The wire spellings are `"2d"` and `"3d"` — the manifest spelling, the stored
    // spelling, and the spelling that crosses the backend wire into a driver-run
    // version are all the same string, so a case authored locally and one materialized
    // from the backend resolve the same image.
    for (dimension, wire) in [(AssetDimension::TwoD, "2d"), (AssetDimension::ThreeD, "3d")] {
        let value = serde_json::to_value(dimension).expect("serialize");
        assert_eq!(value, serde_json::json!(wire));
        let parsed: AssetDimension = serde_json::from_value(value).expect("deserialize");
        assert_eq!(parsed, dimension);
    }
}

#[test]
fn only_full_stack_accepts_an_asset_dimension() {
    // Full-stack is the only type with two images to pick between: every other type
    // resolves its image without consulting the dimension at all, by the type alone or,
    // for asset generation, by its `asset_kind`. So an `asset_dimension` on one selects
    // nothing: it is a mistake worth rejecting rather than silently ignoring — the
    // author believes they have chosen an image and has not. Asserted per type because
    // asset generation reaches resolution through its own kind-guarded arms rather than
    // the shared one the other types take, so a check that lived in the shared arm would
    // let every asset-generation kind through.
    let build = "[build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"";
    for (label, manifest_extra) in [
        // End-to-end is the default type, so it declares no `type` at all.
        ("end-to-end", format!("asset_dimension = \"3d\"\n{build}")),
        (
            "game-jam",
            format!("asset_dimension = \"3d\"\ntype = \"game-jam\"\n{build}"),
        ),
        (
            "adversarial",
            "asset_dimension = \"3d\"\ntype = \"adversarial\"".to_string(),
        ),
        (
            "performance",
            "asset_dimension = \"3d\"\ntype = \"performance\"".to_string(),
        ),
    ] {
        let (_dir, catalog) = catalog_with_manifest(&manifest_extra);
        let err = catalog
            .resolve("demo", "v1.0.0")
            .expect_err("`asset_dimension` outside a full-stack case is rejected");
        assert!(
            format!("{err}").contains("`asset_dimension` is only valid for a full-stack case"),
            "on a {label} case, got: {err}"
        );
    }

    // A jam authored through its own `game-jam.toml` is rejected earlier still, by
    // `deny_unknown_fields`: the jam manifest format has no `asset_dimension` at all,
    // which is the strongest form of the same rule. Spliced in as a root key, ahead of
    // the `[build]` table MINIMAL_JAM closes with — appended after it, TOML would read
    // it as a `[build]` key instead.
    let jam = MINIMAL_JAM.replace("[build]", "asset_dimension = \"3d\"\n[build]");
    let err = catalog_with_jam(&jam)
        .1
        .resolve("trains", "v1.0.0")
        .expect_err("`asset_dimension` in a game-jam.toml is rejected");
    assert!(format!("{err}").contains("asset_dimension"), "got: {err}");

    // And on an asset-generation case, whose image is chosen by `asset_kind`.
    let manifest = VALID_ASSET_MANIFEST.replace(
        "type = \"asset-generation\"\n",
        "type = \"asset-generation\"\nasset_dimension = \"3d\"\n",
    );
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("`asset_dimension` on an asset-generation case is rejected");
    assert!(
        format!("{err}").contains("`asset_dimension` is only valid for a full-stack case"),
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
         changelog = \"changelog.md\"\n\
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
         changelog = \"changelog.md\"\n\
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
        dir.path()
            .join("asset-generation/medium/sprite/v1.0.0/variants/double.toml"),
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
        dir.path().join("asset-generation/medium/sprite/v1.0.0/variants/bad.toml"),
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
        dir.path()
            .join("asset-generation/medium/sprite/v1.0.0/variants/big.toml"),
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
         changelog = \"changelog.md\"\n\
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
    let version = dir.path().join("adversarial/hard/foray/v1.0.0");
    fs::create_dir_all(version.join("schemas")).expect("schemas dir");
    fs::create_dir_all(version.join("replay")).expect("replay dir");
    fs::create_dir_all(version.join("variants")).expect("variants dir");
    fs::write(version.join("prompt.hbs"), "Write a controller.").expect("prompt");
    fs::write(version.join("changelog.md"), "Introduced.").expect("changelog");
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
         changelog = \"changelog.md\"\n\
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
         changelog = \"changelog.md\"\n\
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
        format!("{err}").contains("the same verdict id `dup`"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_variant_extends_a_common_category_in_the_categories_grammar() {
    // In the categories grammar (`[review] format = 2`), a `gyre` variant reuses the
    // common `gameplay` category's id to add its own review item to that category
    // (rather than declaring a category of its own). The effective checklist folds
    // the variant's item into the common category instead of forming a second
    // same-id group.
    let manifest = "slug = \"demo\"\nname = \"Demo\"\ndifficulty = \"easy\"\ntags = []\nprompt = \"prompt.hbs\"\n\
         changelog = \"changelog.md\"\n\
         variants = [\"variants/base.toml\", \"variants/gyre.toml\"]\n\
         [build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n\
         [review]\nformat = 2\n\
         [[review.categories]]\nid = \"gameplay\"\ntitle = \"Gameplay\"\n\
         [[review.categories.items]]\nid = \"scoring\"\ntitle = \"Scores\"\n\
         [[domain]]\nid = \"play\"\ndescription = \"Core gameplay.\"\n"
        .to_string();
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[(
            "variants/gyre.toml",
            "slug = \"gyre\"\n[[review.categories]]\nid = \"gameplay\"\ntitle = \"Gameplay\"\n\
             [[review.categories.items]]\nid = \"serve-direction\"\ntitle = \"Serve direction\"\n",
        )],
    );
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");

    // The gyre variant's effective checklist is ONE `gameplay` category holding both
    // the common item and the variant's addition, in that order.
    let gyre = version.variant("gyre").expect("gyre variant");
    let items = version.review_items_for(gyre);
    assert_eq!(
        items.len(),
        1,
        "the variant extends, not duplicates, the category"
    );
    assert_eq!(items[0].id, "gameplay");
    let sub_ids: Vec<&str> = items[0].sub_items.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(sub_ids, ["scoring", "serve-direction"]);
    assert_eq!(
        items[0].verdict_ids(),
        vec![
            "gameplay.scoring".to_string(),
            "gameplay.serve-direction".to_string(),
        ]
    );
    // Its weight is the sum of its (now two) points' weights.
    assert_eq!(items[0].weight, 2);

    // The base variant, which adds nothing, sees just the common single-item category.
    let base = version.variant("base").expect("base variant");
    let base_items = version.review_items_for(base);
    assert_eq!(base_items.len(), 1);
    assert_eq!(base_items[0].sub_items.len(), 1);
}

#[test]
fn resolves_review_item_sub_items() {
    // A review item declaring name-only sub-items (inline table array).
    let manifest = "slug = \"demo\"\nname = \"Demo\"\ndifficulty = \"easy\"\ntags = []\nprompt = \"prompt.hbs\"\n\
         changelog = \"changelog.md\"\n\
         variants = [\"variants/base.toml\"]\n\
         [build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n\
         [[review_item]]\nid = \"ball-spin\"\ntitle = \"Paddle spin\"\n\
         text = \"Swinging a paddle imparts spin on the ball.\"\nweight = 2\n\
         sub_items = [\n\
           { id = \"stationary\", title = \"No spin while stationary\" },\n\
           { id = \"moving\", title = \"Imparts spin while moving\" },\n\
         ]\n\
         [[domain]]\nid = \"gameplay\"\ndescription = \"Core gameplay.\"\n"
        .to_string();
    let (_dir, catalog) = catalog_with_files(&manifest, &[]);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    let item = &version.common_review_items[0];
    let sub_ids: Vec<&str> = item.sub_items.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(sub_ids, ["stationary", "moving"]);
    // The verdict ids expand to one composite per sub-item.
    assert_eq!(
        item.verdict_ids(),
        vec![
            "ball-spin.stationary".to_string(),
            "ball-spin.moving".to_string()
        ]
    );
}

#[test]
fn a_review_item_with_duplicate_sub_item_ids_is_rejected() {
    let manifest = "slug = \"demo\"\nname = \"Demo\"\ndifficulty = \"easy\"\ntags = []\nprompt = \"prompt.hbs\"\n\
         changelog = \"changelog.md\"\n\
         variants = [\"variants/base.toml\"]\n\
         [build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n\
         [[review_item]]\nid = \"ball-spin\"\ntitle = \"Paddle spin\"\n\
         text = \"Swinging a paddle imparts spin on the ball.\"\nweight = 2\n\
         sub_items = [\n\
           { id = \"dup\", title = \"First\" },\n\
           { id = \"dup\", title = \"Second\" },\n\
         ]\n\
         [[domain]]\nid = \"gameplay\"\ndescription = \"Core gameplay.\"\n"
        .to_string();
    let (_dir, catalog) = catalog_with_files(&manifest, &[]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("duplicate sub-item ids are rejected");
    assert!(
        format!("{err}").contains("two sub-items with the same id `dup`"),
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
         changelog = \"changelog.md\"\n\
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
         changelog = \"changelog.md\"\n\
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
         changelog = \"changelog.md\"\n\
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
         changelog = \"changelog.md\"\n\
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

#[test]
fn a_spec_kind_defaults_to_spec_and_can_be_a_script() {
    // A `[[spec]]` with no `kind` resolves to `SpecKind::Spec`; `kind = "script"`
    // marks it a script (the Blender `build.py` starter). Presentation only — both
    // are seeded identically, but the resolved `kind` drives the Inputs tag.
    let (_dir, catalog) = catalog_with_files(
        &manifest_with(
            "",
            "[[spec]]\nsource = \"specs/brief.md\"\n\
             [[spec]]\nsource = \"specs/build.py\"\ndest = \"build.py\"\nkind = \"script\"\n",
        ),
        &[("specs/brief.md", "# brief"), ("specs/build.py", "# build")],
    );
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    let kind_of = |dest: &str| {
        version
            .common_specs
            .iter()
            .find(|s| s.dest.display().to_string() == dest)
            .unwrap_or_else(|| panic!("no spec seeded to {dest}"))
            .kind
    };
    assert_eq!(kind_of("specs/brief.md"), SpecKind::Spec);
    assert_eq!(kind_of("build.py"), SpecKind::Script);
}

#[test]
fn every_shippable_package_carries_a_ui_description() {
    // Every shippable package a case may declare has a non-empty UI-only
    // description (the single source of truth the Inputs surfaces read), and an
    // unknown name resolves to `None`.
    for package in SHIPPABLE_PACKAGES {
        assert!(
            is_shippable_package(package.name),
            "`{}` is in the list, so it must be recognised as shippable",
            package.name
        );
        assert!(
            shippable_package_description(package.name).is_some_and(|d| !d.is_empty()),
            "`{}` should carry a non-empty description",
            package.name
        );
    }
    assert!(!is_shippable_package("@test-cabinet/not-a-real-package"));
    assert!(shippable_package_description("@test-cabinet/not-a-real-package").is_none());
}

#[test]
fn the_shared_validator_harness_is_not_a_package_a_case_may_declare() {
    // `@test-cabinet/case-harness` is staged into the same host package store as the
    // shippable runtimes (scripts/stage-tcab-packages.mjs), and the vitest validator
    // copies it into the STAGED validator project after the container is gone. This
    // allowlist is the other direction entirely: what it admits, a case's manifest
    // `packages` key may name, and the seeder then vendors into the run repository —
    // in front of the model. Admitting the harness here would hand a model the suites
    // it is about to be measured by, so its absence is asserted rather than assumed.
    assert!(!is_shippable_package("@test-cabinet/case-harness"));
    assert!(shippable_package_description("@test-cabinet/case-harness").is_none());
}

/// Write a `demo/v1.0.0` version with the given manifest and supporting files
/// (relative path -> contents), returning the temp dir (kept alive) and a
/// catalog rooted at it. Unlike [`catalog_with_manifest`], the caller supplies
/// the whole manifest, so it can place top-level keys (`workspace`, `init`)
/// before the `[build]` table, and can seed the workspace directory the manifest
/// points at.
pub(super) fn catalog_with_files(
    manifest: &str,
    files: &[(&str, &str)],
) -> (tempfile::TempDir, TestCaseCatalog) {
    let dir = tempfile::tempdir().expect("temp dir");
    let version = dir.path().join("end-to-end/easy/demo/v1.0.0");
    fs::create_dir_all(&version).expect("create version dir");
    fs::write(version.join("prompt.hbs"), "Build it.").expect("write prompt");
    fs::write(version.join("changelog.md"), "Introduced.").expect("write changelog");
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
pub(super) fn manifest_with(body: &str, after_build: &str) -> String {
    format!(
        "slug = \"demo\"\nname = \"Demo\"\ndifficulty = \"easy\"\ntags = []\nprompt = \"prompt.hbs\"\n\
         changelog = \"changelog.md\"\n\
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
        .files()
        .map(|f| f.dest.display().to_string())
        .collect();
    assert!(dests.contains(&"package.json".to_string()), "{dests:?}");
    assert!(dests.contains(&"src/main.ts".to_string()), "{dests:?}");
    // A variant with no override inherits the common workspace.
    let base = version.variant("base").expect("base");
    assert_eq!(version.workspace_for(base, "none").len(), 2);
}

#[test]
fn packages_resolve_when_the_workspace_package_json_declares_the_file_dependency() {
    let manifest = manifest_with(
        "workspace = \"workspaces/base\"\npackages = [\"@test-cabinet/particle-runtime\"]\n",
        "",
    );
    // The case's own `package.json` already declares the package as its baked-in
    // `file:` dependency; the harness validates that and does not modify the file.
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[(
            "workspaces/base/package.json",
            r#"{"name":"demo","dependencies":{"@test-cabinet/particle-runtime":"file:./.tcab/packages/@test-cabinet/particle-runtime"}}"#,
        )],
    );
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    assert_eq!(
        version.packages,
        vec!["@test-cabinet/particle-runtime".to_string()]
    );
}

#[test]
fn packages_reject_an_unknown_name() {
    let manifest = manifest_with(
        "workspace = \"workspaces/base\"\npackages = [\"@test-cabinet/not-a-real-package\"]\n",
        "",
    );
    let (_dir, catalog) = catalog_with_files(&manifest, &[("workspaces/base/package.json", "{}")]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("an unknown package name is rejected");
    assert!(format!("{err}").contains("not a shippable"), "got: {err}");
}

#[test]
fn packages_reject_a_workspace_package_json_that_does_not_declare_the_dependency() {
    let manifest = manifest_with(
        "workspace = \"workspaces/base\"\npackages = [\"@test-cabinet/particle-runtime\"]\n",
        "",
    );
    // Shippable name, ships a package.json — but it does not depend on the package.
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[("workspaces/base/package.json", "{\"name\":\"demo\"}")],
    );
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a package.json missing the dependency is rejected");
    assert!(
        format!("{err}").contains("is not a dependency of the workspace"),
        "got: {err}"
    );
}

#[test]
fn packages_reject_a_wrong_file_dependency_spec() {
    let manifest = manifest_with(
        "workspace = \"workspaces/base\"\npackages = [\"@test-cabinet/particle-runtime\"]\n",
        "",
    );
    // Declares the package, but points somewhere other than the baked-in copy.
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[(
            "workspaces/base/package.json",
            r#"{"name":"demo","dependencies":{"@test-cabinet/particle-runtime":"^1.0.0"}}"#,
        )],
    );
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a wrong dependency spec is rejected");
    let msg = format!("{err}");
    assert!(msg.contains("must be"), "got: {err}");
    assert!(
        msg.contains("file:./.tcab/packages/@test-cabinet/particle-runtime"),
        "got: {err}"
    );
}

#[test]
fn packages_require_a_workspace_package_json() {
    let manifest = manifest_with(
        "workspace = \"workspaces/base\"\npackages = [\"@test-cabinet/particle-runtime\"]\n",
        "",
    );
    // The workspace exists but ships no package.json for the dependency to land in.
    let (_dir, catalog) = catalog_with_files(&manifest, &[("workspaces/base/README.md", "hi")]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a package-declaring case without a package.json is rejected");
    assert!(format!("{err}").contains("package.json"), "got: {err}");
}

#[test]
fn packages_are_end_to_end_only() {
    // `packages` is a root key, so it must precede the first table; prepend it.
    let manifest =
        format!("packages = [\"@test-cabinet/particle-runtime\"]\n{VALID_ASSET_MANIFEST}");
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("`packages` on an asset-generation case is rejected");
    assert!(
        format!("{err}").contains("only valid for an end-to-end, full-stack, or game-jam case"),
        "got: {err}"
    );
}

/// One starter project per engine, each shipping only the `package.json` an
/// engine's dependency is written into at seed time. Their contents are irrelevant
/// to the engine checks — unlike `packages`, the case does not declare the engine
/// dependency itself — so each is the emptiest object that parses.
pub(super) const ENGINE_WORKSPACE_FILES: &[(&str, &str)] = &[
    ("workspaces/none/package.json", "{}"),
    ("workspaces/simple-2d/package.json", "{}"),
];

/// The `[workspaces]` table naming one starter directory per engine in `engines`,
/// matching the files [`ENGINE_WORKSPACE_FILES`] ships. Keys are quoted because an
/// engine slug carries hyphens.
pub(super) fn workspaces_table(engines: &[&str]) -> String {
    let mut table = String::from("[workspaces]\n");
    for engine in engines {
        table.push_str(&format!("\"{engine}\" = \"workspaces/{engine}\"\n"));
    }
    table
}

/// A manifest in the engines format: `roots` are its root keys (`engines = [...]`),
/// `tables` the table sections after `[build]`, and `workspaces` the engines the
/// `[workspaces]` table names — empty for a case that ships no starter project.
pub(super) fn engines_manifest_with(roots: &str, tables: &str, workspaces: &[&str]) -> String {
    let table = if workspaces.is_empty() {
        String::new()
    } else {
        workspaces_table(workspaces)
    };
    manifest_with(roots, &format!("{tables}\n{table}"))
}

#[test]
fn engines_default_to_the_engineless_run() {
    // A case that declares nothing still supports `none`: that is the run every
    // case had before engines existed, so the resolved set is never empty.
    let manifest = manifest_with("", "");
    let (_dir, catalog) = catalog_with_files(&manifest, &[]);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    assert_eq!(version.engine_slugs(), vec!["none".to_string()]);
}

#[test]
fn engines_resolve_with_none_first_when_it_is_declared() {
    // The readable form: `none` spelled out alongside the engine. It leads the
    // resolved set, and declaring it is not a duplicate of the implicit entry.
    let manifest = engines_manifest_with(
        "engines = [\"none\", \"simple-2d\"]\n",
        "",
        &["none", "simple-2d"],
    );
    let (_dir, catalog) = catalog_with_files(&manifest, ENGINE_WORKSPACE_FILES);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    assert_eq!(
        version.engine_slugs(),
        vec!["none".to_string(), "simple-2d".to_string()]
    );
}

#[test]
fn a_version_declaring_an_engine_supports_exactly_what_it_declares() {
    // Once a version declares ANY engine, its supported set is exactly what it
    // declares — `none` is not folded back in. A case whose workspace is written
    // against a runtime (its `package.json` depending on the vendored engine)
    // could not build engineless at all, so being held to offering that run would
    // be a promise the case cannot keep. A case that genuinely builds both ways
    // lists `none` alongside, which is
    // `engines_resolve_with_none_first_when_it_is_declared` above.
    let manifest = engines_manifest_with("engines = [\"simple-2d\"]\n", "", &["simple-2d"]);
    let (_dir, catalog) = catalog_with_files(&manifest, ENGINE_WORKSPACE_FILES);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    assert_eq!(version.engine_slugs(), vec!["simple-2d".to_string()]);
}

#[test]
fn engines_reject_an_unknown_slug() {
    let manifest = engines_manifest_with("engines = [\"not-an-engine\"]\n", "", &[]);
    let (_dir, catalog) = catalog_with_files(&manifest, ENGINE_WORKSPACE_FILES);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("an unknown engine slug is rejected");
    let msg = format!("{err}");
    assert!(msg.contains("not a known engine"), "got: {err}");
    // The message names the slugs that would have worked, so a typo is fixable
    // from the error alone.
    for slug in crate::engine::BUILT_IN_SLUGS {
        assert!(msg.contains(*slug), "expected `{slug}` in: {err}");
    }
}

#[test]
fn engines_reject_a_duplicate() {
    let manifest = engines_manifest_with("engines = [\"simple-2d\", \"simple-2d\"]\n", "", &[]);
    let (_dir, catalog) = catalog_with_files(&manifest, ENGINE_WORKSPACE_FILES);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a repeated engine is rejected");
    assert!(
        format!("{err}").contains("declared more than once"),
        "got: {err}"
    );
}

#[test]
fn engines_reject_none_declared_twice() {
    // `none` is exempt from being a duplicate of the *implicit* entry, not from
    // being declared twice itself.
    let manifest = engines_manifest_with("engines = [\"none\", \"none\"]\n", "", &[]);
    let (_dir, catalog) = catalog_with_files(&manifest, ENGINE_WORKSPACE_FILES);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a repeated `none` is rejected");
    assert!(
        format!("{err}").contains("declared more than once"),
        "got: {err}"
    );
}

#[test]
fn engines_with_a_runtime_require_a_workspace_package_json() {
    // The engine's `file:` dependency is written into the workspace `package.json`
    // at seed time, so a case supporting an engine that vendors a runtime must ship
    // one for the seeder to edit.
    let manifest = engines_manifest_with(
        "engines = [\"none\", \"simple-2d\"]\n",
        "",
        &["none", "simple-2d"],
    );
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[
            ("workspaces/none/README.md", "hi"),
            ("workspaces/simple-2d/README.md", "hi"),
        ],
    );
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("an engine-declaring case without a package.json is rejected");
    assert!(format!("{err}").contains("package.json"), "got: {err}");
}

#[test]
fn engines_declaring_only_none_need_no_workspace_at_all() {
    // `none` vendors no runtime, so there is no dependency to write and nothing to
    // write it into — a case may declare it while shipping no workspace.
    let manifest = engines_manifest_with("engines = [\"none\"]\n", "", &[]);
    let (_dir, catalog) = catalog_with_files(&manifest, &[]);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    assert_eq!(version.engine_slugs(), vec!["none".to_string()]);
}

#[test]
fn engines_are_end_to_end_only() {
    // `engines` is a root key, so it must precede the first table; prepend it.
    let manifest = format!("engines = [\"simple-2d\"]\n{VALID_ASSET_MANIFEST}");
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("`engines` on an asset-generation case is rejected");
    assert!(
        format!("{err}").contains("only valid for an end-to-end, full-stack, or game-jam case"),
        "got: {err}"
    );
}

#[test]
fn supports_engine_agrees_with_the_resolved_set() {
    let manifest = engines_manifest_with(
        "engines = [\"none\", \"simple-2d\"]\n",
        "",
        &["none", "simple-2d"],
    );
    let (_dir, catalog) = catalog_with_files(&manifest, ENGINE_WORKSPACE_FILES);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    assert!(version.supports_engine("simple-2d"));
    assert!(version.supports_engine("none"));
    assert!(!version.supports_engine("not-an-engine"));
    for slug in version.engine_slugs() {
        assert!(version.supports_engine(&slug), "should support `{slug}`");
    }
}

#[test]
fn supports_engine_refuses_the_engineless_run_a_version_left_out() {
    // The gate a run applies reads the same resolved set, so a version built
    // against a runtime refuses `--engine none` rather than seeding a workspace
    // whose `package.json` names a package nothing would vendor.
    let manifest = engines_manifest_with("engines = [\"simple-2d\"]\n", "", &["simple-2d"]);
    let (_dir, catalog) = catalog_with_files(&manifest, ENGINE_WORKSPACE_FILES);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    assert!(version.supports_engine("simple-2d"));
    assert!(!version.supports_engine("none"));
}

#[test]
fn workspace_dotfiles_are_not_seeded_except_the_allowlist() {
    // A dotfile in the workspace is skipped (matching how the backend copies a
    // version into its store), so it is not listed as a seeded workspace file —
    // except the allowlist a case may ship: `.gitignore` (so the published repo
    // can exclude build artifacts), `.cargo` (Cargo build config a Rust case
    // needs), and the prettier config the `format` toolchain command reads. A
    // `.cargo` directory is descended into and its contents seeded.
    let manifest = manifest_with("workspace = \"workspaces/base\"\n", "");
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[
            ("workspaces/base/Cargo.toml", "[package]"),
            ("workspaces/base/.gitignore", "/target/\n"),
            ("workspaces/base/.cargo/config.toml", "[build]\n"),
            ("workspaces/base/.prettierrc.json", "{}\n"),
            ("workspaces/base/.prettierignore", "dist/\n"),
            ("workspaces/base/.env", "SECRET=1"),
        ],
    );
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    let mut dests: Vec<String> = version
        .common_workspace
        .files()
        .map(|f| f.dest.display().to_string())
        .collect();
    dests.sort();
    assert_eq!(
        dests,
        [
            ".cargo/config.toml",
            ".gitignore",
            ".prettierignore",
            ".prettierrc.json",
            "Cargo.toml"
        ],
        "the allowlisted dotfiles are seeded; other dotfiles are skipped: {dests:?}"
    );
}

#[test]
fn only_the_allowlisted_dotfiles_are_seeded() {
    use super::is_seeded_dotfile;
    assert!(is_seeded_dotfile(".gitignore"));
    assert!(is_seeded_dotfile(".cargo"));
    assert!(is_seeded_dotfile(".prettierrc.json"));
    assert!(is_seeded_dotfile(".prettierignore"));
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
         changelog = \"changelog.md\"\n\
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
    assert_eq!(version.workspace_for(base, "none").len(), 1);
    let special_dests: Vec<String> = version
        .workspace_for(special, "none")
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
    let dir = root
        .join("end-to-end")
        .join("easy")
        .join(folder)
        .join(version);
    fs::create_dir_all(dir.join("variants")).expect("version dir");
    fs::write(dir.join("prompt.hbs"), "Build it.").expect("prompt");
    fs::write(dir.join("changelog.md"), "Introduced.").expect("changelog");
    fs::write(dir.join("variants/base.toml"), "slug = \"base\"\n").expect("variant");
    let manifest = format!(
        "slug = \"{slug}\"\nname = \"Case\"\ndifficulty = \"easy\"\ntags = []\n\
         prompt = \"prompt.hbs\"\nchangelog = \"changelog.md\"\nvariants = [\"variants/base.toml\"]\n\
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
fn a_version_directory_without_a_manifest_is_skipped_not_a_broken_version() {
    // A version's build artifacts (a `reference-impl/` with its `node_modules/`,
    // `dist/`, …) can linger on disk after the manifest itself has moved to another
    // branch, leaving a directory that looks like a version but carries no
    // `test-case.toml`. Such a directory is not a version: discovery skips it rather
    // than surfacing it as a broken one, so a single stray folder can't make the
    // whole catalog fail to `list()`.
    let dir = tempfile::tempdir().expect("temp dir");
    write_slugged_case(dir.path(), "carom", "v1.0.0", "pong");
    // A manifest-less `v2.0.1` alongside it, holding only leftover build output.
    let orphan = dir
        .path()
        .join("end-to-end/easy/carom/v2.0.1/reference-impl/base");
    fs::create_dir_all(&orphan).expect("orphan artifact dir");
    fs::write(orphan.join("index.html"), "<html></html>").expect("orphan artifact");
    let catalog = TestCaseCatalog::new(dir.path());

    // The catalog still lists the case, and only the real (manifest-backed) version.
    let cases = catalog
        .list()
        .expect("list skips the manifest-less directory");
    let case = cases
        .iter()
        .find(|c| c.slug == "pong")
        .expect("the real case is listed");
    assert_eq!(
        case.versions,
        ["v1.0.0"],
        "the manifest-less v2.0.1 is not counted as a version"
    );
    assert_eq!(
        catalog.versions("carom").expect("versions"),
        ["v1.0.0"],
        "version discovery skips the manifest-less directory too"
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
         changelog = \"changelog.md\"\n\
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
         packs = [\"naval-weapons@1.0.0\"]\n\
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
    // The palette is not part of the clip's output format: it is one ordered list
    // for every test type.
    assert_eq!(version.audio_packs, vec!["naval-weapons@1.0.0".to_string()]);
}

#[test]
fn audio_sample_requires_one_pack() {
    let manifest = format!(
        "{NEW_FAMILY_HEADER}asset_kind = \"sfx-sample\"\nvariants = [\"variants/base.toml\"]\n\
         [audio]\nsample_rate = 44100\nchannels = \"stereo\"\nmax_duration_ms = 5000\n\
         [tool]\nbinary = \"sfx-sample\"\npreview = \"waveform.png\"\n\
         [output]\nactions = \"actions.json\"\n{NEW_FAMILY_TAIL}"
    );
    let err = asset_catalog(&manifest)
        .1
        .resolve("sprite", "v1.0.0")
        .expect_err("a sfx-sample case declaring no pack is rejected");
    assert!(
        format!("{err}")
            .contains("a `sfx-sample` case declares exactly one pack in audio.packs, not 0"),
        "got: {err}"
    );
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

#[test]
fn variant_reference_implementation_round_trips_to_a_resolved_host_path() {
    // A variant that declares a `reference_implementation` gets that directory
    // resolved onto its `reference_impl` as an absolute host path inside the
    // version folder (the same convention specs and reference sources use), while
    // the same case with the key omitted resolves to `None` — so the field is
    // strictly opt-in.
    let (dir, catalog) =
        catalog_with_manifest("[build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"");
    let version_dir = dir.path().join("end-to-end/easy/demo/v1.0.0");
    // The reference implementation is a buildable directory; its contents are
    // never read here (the deploy is out-of-band), only its existence is checked.
    fs::create_dir_all(version_dir.join("reference-impl/base")).expect("create reference impl dir");
    fs::write(
        version_dir.join("reference-impl/base/index.html"),
        "<!doctype html><title>correct</title>",
    )
    .expect("write reference impl file");
    fs::write(
        version_dir.join("variants/base.toml"),
        "slug = \"base\"\nreference_implementation = \"reference-impl/base\"\n",
    )
    .expect("write base variant");

    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    let base = version.variant("base").expect("base variant");
    assert_eq!(
        version.reference_impl_for(base, crate::engine::NONE_SLUG),
        Some(version_dir.join("reference-impl/base").as_path()),
        "the reference implementation resolves to an absolute path inside the version folder",
    );

    // A second case whose `base` variant omits the key resolves with no reference
    // implementation, proving the field is optional.
    let (_bare_dir, bare_catalog) =
        catalog_with_manifest("[build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"");
    let bare_version = bare_catalog.resolve("demo", "v1.0.0").expect("resolve");
    let bare = bare_version.variant("base").expect("base variant");
    assert!(
        bare_version
            .reference_impl_for(bare, crate::engine::NONE_SLUG)
            .is_none(),
        "a variant that declares no reference_implementation has none",
    );
}

/// A case supporting two engines, its `base` variant declaring `variant_extra`.
///
/// A case that declares an engine vendoring a runtime must ship a workspace
/// `package.json` (the file the engine's `file:` dependency is written into when
/// the run is seeded), so the fixture ships one. Both reference-implementation
/// directories exist, so a rejection in these tests is about the *keying* and
/// never about a missing directory.
fn two_engine_catalog(variant_extra: &str) -> (tempfile::TempDir, TestCaseCatalog) {
    let (dir, catalog) = catalog_with_manifest(
        "engines = [\"none\", \"simple-2d\"]\n\
         [build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n\
         [workspaces]\nnone = \"workspaces/none\"\n\"simple-2d\" = \"workspaces/simple-2d\"",
    );
    let version_dir = dir.path().join("end-to-end/easy/demo/v1.0.0");
    for engine in ["none", "simple-2d"] {
        let dir = version_dir.join("workspaces").join(engine);
        fs::create_dir_all(&dir).expect("create workspace dir");
        fs::write(dir.join("package.json"), "{\"name\":\"demo\"}")
            .expect("write workspace package.json");
    }
    for rel in ["reference-impl/base", "reference-impl-simple-2d/base"] {
        fs::create_dir_all(version_dir.join(rel)).expect("create reference impl dir");
        fs::write(
            version_dir.join(rel).join("index.html"),
            "<!doctype html><title>correct</title>",
        )
        .expect("write reference impl file");
    }
    fs::write(
        version_dir.join("variants/base.toml"),
        format!("slug = \"base\"\n{variant_extra}"),
    )
    .expect("write base variant");
    (dir, catalog)
}

#[test]
fn a_reference_implementation_is_keyed_by_engine() {
    // The engine is a run dimension and the build a reference demonstrates differs
    // under each — the engineless build writes its own frame loop, input, audio and
    // diagnostics, the engine build hands all four to the runtime — so a case
    // supporting two engines names one directory per engine, and each resolves to
    // its own path.
    let (dir, catalog) = two_engine_catalog(
        "[reference_implementation]\nnone = \"reference-impl/base\"\n\
         simple-2d = \"reference-impl-simple-2d/base\"\n",
    );
    let version_dir = dir.path().join("end-to-end/easy/demo/v1.0.0");
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    let base = version.variant("base").expect("base variant");
    assert_eq!(
        version.reference_impl_for(base, "none"),
        Some(version_dir.join("reference-impl/base").as_path()),
        "the `none` engine gets the engineless build",
    );
    assert_eq!(
        version.reference_impl_for(base, "simple-2d"),
        Some(version_dir.join("reference-impl-simple-2d/base").as_path()),
        "the `simple-2d` engine gets the build written against the engine",
    );
    assert!(
        version.reference_impl_for(base, "no-such-engine").is_none(),
        "an engine the case does not support has no reference implementation",
    );
}

#[test]
fn a_bare_reference_implementation_stands_for_every_supported_engine() {
    // The string form is the readable spelling for a case whose one implementation
    // is the answer whatever engine is selected, so it resolves for every supported
    // engine rather than only for `none`.
    let (dir, catalog) = two_engine_catalog("reference_implementation = \"reference-impl/base\"\n");
    let version_dir = dir.path().join("end-to-end/easy/demo/v1.0.0");
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    let base = version.variant("base").expect("base variant");
    let expected = Some(version_dir.join("reference-impl/base"));
    for engine in &version.engine_slugs() {
        assert_eq!(
            version
                .reference_impl_for(base, engine)
                .map(Path::to_path_buf),
            expected,
            "the bare form stands for engine `{engine}`",
        );
    }
}

#[test]
fn a_per_engine_reference_implementation_must_cover_every_supported_engine() {
    // A table that omits a supported engine would leave a run on that engine with no
    // authored answer to show, so it is rejected at resolution rather than surfacing
    // as an empty "Reference" tab.
    let (_dir, catalog) =
        two_engine_catalog("[reference_implementation]\nnone = \"reference-impl/base\"\n");
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a per-engine table omitting a supported engine is rejected");
    assert!(
        format!("{err}").contains("names none for `simple-2d`"),
        "unexpected error: {err}",
    );
}

#[test]
fn a_per_engine_reference_implementation_may_not_name_an_unsupported_engine() {
    // Naming an engine the case does not support is a typo — the directory would
    // never be built or deployed — so it fails the manifest rather than being
    // ignored.
    let (_dir, catalog) = two_engine_catalog(
        "[reference_implementation]\nnone = \"reference-impl/base\"\n\
         simple-2d = \"reference-impl-simple-2d/base\"\n\
         no-such-engine = \"reference-impl/base\"\n",
    );
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a per-engine table naming an unsupported engine is rejected");
    assert!(
        format!("{err}").contains("which this case does not support"),
        "unexpected error: {err}",
    );
}

#[test]
fn a_missing_reference_implementation_directory_is_rejected() {
    // Like every other declared path, the reference implementation is validated to
    // exist at resolution so a typo fails fast rather than surfacing as a broken
    // out-of-band deploy. A path that names no directory is rejected.
    let (dir, catalog) =
        catalog_with_manifest("[build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"");
    fs::write(
        dir.path()
            .join("end-to-end/easy/demo/v1.0.0/variants/base.toml"),
        "slug = \"base\"\nreference_implementation = \"reference-impl/gone\"\n",
    )
    .expect("write base variant");
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a reference_implementation naming no directory is rejected");
    assert!(
        format!("{err}").contains("reference implementation")
            && format!("{err}").contains("is not a directory"),
        "unexpected error: {err}",
    );
}

#[test]
fn a_reference_implementation_is_never_seeded_into_the_run() {
    // The reference implementation is the authored *answer*: seeding it would hand
    // a model the finished game. Prove it takes no part in the seed by declaring a
    // real workspace alongside it and asserting nothing under the reference-impl
    // directory appears in any seeded set (common or variant specs/workspace).
    let (dir, catalog) = catalog_with_manifest(
        "workspace = \"workspace\"\n[build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"",
    );
    let version_dir = dir.path().join("end-to-end/easy/demo/v1.0.0");
    // A starter workspace that IS seeded, so the assertion below is meaningful:
    // there is real seeded content to distinguish the reference impl from.
    fs::create_dir_all(version_dir.join("workspace")).expect("create workspace dir");
    fs::write(
        version_dir.join("workspace/package.json"),
        "{\"name\":\"demo\"}",
    )
    .expect("write workspace file");
    // The reference implementation lives beside the workspace but must never leak
    // into the run tree.
    fs::create_dir_all(version_dir.join("reference-impl/base")).expect("create reference impl dir");
    fs::write(
        version_dir.join("reference-impl/base/index.html"),
        "<!doctype html><title>correct</title>",
    )
    .expect("write reference impl file");
    fs::write(
        version_dir.join("variants/base.toml"),
        "slug = \"base\"\nreference_implementation = \"reference-impl/base\"\n",
    )
    .expect("write base variant");

    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    let base = version.variant("base").expect("base variant");
    let reference_dir = version_dir.join("reference-impl");

    // The workspace was seeded (proof there is real content), and the reference
    // implementation was resolved onto the variant.
    assert!(
        !version.common_workspace.is_empty(),
        "the declared workspace is seeded",
    );
    assert!(
        version
            .reference_impl_for(base, crate::engine::NONE_SLUG)
            .is_some(),
        "the reference impl resolved",
    );

    // Every seeded source — common and variant specs, common and variant
    // workspace files — must live outside the reference-impl directory.
    let seeded_sources = version
        .common_specs
        .iter()
        .map(|spec| &spec.source_path)
        .chain(base.specs.iter().map(|spec| &spec.source_path))
        .chain(
            version
                .common_workspace
                .files()
                .map(|file| &file.source_path),
        )
        .chain(
            base.workspace
                .iter()
                .flat_map(crate::test_case::EngineWorkspaces::files)
                .map(|file| &file.source_path),
        );
    for source in seeded_sources {
        assert!(
            !source.starts_with(&reference_dir),
            "no seeded source may come from the reference implementation, got `{}`",
            source.display(),
        );
    }
}

/// Write a resolvable game jam under a fresh catalog laid out like the real repo — a
/// `test-cases/` root with a sibling `game-jams/` folder discovery folds in — and
/// return the temp dir (kept alive) plus the catalog rooted at `test-cases/`.
/// `manifest` is the full `game-jam.toml` body.
pub(super) fn catalog_with_jam(manifest: &str) -> (tempfile::TempDir, TestCaseCatalog) {
    let dir = tempfile::tempdir().expect("temp dir");
    // An (empty) test-cases root so discovery has a catalog root to walk; the jam
    // lives in the sibling game-jams/ folder that `case_folders` folds in.
    let cases_root = dir.path().join("test-cases");
    fs::create_dir_all(&cases_root).expect("create test-cases root");
    let version = dir.path().join("game-jams/trains/v1.0.0");
    fs::create_dir_all(&version).expect("create jam version dir");
    fs::write(
        version.join("prompt.hbs"),
        "Build a game. You have {{time_limit_hours}} hours.",
    )
    .expect("write prompt");
    fs::write(version.join("changelog.md"), "Introduced.").expect("write changelog");
    fs::write(version.join("game-jam.toml"), manifest).expect("write jam manifest");
    let catalog = TestCaseCatalog::new(&cases_root);
    (dir, catalog)
}

/// The smallest valid `game-jam.toml`: identity, prompt, changelog, and a `[build]`.
/// No `difficulty`, no `variants`, none of the spec-driven tables.
pub(super) const MINIMAL_JAM: &str = "slug = \"trains\"\nname = \"Trains\"\nprompt = \"prompt.hbs\"\n\
     changelog = \"changelog.md\"\nmax_runtime_hours = 8\n\
     [build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n";

#[test]
fn resolves_a_game_jam_from_its_own_manifest() {
    let (_dir, catalog) = catalog_with_jam(MINIMAL_JAM);
    let version = catalog.resolve("trains", "v1.0.0").expect("resolve jam");

    assert_eq!(version.test_type, TestType::GameJam);
    // A jam declares no difficulty; resolution carries the internal placeholder.
    assert_eq!(version.difficulty, "unrated");
    // It has the build interface a full-stack case does.
    assert_eq!(
        version.build,
        Some(BuildCommands {
            install: "npm ci".to_string(),
            build: "npm run build".to_string(),
            module: None,
        })
    );
    // It has no scoring domains, and exactly one synthesized theme variant.
    assert!(version.domains.is_empty());
    let variant_slugs: Vec<&str> = version.variants.iter().map(|v| v.slug.as_str()).collect();
    assert_eq!(variant_slugs, vec!["default"]);
    // With no authored categories it gets the generic graded checklist.
    assert!(!version.common_review_items.is_empty());
    assert!(version.common_review_items.iter().all(|item| item.graded));
}

#[test]
fn game_jam_surfaces_the_time_limit_in_its_prompt() {
    let (_dir, catalog) = catalog_with_jam(MINIMAL_JAM);
    let version = catalog.resolve("trains", "v1.0.0").expect("resolve jam");
    let variant = version.variants.first().expect("one variant");
    // No engine: a jam's time-limit line is engine-independent, and `None` is the
    // engineless run every case supports.
    let prompt = crate::render_prompt(&version, variant, &[], None).expect("render prompt");
    // `{{time_limit_hours}}` renders the case's max_runtime_hours (8) for the model.
    assert!(
        prompt.contains("You have 8 hours."),
        "prompt should state the time budget, got: {prompt}"
    );
}

#[test]
fn game_jam_rejects_a_difficulty_field() {
    // `difficulty` is a test-case-only key; a jam manifest that declares it is
    // rejected at parse (deny_unknown_fields), not silently carried.
    let manifest = format!("difficulty = \"medium\"\n{MINIMAL_JAM}");
    let (_dir, catalog) = catalog_with_jam(&manifest);
    let err = catalog
        .resolve("trains", "v1.0.0")
        .expect_err("a jam declaring difficulty is rejected");
    assert!(
        format!("{err}").contains("difficulty"),
        "unexpected error: {err}"
    );
}

#[test]
fn game_jam_rejects_a_variants_field() {
    // A jam has no variants; declaring the test-case `variants` key is rejected.
    let manifest = format!("variants = [\"variants/base.toml\"]\n{MINIMAL_JAM}");
    let (_dir, catalog) = catalog_with_jam(&manifest);
    let err = catalog
        .resolve("trains", "v1.0.0")
        .expect_err("a jam declaring variants is rejected");
    assert!(
        format!("{err}").contains("variants"),
        "unexpected error: {err}"
    );
}

/// Build an end-to-end manifest with a `[build]` table, splicing in the given
/// `[instrumentation]` and `[[review_item]]` bodies, for the auto-validation tests.
fn instrumented_manifest(instrumentation: &str, review_item: &str) -> String {
    format!(
        "slug = \"demo\"\nname = \"Demo\"\ndifficulty = \"easy\"\ntags = []\n\
         prompt = \"prompt.hbs\"\nchangelog = \"changelog.md\"\n\
         variants = [\"variants/base.toml\"]\n\
         [build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n\
         {instrumentation}\n{review_item}\n\
         [[domain]]\nid = \"g\"\ndescription = \"d\"\n"
    )
}

#[test]
fn instrumentation_and_item_validation_resolve() {
    let manifest = instrumented_manifest(
        "[instrumentation]\nhandle = \"__demo\"",
        "[[review_item]]\nid = \"spin\"\ntitle = \"Spin\"\ntext = \"t\"\nweight = 1\n\
         validation = { script = \"validation/spin.mjs\", outputs = [ \
         { id = \"clip\", kind = \"video\" }, { id = \"still\", name = \"A still\", kind = \"image\" } ] }",
    );
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[("validation/spin.mjs", "export default async () => ({});")],
    );
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    let instrumentation = version.instrumentation.as_ref().expect("instrumentation");
    assert_eq!(instrumentation.handle, "__demo");
    // A case that declares no rate is real-time-clocked: the driver gets no
    // `--tick-hz` and falls back to its own timing.
    assert_eq!(instrumentation.tick_hz, None);
    let item = version
        .common_review_items
        .iter()
        .find(|item| item.id == "spin")
        .expect("review item");
    let validation = item.validation.as_ref().expect("validation");
    assert_eq!(validation.script_rel, "validation/spin.mjs");
    assert!(
        validation
            .script
            .as_deref()
            .is_some_and(std::path::Path::is_file)
    );
    assert_eq!(validation.outputs.len(), 2);
    assert_eq!(validation.outputs[0].id, "clip");
    assert_eq!(validation.outputs[0].kind, MediaKind::Video);
    // An unnamed output humanizes its id; an explicit name is kept.
    assert_eq!(validation.outputs[0].name, "Clip");
    assert_eq!(validation.outputs[1].name, "A still");
}

#[test]
fn item_validation_without_instrumentation_is_rejected() {
    let manifest = instrumented_manifest(
        "",
        "[[review_item]]\nid = \"spin\"\ntitle = \"Spin\"\ntext = \"t\"\nweight = 1\n\
         validation = { script = \"validation/spin.mjs\" }",
    );
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[("validation/spin.mjs", "export default async () => ({});")],
    );
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("validation without instrumentation is rejected");
    assert!(
        format!("{err}").contains("no [instrumentation] handle"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_missing_validation_script_is_rejected() {
    let manifest = instrumented_manifest(
        "[instrumentation]\nhandle = \"__demo\"",
        "[[review_item]]\nid = \"spin\"\ntitle = \"Spin\"\ntext = \"t\"\nweight = 1\n\
         validation = { script = \"validation/missing.mjs\" }",
    );
    let (_dir, catalog) = catalog_with_files(&manifest, &[]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a validation script naming a missing file is rejected");
    assert!(
        format!("{err}").contains("is not a file"),
        "unexpected error: {err}"
    );
}

#[test]
fn duplicate_validation_output_ids_are_rejected() {
    let manifest = instrumented_manifest(
        "[instrumentation]\nhandle = \"__demo\"",
        "[[review_item]]\nid = \"spin\"\ntitle = \"Spin\"\ntext = \"t\"\nweight = 1\n\
         validation = { script = \"validation/spin.mjs\", outputs = [ \
         { id = \"a\", kind = \"image\" }, { id = \"a\", kind = \"image\" } ] }",
    );
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[("validation/spin.mjs", "export default async () => ({});")],
    );
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("duplicate output ids are rejected");
    assert!(
        format!("{err}").contains("two validation outputs with id"),
        "unexpected error: {err}"
    );
}

#[test]
fn more_than_one_video_output_is_rejected() {
    let manifest = instrumented_manifest(
        "[instrumentation]\nhandle = \"__demo\"",
        "[[review_item]]\nid = \"spin\"\ntitle = \"Spin\"\ntext = \"t\"\nweight = 1\n\
         validation = { script = \"validation/spin.mjs\", outputs = [ \
         { id = \"a\", kind = \"video\" }, { id = \"b\", kind = \"video\" } ] }",
    );
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[("validation/spin.mjs", "export default async () => ({});")],
    );
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a second video output is rejected");
    assert!(
        format!("{err}").contains("more than one video"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_media_kind_is_inferred_from_an_extension() {
    // The three kinds a case may name, and the answer for an extension that is none
    // of them. A recording is the only non-pixel evidence a point can declare, and
    // the reason the inference is not just image-or-video.
    let kind = |name: &str| MediaKind::from_path(Path::new(name));
    assert_eq!(kind("shots/title.PNG"), Some(MediaKind::Image));
    assert_eq!(kind("clips/rally.webm"), Some(MediaKind::Video));
    assert_eq!(kind("clips/rally.mp4"), Some(MediaKind::Video));
    assert_eq!(kind("recordings/serve.json"), Some(MediaKind::Replay));
    assert_eq!(kind("notes.txt"), None);
    assert_eq!(kind("no-extension"), None);
}

#[test]
fn a_recording_is_recognized_by_its_compound_extension() {
    // A recording is stored gzipped, so its name carries two extensions and the
    // single extension of `serve.json.gz` is `gz`, not `json.gz`. Every route that
    // resolves stored media back to its kind depends on the compound suffix being
    // matched against the whole name, so it is asserted here rather than left to the
    // caller to remember.
    let kind = |name: &str| MediaKind::from_path(Path::new(name));
    assert_eq!(
        Path::new("no-tunnel__serve.json.gz")
            .extension()
            .and_then(|ext| ext.to_str()),
        Some("gz"),
        "the premise: the standard extension of a stored recording is `gz`",
    );
    assert_eq!(kind("no-tunnel__serve.json.gz"), Some(MediaKind::Replay));
    assert_eq!(
        kind("media/NO-TUNNEL__SERVE.JSON.GZ"),
        Some(MediaKind::Replay)
    );
    // Compression is how a recording travels rather than part of what it is, so an
    // uncompressed one names the same kind.
    assert_eq!(kind("recordings/serve.json"), Some(MediaKind::Replay));
    // A gzipped anything-else is not a recording, and neither is a name that is
    // nothing but the suffix.
    assert_eq!(kind("archive/tree.tar.gz"), None);
    assert_eq!(kind(".json.gz"), None);
}

#[test]
fn a_replay_output_resolves_and_is_not_limited_to_one_per_script() {
    // A clip is a property of the whole drive, so a script records at most one of
    // them. A recording is armed and disarmed by the validator around whichever
    // stretch of its scenario it wants evidence of, so a point may declare several —
    // and each is a separate output with its own id. The one-video rule counts
    // `video` alone, and this is what proves it does not reach `replay`.
    let manifest = instrumented_manifest(
        "[instrumentation]\nhandle = \"__demo\"",
        "[[review_item]]\nid = \"spin\"\ntitle = \"Spin\"\ntext = \"t\"\nweight = 1\n\
         validation = { script = \"validation/spin.mjs\", outputs = [ \
         { id = \"serve\", kind = \"replay\" }, \
         { id = \"rebound\", name = \"The rebound\", kind = \"replay\" }, \
         { id = \"clip\", kind = \"video\" } ] }",
    );
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[("validation/spin.mjs", "export default async () => ({});")],
    );
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    let item = version
        .common_review_items
        .iter()
        .find(|item| item.id == "spin")
        .expect("review item");
    let outputs = &item.validation.as_ref().expect("validation").outputs;
    assert_eq!(outputs.len(), 3);
    assert_eq!(outputs[0].kind, MediaKind::Replay);
    assert_eq!(
        outputs[0].name, "Serve",
        "an unnamed output humanizes its id"
    );
    assert_eq!(outputs[1].kind, MediaKind::Replay);
    assert_eq!(outputs[1].name, "The rebound");
    assert_eq!(
        outputs[2].kind,
        MediaKind::Video,
        "the one clip the script is allowed sits beside them",
    );
}

#[test]
fn a_reference_view_may_not_be_a_recording() {
    // A reference view is the committed picture of the intended result a reviewer
    // looks at beside the build. A recording carries no picture of its own — only
    // the operations some build issued — so it is synthesized per validation rather
    // than committed as a mockup, and naming one here is a manifest error.
    let manifest = instrumented_manifest(
        "[[reference]]\nview = \"title\"\nmedia = \"refs/title.json\"",
        "",
    );
    let (_dir, catalog) = catalog_with_files(&manifest, &[("refs/title.json", "{}")]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a recording is not a reference view");
    assert!(
        format!("{err}").contains("draw-command recording"),
        "unexpected error: {err}"
    );
}

#[test]
fn sub_item_validation_resolves() {
    // An item broken into sub-items carries its validation on the sub-items, not on
    // the item: each validated sub-item resolves its own driver, and a human-judged
    // sub-item has none.
    let manifest = instrumented_manifest(
        "[instrumentation]\nhandle = \"__demo\"",
        "[[review_item]]\nid = \"spin\"\ntitle = \"Spin\"\ntext = \"t\"\nweight = 1\n\
         [[review_item.sub_item]]\nid = \"a\"\ntitle = \"A\"\n\
         validation = { script = \"validation/a.mjs\", outputs = [ { id = \"clip\", kind = \"video\" } ] }\n\
         [[review_item.sub_item]]\nid = \"b\"\ntitle = \"B\"",
    );
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[("validation/a.mjs", "export default async () => ({});")],
    );
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    let item = version
        .common_review_items
        .iter()
        .find(|item| item.id == "spin")
        .expect("review item");
    // The item itself carries no validation; each validated sub-item does.
    assert!(item.validation.is_none());
    let a = item.sub_items.iter().find(|s| s.id == "a").expect("sub a");
    let validation = a.validation.as_ref().expect("sub-item validation");
    assert_eq!(validation.script_rel, "validation/a.mjs");
    assert!(
        validation
            .script
            .as_deref()
            .is_some_and(std::path::Path::is_file)
    );
    assert_eq!(validation.outputs.len(), 1);
    assert_eq!(validation.outputs[0].id, "clip");
    assert_eq!(validation.outputs[0].kind, MediaKind::Video);
    // A human-judged sub-item has none.
    let b = item.sub_items.iter().find(|s| s.id == "b").expect("sub b");
    assert!(b.validation.is_none());
}

#[test]
fn item_validation_alongside_sub_items_is_rejected() {
    // Validation attaches to the graded unit: an item with sub-items is verdicted per
    // sub-item, so an item-level `validation` alongside sub-items is a manifest error.
    let manifest = instrumented_manifest(
        "[instrumentation]\nhandle = \"__demo\"",
        "[[review_item]]\nid = \"spin\"\ntitle = \"Spin\"\ntext = \"t\"\nweight = 1\n\
         sub_items = [ { id = \"a\", title = \"A\" } ]\n\
         validation = { script = \"validation/spin.mjs\" }",
    );
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[("validation/spin.mjs", "export default async () => ({});")],
    );
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("item-level validation alongside sub-items is rejected");
    assert!(
        format!("{err}").contains("both `sub_items` and an item-level `validation`"),
        "unexpected error: {err}"
    );
}

#[test]
fn sub_item_validation_without_instrumentation_is_rejected() {
    // The same handle requirement applies to a sub-item's driver, and the error names
    // the sub-item so an author knows exactly which point is misdeclared.
    let manifest = instrumented_manifest(
        "",
        "[[review_item]]\nid = \"spin\"\ntitle = \"Spin\"\ntext = \"t\"\nweight = 1\n\
         [[review_item.sub_item]]\nid = \"a\"\ntitle = \"A\"\n\
         validation = { script = \"validation/a.mjs\" }",
    );
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[("validation/a.mjs", "export default async () => ({});")],
    );
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("sub-item validation without instrumentation is rejected");
    let msg = format!("{err}");
    assert!(
        msg.contains("no [instrumentation] handle"),
        "unexpected error: {msg}"
    );
    assert!(
        msg.contains("sub-item `a`"),
        "error should name the sub-item: {msg}"
    );
}

#[test]
fn an_instrumentation_tick_rate_resolves_and_must_be_positive() {
    // A fixed-step case declares its simulation rate so the validation runtime can
    // convert exact stepping into real time.
    let manifest =
        instrumented_manifest("[instrumentation]\nhandle = \"__demo\"\ntick_hz = 120", "");
    let (_dir, catalog) = catalog_with_files(&manifest, &[]);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    let instrumentation = version.instrumentation.as_ref().expect("instrumentation");
    assert_eq!(instrumentation.tick_hz, Some(120));

    // A rate that cannot be divided by is meaningless — reject it at resolution
    // rather than hand it to the driver.
    let manifest = instrumented_manifest("[instrumentation]\nhandle = \"__demo\"\ntick_hz = 0", "");
    let (_dir, catalog) = catalog_with_files(&manifest, &[]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a zero tick rate is rejected");
    assert!(
        format!("{err}").contains("must be a positive number of ticks per second"),
        "unexpected error: {err}"
    );
}

#[test]
fn an_instrumentation_handle_must_be_a_plain_identifier() {
    let manifest = instrumented_manifest("[instrumentation]\nhandle = \"win.dow\"", "");
    let (_dir, catalog) = catalog_with_files(&manifest, &[]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a non-identifier handle is rejected");
    assert!(
        format!("{err}").contains("plain identifier"),
        "unexpected error: {err}"
    );
}

// --- errata resolution ------------------------------------------------------

#[test]
fn a_version_without_errata_resolves_with_none() {
    // The `errata.toml` file is optional; a version that ships none resolves with
    // an empty errata list rather than failing.
    let (_dir, catalog) = catalog_with_files(&manifest_with("", ""), &[]);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    assert!(version.errata.is_empty());
}

#[test]
fn errata_resolve_with_defaults_and_carry_fields() {
    // A present `errata.toml` is parsed: fields carry through, `severity` defaults
    // to `minor`, and `affects_scoring` defaults to `false`.
    let errata = "\
[[erratum]]\n\
id = \"cue-clips-rail\"\n\
title = \"Cue ball clips the rail at high speed\"\n\
date = \"2026-07-17\"\n\
severity = \"major\"\n\
affects_scoring = true\n\
resolved_in = \"v1.1.0\"\n\
body = \"The cue ball can tunnel through a rail above a certain speed.\"\n\
\n\
[[erratum]]\n\
id = \"minor-note\"\n\
title = \"A minor note\"\n\
body = \"Just a note.\"\n";
    let (_dir, catalog) = catalog_with_files(&manifest_with("", ""), &[("errata.toml", errata)]);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    assert_eq!(version.errata.len(), 2);

    let first = &version.errata[0];
    assert_eq!(first.id, "cue-clips-rail");
    assert_eq!(first.severity, ErratumSeverity::Major);
    assert!(first.affects_scoring);
    assert_eq!(first.date.as_deref(), Some("2026-07-17"));
    assert_eq!(first.resolved_in.as_deref(), Some("v1.1.0"));

    let second = &version.errata[1];
    // Defaults: severity is `minor`, scoring is not affected, optionals are `None`.
    assert_eq!(second.severity, ErratumSeverity::Minor);
    assert!(!second.affects_scoring);
    assert_eq!(second.date, None);
    assert_eq!(second.resolved_in, None);
    assert_eq!(second.variant, None);
    assert_eq!(second.review, None);
}

#[test]
fn a_duplicate_erratum_id_is_rejected() {
    let errata = "\
[[erratum]]\nid = \"dup\"\ntitle = \"One\"\nbody = \"a\"\n\
[[erratum]]\nid = \"dup\"\ntitle = \"Two\"\nbody = \"b\"\n";
    let (_dir, catalog) = catalog_with_files(&manifest_with("", ""), &[("errata.toml", errata)]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a duplicate erratum id is rejected");
    assert!(
        format!("{err}").contains("duplicate erratum id `dup`"),
        "unexpected error: {err}"
    );
}

#[test]
fn an_erratum_with_an_empty_body_is_rejected() {
    let errata = "[[erratum]]\nid = \"e\"\ntitle = \"Title\"\nbody = \"   \"\n";
    let (_dir, catalog) = catalog_with_files(&manifest_with("", ""), &[("errata.toml", errata)]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("an empty erratum body is rejected");
    assert!(
        format!("{err}").contains("empty `body`"),
        "unexpected error: {err}"
    );
}

#[test]
fn an_erratum_scoped_to_an_unknown_variant_is_rejected() {
    let errata = "\
[[erratum]]\nid = \"e\"\ntitle = \"Title\"\nbody = \"b\"\nvariant = \"nope\"\n";
    let (_dir, catalog) = catalog_with_files(&manifest_with("", ""), &[("errata.toml", errata)]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("an unknown variant scope is rejected");
    assert!(
        format!("{err}").contains("scoped to variant `nope`"),
        "unexpected error: {err}"
    );
}

#[test]
fn an_erratum_referencing_an_unknown_review_id_is_rejected() {
    // The manifest declares a single review item `plays`; a `review` link to any
    // other id is rejected.
    let after_build =
        "[[review_item]]\nid = \"plays\"\ntitle = \"Plays\"\ntext = \"It plays.\"\nweight = 1\n";
    let errata = "\
[[erratum]]\nid = \"e\"\ntitle = \"Title\"\nbody = \"b\"\nreview = \"missing\"\n";
    let (_dir, catalog) =
        catalog_with_files(&manifest_with("", after_build), &[("errata.toml", errata)]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("an unknown review link is rejected");
    assert!(
        format!("{err}").contains("references review id `missing`"),
        "unexpected error: {err}"
    );
}

#[test]
fn an_erratum_may_reference_a_declared_review_id() {
    // A `review` link that names a declared review item id resolves.
    let after_build =
        "[[review_item]]\nid = \"plays\"\ntitle = \"Plays\"\ntext = \"It plays.\"\nweight = 1\n";
    let errata = "\
[[erratum]]\nid = \"e\"\ntitle = \"Title\"\nbody = \"b\"\nreview = \"plays\"\n";
    let (_dir, catalog) =
        catalog_with_files(&manifest_with("", after_build), &[("errata.toml", errata)]);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    assert_eq!(version.errata[0].review.as_deref(), Some("plays"));
}

#[test]
fn an_erratum_excluding_from_score_without_a_review_link_is_rejected() {
    // `exclude_from_score` names nothing to remove without a `review` link, so it is
    // rejected at resolution rather than silently doing nothing.
    let after_build =
        "[[review_item]]\nid = \"plays\"\ntitle = \"Plays\"\ntext = \"It plays.\"\nweight = 1\n";
    let errata = "\
[[erratum]]\nid = \"e\"\ntitle = \"Title\"\nbody = \"b\"\nexclude_from_score = true\n";
    let (_dir, catalog) =
        catalog_with_files(&manifest_with("", after_build), &[("errata.toml", errata)]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("exclude_from_score without a review link is rejected");
    assert!(
        format!("{err}").contains("names no `review` point to exclude"),
        "unexpected error: {err}"
    );
}

#[test]
fn an_erratum_excluding_a_review_point_marks_it_non_scoring() {
    // An erratum with `exclude_from_score` linked to a declared review point resolves,
    // records the flag, and drops the point from the variant's effective checklist
    // score — while `errata_for` still surfaces it so the reason stays visible.
    let after_build = "[[review_item]]\nid = \"plays\"\ntitle = \"Plays\"\ntext = \"It plays.\"\nweight = 1\n\
[[review_item]]\nid = \"scores\"\ntitle = \"Scores\"\ntext = \"It scores.\"\nweight = 2\n";
    let errata = "\
[[erratum]]\nid = \"buggy-check\"\ntitle = \"Buggy check\"\nbody = \"b\"\n\
review = \"plays\"\nexclude_from_score = true\n";
    let (_dir, catalog) =
        catalog_with_files(&manifest_with("", after_build), &[("errata.toml", errata)]);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    let base = version.variant("base").expect("base variant");

    assert!(version.errata[0].exclude_from_score);
    // The excluded verdict id is reported for the variant.
    assert_eq!(
        version.excluded_verdict_ids(base),
        std::collections::HashSet::from(["plays".to_string()])
    );
    // The effective checklist keeps `plays` (still checked and shown) but marks it
    // non-scoring; `scores` is untouched.
    let items = version.review_items_for(base);
    let plays = items.iter().find(|i| i.id == "plays").expect("plays item");
    let scores = items
        .iter()
        .find(|i| i.id == "scores")
        .expect("scores item");
    assert!(!plays.scored, "excluded point should be non-scoring");
    assert!(scores.scored, "unrelated point should still score");
    // The erratum is still surfaced to reviewers for the variant.
    assert!(
        version
            .errata_for(base)
            .iter()
            .any(|e| e.id == "buggy-check")
    );
}

#[test]
fn errata_for_filters_case_wide_and_variant_scoped_entries() {
    // One case-wide erratum (no `variant`) and one scoped to `base`; both apply to
    // the `base` variant. A `variant` scope must name a declared variant, so this
    // uses `base` (the default variant `catalog_with_files` provides).
    let errata = "\
[[erratum]]\nid = \"global\"\ntitle = \"Global\"\nbody = \"applies everywhere\"\n\
[[erratum]]\nid = \"base-only\"\ntitle = \"Base only\"\nbody = \"base\"\nvariant = \"base\"\n";
    let (_dir, catalog) = catalog_with_files(&manifest_with("", ""), &[("errata.toml", errata)]);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    let base = version.variant("base").expect("base variant");
    let applicable: Vec<String> = version
        .errata_for(base)
        .iter()
        .map(|e| e.id.clone())
        .collect();
    assert_eq!(
        applicable,
        vec!["global".to_string(), "base-only".to_string()]
    );
}

// --- the two workspace spellings ---------------------------------------------
//
// A case says which starter project a run is seeded with in exactly one way: one
// `workspace` for the whole case, or one directory per engine in `[workspaces]`.
// These pin both halves of that gate — what each spelling resolves as, and that a
// case mixing them is refused by name.

#[test]
fn one_workspace_is_the_engineless_project() {
    // A case naming a single `workspace` supports no engine, so its one directory
    // is filed under the engineless run it is the project for.
    let manifest = manifest_with("workspace = \"workspaces/base\"\n", "");
    let (_dir, catalog) = catalog_with_files(&manifest, &[("workspaces/base/package.json", "{}")]);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");

    assert_eq!(version.engine_slugs(), vec!["none".to_string()]);
    assert_eq!(
        version.common_workspace.engines().collect::<Vec<_>>(),
        vec!["none"],
        "an engineless case's one project is the engineless run's",
    );
    let base = version.variant("base").expect("base");
    assert_eq!(version.workspace_for(base, "none").len(), 1);
}

#[test]
fn one_workspace_may_not_be_declared_alongside_an_engine() {
    // A starter project is written against a runtime, so a case with one workspace
    // cannot also name the engine that workspace would have to be for.
    let manifest = manifest_with(
        "workspace = \"workspaces/base\"\nengines = [\"simple-2d\"]\n",
        "",
    );
    let (_dir, catalog) = catalog_with_files(&manifest, &[("workspaces/base/package.json", "{}")]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("an engine alongside one `workspace` is rejected");
    assert!(
        format!("{err}").contains("`workspace` names one directory for the whole case"),
        "got: {err}"
    );
}

#[test]
fn the_two_workspace_spellings_may_not_be_mixed() {
    // The refusal is by name rather than by silently ignoring one of them, so an
    // author who wrote both is told which one a case may keep.
    let manifest = manifest_with(
        "workspace = \"workspaces/base\"\n",
        "[workspaces]\nnone = \"workspaces/none\"\n",
    );
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[
            ("workspaces/base/package.json", "{}"),
            ("workspaces/none/package.json", "{}"),
        ],
    );
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("`workspace` alongside `[workspaces]` is rejected");
    assert!(
        format!("{err}").contains("`workspace` names one directory for the whole case"),
        "got: {err}"
    );
}

#[test]
fn a_variant_may_not_mix_the_two_spellings_either() {
    // A variant spells its own starter project the way its case does, so the same
    // gate applies to the variant files.
    let manifest = engines_manifest_with("engines = [\"none\"]\n", "", &["none"]);
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[
            ("workspaces/none/package.json", "{}"),
            (
                "variants/base.toml",
                "slug = \"base\"\nworkspace = \"workspaces/none\"\n",
            ),
        ],
    );
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a variant's `workspace` in a per-engine case is rejected");
    assert!(
        format!("{err}").contains("variant `base` declares `workspace`"),
        "got: {err}"
    );
}

#[test]
fn a_per_engine_case_seeds_one_project_per_engine() {
    // The whole point of the per-engine table: a run of each engine is seeded the
    // project written for that engine, and the two are different sets of files.
    let manifest = engines_manifest_with(
        "engines = [\"none\", \"simple-2d\"]\n",
        "",
        &["none", "simple-2d"],
    );
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[
            ("workspaces/none/package.json", "{}"),
            ("workspaces/none/src/host.ts", "// the runtime"),
            ("workspaces/simple-2d/package.json", "{}"),
        ],
    );
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    let base = version.variant("base").expect("base");

    let dests = |engine: &str| -> Vec<String> {
        let mut dests: Vec<String> = version
            .workspace_for(base, engine)
            .iter()
            .map(|file| file.dest.display().to_string())
            .collect();
        dests.sort();
        dests
    };
    assert_eq!(dests("none"), ["package.json", "src/host.ts"]);
    assert_eq!(dests("simple-2d"), ["package.json"]);
    assert!(
        version.workspace_for(base, "not-an-engine").is_empty(),
        "an engine the case does not support seeds nothing",
    );
}

#[test]
fn a_per_engine_workspace_table_must_cover_every_supported_engine() {
    // Omitting one would leave a run of that engine with nothing to seed, which is
    // an authoring slip worth a `tcab validate` rather than a spent run.
    let manifest =
        engines_manifest_with("engines = [\"none\", \"simple-2d\"]\n", "", &["simple-2d"]);
    let (_dir, catalog) = catalog_with_files(&manifest, ENGINE_WORKSPACE_FILES);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a short `[workspaces]` table is rejected");
    let msg = format!("{err}");
    assert!(
        msg.contains("names no workspace for engine `none`"),
        "got: {err}"
    );
}

#[test]
fn a_per_engine_workspace_table_may_not_name_an_unsupported_engine() {
    let manifest = engines_manifest_with("engines = [\"none\"]\n", "", &["none", "simple-2d"]);
    let (_dir, catalog) = catalog_with_files(&manifest, ENGINE_WORKSPACE_FILES);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("an unsupported engine in `[workspaces]` is rejected");
    assert!(
        format!("{err}").contains("which this case does not support"),
        "got: {err}"
    );
}

#[test]
fn a_variant_workspace_table_replaces_the_case_s_whole_table() {
    // A variant cannot override one engine's project and inherit another's: the two
    // halves would be different baselines of the same variant, so a variant that
    // declares the table covers every engine the case supports.
    let manifest = engines_manifest_with(
        "engines = [\"none\", \"simple-2d\"]\n",
        "",
        &["none", "simple-2d"],
    )
    .replace(
        "variants = [\"variants/base.toml\"]",
        "variants = [\"variants/base.toml\", \"variants/special.toml\"]",
    );
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[
            ("workspaces/none/package.json", "{}"),
            ("workspaces/simple-2d/package.json", "{}"),
            ("special/none/package.json", "{}"),
            ("special/none/extra.txt", "x"),
            ("special/simple-2d/package.json", "{}"),
            (
                "variants/special.toml",
                "slug = \"special\"\n[workspaces]\nnone = \"special/none\"\n\
                 \"simple-2d\" = \"special/simple-2d\"\n",
            ),
        ],
    );
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    let base = version.variant("base").expect("base");
    let special = version.variant("special").expect("special");

    assert_eq!(version.workspace_for(base, "none").len(), 1);
    assert_eq!(
        version.workspace_for(special, "none").len(),
        2,
        "the variant's own project replaces the case's",
    );
    assert_eq!(version.workspace_for(special, "simple-2d").len(), 1);
}

#[test]
fn a_per_engine_validator_must_exist_in_every_engine_s_project() {
    // A point decided under one engine and left to the reviewer under another would
    // be the same case graded two ways, so resolution holds the declaration against
    // every project the case ships.
    let review = "[review]\nformat = 2\n\
                  [[review.categories]]\nid = \"gameplay\"\ntitle = \"Gameplay\"\n\
                  [[review.categories.items]]\nid = \"serve\"\ntitle = \"Serve\"\n\
                  failure_cap = \"broken\"\ndomains = [\"gameplay\"]\n\
                  validation = { script = \"gameplay/serve.test.ts\", outputs = [\
                  { id = \"serve\", kind = \"video\" } ] }\n";
    let files: &[(&str, &str)] = &[
        ("workspaces/none/package.json", "{}"),
        ("workspaces/simple-2d/package.json", "{}"),
        ("validation/none/vitest.config.ts", "export default {}"),
        ("validation/none/gameplay/serve.test.ts", "// check"),
        ("validation/simple-2d/vitest.config.ts", "export default {}"),
    ];
    let manifest = engines_manifest_with(
        "engines = [\"none\", \"simple-2d\"]\n",
        &format!("[instrumentation]\nhandle = \"__demo\"\n{review}"),
        &["none", "simple-2d"],
    );
    let (_dir, catalog) = catalog_with_files(&manifest, files);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a validator missing from one engine's project is rejected");
    let msg = format!("{err}");
    assert!(
        msg.contains("is not a file in engine `simple-2d`"),
        "got: {err}"
    );

    // With the suite present in both projects it resolves, carrying no single host
    // path — which engine's copy decides a run is the run's engine to say.
    let mut with_both = files.to_vec();
    with_both.push(("validation/simple-2d/gameplay/serve.test.ts", "// check"));
    let (_dir, catalog) = catalog_with_files(&manifest, &with_both);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    let base = version.variant("base").expect("base");
    let item = &version.review_items_for(base)[0];
    let validation = item.sub_items[0]
        .validation
        .as_ref()
        .expect("the sub-item carries its validator");
    assert_eq!(validation.script, None);
    assert_eq!(validation.script_rel, "gameplay/serve.test.ts");
}

// --- validator engine scoping (`validation.engines`) --------------------------

/// The files a per-engine scoping fixture ships: one starter workspace and one
/// validator project per engine, with `gameplay/serve.test.ts` in both projects and
/// `hud/overlay.test.ts` only in the engineless one.
const SCOPED_VALIDATOR_FILES: &[(&str, &str)] = &[
    ("workspaces/none/package.json", "{}"),
    ("workspaces/simple-2d/package.json", "{}"),
    ("validation/none/vitest.config.ts", "export default {}"),
    ("validation/none/gameplay/serve.test.ts", "// check"),
    ("validation/none/hud/overlay.test.ts", "// check"),
    ("validation/simple-2d/vitest.config.ts", "export default {}"),
    ("validation/simple-2d/gameplay/serve.test.ts", "// check"),
];

/// A `[[review_item]]` graded as a whole and decided by the validator at `script`,
/// with `extra` spliced into its `validation` table (the `engines` scoping under
/// test, or nothing at all).
fn scoped_item(id: &str, script: &str, extra: &str) -> String {
    format!(
        "[[review_item]]\nid = \"{id}\"\ntitle = \"{id}\"\ntext = \"t\"\nweight = 1\n\
         failure_cap = \"scuffed\"\ndomains = [\"gameplay\"]\n\
         validation = {{ script = \"{script}\", {extra}outputs = [\
         {{ id = \"{id}\", kind = \"image\" }} ] }}\n"
    )
}

/// A `[[review_item]]` broken into sub-items, each decided by the validator at
/// `<id>/<sub>.test.ts` with `extra` spliced into its `validation` table.
fn scoped_sub_items(id: &str, subs: &[(&str, &str)]) -> String {
    let mut toml = format!(
        "[[review_item]]\nid = \"{id}\"\ntitle = \"{id}\"\ntext = \"t\"\nweight = {}\n",
        subs.len()
    );
    for (sub, extra) in subs {
        toml.push_str(&format!(
            "[[review_item.sub_item]]\nid = \"{sub}\"\ntitle = \"{sub}\"\n\
             failure_cap = \"scuffed\"\ndomains = [\"gameplay\"]\n\
             validation = {{ script = \"{id}/{sub}.test.ts\", {extra}outputs = [\
             {{ id = \"{sub}\", kind = \"image\" }} ] }}\n"
        ));
    }
    toml
}

/// Resolve a per-engine manifest supporting `none` and `simple-2d` whose review
/// block is `review`, over `files`.
fn resolve_scoped(review: &str, files: &[(&str, &str)]) -> Result<TestCaseVersion> {
    let manifest = engines_manifest_with(
        "engines = [\"none\", \"simple-2d\"]\n",
        &format!("[instrumentation]\nhandle = \"__demo\"\n{review}"),
        &["none", "simple-2d"],
    );
    let (_dir, catalog) = catalog_with_files(&manifest, files);
    catalog.resolve("demo", "v1.0.0")
}

#[test]
fn a_validator_scoped_to_one_engine_resolves_against_that_engine_s_project_alone() {
    // The point the scoping exists for: a debug overlay the model writes itself in an
    // engineless build and the engine draws otherwise. The suite ships in the
    // engineless project only, and resolution holds the declaration against exactly
    // the engines it names.
    let version = resolve_scoped(
        &scoped_item("overlay", "hud/overlay.test.ts", "engines = [\"none\"], "),
        SCOPED_VALIDATOR_FILES,
    )
    .expect("resolve");
    let base = version.variant("base").expect("base");
    let item = &version.review_items_for(base)[0];
    let validation = item
        .validation
        .as_ref()
        .expect("the item carries a validator");
    assert_eq!(validation.engines, vec!["none".to_string()]);
    assert!(validation.covers("none"));
    assert!(!validation.covers("simple-2d"));
}

#[test]
fn an_unscoped_validator_covers_every_engine_the_case_supports() {
    // No `engines` is the whole supported set, which is what every manifest written
    // before the key existed means.
    let version = resolve_scoped(
        &scoped_item("serve", "gameplay/serve.test.ts", ""),
        SCOPED_VALIDATOR_FILES,
    )
    .expect("resolve");
    let base = version.variant("base").expect("base");
    let validation = version.review_items_for(base)[0]
        .validation
        .clone()
        .expect("the item carries a validator");
    assert!(validation.engines.is_empty());
    assert!(validation.covers("none"));
    assert!(validation.covers("simple-2d"));
}

#[test]
fn a_scoped_validator_missing_from_a_covered_engine_s_project_is_rejected() {
    // Scoping narrows which projects must ship the suite; it does not excuse one the
    // declaration still names.
    let err = resolve_scoped(
        &scoped_item(
            "overlay",
            "hud/overlay.test.ts",
            "engines = [\"none\", \"simple-2d\"], ",
        ),
        SCOPED_VALIDATOR_FILES,
    )
    .expect_err("a covered engine whose project lacks the suite is rejected");
    assert!(
        format!("{err}").contains("is not a file in engine `simple-2d`"),
        "got: {err}"
    );
}

#[test]
fn a_scoped_validator_shipped_to_an_uncovered_engine_is_rejected() {
    // A suite sitting in the project of an engine the validator does not name is a
    // file nothing will ever run — either the scoping or the file is wrong.
    let mut files = SCOPED_VALIDATOR_FILES.to_vec();
    files.push(("validation/simple-2d/hud/overlay.test.ts", "// check"));
    let err = resolve_scoped(
        &scoped_item("overlay", "hud/overlay.test.ts", "engines = [\"none\"], "),
        &files,
    )
    .expect_err("a suite in an uncovered engine's project is rejected");
    assert!(
        format!("{err}").contains("which its `engines` does not name"),
        "got: {err}"
    );
}

#[test]
fn validation_engines_on_a_case_with_no_engine_are_rejected() {
    // A case naming one `workspace` has no engine to scope to, so the key is refused
    // by name rather than silently ignored.
    let manifest = manifest_with(
        "workspace = \"workspaces/base\"\n",
        "[instrumentation]\nhandle = \"__demo\"\n\
         [[review_item]]\nid = \"spin\"\ntitle = \"Spin\"\ntext = \"t\"\nweight = 1\n\
         validation = { script = \"validation/spin.mjs\", engines = [\"none\"], \
         outputs = [ { id = \"spin\", kind = \"image\" } ] }\n",
    );
    let (_dir, catalog) = catalog_with_files(
        &manifest,
        &[
            ("workspaces/base/package.json", "{}"),
            ("validation/spin.mjs", "export default async () => ({});"),
        ],
    );
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a case with no engine may not scope a validator");
    assert!(
        format!("{err}").contains("has engines to scope to"),
        "got: {err}"
    );
}

#[test]
fn a_validator_scoped_to_an_unsupported_engine_is_rejected() {
    let err = resolve_scoped(
        &scoped_item(
            "overlay",
            "hud/overlay.test.ts",
            "engines = [\"structured-2d\"], ",
        ),
        SCOPED_VALIDATOR_FILES,
    )
    .expect_err("an engine the case does not support is a typo, not a scope");
    assert!(
        format!("{err}").contains("engine `structured-2d`, which this case does not support"),
        "got: {err}"
    );
}

#[test]
fn a_validator_naming_the_same_engine_twice_is_rejected() {
    let err = resolve_scoped(
        &scoped_item(
            "overlay",
            "hud/overlay.test.ts",
            "engines = [\"none\", \"none\"], ",
        ),
        SCOPED_VALIDATOR_FILES,
    )
    .expect_err("a repeated slug is rejected");
    assert!(
        format!("{err}").contains("names engine `none` twice"),
        "got: {err}"
    );
}

#[test]
fn the_engine_aware_checklist_drops_the_points_a_run_s_engine_does_not_carry() {
    // Four points: one whole item scoped to `none`, one unscoped whole item, a
    // category with one scoped and one unscoped point, and a category whose only
    // point is scoped. A run on `simple-2d` carries the second and the surviving half
    // of the third; a run on `none` carries all four.
    let review = format!(
        "{}{}{}{}",
        scoped_item("overlay", "hud/overlay.test.ts", "engines = [\"none\"], "),
        scoped_item("serve", "gameplay/serve.test.ts", ""),
        scoped_sub_items("hud", &[("a", "engines = [\"none\"], "), ("b", "")]),
        scoped_sub_items("gyre", &[("sway", "engines = [\"none\"], ")]),
    );
    let mut files = SCOPED_VALIDATOR_FILES.to_vec();
    files.extend([
        ("validation/none/hud/a.test.ts", "// check"),
        ("validation/none/hud/b.test.ts", "// check"),
        ("validation/none/gyre/sway.test.ts", "// check"),
        ("validation/simple-2d/hud/b.test.ts", "// check"),
    ]);
    let version = resolve_scoped(&review, &files).expect("resolve");
    let base = version.variant("base").expect("base");

    let ids = |items: &[super::ReviewItem]| -> Vec<String> {
        items.iter().map(|item| item.id.clone()).collect()
    };
    // The case's own checklist is what the case declares, engine or no engine.
    assert_eq!(
        ids(&version.review_items_for(base)),
        ["overlay", "serve", "hud", "gyre"],
    );

    let engineless = version.review_items_for_engine(base, "none");
    assert_eq!(ids(&engineless), ["overlay", "serve", "hud", "gyre"]);
    assert_eq!(engineless[2].sub_items.len(), 2);

    let engine = version.review_items_for_engine(base, "simple-2d");
    assert_eq!(
        ids(&engine),
        ["serve", "hud"],
        "the scoped whole item goes, and so does the category left with no points",
    );
    let surviving: Vec<&str> = engine[1]
        .sub_items
        .iter()
        .map(|sub| sub.id.as_str())
        .collect();
    assert_eq!(surviving, ["b"], "the scoped point leaves its category");
}

// --- validator-rated versions: `failure_cap` + `domains` ----------------------

/// The validator project files a per-engine (validator-rated) fixture ships: one
/// starter workspace and one validator project per engine, with the `serve` suite
/// present in each.
const VALIDATOR_RATED_FILES: &[(&str, &str)] = &[
    ("workspaces/none/package.json", "{}"),
    ("workspaces/simple-2d/package.json", "{}"),
    ("validation/none/vitest.config.ts", "export default {}"),
    ("validation/none/gameplay/serve.test.ts", "// check"),
    ("validation/simple-2d/vitest.config.ts", "export default {}"),
    ("validation/simple-2d/gameplay/serve.test.ts", "// check"),
];

/// A `[review] format = 2` block with one `serve` item carrying `extra` keys beside
/// its validation — the point a validator-rated fixture rates.
fn serve_review(extra: &str) -> String {
    format!(
        "[review]\nformat = 2\n\
         [[review.categories]]\nid = \"gameplay\"\ntitle = \"Gameplay\"\n\
         [[review.categories.items]]\nid = \"serve\"\ntitle = \"Serve\"\n\
         {extra}\
         validation = {{ script = \"gameplay/serve.test.ts\", outputs = [\
         {{ id = \"serve\", kind = \"video\" }} ] }}\n"
    )
}

/// Resolve a per-engine (validator-rated) manifest whose review block is `review`.
fn resolve_validator_rated(review: &str) -> Result<TestCaseVersion> {
    let manifest = engines_manifest_with(
        "engines = [\"none\", \"simple-2d\"]\n",
        &format!("[instrumentation]\nhandle = \"__demo\"\n{review}"),
        &["none", "simple-2d"],
    );
    let (_dir, catalog) = catalog_with_files(&manifest, VALIDATOR_RATED_FILES);
    catalog.resolve("demo", "v1.0.0")
}

/// The rendered failure of resolving a validator-rated manifest with `review`.
fn reject_validator_rated(review: &str) -> String {
    let err = resolve_validator_rated(review).expect_err("the manifest should be refused");
    format!("{err}")
}

#[test]
fn a_per_engine_version_is_on_the_engine_format_and_validator_rated() {
    // The per-engine spelling is what makes a version validator-rated: its
    // functional rating is decided by the validators, so every graded point must say
    // which domains a failure lowers and how far.
    let version = resolve_validator_rated(&serve_review(
        "failure_cap = \"scuffed\"\ndomains = [\"gameplay\"]\n",
    ))
    .expect("resolve");
    assert!(version.engine_format);
    assert!(version.validator_rated());

    let base = version.variant("base").expect("base");
    let items = version.review_items_for(base);
    let point = &items[0].sub_items[0];
    assert_eq!(point.failure_cap, Some(FailureCap::Scuffed));
    assert_eq!(point.domains, vec!["gameplay".to_string()]);
    // A category (the grouping item) carries no cap of its own.
    assert_eq!(items[0].failure_cap, None);
    assert!(items[0].domains.is_empty());

    // The two keys reach the UI and the stored catalog in camelCase.
    let json = serde_json::to_value(point).expect("serialize");
    assert_eq!(json["failureCap"], "scuffed");
    assert_eq!(json["domains"], serde_json::json!(["gameplay"]));
}

#[test]
fn a_legacy_version_is_not_on_the_engine_format() {
    // A version on the single-`workspace` spelling behaves exactly as it always has:
    // reviewer-rated, with its resolved points carrying no cap and no domains — and
    // those keys stay off the wire so a stored legacy definition gains no field.
    let manifest = manifest_with(
        "",
        "[[review_item]]\nid = \"serve\"\ntitle = \"Serve\"\ntext = \"Serves.\"\nweight = 1\n",
    );
    let (_dir, catalog) = catalog_with_files(&manifest, &[]);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    assert!(!version.engine_format);
    assert!(!version.validator_rated());
    let item = &version.common_review_items[0];
    assert_eq!(item.failure_cap, None);
    assert!(item.domains.is_empty());
    let json = serde_json::to_value(item).expect("serialize");
    assert!(json.get("failureCap").is_none());
    assert!(json.get("domains").is_none());
    let json = serde_json::to_value(&version).expect("serialize");
    assert_eq!(json["engineFormat"], false);
}

#[test]
fn a_validator_rated_point_must_declare_a_failure_cap() {
    let msg = reject_validator_rated(&serve_review("domains = [\"gameplay\"]\n"));
    assert!(
        msg.contains("review category `gameplay` item `serve` declares no `failure_cap`"),
        "got: {msg}"
    );
}

#[test]
fn a_validator_rated_point_must_declare_its_domains() {
    let msg = reject_validator_rated(&serve_review("failure_cap = \"broken\"\n"));
    assert!(
        msg.contains("review category `gameplay` item `serve` declares no `domains`"),
        "got: {msg}"
    );
    // An explicitly empty list is the same omission.
    let msg = reject_validator_rated(&serve_review("failure_cap = \"broken\"\ndomains = []\n"));
    assert!(msg.contains("declares no `domains`"), "got: {msg}");
}

#[test]
fn a_validator_rated_point_must_carry_a_validator() {
    // Behaviour is fully validator-decided on such a version, so a point nobody
    // machine-checks has no way to be rated at all.
    let review = "[review]\nformat = 2\n\
                  [[review.categories]]\nid = \"gameplay\"\ntitle = \"Gameplay\"\n\
                  [[review.categories.items]]\nid = \"serve\"\ntitle = \"Serve\"\n\
                  failure_cap = \"broken\"\ndomains = [\"gameplay\"]\n";
    let msg = reject_validator_rated(review);
    assert!(
        msg.contains("review category `gameplay` item `serve` declares no `validation`"),
        "got: {msg}"
    );
}

#[test]
fn a_failure_cap_is_never_flawless() {
    // A failure always costs something, so `flawless` is not a cap the manifest
    // grammar admits.
    let msg = reject_validator_rated(&serve_review(
        "failure_cap = \"flawless\"\ndomains = [\"gameplay\"]\n",
    ));
    assert!(msg.contains("flawless"), "got: {msg}");
}

#[test]
fn a_validator_rated_point_s_domains_must_be_declared_and_distinct() {
    let msg = reject_validator_rated(&serve_review(
        "failure_cap = \"broken\"\ndomains = [\"versus\"]\n",
    ));
    assert!(
        msg.contains("names domain `versus` in `domains`, which is not declared"),
        "got: {msg}"
    );
    let msg = reject_validator_rated(&serve_review(
        "failure_cap = \"broken\"\ndomains = [\"gameplay\", \"gameplay\"]\n",
    ));
    assert!(
        msg.contains("names domain `gameplay` twice in `domains`"),
        "got: {msg}"
    );
}

#[test]
fn a_variant_point_may_name_the_variant_s_own_domain_but_a_common_point_may_not() {
    // A common item is rated on every variant, so it may only lower a common
    // domain; a variant's own item may also lower that variant's domain.
    let common = serve_review("failure_cap = \"broken\"\ndomains = [\"gameplay\", \"versus\"]\n");
    let manifest = engines_manifest_with(
        "engines = [\"none\", \"simple-2d\"]\n",
        &format!("[instrumentation]\nhandle = \"__demo\"\n{common}"),
        &["none", "simple-2d"],
    );
    let variant = "slug = \"base\"\n[[domain]]\nid = \"versus\"\ndescription = \"Two players.\"\n\
                   [[review.categories]]\nid = \"versus\"\ntitle = \"Versus\"\n\
                   [[review.categories.items]]\nid = \"controls\"\ntitle = \"Controls\"\n\
                   failure_cap = \"great\"\ndomains = [\"versus\"]\n\
                   validation = { script = \"gameplay/controls.test.ts\", outputs = [\
                   { id = \"controls\", kind = \"video\" } ] }\n";
    let mut files = VALIDATOR_RATED_FILES.to_vec();
    files.push(("validation/none/gameplay/controls.test.ts", "// check"));
    files.push(("validation/simple-2d/gameplay/controls.test.ts", "// check"));
    files.push(("variants/base.toml", variant));
    let (_dir, catalog) = catalog_with_files(&manifest, &files);
    let msg = format!(
        "{}",
        catalog
            .resolve("demo", "v1.0.0")
            .expect_err("a common point naming a variant domain is refused")
    );
    assert!(
        msg.contains("item `serve` names domain `versus` in `domains`, which is not declared"),
        "got: {msg}"
    );

    // With the common point on the common domain only, the variant's own point may
    // lower the variant's domain.
    let common = serve_review("failure_cap = \"broken\"\ndomains = [\"gameplay\"]\n");
    let manifest = engines_manifest_with(
        "engines = [\"none\", \"simple-2d\"]\n",
        &format!("[instrumentation]\nhandle = \"__demo\"\n{common}"),
        &["none", "simple-2d"],
    );
    let (_dir, catalog) = catalog_with_files(&manifest, &files);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    let base = version.variant("base").expect("base");
    let items = version.review_items_for(base);
    let controls = &items[1].sub_items[0];
    assert_eq!(controls.failure_cap, Some(FailureCap::Great));
    assert_eq!(controls.domains, vec!["versus".to_string()]);
}

#[test]
fn a_legacy_version_rejects_failure_cap_and_domains_by_name() {
    // The reviewer gives a legacy run's rating, so the two validator-rating keys
    // mean nothing there and are refused with a message that says why — in both
    // review grammars.
    let manifest = manifest_with(
        "",
        "[[review_item]]\nid = \"serve\"\ntitle = \"Serve\"\ntext = \"Serves.\"\nweight = 1\n\
         failure_cap = \"broken\"\n",
    );
    let (_dir, catalog) = catalog_with_files(&manifest, &[]);
    let msg = format!(
        "{}",
        catalog.resolve("demo", "v1.0.0").expect_err("refused")
    );
    assert!(
        msg.contains(
            "review_item `serve` declares `failure_cap`, but only a case on the engine format"
        ),
        "got: {msg}"
    );

    let manifest = manifest_with(
        "",
        "[review]\nformat = 2\n\
         [[review.categories]]\nid = \"gameplay\"\ntitle = \"Gameplay\"\n\
         [[review.categories.items]]\nid = \"serve\"\ntitle = \"Serve\"\ndomains = [\"gameplay\"]\n",
    );
    let (_dir, catalog) = catalog_with_files(&manifest, &[]);
    let msg = format!(
        "{}",
        catalog.resolve("demo", "v1.0.0").expect_err("refused")
    );
    assert!(
        msg.contains(
            "review category `gameplay` item `serve` declares `domains`, but only a case on the engine format"
        ),
        "got: {msg}"
    );
}

#[test]
fn a_sub_divided_legacy_item_rates_per_sub_item_on_a_validator_rated_version() {
    // The legacy `[[review_item]]` grammar is admitted on the engine format too; a
    // sub-divided item is rated per sub-item, exactly as it is validated per
    // sub-item, so item-level keys beside `sub_items` are refused.
    let review = "[[review_item]]\nid = \"serve\"\ntitle = \"Serve\"\ntext = \"Serves.\"\nweight = 1\n\
                  failure_cap = \"broken\"\ndomains = [\"gameplay\"]\n\
                  sub_item = [ { id = \"a\", title = \"A\", failure_cap = \"broken\", \
                  domains = [\"gameplay\"], validation = { script = \"gameplay/serve.test.ts\", \
                  outputs = [ { id = \"a\", kind = \"video\" } ] } } ]\n";
    let msg = reject_validator_rated(review);
    assert!(
        msg.contains("review_item `serve` declares `sub_items` alongside an item-level"),
        "got: {msg}"
    );

    let review = "[[review_item]]\nid = \"serve\"\ntitle = \"Serve\"\ntext = \"Serves.\"\nweight = 1\n\
                  sub_item = [ { id = \"a\", title = \"A\", failure_cap = \"passable\", \
                  domains = [\"gameplay\"], validation = { script = \"gameplay/serve.test.ts\", \
                  outputs = [ { id = \"a\", kind = \"video\" } ] } } ]\n";
    let version = resolve_validator_rated(review).expect("resolve");
    let sub = &version.common_review_items[0].sub_items[0];
    assert_eq!(sub.failure_cap, Some(FailureCap::Passable));
    assert_eq!(sub.domains, vec!["gameplay".to_string()]);
}
