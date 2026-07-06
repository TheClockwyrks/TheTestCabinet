//! The `texture` CLI: the seamless raster map painter a material asset-generation
//! run uses.
//!
//! It exposes the same layered raster vocabulary as `paint`, restricted to one
//! square map at a time (selected by `--map`) and made **tileable**: every brush,
//! gradient, filter, and generator wraps toroidally across the map's edges, so a map
//! tiles without a seam by construction. It adds the procedural generators material
//! work leans on — coherent noise, structural patterns, a domain warp, and a
//! gradient map. It shares the operation log and config with the `pbr` binary. See
//! `apps/docs/src/content/docs/testing/asset-generation/material-binaries.md`.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use test_cabinet_paint::blend::BlendMode;
use test_cabinet_paint::color::Color;
use test_cabinet_paint::op::Op;
use test_cabinet_paint::paint_core::BrushKind;
use test_cabinet_paint::proc::{NoiseKind, PatternKind};
use test_cabinet_paint::{cli, config::MaterialConfig};

#[derive(Parser)]
#[command(name = "texture", about = "Paint a tileable PBR material map, one operation at a time.")]
struct Cli {
    /// Path to the seeded material config JSON (shared with `pbr`).
    #[arg(long, default_value = "material.config.json", global = true)]
    config: PathBuf,
    /// The map channel this operation edits.
    #[arg(long, default_value = "base-color", global = true)]
    map: String,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Seed the workspace, op log, and material seed, and render blank previews.
    Init,
    /// Recomposite every map's preview from the log.
    Render,
    /// Add a new transparent layer on top of the map's stack.
    AddLayer {
        #[arg(long)]
        name: String,
    },
    /// Set a layer's blend mode.
    SetBlendMode {
        #[arg(long)]
        layer: String,
        #[arg(long, value_parser = cli::parse_blend)]
        mode: BlendMode,
    },
    /// Set a layer's opacity (0..1).
    SetLayerOpacity {
        #[arg(long)]
        layer: String,
        #[arg(long)]
        opacity: f32,
    },
    /// Stamp one brush dab at (x, y).
    Brush(BrushArgs),
    /// Draw a smoothed polyline of brush dabs.
    Stroke(StrokeArgs),
    /// Fill the whole layer (or selection) with a color.
    Fill {
        #[arg(long)]
        layer: Option<String>,
        #[arg(long, value_parser = cli::parse_color)]
        color: Color,
    },
    /// Flood-fill a contiguous region from a seed pixel.
    Bucket {
        #[arg(long)]
        layer: Option<String>,
        #[arg(long)]
        x: i64,
        #[arg(long)]
        y: i64,
        #[arg(long, value_parser = cli::parse_color)]
        color: Color,
        #[arg(long, default_value_t = 0.1)]
        tolerance: f32,
    },
    /// Fill an axis-aligned rectangle.
    FillRect(FillRectArgs),
    /// A linear or radial gradient.
    Gradient(GradientArgs),
    /// Select a rectangle.
    SelectRect {
        #[arg(long)]
        x: i64,
        #[arg(long)]
        y: i64,
        #[arg(long)]
        width: u32,
        #[arg(long)]
        height: u32,
    },
    /// Clear the selection.
    SelectNone,
    /// Invert the selection.
    InvertSelection,
    /// Feather the selection edge.
    Feather {
        #[arg(long)]
        radius: u32,
    },
    /// Blur the active layer (wrapping).
    Blur {
        #[arg(long)]
        layer: Option<String>,
        #[arg(long)]
        radius: u32,
    },
    /// Sharpen the active layer.
    Sharpen {
        #[arg(long)]
        layer: Option<String>,
    },
    /// Levels: black/white points and gamma.
    Levels {
        #[arg(long)]
        layer: Option<String>,
        #[arg(long, default_value_t = 0.0)]
        black: f32,
        #[arg(long, default_value_t = 1.0)]
        white: f32,
        #[arg(long, default_value_t = 1.0)]
        gamma: f32,
    },
    /// S-curve contrast (-1..1).
    Curves {
        #[arg(long)]
        layer: Option<String>,
        #[arg(long)]
        amount: f32,
    },
    /// Hue/saturation/lightness.
    HueSat {
        #[arg(long)]
        layer: Option<String>,
        #[arg(long, default_value_t = 0.0)]
        hue: f32,
        #[arg(long, default_value_t = 0.0)]
        sat: f32,
        #[arg(long, default_value_t = 0.0)]
        lightness: f32,
    },
    /// Desaturate the active layer.
    Desaturate {
        #[arg(long)]
        layer: Option<String>,
    },
    /// Fill the map with tiling coherent noise.
    Noise {
        #[arg(long)]
        layer: Option<String>,
        #[arg(long, value_parser = cli::parse_noise, default_value = "fbm")]
        r#type: NoiseKind,
        #[arg(long, default_value_t = 4.0)]
        scale: f32,
        #[arg(long, default_value_t = 4)]
        octaves: u32,
    },
    /// Stamp a tiling structural pattern.
    Pattern {
        #[arg(long)]
        layer: Option<String>,
        #[arg(long, value_parser = cli::parse_pattern)]
        r#type: PatternKind,
        #[arg(long, default_value_t = 4.0)]
        scale: f32,
    },
    /// Domain-warp this map by another channel's relief.
    Warp {
        #[arg(long)]
        layer: Option<String>,
        /// The displacement source channel (e.g. `height`).
        #[arg(long)]
        source: String,
        #[arg(long, default_value_t = 4.0)]
        amount: f32,
    },
    /// Remap this map's grayscale through a color ramp.
    GradientMap {
        #[arg(long)]
        layer: Option<String>,
        /// Color stops as `"0:#000000,1:#ffffff"`.
        #[arg(long)]
        stops: String,
    },
}

#[derive(clap::Args)]
struct BrushArgs {
    #[arg(long)]
    layer: Option<String>,
    #[arg(long, value_parser = cli::parse_brush, default_value = "round-soft")]
    brush: BrushKind,
    #[arg(long)]
    size: f32,
    #[arg(long, default_value_t = 0.5)]
    hardness: f32,
    #[arg(long, default_value_t = 1.0)]
    flow: f32,
    #[arg(long, default_value_t = 1.0)]
    opacity: f32,
    #[arg(long, value_parser = cli::parse_color)]
    color: Color,
    #[arg(long)]
    x: f32,
    #[arg(long)]
    y: f32,
    #[arg(long, default_value_t = 0.25)]
    spacing: f32,
    #[arg(long, default_value_t = 0.0)]
    scatter: f32,
    #[arg(long, default_value_t = 0.0)]
    jitter: f32,
}

#[derive(clap::Args)]
struct StrokeArgs {
    #[arg(long)]
    layer: Option<String>,
    #[arg(long, value_parser = cli::parse_brush, default_value = "round-soft")]
    brush: BrushKind,
    #[arg(long)]
    size: f32,
    #[arg(long, default_value_t = 0.5)]
    hardness: f32,
    #[arg(long, default_value_t = 1.0)]
    flow: f32,
    #[arg(long, default_value_t = 1.0)]
    opacity: f32,
    #[arg(long, value_parser = cli::parse_color)]
    color: Color,
    /// The stroke path as `"x,y x,y …"`.
    #[arg(long)]
    points: String,
    #[arg(long, default_value_t = 0.25)]
    spacing: f32,
    #[arg(long, default_value_t = 0.0)]
    scatter: f32,
    #[arg(long, default_value_t = 0.0)]
    jitter: f32,
}

#[derive(clap::Args)]
struct FillRectArgs {
    #[arg(long)]
    layer: Option<String>,
    #[arg(long)]
    x: i64,
    #[arg(long)]
    y: i64,
    #[arg(long)]
    width: u32,
    #[arg(long)]
    height: u32,
    #[arg(long, value_parser = cli::parse_color)]
    color: Color,
}

#[derive(clap::Args)]
struct GradientArgs {
    #[arg(long)]
    layer: Option<String>,
    #[arg(long, default_value = "linear")]
    r#type: String,
    /// Color stops as `"0:#000000,1:#ffffff"`.
    #[arg(long)]
    stops: String,
    #[arg(long, value_parser = cli::parse_pair)]
    from: (f32, f32),
    #[arg(long, value_parser = cli::parse_pair)]
    to: (f32, f32),
}

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(message) => {
            if !message.is_empty() {
                println!("{message}");
            }
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("texture: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<String, String> {
    match cli.command {
        Command::Init => {
            let config: MaterialConfig = cli::read_config(&cli.config)?;
            cli::init_log(&config.actions, config.seed)?;
            cli::recomposite_material(&cli.config)?;
            Ok(format!("initialized {} map(s)", config.maps.len()))
        }
        Command::Render => {
            cli::recomposite_material(&cli.config)?;
            Ok("recomposited previews".to_string())
        }
        other => {
            let op = to_op(other)?;
            cli::apply_material_op(&cli.config, Some(cli.map), op)
        }
    }
}

fn to_op(command: Command) -> Result<Op, String> {
    Ok(match command {
        Command::Init | Command::Render => unreachable!("handled in run"),
        Command::AddLayer { name } => Op::AddLayer { name },
        Command::SetBlendMode { layer, mode } => Op::SetBlendMode { layer, mode },
        Command::SetLayerOpacity { layer, opacity } => Op::SetLayerOpacity { layer, opacity },
        Command::Brush(a) => Op::Brush {
            layer: a.layer,
            mask: false,
            brush: a.brush,
            size: a.size,
            hardness: a.hardness,
            flow: a.flow,
            opacity: a.opacity,
            color: a.color,
            x: a.x,
            y: a.y,
            spacing: a.spacing,
            scatter: a.scatter,
            jitter: a.jitter,
        },
        Command::Stroke(a) => Op::Stroke {
            layer: a.layer,
            mask: false,
            brush: a.brush,
            size: a.size,
            hardness: a.hardness,
            flow: a.flow,
            opacity: a.opacity,
            color: a.color,
            points: cli::parse_points(&a.points)?,
            spacing: a.spacing,
            scatter: a.scatter,
            jitter: a.jitter,
        },
        Command::Fill { layer, color } => Op::Fill { layer, mask: false, color },
        Command::Bucket { layer, x, y, color, tolerance } => {
            Op::Bucket { layer, x, y, color, tolerance }
        }
        Command::FillRect(a) => Op::FillRect {
            layer: a.layer,
            mask: false,
            x: a.x,
            y: a.y,
            width: a.width,
            height: a.height,
            color: a.color,
        },
        Command::Gradient(a) => Op::Gradient {
            layer: a.layer,
            mask: false,
            radial: a.r#type == "radial",
            stops: cli::parse_stops(&a.stops)?,
            from: a.from,
            to: a.to,
        },
        Command::SelectRect { x, y, width, height } => Op::SelectRect { x, y, width, height },
        Command::SelectNone => Op::SelectNone,
        Command::InvertSelection => Op::InvertSelection,
        Command::Feather { radius } => Op::Feather { radius },
        Command::Blur { layer, radius } => Op::Blur { layer, radius },
        Command::Sharpen { layer } => Op::Sharpen { layer },
        Command::Levels { layer, black, white, gamma } => Op::Levels { layer, black, white, gamma },
        Command::Curves { layer, amount } => Op::Curves { layer, amount },
        Command::HueSat { layer, hue, sat, lightness } => Op::HueSat { layer, hue, sat, lightness },
        Command::Desaturate { layer } => Op::Desaturate { layer },
        Command::Noise { layer, r#type, scale, octaves } => {
            Op::GenNoise { layer, kind: r#type, scale, octaves }
        }
        Command::Pattern { layer, r#type, scale } => Op::Pattern { layer, kind: r#type, scale },
        Command::Warp { layer, source, amount } => Op::Warp { layer, source, amount },
        Command::GradientMap { layer, stops } => {
            Op::GradientMap { layer, stops: cli::parse_stops(&stops)? }
        }
    })
}
