//! Tests of the backend's client for the artifacts service's public-dataset
//! routes, against a stub service on an ephemeral port: the bearer token, the
//! request's path, query and headers, and how each status is read.

use std::sync::Mutex;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{OriginalUri, State};
use axum::http::{HeaderMap, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};

use super::*;

const TOKEN: &str = "public-service-token";

/// One request the stub received.
#[derive(Debug, Clone)]
struct Seen {
    method: Method,
    /// The path and query as sent, still percent-encoded.
    uri: String,
    authorization: Option<String>,
    content_type: Option<String>,
    content_encoding: Option<String>,
    body: Vec<u8>,
}

/// The stub's state: what it saw, and the status and body it answers every
/// request with.
struct Stub {
    seen: Mutex<Vec<Seen>>,
    status: StatusCode,
    body: String,
}

async fn record(
    State(stub): State<Arc<Stub>>,
    method: Method,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let header = |name| {
        headers
            .get(name)
            .and_then(|value: &axum::http::HeaderValue| value.to_str().ok())
            .map(str::to_string)
    };
    stub.seen.lock().unwrap().push(Seen {
        method,
        uri: uri.to_string(),
        authorization: header(header::AUTHORIZATION),
        content_type: header(header::CONTENT_TYPE),
        content_encoding: header(header::CONTENT_ENCODING),
        body: body.to_vec(),
    });
    (stub.status, stub.body.clone()).into_response()
}

/// Stand a stub up answering `status` with `body`, and return its base URL.
async fn spawn_stub(status: StatusCode, body: &str) -> (String, Arc<Stub>) {
    let stub = Arc::new(Stub {
        seen: Mutex::new(Vec::new()),
        status,
        body: body.to_string(),
    });
    let app = Router::new().fallback(record).with_state(Arc::clone(&stub));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{addr}"), stub)
}

fn only(stub: &Stub) -> Seen {
    let seen = stub.seen.lock().unwrap();
    assert_eq!(seen.len(), 1, "{seen:#?}");
    seen[0].clone()
}

fn dataset(base: &str) -> PublicDataset {
    PublicDataset::new(reqwest::Client::new(), Some(base), Some(TOKEN)).unwrap()
}

#[test]
fn a_dataset_needs_both_the_url_and_the_token() {
    let http = reqwest::Client::new();
    assert!(PublicDataset::new(http.clone(), None, Some(TOKEN)).is_none());
    assert!(PublicDataset::new(http.clone(), Some("http://a"), None).is_none());
    assert!(PublicDataset::new(http, Some("http://a"), Some(TOKEN)).is_some());
}

#[tokio::test]
async fn a_write_puts_the_bytes_and_labels_at_the_key_with_the_token() {
    let (base, stub) = spawn_stub(StatusCode::CREATED, "{}").await;
    dataset(&format!("{base}/"))
        .put(
            "media/cases/pong/v1.0.0/validation-baseline/2d/base/ab-rally #1.json.gz",
            b"bytes".to_vec(),
            "application/json",
            Some("gzip"),
        )
        .await
        .unwrap();
    let seen = only(&stub);
    assert_eq!(seen.method, Method::PUT);
    assert_eq!(
        seen.uri,
        "/public/media/cases/pong/v1.0.0/validation-baseline/2d/base/ab-rally%20%231.json.gz"
    );
    assert_eq!(
        seen.authorization.as_deref(),
        Some("Bearer public-service-token")
    );
    assert_eq!(seen.content_type.as_deref(), Some("application/json"));
    assert_eq!(seen.content_encoding.as_deref(), Some("gzip"));
    assert_eq!(seen.body, b"bytes");
}

#[tokio::test]
async fn a_write_without_an_encoding_sends_none() {
    let (base, stub) = spawn_stub(StatusCode::CREATED, "{}").await;
    dataset(&base)
        .put("codes/abcd1234", b"run".to_vec(), "text/plain", None)
        .await
        .unwrap();
    assert_eq!(only(&stub).content_encoding, None);
}

#[tokio::test]
async fn a_write_succeeds_only_on_created() {
    for status in [
        StatusCode::OK,
        StatusCode::FORBIDDEN,
        StatusCode::INTERNAL_SERVER_ERROR,
    ] {
        let (base, _stub) = spawn_stub(status, "{}").await;
        let err = dataset(&base)
            .put("index.json", Vec::new(), "application/json", None)
            .await
            .unwrap_err();
        assert!(
            matches!(err, PublicError::Refused { status: got, .. } if got == status),
            "{err:?}"
        );
    }
}

#[tokio::test]
async fn a_listing_sends_the_prefix_as_a_query_and_reads_the_objects() {
    let (base, stub) = spawn_stub(
        StatusCode::OK,
        r#"{"objects":[{"key":"codes/a b","bytes":3,"modifiedAt":"2026-06-17T21:00:00Z"},{"key":"codes/c","bytes":0,"modifiedAt":null}]}"#,
    )
    .await;
    let objects = dataset(&base).list("codes/a b&c").await.unwrap();
    let seen = only(&stub);
    assert_eq!(seen.method, Method::GET);
    assert_eq!(seen.uri, "/public?prefix=codes%2Fa+b%26c");
    assert_eq!(
        seen.authorization.as_deref(),
        Some("Bearer public-service-token")
    );
    assert_eq!(
        objects,
        vec![
            PublicObject {
                key: "codes/a b".to_string(),
                bytes: 3,
                modified_at: Some("2026-06-17T21:00:00Z".to_string()),
            },
            PublicObject {
                key: "codes/c".to_string(),
                bytes: 0,
                modified_at: None,
            },
        ]
    );
}

#[tokio::test]
async fn a_refused_listing_is_an_error() {
    let (base, _stub) = spawn_stub(StatusCode::UNAUTHORIZED, "").await;
    let err = dataset(&base).list_keys("snapshots/").await.unwrap_err();
    assert!(matches!(
        err,
        PublicError::Refused {
            status: StatusCode::UNAUTHORIZED,
            ..
        }
    ));
}

#[tokio::test]
async fn a_delete_succeeds_on_no_content_and_on_not_found() {
    for status in [StatusCode::NO_CONTENT, StatusCode::NOT_FOUND] {
        let (base, stub) = spawn_stub(status, "").await;
        dataset(&base)
            .delete("snapshots/2026-06-17T2148Z-1a7b9c3d/runs.json")
            .await
            .unwrap();
        let seen = only(&stub);
        assert_eq!(seen.method, Method::DELETE);
        assert_eq!(
            seen.uri,
            "/public/snapshots/2026-06-17T2148Z-1a7b9c3d/runs.json"
        );
        assert_eq!(
            seen.authorization.as_deref(),
            Some("Bearer public-service-token")
        );
    }
    let (base, _stub) = spawn_stub(StatusCode::INTERNAL_SERVER_ERROR, "").await;
    assert!(dataset(&base).delete("snapshots/x/y").await.is_err());
}

#[tokio::test]
async fn a_media_copy_reads_the_published_keys() {
    let (base, stub) = spawn_stub(
        StatusCode::OK,
        r#"{"proofMedia":[{"id":"title","kind":"image","key":"media/runs/r1/proof/title.png"}],"validationMedia":[{"file":"a.webm","key":"media/runs/r1/validation/a.mp4"}],"assetMedia":[],"showcaseMedia":[]}"#,
    )
    .await;
    let media = dataset(&base).publish_media("r1").await.unwrap().unwrap();
    let seen = only(&stub);
    assert_eq!(seen.method, Method::POST);
    assert_eq!(seen.uri, "/runs/r1/publish-media");
    assert_eq!(
        seen.authorization.as_deref(),
        Some("Bearer public-service-token")
    );
    assert_eq!(media.proof_media[0].key, "media/runs/r1/proof/title.png");
    assert_eq!(media.validation_media[0].file, "a.webm");
    assert!(media.asset_media.is_empty());
    // What the backend stores is what it read.
    let stored = serde_json::to_string(&media).unwrap();
    assert_eq!(
        serde_json::from_str::<PublishedMedia>(&stored).unwrap(),
        media
    );
}

#[tokio::test]
async fn a_media_copy_for_a_run_with_no_tree_is_none_and_a_failure_is_an_error() {
    let (base, _stub) = spawn_stub(StatusCode::NOT_FOUND, "").await;
    assert_eq!(dataset(&base).publish_media("r1").await.unwrap(), None);
    let (base, _stub) = spawn_stub(StatusCode::INTERNAL_SERVER_ERROR, "").await;
    assert!(dataset(&base).publish_media("r1").await.is_err());
}
