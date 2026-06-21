//! Auth proxy endpoints: register and login forwarded to the standalone auth
//! service.
//!
//! The web console only knows the worker's address, so it reaches account
//! registration and login through the worker; the worker forwards to the auth
//! service (`TCAB_AUTH_URL`) and relays the minted token + account back. The
//! console then sends that token as `Authorization: Bearer` on its push/review/
//! publish calls, which the worker forwards to the backend.

use axum::Json;
use axum::extract::State;
use test_cabinet_core::{AccountsClient, AuthnResponse, LoginRequest, RegisterRequest};

use crate::api::AppState;
use crate::error::ApiError;

/// `POST /auth/register` — proxy account creation to the auth service.
pub async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterRequest>,
) -> Result<Json<AuthnResponse>, ApiError> {
    let response = AccountsClient::new(state.config.auth_url.clone())
        .register(&body)
        .await
        .map_err(|err| ApiError::bad_request(err.to_string()))?;
    Ok(Json(response))
}

/// `POST /auth/login` — proxy login to the auth service.
pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<AuthnResponse>, ApiError> {
    let response = AccountsClient::new(state.config.auth_url.clone())
        .login(&body)
        .await
        .map_err(|err| ApiError::unauthorized(err.to_string()))?;
    Ok(Json(response))
}
