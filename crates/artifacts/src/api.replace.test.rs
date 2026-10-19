//! Tests for replacing a stored tree through the routes: a read while a second
//! upload of the same run is in flight sees the old tree, an upload that is
//! refused or fails leaves the old tree serving, and the listing reports when the
//! current tree was uploaded.

use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use bytes::Bytes;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use tower::ServiceExt;

use super::tests::{
    GOOD_JOB_ID, GOOD_JOB_TOKEN, SERVICE_TOKEN, app, app_with_limit, app_with_service_token,
    list_request, spawn_stub, tarball,
};
use crate::auth::LOCAL_IDENTITY_HEADER;
use crate::store::MemoryStore;

/// An upload of `body` for `run_id` with the good job token.
fn upload_request(run_id: &str, body: Body) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(format!("/runs/{run_id}/artifacts"))
        .header("authorization", format!("Bearer {GOOD_JOB_TOKEN}"))
        .header("x-tcab-job-id", GOOD_JOB_ID)
        .body(body)
        .unwrap()
}

/// `GET uri` as a reader, answering the status and the body.
async fn read(app: &Router, uri: &str) -> (StatusCode, Vec<u8>) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(uri)
                .header(LOCAL_IDENTITY_HEADER, "dev@local")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (status, body.to_vec())
}

/// The distinct generations run `id` holds objects under.
fn generations(objects: &MemoryStore, id: &str) -> Vec<String> {
    let mut found: Vec<String> = objects
        .keys()
        .into_iter()
        .filter_map(|key| {
            key.strip_prefix(&format!("{id}/g/"))
                .and_then(|rest| rest.split_once('/'))
                .map(|(generation, _)| generation.to_string())
        })
        .collect();
    found.dedup();
    found
}

/// Wait, a step at a time, until `condition` holds. The bound is a backstop for a
/// broken pipeline, not a timing assumption: each step waits for the condition.
async fn wait_until(mut condition: impl FnMut() -> bool) {
    for _ in 0..10_000 {
        if condition() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
    panic!("the condition never held");
}

#[tokio::test]
async fn a_read_during_a_second_upload_sees_the_old_tree() {
    let stub = spawn_stub().await;
    let (app, _store, objects) = app(&stub).await;
    let old = tarball(&[
        ("implementation/dist/index.html", b"old build"),
        ("implementation/dist/old.js", b"old"),
    ]);
    assert_eq!(
        app.clone()
            .oneshot(upload_request("run-r", Body::from(old)))
            .await
            .unwrap()
            .status(),
        StatusCode::CREATED
    );

    // The second upload's body is held open part-way: its first file is complete
    // and its second has only begun.
    let new = tarball(&[
        ("implementation/dist/index.html", b"new build"),
        ("implementation/dist/new.js", &[9u8; 4096]),
    ]);
    let split = 512 + 512 + 512 + 100; // first header + data block, second header, some data
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Bytes, std::io::Error>>(4);
    let body = Body::from_stream(futures_util::stream::unfold(rx, |mut rx| async move {
        rx.recv().await.map(|chunk| (chunk, rx))
    }));
    let uploading = tokio::spawn({
        let app = app.clone();
        async move { app.oneshot(upload_request("run-r", body)).await.unwrap() }
    });
    tx.send(Ok(Bytes::copy_from_slice(&new[..split])))
        .await
        .unwrap();

    // The new tree's first file has landed under its own generation...
    wait_until(|| {
        let generations = generations(&objects, "run-r");
        generations.len() == 2
            && objects.keys().iter().any(|key| {
                key.ends_with(&format!(
                    "{}/implementation/dist/index.html",
                    generations[1]
                ))
            })
    })
    .await;
    // ...and every read still resolves to the old tree, whole.
    assert_eq!(
        read(&app, "/runs/run-r/build/old.js").await,
        (StatusCode::OK, b"old".to_vec())
    );
    let (status, html) = read(&app, "/runs/run-r/build/").await;
    assert_eq!(status, StatusCode::OK);
    assert!(String::from_utf8(html).unwrap().contains("old build"));
    assert_eq!(
        read(&app, "/runs/run-r/build/new.js").await.0,
        StatusCode::NOT_FOUND
    );

    // The rest arrives; the replace lands whole, and the old generation goes.
    tx.send(Ok(Bytes::copy_from_slice(&new[split..])))
        .await
        .unwrap();
    drop(tx);
    assert_eq!(uploading.await.unwrap().status(), StatusCode::CREATED);
    let (status, html) = read(&app, "/runs/run-r/build/").await;
    assert_eq!(status, StatusCode::OK);
    assert!(String::from_utf8(html).unwrap().contains("new build"));
    assert_eq!(
        read(&app, "/runs/run-r/build/new.js").await.0,
        StatusCode::OK
    );
    assert_eq!(
        read(&app, "/runs/run-r/build/old.js").await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(generations(&objects, "run-r").len(), 1);
}

#[tokio::test]
async fn a_refused_upload_leaves_the_old_tree_serving() {
    let stub = spawn_stub().await;
    let (app, _store, objects) = app_with_limit(&stub, None, 8 * 1024).await;
    assert_eq!(
        app.clone()
            .oneshot(upload_request(
                "run-k",
                Body::from(tarball(&[("events.jsonl", b"{\"old\":true}\n")])),
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::CREATED
    );

    // Over the limit: a 413, refused as the body arrives.
    let big = tarball(&[("events.jsonl", &[b'x'; 64 * 1024])]);
    let response = app
        .clone()
        .oneshot(upload_request("run-k", Body::from(big)))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);

    // Not a tar at all, and an archive holding nothing: a 400 each.
    for body in [vec![0xffu8; 2048], tarball(&[])] {
        let response = app
            .clone()
            .oneshot(upload_request("run-k", Body::from(body)))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    assert_eq!(
        read(&app, "/runs/run-k/events.jsonl").await,
        (StatusCode::OK, b"{\"old\":true}\n".to_vec())
    );
    assert_eq!(
        generations(&objects, "run-k").len(),
        1,
        "the refused uploads left nothing behind: {:?}",
        objects.keys()
    );
}

#[tokio::test]
async fn an_upload_the_store_fails_is_a_500_and_leaves_the_old_tree() {
    let stub = spawn_stub().await;
    let (app, _store, objects) = app(&stub).await;
    assert_eq!(
        app.clone()
            .oneshot(upload_request(
                "run-f",
                Body::from(tarball(&[("events.jsonl", b"old\n")])),
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::CREATED
    );

    objects.fail_writes_ending_with(Some("events.jsonl"));
    let response = app
        .clone()
        .oneshot(upload_request(
            "run-f",
            Body::from(tarball(&[("events.jsonl", b"new\n")])),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    objects.fail_writes_ending_with(None);

    assert_eq!(
        read(&app, "/runs/run-f/events.jsonl").await,
        (StatusCode::OK, b"old\n".to_vec())
    );
}

/// The `modifiedAt` the listing reports for run `id`.
async fn listed_time(app: &Router, id: &str) -> OffsetDateTime {
    let response = app
        .clone()
        .oneshot(list_request(Some(SERVICE_TOKEN)))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let run = body["runs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|run| run["id"] == id)
        .unwrap_or_else(|| panic!("`{id}` is listed"));
    OffsetDateTime::parse(run["modifiedAt"].as_str().unwrap(), &Rfc3339).unwrap()
}

#[tokio::test]
async fn the_listing_reports_when_the_current_tree_was_uploaded() {
    let stub = spawn_stub().await;
    let (app, _store, _objects) = app_with_service_token(&stub, Some(SERVICE_TOKEN)).await;

    let before = OffsetDateTime::now_utc();
    assert_eq!(
        app.clone()
            .oneshot(upload_request(
                "run-t",
                Body::from(tarball(&[("run-record.json", b"{}")])),
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::CREATED
    );
    let after = OffsetDateTime::now_utc();
    let first = listed_time(&app, "run-t").await;
    assert!(
        first >= before && first <= after,
        "{first} is the upload's time, between {before} and {after}"
    );

    // A replace is a new upload, and the listing moves on with it.
    let before = OffsetDateTime::now_utc();
    assert_eq!(
        app.clone()
            .oneshot(upload_request(
                "run-t",
                Body::from(tarball(&[("run-record.json", b"{\"v\":2}")])),
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::CREATED
    );
    let second = listed_time(&app, "run-t").await;
    assert!(second >= before && second >= first);
}
