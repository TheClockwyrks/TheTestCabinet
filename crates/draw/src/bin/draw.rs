//! The `draw` CLI: the only way a single-sprite asset-generation run makes a mark.
//!
//! The model calls this binary once per operation — `draw fill-rect --x 28 …` —
//! and each call appends the operation to the run's `actions.json` and re-renders
//! the preview image from the **whole** log, so the recorded log is always the
//! single source of truth and the preview always reflects it. After the run,
//! `crates/core` regenerates the scored image from that same log through the same
//! [`test_cabinet_draw`] library — so an image produced any other way cannot
//! match. The operation subcommands' `--help` is the contract; no operations
//! schema is seeded.
//!
//! See `apps/docs/src/content/docs/testing/asset-generation/`.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use test_cabinet_draw::cli::{self, Config, OpCommand, RenderArgs};

/// The drawing tool for single-sprite asset-generation test cases.
#[derive(Parser)]
#[command(name = "draw", about = "Draw a sprite one operation at a time.")]
struct Cli {
    /// Path to the canvas config JSON (`{ width, height, background, actions,
    /// preview }`). Read by `init` and by every drawing operation.
    #[arg(long, default_value = "draw.config.json", global = true)]
    config: PathBuf,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Initialize the canvas: write an empty action log and a blank preview so
    /// the run starts from a known, empty state.
    Init,
    /// Regenerate an image from an action log without modifying it.
    Render(RenderArgs),
    /// Apply one drawing operation: append it to the action log and re-render the
    /// preview.
    #[command(flatten)]
    Op(OpCommand),
}

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("draw: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<(), String> {
    match cli.command {
        Command::Init => {
            let config: Config = cli::read_config(&cli.config)?;
            let canvas = config.canvas()?;
            cli::init_canvas(&canvas, &config.actions, &config.preview)?;
            println!("initialized {}x{} canvas", canvas.width, canvas.height);
            Ok(())
        }
        Command::Render(args) => args.run(),
        Command::Op(op) => {
            let config: Config = cli::read_config(&cli.config)?;
            let canvas = config.canvas()?;
            let name = op.name();
            let count = cli::apply(
                &canvas,
                &config.actions,
                &config.preview,
                op.into_operation(),
            )?;
            println!(
                "applied {name} ({count} operation{} recorded)",
                if count == 1 { "" } else { "s" }
            );
            Ok(())
        }
    }
}
