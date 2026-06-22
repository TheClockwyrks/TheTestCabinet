//! CLI configuration: the backend/auth service URLs and the stored login token.
//!
//! The login token (minted by `tcab login`/`tcab register`) is persisted to
//! `~/.config/tcab/credentials.json` — overridable with `$TCAB_CONFIG_DIR` — and
//! attached to every mutating backend call (push, review, publish). The service
//! URLs come from the environment, matching how the other components are
//! configured.

use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

/// The auth service's loopback default, used when `TCAB_AUTH_URL` is unset.
const DEFAULT_AUTH_URL: &str = "http://127.0.0.1:8789";

/// The persisted login: the bearer token and the account it belongs to.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Credentials {
    /// The bearer token attached to mutating backend requests.
    pub token: String,
    /// The logged-in account's username (shown by `tcab login`/`whoami`).
    pub username: String,
}

/// The backend base URL from `TCAB_BACKEND_URL`, or `None` when unset/blank.
pub fn backend_url() -> Option<String> {
    nonempty_env("TCAB_BACKEND_URL")
}

/// The auth service base URL from `TCAB_AUTH_URL`, falling back to the loopback
/// default so local dev needs no configuration.
pub fn auth_url() -> String {
    nonempty_env("TCAB_AUTH_URL").unwrap_or_else(|| DEFAULT_AUTH_URL.to_string())
}

/// The directory the CLI stores its credentials under: `$TCAB_CONFIG_DIR` when
/// set, otherwise `~/.config/tcab` (or `./.tcab` as a last resort when no home
/// directory is known).
fn config_dir() -> PathBuf {
    if let Some(dir) = nonempty_env("TCAB_CONFIG_DIR") {
        return PathBuf::from(dir);
    }
    if let Some(home) = nonempty_env("HOME") {
        return PathBuf::from(home).join(".config").join("tcab");
    }
    PathBuf::from(".tcab")
}

/// The credentials file path.
fn credentials_path() -> PathBuf {
    config_dir().join("credentials.json")
}

/// Load the stored credentials, or `None` when not logged in (no file, or an
/// unreadable/blank one).
pub fn load_credentials() -> Option<Credentials> {
    let text = std::fs::read_to_string(credentials_path()).ok()?;
    let creds: Credentials = serde_json::from_str(&text).ok()?;
    (!creds.token.is_empty()).then_some(creds)
}

/// The stored bearer token, or `None` when not logged in.
pub fn load_token() -> Option<String> {
    load_credentials().map(|creds| creds.token)
}

/// The stored bearer token, or a clear "log in first" error.
pub fn require_token() -> Result<String> {
    load_token()
        .context("not logged in — run `tcab login --username <name>` (or `tcab register`) first")
}

/// Persist the credentials, creating the config directory as needed.
pub fn save_credentials(creds: &Credentials) -> Result<()> {
    let path = credentials_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating config directory {}", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(creds)?;
    std::fs::write(&path, json).with_context(|| format!("writing {}", path.display()))?;
    Ok(())
}

/// Remove the stored credentials (a no-op when none are stored).
pub fn clear_credentials() -> Result<()> {
    let path = credentials_path();
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(anyhow::Error::new(err).context(format!("removing {}", path.display()))),
    }
}

/// Read a non-empty environment variable, trimmed.
fn nonempty_env(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
