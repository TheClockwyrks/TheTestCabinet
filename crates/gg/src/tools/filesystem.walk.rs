//! The **one** workspace walk the tools that answer questions about the project run under.
//!
//! [`search`](super::search) and [`tree`](super::tree) both answer a question about the *project*
//! rather than about the disk, and both would answer it wrongly if they returned `node_modules`,
//! build output and the run's own bookkeeping. So both walk under the ignore files, and they do it
//! through this one builder: two walkers configured separately would be two answers to *what is in
//! this workspace*, and a tree that showed a directory a search had never scanned would be a
//! difference nobody chose.
//!
//! What that means, exactly: what `.gitignore`, `.ignore` and their kin exclude is never walked,
//! with the nested and negated semantics the [`ignore`] crate gives them, plus the repository's
//! `.git/info/exclude` and the user's global ignore file. `.git` is skipped by name, because the
//! ignore crate reads a repository's ignore files but does not exclude its object store. Hidden
//! files are otherwise walked — a `.github/workflows` definition is a source file like any other.
//! `require_git(false)` honours a `.gitignore` in a workspace that is not (yet) a repository, which
//! is what an ignore file means to the person who wrote it. Symbolic links are not followed, so a
//! link into a directory is an entry rather than a second copy of a subtree and no cycle exists.
//!
//! Ordering is by path, so two walks of one unchanged tree render identically.

use std::path::{Path, PathBuf};

/// The walk builder both callers start from, rooted at `root`.
///
/// A builder rather than a finished [`ignore::Walk`] because the callers differ in exactly one
/// setting — a tree bounds its depth, a search does not — and a second parameter that only one
/// caller ever passes would make the shared rule read as a per-caller choice.
pub(crate) fn workspace_walk(root: &Path) -> ignore::WalkBuilder {
    let mut builder = ignore::WalkBuilder::new(root);
    builder
        .hidden(false)
        .require_git(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .parents(true)
        .sort_by_file_path(Path::cmp)
        .filter_entry(|entry| entry.file_name() != ".git");
    builder
}

/// `path` as these tools report it: relative to the workspace with `/` separators, or as given when
/// it lies outside it.
pub(crate) fn display_path(workspace: &Path, path: &Path) -> String {
    let shown: PathBuf = path.strip_prefix(workspace).unwrap_or(path).to_path_buf();
    shown
        .components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}
