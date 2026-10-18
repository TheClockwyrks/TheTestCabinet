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
//!
//! A bind on `0.0.0.0` is deliberate: like the artifact service the arena is a
//! data-plane peer the console reaches over the cluster network, so it binds all
//! interfaces. The deployment fronts it with a private-network boundary, exactly as
//! the other services.

/// The default address the Axum server binds when `TCAB_ARENA_BIND` is unset.
/// Binds all interfaces so the console reaches it over the cluster network; the
/// deployment supplies the private-network boundary.
const DEFAULT_BIND: &str = "0.0.0.0:8791";
/// The default backend URL when `TCAB_BACKEND_URL` is unset: the backend's own
/// loopback default, so local dev works with both services up and no extra
/// configuration.
const DEFAULT_BACKEND_URL: &str = "http://127.0.0.1:8787";
/// The default capacity of the [`MatchExecutor`](crate::executor::MatchExecutor)
/// semaphore when `TCAB_ARENA_MAX_CONCURRENT` is unset. Two CPU-bound runs at once
/// is conservative headroom for a single dedicated arena pod.
const DEFAULT_MAX_CONCURRENT: usize = 2;

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
}

impl Config {
    /// Resolve the configuration from the process environment. Every variable has a
    /// default, so the service starts with no configuration for local dev.
    pub fn from_env() -> Self {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// Resolve the configuration from `lookup`, which answers a variable's value
    /// or `None` when it is unset. An empty value counts as unset.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Self {
        let var = |key: &str| lookup(key).filter(|v| !v.is_empty());
        Self {
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
        }
    }
}

#[cfg(test)]
#[path = "config.test.rs"]
mod tests;
