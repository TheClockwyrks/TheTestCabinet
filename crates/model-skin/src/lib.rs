//! The shared skinning library for the skinned-character binaries (`mc-skin`,
//! `sn-skin`, `dc-skin`).
//!
//! A skinned character is a close sibling of the meshed-[animation](test_cabinet_voxel_mesh)
//! kinds and reuses almost their entire stack: the same whole-body signed-distance
//! [`Field`](test_cabinet_voxel_mesh::Field) built from the shared CSG
//! [`FieldOp`](test_cabinet_voxel_mesh::FieldOp) vocabulary, the same MC/SN/DC surface
//! extraction and QEM simplify, and the same F-curve rig/animation model
//! ([`Joint`](test_cabinet_model_core::rig::Joint)/
//! [`Keyframe`](test_cabinet_model_core::rig::Keyframe)/
//! [`Interp`](test_cabinet_model_core::rig::Interp)) and rig
//! [poser](test_cabinet_model_core::pose). What this crate adds on top is the
//! **skinning layer**:
//!
//! - a [`skeleton`] of [`Bone`]s in a hierarchy, joined to the reused rig joints, kept
//!   in a [`SkinnedRig`] alongside a `skinned` marker;
//! - automatic bone-heat [`weights`](skin::compute_weights) — a deterministic pure
//!   function of the extracted mesh plus the skeleton, capped at four influences per
//!   vertex and normalized to sum one;
//! - the linear-blend-skinning [deform](skin::lbs_deform) for a posed preview; and
//! - the skinned-[`gltf`] `.glb` encode (the four ordinary vertex attributes plus
//!   `JOINTS_0` / `WEIGHTS_0`, a glTF skin with its inverse-bind matrices, and the bone
//!   node hierarchy).
//!
//! Unlike the animated meshed kinds there is **no `--part` flag**: a skinned character
//! is one whole-body field with one operation log, extracted once into a single skinned
//! mesh. The [`cli`] module owns the whole subcommand surface — the three binaries each
//! only pin an [`Algorithm`] and delegate to [`cli::run`].
//!
//! The pure [`skeleton`] types are always available; everything that touches the
//! renderer, the glb codec, or the skinning math is behind the `cli` feature (on by
//! default).

pub mod skeleton;

#[cfg(feature = "cli")]
pub mod cli;
#[cfg(feature = "cli")]
pub mod config;
#[cfg(feature = "cli")]
pub mod gltf;
#[cfg(feature = "cli")]
pub mod skin;

pub use skeleton::{Bone, SkinnedRig, WeightOverride};

// The surface-extraction algorithm each binary pins. Re-exported from the meshing
// domain (a pure type, available without the `cli` feature) so the thin binaries name
// it as `test_cabinet_model_skin::Algorithm`.
pub use test_cabinet_voxel_mesh::Algorithm;

#[cfg(feature = "cli")]
pub use cli::run;
