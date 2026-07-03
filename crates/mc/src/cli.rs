//! The marching-cubes tool's CLI support: the field-op subcommands and the field
//! backend that plugs into the generic record/preview plumbing.
//!
//! Both `mc` (a single static model) and `mc-anim` (a rigged model, one separate file
//! set per part) drive the **same** field vocabulary through `clap`; this module
//! defines those operation subcommands, the [`FieldBackend`] that composites a
//! recorded [`FieldOp`] log into a signed-distance field, extracts its surface with the
//! [`MarchingCubesMesher`], and writes the preview PNG and `mesh.json`, plus the
//! field-flavored wrappers over `test-cabinet-model-core`'s generic
//! [`apply`](record::apply)/[`init_target`](record::init_target) loop. The only
//! difference between the binaries is whether an operation targets one field or one of
//! many independent per-part fields.
//!
//! The subcommands' help text is the contract a model reads: an asset-generation case
//! seeds no operations schema, it tells the model to run the binary's `--help`. So the
//! doc comments here mirror [`FieldOp`]'s and are the authoritative description of the
//! marching-cubes field vocabulary.

use std::fs;
use std::path::{Path, PathBuf};

use clap::{Args, Subcommand};

use test_cabinet_model_core::record;
use test_cabinet_model_core::render as mesh_render;
use test_cabinet_model_core::render::View;

use test_cabinet_voxel_mesh::{
    Algorithm, Axis, Dims, Field, FieldOp, GridConfig, MarchingCubesMesher, Mesher,
    PreviewBackground, Rgb, render, to_mesh_glb,
};

// Re-export the generic config/record surface the binaries reach as
// `test_cabinet_mc::cli::…`, so the split is invisible to them.
pub use test_cabinet_model_core::config::{AnimConfig, Config, LiveConfig, read_config};
pub use test_cabinet_model_core::record::{ApplyResult, send_live_preview, write_actions};

/// The surface-extraction algorithm this binary meshes with: marching cubes (coarse
/// grid, chunky faceted low-poly surface).
const ALGORITHM: Algorithm = Algorithm::MarchingCubes;

/// The grid preset this binary samples fields at (the marching-cubes coarse grid).
fn grid_config() -> GridConfig {
    GridConfig::for_algorithm(ALGORITHM)
}

/// Extract the surface of `field` with this binary's mesher (marching cubes).
fn mesh_field(field: &Field) -> test_cabinet_voxel_mesh::Mesh {
    MarchingCubesMesher.mesh(field)
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

/// The marching-cubes [`SculptBackend`](record::SculptBackend): composites a
/// [`FieldOp`] log into a signed-distance [`Field`] and renders it to the preview PNG
/// and the extracted `mesh.json`.
pub struct FieldBackend {
    /// The world-space volume the field is sampled over.
    pub bounds: Dims,
    /// The grid preset (resolution + character) this binary samples at.
    pub config: GridConfig,
    /// The preview clear color.
    pub background: PreviewBackground,
}

impl record::SculptBackend for FieldBackend {
    type Op = FieldOp;

    fn render_target(
        &self,
        ops: &[FieldOp],
        preview: &Path,
        mesh: &Path,
    ) -> Result<record::Rendered, String> {
        let field = render(self.bounds, &self.config, ops);

        // The extracted surface mesh is the single source of geometry: it is what the
        // preview renderer draws and what every downstream consumer reads.
        let part_mesh = mesh_field(&field);
        let mesh_glb = to_mesh_glb(&part_mesh);
        record::ensure_parent(mesh)?;
        fs::write(mesh, &mesh_glb)
            .map_err(|err| format!("writing mesh {}: {err}", mesh.display()))?;

        let image = mesh_render::render_png(
            &[part_mesh.view()],
            View::Iso,
            self.background,
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
}

/// The world-space field [`Dims`] a `(width, height, depth)` extents triple describes.
pub fn bounds(extents: (u32, u32, u32)) -> Dims {
    let (width, height, depth) = extents;
    Dims::new(width as f32, height as f32, depth as f32)
}

/// Append one operation to `actions` and re-render the target's preview PNG and
/// `mesh.json` from the whole log through the field backend.
pub fn apply(
    bounds: Dims,
    background: PreviewBackground,
    actions: &Path,
    preview: &Path,
    mesh: &Path,
    operation: FieldOp,
) -> Result<ApplyResult, String> {
    let backend = FieldBackend {
        bounds,
        config: grid_config(),
        background,
    };
    record::apply(&backend, actions, preview, mesh, operation)
}

/// Initialize one target: write an empty action log and render its blank preview and
/// `mesh.json`.
pub fn init_target(
    bounds: Dims,
    background: PreviewBackground,
    actions: &Path,
    preview: &Path,
    mesh: &Path,
) -> Result<(), String> {
    let backend = FieldBackend {
        bounds,
        config: grid_config(),
        background,
    };
    record::init_target(&backend, actions, preview, mesh)
}

/// Read the field action log, treating an absent file as an empty log so the first
/// operation of a run does not need a separate `init`.
pub fn read_actions(path: &Path) -> Result<Vec<FieldOp>, String> {
    record::read_actions(path)
}

/// Render an arbitrary field to preview PNG bytes with the isometric camera and the
/// given background — the exact rendering the backend produces (mesh the field, then
/// draw it through the shared renderer), exposed for callers holding a field directly.
pub fn preview_bytes(field: &Field, background: PreviewBackground) -> Result<Vec<u8>, String> {
    let part_mesh = mesh_field(field);
    mesh_render::render_png(
        &[part_mesh.view()],
        View::Iso,
        background,
        mesh_render::PREVIEW_SIZE,
    )
}

/// The shared `render` subcommand: regenerate a preview from an action log without
/// modifying it. Identical for both binaries; it operates on one log and one output,
/// so authors can render any log (including a per-part target log). The grid character
/// is fixed by the binary, so it needs only the volume extents.
#[derive(Debug, Args)]
pub struct RenderArgs {
    /// Path to the action log JSON (an array of field operations).
    #[arg(long)]
    pub actions: PathBuf,
    /// Where to write the rendered preview PNG.
    #[arg(long)]
    pub out: PathBuf,
    /// Volume width in voxels.
    #[arg(long)]
    pub width: u32,
    /// Volume height in voxels.
    #[arg(long)]
    pub height: u32,
    /// Volume depth in voxels.
    #[arg(long)]
    pub depth: u32,
    /// Preview clear color: `transparent` or a hex color.
    #[arg(long, default_value = "transparent")]
    pub background: String,
}

impl RenderArgs {
    /// Render the action log to the output PNG.
    pub fn run(&self) -> Result<(), String> {
        let background = PreviewBackground::parse(&self.background)
            .map_err(|err| format!("invalid background: {err}"))?;
        let volume = bounds((self.width, self.height, self.depth));
        let operations = read_actions(&self.actions)?;
        let field = render(volume, &grid_config(), &operations);
        let bytes = preview_bytes(&field, background)?;
        record::ensure_parent(&self.out)?;
        fs::write(&self.out, &bytes).map_err(|err| format!("writing {}: {err}", self.out.display()))
    }
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

/// Re-render the assembled scene from the current per-part logs: compose every declared
/// part and write one PNG per [`SCENE_VIEWS`] entry to the config's `scene` path.
/// Returns the composed field so a caller can reuse it. A scene view is a non-scored
/// aid — the per-part previews remain the scored artifacts.
pub fn render_scene(config: &AnimConfig) -> Result<Field, String> {
    let volume = bounds(config.extents());
    let grid = grid_config();
    let background = config.background()?;
    let parts = config.declared_parts();
    let mut logs = Vec::with_capacity(parts.len());
    for part in &parts {
        logs.push(read_actions(&config.actions_for(part))?);
    }
    let field = compose_scene(volume, &grid, &logs);
    // Mesh the composed rest-pose field once, then draw it from each scene view.
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
    Ok(field)
}
