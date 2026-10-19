//! Tests for the build digest and the Pages deployment lookup.
//!
//! The lookup runs against [`StubPagesApi`], a small axum server standing in for
//! the Cloudflare API's deployments listing: it serves a scripted list of
//! deployments in pages of at most 25, as the API does, and records each request
//! so the assertions can check the paging, the query and the bearer token. The
//! release tests reuse the stub to drive the whole deploy step.

use super::*;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::Json;
use axum::Router;
use axum::extract::{Path as AxumPath, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde_json::{Value, json};
use tokio::net::TcpListener;

/// The account the stub serves.
pub(crate) const STUB_ACCOUNT: &str = "acct-123";

/// The token the stub expects.
pub(crate) const STUB_TOKEN: &str = "cf-token-xyz";

/// One request the stub received.
#[derive(Debug, Clone)]
pub(crate) struct StubRequest {
    /// The account path segment.
    pub(crate) account: String,
    /// The project path segment.
    pub(crate) project: String,
    /// The query parameters.
    pub(crate) query: HashMap<String, String>,
    /// The `Authorization` header.
    pub(crate) authorization: Option<String>,
}

#[derive(Clone)]
struct StubState {
    deployments: Arc<Vec<Value>>,
    status: StatusCode,
    requests: Arc<Mutex<Vec<StubRequest>>>,
}

/// A stub of the Cloudflare API's Pages deployments listing.
pub(crate) struct StubPagesApi {
    /// The `…/client/v4` base URL to hand to [`PagesApi::new`].
    pub(crate) base_url: String,
    requests: Arc<Mutex<Vec<StubRequest>>>,
}

impl StubPagesApi {
    /// Serve `deployments` (newest first), answering every request with `status`
    /// (a non-2xx status is answered with an error envelope).
    pub(crate) async fn serve(deployments: Vec<Value>, status: StatusCode) -> Self {
        let requests = Arc::new(Mutex::new(Vec::new()));
        let state = StubState {
            deployments: Arc::new(deployments),
            status,
            requests: requests.clone(),
        };
        let app = Router::new()
            .route(
                "/client/v4/accounts/{account}/pages/projects/{project}/deployments",
                get(list_deployments),
            )
            .with_state(state);
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        tokio::spawn(async move {
            axum::serve(listener, app).await.expect("serve");
        });
        Self {
            base_url: format!("http://{addr}/client/v4"),
            requests,
        }
    }

    /// Serve `deployments` successfully.
    pub(crate) async fn with(deployments: Vec<Value>) -> Self {
        Self::serve(deployments, StatusCode::OK).await
    }

    /// An API client of this stub, authenticated as the stub expects.
    pub(crate) fn api(&self) -> PagesApi {
        PagesApi::new(&self.base_url, STUB_ACCOUNT, STUB_TOKEN)
    }

    /// The requests received so far.
    pub(crate) fn requests(&self) -> Vec<StubRequest> {
        self.requests.lock().expect("lock").clone()
    }
}

async fn list_deployments(
    State(state): State<StubState>,
    AxumPath((account, project)): AxumPath<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> Response {
    let authorization = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    state.requests.lock().expect("lock").push(StubRequest {
        account,
        project,
        query: query.clone(),
        authorization,
    });
    if !state.status.is_success() {
        return (
            state.status,
            Json(json!({
                "success": false,
                "errors": [{ "code": 10000, "message": "stubbed failure" }],
                "result": null,
            })),
        )
            .into_response();
    }
    let page: usize = query.get("page").and_then(|p| p.parse().ok()).unwrap_or(1);
    let per_page: usize = query
        .get("per_page")
        .and_then(|p| p.parse().ok())
        .unwrap_or(25);
    if per_page > 25 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "success": false, "errors": [{ "code": 8000024 }] })),
        )
            .into_response();
    }
    let total = state.deployments.len();
    let total_pages = total.div_ceil(per_page);
    let start = (page - 1) * per_page;
    let result: Vec<Value> = state
        .deployments
        .iter()
        .skip(start)
        .take(per_page)
        .cloned()
        .collect();
    Json(json!({
        "success": true,
        "errors": [],
        "messages": [],
        "result": result,
        "result_info": {
            "page": page,
            "per_page": per_page,
            "count": result.len(),
            "total_count": total,
            "total_pages": total_pages,
        },
    }))
    .into_response()
}

/// A deployment as the API lists it, finished successfully.
pub(crate) fn deployment(url: &str, branch: &str, commit_hash: &str) -> Value {
    deployment_in_stage(url, branch, commit_hash, "deploy", "success")
}

/// A deployment as the API lists it, whose latest stage is `stage` in `status`.
pub(crate) fn deployment_in_stage(
    url: &str,
    branch: &str,
    commit_hash: &str,
    stage: &str,
    status: &str,
) -> Value {
    json!({
        "id": "3f6fa159-d121-4807-bd93-d427f2abca6c",
        "url": url,
        "environment": "preview",
        "latest_stage": { "name": stage, "started_on": null, "status": status },
        "deployment_trigger": {
            "type": "ad_hoc",
            "metadata": {
                "branch": branch,
                "commit_hash": commit_hash,
                "commit_message": "",
                "commit_dirty": false,
            },
        },
        "aliases": [format!("https://{branch}.test-cabinet-runs.pages.dev")],
    })
}

/// `n` unrelated deployments on other branches.
fn others(n: usize) -> Vec<Value> {
    (0..n)
        .map(|i| {
            deployment(
                &format!("https://other{i}.test-cabinet-runs.pages.dev"),
                &format!("other-run-{i}"),
                &"0".repeat(64),
            )
        })
        .collect()
}

const DIGEST: &str = "f60ebb43826dcfb0d22305251c8c2b341e7564fe30c7e2429170cb9a4733c80f";

fn write(dir: &Path, relative: &str, contents: &[u8]) {
    let path = dir.join(relative);
    std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
    std::fs::write(path, contents).expect("write");
}

#[test]
fn the_digest_is_the_same_for_the_same_tree_anywhere() {
    let a = tempfile::tempdir().expect("tempdir");
    let b = tempfile::tempdir().expect("tempdir");
    // Written in different orders, so directory listing order cannot matter.
    write(a.path(), "index.html", b"<!doctype html>");
    write(a.path(), "assets/app.js", b"console.log(1)");
    write(b.path(), "assets/app.js", b"console.log(1)");
    write(b.path(), "index.html", b"<!doctype html>");

    let digest = build_digest(a.path()).expect("digest");
    assert_eq!(digest, build_digest(b.path()).expect("digest"));
    assert_eq!(digest.len(), 64);
    assert!(
        digest
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    );
}

#[test]
fn the_digest_changes_with_any_content_or_path() {
    let dir = tempfile::tempdir().expect("tempdir");
    write(dir.path(), "index.html", b"<!doctype html>");
    write(dir.path(), "assets/app.js", b"console.log(1)");
    let before = build_digest(dir.path()).expect("digest");

    write(dir.path(), "assets/app.js", b"console.log(2)");
    let changed_content = build_digest(dir.path()).expect("digest");
    assert_ne!(before, changed_content);

    std::fs::rename(
        dir.path().join("assets/app.js"),
        dir.path().join("assets/main.js"),
    )
    .expect("rename");
    let changed_path = build_digest(dir.path()).expect("digest");
    assert_ne!(changed_content, changed_path);

    // Moving bytes between a path and its contents cannot collide.
    let x = tempfile::tempdir().expect("tempdir");
    let y = tempfile::tempdir().expect("tempdir");
    write(x.path(), "ab", b"c");
    write(y.path(), "a", b"bc");
    assert_ne!(
        build_digest(x.path()).expect("digest"),
        build_digest(y.path()).expect("digest")
    );
}

#[cfg(unix)]
#[test]
fn the_digest_records_a_link_without_following_it() {
    let dir = tempfile::tempdir().expect("tempdir");
    write(dir.path(), "index.html", b"<!doctype html>");
    let plain = build_digest(dir.path()).expect("digest");
    std::os::unix::fs::symlink("index.html", dir.path().join("home.html")).expect("symlink");
    let linked = build_digest(dir.path()).expect("digest");
    assert_ne!(plain, linked);

    // A link and a file holding the link's target differ.
    let other = tempfile::tempdir().expect("tempdir");
    write(other.path(), "index.html", b"<!doctype html>");
    write(other.path(), "home.html", b"index.html");
    assert_ne!(linked, build_digest(other.path()).expect("digest"));
}

#[tokio::test]
async fn the_lookup_finds_a_deployment_of_the_digest_on_the_branch() {
    let mut deployments = others(3);
    deployments.insert(
        1,
        deployment(
            "https://3f6fa159.test-cabinet-runs.pages.dev",
            "run-1",
            DIGEST,
        ),
    );
    let stub = StubPagesApi::with(deployments).await;

    let found = stub
        .api()
        .find_deployment("test-cabinet-runs", "run-1", DIGEST)
        .await
        .expect("lookup");

    assert_eq!(
        found.as_deref(),
        Some("https://3f6fa159.test-cabinet-runs.pages.dev")
    );
    let requests = stub.requests();
    assert_eq!(requests.len(), 1, "{requests:?}");
    let request = &requests[0];
    assert_eq!(request.account, STUB_ACCOUNT);
    assert_eq!(request.project, "test-cabinet-runs");
    assert_eq!(
        request.query.get("env").map(String::as_str),
        Some("preview")
    );
    assert_eq!(request.query.get("page").map(String::as_str), Some("1"));
    assert_eq!(
        request.query.get("per_page").map(String::as_str),
        Some("25")
    );
    assert_eq!(
        request.authorization.as_deref(),
        Some(format!("Bearer {STUB_TOKEN}").as_str())
    );
}

#[tokio::test]
async fn the_lookup_pages_until_it_finds_a_match() {
    let mut deployments = others(60);
    deployments.push(deployment(
        "https://older.test-cabinet-runs.pages.dev",
        "run-1",
        DIGEST,
    ));
    let stub = StubPagesApi::with(deployments).await;

    let found = stub
        .api()
        .find_deployment("test-cabinet-runs", "run-1", DIGEST)
        .await
        .expect("lookup");

    assert_eq!(
        found.as_deref(),
        Some("https://older.test-cabinet-runs.pages.dev")
    );
    let pages: Vec<_> = stub
        .requests()
        .iter()
        .map(|r| r.query.get("page").cloned().unwrap_or_default())
        .collect();
    assert_eq!(pages, ["1", "2", "3"]);
}

#[tokio::test]
async fn the_lookup_reads_every_page_before_reporting_none() {
    // Exactly two full pages: the end is known from `total_pages`, not from a
    // short page.
    let stub = StubPagesApi::with(others(50)).await;

    let found = stub
        .api()
        .find_deployment("test-cabinet-runs", "run-1", DIGEST)
        .await
        .expect("lookup");

    assert_eq!(found, None);
    assert_eq!(stub.requests().len(), 2);
}

#[tokio::test]
async fn the_lookup_of_an_empty_project_is_none() {
    let stub = StubPagesApi::with(Vec::new()).await;
    let found = stub
        .api()
        .find_deployment("test-cabinet-runs", "run-1", DIGEST)
        .await
        .expect("lookup");
    assert_eq!(found, None);
    assert_eq!(stub.requests().len(), 1);
}

#[tokio::test]
async fn the_lookup_ignores_another_branch_another_digest_and_an_unfinished_deploy() {
    let stub = StubPagesApi::with(vec![
        deployment("https://a.test-cabinet-runs.pages.dev", "run-2", DIGEST),
        deployment(
            "https://b.test-cabinet-runs.pages.dev",
            "run-1",
            &"1".repeat(64),
        ),
        deployment_in_stage(
            "https://c.test-cabinet-runs.pages.dev",
            "run-1",
            DIGEST,
            "deploy",
            "failure",
        ),
        deployment_in_stage(
            "https://d.test-cabinet-runs.pages.dev",
            "run-1",
            DIGEST,
            "queued",
            "active",
        ),
    ])
    .await;

    let found = stub
        .api()
        .find_deployment("test-cabinet-runs", "run-1", DIGEST)
        .await
        .expect("lookup");

    assert_eq!(found, None);
}

#[tokio::test]
async fn a_failed_listing_is_an_api_error_carrying_its_status() {
    let stub = StubPagesApi::serve(Vec::new(), StatusCode::SERVICE_UNAVAILABLE).await;

    let err = stub
        .api()
        .find_deployment("test-cabinet-runs", "run-1", DIGEST)
        .await
        .expect_err("a 503 must fail");

    assert!(
        matches!(
            err,
            Error::PagesApi {
                status: Some(503),
                ..
            }
        ),
        "{err:?}"
    );
}

#[tokio::test]
async fn an_unreachable_api_is_an_api_error_without_a_status() {
    // Bind and drop a listener so the port refuses connections.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("addr");
    drop(listener);
    let api = PagesApi::new(format!("http://{addr}/client/v4"), STUB_ACCOUNT, STUB_TOKEN);

    let err = api
        .find_deployment("test-cabinet-runs", "run-1", DIGEST)
        .await
        .expect_err("a refused connection must fail");

    assert!(
        matches!(err, Error::PagesApi { status: None, .. }),
        "{err:?}"
    );
}

#[test]
fn the_token_never_appears_in_debug_output() {
    let api = PagesApi::new(DEFAULT_CLOUDFLARE_API_BASE, STUB_ACCOUNT, STUB_TOKEN);
    let debug = format!("{api:?}");
    assert!(!debug.contains(STUB_TOKEN), "{debug}");
    assert!(debug.contains(STUB_ACCOUNT), "{debug}");
}
