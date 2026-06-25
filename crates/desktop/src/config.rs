//! Host configuration the desktop shell resolves from the environment.
//!
//! Runs no longer execute in this shell (the webview enqueues and watches them on
//! the backend over HTTP, like the web console), so most of these locations exist
//! only for the **local arena**: where to resolve a match/tournament's definition
//! from (the backend, or a local `test-cases/` checkout for offline development),
//! where to write and read its records and replays, and where to stage a
//! backend-materialized definition. The `backend_url`/`auth_url` pair is the one
//! piece the webview consumes directly, to build its HTTP transports. All of it
//! comes from the environment so the shell stays configuration-light, matching the
//! CLI's resolution exactly.

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

/// The auth service base URL (`TCAB_AUTH_URL`), where the desktop registers and
/// logs in. Falls back to the auth service's loopback default for local dev.
pub fn auth_url() -> String {
    std::env::var("TCAB_AUTH_URL")
        .ok()
        .map(|url| url.trim().to_string())
        .filter(|url| !url.is_empty())
        .unwrap_or_else(|| "http://127.0.0.1:8789".to_string())
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

/// The directory the local arena writes its records and replays to and reads
/// them back from, from `TCAB_OUT_DIR`, defaulting to `runs`. Also where a
/// previously-produced run's adversarial controller module is read from when the
/// arena pits it.
pub fn output_dir() -> PathBuf {
    std::env::var_os("TCAB_OUT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("runs"))
}

/// Resolve the directory the local arena materializes a backend-served
/// definition under (so a match/tournament can read the case's `build`/module and
/// reference modules from disk).
///
/// Mirrors the CLI's `work_dir`. `TCAB_WORK_DIR` overrides; otherwise `~/.tcab`,
/// falling back to a temp directory only when no home is resolvable.
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
