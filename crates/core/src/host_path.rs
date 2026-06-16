//! Host-path translation for container bind mounts.
//!
//! A run's seeded repository lives on the host and is bind-mounted into the run
//! container as its working tree. The host path is usable verbatim as a mount
//! source on Linux and macOS, but not on Windows: there the runtime is Podman
//! (or Docker) backed by a WSL2 VM that exposes the Windows filesystem under
//! `/mnt/<drive>/...`, and a native path such as `C:\Users\me\run` cannot be a
//! `--volume` source — its drive-letter colon would collide with the
//! `source:destination` separator, and the runtime mounts the WSL view of the
//! path regardless. This module rewrites such a path into its WSL form so the
//! same `start`/`collect` code drives every platform.

use std::path::Path;

use crate::error::{Error, Result};

/// Translate a host path into the source string a container runtime expects for
/// a bind mount.
///
/// A drive-absolute Windows path (`C:\a\b` or `C:/a/b`) becomes its WSL mount
/// form (`/mnt/c/a/b`); every other path — Linux and macOS absolute paths, and
/// Windows paths that are not drive-absolute, such as UNC paths — is returned
/// unchanged. The check keys off the path's shape rather than the compile
/// target, so a genuine POSIX path (which never begins with a `<letter>:`
/// drive) always passes through and the translation stays unit-testable on any
/// host.
pub(crate) fn mount_source(path: &Path) -> Result<String> {
    let raw = path.to_str().ok_or_else(|| {
        Error::ContainerRuntime(format!(
            "mount source path is not valid UTF-8: {}",
            path.display()
        ))
    })?;
    Ok(windows_drive_to_wsl(raw).unwrap_or_else(|| raw.to_string()))
}

/// Rewrite a drive-absolute Windows path into the WSL `/mnt/<drive>/...` form,
/// lowercasing the drive letter and normalizing backslashes to forward slashes.
///
/// Returns `None` when `path` is not drive-absolute (a leading `<letter>:`
/// followed by a `\` or `/`), which is the case for every POSIX path and for
/// Windows UNC paths, so the caller passes those through untouched.
fn windows_drive_to_wsl(path: &str) -> Option<String> {
    let bytes = path.as_bytes();
    let drive = *bytes.first()?;
    if !drive.is_ascii_alphabetic() || bytes.get(1) != Some(&b':') {
        return None;
    }
    // A drive-relative path like `C:work` (no separator after the colon) has no
    // single WSL equivalent, so it is left for the caller to pass through.
    match bytes.get(2) {
        Some(b'\\' | b'/') => {}
        _ => return None,
    }
    let rest = path[3..].replace('\\', "/");
    Some(format!(
        "/mnt/{}/{}",
        drive.to_ascii_lowercase() as char,
        rest
    ))
}

#[cfg(test)]
#[path = "host_path.test.rs"]
mod tests;
