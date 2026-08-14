//! The publisher's client for the backend's per-publish-job streaming API.
//!
//! The publisher is a client of the backend's publish-queue control plane (see the
//! backend's `api/publish_jobs.rs`). It does not enqueue or claim — the console and
//! the dispatcher do — it only *streams its one publish job's progress back*: a
//! handful of human-readable progress lines as the release advances
//! (`POST /publish-jobs/{id}/events`), and a terminal [`PublishResult`] carrying
//! the produced links or the failure reason (`POST /publish-jobs/{id}/result`).
//! Every call presents the per-publish-job bearer token the dispatcher passed in.
//!
//! The backend fans both out to the live stream (`GET /publish-jobs/{id}/live`); on
//! the terminal `succeeded` result it attaches the links to the run and flips it
//! published. The progress lines are best-effort observation — they are relayed but
//! never persisted — so a failure to post one is logged and the release continues;
//! the terminal result is the durable, must-land call.

use reqwest::Client;
use serde::Deserialize;
use test_cabinet_core::{PublishProgress, PublishResult};

/// A failure talking to the backend's publish-job API.
#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    /// The request could not be sent (a transport/connection error).
    #[error("sending {what} to the backend: {source}")]
    Transport {
        /// The call that failed (e.g. `events`, `result`).
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

/// The links a run already carries when the publisher's preflight finds it
/// **already published** — the answer to "has this run been released before?".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublishedRun {
    /// The public source-repo URL the earlier release produced, if any.
    pub source_repo: Option<String>,
    /// The playable-build URL the earlier release deployed, if any.
    pub playable_build: Option<String>,
}

/// The slice of `GET /runs/{id}` the preflight reads. The endpoint returns the whole
/// stored run; everything but the publication state and links is ignored here.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunPublicationOut {
    /// Whether the run is already published (in the public snapshot).
    published: bool,
    /// The links the run carries. Absent links deserialize to `None`.
    #[serde(default)]
    links: RunLinksOut,
}

/// The `links` object of `GET /runs/{id}`.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunLinksOut {
    #[serde(default)]
    source_repo: Option<String>,
    #[serde(default)]
    playable_build: Option<String>,
}

/// A client streaming one publish job's progress + terminal result back to the
/// backend over HTTP.
#[derive(Debug, Clone)]
pub struct PublishJobClient {
    /// The backend base URL, without a trailing slash.
    base_url: String,
    /// The publish job id this binary serves (the `/publish-jobs/{id}/…` path key).
    publish_job_id: String,
    /// The per-publish-job bearer token presented on every call.
    job_token: String,
    /// The shared HTTP client.
    http: Client,
}

impl PublishJobClient {
    /// Build a client for `publish_job_id` against the backend at `base_url`,
    /// presenting `job_token` on every call.
    pub fn new(
        base_url: impl Into<String>,
        publish_job_id: impl Into<String>,
        job_token: impl Into<String>,
    ) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            publish_job_id: publish_job_id.into(),
            job_token: job_token.into(),
            http: Client::new(),
        }
    }

    /// Stream a progress line (`POST /publish-jobs/{id}/events`). The backend fans
    /// it out to the live stream verbatim; it is not persisted.
    pub async fn post_progress(&self, message: impl Into<String>) -> Result<(), ClientError> {
        let progress = PublishProgress {
            message: message.into(),
        };
        let response = self
            .http
            .post(self.url("events"))
            .bearer_auth(&self.job_token)
            .json(&progress)
            .send()
            .await
            .map_err(|source| ClientError::Transport {
                what: "events",
                source,
            })?;
        Self::check(response, "events").await
    }

    /// Whether run `run_id` is **already published**, and if so the links it already
    /// carries (`GET /runs/{id}` — an unauthenticated read, so no token is presented).
    ///
    /// The publisher calls this *before* doing any external work. Publishing is not
    /// idempotent on the Cloudflare side: `wrangler pages deploy` mints a brand-new
    /// deployment on every invocation, so a job that runs against an already-published
    /// run leaves a second, orphaned public build behind — the failure this preflight
    /// exists to prevent. (The `gh` side reuses an existing repository, which is why
    /// the duplication only ever shows up as extra Pages deployments.)
    ///
    /// `Some` means the run is published and the release must be skipped; `None` means
    /// it still needs releasing. An unreachable backend is an error rather than a
    /// fall-through to publishing: this call cannot confirm the release is *needed*,
    /// and the terminal result could not be reported over that same backend anyway, so
    /// failing here costs nothing and keeps the irreversible external work gated.
    pub async fn published_run(&self, run_id: &str) -> Result<Option<PublishedRun>, ClientError> {
        let response = self
            .http
            .get(format!("{}/runs/{run_id}", self.base_url))
            .send()
            .await
            .map_err(|source| ClientError::Transport {
                what: "run",
                source,
            })?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(ClientError::Status {
                what: "run",
                status,
                body,
            });
        }

        let run: RunPublicationOut =
            response
                .json()
                .await
                .map_err(|source| ClientError::Transport {
                    what: "run",
                    source,
                })?;

        Ok(run.published.then_some(PublishedRun {
            source_repo: run.links.source_repo,
            playable_build: run.links.playable_build,
        }))
    }

    /// Report the terminal outcome of the release (`POST /publish-jobs/{id}/result`).
    /// On `Succeeded` the backend attaches the links and flips the run published; on
    /// `Failed` it records the reason. Either way the live stream closes with this
    /// exact result.
    pub async fn post_result(&self, result: &PublishResult) -> Result<(), ClientError> {
        let response = self
            .http
            .post(self.url("result"))
            .bearer_auth(&self.job_token)
            .json(result)
            .send()
            .await
            .map_err(|source| ClientError::Transport {
                what: "result",
                source,
            })?;
        Self::check(response, "result").await
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

    /// The full URL for one of this publish job's sub-paths.
    fn url(&self, suffix: &str) -> String {
        format!(
            "{}/publish-jobs/{}/{suffix}",
            self.base_url, self.publish_job_id
        )
    }
}

#[cfg(test)]
#[path = "client.test.rs"]
mod tests;
