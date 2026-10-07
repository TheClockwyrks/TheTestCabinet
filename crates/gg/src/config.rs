//! Loading the gg **invocation file**: the JSON document `core` hands the `gg`
//! binary via `--config <PATH>`.
//!
//! The invocation type itself — [`GgInvocation`] — is the shared launch contract and
//! lives in [`core`](test_cabinet_core::gg) so both sides of the process boundary use
//! one definition (`core` constructs the file, gg reads it). It is re-exported here
//! for the binary's convenience; this module only owns the on-disk [`load`] step.
//!
//! The one field that is *not* in the file is the model credential: the client reads
//! `OPENROUTER_API_KEY` from the environment so a secret is never serialized to a
//! file on disk (see the crate-level rustdoc in `main.rs`).

use std::path::Path;

use anyhow::{Context, Result};

pub use test_cabinet_core::gg::GgInvocation;

/// Read and parse the [`GgInvocation`] file at `path`.
///
/// Both the read and the parse attach the path for a diagnosable error, since a bad
/// config is the most likely launch-time failure the integration workflow will hit.
pub fn load(path: &Path) -> Result<GgInvocation> {
    let raw = std::fs::read_to_string(path)
        .with_context(|| format!("reading gg invocation file at {}", path.display()))?;
    let invocation: GgInvocation = serde_json::from_str(&raw)
        .with_context(|| format!("parsing gg invocation file at {}", path.display()))?;
    Ok(invocation)
}

#[cfg(test)]
#[path = "config.test.rs"]
mod tests;
