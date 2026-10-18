//! User accounts: the backend's client of the standalone auth service, which
//! verifies a request's bearer token and fetches a reviewer's picture.
//!
//! See `apps/docs/src/content/docs/components/auth/overview.md`. The auth service
//! (`crates/auth-service`, the `tcab-auth-service` binary) is the only holder of
//! the account store: it hashes passwords with Argon2id and mints opaque bearer
//! tokens. The backend does not store accounts — it [verifies](AccountsClient::verify)
//! each request's token against the auth service and attributes the resolved
//! [`Account`] to the review.
//!
//! The wire shapes are `test_cabinet_contracts::accounts`; the CLI registers and
//! logs in through its own client of the same service.
//!
//! Both run behind the same private network — auth is a layer on top of that
//! reachability boundary, not a replacement for it.

use serde::Deserialize;
use tracing::instrument;

pub use test_cabinet_contracts::accounts::Account;

use crate::error::{BackendError as Error, Result};

/// An account's profile picture as the auth service serves it: the raw image
/// bytes and their content type. Not a wire-contract shape — it is the decoded
/// body of `GET /auth/users/{id}/picture`, used by the backend to embed a
/// reviewer's picture in the public snapshot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewerPicture {
    /// The image bytes.
    pub bytes: Vec<u8>,
    /// The image's content type (e.g. `image/webp`).
    pub content_type: String,
}

/// An HTTP client for the standalone auth service.
///
/// The base URL is the auth service's address (for example
/// `http://127.0.0.1:8789`). The backend [verifies](Self::verify) the bearer token on
/// each mutating request through it.
#[derive(Debug, Clone)]
pub struct AccountsClient {
    /// The auth service base URL, without a trailing slash.
    base_url: String,
    /// The shared HTTP client.
    http: reqwest::Client,
}

impl AccountsClient {
    /// Construct a client targeting the auth service at `base_url`.
    pub fn new(base_url: impl Into<String>) -> Self {
        let base = base_url.into();
        Self {
            base_url: base.trim_end_matches('/').to_string(),
            http: reqwest::Client::new(),
        }
    }

    /// The auth service base URL this client targets.
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Join a path onto the base URL.
    fn url(&self, path: &str) -> String {
        format!("{}/{}", self.base_url, path.trim_start_matches('/'))
    }

    /// Resolve the account a bearer `token` authenticates as
    /// (`POST /auth/verify`). Returns `Ok(None)` when the token is absent,
    /// invalid, or expired (the auth service answers `401`) so the caller can map
    /// that to its own unauthenticated response, and `Err` only on a transport or
    /// server fault.
    #[instrument(skip(self, token), fields(otel.kind = "client", http.request.method = "POST", url.path = "/auth/verify"), err)]
    pub async fn verify(&self, token: &str) -> Result<Option<Account>> {
        let url = self.url("/auth/verify");
        let response = self
            .http
            .post(&url)
            .headers(traced_headers())
            .bearer_auth(token)
            .send()
            .await
            .map_err(|err| auth_err(&url, err))?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Ok(None);
        }
        let response = error_for_status(&url, response).await?;
        let account = response
            .json::<Account>()
            .await
            .map_err(|err| auth_err(&url, err))?;
        Ok(Some(account))
    }

    /// Fetch an account's profile picture bytes (`GET /auth/users/{id}/picture`).
    /// Returns `Ok(None)` when the account has no picture (the service answers
    /// `404`), so the caller can skip it, and `Err` only on a transport or server
    /// fault. This is the source the backend's snapshot bake reads reviewer pictures
    /// from to embed them in the public snapshot.
    #[instrument(skip(self), fields(otel.kind = "client", http.request.method = "GET", url.path = "/auth/users/{id}/picture", user.id = %id), err)]
    pub async fn picture(&self, id: &str) -> Result<Option<ReviewerPicture>> {
        let url = self.url(&format!("/auth/users/{id}/picture"));
        let response = self
            .http
            .get(&url)
            .headers(traced_headers())
            .send()
            .await
            .map_err(|err| auth_err(&url, err))?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let response = error_for_status(&url, response).await?;
        let content_type = response
            .headers()
            .get(http::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_string();
        let bytes = response
            .bytes()
            .await
            .map_err(|err| auth_err(&url, err))?
            .to_vec();
        Ok(Some(ReviewerPicture {
            bytes,
            content_type,
        }))
    }
}

/// An outbound header map carrying the current trace context, so the auth
/// service continues this trace. A no-op unless a binary installed the global
/// propagator (degrades silently in fmt-only mode).
fn traced_headers() -> http::HeaderMap {
    let mut headers = http::HeaderMap::new();
    test_cabinet_telemetry::propagation::inject_current_context(&mut headers);
    headers
}

/// Map a transport-level failure into an [`Error::Auth`] tagged with the URL.
fn auth_err(url: &str, err: reqwest::Error) -> Error {
    Error::Auth(format!("request to `{url}` failed: {err}"))
}

/// Turn a non-2xx response into an [`Error::Auth`], surfacing the service's error
/// envelope (`{ "error": { "code", "message" } }`) when present.
async fn error_for_status(url: &str, response: reqwest::Response) -> Result<reqwest::Response> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let body = response.text().await.unwrap_or_default();
    let message = serde_json::from_str::<ErrorEnvelope>(&body)
        .ok()
        .map(|envelope| envelope.error.message)
        .unwrap_or_else(|| body.trim().to_string());
    Err(Error::Auth(format!(
        "request to `{url}` failed ({status}): {message}"
    )))
}

#[derive(Deserialize)]
struct ErrorEnvelope {
    error: ErrorEnvelopeInner,
}

#[derive(Deserialize)]
struct ErrorEnvelopeInner {
    message: String,
}
