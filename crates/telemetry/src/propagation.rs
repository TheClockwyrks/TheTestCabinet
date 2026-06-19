//! W3C TraceContext propagation helpers.
//!
//! This module is deliberately light: it depends only on the OpenTelemetry
//! *API* (`opentelemetry`), the header glue (`opentelemetry-http`), and the
//! bridge that reads the current `tracing` span's context
//! (`tracing-opentelemetry`). It pulls in **no** exporter and **no** SDK, so a
//! library such as `crates/core` can propagate context across HTTP and
//! subprocess boundaries while depending on this crate with
//! `default-features = false`.
//!
//! All functions route through the process-global text-map propagator. A binary
//! that called [`crate::init`] (with the `otlp` feature) will have installed the
//! W3C TraceContext propagator; if nothing installed one, the global default is
//! a no-op propagator and these helpers degrade to doing nothing — never an
//! error and never a panic.

use opentelemetry::Context;
use opentelemetry::global;
use opentelemetry::propagation::{Extractor, Injector};
use opentelemetry_http::{HeaderExtractor, HeaderInjector};
use tracing_opentelemetry::OpenTelemetrySpanExt;

/// Extract the parent `Context` carried by an inbound request's headers.
///
/// Use this on the server side (axum/`http`) to recover the caller's trace
/// context. Pair it with [`set_span_parent`] to graft the recovered context
/// onto the span that handles the request:
///
/// ```ignore
/// let parent = telemetry::propagation::extract_context(req.headers());
/// telemetry::propagation::set_span_parent(&tracing::Span::current(), parent);
/// ```
pub fn extract_context(headers: &http::HeaderMap) -> Context {
    global::get_text_map_propagator(|propagator| propagator.extract(&HeaderExtractor(headers)))
}

/// Set `parent` as the parent of `span` so the span continues the inbound
/// trace.
///
/// This is a thin wrapper over `OpenTelemetrySpanExt::set_parent`; a failure to
/// attach (the span has no OpenTelemetry data, e.g. no subscriber installed) is
/// swallowed, keeping propagation non-fatal in the fmt-only fallback.
pub fn set_span_parent(span: &tracing::Span, parent: Context) {
    let _ = span.set_parent(parent);
}

/// Convenience for the common inbound case: extract the parent context from
/// `headers` and attach it to the current span.
pub fn accept_inbound(headers: &http::HeaderMap) {
    let parent = extract_context(headers);
    set_span_parent(&tracing::Span::current(), parent);
}

/// Inject the current span's OpenTelemetry context into `headers` for an
/// outbound request (e.g. a `reqwest` call to the backend/worker).
///
/// ```ignore
/// let mut headers = http::HeaderMap::new();
/// telemetry::propagation::inject_current_context(&mut headers);
/// let resp = client.get(url).headers(headers).send().await?;
/// ```
pub fn inject_current_context(headers: &mut http::HeaderMap) {
    let cx = tracing::Span::current().context();
    global::get_text_map_propagator(|propagator| {
        propagator.inject_context(&cx, &mut HeaderInjector(headers))
    });
}

/// Inject an explicit `Context` into `headers`, for callers that hold a context
/// that is not the current span's.
pub fn inject_context(cx: &Context, headers: &mut http::HeaderMap) {
    global::get_text_map_propagator(|propagator| {
        propagator.inject_context(cx, &mut HeaderInjector(headers))
    });
}

/// Produce the W3C `traceparent` header value for the current span's context,
/// suitable for handing to a spawned subprocess as the `TRACEPARENT`
/// environment variable.
///
/// Returns `None` when there is no active/recorded span context to propagate
/// (e.g. no subscriber installed, or the current span is not sampled), so the
/// caller can simply skip setting the variable.
///
/// ```ignore
/// if let Some(tp) = telemetry::propagation::current_traceparent() {
///     command.env("TRACEPARENT", tp);
/// }
/// ```
pub fn current_traceparent() -> Option<String> {
    traceparent_of(&tracing::Span::current().context())
}

/// Produce the W3C `traceparent` value for an explicit `Context`.
pub fn traceparent_of(cx: &Context) -> Option<String> {
    let mut carrier = SingleValue::default();
    global::get_text_map_propagator(|propagator| propagator.inject_context(cx, &mut carrier));
    carrier.0
}

/// A minimal `Injector`/`Extractor` carrier that retains only the
/// `traceparent` field, used to render the subprocess env var without
/// allocating a full `HeaderMap`.
#[derive(Default)]
struct SingleValue(Option<String>);

impl Injector for SingleValue {
    fn set(&mut self, key: &str, value: String) {
        if key.eq_ignore_ascii_case("traceparent") {
            self.0 = Some(value);
        }
    }
}

impl Extractor for SingleValue {
    fn get(&self, key: &str) -> Option<&str> {
        if key.eq_ignore_ascii_case("traceparent") {
            self.0.as_deref()
        } else {
            None
        }
    }

    fn keys(&self) -> Vec<&str> {
        if self.0.is_some() {
            vec!["traceparent"]
        } else {
            vec![]
        }
    }
}
