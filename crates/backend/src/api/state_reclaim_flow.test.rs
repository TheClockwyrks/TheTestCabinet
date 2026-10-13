//! The whole life of a published run's files in the backend's own store, end to
//! end and in one process: a driver's uploads land in the store, a snapshot
//! refresh publishes them to a stand-in bucket and confirms the run, the state
//! sweep removes them from the store, and from then on every route answers with
//! the same bytes read from the bucket, the controllers listing still offers the
//! run, and a second refresh publishes the same run document.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use test_cabinet_core::run_record::RunLinks;
use time::OffsetDateTime;
use tower::ServiceExt;

use super::{AppState, RunFileBucket};
use crate::artifacts::{RetentionPolicy, SweepRules};
use crate::publisher::tests::{
    BUCKET, Bucket, Trees, bucket_client, bucket_publisher, record, run_columns, seed_published,
};
use crate::state_reclaim::{ScheduledPass, StateSweepOutcome, scheduled_pass};

const RUN: &str = "duel";

/// A still that is not text, so a read that passed through a string would show.
const STILL: &[u8] = b"\x89PNG\r\n\x1a\n\x00\xff\xfe\x80 still";
const REPLAY: &[u8] = b"{\"ticks\":1,\"frames\":[]}";
const SECOND_REPLAY: &[u8] = b"{\"ticks\":2,\"frames\":[]}";
const MODULE: &[u8] = b"\0asm\x01\0\0\0\xff\xfe";
const SESSION: &[u8] = b"{\"session\":\"the conversation\"}";

/// The routes a reader fetches the run's files from, and the bytes each serves.
const FILES: [(&str, &[u8]); 4] = [
    ("/runs/duel/proof/title.png", STILL),
    ("/runs/duel/asset/replay.json", REPLAY),
    ("/runs/duel/asset/replay-1.json", SECOND_REPLAY),
    ("/runs/duel/controller.wasm", MODULE),
];

const RULES: SweepRules = SweepRules {
    grace: Duration::from_secs(24 * 3600),
    retention: RetentionPolicy {
        failed: Duration::from_secs(24 * 3600),
        canceled: Duration::from_secs(3600),
        published: true,
        bucket: Some(BUCKET),
    },
};

struct Flow {
    router: Router,
    state: AppState,
    bucket: Arc<Bucket>,
    sweep_bucket: test_cabinet_core::r2::R2Client,
    _dir: tempfile::TempDir,
}

/// A backend whose publisher uploads to a stand-in bucket and records media
/// confirmations, whose routes read that bucket, and whose artifact service holds
/// no tree: everything of the run is in the backend's own store.
async fn flow() -> Flow {
    let (dir, mut state) = super::flow_harness::test_state().await;
    let bucket = Arc::new(Bucket::default());
    let trees = Arc::new(Trees::default());
    state.publisher = bucket_publisher(&dir, &state.db, &bucket, Some(&trees)).await;
    state.run_files = Some(RunFileBucket::new(bucket_client(&bucket).await, BUCKET));
    Flow {
        router: super::router(state.clone()),
        sweep_bucket: bucket_client(&bucket).await,
        state,
        bucket,
        _dir: dir,
    }
}

impl Flow {
    async fn request(&self, method: &str, path: &str, body: &[u8]) -> (StatusCode, Vec<u8>) {
        let request = Request::builder()
            .method(method)
            .uri(path)
            .body(Body::from(body.to_vec()))
            .unwrap();
        let response = self.router.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), 1 << 20)
            .await
            .unwrap()
            .to_vec();
        (status, body)
    }

    async fn get(&self, path: &str) -> (StatusCode, Vec<u8>) {
        self.request("GET", path, b"").await
    }

    /// Upload `body` to `path` as a driver does.
    async fn upload(&self, path: &str, body: &[u8]) {
        let (status, answer) = self.request("POST", path, body).await;
        assert!(
            status.is_success(),
            "{path}: {status} {}",
            String::from_utf8_lossy(&answer)
        );
    }

    /// One pass of the state sweep, now.
    async fn sweep(&self) -> StateSweepOutcome {
        let pass = scheduled_pass(
            &self.state.db,
            &self.state.store,
            Some(&self.sweep_bucket),
            OffsetDateTime::now_utc(),
            &RULES,
        )
        .await;
        match pass {
            ScheduledPass::Complete(outcome) => outcome,
            ScheduledPass::Abandoned(why) => panic!("the pass was abandoned: {}", why.as_str()),
        }
    }

    /// The names of the files the run's folder in the store holds.
    fn stored(&self) -> Vec<String> {
        let folder = self.state.store.run_folder(RUN).unwrap();
        folder.files.into_iter().map(|file| file.name).collect()
    }

    /// The objects the bucket holds under `prefix`.
    fn objects(&self, prefix: &str) -> BTreeMap<String, Vec<u8>> {
        let objects = self.bucket.objects.lock().unwrap();
        objects
            .iter()
            .filter(|(key, _)| key.starts_with(prefix))
            .map(|(key, bytes)| (key.clone(), bytes.clone()))
            .collect()
    }

    /// The ids the controllers listing offers for the run's case.
    async fn controllers(&self) -> Vec<String> {
        let (status, body) = self.get("/adversarial/controllers?testCase=pong").await;
        assert_eq!(status, StatusCode::OK);
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        body["controllers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|controller| controller["id"].as_str().unwrap().to_string())
            .collect()
    }
}

/// Publish an adversarial run that lists a proof still, two replays and a
/// controller module.
async fn seed_run(flow: &Flow) {
    use test_cabinet_core::MediaKind;
    use test_cabinet_core::validation::ProofResult;

    let db = &flow.state.db;
    seed_published(db, RUN, "2026-06-17T21:40:00Z").await;
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
    let mut run = record(RUN);
    run.validation.proofs = vec![ProofResult {
        id: "title".into(),
        name: "title".into(),
        kind: MediaKind::Image,
        dest: "proof/title.png".into(),
        present: true,
        detail: None,
    }];
    run.validation.adversarial = Some(
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
    db.push(&run, &RunLinks::default(), None, None)
        .await
        .unwrap();
    assert!(run_columns(db, RUN).await.published);
}

#[tokio::test]
async fn a_published_run_s_files_leave_the_store_and_are_served_from_the_bucket() {
    let flow = flow().await;
    seed_run(&flow).await;

    // The driver mirrors the run into the backend's store.
    for (path, bytes) in FILES {
        flow.upload(path, bytes).await;
    }
    flow.upload("/runs/duel/replay", SESSION).await;
    assert_eq!(
        flow.stored(),
        [
            "asset/replay-1.json",
            "asset/replay.json",
            "controller.wasm",
            "proof/title.png",
            "replay.json",
        ]
    );
    // What each route serves while the store holds the file.
    for (path, bytes) in FILES {
        let (status, body) = flow.get(path).await;
        assert_eq!(status, StatusCode::OK, "{path}");
        assert_eq!(body, bytes, "{path}");
    }

    // A sweep before any refresh removes nothing: nothing vouches for the bucket.
    let early = flow.sweep().await;
    assert_eq!(early.reclaimed, 0);
    assert_eq!(early.unconfirmed, 1);
    assert_eq!(flow.stored().len(), 5);

    // The refresh publishes every file and confirms the run with its manifest.
    flow.state.publisher.refresh_now().await.unwrap();
    let row = run_columns(&flow.state.db, RUN).await;
    assert!(row.media_confirmed_at.is_some());
    assert_eq!(row.state_reclaimed_at, None);
    let manifest = flow
        .state
        .db
        .run_media_manifest(RUN, Some(BUCKET))
        .await
        .unwrap()
        .expect("a confirmed run has a manifest");
    let media = flow.objects("media/runs/duel/");
    for key in manifest.keys() {
        assert!(media.contains_key(key), "{key}");
    }
    let documents = flow.objects("documents/runs/duel/");
    assert_eq!(documents.len(), 1, "one run document");

    // The session record is published too, under a key of its own.
    assert_eq!(
        manifest
            .file("replay.json")
            .and_then(|file| file.key.as_deref()),
        Some("media/runs/duel/session-record.json")
    );
    assert_eq!(media["media/runs/duel/session-record.json"], SESSION);

    // The sweep removes every file the manifest accounts for, the session
    // record among them.
    let outcome = flow.sweep().await;
    assert_eq!(outcome.reclaimed_published, 1);
    assert_eq!(outcome.removed_files, 5);
    assert_eq!(
        outcome.freed_bytes,
        FILES
            .iter()
            .map(|(_, bytes)| bytes.len() as u64)
            .sum::<u64>()
            + SESSION.len() as u64
    );
    assert_eq!(
        outcome.failed + outcome.kept_unaccounted + outcome.kept_unlisted,
        0
    );
    assert!(flow.stored().is_empty());
    let row = run_columns(&flow.state.db, RUN).await;
    assert_eq!(row.state_reclaimed_reason.as_deref(), Some("published"));
    assert!(row.media_confirmed_at.is_some());

    // Every route still serves every file, byte for byte, now from the bucket.
    for (path, bytes) in FILES {
        let (status, body) = flow.get(path).await;
        assert_eq!(status, StatusCode::OK, "{path}");
        assert_eq!(body, bytes, "{path}");
    }
    let (status, session) = flow.get("/runs/duel/replay").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(session, SESSION);
    // The arena is still offered the run's controller.
    assert_eq!(flow.controllers().await, [RUN]);

    // A second refresh, with the store holding none of the files, publishes the
    // same run document and the same media, and the run stays confirmed.
    flow.state.publisher.refresh_now().await.unwrap();
    assert_eq!(flow.objects("documents/runs/duel/"), documents);
    assert_eq!(flow.objects("media/runs/duel/"), media);
    let again = run_columns(&flow.state.db, RUN).await;
    assert_eq!(again.media_confirmed_at, row.media_confirmed_at);
    assert_eq!(again.media_manifest, row.media_manifest);
    assert_eq!(again.state_reclaimed_at, row.state_reclaimed_at);

    // And the pass after it has nothing left to do.
    let last = flow.sweep().await;
    assert_eq!(last.reclaimed, 0);
    assert!(flow.stored().is_empty());
}

#[tokio::test]
async fn an_upload_after_the_reclaim_is_kept_until_a_refresh_has_published_it() {
    let flow = flow().await;
    seed_run(&flow).await;
    for (path, bytes) in FILES {
        flow.upload(path, bytes).await;
    }
    flow.state.publisher.refresh_now().await.unwrap();
    assert_eq!(flow.sweep().await.reclaimed_published, 1);
    assert!(flow.stored().is_empty());

    // A mirror that runs again uploads a recording image the run did not have.
    flow.upload("/runs/duel/validation/img.late.png", b"late image")
        .await;

    // The upload withdrew the confirmation, so nothing vouches for the bucket
    // and the sweep leaves the file where it is.
    let row = run_columns(&flow.state.db, RUN).await;
    assert_eq!(row.media_confirmed_at, None);
    assert_eq!(row.state_reclaimed_at, None);
    // The manifest stays as the record of where the reclaimed files are, so
    // every one of them is still served, and so is the upload, between the
    // upload and the refresh it asked for.
    assert!(row.media_manifest.is_some());
    for (path, bytes) in FILES {
        let (status, body) = flow.get(path).await;
        assert_eq!(status, StatusCode::OK, "{path}");
        assert_eq!(body, bytes, "{path}");
    }
    let (status, late) = flow.get("/runs/duel/validation/img.late.png").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(late, b"late image");
    assert_eq!(flow.controllers().await, [RUN]);
    let kept = flow.sweep().await;
    assert_eq!(kept.reclaimed, 0);
    assert_eq!(kept.unconfirmed, 1);
    assert_eq!(flow.stored(), ["validation/img.late.png"]);
    // A session record uploaded now is one more file for the refresh to publish.
    flow.upload("/runs/duel/replay", SESSION).await;
    assert_eq!(
        run_columns(&flow.state.db, RUN).await.media_confirmed_at,
        None
    );

    // The refresh the upload asked for publishes the new image beside the files
    // the bucket already holds, and confirms the run with all of them.
    flow.state.publisher.refresh_now().await.unwrap();
    let manifest = flow
        .state
        .db
        .run_media_manifest(RUN, Some(BUCKET))
        .await
        .unwrap()
        .expect("the run is confirmed again");
    let late = manifest
        .file("validation/img.late.png")
        .expect("the manifest names the uploaded image");
    assert_eq!(
        flow.objects("media/runs/duel/")[late.key.as_deref().unwrap()],
        b"late image"
    );
    assert!(manifest.unrecoverable().next().is_none());
    assert!(manifest.file("replay.json").is_some());

    // Now the sweep removes both uploads, and every file is still served.
    let outcome = flow.sweep().await;
    assert_eq!(outcome.reclaimed_published, 1);
    assert_eq!(outcome.removed_files, 2);
    assert!(flow.stored().is_empty());
    for (path, bytes) in FILES {
        let (status, body) = flow.get(path).await;
        assert_eq!(status, StatusCode::OK, "{path}");
        assert_eq!(body, bytes, "{path}");
    }
    let (status, late) = flow.get("/runs/duel/validation/img.late.png").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(late, b"late image");
}

#[tokio::test]
async fn a_run_pushed_again_after_the_reclaim_still_serves_its_files() {
    let flow = flow().await;
    seed_run(&flow).await;
    for (path, bytes) in FILES {
        flow.upload(path, bytes).await;
    }
    flow.state.publisher.refresh_now().await.unwrap();
    assert_eq!(flow.sweep().await.reclaimed_published, 1);
    assert!(flow.stored().is_empty());

    // The record is pushed again, which makes the confirmation one of a record
    // that was replaced. The files it vouched for are where they were.
    let db = &flow.state.db;
    let stored = db.get_run(RUN).await.unwrap().expect("the run is stored");
    db.push(&stored.record, &RunLinks::default(), None, None)
        .await
        .unwrap();
    assert_eq!(
        db.run_media_manifest(RUN, Some(BUCKET)).await.unwrap(),
        None
    );

    for (path, bytes) in FILES {
        let (status, body) = flow.get(path).await;
        assert_eq!(status, StatusCode::OK, "{path}");
        assert_eq!(body, bytes, "{path}");
    }
    assert_eq!(flow.controllers().await, [RUN]);

    // The refresh that follows confirms the run again from the bucket alone.
    flow.state.publisher.refresh_now().await.unwrap();
    assert!(
        db.run_media_manifest(RUN, Some(BUCKET))
            .await
            .unwrap()
            .is_some()
    );
}

#[tokio::test]
async fn a_file_no_refresh_publishes_is_kept_and_the_published_ones_removed() {
    let flow = flow().await;
    seed_run(&flow).await;
    for (path, bytes) in FILES {
        flow.upload(path, bytes).await;
    }
    // A still the run's record does not list: no refresh publishes it, so no
    // manifest names it.
    flow.upload("/runs/duel/proof/unlisted.png", b"unlisted")
        .await;

    flow.state.publisher.refresh_now().await.unwrap();
    assert!(
        run_columns(&flow.state.db, RUN)
            .await
            .media_confirmed_at
            .is_some()
    );
    let outcome = flow.sweep().await;

    // The files the bucket holds go, and the one it does not stays and is
    // served from the store.
    assert_eq!(outcome.reclaimed_published, 1);
    assert_eq!(outcome.removed_files, 4);
    assert_eq!(outcome.kept_unaccounted, 1);
    assert_eq!(flow.stored(), ["proof/unlisted.png"]);
    let (status, body) = flow.get("/runs/duel/proof/unlisted.png").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"unlisted");
    for (path, bytes) in FILES {
        let (status, body) = flow.get(path).await;
        assert_eq!(status, StatusCode::OK, "{path}");
        assert_eq!(body, bytes, "{path}");
    }
}
