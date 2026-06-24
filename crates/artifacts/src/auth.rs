//! Authentication for the artifact service's one *gated* caller, the uploading
//! driver.
//!
//! **Uploads** (a driver POSTing a finished run's tree) present the **per-job
//! token**, which the *backend* minted and is the authority for. The service
//! forwards it to the backend's internal `POST /jobs/{id}/verify-token` endpoint
//! ([`verify_job_token`]); a `2xx` means the token is the one minted for that job.
//! There is no extractor for it because the job id comes from the request path and
//! the check is per-upload (see [`crate::api`]).
//!
//! **Reads** (a reviewer pulling a build/proof/asset through the console) are
//! **not** token-gated. They cannot be: the console loads this media as
//! `<img src>`, an `<iframe>` build, and the build's own relative sub-resource
//! requests, none of which can carry an `Authorization` header, and the service's
//! CORS is permissive (no credentials), so there is no cookie path either. This
//! matches the backend, which already serves a run's record and its *published*
//! media to a signed-out reader — the read posture across the system is the
//! private-network boundary plus unguessable run ids, not a per-read token. (A
//! future cookie-based session would be the way to restore a real read gate; until
//! then a token here only made the media unloadable.)

use axum::http::HeaderMap;

use crate::error::ApiError;

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
