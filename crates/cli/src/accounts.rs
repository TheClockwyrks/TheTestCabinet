//! User accounts: the CLI's client of the standalone auth service, which
//! registers, logs in and logs out (`tcab register`, `tcab login`, `tcab logout`).
//!
//! See `apps/docs/src/content/docs/components/auth/overview.md`. The auth service
//! (`crates/auth-service`, the `tcab-auth-service` binary) is the only holder of
//! the account store: it hashes passwords with Argon2id and mints opaque bearer
//! tokens. The wire shapes are `test_cabinet_contracts::accounts`.
//!
//! Both run behind the same private network — auth is a layer on top of that
//! reachability boundary, not a replacement for it.

use anyhow::{Result, anyhow};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tracing::instrument;

pub use test_cabinet_contracts::accounts::{AuthnResponse, LoginRequest, RegisterRequest};

/// An HTTP client for the standalone auth service.
///
/// The base URL is the auth service's address (for example
/// `http://127.0.0.1:8789`).
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

    /// Join a path onto the base URL.
    fn url(&self, path: &str) -> String {
        format!("{}/{}", self.base_url, path.trim_start_matches('/'))
    }

    /// Register a new account, returning the minted token and the account.
    /// A rejected username (taken, invalid) or weak password is surfaced as
    /// an error carrying the service's explanation.
    #[instrument(skip(self, request), fields(otel.kind = "client", http.request.method = "POST", url.path = "/auth/register", username = %request.username), err)]
    pub async fn register(&self, request: &RegisterRequest) -> Result<AuthnResponse> {
        self.post_json("/auth/register", request).await
    }

    /// Exchange a username and password for a bearer token. Bad credentials are
    /// surfaced as an error.
    #[instrument(skip(self, request), fields(otel.kind = "client", http.request.method = "POST", url.path = "/auth/login", username = %request.username), err)]
    pub async fn login(&self, request: &LoginRequest) -> Result<AuthnResponse> {
        self.post_json("/auth/login", request).await
    }

    /// Revoke a bearer `token` (`POST /auth/logout`). A token already unknown to
    /// the service is treated as success — the goal state (the token no longer
    /// works) already holds.
    #[instrument(skip(self, token), fields(otel.kind = "client", http.request.method = "POST", url.path = "/auth/logout"), err)]
    pub async fn logout(&self, token: &str) -> Result<()> {
        let url = self.url("/auth/logout");
        let response = self
            .http
            .post(&url)
            .headers(traced_headers())
            .bearer_auth(token)
            .send()
            .await
            .map_err(|err| auth_err(&url, err))?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Ok(());
        }
        error_for_status(&url, response).await?;
        Ok(())
    }

    /// POST `body` as JSON to `path` and deserialize the JSON response, mapping
    /// transport and non-2xx failures into an error.
    async fn post_json<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T> {
        let url = self.url(path);
        let response = self
            .http
            .post(&url)
            .headers(traced_headers())
            .json(body)
            .send()
            .await
            .map_err(|err| auth_err(&url, err))?;
        let response = error_for_status(&url, response).await?;
        response
            .json::<T>()
            .await
            .map_err(|err| auth_err(&url, err))
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

/// Map a transport-level failure into an an error tagged with the URL.
fn auth_err(url: &str, err: reqwest::Error) -> anyhow::Error {
    anyhow!("the auth service: request to `{url}` failed: {err}")
}

/// Turn a non-2xx response into an an error, surfacing the service's error
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
    Err(anyhow!(
        "the auth service: request to `{url}` failed ({status}): {message}"
    ))
}

#[derive(Deserialize)]
struct ErrorEnvelope {
    error: ErrorEnvelopeInner,
}

#[derive(Deserialize)]
struct ErrorEnvelopeInner {
    message: String,
}
