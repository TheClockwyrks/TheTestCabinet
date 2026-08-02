//! Subcommand handlers.
//!
//! Each handler is a stub that calls into [`test_cabinet_core`] where the surface
//! exists and otherwise reports that the orchestration is not implemented yet.

pub mod analyze;
pub mod auth;
pub mod capture_baselines;
pub mod event_printer;
pub mod gg_playback;
pub mod gg_replay;
pub mod harnesses;
pub mod orchestrators;
pub mod prompt;
pub mod publish;
pub mod publish_asset_reference;
pub mod publish_reference;
pub mod run;
pub mod seed;
pub mod validate;
