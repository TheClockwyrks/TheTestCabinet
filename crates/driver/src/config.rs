//! Driver configuration, resolved from the environment.
//!
//! The driver is the one-shot counterpart of the worker: it executes exactly one
//! run and streams its progress to the backend, then exits. The dispatcher passes
//! everything it needs through the environment when it creates the driver Job — no
//! config file, no HTTP server, no flags.
//!
//! | Variable | Required | Purpose | Default |
//! | --- | --- | --- | --- |
//! | `TCAB_BACKEND_URL` | yes | The backend the driver resolves the definition from and streams events/preview/status back to. | — |
//! | `TCAB_JOB_ID` | yes | The id of the job this driver executes (the `POST /jobs/{id}/…` path key). | — |
//! | `TCAB_JOB_TOKEN` | yes | The per-job bearer token authenticating this driver's streaming calls. | — |
//! | `TCAB_RUN_REQUEST` | yes | The [`LaunchBody`](test_cabinet_core::LaunchBody) JSON the dispatcher claimed and passed in. | — |
//! | `TCAB_DRIVER_RUNTIME` | no | How the run's sandbox container is started: `cli` (host Docker/Podman) or `kubernetes` (a sandbox pod per run via the API). | `cli` |
//! | `TCAB_WORK_DIR` | no | Ephemeral scratch directory for the run's mountable inputs and produced tree. | `./.tcab-driver` |
//!
//! When `TCAB_DRIVER_RUNTIME=kubernetes`, the sandbox-pod settings (`TCAB_K8S_*`,
//! documented on [`KubernetesConfig`](crate::kubernetes::KubernetesConfig)) are
//! also read. They are ignored under the `cli` runtime. The names are reused
//! verbatim from the worker; the driver pod is the trusted pod that creates the
//! untrusted sandbox, so `TCAB_K8S_POD_IP` (from the downward API) routes the
//! live-preview `hostAlias` back to the *driver's own* pod IP.

use std::path::PathBuf;
use std::time::Duration;

use test_cabinet_core::{LaunchBody, ONE_SHOT_SLUG, OrchestratorSelection, RunRequest};

use crate::kubernetes::{KubernetesConfig, in_cluster_namespace};

/// How the driver starts the run's sandbox container.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DriverRuntime {
    /// Shell out to a host Docker/Podman (local development, single-box).
    Cli,
    /// Create one sandbox pod for the run through the Kubernetes API (cluster
    /// deployment). The driver is the trusted pod creating the untrusted sandbox.
    Kubernetes,
}

/// A driver configuration error: a required variable is unset or unusable.
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

/// The resolved driver configuration.
#[derive(Debug, Clone)]
pub struct Config {
    /// The backend base URL the driver resolves the definition from and streams
    /// the run's progress back to (`TCAB_BACKEND_URL`).
    pub backend_url: String,
    /// The id of the job this driver executes (`TCAB_JOB_ID`).
    pub job_id: String,
    /// The per-job bearer token authenticating the driver's streaming calls
    /// (`TCAB_JOB_TOKEN`).
    pub job_token: String,
    /// The launch request the dispatcher passed in (`TCAB_RUN_REQUEST`, the
    /// claimed [`LaunchBody`] JSON), already parsed.
    pub launch: LaunchBody,
    /// How the run's sandbox container is started (`TCAB_DRIVER_RUNTIME`).
    pub runtime: DriverRuntime,
    /// Ephemeral scratch directory for the run's mountable inputs and produced
    /// tree (`TCAB_WORK_DIR`). The pod is disposable, so this is lost on exit.
    pub work_dir: PathBuf,
    /// Sandbox-pod settings used when [`runtime`](Self::runtime) is
    /// [`DriverRuntime::Kubernetes`]; left at defaults (and unused) otherwise.
    pub kubernetes: KubernetesConfig,
}

impl Config {
    /// Resolve the configuration from the process environment.
    ///
    /// `TCAB_BACKEND_URL`, `TCAB_JOB_ID`, `TCAB_JOB_TOKEN`, and `TCAB_RUN_REQUEST`
    /// are required (the dispatcher always sets them); the rest default. A blank
    /// value is treated as unset so an empty export does not slip through.
    pub fn from_env() -> Result<Self, ConfigError> {
        let backend_url = non_empty("TCAB_BACKEND_URL")
            .ok_or(ConfigError::Missing("TCAB_BACKEND_URL"))?
            .trim_end_matches('/')
            .to_string();
        let job_id = non_empty("TCAB_JOB_ID").ok_or(ConfigError::Missing("TCAB_JOB_ID"))?;
        let job_token =
            non_empty("TCAB_JOB_TOKEN").ok_or(ConfigError::Missing("TCAB_JOB_TOKEN"))?;
        let request_json =
            non_empty("TCAB_RUN_REQUEST").ok_or(ConfigError::Missing("TCAB_RUN_REQUEST"))?;
        let launch: LaunchBody =
            serde_json::from_str(&request_json).map_err(|err| ConfigError::Invalid {
                name: "TCAB_RUN_REQUEST",
                value: request_json.clone(),
                detail: err.to_string(),
            })?;
        let runtime = match non_empty("TCAB_DRIVER_RUNTIME").as_deref() {
            None | Some("cli") => DriverRuntime::Cli,
            Some("kubernetes" | "k8s") => DriverRuntime::Kubernetes,
            Some(other) => {
                return Err(ConfigError::Invalid {
                    name: "TCAB_DRIVER_RUNTIME",
                    value: other.to_string(),
                    detail: "expected `cli` or `kubernetes`".to_string(),
                });
            }
        };
        let work_dir = non_empty("TCAB_WORK_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(".tcab-driver"));
        let kubernetes = kubernetes_from_env()?;
        Ok(Self {
            backend_url,
            job_id,
            job_token,
            launch,
            runtime,
            work_dir,
            kubernetes,
        })
    }

    /// Build the [`RunRequest`] this driver executes from the claimed
    /// [`LaunchBody`], exactly as `worker submit` does: an exact, immutable
    /// version, the `one-shot` orchestrator default when none is named, built-in
    /// orchestrators only (no external `dir` — the driver has no submitter
    /// checkout), and the base image resolved from the environment in the
    /// orchestrator rather than from the backend.
    pub fn run_request(&self) -> RunRequest {
        let launch = &self.launch;
        RunRequest {
            test_case_slug: launch.test_case.clone(),
            test_case_version: Some(launch.version.clone()),
            variant: launch.variant.clone(),
            harness: launch.harness,
            model_id: launch.model.clone(),
            orchestrator: OrchestratorSelection {
                slug: launch
                    .orchestrator
                    .clone()
                    .unwrap_or_else(|| ONE_SHOT_SLUG.to_string()),
                dir: None,
            },
            max_runtime_override: launch.max_runtime_seconds,
            container_image: None,
        }
    }
}

/// Resolve the Kubernetes sandbox-pod settings from the environment. These are
/// read regardless of the selected runtime (cheap), but only consulted under the
/// `kubernetes` runtime. The variable names match the worker's verbatim.
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
        // The driver is the trusted pod; the sandbox connects back to it for live
        // preview, so its own pod IP (from the downward API) is the hostAlias
        // target.
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
