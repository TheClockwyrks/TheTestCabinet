//! Agent harness layer: a single abstraction for invoking any supported
//! third-party coding harness.
//!
//! See `docs/harnesses.md`. This layer absorbs harness-specific quirks: how each
//! harness is invoked non-interactively, and how each reports its usage. A run
//! corresponds to a single harness session driven to completion.

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::event::{EventSink, HarnessEvent};
use crate::execution::{ContainerHandle, ContainerRuntime, RawOutputLine};
use crate::metrics::TokenCounts;
use crate::run_record::HarnessSlug;

/// The default registry/namespace harness images are published under, used when
/// `TCAB_CONTAINER_REGISTRY` is unset. Matches the namespace `containers/build.sh`
/// pushes to, so the resolve side and the publish side default to the same place.
const DEFAULT_CONTAINER_REGISTRY: &str = "ghcr.io/theclockwyrks";
/// The default image tag, used when `TCAB_CONTAINER_TAG` is unset.
const DEFAULT_CONTAINER_TAG: &str = "latest";

/// Resolve the container image reference to run a harness in, from the
/// environment. The runner pulls this directly from a registry — it does **not**
/// ask any backend, so a runner pointed at any backend (or none) resolves images
/// the same way (see `docs/components/core/execution.md`).
///
/// Precedence:
/// 1. `TCAB_CONTAINER_IMAGE_<HARNESS>` (e.g. `TCAB_CONTAINER_IMAGE_CLAUDE`) — a
///    full, verbatim reference for that one harness. Set it to a `@sha256:…`
///    digest to pin an exact image, or to point a harness at a private build.
/// 2. `{registry}/test-cabinet-{slug}:{tag}`, where `registry` is
///    `TCAB_CONTAINER_REGISTRY` (default [`DEFAULT_CONTAINER_REGISTRY`]) and `tag`
///    is `TCAB_CONTAINER_TAG` (default [`DEFAULT_CONTAINER_TAG`]). An explicitly
///    empty `TCAB_CONTAINER_REGISTRY` drops the registry prefix, naming a local
///    image (`test-cabinet-{slug}:{tag}`) for offline development.
///
/// The default with nothing set is the published image on the latest tag:
/// `ghcr.io/theclockwyrks/test-cabinet-{slug}:latest`.
pub fn resolve_harness_image(slug: HarnessSlug) -> String {
    let per_harness_var = format!("TCAB_CONTAINER_IMAGE_{}", slug.as_str().to_uppercase());
    compose_harness_image(
        slug,
        std::env::var(per_harness_var).ok(),
        std::env::var("TCAB_CONTAINER_REGISTRY").ok(),
        std::env::var("TCAB_CONTAINER_TAG").ok(),
    )
}

/// The pure core of [`resolve_harness_image`], taking the three environment
/// values directly so the precedence and composition can be tested without
/// touching process-global state. `None` is an unset variable; `Some("")` is an
/// explicitly empty one — for the registry those differ (unset → default
/// namespace; empty → no registry prefix at all).
fn compose_harness_image(
    slug: HarnessSlug,
    per_harness: Option<String>,
    registry: Option<String>,
    tag: Option<String>,
) -> String {
    if let Some(reference) = per_harness
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return reference.to_string();
    }

    let registry = match registry {
        Some(value) => value.trim().trim_end_matches('/').to_string(),
        None => DEFAULT_CONTAINER_REGISTRY.to_string(),
    };
    let tag = tag
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_CONTAINER_TAG.to_string());

    let name = format!("test-cabinet-{}", slug.as_str());
    if registry.is_empty() {
        format!("{name}:{tag}")
    } else {
        format!("{registry}/{name}:{tag}")
    }
}

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
    /// Every raw output line the harness produced, in arrival order, recorded so
    /// a run can persist the untranslated stream alongside its translation.
    pub raw_output: Vec<RawOutputLine>,
    /// The normalized events translated from the raw output, in the order they
    /// were produced, recorded for persistence beside the raw stream.
    pub translated_events: Vec<HarnessEvent>,
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

    /// The container image that provides this harness's CLI, resolved from the
    /// environment by [`resolve_harness_image`]. Used when a run carries no
    /// explicit per-run image override; the runner pulls it from a registry
    /// without consulting any backend.
    fn image(&self) -> String {
        resolve_harness_image(self.slug())
    }

    /// The environment variable carrying the provider API key, or `None` when
    /// the harness cannot use API-key authentication (the only mode The Test
    /// Cabinet supports for now). A `None` harness cannot be run.
    ///
    /// This is the variable read from the **host** environment, where a user
    /// exports the conventional provider key (for example `OPENAI_API_KEY`).
    fn api_key_env(&self) -> Option<&'static str>;

    /// The environment variable the API key is injected into **inside the run
    /// container**, which is not always the variable the user exports on the
    /// host. Defaults to [`api_key_env`](AgentHarness::api_key_env); a harness
    /// overrides it when its CLI reads the key from a different variable — for
    /// example Codex's non-interactive `codex exec` authenticates only from
    /// `CODEX_API_KEY`, not `OPENAI_API_KEY`.
    fn container_key_env(&self) -> Option<&'static str> {
        self.api_key_env()
    }

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

    /// Resolve the harness binary in `image` and confirm it can be invoked, for
    /// example via `--version`. `image` is the run's resolved container image (a
    /// backend-pulled digest reference, or the local-build fallback), so the
    /// probe checks the exact image the session will run in.
    ///
    /// This must be cost-free: it must **never** start a session.
    async fn check_availability(
        &self,
        runtime: &dyn ContainerRuntime,
        image: &str,
    ) -> Result<Availability>;

    /// Drive a single harness session to completion inside an already-started
    /// run container, returning normalized usage. The container's working
    /// directory is the seeded repository and its environment already carries
    /// the API key.
    ///
    /// Normalized [events](crate::event) are emitted to `events` as the harness
    /// produces output, so callers can observe the run live.
    async fn invoke(
        &self,
        runtime: &dyn ContainerRuntime,
        container: &ContainerHandle,
        invocation: &HarnessInvocation,
        events: &mut dyn EventSink,
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
