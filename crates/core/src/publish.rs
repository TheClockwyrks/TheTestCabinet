//! Publishing: releasing a finished run's outputs.
//!
//! See `core/results.md` and `design/v0.2.0-contracts.md` §1.4. Publishing is an
//! explicit operation that releases the generated code to its own public GitHub
//! repository, deploys the playable build to Cloudflare Pages, and submits the
//! run record + review + resolved links to the [backend](crate::backend_client),
//! which is the system of record. It must be idempotent and usable in batch.
//!
//! This replaces the v0.1 "git-as-a-db" model (appending the record into the
//! site's dataset and deploying the build through a per-run GitHub Pages
//! workflow): the dataset is gone (the backend exports the site's snapshot), and
//! the build deploys to Cloudflare Pages directly — capturing the URL `wrangler`
//! reports rather than constructing one.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::backend_client::BackendClient;
use crate::error::{Error, Result};
use crate::execution::ArtifactCollection;
use crate::review::Writeup;
use crate::run_record::{RunLinks, RunRecord};

/// A request to publish a single finished run.
#[derive(Debug, Clone, PartialEq)]
pub struct PublishRequest<'a> {
    /// The run record describing the run.
    pub record: &'a RunRecord,
    /// The collected implementation to release as the run's public source repo.
    pub artifacts: &'a ArtifactCollection,
    /// The produced static build directory to deploy to Cloudflare Pages, when
    /// one is available. `None` skips the build deploy and leaves the playable
    /// build link unset, so a record can still be released and recorded without a
    /// build (for example a failed run whose source is still worth publishing).
    pub build_dir: Option<&'a Path>,
    /// The run's hand-written review. Publishing requires one, so it is carried
    /// by value here rather than left optional — a run without a writeup and
    /// rating is refused before a request is ever built (see `tcab publish`).
    pub writeup: &'a Writeup,
}

/// The result of publishing a run, with the links produced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishOutcome {
    /// URL of the public repository holding the released source.
    pub source_repo: String,
    /// URL of the playable build made available for embedding, when one was
    /// deployed. `None` when the request carried no build directory.
    pub playable_build: Option<String>,
    /// Whether this publish actually changed anything on the backend, or was a
    /// no-op because the run was already recorded (publishing is idempotent).
    pub newly_published: bool,
}

/// Publishes finished runs.
///
/// Every operation must be idempotent so a sweep producing many runs can be
/// published repeatedly without manual handling of each one.
#[async_trait::async_trait]
pub trait Publisher: Send + Sync {
    /// Release the run's generated code to its own public repository, returning
    /// the repository URL.
    async fn release_code(&self, request: &PublishRequest<'_>) -> Result<String>;

    /// Deploy the run's playable build, returning the URL it is served at, or
    /// `None` when the request carried no build directory.
    async fn release_playable_build(&self, request: &PublishRequest<'_>) -> Result<Option<String>>;

    /// Submit the run record, review, and resolved links to the backend (the
    /// system of record). Idempotent on `record.id`; returns whether the run was
    /// newly recorded.
    async fn submit_run(
        &self,
        record: &RunRecord,
        writeup: &Writeup,
        links: &RunLinks,
    ) -> Result<bool>;

    /// Publish a single run end to end. Idempotent.
    async fn publish(&self, request: &PublishRequest<'_>) -> Result<PublishOutcome>;

    /// Publish many runs in batch. Idempotent for each entry.
    async fn publish_batch(&self, requests: &[PublishRequest<'_>]) -> Result<Vec<PublishOutcome>> {
        let mut outcomes = Vec::with_capacity(requests.len());
        for request in requests {
            outcomes.push(self.publish(request).await?);
        }
        Ok(outcomes)
    }
}

/// A publisher that refuses to publish.
///
/// Publishing releases generated code to public repositories and is a distinct,
/// explicit operation from running a test case. This stand-in lets a run-only
/// [`crate::Orchestrator`] be constructed without wiring real publishing; any
/// attempt to publish through it returns a clear error.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoopPublisher;

#[async_trait::async_trait]
impl Publisher for NoopPublisher {
    async fn release_code(&self, _request: &PublishRequest<'_>) -> Result<String> {
        Err(Error::Publish("publishing is not configured".to_string()))
    }

    async fn release_playable_build(
        &self,
        _request: &PublishRequest<'_>,
    ) -> Result<Option<String>> {
        Err(Error::Publish("publishing is not configured".to_string()))
    }

    async fn submit_run(
        &self,
        _record: &RunRecord,
        _writeup: &Writeup,
        _links: &RunLinks,
    ) -> Result<bool> {
        Err(Error::Publish("publishing is not configured".to_string()))
    }

    async fn publish(&self, _request: &PublishRequest<'_>) -> Result<PublishOutcome> {
        Err(Error::Publish("publishing is not configured".to_string()))
    }
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
}

#[async_trait::async_trait]
impl<R: CommandRunner, B: BackendClient> Publisher for BackendPublisher<R, B> {
    async fn release_code(&self, request: &PublishRequest<'_>) -> Result<String> {
        let record = request.record;
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
            self.require(
                "gh",
                &[
                    "repo", "create", &qualified, "--public", "--source", source, "--push",
                ],
                None,
            )
            .await?;
        }

        Ok(self.config.repo_url(record))
    }

    async fn release_playable_build(&self, request: &PublishRequest<'_>) -> Result<Option<String>> {
        let Some(build_dir) = request.build_dir else {
            return Ok(None);
        };
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

    async fn submit_run(
        &self,
        record: &RunRecord,
        writeup: &Writeup,
        links: &RunLinks,
    ) -> Result<bool> {
        let ack = self.backend.publish_run(record, writeup, links).await?;
        Ok(ack.newly_published)
    }

    async fn publish(&self, request: &PublishRequest<'_>) -> Result<PublishOutcome> {
        let source_repo = self.release_code(request).await?;
        let playable_build = self.release_playable_build(request).await?;

        // Record the produced links on the run record before submitting it; the
        // backend writes them onto the stored record and exports them into the
        // site snapshot.
        let links = RunLinks {
            source_repo: Some(source_repo.clone()),
            playable_build: playable_build.clone(),
        };
        let mut record = request.record.clone();
        record.links = links.clone();

        let newly_published = self.submit_run(&record, request.writeup, &links).await?;

        Ok(PublishOutcome {
            source_repo,
            playable_build,
            newly_published,
        })
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
