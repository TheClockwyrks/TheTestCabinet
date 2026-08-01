//! The `test-cabinet-gg` crate — The Test Cabinet's own first-party coding harness.
//!
//! This library backs two entrypoints:
//!
//! - the [`gg` binary](run_from_args) (`src/main.rs`), invoked **directly** by The Test Cabinet's
//!   `core` **inside the run container** with a single JSON invocation file — it drives a
//!   [`GgCapabilitySet`](test_cabinet_core::gg::GgCapabilitySet)-configured session to a produced,
//!   scoreable artifact while streaming a first-party
//!   [`GgTelemetryEvent`](test_cabinet_core::gg::GgTelemetryEvent) stream on stdout; and
//! - the [`replay_driver`], a **debug-only** native reconstruction: given a
//!   [`GgReplayRecordV1`](test_cabinet_core::gg::GgReplayRecordV1) captured from a run — every run
//!   is captured; the [replay](test_cabinet_core::gg::CAPABILITY_REPLAY) capability only escalates
//!   the [fidelity](test_cabinet_core::gg_replay::GgReplayFidelity) — it re-runs the session's turn
//!   loop from the pinned model I/O and tool results — no live model, no real tools — reproducing
//!   the telemetry step for step and yielding the per-agent [step-through](test_cabinet_core::gg::GgReplayStep)
//!   list a developer walks. It is exposed as a library so `tcab gg-replay` can drive it in-process.
//!
//! Everything else — the model client, the agent turn loop, tool dispatch, and the telemetry
//! emitter — is internal to this crate; the binary and the replay driver are the only public
//! surfaces.

mod agent;
mod archive;
mod board;
mod cancel;
mod client;
mod compaction;
mod completion;
mod config;
mod context;
mod dag;
mod docs;
mod ending;
mod fsm;
mod git;
mod healing;
mod limits;
mod memories;
mod message_log;
mod model;
mod modules;
mod persistence;
mod prompts;
mod replay;
pub mod replay_driver;
mod sandbox;
mod skills;
mod subagents;
mod summary;
mod tasks;
mod telemetry;
mod tools;
mod turn_timing;
mod vision;

use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;

use crate::telemetry::Emitter;

/// Command-line surface of the `gg` binary — a single `--config <PATH>` pointing at the
/// [JSON invocation file](config::GgInvocation).
#[derive(Debug, Parser)]
#[command(
    name = "gg",
    version,
    about = "The Test Cabinet's first-party coding harness (runs inside the run container)"
)]
struct Cli {
    /// Path to the JSON invocation file describing this run (session id, workspace directory, build
    /// prompt, and capability set). See [`config::GgInvocation`].
    #[arg(long, value_name = "PATH")]
    config: PathBuf,
}

/// Parse the `gg` binary's arguments and drive one session to completion, returning the process
/// exit code.
///
/// The turn loop is async (the model client is), so this runs on a single-threaded Tokio runtime. A
/// config-load failure is a **pre-telemetry** fatal reported on stderr (exit `1`); everything after —
/// including a model error mid-session — is reported on the NDJSON telemetry channel, and the exit
/// code only reflects whether a session launched. The thin `src/main.rs` binary simply forwards to
/// this.
#[tokio::main(flavor = "current_thread")]
pub async fn run_from_args() -> ExitCode {
    let cli = Cli::parse();

    // Load before any telemetry is emitted: the session id (needed to stamp every event) lives in
    // the config, and a malformed config is a pre-telemetry fatal error reported on stderr, not on
    // the NDJSON channel.
    let invocation = match config::load(&cli.config) {
        Ok(invocation) => invocation,
        Err(err) => {
            eprintln!("gg: {err:#}");
            return ExitCode::FAILURE;
        }
    };

    let emitter = Emitter::new(Some(invocation.session_id.clone()));

    // A session that ran (however it ended) exits `0` — its outcome is in the telemetry; only a
    // launch failure (no model to run) exits non-zero.
    match agent::run(&invocation, &emitter).await {
        agent::SessionOutcome::Ran => ExitCode::SUCCESS,
        agent::SessionOutcome::LaunchFailed => ExitCode::FAILURE,
    }
}

#[cfg(test)]
#[path = "lib.test.rs"]
mod tests;
