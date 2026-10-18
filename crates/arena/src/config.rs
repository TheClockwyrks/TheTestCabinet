//! Arena-service configuration, sourced entirely from environment variables — the
//! same pattern the backend and artifact services use, so the service can be
//! driven from a systemd unit or a container with no config file.
//!
//! | Variable | Required | Purpose | Default |
//! | --- | --- | --- | --- |
//! | `TCAB_ARENA_BIND` | no | Address the Axum server binds. | `0.0.0.0:8791` |
//! | `TCAB_BACKEND_URL` | no | The backend the service fetches controller inputs from and persists finished tournaments + replays back to. | `http://127.0.0.1:8787` |
//! | `TCAB_BACKEND_SERVICE_TOKEN` | no | The shared service token the service presents on every backend call: every read needs an identity, and persisting a tournament takes the service token. Unset, the service presents none and the backend refuses its calls. | — |
//! | `TCAB_ARENA_MAX_CONCURRENT` | no | The capacity guard: how many matches/tournaments may run their CPU-bound wasm concurrently before the service rejects with `503`. | `2` |
//! | `TCAB_ACCESS_TEAM_DOMAIN` | no | The Access team domain whose certificates sign the `Cf-Access-Jwt-Assertion` every edge request carries. Set together with `TCAB_ACCESS_AUDIENCE`. | — |
//! | `TCAB_ACCESS_AUDIENCE` | no | The audience tag of the Access application protecting the arena's hostname. Set together with `TCAB_ACCESS_TEAM_DOMAIN`. | — |
//!
//! The two `TCAB_ACCESS_*` variables are set together, so the arena verifies every
//! request's assertion, or not at all, the local overlay's shape, in which it takes
//! a person's identity from the `Cf-Access-Authenticated-User-Email` header as
//! presented. One without the other is a [`ConfigError`], so a deployment that lost
//! one fails to start rather than trusting a header anyone can send. See
//! [`crate::auth`].
//!
//! A bind on `0.0.0.0` is deliberate: like the artifact service the arena is a
//! data-plane peer the edge's tunnel forwards the console's requests to over the
//! cluster network, so it binds all interfaces.

/// The default address the Axum server binds when `TCAB_ARENA_BIND` is unset.
/// Binds all interfaces so the edge's tunnel reaches it over the cluster network.
const DEFAULT_BIND: &str = "0.0.0.0:8791";
/// The default backend URL when `TCAB_BACKEND_URL` is unset: the backend's own
/// loopback default, so local dev works with both services up and no extra
/// configuration.
const DEFAULT_BACKEND_URL: &str = "http://127.0.0.1:8787";
/// The default capacity of the [`MatchExecutor`](crate::executor::MatchExecutor)
/// semaphore when `TCAB_ARENA_MAX_CONCURRENT` is unset. Two CPU-bound runs at once
/// is conservative headroom for a single dedicated arena pod.
const DEFAULT_MAX_CONCURRENT: usize = 2;

pub use crate::access::AccessConfig;

/// The fully resolved arena-service configuration.
#[derive(Debug, Clone)]
pub struct Config {
    /// Address the Axum server binds (`TCAB_ARENA_BIND`).
    pub bind: String,
    /// The backend base URL (`TCAB_BACKEND_URL`), without a trailing slash. The
    /// service fetches controller inputs from it (resolve a version, baseline
    /// `references/<id>.wasm`, a pushed run's `controller.wasm`, the pushed-controller
    /// listing) and persists finished tournaments + replays back to it. The arena
    /// holds no state of its own.
    pub backend_url: String,
    /// The shared service token (`TCAB_BACKEND_SERVICE_TOKEN`) the service presents
    /// as `Authorization: Bearer` on every backend call, reads included, or `None`
    /// when unset. The backend's routes for persisting a tournament take it, and
    /// every other route needs an identity.
    pub backend_service_token: Option<String>,
    /// The capacity guard (`TCAB_ARENA_MAX_CONCURRENT`): the maximum number of
    /// matches/tournaments whose CPU-bound wasm may run concurrently. At capacity
    /// the service rejects with `503` rather than queueing, so a flood can't starve
    /// the pod.
    pub max_concurrent_matches: usize,
    /// The Access application the arena verifies a request's assertion against
    /// (`TCAB_ACCESS_TEAM_DOMAIN` and `TCAB_ACCESS_AUDIENCE`), or `None` when neither
    /// is set and the arena takes the identity from the local identity header.
    pub access: Option<AccessConfig>,
}

/// A configuration the arena refuses to start with.
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
    /// Resolve the configuration from the process environment. Every variable has a
    /// default, so the service starts with no configuration for local dev; only an
    /// unpaired `TCAB_ACCESS_*` variable is refused.
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// Resolve the configuration from `lookup`, which answers a variable's value
    /// or `None` when it is unset. An empty value counts as unset.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let var = |key: &str| lookup(key).filter(|v| !v.is_empty());
        Ok(Self {
            bind: var("TCAB_ARENA_BIND").unwrap_or_else(|| DEFAULT_BIND.to_string()),
            backend_url: var("TCAB_BACKEND_URL")
                .unwrap_or_else(|| DEFAULT_BACKEND_URL.to_string())
                .trim_end_matches('/')
                .to_string(),
            backend_service_token: var("TCAB_BACKEND_SERVICE_TOKEN"),
            max_concurrent_matches: var("TCAB_ARENA_MAX_CONCURRENT")
                .and_then(|v| v.parse::<usize>().ok())
                .filter(|n| *n > 0)
                .unwrap_or(DEFAULT_MAX_CONCURRENT),
            access: access_config(var("TCAB_ACCESS_TEAM_DOMAIN"), var("TCAB_ACCESS_AUDIENCE"))?,
        })
    }
}

/// Resolve the Access application from the two variables naming it. Both set is an
/// arena that verifies assertions, both unset one that takes the local identity
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
