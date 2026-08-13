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
//! gg's own tool definitions and each arm's documentation views into the
//! [contract](test_cabinet_core::gg_reference::GgReference) the console's Reference section
//! renders, so the documentation of what a model is offered is generated from what a model is
//! really offered. `--out` writes the twelve documents — the index and one per program language — as
//! **files a deployment reads at run time**, which is how they reach a backend that cannot depend on
//! this crate at all.
//!
//! Everything else — the model client, the agent turn loop, tool dispatch, and the telemetry
//! emitter — is internal to this crate; the binary is the only public surface.

mod agent;
mod archive;
mod board;
mod bootstrap;
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
    /// parameter schema, and — for each of gg's eleven program languages — the documentation view of
    /// every function and type on that arm, rendered by the very runtime a model's own lookups go
    /// through rather than written a second time.
    ///
    /// It is a subcommand rather than a build script because the backend that serves it cannot
    /// depend on this crate: `oxc` and `tiktoken-rs` are nowhere in that server's tree, and
    /// *building* this crate reflects eleven SDKs' catalogues with eleven language toolchains,
    /// which would become a prerequisite for compiling the backend. With no `--out` it prints the
    /// index document, which is what makes
    /// `gg reference | jq` a way to read the surface from a shell; with `--out` it writes the twelve
    /// documents an image bakes in and a deployment reads at run time.
    ///
    /// Either way it needs nothing but the binary: the arms' signature catalogues are compiled in by
    /// this crate's build script, so a bare static `gg` in a build stage produces the whole surface
    /// with no toolchain, no network and no filesystem to speak of.
    Reference(ReferenceArgs),
}

/// Arguments for projecting the reference.
#[derive(Debug, Args)]
struct ReferenceArgs {
    /// Directory to write the reference documents into: `index.json`, and one `<language>.json` per
    /// program language. Created if it does not exist. Omit to print the index on stdout instead.
    #[arg(long, value_name = "DIR")]
    out: Option<PathBuf>,
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
        (Some(Command::Reference(args)), _) => project_reference(args.out.as_deref()),
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

/// Project the [reference](reference::reference) — onto stdout, or into `out` as twelve files.
///
/// It needs no invocation file, no runtime and no network — everything it projects is compiled into
/// the binary, the tool definitions directly and the eleven signature catalogues through this
/// crate's build script — which is what lets an image-build stage run a freshly built static `gg`
/// and get the same bytes every time.
///
/// **Stdout gets the index alone**, pretty-printed, because a human is the only thing that reads a
/// binary's stdout: `gg reference | jq .tools` is how the tool surface is read from a shell, and
/// eleven arms' worth of documentation views would bury it. The per-arm documents are large enough
/// that the only sensible consumer is a file.
fn project_reference(out: Option<&std::path::Path>) -> ExitCode {
    let Some(directory) = out else {
        return match serde_json::to_string_pretty(&reference::reference()) {
            Ok(json) => {
                println!("{json}");
                ExitCode::SUCCESS
            }
            // Unreachable: the reference is plain data with no map keys but strings and no
            // non-finite numbers. Reported rather than unwrapped so a future field that cannot
            // serialize surfaces as a message instead of a panic.
            Err(err) => {
                eprintln!("gg reference: {err}");
                ExitCode::FAILURE
            }
        };
    };
    match write_reference(directory) {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("gg reference: {err:#}");
            ExitCode::FAILURE
        }
    }
}

/// Write the index and every arm's document into `directory`, creating it if it is not there.
///
/// **Compact rather than pretty**, which is the opposite of what stdout does and for the opposite
/// reason: nothing reads these by eye and nothing diffs them — they are served to a browser — so the
/// whitespace is a megabyte of transfer buying nothing. Every file is named after the thing it
/// carries (`typescript.json`), so the reader that wants one arm opens one file and the reader that
/// wants the list opens `index.json`.
///
/// The names are not spelled here: they come from
/// [`test_cabinet_core::gg_reference`](test_cabinet_core::gg_reference::index_file), which is also
/// where the backend that reads this directory gets them. The two crates never link each other — a
/// filename each of them believed in separately would be a contract nothing in the workspace could
/// check, and the failure would surface as a blank page in a built image.
///
/// Written one at a time with the index **last**, so a directory that exists at all is a directory
/// whose index does not promise an arm that is not beside it.
fn write_reference(directory: &std::path::Path) -> Result<(), ReferenceWriteError> {
    std::fs::create_dir_all(directory).map_err(|source| ReferenceWriteError {
        path: directory.to_path_buf(),
        source,
    })?;
    for language in test_cabinet_core::gg::GgProgramLanguage::ALL {
        let document = reference::reference_api(*language);
        write_json(
            &directory.join(test_cabinet_core::gg_reference::document_file(*language)),
            &document,
        )?;
    }
    write_json(
        &directory.join(test_cabinet_core::gg_reference::index_file()),
        &reference::reference(),
    )
}

/// A filesystem failure while writing the reference, **carrying the path it was attempting**.
///
/// `std::io::Error` does not, and a bare `Permission denied (os error 13)` in the `RUN` line of an
/// image build or the release workflow leaves an operator with no way to tell which of thirteen
/// paths was refused. The endpoint that serves these documents goes to some trouble to name the
/// directory it searched when they are missing; the command that writes them should not be less
/// specific about not writing them.
#[derive(Debug, thiserror::Error)]
#[error("{path}: {source}")]
struct ReferenceWriteError {
    /// The file or directory the failed call was operating on.
    path: PathBuf,
    /// The underlying filesystem (or serialization) error.
    source: std::io::Error,
}

/// One document, serialized compactly onto `path`.
fn write_json<T: serde::Serialize>(
    path: &std::path::Path,
    document: &T,
) -> Result<(), ReferenceWriteError> {
    let failure = |source: std::io::Error| ReferenceWriteError {
        path: path.to_path_buf(),
        source,
    };
    // A serialization failure is unreachable for the same reason it is on the stdout path, and is
    // mapped into the io error the caller reports rather than unwrapped, so `gg reference --out`
    // has exactly one failure channel.
    let json = serde_json::to_vec(document).map_err(|err| failure(err.into()))?;
    std::fs::write(path, json).map_err(failure)
}

#[cfg(test)]
#[path = "lib.test.rs"]
mod tests;
