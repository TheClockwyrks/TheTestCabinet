//! Test case catalog: slugs, versions, and resolution.
//!
//! See `docs/testing/end-to-end/overview.md`. Test cases live under a top-level `test-cases/`
//! folder laid out as `test-cases/<type>/<difficulty>/<slug>/<version>/` — the
//! `<type>` and `<difficulty>` levels group the catalog for browsing on disk; a
//! case's identity, type, and difficulty are declared in its manifest, not
//! inferred from its location. Each version is self-contained and immutable.

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
///
/// `Default` is derived so a [`GameJamManifest`] — a jam's own, deliberately
/// smaller on-disk format — can be lowered onto this shared shape by setting only
/// the handful of fields a jam declares and leaving every spec-driven table at its
/// empty default (see [`GameJamManifest::into_case`]).
#[derive(Debug, Clone, PartialEq, Default, Deserialize)]
struct Manifest {
    /// The case's **stable identity**, recorded in every run and used as the
    /// definition-store key. **Required.** It is declared explicitly rather than
    /// derived from the folder name so identity is **decoupled from the folder**:
    /// a case's folder can be renamed for tidiness while the slug its published
    /// runs already reference stays put, so the rename neither orphans those runs
    /// nor spawns a duplicate. Must be a valid slug (see [`is_valid_slug`]) and,
    /// so a case has one identity, must be declared identically on every version
    /// of the folder. In the common case it simply equals the folder name.
    slug: String,
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
    /// The per-version changelog entry, relative to the version folder, pointing at
    /// a Markdown file (for example `changelog.md`). **Required** — every version
    /// must record what changed **in it** so no revision ships without a note (the
    /// first version typically just reads "Introduced."). The site aggregates every
    /// version's entry into a single newest-first changelog on the case's detail
    /// page. Like [`Self::description`] it is site-facing only and **not** seeded
    /// into runs.
    changelog: PathBuf,
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
    /// Whether this version is **experimental** — still being iterated on and not
    /// yet ready to have runs published for it. Applies to every test type.
    /// Defaults to `false` so a case is treated as ready unless it opts in.
    /// The backend hides experimental versions from every outward-facing surface
    /// (the console catalog and version resolution) unless the deployment opts in
    /// via `TCAB_BACKEND_ALLOW_EXPERIMENTAL`, so on a deployment that has not
    /// enabled them an experimental case is invisible — and thus never run or
    /// published. Carried onto the resolved [`TestCaseVersion::experimental`].
    #[serde(default)]
    experimental: bool,
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
    /// The optional kit of elements a `ui` case declares (the `[ui]` table). Only
    /// valid for `asset_kind = "ui"`; omitting it makes the case a single implicit
    /// full-`[canvas]` element.
    #[serde(default)]
    ui: Option<ManifestUi>,
    /// The tileable-PBR-material output a `material` case declares (the `[material]`
    /// table). Required for — and only for — `asset_kind = "material"`.
    #[serde(default)]
    material: Option<ManifestMaterial>,
    /// The field/timing a particle case plays in (the `[particle]` table). Required
    /// for — and only for — the two particle kinds (`asset_kind = "particle-2d"` /
    /// `"particle-3d"`).
    #[serde(default)]
    particle: Option<ManifestParticle>,
    /// The output format of an audio case's clip (the `[audio]` table). Required for
    /// — and only for — the three audio kinds (`asset_kind = "sfx-synth"` /
    /// `"sfx-sample"` / `"music"`).
    #[serde(default)]
    audio: Option<ManifestAudio>,
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
    /// The Test Cabinet runtime libraries this case's build `import`s — the repo's
    /// own `@test-cabinet/*` packages, named by npm name (for example
    /// `@test-cabinet/particle-runtime`). Each is baked into the run image under
    /// [`TCAB_PACKAGES_DIR`], and the case's own workspace `package.json` already
    /// declares it as the matching `file:` dependency (see
    /// [`tcab_package_file_dep`]) — the harness does not modify `package.json`, so
    /// the shipped file must be correct for the run environment on its own. A game
    /// then consumes a produced asset that needs a runtime to play it (a particle
    /// `system.json`, a voxel rig) as an ordinary installed dependency. This key is
    /// the declaration the harness validates that `package.json` against: end-to-end
    /// only, each name one of [`SHIPPABLE_PACKAGES`], and each declared as its
    /// `file:` dependency in the workspace `package.json`. `None`/empty requests no
    /// packages.
    #[serde(default)]
    packages: Vec<String>,
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

/// Just the identity fields of a manifest, parsed on their own so the catalog can
/// read a case's `slug` without parsing (or being tripped up by an unrelated error
/// in) the whole manifest. Serde ignores the other fields, so this succeeds on any
/// syntactically valid manifest that declares a `slug`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
struct ManifestIdentity {
    /// The case's stable slug. See [`Manifest::slug`].
    slug: String,
}

/// The on-disk `game-jam.toml` manifest for a single game-jam version.
///
/// A game jam is **not** a test case, so it is authored through its own manifest
/// format rather than the shared [`Manifest`] — it declares only the handful of
/// fields a theme-only build actually has. Two fields a test case carries are
/// deliberately absent:
///
///   - **no `difficulty`** — a jam is inherently unclassified. The model decides
///     what to build from the theme, so there is no tier to bracket it into.
///   - **no `variants`** — a jam is one theme. A differently themed jam is a
///     different jam, never a variant of this one.
///
/// It likewise declares none of the `[[spec]]`, `[[reference]]`, `[[domain]]`, or
/// asset tables a spec-driven case uses. Deserialization is `deny_unknown_fields`,
/// so a jam manifest that reaches for `difficulty`, `variants`, or any other
/// test-case-only key is **rejected** with a clear error rather than silently
/// carrying a meaningless value. See `docs/testing/game-jam/manifests.md`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
struct GameJamManifest {
    /// The jam's **stable identity** (the definition-store key). See
    /// [`Manifest::slug`].
    slug: String,
    /// Human-readable display name, surfaced on the site.
    name: String,
    /// Free-form classification tags surfaced on the site. Optional (defaults to
    /// empty): a jam is not tiered, so it carries only whatever tags describe its
    /// theme.
    #[serde(default)]
    tags: Vec<String>,
    /// Optional one- or two-sentence abstract shown on the jam card. Not seeded.
    #[serde(default)]
    summary: Option<String>,
    /// Optional site-facing prose (a Markdown file relative to the version folder).
    /// Not seeded — it introduces the jam on the site.
    #[serde(default)]
    description: Option<PathBuf>,
    /// The per-version changelog entry (a Markdown file relative to the version
    /// folder). **Required**, like a test case's. Not seeded.
    changelog: PathBuf,
    /// The theme brief handed to the harness (a Handlebars template relative to the
    /// version folder). **Required**. The standing game-jam preamble is prepended
    /// by the harness (see [`crate::prompt`]).
    prompt: PathBuf,
    /// The maximum wall-clock runtime, in **hours**, for the harness session.
    /// Defaults to [`default_max_runtime_hours`] when omitted so a run is never
    /// unbounded. Also surfaced to the model in the prompt as its time budget.
    #[serde(default = "default_max_runtime_hours")]
    max_runtime_hours: f64,
    /// Whether this version is experimental (hidden unless a deployment opts in via
    /// `TCAB_BACKEND_ALLOW_EXPERIMENTAL`). See [`Manifest::experimental`].
    #[serde(default)]
    experimental: bool,
    /// Optional starter workspace directory seeded into the run root before the
    /// harness starts (for example a `package.json` pinning Playwright). See
    /// [`Manifest::workspace`].
    #[serde(default)]
    workspace: Option<PathBuf>,
    /// Optional init command run once after the workspace is seeded and before the
    /// harness starts. See [`Manifest::init`].
    #[serde(default)]
    init: Option<String>,
    /// The Test Cabinet runtime libraries the produced build imports (see
    /// [`Manifest::packages`]).
    #[serde(default)]
    packages: Vec<String>,
    /// How the validator (and the per-run deploy) builds the produced game into a
    /// served static site — the same fixed build interface a full-stack case uses
    /// (the `[build]` table). **Required**: every jam ships a playable build.
    build: ManifestBuild,
    /// Optional reviewer categories, each graded on the five-level scale. A jam that
    /// declares none gets the generic graded checklist
    /// ([`default_game_jam_review_items`]). Declared as repeated `[[review_item]]`
    /// tables.
    #[serde(default, rename = "review_item")]
    review_items: Vec<ManifestReviewItem>,
}

/// The internal difficulty carried by a resolved game jam. A jam declares no
/// difficulty on disk (it is unclassified — see [`GameJamManifest`]); this
/// placeholder only keeps the shared [`TestCaseVersion`] shape uniform. It is
/// never surfaced — the jam UI shows no difficulty badge, and jams are excluded
/// from the tiered test-case catalog.
const GAME_JAM_DIFFICULTY: &str = "unrated";

/// The slug of the single implicit variant every game jam runs.
///
/// A jam declares no variants, but the run pipeline always selects exactly one
/// variant per run, so resolution synthesizes this one bare theme-selector variant
/// (it seeds nothing of its own — the jam's whole brief is the prompt). It is never
/// authored, so its slug is fixed here.
const GAME_JAM_VARIANT_SLUG: &str = "default";

impl GameJamManifest {
    /// Lower a jam manifest onto the shared internal representation resolution
    /// already understands: a [`Manifest`] whose type is [`TestType::GameJam`] with
    /// every spec-driven table left empty, and the single implicit
    /// [`ManifestVariant`] a jam runs. This lets a jam keep its own small on-disk
    /// format while reusing the one resolution path (and all its validation) rather
    /// than duplicating it.
    fn into_case(self) -> (Manifest, ManifestVariant) {
        let manifest = Manifest {
            slug: self.slug,
            name: self.name,
            difficulty: GAME_JAM_DIFFICULTY.to_string(),
            tags: self.tags,
            summary: self.summary,
            description: self.description,
            changelog: self.changelog,
            prompt: self.prompt,
            max_runtime_hours: self.max_runtime_hours,
            test_type: TestType::GameJam,
            experimental: self.experimental,
            workspace: self.workspace,
            init: self.init,
            packages: self.packages,
            build: Some(self.build),
            review_items: self.review_items,
            ..Manifest::default()
        };
        let variant = ManifestVariant {
            slug: GAME_JAM_VARIANT_SLUG.to_string(),
            ..ManifestVariant::default()
        };
        (manifest, variant)
    }
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
/// clear color behind the rendered preview PNG (the voxel volume itself always
/// starts empty).
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
/// consuming game or an animation drives, and the **required animation
/// declarations** (a name, its intent, and the joints it must drive — but no
/// keyframes). These are the stable, game-facing contract and the scoring targets;
/// at run time the model authors each required animation's motion and may add
/// further parts, joints, and animations of its own (recorded in `rig.json`) beyond
/// what this table requires.
// `ManifestModel` owns `ManifestJoint`, which carries `f64` limit fields and so cannot be
// `Eq`; the manifest structs are only ever deserialized and resolved, never compared, so
// `PartialEq` alone suffices.
#[derive(Debug, Clone, PartialEq, Deserialize)]
struct ManifestModel {
    /// The required animation declarations, as repeated `[[model.animation]]`
    /// tables — the animations the model must author. A case declares **only**
    /// animations: it names each required animation (and whether it is a
    /// self-playing idle or a game-triggered playable), and leaves the parts,
    /// joints, and F-curve motion that realize it entirely to the model.
    #[serde(default, rename = "animation")]
    animation: Vec<ManifestAnimation>,
    /// The required **caller joints**, as repeated `[[model.joint]]` tables — the
    /// game-facing procedural DOFs a consuming game drives at runtime (a turret's
    /// `turret_yaw`, a character's `aim_pitch`). Optional. Used today by the **Blender**
    /// kinds, whose model tags the driven glTF node's `extras` with the DOF descriptor so
    /// the interface travels in the emitted glTF itself (see
    /// [`crate::validator`]); the validator reconciles the emitted glTF against this set.
    /// Empty when a case fixes no procedural interface (only animations).
    #[serde(default, rename = "joint")]
    joint: Vec<ManifestJoint>,
}

/// A single `[[model.joint]]` entry: one **required caller DOF** the game drives at
/// runtime. A case fixes the DOF's **identity and range** — its `name`, whether it
/// rotates or translates, the axis, and the `min`/`max`/`rest` limits (rotation limits in
/// **degrees**, translation limits in world units) — and the model builds a node that
/// realizes it and tags that node's glTF `extras` so a game can find and clamp it. Unlike
/// an animation clip (which the game plays), a caller joint is what the game *sets* each
/// frame from its own state.
#[derive(Debug, Clone, PartialEq, Deserialize)]
struct ManifestJoint {
    /// Stable, unique name a game addresses this DOF by (e.g. `turret_yaw`).
    name: String,
    /// Whether the DOF rotates or translates the driven node.
    kind: JointKindSpec,
    /// The axis the DOF acts about (rotation) or along (translation).
    axis: AxisSpec,
    /// Minimum value — **degrees** for a rotation, world units for a translation.
    min: f64,
    /// Maximum value (same units as `min`).
    max: f64,
    /// The rest / default value, within `[min, max]` (same units as `min`).
    rest: f64,
}

/// A single `[[model.animation]]` entry: one **required** animation the model must
/// author. A case declares only the animation's **identity** — its `name` and
/// whether it `loop`s and/or `auto_play`s — never its parts, joints, period, or
/// keyframes. The model invents whatever rig (parts and joints) it needs, authors the
/// F-curve motion (and chooses the period) at run time with the
/// `define-animation`/`add-keyframe` subcommands, and the reviewer scores the motion
/// it produced against the brief.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestAnimation {
    /// Stable, unique name a game plays this animation by.
    name: String,
    /// Whether the animation loops (true) or plays once and holds the last pose
    /// (false). Defaults to `true`. `loop` is a Rust keyword, so the field is
    /// `r#loop`.
    #[serde(default = "default_true")]
    r#loop: bool,
    /// Whether the animation plays continuously by default (a decorative idle, such
    /// as a sweeping radar) or is a named playable a game triggers (a walk, a
    /// recoil). Defaults to `false`.
    #[serde(default)]
    auto_play: bool,
}

/// The serde default for [`ManifestAnimation::r#loop`] — most animations loop.
fn default_true() -> bool {
    true
}

/// The `[ui]` table of a `ui` asset-generation case: the optional kit of named
/// elements the model paints. Absent means the case is a single implicit element
/// (the whole `[canvas]`).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestUi {
    /// The declared elements, as repeated `[[ui.element]]` tables. At least one is
    /// required when the `[ui]` table is present; names must be unique.
    #[serde(default, rename = "element")]
    element: Vec<ManifestUiElement>,
}

/// A single `[[ui.element]]` entry: one named element of a UI kit, its size, and an
/// optional fixed nine-slice.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestUiElement {
    /// Stable, unique element name (targeted with `--element <name>`).
    name: String,
    /// Element width in pixels.
    width: u32,
    /// Element height in pixels.
    height: u32,
    /// Optional fixed stretchable insets. When omitted the model authors them with
    /// `ui set-nine-slice`.
    #[serde(default)]
    nine_slice: Option<ManifestNineSlice>,
}

/// The `nine_slice = { left, right, top, bottom }` insets of a `[[ui.element]]`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
struct ManifestNineSlice {
    /// Left inset in pixels.
    left: u32,
    /// Right inset in pixels.
    right: u32,
    /// Top inset in pixels.
    top: u32,
    /// Bottom inset in pixels.
    bottom: u32,
}

/// The `[material]` table of a `material` asset-generation case: the tileable PBR
/// material's output resolution, seamlessness, and emitted channels.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestMaterial {
    /// Square map resolution in pixels (must be a power of two, greater than zero).
    size: u32,
    /// Whether the maps are authored seamlessly (wrap toroidally). Defaults to
    /// `true` (required for triplanar application).
    #[serde(default = "default_true")]
    tile: bool,
    /// The channels the material emits. Must include `base-color`; the rest are any
    /// subset of `normal` / `roughness` / `metallic` / `ao` / `emissive`.
    maps: Vec<String>,
    /// Preview clear color: `transparent` or a hex color.
    #[serde(default = "default_background")]
    background: String,
}

/// The `[particle]` table of a particle asset-generation case: the field the effect
/// plays in and its playback timing. A `particle-2d` case omits `depth`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
struct ManifestParticle {
    /// Field extent along x.
    width: u32,
    /// Field extent along y (up).
    height: u32,
    /// Field extent along z. Required for `particle-3d`, omitted for `particle-2d`.
    #[serde(default)]
    depth: Option<u32>,
    /// The effect's length in milliseconds.
    duration_ms: u32,
    /// Preview/playback frame rate (must be greater than zero).
    fps: f64,
    /// Whether the effect loops (a steady-state fire/smoke) or is one-shot (an
    /// explosion, the default). `loop` is a Rust keyword, so the field is `r#loop`.
    #[serde(default)]
    r#loop: bool,
    /// Preview clear color: `transparent` or a hex color.
    #[serde(default = "default_background")]
    background: String,
}

/// The `[audio]` table of an audio asset-generation case: the rendered clip's output
/// format and (for the sample/instrument kinds) the baked palette it draws from.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestAudio {
    /// Output sample rate in Hz.
    sample_rate: u32,
    /// Channel layout: `mono` or `stereo`.
    channels: String,
    /// Cap on the rendered clip's length in milliseconds.
    max_duration_ms: u32,
    /// For `sfx-sample`: the baked sample pack (`name@version`) the clip mixes over.
    #[serde(default)]
    sample_pack: Option<String>,
    /// For `music`: the baked instrument bank (`name@version`) the clip plays.
    #[serde(default)]
    instrument_bank: Option<String>,
}

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
    /// The role this seeded file plays (`spec` — the default — or `script`).
    /// Presentation only: it changes how the Inputs surfaces tag the file, not how
    /// it is seeded. Set `kind = "script"` for an executable starter the model
    /// edits and runs (for example the Blender case's `build.py`).
    #[serde(default)]
    kind: SpecKind,
}

/// A standalone variant manifest, parsed from its own file listed in the case
/// manifest's `variants` array (by convention `variants/<slug>.toml`). Its
/// top-level tables are this struct's fields; every path it names is resolved
/// relative to the **version folder**, not the variant file's location, so a
/// variant references `specs/modes/gyre.md` exactly as the main manifest would.
///
/// `Default` is derived so resolution can synthesize the single bare theme-selector
/// variant a game jam runs (a jam declares no variant files); see
/// [`GameJamManifest::into_case`] and [`GAME_JAM_VARIANT_SLUG`].
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
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
    /// Optional per-variant bounding volume for a voxel case. When present it
    /// **replaces** the case's common `[voxel]` volume for runs of this variant
    /// (it is not additive), so the same subject can be sculpted at a different
    /// size — the axis behind a case's half/base/double size variants. `None`
    /// falls back to the case's `[voxel]`. Declaring a `[voxel]` on a variant of a
    /// non-voxel case is rejected.
    #[serde(default)]
    voxel: Option<ManifestVoxel>,
    /// Optional **reference implementation**: a directory, relative to the version
    /// folder, holding a buildable static web project that is the *correct*
    /// implementation of this variant. Unlike every other path a variant names,
    /// this one is **never seeded into a run** — handing a model the finished game
    /// would defeat the test. Instead it is built out-of-band (with the case's
    /// existing `[build]` install/build commands, run from this directory, the
    /// static output landing in the same `dist/`|`build/`|`out/` a run's build
    /// produces) and deployed like a published run build, then shown on the case's
    /// "Reference" tab as the authored answer. The value is a bare directory path;
    /// resolution validates it exists and stays inside the version folder. `None`
    /// leaves the variant with no reference build. It is the case-variant analogue
    /// of a run record's `links.playableBuild`.
    #[serde(default)]
    reference_implementation: Option<PathBuf>,
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
    /// When the item declares `sub_items`, this weight is split evenly across
    /// them (each sub-item is worth `weight / sub_items.len()` points).
    weight: u32,
    /// Optional scoring domain this item belongs to. Must name a declared
    /// `[[domain]]`. `None` for a general item that belongs to no single domain.
    #[serde(default)]
    domain: Option<String>,
    /// Optional name-only sub-items breaking this item into independently graded
    /// points (an academic question's "2a", "2b"). When present, the reviewer
    /// records a pass/fail per sub-item instead of one for the item as a whole,
    /// and the item's `weight` is split evenly across them. Declared as an inline
    /// array of `{ id, title }` tables (or repeated `[[review_item.sub_item]]`
    /// tables).
    #[serde(default, rename = "sub_item", alias = "sub_items")]
    sub_items: Vec<ManifestSubReviewItem>,
}

/// A single name-only sub-item of a `[[review_item]]`: an independently graded
/// point within the item, carrying only an id (which keys its verdict) and a
/// title (its heading in the reviewer UI). It has no prose of its own — the
/// parent item's `text` is the shared context, and the sub-item's title names
/// the specific point.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestSubReviewItem {
    /// Stable slug identifying this sub-item within its parent item. The verdict
    /// recorded against it is keyed by the composite `<item id>.<sub-item id>`
    /// (see [`ReviewItem::sub_item_verdict_id`]).
    id: String,
    /// The short heading shown for this sub-item in the reviewer UI (a
    /// synthesized letter is prefixed at display time).
    title: String,
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

/// The manifest file name expected in every test-case version folder.
const MANIFEST_FILE: &str = "test-case.toml";

/// The manifest file name expected in every game-jam version folder. A jam is not
/// a test case and is authored through its own [`GameJamManifest`] format, so it
/// ships a `game-jam.toml` rather than a `test-case.toml` — the filename itself
/// signals it is not the shared test-case manifest.
const GAME_JAM_MANIFEST_FILE: &str = "game-jam.toml";

/// The top-level directory holding [game-jam](TestType::GameJam) cases — a sibling
/// of `test-cases/`, laid out `game-jams/<slug>/<version>/`. Discovery folds it
/// into the same catalog (see [`TestCaseCatalog::case_folders`]).
const GAME_JAMS_DIR: &str = "game-jams";

/// Whether a catalog `folder` (relative to the `test-cases/` root) is a game jam.
///
/// Discovery expresses a jam's folder relative to the catalog root as
/// `../game-jams/<slug>` (see [`TestCaseCatalog::case_folders`]); no spec-driven
/// case folder starts with `../`, so the prefix is an unambiguous marker. This is
/// what routes a jam to its own [`GameJamManifest`] parser and `game-jam.toml`
/// filename, both during the catalog slug scan and full resolution.
fn is_game_jam_folder(folder: &str) -> bool {
    folder.starts_with(&format!("../{GAME_JAMS_DIR}/"))
}

/// The manifest filename to read for a catalog `folder`: `game-jam.toml` for a jam,
/// `test-case.toml` otherwise.
fn manifest_file_for(folder: &str) -> &'static str {
    if is_game_jam_folder(folder) {
        GAME_JAM_MANIFEST_FILE
    } else {
        MANIFEST_FILE
    }
}

/// The host **package store** the shippable Test Cabinet packages are baked into
/// on the driver image (which seeds runs — see `containers/README.md`). At seed
/// time a `packages`-declaring case's requested libraries are copied out of this
/// store and **vendored into the run repository** under [`TCAB_VENDOR_DIR`], so the
/// produced tree is self-contained. This is a build-host path, never referenced by
/// the produced game.
pub const TCAB_PACKAGES_DIR: &str = "/opt/tcab-packages";

/// The in-repository directory a `packages`-declaring case's runtime libraries are
/// vendored into at seed time (relative to the run root). The case's workspace
/// `package.json` depends on each via an in-repo relative `file:` path pointing
/// here (see [`tcab_package_file_dep`]), so the dependency resolves identically
/// wherever the tree lives — the run container, the validation host, and any clone
/// of the published repository — with no absolute path to break when it moves.
pub const TCAB_VENDOR_DIR: &str = ".tcab/packages";

/// One of the Test Cabinet's own `@test-cabinet/*` runtime libraries a case may
/// ship into a run via the manifest's `packages` key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShippablePackage {
    /// The npm package name a case declares in `packages` (for example
    /// `@test-cabinet/particle-runtime`).
    pub name: &'static str,
    /// A short, human-readable description of what the package does, surfaced in
    /// the Inputs UI beside the case's declared packages. This is **UI-only**: it
    /// is never seeded into a run, so it can name what a build uses the library
    /// for. The single source of truth for the description of every shippable
    /// package.
    pub description: &'static str,
}

/// The Test Cabinet's own `@test-cabinet/*` runtime libraries an end-to-end case
/// may request via the manifest's `packages` key. Each is baked into the host
/// package store ([`TCAB_PACKAGES_DIR`]) and, at seed time, vendored into the run
/// repository under [`TCAB_VENDOR_DIR`], which the case's workspace `package.json`
/// declares as an in-repo relative `file:` dependency, so a built game can
/// `import` it to play a produced asset (a particle `system.json`, a voxel rig)
/// the same way the in-repo viewers do.
///
/// This list is the allowlist a case's `packages` names are validated against
/// (see [`is_shippable_package`]), and it also carries each package's UI-only
/// description (see [`shippable_package_description`]). Its **names** **must stay
/// in lockstep** with the shippable list in `scripts/stage-tcab-packages.mjs`,
/// which bakes exactly these into the image: a name here but not there resolves to
/// a missing dependency at run time, and a name there but not here can never be
/// requested. (The descriptions are UI metadata and live only here.)
pub const SHIPPABLE_PACKAGES: &[ShippablePackage] = &[
    ShippablePackage {
        name: "@test-cabinet/particle-runtime",
        description: "The particle runtime the review UI plays produced effects with. A build \
                      imports its `/canvas` binding to load a seeded particle `system.json` and \
                      simulate it live on a canvas, so a produced burst plays the same way the \
                      gallery plays it.",
    },
    ShippablePackage {
        name: "@test-cabinet/voxel-runtime",
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
pub(crate) fn tcab_package_file_dep(name: &str) -> String {
    format!("file:./{TCAB_VENDOR_DIR}/{name}")
}

/// Read the union of a workspace `package.json`'s `dependencies` and
/// `devDependencies` as name → version-spec pairs, for validating that a
/// package-declaring case ships the `file:` dependency it says it does. A missing
/// or non-object `dependencies`/`devDependencies` contributes nothing; a
/// dependency present in both is read from `dependencies`. Returns the invalid
/// detail string (for the caller to wrap into an [`Error::InvalidTestCase`]) if
/// the file is unreadable, not valid JSON, or not a JSON object.
fn read_package_dependencies(
    package_json: &Path,
) -> std::result::Result<std::collections::BTreeMap<String, String>, String> {
    let raw = fs::read_to_string(package_json).map_err(|err| {
        format!("could not read workspace `package.json` to validate `packages`: {err}")
    })?;
    let value: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|err| format!("workspace `package.json` is not valid JSON: {err}"))?;
    if !value.is_object() {
        return Err("workspace `package.json` must be a JSON object".to_string());
    }
    let mut deps = std::collections::BTreeMap::new();
    // devDependencies first so a name in both is overwritten by `dependencies`.
    for field in ["devDependencies", "dependencies"] {
        if let Some(map) = value.get(field).and_then(|v| v.as_object()) {
            for (name, spec) in map {
                if let Some(spec) = spec.as_str() {
                    deps.insert(name.clone(), spec.to_string());
                }
            }
        }
    }
    Ok(deps)
}

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
    /// an `[audio]` table (naming its `sample_pack`). Judged on the emitted `clip.wav`.
    SfxSample,
    /// A short piece of music authored with the `music` sequencer binary. Declares an
    /// `[audio]` table (naming its `instrument_bank`). Judged on the emitted
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
    /// volume instead of `[canvas]`, is seeded through [`crate::seeding`]'s voxel
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
/// artifacts so a UI knows whether to render an `<img>` or a `<video>`.
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
}

impl MediaKind {
    /// Infer the media kind from a path's file extension. Returns `None` for an
    /// extension that is neither a supported image nor a supported video.
    pub fn from_path(path: &Path) -> Option<Self> {
        let ext = path.extension()?.to_str()?.to_ascii_lowercase();
        match ext.as_str() {
            "png" | "jpg" | "jpeg" | "webp" | "gif" => Some(Self::Image),
            "webm" | "mp4" => Some(Self::Video),
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

/// The resolved `[audio]` of an audio asset-generation case: the rendered clip's
/// output format and (for the sample/instrument kinds) the baked palette.
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
    /// For `sfx-sample`: the baked sample pack (`name@version`). `None` otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub sample_pack: Option<String>,
    /// For `music`: the baked instrument bank (`name@version`). `None` otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub instrument_bank: Option<String>,
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
    /// The bounding volume this variant overrides the case's common `[voxel]`
    /// with, when it declares its own. `Some` **replaces** the case's `[voxel]`
    /// for this variant (it is not additive), so the same subject can be sculpted
    /// at a different size; `None` falls back to [`TestCaseVersion::voxel`].
    /// Resolve the effective volume for a variant with
    /// [`TestCaseVersion::voxel_for`].
    pub voxel: Option<VoxelSpec>,
    /// The reference implementation's source directory on the host, when this
    /// variant declares a `reference_implementation`: an absolute path inside the
    /// version folder holding a buildable static web project that is the *correct*
    /// build of this variant. Stored as a resolved host path exactly like a
    /// [`ReferenceView::source_path`] or a workspace source is — and, like a
    /// reference mockup's source, it is **never seeded into a run**: it is the
    /// authored answer the "Reference" tab shows, not model input. The build and
    /// deploy that turn it into a hosted URL happen out-of-band (see the CLI's
    /// `publish-reference` subcommand), so nothing here reads its contents; the
    /// path is carried purely so the publisher knows which directory to build.
    /// `None` when the variant declares no reference implementation.
    pub reference_impl: Option<PathBuf>,
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
    /// than zero. When [`Self::graded`] is false (the common case) and the item has
    /// no [`Self::sub_items`], a run earns this whole weight when the reviewer marks
    /// it `pass` and none when they mark it `fail`; with sub-items the weight is
    /// split evenly across them and the item earns the fraction that passed. When
    /// `graded` is true the item is a [game jam](TestType::GameJam) category worth
    /// `weight × 10` points, earning the graded tier's points times its weight (see
    /// [`crate::review::score`]).
    pub weight: u32,
    /// Whether this item is graded on the five-level scale
    /// ([`crate::review::VerdictStatus::GRADES`], 0/1/3/5/10 points) rather than
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
             respond, the core loop works, and a player can actually win or lose.",
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
        })
        .collect()
}

/// A name-only sub-item of a [`ReviewItem`]: one independently graded point
/// within the item, carrying only an id and a title. See
/// [`ManifestSubReviewItem`] for the manifest shape and the semantics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubReviewItem {
    /// Stable slug identifying this sub-item within its parent item; part of the
    /// composite verdict id (see [`ReviewItem::sub_item_verdict_id`]).
    pub id: String,
    /// The short heading shown for this sub-item in the reviewer UI.
    pub title: String,
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
    /// [`crate::RunRequest::max_runtime_override`]). Always positive, so a run is
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
    /// [`Manifest`]'s `experimental` documentation), so the flag acts purely as a
    /// visibility filter and has no effect on how a run executes.
    #[serde(default)]
    pub experimental: bool,
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
    /// The Test Cabinet runtime libraries (`@test-cabinet/*` npm names) this
    /// case's build consumes, from the manifest's `packages` key. The case's
    /// workspace `package.json` declares each as a `file:` dependency resolving
    /// under [`TCAB_PACKAGES_DIR`]; the harness does not modify that file. Empty
    /// when the case declares none. Validated against [`SHIPPABLE_PACKAGES`], and
    /// that the shipped `package.json` declares each, at resolution.
    pub packages: Vec<String>,
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
/// `test-cases/<type>/<difficulty>/<slug>/<version>/`. The `<type>` and
/// `<difficulty>` levels only group the tree for on-disk browsing; discovery
/// walks their shape but never reads meaning into their names — a case's
/// identity, type, and difficulty all come from its manifest. Internally a
/// "folder" is therefore the `<type>/<difficulty>/<slug>` path (relative to the
/// root) that directly holds a case's version subfolders.
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
        // Identity is the manifest-declared `slug`, which can differ from the
        // folder name, so build the catalog by reading each folder's slug rather
        // than trusting the directory name. A slug must be unique across the
        // catalog (two folders claiming one identity is ambiguous) and declared
        // identically on every version of a folder (a case has one identity), both
        // enforced here so a malformed catalog fails at the gate — ingest lists
        // before it resolves — rather than silently.
        let mut cases: Vec<TestCase> = Vec::new();
        let mut owner: std::collections::HashMap<String, String> = std::collections::HashMap::new();
        for folder in self.case_folders()? {
            let versions = self.version_names(&folder)?;
            if versions.is_empty() {
                continue;
            }
            // Every version must declare the same slug; take the newest as the
            // case's slug and check the rest agree.
            let slug = self.read_slug(&folder, &versions[0])?;
            for version in &versions[1..] {
                let other = self.read_slug(&folder, version)?;
                if other != slug {
                    return Err(Error::InvalidTestCase {
                        slug: folder.clone(),
                        version: version.clone(),
                        detail: format!(
                            "slug `{other}` disagrees with `{slug}` declared by other versions; \
                             every version of a folder must declare the same slug"
                        ),
                    });
                }
            }
            if let Some(existing) = owner.insert(slug.clone(), folder.clone()) {
                return Err(Error::DuplicateSlug {
                    slug,
                    folder_a: existing,
                    folder_b: folder,
                });
            }
            cases.push(TestCase { slug, versions });
        }
        cases.sort_by(|a, b| a.slug.cmp(&b.slug));
        Ok(cases)
    }

    /// List the versions available for a case (looked up by slug or folder name),
    /// newest first.
    pub fn versions(&self, id: &str) -> Result<Vec<String>> {
        let folder = self.folder_for(id)?;
        self.version_names(&folder)
    }

    /// The version subdirectories of a folder, newest first. An error only when the
    /// folder is unreadable; a folder with no versions yields an empty list.
    fn version_names(&self, folder: &str) -> Result<Vec<String>> {
        let dir = self.root.join(folder);
        if !dir.is_dir() {
            return Err(Error::TestCaseNotFound {
                slug: folder.to_string(),
            });
        }
        let mut versions = read_dir_names(&dir)?;
        // Newest first. Versions are compared component-wise so `v1.10.0` sorts
        // after `v1.9.0` rather than lexically before it.
        versions.sort_by_key(|v| std::cmp::Reverse(version_key(v)));
        Ok(versions)
    }

    /// Read just the `slug` a version's manifest declares (a lightweight parse that
    /// ignores every other field), validating its format. This is the case's
    /// identity; it may differ from `folder`.
    fn read_slug(&self, folder: &str, version: &str) -> Result<String> {
        // A jam ships `game-jam.toml`, a test case `test-case.toml`; both declare a
        // top-level `slug`, so the lightweight identity parse is the same either way.
        let manifest_file = manifest_file_for(folder);
        let path = self.root.join(folder).join(version).join(manifest_file);
        let raw = fs::read_to_string(&path).map_err(|err| Error::InvalidTestCase {
            slug: folder.to_string(),
            version: version.to_string(),
            detail: format!("could not read {manifest_file}: {err}"),
        })?;
        let identity: ManifestIdentity =
            toml::from_str(&raw).map_err(|err| Error::InvalidTestCase {
                slug: folder.to_string(),
                version: version.to_string(),
                detail: format!("invalid {manifest_file}: {err}"),
            })?;
        if !is_valid_slug(&identity.slug) {
            return Err(Error::InvalidTestCase {
                slug: folder.to_string(),
                version: version.to_string(),
                detail: format!(
                    "slug `{}` is not a valid slug (lowercase letters, digits, and single \
                     hyphens between them)",
                    identity.slug
                ),
            });
        }
        Ok(identity.slug)
    }

    /// The relative paths (from the catalog root) of every case folder — the
    /// `<type>/<difficulty>/<slug>` directories that directly hold a case's version
    /// subfolders. The two grouping levels are organizational only, so this walk
    /// cares about the tree's *shape*, not the names' meaning; non-directory and
    /// hidden entries at any level are ignored, so a stray file (a `.DS_Store`, a
    /// top-level README) never derails discovery. The returned path uses `/`
    /// separators and joins onto the root to reach the folder.
    fn case_folders(&self) -> Result<Vec<String>> {
        let mut folders = Vec::new();
        for type_dir in read_dir_names(&self.root)? {
            let type_path = self.root.join(&type_dir);
            for difficulty_dir in read_dir_names(&type_path)? {
                let difficulty_path = type_path.join(&difficulty_dir);
                for case_dir in read_dir_names(&difficulty_path)? {
                    folders.push(format!("{type_dir}/{difficulty_dir}/{case_dir}"));
                }
            }
        }
        // Game jams live in their own top-level `game-jams/` folder — a sibling of
        // the `test-cases/` root — laid out `game-jams/<slug>/<version>/` (no
        // type/difficulty grouping, since a jam is themed, not tiered). Discovery
        // folds them into the same catalog: their folder id is expressed relative to
        // the catalog root (`../game-jams/<slug>`) so every other catalog method —
        // which joins a folder onto `self.root` — reaches them unchanged. The folder
        // is skipped when absent (e.g. a test fixture with only `test-cases/`).
        if let Some(jam_root) = self.jam_root()
            && jam_root.is_dir()
        {
            for slug_dir in read_dir_names(&jam_root)? {
                folders.push(format!("../{GAME_JAMS_DIR}/{slug_dir}"));
            }
        }
        Ok(folders)
    }

    /// The sibling `game-jams/` directory (`../game-jams/` relative to the
    /// `test-cases/` catalog root), or `None` when the root has no parent.
    fn jam_root(&self) -> Option<PathBuf> {
        self.root.parent().map(|parent| parent.join(GAME_JAMS_DIR))
    }

    /// Resolve a requested id — the case's slug, or (for operator convenience, e.g.
    /// targeting a re-ingest) its folder name — to the `<type>/<difficulty>/<slug>`
    /// folder that holds it.
    ///
    /// A folder whose full relative path or final `<slug>` component is exactly `id`
    /// wins immediately: it covers the common case where the slug equals the folder
    /// name, and lets a rename's new folder be targeted by name, both without parsing
    /// a manifest. Otherwise the folders are scanned for one whose declared slug is
    /// `id`. The returned folder's declared slug is the identity, regardless of which
    /// of the two the caller passed.
    fn folder_for(&self, id: &str) -> Result<String> {
        let folders = self.case_folders()?;
        for folder in &folders {
            let name = folder.rsplit('/').next().unwrap_or(folder.as_str());
            if folder == id || name == id {
                return Ok(folder.clone());
            }
        }
        for folder in &folders {
            if let Some(newest) = self.version_names(folder)?.first()
                && self.read_slug(folder, newest)? == id
            {
                return Ok(folder.clone());
            }
        }
        Err(Error::TestCaseNotFound {
            slug: id.to_string(),
        })
    }

    /// The stable slug identifying the case a requested id (slug or folder name)
    /// resolves to, at a specific version — the store key ingest uses. A lightweight
    /// read that skips the full structural validation [`resolve`] performs.
    pub fn slug_of(&self, id: &str, version: &str) -> Result<String> {
        let folder = self.folder_for(id)?;
        self.read_slug(&folder, version)
    }

    /// Resolve an exact case `<id>@<version>` into a [`TestCaseVersion`], reading
    /// its manifest and validating that it is self-contained. `id` may be the case's
    /// slug or its folder name; the resolved [`TestCaseVersion::slug`] is always the
    /// manifest-declared identity, never the folder name.
    pub fn resolve(&self, id: &str, version: &str) -> Result<TestCaseVersion> {
        let folder = self.folder_for(id)?;
        let root = self.root.join(&folder).join(version);
        if !root.is_dir() {
            return Err(Error::TestCaseVersionNotFound {
                slug: id.to_string(),
                version: version.to_string(),
            });
        }

        // A game jam is authored through its own smaller `GameJamManifest` format
        // (no `difficulty`, no `variants`, none of the spec-driven tables), so a jam
        // folder is parsed with that struct and *lowered* onto the shared internal
        // [`Manifest`] the rest of resolution understands — plus the single implicit
        // theme variant a jam runs, since it declares no variant files. A spec-driven
        // case reads its `test-case.toml` as before.
        let (manifest, jam_variant): (Manifest, Option<ManifestVariant>) =
            if is_game_jam_folder(&folder) {
                let (manifest, variant) =
                    self.read_game_jam_manifest(id, version, &root)?.into_case();
                (manifest, Some(variant))
            } else {
                (self.read_manifest(id, version, &root)?, None)
            };
        // The manifest's `slug` is the case's identity; every downstream key (the
        // run record, the definition-store directory) uses it, not the folder name.
        let slug = manifest.slug.clone();
        let invalid = |detail: String| Error::InvalidTestCase {
            slug: slug.clone(),
            version: version.to_string(),
            detail,
        };
        if !is_valid_slug(&slug) {
            return Err(invalid(format!(
                "slug `{slug}` is not a valid slug (lowercase letters, digits, and single \
                 hyphens between them)"
            )));
        }

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
            TestType::EndToEnd | TestType::FullStack | TestType::GameJam => {
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
        let variant_manifests: Vec<ManifestVariant> = if let Some(variant) = jam_variant {
            // A game jam declares no variant files; it runs the single implicit
            // theme-selector variant synthesized when its manifest was lowered.
            vec![variant]
        } else {
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
                let variant: ManifestVariant = toml::from_str(&raw).map_err(|err| {
                    invalid(format!("invalid variant `{}`: {err}", rel.display()))
                })?;
                variant_manifests.push(variant);
            }
            variant_manifests
        };

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

        // A game jam has no spec, no reference mockups, and no scoring domains: it
        // hands the model only a theme and reviews the result on graded categories
        // plus a whole-game overall grade (see [`crate::review`]). Declaring any of
        // those tables is a mistake worth catching, so it is rejected here rather
        // than silently ignored. The per-variant equivalents are rejected in the
        // variant loop below.
        if test_type == TestType::GameJam {
            if !manifest.specs.is_empty() {
                return Err(invalid(
                    "a game-jam case seeds no [[spec]] — it provides only a theme, not a \
                     specification"
                        .to_string(),
                ));
            }
            if !manifest.reference.is_empty() {
                return Err(invalid(
                    "a game-jam case declares no [[reference]] — models design the game freely \
                     from the theme"
                        .to_string(),
                ));
            }
            if !manifest.domains.is_empty() {
                return Err(invalid(
                    "a game-jam case declares no [[domain]] — its review categories are graded \
                     directly and it carries a single overall grade"
                        .to_string(),
                ));
            }
        }

        // The common domains every variant is rated on. A domain-scored case must
        // declare at least one, so every variant's effective set (common ∪ its own)
        // is non-empty; a variant may add more of its own in the loop below. A game
        // jam is the sole exception — it has no domains at all (forbidden above).
        if manifest.domains.is_empty() && test_type != TestType::GameJam {
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
            Ok(SpecFile {
                source_path,
                dest,
                kind: spec.kind,
            })
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
        // The `[tool]`/`[output]` tables are shared across every asset-generation
        // kind (the binary and the paths it reads/writes). This resolves and
        // validates them once for the painted/particle/audio arms below (the sprite
        // and voxel arms inline the same checks). The preview/action tokens are
        // validated per-kind by each arm.
        let resolve_tool_output = || -> Result<(ToolSpec, OutputSpec)> {
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
            Ok((
                ToolSpec {
                    binary: tool.binary.clone(),
                    preview: tool.preview.clone(),
                },
                OutputSpec {
                    actions: output.actions.clone(),
                },
            ))
        };

        #[allow(clippy::type_complexity)]
        let (canvas, tool, output, sheet, voxel, model, ui, material, particle, audio): (
            Option<CanvasSpec>,
            Option<ToolSpec>,
            Option<OutputSpec>,
            Option<SheetSpec>,
            Option<VoxelSpec>,
            Option<ModelSpec>,
            Option<UiSpec>,
            Option<MaterialSpec>,
            Option<ParticleSpec>,
            Option<AudioSpec>,
        ) = match test_type {
            TestType::EndToEnd
            | TestType::FullStack
            | TestType::GameJam
            | TestType::Adversarial
            | TestType::Performance => {
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
                // As are the painted / particle / audio tables.
                if manifest.ui.is_some()
                    || manifest.material.is_some()
                    || manifest.particle.is_some()
                    || manifest.audio.is_some()
                {
                    return Err(invalid(
                        "the [ui], [material], [particle], and [audio] tables are only valid for \
                         an asset-generation case"
                            .to_string(),
                    ));
                }
                (None, None, None, None, None, None, None, None, None, None)
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
                if manifest.ui.is_some()
                    || manifest.material.is_some()
                    || manifest.particle.is_some()
                    || manifest.audio.is_some()
                {
                    return Err(invalid(
                        "a voxel case declares none of [ui], [material], [particle], or [audio]"
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
                test_cabinet_model_core::PreviewBackground::parse(&voxel.background).map_err(
                    |err| invalid(format!("voxel background `{}`: {err}", voxel.background)),
                )?;

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

                // The preview and action-log paths must be `{part}` templates for a
                // **per-part** animated model (one file per part) and plain paths
                // otherwise. This holds for the four rigid animated kinds (the cube
                // `voxel-animation` and the three meshed `*-animation` kinds); a
                // static kind, and every **skinned** kind (one whole-body field, one
                // mesh — the single-file exception), use plain paths.
                let is_per_part = manifest.asset_kind.is_per_part();
                for (label, path) in [
                    ("tool.preview", &tool.preview),
                    ("output.actions", &output.actions),
                ] {
                    let has_token = path.to_string_lossy().contains(PART_TOKEN);
                    if is_per_part && !has_token {
                        return Err(invalid(format!(
                            "{label} `{}` must contain `{PART_TOKEN}` for a per-part animated \
                             voxel case (one file per part)",
                            path.display()
                        )));
                    }
                    if !is_per_part && has_token {
                        return Err(invalid(format!(
                            "{label} `{}` must not contain `{PART_TOKEN}` for a static or skinned \
                             voxel case (a single file)",
                            path.display()
                        )));
                    }
                }

                // The `[model]` rig is required for — and only for — an **animated**
                // voxel-family case: the four rigid animated kinds and the three
                // **skinned** kinds. A static kind (`voxel-model` or a meshed
                // `*-model`) is one unposed volume/field and declares no rig.
                let model = if manifest.asset_kind.is_animated() {
                    let model = manifest.model.as_ref().ok_or_else(|| {
                        invalid(
                            "an animated voxel case (a `*-animation` or `*-skinned` kind) requires \
                             a [model] table"
                                .to_string(),
                        )
                    })?;
                    Some(resolve_model(model, &invalid)?)
                } else {
                    if manifest.model.is_some() {
                        return Err(invalid(
                            "a static voxel case (a `*-model` kind) declares no [model] table"
                                .to_string(),
                        ));
                    }
                    None
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
                    None,
                    None,
                    None,
                    None,
                )
            }
            TestType::AssetGeneration if manifest.asset_kind.is_blender() => {
                // The Blender family (`blender-character`/`blender-prop`/
                // `blender-mechanism`). All three reuse the `[voxel]` table as a bounding
                // box (the volume the asset must fit within) and are authored by driving
                // headless Blender through a `build.py` script rather than a constrained
                // op-log tool: `[tool].binary` is the `tcab-blend` runner and
                // `[output].actions` names the authored script (re-run for provenance),
                // not an operation log. Both are single files — a Blender run emits one
                // glTF — so neither may carry a `{part}` token. The `[model]` table of
                // required animations is required for the animated members (character,
                // mechanism) and FORBIDDEN for the static prop.
                if manifest.canvas.is_some() || manifest.sheet.is_some() {
                    return Err(invalid(
                        "a Blender case declares a [voxel] bounding box, not [canvas] or \
                         [sheet]"
                            .to_string(),
                    ));
                }
                if manifest.ui.is_some()
                    || manifest.material.is_some()
                    || manifest.particle.is_some()
                    || manifest.audio.is_some()
                {
                    return Err(invalid(
                        "a Blender case declares none of [ui], [material], [particle], or \
                         [audio]"
                            .to_string(),
                    ));
                }

                let voxel = manifest.voxel.as_ref().ok_or_else(|| {
                    invalid("the [voxel] table (the asset's bounding box) is required".to_string())
                })?;
                if voxel.width == 0 || voxel.height == 0 || voxel.depth == 0 {
                    return Err(invalid(
                        "bounding-box width, height, and depth must be greater than zero"
                            .to_string(),
                    ));
                }
                test_cabinet_model_core::PreviewBackground::parse(&voxel.background).map_err(
                    |err| {
                        invalid(format!(
                            "bounding-box background `{}`: {err}",
                            voxel.background
                        ))
                    },
                )?;

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

                // A Blender run emits a single glTF: neither the preview nor the
                // authored-script path may be a `{part}` template.
                for (label, path) in [
                    ("tool.preview", &tool.preview),
                    ("output.actions", &output.actions),
                ] {
                    if path.to_string_lossy().contains(PART_TOKEN) {
                        return Err(invalid(format!(
                            "{label} `{}` must not contain `{PART_TOKEN}` — a Blender case emits \
                             a single glTF",
                            path.display()
                        )));
                    }
                }

                // The `[model]` table of required animations is required for the animated
                // Blender members (`blender-character` skinned clips, `blender-mechanism`
                // rigid node-hierarchy clips) and FORBIDDEN for the static `blender-prop`,
                // which emits an unrigged glTF. As with the voxel-family animated kinds it
                // fixes only the required animations by name; the skeleton/rig and its
                // motion are the model's to invent.
                let model = if manifest.asset_kind.blender_is_animated() {
                    let model = manifest.model.as_ref().ok_or_else(|| {
                        invalid(
                            "an animated Blender case (blender-character/blender-mechanism) \
                             requires a [model] table of required animations"
                                .to_string(),
                        )
                    })?;
                    Some(resolve_model(model, &invalid)?)
                } else {
                    if manifest.model.is_some() {
                        return Err(invalid(
                            "a blender-prop case is static and declares no [model] table (no \
                             animations)"
                                .to_string(),
                        ));
                    }
                    None
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
                    None,
                    None,
                    None,
                    None,
                )
            }
            TestType::AssetGeneration if manifest.asset_kind.is_paint() => {
                // A painted kind (`ui`/`material`). `ui` reuses `[canvas]` for the
                // base element size and adds an optional `[ui]` kit; `material`
                // declares a `[material]` table and no `[canvas]`. Neither declares
                // the voxel/particle/audio tables.
                if manifest.sheet.is_some()
                    || manifest.voxel.is_some()
                    || manifest.model.is_some()
                    || manifest.particle.is_some()
                    || manifest.audio.is_some()
                {
                    return Err(invalid(
                        "a painted case (asset_kind = \"ui\"/\"material\") declares none of \
                         [sheet], [voxel], [model], [particle], or [audio]"
                            .to_string(),
                    ));
                }
                let (tool, output) = resolve_tool_output()?;

                match manifest.asset_kind {
                    AssetKind::Ui => {
                        if manifest.material.is_some() {
                            return Err(invalid(
                                "a `ui` case declares [canvas] (+ optional [ui]), not [material]"
                                    .to_string(),
                            ));
                        }
                        let canvas = manifest.canvas.as_ref().ok_or_else(|| {
                            invalid("a `ui` case requires the [canvas] table".to_string())
                        })?;
                        if canvas.width == 0 || canvas.height == 0 {
                            return Err(invalid(
                                "canvas width and height must be greater than zero".to_string(),
                            ));
                        }
                        test_cabinet_draw::Background::parse(&canvas.background).map_err(
                            |err| {
                                invalid(format!("canvas background `{}`: {err}", canvas.background))
                            },
                        )?;
                        let ui = resolve_ui(manifest.ui.as_ref(), &invalid)?;
                        // The preview carries `{element}` when — and only when — the
                        // kit declares elements; the action log is a single
                        // interleaved stream (never templated).
                        let preview_has_token =
                            tool.preview.to_string_lossy().contains(ELEMENT_TOKEN);
                        if !ui.elements.is_empty() && !preview_has_token {
                            return Err(invalid(format!(
                                "tool.preview `{}` must contain `{ELEMENT_TOKEN}` for a `ui` kit \
                                 (one file per element)",
                                tool.preview.display()
                            )));
                        }
                        if ui.elements.is_empty() && preview_has_token {
                            return Err(invalid(format!(
                                "tool.preview `{}` must not contain `{ELEMENT_TOKEN}` for a \
                                 single-element `ui` case",
                                tool.preview.display()
                            )));
                        }
                        if output.actions.to_string_lossy().contains(ELEMENT_TOKEN) {
                            return Err(invalid(format!(
                                "output.actions `{}` must not contain `{ELEMENT_TOKEN}` — a `ui` \
                                 run records a single interleaved log",
                                output.actions.display()
                            )));
                        }
                        (
                            Some(CanvasSpec {
                                width: canvas.width,
                                height: canvas.height,
                                background: canvas.background.clone(),
                            }),
                            Some(tool),
                            Some(output),
                            None,
                            None,
                            None,
                            Some(ui),
                            None,
                            None,
                            None,
                        )
                    }
                    // `material` (the only other painted kind).
                    _ => {
                        if manifest.canvas.is_some() || manifest.ui.is_some() {
                            return Err(invalid(
                                "a `material` case declares [material], not [canvas] or [ui]"
                                    .to_string(),
                            ));
                        }
                        let material = resolve_material(manifest.material.as_ref(), &invalid)?;
                        // One preview per declared map (`{map}` template); the action
                        // log is a single interleaved stream.
                        if !tool.preview.to_string_lossy().contains(MAP_TOKEN) {
                            return Err(invalid(format!(
                                "tool.preview `{}` must contain `{MAP_TOKEN}` for a `material` case \
                                 (one preview per map)",
                                tool.preview.display()
                            )));
                        }
                        if output.actions.to_string_lossy().contains(MAP_TOKEN) {
                            return Err(invalid(format!(
                                "output.actions `{}` must not contain `{MAP_TOKEN}` — a `material` \
                                 run records a single interleaved log",
                                output.actions.display()
                            )));
                        }
                        (
                            None,
                            Some(tool),
                            Some(output),
                            None,
                            None,
                            None,
                            None,
                            Some(material),
                            None,
                            None,
                        )
                    }
                }
            }
            TestType::AssetGeneration if manifest.asset_kind.is_particle() => {
                if manifest.canvas.is_some()
                    || manifest.sheet.is_some()
                    || manifest.voxel.is_some()
                    || manifest.model.is_some()
                    || manifest.ui.is_some()
                    || manifest.material.is_some()
                    || manifest.audio.is_some()
                {
                    return Err(invalid(
                        "a particle case declares only the [particle] table (none of [canvas], \
                         [sheet], [voxel], [model], [ui], [material], or [audio])"
                            .to_string(),
                    ));
                }
                let (tool, output) = resolve_tool_output()?;
                // A particle effect's preview/log are single files (one effect).
                for (label, path) in [
                    ("tool.preview", &tool.preview),
                    ("output.actions", &output.actions),
                ] {
                    if path.to_string_lossy().contains(PART_TOKEN) {
                        return Err(invalid(format!(
                            "{label} `{}` must not contain `{PART_TOKEN}` — a particle case \
                             authors one effect",
                            path.display()
                        )));
                    }
                }
                let particle = resolve_particle(
                    manifest.particle.as_ref(),
                    manifest.asset_kind == AssetKind::Particle3d,
                    &invalid,
                )?;
                (
                    None,
                    Some(tool),
                    Some(output),
                    None,
                    None,
                    None,
                    None,
                    None,
                    Some(particle),
                    None,
                )
            }
            TestType::AssetGeneration if manifest.asset_kind.is_audio() => {
                if manifest.canvas.is_some()
                    || manifest.sheet.is_some()
                    || manifest.voxel.is_some()
                    || manifest.model.is_some()
                    || manifest.ui.is_some()
                    || manifest.material.is_some()
                    || manifest.particle.is_some()
                {
                    return Err(invalid(
                        "an audio case declares only the [audio] table (none of [canvas], \
                         [sheet], [voxel], [model], [ui], [material], or [particle])"
                            .to_string(),
                    ));
                }
                let (tool, output) = resolve_tool_output()?;
                let audio = resolve_audio(manifest.audio.as_ref(), manifest.asset_kind, &invalid)?;
                (
                    None,
                    Some(tool),
                    Some(output),
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    Some(audio),
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
                // The painted/particle/audio tables belong to their kinds.
                if manifest.ui.is_some()
                    || manifest.material.is_some()
                    || manifest.particle.is_some()
                    || manifest.audio.is_some()
                {
                    return Err(invalid(
                        "the [ui], [material], [particle], and [audio] tables are only valid for \
                         their respective asset kinds"
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
                    // Every non-sprite kind is resolved by a guarded arm above and
                    // never reaches this 2D sprite branch.
                    _ => unreachable!("non-sprite asset kind reached the sprite arm"),
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
                    None,
                    None,
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
            TestType::EndToEnd
            | TestType::FullStack
            | TestType::GameJam
            | TestType::AssetGeneration => {
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
                    kind: SpecKind::Spec,
                });
                common_specs.push(SpecFile {
                    source_path: action_source,
                    dest: action.clone(),
                    kind: SpecKind::Spec,
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
                    kind: SpecKind::Spec,
                });
                common_specs.push(SpecFile {
                    source_path: output_source,
                    dest: output.clone(),
                    kind: SpecKind::Spec,
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

        // The per-version changelog is required: every version must record what
        // changed in it. It is validated to exist with the same self-containment
        // guard as the description, and is likewise never seeded into a run — it is
        // purely site-facing.
        let changelog_path = resolve_inside(&manifest.changelog, "changelog")?;
        if !changelog_path.is_file() {
            return Err(invalid(format!(
                "changelog `{}` does not exist",
                manifest.changelog.display()
            )));
        }

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

        // Packages: the Test Cabinet runtime libraries this case's build consumes.
        // They are consumed by a built game, so only a case that builds a program —
        // an end-to-end or full-stack case — may declare them, and each name must be
        // one this repo actually ships into the run image (see [`SHIPPABLE_PACKAGES`]).
        // The harness does not modify the shipped `package.json`; the case's own
        // workspace `package.json` must already depend on each declared package via
        // its baked-in `file:` spec (see [`tcab_package_file_dep`]). Validate that
        // here so a misconfigured manifest fails at resolution rather than leaving the
        // model to discover the missing dependency at run time.
        if !manifest.packages.is_empty() {
            if !matches!(
                test_type,
                TestType::EndToEnd | TestType::FullStack | TestType::GameJam
            ) {
                return Err(invalid(
                    "`packages` is only valid for an end-to-end, full-stack, or game-jam case"
                        .to_string(),
                ));
            }
            let package_json = common_workspace
                .iter()
                .find(|file| file.dest == Path::new("package.json"))
                .ok_or_else(|| {
                    invalid(
                        "a case that declares `packages` must ship a workspace containing a \
                         `package.json` at its root (the file that declares the dependency)"
                            .to_string(),
                    )
                })?;
            let declared = match read_package_dependencies(&package_json.source_path) {
                Ok(declared) => declared,
                Err(detail) => return Err(invalid(detail)),
            };
            for package in &manifest.packages {
                if !is_shippable_package(package) {
                    return Err(invalid(format!(
                        "package `{package}` is not a shippable Test Cabinet package; \
                         valid names are: {}",
                        shippable_package_names()
                    )));
                }
                let expected = tcab_package_file_dep(package);
                match declared.get(package) {
                    Some(spec) if spec == &expected => {}
                    Some(spec) => {
                        return Err(invalid(format!(
                            "package `{package}` is declared in the workspace `package.json` as \
                             `{spec}`, but must be `{expected}` so it resolves to its baked-in \
                             copy in the run image"
                        )));
                    }
                    None => {
                        return Err(invalid(format!(
                            "package `{package}` is declared in `packages` but is not a \
                             dependency of the workspace `package.json`; add \
                             `\"{package}\": \"{expected}\"` to its dependencies"
                        )));
                    }
                }
            }
        }

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
        // A game jam grades its review categories on the five-level scale (see
        // [`crate::review::VerdictStatus::GRADES`]) rather than pass/fail; every
        // other type keeps the binary verdict. This is a property of the case's
        // type, set on each resolved item here rather than declared per item.
        let graded_reviews = test_type == TestType::GameJam;
        let resolve_review_item =
            |item: &ManifestReviewItem, allowed_domains: &[Domain]| -> Result<ReviewItem> {
                if item.id.trim().is_empty() {
                    return Err(invalid("review_item `id` must not be empty".to_string()));
                }
                // The `overall` id is reserved for the jam reviewer's whole-game
                // grade (see [`crate::review::OVERALL_VERDICT_ID`]); a declared
                // category may not claim it or its verdict would collide.
                if graded_reviews && item.id == crate::review::OVERALL_VERDICT_ID {
                    return Err(invalid(format!(
                        "review_item id `{}` is reserved for the game-jam overall grade",
                        crate::review::OVERALL_VERDICT_ID
                    )));
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
                // Sub-items break the item into independently graded points. Each
                // needs a non-empty id (it keys the sub-item's verdict) and title
                // (its heading), and the ids must be unique within the item so a
                // recorded sub-item verdict is unambiguous.
                let mut seen_sub_ids = std::collections::BTreeSet::new();
                for sub in &item.sub_items {
                    if sub.id.trim().is_empty() {
                        return Err(invalid(format!(
                            "review_item `{}` has a sub-item with an empty `id`",
                            item.id
                        )));
                    }
                    if sub.title.trim().is_empty() {
                        return Err(invalid(format!(
                            "review_item `{}` sub-item `{}` has an empty `title`",
                            item.id, sub.id
                        )));
                    }
                    if !seen_sub_ids.insert(&sub.id) {
                        return Err(invalid(format!(
                            "review_item `{}` declares two sub-items with the same id `{}`",
                            item.id, sub.id
                        )));
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
                    graded: graded_reviews,
                    domain: item.domain.clone(),
                    sub_items: item
                        .sub_items
                        .iter()
                        .map(|sub| SubReviewItem {
                            id: sub.id.clone(),
                            title: sub.title.clone(),
                        })
                        .collect(),
                })
            };

        // Common items are rated on every variant, so they may only name a common
        // domain — the variant-specific domains are not in scope here.
        let mut common_review_items = Vec::with_capacity(manifest.review_items.len());
        for item in &manifest.review_items {
            common_review_items.push(resolve_review_item(item, &domains)?);
        }
        // A game jam that authors no categories of its own gets the generic graded
        // checklist, so every jam is reviewed on a consistent baseline. A jam that
        // does declare categories keeps only those.
        if graded_reviews
            && manifest.review_items.is_empty()
            && variant_manifests
                .iter()
                .all(|variant| variant.review_items.is_empty())
        {
            common_review_items = default_game_jam_review_items();
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
            // A game-jam variant is a bare theme selector: like the case, it seeds
            // no specs, declares no references or domains, and ships no reference
            // implementation. Reject those per-variant tables to match the case-level
            // guard above.
            if test_type == TestType::GameJam {
                if !variant.specs.is_empty() {
                    return Err(invalid(format!(
                        "game-jam variant `{}` seeds no [[spec]]",
                        variant.slug
                    )));
                }
                if !variant.references.is_empty() {
                    return Err(invalid(format!(
                        "game-jam variant `{}` declares no [[reference]]",
                        variant.slug
                    )));
                }
                if !variant.domains.is_empty() {
                    return Err(invalid(format!(
                        "game-jam variant `{}` declares no [[domain]]",
                        variant.slug
                    )));
                }
                if variant.reference_implementation.is_some() {
                    return Err(invalid(format!(
                        "game-jam variant `{}` declares no reference implementation",
                        variant.slug
                    )));
                }
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

            // A variant's reference implementation, when declared, is the authored
            // *correct* build shown on the case's "Reference" tab. It is a buildable
            // directory inside the version folder, validated to exist here so a typo
            // fails resolution rather than a later out-of-band deploy. Crucially it
            // is resolved but **never seeded**: it takes no part in the seed-dest
            // `claim`s below (it is neither a spec, a workspace file, an asset, a
            // reference screenshot, nor a proof), so the finished game never lands in
            // a run tree. The resolved host path is carried on the `Variant` purely
            // so the publisher knows which directory to build and deploy.
            let reference_impl = match &variant.reference_implementation {
                Some(dir) => {
                    let path = resolve_inside(dir, "variant reference implementation")?;
                    if !path.is_dir() {
                        return Err(invalid(format!(
                            "variant `{}` reference implementation `{}` is not a directory",
                            variant.slug,
                            dir.display()
                        )));
                    }
                    Some(path)
                }
                None => None,
            };

            // A variant's `[voxel]`, when declared, replaces the case's common
            // volume for this variant (the size axis behind half/base/double
            // variants). It is meaningful only for a voxel case: a variant of any
            // other kind declaring one is a manifest error. Validate its extents
            // and background exactly as the common `[voxel]` is validated above.
            let voxel = match &variant.voxel {
                Some(voxel) => {
                    if !(test_type == TestType::AssetGeneration && manifest.asset_kind.is_voxel()) {
                        return Err(invalid(format!(
                            "variant `{}` declares a [voxel] volume, but only a voxel \
                             asset-generation case may override the volume per variant",
                            variant.slug
                        )));
                    }
                    if voxel.width == 0 || voxel.height == 0 || voxel.depth == 0 {
                        return Err(invalid(format!(
                            "variant `{}` voxel width, height, and depth must be greater \
                             than zero",
                            variant.slug
                        )));
                    }
                    test_cabinet_model_core::PreviewBackground::parse(&voxel.background).map_err(
                        |err| {
                            invalid(format!(
                                "variant `{}` voxel background `{}`: {err}",
                                variant.slug, voxel.background
                            ))
                        },
                    )?;
                    Some(VoxelSpec {
                        width: voxel.width,
                        height: voxel.height,
                        depth: voxel.depth,
                        background: voxel.background.clone(),
                    })
                }
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
                // Every voxel-family kind additionally emits a per-part (`{part}`) or
                // single `.glb`; claim it so a spec can never land on the geometry
                // the binary writes.
                let mesh_template = manifest.asset_kind.voxel_mesh_dest();
                if manifest.asset_kind.is_per_part() {
                    // A rigid animated voxel/mesh kind: one preview, log, and `.glb`
                    // per declared part, plus the produced `rig.json`.
                    if let Some(model) = &model {
                        for part in &model.parts {
                            claim(part_path(&tool.preview, &part.name), "part preview")?;
                            claim(part_path(&output.actions, &part.name), "part action log")?;
                            if let Some(mesh) = mesh_template {
                                claim(part_path(Path::new(mesh), &part.name), "part mesh")?;
                            }
                        }
                        claim(PathBuf::from(VOXEL_RIG_DEST), "rig")?;
                    }
                } else if let Some(sheet) = &sheet {
                    for &index in &sheet.frames {
                        claim(frame_path(&tool.preview, index), "tool preview")?;
                        claim(frame_path(&output.actions, index), "action log")?;
                    }
                } else if let Some(ui) = &ui {
                    // A `ui` run records ONE interleaved log; it emits one flattened
                    // PNG per element (or a single file) plus the auto-emitted
                    // `ui.json`.
                    claim(output.actions.clone(), "action log")?;
                    if ui.elements.is_empty() {
                        claim(tool.preview.clone(), "element preview")?;
                    } else {
                        for element in &ui.elements {
                            claim(
                                element_path(&tool.preview, &element.name),
                                "element preview",
                            )?;
                        }
                    }
                    claim(PathBuf::from(UI_JSON_DEST), "ui manifest")?;
                } else if let Some(material) = &material {
                    // A `material` run records ONE interleaved log; it emits one PNG
                    // per declared map plus the auto-emitted `material.json`.
                    claim(output.actions.clone(), "action log")?;
                    for map in &material.maps {
                        claim(map_path(&tool.preview, map), "map preview")?;
                    }
                    claim(PathBuf::from(MATERIAL_JSON_DEST), "material manifest")?;
                } else if manifest.asset_kind.is_blender() {
                    // A Blender run has no seeded action log: `[output].actions` names the
                    // `build.py` the model AUTHORS, seeded as the case's own spec (its
                    // starter stub), so it is already claimed by the spec loop above and
                    // must NOT be claimed again here. The runner produces the preview and
                    // the emitted glTF (`character.glb` for a character, `model.glb` for a
                    // prop/mechanism), so claim those to keep a spec off them.
                    claim(tool.preview.clone(), "tool preview")?;
                    if let Some(mesh) = manifest.asset_kind.blender_mesh_dest() {
                        claim(PathBuf::from(mesh), "mesh")?;
                    }
                } else {
                    // The single-file kinds: sprite (single), static voxel/mesh, the
                    // three skinned kinds, particle, and audio.
                    claim(tool.preview.clone(), "tool preview")?;
                    claim(output.actions.clone(), "action log")?;
                    if let Some(mesh) = mesh_template {
                        claim(PathBuf::from(mesh), "mesh")?;
                    }
                    // A skinned kind is animated (single-file) and produces a rig.
                    if manifest.asset_kind.is_skinned() {
                        claim(PathBuf::from(VOXEL_RIG_DEST), "rig")?;
                    }
                    if manifest.asset_kind.is_particle() {
                        claim(PathBuf::from(PARTICLE_SYSTEM_DEST), "particle system")?;
                    }
                    if manifest.asset_kind.is_audio() {
                        claim(PathBuf::from(AUDIO_CLIP_WAV_DEST), "audio clip")?;
                        if manifest.asset_kind.emits_midi() {
                            claim(PathBuf::from(AUDIO_CLIP_MID_DEST), "audio score")?;
                        }
                    }
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
            // Each verdict a reviewer records is keyed by an id (the item's own,
            // or a composite `<item>.<sub-item>` when the item has sub-items); two
            // that collide would make a recorded verdict ambiguous, so a collision
            // across the common items and the variant's own is rejected. Expanding
            // to verdict ids also catches a sub-item id colliding with a plain
            // item id.
            let mut seen_ids = std::collections::BTreeSet::new();
            for item in common_review_items.iter().chain(review_items.iter()) {
                for verdict_id in item.verdict_ids() {
                    if !seen_ids.insert(verdict_id.clone()) {
                        return Err(invalid(format!(
                            "variant `{}` declares two review items (or sub-items) resolving to \
                             the same verdict id `{}`",
                            variant.slug, verdict_id
                        )));
                    }
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
                voxel,
                reference_impl,
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
            changelog_path,
            root,
            prompt_path,
            max_runtime_seconds: crate::runtime_hours_to_seconds(manifest.max_runtime_hours),
            test_type,
            experimental: manifest.experimental,
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
            ui,
            material,
            particle,
            audio,
            common_specs,
            common_workspace,
            init: manifest.init,
            asset_paths,
            packages: manifest.packages,
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

    /// Read and parse a game-jam version's `game-jam.toml` manifest — the jam's own
    /// [`GameJamManifest`] format, distinct from the shared test-case
    /// [`Manifest`]. `deny_unknown_fields` means a jam that declares a test-case-only
    /// key (`difficulty`, `variants`, a `[[spec]]`, …) fails to parse here with a
    /// clear message.
    fn read_game_jam_manifest(
        &self,
        slug: &str,
        version: &str,
        root: &Path,
    ) -> Result<GameJamManifest> {
        let manifest_path = root.join(GAME_JAM_MANIFEST_FILE);
        let raw = fs::read_to_string(&manifest_path).map_err(|err| Error::InvalidTestCase {
            slug: slug.to_string(),
            version: version.to_string(),
            detail: format!("could not read {GAME_JAM_MANIFEST_FILE}: {err}"),
        })?;
        toml::from_str(&raw).map_err(|err| Error::InvalidTestCase {
            slug: slug.to_string(),
            version: version.to_string(),
            detail: format!("invalid {GAME_JAM_MANIFEST_FILE}: {err}"),
        })
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
/// declared part, and parse its `kind`/`axis`/`drive` with `min <= rest <= max`.
/// Every `[[model.animation]]` must carry a unique non-empty name, a positive
/// `period_ms`, and a non-empty `joints` list naming distinct declared joints; it is
/// resolved into an [`AnimationSpec`] declaration (its `joints` set, empty `tracks`)
/// the model authors at run time. `invalid` is the resolver's error constructor,
/// threaded in so messages carry the case's slug and version.
fn resolve_model(model: &ManifestModel, invalid: &impl Fn(String) -> Error) -> Result<ModelSpec> {
    // A case's rig contract is **only** the animations the model must author. Parts,
    // joints, pivots, and F-curves are all model-invented — the test measures whether
    // a model can work out the pieces it needs and animate them, not whether it can
    // follow a prescribed rig. So the required set is a list of animation names (with
    // their loop/auto-play identity); the produced `rig.json` is scored against it.
    if model.animation.is_empty() {
        return Err(invalid(
            "a [model] must declare at least one [[model.animation]] — the only rig \
             contract a case fixes is which animations the model must author"
                .to_string(),
        ));
    }
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
        // The period and the driven joints are the model's to choose, so the required
        // declaration carries a placeholder period (`0`) and no joints; the produced
        // rig supplies the real values, which is what the reviewer scores.
        animations.push(AnimationSpec {
            name: animation.name.clone(),
            period_ms: 0,
            looping: animation.r#loop,
            auto_play: animation.auto_play,
            joints: Vec::new(),
            tracks: Vec::new(),
        });
    }

    // The required **caller joints** — the game-facing procedural DOFs (a turret's
    // `turret_yaw`). Optional: a case that fixes no procedural interface declares none.
    // Each resolves to a `Caller`-driven [`JointSpec`]. Rotation limits are authored in
    // DEGREES for readability and converted to radians here (the stored/emitted/runtime
    // unit); translation limits are world units, unchanged. The driven node is discovered
    // at runtime by the DOF `name` (the model tags the node's glTF `extras`), so the
    // voxel-only `part`/`pivot` fields are not meaningful here: `part` mirrors the DOF
    // name and `pivot` is zero.
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
        for (label, value) in [("min", joint.min), ("max", joint.max), ("rest", joint.rest)] {
            if !value.is_finite() {
                return Err(invalid(format!(
                    "model joint `{}` {label} must be a finite number",
                    joint.name
                )));
            }
        }
        if joint.min > joint.max {
            return Err(invalid(format!(
                "model joint `{}` min ({}) must not exceed max ({})",
                joint.name, joint.min, joint.max
            )));
        }
        if joint.rest < joint.min || joint.rest > joint.max {
            return Err(invalid(format!(
                "model joint `{}` rest ({}) must lie within [min, max] = [{}, {}]",
                joint.name, joint.rest, joint.min, joint.max
            )));
        }
        // Rotation limits are authored in degrees; store radians.
        let convert = |value: f64| match joint.kind {
            JointKindSpec::Rotation => value.to_radians(),
            JointKindSpec::Translation => value,
        };
        joints.push(JointSpec {
            name: joint.name.clone(),
            part: joint.name.clone(),
            kind: joint.kind,
            axis: joint.axis,
            pivot: [0, 0, 0],
            min: convert(joint.min),
            max: convert(joint.max),
            rest: convert(joint.rest),
            offset: None,
            orient: None,
            drive: DriveKindSpec::Caller,
        });
    }

    Ok(ModelSpec {
        parts: Vec::new(),
        joints,
        animations,
    })
}

/// Resolve and validate a `ui` case's optional `[ui]` table into a [`UiSpec`].
///
/// When the table is absent the case is a single implicit element (empty
/// [`UiSpec::elements`]). When present it must declare at least one element; every
/// element carries a unique non-empty name and positive `width`/`height`, and any
/// fixed `nine_slice` must fit within the element's bounds. `invalid` is the
/// resolver's error constructor.
fn resolve_ui(ui: Option<&ManifestUi>, invalid: &impl Fn(String) -> Error) -> Result<UiSpec> {
    let Some(ui) = ui else {
        return Ok(UiSpec {
            elements: Vec::new(),
        });
    };
    if ui.element.is_empty() {
        return Err(invalid(
            "a [ui] table must declare at least one [[ui.element]]".to_string(),
        ));
    }
    let mut elements: Vec<UiElementSpec> = Vec::with_capacity(ui.element.len());
    for element in &ui.element {
        if element.name.trim().is_empty() {
            return Err(invalid("ui element `name` must not be empty".to_string()));
        }
        if elements
            .iter()
            .any(|resolved| resolved.name == element.name)
        {
            return Err(invalid(format!(
                "duplicate ui element name `{}`",
                element.name
            )));
        }
        if element.width == 0 || element.height == 0 {
            return Err(invalid(format!(
                "ui element `{}` width and height must be greater than zero",
                element.name
            )));
        }
        let nine_slice = match &element.nine_slice {
            Some(ns) => {
                if ns.left + ns.right > element.width {
                    return Err(invalid(format!(
                        "ui element `{}` nine_slice left+right ({}) exceeds width {}",
                        element.name,
                        ns.left + ns.right,
                        element.width
                    )));
                }
                if ns.top + ns.bottom > element.height {
                    return Err(invalid(format!(
                        "ui element `{}` nine_slice top+bottom ({}) exceeds height {}",
                        element.name,
                        ns.top + ns.bottom,
                        element.height
                    )));
                }
                Some(NineSlice {
                    left: ns.left,
                    right: ns.right,
                    top: ns.top,
                    bottom: ns.bottom,
                })
            }
            None => None,
        };
        elements.push(UiElementSpec {
            name: element.name.clone(),
            width: element.width,
            height: element.height,
            nine_slice,
        });
    }
    Ok(UiSpec { elements })
}

/// The map channels a `material` case may emit. `base-color` is required; the rest
/// are optional. (`height` is an authoring aid, not an emitted channel, so it is not
/// declarable here.)
const MATERIAL_MAP_CHANNELS: [&str; 6] = [
    "base-color",
    "normal",
    "roughness",
    "metallic",
    "ao",
    "emissive",
];

/// Resolve and validate a `material` case's required `[material]` table into a
/// [`MaterialSpec`]. The `size` must be a positive power of two; `maps` must include
/// `base-color`, name only known channels, and carry no duplicates; the background
/// must parse. `invalid` is the resolver's error constructor.
fn resolve_material(
    material: Option<&ManifestMaterial>,
    invalid: &impl Fn(String) -> Error,
) -> Result<MaterialSpec> {
    let material = material
        .ok_or_else(|| invalid("a `material` case requires the [material] table".to_string()))?;
    if material.size == 0 || !material.size.is_power_of_two() {
        return Err(invalid(format!(
            "material.size ({}) must be a power of two greater than zero",
            material.size
        )));
    }
    if material.maps.is_empty() {
        return Err(invalid("material.maps must not be empty".to_string()));
    }
    let mut seen: Vec<String> = Vec::with_capacity(material.maps.len());
    for map in &material.maps {
        if !MATERIAL_MAP_CHANNELS.contains(&map.as_str()) {
            return Err(invalid(format!(
                "material map `{map}` is not a known channel (base-color | normal | roughness | \
                 metallic | ao | emissive)"
            )));
        }
        if seen.contains(map) {
            return Err(invalid(format!("duplicate material map `{map}`")));
        }
        seen.push(map.clone());
    }
    if !material.maps.iter().any(|m| m == "base-color") {
        return Err(invalid(
            "material.maps must include `base-color`".to_string(),
        ));
    }
    test_cabinet_model_core::PreviewBackground::parse(&material.background).map_err(|err| {
        invalid(format!(
            "material background `{}`: {err}",
            material.background
        ))
    })?;
    Ok(MaterialSpec {
        size: material.size,
        tile: material.tile,
        maps: material.maps.clone(),
        background: material.background.clone(),
    })
}

/// Resolve and validate a particle case's required `[particle]` table into a
/// [`ParticleSpec`]. `width`/`height` must be positive; `depth` is required (and
/// positive) for `particle-3d` and forbidden for `particle-2d`; `duration_ms` must
/// be positive; `fps` must be finite and positive; the background must parse.
/// `invalid` is the resolver's error constructor.
fn resolve_particle(
    particle: Option<&ManifestParticle>,
    is_3d: bool,
    invalid: &impl Fn(String) -> Error,
) -> Result<ParticleSpec> {
    let particle = particle
        .ok_or_else(|| invalid("a particle case requires the [particle] table".to_string()))?;
    if particle.width == 0 || particle.height == 0 {
        return Err(invalid(
            "particle width and height must be greater than zero".to_string(),
        ));
    }
    let depth = match (is_3d, particle.depth) {
        (true, Some(depth)) => {
            if depth == 0 {
                return Err(invalid(
                    "particle depth must be greater than zero".to_string(),
                ));
            }
            Some(depth)
        }
        (true, None) => {
            return Err(invalid(
                "a `particle-3d` case requires particle.depth".to_string(),
            ));
        }
        (false, Some(_)) => {
            return Err(invalid(
                "a `particle-2d` case declares no particle.depth (it is a planar field)"
                    .to_string(),
            ));
        }
        (false, None) => None,
    };
    if particle.duration_ms == 0 {
        return Err(invalid(
            "particle.duration_ms must be greater than zero".to_string(),
        ));
    }
    if !(particle.fps.is_finite() && particle.fps > 0.0) {
        return Err(invalid(
            "particle.fps must be greater than zero".to_string(),
        ));
    }
    test_cabinet_model_core::PreviewBackground::parse(&particle.background).map_err(|err| {
        invalid(format!(
            "particle background `{}`: {err}",
            particle.background
        ))
    })?;
    Ok(ParticleSpec {
        width: particle.width,
        height: particle.height,
        depth,
        duration_ms: particle.duration_ms,
        fps: particle.fps,
        looping: particle.r#loop,
        background: particle.background.clone(),
    })
}

/// Resolve and validate an audio case's required `[audio]` table into an
/// [`AudioSpec`]. `sample_rate` must be positive; `channels` must be `mono` or
/// `stereo`; `max_duration_ms` must be positive. A `sfx-sample`
/// case requires `sample_pack` (and no `instrument_bank`); a `music` case requires
/// `instrument_bank` (and no `sample_pack`); a `sfx-synth` case names neither.
/// `invalid` is the resolver's error constructor.
fn resolve_audio(
    audio: Option<&ManifestAudio>,
    kind: AssetKind,
    invalid: &impl Fn(String) -> Error,
) -> Result<AudioSpec> {
    let audio =
        audio.ok_or_else(|| invalid("an audio case requires the [audio] table".to_string()))?;
    if audio.sample_rate == 0 {
        return Err(invalid(
            "audio.sample_rate must be greater than zero".to_string(),
        ));
    }
    if audio.channels != "mono" && audio.channels != "stereo" {
        return Err(invalid(format!(
            "audio.channels `{}` must be `mono` or `stereo`",
            audio.channels
        )));
    }
    if audio.max_duration_ms == 0 {
        return Err(invalid(
            "audio.max_duration_ms must be greater than zero".to_string(),
        ));
    }
    // Each audio kind draws from a different palette: `sfx-sample` mixes over a baked
    // sample pack, `music` plays a baked instrument bank, and `sfx-synth`
    // synthesizes from oscillators alone. Require exactly the palette the kind uses
    // and reject the other so a mistyped `[audio]` is caught here.
    match kind {
        AssetKind::SfxSample => {
            if audio.sample_pack.is_none() {
                return Err(invalid(
                    "a `sfx-sample` case requires audio.sample_pack".to_string(),
                ));
            }
            if audio.instrument_bank.is_some() {
                return Err(invalid(
                    "audio.instrument_bank is only valid for a `music` case".to_string(),
                ));
            }
        }
        AssetKind::Music => {
            if audio.instrument_bank.is_none() {
                return Err(invalid(
                    "a `music` case requires audio.instrument_bank".to_string(),
                ));
            }
            if audio.sample_pack.is_some() {
                return Err(invalid(
                    "audio.sample_pack is only valid for a `sfx-sample` case".to_string(),
                ));
            }
        }
        // `sfx-synth` synthesizes from oscillators alone.
        _ => {
            if audio.sample_pack.is_some() || audio.instrument_bank.is_some() {
                return Err(invalid(
                    "a `sfx-synth` case names neither audio.sample_pack nor audio.instrument_bank"
                        .to_string(),
                ));
            }
        }
    }
    Ok(AudioSpec {
        sample_rate: audio.sample_rate,
        channels: audio.channels.clone(),
        max_duration_ms: audio.max_duration_ms,
        sample_pack: audio.sample_pack.clone(),
        instrument_bank: audio.instrument_bank.clone(),
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
