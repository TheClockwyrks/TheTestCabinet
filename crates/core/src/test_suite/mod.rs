//! The typed model of a [test suite](https://docs.testcabinet.ai/test-suites/overview/)
//! and its suite trees, and the canonical TOML emitter that writes them back.
//!
//! A test suite is authored by The Spec Cabinet and executed by The Test Cabinet.
//! Its on-disk format is specified page by page under `test-suites/` on the
//! documentation site, and this module is the one place either application turns
//! those files into values and those values back into files. [`SuiteManifest`]
//! is the suite's identity at `<slug>/suite.toml`, and [`SuiteVersion`] covers a
//! whole suite tree — an exported version or a draft — holding every entity it
//! declares plus the paths of the trees that are not TOML.
//!
//! # The write model
//!
//! Every write is a whole-file rewrite. A file is loaded into its model, the
//! change is applied to the model, and the entire model is serialized back over
//! the file. Two properties follow, and both are what the canonical form below
//! exists to guarantee:
//!
//! - The bytes an edit produces depend only on the resulting model, never on how
//!   the edit was made.
//! - Loading and saving a canonically formatted file with no modification
//!   rewrites it byte for byte, so opening a suite in the UI never produces a
//!   diff on its own.
//!
//! # The canonical form
//!
//! The form is fixed, and it is stated here rather than left to be read out of
//! the emitter's implementation:
//!
//! - Key order within a table is struct declaration order. A map-valued table
//!   (the test case definition's `[workspaces]`) has no declaration order, so its
//!   keys are emitted sorted.
//! - Scalars precede tables within a table.
//! - Repeated tables emit in model order, which is what carries requirement order
//!   and carousel order.
//! - An array is inline when the emitted line fits within
//!   [`MAX_LINE_COLUMNS`] columns, and one entry per line — indented two spaces,
//!   with a trailing comma — otherwise.
//! - Strings are basic-quoted, escaping only what TOML requires.
//! - Nested tables are emitted as full dotted headers with unindented keys, and
//!   every table header is preceded by a blank line.
//! - A key whose value equals the default its format page declares is omitted.
//!   The model cannot tell an absent defaulted key from one written out, so
//!   omitting it is what makes the round trip exact in both directions.
//!
//! Markdown prose is referenced rather than held: the model carries the declared
//! path of `description.md`, `changelog.md`, `specification.md` and
//! `showcase.md`, and a save leaves those bytes alone.
//!
//! # Two models
//!
//! [`SuiteVersion`] is the complete model: every key the format requires is a
//! required field, which is what ingest and a run read, because what they read is
//! an exported version and an exported version is complete. [`PartialSuiteTree`] is
//! the partial model The Spec Cabinet reads through: every required key is optional,
//! every reference is the text the file declares, and a file that does not parse is
//! held as its raw text. A partial tree converts to the complete model exactly when
//! the export rules below find no problem with it.
//!
//! # Validation
//!
//! Loading a suite tree parses it. Deciding whether the result is a *valid* suite
//! is a separate pass, and its checks fall into two rule classes, each problem
//! carrying the [`SuiteRule`] it broke:
//!
//! - The export rules, [`validate_tree`], are every invariant the format states —
//!   required files and keys, slug and version agreement with the directory layout,
//!   requirement identity, a validator path being claimed by exactly one requirement.
//!   A draft breaking them still loads and saves; they are what stands between it
//!   and an export. [`validate`] applies them to a complete model.
//!   A preview is held to the same rules less the one no preview can satisfy,
//!   [`validate_preview_tree`], and [`preview_completeness`] decides which of a
//!   draft's definitions a preview can hold.
//! - The save rules, [`save_problems`], decide whether a change can be written at
//!   all: an identifier that is not kebab-case or that repeats within its file, and a
//!   path that resolves outside the suite tree.
//!
//! Every problem is a [`SuiteDiagnostic`] addressed to the entity responsible for
//! it, so a broken suite can be opened and repaired.

mod canonical;
mod catalog;
mod defaults;
mod lowering;
mod model;
mod partial;
mod preview;
mod prompt;
mod save_rules;
mod validation;
mod validators;
mod version;

pub use canonical::{MAX_LINE_COLUMNS, to_canonical_toml};
pub use catalog::{
    DRAFTS_DIR, PREVIEW_VERSION_PREFIX, PREVIEWS_DIR, TEST_SUITES_DIR, TestSuite, TestSuiteCatalog,
    VERSIONS_DIR, VersionIdentity, is_preview_version, load_suite_manifest_of, suite_dir_of,
    suite_manifest_path_of,
};
pub use lowering::{SUITE_VARIANT_SLUG, catalog_identity};
pub use model::{
    AssetCase, AssetManifest, BuildCommands, DebugApiFunction, DebugApiFunctionKind,
    DebugApiModule, DebugApiModuleRef, DebugApiParameter, DemoManifest, ShowcaseManifest,
    ShowcaseMediaEntry, SpecificationManifest, SpriteCase, SuiteAssetKind, SuiteDifficulty,
    SuiteManifest, SuiteRequirement, SuiteRequirementKind, SuiteTestCaseDefinition,
    SuiteTestCaseType, ToolchainCommands, VersionManifest, VoxelCase,
};
pub use partial::{
    ASSET_MANIFEST_FILE, DEMO_MANIFEST_FILE, PartialAssetCase, PartialAssetFolder,
    PartialAssetManifest, PartialBuildCommands, PartialDebugApi, PartialDebugApiFunction,
    PartialDebugApiModule, PartialDebugApiModuleRef, PartialDebugApiParameter, PartialDemoFolder,
    PartialDemoManifest, PartialRequirement, PartialShowcase, PartialShowcaseManifest,
    PartialShowcaseMediaEntry, PartialSpecificationFolder, PartialSpecificationManifest,
    PartialSpriteCase, PartialSuiteTree, PartialTestCaseDefinition, PartialTestCaseFile,
    PartialToolchainCommands, PartialVersionManifest, PartialVoxelCase, SHOWCASE_DESCRIPTION_FILE,
    SHOWCASE_MANIFEST_FILE, SPECIFICATION_MANIFEST_FILE, SPECIFICATION_PROSE_FILE, UnparsedFile,
};
pub use preview::{
    DefinitionCompleteness, preview_completeness, preview_files, preview_folder, preview_tree,
    preview_version,
};
pub use prompt::{
    is_suite_defined, preview_definition_prompt, render_definition_prompt,
    render_suite_definition_prompt,
};
pub use save_rules::{is_kebab_case, save_problems};
pub use validation::{
    SuiteDiagnostic, SuiteEntity, SuiteLocation, SuiteRule, load_and_validate, validate,
    validate_identity, validate_preview_tree, validate_tree,
};
pub(crate) use validators::run_suite_validators;
pub use validators::{
    DEBUG_API_HANDLE_ENV, RequirementAssertion, RequirementOutcome, RequirementStatus,
    VALIDATOR_BASE_URL_ENV,
};
pub use version::{
    ASSETS_DIR, AssetFolder, DEBUG_API_DECLARATION_FILE, DEBUG_API_DIR, DEBUG_API_FILE, DEMOS_DIR,
    DemoFolder, PROMPTS_DIR, REFERENCE_IMPLEMENTATIONS_DIR, SHARED_DEMOS_DIR, SHOWCASE_DIR,
    SPECIFICATIONS_DIR, SUITE_MANIFEST_FILE, SpecificationFolder, SuiteDebugApi, SuiteShowcase,
    SuiteTestCaseFile, SuiteTrees, SuiteVersion, TEST_CASES_DIR, VALIDATORS_DIR,
    VERSION_MANIFEST_FILE, WORKSPACES_DIR, load_suite_manifest, load_version_manifest,
};

/// What can go wrong reading or writing a suite tree.
///
/// Parse failures name the file they came from, because a suite is many files and
/// "the suite did not parse" is not something a user can act on.
#[derive(Debug, thiserror::Error)]
pub enum TestSuiteError {
    /// A file or directory could not be read or written.
    #[error("{path}: {source}")]
    Io {
        /// The path the operation was against.
        path: String,
        /// The underlying filesystem error.
        source: std::io::Error,
    },
    /// A TOML file could not be parsed into its model.
    #[error("{path}: {source}")]
    Parse {
        /// The file that failed to parse, relative to the suite tree.
        path: String,
        /// The underlying TOML error.
        source: Box<toml::de::Error>,
    },
    /// A TOML file parsed but leaves out keys its format requires, so it has no
    /// complete model.
    #[error("{path}: required keys are not declared: {}", keys.join(", "))]
    Incomplete {
        /// The file, relative to the suite tree.
        path: String,
        /// The required keys it does not declare.
        keys: Vec<String>,
    },
    /// A model could not be serialized back to TOML.
    #[error("{path}: {source}")]
    Serialize {
        /// The file the model was destined for, relative to the suite tree.
        path: String,
        /// The underlying serializer error.
        source: Box<toml_edit::ser::Error>,
    },
}

/// The result of a suite read or write.
pub type TestSuiteResult<T> = std::result::Result<T, TestSuiteError>;
