//! Arena-service configuration, sourced entirely from environment variables — the
//! same pattern the backend, auth, and artifact services use, so the service can be
//! driven from a systemd unit or a container with no config file.
//!
//! | Variable | Required | Purpose | Default |
//! | --- | --- | --- | --- |
//! | `TCAB_ARENA_BIND` | no | Address the Axum server binds. | `0.0.0.0:8791` |
//! | `TCAB_BACKEND_URL` | no | The backend the service fetches controller inputs from and persists finished tournaments + replays back to. | `http://127.0.0.1:8787` |
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
        Self {
            bind: env_or("TCAB_ARENA_BIND", DEFAULT_BIND),
            backend_url: env_or("TCAB_BACKEND_URL", DEFAULT_BACKEND_URL)
                .trim_end_matches('/')
                .to_string(),
            max_concurrent_matches: std::env::var("TCAB_ARENA_MAX_CONCURRENT")
                .ok()
                .and_then(|v| v.parse::<usize>().ok())
                .filter(|n| *n > 0)
                .unwrap_or(DEFAULT_MAX_CONCURRENT),
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
