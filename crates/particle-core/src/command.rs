//! The authoring vocabulary both particle binaries share, as `clap` subcommands.
//!
//! `particle-2d` and `particle-3d` differ only in dimensionality, so the whole op
//! vocabulary lives here once: each binary wraps this [`Command`] in its own top-level
//! `Cli` (its name, about, and default config path) and dispatches with its
//! [`Dimensionality`]. The 3D-only `z` inputs are optional flags that the 2D binary
//! rejects, keeping `particle-2d` strictly planar while both share one definition.
//! Each authoring subcommand builds one [`Op`] and appends it to the log; `render` runs
//! the on-request simulate-and-render.

use std::path::PathBuf;

use clap::{Args, Subcommand};

use test_cabinet_model_core::Interp;
use test_cabinet_model_core::color::Rgb;
use test_cabinet_model_core::record::{init_log, read_actions, write_actions};

use crate::budget;
use crate::config::ParticleConfig;
use crate::op::{EmitterDef, Op, build_system};
use crate::render::{self, RenderRequest};
use crate::system::{
    ColorStop, Curve, Dimensionality, Emission, Extent, Forces, ParticleAppearance, Shape,
    SubTrigger, System, Turbulence,
};

/// The shared particle-tool operations.
#[derive(Debug, Subcommand)]
pub enum Command {
    /// Write an empty log; renders nothing. A run starts pre-seeded.
    Init,
    /// Add an emission source (an emitter).
    AddEmitter(AddEmitterArgs),
    /// Set the forces integrated into motion, globally or on one emitter.
    SetForces(SetForcesArgs),
    /// Set an emitter's per-particle appearance (size/opacity curves, color, ...).
    SetParticle(SetParticleArgs),
    /// Spawn a child emitter from a parent's particles (on death, or along its path).
    AddSubemitter(AddSubemitterArgs),
    /// Set the timeline's loop flag (duration and fps come from the case config).
    SetTimeline(SetTimelineArgs),
    /// Simulate the system, render the preview (GIF, or a still), and emit
    /// `system.json`.
    Render(RenderArgs),
}

impl Command {
    /// Run the operation against the seeded `config` in the binary's `dims`.
    pub fn run(&self, config: &ParticleConfig, dims: Dimensionality) -> Result<(), String> {
        match self {
            Command::Init => init_log::<Op>(&config.actions),
            Command::AddEmitter(args) => append(config, dims, args.to_op(dims)?),
            Command::SetForces(args) => append(config, dims, args.to_op(dims)?),
            Command::SetParticle(args) => append(config, dims, args.to_op()?),
            Command::AddSubemitter(args) => append(config, dims, args.to_op()),
            Command::SetTimeline(args) => append(config, dims, args.to_op()),
            Command::Render(args) => render::run(config, dims, &args.to_request()),
        }
    }
}

/// Append one [`Op`] to the configured log, reporting the log's new size — unless it
/// would push the system past the live-particle [budget](crate::budget), in which case
/// nothing is recorded and the projection is reported instead.
///
/// The check runs on every operation rather than only the obviously expensive ones,
/// because emission cost is not the property of a single flag: `set-timeline --loop
/// true` makes a burst re-fire every cycle, and `add-subemitter` multiplies an
/// emitter that was affordable on its own. It compares the projection before and
/// after, so an operation that leaves an already-over-budget log no worse — the model
/// turning a rate *down*, say — still records.
fn append(config: &ParticleConfig, dims: Dimensionality, op: Op) -> Result<(), String> {
    let mut operations: Vec<Op> = read_actions(&config.actions)?;
    let before = budget::project(&system_of(&operations, config, dims));
    operations.push(op);
    let after = budget::project(&system_of(&operations, config, dims));
    if after.exceeds_budget() && after.total > before.total {
        return Err(after.over_budget_message());
    }
    write_actions(&config.actions, &operations)?;
    println!("recorded operation {}", operations.len());
    Ok(())
}

/// Fold an op log into the system it describes, framed by the seeded config.
fn system_of(operations: &[Op], config: &ParticleConfig, dims: Dimensionality) -> System {
    build_system(
        operations,
        dims,
        config.field(dims),
        config.duration_ms,
        config.fps(),
        config.looping,
    )
}

/// `add-emitter` arguments.
#[derive(Debug, Args)]
#[command(allow_negative_numbers = true)]
pub struct AddEmitterArgs {
    /// The stable emitter name.
    #[arg(long)]
    pub name: String,
    /// The emission-source shape.
    #[arg(long, value_enum)]
    pub shape: Shape,
    /// Position x.
    #[arg(long)]
    pub x: f32,
    /// Position y (up).
    #[arg(long)]
    pub y: f32,
    /// Position z (3D only).
    #[arg(long)]
    pub z: Option<f32>,
    /// Shape radius (for disc / sphere / cone).
    #[arg(long)]
    pub radius: Option<f32>,
    /// Box/edge full extent along x.
    #[arg(long)]
    pub size_x: Option<f32>,
    /// Box full extent along y.
    #[arg(long)]
    pub size_y: Option<f32>,
    /// Box full extent along z (3D only).
    #[arg(long)]
    pub size_z: Option<f32>,
    /// Emit continuously at this many particles per second.
    #[arg(long)]
    pub rate: Option<f32>,
    /// Emit a one-shot burst of this many particles.
    #[arg(long)]
    pub burst: Option<u32>,
    /// The time (ms) a `--burst` fires at (default 0).
    #[arg(long)]
    pub at: Option<f32>,
    /// Each particle's lifetime, in milliseconds.
    #[arg(long)]
    pub lifetime: f32,
    /// The `±` spread on lifetime.
    #[arg(long)]
    pub lifetime_spread: Option<f32>,
    /// Each particle's launch speed.
    #[arg(long)]
    pub speed: f32,
    /// The `±` spread on speed.
    #[arg(long)]
    pub speed_spread: Option<f32>,
    /// Launch direction x.
    #[arg(long)]
    pub dir_x: Option<f32>,
    /// Launch direction y (default 1, up).
    #[arg(long)]
    pub dir_y: Option<f32>,
    /// Launch direction z (3D only).
    #[arg(long)]
    pub dir_z: Option<f32>,
    /// Cone half-spread about the direction, in degrees.
    #[arg(long)]
    pub cone_angle: Option<f32>,
    /// A seed pinning this emitter's random draws.
    #[arg(long)]
    pub seed: Option<u64>,
}

impl AddEmitterArgs {
    fn to_op(&self, dims: Dimensionality) -> Result<Op, String> {
        let two_d = dims == Dimensionality::D2;
        if two_d && (self.z.is_some() || self.size_z.is_some() || self.dir_z.is_some()) {
            return Err(
                "particle-2d is planar: --z, --size-z, and --dir-z are not accepted".into(),
            );
        }
        let emission = match (self.rate, self.burst) {
            (Some(_), Some(_)) => {
                return Err(
                    "specify either --rate (continuous) or --burst (one-shot), not both".into(),
                );
            }
            (Some(rate), None) => Emission::Rate { rate },
            (None, Some(count)) => Emission::Burst {
                count,
                at_ms: self.at.unwrap_or(0.0),
            },
            (None, None) => {
                return Err("specify --rate (continuous) or --burst <count> (one-shot)".into());
            }
        };
        let direction = [
            self.dir_x.unwrap_or(0.0),
            self.dir_y.unwrap_or(1.0),
            self.dir_z.unwrap_or(0.0),
        ];
        let extent = Extent {
            radius: self.radius.unwrap_or(1.0),
            size: [
                self.size_x.unwrap_or(1.0),
                self.size_y.unwrap_or(1.0),
                self.size_z.unwrap_or(1.0),
            ],
        };
        Ok(Op::AddEmitter {
            def: EmitterDef {
                name: self.name.clone(),
                shape: self.shape,
                position: [self.x, self.y, self.z.unwrap_or(0.0)],
                extent,
                emission,
                lifetime_ms: self.lifetime,
                lifetime_spread: self.lifetime_spread.unwrap_or(0.0).abs(),
                speed: self.speed,
                speed_spread: self.speed_spread.unwrap_or(0.0).abs(),
                direction,
                cone_angle: self.cone_angle.unwrap_or(0.0),
                seed: self.seed,
            },
        })
    }
}

/// `set-forces` arguments.
#[derive(Debug, Args)]
#[command(allow_negative_numbers = true)]
pub struct SetForcesArgs {
    /// Scope the forces to one emitter (default: the global forces).
    #[arg(long)]
    pub emitter: Option<String>,
    /// Gravitational acceleration (negative pulls down).
    #[arg(long)]
    pub gravity: Option<f32>,
    /// Gravity direction as `x,y[,z]` (default straight down).
    #[arg(long)]
    pub gravity_dir: Option<String>,
    /// Linear drag coefficient.
    #[arg(long)]
    pub drag: Option<f32>,
    /// Radial push out from the emitter center (an explosion shove).
    #[arg(long)]
    pub radial: Option<f32>,
    /// Vortex swirl about the vertical axis.
    #[arg(long)]
    pub vortex: Option<f32>,
    /// Curl-noise turbulence as `amplitude,scale`.
    #[arg(long)]
    pub turbulence: Option<String>,
    /// Steady wind as a velocity vector `x,y[,z]`.
    #[arg(long)]
    pub wind: Option<String>,
}

impl SetForcesArgs {
    fn to_op(&self, dims: Dimensionality) -> Result<Op, String> {
        let mut forces = Forces {
            gravity: self.gravity,
            drag: self.drag,
            radial: self.radial,
            vortex: self.vortex,
            ..Forces::default()
        };
        if let Some(spec) = &self.gravity_dir {
            forces.gravity_dir = Some(parse_vec3(spec, dims)?);
        }
        if let Some(spec) = &self.turbulence {
            forces.turbulence = Some(parse_turbulence(spec)?);
        }
        if let Some(spec) = &self.wind {
            forces.wind = Some(parse_vec3(spec, dims)?);
        }
        Ok(Op::SetForces {
            emitter: self.emitter.clone(),
            forces,
        })
    }
}

/// `set-particle` arguments.
#[derive(Debug, Args)]
#[command(allow_negative_numbers = true)]
pub struct SetParticleArgs {
    /// The emitter the appearance applies to.
    #[arg(long)]
    pub emitter: String,
    /// Size-over-life F-curve interpolation.
    #[arg(long, value_enum)]
    pub size_curve: Option<Interp>,
    /// Size at life 0 (default 1).
    #[arg(long)]
    pub size_from: Option<f64>,
    /// Size at life 1 (default 0).
    #[arg(long)]
    pub size_to: Option<f64>,
    /// Opacity-over-life F-curve interpolation.
    #[arg(long, value_enum)]
    pub opacity_curve: Option<Interp>,
    /// Opacity at life 0 (default 1).
    #[arg(long)]
    pub opacity_from: Option<f64>,
    /// Opacity at life 1 (default 0).
    #[arg(long)]
    pub opacity_to: Option<f64>,
    /// Color stops over life as `#rrggbb@t,...` (e.g. `#fff@0,#f00@1`).
    #[arg(long)]
    pub color_gradient: Option<String>,
    /// Spin rate, in degrees per second.
    #[arg(long)]
    pub rotation: Option<f32>,
    /// Velocity-stretch factor.
    #[arg(long)]
    pub stretch: Option<f32>,
    /// A cross-asset sprite/atlas reference to texture the particles with.
    #[arg(long)]
    pub sprite: Option<String>,
}

impl SetParticleArgs {
    fn to_op(&self) -> Result<Op, String> {
        let size_curve =
            if self.size_curve.is_some() || self.size_from.is_some() || self.size_to.is_some() {
                Some(Curve {
                    interp: self.size_curve.unwrap_or(Interp::Linear),
                    from: self.size_from.unwrap_or(1.0),
                    to: self.size_to.unwrap_or(0.0),
                })
            } else {
                None
            };
        let opacity_curve = if self.opacity_curve.is_some()
            || self.opacity_from.is_some()
            || self.opacity_to.is_some()
        {
            Some(Curve {
                interp: self.opacity_curve.unwrap_or(Interp::Linear),
                from: self.opacity_from.unwrap_or(1.0),
                to: self.opacity_to.unwrap_or(0.0),
            })
        } else {
            None
        };
        let color_gradient = match &self.color_gradient {
            Some(spec) => Some(parse_gradient(spec)?),
            None => None,
        };
        Ok(Op::SetParticle {
            emitter: self.emitter.clone(),
            particle: ParticleAppearance {
                size_curve,
                opacity_curve,
                color_gradient,
                rotation: self.rotation,
                stretch: self.stretch,
                sprite: self.sprite.clone(),
            },
        })
    }
}

/// `add-subemitter` arguments.
#[derive(Debug, Args)]
pub struct AddSubemitterArgs {
    /// The parent emitter whose particles trigger the child.
    #[arg(long)]
    pub parent: String,
    /// When the child fires.
    #[arg(long, value_enum)]
    pub on: SubTrigger,
    /// The child emitter (a declared emitter).
    #[arg(long)]
    pub emitter: String,
}

impl AddSubemitterArgs {
    fn to_op(&self) -> Op {
        Op::AddSubemitter {
            parent: self.parent.clone(),
            on: self.on,
            emitter: self.emitter.clone(),
        }
    }
}

/// `set-timeline` arguments.
#[derive(Debug, Args)]
pub struct SetTimelineArgs {
    /// Loop the effect (`true`) or play it once (`false`).
    #[arg(long = "loop", action = clap::ArgAction::Set)]
    pub looping: bool,
}

impl SetTimelineArgs {
    fn to_op(&self) -> Op {
        Op::SetTimeline {
            looping: self.looping,
        }
    }
}

/// `render` arguments.
#[derive(Debug, Args)]
pub struct RenderArgs {
    /// Capture only this single frame index to a still PNG instead of the whole GIF.
    #[arg(long)]
    pub frame: Option<u32>,
    /// Override the output path (the GIF, or the still for `--frame`).
    #[arg(long)]
    pub out: Option<PathBuf>,
}

impl RenderArgs {
    fn to_request(&self) -> RenderRequest {
        RenderRequest {
            frame: self.frame,
            out: self.out.clone(),
        }
    }
}

/// Parse an `x,y[,z]` vector. In 2D a third component is rejected (the effect is
/// planar); a 2D vector's `z` is zero.
fn parse_vec3(spec: &str, dims: Dimensionality) -> Result<[f32; 3], String> {
    let parts: Vec<f32> = spec
        .split(',')
        .map(|p| {
            p.trim()
                .parse::<f32>()
                .map_err(|_| format!("invalid number `{p}` in `{spec}`"))
        })
        .collect::<Result<_, _>>()?;
    match (dims, parts.as_slice()) {
        (Dimensionality::D2, [x, y]) => Ok([*x, *y, 0.0]),
        (Dimensionality::D2, _) => Err(format!(
            "particle-2d is planar: expected `x,y`, got `{spec}`"
        )),
        (Dimensionality::D3, [x, y]) => Ok([*x, *y, 0.0]),
        (Dimensionality::D3, [x, y, z]) => Ok([*x, *y, *z]),
        (Dimensionality::D3, _) => Err(format!("expected `x,y` or `x,y,z`, got `{spec}`")),
    }
}

/// Parse a `amplitude,scale` turbulence spec.
fn parse_turbulence(spec: &str) -> Result<Turbulence, String> {
    let parts: Vec<f32> = spec
        .split(',')
        .map(|p| {
            p.trim()
                .parse::<f32>()
                .map_err(|_| format!("invalid number `{p}` in `{spec}`"))
        })
        .collect::<Result<_, _>>()?;
    match parts.as_slice() {
        [amplitude, scale] => Ok(Turbulence {
            amplitude: *amplitude,
            scale: *scale,
        }),
        _ => Err(format!("expected `amplitude,scale`, got `{spec}`")),
    }
}

/// Parse a `#rrggbb@t,...` color gradient, ordered by stop position.
fn parse_gradient(spec: &str) -> Result<Vec<ColorStop>, String> {
    let mut stops = Vec::new();
    for segment in spec.split(',') {
        let segment = segment.trim();
        let (hex, at) = match segment.split_once('@') {
            Some((hex, at)) => (
                hex.trim(),
                at.trim()
                    .parse::<f32>()
                    .map_err(|_| format!("invalid stop position in `{segment}`"))?,
            ),
            None => (segment, 0.0),
        };
        let color = Rgb::parse_hex(hex).map_err(|err| err.to_string())?;
        stops.push(ColorStop { color, at });
    }
    if stops.is_empty() {
        return Err("a color gradient needs at least one stop".into());
    }
    stops.sort_by(|a, b| a.at.total_cmp(&b.at));
    Ok(stops)
}
