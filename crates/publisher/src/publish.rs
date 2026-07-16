//! Releasing a downloaded run: the GitHub-repo + Cloudflare Pages work.
//!
//! Given a run directory untarred from the artifact service
//! (`run-record.json` + `implementation/` + `events.jsonl`), this builds the
//! [`ReleaseRequest`](test_cabinet_core::ReleaseRequest) and drives the two release
//! steps [`BackendPublisher`](test_cabinet_core::BackendPublisher) exposes —
//! [`release_code`](test_cabinet_core::Publisher::release_code) (gh/git → a public
//! per-run repo) and
//! [`release_playable_build`](test_cabinet_core::Publisher::release_playable_build)
//! (wrangler → a Pages deploy). It releases only: the link-attach + publish-flip are
//! the backend's job once it receives the terminal result, and the run record was
//! already stored by the driver when the run finished.
//!
//! Secret scrubbing is already inside both release steps (the `SecretScrubber`
//! redacts any leaked provider key from the staged tree and the built output before
//! egress), so this layer re-implements none of it.

use std::path::Path;

use test_cabinet_core::{
    ArtifactCollection, BackendPublisher, CommandRunner, HttpBackendClient, PublishConfig,
    Publisher, ReleaseRequest, RunRecord, SystemCommandRunner, find_build_output,
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
    Publish(#[source] test_cabinet_core::Error),
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

/// Release a run that has already been downloaded and untarred under `run_dir`,
/// using `runner` to drive `gh`/`git`/`wrangler`.
///
/// This is the testable core: [`release`] wraps it with the real
/// [`SystemCommandRunner`]. A [`PublishConfig::from_env`] resolves the GitHub org +
/// Pages project from the `TCAB_GITHUB_ORG`/`TCAB_PAGES_PROJECT` the Job forwards —
/// both are required, so a publish Job that was not handed its targets fails here
/// (as a [`ReleaseError::Publish`]) rather than releasing to a default org. The
/// backend client is the type the publisher *must* supply to construct a
/// [`BackendPublisher`], but `release_code`/`release_playable_build` never touch it,
/// so a read-only [`HttpBackendClient`] (no token) satisfies the bound without being
/// used.
pub async fn release_with_runner<R: CommandRunner>(
    run_dir: &Path,
    runner: R,
) -> Result<ReleasedLinks, ReleaseError> {
    let record = load_record(run_dir)?;

    // Own the inputs the `ReleaseRequest` borrows for the lifetime of the release:
    // the collected implementation tree and the build directory found within it.
    let artifacts = ArtifactCollection {
        repo_path: run_dir.join("implementation"),
    };
    let build_dir = find_build_output(&artifacts.repo_path);

    let request = ReleaseRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: build_dir.as_deref(),
    };

    let publisher = BackendPublisher::new(
        PublishConfig::from_env().map_err(ReleaseError::Publish)?,
        runner,
        // Never exercised: the publisher reports via the publish-job token, not by
        // POSTing `/runs`. The base URL is irrelevant for that reason.
        HttpBackendClient::new("http://publisher.invalid"),
    );

    let source_repo = publisher
        .release_code(&request)
        .await
        .map_err(ReleaseError::Publish)?;
    let playable_build = publisher
        .release_playable_build(&request)
        .await
        .map_err(ReleaseError::Publish)?;

    Ok(ReleasedLinks {
        source_repo,
        playable_build,
    })
}

/// Release a downloaded run with the real [`SystemCommandRunner`] (`gh`/`git`/
/// `wrangler` as subprocesses).
pub async fn release(run_dir: &Path) -> Result<ReleasedLinks, ReleaseError> {
    release_with_runner(run_dir, SystemCommandRunner).await
}

#[cfg(test)]
#[path = "publish.test.rs"]
mod tests;
