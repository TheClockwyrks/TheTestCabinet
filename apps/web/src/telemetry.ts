// OpenTelemetry browser instrumentation for the web console.
//
// Mirrors the Rust telemetry crate's opt-in, degrade-gracefully contract: the
// whole pipeline is gated on `VITE_OTEL_EXPORTER_OTLP_ENDPOINT`. When that env
// var is unset (or blank), `initTelemetry()` is a no-op — no provider, no
// exporter, no global propagator, and no console noise — so the default build
// behaves exactly as it does today.
//
// When the endpoint is set, this installs a `WebTracerProvider` exporting spans
// over OTLP/HTTP (protobuf is gRPC-only in the browser, so the JS SDK speaks
// OTLP/HTTP+JSON to the collector's :4318 endpoint), registers the W3C
// TraceContext propagator + a ZoneContextManager (so async causality survives
// across `await` boundaries), and wires `FetchInstrumentation` to create a span
// per outbound fetch and inject the `traceparent` header.
//
// CORS implication: the collector (grafana/otel-lgtm OTLP/HTTP on :4318) must
// allow cross-origin POSTs from the console's origin, and the backend + workers
// must allow the inbound `traceparent` request header (and not reject the
// CORS preflight it triggers). See the followups note.
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  BatchSpanProcessor,
  WebTracerProvider,
} from "@opentelemetry/sdk-trace-web";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
// `deployment.environment.name` is still incubating in the JS semconv package,
// matching the Rust side which gated it behind `semconv_experimental`.
import { ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from "@opentelemetry/semantic-conventions/incubating";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";

const DEFAULT_SERVICE_NAME = "tcab-web";

// Injected by Vite at build time from the package version (see vite.config.ts).
declare const __APP_VERSION__: string;

// Read the OTLP endpoint, treating unset/blank as disabled (mirrors the Rust
// crate's master-switch semantics for `OTEL_EXPORTER_OTLP_ENDPOINT`).
function otlpEndpoint(): string | null {
  const raw = import.meta.env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

let initialized = false;

// Initialize browser telemetry. Safe to call multiple times (only the first
// call has an effect) and safe to call when telemetry is disabled (no-op).
// Call once at the top of the app entry, before the first render.
export function initTelemetry(): void {
  if (initialized) return;
  initialized = true;

  const endpoint = otlpEndpoint();
  if (!endpoint) {
    // Disabled: behave exactly as a build without telemetry. No provider, no
    // global propagator, no console output.
    return;
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]:
      import.meta.env.VITE_OTEL_SERVICE_NAME?.trim() || DEFAULT_SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: __APP_VERSION__,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]:
      import.meta.env.VITE_TCAB_ENV?.trim() || "local",
  });

  // The SDK appends the signal path (`/v1/traces`) to the base endpoint, so the
  // env var is the collector's OTLP/HTTP base URL (e.g. http://localhost:4318).
  const exporter = new OTLPTraceExporter({
    url: `${endpoint.replace(/\/+$/, "")}/v1/traces`,
  });

  const provider = new WebTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });

  // Register globally with the W3C TraceContext propagator (so outbound headers
  // carry `traceparent`) and a ZoneContextManager (so the active span survives
  // across async hops in the browser).
  provider.register({
    contextManager: new ZoneContextManager(),
    propagator: new W3CTraceContextPropagator(),
  });

  // Auto-instrument fetch: one span per request with method/url/status, plus
  // `traceparent` injection. The console only ever fetches its own backend and
  // workers (via the transport chokepoint), so propagate trace headers to any
  // URL it calls — it makes no third-party requests. Adjust
  // `propagateTraceHeaderCorsUrls` if that ever changes.
  registerInstrumentations({
    instrumentations: [
      new FetchInstrumentation({
        propagateTraceHeaderCorsUrls: /.*/,
        // Keep the default span name (HTTP verb); the URL is captured as an
        // attribute by the instrumentation.
        clearTimingResources: true,
      }),
    ],
  });

  // Flush buffered spans on page hide so navigations/closes don't drop them.
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        void provider.forceFlush().catch(() => {
          /* best-effort flush; never surface telemetry errors to the user */
        });
      }
    });
  }
}
