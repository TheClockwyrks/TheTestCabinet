//! Subcommand handlers.
//!
//! Each handler is a stub that calls into [`test_cabinet_core`] where the surface
//! exists and otherwise reports that the orchestration is not implemented yet.

pub mod catalog;
pub mod event_printer;
pub mod harnesses;
pub mod orchestrators;
pub mod prompt;
pub mod publish;
pub mod run;
pub mod seed;
pub mod validate;
