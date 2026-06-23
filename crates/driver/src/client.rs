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

use reqwest::Client;
use test_cabinet_core::event::HarnessEvent;
use test_cabinet_core::job_api::{DriverState, StatusUpdate};
use test_cabinet_core::preview::AssetPreview;
use test_cabinet_core::run_record::RunRecord;

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

    /// Report that execution has begun (`POST /jobs/{id}/status`, `running`).
    pub async fn post_status_running(&self) -> Result<(), ClientError> {
        self.post_status(
            "status (running)",
            &StatusUpdate {
                state: DriverState::Running,
                record: None,
                detail: None,
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

    /// Report success with the produced record (`POST /jobs/{id}/status`,
    /// `succeeded`). The backend persists the record using the events the relay
    /// accumulated, regardless of the record's own outcome.
    pub async fn post_status_succeeded(&self, record: RunRecord) -> Result<(), ClientError> {
        self.post_status(
            "status (succeeded)",
            &StatusUpdate {
                state: DriverState::Succeeded,
                record: Some(record),
                detail: None,
            },
        )
        .await
    }

    /// Report a terminal infrastructure/setup failure with a specific diagnostic
    /// reason (`POST /jobs/{id}/status`, `failed`), plus whatever record the run
    /// managed to produce (retained so the timeline stays inspectable).
    pub async fn post_status_failed(
        &self,
        detail: impl Into<String>,
        record: Option<RunRecord>,
    ) -> Result<(), ClientError> {
        self.post_status(
            "status (failed)",
            &StatusUpdate {
                state: DriverState::Failed,
                record,
                detail: Some(detail.into()),
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
