//! Who is calling the arena: the identity every request but the probes carries.
//!
//! Every request to the arena arrives through the [edge] and carries an Access
//! assertion in `Cf-Access-Jwt-Assertion`, which [`AccessVerifier`] checks exactly
//! as the backend does. It names a person by `email`, or an Access service token by
//! `common_name`. A tournament the console submits is authorized by that
//! assertion; the arena then presents its own service token to the backend when it
//! persists the tournament.
//!
//! No in-cluster caller drives the arena, but it holds the shared control-plane
//! service token (`TCAB_BACKEND_SERVICE_TOKEN`) for its backend calls, and accepts
//! it in `Authorization: Bearer <token>` like the other services do.
//!
//! An arena configured with no Access application (both `TCAB_ACCESS_*` unset, the
//! local overlay's shape) verifies no assertion and takes a person's identity from
//! the `Cf-Access-Authenticated-User-Email` header as presented.
//!
//! [`identify`] runs in front of every route and answers `401` to a request with
//! none of these. `/healthz` and `/readyz` are exempt, since a kubelet probe
//! carries no credential.
//!
//! [edge]: https://docs.testcabinet.ai/components/auth/overview/

use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::HeaderMap;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::access::{ASSERTION_HEADER, AccessError, AccessVerifier, AssertedIdentity};
use crate::api::AppState;
use crate::error::ApiError;

#[cfg(test)]
#[path = "auth.test.rs"]
mod tests;

/// The header an arena with no Access application reads a person's identity from:
/// what the local console's proxy sends.
pub const LOCAL_IDENTITY_HEADER: &str = "cf-access-authenticated-user-email";

/// The prefix the edge routes the arena under. Every route is served both under it
/// and at the root.
pub const EDGE_PREFIX: &str = "/arena";

/// How the arena establishes a person's identity: by verifying the Access
/// assertion, or (with no Access application configured) by reading the local
/// identity header.
pub type AccessMode = Option<Arc<AccessVerifier>>;

/// The caller a request was resolved to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Identity {
    /// A person, by the `email` of their assertion (or, with no Access application
    /// configured, by the local identity header).
    Person(String),
    /// An Access service token, by the `common_name` its assertion carries.
    ServiceAssertion(String),
    /// The shared control-plane service token.
    ServiceToken,
}

/// Middleware in front of every route: resolve the request's [`Identity`] into its
/// extensions, or answer `401` when it carries none.
pub async fn identify(State(state): State<AppState>, mut request: Request, next: Next) -> Response {
    if is_exempt(request.uri().path()) {
        return next.run(request).await;
    }
    let service_token = state.backend_service_token.as_deref().map(String::as_str);
    match resolve(&state.access, service_token, request.headers()).await {
        Ok(identity) => {
            request.extensions_mut().insert(identity);
            next.run(request).await
        }
        Err(err) => err.into_response(),
    }
}

/// Whether `path` is served without an identity: the two probes, at the root or
/// under [`EDGE_PREFIX`].
pub fn is_exempt(path: &str) -> bool {
    let path = path
        .strip_prefix(EDGE_PREFIX)
        .filter(|rest| rest.starts_with('/'))
        .unwrap_or(path);
    matches!(path, "/healthz" | "/readyz")
}

/// Resolve the caller of a request with `headers`.
///
/// An arena with an Access application decides by the assertion whenever one is
/// presented, and refuses one that fails to verify whatever else the request
/// carries. A bearer token is resolved next, and must be the service token. An
/// arena with no Access application then takes a person's identity from the local
/// identity header.
pub async fn resolve(
    access: &AccessMode,
    service_token: Option<&str>,
    headers: &HeaderMap,
) -> Result<Identity, ApiError> {
    if let Some(verifier) = access
        && let Some(assertion) = header(headers, ASSERTION_HEADER)
    {
        return match verifier.verify(&assertion).await {
            Ok(AssertedIdentity::Person(email)) => Ok(Identity::Person(email)),
            Ok(AssertedIdentity::ServiceToken(name)) => Ok(Identity::ServiceAssertion(name)),
            Err(AccessError::Rejected(message)) => Err(ApiError::unauthorized(message)),
            Err(AccessError::Unavailable(message)) => Err(ApiError::auth_unavailable(message)),
        };
    }
    if let Some(token) = bearer(headers) {
        return match service_token {
            Some(expected) if token_matches(&token, expected) => Ok(Identity::ServiceToken),
            _ => Err(ApiError::unauthorized("invalid bearer token")),
        };
    }
    if access.is_none()
        && let Some(email) = header(headers, LOCAL_IDENTITY_HEADER)
    {
        return Ok(Identity::Person(email));
    }
    Err(ApiError::unauthorized(if access.is_some() {
        "the request carries no Access assertion and no service token"
    } else {
        "the request carries no identity: send Cf-Access-Authenticated-User-Email or the \
         service token"
    }))
}

/// A non-empty header value, trimmed.
fn header(headers: &HeaderMap, name: &str) -> Option<String> {
    let value = headers.get(name)?.to_str().ok()?.trim();
    (!value.is_empty()).then(|| value.to_string())
}

/// The bearer token of an `Authorization: Bearer <token>` header, trimmed, or
/// `None` when the header is absent or not a non-empty bearer credential.
fn bearer(headers: &HeaderMap) -> Option<String> {
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
/// expected one leaks nothing about it through timing. A length mismatch is an
/// immediate non-match.
fn token_matches(presented: &str, expected: &str) -> bool {
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
