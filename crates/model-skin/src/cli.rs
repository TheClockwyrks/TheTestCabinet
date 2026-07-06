//! The shared CLI surface for the three skinning binaries.
//!
//! `mc-skin`, `sn-skin`, and `dc-skin` are near-identical: each only pins its
//! [`Algorithm`] and its config-file slug and delegates the whole command surface to
//! [`run`]. That surface is the whole-body CSG/SDF field vocabulary (identical to the
//! meshed kinds — one field, **no `--part`**), the skeleton/skin subcommands
//! (`define-bone` / `set-bone` / `define-joint` / `paint-weight`), the reused rig
//! animation subcommands (`define-animation` / `add-keyframe`), and the on-request
//! `render` (extract the surface, derive skin weights, and write the skinned `mesh.glb`
//! + preview PNG — or a linear-blend-skinned posed preview with `--time`).
//!
//! Like every voxel-family tool, a field or skeleton operation **only records** — it
//! renders nothing. The subcommands' `--help` is the contract a model reads; no schema
//! is seeded.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::{Args, Parser, Subcommand};

use test_cabinet_model_core::pose::sample_animation;
use test_cabinet_model_core::record::{self, Rendered};
use test_cabinet_model_core::render as mesh_render;
use test_cabinet_model_core::render::{MeshView, View};
use test_cabinet_model_core::rig::{Animation, Drive, Interp, Joint, JointKind, Keyframe};

use test_cabinet_voxel_mesh::{
    Algorithm, Axis, Dims, DualContouringMesher, Field, FieldOp, GridConfig, MarchingCubesMesher,
    Mesh, Mesher, Rgb, SurfaceNetsMesher, render, simplify_mesh,
};

use crate::config::{SkinConfig, read_config};
use crate::gltf::skinned_glb;
use crate::skeleton::{SkinnedRig, WeightOverride};
use crate::skin::{
    VertexSkin, bone_node_locals, compute_weights, inverse_bind_matrices, lbs_deform,
    skinning_matrices,
};

/// Parse and dispatch the skinning CLI for one binary. `algorithm` selects the grid
/// preset and mesher (and whether the DC `--sharp` tag is honored); `slug` names the
/// binary (its default config file `<slug>.config.json` and its error prefix).
pub fn run(algorithm: Algorithm, slug: &str) -> ExitCode {
    let cli = Cli::parse();
    let config_path = cli
        .config
        .clone()
        .unwrap_or_else(|| PathBuf::from(format!("{slug}.config.json")));
    match dispatch(algorithm, &config_path, cli.command) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{slug}: {message}");
            ExitCode::FAILURE
        }
    }
}

/// The skinning tool: sculpt one whole-body field, bind it to a model-invented
/// skeleton, and skin it.
#[derive(Parser)]
#[command(about = "Sculpt, rig, and skin a character, one operation at a time.")]
struct Cli {
    /// Path to the seeded config JSON (volume dimensions, background, and the log /
    /// preview / mesh `.glb` / `rig.json` / pose paths, plus an optional `live` block).
    /// Defaults to `<binary>.config.json`.
    #[arg(long, global = true)]
    config: Option<PathBuf>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Write an empty operation log and (if absent) a pre-seeded `rig.json`; renders
    /// nothing. A run starts pre-seeded, so a model does not run `init` itself.
    Init,
    /// Render on request: with no options, extract the surface, derive skin weights, and
    /// write the skinned `mesh.glb` + preview PNG. Pass `--time <ms>` (with
    /// `--animation`) to write a linear-blend-skinned **posed** preview instead. Nothing
    /// renders automatically.
    Render(RenderArgs),
    /// Add a bone to the skeleton, or update its parent if it already exists. The first
    /// bone defined is the root (empty `--parent`).
    DefineBone {
        /// The bone name.
        #[arg(long)]
        name: String,
        /// The parent bone this one attaches under (omit for the root bone).
        #[arg(long)]
        parent: Option<String>,
    },
    /// Position an existing bone's head (its default joint pivot) and tail (its
    /// direction and length), in field coordinates. A zero-length bone (`head == tail`)
    /// is a socket with no vertex influence.
    SetBone {
        /// The bone to position.
        #[arg(long)]
        name: String,
        /// Head x.
        #[arg(long)]
        head_x: f64,
        /// Head y.
        #[arg(long)]
        head_y: f64,
        /// Head z.
        #[arg(long)]
        head_z: f64,
        /// Tail x.
        #[arg(long)]
        tail_x: f64,
        /// Tail y.
        #[arg(long)]
        tail_y: f64,
        /// Tail z.
        #[arg(long)]
        tail_z: f64,
        /// Twist about the bone's own axis, in radians.
        #[arg(long, default_value_t = 0.0)]
        roll: f64,
    },
    /// Add a joint (a named degree of freedom) on a bone, or replace the joint of the
    /// same name. Semantics are identical to the rig's joints.
    DefineJoint {
        /// The joint name (the parameter a game addresses, e.g. `shoulder_l`).
        #[arg(long)]
        name: String,
        /// The bone this joint moves.
        #[arg(long)]
        bone: String,
        /// Whether the joint rotates or translates the bone.
        #[arg(long, value_enum)]
        kind: JointKind,
        /// The axis the joint acts about (rotation) or along (translation).
        #[arg(long, value_enum)]
        axis: Axis,
        /// Minimum value (radians for a rotation, field units for a translation).
        #[arg(long)]
        min: f64,
        /// Maximum value.
        #[arg(long)]
        max: f64,
        /// The rest/default value, within `[min, max]`.
        #[arg(long)]
        rest: f64,
        /// Joint-origin x. Defaults to the bone head.
        #[arg(long)]
        pivot_x: Option<f64>,
        /// Joint-origin y. Defaults to the bone head.
        #[arg(long)]
        pivot_y: Option<f64>,
        /// Joint-origin z. Defaults to the bone head.
        #[arg(long)]
        pivot_z: Option<f64>,
        /// Fixed mount translation along x (field units), applied in addition to the
        /// driven motion.
        #[arg(long, default_value_t = 0.0)]
        offset_x: f64,
        /// Fixed mount translation along y.
        #[arg(long, default_value_t = 0.0)]
        offset_y: f64,
        /// Fixed mount translation along z.
        #[arg(long, default_value_t = 0.0)]
        offset_z: f64,
        /// Fixed mount rotation about x (radians, Euler X→Y→Z about the pivot).
        #[arg(long, default_value_t = 0.0)]
        orient_x: f64,
        /// Fixed mount rotation about y.
        #[arg(long, default_value_t = 0.0)]
        orient_y: f64,
        /// Fixed mount rotation about z.
        #[arg(long, default_value_t = 0.0)]
        orient_z: f64,
        /// Who drives the joint: `caller` (a game) or `auto` (the model's animations).
        #[arg(long, value_enum, default_value = "caller")]
        drive: DriveArg,
    },
    /// Optionally override the automatic skin weight of a region — pin `--bone` to
    /// `--weight` over the `--box` region. Applied after the automatic weights.
    PaintWeight {
        /// The bone whose influence is pinned in the region.
        #[arg(long)]
        bone: String,
        /// The region as `x,y,z,w,h,d` (min corner + full extents, field units).
        #[arg(long = "box", value_parser = parse_box)]
        region: [f64; 6],
        /// The weight (0..1) to force for `bone` over that region.
        #[arg(long)]
        weight: f64,
    },
    /// Create or redefine a named animation's metadata (period, loop, auto-play).
    /// Redefining preserves already-authored tracks.
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
        /// Whether the animation plays continuously by default (a decorative idle).
        #[arg(long, default_value_t = false, action = clap::ArgAction::Set)]
        auto_play: bool,
    },
    /// Add or replace one keyframe on an animation's track for a joint.
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
        /// The joint value at this time (radians for a rotation, field units for a
        /// translation).
        #[arg(long)]
        value: f64,
        /// Interpolation of the segment leaving this key: `constant`, `linear`,
        /// `bezier`, or an easing preset `ease-in`/`ease-out`/`ease-in-out`.
        #[arg(long, value_enum, default_value = "bezier")]
        interp: InterpArg,
        /// Optional Bézier out-handle as `<dt_ms,dvalue>` (offset from the key).
        #[arg(long, value_parser = parse_handle)]
        out_handle: Option<[f64; 2]>,
        /// Optional Bézier in-handle as `<dt_ms,dvalue>` (offset from the key).
        #[arg(long, value_parser = parse_handle)]
        in_handle: Option<[f64; 2]>,
    },
    /// Record one whole-body field operation into the log. This is all it does — it
    /// renders nothing; run `render` when you want to see the character.
    #[command(flatten)]
    Op(OpCommand),
}

/// Dispatch one parsed command against the seeded config.
fn dispatch(algorithm: Algorithm, config_path: &Path, command: Command) -> Result<(), String> {
    match command {
        Command::Init => {
            let config = read_config(config_path)?;
            record::init_log::<FieldOp>(&config.actions)?;
            if !config.rig.exists() {
                SkinnedRig::new().save(&config.rig)?;
            }
            println!(
                "initialized {}x{}x{} field (run `render` to draw a preview)",
                config.width, config.height, config.depth
            );
            Ok(())
        }
        Command::Render(args) => {
            let config = read_config(config_path)?;
            let rendered = args.run(algorithm, &config)?;
            if let Some(live) = &config.live {
                let count = record::read_actions::<FieldOp>(&config.actions)
                    .map(|ops| ops.len())
                    .unwrap_or(0);
                // A skinned frame carries the whole-body glb (with its skin intact,
                // `rendered.live_body`) plus the on-disk `rig.json`, so the live viewer
                // can deform it rather than show the undeformed rest mesh. A posed
                // (`--time`) render has no glb; the rig then simply rides along unused.
                let rig_json = std::fs::read(&config.rig).unwrap_or_default();
                record::send_live_preview_with_rig(
                    &live.endpoint,
                    &live.token,
                    0,
                    "render",
                    count,
                    &rendered.image,
                    &rendered.live_body,
                    &rig_json,
                );
            }
            println!("rendered");
            Ok(())
        }
        Command::DefineBone { name, parent } => {
            let config = read_config(config_path)?;
            let mut rig = SkinnedRig::load(&config.rig)?;
            rig.upsert_bone(&name, parent);
            rig.save(&config.rig)?;
            println!("defined bone {name}");
            Ok(())
        }
        Command::SetBone {
            name,
            head_x,
            head_y,
            head_z,
            tail_x,
            tail_y,
            tail_z,
            roll,
        } => {
            let config = read_config(config_path)?;
            let mut rig = SkinnedRig::load(&config.rig)?;
            if !rig.set_bone(&name, [head_x, head_y, head_z], [tail_x, tail_y, tail_z], roll) {
                return Err(format!("no such bone `{name}` in the rig"));
            }
            rig.save(&config.rig)?;
            println!("set bone {name}");
            Ok(())
        }
        Command::DefineJoint {
            name,
            bone,
            kind,
            axis,
            min,
            max,
            rest,
            pivot_x,
            pivot_y,
            pivot_z,
            offset_x,
            offset_y,
            offset_z,
            orient_x,
            orient_y,
            orient_z,
            drive,
        } => {
            let config = read_config(config_path)?;
            let mut rig = SkinnedRig::load(&config.rig)?;
            // The pivot defaults to the bone head; a joint may override any component.
            let head = rig.bone_head(&bone).unwrap_or([0.0, 0.0, 0.0]);
            let pivot = [
                pivot_x.unwrap_or(head[0]).round() as i64,
                pivot_y.unwrap_or(head[1]).round() as i64,
                pivot_z.unwrap_or(head[2]).round() as i64,
            ];
            rig.upsert_joint(Joint {
                name: name.clone(),
                // The reused rig `Joint` names its target in `part`; for a skinned rig
                // that target is the bone.
                part: bone,
                kind,
                axis,
                pivot,
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
        Command::PaintWeight {
            bone,
            region,
            weight,
        } => {
            let config = read_config(config_path)?;
            let mut rig = SkinnedRig::load(&config.rig)?;
            rig.add_weight_override(WeightOverride {
                bone: bone.clone(),
                region,
                weight,
            });
            rig.save(&config.rig)?;
            println!("painted weight for {bone}");
            Ok(())
        }
        Command::DefineAnimation {
            name,
            period_ms,
            r#loop,
            auto_play,
        } => {
            let config = read_config(config_path)?;
            let mut rig = SkinnedRig::load(&config.rig)?;
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
            let config = read_config(config_path)?;
            let mut rig = SkinnedRig::load(&config.rig)?;
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
            let config = read_config(config_path)?;
            let field_op = op.into_field_op(honor_sharp(algorithm));
            let name = field_op.name();
            let count = record::record(&config.actions, field_op)?;
            println!(
                "recorded {name} ({count} operation{} in the log)",
                if count == 1 { "" } else { "s" }
            );
            Ok(())
        }
    }
}

/// Whether this algorithm honors the DC-only `--sharp` primitive tag.
fn honor_sharp(algorithm: Algorithm) -> bool {
    GridConfig::for_algorithm(algorithm).honor_sharp
}

/// Extract `field`'s surface with `algorithm`'s mesher, then QEM-simplify it — the
/// single chokepoint every emission path routes through.
fn extract(algorithm: Algorithm, field: &Field) -> Mesh {
    let mesh = match algorithm {
        Algorithm::MarchingCubes => MarchingCubesMesher.mesh(field),
        Algorithm::SurfaceNets => SurfaceNetsMesher.mesh(field),
        Algorithm::DualContouring => DualContouringMesher.mesh(field),
    };
    simplify_mesh(&mesh)
}

/// The world-space field [`Dims`] a `(width, height, depth)` extents triple describes.
fn bounds(extents: (u32, u32, u32)) -> Dims {
    let (w, h, d) = extents;
    Dims::new(w as f32, h as f32, d as f32)
}

/// The extracted mesh, derived skin, and loaded rig — the shared preamble of every
/// render path.
struct Skinned {
    mesh: Mesh,
    rig: SkinnedRig,
    skins: Vec<VertexSkin>,
}

/// Composite the field log, extract the surface, load the rig, and derive the automatic
/// skin weights — everything a render needs before it either encodes the skinned glb or
/// linear-blend-skins a posed preview.
fn prepare(algorithm: Algorithm, config: &SkinConfig) -> Result<Skinned, String> {
    let volume = bounds(config.extents());
    let grid = GridConfig::for_algorithm(algorithm);
    let ops = record::read_actions::<FieldOp>(&config.actions)?;
    let field: Field = render(volume, &grid, &ops);
    let mesh = extract(algorithm, &field);
    let rig = SkinnedRig::load(&config.rig)?;
    let skins = compute_weights(&mesh.positions, &rig.bones, &rig.weight_overrides);
    Ok(Skinned { mesh, rig, skins })
}

/// The `render` command: the rest render (default) or a posed (`--time`) render.
#[derive(Debug, Args)]
pub struct RenderArgs {
    /// Camera view: `iso` (default), `front`, `side`, or `top`.
    #[arg(long, value_enum)]
    pub view: Option<ViewArg>,
    /// Pose the character at this time offset (milliseconds) into an animation and
    /// render it linear-blend-skinned, so you can see how the deformation looks.
    #[arg(long)]
    pub time: Option<f64>,
    /// Which animation `--time` samples. Defaults to the sole animation, or the
    /// auto-play one; required when the rig has several and none is auto-play.
    #[arg(long)]
    pub animation: Option<String>,
    /// Override the output path (default: the configured `preview`, or `pose` for a
    /// `--time` render).
    #[arg(long)]
    pub out: Option<PathBuf>,
}

impl RenderArgs {
    /// Run the render, returning the frame so the caller can stream it live.
    fn run(&self, algorithm: Algorithm, config: &SkinConfig) -> Result<Rendered, String> {
        let view = self.view.map(View::from).unwrap_or(View::Iso);
        let prepared = prepare(algorithm, config)?;
        match self.time {
            Some(time_ms) => render_posed(config, &prepared, self.animation.as_deref(), time_ms, view, self.out.as_deref()),
            None => render_rest(config, &prepared, view, self.out.as_deref()),
        }
    }
}

/// Render the character at rest: encode the skinned `mesh.glb` and draw the preview PNG.
fn render_rest(
    config: &SkinConfig,
    prepared: &Skinned,
    view: View,
    out: Option<&Path>,
) -> Result<Rendered, String> {
    let Skinned { mesh, rig, skins } = prepared;
    let node_locals = bone_node_locals(rig);
    let ibm = inverse_bind_matrices(rig);
    let glb = skinned_glb(
        &mesh.positions,
        &mesh.normals,
        &mesh.colors,
        &mesh.indices,
        skins,
        &rig.bones,
        &node_locals,
        &ibm,
    );
    record::ensure_parent(&config.mesh)?;
    fs::write(&config.mesh, &glb)
        .map_err(|err| format!("writing mesh {}: {err}", config.mesh.display()))?;

    let image = mesh_render::render_png(
        &[mesh.view()],
        view,
        config.background()?,
        mesh_render::PREVIEW_SIZE,
    )?;
    let preview = out.map(Path::to_path_buf).unwrap_or_else(|| config.preview.clone());
    record::ensure_parent(&preview)?;
    fs::write(&preview, &image)
        .map_err(|err| format!("writing preview {}: {err}", preview.display()))?;

    Ok(Rendered {
        image,
        live_body: glb,
    })
}

/// Render the character **posed** at `time_ms` of an animation, linear-blend-skinned to
/// the resulting bone matrices. Writes only the pose image (not the `.glb`).
fn render_posed(
    config: &SkinConfig,
    prepared: &Skinned,
    animation: Option<&str>,
    time_ms: f64,
    view: View,
    out: Option<&Path>,
) -> Result<Rendered, String> {
    let Skinned { mesh, rig, skins } = prepared;
    let anim = pick_animation(&rig.animations, animation)?;
    let values = sample_animation(anim, time_ms);
    let mats = skinning_matrices(rig, &values);
    let (positions, normals) = lbs_deform(&mesh.positions, &mesh.normals, skins, &mats);

    let mesh_view = MeshView {
        positions: &positions,
        normals: &normals,
        colors: &mesh.colors,
        indices: &mesh.indices,
    };
    let image = mesh_render::render_png(
        &[mesh_view],
        view,
        config.background()?,
        mesh_render::PREVIEW_SIZE,
    )?;
    let out = out.map(Path::to_path_buf).unwrap_or_else(|| config.pose.clone());
    record::ensure_parent(&out)?;
    fs::write(&out, &image).map_err(|err| format!("writing {}: {err}", out.display()))?;

    Ok(Rendered {
        image,
        live_body: Vec::new(),
    })
}

/// Choose which animation a `--time` render samples: the named one, else the sole
/// animation, else the auto-play one — an error if the choice is ambiguous or the rig
/// has none.
fn pick_animation<'a>(
    animations: &'a [Animation],
    name: Option<&str>,
) -> Result<&'a Animation, String> {
    if let Some(name) = name {
        return animations
            .iter()
            .find(|a| a.name == name)
            .ok_or_else(|| format!("no animation `{name}` in the rig"));
    }
    match animations {
        [] => Err("the rig has no animations to pose (author one first)".to_string()),
        [only] => Ok(only),
        many => many
            .iter()
            .find(|a| a.auto_play)
            .ok_or_else(|| "the rig has several animations; name one with --animation".to_string()),
    }
}

/// A camera view as a `clap` value, mirroring [`View`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub enum ViewArg {
    /// The 3/4 orbit view (the default).
    Iso,
    /// The front elevation.
    Front,
    /// The side elevation.
    Side,
    /// The plan (top) view.
    Top,
}

impl From<ViewArg> for View {
    fn from(v: ViewArg) -> View {
        match v {
            ViewArg::Iso => View::Iso,
            ViewArg::Front => View::Front,
            ViewArg::Side => View::Side,
            ViewArg::Top => View::Top,
        }
    }
}

/// Who drives a joint, as a `clap` value: mirrors the on-disk [`Drive`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub enum DriveArg {
    /// A consuming game supplies the joint's value at runtime.
    Caller,
    /// The joint is driven only by the model's animations.
    Auto,
}

impl DriveArg {
    fn into_drive(self) -> Drive {
        match self {
            DriveArg::Caller => Drive::Caller,
            DriveArg::Auto => Drive::Auto,
        }
    }
}

/// A keyframe's interpolation, as a `clap` value: mirrors the on-disk [`Interp`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub enum InterpArg {
    Constant,
    Linear,
    Bezier,
    EaseIn,
    EaseOut,
    EaseInOut,
}

impl InterpArg {
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

/// Parse a `--color` value (`#rrggbb`) into an [`Rgb`].
fn parse_color(value: &str) -> Result<Rgb, String> {
    Rgb::parse_hex(value).map_err(|err| err.to_string())
}

/// Parse a Bézier handle `<dt_ms>,<dvalue>` into `[dt_ms, dvalue]`.
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

/// Parse a `--box` region `x,y,z,w,h,d` into `[f64; 6]`.
fn parse_box(value: &str) -> Result<[f64; 6], String> {
    let parts: Vec<&str> = value.split(',').collect();
    if parts.len() != 6 {
        return Err(format!(
            "invalid box `{value}` (expected `x,y,z,w,h,d` — six comma-separated numbers)"
        ));
    }
    let mut out = [0.0f64; 6];
    for (i, p) in parts.iter().enumerate() {
        out[i] = p
            .trim()
            .parse::<f64>()
            .map_err(|err| format!("invalid box component `{p}`: {err}"))?;
    }
    Ok(out)
}

/// A single whole-body field operation, as a `clap` subcommand.
///
/// The vocabulary is identical to the meshed kinds' — additive/subtractive primitives
/// with a smooth-`--blend` radius, opaque `#rrggbb` `--color`, and the whole-field
/// recolor/mirror/translate/copy/clear edits. Every additive primitive carries the
/// DC-only `--sharp` tag; dual contouring honors it (crisp edges), while marching cubes
/// and surface nets cannot represent it and ignore it.
#[derive(Debug, Clone, Copy, PartialEq, Subcommand)]
pub enum OpCommand {
    /// Union a solid sphere centered at `(cx, cy, cz)` with radius `r` into the field.
    AddSphere {
        /// Center x.
        #[arg(long)]
        cx: f32,
        /// Center y.
        #[arg(long)]
        cy: f32,
        /// Center z.
        #[arg(long)]
        cz: f32,
        /// Radius in world units.
        #[arg(long)]
        r: f32,
        /// The material color, as `#rrggbb`.
        #[arg(long, value_parser = parse_color)]
        color: Rgb,
        /// Smooth-union radius; `0` (the default) is a hard union.
        #[arg(long, default_value_t = 0.0)]
        blend: f32,
        /// Preserve this primitive's edges as sharp features (dual contouring only).
        #[arg(long)]
        sharp: bool,
    },
    /// Union a solid axis-aligned box centered at `(cx, cy, cz)` into the field.
    AddBox {
        /// Center x.
        #[arg(long)]
        cx: f32,
        /// Center y.
        #[arg(long)]
        cy: f32,
        /// Center z.
        #[arg(long)]
        cz: f32,
        /// Full extent along x.
        #[arg(long)]
        width: f32,
        /// Full extent along y.
        #[arg(long)]
        height: f32,
        /// Full extent along z.
        #[arg(long)]
        depth: f32,
        /// The material color, as `#rrggbb`.
        #[arg(long, value_parser = parse_color)]
        color: Rgb,
        /// Smooth-union radius; `0` (the default) is a hard union.
        #[arg(long, default_value_t = 0.0)]
        blend: f32,
        /// Preserve this primitive's edges as sharp features (dual contouring only).
        #[arg(long)]
        sharp: bool,
    },
    /// Union a solid ellipsoid centered at `(cx, cy, cz)` with per-axis radii.
    AddEllipsoid {
        /// Center x.
        #[arg(long)]
        cx: f32,
        /// Center y.
        #[arg(long)]
        cy: f32,
        /// Center z.
        #[arg(long)]
        cz: f32,
        /// Radius along x.
        #[arg(long)]
        rx: f32,
        /// Radius along y.
        #[arg(long)]
        ry: f32,
        /// Radius along z.
        #[arg(long)]
        rz: f32,
        /// The material color, as `#rrggbb`.
        #[arg(long, value_parser = parse_color)]
        color: Rgb,
        /// Smooth-union radius; `0` (the default) is a hard union.
        #[arg(long, default_value_t = 0.0)]
        blend: f32,
        /// Preserve this primitive's edges as sharp features (dual contouring only).
        #[arg(long)]
        sharp: bool,
    },
    /// Union a solid capped cylinder centered at `(cx, cy, cz)` along `axis`.
    AddCylinder {
        /// Center x.
        #[arg(long)]
        cx: f32,
        /// Center y.
        #[arg(long)]
        cy: f32,
        /// Center z.
        #[arg(long)]
        cz: f32,
        /// Disc radius (perpendicular to `axis`).
        #[arg(long)]
        r: f32,
        /// Full length along `axis`.
        #[arg(long)]
        height: f32,
        /// The axis the cylinder extends along.
        #[arg(long, value_enum)]
        axis: Axis,
        /// The material color, as `#rrggbb`.
        #[arg(long, value_parser = parse_color)]
        color: Rgb,
        /// Smooth-union radius; `0` (the default) is a hard union.
        #[arg(long, default_value_t = 0.0)]
        blend: f32,
        /// Preserve this primitive's edges as sharp features (dual contouring only).
        #[arg(long)]
        sharp: bool,
    },
    /// Carve a sphere out of the field (smooth when `--blend > 0`).
    SubtractSphere {
        /// Center x.
        #[arg(long)]
        cx: f32,
        /// Center y.
        #[arg(long)]
        cy: f32,
        /// Center z.
        #[arg(long)]
        cz: f32,
        /// Radius in world units.
        #[arg(long)]
        r: f32,
        /// Smooth-subtraction radius; `0` (the default) is a hard cut.
        #[arg(long, default_value_t = 0.0)]
        blend: f32,
    },
    /// Carve an axis-aligned box out of the field (smooth when `--blend > 0`).
    SubtractBox {
        /// Center x.
        #[arg(long)]
        cx: f32,
        /// Center y.
        #[arg(long)]
        cy: f32,
        /// Center z.
        #[arg(long)]
        cz: f32,
        /// Full extent along x.
        #[arg(long)]
        width: f32,
        /// Full extent along y.
        #[arg(long)]
        height: f32,
        /// Full extent along z.
        #[arg(long)]
        depth: f32,
        /// Smooth-subtraction radius; `0` (the default) is a hard cut.
        #[arg(long, default_value_t = 0.0)]
        blend: f32,
    },
    /// Carve an ellipsoid out of the field (smooth when `--blend > 0`).
    SubtractEllipsoid {
        /// Center x.
        #[arg(long)]
        cx: f32,
        /// Center y.
        #[arg(long)]
        cy: f32,
        /// Center z.
        #[arg(long)]
        cz: f32,
        /// Radius along x.
        #[arg(long)]
        rx: f32,
        /// Radius along y.
        #[arg(long)]
        ry: f32,
        /// Radius along z.
        #[arg(long)]
        rz: f32,
        /// Smooth-subtraction radius; `0` (the default) is a hard cut.
        #[arg(long, default_value_t = 0.0)]
        blend: f32,
    },
    /// Carve a capped cylinder out of the field (smooth when `--blend > 0`).
    SubtractCylinder {
        /// Center x.
        #[arg(long)]
        cx: f32,
        /// Center y.
        #[arg(long)]
        cy: f32,
        /// Center z.
        #[arg(long)]
        cz: f32,
        /// Disc radius (perpendicular to `axis`).
        #[arg(long)]
        r: f32,
        /// Full length along `axis`.
        #[arg(long)]
        height: f32,
        /// The axis the cylinder extends along.
        #[arg(long, value_enum)]
        axis: Axis,
        /// Smooth-subtraction radius; `0` (the default) is a hard cut.
        #[arg(long, default_value_t = 0.0)]
        blend: f32,
    },
    /// Recolor every node carrying color `from` to color `to`, across the whole field.
    ReplaceColor {
        /// The color to match, as `#rrggbb`.
        #[arg(long, value_parser = parse_color)]
        from: Rgb,
        /// The color to write in its place, as `#rrggbb`.
        #[arg(long, value_parser = parse_color)]
        to: Rgb,
    },
    /// Mirror the field across the plane at `at` along `plane`, unioning the low side
    /// onto the high side — the highest-leverage op for a symmetric character.
    Mirror {
        /// The plane's normal axis (`x`, `y`, or `z`).
        #[arg(long, value_enum)]
        plane: Axis,
        /// The mirror position along `plane`, in world units.
        #[arg(long)]
        at: f32,
    },
    /// Shift the whole field by `(dx, dy, dz)` world units.
    Translate {
        /// Shift along x.
        #[arg(long)]
        dx: f32,
        /// Shift along y.
        #[arg(long)]
        dy: f32,
        /// Shift along z.
        #[arg(long)]
        dz: f32,
    },
    /// Copy the field within a source box to a destination offset, unioning it in.
    Copy {
        /// Source minimum-corner x.
        #[arg(long)]
        x: f32,
        /// Source minimum-corner y.
        #[arg(long)]
        y: f32,
        /// Source minimum-corner z.
        #[arg(long)]
        z: f32,
        /// Source extent along x.
        #[arg(long)]
        width: f32,
        /// Source extent along y.
        #[arg(long)]
        height: f32,
        /// Source extent along z.
        #[arg(long)]
        depth: f32,
        /// Destination offset along x.
        #[arg(long)]
        dx: f32,
        /// Destination offset along y.
        #[arg(long)]
        dy: f32,
        /// Destination offset along z.
        #[arg(long)]
        dz: f32,
    },
    /// Reset the field to empty.
    Clear,
}

impl OpCommand {
    /// Convert the parsed subcommand into the recorded [`FieldOp`]. `honor_sharp` gates
    /// the DC-only sharp tag: for marching cubes and surface nets it is forced off, so
    /// the primitive is tagged `sharp: false` regardless of the flag.
    pub fn into_field_op(self, honor_sharp: bool) -> FieldOp {
        let sharp_of = |flag: bool| flag && honor_sharp;
        match self {
            OpCommand::AddSphere {
                cx,
                cy,
                cz,
                r,
                color,
                blend,
                sharp,
            } => FieldOp::AddSphere {
                cx,
                cy,
                cz,
                r,
                color,
                blend,
                sharp: sharp_of(sharp),
            },
            OpCommand::AddBox {
                cx,
                cy,
                cz,
                width,
                height,
                depth,
                color,
                blend,
                sharp,
            } => FieldOp::AddBox {
                cx,
                cy,
                cz,
                width,
                height,
                depth,
                color,
                blend,
                sharp: sharp_of(sharp),
            },
            OpCommand::AddEllipsoid {
                cx,
                cy,
                cz,
                rx,
                ry,
                rz,
                color,
                blend,
                sharp,
            } => FieldOp::AddEllipsoid {
                cx,
                cy,
                cz,
                rx,
                ry,
                rz,
                color,
                blend,
                sharp: sharp_of(sharp),
            },
            OpCommand::AddCylinder {
                cx,
                cy,
                cz,
                r,
                height,
                axis,
                color,
                blend,
                sharp,
            } => FieldOp::AddCylinder {
                cx,
                cy,
                cz,
                r,
                height,
                axis,
                color,
                blend,
                sharp: sharp_of(sharp),
            },
            OpCommand::SubtractSphere {
                cx,
                cy,
                cz,
                r,
                blend,
            } => FieldOp::SubtractSphere {
                cx,
                cy,
                cz,
                r,
                blend,
                sharp: false,
            },
            OpCommand::SubtractBox {
                cx,
                cy,
                cz,
                width,
                height,
                depth,
                blend,
            } => FieldOp::SubtractBox {
                cx,
                cy,
                cz,
                width,
                height,
                depth,
                blend,
                sharp: false,
            },
            OpCommand::SubtractEllipsoid {
                cx,
                cy,
                cz,
                rx,
                ry,
                rz,
                blend,
            } => FieldOp::SubtractEllipsoid {
                cx,
                cy,
                cz,
                rx,
                ry,
                rz,
                blend,
                sharp: false,
            },
            OpCommand::SubtractCylinder {
                cx,
                cy,
                cz,
                r,
                height,
                axis,
                blend,
            } => FieldOp::SubtractCylinder {
                cx,
                cy,
                cz,
                r,
                height,
                axis,
                blend,
                sharp: false,
            },
            OpCommand::ReplaceColor { from, to } => FieldOp::ReplaceColor { from, to },
            OpCommand::Mirror { plane, at } => FieldOp::Mirror { plane, at },
            OpCommand::Translate { dx, dy, dz } => FieldOp::Translate { dx, dy, dz },
            OpCommand::Copy {
                x,
                y,
                z,
                width,
                height,
                depth,
                dx,
                dy,
                dz,
            } => FieldOp::Copy {
                x,
                y,
                z,
                width,
                height,
                depth,
                dx,
                dy,
                dz,
            },
            OpCommand::Clear => FieldOp::Clear,
        }
    }
}
