//! Tests for the run file routes' read-through to the bucket: what is served
//! from the store, what from the object a run's manifest names, and that a
//! fault is never answered as a file the run does not have.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use test_cabinet_core::r2::{R2Client, R2Config};
use test_cabinet_core::run_record::RunState;
use tower::ServiceExt;

use super::RunFileBucket;
use crate::api::AppState;
use crate::db::retention_tests::{BUCKET, FIRST, damage_manifest, force_published, seed_run};
use crate::db::tests::{links, record};
use crate::db::{ConfirmedMedia, Db, MediaFileKind, MediaManifest, MediaManifestFile};

const RUN: &str = "r1";

/// A stand-in bucket that answers object reads: the objects it holds, whether
/// it is failing, and every key it was asked for.
#[derive(Default)]
struct Bucket {
    objects: Mutex<BTreeMap<String, Vec<u8>>>,
    failing: AtomicBool,
    asked: Mutex<Vec<String>>,
}

impl Bucket {
    fn put(&self, key: &str, bytes: &[u8]) {
        self.objects
            .lock()
            .unwrap()
            .insert(key.to_string(), bytes.to_vec());
    }

    fn asked(&self) -> Vec<String> {
        self.asked.lock().unwrap().clone()
    }
}

/// Serve `bucket` over HTTP and return the client configuration that reaches it.
async fn spawn_bucket(bucket: Arc<Bucket>) -> R2Config {
    async fn serve(bucket: Arc<Bucket>, request: axum::extract::Request) -> (StatusCode, Vec<u8>) {
        let key = request
            .uri()
            .path()
            .strip_prefix("/bucket/")
            .unwrap_or_default()
            .to_string();
        bucket.asked.lock().unwrap().push(key.clone());
        if bucket.failing.load(Ordering::SeqCst) {
            return (StatusCode::INTERNAL_SERVER_ERROR, Vec::new());
        }
        match bucket.objects.lock().unwrap().get(&key) {
            Some(bytes) => (StatusCode::OK, bytes.clone()),
            None => (
                StatusCode::NOT_FOUND,
                b"<Error><Code>NoSuchKey</Code></Error>".to_vec(),
            ),
        }
    }

    let app = Router::new().fallback(move |request| serve(bucket, request));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    R2Config {
        account_id: "acct".to_string(),
        bucket: "bucket".to_string(),
        access_key_id: "key".to_string(),
        secret_access_key: "secret".to_string(),
        endpoint: format!("http://{addr}"),
        region: "auto".to_string(),
    }
}

/// A backend over an in-memory database and an empty run store, reading a
/// stand-in bucket that confirmations name [`BUCKET`].
struct Harness {
    router: Router,
    state: AppState,
    bucket: Arc<Bucket>,
    _dir: tempfile::TempDir,
}

async fn harness() -> Harness {
    let (dir, mut state) = super::super::flow_harness::test_state().await;
    let bucket = Arc::new(Bucket::default());
    state.run_files = Some(RunFileBucket::new(
        R2Client::new(spawn_bucket(Arc::clone(&bucket)).await),
        BUCKET,
    ));
    Harness {
        router: super::super::router(state.clone()),
        state,
        bucket,
        _dir: dir,
    }
}

/// The same backend with no bucket.
async fn harness_without_a_bucket() -> Harness {
    let (dir, state) = super::super::flow_harness::test_state().await;
    Harness {
        router: super::super::router(state.clone()),
        state,
        bucket: Arc::new(Bucket::default()),
        _dir: dir,
    }
}

/// Store a published run and record its confirmation in `bucket` with
/// `manifest`.
async fn confirm_in(db: &Db, id: &str, bucket: &str, manifest: MediaManifest) {
    seed_run(db, id, RunState::Completed, "2026-06-17T21:30:00Z").await;
    force_published(db, id).await;
    let state = db
        .published_media_states(bucket)
        .await
        .unwrap()
        .into_iter()
        .find(|state| state.id == id)
        .unwrap();
    let recorded = db
        .record_media_confirmation(&[ConfirmedMedia { state, manifest }], &[], FIRST, bucket)
        .await
        .unwrap();
    assert_eq!(recorded.confirmed, 1);
}

async fn confirm(db: &Db, id: &str, files: Vec<MediaManifestFile>) {
    confirm_in(db, id, BUCKET, MediaManifest { files }).await;
}

/// What one `GET` answered.
struct Answer {
    status: StatusCode,
    headers: axum::http::HeaderMap,
    body: Vec<u8>,
}

impl Answer {
    fn header(&self, name: header::HeaderName) -> Option<&str> {
        self.headers.get(name).and_then(|value| value.to_str().ok())
    }
}

async fn get(router: &Router, path: &str) -> Answer {
    get_with(router, path, &[]).await
}

async fn get_with(router: &Router, path: &str, headers: &[(header::HeaderName, &str)]) -> Answer {
    let mut request = Request::builder().uri(path);
    for (name, value) in headers {
        request = request.header(name, *value);
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let body = axum::body::to_bytes(response.into_body(), 1 << 20)
        .await
        .unwrap()
        .to_vec();
    Answer {
        status,
        headers,
        body,
    }
}

fn stored(kind: MediaFileKind, name: &str) -> MediaManifestFile {
    MediaManifestFile::stored(kind, name, format!("media/runs/{RUN}/{name}"))
}

#[tokio::test]
async fn a_file_the_store_holds_is_served_from_the_store() {
    let h = harness().await;
    confirm(
        &h.state.db,
        RUN,
        vec![stored(MediaFileKind::Proof, "proof/title.png")],
    )
    .await;
    h.state
        .store
        .write_run_proof(RUN, "title.png", b"from the store")
        .unwrap();
    h.bucket
        .put("media/runs/r1/proof/title.png", b"from the bucket");

    let answer = get(&h.router, "/runs/r1/proof/title.png").await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(answer.body, b"from the store");
    assert_eq!(h.bucket.asked(), Vec::<String>::new());
}

#[tokio::test]
async fn a_file_the_store_lacks_is_served_from_the_object_its_manifest_names() {
    let h = harness().await;
    confirm(
        &h.state.db,
        RUN,
        vec![
            stored(MediaFileKind::Proof, "proof/title.png"),
            stored(MediaFileKind::Validation, "validation/spin__still.png"),
            stored(MediaFileKind::Asset, "asset/replay-1.json"),
            stored(MediaFileKind::Asset, "asset/engine.wasm"),
            stored(MediaFileKind::Showcase, "showcase/demo.json.gz"),
        ],
    )
    .await;
    for (key, bytes) in [
        ("media/runs/r1/proof/title.png", &b"png"[..]),
        ("media/runs/r1/validation/spin__still.png", b"still"),
        ("media/runs/r1/asset/replay-1.json", b"{\"ticks\":1}"),
        ("media/runs/r1/asset/engine.wasm", b"\0asm"),
        ("media/runs/r1/showcase/demo.json.gz", b"\x1f\x8bgz"),
    ] {
        h.bucket.put(key, bytes);
    }

    let proof = get(&h.router, "/runs/r1/proof/title.png").await;
    assert_eq!(proof.status, StatusCode::OK);
    assert_eq!(proof.body, b"png");
    assert_eq!(proof.header(header::CONTENT_TYPE), Some("image/png"));
    assert_eq!(proof.header(header::CONTENT_LENGTH), Some("3"));
    assert_eq!(proof.header(header::CONTENT_ENCODING), None);

    let still = get(&h.router, "/runs/r1/validation/spin__still.png").await;
    assert_eq!(still.body, b"still");

    let replay = get(&h.router, "/runs/r1/asset/replay-1.json").await;
    assert_eq!(replay.body, b"{\"ticks\":1}");
    assert_eq!(
        replay.header(header::CONTENT_TYPE),
        Some("application/json")
    );

    // The engine module a console instantiates as it streams, which a browser
    // does only under this type.
    let module = get(&h.router, "/runs/r1/asset/engine.wasm").await;
    assert_eq!(module.body, b"\0asm");
    assert_eq!(
        module.header(header::CONTENT_TYPE),
        Some("application/wasm")
    );

    // A gzip-framed recording keeps both labels the store's copy is served
    // under, and its bytes are handed over still framed.
    let recording = get(&h.router, "/runs/r1/showcase/demo.json.gz").await;
    assert_eq!(recording.body, b"\x1f\x8bgz");
    assert_eq!(
        recording.header(header::CONTENT_TYPE),
        Some("application/json")
    );
    assert_eq!(recording.header(header::CONTENT_ENCODING), Some("gzip"));
}

#[tokio::test]
async fn an_object_the_bucket_does_not_hold_answers_404() {
    let h = harness().await;
    confirm(
        &h.state.db,
        RUN,
        vec![stored(MediaFileKind::Proof, "proof/title.png")],
    )
    .await;

    let answer = get(&h.router, "/runs/r1/proof/title.png").await;
    assert_eq!(answer.status, StatusCode::NOT_FOUND);
    assert_eq!(h.bucket.asked(), ["media/runs/r1/proof/title.png"]);
}

#[tokio::test]
async fn a_bucket_that_fails_answers_502_and_never_404() {
    let h = harness().await;
    confirm(
        &h.state.db,
        RUN,
        vec![
            stored(MediaFileKind::Proof, "proof/title.png"),
            stored(MediaFileKind::Controller, "controller.wasm"),
            MediaManifestFile::stored(
                MediaFileKind::CodeAnalysis,
                "code-analysis.json",
                "media/runs/r1/code-analysis/v3.json",
            ),
        ],
    )
    .await;
    h.bucket.put("media/runs/r1/proof/title.png", b"png");
    h.bucket.failing.store(true, Ordering::SeqCst);

    for path in [
        "/runs/r1/proof/title.png",
        "/runs/r1/controller.wasm",
        "/runs/r1/code-analysis",
    ] {
        let answer = get(&h.router, path).await;
        assert_eq!(answer.status, StatusCode::BAD_GATEWAY, "{path}");
        let body: serde_json::Value = serde_json::from_slice(&answer.body).unwrap();
        assert_eq!(body["error"]["code"], "bucket_unavailable", "{path}");
    }

    // The same request once the bucket answers again.
    h.bucket.failing.store(false, Ordering::SeqCst);
    assert_eq!(
        get(&h.router, "/runs/r1/proof/title.png").await.status,
        StatusCode::OK
    );
}

#[tokio::test]
async fn a_bucket_that_cannot_be_reached_answers_502() {
    let (dir, mut state) = super::super::flow_harness::test_state().await;
    // A port nothing listens on: bound, read and released.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    drop(listener);
    state.run_files = Some(RunFileBucket::new(
        R2Client::new(R2Config {
            account_id: "acct".to_string(),
            bucket: "bucket".to_string(),
            access_key_id: "key".to_string(),
            secret_access_key: "secret".to_string(),
            endpoint: format!("http://{addr}"),
            region: "auto".to_string(),
        }),
        BUCKET,
    ));
    confirm(
        &state.db,
        RUN,
        vec![stored(MediaFileKind::Proof, "proof/title.png")],
    )
    .await;
    let router = super::super::router(state);

    let answer = get(&router, "/runs/r1/proof/title.png").await;
    assert_eq!(answer.status, StatusCode::BAD_GATEWAY);
    drop(dir);
}

#[tokio::test]
async fn a_run_with_no_manifest_answers_404_without_asking_the_bucket() {
    let h = harness().await;
    // Published and never confirmed.
    seed_run(
        &h.state.db,
        RUN,
        RunState::Completed,
        "2026-06-17T21:30:00Z",
    )
    .await;
    force_published(&h.state.db, RUN).await;
    // The object happens to be in the bucket. Nothing recorded that it is this
    // run's file, so it is not served.
    h.bucket.put("media/runs/r1/proof/title.png", b"png");

    for path in [
        "/runs/r1/proof/title.png",
        "/runs/r1/validation/x.png",
        "/runs/r1/asset/replay.json",
        "/runs/r1/showcase/title.png",
        "/runs/r1/controller.wasm",
        "/runs/r1/code-analysis",
        "/runs/r1/replay",
        "/runs/unknown/proof/title.png",
    ] {
        assert_eq!(
            get(&h.router, path).await.status,
            StatusCode::NOT_FOUND,
            "{path}"
        );
    }
    assert_eq!(h.bucket.asked(), Vec::<String>::new());
}

#[tokio::test]
async fn a_file_the_manifest_does_not_name_answers_404_without_asking_the_bucket() {
    let h = harness().await;
    confirm(
        &h.state.db,
        RUN,
        vec![stored(MediaFileKind::Proof, "proof/title.png")],
    )
    .await;
    h.bucket.put("media/runs/r1/proof/other.png", b"png");

    let answer = get(&h.router, "/runs/r1/proof/other.png").await;
    assert_eq!(answer.status, StatusCode::NOT_FOUND);
    // A name is matched whole, against the kind's own directory.
    let answer = get(&h.router, "/runs/r1/asset/title.png").await;
    assert_eq!(answer.status, StatusCode::NOT_FOUND);
    assert_eq!(h.bucket.asked(), Vec::<String>::new());
}

#[tokio::test]
async fn a_confirmation_made_in_another_bucket_serves_nothing() {
    let h = harness().await;
    confirm_in(
        &h.state.db,
        RUN,
        "https://r2.test/other",
        MediaManifest {
            files: vec![stored(MediaFileKind::Proof, "proof/title.png")],
        },
    )
    .await;
    h.bucket.put("media/runs/r1/proof/title.png", b"png");

    let answer = get(&h.router, "/runs/r1/proof/title.png").await;
    assert_eq!(answer.status, StatusCode::NOT_FOUND);
    assert_eq!(h.bucket.asked(), Vec::<String>::new());
}

#[tokio::test]
async fn a_transcoded_video_is_served_as_its_recording() {
    let h = harness().await;
    confirm(
        &h.state.db,
        RUN,
        vec![MediaManifestFile::transcoded(
            MediaFileKind::Proof,
            "proof/rally.webm",
            "media/runs/r1/original/proof/rally.webm",
            "media/runs/r1/proof/rally.mp4",
        )],
    )
    .await;
    h.bucket
        .put("media/runs/r1/original/proof/rally.webm", b"webm bytes");
    h.bucket.put("media/runs/r1/proof/rally.mp4", b"mp4 bytes");

    // The console asks by the recorded name and gets the recorded bytes.
    let answer = get(&h.router, "/runs/r1/proof/rally.webm").await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(answer.body, b"webm bytes");
    assert_eq!(answer.header(header::CONTENT_TYPE), Some("video/webm"));
    assert_eq!(
        h.bucket.asked(),
        ["media/runs/r1/original/proof/rally.webm"]
    );

    // The mp4 is a file of the bucket, not of the run: no route names it.
    let answer = get(&h.router, "/runs/r1/proof/rally.mp4").await;
    assert_eq!(answer.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_video_whose_recording_is_lost_is_served_as_its_mp4() {
    let h = harness().await;
    confirm(
        &h.state.db,
        RUN,
        vec![MediaManifestFile::unrecoverable(
            MediaFileKind::Validation,
            "validation/spin__rally.webm",
            Some("media/runs/r1/validation/spin__rally.mp4".to_string()),
        )],
    )
    .await;
    h.bucket
        .put("media/runs/r1/validation/spin__rally.mp4", b"mp4 bytes");

    let answer = get(&h.router, "/runs/r1/validation/spin__rally.webm").await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(answer.body, b"mp4 bytes");
    // Labelled as what the bytes are, under the `.webm` name they were asked by.
    assert_eq!(answer.header(header::CONTENT_TYPE), Some("video/mp4"));
}

#[tokio::test]
async fn a_file_recorded_as_unrecoverable_answers_404_without_asking_the_bucket() {
    let h = harness().await;
    confirm(
        &h.state.db,
        RUN,
        vec![
            MediaManifestFile::unrecoverable(MediaFileKind::Proof, "proof/title.png", None),
            MediaManifestFile::unrecoverable(MediaFileKind::Controller, "controller.wasm", None),
            MediaManifestFile::unrecoverable(
                MediaFileKind::CodeAnalysis,
                "code-analysis.json",
                None,
            ),
        ],
    )
    .await;

    for path in [
        "/runs/r1/proof/title.png",
        "/runs/r1/controller.wasm",
        "/runs/r1/code-analysis",
    ] {
        assert_eq!(
            get(&h.router, path).await.status,
            StatusCode::NOT_FOUND,
            "{path}"
        );
    }
    assert_eq!(h.bucket.asked(), Vec::<String>::new());
}

#[tokio::test]
async fn a_backend_with_no_bucket_serves_the_store_alone() {
    let h = harness_without_a_bucket().await;
    confirm(
        &h.state.db,
        RUN,
        vec![stored(MediaFileKind::Proof, "proof/title.png")],
    )
    .await;

    assert_eq!(
        get(&h.router, "/runs/r1/proof/title.png").await.status,
        StatusCode::NOT_FOUND
    );
    h.state
        .store
        .write_run_proof(RUN, "title.png", b"from the store")
        .unwrap();
    let answer = get(&h.router, "/runs/r1/proof/title.png").await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(answer.body, b"from the store");
}

#[tokio::test]
async fn a_manifest_that_cannot_be_read_answers_500() {
    let h = harness().await;
    confirm(
        &h.state.db,
        RUN,
        vec![stored(MediaFileKind::Proof, "proof/title.png")],
    )
    .await;
    damage_manifest(&h.state.db, RUN).await;

    let answer = get(&h.router, "/runs/r1/proof/title.png").await;
    assert_eq!(answer.status, StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn a_name_the_store_refuses_is_refused_as_before() {
    let h = harness().await;
    confirm(&h.state.db, RUN, Vec::new()).await;
    let answer = get(&h.router, "/runs/r1/proof/..").await;
    assert_eq!(answer.status, StatusCode::BAD_REQUEST);
    assert_eq!(h.bucket.asked(), Vec::<String>::new());
}

#[tokio::test]
async fn code_analysis_is_served_from_either_copy_as_json_a_reader_parses() {
    use std::io::Write;

    let document = br#"{"analyzerVersion":3,"files":[]}"#;
    let h = harness().await;
    confirm(
        &h.state.db,
        RUN,
        vec![MediaManifestFile::stored(
            MediaFileKind::CodeAnalysis,
            "code-analysis.json",
            "media/runs/r1/code-analysis/v3.json",
        )],
    )
    .await;
    // The bucket's copy is the plain document.
    h.bucket
        .put("media/runs/r1/code-analysis/v3.json", document);

    // From the bucket, to a reader that does not accept gzip: the plain
    // document, which is what the object is.
    let answer = get(&h.router, "/runs/r1/code-analysis").await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(answer.body, document);
    assert_eq!(
        answer.header(header::CONTENT_TYPE),
        Some("application/json")
    );
    assert_eq!(answer.header(header::CONTENT_ENCODING), None);
    assert!(
        answer
            .header(header::VARY)
            .is_some_and(|vary| vary.contains("accept-encoding")),
        "{:?}",
        answer.header(header::VARY)
    );

    // To a browser, which does: the router's own compression frames it, labelled
    // as such, so the script still parses the same document.
    let answer = get_with(
        &h.router,
        "/runs/r1/code-analysis",
        &[(header::ACCEPT_ENCODING, "gzip")],
    )
    .await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(
        answer.header(header::CONTENT_TYPE),
        Some("application/json")
    );
    assert_eq!(answer.header(header::CONTENT_ENCODING), Some("gzip"));
    let mut inflated = Vec::new();
    std::io::Read::read_to_end(
        &mut flate2::read::GzDecoder::new(answer.body.as_slice()),
        &mut inflated,
    )
    .unwrap();
    assert_eq!(inflated, document);

    // From the store, which holds it gzipped: handed over framed to a reader
    // that accepts gzip and decoded for one that does not.
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(document).unwrap();
    let gzipped = encoder.finish().unwrap();
    h.state
        .store
        .write_run_code_analysis(RUN, &gzipped)
        .unwrap();
    let asked_before = h.bucket.asked().len();

    let framed = get_with(
        &h.router,
        "/runs/r1/code-analysis",
        &[(header::ACCEPT_ENCODING, "gzip")],
    )
    .await;
    assert_eq!(framed.body, gzipped);
    assert_eq!(framed.header(header::CONTENT_ENCODING), Some("gzip"));
    let plain = get(&h.router, "/runs/r1/code-analysis").await;
    assert_eq!(plain.body, document);
    assert_eq!(plain.header(header::CONTENT_ENCODING), None);
    assert_eq!(h.bucket.asked().len(), asked_before);
}

#[tokio::test]
async fn a_session_record_is_served_from_the_store_alone() {
    let h = harness().await;
    // A manifest never names a session record. Even one that did would not be
    // followed: the route does not read through.
    confirm(
        &h.state.db,
        RUN,
        vec![MediaManifestFile::stored(
            MediaFileKind::Asset,
            "replay.json",
            "media/runs/r1/replay.json",
        )],
    )
    .await;
    h.bucket.put("media/runs/r1/replay.json", b"{}");

    assert_eq!(
        get(&h.router, "/runs/r1/replay").await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(h.bucket.asked(), Vec::<String>::new());

    h.state.store.write_run_replay(RUN, b"{\"v\":1}").unwrap();
    let answer = get(&h.router, "/runs/r1/replay").await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(answer.body, b"{\"v\":1}");
}

/// Store a published adversarial run for the case `pong` and confirm it with
/// `files`.
async fn confirm_adversarial(db: &Db, id: &str, files: Vec<MediaManifestFile>) {
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
            "replays": [],
        }))
        .unwrap(),
    );
    db.push(&adversarial, &links(), None, None).await.unwrap();
    force_published(db, id).await;
    let state = db
        .published_media_states(BUCKET)
        .await
        .unwrap()
        .into_iter()
        .find(|state| state.id == id)
        .unwrap();
    db.record_media_confirmation(
        &[ConfirmedMedia {
            state,
            manifest: MediaManifest { files },
        }],
        &[],
        FIRST,
        BUCKET,
    )
    .await
    .unwrap();
}

/// The ids `GET /adversarial/controllers?testCase=pong` lists, sorted.
async fn listed_controllers(router: &Router) -> Vec<String> {
    let answer = get(router, "/adversarial/controllers?testCase=pong").await;
    assert_eq!(answer.status, StatusCode::OK);
    let body: serde_json::Value = serde_json::from_slice(&answer.body).unwrap();
    let mut ids: Vec<String> = body["controllers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|controller| controller["id"].as_str().unwrap().to_string())
        .collect();
    ids.sort();
    ids
}

fn controller_of(id: &str) -> MediaManifestFile {
    MediaManifestFile::stored(
        MediaFileKind::Controller,
        "controller.wasm",
        format!("media/runs/{id}/controller.wasm"),
    )
}

#[tokio::test]
async fn a_controller_only_the_bucket_holds_is_listed_and_fetched() {
    let h = harness().await;
    let db = &h.state.db;
    // On disk, as every controller is before its run's folder is reclaimed.
    confirm_adversarial(db, "on-disk", Vec::new()).await;
    h.state
        .store
        .write_run_controller("on-disk", b"\0asm disk")
        .unwrap();
    // In the bucket alone, named by the run's manifest.
    confirm_adversarial(db, "in-bucket", vec![controller_of("in-bucket")]).await;
    h.bucket
        .put("media/runs/in-bucket/controller.wasm", b"\0asm bucket");
    // Lost for good: nothing can serve it, so it is not offered.
    confirm_adversarial(
        db,
        "lost",
        vec![MediaManifestFile::unrecoverable(
            MediaFileKind::Controller,
            "controller.wasm",
            None,
        )],
    )
    .await;
    // Confirmed with no controller at all (a forfeit before any module loaded).
    confirm_adversarial(db, "none", Vec::new()).await;

    assert_eq!(
        listed_controllers(&h.router).await,
        ["in-bucket", "on-disk"]
    );

    // The arena's fetch is the same request for both.
    let from_bucket = get(&h.router, "/runs/in-bucket/controller.wasm").await;
    assert_eq!(from_bucket.status, StatusCode::OK);
    assert_eq!(from_bucket.body, b"\0asm bucket");
    assert_eq!(
        from_bucket.header(header::CONTENT_TYPE),
        Some("application/wasm")
    );
    let from_disk = get(&h.router, "/runs/on-disk/controller.wasm").await;
    assert_eq!(from_disk.body, b"\0asm disk");
    assert_eq!(
        get(&h.router, "/runs/lost/controller.wasm").await.status,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn a_backend_with_no_bucket_lists_only_the_controllers_on_disk() {
    let h = harness_without_a_bucket().await;
    confirm_adversarial(&h.state.db, "in-bucket", vec![controller_of("in-bucket")]).await;
    confirm_adversarial(&h.state.db, "on-disk", Vec::new()).await;
    h.state
        .store
        .write_run_controller("on-disk", b"\0asm")
        .unwrap();

    assert_eq!(listed_controllers(&h.router).await, ["on-disk"]);
}

#[tokio::test]
async fn a_damaged_manifest_costs_its_own_run_and_not_the_listing() {
    let h = harness().await;
    confirm_adversarial(&h.state.db, "good", vec![controller_of("good")]).await;
    confirm_adversarial(&h.state.db, "damaged", vec![controller_of("damaged")]).await;
    damage_manifest(&h.state.db, "damaged").await;

    assert_eq!(listed_controllers(&h.router).await, ["good"]);
}
