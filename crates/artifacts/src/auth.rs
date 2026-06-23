//! Authentication for the artifact service's two callers.
//!
//! The service holds artifacts that are **private until publish** — a run's build
//! and media are only the reviewer's to see before it goes public — so both
//! directions are gated, but against two different authorities:
//!
//! - **Reads** (a reviewer pulling a build/proof/asset) require an **account
//!   token**, verified against the auth service via
//!   [`AccountsClient`](test_cabinet_core::AccountsClient) — exactly the pattern
//!   the backend's `AuthUser` uses. [`ReadAuth`] is the Axum extractor for it.
//! - **Uploads** (a driver POSTing a finished run's tree) present the **per-job
//!   token**, which the *backend* minted and is the authority for. The service
//!   forwards it to the backend's internal `POST /jobs/{id}/verify-token` endpoint
//!   ([`verify_job_token`]); a `2xx` means the token is the one minted for that
//!   job. There is no extractor for it because the job id comes from the request
//!   path and the check is per-upload (see [`crate::api`]).
//!
//! Like the rest of the system this is a layer on top of the private-network
//! boundary, not a replacement for it.

use axum::extract::FromRequestParts;
use axum::http::HeaderMap;
use axum::http::request::Parts;

use test_cabinet_core::Account;

use crate::api::AppState;
use crate::error::ApiError;

/// The authenticated account behind a *read* request, produced by the
/// [`FromRequestParts`] extractor below. A serve handler that takes `ReadAuth` is
/// reachable only with a valid account bearer token, so a pre-publish run's
/// private artifacts are never served to an anonymous caller.
#[derive(Debug, Clone)]
pub struct ReadAuth(#[allow(dead_code)] pub Account);

impl FromRequestParts<AppState> for ReadAuth {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token =
            bearer(&parts.headers).ok_or_else(|| ApiError::unauthorized("missing bearer token"))?;
        // A reachable-but-rejecting auth service answers `Ok(None)` (the token is
        // bad → `401`); a network/server fault is `Err` (→ `502`), a different
        // failure mode the caller should retry rather than re-auth — mirroring the
        // backend's `AuthUser`.
        let account = state
            .auth
            .verify(&token)
            .await
            .map_err(|err| ApiError::auth_unavailable(err.to_string()))?
            .ok_or_else(|| ApiError::unauthorized("invalid or expired token"))?;
        Ok(ReadAuth(account))
    }
}

/// Verify an upload's per-job token against the backend (the token authority) by
/// forwarding it to `POST {backend_url}/jobs/{id}/verify-token`. The backend
/// answers `2xx` when the token is the one it minted for job `id`, `401` when it
/// is not, and `404` for an unknown job — all of which the service maps to a `401`
/// upload rejection (the driver should not be able to upload for a job whose token
/// it does not hold). A transport/server fault against the backend is surfaced as
/// `502` so the driver retries rather than treating it as a bad token.
pub async fn verify_job_token(
    http: &reqwest::Client,
    backend_url: &str,
    id: &str,
    token: &str,
) -> Result<(), ApiError> {
    if token.is_empty() {
        return Err(ApiError::unauthorized("missing job token"));
    }
    let url = format!("{backend_url}/jobs/{id}/verify-token");
    let response = http
        .post(&url)
        .json(&serde_json::json!({ "token": token }))
        .send()
        .await
        .map_err(|err| {
            ApiError::auth_unavailable(format!("verifying the job token with the backend: {err}"))
        })?;
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    // A `401`/`404` from the backend is a rejected token; anything else (a `5xx`,
    // a gateway error) is the backend being unavailable, which the driver should
    // retry rather than treat as a permanent auth failure.
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::NOT_FOUND {
        Err(ApiError::unauthorized("invalid job token"))
    } else {
        Err(ApiError::auth_unavailable(format!(
            "the backend's job-token verify returned HTTP {status}"
        )))
    }
}

/// Extract the bearer token from an `Authorization: Bearer <token>` header,
/// trimming surrounding whitespace. `None` when the header is absent or not a
/// non-empty bearer credential.
pub fn bearer(headers: &HeaderMap) -> Option<String> {
    let value = headers
        .get(axum::http::header::AUTHORIZATION)?
        .to_str()
        .ok()?;
    let token = value
        .strip_prefix("Bearer ")
        .or_else(|| value.strip_prefix("bearer "))?
        .trim();
    (!token.is_empty()).then(|| token.to_string())
}
