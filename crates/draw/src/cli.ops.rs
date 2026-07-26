//! The drawing operation subcommands.
//!
//! Split out of [`cli`](super) so each file stays a readable size; the operations
//! are the contract a model reads through `--help`, so they live together and
//! nowhere else.

use clap::Subcommand;

use crate::Operation;
use crate::color::Rgba;

/// A single drawing operation, expressed as a `clap` subcommand.
///
/// The variants and their arguments mirror [`Operation`] one-for-one;
/// [`OpCommand::into_operation`] is the single place the CLI form and the
/// recorded wire form meet. Coordinates are signed so a shape may be placed
/// partially off-canvas (the off-canvas portion is clipped); sizes and radii are
/// unsigned. Operations **replace** the pixels they touch rather than
/// alpha-compositing, so the recorded log regenerates to an exact, order-only
/// image.
#[derive(Debug, Clone, PartialEq, Eq, Subcommand)]
pub enum OpCommand {
    /// Flood the entire canvas with one color, discarding everything drawn so
    /// far. Useful as a first call to lay down a base.
    FillBackground {
        /// The fill color, as `#rrggbb` or `#rrggbbaa`.
        #[arg(long, value_parser = parse_color)]
        color: Rgba,
    },
    /// Set a single pixel.
    SetPixel {
        /// Column (0 at the left).
        #[arg(long)]
        x: i64,
        /// Row (0 at the top).
        #[arg(long)]
        y: i64,
        /// The pixel color, as `#rrggbb` or `#rrggbbaa`.
        #[arg(long, value_parser = parse_color)]
        color: Rgba,
    },
    /// Fill an axis-aligned rectangle. `(x, y)` is the top-left corner.
    FillRect {
        /// Left edge column.
        #[arg(long)]
        x: i64,
        /// Top edge row.
        #[arg(long)]
        y: i64,
        /// Width in pixels.
        #[arg(long)]
        width: u32,
        /// Height in pixels.
        #[arg(long)]
        height: u32,
        /// The fill color, as `#rrggbb` or `#rrggbbaa`.
        #[arg(long, value_parser = parse_color)]
        color: Rgba,
    },
    /// Draw the 1px outline of an axis-aligned rectangle.
    StrokeRect {
        /// Left edge column.
        #[arg(long)]
        x: i64,
        /// Top edge row.
        #[arg(long)]
        y: i64,
        /// Width in pixels.
        #[arg(long)]
        width: u32,
        /// Height in pixels.
        #[arg(long)]
        height: u32,
        /// The outline color, as `#rrggbb` or `#rrggbbaa`.
        #[arg(long, value_parser = parse_color)]
        color: Rgba,
    },
    /// Draw a 1px line between two points (inclusive of both endpoints).
    Line {
        /// Start column.
        #[arg(long)]
        x0: i64,
        /// Start row.
        #[arg(long)]
        y0: i64,
        /// End column.
        #[arg(long)]
        x1: i64,
        /// End row.
        #[arg(long)]
        y1: i64,
        /// The line color, as `#rrggbb` or `#rrggbbaa`.
        #[arg(long, value_parser = parse_color)]
        color: Rgba,
    },
    /// Fill a disc centered at `(cx, cy)` with radius `r`.
    FillCircle {
        /// Center column.
        #[arg(long)]
        cx: i64,
        /// Center row.
        #[arg(long)]
        cy: i64,
        /// Radius in pixels.
        #[arg(long)]
        r: u32,
        /// The fill color, as `#rrggbb` or `#rrggbbaa`.
        #[arg(long, value_parser = parse_color)]
        color: Rgba,
    },
    /// Draw the 1px outline of a circle centered at `(cx, cy)` with radius `r`.
    StrokeCircle {
        /// Center column.
        #[arg(long)]
        cx: i64,
        /// Center row.
        #[arg(long)]
        cy: i64,
        /// Radius in pixels.
        #[arg(long)]
        r: u32,
        /// The outline color, as `#rrggbb` or `#rrggbbaa`.
        #[arg(long, value_parser = parse_color)]
        color: Rgba,
    },
    /// Replace the contiguous, 4-connected region of pixels sharing the start
    /// pixel's current color with a new color. No-op if the start is off-canvas
    /// or already the target color.
    FloodFill {
        /// Seed column.
        #[arg(long)]
        x: i64,
        /// Seed row.
        #[arg(long)]
        y: i64,
        /// The replacement color, as `#rrggbb` or `#rrggbbaa`.
        #[arg(long, value_parser = parse_color)]
        color: Rgba,
    },
    /// Mirror the columns left of `axis_x` onto the columns to its right,
    /// reflecting across the vertical line between column `axis_x - 1` and column
    /// `axis_x`. The single highest-leverage op for a left/right-symmetric sprite.
    MirrorHorizontal {
        /// The mirror axis: columns `0..axis_x` are copied onto `axis_x..`.
        #[arg(long)]
        axis_x: u32,
    },
}

impl OpCommand {
    /// Convert the parsed subcommand into the [`Operation`] recorded in the
    /// action log and replayed by the renderer.
    pub fn into_operation(self) -> Operation {
        match self {
            OpCommand::FillBackground { color } => Operation::FillBackground { color },
            OpCommand::SetPixel { x, y, color } => Operation::SetPixel { x, y, color },
            OpCommand::FillRect {
                x,
                y,
                width,
                height,
                color,
            } => Operation::FillRect {
                x,
                y,
                width,
                height,
                color,
            },
            OpCommand::StrokeRect {
                x,
                y,
                width,
                height,
                color,
            } => Operation::StrokeRect {
                x,
                y,
                width,
                height,
                color,
            },
            OpCommand::Line {
                x0,
                y0,
                x1,
                y1,
                color,
            } => Operation::Line {
                x0,
                y0,
                x1,
                y1,
                color,
            },
            OpCommand::FillCircle { cx, cy, r, color } => {
                Operation::FillCircle { cx, cy, r, color }
            }
            OpCommand::StrokeCircle { cx, cy, r, color } => {
                Operation::StrokeCircle { cx, cy, r, color }
            }
            OpCommand::FloodFill { x, y, color } => Operation::FloodFill { x, y, color },
            OpCommand::MirrorHorizontal { axis_x } => Operation::MirrorHorizontal { axis_x },
        }
    }

    /// The wire tag of the operation this subcommand produces, for the
    /// human-readable confirmation line the binaries print.
    pub fn name(&self) -> &'static str {
        match self {
            OpCommand::FillBackground { .. } => "fill_background",
            OpCommand::SetPixel { .. } => "set_pixel",
            OpCommand::FillRect { .. } => "fill_rect",
            OpCommand::StrokeRect { .. } => "stroke_rect",
            OpCommand::Line { .. } => "line",
            OpCommand::FillCircle { .. } => "fill_circle",
            OpCommand::StrokeCircle { .. } => "stroke_circle",
            OpCommand::FloodFill { .. } => "flood_fill",
            OpCommand::MirrorHorizontal { .. } => "mirror_horizontal",
        }
    }
}

/// Parse a `--color` value (`#rrggbb` or `#rrggbbaa`) into an [`Rgba`], mapping a
/// parse error to the string `clap` shows the user.
pub(crate) fn parse_color(value: &str) -> Result<Rgba, String> {
    Rgba::parse_hex(value).map_err(|err| err.to_string())
}
