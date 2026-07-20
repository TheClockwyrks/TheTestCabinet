---
title: Telemetry
---

**Antigravity runs export no telemetry.** A run configures nothing for it, and its
sessions appear in the run's trace only as the gap the harness invocation span
covers.

Antigravity exposes no telemetry export of any kind — no OpenTelemetry support, no
OTLP endpoint setting, and no plugin or extension mechanism through which one
could be added. There is nothing for a run to configure.

This is consistent with how little the harness exposes generally: it accepts no
model ID and reports no token usage in its non-interactive mode either. See
[Overview](./overview/) and [Metrics](./metrics/).

## What would change this

Native OpenTelemetry support, or an extension mechanism that could carry it.
Neither exists today.

---

See [Observability](/development/observability/) for the harnesses that do export
and the collector they export to.
