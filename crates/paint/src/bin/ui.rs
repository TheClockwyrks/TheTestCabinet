//! The `ui` CLI: crisp anti-aliased vector shapes, baked-font text, and nine-slice
//! authoring, layered over the **same** workspace and operation log as the `paint`
//! binary. It is the tool for the structural, pixel-crisp parts of an interface — a
//! panel frame, a button body, a label, a set of scalable insets — while `paint`
//! does the painterly shading. See
//! `apps/docs/src/content/docs/testing/asset-generation/ui-binaries.md`.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use test_cabinet_paint::color::Color;
use test_cabinet_paint::op::Op;
use test_cabinet_paint::text::{Align, FONTS};
use test_cabinet_paint::{cli, config::PaintConfig};

#[derive(Parser)]
#[command(name = "ui", about = "Compose crisp UI shapes, text, and nine-slice insets.")]
struct Cli {
    /// Path to the seeded workspace config JSON (shared with `paint`).
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
    /// Seed the workspace, op log, and asset seed, and render blank previews.
    Init,
    /// Recomposite every element's preview.
    Render,
    /// List the baked fonts available to `text --font`.
    Fonts,
    /// An anti-aliased rectangle.
    Rect(RectArgs),
    /// An anti-aliased rounded rectangle.
    RoundedRect(RoundedArgs),
    /// An anti-aliased ellipse.
    Ellipse(EllipseArgs),
    /// An anti-aliased line.
    Line(LineArgs),
    /// An anti-aliased closed polygon.
    Polygon(PolygonArgs),
    /// Baked-font text.
    Text(TextArgs),
    /// Record the element's nine-slice stretchable insets.
    SetNineSlice {
        #[arg(long)]
        left: u32,
        #[arg(long)]
        right: u32,
        #[arg(long)]
        top: u32,
        #[arg(long)]
        bottom: u32,
    },
    /// Render the element stretched to a target size (an on-request scratch preview).
    NineSlicePreview {
        #[arg(long)]
        width: u32,
        #[arg(long)]
        height: u32,
        /// Where to write the stretched preview PNG (defaults beside the element).
        #[arg(long)]
        out: Option<PathBuf>,
    },
}

#[derive(clap::Args)]
struct RectArgs {
    #[arg(long)]
    layer: Option<String>,
    #[arg(long)]
    x: f32,
    #[arg(long)]
    y: f32,
    #[arg(long)]
    width: f32,
    #[arg(long)]
    height: f32,
    #[arg(long, value_parser = cli::parse_color)]
    fill: Option<Color>,
    #[arg(long, value_parser = cli::parse_color)]
    stroke: Option<Color>,
    #[arg(long, default_value_t = 0.0)]
    stroke_width: f32,
}

#[derive(clap::Args)]
struct RoundedArgs {
    #[arg(long)]
    layer: Option<String>,
    #[arg(long)]
    x: f32,
    #[arg(long)]
    y: f32,
    #[arg(long)]
    width: f32,
    #[arg(long)]
    height: f32,
    #[arg(long)]
    corner_radius: f32,
    #[arg(long, value_parser = cli::parse_color)]
    fill: Option<Color>,
    #[arg(long, value_parser = cli::parse_color)]
    stroke: Option<Color>,
    #[arg(long, default_value_t = 0.0)]
    stroke_width: f32,
}

#[derive(clap::Args)]
struct EllipseArgs {
    #[arg(long)]
    layer: Option<String>,
    #[arg(long)]
    cx: f32,
    #[arg(long)]
    cy: f32,
    #[arg(long)]
    rx: f32,
    #[arg(long)]
    ry: f32,
    #[arg(long, value_parser = cli::parse_color)]
    fill: Option<Color>,
    #[arg(long, value_parser = cli::parse_color)]
    stroke: Option<Color>,
    #[arg(long, default_value_t = 0.0)]
    stroke_width: f32,
}

#[derive(clap::Args)]
struct LineArgs {
    #[arg(long)]
    layer: Option<String>,
    #[arg(long)]
    x0: f32,
    #[arg(long)]
    y0: f32,
    #[arg(long)]
    x1: f32,
    #[arg(long)]
    y1: f32,
    #[arg(long, value_parser = cli::parse_color)]
    stroke: Color,
    #[arg(long, default_value_t = 1.0)]
    stroke_width: f32,
}

#[derive(clap::Args)]
struct PolygonArgs {
    #[arg(long)]
    layer: Option<String>,
    /// The polygon vertices as `"x,y x,y …"`.
    #[arg(long)]
    points: String,
    #[arg(long, value_parser = cli::parse_color)]
    fill: Option<Color>,
    #[arg(long, value_parser = cli::parse_color)]
    stroke: Option<Color>,
    #[arg(long, default_value_t = 0.0)]
    stroke_width: f32,
}

#[derive(clap::Args)]
struct TextArgs {
    #[arg(long)]
    layer: Option<String>,
    #[arg(long)]
    content: String,
    #[arg(long, default_value = "sans")]
    font: String,
    #[arg(long)]
    size: f32,
    #[arg(long, value_parser = cli::parse_color)]
    color: Color,
    #[arg(long, value_parser = cli::parse_align, default_value = "left")]
    align: Align,
    #[arg(long)]
    weight_bold: bool,
    #[arg(long, default_value_t = 0.0)]
    letter_spacing: f32,
    #[arg(long)]
    wrap: Option<f32>,
    #[arg(long, default_value_t = 0.0)]
    x: f32,
    #[arg(long, default_value_t = 0.0)]
    y: f32,
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
            eprintln!("ui: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<String, String> {
    match cli.command {
        Command::Init => {
            let config: PaintConfig = cli::read_config(&cli.config)?;
            cli::init_log(&config.actions, config.seed)?;
            cli::recomposite_ui(&cli.config)?;
            Ok(format!("initialized {} element(s)", config.element_list().len()))
        }
        Command::Render => {
            cli::recomposite_ui(&cli.config)?;
            Ok("recomposited previews".to_string())
        }
        Command::Fonts => {
            let names: Vec<&str> = FONTS.iter().map(|f| f.name).collect();
            Ok(names.join("\n"))
        }
        Command::NineSlicePreview { width, height, out } => {
            let config: PaintConfig = cli::read_config(&cli.config)?;
            let template = config.workspace()?;
            let target = template.resolve_name(cli.element.as_deref())?;
            let actions = cli::read_actions(&config.actions)?;
            let out = out.unwrap_or_else(|| default_nine_slice_out(&config, &target));
            cli::nine_slice_preview(&template, &actions, &target, width, height, &out)?;
            Ok(format!("wrote nine-slice preview to {}", out.display()))
        }
        other => {
            let op = to_op(other)?;
            cli::apply_ui_op(&cli.config, cli.element, op)
        }
    }
}

fn default_nine_slice_out(config: &PaintConfig, target: &str) -> PathBuf {
    let base = config.preview_for(target);
    let stem = base.file_stem().and_then(|s| s.to_str()).unwrap_or("element");
    let name = format!("{stem}.nine-slice.png");
    match base.parent() {
        Some(p) if !p.as_os_str().is_empty() => p.join(name),
        _ => PathBuf::from(name),
    }
}

fn to_op(command: Command) -> Result<Op, String> {
    Ok(match command {
        Command::Init | Command::Render | Command::Fonts | Command::NineSlicePreview { .. } => {
            unreachable!("handled in run")
        }
        Command::Rect(a) => Op::Rect {
            layer: a.layer,
            x: a.x,
            y: a.y,
            width: a.width,
            height: a.height,
            fill: a.fill,
            stroke: a.stroke,
            stroke_width: a.stroke_width,
        },
        Command::RoundedRect(a) => Op::RoundedRect {
            layer: a.layer,
            x: a.x,
            y: a.y,
            width: a.width,
            height: a.height,
            corner_radius: a.corner_radius,
            fill: a.fill,
            stroke: a.stroke,
            stroke_width: a.stroke_width,
        },
        Command::Ellipse(a) => Op::Ellipse {
            layer: a.layer,
            cx: a.cx,
            cy: a.cy,
            rx: a.rx,
            ry: a.ry,
            fill: a.fill,
            stroke: a.stroke,
            stroke_width: a.stroke_width,
        },
        Command::Line(a) => Op::Line {
            layer: a.layer,
            x0: a.x0,
            y0: a.y0,
            x1: a.x1,
            y1: a.y1,
            stroke: a.stroke,
            stroke_width: a.stroke_width,
        },
        Command::Polygon(a) => Op::Polygon {
            layer: a.layer,
            points: cli::parse_points(&a.points)?,
            fill: a.fill,
            stroke: a.stroke,
            stroke_width: a.stroke_width,
        },
        Command::Text(a) => Op::Text {
            layer: a.layer,
            content: a.content,
            font: a.font,
            size: a.size,
            color: a.color,
            align: a.align,
            bold: a.weight_bold,
            letter_spacing: a.letter_spacing,
            wrap: a.wrap,
            x: a.x,
            y: a.y,
        },
        Command::SetNineSlice { left, right, top, bottom } => {
            Op::SetNineSlice { left, right, top, bottom }
        }
    })
}
