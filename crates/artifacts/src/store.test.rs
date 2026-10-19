//! Tests for the run-tree store over a store held in memory: the generation
//! layout and the pointer written last, the atomic replace, the refusals that
//! leave the previous tree in place, the delete and the listing, and the two
//! archive walks.

use std::io::Cursor;

use bytes::Bytes;

use super::testing::{NO_LIMIT, chunked, memory_store, read_file, seed, tar_of};
use super::*;
use crate::object::body_from_bytes;

/// The keys under run `id`'s generations.
fn generation_keys(objects: &MemoryStore, id: &str) -> Vec<String> {
    objects
        .keys()
        .into_iter()
        .filter(|key| key.starts_with(&format!("{id}/g/")))
        .collect()
}

/// The distinct generations run `id` holds objects under.
fn generations(objects: &MemoryStore, id: &str) -> Vec<String> {
    let mut found: Vec<String> = generation_keys(objects, id)
        .into_iter()
        .filter_map(|key| {
            key.strip_prefix(&format!("{id}/g/"))
                .and_then(|rest| rest.split_once('/'))
                .map(|(generation, _)| generation.to_string())
        })
        .collect();
    found.dedup();
    found
}

#[tokio::test]
async fn store_run_writes_the_files_under_a_generation_and_the_pointer_beside_them() {
    let (store, objects) = memory_store();
    seed(
        &store,
        "abc",
        &[
            ("run-record.json", b"{\"id\":\"abc\"}"),
            ("implementation/dist/index.html", b"<html></html>"),
        ],
    )
    .await;

    let generation = generations(&objects, "abc");
    assert_eq!(generation.len(), 1, "one generation: {:?}", objects.keys());
    let generation = &generation[0];
    assert_eq!(
        objects.keys(),
        vec![
            "abc/current".to_string(),
            format!("abc/g/{generation}/implementation/dist/index.html"),
            format!("abc/g/{generation}/run-record.json"),
        ]
    );

    let tree = store.run_tree("abc").await.expect("the tree");
    assert_eq!(
        read_file(&tree, "run-record.json").await.as_deref(),
        Some(&b"{\"id\":\"abc\"}"[..])
    );
    assert_eq!(
        read_file(&tree, "implementation/dist/index.html")
            .await
            .as_deref(),
        Some(&b"<html></html>"[..])
    );
}

#[tokio::test]
async fn a_large_file_arriving_in_many_chunks_is_stored_whole() {
    // The driver streams its upload, so the body arrives in frames that cut across
    // tar blocks and files. The pipeline reassembles each file in order.
    let (store, _objects) = memory_store();
    let big: Vec<u8> = (0..300_000u32).map(|i| (i % 251) as u8).collect();
    let archive = tar_of(&[
        ("implementation/a.bin", &big),
        ("implementation/b.txt", b"small"),
    ]);
    let stored = store
        .store_run("big", chunked(archive.clone(), 97), NO_LIMIT)
        .await
        .expect("stored");
    assert_eq!(stored.files, 2);
    assert_eq!(stored.bytes, archive.len() as u64);

    let tree = store.run_tree("big").await.unwrap();
    assert_eq!(read_file(&tree, "implementation/a.bin").await, Some(big));
    assert_eq!(
        read_file(&tree, "implementation/b.txt").await.as_deref(),
        Some(&b"small"[..])
    );
}

#[tokio::test]
async fn store_run_replaces_a_prior_tree_and_deletes_its_generation() {
    let (store, objects) = memory_store();
    seed(&store, "r1", &[("old.txt", b"old")]).await;
    let first = generations(&objects, "r1");
    seed(&store, "r1", &[("new.txt", b"new")]).await;

    let tree = store.run_tree("r1").await.unwrap();
    assert_eq!(
        read_file(&tree, "old.txt").await,
        None,
        "the prior tree is gone"
    );
    assert_eq!(
        read_file(&tree, "new.txt").await.as_deref(),
        Some(&b"new"[..])
    );
    let second = generations(&objects, "r1");
    assert_eq!(second.len(), 1, "only the current generation is left");
    assert_ne!(first, second, "the replace wrote a fresh generation");
}

/// A `tar` whose one entry is named `name` verbatim, which `tar::Builder` refuses
/// to write for a `..` path: exactly what a hostile uploader could frame.
fn raw_tar_entry(name: &[u8], payload: &[u8]) -> Vec<u8> {
    let mut header = tar::Header::new_gnu();
    let field = &mut header.as_gnu_mut().unwrap().name;
    field[..name.len()].copy_from_slice(name);
    header.set_size(payload.len() as u64);
    header.set_entry_type(tar::EntryType::Regular);
    header.set_cksum();
    let mut archive = Vec::new();
    archive.extend_from_slice(header.as_bytes());
    archive.extend_from_slice(payload);
    archive.resize(archive.len().div_ceil(512) * 512, 0);
    archive.extend_from_slice(&[0u8; 1024]);
    archive
}

/// Assert run `id` still serves `old.txt` as `old`, from its one generation.
async fn assert_old_tree_intact(store: &ArtifactStore, objects: &MemoryStore, id: &str) {
    let tree = store
        .run_tree(id)
        .await
        .expect("the old tree is still current");
    assert_eq!(
        read_file(&tree, "old.txt").await.as_deref(),
        Some(&b"old"[..]),
        "the previous tree still serves"
    );
    assert_eq!(
        generations(objects, id).len(),
        1,
        "the refused upload left no generation behind: {:?}",
        objects.keys()
    );
}

#[tokio::test]
async fn a_traversal_entry_is_refused_and_leaves_the_previous_tree() {
    let (store, objects) = memory_store();
    seed(&store, "r1", &[("old.txt", b"old")]).await;

    for name in [&b"../escape.txt\0"[..], b"/etc/passwd\0", b"a/../../b\0"] {
        let err = store
            .store_run(
                "r1",
                body_from_bytes(raw_tar_entry(name, b"pwned")),
                NO_LIMIT,
            )
            .await
            .expect_err("a traversal entry must be refused");
        assert!(matches!(err, StoreError::Traversal(_)), "got {err:?}");
    }
    assert!(
        objects.keys().iter().all(|key| key.starts_with("r1/")),
        "nothing was written outside the run: {:?}",
        objects.keys()
    );
    assert_old_tree_intact(&store, &objects, "r1").await;
}

#[tokio::test]
async fn an_upload_over_the_limit_is_refused_and_leaves_the_previous_tree() {
    let (store, objects) = memory_store();
    seed(&store, "r1", &[("old.txt", b"old")]).await;

    let archive = tar_of(&[("new.txt", &[7u8; 64 * 1024])]);
    let err = store
        .store_run("r1", chunked(archive, 16), 16 * 1024)
        .await
        .expect_err("over the limit");
    assert!(matches!(err, StoreError::TooLarge(16384)), "got {err:?}");
    assert_old_tree_intact(&store, &objects, "r1").await;
}

#[tokio::test]
async fn an_endless_body_is_cut_off_at_the_limit() {
    // The limit has to bite while reading, not once the body has been read: an
    // endless body can only end by the limit firing.
    use futures_util::StreamExt as _;
    let (store, _objects) = memory_store();
    // One header block claiming a gigabyte, then a body that never ends.
    let mut header = tar::Header::new_gnu();
    header.set_path("a.bin").unwrap();
    header.set_size(1 << 30);
    header.set_mode(0o644);
    header.set_cksum();
    let head = Bytes::copy_from_slice(header.as_bytes());
    let endless = futures_util::stream::iter(std::iter::once(Ok(head))).chain(
        futures_util::stream::repeat_with(|| Ok(Bytes::from(vec![0u8; 4096]))),
    );
    let err = store
        .store_run("r1", Box::pin(endless), 64 * 1024)
        .await
        .expect_err("cut off");
    assert!(matches!(err, StoreError::TooLarge(_)), "got {err:?}");
}

#[tokio::test]
async fn a_body_that_fails_is_refused_as_the_upload_body() {
    let (store, objects) = memory_store();
    seed(&store, "r1", &[("old.txt", b"old")]).await;
    let mut archive = tar_of(&[("new.txt", &[1u8; 4096])]);
    archive.truncate(1024);
    let body = futures_util::stream::iter(vec![
        Ok(Bytes::from(archive)),
        Err(std::io::Error::new(
            std::io::ErrorKind::ConnectionReset,
            "the driver went away",
        )),
    ]);
    let err = store
        .store_run("r1", Box::pin(body), NO_LIMIT)
        .await
        .expect_err("failed body");
    assert!(matches!(err, StoreError::UploadBody(_)), "got {err:?}");
    assert_old_tree_intact(&store, &objects, "r1").await;
}

#[tokio::test]
async fn unusable_archives_are_refused_and_leave_the_previous_tree() {
    let (store, objects) = memory_store();
    seed(&store, "r1", &[("old.txt", b"old")]).await;

    let mut truncated = tar_of(&[("new.txt", &[3u8; 4096])]);
    truncated.truncate(1024);
    let duplicate = tar_of(&[("new.txt", b"one"), ("new.txt", b"two")]);
    let mut garbage = vec![0xffu8; 512];
    garbage.extend_from_slice(&[0u8; 1024]);
    for (what, archive) in [
        ("an empty body", Vec::new()),
        ("an archive with no files", tar_of(&[])),
        ("a truncated archive", truncated),
        ("a path that appears twice", duplicate),
        ("bytes that are not a tar", garbage),
    ] {
        let err = store
            .store_run("r1", body_from_bytes(archive), NO_LIMIT)
            .await
            .expect_err(what);
        assert!(matches!(err, StoreError::Archive(_)), "{what}: got {err:?}");
    }
    assert_old_tree_intact(&store, &objects, "r1").await;
}

#[tokio::test]
async fn a_store_failure_part_way_leaves_the_previous_tree() {
    let (store, objects) = memory_store();
    seed(&store, "r1", &[("old.txt", b"old")]).await;

    objects.fail_writes_ending_with(Some("b.bin"));
    let err = store
        .store_run(
            "r1",
            body_from_bytes(tar_of(&[("a.bin", b"a"), ("b.bin", b"b"), ("c.bin", b"c")])),
            NO_LIMIT,
        )
        .await
        .expect_err("the store failed a write");
    assert!(matches!(err, StoreError::Backend(_)), "got {err:?}");
    objects.fail_writes_ending_with(None);
    assert_old_tree_intact(&store, &objects, "r1").await;
}

#[tokio::test]
async fn a_pointer_that_fails_to_write_leaves_the_previous_tree() {
    // Every file of the new tree is stored, and the swap itself fails: the pointer
    // is what makes a tree current, so the old one still is.
    let (store, objects) = memory_store();
    seed(&store, "r1", &[("old.txt", b"old")]).await;

    objects.fail_writes_ending_with(Some("/current"));
    let err = store
        .store_run(
            "r1",
            body_from_bytes(tar_of(&[("new.txt", b"new")])),
            NO_LIMIT,
        )
        .await
        .expect_err("the pointer write failed");
    assert!(matches!(err, StoreError::Backend(_)), "got {err:?}");
    objects.fail_writes_ending_with(None);
    assert_old_tree_intact(&store, &objects, "r1").await;
}

#[tokio::test]
async fn directories_and_links_are_not_stored() {
    // An object store has no directories, and a link names no bytes of the tree.
    let (store, objects) = memory_store();
    let mut builder = tar::Builder::new(Vec::new());
    let mut dir = tar::Header::new_gnu();
    dir.set_entry_type(tar::EntryType::Directory);
    dir.set_size(0);
    dir.set_mode(0o755);
    builder
        .append_data(&mut dir, "implementation/", std::io::empty())
        .unwrap();
    let mut link = tar::Header::new_gnu();
    link.set_entry_type(tar::EntryType::Symlink);
    link.set_size(0);
    builder
        .append_link(&mut link, "implementation/link", "/etc/passwd")
        .unwrap();
    let mut file = tar::Header::new_gnu();
    file.set_size(2);
    file.set_mode(0o644);
    builder
        .append_data(&mut file, "implementation/file.txt", &b"hi"[..])
        .unwrap();
    store
        .store_run(
            "r1",
            body_from_bytes(builder.into_inner().unwrap()),
            NO_LIMIT,
        )
        .await
        .expect("stored");

    let stored: Vec<String> = generation_keys(&objects, "r1")
        .into_iter()
        .map(|key| key.rsplit_once('/').unwrap().1.to_string())
        .collect();
    assert_eq!(stored, vec!["file.txt".to_string()]);
}

#[tokio::test]
async fn delete_run_removes_every_object_of_the_run_and_is_idempotent() {
    let (store, objects) = memory_store();
    seed(&store, "r1", &[("run-record.json", b"{}")]).await;
    seed(&store, "r2", &[("run-record.json", b"{}")]).await;
    // A generation an abandoned upload left behind goes with the run too.
    objects
        .put("r1/g/abandoned/x.txt", body_from_bytes("x"), "text/plain")
        .await
        .unwrap();

    store.delete_run("r1").await.unwrap();
    assert!(
        objects.keys().iter().all(|key| !key.starts_with("r1/")),
        "every object of the run is gone: {:?}",
        objects.keys()
    );
    assert!(matches!(
        store.run_tree("r1").await,
        Err(StoreError::NotFound(_))
    ));
    // Deleting a run with no tree is a no-op, not an error.
    store.delete_run("r1").await.unwrap();
    assert!(
        store.run_tree("r2").await.is_ok(),
        "an unrelated run is untouched"
    );
}

#[tokio::test]
async fn an_unsafe_id_is_refused_everywhere() {
    let (store, objects) = memory_store();
    seed(&store, "r1", &[("run-record.json", b"{}")]).await;
    let before = objects.keys();

    for bad in ["..", ".", "", "a/b", "../escape", "a\\b"] {
        assert!(
            matches!(store.delete_run(bad).await, Err(StoreError::Traversal(_))),
            "delete of {bad:?} must be refused"
        );
        assert!(
            matches!(store.run_tree(bad).await, Err(StoreError::Traversal(_))),
            "a read of {bad:?} must be refused, so a route can still answer 400"
        );
        assert!(
            matches!(
                store
                    .store_run(bad, body_from_bytes(tar_of(&[("a", b"a")])), NO_LIMIT)
                    .await,
                Err(StoreError::Traversal(_))
            ),
            "an upload to {bad:?} must be refused"
        );
    }
    assert_eq!(objects.keys(), before, "nothing was written or deleted");
}

#[tokio::test]
async fn run_tree_is_not_found_for_an_unstored_run() {
    // The two archive routes stream, so the HTTP layer learns "unknown run" before
    // it commits a status code, from this.
    let (store, _objects) = memory_store();
    assert!(matches!(
        store.run_tree("gone").await,
        Err(StoreError::NotFound(_))
    ));
}

#[tokio::test]
async fn a_corrupt_pointer_is_an_error_not_a_tree() {
    let (store, objects) = memory_store();
    objects
        .put("r1/current", body_from_bytes("../other"), "text/plain")
        .await
        .unwrap();
    assert!(matches!(
        store.run_tree("r1").await,
        Err(StoreError::CorruptPointer(_))
    ));
}

#[tokio::test]
async fn reads_through_a_tree_cannot_leave_it() {
    let (store, objects) = memory_store();
    seed(&store, "r1", &[("implementation/a.txt", b"a")]).await;
    seed(&store, "r2", &[("secret.txt", b"secret")]).await;
    // An object beside the generation, in the run's own namespace.
    objects
        .put("r1/g/other/secret.txt", body_from_bytes("x"), "text/plain")
        .await
        .unwrap();

    let tree = store.run_tree("r1").await.unwrap();
    for path in [
        "../other/secret.txt",
        "implementation/../../other/secret.txt",
        "../../../r2/current",
        "",
        "/",
    ] {
        assert!(
            tree.get(path).await.unwrap().is_none(),
            "`{path}` must name nothing"
        );
    }
    // Empty and `.` segments are skipped, so a leading slash stays inside.
    assert_eq!(
        read_file(&tree, "/implementation/./a.txt").await.as_deref(),
        Some(&b"a"[..])
    );
}

#[tokio::test]
async fn a_tree_lists_its_files_and_subdirectories() {
    let (store, _objects) = memory_store();
    seed(
        &store,
        "r1",
        &[
            ("run-record.json", b"{}"),
            ("implementation/dist/index.html", b"<html>"),
            ("implementation/dist/assets/app.js", b"js"),
            ("implementation/src/main.ts", b"ts"),
            ("implementation/top.txt", b"top"),
        ],
    )
    .await;
    let tree = store.run_tree("r1").await.unwrap();

    let mut dirs = tree.subdirectories("implementation").await.unwrap();
    dirs.sort();
    assert_eq!(dirs, vec!["dist".to_string(), "src".to_string()]);

    let listed: Vec<(String, u64)> = tree
        .list("implementation/dist")
        .await
        .unwrap()
        .into_iter()
        .map(|object| (object.path, object.size))
        .collect();
    assert_eq!(
        listed,
        vec![
            ("implementation/dist/assets/app.js".to_string(), 2),
            ("implementation/dist/index.html".to_string(), 6),
        ]
    );
    assert_eq!(tree.list("").await.unwrap().len(), 5);
    assert!(tree.list("../").await.unwrap().is_empty());
}

#[tokio::test]
async fn list_runs_reports_each_tree_with_its_pointer_time() {
    let (store, objects) = memory_store();
    let before = OffsetDateTime::now_utc();
    seed(&store, "abc", &[("run-record.json", b"{}")]).await;
    seed(&store, "def", &[("run-record.json", b"{}")]).await;
    let after = OffsetDateTime::now_utc();
    // An upload in flight: its generation is written and its pointer is not. It
    // must not be reported, or the sweep could take it for an orphan.
    objects
        .put(
            "ghi/g/inflight/run-record.json",
            body_from_bytes("{}"),
            "application/json",
        )
        .await
        .unwrap();

    let mut listed = store.list_runs().await.unwrap();
    listed.sort_by(|a, b| a.id.cmp(&b.id));
    let ids: Vec<&str> = listed.iter().map(|tree| tree.id.as_str()).collect();
    assert_eq!(ids, vec!["abc", "def"]);
    for tree in &listed {
        let pointer = objects
            .head(&format!("{}/current", tree.id))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(Some(tree.modified), pointer.last_modified);
        assert!(
            tree.modified >= before && tree.modified <= after,
            "tree `{}` reports a time outside its upload",
            tree.id
        );
    }

    // A replace moves the reported time on to the new upload.
    let first = listed[0].modified;
    seed(&store, "abc", &[("run-record.json", b"{}")]).await;
    let relisted = store.list_runs().await.unwrap();
    let abc = relisted.iter().find(|tree| tree.id == "abc").unwrap();
    assert!(abc.modified >= first);
}

#[tokio::test]
async fn list_runs_is_empty_for_an_empty_store() {
    let (store, _objects) = memory_store();
    assert!(store.list_runs().await.unwrap().is_empty());
}

/// Build run `id`'s `shape` archive into a buffer, as the routes do into a body.
async fn archive_of(
    store: &ArtifactStore,
    id: &str,
    shape: ArchiveShape,
) -> Result<Vec<u8>, StoreError> {
    let tree = store.run_tree(id).await?;
    let feed = start_archive(tree, shape);
    tokio::task::spawn_blocking(move || {
        let mut out = Vec::new();
        write_archive(feed, &mut out).map(|()| out)
    })
    .await
    .expect("the archive task")
}

/// Untar `archive` into a `(path, contents)` map.
fn untar_to_map(archive: &[u8]) -> std::collections::BTreeMap<String, Vec<u8>> {
    let mut out = std::collections::BTreeMap::new();
    let mut reader = tar::Archive::new(Cursor::new(archive));
    for entry in reader.entries().unwrap() {
        let mut entry = entry.unwrap();
        let path = entry.path().unwrap().display().to_string();
        let mut contents = Vec::new();
        std::io::copy(&mut entry, &mut contents).unwrap();
        out.insert(path, contents);
    }
    out
}

/// Gunzip then untar `archive`, which also asserts the framing is real gzip.
fn ungzip_untar_to_map(archive: &[u8]) -> std::collections::BTreeMap<String, Vec<u8>> {
    let mut decoded = Vec::new();
    let mut decoder = flate2::read::GzDecoder::new(Cursor::new(archive));
    std::io::copy(&mut decoder, &mut decoded).expect("archive is gzip-framed");
    untar_to_map(&decoded)
}

#[tokio::test]
async fn the_source_archive_carries_the_implementation_tree_record_and_events() {
    let (store, _objects) = memory_store();
    seed(
        &store,
        "abc",
        &[
            ("run-record.json", b"{\"id\":\"abc\"}"),
            ("events.jsonl", b"{\"kind\":\"start\"}\n"),
            ("raw.jsonl", b"{\"raw\":true}\n"),
            ("proof/gameplay.webm", b"webm"),
            ("implementation/src/main.ts", b"console.log(1)"),
            // Both the generated source and the built output ride along — the
            // publisher gits the source and deploys the build.
            ("implementation/dist/index.html", b"<html></html>"),
        ],
    )
    .await;

    let entries = untar_to_map(
        &archive_of(&store, "abc", ArchiveShape::Source)
            .await
            .unwrap(),
    );
    assert_eq!(
        entries.keys().cloned().collect::<Vec<_>>(),
        vec![
            "events.jsonl".to_string(),
            "implementation/dist/index.html".to_string(),
            "implementation/src/main.ts".to_string(),
            "run-record.json".to_string(),
        ],
        "the publisher's subset, at the layout the driver uploaded"
    );
    assert_eq!(
        entries.get("run-record.json").map(Vec::as_slice),
        Some(&b"{\"id\":\"abc\"}"[..])
    );
    assert_eq!(
        entries.get("implementation/src/main.ts").map(Vec::as_slice),
        Some(&b"console.log(1)"[..])
    );
}

#[tokio::test]
async fn the_source_archive_omits_absent_optional_files() {
    let (store, _objects) = memory_store();
    seed(&store, "bare", &[("implementation/src/main.ts", b"x")]).await;
    let entries = untar_to_map(
        &archive_of(&store, "bare", ArchiveShape::Source)
            .await
            .unwrap(),
    );
    assert_eq!(
        entries.keys().cloned().collect::<Vec<_>>(),
        vec!["implementation/src/main.ts".to_string()]
    );
}

#[tokio::test]
async fn the_whole_archive_carries_the_tree_under_an_id_prefix() {
    let (store, _objects) = memory_store();
    let big: Vec<u8> = (0..200_000u32).map(|i| (i % 253) as u8).collect();
    seed(
        &store,
        "abc",
        &[
            ("run-record.json", b"{\"id\":\"abc\"}"),
            ("events.jsonl", b"{\"kind\":\"start\"}\n"),
            // `raw.jsonl` and the media beside `implementation/` are exactly what the
            // source archive drops and a downloading reviewer wants most.
            ("raw.jsonl", b"{\"raw\":true}\n"),
            ("proof/gameplay.webm", &big),
            ("implementation/src/main.ts", b"console.log(1)"),
            ("implementation/dist/index.html", b"<html></html>"),
        ],
    )
    .await;

    let entries = ungzip_untar_to_map(
        &archive_of(&store, "abc", ArchiveShape::Whole)
            .await
            .unwrap(),
    );
    assert_eq!(entries.len(), 6);
    for path in entries.keys() {
        assert!(
            path.starts_with("abc/"),
            "entry `{path}` is not under the run-id prefix"
        );
    }
    assert_eq!(
        entries.get("abc/raw.jsonl").map(Vec::as_slice),
        Some(&b"{\"raw\":true}\n"[..])
    );
    assert_eq!(
        entries.get("abc/proof/gameplay.webm"),
        Some(&big),
        "an object read in many chunks arrives whole"
    );
}

#[tokio::test]
async fn a_long_path_survives_the_archive() {
    // A ustar name holds 100 bytes; the builder carries a longer one in a GNU long
    // name entry, which the reader turns back into the path.
    let (store, _objects) = memory_store();
    let long = format!("implementation/{}/file.txt", "d".repeat(150));
    seed(&store, "long", &[(long.as_str(), b"deep")]).await;
    let entries = untar_to_map(
        &archive_of(&store, "long", ArchiveShape::Source)
            .await
            .unwrap(),
    );
    assert_eq!(entries.get(&long).map(Vec::as_slice), Some(&b"deep"[..]));
}

/// A sink that accepts `budget` bytes and then fails, standing in for a client that
/// hung up part-way through its download.
struct HungUpSink {
    budget: usize,
    written: usize,
}

impl std::io::Write for HungUpSink {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if self.written >= self.budget {
            return Err(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "the archive download was closed by the client",
            ));
        }
        self.written += buf.len();
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[tokio::test]
async fn a_sink_that_fails_aborts_the_walk_rather_than_finishing_it() {
    // The walk proceeds at the client's pace, so a client that goes away has to stop
    // it, not merely have its bytes thrown away: a reviewer cancelling a download
    // must not leave the service reading the rest of a large tree for nobody.
    let (store, _objects) = memory_store();
    let big = vec![b'x'; 128 * 1024];
    seed(
        &store,
        "abc",
        &[
            ("implementation/a.bin", &big),
            ("implementation/b.bin", &big),
            ("implementation/c.bin", &big),
        ],
    )
    .await;

    let tree = store.run_tree("abc").await.unwrap();
    let feed = start_archive(tree, ArchiveShape::Source);
    let (result, written) = tokio::task::spawn_blocking(move || {
        let mut sink = HungUpSink {
            budget: 4096,
            written: 0,
        };
        (write_archive(feed, &mut sink), sink.written)
    })
    .await
    .unwrap();
    let err = result.expect_err("a failing sink must surface, not be swallowed");
    assert!(matches!(err, StoreError::Body(_)), "got {err:?}");
    assert!(
        written < big.len(),
        "the walk stopped at the failure rather than reading the whole tree, wrote {written}"
    );
}
