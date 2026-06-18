use std::sync::Arc;
use std::time::Duration;

use axum::Json;
use axum::extract::{Path, State};
use tempfile::TempDir;

use super::*;
use crate::config::Config;
use crate::db::Db;
use crate::publisher::Publisher;
use crate::store::DefinitionStore;

/// Build an [`AppState`] over a fresh in-memory db and a temp store. The temp dir
/// is returned so the store outlives the state for the test's duration.
fn test_state() -> (TempDir, AppState) {
    let dir = TempDir::new().expect("temp dir");
    let store = DefinitionStore::open(dir.path().join("store")).expect("store");
    let db = Arc::new(Db::open_in_memory().expect("db"));
    let publisher = Publisher::new(
        Arc::clone(&db),
        store.clone(),
        None,
        None,
        Duration::from_millis(5000),
    );
    let config = Config {
        bind: "127.0.0.1:0".to_string(),
        db_path: dir.path().join("db.sqlite"),
        checkout: dir.path().join("checkout"),
        store: dir.path().join("store"),
        r2: None,
        deploy_hook_url: None,
        coalesce: Duration::from_millis(5000),
        reference_browser: None,
    };
    let state = AppState {
        db,
        store,
        publisher,
        config: Arc::new(config),
    };
    (dir, state)
}

#[tokio::test]
async fn post_then_get_round_trips_the_reference() {
    let (_dir, state) = test_state();

    // POST the latest reference for a harness.
    let Json(posted) = post(
        State(state.clone()),
        Json(ContainerIn {
            harness: "claude".to_string(),
            reference: "ghcr.io/theclockwyrks/test-cabinet-claude@sha256:1a7b".to_string(),
        }),
    )
    .await
    .expect("post");
    assert_eq!(posted.harness, "claude");
    assert_eq!(
        posted.reference,
        "ghcr.io/theclockwyrks/test-cabinet-claude@sha256:1a7b"
    );

    // GET /containers/{harness} returns it verbatim.
    let Json(resolved) = resolve(State(state.clone()), Path("claude".to_string()))
        .await
        .expect("resolve");
    assert_eq!(resolved.harness, "claude");
    assert_eq!(
        resolved.reference,
        "ghcr.io/theclockwyrks/test-cabinet-claude@sha256:1a7b"
    );

    // GET /containers lists it.
    let Json(listed) = list(State(state.clone())).await.expect("list");
    assert_eq!(listed.containers.len(), 1);
    assert_eq!(listed.containers[0].harness, "claude");

    // A re-POST overwrites the reference (latest wins).
    let _ = post(
        State(state.clone()),
        Json(ContainerIn {
            harness: "claude".to_string(),
            reference: "ghcr.io/theclockwyrks/test-cabinet-claude@sha256:beef".to_string(),
        }),
    )
    .await
    .expect("re-post");
    let Json(resolved) = resolve(State(state.clone()), Path("claude".to_string()))
        .await
        .expect("resolve");
    assert_eq!(
        resolved.reference,
        "ghcr.io/theclockwyrks/test-cabinet-claude@sha256:beef"
    );
}

#[tokio::test]
async fn resolve_unknown_harness_is_not_found() {
    let (_dir, state) = test_state();
    let err = resolve(State(state), Path("nope".to_string()))
        .await
        .expect_err("not found");
    assert_eq!(err.status, axum::http::StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn post_rejects_empty_fields() {
    let (_dir, state) = test_state();
    let err = post(
        State(state),
        Json(ContainerIn {
            harness: "claude".to_string(),
            reference: "  ".to_string(),
        }),
    )
    .await
    .expect_err("bad request");
    assert_eq!(err.status, axum::http::StatusCode::BAD_REQUEST);
}
