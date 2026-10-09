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

use std::path::{Path, PathBuf};

use semver::Version;

use crate::error::{Error, Result};

// The engine shapes a run record and a test case name (the slugs, the manifest, the
// selection and the resolved engine) are contract, so they live in
// `test-cabinet-contracts` and are re-exported here; the catalog that resolves them
// against the embedded manifests and the host package store is runtime.
pub use test_cabinet_contracts::engine::*;

/// A built-in engine's manifest, baked in at build time so the catalog needs no
/// filesystem access and a backend-driven worker (which has no checkout) resolves
/// the same way as the CLI.
fn built_in(slug: &str) -> Option<&'static str> {
    match slug {
        NONE_SLUG => Some(include_str!("../../../engines/none/engine.toml")),
        "simple-2d" => Some(include_str!("../../../engines/simple-2d/engine.toml")),
        "structured-2d" => Some(include_str!("../../../engines/structured-2d/engine.toml")),
        "simple-3d" => Some(include_str!("../../../engines/simple-3d/engine.toml")),
        "structured-3d" => Some(include_str!("../../../engines/structured-3d/engine.toml")),
        _ => None,
    }
}

/// Resolves an [`EngineSelection`] into a [`ResolvedEngine`].
///
/// Every engine's *manifest* is built in and embedded at build time, so the only
/// thing that is genuinely user input is the slug. An engine's *version* is not
/// embedded: it is the version of the engine's package in the host package store,
/// so the catalog carries the store path in order to answer
/// [`ResolvedEngine::version`] from the same file the seeder reads. That is what
/// lets the run gate compare a case's declared range against the version a run
/// would actually be given, before any container work.
#[derive(Debug, Clone)]
pub struct EngineCatalog {
    /// The host package store engine packages are staged into — the same
    /// directory [`FsRepoSeeder`](crate::seeding::FsRepoSeeder) vendors from, so
    /// the version this reports is the version that run would be seeded with.
    package_store: PathBuf,
}

impl Default for EngineCatalog {
    fn default() -> Self {
        Self::new()
    }
}

impl EngineCatalog {
    /// Build a catalog reading versions from the default host package store (the
    /// `TCAB_PACKAGE_STORE` override when set, otherwise the baked-image default),
    /// exactly as [`FsRepoSeeder::new`](crate::seeding::FsRepoSeeder::new) does.
    pub fn new() -> Self {
        Self {
            package_store: crate::seeding::package_store_dir(),
        }
    }

    /// Build a catalog reading versions from an explicit package store rather than
    /// the default one. The counterpart of
    /// [`FsRepoSeeder::with_package_store`](crate::seeding::FsRepoSeeder::with_package_store),
    /// for tests and for a caller staging packages somewhere of its own; pair the
    /// two so the version a case's range is checked against is the version the run
    /// is seeded with.
    pub fn with_package_store(package_store: impl Into<PathBuf>) -> Self {
        Self {
            package_store: package_store.into(),
        }
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
        let manifest = load_built_in(slug, manifest_toml);
        let version = staged_version(&self.package_store, &manifest);
        Ok(ResolvedEngine::new(manifest, version))
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

impl EngineLookup for EngineCatalog {
    fn is_known(&self, selection: &EngineSelection) -> bool {
        built_in(&selection.slug).is_some()
    }
}

/// The version of an engine's package in `package_store`, or `None` when the
/// engine vendors no package or the store holds nothing usable for it.
///
/// Reads the very file [`seeding`](crate::seeding) reads when it vendors the
/// package and records the version on the run, so there is exactly one source of
/// truth for an engine's version and no way for a gate to be checked against a
/// number a run would not receive.
///
/// Every failure collapses to `None` rather than to an error, because a catalogue
/// lookup is not a run: `tcab engines`, a case resolving its declared slugs, and a
/// `tcab validate` on a host that has staged nothing all resolve engines without
/// ever seeding one. The two places a missing version actually matters both refuse
/// loudly on their own — the seeder with the restaging instructions, and
/// `resolve_engine` with the range it could not check — so swallowing it here
/// costs no diagnosis.
fn staged_version(package_store: &Path, manifest: &EngineManifest) -> Option<Version> {
    let package = manifest.package.as_deref()?;
    let raw = crate::seeding::staged_package_version(&package_store.join(package), package).ok()?;
    Version::parse(&raw).ok()
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
    // `docs` describes a runtime: the documentation directory inside the runtime's
    // package. Declaring it without a `package` names a thing that is never
    // delivered, which would read as a working engine and seed nothing.
    if manifest.package.is_none() {
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
