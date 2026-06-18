//! Worker configuration, resolved from the environment.
//!
//! The worker is a [runner](https://test-cabinet) that exposes the core run
//! lifecycle over HTTP. Like the backend it has **no app-level auth** — bind it
//! to a private-network interface (a Tailscale IP) and let reachability be the
//! access control. All configuration is environment variables; no config file is
//! needed.
//!
//! | Variable | Required | Purpose | Default |
//! | --- | --- | --- | --- |
//! | `TCAB_WORKER_BIND` | no | Address the Axum server binds. | `127.0.0.1:8788` |
//! | `TCAB_BACKEND_URL` | yes | The backend the worker resolves definitions from and publishes runs to. | — |
//! | `TCAB_WORKER_OUT_DIR` | no | Directory each run's record + collected implementation is written under. | `./runs` |
//! | `TCAB_WORK_DIR` | no | Staging directory for a run's mountable inputs (seeds, artifacts, capture scratch, materialized definitions). | `./.tcab-worker` |

use std::path::PathBuf;

/// A worker configuration error: a required variable is unset or unusable.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    /// A required environment variable is missing.
    #[error("required environment variable {0} is not set")]
    Missing(&'static str),
}

/// The resolved worker configuration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    /// The address the Axum server binds (`TCAB_WORKER_BIND`).
    pub bind: String,
    /// The backend base URL the worker resolves definitions from and publishes
    /// runs to (`TCAB_BACKEND_URL`). Required: a worker is always backend-driven
    /// (it has no local `test-cases/` checkout).
    pub backend_url: String,
    /// Directory each run's record and collected implementation is written under
    /// (`TCAB_WORKER_OUT_DIR`).
    pub out_dir: PathBuf,
    /// Staging directory for a run's mountable inputs (`TCAB_WORK_DIR`). The
    /// seeded repository is bind-mounted into the container, so on macOS/Windows
    /// this must be a path the runtime's VM shares with the host.
    pub work_dir: PathBuf,
}

impl Config {
    /// The default bind address: the loopback interface on the worker's port.
    /// Override with `TCAB_WORKER_BIND` to expose it on a private-network IP.
    pub const DEFAULT_BIND: &'static str = "127.0.0.1:8788";

    /// Resolve the configuration from the process environment.
    ///
    /// `TCAB_BACKEND_URL` is the only required variable; the rest default. A
    /// blank value is treated as unset so an empty export does not slip through.
    pub fn from_env() -> Result<Self, ConfigError> {
        let bind = non_empty("TCAB_WORKER_BIND").unwrap_or_else(|| Self::DEFAULT_BIND.to_string());
        let backend_url = non_empty("TCAB_BACKEND_URL")
            .ok_or(ConfigError::Missing("TCAB_BACKEND_URL"))?
            .trim_end_matches('/')
            .to_string();
        let out_dir = non_empty("TCAB_WORKER_OUT_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("runs"));
        let work_dir = non_empty("TCAB_WORK_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(".tcab-worker"));
        Ok(Self {
            bind,
            backend_url,
            out_dir,
            work_dir,
        })
    }
}

/// Read an environment variable, treating a blank value as unset.
fn non_empty(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
