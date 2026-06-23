//! Tests for the local-filesystem artifact store: an uploaded tarball round-trips
//! onto disk under the run root, and a traversal entry is refused.

use std::io::Cursor;

use tempfile::TempDir;

use super::*;

/// Build a `tar` archive in memory from a list of `(path, contents)` entries.
fn tar_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut builder = tar::Builder::new(Vec::new());
    for (path, contents) in entries {
        let mut header = tar::Header::new_gnu();
        header.set_size(contents.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        builder
            .append_data(&mut header, path, *contents)
            .expect("append entry");
    }
    builder.into_inner().expect("finish tar")
}

#[test]
fn store_run_unpacks_tree_under_run_root() {
    let root = TempDir::new().unwrap();
    let store = LocalFsStore::new(root.path()).unwrap();

    let archive = tar_of(&[
        ("run-record.json", b"{\"id\":\"abc\"}"),
        ("implementation/dist/index.html", b"<html></html>"),
    ]);
    store
        .store_run("abc", &mut Cursor::new(archive))
        .expect("store");

    let run_dir = store.run_dir("abc");
    assert_eq!(
        std::fs::read_to_string(run_dir.join("run-record.json")).unwrap(),
        "{\"id\":\"abc\"}"
    );
    assert_eq!(
        std::fs::read_to_string(run_dir.join("implementation/dist/index.html")).unwrap(),
        "<html></html>"
    );
    assert_eq!(
        impl_dir(&store, "abc"),
        run_dir.join("implementation"),
        "impl_dir resolves to the run's implementation tree"
    );
}

#[test]
fn store_run_replaces_a_prior_tree() {
    let root = TempDir::new().unwrap();
    let store = LocalFsStore::new(root.path()).unwrap();

    store
        .store_run("r1", &mut Cursor::new(tar_of(&[("old.txt", b"old")])))
        .unwrap();
    store
        .store_run("r1", &mut Cursor::new(tar_of(&[("new.txt", b"new")])))
        .unwrap();

    let run_dir = store.run_dir("r1");
    assert!(!run_dir.join("old.txt").exists(), "the prior tree is gone");
    assert_eq!(
        std::fs::read_to_string(run_dir.join("new.txt")).unwrap(),
        "new"
    );
}

#[test]
fn safe_join_keeps_normal_entries_inside_the_base() {
    let base = Path::new("/store/run-1");
    assert_eq!(
        safe_join(base, Path::new("implementation/dist/index.html")),
        Some(PathBuf::from("/store/run-1/implementation/dist/index.html"))
    );
    // A leading `./` is harmless and stripped.
    assert_eq!(
        safe_join(base, Path::new("./run-record.json")),
        Some(PathBuf::from("/store/run-1/run-record.json"))
    );
}

#[test]
fn safe_join_refuses_traversal_and_absolute_entries() {
    let base = Path::new("/store/run-1");
    // A `..` component would climb out of the run directory.
    assert_eq!(safe_join(base, Path::new("../escape.txt")), None);
    assert_eq!(
        safe_join(base, Path::new("implementation/../../escape.txt")),
        None
    );
    // An absolute entry would ignore the base entirely.
    assert_eq!(safe_join(base, Path::new("/etc/passwd")), None);
}

#[test]
fn store_run_refuses_a_traversal_entry() {
    let root = TempDir::new().unwrap();
    let store = LocalFsStore::new(root.path()).unwrap();

    // `tar::Builder` refuses to *write* a `..` path, so craft the malicious entry
    // by hand: a header whose name field carries `../escape.txt` directly, exactly
    // what a hostile uploader could frame. The store must reject it on unpack.
    let payload = b"pwned";
    let mut header = tar::Header::new_gnu();
    header
        .as_gnu_mut()
        .unwrap()
        .name
        .get_mut(..14)
        .unwrap()
        .copy_from_slice(b"../escape.txt\0");
    header.set_size(payload.len() as u64);
    header.set_entry_type(tar::EntryType::Regular);
    header.set_cksum();
    let mut archive = Vec::new();
    archive.extend_from_slice(header.as_bytes());
    archive.extend_from_slice(payload);
    archive.resize(archive.len().div_ceil(512) * 512, 0); // pad the data block
    archive.extend_from_slice(&[0u8; 1024]); // two zero blocks end the archive

    let err = store
        .store_run("r1", &mut Cursor::new(archive))
        .expect_err("a `..` entry must be rejected");
    assert!(matches!(err, StoreError::Traversal(_)), "got {err:?}");

    // Nothing escaped the store root.
    assert!(
        !root.path().join("escape.txt").exists(),
        "the traversal entry was not written outside the run root"
    );
}
