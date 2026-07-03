//! The cube tool's CLI support: the sculpting-operation subcommands and the cube
//! backend that plugs into the generic record/preview plumbing.
//!
//! Both `voxel` (a single static model) and `voxel-anim` (a rigged model, one
//! separate file set per part) drive the **same** cube sculpting operations through
//! `clap`; this module defines those operation subcommands, the [`CubeBackend`] that
//! turns a recorded log into a preview PNG and a `mesh.json`, and the cube-flavored
//! wrappers over `test-cabinet-model-core`'s generic
//! [`apply`](test_cabinet_model_core::record::apply)/[`init_target`](test_cabinet_model_core::record::init_target)
//! loop. The only difference between the binaries is whether an operation targets
//! one volume or one of many independent per-part volumes — the operations
//! themselves, and how each one applies, are identical.
//!
//! The operation subcommands' help text is the contract a model reads: an
//! asset-generation case seeds no operations schema, it tells the model to run the
//! binary's `--help`. So the doc comments here mirror [`Operation`]'s and are the
//! authoritative description of the sculpting vocabulary.

use std::fs;
use std::path::{Path, PathBuf};

use clap::{Args, Subcommand};

use test_cabinet_model_core::record;
use test_cabinet_model_core::render as mesh_render;
use test_cabinet_model_core::render::{MeshView, View};

use crate::color::Rgb;
use crate::mesh::{PartMesh, build_part_mesh};
use crate::{Axis, Dims, Operation, PreviewBackground, VoxelSet, render};

// Re-export the generic config/record surface the binaries reach as
// `test_cabinet_voxel::cli::…`, so the split is invisible to them.
pub use test_cabinet_model_core::config::{AnimConfig, Config, LiveConfig, read_config};
pub use test_cabinet_model_core::record::{ApplyResult, send_live_preview, write_actions};

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

/// The cube [`SculptBackend`](record::SculptBackend): replays an [`Operation`] log
/// into a [`VoxelSet`] and renders it to the isometric preview PNG and the
/// face-culled `mesh.json`.
pub struct CubeBackend {
    /// The volume the operations sculpt within.
    pub dims: Dims,
    /// The preview clear color.
    pub background: PreviewBackground,
}

impl record::SculptBackend for CubeBackend {
    type Op = Operation;

    fn render_target(
        &self,
        ops: &[Operation],
        preview: &Path,
        mesh: &Path,
    ) -> Result<record::Rendered, String> {
        let set = render(&self.dims, ops);

        // The face-culled surface mesh is the single source of geometry: it is what
        // the preview renderer draws and what every downstream consumer reads.
        let part_mesh = build_part_mesh(&set);
        let mesh_json =
            serde_json::to_string(&part_mesh).map_err(|err| format!("serializing mesh: {err}"))?;
        record::ensure_parent(mesh)?;
        fs::write(mesh, mesh_json.as_bytes())
            .map_err(|err| format!("writing mesh {}: {err}", mesh.display()))?;

        let image = mesh_render::render_png(
            &[mesh_view(&part_mesh)],
            View::Iso,
            self.background,
            mesh_render::PREVIEW_SIZE,
        )?;
        record::ensure_parent(preview)?;
        fs::write(preview, &image)
            .map_err(|err| format!("writing preview {}: {err}", preview.display()))?;

        Ok(record::Rendered {
            image,
            // Stream the face-culled `mesh.json` (the `PartMesh` the 3D client
            // renders) — the same geometry every voxel-family binary streams live,
            // so the live viewer rebuilds the model from a mesh, never re-meshing.
            live_body: mesh_json,
        })
    }
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

/// Append one operation to `actions` and re-render the target's preview PNG and
/// `mesh.json` from the whole log through the cube backend.
pub fn apply(
    dims: &Dims,
    background: PreviewBackground,
    actions: &Path,
    preview: &Path,
    mesh: &Path,
    operation: Operation,
) -> Result<ApplyResult, String> {
    let backend = CubeBackend {
        dims: *dims,
        background,
    };
    record::apply(&backend, actions, preview, mesh, operation)
}

/// Initialize one target: write an empty action log and render its blank preview
/// and `mesh.json`.
pub fn init_target(
    dims: &Dims,
    background: PreviewBackground,
    actions: &Path,
    preview: &Path,
    mesh: &Path,
) -> Result<(), String> {
    let backend = CubeBackend {
        dims: *dims,
        background,
    };
    record::init_target(&backend, actions, preview, mesh)
}

/// Read the cube action log, treating an absent file as an empty log so the first
/// operation of a run does not need a separate `init`.
pub fn read_actions(path: &Path) -> Result<Vec<Operation>, String> {
    record::read_actions(path)
}

/// Render an arbitrary voxel set to preview PNG bytes with the isometric camera and
/// the given background — the exact rendering the cube backend produces (mesh the
/// set, then draw it through the shared renderer), exposed for callers holding a set
/// directly.
pub fn preview_bytes(set: &VoxelSet, background: PreviewBackground) -> Result<Vec<u8>, String> {
    let part_mesh = build_part_mesh(set);
    mesh_render::render_png(
        &[mesh_view(&part_mesh)],
        View::Iso,
        background,
        mesh_render::PREVIEW_SIZE,
    )
}

/// The shared `render` subcommand: regenerate a preview from an action log without
/// modifying it. Identical for both binaries; it operates on one log and one output
/// and needs no config, so authors can render any log (including a per-part target
/// log) at an explicit size.
#[derive(Debug, Args)]
pub struct RenderArgs {
    /// Path to the action log JSON (an array of operations).
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
    /// Render the action log to the output PNG at the requested size.
    pub fn run(&self) -> Result<(), String> {
        let background = PreviewBackground::parse(&self.background)
            .map_err(|err| format!("invalid background: {err}"))?;
        let volume = dims((self.width, self.height, self.depth));
        let operations = read_actions(&self.actions)?;
        let set = render(&volume, &operations);
        let bytes = preview_bytes(&set, background)?;
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

/// Re-render the assembled scene from the current per-part logs: compose every
/// declared part and write one PNG per [`SCENE_VIEWS`] entry to the config's
/// `scene` path. Returns the composed volume so a caller can reuse it. A scene view
/// is a non-scored aid — the per-part previews remain the scored artifacts.
pub fn render_scene(config: &AnimConfig) -> Result<VoxelSet, String> {
    let volume = dims(config.extents());
    let background = config.background()?;
    let parts = config.declared_parts();
    let mut logs = Vec::with_capacity(parts.len());
    for part in &parts {
        logs.push(read_actions(&config.actions_for(part))?);
    }
    let set = compose_scene(&volume, &logs);
    // Mesh the composed rest-pose model once, then draw it from each scene view.
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
    Ok(set)
}

#[cfg(test)]
#[path = "cli.test.rs"]
mod tests;
