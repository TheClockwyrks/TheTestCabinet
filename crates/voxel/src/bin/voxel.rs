//! The `voxel` CLI: the only way a single static-model asset-generation run makes
//! a mark.
//!
//! The model calls this binary once per operation — `voxel fill-box --x 4 …` — and
//! each call appends the operation to the run's `actions.json` and re-renders the
//! isometric preview image from the **whole** log, so the recorded log is always
//! the single source of truth and the preview always reflects it. After the run,
//! `crates/core` regenerates the scored voxel data and image from that same log
//! through the same [`test_cabinet_voxel`] library — so a volume produced any other
//! way cannot match. The operation subcommands' `--help` is the contract; no
//! operations schema is seeded. This binary does **not** write `voxels.json`; the
//! validator regenerates that from the log.
//!
//! See `apps/docs/src/content/docs/testing/asset-generation/`.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use test_cabinet_voxel::cli::{self, Config, OpCommand, RenderArgs};

/// The sculpting tool for single static-model asset-generation test cases.
#[derive(Parser)]
#[command(
    name = "voxel",
    about = "Sculpt a voxel model one operation at a time."
)]
struct Cli {
    /// Path to the volume config JSON (`{ width, height, depth, background,
    /// actions, preview }`). Read by `init` and by every sculpting operation.
    #[arg(long, default_value = "voxel.config.json", global = true)]
    config: PathBuf,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Initialize the volume: write an empty action log and a blank preview so the
    /// run starts from a known, empty state.
    Init,
    /// Regenerate a preview from an action log without modifying it.
    Render(RenderArgs),
    /// Apply one sculpting operation: append it to the action log and re-render the
    /// preview.
    #[command(flatten)]
    Op(OpCommand),
}

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("voxel: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<(), String> {
    match cli.command {
        Command::Init => {
            let config: Config = cli::read_config(&cli.config)?;
            let dims = config.dims();
            cli::init_target(
                &dims,
                config.background()?,
                &config.actions,
                &config.preview,
            )?;
            println!(
                "initialized {}x{}x{} volume",
                dims.width, dims.height, dims.depth
            );
            Ok(())
        }
        Command::Render(args) => args.run(),
        Command::Op(op) => {
            let config: Config = cli::read_config(&cli.config)?;
            let dims = config.dims();
            let name = op.name();
            let cli::ApplyResult {
                count,
                image,
                voxels,
            } = cli::apply(
                &dims,
                config.background()?,
                &config.actions,
                &config.preview,
                op.into_operation(),
            )?;
            // A single static model is part 0. Streaming is best-effort and a no-op
            // when the run has no live viewer (no `live` in the seeded config).
            if let Some(live) = &config.live {
                cli::send_live_preview(live, 0, name, count, &image, &voxels);
            }
            println!(
                "applied {name} ({count} operation{} recorded)",
                if count == 1 { "" } else { "s" }
            );
            Ok(())
        }
    }
}
