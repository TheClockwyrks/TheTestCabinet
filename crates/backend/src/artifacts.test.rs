//! Tests for the backend's artifact-tree management: the pure orphan-selection
//! rule, and the two HTTP calls it drives.
//!
//! The HTTP tests stand a tiny **stub** artifact service on an ephemeral port —
//! the same shape `probe.test.rs` uses — so the real `reqwest` paths run: the
//! bearer token really travels, the listing body is really deserialized, and each
//! `DELETE` the sweep issues is really recorded.

use std::sync::Mutex;

use axum::Router;
use axum::extract::Path as AxumPath;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{delete, get};
use time::Duration as TimeDuration;

use super::*;

/// The service token every stub route requires as a bearer.
const TOKEN: &str = "service-secret";

/// What a stub run observed, so a test can assert on the traffic rather than only
/// on the result.
#[derive(Default)]
struct Recorder {
    /// Run ids the stub received a `DELETE /runs/{id}/artifacts` for, in order.
    deleted: Vec<String>,
    /// Whether every request carried the expected bearer token.
    authed: bool,
}

/// The stub's shared state: what it recorded, plus how it should answer.
struct Stub {
    recorder: Mutex<Recorder>,
    /// The listing `GET /runs` answers with, already rendered as a JSON body.
    listing: String,
    /// The status a `DELETE` answers with, so a test can exercise a refusal.
    delete_status: StatusCode,
}

/// Whether `headers` presents [`TOKEN`] as a bearer.
fn has_token(headers: &HeaderMap) -> bool {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        == Some(&format!("Bearer {TOKEN}"))
}

/// Spawn the stub artifact service and return its base URL alongside the shared
/// state, so a test can read back what the calls did.
async fn spawn_stub(listing: String, delete_status: StatusCode) -> (String, Arc<Stub>) {
    let stub = Arc::new(Stub {
        recorder: Mutex::new(Recorder {
            deleted: Vec::new(),
            authed: true,
        }),
        listing,
        delete_status,
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
                            stub.recorder.lock().unwrap().authed = false;
                            return (StatusCode::UNAUTHORIZED, String::new());
                        }
                        (StatusCode::OK, stub.listing.clone())
                    }
                }
            }),
        )
        .route(
            "/runs/{id}/artifacts",
            delete({
                let stub = Arc::clone(&stub);
                move |AxumPath(id): AxumPath<String>, headers: HeaderMap| {
                    let stub = Arc::clone(&stub);
                    async move {
                        let mut recorder = stub.recorder.lock().unwrap();
                        if !has_token(&headers) {
                            recorder.authed = false;
                            return StatusCode::UNAUTHORIZED;
                        }
                        recorder.deleted.push(id);
                        stub.delete_status
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

/// A fixed "now" the age cases are expressed relative to.
fn now() -> OffsetDateTime {
    OffsetDateTime::from_unix_timestamp(1_800_000_000).unwrap()
}

/// A tree with `id` last written `hours` before [`now`].
fn tree(id: &str, hours: i64) -> StoredTree {
    StoredTree {
        id: id.to_string(),
        modified_at: now() - TimeDuration::hours(hours),
    }
}

/// The live-run-id set from a list of ids.
fn live(ids: &[&str]) -> HashSet<String> {
    ids.iter().map(|id| id.to_string()).collect()
}

/// A `GET /runs` body listing each `(id, hours-old)` pair.
fn listing(entries: &[(&str, i64)]) -> String {
    let runs: Vec<serde_json::Value> = entries
        .iter()
        .map(|(id, hours)| {
            serde_json::json!({
                "id": id,
                "modifiedAt": (now() - TimeDuration::hours(*hours))
                    .format(&time::format_description::well_known::Rfc3339)
                    .unwrap(),
            })
        })
        .collect();
    serde_json::json!({ "runs": runs }).to_string()
}

// ---------------------------------------------------------------------------
// The selection rule
// ---------------------------------------------------------------------------

#[test]
fn a_tree_whose_run_still_exists_is_kept() {
    // Age is irrelevant while the run row is there: the run is the only thing that
    // decides whether a tree is referenced.
    let trees = vec![tree("live-run", 500)];
    let selected = orphaned_trees(
        &trees,
        &live(&["live-run"]),
        now(),
        Duration::from_secs(3600),
    );
    assert!(selected.is_empty(), "{selected:?}");
}

#[test]
fn a_run_less_tree_inside_the_grace_window_is_kept() {
    // The driver uploads a run's tree before it reports the run terminal, so a
    // freshly uploaded tree with no row is a run that is still finishing.
    let trees = vec![tree("just-uploaded", 1)];
    let selected = orphaned_trees(
        &trees,
        &live(&["another-run"]),
        now(),
        Duration::from_secs(24 * 60 * 60),
    );
    assert!(selected.is_empty(), "{selected:?}");
}

#[test]
fn a_run_less_tree_past_the_grace_window_is_selected() {
    let trees = vec![tree("orphan", 48)];
    let selected = orphaned_trees(
        &trees,
        &live(&["another-run"]),
        now(),
        Duration::from_secs(24 * 60 * 60),
    );
    assert_eq!(selected, vec!["orphan".to_string()]);
}

#[test]
fn an_empty_listing_selects_nothing() {
    let selected = orphaned_trees(&[], &live(&["a", "b"]), now(), Duration::from_secs(0));
    assert!(selected.is_empty(), "{selected:?}");
}

#[test]
fn a_backend_that_holds_no_runs_spares_every_tree() {
    // The whole-volume case: with no run rows to compare against, every tree in the
    // listing matches the orphan rule. A backend reaches that state through a
    // database fault, a restore, or a boot against a fresh database beside a volume
    // the previous one filled, and in each of them the trees are still referenced.
    let trees = vec![tree("ancient", 10_000), tree("stale", 48)];
    let selected = orphaned_trees(&trees, &live(&[]), now(), Duration::from_secs(24 * 60 * 60));
    assert!(selected.is_empty(), "{selected:?}");
}

#[tokio::test]
async fn a_sweep_with_no_live_runs_deletes_nothing() {
    // The same rule through the sweep the scheduler drives, so a caller that reaches
    // the selection with an empty set cannot reclaim the volume.
    let (base, stub) = spawn_stub(
        listing(&[("stale-one", 200), ("stale-two", 200)]),
        StatusCode::NO_CONTENT,
    )
    .await;
    let outcome = sweep_orphaned_trees(
        &reqwest::Client::new(),
        &base,
        TOKEN,
        &live(&[]),
        now(),
        Duration::from_secs(24 * 60 * 60),
    )
    .await
    .unwrap();
    assert_eq!(
        outcome,
        SweepOutcome {
            listed: 2,
            reclaimed: 0,
            failed: 0,
        }
    );
    assert!(stub.recorder.lock().unwrap().deleted.is_empty());
}

// ---------------------------------------------------------------------------
// The prune
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_prune_deletes_the_tree_presenting_the_service_token() {
    let (base, stub) = spawn_stub(listing(&[]), StatusCode::NO_CONTENT).await;
    delete_run_tree(
        &reqwest::Client::new(),
        Some(base.as_str()),
        Some(TOKEN),
        "run-1",
    )
    .await;
    let recorder = stub.recorder.lock().unwrap();
    assert!(recorder.authed, "the prune did not present the token");
    assert_eq!(recorder.deleted, vec!["run-1".to_string()]);
}

#[tokio::test]
async fn a_refused_prune_returns_normally() {
    // The run row is already gone, so a refusal must never propagate to the client.
    let (base, stub) = spawn_stub(listing(&[]), StatusCode::INTERNAL_SERVER_ERROR).await;
    delete_run_tree(
        &reqwest::Client::new(),
        Some(base.as_str()),
        Some(TOKEN),
        "run-1",
    )
    .await;
    assert_eq!(
        stub.recorder.lock().unwrap().deleted,
        vec!["run-1".to_string()]
    );
}

#[tokio::test]
async fn a_prune_without_a_url_or_a_token_makes_no_request() {
    let (base, stub) = spawn_stub(listing(&[]), StatusCode::NO_CONTENT).await;
    let http = reqwest::Client::new();
    delete_run_tree(&http, None, Some(TOKEN), "run-1").await;
    delete_run_tree(&http, Some(base.as_str()), None, "run-1").await;
    assert!(stub.recorder.lock().unwrap().deleted.is_empty());
}

// ---------------------------------------------------------------------------
// The listing and the sweep
// ---------------------------------------------------------------------------

#[tokio::test]
async fn the_listing_parses_each_tree_and_its_timestamp() {
    let (base, _stub) = spawn_stub(listing(&[("a", 3), ("b", 100)]), StatusCode::NO_CONTENT).await;
    let trees = list_run_trees(&reqwest::Client::new(), &base, TOKEN)
        .await
        .unwrap();
    assert_eq!(
        trees.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(),
        vec!["a", "b"]
    );
    assert_eq!(trees[0].modified_at, now() - TimeDuration::hours(3));
    assert_eq!(trees[1].modified_at, now() - TimeDuration::hours(100));
}

#[tokio::test]
async fn a_sweep_deletes_only_the_stale_orphan() {
    let (base, stub) = spawn_stub(
        listing(&[
            ("live-run", 200),
            ("fresh-orphan", 2),
            ("stale-orphan", 200),
        ]),
        StatusCode::NO_CONTENT,
    )
    .await;
    let outcome = sweep_orphaned_trees(
        &reqwest::Client::new(),
        &base,
        TOKEN,
        &live(&["live-run"]),
        now(),
        Duration::from_secs(24 * 60 * 60),
    )
    .await
    .unwrap();
    assert_eq!(
        outcome,
        SweepOutcome {
            listed: 3,
            reclaimed: 1,
            failed: 0,
        }
    );
    let recorder = stub.recorder.lock().unwrap();
    assert!(recorder.authed, "the sweep did not present the token");
    assert_eq!(recorder.deleted, vec!["stale-orphan".to_string()]);
}

#[tokio::test]
async fn a_refused_sweep_delete_is_counted_and_the_pass_finishes() {
    let (base, stub) = spawn_stub(
        listing(&[("stale-one", 200), ("stale-two", 200)]),
        StatusCode::INTERNAL_SERVER_ERROR,
    )
    .await;
    let outcome = sweep_orphaned_trees(
        &reqwest::Client::new(),
        &base,
        TOKEN,
        &live(&["another-run"]),
        now(),
        Duration::from_secs(24 * 60 * 60),
    )
    .await
    .unwrap();
    assert_eq!(
        outcome,
        SweepOutcome {
            listed: 2,
            reclaimed: 0,
            failed: 2,
        }
    );
    // Both were attempted: one refusal does not abandon the rest of the pass.
    assert_eq!(stub.recorder.lock().unwrap().deleted.len(), 2);
}

#[tokio::test]
async fn a_listing_without_the_token_fails_the_sweep_rather_than_deleting() {
    let (base, stub) = spawn_stub(listing(&[("stale", 200)]), StatusCode::NO_CONTENT).await;
    let error = sweep_orphaned_trees(
        &reqwest::Client::new(),
        &base,
        "wrong-token",
        &live(&["another-run"]),
        now(),
        Duration::from_secs(24 * 60 * 60),
    )
    .await
    .unwrap_err();
    assert_eq!(error.status(), Some(reqwest::StatusCode::UNAUTHORIZED));
    assert!(stub.recorder.lock().unwrap().deleted.is_empty());
}

#[test]
fn an_unrepresentable_grace_window_spares_every_tree() {
    // An operator can set the grace window to any number of hours; one past the
    // representable calendar range must spare every tree rather than fault the sweep.
    let trees = vec![tree("ancient", 100_000)];
    let selected = orphaned_trees(&trees, &live(&["another-run"]), now(), Duration::MAX);
    assert!(selected.is_empty(), "{selected:?}");
}
