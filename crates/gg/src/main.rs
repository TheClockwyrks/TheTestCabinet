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
//! passed as `--config <PATH>`. That file deserializes to [`config::GgInvocation`]
//! and carries everything gg needs — the session id, the workspace directory, the
//! build prompt, and the [capability set](test_cabinet_core::gg::GgCapabilitySet)
//! (which capabilities are on, their implementations/params, and the model-slot
//! bindings). A single file (rather than a spray of flags or env vars) keeps the
//! configuration declarative, inspectable, and reproducible — the same properties
//! the capability set itself is designed for — and gives the integration workflow
//! one artifact to construct.
//!
//! Credentials are the one thing that does **not** travel in the file: the model
//! client reads `OPENROUTER_API_KEY` from the environment (injected into the run
//! container by `core`; see `HarnessSlug::Gg`'s registry entry), so a secret is
//! never written to a config file on disk.
//!
//! gg writes its telemetry as **NDJSON on stdout** (one
//! [`GgTelemetryEvent`](test_cabinet_core::gg::GgTelemetryEvent) per line); stderr
//! carries only pre-telemetry fatal errors (for example a malformed config file).
//!
//! # Phase 0 status
//!
//! This binary parses the invocation, resolves the run's `primary` model slot to a
//! concrete [`client`], and drives a minimal [turn loop](agent::run) — real
//! against the offline scripted [mock](client::MockClient), deferred for live
//! providers — emitting the live telemetry stream throughout before exiting `0`.
//!
//! TODO(gg-integration) — the next workflow fleshes out, roughly in this order:
//! - [`tools`] — tool dispatch and the Phase 0 toolset (shell + filesystem),
//!   gated by the capability set, replacing the loop's placeholder tool results.
//! - [`agent`] — driving live providers through the loop (not just the mock).
//! - `core`'s direct-invocation entrypoint that constructs the [`config::GgInvocation`]
//!   file and launches this binary in the run container.

mod agent;
mod client;
mod config;
mod model;
mod telemetry;
mod tools;

use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;

use crate::telemetry::Emitter;

/// Command-line surface of the `gg` binary — a single `--config <PATH>` pointing
/// at the [JSON invocation file](config::GgInvocation).
#[derive(Debug, Parser)]
#[command(
    name = "gg",
    version,
    about = "The Test Cabinet's first-party coding harness (runs inside the run container)"
)]
struct Cli {
    /// Path to the JSON invocation file describing this run (session id, workspace
    /// directory, build prompt, and capability set). See [`config::GgInvocation`].
    #[arg(long, value_name = "PATH")]
    config: PathBuf,
}

fn main() -> ExitCode {
    let cli = Cli::parse();

    // Load before any telemetry is emitted: the session id (needed to stamp every
    // event) lives in the config, and a malformed config is a pre-telemetry fatal
    // error reported on stderr, not on the NDJSON channel.
    let invocation = match config::load(&cli.config) {
        Ok(invocation) => invocation,
        Err(err) => {
            eprintln!("gg: {err:#}");
            return ExitCode::FAILURE;
        }
    };

    let emitter = Emitter::new(Some(invocation.session_id.clone()));

    // The turn loop is async (the model client is), so build a runtime and block on
    // one session. A model-level failure is reported as telemetry by the loop and is
    // *not* a process failure — only a pre-telemetry fatal (config load, or the
    // runtime failing to start) exits non-zero.
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(err) => {
            eprintln!("gg: failed to start the async runtime: {err}");
            return ExitCode::FAILURE;
        }
    };
    runtime.block_on(agent::run(&invocation, &emitter));

    ExitCode::SUCCESS
}
