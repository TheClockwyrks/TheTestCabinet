//! Binary-facing telemetry initialization (the `otlp` feature).
//!
//! This module owns the heavy path: it builds the OpenTelemetry SDK providers
//! (traces, metrics, logs), wires them into a `tracing-subscriber` registry
//! alongside the existing fmt layer, installs the W3C TraceContext propagator,
//! and hands back a [`TelemetryGuard`] that flushes and shuts the providers down
//! on drop.
//!
//! When `OTEL_EXPORTER_OTLP_ENDPOINT` is unset or blank, none of that happens:
//! only the fmt layer is installed (today's behavior) and an inert guard is
//! returned. A missing collector is never fatal.

use anyhow::Context as _;
use opentelemetry::KeyValue;
use opentelemetry::global;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_sdk::Resource;
use opentelemetry_sdk::logs::SdkLoggerProvider;
use opentelemetry_sdk::metrics::SdkMeterProvider;
use opentelemetry_sdk::propagation::TraceContextPropagator;
use opentelemetry_sdk::trace::SdkTracerProvider;
use opentelemetry_semantic_conventions::resource::{DEPLOYMENT_ENVIRONMENT_NAME, SERVICE_VERSION};
use tracing_subscriber::EnvFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

/// Telemetry configuration supplied by the calling binary.
///
/// Construct with [`Config::new`]; the caller passes its own service name and
/// version (typically `env!("CARGO_PKG_VERSION")` of the *binary* crate) and the
/// `RUST_LOG` fallback filter that preserves its pre-telemetry logging defaults.
pub struct Config {
    service_name: String,
    service_version: String,
    default_filter: String,
}

impl Config {
    /// Create a config.
    ///
    /// - `service_name`: the OTel `service.name` (e.g. `"tcab-dispatcher"`).
    /// - `service_version`: the OTel `service.version`; pass
    ///   `env!("CARGO_PKG_VERSION")` from the binary.
    /// - `default_filter`: the `EnvFilter` directive used when `RUST_LOG` is
    ///   unset, e.g. `"info,test_cabinet_dispatcher=info"`. This preserves each
    ///   binary's existing log defaults verbatim.
    pub fn new(
        service_name: impl Into<String>,
        service_version: impl Into<String>,
        default_filter: impl Into<String>,
    ) -> Self {
        Self {
            service_name: service_name.into(),
            service_version: service_version.into(),
            default_filter: default_filter.into(),
        }
    }
}

/// Initialize telemetry for a binary.
///
/// Behavior:
/// - Always installs the fmt layer with the `RUST_LOG`/default `EnvFilter`, so
///   stdout logging matches today's behavior.
/// - If `OTEL_EXPORTER_OTLP_ENDPOINT` is set and non-blank, additionally
///   installs the OTLP traces/logs layers and a metrics pipeline, sets the
///   global W3C propagator, and returns a guard whose `Drop` flushes and shuts
///   down every provider.
/// - If that env var is unset/blank, installs *only* the fmt layer, logs one
///   info line that OTLP export is disabled, and returns an inert guard.
///
/// Never panics on a missing/unreachable collector. Errors are confined to
/// genuine misconfiguration of the exporter builders.
pub fn init(config: Config) -> anyhow::Result<TelemetryGuard> {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(&config.default_filter));
    let fmt_layer = tracing_subscriber::fmt::layer();

    let endpoint = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
        .ok()
        .filter(|e| !e.trim().is_empty());

    let Some(_endpoint) = endpoint else {
        // Fallback: today's behavior, no exporters, inert guard.
        tracing_subscriber::registry()
            .with(filter)
            .with(fmt_layer)
            .try_init()
            .ok();
        tracing::info!(
            "OTLP export disabled (OTEL_EXPORTER_OTLP_ENDPOINT unset); logging to stdout only"
        );
        return Ok(TelemetryGuard::inert());
    };

    let resource = build_resource(&config);

    // Traces: OTLP span exporter -> batch span processor -> tracer provider.
    let span_exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_http()
        .build()
        .context("building the OTLP span exporter")?;
    let tracer_provider = SdkTracerProvider::builder()
        .with_resource(resource.clone())
        .with_batch_exporter(span_exporter)
        .build();
    let tracer = tracer_provider.tracer(config.service_name.clone());
    global::set_tracer_provider(tracer_provider.clone());
    let otel_trace_layer = tracing_opentelemetry::layer().with_tracer(tracer);

    // Metrics: OTLP push exporter behind a periodic reader.
    let metric_exporter = opentelemetry_otlp::MetricExporter::builder()
        .with_http()
        .build()
        .context("building the OTLP metric exporter")?;
    let meter_provider = SdkMeterProvider::builder()
        .with_resource(resource.clone())
        .with_periodic_exporter(metric_exporter)
        .build();
    global::set_meter_provider(meter_provider.clone());

    // Logs: OTLP log exporter -> logger provider -> tracing bridge layer.
    let log_exporter = opentelemetry_otlp::LogExporter::builder()
        .with_http()
        .build()
        .context("building the OTLP log exporter")?;
    let logger_provider = SdkLoggerProvider::builder()
        .with_resource(resource)
        .with_batch_exporter(log_exporter)
        .build();
    let otel_log_layer = OpenTelemetryTracingBridge::new(&logger_provider);

    // Global W3C TraceContext propagator so inbound/outbound context flows.
    global::set_text_map_propagator(TraceContextPropagator::new());

    tracing_subscriber::registry()
        .with(filter)
        .with(fmt_layer)
        .with(otel_trace_layer)
        .with(otel_log_layer)
        .try_init()
        .ok();

    tracing::info!(
        service.name = %config.service_name,
        "OTLP export enabled (traces + metrics + logs over HTTP/protobuf)"
    );

    Ok(TelemetryGuard {
        tracer_provider: Some(tracer_provider),
        meter_provider: Some(meter_provider),
        logger_provider: Some(logger_provider),
    })
}

/// Build the OTel `Resource` describing this service.
///
/// `service.name` is overridden by `OTEL_SERVICE_NAME` and attributes by
/// `OTEL_RESOURCE_ATTRIBUTES` automatically (the `ResourceBuilder` consults
/// those env vars), so we only seed defaults here. `service.version` comes from
/// the caller; `deployment.environment.name` comes from `TCAB_ENV` (default
/// `"local"`).
fn build_resource(config: &Config) -> Resource {
    let environment = std::env::var("TCAB_ENV").unwrap_or_else(|_| DEFAULT_ENVIRONMENT.to_string());
    Resource::builder()
        .with_service_name(config.service_name.clone())
        .with_attributes([
            KeyValue::new(SERVICE_VERSION, config.service_version.clone()),
            KeyValue::new(DEPLOYMENT_ENVIRONMENT_NAME, environment),
        ])
        .build()
}

/// Default `deployment.environment.name` when `TCAB_ENV` is unset.
const DEFAULT_ENVIRONMENT: &str = "local";

/// Flushes and shuts down the OpenTelemetry providers on drop.
///
/// Keep this alive for the lifetime of the program (`let _guard = init(..)?;`
/// in `main`). On drop it force-flushes then shuts down the tracer, meter, and
/// logger providers in turn. This is essential for short-lived binaries (the
/// CLI): without the flush, buffered spans/metrics/logs are dropped on exit.
///
/// An inert guard (returned by the no-endpoint fallback) does nothing on drop.
#[must_use = "the guard flushes telemetry on drop; bind it for the program's lifetime"]
pub struct TelemetryGuard {
    tracer_provider: Option<SdkTracerProvider>,
    meter_provider: Option<SdkMeterProvider>,
    logger_provider: Option<SdkLoggerProvider>,
}

impl TelemetryGuard {
    /// An inert guard that performs no flush/shutdown on drop. Returned by the
    /// fmt-only fallback path.
    fn inert() -> Self {
        Self {
            tracer_provider: None,
            meter_provider: None,
            logger_provider: None,
        }
    }
}

impl Drop for TelemetryGuard {
    fn drop(&mut self) {
        if let Some(provider) = self.tracer_provider.take() {
            let _ = provider.force_flush();
            let _ = provider.shutdown();
        }
        if let Some(provider) = self.meter_provider.take() {
            let _ = provider.force_flush();
            let _ = provider.shutdown();
        }
        if let Some(provider) = self.logger_provider.take() {
            let _ = provider.force_flush();
            let _ = provider.shutdown();
        }
    }
}
