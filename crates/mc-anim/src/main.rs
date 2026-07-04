//! The `mc-anim` CLI: building a rigged, **animated** marching-cubes model, one part
//! at a time.
//!
//! This binary extends [`mc`](../mc.rs) with a required `--part <name>`: the field
//! operations and how each composites are **identical**, but each part has its **own
//! action log, preview, and per-part `.glb`** — separate files — though every part is
//! composited in the **same shared volume's coordinates**, in place where it sits on
//! the assembled model. On top of the per-part fields it maintains the rig structure in
//! `rig.json`: the parts' hierarchy, the named joints a consuming game or an animation
//! drives, and the model-authored animations. The manifest pre-seeds only the required
//! **animation** declarations; the parts and joints are model-invented at run time via
//! the `define-part` / `set-pivot` / `define-joint` subcommands, and the
//! `define-animation` / `add-keyframe` subcommands let the model author each required
//! animation's motion and add its own.
//!
//! The operation subcommands are shared with `mc`, so their `--help` is the same
//! contract; no operations schema is seeded. Like `mc`, a sculpting operation **only
//! records** — it renders nothing. Rendering is on-request via `render`, which draws
//! the assembled scene by default, a single `--component` part, or the model **posed**
//! at a `--time` of one of its animations. `render` is where each part's extracted
//! `.glb` (the geometry the 3D client renders) is emitted.
//!
//! See `apps/docs/src/content/docs/testing/asset-generation/`.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use test_cabinet_mc::Axis;
use test_cabinet_mc::cli::{self, AnimConfig, AnimRenderArgs, OpCommand};
use test_cabinet_model_core::rig::{Drive, Interp, Joint, JointKind, Keyframe, Rig};

/// The marching-cubes tool for rigged, animated asset-generation test cases.
#[derive(Parser)]
#[command(
    name = "mc-anim",
    about = "Sculpt a rigged marching-cubes model, one part and one operation at a time."
)]
struct Cli {
    /// Path to the rig config JSON (`{ width, height, depth, background, actions,
    /// preview, mesh, scene, rig }`). Read by `init` and every field operation.
    #[arg(long, default_value = "mc-anim.config.json", global = true)]
    config: PathBuf,
    /// Which part to sculpt into. **Required** for a field operation; each part has its
    /// own action log, all in the shared volume's coordinates.
    #[arg(long, global = true)]
    part: Option<String>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Set up the rig from whatever parts already exist (none, for a fresh run, since
    /// parts are created by `define-part`): (re)initialize each existing part's empty
    /// action log. Renders nothing — run `render` to draw the assembled scene.
    Init,
    /// Render on request. With no options, render the assembled scene (every part
    /// composed at rest) — re-emitting every part's `.glb` and preview and writing one
    /// scene PNG per view (`iso`, `front`, `side`, `top`). Pass `--component <part>`
    /// to render just that part, or `--time <ms>` (with `--animation <name>`) to see
    /// the model posed at that instant of an animation. Nothing renders automatically.
    Render(AnimRenderArgs),
    /// Add a part to the rig, or update its parent if it already exists. Defining a new
    /// part also initializes its action log so it becomes a sculptable target
    /// immediately.
    DefinePart {
        /// The part name.
        #[arg(long)]
        name: String,
        /// The parent part this one attaches to (omit for the root part).
        #[arg(long)]
        parent: Option<String>,
    },
    /// Set an existing part's pivot: the point, in the shared volume's coordinates (the
    /// same coordinates the part is sculpted in), that its joints rotate about.
    SetPivot {
        /// The part to update.
        #[arg(long)]
        part: String,
        /// Pivot x.
        #[arg(long)]
        x: i64,
        /// Pivot y.
        #[arg(long)]
        y: i64,
        /// Pivot z.
        #[arg(long)]
        z: i64,
    },
    /// Add a joint to the rig, or replace the joint of the same name.
    DefineJoint {
        /// The joint name (the parameter a game addresses, e.g. `turret_yaw`).
        #[arg(long)]
        name: String,
        /// The part this joint moves.
        #[arg(long)]
        part: String,
        /// Whether the joint rotates or translates the part.
        #[arg(long, value_enum)]
        kind: JointKind,
        /// The axis the joint acts about (rotation) or along (translation). For a
        /// rotation, a positive `x` (pitch) value elevates a forward (+z) part up
        /// toward +y (negative depresses it down); `y` (yaw) and `z` (roll) are
        /// right-handed about the axis.
        #[arg(long, value_enum)]
        axis: Axis,
        /// Joint-origin x, in the shared volume's coordinates (the same coordinates the
        /// part is sculpted in): the point the joint rotates about.
        #[arg(long)]
        pivot_x: i64,
        /// Joint-origin y.
        #[arg(long)]
        pivot_y: i64,
        /// Joint-origin z.
        #[arg(long)]
        pivot_z: i64,
        /// Minimum value (radians for a rotation, voxel units for a translation).
        #[arg(long)]
        min: f64,
        /// Maximum value.
        #[arg(long)]
        max: f64,
        /// The rest/default value, within `[min, max]`.
        #[arg(long)]
        rest: f64,
        /// Fixed mount translation along x (voxels), applied in addition to the driven
        /// motion — the translation half of the compound attach.
        #[arg(long, default_value_t = 0.0)]
        offset_x: f64,
        /// Fixed mount translation along y (voxels).
        #[arg(long, default_value_t = 0.0)]
        offset_y: f64,
        /// Fixed mount translation along z (voxels).
        #[arg(long, default_value_t = 0.0)]
        offset_z: f64,
        /// Fixed mount rotation about x (radians), applied as Euler X→Y→Z about the
        /// joint pivot — the rotation half of the compound attach.
        #[arg(long, default_value_t = 0.0)]
        orient_x: f64,
        /// Fixed mount rotation about y (radians).
        #[arg(long, default_value_t = 0.0)]
        orient_y: f64,
        /// Fixed mount rotation about z (radians).
        #[arg(long, default_value_t = 0.0)]
        orient_z: f64,
        /// Who drives the joint: `caller` (a game) or `auto` (driven only by the
        /// model's animations, holding at rest until one overlays it).
        #[arg(long, value_enum, default_value = "caller")]
        drive: DriveArg,
    },
    /// Create or redefine a named animation's metadata (its period, loop, and auto-play
    /// intent). Its motion is authored with `add-keyframe`; redefining an existing
    /// animation preserves its already-authored tracks.
    DefineAnimation {
        /// The animation name (a game plays it by this name, e.g. `walk`).
        #[arg(long)]
        name: String,
        /// The period in milliseconds (one full loop across every track).
        #[arg(long)]
        period_ms: u32,
        /// Whether the animation loops (default) or plays once and holds the last pose.
        #[arg(long, default_value_t = true, action = clap::ArgAction::Set)]
        r#loop: bool,
        /// Whether the animation plays continuously by default (a decorative idle)
        /// versus a named playable a game triggers.
        #[arg(long, default_value_t = false, action = clap::ArgAction::Set)]
        auto_play: bool,
    },
    /// Add or replace one keyframe on an animation's track for a joint (the first
    /// keyframe for a joint creates its track).
    AddKeyframe {
        /// The animation to add the keyframe to (must already exist).
        #[arg(long)]
        animation: String,
        /// The joint this keyframe drives.
        #[arg(long)]
        joint: String,
        /// Time offset from the start of the animation, in milliseconds.
        #[arg(long)]
        t_ms: u32,
        /// The joint value at this time (radians for a rotation, voxels for a
        /// translation).
        #[arg(long)]
        value: f64,
        /// Interpolation of the segment leaving this key: `constant`, `linear`,
        /// `bezier`, or an easing preset `ease-in`/`ease-out`/`ease-in-out`.
        #[arg(long, value_enum, default_value = "bezier")]
        interp: InterpArg,
        /// Optional Bézier out-handle on this key as `<dt_ms,dvalue>` (offset from the
        /// key). Omitted, a `bezier` key uses an auto tangent.
        #[arg(long, value_parser = parse_handle)]
        out_handle: Option<[f64; 2]>,
        /// Optional Bézier in-handle on this key as `<dt_ms,dvalue>` (offset from the
        /// key). Omitted, a `bezier` key uses an auto tangent.
        #[arg(long, value_parser = parse_handle)]
        in_handle: Option<[f64; 2]>,
    },
    /// Record one field operation into the `--part`'s action log. This is all it does
    /// — it renders nothing; run `render` when you want to see the part or scene.
    #[command(flatten)]
    Op(OpCommand),
}

/// Who drives a joint, as a `clap` value: mirrors the `caller`/`auto` values of the
/// on-disk [`Drive`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
enum DriveArg {
    /// A consuming game supplies the joint's value at runtime.
    Caller,
    /// The joint is driven only by the model's animations.
    Auto,
}

impl DriveArg {
    /// The on-disk [`Drive`] this choice produces.
    fn into_drive(self) -> Drive {
        match self {
            DriveArg::Caller => Drive::Caller,
            DriveArg::Auto => Drive::Auto,
        }
    }
}

/// A keyframe's interpolation, as a `clap` value: mirrors the on-disk [`Interp`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
enum InterpArg {
    Constant,
    Linear,
    Bezier,
    EaseIn,
    EaseOut,
    EaseInOut,
}

impl InterpArg {
    /// The on-disk [`Interp`] this choice produces.
    fn into_interp(self) -> Interp {
        match self {
            InterpArg::Constant => Interp::Constant,
            InterpArg::Linear => Interp::Linear,
            InterpArg::Bezier => Interp::Bezier,
            InterpArg::EaseIn => Interp::EaseIn,
            InterpArg::EaseOut => Interp::EaseOut,
            InterpArg::EaseInOut => Interp::EaseInOut,
        }
    }
}

/// Parse a Bézier handle value of the form `<dt_ms>,<dvalue>` into `[dt_ms, dvalue]`.
fn parse_handle(value: &str) -> Result<[f64; 2], String> {
    let (dt, dv) = value
        .split_once(',')
        .ok_or_else(|| format!("invalid handle `{value}` (expected `<dt_ms>,<dvalue>`)"))?;
    let dt_ms = dt
        .trim()
        .parse::<f64>()
        .map_err(|err| format!("invalid handle dt `{dt}`: {err}"))?;
    let dvalue = dv
        .trim()
        .parse::<f64>()
        .map_err(|err| format!("invalid handle dvalue `{dv}`: {err}"))?;
    Ok([dt_ms, dvalue])
}

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("mc-anim: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<(), String> {
    match cli.command {
        Command::Init => {
            let config: AnimConfig = cli::read_config(&cli.config)?;
            // Parts are model-invented; `define-part` initializes each part's log as
            // it is created, so init only (re)initializes whatever the rig already
            // carries. It renders nothing — run `render` to draw the assembled scene.
            let parts = config.declared_parts();
            for part in &parts {
                cli::init_log(&config.actions_for(part))?;
            }
            println!(
                "initialized {} part{} of {}x{}x{} (run `render` to draw the scene)",
                parts.len(),
                if parts.len() == 1 { "" } else { "s" },
                config.width,
                config.height,
                config.depth
            );
            Ok(())
        }
        Command::Render(args) => {
            let config: AnimConfig = cli::read_config(&cli.config)?;
            // A single-part or posed render returns a frame to stream; a scene render
            // streams its per-part frames internally and returns `None`.
            if let Some(rendered) = args.run(&config)?
                && let (Some(live), Some(part)) = (&config.live, &args.component)
            {
                let index = config
                    .declared_parts()
                    .iter()
                    .position(|p| p == part)
                    .unwrap_or(0) as u32;
                let count = cli::read_actions(&config.actions_for(part))
                    .map(|ops| ops.len())
                    .unwrap_or(0);
                cli::send_live_preview(
                    &live.endpoint,
                    &live.token,
                    index,
                    "render",
                    count,
                    &rendered.image,
                    &rendered.live_body,
                );
            }
            println!("rendered");
            Ok(())
        }
        Command::DefinePart { name, parent } => {
            let config: AnimConfig = cli::read_config(&cli.config)?;
            let mut rig = Rig::load(&config.rig)?;
            let is_new = !rig.parts.iter().any(|p| p.name == name);
            rig.upsert_part(&name, parent);
            rig.save(&config.rig)?;
            // A newly defined part gets its empty action log initialized so it exists
            // as a sculptable target immediately — even an attach socket that is never
            // sculpted. Redefining an existing part (e.g. to re-parent it) leaves its
            // sculpt untouched. No preview/mesh is written until `render`.
            if is_new {
                cli::init_log(&config.actions_for(&name))?;
            }
            println!("defined part {name}");
            Ok(())
        }
        Command::SetPivot { part, x, y, z } => {
            let config: AnimConfig = cli::read_config(&cli.config)?;
            let mut rig = Rig::load(&config.rig)?;
            if !rig.set_pivot(&part, [x, y, z]) {
                return Err(format!("no such part `{part}` in the rig"));
            }
            rig.save(&config.rig)?;
            println!("set pivot of {part} to ({x}, {y}, {z})");
            Ok(())
        }
        Command::DefineJoint {
            name,
            part,
            kind,
            axis,
            pivot_x,
            pivot_y,
            pivot_z,
            min,
            max,
            rest,
            offset_x,
            offset_y,
            offset_z,
            orient_x,
            orient_y,
            orient_z,
            drive,
        } => {
            let config: AnimConfig = cli::read_config(&cli.config)?;
            let mut rig = Rig::load(&config.rig)?;
            rig.upsert_joint(Joint {
                name: name.clone(),
                part,
                kind,
                axis,
                pivot: [pivot_x, pivot_y, pivot_z],
                min,
                max,
                rest,
                offset: [offset_x, offset_y, offset_z],
                orient: [orient_x, orient_y, orient_z],
                drive: drive.into_drive(),
            });
            rig.save(&config.rig)?;
            println!("defined joint {name}");
            Ok(())
        }
        Command::DefineAnimation {
            name,
            period_ms,
            r#loop,
            auto_play,
        } => {
            let config: AnimConfig = cli::read_config(&cli.config)?;
            let mut rig = Rig::load(&config.rig)?;
            // The required joints are seeded on the declaration; a model-authored
            // animation declares its driven set implicitly by adding keyframes, so this
            // preserves the existing `joints` when redefining and starts empty for a new
            // one.
            let joints = rig
                .animations
                .iter()
                .find(|a| a.name == name)
                .map(|a| a.joints.clone())
                .unwrap_or_default();
            rig.upsert_animation(&name, period_ms, r#loop, auto_play, joints);
            rig.save(&config.rig)?;
            println!("defined animation {name}");
            Ok(())
        }
        Command::AddKeyframe {
            animation,
            joint,
            t_ms,
            value,
            interp,
            out_handle,
            in_handle,
        } => {
            let config: AnimConfig = cli::read_config(&cli.config)?;
            let mut rig = Rig::load(&config.rig)?;
            let added = rig.add_keyframe(
                &animation,
                &joint,
                Keyframe {
                    t_ms,
                    value,
                    interp: interp.into_interp(),
                    out_handle,
                    in_handle,
                },
            );
            if !added {
                return Err(format!(
                    "no such animation `{animation}` in the rig (define it with \
                     define-animation first)"
                ));
            }
            rig.save(&config.rig)?;
            println!("added keyframe to {animation} on joint {joint} at {t_ms}ms");
            Ok(())
        }
        Command::Op(op) => {
            let part = cli
                .part
                .ok_or_else(|| "a field operation requires --part <name>".to_string())?;
            let config: AnimConfig = cli::read_config(&cli.config)?;
            if !config.has_part(&part) {
                return Err(format!(
                    "part `{part}` is not defined — define it with `define-part` before \
                     sculpting it (defined: {:?})",
                    config.declared_parts()
                ));
            }
            let field_op = op.into_field_op();
            let name = field_op.name();
            // Record only: append the operation to the part's log. Nothing renders —
            // run `render` to redraw the part or the assembled scene.
            let count = cli::record(&config.actions_for(&part), field_op)?;
            println!(
                "recorded {name} to part {part} ({count} operation{} in the log)",
                if count == 1 { "" } else { "s" }
            );
            Ok(())
        }
    }
}
