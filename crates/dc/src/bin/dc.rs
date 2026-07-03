//! The `dc` CLI: the only way a single static dual-contouring asset-generation run
//! makes a mark.
//!
//! The model calls this binary once per operation — `dc add-sphere --cx 8 …` — and
//! each call appends the [`FieldOp`](test_cabinet_voxel_mesh::FieldOp) to the run's
//! `actions.json` and re-composites the **whole** field, re-extracting its surface with
//! dual contouring into a `mesh.json` and re-rendering the preview PNG, so the recorded
//! log is always the single source of truth and the preview always reflects it. The
//! operation subcommands' `--help` is the contract; no operations schema is seeded.
//!
//! See `apps/docs/src/content/docs/testing/asset-generation/`.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use test_cabinet_dc::cli::{self, Config, OpCommand, RenderArgs};

/// The dual-contouring tool for single static-model asset-generation test cases.
#[derive(Parser)]
#[command(
    name = "dc",
    about = "Sculpt a dual-contouring field model one operation at a time."
)]
struct Cli {
    /// Path to the volume config JSON (`{ width, height, depth, background, actions,
    /// preview, mesh }`). Read by `init` and by every field operation.
    #[arg(long, default_value = "dc.config.json", global = true)]
    config: PathBuf,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Initialize the field: write an empty action log and a blank preview so the run
    /// starts from a known, empty state.
    Init,
    /// Regenerate a preview from an action log without modifying it.
    Render(RenderArgs),
    /// Apply one field operation: append it to the action log and re-render the
    /// preview and mesh.
    #[command(flatten)]
    Op(OpCommand),
}

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("dc: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<(), String> {
    match cli.command {
        Command::Init => {
            let config: Config = cli::read_config(&cli.config)?;
            let volume = cli::bounds(config.extents());
            cli::init_target(
                volume,
                config.background()?,
                &config.actions,
                &config.preview,
                &config.mesh,
            )?;
            println!(
                "initialized {}x{}x{} field",
                config.width, config.height, config.depth
            );
            Ok(())
        }
        Command::Render(args) => args.run(),
        Command::Op(op) => {
            let config: Config = cli::read_config(&cli.config)?;
            let volume = cli::bounds(config.extents());
            let field_op = op.into_field_op();
            let name = field_op.name();
            let cli::ApplyResult {
                count,
                image,
                live_body,
            } = cli::apply(
                volume,
                config.background()?,
                &config.actions,
                &config.preview,
                &config.mesh,
                field_op,
            )?;
            // A single static model is part 0. Streaming is best-effort and a no-op
            // when the run has no live viewer (no `live` in the seeded config).
            if let Some(live) = &config.live {
                cli::send_live_preview(
                    &live.endpoint,
                    &live.token,
                    0,
                    name,
                    count,
                    &image,
                    &live_body,
                );
            }
            println!(
                "applied {name} ({count} operation{} recorded)",
                if count == 1 { "" } else { "s" }
            );
            Ok(())
        }
    }
}
