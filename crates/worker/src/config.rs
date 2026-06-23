//! Worker configuration, resolved from the environment.
//!
//! The worker is a [runner](https://test-cabinet) that exposes the core run
//! lifecycle over HTTP. Like the backend it has **no app-level auth** — bind it
//! to a private-network interface (in a cluster, a `ClusterIP`/headless `Service`
//! with no public ingress) and let reachability be the access control. All
//! configuration is environment variables; no config file is needed.
//!
//! | Variable | Required | Purpose | Default |
//! | --- | --- | --- | --- |
//! | `TCAB_WORKER_BIND` | no | Address the Axum server binds. | `127.0.0.1:8788` |
//! | `TCAB_BACKEND_URL` | yes | The backend the worker resolves definitions from and publishes runs to. | — |
//! | `TCAB_WORKER_OUT_DIR` | no | Directory each run's record + collected implementation is written under. | `./runs` |
//! | `TCAB_WORK_DIR` | no | Staging directory for a run's mountable inputs (seeds, artifacts, capture scratch, materialized definitions). | `./.tcab-worker` |
//! | `TCAB_WORKER_RUNTIME` | no | How each run's container is started: `cli` (host Docker/Podman) or `kubernetes` (a run pod per run via the API). | `cli` |
//!
//! When `TCAB_WORKER_RUNTIME=kubernetes`, the run-pod settings (`TCAB_K8S_*`,
//! documented on [`KubernetesConfig`](crate::kubernetes::KubernetesConfig)) are
//! also read. They are ignored under the `cli` runtime.

use std::path::PathBuf;
use std::time::Duration;

use crate::kubernetes::{KubernetesConfig, in_cluster_namespace};

/// How the worker starts each run's container.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkerRuntime {
    /// Shell out to a host Docker/Podman (local development, single-box).
    Cli,
    /// Create one run pod per run through the Kubernetes API (cluster deployment).
    Kubernetes,
}

/// A worker configuration error: a required variable is unset or unusable.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    /// A required environment variable is missing.
    #[error("required environment variable {0} is not set")]
    Missing(&'static str),
    /// A variable carried a value that could not be parsed.
    #[error("environment variable {name} has an invalid value `{value}`: {detail}")]
    Invalid {
        /// The offending variable.
        name: &'static str,
        /// The value that failed to parse.
        value: String,
        /// Why it failed.
        detail: String,
    },
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
    /// The auth service base URL the worker proxies register/login to
    /// (`TCAB_AUTH_URL`). The console reaches auth through the worker; the worker
    /// forwards the user's bearer token to the backend on mutating calls. Defaults
    /// to the auth service's loopback address for local dev.
    pub auth_url: String,
    /// Directory each run's record and collected implementation is written under
    /// (`TCAB_WORKER_OUT_DIR`).
    pub out_dir: PathBuf,
    /// Staging directory for a run's mountable inputs (`TCAB_WORK_DIR`). The
    /// seeded repository is bind-mounted into the container, so on macOS/Windows
    /// this must be a path the runtime's VM shares with the host.
    pub work_dir: PathBuf,
    /// How each run's container is started (`TCAB_WORKER_RUNTIME`).
    pub runtime: WorkerRuntime,
    /// Run-pod settings used when [`runtime`](Self::runtime) is
    /// [`WorkerRuntime::Kubernetes`]; left at defaults (and unused) otherwise.
    pub kubernetes: KubernetesConfig,
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
        let auth_url = non_empty("TCAB_AUTH_URL")
            .unwrap_or_else(|| "http://127.0.0.1:8789".to_string())
            .trim_end_matches('/')
            .to_string();
        let out_dir = non_empty("TCAB_WORKER_OUT_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("runs"));
        let work_dir = non_empty("TCAB_WORK_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(".tcab-worker"));
        let runtime = match non_empty("TCAB_WORKER_RUNTIME").as_deref() {
            None | Some("cli") => WorkerRuntime::Cli,
            Some("kubernetes" | "k8s") => WorkerRuntime::Kubernetes,
            Some(other) => {
                return Err(ConfigError::Invalid {
                    name: "TCAB_WORKER_RUNTIME",
                    value: other.to_string(),
                    detail: "expected `cli` or `kubernetes`".to_string(),
                });
            }
        };
        let kubernetes = kubernetes_from_env()?;
        Ok(Self {
            bind,
            backend_url,
            auth_url,
            out_dir,
            work_dir,
            runtime,
            kubernetes,
        })
    }
}

/// Resolve the Kubernetes run-pod settings from the environment. These are read
/// regardless of the selected runtime (cheap), but only consulted under the
/// `kubernetes` runtime.
fn kubernetes_from_env() -> Result<KubernetesConfig, ConfigError> {
    let defaults = KubernetesConfig::default();
    let namespace = non_empty("TCAB_K8S_NAMESPACE")
        .or_else(in_cluster_namespace)
        .unwrap_or(defaults.namespace);
    let pod_ready_timeout = match non_empty("TCAB_K8S_POD_READY_TIMEOUT_SECONDS") {
        Some(value) => {
            let seconds: u64 =
                value
                    .parse()
                    .map_err(|err: std::num::ParseIntError| ConfigError::Invalid {
                        name: "TCAB_K8S_POD_READY_TIMEOUT_SECONDS",
                        value: value.clone(),
                        detail: err.to_string(),
                    })?;
            Duration::from_secs(seconds)
        }
        None => defaults.pod_ready_timeout,
    };
    let image_pull_secrets = non_empty("TCAB_K8S_IMAGE_PULL_SECRETS")
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    Ok(KubernetesConfig {
        namespace,
        run_service_account: non_empty("TCAB_K8S_RUN_SERVICE_ACCOUNT"),
        image_pull_secrets,
        cpu_request: non_empty("TCAB_K8S_RUN_CPU_REQUEST"),
        cpu_limit: non_empty("TCAB_K8S_RUN_CPU_LIMIT"),
        memory_request: non_empty("TCAB_K8S_RUN_MEMORY_REQUEST"),
        memory_limit: non_empty("TCAB_K8S_RUN_MEMORY_LIMIT"),
        pod_ready_timeout,
        pod_ip: non_empty("TCAB_K8S_POD_IP"),
        run_pod_prefix: non_empty("TCAB_K8S_RUN_POD_PREFIX").unwrap_or(defaults.run_pod_prefix),
    })
}

/// Read an environment variable, treating a blank value as unset.
fn non_empty(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
