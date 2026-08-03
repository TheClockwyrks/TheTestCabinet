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
//!   [`GgReplayRecord`](test_cabinet_core::gg_replay::GgReplayRecord) captured from a run — every
//!   run is captured; the [replay](test_cabinet_core::gg::CAPABILITY_REPLAY) capability only
//!   escalates the [fidelity](test_cabinet_core::gg_replay::GgReplayFidelity) — it re-runs the
//!   session's turn loop from the pinned inputs, drawn through the
//!   [shared index](replay_inputs) — no live model, no real tools — reproducing the telemetry step
//!   for step and yielding the per-agent [step-through](test_cabinet_core::gg::GgReplayStep) list a
//!   developer walks. It is exposed as a library so `tcab gg-replay` can drive it in-process.
//!
//! The binary reaches the driver through its own `replay` subcommand, and
//! `tcab gg-replay` reaches it either in-process or by *invoking an older `gg`* — so both front
//! ends share [`replay_cli`], which owns reading a record and reporting a reconstruction. A
//! delegated reconstruction is the older binary's output verbatim, and one reporter is what stops
//! the same record from summarizing differently depending on which binary ran it.
//!
//! [`playback`] is the third public surface, and it is a *different thing* from the replay driver
//! — a distinction worth keeping in code, docs and flags, because confusing them is how somebody
//! ends up believing a transcript viewer proved a regression. The driver walks a record passively
//! and performs no side effects at all; a playback re-runs the recorded session through the
//! **real** turn loop, answering only the model call and the shell from the record and performing
//! everything else for real, and reports where this build diverged from what was recorded.
//!
//! Everything else — the model client, the agent turn loop, tool dispatch, and the telemetry
//! emitter — is internal to this crate; the binary, the replay driver and its command-line front
//! end, and playback are the only public surfaces.

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
mod knowledge;
mod limits;
mod memories;
mod message_log;
mod model;
mod modules;
mod observer;
mod persistence;
pub mod playback;
mod programs;
mod prompts;
mod replay;
pub mod replay_cli;
pub mod replay_driver;
pub mod replay_inputs;
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

use clap::{Args, Parser, Subcommand};

use crate::telemetry::Emitter;

/// Command-line surface of the `gg` binary.
///
/// Two shapes, and the first one is load-bearing:
///
/// - **`gg --config <PATH>`**, with no subcommand, drives a session. This is the *entire*
///   invocation contract `core` has ever used ([`gg_exec`](test_cabinet_core::gg_exec) launches
///   exactly `gg --config <path>`), it is what every released gg accepts, and it is what a
///   deployment's baked binary is invoked by. Turning it into `gg run --config` would break every
///   run the moment a driver and a binary disagreed on which generation they were, for no gain — so
///   the bare form stays, permanently, as an implied [`Command::Run`].
/// - **`gg <SUBCOMMAND>`** for everything else. Today that is [`Command::Replay`], the passive
///   reconstruction that makes the old-binary path possible: a record whose inputs a newer gg no
///   longer understands can be handed back to the gg that wrote it, which only works if a published
///   gg can be *asked* to replay.
///
/// The two are held apart by clap's `args_conflicts_with_subcommands` (a subcommand and a bare
/// `--config` are mutually exclusive rather than silently both-applied) and `subcommand_negates_reqs`
/// (`--config` is required only when no subcommand was named).
#[derive(Debug, Parser)]
#[command(
    name = "gg",
    version,
    about = "The Test Cabinet's first-party coding harness (runs inside the run container)",
    // The struct's rustdoc explains the two invocation shapes to a *reader of the code*; `--help`
    // gets the one-line `about` instead, rather than a page of prose about clap settings.
    long_about = None,
    args_conflicts_with_subcommands = true,
    subcommand_negates_reqs = true
)]
struct Cli {
    /// The named subcommand, or `None` for the bare `gg --config <PATH>` form.
    #[command(subcommand)]
    command: Option<Command>,

    /// Path to the JSON invocation file describing this run (session id, workspace directory, build
    /// prompt, and capability set). See [`config::GgInvocation`].
    //
    // The implied `Command::Run`'s one argument, accepted directly on the top level. The field is
    // `Option` while the *argument* is `required`, and the two are not in tension: clap's
    // `subcommand_negates_reqs` waives the requirement at parse time when a subcommand was named,
    // but the derive still has to build this struct from those matches, and a non-optional field
    // would fail to construct exactly then. So the requirement lives in clap — where it produces
    // the right error for a bare `gg` — and the absence lives in the type.
    #[arg(long, value_name = "PATH", required = true)]
    config: Option<PathBuf>,
}

/// gg's named subcommands.
#[derive(Debug, Subcommand)]
enum Command {
    /// Drive one session to completion from a JSON invocation file. Implied when `gg` is invoked
    /// with `--config` and no subcommand, which is how `core` launches it.
    Run(RunArgs),

    /// Reconstruct a recorded session from its replay record — a debug-only tool that re-runs the
    /// session from its pinned model I/O and tool results, with no live model and no real tools.
    Replay(ReplayArgs),
}

/// Arguments for driving a session: the one JSON invocation file gg reads everything from.
#[derive(Debug, Args)]
struct RunArgs {
    /// Path to the JSON invocation file describing this run (session id, workspace directory, build
    /// prompt, and capability set). See [`config::GgInvocation`].
    #[arg(long, value_name = "PATH")]
    config: PathBuf,
}

/// Arguments for `gg replay`.
///
/// Deliberately the same two flags `tcab gg-replay` takes for a local record, with the same names
/// and the same meanings, because `tcab gg-replay --gg <VERSION>` forwards them straight through to
/// this binary. A rename here is a break there.
#[derive(Debug, Args)]
struct ReplayArgs {
    /// Path to the replay record to reconstruct — plain JSON or gzipped (a run tree's copy is
    /// `replay.json.gz`), in either format version.
    #[arg(long, value_name = "FILE")]
    record: PathBuf,

    /// Optional path to write the reconstructed per-agent step-through list to, as JSON — what a
    /// debugging UI renders. Omit to only stream the reconstructed telemetry and a summary.
    #[arg(long, value_name = "FILE")]
    steps: Option<PathBuf>,
}

/// Parse the `gg` binary's arguments and dispatch, returning the process exit code.
///
/// The turn loop is async (the model client is), so this runs on a single-threaded Tokio runtime. A
/// config-load failure is a **pre-telemetry** fatal reported on stderr (exit `1`); everything after —
/// including a model error mid-session — is reported on the NDJSON telemetry channel, and the exit
/// code only reflects whether a session launched. The thin `src/main.rs` binary simply forwards to
/// this.
#[tokio::main(flavor = "current_thread")]
pub async fn run_from_args() -> ExitCode {
    let cli = Cli::parse();

    match (cli.command, cli.config) {
        // The bare `gg --config <PATH>` form and an explicit `gg run --config <PATH>` are the same
        // invocation; clap's `subcommand_negates_reqs` is what lets the top-level `--config` be
        // required in the first and absent in the second.
        (None, Some(config)) => run_session(&config).await,
        (Some(Command::Run(args)), _) => run_session(&args.config).await,
        (Some(Command::Replay(args)), _) => replay_record(&args),
        // Unreachable: clap requires `--config` when no subcommand was named, and rejects it
        // alongside one. Reported rather than unwrapped so a future change to those two settings
        // surfaces as a message instead of a panic in the run container.
        (None, None) => {
            eprintln!("gg: no invocation file — pass `--config <PATH>`");
            ExitCode::FAILURE
        }
    }
}

/// Drive one session from the invocation file at `config`.
async fn run_session(config: &std::path::Path) -> ExitCode {
    // Load before any telemetry is emitted: the session id (needed to stamp every event) lives in
    // the config, and a malformed config is a pre-telemetry fatal error reported on stderr, not on
    // the NDJSON channel.
    let invocation = match config::load(config) {
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

/// Reconstruct a recorded session from the record at `args.record`.
///
/// Unlike a session, a reconstruction has a meaningful failure: an unreadable record, or one whose
/// walk diverges because the capture never pinned an input a turn consumed. Both exit non-zero, so
/// a delegating `tcab gg-replay --gg <VERSION>` sees the failure rather than a silent success.
fn replay_record(args: &ReplayArgs) -> ExitCode {
    let source = args.record.display().to_string();
    let report = replay_cli::ReplayReport {
        program: "gg replay",
        source: &source,
        steps: args.steps.as_deref(),
    };

    let result = replay_cli::read_record(&args.record).and_then(|record| {
        replay_cli::reconstruct_and_report(record, &report, &mut std::io::stdout())
    });
    match result {
        Ok(_) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("gg replay: {err:#}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
#[path = "lib.test.rs"]
mod tests;
