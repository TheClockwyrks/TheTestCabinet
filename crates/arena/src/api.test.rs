//! End-to-end tests for the arena service's HTTP surface, driving the real router
//! against a tiny **stub backend** the test spins up. The stub answers exactly the
//! endpoints the arena fetches from:
//!
//! - `GET /test-cases/{slug}/versions/{version}` (resolve a version — a minimal but
//!   valid adversarial case carrying `[contract]`, `[sandbox]`, `[simulation]`),
//! - `GET /test-cases/{slug}/versions/{version}/artifacts/references/{id}.wasm`
//!   (a baseline's wasm — deliberately *invalid* bytes, so the match forfeits
//!   cleanly without needing a real controller),
//! - `GET /adversarial/controllers?testCase=` (the pushed-controller listing), and
//! - `GET /runs/{id}/controller.wasm` (a pushed run's wasm).
//!
//! With invalid wasm a match still returns a `MatchSummary` (a forfeit, `replay:
//! null`), which is all the happy-path test asserts — no real wasm execution.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Path, Query};
use axum::http::{Request, StatusCode};
use axum::routing::get;
use axum::{Json, Router};
use tower::ServiceExt;

use super::*;
use crate::executor::MatchExecutor;
use crate::tournaments::TournamentRegistry;

/// A minimal but valid adversarial `VersionBody` (camelCase): enough for
/// `canonical_match_setup` to build a match (it needs `contract`, `sandbox` with
/// `fuelPerTick`, and `simulation`).
fn version_json(slug: &str, version: &str) -> serde_json::Value {
    serde_json::json!({
        "slug": slug,
        "version": version,
        "name": "Pacman Arena",
        "difficulty": "medium",
        "tags": ["adversarial"],
        "summary": null,
        "description": null,
        "maxRuntimeSeconds": 600,
        "testType": "adversarial",
        "contract": { "entry": "controller", "world": "world.wit", "action": "action.wit" },
        "sandbox": { "fuelPerTick": 1_000_000, "maxMemoryBytes": 16_777_216u64 },
        "simulation": { "timestepMs": 16, "maxTicks": 1024 },
        "promptTemplate": "build a controller",
        "commonSpecs": [],
        "assets": [],
        "variants": [],
        "commonReferences": [],
        "checks": []
    })
}

/// Spawn the stub backend on an ephemeral port and return its base URL. It answers
/// the four endpoints the arena fetches controller inputs from.
async fn spawn_stub_backend() -> String {
    let app = Router::new()
        .route(
            "/test-cases/{slug}/versions/{version}",
            get(|Path((slug, version)): Path<(String, String)>| async move {
                Json(version_json(&slug, &version))
            }),
        )
        .route(
            // A baseline's wasm, addressed as references/{id}.wasm. Invalid bytes:
            // the match forfeits cleanly rather than needing a real module.
            "/test-cases/{slug}/versions/{version}/artifacts/{*key}",
            get(
                |Path((_slug, _version, _key)): Path<(String, String, String)>| async move {
                    (
                        [(axum::http::header::CONTENT_TYPE, "application/wasm")],
                        b"\0not-wasm".to_vec(),
                    )
                },
            ),
        )
        .route(
            "/runs/{id}/controller.wasm",
            get(|Path(_id): Path<String>| async move {
                (
                    [(axum::http::header::CONTENT_TYPE, "application/wasm")],
                    b"\0not-wasm".to_vec(),
                )
            }),
        )
        .route(
            "/adversarial/controllers",
            get(
                |Query(params): Query<std::collections::HashMap<String, String>>| async move {
                    let _ = params;
                    Json(serde_json::json!({
                        "controllers": [
                            { "id": "run-xyz", "kind": "pushed", "label": "claude" }
                        ]
                    }))
                },
            ),
        );

    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
        .await
        .unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

/// Build the arena router pointed at `backend_url`, with the given executor cap.
fn app(backend_url: &str, cap: usize) -> Router {
    let state = AppState {
        backend_url: Arc::new(backend_url.trim_end_matches('/').to_string()),
        tournaments: TournamentRegistry::new(),
        executor: Arc::new(MatchExecutor::new(cap)),
    };
    super::router(state)
}

#[tokio::test]
async fn run_match_between_baselines_returns_a_summary() {
    let backend = spawn_stub_backend().await;
    let app = app(&backend, 2);

    let body = serde_json::json!({
        "testCase": "pacman",
        "version": "1.0.0",
        "red": { "id": "random", "kind": "baseline" },
        "blue": { "id": "greedy-raider", "kind": "baseline" }
    });
    let request = Request::builder()
        .method("POST")
        .uri("/matches")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    // The summary is always present; with invalid wasm the replay is null (a
    // clean forfeit), which is exactly the shape the console reads.
    assert!(parsed.get("summary").is_some(), "got: {parsed}");
    assert!(
        parsed.get("replay").is_some(),
        "replay key present: {parsed}"
    );
    assert!(
        parsed["replay"].is_null(),
        "invalid wasm forfeits: {parsed}"
    );
}

#[tokio::test]
async fn controllers_lists_baselines_and_pushed() {
    let backend = spawn_stub_backend().await;
    let app = app(&backend, 2);

    let request = Request::builder()
        .method("GET")
        .uri("/matches/controllers?testCase=pacman")
        .body(Body::empty())
        .unwrap();
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let controllers = parsed["controllers"].as_array().unwrap();
    // The committed arena opponents (baselines + hidden references) plus the one
    // pushed controller the stub lists.
    let ids: Vec<&str> = controllers
        .iter()
        .map(|c| c["id"].as_str().unwrap())
        .collect();
    assert!(ids.contains(&"random"), "baselines present: {ids:?}");
    assert!(ids.contains(&"run-xyz"), "pushed merged in: {ids:?}");
}

#[tokio::test]
async fn an_unknown_baseline_is_rejected_400() {
    let backend = spawn_stub_backend().await;
    let app = app(&backend, 2);

    let body = serde_json::json!({
        "testCase": "pacman",
        "version": "1.0.0",
        "red": { "id": "no-such-baseline", "kind": "baseline" },
        "blue": { "id": "random", "kind": "baseline" }
    });
    let request = Request::builder()
        .method("POST")
        .uri("/matches")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_run_local_controller_is_rejected_400() {
    let backend = spawn_stub_backend().await;
    let app = app(&backend, 2);

    // A `run` (local-out-dir) controller is not resolvable in the service topology.
    let body = serde_json::json!({
        "testCase": "pacman",
        "version": "1.0.0",
        "red": { "id": "run-local", "kind": "run" },
        "blue": { "id": "random", "kind": "baseline" }
    });
    let request = Request::builder()
        .method("POST")
        .uri("/matches")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
