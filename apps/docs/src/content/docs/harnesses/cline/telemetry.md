---
title: Telemetry
---

**Cline runs export no telemetry.** A run configures nothing for Cline, and its
sessions appear in the run's trace only as the gap the harness invocation span
covers.

This is a limitation of Cline, not a decision to leave it out.

## Why

Two independent blockers:

- **No traces at all.** Cline's OpenTelemetry integration covers **metrics and
  logs only**. Even fully configured, it would never produce the spans that make a
  harness useful to trace.
- **No configuration path a run can use.** Cline's OTLP settings live in *Remote
  Configuration* in its hosted enterprise dashboard — endpoint, protocol, and
  headers are all set there. There is no environment variable and no config file
  that a run container could write to point Cline at a collector.

Cline's documentation addresses the VS Code extension throughout and does not
cover the CLI or headless mode, which is what a run drives. The CLI appears to
share the same telemetry abstraction internally, but no documented path makes
that configurable outside the dashboard.

The only environment variable Cline documents is `TEL_DEBUG_DIAGNOSTICS=true`,
which turns on verbose OpenTelemetry diagnostic logging. It configures no
exporter.

## What would change this

A documented environment or config-file path to set the OTLP endpoint for the
Cline CLI, plus trace export. Either alone is insufficient: an endpoint without
traces still yields no spans, and traces without a headless configuration path
still cannot be pointed anywhere.

If you run Cline under an enterprise organization, telemetry configured in the
dashboard will still be delivered — but it is configured out-of-band, is not
scoped to a run, and carries none of the `tcab.*` resource attributes that make
harness telemetry correlatable to the run that produced it.

---

See [Observability](/development/observability/) for the harnesses that do export
and the collector they export to, and [Overview](./overview/) for how Cline is
installed and invoked.
