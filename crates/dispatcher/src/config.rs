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
//! | `TCAB_DISPATCHER_DRIVER_CPU_REQUEST` / `TCAB_DISPATCHER_DRIVER_MEMORY_REQUEST` | no | CPU/memory **requests** on the driver container. These keep the driver pod out of the `BestEffort` QoS class, and the memory request is the node's reservation for the driver — see [`DEFAULT_DRIVER_CPU_REQUEST`] and [`DEFAULT_DRIVER_MEMORY_REQUEST`]. Set to a blank value to omit them (not advised). | `100m` / `2Gi` |
//! | `TCAB_DISPATCHER_DRIVER_MEMORY_LIMIT` | no | A memory **limit** on the driver container. **Unset by default, deliberately**: a memory limit is a cgroup ceiling the kernel enforces by `SIGKILL`, and a driver OOM-killed mid-run destroys a run that has already paid for its API calls — see [`DEFAULT_DRIVER_MEMORY_REQUEST`] for why run pods carry a request and no limit. Set it only when a namespace `LimitRange` or quota forces one. | — |
//! | `TCAB_DISPATCHER_DRIVER_CPU_LIMIT` | no | The CPU **limit** on the driver container, which bounds how wide the post-run toolchain fans out and so how much memory it uses — see [`DEFAULT_DRIVER_CPU_LIMIT`]. Over-limit CPU is throttled, never killed. Set to a blank value to leave the CPU unbounded. | `2` |
//! | `TCAB_DISPATCHER_DRIVER_SECRETS` | no | Comma-separated `Secret` names mounted into each driver `Job`'s env via `envFrom`. This is how the harness provider API key (e.g. `ANTHROPIC_API_KEY`) reaches the driver, which the run engine reads from its own environment exactly as the worker did. Unset injects no secret env. | — |
//! | `TCAB_DISPATCHER_DRIVER_SUBSCRIPTION_SECRET` | no | The name of an operator-provided `Secret` holding the harness **subscription** credential files (keyed by credential basename). When set, the dispatcher mounts it as a read-only volume into each driver `Job` at `TCAB_DISPATCHER_DRIVER_SUBSCRIPTION_DIR` (with `optional: true`, so a missing Secret never wedges API-key-only driver pods) and forwards that dir to the driver. Unset leaves runs API-key-only — this is an additive parallel path to `TCAB_DISPATCHER_DRIVER_SECRETS`. | — |
//! | `TCAB_DISPATCHER_DRIVER_SUBSCRIPTION_DIR` | no | The path the subscription Secret is mounted at inside each driver `Job`, forwarded to the driver as `TCAB_DRIVER_SUBSCRIPTION_DIR`. Only used when the subscription Secret is configured. | `/var/run/tcab/subscription` |
//! | `TCAB_DISPATCHER_DRIVER_AUTH_MODE` | no | When set, forwarded into each driver `Job` as `TCAB_AUTH_MODE`, locking the harness auth mode (`auto`, `subscription`, `api-key`) for every run. Unset leaves the per-run/default selection unchanged. | — |
//! | `TCAB_PUBLISHER_IMAGE` | no | The `tcab-publisher` container image each created publish `Job`'s pod runs. Unset disables the publish path entirely — the dispatcher claims no publish jobs and builds no publish `Job`s, so a deployment without a publisher image simply never publishes. | — |
//! | `TCAB_DISPATCHER_PUBLISHER_CPU_REQUEST` / `_MEMORY_REQUEST` / `_MEMORY_LIMIT` | no | Requests/limit on the publish `Job`'s container, mirroring the driver's. The memory pair defaults to one value so a node reserves what the publisher may use — see [`DEFAULT_PUBLISHER_MEMORY`]. | `100m` / `1Gi` / `1Gi` |
//! | `TCAB_DISPATCHER_PUBLISHER_CPU_LIMIT` | no | The publisher's CPU limit. Unset: a publisher runs no toolchain, so nothing in it sizes itself from the CPU count it can see. | — |
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
//! | `TCAB_K8S_RUN_MEMORY_REQUEST` / `TCAB_K8S_RUN_MEMORY_LIMIT` | Memory request/limit per sandbox pod. The shipped manifests set only the request: a limit is an OOM kill waiting for the first run that outgrows it (see [`DEFAULT_DRIVER_MEMORY_REQUEST`]). |
//! | `TCAB_K8S_POD_READY_TIMEOUT_SECONDS` | How long the driver waits, once a sandbox pod is **scheduled**, for it to reach `Running` before failing the run. |
//! | `TCAB_K8S_POD_SCHEDULE_TIMEOUT_SECONDS` | How long the driver lets a sandbox pod sit unscheduled (queued for capacity) before giving up. Unset/`0` waits forever, so a busy cluster makes runs queue rather than fail. |
//! | `TCAB_K8S_RUN_ACTIVE_DEADLINE_SECONDS` | `activeDeadlineSeconds` on each sandbox pod — the last-resort backstop that stops a sandbox outliving every cleanup path. `0` disables it. |
//! | `TCAB_K8S_RUN_POD_PREFIX` | Name prefix for sandbox pods. |
//! | `TCAB_CONTAINER_REGISTRY` / `TCAB_CONTAINER_TAG` | The registry/namespace and tag the driver resolves the run-container image from (`core::harness::resolve_run_image`); unset uses the compiled defaults (`ghcr.io/theclockwyrks` / `latest`). Set `TCAB_CONTAINER_TAG` to a `:<git-sha>` to **pin** the run image, just as the overlays pin the service `image:` tags. |
//! | `TCAB_CONTAINER_IMAGE_*` (one per run image — `_BASE_WASM`, `_FULL_STACK_2D`, `_FULL_STACK_3D`, `_SPRITE`, `_VOXEL`, …, `_BLENDER`, `_ADVERSARIAL`, `_PERFORMANCE`; the full set is `core::harness::RUN_IMAGE_OVERRIDE_ENVS`) | Full per-image ref overrides (registry+name+tag) that bypass the registry/tag composition for one run image; unset composes from the registry/tag above. |
//! | `TCAB_ARTIFACTS_URL` | The artifact service the driver uploads the produced run tree to before reporting terminal status; unset skips the upload (see the driver's `Config`). |
//! | `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_HEADERS` / `OTEL_EXPORTER_OTLP_PROTOCOL` | Observability: forwarded so each driver `Job` exports its run/driver spans to the same OTLP collector as the services; unset leaves the driver on stdout-only logging. `OTEL_SERVICE_NAME` is **not** forwarded (the driver keeps its own `tcab-driver` name). |
//! | `TCAB_ENV` | Tags the driver's telemetry with the same `deployment.environment.name` as the rest of the deployment. |
//!
//! `TCAB_K8S_POD_IP` is **not** taken from the environment here: the driver's own
//! pod IP is set on the `Job` via the downward API (`fieldRef: status.podIP`), so
//! the dispatcher never knows or forwards it (see [`crate::job`]).

use std::time::Duration;

/// The default CPU request on the driver container.
///
/// The value matters far less than its *presence*. A container with neither
/// requests nor limits puts its pod in the **`BestEffort`** QoS class, which the
/// kubelet evicts first under node pressure and which the kernel OOM killer scores
/// at the maximum `oom_score_adj` — so the driver, the one process that can clean
/// up after a run, was reliably the first thing killed on a busy node. A driver
/// killed by `SIGKILL` runs none of its teardown, orphaning the run's sandbox pod
/// (the sandbox holds its own requests, which crowds the node further and kills the
/// next driver — a feedback loop). Setting any request moves the pod to `Burstable`
/// and scores it by request-vs-capacity instead. The driver really is a thin control
/// process, so this stays small.
pub const DEFAULT_DRIVER_CPU_REQUEST: &str = "100m";

/// The default CPU limit on the driver container.
///
/// This is what keeps the driver's memory footprint predictable across node sizes,
/// now that nothing caps it. The driver does not merely relay a run: once the sandbox
/// is gone it runs the case's own toolchain over the collected tree in its own cgroup
/// — the `[build]` install, `tsc`, the linters, `vitest`, the bundler, and a headless
/// Chromium for the smoke check and for every scripted validation item. Node sizes a
/// worker pool from the CPU its cgroup is allowed (`uv_available_parallelism`), so an
/// *unlimited* container reads the whole machine: a `vitest --coverage` pass that
/// peaks at 195MiB under this limit peaks at 607MiB on an eighteen-core host, purely
/// because it forked nine times as many workers.
///
/// Without it the driver's real memory need would be a property of whichever node
/// the `Job` landed on rather than of the pod, and [`DEFAULT_DRIVER_MEMORY_REQUEST`]
/// — the reservation the scheduler holds for it — would be sized against a moving
/// target. Two is what a production node offers a driver today, so this changes
/// nothing there and makes every other host behave like it.
///
/// Over-limit CPU is throttled rather than killed, so the cost of being wrong here is
/// a slower post-run pass, never a lost run. That asymmetry is why the driver carries
/// a CPU limit and no memory limit.
pub const DEFAULT_DRIVER_CPU_LIMIT: &str = "2";

/// The default memory request on the driver container — the amount a node reserves
/// for a driver pod. The driver carries **no memory limit** by default, so this is
/// the only memory figure on it.
///
/// A memory limit is a cgroup ceiling that the kernel enforces by `SIGKILL`, and a
/// run pod that reaches it is dead the instant it does — deterministically, with no
/// warning and no path to recover, no matter how much memory the node still has
/// free. The two pods a run needs, this one and the sandbox pod it drives, may run
/// for hours and spend real money on API calls the whole time, and a driver killed
/// after its harness session has finished but before it reports terminal status
/// destroys a run that has already paid for every one of them. That is the failure
/// this deployment must never produce, and a limit on a run pod is exactly the
/// mechanism that produces it. An earlier design set the limit equal to this request
/// so a node's arithmetic was exact; the first run whose toolchain outgrew that
/// ceiling was OOM-killed (`exit 137`) by its own cgroup, which is the outcome the
/// ceiling existed to prevent. So the ceiling is gone, and the request does the work:
///
/// - The scheduler reserves this much for the driver, so a node admits it only when
///   the memory is actually there.
/// - It keeps the pod out of the `BestEffort` QoS class, where it would be the first
///   thing the kubelet evicts and the kernel OOM-kills.
/// - A driver that grows past it is not killed for doing so; it spends memory the
///   node was not holding for it, and survives whenever the node actually has that
///   memory spare.
///
/// What removing the limit does NOT do is make node memory pressure harmless, and the
/// prose here must not pretend otherwise. If the node itself runs short, the kubelet
/// evicts the pod furthest above its request first, and the kernel's OOM killer
/// weighs a large resident set heavily — so a run pod that has outgrown its request
/// on a full node is still the likely victim (`Evicted` rather than `OOMKilled`, and
/// just as dead). The limit was a *certain* kill at a fixed ceiling regardless of
/// node headroom; what remains is a kill only when the node is genuinely out of
/// memory. Closing that gap is a sizing job, not a manifest one: the request must
/// cover the real peak, so the scheduler never seats a run on a node that cannot
/// hold it. Size it from `container_memory_max_usage_bytes` over a window wide
/// enough to contain the rare heavy case.
///
/// The size is set by the post-run pass, not by relaying the session. Relaying costs
/// under 10MiB, and the produced tree is streamed off disk when it uploads; what the
/// request has to cover is the case's toolchain, which runs host-side in this
/// container after the sandbox is gone. Measured in the driver image at
/// [`DEFAULT_DRIVER_CPU_LIMIT`], each stage of that pass peaks in the low hundreds of
/// mebibytes on a trivial project — `npm ci` around 400MiB, a `vitest --coverage`
/// pass around 200MiB, a headless Chromium session around 370MiB — and a real
/// implementation with its own test suite is a multiple of that. 2Gi keeps real
/// headroom over the heaviest of them.
///
/// It does have a cost, and it is charged in whole nodes: 4Gi (a sandbox pod) + 2Gi
/// exceeds what an 8Gi node can schedule once its DaemonSets are seated, so a driver
/// lands on a different node than the sandbox it drives. That is not a side effect to
/// be tolerated but the isolation this deployment wants — a driver's growth and a
/// sandbox pod's can then never contend for the same node's memory.
///
/// The always-on services (backend, artifacts, auth, dispatcher, web) keep memory
/// request == limit, because for them a kill is a restart, not lost spend, and a
/// bounded service can never be what crowds a run pod off its node. The `resources`
/// blocks in `deployments/k8s/base/*.yaml` carry that argument.
pub const DEFAULT_DRIVER_MEMORY_REQUEST: &str = "2Gi";

/// The default CPU request on the **publisher** container.
pub const DEFAULT_PUBLISHER_CPU_REQUEST: &str = "100m";

/// The default memory request and limit on the **publisher** container, set equal to
/// each other.
///
/// Unlike a run pod (see [`DEFAULT_DRIVER_MEMORY_REQUEST`]) the publisher *does*
/// carry a memory limit: a publish that is OOM-killed loses no API spend and can
/// simply be retried, whereas an unbounded publisher landing beside a sandbox pod
/// could be what crowds that run off its node. It is a per-publish `Job`, so it lands
/// wherever there is room, including beside a sandbox pod, and the ceiling is what
/// makes it a safe neighbour.
///
/// Unlike every other value here this one is **not** measured: no publish `Job` has
/// been captured by the metrics that would show its peak. It is reasoned instead, and
/// generously. The publisher pulls a run's source tree from the artifact service — the
/// largest of prod's 568 stored trees is 176MiB — and drives `gh` and `wrangler` over
/// it, so 1Gi is several times the largest plausible working set. The asymmetry
/// justifies the generosity: an unbounded container threatens whatever shares its
/// node, whereas a ceiling set too high merely reserves memory, and a publisher that
/// does hit it fails a publish that can simply be retried, with no API spend lost.
/// Tighten it once `container_memory_working_set_bytes` has caught a few real
/// publishes.
pub const DEFAULT_PUBLISHER_MEMORY: &str = "1Gi";

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
    "TCAB_K8S_RUN_ACTIVE_DEADLINE_SECONDS",
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
    // list `resolve_run_image` consults and can never drift behind a newly-added asset
    // kind or full-stack asset dimension. All are "forward only if set".
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
    // gg harness install controls (`core::gg_exec::resolve_install`, which reads these
    // from the driver's own env). Forwarded so a deployment can pin how a gg run gets
    // its binary: `TCAB_GG_INSTALL=local`/`release`, an explicit `TCAB_GG_BINARY` path,
    // and the release coordinates (`_VERSION`/`_REPO`/`_TARGET`). Unset, the driver
    // auto-detects — finding the static-musl gg baked into the driver image at
    // `/usr/local/lib/tcab/gg` (offline, no release needed), else falling back to a
    // GitHub release. All are "forward only if set".
    "TCAB_GG_INSTALL",
    "TCAB_GG_BINARY",
    "TCAB_GG_RELEASE_VERSION",
    "TCAB_GG_RELEASE_REPO",
    "TCAB_GG_RELEASE_TARGET",
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
    // project the playable build deploys to. Both are required there (no compiled-in
    // fallback), so every deployment's overlay sets them explicitly; the dispatcher
    // forwards them only if set, and a publish Job handed neither fails loudly.
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

/// The driver container's resource requests and limits.
///
/// Each field is `None` when the corresponding quantity should be omitted from the
/// manifest entirely. The two requests and the CPU limit carry defaults for the
/// driver; the memory limit carries none, so a driver is never OOM-killed by its own
/// cgroup (see [`DEFAULT_DRIVER_MEMORY_REQUEST`]), and the CPU limit is what keeps
/// its footprint steady across node sizes (see [`DEFAULT_DRIVER_CPU_LIMIT`]). A
/// publisher takes the same shape but carries a memory limit and no CPU limit.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DriverResources {
    /// `resources.requests.cpu` on the driver container.
    pub cpu_request: Option<String>,
    /// `resources.requests.memory` on the driver container.
    pub memory_request: Option<String>,
    /// `resources.limits.cpu` on the driver container.
    pub cpu_limit: Option<String>,
    /// `resources.limits.memory` on the driver container.
    pub memory_limit: Option<String>,
}

impl DriverResources {
    /// Resolve from the environment, defaulting the two requests and the CPU limit.
    /// A variable set to a blank value omits that quantity — the deliberate escape
    /// hatch for an operator who manages driver QoS by some other means (a
    /// `LimitRange`, say). The memory limit has no default: it is applied only when
    /// `TCAB_DISPATCHER_DRIVER_MEMORY_LIMIT` is explicitly set, because a memory
    /// ceiling on a run pod is an OOM kill waiting for the first run that outgrows it.
    fn from_env() -> Self {
        Self {
            cpu_request: env_or_default(
                "TCAB_DISPATCHER_DRIVER_CPU_REQUEST",
                DEFAULT_DRIVER_CPU_REQUEST,
            ),
            memory_request: env_or_default(
                "TCAB_DISPATCHER_DRIVER_MEMORY_REQUEST",
                DEFAULT_DRIVER_MEMORY_REQUEST,
            ),
            // A real ceiling, not an omission: the post-run toolchain sizes its
            // worker pools from the CPU this container may use, so the limit is what
            // keeps the driver's memory footprint a property of the pod rather than
            // of the node (see `DEFAULT_DRIVER_CPU_LIMIT`). Over-limit CPU throttles;
            // it never kills.
            cpu_limit: env_or_default("TCAB_DISPATCHER_DRIVER_CPU_LIMIT", DEFAULT_DRIVER_CPU_LIMIT),
            memory_limit: non_empty("TCAB_DISPATCHER_DRIVER_MEMORY_LIMIT"),
        }
    }

    /// Resolve the **publisher** container's resources, mirroring [`Self::from_env`]
    /// but off the `TCAB_DISPATCHER_PUBLISHER_*` variables and
    /// [`DEFAULT_PUBLISHER_MEMORY`]. Same blank-to-omit escape hatch.
    fn publisher_from_env() -> Self {
        Self {
            cpu_request: env_or_default(
                "TCAB_DISPATCHER_PUBLISHER_CPU_REQUEST",
                DEFAULT_PUBLISHER_CPU_REQUEST,
            ),
            memory_request: env_or_default(
                "TCAB_DISPATCHER_PUBLISHER_MEMORY_REQUEST",
                DEFAULT_PUBLISHER_MEMORY,
            ),
            // Unlike the driver, a publisher runs no toolchain, so nothing in it
            // sizes itself from the CPU count it can see and a ceiling buys nothing.
            cpu_limit: non_empty("TCAB_DISPATCHER_PUBLISHER_CPU_LIMIT"),
            memory_limit: env_or_default(
                "TCAB_DISPATCHER_PUBLISHER_MEMORY_LIMIT",
                DEFAULT_PUBLISHER_MEMORY,
            ),
        }
    }

    /// Whether every quantity is absent — i.e. the container would carry no
    /// `resources` at all, putting its pod back in `BestEffort`. Only reachable when
    /// an operator explicitly blanks both request variables.
    pub fn is_empty(&self) -> bool {
        self.cpu_request.is_none()
            && self.memory_request.is_none()
            && self.cpu_limit.is_none()
            && self.memory_limit.is_none()
    }
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
    /// The namespace the *driver* creates sandbox pods in (`TCAB_K8S_NAMESPACE`),
    /// which the dispatcher needs in order to reap sandboxes orphaned by a driver
    /// that died before its own teardown could run. The dispatcher does not
    /// otherwise consume this variable — it forwards it — but it defaults the same
    /// way the driver does (to the pod's own namespace) so the two agree.
    pub sandbox_namespace: String,
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
    /// The driver container's resource requests/limits
    /// (`TCAB_DISPATCHER_DRIVER_{CPU,MEMORY}_{REQUEST,LIMIT}`). Requests default to
    /// [`DEFAULT_DRIVER_CPU_REQUEST`] / [`DEFAULT_DRIVER_MEMORY_REQUEST`] so the
    /// driver pod is never `BestEffort`; the CPU limit defaults to
    /// [`DEFAULT_DRIVER_CPU_LIMIT`] and the memory limit to `None`.
    pub driver_resources: DriverResources,
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
    /// The publisher container's resource requests and limits
    /// (`TCAB_DISPATCHER_PUBLISHER_CPU_REQUEST` / `_MEMORY_REQUEST` / `_MEMORY_LIMIT` /
    /// `_CPU_LIMIT`). See [`DEFAULT_PUBLISHER_MEMORY`].
    pub publisher_resources: DriverResources,
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
        // Mirror the driver's own default (its pod namespace, which is the
        // dispatcher's too) so an unset `TCAB_K8S_NAMESPACE` still resolves to the
        // namespace sandboxes will actually appear in.
        let sandbox_namespace =
            non_empty("TCAB_K8S_NAMESPACE").unwrap_or_else(|| namespace.clone());

        let max_inflight = parse_or("TCAB_DISPATCHER_MAX_INFLIGHT", 8usize)?.max(1);
        let poll_seconds = parse_or("TCAB_DISPATCHER_POLL_INTERVAL_SECONDS", 2u64)?;
        let job_ttl_seconds = parse_or("TCAB_DISPATCHER_JOB_TTL_SECONDS", 300i32)?;
        let driver_resources = DriverResources::from_env();

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
        // override — the canonical `RUN_IMAGE_OVERRIDE_ENVS` from core (each run image's
        // own and its gg variant's `_GG` counterpart), so the set the driver can resolve
        // and the set the dispatcher forwards stay identical as asset kinds are added.
        // Each is forwarded only when set.
        let passthrough_k8s_env = PASSTHROUGH_K8S_VARS
            .iter()
            .copied()
            .chain(
                test_cabinet_core::harness::RUN_IMAGE_OVERRIDE_ENVS
                    .iter()
                    .map(String::as_str),
            )
            .filter_map(|key| non_empty(key).map(|value| (key.to_string(), value)))
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
            sandbox_namespace,
            driver_service_account,
            max_inflight,
            poll_interval: Duration::from_secs(poll_seconds),
            job_ttl_seconds,
            driver_resources,
            driver_secrets,
            driver_subscription_secret,
            subscription_dir,
            driver_auth_mode,
            passthrough_k8s_env,
            publisher_image,
            publisher_secrets,
            publisher_resources: DriverResources::publisher_from_env(),
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

/// Read an environment variable that carries a default, distinguishing **unset**
/// from **set-but-blank**: an absent variable takes `default`, while one explicitly
/// set to a blank value resolves to `None` (omit the value entirely).
///
/// This differs from [`non_empty`] + `unwrap_or`, which cannot express "omit" — it
/// collapses both cases onto the default. The driver's resource requests need the
/// distinction so an operator can deliberately opt out of them.
fn env_or_default(key: &str, default: &str) -> Option<String> {
    match std::env::var(key) {
        Err(_) => Some(default.to_string()),
        Ok(value) => {
            let value = value.trim();
            (!value.is_empty()).then(|| value.to_string())
        }
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
