//! The authored set: which files the **model** wrote, as opposed to which were seeded into
//! the workspace before it started.
//!
//! This is the most important correctness question on the page, and getting it wrong
//! pollutes every figure **differently per test case** — silently breaking exactly the
//! cross-case comparison the analysis exists for.
//!
//! # Why not just take the root commit
//!
//! Measuring the seeded scaffolding is the obvious hazard, and the tempting fix — treat
//! the tree's root commit as the seed — fails in the worst possible direction. If the
//! model amends, squashes, rebases, or runs a fresh `git init`, the root commit's tree
//! **contains the model's own work**. The seeded set swallows the authored files, the
//! modified set comes back empty, and the run reports near-zero authored code *stamped as
//! an exact measurement*. A confidently wrong number is worse than a missing one.
//!
//! Meanwhile the exact seed commit is already computed when the workspace is seeded, and
//! was thrown away until it was put on the run record. So the set resolves by a ladder
//! whose rung is itself recorded:
//!
//! | Basis | Condition | Claim |
//! | --- | --- | --- |
//! | [`SeedCommit`](CodeAuthoredBasis::SeedCommit) | The record carries a seed commit and it is present in the tree | **Exact** |
//! | [`RootCommit`](CodeAuthoredBasis::RootCommit) | Exactly one root commit, and its message is the seeding message | **Inferred** — for trees that predate the recorded field |
//! | [`AllFiles`](CodeAuthoredBasis::AllFiles) | Neither check passed | **Degraded** — seeded scaffolding is included |
//!
//! The message check on the middle rung is not cosmetic: it is the only thing
//! distinguishing a seed root from a model-created one, and it reads
//! [`SEED_COMMIT_MESSAGE`] from the seeder itself rather than a copy. A tree failing both
//! checks degrades **loudly** rather than reporting a confidently-wrong empty authored set.
//!
//! # Nothing is mutated
//!
//! Three git invocations, all read-only: list the seed tree, diff the seed against the
//! **working tree** (so uncommitted edits count), and list untracked files as a
//! cross-check. Nothing is staged, nothing is committed, and `--no-optional-locks` keeps
//! git from so much as refreshing the index. Reading repository metadata is not "executing
//! the produced code".

use std::collections::BTreeSet;
use std::path::Path;
use std::process::Command;

use test_cabinet_core::CodeAuthoredBasis;
use test_cabinet_core::seeding::SEED_COMMIT_MESSAGE;

/// Which files the model wrote, and how confidently that was decided.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthoredSet {
    /// Which rung of the ladder answered. Recorded on the summary so a consumer can tell a
    /// measured figure from a degraded one instead of comparing them as equals.
    pub basis: CodeAuthoredBasis,
    /// The authored paths, or `None` when the basis is
    /// [`AllFiles`](CodeAuthoredBasis::AllFiles) and every walked file counts.
    ///
    /// `None` rather than "every path", so a caller cannot accidentally treat a degraded
    /// answer as an exact one that happens to name everything.
    pub paths: Option<BTreeSet<String>>,
}

impl AuthoredSet {
    /// Whether `path` was written by the model.
    pub fn contains(&self, path: &str) -> bool {
        match &self.paths {
            Some(paths) => paths.contains(path),
            None => true,
        }
    }
}

/// Resolve the authored set for the tree at `root`, given the run record's `seed_commit`.
///
/// Never fails: a tree that is not a repository, or a `git` that is not installed, lands on
/// the degraded rung, which is the honest answer rather than an error that would cost the
/// run its whole analysis.
pub fn resolve(root: &Path, seed_commit: Option<&str>) -> AuthoredSet {
    if let Some(commit) = seed_commit.filter(|commit| commit_exists(root, commit))
        && let Some(paths) = changed_since(root, commit)
    {
        return AuthoredSet {
            basis: CodeAuthoredBasis::SeedCommit,
            paths: Some(paths),
        };
    }
    if let Some(root_commit) = lone_seed_root(root)
        && let Some(paths) = changed_since(root, &root_commit)
    {
        return AuthoredSet {
            basis: CodeAuthoredBasis::RootCommit,
            paths: Some(paths),
        };
    }
    AuthoredSet {
        basis: CodeAuthoredBasis::AllFiles,
        paths: None,
    }
}

/// Whether `commit` names a commit object that is present in the tree.
///
/// `^{commit}` rather than a bare sha so a tag or a tree with the same name cannot pass:
/// the ladder's top rung claims to be exact, and "an object with this id exists" is a
/// weaker statement than "this commit exists".
fn commit_exists(root: &Path, commit: &str) -> bool {
    git(root, &["cat-file", "-e", &format!("{commit}^{{commit}}")]).is_some()
}

/// The tree's single root commit, when there is exactly one and it carries the seeding
/// message.
///
/// Both halves are required. More than one root means a history that was rewritten or
/// grafted, and picking one of them would be a guess; a different message means the root is
/// the model's own `git init`, whose tree contains the model's work.
fn lone_seed_root(root: &Path) -> Option<String> {
    let listed = git(root, &["rev-list", "--max-parents=0", "HEAD"])?;
    let mut roots = listed.split_whitespace();
    let candidate = roots.next()?.to_string();
    if roots.next().is_some() {
        return None;
    }
    let subject = git(root, &["log", "-1", "--format=%s", &candidate])?;
    (subject.trim() == SEED_COMMIT_MESSAGE).then_some(candidate)
}

/// Every path that differs from `commit` in the working tree, plus every untracked path.
///
/// The diff is against the **working tree** rather than `HEAD` so a file the model edited
/// and never committed still counts; the untracked listing is what catches a file it never
/// added at all. Returns `None` only when git itself failed, which drops the caller to the
/// next rung.
fn changed_since(root: &Path, commit: &str) -> Option<BTreeSet<String>> {
    let modified = git(root, &["diff", "--name-only", commit, "--"])?;
    let untracked = git(root, &["ls-files", "--others", "--exclude-standard"])?;
    Some(
        modified
            .lines()
            .chain(untracked.lines())
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_string)
            .collect(),
    )
}

/// Run a read-only `git` command in `root`, returning its stdout, or `None` if it failed.
///
/// Three flags carry weight. `--no-optional-locks` keeps git from refreshing the index as a
/// side effect of a diff, so the claim that nothing is mutated holds literally.
/// `core.quotepath=false` stops a non-ASCII path being returned as escaped octal, which
/// would never match the walk's UTF-8 path. And `GIT_CONFIG_NOSYSTEM` plus an empty
/// `HOME`-scoped config keeps a developer's global git configuration — aliases, an
/// `excludesFile`, a `diff.external` — from changing what the analysis measures.
fn git(root: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .arg("--no-optional-locks")
        .args(["-c", "core.quotepath=false"])
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(test)]
#[path = "authored.test.rs"]
mod tests;
