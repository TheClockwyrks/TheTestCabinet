//! The dual-contouring meshing tool for 3D asset-generation test cases.
//!
//! See `apps/docs/src/content/docs/testing/asset-generation/`. The model builds a
//! model by compositing CSG primitives into a signed-distance
//! [`Field`](test_cabinet_voxel_mesh::Field) through the `dc` (static) or `dc-anim`
//! (rigged) binary, one recorded [`FieldOp`](test_cabinet_voxel_mesh::FieldOp) at a
//! time; the recorded list of operations is the authoritative output of a run. Each
//! operation re-composites the whole field and re-extracts its surface with the
//! [`DualContouringMesher`](test_cabinet_voxel_mesh::DualContouringMesher), which
//! samples the field on a fine grid for a high-fidelity, sharp-edged character.
//!
//! The signed-distance domain — the field, the shared op vocabulary, and the mesher —
//! lives in `test-cabinet-voxel-mesh`; the generic record/preview plumbing and the
//! mesh renderer live in `test-cabinet-model-core`. This crate is the thin CLI that
//! wires them together, mirroring the cube tool's `crates/voxel`.

#[cfg(feature = "cli")]
pub mod cli;

// Re-export the generic model types so the animated sibling and downstream consumers
// reach them as `test_cabinet_dc::…`.
pub use test_cabinet_voxel_mesh::{Axis, Rgb, axis, color};
