//! Tests for how a build that confirms media accounts for every file of a run:
//! what it asks the artifact service, which files only a tree names, and which
//! missing files leave a run unconfirmed.

use std::collections::{HashMap, HashSet};

use test_cabinet_core::MediaKind;

use super::tests::{
    empty_store, manifest, now, proof, proof_run, run_document_json, stored_run, stub_artifacts,
};
use super::*;

/// The `GET /runs/{id}/media` body of a stored tree holding these files.
fn listing(validation: &[&str], showcase: &[&str]) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "id": "r1",
        "stored": true,
        "validation": validation,
        "showcase": showcase,
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
    }))
    .unwrap()
}

fn files(entries: &[(&str, Vec<u8>)]) -> HashMap<String, Vec<u8>> {
    entries
        .iter()
        .map(|(path, bytes)| (path.to_string(), bytes.clone()))
        .collect()
}

/// A run with a showcase whose description references `banner.png` and whose
/// carousel lists `title.png`.
fn showcase_run() -> StoredRun {
    let mut run = stored_run("r1", "2026-06-17T21:40:00Z");
    run.record.showcase = Some(test_cabinet_core::RunShowcase {
        description: "# My Game\n![B](banner.png)".to_string(),
        media: vec![test_cabinet_core::ShowcaseMedia {
            file: "title.png".to_string(),
            name: "Title".to_string(),
            kind: MediaKind::Image,
        }],
    });
    run
}

async fn confirming(run: StoredRun, store: DefinitionStore, base: String) -> Snapshot {
    SnapshotBuilder::new(vec![run], vec![manifest()], store)
        .with_artifacts(Some(base), reqwest::Client::new())
        .with_media_confirmation(HashSet::new())
        .build(now())
        .await
        .unwrap()
}

fn object<'a>(snapshot: &'a Snapshot, key: &str) -> Option<&'a SnapshotObject> {
    snapshot.objects.iter().find(|object| object.key == key)
}

#[tokio::test]
async fn a_build_that_confirms_nothing_asks_for_no_listing() {
    let (_tmp, store) = empty_store();
    let (base, seen) = stub_artifacts(HashMap::new()).await;

    let snapshot = SnapshotBuilder::new(
        vec![stored_run("r1", "2026-06-17T21:40:00Z")],
        vec![manifest()],
        store,
    )
    .with_artifacts(Some(base), reqwest::Client::new())
    .build(now())
    .await
    .unwrap();

    assert!(
        seen.lock().unwrap().is_empty(),
        "{:?}",
        seen.lock().unwrap()
    );
    assert!(snapshot.unconfirmed_media.is_empty());
    assert!(snapshot.run_ids.contains("r1"));
}

#[tokio::test]
async fn the_image_store_is_read_from_the_tree_when_the_backend_store_lost_it() {
    // The recordings' shared image store is on no record. The backend's copy is
    // gone, so the tree's listing is the only thing that names the file.
    let (_tmp, store) = empty_store();
    let (base, _) = stub_artifacts(files(&[
        (
            "/runs/r1/media",
            listing(&["img.0a1b.png", "notes.txt"], &[]),
        ),
        ("/runs/r1/validation/img.0a1b.png", b"png:frame".to_vec()),
    ]))
    .await;

    let snapshot = confirming(stored_run("r1", "2026-06-17T21:40:00Z"), store, base).await;

    let key = "media/runs/r1/validation/img.0a1b.png";
    assert_eq!(object(&snapshot, key).unwrap().bytes, b"png:frame");
    let parsed = run_document_json(&snapshot, "r1");
    let media = parsed["validationMedia"].as_array().unwrap();
    assert_eq!(
        media.len(),
        1,
        "only image-store files are taken from a listing"
    );
    assert_eq!(media[0]["file"], "img.0a1b.png");
    assert_eq!(media[0]["key"], key);
    assert!(snapshot.unconfirmed_media.is_empty());
}

#[tokio::test]
async fn an_image_store_file_the_tree_lists_and_cannot_serve_leaves_the_run_unconfirmed() {
    let (_tmp, store) = empty_store();
    let (base, _) = stub_artifacts(files(&[(
        "/runs/r1/media",
        listing(&["img.0a1b.png"], &[]),
    )]))
    .await;

    let snapshot = confirming(stored_run("r1", "2026-06-17T21:40:00Z"), store, base).await;

    assert_eq!(
        snapshot.unconfirmed_media.get("r1").map(Vec::as_slice),
        Some(["validation/img.0a1b.png".to_string()].as_slice())
    );
}

#[tokio::test]
async fn the_image_store_of_a_reclaimed_run_is_named_by_the_bucket() {
    // The tree is reclaimed and the backend store was wiped. The files are in the
    // bucket, and the run's document must go on naming them or its published
    // replays draw holes.
    let (_tmp, store) = empty_store();
    let key = "media/runs/r1/validation/img.0a1b.png";
    let existing: HashSet<String> = [
        key.to_string(),
        "media/runs/r1/validation/spin__rally.mp4".to_string(),
        "media/runs/other/validation/img.ffff.png".to_string(),
    ]
    .into_iter()
    .collect();

    let snapshot = SnapshotBuilder::new(
        vec![stored_run("r1", "2026-06-17T21:40:00Z")],
        vec![manifest()],
        store,
    )
    .with_existing_media(existing)
    .with_media_confirmation(HashSet::from(["r1".to_string()]))
    .build(now())
    .await
    .unwrap();

    let parsed = run_document_json(&snapshot, "r1");
    let media = parsed["validationMedia"].as_array().unwrap();
    assert_eq!(media.len(), 1, "{media:?}");
    assert_eq!(media[0]["file"], "img.0a1b.png");
    assert_eq!(media[0]["key"], key);
    assert!(
        object(&snapshot, key).is_none(),
        "nothing is uploaded again"
    );
    assert!(snapshot.unconfirmed_media.is_empty());
}

#[tokio::test]
async fn a_showcase_file_only_the_tree_names_is_published() {
    // Neither the carousel nor the description mentions `extra.png`, and the
    // backend store holds nothing.
    let (_tmp, store) = empty_store();
    let (base, _) = stub_artifacts(files(&[
        (
            "/runs/r1/media",
            listing(&[], &["banner.png", "extra.png", "title.png"]),
        ),
        ("/runs/r1/showcase/banner.png", b"png:banner".to_vec()),
        ("/runs/r1/showcase/extra.png", b"png:extra".to_vec()),
        ("/runs/r1/showcase/title.png", b"png:title".to_vec()),
    ]))
    .await;

    let snapshot = confirming(showcase_run(), store, base).await;

    assert_eq!(
        object(&snapshot, "media/runs/r1/showcase/extra.png")
            .unwrap()
            .bytes,
        b"png:extra"
    );
    let parsed = run_document_json(&snapshot, "r1");
    let mut names: Vec<&str> = parsed["showcaseMedia"]
        .as_array()
        .unwrap()
        .iter()
        .map(|media| media["file"].as_str().unwrap())
        .collect();
    names.sort_unstable();
    assert_eq!(names, ["banner.png", "extra.png", "title.png"]);
    assert!(snapshot.unconfirmed_media.is_empty());
}

#[tokio::test]
async fn a_referenced_file_a_stored_tree_does_not_hold_does_not_count_against_the_run() {
    // The description references an image the model never wrote. The service
    // holds the run's tree and answers `404` for it: no tree could supply it.
    let (_tmp, store) = empty_store();
    let (base, _) = stub_artifacts(files(&[
        ("/runs/r1/media", listing(&[], &["title.png"])),
        ("/runs/r1/showcase/title.png", b"png:title".to_vec()),
    ]))
    .await;

    let snapshot = confirming(showcase_run(), store, base).await;

    assert!(
        snapshot.unconfirmed_media.is_empty(),
        "{:?}",
        snapshot.unconfirmed_media
    );
    assert!(object(&snapshot, "media/runs/r1/showcase/banner.png").is_none());
    assert!(object(&snapshot, "media/runs/r1/showcase/title.png").is_some());
}

#[tokio::test]
async fn a_file_the_tree_lists_and_cannot_serve_counts_against_the_run() {
    // Unlike a reference, a listed file exists. A `404` for it is a file that
    // could not be published.
    let (_tmp, store) = empty_store();
    let (base, _) = stub_artifacts(files(&[(
        "/runs/r1/media",
        listing(&[], &["banner.png", "title.png"]),
    )]))
    .await;

    let snapshot = confirming(showcase_run(), store, base).await;

    assert_eq!(
        snapshot.unconfirmed_media.get("r1").map(Vec::as_slice),
        Some(
            [
                "showcase/banner.png".to_string(),
                "showcase/title.png".to_string()
            ]
            .as_slice()
        )
    );
}

#[tokio::test]
async fn a_missing_file_counts_against_a_run_with_no_tree() {
    // The service holds no tree, so a `404` says nothing about whether the file
    // was ever produced.
    let (_tmp, store) = empty_store();
    let (base, _) = stub_artifacts(files(&[("/runs/r1/media", no_tree())])).await;
    let run = proof_run(
        "r1",
        vec![proof("title", "proof/title.png", MediaKind::Image, true)],
    );

    let snapshot = confirming(run, store, base).await;

    assert_eq!(
        snapshot.unconfirmed_media.get("r1").map(Vec::as_slice),
        Some(["proof/title.png".to_string()].as_slice())
    );
}

#[tokio::test]
async fn a_tree_that_cannot_be_listed_leaves_the_run_unconfirmed() {
    // An artifact service older than the listing route answers `404` for it, and
    // one that is down answers nothing. Either way the build has not seen every
    // file, although every file the record lists is accounted for.
    let (_tmp, store) = empty_store();
    store.write_run_proof("r1", "title.png", b"png").unwrap();
    let (base, _) = stub_artifacts(HashMap::new()).await;
    let run = proof_run(
        "r1",
        vec![proof("title", "proof/title.png", MediaKind::Image, true)],
    );

    let snapshot = confirming(run, store, base).await;

    assert!(object(&snapshot, "media/runs/r1/proof/title.png").is_some());
    assert_eq!(
        snapshot.unconfirmed_media.get("r1").map(Vec::as_slice),
        Some([TREE_LISTING_UNAVAILABLE.to_string()].as_slice())
    );

    // With no artifact service configured at all there is nothing to ask.
    let (_tmp, store) = empty_store();
    let snapshot = SnapshotBuilder::new(
        vec![stored_run("r1", "2026-06-17T21:40:00Z")],
        vec![manifest()],
        store,
    )
    .with_media_confirmation(HashSet::new())
    .build(now())
    .await
    .unwrap();
    assert_eq!(
        snapshot.unconfirmed_media.get("r1").map(Vec::as_slice),
        Some([TREE_LISTING_UNAVAILABLE.to_string()].as_slice())
    );
}

#[tokio::test]
async fn a_settled_run_is_not_asked_about() {
    // Its record lists a proof the run never wrote, excused when the run was
    // confirmed. Its tree is gone on purpose: asking for the file again at every
    // refresh would find nothing and say nothing new.
    let (_tmp, store) = empty_store();
    let (base, seen) = stub_artifacts(HashMap::new()).await;
    let run = proof_run(
        "r1",
        vec![proof("title", "proof/title.png", MediaKind::Image, true)],
    );

    let snapshot = SnapshotBuilder::new(vec![run], vec![manifest()], store)
        .with_artifacts(Some(base), reqwest::Client::new())
        .with_media_confirmation(HashSet::from(["r1".to_string()]))
        .build(now())
        .await
        .unwrap();

    assert!(
        seen.lock().unwrap().is_empty(),
        "{:?}",
        seen.lock().unwrap()
    );
    assert!(snapshot.unconfirmed_media.is_empty());
}
