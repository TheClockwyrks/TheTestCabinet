//! The `test-cabinet-gg` crate — The Test Cabinet's own first-party coding harness.
//!
//! This library backs one entrypoint: the [`gg` binary](run_from_args) (`src/main.rs`), invoked
//! **directly** by The Test Cabinet's `core` **inside the run container** with a single JSON
//! invocation file — it drives a
//! [`GgCapabilitySet`](test_cabinet_core::gg::GgCapabilitySet)-configured session to a produced,
//! scoreable artifact while streaming a first-party
//! [`GgTelemetryEvent`](test_cabinet_core::gg::GgTelemetryEvent) stream on stdout.
//!
//! Alongside the session it writes a **capture journal** — the append-only NDJSON stream
//! that lets a run which *hangs* or *outruns its cap* still be explained. A hung container is torn
//! down without its tree ever being collected, so the journal is copied out
//! [before teardown](test_cabinet_core::salvage) and assembled into the run tree's session record.
//! Capture is the reason the journal exists and the only reason it exists.
//!
//! The binary carries one further subcommand that runs nothing at all: `gg reference` projects
//! gg's own tool definitions and its responses-as-code signature catalogue into the
//! [contract](test_cabinet_core::gg_reference::GgReference) the console's Reference section
//! renders, so the documentation of what a model is offered is generated from what a model is
//! really offered. It reaches the crate only through the binary — the projection itself stays
//! internal — because the artifact is generated and **committed**, and the backend that serves it
//! cannot depend on this crate at all.
//!
//! Everything else — the model client, the agent turn loop, tool dispatch, and the telemetry
//! emitter — is internal to this crate; the binary is the only public surface.

mod agent;
mod archive;
mod board;
mod cancel;
mod capture;
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
mod hooks;
mod knowledge;
mod limits;
mod loopguard;
mod memories;
mod message_log;
mod model;
mod modules;
mod persistence;
mod programs;
mod prompts;
mod reference;
mod sandbox;
mod search;
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
/// - **`gg <SUBCOMMAND>`** for everything else. Today that is [`Command::Reference`], which prints
///   what gg offers a model so the console can serve it without the backend depending on this
///   crate.
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

    /// Print the tool and responses-as-code API reference gg offers models, as JSON.
    ///
    /// The artifact behind the console's **Reference** section: every tool's real description and
    /// parameter schema, and every API function's real signature and documentation, projected from
    /// gg's own definitions rather than written a second time.
    ///
    /// It is a subcommand rather than a build script because the backend that serves it cannot
    /// depend on this crate (`wasmtime`, `oxc` and `tiktoken-rs` do not go where a static musl
    /// backend goes). `scripts/gen-contract.mjs` runs this and commits the output as
    /// `crates/backend/src/gg_reference.json`, and CI's contract-drift gate regenerates and diffs
    /// it — the same generate-and-commit shape each program language's committed
    /// `crates/gg/src/sandbox/guests/<language>.signatures.json` already uses.
    Reference,
}

/// Arguments for driving a session: the one JSON invocation file gg reads everything from.
#[derive(Debug, Args)]
struct RunArgs {
    /// Path to the JSON invocation file describing this run (session id, workspace directory, build
    /// prompt, and capability set). See [`config::GgInvocation`].
    #[arg(long, value_name = "PATH")]
    config: PathBuf,
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
        (Some(Command::Reference), _) => print_reference(),
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

/// Print the [reference](reference::reference) to stdout as pretty JSON.
///
/// It needs no invocation file, no runtime and no network — everything it prints is either
/// compiled into the binary or a committed artifact beside it — which is what lets the contract
/// generator run a freshly built `gg` in a clean checkout and get the same bytes every time.
///
/// Pretty-printed rather than compact because the output is **committed**: a one-line JSON blob
/// would make every regeneration a single unreadable diff line, and the file is later normalized by
/// the same Prettier pass the rest of the generated contract goes through.
fn print_reference() -> ExitCode {
    match serde_json::to_string_pretty(&reference::reference()) {
        Ok(json) => {
            println!("{json}");
            ExitCode::SUCCESS
        }
        // Unreachable: the reference is plain data with no map keys but strings and no non-finite
        // numbers. Reported rather than unwrapped so a future field that cannot serialize surfaces
        // as a message instead of a panic.
        Err(err) => {
            eprintln!("gg reference: {err}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
#[path = "lib.test.rs"]
mod tests;
