//! Retrying a transient failure with backoff.
//!
//! Each publisher step that reaches over the network retries a transient failure
//! with backoff before the publish fails (see `components/backend/results.md`,
//! "Repeating a step"): the preflight read and the download from the backend and
//! the artifact service, the Pages deploy (the deployment lookup and `wrangler`),
//! the repository publish (`gh repo view`/`create` and the push) and the result
//! report. Every one of those steps is safe to repeat, so a retry is a repeat of
//! the whole step.
//!
//! One policy ([`Backoff`]) and one classifier ([`Transient`]) serve them all. A
//! failure is transient when repeating the step could succeed: a request that got
//! no response, a `408`, `429` or `5xx` answer, or a `gh`/`git`/`wrangler` run that
//! failed. Every other `4xx` answer, a response that cannot be read, a repository
//! whose `main` holds another tree ([`Error::Diverged`]) and an incomplete
//! configuration are permanent and fail at once.

use std::fmt::Display;
use std::future::Future;
use std::time::Duration;

use crate::client::ClientError;
use crate::download::DownloadError;
use crate::error::Error;

/// How a step is retried: at most `attempts` runs, with a pause of
/// `initial_delay` before the first retry, doubled before each later one and
/// never longer than `max_delay`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Backoff {
    /// Total runs of the step, the first included (at least one is always made).
    pub attempts: u32,
    /// The pause before the first retry.
    pub initial_delay: Duration,
    /// The longest pause between two runs.
    pub max_delay: Duration,
}

impl Default for Backoff {
    /// Six runs with pauses of 1, 2, 4, 8 and 16 seconds: about half a minute,
    /// which rides out a backend or artifact service restart, GitHub's
    /// permission-propagation lag on a new repository and a Cloudflare hiccup,
    /// while staying far inside the publisher Job's deadline.
    fn default() -> Self {
        Self {
            attempts: 6,
            initial_delay: Duration::from_secs(1),
            max_delay: Duration::from_secs(30),
        }
    }
}

impl Backoff {
    /// The pause before retry number `retry` (1 for the first retry).
    pub fn delay(&self, retry: u32) -> Duration {
        let doublings = retry.saturating_sub(1).min(31);
        self.initial_delay
            .saturating_mul(1u32 << doublings)
            .min(self.max_delay)
    }
}

/// Whether a failure may pass if the step is repeated.
pub trait Transient {
    /// True when repeating the step could succeed.
    fn is_transient(&self) -> bool;
}

/// Whether an HTTP answer is worth repeating the request for: `408 Request
/// Timeout`, `429 Too Many Requests` or any `5xx`.
pub fn status_is_transient(status: u16) -> bool {
    status == 408 || status == 429 || (500..=599).contains(&status)
}

/// Whether a request that got no usable response could succeed when repeated.
/// A body that does not decode, or a request that could not be built, will not.
fn transport_is_transient(err: &reqwest::Error) -> bool {
    if let Some(status) = err.status() {
        return status_is_transient(status.as_u16());
    }
    !(err.is_decode() || err.is_builder())
}

impl Transient for Error {
    fn is_transient(&self) -> bool {
        match self {
            Error::Command(_) => true,
            Error::PagesApi { status: None, .. } => true,
            Error::PagesApi {
                status: Some(status),
                ..
            } => status_is_transient(*status),
            Error::Publish(_) | Error::Diverged(_) => false,
        }
    }
}

impl Transient for ClientError {
    fn is_transient(&self) -> bool {
        match self {
            ClientError::Transport { source, .. } => transport_is_transient(source),
            ClientError::Status { status, .. } => status_is_transient(status.as_u16()),
        }
    }
}

impl Transient for DownloadError {
    fn is_transient(&self) -> bool {
        match self {
            DownloadError::Transport(source) | DownloadError::Body(source) => {
                transport_is_transient(source)
            }
            DownloadError::Status { status, .. } => status_is_transient(status.as_u16()),
            DownloadError::NoStoredTree { .. } | DownloadError::Unpack { .. } => false,
        }
    }
}

/// Run `step` until it succeeds, fails permanently or has run
/// `policy.attempts` times, pausing between runs as `policy` says. `what` names
/// the step in the log line each retry writes. The last failure is returned as
/// it is.
pub async fn retry<T, E, F, Fut>(policy: &Backoff, what: &str, mut step: F) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, E>>,
    E: Transient + Display,
{
    let attempts = policy.attempts.max(1);
    let mut attempt = 1;
    loop {
        match step().await {
            Ok(value) => return Ok(value),
            Err(err) if attempt < attempts && err.is_transient() => {
                let delay = policy.delay(attempt);
                tracing::warn!(
                    step = what,
                    attempt,
                    attempts,
                    delay_ms = u64::try_from(delay.as_millis()).unwrap_or(u64::MAX),
                    error = %err,
                    "transient failure; retrying after backoff"
                );
                tokio::time::sleep(delay).await;
                attempt += 1;
            }
            Err(err) => return Err(err),
        }
    }
}

#[cfg(test)]
#[path = "retry.test.rs"]
mod tests;
