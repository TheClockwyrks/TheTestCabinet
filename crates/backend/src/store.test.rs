use super::*;
use tempfile::TempDir;

/// Open a store rooted in a fresh temp directory.
fn temp_store() -> (TempDir, DefinitionStore) {
    let dir = TempDir::new().expect("temp dir");
    let store = DefinitionStore::open(dir.path()).expect("open store");
    (dir, store)
}

fn sample_manifest(slug: &str, version: &str) -> StoredManifest {
    StoredManifest {
        slug: slug.to_string(),
        version: version.to_string(),
        name: "Sample".to_string(),
        difficulty: "easy".to_string(),
        tags: vec!["arcade".to_string()],
        summary: Some("A sample.".to_string()),
        description: None,
        max_runtime_seconds: 1800,
        test_type: test_cabinet_core::TestType::EndToEnd,
        build: Some(StoredBuild {
            install: "npm ci".to_string(),
            build: "npm run build".to_string(),
            module: None,
        }),
        canvas: None,
        tool: None,
        output: None,
        contract: None,
        sandbox: None,
        cases: Vec::new(),
        simulation: None,
        r#match: None,
        replay: None,
        asset_kind: test_cabinet_core::AssetKind::Sprite,
        sheet: None,
        voxel: None,
        model: None,
        prompt_template: "build it".to_string(),
        common_specs: vec![StoredSpec {
            source: "specs/overview.hbs".to_string(),
            dest: "specs/overview.md".to_string(),
            template: true,
        }],
        workspace: vec![StoredWorkspaceFile {
            source: "workspaces/base/package.json".to_string(),
            dest: "package.json".to_string(),
        }],
        init: Some("npm install".to_string()),
        assets: vec![],
        variants: vec![StoredVariant {
            slug: "base".to_string(),
            name: "Base".to_string(),
            description: None,
            specs: vec![],
            workspace: None,
            references: vec![],
            proofs: vec![],
            review_items: vec![StoredReviewItem {
                id: "mode-only".to_string(),
                title: "Mode list".to_string(),
                text: "The base variant lists only the standard modes.".to_string(),
                reference: None,
                proof: None,
                sequences: vec![],
                frames: vec![],
                weight: 1,
                domain: None,
            }],
            domains: vec![],
        }],
        common_references: vec![StoredReference {
            view: "gameplay".to_string(),
            kind: test_cabinet_core::ReferenceKind::Rendered,
            extension: "png".to_string(),
        }],
        common_proofs: vec![],
        checks: vec![],
        common_review_items: vec![StoredReviewItem {
            id: "ball-spin".to_string(),
            title: "Paddle spin".to_string(),
            text: "Swinging a paddle imparts spin on the ball.".to_string(),
            reference: None,
            proof: None,
            sequences: vec![],
            frames: vec![],
            weight: 2,
            domain: Some("single-player".to_string()),
        }],
        domains: vec![StoredDomain {
            id: "single-player".to_string(),
            name: "Single Player".to_string(),
            description: "Solo play.".to_string(),
        }],
    }
}

#[test]
fn manifest_round_trips() {
    let (_dir, store) = temp_store();
    let manifest = sample_manifest("pong", "v1.0.0");
    store.write_manifest(&manifest).unwrap();
    assert!(store.has_version("pong", "v1.0.0"));
    let read = store.read_manifest("pong", "v1.0.0").unwrap();
    assert_eq!(read, manifest);
}

#[test]
fn missing_version_is_not_found() {
    let (_dir, store) = temp_store();
    let err = store.read_manifest("nope", "v1.0.0").unwrap_err();
    assert!(matches!(err, BackendError::NotFound(_)));
}

#[test]
fn artifact_traversal_is_rejected() {
    let (_dir, store) = temp_store();
    store
        .write_manifest(&sample_manifest("pong", "v1.0.0"))
        .unwrap();
    let err = store
        .read_artifact("pong", "v1.0.0", "../../etc/passwd")
        .unwrap_err();
    assert!(matches!(err, BackendError::BadRequest(_)));
}

#[test]
fn artifact_cannot_reach_the_sidecar() {
    let (_dir, store) = temp_store();
    store
        .write_manifest(&sample_manifest("pong", "v1.0.0"))
        .unwrap();
    // The manifest lives under `.tcab/manifest.json`; it must not be fetchable as
    // an artifact even though the path is technically inside the version dir.
    let err = store
        .read_artifact("pong", "v1.0.0", ".tcab/manifest.json")
        .unwrap_err();
    assert!(matches!(err, BackendError::NotFound(_)));
}

#[test]
fn artifact_reads_a_real_file() {
    let (_dir, store) = temp_store();
    store
        .write_manifest(&sample_manifest("pong", "v1.0.0"))
        .unwrap();
    let spec_path = store
        .version_dir("pong", "v1.0.0")
        .join("specs/overview.hbs");
    std::fs::create_dir_all(spec_path.parent().unwrap()).unwrap();
    std::fs::write(&spec_path, b"hello").unwrap();
    let bytes = store
        .read_artifact("pong", "v1.0.0", "specs/overview.hbs")
        .unwrap();
    assert_eq!(bytes, b"hello");
}

#[test]
fn reference_scope_and_view_are_validated() {
    let (_dir, store) = temp_store();
    assert!(matches!(
        store
            .read_reference("pong", "v1.0.0", "..", "title")
            .unwrap_err(),
        BackendError::BadRequest(_)
    ));
    assert!(matches!(
        store
            .read_reference("pong", "v1.0.0", "base", "a/b")
            .unwrap_err(),
        BackendError::BadRequest(_)
    ));
}

#[test]
fn versions_are_listed_oldest_to_newest_by_mtime() {
    let (_dir, store) = temp_store();
    // Write v1.0.0 first, then v1.1.0; the newer directory has a later mtime, so
    // it must be listed last (newest-listed-last per the catalog contract).
    store
        .write_manifest(&sample_manifest("snake", "v1.0.0"))
        .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    store
        .write_manifest(&sample_manifest("snake", "v1.1.0"))
        .unwrap();
    let versions = store.list_versions("snake").unwrap();
    assert_eq!(versions, vec!["v1.0.0".to_string(), "v1.1.0".to_string()]);
}

#[test]
fn delete_run_media_removes_every_kind_and_is_idempotent() {
    let (_dir, store) = temp_store();
    // Seed all three media kinds for one run, plus media for a second run that
    // must survive the delete.
    store.write_run_proof("r1", "p.png", b"proof").unwrap();
    store
        .write_run_asset("r1", "regenerated.png", b"asset")
        .unwrap();
    store.write_run_controller("r1", b"\0wasm").unwrap();
    store.write_run_proof("r2", "p.png", b"other").unwrap();

    store.delete_run_media("r1").unwrap();

    assert!(!store.run_dir("r1").exists());
    assert!(store.read_run_proof("r1", "p.png").is_err());
    // A second delete is a no-op, not an error.
    store.delete_run_media("r1").unwrap();
    // The other run's media is untouched.
    assert_eq!(store.read_run_proof("r2", "p.png").unwrap(), b"other");
}

#[test]
fn delete_run_media_rejects_an_unsafe_run_id() {
    let (_dir, store) = temp_store();
    let err = store.delete_run_media("../escape").unwrap_err();
    assert!(matches!(err, BackendError::BadRequest(_)));
}

#[test]
fn publish_staged_version_swaps_a_fresh_build_into_place() {
    // A re-ingest builds into a staging dir and swaps it in wholesale: new content
    // wins, a file dropped between builds does not linger, and no staging debris is
    // left behind. This is the mechanism that closes the manifest-less window a
    // destructive in-place rebuild opened (the spurious 404 "is not ingested" a run
    // hit while resolving its version mid-re-ingest).
    let (_dir, store) = temp_store();
    let version_dir = store.version_dir("pong", "v1.0.0");

    // First publish: a tree with a manifest plus a file a later build will drop.
    let staged = store.new_staging_dir("pong", "v1.0.0").unwrap();
    std::fs::write(staged.join("keep.txt"), "v1").unwrap();
    std::fs::write(staged.join("stale.txt"), "old").unwrap();
    write_manifest_in(&staged, &sample_manifest("pong", "v1.0.0")).unwrap();
    store
        .publish_staged_version("pong", "v1.0.0", &staged)
        .unwrap();

    assert!(store.has_version("pong", "v1.0.0"));
    assert_eq!(
        std::fs::read_to_string(version_dir.join("keep.txt")).unwrap(),
        "v1"
    );

    // Re-publish from a fresh build: updated content, and `stale.txt` is absent.
    let staged2 = store.new_staging_dir("pong", "v1.0.0").unwrap();
    std::fs::write(staged2.join("keep.txt"), "v2").unwrap();
    write_manifest_in(&staged2, &sample_manifest("pong", "v1.0.0")).unwrap();
    store
        .publish_staged_version("pong", "v1.0.0", &staged2)
        .unwrap();

    assert_eq!(
        store.read_manifest("pong", "v1.0.0").unwrap().version,
        "v1.0.0"
    );
    assert_eq!(
        std::fs::read_to_string(version_dir.join("keep.txt")).unwrap(),
        "v2"
    );
    assert!(
        !version_dir.join("stale.txt").exists(),
        "a file removed between builds must not linger after the swap"
    );

    // Only the real version is served — staging/retired dirs never leak into the
    // listed `test-cases/` tree, and the staging area is drained after the swap.
    assert_eq!(
        store.list_versions("pong").unwrap(),
        vec!["v1.0.0".to_string()]
    );
    let leaked: Vec<_> = std::fs::read_dir(store.staging_root())
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    assert!(
        leaked.is_empty(),
        "staging area should be empty after publish, found {leaked:?}"
    );
}
