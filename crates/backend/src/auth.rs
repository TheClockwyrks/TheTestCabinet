//! Who is calling: the identity every request carries, and the gates routes put
//! on it.
//!
//! Every request identifies its caller with one of two credentials (see the API's
//! [conventions] and [Identity]):
//!
//! - An Access assertion in `Cf-Access-Jwt-Assertion`, which every request through
//!   the edge carries and [`AccessVerifier`] checks. It names a person by `email`,
//!   or an Access service token by `common_name`.
//! - A backend-minted token in `Authorization: Bearer <token>`: the shared service
//!   token (`TCAB_BACKEND_SERVICE_TOKEN`) the dispatcher and the other in-cluster
//!   services present, or the per-job token of a driver or publisher `Job`.
//!
//! A backend configured with no Access application (both `TCAB_ACCESS_*` unset, the
//! local overlay's shape) verifies no assertion and takes a person's identity from
//! the `Cf-Access-Authenticated-User-Email` header as presented.
//!
//! [`identify`] runs in front of every route, resolves the request's [`Identity`]
//! and answers `401` when it has none. `/healthz` and `/readyz` are exempt, since a
//! kubelet probe carries no credential, and so are the two `verify-token` routes,
//! whose body carries the per-job token they check. The extractors below are the
//! per-route gates, each answering `403` to an identity of the wrong kind:
//! [`Person`] for the routes that take a person's assertion, [`Reviewer`] for a
//! review, [`ServiceCaller`] for the routes automation drives, [`ServiceAuth`] for
//! the dispatcher's queue routes and [`JobCaller`] for a job's controller push. A
//! route that takes none of them is a read, open to any identity.
//!
//! [conventions]: https://docs.testcabinet.ai/components/backend/api/#conventions
//! [Identity]: https://docs.testcabinet.ai/components/auth/overview/

use std::sync::Arc;

use axum::extract::{FromRequestParts, Request, State};
use axum::http::HeaderMap;
use axum::http::request::Parts;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::access::{ASSERTION_HEADER, AccessError, AccessVerifier, AssertedIdentity};
use crate::api::AppState;
use crate::error::ApiError;

#[cfg(test)]
#[path = "auth.test.rs"]
mod tests;

/// The header a backend with no Access application reads a person's identity from:
/// what the local console's proxy and a local `tcab` send.
pub const LOCAL_IDENTITY_HEADER: &str = "cf-access-authenticated-user-email";

/// The prefix the edge routes the backend under. Every route is served both under
/// it and at the root.
pub const EDGE_PREFIX: &str = "/api";

/// The caller a request was resolved to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Identity {
    /// A person, by the `email` of their assertion (or, with no Access application
    /// configured, by the local identity header).
    Person(String),
    /// An Access service token, by the `common_name` its assertion carries.
    ServiceAssertion(String),
    /// The shared service token the in-cluster services present.
    ServiceToken,
    /// A driver `Job`'s per-job token, by the id of the job it was minted for.
    Job(String),
    /// A publisher `Job`'s per-publish-job token, by the id of its publish job.
    PublishJob(String),
}

impl Identity {
    /// A short description of the identity's kind, for a `403`'s message.
    fn kind(&self) -> &'static str {
        match self {
            Self::Person(_) => "a person",
            Self::ServiceAssertion(_) => "an Access service token",
            Self::ServiceToken => "the service token",
            Self::Job(_) => "a per-job token",
            Self::PublishJob(_) => "a per-publish-job token",
        }
    }
}

/// How the backend establishes a person's identity: by verifying the Access
/// assertion, or (with no Access application configured) by reading the local
/// identity header.
pub type AccessMode = Option<Arc<AccessVerifier>>;

/// Middleware in front of every route: resolve the request's [`Identity`] into its
/// extensions, or answer `401` when it carries none.
pub async fn identify(State(state): State<AppState>, mut request: Request, next: Next) -> Response {
    if is_exempt(request.uri().path()) {
        return next.run(request).await;
    }
    match resolve(&state, request.headers()).await {
        Ok(identity) => {
            request.extensions_mut().insert(identity);
            next.run(request).await
        }
        Err(err) => err.into_response(),
    }
}

/// Whether `path` is served without an identity: the two probes, and the two
/// `verify-token` routes whose body carries the token they check.
pub fn is_exempt(path: &str) -> bool {
    let path = path
        .strip_prefix(EDGE_PREFIX)
        .filter(|rest| rest.starts_with('/'))
        .unwrap_or(path);
    if matches!(path, "/healthz" | "/readyz") {
        return true;
    }
    let segments: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    matches!(
        segments.as_slice(),
        ["jobs" | "publish-jobs", id, "verify-token"] if !id.is_empty()
    )
}

/// Resolve the caller of a request with `headers`.
///
/// A backend with an Access application decides by the assertion whenever one is
/// presented, and refuses one that fails to verify whatever else the request
/// carries. A bearer token is resolved next. A backend with no Access application
/// then takes a person's identity from the local identity header.
pub async fn resolve(state: &AppState, headers: &HeaderMap) -> Result<Identity, ApiError> {
    if let Some(verifier) = &state.access
        && let Some(assertion) = header(headers, ASSERTION_HEADER)
    {
        return match verifier.verify(&assertion).await {
            Ok(AssertedIdentity::Person(email)) => Ok(Identity::Person(email)),
            Ok(AssertedIdentity::ServiceToken(name)) => Ok(Identity::ServiceAssertion(name)),
            Err(AccessError::Rejected(message)) => Err(ApiError::unauthorized(message)),
            Err(AccessError::Unavailable(message)) => Err(ApiError::auth_unavailable(message)),
        };
    }
    if let Some(token) = bearer_token(headers) {
        return resolve_bearer(state, &token).await;
    }
    if state.access.is_none()
        && let Some(email) = header(headers, LOCAL_IDENTITY_HEADER)
    {
        return Ok(Identity::Person(email));
    }
    Err(ApiError::unauthorized(if state.access.is_some() {
        "the request carries no Access assertion and no backend token"
    } else {
        "the request carries no identity: send Cf-Access-Authenticated-User-Email or a backend \
         token"
    }))
}

/// Resolve a bearer token: the shared service token, or the token minted for one
/// job or publish job.
async fn resolve_bearer(state: &AppState, token: &str) -> Result<Identity, ApiError> {
    if let Some(expected) = state.config.service_token.as_deref()
        && token_matches(token, expected)
    {
        return Ok(Identity::ServiceToken);
    }
    // The lookups find the row by its token; the constant-time comparison after
    // them is what decides, so a database collation that matched loosely could not
    // admit a near-miss.
    if let Some(job) = state.db.job_by_token(token).await.map_err(ApiError::from)?
        && token_matches(token, &job.job_token)
    {
        return Ok(Identity::Job(job.id));
    }
    if let Some(job) = state
        .db
        .publish_job_by_token(token)
        .await
        .map_err(ApiError::from)?
        && token_matches(token, &job.job_token)
    {
        return Ok(Identity::PublishJob(job.id));
    }
    Err(ApiError::unauthorized("invalid bearer token"))
}

/// A non-empty header value, trimmed.
fn header(headers: &HeaderMap, name: &str) -> Option<String> {
    let value = headers.get(name)?.to_str().ok()?.trim();
    (!value.is_empty()).then(|| value.to_string())
}

/// The identity [`identify`] resolved, or a `401` when the route was reached
/// without one.
fn identity(parts: &Parts) -> Result<Identity, ApiError> {
    parts
        .extensions
        .get::<Identity>()
        .cloned()
        .ok_or_else(|| ApiError::unauthorized("the request carries no identity"))
}

/// A `403` naming what the route takes and what it was given.
fn forbidden(takes: &str, given: &Identity) -> ApiError {
    ApiError::forbidden(format!("this route takes {takes}, not {}", given.kind()))
}

/// Any identity: the caller of an open read that still wants to know who it is.
#[derive(Debug, Clone)]
pub struct Caller(pub Identity);

impl<S: Send + Sync> FromRequestParts<S> for Caller {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        identity(parts).map(Caller)
    }
}

/// A person, by email: the gate of a route that takes a person's assertion. Any
/// other identity is a `403`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Person(pub String);

impl<S: Send + Sync> FromRequestParts<S> for Person {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        match identity(parts)? {
            Identity::Person(email) => Ok(Person(email)),
            other => Err(forbidden("a person's assertion", &other)),
        }
    }
}

/// The identity a review is attributed to: a person's `email`, or the
/// `common_name` of an Access service token. A backend-minted token is a `403`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reviewer(pub String);

impl<S: Send + Sync> FromRequestParts<S> for Reviewer {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        match identity(parts)? {
            Identity::Person(email) => Ok(Reviewer(email)),
            Identity::ServiceAssertion(name) => Ok(Reviewer(name)),
            other => Err(forbidden("an Access assertion", &other)),
        }
    }
}

/// Automation: the shared service token or an Access service token's assertion,
/// the gate of the routes automation drives (ingest, the dataset refresh,
/// tournaments, reference-build writes). A person or a per-job token is a `403`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceCaller(pub Identity);

impl<S: Send + Sync> FromRequestParts<S> for ServiceCaller {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        match identity(parts)? {
            identity @ (Identity::ServiceToken | Identity::ServiceAssertion(_)) => {
                Ok(ServiceCaller(identity))
            }
            other => Err(forbidden("the service token", &other)),
        }
    }
}

/// The dispatcher: the shared service token itself, the gate of the queue routes
/// the dispatcher drives (claiming a run or a publish, reporting a lost driver).
/// Any other identity is a `403`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ServiceAuth;

impl<S: Send + Sync> FromRequestParts<S> for ServiceAuth {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        match identity(parts)? {
            Identity::ServiceToken => Ok(ServiceAuth),
            other => Err(forbidden("the dispatcher's service token", &other)),
        }
    }
}

/// A driver or publisher `Job`, by its per-job token: the gate of the one file a job
/// hands the backend, an adversarial run's controller wasm. Any other identity is a
/// `403`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobCaller(pub Identity);

impl<S: Send + Sync> FromRequestParts<S> for JobCaller {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        match identity(parts)? {
            identity @ (Identity::Job(_) | Identity::PublishJob(_)) => Ok(JobCaller(identity)),
            other => Err(forbidden("a per-job token", &other)),
        }
    }
}

/// Extract the bearer token from an `Authorization: Bearer <token>` header. Public
/// so the driver's per-job-token routes can check the token against the job their
/// path names.
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
