//! Tests for the suite catalog and the lowering onto a runnable
//! [`TestCaseVersion`], driven by the committed fixture suite at
//! `crates/contracts/fixtures/test-suite/carom/versions/v1.0.0/`.
//!
//! The fixture offers one definition of every fully specified type plus one of a
//! type the format leaves TBD, so a pass over its `test-cases/` folder is a pass
//! over the whole type table.

use super::*;
use crate::engine::NONE_SLUG;
use crate::prompt::{SuiteSpecification, render_suite_prompt};
use crate::test_case::{AssetKind, TestType};
use crate::test_suite::SUITE_VARIANT_SLUG;
use crate::test_suite::{SuiteManifest, suite_dir_of};

/// The committed fixture checkout — the directory holding the `carom/` suite.
fn checkout() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../contracts/fixtures/test-suite")
}

/// A catalog over the fixture checkout, rendering its specifications into `dir`.
fn catalog(dir: &Path) -> TestSuiteCatalog {
    TestSuiteCatalog::with_materials(checkout(), dir)
}

/// Resolve one fixture definition, failing the test with the resolution error.
fn resolve(dir: &Path, definition: &str) -> TestCaseVersion {
    catalog(dir)
        .resolve("carom", "v1.0.0", definition)
        .unwrap_or_else(|err| panic!("{definition} should resolve: {err}"))
}

/// A scratch materials directory for one test.
fn materials() -> tempfile::TempDir {
    tempfile::tempdir().expect("a temporary directory")
}

#[test]
fn lists_the_suites_and_versions_in_a_checkout() {
    let dir = materials();
    let suites = catalog(dir.path()).list().expect("the checkout lists");
    assert_eq!(
        suites,
        vec![TestSuite {
            slug: "carom".to_string(),
            versions: vec!["v1.0.0".to_string()],
        }]
    );
    assert_eq!(
        catalog(dir.path()).versions("carom").expect("versions"),
        vec!["v1.0.0".to_string()]
    );
}

#[test]
fn reads_a_version_identity_without_a_full_resolve() {
    let dir = materials();
    let identity = catalog(dir.path())
        .identity("carom", "v1.0.0")
        .expect("the identity reads");
    // `suite.toml` holds the suite's identity alone, and `version.toml` the
    // version's.
    assert_eq!(
        identity.suite,
        SuiteManifest {
            slug: "carom".to_string(),
            name: "Carom".to_string(),
        }
    );
    assert_eq!(identity.manifest.version.as_deref(), Some("1.0.0"));
    assert_eq!(identity.manifest.tags, vec!["arcade", "2d"]);
}

#[test]
fn the_version_tree_is_the_exported_version_folder() {
    let dir = materials();
    assert_eq!(
        catalog(dir.path()).version_tree("carom", "v1.0.0"),
        checkout().join("carom/versions/v1.0.0")
    );
    assert_eq!(
        suite_dir_of(&checkout().join("carom/versions/v1.0.0")),
        Some(checkout().join("carom"))
    );
    assert_eq!(
        suite_dir_of(&checkout().join("carom/drafts/main")),
        Some(checkout().join("carom"))
    );
}

#[test]
fn drafts_are_never_listed_or_resolved() {
    let dir = materials();
    let catalog = catalog(dir.path());
    // The fixture suite holds a `drafts/main/` tree offering a `sketch` definition.
    assert!(
        checkout()
            .join("carom/drafts/main/test-cases/sketch.toml")
            .is_file()
    );
    assert_eq!(catalog.versions("carom").expect("versions"), vec!["v1.0.0"]);
    assert!(!catalog.has_version("carom", "main"));
    let definitions = catalog.definitions("carom", "v1.0.0").expect("definitions");
    assert!(
        !definitions.contains(&"sketch".to_string()),
        "{definitions:?}"
    );
    for name in ["main", "drafts/main"] {
        assert!(catalog.resolve("carom", name, "sketch").is_err(), "{name}");
    }
}

#[test]
fn a_folder_without_a_suite_manifest_is_not_a_suite() {
    let dir = tempfile::tempdir().expect("a scratch checkout");
    let root = dir.path().join("checkout");
    copy_fixture(&root);
    // A folder shaped like a suite in every other way.
    copy_tree(&root.join("carom"), &root.join("pinball"));
    std::fs::remove_file(root.join("pinball/suite.toml")).expect("the manifest is removed");
    // And a stray folder holding nothing a suite would.
    std::fs::create_dir_all(root.join("notes")).expect("the folder is created");

    let catalog = TestSuiteCatalog::with_materials(&root, dir.path().join("materials"));
    let listed: Vec<String> = catalog
        .list()
        .expect("the checkout lists")
        .into_iter()
        .map(|suite| suite.slug)
        .collect();
    assert_eq!(listed, vec!["carom"]);
    assert!(catalog.versions("pinball").is_err());
    assert!(!catalog.has_version("pinball", "v1.0.0"));
    assert!(catalog.resolve("pinball", "v1.0.0", "ball").is_err());
}

#[test]
fn a_suite_with_no_exported_version_lists_none() {
    let dir = tempfile::tempdir().expect("a scratch checkout");
    let root = dir.path().join("checkout");
    copy_fixture(&root);
    std::fs::remove_dir_all(root.join("carom/versions")).expect("the versions are removed");
    let suites = TestSuiteCatalog::with_materials(&root, dir.path().join("materials"))
        .list()
        .expect("the checkout lists");
    assert_eq!(
        suites,
        vec![TestSuite {
            slug: "carom".to_string(),
            versions: Vec::new(),
        }]
    );
}

#[test]
fn renaming_the_suite_renames_every_exported_version() {
    let dir = tempfile::tempdir().expect("a scratch checkout");
    let root = dir.path().join("checkout");
    copy_fixture(&root);
    copy_tree(
        &root.join("carom/versions/v1.0.0"),
        &root.join("carom/versions/v1.1.0"),
    );
    let manifest = root.join("carom/versions/v1.1.0/version.toml");
    let raw = std::fs::read_to_string(&manifest).expect("the manifest reads");
    std::fs::write(
        &manifest,
        raw.replace("version = \"1.0.0\"", "version = \"1.1.0\""),
    )
    .expect("the manifest writes");
    std::fs::write(
        root.join("carom/suite.toml"),
        "slug = \"carom\"\nname = \"Carom Deluxe\"\n",
    )
    .expect("the suite manifest writes");

    let catalog = TestSuiteCatalog::with_materials(&root, dir.path().join("materials"));
    assert_eq!(
        catalog.versions("carom").expect("versions"),
        vec!["v1.1.0", "v1.0.0"]
    );
    for version in ["v1.0.0", "v1.1.0"] {
        let loaded = catalog.load("carom", version).expect("the version loads");
        assert_eq!(loaded.suite.name, "Carom Deluxe", "{version}");
    }
}

#[test]
fn lists_the_definitions_a_version_offers() {
    let dir = materials();
    let definitions = catalog(dir.path())
        .definitions("carom", "v1.0.0")
        .expect("the definitions list");
    assert!(definitions.contains(&"end-to-end".to_string()));
    assert!(definitions.contains(&"player-ship-walk".to_string()));
    assert_eq!(definitions.len(), 10);
}

#[test]
fn an_absent_checkout_lists_nothing() {
    let dir = materials();
    let catalog = TestSuiteCatalog::new(dir.path().join("never-initialized"));
    assert!(catalog.list().expect("an absent checkout lists").is_empty());
}

#[test]
fn a_definition_resolves_under_its_suite_qualified_identity() {
    let dir = materials();
    let resolved = resolve(dir.path(), "end-to-end");
    assert_eq!(resolved.slug, "carom-end-to-end");
    assert_eq!(resolved.version, "v1.0.0");
    assert_eq!(catalog_identity("carom", "end-to-end"), "carom-end-to-end");
    // A definition declares no variants, so the run pipeline selects the one
    // implicit variant lowering synthesizes.
    assert_eq!(resolved.variants.len(), 1);
    assert_eq!(resolved.variants[0].slug, SUITE_VARIANT_SLUG);
    assert!(resolved.variant(SUITE_VARIANT_SLUG).is_ok());
}

#[test]
fn every_offered_definition_type_resolves_to_its_mapped_type_and_kind() {
    let dir = materials();
    let expected: Vec<(&str, TestType, AssetKind)> = vec![
        ("end-to-end", TestType::EndToEnd, AssetKind::Sprite),
        ("full-stack", TestType::FullStack, AssetKind::Sprite),
        ("player-ship", TestType::AssetGeneration, AssetKind::Sprite),
        (
            "player-ship-walk",
            TestType::AssetGeneration,
            AssetKind::SpriteSheet,
        ),
        ("ball", TestType::AssetGeneration, AssetKind::VoxelAnimation),
        ("table", TestType::AssetGeneration, AssetKind::BlenderProp),
        ("sparks", TestType::AssetGeneration, AssetKind::Particle2d),
        ("theme", TestType::AssetGeneration, AssetKind::Music),
        ("bounce", TestType::AssetGeneration, AssetKind::SfxSynth),
    ];
    for (definition, test_type, asset_kind) in expected {
        let resolved = resolve(dir.path(), definition);
        assert_eq!(resolved.test_type, test_type, "{definition} test type");
        if test_type == TestType::AssetGeneration {
            assert_eq!(resolved.asset_kind, asset_kind, "{definition} asset kind");
        }
        // Every definition resolves to the 2D image, which is what the defaults
        // table holds the dimension for.
        assert_eq!(
            resolved.asset_dimension,
            crate::test_case::AssetDimension::TwoD,
            "{definition} dimension"
        );
        assert!(
            resolved.engine_format,
            "{definition} is on the engine format"
        );
    }
}

#[test]
fn a_code_producing_definition_carries_its_engines_workspaces_build_and_toolchain() {
    let dir = materials();
    let resolved = resolve(dir.path(), "end-to-end");
    assert_eq!(resolved.engine_slugs(), vec!["none", "simple-2d"]);
    // The resolved keys are exactly the definition's engines, so a run of any
    // supported engine finds a starter project.
    for engine in ["none", "simple-2d"] {
        let files = resolved.common_workspace.get(engine);
        assert!(
            files
                .iter()
                .any(|file| file.dest == Path::new("package.json")),
            "{engine} seeds the starter package.json"
        );
    }
    let build = resolved.build.as_ref().expect("the build commands");
    assert_eq!(build.install, "npm ci");
    assert_eq!(build.build, "npm run build");
    let toolchain = resolved.toolchain.as_ref().expect("the toolchain commands");
    assert_eq!(toolchain.typecheck, "npm run typecheck");
    assert_eq!(toolchain.lint.as_deref(), Some("npm run lint"));
    // `max_runtime_hours` normalizes to seconds.
    assert_eq!(resolved.max_runtime_seconds, 5400);
}

#[test]
fn an_end_to_end_definition_seeds_the_suites_assets_so_the_model_writes_only_code() {
    let dir = materials();
    let resolved = resolve(dir.path(), "end-to-end");
    let dests: Vec<String> = resolved
        .common_workspace
        .get("none")
        .iter()
        .map(|file| file.dest.display().to_string())
        .collect();
    assert!(
        dests.contains(&"assets/ball/ball.vox".to_string()),
        "{dests:?}"
    );
    assert!(
        dests.contains(&"assets/player-ship/player-ship.png".to_string()),
        "{dests:?}"
    );
    // A full stack run produces its own assets, so none are seeded for it.
    let full_stack = resolve(dir.path(), "full-stack");
    assert!(
        full_stack
            .common_workspace
            .get("none")
            .iter()
            .all(|file| !file.dest.starts_with("assets")),
        "a full stack definition seeds no assets"
    );
}

#[test]
fn an_asset_producing_definition_selects_no_engine_and_seeds_no_workspace() {
    let dir = materials();
    let resolved = resolve(dir.path(), "ball");
    assert_eq!(resolved.engine_slugs(), vec![NONE_SLUG]);
    assert!(resolved.common_workspace.is_empty());
    assert!(resolved.build.is_none());
    assert!(resolved.toolchain.is_none());
}

#[test]
fn the_prose_and_visibility_come_from_the_suite_and_the_definition() {
    let dir = materials();
    let resolved = resolve(dir.path(), "ball");
    // Name and difficulty are the definition's.
    assert_eq!(resolved.name, "Carom, ball");
    assert_eq!(resolved.difficulty, "medium");
    // Tags, summary, description and changelog are the suite version's.
    assert_eq!(resolved.tags, vec!["arcade", "2d"]);
    assert!(
        resolved
            .summary
            .as_deref()
            .unwrap()
            .starts_with("A pool-table")
    );
    assert_eq!(
        resolved.description_path.as_deref(),
        Some(
            checkout()
                .join("carom/versions/v1.0.0/description.md")
                .as_path()
        )
    );
    assert_eq!(
        resolved.changelog_path,
        checkout().join("carom/versions/v1.0.0/changelog.md")
    );
    assert!(!resolved.experimental);
}

#[test]
fn a_definition_is_experimental_when_either_side_declares_it() {
    let dir = tempfile::tempdir().expect("a scratch checkout");
    let root = dir.path().join("checkout");
    copy_fixture(&root);

    // The definition alone: `efficiency` is experimental, but its type is refused,
    // so mark a resolvable one instead.
    let ball = root.join("carom/versions/v1.0.0/test-cases/ball.toml");
    let raw = std::fs::read_to_string(&ball).expect("the definition reads");
    // Prepended, not appended: a trailing key would land inside the `[voxel]`
    // table rather than at the definition's root.
    std::fs::write(&ball, format!("experimental = true\n{raw}")).expect("the definition writes");
    let materials = dir.path().join("materials");
    let catalog = TestSuiteCatalog::with_materials(&root, &materials);
    assert!(
        catalog
            .resolve("carom", "v1.0.0", "ball")
            .expect("the definition resolves")
            .experimental
    );

    // The suite manifest alone: every case it offers is hidden with it.
    std::fs::write(&ball, raw).expect("the definition restores");
    let manifest_path = root.join("carom/versions/v1.0.0/version.toml");
    let manifest = std::fs::read_to_string(&manifest_path).expect("the manifest reads");
    std::fs::write(&manifest_path, format!("{manifest}experimental = true\n"))
        .expect("the manifest writes");
    assert!(
        catalog
            .resolve("carom", "v1.0.0", "end-to-end")
            .expect("the definition resolves")
            .experimental
    );
}

#[test]
fn a_seeded_specification_renders_its_prose_then_its_requirements_at_its_declared_path() {
    let dir = materials();
    let resolved = resolve(dir.path(), "end-to-end");
    let dests: Vec<String> = resolved
        .common_specs
        .iter()
        .map(|spec| spec.dest.display().to_string())
        .collect();
    // The definition lists two specifications, in order, and the nested one is
    // seeded at the path it declares rather than at its folder path.
    assert_eq!(
        dests,
        vec![
            "specs/ball-physics.md".to_string(),
            "specs/ball-physics/spin.md".to_string()
        ]
    );

    let rendered =
        std::fs::read_to_string(&resolved.common_specs[0].source_path).expect("the document reads");
    let prose = std::fs::read_to_string(
        checkout().join("carom/versions/v1.0.0/specifications/ball-physics/specification.md"),
    )
    .expect("the prose reads");
    assert!(rendered.starts_with(prose.trim_end()), "{rendered}");
    // A requirement renders as its RFC 2119 text under its suite-wide identity.
    assert!(
        rendered.contains("### ball-physics/constant-speed"),
        "{rendered}"
    );
    assert!(
        rendered.contains("The ball MUST travel at a constant speed between collisions."),
        "{rendered}"
    );
    assert!(
        rendered.contains("### ball-physics/table-felt"),
        "{rendered}"
    );
}

#[test]
fn omitting_the_specifications_key_covers_every_specification_the_suite_declares() {
    let dir = materials();
    let resolved = resolve(dir.path(), "full-stack");
    let dests: Vec<String> = resolved
        .common_specs
        .iter()
        .map(|spec| spec.dest.display().to_string())
        .collect();
    assert_eq!(
        dests,
        vec![
            "specs/assets.md".to_string(),
            "specs/ball-physics.md".to_string(),
            "specs/ball-physics/spin.md".to_string(),
        ]
    );
}

#[test]
fn a_specification_the_suite_does_not_declare_is_refused() {
    let dir = tempfile::tempdir().expect("a scratch checkout");
    let root = dir.path().join("checkout");
    copy_fixture(&root);
    let path = root.join("carom/versions/v1.0.0/test-cases/ball.toml");
    let raw = std::fs::read_to_string(&path).expect("the definition reads");
    std::fs::write(
        &path,
        raw.replace(
            "specifications = [\"assets\"]",
            "specifications = [\"nope\"]",
        ),
    )
    .expect("the definition writes");
    let err = TestSuiteCatalog::with_materials(&root, dir.path().join("materials"))
        .resolve("carom", "v1.0.0", "ball")
        .expect_err("an undeclared specification is refused");
    assert!(err.to_string().contains("`nope`"), "{err}");
}

#[test]
fn a_code_producing_definition_declaring_no_engine_is_refused_by_name() {
    let dir = tempfile::tempdir().expect("a scratch checkout");
    let root = dir.path().join("checkout");
    copy_fixture(&root);
    let path = root.join("carom/versions/v1.0.0/test-cases/end-to-end.toml");
    let raw = std::fs::read_to_string(&path).expect("the definition reads");
    std::fs::write(
        &path,
        raw.replace("engines = [\"none\", \"simple-2d\"]", "engines = []"),
    )
    .expect("the definition writes");
    let err = TestSuiteCatalog::with_materials(&root, dir.path().join("materials"))
        .resolve("carom", "v1.0.0", "end-to-end")
        .expect_err("a code-producing definition without engines is refused");
    assert!(err.to_string().contains("`end-to-end`"), "{err}");
    assert!(err.to_string().contains("engines"), "{err}");
}

#[test]
fn the_prompt_renders_against_exactly_the_documented_context() {
    let dir = materials();
    let resolved = resolve(dir.path(), "end-to-end");
    let template = std::fs::read_to_string(&resolved.prompt_path).expect("the template reads");
    let specifications = vec![SuiteSpecification {
        id: "ball-physics".to_string(),
        name: "Ball Physics".to_string(),
        summary: "How the ball moves.".to_string(),
        dest: "specs/ball-physics.md".to_string(),
    }];
    let rendered = render_suite_prompt("carom", "v1.0.0", &template, &specifications, None)
        .expect("the prompt renders");
    assert!(rendered.contains("/work"), "{rendered}");
    assert!(rendered.contains("None"), "{rendered}");

    // Every documented variable resolves.
    let full = "{{workspace}} {{engine.slug}} {{engine.name}} {{engine.docs}} \
                {{#each specifications}}{{this.id}} {{this.name}} {{this.summary}} {{this.path}}\
                {{/each}}";
    let rendered = render_suite_prompt("carom", "v1.0.0", full, &specifications, None)
        .expect("the documented context renders");
    assert!(
        rendered.contains("/work/specs/ball-physics.md"),
        "{rendered}"
    );
    assert!(rendered.contains("ball-physics Ball Physics"), "{rendered}");

    // A reference to anything outside it is a render error, not a blank.
    let err = render_suite_prompt("carom", "v1.0.0", "{{variant.slug}}", &specifications, None)
        .expect_err("an undocumented variable fails");
    assert!(err.to_string().contains("carom"), "{err}");
}

#[test]
fn an_asset_producing_definition_gets_the_tables_its_kind_requires() {
    let dir = materials();

    let sprite = resolve(dir.path(), "player-ship");
    assert!(sprite.canvas.is_some());
    assert_eq!(sprite.tool.as_ref().expect("a tool").binary, "draw");
    assert!(sprite.output.is_some());
    assert!(sprite.sheet.is_none());

    let sheet = resolve(dir.path(), "player-ship-walk");
    let sheet_spec = sheet.sheet.as_ref().expect("a sheet");
    assert!(!sheet_spec.frames.is_empty());
    assert!(!sheet_spec.sequences.is_empty());
    assert_eq!(sheet.tool.as_ref().expect("a tool").binary, "draw-sheet");

    let voxel = resolve(dir.path(), "ball");
    assert!(voxel.voxel.is_some());
    let model = voxel
        .model
        .as_ref()
        .expect("an animated voxel declares a rig");
    assert!(
        !model.animations.is_empty(),
        "a rig contract is the animations the model must author, so it names at least one"
    );
    assert_eq!(voxel.tool.as_ref().expect("a tool").binary, "voxel-anim");

    let blender = resolve(dir.path(), "table");
    assert!(blender.voxel.is_some());
    assert!(blender.model.is_none(), "a prop is static");

    let particle = resolve(dir.path(), "sparks");
    assert!(particle.particle.is_some());

    let music = resolve(dir.path(), "theme");
    assert_eq!(music.audio.as_ref().expect("audio").channels, "stereo");
    assert_eq!(
        music.audio_packs.len(),
        1,
        "a score is sequenced over exactly one instrument bank"
    );

    let sfx = resolve(dir.path(), "bounce");
    assert_eq!(sfx.audio.as_ref().expect("audio").channels, "mono");
    assert!(
        sfx.audio_packs.is_empty(),
        "a synthesized effect reaches no pack"
    );
}

#[test]
fn every_resolved_version_carries_a_scoring_domain() {
    let dir = materials();
    for definition in ["end-to-end", "ball", "theme"] {
        let resolved = resolve(dir.path(), definition);
        assert!(
            !resolved.domains.is_empty(),
            "{definition} declares a domain"
        );
    }
}

#[test]
fn a_type_whose_keys_are_to_be_determined_is_refused_by_name() {
    let dir = materials();
    let err = catalog(dir.path())
        .resolve("carom", "v1.0.0", "efficiency")
        .expect_err("a performance definition is refused");
    let message = err.to_string();
    assert!(message.contains("performance"), "{message}");
    assert!(message.contains("test-cases/efficiency.toml"), "{message}");
}

#[test]
fn a_version_folder_disagreeing_with_the_declared_version_is_refused() {
    let dir = tempfile::tempdir().expect("a scratch checkout");
    let root = dir.path().join("checkout");
    copy_fixture(&root);
    std::fs::rename(
        root.join("carom/versions/v1.0.0"),
        root.join("carom/versions/v2.0.0"),
    )
    .expect("the version folder renames");
    let err = TestSuiteCatalog::with_materials(&root, dir.path().join("materials"))
        .resolve("carom", "v2.0.0", "ball")
        .expect_err("a disagreeing version folder is refused");
    assert!(err.to_string().contains("v2.0.0"), "{err}");
    assert!(err.to_string().contains("version.toml"), "{err}");
}

#[test]
fn an_exported_version_declaring_no_version_is_refused() {
    let dir = tempfile::tempdir().expect("a scratch checkout");
    let root = dir.path().join("checkout");
    copy_fixture(&root);
    let manifest = root.join("carom/versions/v1.0.0/version.toml");
    let raw = std::fs::read_to_string(&manifest).expect("the manifest reads");
    std::fs::write(&manifest, raw.replace("version = \"1.0.0\"\n", ""))
        .expect("the manifest writes");
    let err = TestSuiteCatalog::with_materials(&root, dir.path().join("materials"))
        .identity("carom", "v1.0.0")
        .expect_err("a version-less exported version is refused");
    assert!(err.to_string().contains("version.toml"), "{err}");
}

#[test]
fn a_suite_directory_disagreeing_with_the_declared_slug_is_refused() {
    let dir = tempfile::tempdir().expect("a scratch checkout");
    let root = dir.path().join("checkout");
    copy_fixture(&root);
    std::fs::rename(root.join("carom"), root.join("billiards")).expect("the suite renames");
    let err = TestSuiteCatalog::with_materials(&root, dir.path().join("materials"))
        .resolve("billiards", "v1.0.0", "ball")
        .expect_err("a disagreeing suite directory is refused");
    assert!(err.to_string().contains("billiards"), "{err}");
    assert!(err.to_string().contains("suite.toml"), "{err}");
}

#[test]
fn a_definition_the_suite_does_not_offer_is_refused() {
    let dir = materials();
    let err = catalog(dir.path())
        .resolve("carom", "v1.0.0", "nope")
        .expect_err("an unknown definition is refused");
    assert!(err.to_string().contains("test-cases/nope.toml"), "{err}");
}

/// Copy the fixture checkout into a scratch tree so a test can alter it.
fn copy_fixture(into: &Path) {
    copy_tree(&checkout(), into);
}

/// Copy one directory tree, recursively.
fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("the destination directory");
    for entry in std::fs::read_dir(from).expect("the source directory") {
        let entry = entry.expect("a directory entry");
        let path = entry.path();
        let target = to.join(entry.file_name());
        if path.is_dir() {
            copy_tree(&path, &target);
        } else {
            std::fs::copy(&path, &target).expect("the file copies");
        }
    }
}

#[test]
fn a_definitions_init_reaches_the_resolved_case() {
    let dir = materials();
    for definition in ["end-to-end", "full-stack"] {
        let resolved = resolve(dir.path(), definition);
        assert_eq!(
            resolved.init.as_deref(),
            Some("npm ci && npx playwright install chromium"),
            "{definition} carries its init"
        );
    }
}

#[test]
fn a_definition_declaring_no_init_resolves_with_none() {
    let dir = materials();
    for definition in ["ball", "player-ship", "sparks", "theme", "bounce", "table"] {
        assert!(
            resolve(dir.path(), definition).init.is_none(),
            "{definition} declares no init"
        );
    }
}

#[test]
fn a_blank_init_is_refused() {
    let dir = tempfile::tempdir().expect("a scratch checkout");
    let root = dir.path().join("checkout");
    copy_fixture(&root);
    let path = root.join("carom/versions/v1.0.0/test-cases/end-to-end.toml");
    let raw = std::fs::read_to_string(&path).expect("the definition reads");
    std::fs::write(
        &path,
        raw.replace(
            "init = \"npm ci && npx playwright install chromium\"",
            "init = \" \"",
        ),
    )
    .expect("the definition writes");
    let err = TestSuiteCatalog::with_materials(&root, dir.path().join("materials"))
        .resolve("carom", "v1.0.0", "end-to-end")
        .expect_err("a blank init is refused");
    assert!(err.to_string().contains("init"), "{err}");
}
