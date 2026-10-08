//! Tests for the version-folder read and save, driven by the committed fixture
//! suite at `src/testdata/test-suite/carom/versions/v1.0.0/`.
//!
//! The fixture exercises every entity the format defines: a nested specification
//! folder, a definition of each fully specified test case type plus one of a type
//! the format leaves TBD, both array layouts, and placeholder files in each tree
//! that holds no TOML.

use super::*;
use crate::test_suite::model::{
    DebugApiFunctionKind, SuiteAssetKind, SuiteDifficulty, SuiteManifest, SuiteRequirementKind,
    SuiteTestCaseType,
};

/// The committed fixture suite version folder.
fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/testdata/test-suite/carom/versions/v1.0.0")
}

/// The fixture suite's own manifest, from the suite folder the version sits in.
fn suite() -> SuiteManifest {
    load_suite_manifest(&fixture().join("../..")).expect("the suite manifest loads")
}

/// Load the fixture, failing the test with the offending file's name.
fn load_fixture() -> SuiteVersion {
    SuiteVersion::load(&suite(), &fixture()).expect("the fixture suite loads")
}

/// Copy a directory tree, so a save test never writes into the committed
/// fixture.
fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("the destination is created");
    for entry in std::fs::read_dir(from).expect("the source is readable") {
        let entry = entry.expect("the entry is readable");
        let target = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), &target).expect("the file is copied");
        }
    }
}

/// Every file in a tree, as `(relative path, bytes)` pairs in sorted order.
fn snapshot(root: &Path) -> Vec<(String, Vec<u8>)> {
    let mut files: Vec<(String, Vec<u8>)> = list_files(root, ".")
        .into_iter()
        .map(|relative| {
            let relative = relative.trim_start_matches("./").to_owned();
            let bytes = std::fs::read(root.join(&relative)).expect("the file is readable");
            (relative, bytes)
        })
        .collect();
    files.sort();
    files
}

#[test]
fn the_manifest_carries_the_suites_identity_and_prose() {
    let version = load_fixture();
    assert_eq!(version.suite.slug, "carom");
    assert_eq!(version.suite.name, "Carom");
    assert_eq!(version.manifest.version.as_deref(), Some("1.0.0"));
    assert_eq!(version.manifest.tags, vec!["arcade", "2d"]);
    assert_eq!(version.manifest.description, "description.md");
    assert_eq!(version.manifest.changelog, "changelog.md");
    assert!(!version.manifest.experimental);
}

#[test]
fn a_specification_folder_nests_freely_and_references_its_prose() {
    let version = load_fixture();
    let ids: Vec<&str> = version
        .specifications
        .iter()
        .map(|folder| folder.manifest.id.as_str())
        .collect();
    assert_eq!(ids, vec!["assets", "ball-physics"]);

    let physics = &version.specifications[1];
    assert_eq!(physics.dir, "specifications/ball-physics");
    assert_eq!(
        physics.prose,
        "specifications/ball-physics/specification.md"
    );
    assert_eq!(physics.manifest.path, "ball-physics.md");

    let nested = &physics.children;
    assert_eq!(nested.len(), 1, "the nested specification folder is found");
    assert_eq!(nested[0].manifest.id, "ball-spin");
    assert_eq!(nested[0].dir, "specifications/ball-physics/spin");
    assert_eq!(
        nested[0].prose,
        "specifications/ball-physics/spin/specification.md"
    );
}

#[test]
fn requirements_keep_their_order_kind_and_validators() {
    let version = load_fixture();
    let physics = &version.specifications[1].manifest;
    let ids: Vec<&str> = physics
        .requirements
        .iter()
        .map(|requirement| requirement.id.as_str())
        .collect();
    assert_eq!(
        ids,
        vec!["constant-speed", "cushion-reflection", "table-felt"]
    );
    assert_eq!(
        physics.requirements[0].kind,
        SuiteRequirementKind::Functional
    );
    assert_eq!(physics.requirements[0].validators.len(), 3);
    assert_eq!(
        physics.requirements[2].kind,
        SuiteRequirementKind::NonFunctional
    );
    assert!(physics.requirements[2].validators.is_empty());
}

#[test]
fn the_debug_api_carries_the_handle_at_the_root_alone() {
    let version = load_fixture();
    let debug_api = version.debug_api.expect("the fixture declares a debug API");
    assert_eq!(debug_api.root.handle.as_deref(), Some("__carom"));
    assert_eq!(debug_api.root.modules[0].path, "debug-api/ball.toml");

    let ball = &debug_api.modules["debug-api/ball.toml"];
    assert_eq!(ball.handle, None);
    assert_eq!(ball.functions[0].kind, DebugApiFunctionKind::Query);
    assert_eq!(ball.functions[0].parameters[0].name, "index");
    assert_eq!(ball.functions[1].kind, DebugApiFunctionKind::Command);
    assert_eq!(ball.modules[0].path, "debug-api/ball/spin.toml");

    let spin = &debug_api.modules["debug-api/ball/spin.toml"];
    assert_eq!(spin.handle, None);
    assert_eq!(spin.functions.len(), 2);
}

#[test]
fn every_fully_specified_test_case_type_parses_with_its_type_table() {
    let version = load_fixture();
    let by_slug: std::collections::BTreeMap<&str, &SuiteTestCaseDefinition> = version
        .test_cases
        .iter()
        .map(|case| (case.slug.as_str(), &case.definition))
        .collect();

    let end_to_end = by_slug["end-to-end"];
    assert_eq!(end_to_end.test_type, SuiteTestCaseType::EndToEnd);
    assert_eq!(end_to_end.difficulty, SuiteDifficulty::Easy);
    assert_eq!(end_to_end.engines, vec!["none", "simple-2d"]);
    assert_eq!(
        end_to_end.specifications.as_deref(),
        Some(["ball-physics".to_owned(), "ball-spin".to_owned()].as_slice())
    );
    let workspaces = end_to_end.workspaces.as_ref().expect("a workspace map");
    assert_eq!(workspaces["simple-2d"], "workspaces/simple-2d-e2e");
    assert_eq!(
        end_to_end.build.as_ref().expect("a build table").install,
        "npm ci"
    );
    let toolchain = end_to_end.toolchain.as_ref().expect("a toolchain table");
    assert_eq!(toolchain.typecheck, "npm run typecheck");
    assert_eq!(toolchain.test.as_deref(), Some("npm run test"));

    let full_stack = by_slug["full-stack"];
    assert_eq!(full_stack.test_type, SuiteTestCaseType::FullStack);
    assert_eq!(full_stack.specifications, None, "an omitted key covers all");
    assert_eq!(
        full_stack.toolchain.as_ref().expect("a toolchain").lint,
        None
    );

    assert_eq!(by_slug["player-ship"].test_type, SuiteTestCaseType::Sprite);
    let sprite = by_slug["player-ship"].sprite.as_ref().expect("a sprite");
    assert_eq!(sprite.id, "player-ship");
    assert!(!sprite.sheet);
    let sheet = by_slug["player-ship-walk"]
        .sprite
        .as_ref()
        .expect("a sprite");
    assert!(sheet.sheet);

    let voxel = by_slug["ball"].voxel.as_ref().expect("a voxel table");
    assert_eq!(by_slug["ball"].test_type, SuiteTestCaseType::Voxel);
    assert!(voxel.animated);
    assert_eq!(
        by_slug["table"].blender.as_ref().expect("a blender").id,
        "table"
    );
    assert_eq!(
        by_slug["sparks"].particle.as_ref().expect("a particle").id,
        "sparks"
    );
    assert_eq!(by_slug["theme"].music.as_ref().expect("music").id, "theme");
    assert_eq!(
        by_slug["bounce"].audio_fx.as_ref().expect("audio-fx").id,
        "bounce"
    );
}

#[test]
fn a_tbd_type_loads_and_saves_with_its_common_keys_and_no_type_table() {
    let version = load_fixture();
    let tbd = &version
        .test_cases
        .iter()
        .find(|case| case.slug == "efficiency")
        .expect("the fixture declares a TBD-type definition")
        .definition;
    assert_eq!(tbd.test_type, SuiteTestCaseType::Performance);
    assert_eq!(tbd.difficulty, SuiteDifficulty::Hard);
    assert_eq!(tbd.max_runtime_hours, 2.0);
    assert!(tbd.experimental);
    assert!(tbd.sprite.is_none());
    assert!(tbd.voxel.is_none());
    assert!(tbd.blender.is_none());
    assert!(tbd.particle.is_none());
    assert!(tbd.music.is_none());
    assert!(tbd.audio_fx.is_none());
    assert!(tbd.workspaces.is_none());
    assert!(tbd.build.is_none());
    assert!(tbd.toolchain.is_none());

    let emitted = to_canonical_toml(tbd).expect("the definition serializes");
    assert!(
        !emitted.lines().any(|line| line.starts_with('[')),
        "no type table is emitted:\n{emitted}"
    );
    assert!(emitted.contains("type = \"performance\""));
}

#[test]
fn assets_and_demonstrations_parse_from_their_own_folders() {
    let version = load_fixture();
    let kinds: Vec<SuiteAssetKind> = version
        .assets
        .iter()
        .map(|asset| asset.manifest.kind)
        .collect();
    assert_eq!(
        kinds,
        vec![
            SuiteAssetKind::Voxel,
            SuiteAssetKind::AudioFx,
            SuiteAssetKind::Sprite,
            SuiteAssetKind::SpriteSheet,
            SuiteAssetKind::Particle,
            SuiteAssetKind::Blender,
            SuiteAssetKind::Music,
        ]
    );
    let ship = version
        .assets
        .iter()
        .find(|asset| asset.manifest.id == "player-ship")
        .expect("the sprite asset");
    assert_eq!(ship.dir, "assets/player-ship");
    assert_eq!(ship.manifest.specification, "assets");
    assert_eq!(ship.manifest.files, vec!["player-ship.png"]);

    assert_eq!(version.demos.len(), 1);
    assert_eq!(version.demos[0].dir, "demos/ball-bounce");
    assert_eq!(version.demos[0].manifest.specification, "ball-physics");
}

#[test]
fn the_showcase_carousel_keeps_its_order_and_names_its_prose() {
    let version = load_fixture();
    let showcase = version.showcase.expect("the fixture holds a showcase");
    assert_eq!(showcase.description, "showcase/showcase.md");
    let files: Vec<&str> = showcase
        .manifest
        .media
        .iter()
        .map(|entry| entry.file.as_str())
        .collect();
    assert_eq!(files, vec!["title.png", "volley.png"]);
    assert_eq!(showcase.manifest.media[0].name, "Title screen");
    assert_eq!(
        showcase.media,
        vec!["showcase/title.png", "showcase/volley.png"]
    );
}

#[test]
fn the_read_reports_every_tree_that_holds_no_toml() {
    let version = load_fixture();
    let trees = version.trees;
    assert!(
        trees
            .validators
            .contains(&"validators/vitest.config.ts".to_owned())
    );
    assert!(
        trees
            .validators
            .contains(&"validators/ball/constant-speed.ts".to_owned())
    );
    assert!(
        trees
            .validators
            .contains(&"validators/ball/constant-speed.test.ts".to_owned())
    );
    assert_eq!(
        trees
            .reference_implementations
            .keys()
            .collect::<Vec<&String>>(),
        vec!["none", "simple-2d"]
    );
    assert_eq!(
        trees.reference_implementations["simple-2d"],
        vec!["reference-implementations/simple-2d/index.html"]
    );
    assert_eq!(
        trees.workspaces.keys().collect::<Vec<&String>>(),
        vec!["none", "simple-2d-e2e"]
    );
    assert_eq!(
        trees.workspaces["none"],
        vec!["workspaces/none/package.json"]
    );
    assert!(trees.prompts.contains(&"prompts/end-to-end.hbs".to_owned()));
    assert_eq!(trees.shared_demos, vec!["demos/shared/physics.ts"]);
}

#[test]
fn the_committed_fixture_round_trips_byte_for_byte() {
    let temporary = tempfile::tempdir().expect("a temporary directory");
    let root = temporary.path().join("v1.0.0");
    copy_tree(&fixture(), &root);
    let before = snapshot(&root);

    let version = SuiteVersion::load(&suite(), &root).expect("the copied fixture loads");
    version.save(&root).expect("the version saves");

    let after = snapshot(&root);
    for ((path, before), (_, after)) in before.iter().zip(after.iter()) {
        assert_eq!(
            String::from_utf8_lossy(before),
            String::from_utf8_lossy(after),
            "{path} was rewritten"
        );
    }
    assert_eq!(before.len(), after.len(), "no file was added or removed");
}

#[test]
fn a_save_reloads_into_an_equal_model() {
    let temporary = tempfile::tempdir().expect("a temporary directory");
    let root = temporary.path().join("v1.0.0");
    copy_tree(&fixture(), &root);
    let version = SuiteVersion::load(&suite(), &root).expect("the copied fixture loads");
    version.save(&root).expect("the version saves");
    let reloaded = SuiteVersion::load(&suite(), &root).expect("the saved version loads");
    assert_eq!(version, reloaded);
}

#[test]
fn a_file_that_does_not_parse_names_itself() {
    let temporary = tempfile::tempdir().expect("a temporary directory");
    let root = temporary.path().join("v1.0.0");
    copy_tree(&fixture(), &root);
    std::fs::write(root.join("test-cases/ball.toml"), "type = ").expect("the file is written");
    let error = SuiteVersion::load(&suite(), &root).expect_err("the read fails");
    assert!(
        error.to_string().starts_with("test-cases/ball.toml:"),
        "the error names the file: {error}"
    );
}

#[test]
fn a_version_folder_without_the_optional_entities_still_loads() {
    let temporary = tempfile::tempdir().expect("a temporary directory");
    let root = temporary.path().join("v1.0.0");
    std::fs::create_dir_all(&root).expect("the directory is created");
    std::fs::copy(fixture().join("version.toml"), root.join("version.toml"))
        .expect("the manifest is copied");
    let version = SuiteVersion::load(&suite(), &root).expect("a manifest-only version loads");
    assert!(version.specifications.is_empty());
    assert!(version.debug_api.is_none());
    assert!(version.test_cases.is_empty());
    assert!(version.assets.is_empty());
    assert!(version.demos.is_empty());
    assert!(version.showcase.is_none());
    assert_eq!(version.trees, SuiteTrees::default());
}

#[test]
fn a_save_writes_the_version_manifest_and_leaves_the_suite_manifest_alone() {
    let temporary = tempfile::tempdir().expect("a temporary directory");
    let root = temporary.path().join("v1.0.0");
    copy_tree(&fixture(), &root);
    let mut version = SuiteVersion::load(&suite(), &root).expect("the copied fixture loads");
    version.suite.name = "Renamed".to_owned();
    version.manifest.summary = "A different abstract.".to_owned();
    version.save(&root).expect("the version saves");

    let files: Vec<String> = version
        .canonical_files()
        .expect("the files emit")
        .into_iter()
        .map(|(path, _)| path)
        .collect();
    assert!(
        files.contains(&VERSION_MANIFEST_FILE.to_owned()),
        "{files:?}"
    );
    assert!(
        !files.contains(&SUITE_MANIFEST_FILE.to_owned()),
        "{files:?}"
    );
    assert!(!root.join(SUITE_MANIFEST_FILE).exists());
    let written = load_version_manifest(&root).expect("the version manifest reads");
    assert_eq!(written.summary, "A different abstract.");
}
