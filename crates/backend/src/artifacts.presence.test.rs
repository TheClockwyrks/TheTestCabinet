//! Tests for what the backend knows about a run's stored tree: the one-run
//! presence query, the reconciliation a sweep pass makes, and the pass as a whole.
//!
//! [`spawn_artifact_stub`] is a stand-in artifact service that also serves the
//! publish-gate tests under `api/`, so the real `reqwest` paths run everywhere the
//! backend asks about a tree.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use axum::Json;
use axum::Router;
use axum::extract::Path as AxumPath;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::get;
use time::OffsetDateTime;

use super::*;
use crate::db::Db;
use crate::db::tests::{links, record};

/// The service token the stub requires as a bearer.
pub(crate) const STUB_TOKEN: &str = "service-secret";

/// A stand-in artifact service: the trees it holds, how it answers a presence
/// query, and what it was asked.
pub(crate) struct ArtifactStub {
    /// The run ids the stub holds a tree for.
    pub trees: Mutex<HashSet<String>>,
    /// The status `GET /runs/{id}/artifacts` answers with. `200` answers the
    /// truth; anything else answers that status with no body.
    pub presence_status: Mutex<StatusCode>,
    /// The run ids a presence query was made for, in order.
    pub asked: Mutex<Vec<String>>,
    /// The run ids a delete was made for, in order.
    pub deleted: Mutex<Vec<String>>,
}

impl ArtifactStub {
    /// The run ids asked about so far.
    pub fn asked(&self) -> Vec<String> {
        self.asked.lock().unwrap().clone()
    }
}

fn has_token(headers: &HeaderMap) -> bool {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        == Some(&format!("Bearer {STUB_TOKEN}"))
}

/// Spawn the stub holding a tree for each of `trees`, and return its base URL with
/// its shared state. Every tree is listed as written long ago, so a tree with no
/// run behind it is past any grace window.
pub(crate) async fn spawn_artifact_stub(trees: &[&str]) -> (String, Arc<ArtifactStub>) {
    let stub = Arc::new(ArtifactStub {
        trees: Mutex::new(trees.iter().map(|id| id.to_string()).collect()),
        presence_status: Mutex::new(StatusCode::OK),
        asked: Mutex::new(Vec::new()),
        deleted: Mutex::new(Vec::new()),
    });
    let app = Router::new()
        .route(
            "/runs",
            get({
                let stub = Arc::clone(&stub);
                move |headers: HeaderMap| {
                    let stub = Arc::clone(&stub);
                    async move {
                        if !has_token(&headers) {
                            return (StatusCode::UNAUTHORIZED, Json(serde_json::Value::Null));
                        }
                        let mut ids: Vec<String> =
                            stub.trees.lock().unwrap().iter().cloned().collect();
                        ids.sort();
                        let runs: Vec<serde_json::Value> = ids
                            .into_iter()
                            .map(|id| {
                                serde_json::json!({
                                    "id": id,
                                    "modifiedAt": "2026-01-01T00:00:00Z",
                                })
                            })
                            .collect();
                        (StatusCode::OK, Json(serde_json::json!({ "runs": runs })))
                    }
                }
            }),
        )
        .route(
            "/runs/{id}/artifacts",
            get({
                let stub = Arc::clone(&stub);
                move |AxumPath(id): AxumPath<String>, headers: HeaderMap| {
                    let stub = Arc::clone(&stub);
                    async move {
                        if !has_token(&headers) {
                            return (StatusCode::UNAUTHORIZED, Json(serde_json::Value::Null));
                        }
                        stub.asked.lock().unwrap().push(id.clone());
                        let status = *stub.presence_status.lock().unwrap();
                        if status != StatusCode::OK {
                            return (status, Json(serde_json::Value::Null));
                        }
                        let stored = stub.trees.lock().unwrap().contains(&id);
                        (
                            StatusCode::OK,
                            Json(serde_json::json!({ "id": id, "stored": stored })),
                        )
                    }
                }
            })
            .delete({
                let stub = Arc::clone(&stub);
                move |AxumPath(id): AxumPath<String>, headers: HeaderMap| {
                    let stub = Arc::clone(&stub);
                    async move {
                        if !has_token(&headers) {
                            return StatusCode::UNAUTHORIZED;
                        }
                        stub.trees.lock().unwrap().remove(&id);
                        stub.deleted.lock().unwrap().push(id);
                        StatusCode::NO_CONTENT
                    }
                }
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (format!("http://{addr}"), stub)
}

/// A base URL nothing answers on: a listener bound, then dropped.
pub(crate) async fn unreachable_base() -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    drop(listener);
    format!("http://{addr}")
}

fn ids(ids: &[&str]) -> HashSet<String> {
    ids.iter().map(|id| id.to_string()).collect()
}

async fn db_with(runs: &[&str]) -> Db {
    let db = Db::connect_in_memory().await.unwrap();
    for id in runs {
        db.push(&record(id), &links(), None, None).await.unwrap();
    }
    db
}

#[tokio::test]
async fn a_run_with_a_tree_is_reported_stored_and_one_without_is_not() {
    let (base, stub) = spawn_artifact_stub(&["here"]).await;
    let http = reqwest::Client::new();

    assert!(
        run_tree_stored(&http, &base, STUB_TOKEN, "here")
            .await
            .unwrap()
    );
    assert!(
        !run_tree_stored(&http, &base, STUB_TOKEN, "gone")
            .await
            .unwrap()
    );
    assert_eq!(stub.asked(), ["here", "gone"]);
}

#[tokio::test]
async fn a_refusing_service_is_an_error_not_an_absent_tree() {
    // A `404` in particular: the service answers absence in a `200`, so a `404` is
    // a route that is not there (an older service, a wrong URL), and reading it as
    // "no tree" would refuse every publish.
    let (base, stub) = spawn_artifact_stub(&["here"]).await;
    let http = reqwest::Client::new();
    for status in [
        StatusCode::NOT_FOUND,
        StatusCode::INTERNAL_SERVER_ERROR,
        StatusCode::BAD_GATEWAY,
    ] {
        *stub.presence_status.lock().unwrap() = status;
        let err = run_tree_stored(&http, &base, STUB_TOKEN, "here")
            .await
            .expect_err("a non-success status is not an answer");
        assert!(
            matches!(err, TreePresenceError::Refused(got) if got == status),
            "got {err:?}"
        );
    }
}

#[tokio::test]
async fn a_wrong_token_is_an_error() {
    let (base, _stub) = spawn_artifact_stub(&["here"]).await;
    let err = run_tree_stored(&reqwest::Client::new(), &base, "not-the-secret", "here")
        .await
        .expect_err("the stub requires its token");
    assert!(matches!(
        err,
        TreePresenceError::Refused(StatusCode::UNAUTHORIZED)
    ));
}

#[tokio::test]
async fn an_unreachable_service_is_an_error() {
    let base = unreachable_base().await;
    let err = run_tree_stored(&reqwest::Client::new(), &base, STUB_TOKEN, "here")
        .await
        .expect_err("nothing is listening");
    assert!(
        matches!(err, TreePresenceError::Transport(_)),
        "got {err:?}"
    );
}

/// The rules these passes run by: the orphan rule with an hour's grace, and no
/// tree of a run that exists deleted. The retention rules have their own tests.
const ORPHANS_ONLY: SweepRules = SweepRules {
    grace: Duration::from_secs(3600),
    retention: RetentionPolicy::KEEP_EVERYTHING,
};

fn listed(ids: &[&str]) -> Vec<StoredTree> {
    ids.iter()
        .map(|id| StoredTree {
            id: id.to_string(),
            modified_at: OffsetDateTime::UNIX_EPOCH,
        })
        .collect()
}

#[tokio::test]
async fn reconciling_marks_each_run_from_the_listing() {
    let db = db_with(&["kept", "lost"]).await;

    let outcome = reconcile_presence(&db, &ids(&["kept", "lost"]), &listed(&["kept"]))
        .await
        .unwrap();

    assert_eq!(outcome.marked_stored, 1);
    assert_eq!(outcome.marked_not_stored, 1);
    assert_eq!(db.run_artifacts_stored("kept").await.unwrap(), Some(true));
    assert_eq!(db.run_artifacts_stored("lost").await.unwrap(), Some(false));
}

#[tokio::test]
async fn an_empty_listing_reconciles_nothing() {
    // A service that lists no trees at all is more likely looking at the wrong
    // volume than at a cabinet that lost every tree.
    let db = db_with(&["a", "b"]).await;
    db.set_run_artifacts_stored("a", true).await.unwrap();

    let outcome = reconcile_presence(&db, &ids(&["a", "b"]), &[])
        .await
        .unwrap();

    assert_eq!(outcome, crate::db::ArtifactReconciliation::default());
    assert_eq!(db.run_artifacts_stored("a").await.unwrap(), Some(true));
    assert_eq!(db.run_artifacts_stored("b").await.unwrap(), None);
}

#[tokio::test]
async fn a_pass_reconciles_from_the_listing_it_swept_with() {
    // `kept` has its tree, `lost` has a row and no tree, and `orphan` is a tree with
    // no row. One pass reclaims the orphan and records the other two.
    let db = db_with(&["kept", "lost"]).await;
    let (base, stub) = spawn_artifact_stub(&["kept", "orphan"]).await;
    let runs = db.retention_runs(None).await.unwrap();

    let (outcome, reconciled) = sweep_pass(
        &db,
        &reqwest::Client::new(),
        &base,
        STUB_TOKEN,
        &runs,
        &HashSet::new(),
        OffsetDateTime::now_utc(),
        &ORPHANS_ONLY,
    )
    .await
    .unwrap();

    assert_eq!(outcome.listed, 2);
    assert_eq!(outcome.reclaimed, 1);
    assert_eq!(reconciled.marked_stored, 1);
    assert_eq!(reconciled.marked_not_stored, 1);
    assert_eq!(db.run_artifacts_stored("kept").await.unwrap(), Some(true));
    assert_eq!(db.run_artifacts_stored("lost").await.unwrap(), Some(false));
    // What the pass deletes is unchanged by the reconciliation: the orphan and
    // nothing else, and no run row is removed for a missing tree.
    assert_eq!(*stub.deleted.lock().unwrap(), ["orphan"]);
    assert_eq!(db.all_run_ids().await.unwrap(), ids(&["kept", "lost"]));
    assert!(
        stub.asked().is_empty(),
        "the pass reads the listing; it makes no per-run presence query"
    );
}

#[tokio::test]
async fn a_pass_whose_listing_fails_changes_nothing() {
    let db = db_with(&["kept"]).await;
    db.set_run_artifacts_stored("kept", true).await.unwrap();
    let base = unreachable_base().await;
    let runs = db.retention_runs(None).await.unwrap();

    let result = sweep_pass(
        &db,
        &reqwest::Client::new(),
        &base,
        STUB_TOKEN,
        &runs,
        &HashSet::new(),
        OffsetDateTime::now_utc(),
        &ORPHANS_ONLY,
    )
    .await;

    assert!(result.is_err());
    assert_eq!(db.run_artifacts_stored("kept").await.unwrap(), Some(true));
}

// --- A scheduled pass ---------------------------------------------------------

async fn scheduled(db: &Db, base: &str) -> ScheduledPass {
    scheduled_pass(
        db,
        &reqwest::Client::new(),
        base,
        STUB_TOKEN,
        OffsetDateTime::now_utc(),
        &ORPHANS_ONLY,
    )
    .await
}

#[tokio::test]
async fn a_scheduled_pass_that_changes_nothing_still_completes_with_its_counts() {
    let db = db_with(&["kept"]).await;
    db.set_run_artifacts_stored("kept", true).await.unwrap();
    let (base, stub) = spawn_artifact_stub(&["kept"]).await;

    let pass = scheduled(&db, &base).await;

    let ScheduledPass::Complete(outcome, reconciled) = pass else {
        panic!("expected a complete pass, got {pass:?}");
    };
    assert_eq!(
        (
            outcome.listed,
            outcome.orphans,
            outcome.reclaimed,
            outcome.failed
        ),
        (1, 0, 0, 0)
    );
    assert_eq!(reconciled, crate::db::ArtifactReconciliation::default());
    assert!(stub.deleted.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_scheduled_pass_with_no_run_rows_is_abandoned_before_it_lists() {
    // A fresh database beside a populated volume: every tree would be an orphan.
    let db = db_with(&[]).await;
    let (base, stub) = spawn_artifact_stub(&["a", "b"]).await;

    let pass = scheduled(&db, &base).await;

    let ScheduledPass::Abandoned(why) = pass else {
        panic!("expected an abandoned pass, got {pass:?}");
    };
    assert_eq!(why.as_str(), "no_runs");
    assert!(stub.deleted.lock().unwrap().is_empty(), "nothing is swept");
}

#[tokio::test]
async fn a_scheduled_pass_whose_listing_fails_is_abandoned() {
    let db = db_with(&["kept"]).await;

    let pass = scheduled(&db, &unreachable_base().await).await;

    let ScheduledPass::Abandoned(why) = pass else {
        panic!("expected an abandoned pass, got {pass:?}");
    };
    assert_eq!(why.as_str(), "listing_failed");
    assert_eq!(db.run_artifacts_stored("kept").await.unwrap(), None);
}
