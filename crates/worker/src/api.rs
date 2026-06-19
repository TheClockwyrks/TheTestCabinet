//! The worker's Axum HTTP surface: shared state and router wiring.
//!
//! The worker exposes the core run lifecycle over HTTP (`worker/overview.md`): it
//! accepts a run request, drives it through the core, streams the live harness
//! events back, produces the same run record a local run would, and can publish
//! on the same terms. There is **no app-level auth** — like the backend it sits
//! on a private network and trusts every caller that can reach it.
//!
//! Handlers are grouped by area into the submodules below; this module owns the
//! shared [`AppState`] and assembles the router.

use std::sync::Arc;
use std::time::Instant;

use axum::Router;
use axum::extract::{MatchedPath, Request, State};
use axum::middleware::Next;
use axum::response::Response;
use axum::routing::{get, post};
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

use crate::config::Config;
use crate::jobs::JobRegistry;
use crate::metrics::Metrics;
use crate::notify::WorkerNotifier;

mod notify;
mod publish_api;
mod runs;

/// Shared application state handed to every handler.
#[derive(Clone)]
pub struct AppState {
    /// The resolved configuration (backend URL, staging/output dirs).
    pub config: Arc<Config>,
    /// The registry of submitted run jobs.
    pub jobs: JobRegistry,
    /// The worker-wide notification fan-out (run completions), streamed to the
    /// console over `GET /notifications`.
    pub notifier: WorkerNotifier,
    /// The worker's OTel metric instruments.
    pub metrics: Metrics,
}

/// The contract version this worker reports from `/healthz`. The worker tracks
/// the same v0.2.0 milestone as the backend; the crate `version` is the
/// workspace placeholder (`0.0.0`) and is independent of this.
const CONTRACT_VERSION: &str = "0.2.0";

/// Build the Axum router with every worker endpoint mounted.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(health))
        // Submit a run (returns a job id), list produced runs, look one up by id.
        .route("/runs", post(runs::submit).get(runs::list_produced))
        // The runs still executing, for the console's in-progress list (survives a
        // reload, unlike the session-only client state). A static path, so it
        // outranks the `/runs/{job}` dynamic route regardless of order.
        .route("/runs/active", get(runs::list_active))
        .route("/runs/{job}", get(runs::status))
        // The worker-wide notification stream (run completions) as Server-Sent
        // Events, so the console can alert on any run finishing without polling.
        .route("/notifications", get(notify::notifications))
        // The live harness-event stream for a job, as NDJSON.
        .route("/runs/{job}/events", get(runs::events))
        // A finished run's recorded streams, served from disk as NDJSON: the
        // normalized event log and the raw harness output. Keyed by run-record
        // id, these back the run-detail Events tab after the live job is gone.
        .route("/runs/{id}/events.jsonl", get(runs::events_file))
        .route("/runs/{id}/raw.jsonl", get(runs::raw_file))
        // A produced run's proof-of-implementation media (`<proof-id>.<ext>`),
        // served from its collected implementation so a reviewer can see the
        // submitted evidence before the run is published.
        .route("/runs/{id}/proof/{file}", get(runs::proof_file))
        // Serve a produced run's playable build (the static output collected
        // beside its implementation) so a reviewer can play it before it is
        // published. `{id}` is the run-record id the produced-run list reports.
        // Both the bare and trailing-slash roots serve the build's index.html;
        // the wildcard serves the assets it references (the wildcard does not
        // match an empty tail, so the trailing-slash root is its own route).
        .route("/runs/{id}/build", get(runs::build_root))
        .route("/runs/{id}/build/", get(runs::build_root))
        .route("/runs/{id}/build/{*path}", get(runs::build_path))
        // Publish a finished run: release code, deploy the build, submit to the
        // backend — the same terms a local `tcab publish` uses.
        .route("/publish", post(publish_api::publish))
        // Record request count + latency for every handled request. Runs inside
        // the trace span (added below) so its timing covers the same work the
        // span does.
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            record_request_metrics,
        ))
        // Graft the caller's W3C trace context (if any) onto the request span so
        // server spans continue the caller's trace. A no-op when no propagator is
        // installed (the fmt-only fallback) or the request carries no context.
        .layer(axum::middleware::from_fn(accept_inbound_context))
        // Emit a span per request/response. Naming the span by the matched route
        // (e.g. `GET /runs/{job}`) keeps cardinality bounded — the concrete id is
        // a span field, not part of the span name.
        .layer(
            TraceLayer::new_for_http().make_span_with(|request: &Request<_>| {
                let method = request.method();
                let route = request
                    .extensions()
                    .get::<MatchedPath>()
                    .map(MatchedPath::as_str)
                    .unwrap_or_else(|| request.uri().path());
                tracing::info_span!("http.request", %method, route, otel.name = %format!("{method} {route}"))
            }),
        )
        // The browser UIs reach the worker from a different localhost origin, so
        // requests — including the best-effort `/healthz` identity probe — are
        // cross-origin. The worker shares the backend's no-auth, reachability-is-
        // the-boundary model, so mirror its permissive CORS policy. No credentials
        // are sent, so a wildcard origin is valid.
        .layer(CorsLayer::permissive())
        .with_state(state)
}

/// Middleware: recover the caller's W3C trace context from the request headers
/// and attach it to the current request span, so the worker's server span is a
/// child of the caller's trace. Degrades to a no-op when no propagator is
/// installed or the request carries no context.
async fn accept_inbound_context(request: Request, next: Next) -> Response {
    test_cabinet_telemetry::propagation::accept_inbound(request.headers());
    next.run(request).await
}

/// Middleware: time the request and record the request count + latency metrics,
/// tagged by the matched route, method, and response status.
async fn record_request_metrics(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    // Resolve the matched route before consuming the request; fall back to the
    // raw path for an unrouted request (e.g. a 404).
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map(|matched| matched.as_str().to_string())
        .unwrap_or_else(|| request.uri().path().to_string());
    let method = request.method().to_string();

    let started = Instant::now();
    let response = next.run(request).await;
    let elapsed = started.elapsed().as_secs_f64();

    state
        .metrics
        .record_request(&route, &method, response.status().as_u16(), elapsed);
    response
}

/// `GET /healthz` — liveness/readiness probe.
///
/// Reports `backendUrl`: the backend this worker resolves definitions from and
/// publishes to. The UI compares it against the backend it is itself pointed at
/// to confirm a worker shares its backend; without it the worker reads as
/// "unverified" because there is nothing to check against.
async fn health(State(state): State<AppState>) -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "status": "ok",
        "version": CONTRACT_VERSION,
        "role": "worker",
        "backendUrl": state.config.backend_url,
    }))
}
