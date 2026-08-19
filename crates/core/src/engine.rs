//! Engines: the runtime a produced game is built on.
//!
//! See `docs/components/core/engines.md`. An engine owns the frame loop and the
//! delta time it hands the game, the input actions a player drives the game
//! with, the audio bus, the asset loader, and the on-screen diagnostics; some
//! engines also own rendering and a gameplay framework of their own.
//!
//! An engine is a **run dimension**, not a property of a test case: it is
//! selected per run alongside the case, variant, harness, and model, and it is
//! recorded on the run. A case declares only which engines it *supports* — a
//! compatibility gate, not a description — and the engine documents itself from
//! its own package, so a case's specs never restate the engine. That
//! independence is what keeps engines clear of frozen case versions: a case
//! version makes no claim about the engine, so publishing a new engine leaves
//! every run already recorded against that case version intact.
//!
//! Like an [orchestrator](crate::orchestrator), and unlike a
//! [harness](crate::harness), an engine carries **no in-tree Rust code**: it is a
//! directory holding one `engine.toml`. The *runtime* the manifest names is an
//! ordinary npm package, staged into the host package store and vendored into the
//! run repository at seed time; this module is only the declarative half — the
//! identity of an engine and where its runtime comes from.
//!
//! The catalogue is closed. Unlike an orchestrator there is no
//! `--engine-dir` escape hatch, because an engine is not merely a script the
//! container runs: it is a package that must be staged into the host store, a
//! documentation tree seeded into the workspace, and a host interface a
//! validator drives. An engine supplied from outside the repository would satisfy
//! none of those, so an unknown slug is refused rather than looked for on disk.

use serde::Deserialize;

use crate::error::{Error, Result};

/// The manifest file name inside an engine directory.
pub const MANIFEST_FILE: &str = "engine.toml";

/// The slug of the default engine: no runtime at all. Every test case supports
/// it, whether or not it declares it, because it is what a run looked like before
/// engines existed.
pub const NONE_SLUG: &str = "none";

/// The slugs of every built-in engine, in catalogue order. Kept in step with
/// the built-in manifest table, and the order [`EngineCatalog::all`] enumerates in.
pub const BUILT_IN_SLUGS: &[&str] = &[NONE_SLUG, "simple-2d"];

/// A built-in engine's manifest, baked in at build time so the catalog needs no
/// filesystem access and a backend-driven worker (which has no checkout) resolves
/// the same way as the CLI.
fn built_in(slug: &str) -> Option<&'static str> {
    match slug {
        NONE_SLUG => Some(include_str!("../../../engines/none/engine.toml")),
        "simple-2d" => Some(include_str!("../../../engines/simple-2d/engine.toml")),
        _ => None,
    }
}

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
    /// The `window` property the engine installs its host interface on, which a
    /// driver binds to in order to drive the clock and input and to read the
    /// audio, asset, and diagnostic logs. Absent when there is no runtime.
    #[serde(default)]
    pub handle: Option<String>,
    /// The directory inside the package holding the engine's own documentation,
    /// seeded into the run workspace. Absent when there is no runtime.
    #[serde(default)]
    pub docs: Option<String>,
}

/// Which engine a run selects.
///
/// A slug and nothing else: the catalogue is closed, so unlike an
/// [`OrchestratorSelection`](crate::orchestrator::OrchestratorSelection) there is
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

/// A resolved engine: its validated manifest, ready for the seeder, the prompt
/// renderer, and the run record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedEngine {
    /// The parsed and validated manifest.
    pub manifest: EngineManifest,
}

impl ResolvedEngine {
    /// This engine's slug, as recorded on the run.
    pub fn slug(&self) -> &str {
        &self.manifest.slug
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

    /// The `window` property the host interface is installed on, or `None` when
    /// the engine vendors no runtime.
    pub fn handle(&self) -> Option<&str> {
        self.manifest.handle.as_deref()
    }

    /// The documentation directory inside the package, or `None` when the engine
    /// vendors no runtime.
    pub fn docs(&self) -> Option<&str> {
        self.manifest.docs.as_deref()
    }
}

/// Resolves an [`EngineSelection`] into a [`ResolvedEngine`].
///
/// Every engine is built in and embedded at build time, so this is stateless and
/// infallible except for the one thing that is genuinely user input: the slug.
#[derive(Debug, Clone, Copy, Default)]
pub struct EngineCatalog;

impl EngineCatalog {
    /// Build a catalog. The built-ins are embedded, so this is stateless.
    pub fn new() -> Self {
        Self
    }

    /// Resolve a selection into a loaded engine.
    ///
    /// An unknown slug is user input — a typo on `--engine`, or a case declaring
    /// an engine this build does not carry — so it is an error naming the slugs
    /// that would have worked. A *known* slug whose embedded manifest is
    /// malformed is not user input at all: it is an authoring mistake in this
    /// repository, so it panics with the reason, exactly as
    /// [`harness_registry`](crate::harness_registry)'s manifest load does. The
    /// `every_engine_manifest_loads` guard in `crates/core/tests` is what turns
    /// that panic into a failing test rather than a failing run.
    pub fn resolve(&self, selection: &EngineSelection) -> Result<ResolvedEngine> {
        let slug = selection.slug.as_str();
        let manifest_toml = built_in(slug).ok_or_else(|| {
            Error::Engine(format!(
                "unknown engine `{slug}` (built-in engines: {})",
                BUILT_IN_SLUGS.join(", ")
            ))
        })?;
        Ok(ResolvedEngine {
            manifest: load_built_in(slug, manifest_toml),
        })
    }

    /// Every built-in engine's manifest, in [`BUILT_IN_SLUGS`] order, for a CLI
    /// listing or a console picker.
    pub fn all(&self) -> Vec<EngineManifest> {
        BUILT_IN_SLUGS
            .iter()
            .map(|slug| {
                let toml_src = built_in(slug).unwrap_or_else(|| {
                    panic!("BUILT_IN_SLUGS names `{slug}`, which is not embedded")
                });
                load_built_in(slug, toml_src)
            })
            .collect()
    }
}

/// Parse and validate one embedded manifest, panicking with the reason if it is
/// wrong.
///
/// Every failure here is an authoring bug in this repository — the manifests are
/// committed alongside this code and compiled into the binary — so there is no
/// runtime condition to report and nothing a caller could do about it. Failing
/// loudly at the point of load is what keeps the error at the manifest rather
/// than three layers away, where a `None` package would quietly turn into a run
/// seeded with no engine.
fn load_built_in(slug: &str, toml_src: &str) -> EngineManifest {
    let manifest: EngineManifest = toml::from_str(toml_src)
        .unwrap_or_else(|err| panic!("embedded engine manifest for `{slug}` is invalid: {err}"));
    validate(slug, &manifest);
    manifest
}

/// The invariants every engine manifest must hold, checked once at load.
fn validate(slug: &str, manifest: &EngineManifest) {
    assert_eq!(
        manifest.slug, slug,
        "engine manifest declares slug `{}` but lives in the `{slug}` directory",
        manifest.slug,
    );
    assert!(
        is_kebab_case(&manifest.slug),
        "engine slug `{}` is not kebab-case (lower-case letters, digits, and \
         interior hyphens)",
        manifest.slug,
    );
    assert!(
        !manifest.name.trim().is_empty(),
        "engine `{slug}` declares an empty name",
    );
    assert!(
        !manifest.description.trim().is_empty(),
        "engine `{slug}` declares an empty description",
    );
    // `handle` and `docs` describe a runtime: the `window` property the runtime
    // installs its host interface on, and the documentation directory inside the
    // runtime's package. Either one without a `package` names a thing that is
    // never delivered, which would read as a working engine and seed nothing.
    if manifest.package.is_none() {
        assert!(
            manifest.handle.is_none(),
            "engine `{slug}` declares a handle but no package; a host interface \
             needs a runtime to install it",
        );
        assert!(
            manifest.docs.is_none(),
            "engine `{slug}` declares a docs directory but no package; the docs \
             live inside the package",
        );
    }
}

/// Whether a slug is kebab-case: a non-empty run of lower-case ASCII letters and
/// digits, optionally separated by single interior hyphens.
///
/// A slug ends up in a directory name, a URL, a run record, and a test case's
/// `engines` list, so it is held to the same shape as every other slug in the
/// tree rather than accepting whatever TOML happened to parse.
fn is_kebab_case(slug: &str) -> bool {
    !slug.is_empty()
        && !slug.starts_with('-')
        && !slug.ends_with('-')
        && !slug.contains("--")
        && slug
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
}

#[cfg(test)]
#[path = "engine.test.rs"]
mod tests;
