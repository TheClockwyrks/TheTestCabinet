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
        build: StoredBuild {
            install: "npm ci".to_string(),
            build: "npm run build".to_string(),
        },
        prompt_template: "build it".to_string(),
        common_specs: vec![StoredSpec {
            source: "specs/overview.hbs".to_string(),
            dest: "specs/overview.md".to_string(),
            template: true,
        }],
        assets: vec![],
        variants: vec![StoredVariant {
            slug: "base".to_string(),
            name: "Base".to_string(),
            description: None,
            specs: vec![],
            references: vec![],
        }],
        common_references: vec![StoredReference {
            view: "gameplay".to_string(),
        }],
        checks: vec![],
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
fn container_metadata_round_trips_and_latest_wins() {
    let (_dir, store) = temp_store();
    let first = StoredContainer {
        harness: "claude".to_string(),
        content_hash: "sha256:aaaa".to_string(),
        builds_from: Some("base".to_string()),
        files: vec![HashedFile {
            path: "Dockerfile".to_string(),
            sha256: "aaaa".to_string(),
            size: 10,
        }],
    };
    store.write_container_meta(&first).unwrap();
    assert!(store.has_container("claude", "sha256:aaaa"));

    std::thread::sleep(std::time::Duration::from_millis(20));
    let second = StoredContainer {
        content_hash: "sha256:bbbb".to_string(),
        files: vec![HashedFile {
            path: "Dockerfile".to_string(),
            sha256: "bbbb".to_string(),
            size: 11,
        }],
        ..first.clone()
    };
    store.write_container_meta(&second).unwrap();

    // The newer hash is the one resolution serves.
    let latest = store.read_latest_container("claude").unwrap().unwrap();
    assert_eq!(latest.content_hash, "sha256:bbbb");
    // But the old key is still present (immutable history).
    assert!(store.has_container("claude", "sha256:aaaa"));
}
