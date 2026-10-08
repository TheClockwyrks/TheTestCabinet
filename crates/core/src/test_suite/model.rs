//! One type per test suite file format.
//!
//! Each type parses from and serializes to the shape its documentation page
//! specifies, and its field order is the key order the
//! [canonical form](super#the-canonical-form) emits. Nothing here validates: a
//! field holds what the file declared, and whether that value is legal is decided
//! by a later pass over the whole suite tree.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// `false` — the serde predicate that omits a flag sitting at its documented
/// default. Taken by reference because that is the shape `skip_serializing_if`
/// hands it.
pub(super) fn is_false(value: &bool) -> bool {
    !*value
}

/// The runtime cap a test case definition gets when it declares none.
pub(super) fn default_max_runtime_hours() -> f64 {
    1.0
}

/// Whether a runtime cap is the default one, so a definition that never set it
/// emits no `max_runtime_hours` key.
pub(super) fn is_default_max_runtime_hours(value: &f64) -> bool {
    *value == default_max_runtime_hours()
}

/// `<slug>/suite.toml`: a suite's identity, declared once for the whole suite.
///
/// It sits at the root of the suite folder rather than inside any suite tree, so
/// every draft and every exported version of the suite shares it, and renaming the
/// suite renames each of them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct SuiteManifest {
    /// The suite's stable identity: a kebab-case token matching the suite folder.
    pub slug: String,
    /// The display name shown wherever the suite is presented, including for each
    /// of its exported versions.
    pub name: String,
}

/// `version.toml`: what distinguishes one suite tree, and the prose presenting it.
///
/// Every path it names is relative to the suite tree and resolves inside it, so a
/// suite tree stays self-contained.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct VersionManifest {
    /// The suite version in semver form, matching the name of the exported
    /// version folder with its leading `v` removed. Export writes it, and a draft
    /// omits it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub version: Option<String>,
    /// Classification tags, for filtering. Empty when the key is omitted.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// A one-line abstract, authored inline as plain text.
    pub summary: String,
    /// The relative path of the Markdown file describing the suite.
    pub description: String,
    /// The relative path of the Markdown file recording what changed in this
    /// version.
    pub changelog: String,
    /// Whether the version is still being iterated on. A deployment offers an
    /// experimental version only when it opts in.
    #[serde(default, skip_serializing_if = "is_false")]
    pub experimental: bool,
}

/// `specifications/<name>/specification.toml`: one specification and the ordered
/// requirements derived from its prose.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct SpecificationManifest {
    /// Kebab-case identity, unique among every specification in the suite
    /// including nested ones.
    pub id: String,
    /// The display name used wherever the specification is presented.
    pub name: String,
    /// A single inline plain-text line describing what the specification covers.
    pub summary: String,
    /// Where the rendered specification is seeded in the run workspace, relative
    /// to `specs/`.
    pub path: String,
    /// The requirements, in the order they are presented. Emitted as repeated
    /// `[[requirement]]` tables.
    #[serde(rename = "requirement", default, skip_serializing_if = "Vec::is_empty")]
    pub requirements: Vec<SuiteRequirement>,
}

/// One `[[requirement]]` of a specification, written in RFC 2119 style.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct SuiteRequirement {
    /// Kebab-case identity, unique within the file. Requirement identity across
    /// the suite is `<specification id>/<requirement id>`.
    pub id: String,
    /// Whether the requirement is decided by a validator or by review.
    pub kind: SuiteRequirementKind,
    /// The requirement statement, a complete RFC 2119 sentence with the keyword
    /// capitalized inside it.
    pub text: String,
    /// Validator module paths relative to `validators/`, each naming a `.ts` file
    /// exporting a validator function. A functional requirement declares one or
    /// more; a non-functional one declares none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub validators: Vec<String>,
}

/// How a requirement is decided.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum SuiteRequirementKind {
    /// Decided by the validators the requirement claims. Every functional
    /// requirement must be satisfied, and a validator either passes or fails.
    Functional,
    /// Judged by review rather than by a test result, so it declares no
    /// validators. Appearance requirements are of this kind.
    NonFunctional,
}

/// A debug API module: `debug-api.toml` at the root of the version folder, or one
/// of the `debug-api/<path>.toml` files it references.
///
/// One type serves both, with `handle` present only at the root. The root object
/// is what the implementation sets on `globalThis`, and validators reach the whole
/// tree through it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct DebugApiModule {
    /// The `globalThis` property name the implementation sets the root object on.
    /// Declared by `debug-api.toml` alone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub handle: Option<String>,
    /// What this module covers.
    pub description: String,
    /// The functions this module defines, as repeated `[[function]]` tables.
    #[serde(rename = "function", default, skip_serializing_if = "Vec::is_empty")]
    pub functions: Vec<DebugApiFunction>,
    /// The child modules this module reaches, as repeated `[[module]]` tables. A
    /// module declaring one is an interior node; a module declaring only
    /// functions is a leaf.
    #[serde(rename = "module", default, skip_serializing_if = "Vec::is_empty")]
    pub modules: Vec<DebugApiModuleRef>,
}

/// A `[[module]]` table: the reference from a parent module to the file declaring
/// a child. Each module file is referenced by exactly one parent, so the files
/// form the same tree the debug API does.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct DebugApiModuleRef {
    /// The property name the module is reached by on its parent.
    pub name: String,
    /// The file declaring it, relative to the suite tree.
    pub path: String,
    /// What the module covers.
    pub description: String,
}

/// A `[[function]]` table: one query or command on a debug API module.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct DebugApiFunction {
    /// The property name the function is called by, unique within its module.
    pub name: String,
    /// Whether the function reports state or changes it.
    pub kind: DebugApiFunctionKind,
    /// The function's TypeScript signature, carried as a string and copied
    /// through verbatim into the generated declaration.
    pub signature: String,
    /// What a query reports, or what a command changes.
    pub description: String,
    /// The parameters worth describing, as repeated `[[function.parameter]]`
    /// tables.
    #[serde(rename = "parameter", default, skip_serializing_if = "Vec::is_empty")]
    pub parameters: Vec<DebugApiParameter>,
}

/// Whether a debug API function reads state or writes it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum DebugApiFunctionKind {
    /// Reports state and leaves the implementation unchanged.
    Query,
    /// Changes state and reports nothing. Its effect is immediate and complete
    /// when it returns.
    Command,
}

/// A `[[function.parameter]]` table: one documented parameter of a debug API
/// function.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct DebugApiParameter {
    /// The parameter's name, as it appears in the signature.
    pub name: String,
    /// What the parameter carries.
    pub description: String,
}

/// `assets/<asset-id>/asset.toml`: one bundled asset of the suite's finished
/// asset set.
///
/// Every path it names is relative to the asset's own folder and resolves inside
/// it, so an asset folder stays self-contained.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct AssetManifest {
    /// Kebab-case identity, unique across the suite and identical to the folder
    /// name.
    pub id: String,
    /// The display name used wherever the asset is presented.
    pub name: String,
    /// The asset's format, which is also the test case type that produces it.
    pub kind: SuiteAssetKind,
    /// The `id` of the specification describing this asset, resolved suite-wide.
    /// The value is the id itself and carries no separators.
    pub specification: String,
    /// The asset's files, relative to the asset folder. At least one.
    pub files: Vec<String>,
}

/// What an asset holds, and the test case type that produces it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum SuiteAssetKind {
    /// A single 2D sprite image.
    Sprite,
    /// A 2D sprite sheet for one entity.
    SpriteSheet,
    /// A voxel model, optionally with rigid-body animation.
    Voxel,
    /// A model authored through Blender's Python API.
    Blender,
    /// A particle system read by the particle runtime.
    Particle,
    /// A musical score.
    Music,
    /// A short, non-musical audio effect.
    AudioFx,
}

/// `demos/<slug>/demo.toml`: one demonstration, a short self-contained Vite
/// project showing a single mechanic in practice.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct DemoManifest {
    /// Kebab-case identity, matching the demonstration's directory name.
    pub id: String,
    /// The display name shown wherever the demonstration is presented.
    pub name: String,
    /// A one-line abstract, authored inline as plain text.
    pub summary: String,
    /// The `id` of the specification whose mechanic this demonstrates, which is
    /// what binds a demonstration to what it illustrates.
    pub specification: String,
}

/// `showcase/showcase.toml`: the ordered carousel of a showcase directory.
///
/// This is the shared showcase format — the run, case and suite showcases are one
/// format, so this type is the manifest of all three. The bounds that go with it
/// are shared too: the description is capped at
/// [`MAX_SHOWCASE_DESCRIPTION_BYTES`](crate::MAX_SHOWCASE_DESCRIPTION_BYTES), the
/// carousel at [`MAX_SHOWCASE_MEDIA_ENTRIES`](crate::MAX_SHOWCASE_MEDIA_ENTRIES),
/// and each media file at
/// [`MAX_SHOWCASE_MEDIA_FILE_BYTES`](crate::MAX_SHOWCASE_MEDIA_FILE_BYTES).
///
/// Unknown keys are tolerated: a run-side manifest is model-written, and a stray
/// extra key is not worth losing the whole showcase over.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ShowcaseManifest {
    /// The carousel, as repeated `[[media]]` tables. Table order is carousel
    /// order.
    #[serde(rename = "media", default, skip_serializing_if = "Vec::is_empty")]
    pub media: Vec<ShowcaseMediaEntry>,
}

/// One `[[media]]` table of a `showcase.toml`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ShowcaseMediaEntry {
    /// The media file's name in the showcase directory itself. A plain file name,
    /// so it carries no path separators.
    pub file: String,
    /// The short caption displayed with the entry.
    pub name: String,
}

/// `test-cases/<name>.toml`: one individually runnable segment of the suite.
///
/// The file stem is the definition's slug. Every path a definition names is
/// relative to the suite tree.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct SuiteTestCaseDefinition {
    /// The display name shown wherever the test case is listed.
    pub name: String,
    /// The test case type, which decides which type table the definition carries.
    #[serde(rename = "type")]
    pub test_type: SuiteTestCaseType,
    /// The difficulty of this test case.
    pub difficulty: SuiteDifficulty,
    /// The engine slugs a run may select one entry from. Declared by the
    /// code-producing types; empty on the others.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub engines: Vec<String>,
    /// The specification ids this test case covers. `None` — the key omitted —
    /// covers every specification in the suite, which is why an absent key is not
    /// the same value as an empty list.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub specifications: Option<Vec<String>>,
    /// The Handlebars template under the version folder whose rendering is handed
    /// to the harness.
    pub prompt: String,
    /// The cap on the session in hours. A run exceeding it is stopped.
    #[serde(
        default = "default_max_runtime_hours",
        skip_serializing_if = "is_default_max_runtime_hours"
    )]
    pub max_runtime_hours: f64,
    /// Whether the definition is kept out of the catalog for deployments that
    /// have not opted in.
    #[serde(default, skip_serializing_if = "is_false")]
    pub experimental: bool,
    /// The command run inside the run container once the workspace and
    /// specifications are seeded and before the harness starts. `None` runs no
    /// init step. Must not be blank when declared.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub init: Option<String>,
    /// The `[sprite]` table, carried by a `sprite` definition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub sprite: Option<SpriteCase>,
    /// The `[voxel]` table, carried by a `voxel` definition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub voxel: Option<VoxelCase>,
    /// The `[blender]` table, carried by a `blender` definition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub blender: Option<AssetCase>,
    /// The `[particle]` table, carried by a `particle` definition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub particle: Option<AssetCase>,
    /// The `[music]` table, carried by a `music` definition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub music: Option<AssetCase>,
    /// The `[audio-fx]` table, carried by an `audio-fx` definition.
    #[serde(rename = "audio-fx", default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub audio_fx: Option<AssetCase>,
    /// `[workspaces]`: one entry per engine the definition declares, mapping an
    /// engine slug to the starter workspace seeded at the run root. Declared by
    /// the code-producing types.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub workspaces: Option<BTreeMap<String, String>>,
    /// `[build]`: the commands that turn the produced implementation into the
    /// served static build the validators run against.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub build: Option<BuildCommands>,
    /// `[toolchain]`: the TypeScript commands run over the produced
    /// implementation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub toolchain: Option<ToolchainCommands>,
}

/// The kind of test case a definition declares.
///
/// The `performance`, `adversarial` and `puzzle` forms are specified as TBD on
/// their documentation page: the model carries their `type` value and their common
/// keys, and declares no type table for them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum SuiteTestCaseType {
    /// Purely code-focused: the model is given every asset it needs plus the
    /// specifications describing what to write.
    EndToEnd,
    /// The model generates its own assets and writes the code implementing the
    /// specifications.
    FullStack,
    /// The model produces one sprite or one sprite sheet.
    Sprite,
    /// The model produces a boxel-style model, optionally animated.
    Voxel,
    /// The model authors an asset through Blender's Python API.
    Blender,
    /// The model authors a particle effect the particle runtime plays.
    Particle,
    /// The model authors a musical score.
    Music,
    /// The model authors short, non-musical audio.
    AudioFx,
    /// The model writes Rust measured by the wasmtime fuel it consumes. TBD: the
    /// definition keys are specified against performance testing.
    Performance,
    /// The model writes an AI controller run head-to-head against other models'.
    /// TBD: the definition keys are specified against adversarial testing.
    Adversarial,
    /// TBD: the test suite form of puzzle test cases is not yet specified.
    Puzzle,
}

/// How hard a test case is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum SuiteDifficulty {
    /// The least demanding tier.
    Easy,
    /// The middle tier.
    Medium,
    /// The most demanding tier.
    Hard,
}

/// The `[sprite]` table of a sprite test case definition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct SpriteCase {
    /// The id of the asset under `assets/` the model produces.
    pub id: String,
    /// Whether the produced asset is a sprite sheet rather than a single sprite.
    #[serde(default, skip_serializing_if = "is_false")]
    pub sheet: bool,
}

/// The `[voxel]` table of a voxel test case definition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct VoxelCase {
    /// The id of the asset under `assets/` the model produces.
    pub id: String,
    /// Whether rigid-body animation of the produced model is required.
    #[serde(default, skip_serializing_if = "is_false")]
    pub animated: bool,
}

/// The type table of an asset-producing test case whose only key is the asset it
/// targets: `[blender]`, `[particle]`, `[music]` and `[audio-fx]`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct AssetCase {
    /// The id of the asset under `assets/` the model produces.
    pub id: String,
}

/// The `[build]` table: the commands producing the served static build.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct BuildCommands {
    /// Installs the produced implementation's dependencies.
    pub install: String,
    /// Produces the static build.
    pub build: String,
}

/// The `[toolchain]` table: the TypeScript commands run over the produced
/// implementation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ToolchainCommands {
    /// Typechecks the implementation. Required, and a non-zero exit rates the run
    /// broken.
    pub typecheck: String,
    /// Lints the implementation. Recorded rather than gating.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub lint: Option<String>,
    /// Format-checks the implementation. Recorded rather than gating.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub format: Option<String>,
    /// Runs the implementation's own tests. Recorded rather than gating.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub test: Option<String>,
}
