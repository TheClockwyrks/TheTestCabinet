//! The shapes of a resolved test case: its type and asset kind, the specs, the
//! workspace and the variants a run is built from, the checklist a run is reviewed
//! against, the engines it may run on, and the names of the files a run is seeded
//! with.
//!
//! See `docs/testing/end-to-end/overview.md`. A [`TestCaseVersion`] is what the
//! catalog resolves a case's manifest into and what the definition store holds;
//! the manifest formats and the catalog that reads them live in
//! `test_cabinet_core::test_case`, which re-exports everything here.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

use semver::Version;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

// Named by the documentation only.
#[cfg(doc)]
use crate::engine::NONE_SLUG;
use crate::review::FailureCap;

/// A variant a version does not declare was asked for.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("variant `{variant}` of test case `{slug}@{version}` not found")]
pub struct VariantNotFound {
    /// The case's slug.
    pub slug: String,
    /// The case version.
    pub version: String,
    /// The variant slug that was asked for.
    pub variant: String,
}

/// Convert a runtime cap expressed in **hours** — the unit test-case manifests
/// (`max_runtime_hours`) and the `--max-runtime` CLI flag are authored in — into
/// whole seconds, the unit the run pipeline (job API, backend, timeouts) carries
/// internally. Callers author durations in fractional hours (for example `0.5`)
/// because every cap is long enough that seconds add no useful precision; this
/// rounds to the nearest second at the single edge where the two units meet.
pub fn runtime_hours_to_seconds(hours: f64) -> u64 {
    (hours * 3600.0).round() as u64
}

/// The serde default of a checklist item's `scored` flag.
fn default_true() -> bool {
    true
}

/// The audio packs a full-stack case or game jam that declares **no** `[audio]`
/// table receives.
///
/// Fixed, in code, at the set those versions were authored and reviewed against —
/// the four packs the full-stack run image baked when audio was delivered by the
/// image rather than by the run. It is a version-pinned literal and never a scan of
/// `containers/sample-packs/`, so publishing a new pack cannot change what an
/// already frozen version is given; that silent widening is
/// precisely the defect that moving delivery into the run fixes, and a growable
/// default would reintroduce it.
///
/// Only a version that predates the key can reach it: `scripts/ci/audio-packs-check.mjs`
/// requires an explicit `packs` on every non-frozen full-stack version and on every
/// jam, on the commit hook and in CI. Growing or reordering this list is therefore a
/// deliberate edit, and `crates/core/src/test_case.audio.test.rs` asserts its exact
/// contents and order so it fails a gate.
pub const DEFAULT_AUDIO_PACKS: [&str; 4] = [
    "combat-core@0.1.0",
    "gm-lite@0.1.0",
    "cinematic@0.1.0",
    "synthwave@0.1.0",
];

/// Whether one half of a `name@version` audio pack ref is usable.
///
/// Each half names a directory of the tree a run is staged with
/// (`packs/<name>@<version>/`), so a half is held to plain name characters and may not
/// be a dot segment: a ref carrying a separator or a `..` would place a pack's manifest
/// somewhere other than the staged tree.
pub fn is_pack_ref_half(half: &str) -> bool {
    !half.is_empty()
        && !half.starts_with('.')
        && half
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

/// The host **package store** the shippable Test Cabinet packages are baked into
/// on the driver image (which seeds runs — see `containers/README.md`). At seed
/// time a `packages`-declaring case's requested libraries are copied out of this
/// store and **vendored into the run repository** under [`TCAB_VENDOR_DIR`], so the
/// produced tree is self-contained. This is a build-host path, never referenced by
/// the produced game.
pub const TCAB_PACKAGES_DIR: &str = "/opt/tcab-packages";

/// The host **audio store** every published audio pack is baked into on the driver
/// image, and which a run's declared packs are staged out of at container start (see
/// `test_cabinet_core::audio_stage`). Overridden by `TCAB_AUDIO_STORE` for a local checkout,
/// which fetches the same store with `scripts/fetch-audio-store.sh`. Unlike
/// [`TCAB_PACKAGES_DIR`], nothing from it is vendored into the run repository: the
/// clips are staged outside the workspace, and the workspace is the tree collected as
/// the run's result.
pub const TCAB_AUDIO_STORE_DIR: &str = "/opt/tcab-audio";

/// The in-repository directory a `packages`-declaring case's runtime libraries are
/// vendored into at seed time (relative to the run root). The case's workspace
/// `package.json` depends on each via an in-repo relative `file:` path pointing
/// here (see `tcab_package_file_dep`), so the dependency resolves identically
/// wherever the tree lives — the run container, the validation host, and any clone
/// of the published repository — with no absolute path to break when it moves.
pub const TCAB_VENDOR_DIR: &str = ".vendor/packages";

/// The in-repository directory the selected [engine](crate::engine)'s runtime is
/// vendored into at seed time (relative to the run root), when the run selects an
/// engine that provides one. Like [`TCAB_VENDOR_DIR`], the seeded workspace
/// depends on it through an in-repo relative `file:` path, so the tree resolves
/// the same wherever it ends up.
///
/// It is deliberately **separate** from [`TCAB_VENDOR_DIR`] because the two
/// arrive by opposite routes. A case *declares* its packages, and its own
/// workspace `package.json` — authored in this repository and frozen with the
/// version — already names each one; the seeder only fills the vendored copies
/// in. An engine is a **run dimension the case never names**: it is chosen per
/// run, so nothing in the case's tree can mention it and the seeder is what
/// writes the dependency into `package.json`. Keeping the two trees apart keeps
/// that distinction legible in the produced repository (and in its diff): what is
/// under `.vendor/packages` is the case's, what is under `.vendor/engine` is the
/// run's.
pub const TCAB_ENGINE_DIR: &str = ".vendor/engine";

/// One of the Test Cabinet's own `@clockwyrks/*` runtime libraries a case may
/// ship into a run via the manifest's `packages` key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShippablePackage {
    /// The npm package name a case declares in `packages` (for example
    /// `@clockwyrks/particle-runtime`).
    pub name: &'static str,
    /// A short, human-readable description of what the package does, surfaced in
    /// the Inputs UI beside the case's declared packages. This is **UI-only**: it
    /// is never seeded into a run, so it can name what a build uses the library
    /// for. The single source of truth for the description of every shippable
    /// package.
    pub description: &'static str,
}

/// The Test Cabinet's own `@clockwyrks/*` runtime libraries an end-to-end case
/// may request via the manifest's `packages` key. Each is baked into the host
/// package store ([`TCAB_PACKAGES_DIR`]) and, at seed time, vendored into the run
/// repository under [`TCAB_VENDOR_DIR`], which the case's workspace `package.json`
/// declares as an in-repo relative `file:` dependency, so a built game can
/// `import` it to play a produced asset (a particle `system.json`, a voxel rig)
/// the same way the in-repo viewers do.
///
/// This list is the allowlist a case's `packages` names are validated against
/// (see [`is_shippable_package`]), and it also carries each package's UI-only
/// description (see [`shippable_package_description`]). Every name here **must
/// also appear** in the shippable list in `scripts/stage-tcab-packages.mjs`, which
/// is what bakes a package into the image: a name here but not there resolves to a
/// missing dependency at run time. (The descriptions are UI metadata and live only
/// here.)
///
/// The staging list is the **wider** of the two, and deliberately so: it also
/// stages every [engine](crate::engine) runtime into the same host store, and an
/// engine may **not** be requested through `packages`. An engine is a run
/// dimension the case never names — it is vendored under [`TCAB_ENGINE_DIR`] and
/// written into the seeded `package.json` by the seeder — so a name staged for an
/// engine must stay out of this list, or a case could pin a runtime that the run's
/// own engine selection is supposed to choose.
pub const SHIPPABLE_PACKAGES: &[ShippablePackage] = &[
    ShippablePackage {
        name: "@clockwyrks/particle-runtime",
        description: "The particle runtime the review UI plays produced effects with. A build \
                      imports its `/canvas` binding to load a seeded particle `system.json` and \
                      simulate it live on a canvas, so a produced burst plays the same way the \
                      gallery plays it.",
    },
    ShippablePackage {
        name: "@clockwyrks/voxel-runtime",
        description: "The voxel runtime the review UI poses and renders a produced voxel rig \
                      with. A build imports it to load a produced rig and play its authored \
                      animations in-game the same way the gallery's viewer does.",
    },
];

/// Whether `name` is one of the [`SHIPPABLE_PACKAGES`] a case may declare.
pub fn is_shippable_package(name: &str) -> bool {
    SHIPPABLE_PACKAGES.iter().any(|pkg| pkg.name == name)
}

/// The UI-only description of a shippable package, or `None` if `name` is not a
/// shippable package. Used to surface a declared package's purpose in the Inputs
/// UI without seeding the text into the run.
pub fn shippable_package_description(name: &str) -> Option<&'static str> {
    SHIPPABLE_PACKAGES
        .iter()
        .find(|pkg| pkg.name == name)
        .map(|pkg| pkg.description)
}

/// The names of every [`SHIPPABLE_PACKAGES`] entry, joined for an error message
/// that lists the valid `packages` values.
pub fn shippable_package_names() -> String {
    SHIPPABLE_PACKAGES
        .iter()
        .map(|pkg| pkg.name)
        .collect::<Vec<_>>()
        .join(", ")
}

/// The `package.json` dependency spec that resolves a shippable package to its
/// vendored copy — an in-repo relative `file:` path under [`TCAB_VENDOR_DIR`]. A
/// package-declaring case's workspace `package.json` must depend on the package
/// via exactly this spec; resolution validates the shipped file against it, and
/// the seeder vendors the package to the matching path so `npm install`/`npm ci`
/// resolve it wherever the produced tree ends up.
pub fn tcab_package_file_dep(name: &str) -> String {
    format!("file:./{TCAB_VENDOR_DIR}/{name}")
}

/// The run-workspace-relative path the orchestrator seeds an asset-generation
/// run's canvas configuration to. The drawing binary reads it from here by
/// default, so a model's drawing operations need no canvas flags.
pub const ASSET_CONFIG_DEST: &str = "draw.config.json";

/// The run-workspace-relative path the orchestrator seeds an asset-generation
/// run's layer document to.
///
/// Unlike the action log(s) this is **not** per-frame: a layer is sheet-wide,
/// painted once and placed on every frame by its own keyframes, which is what lets
/// one shape move across a sprite sheet without being redrawn. It is seeded empty,
/// so a run that never registers a layer behaves exactly as it did before layers
/// existed.
pub const ASSET_LAYERS_DEST: &str = "layers.json";

/// The run-workspace-relative path the orchestrator seeds a static voxel
/// (`asset_kind = "voxel-model"`) run's volume configuration to. The `voxel`
/// binary reads it from here by default.
pub const VOXEL_CONFIG_DEST: &str = "voxel.config.json";

/// The run-workspace-relative path the orchestrator seeds an animated voxel
/// (`asset_kind = "voxel-animation"`) run's rig/volume configuration to. The
/// `voxel-anim` binary reads it from here by default.
pub const VOXEL_ANIM_CONFIG_DEST: &str = "voxel-anim.config.json";

/// The run-workspace-relative config path each of the six surface-meshing binaries
/// (`mc`/`mc-anim`, `sn`/`sn-anim`, `dc`/`dc-anim`) reads by default — one per
/// binary so a run seeds exactly the config its tool consumes.
pub const MC_CONFIG_DEST: &str = "mc.config.json";
/// The config path the `mc-anim` binary reads (marching cubes, animated).
pub const MC_ANIM_CONFIG_DEST: &str = "mc-anim.config.json";
/// The config path the `sn` binary reads (surface nets, static).
pub const SN_CONFIG_DEST: &str = "sn.config.json";
/// The config path the `sn-anim` binary reads (surface nets, animated).
pub const SN_ANIM_CONFIG_DEST: &str = "sn-anim.config.json";
/// The config path the `dc` binary reads (dual contouring, static).
pub const DC_CONFIG_DEST: &str = "dc.config.json";
/// The config path the `dc-anim` binary reads (dual contouring, animated).
pub const DC_ANIM_CONFIG_DEST: &str = "dc-anim.config.json";

/// The config path the `paint` binary reads for a `ui` asset-generation case.
pub const PAINT_CONFIG_DEST: &str = "paint.config.json";
/// The config path the `texture`/`pbr` binaries read for a `material` case.
pub const MATERIAL_CONFIG_DEST: &str = "material.config.json";
/// The config path the `mc-skin` binary reads (`mc-skinned`).
pub const MC_SKIN_CONFIG_DEST: &str = "mc-skin.config.json";
/// The config path the `sn-skin` binary reads (`sn-skinned`).
pub const SN_SKIN_CONFIG_DEST: &str = "sn-skin.config.json";
/// The config path the `dc-skin` binary reads (`dc-skinned`).
pub const DC_SKIN_CONFIG_DEST: &str = "dc-skin.config.json";
/// The config path the `particle-2d` binary reads.
pub const PARTICLE_2D_CONFIG_DEST: &str = "particle-2d.config.json";
/// The config path the `particle-3d` binary reads.
pub const PARTICLE_3D_CONFIG_DEST: &str = "particle-3d.config.json";
/// The config path the `sfx-synth` binary reads.
pub const SFX_SYNTH_CONFIG_DEST: &str = "sfx-synth.config.json";
/// The config path the `sfx-sample` binary reads.
pub const SFX_SAMPLE_CONFIG_DEST: &str = "sfx-sample.config.json";
/// The config path the `music` binary reads.
pub const MUSIC_CONFIG_DEST: &str = "music.config.json";

/// The run-workspace-relative path the orchestrator seeds a `blender-character` case's
/// tool configuration to (bounds, output paths, and the required animation names the
/// `build.py` reads). Read by the `tcab-blend` runner.
pub const BLENDER_CONFIG_DEST: &str = "blender.config.json";

/// The run-workspace-relative path a `blender-character` run emits its skinned, animated
/// glTF to. The `tcab-blend` runner writes it (the authoritative, judged output); the
/// validator decodes it. Not manifest-declared — core provides the path.
pub const BLENDER_MESH_DEST: &str = "character.glb";

/// The run-workspace-relative path a `blender-prop` / `blender-mechanism` run emits its
/// native glTF to. Unlike a character (`character.glb`), a prop or mechanism is a generic
/// game asset, so it is named `model.glb`. The `tcab-blend` runner writes it (the
/// authoritative, judged output); the validator decodes it. Not manifest-declared — core
/// provides the path (see [`AssetKind::blender_mesh_dest`]).
pub const BLENDER_MODEL_MESH_DEST: &str = "model.glb";

/// The run-workspace-relative path core claims for a `ui` case's emitted `ui.json`
/// (element sizes, nine-slice insets, atlas rectangles). Auto-emitted by the binary,
/// not manifest-declared.
pub const UI_JSON_DEST: &str = "ui.json";
/// The run-workspace-relative path core claims for a `material` case's emitted
/// `material.json` (per-map paths, color spaces, tiling scale). Auto-emitted.
pub const MATERIAL_JSON_DEST: &str = "material.json";
/// The run-workspace-relative path core claims for a particle case's emitted
/// `system.json` (the authored emitter/force/curve definition). Auto-emitted.
pub const PARTICLE_SYSTEM_DEST: &str = "system.json";
/// The run-workspace-relative path core claims for an audio case's rendered PCM
/// clip. Auto-emitted by the binary.
pub const AUDIO_CLIP_WAV_DEST: &str = "clip.wav";
/// The run-workspace-relative path core claims for a `music` case's portable score,
/// emitted alongside [`AUDIO_CLIP_WAV_DEST`]. Auto-emitted.
pub const AUDIO_CLIP_MID_DEST: &str = "clip.mid";

/// The run-workspace-relative path a **static** surface-meshed run emits its single
/// `PartMesh`-shaped geometry file to (the `mc`/`sn`/`dc` binaries), a per-part
/// binary-glTF (`.glb`). The seeded config threads this path to the binary and the
/// validator parses the emitted file from it.
pub const MESH_DEST: &str = "mesh.glb";
/// The run-workspace-relative `{part}` template an **animated** surface-meshed run
/// emits one `PartMesh`-shaped geometry file per declared part to (the `mc-anim`/
/// `sn-anim`/`dc-anim` binaries), a per-part binary-glTF (`.glb`) — the mesh analog
/// of the per-part preview/action-log templates.
pub const MESH_PART_DEST: &str = "meshes/{part}.glb";

/// The run-workspace-relative path a voxel-animation run's rig structure
/// (`rig.json`) is seeded to and produced at. Seeding pre-populates it from the
/// manifest's required [`ModelSpec`]; the `voxel-anim` binary rewrites it as the
/// model adds parts/joints, and the validator reads it back.
pub const VOXEL_RIG_DEST: &str = "rig.json";

/// The placeholder a sprite-sheet case's preview and action-log paths must carry,
/// replaced by the frame index to give every frame its own separate file (for
/// example `frames/{frame}.png` → `frames/3.png`). Shared by manifest validation,
/// seeding, and the validator so they resolve the same per-frame paths.
pub const FRAME_TOKEN: &str = "{frame}";

/// Substitute the [`FRAME_TOKEN`] in a sprite-sheet path template with a frame
/// index, yielding that frame's concrete run-relative path.
pub fn frame_path(template: &Path, index: u32) -> PathBuf {
    PathBuf::from(
        template
            .to_string_lossy()
            .replace(FRAME_TOKEN, &index.to_string()),
    )
}

/// The placeholder a voxel-animation case's preview and action-log paths must
/// carry, replaced by the part name to give every part its own separate file (for
/// example `parts/{part}.png` → `parts/turret.png`). The 3D analog of
/// [`FRAME_TOKEN`]; shared by manifest validation, seeding, and the validator so
/// they resolve the same per-part paths.
pub const PART_TOKEN: &str = "{part}";

/// Substitute the [`PART_TOKEN`] in a voxel-animation path template with a part
/// name, yielding that part's concrete run-relative path.
pub fn part_path(template: &Path, part: &str) -> PathBuf {
    PathBuf::from(template.to_string_lossy().replace(PART_TOKEN, part))
}

/// The placeholder a `ui` kit case's preview path carries, replaced by the element
/// name to give every element its own separate preview/PNG (for example
/// `elements/{element}.png` → `elements/panel.png`). The interface analog of
/// [`FRAME_TOKEN`]; shared by manifest validation, seeding, and the validator.
pub const ELEMENT_TOKEN: &str = "{element}";

/// Substitute the [`ELEMENT_TOKEN`] in a `ui` path template with an element name.
pub fn element_path(template: &Path, element: &str) -> PathBuf {
    PathBuf::from(template.to_string_lossy().replace(ELEMENT_TOKEN, element))
}

/// The placeholder a `material` case's preview path carries, replaced by the map
/// channel to give every map its own separate preview/PNG (for example
/// `maps/{map}.png` → `maps/base-color.png`). Shared by manifest validation,
/// seeding, and the validator.
pub const MAP_TOKEN: &str = "{map}";

/// Substitute the [`MAP_TOKEN`] in a `material` path template with a map channel.
pub fn map_path(template: &Path, map: &str) -> PathBuf {
    PathBuf::from(template.to_string_lossy().replace(MAP_TOKEN, map))
}

/// A test case: a single game a model is asked to build, identified by a stable
/// slug and offering one or more independently versioned revisions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestCase {
    /// The stable slug naming this test case (the `<slug>` directory).
    pub slug: String,
    /// The versions available for this test case.
    pub versions: Vec<String>,
}

/// The type of a test case: which class of capability it measures and which
/// manifest tables it declares.
///
/// Today five types exist in code: the original [`Self::EndToEnd`] (build a
/// working program), [`Self::FullStack`] (build a working program *and* produce
/// its own assets with the asset-generation binaries, which are on `PATH` in the
/// full-stack run image), [`Self::AssetGeneration`] (drive a drawing tool toward a
/// target image), [`Self::Adversarial`] (write a wasm controller pitted
/// head-to-head against a baseline), and [`Self::Performance`] (write a wasm
/// engine scored on correctness plus the fuel it burns). The type is the explicit
/// discriminator everything branches on
/// — resolution, validation, the run record, and the UI — rather than being
/// inferred from which tables a manifest happens to declare. It defaults to
/// [`Self::EndToEnd`] so manifests that predate the discriminator keep resolving.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum TestType {
    /// Build a working program judged by running it (the only type until now).
    #[default]
    EndToEnd,
    /// Build a working program that must also **produce its own assets** during the
    /// run, using the asset-generation binaries (`draw`, `draw-sheet`, `particle-2d`,
    /// `sfx-synth`, `sfx-sample`, `music`, …) baked onto `PATH` in the full-stack run
    /// image. Behaves like [`Self::EndToEnd`] in every other respect — it releases a
    /// source repo, has a `[build]` table, may declare `packages`, and is judged by
    /// running the built program — but selects the full-stack image instead of the
    /// bare base image. See `docs/testing/full-stack/`.
    FullStack,
    /// Build an **entire game of any genre from a theme alone** — no spec, no
    /// reference mockups — that must be *playable* and *enjoyable*. Like
    /// [`Self::FullStack`] the model also **produces its own assets** during the
    /// run (it selects the same full-stack run image), releases a source repo, has
    /// a `[build]` table, and may declare `packages`; unlike it, a game jam seeds
    /// no `[[spec]]`/`[[reference]]` and is reviewed on a **graded** scale over
    /// general categories (see [`crate::review::VerdictStatus::GRADES`]) rather
    /// than pass/fail against a spec. See `docs/testing/game-jam/`.
    GameJam,
    /// Produce a graphical asset by driving a drawing tool one operation at a
    /// time; the recorded operations are the authoritative output.
    AssetGeneration,
    /// Write a controller compiled to wasm that drives one side of a head-to-head
    /// game; the controller is run repeatedly against a baseline opponent and the
    /// match outcome is the authoritative result. See
    /// `docs/testing/adversarial/`.
    Adversarial,
    /// Write an engine compiled to wasm that simulates a deterministic world; the
    /// engine's output is checked for correctness against a reference oracle and,
    /// when correct, scored by the fuel it consumes. The contract entry is invoked
    /// **once per input case** (not per tick), so the whole simulation runs in one
    /// call. See `docs/testing/performance/`.
    Performance,
}

impl TestType {
    /// The kebab-case wire identifier for this test type, matching the
    /// `serde(rename_all = "kebab-case")` representation used everywhere else.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::EndToEnd => "end-to-end",
            Self::FullStack => "full-stack",
            Self::GameJam => "game-jam",
            Self::AssetGeneration => "asset-generation",
            Self::Adversarial => "adversarial",
            Self::Performance => "performance",
        }
    }

    /// Whether a run of this type releases its implementation as a per-run public
    /// GitHub source repository when published.
    ///
    /// Every type whose model writes code does — end-to-end, adversarial, and
    /// performance. The sole exception is [`Self::AssetGeneration`]: its
    /// authoritative output is the recorded drawing operations (uploaded to the
    /// backend), not a source tree, so there is no code to release and **no GitHub
    /// repo is created** for it. Expressed as "everything but asset-generation" so a
    /// new code-writing type opts in automatically.
    pub fn releases_source_repo(self) -> bool {
        !matches!(self, Self::AssetGeneration)
    }
}

impl std::fmt::Display for TestType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Within a full-stack case, which dimension of asset tooling the run image carries.
///
/// A full-stack run builds a program *and* produces the assets it ships with, so the
/// image it executes in has to have the authoring binaries baked in — and there are two
/// such images, because the 3D tooling is a great deal heavier than the 2D tooling and
/// most cases never touch it. `2d` selects `test-cabinet-full-stack-2d` (the six 2D
/// binaries: `draw`, `draw-sheet`, `particle-2d`, `sfx-synth`, `sfx-sample`, `music`);
/// `3d` selects `test-cabinet-full-stack-3d`, the same set plus `voxel`, `voxel-anim`
/// and `particle-3d`. See [`crate::resolve_run_image`].
///
/// Like [`AssetKind`] this is a property of the **whole version**, not a per-variant
/// choice: every variant of a case runs in one image. It is declared by the
/// `asset_dimension` field and defaults to [`Self::TwoD`], so every manifest written
/// before the key existed — and every full-stack case that only draws sprites and plays
/// sound — resolves unchanged. It is meaningful only for a full-stack case; an explicit
/// value on any other type is rejected rather than silently ignored, because on those
/// types nothing consults it.
// The text is emitted into the contract; the link names core's item.
#[allow(rustdoc::broken_intra_doc_links)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum AssetDimension {
    /// The 2D full-stack image: sprites, sprite sheets, 2D particle effects, and audio.
    /// The default, and what every full-stack case that predates the key resolves to.
    #[default]
    #[serde(rename = "2d")]
    TwoD,
    /// The 3D full-stack image: everything the 2D image carries, plus the voxel-model
    /// (`voxel`, `voxel-anim`) and 3D-particle (`particle-3d`) tooling. The meshed/SDF
    /// families and the Blender toolchain are deliberately not in it — they are a far
    /// heavier toolchain and no case needs them yet.
    #[serde(rename = "3d")]
    ThreeD,
}

/// Within an asset-generation case, the shape of the asset the model draws.
///
/// A case is one of: a single 2D sprite, a 2D sprite sheet, a single static 3D
/// voxel model, or a rigged/animatable 3D voxel model — never a mix, and not a
/// per-variant choice: it is a property of the whole version, chosen by the
/// `asset_kind` field. A [`Self::SpriteSheet`] case additionally declares a
/// `[sheet]` table (the frame grid and the named animation sequences); the two
/// voxel kinds declare a `[voxel]` table (the bounding volume), and
/// [`Self::VoxelAnimation`] additionally declares a `[model]` table (the parts,
/// joints, and clips of the rig). Defaults to [`Self::Sprite`] so a manifest that
/// predates the discriminator — and every non-asset-generation case — resolves
/// unchanged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum AssetKind {
    /// One sprite drawn onto the whole canvas (the original asset-generation shape).
    #[default]
    Sprite,
    /// A grid of animation frames drawn onto the canvas, sliced into the named
    /// sequences the `[sheet]` table declares.
    SpriteSheet,
    /// A single static 3D voxel model, drawn one voxel operation at a time with the
    /// `voxel` binary. Declares a `[voxel]` table (the bounding volume). Rendered as
    /// an auto-rotating 3D model.
    VoxelModel,
    /// A rigged, animatable 3D voxel model: named parts in a parent/child hierarchy
    /// with named joints a consuming game drives at runtime (for example a tank's
    /// `turret_yaw`), drawn with the `voxel-anim` binary. Declares a `[voxel]` table
    /// and a `[model]` table (the required parts and joints the model must produce,
    /// on top of which it may add its own).
    VoxelAnimation,
    /// A static surface-meshed 3D model built with the **marching cubes** `mc`
    /// binary: the model composites a signed-distance field of CSG primitives, which
    /// the mesher extracts to a per-model `.glb`. Declares a `[voxel]` table
    /// (the field bounds) and no `[model]`. Marching cubes yields a chunky, faceted
    /// **low-poly** surface.
    McModel,
    /// A rigged, animatable surface-meshed 3D model built with the **marching cubes**
    /// `mc-anim` binary. Like [`Self::VoxelAnimation`] but each part is a meshed
    /// field extracted to its own `.glb`; declares a `[voxel]` and a `[model]`
    /// table.
    McAnimation,
    /// A static surface-meshed 3D model built with the **surface nets** `sn` binary.
    /// Declares a `[voxel]` table and no `[model]`. Surface nets yields a smooth,
    /// watertight mid-fidelity surface with uniform triangle density.
    SnModel,
    /// A rigged, animatable surface-meshed 3D model built with the **surface nets**
    /// `sn-anim` binary. Like [`Self::VoxelAnimation`] but each part is a meshed
    /// field; declares a `[voxel]` and a `[model]` table.
    SnAnimation,
    /// A static surface-meshed 3D model built with the **dual contouring** `dc`
    /// binary. Declares a `[voxel]` table and no `[model]`. Dual contouring yields a
    /// high-fidelity surface that preserves sharp edges and corners.
    DcModel,
    /// A rigged, animatable surface-meshed 3D model built with the **dual contouring**
    /// `dc-anim` binary. Like [`Self::VoxelAnimation`] but each part is a meshed
    /// field; declares a `[voxel]` and a `[model]` table.
    DcAnimation,
    /// A high-resolution 2D interface asset (or kit of elements) painted with the
    /// `paint`/`ui` binaries. Declares a `[canvas]` (base element size) and an
    /// optional `[ui]` table (the kit's elements). Judged on the emitted flattened
    /// PNG(s) plus `ui.json`.
    Ui,
    /// A tileable PBR material — a set of maps (base color, normal, roughness, …) —
    /// painted with the `texture`/`pbr` binaries. Declares a `[material]` table (no
    /// `[canvas]`/`[voxel]`). Judged on the emitted maps plus `material.json`.
    Material,
    /// A skinned character (marching cubes): one whole-body field bound to a
    /// model-invented skeleton, deformed by linear-blend skinning. Declares a
    /// `[voxel]` and a `[model]` table but emits a **single** `mesh.glb` + `rig.json`
    /// (not per-part).
    McSkinned,
    /// A skinned character (surface nets). See [`Self::McSkinned`].
    SnSkinned,
    /// A skinned character (dual contouring). See [`Self::McSkinned`].
    DcSkinned,
    /// A 2D particle effect authored with the `particle-2d` binary. Declares a
    /// `[particle]` table (a planar field). Judged on the emitted `system.json`.
    #[serde(rename = "particle-2d")]
    Particle2d,
    /// A 3D particle effect authored with the `particle-3d` binary. Declares a
    /// `[particle]` table (a volume). Judged on the emitted `system.json`.
    #[serde(rename = "particle-3d")]
    Particle3d,
    /// A procedurally-synthesized sound effect authored with the `sfx-synth` binary.
    /// Declares an `[audio]` table. Judged on the emitted `clip.wav`.
    SfxSynth,
    /// A sample-library sound effect authored with the `sfx-sample` binary. Declares
    /// an `[audio]` table (naming its one pack in `audio.packs`). Judged on the
    /// emitted `clip.wav`.
    SfxSample,
    /// A short piece of music authored with the `music` sequencer binary. Declares an
    /// `[audio]` table (naming its one pack in `audio.packs`). Judged on the emitted
    /// `clip.wav` (and portable `clip.mid`).
    Music,
    /// A rigged, animated **skinned character** authored by driving **headless Blender**
    /// through its Python API — the first Blender-based asset kind. The model writes a
    /// `build.py` (a `bpy` script) that builds the character mesh, an armature, skin
    /// weights, and one Action per required animation, then runs the `tcab-blend` runner
    /// to export a single **`character.glb`** (a standard skinned + animated glTF 2.0)
    /// plus a `model.png` preview. Unlike the CSG skinned kinds (`mc-skinned` …), there
    /// is **no operation log**: `build.py` is the recorded authoring trace, re-run for
    /// provenance. Declares a `[voxel]` table (reused as the character's bounding box)
    /// and a `[model]` table (the required animations); judged on the emitted glTF, never
    /// an op-log replay.
    #[serde(rename = "blender-character")]
    BlenderCharacter,
    /// A static **hard-surface prop** authored by driving headless Blender through a
    /// `build.py` script — a weapon, crate, pickup, or emplacement. Like every Blender
    /// kind it writes a `build.py` and runs `tcab-blend`, but it emits a **static**,
    /// unrigged native glTF (`model.glb`): no armature, no skin, and **no animations**,
    /// so it declares **no `[model]` table**. Reuses the `[voxel]` table as a bounding
    /// box. Judged on the emitted glTF (a well-formed static mesh); `build.py` is the
    /// recorded trace, re-run for provenance.
    #[serde(rename = "blender-prop")]
    BlenderProp,
    /// A **rigidly-articulated mechanism** authored by driving headless Blender through a
    /// `build.py` script — a turret, blast door, crane, or mech. It emits a native glTF
    /// (`model.glb`) whose motion is baked as standard **glTF node-hierarchy animations**
    /// (each part posed about its pivot by parenting, **not** skin deformation and **not**
    /// a Test-Cabinet `rig.json`), so a game plays the clips natively. Declares a
    /// `[voxel]` bounding box and a `[model]` table of required animations, reconciled
    /// against the emitted glTF; `build.py` is re-run for provenance.
    #[serde(rename = "blender-mechanism")]
    BlenderMechanism,
}

impl AssetKind {
    /// Whether this kind is one of the 3D voxel-family kinds (as opposed to a 2D
    /// sprite/paint kind): the two cube kinds, the six surface-meshed kinds, and the
    /// three **skinned** kinds. Every voxel-family kind declares a `[voxel]` bounding
    /// volume instead of `[canvas]`, is seeded through `test_cabinet_core::seeding`'s voxel
    /// path, and is validated by the voxel validator. Skinned kinds are voxel-family
    /// too — one whole-body field — but are **single-file** (see [`Self::is_per_part`]).
    pub fn is_voxel(self) -> bool {
        matches!(
            self,
            Self::VoxelModel
                | Self::VoxelAnimation
                | Self::McModel
                | Self::McAnimation
                | Self::SnModel
                | Self::SnAnimation
                | Self::DcModel
                | Self::DcAnimation
                | Self::McSkinned
                | Self::SnSkinned
                | Self::DcSkinned
        )
    }

    /// Whether this kind is **rigged/animated** — declares and requires a `[model]`
    /// rig and emits a `rig.json`: `voxel-animation`, the three `*-animation` meshed
    /// kinds, and the three **skinned** kinds. Note that skinned kinds are animated
    /// but **not** per-part (see [`Self::is_per_part`]).
    pub fn is_animated(self) -> bool {
        matches!(
            self,
            Self::VoxelAnimation
                | Self::McAnimation
                | Self::SnAnimation
                | Self::DcAnimation
                | Self::McSkinned
                | Self::SnSkinned
                | Self::DcSkinned
        )
    }

    /// Whether this kind authors **one field/mesh per part** — the discriminator the
    /// resolver, seeder, and validator branch on for the per-part (`{part}`)
    /// treatment. True for the four rigid animated kinds (`voxel-animation` and the
    /// three `*-animation` meshed kinds); **false** for the skinned kinds, which are
    /// animated but build a single whole-body field emitted as one file (the
    /// "skinned exception" to the `{part}` rule).
    pub fn is_per_part(self) -> bool {
        self.is_animated() && !self.is_skinned()
    }

    /// Whether this kind is one of the three **skinned** character kinds
    /// (`mc-skinned`/`sn-skinned`/`dc-skinned`): a single continuous mesh bound to a
    /// model-invented skeleton and deformed by linear-blend skinning. Voxel-family
    /// and animated, but single-file.
    pub fn is_skinned(self) -> bool {
        matches!(self, Self::McSkinned | Self::SnSkinned | Self::DcSkinned)
    }

    /// Whether this kind is a **Blender** kind — the family authored by driving headless
    /// Blender through a `build.py` script (run by `tcab-blend`) rather than a constrained
    /// op-log tool, emitting a **native glTF** the validator decodes: the skinned
    /// `blender-character`, the static `blender-prop`, and the rigidly-articulated
    /// `blender-mechanism`. It is its own category — **not** voxel/skinned/meshed/paint/
    /// particle/audio — reusing the `[voxel]` table as a bounding box (and, for the
    /// animated members, the `[model]` table for required animations). Selects the
    /// Blender resolve/seed/validate path and the shared `test-cabinet-blender` image. The
    /// per-member differences (skin, animations, output filename) are drawn by
    /// [`Self::blender_is_skinned`], [`Self::blender_is_animated`], and
    /// [`Self::blender_mesh_dest`].
    pub fn is_blender(self) -> bool {
        matches!(
            self,
            Self::BlenderCharacter | Self::BlenderProp | Self::BlenderMechanism
        )
    }

    /// Whether this Blender kind emits a **skinned** character — one continuous mesh
    /// bound to a skeleton and deformed by linear-blend skinning (`blender-character`).
    /// The prop and mechanism kinds emit a static / rigidly-parented glTF with **no
    /// skin**, so the validator does not require one and the 3D viewer does not skin.
    /// `false` for every non-Blender kind.
    pub fn blender_is_skinned(self) -> bool {
        matches!(self, Self::BlenderCharacter)
    }

    /// Whether this Blender kind is **animated** — it declares a `[model]` table of
    /// required animations and its emitted glTF is reconciled against them. True for the
    /// `blender-character` (skinned clips) and the `blender-mechanism` (rigid glTF
    /// node-hierarchy clips); **false** for the static `blender-prop`, which declares no
    /// `[model]` and emits no animations. `false` for every non-Blender kind.
    pub fn blender_is_animated(self) -> bool {
        matches!(self, Self::BlenderCharacter | Self::BlenderMechanism)
    }

    /// The run-workspace-relative path a **Blender** run emits its native glTF to. The
    /// `blender-character` emits `character.glb`; the `blender-prop` and
    /// `blender-mechanism` emit a generically-named [`BLENDER_MODEL_MESH_DEST`]
    /// (`model.glb`) — a native, game-ready glTF that isn't a character. `None` for a
    /// non-Blender kind. Shared by the seeded tool config (so the runner writes here),
    /// manifest path-claiming, and the validator (so it reads the same path).
    pub fn blender_mesh_dest(self) -> Option<&'static str> {
        match self {
            Self::BlenderCharacter => Some(BLENDER_MESH_DEST),
            Self::BlenderProp | Self::BlenderMechanism => Some(BLENDER_MODEL_MESH_DEST),
            _ => None,
        }
    }

    /// Whether this kind is one of the surface-**meshed** kinds that composite a
    /// signed-distance field and emit a `PartMesh`-shaped `.glb`: the six `mc`/`sn`/
    /// `dc` (+ `-anim`) kinds and the three **skinned** kinds. As opposed to the two
    /// cube kinds (a face-culled cube mesh) and the 2D kinds. Selects the
    /// mesh-parsing validation path and the per-binary mesh output threading.
    pub fn is_meshed(self) -> bool {
        matches!(
            self,
            Self::McModel
                | Self::McAnimation
                | Self::SnModel
                | Self::SnAnimation
                | Self::DcModel
                | Self::DcAnimation
                | Self::McSkinned
                | Self::SnSkinned
                | Self::DcSkinned
        )
    }

    /// Whether this kind is a high-resolution **2D painted** kind — `ui` or
    /// `material` — driven by the `paint`/`ui`/`texture`/`pbr` binaries and validated
    /// by decoding the emitted PNG(s) plus its `ui.json`/`material.json`.
    pub fn is_paint(self) -> bool {
        matches!(self, Self::Ui | Self::Material)
    }

    /// Whether this kind is a **particle** effect (`particle-2d`/`particle-3d`),
    /// declaring a `[particle]` field and validated by parsing its `system.json`.
    pub fn is_particle(self) -> bool {
        matches!(self, Self::Particle2d | Self::Particle3d)
    }

    /// Whether this kind is an **audio** clip (`sfx-synth`/`sfx-sample`/`music`),
    /// declaring an `[audio]` table and validated by decoding its emitted `.wav`.
    pub fn is_audio(self) -> bool {
        matches!(self, Self::SfxSynth | Self::SfxSample | Self::Music)
    }

    /// Whether this kind is `music`, the only audio kind that also emits a portable
    /// `.mid` score alongside its `.wav`.
    pub fn emits_midi(self) -> bool {
        matches!(self, Self::Music)
    }

    /// The run-workspace-relative path (or `{part}` template, for a per-part kind)
    /// a **meshed** kind emits its `.glb` geometry to — [`MESH_DEST`] for a
    /// static/skinned meshed kind, [`MESH_PART_DEST`] for a per-part animated one.
    /// `None` for the cube kinds and the 2D kinds, which emit no meshed `.glb`.
    /// Shared by the seeded tool config (so the binary writes here), manifest
    /// path-claiming, and the validator (so it reads the same path).
    pub fn mesh_dest(self) -> Option<&'static str> {
        if !self.is_meshed() {
            return None;
        }
        Some(if self.is_per_part() {
            MESH_PART_DEST
        } else {
            MESH_DEST
        })
    }

    /// The run-workspace-relative path (or `{part}` template, for a per-part kind)
    /// the client-facing `PartMesh` geometry (`.glb`) every **voxel-family** kind
    /// emits — [`MESH_DEST`] for a static/skinned kind, [`MESH_PART_DEST`] for a
    /// per-part animated one. `None` for the 2D kinds, which emit no geometry.
    ///
    /// Unlike [`Self::mesh_dest`] — which is `Some` only for the surface-meshed
    /// kinds and selects the mesh-parsing validation path — this is `Some` for the
    /// two **cube** kinds as well: their binaries also emit a face-culled `.glb`,
    /// and the 3D client renders from that mesh for every voxel-family kind.
    pub fn voxel_mesh_dest(self) -> Option<&'static str> {
        if !self.is_voxel() {
            return None;
        }
        Some(if self.is_per_part() {
            MESH_PART_DEST
        } else {
            MESH_DEST
        })
    }

    /// The run-workspace-relative path the orchestrator seeds this kind's tool
    /// configuration to. Shared by manifest path-claiming and seeding so they agree.
    pub fn config_dest(self) -> &'static str {
        match self {
            Self::Sprite | Self::SpriteSheet => ASSET_CONFIG_DEST,
            Self::VoxelModel => VOXEL_CONFIG_DEST,
            Self::VoxelAnimation => VOXEL_ANIM_CONFIG_DEST,
            Self::McModel => MC_CONFIG_DEST,
            Self::McAnimation => MC_ANIM_CONFIG_DEST,
            Self::SnModel => SN_CONFIG_DEST,
            Self::SnAnimation => SN_ANIM_CONFIG_DEST,
            Self::DcModel => DC_CONFIG_DEST,
            Self::DcAnimation => DC_ANIM_CONFIG_DEST,
            Self::Ui => PAINT_CONFIG_DEST,
            Self::Material => MATERIAL_CONFIG_DEST,
            Self::McSkinned => MC_SKIN_CONFIG_DEST,
            Self::SnSkinned => SN_SKIN_CONFIG_DEST,
            Self::DcSkinned => DC_SKIN_CONFIG_DEST,
            Self::Particle2d => PARTICLE_2D_CONFIG_DEST,
            Self::Particle3d => PARTICLE_3D_CONFIG_DEST,
            Self::SfxSynth => SFX_SYNTH_CONFIG_DEST,
            Self::SfxSample => SFX_SAMPLE_CONFIG_DEST,
            Self::Music => MUSIC_CONFIG_DEST,
            // The whole Blender family reads the same `blender.config.json`.
            Self::BlenderCharacter | Self::BlenderProp | Self::BlenderMechanism => {
                BLENDER_CONFIG_DEST
            }
        }
    }
}

/// The kind of a piece of media — used for both reference media and proof
/// artifacts so a UI knows whether to render an `<img>`, a `<video>`, or a
/// player that redraws a recording.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum MediaKind {
    /// A still image (`png`, `jpg`, `jpeg`, `webp`, `gif`).
    Image,
    /// A video clip (`webm`, `mp4`). A run captures its clip as the `.webm`
    /// Playwright records natively; the public snapshot transcodes it to `.mp4`
    /// for universal (incl. iOS/Safari) playback.
    Video,
    /// A draw-command recording (`json.gz`): the list of operations a build issued
    /// against its 2D context, frame by frame, which a player re-issues against a
    /// canvas of its own to reproduce the picture the build drew.
    ///
    /// It is evidence of a different quality from a clip. A clip is a re-shoot of
    /// the build at whatever rate the recorder managed; a recording *is* the build's
    /// own drawing, so it replays at any size, seeks to any frame without replaying
    /// the frames before it, and can be scrubbed in step beside the same recording
    /// taken from the reference implementation.
    ///
    /// It is stored gzipped, and the redundancy that makes that so effective is the
    /// same property that makes a frame independently drawable: each frame restates
    /// the drawing state it inherited and issues very nearly the operations its
    /// neighbours did. The document a player reads is the JSON inside; the
    /// compression is how it travels.
    ///
    /// Unlike the other two kinds it needs no transcode — the captured `.json.gz` is
    /// what the live console serves and what the public snapshot publishes.
    Replay,
}

impl MediaKind {
    /// Infer the media kind from a path's file name. Returns `None` for a name that
    /// is none of a supported image, video, or recording.
    ///
    /// A recording is stored gzipped, so it carries two extensions and
    /// [`Path::extension`] answers `gz` for it rather than `json.gz`. The compound
    /// suffix is therefore matched against the whole file name, before the single
    /// extension is consulted at all. A bare `.json` still resolves to a recording:
    /// compression is how a recording travels rather than part of what it is, so a
    /// name that states only the document format still names the same kind of media.
    pub fn from_path(path: &Path) -> Option<Self> {
        let name = path.file_name()?.to_str()?.to_ascii_lowercase();
        if name
            .strip_suffix(".json.gz")
            .is_some_and(|stem| !stem.is_empty())
        {
            return Some(Self::Replay);
        }
        let ext = path.extension()?.to_str()?.to_ascii_lowercase();
        match ext.as_str() {
            "png" | "jpg" | "jpeg" | "webp" | "gif" => Some(Self::Image),
            "webm" | "mp4" => Some(Self::Video),
            "json" => Some(Self::Replay),
            _ => None,
        }
    }
}

/// How a reference view's source is turned into the seeded/served artifact.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum ReferenceKind {
    /// An HTML mockup rendered to a PNG screenshot. The served media is always an
    /// image.
    Rendered,
    /// A static image file used as-is.
    Image,
    /// A static video file (`mp4`) used as-is.
    Video,
}

impl ReferenceKind {
    /// The kind of media this reference ultimately presents (a rendered mockup is
    /// always an image).
    pub fn media_kind(self) -> MediaKind {
        match self {
            Self::Rendered | Self::Image => MediaKind::Image,
            Self::Video => MediaKind::Video,
        }
    }

    /// Whether the reference is an HTML mockup that must be rendered (rather than
    /// a static file served as-is).
    pub fn is_rendered(self) -> bool {
        matches!(self, Self::Rendered)
    }
}

/// A proof-of-implementation artifact a test case asks the agent to produce.
///
/// Unlike specs and references, a proof is **not** seeded into a run: it is
/// output the agent writes during the run to its [`Self::dest`] path (a screenshot
/// or short `.mp4`) to evidence that a feature works. Validation records whether
/// each declared proof is present (see [`crate::validation::ProofResult`]), and a
/// reviewer pairs it with the expected reference when judging the run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofFile {
    /// Stable slug identifying this proof; recorded in validation and used to pair
    /// a review item with the submitted media.
    pub id: String,
    /// Human-readable display name, surfaced in the reviewer UI.
    pub name: String,
    /// The media kind, inferred from [`Self::dest`]'s extension.
    pub kind: MediaKind,
    /// The path, relative to the run's workspace root, the agent must write the
    /// proof to.
    pub dest: PathBuf,
}

/// What role a seeded spec file plays, so a reader can tell an instruction the
/// model reads from an executable starter it edits and runs.
///
/// This is a **presentation** distinction only — every kind is seeded identically
/// (copied to its `dest`) and the harness treats them the same. It exists so the
/// Inputs surfaces can tag a starter script (for example the Blender case's
/// `build.py`, whose `dest` deliberately coincides with `[output].actions`)
/// distinctly from a prose spec.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum SpecKind {
    /// A specification the model reads — prose (a brief) or any other guidance.
    /// The default when a `[[spec]]` entry declares no `kind`.
    #[default]
    Spec,
    /// An executable starter file the model edits in place and runs, seeded as the
    /// case's own trace (for example a `bpy` `build.py`). Surfaced as "Script".
    Script,
}

/// A spec file seeded into a run.
///
/// Each spec is copied from its [`Self::source_path`] on the host into the run's
/// fresh repository at [`Self::dest`] (a path relative to the workspace root). A
/// case's common specs are seeded for every variant; a variant may seed
/// additional specs, and may even map a different source onto the same `dest` so
/// the model always sees a stable path regardless of variant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecFile {
    /// Source path on the host, inside the version folder.
    pub source_path: PathBuf,
    /// Destination path relative to the run's workspace root, where the spec is
    /// seeded and where the rendered prompt points the model.
    pub dest: PathBuf,
    /// The role this seeded file plays, driving how the Inputs surfaces tag it
    /// (a prose "Spec" vs an executable "Script"). Presentation only.
    #[serde(default)]
    pub kind: SpecKind,
}

/// A single starter file copied into a run's workspace from a test case's
/// **workspace** directory.
///
/// A case (or a variant overriding it) may declare a workspace directory whose
/// contents seed the root of the run's repository before the specs are written,
/// giving the model a baseline project to build on — a `package.json`, configs,
/// and whatever else a run should start with. Each file is enumerated from that
/// directory at resolution: [`Self::source_path`] is the file on the host and
/// [`Self::dest`] is its path **relative to the workspace directory**, which is
/// where it lands in the run (so `workspaces/base/package.json` seeds to
/// `package.json` at the repository root). Workspace files are seeded verbatim;
/// unlike specs, they are never rendered as templates.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFile {
    /// Source path on the host, inside the version folder's workspace directory.
    pub source_path: PathBuf,
    /// Destination path relative to the run's workspace root, where the file is
    /// seeded.
    pub dest: PathBuf,
}

/// The starter workspace files a case seeds, **keyed by [engine](crate::engine)
/// slug**.
///
/// A starter project is written against a runtime: its `package.json` declares the
/// engine's dependency, and the case-owned modules it ships are written against
/// that engine's API. One directory therefore cannot stand for two engines, so a
/// case that supports more than one ships one project per engine and this is the
/// resolved form of that. Resolution guarantees the keys are exactly
/// [`TestCaseVersion::engines`], so a run of any supported engine finds an entry;
/// read one with [`TestCaseVersion::workspace_for`] rather than indexing.
///
/// An engineless case names one directory and supports no engine, so its files
/// land under [`NONE_SLUG`] and the map has exactly that one key — which is why
/// nothing downstream needs to know which spelling a case was authored with.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct EngineWorkspaces(BTreeMap<String, Vec<WorkspaceFile>>);

impl EngineWorkspaces {
    /// The files seeded for `engine`, or an empty slice when the case seeds none
    /// for it.
    pub fn get(&self, engine: &str) -> &[WorkspaceFile] {
        self.0.get(engine).map_or(&[], Vec::as_slice)
    }

    /// Whether no engine has any starter file — the case seeds no workspace at all.
    pub fn is_empty(&self) -> bool {
        self.0.values().all(Vec::is_empty)
    }

    /// Every file of every engine, in engine order. The set a fetch or a rewrite
    /// walks, where which engine a file belongs to does not matter.
    pub fn files(&self) -> impl Iterator<Item = &WorkspaceFile> {
        self.0.values().flatten()
    }

    /// Every file of every engine, mutably, in engine order.
    pub fn files_mut(&mut self) -> impl Iterator<Item = &mut WorkspaceFile> {
        self.0.values_mut().flatten()
    }

    /// The engine slugs this carries an entry for, in slug order.
    pub fn engines(&self) -> impl Iterator<Item = &str> {
        self.0.keys().map(String::as_str)
    }

    /// Record `files` as the project seeded for `engine`.
    pub fn insert(&mut self, engine: impl Into<String>, files: Vec<WorkspaceFile>) {
        self.0.insert(engine.into(), files);
    }
}

impl FromIterator<(String, Vec<WorkspaceFile>)> for EngineWorkspaces {
    fn from_iter<I: IntoIterator<Item = (String, Vec<WorkspaceFile>)>>(iter: I) -> Self {
        Self(iter.into_iter().collect())
    }
}

/// The commands the validator runs to build a produced implementation into a
/// served static site, resolved from the manifest's required `[build]` table.
///
/// Each command is run from the implementation's repository root. A case must
/// state both explicitly — there are no defaults. `npm ci` (which requires the
/// build to commit a lockfile) followed by `npm run build` is conventional; a
/// case may pin a different toolchain so long as it still emits a static build
/// the load check can serve.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildCommands {
    /// Command that installs dependencies before the build.
    pub install: String,
    /// Command that produces the build.
    pub build: String,
    /// The run-root-relative path of the produced wasm controller module. `Some`
    /// only for an adversarial case (an end-to-end build emits a static site and
    /// has no single module artifact); the validator loads this as the submission.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub module: Option<PathBuf>,
}

/// The resolved `[canvas]` of an asset-generation case: the fixed image the
/// model draws on. `background` is kept as the manifest string (validated to
/// parse) so the resolved version stays serializable without depending on the
/// drawing library's color type; the validator re-parses it when it regenerates.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasSpec {
    /// Canvas width in pixels.
    pub width: u32,
    /// Canvas height in pixels.
    pub height: u32,
    /// Initial canvas state: `transparent` or a hex color.
    pub background: String,
}

/// The resolved `[tool]` of an asset-generation case: the drawing binary and the
/// run-relative paths it reads and writes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolSpec {
    /// The drawing binary available in the run environment (`draw` or
    /// `draw-sheet`).
    pub binary: String,
    /// The run-workspace-relative path the binary re-renders the current image to.
    /// A `{frame}` template for a sprite sheet (one preview per frame).
    pub preview: PathBuf,
}

/// The resolved `[output]` of an asset-generation case: where the recorded
/// action log is collected.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputSpec {
    /// The run-workspace-relative path of the recorded action log.
    pub actions: PathBuf,
}

/// The resolved `[contract]` of an adversarial or performance case: the wasm
/// interface the model implements. The schema paths are the run-workspace-relative
/// destinations the contract schemas are seeded to (as common specs), so the model
/// reads them where the case declared them.
///
/// The two schema pairs are `Option` so one resolved struct serves both types:
/// adversarial sets `world`/`action` (per-tick), performance sets `input`/`output`
/// (per-case), and resolution guarantees exactly one pair is present.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractSpec {
    /// The exported function the host invokes (the manifest's `entry`) — once per
    /// tick for adversarial, once per input case for performance.
    pub entry: String,
    /// Adversarial only: the run-workspace-relative path of the seeded `world`
    /// observation schema. `None` for a performance case.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub world: Option<PathBuf>,
    /// Adversarial only: the run-workspace-relative path of the seeded `action`
    /// schema. `None` for a performance case.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<PathBuf>,
    /// Performance only: the run-workspace-relative path of the seeded `input`
    /// schema. `None` for an adversarial case.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<PathBuf>,
    /// Performance only: the run-workspace-relative path of the seeded `output`
    /// schema. `None` for an adversarial case.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<PathBuf>,
}

/// The resolved `[sandbox]` of an adversarial or performance case: the limits the
/// wasm host applies to every metered invocation.
///
/// The two fuel fields are `Option` so one resolved struct serves both types:
/// adversarial sets `fuel_per_tick` (a per-tick budget), performance sets
/// `fuel_limit` (a per-input-case budget whose consumed fuel is the recorded
/// result), and resolution guarantees exactly one is present.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxSpec {
    /// Adversarial only: the wasmtime fuel ceiling for a single tick. `None` for a
    /// performance case.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fuel_per_tick: Option<u64>,
    /// Performance only: the wasmtime fuel ceiling for a whole input case. `None`
    /// for an adversarial case.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fuel_limit: Option<u64>,
    /// The linear-memory cap in bytes.
    pub max_memory_bytes: u64,
}

/// A resolved held-out input case of a performance case: a problem instance and
/// the answer a correct engine must produce.
///
/// Both paths are host paths inside the version folder. Unlike specs/workspace
/// files they are **never** seeded into a run — they are the secret scored set the
/// validator reads directly from the case to check the engine against.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceCase {
    /// Host path to the input instance fed to the engine.
    pub input: PathBuf,
    /// Host path to the correct answer the engine's output is checked against.
    pub expected: PathBuf,
    /// The **run ceiling** for this case: the fuel the engine may burn before it
    /// traps, resolved as `round([sandbox].fuel_limit * fuel_runway)`. Equal to
    /// `fuel_limit` when the case declares no runway. The pass/fail line remains
    /// `[sandbox].fuel_limit`; the gap between the two is the runway that lets a
    /// too-slow-but-correct engine finish so the grader can record its overshoot.
    pub fuel_ceiling: u64,
    /// Which phase this case belongs to — a correctness pre-flight
    /// [smoke](crate::validation::PerformanceCaseKind::Smoke) test or a scored
    /// [stress](crate::validation::PerformanceCaseKind::Stress) case. Smoke cases run
    /// first and gate the stress cases; see the performance validator.
    pub kind: crate::validation::PerformanceCaseKind,
}

/// The resolved `[simulation]` of an adversarial case: the faked timestep and
/// the hard tick cap.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulationSpec {
    /// The fixed, faked delta handed to the game logic each tick (milliseconds).
    pub timestep_ms: u32,
    /// Hard cap on match length; reaching it ends the match (a draw if tied).
    pub max_ticks: u32,
}

/// The resolved `[match]` of an adversarial case: how the field is paired into
/// matches. Recorded faithfully though the validator only runs the single
/// canonical match (lead decision 4).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchSpec {
    /// Controllers per match.
    pub participants: u32,
    /// How the field is paired (for example `round-robin`).
    pub structure: String,
    /// Matches played per pairing.
    pub rounds: u32,
}

/// The resolved `[replay]` of an adversarial case: the browser renderer fed the
/// recorded replay data for playback on the site.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaySpec {
    /// The run-workspace-relative path the renderer is seeded to.
    pub renderer: PathBuf,
}

/// The resolved `[sheet]` of a sprite-sheet case: the frames the model draws —
/// each a separate file the size of one [`CanvasSpec`] — and the named sequences a
/// reviewer plays back. The frame dimensions are the canvas dimensions; the
/// declared frame indices and the sequences that reference them drive per-frame
/// scoring and animated playback.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "contract",
    derive(ts_rs::TS, schemars::JsonSchema),
    ts(rename = "AssetSheet"),
    schemars(rename = "AssetSheet")
)]
pub struct SheetSpec {
    /// Width of one frame in pixels (the canvas width).
    pub frame_width: u32,
    /// Height of one frame in pixels (the canvas height).
    pub frame_height: u32,
    /// The declared frame indices, in declared order. At least one is present and
    /// all are unique.
    pub frames: Vec<u32>,
    /// The named animation sequences, in declared order. At least one is present.
    pub sequences: Vec<SheetSequence>,
}

/// A resolved named animation sequence within a [`SheetSpec`]: an ordered list of
/// row-major frame indices played at [`Self::fps`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "contract",
    derive(ts_rs::TS, schemars::JsonSchema),
    ts(rename = "AssetSheetSequence"),
    schemars(rename = "AssetSheetSequence")
)]
pub struct SheetSequence {
    /// Stable slug naming this sequence (for example `walk-right`).
    pub slug: String,
    /// Human-readable display name, surfaced in the review UI.
    pub name: String,
    /// The ordered row-major frame indices this sequence plays. Non-empty, every
    /// index a valid cell.
    pub frames: Vec<u32>,
    /// Playback rate in frames per second. Always greater than zero.
    pub fps: f64,
}

// `SheetSequence` carries an `fps: f64`, so it cannot derive `Eq` (and neither can
// the structs that own it). The fps originates as an exact TOML literal validated
// to be finite and positive at resolution, and is only ever compared or rendered,
// never used as a hash key, so a manual `Eq` is sound — matching how `CheckAction`
// treats its float coordinates above.
impl Eq for SheetSequence {}

/// The resolved `[voxel]` of a voxel asset-generation case: the bounding volume
/// the model draws into, the 3D analog of [`CanvasSpec`]. `background` is the
/// clear color behind the rendered preview PNG (the voxel volume itself always
/// starts empty); it is kept as the manifest string — validated to parse — so the
/// resolved version stays serializable without depending on the voxel library's
/// color type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct VoxelSpec {
    /// Volume extent along x, in voxels.
    pub width: u32,
    /// Volume extent along y (up), in voxels.
    pub height: u32,
    /// Volume extent along z, in voxels.
    pub depth: u32,
    /// Preview clear color: `transparent` or a hex color.
    pub background: String,
}

/// The resolved fixed nine-slice insets of a UI element (or as read back from
/// `ui.json`): the stretchable border margins in pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct NineSlice {
    /// Left inset in pixels.
    pub left: u32,
    /// Right inset in pixels.
    pub right: u32,
    /// Top inset in pixels.
    pub top: u32,
    /// Bottom inset in pixels.
    pub bottom: u32,
}

/// The resolved `[ui]` of a `ui` asset-generation case: the kit of named elements
/// the model paints. Empty [`Self::elements`] means the case is a single implicit
/// element (the whole `[canvas]`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct UiSpec {
    /// The declared elements, in declared order. Empty for a single-image case.
    pub elements: Vec<UiElementSpec>,
}

/// A resolved `[[ui.element]]`: one named element of a UI kit, its size, and an
/// optional fixed nine-slice.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct UiElementSpec {
    /// Stable, unique element name (targeted with `--element <name>`).
    pub name: String,
    /// Element width in pixels.
    pub width: u32,
    /// Element height in pixels.
    pub height: u32,
    /// The fixed stretchable insets, when the case declares them (otherwise the
    /// model authors them with `ui set-nine-slice`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub nine_slice: Option<NineSlice>,
}

/// The resolved `[material]` of a `material` asset-generation case: the tileable PBR
/// material's output resolution, seamlessness, and emitted channels.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct MaterialSpec {
    /// Square map resolution in pixels (a power of two).
    pub size: u32,
    /// Whether the maps are authored seamlessly (wrap toroidally).
    pub tile: bool,
    /// The channels the material emits, in declared order. Always includes
    /// `base-color`.
    pub maps: Vec<String>,
    /// Preview clear color: `transparent` or a hex color.
    pub background: String,
}

/// The resolved `[particle]` of a particle asset-generation case: the field the
/// effect plays in and its playback timing. [`Self::depth`] is `Some` for
/// `particle-3d` (a volume) and `None` for `particle-2d` (a planar field).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ParticleSpec {
    /// Field extent along x.
    pub width: u32,
    /// Field extent along y (up).
    pub height: u32,
    /// Field extent along z. `Some` for `particle-3d`, `None` for `particle-2d`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub depth: Option<u32>,
    /// The effect's length in milliseconds.
    pub duration_ms: u32,
    /// Preview/playback frame rate (greater than zero).
    pub fps: f64,
    /// Whether the effect loops (steady-state) or is one-shot.
    pub looping: bool,
    /// Preview clear color: `transparent` or a hex color.
    pub background: String,
}

// `ParticleSpec` carries an `fps: f64`, so it cannot derive `Eq` (and neither can
// the `TestCaseVersion` that owns it). The fps originates as an exact TOML literal
// validated to be finite and positive at resolution, and is only ever compared or
// rendered, never a hash key, so a manual `Eq` is sound — matching `SheetSequence`.
impl Eq for ParticleSpec {}

/// The resolved `[audio]` of an audio asset-generation case: the output format of
/// the single clip it emits.
///
/// The palette such a case plays is **not** here: a pack declaration is not an
/// asset-generation concept (a full-stack case and a game jam declare one too), so
/// it lives on [`TestCaseVersion::audio_packs`] for every test type alike.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct AudioSpec {
    /// Output sample rate in Hz.
    pub sample_rate: u32,
    /// Channel layout: `mono` or `stereo`.
    pub channels: String,
    /// Cap on the rendered clip's length in milliseconds.
    pub max_duration_ms: u32,
}

/// The resolved `[model]` of a voxel-animation case: the rig the model must
/// produce — named parts in a parent/child hierarchy and the named joints a
/// consuming game (or an auto-play clip) drives. This is the **required**
/// interface, the parts and joints a consuming game may rely on by name; a
/// produced rig may carry further parts and joints of its own, which `rig.json`
/// records and nothing here requires.
//
// Note for maintainers, deliberately NOT a doc comment: this type is emitted into
// `@clockwyrks/asset-contract`, which is vendored into a model's own workspace, and
// `ts_rs` copies doc comments through verbatim. Anything written above with `///`
// is read by the model. So the internal half lives here instead: the spec is
// carried into the run record on `crate::validation::VoxelGenResult`, which is how
// the review and viewer UIs know the joint interface without a catalog lookup.
// `scripts/ci/seeded-contract-check.sh` is the gate that keeps the two apart.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ModelSpec {
    /// The declared parts, in declared order. The first is the root (its `parent`
    /// is `None`); every other part names a declared parent.
    pub parts: Vec<PartSpec>,
    /// The declared joints, in declared order. Each names a declared part.
    pub joints: Vec<JointSpec>,
    /// The model's **animations** — one unified type across the pipeline. On the
    /// *required* contract each is a declaration (its `joints` set, `tracks` empty),
    /// seeded into `rig.json` from t=0; on the *produced* rig each additionally
    /// carries the model-authored F-curve `tracks`. Empty when the case declares
    /// none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub animations: Vec<AnimationSpec>,
}

/// A resolved part of a [`ModelSpec`]: one named voxel component of the rig.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct PartSpec {
    /// Stable name of this part (for example `chassis`, `turret`). The `voxel-anim`
    /// binary targets a part's voxel operations with `--part <name>`.
    pub name: String,
    /// The parent part this one is attached to, or `None` for the root part. A
    /// part inherits its parent's world transform, so posing a parent moves it too.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub parent: Option<String>,
    /// The attachment point of this part in the parent's local voxel coordinates
    /// (`[x, y, z]`). For the root part this is its origin in world space.
    pub pivot: [i64; 3],
}

/// A resolved joint of a [`ModelSpec`]: one named degree of freedom on a part.
///
/// A joint is either **caller-driven** (a consuming game supplies its value at
/// runtime, e.g. `turret_yaw`) or **`auto`** (driven only by the model's
/// [`AnimationSpec`] tracks, holding at `rest` until one overlays it). Rotations
/// are in radians about [`Self::axis`] through [`Self::pivot`]; translations are in
/// voxel units along the axis.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct JointSpec {
    /// Stable name of this joint; the parameter a game addresses (for example
    /// `turret_yaw`).
    pub name: String,
    /// The part this joint moves (a declared [`PartSpec::name`]).
    pub part: String,
    /// Whether this joint rotates or translates the part.
    pub kind: JointKindSpec,
    /// The axis the joint acts about (rotation) or along (translation).
    pub axis: AxisSpec,
    /// The joint origin in the part's local voxel coordinates (`[x, y, z]`).
    pub pivot: [i64; 3],
    /// Minimum value: radians for a rotation, voxel units for a translation.
    pub min: f64,
    /// Maximum value.
    pub max: f64,
    /// The rest/default value, within `[min, max]`.
    pub rest: f64,
    /// A fixed mount translation `[x, y, z]` (in voxels) this joint applies to the
    /// part in addition to its driven motion — the translation half of a compound
    /// attach. Absent (or all-zero) means no offset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub offset: Option<[f64; 3]>,
    /// A fixed mount rotation `[x, y, z]` (radians, applied as Euler X→Y→Z about
    /// [`Self::pivot`]) this joint applies in addition to its driven motion — the
    /// rotation half of a compound attach. Absent (or all-zero) means no rotation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub orient: Option<[f64; 3]>,
    /// Who drives this joint: a caller (a game) or the model's animations.
    pub drive: DriveKindSpec,
}

// `JointSpec` carries `f64` range fields, so it cannot derive `Eq` (and neither can
// the `ModelSpec` that owns it). Those values originate as exact TOML literals
// validated to be finite at resolution and are only ever compared or rendered,
// never used as a hash key, so a manual `Eq` is sound — matching how `SheetSequence`
// treats its `fps` above.
impl Eq for JointSpec {}

/// Whether a [`JointSpec`] rotates or translates its part.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum JointKindSpec {
    /// Rotate the part about [`JointSpec::axis`] through [`JointSpec::pivot`].
    Rotation,
    /// Translate the part along [`JointSpec::axis`].
    Translation,
}

/// A principal axis a [`JointSpec`] acts about or along.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum AxisSpec {
    /// The x axis.
    X,
    /// The y (up) axis.
    Y,
    /// The z axis.
    Z,
}

/// Who drives a [`JointSpec`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum DriveKindSpec {
    /// A consuming game supplies the joint's value at runtime.
    Caller,
    /// The joint is driven only by the model's [`AnimationSpec`] tracks, holding at
    /// `rest` until one overlays it.
    Auto,
}

/// How an [`AnimationSpec`] F-curve segment interpolates between two keyframes —
/// the graph-editor curve real 3D tools use, so motion carries weight and snap
/// instead of sliding linearly. Set per keyframe on the segment **leaving** it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum InterpSpec {
    /// Hold the value until the next key (a step).
    Constant,
    /// A straight line to the next key.
    Linear,
    /// A smooth cubic Bézier shaped by tangent handles (auto tangents when omitted).
    Bezier,
    /// Preset Bézier: start slow and accelerate into the next key.
    EaseIn,
    /// Preset Bézier: start fast and decelerate into the next key.
    EaseOut,
    /// Preset Bézier: ease both ends.
    EaseInOut,
}

/// A resolved keyframe within an [`AnimationTrackSpec`] F-curve: a joint value at a
/// time offset, plus how the curve leaves this key.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct KeyframeSpec {
    /// Time offset from the start of the animation, in milliseconds
    /// (`0..=period_ms`).
    pub t_ms: u32,
    /// The joint value at this time.
    pub value: f64,
    /// Interpolation of the segment **leaving** this key.
    pub interp: InterpSpec,
    /// Bézier out-handle on this key as `[dt_ms, dvalue]` offset from the key;
    /// `None` = auto tangent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub out_handle: Option<[f64; 2]>,
    /// Bézier in-handle on this key as `[dt_ms, dvalue]` offset from the key; `None`
    /// = auto tangent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub in_handle: Option<[f64; 2]>,
}

// Manual `Eq` for the float-bearing keyframe, for the same reason as `JointSpec`
// above.
impl Eq for KeyframeSpec {}

/// A model **animation** — one unified type across the whole pipeline. On the
/// *required* contract it is a declaration: its [`Self::joints`] set is fixed and
/// [`Self::tracks`] is empty; the declaration is seeded into `rig.json` from t=0. On
/// the *produced* rig the model fills [`Self::tracks`] with the authored F-curve
/// motion. An animation is either an [`Self::auto_play`] decorative idle (played
/// continuously by default) or a named playable a game triggers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct AnimationSpec {
    /// Stable, unique name a game plays this animation by (for example `walk`).
    pub name: String,
    /// The period in milliseconds — one full loop across every track.
    pub period_ms: u32,
    /// Whether the animation loops (true) or plays once and holds the last pose.
    pub looping: bool,
    /// Whether the animation plays continuously by default (a decorative idle) or is
    /// a named playable a game triggers.
    pub auto_play: bool,
    /// The joints the animation is **required** to drive. Present on both the
    /// declaration and the produced animation.
    pub joints: Vec<String>,
    /// The authored F-curve tracks, one per driven joint. Empty for a pure required
    /// declaration; filled on the produced rig.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tracks: Vec<AnimationTrackSpec>,
}

/// One track of an [`AnimationSpec`]: the F-curve keyframes that drive a single
/// joint over the animation's timeline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct AnimationTrackSpec {
    /// The joint this track drives (a declared [`JointSpec::name`]).
    pub joint: String,
    /// The keyframes, in time order, sampled over the animation's period.
    pub keyframes: Vec<KeyframeSpec>,
}

// Manual `Eq` for the two animation types: both bottom out in `KeyframeSpec`'s
// `f64` value, so — like the rig types above — they derive `PartialEq` and take a
// hand-written `Eq`.
impl Eq for AnimationSpec {}
impl Eq for AnimationTrackSpec {}

/// A named build target of a test case.
///
/// A variant seeds the case's common specs plus its own additional specs, so one
/// case can define multiple builds (for example, the same game with or without an
/// extra mode). Exactly one variant is selected per run and recorded in the run
/// record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Variant {
    /// The stable slug naming this variant.
    pub slug: String,
    /// Human-readable display name, surfaced on the site.
    pub name: String,
    /// Optional site-facing prose describing what the variant changes.
    pub description: Option<String>,
    /// Specs this variant seeds in addition to the case's common specs.
    pub specs: Vec<SpecFile>,
    /// Starter workspace files for this variant, per [engine](crate::engine), when
    /// it overrides the case's common workspace. `Some` **replaces** the common
    /// workspace for this variant (it is not additive, and it replaces the whole
    /// per-engine table rather than one engine's entry); `None` falls back to
    /// [`TestCaseVersion::common_workspace`]. Resolve the effective set for a
    /// variant and engine with [`TestCaseVersion::workspace_for`].
    pub workspace: Option<EngineWorkspaces>,
    /// Reference views this variant declares in addition to the case's common
    /// references. Rendered and seeded only when this variant is selected, so a
    /// view such as the title menu can differ per variant.
    pub references: Vec<ReferenceView>,
    /// Proof-of-implementation artifacts this variant declares in addition to the
    /// case's common proofs. Requested only when this variant is selected.
    pub proofs: Vec<ProofFile>,
    /// Reviewer checklist items this variant declares in addition to the case's
    /// common items. Surfaced to a reviewer only when this variant is selected, so
    /// a mode-specific check rides along only with the variant that adds the mode.
    pub review_items: Vec<ReviewItem>,
    /// Scoring domains this variant declares in addition to the case's common
    /// [`TestCaseVersion::domains`]. Rated by the reviewer only when this variant
    /// is selected, so a mode that introduces a whole new axis of judgement is
    /// scored on its own without every other variant carrying an unused domain.
    /// The effective domain set for a run of this variant is
    /// [`TestCaseVersion::domains_for`].
    pub domains: Vec<Domain>,
    /// The bounding volume this variant overrides the case's common `[voxel]`
    /// with, when it declares its own. `Some` **replaces** the case's `[voxel]`
    /// for this variant (it is not additive), so the same subject can be sculpted
    /// at a different size; `None` falls back to [`TestCaseVersion::voxel`].
    /// Resolve the effective volume for a variant with
    /// [`TestCaseVersion::voxel_for`].
    pub voxel: Option<VoxelSpec>,
    /// The reference implementation's source directories on the host, keyed by
    /// [engine](crate::engine) slug, when this variant declares a
    /// `reference_implementation`. Each value is an absolute path inside the
    /// version folder holding a buildable static web project that is the *correct*
    /// build of this variant **on that engine**. Stored as resolved host paths
    /// exactly like a [`ReferenceView::source_path`] or a workspace source is —
    /// and, like a reference mockup's source, never seeded into a run: this is the
    /// authored answer the "Reference" tab shows, not model input. The build and
    /// deploy that turn one into a hosted URL happen out-of-band (see the CLI's
    /// `publish-reference` subcommand), so nothing here reads its contents; the
    /// paths are carried purely so the publisher knows which directory to build.
    ///
    /// Keyed by engine because the engine is a run dimension and the build a
    /// reference demonstrates differs under each. Resolution guarantees the keys
    /// are exactly [`TestCaseVersion::engines`], so a run of any supported engine
    /// finds an entry; read it with [`TestCaseVersion::reference_impl_for`] rather
    /// than indexing. Empty when the variant declares no reference implementation.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub reference_impls: BTreeMap<String, PathBuf>,
    /// The authored showcase for this variant, when it declares one — the
    /// description and media carousel (captured from the reference implementation)
    /// the catalog and case pages present. Like the reference implementation it is
    /// authored material that is **never seeded into a run**. `None` when the
    /// variant declares no `showcase`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub showcase: Option<CaseShowcase>,
}

/// A test-case variant's authored showcase: the case-side counterpart of a run's
/// produced showcase (see `RunShowcase`), presenting the *case* rather than one
/// model's attempt at it.
///
/// Resolved from the directory a variant's `showcase` key names — `showcase.md`
/// (the description) plus `showcase.toml` (the ordered media carousel, in the
/// same `[[media]]` shape the run showcase uses). Unlike the run-side capture,
/// which is model-written at run time and degrades leniently, this showcase is
/// authored and committed, so every problem hard-fails resolution.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseShowcase {
    /// The showcase description — `showcase.md`'s contents, verbatim.
    pub description: String,
    /// The media carousel, in declared order. Always 1–10 entries.
    pub media: Vec<CaseShowcaseMedia>,
}

/// One entry of a [`CaseShowcase`]'s media carousel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseShowcaseMedia {
    /// The media file's name in the showcase directory itself (a plain file name —
    /// no subdirectories).
    pub file: String,
    /// The short caption for the entry.
    pub name: String,
    /// The kind of media the file holds, inferred from its name (see
    /// [`MediaKind::from_path`]).
    pub kind: MediaKind,
    /// Absolute host path to the media file inside the version folder, carried —
    /// like a [`ReferenceView::source_path`] — so a publisher or server knows
    /// which file's bytes to ship.
    pub source_path: PathBuf,
}

/// A reference view a test case declares as a visual target.
///
/// The reference is rendered to a screenshot which is **seeded** into a run so
/// the model can see what the screen should look like. The reference *source*
/// (the HTML/CSS mockup at [`Self::source_path`]) is never seeded — handing it
/// over would let a model copy the intended UI instead of building it from the
/// specification.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceView {
    /// The view name (for example, `title`), matched against a declared
    /// [`Check`]'s baseline.
    pub view: String,
    /// How the reference is produced: a rendered HTML mockup, or a static
    /// image/video served as-is.
    pub kind: ReferenceKind,
    /// Path to the reference source on the host. For a [`ReferenceKind::Rendered`]
    /// reference this is the HTML mockup (rendered to a screenshot, never seeded);
    /// for a static reference it is the image or video file itself, which is
    /// seeded and served as-is.
    pub source_path: PathBuf,
}

impl ReferenceView {
    /// The file extension under which this reference is seeded and served:
    /// `png` for a rendered mockup, otherwise the static source's own extension.
    pub fn extension(&self) -> String {
        if self.kind.is_rendered() {
            return "png".to_string();
        }
        self.source_path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase())
            .unwrap_or_else(|| "png".to_string())
    }
}

/// A single action that drives a served implementation toward a view.
///
/// Serializes to the JSON shape the browser driver consumes (an internally
/// tagged `{ "type": … }` object); see `packages/browser-driver/driver.mjs`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum CheckAction {
    /// Pause for `ms` milliseconds.
    Wait {
        /// Duration to wait, in milliseconds.
        ms: u64,
    },
    /// Press and release a key (Playwright key name, e.g. `Enter`, `ArrowUp`).
    Key {
        /// The key to press.
        key: String,
    },
    /// Hold a key down for `ms` milliseconds, then release it.
    Hold {
        /// The key to hold.
        key: String,
        /// How long to hold it, in milliseconds.
        ms: u64,
    },
    /// Click a logical-pixel point on the page.
    Click {
        /// Horizontal position, in logical pixels.
        x: f64,
        /// Vertical position, in logical pixels.
        y: f64,
    },
}

/// An opt-in validation check.
///
/// A check drives a produced implementation through [`Self::actions`],
/// screenshots it, and compares that capture against the screenshot rendered
/// from the [`Self::reference_view`] reference. Validation runs only the checks
/// a test case declares; a reference is not validated unless a check names it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    /// The view slug this check records its result under.
    pub view: String,
    /// Human-readable display name for the check.
    pub name: String,
    /// The reference view whose rendered screenshot is the comparison baseline.
    pub reference_view: String,
    /// The actions that drive the implementation into the view before capture.
    pub actions: Vec<CheckAction>,
}

/// A case's resolved debug-API contract: the `window` handle every build installs
/// its automation surface on (see `ManifestInstrumentation`).
///
/// Reporter-side and host-only: it is populated at resolution and drives the
/// validator's [debug-script stage](crate::validation::DebugScriptResult); it is
/// never serialized (so it never reaches a UI or a stored catalog) and never
/// seeded into a run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Instrumentation {
    /// The `window` property name the debug API is installed on, without the
    /// `window.` prefix (for example `__carom`).
    pub handle: String,
    /// The case's **fixed simulation rate** in ticks per second (for example `120`
    /// for carom), passed to the script driver as `--tick-hz`.
    ///
    /// A case on a manual clock is stepped an exact number of ticks by a validation
    /// script, but the things the script must then observe — a recorded clip, a CSS
    /// transition, a timed banner — happen in *real* time. The rate is the
    /// conversion factor between the two, so knowing it is what lets the validation
    /// runtime turn "step 240 ticks" into "two seconds of simulated time" and wait
    /// or seek accordingly. Without it the runtime can only step blindly and guess
    /// at durations, which is exactly the flakiness the manual clock exists to
    /// remove.
    ///
    /// Integer Hz, not a float: a fixed-timestep simulation ticks a whole number of
    /// times per second (60, 120), so a fractional rate models the domain wrong —
    /// and it would cost every type transitively holding this one its `Eq` for
    /// nothing. Converting a tick count to a wall-clock duration is the only thing
    /// the validation runtime needs the rate for, and integer Hz does that exactly.
    ///
    /// `None` for a case whose build is clocked in real time (no fixed step), where
    /// there is no such conversion to make and the driver falls back to its own
    /// timing.
    pub tick_hz: Option<u32>,
}

/// A resolved automated-validation driver for a [`ReviewItem`] (see
/// `ManifestReviewValidation`).
///
/// Host-only and reporter-side: [`script`](Self::script) is an absolute host path
/// the validator runs, never serialized and never seeded. The declared
/// [`outputs`](Self::outputs) become the run's synthesized proof media, captured
/// once from the model's build and once from the reference implementation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewValidation {
    /// Absolute host path to the debug-driver script, for a case that has one —
    /// an engineless case, whose single script is driven in a browser.
    ///
    /// `None` for a case that declares its validators **per engine**: the
    /// same-named suite decides the point in the validator project of every engine
    /// [`Self::engines`] covers, so which file on the host decides it is a property
    /// of the run's engine rather than of the case, and the validator resolves it
    /// from [`Self::script_rel`] against the project it staged.
    pub script: Option<PathBuf>,
    /// The script path as the case declared it, kept for display in the run's
    /// script list: version-folder-relative for an engineless case (for example
    /// `validation/ball-spin.mjs`), and relative to the engine's validator project
    /// for a per-engine case (for example `gameplay/serve-speed.test.ts`).
    pub script_rel: String,
    /// The engines this validator is active on, in declared order. Empty when the
    /// case declares no restriction, which is every engine it supports.
    pub engines: Vec<String>,
    /// The media outputs the script produces, in declared order.
    pub outputs: Vec<ReviewOutput>,
}

impl ReviewValidation {
    /// Whether this validator decides its point on a run built on `engine`.
    ///
    /// A point this returns `false` for is not part of that run's checklist at all:
    /// it is not driven, no verdict is recorded against it, it is not shown to the
    /// reviewer, and it carries no weight in the score (see
    /// [`TestCaseVersion::review_items_for_engine`]).
    pub fn covers(&self, engine: &str) -> bool {
        self.engines.is_empty() || self.engines.iter().any(|slug| slug == engine)
    }
}

/// A resolved media output of a [`ReviewValidation`] script.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewOutput {
    /// Stable slug identifying this output within its script — the media file stem.
    pub id: String,
    /// Human-readable display name (defaulted to a humanized `id` when unspecified).
    pub name: String,
    /// Whether this output is an image or a video clip.
    pub kind: MediaKind,
}

/// A reviewer checklist item a test case declares.
///
/// Reviewer checklist items are **not seeded** into a run; they are reporter-side
/// material that enumerates what a person must explicitly check after playing a
/// build, so a case's major requirements are guaranteed to be verified by hand
/// rather than left to whatever a reviewer happens to notice. Each item is
/// recorded against the run's review by [`Self::id`] together with the reviewer's
/// verdict (see [`crate::review`]). Items restate observable requirements the
/// seeded specification already states, so keeping them out of the run hides
/// nothing from the model.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewItem {
    /// Stable slug identifying this item; recorded with the reviewer's verdict.
    pub id: String,
    /// A short heading shown above the item in the reviewer UI (a synthesized
    /// number is prefixed at display time).
    pub title: String,
    /// The prose a reviewer reads — what to check.
    pub text: String,
    /// Optional reference view shown to the reviewer as the **expected** target
    /// for this item. `None` when the item has no paired reference.
    pub reference: Option<String>,
    /// Optional proof id whose **submitted** media is shown to the reviewer for
    /// this item. `None` when the item has no paired proof.
    pub proof: Option<String>,
    /// Sprite-sheet sequence slugs this item is about, in declared order. The
    /// reviewer UI surfaces these as the relevant animations to play for the item
    /// so it need not be checked against the whole sheet. Empty when the item
    /// names none (it applies to the asset as a whole). Only ever non-empty for a
    /// sprite-sheet asset-generation case; every slug names a declared
    /// [`SheetSequence`].
    #[serde(default)]
    pub sequences: Vec<String>,
    /// Sprite-sheet frame indices this item is about, in declared order, alongside
    /// any referenced sequences' frames. The reviewer UI surfaces these as the
    /// relevant frames for the item. Empty when the item names none. Only ever
    /// non-empty for a sprite-sheet asset-generation case; every index is a
    /// declared frame in the [`SheetSpec`].
    #[serde(default)]
    pub frames: Vec<u32>,
    /// How many points this item is worth toward the run's score. Always greater
    /// than zero. When [`Self::graded`] is false (the common case) and the item has
    /// no [`Self::sub_items`], a run earns this whole weight when the reviewer marks
    /// it `pass` and none when they mark it `fail`; with sub-items the weight is
    /// split evenly across them and the item earns the fraction that passed. When
    /// `graded` is true the item is a [game jam](TestType::GameJam) category worth
    /// `weight × 10` points, earning the graded tier's points times its weight (see
    /// `test_cabinet_core::review::score`).
    pub weight: u32,
    /// Whether this item is graded on the five-level scale
    /// ([`crate::review::VerdictStatus::GRADES`], 0/2/5/8/10 points) rather than
    /// pass/fail. True only for a [game jam](TestType::GameJam)'s review categories;
    /// false for every other test type. Set at resolution from the case's test
    /// type, not declared per item. Mirrored by the reviewer UI, which renders the
    /// graded control for a graded item and pass/fail otherwise.
    #[serde(default)]
    pub graded: bool,
    /// The scoring [`Domain`] this item belongs to (by id), or `None` for a
    /// general item that belongs to no single domain. Used to group the score
    /// breakdown by domain in the reviewer and verdict UIs.
    pub domain: Option<String>,
    /// Name-only sub-items breaking this item into independently graded points.
    /// Empty for an item graded as a whole (the common case). When non-empty, the
    /// reviewer records a pass/fail per sub-item rather than one for the item, and
    /// the item's [`Self::weight`] is split evenly across them; each sub-item's
    /// verdict is keyed by the composite [`Self::sub_item_verdict_id`].
    #[serde(default)]
    pub sub_items: Vec<SubReviewItem>,
    /// Whether this item contributes to the run's score. `true` for every declared
    /// item; set `false` only on the **effective per-variant** checklist (see
    /// [`TestCaseVersion::review_items_for`]) when an [`Erratum`] with
    /// [`Erratum::exclude_from_score`] links this item's verdict id — the item is still
    /// checked, driven, and shown, but scoring (`test_cabinet_core::review::score_checklist`) skips
    /// it and its auto-validation no longer gates. Defaults to `true` so a declared or
    /// round-tripped item is scored unless explicitly excluded. When an item declares
    /// [`Self::sub_items`], exclusion of an individual point is recorded on that
    /// sub-item (see [`SubReviewItem::scored`]); this whole-item flag is cleared only
    /// when the item is scored as a whole, or when a whole category is excluded (which
    /// also clears every sub-item). Mirrored by the TypeScript `ReviewItem` in
    /// `packages/ui/src/ratings.ts`.
    #[serde(default = "default_true")]
    pub scored: bool,
    /// The resolved automated-validation driver for this item, or `None` for a
    /// human-judged item. Host-only and **not serialized** (`#[serde(skip)]`): it
    /// carries an absolute host script path and is consumed by the validator, so it
    /// must never reach a UI, a stored catalog, or a seeded run. Populated at
    /// resolution; a round-tripped [`ReviewItem`] deserializes it as `None`, which
    /// is correct — auto-validation only runs from a freshly resolved manifest.
    #[serde(skip)]
    pub validation: Option<ReviewValidation>,
    /// The [`FailureCap`] of an item graded as a whole on a
    /// [validator-rated](TestCaseVersion::validator_rated) version: the highest
    /// functional rating its [`Self::domains`] may reach while its validator fails.
    /// `None` on a legacy version, and on a category (whose points carry their own
    /// caps; see [`SubReviewItem::failure_cap`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_cap: Option<FailureCap>,
    /// The scoring domain ids a failure of this whole-item point lowers, on a
    /// validator-rated version. Empty on a legacy version and on a category. This
    /// is the scoring rule's input; [`Self::domain`] is the legacy display grouping
    /// and is left as is.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub domains: Vec<String>,
}

impl ReviewItem {
    /// The verdict id for one of this item's sub-items: the composite
    /// `<item id>.<sub-item id>`. This is the id a reviewer's [`ReviewVerdict`]
    /// carries for the sub-item, so a sub-item's verdict is an ordinary verdict
    /// (no new wire shape) whose id names the point within the item. Mirrored by
    /// `subItemVerdictId` in `packages/ui/src/ratings.ts`.
    ///
    /// [`ReviewVerdict`]: crate::review::ReviewVerdict
    pub fn sub_item_verdict_id(item_id: &str, sub_item_id: &str) -> String {
        format!("{item_id}.{sub_item_id}")
    }

    /// The verdict ids a reviewer must record for this item: the item's own id
    /// when it is graded as a whole, or one composite id per sub-item when it
    /// declares [`Self::sub_items`]. This is the set of ids that must appear in a
    /// review's checklist for the item to be fully addressed, and the ids scoring
    /// looks up. Mirrored by `verdictIdsForItem` in `packages/ui/src/ratings.ts`.
    pub fn verdict_ids(&self) -> Vec<String> {
        if self.sub_items.is_empty() {
            vec![self.id.clone()]
        } else {
            self.sub_items
                .iter()
                .map(|sub| Self::sub_item_verdict_id(&self.id, &sub.id))
                .collect()
        }
    }
}

/// Combine a case's common review items with a variant's own into the effective
/// list a run of that variant is reviewed and scored against, merging by id: a
/// variant item whose id matches a common item folds its `sub_items` into that
/// common item (and adds its weight) rather than appending a second same-id group,
/// so a variant can extend a common **category** (in the `[review] format = 2`
/// grammar a category resolves to a [`ReviewItem`] and its items to `sub_items`).
/// A variant item with an id no common item uses is appended whole, preserving the
/// "common first, then the variant's own" order. Because resolution forbids two
/// items resolving to the same *verdict* id across common and variant, a merge only
/// ever unions disjoint sub-items under a shared category id — it never collides two
/// points. Mirrored by `mergeReviewItems` in `packages/ui/src/app/data/ratings.ts`
/// and the snapshot assembler in `apps/site/vite-plugin-snapshot.ts`.
pub fn merge_review_items(common: &[ReviewItem], variant: &[ReviewItem]) -> Vec<ReviewItem> {
    let mut merged: Vec<ReviewItem> = common.to_vec();
    for item in variant {
        if let Some(existing) = merged.iter_mut().find(|c| c.id == item.id) {
            existing.sub_items.extend(item.sub_items.iter().cloned());
            existing.weight += item.weight;
        } else {
            merged.push(item.clone());
        }
    }
    merged
}

/// Clear the [`ReviewItem::scored`] / [`SubReviewItem::scored`] flag of every point
/// named in `excluded` on an effective checklist (the output of
/// [`merge_review_items`]), marking it non-scoring for the run.
///
/// An id that names a whole item clears that item — and, if the item is a category,
/// every one of its sub-items, since excluding the category as a whole excludes all
/// its points. An id of the composite `<item>.<sub>` form clears only that sub-item,
/// leaving the rest of the category scored. Ids in `excluded` that match no point are
/// ignored (an erratum may name a point a later checklist edit removed). A non-scoring
/// point is still checked, driven, and shown; it is scoring (`test_cabinet_core::review::score_checklist`)
/// and the auto-validation verdicts (see [`crate::validation::DebugScriptResult`])
/// that skip it. Mirrored by `applyScoreExclusions` in `packages/ui/src/ratings.ts`.
pub fn apply_score_exclusions(items: &mut [ReviewItem], excluded: &HashSet<String>) {
    if excluded.is_empty() {
        return;
    }
    for item in items.iter_mut() {
        if excluded.contains(&item.id) {
            item.scored = false;
            for sub in &mut item.sub_items {
                sub.scored = false;
            }
        }
        for sub in &mut item.sub_items {
            if excluded.contains(&ReviewItem::sub_item_verdict_id(&item.id, &sub.id)) {
                sub.scored = false;
            }
        }
    }
}

/// The generic graded review checklist a [game jam](TestType::GameJam) uses when
/// it declares no `[[review_item]]` categories of its own — the "provide a generic
/// review checklist" default. Each is a category graded on the five-level scale
/// (see [`crate::review::VerdictStatus::GRADES`]), worth `weight × 10` points; a
/// jam may instead author its own categories to weight or specialize them. The
/// reviewer additionally supplies a whole-game overall grade (the reserved
/// [`crate::review::OVERALL_VERDICT_ID`] mark), which is not a category here.
pub fn default_game_jam_review_items() -> Vec<ReviewItem> {
    const DEFAULTS: &[(&str, &str, &str)] = &[
        (
            "playable",
            "Playability",
            "The game loads and is playable from start to finish without breaking — controls \
             respond and the core loop works.",
        ),
        (
            "fun",
            "Fun",
            "The game is genuinely enjoyable to play: the core mechanic is satisfying and there \
             is a reason to keep playing rather than a tech demo that merely runs.",
        ),
        (
            "theme",
            "Theme",
            "The game interprets the jam's theme in a clear, deliberate way that shapes the \
             design, rather than wearing it as a thin coat of paint.",
        ),
        (
            "presentation",
            "Presentation",
            "The visuals, layout, and interface (UI/UX) are cohesive and readable, built from \
             assets the model produced rather than placeholder rectangles.",
        ),
        (
            "audio",
            "Audio",
            "Sound effects and music are present, produced during the run, and add to the \
             experience rather than silence or a downloaded stand-in.",
        ),
        (
            "polish",
            "Polish",
            "The game feels complete and considered: menus and game states are reachable, \
             feedback is clear, and there are few rough edges or obvious bugs.",
        ),
        (
            "creativity",
            "Creativity",
            "The game shows originality in its concept, mechanics, or presentation rather than a \
             rote clone of a well-worn template.",
        ),
    ];
    DEFAULTS
        .iter()
        .map(|(id, title, text)| ReviewItem {
            id: (*id).to_string(),
            title: (*title).to_string(),
            text: (*text).to_string(),
            reference: None,
            proof: None,
            sequences: Vec::new(),
            frames: Vec::new(),
            weight: 1,
            graded: true,
            domain: None,
            sub_items: Vec::new(),
            scored: true,
            validation: None,
            failure_cap: None,
            domains: Vec::new(),
        })
        .collect()
}

/// serde default for a sub-item's [`weight`](SubReviewItem::weight): one point.
fn one() -> u32 {
    1
}

/// A sub-item of a [`ReviewItem`]: one independently graded point within the
/// item. In the legacy `[[review_item]]` grammar a sub-item is name-only (id +
/// title); in the `[review] format = 2` **categories** grammar this is the
/// scored leaf — a *review item* under a category — and it additionally carries
/// its own [`description`](Self::description), [`weight`](Self::weight), and
/// paired [`reference`](Self::reference)/[`proof`](Self::proof). See
/// `ManifestSubReviewItem` and `ManifestReviewCategoryItem` for the two
/// manifest shapes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubReviewItem {
    /// Stable slug identifying this sub-item within its parent item; part of the
    /// composite verdict id (see [`ReviewItem::sub_item_verdict_id`]).
    pub id: String,
    /// The short heading shown for this sub-item in the reviewer UI.
    pub title: String,
    /// Optional prose the reviewer reads for this point — what to check. `None`
    /// for a legacy name-only sub-item (whose parent item's `text` is the shared
    /// context); set in the categories grammar, where the category carries no
    /// prose and each review item states its own requirement.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// How many points this sub-item is worth toward the run's score. Always
    /// greater than zero; defaults to `1`. A category's weight is the sum of its
    /// items' weights (see `test_cabinet_core::review::score_checklist`).
    #[serde(default = "one")]
    pub weight: u32,
    /// Optional reference view shown to the reviewer as the **expected** target
    /// for this point. `None` when unpaired. In the categories grammar the paired
    /// reference/proof live on the review item rather than the category.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    /// Optional proof id whose **submitted** media is shown to the reviewer for
    /// this point. `None` when unpaired.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proof: Option<String>,
    /// Whether this sub-item contributes to the run's score. Like [`ReviewItem::scored`]
    /// it is `true` for every declared sub-item and set `false` only on the effective
    /// per-variant checklist when an [`Erratum`] with [`Erratum::exclude_from_score`]
    /// links this sub-item's composite verdict id (or excludes the whole category) —
    /// the point is still checked, driven, and shown, but scoring skips it and its
    /// auto-validation no longer gates. Defaults to `true`.
    #[serde(default = "default_true")]
    pub scored: bool,
    /// The resolved automated-validation driver for this sub-item, or `None` for a
    /// human-judged sub-item. Host-only and **not serialized** (`#[serde(skip)]`),
    /// exactly like [`ReviewItem::validation`]: it carries an absolute host script
    /// path consumed by the validator and must never reach a UI, a stored catalog,
    /// or a seeded run. Populated at resolution; a round-tripped [`SubReviewItem`]
    /// deserializes it as `None`, which is correct — auto-validation only runs from
    /// a freshly resolved manifest. Only ever `Some` within an item that declares
    /// sub-items, since item-level validation is forbidden once sub-items exist.
    #[serde(skip)]
    pub validation: Option<ReviewValidation>,
    /// The [`FailureCap`] of this point on a
    /// [validator-rated](TestCaseVersion::validator_rated) version: the highest
    /// functional rating its [`Self::domains`] may reach while its validator fails
    /// (see `test_cabinet_core::review::validator_domain_ratings`). Always `Some` on a
    /// validator-rated version; `None` on a legacy version.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_cap: Option<FailureCap>,
    /// The scoring domain ids a failure of this point lowers, on a validator-rated
    /// version — never empty there, and empty on a legacy version.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub domains: Vec<String>,
}

/// A scoring domain a test case declares.
///
/// A reviewer rates each domain independently (for example a game's
/// single-player and versus modes), and the run's overall rating is the **worst**
/// rating across all of them — a flawless mode cannot mask a broken one. A case
/// declares at least one domain. Review items may be grouped under a domain (see
/// [`ReviewItem::domain`]) to break the score down per domain.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Domain {
    /// Stable slug identifying this domain; recorded with the reviewer's
    /// per-domain rating.
    pub id: String,
    /// Human-readable display name, surfaced in the reviewer and verdict UIs.
    pub name: String,
    /// A brief description of what the domain covers, shown to the reviewer so
    /// they know what they are rating.
    pub description: String,
}

/// How serious a known-issue [`Erratum`] is, surfaced as a badge on the site.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum ErratumSeverity {
    /// A note or minor caveat that does not meaningfully affect a run.
    Info,
    /// A real but limited issue — the default.
    #[default]
    Minor,
    /// A significant issue that materially affects the case or its scoring.
    Major,
}

/// A resolved known-issue entry for a test case version (see `ErrataFile`).
///
/// Errata are **not seeded** into a run — they are site-facing material recording
/// problems discovered *after* a version shipped, so a known issue can be
/// acknowledged without cutting a new version (which would evict the version's
/// existing runs from its metrics). Each is shown on the case's Errata tab and, for
/// entries tied to a scored point ([`Self::review`]) or flagged
/// [`Self::affects_scoring`], surfaced to reviewers scoring a run of the version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Erratum {
    /// Stable slug identifying this erratum within the version.
    pub id: String,
    /// A short one-line heading for the issue.
    pub title: String,
    /// Optional date (`YYYY-MM-DD`) the issue was recorded. `None` when omitted.
    pub date: Option<String>,
    /// How serious the issue is.
    pub severity: ErratumSeverity,
    /// Whether the issue can affect a run's score.
    pub affects_scoring: bool,
    /// Whether the linked review point is excluded from scoring for the version: the
    /// point is still checked, driven, and shown, but no longer contributes to any
    /// run's score and (when auto-validated) no longer gates it. Always paired with a
    /// [`Self::review`] link naming the excluded point. See
    /// [`TestCaseVersion::review_items_for`] and `test_cabinet_core::review::score_checklist`.
    /// Defaulted so a wire producer that predates the field deserializes as `false`.
    #[serde(default)]
    pub exclude_from_score: bool,
    /// The issue description, as Markdown.
    pub body: String,
    /// The version the issue is (or will be) addressed in, if declared. `None`
    /// while the issue is outstanding with no fix version recorded yet.
    pub resolved_in: Option<String>,
    /// The variant slug the issue is scoped to, or `None` when it applies to
    /// every variant.
    pub variant: Option<String>,
    /// The review verdict id the issue concerns (a review item id or a composite
    /// `<item id>.<sub-item id>`), or `None` when it is not tied to a scored point.
    pub review: Option<String>,
}

// `Check` derives `Eq`, so its actions must too; the `Click` coordinates are the
// only floats. They originate as exact TOML literals and are only ever compared,
// never arithmetic'd, so treating them as `Eq` is sound here.
impl Eq for CheckAction {}

/// One engine a test case version supports, with the range of engine versions it
/// supports.
///
/// The resolved form of both manifest spellings: a bare entry in the `engines`
/// list resolves to an *unbounded* support (no floor, no ceiling — any version the
/// catalogue offers), and an `[[engine]]` table resolves to one carrying its
/// range. Merging the two forms here rather than keeping them apart is what lets
/// every consumer — [`TestCaseVersion::supports_engine`], the run gate, the CLI —
/// ask one question of one set.
///
/// The range is half-open by design: `min_version` is **inclusive** (the earliest
/// contract the case's specs and validators were written against, which the case
/// does support) and `max_version` is **exclusive** (the version whose behaviour
/// changed, which it does not). That is the shape a case actually means when it
/// pins a runtime, and it makes two adjacent case versions tile without a gap or
/// an overlap.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineSupport {
    /// The engine slug, one the catalogue (`test_cabinet_core::engine::EngineCatalog`) knows.
    pub slug: String,
    /// The lowest engine version a run may select, **inclusive**. `None` when the
    /// case declared the engine as a bare slug and pinned no floor.
    pub min_version: Option<Version>,
    /// The version support stops at, **exclusive**. `None` when the range is
    /// unbounded above, which is the default.
    pub max_version: Option<Version>,
}

impl EngineSupport {
    /// Support for `slug` at any version — the bare `engines`-list form, and the
    /// implicit entry every case carries for [`NONE_SLUG`].
    pub fn unbounded(slug: impl Into<String>) -> Self {
        Self {
            slug: slug.into(),
            min_version: None,
            max_version: None,
        }
    }

    /// Whether this entry constrains the version at all.
    ///
    /// The run gate reads it to decide whether it needs a version to check
    /// against: an unbounded entry accepts whatever the catalogue staged, so a
    /// store it cannot read a version out of costs it nothing, while a bounded one
    /// cannot answer without the number and refuses rather than guessing.
    pub fn is_bounded(&self) -> bool {
        self.min_version.is_some() || self.max_version.is_some()
    }

    /// Whether `version` falls inside this entry's range: at or above the
    /// inclusive minimum and strictly below the exclusive maximum.
    pub fn accepts(&self, version: &Version) -> bool {
        self.min_version.as_ref().is_none_or(|min| version >= min)
            && self.max_version.as_ref().is_none_or(|max| version < max)
    }

    /// The range in the words a person can act on, for an error message: the
    /// half-open interval, or the fact that there is no constraint at all.
    pub fn range_display(&self) -> String {
        match (&self.min_version, &self.max_version) {
            (Some(min), Some(max)) => format!(">= {min}, < {max}"),
            (Some(min), None) => format!(">= {min}"),
            (None, Some(max)) => format!("< {max}"),
            (None, None) => "any version".to_string(),
        }
    }
}

/// The wire shape of a bounded [`EngineSupport`]: the table form, in the
/// `camelCase` every other resolved type is serialized in.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EngineSupportRepr {
    slug: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    min_version: Option<Version>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    max_version: Option<Version>,
}

/// Either spelling of an engine entry on the wire: a bare slug or the table.
///
/// An entry that pins no range is written as the bare slug the case authored, so
/// the stored form stays as small as the declaration it came from; only an entry
/// carrying a range needs the table. Reading both spellings here is the same
/// accommodation resolution makes for the manifest, and it costs one enum.
#[derive(Deserialize)]
#[serde(untagged)]
enum EngineSupportWire {
    Slug(String),
    Table(EngineSupportRepr),
}

impl Serialize for EngineSupport {
    /// An unbounded entry serializes back to the bare slug it was read from, so a
    /// case that pins nothing round-trips through the definition store unchanged.
    /// Only an entry that actually carries a range needs the table.
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        if self.is_bounded() {
            EngineSupportRepr {
                slug: self.slug.clone(),
                min_version: self.min_version.clone(),
                max_version: self.max_version.clone(),
            }
            .serialize(serializer)
        } else {
            serializer.serialize_str(&self.slug)
        }
    }
}

impl<'de> Deserialize<'de> for EngineSupport {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        Ok(match EngineSupportWire::deserialize(deserializer)? {
            EngineSupportWire::Slug(slug) => Self::unbounded(slug),
            EngineSupportWire::Table(repr) => Self {
                slug: repr.slug,
                min_version: repr.min_version,
                max_version: repr.max_version,
            },
        })
    }
}

/// A resolved, exact test case version.
///
/// Holds the on-disk location and the manifest of what the version contains.
/// The specification, assets, and the *rendered* reference screenshots are
/// seeded into a run; the reference *source* mockups are not. The declared
/// [`Self::checks`] drive validation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestCaseVersion {
    /// The owning test case slug.
    pub slug: String,
    /// The exact version string (the `<version>` directory).
    pub version: String,
    /// Human-readable display name, surfaced on the site.
    pub name: String,
    /// Relative difficulty of the case, surfaced on the site.
    pub difficulty: String,
    /// Free-form classification tags surfaced on the site.
    pub tags: Vec<String>,
    /// Optional short, site-facing abstract shown on the test case cards.
    /// Authored inline as plain text in the manifest. `None` when the manifest
    /// declares none. This is **not** seeded into runs.
    pub summary: Option<String>,
    /// Path to the optional site-facing description Markdown, resolved inside
    /// the version folder. `None` when the manifest declares none. This is
    /// **not** seeded into runs.
    pub description_path: Option<PathBuf>,
    /// Path to the per-version changelog Markdown, resolved inside the version
    /// folder. Always present — a changelog is **required** on every version.
    /// Records what changed in this version; the site aggregates every version's
    /// entry into a newest-first changelog. This is **not** seeded into runs.
    #[serde(default)]
    pub changelog_path: PathBuf,
    /// The version folder on the host: `test-cases/<type>/<difficulty>/<slug>/<version>/`.
    pub root: PathBuf,
    /// Host path to the prompt template handed to the harness. Rendered through
    /// Handlebars with the run's workspace and seeded spec paths.
    pub prompt_path: PathBuf,
    /// The maximum wall-clock duration, in seconds, the harness session is
    /// allowed before it is stopped. Normalized from the manifest's
    /// `max_runtime_hours` at resolution via [`crate::runtime_hours_to_seconds`].
    /// This is the per-case default; a run may override it (see
    /// `test_cabinet_core::RunRequest::max_runtime_override`). Always positive, so a run is
    /// never unbounded.
    pub max_runtime_seconds: u64,
    /// The test type this case belongs to, the discriminator validation and the
    /// run record branch on.
    #[serde(default)]
    pub test_type: TestType,
    /// Whether this version is **experimental** — still being iterated on and not
    /// yet ready to have runs published for it. Carried verbatim from the
    /// manifest's `experimental` flag; defaults to `false`. Outward-facing backend
    /// surfaces hide experimental versions unless the deployment opts in (see
    /// `Manifest`'s `experimental` documentation), so the flag acts purely as a
    /// visibility filter and has no effect on how a run executes.
    #[serde(default)]
    pub experimental: bool,
    /// Whether this version is authored on the **engine format** — the per-engine
    /// manifest spelling (`[workspaces]` / `engines` / `[[engine]]`) rather than the
    /// legacy single `workspace`. Set at resolution. Together with the test type it
    /// decides whether the version is [validator-rated](Self::validator_rated).
    /// Always present on the wire (a payload lacking it is one no resolution wrote,
    /// and reads as legacy — the behaviour every frozen version has).
    #[serde(default)]
    pub engine_format: bool,
    /// The commands the validator runs to build the produced implementation into
    /// a served static site (from the manifest's `[build]` table). `Some` for an
    /// end-to-end case, `None` for any other type. Kept as a top-level optional
    /// field (rather than nested under a type enum) so an end-to-end version's
    /// serialized shape is unchanged apart from the new discriminator.
    #[serde(default)]
    pub build: Option<BuildCommands>,
    /// The TypeScript toolchain commands run over the produced implementation
    /// (from the manifest's `[toolchain]` table). `Some` only for a case that
    /// declares the table; `None` — the case for every version frozen before it
    /// existed — means the run is neither toolchain-checked nor
    /// [gated](crate::toolchain::ToolchainSummary::gates).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub toolchain: Option<crate::toolchain::ToolchainCommands>,
    /// The case's debug-API contract — the `window` handle every build installs its
    /// automation surface on — when the case mandates
    /// [instrumentation](Instrumentation). Host-only and **not serialized**
    /// (`#[serde(skip)]`): populated at resolution and consumed by the validator's
    /// debug-script stage, never surfaced to a UI or seeded into a run. `None` for a
    /// case with no auto-validated review items.
    #[serde(skip)]
    pub instrumentation: Option<Instrumentation>,
    /// The canvas an asset-generation case's model draws on. `Some` only for
    /// asset-generation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canvas: Option<CanvasSpec>,
    /// The drawing tool an asset-generation case exposes. `Some` only for
    /// asset-generation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool: Option<ToolSpec>,
    /// Where an asset-generation run's recorded action log is collected. `Some`
    /// only for asset-generation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<OutputSpec>,
    /// The controller contract an adversarial case's wasm controller implements.
    /// `Some` only for adversarial.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contract: Option<ContractSpec>,
    /// The per-tick sandbox limits applied to an adversarial case's controllers.
    /// `Some` only for adversarial.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sandbox: Option<SandboxSpec>,
    /// The simulation-loop configuration of an adversarial case. `Some` only for
    /// adversarial.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub simulation: Option<SimulationSpec>,
    /// How an adversarial case pairs implementations into matches. `Some` only for
    /// adversarial. Recorded faithfully though the validator runs only the single
    /// canonical match.
    #[serde(default, rename = "match", skip_serializing_if = "Option::is_none")]
    pub r#match: Option<MatchSpec>,
    /// How an adversarial case renders a recorded match for browser playback.
    /// `Some` only for adversarial.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replay: Option<ReplaySpec>,
    /// Whether an asset-generation case draws a single sprite or a sprite sheet.
    /// Defaults to [`AssetKind::Sprite`]; meaningful only for asset-generation
    /// (always `Sprite` for any other type).
    #[serde(default)]
    pub asset_kind: AssetKind,
    /// Which of the two full-stack run images this version's runs execute in.
    /// Defaults to [`AssetDimension::TwoD`]; meaningful only for full-stack (always
    /// `TwoD` for any other type, whose image is selected by the type alone).
    #[serde(default)]
    pub asset_dimension: AssetDimension,
    /// The frame grid and named sequences of a sprite-sheet case. `Some` only when
    /// [`Self::asset_kind`] is [`AssetKind::SpriteSheet`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet: Option<SheetSpec>,
    /// The bounding volume a voxel asset-generation case's model draws into. `Some`
    /// only for the two voxel kinds ([`AssetKind::VoxelModel`] /
    /// [`AssetKind::VoxelAnimation`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voxel: Option<VoxelSpec>,
    /// The required rig (parts + joints) of a voxel-animation, meshed-animation, or
    /// skinned case. `Some` only for an animated voxel-family kind.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<ModelSpec>,
    /// The kit of elements a `ui` case declares. `Some` only for [`AssetKind::Ui`]
    /// (with empty elements for a single-image `ui` case).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui: Option<UiSpec>,
    /// The tileable-PBR-material output a `material` case declares. `Some` only for
    /// [`AssetKind::Material`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub material: Option<MaterialSpec>,
    /// The field/timing a particle case plays in. `Some` only for the two particle
    /// kinds ([`AssetKind::Particle2d`] / [`AssetKind::Particle3d`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub particle: Option<ParticleSpec>,
    /// The clip output format of an audio case. `Some` only for the three audio
    /// kinds ([`AssetKind::SfxSynth`] / [`AssetKind::SfxSample`] / [`AssetKind::Music`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio: Option<AudioSpec>,
    /// The audio packs a run of this version is staged with, in declaration order
    /// (`name@version` refs from the manifest's `[audio] packs`).
    ///
    /// This is the whole of what a run's audio binaries can reach: the run container
    /// is staged with these packs and no others, so it is also the boundary
    /// `list-samples` and `list-instruments` browse. **Order is meaningful** — the
    /// first entry of each pack kind is that kind's default for a tool config that
    /// names no pack, which is every full-stack and game-jam run, since the model
    /// writes its own config.
    ///
    /// Populated for every test type. Empty for a version that declares no audio —
    /// an end-to-end, adversarial, or performance case (which may not declare the
    /// table at all), a non-audio asset-generation case, a `sfx-synth` case, and a
    /// full-stack case or jam that deliberately declares `packs = []`. A full-stack
    /// case or jam carrying **no** `[audio]` table at all instead receives
    /// [`DEFAULT_AUDIO_PACKS`], the pinned set the frozen versions predating the key
    /// were authored against.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub audio_packs: Vec<String>,
    /// Specs seeded for every variant (the common set).
    pub common_specs: Vec<SpecFile>,
    /// Starter workspace files seeded for every variant that does not override
    /// the workspace (the common set, enumerated from the manifest's `workspace`
    /// directory or its `[workspaces]` table), keyed by [engine](crate::engine)
    /// slug. Empty when the case declares no workspace. A variant may replace these
    /// with its own (see [`Variant::workspace`]); the effective set for a variant
    /// and engine is [`Self::workspace_for`].
    #[serde(default)]
    pub common_workspace: EngineWorkspaces,
    /// The command run inside the run container once the workspace and specs are
    /// seeded and before the harness starts (the manifest's `init`). `None` when
    /// the case declares no init step. See `test_cabinet_core::RunEngine::execute`.
    pub init: Option<String>,
    /// Paths to assets the model should use (seeded).
    pub asset_paths: Vec<PathBuf>,
    /// The Test Cabinet runtime libraries (`@clockwyrks/*` npm names) this
    /// case's build consumes, from the manifest's `packages` key. The case's
    /// workspace `package.json` declares each as a `file:` dependency resolving
    /// under [`TCAB_PACKAGES_DIR`]; the harness does not modify that file. Empty
    /// when the case declares none. Validated against [`SHIPPABLE_PACKAGES`], and
    /// that the shipped `package.json` declares each, at resolution.
    pub packages: Vec<String>,
    /// The [engines](crate::engine) a run of this version may be built on, each
    /// with the range of engine versions this version supports — from the
    /// manifest's `engines` list and its `[[engine]]` tables, in declared order.
    /// Never empty: a version declaring nothing resolves to exactly unbounded
    /// support for [`NONE_SLUG`], the engineless run. A version that declares any
    /// engine supports exactly what it declares, so one built against a runtime
    /// may leave the engineless run out.
    ///
    /// It is the **compatibility gate** a run's `--engine` is checked against
    /// (see [`Self::supports_engine`] for the slug and
    /// [`Self::engine_support`] for the range), before any container work — not a
    /// description of what any engine provides, which the engine documents from
    /// its own package.
    ///
    /// Always present on the wire: resolution never produces an empty set — it
    /// always leads with [`NONE_SLUG`] — so a payload without the field is one no
    /// resolution wrote, and reading it as the engineless case would quietly
    /// refuse every engine-backed run of that version. Each entry is written as a
    /// bare slug when it pins no range and as a table when it does.
    pub engines: Vec<EngineSupport>,
    /// The variants this case offers, in declared order. At least one is always
    /// present.
    pub variants: Vec<Variant>,
    /// Common reference views: rendered and seeded for **every** variant. A
    /// variant may declare additional references of its own (see
    /// [`Variant::references`]); the full set for a variant is
    /// [`Self::references_for`].
    pub common_references: Vec<ReferenceView>,
    /// Proof-of-implementation artifacts requested for **every** variant (the
    /// common set). A variant may declare additional proofs of its own (see
    /// [`Variant::proofs`]); the full set for a variant is [`Self::proofs_for`].
    pub common_proofs: Vec<ProofFile>,
    /// Opt-in validation checks declared by this version.
    pub checks: Vec<Check>,
    /// Reviewer checklist items declared for **every** variant (the common set). A
    /// variant may declare additional items of its own (see
    /// [`Variant::review_items`]); the full set for a variant is
    /// [`Self::review_items_for`]. **Not** seeded — reporter-side material a
    /// reviewer works through after playing a build.
    pub common_review_items: Vec<ReviewItem>,
    /// The **common** scoring domains this case declares, in declared order —
    /// those every variant is rated on. A reviewer rates each independently; the
    /// run's overall rating is the worst across the run variant's effective set.
    /// At least one common domain is always present. A variant may declare
    /// additional domains of its own (see [`Variant::domains`]); the effective set
    /// for a variant is [`Self::domains_for`].
    pub domains: Vec<Domain>,
    /// The held-out input cases a performance case's engine is scored against, in
    /// declared order. Non-empty for a performance case, empty for every other
    /// type. Not seeded — the secret scored set the validator reads from the case.
    #[serde(default)]
    pub cases: Vec<PerformanceCase>,
    /// Known-issue entries recorded for this version after it shipped (from the
    /// optional `errata.toml`), in declared order. Empty when the
    /// version has no errata. Not seeded — site-facing material shown on the case's
    /// Errata tab and, where relevant, to reviewers scoring a run of the version.
    /// The full set for a variant (case-wide entries plus that variant's own) is
    /// [`Self::errata_for`].
    #[serde(default)]
    pub errata: Vec<Erratum>,
}

impl TestCaseVersion {
    /// Whether runs of this version are **validator-rated**: their functional
    /// rating and score are decided entirely by the validators (see
    /// `test_cabinet_core::review::validator_domain_ratings`) and reviewers rate aesthetics
    /// only. True iff the version is on the [engine format](Self::engine_format)
    /// and is not a [game jam](TestType::GameJam) (a jam is graded, never
    /// validated). Every version on the legacy spelling behaves exactly as it
    /// always has: reviewer-rated, with no aesthetic channel.
    pub fn validator_rated(&self) -> bool {
        self.engine_format && self.test_type != TestType::GameJam
    }

    /// Resolve a variant by its slug.
    pub fn variant(&self, slug: &str) -> Result<&Variant, VariantNotFound> {
        self.variants
            .iter()
            .find(|variant| variant.slug == slug)
            .ok_or_else(|| VariantNotFound {
                slug: self.slug.clone(),
                version: self.version.clone(),
                variant: slug.to_string(),
            })
    }

    /// Whether a run of this version may select the engine `slug`.
    ///
    /// The gate a run's `--engine` is checked against, before any container is
    /// started (see
    /// `test_cabinet_core::Error::EngineUnsupportedForCase`).
    /// [`NONE_SLUG`] always passes, because resolution
    /// puts it in [`Self::engines`] whether the manifest declared it or not.
    ///
    /// The slug is not resolved against the catalogue here: this answers only what
    /// *this case* allows. An unknown slug is not supported by any case, so it
    /// answers `false` — but the caller resolves the engine first, so an
    /// unresolvable slug is reported as the unknown engine it is rather than as an
    /// unsupported one.
    pub fn supports_engine(&self, slug: &str) -> bool {
        self.engine_support(slug).is_some()
    }

    /// This version's support entry for the engine `slug` — its declared version
    /// range — or `None` when the version does not support that engine at all.
    ///
    /// The range half of the gate [`Self::supports_engine`] answers the slug half
    /// of. A caller that has already resolved the engine reads the entry once and
    /// asks it both questions, which is what keeps "unsupported engine" and "engine
    /// version outside the declared range" two distinct, separately-worded refusals
    /// rather than one vague one.
    pub fn engine_support(&self, slug: &str) -> Option<&EngineSupport> {
        self.engines.iter().find(|engine| engine.slug == slug)
    }

    /// The slugs of every engine this version supports, in resolved order.
    ///
    /// What a refusal names so the fix is one step, and what a listing shows. The
    /// ranges are deliberately left out: a caller that needs one asks
    /// [`Self::engine_support`] for the engine it is actually holding.
    pub fn engine_slugs(&self) -> Vec<String> {
        self.engines
            .iter()
            .map(|engine| engine.slug.clone())
            .collect()
    }

    /// The starter workspace files seeded for a variant on `engine`: the variant's
    /// own set when it overrides the workspace, otherwise the case's common
    /// workspace. Unlike specs, a variant's workspace **replaces** the common one
    /// rather than layering on top, so this returns one or the other rather than a
    /// concatenation.
    ///
    /// Keyed by engine because a starter project is written against a runtime, so a
    /// case supporting more than one engine ships one project per engine. Empty when
    /// the case seeds no workspace, and empty for an engine this case does not
    /// support — resolution guarantees an entry for every one it does.
    pub fn workspace_for<'a>(&'a self, variant: &'a Variant, engine: &str) -> &'a [WorkspaceFile] {
        variant
            .workspace
            .as_ref()
            .unwrap_or(&self.common_workspace)
            .get(engine)
    }

    /// The reference implementation for `variant` on the engine named by `engine`:
    /// the authored, *correct* build the case's "Reference" tab shows for that
    /// combination.
    ///
    /// Keyed by engine rather than by variant alone because the build a reference
    /// demonstrates differs under each engine — the engineless build writes its own
    /// frame loop, input, audio, and diagnostics, while the same game on an engine
    /// hands all four to the runtime. A variant that names a single directory has
    /// it standing for every supported engine, so this returns that one path for
    /// each; a variant that names a table gets that engine's own directory.
    ///
    /// `None` when the variant declares no reference implementation at all, or when
    /// `engine` is not one this case supports.
    pub fn reference_impl_for<'a>(&self, variant: &'a Variant, engine: &str) -> Option<&'a Path> {
        variant.reference_impls.get(engine).map(PathBuf::as_path)
    }

    /// The effective bounding volume for a run of `variant`: the variant's own
    /// `[voxel]` when it overrides the size, otherwise the case's common `[voxel]`.
    /// Like [`Self::workspace_for`], a variant's volume **replaces** the common
    /// one rather than layering on top. `None` for a non-voxel case (neither has a
    /// volume). Every consumer of the volume — seeding the tool config, validating
    /// the produced mesh, and rendering the brief/prompt templates — resolves it
    /// through this one accessor so all three agree on the size a run was given.
    pub fn voxel_for<'a>(&'a self, variant: &'a Variant) -> Option<&'a VoxelSpec> {
        variant.voxel.as_ref().or(self.voxel.as_ref())
    }

    /// The full set of specs seeded for a variant: the common specs followed by
    /// the variant's own additional specs. Resolution forbids two specs sharing a
    /// `dest`, so the order is stable and unambiguous.
    pub fn seeded_specs(&self, variant: &Variant) -> Vec<SpecFile> {
        self.common_specs
            .iter()
            .chain(variant.specs.iter())
            .cloned()
            .collect()
    }

    /// The full set of reference views for a variant: the common references
    /// followed by the variant's own additional references. These are the views
    /// rendered to screenshots, seeded as visual targets, and used as validation
    /// baselines when this variant runs. Resolution forbids two references sharing
    /// a `view`, so the order is stable and each view slug is unambiguous.
    pub fn references_for(&self, variant: &Variant) -> Vec<ReferenceView> {
        self.common_references
            .iter()
            .chain(variant.references.iter())
            .cloned()
            .collect()
    }

    /// The full set of proof-of-implementation artifacts requested for a variant:
    /// the common proofs followed by the variant's own. Resolution forbids two
    /// proofs sharing an `id`, so the order is stable and each id is unambiguous.
    pub fn proofs_for(&self, variant: &Variant) -> Vec<ProofFile> {
        self.common_proofs
            .iter()
            .chain(variant.proofs.iter())
            .cloned()
            .collect()
    }

    /// The full set of reviewer checklist items for a variant: the common items
    /// followed by the variant's own additional items, merged by id so a variant
    /// that reuses a common **category**'s id contributes its review items to that
    /// category rather than a duplicate group (see [`merge_review_items`]). A
    /// variant category with a fresh id is appended whole. These are what a
    /// reviewer works through for a run on this variant, and the id/verdict-id
    /// space is unambiguous because resolution forbids two items resolving to the
    /// same verdict id across common and variant.
    pub fn review_items_for(&self, variant: &Variant) -> Vec<ReviewItem> {
        let mut items = merge_review_items(&self.common_review_items, &variant.review_items);
        apply_score_exclusions(&mut items, &self.excluded_verdict_ids(variant));
        items
    }

    /// The reviewer checklist for a run of `variant` built on `engine`:
    /// [`Self::review_items_for`] with every point whose validator does not cover
    /// the run's engine removed (see [`ReviewValidation::covers`]).
    ///
    /// Three things are dropped. A whole item whose own `validation` does not cover
    /// `engine`. A sub-item whose `validation` does not cover `engine`, from its
    /// parent. And a parent that declared sub-items and has none left once its own
    /// are filtered, which would otherwise be a category with nothing under it.
    ///
    /// A dropped point is not part of the run at all: it is not driven, no verdict
    /// is recorded against it, it is not shown to the reviewer, and it contributes
    /// no weight to the score. That is what keeps a
    /// [validator-rated](Self::validator_rated) case coherent — every graded point a
    /// run carries is still decided by a validator, even when a point the case
    /// declares is meaningless under the engine the run was built on. Use
    /// [`Self::review_items_for`] instead wherever the question is what the case
    /// declares rather than what one run answers for: a catalog listing, a case page.
    pub fn review_items_for_engine(&self, variant: &Variant, engine: &str) -> Vec<ReviewItem> {
        let mut items = self.review_items_for(variant);
        items.retain_mut(|item| {
            if item
                .validation
                .as_ref()
                .is_some_and(|validation| !validation.covers(engine))
            {
                return false;
            }
            let declared_sub_items = !item.sub_items.is_empty();
            item.sub_items.retain(|sub| {
                sub.validation
                    .as_ref()
                    .is_none_or(|validation| validation.covers(engine))
            });
            !declared_sub_items || !item.sub_items.is_empty()
        });
        items
    }

    /// The review verdict ids excluded from scoring for a run of `variant`: the
    /// `review` link of every [`Erratum`] in scope (case-wide or scoped to this
    /// variant, per [`Self::errata_for`]) that sets [`Erratum::exclude_from_score`].
    /// Each id names a point (a review item id or a composite `<item>.<sub>`) that is
    /// still checked, driven, and shown for the version but no longer contributes to
    /// the score or gates the run (see [`Self::review_items_for`],
    /// `test_cabinet_core::review::score_checklist`, and
    /// [`crate::validation::DebugScriptResult`]). Empty for a
    /// variant with no scoring-excluding errata — the common case.
    pub fn excluded_verdict_ids(&self, variant: &Variant) -> HashSet<String> {
        self.errata_for(variant)
            .into_iter()
            .filter(|erratum| erratum.exclude_from_score)
            .filter_map(|erratum| erratum.review)
            .collect()
    }

    /// The full set of scoring domains a run of this variant is rated on: the
    /// case's common domains followed by the variant's own. This is the domain set
    /// the reviewer must rate and the overall rating is the worst across.
    /// Resolution forbids two domains sharing an `id`, so the order is stable and
    /// each id is unambiguous.
    pub fn domains_for(&self, variant: &Variant) -> Vec<Domain> {
        self.domains
            .iter()
            .chain(variant.domains.iter())
            .cloned()
            .collect()
    }

    /// The known-issue errata that apply to a run of `variant`: every case-wide
    /// erratum (those with no `variant` scope) plus the ones scoped to this
    /// variant's slug, in declared order. Used to surface a version's outstanding
    /// issues to a reviewer scoring a run on this variant.
    pub fn errata_for(&self, variant: &Variant) -> Vec<Erratum> {
        self.errata
            .iter()
            .filter(|erratum| match erratum.variant.as_deref() {
                Some(scope) => scope == variant.slug,
                None => true,
            })
            .cloned()
            .collect()
    }
}

/// Whether `slug` is a valid case slug: a non-empty kebab-case token of ASCII
/// lowercase letters and digits, with single hyphens only *between* segments (no
/// leading, trailing, or doubled hyphens).
///
/// A slug is used unescaped as a filesystem directory name (the catalog lays cases
/// out as `test-cases/<type>/<difficulty>/<slug>/<version>/` and the definition
/// store as `test-cases/<slug>/<version>/`) and as a URL path segment, so it is
/// constrained to a portable, unambiguous charset. Every existing case's folder name
/// already satisfies this.
pub fn is_valid_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.split('-').all(|segment| {
            !segment.is_empty()
                && segment
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        })
}

/// A comparable key for a version string so versions order component-wise.
///
/// Leading `v` is ignored and dot-separated numeric components are compared
/// numerically; any non-numeric tail is ignored for ordering. Versions that do
/// not parse sort before those that do.
///
/// Public so the backend store orders its ingested versions the same way this
/// (the authoritative filesystem catalog) does, rather than by directory mtime.
pub fn version_key(version: &str) -> Vec<u64> {
    version
        .trim_start_matches('v')
        .split('.')
        .map(|part| {
            let digits: String = part.chars().take_while(|c| c.is_ascii_digit()).collect();
            digits.parse().unwrap_or(0)
        })
        .collect()
}

/// Whether a hidden entry (a name beginning with `.`) is nonetheless **seeded**
/// into a run — and preserved when the backend ingests a version — rather than
/// skipped by the general dotfile rule.
///
/// Skipping dotfiles keeps repo metadata and host cruft (`.git`, the store's
/// `.tcab` sidecar, `.env`, editor/OS files) out of what a run receives. A short
/// allowlist of dotfiles a case legitimately ships is excepted:
/// - `.gitignore` — declares the build artifacts the published per-run source
///   repo must exclude (Rust's `target/`, a JS `node_modules/`, …).
/// - `.cargo` — Cargo build configuration (`.cargo/config.toml`, e.g. the default
///   `wasm32-unknown-unknown` build target) a Rust case's build and local
///   iteration rely on.
/// - `.prettierrc.json` and `.prettierignore` — the formatting configuration a
///   case's `format` toolchain command (`npx prettier --check .`) checks the
///   produced code against.
///
/// This is the single source of truth for both local seeding
/// (`collect_workspace_files`) and backend ingest (`copy_tree`), so the two
/// always seed the same set. Matching is by the entry's own name, so a `.cargo`
/// directory is descended into and its (non-hidden) contents seeded.
pub fn is_seeded_dotfile(name: &str) -> bool {
    matches!(
        name,
        ".gitignore" | ".cargo" | ".prettierrc.json" | ".prettierignore"
    )
}

/// Whether a relative path would escape the folder it is resolved against.
///
/// A path escapes if it is absolute, or if its `..` components ever rise above
/// its starting point. `.` components are ignored.
pub fn escapes_folder(rel: &Path) -> bool {
    use std::path::Component;

    let mut depth: i32 = 0;
    for component in rel.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => return true,
            Component::ParentDir => {
                depth -= 1;
                if depth < 0 {
                    return true;
                }
            }
            Component::CurDir => {}
            Component::Normal(_) => depth += 1,
        }
    }
    false
}
