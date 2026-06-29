//! Publishing: releasing a finished run's outputs.
//!
//! See `core/results.md`. Publishing is an explicit operation that releases the
//! generated code to its own public GitHub repository and deploys the playable
//! build to Cloudflare Pages. It runs in the `tcab-publisher` Job when a run is
//! published; the run record itself is stored on the backend separately (by the
//! driver, when the run finishes). It must be idempotent.
//!
//! This replaces the v0.1 "git-as-a-db" model (appending the record into the
//! site's dataset and deploying the build through a per-run GitHub Pages
//! workflow): the dataset is gone (the backend exports the site's snapshot), and
//! the build deploys to Cloudflare Pages directly — capturing the URL `wrangler`
//! reports rather than constructing one.

use std::borrow::Cow;
use std::path::{Path, PathBuf};

use crate::backend_client::BackendClient;
use crate::error::{Error, Result};
use crate::execution::ArtifactCollection;
use crate::redact::SecretScrubber;
use crate::run_record::RunRecord;

/// A request to release a single finished run: publish its source + build. Used by
/// the publisher Job to drive [`Publisher::release_code`] and
/// [`Publisher::release_playable_build`]; the run record itself is stored on the
/// backend by the driver when the run finishes.
#[derive(Debug, Clone, PartialEq)]
pub struct ReleaseRequest<'a> {
    /// The run record describing the run.
    pub record: &'a RunRecord,
    /// The collected implementation to release as the run's public source repo.
    pub artifacts: &'a ArtifactCollection,
    /// The produced static build directory to deploy to Cloudflare Pages, when
    /// one is available. `None` skips the build deploy and leaves the playable
    /// build link unset, so a record can still be released without a build (for
    /// example a failed run whose source is still worth publishing).
    pub build_dir: Option<&'a Path>,
}

/// Releases finished runs: publishes the source to a public repository and deploys
/// the playable build. Invoked by the `tcab-publisher` Job when a run is published;
/// the run record is stored on the backend separately (by the driver, when the run
/// finishes).
///
/// Every operation must be idempotent so a batch of runs can be released repeatedly
/// without manual handling of each one.
#[async_trait::async_trait]
pub trait Publisher: Send + Sync {
    /// Release the run's generated code to its own public repository, returning
    /// the repository URL — or `None` for a run type that produces no code to
    /// release (asset-generation), which creates no repository.
    async fn release_code(&self, request: &ReleaseRequest<'_>) -> Result<Option<String>>;

    /// Deploy the run's playable build, returning the URL it is served at, or
    /// `None` when the request carried no build directory.
    async fn release_playable_build(&self, request: &ReleaseRequest<'_>) -> Result<Option<String>>;
}

/// Where and how published artifacts are hosted.
///
/// Per-run source repositories are public under the `TheClockwyrks` org; per-run
/// builds deploy to a Cloudflare Pages project (one branch alias per run); the
/// run record + review + links are submitted to the backend, which is the system
/// of record and exports the site's snapshot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublishConfig {
    /// GitHub organization that owns the per-run repositories.
    pub github_org: String,
    /// Prefix applied to per-run repository names so they namespace cleanly in a
    /// shared organization.
    pub repo_prefix: String,
    /// The Cloudflare Pages project the per-run builds deploy to. Each run is
    /// deployed under its own branch alias (`--branch=<run-id>`); the URL is read
    /// from `wrangler`'s output, never constructed.
    pub pages_project: String,
}

impl Default for PublishConfig {
    fn default() -> Self {
        Self {
            github_org: "TheClockwyrks".to_string(),
            repo_prefix: "tcab-".to_string(),
            pages_project: "test-cabinet-runs".to_string(),
        }
    }
}

impl PublishConfig {
    /// Resolve the publish configuration from the environment.
    ///
    /// `TCAB_GITHUB_ORG` overrides the GitHub org the per-run source repos are
    /// created under, and `TCAB_PAGES_PROJECT` the Cloudflare Pages project the
    /// per-run builds deploy to. Each falls back to the [`Default`] value when
    /// the variable is unset or empty; the repo prefix is not env-configurable.
    pub fn from_env() -> Self {
        let defaults = Self::default();
        let env_or = |key: &str, fallback: String| {
            std::env::var(key)
                .ok()
                .filter(|value| !value.is_empty())
                .unwrap_or(fallback)
        };
        Self {
            github_org: env_or("TCAB_GITHUB_ORG", defaults.github_org),
            repo_prefix: defaults.repo_prefix,
            pages_project: env_or("TCAB_PAGES_PROJECT", defaults.pages_project),
        }
    }

    /// The per-run repository name, for example `tcab-pong-codex-gpt-5-4-mini-d483a2f9`.
    pub fn repo_name(&self, record: &RunRecord) -> String {
        format!("{}{}", self.repo_prefix, run_slug(record))
    }

    /// The `org/name` reference `gh` uses to address the repository.
    pub fn repo_qualified(&self, record: &RunRecord) -> String {
        format!("{}/{}", self.github_org, self.repo_name(record))
    }

    /// The public URL of the per-run source repository.
    pub fn repo_url(&self, record: &RunRecord) -> String {
        format!("https://github.com/{}", self.repo_qualified(record))
    }
}

/// Derive a run's stable, hosting-safe slug from its subject and id.
///
/// The slug is `<test-case>-<harness>-<model>-<short-id>` reduced to lowercase
/// `[a-z0-9-]`, which keeps a shared GitHub org browsable while staying unique
/// (via the short run-id suffix) and valid as a repository name.
pub fn run_slug(record: &RunRecord) -> String {
    let short_id = record.id.split('-').next().unwrap_or(&record.id);
    let short_id = &short_id[..short_id.len().min(8)];
    let joined = format!(
        "{}-{}-{}-{}",
        record.subject.test_case_slug,
        record.subject.harness_slug.as_str(),
        record.subject.model_id,
        short_id,
    );
    sanitize_label(&joined)
}

/// Reduce arbitrary text to a lowercase `[a-z0-9-]` token with no leading,
/// trailing, or repeated hyphens.
fn sanitize_label(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut prev_hyphen = false;
    for raw in input.chars() {
        let lowered = raw.to_ascii_lowercase();
        if lowered.is_ascii_alphanumeric() {
            out.push(lowered);
            prev_hyphen = false;
        } else if !prev_hyphen {
            out.push('-');
            prev_hyphen = true;
        }
    }
    out.trim_matches('-').to_string()
}

/// The captured result of running an external command.
#[derive(Debug, Clone)]
pub struct CommandOutput {
    /// Whether the process exited successfully.
    pub success: bool,
    /// Captured standard output.
    pub stdout: String,
    /// Captured standard error.
    pub stderr: String,
}

/// Runs external commands (`gh`, `git`, `wrangler`, ...) on behalf of a
/// publisher.
///
/// Abstracting process execution behind a trait keeps the publish orchestration
/// testable without touching the network, a real GitHub, or Cloudflare.
#[async_trait::async_trait]
pub trait CommandRunner: Send + Sync {
    /// Run `program` with `args`, optionally in `cwd`, and capture its output.
    async fn run(&self, program: &str, args: &[&str], cwd: Option<&Path>) -> Result<CommandOutput>;
}

/// A [`CommandRunner`] that executes commands as real subprocesses.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemCommandRunner;

#[async_trait::async_trait]
impl CommandRunner for SystemCommandRunner {
    async fn run(&self, program: &str, args: &[&str], cwd: Option<&Path>) -> Result<CommandOutput> {
        let mut command = tokio::process::Command::new(program);
        command.args(args);
        if let Some(dir) = cwd {
            command.current_dir(dir);
        }
        let output = command
            .output()
            .await
            .map_err(|err| Error::Publish(format!("failed to run `{program}`: {err}")))?;
        Ok(CommandOutput {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

/// Publishes runs: a public per-run GitHub repository for the source, a
/// Cloudflare Pages deploy for the playable build, and a submission of the
/// record + review + links to the backend (the system of record).
///
/// `gh`/`git`/`wrangler` are driven through a [`CommandRunner`]; the backend is
/// reached through a [`BackendClient`]. Both seams are swappable so the publish
/// orchestration can be tested without touching the network.
pub struct BackendPublisher<R: CommandRunner, B: BackendClient> {
    config: PublishConfig,
    runner: R,
    backend: B,
}

impl<R: CommandRunner, B: BackendClient> BackendPublisher<R, B> {
    /// Construct a publisher with the given hosting configuration, command
    /// runner, and backend client.
    pub fn new(config: PublishConfig, runner: R, backend: B) -> Self {
        Self {
            config,
            runner,
            backend,
        }
    }

    /// The hosting configuration this publisher uses.
    pub fn config(&self) -> &PublishConfig {
        &self.config
    }

    /// The command runner this publisher drives external tools through.
    pub fn runner(&self) -> &R {
        &self.runner
    }

    /// The backend client this publisher submits runs to.
    pub fn backend(&self) -> &B {
        &self.backend
    }

    /// Run a command and fail unless it exits successfully.
    async fn require(
        &self,
        program: &str,
        args: &[&str],
        cwd: Option<&Path>,
    ) -> Result<CommandOutput> {
        let output = self.runner.run(program, args, cwd).await?;
        if !output.success {
            return Err(Error::Publish(format!(
                "`{program} {}` failed: {}",
                args.join(" "),
                output.stderr.trim()
            )));
        }
        Ok(output)
    }

    /// Stage and commit the run's working tree in `dir` so the subsequent push
    /// releases the implementation the model produced, not just the seed commit.
    ///
    /// A collected implementation is normally already a git repository (seeding
    /// inits one and commits "Seed test case") with the model's changes left
    /// uncommitted in the working tree; this commits them. Staging honors the
    /// seeded `.gitignore`, so build artifacts (`target/`, `node_modules/`, …)
    /// stay out of the public source repo even though a blanket add is used.
    ///
    /// Idempotent: when staging finds nothing to commit — a re-push, or a run
    /// the model never modified — the commit is skipped rather than failing, and
    /// the push proceeds against whatever is already committed. A `git init` is
    /// run defensively for the unusual case of an implementation that arrived
    /// without a repo, so the push always has commits to create from.
    async fn commit_implementation(&self, dir: &Path) -> Result<()> {
        if !dir.join(".git").is_dir() {
            self.require(
                "git",
                &["init", "--quiet", "--initial-branch", "main"],
                Some(dir),
            )
            .await?;
        }
        // Repo-local identity so committing does not depend on the host's global
        // git configuration (matching how seeding configures the seed repo).
        self.require(
            "git",
            &["config", "user.name", "The Test Cabinet"],
            Some(dir),
        )
        .await?;
        self.require(
            "git",
            &["config", "user.email", "runs@test-cabinet.invalid"],
            Some(dir),
        )
        .await?;
        self.require("git", &["add", "--all"], Some(dir)).await?;
        // Redact any leaked API key from the staged tree before it is committed
        // and pushed to the run's public repository: a model that dumped its
        // environment can have written its provider key into a source file.
        self.scrub_staged_secrets(dir).await?;
        // Commit only when staging produced something, so a re-push is a clean
        // no-op instead of a `git commit` "nothing to commit" failure. Porcelain
        // status is empty exactly when the index matches HEAD.
        let status = self
            .require("git", &["status", "--porcelain"], Some(dir))
            .await?;
        if !status.stdout.trim().is_empty() {
            self.require(
                "git",
                &["commit", "--quiet", "--message", "Apply run implementation"],
                Some(dir),
            )
            .await?;
        }
        Ok(())
    }

    /// Rewrite every staged file under `dir` to redact any leaked provider API
    /// key, re-staging the ones that changed so the commit carries the redacted
    /// form. This is the GitHub-egress half of the publish-time secret scrub: it
    /// runs on the operator host, so the scrubber can match the exact key values
    /// from the environment as well as any `sk-…`-shaped token (see
    /// [`SecretScrubber::from_host_env`]).
    ///
    /// Only the staged set is scanned — the model's changes against the seeded
    /// commit, which is the only way a secret can have entered — and staging
    /// already honors `.gitignore`, so build trees never reach here. Binary and
    /// unreadable entries (including deletions) are skipped: a key is pasted as
    /// text, and a non-UTF-8 file cannot carry one in a form worth rewriting.
    async fn scrub_staged_secrets(&self, dir: &Path) -> Result<()> {
        let staged = self
            .require("git", &["diff", "--cached", "--name-only", "-z"], Some(dir))
            .await?;
        let scrubber = SecretScrubber::from_host_env();
        let mut redacted: Vec<String> = Vec::new();
        for rel in staged.stdout.split('\0').filter(|p| !p.is_empty()) {
            let path = dir.join(rel);
            let Ok(contents) = std::fs::read_to_string(&path) else {
                continue;
            };
            if let Cow::Owned(scrubbed) = scrubber.scrub(&contents) {
                std::fs::write(&path, scrubbed).map_err(|e| {
                    Error::Publish(format!("rewriting {rel} to redact a secret: {e}"))
                })?;
                redacted.push(rel.to_string());
            }
        }
        if !redacted.is_empty() {
            for rel in &redacted {
                self.require("git", &["add", "--", rel], Some(dir)).await?;
            }
            tracing::warn!(
                files = ?redacted,
                "redacted leaked API key(s) from a run's implementation before releasing it publicly"
            );
        }
        Ok(())
    }
}

#[async_trait::async_trait]
impl<R: CommandRunner, B: BackendClient> Publisher for BackendPublisher<R, B> {
    async fn release_code(&self, request: &ReleaseRequest<'_>) -> Result<Option<String>> {
        let record = request.record;

        // Asset-generation runs produce no code — their authoritative output is the
        // recorded drawing operations, uploaded separately to the backend. There is
        // nothing to commit or push, so no per-run GitHub repository is created and
        // the run carries no source link. Every other (code-writing) type releases
        // its implementation; see `TestType::releases_source_repo`.
        if !record.subject.test_type.releases_source_repo() {
            return Ok(None);
        }

        let impl_dir = request.artifacts.repo_path.as_path();
        let qualified = self.config.repo_qualified(record);

        // Idempotent: if the repository already exists, leave it in place. A fresh
        // publish creates it public and pushes the implementation. The source is a
        // public repository per `core/results.md` (each run is released as its own
        // public git repo so anyone can clone and play it).
        let exists = self
            .runner
            .run("gh", &["repo", "view", &qualified], None)
            .await?
            .success;
        if !exists {
            let source = impl_dir.to_str().ok_or_else(|| {
                Error::Publish("implementation path is not valid UTF-8".to_string())
            })?;
            // The collected implementation is a git repo seeded with a single
            // "Seed test case" commit; the model's actual work sits in the
            // working tree, uncommitted. `gh repo create --push` only pushes
            // existing commits, so without this the public repo would carry only
            // the seed — the run's implementation would be missing entirely.
            // Commit the working tree first (the seeded `.gitignore` keeps build
            // artifacts such as `target/` out of it).
            self.commit_implementation(impl_dir).await?;
            self.require(
                "gh",
                &[
                    "repo", "create", &qualified, "--public", "--source", source, "--push",
                ],
                None,
            )
            .await?;
        }

        Ok(Some(self.config.repo_url(record)))
    }

    async fn release_playable_build(&self, request: &ReleaseRequest<'_>) -> Result<Option<String>> {
        let Some(build_dir) = request.build_dir else {
            return Ok(None);
        };
        // Redact any leaked API key from the built static output before it is
        // deployed to the public Cloudflare Pages site, mirroring the GitHub
        // seam: a key the model wrote into a source file can have been carried
        // through the build into an emitted asset.
        scrub_build_dir(build_dir)?;
        let dir = build_dir
            .to_str()
            .ok_or_else(|| Error::Publish("build directory path is not valid UTF-8".to_string()))?;
        // Deploy the already-built static output to Cloudflare Pages under a
        // per-run branch alias. Do NOT construct `https://<run-id>.<project>.pages.dev`:
        // Cloudflare sanitizes/truncates long branch-alias subdomains, so a 36-char
        // UUID branch will not map to that literal host. Capture the URL wrangler
        // reports and use THAT as the playable-build link.
        let branch = format!("--branch={}", request.record.id);
        let output = self
            .require(
                "wrangler",
                &[
                    "pages",
                    "deploy",
                    dir,
                    "--project-name",
                    &self.config.pages_project,
                    &branch,
                ],
                None,
            )
            .await?;
        let url = parse_wrangler_url(&output.stdout)
            .or_else(|| parse_wrangler_url(&output.stderr))
            .ok_or_else(|| {
                Error::Publish(
                    "could not find a deployment URL in `wrangler pages deploy` output".to_string(),
                )
            })?;
        Ok(Some(url))
    }
}

/// Extract the deployment URL `wrangler pages deploy` reports from its output.
///
/// Wrangler prints a line containing the deployment URL — for example
/// `✨ Deployment complete! Take a peek over at https://abc123.test-cabinet-runs.pages.dev`.
/// The host is sanitized/truncated by Cloudflare, so the reported URL is the only
/// reliable source; this scans for the first `https://…pages.dev` token. Returns
/// the URL with surrounding punctuation trimmed, or `None` when none is found.
pub fn parse_wrangler_url(output: &str) -> Option<String> {
    output.split_whitespace().find_map(|token| {
        // A token may carry leading framing (an emoji, a quote) before the URL;
        // start at the scheme and trim trailing sentence punctuation.
        let start = token.find("https://")?;
        let url = token[start..].trim_end_matches(['.', ',', ')', '"', '\'']);
        if url.contains("pages.dev") {
            Some(url.to_string())
        } else {
            None
        }
    })
}

/// Redact any leaked provider API key from every text file under an
/// already-built static `build_dir` before it is deployed to the public
/// Cloudflare Pages site.
///
/// This is the Cloudflare-egress half of the publish-time secret scrub, mirroring
/// the GitHub seam ([`BackendPublisher::scrub_staged_secrets`]): it runs on the
/// operator host, so the scrubber matches the exact key values from the
/// environment as well as any `sk-…`-shaped token. A built tree has no
/// `.gitignore` staging to lean on, so it is walked in full; binary, symlinked,
/// and unreadable entries are skipped (a key is pasted as text). Rewritten files
/// are logged.
fn scrub_build_dir(build_dir: &Path) -> Result<()> {
    let scrubber = SecretScrubber::from_host_env();
    let mut redacted = Vec::new();
    scrub_dir_recursive(build_dir, &scrubber, &mut redacted)?;
    if !redacted.is_empty() {
        tracing::warn!(
            files = ?redacted,
            "redacted leaked API key(s) from a run's playable build before deploying it publicly"
        );
    }
    Ok(())
}

/// Recursively scrub every readable UTF-8 file under `dir` in place, appending
/// the path of each file actually rewritten to `redacted`. Directories are
/// descended; symlinks are not followed (so a link cannot redirect the walk out
/// of the build tree), and non-UTF-8 or unreadable files are left untouched.
fn scrub_dir_recursive(
    dir: &Path,
    scrubber: &SecretScrubber,
    redacted: &mut Vec<String>,
) -> Result<()> {
    let entries = std::fs::read_dir(dir)
        .map_err(|e| Error::Publish(format!("reading build directory {}: {e}", dir.display())))?;
    for entry in entries {
        let entry =
            entry.map_err(|e| Error::Publish(format!("reading a build directory entry: {e}")))?;
        let path = entry.path();
        // `file_type` does not follow symlinks, so a symlink is neither a file
        // nor a directory here and falls through untouched.
        let file_type = entry
            .file_type()
            .map_err(|e| Error::Publish(format!("inspecting {}: {e}", path.display())))?;
        if file_type.is_dir() {
            scrub_dir_recursive(&path, scrubber, redacted)?;
        } else if file_type.is_file() {
            let Ok(contents) = std::fs::read_to_string(&path) else {
                continue;
            };
            if let Cow::Owned(scrubbed) = scrubber.scrub(&contents) {
                std::fs::write(&path, scrubbed).map_err(|e| {
                    Error::Publish(format!(
                        "rewriting {} to redact a secret: {e}",
                        path.display()
                    ))
                })?;
                redacted.push(path.display().to_string());
            }
        }
    }
    Ok(())
}

/// A run record lives at `<run>/run-record.json`; its implementation is the
/// sibling `implementation/` directory the run collected.
pub fn implementation_dir(record_path: &Path) -> PathBuf {
    record_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("implementation")
}

#[cfg(test)]
#[path = "publish.test.rs"]
mod tests;
