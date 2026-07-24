//! gg **tool dispatch** and the toolset offered to the agent.
//!
//! Tools are gg's primary axis of modularity: beyond the single agent-loop plug
//! point, behavior is reconfigured by *which tools are offered* and *which
//! implementation* backs each — so a capability is, in practice, "offer this tool"
//! and an A/B is "offer a different implementation of it". The set of tools
//! exposed to the model is derived from the run's
//! [`GgCapabilitySet`]: a capability that
//! is off contributes no tools and no prompt text (the basis for
//! [ablation](test_cabinet_core::gg)).
//!
//! The Phase 0 toolset is the two capabilities the core loop needs to build a test
//! case:
//! [`shell`](test_cabinet_core::gg::CAPABILITY_SHELL) (run commands in the run
//! container) and
//! [`filesystem`](test_cabinet_core::gg::CAPABILITY_FILESYSTEM) (read/write files
//! in the workspace).
//!
//! # Phase 0 status — STUB
//!
//! This module fixes the layout only; no tools are implemented yet.
//!
//! TODO(gg-integration):
//! - a `Tool` abstraction (name, JSON-schema parameters, and an invoke returning a
//!   result the loop turns into a [`GgTelemetryKind::ToolResult`](test_cabinet_core::gg::GgTelemetryKind));
//! - a registry that assembles the offered toolset from the enabled capabilities;
//! - the Phase 0 tool implementations in submodules (`tools/shell.rs`,
//!   `tools/filesystem.rs`), dispatched by name.

// Scaffolding for the integration workflow; unused in the Phase 0 skeleton.
#![allow(dead_code)]

use test_cabinet_core::gg::GgCapabilitySet;

/// The set of tools offered to the agent for a run, assembled from the enabled
/// capabilities in a [`GgCapabilitySet`].
///
/// A placeholder in Phase 0 — the registry, the `Tool` trait, and the dispatch
/// entrypoint arrive with the real implementation.
pub struct ToolRegistry {
    /// The capability set the offered toolset is derived from.
    capabilities: GgCapabilitySet,
}

impl ToolRegistry {
    /// Build the registry for a run's capability set. Phase 0 stub: records the set
    /// and exposes no tools.
    pub fn new(capabilities: GgCapabilitySet) -> Self {
        Self { capabilities }
    }
}
