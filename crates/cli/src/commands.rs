//! Subcommand handlers.
//!
//! Each handler is a stub that calls into [`test_cabinet_core`] where the surface
//! exists and otherwise reports that the orchestration is not implemented yet.

pub mod harnesses;
pub mod publish;
pub mod run;
pub mod validate;
