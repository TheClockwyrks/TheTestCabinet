//! The `gg` binary — The Test Cabinet's own first-party coding harness.
//!
//! gg is invoked **directly** by The Test Cabinet's `core` (not through the
//! orchestrator, `tcab-session`, or a harness subprocess — see the design docs
//! under `gg/` in the documentation site) and runs **inside the run container**,
//! alongside the seeded workspace. It contains its own model client, agent turn
//! loop, tool dispatch, and telemetry emitter, and it drives a
//! [`GgCapabilitySet`](test_cabinet_core::gg::GgCapabilitySet)-configured session
//! to a produced, scoreable artifact while streaming a first-party
//! [`GgTelemetryEvent`](test_cabinet_core::gg::GgTelemetryEvent) stream on stdout.
//!
//! # Invocation contract
//!
//! gg is launched with exactly one input: a **JSON invocation file** whose path is
//! passed as `--config <PATH>`. That file deserializes to `config::GgInvocation`
//! and carries everything gg needs — the session id, the workspace directory, the
//! build prompt, and the [capability set](test_cabinet_core::gg::GgCapabilitySet)
//! (which capabilities are on, their implementations/params, and the model-slot
//! bindings). A single file (rather than a spray of flags or env vars) keeps the
//! configuration declarative, inspectable, and reproducible.
//!
//! Credentials are the one thing that does **not** travel in the file: the model
//! client reads `OPENROUTER_API_KEY` from the environment (injected into the run
//! container by `core`), so a secret is never written to a config file on disk.
//!
//! gg writes its telemetry as **NDJSON on stdout** (one
//! [`GgTelemetryEvent`](test_cabinet_core::gg::GgTelemetryEvent) per line); stderr
//! carries only pre-telemetry fatal errors (for example a malformed config file).
//!
//! The whole harness lives in the [`test_cabinet_gg`] library; this binary is a thin
//! entrypoint that forwards to [`run_from_args`](test_cabinet_gg::run_from_args).

use std::process::ExitCode;

fn main() -> ExitCode {
    test_cabinet_gg::run_from_args()
}
