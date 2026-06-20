//! Agent harness layer: a single abstraction for invoking any supported
//! third-party coding harness.
//!
//! See `docs/harnesses.md`. This layer absorbs harness-specific quirks: how each
//! harness is invoked non-interactively, and how each reports its usage. A run
//! corresponds to a single harness session driven to completion.

use serde::{Deserialize, Serialize};

use crate::auth::SubscriptionSpec;
use crate::error::Result;
use crate::event::{EventSink, HarnessEvent};
use crate::execution::{ContainerHandle, ContainerRuntime, RawOutputLine};
use crate::metrics::TokenCounts;
use crate::run_record::HarnessSlug;
use crate::test_case::TestType;

/// The default registry/namespace the run-container image is published under,
/// used when `TCAB_CONTAINER_REGISTRY` is unset. Matches the namespace
/// `containers/build.sh` pushes to, so the resolve side and the publish side
/// default to the same place.
const DEFAULT_CONTAINER_REGISTRY: &str = "ghcr.io/theclockwyrks";
/// The default image tag, used when `TCAB_CONTAINER_TAG` is unset.
const DEFAULT_CONTAINER_TAG: &str = "latest";
/// The name of the base run-container image, used by every end-to-end run. A
/// harness installs its CLI into this image at run time (see
/// [`AgentHarness::install_command`]); there is no per-harness image.
const BASE_IMAGE_NAME: &str = "test-cabinet-base";
/// The name of the asset-generation run-container image, used by every
/// asset-generation run. It is the base image plus the baked-in `draw` binary
/// (see `containers/asset-gen/Dockerfile`).
const ASSET_GEN_IMAGE_NAME: &str = "test-cabinet-asset-gen";

/// The environment variable that pins a verbatim override for the base (end-to-
/// end) image, the per-test-type counterpart of `TCAB_CONTAINER_REGISTRY`/`_TAG`.
const BASE_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_BASE";
/// The environment variable that pins a verbatim override for the
/// asset-generation image.
const ASSET_GEN_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_ASSET_GEN";

/// How to resolve the run-container image for one [`TestType`]: the composed
/// image name, and the environment variable that pins a verbatim override for
/// *that test type* specifically. There is deliberately no override that spans
/// every test type — an end-to-end and an asset-generation run need different
/// images, so a single override could only ever be right for one of them.
struct ImageSpec {
    /// The image name composed with the registry/tag, e.g. `test-cabinet-base`.
    name: &'static str,
    /// The env var pinning a verbatim reference for this test type's image.
    override_env: &'static str,
}

/// The [`ImageSpec`] for a [`TestType`]. End-to-end runs use the base image;
/// asset-generation runs use the asset-generation image, which bakes in the
/// `draw` binary an asset-generation run drives. Each has its own override env
/// var so a host can pin one test type's image without disturbing the other.
fn image_spec_for(test_type: TestType) -> ImageSpec {
    match test_type {
        TestType::EndToEnd => ImageSpec {
            name: BASE_IMAGE_NAME,
            override_env: BASE_IMAGE_OVERRIDE_ENV,
        },
        TestType::AssetGeneration => ImageSpec {
            name: ASSET_GEN_IMAGE_NAME,
            override_env: ASSET_GEN_IMAGE_OVERRIDE_ENV,
        },
    }
}

/// Resolve the run-container image reference for a run's [`TestType`], from the
/// environment. The image is selected by test type — end-to-end runs use the
/// base image, asset-generation runs use the asset-generation image — and the
/// harness's CLI is installed into the container at run time rather than baked
/// into a per-harness image. The runner pulls the image directly from a registry
/// — it does **not** ask any backend, so a runner pointed at any backend (or
/// none) resolves it the same way (see `docs/components/core/execution.md`).
///
/// Precedence:
/// 1. The test type's **own** image override — `TCAB_CONTAINER_IMAGE_BASE` for an
///    end-to-end run, `TCAB_CONTAINER_IMAGE_ASSET_GEN` for an asset-generation
///    run — a full, verbatim reference. Set it to a `@sha256:…` digest to pin an
///    exact image, or to point at a private build. There is no override that
///    applies to all test types: the images differ, so each is pinned on its own.
/// 2. `{registry}/{name}:{tag}`, where `name` is the test type's image
///    ([`BASE_IMAGE_NAME`] or [`ASSET_GEN_IMAGE_NAME`]), `registry` is
///    `TCAB_CONTAINER_REGISTRY` (default [`DEFAULT_CONTAINER_REGISTRY`]) and `tag`
///    is `TCAB_CONTAINER_TAG` (default [`DEFAULT_CONTAINER_TAG`]). The registry
///    and tag are shared across test types but compose with the per-type name, so
///    one setting still yields distinct images. An explicitly empty
///    `TCAB_CONTAINER_REGISTRY` drops the registry prefix, naming a local image
///    (`{name}:{tag}`) for offline development.
///
/// The default with nothing set is the published image on the latest tag, e.g.
/// `ghcr.io/theclockwyrks/test-cabinet-base:latest` for an end-to-end run.
pub fn resolve_run_image(test_type: TestType) -> String {
    let spec = image_spec_for(test_type);
    compose_run_image(
        spec.name,
        std::env::var(spec.override_env).ok(),
        std::env::var("TCAB_CONTAINER_REGISTRY").ok(),
        std::env::var("TCAB_CONTAINER_TAG").ok(),
    )
}

/// The pure core of [`resolve_run_image`], taking the image name and the three
/// environment values directly so the precedence and composition can be tested
/// without touching process-global state. `None` is an unset variable; `Some("")`
/// is an explicitly empty one — for the registry those differ (unset → default
/// namespace; empty → no registry prefix at all).
fn compose_run_image(
    name: &str,
    explicit: Option<String>,
    registry: Option<String>,
    tag: Option<String>,
) -> String {
    if let Some(reference) = explicit
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

/// Reports whether a harness's CLI was installed and can be invoked.
///
/// The harness CLI is installed into the run container at run time (see
/// [`AgentHarness::install_command`]); this is the result of probing the
/// installed binary, for example via `--version`, once that install has run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Availability {
    /// Whether the harness binary was resolved and could be invoked.
    pub available: bool,
    /// The harness version reported by the probe, when available.
    pub version: Option<String>,
    /// Detail explaining unavailability.
    pub detail: Option<String>,
}

/// A single supported agent harness.
///
/// Implementations are trait objects so the orchestrator can treat every
/// harness uniformly. Every harness runs in the shared base run-container image
/// and installs its own CLI into the container at run time via
/// [`install_command`](AgentHarness::install_command), so both the install and
/// the session run through a [`ContainerRuntime`].
#[async_trait::async_trait]
pub trait AgentHarness: Send + Sync {
    /// The slug this implementation handles.
    fn slug(&self) -> HarnessSlug;

    /// The human-readable harness name, for display (for example by
    /// `tcab harnesses`). Defaults to the slug.
    fn name(&self) -> &str {
        self.slug().as_str()
    }

    /// The command run inside the run container, before the harness session, to
    /// install this harness's CLI. It runs through a non-login `sh -c` as the
    /// container's unprivileged run user, so the CLI is installed fresh on every
    /// run and a run always picks up the harness's latest published version.
    /// `None` means the harness needs no install step.
    fn install_command(&self) -> Option<&str> {
        None
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

    /// The subscription-authentication descriptor for this harness, or `None`
    /// when it supports only API-key authentication. It names the credential
    /// files the harness's CLI writes when the user signs in, and the paths they
    /// are copied to inside the run container so the harness authenticates with
    /// the account subscription. See [`crate::auth`].
    fn subscription_spec(&self) -> Option<SubscriptionSpec> {
        None
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

    /// Confirm the harness's CLI is installed in an already-started run
    /// container and can be invoked, for example via `--version`, capturing its
    /// version. Run after [`install_command`](AgentHarness::install_command) has
    /// installed the CLI and before the session starts, so the run fails with a
    /// clear error if the install did not produce a working binary.
    ///
    /// This must be cost-free: it must **never** start a session.
    async fn probe(
        &self,
        runtime: &dyn ContainerRuntime,
        container: &ContainerHandle,
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
