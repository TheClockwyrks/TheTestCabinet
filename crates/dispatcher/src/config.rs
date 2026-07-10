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
//! | `TCAB_DISPATCHER_DRIVER_SECRETS` | no | Comma-separated `Secret` names mounted into each driver `Job`'s env via `envFrom`. This is how the harness provider API key (e.g. `ANTHROPIC_API_KEY`) reaches the driver, which the run engine reads from its own environment exactly as the worker did. Unset injects no secret env. | — |
//! | `TCAB_DISPATCHER_DRIVER_SUBSCRIPTION_SECRET` | no | The name of an operator-provided `Secret` holding the harness **subscription** credential files (keyed by credential basename). When set, the dispatcher mounts it as a read-only volume into each driver `Job` at `TCAB_DISPATCHER_DRIVER_SUBSCRIPTION_DIR` (with `optional: true`, so a missing Secret never wedges API-key-only driver pods) and forwards that dir to the driver. Unset leaves runs API-key-only — this is an additive parallel path to `TCAB_DISPATCHER_DRIVER_SECRETS`. | — |
//! | `TCAB_DISPATCHER_DRIVER_SUBSCRIPTION_DIR` | no | The path the subscription Secret is mounted at inside each driver `Job`, forwarded to the driver as `TCAB_DRIVER_SUBSCRIPTION_DIR`. Only used when the subscription Secret is configured. | `/var/run/tcab/subscription` |
//! | `TCAB_DISPATCHER_DRIVER_AUTH_MODE` | no | When set, forwarded into each driver `Job` as `TCAB_AUTH_MODE`, locking the harness auth mode (`auto`, `subscription`, `api-key`) for every run. Unset leaves the per-run/default selection unchanged. | — |
//! | `TCAB_PUBLISHER_IMAGE` | no | The `tcab-publisher` container image each created publish `Job`'s pod runs. Unset disables the publish path entirely — the dispatcher claims no publish jobs and builds no publish `Job`s, so a deployment without a publisher image simply never publishes. | — |
//! | `TCAB_DISPATCHER_PUBLISHER_SECRETS` | no | Comma-separated `Secret` names mounted into each publish `Job`'s env via `envFrom` (mirrors `TCAB_DISPATCHER_DRIVER_SECRETS`). This is how the publisher's `GH_TOKEN` (for `gh`) and `CLOUDFLARE_API_TOKEN` (for `wrangler`) reach it. Unset injects no secret env. | — |
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
//! | `TCAB_K8S_POD_READY_TIMEOUT_SECONDS` | How long the driver waits, once a sandbox pod is **scheduled**, for it to reach `Running` before failing the run. |
//! | `TCAB_K8S_POD_SCHEDULE_TIMEOUT_SECONDS` | How long the driver lets a sandbox pod sit unscheduled (queued for capacity) before giving up. Unset/`0` waits forever, so a busy cluster makes runs queue rather than fail. |
//! | `TCAB_K8S_RUN_POD_PREFIX` | Name prefix for sandbox pods. |
//! | `TCAB_CONTAINER_REGISTRY` / `TCAB_CONTAINER_TAG` | The registry/namespace and tag the driver resolves the run-container image from (`core::harness::resolve_run_image`); unset uses the compiled defaults (`ghcr.io/theclockwyrks` / `latest`). Set `TCAB_CONTAINER_TAG` to a `:<git-sha>` to **pin** the run image, just as the overlays pin the service `image:` tags. |
//! | `TCAB_CONTAINER_IMAGE_*` (one per run image — `_BASE`, `_SPRITE`, `_VOXEL`, …, `_BLENDER`, `_ADVERSARIAL`, `_PERFORMANCE`; the full set is `core::harness::RUN_IMAGE_OVERRIDE_ENVS`) | Full per-image ref overrides (registry+name+tag) that bypass the registry/tag composition for one run image; unset composes from the registry/tag above. |
//! | `TCAB_ARTIFACTS_URL` | The artifact service the driver uploads the produced run tree to before reporting terminal status; unset skips the upload (see the driver's `Config`). |
//! | `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_HEADERS` / `OTEL_EXPORTER_OTLP_PROTOCOL` | Observability: forwarded so each driver `Job` exports its run/driver spans to the same OTLP collector as the services; unset leaves the driver on stdout-only logging. `OTEL_SERVICE_NAME` is **not** forwarded (the driver keeps its own `tcab-driver` name). |
//! | `TCAB_ENV` | Tags the driver's telemetry with the same `deployment.environment.name` as the rest of the deployment. |
//!
//! `TCAB_K8S_POD_IP` is **not** taken from the environment here: the driver's own
//! pod IP is set on the `Job` via the downward API (`fieldRef: status.podIP`), so
//! the dispatcher never knows or forwards it (see [`crate::job`]).

use std::time::Duration;

/// The variables the dispatcher passes through into each driver `Job`'s env
/// verbatim — sandbox-pod settings (`TCAB_K8S_RUN_*` and siblings), the
/// run-container image selection, the artifact service URL, and the observability
/// vars. Listed once so the Job builder and the config doc stay in sync; the
/// dispatcher never interprets their values, only forwards the ones that are set.
pub const PASSTHROUGH_K8S_VARS: &[&str] = &[
    "TCAB_K8S_NAMESPACE",
    "TCAB_K8S_RUN_SERVICE_ACCOUNT",
    "TCAB_K8S_IMAGE_PULL_SECRETS",
    "TCAB_K8S_RUN_CPU_REQUEST",
    "TCAB_K8S_RUN_CPU_LIMIT",
    "TCAB_K8S_RUN_MEMORY_REQUEST",
    "TCAB_K8S_RUN_MEMORY_LIMIT",
    "TCAB_K8S_POD_READY_TIMEOUT_SECONDS",
    "TCAB_K8S_POD_SCHEDULE_TIMEOUT_SECONDS",
    "TCAB_K8S_RUN_POD_PREFIX",
    // The run-container image the driver resolves for each sandbox pod
    // (`core::harness::resolve_run_image`, which reads these from the driver's own
    // env). Forwarded so a deployment can pin the run images by `:<git-sha>` —
    // setting `TCAB_CONTAINER_TAG` on the dispatcher — the same way the overlays pin
    // the service `image:` tags. Without this passthrough the driver always falls
    // back to the compiled defaults (`ghcr.io/theclockwyrks` / `latest`), so a
    // mutable `:latest` is the only run image a cluster can ever get. The per-image
    // `TCAB_CONTAINER_IMAGE_*` full-ref overrides are forwarded too — but NOT listed
    // here: they come from `test_cabinet_core::harness::RUN_IMAGE_OVERRIDE_ENVS`
    // (chained in at the use site below) so the forwarded set is the SAME canonical
    // list `resolve_run_image` consults and can never drift behind a newly-added
    // asset kind. All are "forward only if set".
    "TCAB_CONTAINER_REGISTRY",
    "TCAB_CONTAINER_TAG",
    // Not a sandbox-pod setting, but forwarded the same way: the driver uploads the
    // produced run tree to this artifact service before reporting terminal status.
    // Unset (a single-box dev cluster with no artifact service) skips the upload.
    "TCAB_ARTIFACTS_URL",
    // Observability: forwarded so each per-run driver Job exports its run/driver
    // spans (service name `tcab-driver`) to the same OTLP collector — the in-cluster
    // Grafana LGTM stack — as the long-lived services, tagged with the same
    // environment. `OTEL_SERVICE_NAME` is deliberately NOT forwarded: the driver
    // must keep its own seeded service name, not inherit the dispatcher's. All are
    // "forward only if set", so an export-disabled deployment forwards nothing.
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_EXPORTER_OTLP_HEADERS",
    "OTEL_EXPORTER_OTLP_PROTOCOL",
    "TCAB_ENV",
];

/// The variables the dispatcher passes through into each **publish** `Job`'s env
/// verbatim — the artifact-service URL (the publisher downloads the run's
/// `tree.tar` from it), the GitHub org / Cloudflare Pages project the publisher's
/// `PublishConfig::from_env` resolves, and the observability vars. The publisher
/// never interprets the values the dispatcher reads here; it only forwards the ones
/// that are set. The backend URL, job id, job token, and run id are *not* listed —
/// those come from the claim and are set explicitly on every publish `Job`.
pub const PUBLISHER_PASSTHROUGH_VARS: &[&str] = &[
    // The publisher downloads the produced run tree (`GET /runs/{id}/tree.tar`) from
    // this artifact service before running the gh/wrangler release. Unset (a
    // single-box dev cluster with no artifact service) leaves the publisher with no
    // tree to release — the publish path is only enabled in a full deployment.
    "TCAB_ARTIFACTS_URL",
    // The publisher's `core::publish::PublishConfig::from_env` reads these to choose
    // the GitHub org the public per-run repo lands in and the Cloudflare Pages
    // project the playable build deploys to. Forwarded only if set; `from_env`
    // defaults the org when unset.
    "TCAB_GITHUB_ORG",
    "TCAB_PAGES_PROJECT",
    // Observability: forwarded so each per-publish Job exports its spans to the same
    // OTLP collector as the services, tagged with the same environment.
    // `OTEL_SERVICE_NAME` is deliberately not forwarded (the publisher keeps its own
    // seeded service name). All "forward only if set".
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_EXPORTER_OTLP_HEADERS",
    "OTEL_EXPORTER_OTLP_PROTOCOL",
    "TCAB_ENV",
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
    /// `Secret` names mounted into each driver `Job`'s env via `envFrom`
    /// (`TCAB_DISPATCHER_DRIVER_SECRETS`, comma-separated). Carries the harness
    /// provider API key(s) the run engine reads from the driver's own environment,
    /// exactly as the worker did. Empty injects no secret env.
    pub driver_secrets: Vec<String>,
    /// The name of the operator-provided subscription `Secret`
    /// (`TCAB_DISPATCHER_DRIVER_SUBSCRIPTION_SECRET`). When `Some`, the dispatcher
    /// mounts it as a read-only volume into each driver `Job` at
    /// [`subscription_dir`](Self::subscription_dir) and forwards that dir to the
    /// driver, enabling subscription auth. `None` leaves runs API-key-only.
    ///
    // The deferred per-account credential vault would replace this single shared
    // Secret with a per-job Secret the backend attaches at enqueue; the mount
    // mechanism below is the seam that would carry it.
    pub driver_subscription_secret: Option<String>,
    /// The path the subscription `Secret` is mounted at inside each driver `Job`
    /// (`TCAB_DISPATCHER_DRIVER_SUBSCRIPTION_DIR`), forwarded to the driver as
    /// `TCAB_DRIVER_SUBSCRIPTION_DIR`. Only used when
    /// [`driver_subscription_secret`](Self::driver_subscription_secret) is set.
    pub subscription_dir: String,
    /// The harness auth mode to lock for every run
    /// (`TCAB_DISPATCHER_DRIVER_AUTH_MODE`), forwarded into each driver `Job` as
    /// `TCAB_AUTH_MODE`. `None` leaves the default/per-run selection unchanged.
    pub driver_auth_mode: Option<String>,
    /// The `TCAB_K8S_RUN_*` (and sibling) sandbox-pod variables that are set,
    /// captured at startup to pass through into each driver `Job`'s env. The driver
    /// reads them; the dispatcher only forwards them.
    pub passthrough_k8s_env: Vec<(String, String)>,
    /// The `tcab-publisher` container image each created publish `Job`'s pod runs
    /// (`TCAB_PUBLISHER_IMAGE`). `None` disables the publish path: with no publisher
    /// image the dispatcher claims no publish jobs and builds no publish `Job`s, so a
    /// deployment that never publishes needs no image. See [`publishing_enabled`].
    ///
    /// [`publishing_enabled`]: Self::publishing_enabled
    pub publisher_image: Option<String>,
    /// `Secret` names mounted into each publish `Job`'s env via `envFrom`
    /// (`TCAB_DISPATCHER_PUBLISHER_SECRETS`, comma-separated), mirroring
    /// [`driver_secrets`](Self::driver_secrets). Carries the publisher's `GH_TOKEN`
    /// (for `gh`) and `CLOUDFLARE_API_TOKEN` (for `wrangler`). Empty injects no
    /// secret env.
    pub publisher_secrets: Vec<String>,
    /// The variables passed through into each publish `Job`'s env verbatim
    /// (`TCAB_ARTIFACTS_URL`, `TCAB_GITHUB_ORG`, `TCAB_PAGES_PROJECT`, and the
    /// observability vars that are set), collected once at startup. See
    /// [`PUBLISHER_PASSTHROUGH_VARS`].
    pub passthrough_publisher_env: Vec<(String, String)>,
}

impl Config {
    /// Whether the publish path is enabled — i.e. a `tcab-publisher` image is
    /// configured. When `false` the dispatcher never claims a publish job nor builds
    /// a publish `Job`, so a deployment without a publisher image simply never
    /// publishes (the run path is unaffected either way).
    pub fn publishing_enabled(&self) -> bool {
        self.publisher_image.is_some()
    }

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

        let driver_secrets = non_empty("TCAB_DISPATCHER_DRIVER_SECRETS")
            .map(|value| {
                value
                    .split(',')
                    .map(str::trim)
                    .filter(|name| !name.is_empty())
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();

        let driver_subscription_secret = non_empty("TCAB_DISPATCHER_DRIVER_SUBSCRIPTION_SECRET");
        let subscription_dir = non_empty("TCAB_DISPATCHER_DRIVER_SUBSCRIPTION_DIR")
            .unwrap_or_else(|| "/var/run/tcab/subscription".to_string());
        let driver_auth_mode = non_empty("TCAB_DISPATCHER_DRIVER_AUTH_MODE");

        // Forward the fixed sandbox/observability vars plus EVERY per-image run-image
        // override — the canonical `RUN_IMAGE_OVERRIDE_ENVS` from core, so the set the
        // driver can resolve and the set the dispatcher forwards stay identical as
        // asset kinds are added. Each is forwarded only when set.
        let passthrough_k8s_env = PASSTHROUGH_K8S_VARS
            .iter()
            .chain(test_cabinet_core::harness::RUN_IMAGE_OVERRIDE_ENVS.iter())
            .filter_map(|&key| non_empty(key).map(|value| (key.to_string(), value)))
            .collect();

        let publisher_image = non_empty("TCAB_PUBLISHER_IMAGE");
        let publisher_secrets = non_empty("TCAB_DISPATCHER_PUBLISHER_SECRETS")
            .map(|value| {
                value
                    .split(',')
                    .map(str::trim)
                    .filter(|name| !name.is_empty())
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        let passthrough_publisher_env = PUBLISHER_PASSTHROUGH_VARS
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
            driver_secrets,
            driver_subscription_secret,
            subscription_dir,
            driver_auth_mode,
            passthrough_k8s_env,
            publisher_image,
            publisher_secrets,
            passthrough_publisher_env,
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
