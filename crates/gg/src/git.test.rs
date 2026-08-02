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
#[tokio::test]
async fn git_is_available_in_the_test_environment() {
    assert!(
        git_available().await,
        "git must be installed to run these tests"
    );
}

/// `ensure_baseline` initializes a repo, commits the seeded workspace, and returns a stable sha;
/// a second call (now a repo) returns the same baseline.
#[tokio::test]
async fn ensure_baseline_initializes_a_repo_and_is_idempotent() {
    let dir = TempDir::new().unwrap();
    write(dir.path(), "index.html", "<html></html>");

    let sha = ensure_baseline(&GitCapture::disabled(), dir.path())
        .await
        .unwrap();
    assert!(!sha.is_empty(), "the baseline sha is returned");
    assert!(
        dir.path().join(".git").exists(),
        "the workspace is now a repo"
    );

    // Idempotent: an already-initialized workspace keeps its baseline HEAD.
    let again = ensure_baseline(&GitCapture::disabled(), dir.path())
        .await
        .unwrap();
    assert_eq!(again, sha, "an existing repo's HEAD is the baseline");
}

/// A worktree is an isolated copy: a file written in it is invisible in the main tree until its
/// branch is committed and merged back, at which point it appears.
#[tokio::test]
async fn worktree_isolates_then_merges_back() {
    let main = TempDir::new().unwrap();
    let wt_root = TempDir::new().unwrap();
    write(main.path(), "seed.txt", "seed\n");
    let baseline = ensure_baseline(&GitCapture::disabled(), main.path())
        .await
        .unwrap();

    let wt_path = wt_root.path().join("agent-0");
    let branch = "gg/agent-0";
    add_worktree(
        &GitCapture::disabled(),
        main.path(),
        &wt_path,
        branch,
        &baseline,
    )
    .await
    .unwrap();

    // The subagent does its work inside the isolated worktree.
    write(&wt_path, "greeting.txt", "hello from the worktree\n");

    // Isolation: the main tree does not see the worktree's file yet.
    assert_eq!(
        read(main.path(), "greeting.txt"),
        None,
        "the main tree is unaffected until merge"
    );

    // Commit the worktree's work, then merge it back.
    let committed = commit_worktree(&GitCapture::disabled(), &wt_path, "subagent work")
        .await
        .unwrap();
    assert!(committed, "the worktree had changes to commit");
    assert_eq!(
        merge_branch(
            &GitCapture::disabled(),
            main.path(),
            branch,
            ConflictPolicy::Abort
        )
        .await
        .unwrap(),
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
    remove_worktree(&GitCapture::disabled(), main.path(), &wt_path, branch)
        .await
        .unwrap();
    assert!(!wt_path.exists(), "the worktree checkout is gone");
}

/// A discarded worktree leaves no trace: its work never reaches the main tree and its branch and
/// checkout are removed.
#[tokio::test]
async fn discard_removes_worktree_without_merging() {
    let main = TempDir::new().unwrap();
    let wt_root = TempDir::new().unwrap();
    write(main.path(), "seed.txt", "seed\n");
    let baseline = ensure_baseline(&GitCapture::disabled(), main.path())
        .await
        .unwrap();

    let wt_path = wt_root.path().join("agent-1");
    let branch = "gg/agent-1";
    add_worktree(
        &GitCapture::disabled(),
        main.path(),
        &wt_path,
        branch,
        &baseline,
    )
    .await
    .unwrap();
    write(&wt_path, "scratch.txt", "throwaway\n");

    // Discard: never commit or merge, just remove.
    remove_worktree(&GitCapture::disabled(), main.path(), &wt_path, branch)
        .await
        .unwrap();

    assert_eq!(
        read(main.path(), "scratch.txt"),
        None,
        "discarded work never reaches the main tree"
    );
    assert!(!wt_path.exists(), "the worktree checkout is gone");
    // The branch is gone: adding a worktree on the same branch name succeeds again.
    let reuse = wt_root.path().join("agent-1-again");
    add_worktree(
        &GitCapture::disabled(),
        main.path(),
        &reuse,
        branch,
        &baseline,
    )
    .await
    .unwrap();
    remove_worktree(&GitCapture::disabled(), main.path(), &reuse, branch)
        .await
        .unwrap();
}

/// A merge conflict is surfaced (not silently dropped) and leaves the main tree unchanged.
#[tokio::test]
async fn merge_conflict_is_surfaced_and_leaves_main_unchanged() {
    let main = TempDir::new().unwrap();
    let wt_root = TempDir::new().unwrap();
    write(main.path(), "shared.txt", "base\n");
    let baseline = ensure_baseline(&GitCapture::disabled(), main.path())
        .await
        .unwrap();

    // The worktree branches from the baseline and changes the shared file one way.
    let wt_path = wt_root.path().join("agent-2");
    let branch = "gg/agent-2";
    add_worktree(
        &GitCapture::disabled(),
        main.path(),
        &wt_path,
        branch,
        &baseline,
    )
    .await
    .unwrap();
    write(&wt_path, "shared.txt", "worktree change\n");
    assert!(
        commit_worktree(&GitCapture::disabled(), &wt_path, "worktree edit")
            .await
            .unwrap()
    );

    // The main tree changes the same file a different way and commits — divergent histories.
    write(main.path(), "shared.txt", "main change\n");
    assert!(
        commit_worktree(&GitCapture::disabled(), main.path(), "main edit")
            .await
            .unwrap()
    );

    match merge_branch(
        &GitCapture::disabled(),
        main.path(),
        branch,
        ConflictPolicy::Abort,
    )
    .await
    .unwrap()
    {
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
        !merge_in_progress(&GitCapture::disabled(), main.path()).await,
        "the abort policy leaves no merge in progress"
    );

    remove_worktree(&GitCapture::disabled(), main.path(), &wt_path, branch)
        .await
        .unwrap();
}

/// The [`Keep`](ConflictPolicy::Keep) policy leaves the conflicted merge **in** the tree so a merge
/// agent can resolve it in place — which is only possible if git has not already unwound it — and
/// [`abort_merge`] then restores the tree exactly as it was.
///
/// This is the whole reason the policy exists: an issue's branch that conflicts is not disposable
/// (it holds accepted work), so gg hands the conflicted tree to an agent rather than dropping the
/// work the way a losing speculation attempt is dropped.
#[tokio::test]
async fn a_kept_conflict_stays_in_the_tree_until_it_is_resolved_or_aborted() {
    let main = TempDir::new().unwrap();
    let wt_root = TempDir::new().unwrap();
    write(main.path(), "shared.txt", "base\n");
    let baseline = ensure_baseline(&GitCapture::disabled(), main.path())
        .await
        .unwrap();

    let wt_path = wt_root.path().join("issue-1");
    let branch = "gg/issue-1";
    add_worktree(
        &GitCapture::disabled(),
        main.path(),
        &wt_path,
        branch,
        &baseline,
    )
    .await
    .unwrap();
    write(&wt_path, "shared.txt", "issue change\n");
    assert!(
        commit_worktree(&GitCapture::disabled(), &wt_path, "issue edit")
            .await
            .unwrap()
    );

    write(main.path(), "shared.txt", "main change\n");
    assert!(
        commit_worktree(&GitCapture::disabled(), main.path(), "main edit")
            .await
            .unwrap()
    );

    assert!(
        !merge_in_progress(&GitCapture::disabled(), main.path()).await,
        "nothing is in progress before the merge"
    );
    match merge_branch(
        &GitCapture::disabled(),
        main.path(),
        branch,
        ConflictPolicy::Keep,
    )
    .await
    .unwrap()
    {
        MergeOutcome::Conflict(reason) => {
            assert!(!reason.is_empty(), "the conflict carries git's explanation");
        }
        MergeOutcome::Merged => panic!("divergent edits to the same file must conflict"),
    }
    assert!(
        merge_in_progress(&GitCapture::disabled(), main.path()).await,
        "the kept conflict leaves the merge in progress for an agent to finish"
    );
    // The conflicted file is in the tree with markers, which is what the merge agent edits.
    assert!(
        read(main.path(), "shared.txt")
            .as_deref()
            .is_some_and(|text| text.contains("<<<<<<<")),
        "the conflicted file carries git's markers"
    );

    abort_merge(&GitCapture::disabled(), main.path()).await;
    assert!(
        !merge_in_progress(&GitCapture::disabled(), main.path()).await,
        "aborting clears the in-progress merge"
    );
    assert_eq!(
        read(main.path(), "shared.txt").as_deref(),
        Some("main change\n"),
        "aborting restores the main tree exactly as it was"
    );
}

/// With git unavailable (an empty `PATH`), the helpers degrade to [`GitError::NotFound`] rather
/// than panicking. Each nextest test runs in its own process, so mutating `PATH` here is isolated.
#[tokio::test]
async fn git_absent_is_reported_not_panicked() {
    let dir = TempDir::new().unwrap();
    let saved = std::env::var_os("PATH");
    // SAFETY: nextest isolates each test in its own process.
    unsafe {
        std::env::set_var("PATH", "");
    }

    let available = git_available().await;
    let baseline = ensure_baseline(&GitCapture::disabled(), dir.path()).await;

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

/// **A git call leaves the runtime thread free.** The property the whole module is shaped around:
/// gg's agents all share one runtime thread, so a git command that walks the workspace must run on
/// the blocking pool rather than on that thread — otherwise every other agent stops for as long as
/// git takes, which is seconds on a tree an `npm install` has filled.
///
/// It is asserted the only way the property can be observed: a second task that can only run *if the
/// thread was free*. The counter is zeroed with no await between the reset and the git call, so any
/// tick at all happened while git was running. A blocking implementation cannot tick even once,
/// however long it takes. `#[tokio::test]` gives a **current-thread** runtime, which is exactly the
/// runtime gg runs on, so this measures the real thing rather than a multi-threaded stand-in.
#[tokio::test]
async fn a_git_call_leaves_the_runtime_thread_free_for_other_agents() {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU64, Ordering};

    let dir = TempDir::new().unwrap();
    // Enough files that the `git add -A` inside `ensure_baseline` is real work rather than a
    // no-op — the point is to be busy in git while the other task looks for its turn.
    for i in 0..200 {
        write(dir.path(), &format!("src/file-{i}.txt"), "seeded\n");
    }

    // Another agent's work, in the only shape a test can watch: a task that counts how many times
    // the runtime handed it the thread.
    let ticks = Arc::new(AtomicU64::new(0));
    let counted = Arc::clone(&ticks);
    let other_agent = tokio::spawn(async move {
        loop {
            counted.fetch_add(1, Ordering::Relaxed);
            tokio::task::yield_now().await;
        }
    });

    ticks.store(0, Ordering::Relaxed);
    let baseline = ensure_baseline(&GitCapture::disabled(), dir.path())
        .await
        .unwrap();
    let during = ticks.load(Ordering::Relaxed);
    other_agent.abort();

    assert!(!baseline.is_empty(), "the baseline was committed");
    assert!(
        during > 0,
        "the runtime thread must stay free while git runs: the other task never got a turn"
    );
}

/// gg's own `git` is a **recorded input**. In format v1 it bypassed tool dispatch entirely and was
/// captured nowhere, so a run that ended in a merge conflict left no trace of the conflict — and a
/// speculation judge's verdict could not be understood without the patch it scored.
///
/// Recorded at [`git_output`], the single seam every invocation reaches, so *every* command is
/// pinned rather than the handful a caller thought to name. The two things a reconstruction needs
/// beyond the command line are asserted here: the exit code, and both streams interned separately
/// into the text pool.
#[tokio::test]
async fn a_captured_run_records_every_git_invocation_it_makes() {
    let dir = TempDir::new().unwrap();
    write(dir.path(), "index.html", "<html></html>");
    let journal = TempDir::new().unwrap();
    let recorder = Arc::new(
        crate::replay::GgRecorder::start(
            &journal.path().join("replay.ndjson"),
            "run_1",
            &serde_json::from_value(serde_json::json!({})).unwrap(),
            test_cabinet_core::gg_replay::GgReplayFidelity::Standard,
            None,
        )
        .expect("the journal opens"),
    );
    let capture = GitCapture::new(Arc::clone(&recorder), "root", dir.path());

    ensure_baseline(&capture, dir.path()).await.unwrap();
    write(dir.path(), "index.html", "<html>changed</html>");
    let patch = diff_since(&capture, dir.path(), "HEAD").await.unwrap();
    assert!(patch.contains("changed"), "the diff is non-empty: {patch}");
    recorder.finish();

    let text = std::fs::read_to_string(journal.path().join("replay.ndjson")).unwrap();
    let lines: Vec<serde_json::Value> = text
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    let texts: Vec<&str> = lines
        .iter()
        .filter(|line| line["type"] == "text")
        .map(|line| line["text"].as_str().unwrap())
        .collect();
    let gits: Vec<&serde_json::Value> = lines
        .iter()
        .filter(|line| line["type"] == "entry" && line["entry"]["type"] == "git")
        .map(|line| &line["entry"])
        .collect();

    let commands: Vec<&str> = gits
        .iter()
        .map(|entry| entry["command"]["command"].as_str().unwrap())
        .collect();
    assert!(
        commands
            .iter()
            .any(|command| command.starts_with("git init")),
        "the baseline's own plumbing is recorded too: {commands:?}"
    );
    let diff = gits
        .iter()
        .find(|entry| {
            entry["command"]["command"]
                .as_str()
                .unwrap()
                .starts_with("git diff --cached")
        })
        .expect("the diff invocation is recorded");
    assert_eq!(diff["agentId"], "root");
    assert_eq!(diff["command"]["exitCode"], 0);
    assert_eq!(
        diff["command"]["cwd"]["type"], "workspace",
        "the working directory is expressed relative to the workspace, not as an absolute path a \
         reconstruction could never match"
    );
    let stdout = texts[diff["command"]["stdout"].as_u64().unwrap() as usize];
    assert!(
        stdout.contains("changed"),
        "the patch itself is what a judge scored, so it is what the record pins: {stdout}"
    );
    assert_eq!(
        texts[diff["command"]["stderr"].as_u64().unwrap() as usize],
        "",
        "and the two streams are interned separately"
    );
}

/// gg's own commits are a **pure function of their content**: two separate workspaces seeded with
/// the same bytes produce the same baseline commit sha, however far apart in time they are made.
///
/// This is not a tidiness property, it is what makes an issue-worktree run reconstructable. A commit
/// id hashes the timestamps as well as the tree, and gg puts a commit sha into a *prompt* — an
/// issue review brief names the commit the work is measured against — so a clock-derived date makes
/// the reviewer's very first request differ between a run and its
/// [playback](crate::playback) for a reason that has nothing to do with the run. It showed up
/// exactly as one would expect if nobody had thought about it: the multi-agent round trip passed
/// whenever the two baselines happened to land in the same second.
#[tokio::test]
async fn gg_commits_are_a_function_of_their_content_and_not_of_the_clock() {
    let first = TempDir::new().unwrap();
    write(first.path(), "index.html", "<!doctype html>\n");
    let one = ensure_baseline(&GitCapture::disabled(), first.path())
        .await
        .expect("a baseline");

    // Far enough apart that a clock-derived commit date could not coincide.
    tokio::time::sleep(std::time::Duration::from_millis(1_100)).await;

    let second = TempDir::new().unwrap();
    write(second.path(), "index.html", "<!doctype html>\n");
    let two = ensure_baseline(&GitCapture::disabled(), second.path())
        .await
        .expect("a baseline");

    assert_eq!(
        one, two,
        "the same seeded content commits to the same sha, whenever it is committed",
    );

    // And it really is the content that decides: a different tree is a different commit.
    let third = TempDir::new().unwrap();
    write(
        third.path(),
        "index.html",
        "<!doctype html><title>x</title>\n",
    );
    let other = ensure_baseline(&GitCapture::disabled(), third.path())
        .await
        .expect("a baseline");
    assert_ne!(one, other, "different content, different commit");
}
