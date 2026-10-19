//! CLI configuration: the backend URL and the bearer token, both from the
//! environment, matching how the other components are configured.

use anyhow::{Context, Result};

/// The backend base URL from `TCAB_BACKEND_URL`, or `None` when unset/blank.
pub fn backend_url() -> Option<String> {
    nonempty_env("TCAB_BACKEND_URL")
}

/// The bearer token attached to mutating backend calls: the value of `TCAB_TOKEN`.
pub fn load_token() -> Option<String> {
    nonempty_env("TCAB_TOKEN")
}

/// The bearer token, or a clear error naming the variable that carries it.
pub fn require_token() -> Result<String> {
    load_token().context("set TCAB_TOKEN to a bearer token the backend accepts")
}

/// The backend's shared service token, `TCAB_BACKEND_SERVICE_TOKEN`, which a call to a
/// local backend that takes the service token presents, since no edge stands in
/// front of it to assert an identity.
pub fn service_token() -> Option<String> {
    nonempty_env("TCAB_BACKEND_SERVICE_TOKEN")
}

/// Read a non-empty environment variable, trimmed.
fn nonempty_env(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
