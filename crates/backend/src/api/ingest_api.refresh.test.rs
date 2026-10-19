//! `POST /ingest` with `refresh`, driven through the assembled router against a
//! stub ingest sidecar on an ephemeral port: the refresh is asked for only when
//! the body says so and a sidecar is configured, a failed suites update reaches
//! the feed as its first line, and any other refresh failure answers before the
//! scan.
//!
//! Each test owns the process environment (nextest runs one process per test) and
//! resolves its configuration through [`Config::from_env`], so the variable a
//! deployment sets is the variable under test.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::routing::post;
use tower::ServiceExt;

use crate::api::{AppState, router};
use crate::config::Config;
use crate::db::Db;
use crate::publish_relay::PublishRelay;
use crate::publisher::{Publisher, PublisherTiming};
use crate::readiness::Readiness;
use crate::relay::Relay;
use crate::store::DefinitionStore;

/// The shared control-plane service token the ingest route takes.
const SERVICE_TOKEN: &str = "service-secret";

/// A stub sidecar refresh endpoint answering `status` with `body`, returning its
/// URL and how many times it was called.
async fn spawn_sidecar(status: StatusCode, body: &'static str) -> (String, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let app = Router::new().route(
        "/cgi-bin/refresh",
        post({
            let calls = Arc::clone(&calls);
            move || {
                calls.fetch_add(1, Ordering::SeqCst);
                async move { (status, body) }
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{addr}/cgi-bin/refresh"), calls)
}

/// A router over an empty checkout, with `refresh_url` as the sidecar's endpoint.
async fn backend(refresh_url: Option<&str>) -> (Router, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    for tree in ["test-cases", "game-jams", "test-case-groups", "test-suites"] {
        std::fs::create_dir_all(dir.path().join(tree)).unwrap();
    }
    // SAFETY: nextest runs each test in its own process, so this environment is
    // this test's alone.
    unsafe {
        std::env::set_var("TCAB_BACKEND_CHECKOUT", dir.path());
        std::env::set_var("TCAB_BACKEND_STORE", dir.path().join("store"));
        std::env::set_var("TCAB_BACKEND_SERVICE_TOKEN", SERVICE_TOKEN);
        match refresh_url {
            Some(url) => std::env::set_var("TCAB_BACKEND_INGEST_REFRESH_URL", url),
            None => std::env::remove_var("TCAB_BACKEND_INGEST_REFRESH_URL"),
        }
    }
    let config = Arc::new(Config::from_env().unwrap());
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let store = DefinitionStore::open(&config.store).unwrap();
    let publisher = Publisher::new(
        Arc::clone(&db),
        store.clone(),
        None,
        None,
        None,
        None,
        PublisherTiming {
            coalesce: config.coalesce,
            snapshot_retention: config.snapshot_retention,
        },
    );
    let state = AppState {
        db,
        store,
        ready: Readiness::new(true),
        publisher,
        access: None,
        relay: Relay::new(),
        publish_relay: PublishRelay::new(),
        config,
        http: reqwest::Client::new(),
        prices: crate::pricing::OpenRouterPrices::with_endpoint("http://127.0.0.1:0/models"),
        gg_docs: crate::gg_docs::GgDocIndex::new(),
    };
    (router(state), dir)
}

/// Post `body` to `/ingest` asking for the feed, and return the status and the
/// response lines.
async fn ingest(router: &Router, body: &str) -> (StatusCode, Vec<serde_json::Value>) {
    let request = Request::builder()
        .method("POST")
        .uri("/ingest")
        .header("authorization", format!("Bearer {SERVICE_TOKEN}"))
        .header("content-type", "application/json")
        .header("accept", "application/x-ndjson")
        .body(Body::from(body.to_owned()))
        .unwrap();
    let response = router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
        .await
        .unwrap();
    let lines = String::from_utf8(bytes.to_vec())
        .unwrap()
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    (status, lines)
}

#[tokio::test]
async fn a_refreshed_ingest_calls_the_sidecar_before_the_scan() {
    let (url, calls) = spawn_sidecar(StatusCode::OK, r#"{"suitesUpdated":true}"#).await;
    let (router, _dir) = backend(Some(&url)).await;
    let (status, lines) = ingest(&router, r#"{"refresh":true}"#).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(
        lines.iter().all(|line| line["event"] != "notice"),
        "{lines:?}"
    );
    assert_eq!(lines.last().unwrap()["event"], "done", "{lines:?}");
}

#[tokio::test]
async fn an_ingest_without_refresh_leaves_the_sidecar_alone() {
    let (url, calls) = spawn_sidecar(StatusCode::OK, r#"{"suitesUpdated":true}"#).await;
    let (router, _dir) = backend(Some(&url)).await;
    let (status, _) = ingest(&router, r#"{"force":true}"#).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_backend_with_no_sidecar_ignores_refresh() {
    let (router, _dir) = backend(None).await;
    let (status, lines) = ingest(&router, r#"{"refresh":true}"#).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(lines.last().unwrap()["event"], "done", "{lines:?}");
}

#[tokio::test]
async fn a_failed_suites_update_opens_the_feed_with_the_notice_and_scans() {
    let (url, _) = spawn_sidecar(StatusCode::OK, r#"{"suitesUpdated":false}"#).await;
    let (router, _dir) = backend(Some(&url)).await;
    let (status, lines) = ingest(&router, r#"{"refresh":true}"#).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        lines[0],
        serde_json::json!({
            "event": "notice",
            "message": "ingest: test suites update failed; ingesting without them",
        })
    );
    assert_eq!(lines.last().unwrap()["event"], "done", "{lines:?}");
}

#[tokio::test]
async fn any_other_refresh_failure_fails_the_ingest_before_the_scan() {
    let (url, _) = spawn_sidecar(
        StatusCode::INTERNAL_SERVER_ERROR,
        "fatal: unable to access the mirror",
    )
    .await;
    let (router, _dir) = backend(Some(&url)).await;
    let (status, lines) = ingest(&router, r#"{"refresh":true}"#).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    // One error envelope, and no feed: nothing was scanned.
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert_eq!(lines[0]["error"]["code"], "ingest_refresh_failed");
    assert!(
        lines[0]["error"]["message"]
            .as_str()
            .unwrap()
            .contains("unable to access the mirror"),
        "{lines:?}"
    );
}
