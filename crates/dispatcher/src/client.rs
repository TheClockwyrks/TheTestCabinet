//! The dispatcher's client for the backend's control-plane job API.
//!
//! The dispatcher speaks two of the backend's `/jobs` endpoints (see the backend's
//! `api/jobs.rs`):
//!
//! - **Claim** — `POST /jobs/next`, authenticated with the shared **service
//!   token** ([`ServiceAuth`](../../backend/src/auth.rs)). `200` hands back a
//!   [`ClaimedJob`]; `204` means the queue is empty.
//! - **Status** — `GET /jobs/{id}` to read whether a job has already reached a
//!   terminal state, and `POST /jobs/{id}/status` to report a driver-pod death the
//!   driver itself could never report. The status POST uses the **per-job token**
//!   (carried in the [`ClaimedJob`]), not the service token — it is exactly the
//!   call the dead driver would have made.
//!
//! The dispatcher never enqueues, streams events, or pushes records: those are the
//! console's and the driver's jobs.

use reqwest::{Client, StatusCode};
use serde::Deserialize;

use test_cabinet_core::{ClaimedJob, DriverState, StatusUpdate};

/// A failure talking to the backend's job API.
#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    /// The request could not be sent (a transport/connection error).
    #[error("sending {what} to the backend: {source}")]
    Transport {
        /// The call that failed (e.g. `claim`, `status`).
        what: &'static str,
        /// The underlying transport error.
        #[source]
        source: reqwest::Error,
    },
    /// The backend rejected the request with a non-success status.
    #[error("backend rejected {what}: HTTP {status}{}", body_suffix(.body))]
    Status {
        /// The call that failed.
        what: &'static str,
        /// The HTTP status the backend returned.
        status: StatusCode,
        /// The response body, for diagnostics.
        body: String,
    },
    /// A success response body could not be decoded into the expected shape.
    #[error("decoding the backend's {what} response: {source}")]
    Decode {
        /// The call whose body failed to decode.
        what: &'static str,
        /// The underlying decode error.
        #[source]
        source: reqwest::Error,
    },
}

/// Append the body to a status error when there is one to show.
fn body_suffix(body: &str) -> String {
    if body.trim().is_empty() {
        String::new()
    } else {
        format!(": {}", body.trim())
    }
}

/// A job's lifecycle state as `GET /jobs/{id}` reports it on the wire. Mirrors the
/// backend's server-only `JobState` (which does not cross the crate boundary), so
/// the dispatcher can tell whether a job is already terminal before reporting a
/// driver-pod death over the top of it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobState {
    /// Enqueued, awaiting a dispatcher to claim it.
    Queued,
    /// Claimed by the dispatcher; the driver Job is being created.
    Dispatched,
    /// The driver is executing the run.
    Running,
    /// The run produced a record.
    Succeeded,
    /// The run could not be driven to a record.
    Failed,
    /// The job was canceled before completing.
    Canceled,
    /// A state string the backend introduced that this dispatcher does not know;
    /// treated conservatively as non-terminal so a death is still reported.
    #[serde(other)]
    Unknown,
}

impl JobState {
    /// Whether the run is over from the backend's perspective. A driver-pod death
    /// is only worth reporting when the backend has **not** reached one of these.
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Succeeded | Self::Failed | Self::Canceled)
    }
}

/// The subset of `GET /jobs/{id}` the dispatcher reads: just the lifecycle state.
#[derive(Debug, Deserialize)]
struct JobStatusOut {
    state: JobState,
}

/// A client for the backend's control-plane job API.
#[derive(Debug, Clone)]
pub struct BackendClient {
    /// The backend base URL, without a trailing slash.
    base_url: String,
    /// The shared service token authenticating the claim.
    service_token: String,
    /// The shared HTTP client.
    http: Client,
}

impl BackendClient {
    /// Build a client against the backend at `base_url`, claiming with
    /// `service_token`.
    pub fn new(base_url: impl Into<String>, service_token: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            service_token: service_token.into(),
            http: Client::new(),
        }
    }

    /// Claim the oldest queued job (`POST /jobs/next`, service token). `Ok(Some)`
    /// is a claimed job, `Ok(None)` an empty queue (`204`).
    pub async fn claim_next(&self) -> Result<Option<ClaimedJob>, ClientError> {
        let response = self
            .http
            .post(format!("{}/jobs/next", self.base_url))
            .bearer_auth(&self.service_token)
            .send()
            .await
            .map_err(|source| ClientError::Transport {
                what: "claim",
                source,
            })?;
        let status = response.status();
        if status == StatusCode::NO_CONTENT {
            return Ok(None);
        }
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(ClientError::Status {
                what: "claim",
                status,
                body,
            });
        }
        response
            .json::<ClaimedJob>()
            .await
            .map(Some)
            .map_err(|source| ClientError::Decode {
                what: "claim",
                source,
            })
    }

    /// Read a job's current lifecycle state (`GET /jobs/{id}`). `Ok(None)` for an
    /// unknown job (`404`) — for example a job already reaped along with its `Job`.
    pub async fn job_state(&self, job_id: &str) -> Result<Option<JobState>, ClientError> {
        let response = self
            .http
            .get(format!("{}/jobs/{job_id}", self.base_url))
            .send()
            .await
            .map_err(|source| ClientError::Transport {
                what: "job status",
                source,
            })?;
        let status = response.status();
        if status == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(ClientError::Status {
                what: "job status",
                status,
                body,
            });
        }
        response
            .json::<JobStatusOut>()
            .await
            .map(|out| Some(out.state))
            .map_err(|source| ClientError::Decode {
                what: "job status",
                source,
            })
    }

    /// Report a driver-pod death the driver could never report itself
    /// (`POST /jobs/{id}/status`, `failed`), authenticated with that job's per-job
    /// token. `detail` is the k8s-derived, **specific** reason (never a bare "run
    /// failed"); the dispatcher produces no record, so the backend retains the job
    /// as failed with this reason.
    pub async fn report_failed(
        &self,
        job_id: &str,
        job_token: &str,
        detail: impl Into<String>,
    ) -> Result<(), ClientError> {
        let update = StatusUpdate {
            state: DriverState::Failed,
            record: None,
            detail: Some(detail.into()),
        };
        let response = self
            .http
            .post(format!("{}/jobs/{job_id}/status", self.base_url))
            .bearer_auth(job_token)
            .json(&update)
            .send()
            .await
            .map_err(|source| ClientError::Transport {
                what: "failure report",
                source,
            })?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        let body = response.text().await.unwrap_or_default();
        Err(ClientError::Status {
            what: "failure report",
            status,
            body,
        })
    }
}
