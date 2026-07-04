//! The cube tool's CLI support: the sculpting-operation subcommands and the cube
//! backend that plugs into the generic record/preview plumbing.
//!
//! Both `voxel` (a single static model) and `voxel-anim` (a rigged model, one
//! separate file set per part) drive the **same** cube sculpting operations through
//! `clap`; this module defines those operation subcommands, the append-only
//! [`record`](record::record) wrapper each operation calls, and the on-request
//! `render` half — [`render_target_files`] plus the [`RenderArgs`]/[`AnimRenderArgs`]
//! commands — that meshes a recorded log into a preview PNG and a per-part `.glb`. The
//! only difference between the binaries is whether an operation targets one volume or
//! one of many independent per-part volumes — the operations themselves, and how each
//! one applies, are identical.
//!
//! The operation subcommands' help text is the contract a model reads: an
//! asset-generation case seeds no operations schema, it tells the model to run the
//! binary's `--help`. So the doc comments here mirror [`Operation`]'s and are the
//! authoritative description of the sculpting vocabulary.

use std::fs;
use std::path::{Path, PathBuf};

use clap::{Args, Subcommand};

use test_cabinet_model_core::pose;
use test_cabinet_model_core::record;
use test_cabinet_model_core::render as mesh_render;
use test_cabinet_model_core::render::{MeshView, View};
use test_cabinet_model_core::rig::{Animation, Rig};

use crate::color::Rgb;
use crate::mesh::{PartMesh, build_part_mesh};
use crate::{Axis, Dims, Operation, PreviewBackground, VoxelSet, render};

// Re-export the generic config/record surface the binaries reach as
// `test_cabinet_voxel::cli::…`, so the split is invisible to them.
pub use test_cabinet_model_core::config::{AnimConfig, Config, LiveConfig, read_config};
pub use test_cabinet_model_core::record::{Rendered, send_live_preview, write_actions};

/// A single sculpting operation, expressed as a `clap` subcommand.
///
/// The variants and their arguments mirror [`Operation`] one-for-one;
/// [`OpCommand::into_operation`] is the single place the CLI form and the recorded
/// wire form meet. Coordinates are signed so a shape may be placed partially
/// outside the volume (the outside portion is clipped); sizes and radii are
/// unsigned. Voxels are opaque and replace whatever they touch, so the recorded log
/// regenerates to an exact, order-only volume.
#[derive(Debug, Clone, PartialEq, Eq, Subcommand)]
pub enum OpCommand {
    /// Set a single voxel.
    SetVoxel {
        /// Position along x (0 at the left).
        #[arg(long)]
        x: i64,
        /// Position along y (0 at the bottom, up is positive).
        #[arg(long)]
        y: i64,
        /// Position along z (0 at the front).
        #[arg(long)]
        z: i64,
        /// The voxel color, as `#rrggbb`.
        #[arg(long, value_parser = parse_color)]
        color: Rgb,
    },
    /// Fill an axis-aligned box. `(x, y, z)` is the minimum corner.
    FillBox {
        /// Minimum-corner x.
        #[arg(long)]
        x: i64,
        /// Minimum-corner y.
        #[arg(long)]
        y: i64,
        /// Minimum-corner z.
        #[arg(long)]
        z: i64,
        /// Extent along x, in voxels.
        #[arg(long)]
        width: u32,
        /// Extent along y, in voxels.
        #[arg(long)]
        height: u32,
        /// Extent along z, in voxels.
        #[arg(long)]
        depth: u32,
        /// The fill color, as `#rrggbb`.
        #[arg(long, value_parser = parse_color)]
        color: Rgb,
    },
    /// Fill only the shell (the 12 edges) of an axis-aligned box, leaving its
    /// interior and faces empty — the 3D analog of a rectangle outline.
    StrokeBox {
        /// Minimum-corner x.
        #[arg(long)]
        x: i64,
        /// Minimum-corner y.
        #[arg(long)]
        y: i64,
        /// Minimum-corner z.
        #[arg(long)]
        z: i64,
        /// Extent along x, in voxels.
        #[arg(long)]
        width: u32,
        /// Extent along y, in voxels.
        #[arg(long)]
        height: u32,
        /// Extent along z, in voxels.
        #[arg(long)]
        depth: u32,
        /// The edge color, as `#rrggbb`.
        #[arg(long, value_parser = parse_color)]
        color: Rgb,
    },
    /// Fill a solid ball centered at `(cx, cy, cz)` with radius `r`.
    FillSphere {
        /// Center x.
        #[arg(long)]
        cx: i64,
        /// Center y.
        #[arg(long)]
        cy: i64,
        /// Center z.
        #[arg(long)]
        cz: i64,
        /// Radius in voxels.
        #[arg(long)]
        r: u32,
        /// The fill color, as `#rrggbb`.
        #[arg(long, value_parser = parse_color)]
        color: Rgb,
    },
    /// Draw a 1-voxel-thick line between two points (inclusive of both endpoints).
    Line {
        /// Start x.
        #[arg(long)]
        x0: i64,
        /// Start y.
        #[arg(long)]
        y0: i64,
        /// Start z.
        #[arg(long)]
        z0: i64,
        /// End x.
        #[arg(long)]
        x1: i64,
        /// End y.
        #[arg(long)]
        y1: i64,
        /// End z.
        #[arg(long)]
        z1: i64,
        /// The line color, as `#rrggbb`.
        #[arg(long, value_parser = parse_color)]
        color: Rgb,
    },
    /// Mirror the voxels on the low side of a plane onto the high side, reflecting
    /// across the plane between slice `at - 1` and slice `at`. The single
    /// highest-leverage op for a symmetric model.
    Mirror {
        /// The plane's normal axis (`x`, `y`, or `z`).
        #[arg(long, value_enum)]
        plane: Axis,
        /// The mirror position along `plane`: slices `0..at` are copied onto `at..`.
        #[arg(long)]
        at: u32,
    },
    /// Clear a single voxel, emptying its cell.
    ClearVoxel {
        /// Position along x.
        #[arg(long)]
        x: i64,
        /// Position along y.
        #[arg(long)]
        y: i64,
        /// Position along z.
        #[arg(long)]
        z: i64,
    },
    /// Clear an axis-aligned box, emptying every cell it covers. `(x, y, z)` is the
    /// minimum corner.
    ClearBox {
        /// Minimum-corner x.
        #[arg(long)]
        x: i64,
        /// Minimum-corner y.
        #[arg(long)]
        y: i64,
        /// Minimum-corner z.
        #[arg(long)]
        z: i64,
        /// Extent along x, in voxels.
        #[arg(long)]
        width: u32,
        /// Extent along y, in voxels.
        #[arg(long)]
        height: u32,
        /// Extent along z, in voxels.
        #[arg(long)]
        depth: u32,
    },
    /// Fill a solid cylinder of radius `r` and length `height` from the base plane
    /// through `(cx, cy, cz)` along the positive `axis` direction (barrels, legs,
    /// poles, wheels). The disc is centered on the two off-axis coordinates.
    FillCylinder {
        /// Center x of the base disc.
        #[arg(long)]
        cx: i64,
        /// Center y of the base disc.
        #[arg(long)]
        cy: i64,
        /// Center z of the base disc.
        #[arg(long)]
        cz: i64,
        /// Disc radius in voxels (perpendicular to `axis`).
        #[arg(long)]
        r: u32,
        /// Length along `axis`, in voxels.
        #[arg(long)]
        height: u32,
        /// The axis the cylinder extends along.
        #[arg(long, value_enum)]
        axis: Axis,
        /// The fill color, as `#rrggbb`.
        #[arg(long, value_parser = parse_color)]
        color: Rgb,
    },
    /// Fill a solid ellipsoid centered at `(cx, cy, cz)` with per-axis radii — the
    /// generalization of `fill-sphere` to unequal radii (domes, eggs, boulders).
    FillEllipsoid {
        /// Center x.
        #[arg(long)]
        cx: i64,
        /// Center y.
        #[arg(long)]
        cy: i64,
        /// Center z.
        #[arg(long)]
        cz: i64,
        /// Radius along x, in voxels.
        #[arg(long)]
        rx: u32,
        /// Radius along y, in voxels.
        #[arg(long)]
        ry: u32,
        /// Radius along z, in voxels.
        #[arg(long)]
        rz: u32,
        /// The fill color, as `#rrggbb`.
        #[arg(long, value_parser = parse_color)]
        color: Rgb,
    },
    /// Recolor every occupied voxel of one color to another, across the whole volume
    /// — a palette swap or shading pass. Empty cells and other colors are untouched.
    ReplaceColor {
        /// The color to match, as `#rrggbb`.
        #[arg(long, value_parser = parse_color)]
        from: Rgb,
        /// The color to write in its place, as `#rrggbb`.
        #[arg(long, value_parser = parse_color)]
        to: Rgb,
    },
    /// Shift every occupied voxel by `(dx, dy, dz)`, clearing vacated cells; voxels
    /// pushed outside the volume are dropped. Repositions an entire part.
    Translate {
        /// Shift along x, in voxels.
        #[arg(long)]
        dx: i64,
        /// Shift along y, in voxels.
        #[arg(long)]
        dy: i64,
        /// Shift along z, in voxels.
        #[arg(long)]
        dz: i64,
    },
    /// Copy the occupied voxels in a source box to a destination offset by
    /// `(dx, dy, dz)`, overwriting the destination (empty source cells do not clear
    /// it). Source and destination may overlap. `(x, y, z)` is the source min corner.
    CopyBox {
        /// Source minimum-corner x.
        #[arg(long)]
        x: i64,
        /// Source minimum-corner y.
        #[arg(long)]
        y: i64,
        /// Source minimum-corner z.
        #[arg(long)]
        z: i64,
        /// Source extent along x, in voxels.
        #[arg(long)]
        width: u32,
        /// Source extent along y, in voxels.
        #[arg(long)]
        height: u32,
        /// Source extent along z, in voxels.
        #[arg(long)]
        depth: u32,
        /// Destination offset along x, in voxels.
        #[arg(long)]
        dx: i64,
        /// Destination offset along y, in voxels.
        #[arg(long)]
        dy: i64,
        /// Destination offset along z, in voxels.
        #[arg(long)]
        dz: i64,
    },
}

impl OpCommand {
    /// Convert the parsed subcommand into the [`Operation`] recorded in the action
    /// log and replayed by the renderer.
    pub fn into_operation(self) -> Operation {
        match self {
            OpCommand::SetVoxel { x, y, z, color } => Operation::SetVoxel { x, y, z, color },
            OpCommand::FillBox {
                x,
                y,
                z,
                width,
                height,
                depth,
                color,
            } => Operation::FillBox {
                x,
                y,
                z,
                width,
                height,
                depth,
                color,
            },
            OpCommand::StrokeBox {
                x,
                y,
                z,
                width,
                height,
                depth,
                color,
            } => Operation::StrokeBox {
                x,
                y,
                z,
                width,
                height,
                depth,
                color,
            },
            OpCommand::FillSphere {
                cx,
                cy,
                cz,
                r,
                color,
            } => Operation::FillSphere {
                cx,
                cy,
                cz,
                r,
                color,
            },
            OpCommand::Line {
                x0,
                y0,
                z0,
                x1,
                y1,
                z1,
                color,
            } => Operation::Line {
                x0,
                y0,
                z0,
                x1,
                y1,
                z1,
                color,
            },
            OpCommand::Mirror { plane, at } => Operation::Mirror { plane, at },
            OpCommand::ClearVoxel { x, y, z } => Operation::ClearVoxel { x, y, z },
            OpCommand::ClearBox {
                x,
                y,
                z,
                width,
                height,
                depth,
            } => Operation::ClearBox {
                x,
                y,
                z,
                width,
                height,
                depth,
            },
            OpCommand::FillCylinder {
                cx,
                cy,
                cz,
                r,
                height,
                axis,
                color,
            } => Operation::FillCylinder {
                cx,
                cy,
                cz,
                r,
                height,
                axis,
                color,
            },
            OpCommand::FillEllipsoid {
                cx,
                cy,
                cz,
                rx,
                ry,
                rz,
                color,
            } => Operation::FillEllipsoid {
                cx,
                cy,
                cz,
                rx,
                ry,
                rz,
                color,
            },
            OpCommand::ReplaceColor { from, to } => Operation::ReplaceColor { from, to },
            OpCommand::Translate { dx, dy, dz } => Operation::Translate { dx, dy, dz },
            OpCommand::CopyBox {
                x,
                y,
                z,
                width,
                height,
                depth,
                dx,
                dy,
                dz,
            } => Operation::CopyBox {
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
        }
    }

    /// The wire tag of the operation this subcommand produces, for the
    /// human-readable confirmation line the binaries print.
    pub fn name(&self) -> &'static str {
        match self {
            OpCommand::SetVoxel { .. } => "set_voxel",
            OpCommand::FillBox { .. } => "fill_box",
            OpCommand::StrokeBox { .. } => "stroke_box",
            OpCommand::FillSphere { .. } => "fill_sphere",
            OpCommand::Line { .. } => "line",
            OpCommand::Mirror { .. } => "mirror",
            OpCommand::ClearVoxel { .. } => "clear_voxel",
            OpCommand::ClearBox { .. } => "clear_box",
            OpCommand::FillCylinder { .. } => "fill_cylinder",
            OpCommand::FillEllipsoid { .. } => "fill_ellipsoid",
            OpCommand::ReplaceColor { .. } => "replace_color",
            OpCommand::Translate { .. } => "translate",
            OpCommand::CopyBox { .. } => "copy_box",
        }
    }
}

/// Parse a `--color` value (`#rrggbb`) into an [`Rgb`], mapping a parse error to
/// the string `clap` shows the user.
fn parse_color(value: &str) -> Result<Rgb, String> {
    Rgb::parse_hex(value).map_err(|err| err.to_string())
}

/// Render one cube target's log to disk on request: mesh the [`VoxelSet`] the
/// [`Operation`]s produce, write its face-culled per-part `.glb`, and render the
/// chosen [`View`] to the preview PNG. Returns the PNG bytes and the `.glb` bytes so a
/// caller streaming a live frame need not re-read them.
///
/// This is the render half of the tool, reached only by the `render` command — a
/// sculpting operation records to the log and renders nothing.
fn render_target_files(
    dims: &Dims,
    background: PreviewBackground,
    ops: &[Operation],
    view: View,
    preview: &Path,
    mesh: &Path,
) -> Result<record::Rendered, String> {
    let set = render(dims, ops);

    // The face-culled surface mesh is the single source of geometry: it is what the
    // preview renderer draws and what every downstream consumer reads.
    let part_mesh = build_part_mesh(&set);
    let mesh_glb = test_cabinet_model_core::part_mesh_to_glb(
        &part_mesh.positions,
        &part_mesh.normals,
        &part_mesh.colors,
        &part_mesh.indices,
    );
    record::ensure_parent(mesh)?;
    fs::write(mesh, &mesh_glb).map_err(|err| format!("writing mesh {}: {err}", mesh.display()))?;

    let image = mesh_render::render_png(
        &[mesh_view(&part_mesh)],
        view,
        background,
        mesh_render::PREVIEW_SIZE,
    )?;
    record::ensure_parent(preview)?;
    fs::write(preview, &image)
        .map_err(|err| format!("writing preview {}: {err}", preview.display()))?;

    Ok(record::Rendered {
        image,
        // The face-culled part `.glb` (the `PartMesh` the 3D client renders) — the same
        // geometry every voxel-family binary streams live, so the live viewer rebuilds
        // the model from a mesh, never re-meshing.
        live_body: mesh_glb,
    })
}

/// Borrow a [`PartMesh`]'s flat arrays as a [`MeshView`] for the preview renderer.
fn mesh_view(mesh: &PartMesh) -> MeshView<'_> {
    MeshView {
        positions: &mesh.positions,
        normals: &mesh.normals,
        colors: &mesh.colors,
        indices: &mesh.indices,
    }
}

/// The [`Dims`] a `(width, height, depth)` extents triple describes.
pub fn dims(extents: (u32, u32, u32)) -> Dims {
    let (width, height, depth) = extents;
    Dims {
        width,
        height,
        depth,
    }
}

/// Record one operation to a target's action log, returning the log's new operation
/// count. This is all a sculpting operation does — no meshing, no preview, no stream.
pub fn record(actions: &Path, operation: Operation) -> Result<usize, String> {
    record::record(actions, operation)
}

/// Initialize one target's action log to empty. Renders nothing (rendering is the
/// `render` command's job).
pub fn init_log(actions: &Path) -> Result<(), String> {
    record::init_log::<Operation>(actions)
}

/// Read the cube action log, treating an absent file as an empty log so the first
/// operation of a run does not need a separate `init`.
pub fn read_actions(path: &Path) -> Result<Vec<Operation>, String> {
    record::read_actions(path)
}

/// A camera view as a `clap` value, mirroring [`View`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub enum ViewArg {
    /// The 3/4 orbit view, from the front-top-right (the default).
    Iso,
    /// The front elevation (looking along `-z`).
    Front,
    /// The side elevation (looking along `-x`).
    Side,
    /// The plan (top) view (looking straight down `-y`).
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

/// The static `render` command: regenerate the model's mesh `.glb` and preview PNG
/// from its recorded log, on request. Rendering never happens automatically — a
/// sculpting operation only records — so the model runs this to inspect its work and,
/// before finishing, to emit the geometry the run's result is built from.
#[derive(Debug, Args)]
pub struct RenderArgs {
    /// Camera view for the preview: `iso` (default), `front`, `side`, or `top`.
    #[arg(long, value_enum, default_value = "iso")]
    pub view: ViewArg,
    /// Override the preview output path (default: the configured `preview`). The mesh
    /// `.glb` is always written to the configured `mesh`.
    #[arg(long)]
    pub out: Option<PathBuf>,
}

impl RenderArgs {
    /// Render the configured model log: write the mesh `.glb` and the preview PNG,
    /// returning the rendered frame so the caller can stream it to a live viewer.
    pub fn run(&self, config: &Config) -> Result<record::Rendered, String> {
        let volume = dims(config.extents());
        let operations = read_actions(&config.actions)?;
        let preview = self.out.clone().unwrap_or_else(|| config.preview.clone());
        render_target_files(
            &volume,
            config.background()?,
            &operations,
            self.view.into(),
            &preview,
            &config.mesh,
        )
    }
}

/// The animated `render` command: on request, render the assembled rest scene (the
/// default), a single `--component` part, or the model **posed** at a `--time` of one
/// of its animations. Like the static form, nothing renders automatically.
#[derive(Debug, Args)]
pub struct AnimRenderArgs {
    /// Render only this part — its own preview PNG and `.glb` — instead of the
    /// assembled scene.
    #[arg(long)]
    pub component: Option<String>,
    /// Pose the assembled model at this time offset (milliseconds) into an animation
    /// before rendering, so you can see how the animation looks at that instant. Poses
    /// the whole scene; not combinable with `--component`.
    #[arg(long)]
    pub time: Option<f64>,
    /// Which animation `--time` samples. Defaults to the sole animation, or the
    /// auto-play one; required when the rig has several and none is auto-play.
    #[arg(long)]
    pub animation: Option<String>,
    /// Camera view for a `--component` or `--time` render (default `iso`). The rest
    /// scene always renders all four views.
    #[arg(long, value_enum)]
    pub view: Option<ViewArg>,
    /// Override the output path for a `--component` (its preview) or `--time` (the
    /// posed image, default `scene/pose.png`) render.
    #[arg(long)]
    pub out: Option<PathBuf>,
}

impl AnimRenderArgs {
    /// Run the render. Returns a rendered frame for a single-part render (so the
    /// caller can stream it, keyed by part index) and `None` for a scene render (whose
    /// per-part frames are streamed internally).
    pub fn run(&self, config: &AnimConfig) -> Result<Option<record::Rendered>, String> {
        if let Some(part) = &self.component {
            if self.time.is_some() {
                return Err("--time poses the assembled scene; drop --component".to_string());
            }
            let view = self.view.map(View::from).unwrap_or(View::Iso);
            return Ok(Some(render_part(config, part, view, self.out.as_deref())?));
        }
        if let Some(time_ms) = self.time {
            let view = self.view.map(View::from).unwrap_or(View::Iso);
            let rendered = render_scene_posed(
                config,
                self.animation.as_deref(),
                time_ms,
                view,
                self.out.as_deref(),
            )?;
            return Ok(Some(rendered));
        }
        render_scene(config)?;
        Ok(None)
    }
}

/// Render one part's log to its preview PNG (chosen `view`) and its `.glb`.
pub fn render_part(
    config: &AnimConfig,
    part: &str,
    view: View,
    out: Option<&Path>,
) -> Result<record::Rendered, String> {
    if !config.has_part(part) {
        return Err(format!(
            "part `{part}` is not defined (defined: {:?})",
            config.declared_parts()
        ));
    }
    let volume = dims(config.extents());
    let operations = read_actions(&config.actions_for(part))?;
    let preview = out
        .map(Path::to_path_buf)
        .unwrap_or_else(|| config.preview_for(part));
    render_target_files(
        &volume,
        config.background()?,
        &operations,
        view,
        &preview,
        &config.mesh_for(part),
    )
}

/// The assembled-scene views the animated tool renders, as `(name, view)` pairs in
/// output order. The name substitutes the `{view}` token of `AnimConfig::scene`.
pub const SCENE_VIEWS: [(&str, View); 4] = [
    ("iso", View::Iso),
    ("front", View::Front),
    ("side", View::Side),
    ("top", View::Top),
];

/// Compose every part's action log into one assembled volume, posed at **rest**.
///
/// Each part is rendered from its own log in the shared volume's coordinates (where
/// the model sculpted it) and unioned in `part_logs` order, so a later part's
/// voxels overpaint an earlier part's where they coincide. At rest the rig applies
/// no per-part transform (parts are sculpted in place), so this union *is* the
/// assembled model; joint motion is not applied here (rotating voxels in the grid
/// is lossy), which for the required rest pose is exact.
pub fn compose_scene(dims: &Dims, part_logs: &[Vec<Operation>]) -> VoxelSet {
    let mut set = VoxelSet::empty(*dims);
    for operations in part_logs {
        let part = render(dims, operations);
        for (cell, part_cell) in set.cells.iter_mut().zip(part.cells.iter()) {
            if let Some(color) = part_cell {
                *cell = Some(*color);
            }
        }
    }
    set
}

/// Render the assembled rest scene on request.
///
/// Re-emits **every** part's `.glb` and preview from its log (so one `render` produces
/// all the geometry the run's result reads and refreshes every scored per-part image),
/// then composes the parts at rest and writes one PNG per [`SCENE_VIEWS`] entry. Each
/// part's frame is streamed to a live viewer, best-effort. A scene view is a
/// non-scored aid — the per-part previews remain the scored artifacts.
pub fn render_scene(config: &AnimConfig) -> Result<(), String> {
    let volume = dims(config.extents());
    let background = config.background()?;
    let parts = config.declared_parts();
    let mut logs = Vec::with_capacity(parts.len());
    for (index, part) in parts.iter().enumerate() {
        let operations = read_actions(&config.actions_for(part))?;
        let rendered = render_target_files(
            &volume,
            background,
            &operations,
            View::Iso,
            &config.preview_for(part),
            &config.mesh_for(part),
        )?;
        if let Some(live) = &config.live {
            send_live_preview(
                &live.endpoint,
                &live.token,
                index as u32,
                "render",
                operations.len(),
                &rendered.image,
                &rendered.live_body,
            );
        }
        logs.push(operations);
    }
    // Mesh the composed rest-pose model once, then draw it from each scene view.
    let set = compose_scene(&volume, &logs);
    let part_mesh = build_part_mesh(&set);
    for (name, view) in SCENE_VIEWS {
        let path = config.scene_for(name);
        record::ensure_parent(&path)?;
        let bytes = mesh_render::render_png(
            &[mesh_view(&part_mesh)],
            view,
            background,
            mesh_render::PREVIEW_SIZE,
        )?;
        fs::write(&path, &bytes)
            .map_err(|err| format!("writing scene {}: {err}", path.display()))?;
    }
    Ok(())
}

/// Choose which animation a `--time` render samples: the named one, else the sole
/// animation, else the auto-play one — an error if the choice is ambiguous or the rig
/// has no animation.
fn pick_animation<'a>(rig: &'a Rig, name: Option<&str>) -> Result<&'a Animation, String> {
    if let Some(name) = name {
        return rig
            .animations
            .iter()
            .find(|a| a.name == name)
            .ok_or_else(|| format!("no animation `{name}` in the rig"));
    }
    match rig.animations.as_slice() {
        [] => Err("the rig has no animations to pose (author one first)".to_string()),
        [only] => Ok(only),
        many => many
            .iter()
            .find(|a| a.auto_play)
            .ok_or_else(|| "the rig has several animations; name one with --animation".to_string()),
    }
}

/// Render the assembled model **posed** at `time_ms` of an animation, from `view`, to
/// `out` (default the scene `pose` image). Each part's rest mesh is transformed by its
/// posed world matrix, so this shows the animation as the client would play it. Does
/// not touch the parts' `.glb`s (posing is a view, not new geometry).
pub fn render_scene_posed(
    config: &AnimConfig,
    animation: Option<&str>,
    time_ms: f64,
    view: View,
    out: Option<&Path>,
) -> Result<record::Rendered, String> {
    let volume = dims(config.extents());
    let background = config.background()?;
    let rig = Rig::load(&config.rig)?;
    let anim = pick_animation(&rig, animation)?;
    let values = pose::sample_animation(anim, time_ms);
    // `pose_rig` returns one world matrix per part, in `rig.parts` order.
    let world = pose::pose_rig(&rig, &values);

    // Mesh each part at rest, then transform it into its posed place. The owned arrays
    // stay alive so the mesh views can borrow them for the single composed draw.
    // A posed part's transformed geometry, kept alive for the composed draw to
    // borrow: (positions, normals, colors, indices).
    type PosedGeometry = (Vec<f32>, Vec<f32>, Vec<f32>, Vec<u32>);
    let mut posed: Vec<PosedGeometry> = Vec::with_capacity(rig.parts.len());
    for (i, part) in rig.parts.iter().enumerate() {
        let operations = read_actions(&config.actions_for(&part.name))?;
        let set = render(&volume, &operations);
        let part_mesh = build_part_mesh(&set);
        let (positions, normals) =
            pose::transform_mesh(&part_mesh.positions, &part_mesh.normals, &world[i].1);
        posed.push((positions, normals, part_mesh.colors, part_mesh.indices));
    }
    let views: Vec<MeshView> = posed
        .iter()
        .map(|(positions, normals, colors, indices)| MeshView {
            positions,
            normals,
            colors,
            indices,
        })
        .collect();
    let image = mesh_render::render_png(&views, view, background, mesh_render::PREVIEW_SIZE)?;
    let out = out
        .map(Path::to_path_buf)
        .unwrap_or_else(|| config.scene_for("pose"));
    record::ensure_parent(&out)?;
    fs::write(&out, &image).map_err(|err| format!("writing {}: {err}", out.display()))?;
    Ok(record::Rendered {
        image,
        live_body: Vec::new(),
    })
}

#[cfg(test)]
#[path = "cli.test.rs"]
mod tests;
