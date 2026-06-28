//! Wire types for the publish-job queue.
//!
//! The publish queue is a small, separate control plane that turns a
//! `POST /runs/{id}/publish` request into a per-publish Kubernetes **Job**: the
//! backend enqueues a publish job, the **dispatcher** claims it
//! (`POST /publish-jobs/next`) and creates one `tcab-publisher` Job, and that Job
//! performs the GitHub-repo + Cloudflare Pages release (the work
//! [`crate::publish::BackendPublisher`] does) and reports the outcome back
//! (`POST /publish-jobs/{id}/result`), at which point the backend records the links
//! and marks the run published.
//!
//! These mirror the run queue's [`crate::job_api`] types but for the publish path.
//! They are kept separate so the run path (`LaunchBody`/`ClaimedJob`/the driver) is
//! untouched, and they cross the backend↔dispatcher↔publisher boundary only — no
//! console consumes them, so unlike `job_api` they carry no `contract` codegen
//! derives.

use serde::{Deserialize, Serialize};

/// The claimed publish job the dispatcher receives from `POST /publish-jobs/next`:
/// the job id, the per-job token the publisher reports its result with, and the id
/// of the run to publish.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublishClaim {
    /// The claimed publish job's id.
    pub job_id: String,
    /// The per-job token the publisher presents to report its result.
    pub job_token: String,
    /// The id of the (already pushed, reviewed) run to release.
    pub run_id: String,
}

/// The terminal state a publisher reports for a publish job.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PublishState {
    /// The release succeeded; the links are carried in the same result.
    Succeeded,
    /// The release could not be completed (reason in `detail`).
    Failed,
}

/// The body of `POST /publish-jobs/{id}/result`: the outcome of the gh/wrangler
/// release, with the produced links on success or the reason on failure. On
/// success the backend stores the links on the run, marks it published, and queues
/// the public-snapshot refresh.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublishResult {
    /// The state the publisher is reporting.
    pub state: PublishState,
    /// The public source-repo URL the release produced, when one was created (a
    /// run that releases no code — asset generation — reports `None`).
    #[serde(default)]
    pub source_repo: Option<String>,
    /// The deployed playable-build URL, when a build was deployed.
    #[serde(default)]
    pub playable_build: Option<String>,
    /// A human-readable failure reason, used when `state` is `failed`.
    #[serde(default)]
    pub detail: Option<String>,
}

/// A progress line the publisher streams to `POST /publish-jobs/{id}/events` while
/// the release runs, fanned out verbatim to the publish job's live stream
/// (`GET /publish-jobs/{id}/live`). This is the non-terminal stream item, kept
/// deliberately open-ended (just a human-readable `message` today) so future
/// per-step progress — "creating repo", "pushing", "deploying" — is a non-breaking
/// extension: add fields here, same stream. The terminal item is [`PublishResult`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublishProgress {
    /// A human-readable progress line a console renders as the release advances.
    pub message: String,
}

/// A publish job's lifecycle state, stored by the backend and reported by
/// `GET /publish-jobs/{id}`. Mirrors [`crate::job_api::JobState`] for the publish
/// path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PublishJobState {
    /// Enqueued, awaiting a dispatcher to claim it.
    Queued,
    /// Claimed by the dispatcher; the publish Job is being created.
    Dispatched,
    /// The release succeeded and the run was published.
    Succeeded,
    /// The release failed.
    Failed,
}

impl PublishJobState {
    /// Map the stored state string to the wire enum. An unrecognized value (which
    /// the backend never writes) is treated as `queued`.
    pub fn from_db(state: &str) -> Self {
        match state {
            "dispatched" => Self::Dispatched,
            "succeeded" => Self::Succeeded,
            "failed" => Self::Failed,
            _ => Self::Queued,
        }
    }

    /// Whether this is a terminal state (the publish is over).
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Succeeded | Self::Failed)
    }
}
