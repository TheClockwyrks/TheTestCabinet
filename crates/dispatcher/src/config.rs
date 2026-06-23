//! Dispatcher configuration, resolved from the environment.
//!
//! The dispatcher is a thin, stateless controller: it claims queued jobs from the
//! backend and turns each into one Kubernetes `Job` that runs the driver image.
//! Everything it needs arrives through the environment — there is no config file,
//! no HTTP server, and no flags. The backend's `job` table is the source of truth,
//! so the dispatcher holds no durable state of its own.
//!
//! | Variable | Required | Purpose | Default |
//! | --- | --- | --- | --- |
//! | `TCAB_BACKEND_URL` | yes | The backend the dispatcher claims jobs from (`POST /jobs/next`) and reports driver-pod deaths to (`POST /jobs/{id}/status`). | — |
//! | `TCAB_BACKEND_SERVICE_TOKEN` | yes | The shared service token authenticating the claim (`ServiceAuth`); see `backend/src/auth.rs`. | — |
//! | `TCAB_DRIVER_IMAGE` | yes | The driver container image each created `Job`'s pod runs. | — |
//! | `TCAB_DISPATCHER_NAMESPACE` | no | The namespace the dispatcher creates driver `Job`s in. | the in-cluster namespace, else `default` |
//! | `TCAB_DISPATCHER_DRIVER_SA` | no | The ServiceAccount assigned to each driver pod (the repurposed `tcab-worker` RBAC that can create/exec/delete sandbox pods). `None` uses the namespace default. | — |
//! | `TCAB_DISPATCHER_MAX_INFLIGHT` | no | The maximum number of non-terminal driver `Job`s the dispatcher keeps in flight (queue admission). | `8` |
//! | `TCAB_DISPATCHER_POLL_INTERVAL_SECONDS` | no | How long to back off after an empty claim or a full in-flight cap before polling again. | `2` |
//! | `TCAB_DISPATCHER_JOB_TTL_SECONDS` | no | `ttlSecondsAfterFinished` on each driver `Job`, for automatic cleanup once it terminates. | `300` |
//!
//! The `TCAB_K8S_RUN_*` set below is **passed through** into each driver `Job`'s
//! env verbatim — the dispatcher does not consume it, the driver does (see the
//! driver's `KubernetesConfig`). It scopes the *sandbox* pods the driver creates,
//! not the driver pod itself.
//!
//! | Variable | Purpose |
//! | --- | --- |
//! | `TCAB_K8S_NAMESPACE` | Namespace the driver creates sandbox pods in (defaults to the driver pod's own namespace). |
//! | `TCAB_K8S_RUN_SERVICE_ACCOUNT` | ServiceAccount for sandbox pods (usually unset — they need no API access). |
//! | `TCAB_K8S_IMAGE_PULL_SECRETS` | Comma-separated `imagePullSecret` names for the run-container image. |
//! | `TCAB_K8S_RUN_CPU_REQUEST` / `TCAB_K8S_RUN_CPU_LIMIT` | CPU request/limit per sandbox pod. |
//! | `TCAB_K8S_RUN_MEMORY_REQUEST` / `TCAB_K8S_RUN_MEMORY_LIMIT` | Memory request/limit per sandbox pod. |
//! | `TCAB_K8S_POD_READY_TIMEOUT_SECONDS` | How long the driver waits for a sandbox pod to reach `Running`. |
//! | `TCAB_K8S_RUN_POD_PREFIX` | Name prefix for sandbox pods. |
//!
//! `TCAB_K8S_POD_IP` is **not** taken from the environment here: the driver's own
//! pod IP is set on the `Job` via the downward API (`fieldRef: status.podIP`), so
//! the dispatcher never knows or forwards it (see [`crate::job`]).

use std::time::Duration;

/// The set of `TCAB_K8S_RUN_*` (and sibling sandbox-pod) variables the dispatcher
/// passes through into each driver `Job`'s env verbatim. Listed once so the Job
/// builder and the config doc stay in sync; the dispatcher never interprets their
/// values, only forwards the ones that are set.
pub const PASSTHROUGH_K8S_VARS: &[&str] = &[
    "TCAB_K8S_NAMESPACE",
    "TCAB_K8S_RUN_SERVICE_ACCOUNT",
    "TCAB_K8S_IMAGE_PULL_SECRETS",
    "TCAB_K8S_RUN_CPU_REQUEST",
    "TCAB_K8S_RUN_CPU_LIMIT",
    "TCAB_K8S_RUN_MEMORY_REQUEST",
    "TCAB_K8S_RUN_MEMORY_LIMIT",
    "TCAB_K8S_POD_READY_TIMEOUT_SECONDS",
    "TCAB_K8S_RUN_POD_PREFIX",
];

/// A dispatcher configuration error: a required variable is unset or unusable.
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

/// The resolved dispatcher configuration.
#[derive(Debug, Clone)]
pub struct Config {
    /// The backend base URL the dispatcher claims jobs from and reports driver-pod
    /// deaths to (`TCAB_BACKEND_URL`), without a trailing slash.
    pub backend_url: String,
    /// The shared service token authenticating the claim (`TCAB_BACKEND_SERVICE_TOKEN`).
    pub service_token: String,
    /// The driver container image each created `Job`'s pod runs (`TCAB_DRIVER_IMAGE`).
    pub driver_image: String,
    /// The namespace the dispatcher creates driver `Job`s in
    /// (`TCAB_DISPATCHER_NAMESPACE`).
    pub namespace: String,
    /// The ServiceAccount assigned to each driver pod (`TCAB_DISPATCHER_DRIVER_SA`).
    /// `None` uses the namespace default. The repurposed `tcab-worker` RBAC that
    /// can create/exec/delete sandbox pods.
    pub driver_service_account: Option<String>,
    /// The maximum number of non-terminal driver `Job`s the dispatcher keeps in
    /// flight (`TCAB_DISPATCHER_MAX_INFLIGHT`).
    pub max_inflight: usize,
    /// How long to back off after an empty claim or a full in-flight cap before
    /// polling again (`TCAB_DISPATCHER_POLL_INTERVAL_SECONDS`).
    pub poll_interval: Duration,
    /// `ttlSecondsAfterFinished` on each driver `Job` (`TCAB_DISPATCHER_JOB_TTL_SECONDS`).
    pub job_ttl_seconds: i32,
    /// The `TCAB_K8S_RUN_*` (and sibling) sandbox-pod variables that are set,
    /// captured at startup to pass through into each driver `Job`'s env. The driver
    /// reads them; the dispatcher only forwards them.
    pub passthrough_k8s_env: Vec<(String, String)>,
}

impl Config {
    /// Resolve the configuration from the process environment.
    ///
    /// `TCAB_BACKEND_URL`, `TCAB_BACKEND_SERVICE_TOKEN`, and `TCAB_DRIVER_IMAGE`
    /// are required; the rest default. A blank value is treated as unset so an
    /// empty export does not slip through. The namespace defaults to the
    /// dispatcher's own in-cluster namespace (so a single manifest works in any
    /// namespace), falling back to `default` outside a cluster.
    pub fn from_env() -> Result<Self, ConfigError> {
        let backend_url = non_empty("TCAB_BACKEND_URL")
            .ok_or(ConfigError::Missing("TCAB_BACKEND_URL"))?
            .trim_end_matches('/')
            .to_string();
        let service_token = non_empty("TCAB_BACKEND_SERVICE_TOKEN")
            .ok_or(ConfigError::Missing("TCAB_BACKEND_SERVICE_TOKEN"))?;
        let driver_image =
            non_empty("TCAB_DRIVER_IMAGE").ok_or(ConfigError::Missing("TCAB_DRIVER_IMAGE"))?;

        let namespace = non_empty("TCAB_DISPATCHER_NAMESPACE")
            .or_else(in_cluster_namespace)
            .unwrap_or_else(|| "default".to_string());
        let driver_service_account = non_empty("TCAB_DISPATCHER_DRIVER_SA");

        let max_inflight = parse_or("TCAB_DISPATCHER_MAX_INFLIGHT", 8usize)?.max(1);
        let poll_seconds = parse_or("TCAB_DISPATCHER_POLL_INTERVAL_SECONDS", 2u64)?;
        let job_ttl_seconds = parse_or("TCAB_DISPATCHER_JOB_TTL_SECONDS", 300i32)?;

        let passthrough_k8s_env = PASSTHROUGH_K8S_VARS
            .iter()
            .filter_map(|&key| non_empty(key).map(|value| (key.to_string(), value)))
            .collect();

        Ok(Self {
            backend_url,
            service_token,
            driver_image,
            namespace,
            driver_service_account,
            max_inflight,
            poll_interval: Duration::from_secs(poll_seconds),
            job_ttl_seconds,
            passthrough_k8s_env,
        })
    }
}

/// The namespace the dispatcher is running in, read from the in-cluster service
/// account, for use as the default Job namespace when `TCAB_DISPATCHER_NAMESPACE`
/// is unset. Returns `None` outside a cluster (the file is absent).
fn in_cluster_namespace() -> Option<String> {
    std::fs::read_to_string("/var/run/secrets/kubernetes.io/serviceaccount/namespace")
        .ok()
        .map(|ns| ns.trim().to_string())
        .filter(|ns| !ns.is_empty())
}

/// Parse a numeric environment variable, returning `default` when it is unset or
/// blank and an [`Invalid`](ConfigError::Invalid) error when it is set but
/// unparseable.
fn parse_or<T>(name: &'static str, default: T) -> Result<T, ConfigError>
where
    T: std::str::FromStr,
    T::Err: std::fmt::Display,
{
    match non_empty(name) {
        None => Ok(default),
        Some(value) => value.parse::<T>().map_err(|err| ConfigError::Invalid {
            name,
            value,
            detail: err.to_string(),
        }),
    }
}

/// Read an environment variable, treating a blank value as unset.
fn non_empty(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(test)]
#[path = "config.test.rs"]
mod tests;
