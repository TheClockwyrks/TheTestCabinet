//! Tests for what a refresh records with a confirmation: the run's file manifest,
//! the version it was made under, and what happens to runs confirmed before the
//! definition covered every file of a run.

use std::sync::Arc;

use tempfile::TempDir;
use test_cabinet_core::run_record::RunLinks;

use super::tests::{
    BUCKET, Bucket, Trees, bucket_publisher, record, run_columns, seed_published,
    seed_published_with_proof,
};
use super::*;
use crate::db::{MEDIA_CONFIRMATION_VERSION, MediaFileKind, MediaManifestFile, ReclaimReason};

/// The store the publisher of [`bucket_publisher`] reads.
fn store_of(dir: &TempDir) -> DefinitionStore {
    DefinitionStore::open(dir.path().join("store")).unwrap()
}

/// Publish an adversarial run that names a controller module and two replays.
async fn seed_published_adversarial(db: &Db, id: &str) {
    seed_published(db, id, "2026-06-17T21:40:00Z").await;
    let replay = |opponent: &str, file: &str| {
        serde_json::json!({
            "opponent": opponent,
            "replayJson": file,
            "winner": null,
            "redScore": 0,
            "blueScore": 0,
            "ended": "time_limit",
            "ticks": 1,
            "outcome": "draw",
            "scored": true,
        })
    };
    let mut adversarial = record(id);
    adversarial.validation.adversarial = Some(
        serde_json::from_value(serde_json::json!({
            "replayJson": "replay.json",
            "opponent": "border-soldier",
            "submissionTeam": "red",
            "winner": null,
            "redScore": 0,
            "blueScore": 0,
            "ended": "time_limit",
            "ticks": 1,
            "outcome": "draw",
            "controllerModule": "build/controller.wasm",
            "replays": [
                replay("border-soldier", "replay.json"),
                replay("random", "replay-1.json"),
            ],
        }))
        .unwrap(),
    );
    db.push(&adversarial, &RunLinks::default(), None, None)
        .await
        .unwrap();
}

/// Leave run `id` as a backend from before the version left a run it had
/// confirmed and whose tree its sweep had reclaimed.
async fn settle_under_the_first_definition(db: &Db, id: &str) {
    crate::db::retention_tests::set_media_confirmed(db, id, Some("2026-06-18T00:00:00Z")).await;
    let seen = db.retention_run(id, Some(BUCKET)).await.unwrap().unwrap();
    assert!(
        db.mark_artifacts_reclaimed(&seen, ReclaimReason::Published, "2026-06-19T00:00:00Z")
            .await
            .unwrap()
    );
    crate::db::retention_tests::confirm_under_the_first_definition(db, id).await;
}

#[tokio::test]
async fn a_confirming_refresh_records_the_manifest_of_every_file() {
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    let trees = Arc::new(Trees::default());
    let publisher = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;
    seed_published_adversarial(&db, "duel").await;
    // One replay is already in the bucket, one is in the backend store, and the
    // controller is only in the run's tree.
    bucket.objects.lock().unwrap().insert(
        "media/runs/duel/asset/replay.json".to_string(),
        b"{}".to_vec(),
    );
    store_of(&dir)
        .write_run_asset("duel", "replay-1.json", b"{\"m\":1}")
        .unwrap();
    trees.store("duel", &[("root/controller.wasm", b"wasm")]);

    publisher.refresh_now().await.unwrap();

    let row = run_columns(&db, "duel").await;
    assert!(row.media_confirmed_at.is_some());
    assert_eq!(
        row.media_confirmation_version,
        Some(MEDIA_CONFIRMATION_VERSION)
    );
    let manifest = db
        .run_media_manifest("duel", Some(BUCKET))
        .await
        .unwrap()
        .expect("a confirmed run has a manifest");
    assert_eq!(
        manifest.files,
        [
            MediaManifestFile::stored(
                MediaFileKind::Asset,
                "asset/replay.json",
                "media/runs/duel/asset/replay.json"
            ),
            MediaManifestFile::stored(
                MediaFileKind::Asset,
                "asset/replay-1.json",
                "media/runs/duel/asset/replay-1.json"
            ),
            MediaManifestFile::stored(
                MediaFileKind::Controller,
                "controller.wasm",
                "media/runs/duel/controller.wasm"
            ),
        ]
    );
    // Every key the manifest names is in the bucket.
    let objects = bucket.objects.lock().unwrap();
    for key in manifest.keys() {
        assert!(objects.contains_key(key), "{key}");
    }
    assert_eq!(objects["media/runs/duel/asset/replay-1.json"], b"{\"m\":1}");
    assert_eq!(objects["media/runs/duel/controller.wasm"], b"wasm");
}

#[tokio::test]
async fn a_refresh_that_withdraws_a_confirmation_clears_the_manifest() {
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    let trees = Arc::new(Trees::default());
    let publisher = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;
    seed_published_with_proof(&db, "proven").await;
    trees.store("proven", &[("proof/title.png", b"png")]);
    publisher.refresh_now().await.unwrap();
    assert!(
        db.run_media_manifest("proven", Some(BUCKET))
            .await
            .unwrap()
            .is_some()
    );

    // The artifact service stops answering, so the next refresh cannot know it
    // has seen every file of the run.
    trees.set_down(true);
    publisher.refresh_now().await.unwrap();

    let row = run_columns(&db, "proven").await;
    assert_eq!(row.media_confirmed_at, None);
    assert_eq!(row.media_manifest, None);
    assert_eq!(
        db.run_media_manifest("proven", Some(BUCKET)).await.unwrap(),
        None
    );
}

#[tokio::test]
async fn a_run_settled_before_the_version_has_its_new_files_published_from_the_store() {
    // Confirmed and reclaimed by a backend whose confirmation did not cover the
    // second replay or the controller. The tree is gone, on purpose. The backend
    // store still holds both files, and they must reach the bucket.
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    let trees = Arc::new(Trees::default());
    seed_published_adversarial(&db, "duel").await;
    bucket.objects.lock().unwrap().insert(
        "media/runs/duel/asset/replay.json".to_string(),
        b"{}".to_vec(),
    );
    let store = store_of(&dir);
    store
        .write_run_asset("duel", "replay-1.json", b"{\"m\":1}")
        .unwrap();
    store.write_run_controller("duel", b"wasm").unwrap();
    settle_under_the_first_definition(&db, "duel").await;
    let publisher = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;

    // The start after the deploy asks for the refresh that evaluates it.
    publisher.inner.request_startup_confirmation().await;
    assert_eq!(publisher.inner.batcher.pending(), 1);
    publisher.refresh_now().await.unwrap();

    {
        let objects = bucket.objects.lock().unwrap();
        assert_eq!(objects["media/runs/duel/asset/replay-1.json"], b"{\"m\":1}");
        assert_eq!(objects["media/runs/duel/controller.wasm"], b"wasm");
    }
    let row = run_columns(&db, "duel").await;
    assert!(row.media_confirmed_at.is_some());
    assert_eq!(
        row.media_confirmation_version,
        Some(MEDIA_CONFIRMATION_VERSION)
    );
    let manifest = db
        .run_media_manifest("duel", Some(BUCKET))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(manifest.files.len(), 3);
    assert_eq!(manifest.unrecoverable().count(), 0);
    assert!(
        db.run_artifacts_reclaimed("duel").await.unwrap().is_some(),
        "the tree stays reclaimed"
    );

    // It is settled now. A restart asks for nothing, and a later refresh asks the
    // artifact service nothing and uploads nothing of the run again.
    let restarted = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;
    restarted.inner.request_startup_confirmation().await;
    assert_eq!(restarted.inner.batcher.pending(), 0);
    let asked = trees.listed();
    store.delete_run_media("duel").unwrap();
    publisher.refresh_now().await.unwrap();
    assert_eq!(trees.listed(), asked, "nothing more was asked");
    assert_eq!(
        db.run_media_manifest("duel", Some(BUCKET))
            .await
            .unwrap()
            .unwrap(),
        manifest
    );
}

#[tokio::test]
async fn a_run_settled_before_the_version_whose_new_files_are_lost_is_confirmed_without_them() {
    // As above, with a backend store that was wiped. The second replay and the
    // controller are in none of the bucket, the store and the tree.
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    let trees = Arc::new(Trees::default());
    seed_published_adversarial(&db, "duel").await;
    bucket.objects.lock().unwrap().insert(
        "media/runs/duel/asset/replay.json".to_string(),
        b"{}".to_vec(),
    );
    settle_under_the_first_definition(&db, "duel").await;
    let publisher = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;

    publisher.refresh_now().await.unwrap();

    let manifest = db
        .run_media_manifest("duel", Some(BUCKET))
        .await
        .unwrap()
        .expect("the run is confirmed");
    assert_eq!(
        manifest.unrecoverable().collect::<Vec<_>>(),
        ["asset/replay-1.json", "controller.wasm"]
    );
    assert_eq!(
        manifest.file("asset/replay.json").unwrap().key.as_deref(),
        Some("media/runs/duel/asset/replay.json")
    );
}

#[tokio::test]
async fn a_missing_tree_the_backend_records_as_stored_writes_no_file_off() {
    // The artifact service answers that it holds no tree, and the backend's own
    // record says the tree is stored. A service that lost sight of its volume
    // answers like this for every run, so nothing is recorded as lost for good.
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    let trees = Arc::new(Trees::default());
    seed_published_with_proof(&db, "proven").await;
    db.set_run_artifacts_stored("proven", true).await.unwrap();
    let publisher = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;

    publisher.refresh_now().await.unwrap();

    let row = run_columns(&db, "proven").await;
    assert_eq!(row.media_confirmed_at, None, "the run is left unconfirmed");
    assert_eq!(row.media_manifest, None);

    // Once the sweep's reconciliation has recorded the tree as not stored, the
    // two agree and the file is recorded as unrecoverable.
    db.set_run_artifacts_stored("proven", false).await.unwrap();
    publisher.refresh_now().await.unwrap();

    let manifest = db
        .run_media_manifest("proven", Some(BUCKET))
        .await
        .unwrap()
        .expect("the run is confirmed");
    assert_eq!(
        manifest.unrecoverable().collect::<Vec<_>>(),
        ["proof/title.png"]
    );
}
