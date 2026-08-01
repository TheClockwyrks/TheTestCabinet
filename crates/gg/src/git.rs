//! Thin **git helpers** backing gg's isolated workspace copies and their merge-back: the
//! per-[issue](https://docs.testcabinet.ai/gg/project-management/) worktree every dispatched issue
//! agent works in, and the per-attempt worktrees a
//! [speculation](https://docs.testcabinet.ai/gg/speculative-execution/) fans out.
//!
//! gg runs inside the run container next to the seeded workspace, so rather than reimplement
//! git it **shells out** to the `git` binary already present in the run image. This module wraps
//! the handful of plumbing commands the [orchestrator](crate::agent) needs:
//!
//! - [`ensure_baseline`] makes the workspace a git repository (if it is not one already) and
//!   returns the **baseline commit** — the seeded workspace committed verbatim;
//! - [`add_worktree`] creates a fresh worktree on a new branch (an isolated copy the agents working
//!   that issue — or that speculation attempt — mutate on their own);
//! - [`commit_worktree`] stages and commits whatever an agent produced onto its branch;
//! - [`diff_since`] renders the full patch a speculation's judge scores, and [`diff_stat_since`] the
//!   per-file summary a reviewer is pointed at its own worktree with;
//! - [`merge_branch`] merges that branch back into the main tree, either **aborting** a conflict
//!   (the speculation path, where a losing attempt is simply dropped) or **leaving it in the tree**
//!   for the [merge agent](test_cabinet_core::gg::PROJECT_MANAGEMENT_PARAM_MERGE_AGENT) to resolve
//!   (the issue path), with [`merge_in_progress`] and [`abort_merge`] to check on and undo that
//!   resolution; and
//! - [`remove_worktree`] tears the worktree and its branch down — run in **every** case (merge,
//!   conflict, or discard), so no isolated copy is ever left behind.
//!
//! Every function returns a [`GitError`] rather than panicking, and a **missing `git` binary** is
//! reported as [`GitError::NotFound`] with a clear message so an offline/misconfigured environment
//! degrades to "worktrees unavailable" instead of a crash.
//!
//! # Every command runs on the blocking pool, and that is not an optimization
//!
//! `git` is a subprocess, and waiting for one is **blocking** work: `Command::output` parks the
//! calling thread until the child exits. gg's turn loop runs on a *single-threaded* Tokio runtime
//! shared by every agent — the root, every dispatched issue agent, its reviewers, the merge agent —
//! so a git call made directly on that thread does not slow *its* agent down, it stops **all** of
//! them, along with every in-flight model request and every timer, for as long as git takes.
//!
//! And git takes real time here, because these commands walk the whole workspace. A run whose model
//! has done an `npm install` has tens of thousands of untracked files in the tree, and the
//! `git add -A` behind [`commit_worktree`], [`diff_since`] and [`diff_stat_since`] must hash every
//! one of them: **5.7 s measured** on a 33,000-file / 600 MB tree, with `git worktree add` checking
//! the same tree out again at 1.8 s. Left on the runtime thread those seconds landed wherever the
//! other agents happened to be, and the [phase accounting](crate::turn_timing) charged them to
//! whatever *that* agent was doing — which is how a single `edit_file` came to be reported as a turn
//! that spent 8.8 s handling its response, a figure a string replacement cannot account for.
//!
//! So every invocation here goes through [`git_output`], which runs it on
//! [`spawn_blocking`](tokio::task::spawn_blocking) — a pool sized for exactly this, whose threads
//! are *allowed* to block — and awaits the result. That makes every function in this module `async`,
//! which is the point: an `await` is a yield, so while git walks the tree the runtime keeps turning
//! every other agent. Callers that must also serialize against each other do so on the
//! orchestrator's **async** git lock, so an agent waiting its turn parks rather than holding the
//! thread it was going to wait on.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::Arc;

use tokio::task;

use crate::replay::{GgRecorder, RecordedCommand, shell_cwd};

/// The committer/author identity gg stamps its own commits with (the baseline commit, a worktree's
/// work commit, and a merge commit), passed as one-shot `-c` overrides so gg never depends on a
/// configured global git identity in the run container. Applied only to commands that write a
/// commit.
const GG_IDENTITY: &[&str] = &[
    "-c",
    "user.name=gg",
    "-c",
    "user.email=gg@test-cabinet.local",
];

/// Where a `git` invocation is reported for [replay capture](crate::replay), and under whose name.
///
/// Threaded into every function in this module as an explicit parameter rather than reached for
/// through run-global state, for the reason the module already threads emitters: gg's orchestration
/// runs several agents against one workspace, and a recorded command that could not say *which*
/// dispatch ran it would be an entry a reconstruction cannot place.
///
/// A [`disabled`](Self::disabled) capture records nothing and is the shape every test and every
/// pre-orchestrator call takes, so no call site needs an `Option`.
///
/// # Why gg's own git is an input at all
///
/// A `git` invocation here is gg's bookkeeping, not model-visible non-determinism, and a
/// [playback](https://docs.testcabinet.ai/gg/analysis/playback/) re-runs it for real rather than
/// replaying its result. It is recorded because the *result* is what a reconstruction is compared
/// against: a merge that conflicted changes the run, and a speculation judge scores whatever
/// `git diff` printed. In format v1 these bypassed tool dispatch entirely and were captured
/// nowhere, so a run that ended in a conflict left no trace of the conflict.
#[derive(Clone, Default)]
pub struct GitCapture {
    /// The run's recorder, or `None` for a capture that records nothing.
    recorder: Option<Arc<GgRecorder>>,
    /// The agent every invocation made through this capture is stamped with.
    agent_id: String,
    /// The workspace root recorded working directories are expressed relative to.
    workspace_dir: PathBuf,
}

impl GitCapture {
    /// Report every invocation made through this capture to `recorder`, under `agent_id`, with
    /// working directories relative to `workspace_dir`.
    pub fn new(
        recorder: Arc<GgRecorder>,
        agent_id: impl Into<String>,
        workspace_dir: impl Into<PathBuf>,
    ) -> Self {
        Self {
            recorder: Some(recorder),
            agent_id: agent_id.into(),
            workspace_dir: workspace_dir.into(),
        }
    }

    /// A capture that records nothing — a run with no recorder, and every test.
    pub fn disabled() -> Self {
        Self::default()
    }

    /// Record one finished invocation: `git <args>` run in `dir`.
    ///
    /// Called from [`git_output`], the single seam every invocation in this module goes through,
    /// so *every* command is recorded rather than the handful the callers thought to name — a
    /// `git status --porcelain` that unexpectedly reported a clean tree is exactly the kind of
    /// thing a record is opened to find.
    fn record(&self, dir: &Path, args: &[String], output: &Output) {
        let Some(recorder) = &self.recorder else {
            return;
        };
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        recorder.record_git(
            &self.agent_id,
            RecordedCommand {
                command: &format!("git {}", args.join(" ")),
                cwd: shell_cwd(&self.workspace_dir, dir),
                // A process killed by a signal has no code; `-1` is the one value an exit status
                // cannot otherwise take, and every consumer branches on "zero or not".
                exit_code: output.status.code().unwrap_or(-1),
                stdout: &stdout,
                stderr: &stderr,
            },
        );
    }
}

/// A failure running a git plumbing command.
#[derive(Debug)]
pub enum GitError {
    /// The `git` binary could not be launched at all (not installed / not on `PATH`). Reported so
    /// the run can degrade to "worktrees unavailable" with a clear message rather than crashing.
    NotFound,
    /// A git command ran but exited non-zero. Carries what was attempted and git's `stderr` so the
    /// diagnostic is actionable.
    Command {
        /// A short description of what was attempted (for example `"git init"`).
        context: String,
        /// git's captured `stderr`, trimmed.
        stderr: String,
    },
    /// The command never ran: the [blocking task](git_output) carrying it did not complete, which
    /// happens only if the runtime is shutting down under it. Distinct from
    /// [`Command`](Self::Command) because nothing was attempted and git said nothing — reporting it
    /// as a failed git command would invent a diagnostic git never gave.
    Offload {
        /// A short description of what was attempted (for example `"git init"`).
        context: String,
    },
}

impl std::fmt::Display for GitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GitError::NotFound => write!(
                f,
                "the `git` binary is not available; worktrees require git in the run environment"
            ),
            GitError::Command { context, stderr } => {
                if stderr.is_empty() {
                    write!(f, "{context} failed")
                } else {
                    write!(f, "{context} failed: {stderr}")
                }
            }
            GitError::Offload { context } => {
                write!(f, "{context} could not be run to completion")
            }
        }
    }
}

impl std::error::Error for GitError {}

/// The result of attempting to [merge a worktree branch](merge_branch) back into the main tree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MergeOutcome {
    /// The branch merged cleanly (or was already contained); the main tree now includes its work.
    Merged,
    /// The merge could not be applied without conflict. Carries git's explanation so it can be
    /// surfaced rather than dropped. Whether the main tree was left **unchanged** or left **in the
    /// conflicted state** for a merge agent to resolve is the caller's choice, made through
    /// [`ConflictPolicy`].
    Conflict(String),
}

/// What [`merge_branch`] does with a merge it could not apply cleanly.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictPolicy {
    /// **Abort** the merge, restoring the main tree exactly as it was. Used where the branch is
    /// disposable — a losing speculation attempt — so a clash costs nothing but the attempt.
    Abort,
    /// **Leave** the conflicted merge in the working tree (`MERGE_HEAD` set, conflict markers in
    /// the files) so the [merge agent](test_cabinet_core::gg::PROJECT_MANAGEMENT_PARAM_MERGE_AGENT)
    /// can resolve it and commit. The caller is then responsible for finishing the merge or
    /// [aborting](abort_merge) it — a tree left mid-merge would poison every later merge.
    Keep,
}

/// Whether the `git` binary can be launched (`git --version` succeeds). Used to decide, once, at
/// session start, whether the worktrees capability can operate at all.
pub async fn git_available() -> bool {
    // Not recorded: this runs before the run has an agent to attribute it to, and "is git
    // installed?" is a property of the container rather than an input the session consumed.
    git_output(
        &GitCapture::disabled(),
        Path::new("."),
        "git --version",
        &["--version"],
    )
    .await
    .is_ok_and(|output| output.status.success())
}

/// Run `git <args>` in `dir` **on Tokio's blocking pool** and return the finished process, or the
/// [`GitError`] for a command that could not be run at all.
///
/// This is the single seam every invocation in this module goes through, and the reason it exists is
/// in the [module docs](self): a git subprocess blocks the thread that waits on it, and gg's one
/// runtime thread carries every agent. The offload is therefore not tuning — it is what keeps one
/// agent's `git add -A` over an `npm install`-sized tree from stopping the whole harness.
///
/// A spawn failure is [`NotFound`](GitError::NotFound) (git absent from the environment), and a
/// blocking task that did not complete is [`Offload`](GitError::Offload) — the command never ran, so
/// it is not reported as one that failed. Interpreting the *exit status* is [`run_git`]'s job, or
/// the caller's where the failure carries meaning (a merge conflict).
async fn git_output(
    capture: &GitCapture,
    dir: &Path,
    context: &str,
    args: &[&str],
) -> Result<Output, GitError> {
    // Owned for the move onto the blocking thread: the task outlives this frame's borrows.
    let owned_dir = dir.to_path_buf();
    let args: Vec<String> = args.iter().map(|arg| (*arg).to_string()).collect();
    let spawned = {
        let dir = owned_dir.clone();
        let args = args.clone();
        task::spawn_blocking(move || Command::new("git").current_dir(dir).args(args).output())
    };
    match spawned.await {
        Ok(Ok(output)) => {
            // Recorded here, at the one seam every invocation reaches, and only for a command that
            // actually ran: a git that could not be launched produced no result to compare a
            // reconstruction against, and the [`GitError`] the caller gets is where that belongs.
            capture.record(&owned_dir, &args, &output);
            Ok(output)
        }
        Ok(Err(_)) => Err(GitError::NotFound),
        Err(_) => Err(GitError::Offload {
            context: context.to_string(),
        }),
    }
}

/// Run `git <args>` in `dir`, returning its trimmed `stdout` on success. A spawn failure maps to
/// [`GitError::NotFound`] (git absent); a non-zero exit maps to [`GitError::Command`] carrying
/// `context` and git's `stderr`.
async fn run_git(
    capture: &GitCapture,
    dir: &Path,
    context: &str,
    args: &[&str],
) -> Result<String, GitError> {
    let output = git_output(capture, dir, context, args).await?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(GitError::Command {
            context: context.to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        })
    }
}

/// Whether `dir` is itself the root of a git repository (a `.git` entry — a directory for a normal
/// repo, or a file for a linked worktree — sits directly in it). A deliberately local check: it
/// treats a workspace nested inside an *unrelated* parent repository as "not a repo", so gg
/// initializes a fresh baseline for the seeded workspace rather than latching onto an enclosing
/// repo's history.
fn is_repo_root(dir: &Path) -> bool {
    dir.join(".git").exists()
}

/// Ensure `workspace` is a git repository and return its **baseline commit** sha.
///
/// When `workspace` is not [already a repo](is_repo_root), gg initializes one and commits the
/// seeded workspace verbatim as the baseline (`--allow-empty`, so an empty seeded workspace still
/// yields a baseline commit). When it is already a repo, the current `HEAD` is taken as the
/// baseline. Either way the returned sha is the commit every [worktree](add_worktree) branches
/// from.
pub async fn ensure_baseline(capture: &GitCapture, workspace: &Path) -> Result<String, GitError> {
    if !is_repo_root(workspace) {
        run_git(capture, workspace, "git init", &["init", "-q"]).await?;
        run_git(capture, workspace, "git add", &["add", "-A"]).await?;
        let mut commit: Vec<&str> = GG_IDENTITY.to_vec();
        commit.extend_from_slice(&[
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "gg baseline: seeded workspace",
        ]);
        run_git(capture, workspace, "git commit", &commit).await?;
    }
    run_git(
        capture,
        workspace,
        "git rev-parse HEAD",
        &["rev-parse", "HEAD"],
    )
    .await
}

/// The current `HEAD` commit sha of the repository rooted at `dir` — the point an
/// [issue](https://docs.testcabinet.ai/gg/project-management/)'s worktree branches from, so a later
/// review diffs only that issue's changes rather than the whole run. On the first dispatch this
/// equals the [baseline](ensure_baseline); after earlier issue merges advanced `HEAD` it is later.
pub async fn head_commit(capture: &GitCapture, dir: &Path) -> Result<String, GitError> {
    run_git(capture, dir, "git rev-parse HEAD", &["rev-parse", "HEAD"]).await
}

/// The full textual diff of the working tree at `dir` against commit `base` — what a
/// [speculation](https://docs.testcabinet.ai/gg/speculative-execution/)'s judge scores.
///
/// Includes new, modified, and deleted files (not just tracked modifications): everything is
/// staged (`git add -A`) so the `--cached` diff against `base` covers untracked additions too, then
/// the index is reset back to `HEAD` so the staging is transient and the main tree is left as it
/// was. Returns the (possibly empty) diff text. Runs three git calls; the caller serializes them on
/// the shared git lock since staging mutates the shared index.
pub async fn diff_since(capture: &GitCapture, dir: &Path, base: &str) -> Result<String, GitError> {
    run_git(capture, dir, "git add", &["add", "-A"]).await?;
    let diff = run_git(
        capture,
        dir,
        "git diff --cached",
        &["diff", "--cached", base],
    )
    .await?;
    // Restore the index to HEAD so the transient staging does not linger (and cannot interfere with
    // a concurrent worktree merge in the main tree). Best-effort: a failure here does not invalidate
    // the diff we already captured.
    let _ = run_git(capture, dir, "git reset", &["reset", "-q"]).await;
    Ok(diff)
}

/// The **per-file summary** of the working tree at `dir` against commit `base` — one line per
/// changed path with its added/removed line counts (`git diff --stat`) — which is what an issue's
/// [review](https://docs.testcabinet.ai/gg/project-management/) hands its reviewers.
///
/// A reviewer works *in* the tree it is reviewing, so it can read any file and (given a shell) run
/// `git diff` for itself; what it cannot get on its own is the **map** of what this issue touched.
/// Handing it that map instead of the whole patch is the difference between a prompt that costs a
/// few hundred tokens and one that carries every generated lockfile line in the diff — and the patch
/// crowded out the reviewer's own reading of the code besides.
///
/// Staged and restored exactly like [`diff_since`] (so untracked additions count), and serialized by
/// the caller on the same git lock.
pub async fn diff_stat_since(
    capture: &GitCapture,
    dir: &Path,
    base: &str,
) -> Result<String, GitError> {
    run_git(capture, dir, "git add", &["add", "-A"]).await?;
    let stat = run_git(
        capture,
        dir,
        "git diff --cached --stat",
        &["diff", "--cached", "--stat", base],
    )
    .await?;
    let _ = run_git(capture, dir, "git reset", &["reset", "-q"]).await;
    Ok(stat)
}

/// Create a fresh worktree at `worktree_path` on a new `branch` based at commit `base`, from the
/// repository rooted at `main`. The new worktree is an isolated checkout of `base` the agents
/// dispatched into it mutate on their own; `worktree_path` must not already exist.
pub async fn add_worktree(
    capture: &GitCapture,
    main: &Path,
    worktree_path: &Path,
    branch: &str,
    base: &str,
) -> Result<(), GitError> {
    let path = worktree_path.to_string_lossy();
    run_git(
        capture,
        main,
        "git worktree add",
        &["worktree", "add", "-q", "-b", branch, &path, base],
    )
    .await
    .map(|_| ())
}

/// Stage and commit everything in `worktree` (the agent's produced changes) onto its branch,
/// returning whether a commit was actually made (`false` when the worktree was left unchanged, so
/// there is nothing to merge). Uses gg's own [identity](GG_IDENTITY).
pub async fn commit_worktree(
    capture: &GitCapture,
    worktree: &Path,
    message: &str,
) -> Result<bool, GitError> {
    run_git(capture, worktree, "git add", &["add", "-A"]).await?;
    // Nothing staged means the agent produced no changes: skip the commit (an empty commit would
    // merge as a no-op but muddies the history).
    let status = run_git(capture, worktree, "git status", &["status", "--porcelain"]).await?;
    if status.is_empty() {
        return Ok(false);
    }
    let mut commit: Vec<&str> = GG_IDENTITY.to_vec();
    commit.extend_from_slice(&["commit", "-q", "-m", message]);
    run_git(capture, worktree, "git commit", &commit).await?;
    Ok(true)
}

/// Merge `branch` back into the main tree rooted at `main` with an explicit merge commit
/// (`--no-ff`), returning whether it merged cleanly or [conflicted](MergeOutcome::Conflict).
///
/// A conflict (or any merge that cannot be applied to the working tree) is **not** an error: the
/// outcome carries git's explanation, and `policy` decides what is left behind —
/// [`Abort`](ConflictPolicy::Abort) restores the main tree exactly as it was, while
/// [`Keep`](ConflictPolicy::Keep) leaves the conflicted merge in place for a merge agent to
/// resolve. A genuinely broken invocation (git absent, bad branch name) still returns a
/// [`GitError`].
pub async fn merge_branch(
    capture: &GitCapture,
    main: &Path,
    branch: &str,
    policy: ConflictPolicy,
) -> Result<MergeOutcome, GitError> {
    let mut args: Vec<&str> = GG_IDENTITY.to_vec();
    args.extend_from_slice(&["merge", "--no-ff", "--no-edit", branch]);
    let output = git_output(capture, main, "git merge", &args).await?;
    if output.status.success() {
        return Ok(MergeOutcome::Merged);
    }
    // The merge did not apply. `git merge` prints the conflict summary to **stdout**
    // ("CONFLICT (content): …") and other refusals to stderr, so draw the reason from whichever is
    // populated, then honor the policy. Under `Abort` any in-progress merge is undone so the main
    // tree is restored to its pre-merge state (a merge that failed *before* starting — e.g. it
    // would overwrite local changes — has nothing to abort, so that failure is ignored).
    let reason = merge_reason(&output.stdout, &output.stderr);
    if policy == ConflictPolicy::Abort {
        abort_merge(capture, main).await;
    }
    Ok(MergeOutcome::Conflict(reason))
}

/// Whether the repository rooted at `main` is sitting in an **unfinished merge** (`MERGE_HEAD` is
/// set) — how gg checks whether a merge agent actually finished the merge it was handed, rather
/// than taking its word for it.
pub async fn merge_in_progress(capture: &GitCapture, main: &Path) -> bool {
    run_git(
        capture,
        main,
        "git rev-parse MERGE_HEAD",
        &["rev-parse", "-q", "--verify", "MERGE_HEAD"],
    )
    .await
    .is_ok()
}

/// Abort an in-progress merge in `main`, restoring the working tree to its pre-merge state.
///
/// Best-effort and idempotent: a tree with nothing to abort simply reports failure, which is
/// ignored — this is a cleanup path, and a run must not die because there was no merge to undo.
pub async fn abort_merge(capture: &GitCapture, main: &Path) {
    let _ = git_output(capture, main, "git merge --abort", &["merge", "--abort"]).await;
}

/// Assemble a human-readable reason for a failed merge from git's `stdout` (where the conflict
/// summary lands) and `stderr` (where other refusals land): stderr when it is populated, else the
/// stdout conflict lines, else a generic fallback so the reason is never empty.
fn merge_reason(stdout: &[u8], stderr: &[u8]) -> String {
    let err = String::from_utf8_lossy(stderr).trim().to_string();
    if !err.is_empty() {
        return err;
    }
    let out = String::from_utf8_lossy(stdout);
    let conflict_lines: Vec<&str> = out
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with("CONFLICT") || line.contains("Automatic merge failed"))
        .collect();
    if !conflict_lines.is_empty() {
        conflict_lines.join("; ")
    } else {
        out.trim()
            .lines()
            .next()
            .map(str::to_string)
            .filter(|line| !line.is_empty())
            .unwrap_or_else(|| "merge could not be applied".to_string())
    }
}

/// Tear down the worktree at `worktree_path` and delete its `branch`, from the repository rooted at
/// `main`. Best-effort and idempotent: run in every case (a merged, conflicted, or discarded
/// branch) so no isolated copy or dangling branch is left behind. Individual failures are
/// returned but the caller typically only logs them — cleanup must not fail a run.
pub async fn remove_worktree(
    capture: &GitCapture,
    main: &Path,
    worktree_path: &Path,
    branch: &str,
) -> Result<(), GitError> {
    let path = worktree_path.to_string_lossy();
    // Remove the checkout first (it holds the branch checked out, blocking the branch delete).
    run_git(
        capture,
        main,
        "git worktree remove",
        &["worktree", "remove", "--force", &path],
    )
    .await?;
    // Delete the branch (force: it may be unmerged on a discard).
    run_git(capture, main, "git branch -D", &["branch", "-D", branch]).await?;
    Ok(())
}

#[cfg(test)]
#[path = "git.test.rs"]
mod tests;
