//! The generic, domain-agnostic core shared by every voxel-family tool.
//!
//! This crate owns the pieces that are identical across the cube tool (`voxel` /
//! `voxel-anim`) and the meshing tools: the rig/animation model ([`rig`]), the
//! opaque-RGB [`color`] type, the principal-[`axis`] enum, the seeded run
//! [`config`] shapes, and the generic [`record`] plumbing (append-to-log,
//! re-render, live-preview stream) parameterized over a
//! [`SculptBackend`](record::SculptBackend). It knows nothing about voxel cubes or
//! signed-distance fields; each concrete domain depends on this crate and plugs in
//! its own backend.
//!
//! The pure model types (`axis`, `color`, `rig`) are always available; the
//! `config`/`record` CLI plumbing is behind the `cli` feature (on by default) so a
//! library consumer such as `crates/core` can link this crate with
//! `default-features = false` and pull in only the model types.

pub mod axis;
pub mod color;
pub mod rig;

#[cfg(feature = "cli")]
pub mod config;
#[cfg(feature = "cli")]
pub mod record;
#[cfg(feature = "cli")]
pub mod render;

pub use axis::Axis;
pub use color::{ColorError, PreviewBackground, Rgb};
pub use rig::{Animation, Drive, Interp, Joint, JointKind, Keyframe, Part, Rig, Track};
