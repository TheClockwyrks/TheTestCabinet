//! The gg session record and code analysis reads, `publish-media`, and the
//! public write, driven through the real router over stores held in memory.

use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use flate2::Compression;
use flate2::write::GzEncoder;
use tower::ServiceExt;

use super::*;
use crate::auth::LOCAL_IDENTITY_HEADER;
use crate::public::MemoryPublicStore;
use crate::publish::testing::{FakeTranscoder, RUN, record};
use crate::store::MemoryStore;
use crate::store::testing::seed;

/// The shared control-plane service token the service under test holds.
const SERVICE_TOKEN: &str = "service-secret";

/// The service under test, the run-tree store and the public store beneath it.
struct Service {
    app: Router,
    store: Arc<ArtifactStore>,
    public: MemoryPublicStore,
}

/// A service with no Access application, holding [`SERVICE_TOKEN`], that
/// accepts bodies of at most `upload_limit` bytes.
fn service(upload_limit: u64) -> Service {
    let store = Arc::new(ArtifactStore::new(Arc::new(MemoryStore::new())));
    let public = MemoryPublicStore::new();
    let state = AppState {
        store: Arc::clone(&store),
        upload_limit,
        backend_url: Arc::new("http://127.0.0.1:9".to_string()),
        http: reqwest::Client::new(),
        service_token: Some(Arc::new(SERVICE_TOKEN.to_string())),
        access: None,
        public: Arc::new(public.clone()),
        transcoder: Arc::new(FakeTranscoder::working()),
    };
    Service {
        app: router(state),
        store,
        public,
    }
}

/// What a request answered.
struct Answer {
    status: StatusCode,
    headers: axum::http::HeaderMap,
    body: Vec<u8>,
}

impl Answer {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).and_then(|value| value.to_str().ok())
    }

    fn json(&self) -> serde_json::Value {
        serde_json::from_slice(&self.body).expect("a JSON body")
    }
}

/// `method uri` with `headers` and `body`.
async fn send(
    app: &Router,
    method: &str,
    uri: &str,
    headers: &[(&str, &str)],
    body: Body,
) -> Answer {
    let mut request = Request::builder().method(method).uri(uri);
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let response = app
        .clone()
        .oneshot(request.body(body).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap()
        .to_vec();
    Answer {
        status,
        headers,
        body,
    }
}

/// A reader's identity on a service with no Access application.
const READER: [(&str, &str); 1] = [(LOCAL_IDENTITY_HEADER, "dev@local")];

/// `document` gzipped.
fn gzip(document: &[u8]) -> Vec<u8> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    std::io::Write::write_all(&mut encoder, document).unwrap();
    encoder.finish().unwrap()
}

#[tokio::test]
async fn the_session_record_and_code_analysis_serve_as_gzipped_json() {
    let service = service(MAX_UPLOAD_BYTES);
    let replay = gzip(br#"{"turns":[]}"#);
    let analysis = gzip(br#"{"files":3}"#);
    seed(
        &service.store,
        "run-1",
        &[
            ("run-record.json", b"{}"),
            ("replay.json.gz", &replay),
            ("code-analysis.json.gz", &analysis),
        ],
    )
    .await;

    for (route, stored) in [("replay", &replay), ("code-analysis", &analysis)] {
        for prefix in ["", "/artifacts"] {
            let uri = format!("{prefix}/runs/run-1/{route}");
            let answer = send(&service.app, "GET", &uri, &READER, Body::empty()).await;
            assert_eq!(answer.status, StatusCode::OK, "{uri}");
            assert_eq!(answer.header("content-type"), Some("application/json"));
            assert_eq!(answer.header("content-encoding"), Some("gzip"));
            let length = stored.len().to_string();
            assert_eq!(answer.header("content-length"), Some(length.as_str()));
            // The stored bytes, not inflated or re-encoded on the way out.
            assert_eq!(&answer.body, stored, "{uri}");
        }
    }
}

#[tokio::test]
async fn a_document_stored_plain_declares_no_encoding() {
    let service = service(MAX_UPLOAD_BYTES);
    seed(
        &service.store,
        "run-1",
        &[("replay.json.gz", br#"{"turns":[]}"#)],
    )
    .await;
    let answer = send(
        &service.app,
        "GET",
        "/runs/run-1/replay",
        &READER,
        Body::empty(),
    )
    .await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(answer.header("content-type"), Some("application/json"));
    assert_eq!(answer.header("content-encoding"), None);
    assert_eq!(answer.body, br#"{"turns":[]}"#);
}

#[tokio::test]
async fn an_absent_document_or_run_is_a_404() {
    let service = service(MAX_UPLOAD_BYTES);
    seed(&service.store, "run-1", &[("run-record.json", b"{}")]).await;
    for uri in [
        "/runs/run-1/replay",
        "/runs/run-1/code-analysis",
        "/runs/run-2/replay",
    ] {
        let answer = send(&service.app, "GET", uri, &READER, Body::empty()).await;
        assert_eq!(answer.status, StatusCode::NOT_FOUND, "{uri}");
    }
    // A reader identity is required, as for every read.
    let answer = send(
        &service.app,
        "GET",
        "/runs/run-1/replay",
        &[],
        Body::empty(),
    )
    .await;
    assert_eq!(answer.status, StatusCode::UNAUTHORIZED);
}

/// A run record of [`RUN`] with one image proof at `shots/title.png`.
fn record_with_a_proof() -> Vec<u8> {
    let proof: test_cabinet_contracts::validation::ProofResult =
        serde_json::from_value(serde_json::json!({
            "id": "title",
            "name": "Title",
            "kind": "image",
            "dest": "shots/title.png",
            "present": true,
        }))
        .unwrap();
    let validation = test_cabinet_contracts::validation::ValidationSummary {
        proofs: vec![proof],
        ..Default::default()
    };
    serde_json::to_vec(&record(validation, None)).unwrap()
}

#[tokio::test]
async fn publishing_media_copies_it_and_answers_the_keys() {
    let service = service(MAX_UPLOAD_BYTES);
    let record = record_with_a_proof();
    seed(
        &service.store,
        RUN,
        &[
            ("run-record.json", &record),
            ("implementation/shots/title.png", b"png:title"),
        ],
    )
    .await;
    let token = format!("Bearer {SERVICE_TOKEN}");
    let auth = [("authorization", token.as_str())];

    let answer = send(
        &service.app,
        "POST",
        "/runs/run-1/publish-media",
        &auth,
        Body::empty(),
    )
    .await;
    assert_eq!(
        answer.status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&answer.body)
    );
    let published = answer.json();
    assert_eq!(
        published["proofMedia"],
        serde_json::json!([{
            "id": "title",
            "kind": "image",
            "key": "media/runs/run-1/proof/title.png",
        }])
    );
    for list in ["validationMedia", "assetMedia", "showcaseMedia"] {
        assert_eq!(published[list], serde_json::json!([]), "{list}");
    }
    let object = service
        .public
        .object("media/runs/run-1/proof/title.png")
        .expect("the proof was published");
    assert_eq!(object.body, b"png:title");
    assert_eq!(object.content_type, "image/png");

    // Idempotent: the same answer, and nothing written again.
    let again = send(
        &service.app,
        "POST",
        "/runs/run-1/publish-media",
        &auth,
        Body::empty(),
    )
    .await;
    assert_eq!(again.status, StatusCode::OK);
    assert_eq!(again.json(), published);
    assert_eq!(service.public.writes().len(), 1);

    // An unknown run is a 404, and a reader cannot publish.
    let unknown = send(
        &service.app,
        "POST",
        "/runs/run-2/publish-media",
        &auth,
        Body::empty(),
    )
    .await;
    assert_eq!(unknown.status, StatusCode::NOT_FOUND);
    let reader = send(
        &service.app,
        "POST",
        "/runs/run-1/publish-media",
        &READER,
        Body::empty(),
    )
    .await;
    assert_eq!(reader.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_public_write_stores_the_body_whole_with_its_labels() {
    let service = service(MAX_UPLOAD_BYTES);
    let token = format!("Bearer {SERVICE_TOKEN}");
    let document = gzip(br#"{"runs":[]}"#);
    let answer = send(
        &service.app,
        "PUT",
        "/public/snapshots/2026-06-17T2140Z-abcd1234/index.json",
        &[
            ("authorization", &token),
            ("content-type", "application/json"),
            ("content-encoding", "gzip"),
        ],
        Body::from(document.clone()),
    )
    .await;
    assert_eq!(answer.status, StatusCode::CREATED);
    assert_eq!(
        answer.json(),
        serde_json::json!({
            "key": "snapshots/2026-06-17T2140Z-abcd1234/index.json",
            "bytes": document.len(),
        })
    );
    let object = service
        .public
        .object("snapshots/2026-06-17T2140Z-abcd1234/index.json")
        .expect("written");
    assert_eq!(object.body, document);
    assert_eq!(object.content_type, "application/json");
    assert_eq!(object.content_encoding.as_deref(), Some("gzip"));

    // A second write replaces the object.
    let answer = send(
        &service.app,
        "PUT",
        "/artifacts/public/index.json",
        &[
            ("authorization", &token),
            ("content-type", "application/json"),
        ],
        Body::from("{\"v\":1}"),
    )
    .await;
    assert_eq!(answer.status, StatusCode::CREATED);
    let answer = send(
        &service.app,
        "PUT",
        "/public/index.json",
        &[
            ("authorization", &token),
            ("content-type", "application/json"),
        ],
        Body::from("{\"v\":2}"),
    )
    .await;
    assert_eq!(answer.status, StatusCode::CREATED);
    let object = service.public.object("index.json").expect("written");
    assert_eq!(object.body, b"{\"v\":2}");
    assert_eq!(object.content_encoding, None);
}

#[tokio::test]
async fn a_public_write_refuses_a_bad_key_or_a_missing_content_type() {
    let service = service(MAX_UPLOAD_BYTES);
    let token = format!("Bearer {SERVICE_TOKEN}");
    let labelled = [
        ("authorization", token.as_str()),
        ("content-type", "image/png"),
    ];
    for uri in [
        "/public/media/../index.json",
        "/public/media//x.png",
        "/public/media/./x.png",
        "/public/media/x/",
        "/public/media%5Cx.png",
    ] {
        let answer = send(&service.app, "PUT", uri, &labelled, Body::from("png")).await;
        assert_eq!(answer.status, StatusCode::BAD_REQUEST, "{uri}");
    }
    let answer = send(
        &service.app,
        "PUT",
        "/public/x.png",
        &[("authorization", &token)],
        Body::from("png"),
    )
    .await;
    assert_eq!(answer.status, StatusCode::BAD_REQUEST);
    assert!(service.public.keys().is_empty());
}

#[tokio::test]
async fn a_public_write_over_the_limit_is_refused_and_leaves_the_old_object() {
    let service = service(8);
    service
        .public
        .insert("index.json", b"old", "application/json");
    let token = format!("Bearer {SERVICE_TOKEN}");
    let auth = [
        ("authorization", token.as_str()),
        ("content-type", "application/json"),
    ];

    // Declared too long: refused before the body is read.
    let answer = send(
        &service.app,
        "PUT",
        "/public/index.json",
        &auth,
        Body::from("0123456789"),
    )
    .await;
    assert_eq!(answer.status, StatusCode::PAYLOAD_TOO_LARGE);

    // Undeclared, streamed past the limit: refused as it is read.
    let chunks: Vec<Result<&'static str, std::io::Error>> = vec![Ok("01234"), Ok("56789")];
    let streamed = Body::from_stream(futures_util::stream::iter(chunks));
    let answer = send(&service.app, "PUT", "/public/index.json", &auth, streamed).await;
    assert_eq!(answer.status, StatusCode::PAYLOAD_TOO_LARGE);

    // A body broken off by the client is the client's fault.
    let chunks: Vec<Result<&'static str, std::io::Error>> =
        vec![Ok("0"), Err(std::io::Error::other("hung up"))];
    let broken = Body::from_stream(futures_util::stream::iter(chunks));
    let answer = send(&service.app, "PUT", "/public/index.json", &auth, broken).await;
    assert_eq!(answer.status, StatusCode::BAD_REQUEST);

    assert_eq!(
        service.public.object("index.json").expect("kept").body,
        b"old"
    );
    assert!(service.public.writes().is_empty());

    // Within the limit, the write lands.
    let answer = send(
        &service.app,
        "PUT",
        "/public/index.json",
        &auth,
        Body::from("new"),
    )
    .await;
    assert_eq!(answer.status, StatusCode::CREATED);
}
