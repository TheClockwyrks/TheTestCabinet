//! User accounts: the wire contract for the standalone auth service plus the
//! HTTP client every component uses to register, log in, and verify bearer
//! tokens against it.
//!
//! See `apps/docs/src/content/docs/components/auth/overview.md`. The auth service
//! (`crates/auth-service`, the `tcab-auth-service` binary) is the only holder of
//! the account store: it hashes passwords with Argon2id and mints opaque bearer
//! tokens. The backend does not store accounts — it [verifies](AccountsClient::verify)
//! each request's token against the auth service and attributes the resolved
//! [`Account`] to the review.
//!
//! Note the name: this is *user* authentication, distinct from
//! [`crate::auth`], which is *harness* authentication (an API key vs. a
//! subscription handed to the agent inside the run container).
//!
//! Both run behind the same private network — auth is a layer on top of that
//! reachability boundary, not a replacement for it.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tracing::instrument;

use crate::error::{Error, Result};

/// A user account as the auth service represents it on the wire: a stable id, the
/// login `username`, and the human-facing `display_name` shown beside a review.
/// The password hash never leaves the service, so it is not part of this shape.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    /// The account's stable id (a UUID), the key a review is attributed to.
    pub id: String,
    /// The unique login handle.
    pub username: String,
    /// The human-facing name shown beside the account's reviews.
    pub display_name: String,
}

/// A request to create a new account (`POST /auth/register`). Self-registration
/// is open on the private network: anyone who can reach the auth service may
/// create an account.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterRequest {
    /// The desired unique login handle.
    pub username: String,
    /// The plaintext password, hashed with Argon2id by the service and never
    /// stored or logged in the clear.
    pub password: String,
    /// The human-facing display name.
    pub display_name: String,
}

/// A request to exchange credentials for a bearer token (`POST /auth/login`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
    /// The account's login handle.
    pub username: String,
    /// The account's plaintext password, verified against the stored hash.
    pub password: String,
}

/// The auth service's response to a successful register or login: the freshly
/// minted bearer `token` (shown once; the service stores only its hash) and the
/// resolved [`Account`]. Clients persist the token and send it as
/// `Authorization: Bearer <token>` on every mutating request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthnResponse {
    /// The opaque bearer token to authenticate subsequent requests with.
    pub token: String,
    /// The account the token authenticates as.
    pub account: Account,
}

/// An HTTP client for the standalone auth service.
///
/// The base URL is the auth service's address (for example
/// `http://127.0.0.1:8789`). Used by the CLI/desktop/web to register and log in,
/// and by the backend to [verify](Self::verify) the bearer token on each
/// mutating request.
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

    /// Register a new account, returning the minted token and the account.
    /// A rejected username (taken, invalid) or weak password is surfaced as
    /// [`Error::Auth`] carrying the service's explanation.
    #[instrument(skip(self, request), fields(otel.kind = "client", http.request.method = "POST", url.path = "/auth/register", username = %request.username), err)]
    pub async fn register(&self, request: &RegisterRequest) -> Result<AuthnResponse> {
        self.post_json("/auth/register", request).await
    }

    /// Exchange a username and password for a bearer token. Bad credentials are
    /// surfaced as [`Error::Auth`].
    #[instrument(skip(self, request), fields(otel.kind = "client", http.request.method = "POST", url.path = "/auth/login", username = %request.username), err)]
    pub async fn login(&self, request: &LoginRequest) -> Result<AuthnResponse> {
        self.post_json("/auth/login", request).await
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
    /// transport and non-2xx failures into [`Error::Auth`].
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

/// Map a transport-level failure into an [`Error::Auth`] tagged with the URL.
fn auth_err(url: &str, err: reqwest::Error) -> Error {
    Error::Auth(format!("auth request to `{url}` failed: {err}"))
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
        "auth request to `{url}` failed ({status}): {message}"
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
