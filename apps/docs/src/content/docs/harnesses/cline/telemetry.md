---
title: Telemetry
---

Cline runs export no telemetry. A run configures nothing for Cline, so its
sessions appear in the run's trace only as the span covering the harness
invocation.

## Cline's export surface

Two independent blockers apply:

- Cline's OpenTelemetry integration covers metrics and logs only, so a fully
  configured Cline still produces none of the spans that make a harness worth
  tracing.
- Cline's OTLP settings live in Remote Configuration in its hosted enterprise
  dashboard, covering the endpoint, the protocol, and the headers. A run
  container has no environment variable or config file that points Cline at a
  collector.

The one environment variable Cline documents, `TEL_DEBUG_DIAGNOSTICS=true`,
turns on verbose OpenTelemetry diagnostic logging and configures no exporter.

Under an enterprise organization, telemetry configured in the dashboard is still
delivered. That configuration is out of band, is scoped to the organization
rather than to a run, and carries none of the `tcab.*` resource attributes that
make harness telemetry correlatable to the run that produced it.

See [Observability](/development/observability/) for the harnesses that do
export and the collector they export to.
