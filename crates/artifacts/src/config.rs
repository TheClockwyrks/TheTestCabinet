//! Artifact-service configuration, sourced entirely from environment variables —
//! the same pattern the backend uses, so the service can be driven from a systemd
//! unit or a container with no config file.
//!
//! | Variable | Required | Purpose | Default |
//! | --- | --- | --- | --- |
//! | `TCAB_ARTIFACTS_BIND` | no | Address the Axum server binds. | `0.0.0.0:8790` |
//! | `TCAB_ARTIFACTS_ROOT` | no | The [`LocalFsStore`](crate::store::LocalFsStore) root dir (a PVC in a deployment). | `./tcab-artifacts` |
//! | `TCAB_BACKEND_URL` | no | The backend the service forwards a driver's per-job token to for upload auth (the backend is the token authority). | `http://127.0.0.1:8787` |
//! | `TCAB_BACKEND_SERVICE_TOKEN` | no | The shared control-plane service token the backend's tree-management routes must present: `DELETE /runs/{id}/artifacts` (pruning a deleted run's tree) and `GET /runs` (listing stored trees for the reclamation sweep). Unset ⇒ tree management is disabled (both routes reject every caller). | _none_ |
//! | `TCAB_ACCESS_TEAM_DOMAIN` | no | The Access team domain whose certificates sign the `Cf-Access-Jwt-Assertion` every edge request carries. Set together with `TCAB_ACCESS_AUDIENCE`. | _none_ |
//! | `TCAB_ACCESS_AUDIENCE` | no | The audience tag of the Access application protecting the service's hostname. Set together with `TCAB_ACCESS_TEAM_DOMAIN`. | _none_ |
//!
//! The two `TCAB_ACCESS_*` variables are set together, so the service verifies
//! every edge request's assertion, or not at all, the local overlay's shape, in
//! which the service takes a person's identity from the
//! `Cf-Access-Authenticated-User-Email` header as presented. One without the other
//! is a [`ConfigError`], so a deployment that lost one fails to start rather than
//! trusting a header anyone can send. See [`crate::auth`].
//!
//! A bind on `0.0.0.0` is deliberate: unlike the backend (which defaults to
//! loopback for a single-box dev run), the artifact service is a data-plane peer
//! the driver reaches over the cluster network and the edge's tunnel forwards the
//! console's requests to, so it binds all interfaces.

/// The default address the Axum server binds when `TCAB_ARTIFACTS_BIND` is unset.
/// Binds all interfaces so the driver (upload) and the edge's tunnel (a console's
/// reads) reach it over the cluster network.
const DEFAULT_BIND: &str = "0.0.0.0:8790";
/// The default on-disk store root when `TCAB_ARTIFACTS_ROOT` is unset. A
/// deployment overrides this with a PVC mount path.
const DEFAULT_ROOT: &str = "./tcab-artifacts";
/// The default backend URL when `TCAB_BACKEND_URL` is unset: the backend's own
/// loopback default, so local dev works with both services up and no extra
/// configuration.
const DEFAULT_BACKEND_URL: &str = "http://127.0.0.1:8787";

pub use crate::access::AccessConfig;

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
    /// The shared control-plane service token (`TCAB_BACKEND_SERVICE_TOKEN`) the
    /// backend's two tree-management routes must present: the run-tree delete and
    /// the `GET /runs` listing its reclamation sweep enumerates the volume with. It
    /// is the same secret the backend and dispatcher share, so only a trusted
    /// control-plane caller can enumerate or prune trees. `None` disables both routes
    /// entirely — they reject every caller — which is the safe default for a dev or
    /// single-box setup that never manages trees through the data plane.
    pub service_token: Option<String>,
    /// The Access application the service verifies an edge request's assertion
    /// against (`TCAB_ACCESS_TEAM_DOMAIN` and `TCAB_ACCESS_AUDIENCE`), or `None`
    /// when neither is set and the service takes the identity from the local
    /// identity header instead.
    pub access: Option<AccessConfig>,
}

/// A configuration the service refuses to start with.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    /// One of a pair of variables that are set together was set alone.
    #[error(
        "`{set}` is set but `{unset}` is not: set both to verify Access assertions, or \
         neither to take the identity from Cf-Access-Authenticated-User-Email"
    )]
    Unpaired {
        /// The variable that was set.
        set: &'static str,
        /// The variable that was not.
        unset: &'static str,
    },
}

impl Config {
    /// Resolve the configuration from the process environment. Every variable has
    /// a default, so the service starts with no configuration for local dev; only an
    /// unpaired `TCAB_ACCESS_*` variable is refused.
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// Resolve the configuration from `lookup`, which answers a variable's value
    /// or `None` when it is unset. An empty value counts as unset.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let var = |key: &str| lookup(key).filter(|v| !v.is_empty());
        Ok(Self {
            bind: var("TCAB_ARTIFACTS_BIND").unwrap_or_else(|| DEFAULT_BIND.to_string()),
            root: std::path::PathBuf::from(
                var("TCAB_ARTIFACTS_ROOT").unwrap_or_else(|| DEFAULT_ROOT.to_string()),
            ),
            backend_url: var("TCAB_BACKEND_URL")
                .unwrap_or_else(|| DEFAULT_BACKEND_URL.to_string())
                .trim_end_matches('/')
                .to_string(),
            service_token: var("TCAB_BACKEND_SERVICE_TOKEN"),
            access: access_config(var("TCAB_ACCESS_TEAM_DOMAIN"), var("TCAB_ACCESS_AUDIENCE"))?,
        })
    }
}

/// Resolve the Access application from the two variables naming it. Both set is a
/// service that verifies assertions, both unset one that takes the local identity
/// header, and one without the other is refused.
fn access_config(
    team_domain: Option<String>,
    audience: Option<String>,
) -> Result<Option<AccessConfig>, ConfigError> {
    match (team_domain, audience) {
        (Some(team_domain), Some(audience)) => Ok(Some(AccessConfig {
            team_domain,
            audience,
        })),
        (None, None) => Ok(None),
        (Some(_), None) => Err(ConfigError::Unpaired {
            set: "TCAB_ACCESS_TEAM_DOMAIN",
            unset: "TCAB_ACCESS_AUDIENCE",
        }),
        (None, Some(_)) => Err(ConfigError::Unpaired {
            set: "TCAB_ACCESS_AUDIENCE",
            unset: "TCAB_ACCESS_TEAM_DOMAIN",
        }),
    }
}

#[cfg(test)]
#[path = "config.test.rs"]
mod tests;
