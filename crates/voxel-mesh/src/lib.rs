//! The signed-distance meshing domain shared by the surface-extraction tools.
//!
//! Where the cube domain (`test-cabinet-voxel`) paints discrete opaque cells into a
//! `VoxelSet`, this crate builds a **continuous signed-distance [`Field`] by
//! compositing CSG primitives** — the paradigm the marching-cubes (`mc`), surface-nets
//! (`sn`), and dual-contouring (`dc`) tools share. It owns:
//!
//! - the scalar [`Field`] sampled on a uniform grid over the declared volume, with an
//!   opaque `#rrggbb` color carried per region ([`field`]);
//! - the shared [`FieldOp`] vocabulary — additive/subtractive primitives with a
//!   smooth-blend radius, plus whole-field recolor/mirror/translate/copy/clear — and
//!   its apply logic ([`ops`]);
//! - the DC-only sharp-feature tag, carried through the field for dual contouring to
//!   honor and ignored by mc/sn;
//! - the per-algorithm [`GridConfig`] that sets the field's resolution and character
//!   (MC coarse, SN medium, DC fine) ([`config`]);
//! - the [`Mesher`] trait (field → [`Mesh`], the `PartMesh`-shaped `mesh.json`) and a
//!   trivial [`StubMesher`] so the crate compiles and can be wired now ([`mesher`]).
//!
//! The three real surface-extraction algorithms are separate [`Mesher`]
//! implementations added on top of this crate. The generic pieces — the opaque-RGB
//! color, the principal axis, and (behind the `cli` feature) the record/preview
//! plumbing and the renderer's `MeshView` — live in `test-cabinet-model-core`, which
//! this crate depends on and re-exports.

pub mod config;
pub mod dual_contouring;
pub mod field;
pub mod marching_cubes;
pub mod mesher;
pub mod ops;
pub mod surface_nets;

// The generic model types live in `test-cabinet-model-core`. Re-export them (and
// their modules) so this crate's consumers reach them as `test_cabinet_voxel_mesh::…`.
pub use test_cabinet_model_core::{axis, color};

pub use axis::Axis;
pub use color::{ColorError, PreviewBackground, Rgb};
pub use config::{Algorithm, GridConfig};
pub use dual_contouring::DualContouringMesher;
pub use field::{Dims, Field, Resolution};
pub use marching_cubes::MarchingCubesMesher;
pub use mesher::{Mesh, Mesher, StubMesher};
pub use ops::FieldOp;
pub use surface_nets::SurfaceNetsMesher;

/// Regenerate a field from an operation log: start empty at the `config`-derived
/// resolution over `bounds` and apply each [`FieldOp`] in order. This is the
/// authoritative field-authoring logic shared by every meshing tool's preview and
/// core's post-run parse.
pub fn render(bounds: Dims, config: &GridConfig, operations: &[FieldOp]) -> Field {
    let res = config.resolution(&bounds);
    let mut field = Field::empty(bounds, res);
    for operation in operations {
        operation.apply(&mut field);
    }
    field
}

/// Serialize a [`Mesh`] to the `mesh.json` string every consumer reads. Available
/// with the `cli` feature (the meshing binaries), which links `serde_json`.
#[cfg(feature = "cli")]
pub fn to_mesh_json(mesh: &Mesh) -> Result<String, String> {
    serde_json::to_string(mesh).map_err(|err| format!("serializing mesh: {err}"))
}
