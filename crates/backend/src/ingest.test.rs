use super::*;
use tempfile::TempDir;

/// Write a file, creating parent directories.
fn write(path: &std::path::Path, contents: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, contents).unwrap();
}

/// Build a synthetic checkout with one harness's container build context.
fn checkout_with_container(harness: &str, dockerfile: &str) -> TempDir {
    let dir = TempDir::new().unwrap();
    write(
        &dir.path()
            .join("containers")
            .join(harness)
            .join("Dockerfile"),
        dockerfile,
    );
    dir
}

#[test]
fn find_cabinet_base_parses_arg_default() {
    let dockerfile = "ARG BASE_IMAGE=test-cabinet/base:latest\nFROM ${BASE_IMAGE}\n";
    assert_eq!(find_cabinet_base(dockerfile), Some("base".to_string()));
}

#[test]
fn find_cabinet_base_parses_direct_from() {
    let dockerfile = "FROM test-cabinet/base:abcd\nRUN echo hi\n";
    assert_eq!(find_cabinet_base(dockerfile), Some("base".to_string()));
}

#[test]
fn find_cabinet_base_is_none_for_external_base() {
    let dockerfile = "FROM debian:bookworm\nRUN echo hi\n";
    assert_eq!(find_cabinet_base(dockerfile), None);
}

#[test]
fn container_ingest_copies_and_hashes() {
    let checkout = checkout_with_container("base", "FROM debian:bookworm\nRUN echo hi\n");
    let store_dir = TempDir::new().unwrap();
    let store = DefinitionStore::open(store_dir.path()).unwrap();
    let ingestor = Ingestor::new(checkout.path(), &store);

    let result = ingestor.ingest_container("base", false).unwrap();
    assert!(result.ingested);
    assert!(result.content_hash.starts_with("sha256:"));
    assert_eq!(result.harness, "base");

    // The build context is copied verbatim and resolvable.
    let dockerfile = store.read_container_file("base", "Dockerfile").unwrap();
    assert_eq!(dockerfile, b"FROM debian:bookworm\nRUN echo hi\n");

    // The metadata records buildsFrom = None for an external base.
    let stored = store.read_latest_container("base").unwrap().unwrap();
    assert_eq!(stored.builds_from, None);
}

#[test]
fn container_ingest_is_idempotent_until_changed() {
    let checkout = checkout_with_container("claude", "FROM test-cabinet/base:latest\nRUN x\n");
    let store_dir = TempDir::new().unwrap();
    let store = DefinitionStore::open(store_dir.path()).unwrap();
    let ingestor = Ingestor::new(checkout.path(), &store);

    let first = ingestor.ingest_container("claude", false).unwrap();
    assert!(first.ingested);
    let second = ingestor.ingest_container("claude", false).unwrap();
    assert!(!second.ingested, "unchanged definition is a no-op");
    assert_eq!(first.content_hash, second.content_hash);

    // The stored metadata records the in-cabinet base dependency.
    let stored = store.read_latest_container("claude").unwrap().unwrap();
    assert_eq!(stored.builds_from, Some("base".to_string()));
}

#[test]
fn container_ingest_detects_a_changed_definition() {
    let checkout = checkout_with_container("kilo", "FROM test-cabinet/base:latest\nRUN a\n");
    let store_dir = TempDir::new().unwrap();
    let store = DefinitionStore::open(store_dir.path()).unwrap();

    let first = Ingestor::new(checkout.path(), &store)
        .ingest_container("kilo", false)
        .unwrap();

    // Change the Dockerfile, re-ingest: the content hash must change and it must
    // re-ingest (not skip).
    write(
        &checkout.path().join("containers/kilo/Dockerfile"),
        "FROM test-cabinet/base:latest\nRUN b\n",
    );
    let second = Ingestor::new(checkout.path(), &store)
        .ingest_container("kilo", false)
        .unwrap();
    assert!(second.ingested);
    assert_ne!(first.content_hash, second.content_hash);
}

#[test]
fn container_scan_restriction_only_touches_requested_harness() {
    let dir = TempDir::new().unwrap();
    write(
        &dir.path().join("containers/base/Dockerfile"),
        "FROM debian\n",
    );
    write(
        &dir.path().join("containers/claude/Dockerfile"),
        "FROM test-cabinet/base:latest\n",
    );
    let store_dir = TempDir::new().unwrap();
    let store = DefinitionStore::open(store_dir.path()).unwrap();

    let report = Ingestor::new(dir.path(), &store)
        .scan(&IngestRequest {
            test_cases: Some(vec![]), // skip test cases (none, and no browser)
            containers: Some(vec!["claude".to_string()]),
            force: false,
        })
        .unwrap();
    assert_eq!(report.container_definitions.len(), 1);
    assert_eq!(report.container_definitions[0].harness, "claude");
    assert!(report.test_case_versions.is_empty());
}
