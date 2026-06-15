//! Publishing: releasing a finished run's outputs.
//!
//! See `docs/results.md`. Publishing is an explicit operation that releases the
//! generated code to a public repository, makes the playable build available for
//! embedding, and adds the run record to the site's dataset. It must be
//! idempotent and usable in batch.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::execution::ArtifactCollection;
use crate::review::Writeup;
use crate::run_record::{RunLinks, RunRecord};

/// A request to publish a single finished run.
#[derive(Debug, Clone, PartialEq)]
pub struct PublishRequest<'a> {
    /// The run record describing the run.
    pub record: &'a RunRecord,
    /// The collected implementation to release.
    pub artifacts: &'a ArtifactCollection,
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
    /// URL of the playable build made available for embedding.
    pub playable_build: String,
    /// Whether this publish actually changed anything, or was a no-op because the
    /// run was already published (publishing is idempotent).
    pub newly_published: bool,
}

/// Publishes finished runs.
///
/// Every operation must be idempotent so a sweep producing many runs can be
/// published repeatedly without manual handling of each one.
#[async_trait::async_trait]
pub trait Publisher: Send + Sync {
    /// Release the run's generated code to its own public repository.
    async fn release_code(&self, request: &PublishRequest<'_>) -> Result<String>;

    /// Make the run's playable build available for embedding.
    async fn release_playable_build(&self, request: &PublishRequest<'_>) -> Result<String>;

    /// Append the run record to the site's dataset.
    async fn append_run_record(&self, record: &RunRecord) -> Result<()>;

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
        Err(crate::error::Error::Publish(
            "publishing is not configured".to_string(),
        ))
    }

    async fn release_playable_build(&self, _request: &PublishRequest<'_>) -> Result<String> {
        Err(crate::error::Error::Publish(
            "publishing is not configured".to_string(),
        ))
    }

    async fn append_run_record(&self, _record: &RunRecord) -> Result<()> {
        Err(crate::error::Error::Publish(
            "publishing is not configured".to_string(),
        ))
    }

    async fn publish(&self, _request: &PublishRequest<'_>) -> Result<PublishOutcome> {
        Err(crate::error::Error::Publish(
            "publishing is not configured".to_string(),
        ))
    }
}

/// Where and how published artifacts are hosted.
///
/// The defaults describe The Test Cabinet's canonical deployment (see
/// `DEVELOPMENT.md#publishing-runs`): per-run repositories under the
/// `TheClockwyrks` org, builds served from `<slug>.testcabinet.ai`, and the
/// gallery dataset at `apps/site/src/data/runs.json`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublishConfig {
    /// GitHub organization that owns the per-run repositories.
    pub github_org: String,
    /// Project domain under which per-run builds are served as subdomains.
    pub domain: String,
    /// Prefix applied to per-run repository names so they namespace cleanly in a
    /// shared organization.
    pub repo_prefix: String,
    /// Path to the gallery dataset that published records are appended to.
    pub dataset_path: PathBuf,
    /// Directory the site loads run writeups from, where each run's review is
    /// written as `<run-id>.md` alongside the dataset.
    pub writeups_dir: PathBuf,
    /// Working tree the dataset lives in, where its update is committed locally.
    pub site_repo_root: PathBuf,
}

impl Default for PublishConfig {
    fn default() -> Self {
        Self {
            github_org: "TheClockwyrks".to_string(),
            domain: "testcabinet.ai".to_string(),
            repo_prefix: "tcab-".to_string(),
            dataset_path: PathBuf::from("apps/site/src/data/runs.json"),
            writeups_dir: PathBuf::from("apps/site/src/data/writeups"),
            site_repo_root: PathBuf::from("."),
        }
    }
}

impl PublishConfig {
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

    /// The fully qualified domain the build is served at, for example
    /// `pong-codex-gpt-5-4-mini-d483a2f9.testcabinet.ai`.
    pub fn build_fqdn(&self, record: &RunRecord) -> String {
        format!("{}.{}", subdomain_label(&run_slug(record)), self.domain)
    }

    /// The URL the published build is embedded from.
    pub fn build_url(&self, record: &RunRecord) -> String {
        format!("https://{}/", self.build_fqdn(record))
    }

    /// Where a run's writeup is written in the site, keyed by run id so the
    /// gallery can pair it with the record.
    pub fn writeup_path(&self, record: &RunRecord) -> PathBuf {
        self.writeups_dir.join(format!("{}.md", record.id))
    }
}

/// Derive a run's stable, hosting-safe slug from its subject and id.
///
/// The slug is `<test-case>-<harness>-<model>-<short-id>` reduced to lowercase
/// `[a-z0-9-]`, which keeps a shared GitHub org browsable while staying unique
/// (via the short run-id suffix) and valid as a DNS label.
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

/// The DNS label for a build subdomain: the slug, capped at the 63-character
/// label limit and trimmed of any trailing hyphen the cap might expose.
fn subdomain_label(slug: &str) -> String {
    let capped: String = slug.chars().take(63).collect();
    capped.trim_end_matches('-').to_string()
}

/// The manual-trigger GitHub Pages deploy workflow seeded into each per-run
/// repository. `__FQDN__` is replaced with the build's custom domain. It is
/// `workflow_dispatch`-only so publishing a run stages the repository without
/// anything going live until the deploy is triggered by hand.
const DEPLOY_WORKFLOW_TEMPLATE: &str = r#"name: Deploy build

# Builds this implementation and deploys it to GitHub Pages at its custom
# subdomain. Manual-trigger only: nothing goes live until this is run by hand.
on:
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: |
          if [ -f package-lock.json ]; then npm ci; else npm install; fi
      - run: npm run build
      # The implementation may build to dist/, build/, or out/ (matching the
      # harness's load check); find which and deploy that.
      - id: outdir
        run: |
          for d in dist build out; do
            if [ -d "$d" ]; then echo "dir=$d" >> "$GITHUB_OUTPUT"; exit 0; fi
          done
          echo "no build output (dist/build/out) found" >&2
          exit 1
      - run: echo "__FQDN__" > "${{ steps.outdir.outputs.dir }}/CNAME"
      - uses: actions/upload-pages-artifact@v3
        with:
          path: ${{ steps.outdir.outputs.dir }}

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
"#;

/// The per-run deploy workflow with its build domain baked in.
pub fn deploy_workflow_yaml(fqdn: &str) -> String {
    DEPLOY_WORKFLOW_TEMPLATE.replace("__FQDN__", fqdn)
}

/// Append a record to the gallery dataset, idempotently.
///
/// Returns `true` if the record was added and `false` if a record with the same
/// id was already present (so a re-publish is a no-op). The dataset is a JSON
/// array of run records; a missing or empty file is treated as an empty array.
pub fn append_record_to_dataset(path: &Path, record: &RunRecord) -> Result<bool> {
    let mut records: Vec<RunRecord> = match std::fs::read_to_string(path) {
        Ok(text) if text.trim().is_empty() => Vec::new(),
        Ok(text) => serde_json::from_str(&text)?,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(err) => return Err(Error::Io(err)),
    };

    if records.iter().any(|existing| existing.id == record.id) {
        return Ok(false);
    }

    records.push(record.clone());
    let json = serde_json::to_string_pretty(&records)?;
    std::fs::write(path, format!("{json}\n"))?;
    Ok(true)
}

/// Write a run's writeup to the site, in canonical form, creating the writeups
/// directory if needed. Overwriting is intentional: re-publishing refreshes the
/// file from the current review, keeping the operation idempotent.
pub fn write_writeup(path: &Path, writeup: &Writeup) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, writeup.to_file_string())?;
    Ok(())
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

/// Runs external commands (`gh`, `git`, ...) on behalf of a publisher.
///
/// Abstracting process execution behind a trait keeps the publish orchestration
/// testable without touching the network or a real GitHub.
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

/// Publishes runs to GitHub: a private per-run repository with a manual-trigger
/// Pages deploy, plus a local-only update to the gallery dataset.
///
/// Publishing stages everything without making anything public: the repository
/// is private, its build deploys only when the workflow is triggered by hand,
/// and the dataset change is committed but not pushed. See
/// `DEVELOPMENT.md#publishing-runs`.
pub struct GitHubPublisher<R: CommandRunner> {
    config: PublishConfig,
    runner: R,
}

impl<R: CommandRunner> GitHubPublisher<R> {
    /// Construct a publisher with the given hosting configuration and runner.
    pub fn new(config: PublishConfig, runner: R) -> Self {
        Self { config, runner }
    }

    /// The hosting configuration this publisher uses.
    pub fn config(&self) -> &PublishConfig {
        &self.config
    }

    /// The command runner this publisher drives external tools through.
    pub fn runner(&self) -> &R {
        &self.runner
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
impl<R: CommandRunner> Publisher for GitHubPublisher<R> {
    async fn release_code(&self, request: &PublishRequest<'_>) -> Result<String> {
        let record = request.record;
        let impl_dir = request.artifacts.repo_path.as_path();
        let qualified = self.config.repo_qualified(record);

        // Seed the manual-trigger deploy workflow into the implementation and
        // commit it so the pushed repository can publish its build on demand.
        let workflow_dir = impl_dir.join(".github").join("workflows");
        std::fs::create_dir_all(&workflow_dir)?;
        std::fs::write(
            workflow_dir.join("deploy.yml"),
            deploy_workflow_yaml(&self.config.build_fqdn(record)),
        )?;
        self.require("git", &["add", "-A"], Some(impl_dir)).await?;
        self.require(
            "git",
            &[
                "commit",
                "--allow-empty",
                "-m",
                "Add manual GitHub Pages deploy workflow",
            ],
            Some(impl_dir),
        )
        .await?;

        // Idempotent: if the repository already exists, leave it in place. A
        // fresh publish creates it private and pushes the implementation.
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
                    "repo",
                    "create",
                    &qualified,
                    "--private",
                    "--source",
                    source,
                    "--push",
                ],
                None,
            )
            .await?;
        }

        Ok(self.config.repo_url(record))
    }

    async fn release_playable_build(&self, request: &PublishRequest<'_>) -> Result<String> {
        // The build is deployed by the per-run repository's manual-trigger
        // workflow, not here. Report the URL it will be served at once that
        // workflow is run by hand.
        Ok(self.config.build_url(request.record))
    }

    async fn append_run_record(&self, record: &RunRecord) -> Result<()> {
        append_record_to_dataset(&self.config.dataset_path, record)?;
        Ok(())
    }

    async fn publish(&self, request: &PublishRequest<'_>) -> Result<PublishOutcome> {
        let source_repo = self.release_code(request).await?;
        let playable_build = self.release_playable_build(request).await?;

        // Record the produced links on the run record before it enters the
        // dataset the gallery is built from.
        let mut record = request.record.clone();
        record.links = RunLinks {
            source_repo: Some(source_repo.clone()),
            playable_build: Some(playable_build.clone()),
        };

        // The writeup is published into the site alongside the record, where the
        // gallery loads it (and its rating) at build time. Written before the
        // dataset append so both land in the same commit.
        let writeup_path = self.config.writeup_path(&record);
        write_writeup(&writeup_path, request.writeup)?;

        let newly_published = append_record_to_dataset(&self.config.dataset_path, &record)?;
        if newly_published {
            // Commit the dataset change and the writeup locally; pushing it (which
            // redeploys the gallery) is deliberately left to the user.
            let dataset = self
                .config
                .dataset_path
                .to_str()
                .ok_or_else(|| Error::Publish("dataset path is not valid UTF-8".to_string()))?;
            let writeup = writeup_path
                .to_str()
                .ok_or_else(|| Error::Publish("writeup path is not valid UTF-8".to_string()))?;
            let root = self.config.site_repo_root.as_path();
            self.require("git", &["add", dataset, writeup], Some(root))
                .await?;
            self.require(
                "git",
                &["commit", "-m", &format!("Publish run {}", record.id)],
                Some(root),
            )
            .await?;
        }

        Ok(PublishOutcome {
            source_repo,
            playable_build,
            newly_published,
        })
    }
}

#[cfg(test)]
#[path = "publish.test.rs"]
mod tests;
