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

/// Extract the bearer token from an `Authorization: Bearer <token>` header.
fn bearer(parts: &Parts) -> Option<String> {
    let value = parts
        .headers
        .get(axum::http::header::AUTHORIZATION)?
        .to_str()
        .ok()?;
    let token = value
        .strip_prefix("Bearer ")
        .or_else(|| value.strip_prefix("bearer "))?
        .trim();
    (!token.is_empty()).then(|| token.to_string())
}
