//! The router's own wiring, driven through the assembled [`router`] rather than
//! through a handler call: which artifact URL a delete reaches the data plane on,
//! which URL `GET /config` advertises, and which route a static path resolves to.
//!
//! Everything here needs the real `Router`, because that is the subject. A handler
//! called directly answers nothing about route precedence, and a `Config` built
//! field by field answers nothing about which environment variable a field came
//! from — both are exactly where the defects these tests exist for live.
//!
//! Each test owns the process environment (nextest runs one process per test) and
//! resolves its configuration through [`Config::from_env`], so the variable a
//! deployment sets is the variable under test.

use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::extract::Path as AxumPath;
use axum::http::{HeaderMap, Request, StatusCode};
use axum::routing::{delete, post};
use tower::ServiceExt;

use super::*;
use crate::db::tests::{links, new_job, record};

/// The shared control-plane service token, as a deployment sets it.
const SERVICE_TOKEN: &str = "service-secret";
/// The bearer an operator's console presents on a mutating call.
const USER_TOKEN: &str = "user-token";

/// What a stub artifact service recorded, so a test can assert on which one the
/// backend actually called.
#[derive(Default)]
struct ArtifactStub {
    /// Run ids this stub received a `DELETE /runs/{id}/artifacts` for.
    deleted: Mutex<Vec<String>>,
}

/// Stand a stub artifact service on an ephemeral port and return its base URL
/// beside what it records.
async fn spawn_artifacts() -> (String, Arc<ArtifactStub>) {
    let stub = Arc::new(ArtifactStub::default());
    let app = Router::new().route(
        "/runs/{id}/artifacts",
        delete({
            let stub = Arc::clone(&stub);
            move |AxumPath(id): AxumPath<String>, headers: HeaderMap| {
                let stub = Arc::clone(&stub);
                async move {
                    let presented = headers
                        .get(axum::http::header::AUTHORIZATION)
                        .and_then(|value| value.to_str().ok())
                        .map(str::to_string);
                    assert_eq!(
                        presented.as_deref(),
                        Some(format!("Bearer {SERVICE_TOKEN}").as_str()),
                        "the prune reached the service without the shared token"
                    );
                    stub.deleted.lock().unwrap().push(id);
                    StatusCode::NO_CONTENT
                }
            }
        }),
    );
    (serve(app).await, stub)
}

/// Stand a stub auth service that resolves [`USER_TOKEN`] to an account, so the
/// token-gated routes are reachable.
async fn spawn_auth() -> String {
    let app = Router::new().route(
        "/auth/verify",
        post(|headers: HeaderMap| async move {
            let authorized = headers
                .get(axum::http::header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok())
                == Some(&format!("Bearer {USER_TOKEN}"));
            if !authorized {
                return (
                    StatusCode::UNAUTHORIZED,
                    axum::Json(serde_json::Value::Null),
                );
            }
            (
                StatusCode::OK,
                axum::Json(serde_json::json!({
                    "id": "account-1",
                    "username": "operator",
                    "displayName": "Operator",
                })),
            )
        }),
    );
    serve(app).await
}

/// Serve `app` on an ephemeral port and return its base URL.
async fn serve(app: Router) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

/// A backend assembled the way `build` assembles one, over an in-memory database
/// and the stub services above.
struct Harness {
    router: Router,
    db: Arc<Db>,
    /// The artifact service the backend is configured to call.
    internal: Arc<ArtifactStub>,
    /// The artifact service the backend advertises to consoles, which nothing the
    /// backend does may call.
    public: Arc<ArtifactStub>,
    /// The advertised base URL, for the `GET /config` assertion.
    public_url: String,
    /// Kept alive for the test's duration: dropping it removes the store.
    _store: tempfile::TempDir,
}

/// Build the harness: two stub artifact services, a stub auth service, the
/// environment a deployment sets, and the router `build` would assemble from it.
async fn harness() -> Harness {
    harness_with_prices(test_cabinet_core::OpenRouterPrices::new()).await
}

/// [`harness`], with the OpenRouter price source pointed at `prices`.
async fn harness_with_prices(prices: test_cabinet_core::OpenRouterPrices) -> Harness {
    let (internal_url, internal) = spawn_artifacts().await;
    let (public_url, public) = spawn_artifacts().await;
    let auth_url = spawn_auth().await;
    let dir = tempfile::tempdir().unwrap();

    // SAFETY: nextest runs each test in its own process, so this environment is
    // this test's alone. The repo's gate is nextest for exactly this reason.
    unsafe {
        std::env::set_var("TCAB_BACKEND_CHECKOUT", dir.path());
        std::env::set_var("TCAB_BACKEND_STORE", dir.path().join("store"));
        std::env::set_var("TCAB_BACKEND_AUTH_URL", &auth_url);
        std::env::set_var("TCAB_BACKEND_SERVICE_TOKEN", SERVICE_TOKEN);
        std::env::set_var("TCAB_ARTIFACTS_URL", &internal_url);
        std::env::set_var("TCAB_ARTIFACTS_PUBLIC_URL", &public_url);
    }
    let config = Arc::new(Config::from_env().unwrap());
    assert_eq!(
        config.artifacts_internal_url.as_deref(),
        Some(internal_url.as_str()),
        "TCAB_ARTIFACTS_URL is the backend's own address for the service"
    );
    assert_eq!(
        config.artifacts_public_url.as_deref(),
        Some(public_url.as_str()),
        "TCAB_ARTIFACTS_PUBLIC_URL is what the console is told"
    );

    let db = Arc::new(Db::connect_in_memory().await.unwrap());
    let store = DefinitionStore::open(&config.store).unwrap();
    let auth = Arc::new(test_cabinet_core::AccountsClient::new(
        config.auth_url.clone(),
    ));
    let publisher = Publisher::new(
        Arc::clone(&db),
        store.clone(),
        None,
        None,
        config.artifacts_internal_url.clone(),
        Arc::clone(&auth),
        crate::publisher::PublisherTiming {
            coalesce: config.coalesce,
            snapshot_retention: config.snapshot_retention,
        },
    );
    let state = AppState {
        db: Arc::clone(&db),
        store,
        ready: Readiness::new(true),
        publisher,
        auth,
        relay: Relay::new(),
        publish_relay: PublishRelay::new(),
        config,
        http: reqwest::Client::new(),
        prices,
        gg_docs: crate::gg_docs::GgDocIndex::new(),
    };
    Harness {
        router: router(state),
        db,
        internal,
        public,
        public_url,
        _store: dir,
    }
}

/// Issue one request against the router and return its status and body.
async fn call(router: &Router, request: Request<Body>) -> (StatusCode, serde_json::Value) {
    let response = router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
        .await
        .unwrap();
    let body = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    (status, body)
}

#[tokio::test]
async fn deleting_a_run_prunes_its_tree_through_the_in_cluster_url() {
    // The wiring the split exists for. Both artifact services are real and reachable
    // here, so a backend that pruned through the advertised URL would still answer
    // 200 — what separates the two is which stub recorded the DELETE.
    let harness = harness().await;
    harness
        .db
        .push(&record("r1"), &links(), None, None)
        .await
        .unwrap();

    let request = Request::builder()
        .method("DELETE")
        .uri("/runs/r1")
        .header(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {USER_TOKEN}"),
        )
        .body(Body::empty())
        .unwrap();
    let (status, body) = call(&harness.router, request).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["deleted"], serde_json::Value::Bool(true));

    assert_eq!(
        *harness.internal.deleted.lock().unwrap(),
        vec!["r1".to_string()],
        "the prune did not go through TCAB_ARTIFACTS_URL"
    );
    assert!(
        harness.public.deleted.lock().unwrap().is_empty(),
        "the prune went through the address the console is given"
    );
}

#[tokio::test]
async fn the_advertised_artifact_url_is_the_one_the_console_reads() {
    // The other half of the split: `GET /config` carries the browser-facing address,
    // never the in-cluster one, which resolves to nothing outside the cluster.
    let harness = harness().await;
    let request = Request::builder()
        .uri("/config")
        .body(Body::empty())
        .unwrap();
    let (status, body) = call(&harness.router, request).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["artifactsUrl"], harness.public_url);
}

#[tokio::test]
async fn the_unreadable_listing_outranks_the_run_id_route() {
    // `/runs/unreadable` and `/runs/{id}` are both registered. A registration that
    // resolved the static path as a run id would answer 404 for the one listing an
    // unreadable run is reachable from, which no other test would notice.
    let harness = harness().await;
    harness
        .db
        .push(&record("r1"), &links(), None, None)
        .await
        .unwrap();

    let request = Request::builder()
        .uri("/runs/unreadable")
        .body(Body::empty())
        .unwrap();
    let (status, body) = call(&harness.router, request).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 0);
    assert!(body["runs"].is_array());

    // The dynamic route still resolves everything else, so the static path won
    // without shadowing the run lookup.
    let request = Request::builder()
        .uri("/runs/r1")
        .body(Body::empty())
        .unwrap();
    let (status, body) = call(&harness.router, request).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["record"]["id"], "r1");
}

#[tokio::test]
async fn the_active_run_list_reports_when_a_started_run_started() {
    // The one place the whole chain is observable: the state transition stamps the
    // anchor, `job_summary` lifts it off the stored row, and the wire spells it
    // `startedAt`. Each link is trivial alone, and a console that ticks a live duration
    // shows nothing at all if any one of them drops the field.
    let harness = harness().await;
    harness
        .db
        .enqueue_job(new_job("j1", "2026-09-06T00:00:00Z"))
        .await
        .unwrap();

    let request = Request::builder()
        .uri("/jobs/active")
        .body(Body::empty())
        .unwrap();
    let (status, body) = call(&harness.router, request).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body[0]["runId"], "j1");
    assert_eq!(body[0]["state"], "queued");
    // A queued run has not started, and the absence is an omitted field rather than a
    // null — the console renders a dash for it. Asked by key, because a JSON null and
    // a missing key both read as null through the index.
    assert!(
        body[0].get("startedAt").is_none(),
        "a queued run must omit the field entirely: {body}",
    );

    harness
        .db
        .set_job_state("j1", "starting", "2026-09-06T00:02:00Z", None, None)
        .await
        .unwrap()
        .expect("the job exists");

    let request = Request::builder()
        .uri("/jobs/active")
        .body(Body::empty())
        .unwrap();
    let (status, body) = call(&harness.router, request).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body[0]["state"], "starting");
    assert_eq!(body[0]["startedAt"], "2026-09-06T00:02:00Z", "{body}");
}

/// An authenticated request against the router with a JSON body.
fn user_request(method: &str, uri: &str, body: serde_json::Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {USER_TOKEN}"),
        )
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

#[tokio::test]
async fn an_unbounded_account_buffer_is_stored_as_itself_and_inherited_by_a_plan() {
    // The whole chain a reviewer exercises when they switch "No limit" on in their
    // settings: the PUT stores the shape, the GET reads it back as a choice, and a
    // plan with no override of its own reports it as the target in force.
    let harness = harness().await;
    let unbounded = serde_json::json!({ "kind": "unbounded" });

    let (status, body) = call(
        &harness.router,
        user_request(
            "PUT",
            "/coverage-settings",
            serde_json::json!({ "bufferTarget": unbounded }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["bufferTarget"], unbounded);
    assert_eq!(body["isDefault"], serde_json::Value::Bool(false));

    let (status, body) = call(
        &harness.router,
        user_request("GET", "/coverage-settings", serde_json::Value::Null),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["bufferTarget"], unbounded);
    assert_eq!(body["isDefault"], serde_json::Value::Bool(false));

    let (status, body) = call(
        &harness.router,
        user_request(
            "POST",
            "/coverage-plans",
            serde_json::json!({
                "name": "everything",
                "runsPerCell": 2,
                "comboGroupIds": [],
                "caseGroupIds": [],
                "combos": [{ "harness": "claude", "model": "anthropic/claude-opus-4.8" }],
                "cases": [{ "slug": "pong", "version": "v1.0.0", "variant": "base" }],
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let plan_id = body["id"]
        .as_str()
        .expect("the created plan's id")
        .to_string();

    let (status, body) = call(
        &harness.router,
        user_request(
            "GET",
            &format!("/coverage-plans/{plan_id}/coverage"),
            serde_json::Value::Null,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["bufferTarget"], unbounded);

    // A bound written afterwards replaces it, clamped to the ceiling, and a bound of
    // zero is kept as the bound it is.
    let (status, body) = call(
        &harness.router,
        user_request(
            "PUT",
            "/coverage-settings",
            serde_json::json!({ "bufferTarget": { "kind": "bounded", "runs": 9999 } }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["bufferTarget"],
        serde_json::json!({ "kind": "bounded", "runs": 500 })
    );
    let (status, body) = call(
        &harness.router,
        user_request(
            "PUT",
            "/coverage-settings",
            serde_json::json!({ "bufferTarget": { "kind": "bounded", "runs": 0 } }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["bufferTarget"],
        serde_json::json!({ "kind": "bounded", "runs": 0 })
    );
}

// ---------------------------------------------------------------------------
// A model's provider policy and candidate list
// ---------------------------------------------------------------------------

/// Serve `endpoints` as every OpenRouter read's body on a loopback port, and return a price
/// source pointed at it. Only the per-model endpoints read parses it; the catalog reads a save
/// makes fail to parse, which they treat as best-effort.
async fn endpoints_listing(endpoints: serde_json::Value) -> test_cabinet_core::OpenRouterPrices {
    let body = serde_json::json!({ "data": { "name": "Z.AI: GLM 5.3", "endpoints": endpoints } });
    let app = Router::new().fallback(move || {
        let body = body.clone();
        async move { axum::Json(body) }
    });
    test_cabinet_core::OpenRouterPrices::with_endpoint(format!("{}/models", serve(app).await))
}

/// One fp8 endpoint priced per million tokens, with a cache-read price and tool support.
fn listed(provider: &str, input: f64, output: f64) -> serde_json::Value {
    serde_json::json!({
        "provider_name": provider,
        "context_length": 1_048_576,
        "quantization": "fp8",
        "pricing": {
            "prompt": format!("{}", input / 1_000_000.0),
            "completion": format!("{}", output / 1_000_000.0),
            "input_cache_read": format!("{}", input / 10.0 / 1_000_000.0),
        },
        "supported_parameters": ["tools", "tool_choice"],
    })
}

/// A curated model config body carrying `policy`'s fields.
fn model_body(policy: serde_json::Value) -> serde_json::Value {
    let mut body = serde_json::json!({
        "slug": "glm",
        "name": "GLM 5.3",
        "provider": "Z.AI",
        "aliases": [{ "slug": "z-ai/glm-5.3", "harnessFamily": "openrouter" }],
        "openrouterSlug": "z-ai/glm-5.3",
        "description": null,
        "logoSvg": null,
        "providerLogoUrl": null,
    });
    for (key, value) in policy.as_object().unwrap() {
        body[key] = value.clone();
    }
    body
}

#[tokio::test]
async fn a_models_provider_policy_round_trips_through_the_api() {
    let harness = harness_with_prices(endpoints_listing(serde_json::json!([])).await).await;
    let request = user_request(
        "POST",
        "/models",
        model_body(serde_json::json!({
            "providerPin": " Z.AI ",
            "nativeQuantization": " FP8 ",
            "maxInputPrice": 0.6,
            "maxOutputPrice": 2.2,
            "bannedProviders": [" Cheapo ", "", "cheapo"],
            "unknownQuantizationProviders": ["Vague", "  "],
        })),
    );
    let (status, body) = call(&harness.router, request).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["providerPin"], "Z.AI");
    assert_eq!(body["providerPinSetByHand"], true);
    assert_eq!(body["nativeQuantization"], "fp8");
    assert_eq!(body["maxInputPrice"], 0.6);
    assert_eq!(body["maxOutputPrice"], 2.2);
    assert_eq!(body["bannedProviders"], serde_json::json!(["Cheapo"]));
    assert_eq!(
        body["unknownQuantizationProviders"],
        serde_json::json!(["Vague"])
    );

    // The catalog read carries the same fields, and an update clearing them clears them.
    let request = Request::builder()
        .uri("/models")
        .body(Body::empty())
        .unwrap();
    let (status, catalog) = call(&harness.router, request).await;
    assert_eq!(status, StatusCode::OK, "{catalog}");
    assert_eq!(
        catalog["models"][0]["bannedProviders"],
        body["bannedProviders"]
    );

    let request = user_request("PUT", "/models/glm", model_body(serde_json::json!({})));
    let (status, body) = call(&harness.router, request).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["nativeQuantization"], serde_json::Value::Null);
    assert_eq!(body["maxInputPrice"], serde_json::Value::Null);
    assert_eq!(body["bannedProviders"], serde_json::json!([]));
    assert_eq!(body["unknownQuantizationProviders"], serde_json::json!([]));
}

#[tokio::test]
async fn a_models_provider_policy_is_checked_on_write() {
    let harness = harness_with_prices(endpoints_listing(serde_json::json!([])).await).await;
    for (policy, reason) in [
        (
            serde_json::json!({ "maxInputPrice": 0.6 }),
            "half a ceiling",
        ),
        (
            serde_json::json!({ "maxOutputPrice": 2.2 }),
            "the other half",
        ),
        (
            serde_json::json!({ "maxInputPrice": 0.0, "maxOutputPrice": 2.2 }),
            "a zero price",
        ),
        (
            serde_json::json!({ "maxInputPrice": -1.0, "maxOutputPrice": 2.2 }),
            "a negative price",
        ),
        (
            serde_json::json!({ "nativeQuantization": "fp9" }),
            "an unknown level",
        ),
        (
            serde_json::json!({ "nativeQuantization": "unknown" }),
            "`unknown` as the native level",
        ),
    ] {
        let request = user_request("POST", "/models", model_body(policy));
        let (status, body) = call(&harness.router, request).await;
        assert_eq!(
            status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{reason} was accepted: {body}"
        );
    }
    // Nothing was written.
    assert!(harness.db.get_model_config("glm").await.unwrap().is_none());
}

#[tokio::test]
async fn the_candidates_read_reports_the_list_the_next_enqueue_would_build() {
    let prices = endpoints_listing(serde_json::json!([
        listed("Baidu", 0.56, 1.76),
        listed("Z.AI", 0.6, 2.2),
        listed("Pricey", 0.9, 3.0),
    ]))
    .await;
    let harness = harness_with_prices(prices).await;
    let request = user_request("POST", "/models", model_body(serde_json::json!({})));
    let (status, body) = call(&harness.router, request).await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // A third-party reach, so it is signed-in only.
    let request = Request::builder()
        .uri("/models/glm/candidates")
        .body(Body::empty())
        .unwrap();
    let (status, _) = call(&harness.router, request).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let request = user_request("GET", "/models/glm/candidates", serde_json::Value::Null);
    let (status, body) = call(&harness.router, request).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["modelId"], "z-ai/glm-5.3");
    assert_eq!(body["nativeQuantization"], "fp8");
    assert_eq!(body["refusal"], serde_json::Value::Null);
    let candidates = body["candidates"].as_array().unwrap();
    assert_eq!(candidates.len(), 2, "{body}");
    assert_eq!(candidates[0]["provider"], "Z.AI");
    assert_eq!(candidates[0]["developer"], true);
    assert_eq!(candidates[0]["quantization"], "fp8");
    assert!((candidates[0]["inputPrice"].as_f64().unwrap() - 0.6).abs() < 1e-9);
    assert!((candidates[0]["outputPrice"].as_f64().unwrap() - 2.2).abs() < 1e-9);
    assert!((candidates[0]["cacheReadPrice"].as_f64().unwrap() - 0.06).abs() < 1e-9);
    assert_eq!(candidates[0]["faultRate"], serde_json::Value::Null);
    assert_eq!(candidates[1]["provider"], "Baidu");
    assert_eq!(candidates[1]["developer"], false);

    // Banning both leaves no candidate, and the read says why.
    let request = user_request(
        "PUT",
        "/models/glm",
        model_body(serde_json::json!({ "bannedProviders": ["z-ai", "Baidu"] })),
    );
    let (status, body) = call(&harness.router, request).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let request = user_request("GET", "/models/glm/candidates", serde_json::Value::Null);
    let (status, body) = call(&harness.router, request).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["candidates"], serde_json::json!([]));
    assert_eq!(
        body["refusal"],
        test_cabinet_core::pricing::CandidateRefusal::AllBanned.to_string()
    );
}
