//! Tests for building a confirmed run from its file manifest: every file name
//! and key of the run's document comes from the manifest, and the run's folder in
//! the backend store is neither read nor listed.

use std::collections::{HashMap, HashSet};

use test_cabinet_core::MediaKind;

use super::tests::{
    code_analysis_summary, empty_store, manifest, now, proof, run_document_json, validation_run,
};
use super::*;
use crate::db::{MediaFileKind, MediaManifest, MediaManifestFile};

const RUN: &str = "r1";

/// A run with a file of every kind a manifest records: an image proof and a
/// video proof, a declared validation still, a showcase whose carousel and
/// description each name one file, an adversarial result with two replays and a
/// controller, and a code analysis.
fn rich_run() -> StoredRun {
    let mut run = validation_run(RUN, "spin", true, false);
    run.record.validation.proofs = vec![
        proof("title", "proof/title.png", MediaKind::Image, true),
        proof("rally", "proof/rally.webm", MediaKind::Video, true),
    ];
    run.record.showcase = Some(test_cabinet_core::RunShowcase {
        description: "# My Game\n![B](banner.png)".to_string(),
        media: vec![test_cabinet_core::ShowcaseMedia {
            file: "title.png".to_string(),
            name: "Title".to_string(),
            kind: MediaKind::Image,
        }],
    });
    let replay = |file: &str| {
        serde_json::json!({
            "opponent": "border-soldier",
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
    run.record.validation.adversarial = Some(
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
            "replays": [replay("replay.json"), replay("replay-1.json")],
        }))
        .unwrap(),
    );
    run.record.code_analysis = Some(code_analysis_summary());
    run
}

/// Write every file of [`rich_run`] into `store`, with two files no record
/// names: a loose showcase file and a file of the recordings' image store.
fn write_run_files(store: &DefinitionStore) {
    store.write_run_proof(RUN, "title.png", b"png").unwrap();
    store
        .write_run_validation(RUN, "spin__still.png", b"png")
        .unwrap();
    store
        .write_run_validation(RUN, "img.9f2c1ab4.png", b"png")
        .unwrap();
    for file in ["title.png", "banner.png", "loose.png"] {
        store.write_run_showcase(RUN, file, b"png").unwrap();
    }
    for file in ["replay.json", "replay-1.json"] {
        store.write_run_asset(RUN, file, b"{}").unwrap();
    }
    store.write_run_controller(RUN, b"\0asm").unwrap();
    store.write_run_code_analysis(RUN, b"{}").unwrap();
}

/// The two objects of the video proof, which the tests place in the bucket so
/// that no build here has to transcode.
const VIDEO_KEYS: [&str; 2] = [
    "media/runs/r1/proof/rally.mp4",
    "media/runs/r1/original/proof/rally.webm",
];

/// Build [`rich_run`] from its sources, as the refresh that confirms it does,
/// and return its document's bytes with the manifest to record for it.
async fn confirming_build(store: &DefinitionStore) -> (Vec<u8>, MediaManifest) {
    let snapshot = SnapshotBuilder::new(vec![rich_run()], vec![manifest()], store.clone())
        .with_existing_media(VIDEO_KEYS.iter().map(|key| key.to_string()).collect())
        .build(now())
        .await
        .unwrap();
    assert!(
        snapshot.unconfirmed_media.is_empty(),
        "{:?}",
        snapshot.unconfirmed_media
    );
    (
        document_bytes(&snapshot),
        snapshot.media_manifests[RUN].clone(),
    )
}

/// The bytes of the run's document object.
fn document_bytes(snapshot: &Snapshot) -> Vec<u8> {
    let prefix = format!("{RUN_DOCUMENT_PREFIX}/{RUN}/");
    snapshot
        .objects
        .iter()
        .find(|object| object.key.starts_with(&prefix))
        .expect("the run's document")
        .bytes
        .clone()
}

/// Build `run` as a refresh does for a run confirmed with `recorded`, against a
/// bucket listing of `existing`. The build confirms media and has no artifact
/// service, so a run it asked about would be reported unconfirmed.
async fn build_recorded(
    run: StoredRun,
    store: &DefinitionStore,
    recorded: &MediaManifest,
    existing: HashSet<String>,
) -> Snapshot {
    SnapshotBuilder::new(vec![run], vec![manifest()], store.clone())
        .with_media_confirmation(HashSet::new())
        .with_recorded_manifests(HashMap::from([(RUN.to_string(), recorded.clone())]))
        .with_existing_media(existing)
        .build(now())
        .await
        .unwrap()
}

fn keys_of(manifest: &MediaManifest) -> HashSet<String> {
    manifest.keys().map(str::to_string).collect()
}

/// The media objects a build would upload for the run.
fn media_uploads(snapshot: &Snapshot) -> Vec<&str> {
    snapshot
        .objects
        .iter()
        .map(|object| object.key.as_str())
        .filter(|key| key.starts_with("media/runs/"))
        .collect()
}

#[tokio::test]
async fn a_confirmed_run_s_document_is_the_same_with_and_without_its_store_folder() {
    let (_tmp, store) = empty_store();
    write_run_files(&store);
    let (confirmed_document, recorded) = confirming_build(&store).await;
    // The manifest names the two files no record names, which is what lets a
    // later build publish them with no directory to list.
    assert!(recorded.file("showcase/loose.png").is_some());
    assert!(recorded.file("validation/img.9f2c1ab4.png").is_some());

    // With the folder present. It has changed since the run was confirmed: a
    // file was added to each listed directory, which a build that listed them
    // would publish.
    store.write_run_showcase(RUN, "stray.png", b"png").unwrap();
    store
        .write_run_validation(RUN, "img.00000000.png", b"png")
        .unwrap();
    let present = build_recorded(rich_run(), &store, &recorded, keys_of(&recorded)).await;

    // With the folder removed.
    store.delete_run_media(RUN).unwrap();
    assert!(!store.run_dir(RUN).exists());
    let removed = build_recorded(rich_run(), &store, &recorded, keys_of(&recorded)).await;

    let with_folder = document_bytes(&present);
    let without_folder = document_bytes(&removed);
    assert_eq!(
        with_folder, without_folder,
        "the document depends on the run's store folder"
    );
    // And it is the document the refresh that confirmed the run published, so
    // its key is already in the bucket and nothing is uploaded for it.
    assert_eq!(with_folder, confirmed_document);

    for snapshot in [&present, &removed] {
        assert!(
            snapshot.unconfirmed_media.is_empty(),
            "{:?}",
            snapshot.unconfirmed_media
        );
        assert_eq!(snapshot.media_manifests[RUN], recorded);
        assert_eq!(media_uploads(snapshot), Vec::<&str>::new());
    }

    // The document names every file, the loose ones included, and neither file
    // added after the confirmation.
    let document = run_document_json(&removed, RUN);
    let names = |field: &str| -> Vec<String> {
        document[field]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["file"].as_str().unwrap().to_string())
            .collect()
    };
    assert_eq!(
        names("showcaseMedia"),
        ["banner.png", "loose.png", "title.png"]
    );
    assert_eq!(
        names("validationMedia"),
        ["spin__still.png", "img.9f2c1ab4.png"]
    );
    assert_eq!(names("assetMedia"), ["replay.json", "replay-1.json"]);
    let proofs: Vec<&str> = document["proofMedia"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["key"].as_str().unwrap())
        .collect();
    assert_eq!(
        proofs,
        [
            "media/runs/r1/proof/title.png",
            "media/runs/r1/proof/rally.mp4"
        ]
    );
    assert!(
        document["codeAnalysisKey"]
            .as_str()
            .unwrap()
            .starts_with("media/runs/r1/code-analysis/v")
    );
}

#[tokio::test]
async fn a_confirmed_run_is_built_without_listing_or_reading_its_store_folder() {
    let (tmp, store) = empty_store();
    write_run_files(&store);
    let (confirmed_document, recorded) = confirming_build(&store).await;

    // Replace the two directories a build lists with plain files. Listing either
    // now fails, which a build that listed them reports against the run.
    let run_dir = store.run_dir(RUN);
    assert!(run_dir.starts_with(tmp.path()));
    for dir in ["validation", "showcase"] {
        std::fs::remove_dir_all(run_dir.join(dir)).unwrap();
        std::fs::write(run_dir.join(dir), b"not a directory").unwrap();
    }
    // The same build without the manifest does report it.
    let unrecorded = SnapshotBuilder::new(vec![rich_run()], vec![manifest()], store.clone())
        .with_existing_media(keys_of(&recorded))
        .build(now())
        .await
        .unwrap();
    assert!(
        unrecorded.unconfirmed_media[RUN]
            .iter()
            .any(|file| file == STORE_LISTING_UNAVAILABLE),
        "{:?}",
        unrecorded.unconfirmed_media
    );

    let snapshot = build_recorded(rich_run(), &store, &recorded, keys_of(&recorded)).await;
    assert!(
        snapshot.unconfirmed_media.is_empty(),
        "{:?}",
        snapshot.unconfirmed_media
    );
    assert_eq!(document_bytes(&snapshot), confirmed_document);
}

#[tokio::test]
async fn a_confirmed_run_with_an_object_missing_from_the_bucket_is_built_from_its_sources() {
    let (_tmp, store) = empty_store();
    write_run_files(&store);
    let (_, recorded) = confirming_build(&store).await;

    // The bucket has lost one object. The manifest no longer describes it, so
    // the run is read from its sources and the object uploaded again.
    let mut existing = keys_of(&recorded);
    assert!(existing.remove("media/runs/r1/asset/replay-1.json"));
    let snapshot = SnapshotBuilder::new(vec![rich_run()], vec![manifest()], store.clone())
        .with_recorded_manifests(HashMap::from([(RUN.to_string(), recorded.clone())]))
        .with_existing_media(existing)
        .build(now())
        .await
        .unwrap();
    assert_eq!(
        media_uploads(&snapshot),
        ["media/runs/r1/asset/replay-1.json"]
    );
    assert!(snapshot.unconfirmed_media.is_empty());
}

#[tokio::test]
async fn a_confirmed_run_with_a_lost_object_and_no_source_is_reported_unconfirmed() {
    let (_tmp, store) = empty_store();
    write_run_files(&store);
    let (_, recorded) = confirming_build(&store).await;
    store.delete_run_media(RUN).unwrap();

    let mut existing = keys_of(&recorded);
    assert!(existing.remove("media/runs/r1/asset/replay-1.json"));
    let snapshot = build_recorded(rich_run(), &store, &recorded, existing).await;
    // The manifest was not taken for the truth about a bucket that disagrees
    // with it, so the run is no longer vouched for.
    assert!(
        snapshot.unconfirmed_media.contains_key(RUN),
        "a run with a lost object stayed confirmed"
    );
}

#[tokio::test]
async fn a_file_the_manifest_records_as_unrecoverable_stays_out_of_the_document() {
    let (_tmp, store) = empty_store();
    // A manifest of a run that lost two files for good: a proof image, and the
    // recording of a video whose mp4 the bucket still holds.
    let recorded = MediaManifest {
        files: vec![
            MediaManifestFile::unrecoverable(MediaFileKind::Proof, "proof/title.png", None),
            MediaManifestFile::unrecoverable(
                MediaFileKind::Proof,
                "proof/rally.webm",
                Some("media/runs/r1/proof/rally.mp4".to_string()),
            ),
            MediaManifestFile::unrecoverable(MediaFileKind::Controller, "controller.wasm", None),
        ],
    };
    // The store has since been handed the image. A confirmed run is not read
    // from it, so the document does not change under a reader's feet.
    store.write_run_proof(RUN, "title.png", b"png").unwrap();

    let mut run = rich_run();
    run.record.showcase = None;
    run.record.code_analysis = None;
    run.record.validation.debug_scripts.clear();
    let snapshot = build_recorded(run, &store, &recorded, keys_of(&recorded)).await;

    let document = run_document_json(&snapshot, RUN);
    let proofs = document["proofMedia"].as_array().unwrap();
    assert_eq!(proofs.len(), 1, "{proofs:?}");
    assert_eq!(proofs[0]["id"], "rally");
    assert_eq!(proofs[0]["key"], "media/runs/r1/proof/rally.mp4");
    assert_eq!(document["assetMedia"], serde_json::json!([]));
    assert_eq!(media_uploads(&snapshot), Vec::<&str>::new());
    assert!(snapshot.unconfirmed_media.is_empty());
    assert_eq!(snapshot.media_manifests[RUN], recorded);
}

#[tokio::test]
async fn a_video_stored_under_its_published_name_is_found_under_that_name() {
    let (_tmp, store) = empty_store();
    // A clip the store held as an mp4 already is recorded under the mp4's name,
    // with no recording beside it.
    let recorded = MediaManifest {
        files: vec![MediaManifestFile::stored(
            MediaFileKind::Proof,
            "proof/rally.mp4",
            "media/runs/r1/proof/rally.mp4",
        )],
    };
    let run = super::tests::proof_run(
        RUN,
        vec![proof("rally", "proof/rally.webm", MediaKind::Video, true)],
    );
    let snapshot = build_recorded(run, &store, &recorded, keys_of(&recorded)).await;
    let document = run_document_json(&snapshot, RUN);
    assert_eq!(
        document["proofMedia"][0]["key"],
        "media/runs/r1/proof/rally.mp4"
    );
    assert_eq!(snapshot.media_manifests[RUN], recorded);
}

#[test]
fn recorded_names_are_the_store_s_names_of_one_kind_in_recorded_order() {
    let manifest = MediaManifest {
        files: vec![
            MediaManifestFile::stored(MediaFileKind::Showcase, "showcase/b.png", "k1"),
            MediaManifestFile::stored(MediaFileKind::Proof, "proof/a.png", "k2"),
            MediaManifestFile::transcoded(MediaFileKind::Showcase, "showcase/a.webm", "k3", "k4"),
            MediaManifestFile::stored(MediaFileKind::Showcase, "showcase/b.png", "k1"),
            MediaManifestFile::unrecoverable(MediaFileKind::Showcase, "showcase/c.png", None),
        ],
    };
    assert_eq!(
        run_files::recorded_names(&manifest, MediaFileKind::Showcase),
        ["b.png", "a.webm", "c.png"]
    );
    assert_eq!(
        run_files::recorded_names(&manifest, MediaFileKind::Validation),
        Vec::<String>::new()
    );
}
