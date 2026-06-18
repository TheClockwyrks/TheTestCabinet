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
        })
        .unwrap();
    assert!(report.test_case_versions.is_empty());
}
