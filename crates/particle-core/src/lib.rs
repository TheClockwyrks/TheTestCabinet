//! The shared particle-system model and live simulator behind the `particle-2d` and
//! `particle-3d` binaries.
//!
//! This crate owns everything the two binaries share — they differ only in
//! dimensionality (2D drops `z`), the preview renderer (a 2D raster path vs. `wgpu`
//! billboards), and the runtime binding:
//!
//! - [`system`] — the authored system model (emitters, forces, per-particle curves,
//!   sub-emitters, timeline) and the `system.json` shape it serializes to; it reuses
//!   [`model-core`](test_cabinet_model_core)'s [`Interp`](test_cabinet_model_core::Interp)
//!   for the size/opacity curves.
//! - [`op`] — the recorded operation log and the fold that resolves it into a
//!   [`system::System`].
//! - [`sim`] — the stochastic simulator that plays a system into per-frame particles.
//!
//! The pure model + simulator are always available; the CLI plumbing (the seeded
//! [`config`], the authoring [`command`]s, and the preview [`render`]er, which links the
//! `wgpu` + GIF stack) is behind the `cli` feature (on by default), so a library
//! consumer such as `crates/core` can link this crate with `default-features = false`
//! and pull in only the model types.
//!
//! See `apps/docs/src/content/docs/testing/asset-generation/particle-binaries.md`.

pub mod op;
pub mod sim;
pub mod system;

#[cfg(feature = "cli")]
pub mod command;
#[cfg(feature = "cli")]
pub mod config;
#[cfg(feature = "cli")]
pub mod render;

pub use op::{EmitterDef, Op, build_system};
pub use sim::{Frame, RenderParticle, Simulation, simulate};
pub use system::{
    ColorStop, Curve, Dimensionality, Emission, Emitter, Extent, Field, Forces, ParticleAppearance,
    Shape, SubEmitter, SubTrigger, System, Turbulence,
};

#[cfg(feature = "cli")]
pub use command::Command;
#[cfg(feature = "cli")]
pub use config::{ParticleConfig, read_config};
