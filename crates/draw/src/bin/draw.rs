//! The `draw` CLI: the only way an asset-generation run makes a mark.
//!
//! The model calls this binary once per operation. Each `apply` appends the
//! operation to the run's `actions.json` and re-renders the preview image from
//! the **whole** log, so the recorded log is always the single source of truth
//! and the preview always reflects it. After the run, `crates/core` regenerates
//! the scored image from that same log through the same [`test_cabinet_draw`]
//! library — so an image produced any other way cannot match.
//!
//! See `apps/docs/src/content/docs/testing/asset-generation/`.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use serde::Deserialize;
use test_cabinet_draw::{Background, Canvas, Operation, operations_schema_string, render};

/// The drawing tool for asset-generation test cases.
#[derive(Parser)]
#[command(name = "draw", about = "Draw a sprite one operation at a time.")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Initialize the canvas: write an empty action log and a blank preview so
    /// the run starts from a known, empty state.
    Init {
        /// Path to the canvas config JSON (`{ width, height, background, actions,
        /// preview }`).
        #[arg(long, default_value = "draw.config.json")]
        config: PathBuf,
    },
    /// Append one operation to the action log and re-render the preview.
    Apply {
        /// Path to the canvas config JSON.
        #[arg(long, default_value = "draw.config.json")]
        config: PathBuf,
        /// The operation as a JSON object, e.g.
        /// `{"op":"fill_rect","x":0,"y":0,"width":8,"height":8,"color":"#ff0000"}`.
        #[arg(long)]
        json: String,
    },
    /// Regenerate an image from an action log without modifying it. The same
    /// rendering `crates/core` performs to produce the scored image.
    Render {
        /// Path to the action log JSON (an array of operations).
        #[arg(long)]
        actions: PathBuf,
        /// Where to write the rendered PNG.
        #[arg(long)]
        out: PathBuf,
        /// Canvas width in pixels.
        #[arg(long)]
        width: u32,
        /// Canvas height in pixels.
        #[arg(long)]
        height: u32,
        /// Initial background: `transparent` or a hex color.
        #[arg(long, default_value = "transparent")]
        background: String,
    },
    /// Print the JSON Schema of the operation set. Seed its output verbatim as a
    /// case's `[tool].operations` contract.
    Schema {
        /// Write the schema here instead of standard output.
        #[arg(long)]
        out: Option<PathBuf>,
    },
}

/// The canvas configuration the orchestrator seeds next to the run workspace so
/// `apply`/`init` need no canvas flags.
#[derive(Debug, Deserialize)]
struct Config {
    width: u32,
    height: u32,
    #[serde(default = "default_background")]
    background: String,
    #[serde(default = "default_actions")]
    actions: PathBuf,
    #[serde(default = "default_preview")]
    preview: PathBuf,
}

fn default_background() -> String {
    "transparent".to_string()
}

fn default_actions() -> PathBuf {
    PathBuf::from("actions.json")
}

fn default_preview() -> PathBuf {
    PathBuf::from("canvas.png")
}

impl Config {
    fn canvas(&self) -> Result<Canvas, String> {
        let background = Background::parse(&self.background)
            .map_err(|err| format!("invalid background in config: {err}"))?;
        Ok(Canvas {
            width: self.width,
            height: self.height,
            background,
        })
    }
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
        Command::Init { config } => {
            let config = read_config(&config)?;
            let canvas = config.canvas()?;
            write_actions(&config.actions, &[])?;
            render(&canvas, &[])
                .encode_png(&config.preview)
                .map_err(|err| format!("writing preview {}: {err}", config.preview.display()))?;
            println!("initialized {}x{} canvas", canvas.width, canvas.height);
            Ok(())
        }
        Command::Apply { config, json } => {
            let config = read_config(&config)?;
            let canvas = config.canvas()?;
            let operation: Operation = serde_json::from_str(&json)
                .map_err(|err| format!("invalid operation (see the operations schema): {err}"))?;
            let mut operations = read_actions(&config.actions)?;
            operations.push(operation);
            write_actions(&config.actions, &operations)?;
            render(&canvas, &operations)
                .encode_png(&config.preview)
                .map_err(|err| format!("writing preview {}: {err}", config.preview.display()))?;
            println!(
                "applied {} ({} operation{} recorded)",
                operation_name(&operation),
                operations.len(),
                if operations.len() == 1 { "" } else { "s" }
            );
            Ok(())
        }
        Command::Render {
            actions,
            out,
            width,
            height,
            background,
        } => {
            let canvas = Canvas {
                width,
                height,
                background: Background::parse(&background)
                    .map_err(|err| format!("invalid background: {err}"))?,
            };
            let operations = read_actions(&actions)?;
            render(&canvas, &operations)
                .encode_png(&out)
                .map_err(|err| format!("writing {}: {err}", out.display()))?;
            Ok(())
        }
        Command::Schema { out } => {
            let schema = operations_schema_string();
            match out {
                Some(path) => fs::write(&path, schema)
                    .map_err(|err| format!("writing {}: {err}", path.display()))?,
                None => print!("{schema}"),
            }
            Ok(())
        }
    }
}

fn read_config(path: &Path) -> Result<Config, String> {
    let raw =
        fs::read_to_string(path).map_err(|err| format!("reading {}: {err}", path.display()))?;
    serde_json::from_str(&raw).map_err(|err| format!("invalid config {}: {err}", path.display()))
}

/// Read the action log, treating an absent file as an empty log so the first
/// `apply` of a run does not need a separate `init`.
fn read_actions(path: &Path) -> Result<Vec<Operation>, String> {
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|err| format!("invalid action log {}: {err}", path.display())),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(err) => Err(format!("reading {}: {err}", path.display())),
    }
}

fn write_actions(path: &Path, operations: &[Operation]) -> Result<(), String> {
    let mut json = serde_json::to_string_pretty(operations)
        .map_err(|err| format!("serializing action log: {err}"))?;
    json.push('\n');
    fs::write(path, json).map_err(|err| format!("writing {}: {err}", path.display()))
}

/// The wire tag of an operation, for the human-readable confirmation line.
fn operation_name(operation: &Operation) -> &'static str {
    match operation {
        Operation::FillBackground { .. } => "fill_background",
        Operation::SetPixel { .. } => "set_pixel",
        Operation::FillRect { .. } => "fill_rect",
        Operation::StrokeRect { .. } => "stroke_rect",
        Operation::Line { .. } => "line",
        Operation::FillCircle { .. } => "fill_circle",
        Operation::StrokeCircle { .. } => "stroke_circle",
        Operation::FloodFill { .. } => "flood_fill",
        Operation::MirrorHorizontal { .. } => "mirror_horizontal",
    }
}
