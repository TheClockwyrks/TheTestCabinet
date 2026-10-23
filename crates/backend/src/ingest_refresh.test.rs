//! Tests for the checkout refresh call, against a stub sidecar endpoint on an
//! ephemeral port so the real `reqwest` path runs.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use axum::Router;
use axum::http::StatusCode;
use axum::routing::post;

use super::*;

/// Spawn a stub refresh endpoint answering `status` with `body`, and return its
/// URL and how many times it was called.
async fn spawn_endpoint(status: StatusCode, body: &'static str) -> (String, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let app = Router::new().route(
        "/cgi-bin/refresh",
        post({
            let calls = Arc::clone(&calls);
            move || {
                calls.fetch_add(1, Ordering::SeqCst);
                async move { (status, body) }
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{addr}/cgi-bin/refresh"), calls)
}

#[tokio::test]
async fn a_refresh_that_updated_the_suites_carries_no_notice() {
    let (url, calls) = spawn_endpoint(StatusCode::OK, r#"{"suitesUpdated":true}"#).await;
    let outcome = refresh_checkout(&reqwest::Client::new(), &url)
        .await
        .unwrap();
    assert!(outcome.suites_updated);
    assert_eq!(outcome.notice(), None);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_failed_suites_update_is_survived_with_the_notice() {
    let (url, _) = spawn_endpoint(StatusCode::OK, r#"{"suitesUpdated":false}"#).await;
    let outcome = refresh_checkout(&reqwest::Client::new(), &url)
        .await
        .unwrap();
    assert!(!outcome.suites_updated);
    assert_eq!(
        outcome.notice(),
        Some("ingest: test suites update failed; ingesting without them")
    );
}

#[tokio::test]
async fn any_other_refresh_failure_is_an_error_carrying_its_output() {
    let (url, _) = spawn_endpoint(
        StatusCode::INTERNAL_SERVER_ERROR,
        "ingest: refreshing /state/checkout\nfatal: couldn't find remote ref staging\n",
    )
    .await;
    let error = refresh_checkout(&reqwest::Client::new(), &url)
        .await
        .unwrap_err();
    assert!(matches!(error, RefreshError::Failed { status: 500, .. }));
    let message = error.to_string();
    assert!(
        message.contains("couldn't find remote ref staging"),
        "{message}"
    );
}

#[tokio::test]
async fn a_failure_that_printed_nothing_says_so() {
    let (url, _) = spawn_endpoint(StatusCode::INTERNAL_SERVER_ERROR, "").await;
    let error = refresh_checkout(&reqwest::Client::new(), &url)
        .await
        .unwrap_err();
    assert!(error.to_string().contains("it printed nothing"), "{error}");
}

#[tokio::test]
async fn an_unreadable_answer_is_an_error() {
    let (url, _) = spawn_endpoint(StatusCode::OK, "refreshed").await;
    let error = refresh_checkout(&reqwest::Client::new(), &url)
        .await
        .unwrap_err();
    assert!(matches!(error, RefreshError::Unreadable { .. }), "{error}");
}

#[tokio::test]
async fn an_unreachable_endpoint_is_an_error_naming_it() {
    // Bind and drop a listener so the port is known to refuse connections.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/cgi-bin/refresh", listener.local_addr().unwrap());
    drop(listener);
    let error = refresh_checkout(&reqwest::Client::new(), &url)
        .await
        .unwrap_err();
    assert!(matches!(error, RefreshError::Unreachable { .. }));
    assert!(error.to_string().contains(&url), "{error}");
}

#[tokio::test]
async fn a_refresh_that_outlasts_the_timeout_is_an_error() {
    let app = Router::new().route(
        "/cgi-bin/refresh",
        post(|| async {
            tokio::time::sleep(Duration::from_secs(30)).await;
            (StatusCode::OK, r#"{"suitesUpdated":true}"#)
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let error = refresh_checkout_within(
        &reqwest::Client::new(),
        &format!("http://{addr}/cgi-bin/refresh"),
        Duration::from_millis(200),
    )
    .await
    .unwrap_err();
    assert!(matches!(error, RefreshError::Unreachable { .. }), "{error}");
}

#[test]
fn a_long_output_keeps_its_tail() {
    let output = format!("{}fatal: the end", "x".repeat(5000));
    let excerpt = excerpt(&output);
    assert!(excerpt.ends_with("fatal: the end"));
    assert!(excerpt.chars().count() <= EXCERPT_CHARS + 1);
}
