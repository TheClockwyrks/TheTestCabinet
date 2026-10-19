//! A repeated upload stores one copy.
//!
//! Every finishing call is idempotent by run id (the driver overview's "Retries"):
//! the artifacts service replaces a run's stored tree and the repos service a run's
//! bundle, so an upload repeated after its answer was lost leaves the one copy the
//! later attempt sent. These run the driver's own uploads, the run tree through
//! [`store_run_tree`] and the bundle through
//! [`store_bundle`](crate::bundle::store_bundle), against stubs that key what they
//! store by run id the same way and lose the answer to the first attempt of each.

use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path as UrlPath, State};
use axum::http::StatusCode;
use axum::routing::post;
use tempfile::TempDir;

use super::{TreeStore, Unattended, UploadRetry, store_run_tree};
use crate::bundle::{BundleTarget, store_bundle};

/// What one stub service holds: the stored copy per run id, and how many uploads
/// it was sent.
#[derive(Debug, Default)]
struct Store {
    by_run: HashMap<String, Vec<u8>>,
    uploads: usize,
}

#[derive(Clone, Default)]
struct Stubs {
    trees: Arc<Mutex<Store>>,
    bundles: Arc<Mutex<Store>>,
}

/// Store `body` under `run_id`, replacing what was there, and answer the first
/// upload `503` as though the answer to a stored upload had been lost.
fn keep(store: &Mutex<Store>, run_id: String, body: Bytes) -> StatusCode {
    let mut store = store.lock().expect("lock");
    store.uploads += 1;
    store.by_run.insert(run_id, body.to_vec());
    if store.uploads == 1 {
        StatusCode::SERVICE_UNAVAILABLE
    } else {
        StatusCode::CREATED
    }
}

async fn tree(
    State(stubs): State<Stubs>,
    UrlPath(run_id): UrlPath<String>,
    body: Bytes,
) -> StatusCode {
    keep(&stubs.trees, run_id, body)
}

async fn bundle(
    State(stubs): State<Stubs>,
    UrlPath(run_id): UrlPath<String>,
    body: Bytes,
) -> StatusCode {
    keep(&stubs.bundles, run_id, body)
}

/// The artifacts and repos services on one stub. Returns its base URL.
async fn serve(stubs: Stubs) -> String {
    let app = Router::new()
        .route("/runs/{id}/artifacts", post(tree))
        .route("/runs/{id}/bundle", post(bundle))
        .with_state(stubs);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("addr");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve");
    });
    format!("http://{addr}")
}

/// Run git in `dir`, isolated from the host's configuration.
fn git(dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .output()
        .expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

/// A produced run tree for `run-1` under `out_dir` whose implementation is a
/// seeded git repository with a static build.
fn run_tree(out_dir: &Path) -> std::path::PathBuf {
    let run_dir = out_dir.join("run-1");
    let implementation = run_dir.join("implementation");
    std::fs::create_dir_all(implementation.join("dist")).expect("mkdir");
    std::fs::write(implementation.join("dist/index.html"), b"<!doctype html>").expect("write");
    std::fs::write(implementation.join("main.ts"), b"// seed\n").expect("write");
    std::fs::write(run_dir.join("run-record.json"), br#"{"id":"run-1"}"#).expect("write");
    git(
        &implementation,
        &["init", "--quiet", "--initial-branch", "main"],
    );
    git(&implementation, &["config", "user.name", "Clockwyrks"]);
    git(
        &implementation,
        &["config", "user.email", "runs@clockwyrks.invalid"],
    );
    git(&implementation, &["add", "main.ts"]);
    git(
        &implementation,
        &[
            "commit",
            "--quiet",
            "--message",
            crate::seeding::SEED_COMMIT_MESSAGE,
        ],
    );
    implementation
}

/// A policy that retries at once, under a bound no test reaches.
fn quick() -> UploadRetry {
    UploadRetry {
        give_up_after: Duration::from_secs(3600),
        delays: vec![Duration::ZERO],
        ..UploadRetry::default()
    }
}

#[tokio::test]
async fn a_repeated_tree_upload_and_a_repeated_bundle_upload_leave_one_copy_of_each() {
    let stubs = Stubs::default();
    let base = serve(stubs.clone()).await;
    let out = TempDir::new().expect("tempdir");
    let implementation = run_tree(out.path());
    let scratch = TempDir::new().expect("tempdir");
    let mut record = super::tests::record(None);
    let target = BundleTarget {
        repos_url: &base,
        run_id: "run-1",
        job_id: "job-9",
        job_token: "tok-1",
    };

    // The first attempt of each is stored and its answer lost, so the driver sends
    // it again; then the whole of the finishing uploads is made once more, as a
    // driver repeating them would.
    for _ in 0..2 {
        let tree_store = store_run_tree(
            &quick(),
            &Unattended,
            Some(&base),
            &mut record,
            "job-9",
            out.path(),
            "tok-1",
        )
        .await;
        assert_eq!(tree_store, TreeStore::Stored);
        store_bundle(
            target,
            &implementation,
            scratch.path(),
            &quick(),
            std::future::pending(),
        )
        .await
        .expect("the bundle is stored");
    }

    let trees = stubs.trees.lock().expect("lock");
    assert_eq!(
        trees.uploads, 3,
        "the lost answer, its retry, and the repeat"
    );
    assert_eq!(
        trees.by_run.keys().collect::<Vec<_>>(),
        ["run-1"],
        "one stored tree"
    );
    // The copy kept is a whole tree.
    let unpacked = TempDir::new().expect("tempdir");
    tar::Archive::new(trees.by_run["run-1"].as_slice())
        .unpack(unpacked.path())
        .expect("a whole tar archive");
    assert_eq!(
        std::fs::read(unpacked.path().join("run-record.json")).expect("record"),
        br#"{"id":"run-1"}"#
    );

    let bundles = stubs.bundles.lock().expect("lock");
    assert_eq!(bundles.uploads, 3);
    assert_eq!(
        bundles.by_run.keys().collect::<Vec<_>>(),
        ["run-1"],
        "one stored bundle"
    );
    assert!(
        bundles.by_run["run-1"].starts_with(b"# v2 git bundle"),
        "the copy kept is a git bundle"
    );
}
