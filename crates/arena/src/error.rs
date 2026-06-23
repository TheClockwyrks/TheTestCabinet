//! The arena service's HTTP error envelope.
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

    /// `404 Not Found` with code `not_found` — an unknown tournament job.
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, "not_found", message)
    }

    /// `400 Bad Request` with code `bad_request` — an unresolvable controller, a
    /// too-small field, or a controller kind that is not resolvable in the service
    /// topology (a run-local controller).
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "bad_request", message)
    }

    /// `503 Service Unavailable` with code `at_capacity` — the capacity guard
    /// rejected the work because every concurrency permit is in use. The CPU-bound
    /// arena does not queue; the caller should retry later.
    pub fn service_unavailable(message: impl Into<String>) -> Self {
        Self::new(StatusCode::SERVICE_UNAVAILABLE, "at_capacity", message)
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
