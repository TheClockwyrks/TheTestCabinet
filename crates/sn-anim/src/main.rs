//! The `sn-anim` CLI: building a rigged, **animated** surface-nets model, one part
//! at a time.
//!
//! This binary extends [`sn`](../sn.rs) with a required `--part <name>`: the field
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
//! The operation subcommands are shared with `sn`, so their `--help` is the same
//! contract; no operations schema is seeded.
//!
//! See `apps/docs/src/content/docs/testing/asset-generation/`.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use test_cabinet_model_core::rig::{Drive, Interp, Joint, JointKind, Keyframe, Rig};
use test_cabinet_sn::Axis;
use test_cabinet_sn::cli::{self, AnimConfig, OpCommand, RenderArgs};

/// The surface-nets tool for rigged, animated asset-generation test cases.
#[derive(Parser)]
#[command(
    name = "sn-anim",
    about = "Sculpt a rigged surface-nets model, one part and one operation at a time."
)]
struct Cli {
    /// Path to the rig config JSON (`{ width, height, depth, background, actions,
    /// preview, mesh, scene, rig }`). Read by `init` and every field operation.
    #[arg(long, default_value = "sn-anim.config.json", global = true)]
    config: PathBuf,
    /// Which part to sculpt into. **Required** for a field operation; each part has its
    /// own action log and preview, all in the shared volume's coordinates.
    #[arg(long, global = true)]
    part: Option<String>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Set up the rig and scene from whatever parts already exist (none, for a fresh
    /// run, since parts are created by `define-part`): (re)initialize each existing
    /// part's empty action log and blank preview, then render the blank assembled scene.
    Init,
    /// Re-render the assembled scene (every part composed at rest) from the current
    /// per-part logs, writing one PNG per view (`iso`, `front`, `side`, `top`). Runs
    /// automatically after every field operation; this is the manual form.
    Scene,
    /// Regenerate a preview from an action log without modifying it.
    Render(RenderArgs),
    /// Add a part to the rig, or update its parent if it already exists. Defining a new
    /// part also initializes its files (action log, preview, mesh) so it becomes a
    /// sculptable target immediately.
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
    /// Apply one field operation to the `--part`: append it to that part's action log
    /// and re-render that part's preview.
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
            eprintln!("sn-anim: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<(), String> {
    match cli.command {
        Command::Init => {
            let config: AnimConfig = cli::read_config(&cli.config)?;
            let volume = cli::bounds(config.extents());
            let background = config.background()?;
            // Parts are model-invented; `define-part` initializes each part's files as
            // it is created, so init only (re)initializes whatever the rig already
            // carries and renders the (blank) assembled scene.
            let parts = config.declared_parts();
            for part in &parts {
                cli::init_target(
                    volume,
                    background,
                    &config.actions_for(part),
                    &config.preview_for(part),
                    &config.mesh_for(part),
                )?;
            }
            cli::render_scene(&config)?;
            println!(
                "initialized {} part{} of {}x{}x{}",
                parts.len(),
                if parts.len() == 1 { "" } else { "s" },
                config.width,
                config.height,
                config.depth
            );
            Ok(())
        }
        Command::Scene => {
            let config: AnimConfig = cli::read_config(&cli.config)?;
            cli::render_scene(&config)?;
            println!(
                "rendered assembled scene ({} views)",
                cli::SCENE_VIEWS.len()
            );
            Ok(())
        }
        Command::Render(args) => args.run(),
        Command::DefinePart { name, parent } => {
            let config: AnimConfig = cli::read_config(&cli.config)?;
            let mut rig = Rig::load(&config.rig)?;
            let is_new = !rig.parts.iter().any(|p| p.name == name);
            rig.upsert_part(&name, parent);
            rig.save(&config.rig)?;
            // A newly defined part gets its files initialized (empty log, blank
            // preview, empty mesh) so it exists as a target immediately — even an
            // attach socket that is never sculpted. Redefining an existing part (e.g.
            // to re-parent it) leaves its sculpt untouched.
            if is_new {
                let volume = cli::bounds(config.extents());
                let background = config.background()?;
                cli::init_target(
                    volume,
                    background,
                    &config.actions_for(&name),
                    &config.preview_for(&name),
                    &config.mesh_for(&name),
                )?;
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
            let volume = cli::bounds(config.extents());
            let field_op = op.into_field_op();
            let name = field_op.name();
            let cli::ApplyResult {
                count,
                image,
                live_body,
            } = cli::apply(
                volume,
                config.background()?,
                &config.actions_for(&part),
                &config.preview_for(&part),
                &config.mesh_for(&part),
                field_op,
            )?;
            // Stream this part's re-rendered preview and geometry to the live viewer,
            // keyed by its part index. Best-effort; a no-op for an unobserved run.
            if let Some(live) = &config.live {
                let index = config
                    .declared_parts()
                    .iter()
                    .position(|p| *p == part)
                    .unwrap_or(0) as u32;
                cli::send_live_preview(
                    &live.endpoint,
                    &live.token,
                    index,
                    name,
                    count,
                    &image,
                    &live_body,
                );
            }
            // Refresh the assembled scene so its views reflect this operation.
            cli::render_scene(&config)?;
            println!(
                "applied {name} to part {part} ({count} operation{} recorded)",
                if count == 1 { "" } else { "s" }
            );
            Ok(())
        }
    }
}
