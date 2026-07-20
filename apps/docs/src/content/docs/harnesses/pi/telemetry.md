---
title: Telemetry
---

**Pi runs export no telemetry.** A run configures nothing for Pi, and its sessions
appear in the run's trace only as the gap the harness invocation span covers.

Pi has no native OpenTelemetry support. Several third-party extensions exist, but
none is currently both compatible with Pi and safe for a run to install.

## Why

Pi's npm package was renamed from `@mariozechner/pi-coding-agent` to
`@earendil-works/pi-coding-agent`. Every mature OpenTelemetry extension still
peer-depends on the retired scope and will not load against current Pi:

| Extension | Peer dependency | Latest release |
| --- | --- | --- |
| `pi-telemetry-otel` | `@mariozechner/pi-coding-agent` `^0.51.0` | 0.1.1, Feb 2026 |
| `@devkade/pi-opentelemetry` | `@mariozechner/pi-coding-agent` `^0.53.0` | 0.1.3, Feb 2026 |
| `@mobrienv/pi-otlp` | `@mariozechner/pi-coding-agent` `>=0.42.0` | 0.2.0, Feb 2026 |
| `pi-otel-telemetry` | `@mariozechner/pi-coding-agent` `*` | 1.0.0, Mar 2026 |
| **`pi-otel`** | **`@earendil-works/pi-coding-agent` `*`** | **0.1.0, May 2026** |

Only `pi-otel` targets the current scope. It is a single release with a thin
maintenance history, its `@opentelemetry/*` dependencies are a major version
behind, and its permissive `*` peer range means npm will not warn if the
extension API has moved underneath it.

The deciding factor is the failure mode: an extension Pi cannot load does not
degrade to "no telemetry" — it can break Pi runs outright. Registering an
unverified extension would risk working runs for telemetry that may never arrive,
so Pi is documented here rather than wired up.

## Trace linking

Worth recording for whenever this is revisited: **no Pi extension reads
`TRACEPARENT`.** Verified by inspecting the published sources — searches for
`traceparent`, `tracestate`, and `W3CTraceContext` return nothing in either
`pi-otel` or `pi-telemetry-otel`.

`pi-telemetry-otel` is the only one with any parent-linking hook at all, and it
uses a proprietary split-ID scheme rather than the W3C format — it reads
`PI_AGENT_TRACE_ID` and `PI_AGENT_SPAN_ID` as separate hex strings and hardcodes
the sampled flag. Supporting it would mean splitting the run's `traceparent` into
its components and accepting that the sampling decision is discarded.

## What would change this

Either native OpenTelemetry support in Pi, or a smoke-tested `pi-otel` release
confirmed to load against the current `@earendil-works` package. Enabling it would
mean writing an `otel` block into Pi's `settings.json` — endpoint, protocol
`http/protobuf` (it defaults to gRPC on `:4317`), and the three signal toggles —
alongside the `packages` entry that registers the extension.

---

See [Observability](/development/observability/) for the harnesses that do export
and the collector they export to, and [Overview](./overview/) for how Pi is
installed and invoked.
