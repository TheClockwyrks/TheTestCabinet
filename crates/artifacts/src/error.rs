//! The artifact service's HTTP error envelope.
//!
//! Every endpoint reports failures with the same shape the backend uses —
//! `{ "error": { "code", "message" } }` — and an appropriate status, so a console
//! that already understands the backend's envelope reads these identically.

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

    /// `404 Not Found` with code `not_found`.
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, "not_found", message)
    }

    /// `401 Unauthorized` with code `unauthorized` — an absent, invalid, or
    /// expired token on a gated endpoint.
    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "unauthorized", message)
    }

    /// `400 Bad Request` with code `bad_request` — a malformed upload (a path that
    /// escapes the run directory, an unreadable tarball).
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "bad_request", message)
    }

    /// `502 Bad Gateway` with code `auth_unavailable` — an upstream the service
    /// depends on (the auth service for reads, the backend for upload auth) could
    /// not be reached, distinct from a *rejected* token (a `401`).
    pub fn auth_unavailable(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_GATEWAY, "auth_unavailable", message)
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

/// The `error` member of an [`ErrorEnvelope`].
#[derive(Debug, Serialize)]
struct ErrorBody {
    code: String,
    message: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = ErrorEnvelope {
            error: ErrorBody {
                code: self.code.to_string(),
                message: self.message,
            },
        };
        (self.status, Json(body)).into_response()
    }
}
