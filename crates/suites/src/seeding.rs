//! What seeding and the engine catalog both read out of the host package store.
//!
//! The seeder that vendors a run's packages is core's (`test_cabinet_core::seeding`).
//! The two reads here are shared with the [engine catalog](crate::engine), which
//! answers an engine's version from the same store the seeder vendors it out of, so
//! the version a case's range is checked against is the version the run is seeded
//! with.

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

/// The host package store to vendor runtime packages from: the `TCAB_PACKAGE_STORE`
/// override when set, otherwise the baked-image default
/// ([`TCAB_PACKAGES_DIR`](crate::test_case::TCAB_PACKAGES_DIR)).
///
/// Shared with core's default engine catalog (`test_cabinet_core::engine::EngineCatalogExt::new`,
/// built with [`EngineCatalog::from_manifests`](crate::engine::EngineCatalog::from_manifests)),
/// which reads an engine's version out of the same store, so a default-constructed
/// catalog and a default-constructed seeder can never disagree about which store
/// a run's engine comes from.
pub fn package_store_dir() -> PathBuf {
    std::env::var_os("TCAB_PACKAGE_STORE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(crate::test_case::TCAB_PACKAGES_DIR))
}

/// The `version` a staged package declares, read out of its `package.json`.
///
/// The single source of truth for an engine's version: this is what a run records
/// as the engine version it was built on, and it is the same read
/// [`EngineCatalog`](crate::engine::EngineCatalog) performs to answer
/// [`ResolvedEngine::version`](crate::engine::ResolvedEngine::version) for the
/// case's declared range. The number is therefore never copied into `engine.toml`,
/// where it would be a second place to bump.
///
/// It is
/// held to being a real, non-empty string. A missing, non-string, or blank
/// `version` is a staging fault — a package built from a manifest that never got
/// one, or a store populated by hand — and the honest response is to refuse the
/// run: a recorded version is compared across months of runs, and a placeholder
/// would quietly claim two different engines were the same one.
pub fn staged_package_version(package_dir: &Path, package: &str) -> Result<String> {
    let manifest = package_dir.join("package.json");
    let raw = fs::read_to_string(&manifest).map_err(|err| {
        seed_ctx(
            format!("reading staged package manifest `{}`", manifest.display()),
            err,
        )
    })?;
    let value: serde_json::Value = serde_json::from_str(&raw).map_err(|err| {
        Error::Seeding(format!(
            "staged package manifest `{}` is not valid JSON: {err}",
            manifest.display()
        ))
    })?;
    value
        .get("version")
        .and_then(|version| version.as_str())
        .map(str::trim)
        .filter(|version| !version.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            Error::Seeding(format!(
                "staged package `{package}` declares no `version` string in `{}`; rebuild \
                 and restage it (`npm run build:packages`; \
                 `node scripts/stage-tcab-packages.mjs`)",
                manifest.display(),
            ))
        })
}

/// Wrap an I/O error, with what was being done, as a seeding error.
fn seed_ctx(context: String, err: std::io::Error) -> Error {
    Error::Seeding(format!("{context}: {err}"))
}
