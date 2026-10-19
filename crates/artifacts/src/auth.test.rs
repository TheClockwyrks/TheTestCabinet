//! The identity layer in front of the artifact service's routes: what each kind
//! of caller may reach, with and without an Access application configured, at the
//! root and under the edge prefix.
//!
//! The Access team's certificates are served by a local stand-in
//! ([`serve_certs`]), and the backend a per-job token is verified against by a
//! stub, so nothing here leaves loopback.

use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use tower::ServiceExt;

use super::{AccessMode, Identity, LOCAL_IDENTITY_HEADER, is_exempt, resolve};
use crate::access::tests::keys::{KEY_A, KEY_B, person_claims, service_claims};
use crate::access::tests::serve_certs;
use crate::access::{ASSERTION_HEADER, AccessVerifier};
use crate::api::{AppState, router};
use crate::store::testing::seed;
use crate::store::{ArtifactStore, MemoryStore};

/// The audience tag a verifying service checks for.
const AUDIENCE: &str = "test-audience-tag";
/// The shared control-plane service token every service under test holds.
const SERVICE_TOKEN: &str = "service-secret";
/// The per-job token the stub backend accepts for [`JOB_ID`].
const JOB_TOKEN: &str = "job-token";
/// The job the stub backend accepts [`JOB_TOKEN`] for.
const JOB_ID: &str = "job-1";
/// The run whose build every service under test holds.
const RUN: &str = "run-1";

/// A stub backend answering `POST /jobs/{id}/verify-token`: `204` for
/// [`JOB_TOKEN`] on [`JOB_ID`], `401` otherwise.
async fn stub_backend() -> String {
    let app = Router::new().route(
        "/jobs/{id}/verify-token",
        post(
            |axum::extract::Path(id): axum::extract::Path<String>,
             body: Json<serde_json::Value>| async move {
                if id == JOB_ID && body.0.get("token").and_then(|t| t.as_str()) == Some(JOB_TOKEN) {
                    StatusCode::NO_CONTENT
                } else {
                    StatusCode::UNAUTHORIZED
                }
            },
        ),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

/// An artifact service in `access` mode over a store holding [`RUN`]'s build.
async fn service(access: AccessMode) -> (MemoryStore, Router) {
    let objects = MemoryStore::new();
    let store = ArtifactStore::new(Arc::new(objects.clone()));
    seed(
        &store,
        RUN,
        &[
            (
                "implementation/dist/index.html",
                b"<html><head><script src=\"/app.js\"></script></head><body>hi</body></html>",
            ),
            ("implementation/dist/app.js", b"console.log(1)"),
        ],
    )
    .await;
    let state = AppState {
        store: Arc::new(store),
        upload_limit: crate::api::MAX_UPLOAD_BYTES,
        backend_url: Arc::new(stub_backend().await),
        http: reqwest::Client::new(),
        service_token: Some(Arc::new(SERVICE_TOKEN.to_string())),
        access,
        public: Arc::new(crate::public::MemoryPublicStore::new()),
        transcoder: Arc::new(crate::publish::testing::FakeTranscoder::working()),
    };
    (objects, router(state))
}

/// A service with no Access application: the local overlay's shape.
async fn local_service() -> (MemoryStore, Router) {
    service(None).await
}

/// A service verifying assertions for [`AUDIENCE`] against keys served locally.
async fn verifying_service() -> (MemoryStore, Router) {
    let (url, _stub) = serve_certs(&[&KEY_A]).await;
    service(Some(Arc::new(AccessVerifier::with_certs_url(
        url,
        AUDIENCE,
        reqwest::Client::new(),
        Duration::ZERO,
    ))))
    .await
}

/// `GET uri` carrying `headers`, answering the status and the body as text.
async fn get(app: &Router, uri: &str, headers: &[(&str, &str)]) -> (StatusCode, String) {
    let mut request = Request::builder().method("GET").uri(uri);
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (status, String::from_utf8_lossy(&body).into_owned())
}

/// `Authorization: Bearer <token>`.
fn bearer(token: &str) -> String {
    format!("Bearer {token}")
}

/// A one-file run tree to upload.
fn tarball() -> Vec<u8> {
    let contents = b"<html></html>";
    let mut builder = tar::Builder::new(Vec::new());
    let mut header = tar::Header::new_gnu();
    header.set_size(contents.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    builder
        .append_data(&mut header, "implementation/dist/index.html", &contents[..])
        .unwrap();
    builder.into_inner().unwrap()
}

#[test]
fn only_the_probes_are_exempt() {
    for path in [
        "/healthz",
        "/readyz",
        "/artifacts/healthz",
        "/artifacts/readyz",
    ] {
        assert!(is_exempt(path), "{path}");
    }
    for path in [
        "/runs",
        "/runs/run-1/build/",
        "/artifacts/runs/run-1/build/",
        "/artifactshealthz",
        "/healthz/more",
        "/",
    ] {
        assert!(!is_exempt(path), "{path}");
    }
}

#[tokio::test]
async fn the_probe_answers_without_an_identity_at_the_root_and_under_the_prefix() {
    for (_dir, app) in [local_service().await, verifying_service().await] {
        for uri in ["/healthz", "/artifacts/healthz"] {
            assert_eq!(get(&app, uri, &[]).await.0, StatusCode::OK, "{uri}");
        }
    }
}

#[tokio::test]
async fn a_request_with_no_identity_is_refused_on_every_route() {
    for (_dir, app) in [local_service().await, verifying_service().await] {
        for uri in [
            "/runs/run-1/build/",
            "/artifacts/runs/run-1/build/",
            "/runs/run-1/archive.tar.gz",
            "/runs/run-1/events.jsonl",
            "/runs/run-1/tree.tar",
            "/runs",
            "/artifacts/runs",
            "/no-such-route",
        ] {
            assert_eq!(
                get(&app, uri, &[]).await.0,
                StatusCode::UNAUTHORIZED,
                "{uri}"
            );
        }
    }
}

#[tokio::test]
async fn the_local_identity_header_reads_at_the_root_and_under_the_prefix() {
    let (_dir, app) = local_service().await;
    let identity = [(LOCAL_IDENTITY_HEADER, "dev@local")];

    let (status, html) = get(&app, "/runs/run-1/build/", &identity).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        html.contains("<base href=\"/runs/run-1/build/\">"),
        "{html}"
    );

    // Through the edge the build is relocated under the prefix, so its assets are
    // requested back through the edge rather than from the console at the root.
    let (status, html) = get(&app, "/artifacts/runs/run-1/build/", &identity).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        html.contains("<base href=\"/artifacts/runs/run-1/build/\">"),
        "{html}"
    );
    let (status, js) = get(&app, "/artifacts/runs/run-1/build/app.js", &identity).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(js, "console.log(1)");
}

#[tokio::test]
async fn a_local_service_ignores_an_assertion() {
    let (_dir, app) = local_service().await;
    let assertion = KEY_A.sign(&person_claims("ada@example.com", AUDIENCE));
    assert_eq!(
        get(
            &app,
            "/runs/run-1/build/",
            &[(ASSERTION_HEADER, &assertion)]
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn a_bearer_that_is_not_the_service_token_reads_nothing() {
    // A per-job token is only good on the route that checks it, and a bearer is
    // resolved before the local identity header.
    for (_dir, app) in [local_service().await, verifying_service().await] {
        let token = bearer(JOB_TOKEN);
        assert_eq!(
            get(&app, "/runs/run-1/build/", &[("authorization", &token)])
                .await
                .0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            get(
                &app,
                "/runs/run-1/build/",
                &[
                    ("authorization", &token),
                    (LOCAL_IDENTITY_HEADER, "dev@local")
                ],
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
    }
}

#[tokio::test]
async fn the_service_token_reads_and_manages_trees() {
    for (_dir, app) in [local_service().await, verifying_service().await] {
        let token = bearer(SERVICE_TOKEN);
        let auth = [("authorization", token.as_str())];
        assert_eq!(
            get(&app, "/runs/run-1/build/", &auth).await.0,
            StatusCode::OK
        );
        assert_eq!(get(&app, "/runs", &auth).await.0, StatusCode::OK);
        assert_eq!(get(&app, "/artifacts/runs", &auth).await.0, StatusCode::OK);
    }
}

#[tokio::test]
async fn a_verified_person_reads_but_manages_nothing() {
    let (_dir, app) = verifying_service().await;
    let assertion = KEY_A.sign(&person_claims("ada@example.com", AUDIENCE));
    let headers = [(ASSERTION_HEADER, assertion.as_str())];

    let (status, html) = get(&app, "/artifacts/runs/run-1/build/", &headers).await;
    assert_eq!(status, StatusCode::OK);
    assert!(html.contains("/artifacts/runs/run-1/build/"), "{html}");
    assert_eq!(
        get(&app, "/runs/run-1/build/", &headers).await.0,
        StatusCode::OK
    );

    // The tree listing and the source-tree pull take their in-cluster tokens.
    assert_eq!(
        get(&app, "/artifacts/runs", &headers).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        get(&app, "/artifacts/runs/run-1/tree.tar", &headers)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn a_service_tokens_assertion_reads() {
    let (_dir, app) = verifying_service().await;
    let assertion = KEY_A.sign(&service_claims("tcab-automation.access", AUDIENCE));
    assert_eq!(
        get(
            &app,
            "/artifacts/runs/run-1/build/",
            &[(ASSERTION_HEADER, &assertion)]
        )
        .await
        .0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn a_failed_assertion_is_refused_whatever_else_the_request_carries() {
    let (_dir, app) = verifying_service().await;
    let token = bearer(SERVICE_TOKEN);
    for assertion in [
        KEY_A.sign(&person_claims("ada@example.com", "another-application")),
        KEY_B.sign(&person_claims("ada@example.com", AUDIENCE)),
        "not-a-jwt".to_string(),
    ] {
        assert_eq!(
            get(
                &app,
                "/runs/run-1/build/",
                &[(ASSERTION_HEADER, &assertion), ("authorization", &token)],
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
    }
}

#[tokio::test]
async fn a_verifying_service_ignores_the_local_identity_header() {
    let (_dir, app) = verifying_service().await;
    assert_eq!(
        get(
            &app,
            "/runs/run-1/build/",
            &[(LOCAL_IDENTITY_HEADER, "dev@local")]
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn a_driver_uploads_to_a_verifying_service_with_its_job_token() {
    let (_dir, app) = verifying_service().await;
    let upload = |token: &str| {
        Request::builder()
            .method("POST")
            .uri("/runs/run-2/artifacts")
            .header("authorization", bearer(token))
            .header("x-tcab-job-id", JOB_ID)
            .body(Body::from(tarball()))
            .unwrap()
    };
    assert_eq!(
        app.clone()
            .oneshot(upload(JOB_TOKEN))
            .await
            .unwrap()
            .status(),
        StatusCode::CREATED
    );
    assert_eq!(
        app.clone()
            .oneshot(upload("not-the-token"))
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn unreachable_certificates_are_a_bad_gateway() {
    let verifier = AccessVerifier::with_certs_url(
        "http://127.0.0.1:0/cdn-cgi/access/certs",
        AUDIENCE,
        reqwest::Client::new(),
        Duration::ZERO,
    );
    let (_dir, app) = service(Some(Arc::new(verifier))).await;
    let assertion = KEY_A.sign(&person_claims("ada@example.com", AUDIENCE));
    assert_eq!(
        get(
            &app,
            "/runs/run-1/build/",
            &[(ASSERTION_HEADER, &assertion)]
        )
        .await
        .0,
        StatusCode::BAD_GATEWAY
    );
}

#[tokio::test]
async fn resolution_names_each_kind_of_caller() {
    let (url, _stub) = serve_certs(&[&KEY_A]).await;
    let verifying: AccessMode = Some(Arc::new(AccessVerifier::with_certs_url(
        url,
        AUDIENCE,
        reqwest::Client::new(),
        Duration::ZERO,
    )));
    let headers = |pairs: &[(&str, &str)]| {
        let mut map = axum::http::HeaderMap::new();
        for (name, value) in pairs {
            map.insert(
                axum::http::HeaderName::from_bytes(name.as_bytes()).unwrap(),
                value.parse().unwrap(),
            );
        }
        map
    };
    let person = KEY_A.sign(&person_claims("ada@example.com", AUDIENCE));
    let service = KEY_A.sign(&service_claims("automation", AUDIENCE));
    let svc = bearer(SERVICE_TOKEN);
    let job = bearer(JOB_TOKEN);

    // Each case: the access mode, the request's headers, and the caller expected.
    type Case<'a> = (&'a AccessMode, Vec<(&'a str, &'a str)>, Identity);
    let cases: Vec<Case> = vec![
        (
            &verifying,
            vec![(ASSERTION_HEADER, &person)],
            Identity::Person("ada@example.com".into()),
        ),
        (
            &verifying,
            vec![(ASSERTION_HEADER, &service)],
            Identity::ServiceAssertion("automation".into()),
        ),
        (
            &verifying,
            vec![("authorization", &svc)],
            Identity::ServiceToken,
        ),
        (&verifying, vec![("authorization", &job)], Identity::Token),
        (
            &None,
            vec![(LOCAL_IDENTITY_HEADER, "dev@local")],
            Identity::Person("dev@local".into()),
        ),
        (&None, vec![("authorization", &svc)], Identity::ServiceToken),
    ];
    for (access, pairs, expected) in cases {
        assert_eq!(
            resolve(access, Some(SERVICE_TOKEN), &headers(&pairs))
                .await
                .unwrap(),
            expected,
            "{pairs:?}"
        );
    }

    // With no service token configured, the service token is just another bearer.
    assert_eq!(
        resolve(&None, None, &headers(&[("authorization", &svc)]))
            .await
            .unwrap(),
        Identity::Token
    );
}

/// `method uri` with `body` and `headers`, answering the status.
async fn send(
    app: &Router,
    method: &str,
    uri: &str,
    headers: &[(&str, &str)],
    body: &'static [u8],
) -> StatusCode {
    let mut request = Request::builder().method(method).uri(uri);
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    app.clone()
        .oneshot(request.body(Body::from(body)).unwrap())
        .await
        .unwrap()
        .status()
}

#[tokio::test]
async fn a_public_write_takes_a_services_identity_and_refuses_a_person() {
    let (_dir, app) = verifying_service().await;
    let token = bearer(SERVICE_TOKEN);
    let service = KEY_A.sign(&service_claims("tcab-cli.access", AUDIENCE));
    let person = KEY_A.sign(&person_claims("ada@example.com", AUDIENCE));
    let job = bearer(JOB_TOKEN);
    /// A request's path, its identity headers, and the status it is answered.
    type Case<'a> = (&'a str, &'a [(&'a str, &'a str)], StatusCode);
    let cases: [Case; 5] = [
        // The backend, in-cluster.
        (
            "/public/index.json",
            &[("authorization", &token)],
            StatusCode::CREATED,
        ),
        // The CLI, through the edge with an Access service token.
        (
            "/artifacts/public/media/cases/x.png",
            &[(ASSERTION_HEADER, &service)],
            StatusCode::CREATED,
        ),
        // A person, however verified, writes nothing public.
        (
            "/artifacts/public/index.json",
            &[(ASSERTION_HEADER, &person)],
            StatusCode::FORBIDDEN,
        ),
        (
            "/public/index.json",
            &[("authorization", &job)],
            StatusCode::UNAUTHORIZED,
        ),
        ("/public/index.json", &[], StatusCode::UNAUTHORIZED),
    ];
    for (uri, identity, expected) in cases {
        let mut headers = identity.to_vec();
        headers.push(("content-type", "application/json"));
        assert_eq!(
            send(&app, "PUT", uri, &headers, b"{}").await,
            expected,
            "{uri} {identity:?}"
        );
    }

    // With no Access application, the local identity header is a person's.
    let (_dir, app) = local_service().await;
    let headers = [
        (LOCAL_IDENTITY_HEADER, "dev@local"),
        ("content-type", "application/json"),
    ];
    assert_eq!(
        send(&app, "PUT", "/public/index.json", &headers, b"{}").await,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn publishing_media_takes_the_service_token_alone() {
    let (_dir, app) = verifying_service().await;
    let service = KEY_A.sign(&service_claims("tcab-cli.access", AUDIENCE));
    let person = KEY_A.sign(&person_claims("ada@example.com", AUDIENCE));
    for headers in [
        vec![(ASSERTION_HEADER, service.as_str())],
        vec![(ASSERTION_HEADER, person.as_str())],
        vec![],
    ] {
        assert_eq!(
            send(&app, "POST", "/runs/run-1/publish-media", &headers, b"").await,
            StatusCode::UNAUTHORIZED,
            "{headers:?}"
        );
    }
    // The run holds a build but no record, so nothing says what it publishes.
    let token = bearer(SERVICE_TOKEN);
    assert_eq!(
        send(
            &app,
            "POST",
            "/runs/run-1/publish-media",
            &[("authorization", &token)],
            b""
        )
        .await,
        StatusCode::NOT_FOUND
    );
}

#[test]
fn a_public_write_is_authorized_by_identity() {
    use super::authorize_public_write;
    assert!(authorize_public_write(Some(&Identity::ServiceToken)).is_ok());
    assert!(authorize_public_write(Some(&Identity::ServiceAssertion("cli".to_string()))).is_ok());
    assert_eq!(
        authorize_public_write(Some(&Identity::Person("ada@example.com".to_string())))
            .unwrap_err()
            .status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        authorize_public_write(Some(&Identity::Token))
            .unwrap_err()
            .status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        authorize_public_write(None).unwrap_err().status,
        StatusCode::UNAUTHORIZED
    );
}
