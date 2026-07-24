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
//! # Status
//!
//! This binary parses the invocation, builds the run's [root agent](agent::Agent),
//! resolves its model [slot](test_cabinet_core::gg::GgSlotBinding) to a concrete
//! [`client`] (the scripted [mock](client::MockClient) or a live
//! [OpenRouter](client::OpenRouterClient) provider), and drives the
//! [turn loop](agent::Agent::drive) against it — dispatching tools on the workspace and
//! emitting the live, [agent-tagged](telemetry::Emitter::for_agent) telemetry stream
//! throughout, with usage/cost accounted [per slot](agent::run). A launched session exits
//! `0` with its outcome in the stream; a launch failure exits non-zero.
//!
//! TODO(gg-integration) — the next workflow fleshes out, roughly in this order:
//! - `core`'s direct-invocation entrypoint that constructs the [`config::GgInvocation`]
//!   file and launches this binary in the run container.
//! - subagent spawning: the [scheduler](agent) that lets the root agent delegate to child
//!   agents (Phase 4B), which run on their own slots and accrue into the same per-slot
//!   accounting.

mod agent;
mod archive;
mod board;
mod client;
mod compaction;
mod config;
mod context;
mod dag;
mod fsm;
mod git;
mod memories;
mod model;
mod planning;
mod rac;
mod replay;
mod skills;
mod subagents;
mod summary;
mod tasks;
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

/// The turn loop is async (the model client is), so gg runs on a single-threaded
/// Tokio runtime. A config-load failure is a **pre-telemetry** fatal reported on
/// stderr (exit `1`); everything after — including a model error mid-session — is
/// reported on the NDJSON telemetry channel, and the process exit code only reflects
/// whether a session [launched](agent::SessionOutcome).
#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
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

    // A session that ran (however it ended) exits `0` — its outcome is in the
    // telemetry; only a launch failure (no model to run) exits non-zero.
    match agent::run(&invocation, &emitter).await {
        agent::SessionOutcome::Ran => ExitCode::SUCCESS,
        agent::SessionOutcome::LaunchFailed => ExitCode::FAILURE,
    }
}
