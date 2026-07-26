//! End-to-end tests for the auth service's HTTP surface, driving the real router
//! over an in-memory store: register → login → verify, plus the rejection paths.

use super::*;
use axum::body::Body;
use axum::http::Request;
use serde_json::json;
use tower::ServiceExt;

/// Build the router over a fresh in-memory account store.
async fn app() -> Router {
    let db = Db::connect_in_memory().await.expect("in-memory store");
    router(AppState { db: Arc::new(db) })
}

/// POST `body` as JSON to `path`, optionally with a bearer token, returning the
/// status and the parsed JSON body (`Null` when empty).
async fn post(
    app: &Router,
    path: &str,
    body: serde_json::Value,
    bearer: Option<&str>,
) -> (StatusCode, serde_json::Value) {
    let mut builder = Request::builder()
        .method("POST")
        .uri(path)
        .header("content-type", "application/json");
    if let Some(token) = bearer {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    let request = builder.body(Body::from(body.to_string())).unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json = if bytes.is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null)
    };
    (status, json)
}

#[tokio::test]
async fn register_then_login_then_verify() {
    let app = app().await;

    let (status, body) = post(
        &app,
        "/auth/register",
        json!({ "username": "ada", "password": "correcthorse", "displayName": "Ada L." }),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let register_token = body["token"].as_str().unwrap().to_string();
    assert_eq!(body["account"]["username"], "ada");
    assert_eq!(body["account"]["displayName"], "Ada L.");
    let account_id = body["account"]["id"].as_str().unwrap().to_string();

    // The registration token verifies to the same account.
    let (status, account) = post(&app, "/auth/verify", json!({}), Some(&register_token)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(account["id"], account_id);

    // Logging in mints a *different* token that resolves to the same account.
    let (status, body) = post(
        &app,
        "/auth/login",
        json!({ "username": "ada", "password": "correcthorse" }),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let login_token = body["token"].as_str().unwrap().to_string();
    assert_ne!(login_token, register_token);
    let (status, account) = post(&app, "/auth/verify", json!({}), Some(&login_token)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(account["id"], account_id);
}

#[tokio::test]
async fn register_rejects_a_duplicate_username() {
    let app = app().await;
    let body = json!({ "username": "ada", "password": "correcthorse", "displayName": "Ada" });
    let (status, _) = post(&app, "/auth/register", body.clone(), None).await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, err) = post(&app, "/auth/register", body, None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(err["error"]["code"], "conflict");
}

#[tokio::test]
async fn register_rejects_a_short_password() {
    let app = app().await;
    let (status, err) = post(
        &app,
        "/auth/register",
        json!({ "username": "ada", "password": "short", "displayName": "Ada" }),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(err["error"]["code"], "bad_request");
}

#[tokio::test]
async fn login_with_a_wrong_password_is_unauthorized() {
    let app = app().await;
    post(
        &app,
        "/auth/register",
        json!({ "username": "ada", "password": "correcthorse", "displayName": "Ada" }),
        None,
    )
    .await;
    let (status, err) = post(
        &app,
        "/auth/login",
        json!({ "username": "ada", "password": "wrongpassword" }),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(err["error"]["code"], "unauthorized");
}

#[tokio::test]
async fn verify_rejects_an_unknown_token() {
    let app = app().await;
    let (status, _) = post(&app, "/auth/verify", json!({}), Some("deadbeef")).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

/// A minimal valid 1×1 PNG (the smallest bytes that read as `image/png`).
const TINY_PNG: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
    0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
    0x42, 0x60, 0x82,
];

/// Send a raw-body request (method/path/content-type/body/bearer) and return the
/// status, the response's `Content-Type`, and the raw body bytes. Used to exercise
/// the profile-picture endpoints, whose bodies are image bytes, not JSON.
async fn raw(
    app: &Router,
    method: &str,
    path: &str,
    content_type: Option<&str>,
    body: Vec<u8>,
    bearer: Option<&str>,
) -> (StatusCode, Option<String>, Vec<u8>) {
    let mut builder = Request::builder().method(method).uri(path);
    if let Some(ct) = content_type {
        builder = builder.header("content-type", ct);
    }
    if let Some(token) = bearer {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    let request = builder.body(Body::from(body)).unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap()
        .to_vec();
    (status, content_type, bytes)
}

#[tokio::test]
async fn profile_picture_set_serve_reflect_and_clear() {
    let app = app().await;
    let (_, body) = post(
        &app,
        "/auth/register",
        json!({ "username": "ada", "password": "correcthorse", "displayName": "Ada" }),
        None,
    )
    .await;
    let token = body["token"].as_str().unwrap().to_string();
    let id = body["account"]["id"].as_str().unwrap().to_string();
    // A fresh account has no picture.
    assert!(body["account"]["pictureUpdatedAt"].is_null());

    // No picture yet → 404.
    let (status, _, _) = raw(
        &app,
        "GET",
        &format!("/auth/users/{id}/picture"),
        None,
        vec![],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Set a PNG; the returned account now carries a `pictureUpdatedAt`.
    let (status, _, out) = raw(
        &app,
        "PUT",
        "/auth/profile/picture",
        Some("image/png"),
        TINY_PNG.to_vec(),
        Some(&token),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let account: serde_json::Value = serde_json::from_slice(&out).unwrap();
    assert!(account["pictureUpdatedAt"].is_string());

    // Verify reflects the picture flag too (it flows onto the wire `Account`).
    let (_, verified) = post(&app, "/auth/verify", json!({}), Some(&token)).await;
    assert!(verified["pictureUpdatedAt"].is_string());

    // The picture is served back with its content type and exact bytes — the read
    // is open (no bearer needed).
    let (status, content_type, bytes) = raw(
        &app,
        "GET",
        &format!("/auth/users/{id}/picture"),
        None,
        vec![],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(content_type.as_deref(), Some("image/png"));
    assert_eq!(bytes, TINY_PNG);

    // A non-image upload is rejected.
    let (status, _, _) = raw(
        &app,
        "PUT",
        "/auth/profile/picture",
        Some("text/plain"),
        b"not an image".to_vec(),
        Some(&token),
    )
    .await;
    assert_eq!(status, StatusCode::UNSUPPORTED_MEDIA_TYPE);

    // Clearing it drops the flag and the served bytes.
    let (status, _, out) = raw(
        &app,
        "DELETE",
        "/auth/profile/picture",
        None,
        vec![],
        Some(&token),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let account: serde_json::Value = serde_json::from_slice(&out).unwrap();
    assert!(account["pictureUpdatedAt"].is_null());
    let (status, _, _) = raw(
        &app,
        "GET",
        &format!("/auth/users/{id}/picture"),
        None,
        vec![],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn profile_picture_requires_auth() {
    let app = app().await;
    // No bearer token → the set/clear mutations are unauthorized.
    let (status, _, _) = raw(
        &app,
        "PUT",
        "/auth/profile/picture",
        Some("image/png"),
        TINY_PNG.to_vec(),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn logout_revokes_the_token() {
    let app = app().await;
    let (_, body) = post(
        &app,
        "/auth/register",
        json!({ "username": "ada", "password": "correcthorse", "displayName": "Ada" }),
        None,
    )
    .await;
    let token = body["token"].as_str().unwrap().to_string();

    let (status, _) = post(&app, "/auth/logout", json!({}), Some(&token)).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // The token no longer verifies.
    let (status, _) = post(&app, "/auth/verify", json!({}), Some(&token)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}
