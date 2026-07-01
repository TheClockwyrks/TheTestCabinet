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
    // its required `[model]` rig — must survive into the stored manifest. They are
    // what the runner's seeder reads to write the `voxel(-anim).config.json` and
    // pre-seed `rig.json`; if they are dropped, seeding fails with
    // "voxel case has no [voxel]" (the regression this guards). Resolving the real
    // static Skyshard and rigged Ironward cases guards the ingest path for both
    // voxel kinds, mirroring the adversarial/performance guards above.
    let test_cases = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test-cases");
    let catalog = test_cabinet_core::test_case::TestCaseCatalog::new(test_cases);

    // A static voxel-model case: the volume survives; there is no rig.
    let skyshard = catalog.resolve("skyshard", "v1.0.0").unwrap();
    let manifest = build_stored_manifest(&skyshard).unwrap();
    let voxel = manifest.voxel.expect("voxel volume survives ingest");
    assert_eq!((voxel.width, voxel.height, voxel.depth), (24, 8, 32));
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
        !model.parts.is_empty(),
        "the required rig must carry its declared parts"
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
                AssetKind::VoxelModel => {
                    assert!(
                        manifest.voxel.is_some(),
                        "{id}: voxel-model lost its [voxel]"
                    );
                    assert!(
                        manifest.model.is_none(),
                        "{id}: static voxel-model has no [model]"
                    );
                }
                AssetKind::VoxelAnimation => {
                    assert!(
                        manifest.voxel.is_some(),
                        "{id}: voxel-animation lost its [voxel]"
                    );
                    assert!(
                        manifest.model.is_some(),
                        "{id}: voxel-animation lost its [model]"
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
