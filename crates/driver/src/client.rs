//! The driver's client for the backend's per-job streaming API.
//!
//! The driver is a client of the backend's run-queue control plane (see the
//! backend's `api/jobs.rs`). It does not enqueue or claim — the console and the
//! dispatcher do — it only *streams its one job's progress back*: a `running`
//! status when execution begins, batches of harness events and individual asset
//! preview frames as they are produced, a `validating` status once the harness
//! session has ended, and a terminal `succeeded`/`failed`
//! status carrying the produced record. Every call presents the per-job bearer
//! token the dispatcher passed in.
//!
//! The terminal record is handed back *with* the status: the backend persists it
//! using the events the relay already accumulated from the streaming calls below,
//! so the driver never re-sends them as part of the record.

use reqwest::Client;
use test_cabinet_core::event::HarnessEvent;
use test_cabinet_core::job_api::{DriverState, JobState, JobStatusOut, StatusUpdate};
use test_cabinet_core::preview::AssetPreview;
use test_cabinet_core::run_record::RunRecord;

use crate::artifacts::TreeStore;

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

    /// Report that the driver has come up and begun the pre-run setup
    /// (`POST /jobs/{id}/status`, `starting`) — connecting to the container runtime
    /// and materializing the definition, before the harness session begins.
    pub async fn post_status_starting(&self) -> Result<(), ClientError> {
        self.post_status(
            "status (starting)",
            &StatusUpdate::of(DriverState::Starting),
        )
        .await
    }

    /// Report that execution has begun (`POST /jobs/{id}/status`, `running`).
    pub async fn post_status_running(&self) -> Result<(), ClientError> {
        self.post_status("status (running)", &StatusUpdate::of(DriverState::Running))
            .await
    }

    /// Report that the harness session has ended and the driver has moved on to the
    /// post-session work — collecting the tree, the post-run analysis, the case's
    /// toolchain, validation and the upload (`POST /jobs/{id}/status`,
    /// `validating`).
    pub async fn post_status_validating(&self) -> Result<(), ClientError> {
        self.post_status(
            "status (validating)",
            &StatusUpdate::of(DriverState::Validating),
        )
        .await
    }

    /// Report that the driver's wait on the artifact store is over
    /// (`POST /jobs/{id}/status`, `validating`), returning the job from `storing`
    /// to the state it holds while the driver finishes its report. `stored` says
    /// whether the wait ended with the tree stored, which the backend reads as
    /// the store taking uploads again.
    pub async fn post_status_wait_over(&self, stored: bool) -> Result<(), ClientError> {
        self.post_status(
            "status (validating)",
            &StatusUpdate {
                artifacts_stored: stored.then_some(true),
                ..StatusUpdate::of(DriverState::Validating)
            },
        )
        .await
    }

    /// Report that the run has finished and the driver is waiting on the artifact
    /// store to take its tree (`POST /jobs/{id}/status`, `storing`), with `reason`
    /// the failure of the latest upload attempt. The backend shows the run as
    /// waiting to store its artifacts and holds the run queue while it does.
    ///
    /// `record` is the run's record, handed over for the backend to keep while the
    /// driver waits, with `run_failure` the reason the run failed when the report
    /// the driver is holding is a `failed` one. The backend finishes the run from
    /// them if this driver is lost.
    pub async fn post_status_storing(
        &self,
        reason: &str,
        record: Option<&RunRecord>,
        run_failure: Option<&str>,
    ) -> Result<(), ClientError> {
        self.post_status(
            "status (storing)",
            &StatusUpdate {
                record: record.cloned(),
                detail: Some(reason.to_string()),
                run_failure: run_failure.map(str::to_string),
                ..StatusUpdate::of(DriverState::Storing)
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
    /// job to `canceled`, and the next poll here sees it. Reads are open, so this
    /// needs no token. `None` means the backend does not know the job (a `404`),
    /// which the caller treats as "nothing to act on"; a transport, HTTP, or decode
    /// error is surfaced so the caller can simply retry on its next tick.
    pub async fn poll_state(&self) -> Result<Option<JobState>, ClientError> {
        let url = format!("{}/jobs/{}", self.base_url, self.job_id);
        let response =
            self.http
                .get(url)
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
    /// `succeeded`). The backend persists the record using the events the relay
    /// accumulated, regardless of the record's own outcome.
    ///
    /// `tree` is the outcome of the run-tree upload, which every terminal report
    /// carries as [`StatusUpdate::artifacts_stored`] and
    /// [`StatusUpdate::store_fault`].
    pub async fn post_status_succeeded(
        &self,
        record: RunRecord,
        tree: &TreeStore,
    ) -> Result<(), ClientError> {
        self.post_status(
            "status (succeeded)",
            &StatusUpdate {
                record: Some(record),
                artifacts_stored: tree.artifacts_stored(),
                store_fault: tree.store_fault().map(str::to_string),
                ..StatusUpdate::of(DriverState::Succeeded)
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
        tree: &TreeStore,
    ) -> Result<(), ClientError> {
        self.post_status(
            "status (failed)",
            &StatusUpdate {
                record,
                detail: Some(detail.into()),
                artifacts_stored: tree.artifacts_stored(),
                store_fault: tree.store_fault().map(str::to_string),
                ..StatusUpdate::of(DriverState::Failed)
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
    /// Reached for a canceled [gg](test_cabinet_core::gg) run, the one harness with a
    /// wind-down to ask for, and for a run of any harness that was canceled while its
    /// finished tree was being uploaded. A run of any other harness canceled while it
    /// executes is destroyed by the driver, which posts nothing after the kill (see the
    /// [`cancel`](crate::cancel) module).
    pub async fn post_status_canceled(
        &self,
        record: RunRecord,
        tree: &TreeStore,
    ) -> Result<(), ClientError> {
        self.post_status(
            "status (canceled)",
            &StatusUpdate {
                record: Some(record),
                artifacts_stored: tree.artifacts_stored(),
                store_fault: tree.store_fault().map(str::to_string),
                ..StatusUpdate::of(DriverState::Canceled)
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
