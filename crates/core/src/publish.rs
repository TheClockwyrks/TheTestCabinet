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
use crate::event::HarnessEvent;
use crate::execution::ArtifactCollection;
use crate::run_record::{RunLinks, RunRecord};

/// A request to push a single finished run: release its source + build and store
/// the record on the backend, **without** a review. The review and the publish
/// gate are separate steps (`POST /runs/{id}/reviews` and `/publish`).
#[derive(Debug, Clone, PartialEq)]
pub struct PushRequest<'a> {
    /// The run record describing the run.
    pub record: &'a RunRecord,
    /// The collected implementation to release as the run's public source repo.
    pub artifacts: &'a ArtifactCollection,
    /// The produced static build directory to deploy to Cloudflare Pages, when
    /// one is available. `None` skips the build deploy and leaves the playable
    /// build link unset, so a record can still be released and recorded without a
    /// build (for example a failed run whose source is still worth publishing).
    pub build_dir: Option<&'a Path>,
    /// The run's recorded normalized event stream (`events.jsonl`), submitted to
    /// the backend so it can be shown on the published run's Events tab. Empty
    /// when the run recorded no events or its log is unavailable; the raw harness
    /// output is deliberately NOT published (it stays on the producing host).
    /// Build one with [`read_event_log`].
    pub events: &'a [HarnessEvent],
}

/// Read a finished run's recorded normalized event log (`events.jsonl`) from its
/// run directory, for inclusion in a publish.
///
/// Best-effort: a missing log yields an empty vec, and individual unparsable
/// lines are skipped — a run with no (or a partial) event log still publishes.
/// The run directory is the one holding `run-record.json`, `events.jsonl`, and
/// the `implementation/` tree.
pub fn read_event_log(run_dir: &Path) -> Vec<HarnessEvent> {
    let Ok(text) = std::fs::read_to_string(run_dir.join("events.jsonl")) else {
        return Vec::new();
    };
    text.lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| serde_json::from_str::<HarnessEvent>(line).ok())
        .collect()
}

/// The result of pushing a run, with the links produced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushOutcome {
    /// URL of the public repository holding the released source.
    pub source_repo: String,
    /// URL of the playable build made available for embedding, when one was
    /// deployed. `None` when the request carried no build directory.
    pub playable_build: Option<String>,
    /// Whether this push newly stored the run on the backend, or was a no-op
    /// because it was already recorded (pushing is idempotent).
    pub newly_pushed: bool,
}

/// Pushes finished runs: releases the source + build and stores the record on the
/// backend (unpublished). Reviewing and the publish gate are separate backend
/// calls ([`BackendClient::submit_review`] / [`BackendClient::publish_run`]).
///
/// Every operation must be idempotent so a sweep producing many runs can be
/// pushed repeatedly without manual handling of each one.
#[async_trait::async_trait]
pub trait Publisher: Send + Sync {
    /// Release the run's generated code to its own public repository, returning
    /// the repository URL.
    async fn release_code(&self, request: &PushRequest<'_>) -> Result<String>;

    /// Deploy the run's playable build, returning the URL it is served at, or
    /// `None` when the request carried no build directory.
    async fn release_playable_build(&self, request: &PushRequest<'_>) -> Result<Option<String>>;

    /// Submit the run record, resolved links, and recorded event stream to the
    /// backend (the system of record) — **without** a review. Idempotent on
    /// `record.id`; returns whether the run was newly stored.
    async fn push_run(
        &self,
        record: &RunRecord,
        links: &RunLinks,
        events: &[HarnessEvent],
    ) -> Result<bool>;

    /// Push a single run end to end (release + store). Idempotent.
    async fn push(&self, request: &PushRequest<'_>) -> Result<PushOutcome>;

    /// Push many runs in batch. Idempotent for each entry.
    async fn push_batch(&self, requests: &[PushRequest<'_>]) -> Result<Vec<PushOutcome>> {
        let mut outcomes = Vec::with_capacity(requests.len());
        for request in requests {
            outcomes.push(self.push(request).await?);
        }
        Ok(outcomes)
    }
}

/// A publisher that refuses to publish.
///
/// Publishing releases generated code to public repositories and is a distinct,
/// explicit operation from running a test case. This stand-in lets a run-only
/// [`crate::RunEngine`] be constructed without wiring real publishing; any
/// attempt to publish through it returns a clear error.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoopPublisher;

#[async_trait::async_trait]
impl Publisher for NoopPublisher {
    async fn release_code(&self, _request: &PushRequest<'_>) -> Result<String> {
        Err(Error::Publish("publishing is not configured".to_string()))
    }

    async fn release_playable_build(&self, _request: &PushRequest<'_>) -> Result<Option<String>> {
        Err(Error::Publish("publishing is not configured".to_string()))
    }

    async fn push_run(
        &self,
        _record: &RunRecord,
        _links: &RunLinks,
        _events: &[HarnessEvent],
    ) -> Result<bool> {
        Err(Error::Publish("publishing is not configured".to_string()))
    }

    async fn push(&self, _request: &PushRequest<'_>) -> Result<PushOutcome> {
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
}

#[async_trait::async_trait]
impl<R: CommandRunner, B: BackendClient> Publisher for BackendPublisher<R, B> {
    async fn release_code(&self, request: &PushRequest<'_>) -> Result<String> {
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

        Ok(self.config.repo_url(record))
    }

    async fn release_playable_build(&self, request: &PushRequest<'_>) -> Result<Option<String>> {
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

    async fn push_run(
        &self,
        record: &RunRecord,
        links: &RunLinks,
        events: &[HarnessEvent],
    ) -> Result<bool> {
        let ack = self.backend.push_run(record, links, events).await?;
        Ok(ack.newly_pushed)
    }

    async fn push(&self, request: &PushRequest<'_>) -> Result<PushOutcome> {
        let source_repo = self.release_code(request).await?;
        let playable_build = self.release_playable_build(request).await?;

        // Record the produced links on the run record before storing it; the
        // backend writes them onto the stored record and exports them into the
        // site snapshot once the run is published.
        let links = RunLinks {
            source_repo: Some(source_repo.clone()),
            playable_build: playable_build.clone(),
        };
        let mut record = request.record.clone();
        record.links = links.clone();

        let newly_pushed = self.push_run(&record, &links, request.events).await?;

        // Upload each produced proof-of-implementation file so the backend can
        // serve it back as the reviewer's submitted-evidence pane. Proofs live in
        // the collected implementation tree at their recorded `dest`; a missing or
        // unreadable one is skipped (its validation result already records the gap).
        self.upload_proofs(&record, request.artifacts).await?;

        // For an asset-generation run, upload the regenerated image, the final
        // preview, the target, and the action log so the gallery's result view can
        // show them once the run is published (the same artifacts the worker/desktop
        // serve locally before publish).
        self.upload_assets(&record, request.artifacts).await?;

        // For an adversarial run, upload the proof replays and the controller wasm
        // so a pushed run can be watched and pitted in the arena from any host
        // (the worker/desktop serve these locally before push).
        self.upload_adversarial(&record, request.artifacts).await?;

        Ok(PushOutcome {
            source_repo,
            playable_build,
            newly_pushed,
        })
    }
}

impl<R: CommandRunner, B: BackendClient> BackendPublisher<R, B> {
    /// Upload the run's present proof media to the backend, keyed by run id. Each
    /// proof file is named `<proof-id>.<ext>` (the extension taken from its
    /// recorded `dest`).
    async fn upload_proofs(
        &self,
        record: &RunRecord,
        artifacts: &ArtifactCollection,
    ) -> Result<()> {
        for proof in &record.validation.proofs {
            if !proof.present {
                continue;
            }
            let path = artifacts.repo_path.join(&proof.dest);
            let Ok(bytes) = std::fs::read(&path) else {
                continue;
            };
            let extension = Path::new(&proof.dest)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("png");
            let file = format!("{}.{}", proof.id, extension);
            self.backend
                .publish_run_proof(&record.id, &file, bytes)
                .await?;
        }
        Ok(())
    }

    /// Upload an adversarial run's artifacts to the backend, keyed by run id: every
    /// proof replay (under its run-root-relative filename, served back through the
    /// same `/asset/{file}` plumbing the asset media use) and the produced
    /// controller wasm (so a pushed implementation is resolvable and pittable in
    /// the arena from any host). A no-op for any non-adversarial run.
    async fn upload_adversarial(
        &self,
        record: &RunRecord,
        artifacts: &ArtifactCollection,
    ) -> Result<()> {
        let Some(adversarial) = &record.validation.adversarial else {
            return Ok(());
        };
        // Each opponent's replay is served back by its own filename
        // (`replay.json`, `replay-1.json`, …), matching `playable::serve_asset_file`.
        for replay in &adversarial.replays {
            let path = artifacts.repo_path.join(&replay.replay_json);
            let Ok(bytes) = std::fs::read(&path) else {
                continue;
            };
            self.backend
                .publish_run_asset(&record.id, &replay.replay_json, bytes)
                .await?;
        }
        // The controller wasm, when the build produced one (a forfeit-before-load
        // run records an empty path and has nothing to upload).
        if !adversarial.controller_module.is_empty() {
            let path = artifacts.repo_path.join(&adversarial.controller_module);
            if let Ok(bytes) = std::fs::read(&path) {
                self.backend
                    .publish_run_controller(&record.id, bytes)
                    .await?;
            }
        }
        Ok(())
    }

    /// Upload an asset-generation run's media to the backend, keyed by run id: for
    /// each frame, the regenerated image, the model's final preview, and the
    /// action log. Each is read from the collected implementation tree at its
    /// recorded path and uploaded under the stable logical name the result view
    /// requests — `regenerated.png`/`preview.png`/`actions.json` for a single
    /// sprite (its one frame), and the per-frame `regenerated-<index>.png` (etc.)
    /// for a sprite sheet. A no-op for any non-asset-generation run.
    async fn upload_assets(
        &self,
        record: &RunRecord,
        artifacts: &ArtifactCollection,
    ) -> Result<()> {
        let Some(asset) = &record.validation.asset else {
            return Ok(());
        };
        let is_sheet = asset.sheet.is_some();
        for frame in &asset.frames {
            // A single sprite serves under bare names; a sheet suffixes each frame
            // with `-<index>`, matching `playable::serve_asset_file`.
            let suffix = if is_sheet {
                format!("-{}", frame.index)
            } else {
                String::new()
            };
            let files = [
                (format!("regenerated{suffix}.png"), &frame.regenerated_image),
                (format!("preview{suffix}.png"), &frame.preview_image),
                (format!("actions{suffix}.json"), &frame.actions_log),
            ];
            for (name, rel) in files {
                let path = artifacts.repo_path.join(rel);
                let Ok(bytes) = std::fs::read(&path) else {
                    continue;
                };
                self.backend
                    .publish_run_asset(&record.id, &name, bytes)
                    .await?;
            }
        }
        Ok(())
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
