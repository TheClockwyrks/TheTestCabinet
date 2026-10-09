//! Engine identity: the shapes a run records and a test case names.
//!
//! An engine is a run dimension (see `docs/components/core/engines.md`): a
//! directory holding one `engine.toml`, whose runtime is an npm package staged into
//! the host package store. This module is the declarative half of that: the slugs,
//! the manifest's shape, a run's selection, and the resolved engine. The catalog that
//! resolves a selection against the embedded manifests and the host package store,
//! `EngineCatalog`, is runtime and lives in `test_cabinet_core::engine`, which
//! re-exports everything here and implements [`EngineLookup`] for it.

use semver::Version;
use serde::Deserialize;

/// The manifest file name inside an engine directory.
pub const MANIFEST_FILE: &str = "engine.toml";

/// The slug of the default engine: no runtime at all. Every test case supports
/// it, whether or not it declares it, because it is what a run looked like before
/// engines existed.
pub const NONE_SLUG: &str = "none";

/// The slugs of every built-in engine, in catalogue order. Kept in step with
/// the built-in manifest table, and the order
/// `test_cabinet_core::engine::EngineCatalog::all` enumerates in.
pub const BUILT_IN_SLUGS: &[&str] = &[
    NONE_SLUG,
    "simple-2d",
    "structured-2d",
    "simple-3d",
    "structured-3d",
];

/// An engine's declarative manifest, authored as `engine.toml`.
///
/// The last three fields are the *runtime* half, and they stand or fall together
/// with `package`: an engine that vendors no runtime has no package to install a
/// host interface from and no documentation tree to seed. [`NONE_SLUG`] is that
/// engine, and it is the only one that omits them.
///
/// Unknown keys are rejected rather than ignored. A manifest is authored by hand
/// and embedded at build time, so a misspelled key is a mistake that should be a
/// loud failure at load rather than a field that silently does nothing.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case", deny_unknown_fields)]
pub struct EngineManifest {
    /// Stable slug, matching the directory the manifest lives in. It is what a
    /// run records and what a test case's `engines` list names.
    pub slug: String,
    /// Human-readable name, shown wherever the catalogue is listed.
    pub name: String,
    /// What the engine provides, for display.
    pub description: String,
    /// The npm package carrying the runtime, vendored into the run repository at
    /// seed time and written into the seeded workspace's `package.json`. Absent
    /// when the engine supplies no runtime.
    #[serde(default)]
    pub package: Option<String>,
    /// The directory inside the package holding the engine's own documentation,
    /// seeded into the run workspace. Absent when there is no runtime.
    #[serde(default)]
    pub docs: Option<String>,
}

/// Which engine a run selects.
///
/// A slug and nothing else: the catalogue is closed, so unlike an
/// `OrchestratorSelection` (`test_cabinet_core::orchestrator`) there is
/// no external-directory arm to carry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineSelection {
    /// The built-in engine slug to resolve.
    pub slug: String,
}

impl Default for EngineSelection {
    /// [`NONE_SLUG`] — a run that names no engine gets no runtime, and the build
    /// supplies every surface an engine would otherwise own.
    fn default() -> Self {
        Self::none()
    }
}

impl EngineSelection {
    /// Select a built-in engine by slug.
    pub fn new(slug: impl Into<String>) -> Self {
        Self { slug: slug.into() }
    }

    /// Select the engine that supplies no runtime.
    pub fn none() -> Self {
        Self {
            slug: NONE_SLUG.to_string(),
        }
    }
}

/// A resolved engine: its validated manifest and the version of the package the
/// catalog would stage, ready for the seeder, the prompt renderer, the run
/// record, and the case's version gate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedEngine {
    /// The parsed and validated manifest.
    pub manifest: EngineManifest,
    /// The version of this engine's package in the host package store, read from
    /// the staged `package.json`. See [`Self::version`] for what `None` means.
    version: Option<Version>,
}

impl ResolvedEngine {
    /// A resolved engine from its validated manifest and the version of its package
    /// in the host package store (`None` as [`Self::version`] describes).
    pub fn new(manifest: EngineManifest, version: Option<Version>) -> Self {
        Self { manifest, version }
    }

    /// This engine's slug, as recorded on the run.
    pub fn slug(&self) -> &str {
        &self.manifest.slug
    }

    /// The version of this engine, or `None` when it has none to report.
    ///
    /// An engine's version is the `version` of its npm package in the host
    /// package store — the *same* file seeding (`test_cabinet_core::seeding`) reads when it
    /// vendors the package into the run repository and records the version on the
    /// run, so the number a case's range is checked against and the number the run
    /// records come from one source of truth. It deliberately does **not** live in
    /// `engine.toml`: a manifest copy would be a second place to bump and would go
    /// stale the moment the package was rebuilt without it.
    ///
    /// `None` means one of two things, distinguished by
    /// [`Self::provides_runtime`]:
    ///
    /// - the engine vendors no runtime ([`NONE_SLUG`]), so there is no package and
    ///   no version — the honest answer, not a missing one;
    /// - the engine *does* vendor a runtime but the host package store holds no
    ///   readable, semver-shaped version for it. Resolution stays tolerant of that
    ///   because a catalogue lookup happens in places that never seed anything (a
    ///   `tcab engines` listing, a case resolving its declared slugs, a
    ///   `tcab validate` on a host that has staged nothing), and a store fault is
    ///   reported where it can be acted on: seeding refuses the
    ///   run with the restaging instructions, and the run gate refuses a case that
    ///   declared a version range it now cannot check.
    pub fn version(&self) -> Option<&Version> {
        self.version.as_ref()
    }

    /// Whether this engine vendors a runtime into the run repository.
    ///
    /// The whole engine seeding path — the package copy, the documentation copy,
    /// the `package.json` rewrite, the recorded engine version — is conditioned
    /// on this, and it is exactly "the manifest names a package": an engine
    /// without one has nothing to deliver.
    pub fn provides_runtime(&self) -> bool {
        self.manifest.package.is_some()
    }

    /// The npm package carrying the runtime, or `None` when the engine vendors
    /// none.
    pub fn package(&self) -> Option<&str> {
        self.manifest.package.as_deref()
    }

    /// The documentation directory inside the package, or `None` when the engine
    /// vendors no runtime.
    pub fn docs(&self) -> Option<&str> {
        self.manifest.docs.as_deref()
    }

    /// Whether seeding copies this engine's documentation into the run repository at
    /// `ENGINE_DOCS_DIR` (`test_cabinet_core::execution`).
    ///
    /// Both halves of
    /// `vendor_engine`'s (`test_cabinet_core::seeding::FsRepoSeeder`) condition, in one place a
    /// reader downstream of seeding can ask: the engine must vendor a runtime at all,
    /// and its manifest must name a docs directory inside that runtime's package.
    ///
    /// It exists because `engine/` at a run's tree ROOT means two different things
    /// depending on the answer. When this is true the directory is the engine's
    /// markdown, written there by the host and authored by nobody in the run; when it
    /// is false — every [`NONE_SLUG`] run, and any case that seeds source of its own
    /// there — the same path holds the model's work. The
    /// [code analysis](crate::code_analysis)'s floor asks this rather than matching
    /// the name, because matching the name deletes a model's submission from every
    /// figure on the page.
    pub fn seeds_docs(&self) -> bool {
        self.provides_runtime() && self.manifest.docs.is_some()
    }
}

/// Whether an engine selection names an engine this build knows.
///
/// The well-formedness checks of a test case or a suite version ask this rather than
/// resolving the engine themselves: resolution reads the host package store, which a
/// shape check has no business touching. `test_cabinet_core::engine::EngineCatalog`
/// is the implementation every caller passes.
pub trait EngineLookup {
    /// Whether `selection` names a known engine.
    fn is_known(&self, selection: &EngineSelection) -> bool;
}
