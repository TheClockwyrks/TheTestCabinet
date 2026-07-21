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
        changelog: "Introduced.".to_string(),
        max_runtime_seconds: 1800,
        test_type: test_cabinet_core::TestType::EndToEnd,
        experimental: false,
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
        ui: None,
        material: None,
        particle: None,
        audio: None,
        prompt_template: "build it".to_string(),
        common_specs: vec![StoredSpec {
            source: "specs/overview.hbs".to_string(),
            dest: "specs/overview.md".to_string(),
            template: true,
            kind: Default::default(),
        }],
        workspace: vec![StoredWorkspaceFile {
            source: "workspaces/base/package.json".to_string(),
            dest: "package.json".to_string(),
        }],
        init: Some("npm install".to_string()),
        assets: vec![],
        packages: vec![],
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
                graded: false,
                domain: None,
                sub_items: vec![],
                validation: None,
            }],
            domains: vec![],
            voxel: None,
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
            graded: false,
            domain: Some("single-player".to_string()),
            sub_items: vec![],
            // An auto-validated item so the manifest round-trip (write → read) covers
            // the reporter-side validation driver.
            validation: Some(StoredReviewValidation {
                script: "validation/ball-spin.mjs".to_string(),
                outputs: vec![StoredReviewOutput {
                    id: "spin".to_string(),
                    name: "Spin".to_string(),
                    kind: test_cabinet_core::MediaKind::Image,
                }],
            }),
        }],
        domains: vec![StoredDomain {
            id: "single-player".to_string(),
            name: "Single Player".to_string(),
            description: "Solo play.".to_string(),
        }],
        instrumentation: Some(StoredInstrumentation {
            handle: "__carom".to_string(),
            tick_hz: Some(120),
        }),
        errata: vec![StoredErratum {
            id: "cue-clips-rail".to_string(),
            title: "Cue ball clips the rail".to_string(),
            date: Some("2026-07-17".to_string()),
            severity: test_cabinet_core::test_case::ErratumSeverity::Major,
            affects_scoring: true,
            exclude_from_score: false,
            body: "Known tunnelling at high speed.".to_string(),
            resolved_in: Some("v1.1.0".to_string()),
            variant: None,
            review: None,
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
fn validation_baseline_reads_committed_case_scoped_media() {
    let (_dir, store) = temp_store();
    // The committed baseline media lives under the version folder at
    // `validation-baseline/<variant>/<item>__<output>.<ext>` (copied into the store
    // at ingest like any other definition file). Serving reads it straight back.
    let baseline_dir = store
        .version_dir("pong", "v1.0.0")
        .join(test_cabinet_core::VALIDATION_BASELINE_DIR)
        .join("base");
    std::fs::create_dir_all(&baseline_dir).unwrap();
    std::fs::write(baseline_dir.join("ball-spin__spin.webm"), b"clip").unwrap();

    assert_eq!(
        store
            .read_validation_baseline("pong", "v1.0.0", "base", "ball-spin__spin.webm")
            .unwrap(),
        b"clip",
    );
    // A missing file 404s (NotFound), and a traversal-y variant or file is rejected.
    assert!(matches!(
        store
            .read_validation_baseline("pong", "v1.0.0", "base", "nope.png")
            .unwrap_err(),
        BackendError::NotFound(_)
    ));
    assert!(matches!(
        store
            .read_validation_baseline("pong", "v1.0.0", "..", "ball-spin__spin.webm")
            .unwrap_err(),
        BackendError::BadRequest(_)
    ));
    assert!(matches!(
        store
            .read_validation_baseline("pong", "v1.0.0", "base", "a/b")
            .unwrap_err(),
        BackendError::BadRequest(_)
    ));
}

#[test]
fn validation_files_lists_the_whole_script_directory_recursively() {
    let (_dir, store) = temp_store();
    // The reporter-side scripts live under the version folder at `validation/` (copied
    // into the store at ingest like any other definition file): the named drivers plus
    // any shared modules they import, which may be flat siblings or nested.
    let validation_dir = store
        .version_dir("pong", "v1.0.0")
        .join(test_cabinet_core::VALIDATION_SCRIPT_DIR);
    std::fs::create_dir_all(validation_dir.join("lib")).unwrap();
    std::fs::write(validation_dir.join("ball-spin.mjs"), b"driver").unwrap();
    std::fs::write(validation_dir.join("_helpers.mjs"), b"shared").unwrap();
    std::fs::write(validation_dir.join("lib/geometry.mjs"), b"nested").unwrap();
    // A hidden dotfile is skipped, mirroring the ingest `copy_tree`.
    std::fs::write(validation_dir.join(".DS_Store"), b"junk").unwrap();

    assert_eq!(
        store.list_validation_files("pong", "v1.0.0").unwrap(),
        vec![
            "validation/_helpers.mjs".to_string(),
            "validation/ball-spin.mjs".to_string(),
            "validation/lib/geometry.mjs".to_string(),
        ],
    );

    // A version with no `validation/` directory (a case declaring no scripted items)
    // yields an empty list rather than an error.
    store
        .write_manifest(&sample_manifest("snake", "v1.0.0"))
        .unwrap();
    assert!(
        store
            .list_validation_files("snake", "v1.0.0")
            .unwrap()
            .is_empty()
    );
}

#[test]
fn versions_are_listed_oldest_to_newest_by_semantic_version() {
    let (_dir, store) = temp_store();
    // Write the *newer* version first so its directory has the *earlier* mtime:
    // this proves ordering follows the semantic version, not directory mtime.
    // Mtime order is not a reliable proxy for version order across environments
    // (a fresh checkout or re-ingest touches version dirs in an arbitrary order),
    // which is what made the reported "latest version" environment-dependent.
    store
        .write_manifest(&sample_manifest("snake", "v1.10.0"))
        .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    store
        .write_manifest(&sample_manifest("snake", "v1.9.0"))
        .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    store
        .write_manifest(&sample_manifest("snake", "v1.0.0"))
        .unwrap();
    let versions = store.list_versions("snake").unwrap();
    // Component-wise: v1.0.0 < v1.9.0 < v1.10.0 (not the lexical v1.10.0 < v1.9.0),
    // newest listed last per the catalog contract.
    assert_eq!(
        versions,
        vec![
            "v1.0.0".to_string(),
            "v1.9.0".to_string(),
            "v1.10.0".to_string()
        ]
    );
}

#[test]
fn experimental_versions_are_hidden_from_the_visible_catalog() {
    let (_dir, store) = temp_store();
    // A ready case, and a case whose only version is experimental.
    store
        .write_manifest(&sample_manifest("ready", "v1.0.0"))
        .unwrap();
    let mut wip = sample_manifest("wip", "v1.0.0");
    wip.experimental = true;
    store.write_manifest(&wip).unwrap();

    assert!(store.is_experimental("wip", "v1.0.0"));
    assert!(!store.is_experimental("ready", "v1.0.0"));

    // Experimental disabled (the default, production): the WIP case is absent from
    // the catalog and its versions list is empty — it is treated as if uningested.
    let visible: Vec<String> = store
        .list_visible_cases(false)
        .unwrap()
        .into_iter()
        .map(|(slug, _)| slug)
        .collect();
    assert_eq!(visible, vec!["ready".to_string()]);
    assert!(
        store
            .list_visible_versions("wip", false)
            .unwrap()
            .is_empty()
    );

    // Experimental enabled (the local cluster): every case is visible, exactly as
    // the unfiltered listing.
    let mut visible: Vec<String> = store
        .list_visible_cases(true)
        .unwrap()
        .into_iter()
        .map(|(slug, _)| slug)
        .collect();
    visible.sort();
    assert_eq!(visible, vec!["ready".to_string(), "wip".to_string()]);
    assert_eq!(
        store.list_visible_versions("wip", true).unwrap(),
        vec!["v1.0.0".to_string()]
    );
}

#[test]
fn a_case_keeps_its_non_experimental_versions_when_filtered() {
    let (_dir, store) = temp_store();
    // v1.0.0 is experimental, v1.1.0 is ready. With experimental hidden the case
    // stays in the catalog, exposing only its ready version.
    let mut v1 = sample_manifest("mixed", "v1.0.0");
    v1.experimental = true;
    store.write_manifest(&v1).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    store
        .write_manifest(&sample_manifest("mixed", "v1.1.0"))
        .unwrap();

    assert_eq!(
        store.list_visible_versions("mixed", false).unwrap(),
        vec!["v1.1.0".to_string()]
    );
    assert_eq!(
        store.list_visible_cases(false).unwrap(),
        vec![("mixed".to_string(), vec!["v1.1.0".to_string()])]
    );
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
