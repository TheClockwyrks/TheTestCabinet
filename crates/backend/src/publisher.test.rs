use super::*;
use tempfile::TempDir;

use test_cabinet_core::metrics::RunMetrics;
use test_cabinet_core::review::{DomainRating, Rating};
use test_cabinet_core::run_record::{
    HarnessSlug, RunEnvironment, RunLinks, RunRecord, RunState, RunStatus, RunSubject, RunTooling,
};
use test_cabinet_core::validation::ValidationSummary;

use crate::db::StoredReview;

pub(super) fn record(id: &str) -> RunRecord {
    RunRecord {
        id: id.to_string(),
        started_at: "2026-06-17T20:40:00Z".to_string(),
        finished_at: "2026-06-17T21:30:00Z".to_string(),
        subject: RunSubject {
            test_case_slug: "pong".to_string(),
            test_case_version: "v1.0.0".to_string(),
            test_type: test_cabinet_core::TestType::EndToEnd,
            variant: "base".to_string(),
            harness_slug: HarnessSlug::Claude,
            harness_version: None,
            orchestrator_slug: "one-shot".to_string(),
            engine_slug: "none".to_string(),
            engine_version: None,
            model_id: "m".to_string(),
            gg_capability_set: None,
            gg_summary: None,
        },
        tooling: RunTooling::default(),
        environment: RunEnvironment {
            os: "Debian".to_string(),
            container_image: "img".to_string(),
            node_version: None,
            auth_mode: test_cabinet_core::AuthMode::ApiKey,
        },
        metrics: RunMetrics::default(),
        validation: ValidationSummary::default(),
        links: RunLinks::default(),
        status: RunStatus {
            state: RunState::Completed,
            detail: None,
        },
        game_jam_readme: None,
        tool_calls: Default::default(),
        game_jam_prior_entries: Vec::new(),
        seed_commit: None,
        code_analysis: None,
        toolchain: None,
        showcase: None,
    }
}

/// Push, review, and publish a run so it lands in the published set the snapshot
/// is built from.
pub(super) async fn seed_published(db: &Db, id: &str, published_at: &str) {
    db.push(&record(id), &RunLinks::default(), None, None)
        .await
        .unwrap();
    db.add_review(
        id,
        &StoredReview {
            reviewer: crate::db::Reviewer {
                user_id: "u1".to_string(),
                username: "ada".to_string(),
                display_name: "Ada".to_string(),
            },
            ratings: vec![DomainRating {
                domain: "gameplay".to_string(),
                rating: Rating::Great,
            }],
            aesthetics: vec![],
            aesthetic: None,
            writeup: "ok".to_string(),
            checklist: vec![],
            reviewed_at: "2026-06-17T22:00:00Z".to_string(),
            edited_at: None,
            revisions: Vec::new(),
        },
        None,
        None,
    )
    .await
    .unwrap();
    db.publish(id, published_at).await.unwrap();
}

/// Build a publisher in dev mode (no R2, no hook): an in-memory database and a
/// fresh temp definition store. The `TempDir` is returned so the store outlives
/// the publisher.
async fn dev_publisher() -> (TempDir, Publisher, Arc<Db>) {
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    // A short quiet window, so the loop acts within the test.
    let publisher = dev_publisher_on(&dir, &db, Duration::from_millis(10));
    (dir, publisher, db)
}

/// A dev-mode publisher over an existing database and store directory, releasing
/// a batch below the threshold after `quiet_window`. Building a second one on the
/// same database is a backend that restarted.
fn dev_publisher_on(dir: &TempDir, db: &Arc<Db>, quiet_window: Duration) -> Publisher {
    let store = DefinitionStore::open(dir.path().join("store")).unwrap();
    Publisher::new(
        Arc::clone(db),
        store,
        None,
        None,
        None,
        Arc::new(test_cabinet_core::AccountsClient::new(
            "http://auth.invalid",
        )),
        PublisherTiming {
            // No hold between releases, so the loop acts within the test.
            batch: BatchTiming {
                threshold: 20,
                quiet_window,
                min_interval: Duration::ZERO,
                refresh_timeout: Duration::from_secs(30 * 60),
            },
            // Retention is irrelevant to the dev publisher: with no R2 there is no
            // bucket to prune.
            snapshot_retention: Duration::from_secs(24 * 3600),
            confirm_media: None,
        },
    )
}

#[tokio::test]
async fn forced_refresh_regenerates_and_clears_dirty_in_dev_mode() {
    let (_dir, publisher, db) = dev_publisher().await;
    seed_published(&db, "r1", "2026-06-17T21:40:00Z").await;
    assert!(db.snapshot_state().await.unwrap().dirty);

    let outcome = publisher.refresh_now().await.unwrap();
    assert_eq!(outcome.run_count, 1);
    // No hook configured in dev mode.
    assert!(!outcome.deploy_hook_fired);
    // The refresh clears the dirty flag and records the run count.
    let state = db.snapshot_state().await.unwrap();
    assert!(!state.dirty);
    assert_eq!(state.last_run_count, Some(1));
}

#[tokio::test]
async fn coalesced_refresher_folds_a_burst_into_one_clear() {
    let (_dir, publisher, db) = dev_publisher().await;
    let mut refreshes = publisher.refreshes();
    let handle = publisher.spawn();

    // A burst of three publishes, each counting one request.
    for i in 0..3 {
        seed_published(&db, &format!("r{i}"), &format!("2026-06-17T21:4{i}:00Z")).await;
        publisher.queue_refresh();
    }

    // The batching loop folds the burst, converging on a clean snapshot over
    // the full three-run set. Each check follows a refresh the loop finished, and
    // waiting on the converged count rather than the first cleared flag tolerates
    // an early refresh that snapshots a row mid-burst — the loop always runs a
    // final refresh once the last publish has landed. A loop that never got there
    // would leave this waiting, and nextest would stop the test.
    let mut state = db.snapshot_state().await.unwrap();
    while state.dirty || state.last_run_count != Some(3) {
        refreshes
            .changed()
            .await
            .expect("the refresher is still running");
        state = db.snapshot_state().await.unwrap();
    }
    assert!(!state.dirty, "the coalesced refresh cleared the dirty flag");
    assert_eq!(state.last_run_count, Some(3));

    handle.join().await;
}

#[tokio::test]
async fn a_request_that_set_no_dirty_flag_is_recorded_and_survives_a_restart() {
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    // A quiet window the test never reaches, so the request stays pending.
    let publisher = dev_publisher_on(&dir, &db, Duration::from_secs(24 * 3600));
    let mut recordings = publisher.recordings();
    let refreshes = publisher.refreshes();
    let handle = publisher.spawn();

    // A catalog change requests a refresh without touching the dirty flag, which
    // only a publish sets in its own transaction.
    assert!(!db.snapshot_state().await.unwrap().dirty);
    publisher.queue_refresh();
    recordings
        .changed()
        .await
        .expect("the refresher is still running");
    assert!(
        db.snapshot_state().await.unwrap().dirty,
        "the pending request is recorded in the database"
    );

    // The backend stops with the request unreleased.
    handle.join().await;
    assert!(!refreshes.has_changed().unwrap_or(false));
    assert!(db.snapshot_state().await.unwrap().dirty);

    // The one that starts on the same database releases it, with no new request.
    let restarted = dev_publisher_on(&dir, &db, Duration::from_secs(24 * 3600));
    let mut refreshes = restarted.refreshes();
    let handle = restarted.spawn();
    refreshes
        .changed()
        .await
        .expect("the refresher is still running");
    let state = db.snapshot_state().await.unwrap();
    assert!(!state.dirty, "the refresh cleared the recorded request");
    assert_eq!(state.last_run_count, Some(0));

    handle.join().await;
}

#[test]
fn a_recovery_waits_out_what_the_last_upload_left_of_the_minimum_interval() {
    let now = OffsetDateTime::parse("2026-10-12T12:00:00Z", &Rfc3339).unwrap();
    let ten_minutes = Duration::from_secs(600);
    let hold = |uploaded: Option<&str>| recovery_hold(uploaded, now, ten_minutes);

    // Four minutes ago leaves six.
    assert_eq!(hold(Some("2026-10-12T11:56:00Z")), Duration::from_secs(360));
    // Longer ago than the interval, never uploaded, or unreadable: no wait.
    assert_eq!(hold(Some("2026-10-12T11:00:00Z")), Duration::ZERO);
    assert_eq!(hold(None), Duration::ZERO);
    assert_eq!(hold(Some("yesterday")), Duration::ZERO);
    // An upload stamped in the future is a clock that moved, not a reason to wait.
    assert_eq!(hold(Some("2026-10-12T13:00:00Z")), Duration::ZERO);
    // No minimum interval, no wait.
    assert_eq!(
        recovery_hold(Some("2026-10-12T11:59:59Z"), now, Duration::ZERO),
        Duration::ZERO
    );
}

#[tokio::test]
async fn a_refresh_pending_at_the_last_stop_is_released_at_startup() {
    let (_dir, publisher, db) = dev_publisher().await;
    seed_published(&db, "r1", "2026-06-17T21:40:00Z").await;
    assert!(db.snapshot_state().await.unwrap().dirty);

    // No request is queued: the persisted dirty flag alone releases a refresh.
    let mut refreshes = publisher.refreshes();
    let handle = publisher.spawn();
    refreshes
        .changed()
        .await
        .expect("the refresher is still running");
    let state = db.snapshot_state().await.unwrap();
    assert!(!state.dirty);
    assert_eq!(state.last_run_count, Some(1));

    handle.join().await;
}

// ---------------------------------------------------------------------------
// Media confirmation
// ---------------------------------------------------------------------------

/// A stand-in bucket: it keeps what is put, lists it by prefix, and can be told to
/// refuse the listing of one prefix. Requests are not authenticated.
#[derive(Default)]
pub(super) struct Bucket {
    pub(super) objects: std::sync::Mutex<std::collections::BTreeMap<String, Vec<u8>>>,
    /// A prefix whose listing answers `500`.
    unlistable: std::sync::Mutex<Option<String>>,
    /// How many objects were put, `index.json` among them.
    puts: std::sync::atomic::AtomicUsize,
}

impl Bucket {
    pub(super) fn keys(&self) -> Vec<String> {
        self.objects.lock().unwrap().keys().cloned().collect()
    }
}

/// Serve `bucket` over HTTP and return the configuration that reaches it.
async fn spawn_bucket(bucket: Arc<Bucket>) -> test_cabinet_core::r2::R2Config {
    use axum::extract::{Query, Request};
    use axum::http::{Method, StatusCode};

    async fn serve(
        bucket: Arc<Bucket>,
        Query(query): Query<std::collections::HashMap<String, String>>,
        request: Request,
    ) -> (StatusCode, String) {
        let key = request
            .uri()
            .path()
            .strip_prefix("/bucket")
            .unwrap_or_default()
            .trim_start_matches('/')
            .to_string();
        let method = request.method().clone();
        if method == Method::PUT {
            let bytes = axum::body::to_bytes(request.into_body(), usize::MAX)
                .await
                .unwrap();
            bucket.objects.lock().unwrap().insert(key, bytes.to_vec());
            bucket
                .puts
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            return (StatusCode::OK, String::new());
        }
        if method == Method::GET && query.contains_key("list-type") {
            let prefix = query.get("prefix").cloned().unwrap_or_default();
            if bucket.unlistable.lock().unwrap().as_deref() == Some(prefix.as_str()) {
                return (StatusCode::INTERNAL_SERVER_ERROR, String::new());
            }
            let contents: String = bucket
                .objects
                .lock()
                .unwrap()
                .keys()
                .filter(|key| key.starts_with(&prefix))
                .map(|key| format!("<Contents><Key>{key}</Key></Contents>"))
                .collect();
            return (
                StatusCode::OK,
                format!("<ListBucketResult>{contents}</ListBucketResult>"),
            );
        }
        if method == Method::GET {
            return match bucket.objects.lock().unwrap().get(&key) {
                Some(bytes) => (StatusCode::OK, String::from_utf8_lossy(bytes).into_owned()),
                None => (StatusCode::NOT_FOUND, String::new()),
            };
        }
        // A batch delete, answered as a quiet success that removes nothing: no
        // test here is about pruning.
        (StatusCode::OK, String::new())
    }

    let app = axum::Router::new().fallback(move |query, request| serve(bucket, query, request));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    test_cabinet_core::r2::R2Config {
        account_id: "acct".to_string(),
        bucket: "bucket".to_string(),
        access_key_id: "key".to_string(),
        secret_access_key: "secret".to_string(),
        endpoint: format!("http://{addr}"),
        region: "auto".to_string(),
    }
}

/// The bucket name confirmations are recorded against in these tests.
pub(super) const BUCKET: &str = crate::db::retention_tests::BUCKET;

/// A stand-in artifact service: the trees it holds, each a set of
/// `<kind>/<file>` media files and `root/<name>` root files, served on the routes
/// a refresh reads.
#[derive(Default)]
pub(super) struct Trees {
    pub(super) trees: std::sync::Mutex<
        std::collections::BTreeMap<String, std::collections::BTreeMap<String, Vec<u8>>>,
    >,
    /// Whether every request answers `500`.
    down: std::sync::atomic::AtomicBool,
    /// The runs whose listing was asked for, in order.
    listed: std::sync::Mutex<Vec<String>>,
}

impl Trees {
    /// Hold a tree for `run_id` with `files`, each `(<kind>/<file>, bytes)`.
    pub(super) fn store(&self, run_id: &str, files: &[(&str, &[u8])]) {
        self.trees.lock().unwrap().insert(
            run_id.to_string(),
            files
                .iter()
                .map(|(name, bytes)| (name.to_string(), bytes.to_vec()))
                .collect(),
        );
    }

    pub(super) fn listed(&self) -> Vec<String> {
        self.listed.lock().unwrap().clone()
    }

    pub(super) fn set_down(&self, down: bool) {
        self.down.store(down, std::sync::atomic::Ordering::SeqCst);
    }
}

/// Serve `trees` over HTTP and return the base URL that reaches them.
async fn spawn_trees(trees: Arc<Trees>) -> String {
    use axum::extract::{Path, State};
    use axum::http::StatusCode;
    use axum::response::IntoResponse;

    async fn listing(
        State(trees): State<Arc<Trees>>,
        Path(id): Path<String>,
    ) -> axum::response::Response {
        if trees.down.load(std::sync::atomic::Ordering::SeqCst) {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
        trees.listed.lock().unwrap().push(id.clone());
        let held = trees.trees.lock().unwrap();
        let names = |kind: &str| -> Vec<String> {
            held.get(&id)
                .into_iter()
                .flat_map(|files| files.keys())
                .filter_map(|name| name.strip_prefix(kind))
                .map(str::to_string)
                .collect()
        };
        axum::Json(serde_json::json!({
            "id": id,
            "stored": held.contains_key(&id),
            "validation": names("validation/"),
            "showcase": names("showcase/"),
            "root": names("root/"),
        }))
        .into_response()
    }

    async fn file(
        State(trees): State<Arc<Trees>>,
        Path((id, kind, file)): Path<(String, String, String)>,
    ) -> axum::response::Response {
        if trees.down.load(std::sync::atomic::Ordering::SeqCst) {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
        let held = trees.trees.lock().unwrap();
        match held
            .get(&id)
            .and_then(|files| files.get(&format!("{kind}/{file}")))
        {
            Some(bytes) => bytes.clone().into_response(),
            None => StatusCode::NOT_FOUND.into_response(),
        }
    }

    let app = axum::Router::new()
        .route("/runs/{id}/media", axum::routing::get(listing))
        .route("/runs/{id}/{kind}/{file}", axum::routing::get(file))
        .with_state(trees);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

/// A publisher that uploads to `bucket`, with no hook. With `trees` it is the
/// publisher of a backend whose sweep reclaims published trees: it reads the
/// stand-in artifact service and records media confirmations against [`BUCKET`].
/// Without, it has no artifact service and records none. A quiet window the tests
/// never reach, so nothing is released unless forced.
pub(super) async fn bucket_publisher(
    dir: &TempDir,
    db: &Arc<Db>,
    bucket: &Arc<Bucket>,
    trees: Option<&Arc<Trees>>,
) -> Publisher {
    let store = DefinitionStore::open(dir.path().join("store")).unwrap();
    let artifacts_url = match trees {
        Some(trees) => Some(spawn_trees(Arc::clone(trees)).await),
        None => None,
    };
    Publisher::new(
        Arc::clone(db),
        store,
        Some(R2Client::new(spawn_bucket(Arc::clone(bucket)).await)),
        None,
        artifacts_url,
        Arc::new(test_cabinet_core::AccountsClient::new(
            "http://auth.invalid",
        )),
        PublisherTiming {
            batch: BatchTiming {
                threshold: 20,
                quiet_window: Duration::from_secs(24 * 3600),
                min_interval: Duration::ZERO,
                refresh_timeout: Duration::from_secs(30 * 60),
            },
            snapshot_retention: Duration::from_secs(24 * 3600),
            confirm_media: trees.map(|_| BUCKET),
        },
    )
}

/// Publish a run that lists one proof image the agent produced. Nothing in these
/// tests holds its bytes except a bucket that is given them.
pub(super) async fn seed_published_with_proof(db: &Db, id: &str) {
    use test_cabinet_core::MediaKind;
    use test_cabinet_core::validation::ProofResult;

    seed_published(db, id, "2026-06-17T21:40:00Z").await;
    let mut with_proof = record(id);
    with_proof.validation.proofs = vec![ProofResult {
        id: "title".into(),
        name: "title".into(),
        kind: MediaKind::Image,
        dest: "proof/title.png".into(),
        present: true,
        detail: None,
    }];
    db.push(&with_proof, &RunLinks::default(), None, None)
        .await
        .unwrap();
    assert!(
        run_columns(db, id).await.published,
        "a re-push keeps the run published"
    );
}

/// Run `id`'s row.
pub(super) async fn run_columns(db: &Db, id: &str) -> test_cabinet_entities::run::Model {
    crate::db::retention_tests::run_row(db, id).await
}

#[tokio::test]
async fn an_uploaded_refresh_confirms_a_run_whose_media_is_all_in_the_bucket() {
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    let trees = Arc::new(Trees::default());
    let publisher = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;
    // One run lists no media at all. The other lists a proof that is already in
    // the bucket under the key the snapshot references.
    seed_published(&db, "plain", "2026-06-17T21:40:00Z").await;
    seed_published_with_proof(&db, "proven").await;
    bucket.objects.lock().unwrap().insert(
        "media/runs/proven/proof/title.png".to_string(),
        b"png".to_vec(),
    );

    let outcome = publisher.refresh_now().await.unwrap();

    assert_eq!(outcome.run_count, 2);
    for id in ["plain", "proven"] {
        let row = run_columns(&db, id).await;
        assert!(row.media_confirmed_at.is_some(), "{id} is confirmed");
        assert_eq!(row.media_checked_at, row.media_confirmed_at, "{id}");
        assert_eq!(row.media_bucket.as_deref(), Some(BUCKET), "{id}");
    }
    assert_eq!(db.published_runs_unchecked(BUCKET).await.unwrap(), 0);
}

#[tokio::test]
async fn a_run_with_a_listed_file_the_bucket_lacks_is_left_unconfirmed() {
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    let trees = Arc::new(Trees::default());
    let publisher = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;
    seed_published(&db, "plain", "2026-06-17T21:40:00Z").await;
    // The proof is in no bucket and no store, and the artifact service holds no
    // tree for the run, so the snapshot is published without it.
    seed_published_with_proof(&db, "proven").await;

    publisher.refresh_now().await.unwrap();

    let proven = run_columns(&db, "proven").await;
    assert_eq!(proven.media_confirmed_at, None, "the tree must be kept");
    assert!(proven.media_checked_at.is_some(), "it was evaluated");
    assert!(run_columns(&db, "plain").await.media_confirmed_at.is_some());
    // Evaluated, so a restart asks for nothing on its account.
    assert_eq!(db.published_runs_unchecked(BUCKET).await.unwrap(), 0);

    // The file reaches the bucket, and the next refresh confirms the run.
    bucket.objects.lock().unwrap().insert(
        "media/runs/proven/proof/title.png".to_string(),
        b"png".to_vec(),
    );
    publisher.refresh_now().await.unwrap();
    assert!(
        run_columns(&db, "proven")
            .await
            .media_confirmed_at
            .is_some()
    );
}

#[tokio::test]
async fn a_refresh_that_uploads_nothing_confirms_nothing() {
    // Dev mode: the snapshot is built and not uploaded. What the build found says
    // nothing about a bucket.
    let (_dir, publisher, db) = dev_publisher().await;
    seed_published(&db, "plain", "2026-06-17T21:40:00Z").await;

    publisher.refresh_now().await.unwrap();

    let row = run_columns(&db, "plain").await;
    assert_eq!(row.media_confirmed_at, None);
    assert_eq!(row.media_checked_at, None);
}

#[tokio::test]
async fn a_refresh_that_cannot_list_the_buckets_media_fails_and_uploads_nothing() {
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    let trees = Arc::new(Trees::default());
    let publisher = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;
    seed_published_with_proof(&db, "proven").await;
    *bucket.unlistable.lock().unwrap() = Some("media/".to_string());

    let error = publisher.refresh_now().await.unwrap_err().to_string();

    assert!(error.contains("media/"), "{error}");
    // Nothing went live: a snapshot built from an empty listing would have left
    // out the media of every run whose tree was reclaimed.
    assert!(bucket.keys().is_empty(), "{:?}", bucket.keys());
    assert_eq!(run_columns(&db, "proven").await.media_checked_at, None);
    assert!(db.snapshot_state().await.unwrap().dirty);
}

#[tokio::test]
async fn a_refresh_that_cannot_list_the_buckets_case_files_still_publishes() {
    // The case files are read from the definition store, which is always there to
    // read again, so that listing failing only costs a re-export.
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    let trees = Arc::new(Trees::default());
    let publisher = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;
    seed_published(&db, "plain", "2026-06-17T21:40:00Z").await;
    *bucket.unlistable.lock().unwrap() = Some("files/".to_string());

    publisher.refresh_now().await.unwrap();

    assert!(bucket.keys().iter().any(|key| key == "index.json"));
    assert!(run_columns(&db, "plain").await.media_confirmed_at.is_some());
}

#[tokio::test]
async fn a_start_requests_one_refresh_while_published_runs_await_a_confirmation() {
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    seed_published(&db, "a", "2026-06-17T21:40:00Z").await;
    seed_published(&db, "b", "2026-06-17T21:41:00Z").await;

    // The deployment that first carries the rule: two published runs, neither
    // evaluated. One request, however many runs wait.
    let trees = Arc::new(Trees::default());
    let first = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;
    first.inner.request_startup_confirmation().await;
    assert_eq!(first.inner.batcher.pending(), 1);

    // That refresh evaluates both.
    first.refresh_now().await.unwrap();
    assert_eq!(db.published_runs_unchecked(BUCKET).await.unwrap(), 0);
    let uploads = bucket.puts.load(std::sync::atomic::Ordering::SeqCst);

    // Every later start requests nothing, so no gallery build is fired by a
    // restart.
    for _ in 0..3 {
        let restarted = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;
        restarted.inner.request_startup_confirmation().await;
        assert_eq!(restarted.inner.batcher.pending(), 0);
    }
    assert_eq!(
        bucket.puts.load(std::sync::atomic::Ordering::SeqCst),
        uploads
    );
}

#[tokio::test]
async fn a_start_requests_no_refresh_where_a_confirmation_would_be_of_no_use() {
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    seed_published(&db, "a", "2026-06-17T21:40:00Z").await;

    // The deployment does not reclaim published trees.
    let off = bucket_publisher(&dir, &db, &bucket, None).await;
    off.inner.request_startup_confirmation().await;
    assert_eq!(off.inner.batcher.pending(), 0);

    // There is no bucket to confirm against.
    let store = DefinitionStore::open(dir.path().join("store")).unwrap();
    let no_bucket = Publisher::new(
        Arc::clone(&db),
        store,
        None,
        None,
        None,
        Arc::new(test_cabinet_core::AccountsClient::new(
            "http://auth.invalid",
        )),
        PublisherTiming {
            batch: BatchTiming {
                threshold: 20,
                quiet_window: Duration::from_secs(24 * 3600),
                min_interval: Duration::ZERO,
                refresh_timeout: Duration::from_secs(30 * 60),
            },
            snapshot_retention: Duration::from_secs(24 * 3600),
            confirm_media: Some(BUCKET),
        },
    );
    no_bucket.inner.request_startup_confirmation().await;
    assert_eq!(no_bucket.inner.batcher.pending(), 0);

    // There are no published runs.
    let empty = Arc::new(Db::connect_in_memory().await.unwrap());
    let trees = Arc::new(Trees::default());
    let nothing_published = bucket_publisher(&dir, &empty, &bucket, Some(&trees)).await;
    nothing_published.inner.request_startup_confirmation().await;
    assert_eq!(nothing_published.inner.batcher.pending(), 0);
}

#[tokio::test]
async fn a_backend_that_reclaims_no_published_tree_records_no_confirmation() {
    // No sweep deletes this backend's published trees, so nothing waits on a
    // confirmation: none is recorded, and no run is counted as awaiting one.
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    let publisher = bucket_publisher(&dir, &db, &bucket, None).await;
    seed_published(&db, "plain", "2026-06-17T21:40:00Z").await;

    publisher.refresh_now().await.unwrap();

    assert!(bucket.keys().iter().any(|key| key == "index.json"));
    let row = run_columns(&db, "plain").await;
    assert_eq!(row.media_confirmed_at, None);
    assert_eq!(row.media_checked_at, None);
    assert_eq!(row.media_bucket, None);
}

#[tokio::test]
async fn a_file_only_the_tree_names_is_published_before_the_run_is_confirmed() {
    // The image store a run's recordings share is on no record, and the backend's
    // own copy of it went with a restart. Only the tree still names the file. A
    // refresh that confirmed the run without it would let the sweep delete the
    // only copy.
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    let trees = Arc::new(Trees::default());
    let publisher = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;
    seed_published(&db, "replayed", "2026-06-17T21:40:00Z").await;
    trees.store("replayed", &[("validation/img.0a1b.png", b"png")]);

    publisher.refresh_now().await.unwrap();

    assert_eq!(
        bucket
            .objects
            .lock()
            .unwrap()
            .get("media/runs/replayed/validation/img.0a1b.png")
            .map(Vec::as_slice),
        Some(b"png".as_slice()),
        "{:?}",
        bucket.keys()
    );
    assert!(
        run_columns(&db, "replayed")
            .await
            .media_confirmed_at
            .is_some()
    );
}

#[tokio::test]
async fn a_run_whose_tree_cannot_be_listed_is_left_unconfirmed() {
    // Every file the record lists is in the bucket. What the tree holds beyond
    // that cannot be learned, so the run is not confirmed on the record's word.
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    let trees = Arc::new(Trees::default());
    let publisher = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;
    seed_published_with_proof(&db, "proven").await;
    bucket.objects.lock().unwrap().insert(
        "media/runs/proven/proof/title.png".to_string(),
        b"png".to_vec(),
    );
    trees.set_down(true);

    publisher.refresh_now().await.unwrap();

    let row = run_columns(&db, "proven").await;
    assert_eq!(row.media_confirmed_at, None, "the tree must be kept");
    assert!(row.media_checked_at.is_some(), "it was evaluated");

    // The service answers again, and the next refresh confirms the run.
    trees.set_down(false);
    publisher.refresh_now().await.unwrap();
    assert!(
        run_columns(&db, "proven")
            .await
            .media_confirmed_at
            .is_some()
    );
}

#[tokio::test]
async fn a_listed_file_a_stored_tree_does_not_hold_does_not_keep_the_tree() {
    // The record lists a proof the run never wrote: the service holds the run's
    // tree and answers `404` for the file. Keeping the tree could never supply it.
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    let trees = Arc::new(Trees::default());
    let publisher = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;
    seed_published_with_proof(&db, "proven").await;
    trees.store("proven", &[]);

    publisher.refresh_now().await.unwrap();

    assert!(
        run_columns(&db, "proven")
            .await
            .media_confirmed_at
            .is_some()
    );
    assert!(
        !bucket
            .keys()
            .iter()
            .any(|key| key.starts_with("media/runs/proven/")),
        "{:?}",
        bucket.keys()
    );
}

#[tokio::test]
async fn a_listed_file_is_published_from_the_tree() {
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    let trees = Arc::new(Trees::default());
    let publisher = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;
    seed_published_with_proof(&db, "proven").await;
    trees.store("proven", &[("proof/title.png", b"png")]);

    publisher.refresh_now().await.unwrap();

    assert!(
        bucket
            .keys()
            .iter()
            .any(|key| key == "media/runs/proven/proof/title.png"),
        "{:?}",
        bucket.keys()
    );
    assert!(
        run_columns(&db, "proven")
            .await
            .media_confirmed_at
            .is_some()
    );
}

#[tokio::test]
async fn a_run_confirmed_in_another_bucket_is_evaluated_against_this_one() {
    // The database came from an environment that publishes somewhere else. Its
    // confirmation says nothing about this bucket, which does not hold the proof.
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    let trees = Arc::new(Trees::default());
    seed_published_with_proof(&db, "proven").await;
    crate::db::retention_tests::set_media_confirmed_in(
        &db,
        "proven",
        Some("2026-06-18T00:00:00Z"),
        "https://r2.test/other",
    )
    .await;
    let publisher = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;

    // A start asks for the refresh that evaluates it here.
    publisher.inner.request_startup_confirmation().await;
    assert_eq!(publisher.inner.batcher.pending(), 1);

    publisher.refresh_now().await.unwrap();

    let row = run_columns(&db, "proven").await;
    assert_eq!(row.media_confirmed_at, None, "the tree must be kept");
    assert_eq!(row.media_bucket.as_deref(), Some(BUCKET));
    assert_eq!(db.published_runs_unchecked(BUCKET).await.unwrap(), 0);
}

#[tokio::test]
async fn a_settled_run_is_asked_about_no_further_and_stays_confirmed() {
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    let trees = Arc::new(Trees::default());
    let publisher = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;
    seed_published_with_proof(&db, "proven").await;
    trees.store("proven", &[("proof/title.png", b"png")]);
    publisher.refresh_now().await.unwrap();
    let confirmed_at = run_columns(&db, "proven").await.media_confirmed_at;
    assert!(confirmed_at.is_some());
    assert_eq!(trees.listed(), ["proven"]);

    // The sweep reclaims the tree, and the artifact service then goes away.
    let seen = db
        .retention_run("proven", Some(BUCKET))
        .await
        .unwrap()
        .unwrap();
    db.mark_artifacts_reclaimed(
        &seen,
        crate::db::ReclaimReason::Published,
        "2026-07-01T00:00:00Z",
    )
    .await
    .unwrap();
    trees.trees.lock().unwrap().clear();
    trees.set_down(true);

    publisher.refresh_now().await.unwrap();

    assert_eq!(trees.listed(), ["proven"], "nothing more was asked");
    assert_eq!(
        run_columns(&db, "proven").await.media_confirmed_at,
        confirmed_at
    );
}

#[tokio::test]
async fn a_reclaimed_run_whose_media_is_nowhere_is_confirmed_without_it() {
    // Confirmed against another bucket and reclaimed there; this backend's bucket
    // does not hold the proof, nor does its store, and the artifact service
    // answers that it holds no tree, as the reclaim record says. Nothing this
    // backend can reach holds the file, so the run is confirmed here with the
    // proof recorded as unrecoverable, not left unconfirmed for good.
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let bucket = Arc::new(Bucket::default());
    let trees = Arc::new(Trees::default());
    seed_published_with_proof(&db, "proven").await;
    crate::db::retention_tests::set_media_confirmed_in(
        &db,
        "proven",
        Some("2026-06-18T00:00:00Z"),
        "https://r2.test/other",
    )
    .await;
    let seen = db.retention_run("proven", None).await.unwrap().unwrap();
    db.mark_artifacts_reclaimed(
        &seen,
        crate::db::ReclaimReason::Published,
        "2026-07-01T00:00:00Z",
    )
    .await
    .unwrap();
    let publisher = bucket_publisher(&dir, &db, &bucket, Some(&trees)).await;

    publisher.refresh_now().await.unwrap();

    let row = run_columns(&db, "proven").await;
    assert!(row.media_confirmed_at.is_some());
    assert_eq!(row.media_bucket.as_deref(), Some(BUCKET));
    let manifest = db
        .run_media_manifest("proven", Some(BUCKET))
        .await
        .unwrap()
        .expect("a confirmed run has a manifest");
    assert_eq!(
        manifest.files,
        [crate::db::MediaManifestFile::unrecoverable(
            crate::db::MediaFileKind::Proof,
            "proof/title.png",
            None
        )]
    );
    assert_eq!(
        db.run_media_manifest("proven", Some("https://r2.test/other"))
            .await
            .unwrap(),
        None,
        "the confirmation it had against the other bucket is gone"
    );
    assert!(
        db.run_artifacts_reclaimed("proven")
            .await
            .unwrap()
            .is_some(),
        "the reclaim record stands"
    );
}
