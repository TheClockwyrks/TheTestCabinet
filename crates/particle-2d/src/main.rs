//! The `particle-2d` CLI: authoring a planar particle effect (emitters, forces,
//! per-particle curves) a live simulation plays.
//!
//! A thin wrapper over `test_cabinet_particle_core`: it wires the shared authoring
//! [`Command`] vocabulary to the seeded `particle-2d.config.json` and runs it in
//! [`Dimensionality::D2`], so the effect is strictly planar (`z` inputs are rejected).
//! The preview composites in the crate's 2D raster path; `render` emits `system.json`.
//! See `apps/docs/src/content/docs/testing/asset-generation/particle-binaries.md`.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;

use test_cabinet_particle_core::command::Command;
use test_cabinet_particle_core::config::read_config;
use test_cabinet_particle_core::{Dimensionality, ParticleConfig};

/// The 2D particle-effect tool for particle asset-generation cases.
#[derive(Parser)]
#[command(
    name = "particle-2d",
    about = "Author a 2D particle effect, one operation at a time."
)]
struct Cli {
    /// Path to the seeded config JSON (field dimensions, duration and playback fps,
    /// and the log / preview / `system.json` paths, plus an optional `live` block).
    #[arg(long, default_value = "particle-2d.config.json", global = true)]
    config: PathBuf,
    #[command(subcommand)]
    command: Command,
}

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("particle-2d: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<(), String> {
    let config: ParticleConfig = read_config(&cli.config)?;
    cli.command.run(&config, Dimensionality::D2)
}
