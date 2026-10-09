//! The orchestrator identity the run record names.
//!
//! Only the default orchestrator's slug is a contract: the run record defaults
//! its orchestrator to it. The catalog, the manifests and the runner are runtime
//! and live in `test_cabinet_core::orchestrator`, which re-exports this.

/// The slug of the default, single-session orchestrator.
pub const ONE_SHOT_SLUG: &str = "one-shot";
