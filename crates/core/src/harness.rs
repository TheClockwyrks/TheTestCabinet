//! Agent harness layer: a single abstraction for invoking any supported
//! third-party coding harness.
//!
//! See `docs/harnesses.md`. This layer absorbs harness-specific quirks: how each
//! harness is invoked non-interactively, and how each reports its usage. A run
//! corresponds to a single harness session driven to completion.

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::execution::{ContainerHandle, ContainerRuntime};
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessOutcome {
    /// Normalized usage for the session.
    pub usage: Usage,
    /// The harness version, where it could be determined.
    pub harness_version: Option<String>,
    /// The exact run cost in USD as reported by the harness itself, when it
    /// reports one.
    ///
    /// Harnesses that drive a single provider directly through an API key (for
    /// example Claude Code, which reports `total_cost_usd`) emit the exact
    /// amount charged. Because such a harness talks to one provider at one
    /// price, this figure is both the actual charge and a provider-stable
    /// comparable value, so the orchestrator uses it directly and skips the
    /// OpenRouter price lookup. Harnesses that do not report a cost leave this
    /// `None` and fall back to OpenRouter-derived pricing.
    pub reported_cost: Option<f64>,
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
/// harness uniformly. The harness CLI itself lives inside a per-harness
/// container image, so both the availability probe and the session run through a
/// [`ContainerRuntime`].
#[async_trait::async_trait]
pub trait AgentHarness: Send + Sync {
    /// The slug this implementation handles.
    fn slug(&self) -> HarnessSlug;

    /// The container image that provides this harness's CLI.
    fn image(&self) -> String {
        format!("test-cabinet/{}:latest", self.slug().as_str())
    }

    /// The environment variable carrying the provider API key, or `None` when
    /// the harness cannot use API-key authentication (the only mode The Test
    /// Cabinet supports for now). A `None` harness cannot be run.
    fn api_key_env(&self) -> Option<&'static str>;

    /// Map a run's model ID to the ID OpenRouter lists it under, for the
    /// comparable-cost lookup.
    ///
    /// Harnesses that route through OpenRouter already receive an OpenRouter
    /// model ID and pass it through unchanged (the default). Harnesses that take
    /// a provider-native ID map it to the equivalent OpenRouter catalog ID — for
    /// example Codex's `gpt-5.5` becomes `openai/gpt-5.5`. This mapping is only
    /// consulted when the harness does not report its own cost.
    fn pricing_model_id(&self, model_id: &str) -> String {
        model_id.to_string()
    }

    /// Resolve the harness binary in its image and confirm it can be invoked,
    /// for example via `--version`.
    ///
    /// This must be cost-free: it must **never** start a session.
    async fn check_availability(&self, runtime: &dyn ContainerRuntime) -> Result<Availability>;

    /// Drive a single harness session to completion inside an already-started
    /// run container, returning normalized usage. The container's working
    /// directory is the seeded repository and its environment already carries
    /// the API key.
    async fn invoke(
        &self,
        runtime: &dyn ContainerRuntime,
        container: &ContainerHandle,
        invocation: &HarnessInvocation,
    ) -> Result<HarnessOutcome>;
}

/// Looks up the [`AgentHarness`] implementation for a slug.
pub trait HarnessRegistry: Send + Sync {
    /// Return the harness implementation for a slug, if one is registered.
    fn get(&self, slug: HarnessSlug) -> Option<&dyn AgentHarness>;
}

#[cfg(test)]
#[path = "harness.test.rs"]
mod tests;
