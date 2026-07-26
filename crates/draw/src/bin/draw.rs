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
//! An operation carrying `--layer <name>` paints onto a registered
//! [layer](test_cabinet_draw::layer) instead of the canvas: a separately placed
//! surface recorded in `layers.json` and composited over the canvas log. `draw`
//! has no keyframes — a single sprite has no frames to animate over — but layers
//! still let a sprite be built from pieces that can be moved and restyled
//! independently. `draw-sheet` adds the animation commands.
//!
//! See `apps/docs/src/content/docs/testing/asset-generation/`.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use test_cabinet_draw::cli::{self, Config, LayerCommand, OpCommand, RenderArgs};

/// The drawing tool for single-sprite asset-generation test cases.
#[derive(Parser)]
#[command(name = "draw", about = "Draw a sprite one operation at a time.")]
struct Cli {
    /// Path to the canvas config JSON (`{ width, height, background, actions,
    /// preview, layers }`). Read by `init` and by every drawing operation.
    #[arg(long, default_value = "draw.config.json", global = true)]
    config: PathBuf,
    /// Paint into this registered layer instead of onto the canvas. Coordinates
    /// become layer-local. Register it first with `register-layer`.
    #[arg(long, global = true)]
    layer: Option<String>,
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
    /// Register, inspect, or remove a layer.
    #[command(flatten)]
    Layer(LayerCommand),
    /// Apply one drawing operation: append it to the action log — or, with
    /// `--layer`, to that layer — and re-render the preview.
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
            cli::write_document(&config.layers, &Default::default())?;
            println!("initialized {}x{} canvas", canvas.width, canvas.height);
            Ok(())
        }
        Command::Render(args) => args.run(0),
        Command::Layer(command) => {
            let config: Config = cli::read_config(&cli.config)?;
            let canvas = config.canvas()?;
            let mut document = cli::read_document(&config.layers)?;

            // `list-layers` only reports, so it neither writes the document nor
            // re-renders; everything else changes what the canvas composites.
            if matches!(command, LayerCommand::ListLayers) {
                println!("{}", cli::layers::describe(&document.layers));
                return Ok(());
            }

            let summary = cli::layers::apply(&mut document, command)?;
            cli::write_document(&config.layers, &document)?;
            let image =
                cli::refresh_preview(&canvas, &config.actions, &config.preview, &document, 0)?;
            if let Some(live) = &config.live {
                cli::send_live_preview(live, 0, "layer", document.layers.len(), &image);
            }
            println!("{summary}");
            Ok(())
        }
        Command::Op(op) => {
            let config: Config = cli::read_config(&cli.config)?;
            let canvas = config.canvas()?;
            let name = op.name();
            let mut document = cli::read_document(&config.layers)?;

            let (count, image) = match &cli.layer {
                // A layer operation paints the layer's own surface, so the
                // document is what changes; the canvas is then re-rendered with
                // the updated layer composited over the untouched action log.
                Some(target) => {
                    let count = cli::apply_to_layer(&mut document, target, op.into_operation())?;
                    cli::write_document(&config.layers, &document)?;
                    let image = cli::refresh_preview(
                        &canvas,
                        &config.actions,
                        &config.preview,
                        &document,
                        0,
                    )?;
                    (count, image)
                }
                None => cli::apply(
                    &canvas,
                    &config.actions,
                    &config.preview,
                    &document,
                    0,
                    op.into_operation(),
                )?,
            };

            // A single sprite is frame 0. Streaming is best-effort and a no-op
            // when the run has no live viewer (no `live` in the seeded config).
            if let Some(live) = &config.live {
                cli::send_live_preview(live, 0, name, count, &image);
            }
            match &cli.layer {
                Some(target) => println!(
                    "applied {name} to layer {target} ({count} operation{} on it)",
                    if count == 1 { "" } else { "s" }
                ),
                None => println!(
                    "applied {name} ({count} operation{} recorded)",
                    if count == 1 { "" } else { "s" }
                ),
            }
            Ok(())
        }
    }
}
