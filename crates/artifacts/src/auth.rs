//! Who is calling the artifact service, and the checks each kind of route makes.
//!
//! Every request but the probes carries an identity (see [Identity] and the
//! service's [Auth] section), resolved by [`identify`] in front of every route:
//!
//! - An Access assertion in `Cf-Access-Jwt-Assertion`, which every request through
//!   the edge carries and [`AccessVerifier`] checks exactly as the backend does. It
//!   names a person by `email`, or an Access service token by `common_name`. This
//!   is what a console's reads present: the browser holds the Access cookie and the
//!   edge turns it into the assertion, so `<img src>`, a build `<iframe>` and an
//!   archive link need no header of their own.
//! - A token in `Authorization: Bearer <token>`, which the in-cluster callers
//!   present and which never crosses the edge: the shared control-plane service
//!   token (`TCAB_BACKEND_SERVICE_TOKEN`) the backend holds, a driver's per-job
//!   token on an upload, or a publisher's per-publish-job token on a `tree.tar`
//!   pull.
//!
//! A service configured with no Access application (both `TCAB_ACCESS_*` unset, the
//! local overlay's shape) verifies no assertion and takes a person's identity from
//! the `Cf-Access-Authenticated-User-Email` header as presented.
//!
//! [`identify`] answers `401` to a request with none of these. `/healthz` and
//! `/readyz` are exempt, since a kubelet probe carries no credential. The routes
//! split into two kinds:
//!
//! - **Token routes** take one specific in-cluster token and check it themselves:
//!   the upload forwards its per-job token to the backend's
//!   `POST /jobs/{id}/verify-token` ([`verify_job_token`]), the `tree.tar` pull its
//!   per-publish-job token to `POST /publish-jobs/{id}/verify-token`
//!   ([`verify_publish_job_token`]), and the tree delete, the `GET /runs`
//!   listing and `POST /runs/{id}/publish-media` compare the service token
//!   ([`verify_service_token`]). The backend is the authority for the two job
//!   tokens, so [`identify`] lets a bearer it cannot recognise through to these
//!   routes and the route decides.
//! - **The public write**, `PUT /public/{key}`, takes a service's identity
//!   ([`authorize_public_write`]): the shared service token the backend writes
//!   the public dataset with, or the assertion of an Access service token, which
//!   is how the CLI writes an asset reference through the edge. A person's
//!   assertion is refused (`403`).
//! - **Reads** (a run's build, media, logs, gg session record, code analysis and
//!   archive) take a verified identity: a person's or service token's assertion,
//!   the shared service token (the backend's snapshot builder reads media with
//!   it), or, with no Access application, the local identity header.
//!   [`require_reader`] refuses a bearer that is none of these.
//!
//! [Identity]: https://docs.testcabinet.ai/components/auth/overview/
//! [Auth]: https://docs.testcabinet.ai/components/artifacts/overview/#auth

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

/// The header a service with no Access application reads a person's identity
/// from: what the local console's proxy and a local `tcab` send.
pub const LOCAL_IDENTITY_HEADER: &str = "cf-access-authenticated-user-email";

/// The prefix the edge routes the artifact service under. Every route is served
/// both under it and at the root.
pub const EDGE_PREFIX: &str = "/artifacts";

/// How the service establishes a person's identity: by verifying the Access
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
    /// A bearer token that is not the service token: a driver's per-job token or a
    /// publisher's per-publish-job token, which only the token route it is
    /// presented to can check against the backend.
    Token,
}

/// Middleware in front of every route: resolve the request's [`Identity`] into its
/// extensions, or answer `401` when it carries none.
pub async fn identify(State(state): State<AppState>, mut request: Request, next: Next) -> Response {
    if is_exempt(request.uri().path()) {
        return next.run(request).await;
    }
    match resolve(
        &state.access,
        state.service_token.as_deref().map(String::as_str),
        request.headers(),
    )
    .await
    {
        Ok(identity) => {
            request.extensions_mut().insert(identity);
            next.run(request).await
        }
        Err(err) => err.into_response(),
    }
}

/// Middleware in front of the read routes: refuse a request whose identity is an
/// unrecognised bearer token, which none of the reads take.
pub async fn require_reader(request: Request, next: Next) -> Response {
    match request.extensions().get::<Identity>() {
        Some(Identity::Person(_) | Identity::ServiceAssertion(_) | Identity::ServiceToken) => {
            next.run(request).await
        }
        Some(Identity::Token) => ApiError::unauthorized(
            "invalid bearer token: a read takes an Access assertion or the service token",
        )
        .into_response(),
        None => ApiError::unauthorized("the request carries no identity").into_response(),
    }
}

/// Authorize a write of the public dataset (`PUT /public/{key}`) by the
/// caller's `identity`: the shared service token or an Access service token's
/// assertion. A person, however verified, writes nothing public (`403`); a
/// bearer that is not the service token is refused as unrecognised (`401`).
pub fn authorize_public_write(identity: Option<&Identity>) -> Result<(), ApiError> {
    match identity {
        Some(Identity::ServiceToken | Identity::ServiceAssertion(_)) => Ok(()),
        Some(Identity::Person(_)) => Err(ApiError::forbidden(
            "a public write takes the service token or an Access service token, not a person",
        )),
        Some(Identity::Token) => Err(ApiError::unauthorized(
            "invalid bearer token: a public write takes the service token",
        )),
        None => Err(ApiError::unauthorized("the request carries no identity")),
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
/// A service with an Access application decides by the assertion whenever one is
/// presented, and refuses one that fails to verify whatever else the request
/// carries. A bearer token is resolved next. A service with no Access application
/// then takes a person's identity from the local identity header.
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
        return Ok(match service_token {
            Some(expected) if token_matches(&token, expected) => Identity::ServiceToken,
            _ => Identity::Token,
        });
    }
    if access.is_none()
        && let Some(email) = header(headers, LOCAL_IDENTITY_HEADER)
    {
        return Ok(Identity::Person(email));
    }
    Err(ApiError::unauthorized(if access.is_some() {
        "the request carries no Access assertion and no service token"
    } else {
        "the request carries no identity: send Cf-Access-Authenticated-User-Email or a service \
         token"
    }))
}

/// A non-empty header value, trimmed.
fn header(headers: &HeaderMap, name: &str) -> Option<String> {
    let value = headers.get(name)?.to_str().ok()?.trim();
    (!value.is_empty()).then(|| value.to_string())
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

/// Verify a `tree.tar` download's per-**publish-job** token against the backend
/// (the token authority) by forwarding it to
/// `POST {backend_url}/publish-jobs/{id}/verify-token` — the publish-path analogue
/// of [`verify_job_token`]. The publisher Job presents the publish-job token it was
/// minted with; the backend answers `2xx` when it matches publish job `id`, `401`
/// when it does not, and `404` for an unknown publish job — all mapped to a `401`
/// download rejection (only the publisher holding the publish job's token may pull
/// its source tree). A transport/server fault against the backend is surfaced as a
/// retry-able auth-unavailable error, exactly as the upload path does.
pub async fn verify_publish_job_token(
    http: &reqwest::Client,
    backend_url: &str,
    id: &str,
    token: &str,
) -> Result<(), ApiError> {
    if token.is_empty() {
        return Err(ApiError::unauthorized("missing publish-job token"));
    }
    let url = format!("{backend_url}/publish-jobs/{id}/verify-token");
    let response = http
        .post(&url)
        .json(&serde_json::json!({ "token": token }))
        .send()
        .await
        .map_err(|err| {
            ApiError::auth_unavailable(format!(
                "verifying the publish-job token with the backend: {err}"
            ))
        })?;
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    // As with the upload path, a `401`/`404` is a rejected token; anything else is
    // the backend being unavailable, which the publisher should retry rather than
    // treat as a permanent auth failure.
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::NOT_FOUND {
        Err(ApiError::unauthorized("invalid publish-job token"))
    } else {
        Err(ApiError::auth_unavailable(format!(
            "the backend's publish-job-token verify returned HTTP {status}"
        )))
    }
}

/// Authorize a control-plane route — the tree delete, the `GET /runs` listing,
/// `publish-media` — by the shared service token (`TCAB_BACKEND_SERVICE_TOKEN`)
/// the backend holds. Unlike an upload (a per-job token verified against the
/// backend), these are the backend acting on its own authority, so they are
/// gated by the shared secret directly. `expected` is `None` when the service has
/// no token configured, in which case the routes are disabled and every caller
/// is rejected.
pub fn verify_service_token(headers: &HeaderMap, expected: Option<&str>) -> Result<(), ApiError> {
    let expected = expected.ok_or_else(|| {
        ApiError::unauthorized("the service token is not configured on this service")
    })?;
    let presented =
        bearer(headers).ok_or_else(|| ApiError::unauthorized("missing service token"))?;
    if token_matches(&presented, expected) {
        Ok(())
    } else {
        Err(ApiError::unauthorized("invalid service token"))
    }
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
