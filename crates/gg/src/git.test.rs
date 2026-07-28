use std::path::Path;

use tempfile::TempDir;

use super::*;

/// Write `contents` to `dir/rel`, creating parents.
fn write(dir: &Path, rel: &str, contents: &str) {
    let path = dir.join(rel);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, contents).unwrap();
}

/// Read `dir/rel`, or `None` when it does not exist.
fn read(dir: &Path, rel: &str) -> Option<String> {
    std::fs::read_to_string(dir.join(rel)).ok()
}

/// git is present in the dev/test environment.
#[test]
fn git_is_available_in_the_test_environment() {
    assert!(git_available(), "git must be installed to run these tests");
}

/// `ensure_baseline` initializes a repo, commits the seeded workspace, and returns a stable sha;
/// a second call (now a repo) returns the same baseline.
#[test]
fn ensure_baseline_initializes_a_repo_and_is_idempotent() {
    let dir = TempDir::new().unwrap();
    write(dir.path(), "index.html", "<html></html>");

    let sha = ensure_baseline(dir.path()).unwrap();
    assert!(!sha.is_empty(), "the baseline sha is returned");
    assert!(
        dir.path().join(".git").exists(),
        "the workspace is now a repo"
    );

    // Idempotent: an already-initialized workspace keeps its baseline HEAD.
    let again = ensure_baseline(dir.path()).unwrap();
    assert_eq!(again, sha, "an existing repo's HEAD is the baseline");
}

/// A worktree is an isolated copy: a file written in it is invisible in the main tree until its
/// branch is committed and merged back, at which point it appears.
#[test]
fn worktree_isolates_then_merges_back() {
    let main = TempDir::new().unwrap();
    let wt_root = TempDir::new().unwrap();
    write(main.path(), "seed.txt", "seed\n");
    let baseline = ensure_baseline(main.path()).unwrap();

    let wt_path = wt_root.path().join("agent-0");
    let branch = "gg/agent-0";
    add_worktree(main.path(), &wt_path, branch, &baseline).unwrap();

    // The subagent does its work inside the isolated worktree.
    write(&wt_path, "greeting.txt", "hello from the worktree\n");

    // Isolation: the main tree does not see the worktree's file yet.
    assert_eq!(
        read(main.path(), "greeting.txt"),
        None,
        "the main tree is unaffected until merge"
    );

    // Commit the worktree's work, then merge it back.
    let committed = commit_worktree(&wt_path, "subagent work").unwrap();
    assert!(committed, "the worktree had changes to commit");
    assert_eq!(
        merge_branch(main.path(), branch, ConflictPolicy::Abort).unwrap(),
        MergeOutcome::Merged,
        "the branch merges cleanly"
    );

    // Merge-back: the file now appears in the main tree.
    assert_eq!(
        read(main.path(), "greeting.txt").as_deref(),
        Some("hello from the worktree\n"),
        "the merged work appears in the main tree"
    );

    // Cleanup removes the worktree entirely.
    remove_worktree(main.path(), &wt_path, branch).unwrap();
    assert!(!wt_path.exists(), "the worktree checkout is gone");
}

/// A discarded worktree leaves no trace: its work never reaches the main tree and its branch and
/// checkout are removed.
#[test]
fn discard_removes_worktree_without_merging() {
    let main = TempDir::new().unwrap();
    let wt_root = TempDir::new().unwrap();
    write(main.path(), "seed.txt", "seed\n");
    let baseline = ensure_baseline(main.path()).unwrap();

    let wt_path = wt_root.path().join("agent-1");
    let branch = "gg/agent-1";
    add_worktree(main.path(), &wt_path, branch, &baseline).unwrap();
    write(&wt_path, "scratch.txt", "throwaway\n");

    // Discard: never commit or merge, just remove.
    remove_worktree(main.path(), &wt_path, branch).unwrap();

    assert_eq!(
        read(main.path(), "scratch.txt"),
        None,
        "discarded work never reaches the main tree"
    );
    assert!(!wt_path.exists(), "the worktree checkout is gone");
    // The branch is gone: adding a worktree on the same branch name succeeds again.
    let reuse = wt_root.path().join("agent-1-again");
    add_worktree(main.path(), &reuse, branch, &baseline).unwrap();
    remove_worktree(main.path(), &reuse, branch).unwrap();
}

/// A merge conflict is surfaced (not silently dropped) and leaves the main tree unchanged.
#[test]
fn merge_conflict_is_surfaced_and_leaves_main_unchanged() {
    let main = TempDir::new().unwrap();
    let wt_root = TempDir::new().unwrap();
    write(main.path(), "shared.txt", "base\n");
    let baseline = ensure_baseline(main.path()).unwrap();

    // The worktree branches from the baseline and changes the shared file one way.
    let wt_path = wt_root.path().join("agent-2");
    let branch = "gg/agent-2";
    add_worktree(main.path(), &wt_path, branch, &baseline).unwrap();
    write(&wt_path, "shared.txt", "worktree change\n");
    assert!(commit_worktree(&wt_path, "worktree edit").unwrap());

    // The main tree changes the same file a different way and commits — divergent histories.
    write(main.path(), "shared.txt", "main change\n");
    assert!(commit_worktree(main.path(), "main edit").unwrap());

    match merge_branch(main.path(), branch, ConflictPolicy::Abort).unwrap() {
        MergeOutcome::Conflict(reason) => {
            assert!(!reason.is_empty(), "the conflict carries git's explanation");
        }
        MergeOutcome::Merged => panic!("divergent edits to the same file must conflict"),
    }

    // The main tree is left exactly as it was (the aborted merge did not clobber it).
    assert_eq!(
        read(main.path(), "shared.txt").as_deref(),
        Some("main change\n"),
        "an aborted conflict leaves the main tree unchanged"
    );
    assert!(
        !merge_in_progress(main.path()),
        "the abort policy leaves no merge in progress"
    );

    remove_worktree(main.path(), &wt_path, branch).unwrap();
}

/// With git unavailable (an empty `PATH`), the helpers degrade to [`GitError::NotFound`] rather
/// The [`Keep`](ConflictPolicy::Keep) policy leaves the conflicted merge **in** the tree so a merge
/// agent can resolve it in place — which is only possible if git has not already unwound it — and
/// [`abort_merge`] then restores the tree exactly as it was.
///
/// This is the whole reason the policy exists: an issue's branch that conflicts is not disposable
/// (it holds accepted work), so gg hands the conflicted tree to an agent rather than dropping the
/// work the way a losing speculation attempt is dropped.
#[test]
fn a_kept_conflict_stays_in_the_tree_until_it_is_resolved_or_aborted() {
    let main = TempDir::new().unwrap();
    let wt_root = TempDir::new().unwrap();
    write(main.path(), "shared.txt", "base\n");
    let baseline = ensure_baseline(main.path()).unwrap();

    let wt_path = wt_root.path().join("issue-1");
    let branch = "gg/issue-1";
    add_worktree(main.path(), &wt_path, branch, &baseline).unwrap();
    write(&wt_path, "shared.txt", "issue change\n");
    assert!(commit_worktree(&wt_path, "issue edit").unwrap());

    write(main.path(), "shared.txt", "main change\n");
    assert!(commit_worktree(main.path(), "main edit").unwrap());

    assert!(
        !merge_in_progress(main.path()),
        "nothing is in progress before the merge"
    );
    match merge_branch(main.path(), branch, ConflictPolicy::Keep).unwrap() {
        MergeOutcome::Conflict(reason) => {
            assert!(!reason.is_empty(), "the conflict carries git's explanation");
        }
        MergeOutcome::Merged => panic!("divergent edits to the same file must conflict"),
    }
    assert!(
        merge_in_progress(main.path()),
        "the kept conflict leaves the merge in progress for an agent to finish"
    );
    // The conflicted file is in the tree with markers, which is what the merge agent edits.
    assert!(
        read(main.path(), "shared.txt")
            .as_deref()
            .is_some_and(|text| text.contains("<<<<<<<")),
        "the conflicted file carries git's markers"
    );

    abort_merge(main.path());
    assert!(
        !merge_in_progress(main.path()),
        "aborting clears the in-progress merge"
    );
    assert_eq!(
        read(main.path(), "shared.txt").as_deref(),
        Some("main change\n"),
        "aborting restores the main tree exactly as it was"
    );
}

/// than panicking. Each nextest test runs in its own process, so mutating `PATH` here is isolated.
#[test]
fn git_absent_is_reported_not_panicked() {
    let dir = TempDir::new().unwrap();
    let saved = std::env::var_os("PATH");
    // SAFETY: nextest isolates each test in its own process.
    unsafe {
        std::env::set_var("PATH", "");
    }

    let available = git_available();
    let baseline = ensure_baseline(dir.path());

    // Restore before asserting so a failure does not leave the process without git.
    unsafe {
        match saved {
            Some(path) => std::env::set_var("PATH", path),
            None => std::env::remove_var("PATH"),
        }
    }

    assert!(
        !available,
        "git must read as unavailable with an empty PATH"
    );
    assert!(
        matches!(baseline, Err(GitError::NotFound)),
        "a missing git binary is a clear NotFound, not a panic"
    );
}
