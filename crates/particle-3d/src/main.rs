//! The `particle-3d` CLI: authoring a volumetric particle effect (emitters, forces,
//! per-particle curves) a live simulation plays.
//!
//! A thin wrapper over `test_cabinet_particle_core`: it wires the shared authoring
//! [`Command`] vocabulary to the seeded `particle-3d.config.json` and runs it in
//! [`Dimensionality::D3`], carrying the full `x`/`y`/`z` space. The preview billboards
//! each particle through `model-core`'s `wgpu` + Mesa renderer from an orbit camera;
//! `render` emits `system.json`. See
//! `apps/docs/src/content/docs/testing/asset-generation/particle-binaries.md`.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;

use test_cabinet_particle_core::command::Command;
use test_cabinet_particle_core::config::read_config;
use test_cabinet_particle_core::{Dimensionality, ParticleConfig};

/// The 3D particle-effect tool for particle asset-generation cases.
#[derive(Parser)]
#[command(name = "particle-3d", about = "Author a 3D particle effect, one operation at a time.")]
struct Cli {
    /// Path to the seeded config JSON (volume dimensions, duration and playback fps,
    /// and the log / preview / `system.json` paths, plus an optional `live` block).
    #[arg(long, default_value = "particle-3d.config.json", global = true)]
    config: PathBuf,
    #[command(subcommand)]
    command: Command,
}

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("particle-3d: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<(), String> {
    let config: ParticleConfig = read_config(&cli.config)?;
    cli.command.run(&config, Dimensionality::D3)
}
