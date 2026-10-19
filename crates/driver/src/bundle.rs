//! Committing the run's implementation and uploading it to the repos service as a
//! git bundle.
//!
//! A run's workspace is a git repository whose first commit is the seed. At run
//! end, after the post-run stages and the code analysis, the driver commits
//! everything the model left uncommitted on top of the history the run holds, with
//! the contract's [`IMPLEMENTATION_COMMIT_MESSAGE`], writes `git bundle --all` and
//! uploads it to `POST {repos_url}/runs/{id}/bundle` with the same per-job token
//! (and `x-tcab-job-id` header) the tree upload presents. The repos service
//! replaces a run's bundle on a repeated upload, so every attempt is safe to
//! repeat.
//!
//! The commit happens on the driver's own collected copy of the tree, never in the
//! sandbox, so the sandbox never holds a credential and the committed tree is the
//! one the validators judged. That copy's `.git` was written by the model, though,
//! and the driver is the trusted pod: before running git over it the driver
//! replaces the repository's configuration with a plain one and runs every command
//! with hooks disabled and the host's configuration ignored, so nothing the model
//! wrote into `.git` (a hook, an `fsmonitor` command, a clean filter, an include)
//! executes here.
//!
//! An upload is retried under the driver's shared [retry policy](crate::retry):
//! `5`, `10`, `20` and `40` seconds and then `60` seconds between attempts, until
//! `TCAB_ARTIFACT_UPLOAD_WAIT_SECONDS` has passed since its first failure. A
//! failure that is the run's own (the bundle cannot be written, or the service
//! answers `400`, `413` or `422`) ends the upload at once, and an operator's
//! cancellation ends it wherever it is. A bundle that is still not stored is logged
//! by the caller and the run's record still reports.
//!
//! When `TCAB_REPOS_URL` is unset nothing here runs.

use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use futures_util::StreamExt;
use tokio::time::Instant;
use tokio_util::io::ReaderStream;

use crate::test_case::{TCAB_ENGINE_DIR, TCAB_VENDOR_DIR};
use test_cabinet_contracts::execution::IMPLEMENTATION_COMMIT_MESSAGE;
use test_cabinet_contracts::layout::VALIDATION_MEDIA_DIR;

/// The branch the bundle carries the implementation on. The repos service refuses
/// a bundle without it.
pub const MAIN_BRANCH: &str = "main";

pub use crate::retry::{
    CANCELED_RUN_UPLOAD_WAIT, DEFAULT_STALL_LIMIT, DEFAULT_UPLOAD_WAIT, RetryPolicy,
};

/// A failure committing, bundling or uploading the run's implementation.
#[derive(Debug, thiserror::Error)]
pub enum BundleError {
    /// The bundle could not be written: the tree is not a repository, or a git
    /// command over it failed.
    #[error("writing the run's bundle: {0}")]
    Write(String),
    /// The upload request could not be sent or its answer not read.
    #[error("uploading the bundle to the repos service: {0}")]
    Transport(#[source] reqwest::Error),
    /// The bundle file could not be read for an attempt.
    #[error("reading the bundle for upload: {0}")]
    Read(#[source] std::io::Error),
    /// The service took none of the bundle and gave no answer for the stall limit.
    #[error("the repos service stalled: no progress for {} seconds", .0.as_secs())]
    Stalled(Duration),
    /// The run's job was canceled before the bundle was stored.
    #[error("the run was canceled before its bundle was stored")]
    Canceled,
    /// The repos service answered with a non-success status.
    #[error("the repos service refused the bundle: HTTP {status}{}", body_suffix(.body))]
    Status {
        /// The HTTP status the service returned.
        status: reqwest::StatusCode,
        /// The response body, for diagnostics.
        body: String,
    },
}

impl BundleError {
    /// Whether this failure is the run's own, which no retry can change: the bundle
    /// cannot be written, or the service answers `400`, `413` or `422`. Every other
    /// failure is a store condition and is retried.
    pub fn is_runs_own(&self) -> bool {
        match self {
            Self::Write(_) => true,
            Self::Status { status, .. } => matches!(status.as_u16(), 400 | 413 | 422),
            Self::Transport(_) | Self::Read(_) | Self::Stalled(_) | Self::Canceled => false,
        }
    }
}

impl crate::retry::FinalFailure for BundleError {
    fn is_final(&self) -> bool {
        self.is_runs_own()
    }
}

/// Append the body to a status error when there is one to show.
fn body_suffix(body: &str) -> String {
    if body.trim().is_empty() {
        String::new()
    } else {
        format!(": {}", body.trim())
    }
}

/// Where a run's bundle is uploaded and the credential it presents.
#[derive(Debug, Clone, Copy)]
pub struct BundleTarget<'a> {
    /// The repos service base URL, without a trailing slash (`TCAB_REPOS_URL`).
    pub repos_url: &'a str,
    /// The run record's id, the store key in the upload path.
    pub run_id: &'a str,
    /// The job id the per-job token was minted for, sent as `x-tcab-job-id`.
    pub job_id: &'a str,
    /// The per-job bearer token.
    pub job_token: &'a str,
}

/// Commit the implementation in `repo`, bundle it into a temporary file on
/// `scratch_dir`, and upload it to `target` under `policy`.
///
/// Returns once the service acknowledged the bundle. A run's-own failure ends at
/// once; any other failure is retried until the policy's wait has passed since the
/// first failure, and the last failure is returned. `canceled` resolving ends the
/// upload wherever it is, with the last failure or [`BundleError::Canceled`] when
/// none had happened; see [`retry_call`](crate::retry::retry_call).
pub async fn store_bundle(
    target: BundleTarget<'_>,
    repo: &Path,
    scratch_dir: &Path,
    policy: &RetryPolicy,
    canceled: impl std::future::Future<Output = ()>,
) -> Result<(), BundleError> {
    let repo_owned = repo.to_path_buf();
    let scratch_owned = scratch_dir.to_path_buf();
    // Git and the filesystem are blocking; the same task still serves nothing else at
    // this point, but the blocking pool keeps the reactor free all the same.
    let bundle = tokio::task::spawn_blocking(move || -> Result<_, BundleError> {
        let file = tempfile::Builder::new()
            .prefix("implementation-")
            .suffix(".bundle")
            .tempfile_in(&scratch_owned)
            .map_err(|err| BundleError::Write(format!("creating the bundle file: {err}")))?;
        commit_and_bundle(&repo_owned, file.path())?;
        Ok(file)
    })
    .await
    .map_err(|join| BundleError::Write(format!("the bundle task failed: {join}")))??;

    let client = reqwest::Client::new();
    crate::retry::retry_call(policy, "the bundle upload", canceled, || {
        upload_once(&client, target, bundle.path(), policy.stall_limit)
    })
    .await
    .map_err(|failure| failure.error.unwrap_or(BundleError::Canceled))
}

/// One attempt: stream the bundle at `path` to the service and read its answer,
/// abandoning the attempt when it makes no progress for `stall_limit`.
async fn upload_once(
    client: &reqwest::Client,
    target: BundleTarget<'_>,
    path: &Path,
    stall_limit: Duration,
) -> Result<(), BundleError> {
    // Each attempt reads the bundle from its first byte, so an attempt the service
    // answered before reading the whole body leaves the next one unaffected.
    let file = tokio::fs::File::open(path)
        .await
        .map_err(BundleError::Read)?;
    let progress = Arc::new(AtomicU64::new(0));
    let counter = progress.clone();
    let stream = ReaderStream::new(file).map(move |chunk| {
        if chunk.is_ok() {
            counter.fetch_add(1, Ordering::Relaxed);
        }
        chunk
    });
    let url = format!("{}/runs/{}/bundle", target.repos_url, target.run_id);
    let send = async {
        let response = client
            .post(&url)
            .bearer_auth(target.job_token)
            .header("x-tcab-job-id", target.job_id)
            .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
            .body(reqwest::Body::wrap_stream(stream))
            .send()
            .await
            .map_err(BundleError::Transport)?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        let body = response.text().await.unwrap_or_default();
        Err(BundleError::Status { status, body })
    };
    tokio::select! {
        result = send => result,
        () = stalled(&progress, stall_limit) => Err(BundleError::Stalled(stall_limit)),
    }
}

/// Resolve once `progress` has not moved for `limit`.
async fn stalled(progress: &AtomicU64, limit: Duration) {
    let tick = (limit / 10).max(Duration::from_millis(10));
    let mut seen = progress.load(Ordering::Relaxed);
    let mut since = Instant::now();
    loop {
        tokio::time::sleep(tick).await;
        let now = progress.load(Ordering::Relaxed);
        if now != seen {
            seen = now;
            since = Instant::now();
        } else if since.elapsed() >= limit {
            return;
        }
    }
}

/// Commit everything uncommitted in `repo` on `main` with the contract's message
/// and write `git bundle --all` to `bundle_path`.
///
/// The working tree is the one the validators judged, so it is what `main` carries:
/// when the model left `HEAD` on another branch or detached, `main` is moved to
/// `HEAD` before the commit. Nothing to commit leaves the history as the model left
/// it. Dependency directories the collection skipped and the validation media the
/// driver wrote into the tree are not the model's work and are never staged, and the
/// vendored trees are force-added as seeding adds them.
pub fn commit_and_bundle(repo: &Path, bundle_path: &Path) -> Result<(), BundleError> {
    let git_dir = repo.join(".git");
    let is_repo = std::fs::symlink_metadata(&git_dir).is_ok_and(|meta| meta.is_dir());
    if !is_repo {
        return Err(BundleError::Write(format!(
            "`{}` is not a git repository",
            repo.display()
        )));
    }
    neutralize_git_dir(&git_dir)?;

    let main_ref = format!("refs/heads/{MAIN_BRANCH}");
    let head_ref = git(repo, &["symbolic-ref", "-q", "HEAD"]).ok();
    if head_ref.as_deref().map(str::trim) != Some(main_ref.as_str()) {
        // `HEAD` is on another branch or detached: point `main` at its commit and
        // `HEAD` at `main`. The index and working tree are untouched, since `main`
        // now names the commit they were checked out from.
        if let Ok(tip) = git(repo, &["rev-parse", "--verify", "-q", "HEAD^{commit}"]) {
            git(repo, &["update-ref", &main_ref, tip.trim()])?;
        }
        git(repo, &["symbolic-ref", "HEAD", &main_ref])?;
    }

    let mut excludes: Vec<String> = crate::SKIPPED_DIRS
        .iter()
        .map(|dir| format!(":(exclude,glob)**/{dir}/**"))
        .collect();
    excludes.push(format!(":(exclude){VALIDATION_MEDIA_DIR}"));

    let mut add: Vec<&str> = vec!["add", "--all", "--", "."];
    add.extend(excludes.iter().map(String::as_str));
    git(repo, &add)?;
    for vendored in [TCAB_VENDOR_DIR, TCAB_ENGINE_DIR] {
        if repo.join(vendored).is_dir() {
            let mut add: Vec<&str> = vec!["add", "--force", "--", vendored];
            add.extend(excludes.iter().map(String::as_str));
            git(repo, &add)?;
        }
    }

    if git_status(repo, &["diff", "--cached", "--quiet"])? {
        git(
            repo,
            &[
                "commit",
                "--quiet",
                "--no-verify",
                "--message",
                IMPLEMENTATION_COMMIT_MESSAGE,
            ],
        )?;
    }
    git(repo, &["rev-parse", "--verify", "-q", &main_ref])
        .map_err(|_| BundleError::Write(format!("the repository has no `{MAIN_BRANCH}` branch")))?;

    let bundle = bundle_path.to_string_lossy();
    git(repo, &["bundle", "create", "--quiet", &bundle, "--all"])?;
    Ok(())
}

/// The repository configuration the driver runs git under, replacing whatever the
/// model left in `.git/config`.
const PLAIN_CONFIG: &str = "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = true\n";

/// Make the model-written `.git` safe for the trusted driver to run git over:
/// replace its configuration with a plain one (dropping any hook path, `fsmonitor`,
/// filter, alias or include it set) and drop the files that would point git outside
/// the repository (`commondir`, object alternates). Each file is removed before it
/// is written, so a symlink the model planted is replaced rather than followed.
fn neutralize_git_dir(git_dir: &Path) -> Result<(), BundleError> {
    let write_err = |what: &str, err: std::io::Error| {
        BundleError::Write(format!("preparing `{what}` in the run's repository: {err}"))
    };
    for rel in ["commondir", "objects/info/alternates", "config.worktree"] {
        let path = git_dir.join(rel);
        if std::fs::symlink_metadata(&path).is_ok() {
            std::fs::remove_file(&path).map_err(|err| write_err(rel, err))?;
        }
    }
    let config = git_dir.join("config");
    if std::fs::symlink_metadata(&config).is_ok() {
        std::fs::remove_file(&config).map_err(|err| write_err("config", err))?;
    }
    std::fs::write(&config, PLAIN_CONFIG).map_err(|err| write_err("config", err))?;
    Ok(())
}

/// A git command over `repo`, isolated from the host's and the model's
/// configuration: no system or global configuration, hooks pointed at nothing,
/// no `fsmonitor`, no signing, no prompts, and the seeding identity.
fn git_command(repo: &Path, args: &[&str]) -> Command {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(repo)
        .args([
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "commit.gpgSign=false",
            "-c",
            "safe.directory=*",
            "-c",
            "user.name=Clockwyrks",
            "-c",
            "user.email=runs@clockwyrks.invalid",
        ])
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .env_remove("GIT_OBJECT_DIRECTORY")
        .env_remove("GIT_ALTERNATE_OBJECT_DIRECTORIES")
        .env_remove("GIT_CONFIG_PARAMETERS")
        .env_remove("GIT_CONFIG_COUNT");
    command
}

/// Run a git command over `repo`, returning its stdout, or a write error naming it.
fn git(repo: &Path, args: &[&str]) -> Result<String, BundleError> {
    let output = git_command(repo, args)
        .output()
        .map_err(|err| BundleError::Write(format!("running `git {}`: {err}", args.join(" "))))?;
    if !output.status.success() {
        return Err(BundleError::Write(format!(
            "`git {}` failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Run a git command whose exit status is its answer: `Ok(false)` on `0`,
/// `Ok(true)` on `1` (the `--quiet` "differs" status), an error otherwise.
fn git_status(repo: &Path, args: &[&str]) -> Result<bool, BundleError> {
    let output = git_command(repo, args)
        .output()
        .map_err(|err| BundleError::Write(format!("running `git {}`: {err}", args.join(" "))))?;
    match output.status.code() {
        Some(0) => Ok(false),
        Some(1) => Ok(true),
        _ => Err(BundleError::Write(format!(
            "`git {}` failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        ))),
    }
}

#[cfg(test)]
#[path = "bundle.test.rs"]
mod tests;
