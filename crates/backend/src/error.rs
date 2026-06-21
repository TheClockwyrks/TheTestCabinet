//! The backend's HTTP error envelope (§1 of `design/v0.2.0-contracts.md`).
//!
//! Every endpoint reports failures with one shape —
//! `{ "error": { "code", "message" } }` — and an appropriate status. This module
//! provides [`ApiError`], which constructs that envelope and implements
//! [`IntoResponse`] so handlers can `?`-propagate it, plus the internal
//! [`BackendError`] used by the non-HTTP layers (store, db, ingest, snapshot).

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
    /// expired bearer token on a mutating endpoint.
    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "unauthorized", message)
    }

    /// `502 Bad Gateway` with code `auth_unavailable` — the auth service could
    /// not be reached to verify a token (distinct from a *rejected* token, which
    /// is a `401`).
    pub fn auth_unavailable(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_GATEWAY, "auth_unavailable", message)
    }

    /// `400 Bad Request` with code `bad_request`.
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "bad_request", message)
    }

    /// `422 Unprocessable Entity` with code `unprocessable`. Used for the
    /// publish validation gate (a missing review, an invalid rating).
    pub fn unprocessable(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNPROCESSABLE_ENTITY, "unprocessable", message)
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

/// Errors raised by the backend's non-HTTP layers.
///
/// Handlers translate these into an [`ApiError`] via the [`From`] impl below;
/// most map to `500` because they signal a store/db/upload fault rather than a
/// client mistake, with the variants a client *can* trigger mapped explicitly.
#[derive(Debug, thiserror::Error)]
pub enum BackendError {
    /// A requested entity (test-case version, container, run) is not present.
    #[error("{0}")]
    NotFound(String),

    /// The caller supplied an invalid request (e.g. a path traversal attempt).
    #[error("{0}")]
    BadRequest(String),

    /// A publish was refused by the validation gate (missing review, bad rating).
    #[error("{0}")]
    Unprocessable(String),

    /// A database operation failed (SQLite or PostgreSQL, via SeaORM).
    #[error("database error: {0}")]
    Db(#[from] sea_orm::DbErr),

    /// An I/O operation against the definition store failed.
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    /// (De)serialization failed.
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    /// A core operation (manifest resolution, reference render) failed.
    #[error("{0}")]
    Core(#[from] test_cabinet_core::Error),

    /// A snapshot upload or deploy-hook fire failed.
    #[error("{0}")]
    Snapshot(String),
}

impl From<BackendError> for ApiError {
    fn from(err: BackendError) -> Self {
        match err {
            BackendError::NotFound(msg) => ApiError::not_found(msg),
            BackendError::BadRequest(msg) => ApiError::bad_request(msg),
            BackendError::Unprocessable(msg) => ApiError::unprocessable(msg),
            other => ApiError::internal(other.to_string()),
        }
    }
}

/// Result alias for the backend's internal layers.
pub type Result<T, E = BackendError> = std::result::Result<T, E>;
