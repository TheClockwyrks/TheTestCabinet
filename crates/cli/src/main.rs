//! `tcab` — the command line interface for The Test Cabinet.
//!
//! The CLI is a thin shell over [`test_cabinet_core`]. The core owns all
//! orchestration (resolving a test case version, seeding a repository, executing
//! a run in a container, invoking the agent harness, collecting metrics, running
//! validation, writing the run record, and publishing). The CLI exists so those
//! capabilities can be scripted and so benchmark sweeps can be run in batch
//! without a person driving the desktop interface. See `docs/application.md`.
//!
//! Every subcommand here is a buildable stub: it parses its arguments faithfully
//! and routes to a handler that calls into the core where the surface already
//! exists and otherwise reports that the behavior is not implemented yet.

mod cli;
mod commands;
mod config;

use clap::Parser;
use tracing::Instrument;

use crate::cli::{Cli, Command};

/// Entry point. Async because orchestration in the core is async.
///
/// Telemetry is initialized after the dotenv load so any OTLP configuration that
/// lives in `.env.runner` is visible, and the returned guard is bound for the
/// whole of `main` so its `Drop` force-flushes buffered telemetry before the
/// short-lived process exits. For that flush to run we always return from `main`
/// rather than calling [`std::process::exit`], which would skip the guard's
/// destructor and lose any buffered spans, metrics, and logs.
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    load_dotenv()?;

    let _telemetry = test_cabinet_telemetry::init(test_cabinet_telemetry::Config::new(
        "tcab-cli",
        env!("CARGO_PKG_VERSION"),
        "info,test_cabinet_cli=info",
    ))?;

    let cli = Cli::parse();

    // Give the whole invocation a single root span named after the subcommand so
    // a `tcab` run is one trace; the core adds the deeper spans beneath it.
    let span = tracing::info_span!("tcab", command = command_name(&cli.command));

    dispatch(cli.command).instrument(span).await
}

/// Route a parsed subcommand to its handler.
async fn dispatch(command: Command) -> anyhow::Result<()> {
    match command {
        Command::Run(args) => commands::run::execute(args).await,
        Command::Validate(args) => commands::validate::execute(args).await,
        Command::Register(args) => commands::auth::register(args).await,
        Command::Login(args) => commands::auth::login(args).await,
        Command::Logout => commands::auth::logout().await,
        Command::Review(args) => commands::publish::review(args).await,
        Command::Publish(args) => commands::publish::publish(args).await,
        Command::Harnesses(args) => commands::harnesses::execute(args).await,
        Command::Orchestrators(args) => commands::orchestrators::execute(args).await,
        Command::Seed(args) => commands::seed::execute(args).await,
        Command::Prompt(args) => commands::prompt::execute(args).await,
    }
}

/// The static subcommand name used to label the invocation's root span.
fn command_name(command: &Command) -> &'static str {
    match command {
        Command::Run(_) => "run",
        Command::Validate(_) => "validate",
        Command::Register(_) => "register",
        Command::Login(_) => "login",
        Command::Logout => "logout",
        Command::Review(_) => "review",
        Command::Publish(_) => "publish",
        Command::Harnesses(_) => "harnesses",
        Command::Orchestrators(_) => "orchestrators",
        Command::Seed(_) => "seed",
        Command::Prompt(_) => "prompt",
    }
}

/// Load environment variables from the runner env file before any command runs.
///
/// Harnesses authenticate with an API key read from the host environment (for
/// example `ANTHROPIC_API_KEY`); loading `.env.runner` here lets those keys live
/// in a file alongside the project rather than being exported into every shell.
/// `dotenvy` searches the working directory and its parents and does **not**
/// override variables already set in the environment, so an explicitly exported
/// key still takes precedence over the file.
///
/// `.env.runner` is loaded first; a legacy `.env` is then loaded as a
/// back-compat fallback (it cannot override anything `.env.runner` already set).
/// A missing file is not an error — running with keys exported the old way is
/// fully supported. Any other failure (an unreadable or malformed file) is
/// surfaced so a typo in the file is not silently ignored.
fn load_dotenv() -> anyhow::Result<()> {
    load_env_file(dotenvy::from_filename(".env.runner"))?;
    load_env_file(dotenvy::dotenv())?;
    Ok(())
}

/// Treat a missing file as fine; surface any other dotenvy error.
fn load_env_file(result: dotenvy::Result<std::path::PathBuf>) -> anyhow::Result<()> {
    match result {
        Ok(_) => Ok(()),
        Err(err) if err.not_found() => Ok(()),
        Err(err) => Err(anyhow::Error::new(err).context("failed to load env file")),
    }
}
