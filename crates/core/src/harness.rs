//! Agent harness layer: a single abstraction for invoking any supported
//! third-party coding harness.
//!
//! See `docs/harnesses.md`. This layer absorbs harness-specific quirks: how each
//! harness is invoked non-interactively, and how each reports its usage. A run
//! corresponds to a single harness session driven to completion.

use std::borrow::Cow;

use serde::{Deserialize, Serialize};

use crate::auth::SubscriptionSpec;
use crate::error::Result;
use crate::event::{EventFormat, EventSink, HarnessEvent};
use crate::execution::{ContainerHandle, ContainerRuntime, ExecOutput, RawOutputLine};
use crate::metrics::TokenCounts;
use crate::run_record::HarnessSlug;
use crate::test_case::{AssetDimension, AssetKind, TestType};

/// The default registry the run-container image is pulled from, used when
/// `TCAB_CONTAINER_REGISTRY` is unset: the Test Cabinet Azure Container Registry,
/// which the Azure pipeline pushes every run-container image to and every cluster
/// it deploys pulls from.
const DEFAULT_CONTAINER_REGISTRY: &str = "testcabinet.azurecr.io";
/// The default image tag, used when `TCAB_CONTAINER_TAG` is unset.
const DEFAULT_CONTAINER_TAG: &str = "latest";
/// The name of the Rust/wasm base run-container image (`base-wasm`), used by every
/// end-to-end run. It is the pure-Node base plus the shared Rust → WebAssembly
/// toolchain (Rust + `wasm32-unknown-unknown` + wasm-bindgen + wasm-pack + binaryen),
/// so an end-to-end (or full-stack) build may author its simulation core in Rust and
/// ship it as a committed wasm build input. A harness installs its CLI into this image
/// at run time (see [`AgentHarness::install_command`]); there is no per-harness image,
/// except the [gg variant](ImageSpec::gg_variant) of this one.
/// The pure-Node base (`test-cabinet-base`) is the build-time parent of this image and
/// the asset-generation images, and is not itself resolved as a run image.
const BASE_WASM_IMAGE_NAME: &str = "test-cabinet-base-wasm";
/// The name of the full-stack (2D) run-container image, used by every full-stack
/// run. It is the base-wasm image plus the baked-in 2D asset-generation binaries
/// (`draw`, `draw-sheet`, `particle-2d`, `sfx-synth`, `sfx-sample`, `music`) on
/// `PATH`, so a model can both build a program and produce its own assets in one
/// run (see `containers/full-stack-2d/Dockerfile`).
const FULL_STACK_2D_IMAGE_NAME: &str = "test-cabinet-full-stack-2d";
/// The name of the 3D full-stack run-container image, used by every full-stack run
/// whose case declares `asset_dimension = "3d"`. It is a **superset** of the
/// full-stack-2d image — the same six 2D binaries, and audio staged from the case's
/// `[audio] packs` exactly as there — plus the voxel-model and 3D-particle tooling (`voxel`,
/// `voxel-anim`, `particle-3d`) and the Mesa software-Vulkan runtime those three render
/// their previews through. The meshed/SDF families (`mc`/`sn`/`dc` and their
/// `-anim`/`-skin` binaries) and the Blender toolchain are deliberately not in it: they
/// are a far heavier toolchain and no full-stack case needs them yet. It is a separate
/// image rather than an addition to the 2D one because the 3D tooling is weight every
/// 2D full-stack run would otherwise pull and never use (see
/// `containers/full-stack-3d/Dockerfile`).
const FULL_STACK_3D_IMAGE_NAME: &str = "test-cabinet-full-stack-3d";
/// The name of the game-jam run-container image, used by every game-jam run. A jam
/// is a full-stack-style build (it produces its own 2D assets and ships a browser
/// game) but is deliberately **not** a full-stack case, so it resolves its own image
/// rather than borrowing full-stack's. The image is the full-stack-2d image (the six
/// 2D asset-generation binaries on `PATH`, over the base-wasm
/// Rust → WebAssembly toolchain, so a jam may author its core in Rust and ship it as
/// committed wasm) — plus nothing but its own identity, so a deployment can pin the
/// jam image independently and coreutils `date` is present for a model to check its
/// time budget. See `containers/game-jam/Dockerfile`.
const GAME_JAM_IMAGE_NAME: &str = "test-cabinet-game-jam";
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

/// The image every **Blender** asset-generation run executes in (`blender-character`/
/// `blender-prop`/`blender-mechanism`) — a self-contained `ubuntu:26.04` image (the ONLY
/// run image not built `FROM` the shared base) carrying headless Blender and the
/// `tcab-blend` runner. See `containers/blender/Dockerfile` for why it is Ubuntu-based
/// rather than base-derived.
const BLENDER_IMAGE_NAME: &str = "test-cabinet-blender";
/// The name of the adversarial run-container image, used by every adversarial
/// run. It is the base-wasm image (which supplies the Rust + `wasm32-unknown-unknown`
/// toolchain a model's controller builds to wasm with) plus the baked-in Foray
/// tooling: the `foray` CLI, the controller buildkit, and the reference modules +
/// map (see `containers/adversarial/Dockerfile`).
const ADVERSARIAL_IMAGE_NAME: &str = "test-cabinet-adversarial";
/// The name of the performance run-container image, used by every performance
/// run. It is the base-wasm image (which supplies the Rust + `wasm32-unknown-unknown`
/// toolchain a model's engine builds to wasm with) plus the baked-in Lattice
/// tooling: the `lattice` CLI, the engine buildkit, the reference modules, and the
/// training scenarios (see `containers/performance/Dockerfile`).
const PERFORMANCE_IMAGE_NAME: &str = "test-cabinet-performance";

/// The suffix that names the **gg variant** of a run image: the same image plus the
/// language toolchains a [`gg`](HarnessSlug::Gg) run's
/// [responses-as-code](https://docs.testcabinet.ai/gg/languages/compilation/) programs are
/// compiled with (`containers/gg/Dockerfile`).
///
/// Every run image has one, and it is *derived* rather than listed: the variant of
/// `test-cabinet-sprite` is `test-cabinet-sprite-gg` and there is no image for which the
/// question "does it have a variant?" has a second answer. That is the whole of
/// [`ImageSpec::gg_variant`], and it is why a gg run can never resolve an image with no
/// toolchains in it.
///
/// They are separate published images rather than a layer on the shared ones because
/// those toolchains exist for one harness. A run driven by any other harness must not
/// carry them: they are gigabytes a run that cannot use them would pull, and a model that
/// found a Swift compiler on `PATH` in an end-to-end run would have been handed a
/// capability no other arm of that comparison has.
const GG_IMAGE_NAME_SUFFIX: &str = "-gg";
/// The suffix that names a gg variant's override environment variable, the counterpart of
/// [`GG_IMAGE_NAME_SUFFIX`]. A gg variant is pinned on its own, exactly as every other
/// image is: it is a different image with a different build, and an override that covered
/// both it and its parent could only ever be right for one.
const GG_IMAGE_OVERRIDE_ENV_SUFFIX: &str = "_GG";

/// The environment variable that pins a verbatim override for the base-wasm
/// (end-to-end) image, the per-image counterpart of `TCAB_CONTAINER_REGISTRY`/`_TAG`.
const BASE_WASM_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_BASE_WASM";
/// The environment variable that pins a verbatim override for the full-stack (2D)
/// image.
const FULL_STACK_2D_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_FULL_STACK_2D";
/// The environment variable that pins a verbatim override for the 3D full-stack image.
/// Separate from the 2D one for the reason every per-image override is separate: the two
/// full-stack images are different builds, so an override that covered both could only
/// ever be right for one.
const FULL_STACK_3D_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_FULL_STACK_3D";
/// The environment variable that pins a verbatim override for the game-jam image.
const GAME_JAM_IMAGE_OVERRIDE_ENV: &str = "TCAB_CONTAINER_IMAGE_GAME_JAM";
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

/// Every per-image override environment variable a run's own image can be pinned
/// with, one per run image, in image build order — **without** the gg variants, which
/// [`RUN_IMAGE_OVERRIDE_ENVS`] derives from these.
///
/// It lives here, beside the override constants and `image_spec_for`, so a new
/// asset kind is wired in ONE place; the `run_image_override_envs_is_exhaustive`
/// test fails the build if any kind's `override_env` is missing from this list (or
/// vice versa), so the dispatcher's forwarded set can never again silently drift
/// behind the images that exist.
const RUN_IMAGE_OVERRIDE_ENVS_PLAIN: &[&str] = &[
    BASE_WASM_IMAGE_OVERRIDE_ENV,
    FULL_STACK_2D_IMAGE_OVERRIDE_ENV,
    FULL_STACK_3D_IMAGE_OVERRIDE_ENV,
    GAME_JAM_IMAGE_OVERRIDE_ENV,
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

/// Every per-image override environment variable [`resolve_run_image`] consults: each
/// run image's own, and each one's `_GG` counterpart pinning that image's **gg variant**
/// (the same image plus the language toolchains a `gg` run's programs are compiled with).
/// This is the **canonical set** a deployment must
/// forward from the dispatcher into each driver `Job` so a full-ref
/// `TCAB_CONTAINER_IMAGE_*` override actually reaches the run-image resolution that
/// runs in the driver (see the dispatcher's `PASSTHROUGH_K8S_VARS`) — the
/// `TCAB_CONTAINER_REGISTRY`/`_TAG` composition is forwarded separately.
///
/// The variants are derived rather than listed, for the same reason their image names
/// are: there is exactly one per run image and no set of images to keep in step.
pub static RUN_IMAGE_OVERRIDE_ENVS: std::sync::LazyLock<Vec<String>> =
    std::sync::LazyLock::new(|| {
        RUN_IMAGE_OVERRIDE_ENVS_PLAIN
            .iter()
            .flat_map(|env| {
                [
                    (*env).to_string(),
                    format!("{env}{GG_IMAGE_OVERRIDE_ENV_SUFFIX}"),
                ]
            })
            .collect()
    });

/// How to resolve the run-container image for one kind of run: the composed
/// image name, and the environment variable that pins a verbatim override for
/// *that image* specifically. There is deliberately no override that spans every
/// image — an end-to-end, a single-sprite, and a sprite-sheet run each need a
/// different image, so a single override could only ever be right for one.
struct ImageSpec {
    /// The image name composed with the registry/tag, e.g. `test-cabinet-base`.
    ///
    /// Owned for the [gg variant](Self::gg_variant) alone, which derives its name from
    /// its parent's rather than being one of the constants above.
    name: Cow<'static, str>,
    /// The env var pinning a verbatim reference for this image.
    override_env: Cow<'static, str>,
}

impl ImageSpec {
    /// One of the run images named by the constants above.
    const fn of(name: &'static str, override_env: &'static str) -> Self {
        Self {
            name: Cow::Borrowed(name),
            override_env: Cow::Borrowed(override_env),
        }
    }

    /// The **gg variant** of this image: the same image plus the language toolchains a
    /// [`gg`](HarnessSlug::Gg) run's
    /// [responses-as-code](https://docs.testcabinet.ai/gg/languages/compilation/) programs
    /// are compiled with, named by appending [`GG_IMAGE_NAME_SUFFIX`] (and its override
    /// by appending [`GG_IMAGE_OVERRIDE_ENV_SUFFIX`]).
    ///
    /// gg is the one harness whose runs need something baked into the image rather than
    /// installed at run time. Every other harness is a CLI a run downloads
    /// ([`AgentHarness::install_command`]) and gg itself is a single static binary copied
    /// in, but a gg run driving responses-as-code in a compiled language needs that
    /// language's *compiler* on the turn path — and a program's language is resolved
    /// **per agent**, so one run may drive a C# agent and a Python agent at once and
    /// every toolchain has to be present together.
    ///
    /// # Every image has one
    ///
    /// This is a derivation, not a lookup, and that is the point: whichever image a run
    /// would otherwise get — an asset-generation kind, a full-stack dimension, blender,
    /// adversarial — the gg variant of it is published and carries the same toolchain
    /// tree. Selection reads three axes ([`TestType`], [`AssetKind`] and
    /// [`AssetDimension`]), and no combination of the three resolves a gg image with
    /// no compilers in it, because there is no list that could be missing one — an
    /// axis brings the variants of every image it selects with it.
    /// `containers/build.sh` builds a variant of every name in
    /// `containers/image-names.sh` for the same reason, and
    /// `every_resolvable_image_is_one_the_build_publishes` fails the build if the two
    /// ever disagree.
    fn gg_variant(&self) -> Self {
        Self {
            name: Cow::Owned(format!("{}{GG_IMAGE_NAME_SUFFIX}", self.name)),
            override_env: Cow::Owned(format!(
                "{}{GG_IMAGE_OVERRIDE_ENV_SUFFIX}",
                self.override_env
            )),
        }
    }
}

/// The [`ImageSpec`] for a run, selected by its [`TestType`] and — for the two types
/// that have more than one image to choose between — its [`AssetKind`] (asset
/// generation) or its [`AssetDimension`] (full-stack). End-to-end runs use the
/// base-wasm image (the base plus the shared Rust/wasm toolchain); full-stack runs use
/// the full-stack image of their declared dimension (the 2D six binaries, plus the
/// voxel/3D-particle tooling for `3d`); single-sprite runs use the sprite image (the
/// base plus the baked-in `draw` binary); sprite-sheet runs use the sprite-sheet image
/// (the base plus the baked-in `draw-sheet` binary); adversarial runs use the
/// adversarial image (the base plus the Rust + `wasm32-unknown-unknown` toolchain a
/// controller compiles to wasm with, and the baked-in Foray CLI + buildkit +
/// references); performance runs use the performance image (the same wasm toolchain
/// plus the baked-in Lattice CLI + buildkit + reference engines + training scenarios).
/// Each has its own override env var so a host can pin one image without disturbing the
/// others. `asset_kind` is ignored outside an asset-generation run (it is always
/// [`AssetKind::Sprite`] there), and `asset_dimension` outside a full-stack one (always
/// [`AssetDimension::TwoD`]) — resolution rejects a manifest that sets either where it
/// means nothing, so the value reaching here off any other type is the default.
fn image_spec_for(
    test_type: TestType,
    asset_kind: AssetKind,
    asset_dimension: AssetDimension,
) -> ImageSpec {
    match test_type {
        TestType::EndToEnd => ImageSpec::of(BASE_WASM_IMAGE_NAME, BASE_WASM_IMAGE_OVERRIDE_ENV),
        // The two full-stack images are the same shape — a wasm-capable base with the
        // asset-authoring binaries baked in — differing only in which binaries. The 3D
        // one is a superset, but it is not the default: its voxel/particle-3d tooling
        // and the Mesa stack they render through are weight a 2D case would pull and
        // never use, so a case opts into it with `asset_dimension = "3d"`.
        TestType::FullStack => match asset_dimension {
            AssetDimension::TwoD => {
                ImageSpec::of(FULL_STACK_2D_IMAGE_NAME, FULL_STACK_2D_IMAGE_OVERRIDE_ENV)
            }
            AssetDimension::ThreeD => {
                ImageSpec::of(FULL_STACK_3D_IMAGE_NAME, FULL_STACK_3D_IMAGE_OVERRIDE_ENV)
            }
        },
        // A game jam produces its own 2D assets and builds a browser game like a
        // full-stack run, but it is not a full-stack case: it resolves its own
        // (full-stack-2d-derived) image so a deployment can pin the jam image on its
        // own. It deliberately has no dimension to select on either — a jam is one
        // theme with one image, and its manifest format has no `asset_dimension`.
        TestType::GameJam => ImageSpec::of(GAME_JAM_IMAGE_NAME, GAME_JAM_IMAGE_OVERRIDE_ENV),
        TestType::AssetGeneration => match asset_kind {
            AssetKind::Sprite => ImageSpec::of(SPRITE_IMAGE_NAME, SPRITE_IMAGE_OVERRIDE_ENV),
            AssetKind::SpriteSheet => {
                ImageSpec::of(SPRITE_SHEET_IMAGE_NAME, SPRITE_SHEET_IMAGE_OVERRIDE_ENV)
            }
            AssetKind::VoxelModel => ImageSpec::of(VOXEL_IMAGE_NAME, VOXEL_IMAGE_OVERRIDE_ENV),
            AssetKind::VoxelAnimation => ImageSpec::of(
                VOXEL_ANIMATION_IMAGE_NAME,
                VOXEL_ANIMATION_IMAGE_OVERRIDE_ENV,
            ),
            AssetKind::McModel => ImageSpec::of(MC_IMAGE_NAME, MC_IMAGE_OVERRIDE_ENV),
            AssetKind::McAnimation => {
                ImageSpec::of(MC_ANIMATION_IMAGE_NAME, MC_ANIMATION_IMAGE_OVERRIDE_ENV)
            }
            AssetKind::SnModel => ImageSpec::of(SN_IMAGE_NAME, SN_IMAGE_OVERRIDE_ENV),
            AssetKind::SnAnimation => {
                ImageSpec::of(SN_ANIMATION_IMAGE_NAME, SN_ANIMATION_IMAGE_OVERRIDE_ENV)
            }
            AssetKind::DcModel => ImageSpec::of(DC_IMAGE_NAME, DC_IMAGE_OVERRIDE_ENV),
            AssetKind::DcAnimation => {
                ImageSpec::of(DC_ANIMATION_IMAGE_NAME, DC_ANIMATION_IMAGE_OVERRIDE_ENV)
            }
            AssetKind::Ui => ImageSpec::of(UI_IMAGE_NAME, UI_IMAGE_OVERRIDE_ENV),
            AssetKind::Material => ImageSpec::of(MATERIAL_IMAGE_NAME, MATERIAL_IMAGE_OVERRIDE_ENV),
            AssetKind::McSkinned => {
                ImageSpec::of(MC_SKINNED_IMAGE_NAME, MC_SKINNED_IMAGE_OVERRIDE_ENV)
            }
            AssetKind::SnSkinned => {
                ImageSpec::of(SN_SKINNED_IMAGE_NAME, SN_SKINNED_IMAGE_OVERRIDE_ENV)
            }
            AssetKind::DcSkinned => {
                ImageSpec::of(DC_SKINNED_IMAGE_NAME, DC_SKINNED_IMAGE_OVERRIDE_ENV)
            }
            AssetKind::Particle2d => {
                ImageSpec::of(PARTICLE_2D_IMAGE_NAME, PARTICLE_2D_IMAGE_OVERRIDE_ENV)
            }
            AssetKind::Particle3d => {
                ImageSpec::of(PARTICLE_3D_IMAGE_NAME, PARTICLE_3D_IMAGE_OVERRIDE_ENV)
            }
            AssetKind::SfxSynth => {
                ImageSpec::of(SFX_SYNTH_IMAGE_NAME, SFX_SYNTH_IMAGE_OVERRIDE_ENV)
            }
            AssetKind::SfxSample => {
                ImageSpec::of(SFX_SAMPLE_IMAGE_NAME, SFX_SAMPLE_IMAGE_OVERRIDE_ENV)
            }
            AssetKind::Music => ImageSpec::of(MUSIC_IMAGE_NAME, MUSIC_IMAGE_OVERRIDE_ENV),
            // The whole Blender family shares one image (headless Blender + `tcab-blend`).
            AssetKind::BlenderCharacter | AssetKind::BlenderProp | AssetKind::BlenderMechanism => {
                ImageSpec::of(BLENDER_IMAGE_NAME, BLENDER_IMAGE_OVERRIDE_ENV)
            }
        },
        TestType::Adversarial => {
            ImageSpec::of(ADVERSARIAL_IMAGE_NAME, ADVERSARIAL_IMAGE_OVERRIDE_ENV)
        }
        TestType::Performance => {
            ImageSpec::of(PERFORMANCE_IMAGE_NAME, PERFORMANCE_IMAGE_OVERRIDE_ENV)
        }
    }
}

/// The [`ImageSpec`] a run resolves once its harness is known: [`image_spec_for`], swapped
/// for its [gg variant](ImageSpec::gg_variant) when the subject is [`gg`](HarnessSlug::Gg).
///
/// Total in both directions: every harness resolves an image, and for gg that image always
/// carries the toolchains, because the variant is derived from the parent rather than
/// looked up in a list that could be missing an entry.
///
/// Separate from [`resolve_run_image`] so the selection can be asserted without touching
/// process-global environment, exactly as [`compose_run_image`] is.
fn image_spec_for_run(
    test_type: TestType,
    asset_kind: AssetKind,
    asset_dimension: AssetDimension,
    harness: HarnessSlug,
) -> ImageSpec {
    let spec = image_spec_for(test_type, asset_kind, asset_dimension);
    if harness != HarnessSlug::Gg {
        return spec;
    }
    spec.gg_variant()
}

/// Resolve the run-container image reference for a run, from the environment. The image
/// is selected by the run's [`TestType`], by its [`AssetKind`] for asset-generation,
/// and by its [`AssetDimension`] for full-stack — end-to-end runs use the base-wasm
/// image, full-stack runs use the full-stack image of their declared dimension,
/// single-sprite runs use the sprite image, sprite-sheet runs use the sprite-sheet
/// image, adversarial runs use the adversarial image — and the harness's CLI is
/// installed into the container at run time rather than baked into a per-harness image.
/// The runner pulls the image directly from a registry — it does **not** ask any
/// backend, so a runner pointed at any backend (or none) resolves it the same way (see
/// `docs/components/core/execution.md`).
///
/// `harness` is taken for the one thing that is not installed at run time: a
/// [`gg`](HarnessSlug::Gg) run resolves the **gg variant** of the image it
/// would otherwise get, carrying the language toolchains its programs are compiled with.
/// Every other slug resolves the shared image, which is what keeps those toolchains off
/// the runs that must not have them.
///
/// Precedence:
/// 1. The image's **own** override — `TCAB_CONTAINER_IMAGE_BASE_WASM` for an end-to-end
///    run, `TCAB_CONTAINER_IMAGE_FULL_STACK_2D` / `_FULL_STACK_3D` for a full-stack run
///    of either dimension, `TCAB_CONTAINER_IMAGE_SPRITE` for a single-sprite run,
///    `TCAB_CONTAINER_IMAGE_SPRITE_SHEET` for a sprite-sheet run, and the `_GG` suffixed
///    counterpart for a gg run, which resolves the variant — a full, verbatim
///    reference. Set it to a `@sha256:…` digest to pin an exact image, or to point
///    at a private build. There is no override that applies to every image: they
///    differ, so each is pinned on its own.
/// 2. `{registry}/{name}:{tag}`, where `name` is the run's image
///    (`BASE_WASM_IMAGE_NAME`, `SPRITE_IMAGE_NAME`, or `SPRITE_SHEET_IMAGE_NAME`),
///    `registry` is `TCAB_CONTAINER_REGISTRY` (default
///    `DEFAULT_CONTAINER_REGISTRY`) and `tag` is `TCAB_CONTAINER_TAG` (default
///    `DEFAULT_CONTAINER_TAG`). The registry and tag are shared across images but
///    compose with the per-image name, so one setting still yields distinct images.
///    An explicitly empty `TCAB_CONTAINER_REGISTRY` drops the registry prefix,
///    naming a local image (`{name}:{tag}`) for offline development.
///
/// The default with nothing set is the image in the Test Cabinet ACR on the latest
/// tag, e.g. `testcabinet.azurecr.io/test-cabinet-base-wasm:latest` for an end-to-end
/// run.
pub fn resolve_run_image(
    test_type: TestType,
    asset_kind: AssetKind,
    asset_dimension: AssetDimension,
    harness: HarnessSlug,
) -> String {
    let spec = image_spec_for_run(test_type, asset_kind, asset_dimension, harness);
    compose_run_image(
        &spec.name,
        std::env::var(spec.override_env.as_ref()).ok(),
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
    /// amount charged. The figure is what the run was billed, so the run engine
    /// records it as the actual cost; the comparable cost is computed from the
    /// model's curated list price regardless. Harnesses that do not report a
    /// cost leave this `None`, and the actual cost falls back to the comparable
    /// figure.
    pub reported_cost: Option<f64>,
    /// Every raw output line the harness produced, in arrival order, recorded so
    /// a run can persist the untranslated stream alongside its translation.
    pub raw_output: Vec<RawOutputLine>,
    /// The normalized events translated from the raw output, in the order they
    /// were produced, recorded for persistence beside the raw stream.
    pub translated_events: Vec<HarnessEvent>,
    /// The compact, aggregatable [summary](crate::gg::GgSessionSummary) of a **gg**
    /// run's outcome, lifted from the terminal
    /// [`SessionSummary`](crate::gg::GgTelemetryKind::SessionSummary) telemetry event
    /// the gg binary emits just before it ends. Recorded onto the run
    /// ([`RunSubject::gg_summary`](crate::run_record::RunSubject::gg_summary)) so result
    /// aggregation can slice a gg run's outcome without re-parsing its event stream.
    /// `None` for every third-party-harness run (which emits no such event) and for a
    /// gg run that ended before emitting one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gg_summary: Option<crate::gg::GgSessionSummary>,
    /// How many times each tool was invoked over the session, keyed by lowercased
    /// raw tool name — **including** tools that are recognized and consumed without
    /// emitting an event (the todo tools). Accumulated by the
    /// [event parser](crate::event::EventParser) as the stream is translated, and
    /// recorded onto the run so a comparison can diagnose tool-call behavior that a
    /// count derived from the event stream alone would miss. Empty for a gg run
    /// (whose per-tool detail comes from its own telemetry) and for any harness
    /// with no tool activity.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub tool_calls: std::collections::BTreeMap<String, u64>,
    /// Whether this session was ended by an **operator cancellation** rather than by the
    /// model or a ceiling — the run was killed, the harness was asked to wind down, and
    /// what is carried here is everything it had accumulated at that point.
    ///
    /// It rides the *outcome* rather than an error because a canceled session is not a
    /// failure to drive: it succeeded in producing a partial result, and the whole point
    /// of cancelling cooperatively is that the run then finishes through its ordinary
    /// post-session path (collect the tree, fold the metrics, write the record) instead
    /// of unwinding and losing all of it. The engine reads it to mark the run
    /// [`RunState::Canceled`](crate::run_record::RunState::Canceled) and to skip
    /// validation, which would be new work on a run that was told to stop.
    ///
    /// A [gg](crate::gg) session is the only one that ever sets it: gg is the one harness
    /// that can be asked to stop, and a canceled run of any other is destroyed by the
    /// driver without an outcome ever being produced.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub canceled: bool,
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
