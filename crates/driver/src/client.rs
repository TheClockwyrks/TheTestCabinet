//! The driver's client for the backend's per-job streaming API.
//!
//! The driver is a client of the backend's run-queue control plane (see the
//! backend's `api/jobs.rs`). It does not enqueue or claim — the console and the
//! dispatcher do — it only *streams its one job's progress back*: a `running`
//! status when execution begins, batches of harness events and individual asset
//! preview frames as they are produced, and a terminal `succeeded`/`failed`
//! status carrying the produced record. Every call presents the per-job bearer
//! token the dispatcher passed in.
//!
//! The terminal record is handed back *with* the status: the backend persists it
//! using the events the relay already accumulated from the streaming calls below,
//! so the driver never re-sends them as part of the record.
//!
//! A finished run is handed over twice: first in the held `storing` report
//! ([`JobClient::post_status_storing`]), which the backend keeps against the job
//! before the uploads begin, then in the terminal report, which also says whether
//! the run tree was stored ([`StoreFields`]), in the sequence
//! [`finish`](crate::finish) makes. Both are made under the driver's
//! [retry policy](crate::retry); [`ClientError::is_refused`] tells a request the
//! backend refused, which ends the retrying at once, from every other failure.

use crate::event::HarnessEvent;
use crate::job_api::{DriverState, JobState, JobStatusOut, StatusUpdate};
use crate::preview::AssetPreview;
use crate::run_record::RunRecord;
use reqwest::Client;

/// A failure talking to the backend's job API.
#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    /// The request could not be sent (a transport/connection error).
    #[error("sending {what} to the backend: {source}")]
    Transport {
        /// The call that failed (e.g. `status`, `events`).
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
        status: reqwest::StatusCode,
        /// The response body, for diagnostics (often empty on a `204`-path error).
        body: String,
    },
}

impl ClientError {
    /// Whether the backend refused the request itself: a `4xx` other than `408`
    /// (Request Timeout) and `429` (Too Many Requests). No retry can change such an
    /// answer, so it ends the call at once. A transport failure, a `408`, a `429`,
    /// a `5xx` and any other status are retried.
    pub fn is_refused(&self) -> bool {
        match self {
            Self::Transport { .. } => false,
            Self::Status { status, .. } => {
                status.is_client_error() && !matches!(status.as_u16(), 408 | 429)
            }
        }
    }
}

/// What a terminal report says of the run tree's upload (`artifactsStored`,
/// `storeFault`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StoreFields {
    /// `true` when the artifacts service acknowledged the tree, `false` when it did
    /// not, and `None` when no artifacts service is configured.
    pub artifacts_stored: Option<bool>,
    /// Why the tree was not stored, when the cause was a condition of the store
    /// rather than the run's own failure.
    pub store_fault: Option<String>,
}

/// Append the body to a status error when there is one to show.
fn body_suffix(body: &str) -> String {
    if body.trim().is_empty() {
        String::new()
    } else {
        format!(": {}", body.trim())
    }
}

/// A client streaming one job's progress back to the backend over HTTP.
#[derive(Debug, Clone)]
pub struct JobClient {
    /// The backend base URL, without a trailing slash.
    base_url: String,
    /// The job id this driver executes (the `/jobs/{id}/…` path key).
    job_id: String,
    /// The per-job bearer token presented on every call.
    job_token: String,
    /// The shared HTTP client.
    http: Client,
}

impl JobClient {
    /// Build a client for `job_id` against the backend at `base_url`, presenting
    /// `job_token` on every streaming call.
    pub fn new(
        base_url: impl Into<String>,
        job_id: impl Into<String>,
        job_token: impl Into<String>,
    ) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            job_id: job_id.into(),
            job_token: job_token.into(),
            http: Client::new(),
        }
    }

    /// Report that the driver has come up and begun the pre-run setup
    /// (`POST /jobs/{id}/status`, `starting`) — connecting to the container runtime
    /// and materializing the definition, before the harness session begins.
    pub async fn post_status_starting(&self) -> Result<(), ClientError> {
        self.post_status(
            "status (starting)",
            &StatusUpdate {
                state: DriverState::Starting,
                record: None,
                detail: None,
                artifacts_stored: None,
                store_fault: None,
            },
        )
        .await
    }

    /// Report that execution has begun (`POST /jobs/{id}/status`, `running`).
    pub async fn post_status_running(&self) -> Result<(), ClientError> {
        self.post_status(
            "status (running)",
            &StatusUpdate {
                state: DriverState::Running,
                record: None,
                detail: None,
                artifacts_stored: None,
                store_fault: None,
            },
        )
        .await
    }

    /// Hand the finished run's record to the backend before the uploads begin
    /// (`POST /jobs/{id}/status`, `storing`): the held report. `detail` is the run's
    /// failure detail when it will be reported `failed`. The backend stores the
    /// record (and the detail) against the job, replacing what an earlier `storing`
    /// report left, and finishes the run from it if the driver is lost.
    ///
    /// The same report is repeated after each failed attempt of an upload that is
    /// waiting on the store, with that failure as `store_fault` (`storeFault`): the
    /// reason the run is still storing. It goes there rather than in `detail`, which
    /// stays the run's own failure, since the backend replaces the held detail with
    /// each report's and would otherwise finish a lost run with the upload's error.
    pub async fn post_status_storing(
        &self,
        record: &RunRecord,
        detail: Option<&str>,
        store_fault: Option<&str>,
    ) -> Result<(), ClientError> {
        self.post_status(
            "status (storing)",
            &StatusUpdate {
                state: DriverState::Storing,
                record: Some(record.clone()),
                detail: detail.map(str::to_string),
                artifacts_stored: None,
                store_fault: store_fault.map(str::to_string),
            },
        )
        .await
    }

    /// Stream a batch of harness events (`POST /jobs/{id}/events`). The backend
    /// appends them to the live stream and the backlog persisted with the run.
    pub async fn post_events(&self, events: &[HarnessEvent]) -> Result<(), ClientError> {
        let response = self
            .http
            .post(self.url("events"))
            .bearer_auth(&self.job_token)
            .json(events)
            .send()
            .await
            .map_err(|source| ClientError::Transport {
                what: "events",
                source,
            })?;
        Self::check(response, "events").await
    }

    /// Stream one live asset-preview frame (`POST /jobs/{id}/preview`). Previews
    /// are relayed but never persisted.
    pub async fn post_preview(&self, preview: &AssetPreview) -> Result<(), ClientError> {
        let response = self
            .http
            .post(self.url("preview"))
            .bearer_auth(&self.job_token)
            .json(preview)
            .send()
            .await
            .map_err(|source| ClientError::Transport {
                what: "preview",
                source,
            })?;
        Self::check(response, "preview").await
    }

    /// Poll this job's current lifecycle state (`GET /jobs/{id}`). This is how the
    /// driver observes an operator cancellation while it runs: the backend flips the
    /// job to `canceled`, and the next poll here sees it. Like every call, it presents
    /// the per-job token: reads need an identity too. `None` means the backend does not know the job (a `404`),
    /// which the caller treats as "nothing to act on"; a transport, HTTP, or decode
    /// error is surfaced so the caller can simply retry on its next tick.
    pub async fn poll_state(&self) -> Result<Option<JobState>, ClientError> {
        let url = format!("{}/jobs/{}", self.base_url, self.job_id);
        let response = self
            .http
            .get(url)
            .bearer_auth(&self.job_token)
            .send()
            .await
            .map_err(|source| ClientError::Transport {
                what: "status poll",
                source,
            })?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(ClientError::Status {
                what: "status poll",
                status,
                body,
            });
        }
        let out: JobStatusOut = response
            .json()
            .await
            .map_err(|source| ClientError::Transport {
                what: "status poll",
                source,
            })?;
        Ok(Some(out.state))
    }

    /// Report success with the produced record (`POST /jobs/{id}/status`,
    /// `succeeded`) and what became of its tree (`store`). The backend persists the
    /// record using the events the relay accumulated, regardless of the record's own
    /// outcome.
    pub async fn post_status_succeeded(
        &self,
        record: RunRecord,
        store: StoreFields,
    ) -> Result<(), ClientError> {
        self.post_status(
            "status (succeeded)",
            &StatusUpdate {
                state: DriverState::Succeeded,
                record: Some(record),
                detail: None,
                artifacts_stored: store.artifacts_stored,
                store_fault: store.store_fault,
            },
        )
        .await
    }

    /// Report a terminal infrastructure/setup failure with a specific diagnostic
    /// reason (`POST /jobs/{id}/status`, `failed`), plus whatever record the run
    /// managed to produce (retained so the timeline stays inspectable) and what became
    /// of its tree (`store`; default when the run produced none).
    pub async fn post_status_failed(
        &self,
        detail: impl Into<String>,
        record: Option<RunRecord>,
        store: StoreFields,
    ) -> Result<(), ClientError> {
        self.post_status(
            "status (failed)",
            &StatusUpdate {
                state: DriverState::Failed,
                record,
                detail: Some(detail.into()),
                artifacts_stored: store.artifacts_stored,
                store_fault: store.store_fault,
            },
        )
        .await
    }

    /// Acknowledge an operator's cancellation, handing back the record the killed run
    /// wound down to produce (`POST /jobs/{id}/status`, `canceled`). The job is already
    /// terminal, so this changes no state — the backend persists the record with the
    /// events the relay accumulated and attaches it to the job, so the killed run stays
    /// visible and inspectable in the run list.
    ///
    /// Reached for a canceled [gg](crate::gg) run, the one harness with a wind-down
    /// to ask for, and for a run of any harness whose job is canceled while its
    /// finishing waits (see [`finish`](crate::finish)). A run of any other harness
    /// canceled before its finishing began is destroyed by the driver, which posts
    /// nothing after the kill (see the [`cancel`](crate::cancel) module).
    pub async fn post_status_canceled(
        &self,
        record: RunRecord,
        store: StoreFields,
    ) -> Result<(), ClientError> {
        self.post_status(
            "status (canceled)",
            &StatusUpdate {
                state: DriverState::Canceled,
                record: Some(record),
                detail: None,
                artifacts_stored: store.artifacts_stored,
                store_fault: store.store_fault,
            },
        )
        .await
    }

    /// Send a status update and verify the backend accepted it.
    async fn post_status(
        &self,
        what: &'static str,
        update: &StatusUpdate,
    ) -> Result<(), ClientError> {
        let response = self
            .http
            .post(self.url("status"))
            .bearer_auth(&self.job_token)
            .json(update)
            .send()
            .await
            .map_err(|source| ClientError::Transport { what, source })?;
        Self::check(response, what).await
    }

    /// Map a backend response to `Ok(())` on a success status or a [`ClientError`]
    /// carrying the status and body otherwise.
    async fn check(response: reqwest::Response, what: &'static str) -> Result<(), ClientError> {
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        let body = response.text().await.unwrap_or_default();
        Err(ClientError::Status { what, status, body })
    }

    /// The full URL for one of this job's streaming sub-paths.
    fn url(&self, suffix: &str) -> String {
        format!("{}/jobs/{}/{suffix}", self.base_url, self.job_id)
    }
}

#[cfg(test)]
#[path = "client.test.rs"]
mod tests;
