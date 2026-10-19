//! Releasing a downloaded run: the GitHub-repo + Cloudflare Pages work.
//!
//! Given a run directory untarred from the artifact service
//! (`run-record.json` + `implementation/` + `events.jsonl`), this builds the
//! [`ReleaseRequest`] and drives the two release steps [`BackendPublisher`]
//! exposes in the order `components/backend/results.md` ("Publish") gives them:
//! [`release_playable_build`](crate::release::Publisher::release_playable_build)
//! (wrangler → a Pages deploy) first, then
//! [`release_code`](crate::release::Publisher::release_code)
//! (gh/git → a public per-run repo). It releases only: the link-attach + publish-flip are
//! the backend's job once it receives the terminal result, and the run record was
//! already stored by the driver when the run finished.
//!
//! Secret scrubbing is already inside both release steps (the `SecretScrubber`
//! redacts any leaked provider key from the staged tree and the built output before
//! egress), so this layer re-implements none of it.

use std::path::Path;

use test_cabinet_backend_client::HttpBackendClient;
use test_cabinet_contracts::layout::find_build_output;
use test_cabinet_contracts::run_record::RunRecord;
use test_cabinet_suites::execution::ArtifactCollection;

use crate::pages::PagesApi;
use crate::release::{
    BackendPublisher, CommandRunner, PublishConfig, Publisher, ReleaseRequest, SystemCommandRunner,
};

/// The links a successful release produced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleasedLinks {
    /// The public source-repo URL, or `None` for a run that releases no code (an
    /// asset-generation run creates no repository).
    pub source_repo: Option<String>,
    /// The deployed playable-build URL, or `None` when the run produced no build.
    pub playable_build: Option<String>,
}

/// A failure releasing a downloaded run.
#[derive(Debug, thiserror::Error)]
pub enum ReleaseError {
    /// The run record could not be read or parsed from the downloaded tree.
    #[error("reading the run record at `{path}`: {detail}")]
    Record {
        /// The `run-record.json` path that could not be loaded.
        path: String,
        /// Why it failed (an I/O or JSON-parse error).
        detail: String,
    },
    /// A release step (gh/git or wrangler) failed.
    #[error("releasing the run: {0}")]
    Publish(#[source] crate::Error),
}

/// Read and parse a run record from `run_dir/run-record.json`.
pub fn load_record(run_dir: &Path) -> Result<RunRecord, ReleaseError> {
    let path = run_dir.join("run-record.json");
    let bytes = std::fs::read(&path).map_err(|err| ReleaseError::Record {
        path: path.display().to_string(),
        detail: err.to_string(),
    })?;
    serde_json::from_slice(&bytes).map_err(|err| ReleaseError::Record {
        path: path.display().to_string(),
        detail: err.to_string(),
    })
}

/// A downloaded run made ready for its two release steps: its record loaded, its
/// build found and the [`BackendPublisher`] that releases it built. The publisher's
/// sequence runs [`PreparedRelease::deploy`] and then
/// [`PreparedRelease::publish_repository`] as two steps, so that it can stop
/// between them (see [`crate::sequence`]).
pub struct PreparedRelease<R: CommandRunner> {
    record: RunRecord,
    artifacts: ArtifactCollection,
    build_dir: Option<std::path::PathBuf>,
    publisher: BackendPublisher<R, HttpBackendClient>,
}

impl<R: CommandRunner> PreparedRelease<R> {
    /// Prepare the run downloaded and untarred under `run_dir`, using `runner` to
    /// drive `gh`/`git`/`wrangler` and `pages_api` to look the build's deployment
    /// up.
    ///
    /// A [`PublishConfig::from_env`] resolves the GitHub org + Pages project from
    /// the `TCAB_GITHUB_ORG`/`TCAB_PAGES_PROJECT` the Job forwards — both are
    /// required, so a publish Job that was not handed its targets fails here (as a
    /// [`ReleaseError::Publish`]) rather than releasing to a default org. The
    /// backend client is the type the publisher *must* supply to construct a
    /// [`BackendPublisher`], but `release_code`/`release_playable_build` never
    /// touch it, so a read-only [`HttpBackendClient`] (no token) satisfies the
    /// bound without being used.
    pub fn new(run_dir: &Path, runner: R, pages_api: PagesApi) -> Result<Self, ReleaseError> {
        let record = load_record(run_dir)?;
        // The collected implementation tree and the build directory found within it.
        let artifacts = ArtifactCollection::new(run_dir.join("implementation"));
        let build_dir = find_build_output(&artifacts.repo_path);
        let publisher = BackendPublisher::new(
            PublishConfig::from_env().map_err(ReleaseError::Publish)?,
            runner,
            // Never exercised: the publisher reports via the publish-job token, not
            // by POSTing `/runs`. The base URL is irrelevant for that reason.
            HttpBackendClient::new("http://publisher.invalid"),
        )
        .with_pages_api(pages_api);
        Ok(Self {
            record,
            artifacts,
            build_dir,
            publisher,
        })
    }

    /// The request both release steps take, borrowing the prepared inputs.
    fn request(&self) -> ReleaseRequest<'_> {
        ReleaseRequest {
            record: &self.record,
            artifacts: &self.artifacts,
            build_dir: self.build_dir.as_deref(),
        }
    }

    /// The Pages deploy: deploy (or reuse the deployment of) the run's playable
    /// build, returning its URL, or `None` when the run has no build to deploy.
    pub async fn deploy(&self) -> Result<Option<String>, ReleaseError> {
        self.publisher
            .release_playable_build(&self.request())
            .await
            .map_err(ReleaseError::Publish)
    }

    /// The repository publish: publish the run's implementation to its public
    /// repository, returning the repository URL, or `None` for a run that
    /// releases no code.
    pub async fn publish_repository(&self) -> Result<Option<String>, ReleaseError> {
        self.publisher
            .release_code(&self.request())
            .await
            .map_err(ReleaseError::Publish)
    }
}

impl PreparedRelease<SystemCommandRunner> {
    /// Prepare a downloaded run with the real [`SystemCommandRunner`] (`gh`/`git`/
    /// `wrangler` as subprocesses) and the Cloudflare API the Job's
    /// `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN` authenticate to (see
    /// [`PagesApi::from_env`]).
    pub fn from_env(run_dir: &Path) -> Result<Self, ReleaseError> {
        let pages_api = PagesApi::from_env().map_err(ReleaseError::Publish)?;
        Self::new(run_dir, SystemCommandRunner, pages_api)
    }
}

/// Release a run that has already been downloaded and untarred under `run_dir`,
/// using `runner` to drive `gh`/`git`/`wrangler` and `pages_api` to look the
/// build's deployment up: the Pages deploy, then the repository publish, the order
/// `components/backend/results.md` ("Publish") gives the publisher's steps.
///
/// The publisher's sequence runs the two steps itself (see
/// [`crate::sequence`]); this runs them back to back. See
/// [`PreparedRelease::new`] for what is resolved before either step runs.
pub async fn release_with_runner<R: CommandRunner>(
    run_dir: &Path,
    runner: R,
    pages_api: PagesApi,
) -> Result<ReleasedLinks, ReleaseError> {
    let prepared = PreparedRelease::new(run_dir, runner, pages_api)?;
    let playable_build = prepared.deploy().await?;
    let source_repo = prepared.publish_repository().await?;
    Ok(ReleasedLinks {
        source_repo,
        playable_build,
    })
}

#[cfg(test)]
#[path = "publish.test.rs"]
mod tests;
