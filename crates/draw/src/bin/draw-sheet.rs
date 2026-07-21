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
//! [Layers](test_cabinet_draw::layer) are the exception to all of that, and the
//! reason they exist: a layer is **sheet-wide**, painted once into `layers.json`
//! and placed on every frame by a transform that [keyframes](test_cabinet_draw::curve)
//! can animate. So a layer operation takes no `--frame` (it applies to all of
//! them) and changing a layer re-renders every frame's preview. Motion that is
//! painful to hand-place frame by frame — an arc, an overshoot, a spin — is
//! expressed as a curve instead.
//!
//! The operation subcommands are shared with `draw`, so their `--help` is the
//! same contract; no operations schema is seeded.
//!
//! See `apps/docs/src/content/docs/testing/asset-generation/`.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use test_cabinet_draw::Document;
use test_cabinet_draw::cli::{
    self, AnimateArgs, ClearKeyframesArgs, LayerCommand, OpCommand, RenderArgs, SheetConfig,
};

/// The drawing tool for sprite-sheet asset-generation test cases.
#[derive(Parser)]
#[command(
    name = "draw-sheet",
    about = "Draw a sprite sheet, one frame and one operation at a time."
)]
struct Cli {
    /// Path to the sheet config JSON (`{ width, height, background, frames,
    /// actions, preview, layers }`). Read by `init` and by every drawing operation.
    #[arg(long, default_value = "draw.config.json", global = true)]
    config: PathBuf,
    /// Which frame to draw into. **Required** for a drawing operation; each frame
    /// is its own separate image. Not used with `--layer`: a layer is sheet-wide.
    #[arg(long, global = true)]
    frame: Option<u32>,
    /// Paint into this registered layer instead of into a frame. Coordinates become
    /// layer-local, and the content appears in **every** frame at whatever
    /// transform that frame's keyframes resolve to.
    #[arg(long, global = true)]
    layer: Option<String>,
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
    /// Register, inspect, or remove a layer.
    #[command(flatten)]
    Layer(LayerCommand),
    /// Add or replace a keyframe on one of a layer's transform properties, so the
    /// layer moves, fades, spins, or scales across the sheet's frames.
    AnimateLayer(AnimateArgs),
    /// Drop keyframes from a layer, returning those properties to the resting
    /// values `register-layer` gave them.
    ClearKeyframes(ClearKeyframesArgs),
    /// Apply one drawing operation to the `--frame` — or, with `--layer`, to that
    /// layer — and re-render the affected preview(s).
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
            cli::write_document(&config.layers, &Document::new())?;
            println!(
                "initialized {} frame{} of {}x{}",
                config.frames.len(),
                if config.frames.len() == 1 { "" } else { "s" },
                canvas.width,
                canvas.height
            );
            Ok(())
        }
        Command::Render(args) => args.run(cli.frame.unwrap_or(0)),
        Command::Layer(command) => {
            let config: SheetConfig = cli::read_config(&cli.config)?;
            let mut document = cli::read_document(&config.layers)?;
            // `list-layers` only reports, so it writes nothing and re-renders
            // nothing; every other layer command changes what all frames composite.
            if matches!(command, LayerCommand::ListLayers) {
                println!("{}", cli::layers::describe(&document.layers));
                return Ok(());
            }
            let summary = cli::layers::apply(&mut document, command)?;
            commit(&config, &document, &summary)
        }
        Command::AnimateLayer(args) => {
            let config: SheetConfig = cli::read_config(&cli.config)?;
            let mut document = cli::read_document(&config.layers)?;
            if !config.has_frame(args.frame) {
                return Err(undeclared_frame(args.frame, &config.frames));
            }
            let summary = cli::layers::animate(&mut document, &args)?;
            commit(&config, &document, &summary)
        }
        Command::ClearKeyframes(args) => {
            let config: SheetConfig = cli::read_config(&cli.config)?;
            let mut document = cli::read_document(&config.layers)?;
            let summary = cli::layers::clear_keyframes(&mut document, &args)?;
            commit(&config, &document, &summary)
        }
        Command::Op(op) => {
            let config: SheetConfig = cli::read_config(&cli.config)?;
            let mut document = cli::read_document(&config.layers)?;
            let name = op.name();

            match &cli.layer {
                // A layer is sheet-wide, so this paints once and every frame
                // changes. `--frame` is meaningless here and is refused rather
                // than silently ignored, so a model that expected a per-frame
                // edit finds out immediately.
                Some(target) => {
                    if cli.frame.is_some() {
                        return Err(
                            "a --layer operation takes no --frame: a layer is shared by every \
                             frame, and its keyframes decide where it sits on each one"
                                .to_string(),
                        );
                    }
                    let count = cli::apply_to_layer(&mut document, target, op.into_operation())?;
                    commit(
                        &config,
                        &document,
                        &format!(
                            "applied {name} to layer {target} ({count} operation{} on it, \
                             across {} frames)",
                            if count == 1 { "" } else { "s" },
                            config.frames.len()
                        ),
                    )
                }
                None => {
                    let frame = cli.frame.ok_or_else(|| {
                        "a drawing operation requires --frame <index>, or --layer <name> to \
                         paint a layer shared by every frame"
                            .to_string()
                    })?;
                    if !config.has_frame(frame) {
                        return Err(undeclared_frame(frame, &config.frames));
                    }
                    let canvas = config.canvas()?;
                    let (count, image) = cli::apply(
                        &canvas,
                        &config.actions_for(frame),
                        &config.preview_for(frame),
                        &document,
                        frame,
                        op.into_operation(),
                    )?;
                    // Stream this frame's re-rendered image to the live viewer,
                    // keyed by its frame index. Best-effort; a no-op for an
                    // unobserved run.
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
    }
}

/// Persist a changed layer document and re-render **every** frame from it.
///
/// Any edit to a layer — its content, its placement, its curves — potentially
/// changes every frame, since the one painted layer appears in all of them. So
/// unlike a per-frame drawing operation there is no single preview to refresh:
/// the whole sheet is re-rendered from the per-frame logs plus the new document.
fn commit(config: &SheetConfig, document: &Document, summary: &str) -> Result<(), String> {
    cli::write_document(&config.layers, document)?;
    let canvas = config.canvas()?;
    for frame in &config.frames {
        let image = cli::refresh_preview(
            &canvas,
            &config.actions_for(*frame),
            &config.preview_for(*frame),
            document,
            *frame,
        )?;
        if let Some(live) = &config.live {
            cli::send_live_preview(live, *frame, "layer", document.layers.len(), &image);
        }
    }
    println!("{summary}");
    Ok(())
}

/// The error for a frame index the sheet never declared, listing what it did.
fn undeclared_frame(frame: u32, declared: &[u32]) -> String {
    format!("frame {frame} is not a declared frame (declared: {declared:?})")
}
