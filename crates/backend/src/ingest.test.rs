use super::*;
use tempfile::TempDir;

/// Write a file, creating parent directories.
fn write(path: &std::path::Path, contents: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, contents).unwrap();
}

#[test]
fn scan_ignores_containers_in_the_checkout() {
    // A checkout with a `containers/` tree but no `test-cases/`. Ingest no longer
    // touches containers (images are distributed via a registry), so the scan is
    // a clean no-op rather than copying or hashing any build context.
    let dir = TempDir::new().unwrap();
    write(
        &dir.path().join("containers/claude/Dockerfile"),
        "FROM test-cabinet/base:latest\n",
    );
    // An empty (but present) test-cases tree so the default full scan finds no
    // versions rather than erroring on a missing directory.
    std::fs::create_dir_all(dir.path().join("test-cases")).unwrap();
    let store_dir = TempDir::new().unwrap();
    let store = DefinitionStore::open(store_dir.path()).unwrap();

    let report = Ingestor::new(dir.path(), &store)
        .scan(&IngestRequest::default())
        .unwrap();

    assert!(report.test_case_versions.is_empty());
}

#[test]
fn scan_with_empty_test_case_restriction_is_a_no_op() {
    let dir = TempDir::new().unwrap();
    let store_dir = TempDir::new().unwrap();
    let store = DefinitionStore::open(store_dir.path()).unwrap();

    let report = Ingestor::new(dir.path(), &store)
        .scan(&IngestRequest {
            test_cases: Some(vec![]),
            force: false,
            ..Default::default()
        })
        .unwrap();
    assert!(report.test_case_versions.is_empty());
}

#[test]
fn catalog_version_skips_a_re_render_when_unchanged_and_forces_when_changed() {
    // A whole-catalog ingest tagged with a version stamps a store marker; a later
    // ingest at the same version reuses the ingested versions (no re-render), while a
    // different version forces a full re-ingest. Exercised with an empty test-cases
    // tree (no browser needed): the marker bookkeeping is independent of how many
    // versions a scan touches.
    let dir = TempDir::new().unwrap();
    std::fs::create_dir_all(dir.path().join("test-cases")).unwrap();
    let store_dir = TempDir::new().unwrap();
    let store = DefinitionStore::open(store_dir.path()).unwrap();
    let ingestor = Ingestor::new(dir.path(), &store);

    // First tagged scan records the marker.
    assert!(store.catalog_version().is_none());
    ingestor
        .scan(&IngestRequest {
            catalog_version: Some("commit-a".to_string()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(store.catalog_version().as_deref(), Some("commit-a"));

    // A changed token advances the marker to the new version.
    ingestor
        .scan(&IngestRequest {
            catalog_version: Some("commit-b".to_string()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(store.catalog_version().as_deref(), Some("commit-b"));

    // A partial scan (test_cases set) leaves the whole-catalog marker untouched.
    ingestor
        .scan(&IngestRequest {
            test_cases: Some(vec![]),
            catalog_version: Some("commit-c".to_string()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(store.catalog_version().as_deref(), Some("commit-b"));
}

#[test]
fn scan_with_progress_emits_a_start_event_with_the_target_count() {
    // The streamed progress feed leans on `Start` always firing before the loop,
    // carrying the total to be scanned. An empty test-cases tree exercises that
    // wiring without the browser a real render would need: exactly one `Start`
    // (total 0) and no `Version` events.
    let dir = TempDir::new().unwrap();
    std::fs::create_dir_all(dir.path().join("test-cases")).unwrap();
    let store_dir = TempDir::new().unwrap();
    let store = DefinitionStore::open(store_dir.path()).unwrap();

    let mut events = Vec::new();
    let report = Ingestor::new(dir.path(), &store)
        .scan_with_progress(&IngestRequest::default(), |event| match event {
            IngestEvent::Start { total } => events.push(total),
            IngestEvent::Version { .. } => panic!("no versions to ingest"),
        })
        .unwrap();

    assert_eq!(events, vec![0]);
    assert!(report.test_case_versions.is_empty());
}

#[test]
fn copy_tree_preserves_the_allowlisted_dotfiles_but_skips_others() {
    // Hidden entries are dropped so the checkout's dotfiles and the store's
    // `.tcab` sidecar never enter a copied definition — except the allowlist a
    // case ships (`.gitignore`, `.cargo`), which must survive so a backend-driven
    // run seeds the same set a local run does. Lockstep with `core`'s
    // `collect_workspace_files` is guaranteed by the shared `is_seeded_dotfile`.
    let src = TempDir::new().unwrap();
    write(&src.path().join("Cargo.toml"), "[package]");
    write(&src.path().join(".gitignore"), "/target/\n");
    write(&src.path().join(".cargo/config.toml"), "[build]\n");
    write(&src.path().join(".env"), "SECRET=1");
    write(&src.path().join(".tcab"), "sidecar");
    let dst = TempDir::new().unwrap();

    copy_tree(src.path(), &dst.path().join("out")).unwrap();

    let out = dst.path().join("out");
    assert!(out.join("Cargo.toml").exists());
    assert!(
        out.join(".gitignore").exists(),
        ".gitignore must survive ingest"
    );
    assert!(
        out.join(".cargo/config.toml").exists(),
        ".cargo/ must survive ingest"
    );
    assert!(
        !out.join(".env").exists(),
        "other dotfiles are still skipped"
    );
    assert!(
        !out.join(".tcab").exists(),
        "the store sidecar is still skipped"
    );
}

#[test]
#[cfg(unix)]
fn copy_tree_recreates_symlinks_including_to_directories() {
    // A reference-impl's `node_modules` ships relative symlinks, some pointing at
    // directories (e.g. `@test-cabinet/voxel-runtime -> ../../vendor/...`). These
    // must be recreated as symlinks rather than dereferenced: `std::fs::copy`
    // follows the link and errors on a symlink-to-directory ("the source path is
    // neither a regular file nor a symlink to a regular file"), which used to abort
    // the whole ingest.
    let src = TempDir::new().unwrap();
    write(&src.path().join("pkg/index.js"), "export default 1;");
    write(
        &src.path().join("vendor/lib/main.js"),
        "export const x = 2;",
    );
    // A symlink to a file and a symlink to a directory, both relative.
    std::os::unix::fs::symlink("../pkg/index.js", src.path().join("vendor/link.js")).unwrap();
    std::os::unix::fs::symlink("vendor/lib", src.path().join("lib-link")).unwrap();
    let dst = TempDir::new().unwrap();

    copy_tree(src.path(), &dst.path().join("out")).unwrap();

    let out = dst.path().join("out");
    assert!(out.join("pkg/index.js").exists());
    assert!(out.join("vendor/lib/main.js").exists());
    // Both links survive as links (not flattened copies) and resolve within the copy.
    assert!(
        std::fs::symlink_metadata(out.join("vendor/link.js"))
            .unwrap()
            .is_symlink()
    );
    let dir_link = out.join("lib-link");
    assert!(std::fs::symlink_metadata(&dir_link).unwrap().is_symlink());
    assert!(
        dir_link.join("main.js").exists(),
        "dir symlink resolves in the copy"
    );
}

#[test]
fn stored_manifest_carries_adversarial_specs() {
    // An adversarial case's `[contract]`, `[sandbox]`, `[simulation]`, `[match]`,
    // `[replay]`, and `build.module` must survive into the stored manifest — they
    // are what the arena's `canonical_match_setup` needs. Resolving the real
    // Foray case and building its manifest guards the full path
    // (regression: these fields were dropped, so a quick match 500'd with
    // "an adversarial match requires [contract], [sandbox], and [simulation]").
    let test_cases = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test-cases");
    let catalog = test_cabinet_core::test_case::TestCaseCatalog::new(test_cases);
    let resolved = catalog.resolve("foray", "v1.0.0").unwrap();

    let manifest = build_stored_manifest(&resolved).unwrap();

    let contract = manifest.contract.expect("contract survives ingest");
    assert_eq!(contract.entry, "tick");
    // Adversarial carries the per-tick world/action schemas, not the performance
    // input/output pair.
    assert!(contract.world.is_some() && contract.action.is_some());
    assert!(contract.input.is_none() && contract.output.is_none());
    let sandbox = manifest.sandbox.expect("sandbox survives ingest");
    assert!(sandbox.fuel_per_tick.unwrap_or(0) > 0);
    assert!(sandbox.fuel_limit.is_none());
    let simulation = manifest.simulation.expect("simulation survives ingest");
    assert!(simulation.max_ticks > 0);
    assert!(manifest.r#match.is_some(), "match survives ingest");
    assert!(manifest.replay.is_some(), "replay survives ingest");
    let module = manifest
        .build
        .and_then(|build| build.module)
        .expect("build.module survives ingest");
    assert!(module.ends_with(".wasm"));
}

#[test]
fn stored_manifest_carries_instrumentation_and_item_validation() {
    // An end-to-end case's `[instrumentation]` handle and each auto-validated review
    // item's `validation` (script key + outputs) must survive into the stored manifest
    // — they are what the deployed driver's validator needs to drive the build's debug
    // API and decide the item. Resolving the real Carom v2.0.0 case (which mandates
    // instrumentation and auto-validates several items) and building its manifest
    // guards the full path. The reporter-side script files themselves ride along in the
    // copied version tree (`copy_tree`) and are served by the artifact endpoint; they
    // must never appear in the seed sets (specs/assets/workspace).
    let test_cases = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test-cases");
    let catalog = test_cabinet_core::test_case::TestCaseCatalog::new(test_cases);
    let resolved = catalog.resolve("carom", "v2.0.0").unwrap();

    let manifest = build_stored_manifest(&resolved).unwrap();

    let instrumentation = manifest
        .instrumentation
        .expect("instrumentation handle survives ingest");
    assert_eq!(instrumentation.handle, "__carom");

    // `ball-spin` is broken into sub-items, so its validation lives on each sub-item
    // (not on the item), each with its own driver + outputs — the per-sub-item shape.
    let ball_spin = manifest
        .common_review_items
        .iter()
        .find(|item| item.id == "ball-spin")
        .expect("the ball-spin review item is present");
    assert!(
        ball_spin.validation.is_none(),
        "a sub-divided item carries no item-level validation"
    );
    let stationary = ball_spin
        .sub_items
        .iter()
        .find(|sub| sub.id == "stationary")
        .expect("the stationary sub-item is present");
    let validation = stationary
        .validation
        .as_ref()
        .expect("the sub-item's validation driver survives ingest");
    assert_eq!(validation.script, "validation/ball-spin/stationary.mjs");
    assert!(
        !validation.outputs.is_empty(),
        "the validation outputs survive ingest"
    );

    // At least one item is human-judged (no validation), and the seed sets never carry
    // a debug script — the model must never see the checklist or its drivers.
    let seed_sources: Vec<&str> = manifest
        .common_specs
        .iter()
        .map(|spec| spec.source.as_str())
        .chain(manifest.assets.iter().map(|asset| asset.source.as_str()))
        .chain(manifest.workspace.iter().map(|file| file.source.as_str()))
        .chain(
            manifest
                .variants
                .iter()
                .flat_map(|variant| variant.specs.iter().map(|spec| spec.source.as_str())),
        )
        .collect();
    assert!(
        seed_sources
            .iter()
            .all(|source| !source.contains("validation/")),
        "a validation debug script must never be seeded into the run: {seed_sources:?}"
    );
}

#[test]
fn ingest_tolerates_a_variant_reference_implementation_key() {
    // A variant that declares `reference_implementation` must ingest cleanly. The
    // reference implementation is the authored, correct static build, hosted
    // out-of-band by `tcab publish-reference` and surfaced on the case page's
    // "Reference" tab — it is never seeded into a run and never built at ingest. So
    // resolution parses and resolves the key (proving ingest does not choke on it),
    // while `build_stored_manifest` simply carries the variant through without the
    // reference-impl host path: the URL lives in the `case_reference_build` table,
    // not the stored manifest.
    let dir = TempDir::new().expect("temp dir");
    // The catalog groups cases as `<type>/<difficulty>/<slug>/<version>/`; this is a
    // default (end-to-end) `easy` demo case.
    let version = dir.path().join("end-to-end/easy/demo/v1.0.0");
    write(&version.join("prompt.hbs"), "Build it.");
    write(&version.join("changelog.md"), "Introduced.");
    // A real, buildable reference project would live here; a directory is all
    // resolution requires (it validates the path is a directory and never reads it).
    write(
        &version.join("reference-impl/base/index.html"),
        "<!doctype html>",
    );
    write(
        &version.join("test-case.toml"),
        "slug = \"demo\"\nname = \"Demo\"\ndifficulty = \"easy\"\ntags = []\n\
         prompt = \"prompt.hbs\"\nchangelog = \"changelog.md\"\n\
         variants = [\"variants/base.toml\"]\n\
         [build]\ninstall = \"npm ci\"\nbuild = \"npm run build\"\n\
         [[domain]]\nid = \"gameplay\"\ndescription = \"Core gameplay.\"\n",
    );
    write(
        &version.join("variants/base.toml"),
        "slug = \"base\"\nreference_implementation = \"reference-impl/base\"\n",
    );

    let catalog = test_cabinet_core::test_case::TestCaseCatalog::new(dir.path());
    let resolved = catalog
        .resolve("demo", "v1.0.0")
        .expect("resolve tolerates the key");
    // Resolution recognized and resolved the key onto the variant.
    assert!(
        resolved.variants[0].reference_impl.is_some(),
        "resolution resolves the reference implementation onto the variant",
    );

    // Ingest tolerates the key: the stored manifest builds, and the variant carries
    // through (the reference-impl host path is intentionally dropped — it is not part
    // of the run-facing stored shape).
    let manifest = build_stored_manifest(&resolved).expect("build tolerates the key");
    assert_eq!(manifest.variants.len(), 1);
    assert_eq!(manifest.variants[0].slug, "base");
}

#[test]
fn stored_manifest_carries_performance_specs() {
    // A performance case's `[contract]` (input/output), per-scenario `[sandbox]`
    // (fuel_limit), and the held-out `[[case]]` scored set must survive into the
    // stored manifest, and the adversarial-only loop tables (simulation/match/
    // replay) must stay absent. Resolving the real Lattice case and building its
    // manifest guards the generalized contract/sandbox shape and the new cases
    // field, mirroring the adversarial regression guard above.
    let test_cases = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test-cases");
    let catalog = test_cabinet_core::test_case::TestCaseCatalog::new(test_cases);
    let resolved = catalog.resolve("lattice", "v1.0.0").unwrap();

    let manifest = build_stored_manifest(&resolved).unwrap();

    let contract = manifest.contract.expect("contract survives ingest");
    assert_eq!(contract.entry, "simulate");
    // Performance carries the per-scenario input/output schemas, not world/action.
    assert!(contract.input.is_some() && contract.output.is_some());
    assert!(contract.world.is_none() && contract.action.is_none());
    let sandbox = manifest.sandbox.expect("sandbox survives ingest");
    assert!(sandbox.fuel_limit.unwrap_or(0) > 0);
    assert!(sandbox.fuel_per_tick.is_none());
    // The held-out scored set survives ingest (small/medium/large).
    assert_eq!(manifest.cases.len(), 3);
    for case in &manifest.cases {
        assert!(!case.input.is_empty() && !case.expected.is_empty());
    }
    // None of the adversarial loop tables apply to a performance case.
    assert!(manifest.simulation.is_none());
    assert!(manifest.r#match.is_none());
    assert!(manifest.replay.is_none());
    let module = manifest
        .build
        .and_then(|build| build.module)
        .expect("build.module survives ingest");
    assert!(module.ends_with(".wasm"));
}

#[test]
fn stored_manifest_carries_voxel_specs() {
    // A voxel case's `[voxel]` bounding volume — and, for a voxel-animation case,
    // its required `[model]` animation contract — must survive into the stored
    // manifest. They are what the runner's seeder reads to write the
    // `voxel(-anim).config.json` and pre-seed `rig.json`; if they are dropped, seeding
    // fails with "voxel case has no [voxel]" (the regression this guards). Resolving
    // the real static Skyshard and rigged Ironward cases guards the ingest path for
    // both voxel kinds, mirroring the adversarial/performance guards above.
    let test_cases = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test-cases");
    let catalog = test_cabinet_core::test_case::TestCaseCatalog::new(test_cases);

    // A static voxel-model case: the volume survives; there is no rig.
    let skyshard = catalog.resolve("skyshard", "v1.0.0").unwrap();
    let manifest = build_stored_manifest(&skyshard).unwrap();
    let voxel = manifest.voxel.expect("voxel volume survives ingest");
    assert_eq!((voxel.width, voxel.height, voxel.depth), (50, 20, 76));
    assert!(
        manifest.model.is_none(),
        "a static voxel-model case declares no rig"
    );

    // A rigged voxel-animation case: the volume and the required rig both survive.
    let ironward = catalog.resolve("ironward", "v1.0.0").unwrap();
    let manifest = build_stored_manifest(&ironward).unwrap();
    assert!(manifest.voxel.is_some(), "voxel volume survives ingest");
    let model = manifest.model.expect("required rig survives ingest");
    assert!(
        !model.animations.is_empty(),
        "the required rig must carry its declared animations"
    );
    assert!(
        model.parts.is_empty(),
        "parts are model-invented, not declared in the manifest"
    );
}

#[test]
fn every_stored_manifest_preserves_its_asset_shape() {
    // A whole-catalog guard against ingest drift: a field that resolution fills in
    // but `build_stored_manifest` forgets to copy, so a run seeds from a manifest
    // missing the tables its shape requires (exactly how the voxel volume was lost).
    // For every committed case + version, build the stored manifest and assert
    // (a) the tables its `asset_kind` requires are present, and (b) the manifest
    // survives a JSON round-trip unchanged (the on-disk sidecar and the wire
    // encoding the runner deserializes are lossless).
    use test_cabinet_core::AssetKind;
    let test_cases = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test-cases");
    let catalog = test_cabinet_core::test_case::TestCaseCatalog::new(test_cases);
    let cases = catalog.list().expect("list catalog");
    assert!(!cases.is_empty(), "catalog should not be empty");
    for case in &cases {
        for version in &case.versions {
            let resolved = catalog
                .resolve(&case.slug, version)
                .unwrap_or_else(|err| panic!("resolve {}@{}: {err:?}", case.slug, version));
            let manifest = build_stored_manifest(&resolved)
                .unwrap_or_else(|err| panic!("build manifest {}@{}: {err:?}", case.slug, version));
            let id = format!("{}@{}", case.slug, version);

            // Each asset shape's required tables must survive ingest.
            match manifest.asset_kind {
                AssetKind::SpriteSheet => {
                    assert!(
                        manifest.sheet.is_some(),
                        "{id}: sprite-sheet lost its [sheet]"
                    );
                }
                AssetKind::VoxelModel
                | AssetKind::McModel
                | AssetKind::SnModel
                | AssetKind::DcModel => {
                    assert!(
                        manifest.voxel.is_some(),
                        "{id}: static voxel/meshed kind lost its [voxel]"
                    );
                    assert!(
                        manifest.model.is_none(),
                        "{id}: static voxel/meshed kind has no [model]"
                    );
                }
                AssetKind::VoxelAnimation
                | AssetKind::McAnimation
                | AssetKind::SnAnimation
                | AssetKind::DcAnimation => {
                    assert!(
                        manifest.voxel.is_some(),
                        "{id}: animated voxel/meshed kind lost its [voxel]"
                    );
                    assert!(
                        manifest.model.is_some(),
                        "{id}: animated voxel/meshed kind lost its [model]"
                    );
                }
                AssetKind::McSkinned | AssetKind::SnSkinned | AssetKind::DcSkinned => {
                    assert!(
                        manifest.voxel.is_some(),
                        "{id}: skinned meshed kind lost its [voxel]"
                    );
                    assert!(
                        manifest.model.is_some(),
                        "{id}: skinned meshed kind lost its [model] rig"
                    );
                }
                // The animated Blender kinds reuse both tables verbatim: `[voxel]` as the
                // bounding box and `[model]` as the required animations (see
                // `AssetKind::is_blender`). Both must survive ingest.
                AssetKind::BlenderCharacter | AssetKind::BlenderMechanism => {
                    assert!(
                        manifest.voxel.is_some(),
                        "{id}: animated Blender kind lost its [voxel] bounding box"
                    );
                    assert!(
                        manifest.model.is_some(),
                        "{id}: animated Blender kind lost its [model] animations"
                    );
                }
                // A static Blender prop carries only the `[voxel]` bounding box; it
                // declares no `[model]` (it is unrigged).
                AssetKind::BlenderProp => {
                    assert!(
                        manifest.voxel.is_some(),
                        "{id}: blender-prop kind lost its [voxel] bounding box"
                    );
                    assert!(
                        manifest.model.is_none(),
                        "{id}: blender-prop is static and must carry no [model]"
                    );
                }
                // The painted (`ui`/`material`), particle, and audio kinds each carry
                // their own `[ui]`/`[material]`/`[particle]`/`[audio]` table, which the
                // backend `StoredManifest` now mirrors verbatim (as with the voxel
                // specs above). Guard each so a run seeds from a manifest that still
                // carries the table its shape requires.
                AssetKind::Ui => {
                    assert!(manifest.ui.is_some(), "{id}: ui kind lost its [ui]");
                }
                AssetKind::Material => {
                    assert!(
                        manifest.material.is_some(),
                        "{id}: material kind lost its [material]"
                    );
                }
                AssetKind::Particle2d | AssetKind::Particle3d => {
                    assert!(
                        manifest.particle.is_some(),
                        "{id}: particle kind lost its [particle]"
                    );
                }
                AssetKind::SfxSynth | AssetKind::SfxSample | AssetKind::Music => {
                    assert!(
                        manifest.audio.is_some(),
                        "{id}: audio kind lost its [audio]"
                    );
                }
                AssetKind::Sprite => {}
            }

            // The persisted / wire encoding must be lossless.
            let json = serde_json::to_string(&manifest).expect("serialize stored manifest");
            let round: StoredManifest =
                serde_json::from_str(&json).expect("deserialize stored manifest");
            assert_eq!(
                round, manifest,
                "{id}: stored manifest changed across a JSON round-trip"
            );
        }
    }
}

// --- guarded prune of stale definitions -------------------------------------

/// Write a minimal end-to-end case (no reference mockups, so ingest needs no
/// browser render) under `<checkout>/test-cases/end-to-end/easy/<folder>/v1.0.0`
/// declaring `slug`. The `<type>/<difficulty>` grouping matches the catalog layout;
/// this helper's cases are all default (end-to-end) `easy` cases.
fn write_e2e_case(checkout: &std::path::Path, folder: &str, slug: &str) {
    write_e2e_version(checkout, folder, slug, "v1.0.0");
}

fn write_e2e_version(checkout: &std::path::Path, folder: &str, slug: &str, version: &str) {
    let base = checkout
        .join("test-cases")
        .join("end-to-end")
        .join("easy")
        .join(folder)
        .join(version);
    write(&base.join("prompt.hbs"), "Build it.");
    write(&base.join("changelog.md"), "Introduced.");
    write(&base.join("variants/base.toml"), "slug = \"base\"\n");
    let manifest = format!(
        "slug = \"{slug}\"\nname = \"Case\"\ndifficulty = \"easy\"\ntags = []\n\
         prompt = \"prompt.hbs\"\nchangelog = \"changelog.md\"\nvariants = [\"variants/base.toml\"]\n\
         [build]\ninstall = \"x\"\nbuild = \"y\"\n\
         [[domain]]\nid = \"g\"\ndescription = \"d\"\n"
    );
    write(&base.join("test-case.toml"), &manifest);
}

/// Slugs currently served by the store, sorted.
fn stored_slugs(store: &DefinitionStore) -> Vec<String> {
    let mut slugs: Vec<String> = store
        .list_cases()
        .unwrap()
        .into_iter()
        .map(|(s, _)| s)
        .collect();
    slugs.sort();
    slugs
}

#[test]
fn whole_catalog_ingest_prunes_a_case_the_checkout_no_longer_declares() {
    let checkout = TempDir::new().unwrap();
    write_e2e_case(checkout.path(), "alpha", "alpha");
    write_e2e_case(checkout.path(), "beta", "beta");
    let store_dir = TempDir::new().unwrap();
    let store = DefinitionStore::open(store_dir.path()).unwrap();

    Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest::default())
        .unwrap();
    assert_eq!(stored_slugs(&store), ["alpha", "beta"]);

    // Drop beta from the checkout; a whole-catalog re-ingest prunes it.
    std::fs::remove_dir_all(checkout.path().join("test-cases/end-to-end/easy/beta")).unwrap();
    Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest::default())
        .unwrap();
    assert_eq!(stored_slugs(&store), ["alpha"]);
}

#[test]
fn prune_spares_a_definition_a_run_still_references() {
    let checkout = TempDir::new().unwrap();
    write_e2e_case(checkout.path(), "alpha", "alpha");
    write_e2e_case(checkout.path(), "beta", "beta");
    let store_dir = TempDir::new().unwrap();
    let store = DefinitionStore::open(store_dir.path()).unwrap();

    Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest::default())
        .unwrap();

    // Drop beta from the checkout, but protect it as a published run would: the
    // stale definition is kept so the run stays resolvable.
    std::fs::remove_dir_all(checkout.path().join("test-cases/end-to-end/easy/beta")).unwrap();
    let protected = std::collections::HashSet::from([("beta".to_string(), "v1.0.0".to_string())]);
    Ingestor::new(checkout.path(), &store)
        .with_protected_cases(protected)
        .scan(&IngestRequest::default())
        .unwrap();
    assert_eq!(stored_slugs(&store), ["alpha", "beta"]);
}

#[test]
fn a_folder_rename_that_pins_the_slug_overwrites_in_place_without_duplicating() {
    // The bug this fixes: renaming a case's folder used to leave the old slug served
    // alongside the new one. Pinning the slug across the rename keys both the old and
    // new folder to the same store directory, so the re-ingest overwrites in place.
    let checkout = TempDir::new().unwrap();
    write_e2e_case(checkout.path(), "pong", "pong");
    let store_dir = TempDir::new().unwrap();
    let store = DefinitionStore::open(store_dir.path()).unwrap();

    Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest::default())
        .unwrap();
    assert_eq!(stored_slugs(&store), ["pong"]);

    // Rename the folder pong -> carom but keep `slug = "pong"`.
    std::fs::remove_dir_all(checkout.path().join("test-cases/end-to-end/easy/pong")).unwrap();
    write_e2e_case(checkout.path(), "carom", "pong");
    Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest::default())
        .unwrap();

    // Still exactly one case, keyed by the pinned slug — no `carom` duplicate.
    assert_eq!(stored_slugs(&store), ["pong"]);
    assert!(store.has_version("pong", "v1.0.0"));
    assert!(!store.has_version("carom", "v1.0.0"));
}

#[test]
fn a_version_qualified_target_ingests_only_that_version() {
    let checkout = TempDir::new().unwrap();
    write_e2e_version(checkout.path(), "alpha", "alpha", "v1.0.0");
    write_e2e_version(checkout.path(), "alpha", "alpha", "v2.0.0");
    let store_dir = TempDir::new().unwrap();
    let store = DefinitionStore::open(store_dir.path()).unwrap();

    Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest::default())
        .unwrap();

    // Target a single version with `slug@version`: the report touches only it, leaving
    // the case's other versions untouched (a bare `alpha` would expand to both).
    let report = Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest {
            test_cases: Some(vec!["alpha@v1.0.0".to_string()]),
            force: true,
            ..Default::default()
        })
        .unwrap();
    let touched: Vec<(&str, &str)> = report
        .test_case_versions
        .iter()
        .map(|v| (v.slug.as_str(), v.version.as_str()))
        .collect();
    assert_eq!(touched, [("alpha", "v1.0.0")]);
}

#[test]
fn a_partial_scan_never_prunes() {
    let checkout = TempDir::new().unwrap();
    write_e2e_case(checkout.path(), "alpha", "alpha");
    write_e2e_case(checkout.path(), "beta", "beta");
    let store_dir = TempDir::new().unwrap();
    let store = DefinitionStore::open(store_dir.path()).unwrap();

    Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest::default())
        .unwrap();

    // Remove beta, then run a scan scoped to alpha only. A partial scan has not seen
    // the whole catalog, so it must not conclude beta is absent.
    std::fs::remove_dir_all(checkout.path().join("test-cases/end-to-end/easy/beta")).unwrap();
    Ingestor::new(checkout.path(), &store)
        .scan(&IngestRequest {
            test_cases: Some(vec!["alpha".to_string()]),
            force: true,
            ..Default::default()
        })
        .unwrap();
    assert_eq!(stored_slugs(&store), ["alpha", "beta"]);
}
