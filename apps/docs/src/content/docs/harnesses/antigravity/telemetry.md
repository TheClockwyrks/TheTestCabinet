---
title: Telemetry
---

Antigravity runs export no telemetry. Antigravity exposes no OpenTelemetry
support, no OTLP endpoint setting, and no plugin mechanism, so a run configures
nothing for it. An Antigravity session appears in the run's trace only as the
span covering the harness invocation.

See [Observability](/development/observability/) for the harnesses that do export
and the collector they export to.
