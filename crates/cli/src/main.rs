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
    let cli = Cli::parse();

    match cli.command {
        Command::Run(args) => commands::run::execute(args).await,
        Command::Validate(args) => commands::validate::execute(args).await,
        Command::Publish(args) => commands::publish::execute(args).await,
        Command::Harnesses(args) => commands::harnesses::execute(args).await,
        Command::Seed(args) => commands::seed::execute(args).await,
    }
}
