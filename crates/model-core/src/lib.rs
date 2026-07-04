//! The generic, domain-agnostic core shared by every voxel-family tool.
//!
//! This crate owns the pieces that are identical across the cube tool (`voxel` /
//! `voxel-anim`) and the meshing tools: the rig/animation model ([`rig`]), the
//! opaque-RGB [`color`] type, the principal-[`axis`] enum, the seeded run
//! [`config`] shapes, the append-only [`record`] log plumbing, the shared mesh
//! preview [`render`]er, and the rig [`pose`]r that samples an animation and resolves
//! each part's world transform for an on-request `render --time`. It knows nothing
//! about voxel cubes or signed-distance fields; each concrete domain depends on this
//! crate and supplies its own meshing.
//!
//! The pure model types (`axis`, `color`, `rig`) are always available; the
//! `config`/`record`/`render`/`pose` CLI plumbing is behind the `cli` feature (on by
//! default) so a library consumer such as `crates/core` can link this crate with
//! `default-features = false` and pull in only the model types.

pub mod axis;
pub mod color;
pub mod gltf;
pub mod rig;

#[cfg(feature = "cli")]
pub mod config;
#[cfg(feature = "cli")]
pub mod pose;
#[cfg(feature = "cli")]
pub mod record;
#[cfg(feature = "cli")]
pub mod render;

pub use axis::Axis;
pub use color::{ColorError, PreviewBackground, Rgb};
pub use gltf::{PartMeshArrays, glb_to_part_mesh, part_mesh_to_glb};
pub use rig::{Animation, Drive, Interp, Joint, JointKind, Keyframe, Part, Rig, Track};
