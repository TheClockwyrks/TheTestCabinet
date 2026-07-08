//! Agent harness layer: a single abstraction for invoking any supported
//! third-party coding harness.
//!
//! See `docs/harnesses.md`. This layer absorbs harness-specific quirks: how each
//! harness is invoked non-interactively, and how each reports its usage. A run
//! corresponds to a single harness session driven to completion.

use serde::{Deserialize, Serialize};

use crate::auth::SubscriptionSpec;
use crate::error::Result;
use crate::event::{EventFormat, EventSink, HarnessEvent};
use crate::execution::{ContainerHandle, ContainerRuntime, ExecOutput, RawOutputLine};
use crate::metrics::TokenCounts;
use crate::run_record::HarnessSlug;
use crate::test_case::{AssetKind, TestType};

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
/// The name of the sprite run-container image, used by every single-sprite
/// asset-generation run (`asset_kind = "sprite"`). It is the base image plus the
/// baked-in `draw` binary (see `containers/sprite/Dockerfile`).
const SPRITE_IMAGE_NAME: &str = "test-cabinet-sprite";
/// The name of the sprite-sheet run-container image, used by every sprite-sheet
/// asset-generation run (`asset_kind = "sprite-sheet"`). It is the base image
/// plus the baked-in `draw-sheet` binary (see `containers/sprite-sheet/Dockerfile`).
const SPRITE_SHEET_IMAGE_NAME: &str = "test-cabinet-sprite-sheet";
/// The name of the static-voxel run-container image, used by every static voxel
/// asset-generation run (`asset_kind = "voxel-model"`). It is the base image plus
/// the baked-in `voxel` binary (see `containers/voxel/Dockerfile`).
const VOXEL_IMAGE_NAME: &str = "test-cabinet-voxel";
/// The name of the animated-voxel run-container image, used by every voxel-animation
/// asset-generation run (`asset_kind = "voxel-animation"`). It is the base image
/// plus the baked-in `voxel-anim` binary (see `containers/voxel-animation/Dockerfile`).
const VOXEL_ANIMATION_IMAGE_NAME: &str = "test-cabinet-voxel-animation";
/// The name of the marching-cubes static run-container image, used by every
/// `mc-model` asset-generation run. It is the base image plus the baked-in `mc`
/// binary (see `containers/mc/Dockerfile`).
const MC_IMAGE_NAME: &str = "test-cabinet-mc";
/// The name of the marching-cubes animated run-container image, used by every
/// `mc-animation` run. It is the base image plus the baked-in `mc-anim` binary.
const MC_ANIMATION_IMAGE_NAME: &str = "test-cabinet-mc-animation";
/// The name of the surface-nets static run-container image, used by every
/// `sn-model` run. It is the base image plus the baked-in `sn` binary.
const SN_IMAGE_NAME: &str = "test-cabinet-sn";
/// The name of the surface-nets animated run-container image, used by every
/// `sn-animation` run. It is the base image plus the baked-in `sn-anim` binary.
const SN_ANIMATION_IMAGE_NAME: &str = "test-cabinet-sn-animation";
/// The name of the dual-contouring static run-container image, used by every
/// `dc-model` run. It is the base image plus the baked-in `dc` binary.
const DC_IMAGE_NAME: &str = "test-cabinet-dc";
/// The name of the dual-contouring animated run-container image, used by every
/// `dc-animation` run. It is the base image plus the baked-in `dc-anim` binary.
const DC_ANIMATION_IMAGE_NAME: &str = "test-cabinet-dc-animation";
/// The name of the `ui` run-container image, used by every `ui` asset-generation
/// run. It is the base image plus the baked-in `paint`/`ui` binaries.
const UI_IMAGE_NAME: &str = "test-cabinet-ui";
/// The name of the `material` run-container image (base plus `texture`/`pbr`).
const MATERIAL_IMAGE_NAME: &str = "test-cabinet-material";
/// The name of the `mc-skinned` run-container image (base plus `mc-skin`).
const MC_SKINNED_IMAGE_NAME: &str = "test-cabinet-mc-skinned";
/// The name of the `sn-skinned` run-container image (base plus `sn-skin`).
const SN_SKINNED_IMAGE_NAME: &str = "test-cabinet-sn-skinned";
/// The name of the `dc-skinned` run-container image (base plus `dc-skin`).
const DC_SKINNED_IMAGE_NAME: &str = "test-cabinet-dc-skinned";
/// The name of the `particle-2d` run-container image (base plus `particle-2d`).
const PARTICLE_2D_IMAGE_NAME: &str = "test-cabinet-particle-2d";
/// The name of the `particle-3d` run-container image (base plus `particle-3d`).
const PARTICLE_3D_IMAGE_NAME: &str = "test-cabinet-particle-3d";
/// The name of the `sfx-synth` run-container image (base plus `sfx-synth`).
const SFX_SYNTH_IMAGE_NAME: &str = "test-cabinet-sfx-synth";
/// The name of the `sfx-sample` run-container image (base plus `sfx-sample` and its
/// baked sample pack).
const SFX_SAMPLE_IMAGE_NAME: &str = "test-cabinet-sfx-sample";
/// The name of the `music` run-container image (base plus `music` and its baked
/// instrument bank).
const MUSIC_IMAGE_NAME: &str = "test-cabinet-music";

/// The image every `blender-character` asset-generation run executes in — the base
/// image plus headless Blender and the `tcab-blend` runner.
const BLENDER_IMAGE_NAME: &str = "test-cabinet-blender";
/// The name of the adversarial run-container image, used by every adversarial
/// run. It is the base image plus the Rust + `wasm32-unknown-unknown` toolchain
/// (so a model's controller builds to wasm in-container) and the baked-in Foray
/// tooling: the `foray` CLI, the controller buildkit, and the reference modules +
/// map (see `containers/adversarial/Dockerfile`).
const ADVERSARIAL_IMAGE_NAME: &str = "test-cabinet-adversarial";
/// The name of the performance run-container image, used by every performance
/// run. It is the base image plus the Rust + `wasm32-unknown-unknown` toolchain
/// (so a model's engine builds to wasm in-container) and the baked-in Lattice
/// tooling: the `lattice` CLI, the engine buildkit, the reference modules, and the
/// training scenarios (see `containers/performance/Dockerfile`).
const PERFORMANCE_IMAGE_NAME: &str = "test-cabinet-performance";

/// The environment variable that pins a verbatim override for the base (end-to-
/// end) image, the per-image counterpart of `TCAB_CONTAINER_REGISTRY`/`_TAG`.
const BASE_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_BASE";
/// The environment variable that pins a verbatim override for the sprite image.
const SPRITE_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_SPRITE";
/// The environment variable that pins a verbatim override for the sprite-sheet
/// image.
const SPRITE_SHEET_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_SPRITE_SHEET";
/// The environment variable that pins a verbatim override for the static-voxel image.
const VOXEL_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_VOXEL";
/// The environment variable that pins a verbatim override for the animated-voxel image.
const VOXEL_ANIMATION_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_VOXEL_ANIMATION";
/// The environment variable that pins a verbatim override for the marching-cubes
/// static (`mc-model`) image.
const MC_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_MC";
/// The environment variable that pins a verbatim override for the marching-cubes
/// animated (`mc-animation`) image.
const MC_ANIMATION_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_MC_ANIMATION";
/// The environment variable that pins a verbatim override for the surface-nets
/// static (`sn-model`) image.
const SN_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_SN";
/// The environment variable that pins a verbatim override for the surface-nets
/// animated (`sn-animation`) image.
const SN_ANIMATION_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_SN_ANIMATION";
/// The environment variable that pins a verbatim override for the dual-contouring
/// static (`dc-model`) image.
const DC_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_DC";
/// The environment variable that pins a verbatim override for the dual-contouring
/// animated (`dc-animation`) image.
const DC_ANIMATION_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_DC_ANIMATION";
/// The environment variable that pins a verbatim override for the `ui` image.
const UI_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_UI";
/// The environment variable that pins a verbatim override for the `material` image.
const MATERIAL_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_MATERIAL";
/// The environment variable that pins a verbatim override for the `mc-skinned` image.
const MC_SKINNED_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_MC_SKINNED";
/// The environment variable that pins a verbatim override for the `sn-skinned` image.
const SN_SKINNED_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_SN_SKINNED";
/// The environment variable that pins a verbatim override for the `dc-skinned` image.
const DC_SKINNED_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_DC_SKINNED";
/// The environment variable that pins a verbatim override for the `particle-2d` image.
const PARTICLE_2D_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_PARTICLE_2D";
/// The environment variable that pins a verbatim override for the `particle-3d` image.
const PARTICLE_3D_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_PARTICLE_3D";
/// The environment variable that pins a verbatim override for the `sfx-synth` image.
const SFX_SYNTH_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_SFX_SYNTH";
/// The environment variable that pins a verbatim override for the `sfx-sample` image.
const SFX_SAMPLE_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_SFX_SAMPLE";
/// The environment variable that pins a verbatim override for the `music` image.
const MUSIC_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_MUSIC";
const BLENDER_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_BLENDER";
/// The environment variable that pins a verbatim override for the adversarial
/// image.
const ADVERSARIAL_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_ADVERSARIAL";
/// The environment variable that pins a verbatim override for the performance
/// image.
const PERFORMANCE_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_PERFORMANCE";

/// Every per-image override environment variable [`resolve_run_image`] consults,
/// one per run image, in image build order. This is the **canonical set** a
/// deployment must forward from the dispatcher into each driver `Job` so a full-ref
/// `TCAB_CONTAINER_IMAGE_*` override actually reaches the run-image resolution that
/// runs in the driver (see the dispatcher's `PASSTHROUGH_K8S_VARS`) — the
/// `TCAB_CONTAINER_REGISTRY`/`_TAG` composition is forwarded separately.
///
/// It lives here, beside the override constants and `image_spec_for`, so a new
/// asset kind is wired in ONE place; the `run_image_override_envs_is_exhaustive`
/// test fails the build if any kind's `override_env` is missing from this list (or
/// vice versa), so the dispatcher's forwarded set can never again silently drift
/// behind the images that exist.
pub const RUN_IMAGE_OVERRIDE_ENVS: &[&str] = &[
    BASE_IMAGE_OVERRIDE_ENV,
    SPRITE_IMAGE_OVERRIDE_ENV,
    SPRITE_SHEET_IMAGE_OVERRIDE_ENV,
    VOXEL_IMAGE_OVERRIDE_ENV,
    VOXEL_ANIMATION_IMAGE_OVERRIDE_ENV,
    MC_IMAGE_OVERRIDE_ENV,
    MC_ANIMATION_IMAGE_OVERRIDE_ENV,
    SN_IMAGE_OVERRIDE_ENV,
    SN_ANIMATION_IMAGE_OVERRIDE_ENV,
    DC_IMAGE_OVERRIDE_ENV,
    DC_ANIMATION_IMAGE_OVERRIDE_ENV,
    UI_IMAGE_OVERRIDE_ENV,
    MATERIAL_IMAGE_OVERRIDE_ENV,
    MC_SKINNED_IMAGE_OVERRIDE_ENV,
    SN_SKINNED_IMAGE_OVERRIDE_ENV,
    DC_SKINNED_IMAGE_OVERRIDE_ENV,
    PARTICLE_2D_IMAGE_OVERRIDE_ENV,
    PARTICLE_3D_IMAGE_OVERRIDE_ENV,
    SFX_SYNTH_IMAGE_OVERRIDE_ENV,
    SFX_SAMPLE_IMAGE_OVERRIDE_ENV,
    MUSIC_IMAGE_OVERRIDE_ENV,
    BLENDER_IMAGE_OVERRIDE_ENV,
    ADVERSARIAL_IMAGE_OVERRIDE_ENV,
    PERFORMANCE_IMAGE_OVERRIDE_ENV,
];

/// How to resolve the run-container image for one kind of run: the composed
/// image name, and the environment variable that pins a verbatim override for
/// *that image* specifically. There is deliberately no override that spans every
/// image — an end-to-end, a single-sprite, and a sprite-sheet run each need a
/// different image, so a single override could only ever be right for one.
struct ImageSpec {
    /// The image name composed with the registry/tag, e.g. `test-cabinet-base`.
    name: &'static str,
    /// The env var pinning a verbatim reference for this image.
    override_env: &'static str,
}

/// The [`ImageSpec`] for a run, selected by its [`TestType`] and (for
/// asset-generation) its [`AssetKind`]. End-to-end runs use the base image;
/// single-sprite runs use the sprite image (the base plus the baked-in `draw`
/// binary); sprite-sheet runs use the sprite-sheet image (the base plus the
/// baked-in `draw-sheet` binary); adversarial runs use the adversarial image (the
/// base plus the Rust + `wasm32-unknown-unknown` toolchain a controller compiles
/// to wasm with, and the baked-in Foray CLI + buildkit + references); performance
/// runs use the performance image (the same wasm toolchain plus the baked-in
/// Lattice CLI + buildkit + reference engines + training scenarios). Each has its
/// own override env var so a host can pin one image
/// without disturbing the others. `asset_kind` is ignored outside an
/// asset-generation run (it is always [`AssetKind::Sprite`] there).
fn image_spec_for(test_type: TestType, asset_kind: AssetKind) -> ImageSpec {
    match test_type {
        TestType::EndToEnd => ImageSpec {
            name: BASE_IMAGE_NAME,
            override_env: BASE_IMAGE_OVERRIDE_ENV,
        },
        TestType::AssetGeneration => match asset_kind {
            AssetKind::Sprite => ImageSpec {
                name: SPRITE_IMAGE_NAME,
                override_env: SPRITE_IMAGE_OVERRIDE_ENV,
            },
            AssetKind::SpriteSheet => ImageSpec {
                name: SPRITE_SHEET_IMAGE_NAME,
                override_env: SPRITE_SHEET_IMAGE_OVERRIDE_ENV,
            },
            AssetKind::VoxelModel => ImageSpec {
                name: VOXEL_IMAGE_NAME,
                override_env: VOXEL_IMAGE_OVERRIDE_ENV,
            },
            AssetKind::VoxelAnimation => ImageSpec {
                name: VOXEL_ANIMATION_IMAGE_NAME,
                override_env: VOXEL_ANIMATION_IMAGE_OVERRIDE_ENV,
            },
            AssetKind::McModel => ImageSpec {
                name: MC_IMAGE_NAME,
                override_env: MC_IMAGE_OVERRIDE_ENV,
            },
            AssetKind::McAnimation => ImageSpec {
                name: MC_ANIMATION_IMAGE_NAME,
                override_env: MC_ANIMATION_IMAGE_OVERRIDE_ENV,
            },
            AssetKind::SnModel => ImageSpec {
                name: SN_IMAGE_NAME,
                override_env: SN_IMAGE_OVERRIDE_ENV,
            },
            AssetKind::SnAnimation => ImageSpec {
                name: SN_ANIMATION_IMAGE_NAME,
                override_env: SN_ANIMATION_IMAGE_OVERRIDE_ENV,
            },
            AssetKind::DcModel => ImageSpec {
                name: DC_IMAGE_NAME,
                override_env: DC_IMAGE_OVERRIDE_ENV,
            },
            AssetKind::DcAnimation => ImageSpec {
                name: DC_ANIMATION_IMAGE_NAME,
                override_env: DC_ANIMATION_IMAGE_OVERRIDE_ENV,
            },
            AssetKind::Ui => ImageSpec {
                name: UI_IMAGE_NAME,
                override_env: UI_IMAGE_OVERRIDE_ENV,
            },
            AssetKind::Material => ImageSpec {
                name: MATERIAL_IMAGE_NAME,
                override_env: MATERIAL_IMAGE_OVERRIDE_ENV,
            },
            AssetKind::McSkinned => ImageSpec {
                name: MC_SKINNED_IMAGE_NAME,
                override_env: MC_SKINNED_IMAGE_OVERRIDE_ENV,
            },
            AssetKind::SnSkinned => ImageSpec {
                name: SN_SKINNED_IMAGE_NAME,
                override_env: SN_SKINNED_IMAGE_OVERRIDE_ENV,
            },
            AssetKind::DcSkinned => ImageSpec {
                name: DC_SKINNED_IMAGE_NAME,
                override_env: DC_SKINNED_IMAGE_OVERRIDE_ENV,
            },
            AssetKind::Particle2d => ImageSpec {
                name: PARTICLE_2D_IMAGE_NAME,
                override_env: PARTICLE_2D_IMAGE_OVERRIDE_ENV,
            },
            AssetKind::Particle3d => ImageSpec {
                name: PARTICLE_3D_IMAGE_NAME,
                override_env: PARTICLE_3D_IMAGE_OVERRIDE_ENV,
            },
            AssetKind::SfxSynth => ImageSpec {
                name: SFX_SYNTH_IMAGE_NAME,
                override_env: SFX_SYNTH_IMAGE_OVERRIDE_ENV,
            },
            AssetKind::SfxSample => ImageSpec {
                name: SFX_SAMPLE_IMAGE_NAME,
                override_env: SFX_SAMPLE_IMAGE_OVERRIDE_ENV,
            },
            AssetKind::Music => ImageSpec {
                name: MUSIC_IMAGE_NAME,
                override_env: MUSIC_IMAGE_OVERRIDE_ENV,
            },
            AssetKind::BlenderCharacter => ImageSpec {
                name: BLENDER_IMAGE_NAME,
                override_env: BLENDER_IMAGE_OVERRIDE_ENV,
            },
        },
        TestType::Adversarial => ImageSpec {
            name: ADVERSARIAL_IMAGE_NAME,
            override_env: ADVERSARIAL_IMAGE_OVERRIDE_ENV,
        },
        TestType::Performance => ImageSpec {
            name: PERFORMANCE_IMAGE_NAME,
            override_env: PERFORMANCE_IMAGE_OVERRIDE_ENV,
        },
    }
}

/// Resolve the run-container image reference for a run, from the environment. The
/// image is selected by the run's [`TestType`] and (for asset-generation) its
/// [`AssetKind`] — end-to-end runs use the base image, single-sprite runs use the
/// sprite image, sprite-sheet runs use the sprite-sheet image, adversarial runs
/// use the adversarial image — and the harness's CLI is installed into the
/// container at run time rather than baked into a per-harness image. The runner
/// pulls the image directly from a registry — it does **not** ask any backend, so
/// a runner pointed at any backend (or none) resolves it the same way (see
/// `docs/components/core/execution.md`).
///
/// Precedence:
/// 1. The image's **own** override — `TCAB_CONTAINER_IMAGE_BASE` for an end-to-end
///    run, `TCAB_CONTAINER_IMAGE_SPRITE` for a single-sprite run,
///    `TCAB_CONTAINER_IMAGE_SPRITE_SHEET` for a sprite-sheet run — a full, verbatim
///    reference. Set it to a `@sha256:…` digest to pin an exact image, or to point
///    at a private build. There is no override that applies to every image: they
///    differ, so each is pinned on its own.
/// 2. `{registry}/{name}:{tag}`, where `name` is the run's image
///    ([`BASE_IMAGE_NAME`], [`SPRITE_IMAGE_NAME`], or [`SPRITE_SHEET_IMAGE_NAME`]),
///    `registry` is `TCAB_CONTAINER_REGISTRY` (default
///    [`DEFAULT_CONTAINER_REGISTRY`]) and `tag` is `TCAB_CONTAINER_TAG` (default
///    [`DEFAULT_CONTAINER_TAG`]). The registry and tag are shared across images but
///    compose with the per-image name, so one setting still yields distinct images.
///    An explicitly empty `TCAB_CONTAINER_REGISTRY` drops the registry prefix,
///    naming a local image (`{name}:{tag}`) for offline development.
///
/// The default with nothing set is the published image on the latest tag, e.g.
/// `ghcr.io/theclockwyrks/test-cabinet-base:latest` for an end-to-end run.
pub fn resolve_run_image(test_type: TestType, asset_kind: AssetKind) -> String {
    let spec = image_spec_for(test_type, asset_kind);
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

    /// The full command line — the CLI binary followed by the harness's exact
    /// non-interactive session arguments — that drives a single session for
    /// `model_id` against `prompt`.
    ///
    /// This is the single source of truth for how a session is invoked. The
    /// direct [`invoke`](AgentHarness::invoke) path runs it directly; an
    /// [orchestrator](crate::orchestrator) renders it into the in-container
    /// `tcab-session` wrapper (with the prompt left as a substitutable argument)
    /// so a runner script can invoke a session without knowing any
    /// harness-specific detail.
    fn session_argv(&self, model_id: &str, prompt: &str) -> Vec<String>;

    /// How this harness's raw output is translated into normalized
    /// [events](crate::event). An orchestrator builds its own
    /// [`EventParser`](crate::event::EventParser) for the runner's streamed
    /// output from this, so the harness's activity is translated exactly as it is
    /// on the direct [`invoke`](AgentHarness::invoke) path.
    fn event_format(&self) -> EventFormat;

    /// Parse one session's normalized usage and self-reported cost out of its
    /// captured output, exactly as [`invoke`](AgentHarness::invoke) does.
    ///
    /// An orchestrator segments the runner's combined output into per-session
    /// slices (delimited by the `tcab-session` wrapper's sentinels) and calls
    /// this on each slice, then sums the per-session usage into the run's totals.
    /// For a single session the result equals what `invoke` produces. The
    /// returned cost is the harness's own exact charge when it reports one (see
    /// [`HarnessOutcome::reported_cost`]), otherwise `None`.
    fn parse_session_usage(&self, output: &ExecOutput) -> (Usage, Option<f64>);

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
