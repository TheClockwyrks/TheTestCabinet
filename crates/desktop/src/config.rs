//! Host configuration the desktop shell resolves from the environment.
//!
//! The shell is a runner + reporter over [`test_cabinet_core`], so it needs the
//! same handful of locations the CLI does: where to resolve definitions from
//! (the backend, or a local `test-cases/` checkout for offline development),
//! where to write run records, where to stage a run's mountable inputs, and where
//! the model catalog lives. All of it comes from the environment so the shell
//! stays configuration-light, matching the CLI's resolution exactly.

use std::path::PathBuf;

/// The backend base URL the runner resolves definitions from and publishes to,
/// from `TCAB_BACKEND_URL`. `None` (or blank) selects the local `test-cases/`
/// checkout for resolution and disables publishing.
pub fn backend_url() -> Option<String> {
    std::env::var("TCAB_BACKEND_URL")
        .ok()
        .map(|url| url.trim().to_string())
        .filter(|url| !url.is_empty())
}

/// Locate the test case catalog root for local (no-backend) resolution.
///
/// Honors `TCAB_TEST_CASES_DIR`, otherwise defaults to `test-cases` relative to
/// the current working directory.
pub fn catalog_root() -> PathBuf {
    std::env::var_os("TCAB_TEST_CASES_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("test-cases"))
}

/// Locate the model catalog root.
///
/// Honors `TCAB_MODELS_DIR`, otherwise defaults to `models` relative to the
/// current working directory.
pub fn models_root() -> PathBuf {
    std::env::var_os("TCAB_MODELS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("models"))
}

/// The directory run records (and their collected implementations) are written
/// to and read back from, from `TCAB_OUT_DIR`, defaulting to `runs`.
pub fn output_dir() -> PathBuf {
    std::env::var_os("TCAB_OUT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("runs"))
}

/// Resolve the directory a run stages its mountable inputs (seeded repositories,
/// collected artifacts, capture scratch, materialized definitions) under.
///
/// Mirrors the CLI's `work_dir`: a run bind-mounts a seeded repository into the
/// container, so it must live somewhere the runtime can mount. `TCAB_WORK_DIR`
/// overrides; otherwise `~/.tcab`, falling back to a temp directory only when no
/// home is resolvable.
pub fn staging_dir() -> PathBuf {
    const WORK_DIR_ENV: &str = "TCAB_WORK_DIR";
    const DEFAULT_DIR_NAME: &str = ".tcab";

    if let Some(env) = std::env::var_os(WORK_DIR_ENV).filter(|value| !value.is_empty()) {
        return PathBuf::from(env);
    }
    match home_dir() {
        Some(home) => home.join(DEFAULT_DIR_NAME),
        None => std::env::temp_dir().join("tcab"),
    }
}

/// The current user's home directory, read from the platform's conventional
/// variable (`USERPROFILE` on Windows, `HOME` elsewhere).
fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    const HOME_VAR: &str = "USERPROFILE";
    #[cfg(not(windows))]
    const HOME_VAR: &str = "HOME";

    std::env::var_os(HOME_VAR)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}
