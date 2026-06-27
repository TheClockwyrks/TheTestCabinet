//! Artifact-service configuration, sourced entirely from environment variables —
//! the same pattern the backend and auth service use, so the service can be
//! driven from a systemd unit or a container with no config file.
//!
//! | Variable | Required | Purpose | Default |
//! | --- | --- | --- | --- |
//! | `TCAB_ARTIFACTS_BIND` | no | Address the Axum server binds. | `0.0.0.0:8790` |
//! | `TCAB_ARTIFACTS_ROOT` | no | The [`LocalFsStore`](crate::store::LocalFsStore) root dir (a PVC in a deployment). | `./tcab-artifacts` |
//! | `TCAB_BACKEND_URL` | no | The backend the service forwards a driver's per-job token to for upload auth (the backend is the token authority). | `http://127.0.0.1:8787` |
//! | `TCAB_BACKEND_SERVICE_TOKEN` | no | The shared control-plane service token a `DELETE /runs/{id}/artifacts` must present (the backend prunes a deleted run's tree). Unset ⇒ deletion is disabled (the route rejects every caller). | _none_ |
//!
//! Reads (a reviewer's build/media pulls) are ungated — the console loads them as
//! browser media that cannot carry a token — so the service needs no auth-service
//! URL.
//!
//! A bind on `0.0.0.0` is deliberate: unlike the backend/auth service (which
//! default to loopback for a single-box dev run), the artifact service is a
//! data-plane peer the driver and console both reach over the cluster network, so
//! it binds all interfaces. The deployment still fronts it with a private-network
//! boundary, exactly as the other services.

/// The default address the Axum server binds when `TCAB_ARTIFACTS_BIND` is unset.
/// Binds all interfaces so the driver (upload) and console (read) reach it over
/// the cluster network; the deployment supplies the private-network boundary.
const DEFAULT_BIND: &str = "0.0.0.0:8790";
/// The default on-disk store root when `TCAB_ARTIFACTS_ROOT` is unset. A
/// deployment overrides this with a PVC mount path.
const DEFAULT_ROOT: &str = "./tcab-artifacts";
/// The default backend URL when `TCAB_BACKEND_URL` is unset: the backend's own
/// loopback default, so local dev works with both services up and no extra
/// configuration.
const DEFAULT_BACKEND_URL: &str = "http://127.0.0.1:8787";

/// The fully resolved artifact-service configuration.
#[derive(Debug, Clone)]
pub struct Config {
    /// Address the Axum server binds (`TCAB_ARTIFACTS_BIND`).
    pub bind: String,
    /// The [`LocalFsStore`](crate::store::LocalFsStore) root directory
    /// (`TCAB_ARTIFACTS_ROOT`) — a PVC mount in a deployment, a plain directory in
    /// local dev. Each run's artifact tree lives at `<root>/<run-id>/`.
    pub root: std::path::PathBuf,
    /// The backend base URL (`TCAB_BACKEND_URL`), without a trailing slash. The
    /// service forwards a driver's per-job token here
    /// (`POST /jobs/{id}/verify-token`) to authenticate an upload; the backend is
    /// the token authority.
    pub backend_url: String,
    /// The shared control-plane service token (`TCAB_BACKEND_SERVICE_TOKEN`) a
    /// run-tree delete must present. It is the same secret the backend and
    /// dispatcher share, so only a trusted control-plane caller (the backend, when
    /// a run is deleted) can prune a tree. `None` disables the delete route
    /// entirely — it rejects every caller — which is the safe default for a dev or
    /// single-box setup that never deletes through the data plane.
    pub service_token: Option<String>,
}

impl Config {
    /// Resolve the configuration from the process environment. Every variable has
    /// a default, so the service starts with no configuration for local dev.
    pub fn from_env() -> Self {
        Self {
            bind: env_or("TCAB_ARTIFACTS_BIND", DEFAULT_BIND),
            root: std::path::PathBuf::from(env_or("TCAB_ARTIFACTS_ROOT", DEFAULT_ROOT)),
            backend_url: env_or("TCAB_BACKEND_URL", DEFAULT_BACKEND_URL)
                .trim_end_matches('/')
                .to_string(),
            service_token: nonempty("TCAB_BACKEND_SERVICE_TOKEN"),
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

/// Read a non-empty environment variable, returning `None` when unset or empty.
fn nonempty(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.is_empty())
}
