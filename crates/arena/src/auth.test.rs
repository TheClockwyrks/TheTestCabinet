//! The identity layer in front of the arena's routes, with and without an Access
//! application configured, at the root and under the edge prefix.
//!
//! An unknown tournament's status is the probe route: it answers `404` to a caller
//! the layer admitted without calling the backend, so a `401` can only be the
//! layer's. The Access team's certificates are served by a local stand-in
//! ([`serve_certs`]), so nothing here leaves loopback.

use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;

use super::{AccessMode, LOCAL_IDENTITY_HEADER, is_exempt};
use crate::access::tests::keys::{KEY_A, KEY_B, person_claims, service_claims};
use crate::access::tests::serve_certs;
use crate::access::{ASSERTION_HEADER, AccessVerifier};
use crate::api::{AppState, router};
use crate::executor::MatchExecutor;
use crate::tournaments::TournamentRegistry;

/// The audience tag a verifying arena checks for.
const AUDIENCE: &str = "test-audience-tag";
/// The shared control-plane service token every arena under test holds.
const SERVICE_TOKEN: &str = "service-secret";
/// A route an admitted caller reaches without the arena calling the backend.
const ROUTES: [&str; 2] = ["/tournaments/no-such-job", "/arena/tournaments/no-such-job"];

/// An arena in `access` mode, its backend unreachable.
fn arena(access: AccessMode) -> Router {
    router(AppState {
        backend_url: Arc::new("http://127.0.0.1:0".to_string()),
        backend_service_token: Some(Arc::new(SERVICE_TOKEN.to_string())),
        tournaments: TournamentRegistry::new(),
        executor: Arc::new(MatchExecutor::new(1)),
        access,
    })
}

/// An arena verifying assertions for [`AUDIENCE`] against keys served locally.
async fn verifying_arena() -> Router {
    let (url, _stub) = serve_certs(&[&KEY_A]).await;
    arena(Some(Arc::new(AccessVerifier::with_certs_url(
        url,
        AUDIENCE,
        reqwest::Client::new(),
        Duration::ZERO,
    ))))
}

/// The status of `GET uri` carrying `headers`.
async fn status(app: &Router, uri: &str, headers: &[(&str, &str)]) -> StatusCode {
    let mut request = Request::builder().method("GET").uri(uri);
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    app.clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap()
        .status()
}

/// Assert every route in [`ROUTES`] answers `expected` to `headers`.
async fn assert_routes(app: &Router, headers: &[(&str, &str)], expected: StatusCode) {
    for uri in ROUTES {
        assert_eq!(
            status(app, uri, headers).await,
            expected,
            "{uri} {headers:?}"
        );
    }
}

#[test]
fn only_the_probes_are_exempt() {
    for path in ["/healthz", "/readyz", "/arena/healthz", "/arena/readyz"] {
        assert!(is_exempt(path), "{path}");
    }
    for path in ["/matches", "/arena/matches", "/arenahealthz", "/"] {
        assert!(!is_exempt(path), "{path}");
    }
}

#[tokio::test]
async fn the_probe_answers_without_an_identity_at_the_root_and_under_the_prefix() {
    for app in [arena(None), verifying_arena().await] {
        for uri in ["/healthz", "/arena/healthz"] {
            assert_eq!(status(&app, uri, &[]).await, StatusCode::OK, "{uri}");
        }
    }
}

#[tokio::test]
async fn a_request_with_no_identity_is_refused_on_every_route() {
    for app in [arena(None), verifying_arena().await] {
        assert_routes(&app, &[], StatusCode::UNAUTHORIZED).await;
        for uri in [
            "/matches/controllers?testCase=pacman",
            "/arena/matches/controllers?testCase=pacman",
            "/tournaments/x/events",
            "/no-such-route",
        ] {
            assert_eq!(
                status(&app, uri, &[]).await,
                StatusCode::UNAUTHORIZED,
                "{uri}"
            );
        }
    }
}

#[tokio::test]
async fn a_match_with_no_identity_is_refused_before_it_runs() {
    let response = arena(None)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/arena/matches")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_local_arena_takes_the_local_identity_header_and_ignores_an_assertion() {
    let app = arena(None);
    assert_routes(
        &app,
        &[(LOCAL_IDENTITY_HEADER, "dev@local")],
        StatusCode::NOT_FOUND,
    )
    .await;
    let assertion = KEY_A.sign(&person_claims("ada@example.com", AUDIENCE));
    assert_routes(
        &app,
        &[(ASSERTION_HEADER, &assertion)],
        StatusCode::UNAUTHORIZED,
    )
    .await;
}

#[tokio::test]
async fn the_service_token_is_an_identity_and_any_other_bearer_is_refused() {
    for app in [arena(None), verifying_arena().await] {
        let good = format!("Bearer {SERVICE_TOKEN}");
        assert_routes(&app, &[("authorization", &good)], StatusCode::NOT_FOUND).await;
        // A bearer is resolved before the local identity header.
        assert_routes(
            &app,
            &[
                ("authorization", "Bearer not-the-token"),
                (LOCAL_IDENTITY_HEADER, "dev@local"),
            ],
            StatusCode::UNAUTHORIZED,
        )
        .await;
    }
}

#[tokio::test]
async fn a_verified_assertion_is_an_identity() {
    let app = verifying_arena().await;
    let person = KEY_A.sign(&person_claims("ada@example.com", AUDIENCE));
    assert_routes(&app, &[(ASSERTION_HEADER, &person)], StatusCode::NOT_FOUND).await;
    let service = KEY_A.sign(&service_claims("tcab-automation.access", AUDIENCE));
    assert_routes(&app, &[(ASSERTION_HEADER, &service)], StatusCode::NOT_FOUND).await;
}

#[tokio::test]
async fn a_failed_assertion_is_refused_whatever_else_the_request_carries() {
    let app = verifying_arena().await;
    let token = format!("Bearer {SERVICE_TOKEN}");
    for assertion in [
        KEY_A.sign(&person_claims("ada@example.com", "another-application")),
        KEY_B.sign(&person_claims("ada@example.com", AUDIENCE)),
        "not-a-jwt".to_string(),
    ] {
        assert_routes(
            &app,
            &[(ASSERTION_HEADER, &assertion), ("authorization", &token)],
            StatusCode::UNAUTHORIZED,
        )
        .await;
    }
}

#[tokio::test]
async fn a_verifying_arena_ignores_the_local_identity_header() {
    let app = verifying_arena().await;
    assert_routes(
        &app,
        &[(LOCAL_IDENTITY_HEADER, "dev@local")],
        StatusCode::UNAUTHORIZED,
    )
    .await;
}

#[tokio::test]
async fn unreachable_certificates_are_a_bad_gateway() {
    let app = arena(Some(Arc::new(AccessVerifier::with_certs_url(
        "http://127.0.0.1:0/cdn-cgi/access/certs",
        AUDIENCE,
        reqwest::Client::new(),
        Duration::ZERO,
    ))));
    let assertion = KEY_A.sign(&person_claims("ada@example.com", AUDIENCE));
    assert_routes(
        &app,
        &[(ASSERTION_HEADER, &assertion)],
        StatusCode::BAD_GATEWAY,
    )
    .await;
}
