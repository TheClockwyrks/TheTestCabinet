//! Tests for the authored-set ladder.
//!
//! **The four cases below are the ladder.** Each rung has a different failure mode, and the
//! bottom one exists precisely so a tree that cannot be resolved degrades loudly instead of
//! reporting a confidently-wrong empty authored set.

use std::path::Path;
use std::process::Command;

use super::*;

/// Run a git command in `root`, asserting it succeeded — test scaffolding, not the
/// read-only helper the ladder itself uses.
fn git(root: &Path, args: &[&str]) {
    let status = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_AUTHOR_NAME", "Test")
        .env("GIT_AUTHOR_EMAIL", "test@example.com")
        .env("GIT_COMMITTER_NAME", "Test")
        .env("GIT_COMMITTER_EMAIL", "test@example.com")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .expect("git runs");
    assert!(
        status.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&status.stderr)
    );
}

fn write(root: &Path, path: &str, contents: &str) {
    let full = root.join(path);
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).expect("a parent directory");
    }
    std::fs::write(full, contents).expect("a written file");
}

/// A seeded workspace: two scaffolding files committed with the seeder's own message, then
/// the model's work on top — one new file, one edited, one untouched.
fn seeded_workspace(message: &str) -> (tempfile::TempDir, String) {
    let root = tempfile::tempdir().expect("a temp dir");
    write(root.path(), "package.json", "{}\n");
    write(root.path(), "src/scaffold.ts", "export const seeded = 1;\n");
    git(root.path(), &["init", "--quiet", "--initial-branch=main"]);
    git(root.path(), &["add", "--all"]);
    git(root.path(), &["commit", "--quiet", "--message", message]);
    let seed = String::from_utf8(
        Command::new("git")
            .arg("-C")
            .arg(root.path())
            .args(["rev-parse", "HEAD"])
            .output()
            .expect("git runs")
            .stdout,
    )
    .expect("utf8")
    .trim()
    .to_string();

    write(root.path(), "src/game.ts", "export const game = 2;\n");
    write(
        root.path(),
        "src/scaffold.ts",
        "export const seeded = 1;\nexport const added = 3;\n",
    );
    (root, seed)
}

/// **Rung one.** A recorded seed commit that is present in the tree is exact: the authored
/// set is what changed since it, and the untouched scaffolding is excluded.
#[test]
fn a_recorded_seed_commit_is_the_exact_basis() {
    let (root, seed) = seeded_workspace(SEED_COMMIT_MESSAGE);
    let authored = resolve(root.path(), Some(&seed));

    assert_eq!(authored.basis, CodeAuthoredBasis::SeedCommit);
    assert!(authored.contains("src/game.ts"), "a new file is authored");
    assert!(
        authored.contains("src/scaffold.ts"),
        "an edited seeded file is authored"
    );
    assert!(
        !authored.contains("package.json"),
        "untouched scaffolding is not authored"
    );
}

/// **Rung two.** With no recorded seed commit, a tree whose single root commit carries the
/// seeder's message resolves to the same set — this is the rung that exists for trees
/// predating the recorded field.
#[test]
fn a_lone_seeding_root_commit_infers_the_same_set() {
    let (root, seed) = seeded_workspace(SEED_COMMIT_MESSAGE);
    let inferred = resolve(root.path(), None);
    let exact = resolve(root.path(), Some(&seed));

    assert_eq!(inferred.basis, CodeAuthoredBasis::RootCommit);
    assert_eq!(
        inferred.paths, exact.paths,
        "the inferred rung must find the same files the exact one does"
    );
}

/// **Rung three, and the reason the ladder exists.** A root commit the *model* made — a
/// fresh `git init`, an amend, a squash — carries a different message, so the middle rung
/// refuses it and the result degrades loudly.
///
/// Taking the root commit unconditionally is what this prevents: that root's tree contains
/// the model's own work, so the seeded set would swallow the authored files and the run
/// would report near-zero authored code *stamped as an exact measurement*.
#[test]
fn a_model_created_root_commit_degrades_loudly_rather_than_lying() {
    let (root, _) = seeded_workspace("Initial commit");
    let authored = resolve(root.path(), None);

    assert_eq!(authored.basis, CodeAuthoredBasis::AllFiles);
    assert_eq!(
        authored.paths, None,
        "a degraded basis must not present itself as a resolved set that happens to be complete"
    );
    assert!(
        authored.contains("package.json"),
        "the degraded basis includes the seeded scaffolding, and says so through its basis"
    );
}

/// A tree that is not a repository at all — a collected tree whose `.git` did not survive,
/// or an ad-hoc directory — lands on the same degraded rung rather than failing.
#[test]
fn a_tree_that_is_not_a_repository_degrades_rather_than_failing() {
    let root = tempfile::tempdir().expect("a temp dir");
    write(root.path(), "src/game.ts", "export const game = 1;\n");
    let authored = resolve(
        root.path(),
        Some("0000000000000000000000000000000000000000"),
    );

    assert_eq!(authored.basis, CodeAuthoredBasis::AllFiles);
    assert!(authored.contains("src/game.ts"));
}

/// A seed commit the record names but the tree does not hold falls through to the next
/// rung rather than resolving against nothing.
#[test]
fn a_seed_commit_absent_from_the_tree_falls_through() {
    let (root, _) = seeded_workspace(SEED_COMMIT_MESSAGE);
    let authored = resolve(
        root.path(),
        Some("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"),
    );
    assert_eq!(authored.basis, CodeAuthoredBasis::RootCommit);
}

/// The ladder never mutates the repository it reads: nothing is staged, nothing is
/// committed, and the working tree is untouched.
#[test]
fn resolving_the_authored_set_mutates_nothing() {
    let (root, seed) = seeded_workspace(SEED_COMMIT_MESSAGE);
    let before = Command::new("git")
        .arg("-C")
        .arg(root.path())
        .args(["status", "--porcelain"])
        .output()
        .expect("git runs");
    resolve(root.path(), Some(&seed));
    let after = Command::new("git")
        .arg("-C")
        .arg(root.path())
        .args(["status", "--porcelain"])
        .output()
        .expect("git runs");
    assert_eq!(before.stdout, after.stdout);
}
