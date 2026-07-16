//! The on-disk definition store (§4/§5 of `design/v0.2.0-contracts.md`).
//!
//! This is where the backend keeps the **copies** of every ingested test-case
//! version, plus the reference screenshots it renders at ingest. It is keyed by
//! `(slug, version)` and is **immutable once written**: a key is never
//! overwritten, which is what makes a resolved definition stable for the lifetime
//! of a run that referenced it.
//!
//! Definitions are **not** in SQLite (which holds only published runs); they live
//! here and are referenced by key. The store is content-addressed enough that a
//! re-ingest of an unchanged definition is a no-op (the key already exists).
//!
//! Layout:
//! ```text
//! <store>/test-cases/<slug>/<version>/          verbatim copy of the version folder
//! <store>/test-cases/<slug>/<version>/.tcab/manifest.json   resolved, store-relative manifest
//! <store>/test-cases/<slug>/<version>/.tcab/references/<scope>/<view>.png   rendered baselines
//! ```
//!
//! Container images are not stored here: they are distributed via a registry and
//! resolved by the runner directly from its configured registry, so the backend
//! plays no part in container distribution (see
//! `docs/components/core/execution.md`).
//!
//! The `.tcab/` sidecar holds backend-generated metadata for a test-case version;
//! it is kept inside the keyed directory (not seeded) so a definition and its
//! derived artifacts move and expire as a unit.

use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use test_cabinet_core::test_case::{AudioSpec, MaterialSpec, ParticleSpec, UiSpec, version_key};
use test_cabinet_core::{AssetKind, ModelSpec, SheetSpec, TestType, VoxelSpec};
use uuid::Uuid;

use crate::error::{BackendError, Result};

/// The sidecar directory holding backend-generated metadata inside a keyed
/// definition directory.
const SIDECAR: &str = ".tcab";

/// Owns the on-disk definition store rooted at a single directory.
#[derive(Debug, Clone)]
pub struct DefinitionStore {
    root: PathBuf,
}

/// The resolved, store-relative manifest persisted alongside a copied test-case
/// version. Paths in here are relative to the version's store directory (not host
/// paths), so it can be served to a runner that has no checkout.
///
/// This is the backend's own serialization, distinct from the wire shape the API
/// emits — the API layer maps this into the §1.2 response. Keeping a resolved
/// manifest on disk means a version resolves without re-parsing TOML on every
/// request and without touching the original checkout.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredManifest {
    /// The owning test-case slug.
    pub slug: String,
    /// The exact version string.
    pub version: String,
    /// Display name.
    pub name: String,
    /// Relative difficulty.
    pub difficulty: String,
    /// Classification tags.
    pub tags: Vec<String>,
    /// Optional short site-facing abstract.
    pub summary: Option<String>,
    /// The resolved `description.md` body, inlined (the site shows it; it is not
    /// seeded). `None` when the manifest declared no description.
    pub description: Option<String>,
    /// The resolved per-version `changelog.md` body, inlined (the site shows it; it
    /// is not seeded). A changelog is **required** on every version, so this is
    /// always populated for a freshly ingested manifest; it is defaulted (to an
    /// empty string) only so a manifest stored before the field existed still
    /// deserializes.
    #[serde(default)]
    pub changelog: String,
    /// Per-case maximum harness runtime, in seconds.
    pub max_runtime_seconds: u64,
    /// The test type. Defaulted to end-to-end for manifests stored before the
    /// discriminator existed.
    #[serde(default)]
    pub test_type: TestType,
    /// Whether this version is **experimental** — still being iterated on and not
    /// yet ready to have runs published for it. Defaulted to `false` for manifests
    /// stored before the field existed. A deployment that has not opted in via
    /// `TCAB_BACKEND_ALLOW_EXPERIMENTAL` hides experimental versions from the
    /// catalog and refuses to resolve them, so they are treated as if they do not
    /// exist (see [`DefinitionStore::list_visible_cases`]).
    #[serde(default)]
    pub experimental: bool,
    /// Build commands. `Some` for an end-to-end case, `None` for any other type
    /// (an asset-generation case has no build). Defaulted for manifests stored
    /// before it became optional; skipped when absent so an asset-generation
    /// manifest carries no null build.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub build: Option<StoredBuild>,
    /// The canvas an asset-generation case draws on. `Some` only for
    /// asset-generation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canvas: Option<StoredCanvas>,
    /// The drawing tool an asset-generation case exposes. `Some` only for
    /// asset-generation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool: Option<StoredTool>,
    /// Where an asset-generation run's action log is collected. `Some` only for
    /// asset-generation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<StoredOutput>,
    /// The controller contract an adversarial case's wasm controller implements.
    /// `Some` for adversarial (per-tick `world`/`action`) and performance
    /// (per-scenario `input`/`output`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contract: Option<StoredContract>,
    /// The sandbox limits applied to an adversarial case's controllers (per tick)
    /// or a performance case's engine (per scenario). `Some` for both types.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sandbox: Option<StoredSandbox>,
    /// The held-out scored input cases of a performance case. Empty for other
    /// types. The scored set is committed with the case and never seeded into a run.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cases: Vec<StoredCase>,
    /// The simulation-loop configuration of an adversarial case. `Some` only for
    /// adversarial.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub simulation: Option<StoredSimulation>,
    /// How an adversarial case pairs implementations into matches. `Some` only for
    /// adversarial.
    #[serde(default, rename = "match", skip_serializing_if = "Option::is_none")]
    pub r#match: Option<StoredMatch>,
    /// How an adversarial case renders a recorded match for browser playback.
    /// `Some` only for adversarial.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replay: Option<StoredReplay>,
    /// The asset shape (single sprite vs sprite sheet). Defaulted to
    /// [`AssetKind::Sprite`] for manifests stored before the discriminator existed.
    #[serde(default)]
    pub asset_kind: AssetKind,
    /// The sprite-sheet frame grid and named sequences. `Some` only for a
    /// sprite-sheet case. Reuses the core [`SheetSpec`] verbatim — its serialized
    /// shape is the wire shape the runner deserializes — so the layout survives a
    /// backend-driven run without a mapping step.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet: Option<SheetSpec>,
    /// The bounding volume of a voxel case. `Some` only for the two voxel kinds.
    /// Reuses the core [`VoxelSpec`] verbatim — its serialized shape is the wire
    /// shape the runner deserializes — so the volume survives a backend-driven run
    /// without a mapping step.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voxel: Option<VoxelSpec>,
    /// The required rig of a voxel-animation case. `Some` only for a
    /// voxel-animation case. Reuses the core [`ModelSpec`] verbatim, as with
    /// [`Self::voxel`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<ModelSpec>,
    /// The painting canvas of a `ui` case. `Some` only for a `ui` case. Reuses the
    /// core [`UiSpec`] verbatim, as with [`Self::voxel`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui: Option<UiSpec>,
    /// The texture/PBR contract of a `material` case. `Some` only for a `material`
    /// case. Reuses the core [`MaterialSpec`] verbatim, as with [`Self::voxel`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub material: Option<MaterialSpec>,
    /// The particle-system contract of a particle case. `Some` only for a
    /// `particle-2d`/`particle-3d` case. Reuses the core [`ParticleSpec`] verbatim,
    /// as with [`Self::voxel`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub particle: Option<ParticleSpec>,
    /// The audio contract of an audio case. `Some` only for an
    /// `sfx-synth`/`sfx-sample`/`music` case. Reuses the core [`AudioSpec`]
    /// verbatim, as with [`Self::voxel`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio: Option<AudioSpec>,
    /// The prompt template source, inlined (the runner renders it locally).
    pub prompt_template: String,
    /// Common specs (`source` is a store-relative artifact key, `dest` the
    /// workspace destination, `template` whether it is a `.hbs` the runner renders).
    pub common_specs: Vec<StoredSpec>,
    /// Common starter workspace files (directory already expanded to individual
    /// files), seeded into the run root for every variant that does not override
    /// the workspace. Defaulted for manifests stored before the field existed.
    #[serde(default)]
    pub workspace: Vec<StoredWorkspaceFile>,
    /// The init command run in the run container after seeding, or `None`.
    /// Defaulted for manifests stored before the field existed.
    #[serde(default)]
    pub init: Option<String>,
    /// Asset files, directories already expanded to individual files.
    pub assets: Vec<StoredAsset>,
    /// The Test Cabinet runtime libraries (`@test-cabinet/*` npm names) this case's
    /// build consumes (the manifest's `packages`). Injected into the seeded
    /// workspace `package.json` as `file:` dependencies. Defaulted for manifests
    /// stored before the field existed.
    #[serde(default)]
    pub packages: Vec<String>,
    /// Variants, each with additive specs and references.
    pub variants: Vec<StoredVariant>,
    /// Common references rendered (or served as-is) for every variant.
    pub common_references: Vec<StoredReference>,
    /// Proof-of-implementation artifacts requested for every variant. Defaulted
    /// for manifests stored before the field existed.
    #[serde(default)]
    pub common_proofs: Vec<StoredProof>,
    /// Declared validation checks.
    pub checks: Vec<StoredCheck>,
    /// Reviewer checklist items declared for every variant. Reporter-side
    /// material (not seeded): served to the reporter so a reviewer is presented
    /// the items to work through. Defaulted for manifests stored before the field
    /// existed.
    #[serde(default)]
    pub common_review_items: Vec<StoredReviewItem>,
    /// The case's scoring domains (case-level, not variant-scoped). A reviewer
    /// rates each independently; the run's overall rating is the worst across
    /// them. Defaulted for manifests stored before the field existed.
    #[serde(default)]
    pub domains: Vec<StoredDomain>,
}

/// Build commands persisted in a [`StoredManifest`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredBuild {
    /// Dependency-install command.
    pub install: String,
    /// Static-build command.
    pub build: String,
    /// The run-root-relative path of the produced wasm controller module,
    /// forward-slashed. `Some` only for an adversarial case; the validator and the
    /// arena load this as the submission. Skipped when absent so an end-to-end
    /// build carries no null module.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub module: Option<String>,
}

/// The submission contract of an adversarial or performance case persisted in a
/// [`StoredManifest`]. Path fields are forward-slashed run-workspace-relative keys.
/// Adversarial carries the per-tick `world`/`action` schemas; performance carries
/// the per-scenario `input`/`output` schemas. The pairs are `Option` so the two
/// types coexist on one stored shape (only one pair is set).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct StoredContract {
    /// The exported function invoked once per tick (adversarial) or once per
    /// scenario (performance).
    pub entry: String,
    /// Adversarial only: the seeded `world` observation schema path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub world: Option<String>,
    /// Adversarial only: the seeded `action` schema path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    /// Performance only: the seeded `input` (scenario) schema path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<String>,
    /// Performance only: the seeded `output` (state) schema path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
}

/// The sandbox limits of an adversarial or performance case persisted in a
/// [`StoredManifest`]. Adversarial meters per tick (`fuel_per_tick`); performance
/// meters per scenario (`fuel_limit`). Both fuel fields are `Option` so the two
/// types coexist (only one is set).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct StoredSandbox {
    /// Adversarial only: the wasmtime fuel ceiling for a single tick.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fuel_per_tick: Option<u64>,
    /// Performance only: the wasmtime fuel ceiling for a whole scenario.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fuel_limit: Option<u64>,
    /// The linear-memory cap in bytes.
    pub max_memory_bytes: u64,
}

/// One held-out scored input case of a performance case persisted in a
/// [`StoredManifest`]. Path fields are forward-slashed catalog-relative keys; the
/// scored set is committed with the case and is **not** seeded into a run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredCase {
    /// The input instance fed to the engine.
    pub input: String,
    /// The correct answer the engine's output is checked against.
    pub expected: String,
}

/// The simulation-loop configuration of an adversarial case persisted in a
/// [`StoredManifest`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct StoredSimulation {
    /// The fixed, faked delta handed to the game logic each tick (milliseconds).
    pub timestep_ms: u32,
    /// Hard cap on match length.
    pub max_ticks: u32,
}

/// How an adversarial case pairs implementations into matches, persisted in a
/// [`StoredManifest`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct StoredMatch {
    /// Controllers per match.
    pub participants: u32,
    /// How the field is paired (for example `round-robin`).
    pub structure: String,
    /// Matches played per pairing.
    pub rounds: u32,
}

/// How an adversarial case renders a recorded match for browser playback,
/// persisted in a [`StoredManifest`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct StoredReplay {
    /// The run-workspace-relative path the renderer is seeded to, forward-slashed.
    pub renderer: String,
}

/// The canvas of an asset-generation case persisted in a [`StoredManifest`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredCanvas {
    /// Canvas width in pixels.
    pub width: u32,
    /// Canvas height in pixels.
    pub height: u32,
    /// Initial canvas state: `transparent` or a hex color.
    pub background: String,
}

/// The drawing tool of an asset-generation case persisted in a [`StoredManifest`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredTool {
    /// The drawing binary available in the run environment (`draw` or
    /// `draw-sheet`).
    pub binary: String,
    /// Run-workspace-relative path the binary re-renders the current image to (a
    /// `{frame}` template for a sprite sheet).
    pub preview: String,
}

/// The action-log output of an asset-generation case persisted in a
/// [`StoredManifest`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredOutput {
    /// Run-workspace-relative path of the recorded action log.
    pub actions: String,
}

/// A spec mapping persisted in a [`StoredManifest`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredSpec {
    /// Store-relative artifact key (fetched via the artifact endpoint).
    pub source: String,
    /// Workspace destination path.
    pub dest: String,
    /// Whether the source is a Handlebars template the runner renders.
    pub template: bool,
    /// The seeded file's role (`spec`/`script`), carried so the Inputs surfaces
    /// can tag it. Presentation only; defaults to `spec` for stores ingested
    /// before the field existed.
    #[serde(default)]
    pub kind: test_cabinet_core::SpecKind,
}

/// An asset mapping persisted in a [`StoredManifest`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredAsset {
    /// Store-relative artifact key.
    pub source: String,
    /// Workspace destination path.
    pub dest: String,
}

/// A starter workspace file persisted in a [`StoredManifest`]. The directory the
/// author declared is already expanded to individual files; `source` is the
/// store-relative artifact key and `dest` is the file's path relative to the run
/// root (where it is seeded).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredWorkspaceFile {
    /// Store-relative artifact key.
    pub source: String,
    /// Run-root-relative destination path.
    pub dest: String,
}

/// A variant persisted in a [`StoredManifest`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredVariant {
    /// Variant slug.
    pub slug: String,
    /// Display name.
    pub name: String,
    /// Optional site-facing prose.
    pub description: Option<String>,
    /// Additive specs.
    pub specs: Vec<StoredSpec>,
    /// The variant's workspace override (directory expanded to files), when it
    /// replaces the common workspace for this variant. `None` inherits the common
    /// workspace. Defaulted for manifests stored before the field existed.
    #[serde(default)]
    pub workspace: Option<Vec<StoredWorkspaceFile>>,
    /// Additive references.
    pub references: Vec<StoredReference>,
    /// Additive proof-of-implementation artifacts. Defaulted for manifests stored
    /// before the field existed.
    #[serde(default)]
    pub proofs: Vec<StoredProof>,
    /// Additive reviewer checklist items. Defaulted for manifests stored before
    /// the field existed.
    #[serde(default)]
    pub review_items: Vec<StoredReviewItem>,
    /// Additive scoring domains this variant declares on top of the case's common
    /// [`StoredManifest::domains`]. Rated only when this variant is selected.
    /// Defaulted for manifests stored before the field existed.
    #[serde(default)]
    pub domains: Vec<StoredDomain>,
    /// The variant's bounding-volume override, when it declares its own `[voxel]`
    /// (the size axis behind a case's half/base/double variants). `None` inherits
    /// the case's common [`StoredManifest::voxel`]. Reuses the core [`VoxelSpec`]
    /// verbatim, as [`StoredManifest::voxel`] does. Defaulted for manifests stored
    /// before the field existed.
    #[serde(default)]
    pub voxel: Option<VoxelSpec>,
}

/// A reference persisted in a [`StoredManifest`]. The served media lives under the
/// version's `.tcab/references/<scope>/<view>.<ext>` — a rendered mockup is a
/// `.png`; a static reference is the image/video stored as-is.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredReference {
    /// The view slug.
    pub view: String,
    /// How the reference is produced (rendered mockup, static image, or static
    /// video). Defaulted to `rendered` for manifests stored before the field
    /// existed (every reference was an HTML mockup then).
    #[serde(default = "default_reference_kind")]
    pub kind: test_cabinet_core::ReferenceKind,
    /// The file extension the media is stored and served under (`png` for a
    /// rendered mockup; the static source's own extension otherwise). Defaulted to
    /// `png` for manifests stored before the field existed.
    #[serde(default = "default_reference_extension")]
    pub extension: String,
}

/// The default reference kind for manifests stored before `kind` was recorded:
/// every reference used to be an HTML mockup rendered to a screenshot.
fn default_reference_kind() -> test_cabinet_core::ReferenceKind {
    test_cabinet_core::ReferenceKind::Rendered
}

/// The default reference extension for manifests stored before it was recorded.
fn default_reference_extension() -> String {
    "png".to_string()
}

/// A proof-of-implementation artifact persisted in a [`StoredManifest`]. Produced
/// by the agent at its `dest` during a run (not seeded); validation records its
/// presence and the reporter pairs it with the expected reference.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredProof {
    /// Stable slug identifying the proof.
    pub id: String,
    /// Human-readable display name.
    pub name: String,
    /// Whether the proof media is an image or a video.
    pub kind: test_cabinet_core::MediaKind,
    /// The run-root-relative path the agent must write the proof to.
    pub dest: String,
}

/// A reviewer checklist item persisted in a [`StoredManifest`]. Reporter-side
/// material (not seeded); served to the reporter so a reviewer is presented the
/// items to work through.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredReviewItem {
    /// Stable slug identifying the item; recorded with the reviewer's verdict.
    pub id: String,
    /// A short heading shown above the item in the reviewer UI. Required: a
    /// manifest missing it is invalid data, not a blank heading.
    pub title: String,
    /// The prose a reviewer reads — what to check.
    pub text: String,
    /// Optional reference view paired with this item as the expected target.
    #[serde(default)]
    pub reference: Option<String>,
    /// Optional proof id paired with this item as the submitted media.
    #[serde(default)]
    pub proof: Option<String>,
    /// Sprite-sheet sequence slugs this item is about (the relevant animations the
    /// reviewer plays). Empty when the item names none.
    #[serde(default)]
    pub sequences: Vec<String>,
    /// Sprite-sheet frame indices this item is about (the relevant frames the
    /// reviewer inspects). Empty when the item names none.
    #[serde(default)]
    pub frames: Vec<u32>,
    /// How many points the item is worth toward the run's score. Always greater
    /// than zero. Split evenly across `sub_items` when the item has any; a graded
    /// item is worth `weight × 10`.
    pub weight: u32,
    /// Whether the item is graded on the five-level scale (a game-jam category)
    /// rather than pass/fail. False for every other test type.
    #[serde(default)]
    pub graded: bool,
    /// The scoring domain (by id) the item belongs to, or `None` for a general
    /// item that belongs to no single domain.
    #[serde(default)]
    pub domain: Option<String>,
    /// Name-only sub-items this item is graded by, each an independently scored
    /// point. Empty for an item graded as a whole.
    #[serde(default)]
    pub sub_items: Vec<StoredSubReviewItem>,
}

/// A name-only sub-item of a [`StoredReviewItem`], persisted in a
/// [`StoredManifest`]: one independently graded point within the item.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredSubReviewItem {
    /// Stable slug identifying the sub-item within its parent; part of the
    /// composite verdict id the reviewer records against it.
    pub id: String,
    /// The short heading shown for the sub-item in the reviewer UI.
    pub title: String,
}

/// A scoring domain persisted in a [`StoredManifest`]. A reviewer rates each
/// independently; the run's overall rating is the worst across them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredDomain {
    /// Stable slug identifying the domain; recorded with the per-domain rating.
    pub id: String,
    /// Human-readable display name.
    pub name: String,
    /// A brief description of what the domain covers, shown to the reviewer.
    pub description: String,
}

/// A check persisted in a [`StoredManifest`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredCheck {
    /// View slug the check records under.
    pub view: String,
    /// Display name.
    pub name: String,
    /// Reference view that is the comparison baseline.
    pub reference_view: String,
    /// Actions driving the implementation into the view before capture.
    pub actions: Vec<test_cabinet_core::test_case::CheckAction>,
}

impl DefinitionStore {
    /// Open (creating the root if necessary) a store at the given directory.
    pub fn open(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        std::fs::create_dir_all(&root)?;
        Ok(Self { root })
    }

    /// The store root directory.
    pub fn root(&self) -> &Path {
        &self.root
    }

    // --- Test-case versions -------------------------------------------------

    /// The directory a `(slug, version)` is stored under.
    pub fn version_dir(&self, slug: &str, version: &str) -> PathBuf {
        self.root.join("test-cases").join(slug).join(version)
    }

    /// Whether a `(slug, version)` is already ingested (its manifest exists).
    pub fn has_version(&self, slug: &str, version: &str) -> bool {
        self.manifest_path(slug, version).is_file()
    }

    /// The root under which version builds are staged before being swapped into the
    /// served `test-cases/` tree. It lives inside the store's sidecar so it shares
    /// the store's filesystem (the swap is then a plain rename) and stays off the
    /// `test-cases/` tree that `list_versions` walks, so a half-built staging dir is
    /// never mistaken for an ingested version.
    fn staging_root(&self) -> PathBuf {
        self.root.join(SIDECAR).join("staging")
    }

    /// Create a fresh, empty staging directory for building one version's tree
    /// before [`publish_staged_version`](Self::publish_staged_version) swaps it into
    /// place. The name is unique per call so concurrent ingests never collide.
    pub fn new_staging_dir(&self, slug: &str, version: &str) -> Result<PathBuf> {
        let dir = self
            .staging_root()
            .join(format!("{slug}-{version}-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    }

    /// Atomically publish a fully-built `staged` tree as `(slug, version)`, replacing
    /// any existing copy. A concurrent [`read_manifest`](Self::read_manifest) sees
    /// either the previous version or the new one but never a half-written or
    /// manifest-less tree — the window a destructive in-place re-ingest opened, which
    /// surfaced as a spurious 404 "is not ingested" while a force re-ingest rewrote a
    /// version. `staged` must already hold the complete tree (including its `.tcab`
    /// sidecar) and sit under this store's root so the rename is a same-filesystem
    /// move rather than a copy.
    pub fn publish_staged_version(&self, slug: &str, version: &str, staged: &Path) -> Result<()> {
        let dest = self.version_dir(slug, version);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        if !dest.exists() {
            std::fs::rename(staged, &dest)?;
            return Ok(());
        }
        // Two-step swap: move the live version aside, move the staged one in, then
        // drop the retired copy. The window where `dest` is briefly absent is two
        // rename syscalls wide (microseconds) rather than the seconds-to-minutes a
        // destructive in-place rebuild (remove → copy → render → write manifest)
        // left it manifest-less.
        let retired = self
            .staging_root()
            .join(format!("retired-{slug}-{version}-{}", Uuid::new_v4()));
        if let Some(parent) = retired.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::rename(&dest, &retired)?;
        if let Err(err) = std::fs::rename(staged, &dest) {
            // Roll the live version back so a failed swap is not a lost version.
            let _ = std::fs::rename(&retired, &dest);
            return Err(err.into());
        }
        let _ = std::fs::remove_dir_all(&retired);
        Ok(())
    }

    /// Remove an ingested `(slug, version)` from the served tree — the prune half of
    /// a whole-catalog ingest, which drops versions the checkout no longer declares.
    ///
    /// The version directory is first renamed aside into the staging area and then
    /// deleted, so a concurrent [`read_manifest`](Self::read_manifest) sees the
    /// version either wholly present or wholly gone, never mid-deletion — the same
    /// atomic-swap discipline [`publish_staged_version`](Self::publish_staged_version)
    /// uses. When the slug's last version is removed its (now-empty) slug directory is
    /// removed too, so a fully-dropped case leaves no empty shell that
    /// [`list_cases`](Self::list_cases) would still report. A version that is already
    /// absent is a no-op.
    pub fn remove_version(&self, slug: &str, version: &str) -> Result<()> {
        let dir = self.version_dir(slug, version);
        if !dir.exists() {
            return Ok(());
        }
        let retired = self
            .staging_root()
            .join(format!("pruned-{slug}-{version}-{}", Uuid::new_v4()));
        if let Some(parent) = retired.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::rename(&dir, &retired)?;
        let _ = std::fs::remove_dir_all(&retired);
        // Drop the slug directory once its last version is gone. `remove_dir` only
        // succeeds on an empty directory, so a slug that still has other versions is
        // left untouched.
        let slug_dir = self.root.join("test-cases").join(slug);
        let _ = std::fs::remove_dir(&slug_dir);
        Ok(())
    }

    /// Path to the store-root marker recording the catalog version of the most
    /// recent whole-catalog ingest. Lives in a root-level `.tcab/` sidecar (parallel
    /// to the per-version sidecars) so it is wiped together with the store it
    /// describes — a fresh store has no marker and re-ingests unconditionally.
    fn catalog_version_path(&self) -> PathBuf {
        self.root.join(SIDECAR).join("catalog-version")
    }

    /// The catalog version stamped by the last whole-catalog ingest that supplied
    /// one, if any. Used to skip a redundant re-ingest+re-render when the catalog
    /// content is unchanged from what the store already holds.
    pub fn catalog_version(&self) -> Option<String> {
        std::fs::read_to_string(self.catalog_version_path())
            .ok()
            .map(|version| version.trim().to_string())
            .filter(|version| !version.is_empty())
    }

    /// Record the catalog version of a just-completed whole-catalog ingest.
    pub fn set_catalog_version(&self, version: &str) -> Result<()> {
        let path = self.catalog_version_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, version)?;
        Ok(())
    }

    /// List every ingested case slug and its versions, oldest-first by semantic
    /// version so the newest is listed last per the catalog contract.
    pub fn list_cases(&self) -> Result<Vec<(String, Vec<String>)>> {
        let cases_root = self.root.join("test-cases");
        let mut out = Vec::new();
        for slug in sorted_dir_names(&cases_root)? {
            let versions = self.list_versions(&slug)?;
            if !versions.is_empty() {
                out.push((slug, versions));
            }
        }
        Ok(out)
    }

    /// List the ingested versions for a slug, ordered oldest-first by semantic
    /// version so the newest is listed last (matches the catalog contract's
    /// "newest-listed-last").
    ///
    /// Versions are compared component-wise via [`version_key`] — the same order
    /// the core filesystem catalog uses — rather than by directory modification
    /// time. Mtime is not a reliable proxy for version order: a fresh checkout or
    /// a re-ingest writes/touches version directories in whatever order it walks
    /// them, so mtime differs between a locally-seeded store and a
    /// freshly-provisioned one even for identical content. That divergence made
    /// the "latest version" the store reports (e.g. for the review-plan staleness
    /// check and the catalog's version dropdown) depend on the environment.
    pub fn list_versions(&self, slug: &str) -> Result<Vec<String>> {
        let slug_dir = self.root.join("test-cases").join(slug);
        if !slug_dir.is_dir() {
            return Ok(Vec::new());
        }
        let mut versions: Vec<String> = Vec::new();
        for name in raw_dir_names(&slug_dir)? {
            if !self.manifest_path(slug, &name).is_file() {
                continue;
            }
            versions.push(name);
        }
        versions.sort_by(|a, b| version_key(a).cmp(&version_key(b)).then_with(|| a.cmp(b)));
        Ok(versions)
    }

    /// Whether a stored version is flagged **experimental** (its manifest's
    /// `experimental = true`). A version whose manifest is missing or unreadable is
    /// reported as non-experimental so a half-written or pre-field version stays
    /// visible by default rather than vanishing on a transient read error.
    pub fn is_experimental(&self, slug: &str, version: &str) -> bool {
        self.read_manifest(slug, version)
            .map(|manifest| manifest.experimental)
            .unwrap_or(false)
    }

    /// Like [`Self::list_cases`], but the **outward-facing** view: when
    /// `allow_experimental` is false, every experimental version is hidden and a
    /// case left with no visible versions is dropped entirely, so an experimental
    /// case is invisible to the UI until it graduates. When `allow_experimental`
    /// is true this is exactly [`Self::list_cases`] (no per-version manifest read).
    ///
    /// This is deliberately separate from [`Self::list_cases`], which ingest's
    /// reconciliation relies on seeing *every* stored version (experimental
    /// included) so it can prune what the checkout no longer declares.
    pub fn list_visible_cases(
        &self,
        allow_experimental: bool,
    ) -> Result<Vec<(String, Vec<String>)>> {
        if allow_experimental {
            return self.list_cases();
        }
        let cases_root = self.root.join("test-cases");
        let mut out = Vec::new();
        for slug in sorted_dir_names(&cases_root)? {
            let versions = self.list_visible_versions(&slug, allow_experimental)?;
            if !versions.is_empty() {
                out.push((slug, versions));
            }
        }
        Ok(out)
    }

    /// Like [`Self::list_versions`], but hides experimental versions unless
    /// `allow_experimental` is true. The outward-facing analogue used by the
    /// per-case versions endpoint so an experimental version is not offered to the
    /// UI (and a case with only experimental versions reports none, i.e. 404s).
    pub fn list_visible_versions(
        &self,
        slug: &str,
        allow_experimental: bool,
    ) -> Result<Vec<String>> {
        let versions = self.list_versions(slug)?;
        if allow_experimental {
            return Ok(versions);
        }
        Ok(versions
            .into_iter()
            .filter(|version| !self.is_experimental(slug, version))
            .collect())
    }

    /// Path to a version's resolved manifest sidecar.
    pub fn manifest_path(&self, slug: &str, version: &str) -> PathBuf {
        manifest_in(&self.version_dir(slug, version))
    }

    /// Read a version's stored manifest.
    pub fn read_manifest(&self, slug: &str, version: &str) -> Result<StoredManifest> {
        let path = self.manifest_path(slug, version);
        let bytes = std::fs::read(&path).map_err(|_| {
            BackendError::NotFound(format!(
                "test-case version `{slug}@{version}` is not ingested"
            ))
        })?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    /// Persist a version's resolved manifest sidecar into its canonical directory.
    pub fn write_manifest(&self, manifest: &StoredManifest) -> Result<()> {
        let version_dir = self.version_dir(&manifest.slug, &manifest.version);
        write_manifest_in(&version_dir, manifest)
    }

    /// Resolve a store-relative artifact key inside a version directory, guarding
    /// against traversal, and read its bytes. The `.tcab` sidecar is off-limits.
    pub fn read_artifact(&self, slug: &str, version: &str, key: &str) -> Result<Vec<u8>> {
        let base = self.version_dir(slug, version);
        let path = safe_join(&base, key)?;
        if first_component_is_sidecar(key) {
            return Err(BackendError::NotFound(format!("unknown artifact `{key}`")));
        }
        std::fs::read(&path)
            .map_err(|_| BackendError::NotFound(format!("unknown artifact `{key}`")))
    }

    /// Path to a stored reference media file for a version. `scope` is `_common`
    /// or a variant slug; `file` is `<view>.<ext>`.
    pub fn reference_path(&self, slug: &str, version: &str, scope: &str, file: &str) -> PathBuf {
        reference_in(&self.version_dir(slug, version), scope, file)
    }

    /// Read a stored reference media file (`<view>.<ext>`).
    pub fn read_reference(
        &self,
        slug: &str,
        version: &str,
        scope: &str,
        file: &str,
    ) -> Result<Vec<u8>> {
        // `scope` and `file` are validated to be single, traversal-free path
        // segments so a crafted request cannot read outside the references dir.
        if !is_safe_segment(scope) || !is_safe_segment(file) {
            return Err(BackendError::BadRequest(
                "invalid reference scope or file".to_string(),
            ));
        }
        let path = self.reference_path(slug, version, scope, file);
        std::fs::read(&path)
            .map_err(|_| BackendError::NotFound(format!("reference `{scope}/{file}` not stored")))
    }

    // --- Per-run media ------------------------------------------------------

    /// The directory all of a run's stored media lives under
    /// (`runs/<run_id>/`): its proof and asset media and its controller wasm.
    pub fn run_dir(&self, run_id: &str) -> PathBuf {
        self.root.join("runs").join(run_id)
    }

    /// Remove a run's entire stored-media tree (`runs/<run_id>/` — proof, asset,
    /// and controller). Idempotent: a run that uploaded no media (so the directory
    /// never existed) is treated as already gone. Called when a run is deleted so
    /// no orphaned bytes are left behind.
    pub fn delete_run_media(&self, run_id: &str) -> Result<()> {
        if !is_safe_segment(run_id) {
            return Err(BackendError::BadRequest("invalid run id".to_string()));
        }
        match std::fs::remove_dir_all(self.run_dir(run_id)) {
            Ok(()) => Ok(()),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(err) => Err(err.into()),
        }
    }

    /// The directory a published run's proof media is stored under.
    pub fn run_proof_dir(&self, run_id: &str) -> PathBuf {
        self.run_dir(run_id).join("proof")
    }

    /// Persist one proof media file for a run under `runs/<run_id>/proof/<file>`
    /// (`file` is `<proof-id>.<ext>`). The store is immutable per key, but proof
    /// media is keyed by the run id a publish carries, so a re-publish overwrites
    /// the identical bytes.
    pub fn write_run_proof(&self, run_id: &str, file: &str, bytes: &[u8]) -> Result<()> {
        if !is_safe_segment(run_id) || !is_safe_segment(file) {
            return Err(BackendError::BadRequest(
                "invalid run id or proof file".to_string(),
            ));
        }
        let dir = self.run_proof_dir(run_id);
        std::fs::create_dir_all(&dir)?;
        std::fs::write(dir.join(file), bytes)?;
        Ok(())
    }

    /// List a run's stored proof media file names (`<proof-id>.<ext>`), sorted.
    /// A run with no stored proofs yields an empty list.
    pub fn list_run_proofs(&self, run_id: &str) -> Result<Vec<String>> {
        let dir = self.run_proof_dir(run_id);
        let read = match std::fs::read_dir(&dir) {
            Ok(read) => read,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(err) => return Err(err.into()),
        };
        let mut names = Vec::new();
        for entry in read {
            let entry = entry?;
            if entry.file_type()?.is_file()
                && let Some(name) = entry.file_name().to_str()
            {
                names.push(name.to_string());
            }
        }
        names.sort();
        Ok(names)
    }

    /// Read one proof media file for a run (`<proof-id>.<ext>`).
    pub fn read_run_proof(&self, run_id: &str, file: &str) -> Result<Vec<u8>> {
        if !is_safe_segment(run_id) || !is_safe_segment(file) {
            return Err(BackendError::BadRequest(
                "invalid run id or proof file".to_string(),
            ));
        }
        let path = self.run_proof_dir(run_id).join(file);
        std::fs::read(&path)
            .map_err(|_| BackendError::NotFound(format!("proof `{run_id}/{file}` not stored")))
    }

    // --- Per-run asset-generation media -------------------------------------

    /// The directory a published asset-generation run's media is stored under.
    pub fn run_asset_dir(&self, run_id: &str) -> PathBuf {
        self.run_dir(run_id).join("asset")
    }

    /// Persist one asset media file for a run under `runs/<run_id>/asset/<file>`
    /// (`file` is `regenerated.png`, `preview.png`, `target.png`, or
    /// `actions.json`). Keyed by the run id a publish carries, so a re-publish
    /// overwrites the identical bytes.
    pub fn write_run_asset(&self, run_id: &str, file: &str, bytes: &[u8]) -> Result<()> {
        if !is_safe_segment(run_id) || !is_safe_segment(file) {
            return Err(BackendError::BadRequest(
                "invalid run id or asset file".to_string(),
            ));
        }
        let dir = self.run_asset_dir(run_id);
        std::fs::create_dir_all(&dir)?;
        std::fs::write(dir.join(file), bytes)?;
        Ok(())
    }

    /// Read one asset media file for a run.
    pub fn read_run_asset(&self, run_id: &str, file: &str) -> Result<Vec<u8>> {
        if !is_safe_segment(run_id) || !is_safe_segment(file) {
            return Err(BackendError::BadRequest(
                "invalid run id or asset file".to_string(),
            ));
        }
        let path = self.run_asset_dir(run_id).join(file);
        std::fs::read(&path)
            .map_err(|_| BackendError::NotFound(format!("asset `{run_id}/{file}` not stored")))
    }

    /// Where a run's pushed controller wasm lives: `runs/<run_id>/controller.wasm`.
    /// Adversarial runs upload this at push so a pushed implementation can be
    /// resolved and pitted in the arena from any host.
    pub fn run_controller_path(&self, run_id: &str) -> PathBuf {
        self.run_dir(run_id).join("controller.wasm")
    }

    /// Persist a run's controller wasm module. Keyed by the run id a push carries,
    /// so a re-push overwrites the identical bytes.
    pub fn write_run_controller(&self, run_id: &str, bytes: &[u8]) -> Result<()> {
        if !is_safe_segment(run_id) {
            return Err(BackendError::BadRequest("invalid run id".to_string()));
        }
        let path = self.run_controller_path(run_id);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, bytes)?;
        Ok(())
    }

    /// Whether a run has an uploaded controller wasm (so it can be pitted in the
    /// arena). A cheap existence check used when listing pushed controllers.
    pub fn has_run_controller(&self, run_id: &str) -> bool {
        is_safe_segment(run_id) && self.run_controller_path(run_id).is_file()
    }

    /// Read a run's controller wasm module.
    pub fn read_run_controller(&self, run_id: &str) -> Result<Vec<u8>> {
        if !is_safe_segment(run_id) {
            return Err(BackendError::BadRequest("invalid run id".to_string()));
        }
        let path = self.run_controller_path(run_id);
        std::fs::read(&path).map_err(|_| {
            BackendError::NotFound(format!("controller for run `{run_id}` not stored"))
        })
    }

    /// Where a tournament's per-match replays live:
    /// `tournaments/<tournament_id>/matches/<match_id>/`.
    pub fn tournament_match_dir(&self, tournament_id: &str, match_id: &str) -> PathBuf {
        self.root
            .join("tournaments")
            .join(tournament_id)
            .join("matches")
            .join(match_id)
    }

    /// Persist one match's replay under
    /// `tournaments/<tournament_id>/matches/<match_id>/replay.json`. Keyed by the
    /// caller-assigned ids, so a re-publish overwrites the identical bytes.
    pub fn write_tournament_match(
        &self,
        tournament_id: &str,
        match_id: &str,
        bytes: &[u8],
    ) -> Result<()> {
        if !is_safe_segment(tournament_id) || !is_safe_segment(match_id) {
            return Err(BackendError::BadRequest(
                "invalid tournament id or match id".to_string(),
            ));
        }
        let dir = self.tournament_match_dir(tournament_id, match_id);
        std::fs::create_dir_all(&dir)?;
        std::fs::write(dir.join("replay.json"), bytes)?;
        Ok(())
    }

    /// Read one match's replay JSON.
    pub fn read_tournament_match(&self, tournament_id: &str, match_id: &str) -> Result<Vec<u8>> {
        if !is_safe_segment(tournament_id) || !is_safe_segment(match_id) {
            return Err(BackendError::BadRequest(
                "invalid tournament id or match id".to_string(),
            ));
        }
        let path = self
            .tournament_match_dir(tournament_id, match_id)
            .join("replay.json");
        std::fs::read(&path).map_err(|_| {
            BackendError::NotFound(format!(
                "replay for match `{match_id}` of tournament `{tournament_id}` not stored"
            ))
        })
    }
}

/// Read a directory's immediate subdirectory names, sorted lexically.
fn sorted_dir_names(dir: &Path) -> Result<Vec<String>> {
    let mut names = raw_dir_names(dir)?;
    names.sort();
    Ok(names)
}

/// Read a directory's immediate subdirectory names, ignoring files and hidden
/// entries. A missing directory yields an empty list (an empty store is valid).
fn raw_dir_names(dir: &Path) -> Result<Vec<String>> {
    let mut names = Vec::new();
    let read = match std::fs::read_dir(dir) {
        Ok(read) => read,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(names),
        Err(err) => return Err(err.into()),
    };
    for entry in read {
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

/// Join a forward-slash relative key onto a base directory, rejecting any key
/// that is absolute or escapes the base via `..`. Returns the resolved path.
fn safe_join(base: &Path, key: &str) -> Result<PathBuf> {
    let rel = Path::new(key);
    let mut depth: i32 = 0;
    for component in rel.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => {
                return Err(BackendError::BadRequest(format!(
                    "path `{key}` is not relative"
                )));
            }
            Component::ParentDir => {
                depth -= 1;
                if depth < 0 {
                    return Err(BackendError::BadRequest(format!(
                        "path `{key}` escapes the definition store"
                    )));
                }
            }
            Component::CurDir => {}
            Component::Normal(_) => depth += 1,
        }
    }
    Ok(base.join(rel))
}

/// Whether a key's first path component is the reserved `.tcab` sidecar.
fn first_component_is_sidecar(key: &str) -> bool {
    Path::new(key)
        .components()
        .find_map(|c| match c {
            Component::Normal(name) => Some(name.to_string_lossy() == SIDECAR),
            _ => None,
        })
        .unwrap_or(false)
}

/// The manifest sidecar path relative to a version directory (its canonical
/// directory or a staging one). Single source of the layout shared by
/// [`DefinitionStore::manifest_path`] and the staging build path.
pub fn manifest_in(version_dir: &Path) -> PathBuf {
    version_dir.join(SIDECAR).join("manifest.json")
}

/// A stored reference media path relative to a version directory. `scope` is
/// `_common` or a variant slug; `file` is `<view>.<ext>`. Single source of the
/// layout shared by [`DefinitionStore::reference_path`] and the staging build path.
pub fn reference_in(version_dir: &Path, scope: &str, file: &str) -> PathBuf {
    version_dir
        .join(SIDECAR)
        .join("references")
        .join(scope)
        .join(file)
}

/// Write a resolved manifest into an explicit version directory (canonical or
/// staging), creating its sidecar dir. [`DefinitionStore::write_manifest`] is this
/// against the canonical [`version_dir`](DefinitionStore::version_dir); ingest uses
/// it against a staging dir it then swaps into place.
pub fn write_manifest_in(version_dir: &Path, manifest: &StoredManifest) -> Result<()> {
    let path = manifest_in(version_dir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, serde_json::to_vec_pretty(manifest)?)?;
    Ok(())
}

/// Whether a string is a single safe path segment (no separators, no `.`/`..`,
/// non-empty). Used to validate a reference scope/view before joining.
fn is_safe_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment != "."
        && segment != ".."
        && !segment.contains('/')
        && !segment.contains('\\')
}

#[cfg(test)]
#[path = "store.test.rs"]
mod tests;
