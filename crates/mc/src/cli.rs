//! The marching-cubes tool's CLI support: the field-op subcommands and the field
//! backend that plugs into the generic record/preview plumbing.
//!
//! Both `mc` (a single static model) and `mc-anim` (a rigged model, one separate file
//! set per part) drive the **same** field vocabulary through `clap`; this module
//! defines those operation subcommands, the append-only [`record`](record::record)
//! wrapper each operation calls, and the on-request `render` half —
//! `render_target_files` plus the [`RenderArgs`]/[`AnimRenderArgs`] commands — that
//! composites a recorded [`FieldOp`] log into a signed-distance field, extracts its
//! surface with the [`MarchingCubesMesher`], and writes the preview PNG and per-part
//! `.glb`. The only difference between the binaries is whether an operation targets one
//! field or one of many independent per-part fields.
//!
//! The subcommands' help text is the contract a model reads: an asset-generation case
//! seeds no operations schema, it tells the model to run the binary's `--help`. So the
//! doc comments here mirror [`FieldOp`]'s and are the authoritative description of the
//! marching-cubes field vocabulary.

use std::fs;
use std::path::{Path, PathBuf};

use clap::{Args, Subcommand};

use test_cabinet_model_core::pose;
use test_cabinet_model_core::record;
use test_cabinet_model_core::render as mesh_render;
use test_cabinet_model_core::render::{MeshView, View};
use test_cabinet_model_core::rig::{Animation, Rig};

use test_cabinet_voxel_mesh::{
    Algorithm, Axis, Dims, Field, FieldOp, GridConfig, MarchingCubesMesher, Mesher,
    PreviewBackground, Rgb, render, simplify_mesh, to_mesh_glb,
};

// Re-export the generic config/record surface the binaries reach as
// `test_cabinet_mc::cli::…`, so the split is invisible to them.
pub use test_cabinet_model_core::config::{AnimConfig, Config, LiveConfig, read_config};
pub use test_cabinet_model_core::record::{Rendered, send_live_preview, write_actions};

/// The surface-extraction algorithm this binary meshes with: marching cubes (coarse
/// grid, chunky faceted low-poly surface).
const ALGORITHM: Algorithm = Algorithm::MarchingCubes;

/// The grid preset this binary samples fields at (the marching-cubes coarse grid).
fn grid_config() -> GridConfig {
    GridConfig::for_algorithm(ALGORITHM)
}

/// Extract the surface of `field` with this binary's mesher (marching cubes), then
/// collapse the extractor's redundant coplanar triangles with QEM simplification. The
/// single chokepoint every emission path routes through, so the preview PNG, the
/// exported `.glb`, and the recorded vertex count all describe the same simplified
/// mesh.
fn mesh_field(field: &Field) -> test_cabinet_voxel_mesh::Mesh {
    simplify_mesh(&MarchingCubesMesher.mesh(field))
}

/// A single field operation, expressed as a `clap` subcommand.
///
/// The variants and their arguments mirror [`FieldOp`] one-for-one;
/// [`OpCommand::into_field_op`] is the single place the CLI form and the recorded wire
/// form meet. Additive primitives union material into the field; subtractive ones
/// carve it away. `--blend` is the smooth-union radius (`0` = a hard union, which
/// leaves a genuine crease); the whole-field ops transform the already composited
/// field. Coordinates, radii, and extents are world-space (voxel-unit) floats framed
/// by the `[voxel]` volume table.
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
    },
    /// Union a solid axis-aligned box centered at `(cx, cy, cz)` with the given full
    /// extents into the field.
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
    },
    /// Union a solid ellipsoid centered at `(cx, cy, cz)` with per-axis radii into the
    /// field (a dome, an egg).
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
    },
    /// Union a solid capped cylinder centered at `(cx, cy, cz)`, radius `r` and full
    /// length `height` along `axis`, into the field (barrels, legs, poles, wheels).
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
    },
    /// Carve a sphere out of the field (smooth subtraction when `--blend > 0`).
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
    /// Recolor every node currently carrying color `from` to color `to`, across the
    /// whole field — a palette swap or shading pass. The distance field is untouched.
    ReplaceColor {
        /// The color to match, as `#rrggbb`.
        #[arg(long, value_parser = parse_color)]
        from: Rgb,
        /// The color to write in its place, as `#rrggbb`.
        #[arg(long, value_parser = parse_color)]
        to: Rgb,
    },
    /// Mirror the field across the plane at `at` along `plane`, reflecting the low side
    /// onto the high side by union — the single highest-leverage op for a symmetric
    /// model.
    Mirror {
        /// The plane's normal axis (`x`, `y`, or `z`).
        #[arg(long, value_enum)]
        plane: Axis,
        /// The mirror position along `plane`, in world units.
        #[arg(long)]
        at: f32,
    },
    /// Shift the whole field by `(dx, dy, dz)` world units; regions shifted in from
    /// outside the volume read as empty. Repositions an entire part.
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
    /// Copy the field within a source box (min corner `(x, y, z)`, the given extents)
    /// to a destination offset by `(dx, dy, dz)`, unioning it into the destination.
    /// Source and destination may overlap.
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
    /// Reset the field to empty (every node far outside, uncolored).
    Clear,
}

impl OpCommand {
    /// Convert the parsed subcommand into the [`FieldOp`] recorded in the action log
    /// and replayed by the field renderer. Marching cubes cannot represent sharp
    /// features, so every primitive is tagged `sharp: false`.
    pub fn into_field_op(self) -> FieldOp {
        match self {
            OpCommand::AddSphere {
                cx,
                cy,
                cz,
                r,
                color,
                blend,
            } => FieldOp::AddSphere {
                cx,
                cy,
                cz,
                r,
                color,
                blend,
                sharp: false,
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
            } => FieldOp::AddBox {
                cx,
                cy,
                cz,
                width,
                height,
                depth,
                color,
                blend,
                sharp: false,
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
            } => FieldOp::AddEllipsoid {
                cx,
                cy,
                cz,
                rx,
                ry,
                rz,
                color,
                blend,
                sharp: false,
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
            } => FieldOp::AddCylinder {
                cx,
                cy,
                cz,
                r,
                height,
                axis,
                color,
                blend,
                sharp: false,
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

/// Parse a `--color` value (`#rrggbb`) into an [`Rgb`], mapping a parse error to the
/// string `clap` shows the user.
fn parse_color(value: &str) -> Result<Rgb, String> {
    Rgb::parse_hex(value).map_err(|err| err.to_string())
}

/// Render one field target's log to disk on request: composite the [`FieldOp`] log
/// into a signed-distance [`Field`], extract its surface, write the per-part `.glb`,
/// and render the chosen [`View`] to the preview PNG. Returns the PNG and `.glb` bytes
/// so a caller streaming a live frame need not re-read them.
///
/// This is the render half of the tool, reached only by the `render` command — a
/// sculpting operation records to the log and renders nothing.
fn render_target_files(
    bounds: Dims,
    grid: &GridConfig,
    background: PreviewBackground,
    ops: &[FieldOp],
    view: View,
    preview: &Path,
    mesh: &Path,
) -> Result<record::Rendered, String> {
    let field = render(bounds, grid, ops);

    // The extracted surface mesh is the single source of geometry: it is what the
    // preview renderer draws and what every downstream consumer reads.
    let part_mesh = mesh_field(&field);
    let mesh_glb = to_mesh_glb(&part_mesh);
    record::ensure_parent(mesh)?;
    fs::write(mesh, &mesh_glb).map_err(|err| format!("writing mesh {}: {err}", mesh.display()))?;

    let image = mesh_render::render_png(
        &[part_mesh.view()],
        view,
        background,
        mesh_render::PREVIEW_SIZE,
    )?;
    record::ensure_parent(preview)?;
    fs::write(preview, &image)
        .map_err(|err| format!("writing preview {}: {err}", preview.display()))?;

    Ok(record::Rendered {
        image,
        live_body: mesh_glb,
    })
}

/// The world-space field [`Dims`] a `(width, height, depth)` extents triple describes.
pub fn bounds(extents: (u32, u32, u32)) -> Dims {
    let (width, height, depth) = extents;
    Dims::new(width as f32, height as f32, depth as f32)
}

/// Record one operation to a target's action log, returning the log's new operation
/// count. This is all a sculpting operation does — no meshing, no preview, no stream.
pub fn record(actions: &Path, operation: FieldOp) -> Result<usize, String> {
    record::record(actions, operation)
}

/// Initialize one target's action log to empty. Renders nothing (rendering is the
/// `render` command's job).
pub fn init_log(actions: &Path) -> Result<(), String> {
    record::init_log::<FieldOp>(actions)
}

/// Read the field action log, treating an absent file as an empty log so the first
/// operation of a run does not need a separate `init`.
pub fn read_actions(path: &Path) -> Result<Vec<FieldOp>, String> {
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
        render_model(config, self.view.into(), self.out.as_deref())
    }
}

/// Render one static model log to its `.glb` and preview PNG.
pub fn render_model(
    config: &Config,
    view: View,
    out: Option<&Path>,
) -> Result<record::Rendered, String> {
    let volume = bounds(config.extents());
    let operations = read_actions(&config.actions)?;
    let preview = out
        .map(Path::to_path_buf)
        .unwrap_or_else(|| config.preview.clone());
    render_target_files(
        volume,
        &grid_config(),
        config.background()?,
        &operations,
        view,
        &preview,
        &config.mesh,
    )
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
    let volume = bounds(config.extents());
    let operations = read_actions(&config.actions_for(part))?;
    let preview = out
        .map(Path::to_path_buf)
        .unwrap_or_else(|| config.preview_for(part));
    render_target_files(
        volume,
        &grid_config(),
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

/// Compose every part's field into one assembled field, unioned at **rest**.
///
/// Each part is composited from its own log in the shared volume's coordinates and
/// unioned into the accumulator (each node takes the nearer surface, carrying its
/// color and sharp tag), so the result is the assembled rest-pose model. Joint motion
/// is not applied here (it is a pose of the per-part meshes, not the field), which for
/// the required rest pose is exact.
pub fn compose_scene(bounds: Dims, config: &GridConfig, part_logs: &[Vec<FieldOp>]) -> Field {
    let mut field = Field::empty(bounds, config.resolution(&bounds));
    for operations in part_logs {
        let part = render(bounds, config, operations);
        for i in 0..field.sdf.len() {
            if part.sdf[i] < field.sdf[i] {
                field.sdf[i] = part.sdf[i];
                field.color[i] = part.color[i];
                field.sharp[i] = part.sharp[i];
            }
        }
    }
    field
}

/// Render the assembled rest scene on request.
///
/// Re-emits **every** part's `.glb` and preview from its log (so one `render` produces
/// all the geometry the run's result reads and refreshes every scored per-part image),
/// then composes the parts at rest and writes one PNG per [`SCENE_VIEWS`] entry. Each
/// part's frame is streamed to a live viewer, best-effort. A scene view is a
/// non-scored aid — the per-part previews remain the scored artifacts.
pub fn render_scene(config: &AnimConfig) -> Result<(), String> {
    let volume = bounds(config.extents());
    let grid = grid_config();
    let background = config.background()?;
    let parts = config.declared_parts();
    let mut logs = Vec::with_capacity(parts.len());
    for (index, part) in parts.iter().enumerate() {
        let operations = read_actions(&config.actions_for(part))?;
        let rendered = render_target_files(
            volume,
            &grid,
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
    // Mesh the composed rest-pose field once, then draw it from each scene view.
    let field = compose_scene(volume, &grid, &logs);
    let part_mesh = mesh_field(&field);
    for (name, view) in SCENE_VIEWS {
        let path = config.scene_for(name);
        record::ensure_parent(&path)?;
        let bytes = mesh_render::render_png(
            &[part_mesh.view()],
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
    let volume = bounds(config.extents());
    let grid = grid_config();
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
        let field = render(volume, &grid, &operations);
        let part_mesh = mesh_field(&field);
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
