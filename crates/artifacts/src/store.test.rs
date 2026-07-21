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
fn delete_run_removes_the_tree_and_is_idempotent() {
    let root = TempDir::new().unwrap();
    let store = LocalFsStore::new(root.path()).unwrap();

    store
        .store_run(
            "r1",
            &mut Cursor::new(tar_of(&[("run-record.json", b"{}")])),
        )
        .unwrap();
    // A second run's tree must survive the delete of the first.
    store
        .store_run(
            "r2",
            &mut Cursor::new(tar_of(&[("run-record.json", b"{}")])),
        )
        .unwrap();

    store.delete_run("r1").unwrap();
    assert!(!store.run_dir("r1").exists(), "the run's tree is gone");
    // Deleting a run with no tree is a no-op, not an error.
    store.delete_run("r1").unwrap();
    assert!(
        store.run_dir("r2").exists(),
        "an unrelated run is untouched"
    );
}

#[test]
fn delete_run_refuses_an_unsafe_id() {
    let root = TempDir::new().unwrap();
    let store = LocalFsStore::new(root.path()).unwrap();
    // A canary directory beside the store root must survive a traversal attempt.
    let sibling = root.path().parent().unwrap().join("delete-run-canary");
    std::fs::create_dir_all(&sibling).unwrap();

    for bad in ["..", ".", "", "a/b", "../escape"] {
        assert!(
            matches!(store.delete_run(bad), Err(StoreError::Traversal(_))),
            "id {bad:?} must be refused as traversal"
        );
    }
    assert!(sibling.exists(), "no traversal escaped the store root");
    std::fs::remove_dir_all(&sibling).ok();
}

/// Untar `archive` into a `(path, contents)` map for asserting on a built tree.
fn untar_to_map(archive: &[u8]) -> std::collections::BTreeMap<String, Vec<u8>> {
    let mut out = std::collections::BTreeMap::new();
    let mut reader = tar::Archive::new(Cursor::new(archive));
    for entry in reader.entries().unwrap() {
        let mut entry = entry.unwrap();
        if entry.header().entry_type().is_dir() {
            continue;
        }
        let path = entry.path().unwrap().display().to_string();
        let mut contents = Vec::new();
        std::io::copy(&mut entry, &mut contents).unwrap();
        out.insert(path, contents);
    }
    out
}

#[test]
fn read_run_tree_archives_the_implementation_tree_record_and_events() {
    let root = TempDir::new().unwrap();
    let store = LocalFsStore::new(root.path()).unwrap();

    store
        .store_run(
            "abc",
            &mut Cursor::new(tar_of(&[
                ("run-record.json", b"{\"id\":\"abc\"}"),
                ("events.jsonl", b"{\"kind\":\"start\"}\n"),
                ("implementation/src/main.ts", b"console.log(1)"),
                // Both the generated source and the built output ride along — the
                // publisher gits the source and deploys the build.
                ("implementation/dist/index.html", b"<html></html>"),
            ])),
        )
        .unwrap();

    let archive = store.read_run_tree("abc").expect("read tree");
    let entries = untar_to_map(&archive);

    assert_eq!(
        entries.get("run-record.json").map(Vec::as_slice),
        Some(&b"{\"id\":\"abc\"}"[..]),
        "the record rides along"
    );
    assert_eq!(
        entries.get("events.jsonl").map(Vec::as_slice),
        Some(&b"{\"kind\":\"start\"}\n"[..]),
        "the recorded events ride along"
    );
    assert_eq!(
        entries.get("implementation/src/main.ts").map(Vec::as_slice),
        Some(&b"console.log(1)"[..]),
        "the generated source is included under its `implementation/` prefix"
    );
    // The whole `implementation/` tree is archived as-is — the built output the
    // publisher deploys to Pages rides along beside the source it gits, and the
    // archive untars back to the same layout `store_run` unpacked.
    assert!(
        entries.contains_key("implementation/dist/index.html"),
        "the implementation tree round-trips whole"
    );
}

#[test]
fn read_run_tree_omits_absent_optional_files() {
    let root = TempDir::new().unwrap();
    let store = LocalFsStore::new(root.path()).unwrap();

    // A run with only a source tree — no record, no events — still tars cleanly.
    store
        .store_run(
            "bare",
            &mut Cursor::new(tar_of(&[("implementation/src/main.ts", b"x")])),
        )
        .unwrap();

    let entries = untar_to_map(&store.read_run_tree("bare").unwrap());
    assert!(entries.contains_key("implementation/src/main.ts"));
    assert!(!entries.contains_key("run-record.json"));
    assert!(!entries.contains_key("events.jsonl"));
}

#[test]
fn read_run_tree_is_not_found_for_an_unstored_run() {
    let root = TempDir::new().unwrap();
    let store = LocalFsStore::new(root.path()).unwrap();
    assert!(
        matches!(store.read_run_tree("nope"), Err(StoreError::NotFound(_))),
        "an unstored run reads as NotFound, not an I/O fault"
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

/// Gunzip then untar `archive` into a `(path, contents)` map. The archive download
/// is gzip-framed (unlike `read_run_tree`'s plain tar), so asserting on it also
/// asserts the framing is real gzip.
fn ungzip_untar_to_map(archive: &[u8]) -> std::collections::BTreeMap<String, Vec<u8>> {
    let mut decoded = Vec::new();
    let mut decoder = flate2::read::GzDecoder::new(Cursor::new(archive));
    std::io::copy(&mut decoder, &mut decoded).expect("archive is gzip-framed");
    untar_to_map(&decoded)
}

#[test]
fn read_run_archive_carries_the_whole_run_root_under_an_id_prefix() {
    let root = TempDir::new().unwrap();
    let store = LocalFsStore::new(root.path()).unwrap();

    store
        .store_run(
            "abc",
            &mut Cursor::new(tar_of(&[
                ("run-record.json", b"{\"id\":\"abc\"}"),
                ("events.jsonl", b"{\"kind\":\"start\"}\n"),
                // `raw.jsonl` and the media beside `implementation/` are exactly what
                // `read_run_tree` drops and a downloading reviewer wants most.
                ("raw.jsonl", b"{\"raw\":true}\n"),
                ("proof/gameplay.webm", b"webm-bytes"),
                ("implementation/src/main.ts", b"console.log(1)"),
                ("implementation/dist/index.html", b"<html></html>"),
            ])),
        )
        .unwrap();

    let entries = ungzip_untar_to_map(&store.read_run_archive("abc").expect("read archive"));

    // Every entry is prefixed with the run id, so the archive unpacks into its own
    // directory rather than over the caller's working directory.
    for path in entries.keys() {
        assert!(
            path.starts_with("abc/"),
            "entry `{path}` is not under the run-id prefix"
        );
    }
    assert_eq!(
        entries.get("abc/raw.jsonl").map(Vec::as_slice),
        Some(&b"{\"raw\":true}\n"[..]),
        "the raw harness log rides along (unlike `read_run_tree`'s publisher subset)"
    );
    assert_eq!(
        entries.get("abc/proof/gameplay.webm").map(Vec::as_slice),
        Some(&b"webm-bytes"[..]),
        "media beside `implementation/` rides along"
    );
    assert_eq!(
        entries.get("abc/run-record.json").map(Vec::as_slice),
        Some(&b"{\"id\":\"abc\"}"[..])
    );
    assert!(entries.contains_key("abc/events.jsonl"));
    assert!(entries.contains_key("abc/implementation/src/main.ts"));
    assert!(entries.contains_key("abc/implementation/dist/index.html"));
}

#[test]
fn read_run_archive_is_not_found_for_an_unstored_run() {
    let root = TempDir::new().unwrap();
    let store = LocalFsStore::new(root.path()).unwrap();
    assert!(
        matches!(store.read_run_archive("nope"), Err(StoreError::NotFound(_))),
        "an unstored run reads as NotFound, not an I/O fault"
    );
}

#[test]
fn read_run_archive_refuses_an_unsafe_id() {
    let root = TempDir::new().unwrap();
    let store = LocalFsStore::new(root.path()).unwrap();
    // The archive walks a directory tree rather than going through the canonicalizing
    // core resolvers, so — as with `delete_run` — an id that is not a single safe
    // path segment must never reach the filesystem.
    for id in ["..", ".", "../other", "a/b"] {
        assert!(
            matches!(store.read_run_archive(id), Err(StoreError::Traversal(_))),
            "id `{id}` must be refused as a traversal"
        );
    }
}
