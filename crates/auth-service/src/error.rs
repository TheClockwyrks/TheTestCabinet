//! The auth service's HTTP error envelope.
//!
//! Mirrors the backend's envelope — `{ "error": { "code", "message" } }` with an
//! appropriate status — so [`test_cabinet_core::AccountsClient`] parses failures
//! from either service the same way.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

/// An error rendered to the contract's HTTP envelope.
#[derive(Debug)]
pub struct ApiError {
    /// The HTTP status the response is sent with.
    pub status: StatusCode,
    /// The stable machine-readable error code (the envelope's `code`).
    pub code: &'static str,
    /// The human-readable explanation (the envelope's `message`).
    pub message: String,
}

impl ApiError {
    /// Construct an error with an explicit status, code, and message.
    pub fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
        }
    }

    /// `400 Bad Request` with code `bad_request` — a malformed or incomplete
    /// registration/login (empty username, too-short password).
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "bad_request", message)
    }

    /// `401 Unauthorized` with code `unauthorized` — bad credentials or an
    /// absent/invalid/expired bearer token.
    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "unauthorized", message)
    }

    /// `409 Conflict` with code `conflict` — a username already taken.
    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, "conflict", message)
    }

    /// `500 Internal Server Error` with code `internal`.
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "internal", message)
    }
}

/// The JSON body of an error response: `{ "error": { "code", "message" } }`.
#[derive(Debug, Serialize)]
struct ErrorEnvelope {
    error: ErrorBody,
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    code: &'static str,
    message: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = ErrorEnvelope {
            error: ErrorBody {
                code: self.code,
                message: self.message,
            },
        };
        (self.status, Json(body)).into_response()
    }
}

/// A database fault is an internal error — the client did nothing wrong, so it
/// never leaks the underlying SeaORM message beyond the log.
impl From<sea_orm::DbErr> for ApiError {
    fn from(err: sea_orm::DbErr) -> Self {
        tracing::error!(error = %err, "auth store error");
        ApiError::internal("auth store error")
    }
}

/// Result alias for the auth service's handlers.
pub type Result<T, E = ApiError> = std::result::Result<T, E>;
