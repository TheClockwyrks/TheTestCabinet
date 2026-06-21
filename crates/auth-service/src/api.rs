//! The auth service's HTTP surface: register, login, verify, logout.
//!
//! Open self-registration on the private network — anyone who can reach the
//! service may create an account. The wire shapes are
//! [`test_cabinet_core::accounts`] types, so the backend and every client speak
//! the same contract. There is no app-level auth *guarding* these endpoints; the
//! bearer tokens they mint are what the **backend** then requires on its mutating
//! endpoints.

use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use axum::routing::{get, post};
use axum::{Json, Router};
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use uuid::Uuid;

use test_cabinet_core::accounts::{Account, AuthnResponse, LoginRequest, RegisterRequest};

use crate::db::Db;
use crate::entity::{token, user};
use crate::error::{ApiError, Result};
use crate::secret;

/// The shared handler state: the account store.
#[derive(Clone)]
pub struct AppState {
    /// The SeaORM-backed account store.
    pub db: Arc<Db>,
}

/// Build the auth service's Axum router. The trace middleware continues an
/// inbound W3C trace (a no-op when no propagator is installed); CORS is
/// permissive so a browser console reaching the service through the worker is
/// never blocked.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/auth/register", post(register))
        .route("/auth/login", post(login))
        .route("/auth/verify", post(verify))
        .route("/auth/logout", post(logout))
        .layer(axum::middleware::from_fn(accept_trace))
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(state)
}

/// Continue any inbound W3C trace context so spans stitch across the call.
async fn accept_trace(request: Request, next: Next) -> Response {
    test_cabinet_telemetry::propagation::accept_inbound(request.headers());
    next.run(request).await
}

/// Liveness probe.
async fn healthz() -> &'static str {
    "ok"
}

/// `POST /auth/register` — create an account and return a freshly minted token.
async fn register(
    State(state): State<AppState>,
    Json(request): Json<RegisterRequest>,
) -> Result<(StatusCode, Json<AuthnResponse>)> {
    let username = request.username.trim();
    let display_name = request.display_name.trim();
    if username.is_empty() {
        return Err(ApiError::bad_request("username must not be empty"));
    }
    if display_name.is_empty() {
        return Err(ApiError::bad_request("displayName must not be empty"));
    }
    if request.password.len() < secret::MIN_PASSWORD_LEN {
        return Err(ApiError::bad_request(format!(
            "password must be at least {} characters",
            secret::MIN_PASSWORD_LEN
        )));
    }
    if state.db.find_user_by_username(username).await?.is_some() {
        return Err(ApiError::conflict(format!(
            "username `{username}` is already taken"
        )));
    }

    let password_hash = secret::hash_password(&request.password)
        .map_err(|_| ApiError::internal("could not hash password"))?;
    let now = now_rfc3339();
    let account = user::Model {
        id: Uuid::new_v4().to_string(),
        username: username.to_string(),
        display_name: display_name.to_string(),
        password_hash,
        created_at: now.clone(),
    };
    state.db.insert_user(account.clone()).await?;

    let response = mint(&state, &account, &now).await?;
    Ok((StatusCode::CREATED, Json(response)))
}

/// `POST /auth/login` — exchange credentials for a token. The error is identical
/// whether the username is unknown or the password is wrong, so it never reveals
/// which usernames exist.
async fn login(
    State(state): State<AppState>,
    Json(request): Json<LoginRequest>,
) -> Result<Json<AuthnResponse>> {
    let account = state.db.find_user_by_username(request.username.trim()).await?;
    let Some(account) = account else {
        return Err(ApiError::unauthorized("invalid username or password"));
    };
    if !secret::verify_password(&request.password, &account.password_hash) {
        return Err(ApiError::unauthorized("invalid username or password"));
    }
    let now = now_rfc3339();
    let response = mint(&state, &account, &now).await?;
    Ok(Json(response))
}

/// `POST /auth/verify` — resolve the account a bearer token authenticates as.
/// This is the endpoint the backend calls on every mutating request.
async fn verify(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Account>> {
    let token = bearer(&headers).ok_or_else(|| ApiError::unauthorized("missing bearer token"))?;
    let now = now_rfc3339();
    let account = state
        .db
        .user_for_token(&secret::hash_token(token), &now)
        .await?
        .ok_or_else(|| ApiError::unauthorized("invalid or expired token"))?;
    Ok(Json(account_of(&account)))
}

/// `POST /auth/logout` — revoke a bearer token. Idempotent: an already-unknown
/// token still answers success.
async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Result<StatusCode> {
    if let Some(token) = bearer(&headers) {
        state.db.delete_token(&secret::hash_token(token)).await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Mint a token for `account`, persist its hash, and assemble the response.
async fn mint(state: &AppState, account: &user::Model, now: &str) -> Result<AuthnResponse> {
    let raw = secret::generate_token();
    let row = token::Model {
        id: Uuid::new_v4().to_string(),
        user_id: account.id.clone(),
        token_hash: secret::hash_token(&raw),
        created_at: now.to_string(),
        expires_at: None,
    };
    state.db.insert_token(row).await?;
    Ok(AuthnResponse {
        token: raw,
        account: account_of(account),
    })
}

/// Project a stored user row onto the public [`Account`] shape (the password hash
/// never crosses the wire).
fn account_of(account: &user::Model) -> Account {
    Account {
        id: account.id.clone(),
        username: account.username.clone(),
        display_name: account.display_name.clone(),
    }
}

/// Extract the bearer token from an `Authorization: Bearer <token>` header,
/// trimming surrounding whitespace. `None` when the header is absent or not a
/// non-empty bearer credential.
fn bearer(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(http::header::AUTHORIZATION)?.to_str().ok()?;
    let token = value.strip_prefix("Bearer ").or_else(|| value.strip_prefix("bearer "))?;
    let token = token.trim();
    (!token.is_empty()).then_some(token)
}

/// The current instant as an RFC 3339 UTC string (the timestamp stamped on new
/// rows and compared against token expiry).
fn now_rfc3339() -> String {
    use time::OffsetDateTime;
    use time::format_description::well_known::Rfc3339;
    OffsetDateTime::now_utc().format(&Rfc3339).unwrap_or_default()
}

#[cfg(test)]
#[path = "api.test.rs"]
mod tests;
