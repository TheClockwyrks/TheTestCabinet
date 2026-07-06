//! The `paint` CLI: the layered raster painter a UI asset-generation run uses.
//!
//! Each invocation applies one operation — `paint brush --element panel …` — by
//! appending it to the shared operation log and re-compositing the affected
//! element's preview (which is also the emitted flattened PNG). It shares the log
//! and layer store with the `ui` binary, so a run freely interleaves painterly and
//! crisp-composition work. The subcommands' `--help` is the contract; no operations
//! schema is seeded. See
//! `apps/docs/src/content/docs/testing/asset-generation/ui-binaries.md`.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use test_cabinet_paint::blend::BlendMode;
use test_cabinet_paint::color::Color;
use test_cabinet_paint::effects::EffectKind;
use test_cabinet_paint::op::Op;
use test_cabinet_paint::paint_core::BrushKind;
use test_cabinet_paint::{cli, config::PaintConfig};

#[derive(Parser)]
#[command(name = "paint", about = "Paint a high-resolution interface asset, one operation at a time.")]
struct Cli {
    /// Path to the seeded workspace config JSON.
    #[arg(long, default_value = "paint.config.json", global = true)]
    config: PathBuf,
    /// The element this operation targets (omit for a single-element case).
    #[arg(long, global = true)]
    element: Option<String>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Seed the workspace, the op log, and the asset seed, and render blank previews.
    Init,
    /// Recomposite every element's preview from the operation log.
    Render,
    /// Add a new transparent layer on top of the stack.
    AddLayer {
        #[arg(long)]
        name: String,
    },
    /// Remove a named layer.
    RemoveLayer {
        #[arg(long)]
        layer: String,
    },
    /// Move a named layer to a stack index (0 = bottom).
    ReorderLayer {
        #[arg(long)]
        layer: String,
        #[arg(long)]
        to: usize,
    },
    /// Set a layer's opacity (0..1).
    SetLayerOpacity {
        #[arg(long)]
        layer: String,
        #[arg(long)]
        opacity: f32,
    },
    /// Set a layer's blend mode.
    SetBlendMode {
        #[arg(long)]
        layer: String,
        #[arg(long, value_parser = cli::parse_blend)]
        mode: BlendMode,
    },
    /// Show or hide a layer.
    SetLayerVisible {
        #[arg(long)]
        layer: String,
        #[arg(long)]
        visible: bool,
    },
    /// Merge several named layers into one.
    GroupLayers {
        #[arg(long = "layer", value_name = "LAYER", num_args = 1..)]
        layers: Vec<String>,
        #[arg(long)]
        name: Option<String>,
    },
    /// Attach a grayscale mask to a layer.
    AddMask {
        #[arg(long)]
        layer: String,
    },
    /// Stamp one brush dab at (x, y).
    Brush(BrushArgs),
    /// Draw a smoothed polyline of brush dabs.
    Stroke(StrokeArgs),
    /// Fill the whole layer (or selection) with a color.
    Fill {
        #[arg(long)]
        layer: Option<String>,
        #[arg(long)]
        mask: bool,
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
    /// Fill an ellipse.
    FillEllipse(FillEllipseArgs),
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
    /// Select an ellipse.
    SelectEllipse {
        #[arg(long)]
        cx: f32,
        #[arg(long)]
        cy: f32,
        #[arg(long)]
        rx: f32,
        #[arg(long)]
        ry: f32,
    },
    /// Select a freeform polygon.
    SelectLasso {
        /// The lasso path as `"x,y x,y …"`.
        #[arg(long)]
        points: String,
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
    /// Blur the active layer.
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
    /// Add monochrome noise to the active layer.
    Noise {
        #[arg(long)]
        layer: Option<String>,
        #[arg(long)]
        amount: f32,
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
    /// Apply a layer effect.
    LayerEffect(LayerEffectArgs),
    /// Translate/scale/rotate the active layer.
    TransformLayer(TransformArgs),
    /// Flip the active layer.
    Flip {
        #[arg(long)]
        layer: Option<String>,
        /// Flip axis: `h` (horizontal) or `v` (vertical).
        #[arg(long)]
        axis: String,
    },
    /// Mirror the left half onto the right about `axis_x`.
    Mirror {
        #[arg(long)]
        layer: Option<String>,
        #[arg(long)]
        axis_x: u32,
    },
}

#[derive(clap::Args)]
struct BrushArgs {
    #[arg(long)]
    layer: Option<String>,
    #[arg(long)]
    mask: bool,
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
    #[arg(long)]
    mask: bool,
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
    mask: bool,
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
struct FillEllipseArgs {
    #[arg(long)]
    layer: Option<String>,
    #[arg(long)]
    mask: bool,
    #[arg(long)]
    cx: f32,
    #[arg(long)]
    cy: f32,
    #[arg(long)]
    rx: f32,
    #[arg(long)]
    ry: f32,
    #[arg(long, value_parser = cli::parse_color)]
    color: Color,
}

#[derive(clap::Args)]
struct GradientArgs {
    #[arg(long)]
    layer: Option<String>,
    #[arg(long)]
    mask: bool,
    /// `linear` (default) or `radial`.
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

#[derive(clap::Args)]
struct LayerEffectArgs {
    #[arg(long)]
    layer: Option<String>,
    #[arg(long, value_parser = cli::parse_effect)]
    r#type: EffectKind,
    #[arg(long, default_value_t = 4.0)]
    size: f32,
    #[arg(long, value_parser = cli::parse_color, default_value = "#000000")]
    color: Color,
    #[arg(long, default_value_t = 135.0)]
    angle: f32,
    #[arg(long, default_value_t = 4.0)]
    distance: f32,
}

#[derive(clap::Args)]
struct TransformArgs {
    #[arg(long)]
    layer: Option<String>,
    #[arg(long, value_parser = cli::parse_pair, default_value = "0,0")]
    translate: (f32, f32),
    #[arg(long, value_parser = cli::parse_pair, default_value = "1,1")]
    scale: (f32, f32),
    #[arg(long, default_value_t = 0.0)]
    rotate: f32,
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
            eprintln!("paint: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<String, String> {
    if let Command::Init = cli.command {
        let config: PaintConfig = cli::read_config(&cli.config)?;
        cli::init_log(&config.actions, config.seed)?;
        cli::recomposite_ui(&cli.config)?;
        return Ok(format!("initialized {} element(s)", config.element_list().len()));
    }
    if let Command::Render = cli.command {
        cli::recomposite_ui(&cli.config)?;
        return Ok("recomposited previews".to_string());
    }
    let op = to_op(cli.command)?;
    cli::apply_ui_op(&cli.config, cli.element, op)
}

fn to_op(command: Command) -> Result<Op, String> {
    Ok(match command {
        Command::Init | Command::Render => unreachable!("handled in run"),
        Command::AddLayer { name } => Op::AddLayer { name },
        Command::RemoveLayer { layer } => Op::RemoveLayer { layer },
        Command::ReorderLayer { layer, to } => Op::ReorderLayer { layer, to },
        Command::SetLayerOpacity { layer, opacity } => Op::SetLayerOpacity { layer, opacity },
        Command::SetBlendMode { layer, mode } => Op::SetBlendMode { layer, mode },
        Command::SetLayerVisible { layer, visible } => Op::SetLayerVisible { layer, visible },
        Command::GroupLayers { layers, name } => Op::GroupLayers { layers, name },
        Command::AddMask { layer } => Op::AddMask { layer },
        Command::Brush(a) => Op::Brush {
            layer: a.layer,
            mask: a.mask,
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
            mask: a.mask,
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
        Command::Fill { layer, mask, color } => Op::Fill { layer, mask, color },
        Command::Bucket { layer, x, y, color, tolerance } => {
            Op::Bucket { layer, x, y, color, tolerance }
        }
        Command::FillRect(a) => Op::FillRect {
            layer: a.layer,
            mask: a.mask,
            x: a.x,
            y: a.y,
            width: a.width,
            height: a.height,
            color: a.color,
        },
        Command::FillEllipse(a) => Op::FillEllipse {
            layer: a.layer,
            mask: a.mask,
            cx: a.cx,
            cy: a.cy,
            rx: a.rx,
            ry: a.ry,
            color: a.color,
        },
        Command::Gradient(a) => Op::Gradient {
            layer: a.layer,
            mask: a.mask,
            radial: a.r#type == "radial",
            stops: cli::parse_stops(&a.stops)?,
            from: a.from,
            to: a.to,
        },
        Command::SelectRect { x, y, width, height } => Op::SelectRect { x, y, width, height },
        Command::SelectEllipse { cx, cy, rx, ry } => Op::SelectEllipse { cx, cy, rx, ry },
        Command::SelectLasso { points } => Op::SelectLasso { points: cli::parse_points(&points)? },
        Command::SelectNone => Op::SelectNone,
        Command::InvertSelection => Op::InvertSelection,
        Command::Feather { radius } => Op::Feather { radius },
        Command::Blur { layer, radius } => Op::Blur { layer, radius },
        Command::Sharpen { layer } => Op::Sharpen { layer },
        Command::Noise { layer, amount } => Op::Noise { layer, amount },
        Command::Levels { layer, black, white, gamma } => Op::Levels { layer, black, white, gamma },
        Command::Curves { layer, amount } => Op::Curves { layer, amount },
        Command::HueSat { layer, hue, sat, lightness } => Op::HueSat { layer, hue, sat, lightness },
        Command::Desaturate { layer } => Op::Desaturate { layer },
        Command::LayerEffect(a) => Op::LayerEffect {
            layer: a.layer,
            effect: a.r#type,
            size: a.size,
            color: a.color,
            angle: a.angle,
            distance: a.distance,
        },
        Command::TransformLayer(a) => Op::TransformLayer {
            layer: a.layer,
            translate: a.translate,
            scale: a.scale,
            rotate: a.rotate,
        },
        Command::Flip { layer, axis } => Op::Flip {
            layer,
            horizontal: !axis.eq_ignore_ascii_case("v"),
        },
        Command::Mirror { layer, axis_x } => Op::Mirror { layer, axis_x },
    })
}
