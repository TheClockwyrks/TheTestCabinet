//! The worker's OpenTelemetry metric instruments.
//!
//! A small, idiomatic set of request and run metrics recorded through the
//! process-global OTel meter. When no `MeterProvider` is installed (the common
//! fmt-only path, with no OTLP endpoint configured) the global meter is a no-op,
//! so recording onto these instruments costs nothing and never fails — the same
//! graceful degradation the rest of telemetry follows.
//!
//! Instruments are built once and cloned cheaply into the router state (cloning
//! shares the underlying instrument rather than registering a duplicate).

use std::sync::Arc;

use opentelemetry::metrics::{Counter, Histogram};
use opentelemetry::{KeyValue, global};

/// The meter name (the OTel instrumentation scope) every worker instrument is
/// registered under.
const METER_NAME: &str = "tcab-worker";

/// The worker's metric instruments, created once and shared (cheaply cloned)
/// across handlers via [`AppState`](crate::api::AppState).
#[derive(Clone)]
pub struct Metrics {
    inner: Arc<Inner>,
}

/// The owned instruments behind [`Metrics`]. Held in an `Arc` so a `Metrics`
/// clone shares them rather than re-registering with the meter.
struct Inner {
    /// Total HTTP requests served, by route, method, and response status.
    http_requests: Counter<u64>,
    /// HTTP request handling latency in seconds, by route, method, and status.
    http_duration: Histogram<f64>,
    /// Submitted run jobs, counted as they are accepted.
    runs_submitted: Counter<u64>,
}

impl Metrics {
    /// Build the worker's instruments from the global meter.
    ///
    /// Safe to call before any provider is installed: instruments built from the
    /// no-op meter simply discard their measurements.
    pub fn new() -> Self {
        let meter = global::meter(METER_NAME);
        let http_requests = meter
            .u64_counter("http.server.requests")
            .with_description("Total HTTP requests served by the worker.")
            .build();
        let http_duration = meter
            .f64_histogram("http.server.duration")
            .with_unit("s")
            .with_description("HTTP request handling latency in seconds.")
            .build();
        let runs_submitted = meter
            .u64_counter("tcab.worker.runs.submitted")
            .with_description("Run jobs accepted by the worker.")
            .build();
        Self {
            inner: Arc::new(Inner {
                http_requests,
                http_duration,
                runs_submitted,
            }),
        }
    }

    /// Record one completed HTTP request: bump the request counter and observe
    /// its latency, both tagged by route, method, and response status.
    pub fn record_request(&self, route: &str, method: &str, status: u16, duration_secs: f64) {
        let attributes = [
            KeyValue::new("http.route", route.to_string()),
            KeyValue::new("http.request.method", method.to_string()),
            KeyValue::new("http.response.status_code", i64::from(status)),
        ];
        self.inner.http_requests.add(1, &attributes);
        self.inner.http_duration.record(duration_secs, &attributes);
    }

    /// Count one accepted run job.
    pub fn record_run_submitted(&self) {
        self.inner.runs_submitted.add(1, &[]);
    }
}

impl Default for Metrics {
    fn default() -> Self {
        Self::new()
    }
}
