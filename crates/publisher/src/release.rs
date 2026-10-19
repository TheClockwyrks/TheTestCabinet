//! Publishing: releasing a finished run's outputs.
//!
//! See `components/backend/results.md`. Publishing is an explicit operation that releases the
//! generated code to its own public GitHub repository and deploys the playable
//! build to Cloudflare Pages. It runs in the `tcab-publisher` Job when a run is
//! published; the run record itself is stored on the backend separately (by the
//! driver, when the run finishes). It must be idempotent.
//!
//! This replaces the v0.1 "git-as-a-db" model (appending the record into the
//! site's dataset and deploying the build through a per-run GitHub Pages
//! workflow): the dataset is gone (the backend exports the site's snapshot), and
//! the build deploys to Cloudflare Pages directly — capturing the URL `wrangler`
//! reports rather than constructing one, or reusing the deployment an earlier
//! attempt made of the same build (see [`crate::pages`]).

use std::borrow::Cow;
use std::path::{Path, PathBuf};
use std::time::Duration;

use test_cabinet_backend_client::BackendClient;
use test_cabinet_contracts::run_record::RunRecord;
use test_cabinet_contracts::test_case::TCAB_VENDOR_DIR;
use test_cabinet_redact::SecretScrubber;
use test_cabinet_suites::execution::ArtifactCollection;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::error::{Error, Result};
use crate::pages::{PagesApi, build_digest};
use crate::retry::{Backoff, retry};

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
    /// from `wrangler`'s output or the deployment the lookup finds, never
    /// constructed.
    pub pages_project: String,
    /// The base the implementation is pushed under: the push goes to
    /// `<git_remote_base>/<org>/<repo>.git`. It is GitHub
    /// ([`DEFAULT_GIT_REMOTE_BASE`]) in every deployment; tests point it at a
    /// directory of local bare repositories so the push and the tree comparison
    /// run against a real `git` remote. The public URL the run is linked to is
    /// always [`PublishConfig::repo_url`], whatever this holds.
    pub git_remote_base: String,
}

/// Where the per-run repositories are pushed to in every deployment.
pub const DEFAULT_GIT_REMOTE_BASE: &str = "https://github.com";

/// The message of the commit that carries the run's implementation. It is fixed,
/// and the same as the repos service's, so the commit is deterministic and a
/// repeat reproduces its SHA (see `components/repos/overview.md`, Publishing).
pub const PUBLISH_COMMIT_MESSAGE: &str = "Publish the run's implementation";

/// The author and committer name of the implementation commit.
const PUBLISH_IDENTITY_NAME: &str = "Clockwyrks";

/// The author and committer email of the implementation commit.
const PUBLISH_IDENTITY_EMAIL: &str = "runs@clockwyrks.invalid";

/// The fixed prefix applied to every per-run repository name. It is identical in
/// every deployment — only the org and Pages project differ between environments —
/// so it is a compiled-in constant rather than an environment-configurable value.
const REPO_PREFIX: &str = "tcab-";

impl PublishConfig {
    /// Resolve the publish configuration from the environment.
    ///
    /// `TCAB_GITHUB_ORG` (the GitHub org the per-run source repos are created
    /// under) and `TCAB_PAGES_PROJECT` (the Cloudflare Pages project the per-run
    /// builds deploy to) are **required** and have no compiled-in fallback: every
    /// deployment sets them explicitly in its dispatcher/publisher overlay, so a
    /// misconfigured environment fails loudly here instead of silently publishing
    /// into another environment's org and Pages project. A blank (or
    /// whitespace-only) value is treated as unset. The repo prefix is fixed and not
    /// env-configurable.
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            github_org: required_var("TCAB_GITHUB_ORG")?,
            repo_prefix: REPO_PREFIX.to_string(),
            pages_project: required_var("TCAB_PAGES_PROJECT")?,
            git_remote_base: DEFAULT_GIT_REMOTE_BASE.to_string(),
        })
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

    /// The git remote the implementation is pushed to:
    /// `<git_remote_base>/<org>/<repo>.git`.
    pub fn remote_url(&self, record: &RunRecord) -> String {
        format!(
            "{}/{}.git",
            self.git_remote_base.trim_end_matches('/'),
            self.repo_qualified(record)
        )
    }
}

/// The `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` of a record's RFC 3339
/// `finished_at`: seconds since the epoch at UTC (`<unix> +0000`, git's internal
/// format), so the commit's bytes depend on the instant alone. The repos service
/// derives the same value. A `finished_at` that does not parse fails the publish:
/// a date taken from anywhere else would make the commit differ between repeats.
pub fn commit_date(finished_at: &str) -> Result<String> {
    let at = OffsetDateTime::parse(finished_at, &Rfc3339).map_err(|_| {
        Error::Publish(format!(
            "the run's record has no usable end time `{finished_at}`"
        ))
    })?;
    Ok(format!("{} +0000", at.unix_timestamp()))
}

/// The `GIT_AUTHOR_*` and `GIT_COMMITTER_*` environment of the implementation
/// commit: the fixed identity, and both dates `date`.
fn commit_env(date: &str) -> [(&'static str, &str); 6] {
    [
        ("GIT_AUTHOR_NAME", PUBLISH_IDENTITY_NAME),
        ("GIT_AUTHOR_EMAIL", PUBLISH_IDENTITY_EMAIL),
        ("GIT_AUTHOR_DATE", date),
        ("GIT_COMMITTER_NAME", PUBLISH_IDENTITY_NAME),
        ("GIT_COMMITTER_EMAIL", PUBLISH_IDENTITY_EMAIL),
        ("GIT_COMMITTER_DATE", date),
    ]
}

/// Read a required publish-configuration variable, treating a blank (or
/// whitespace-only) value as unset and reporting a clear [`Error::Publish`] when it
/// is missing, so a half-configured deployment fails loudly rather than publishing
/// into a surprising org or Pages project.
fn required_var(key: &str) -> Result<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            Error::Publish(format!(
                "required publish configuration variable `{key}` is unset or empty"
            ))
        })
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

impl CommandOutput {
    /// Human-readable diagnostics for a failed command, drawn from *both*
    /// streams.
    ///
    /// The publish tools disagree about where failure output goes: `git` and
    /// `gh` write to stderr, but `wrangler` prints most of its diagnostics to
    /// stdout — so a stderr-only message renders empty exactly when a deploy
    /// fails and the operator most needs to see why. Surface whatever each
    /// stream carried, labelling them only when both are non-empty, and say so
    /// explicitly when a failing command produced nothing at all.
    fn failure_details(&self) -> String {
        let stdout = self.stdout.trim();
        let stderr = self.stderr.trim();
        match (stderr.is_empty(), stdout.is_empty()) {
            (true, true) => "(no output captured)".to_string(),
            (false, true) => stderr.to_string(),
            (true, false) => stdout.to_string(),
            (false, false) => format!("{stderr}\n{stdout}"),
        }
    }
}

/// Runs external commands (`gh`, `git`, `wrangler`, ...) on behalf of a
/// publisher.
///
/// Abstracting process execution behind a trait keeps the publish orchestration
/// testable without touching the network, a real GitHub, or Cloudflare.
#[async_trait::async_trait]
pub trait CommandRunner: Send + Sync {
    /// Run `program` with `args`, optionally in `cwd`, with the variables in `env`
    /// added to the inherited environment, and capture its output.
    async fn run_with_env(
        &self,
        program: &str,
        args: &[&str],
        cwd: Option<&Path>,
        env: &[(&str, &str)],
    ) -> Result<CommandOutput>;

    /// Run `program` with `args`, optionally in `cwd`, in the inherited
    /// environment, and capture its output.
    async fn run(&self, program: &str, args: &[&str], cwd: Option<&Path>) -> Result<CommandOutput> {
        self.run_with_env(program, args, cwd, &[]).await
    }
}

/// A [`CommandRunner`] that executes commands as real subprocesses.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemCommandRunner;

#[async_trait::async_trait]
impl CommandRunner for SystemCommandRunner {
    async fn run_with_env(
        &self,
        program: &str,
        args: &[&str],
        cwd: Option<&Path>,
        env: &[(&str, &str)],
    ) -> Result<CommandOutput> {
        let mut command = tokio::process::Command::new(program);
        command.args(args);
        command.envs(env.iter().copied());
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

/// The git credential helper the push and the fetch authenticate through: `gh`,
/// which reads `GH_TOKEN` itself.
const GH_CREDENTIAL_HELPER: &str = "credential.https://github.com.helper=!gh auth git-credential";

/// The pause after `gh repo create` before the first push to the new
/// repository.
///
/// `gh repo create` returns as soon as the repository object exists, but the
/// creator's write grant is not always live on the git backend replica that
/// serves the push a moment later — an immediate push can then be rejected with
/// a `403` ("Permission ... denied") even though the token is an org admin with
/// `repo` scope. The pause lets the grant propagate so the first push usually
/// lands; a push that still races it is retried with the publisher's backoff.
/// A re-publish of an existing repository needs no pause.
const CREATE_SETTLE: Duration = Duration::from_secs(3);

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
    /// How the repository publish and the Pages deploy retry a transient
    /// failure (see [`crate::retry`]).
    retry: Backoff,
    /// The pause after creating the repository before pushing to it (see
    /// [`CREATE_SETTLE`]).
    create_settle: Duration,
    /// The Cloudflare API the playable-build deploy looks its deployment up in
    /// (see [`deploy_pages_build`]). Without one, a run with a build to deploy
    /// fails rather than deploying without the lookup.
    pages_api: Option<PagesApi>,
}

impl<R: CommandRunner, B: BackendClient> BackendPublisher<R, B> {
    /// Construct a publisher with the given hosting configuration, command
    /// runner, and backend client.
    pub fn new(config: PublishConfig, runner: R, backend: B) -> Self {
        Self {
            config,
            runner,
            backend,
            retry: Backoff::default(),
            create_settle: CREATE_SETTLE,
            pages_api: None,
        }
    }

    /// Look the playable build's deployment up in `pages_api` before deploying
    /// it, so a repeated deploy reuses the deployment it already made.
    pub fn with_pages_api(mut self, pages_api: PagesApi) -> Self {
        self.pages_api = Some(pages_api);
        self
    }

    /// Retry the repository publish and the Pages deploy with `backoff` instead
    /// of [`Backoff::default`].
    pub fn with_backoff(mut self, backoff: Backoff) -> Self {
        self.retry = backoff;
        self
    }

    /// Override the pause after creating the repository. Used by tests so the
    /// create path never really sleeps.
    #[cfg(test)]
    fn with_create_settle(mut self, create_settle: Duration) -> Self {
        self.create_settle = create_settle;
        self
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
        self.require_with_env(program, args, cwd, &[]).await
    }

    /// Run a command with `env` added to its environment and fail unless it
    /// exits successfully.
    async fn require_with_env(
        &self,
        program: &str,
        args: &[&str],
        cwd: Option<&Path>,
        env: &[(&str, &str)],
    ) -> Result<CommandOutput> {
        let output = self.runner.run_with_env(program, args, cwd, env).await?;
        if !output.success {
            return Err(Error::Command(format!(
                "`{program} {}` failed: {}",
                args.join(" "),
                output.failure_details()
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
    /// The commit is deterministic (see `components/repos/overview.md`,
    /// Publishing): one commit is always made on top of the tree's tip, empty when
    /// the model changed nothing, with the fixed [`PUBLISH_COMMIT_MESSAGE`], the
    /// author and committer `Clockwyrks <runs@clockwyrks.invalid>` and both dates
    /// `date` (the run's end time, see [`commit_date`]). The identity and dates
    /// are given through the `GIT_AUTHOR_*`/`GIT_COMMITTER_*` environment, which
    /// outranks any configuration, and signing and hooks are off, so a repeat over
    /// the same downloaded tree reproduces the same SHA. A `git init` is run
    /// defensively for the unusual case of an implementation that arrived without
    /// a repo; its commit is then a root commit, as deterministic.
    async fn commit_implementation(&self, dir: &Path, date: &str) -> Result<()> {
        if !dir.join(".git").is_dir() {
            self.require(
                "git",
                &["init", "--quiet", "--initial-branch", "main"],
                Some(dir),
            )
            .await?;
        }
        self.require("git", &["add", "--all"], Some(dir)).await?;
        // A `packages`-declaring case vendors its runtime libraries under
        // `.vendor/packages/`, whose `dist/` subtrees the case's own `.gitignore`
        // excludes; force them in (as seeding's initial commit does) so a published
        // repo that the publisher re-inits, or whose vendored tree is otherwise
        // untracked, is still self-contained and installable. Already-tracked files
        // make this a no-op.
        if dir.join(TCAB_VENDOR_DIR).is_dir() {
            self.require("git", &["add", "--force", TCAB_VENDOR_DIR], Some(dir))
                .await?;
        }
        // Redact any leaked API key from the staged tree before it is committed
        // and pushed to the run's public repository: a model that dumped its
        // environment can have written its provider key into a source file.
        self.scrub_staged_secrets(dir).await?;
        self.require_with_env(
            "git",
            &[
                "-c",
                "commit.gpgSign=false",
                "commit",
                "--quiet",
                "--allow-empty",
                "--no-verify",
                "--message",
                PUBLISH_COMMIT_MESSAGE,
            ],
            Some(dir),
            &commit_env(date),
        )
        .await?;
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

    /// Make the run's public repository `qualified` exist and hold the
    /// committed implementation in `dir`, retrying a transient failure with the
    /// publisher's backoff (see [`crate::retry`]).
    ///
    /// Each attempt asks whether the repository exists, creates it public and
    /// empty when it does not (pausing [`CREATE_SETTLE`] for GitHub's
    /// permission-propagation lag), and pushes once (see [`Self::push_once`]).
    /// A failed `gh` or `git` run is transient; a remote whose `main` holds
    /// another tree is [`Error::Diverged`] and fails at once.
    async fn publish_repository(&self, dir: &Path, remote: &str, qualified: &str) -> Result<()> {
        self.ensure_origin(dir, remote).await?;
        let head_tree = self
            .require("git", &["rev-parse", "--verify", "HEAD^{tree}"], Some(dir))
            .await?
            .stdout
            .trim()
            .to_string();
        retry(&self.retry, "the repository publish", || {
            self.publish_repository_once(dir, qualified, &head_tree)
        })
        .await
    }

    /// One attempt of [`Self::publish_repository`].
    async fn publish_repository_once(
        &self,
        dir: &Path,
        qualified: &str,
        head_tree: &str,
    ) -> Result<()> {
        // Create and push are kept separate (rather than `gh repo create --push`)
        // so that a re-publish whose first push never landed — leaving the repo
        // created but empty — still pushes to recover, instead of
        // short-circuiting on the repo's mere existence.
        let exists = self
            .runner
            .run("gh", &["repo", "view", qualified], None)
            .await?
            .success;
        if !exists {
            self.require("gh", &["repo", "create", qualified, "--public"], None)
                .await?;
            if !self.create_settle.is_zero() {
                tokio::time::sleep(self.create_settle).await;
            }
        }
        self.push_once(dir, qualified, head_tree).await
    }

    /// Push the committed implementation in `dir` to `origin`'s `main` once.
    ///
    /// The push is a plain push of `main`. A refused push is not a failure by
    /// itself: the remote's `main` is fetched and its tree compared with
    /// `head_tree` (see `components/repos/overview.md`, Publishing). The same tree
    /// is a success whatever commit carries it, so a repeat after a push that
    /// landed succeeds; a different tree is [`Error::Diverged`], left as it is; a
    /// remote with no `main` yet, or one that cannot be fetched, is an
    /// [`Error::Command`], which the caller retries.
    ///
    /// The push and the fetch authenticate through `gh`'s git credential helper
    /// rather than a bare `git`: the publisher pod configures no git credential
    /// helper, so the token is only reachable via `gh auth git-credential` (which
    /// reads `GH_TOKEN` itself — this code never handles the token). A leading
    /// empty `credential.helper` resets any inherited helper so `gh`'s is the one
    /// used.
    async fn push_once(&self, dir: &Path, qualified: &str, head_tree: &str) -> Result<()> {
        let output = self
            .runner
            .run(
                "git",
                &[
                    "-c",
                    "credential.helper=",
                    "-c",
                    GH_CREDENTIAL_HELPER,
                    "push",
                    "--quiet",
                    "--set-upstream",
                    "origin",
                    "HEAD:refs/heads/main",
                ],
                Some(dir),
            )
            .await?;
        if output.success {
            return Ok(());
        }
        match self.remote_main_tree(dir).await? {
            Some(tree) if tree == head_tree => {
                tracing::info!(
                    repo = qualified,
                    "the repository's `main` already holds the run's implementation tree"
                );
                Ok(())
            }
            Some(_) => Err(Error::Diverged(qualified.to_string())),
            None => Err(Error::Command(format!(
                "pushing the implementation to {qualified} failed: {}",
                output.failure_details()
            ))),
        }
    }

    /// The tree the `origin` remote's `main` holds, or `None` when it has no
    /// `main` or cannot be fetched. Fetched into `FETCH_HEAD` only, authenticated
    /// as the push is.
    async fn remote_main_tree(&self, dir: &Path) -> Result<Option<String>> {
        let fetched = self
            .runner
            .run(
                "git",
                &[
                    "-c",
                    "credential.helper=",
                    "-c",
                    GH_CREDENTIAL_HELPER,
                    "fetch",
                    "--quiet",
                    "--no-tags",
                    "origin",
                    "refs/heads/main",
                ],
                Some(dir),
            )
            .await?;
        if !fetched.success {
            return Ok(None);
        }
        let tree = self
            .runner
            .run(
                "git",
                &["rev-parse", "--verify", "FETCH_HEAD^{tree}"],
                Some(dir),
            )
            .await?;
        let text = tree.stdout.trim();
        Ok((tree.success && !text.is_empty()).then(|| text.to_string()))
    }

    /// Point the implementation repo's `origin` at `url`, whether or not a
    /// remote is already configured, so the push has a destination. Idempotent.
    async fn ensure_origin(&self, dir: &Path, url: &str) -> Result<()> {
        let set = self
            .runner
            .run("git", &["remote", "set-url", "origin", url], Some(dir))
            .await?;
        if !set.success {
            self.require("git", &["remote", "add", "origin", url], Some(dir))
                .await?;
        }
        Ok(())
    }
}

#[async_trait::async_trait]
impl<R: CommandRunner, B: BackendClient> Publisher for BackendPublisher<R, B> {
    async fn release_code(&self, request: &ReleaseRequest<'_>) -> Result<Option<String>> {
        let record = request.record;

        // A harness-error run is recorded only as a per-model statistic — it produced
        // no evaluable output worth releasing, so nothing is committed or pushed and
        // the run carries no source link. (The other publishable failure tiers do
        // release their source; see `RunState::publishes_artifacts`.)
        if !record.status.state.publishes_artifacts() {
            return Ok(None);
        }

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
        // The commit's date is the run's end time; an unusable one fails before
        // anything is committed, created or pushed.
        let date = commit_date(&record.finished_at)?;

        // Commit the model's working tree first so the push carries the
        // implementation, not just the seed. The collected implementation is a
        // git repo seeded with a single "Seed test case" commit; the model's
        // actual work sits in the working tree, uncommitted. The commit is
        // deterministic, so a repeat over the same downloaded tree reproduces its
        // SHA. The seeded `.gitignore` keeps build artifacts such as `target/` out
        // of the push.
        self.commit_implementation(impl_dir, &date).await?;

        // Ensure the repository exists, creating it public and empty when it does
        // not, and push. The source is a public repository per `core/results.md`
        // (each run is released as its own public git repo so anyone can clone and
        // play it). The commit is deterministic and a remote already holding the
        // same tree is a success, so an already-complete repo re-publishes as a
        // clean no-op.
        self.publish_repository(impl_dir, &self.config.remote_url(record), &qualified)
            .await?;

        Ok(Some(self.config.repo_url(record)))
    }

    async fn release_playable_build(&self, request: &ReleaseRequest<'_>) -> Result<Option<String>> {
        // A harness-error run releases nothing (it is a per-model statistic only), so
        // no build is deployed even if a partial tree happened to build; see
        // `RunState::publishes_artifacts`.
        if !request.record.status.state.publishes_artifacts() {
            return Ok(None);
        }
        let Some(build_dir) = request.build_dir else {
            return Ok(None);
        };
        let pages_api = self.pages_api.as_ref().ok_or_else(|| {
            Error::Publish(
                "no Cloudflare API is configured to look the build's deployment up in".to_string(),
            )
        })?;
        // Deploy the already-built static output to Cloudflare Pages under a
        // per-run branch alias, redacting any leaked API key from the built tree
        // first (a key the model wrote into a source file can have been carried
        // through the build into an emitted asset). The branch alias is the run
        // id. A deployment of the same scrubbed build on that branch is reused,
        // so the run keeps one deployment however often the step repeats; see
        // [`deploy_pages_build`].
        let url = deploy_pages_build(
            &self.runner,
            pages_api,
            build_dir,
            &self.config.pages_project,
            &request.record.id,
            &self.retry,
        )
        .await?;
        Ok(Some(url))
    }
}

/// Deploy an already-built static `build_dir` to a Cloudflare Pages `project`
/// under `branch`, or find the deployment an earlier attempt made of the same
/// build, returning the URL it is served at.
///
/// This is the playable-build step of a publish (branch = the run id). It makes
/// one deployment per run, however often it is repeated (see
/// `components/backend/results.md`, "Repeating a step"). The steps, in order:
///
/// 1. **Redact.** `scrub_build_dir` rewrites any leaked provider API key out of
///    every text file under `build_dir` in place, so a key the model left in a
///    source file cannot ship to the public site through a built asset.
/// 2. **Digest.** [`build_digest`] hashes the scrubbed tree. The digest is the
///    deployment's commit hash, so a deployment records which build it serves.
/// 3. **Look up.** [`PagesApi::find_deployment`] searches the project for a
///    successful deployment on `branch` carrying the digest. One that exists is
///    reused: its URL is returned and nothing is deployed.
/// 4. **Deploy.** Otherwise `wrangler pages deploy <build_dir> --project-name
///    <project> --branch=<branch> --commit-hash=<digest>` is run through `runner`
///    (a [`SystemCommandRunner`] in production, a mock in tests). A non-zero exit
///    is surfaced with whatever wrangler wrote to *either* stream, since it prints
///    most diagnostics to stdout.
/// 5. **Read the URL back.** The deployed URL is parsed out of wrangler's output
///    ([`parse_wrangler_url`]) rather than constructed: Cloudflare sanitizes and
///    truncates long branch-alias subdomains, so `https://<branch>.<project>.pages.dev`
///    is *not* a reliable address. The URL wrangler reports is the deployment's
///    own (`https://<short id>.<project>.pages.dev`), the same URL the lookup
///    returns for it.
///
/// Steps 3 to 5 are retried together with `backoff` on a transient failure (see
/// [`crate::retry`]): a lookup that got no answer or a `408`/`429`/`5xx`, or a
/// failed `wrangler` run. Each retry looks again first, so a deploy that landed
/// before its run failed is found rather than repeated.
pub async fn deploy_pages_build(
    runner: &impl CommandRunner,
    pages_api: &PagesApi,
    build_dir: &Path,
    pages_project: &str,
    branch: &str,
    backoff: &Backoff,
) -> Result<String> {
    scrub_build_dir(build_dir)?;
    let digest = build_digest(build_dir)?;
    let dir = build_dir
        .to_str()
        .ok_or_else(|| Error::Publish("build directory path is not valid UTF-8".to_string()))?;
    retry(backoff, "the Pages deploy", || {
        find_or_deploy(runner, pages_api, dir, pages_project, branch, &digest)
    })
    .await
}

/// One attempt of [`deploy_pages_build`]'s lookup and deploy of the scrubbed
/// build at `dir`, whose digest is `digest`.
async fn find_or_deploy(
    runner: &impl CommandRunner,
    pages_api: &PagesApi,
    dir: &str,
    pages_project: &str,
    branch: &str,
    digest: &str,
) -> Result<String> {
    if let Some(url) = pages_api
        .find_deployment(pages_project, branch, digest)
        .await?
    {
        tracing::info!(%url, %branch, %digest, "reusing the build's existing Pages deployment");
        return Ok(url);
    }
    let branch_arg = format!("--branch={branch}");
    let commit_hash_arg = format!("--commit-hash={digest}");
    let output = runner
        .run(
            "wrangler",
            &[
                "pages",
                "deploy",
                dir,
                "--project-name",
                pages_project,
                &branch_arg,
                &commit_hash_arg,
            ],
            None,
        )
        .await?;
    if !output.success {
        return Err(Error::Command(format!(
            "`wrangler pages deploy` failed: {}",
            output.failure_details()
        )));
    }
    parse_wrangler_url(&output.stdout)
        .or_else(|| parse_wrangler_url(&output.stderr))
        .ok_or_else(|| {
            Error::Publish(
                "could not find a deployment URL in `wrangler pages deploy` output".to_string(),
            )
        })
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
#[path = "release.test.rs"]
mod tests;

#[cfg(test)]
#[path = "release.git.test.rs"]
mod git_tests;
