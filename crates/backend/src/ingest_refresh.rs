//! The checkout refresh a `POST /ingest` with `refresh: true` asks for.
//!
//! A deployed backend reads its catalog from a checkout its ingest sidecar writes
//! (see the control plane's "Ingesting definitions"). The sidecar serves its
//! refresh script on a localhost endpoint inside the pod, named to the backend by
//! `TCAB_BACKEND_INGEST_REFRESH_URL`; [`refresh_checkout`] calls it and waits for
//! the refresh to finish before the scan reads the checkout.
//!
//! The endpoint answers `200` with `{"suitesUpdated": bool}` once the refresh has
//! run. `suitesUpdated: false` is the one failure the refresh may survive: the test
//! suites submodule could not be updated, and the scan ingests what the checkout
//! already holds, after telling the caller [`SUITES_UPDATE_FAILED`]. Any other
//! answer, or no answer, is a failed refresh, which fails the ingest before
//! anything is scanned.

use std::time::Duration;

use serde::Deserialize;

/// The notice an ingest reports when the test suites update failed and the scan
/// proceeds without it, worded as the sidecar's own startup log prints it.
pub const SUITES_UPDATE_FAILED: &str = "ingest: test suites update failed; ingesting without them";

/// How long a refresh may take before it counts as failed. A refresh fetches the
/// branch tip and two submodules, `cold-storage` among them, so it is given
/// minutes rather than seconds.
pub const REFRESH_TIMEOUT: Duration = Duration::from_secs(15 * 60);

/// The longest excerpt of a failed refresh's answer carried into its error.
const EXCERPT_CHARS: usize = 2000;

/// What a finished refresh reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshOutcome {
    /// Whether the test suites submodule was updated. `false` means the scan
    /// ingests the suites the checkout already holds.
    pub suites_updated: bool,
}

impl RefreshOutcome {
    /// The notice the ingest reports to its caller, if any.
    pub fn notice(&self) -> Option<&'static str> {
        (!self.suites_updated).then_some(SUITES_UPDATE_FAILED)
    }
}

/// Why a refresh failed.
#[derive(Debug, thiserror::Error)]
pub enum RefreshError {
    /// The endpoint could not be reached, or did not answer in time.
    #[error("the ingest sidecar's refresh endpoint {url} could not be reached: {reason}")]
    Unreachable {
        /// The endpoint called.
        url: String,
        /// What the client reported.
        reason: String,
    },
    /// The refresh ran and failed.
    #[error("refreshing the checkout failed ({status}): {output}")]
    Failed {
        /// The status the endpoint answered with.
        status: u16,
        /// An excerpt of what the refresh printed.
        output: String,
    },
    /// The endpoint answered `2xx` with a body this backend cannot read.
    #[error("the ingest sidecar's refresh endpoint {url} answered unreadably: {reason}")]
    Unreadable {
        /// The endpoint called.
        url: String,
        /// Why the body did not parse.
        reason: String,
    },
}

/// Ask the sidecar at `url` to refresh the checkout, and wait for it.
#[tracing::instrument(name = "ingest.refresh", skip(http), err(Display))]
pub async fn refresh_checkout(
    http: &reqwest::Client,
    url: &str,
) -> Result<RefreshOutcome, RefreshError> {
    refresh_checkout_within(http, url, REFRESH_TIMEOUT).await
}

/// [`refresh_checkout`] with an explicit timeout.
pub async fn refresh_checkout_within(
    http: &reqwest::Client,
    url: &str,
    timeout: Duration,
) -> Result<RefreshOutcome, RefreshError> {
    let unreachable = |error: reqwest::Error| RefreshError::Unreachable {
        url: url.to_owned(),
        reason: error.to_string(),
    };
    let response = http
        .post(url)
        .timeout(timeout)
        .send()
        .await
        .map_err(unreachable)?;
    let status = response.status();
    let body = response.text().await.map_err(unreachable)?;
    if !status.is_success() {
        return Err(RefreshError::Failed {
            status: status.as_u16(),
            output: excerpt(&body),
        });
    }
    let outcome: RefreshOutcome =
        serde_json::from_str(&body).map_err(|error| RefreshError::Unreadable {
            url: url.to_owned(),
            reason: error.to_string(),
        })?;
    if let Some(notice) = outcome.notice() {
        tracing::warn!("{notice}");
    }
    Ok(outcome)
}

/// The tail of `output`, where a failing script's error lands, trimmed to
/// [`EXCERPT_CHARS`].
fn excerpt(output: &str) -> String {
    let output = output.trim();
    if output.is_empty() {
        return "it printed nothing".to_owned();
    }
    let count = output.chars().count();
    if count <= EXCERPT_CHARS {
        return output.to_owned();
    }
    let tail: String = output.chars().skip(count - EXCERPT_CHARS).collect();
    format!("…{tail}")
}

#[cfg(test)]
#[path = "ingest_refresh.test.rs"]
mod tests;
