//! Tests for where a build takes a run's files from when its sources disagree
//! or say nothing: a store copy that is not the tree's, an empty file, a store
//! that holds no run at all, names only the bucket still has, two files bound
//! for one object, and objects uploaded as the build makes them.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use test_cabinet_core::MediaKind;

use super::tests::{
    answering_store, empty_store, manifest, now, proof, proof_run, run_document_json, stored_run,
    stub_artifacts,
};
use super::*;
use crate::db::{MediaFileKind, MediaManifest, MediaManifestFile};
use crate::publisher::tests::{Bucket, bucket_client};

/// The `GET /runs/{id}/media` body of a stored tree.
fn listing() -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "id": "r1",
        "stored": true,
        "validation": [],
        "showcase": [],
        "root": [],
    }))
    .unwrap()
}

/// The body of a run the service holds no tree for.
fn no_tree() -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "id": "r1",
        "stored": false,
        "validation": [],
        "showcase": [],
        "root": [],
    }))
    .unwrap()
}

fn files(entries: &[(&str, Vec<u8>)]) -> HashMap<String, Vec<u8>> {
    entries
        .iter()
        .map(|(path, bytes)| (path.to_string(), bytes.clone()))
        .collect()
}

fn keys(entries: &[&str]) -> HashSet<String> {
    entries.iter().map(|key| key.to_string()).collect()
}

fn image_proof_run() -> StoredRun {
    proof_run(
        "r1",
        vec![proof("title", "proof/title.png", MediaKind::Image, true)],
    )
}

/// Build as a backend that confirms media, against the artifact service at
/// `base`, with `existing` already in the bucket.
async fn confirming(
    run: StoredRun,
    store: DefinitionStore,
    base: String,
    existing: &[&str],
    recorded_absent: bool,
) -> Snapshot {
    let absent = if recorded_absent {
        keys(&["r1"])
    } else {
        HashSet::new()
    };
    SnapshotBuilder::new(vec![run], vec![manifest()], store)
        .with_artifacts(Some(base), reqwest::Client::new())
        .with_existing_media(keys(existing))
        .with_media_confirmation(HashSet::new())
        .with_recorded_tree_absence(absent)
        .build(now())
        .await
        .unwrap()
}

fn object<'a>(snapshot: &'a Snapshot, key: &str) -> Option<&'a SnapshotObject> {
    snapshot.objects.iter().find(|object| object.key == key)
}

fn manifest_of(snapshot: &Snapshot) -> &MediaManifest {
    &snapshot.media_manifests["r1"]
}

const TITLE_KEY: &str = "media/runs/r1/proof/title.png";

// --- A store copy checked against the tree's -----------------------------------

#[tokio::test]
async fn a_store_copy_shorter_than_the_tree_s_is_not_the_one_published() {
    // The upload of the still was cut off: the store holds its first bytes and
    // the tree holds all of it.
    let (_tmp, store) = empty_store();
    store.write_run_proof("r1", "title.png", b"png:ti").unwrap();
    let (base, _) = stub_artifacts(files(&[
        ("/runs/r1/media", listing()),
        ("/runs/r1/proof/title.png", b"png:title".to_vec()),
    ]))
    .await;

    let snapshot = confirming(image_proof_run(), store, base, &[], false).await;

    assert_eq!(object(&snapshot, TITLE_KEY).unwrap().bytes, b"png:title");
    assert!(snapshot.unconfirmed_media.is_empty());
}

#[tokio::test]
async fn a_store_copy_the_size_of_the_tree_s_is_published_without_fetching_it() {
    let (_tmp, store) = empty_store();
    store
        .write_run_proof("r1", "title.png", b"png:store")
        .unwrap();
    let (base, seen) = stub_artifacts(files(&[
        ("/runs/r1/media", listing()),
        ("/runs/r1/proof/title.png", b"png:trees".to_vec()),
    ]))
    .await;

    let snapshot = confirming(image_proof_run(), store, base, &[], false).await;

    assert_eq!(object(&snapshot, TITLE_KEY).unwrap().bytes, b"png:store");
    // The tree was asked how long its copy is, once, and not for the bytes.
    let asked = seen.lock().unwrap();
    assert_eq!(
        asked
            .iter()
            .filter(|path| *path == "/runs/r1/proof/title.png")
            .count(),
        1,
        "{asked:?}"
    );
}

#[tokio::test]
async fn a_store_copy_stands_when_the_tree_does_not_hold_the_file() {
    let (_tmp, store) = empty_store();
    store
        .write_run_proof("r1", "title.png", b"png:store")
        .unwrap();
    let (base, _) = stub_artifacts(files(&[("/runs/r1/media", listing())])).await;

    let snapshot = confirming(image_proof_run(), store, base, &[], false).await;

    assert_eq!(object(&snapshot, TITLE_KEY).unwrap().bytes, b"png:store");
    assert!(snapshot.unconfirmed_media.is_empty());
}

// --- An empty file ---------------------------------------------------------------

#[tokio::test]
async fn an_empty_file_in_the_store_is_no_copy_of_the_file() {
    // What a write cut off by a full volume left: the name, and no bytes.
    let (_tmp, store) = empty_store();
    store.write_run_proof("r1", "title.png", b"").unwrap();
    let (base, _) = stub_artifacts(files(&[
        ("/runs/r1/media", listing()),
        ("/runs/r1/proof/title.png", b"png:title".to_vec()),
    ]))
    .await;

    let snapshot = confirming(image_proof_run(), store, base, &[], false).await;

    assert_eq!(object(&snapshot, TITLE_KEY).unwrap().bytes, b"png:title");
    assert_eq!(
        manifest_of(&snapshot).file("proof/title.png"),
        Some(&MediaManifestFile::stored(
            MediaFileKind::Proof,
            "proof/title.png",
            TITLE_KEY
        ))
    );
}

#[tokio::test]
async fn an_empty_file_held_nowhere_else_is_never_published() {
    let (_tmp, store) = answering_store();
    store.write_run_proof("r1", "title.png", b"").unwrap();
    let (base, _) = stub_artifacts(files(&[("/runs/r1/media", listing())])).await;

    let snapshot = confirming(image_proof_run(), store, base, &[], false).await;

    assert!(object(&snapshot, TITLE_KEY).is_none());
    assert_eq!(
        manifest_of(&snapshot).file("proof/title.png"),
        Some(&MediaManifestFile::unrecoverable(
            MediaFileKind::Proof,
            "proof/title.png",
            None
        ))
    );
}

// --- A store that holds no run ----------------------------------------------------

#[tokio::test]
async fn a_store_holding_no_run_at_all_writes_no_file_off() {
    // A volume that did not mount, a new one, or the wrong path: every file of
    // every run is missing from it. The tree is gone too, on purpose. None of
    // that says the still was lost.
    let (_tmp, store) = empty_store();
    let (base, _) = stub_artifacts(files(&[("/runs/r1/media", no_tree())])).await;

    let snapshot = confirming(image_proof_run(), store, base, &[], true).await;

    assert_eq!(
        snapshot.unconfirmed_media.get("r1").map(Vec::as_slice),
        Some(["proof/title.png".to_string()].as_slice())
    );
    assert!(
        manifest_of(&snapshot).unrecoverable().next().is_none(),
        "{:?}",
        manifest_of(&snapshot)
    );
}

#[tokio::test]
async fn a_store_holding_other_runs_answers_for_the_one_it_lacks() {
    let (_tmp, store) = answering_store();
    let (base, _) = stub_artifacts(files(&[("/runs/r1/media", no_tree())])).await;

    let snapshot = confirming(image_proof_run(), store, base, &[], true).await;

    assert!(snapshot.unconfirmed_media.is_empty());
    assert_eq!(
        manifest_of(&snapshot).unrecoverable().collect::<Vec<_>>(),
        ["proof/title.png"]
    );
}

// --- Names only the bucket still has ----------------------------------------------

/// A run whose showcase names no file: its description has no image and its
/// carousel is empty.
fn bare_showcase_run() -> StoredRun {
    let mut run = stored_run("r1", "2026-06-17T21:40:00Z");
    run.record.showcase = Some(test_cabinet_core::RunShowcase {
        description: "# My Game".to_string(),
        media: Vec::new(),
    });
    run
}

#[tokio::test]
async fn a_showcase_file_only_the_bucket_names_stays_in_the_run() {
    // The folder and the tree are gone, and nothing on the record mentions the
    // file. The bucket's listing is the last place that names it.
    let (_tmp, store) = answering_store();
    let (base, _) = stub_artifacts(files(&[("/runs/r1/media", no_tree())])).await;
    let existing = [
        "media/runs/r1/showcase/extra.png",
        "media/runs/r1/showcase/clip.mp4",
        "media/runs/r1/original/showcase/clip.webm",
        // Another run's, and a nested key no showcase file has.
        "media/runs/r2/showcase/theirs.png",
        "media/runs/r1/showcase/nested/deep.png",
    ];

    let snapshot = confirming(bare_showcase_run(), store, base, &existing, true).await;

    assert!(
        snapshot.unconfirmed_media.is_empty(),
        "{:?}",
        snapshot.unconfirmed_media
    );
    let manifest = manifest_of(&snapshot);
    assert_eq!(
        manifest
            .file("showcase/extra.png")
            .and_then(|file| file.key.as_deref()),
        Some("media/runs/r1/showcase/extra.png")
    );
    // The mp4 is the transcode of the recording, not a file of its own.
    let clip = manifest.file("showcase/clip.webm").expect("the recording");
    assert_eq!(
        clip.keys().collect::<Vec<_>>(),
        [
            "media/runs/r1/original/showcase/clip.webm",
            "media/runs/r1/showcase/clip.mp4"
        ]
    );
    assert_eq!(manifest.file("showcase/clip.mp4"), None);
    assert_eq!(manifest.file("showcase/theirs.png"), None);
    let document = run_document_json(&snapshot, "r1");
    let published: Vec<&str> = document["showcaseMedia"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["file"].as_str().unwrap())
        .collect();
    assert!(published.contains(&"extra.png"), "{published:?}");
    assert!(published.contains(&"clip.webm"), "{published:?}");
    // Nothing is uploaded: every object is where it was.
    assert!(
        !snapshot
            .objects
            .iter()
            .any(|object| object.key.starts_with("media/runs/r1/")),
    );
}

// --- A video the store holds under its mp4's name --------------------------------

fn video_proof_run() -> StoredRun {
    proof_run(
        "r1",
        vec![proof("rally", "proof/rally.webm", MediaKind::Video, true)],
    )
}

const RALLY_MP4: &str = "media/runs/r1/proof/rally.mp4";

#[tokio::test]
async fn an_mp4_the_store_holds_is_the_file_the_bucket_s_mp4_is() {
    let (_tmp, store) = empty_store();
    store
        .write_run_proof("r1", "rally.mp4", b"mp4:rally")
        .unwrap();
    let (base, _) = stub_artifacts(files(&[("/runs/r1/media", listing())])).await;

    let snapshot = confirming(video_proof_run(), store, base, &[RALLY_MP4], false).await;

    assert!(snapshot.unconfirmed_media.is_empty());
    assert_eq!(
        manifest_of(&snapshot).files,
        [stored("proof/rally.mp4", RALLY_MP4)]
    );
}

#[tokio::test]
async fn an_empty_mp4_in_the_store_is_not_the_file_the_bucket_s_mp4_is() {
    // The name with no bytes says nothing was stored under it. The bucket's mp4
    // is then the transcode of a recording that is lost, and is recorded so.
    let (_tmp, store) = answering_store();
    store.write_run_proof("r1", "rally.mp4", b"").unwrap();
    let (base, _) = stub_artifacts(files(&[("/runs/r1/media", listing())])).await;

    let snapshot = confirming(video_proof_run(), store, base, &[RALLY_MP4], false).await;

    assert_eq!(
        manifest_of(&snapshot).files,
        [MediaManifestFile::unrecoverable(
            MediaFileKind::Proof,
            "proof/rally.webm",
            Some(RALLY_MP4.to_string())
        )]
    );
}

// --- Two files bound for one object -----------------------------------------------

fn stored(name: &str, key: &str) -> MediaManifestFile {
    MediaManifestFile::stored(MediaFileKind::Proof, name, key)
}

#[test]
fn a_key_is_contested_when_it_holds_one_file_and_is_also_another_s() {
    let recording = MediaManifestFile::transcoded(
        MediaFileKind::Proof,
        "proof/rally.webm",
        "media/runs/r1/original/proof/rally.webm",
        "media/runs/r1/proof/rally.mp4",
    );
    let own_mp4 = stored("proof/rally.mp4", "media/runs/r1/proof/rally.mp4");
    let still = stored("proof/title.png", "media/runs/r1/proof/title.png");

    assert_eq!(
        run_files::contested_keys(&[recording.clone(), own_mp4.clone(), still.clone()]),
        ["media/runs/r1/proof/rally.mp4"]
    );
    // One name entered twice is one file.
    assert!(run_files::contested_keys(&[still.clone(), still.clone()]).is_empty());
    // Files with keys of their own contest nothing, with or without a transcode.
    assert!(run_files::contested_keys(&[recording, still]).is_empty());
    // A file with no object contests nothing.
    let lost = MediaManifestFile::unrecoverable(MediaFileKind::Proof, "proof/rally.mp4", None);
    assert!(run_files::contested_keys(&[lost, own_mp4]).is_empty());
}

#[tokio::test]
async fn a_run_with_two_files_bound_for_one_object_is_left_unconfirmed() {
    // A recording whose transcode is published as `rally.mp4`, and a proof the
    // model itself wrote as `rally.mp4`. One object cannot be both.
    let (_tmp, store) = answering_store();
    let (base, _) = stub_artifacts(files(&[("/runs/r1/media", listing())])).await;
    let run = proof_run(
        "r1",
        vec![
            proof("rally", "proof/rally.webm", MediaKind::Video, true),
            proof("rally", "proof/rally.mp4", MediaKind::Video, true),
        ],
    );
    let existing = [
        "media/runs/r1/original/proof/rally.webm",
        "media/runs/r1/proof/rally.mp4",
    ];

    let snapshot = confirming(run, store, base, &existing, false).await;

    assert_eq!(
        snapshot.unconfirmed_media.get("r1").map(Vec::as_slice),
        Some([format!("{CONTESTED_OBJECT}: media/runs/r1/proof/rally.mp4")].as_slice())
    );
}

// --- Objects uploaded as the build makes them -------------------------------------

#[tokio::test]
async fn a_build_with_a_sink_uploads_each_run_s_objects_and_returns_the_rest() {
    let (_tmp, store) = empty_store();
    store
        .write_run_proof("r1", "title.png", b"png:title")
        .unwrap();
    let bucket = Arc::new(Bucket::default());
    let sink = bucket_client(&bucket).await;

    let snapshot = SnapshotBuilder::new(vec![image_proof_run()], vec![manifest()], store)
        .with_object_sink(Some(sink))
        .build(now())
        .await
        .unwrap();

    // The run's media and its document are in the bucket already.
    let held = bucket.objects.lock().unwrap().clone();
    assert_eq!(
        held.get(TITLE_KEY).map(Vec::as_slice),
        Some(&b"png:title"[..])
    );
    let documents: Vec<&String> = held
        .keys()
        .filter(|key| key.starts_with("documents/runs/r1/"))
        .collect();
    assert_eq!(documents.len(), 1, "{:?}", held.keys());
    assert_eq!(snapshot.streamed.objects, held.len());
    assert_eq!(
        snapshot.streamed.bytes,
        held.values().map(|bytes| bytes.len() as u64).sum::<u64>()
    );
    // What the build returns for the caller to upload is the rest: the
    // snapshot's own generation, and nothing the sink took.
    assert!(!snapshot.objects.is_empty());
    for object in &snapshot.objects {
        assert!(
            !object.key.starts_with("media/") && !object.key.starts_with("documents/runs/"),
            "{}",
            object.key
        );
        assert!(!held.contains_key(&object.key), "{}", object.key);
    }
    // The document the index names is the one that was uploaded.
    assert!(
        documents
            .iter()
            .all(|key| snapshot.run_document_keys.contains(*key))
    );
}

#[tokio::test]
async fn a_build_without_a_sink_returns_every_object() {
    let (_tmp, store) = empty_store();
    store
        .write_run_proof("r1", "title.png", b"png:title")
        .unwrap();

    let snapshot = SnapshotBuilder::new(vec![image_proof_run()], vec![manifest()], store)
        .build(now())
        .await
        .unwrap();

    assert_eq!(snapshot.streamed, StreamedObjects::default());
    assert!(object(&snapshot, TITLE_KEY).is_some());
}

#[tokio::test]
async fn an_upload_the_sink_refuses_fails_the_build() {
    let (_tmp, store) = empty_store();
    store
        .write_run_proof("r1", "title.png", b"png:title")
        .unwrap();
    // A client of a bucket nothing listens for.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    drop(listener);
    let sink = R2Client::new(test_cabinet_core::r2::R2Config {
        account_id: "acct".to_string(),
        bucket: "bucket".to_string(),
        access_key_id: "key".to_string(),
        secret_access_key: "secret".to_string(),
        endpoint: format!("http://{addr}"),
        region: "auto".to_string(),
    });

    let error = SnapshotBuilder::new(vec![image_proof_run()], vec![manifest()], store)
        .with_object_sink(Some(sink))
        .build(now())
        .await
        .expect_err("the build fails");

    assert!(error.to_string().contains("of run r1 failed"), "{error}");
}
