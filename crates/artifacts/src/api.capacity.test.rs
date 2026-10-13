//! Tests for `GET /capacity` against a store whose volume misbehaves, driven
//! through a [`FaultyStore`] so that each fault is one the test decides rather
//! than one the host has to produce. A permission bit, the only fault a real
//! directory offers, means nothing to a test run as root.

use std::io::Read;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::mpsc;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;

use super::*;
use crate::store::{ArtifactStore, StoreCapacity, StoreError, StoredTree};

/// The service token the route is gated on.
const SERVICE_TOKEN: &str = "service-secret";

/// The byte figures every [`FaultyStore`] reports.
const CAPACITY: StoreCapacity = StoreCapacity {
    free_bytes: 7_000,
    total_bytes: 9_000,
};

/// What one step of a [`FaultyStore`] reading does.
enum Step {
    /// Return at once, with this result.
    Answer(Result<(), String>),
    /// Block until the test sends a result, announcing first that it has started.
    Block {
        /// Told once the step is blocked.
        started: mpsc::Sender<()>,
        /// What the step returns, when the test sends it.
        release: mpsc::Receiver<Result<(), String>>,
    },
}

impl Step {
    /// Take the step.
    fn take(&self) -> Result<(), StoreError> {
        let result = match self {
            Self::Answer(result) => result.clone(),
            Self::Block { started, release } => {
                started.send(()).expect("the test is listening");
                release.recv().expect("the test releases the step")
            }
        };
        result.map_err(|error| StoreError::Io(std::io::Error::other(error)))
    }
}

/// A store that is nothing but its capacity reading: the `statvfs` and the write
/// check each do what the test scripted, and nothing else is ever asked of it.
struct FaultyStore {
    /// What [`ArtifactStore::capacity`] does before it answers [`CAPACITY`].
    statvfs: std::sync::Mutex<Step>,
    /// What [`ArtifactStore::probe_write`] does.
    probe: std::sync::Mutex<Step>,
}

impl FaultyStore {
    /// A store whose `statvfs` answers and whose write check does `probe`.
    fn probing(probe: Step) -> Self {
        Self {
            statvfs: std::sync::Mutex::new(Step::Answer(Ok(()))),
            probe: std::sync::Mutex::new(probe),
        }
    }
}

impl ArtifactStore for FaultyStore {
    fn capacity(&self) -> Result<StoreCapacity, StoreError> {
        self.statvfs.lock().unwrap().take()?;
        Ok(CAPACITY)
    }

    fn probe_write(&self) -> Result<(), StoreError> {
        self.probe.lock().unwrap().take()
    }

    fn store_run(&self, _id: &str, _tar: &mut dyn Read) -> Result<(), StoreError> {
        unreachable!("a capacity reading stores nothing")
    }

    fn run_dir(&self, _id: &str) -> PathBuf {
        unreachable!("a capacity reading resolves no run")
    }

    fn scratch_dir(&self) -> PathBuf {
        unreachable!("a capacity reading spools nothing itself")
    }

    fn delete_run(&self, _id: &str) -> Result<(), StoreError> {
        unreachable!("a capacity reading deletes nothing")
    }

    fn list_runs(&self) -> Result<Vec<StoredTree>, StoreError> {
        unreachable!("a capacity reading lists nothing")
    }

    fn ensure_run_tree(&self, _id: &str) -> Result<(), StoreError> {
        unreachable!("a capacity reading reads no tree")
    }

    fn write_run_tree(&self, _id: &str, _out: &mut dyn std::io::Write) -> Result<(), StoreError> {
        unreachable!("a capacity reading reads no tree")
    }

    fn write_run_archive(
        &self,
        _id: &str,
        _out: &mut dyn std::io::Write,
    ) -> Result<(), StoreError> {
        unreachable!("a capacity reading reads no tree")
    }
}

/// The router over `store`.
fn app(store: FaultyStore) -> Router {
    router(AppState {
        store: Arc::new(store),
        backend_url: Arc::new("http://backend.invalid".to_string()),
        http: reqwest::Client::new(),
        service_token: Some(Arc::new(SERVICE_TOKEN.to_string())),
        capacity_reads: Arc::default(),
    })
}

/// A `GET /capacity` presenting the service token.
fn capacity_request() -> Request<Body> {
    Request::builder()
        .method("GET")
        .uri("/capacity")
        .header("authorization", format!("Bearer {SERVICE_TOKEN}"))
        .body(Body::empty())
        .unwrap()
}

/// The response's status and JSON body.
async fn answer(response: axum::response::Response) -> (StatusCode, serde_json::Value) {
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

/// A blocking step, and the two ends the test keeps of it.
fn blocking() -> (Step, mpsc::Receiver<()>, mpsc::Sender<Result<(), String>>) {
    let (started, has_started) = mpsc::channel();
    let (release, released) = mpsc::channel();
    (
        Step::Block {
            started,
            release: released,
        },
        has_started,
        release,
    )
}

/// Wait, off the async runtime, for a blocking step to announce itself.
async fn wait_for(has_started: mpsc::Receiver<()>) {
    tokio::task::spawn_blocking(move || has_started.recv().expect("the step starts"))
        .await
        .unwrap();
}

#[tokio::test]
async fn a_failed_write_check_is_a_200_that_carries_the_reason_beside_the_space() {
    let app = app(FaultyStore::probing(Step::Answer(Err(
        "Read-only file system (os error 30)".to_string(),
    ))));

    let (status, body) = answer(app.oneshot(capacity_request()).await.unwrap()).await;

    // An answer, not an error status: the backend must tell a store it read and
    // cannot write from a service it could not read at all.
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["writable"], false);
    assert_eq!(
        body["writeError"],
        "artifact store io error: Read-only file system (os error 30)"
    );
    assert_eq!(body["freeBytes"], CAPACITY.free_bytes);
    assert_eq!(body["totalBytes"], CAPACITY.total_bytes);
}

#[tokio::test]
async fn a_passing_write_check_reports_no_error() {
    let app = app(FaultyStore::probing(Step::Answer(Ok(()))));

    let (status, body) = answer(app.oneshot(capacity_request()).await.unwrap()).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["writable"], true);
    assert!(body.get("writeError").is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_reading_that_has_not_returned_is_answered_without_starting_another() {
    let (probe, has_started, release) = blocking();
    let app = app(FaultyStore::probing(probe));

    // The first reading reads the space and then hangs in its write check, as a
    // volume that has stopped answering leaves it.
    let first = tokio::spawn(app.clone().oneshot(capacity_request()));
    wait_for(has_started).await;

    // The next poll starts nothing: had it run the check, the scripted step
    // would have been taken twice and the test would hang on its lock. It
    // answers from the space the hung reading did read.
    let (status, body) = answer(app.clone().oneshot(capacity_request()).await.unwrap()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["writable"], false);
    assert_eq!(
        body["writeError"],
        "the previous write check has not returned"
    );
    assert_eq!(body["freeBytes"], CAPACITY.free_bytes);

    // The volume answers again. The hung reading returns, and the next one runs.
    release.send(Ok(())).unwrap();
    let (status, body) = answer(first.await.unwrap().unwrap()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["writable"], true);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_first_reading_that_has_not_returned_is_a_503() {
    let (statvfs, has_started, release) = blocking();
    let app = app(FaultyStore {
        statvfs: std::sync::Mutex::new(statvfs),
        probe: std::sync::Mutex::new(Step::Answer(Ok(()))),
    });

    // The very first reading hangs before it has read the space, so there are no
    // figures to answer with and "0 bytes free" would be a lie.
    let first = tokio::spawn(app.clone().oneshot(capacity_request()));
    wait_for(has_started).await;

    let response = app.clone().oneshot(capacity_request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);

    release.send(Ok(())).unwrap();
    assert_eq!(first.await.unwrap().unwrap().status(), StatusCode::OK);
}

#[tokio::test]
async fn a_reading_runs_again_once_the_one_before_it_has_returned() {
    let app = app(FaultyStore::probing(Step::Answer(Ok(()))));

    for _ in 0..3 {
        let (status, body) = answer(app.clone().oneshot(capacity_request()).await.unwrap()).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["writable"], true);
    }
}

#[tokio::test]
async fn a_space_read_that_fails_is_an_error_status() {
    let app = app(FaultyStore {
        statvfs: std::sync::Mutex::new(Step::Answer(Err("Input/output error".to_string()))),
        probe: std::sync::Mutex::new(Step::Answer(Ok(()))),
    });

    let response = app.clone().oneshot(capacity_request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);

    // And the failed reading is not left marked as running.
    let response = app.oneshot(capacity_request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
}
