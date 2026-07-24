//! The gg **invocation contract**: the JSON document `core` hands the `gg` binary
//! via `--config <PATH>`.
//!
//! This is the seam between The Test Cabinet's `core` (which constructs the file
//! and launches the binary — that side arrives in the integration workflow) and
//! gg (which reads it here). It is a plain serde type rather than a codegen'd
//! [contract](test_cabinet_core::gg) type because it is an internal
//! process-launch detail, not a published wire schema: nothing outside these two
//! components consumes it.
//!
//! The one field that is *not* here is the model credential: the client reads
//! `OPENROUTER_API_KEY` from the environment so a secret is never serialized to a
//! file on disk (see the crate-level rustdoc in `main.rs`).
//!
//! TODO(gg-integration): once `core` builds this file, consider promoting the
//! type into `core` so both sides share one definition instead of matching
//! shapes across the process boundary.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use test_cabinet_core::gg::GgCapabilitySet;

/// Everything a `gg` invocation needs, deserialized from the `--config` file.
///
/// JSON is camelCase, matching the rest of the Test Cabinet contract.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GgInvocation {
    /// The id of this gg session. Stamped onto every emitted
    /// [`GgTelemetryEvent`](test_cabinet_core::gg::GgTelemetryEvent) so the console
    /// can attribute the stream to the run.
    pub session_id: String,
    /// The seeded run workspace the agent builds in — the directory `core`'s shared
    /// seeding/`init` prepared inside the run container.
    pub workspace_dir: PathBuf,
    /// The build prompt handed to the agent (the rendered test-case instruction).
    pub prompt: String,
    /// The [capability set](GgCapabilitySet) configuring this run: which
    /// capabilities are on, their implementations/params, and the model-slot
    /// bindings. Defaults to the Phase 0 capability set with no slot bound when the
    /// file omits it (a configuration that parses but cannot launch a real session).
    #[serde(default)]
    pub capability_set: GgCapabilitySet,
}

impl GgInvocation {
    /// Read and parse the invocation file at `path`.
    ///
    /// Both the read and the parse attach the path for a diagnosable error, since a
    /// bad config is the most likely launch-time failure the integration workflow
    /// will hit.
    pub fn load(path: &Path) -> Result<Self> {
        let raw = std::fs::read_to_string(path)
            .with_context(|| format!("reading gg invocation file at {}", path.display()))?;
        let invocation: Self = serde_json::from_str(&raw)
            .with_context(|| format!("parsing gg invocation file at {}", path.display()))?;
        Ok(invocation)
    }
}

#[cfg(test)]
#[path = "config.test.rs"]
mod tests;
