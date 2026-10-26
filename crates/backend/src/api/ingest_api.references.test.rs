//! Reference-sheet discovery at ingest: the backend lists `media/references/`
//! through the artifacts service's `GET /public?prefix=` with the service token
//! and reconciles `case_reference_sheet` to the frames it finds, against a stub
//! service on an ephemeral port.
//!
//! Each test owns the process environment (nextest runs one process per test) and
//! resolves its configuration through [`Config::from_env`].

use std::sync::{Arc, Mutex};

use axum::Router;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;

use crate::api::AppState;
use crate::config::Config;
use crate::db::{Db, ReferenceSheetEntry};
use crate::publish_relay::PublishRelay;
use crate::publisher::{Publisher, PublisherTiming};
use crate::readiness::Readiness;
use crate::relay::Relay;
use crate::store::DefinitionStore;

const SERVICE_TOKEN: &str = "service-secret";

/// What the stub saw and how it answers `GET /public`.
struct Stub {
    /// The prefixes it was asked to list, each with whether the token came with it.
    asked: Mutex<Vec<(String, bool)>>,
    status: StatusCode,
    keys: Vec<&'static str>,
}

async fn list(
    State(stub): State<Arc<Stub>>,
    headers: HeaderMap,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> Response {
    let authed = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        == Some(&format!("Bearer {SERVICE_TOKEN}"));
    let prefix = query.get("prefix").cloned().unwrap_or_default();
    stub.asked.lock().unwrap().push((prefix.clone(), authed));
    if stub.status != StatusCode::OK {
        return stub.status.into_response();
    }
    let objects: Vec<serde_json::Value> = stub
        .keys
        .iter()
        .filter(|key| key.starts_with(&prefix))
        .map(|key| serde_json::json!({ "key": key, "bytes": 1, "modifiedAt": null }))
        .collect();
    axum::Json(serde_json::json!({ "objects": objects })).into_response()
}

async fn spawn_stub(status: StatusCode, keys: Vec<&'static str>) -> (String, Arc<Stub>) {
    let stub = Arc::new(Stub {
        asked: Mutex::new(Vec::new()),
        status,
        keys,
    });
    let app = Router::new()
        .route("/public", get(list))
        .with_state(Arc::clone(&stub));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{addr}"), stub)
}

/// The backend's state, with `artifacts_url` as the artifacts service's URL and a
/// reference sheet for `pong v1.0.0 base` already recorded.
async fn state(artifacts_url: Option<&str>) -> (AppState, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    // SAFETY: nextest runs each test in its own process, so this environment is
    // this test's alone.
    unsafe {
        std::env::set_var("TCAB_BACKEND_CHECKOUT", dir.path());
        std::env::set_var("TCAB_BACKEND_STORE", dir.path().join("store"));
        std::env::set_var("TCAB_BACKEND_SERVICE_TOKEN", SERVICE_TOKEN);
        match artifacts_url {
            Some(url) => std::env::set_var("TCAB_ARTIFACTS_URL", url),
            None => std::env::remove_var("TCAB_ARTIFACTS_URL"),
        }
    }
    let config = Arc::new(Config::from_env().unwrap());
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    db.sync_reference_sheets(
        &[ReferenceSheetEntry {
            slug: "pong".to_string(),
            version: "v1.0.0".to_string(),
            variant: "base".to_string(),
            frames: vec![0],
        }],
        "2026-06-17T00:00:00Z",
    )
    .await
    .unwrap();
    let store = DefinitionStore::open(&config.store).unwrap();
    let publisher = Publisher::new(
        Arc::clone(&db),
        store.clone(),
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
    (state, dir)
}

async fn sheets(state: &AppState, slug: &str) -> std::collections::HashMap<String, Vec<u32>> {
    state
        .db
        .reference_sheets_for_version(slug, "v1.0.0")
        .await
        .unwrap()
}

#[tokio::test]
async fn ingest_reconciles_the_sheets_to_the_listed_frames() {
    let (url, stub) = spawn_stub(
        StatusCode::OK,
        vec![
            "media/references/sprite/v1.0.0/base/frames/0.png",
            "media/references/sprite/v1.0.0/base/frames/0.actions.json",
            "media/references/sprite/v1.0.0/base/frames/2.png",
            "media/runs/r1/proof/title.png",
        ],
    )
    .await;
    let (state, _dir) = state(Some(&url)).await;

    super::reconcile_reference_sheets(&state).await;

    assert_eq!(
        *stub.asked.lock().unwrap(),
        vec![("media/references/".to_string(), true)]
    );
    assert_eq!(
        sheets(&state, "sprite").await,
        std::collections::HashMap::from([("base".to_string(), vec![0, 2])])
    );
    // The listing is the whole published set, so a sheet it no longer names is gone.
    assert!(sheets(&state, "pong").await.is_empty());
}

#[tokio::test]
async fn an_empty_listing_reconciles_to_empty() {
    let (url, _stub) = spawn_stub(StatusCode::OK, vec![]).await;
    let (state, _dir) = state(Some(&url)).await;
    super::reconcile_reference_sheets(&state).await;
    assert!(sheets(&state, "pong").await.is_empty());
}

#[tokio::test]
async fn a_failed_listing_leaves_the_sheets_as_they_are() {
    let (url, _stub) = spawn_stub(StatusCode::INTERNAL_SERVER_ERROR, vec![]).await;
    let (state, _dir) = state(Some(&url)).await;
    super::reconcile_reference_sheets(&state).await;
    assert_eq!(
        sheets(&state, "pong").await,
        std::collections::HashMap::from([("base".to_string(), vec![0])])
    );
}

#[tokio::test]
async fn without_the_artifacts_service_the_sheets_are_left_alone() {
    let (state, _dir) = state(None).await;
    super::reconcile_reference_sheets(&state).await;
    assert_eq!(
        sheets(&state, "pong").await,
        std::collections::HashMap::from([("base".to_string(), vec![0])])
    );
}
