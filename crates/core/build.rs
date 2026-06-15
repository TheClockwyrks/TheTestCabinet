//! Build script that stamps the binary with the Test Cabinet commit it was
//! built from.
//!
//! The commit is captured here, at build time, and exposed to the crate as the
//! `TEST_CABINET_COMMIT` compile-time environment variable (read via
//! `option_env!`). Recording it lets every run record attribute its result to
//! the exact build of the orchestrator that produced it, alongside the harness
//! version it drove.
//!
//! Everything here is best-effort: when git is unavailable (for example a build
//! from a source tarball with no repository), no variable is emitted and the
//! crate falls back to `None`, recording a null commit rather than failing the
//! build.

use std::process::Command;

fn main() {
    if let Some(commit) = git_commit() {
        println!("cargo:rustc-env=TEST_CABINET_COMMIT={commit}");
    }

    // Rebuild when the checked-out commit changes so the stamp stays current.
    // These paths are derived from git itself because the crate lives inside a
    // submodule whose `.git` is a file pointing at the real git directory, so
    // the conventional `.git/HEAD` path does not exist relative to the crate.
    for path in rerun_paths() {
        println!("cargo:rerun-if-changed={path}");
    }
}

/// The current commit hash, suffixed with `-dirty` when the working tree has
/// uncommitted changes. `None` when git cannot resolve a commit.
fn git_commit() -> Option<String> {
    let hash = git(&["rev-parse", "HEAD"])?;
    let dirty = git(&["status", "--porcelain"]).is_some_and(|out| !out.is_empty());
    Some(if dirty { format!("{hash}-dirty") } else { hash })
}

/// Files whose change should trigger a rebuild so the commit stamp is refreshed:
/// `HEAD` (captures branch switches) and the ref `HEAD` points at, falling back
/// to `packed-refs` when the ref is packed and has no loose file.
fn rerun_paths() -> Vec<String> {
    let Some(git_dir) = git(&["rev-parse", "--absolute-git-dir"]) else {
        return Vec::new();
    };

    let mut paths = vec![format!("{git_dir}/HEAD")];
    match git(&["symbolic-ref", "--quiet", "HEAD"]) {
        Some(reference) => paths.push(format!("{git_dir}/{reference}")),
        None => paths.push(format!("{git_dir}/packed-refs")),
    }
    paths
}

/// Run a git command, returning its trimmed stdout on success.
fn git(args: &[&str]) -> Option<String> {
    let output = Command::new("git").args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
