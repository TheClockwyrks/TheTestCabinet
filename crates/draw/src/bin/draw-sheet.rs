//! The `draw-sheet` CLI: drawing a sprite **sheet**, one frame at a time.
//!
//! This binary extends [`draw`](../draw.rs) with a required `--frame <index>`:
//! the drawing operations and how each rasterizes are **identical**, but each
//! frame is a **completely separate file** — its own action log and preview,
//! never a region of one shared image. The model declares which frame an
//! operation targets, and the binary appends to that frame's log and re-renders
//! that frame's preview. After the run, `crates/core` regenerates and scores each
//! frame independently from its own log.
//!
//! The operation subcommands are shared with `draw`, so their `--help` is the
//! same contract; no operations schema is seeded.
//!
//! See `apps/docs/src/content/docs/testing/asset-generation/`.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use test_cabinet_draw::cli::{self, OpCommand, RenderArgs, SheetConfig};

/// The drawing tool for sprite-sheet asset-generation test cases.
#[derive(Parser)]
#[command(
    name = "draw-sheet",
    about = "Draw a sprite sheet, one frame and one operation at a time."
)]
struct Cli {
    /// Path to the sheet config JSON (`{ width, height, background, frames,
    /// actions, preview }`). Read by `init` and by every drawing operation.
    #[arg(long, default_value = "draw.config.json", global = true)]
    config: PathBuf,
    /// Which frame to draw into. **Required** for a drawing operation; each frame
    /// is its own separate image.
    #[arg(long, global = true)]
    frame: Option<u32>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Initialize every declared frame: write an empty action log and a blank
    /// preview per frame so the run starts from a known, empty state.
    Init,
    /// Regenerate an image from an action log without modifying it.
    Render(RenderArgs),
    /// Apply one drawing operation to the `--frame`: append it to that frame's
    /// action log and re-render that frame's preview.
    #[command(flatten)]
    Op(OpCommand),
}

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("draw-sheet: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<(), String> {
    match cli.command {
        Command::Init => {
            let config: SheetConfig = cli::read_config(&cli.config)?;
            let canvas = config.canvas()?;
            for frame in &config.frames {
                cli::init_canvas(
                    &canvas,
                    &config.actions_for(*frame),
                    &config.preview_for(*frame),
                )?;
            }
            println!(
                "initialized {} frame{} of {}x{}",
                config.frames.len(),
                if config.frames.len() == 1 { "" } else { "s" },
                canvas.width,
                canvas.height
            );
            Ok(())
        }
        Command::Render(args) => args.run(),
        Command::Op(op) => {
            let frame = cli
                .frame
                .ok_or_else(|| "a drawing operation requires --frame <index>".to_string())?;
            let config: SheetConfig = cli::read_config(&cli.config)?;
            if !config.has_frame(frame) {
                return Err(format!(
                    "frame {frame} is not a declared frame (declared: {:?})",
                    config.frames
                ));
            }
            let canvas = config.canvas()?;
            let name = op.name();
            let (count, image) = cli::apply(
                &canvas,
                &config.actions_for(frame),
                &config.preview_for(frame),
                op.into_operation(),
            )?;
            // Stream this frame's re-rendered image to the live viewer, keyed by
            // its frame index. Best-effort; a no-op for an unobserved run.
            if let Some(live) = &config.live {
                cli::send_live_preview(live, frame, name, count, &image);
            }
            println!(
                "applied {name} to frame {frame} ({count} operation{} recorded)",
                if count == 1 { "" } else { "s" }
            );
            Ok(())
        }
    }
}
