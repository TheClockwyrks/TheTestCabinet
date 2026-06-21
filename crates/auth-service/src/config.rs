//! Auth service configuration, sourced entirely from environment variables —
//! the same pattern the backend uses, so the service can be driven from a
//! systemd unit or a container with no config file.

/// The default address the Axum server binds when `TCAB_AUTH_BIND` is unset. A
/// loopback default keeps the dev service private until a deployment binds it to
/// a private-network interface.
const DEFAULT_BIND: &str = "127.0.0.1:8789";
/// The default database URL when `TCAB_AUTH_DATABASE_URL` is unset: a local
/// SQLite file, created if missing (`mode=rwc`). Deployments override this with a
/// `postgres://…` URL.
const DEFAULT_DATABASE_URL: &str = "sqlite://./tcab-auth.sqlite?mode=rwc";

/// The fully resolved auth service configuration.
#[derive(Debug, Clone)]
pub struct Config {
    /// Address the Axum server binds (`TCAB_AUTH_BIND`).
    pub bind: String,
    /// The database connection URL (`TCAB_AUTH_DATABASE_URL`). The scheme picks
    /// the backend: `sqlite://…` (local/dev) or `postgres://…` (deployment). This
    /// is the auth service's **own** database, separate from the backend's.
    pub database_url: String,
}

impl Config {
    /// Resolve the configuration from the process environment. Both variables
    /// have defaults, so the service starts with no configuration for local dev.
    pub fn from_env() -> Self {
        Self {
            bind: env_or("TCAB_AUTH_BIND", DEFAULT_BIND),
            database_url: env_or("TCAB_AUTH_DATABASE_URL", DEFAULT_DATABASE_URL),
        }
    }
}

/// Read an environment variable, falling back to a default when unset or empty.
fn env_or(key: &str, default: &str) -> String {
    std::env::var(key)
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| default.to_string())
}
