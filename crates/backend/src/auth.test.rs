//! The identity check and the per-route gates, driven through the assembled router:
//! which credential resolves to which identity in each mode, which kind each route
//! admits, the routes that need no identity, and the `/api` prefix.

use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;

use super::{AccessMode, is_exempt};
use crate::access::AccessVerifier;
use crate::access::tests::keys::{KEY_A, KEY_B, person_claims, service_claims};
use crate::access::tests::serve_certs;
use crate::api::AppState;
use crate::db::tests::{links, new_job, record};

/// The shared service token the backend under test is configured with.
const SERVICE_TOKEN: &str = "service-secret";
/// The audience tag the verifying backend checks for.
const AUDIENCE: &str = "tcab-test-audience";

/// A backend over an in-memory database, in the given identity mode, holding one
/// pushed run `r1` and one queued job `j1` whose token is `token-j1`.
async fn backend(access: AccessMode) -> (tempfile::TempDir, AppState, Router) {
    let dir = tempfile::tempdir().unwrap();
    // SAFETY: nextest runs each test in its own process, so this environment is this
    // test's alone.
    unsafe {
        std::env::set_var("TCAB_BACKEND_CHECKOUT", dir.path());
        std::env::set_var("TCAB_BACKEND_STORE", dir.path().join("store"));
        std::env::set_var("TCAB_BACKEND_SERVICE_TOKEN", SERVICE_TOKEN);
    }
    let config = Arc::new(crate::config::Config::from_env().unwrap());
    let db = Arc::new(crate::db::Db::connect_in_memory().await.unwrap());
    let store = crate::store::DefinitionStore::open(&config.store).unwrap();
    let publisher = crate::publisher::Publisher::new(
        Arc::clone(&db),
        store.clone(),
        None,
        None,
        None,
        None,
        crate::publisher::PublisherTiming {
            coalesce: config.coalesce,
            snapshot_retention: config.snapshot_retention,
        },
    );
    let state = AppState {
        db: Arc::clone(&db),
        store,
        ready: crate::readiness::Readiness::new(true),
        publisher,
        access,
        relay: crate::relay::Relay::new(),
        publish_relay: crate::publish_relay::PublishRelay::new(),
        config,
        http: reqwest::Client::new(),
        prices: test_cabinet_core::OpenRouterPrices::with_endpoint("http://127.0.0.1:0/models"),
        gg_docs: crate::gg_docs::GgDocIndex::new(),
    };
    db.push(&record("r1"), &links(), None, None).await.unwrap();
    db.enqueue_job(new_job("j1", "2026-10-18T00:00:00Z"))
        .await
        .unwrap();
    let router = crate::api::router(state.clone());
    (dir, state, router)
}

/// A backend that verifies assertions against a served key set holding key A.
async fn verifying_backend() -> (tempfile::TempDir, AppState, Router) {
    let (url, _stub) = serve_certs(&[&KEY_A]).await;
    backend(Some(Arc::new(AccessVerifier::with_certs_url(
        url,
        AUDIENCE,
        reqwest::Client::new(),
        Duration::ZERO,
    ))))
    .await
}

/// A backend with no Access application, the local overlay's shape.
async fn local_backend() -> (tempfile::TempDir, AppState, Router) {
    backend(None).await
}

/// One credential a request can carry.
#[derive(Clone, Copy)]
enum Cred<'a> {
    None,
    Assertion(&'a str),
    LocalEmail(&'a str),
    Bearer(&'a str),
}

/// Issue `method path` with `creds` and return the status and body.
async fn call(
    router: &Router,
    method: &str,
    path: &str,
    creds: &[Cred<'_>],
    body: Option<serde_json::Value>,
) -> (StatusCode, serde_json::Value) {
    let mut request = Request::builder().method(method).uri(path);
    for cred in creds {
        request = match *cred {
            Cred::None => request,
            Cred::Assertion(jwt) => request.header("Cf-Access-Jwt-Assertion", jwt),
            Cred::LocalEmail(email) => request.header("Cf-Access-Authenticated-User-Email", email),
            Cred::Bearer(token) => request.header("Authorization", format!("Bearer {token}")),
        };
    }
    let request = match body {
        Some(body) => request
            .header("Content-Type", "application/json")
            .body(Body::from(body.to_string())),
        None => request.body(Body::empty()),
    }
    .unwrap();
    let response = router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1 << 22)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
    )
}

/// A review body the legacy run `r1` accepts.
fn review_body() -> serde_json::Value {
    serde_json::json!({
        "ratings": [{ "domain": "gameplay", "rating": "great" }],
        "writeup": "Plays well.",
        "checklist": [{ "id": "ball-spin", "status": "pass" }],
    })
}

/// The reviewer identities stored on run `r1`.
async fn reviewers(state: &AppState) -> Vec<String> {
    state
        .db
        .get_run("r1")
        .await
        .unwrap()
        .unwrap()
        .reviews
        .into_iter()
        .map(|review| review.reviewer)
        .collect()
}

#[test]
fn the_probes_and_token_verification_need_no_identity() {
    for path in [
        "/healthz",
        "/readyz",
        "/api/healthz",
        "/api/readyz",
        "/jobs/j1/verify-token",
        "/api/jobs/j1/verify-token",
        "/publish-jobs/p1/verify-token",
    ] {
        assert!(is_exempt(path), "{path} is exempt");
    }
    for path in [
        "/runs",
        "/api/runs",
        "/jobs/next",
        "/jobs//verify-token",
        "/jobs/a/b/verify-token",
        "/apihealthz",
        "/healthz/extra",
    ] {
        assert!(!is_exempt(path), "{path} needs an identity");
    }
}

// ---- Local mode -----------------------------------------------------------

#[tokio::test]
async fn a_request_with_no_identity_is_refused() {
    let (_dir, _state, router) = local_backend().await;
    for path in ["/runs", "/api/runs", "/test-cases", "/no-such-route"] {
        let (status, body) = call(&router, "GET", path, &[Cred::None], None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{path}: {body}");
        assert_eq!(body["error"]["code"], "unauthorized");
    }
}

#[tokio::test]
async fn the_probes_answer_without_an_identity() {
    let (_dir, _state, router) = local_backend().await;
    for path in ["/healthz", "/readyz", "/api/healthz", "/api/readyz"] {
        let (status, body) = call(&router, "GET", path, &[Cred::None], None).await;
        assert_eq!(status, StatusCode::OK, "{path}: {body}");
    }
}

#[tokio::test]
async fn token_verification_is_reached_without_an_identity() {
    // The artifacts service forwards a driver's token in the body; the route checks
    // that token itself.
    let (_dir, _state, router) = local_backend().await;
    let (status, _) = call(
        &router,
        "POST",
        "/jobs/j1/verify-token",
        &[Cred::None],
        Some(serde_json::json!({ "token": "token-j1" })),
    )
    .await;
    assert!(
        status.is_success(),
        "the job's own token verifies: {status}"
    );
    let (status, _) = call(
        &router,
        "POST",
        "/jobs/j1/verify-token",
        &[Cred::None],
        Some(serde_json::json!({ "token": "token-other" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn the_local_identity_header_names_a_person_and_every_route_answers_under_api() {
    let (_dir, _state, router) = local_backend().await;
    for path in ["/runs", "/api/runs", "/api/runs/r1"] {
        let (status, body) =
            call(&router, "GET", path, &[Cred::LocalEmail("dev@local")], None).await;
        assert_eq!(status, StatusCode::OK, "{path}: {body}");
    }
}

#[tokio::test]
async fn a_local_review_is_attributed_to_the_local_identity() {
    let (_dir, state, router) = local_backend().await;
    let (status, body) = call(
        &router,
        "POST",
        "/api/runs/r1/reviews",
        &[Cred::LocalEmail("dev@local")],
        Some(review_body()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(reviewers(&state).await, vec!["dev@local".to_string()]);

    // Read back through the API: the run carries the review under the local
    // identity, and that identity's own review list holds it.
    let (status, run) = call(
        &router,
        "GET",
        "/api/runs/r1",
        &[Cred::LocalEmail("dev@local")],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{run}");
    let stored: Vec<&str> = run["reviews"]
        .as_array()
        .expect("the run lists its reviews")
        .iter()
        .filter_map(|review| review["reviewer"].as_str())
        .collect();
    assert_eq!(stored, vec!["dev@local"], "{run}");

    let (status, mine) = call(
        &router,
        "GET",
        "/api/account/reviews",
        &[Cred::LocalEmail("dev@local")],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{mine}");
    assert_eq!(mine["total"], 1, "{mine}");
    assert_eq!(
        mine["reviews"][0]["review"]["reviewer"], "dev@local",
        "{mine}"
    );

    // Another local identity sees the review on the run but not as its own.
    let (status, theirs) = call(
        &router,
        "GET",
        "/api/account/reviews",
        &[Cred::LocalEmail("someone@local")],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{theirs}");
    assert_eq!(theirs["total"], 0, "{theirs}");
}

#[tokio::test]
async fn a_local_backend_ignores_an_assertion() {
    // With no Access application there is nothing to verify an assertion against, so
    // it identifies no one.
    let (_dir, _state, router) = local_backend().await;
    let jwt = KEY_A.sign(&person_claims("ada@example.com", AUDIENCE));
    let (status, _) = call(&router, "GET", "/runs", &[Cred::Assertion(&jwt)], None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_bearer_token_takes_precedence_over_the_local_identity_header() {
    // A local `tcab ingest` presents the service token beside the local identity it
    // sends on every request; the service token is what the call is made under.
    let (_dir, _state, router) = local_backend().await;
    let (status, body) = call(
        &router,
        "POST",
        "/snapshot/refresh",
        &[Cred::LocalEmail("dev@local"), Cred::Bearer(SERVICE_TOKEN)],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

#[tokio::test]
async fn an_unknown_bearer_token_is_refused() {
    let (_dir, _state, router) = local_backend().await;
    let (status, body) = call(&router, "GET", "/runs", &[Cred::Bearer("forged")], None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "{body}");
    // Even beside a local identity: a credential that fails is a failure.
    let (status, _) = call(
        &router,
        "GET",
        "/runs",
        &[Cred::LocalEmail("dev@local"), Cred::Bearer("forged")],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn automation_routes_refuse_a_person_and_take_the_service_token() {
    let (_dir, _state, router) = local_backend().await;
    for (method, path) in [
        ("POST", "/snapshot/refresh"),
        ("POST", "/ingest"),
        ("POST", "/tournaments"),
        ("POST", "/tournaments/t1/matches/m1/replay.json"),
        ("PUT", "/suites/s/versions/v1.0.0/reference-builds/none"),
    ] {
        let (status, body) = call(
            &router,
            method,
            path,
            &[Cred::LocalEmail("dev@local")],
            None,
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{method} {path}: {body}");
        assert_eq!(body["error"]["code"], "forbidden");
    }
    let (status, body) = call(
        &router,
        "POST",
        "/api/snapshot/refresh",
        &[Cred::Bearer(SERVICE_TOKEN)],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

#[tokio::test]
async fn person_routes_refuse_backend_tokens() {
    let (_dir, _state, router) = local_backend().await;
    for token in [SERVICE_TOKEN, "token-j1"] {
        for (method, path) in [
            ("POST", "/runs/r1/publish"),
            ("DELETE", "/runs/r1"),
            ("POST", "/jobs/cancel-waiting"),
            ("GET", "/coverage-plans"),
            ("GET", "/account/reviews"),
            ("POST", "/runs/r1/reviews"),
        ] {
            let (status, body) = call(&router, method, path, &[Cred::Bearer(token)], None).await;
            assert_eq!(status, StatusCode::FORBIDDEN, "{method} {path}: {body}");
        }
    }
}

#[tokio::test]
async fn the_dispatchers_routes_take_only_the_service_token() {
    let (_dir, _state, router) = local_backend().await;
    let (status, _) = call(
        &router,
        "POST",
        "/jobs/next",
        &[Cred::LocalEmail("dev@local")],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = call(
        &router,
        "POST",
        "/jobs/next",
        &[Cred::Bearer("token-j1")],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    // The publish queue is empty, so a claim answers without dispatching anything.
    let (status, body) = call(
        &router,
        "POST",
        "/publish-jobs/next",
        &[Cred::Bearer(SERVICE_TOKEN)],
        None,
    )
    .await;
    assert!(status.is_success(), "{status}: {body}");
    let (status, _) = call(
        &router,
        "POST",
        "/publish-jobs/next",
        &[Cred::LocalEmail("dev@local")],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn a_job_token_reads_and_uploads_run_media_but_takes_nothing_else() {
    let (_dir, _state, router) = local_backend().await;
    let (status, body) = call(
        &router,
        "GET",
        "/runs/r1",
        &[Cred::Bearer("token-j1")],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "a job token reads: {body}");

    let upload = |creds: Vec<Cred<'static>>| {
        let router = router.clone();
        async move {
            let mut request = Request::builder()
                .method("POST")
                .uri("/runs/r1/proof/clip.webm");
            for cred in creds {
                if let Cred::Bearer(token) = cred {
                    request = request.header("Authorization", format!("Bearer {token}"));
                }
                if let Cred::LocalEmail(email) = cred {
                    request = request.header("Cf-Access-Authenticated-User-Email", email);
                }
            }
            router
                .oneshot(request.body(Body::from(vec![1u8, 2, 3])).unwrap())
                .await
                .unwrap()
                .status()
        }
    };
    assert!(upload(vec![Cred::Bearer("token-j1")]).await.is_success());
    assert_eq!(
        upload(vec![Cred::LocalEmail("dev@local")]).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        upload(vec![Cred::Bearer(SERVICE_TOKEN)]).await,
        StatusCode::FORBIDDEN
    );

    let (status, _) = call(
        &router,
        "POST",
        "/snapshot/refresh",
        &[Cred::Bearer("token-j1")],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn a_publish_job_token_reads_but_takes_no_route_for_a_person_or_the_service() {
    let (_dir, state, router) = local_backend().await;
    state
        .db
        .enqueue_publish_job(crate::db::NewPublishJob {
            id: "p1".to_string(),
            run_id: "r1".to_string(),
            job_token: "token-p1".to_string(),
            created_at: "2026-10-18T00:00:00Z".to_string(),
        })
        .await
        .unwrap();

    let (status, body) = call(
        &router,
        "GET",
        "/runs/r1",
        &[Cred::Bearer("token-p1")],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "a publish-job token reads: {body}");

    let (status, _) = call(
        &router,
        "GET",
        "/runs/r1",
        &[Cred::Bearer("token-p1-not")],
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "a near-miss is no identity"
    );

    let (status, _) = call(
        &router,
        "POST",
        "/snapshot/refresh",
        &[Cred::Bearer("token-p1")],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn a_job_token_reads_on_a_verifying_backend_too() {
    // In-cluster callers never cross the edge, so they carry no assertion: their
    // token is their identity whatever mode the backend runs in.
    let (_dir, _state, router) = verifying_backend().await;
    let (status, body) = call(
        &router,
        "GET",
        "/runs/r1",
        &[Cred::Bearer("token-j1")],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "a job token reads: {body}");
}

// ---- Verifying mode -------------------------------------------------------

#[tokio::test]
async fn a_verified_persons_review_is_attributed_to_their_email() {
    let (_dir, state, router) = verifying_backend().await;
    let jwt = KEY_A.sign(&person_claims("ada@example.com", AUDIENCE));
    let (status, body) = call(
        &router,
        "POST",
        "/api/runs/r1/reviews",
        &[Cred::Assertion(&jwt)],
        Some(review_body()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(reviewers(&state).await[0], "ada@example.com");

    let (status, _) = call(
        &router,
        "POST",
        "/api/snapshot/refresh",
        &[Cred::Assertion(&jwt)],
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "a person cannot drive automation"
    );
}

#[tokio::test]
async fn a_service_tokens_assertion_drives_automation_and_reviews_under_its_name() {
    let (_dir, state, router) = verifying_backend().await;
    let jwt = KEY_A.sign(&service_claims("tcab-automation-staging", AUDIENCE));
    let (status, body) = call(
        &router,
        "POST",
        "/api/snapshot/refresh",
        &[Cred::Assertion(&jwt)],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let (status, body) = call(
        &router,
        "POST",
        "/api/runs/r1/reviews",
        &[Cred::Assertion(&jwt)],
        Some(review_body()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(reviewers(&state).await[0], "tcab-automation-staging");

    let (status, _) = call(
        &router,
        "POST",
        "/api/runs/r1/publish",
        &[Cred::Assertion(&jwt)],
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "publishing takes a person's assertion"
    );
}

#[tokio::test]
async fn a_failed_assertion_is_refused_whatever_else_the_request_carries() {
    let (_dir, _state, router) = verifying_backend().await;
    let wrong_audience = KEY_A.sign(&person_claims("ada@example.com", "another-app"));
    let unpublished_key = KEY_B.sign(&person_claims("ada@example.com", AUDIENCE));
    for jwt in [
        wrong_audience.as_str(),
        unpublished_key.as_str(),
        "not.a.jwt",
    ] {
        let (status, body) = call(
            &router,
            "GET",
            "/api/runs",
            &[Cred::Assertion(jwt), Cred::Bearer(SERVICE_TOKEN)],
            None,
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{body}");
    }
}

#[tokio::test]
async fn a_verifying_backend_ignores_the_local_identity_header() {
    let (_dir, _state, router) = verifying_backend().await;
    let (status, _) = call(
        &router,
        "GET",
        "/runs",
        &[Cred::LocalEmail("ada@example.com")],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn in_cluster_callers_reach_a_verifying_backend_with_their_tokens() {
    let (_dir, _state, router) = verifying_backend().await;
    let (status, _) = call(
        &router,
        "POST",
        "/snapshot/refresh",
        &[Cred::Bearer(SERVICE_TOKEN)],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = call(
        &router,
        "GET",
        "/runs/r1",
        &[Cred::Bearer("token-j1")],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = call(&router, "GET", "/runs", &[Cred::None], None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn unreachable_certificates_are_a_bad_gateway() {
    let (_dir, _state, router) = backend(Some(Arc::new(AccessVerifier::with_certs_url(
        "http://127.0.0.1:0/cdn-cgi/access/certs",
        AUDIENCE,
        reqwest::Client::new(),
        Duration::ZERO,
    ))))
    .await;
    let jwt = KEY_A.sign(&person_claims("ada@example.com", AUDIENCE));
    let (status, body) = call(&router, "GET", "/runs", &[Cred::Assertion(&jwt)], None).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY, "{body}");
    assert_eq!(body["error"]["code"], "auth_unavailable");
}
