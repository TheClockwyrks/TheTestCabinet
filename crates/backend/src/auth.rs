//! Bearer-token authentication for the backend's mutating endpoints.
//!
//! The backend holds no accounts. On each mutating request it pulls the
//! `Authorization: Bearer <token>` header and resolves it to an account by
//! asking the standalone auth service ([`test_cabinet_core::AccountsClient`]).
//! GET endpoints stay open — the private network is still the outer boundary, so
//! reads need no token; writes (push, review, publish, media upload) require a
//! valid one, and reviews are attributed to the resolved [`Account`].
//!
//! [`AuthUser`] is an Axum extractor: any handler that takes it is gated, and a
//! missing/invalid token short-circuits with `401` before the handler body runs.

use axum::extract::FromRequestParts;
use axum::http::HeaderMap;
use axum::http::request::Parts;

use test_cabinet_core::Account;

use crate::api::AppState;
use crate::error::ApiError;

/// The authenticated account behind a request, produced by the [`FromRequestParts`]
/// extractor below. A handler that takes `AuthUser` is reachable only with a
/// valid bearer token.
#[derive(Debug, Clone)]
pub struct AuthUser(pub Account);

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = bearer(parts).ok_or_else(|| ApiError::unauthorized("missing bearer token"))?;
        // A reachable-but-rejecting auth service answers `Ok(None)` (the token is
        // bad → `401`); a network/server fault is `Err` (→ `502`), which is a
        // different failure mode the caller should retry, not re-auth.
        let account = state
            .auth
            .verify(&token)
            .await
            .map_err(|err| ApiError::auth_unavailable(err.to_string()))?
            .ok_or_else(|| ApiError::unauthorized("invalid or expired token"))?;
        Ok(AuthUser(account))
    }
}

/// The dispatcher's service identity, produced by the [`FromRequestParts`]
/// extractor below: a request carrying the shared service token
/// (`TCAB_BACKEND_SERVICE_TOKEN`). A handler that takes `ServiceAuth` is
/// reachable only by the dispatcher. Distinct from [`AuthUser`] (a human
/// account) — the service token is a backend↔dispatcher secret, not an account.
#[derive(Debug, Clone, Copy)]
pub struct ServiceAuth;

impl FromRequestParts<AppState> for ServiceAuth {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = bearer(parts).ok_or_else(|| ApiError::unauthorized("missing service token"))?;
        let expected = state.config.service_token.as_deref().ok_or_else(|| {
            ApiError::unauthorized("the dispatcher service token is not configured on this backend")
        })?;
        if !token_matches(&token, expected) {
            return Err(ApiError::unauthorized("invalid service token"));
        }
        Ok(ServiceAuth)
    }
}

/// Extract the bearer token from an `Authorization: Bearer <token>` header.
fn bearer(parts: &Parts) -> Option<String> {
    bearer_token(&parts.headers)
}

/// Extract the bearer token from a header map. Public so handlers that read the
/// header before consuming the body (the driver's per-job-token streaming
/// endpoints) can pull it without the [`AuthUser`]/[`ServiceAuth`] extractors.
pub fn bearer_token(headers: &HeaderMap) -> Option<String> {
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

/// Constant-time string equality, so comparing a presented token against the
/// expected one (the service token, or a job's stored token) leaks nothing about
/// it through timing. A length mismatch is an immediate non-match.
pub fn token_matches(presented: &str, expected: &str) -> bool {
    let (presented, expected) = (presented.as_bytes(), expected.as_bytes());
    if presented.len() != expected.len() {
        return false;
    }
    let mut diff = 0u8;
    for (a, b) in presented.iter().zip(expected.iter()) {
        diff |= a ^ b;
    }
    diff == 0
}
