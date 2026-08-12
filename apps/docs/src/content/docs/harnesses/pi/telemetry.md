---
title: Telemetry
---

Pi runs export no telemetry. A run configures nothing for Pi, and its sessions
appear in the run's trace only as the span covering the harness invocation.

## Extension compatibility

Pi has no native OpenTelemetry support, and a run registers no third-party
extension to add it. The mature extensions peer-depend on the retired
`@mariozechner/pi-coding-agent` package and will not load against the
`@earendil-works/pi-coding-agent` package Pi ships as:

| Extension | Peer dependency | Latest release |
| --- | --- | --- |
| `pi-telemetry-otel` | `@mariozechner/pi-coding-agent` `^0.51.0` | 0.1.1, Feb 2026 |
| `@devkade/pi-opentelemetry` | `@mariozechner/pi-coding-agent` `^0.53.0` | 0.1.3, Feb 2026 |
| `@mobrienv/pi-otlp` | `@mariozechner/pi-coding-agent` `>=0.42.0` | 0.2.0, Feb 2026 |
| `pi-otel-telemetry` | `@mariozechner/pi-coding-agent` `*` | 1.0.0, Mar 2026 |
| `pi-otel` | `@earendil-works/pi-coding-agent` `*` | 0.1.0, May 2026 |

`pi-otel` is the only one targeting the current package. It is a single release
with a thin maintenance history, its `@opentelemetry/*` dependencies are a
major version behind, and its permissive `*` peer range means npm gives no
warning when the extension API moves underneath it. An extension Pi cannot load
breaks Pi runs outright rather than degrading to no telemetry, so a run
registers none.

See [Observability](/development/observability/) for the harnesses that do export
and the collector they export to.
