//! `tcab` — the command line interface for The Test Cabinet.
//!
//! The CLI operates on definitions: it validates a tree, analyzes its code, captures and
//! publishes a case's references, ingests definitions into a backend, and inspects what a
//! run would seed and prompt. It is a thin shell over the run engine in
//! [`test_cabinet_driver`]'s library, which owns the resolution, seeding, validation and
//! analysis it reuses. A run is launched from the console and executed by a driver; the
//! CLI launches nothing. See
//! <https://docs.testcabinet.ai/components/cli/overview/>.

mod catalog;
mod cli;
mod commands;
mod config;

use std::process::ExitCode;

use clap::Parser;
use tracing::Instrument;

use crate::cli::{Cli, Command};

/// Entry point. Async because the run engine and the backend client it reuses are async.
///
/// Telemetry is initialized after the dotenv load so any OTLP configuration that
/// lives in `.env.runner` is visible, and the returned guard is bound for the
/// whole of `main` so its `Drop` force-flushes buffered telemetry before the
/// short-lived process exits. For that flush to run we always return from `main`
/// rather than calling [`std::process::exit`], which would skip the guard's
/// destructor and lose any buffered spans, metrics, and logs.
///
/// Returning an [`ExitCode`] rather than `()` is what lets a subcommand whose *result* is a verdict
/// report it through the process status without reaching for `std::process::exit` and losing that
/// flush.
#[tokio::main]
async fn main() -> anyhow::Result<ExitCode> {
    load_dotenv()?;

    // Logs go to standard error, not standard output: `tcab` is a command line tool whose
    // stdout is data — a prompt, an analysis document — and a log line
    // interleaved into `tcab analyze --json | jq` makes that data unparseable. The services
    // keep logging to stdout, where a collector reads both streams alike.
    let _telemetry = test_cabinet_telemetry::init(
        test_cabinet_telemetry::Config::new(
            "tcab-cli",
            env!("CARGO_PKG_VERSION"),
            "info,test_cabinet_cli=info",
        )
        .with_stderr_logging(),
    )?;

    let cli = Cli::parse();

    // Give the whole invocation a single root span named after the subcommand so
    // a `tcab` run is one trace; the run engine adds the deeper spans beneath it.
    let span = tracing::info_span!("tcab", command = command_name(&cli.command));

    dispatch(cli.command).instrument(span).await
}

/// Route a parsed subcommand to its handler.
///
/// A handler reports an error for anything that stopped it from doing its job, and an
/// error always exits non-zero. Most subcommands have nothing further to say, so
/// having run is having succeeded and they exit `0`.
///
/// A subcommand whose *result* is a verdict returns its own [`ExitCode`] instead.
/// `validate` is the case: resolving a case, driving a browser and running a build all
/// succeeding says only that the pass happened, while whether the tree passed is a
/// separate answer that belongs in the process status so a script or a CI step reads
/// it without parsing the log.
async fn dispatch(command: Command) -> anyhow::Result<ExitCode> {
    match command {
        Command::Validate(args) => return commands::validate::execute(args).await,
        Command::Seed(args) => commands::seed::execute(args).await?,
        Command::Prompt(args) => commands::prompt::execute(args).await?,
        Command::PublishReference(args) => commands::publish_reference::execute(args).await?,
        Command::PublishAssetReference(args) => {
            commands::publish_asset_reference::execute(args).await?
        }
        Command::CaptureBaselines(args) => commands::capture_baselines::execute(args).await?,
        Command::Ingest(args) => commands::ingest::execute(args).await?,
        Command::Analyze(args) => commands::analyze::execute(args).await?,
    }
    Ok(ExitCode::SUCCESS)
}

/// The static subcommand name used to label the invocation's root span.
fn command_name(command: &Command) -> &'static str {
    match command {
        Command::Validate(_) => "validate",
        Command::Seed(_) => "seed",
        Command::Prompt(_) => "prompt",
        Command::PublishReference(_) => "publish-reference",
        Command::PublishAssetReference(_) => "publish-asset-reference",
        Command::CaptureBaselines(_) => "capture-baselines",
        Command::Ingest(_) => "ingest",
        Command::Analyze(_) => "analyze",
    }
}

/// Load environment variables from the runner env file before any command runs.
///
/// The CLI reads its configuration from the environment: the backend URL and its
/// service token, the Access credential a deployed environment's edge takes, the
/// cold-storage root and the telemetry exporter. Loading `.env.runner` here lets those
/// live in a file alongside the project rather than being exported into every shell.
/// `dotenvy` searches the working directory and its parents and does **not**
/// override variables already set in the environment, so an explicitly exported
/// value still takes precedence over the file.
///
/// `.env.runner` is loaded first; a legacy `.env` is then loaded as a
/// back-compat fallback (it cannot override anything `.env.runner` already set).
/// A missing file is not an error — running with the variables exported is fully
/// supported. Any other failure (an unreadable or malformed file) is
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
