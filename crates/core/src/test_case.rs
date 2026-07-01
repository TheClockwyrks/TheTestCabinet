//! Test case catalog: slugs, versions, and resolution.
//!
//! See `docs/testing/end-to-end/overview.md`. Test cases live under a top-level `test-cases/`
//! folder laid out as `test-cases/<slug>/<version>/`. Each version is
//! self-contained and immutable.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// The on-disk `test-case.toml` manifest for a single version.
///
/// This is the machine-readable declaration of what a version contains: the
/// specification and assets that are seeded, the reference views (rendered to
/// screenshots and seeded as visual targets), and the opt-in validation checks.
/// See `docs/testing/end-to-end/manifests.md`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
struct Manifest {
    /// Human-readable display name, surfaced on the site.
    name: String,
    /// Relative difficulty of the case, surfaced on the site (for example
    /// `easy`, `medium`, `hard`). **Required**.
    difficulty: String,
    /// Free-form classification tags surfaced on the site (for example
    /// `arcade`, `2d`). **Required** (may be an empty list).
    tags: Vec<String>,
    /// Optional one- or two-sentence abstract, surfaced on the site's test case
    /// cards. Authored inline as plain text (not a file) so it renders safely
    /// inside the card's link and stays deliberately short; the longer
    /// [`Self::description`] is shown on the detail page. **Not** seeded into runs.
    #[serde(default)]
    summary: Option<String>,
    /// Optional site-facing prose, relative to the version folder, pointing at a
    /// Markdown file (for example `description.md`). This is **not** seeded into
    /// runs; it exists only to describe the case on the site.
    #[serde(default)]
    description: Option<PathBuf>,
    /// The prompt template handed to the harness, relative to the version folder.
    /// Rendered through Handlebars with the run's workspace and seeded spec paths;
    /// see [`crate::prompt`].
    prompt: PathBuf,
    /// The maximum wall-clock duration, in **hours**, the harness session for
    /// this case is allowed before it is stopped. Authored in fractional hours
    /// (for example `0.5`) because every cap is long enough that seconds add no
    /// useful precision; it is normalized to whole seconds at resolution via
    /// [`crate::runtime_hours_to_seconds`]. Supplies the per-case default that a
    /// run can override (for example `tcab run --max-runtime`). Defaults to
    /// [`default_max_runtime_hours`] when omitted so a run is never unbounded.
    #[serde(default = "default_max_runtime_hours")]
    max_runtime_hours: f64,
    /// The test type this case belongs to. Defaults to
    /// [`TestType::EndToEnd`] so every existing manifest — none of which declares
    /// a `type` — keeps resolving unchanged. An asset-generation case declares
    /// `type = "asset-generation"`. The type selects which of the tables below are
    /// required and which are forbidden.
    #[serde(default, rename = "type")]
    test_type: TestType,
    /// Within an asset-generation case, whether the model draws a single sprite or
    /// a sprite sheet (a grid of animation frames). Defaults to
    /// [`AssetKind::Sprite`] so existing single-sprite manifests — none of which
    /// declares `asset_kind` — keep resolving unchanged. A sprite-sheet case
    /// declares `asset_kind = "sprite-sheet"` and a `[sheet]` table. Only valid for
    /// an asset-generation case; an explicit value on any other type is rejected.
    #[serde(default)]
    asset_kind: AssetKind,
    /// The frame grid and named animation sequences of a sprite-sheet case (the
    /// `[sheet]` table). Required for — and only for — `asset_kind =
    /// "sprite-sheet"`; forbidden otherwise.
    #[serde(default)]
    sheet: Option<ManifestSheet>,
    /// The bounding volume of a voxel case (the `[voxel]` table). Required for —
    /// and only for — the two voxel kinds (`asset_kind = "voxel-model"` /
    /// `"voxel-animation"`); forbidden otherwise.
    #[serde(default)]
    voxel: Option<ManifestVoxel>,
    /// The required rig — parts, joints, and clips — of a voxel-animation case (the
    /// `[model]` table). Required for — and only for — `asset_kind =
    /// "voxel-animation"`; forbidden otherwise.
    #[serde(default)]
    model: Option<ManifestModel>,
    /// The commands the validator runs to build the produced implementation as a
    /// static site (the `[build]` table). **Required for an end-to-end case** and
    /// **forbidden for any other type**, so its presence is validated against
    /// [`Self::test_type`] at resolution rather than defaulted.
    #[serde(default)]
    build: Option<ManifestBuild>,
    /// The image an asset-generation case's model draws on (the `[canvas]`
    /// table). Required for asset-generation, forbidden otherwise.
    #[serde(default)]
    canvas: Option<ManifestCanvas>,
    /// The drawing tool an asset-generation case exposes (the `[tool]` table).
    /// Required for asset-generation, forbidden otherwise.
    #[serde(default)]
    tool: Option<ManifestTool>,
    /// Where an asset-generation run's recorded action log is collected (the
    /// `[output]` table). Required for asset-generation, forbidden otherwise.
    #[serde(default)]
    output: Option<ManifestOutput>,
    /// The contract an adversarial case's wasm controller or a performance case's
    /// wasm engine must implement (the `[contract]` table). Required for both of
    /// those types, forbidden otherwise. Adversarial carries `world`/`action`
    /// per-tick schemas; performance carries `input`/`output` per-case schemas.
    #[serde(default)]
    contract: Option<ManifestContract>,
    /// The sandbox limits applied to an adversarial case's controllers (per tick)
    /// or a performance case's engine (per input case) — the `[sandbox]` table.
    /// Required for both of those types, forbidden otherwise.
    #[serde(default)]
    sandbox: Option<ManifestSandbox>,
    /// The simulation-loop configuration of an adversarial case (the
    /// `[simulation]` table). Required for adversarial, forbidden otherwise.
    #[serde(default)]
    simulation: Option<ManifestSimulation>,
    /// How an adversarial case pairs implementations into matches (the `[match]`
    /// table). Required for adversarial, forbidden otherwise. `match` is a Rust
    /// keyword, so the field is `r#match`.
    #[serde(default, rename = "match")]
    r#match: Option<ManifestMatch>,
    /// How an adversarial case renders a recorded match for browser playback (the
    /// `[replay]` table). Required for adversarial, forbidden otherwise.
    #[serde(default)]
    replay: Option<ManifestReplay>,
    /// Specs seeded for **every** variant. Each maps a `source` inside the
    /// version folder to a `dest` in the run's workspace. Declared as repeated
    /// `[[spec]]` tables.
    #[serde(default, rename = "spec")]
    specs: Vec<ManifestSpec>,
    /// Optional starter **workspace** directory, relative to the version folder.
    /// Its contents are copied into the root of the run's workspace before the
    /// specs are seeded, giving every run a baseline project to build on (for
    /// example a `package.json`). A variant may override it with its own
    /// directory (see [`ManifestVariant::workspace`]). `None` seeds no starter
    /// files.
    #[serde(default)]
    workspace: Option<PathBuf>,
    /// Optional **init** command, run inside the run container once the workspace
    /// and specs are seeded and before the harness starts. It can be a plain
    /// command (for example `npm install`) or invoke a file the workspace
    /// supplies. `None` runs no init step.
    #[serde(default)]
    init: Option<String>,
    /// Asset files or directories, relative to the version folder (seeded).
    #[serde(default)]
    assets: Vec<PathBuf>,
    /// The variants this case offers, each as a path to a standalone variant
    /// manifest (a `[[variant]]`-shaped [`ManifestVariant`] in its own file, by
    /// convention under `variants/`), relative to the version folder. Listed in
    /// order — the first is the default — and at least one must be declared. Each
    /// file seeds the common `specs` plus its own additional specs; exactly one
    /// variant runs per run. Splitting variants into their own files keeps the
    /// main manifest readable when a case carries several modes.
    #[serde(default)]
    variants: Vec<PathBuf>,
    /// Reference views. Each is either an HTML mockup rendered to a screenshot
    /// or a static image/video used as-is, seeded as a visual target; a rendered
    /// reference's source mockup is not seeded.
    #[serde(default)]
    reference: Vec<ManifestReference>,
    /// Proof-of-implementation artifacts the agent is asked to produce, declared
    /// for **every** variant. Each names a `dest` path the agent must write a
    /// screenshot or `.mp4` to; validation records whether it is present. Declared
    /// as repeated `[[proof]]` tables.
    #[serde(default)]
    proof: Vec<ManifestProof>,
    /// Opt-in validation checks. Only declared checks run.
    #[serde(default)]
    check: Vec<ManifestCheck>,
    /// Reviewer checklist items declared for **every** variant. Reviewer-facing
    /// and **not seeded**: they enumerate what a person must explicitly check
    /// after playing a build, so a case's major requirements are guaranteed to be
    /// verified by hand. Declared as repeated `[[review_item]]` tables.
    #[serde(default, rename = "review_item")]
    review_items: Vec<ManifestReviewItem>,
    /// Scoring domains the reviewer rates independently — for example a game's
    /// single-player and versus modes. The run's overall rating is the **worst**
    /// rating across all of them. At least one must be declared. Declared as
    /// repeated `[[domain]]` tables.
    #[serde(default, rename = "domain")]
    domains: Vec<ManifestDomain>,
    /// The held-out input cases a performance case's engine is scored against (the
    /// `[[case]]` tables). Each pairs an input instance with the answer a correct
    /// engine must produce. Required for — and only for — a performance case. The
    /// cases live in the version folder and are **not** seeded into runs (they are
    /// the secret scored set), unlike every other manifest path.
    #[serde(default, rename = "case")]
    cases: Vec<ManifestCase>,
}

/// The `[build]` table in the manifest: the commands the validator runs to turn
/// a produced implementation into the case's scored artifact. `install` and
/// `build` are required for every case that declares the table (an end-to-end
/// build emits a static site; an adversarial build emits a wasm controller
/// module). `module` names the wasm artifact and is required for — and only
/// valid on — an adversarial case, where the validator loads it into the sandbox.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestBuild {
    /// Command that installs dependencies (for example `npm ci`, which requires a
    /// committed lockfile).
    install: String,
    /// Command that produces the build (for example `npm run build`, or
    /// `cargo build --release --target wasm32-unknown-unknown`).
    build: String,
    /// The produced wasm controller module's path, relative to the run root.
    /// Required on an adversarial case (the validator loads it as the submission);
    /// an end-to-end build emits a static site and declares none.
    #[serde(default)]
    module: Option<PathBuf>,
}

/// The `[contract]` table of an adversarial or performance case: the interface
/// the model's wasm must implement. The schemas are the only channel between the
/// module and the game/oracle.
///
/// Adversarial and performance carry **different** schema pairs on the same
/// table, generalizing it rather than forking it: an adversarial controller reads
/// a per-tick `world` observation and returns a per-tick `action`, while a
/// performance engine reads a whole-scenario `input` and returns the whole
/// `output`. Each pair is `Option` so the two coexist on one struct and the
/// type-specific resolution requires exactly the right one.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestContract {
    /// The exported function invoked by the host — once per game tick for
    /// adversarial (for example `tick`), once per input case for performance (for
    /// example `simulate`).
    entry: String,
    /// Adversarial only: the JSON Schema of the per-tick observation passed to the
    /// controller, relative to the version folder. Seeded so the model can read it.
    #[serde(default)]
    world: Option<PathBuf>,
    /// Adversarial only: the JSON Schema of the actions the controller may return
    /// each tick, relative to the version folder. Seeded so the model can read it.
    #[serde(default)]
    action: Option<PathBuf>,
    /// Performance only: the JSON Schema of an input case handed to the engine,
    /// relative to the version folder. Seeded so the model can read it.
    #[serde(default)]
    input: Option<PathBuf>,
    /// Performance only: the JSON Schema of the answer the engine returns, relative
    /// to the version folder. Seeded so the model can read it.
    #[serde(default)]
    output: Option<PathBuf>,
}

/// The `[sandbox]` table of an adversarial or performance case: the limits applied
/// to every metered wasm invocation. Exceeding either fails the invocation.
///
/// Adversarial meters **per tick** (`fuel_per_tick`); performance meters **per
/// input case** (`fuel_limit`), where the fuel a correct engine consumes within
/// the ceiling is the recorded performance result. Each fuel field is `Option` so
/// the two coexist on one struct; resolution requires exactly the right one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
struct ManifestSandbox {
    /// Adversarial only: the wasmtime fuel ceiling for a single tick.
    #[serde(default)]
    fuel_per_tick: Option<u64>,
    /// Performance only: the wasmtime fuel ceiling for a whole input case. The
    /// engine runs the entire simulation in one metered call, so this is orders of
    /// magnitude larger than a per-tick budget.
    #[serde(default)]
    fuel_limit: Option<u64>,
    /// The linear-memory cap in bytes.
    max_memory_bytes: u64,
}

/// A `[[case]]` table of a performance case: one held-out input the engine is run
/// against and the answer a correct engine must produce.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestCase {
    /// The input instance fed to the engine, relative to the version folder. The
    /// host hands its contents in through the contract `entry`.
    input: PathBuf,
    /// The correct answer the engine's output is checked against, relative to the
    /// version folder. This is the reference oracle's `state` output (as produced
    /// by `lattice solve`); the validator compares the engine's per-snapshot
    /// checksums to it.
    expected: PathBuf,
}

/// The `[simulation]` table of an adversarial case: the faked timestep and the
/// hard tick cap that bound the loop.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
struct ManifestSimulation {
    /// The fixed, faked delta handed to the game logic each tick (milliseconds).
    timestep_ms: u32,
    /// Hard cap on match length; reaching it ends the match (a draw if tied).
    max_ticks: u32,
}

/// The `[match]` table of an adversarial case: how implementations are paired
/// into matches. Recorded faithfully, though the validator only runs the single
/// canonical match (lead decision 4).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestMatch {
    /// Controllers per match.
    participants: u32,
    /// How the field is paired (for example `round-robin`).
    structure: String,
    /// Matches played per pairing.
    rounds: u32,
}

/// The `[replay]` table of an adversarial case: the browser renderer fed the
/// recorded replay data for playback on the site.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestReplay {
    /// The browser renderer entry, relative to the version folder.
    renderer: PathBuf,
}

/// The `[canvas]` table of an asset-generation case: the fixed image the model
/// draws on. Fixing it keeps runs comparable, the way an end-to-end build
/// interface does.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestCanvas {
    /// Canvas width in pixels.
    width: u32,
    /// Canvas height in pixels.
    height: u32,
    /// Initial canvas state: `transparent` or a hex color.
    #[serde(default = "default_background")]
    background: String,
}

/// The `[tool]` table of an asset-generation case: the drawing binary and the
/// path it re-renders the current image to. The binary is the only channel for
/// drawing; its `--help` is the contract, so no operations schema is seeded.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestTool {
    /// The drawing binary available in the run environment: `draw` for a single
    /// sprite, `draw-sheet` for a sprite sheet.
    binary: String,
    /// The run-workspace-relative path the binary re-renders the current image to
    /// after each call, so the model can read its progress. For a sprite sheet it
    /// is a `{frame}` template (for example `frames/{frame}.png`), since every
    /// frame is a separate file.
    preview: PathBuf,
}

/// The `[output]` table of an asset-generation case: where the recorded action
/// log — the authoritative output of the run — is collected.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestOutput {
    /// The run-workspace-relative path of the ordered record of every operation
    /// the model issued. For a sprite sheet it is a `{frame}` template (for
    /// example `frames/{frame}.actions.json`): every frame records its own log.
    actions: PathBuf,
}

/// The `[sheet]` table of a sprite-sheet asset-generation case: the frames the
/// model draws — each a completely separate file the size of the `[canvas]` — and
/// the named sequences a reviewer plays back.
///
/// A sheet declares its frames explicitly (each with the index it is written to);
/// the number of frames is just how many are declared. A sequence plays an ordered
/// list of those indices.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestSheet {
    /// The frames this sheet declares, as repeated `[[sheet.frame]]` tables. At
    /// least one is required; indices must be unique.
    #[serde(default, rename = "frame")]
    frames: Vec<ManifestSheetFrame>,
    /// The named animation sequences, declared as repeated `[[sheet.sequence]]`
    /// tables. At least one is required.
    #[serde(default)]
    sequence: Vec<ManifestSheetSequence>,
}

/// A single `[[sheet.frame]]` entry: one frame of the sheet and the index it is
/// written to.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestSheetFrame {
    /// The frame index this frame is written to (passed as `draw-sheet --frame`).
    /// Unique within the sheet; sequences reference these indices.
    index: u32,
}

/// A single `[[sheet.sequence]]` entry: one named animation a reviewer can play
/// back, as an ordered list of row-major frame indices and a playback rate.
#[derive(Debug, Clone, PartialEq, Deserialize)]
struct ManifestSheetSequence {
    /// Stable slug naming this sequence (for example `walk-right`).
    slug: String,
    /// Human-readable display name. Defaults to a humanized form of `slug`.
    #[serde(default)]
    name: Option<String>,
    /// The ordered row-major frame indices this sequence plays. Must be non-empty
    /// and every index must be a valid cell (`< columns * rows`).
    frames: Vec<u32>,
    /// Playback rate in frames per second. Must be greater than zero.
    fps: f64,
}

// `ManifestSheet` derives `Eq` (so the parent `Manifest` can), but a sequence's
// `fps` is the only float. It is an exact TOML literal, only ever compared, never
// arithmetic'd — so a manual `Eq` is sound, matching how `CheckAction` treats its
// float coordinates.
impl Eq for ManifestSheetSequence {}

/// The `[voxel]` table of a voxel asset-generation case: the bounding volume the
/// model sculpts into — the 3D analog of [`ManifestCanvas`]. `background` is the
/// clear color behind the rasterized isometric preview PNG (the voxel volume
/// itself always starts empty).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestVoxel {
    /// Volume extent along x, in voxels.
    width: u32,
    /// Volume extent along y (up), in voxels.
    height: u32,
    /// Volume extent along z, in voxels.
    depth: u32,
    /// Preview clear color: `transparent` or a hex color.
    #[serde(default = "default_background")]
    background: String,
}

/// The `[model]` table of a voxel-animation case: the **required** rig the model
/// must produce — named parts in a parent/child hierarchy, the named joints a
/// consuming game (or an auto-play clip) drives, and the auto-play clips that
/// animate any auto-driven joints. These are the stable, game-facing contract and
/// the scoring targets; at run time the model may add further parts, joints, and
/// clips of its own (recorded in `rig.json`) beyond what this table requires.
#[derive(Debug, Clone, PartialEq, Deserialize)]
struct ManifestModel {
    /// The declared parts, as repeated `[[model.part]]` tables. At least one is
    /// required; the first is the root.
    #[serde(default, rename = "part")]
    part: Vec<ManifestPart>,
    /// The declared joints, as repeated `[[model.joint]]` tables.
    #[serde(default, rename = "joint")]
    joint: Vec<ManifestJoint>,
    /// The declared auto-play clips, as repeated `[[model.clip]]` tables — one per
    /// auto-driven joint.
    #[serde(default, rename = "clip")]
    clip: Vec<ManifestClip>,
    /// The predetermined, named animations, as repeated `[[model.animation]]`
    /// tables — authored playback aids the viewer offers as play buttons.
    #[serde(default, rename = "animation")]
    animation: Vec<ManifestAnimation>,
}

// `ManifestModel` owns joints and clips that carry `f64` fields, so it takes a
// manual `Eq` for the same reason as `ManifestSheetSequence` above.
impl Eq for ManifestModel {}

/// A single `[[model.part]]` entry: one named voxel component of the rig and its
/// attachment point in its parent's local coordinates.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestPart {
    /// Stable name of this part (for example `chassis`, `turret`).
    name: String,
    /// The parent part this one is attached to, or omitted for the root part.
    #[serde(default)]
    parent: Option<String>,
    /// The attachment point in the parent's local voxel coordinates (`[x, y, z]`).
    /// Defaults to the origin `[0, 0, 0]` when omitted.
    #[serde(default)]
    pivot: Option<[i64; 3]>,
}

/// A single `[[model.joint]]` entry: one named degree of freedom on a part. `kind`
/// (`rotation`/`translation`), `axis` (`x`/`y`/`z`), and `drive` (`caller`/`auto`)
/// are kept as strings here and parsed at resolution.
#[derive(Debug, Clone, PartialEq, Deserialize)]
struct ManifestJoint {
    /// Stable name of this joint; the parameter a game addresses.
    name: String,
    /// The part this joint moves (a declared `[[model.part]]` name).
    part: String,
    /// Whether this joint rotates or translates the part (`rotation`/`translation`).
    kind: String,
    /// The axis the joint acts about (rotation) or along (translation): `x`/`y`/`z`.
    axis: String,
    /// The joint origin in the part's local voxel coordinates (`[x, y, z]`).
    pivot: [i64; 3],
    /// Minimum value: radians for a rotation, voxel units for a translation.
    min: f64,
    /// Maximum value.
    max: f64,
    /// The rest/default value, within `[min, max]`.
    rest: f64,
    /// Who drives this joint: `caller` (a game) or `auto` (an auto-play clip).
    drive: String,
}

// `ManifestJoint` carries `f64` range fields, so it takes a manual `Eq` for the
// same reason as `ManifestSheetSequence` above.
impl Eq for ManifestJoint {}

/// A single `[[model.clip]]` entry: the looping auto-play timeline for one
/// auto-driven joint. Each keyframe is an inline `[t_ms, value]` pair.
#[derive(Debug, Clone, PartialEq, Deserialize)]
struct ManifestClip {
    /// The joint this clip animates (a declared `[[model.joint]]` name whose
    /// `drive` is `auto`).
    joint: String,
    /// The clip period in milliseconds (one full loop).
    period_ms: u32,
    /// Whether the clip loops (true) or holds the last keyframe (false). `loop` is
    /// a Rust keyword, so the field is `r#loop`.
    r#loop: bool,
    /// The keyframes, each an inline `[t_ms, value]` pair, in time order.
    keyframes: Vec<[f64; 2]>,
}

// `ManifestClip` carries `f64` keyframe values, so it takes a manual `Eq` for the
// same reason as `ManifestSheetSequence` above.
impl Eq for ManifestClip {}

/// A single `[[model.animation]]` entry: one named, predetermined animation and its
/// per-joint tracks (each a nested `[[model.animation.track]]` table).
#[derive(Debug, Clone, PartialEq, Deserialize)]
struct ManifestAnimation {
    /// Stable, unique name shown in the viewer.
    name: String,
    /// The period in milliseconds (one full loop across every track).
    period_ms: u32,
    /// Whether the animation loops (true) or holds the last pose (false). `loop` is
    /// a Rust keyword, so the field is `r#loop`.
    r#loop: bool,
    /// The per-joint tracks, as repeated `[[model.animation.track]]` tables.
    #[serde(default, rename = "track")]
    track: Vec<ManifestAnimationTrack>,
}

// `ManifestAnimation` bottoms out in `f64` keyframe values, so it takes a manual
// `Eq` for the same reason as `ManifestClip` above.
impl Eq for ManifestAnimation {}

/// A single `[[model.animation.track]]` entry: the keyframes that drive one joint
/// over its animation's timeline. Each keyframe is an inline `[t_ms, value]` pair,
/// mirroring `[[model.clip]]`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
struct ManifestAnimationTrack {
    /// The joint this track drives (a declared `[[model.joint]]` name).
    joint: String,
    /// The keyframes, each an inline `[t_ms, value]` pair, in time order.
    keyframes: Vec<[f64; 2]>,
}

// `ManifestAnimationTrack` carries `f64` keyframe values, so it takes a manual `Eq`.
impl Eq for ManifestAnimationTrack {}

/// A single spec mapping in the manifest (`[[spec]]` or a variant's `spec`
/// array): a `source` file inside the version folder seeded to a `dest` path in
/// the run's workspace.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestSpec {
    /// Source path, relative to the version folder.
    source: PathBuf,
    /// Destination path, relative to the run's workspace root. Optional: when
    /// omitted it defaults to [`spec_default_dest`] of the `source` (the source
    /// path with a trailing `.hbs` template extension removed), since the seeded
    /// path so rarely differs from the source that stating both is just noise.
    #[serde(default)]
    dest: Option<PathBuf>,
}

/// A standalone variant manifest, parsed from its own file listed in the case
/// manifest's `variants` array (by convention `variants/<slug>.toml`). Its
/// top-level tables are this struct's fields; every path it names is resolved
/// relative to the **version folder**, not the variant file's location, so a
/// variant references `specs/modes/gyre.md` exactly as the main manifest would.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestVariant {
    /// The stable slug naming this variant (recorded in run records).
    slug: String,
    /// Human-readable display name. Defaults to a humanized form of `slug`.
    name: Option<String>,
    /// Optional site-facing prose describing what the variant changes.
    #[serde(default)]
    description: Option<String>,
    /// Specs this variant seeds in addition to the common `specs`. Declared as a
    /// `spec` array of inline `{ source, dest }` tables.
    #[serde(default, rename = "spec")]
    specs: Vec<ManifestSpec>,
    /// Optional starter **workspace** directory for this variant, relative to the
    /// version folder. When present it **replaces** the case's common workspace
    /// for runs of this variant (it is not additive), so a variant can ship a
    /// different baseline project. `None` falls back to the common workspace.
    #[serde(default)]
    workspace: Option<PathBuf>,
    /// Reference views this variant declares in addition to the common
    /// references. Declared as a `reference` array of inline `{ view, path }`
    /// tables. A variant-specific reference lets one view (for example the title
    /// menu) differ per variant; its view slug must not collide with a common
    /// reference or another of this variant's references.
    #[serde(default, rename = "reference")]
    references: Vec<ManifestReference>,
    /// Proof-of-implementation artifacts this variant declares in addition to the
    /// common ones. Declared as a `proof` array of inline `{ id, name, dest }`
    /// tables; an id must not collide with a common proof or another of this
    /// variant's proofs.
    #[serde(default, rename = "proof")]
    proofs: Vec<ManifestProof>,
    /// Reviewer checklist items this variant declares in addition to the common
    /// items. Declared as repeated `[[review_item]]` tables in the variant file.
    /// A variant-specific item lets a mode-only requirement be checked only when
    /// that variant runs; its id must not collide with a common item or another
    /// of this variant's items.
    #[serde(default, rename = "review_item")]
    review_items: Vec<ManifestReviewItem>,
    /// Scoring domains this variant declares in addition to the case's common
    /// [`Manifest::domains`]. Declared as repeated `[[domain]]` tables in the
    /// variant file. A variant-specific domain lets a mode that introduces a whole
    /// new axis of judgement (say a Pong "gyre" mode) be rated on its own, rather
    /// than forcing every domain to be declared case-wide even when it applies to
    /// one variant. Its id must not collide with a common domain or another of
    /// this variant's domains; the variant's effective set is common ∪ these.
    #[serde(default, rename = "domain")]
    domains: Vec<ManifestDomain>,
}

/// A single `[[reference]]` entry in the manifest.
///
/// A reference is **either** an HTML mockup rendered to a screenshot (`path`) or
/// a static image/video served as-is (`media`). Exactly one of the two must be
/// set; resolution rejects declaring both or neither.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestReference {
    /// The view slug.
    view: String,
    /// The HTML mockup source path, relative to the version folder. Rendered to a
    /// PNG screenshot; the source is never seeded. Mutually exclusive with
    /// [`Self::media`].
    #[serde(default)]
    path: Option<PathBuf>,
    /// A static image or `.mp4` file path, relative to the version folder, used as
    /// the reference as-is (not rendered). Lets the "expected" side of a review
    /// item be a video or a prepared still. Mutually exclusive with [`Self::path`].
    #[serde(default)]
    media: Option<PathBuf>,
}

/// A single `[[proof]]` entry in the manifest (or a variant's `proof` array): one
/// proof-of-implementation artifact the agent is asked to produce.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestProof {
    /// Stable slug identifying this proof; recorded in the run's validation and
    /// used to pair a review item with the submitted media.
    id: String,
    /// Human-readable display name. Defaults to a humanized form of `id`.
    name: Option<String>,
    /// The path, relative to the run's workspace root, the agent must write the
    /// proof to. The media kind (image or video) is inferred from its extension.
    /// The spec that requests the proof must reference this same path.
    dest: PathBuf,
}

/// A single `[[check]]` entry in the manifest.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestCheck {
    /// The view slug this check records its result under.
    view: String,
    /// Human-readable display name for the check. Defaults to a humanized form
    /// of `view` (for example `game-over` becomes `Game Over`) when omitted.
    name: Option<String>,
    /// The reference view whose rendered screenshot is the comparison baseline.
    /// Defaults to `view` when omitted.
    reference: Option<String>,
    /// The actions that drive the implementation into the view before capture.
    /// Empty means the view is whatever the implementation shows on load.
    #[serde(default)]
    actions: Vec<CheckAction>,
}

/// A single `[[review_item]]` entry in the manifest (or a variant's
/// `review_item` array): one item a reviewer must explicitly check.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestReviewItem {
    /// Stable slug identifying this item; recorded with the reviewer's verdict.
    id: String,
    /// A short heading shown above the item in the reviewer UI (a synthesized
    /// number is prefixed at display time).
    title: String,
    /// The prose a reviewer reads — what to check.
    text: String,
    /// Optional reference view to show the reviewer as the **expected** target for
    /// this item. Must name a reference that resolves for the item's variant.
    #[serde(default)]
    reference: Option<String>,
    /// Optional proof id whose **submitted** media is shown to the reviewer for
    /// this item. Must name a proof that resolves for the item's variant.
    #[serde(default)]
    proof: Option<String>,
    /// Optional sprite-sheet sequence slugs this item is about, surfaced to the
    /// reviewer as the relevant animations to play. Each must name a declared
    /// `[[sheet.sequence]]`; only valid for a sprite-sheet asset-generation case.
    #[serde(default)]
    sequences: Vec<String>,
    /// Optional sprite-sheet frame indices this item is about, surfaced to the
    /// reviewer alongside any referenced sequences' frames. Each must be a declared
    /// `[[sheet.frame]]`; only valid for a sprite-sheet asset-generation case.
    #[serde(default)]
    frames: Vec<u32>,
    /// How many points this item is worth toward the run's score (an academic
    /// test's per-question marks). **Required** and must be greater than zero.
    weight: u32,
    /// Optional scoring domain this item belongs to. Must name a declared
    /// `[[domain]]`. `None` for a general item that belongs to no single domain.
    #[serde(default)]
    domain: Option<String>,
}

/// A single `[[domain]]` entry in the manifest: one scoring domain a reviewer
/// rates independently.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestDomain {
    /// Stable slug identifying this domain; recorded with the reviewer's
    /// per-domain rating.
    id: String,
    /// Human-readable display name. Defaults to a humanized form of `id`.
    name: Option<String>,
    /// A brief description of what the domain covers, shown to the reviewer so
    /// they know what they are rating. **Required**.
    description: String,
}

/// The manifest file name expected in every version folder.
const MANIFEST_FILE: &str = "test-case.toml";

/// The run-workspace-relative path the orchestrator seeds an asset-generation
/// run's canvas configuration to. The drawing binary reads it from here by
/// default, so a model's drawing operations need no canvas flags.
pub const ASSET_CONFIG_DEST: &str = "draw.config.json";

/// The run-workspace-relative path the orchestrator seeds a static voxel
/// (`asset_kind = "voxel-model"`) run's volume configuration to. The `voxel`
/// binary reads it from here by default.
pub const VOXEL_CONFIG_DEST: &str = "voxel.config.json";

/// The run-workspace-relative path the orchestrator seeds an animated voxel
/// (`asset_kind = "voxel-animation"`) run's rig/volume configuration to. The
/// `voxel-anim` binary reads it from here by default.
pub const VOXEL_ANIM_CONFIG_DEST: &str = "voxel-anim.config.json";

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
/// Today four types exist in code: the original [`Self::EndToEnd`] (build a
/// working program), [`Self::AssetGeneration`] (drive a drawing tool toward a
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
}

impl AssetKind {
    /// Whether this kind is one of the two 3D voxel kinds (as opposed to a 2D
    /// sprite kind). Voxel kinds declare a `[voxel]` table instead of `[canvas]`.
    pub fn is_voxel(self) -> bool {
        matches!(self, Self::VoxelModel | Self::VoxelAnimation)
    }

    /// The run-workspace-relative path the orchestrator seeds this kind's tool
    /// configuration to: [`ASSET_CONFIG_DEST`] for the 2D `draw`/`draw-sheet`
    /// kinds, [`VOXEL_CONFIG_DEST`] / [`VOXEL_ANIM_CONFIG_DEST`] for the two voxel
    /// kinds. Shared by manifest path-claiming and seeding so they agree.
    pub fn config_dest(self) -> &'static str {
        match self {
            Self::Sprite | Self::SpriteSheet => ASSET_CONFIG_DEST,
            Self::VoxelModel => VOXEL_CONFIG_DEST,
            Self::VoxelAnimation => VOXEL_ANIM_CONFIG_DEST,
        }
    }
}

/// The kind of a piece of media — used for both reference media and proof
/// artifacts so a UI knows whether to render an `<img>` or a `<video>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum MediaKind {
    /// A still image (`png`, `jpg`, `jpeg`, `webp`, `gif`).
    Image,
    /// A video clip (`mp4`).
    Video,
}

impl MediaKind {
    /// Infer the media kind from a path's file extension. Returns `None` for an
    /// extension that is neither a supported image nor a supported video.
    pub fn from_path(path: &Path) -> Option<Self> {
        let ext = path.extension()?.to_str()?.to_ascii_lowercase();
        match ext.as_str() {
            "png" | "jpg" | "jpeg" | "webp" | "gif" => Some(Self::Image),
            "mp4" => Some(Self::Video),
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
/// clear color behind the rasterized isometric preview PNG (the voxel volume
/// itself always starts empty); it is kept as the manifest string — validated to
/// parse — so the resolved version stays serializable without depending on the
/// voxel library's color type, and the validator re-parses it when it regenerates.
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

/// The resolved `[model]` of a voxel-animation case: the rig the model must
/// produce — named parts in a parent/child hierarchy and the named joints a
/// consuming game (or an auto-play clip) drives. This is the **required** contract
/// (the scoring targets and the stable, game-facing joint interface); at run time
/// the model may add further parts and joints of its own, which are recorded in
/// the produced `rig.json` but are not required here. Carried into the run record
/// (see [`crate::validation::VoxelGenResult`]) so the review and viewer UIs know
/// the joint interface without a separate catalog lookup.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ModelSpec {
    /// The declared parts, in declared order. The first is the root (its `parent`
    /// is `None`); every other part names a declared parent.
    pub parts: Vec<PartSpec>,
    /// The declared joints, in declared order. Each names a declared part.
    pub joints: Vec<JointSpec>,
    /// The predetermined, named animations the case authors so a reviewer can watch
    /// the rig perform a motion without driving its joints by hand. Empty when the
    /// case declares none. These are authored playback aids — not part of the rig
    /// the model produces — so they ride only on the declared model spec, never on
    /// the produced `rig.json`.
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
/// runtime, e.g. `turret_yaw`) or **auto-play** (the model defines the motion as a
/// looping set of keyframes). Rotations are in radians about [`Self::axis`] through
/// [`Self::pivot`]; translations are in voxel units along the axis.
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
    /// Who drives this joint: a caller (a game) or an auto-play clip.
    pub drive: DriveKindSpec,
    /// The auto-play clip, present only when [`Self::drive`] is
    /// [`DriveKindSpec::Auto`]; `None` for a caller-driven joint.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub auto: Option<AutoPlaySpec>,
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
    /// The joint animates itself from a looping [`AutoPlaySpec`] clip.
    Auto,
}

/// The auto-play clip of an [`DriveKindSpec::Auto`] joint: a looping timeline of
/// keyframes the viewer (and a consuming game) plays back automatically.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct AutoPlaySpec {
    /// The keyframes, in time order, sampled over one period.
    pub keyframes: Vec<KeyframeSpec>,
    /// The clip period in milliseconds (one full loop).
    pub period_ms: u32,
    /// Whether the clip loops (true) or holds the last keyframe (false).
    pub looping: bool,
}

/// A resolved keyframe within an [`AutoPlaySpec`]: a joint value at a time offset.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct KeyframeSpec {
    /// Time offset from the start of the clip, in milliseconds (`0..=period_ms`).
    pub t_ms: u32,
    /// The joint value at this time.
    pub value: f64,
}

// Manual `Eq` for the two float-bearing rig types, for the same reason as
// `JointSpec` above.
impl Eq for AutoPlaySpec {}
impl Eq for KeyframeSpec {}

/// A named, predetermined animation of a [`ModelSpec`]: a choreographed clip the
/// case authors so a reviewer can watch the rig perform a motion (a turret sweep, a
/// recoil, a walk cycle) without driving its joints by hand.
///
/// An animation drives one or more of the rig's **caller** joints over a shared
/// timeline: each [track](AnimationTrackSpec) supplies the keyframes for one joint,
/// and together they play as a single loop. This is distinct from a joint's own
/// [`AutoPlaySpec`] clip (which animates a single `auto` joint the model itself
/// defined): an animation is authored by the case, spans several joints, and is
/// offered in the viewer as a play button alongside the manual joint sliders.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct AnimationSpec {
    /// Stable, unique name shown in the viewer (for example `turret_sweep`).
    pub name: String,
    /// The period in milliseconds — one full loop across every track.
    pub period_ms: u32,
    /// Whether the animation loops (true) or plays once and holds the last pose.
    pub looping: bool,
    /// The per-joint tracks, one per joint the animation drives. At least one.
    pub tracks: Vec<AnimationTrackSpec>,
}

/// One track of an [`AnimationSpec`]: the keyframes that drive a single joint over
/// the animation's timeline.
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
    /// Starter workspace files for this variant, when it overrides the case's
    /// common workspace. `Some` **replaces** the common workspace for this
    /// variant (it is not additive); `None` falls back to
    /// [`TestCaseVersion::common_workspace`]. Resolve the effective set for a
    /// variant with [`TestCaseVersion::workspace_for`].
    pub workspace: Option<Vec<WorkspaceFile>>,
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
    /// than zero. A run earns this item's weight when the reviewer marks it
    /// `pass`, and none when they mark it `fail`; the run's score is the earned
    /// weight over the total declared weight (see [`crate::review::score`]).
    pub weight: u32,
    /// The scoring [`Domain`] this item belongs to (by id), or `None` for a
    /// general item that belongs to no single domain. Used to group the score
    /// breakdown by domain in the reviewer and verdict UIs.
    pub domain: Option<String>,
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

// `Check` derives `Eq`, so its actions must too; the `Click` coordinates are the
// only floats. They originate as exact TOML literals and are only ever compared,
// never arithmetic'd, so treating them as `Eq` is sound here.
impl Eq for CheckAction {}

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
    /// The version folder on the host: `test-cases/<slug>/<version>/`.
    pub root: PathBuf,
    /// Host path to the prompt template handed to the harness. Rendered through
    /// Handlebars with the run's workspace and seeded spec paths.
    pub prompt_path: PathBuf,
    /// The maximum wall-clock duration, in seconds, the harness session is
    /// allowed before it is stopped. Normalized from the manifest's
    /// `max_runtime_hours` at resolution via [`crate::runtime_hours_to_seconds`].
    /// This is the per-case default; a run may override it (see
    /// [`crate::RunRequest::max_runtime_override`]). Always positive, so a run is
    /// never unbounded.
    pub max_runtime_seconds: u64,
    /// The test type this case belongs to, the discriminator validation and the
    /// run record branch on.
    #[serde(default)]
    pub test_type: TestType,
    /// The commands the validator runs to build the produced implementation into
    /// a served static site (from the manifest's `[build]` table). `Some` for an
    /// end-to-end case, `None` for any other type. Kept as a top-level optional
    /// field (rather than nested under a type enum) so an end-to-end version's
    /// serialized shape is unchanged apart from the new discriminator.
    #[serde(default)]
    pub build: Option<BuildCommands>,
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
    /// The frame grid and named sequences of a sprite-sheet case. `Some` only when
    /// [`Self::asset_kind`] is [`AssetKind::SpriteSheet`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet: Option<SheetSpec>,
    /// The bounding volume a voxel asset-generation case's model draws into. `Some`
    /// only for the two voxel kinds ([`AssetKind::VoxelModel`] /
    /// [`AssetKind::VoxelAnimation`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voxel: Option<VoxelSpec>,
    /// The required rig (parts + joints) of a voxel-animation case. `Some` only
    /// when [`Self::asset_kind`] is [`AssetKind::VoxelAnimation`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<ModelSpec>,
    /// Specs seeded for every variant (the common set).
    pub common_specs: Vec<SpecFile>,
    /// Starter workspace files seeded for every variant that does not override
    /// the workspace (the common set, enumerated from the manifest's `workspace`
    /// directory). Empty when the case declares no workspace. A variant may
    /// replace these with its own (see [`Variant::workspace`]); the effective set
    /// for a variant is [`Self::workspace_for`].
    pub common_workspace: Vec<WorkspaceFile>,
    /// The command run inside the run container once the workspace and specs are
    /// seeded and before the harness starts (the manifest's `init`). `None` when
    /// the case declares no init step. See [`crate::RunEngine::execute`].
    pub init: Option<String>,
    /// Paths to assets the model should use (seeded).
    pub asset_paths: Vec<PathBuf>,
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
}

impl TestCaseVersion {
    /// Resolve a variant by its slug.
    pub fn variant(&self, slug: &str) -> Result<&Variant> {
        self.variants
            .iter()
            .find(|variant| variant.slug == slug)
            .ok_or_else(|| Error::VariantNotFound {
                slug: self.slug.clone(),
                version: self.version.clone(),
                variant: slug.to_string(),
            })
    }

    /// The starter workspace files seeded for a variant: the variant's own set
    /// when it overrides the workspace, otherwise the case's common workspace.
    /// Unlike specs, a variant's workspace **replaces** the common one rather
    /// than layering on top, so this returns one or the other rather than a
    /// concatenation.
    pub fn workspace_for<'a>(&'a self, variant: &'a Variant) -> &'a [WorkspaceFile] {
        variant
            .workspace
            .as_deref()
            .unwrap_or(&self.common_workspace)
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
    /// followed by the variant's own additional items. These are what a reviewer
    /// must work through for a run on this variant. Resolution forbids two items
    /// sharing an `id`, so the order is stable and each id is unambiguous.
    pub fn review_items_for(&self, variant: &Variant) -> Vec<ReviewItem> {
        self.common_review_items
            .iter()
            .chain(variant.review_items.iter())
            .cloned()
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
}

/// Resolves test case slugs and versions against an on-disk catalog.
///
/// The catalog is the `test-cases/` directory laid out as
/// `test-cases/<slug>/<version>/`.
#[derive(Debug, Clone)]
pub struct TestCaseCatalog {
    /// Root of the catalog (the `test-cases/` directory).
    root: PathBuf,
}

impl TestCaseCatalog {
    /// Open a catalog rooted at the given `test-cases/` directory.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// The catalog root directory.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// List every test case slug in the catalog, each with its versions newest
    /// first. Slugs with no version folders are skipped.
    pub fn list(&self) -> Result<Vec<TestCase>> {
        let mut cases = Vec::new();
        for slug in read_dir_names(&self.root)? {
            let versions = self.versions(&slug)?;
            if !versions.is_empty() {
                cases.push(TestCase { slug, versions });
            }
        }
        cases.sort_by(|a, b| a.slug.cmp(&b.slug));
        Ok(cases)
    }

    /// List the versions available for a slug, newest first.
    pub fn versions(&self, slug: &str) -> Result<Vec<String>> {
        let slug_dir = self.root.join(slug);
        if !slug_dir.is_dir() {
            return Err(Error::TestCaseNotFound {
                slug: slug.to_string(),
            });
        }
        let mut versions = read_dir_names(&slug_dir)?;
        // Newest first. Versions are compared component-wise so `v1.10.0` sorts
        // after `v1.9.0` rather than lexically before it.
        versions.sort_by_key(|v| std::cmp::Reverse(version_key(v)));
        Ok(versions)
    }

    /// Resolve an exact `<slug>@<version>` into a [`TestCaseVersion`], reading
    /// its manifest and validating that it is self-contained.
    pub fn resolve(&self, slug: &str, version: &str) -> Result<TestCaseVersion> {
        let slug_dir = self.root.join(slug);
        if !slug_dir.is_dir() {
            return Err(Error::TestCaseNotFound {
                slug: slug.to_string(),
            });
        }
        let root = slug_dir.join(version);
        if !root.is_dir() {
            return Err(Error::TestCaseVersionNotFound {
                slug: slug.to_string(),
                version: version.to_string(),
            });
        }

        let manifest = self.read_manifest(slug, version, &root)?;
        let invalid = |detail: String| Error::InvalidTestCase {
            slug: slug.to_string(),
            version: version.to_string(),
            detail,
        };

        // Every declared path must stay inside the version folder, keeping the
        // version self-contained.
        let resolve_inside = |rel: &Path, kind: &str| -> Result<PathBuf> {
            if escapes_folder(rel) {
                return Err(invalid(format!(
                    "{kind} path `{}` escapes the version folder",
                    rel.display()
                )));
            }
            Ok(root.join(rel))
        };

        // The prompt template is required. It is handed to the harness in
        // rendered form rather than copied into the run, but it is validated to
        // exist and to stay inside the version folder like every other path.
        let prompt_path = resolve_inside(&manifest.prompt, "prompt")?;
        if !prompt_path.is_file() {
            return Err(invalid(format!(
                "prompt `{}` does not exist",
                manifest.prompt.display()
            )));
        }

        // The runtime cap bounds the harness session so a run can never continue
        // unbounded. It is authored in hours; a non-positive or non-finite value
        // (zero, negative, NaN, infinity) would not yield a usable bound, so it is
        // rejected rather than silently accepted.
        if !(manifest.max_runtime_hours.is_finite() && manifest.max_runtime_hours > 0.0) {
            return Err(invalid(
                "max_runtime_hours must be a positive number".to_string(),
            ));
        }

        // The test type selects which tables are required and which are
        // forbidden. The `[build]` table is required for — and only for — an
        // end-to-end case: it must state exactly how its implementation is built
        // rather than inheriting a default, so absence is rejected here. The
        // validator then runs the commands verbatim; a blank one would silently
        // skip a build step, so reject that too. An asset-generation case has no
        // build at all (it produces an action log, not a static site), so a
        // `[build]` table on one is a mistake worth rejecting rather than ignoring.
        let test_type = manifest.test_type;
        let build = match test_type {
            TestType::EndToEnd => {
                let build = manifest
                    .build
                    .ok_or_else(|| invalid("the [build] table is required".to_string()))?;
                if build.install.trim().is_empty() {
                    return Err(invalid("build.install must not be empty".to_string()));
                }
                if build.build.trim().is_empty() {
                    return Err(invalid("build.build must not be empty".to_string()));
                }
                // An end-to-end build emits a static site, not a wasm module, so a
                // `module` artifact path belongs to a type that ships a wasm
                // artifact; reject it here rather than silently ignoring it.
                if build.module.is_some() {
                    return Err(invalid(
                        "build.module is only valid for an adversarial or performance case"
                            .to_string(),
                    ));
                }
                Some(BuildCommands {
                    install: build.install,
                    build: build.build,
                    module: None,
                })
            }
            TestType::AssetGeneration => {
                if manifest.build.is_some() {
                    return Err(invalid(
                        "an asset-generation case declares no [build] table".to_string(),
                    ));
                }
                None
            }
            TestType::Adversarial | TestType::Performance => {
                // Both of these types compile the model's submission to a wasm
                // module (an adversarial controller, a performance engine): the
                // case must state both commands and the `module` artifact path
                // explicitly (the validator loads it as the submission), so absence
                // of any of the three is rejected.
                let build = manifest
                    .build
                    .ok_or_else(|| invalid("the [build] table is required".to_string()))?;
                if build.install.trim().is_empty() {
                    return Err(invalid("build.install must not be empty".to_string()));
                }
                if build.build.trim().is_empty() {
                    return Err(invalid("build.build must not be empty".to_string()));
                }
                let module = build
                    .module
                    .ok_or_else(|| invalid("build.module is required".to_string()))?;
                // The produced module lives under the run root; it must stay inside
                // it so the validator never reads a module from outside the run.
                if escapes_folder(&module) {
                    return Err(invalid(format!(
                        "build.module `{}` escapes the run workspace",
                        module.display()
                    )));
                }
                Some(BuildCommands {
                    install: build.install,
                    build: build.build,
                    module: Some(module),
                })
            }
        };

        // Variants live in their own files (by convention `variants/<slug>.toml`),
        // listed in order by the `variants` array — the first is the default — and
        // a case must offer at least one. Each file is a standalone
        // `ManifestVariant` whose paths resolve against the version folder exactly
        // like the main manifest's. They are loaded up front so the resolved set is
        // available both to the per-type guards below (an asset-generation case,
        // for instance, forbids any variant reference) and to the variant loop.
        if manifest.variants.is_empty() {
            return Err(invalid(
                "at least one variant must be listed in `variants`".to_string(),
            ));
        }
        let mut variant_manifests: Vec<ManifestVariant> =
            Vec::with_capacity(manifest.variants.len());
        for rel in &manifest.variants {
            let path = resolve_inside(rel, "variant")?;
            if !path.is_file() {
                return Err(invalid(format!(
                    "variant `{}` does not exist",
                    rel.display()
                )));
            }
            let raw = fs::read_to_string(&path).map_err(|err| {
                invalid(format!("could not read variant `{}`: {err}", rel.display()))
            })?;
            let variant: ManifestVariant = toml::from_str(&raw)
                .map_err(|err| invalid(format!("invalid variant `{}`: {err}", rel.display())))?;
            variant_manifests.push(variant);
        }

        // Resolve one scoring domain: a reviewer rates each independently and the
        // run's overall rating is the worst across them. The id keys a recorded
        // per-domain rating, so it must be non-empty and unique against `taken`
        // (the domains already accepted — the common set, plus a variant's own
        // when resolving that variant); a description is required so the reviewer
        // knows what they are rating.
        let resolve_domain = |domain: &ManifestDomain, taken: &[Domain]| -> Result<Domain> {
            if domain.id.trim().is_empty() {
                return Err(invalid("domain `id` must not be empty".to_string()));
            }
            if domain.description.trim().is_empty() {
                return Err(invalid(format!(
                    "domain `{}` has empty `description`",
                    domain.id
                )));
            }
            if taken.iter().any(|resolved| resolved.id == domain.id) {
                return Err(invalid(format!("duplicate domain id `{}`", domain.id)));
            }
            let name = domain.name.clone().unwrap_or_else(|| humanize(&domain.id));
            Ok(Domain {
                id: domain.id.clone(),
                name,
                description: domain.description.clone(),
            })
        };

        // The common domains every variant is rated on. A case must declare at
        // least one, so every variant's effective set (common ∪ its own) is
        // non-empty; a variant may add more of its own in the loop below.
        if manifest.domains.is_empty() {
            return Err(invalid(
                "at least one common [[domain]] must be declared".to_string(),
            ));
        }
        let mut domains: Vec<Domain> = Vec::with_capacity(manifest.domains.len());
        for domain in &manifest.domains {
            let resolved = resolve_domain(domain, &domains)?;
            domains.push(resolved);
        }

        // Resolve one spec mapping: the source must exist inside the version
        // folder, and the dest must be a relative path that stays inside the
        // run's workspace.
        let resolve_spec = |spec: &ManifestSpec| -> Result<SpecFile> {
            let source_path = resolve_inside(&spec.source, "spec source")?;
            if !source_path.is_file() {
                return Err(invalid(format!(
                    "spec source `{}` does not exist",
                    spec.source.display()
                )));
            }
            // A spec's seeded path so rarely differs from its source that `dest`
            // is optional: when omitted it defaults to the source with a trailing
            // `.hbs` template extension stripped (see [`spec_default_dest`]).
            let dest = spec
                .dest
                .clone()
                .unwrap_or_else(|| spec_default_dest(&spec.source));
            if escapes_folder(&dest) {
                return Err(invalid(format!(
                    "spec dest `{}` escapes the run workspace",
                    dest.display()
                )));
            }
            Ok(SpecFile { source_path, dest })
        };

        let mut common_specs = Vec::with_capacity(manifest.specs.len());
        for spec in &manifest.specs {
            common_specs.push(resolve_spec(spec)?);
        }

        // Resolve the asset-generation tables (`[canvas]`, `[tool]`, `[output]`).
        // They are required for — and only for — an asset-generation case; on an
        // end-to-end case they are a mistake. No operations schema is seeded — the
        // drawing binary's `--help` is the contract. The preview and action-log
        // paths are run-relative destinations the binary writes (not seeded),
        // validated only to stay inside the workspace; for a sprite sheet they are
        // `{frame}` templates, since every frame is a separate file. An
        // asset-generation case has no target image: its output is human-reviewed
        // against the brief, so it declares no references at all.
        let (canvas, tool, output, sheet, voxel, model) = match test_type {
            TestType::EndToEnd | TestType::Adversarial | TestType::Performance => {
                if manifest.canvas.is_some() || manifest.tool.is_some() || manifest.output.is_some()
                {
                    return Err(invalid(
                        "[canvas], [tool], and [output] are only valid for an asset-generation case"
                            .to_string(),
                    ));
                }
                // `asset_kind` and the `[sheet]` table only mean something inside an
                // asset-generation case. An explicit `asset_kind = "sprite-sheet"`
                // or a `[sheet]` table on an end-to-end case is a mistake worth
                // rejecting rather than silently ignoring.
                if manifest.asset_kind != AssetKind::Sprite || manifest.sheet.is_some() {
                    return Err(invalid(
                        "`asset_kind` and the [sheet] table are only valid for an \
                         asset-generation case"
                            .to_string(),
                    ));
                }
                // The voxel tables are likewise asset-generation-only.
                if manifest.voxel.is_some() || manifest.model.is_some() {
                    return Err(invalid(
                        "the [voxel] and [model] tables are only valid for a voxel \
                         asset-generation case"
                            .to_string(),
                    ));
                }
                (None, None, None, None, None, None)
            }
            TestType::AssetGeneration if manifest.asset_kind.is_voxel() => {
                // A voxel case declares a `[voxel]` bounding volume instead of a 2D
                // `[canvas]`/`[sheet]`, sculpted through the `voxel`/`voxel-anim`
                // binary. The `[tool]`/`[output]` tables are shared with the sprite
                // kinds; their preview/action-log paths are `{part}` templates for
                // an animated model (one separate file per declared part) and plain
                // paths for a static one. A voxel-animation case additionally
                // declares the required `[model]` rig.
                if manifest.canvas.is_some() || manifest.sheet.is_some() {
                    return Err(invalid(
                        "a voxel case declares a [voxel] table, not [canvas] or [sheet]"
                            .to_string(),
                    ));
                }

                let voxel = manifest
                    .voxel
                    .as_ref()
                    .ok_or_else(|| invalid("the [voxel] table is required".to_string()))?;
                if voxel.width == 0 || voxel.height == 0 || voxel.depth == 0 {
                    return Err(invalid(
                        "voxel width, height, and depth must be greater than zero".to_string(),
                    ));
                }
                test_cabinet_voxel::PreviewBackground::parse(&voxel.background).map_err(|err| {
                    invalid(format!("voxel background `{}`: {err}", voxel.background))
                })?;

                let tool = manifest
                    .tool
                    .as_ref()
                    .ok_or_else(|| invalid("the [tool] table is required".to_string()))?;
                if tool.binary.trim().is_empty() {
                    return Err(invalid("tool.binary must not be empty".to_string()));
                }
                if escapes_folder(&tool.preview) {
                    return Err(invalid(format!(
                        "tool preview `{}` escapes the run workspace",
                        tool.preview.display()
                    )));
                }

                let output = manifest
                    .output
                    .as_ref()
                    .ok_or_else(|| invalid("the [output] table is required".to_string()))?;
                if escapes_folder(&output.actions) {
                    return Err(invalid(format!(
                        "output actions `{}` escapes the run workspace",
                        output.actions.display()
                    )));
                }

                // The preview and action-log paths must be `{part}` templates for an
                // animated model (one file per part) and plain paths for a static
                // one. Validating this here keeps the seeded config, the binary, and
                // the validator agreeing on where each part's files live.
                let is_anim = manifest.asset_kind == AssetKind::VoxelAnimation;
                for (label, path) in [
                    ("tool.preview", &tool.preview),
                    ("output.actions", &output.actions),
                ] {
                    let has_token = path.to_string_lossy().contains(PART_TOKEN);
                    if is_anim && !has_token {
                        return Err(invalid(format!(
                            "{label} `{}` must contain `{PART_TOKEN}` for a voxel-animation case \
                             (one file per part)",
                            path.display()
                        )));
                    }
                    if !is_anim && has_token {
                        return Err(invalid(format!(
                            "{label} `{}` must not contain `{PART_TOKEN}` for a voxel-model case",
                            path.display()
                        )));
                    }
                }

                // The `[model]` rig is required for — and only for — a
                // voxel-animation case. A static voxel-model is one unposed volume
                // and declares no rig.
                let model = match manifest.asset_kind {
                    AssetKind::VoxelModel => {
                        if manifest.model.is_some() {
                            return Err(invalid(
                                "a voxel-model case (asset_kind = \"voxel-model\") declares no \
                                 [model] table"
                                    .to_string(),
                            ));
                        }
                        None
                    }
                    AssetKind::VoxelAnimation => {
                        let model = manifest.model.as_ref().ok_or_else(|| {
                            invalid(
                                "a voxel-animation case (asset_kind = \"voxel-animation\") \
                                 requires a [model] table"
                                    .to_string(),
                            )
                        })?;
                        Some(resolve_model(model, &invalid)?)
                    }
                    // The outer match guard restricts this arm to the voxel kinds.
                    AssetKind::Sprite | AssetKind::SpriteSheet => unreachable!(),
                };

                (
                    None,
                    Some(ToolSpec {
                        binary: tool.binary.clone(),
                        preview: tool.preview.clone(),
                    }),
                    Some(OutputSpec {
                        actions: output.actions.clone(),
                    }),
                    None,
                    Some(VoxelSpec {
                        width: voxel.width,
                        height: voxel.height,
                        depth: voxel.depth,
                        background: voxel.background.clone(),
                    }),
                    model,
                )
            }
            TestType::AssetGeneration => {
                // The voxel tables belong to the voxel kinds (handled by the guarded
                // arm above); a sprite case must not declare them.
                if manifest.voxel.is_some() || manifest.model.is_some() {
                    return Err(invalid(
                        "the [voxel] and [model] tables are only valid for a voxel \
                         asset-generation case (asset_kind = \"voxel-model\"/\"voxel-animation\")"
                            .to_string(),
                    ));
                }
                let canvas = manifest
                    .canvas
                    .as_ref()
                    .ok_or_else(|| invalid("the [canvas] table is required".to_string()))?;
                if canvas.width == 0 || canvas.height == 0 {
                    return Err(invalid(
                        "canvas width and height must be greater than zero".to_string(),
                    ));
                }
                test_cabinet_draw::Background::parse(&canvas.background).map_err(|err| {
                    invalid(format!("canvas background `{}`: {err}", canvas.background))
                })?;

                let tool = manifest
                    .tool
                    .as_ref()
                    .ok_or_else(|| invalid("the [tool] table is required".to_string()))?;
                if tool.binary.trim().is_empty() {
                    return Err(invalid("tool.binary must not be empty".to_string()));
                }
                if escapes_folder(&tool.preview) {
                    return Err(invalid(format!(
                        "tool preview `{}` escapes the run workspace",
                        tool.preview.display()
                    )));
                }

                let output = manifest
                    .output
                    .as_ref()
                    .ok_or_else(|| invalid("the [output] table is required".to_string()))?;
                if escapes_folder(&output.actions) {
                    return Err(invalid(format!(
                        "output actions `{}` escapes the run workspace",
                        output.actions.display()
                    )));
                }

                // The preview and action-log paths must be `{frame}` templates for
                // a sprite sheet (one file per frame) and plain paths for a single
                // sprite. Validating this here keeps the seeded config, the binary,
                // and the validator agreeing on where each frame's files live.
                let is_sheet = manifest.asset_kind == AssetKind::SpriteSheet;
                for (label, path) in [
                    ("tool.preview", &tool.preview),
                    ("output.actions", &output.actions),
                ] {
                    let has_token = path.to_string_lossy().contains(FRAME_TOKEN);
                    if is_sheet && !has_token {
                        return Err(invalid(format!(
                            "{label} `{}` must contain `{FRAME_TOKEN}` for a sprite-sheet case \
                             (one file per frame)",
                            path.display()
                        )));
                    }
                    if !is_sheet && has_token {
                        return Err(invalid(format!(
                            "{label} `{}` must not contain `{FRAME_TOKEN}` for a single-sprite case",
                            path.display()
                        )));
                    }
                }

                // The `[sheet]` table is required for — and only for — a
                // sprite-sheet case. A single-sprite case draws one image onto the
                // whole canvas and declares no frames; a sprite-sheet case declares
                // its frames (each with the index it is written to) and the named
                // sequences a reviewer plays back.
                let sheet = match manifest.asset_kind {
                    AssetKind::Sprite => {
                        if manifest.sheet.is_some() {
                            return Err(invalid(
                                "a single-sprite case (asset_kind = \"sprite\") declares no \
                                 [sheet] table"
                                    .to_string(),
                            ));
                        }
                        None
                    }
                    AssetKind::SpriteSheet => {
                        let sheet = manifest.sheet.as_ref().ok_or_else(|| {
                            invalid(
                                "a sprite-sheet case (asset_kind = \"sprite-sheet\") requires a \
                                 [sheet] table"
                                    .to_string(),
                            )
                        })?;
                        Some(resolve_sheet(sheet, canvas.width, canvas.height, &invalid)?)
                    }
                    // The two voxel kinds are resolved by the guarded voxel arm
                    // above and never reach this 2D sprite branch.
                    AssetKind::VoxelModel | AssetKind::VoxelAnimation => unreachable!(),
                };

                (
                    Some(CanvasSpec {
                        width: canvas.width,
                        height: canvas.height,
                        background: canvas.background.clone(),
                    }),
                    Some(ToolSpec {
                        binary: tool.binary.clone(),
                        preview: tool.preview.clone(),
                    }),
                    Some(OutputSpec {
                        actions: output.actions.clone(),
                    }),
                    sheet,
                    None,
                    None,
                )
            }
        };

        // Resolve the contract/sandbox tables and (for adversarial) the
        // `[simulation]`/`[match]`/`[replay]` tables, or (for performance) the
        // `[[case]]` scored set.
        //
        // `[contract]` and `[sandbox]` are required for an adversarial **and** a
        // performance case (each generalizes them: adversarial carries per-tick
        // `world`/`action` + `fuel_per_tick`; performance carries per-case
        // `input`/`output` + `fuel_limit`). The contract schemas are authored files
        // inside the version folder, seeded like the asset-gen operations schema
        // (appended to `common_specs`) so the model reads them where the contract
        // names them. `[simulation]`/`[match]`/`[replay]` are **adversarial-only**:
        // a performance run is a single once-per-case invocation, not a real-time
        // match, and v1 carries no replay renderer, so those tables are forbidden on
        // it. `build.module` (validated above) is the wasm artifact the validator
        // loads for either type.
        let (contract, sandbox, simulation, r#match, replay, cases) = match test_type {
            TestType::EndToEnd | TestType::AssetGeneration => {
                if manifest.contract.is_some()
                    || manifest.sandbox.is_some()
                    || manifest.simulation.is_some()
                    || manifest.r#match.is_some()
                    || manifest.replay.is_some()
                {
                    return Err(invalid(
                        "[contract], [sandbox], [simulation], [match], and [replay] are only valid \
                         for an adversarial or performance case"
                            .to_string(),
                    ));
                }
                if !manifest.cases.is_empty() {
                    return Err(invalid(
                        "[[case]] tables are only valid for a performance case".to_string(),
                    ));
                }
                (None, None, None, None, None, Vec::new())
            }
            TestType::Adversarial => {
                let contract = manifest
                    .contract
                    .as_ref()
                    .ok_or_else(|| invalid("the [contract] table is required".to_string()))?;
                if contract.entry.trim().is_empty() {
                    return Err(invalid("contract.entry must not be empty".to_string()));
                }
                // Adversarial carries the per-tick `world`/`action` schemas, not the
                // performance `input`/`output` pair; require the former and reject
                // the latter so a mistyped contract is caught here.
                if contract.input.is_some() || contract.output.is_some() {
                    return Err(invalid(
                        "contract.input/output are only valid for a performance case".to_string(),
                    ));
                }
                let world = contract
                    .world
                    .as_ref()
                    .ok_or_else(|| invalid("contract.world is required".to_string()))?;
                let action = contract
                    .action
                    .as_ref()
                    .ok_or_else(|| invalid("contract.action is required".to_string()))?;
                let world_source = resolve_inside(world, "contract world schema")?;
                if !world_source.is_file() {
                    return Err(invalid(format!(
                        "contract world schema `{}` does not exist",
                        world.display()
                    )));
                }
                let action_source = resolve_inside(action, "contract action schema")?;
                if !action_source.is_file() {
                    return Err(invalid(format!(
                        "contract action schema `{}` does not exist",
                        action.display()
                    )));
                }
                common_specs.push(SpecFile {
                    source_path: world_source,
                    dest: world.clone(),
                });
                common_specs.push(SpecFile {
                    source_path: action_source,
                    dest: action.clone(),
                });

                let sandbox = manifest
                    .sandbox
                    .ok_or_else(|| invalid("the [sandbox] table is required".to_string()))?;
                // Adversarial meters per tick; the performance per-case `fuel_limit`
                // is the wrong knob here.
                if sandbox.fuel_limit.is_some() {
                    return Err(invalid(
                        "sandbox.fuel_limit is only valid for a performance case".to_string(),
                    ));
                }
                let fuel_per_tick = sandbox
                    .fuel_per_tick
                    .ok_or_else(|| invalid("sandbox.fuel_per_tick is required".to_string()))?;
                if fuel_per_tick == 0 {
                    return Err(invalid(
                        "sandbox.fuel_per_tick must be greater than zero".to_string(),
                    ));
                }
                if sandbox.max_memory_bytes == 0 {
                    return Err(invalid(
                        "sandbox.max_memory_bytes must be greater than zero".to_string(),
                    ));
                }

                let simulation = manifest
                    .simulation
                    .ok_or_else(|| invalid("the [simulation] table is required".to_string()))?;
                if simulation.timestep_ms == 0 {
                    return Err(invalid(
                        "simulation.timestep_ms must be greater than zero".to_string(),
                    ));
                }
                if simulation.max_ticks == 0 {
                    return Err(invalid(
                        "simulation.max_ticks must be greater than zero".to_string(),
                    ));
                }

                let r#match = manifest
                    .r#match
                    .as_ref()
                    .ok_or_else(|| invalid("the [match] table is required".to_string()))?;
                if r#match.participants == 0 {
                    return Err(invalid(
                        "match.participants must be greater than zero".to_string(),
                    ));
                }
                if r#match.structure.trim().is_empty() {
                    return Err(invalid("match.structure must not be empty".to_string()));
                }
                if r#match.rounds == 0 {
                    return Err(invalid(
                        "match.rounds must be greater than zero".to_string(),
                    ));
                }

                let replay = manifest
                    .replay
                    .as_ref()
                    .ok_or_else(|| invalid("the [replay] table is required".to_string()))?;
                let renderer = resolve_inside(&replay.renderer, "replay renderer")?;
                if !renderer.is_file() {
                    return Err(invalid(format!(
                        "replay renderer `{}` does not exist",
                        replay.renderer.display()
                    )));
                }

                if !manifest.cases.is_empty() {
                    return Err(invalid(
                        "[[case]] tables are only valid for a performance case".to_string(),
                    ));
                }

                (
                    Some(ContractSpec {
                        entry: contract.entry.clone(),
                        world: Some(world.clone()),
                        action: Some(action.clone()),
                        input: None,
                        output: None,
                    }),
                    Some(SandboxSpec {
                        fuel_per_tick: Some(fuel_per_tick),
                        fuel_limit: None,
                        max_memory_bytes: sandbox.max_memory_bytes,
                    }),
                    Some(SimulationSpec {
                        timestep_ms: simulation.timestep_ms,
                        max_ticks: simulation.max_ticks,
                    }),
                    Some(MatchSpec {
                        participants: r#match.participants,
                        structure: r#match.structure.clone(),
                        rounds: r#match.rounds,
                    }),
                    Some(ReplaySpec {
                        renderer: replay.renderer.clone(),
                    }),
                    Vec::new(),
                )
            }
            TestType::Performance => {
                // A performance run is scored once per input case (not per tick) and
                // has no real-time loop, head-to-head match, or replay renderer in
                // v1, so the adversarial loop tables are forbidden here.
                if manifest.simulation.is_some()
                    || manifest.r#match.is_some()
                    || manifest.replay.is_some()
                {
                    return Err(invalid(
                        "[simulation], [match], and [replay] are only valid for an adversarial \
                         case"
                            .to_string(),
                    ));
                }

                let contract = manifest
                    .contract
                    .as_ref()
                    .ok_or_else(|| invalid("the [contract] table is required".to_string()))?;
                if contract.entry.trim().is_empty() {
                    return Err(invalid("contract.entry must not be empty".to_string()));
                }
                // Performance carries the per-case `input`/`output` schemas, not the
                // adversarial `world`/`action` pair; require the former and reject
                // the latter so a mistyped contract is caught here.
                if contract.world.is_some() || contract.action.is_some() {
                    return Err(invalid(
                        "contract.world/action are only valid for an adversarial case".to_string(),
                    ));
                }
                let input = contract
                    .input
                    .as_ref()
                    .ok_or_else(|| invalid("contract.input is required".to_string()))?;
                let output = contract
                    .output
                    .as_ref()
                    .ok_or_else(|| invalid("contract.output is required".to_string()))?;
                let input_source = resolve_inside(input, "contract input schema")?;
                if !input_source.is_file() {
                    return Err(invalid(format!(
                        "contract input schema `{}` does not exist",
                        input.display()
                    )));
                }
                let output_source = resolve_inside(output, "contract output schema")?;
                if !output_source.is_file() {
                    return Err(invalid(format!(
                        "contract output schema `{}` does not exist",
                        output.display()
                    )));
                }
                common_specs.push(SpecFile {
                    source_path: input_source,
                    dest: input.clone(),
                });
                common_specs.push(SpecFile {
                    source_path: output_source,
                    dest: output.clone(),
                });

                let sandbox = manifest
                    .sandbox
                    .ok_or_else(|| invalid("the [sandbox] table is required".to_string()))?;
                // Performance meters per input case; the adversarial per-tick budget
                // is the wrong knob here.
                if sandbox.fuel_per_tick.is_some() {
                    return Err(invalid(
                        "sandbox.fuel_per_tick is only valid for an adversarial case".to_string(),
                    ));
                }
                let fuel_limit = sandbox
                    .fuel_limit
                    .ok_or_else(|| invalid("sandbox.fuel_limit is required".to_string()))?;
                if fuel_limit == 0 {
                    return Err(invalid(
                        "sandbox.fuel_limit must be greater than zero".to_string(),
                    ));
                }
                if sandbox.max_memory_bytes == 0 {
                    return Err(invalid(
                        "sandbox.max_memory_bytes must be greater than zero".to_string(),
                    ));
                }

                // The held-out scored set: at least one `[[case]]`. Each pairs an
                // input with the answer a correct engine must produce. Both files
                // live inside the version folder and are validated to exist there;
                // unlike specs they are **never** seeded — they are the secret set
                // the validator reads directly to score the engine.
                if manifest.cases.is_empty() {
                    return Err(invalid(
                        "a performance case requires at least one [[case]]".to_string(),
                    ));
                }
                let mut cases = Vec::with_capacity(manifest.cases.len());
                for case in &manifest.cases {
                    let input_path = resolve_inside(&case.input, "case input")?;
                    if !input_path.is_file() {
                        return Err(invalid(format!(
                            "case input `{}` does not exist",
                            case.input.display()
                        )));
                    }
                    let expected_path = resolve_inside(&case.expected, "case expected")?;
                    if !expected_path.is_file() {
                        return Err(invalid(format!(
                            "case expected `{}` does not exist",
                            case.expected.display()
                        )));
                    }
                    cases.push(PerformanceCase {
                        input: input_path,
                        expected: expected_path,
                    });
                }

                (
                    Some(ContractSpec {
                        entry: contract.entry.clone(),
                        world: None,
                        action: None,
                        input: Some(input.clone()),
                        output: Some(output.clone()),
                    }),
                    Some(SandboxSpec {
                        fuel_per_tick: None,
                        fuel_limit: Some(fuel_limit),
                        max_memory_bytes: sandbox.max_memory_bytes,
                    }),
                    None,
                    None,
                    None,
                    cases,
                )
            }
        };

        // Resolve a starter workspace directory into the list of files it seeds.
        // The directory must exist inside the version folder; each file's `dest`
        // is its path relative to that directory, so `workspaces/base/package.json`
        // seeds to `package.json` at the run's root. Shared by the common
        // workspace and each variant's override.
        let resolve_workspace = |dir: &Path, kind: &str| -> Result<Vec<WorkspaceFile>> {
            let path = resolve_inside(dir, kind)?;
            if !path.is_dir() {
                return Err(invalid(format!(
                    "{kind} `{}` is not a directory",
                    dir.display()
                )));
            }
            let mut files = Vec::new();
            collect_workspace_files(&path, &path, &mut files).map_err(|err| {
                invalid(format!("could not read {kind} `{}`: {err}", dir.display()))
            })?;
            // Stable, dest-ordered so seeding and the stored manifest are
            // deterministic regardless of directory read order.
            files.sort_by(|a, b| a.dest.cmp(&b.dest));
            Ok(files)
        };
        let common_workspace = match &manifest.workspace {
            Some(dir) => resolve_workspace(dir, "workspace")?,
            None => Vec::new(),
        };

        // The init command, when declared, runs in the container after seeding; a
        // blank string would be a no-op the author almost certainly did not mean,
        // so reject it rather than silently running nothing.
        if let Some(init) = &manifest.init
            && init.trim().is_empty()
        {
            return Err(invalid("init must not be empty when declared".to_string()));
        }

        // The site-facing description is validated to exist when declared, with
        // the same self-containment guard as every other path, but it is never
        // seeded into a run.
        let description_path = match &manifest.description {
            Some(description) => {
                let path = resolve_inside(description, "description")?;
                if !path.is_file() {
                    return Err(invalid(format!(
                        "description `{}` does not exist",
                        description.display()
                    )));
                }
                Some(path)
            }
            None => None,
        };

        let mut asset_paths = Vec::with_capacity(manifest.assets.len());
        for asset in &manifest.assets {
            let path = resolve_inside(asset, "asset")?;
            if !path.exists() {
                return Err(invalid(format!(
                    "asset `{}` does not exist",
                    asset.display()
                )));
            }
            asset_paths.push(path);
        }
        // The run-relative dest of each seeded asset, used by the per-variant
        // collision check below. An asset keeps its path relative to the version
        // folder when seeded (a directory recursively under that path).
        let asset_dests: Vec<PathBuf> = asset_paths
            .iter()
            .map(|path| {
                path.strip_prefix(&root)
                    .map(Path::to_path_buf)
                    .unwrap_or_else(|_| path.clone())
            })
            .collect();

        // Resolve one reference mapping. A reference is either an HTML mockup
        // rendered to a screenshot (`path`) or a static image/video served as-is
        // (`media`); exactly one must be declared. The source must exist inside the
        // version folder. Shared by the common references and each variant's own.
        let resolve_reference = |reference: &ManifestReference| -> Result<ReferenceView> {
            let (rel, kind) = match (&reference.path, &reference.media) {
                (Some(path), None) => (path, ReferenceKind::Rendered),
                (None, Some(media)) => {
                    let kind = MediaKind::from_path(media).ok_or_else(|| {
                        invalid(format!(
                            "reference media `{}` for view `{}` has an unsupported extension \
                             (expected an image or .mp4)",
                            media.display(),
                            reference.view
                        ))
                    })?;
                    let kind = match kind {
                        MediaKind::Image => ReferenceKind::Image,
                        MediaKind::Video => ReferenceKind::Video,
                    };
                    (media, kind)
                }
                (Some(_), Some(_)) => {
                    return Err(invalid(format!(
                        "reference for view `{}` declares both `path` and `media`; \
                         exactly one is allowed",
                        reference.view
                    )));
                }
                (None, None) => {
                    return Err(invalid(format!(
                        "reference for view `{}` declares neither `path` nor `media`",
                        reference.view
                    )));
                }
            };
            let source_path = resolve_inside(rel, "reference")?;
            if !source_path.is_file() {
                return Err(invalid(format!(
                    "reference `{}` for view `{}` does not exist",
                    rel.display(),
                    reference.view
                )));
            }
            Ok(ReferenceView {
                view: reference.view.clone(),
                kind,
                source_path,
            })
        };

        // Resolve one proof-of-implementation declaration: its id must be
        // non-empty, its dest must stay inside the run workspace, and the media
        // kind is inferred from the dest extension. Shared by the common proofs
        // and each variant's own.
        let resolve_proof = |proof: &ManifestProof| -> Result<ProofFile> {
            if proof.id.trim().is_empty() {
                return Err(invalid("proof `id` must not be empty".to_string()));
            }
            if escapes_folder(&proof.dest) {
                return Err(invalid(format!(
                    "proof `{}` dest `{}` escapes the run workspace",
                    proof.id,
                    proof.dest.display()
                )));
            }
            let kind = MediaKind::from_path(&proof.dest).ok_or_else(|| {
                invalid(format!(
                    "proof `{}` dest `{}` has an unsupported extension \
                     (expected an image or .mp4)",
                    proof.id,
                    proof.dest.display()
                ))
            })?;
            let name = proof.name.clone().unwrap_or_else(|| humanize(&proof.id));
            Ok(ProofFile {
                id: proof.id.clone(),
                name,
                kind,
                dest: proof.dest.clone(),
            })
        };

        // An asset-generation case has no automated checks (it has no served build
        // to drive) and no target image: its output is human-reviewed against the
        // brief, with only the regenerated image and the cheat-divergence signal
        // the validator computes. Reject declared checks, declared references
        // (common or per-variant), and any review-item `reference` — there is no
        // target to show as expected. This guards the raw manifest up front, before
        // references are resolved, so an author who declares one gets this message
        // rather than a confusing downstream "does not exist".
        if test_type == TestType::AssetGeneration {
            if !manifest.check.is_empty() {
                return Err(invalid(
                    "an asset-generation case declares no [[check]]".to_string(),
                ));
            }
            if !manifest.reference.is_empty()
                || variant_manifests
                    .iter()
                    .any(|variant| !variant.references.is_empty())
            {
                return Err(invalid(
                    "an asset-generation case declares no [[reference]]; its output is \
                     human-reviewed, with no target to score against"
                        .to_string(),
                ));
            }
            let any_item_reference = manifest
                .review_items
                .iter()
                .chain(
                    variant_manifests
                        .iter()
                        .flat_map(|variant| &variant.review_items),
                )
                .any(|item| item.reference.is_some());
            if any_item_reference {
                return Err(invalid(
                    "an asset-generation review item declares no `reference`; it has no target \
                     to show as expected"
                        .to_string(),
                ));
            }
        }

        let mut common_references = Vec::with_capacity(manifest.reference.len());
        for reference in &manifest.reference {
            common_references.push(resolve_reference(reference)?);
        }

        // Resolve one reviewer checklist item: its id, title, and text must all be
        // non-empty, since the id keys a recorded verdict, the title heads the item
        // in the reviewer UI, and the text is what the reviewer reads. Shared by the
        // common items and each variant's own.
        let resolve_review_item =
            |item: &ManifestReviewItem, allowed_domains: &[Domain]| -> Result<ReviewItem> {
                if item.id.trim().is_empty() {
                    return Err(invalid("review_item `id` must not be empty".to_string()));
                }
                if item.title.trim().is_empty() {
                    return Err(invalid(format!(
                        "review_item `{}` has empty `title`",
                        item.id
                    )));
                }
                if item.text.trim().is_empty() {
                    return Err(invalid(format!(
                        "review_item `{}` has empty `text`",
                        item.id
                    )));
                }
                // The weight is the item's point value toward the score; a zero-weight
                // item could never affect the score, which is never intended, so it is
                // rejected rather than silently scored as nothing.
                if item.weight == 0 {
                    return Err(invalid(format!(
                        "review_item `{}` must have a `weight` greater than zero",
                        item.id
                    )));
                }
                // An item's domain, when declared, must name a domain in the item's
                // allowed set so its points roll up to a real per-domain score. For a
                // common item that set is the case's common domains; for a variant item
                // it also includes that variant's own domains (a common item cannot
                // name a variant-only domain, since it is rated on every variant).
                if let Some(domain) = &item.domain
                    && !allowed_domains
                        .iter()
                        .any(|resolved| &resolved.id == domain)
                {
                    return Err(invalid(format!(
                        "review_item `{}` names domain `{}`, which is not declared",
                        item.id, domain
                    )));
                }
                // The sprite-sheet references — the sequences and frames an item is
                // about — are only meaningful for a sprite-sheet case, and every one
                // must name something the sheet declares so the reviewer UI can always
                // resolve it. A single sprite (or any non-asset case) has no sheet, so
                // declaring either is a manifest error rather than a silently dropped
                // reference.
                if !item.sequences.is_empty() || !item.frames.is_empty() {
                    let Some(sheet) = &sheet else {
                        return Err(invalid(format!(
                            "review_item `{}` declares `sequences`/`frames`, which are only \
                         valid for a sprite-sheet case (asset_kind = \"sprite-sheet\")",
                            item.id
                        )));
                    };
                    for slug in &item.sequences {
                        if !sheet.sequences.iter().any(|s| &s.slug == slug) {
                            return Err(invalid(format!(
                                "review_item `{}` names sequence `{}`, which the [sheet] does \
                             not declare",
                                item.id, slug
                            )));
                        }
                    }
                    for index in &item.frames {
                        if !sheet.frames.contains(index) {
                            return Err(invalid(format!(
                                "review_item `{}` names frame `{}`, which the [sheet] does not \
                             declare",
                                item.id, index
                            )));
                        }
                    }
                }
                Ok(ReviewItem {
                    id: item.id.clone(),
                    title: item.title.clone(),
                    text: item.text.clone(),
                    reference: item.reference.clone(),
                    proof: item.proof.clone(),
                    sequences: item.sequences.clone(),
                    frames: item.frames.clone(),
                    weight: item.weight,
                    domain: item.domain.clone(),
                })
            };

        // Common items are rated on every variant, so they may only name a common
        // domain — the variant-specific domains are not in scope here.
        let mut common_review_items = Vec::with_capacity(manifest.review_items.len());
        for item in &manifest.review_items {
            common_review_items.push(resolve_review_item(item, &domains)?);
        }

        let mut common_proofs = Vec::with_capacity(manifest.proof.len());
        for proof in &manifest.proof {
            common_proofs.push(resolve_proof(proof)?);
        }

        // A run always selects exactly one variant (loaded from its file above).
        // Variant slugs must be unique so a run records an unambiguous choice.
        let mut variants: Vec<Variant> = Vec::with_capacity(variant_manifests.len());
        for variant in &variant_manifests {
            if variants
                .iter()
                .any(|resolved| resolved.slug == variant.slug)
            {
                return Err(invalid(format!(
                    "duplicate variant slug `{}`",
                    variant.slug
                )));
            }
            let mut specs = Vec::with_capacity(variant.specs.len());
            for spec in &variant.specs {
                specs.push(resolve_spec(spec)?);
            }

            // The variant's own scoring domains, on top of the case's common ones.
            // `effective_domains` is common ∪ this variant's, so it is both the
            // uniqueness set each new domain is checked against and the set a
            // variant review item may name; the tail past the common domains is the
            // variant's own, recorded on the resolved `Variant`.
            let mut effective_domains = domains.clone();
            for domain in &variant.domains {
                let resolved = resolve_domain(domain, &effective_domains)?;
                effective_domains.push(resolved);
            }
            let variant_domains: Vec<Domain> = effective_domains[domains.len()..].to_vec();
            // A variant's workspace, when declared, replaces the common workspace
            // for this variant rather than layering on top of it.
            let workspace = match &variant.workspace {
                Some(dir) => Some(resolve_workspace(dir, "variant workspace")?),
                None => None,
            };

            let mut references = Vec::with_capacity(variant.references.len());
            for reference in &variant.references {
                references.push(resolve_reference(reference)?);
            }

            let mut proofs = Vec::with_capacity(variant.proofs.len());
            for proof in &variant.proofs {
                proofs.push(resolve_proof(proof)?);
            }
            // The common proofs and the variant's own are recorded under one id
            // each; two proofs sharing an id would make a recorded result
            // ambiguous, so a collision is rejected.
            let mut seen_proof_ids = std::collections::BTreeSet::new();
            for proof in common_proofs.iter().chain(proofs.iter()) {
                if !seen_proof_ids.insert(&proof.id) {
                    return Err(invalid(format!(
                        "variant `{}` declares two proofs with the same id `{}`",
                        variant.slug, proof.id
                    )));
                }
            }

            // The common references and the variant's own are rendered and seeded
            // together under one view slug each; two references sharing a view
            // would clobber each other (a view is either common or owned by this
            // variant, never both), so a collision is rejected.
            let mut seen_views = std::collections::BTreeSet::new();
            for reference in common_references.iter().chain(references.iter()) {
                if !seen_views.insert(&reference.view) {
                    return Err(invalid(format!(
                        "variant `{}` declares two references for the same view `{}`",
                        variant.slug, reference.view
                    )));
                }
            }

            // The workspace files, the common and variant specs, the assets, and
            // the rendered reference screenshots are all seeded into the one run
            // tree. Two of them landing on the same dest would clobber each other,
            // so any collision across them — for example a workspace that ships a
            // file at a spec's `dest` — is rejected here rather than silently
            // resolved at seed time. The effective workspace is the variant's own
            // when it overrides, otherwise the case's common workspace.
            let workspace_files = workspace.as_deref().unwrap_or(&common_workspace);
            let mut seeded_dests: std::collections::BTreeMap<PathBuf, &'static str> =
                std::collections::BTreeMap::new();
            let mut claim = |dest: PathBuf, kind: &'static str| -> Result<()> {
                if let Some(prev) = seeded_dests.insert(dest.clone(), kind) {
                    return Err(invalid(format!(
                        "variant `{}` seeds two entries ({prev} and {kind}) to the same dest `{}`",
                        variant.slug,
                        dest.display()
                    )));
                }
                Ok(())
            };
            for file in workspace_files {
                claim(file.dest.clone(), "workspace")?;
            }
            for spec in common_specs.iter().chain(specs.iter()) {
                claim(spec.dest.clone(), "spec")?;
            }
            for dest in &asset_dests {
                claim(dest.clone(), "asset")?;
            }
            // The reference media seeds under `reference/<view>.<ext>` (a rendered
            // mockup is a `.png`; a static reference keeps its own extension), with
            // a `reference/README.md` notice alongside them when any are present.
            for reference in common_references.iter().chain(references.iter()) {
                claim(
                    Path::new("reference").join(format!(
                        "{}.{}",
                        reference.view,
                        reference.extension()
                    )),
                    "reference",
                )?;
            }
            if !common_references.is_empty() || !references.is_empty() {
                claim(Path::new("reference").join("README.md"), "reference")?;
            }
            // A proof is produced by the agent at its `dest`, not seeded; but a
            // proof dest that collides with a seeded file would have the agent and
            // the seeder fight over the same path, so reject the collision here.
            for proof in common_proofs.iter().chain(proofs.iter()) {
                claim(proof.dest.clone(), "proof")?;
            }
            // For an asset-generation case the drawing/sculpting binary writes the
            // preview and the action log, and the orchestrator seeds the tool
            // config; none may collide with a seeded file. A sprite sheet writes one
            // preview and one log per declared frame; a voxel-animation model writes
            // one of each per declared part and additionally produces `rig.json`, so
            // each resolved path is claimed.
            if let (Some(tool), Some(output)) = (&tool, &output) {
                if let Some(model) = &model {
                    for part in &model.parts {
                        claim(part_path(&tool.preview, &part.name), "part preview")?;
                        claim(part_path(&output.actions, &part.name), "part action log")?;
                    }
                    claim(PathBuf::from(VOXEL_RIG_DEST), "rig")?;
                } else if let Some(sheet) = &sheet {
                    for &index in &sheet.frames {
                        claim(frame_path(&tool.preview, index), "tool preview")?;
                        claim(frame_path(&output.actions, index), "action log")?;
                    }
                } else {
                    claim(tool.preview.clone(), "tool preview")?;
                    claim(output.actions.clone(), "action log")?;
                }
            }
            if test_type == TestType::AssetGeneration {
                claim(
                    PathBuf::from(manifest.asset_kind.config_dest()),
                    "tool config",
                )?;
            }

            // A variant item may name a common domain or one of this variant's
            // own, so it is resolved against the effective set.
            let mut review_items = Vec::with_capacity(variant.review_items.len());
            for item in &variant.review_items {
                review_items.push(resolve_review_item(item, &effective_domains)?);
            }
            // The common items and the variant's own are recorded under one id
            // each; two items sharing an id would make a recorded verdict
            // ambiguous, so a collision is rejected.
            let mut seen_ids = std::collections::BTreeSet::new();
            for item in common_review_items.iter().chain(review_items.iter()) {
                if !seen_ids.insert(&item.id) {
                    return Err(invalid(format!(
                        "variant `{}` declares two review items with the same id `{}`",
                        variant.slug, item.id
                    )));
                }
            }

            // A review item may pair an expected reference and a submitted proof
            // with its checklist entry; both must resolve for this variant so the
            // reviewer UI can always show them whichever variant runs.
            for item in common_review_items.iter().chain(review_items.iter()) {
                if let Some(reference) = &item.reference
                    && !common_references
                        .iter()
                        .chain(references.iter())
                        .any(|r| &r.view == reference)
                {
                    return Err(invalid(format!(
                        "review item `{}` references reference view `{}`, which variant `{}` does not declare",
                        item.id, reference, variant.slug
                    )));
                }
                if let Some(proof) = &item.proof
                    && !common_proofs
                        .iter()
                        .chain(proofs.iter())
                        .any(|p| &p.id == proof)
                {
                    return Err(invalid(format!(
                        "review item `{}` references proof `{}`, which variant `{}` does not declare",
                        item.id, proof, variant.slug
                    )));
                }
            }

            let name = variant
                .name
                .clone()
                .unwrap_or_else(|| humanize(&variant.slug));
            variants.push(Variant {
                slug: variant.slug.clone(),
                name,
                description: variant.description.clone(),
                specs,
                workspace,
                references,
                proofs,
                review_items,
                domains: variant_domains,
            });
        }

        // An adversarial case has no automated checks: it is scored by running the
        // single canonical match, not by driving a served build into views. Reject
        // declared checks rather than silently ignoring them. References (the
        // browser-rendered visual baselines an end-to-end case uses) are not part
        // of the contract here either, but they are harmless if a case ships site
        // mockups, so they are left permitted.
        if matches!(test_type, TestType::Adversarial | TestType::Performance)
            && !manifest.check.is_empty()
        {
            return Err(invalid(format!("a {test_type} case declares no [[check]]")));
        }

        // Every check must name a reference view that resolves for **every**
        // variant — either a common reference or one each variant declares — so
        // its baseline can always be rendered whichever variant runs. This keeps
        // validation declarations honest across variant-specific references.
        let mut checks = Vec::with_capacity(manifest.check.len());
        for check in &manifest.check {
            let reference_view = check
                .reference
                .clone()
                .unwrap_or_else(|| check.view.clone());
            let common = common_references.iter().any(|r| r.view == reference_view);
            if let Some(missing) = variants.iter().find(|variant| {
                !common && !variant.references.iter().any(|r| r.view == reference_view)
            }) {
                return Err(invalid(format!(
                    "check `{}` references reference view `{}`, which variant `{}` does not declare",
                    check.view, reference_view, missing.slug
                )));
            }
            let name = check.name.clone().unwrap_or_else(|| humanize(&check.view));
            checks.push(Check {
                view: check.view.clone(),
                name,
                reference_view,
                actions: check.actions.clone(),
            });
        }

        Ok(TestCaseVersion {
            slug: slug.to_string(),
            version: version.to_string(),
            name: manifest.name,
            difficulty: manifest.difficulty,
            tags: manifest.tags,
            summary: manifest.summary,
            description_path,
            root,
            prompt_path,
            max_runtime_seconds: crate::runtime_hours_to_seconds(manifest.max_runtime_hours),
            test_type,
            build,
            canvas,
            tool,
            output,
            contract,
            sandbox,
            simulation,
            r#match,
            replay,
            asset_kind: manifest.asset_kind,
            sheet,
            voxel,
            model,
            common_specs,
            common_workspace,
            init: manifest.init,
            asset_paths,
            variants,
            common_references,
            common_proofs,
            checks,
            common_review_items,
            domains,
            cases,
        })
    }

    /// Resolve the latest version of a slug.
    pub fn resolve_latest(&self, slug: &str) -> Result<TestCaseVersion> {
        let version = self.versions(slug)?.into_iter().next().ok_or_else(|| {
            Error::TestCaseVersionNotFound {
                slug: slug.to_string(),
                version: "latest".to_string(),
            }
        })?;
        self.resolve(slug, &version)
    }

    /// Read and parse a version's `test-case.toml` manifest.
    fn read_manifest(&self, slug: &str, version: &str, root: &Path) -> Result<Manifest> {
        let manifest_path = root.join(MANIFEST_FILE);
        let raw = fs::read_to_string(&manifest_path).map_err(|err| Error::InvalidTestCase {
            slug: slug.to_string(),
            version: version.to_string(),
            detail: format!("could not read {MANIFEST_FILE}: {err}"),
        })?;
        toml::from_str(&raw).map_err(|err| Error::InvalidTestCase {
            slug: slug.to_string(),
            version: version.to_string(),
            detail: format!("invalid {MANIFEST_FILE}: {err}"),
        })
    }
}

/// Read the immediate subdirectory names of a directory, ignoring files and
/// hidden entries.
fn read_dir_names(dir: &Path) -> Result<Vec<String>> {
    let mut names = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        if let Some(name) = entry.file_name().to_str()
            && !name.starts_with('.')
        {
            names.push(name.to_string());
        }
    }
    Ok(names)
}

/// A comparable key for a version string so versions order component-wise.
///
/// Leading `v` is ignored and dot-separated numeric components are compared
/// numerically; any non-numeric tail is ignored for ordering. Versions that do
/// not parse sort before those that do.
fn version_key(version: &str) -> Vec<u64> {
    version
        .trim_start_matches('v')
        .split('.')
        .map(|part| {
            let digits: String = part.chars().take_while(|c| c.is_ascii_digit()).collect();
            digits.parse().unwrap_or(0)
        })
        .collect()
}

/// The default maximum harness runtime, in hours, applied when a manifest omits
/// `max_runtime_hours`.
///
/// One hour is a generous ceiling for even the hard cases: it exists to stop a
/// stuck or runaway session from running forever, not to pace a healthy run. A
/// case that needs a tighter or looser bound declares its own value, and any run
/// can override it per invocation.
fn default_max_runtime_hours() -> f64 {
    1.0
}

/// The default `[canvas] background` applied when an asset-generation manifest
/// omits it: a fully transparent canvas.
fn default_background() -> String {
    "transparent".to_string()
}

/// The default seeded `dest` for a `[[spec]]` that omits one: the `source` with a
/// trailing `.hbs` template extension removed (so `specs/x.md.hbs` renders to
/// `specs/x.md`), or the `source` unchanged when it is not a template. A spec's
/// seeded path so rarely differs from its source that most `[[spec]]` entries need
/// only a `source`.
fn spec_default_dest(source: &Path) -> PathBuf {
    if source.extension().and_then(|ext| ext.to_str()) == Some("hbs") {
        source.with_extension("")
    } else {
        source.to_path_buf()
    }
}

/// Resolve and validate a sprite-sheet case's `[sheet]` table.
///
/// A sheet declares its frames explicitly — each with the index it is written to
/// (unique) — and the frame dimensions are the canvas dimensions
/// (`frame_width`/`frame_height`). Each sequence must carry a unique non-empty
/// slug, name at least one frame, reference only **declared** frame indices, and
/// run at a positive rate. `invalid` is the resolver's error constructor,
/// threaded in so messages carry the case's slug and version.
fn resolve_sheet(
    sheet: &ManifestSheet,
    frame_width: u32,
    frame_height: u32,
    invalid: &impl Fn(String) -> Error,
) -> Result<SheetSpec> {
    if sheet.frames.is_empty() {
        return Err(invalid(
            "a [sheet] must declare at least one [[sheet.frame]]".to_string(),
        ));
    }
    let mut frames: Vec<u32> = Vec::with_capacity(sheet.frames.len());
    for frame in &sheet.frames {
        if frames.contains(&frame.index) {
            return Err(invalid(format!(
                "duplicate sheet frame index {}",
                frame.index
            )));
        }
        frames.push(frame.index);
    }

    if sheet.sequence.is_empty() {
        return Err(invalid(
            "a [sheet] must declare at least one [[sheet.sequence]]".to_string(),
        ));
    }
    let mut sequences: Vec<SheetSequence> = Vec::with_capacity(sheet.sequence.len());
    for sequence in &sheet.sequence {
        if sequence.slug.trim().is_empty() {
            return Err(invalid(
                "sheet sequence `slug` must not be empty".to_string(),
            ));
        }
        if sequences
            .iter()
            .any(|resolved| resolved.slug == sequence.slug)
        {
            return Err(invalid(format!(
                "duplicate sheet sequence slug `{}`",
                sequence.slug
            )));
        }
        if sequence.frames.is_empty() {
            return Err(invalid(format!(
                "sheet sequence `{}` declares no frames",
                sequence.slug
            )));
        }
        if let Some(&frame) = sequence.frames.iter().find(|frame| !frames.contains(frame)) {
            return Err(invalid(format!(
                "sheet sequence `{}` references frame {frame}, which is not a declared \
                 [[sheet.frame]]",
                sequence.slug
            )));
        }
        if !(sequence.fps.is_finite() && sequence.fps > 0.0) {
            return Err(invalid(format!(
                "sheet sequence `{}` must declare an fps greater than zero",
                sequence.slug
            )));
        }
        let name = sequence
            .name
            .clone()
            .unwrap_or_else(|| humanize(&sequence.slug));
        sequences.push(SheetSequence {
            slug: sequence.slug.clone(),
            name,
            frames: sequence.frames.clone(),
            fps: sequence.fps,
        });
    }

    Ok(SheetSpec {
        frame_width,
        frame_height,
        frames,
        sequences,
    })
}

/// Resolve and validate a voxel-animation case's `[model]` table into the required
/// [`ModelSpec`] — the stable, game-facing rig contract and the scoring targets.
///
/// Every declared part must carry a unique, non-empty name; the first part is the
/// root (no `parent`), and every other part's `parent` must name a declared part
/// with no cycles. Every joint must carry a unique non-empty name, reference a
/// declared part, and parse its `kind`/`axis`/`drive` with `min <= rest <= max`. An
/// `auto` joint must have exactly one matching `[[model.clip]]` (and a `caller`
/// joint none); every clip must reference a declared `auto` joint. `invalid` is the
/// resolver's error constructor, threaded in so messages carry the case's slug and
/// version.
fn resolve_model(model: &ManifestModel, invalid: &impl Fn(String) -> Error) -> Result<ModelSpec> {
    if model.part.is_empty() {
        return Err(invalid(
            "a [model] must declare at least one [[model.part]]".to_string(),
        ));
    }

    // Parts: unique, non-empty names.
    let mut parts: Vec<PartSpec> = Vec::with_capacity(model.part.len());
    for part in &model.part {
        if part.name.trim().is_empty() {
            return Err(invalid("model part `name` must not be empty".to_string()));
        }
        if parts.iter().any(|p| p.name == part.name) {
            return Err(invalid(format!(
                "duplicate model part name `{}`",
                part.name
            )));
        }
        parts.push(PartSpec {
            name: part.name.clone(),
            parent: part.parent.clone(),
            pivot: part.pivot.unwrap_or([0, 0, 0]),
        });
    }
    // The first declared part is the root, so it must have no parent.
    if parts[0].parent.is_some() {
        return Err(invalid(format!(
            "the first model part `{}` is the root and must declare no `parent`",
            parts[0].name
        )));
    }
    // Every declared parent must reference a declared part, and no part may be its
    // own parent.
    for part in &parts {
        if let Some(parent) = &part.parent {
            if parent == &part.name {
                return Err(invalid(format!(
                    "model part `{}` is its own parent",
                    part.name
                )));
            }
            if !parts.iter().any(|p| &p.name == parent) {
                return Err(invalid(format!(
                    "model part `{}` names parent `{}`, which is not a declared part",
                    part.name, parent
                )));
            }
        }
    }
    // No cycles: walking any part's parent chain must reach a root within `len`
    // hops (a longer walk means it revisited a part, i.e. a cycle).
    for part in &parts {
        let mut current = part;
        let mut hops = 0usize;
        while let Some(parent) = &current.parent {
            current = parts
                .iter()
                .find(|p| &p.name == parent)
                .expect("parent references validated above");
            hops += 1;
            if hops > parts.len() {
                return Err(invalid(format!(
                    "model part `{}` is part of a parent cycle",
                    part.name
                )));
            }
        }
    }

    // Joints: unique non-empty names referencing declared parts, with parseable
    // kind/axis/drive and a valid `[min, rest, max]` range.
    let mut joints: Vec<JointSpec> = Vec::with_capacity(model.joint.len());
    for joint in &model.joint {
        if joint.name.trim().is_empty() {
            return Err(invalid("model joint `name` must not be empty".to_string()));
        }
        if joints.iter().any(|j| j.name == joint.name) {
            return Err(invalid(format!(
                "duplicate model joint name `{}`",
                joint.name
            )));
        }
        if !parts.iter().any(|p| p.name == joint.part) {
            return Err(invalid(format!(
                "model joint `{}` names part `{}`, which is not a declared part",
                joint.name, joint.part
            )));
        }
        let kind = match joint.kind.as_str() {
            "rotation" => JointKindSpec::Rotation,
            "translation" => JointKindSpec::Translation,
            other => {
                return Err(invalid(format!(
                    "model joint `{}` has invalid kind `{other}` (expected `rotation` or \
                     `translation`)",
                    joint.name
                )));
            }
        };
        let axis = match joint.axis.as_str() {
            "x" => AxisSpec::X,
            "y" => AxisSpec::Y,
            "z" => AxisSpec::Z,
            other => {
                return Err(invalid(format!(
                    "model joint `{}` has invalid axis `{other}` (expected `x`, `y`, or `z`)",
                    joint.name
                )));
            }
        };
        let drive = match joint.drive.as_str() {
            "caller" => DriveKindSpec::Caller,
            "auto" => DriveKindSpec::Auto,
            other => {
                return Err(invalid(format!(
                    "model joint `{}` has invalid drive `{other}` (expected `caller` or `auto`)",
                    joint.name
                )));
            }
        };
        if !(joint.min.is_finite() && joint.max.is_finite() && joint.rest.is_finite()) {
            return Err(invalid(format!(
                "model joint `{}` has a non-finite min/max/rest",
                joint.name
            )));
        }
        if !(joint.min <= joint.rest && joint.rest <= joint.max) {
            return Err(invalid(format!(
                "model joint `{}` must satisfy min <= rest <= max",
                joint.name
            )));
        }
        joints.push(JointSpec {
            name: joint.name.clone(),
            part: joint.part.clone(),
            kind,
            axis,
            pivot: joint.pivot,
            min: joint.min,
            max: joint.max,
            rest: joint.rest,
            drive,
            auto: None,
        });
    }

    // Clips: each attaches an auto-play timeline to an `auto` joint. Validate the
    // reference and the timeline, then fold it into the joint's `auto` field.
    for clip in &model.clip {
        let Some(joint) = joints.iter_mut().find(|j| j.name == clip.joint) else {
            return Err(invalid(format!(
                "model clip names joint `{}`, which is not a declared joint",
                clip.joint
            )));
        };
        if joint.drive != DriveKindSpec::Auto {
            return Err(invalid(format!(
                "model clip names joint `{}`, which is not an `auto` joint",
                clip.joint
            )));
        }
        if joint.auto.is_some() {
            return Err(invalid(format!(
                "model joint `{}` declares more than one [[model.clip]]",
                clip.joint
            )));
        }
        if clip.period_ms == 0 {
            return Err(invalid(format!(
                "model clip for joint `{}` must declare a `period_ms` greater than zero",
                clip.joint
            )));
        }
        if clip.keyframes.is_empty() {
            return Err(invalid(format!(
                "model clip for joint `{}` declares no keyframes",
                clip.joint
            )));
        }
        let mut keyframes = Vec::with_capacity(clip.keyframes.len());
        for [t_ms, value] in &clip.keyframes {
            if !(t_ms.is_finite() && value.is_finite()) {
                return Err(invalid(format!(
                    "model clip for joint `{}` has a non-finite keyframe",
                    clip.joint
                )));
            }
            if *t_ms < 0.0 || *t_ms > f64::from(clip.period_ms) {
                return Err(invalid(format!(
                    "model clip for joint `{}` has a keyframe `t_ms` outside `0..=period_ms`",
                    clip.joint
                )));
            }
            keyframes.push(KeyframeSpec {
                t_ms: *t_ms as u32,
                value: *value,
            });
        }
        joint.auto = Some(AutoPlaySpec {
            keyframes,
            period_ms: clip.period_ms,
            looping: clip.r#loop,
        });
    }

    // Every `auto` joint needs its clip; a `caller` joint never carries one.
    if let Some(joint) = joints
        .iter()
        .find(|j| j.drive == DriveKindSpec::Auto && j.auto.is_none())
    {
        return Err(invalid(format!(
            "model joint `{}` is `auto` but declares no [[model.clip]]",
            joint.name
        )));
    }

    // Animations: each is a named, predetermined clip spanning one or more of the
    // rig's joints. Validate the name, period, and every track's joint reference and
    // keyframe timeline, then build the resolved [`AnimationSpec`]s.
    let mut animations: Vec<AnimationSpec> = Vec::with_capacity(model.animation.len());
    for animation in &model.animation {
        if animation.name.trim().is_empty() {
            return Err(invalid(
                "model animation `name` must not be empty".to_string(),
            ));
        }
        if animations.iter().any(|a| a.name == animation.name) {
            return Err(invalid(format!(
                "duplicate model animation name `{}`",
                animation.name
            )));
        }
        if animation.period_ms == 0 {
            return Err(invalid(format!(
                "model animation `{}` must declare a `period_ms` greater than zero",
                animation.name
            )));
        }
        if animation.track.is_empty() {
            return Err(invalid(format!(
                "model animation `{}` declares no [[model.animation.track]]",
                animation.name
            )));
        }
        let mut tracks: Vec<AnimationTrackSpec> = Vec::with_capacity(animation.track.len());
        for track in &animation.track {
            if !joints.iter().any(|j| j.name == track.joint) {
                return Err(invalid(format!(
                    "model animation `{}` has a track for joint `{}`, which is not a declared \
                     joint",
                    animation.name, track.joint
                )));
            }
            if tracks.iter().any(|t| t.joint == track.joint) {
                return Err(invalid(format!(
                    "model animation `{}` declares more than one track for joint `{}`",
                    animation.name, track.joint
                )));
            }
            if track.keyframes.is_empty() {
                return Err(invalid(format!(
                    "model animation `{}` track for joint `{}` declares no keyframes",
                    animation.name, track.joint
                )));
            }
            let mut keyframes = Vec::with_capacity(track.keyframes.len());
            for [t_ms, value] in &track.keyframes {
                if !(t_ms.is_finite() && value.is_finite()) {
                    return Err(invalid(format!(
                        "model animation `{}` track for joint `{}` has a non-finite keyframe",
                        animation.name, track.joint
                    )));
                }
                if *t_ms < 0.0 || *t_ms > f64::from(animation.period_ms) {
                    return Err(invalid(format!(
                        "model animation `{}` track for joint `{}` has a keyframe `t_ms` outside \
                         `0..=period_ms`",
                        animation.name, track.joint
                    )));
                }
                keyframes.push(KeyframeSpec {
                    t_ms: *t_ms as u32,
                    value: *value,
                });
            }
            tracks.push(AnimationTrackSpec {
                joint: track.joint.clone(),
                keyframes,
            });
        }
        animations.push(AnimationSpec {
            name: animation.name.clone(),
            period_ms: animation.period_ms,
            looping: animation.r#loop,
            tracks,
        });
    }

    Ok(ModelSpec {
        parts,
        joints,
        animations,
    })
}

/// Recursively enumerate the files under a workspace directory into
/// [`WorkspaceFile`]s, computing each file's `dest` as its path relative to
/// `base` (the workspace directory's root). Directories are descended into;
/// only files become entries, so an empty directory contributes nothing.
///
/// Hidden entries (names beginning with `.`) are skipped, matching how the
/// backend copies a version folder into its store: a dotfile would be listed
/// here but never distributed, so a backend-driven run would fail to fetch it.
/// Keeping the two in lockstep means a workspace seeds the same set locally and
/// remotely. A short allowlist of dotfiles a case legitimately ships is excepted
/// (and likewise preserved by the backend's `copy_tree`); see
/// [`is_seeded_dotfile`].
/// Render a relative path with forward slashes so a workspace file's dest is
/// stable across hosts (a Windows `\` separator would otherwise leak into the
/// run-relative dest and the serialized manifest).
fn forward_slash_path(rel: &Path) -> PathBuf {
    PathBuf::from(
        rel.components()
            .filter_map(|component| component.as_os_str().to_str())
            .collect::<Vec<_>>()
            .join("/"),
    )
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
///
/// This is the single source of truth for both local seeding
/// ([`collect_workspace_files`]) and backend ingest (`copy_tree`), so the two
/// always seed the same set. Matching is by the entry's own name, so a `.cargo`
/// directory is descended into and its (non-hidden) contents seeded.
pub fn is_seeded_dotfile(name: &str) -> bool {
    matches!(name, ".gitignore" | ".cargo")
}

fn collect_workspace_files(
    base: &Path,
    dir: &Path,
    out: &mut Vec<WorkspaceFile>,
) -> std::io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        // Hidden entries are skipped to match how a version folder is distributed,
        // except the small allowlist a case may ship (`.gitignore`, `.cargo`); see
        // `is_seeded_dotfile`. Kept in lockstep with the backend's `copy_tree`.
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        if file_name.starts_with('.') && !is_seeded_dotfile(&file_name) {
            continue;
        }
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            collect_workspace_files(base, &path, out)?;
        } else {
            // Normalize the dest to forward slashes so the seeded path — and the
            // serialized manifest — are stable regardless of the host that
            // resolved the workspace; otherwise a Windows host's `\` separator
            // would leak into the run-relative dest.
            let dest = path
                .strip_prefix(base)
                .map(forward_slash_path)
                .unwrap_or_else(|_| path.clone());
            out.push(WorkspaceFile {
                source_path: path,
                dest,
            });
        }
    }
    Ok(())
}

/// Humanize a slug into a display name by splitting on `-`/`_` and capitalizing
/// each word (for example `game-over` becomes `Game Over`).
fn humanize(slug: &str) -> String {
    slug.split(['-', '_'])
        .filter(|word| !word.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().chain(chars).collect::<String>(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Whether a relative path would escape the folder it is resolved against.
///
/// A path escapes if it is absolute, or if its `..` components ever rise above
/// its starting point. `.` components are ignored.
fn escapes_folder(rel: &Path) -> bool {
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

#[cfg(test)]
#[path = "test_case.test.rs"]
mod tests;
