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

pub use test_cabinet_contracts::backend_api::error::{ErrorBody, ErrorEnvelope};

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

    /// `401 Unauthorized` with code `unauthorized` — a request carrying no
    /// identity, or an Access assertion or backend token that does not verify.
    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "unauthorized", message)
    }

    /// `403 Forbidden` with code `forbidden` — a verified identity of a kind the
    /// route does not take, such as a person on a route automation drives.
    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, "forbidden", message)
    }

    /// `502 Bad Gateway` with code `auth_unavailable` — the Access signing keys
    /// could not be fetched to verify an assertion (distinct from a *rejected*
    /// assertion, which is a `401`).
    pub fn auth_unavailable(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_GATEWAY, "auth_unavailable", message)
    }

    /// `400 Bad Request` with code `bad_request`.
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "bad_request", message)
    }

    /// `409 Conflict` with code `conflict`. Used when a request conflicts with the
    /// resource's current state — e.g. canceling a run that has already finished.
    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, "conflict", message)
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

    /// `503 Service Unavailable` with code `unavailable` — the backend is serving
    /// but the state this request needs is not yet in place, such as a definition
    /// store awaiting the ingest that makes it readable.
    pub fn unavailable(message: impl Into<String>) -> Self {
        Self::new(StatusCode::SERVICE_UNAVAILABLE, "unavailable", message)
    }
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

    /// A request conflicts with the resource's current state — e.g. a model alias
    /// already claimed by a different curated model.
    #[error("{0}")]
    Conflict(String),

    /// A database operation failed (SQLite or PostgreSQL, via SeaORM).
    #[error("database error: {0}")]
    Db(#[from] sea_orm::DbErr),

    /// An I/O operation against the definition store failed.
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    /// (De)serialization failed.
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    /// Loading or resolving a test case, suite or group, or rendering its prompt,
    /// failed.
    #[error("{0}")]
    Suites(#[from] test_cabinet_suites::Error),

    /// The OpenRouter catalog could not be fetched, read or parsed for a price or
    /// a model's listing (see [`crate::pricing`]).
    #[error("{0}")]
    Pricing(String),

    /// A request to the R2 object store failed.
    #[error("{0}")]
    R2(#[from] crate::r2::R2Error),

    /// A snapshot upload or deploy-hook fire failed.
    #[error("{0}")]
    Snapshot(String),

    /// An internal invariant was violated (e.g. a stored row carries a value the
    /// code no longer recognizes). Maps to `500`.
    #[error("{0}")]
    Internal(String),

    /// A timestamp could not be formatted to RFC 3339. Effectively unreachable —
    /// formatting the current time does not fail in practice — but surfaced
    /// rather than unwrapped so a startup path can `?`-propagate it.
    #[error("formatting timestamp: {0}")]
    Time(#[from] time::error::Format),
}

impl From<BackendError> for ApiError {
    fn from(err: BackendError) -> Self {
        match err {
            BackendError::NotFound(msg) => ApiError::not_found(msg),
            BackendError::BadRequest(msg) => ApiError::bad_request(msg),
            BackendError::Unprocessable(msg) => ApiError::unprocessable(msg),
            BackendError::Conflict(msg) => ApiError::conflict(msg),
            other => ApiError::internal(other.to_string()),
        }
    }
}

/// Result alias for the backend's internal layers.
pub type Result<T, E = BackendError> = std::result::Result<T, E>;
