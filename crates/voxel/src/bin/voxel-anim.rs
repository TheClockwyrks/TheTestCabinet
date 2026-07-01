//! The `voxel-anim` CLI: sculpting a rigged, **animated** model, one part at a time.
//!
//! This binary extends [`voxel`](../voxel.rs) with a required `--part <name>`: the
//! sculpting operations and how each applies are **identical**, but each part has
//! its **own action log and preview** — separate files — though every part is
//! sculpted in the **same shared volume's coordinates**, in place where it sits on
//! the assembled model. On top of the per-part sculpting it maintains the rig
//! structure in `rig.json`: the parts' hierarchy and the named joints a consuming
//! game (or an auto-play clip) drives. The manifest pre-seeds the required parts
//! and joints; the `define-part` / `set-pivot` / `define-joint` / `define-clip`
//! subcommands let the model add its own or refine the seeded ones.
//!
//! The operation subcommands are shared with `voxel`, so their `--help` is the same
//! contract; no operations schema is seeded. Like `voxel`, this binary does **not**
//! write `voxels.json`; the validator regenerates each part's from its log.
//!
//! See `apps/docs/src/content/docs/testing/asset-generation/`.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use test_cabinet_voxel::Axis;
use test_cabinet_voxel::cli::{self, AnimConfig, OpCommand, RenderArgs};
use test_cabinet_voxel::rig::{Drive, Joint, JointKind, Keyframe, Rig};

/// The sculpting tool for rigged, animated asset-generation test cases.
#[derive(Parser)]
#[command(
    name = "voxel-anim",
    about = "Sculpt a rigged voxel model, one part and one operation at a time."
)]
struct Cli {
    /// Path to the rig config JSON (`{ width, height, depth, background, parts,
    /// actions, preview, scene, rig }`). Read by `init` and every sculpting operation.
    #[arg(long, default_value = "voxel-anim.config.json", global = true)]
    config: PathBuf,
    /// Which part to sculpt into. **Required** for a sculpting operation; each part
    /// has its own action log and preview, all in the shared volume's coordinates.
    #[arg(long, global = true)]
    part: Option<String>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Initialize every declared part: write an empty action log and a blank
    /// preview per part so the run starts from a known, empty state.
    Init,
    /// Re-render the assembled scene (every part composed at rest) from the current
    /// per-part logs, writing one PNG per view (`iso`, `front`, `side`, `top`).
    /// Runs automatically after every sculpting operation; this is the manual form.
    Scene,
    /// Regenerate a preview from an action log without modifying it.
    Render(RenderArgs),
    /// Add a part to the rig, or update its parent if it already exists.
    DefinePart {
        /// The part name.
        #[arg(long)]
        name: String,
        /// The parent part this one attaches to (omit for the root part).
        #[arg(long)]
        parent: Option<String>,
    },
    /// Set an existing part's pivot: the point, in the shared volume's coordinates
    /// (the same coordinates the part is sculpted in), that its joints rotate about.
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
        /// The axis the joint acts about (rotation) or along (translation).
        #[arg(long, value_enum)]
        axis: Axis,
        /// Joint-origin x, in the shared volume's coordinates (the same coordinates
        /// the part is sculpted in): the point the joint rotates about.
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
        /// Who drives the joint: `caller` (a game) or `auto` (an auto-play clip).
        /// An `auto` joint starts with an empty clip; fill it with `define-clip`.
        #[arg(long, value_enum, default_value = "caller")]
        drive: DriveArg,
    },
    /// Define (or replace) the auto-play clip on a joint, marking it auto-driven.
    DefineClip {
        /// The joint to animate.
        #[arg(long)]
        joint: String,
        /// The clip period in milliseconds (one full loop).
        #[arg(long)]
        period_ms: u32,
        /// Whether the clip loops (default) or holds the last keyframe.
        #[arg(long, default_value_t = true, action = clap::ArgAction::Set)]
        r#loop: bool,
        /// A keyframe as `<t_ms>:<value>`, repeated in time order (for example
        /// `--keyframe 0:0.0 --keyframe 500:1.57`).
        #[arg(long = "keyframe", value_parser = parse_keyframe)]
        keyframes: Vec<Keyframe>,
    },
    /// Apply one sculpting operation to the `--part`: append it to that part's
    /// action log and re-render that part's preview.
    #[command(flatten)]
    Op(OpCommand),
}

/// Who drives a joint, as a `clap` value: mirrors the `caller`/`auto` tag of the
/// on-disk [`Drive`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
enum DriveArg {
    /// A consuming game supplies the joint's value at runtime.
    Caller,
    /// The joint animates itself from a looping keyframe clip.
    Auto,
}

impl DriveArg {
    /// The on-disk [`Drive`] this choice produces. `Auto` starts with an empty
    /// clip; `define-clip` fills it in.
    fn into_drive(self) -> Drive {
        match self {
            DriveArg::Caller => Drive::Caller,
            DriveArg::Auto => Drive::AutoPlay {
                keyframes: Vec::new(),
                period_ms: 0,
                r#loop: true,
            },
        }
    }
}

/// Parse a `--keyframe` value of the form `<t_ms>:<value>` into a [`Keyframe`].
fn parse_keyframe(value: &str) -> Result<Keyframe, String> {
    let (t, v) = value
        .split_once(':')
        .ok_or_else(|| format!("invalid keyframe `{value}` (expected `<t_ms>:<value>`)"))?;
    let t_ms = t
        .trim()
        .parse::<u32>()
        .map_err(|err| format!("invalid keyframe time `{t}`: {err}"))?;
    let value = v
        .trim()
        .parse::<f64>()
        .map_err(|err| format!("invalid keyframe value `{v}`: {err}"))?;
    Ok(Keyframe { t_ms, value })
}

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("voxel-anim: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<(), String> {
    match cli.command {
        Command::Init => {
            let config: AnimConfig = cli::read_config(&cli.config)?;
            let dims = config.dims();
            let background = config.background()?;
            for part in &config.parts {
                cli::init_target(
                    &dims,
                    background,
                    &config.actions_for(part),
                    &config.preview_for(part),
                )?;
            }
            // Render the (blank) assembled scene too, so every scene view exists
            // from the start and updates in step with the per-part previews.
            cli::render_scene(&config)?;
            println!(
                "initialized {} part{} of {}x{}x{}",
                config.parts.len(),
                if config.parts.len() == 1 { "" } else { "s" },
                dims.width,
                dims.height,
                dims.depth
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
            rig.upsert_part(&name, parent);
            rig.save(&config.rig)?;
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
                drive: drive.into_drive(),
            });
            rig.save(&config.rig)?;
            println!("defined joint {name}");
            Ok(())
        }
        Command::DefineClip {
            joint,
            period_ms,
            r#loop,
            keyframes,
        } => {
            let config: AnimConfig = cli::read_config(&cli.config)?;
            let mut rig = Rig::load(&config.rig)?;
            let target = rig
                .joints
                .iter_mut()
                .find(|j| j.name == joint)
                .ok_or_else(|| format!("no such joint `{joint}` in the rig"))?;
            let count = keyframes.len();
            target.drive = Drive::AutoPlay {
                keyframes,
                period_ms,
                r#loop,
            };
            rig.save(&config.rig)?;
            println!(
                "defined clip on {joint} ({count} keyframe{})",
                plural(count)
            );
            Ok(())
        }
        Command::Op(op) => {
            let part = cli
                .part
                .ok_or_else(|| "a sculpting operation requires --part <name>".to_string())?;
            let config: AnimConfig = cli::read_config(&cli.config)?;
            if !config.has_part(&part) {
                return Err(format!(
                    "part `{part}` is not a declared part (declared: {:?})",
                    config.parts
                ));
            }
            let dims = config.dims();
            let name = op.name();
            let (count, image) = cli::apply(
                &dims,
                config.background()?,
                &config.actions_for(&part),
                &config.preview_for(&part),
                op.into_operation(),
            )?;
            // Stream this part's re-rendered preview to the live viewer, keyed by
            // its part index. Best-effort; a no-op for an unobserved run.
            if let Some(live) = &config.live {
                let index = config.parts.iter().position(|p| *p == part).unwrap_or(0) as u32;
                cli::send_live_preview(live, index, name, count, &image);
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

fn plural(count: usize) -> &'static str {
    if count == 1 { "" } else { "s" }
}
