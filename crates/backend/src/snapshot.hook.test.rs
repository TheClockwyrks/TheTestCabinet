//! The site deploy hook, against a stand-in host.

use axum::Router;
use axum::http::StatusCode;
use axum::routing::post;

use super::*;

/// Spawn a stand-in deploy hook answering `status`, and return its URL.
async fn spawn_hook(status: StatusCode) -> String {
    let app = Router::new().route("/hook", post(move || async move { status }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}/hook")
}

#[tokio::test]
async fn a_hook_that_answers_success_has_fired() {
    let url = spawn_hook(StatusCode::OK).await;
    fire_deploy_hook(&url, &reqwest::Client::new())
        .await
        .expect("a 200 is a fired hook");
}

#[tokio::test]
async fn a_hook_that_refuses_is_an_error_naming_its_status() {
    let url = spawn_hook(StatusCode::TOO_MANY_REQUESTS).await;
    let err = fire_deploy_hook(&url, &reqwest::Client::new())
        .await
        .expect_err("a 429 did not queue a build");
    assert!(err.to_string().contains("429"), "{err}");
}

#[tokio::test]
async fn a_hook_that_cannot_be_reached_is_an_error() {
    // A port nothing listens on: bound, read, and released.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/hook", listener.local_addr().unwrap());
    drop(listener);
    let err = fire_deploy_hook(&url, &reqwest::Client::new())
        .await
        .expect_err("nothing answered");
    assert!(err.to_string().contains("firing deploy hook"), "{err}");
}
