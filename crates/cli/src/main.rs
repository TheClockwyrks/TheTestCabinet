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

use clap::Parser;

use crate::cli::{Cli, Command};

/// Entry point. Async because orchestration in the core is async.
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    load_dotenv()?;

    let cli = Cli::parse();

    match cli.command {
        Command::Run(args) => commands::run::execute(args).await,
        Command::Validate(args) => commands::validate::execute(args).await,
        Command::Publish(args) => commands::publish::execute(args).await,
        Command::Harnesses(args) => commands::harnesses::execute(args).await,
        Command::Seed(args) => commands::seed::execute(args).await,
        Command::Catalog(args) => commands::catalog::execute(args).await,
    }
}

/// Load environment variables from a `.env` file before any command runs.
///
/// Harnesses authenticate with an API key read from the host environment (for
/// example `ANTHROPIC_API_KEY`); loading a `.env` here lets those keys live in a
/// file alongside the project rather than being exported into every shell.
/// `dotenvy` searches the working directory and its parents and does **not**
/// override variables already set in the environment, so an explicitly exported
/// key still takes precedence over the file.
///
/// A missing `.env` is not an error — running with keys exported the old way is
/// fully supported. Any other failure (an unreadable or malformed file) is
/// surfaced so a typo in the file is not silently ignored.
fn load_dotenv() -> anyhow::Result<()> {
    match dotenvy::dotenv() {
        Ok(_) => Ok(()),
        Err(err) if err.not_found() => Ok(()),
        Err(err) => Err(anyhow::Error::new(err).context("failed to load .env file")),
    }
}
