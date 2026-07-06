//! The shared layered raster engine behind the UI and material asset-generation
//! binaries (`paint`, `ui`, `texture`, `pbr`).
//!
//! Unlike the [`draw`](test_cabinet_draw) tool's flat replace-pixel canvas, this is
//! a full **layered compositor**: named [`Layer`](layer::Layer)s with opacity, one
//! of twelve [`BlendMode`](blend::BlendMode)s, an optional mask, and alpha
//! compositing into a flattened element or map. On top of it sit brushes and
//! strokes, fills and gradients, [`select`]ions, [`filters`], layer
//! [`effects`], [`transform`]s, crisp anti-aliased [`vector`] shapes and [`text`],
//! seamless procedural generators ([`proc`]), PBR [`bake`]s, and [`nine_slice`]
//! authoring. Every mark is one [`op::Action`] in a single shared log; a preview (or
//! core's parse) is produced by [replaying](op::replay) that log into a
//! [`Workspace`](layer::Workspace).
//!
//! The four binaries are thin CLIs over this library (the [`cli`] module, behind the
//! `cli` feature). See the binary docs under
//! `apps/docs/src/content/docs/testing/asset-generation/{ui,material}-binaries.md`.

pub mod bake;
pub mod blend;
pub mod color;
pub mod config;
pub mod effects;
pub mod filters;
pub mod layer;
pub mod nine_slice;
pub mod op;
pub mod paint_core;
pub mod proc;
pub mod raster;
pub mod rng;
pub mod select;
pub mod text;
pub mod transform;
pub mod vector;

#[cfg(feature = "cli")]
pub mod cli;
#[cfg(feature = "cli")]
pub mod preview3d;

pub use blend::BlendMode;
pub use color::{Background, Color, ColorError};
pub use layer::{Document, Layer, Workspace};
pub use op::{Action, Op, replay};
pub use raster::{Raster, WrapMode};
