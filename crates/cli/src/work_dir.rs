//! Resolves the host directory `tcab` stages a run's mountable inputs under.
//!
//! A run seeds a fresh repository on the host and bind-mounts it into the run
//! container, so that repository must live somewhere the container runtime can
//! mount. On macOS and Windows the runtime is Podman (or Docker) backed by a VM
//! that shares only part of the host filesystem: the per-user temp directory
//! `std::env::temp_dir()` resolves to — `/var/folders/...` on macOS, a
//! `C:\...\Temp` path outside the WSL mount on Windows — is not reliably shared
//! with that VM, so staging a run there fails the mount. The user's home
//! directory is shared by default on both, so runs stage under `~/.tcab`.

use std::ffi::OsString;
use std::path::PathBuf;

/// Environment override for the staging directory.
const WORK_DIR_ENV: &str = "TCAB_WORK_DIR";

/// Staging directory name under the user's home directory.
const DEFAULT_DIR_NAME: &str = ".tcab";

/// Resolve the directory `tcab` stages a run's mountable inputs (seeded
/// repositories, collected artifacts, capture scratch) under.
///
/// Resolution order:
/// 1. An explicit `override_dir` (a `--work-dir` flag).
/// 2. The `TCAB_WORK_DIR` environment variable.
/// 3. `~/.tcab`.
/// 4. `std::env::temp_dir()/tcab`, only as a last resort when no home directory
///    can be resolved.
pub fn staging_dir(override_dir: Option<PathBuf>) -> PathBuf {
    resolve(
        override_dir,
        std::env::var_os(WORK_DIR_ENV),
        home_dir(),
        std::env::temp_dir(),
    )
}

/// The pure resolution rule behind [`staging_dir`], taking its environment
/// inputs as arguments so the precedence can be tested without mutating
/// process-global state.
fn resolve(
    override_dir: Option<PathBuf>,
    env: Option<OsString>,
    home: Option<PathBuf>,
    temp: PathBuf,
) -> PathBuf {
    if let Some(dir) = override_dir {
        return dir;
    }
    if let Some(env) = env.filter(|value| !value.is_empty()) {
        return PathBuf::from(env);
    }
    match home {
        Some(home) => home.join(DEFAULT_DIR_NAME),
        None => temp.join("tcab"),
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

#[cfg(test)]
#[path = "work_dir.test.rs"]
mod tests;
