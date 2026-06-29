//! Request and domain metrics for the backend, recorded via the OpenTelemetry
//! metrics API.
//!
//! The instruments are obtained from the process-global meter. When telemetry is
//! disabled (no `OTEL_EXPORTER_OTLP_ENDPOINT`; see `crate::main`), no
//! `MeterProvider` is installed and the global meter is a no-op, so recording
//! here is cheap and never fails — matching the opt-in, degrade-gracefully model.

use std::sync::LazyLock;
use std::time::Instant;

use axum::extract::{MatchedPath, Request};
use axum::middleware::Next;
use axum::response::Response;
use opentelemetry::metrics::{Counter, Histogram, Meter};
use opentelemetry::{KeyValue, global};

/// The meter every backend instrument is registered against.
static METER: LazyLock<Meter> = LazyLock::new(|| global::meter("tcab-backend"));

/// Count of HTTP requests served, dimensioned by route + method + status.
static HTTP_REQUESTS: LazyLock<Counter<u64>> = LazyLock::new(|| {
    METER
        .u64_counter("http.server.requests")
        .with_description("Count of HTTP requests served by the backend.")
        .build()
});

/// Wall-clock latency of HTTP requests, in seconds, by route + method + status.
static HTTP_DURATION: LazyLock<Histogram<f64>> = LazyLock::new(|| {
    METER
        .f64_histogram("http.server.duration")
        .with_description("Latency of HTTP requests served by the backend.")
        .with_unit("s")
        .build()
});

/// Count of runs successfully published (the publish domain counter).
static RUNS_PUBLISHED: LazyLock<Counter<u64>> = LazyLock::new(|| {
    METER
        .u64_counter("tcab.runs.published")
        .with_description("Count of runs successfully published.")
        .build()
});

/// Record one accepted publish. `newly_published` distinguishes a first publish
/// from an idempotent re-publish so the two can be told apart downstream.
pub fn record_run_published(newly_published: bool) {
    RUNS_PUBLISHED.add(1, &[KeyValue::new("newly_published", newly_published)]);
}

/// Axum middleware that times each request and records the request count +
/// latency, dimensioned by the matched route template (not the concrete path, so
/// the cardinality stays bounded), method, and response status.
pub async fn record_request(request: Request, next: Next) -> Response {
    // The route template (e.g. `/runs/{id}`) keeps label cardinality bounded;
    // fall back to the literal path when no route matched (e.g. a 404).
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map(|p| p.as_str().to_string())
        .unwrap_or_else(|| request.uri().path().to_string());
    let method = request.method().as_str().to_string();

    let started = Instant::now();
    let response = next.run(request).await;
    let elapsed = started.elapsed().as_secs_f64();

    let attrs = [
        KeyValue::new("http.route", route),
        KeyValue::new("http.request.method", method),
        KeyValue::new(
            "http.response.status_code",
            i64::from(response.status().as_u16()),
        ),
    ];
    HTTP_REQUESTS.add(1, &attrs);
    HTTP_DURATION.record(elapsed, &attrs);

    response
}
