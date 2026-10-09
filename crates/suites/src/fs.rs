//! The filesystem helpers the suite runtime and core share: copying a tree the way a
//! run's collected implementation is copied, and listing a catalog directory.

use std::fs;
use std::path::Path;

use crate::error::Result;

/// Directory names that are never part of a run's collected implementation.
///
/// `node_modules` is regenerated from the lockfile by a fresh install, so
/// keeping it only bloats the artifact and risks shipping platform-specific
/// binaries — or the broken tool shims a dereferencing copy would leave behind,
/// since a package manager's `.bin/*` entries are symlinks whose relative
/// imports only resolve from their real location.
///
/// This list is applied twice, for the same reason: `copy_tree` omits these
/// directories when copying the collected tree into the published
/// implementation, and the Kubernetes artifact collector excludes them at
/// `tar` pack time so they never enter the streamed archive in the first place
/// — packing then unpacking a `node_modules` full of native binaries and
/// `.bin/*` symlinks is both wasteful and a source of host-side unpack
/// failures, given the tree is dropped by `copy_tree` immediately afterward.
pub const SKIPPED_DIRS: &[&str] = &["node_modules"];

/// Recursively copy a directory tree from `from` to `to`.
///
/// Symlinks are recreated as symlinks rather than dereferenced, so any links the
/// run produced keep pointing at their original targets instead of being
/// flattened into copies of the target's contents. Dependency directories listed
/// in [`SKIPPED_DIRS`] are omitted entirely.
pub fn copy_tree(from: &Path, to: &Path) -> Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name();
        if SKIPPED_DIRS.contains(&name.to_str().unwrap_or_default()) {
            continue;
        }
        let dest = to.join(&name);
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            copy_symlink(&entry.path(), &dest)?;
        } else if file_type.is_dir() {
            copy_tree(&entry.path(), &dest)?;
        } else {
            std::fs::copy(entry.path(), &dest)?;
        }
    }
    Ok(())
}

/// Recreate the symlink at `from` at the new location `to`, preserving its
/// target verbatim. The target is kept as-is (typically relative to the link's
/// own directory) so the recreated link resolves the same way the original did.
fn copy_symlink(from: &Path, to: &Path) -> Result<()> {
    let target = std::fs::read_link(from)?;
    #[cfg(unix)]
    std::os::unix::fs::symlink(&target, to)?;
    #[cfg(windows)]
    if from.is_dir() {
        std::os::windows::fs::symlink_dir(&target, to)?;
    } else {
        std::os::windows::fs::symlink_file(&target, to)?;
    }
    Ok(())
}

/// Read the immediate subdirectory names of a directory, ignoring files and
/// hidden entries.
pub fn read_dir_names(dir: &Path) -> Result<Vec<String>> {
    let mut names = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        if let Some(name) = entry.file_name().to_str()
            && !name.starts_with('.')
        {
            names.push(name.to_string());
        }
    }
    Ok(names)
}
