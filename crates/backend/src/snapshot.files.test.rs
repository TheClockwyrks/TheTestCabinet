//! Tests for how a build accounts for each file of a run: the files with no other
//! copy, the recording kept beside a transcoded video, the manifest, and which
//! missing files are recorded as unrecoverable.

use std::collections::{HashMap, HashSet};

use test_cabinet_core::MediaKind;

use super::tests::{
    answering_store, code_analysis_summary, empty_store, manifest, now, proof, proof_run,
    run_document_json, stored_run, stub_artifacts,
};
use super::*;
use crate::db::{MediaFileKind, MediaManifest, MediaManifestFile};

/// The `GET /runs/{id}/media` body of a stored tree holding these root files.
fn listing(root: &[&str]) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "id": "r1",
        "stored": true,
        "validation": [],
        "showcase": [],
        "root": root,
    }))
    .unwrap()
}

/// The body an artifact service older than the root files answers with.
fn listing_without_root() -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "id": "r1",
        "stored": true,
        "validation": [],
        "showcase": [],
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

/// An adversarial run that names `controller` as its module and a replay per
/// name of `replays`, the first of them canonical.
fn adversarial_run(controller: &str, replays: &[&str]) -> StoredRun {
    let entries: Vec<serde_json::Value> = replays
        .iter()
        .map(|file| {
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
        })
        .collect();
    let mut run = stored_run("r1", "2026-06-17T21:40:00Z");
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
            "controllerModule": controller,
            "replays": entries,
        }))
        .unwrap(),
    );
    run
}

/// A performance run with a scenario per `Some` of `scenarios` and this module.
fn performance_run(scenarios: &[Option<&str>], module: Option<&str>) -> StoredRun {
    let cases: Vec<serde_json::Value> = scenarios
        .iter()
        .map(|scenario| {
            serde_json::json!({
                "input": "cases/a.json",
                "correct": scenario.is_some(),
                "overCeiling": false,
                "fuel": 1,
                "firstMismatchTick": null,
                "scenarioJson": scenario,
                "snapshots": [],
            })
        })
        .collect();
    let mut run = stored_run("r1", "2026-06-17T21:40:00Z");
    run.record.validation.performance = Some(
        serde_json::from_value(serde_json::json!({
            "correct": true,
            "totalFuel": 1,
            "fuelLimit": 10,
            "cases": cases,
            "moduleWasm": module,
        }))
        .unwrap(),
    );
    run
}

fn video_proof_run() -> StoredRun {
    proof_run(
        "r1",
        vec![proof("rally", "proof/rally.webm", MediaKind::Video, true)],
    )
}

async fn build(run: StoredRun, store: DefinitionStore, existing: &[&str]) -> Snapshot {
    SnapshotBuilder::new(vec![run], vec![manifest()], store)
        .with_existing_media(keys(existing))
        .build(now())
        .await
        .unwrap()
}

/// Build as a backend that confirms media, against the artifact service at
/// `base`. `recorded_absent` says whether the backend recorded the run's tree as
/// gone.
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

/// The keys of the objects a build uploads under run `r1`'s media prefix.
fn uploaded(snapshot: &Snapshot) -> Vec<&str> {
    let mut keys: Vec<&str> = snapshot
        .objects
        .iter()
        .map(|object| object.key.as_str())
        .filter(|key| key.starts_with("media/runs/r1/"))
        .collect();
    keys.sort_unstable();
    keys
}

fn manifest_of(snapshot: &Snapshot) -> &MediaManifest {
    &snapshot.media_manifests["r1"]
}

fn unconfirmed(snapshot: &Snapshot) -> Vec<String> {
    snapshot
        .unconfirmed_media
        .get("r1")
        .cloned()
        .unwrap_or_default()
}

// --- The files with no other copy ----------------------------------------------

#[tokio::test]
async fn every_replay_the_record_lists_and_the_controller_are_published() {
    let (_tmp, store) = empty_store();
    store
        .write_run_asset("r1", "replay.json", b"{\"a\":0}")
        .unwrap();
    store
        .write_run_asset("r1", "replay-1.json", b"{\"a\":1}")
        .unwrap();
    // A file the record does not list is not published on the strength of being
    // in the directory.
    store
        .write_run_asset("r1", "replay-9.json", b"{\"a\":9}")
        .unwrap();
    store.write_run_controller("r1", b"\0asm").unwrap();
    let run = adversarial_run("build/controller.wasm", &["replay.json", "replay-1.json"]);

    let snapshot = build(run, store, &[]).await;

    assert_eq!(
        uploaded(&snapshot),
        [
            "media/runs/r1/asset/replay-1.json",
            "media/runs/r1/asset/replay.json",
            "media/runs/r1/controller.wasm",
        ]
    );
    assert_eq!(
        object(&snapshot, "media/runs/r1/asset/replay-1.json")
            .unwrap()
            .bytes,
        b"{\"a\":1}"
    );
    let controller = object(&snapshot, "media/runs/r1/controller.wasm").unwrap();
    assert_eq!(controller.bytes, b"\0asm");
    assert_eq!(controller.content_type, "application/wasm");
    // The replays are named in the document like any asset; the controller is not.
    let parsed = run_document_json(&snapshot, "r1");
    let named: Vec<&str> = parsed["assetMedia"]
        .as_array()
        .unwrap()
        .iter()
        .map(|media| media["file"].as_str().unwrap())
        .collect();
    assert_eq!(named, ["replay.json", "replay-1.json"]);
    assert!(
        !serde_json::to_string(&parsed["assetMedia"])
            .unwrap()
            .contains("controller")
    );
    assert_eq!(
        manifest_of(&snapshot).files,
        [
            MediaManifestFile::stored(
                MediaFileKind::Asset,
                "asset/replay.json",
                "media/runs/r1/asset/replay.json"
            ),
            MediaManifestFile::stored(
                MediaFileKind::Asset,
                "asset/replay-1.json",
                "media/runs/r1/asset/replay-1.json"
            ),
            MediaManifestFile::stored(
                MediaFileKind::Controller,
                "controller.wasm",
                "media/runs/r1/controller.wasm"
            ),
        ]
    );
}

#[tokio::test]
async fn files_already_in_the_bucket_are_referenced_without_being_read_again() {
    // The store holds different bytes, which would be uploaded if it were read,
    // and the artifact service logs every request.
    let (_tmp, store) = empty_store();
    store
        .write_run_asset("r1", "replay-1.json", b"stale")
        .unwrap();
    store.write_run_controller("r1", b"stale").unwrap();
    let (base, seen) = stub_artifacts(HashMap::new()).await;
    let run = adversarial_run("build/controller.wasm", &["replay.json", "replay-1.json"]);
    let existing = [
        "media/runs/r1/asset/replay.json",
        "media/runs/r1/asset/replay-1.json",
        "media/runs/r1/controller.wasm",
    ];

    let snapshot = SnapshotBuilder::new(vec![run], vec![manifest()], store)
        .with_artifacts(Some(base), reqwest::Client::new())
        .with_existing_media(keys(&existing))
        .build(now())
        .await
        .unwrap();

    assert!(uploaded(&snapshot).is_empty(), "{:?}", uploaded(&snapshot));
    assert!(
        seen.lock().unwrap().is_empty(),
        "{:?}",
        seen.lock().unwrap()
    );
    assert!(snapshot.unconfirmed_media.is_empty());
    let recorded: Vec<&str> = manifest_of(&snapshot).keys().collect();
    assert_eq!(recorded, existing);
    assert_eq!(
        run_document_json(&snapshot, "r1")["assetMedia"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[tokio::test]
async fn a_record_with_no_replay_list_still_publishes_the_canonical_replay() {
    let (_tmp, store) = empty_store();
    store.write_run_asset("r1", "replay.json", b"{}").unwrap();

    let snapshot = build(adversarial_run("", &[]), store, &[]).await;

    // No module is named, so no controller is looked for.
    assert_eq!(uploaded(&snapshot), ["media/runs/r1/asset/replay.json"]);
    assert_eq!(manifest_of(&snapshot).files.len(), 1);
    assert!(snapshot.unconfirmed_media.is_empty());
}

#[tokio::test]
async fn a_performance_runs_scenarios_and_engine_module_are_published() {
    let (_tmp, store) = empty_store();
    store
        .write_run_asset("r1", "scenario.json", b"{\"s\":0}")
        .unwrap();
    store
        .write_run_asset("r1", "scenario-2.json", b"{\"s\":2}")
        .unwrap();
    store
        .write_run_asset("r1", "engine.wasm", b"\0asm")
        .unwrap();
    // The middle case was answered wrong and records no scenario.
    let run = performance_run(
        &[Some("scenario.json"), None, Some("scenario-2.json")],
        Some("engine.wasm"),
    );

    let snapshot = build(run, store, &[]).await;

    assert_eq!(
        uploaded(&snapshot),
        [
            "media/runs/r1/asset/engine.wasm",
            "media/runs/r1/asset/scenario-2.json",
            "media/runs/r1/asset/scenario.json",
        ]
    );
    assert_eq!(
        object(&snapshot, "media/runs/r1/asset/engine.wasm")
            .unwrap()
            .content_type,
        "application/wasm"
    );
    let parsed = run_document_json(&snapshot, "r1");
    let named: Vec<&str> = parsed["assetMedia"]
        .as_array()
        .unwrap()
        .iter()
        .map(|media| media["file"].as_str().unwrap())
        .collect();
    assert_eq!(named, ["scenario.json", "scenario-2.json", "engine.wasm"]);
    let recorded: Vec<&str> = manifest_of(&snapshot)
        .files
        .iter()
        .map(|file| file.name.as_str())
        .collect();
    assert_eq!(
        recorded,
        [
            "asset/scenario.json",
            "asset/scenario-2.json",
            "asset/engine.wasm"
        ]
    );
}

#[tokio::test]
async fn a_performance_run_with_no_module_and_no_scenario_publishes_nothing() {
    let (_tmp, store) = empty_store();

    let snapshot = build(performance_run(&[None], None), store, &[]).await;

    assert!(uploaded(&snapshot).is_empty());
    assert!(manifest_of(&snapshot).files.is_empty());
    assert!(snapshot.unconfirmed_media.is_empty());
}

#[test]
fn only_flat_names_are_taken_from_a_record_each_once() {
    assert_eq!(
        run_files::flat_names(
            [
                "replay.json",
                "replay-1.json",
                "replay.json",
                "nested/replay-2.json",
                "..",
                "",
                "back\\slash.json",
            ]
            .into_iter()
        ),
        ["replay.json", "replay-1.json"]
    );
}

// --- The files at a tree's root ------------------------------------------------

#[tokio::test]
async fn a_controller_the_store_lost_is_read_from_the_root_of_the_tree() {
    let (_tmp, store) = empty_store();
    let (base, _) = stub_artifacts(files(&[
        ("/runs/r1/media", listing(&["controller.wasm"])),
        ("/runs/r1/asset/replay.json", b"{}".to_vec()),
        ("/runs/r1/root/controller.wasm", b"\0asm:tree".to_vec()),
    ]))
    .await;
    let run = adversarial_run("build/controller.wasm", &["replay.json"]);

    let snapshot = confirming(run, store, base, &[], false).await;

    assert_eq!(
        object(&snapshot, "media/runs/r1/controller.wasm")
            .unwrap()
            .bytes,
        b"\0asm:tree"
    );
    assert!(snapshot.unconfirmed_media.is_empty());
}

#[tokio::test]
async fn a_controller_neither_the_store_nor_the_tree_holds_is_unrecoverable() {
    let (_tmp, store) = empty_store();
    store.write_run_asset("r1", "replay.json", b"{}").unwrap();
    let (base, seen) = stub_artifacts(files(&[("/runs/r1/media", listing(&[]))])).await;
    let run = adversarial_run("build/controller.wasm", &["replay.json"]);

    let snapshot = confirming(run, store, base, &[], false).await;

    assert!(snapshot.unconfirmed_media.is_empty());
    assert_eq!(
        manifest_of(&snapshot).file("controller.wasm"),
        Some(&MediaManifestFile::unrecoverable(
            MediaFileKind::Controller,
            "controller.wasm",
            None
        ))
    );
    assert!(object(&snapshot, "media/runs/r1/controller.wasm").is_none());
    // The listing answered. The root route is not asked for a file the listing
    // does not name; the one other request is the length of the tree's copy of
    // the replay the store holds.
    assert_eq!(
        *seen.lock().unwrap(),
        ["/runs/r1/media", "/runs/r1/asset/replay.json"]
    );
}

#[tokio::test]
async fn a_listing_too_old_to_name_root_files_says_nothing_about_them() {
    // An artifact service from before the root route answers `404` for every
    // name under it. Its listing carries no `root`, and that must not read as a
    // tree that holds no controller.
    let (_tmp, store) = empty_store();
    store.write_run_asset("r1", "replay.json", b"{}").unwrap();
    let (base, _) = stub_artifacts(files(&[("/runs/r1/media", listing_without_root())])).await;
    let run = adversarial_run("build/controller.wasm", &["replay.json"]);

    let snapshot = confirming(run, store, base, &[], false).await;

    assert_eq!(unconfirmed(&snapshot), ["controller.wasm"]);
    assert_eq!(manifest_of(&snapshot).file("controller.wasm"), None);
}

#[tokio::test]
async fn a_root_file_the_tree_lists_and_cannot_serve_leaves_the_run_unconfirmed() {
    let (_tmp, store) = empty_store();
    store.write_run_asset("r1", "replay.json", b"{}").unwrap();
    let (base, _) =
        stub_artifacts(files(&[("/runs/r1/media", listing(&["controller.wasm"]))])).await;
    let run = adversarial_run("build/controller.wasm", &["replay.json"]);

    let snapshot = confirming(run, store, base, &[], false).await;

    assert_eq!(unconfirmed(&snapshot), ["controller.wasm"]);
}

#[tokio::test]
async fn a_code_analysis_the_store_lost_is_read_from_the_root_of_the_tree() {
    let (_tmp, store) = empty_store();
    let (base, _) = stub_artifacts(files(&[
        ("/runs/r1/media", listing(&["code-analysis.json"])),
        (
            "/runs/r1/root/code-analysis.json",
            b"{\"files\":[],\"key\":\"sk-abcdefghijklmnopqrstuvwxyz0123456789\"}".to_vec(),
        ),
    ]))
    .await;
    let mut run = stored_run("r1", "2026-06-17T21:40:00Z");
    run.record.code_analysis = Some(code_analysis_summary());
    let generation = run.record.code_analysis.as_ref().unwrap().analyzer_version;
    let key = format!("media/runs/r1/code-analysis/v{generation}.json");

    let snapshot = confirming(run, store, base, &[], false).await;

    let published = object(&snapshot, &key).expect("the document is published");
    let body = String::from_utf8(published.bytes.clone()).unwrap();
    assert!(!body.contains("sk-abcdefghijklmnopqrstuvwxyz"), "{body}");
    assert!(snapshot.unconfirmed_media.is_empty());
    assert_eq!(
        manifest_of(&snapshot).files,
        [MediaManifestFile::stored(
            MediaFileKind::CodeAnalysis,
            "code-analysis.json",
            key.clone()
        )]
    );
    assert_eq!(run_document_json(&snapshot, "r1")["codeAnalysisKey"], key);
}

#[tokio::test]
async fn a_code_analysis_held_nowhere_is_unrecoverable_and_one_unasked_about_is_not() {
    let mut run = stored_run("r1", "2026-06-17T21:40:00Z");
    run.record.code_analysis = Some(code_analysis_summary());

    // The tree is stored and its listing names no document.
    let (_tmp, store) = answering_store();
    let (base, _) = stub_artifacts(files(&[("/runs/r1/media", listing(&[]))])).await;
    let snapshot = confirming(run.clone(), store, base, &[], false).await;
    assert!(snapshot.unconfirmed_media.is_empty());
    assert_eq!(
        manifest_of(&snapshot).unrecoverable().collect::<Vec<_>>(),
        ["code-analysis.json"]
    );
    assert!(
        run_document_json(&snapshot, "r1")
            .get("codeAnalysisKey")
            .is_none_or(serde_json::Value::is_null)
    );

    // A build that asks the artifact service nothing cannot rule the document
    // lost.
    let (_tmp, store) = empty_store();
    let snapshot = build(run, store, &[]).await;
    assert_eq!(unconfirmed(&snapshot).len(), 1);
    assert!(manifest_of(&snapshot).files.is_empty());
}

// --- The recording of a transcoded video ---------------------------------------

#[tokio::test]
async fn the_recording_of_a_video_already_transcoded_is_published_without_a_transcode() {
    // An earlier build published the mp4. The bytes here are not a video at all,
    // so a transcode would fail and publish them under the recorded name.
    let (_tmp, store) = empty_store();
    store
        .write_run_proof("r1", "rally.webm", b"webm:raw")
        .unwrap();

    let snapshot = build(video_proof_run(), store, &["media/runs/r1/proof/rally.mp4"]).await;

    assert_eq!(
        uploaded(&snapshot),
        ["media/runs/r1/original/proof/rally.webm"]
    );
    let original = object(&snapshot, "media/runs/r1/original/proof/rally.webm").unwrap();
    assert_eq!(
        original.bytes, b"webm:raw",
        "the recording is kept verbatim"
    );
    assert_eq!(original.content_type, "video/webm");
    assert!(snapshot.unconfirmed_media.is_empty());
    // The document keeps naming the mp4.
    let parsed = run_document_json(&snapshot, "r1");
    assert_eq!(
        parsed["proofMedia"][0]["key"],
        "media/runs/r1/proof/rally.mp4"
    );
    assert_eq!(
        manifest_of(&snapshot).files,
        [MediaManifestFile::transcoded(
            MediaFileKind::Proof,
            "proof/rally.webm",
            "media/runs/r1/original/proof/rally.webm",
            "media/runs/r1/proof/rally.mp4"
        )]
    );
}

#[tokio::test]
async fn a_video_with_both_objects_in_the_bucket_is_not_read() {
    let (_tmp, store) = empty_store();
    store
        .write_run_proof("r1", "rally.webm", b"webm:raw")
        .unwrap();
    let (base, seen) = stub_artifacts(HashMap::new()).await;

    let snapshot = SnapshotBuilder::new(vec![video_proof_run()], vec![manifest()], store)
        .with_artifacts(Some(base), reqwest::Client::new())
        .with_existing_media(keys(&[
            "media/runs/r1/proof/rally.mp4",
            "media/runs/r1/original/proof/rally.webm",
        ]))
        .build(now())
        .await
        .unwrap();

    assert!(uploaded(&snapshot).is_empty(), "{:?}", uploaded(&snapshot));
    assert!(seen.lock().unwrap().is_empty());
    assert_eq!(
        manifest_of(&snapshot).files[0].keys().collect::<Vec<_>>(),
        [
            "media/runs/r1/original/proof/rally.webm",
            "media/runs/r1/proof/rally.mp4"
        ]
    );
}

#[tokio::test]
async fn a_failed_transcode_publishes_the_recording_under_two_keys_that_do_not_meet() {
    // Bytes no transcoder accepts, with or without ffmpeg on the machine.
    let (_tmp, store) = empty_store();
    store
        .write_run_proof("r1", "rally.webm", b"not a video")
        .unwrap();

    let snapshot = build(video_proof_run(), store, &[]).await;

    // The recording under `original/`, and the same bytes where the site looks,
    // which the next build replaces with the mp4.
    assert_eq!(
        uploaded(&snapshot),
        [
            "media/runs/r1/original/proof/rally.webm",
            "media/runs/r1/proof/rally.webm",
        ]
    );
    assert_eq!(
        run_document_json(&snapshot, "r1")["proofMedia"][0]["key"],
        "media/runs/r1/proof/rally.webm"
    );
    assert_eq!(unconfirmed(&snapshot), ["proof/rally.mp4"]);
}

#[tokio::test]
async fn the_recordings_of_validation_and_showcase_videos_are_kept_too() {
    let (_tmp, store) = empty_store();
    store
        .write_run_showcase("r1", "clip.webm", b"webm:showcase")
        .unwrap();
    let mut run = stored_run("r1", "2026-06-17T21:40:00Z");
    run.record.showcase = Some(test_cabinet_core::RunShowcase {
        description: "# My Game".to_string(),
        media: vec![test_cabinet_core::ShowcaseMedia {
            file: "clip.webm".to_string(),
            name: "Gameplay".to_string(),
            kind: MediaKind::Video,
        }],
    });

    let snapshot = build(run, store, &["media/runs/r1/showcase/clip.mp4"]).await;

    assert_eq!(
        uploaded(&snapshot),
        ["media/runs/r1/original/showcase/clip.webm"]
    );
    assert_eq!(
        manifest_of(&snapshot).files,
        [MediaManifestFile::transcoded(
            MediaFileKind::Showcase,
            "showcase/clip.webm",
            "media/runs/r1/original/showcase/clip.webm",
            "media/runs/r1/showcase/clip.mp4"
        )]
    );
    let parsed = run_document_json(&snapshot, "r1");
    assert_eq!(parsed["showcaseMedia"][0]["file"], "clip.webm");
    assert_eq!(
        parsed["showcaseMedia"][0]["key"],
        "media/runs/r1/showcase/clip.mp4"
    );
}

#[tokio::test]
async fn a_lost_recording_keeps_the_mp4_made_from_it() {
    // The mp4 is in the bucket. The recording is in none of the bucket, the
    // store and the tree, which the service holds and answers `404` from.
    let (_tmp, store) = answering_store();
    let (base, _) = stub_artifacts(files(&[("/runs/r1/media", listing(&[]))])).await;

    let snapshot = confirming(
        video_proof_run(),
        store,
        base,
        &["media/runs/r1/proof/rally.mp4"],
        false,
    )
    .await;

    assert!(snapshot.unconfirmed_media.is_empty());
    assert!(uploaded(&snapshot).is_empty());
    assert_eq!(
        manifest_of(&snapshot).files,
        [MediaManifestFile::unrecoverable(
            MediaFileKind::Proof,
            "proof/rally.webm",
            Some("media/runs/r1/proof/rally.mp4".to_string())
        )]
    );
    assert_eq!(
        run_document_json(&snapshot, "r1")["proofMedia"][0]["key"],
        "media/runs/r1/proof/rally.mp4"
    );
}

// --- Unrecoverable files -------------------------------------------------------

fn image_proof_run() -> StoredRun {
    proof_run(
        "r1",
        vec![proof("title", "proof/title.png", MediaKind::Image, true)],
    )
}

fn lost_title() -> MediaManifestFile {
    MediaManifestFile::unrecoverable(MediaFileKind::Proof, "proof/title.png", None)
}

#[tokio::test]
async fn a_file_a_stored_tree_answers_404_for_is_unrecoverable() {
    let (_tmp, store) = answering_store();
    let (base, _) = stub_artifacts(files(&[("/runs/r1/media", listing(&[]))])).await;

    let snapshot = confirming(image_proof_run(), store, base, &[], false).await;

    assert!(snapshot.unconfirmed_media.is_empty());
    assert_eq!(manifest_of(&snapshot).files, [lost_title()]);
    assert!(
        run_document_json(&snapshot, "r1")["proofMedia"]
            .as_array()
            .unwrap()
            .is_empty(),
        "the file is left out of the document"
    );
}

#[tokio::test]
async fn a_file_of_a_tree_recorded_as_gone_is_unrecoverable() {
    let (_tmp, store) = answering_store();
    let (base, _) = stub_artifacts(files(&[("/runs/r1/media", no_tree())])).await;

    let snapshot = confirming(image_proof_run(), store, base, &[], true).await;

    assert!(snapshot.unconfirmed_media.is_empty());
    assert_eq!(manifest_of(&snapshot).files, [lost_title()]);
}

#[tokio::test]
async fn a_missing_tree_the_backend_did_not_record_as_gone_is_not_an_answer() {
    let (_tmp, store) = empty_store();
    let (base, _) = stub_artifacts(files(&[("/runs/r1/media", no_tree())])).await;

    let snapshot = confirming(image_proof_run(), store, base, &[], false).await;

    assert_eq!(unconfirmed(&snapshot), ["proof/title.png"]);
    assert!(manifest_of(&snapshot).files.is_empty());
}

#[tokio::test]
async fn a_tree_that_could_not_be_listed_is_not_an_answer() {
    // The listing fails, for a run the backend recorded as having no tree. The
    // record alone is not the artifact service's answer.
    let (_tmp, store) = empty_store();
    let (base, _) = stub_artifacts(HashMap::new()).await;

    let snapshot = confirming(image_proof_run(), store, base, &[], true).await;

    assert_eq!(
        unconfirmed(&snapshot),
        [TREE_LISTING_UNAVAILABLE, "proof/title.png"]
    );
    assert!(manifest_of(&snapshot).files.is_empty());
}

#[tokio::test]
async fn an_artifact_service_that_cannot_be_reached_is_not_an_answer() {
    let (_tmp, store) = empty_store();
    let snapshot = SnapshotBuilder::new(vec![image_proof_run()], vec![manifest()], store)
        .with_media_confirmation(HashSet::new())
        .with_recorded_tree_absence(keys(&["r1"]))
        .build(now())
        .await
        .unwrap();

    assert_eq!(
        unconfirmed(&snapshot),
        [TREE_LISTING_UNAVAILABLE, "proof/title.png"]
    );
    assert!(manifest_of(&snapshot).files.is_empty());
}

#[tokio::test]
async fn a_store_that_could_not_say_is_not_an_answer() {
    // Something is at the file's path that does not read as a file. The store
    // has not answered that the file is absent, whatever the tree says.
    let (_tmp, store) = empty_store();
    std::fs::create_dir_all(store.run_proof_dir("r1").join("title.png")).unwrap();
    let (base, _) = stub_artifacts(files(&[("/runs/r1/media", listing(&[]))])).await;

    let snapshot = confirming(image_proof_run(), store, base, &[], false).await;

    assert_eq!(unconfirmed(&snapshot), ["proof/title.png"]);
    assert!(manifest_of(&snapshot).files.is_empty());
}

#[tokio::test]
async fn a_build_that_asks_the_artifact_service_nothing_rules_no_file_lost() {
    let (_tmp, store) = empty_store();

    let snapshot = build(image_proof_run(), store, &[]).await;

    assert_eq!(unconfirmed(&snapshot), ["proof/title.png"]);
    assert!(manifest_of(&snapshot).files.is_empty());
}

#[tokio::test]
async fn a_file_in_the_bucket_is_never_unrecoverable() {
    let (_tmp, store) = empty_store();
    let (base, _) = stub_artifacts(files(&[("/runs/r1/media", no_tree())])).await;

    let snapshot = confirming(
        image_proof_run(),
        store,
        base,
        &["media/runs/r1/proof/title.png"],
        true,
    )
    .await;

    assert!(snapshot.unconfirmed_media.is_empty());
    assert_eq!(
        manifest_of(&snapshot).files,
        [MediaManifestFile::stored(
            MediaFileKind::Proof,
            "proof/title.png",
            "media/runs/r1/proof/title.png"
        )]
    );
}

// --- A run settled before the definition widened --------------------------------

#[tokio::test]
async fn a_reclaimed_run_has_its_newly_covered_files_published_from_the_store() {
    // The run was confirmed and its tree reclaimed before the confirmation
    // covered the second replay, the controller or the recording. It is not
    // settled any more, so the build evaluates it: the service holds no tree, as
    // the backend recorded, and the store still holds the files.
    let (_tmp, store) = empty_store();
    store
        .write_run_asset("r1", "replay-1.json", b"{\"a\":1}")
        .unwrap();
    store.write_run_controller("r1", b"\0asm").unwrap();
    let (base, _) = stub_artifacts(files(&[("/runs/r1/media", no_tree())])).await;
    let run = adversarial_run("build/controller.wasm", &["replay.json", "replay-1.json"]);

    let snapshot = confirming(run, store, base, &["media/runs/r1/asset/replay.json"], true).await;

    assert_eq!(
        uploaded(&snapshot),
        [
            "media/runs/r1/asset/replay-1.json",
            "media/runs/r1/controller.wasm",
        ]
    );
    assert!(snapshot.unconfirmed_media.is_empty());
    assert_eq!(manifest_of(&snapshot).files.len(), 3);
    assert_eq!(manifest_of(&snapshot).unrecoverable().count(), 0);
}

#[tokio::test]
async fn a_settled_run_is_asked_about_nothing_and_keeps_what_the_bucket_holds() {
    let (_tmp, store) = empty_store();
    let (base, seen) = stub_artifacts(HashMap::new()).await;
    let run = adversarial_run("build/controller.wasm", &["replay.json", "replay-1.json"]);

    let snapshot = SnapshotBuilder::new(vec![run], vec![manifest()], store)
        .with_artifacts(Some(base), reqwest::Client::new())
        .with_existing_media(keys(&[
            "media/runs/r1/asset/replay.json",
            "media/runs/r1/controller.wasm",
        ]))
        .with_media_confirmation(keys(&["r1"]))
        .build(now())
        .await
        .unwrap();

    assert!(
        seen.lock().unwrap().is_empty(),
        "{:?}",
        seen.lock().unwrap()
    );
    assert!(snapshot.unconfirmed_media.is_empty());
    assert!(uploaded(&snapshot).is_empty());
    assert_eq!(
        run_document_json(&snapshot, "r1")["assetMedia"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

// --- The session record --------------------------------------------------------

#[tokio::test]
async fn a_session_record_is_published_under_no_key_and_entered_in_no_manifest() {
    // The record carries its run's whole model conversation. It stays in the
    // backend store, whatever else of the run is published.
    let (_tmp, store) = empty_store();
    store
        .write_run_replay("r1", b"{\"text\":\"the-verbatim-conversation\"}")
        .unwrap();
    store.write_run_asset("r1", "replay.json", b"{}").unwrap();
    let (base, seen) = stub_artifacts(files(&[("/runs/r1/media", listing(&[]))])).await;

    let snapshot = confirming(
        adversarial_run("", &["replay.json"]),
        store,
        base,
        &[],
        false,
    )
    .await;

    assert_eq!(uploaded(&snapshot), ["media/runs/r1/asset/replay.json"]);
    for object in &snapshot.objects {
        assert!(
            !String::from_utf8_lossy(&object.bytes).contains("the-verbatim-conversation"),
            "the conversation leaked into `{}`",
            object.key
        );
    }
    assert!(
        manifest_of(&snapshot)
            .files
            .iter()
            .all(|file| file.name != "replay.json")
    );
    assert!(
        seen.lock()
            .unwrap()
            .iter()
            .all(|path| !path.contains("/root/")),
        "nothing asks the tree for it either"
    );
}
