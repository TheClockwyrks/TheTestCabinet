//! Agent harness layer: a single abstraction for invoking any supported
//! third-party coding harness.
//!
//! See `docs/harnesses.md`. This layer absorbs harness-specific quirks: how each
//! harness is invoked non-interactively, and how each reports its usage. A run
//! corresponds to a single harness session driven to completion.

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::metrics::TokenCounts;
use crate::run_record::HarnessSlug;

/// Normalized usage returned by every invocation.
///
/// Each harness reports usage differently; the harness layer translates raw
/// output into the normalized [`TokenCounts`] classes so runs are comparable
/// across harnesses.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    /// The normalized token classes for this session.
    pub tokens: TokenCounts,
}

/// The parameters of a single harness invocation.
///
/// Carries at least the slug (which selects the harness), the opaque model ID,
/// and the initial prompt directing the harness to build the game.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessInvocation {
    /// Selects the underlying harness to invoke.
    pub slug: HarnessSlug,
    /// Opaque model ID, passed to the harness unchanged.
    pub model_id: String,
    /// The initial instruction handed to the harness.
    pub prompt: String,
}

/// The result of driving a harness session to completion.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessOutcome {
    /// Normalized usage for the session.
    pub usage: Usage,
    /// The harness version, where it could be determined.
    pub harness_version: Option<String>,
}

/// Reports whether a harness can be invoked on the host.
///
/// An availability check resolves the harness's binary and confirms it can run,
/// for example via `--version`. It must **never** start a session or take any
/// action that could incur cost.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Availability {
    /// Whether the harness binary was resolved and could be invoked.
    pub available: bool,
    /// The harness version reported by the cost-free check, when available.
    pub version: Option<String>,
    /// Detail explaining unavailability.
    pub detail: Option<String>,
}

/// A single supported agent harness.
///
/// Implementations are trait objects so the orchestrator can treat every
/// harness uniformly.
#[async_trait::async_trait]
pub trait AgentHarness: Send + Sync {
    /// The slug this implementation handles.
    fn slug(&self) -> HarnessSlug;

    /// Resolve the harness binary and confirm it can be invoked, for example via
    /// `--version`.
    ///
    /// This must be cost-free: it must **never** start a session.
    async fn check_availability(&self) -> Result<Availability>;

    /// Drive a single harness session to completion against the seeded
    /// repository, returning normalized usage.
    ///
    /// The session executes inside the run's container; the working directory is
    /// the seeded repository.
    async fn invoke(&self, invocation: &HarnessInvocation) -> Result<HarnessOutcome>;
}

/// Looks up the [`AgentHarness`] implementation for a slug.
pub trait HarnessRegistry: Send + Sync {
    /// Return the harness implementation for a slug, if one is registered.
    fn get(&self, slug: HarnessSlug) -> Option<&dyn AgentHarness>;
}

#[cfg(test)]
#[path = "harness.test.rs"]
mod tests;
