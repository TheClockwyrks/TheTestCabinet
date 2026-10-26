//! Tests of a refresh writing the public dataset through the artifacts service.
//!
//! A stub artifacts service stands on an ephemeral port with an in-memory bucket
//! behind its `GET /public`, `PUT /public/{key}`, `DELETE /public/{key}` and
//! `POST /runs/{id}/publish-media` routes, so the real `reqwest` paths run and the
//! order of every call a refresh makes is recorded.

use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path as AxumPath, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use tempfile::TempDir;

use super::tests::seed_published;
use super::*;

/// The service token every stub route requires as a bearer.
const TOKEN: &str = "public-service-token";

/// A run id long enough that its short code is its first eight characters.
const RUN: &str = "runabcdefghijklmnop";

/// [`RUN`]'s short code.
const RUN_CODE: &str = "runabcde";

/// One stored object: its bytes and the content type it was written with.
#[derive(Debug, Clone)]
struct Object {
    bytes: Vec<u8>,
    content_type: String,
}

/// The stub's state: the bucket, the call log, and how it should answer.
#[derive(Default)]
struct Bucket {
    objects: BTreeMap<String, Object>,
    /// Every call, in order: `GET <prefix>`, `PUT <key>`, `DELETE <key>`,
    /// `POST <run id>`.
    log: Vec<String>,
    /// A key prefix whose writes the stub refuses with `500`.
    fail_put_prefix: Option<String>,
    /// What `publish-media` answers per run id; a run absent here is a `404`.
    media: HashMap<String, serde_json::Value>,
    /// When set, `publish-media` answers this status for every run instead.
    media_status: Option<StatusCode>,
    /// Whether every call presented the token.
    unauthorized: bool,
}

type Shared = Arc<Mutex<Bucket>>;

fn authorized(bucket: &Shared, headers: &HeaderMap) -> bool {
    let ok = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        == Some(&format!("Bearer {TOKEN}"));
    if !ok {
        bucket.lock().unwrap().unauthorized = true;
    }
    ok
}

async fn list(
    State(bucket): State<Shared>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    if !authorized(&bucket, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let prefix = query.get("prefix").cloned().unwrap_or_default();
    let mut bucket = bucket.lock().unwrap();
    bucket.log.push(format!("GET {prefix}"));
    let objects: Vec<serde_json::Value> = bucket
        .objects
        .iter()
        .filter(|(key, _)| key.starts_with(&prefix))
        .map(|(key, object)| {
            serde_json::json!({
                "key": key,
                "bytes": object.bytes.len(),
                "modifiedAt": "2026-06-17T21:00:00Z",
            })
        })
        .collect();
    axum::Json(serde_json::json!({ "objects": objects })).into_response()
}

async fn write(
    State(bucket): State<Shared>,
    AxumPath(key): AxumPath<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&bucket, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let mut bucket = bucket.lock().unwrap();
    bucket.log.push(format!("PUT {key}"));
    if bucket
        .fail_put_prefix
        .as_deref()
        .is_some_and(|prefix| key.starts_with(prefix))
    {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let bytes = body.to_vec();
    let len = bytes.len();
    bucket.objects.insert(
        key.clone(),
        Object {
            bytes,
            content_type,
        },
    );
    (
        StatusCode::CREATED,
        axum::Json(serde_json::json!({ "key": key, "bytes": len })),
    )
        .into_response()
}

async fn remove(
    State(bucket): State<Shared>,
    AxumPath(key): AxumPath<String>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&bucket, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let mut bucket = bucket.lock().unwrap();
    bucket.log.push(format!("DELETE {key}"));
    bucket.objects.remove(&key);
    StatusCode::NO_CONTENT.into_response()
}

async fn publish_media(
    State(bucket): State<Shared>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&bucket, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let mut bucket = bucket.lock().unwrap();
    bucket.log.push(format!("POST {id}"));
    if let Some(status) = bucket.media_status {
        return status.into_response();
    }
    match bucket.media.get(&id) {
        Some(answer) => axum::Json(answer.clone()).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// Stand the stub up over `bucket` and return its base URL.
async fn spawn_stub(bucket: Shared) -> String {
    let app = Router::new()
        .route("/public", get(list))
        .route("/public/{*key}", put(write).delete(remove))
        .route("/runs/{id}/publish-media", post(publish_media))
        .with_state(bucket);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}")
}

/// A publisher writing through the stub, over a fresh database and store.
async fn publisher(bucket: &Shared) -> (TempDir, Publisher, Arc<Db>) {
    let base = spawn_stub(Arc::clone(bucket)).await;
    let dir = TempDir::new().unwrap();
    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let store = DefinitionStore::open(dir.path().join("store")).unwrap();
    let publisher = Publisher::new(
        Arc::clone(&db),
        store,
        PublicDataset::new(reqwest::Client::new(), Some(&base), Some(TOKEN)),
        PublisherTiming {
            coalesce: Duration::from_millis(10),
            snapshot_retention: Duration::from_secs(24 * 3600),
        },
    );
    (dir, publisher, db)
}

/// The `publish-media` answer the stub gives for `run_id`.
fn media_answer(run_id: &str) -> serde_json::Value {
    serde_json::json!({
        "proofMedia": [{ "id": "title", "kind": "image", "key": format!("media/runs/{run_id}/proof/title.png") }],
        "validationMedia": [],
        "assetMedia": [],
        "showcaseMedia": [{ "file": "clip.webm", "key": format!("media/runs/{run_id}/showcase/clip.mp4") }],
    })
}

/// Seed an object into the stub's bucket.
fn seed(bucket: &Shared, key: &str, body: &str) {
    bucket.lock().unwrap().objects.insert(
        key.to_string(),
        Object {
            bytes: body.as_bytes().to_vec(),
            content_type: "application/json".to_string(),
        },
    );
}

/// The JSON object stored at `key`.
fn stored_json(bucket: &Shared, key: &str) -> serde_json::Value {
    let bucket = bucket.lock().unwrap();
    let object = bucket
        .objects
        .get(key)
        .unwrap_or_else(|| panic!("`{key}` is not in the bucket"));
    serde_json::from_slice(&object.bytes).unwrap()
}

/// The position of the first logged call starting with `prefix`.
fn first(log: &[String], prefix: &str) -> usize {
    log.iter()
        .position(|call| call.starts_with(prefix))
        .unwrap_or_else(|| panic!("no call starting `{prefix}` in {log:#?}"))
}

/// The position of the last logged call starting with `prefix`.
fn last(log: &[String], prefix: &str) -> usize {
    log.iter()
        .rposition(|call| call.starts_with(prefix))
        .unwrap_or_else(|| panic!("no call starting `{prefix}` in {log:#?}"))
}

/// A generation id stamped `hours` before now, in the shape a refresh mints.
fn generation_hours_ago(hours: i64) -> String {
    let stamp = OffsetDateTime::now_utc() - time::Duration::hours(hours);
    let format = time::macros::format_description!("[year]-[month]-[day]T[hour][minute]Z");
    format!("{}-0badf00d", stamp.format(&format).unwrap())
}

#[tokio::test]
async fn a_refresh_writes_codes_then_media_then_documents_then_the_generation_then_the_pointer() {
    let bucket = Shared::default();
    bucket
        .lock()
        .unwrap()
        .media
        .insert(RUN.to_string(), media_answer(RUN));
    seed(
        &bucket,
        "snapshots/2020-01-01T0000Z-deadbeef/runs.json",
        "{}",
    );
    let (_dir, publisher, db) = publisher(&bucket).await;
    seed_published(&db, RUN, "2026-06-17T21:40:00Z").await;

    publisher.refresh_now().await.unwrap();

    let bucket_state = bucket.lock().unwrap();
    let log = &bucket_state.log;
    assert!(!bucket_state.unauthorized, "every call presents the token");
    // Each phase finishes before the next begins.
    assert!(last(log, "PUT codes/") < first(log, "POST "));
    assert!(last(log, "POST ") < first(log, "PUT documents/"));
    assert!(last(log, "PUT documents/") < first(log, "PUT snapshots/"));
    assert!(last(log, "PUT snapshots/") < first(log, "PUT index.json"));
    assert_eq!(
        log.iter().filter(|call| *call == "PUT index.json").count(),
        1
    );
    // The prune runs only after the pointer has moved.
    assert!(first(log, "PUT index.json") < first(log, "DELETE "));
}

#[tokio::test]
async fn a_failed_write_leaves_the_pointer_and_the_generation_unwritten() {
    let bucket = Shared::default();
    seed(
        &bucket,
        "snapshots/2020-01-01T0000Z-deadbeef/runs.json",
        "{}",
    );
    bucket.lock().unwrap().fail_put_prefix = Some("documents/".to_string());
    let (_dir, publisher, db) = publisher(&bucket).await;
    seed_published(&db, RUN, "2026-06-17T21:40:00Z").await;

    assert!(publisher.refresh_now().await.is_err());

    let log = bucket.lock().unwrap().log.clone();
    assert!(
        !log.iter()
            .any(|call| call == "PUT index.json" || call.starts_with("PUT snapshots/")),
        "{log:#?}"
    );
    assert!(
        !log.iter().any(|call| call.starts_with("DELETE ")),
        "nothing is pruned while the previous generation is still live"
    );
    // The dirty flag is left for the next refresh to retry.
    assert!(db.snapshot_state().await.unwrap().dirty);
}

#[tokio::test]
async fn a_media_copy_the_service_refuses_fails_the_refresh_and_leaves_it_dirty() {
    // Publishing through an outage would put a generation live whose new documents
    // name no media, so a refused copy fails the refresh: no document, generation or
    // pointer is written, nothing is stored for the run, and the dirty flag stays set
    // so the refresh is retried.
    let bucket = Shared::default();
    bucket.lock().unwrap().media_status = Some(StatusCode::SERVICE_UNAVAILABLE);
    let (_dir, publisher, db) = publisher(&bucket).await;
    seed_published(&db, RUN, "2026-06-17T21:40:00Z").await;

    assert!(publisher.refresh_now().await.is_err());

    let log = bucket.lock().unwrap().log.clone();
    assert!(log.contains(&format!("POST {RUN}")), "{log:#?}");
    assert!(
        !log.iter().any(|call| call.starts_with("PUT documents/")
            || call.starts_with("PUT snapshots/")
            || call == "PUT index.json"),
        "{log:#?}"
    );
    assert!(db.public_media().await.unwrap().is_empty());
    let state = db.snapshot_state().await.unwrap();
    assert!(state.dirty, "a failed refresh leaves the snapshot dirty");
    assert_eq!(state.last_run_count, None);
}

#[tokio::test]
async fn a_code_object_is_written_once_and_never_overwritten() {
    let bucket = Shared::default();
    let (_dir, publisher, db) = publisher(&bucket).await;
    seed_published(&db, RUN, "2026-06-17T21:40:00Z").await;

    publisher.refresh_now().await.unwrap();
    publisher.refresh_now().await.unwrap();

    let bucket = bucket.lock().unwrap();
    let code_key = format!("codes/{RUN_CODE}");
    assert_eq!(
        bucket
            .log
            .iter()
            .filter(|call| **call == format!("PUT {code_key}"))
            .count(),
        1,
        "{:#?}",
        bucket.log
    );
    let object = &bucket.objects[&code_key];
    assert_eq!(object.bytes, RUN.as_bytes());
    assert!(object.content_type.starts_with("text/plain"));
}

#[tokio::test]
async fn a_code_the_bucket_already_holds_is_left_as_it_is() {
    let bucket = Shared::default();
    seed(&bucket, &format!("codes/{RUN_CODE}"), "written-before");
    let (_dir, publisher, db) = publisher(&bucket).await;
    seed_published(&db, RUN, "2026-06-17T21:40:00Z").await;

    publisher.refresh_now().await.unwrap();

    let bucket = bucket.lock().unwrap();
    assert!(!bucket.log.iter().any(|call| call.starts_with("PUT codes/")));
    assert_eq!(
        bucket.objects[&format!("codes/{RUN_CODE}")].bytes,
        b"written-before"
    );
}

#[tokio::test]
async fn the_documents_name_the_published_media_and_the_short_code() {
    let bucket = Shared::default();
    bucket
        .lock()
        .unwrap()
        .media
        .insert(RUN.to_string(), media_answer(RUN));
    let (_dir, publisher, db) = publisher(&bucket).await;
    seed_published(&db, RUN, "2026-06-17T21:40:00Z").await;

    publisher.refresh_now().await.unwrap();

    let index = stored_json(&bucket, "index.json");
    let runs = stored_json(&bucket, index["runsKey"].as_str().unwrap());
    let card = &runs["runs"][0];
    assert_eq!(card["id"], RUN);
    assert_eq!(card["links"]["code"], RUN_CODE);
    let document = stored_json(&bucket, card["documentKey"].as_str().unwrap());
    assert_eq!(document["links"]["code"], RUN_CODE);
    assert_eq!(document["record"]["links"]["code"], RUN_CODE);
    assert_eq!(
        document["proofMedia"][0]["key"],
        format!("media/runs/{RUN}/proof/title.png")
    );
    assert_eq!(
        document["showcaseMedia"][0]["key"],
        format!("media/runs/{RUN}/showcase/clip.mp4")
    );
}

#[tokio::test]
async fn a_run_s_media_is_copied_once_and_a_miss_is_asked_again() {
    let bucket = Shared::default();
    let copied = "copiedrun-0000000000";
    let missing = "missingrun-000000000";
    bucket
        .lock()
        .unwrap()
        .media
        .insert(copied.to_string(), media_answer(copied));
    let (_dir, publisher, db) = publisher(&bucket).await;
    seed_published(&db, copied, "2026-06-17T21:40:00Z").await;
    seed_published(&db, missing, "2026-06-17T21:41:00Z").await;

    publisher.refresh_now().await.unwrap();
    publisher.refresh_now().await.unwrap();

    let log = bucket.lock().unwrap().log.clone();
    let asks = |id: &str| {
        log.iter()
            .filter(|call| **call == format!("POST {id}"))
            .count()
    };
    assert_eq!(asks(copied), 1, "a stored answer is not asked for again");
    assert_eq!(
        asks(missing),
        2,
        "a run with no answer is asked every refresh"
    );
    let stored = db.public_media().await.unwrap();
    assert!(stored.contains_key(copied));
    assert!(!stored.contains_key(missing));
}

#[tokio::test]
async fn the_prune_deletes_only_stale_superseded_generations() {
    let bucket = Shared::default();
    let stale = "snapshots/2020-01-01T0000Z-deadbeef";
    let recent = format!("snapshots/{}", generation_hours_ago(1));
    for key in [
        format!("{stale}/runs.json"),
        format!("{stale}/cases/pong/v1.0.0.json"),
        format!("{recent}/runs.json"),
        "snapshots/legacy-layout/runs.json".to_string(),
        "documents/runs/old/0123456789abcdef.json".to_string(),
        "media/runs/old/proof/title.png".to_string(),
        "files/cases/pong/v1.0.0/workspace/0123-a.txt".to_string(),
        "codes/oldcode1".to_string(),
    ] {
        seed(&bucket, &key, "{}");
    }
    let (_dir, publisher, db) = publisher(&bucket).await;
    seed_published(&db, RUN, "2026-06-17T21:40:00Z").await;

    publisher.refresh_now().await.unwrap();

    let bucket = bucket.lock().unwrap();
    let mut deleted: Vec<&str> = bucket
        .log
        .iter()
        .filter_map(|call| call.strip_prefix("DELETE "))
        .collect();
    deleted.sort_unstable();
    assert_eq!(
        deleted,
        [
            format!("{stale}/cases/pong/v1.0.0.json"),
            format!("{stale}/runs.json"),
        ]
    );
    // The live generation, a generation inside the retention window, an undatable
    // one and everything outside `snapshots/` are left alone.
    let index = &bucket.objects["index.json"];
    let index: serde_json::Value = serde_json::from_slice(&index.bytes).unwrap();
    assert!(
        bucket
            .objects
            .contains_key(index["runsKey"].as_str().unwrap())
    );
    for kept in [
        format!("{recent}/runs.json"),
        "snapshots/legacy-layout/runs.json".to_string(),
        "documents/runs/old/0123456789abcdef.json".to_string(),
        "media/runs/old/proof/title.png".to_string(),
        "files/cases/pong/v1.0.0/workspace/0123-a.txt".to_string(),
        "codes/oldcode1".to_string(),
    ] {
        assert!(bucket.objects.contains_key(&kept), "{kept} was pruned");
    }
}

#[tokio::test]
async fn a_document_the_bucket_holds_is_not_written_again() {
    let bucket = Shared::default();
    let (_dir, publisher, db) = publisher(&bucket).await;
    seed_published(&db, RUN, "2026-06-17T21:40:00Z").await;

    publisher.refresh_now().await.unwrap();
    bucket.lock().unwrap().log.clear();
    publisher.refresh_now().await.unwrap();

    let bucket = bucket.lock().unwrap();
    assert!(
        !bucket
            .log
            .iter()
            .any(|call| call.starts_with("PUT documents/")),
        "{:#?}",
        bucket.log
    );
    assert!(bucket.log.iter().any(|call| call == "PUT index.json"));
}
