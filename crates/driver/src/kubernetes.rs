//! Kubernetes-native container runtime: one sandbox pod per run, via the API.
//!
//! This is the deployment-grade [`ContainerRuntime`] the driver uses when it runs
//! inside a cluster (`TCAB_DRIVER_RUNTIME=kubernetes`). Where the
//! [`CliContainerRuntime`](test_cabinet_core::CliContainerRuntime) shells out to a
//! host Docker/Podman, this one talks to the **Kubernetes API**: it creates a pod
//! per run, copies the seeded working tree in and the produced tree out over the
//! pod `exec` API (tar streamed through `exec`, the same mechanism `kubectl cp`
//! uses), runs the harness session with `exec`, and deletes the pod when the run
//! ends. The driver pod (the trusted pod that creates this untrusted sandbox)
//! needs no container engine and no privilege — only RBAC to manage pods in its
//! run namespace (see `deployments/k8s/base/rbac.yaml`).
//!
//! This is a duplicate of the worker's `src/kubernetes.rs`: the per-run-Job
//! refactor moves the sandbox runtime into the driver, but the worker keeps its
//! copy until the cutover (Phase 6) removes the worker entirely. The two are kept
//! identical on purpose — only the doc wording and the `managed-by` label differ.
//!
//! The behavior is identical to the CLI runtime; only the mechanism differs. Two
//! details follow from `exec` not being able to switch users the way
//! `docker exec --user 0` can:
//!
//! - **Seeding via `tar` extraction needs no `chown`.** The extracting `tar`
//!   process runs as the image's unprivileged `node` user, so the files it writes
//!   are already `node`-owned — the CLI runtime's post-copy `chown` is unnecessary
//!   here.
//! - **Credential files** are likewise extracted as `node` under its home, with
//!   their mode preserved from the tar header.

use std::collections::BTreeMap;
use std::path::Path;
use std::time::Duration;

use k8s_openapi::api::core::v1::{
    Container, EnvVar, HostAlias, LocalObjectReference, Pod, PodSpec, ResourceRequirements,
};
use k8s_openapi::apimachinery::pkg::api::resource::Quantity;
use k8s_openapi::apimachinery::pkg::apis::meta::v1::{ObjectMeta, Status};
use kube::api::{AttachParams, DeleteParams, ListParams, LogParams, PostParams};
use kube::{Api, Client};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::time::{Instant, sleep, sleep_until};
use tracing::instrument;

use test_cabinet_core::exec_stream::drain_with_idle_timeout;
use test_cabinet_core::execution::{
    ArtifactCollection, ArtifactCollector, ContainerDir, ContainerFile, ContainerHandle,
    ContainerRuntime, ContainerSpec, ContainerStart, ExecOutput, OutputSink,
};
use test_cabinet_core::{Error, Result, SKIPPED_DIRS};

use crate::collect::{CollectListener, Received, uploader_command};

/// The container working directory the seeded repository is copied into. Matches
/// the run-container images' `WORKDIR` (`containers/base/Dockerfile`).
const WORK_DIR: &str = "/work";

/// The name of the single container in each run pod. `exec` targets it explicitly
/// so a future sidecar would not make the target ambiguous.
const RUN_CONTAINER: &str = "run";

/// Size of the client-side pipes backing an exec's `stdin`/`stdout`.
///
/// `kube`'s default is 1 KiB, which is fine for a probe and poor for a copy: a
/// seed archive is handed to the message loop a kilobyte at a time, and the
/// produced tree streams back out the same way. The value does not change what
/// crosses the wire — the client frames the stream with its own reader — it just
/// stops the writer and the loop ping-ponging once per kilobyte.
const EXEC_PIPE_BUF: usize = 64 * 1024;

/// How long a **stdin-carrying** exec may make no progress before its stdin is
/// closed to unstick it — either with a single [`EXEC_STDIN_CHUNK`] of the archive
/// unable to move, or with the whole archive handed over and nothing coming back.
///
/// This is an idle bound, not a deadline: it is measured against progress, so it
/// never races a legitimately slow or large copy — only one that has *stopped*.
/// What it bounds is the case in [`exec_raw`] where the remote died mid-write and
/// the server then waits forever on a stdin-EOF the ordinary path never sends.
///
/// Only a stdin-carrying exec is bounded. An exec without stdin is an ordinary
/// command whose duration is the caller's business, and nothing here may cap it.
///
/// [`exec_raw`]: KubernetesContainerRuntime::exec_raw
const EXEC_STDIN_IDLE: Duration = Duration::from_secs(60);

/// How much of an archive is written at a time.
///
/// The write is chunked so that *progress* is observable: one `write_all` of the
/// whole archive either returns or does not, and a remote that stopped reading
/// halfway makes it never return at all. A chunk that cannot move within
/// [`EXEC_STDIN_IDLE`] is the signal that nothing is reading any more.
const EXEC_STDIN_CHUNK: usize = 256 * 1024;

/// How long to wait for the terminating `Status` once the streams are done. On
/// every ordinary path this is already resolved (the message loop ends *because*
/// the status arrived) and the wait is instantaneous; it is a bound for the stall
/// path, where stdin was just closed and the server may still have a status to
/// deliver.
const EXEC_STATUS_GRACE: Duration = Duration::from_secs(30);

/// How many times to try seeding a tree into a run pod before failing the run.
///
/// A seed is one `exec`, and losing its stream — before the extract could report
/// anything — is transient by nature: the pod is up, the command is idempotent
/// (`tar -x` over the same destination), and the next attempt is a fresh stream.
/// Only an attempt that *reported* a failure is taken at its word.
const SEED_ATTEMPTS: u32 = 3;

/// How long to wait between seed attempts, so a retry does not land in the same
/// moment as whatever took the stream down.
const SEED_RETRY_BACKOFF: Duration = Duration::from_millis(500);

/// The exit code [`exit_code_from_status`] reports when no terminating `Status`
/// arrived at all — the exec stream was lost rather than the command finishing.
const NO_STATUS_EXIT_CODE: i32 = -1;

/// The label each run pod carries identifying the job it belongs to (the same key
/// the dispatcher stamps on the driver `Job`). It lets the driver find and delete
/// exactly *its* sandbox pod when a run is canceled, without disturbing another
/// run's pod that shares the `managed-by: tcab-driver` label.
const JOB_ID_LABEL: &str = "tcab.dev/job-id";

/// The cluster-autoscaler annotation that pins a pod to its node.
///
/// A sandbox holds the single copy of a run's working tree — nothing replicates it
/// and nothing replays it, so evicting a sandbox destroys the run. Today the
/// autoscaler declines to drain a node hosting one anyway, but only incidentally:
/// the sandbox is a *bare* pod (deliberately — see the ownership discussion in the
/// dispatcher's `kubernetes` module) and the autoscaler's default policy spares pods
/// with no controller behind them. That is a property of the cluster's configuration,
/// not of this manifest, and it inverts the moment anything gives the sandbox an
/// owner. State the requirement explicitly instead of inheriting it.
///
/// The dispatcher stamps the same annotation on the driver `Job` it creates; the two
/// crates do not depend on each other, so the literal is duplicated exactly as
/// [`JOB_ID_LABEL`] already is, and both sides are covered by tests asserting it.
const SAFE_TO_EVICT_ANNOTATION: &str = "cluster-autoscaler.kubernetes.io/safe-to-evict";

/// The annotation value that forbids the cluster autoscaler from evicting a pod.
const SAFE_TO_EVICT_FALSE: &str = "false";

/// The default [`pod_active_deadline`](KubernetesConfig::pod_active_deadline): 24
/// hours.
///
/// Chosen to be well past any plausible run — a multi-session `ralph` orchestration
/// is measured in hours, not days — so it can only ever fire on a sandbox that has
/// genuinely been abandoned. It is a leak backstop, not a run timeout.
const DEFAULT_POD_ACTIVE_DEADLINE: Duration = Duration::from_secs(24 * 60 * 60);

/// How many times to attempt the run-tree collection before giving up. Each
/// attempt is a fresh upload from the sandbox over the driver's own listener (see
/// [`crate::collect`]); the listener verifies the tree whole, so a failed attempt
/// is one that did not arrive whole — a dropped connection, a stalled stream, an
/// uploader that could not start. `tar -c` is read-only, so re-running it is safe.
/// See `KubernetesArtifactCollector`.
const COLLECT_ATTEMPTS: u32 = 4;

/// How long to keep waiting for the uploader's exec to report after the listener
/// has verified its upload. The exec's outcome no longer matters by then; this
/// only lets its stderr reach the log before the attempt is closed.
const UPLOADER_EXIT_GRACE: Duration = Duration::from_secs(30);

/// How long to keep waiting for a verified upload after the uploader's exec has
/// reported an exit code. The uploader exits `0` only on the listener's
/// acknowledgement, which follows verification, so the two normally land
/// together; this covers the verified upload being the later of the pair to be
/// polled. An exec that reported no exit code at all is a different case — see
/// `KubernetesArtifactCollector::upload_attempt`.
const UPLOAD_AFTER_EXIT_GRACE: Duration = Duration::from_secs(5);

/// Configuration for the Kubernetes runtime, resolved from the driver's
/// environment (see [`crate::config`]). Everything here scopes *sandbox pods*;
/// the driver reaches the API through its own in-cluster service account.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KubernetesConfig {
    /// Namespace run pods are created in.
    pub namespace: String,
    /// Service account assigned to run pods, if any (`None` uses the namespace
    /// default). Run pods never need API access, so this is usually `None`.
    pub run_service_account: Option<String>,
    /// `imagePullSecret` names for the run-container image, for a private
    /// registry. Empty when the registry is public.
    pub image_pull_secrets: Vec<String>,
    /// CPU request applied to each run pod (a Kubernetes quantity, e.g. `500m`).
    pub cpu_request: Option<String>,
    /// CPU limit applied to each run pod (e.g. `2`).
    pub cpu_limit: Option<String>,
    /// Memory request applied to each run pod (e.g. `4Gi`). This is the node's
    /// reservation for the sandbox and the only memory figure the shipped manifests
    /// set on it.
    pub memory_request: Option<String>,
    /// Memory limit applied to each run pod. The shipped manifests leave this unset,
    /// deliberately: a memory limit is a cgroup ceiling enforced by `SIGKILL`, and a
    /// sandbox OOM-killed mid-run destroys a run that has already paid for its API
    /// calls (see the dispatcher's `DEFAULT_DRIVER_MEMORY_REQUEST`). Honoured when
    /// set, for a namespace whose `LimitRange` or quota insists on one.
    pub memory_limit: Option<String>,
    /// How long to wait, **once the pod has been scheduled onto a node**, for it
    /// to reach `Running` before failing the run. This bounds startup work (image
    /// pull, container creation) so a genuinely broken pod (`ImagePullBackOff`,
    /// `CreateContainerError`, …) fails promptly instead of hanging.
    pub pod_ready_timeout: Duration,
    /// How long to wait for a run pod to be *scheduled onto a node* before giving
    /// up. While unscheduled the pod is simply queued for cluster capacity — it is
    /// not broken — so this is `None` by default: a busy cluster makes new runs
    /// sit `Pending` until capacity frees up rather than failing them. Set a bound
    /// only to cap how long a run may queue (for example to catch a pod whose
    /// resource requests no node can ever satisfy).
    pub pod_schedule_timeout: Option<Duration>,
    /// `activeDeadlineSeconds` on each sandbox pod — the last-resort bound on how
    /// long one may live, after which the kubelet terminates it.
    ///
    /// Every *ordinary* teardown happens long before this: the driver deletes the
    /// sandbox when the run ends and when a run is canceled, and the dispatcher
    /// reaps it if the driver died without doing so. This exists for the case where
    /// all of those fail at once — a `SIGKILL`ed driver *and* a dispatcher that is
    /// down or has lost its RBAC — because the alternative is a pod whose `sleep
    /// infinity` keep-alive holds a node's capacity until an operator notices.
    ///
    /// So the default is deliberately far longer than any real run rather than a
    /// tuned timeout: it must never be what ends a legitimate long orchestration.
    /// Nothing else in the system caps a run's duration, and a run that genuinely
    /// needs more than the 24-hour `DEFAULT_POD_ACTIVE_DEADLINE` should raise this
    /// rather than rely on it. `None` disables the backstop entirely.
    pub pod_active_deadline: Option<Duration>,
    /// The driver pod's own IP, used to route a watched asset-generation sandbox
    /// pod's live preview frames back to the driver via a `hostAlias`. `None`
    /// disables the route (previews are best-effort, so runs are unaffected).
    pub pod_ip: Option<String>,
    /// Name prefix for run pods (the rest is a cuid2).
    pub run_pod_prefix: String,
    /// The id of the job this driver executes. Stamped onto each run pod as the
    /// `JOB_ID_LABEL` so the driver can find and delete its own sandbox pod on
    /// cancellation. `None` outside a dispatcher-driven run (e.g. a test), in which
    /// case the label is omitted and
    /// [`KubernetesContainerRuntime::delete_run_pods_for_job`] is a no-op.
    pub job_id: Option<String>,
}

impl Default for KubernetesConfig {
    fn default() -> Self {
        Self {
            namespace: "default".to_string(),
            run_service_account: None,
            image_pull_secrets: Vec::new(),
            cpu_request: None,
            cpu_limit: None,
            memory_request: None,
            memory_limit: None,
            pod_ready_timeout: Duration::from_secs(180),
            pod_schedule_timeout: None,
            pod_active_deadline: Some(DEFAULT_POD_ACTIVE_DEADLINE),
            pod_ip: None,
            run_pod_prefix: "tcab-run-".to_string(),
            job_id: None,
        }
    }
}

/// The namespace the driver is running in, read from the in-cluster service
/// account, for use as the default run namespace when `TCAB_K8S_NAMESPACE` is
/// unset. Returns `None` outside a cluster (the file is absent).
pub fn in_cluster_namespace() -> Option<String> {
    std::fs::read_to_string("/var/run/secrets/kubernetes.io/serviceaccount/namespace")
        .ok()
        .map(|ns| ns.trim().to_string())
        .filter(|ns| !ns.is_empty())
}

/// A container runtime that creates one sandbox pod per run through the
/// Kubernetes API.
#[derive(Clone)]
pub struct KubernetesContainerRuntime {
    client: Client,
    config: KubernetesConfig,
}

impl std::fmt::Debug for KubernetesContainerRuntime {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // The `kube::Client` is not `Debug`; summarize the runtime by its config.
        f.debug_struct("KubernetesContainerRuntime")
            .field("namespace", &self.config.namespace)
            .finish_non_exhaustive()
    }
}

impl KubernetesContainerRuntime {
    /// Connect to the cluster the driver is running in (the in-cluster service
    /// account in a deployment, or the ambient kubeconfig for local use) and build
    /// a runtime that creates sandbox pods per `config`.
    pub async fn connect(config: KubernetesConfig) -> Result<Self> {
        let client = Client::try_default().await.map_err(|err| {
            Error::ContainerRuntime(format!("connecting to the Kubernetes API: {err}"))
        })?;
        Ok(Self { client, config })
    }

    /// Build a runtime around an existing client (used by tests).
    pub fn with_client(client: Client, config: KubernetesConfig) -> Self {
        Self { client, config }
    }

    /// The pods API in the run namespace.
    fn pods(&self) -> Api<Pod> {
        Api::namespaced(self.client.clone(), &self.config.namespace)
    }

    /// Tear down this run's sandbox pod(s) — the teardown path used when a run is
    /// **canceled** mid-flight, on every disposition the driver takes.
    ///
    /// The harness is its own process inside the sandbox, so neither dropping the run
    /// future nor a session returning ends it; the host only ever held the `exec`
    /// stream. For a destroyed run — a canceled third-party harness, abandoned rather
    /// than asked to wind down — this call *is* what stops it running and spending, and
    /// what lets the driver Job go terminal so its dispatcher slot frees. For a
    /// wound-down gg run it reclaims the pod the finished session left behind. Either
    /// way every pod carrying this job's `JOB_ID_LABEL` is deleted with a zero grace
    /// period (the run is over; there is nothing to drain), matching what
    /// [`ContainerRuntime::stop`] does at a normal end of run.
    ///
    /// Listing-then-deleting (rather than a single `delete_collection`) keeps to the
    /// `pods` `list`/`delete` verbs the driver already holds — no extra RBAC. A pod
    /// already gone is not an error (this is also the cleanup path). A no-op when no
    /// job id is configured (there is no label to select on).
    pub async fn delete_run_pods_for_job(&self) -> Result<()> {
        let Some(job_id) = self.config.job_id.as_deref() else {
            return Ok(());
        };
        let selector = format!("{JOB_ID_LABEL}={job_id}");
        let listed = self
            .pods()
            .list(&ListParams::default().labels(&selector))
            .await
            .map_err(|err| {
                Error::ContainerRuntime(format!("listing run pods for job `{job_id}`: {err}"))
            })?;
        let params = DeleteParams::default().grace_period(0);
        for pod in listed {
            let Some(name) = pod.metadata.name else {
                continue;
            };
            match self.pods().delete(&name, &params).await {
                Ok(_) => {}
                // A pod already gone is success — the run may have torn it down on
                // its own as the future unwound.
                Err(kube::Error::Api(err)) if err.code == 404 => {}
                Err(err) => {
                    return Err(Error::ContainerRuntime(format!(
                        "deleting run pod `{name}`: {err}"
                    )));
                }
            }
        }
        Ok(())
    }

    /// The `Pod` manifest for a run from its [`ContainerSpec`].
    fn run_pod(&self, name: &str, spec: &ContainerSpec) -> Pod {
        build_run_pod(name, spec, &self.config)
    }

    /// Wait for a freshly created run pod to reach `Running`, returning the
    /// resolved image digest (when the image carries one) and how long the pod
    /// spent *waiting to be scheduled* onto a node.
    ///
    /// The wait is split into two phases that are bounded very differently, so a
    /// cluster at capacity makes new runs queue rather than fail:
    ///
    /// - **Scheduling.** Until the scheduler binds the pod to a node it sits
    ///   `Pending` with no node assigned. When every node is full this is just a
    ///   queue — the pod is healthy, it is waiting its turn — so this phase is
    ///   bounded only by the generous, opt-in [`pod_schedule_timeout`]
    ///   (unbounded by default). The time spent here is returned so the caller can
    ///   exclude it from the run's measured duration; queueing for capacity is not
    ///   work done for the run.
    /// - **Startup.** Once scheduled, the kubelet pulls the image and creates the
    ///   container. A genuine fault here (`ImagePullBackOff`,
    ///   `CreateContainerError`, …) must fail the run promptly rather than hang, so
    ///   this phase keeps the tight [`pod_ready_timeout`].
    ///
    /// A pod that fails outright, or that does not finish startup within
    /// `pod_ready_timeout` once scheduled, is an error carrying the pod's waiting
    /// reason and any logs to aid diagnosis.
    ///
    /// [`pod_schedule_timeout`]: KubernetesConfig::pod_schedule_timeout
    /// [`pod_ready_timeout`]: KubernetesConfig::pod_ready_timeout
    async fn await_running(&self, name: &str) -> Result<(Option<String>, Duration)> {
        let pods = self.pods();

        // Phase 1 — scheduling. Wait for the pod to be bound to a node, bounded
        // only by the opt-in schedule timeout. A pod that reaches a terminal phase
        // here failed before it ever started.
        let scheduling_started = Instant::now();
        let schedule_deadline = self
            .config
            .pod_schedule_timeout
            .map(|timeout| scheduling_started + timeout);
        loop {
            let pod = pods.get(name).await.map_err(|err| {
                Error::ContainerRuntime(format!("reading run pod `{name}`: {err}"))
            })?;
            match pod.status.as_ref().and_then(|s| s.phase.as_deref()) {
                // Scheduled and already running (or past it): no startup wait left.
                Some("Running") => {
                    return Ok((resolved_image_digest(&pod), scheduling_started.elapsed()));
                }
                Some(phase @ ("Failed" | "Succeeded")) => {
                    let logs = self.pod_logs(name).await;
                    return Err(Error::ContainerRuntime(format!(
                        "run pod `{name}` entered `{phase}` before the session started{logs}"
                    )));
                }
                _ => {}
            }
            if pod_scheduled(&pod) {
                break;
            }
            if let Some(deadline) = schedule_deadline
                && Instant::now() >= deadline
            {
                let reason =
                    pod_scheduling_message(&pod).unwrap_or_else(|| "still unscheduled".to_string());
                return Err(Error::ContainerRuntime(format!(
                    "run pod `{name}` was not scheduled within {}s ({reason})",
                    self.config
                        .pod_schedule_timeout
                        .unwrap_or_default()
                        .as_secs(),
                )));
            }
            sleep(Duration::from_millis(500)).await;
        }
        let scheduling_wait = scheduling_started.elapsed();

        // Phase 2 — startup. The pod is on a node; wait for the container to reach
        // `Running`, bounded by the ready timeout so a broken image or container
        // fails fast instead of hanging.
        let deadline = Instant::now() + self.config.pod_ready_timeout;
        loop {
            let pod = pods.get(name).await.map_err(|err| {
                Error::ContainerRuntime(format!("reading run pod `{name}`: {err}"))
            })?;
            match pod.status.as_ref().and_then(|s| s.phase.as_deref()) {
                Some("Running") => return Ok((resolved_image_digest(&pod), scheduling_wait)),
                Some(phase @ ("Failed" | "Succeeded")) => {
                    let logs = self.pod_logs(name).await;
                    return Err(Error::ContainerRuntime(format!(
                        "run pod `{name}` entered `{phase}` before the session started{logs}"
                    )));
                }
                _ => {}
            }
            if Instant::now() >= deadline {
                let reason =
                    pod_waiting_reason(&pod).unwrap_or_else(|| "still pending".to_string());
                let logs = self.pod_logs(name).await;
                return Err(Error::ContainerRuntime(format!(
                    "run pod `{name}` did not reach Running within {}s ({reason}){logs}",
                    self.config.pod_ready_timeout.as_secs(),
                )));
            }
            sleep(Duration::from_millis(500)).await;
        }
    }

    /// A short, log-friendly tail of a pod's logs, prefixed for embedding in an
    /// error message, or empty when none can be read.
    async fn pod_logs(&self, name: &str) -> String {
        let params = LogParams {
            container: Some(RUN_CONTAINER.to_string()),
            tail_lines: Some(20),
            ..Default::default()
        };
        match self.pods().logs(name, &params).await {
            Ok(logs) if !logs.trim().is_empty() => format!("; last log lines:\n{}", logs.trim()),
            _ => String::new(),
        }
    }

    /// Run a command in the pod, optionally writing `stdin` to it, and return its
    /// exit code with stdout captured as **raw bytes** (binary-safe — the `tar`
    /// copy-out stream is not text) and stderr as text. Used for the trait's
    /// buffered [`exec`](ContainerRuntime::exec), the `tar` copy-in (stdin
    /// archive, output ignored beyond a failure), and the small command probes.
    ///
    /// A remote command that stops reading `stdin` before the whole of it has been
    /// written is **not** reported as a write failure. The stdin writer is a
    /// [`tokio::io::duplex`] whose reading half lives in the kube client's message
    /// loop, so it reports `BrokenPipe` the moment that loop ends — which is what
    /// happens whenever the exec stream is torn down or the remote process exits
    /// early. Returning that error would discard the two things that actually say
    /// what went wrong (the terminating `Status` and the command's own stderr) and
    /// replace them with `broken pipe`, so it is recorded in
    /// [`RemoteExec::stdin`] and the caller judges the attempt on what the command
    /// said instead.
    async fn exec_raw(
        &self,
        pod: &str,
        command: &[String],
        stdin: Option<&[u8]>,
    ) -> Result<RemoteExec> {
        let params = AttachParams::default()
            .container(RUN_CONTAINER)
            .stdin(stdin.is_some())
            .stdout(true)
            .stderr(true)
            // The client's internal pipes default to 1 KiB, which makes a
            // multi-megabyte seed archive hand off to the message loop a kilobyte
            // at a time. Neither buffer changes what crosses the wire (frames are
            // sized by the client's own reader); they just stop the writer and the
            // loop ping-ponging on every kilobyte of a copy.
            .max_stdin_buf_size(EXEC_PIPE_BUF)
            .max_stdout_buf_size(EXEC_PIPE_BUF);
        let mut attached = self
            .pods()
            .exec(pod, command.iter().cloned(), &params)
            .await
            .map_err(|err| Error::ContainerRuntime(format!("exec in run pod `{pod}`: {err}")))?;

        let mut writer = if stdin.is_some() {
            attached.stdin()
        } else {
            None
        };
        let mut out_reader = attached.stdout().ok_or_else(|| {
            Error::ContainerRuntime("run pod exec produced no stdout".to_string())
        })?;
        let mut err_reader = attached.stderr().ok_or_else(|| {
            Error::ContainerRuntime("run pod exec produced no stderr".to_string())
        })?;
        let status = attached.take_status().ok_or_else(|| {
            Error::ContainerRuntime("run pod exec produced no status".to_string())
        })?;

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        // Write stdin (when given) concurrently with draining both output streams,
        // so a large archive on stdin cannot deadlock against an unread stdout.
        //
        // Crucially, we do NOT close (shutdown/drop) stdin on the ordinary path.
        // Closing stdin is the kube-rs client's signal for stdin-EOF, and on the
        // **v4** exec WebSocket subprotocol (`v4.channel.k8s.io` — no per-stream
        // CLOSE frame) the only way it can send that signal is to close the *entire*
        // WebSocket, which races — and beats — the terminating `Status` frame coming
        // back, so the exit code is lost as `-1`. Instead the only stdin consumer
        // (`extract_tar`) bounds its own read with `head -c`, so the remote process
        // exits on its own and the server delivers `Status` without us ever needing
        // to signal stdin-EOF. We therefore hold the writer open until the command
        // has finished (status received), then drop it at end of scope — by which
        // point the message loop has already broken on `Status`, so the close is a
        // harmless no-op on both v4 and v5.
        let write = async {
            let (Some(data), Some(writer)) = (stdin, writer.as_mut()) else {
                return Ok(StdinOutcome::Written);
            };
            for chunk in data.chunks(EXEC_STDIN_CHUNK) {
                match tokio::time::timeout(EXEC_STDIN_IDLE, writer.write_all(chunk)).await {
                    Ok(Ok(())) => {}
                    // The remote stopped reading before we were done. Say so; do not
                    // fail here — see this method's docs.
                    Ok(Err(err)) if is_stream_closed(&err) => return Ok(StdinOutcome::CutShort),
                    Ok(Err(err)) => {
                        return Err(Error::ContainerRuntime(format!(
                            "writing stdin to run pod `{pod}`: {err}"
                        )));
                    }
                    // Nothing is draining stdin any more. The remote is gone and the
                    // server is holding a stream it will never finish.
                    Err(_elapsed) => return Ok(StdinOutcome::Stalled),
                }
            }
            Ok(StdinOutcome::Written)
        };
        let read_out = async {
            out_reader
                .read_to_end(&mut stdout)
                .await
                .map_err(|err| Error::ContainerRuntime(format!("reading run pod stdout: {err}")))
        };
        let read_err = async {
            err_reader
                .read_to_end(&mut stderr)
                .await
                .map_err(|err| Error::ContainerRuntime(format!("reading run pod stderr: {err}")))
        };
        // These three run together until all of them are done: the writer cannot be
        // allowed to get ahead of the readers, or a large archive on stdin deadlocks
        // against an unread stdout.
        //
        // They finish when the client's message loop ends, which needs the remote
        // command to have terminated *and* said so. A command that dies without
        // draining stdin — a `tar` whose destination does not exist gives up on its
        // first entry — leaves the server holding a stream nobody will finish: it is
        // still being sent stdin for a process that is gone, and the terminating
        // `Status` never comes. Left alone the exec simply never returns, which is
        // what puts a run in "starting the run container" indefinitely.
        //
        // `settle` is the escape. It arms only once the whole of stdin has been
        // handed over, so it cannot cut a healthy copy short, and expiring means the
        // remote is not coming back on its own. Closing stdin then is what unsticks
        // the server: it is the EOF the ordinary path deliberately never sends (see
        // above), and on a v5 stream it costs nothing — the client sends a CLOSE for
        // that one channel and the `Status` still arrives, carrying the exit code and
        // the stderr that say what actually went wrong.
        let (stdin_outcome, stalled) = {
            tokio::pin!(write, read_out, read_err);
            let (mut wrote, mut drained_out, mut drained_err) = (false, false, false);
            let mut outcome = StdinOutcome::Written;
            let mut stalled = false;
            let mut settle: Option<Instant> = None;
            while !(wrote && drained_out && drained_err) {
                tokio::select! {
                    result = &mut write, if !wrote => {
                        wrote = true;
                        outcome = result?;
                        if outcome == StdinOutcome::Stalled {
                            // A chunk could not move: stdin wedged part-way. Nothing
                            // else will arrive either, so stop waiting and close it.
                            stalled = true;
                            break;
                        }
                        if stdin.is_some() {
                            settle = Some(Instant::now() + EXEC_STDIN_IDLE);
                        }
                    }
                    result = &mut read_out, if !drained_out => {
                        result?;
                        drained_out = true;
                    }
                    result = &mut read_err, if !drained_err => {
                        result?;
                        drained_err = true;
                    }
                    () = sleep_until(settle.unwrap_or_else(Instant::now)), if settle.is_some() => {
                        // The archive is all the way over and nothing has come back.
                        // Same conclusion as a write that could not move: the remote
                        // is gone, whichever side of the handover it went on.
                        outcome = StdinOutcome::Stalled;
                        stalled = true;
                        break;
                    }
                }
            }
            (outcome, stalled)
        };
        if stalled {
            // Signal stdin-EOF and let the server finish. Whatever the command wrote
            // before it died is already in `stderr`.
            drop(writer.take());
        }
        let exit_code = exit_code_from_status(
            tokio::time::timeout(EXEC_STATUS_GRACE, status)
                .await
                .ok()
                .flatten(),
        );

        // Stdin stays open through the await above; only now is it safe to close.
        drop(writer);

        Ok(RemoteExec {
            exit_code,
            stdout,
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
            stdin: stdin_outcome,
        })
    }

    /// Run a command streaming its stdout to `out` (a host file), returning the
    /// exit code and captured stderr. This carries the best-effort salvage of one
    /// file out of a hung run (see `collect_file`), and nothing a run's outcome
    /// depends on: exec stdout can be cut short while the exit status still
    /// reports success, which is why the produced tree travels over the driver's
    /// own channel instead (see [`crate::collect`]).
    async fn exec_stream_stdout(
        &self,
        pod: &str,
        command: &[String],
        out: &mut tokio::fs::File,
    ) -> Result<(i32, String)> {
        let params = AttachParams::default()
            .container(RUN_CONTAINER)
            .stdin(false)
            .stdout(true)
            .stderr(true)
            // A salvaged journal can run to megabytes; the client's 1 KiB default
            // pipe would hand it back a kilobyte at a time.
            .max_stdout_buf_size(EXEC_PIPE_BUF);
        let mut attached = self
            .pods()
            .exec(pod, command.iter().cloned(), &params)
            .await
            .map_err(|err| Error::ContainerRuntime(format!("exec in run pod `{pod}`: {err}")))?;

        let mut out_reader = attached.stdout().ok_or_else(|| {
            Error::ContainerRuntime("run pod exec produced no stdout".to_string())
        })?;
        let mut err_reader = attached.stderr().ok_or_else(|| {
            Error::ContainerRuntime("run pod exec produced no stderr".to_string())
        })?;
        let status = attached.take_status().ok_or_else(|| {
            Error::ContainerRuntime("run pod exec produced no status".to_string())
        })?;

        let mut stderr = Vec::new();
        let copy_out = async {
            tokio::io::copy(&mut out_reader, out)
                .await
                .map(|_| ())
                .map_err(|err| Error::ContainerRuntime(format!("streaming run pod stdout: {err}")))
        };
        let read_err = async {
            err_reader
                .read_to_end(&mut stderr)
                .await
                .map_err(|err| Error::ContainerRuntime(format!("reading run pod stderr: {err}")))
        };
        let (copy_out, _) = tokio::join!(copy_out, read_err);
        copy_out?;
        out.flush()
            .await
            .map_err(|err| Error::ContainerRuntime(format!("flushing collected archive: {err}")))?;

        Ok((
            exit_code_from_status(status.await),
            String::from_utf8_lossy(&stderr).into_owned(),
        ))
    }

    /// Stream a `tar` archive into the pod, extracting it at `dest` as the run
    /// user. `preserve_modes` passes `-p` so credential file modes survive exactly;
    /// the seeded tree does not need it. A non-zero `tar` exit is an error carrying
    /// its stderr.
    ///
    /// The remote reads exactly `archive.len()` bytes through `head -c` rather than
    /// reading `tar`'s stdin to EOF. This is load-bearing, not an optimization: the
    /// only way the kube-rs exec client can signal stdin-EOF over the **v4**
    /// WebSocket subprotocol (a `v4.channel.k8s.io` cluster — older k3s, no
    /// `CLOSE`-signal support) is to close the *entire* WebSocket, which tears the
    /// connection down before the terminating `Status` frame is read — so the exit
    /// code comes back as `-1` and every seed looks like a failure even though the
    /// extract succeeded. Bounding the read by byte count lets the pipeline exit on
    /// its own (`head` closes the pipe, `tar` sees EOF, the process terminates and
    /// the server delivers `Status`), so the real exit code is recovered on both v4
    /// and v5 clusters. The pipeline's exit status is `tar`'s (POSIX: the last
    /// command), so a corrupt or truncated stream still surfaces as a non-zero exit.
    ///
    /// ## Why an attempt is retried
    ///
    /// An attempt has one of three outcomes, and only one of them is the seed's
    /// verdict:
    ///
    /// - **`tar` exited `0`.** The seed is done. This is sound even when the write
    ///   was cut short: `tar` exits `0` only once it has read the end-of-archive
    ///   marker, which is the last thing in the stream, so a zero exit *is* proof
    ///   the whole archive arrived.
    /// - **`tar` exited non-zero and said why.** A real, deterministic failure — a
    ///   destination that does not exist, a tree that will not extract. Reported as
    ///   it stands; retrying it would only fail the same way three times.
    /// - **The stream went before the extract could report.** Nothing was decided:
    ///   the pod is up, `tar -x` over the same destination is idempotent, and the
    ///   next attempt gets a fresh stream. So this one is retried, up to
    ///   [`SEED_ATTEMPTS`].
    ///
    /// That third case used to be indistinguishable from the second, because the
    /// stdin write's own `broken pipe` was returned before the exit code and stderr
    /// were ever read — see [`exec_raw`](Self::exec_raw).
    async fn extract_tar(
        &self,
        pod: &str,
        dest: &str,
        archive: &[u8],
        preserve_modes: bool,
    ) -> Result<()> {
        let command = extract_tar_command(dest, archive.len(), preserve_modes);
        for attempt in 1..=SEED_ATTEMPTS {
            let lost = match self.exec_raw(pod, &command, Some(archive)).await {
                Ok(exec) => match seed_verdict(&exec) {
                    SeedVerdict::Seeded => return Ok(()),
                    SeedVerdict::Failed(detail) => {
                        return Err(Error::ContainerRuntime(format!(
                            "seeding `{dest}` in run pod `{pod}` failed: {detail}"
                        )));
                    }
                    SeedVerdict::Lost(detail) => detail,
                },
                Err(err) => err.to_string(),
            };
            if attempt == SEED_ATTEMPTS {
                return Err(Error::ContainerRuntime(format!(
                    "seeding `{dest}` in run pod `{pod}` lost its exec stream on all \
                     {SEED_ATTEMPTS} attempts: {lost}"
                )));
            }
            tracing::warn!(
                pod,
                dest,
                attempt,
                detail = %lost,
                "seeding the run pod lost its exec stream; retrying"
            );
            sleep(SEED_RETRY_BACKOFF).await;
        }
        // `SEED_ATTEMPTS` is non-zero, so the loop always returns.
        unreachable!("the seed loop returns on its final attempt")
    }

    /// Copy the seeded repository's contents into the pod's `/work`.
    async fn seed_workdir(&self, pod: &str, repo_path: &Path) -> Result<()> {
        let archive = tar_dir_contents(repo_path)?;
        self.extract_tar(pod, WORK_DIR, &archive, false).await
    }

    /// Materialize each host directory's contents at its absolute in-container path.
    ///
    /// One archive and one exec per tree, the same shape `seed_workdir` already uses
    /// to stream the whole seeded `/work` in. Modes are left to the pod's umask: a
    /// staged tree carries published audio rather than a credential, and the pod runs
    /// as the image's `node` user, which owns the destination.
    async fn materialize_dirs(&self, pod: &str, dirs: &[ContainerDir]) -> Result<()> {
        for dir in dirs {
            let archive = tar_dir_contents(&dir.host_path)?;
            self.extract_tar(pod, &dir.container_path, &archive, false)
                .await?;
        }
        Ok(())
    }

    /// Materialize credential files at their absolute in-container paths, extracted
    /// under the run user's home with their modes preserved.
    async fn materialize_files(&self, pod: &str, files: &[ContainerFile]) -> Result<()> {
        if files.is_empty() {
            return Ok(());
        }
        let archive = tar_files(files)?;
        // Extract at `/`; each entry's path is absolute (leading `/` stripped for
        // the archive). The files land under `/home/node`, which the run user owns.
        self.extract_tar(pod, "/", &archive, true).await
    }
}

#[cfg(test)]
#[path = "kubernetes.test.rs"]
mod tests;

#[async_trait::async_trait]
impl ContainerRuntime for KubernetesContainerRuntime {
    #[instrument(name = "k8s.start", skip_all, fields(image = %spec.image), err)]
    async fn start(&self, spec: &ContainerSpec) -> Result<ContainerStart> {
        let name = format!("{}{}", self.config.run_pod_prefix, cuid2::create_id());
        let pod = self.run_pod(&name, spec);
        self.pods()
            .create(&PostParams::default(), &pod)
            .await
            .map_err(|err| {
                Error::ContainerRuntime(format!("creating run pod from `{}`: {err}", spec.image))
            })?;

        // From here a failure tears the pod down so a failed start leaks nothing,
        // mirroring the CLI runtime's stop-on-failure contract. The pod may sit
        // queued for cluster capacity first; that wait is reported back so it can
        // be excluded from the run's measured duration.
        let scheduling_wait = match self.await_running(&name).await {
            Ok((_digest, scheduling_wait)) => scheduling_wait,
            Err(err) => {
                let _ = self.stop(&ContainerHandle { id: name.clone() }).await;
                return Err(err);
            }
        };
        let handle = ContainerHandle { id: name };
        if let Err(err) = self.seed_workdir(&handle.id, &spec.repo_path).await {
            let _ = self.stop(&handle).await;
            return Err(err);
        }
        if let Err(err) = self.materialize_dirs(&handle.id, &spec.dirs).await {
            let _ = self.stop(&handle).await;
            return Err(err);
        }
        if let Err(err) = self.materialize_files(&handle.id, &spec.files).await {
            let _ = self.stop(&handle).await;
            return Err(err);
        }
        Ok(ContainerStart {
            handle,
            scheduling_wait,
        })
    }

    async fn exec(&self, container: &ContainerHandle, command: &[String]) -> Result<ExecOutput> {
        // Run under `/work` like the CLI runtime's `exec --workdir`. The images set
        // `/work` as WORKDIR, but a command may be invoked from elsewhere, so wrap
        // it in a shell that cd's first to keep parity.
        let exec = self
            .exec_raw(&container.id, &workdir_command(command), None)
            .await?;
        Ok(ExecOutput {
            exit_code: exec.exit_code,
            stdout: String::from_utf8_lossy(&exec.stdout).into_owned(),
            stderr: exec.stderr,
            idle_timed_out: false,
        })
    }

    #[instrument(name = "k8s.exec_streamed", skip_all, fields(container.id = %container.id), err)]
    async fn exec_streamed(
        &self,
        container: &ContainerHandle,
        command: &[String],
        idle_timeout: Option<Duration>,
        sink: &mut dyn OutputSink,
    ) -> Result<ExecOutput> {
        let params = AttachParams::default()
            .container(RUN_CONTAINER)
            .stdin(false)
            .stdout(true)
            .stderr(true);
        let command = workdir_command(command);
        let mut attached = self
            .pods()
            .exec(&container.id, command.iter().cloned(), &params)
            .await
            .map_err(|err| {
                Error::ContainerRuntime(format!("exec in run pod `{}`: {err}", container.id))
            })?;

        let mut stdout =
            BufReader::new(attached.stdout().ok_or_else(|| {
                Error::ContainerRuntime("run pod exec produced no stdout".into())
            })?)
            .lines();
        let mut stderr =
            BufReader::new(attached.stderr().ok_or_else(|| {
                Error::ContainerRuntime("run pod exec produced no stderr".into())
            })?)
            .lines();
        let status = attached
            .take_status()
            .ok_or_else(|| Error::ContainerRuntime("run pod exec produced no status".into()))?;

        // Drain both streams concurrently, forwarding each line to the sink as it
        // arrives, exactly as the CLI runtime does.
        let drained = drain_with_idle_timeout(&mut stdout, &mut stderr, idle_timeout, sink).await?;

        if drained.idle_timed_out {
            // Tear the exec down ourselves. Awaiting `status` here would block
            // until the kubelet's own idle timeout closed the connection hours
            // later — precisely the behaviour the watchdog exists to pre-empt.
            // The pod is deleted by the caller's `stop` shortly after.
            drop(stdout);
            drop(stderr);
            attached.abort();
            return Ok(ExecOutput {
                exit_code: -1,
                stdout: drained.stdout,
                stderr: drained.stderr,
                idle_timed_out: true,
            });
        }

        Ok(ExecOutput {
            exit_code: exit_code_from_status(status.await),
            stdout: drained.stdout,
            stderr: drained.stderr,
            idle_timed_out: false,
        })
    }

    async fn stop(&self, container: &ContainerHandle) -> Result<()> {
        // Delete with a zero grace period: the run is over and the pod is
        // disposable, so there is nothing to drain.
        let params = DeleteParams::default().grace_period(0);
        match self.pods().delete(&container.id, &params).await {
            Ok(_) => Ok(()),
            // A pod already gone is success: `stop` is also the failure-cleanup
            // path, so a double stop must not error.
            Err(kube::Error::Api(err)) if err.code == 404 => Ok(()),
            Err(err) => Err(Error::ContainerRuntime(format!(
                "deleting run pod `{}`: {err}",
                container.id
            ))),
        }
    }

    async fn image_digest(&self, _image: &str) -> Result<Option<String>> {
        // The digest is resolved from the pod's container status when it reaches
        // Running (`await_running`) and recorded by the engine immediately after
        // `start`. The kubelet — not this runtime — pulls the image, so there is no
        // separate local image to inspect here.
        Ok(None)
    }
}

/// Collects a finished run's working tree over the driver's own collection channel
/// (see [`crate::collect`]) and unpacks it on the host.
#[derive(Clone)]
pub struct KubernetesArtifactCollector {
    runtime: KubernetesContainerRuntime,
    base_dir: std::path::PathBuf,
}

impl std::fmt::Debug for KubernetesArtifactCollector {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("KubernetesArtifactCollector")
            .field("base_dir", &self.base_dir)
            .finish_non_exhaustive()
    }
}

impl KubernetesArtifactCollector {
    /// Collect into unique directories under `base_dir` using `runtime`.
    pub fn new(
        runtime: KubernetesContainerRuntime,
        base_dir: impl Into<std::path::PathBuf>,
    ) -> Self {
        Self {
            runtime,
            base_dir: base_dir.into(),
        }
    }
}

impl KubernetesArtifactCollector {
    /// One upload: start the uploader in the pod and receive its stream on the
    /// listener, concurrently.
    ///
    /// The listener's verdict is the attempt's verdict, and the exec that started
    /// the uploader never overrules it. The exec is consulted only when no verified
    /// upload has landed yet:
    ///
    /// - An uploader that reported an exit code has stopped, so the upload it was
    ///   making is over; the attempt fails with its exit code and stderr once a
    ///   short grace for the verified upload to be polled has passed.
    /// - An exec that reported no exit code has lost its WebSocket, not its
    ///   uploader: the process in the pod keeps streaming to the listener, which
    ///   is the channel that matters. The attempt keeps waiting for the listener's
    ///   own verdict, which its idle bound guarantees.
    async fn upload_attempt(
        &self,
        pod: &str,
        command: &[String],
        listener: &CollectListener,
        archive: &Path,
    ) -> Result<Received> {
        let upload = self.runtime.exec_raw(pod, command, None);
        let receive = listener.receive(archive);
        tokio::pin!(upload);
        tokio::pin!(receive);
        tokio::select! {
            received = &mut receive => {
                let received = received?;
                // Let the uploader's exit reach the log; nothing turns on it now.
                match tokio::time::timeout(UPLOADER_EXIT_GRACE, &mut upload).await {
                    Ok(Ok(exec)) => tracing::debug!(
                        pod,
                        exit_code = exec.exit_code,
                        stderr = %exec.stderr.trim(),
                        "the collection uploader exited",
                    ),
                    Ok(Err(err)) => tracing::debug!(
                        pod,
                        error = %err,
                        "the collection uploader's exec failed; the upload was already verified",
                    ),
                    Err(_elapsed) => tracing::debug!(
                        pod,
                        "the collection uploader's exec did not report in time; the upload was already verified",
                    ),
                }
                Ok(received)
            }
            exec = &mut upload => {
                let exec = match exec {
                    Ok(exec) => exec,
                    Err(err) => {
                        // The exec could not even be started; nothing is uploading.
                        return Err(err);
                    }
                };
                if exec.exit_code == NO_STATUS_EXIT_CODE {
                    tracing::warn!(
                        pod,
                        "the collection uploader's exec stream was lost; waiting on the listener's verdict",
                    );
                    return receive.await;
                }
                match tokio::time::timeout(UPLOAD_AFTER_EXIT_GRACE, &mut receive).await {
                    Ok(received) => received,
                    Err(_elapsed) => Err(Error::ArtifactCollection(format!(
                        "the uploader exited {} with no completed upload: {}",
                        exec.exit_code,
                        exec.stderr.trim()
                    ))),
                }
            }
        }
    }
}

#[async_trait::async_trait]
impl ArtifactCollector for KubernetesArtifactCollector {
    async fn collect(&self, container: &ContainerHandle) -> Result<ArtifactCollection> {
        // The tree leaves the pod over the driver's own channel, never over exec
        // stdout: the listener is bound on the driver's pod IP, the exec carries
        // only the command that starts the uploader, and the upload is accepted
        // only once its terminator's byte count and digest match what arrived. A
        // driver without its pod IP has no address to offer the sandbox and cannot
        // collect at all; the dispatcher wires it in through the downward API.
        let host = self
            .runtime
            .config
            .pod_ip
            .clone()
            .ok_or_else(|| Error::ArtifactCollection("TCAB_K8S_POD_IP is unset".to_string()))?;
        let listener = CollectListener::bind().await.map_err(|err| {
            Error::ArtifactCollection(format!("binding the upload listener: {err}"))
        })?;
        let command = uploader_command(
            &host,
            listener.port(),
            listener.token(),
            WORK_DIR,
            SKIPPED_DIRS,
        );

        let dest = self
            .base_dir
            .join(format!("artifact-{}", cuid2::create_id()));
        let archive_path = self
            .base_dir
            .join(format!("artifact-{}.tar", cuid2::create_id()));

        // Retry the upload a few times. Every failure the listener can report is
        // transient from here — the sandbox is up and its tree is final — and the
        // dispatcher never retries a driver Job, so one blip must not cost a run
        // that has already paid for every one of its API calls. Unpacking is the
        // one step outside the retry: an archive that verified byte-exact and then
        // failed to unpack is a host-side problem another transfer cannot change.
        std::fs::create_dir_all(&dest).map_err(|err| Error::ArtifactCollection(err.to_string()))?;
        for attempt in 1..=COLLECT_ATTEMPTS {
            let failure = match self
                .upload_attempt(&container.id, &command, &listener, &archive_path)
                .await
            {
                Ok(received) => {
                    tracing::info!(
                        pod = %container.id,
                        bytes = received.bytes,
                        attempt,
                        "collected the run tree",
                    );
                    let unpack = unpack_archive_file(&archive_path, &dest);
                    let _ = std::fs::remove_file(&archive_path);
                    if unpack.is_err() {
                        let _ = std::fs::remove_dir_all(&dest);
                    }
                    unpack?;
                    return Ok(ArtifactCollection::new(dest));
                }
                Err(err) => err,
            };
            let _ = std::fs::remove_file(&archive_path);

            if attempt == COLLECT_ATTEMPTS {
                let _ = std::fs::remove_dir_all(&dest);
                return Err(failure);
            }
            tracing::warn!(
                pod = %container.id,
                attempt,
                attempts = COLLECT_ATTEMPTS,
                error = %failure,
                "collecting run artifacts failed; retrying",
            );
            sleep(Duration::from_millis(500 * 2u64.pow(attempt - 1))).await;
        }
        unreachable!("the collection loop returns on the final attempt")
    }

    async fn collect_file(
        &self,
        container: &ContainerHandle,
        container_path: &str,
        dest: &std::path::Path,
    ) -> Result<bool> {
        // Preparing the host destination is the one part of this that is ours; a failure
        // there is a real error, everything beyond it is best-effort.
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|err| Error::ArtifactCollection(err.to_string()))?;
        }
        let mut file = tokio::fs::File::create(dest).await.map_err(|err| {
            Error::ArtifactCollection(format!(
                "creating the salvage destination `{}`: {err}",
                dest.display()
            ))
        })?;

        // Unlike the CLI runtime's `cp`, there is no filesystem-layer channel into a pod:
        // the only way to read a byte out of one is to run something inside it. So the
        // pod must still be **up** — which is exactly why the caller salvages *before*
        // `stop`, while a hung or over-cap run's container is wedged but alive. A pod that
        // has already terminated cannot be salvaged from and reports nothing recovered.
        let result = tokio::time::timeout(
            SALVAGE_READ_TIMEOUT,
            self.runtime.exec_stream_stdout(
                &container.id,
                &salvage_read_command(container_path),
                &mut file,
            ),
        )
        .await;
        drop(file);

        let result = match result {
            Ok(result) => result,
            Err(_elapsed) => {
                // The salvage runs, by definition, against a container that has already
                // stopped responding — and nothing below this bounds the wait: a pod on a
                // NotReady node holds the exec open until the kubelet's own idle timeout
                // (hours). Waiting that out would delay reporting the hang, which is the
                // one thing on this path that must not be delayed, so a salvage that does
                // not answer promptly reports nothing recovered.
                tracing::warn!(
                    pod = %container.id,
                    path = %container_path,
                    seconds = SALVAGE_READ_TIMEOUT.as_secs(),
                    "salvaging a file from the run pod timed out",
                );
                let _ = std::fs::remove_file(dest);
                return Ok(false);
            }
        };

        match result {
            Ok((0, _)) => Ok(true),
            Ok((exit_code, stderr)) => {
                // Almost always `cat: … : No such file or directory` — a run that never
                // wrote the sidecar. Debug, not warn: nothing is wrong.
                tracing::debug!(
                    pod = %container.id,
                    path = %container_path,
                    exit_code,
                    stderr = %stderr.trim(),
                    "salvaging a file from the run pod found nothing",
                );
                let _ = std::fs::remove_file(dest);
                Ok(false)
            }
            Err(err) => {
                tracing::warn!(
                    pod = %container.id,
                    path = %container_path,
                    error = %err,
                    "could not exec into the run pod to salvage a file",
                );
                let _ = std::fs::remove_file(dest);
                Ok(false)
            }
        }
    }
}

/// How long a salvage read may take before it is abandoned.
///
/// The work is a `cat` of one file, not a build, so this is generous for the read itself and
/// deliberately short against what it is guarding: the salvage happens on the failure path of a run
/// that has *already* stopped responding, and a pod whose node has gone NotReady will hold the exec
/// open until the kubelet's streaming idle timeout — hours. The diagnostic is best-effort and the
/// failure report is not, so the report wins.
const SALVAGE_READ_TIMEOUT: Duration = Duration::from_secs(120);

/// The argv that streams one in-pod file to stdout for salvage.
///
/// `--` guards a path that begins with a dash from being read as an option, and the
/// command is passed as argv rather than through a shell so nothing in the path can be
/// interpreted. Split out so the shape is unit-testable without a cluster — the exec
/// itself needs a live `kube::Client` and cannot be.
fn salvage_read_command(container_path: &str) -> Vec<String> {
    vec![
        "cat".to_string(),
        "--".to_string(),
        container_path.to_string(),
    ]
}

/// Build the `Pod` manifest for a run. Pure given the spec and config, so the
/// manifest shape is unit-tested without a cluster.
fn build_run_pod(name: &str, spec: &ContainerSpec, config: &KubernetesConfig) -> Pod {
    // Non-secret environment (harness telemetry configuration) and secrets both
    // become plain `EnvVar`s; they are separate fields on the spec only so that
    // the non-secret half stays safe to log. Secrets are applied last so a
    // malformed telemetry variable can never shadow the API key the harness
    // authenticates with.
    let env = spec
        .env
        .iter()
        .chain(spec.secrets.iter())
        .map(|(key, value)| EnvVar {
            name: key.clone(),
            value: Some(value.clone()),
            value_from: None,
        })
        .collect::<Vec<_>>();

    let resources = ResourceRequirements {
        requests: quantity_map([
            ("cpu", config.cpu_request.as_deref()),
            ("memory", config.memory_request.as_deref()),
        ]),
        limits: quantity_map([
            ("cpu", config.cpu_limit.as_deref()),
            ("memory", config.memory_limit.as_deref()),
        ]),
        claims: None,
    };

    let container = Container {
        name: RUN_CONTAINER.to_string(),
        image: Some(spec.image.clone()),
        // No command: the images' keep-alive `CMD ["sleep", "infinity"]` keeps the
        // pod up so the orchestrator can `exec` the session into it, exactly as the
        // CLI runtime relies on the same image CMD under `docker run --detach`.
        env: (!env.is_empty()).then_some(env),
        resources: Some(resources),
        ..Default::default()
    };

    let mut labels = BTreeMap::from([
        (
            "app.kubernetes.io/managed-by".to_string(),
            "tcab-driver".to_string(),
        ),
        (
            "app.kubernetes.io/part-of".to_string(),
            "test-cabinet".to_string(),
        ),
        // Surface the run's intended network posture so a NetworkPolicy can select
        // on it; Kubernetes has no per-pod "no network" switch the way `--network
        // none` does, so egress is enforced by policy, not here.
        (
            "tcab.dev/network".to_string(),
            if spec.network_enabled {
                "enabled"
            } else {
                "none"
            }
            .to_string(),
        ),
    ]);
    // Tag the pod with the run's job id so the driver can target exactly this run's
    // sandbox when a cancellation asks it to tear the pod down.
    if let Some(job_id) = &config.job_id {
        labels.insert(JOB_ID_LABEL.to_string(), job_id.clone());
    }

    let image_pull_secrets = (!config.image_pull_secrets.is_empty()).then(|| {
        config
            .image_pull_secrets
            .iter()
            .map(|name| LocalObjectReference { name: name.clone() })
            .collect()
    });

    let host_aliases = run_pod_host_aliases(&spec.add_hosts, config.pod_ip.as_deref());

    let pod_spec = PodSpec {
        containers: vec![container],
        restart_policy: Some("Never".to_string()),
        service_account_name: config.run_service_account.clone(),
        image_pull_secrets,
        host_aliases,
        // The last-resort bound on a sandbox's life. The container's keep-alive is
        // `sleep infinity`, so a sandbox whose driver died by SIGKILL — and which the
        // dispatcher's reaper never got to either — would otherwise run until an
        // operator noticed, holding its requests against the node the whole time.
        // Sized to outlast any real run; see `pod_active_deadline`.
        active_deadline_seconds: config
            .pod_active_deadline
            .map(|deadline| deadline.as_secs() as i64),
        // Untrusted model code runs here; it never needs the API, so withhold a
        // service-account token from the run pod.
        automount_service_account_token: Some(false),
        ..Default::default()
    };

    Pod {
        metadata: ObjectMeta {
            name: Some(name.to_string()),
            labels: Some(labels),
            annotations: Some(BTreeMap::from([(
                SAFE_TO_EVICT_ANNOTATION.to_string(),
                SAFE_TO_EVICT_FALSE.to_string(),
            )])),
            ..Default::default()
        },
        spec: Some(pod_spec),
        status: None,
    }
}

/// Translate the spec's `--add-host`-style mappings into pod `hostAliases`. The
/// live-preview mapping uses the special `host-gateway` target the CLI runtime
/// relies on; in a cluster that resolves to the driver's own pod IP, so it is
/// rewritten to `pod_ip`. A mapping is dropped when its IP cannot be resolved
/// (preview is best-effort). Returns `None` when there are none, so the field is
/// omitted entirely.
fn run_pod_host_aliases(add_hosts: &[String], pod_ip: Option<&str>) -> Option<Vec<HostAlias>> {
    let aliases: Vec<HostAlias> = add_hosts
        .iter()
        .filter_map(|mapping| {
            let (hostname, target) = mapping.split_once(':')?;
            let ip = if target == "host-gateway" {
                pod_ip?
            } else {
                target
            };
            Some(HostAlias {
                ip: ip.to_string(),
                hostnames: Some(vec![hostname.to_string()]),
            })
        })
        .collect();
    (!aliases.is_empty()).then_some(aliases)
}

/// A `{name: Quantity}` map from the provided non-`None` entries, or `None` when
/// none are set (so the resource field is omitted rather than emptied).
fn quantity_map<const N: usize>(
    entries: [(&str, Option<&str>); N],
) -> Option<BTreeMap<String, Quantity>> {
    let map: BTreeMap<String, Quantity> = entries
        .into_iter()
        .filter_map(|(key, value)| value.map(|v| (key.to_string(), Quantity(v.to_string()))))
        .collect();
    (!map.is_empty()).then_some(map)
}

/// Wrap a command so it runs from `/work`, matching the CLI runtime's
/// `exec --workdir /work`. The images already set `/work` as WORKDIR, so this is
/// belt-and-suspenders for a harness that resets it.
fn workdir_command(command: &[String]) -> Vec<String> {
    let joined = command
        .iter()
        .map(|arg| shell_quote(arg))
        .collect::<Vec<_>>()
        .join(" ");
    vec![
        "sh".to_string(),
        "-c".to_string(),
        format!("cd {WORK_DIR} && exec {joined}"),
    ]
}

/// Single-quote an argument for safe inclusion in the `sh -c` wrapper.
fn shell_quote(arg: &str) -> String {
    format!("'{}'", arg.replace('\'', r"'\''"))
}

/// The `sh -c` command that extracts a `len`-byte `tar` stream from stdin into
/// `dest`. The `head -c {len}` prefix bounds the read so the remote pipeline
/// terminates on its own instead of relying on stdin-EOF — see [`KubernetesContainerRuntime::extract_tar`]
/// for why that distinction is load-bearing on a v4 exec WebSocket. The pipeline
/// exit status is `tar`'s (the last command), so a short or corrupt stream still
/// fails non-zero.
fn extract_tar_command(dest: &str, len: usize, preserve_modes: bool) -> Vec<String> {
    let preserve = if preserve_modes { "-p " } else { "" };
    let pipeline = format!(
        "head -c {len} | tar -x {preserve}-f - -C {dest}",
        dest = shell_quote(dest),
    );
    vec!["sh".to_string(), "-c".to_string(), pipeline]
}

/// What one seed attempt decided.
#[derive(Debug, PartialEq, Eq)]
enum SeedVerdict {
    /// The extract completed. The tree is in the pod.
    Seeded,
    /// The extract ran and failed on its own terms, with this detail. Deterministic:
    /// another attempt fails the same way.
    Failed(String),
    /// Nothing was decided — the exec stream went before the extract could report.
    /// Worth another attempt on a fresh stream.
    Lost(String),
}

/// Read one seed attempt's outcome.
///
/// A zero exit is [`Seeded`](SeedVerdict::Seeded) even when the stdin write did not
/// finish, and that is sound rather than lenient: `tar` exits `0` only once it has
/// read the end-of-archive marker, and that marker is the last thing in the stream,
/// so a zero exit *is* the proof that the whole archive arrived.
///
/// Everything else turns on whether the attempt reached a verdict at all. A command
/// that reported an exit code ran and judged its own input. One whose stdin was cut
/// short, or that never produced a terminating `Status`, judged nothing: it saw a
/// truncated archive, or the stream was gone before it could answer.
fn seed_verdict(exec: &RemoteExec) -> SeedVerdict {
    if exec.exit_code == 0 {
        return SeedVerdict::Seeded;
    }
    let stderr = exec.stderr.trim();
    match exec.stdin {
        // The remote stopped reading and never came back. If it said why on its way
        // out, that is the answer and repeating it three times would only reproduce
        // it — a destination the image does not have will not appear on a retry.
        // With nothing said, the stall is all we know, and that is worth another go.
        StdinOutcome::Stalled if !stderr.is_empty() => SeedVerdict::Failed(stderr.to_string()),
        StdinOutcome::Stalled => {
            SeedVerdict::Lost("the remote stopped reading the archive".to_string())
        }
        // The stream was pulled out from under the write. Nothing was decided by
        // anyone, so try again on a fresh one.
        StdinOutcome::CutShort => SeedVerdict::Lost(with_stderr(
            "the stream closed before the archive finished writing",
            stderr,
        )),
        StdinOutcome::Written if exec.exit_code == NO_STATUS_EXIT_CODE => SeedVerdict::Lost(
            with_stderr("the stream closed without a terminating status", stderr),
        ),
        // It read the whole archive and judged it. Take it at its word.
        StdinOutcome::Written => SeedVerdict::Failed(with_stderr(
            &format!("tar exited {}", exec.exit_code),
            stderr,
        )),
    }
}

/// Join a cause to whatever the command managed to say for itself. The stderr is
/// the useful half whenever there is any, so it is never dropped.
fn with_stderr(cause: &str, stderr: &str) -> String {
    match stderr {
        "" => cause.to_string(),
        stderr => format!("{cause}: {stderr}"),
    }
}

/// How writing an exec's stdin ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StdinOutcome {
    /// Every byte was handed over.
    Written,
    /// The far end went away before the write finished — see [`is_stream_closed`].
    CutShort,
    /// The write stopped making progress: nothing is draining stdin any more.
    Stalled,
}

/// One `exec` attempt's outcome.
///
/// `stdin` is the part that is not obvious: anything but
/// [`Written`](StdinOutcome::Written) means the remote stopped reading before it
/// had been sent everything, so `exit_code` describes a command that ran on a
/// truncated input rather than the work the caller asked for.
#[derive(Debug)]
struct RemoteExec {
    /// The command's exit code, or [`NO_STATUS_EXIT_CODE`] when no terminating
    /// `Status` arrived.
    exit_code: i32,
    /// Everything the command wrote to stdout, as raw bytes.
    stdout: Vec<u8>,
    /// Everything the command wrote to stderr.
    stderr: String,
    /// How writing `stdin` ended. [`StdinOutcome::Written`] for an exec that was
    /// given none.
    stdin: StdinOutcome,
}

/// Whether an I/O error on the exec's stdin means *the other end went away* rather
/// than a fault of ours.
///
/// The writer is the near half of a [`tokio::io::duplex`] whose reader lives in the
/// kube client's message loop, so every one of these is that loop having ended:
/// the terminating `Status` arrived, the server closed the WebSocket, or the
/// connection broke. None of them is diagnosable from here, and all of them are
/// better described by the exit code and stderr that come back with it.
fn is_stream_closed(err: &std::io::Error) -> bool {
    use std::io::ErrorKind::{
        BrokenPipe, ConnectionAborted, ConnectionReset, NotConnected, UnexpectedEof, WriteZero,
    };
    matches!(
        err.kind(),
        BrokenPipe | ConnectionReset | ConnectionAborted | NotConnected | UnexpectedEof | WriteZero
    )
}

/// The exit code carried by a remote-exec terminating [`Status`]: `0` on success,
/// the `ExitCode` cause's value on a non-zero exit, or `-1` when no status arrived.
fn exit_code_from_status(status: Option<Status>) -> i32 {
    let Some(status) = status else {
        return -1;
    };
    if status.status.as_deref() == Some("Success") {
        return 0;
    }
    status
        .details
        .as_ref()
        .and_then(|details| details.causes.as_ref())
        .and_then(|causes| {
            causes
                .iter()
                .find(|cause| cause.reason.as_deref() == Some("ExitCode"))
        })
        .and_then(|cause| cause.message.as_deref())
        .and_then(|message| message.parse::<i32>().ok())
        // A failure with no parseable ExitCode is reported as a generic non-zero.
        .unwrap_or(1)
}

/// The registry digest reference (`repo@sha256:…`) the kubelet resolved the run
/// pod's image to, read from its container status once running. `None` when the
/// image carries no digest (a local/tag-only image) or the status is absent.
fn resolved_image_digest(pod: &Pod) -> Option<String> {
    let image_id = pod
        .status
        .as_ref()
        .and_then(|status| status.container_statuses.as_ref())
        .and_then(|statuses| statuses.iter().find(|cs| cs.name == RUN_CONTAINER))
        .map(|cs| cs.image_id.as_str())?;
    normalize_image_id(image_id)
}

/// Normalize a Kubernetes `imageID` into a `repo@sha256:…` digest reference, or
/// `None` when it carries no digest. Strips the legacy `docker-pullable://`
/// prefix some runtimes still emit.
fn normalize_image_id(image_id: &str) -> Option<String> {
    let image_id = image_id.trim();
    let image_id = image_id
        .strip_prefix("docker-pullable://")
        .unwrap_or(image_id);
    (image_id.contains("@sha256:") && !image_id.is_empty()).then(|| image_id.to_string())
}

/// Whether the scheduler has bound the pod to a node — the boundary between the
/// "queued for capacity" wait and the "startup work" wait. True once the pod
/// carries a `PodScheduled=True` condition or has a node assigned in its spec
/// (the field the scheduler sets on binding); either signal alone is sufficient.
fn pod_scheduled(pod: &Pod) -> bool {
    let condition_true = pod
        .status
        .as_ref()
        .and_then(|status| status.conditions.as_ref())
        .map(|conditions| {
            conditions
                .iter()
                .any(|c| c.type_ == "PodScheduled" && c.status == "True")
        })
        .unwrap_or(false);
    let node_assigned = pod
        .spec
        .as_ref()
        .and_then(|spec| spec.node_name.as_deref())
        .is_some_and(|node| !node.is_empty());
    condition_true || node_assigned
}

/// The scheduler's explanation for why a pod is not yet scheduled, taken from the
/// `PodScheduled=False` condition (for example `Unschedulable: 0/3 nodes are
/// available: insufficient memory`), for a schedule-timeout diagnostic.
fn pod_scheduling_message(pod: &Pod) -> Option<String> {
    let condition = pod
        .status
        .as_ref()
        .and_then(|status| status.conditions.as_ref())?
        .iter()
        .find(|c| c.type_ == "PodScheduled")?;
    match (condition.reason.as_deref(), condition.message.as_deref()) {
        (Some(reason), Some(message)) => Some(format!("{reason}: {message}")),
        (Some(reason), None) => Some(reason.to_string()),
        (None, Some(message)) => Some(message.to_string()),
        (None, None) => None,
    }
}

/// The waiting reason of a pod's run container (for example `ImagePullBackOff`),
/// for a readiness-timeout diagnostic.
fn pod_waiting_reason(pod: &Pod) -> Option<String> {
    pod.status
        .as_ref()
        .and_then(|status| status.container_statuses.as_ref())
        .and_then(|statuses| statuses.iter().find(|cs| cs.name == RUN_CONTAINER))
        .and_then(|cs| cs.state.as_ref())
        .and_then(|state| state.waiting.as_ref())
        .and_then(|waiting| waiting.reason.clone())
}

/// Build a tar archive of the *contents* of `dir` (entries relative to the
/// directory root), for extraction at an absolute path in the pod: the seeded
/// repository into `/work`, and a staged tree at the path its spec names.
fn tar_dir_contents(dir: &Path) -> Result<Vec<u8>> {
    let mut builder = tar::Builder::new(Vec::new());
    builder
        .append_dir_all(".", dir)
        .and_then(|()| builder.into_inner())
        .map_err(|err| {
            Error::ContainerRuntime(format!("archiving seed `{}`: {err}", dir.display()))
        })
}

/// Build a tar archive carrying each [`ContainerFile`] at its absolute path (the
/// leading `/` stripped, so extraction with `-C /` lands it correctly) with its
/// mode in the header.
fn tar_files(files: &[ContainerFile]) -> Result<Vec<u8>> {
    let mut builder = tar::Builder::new(Vec::new());
    for file in files {
        let path = file.container_path.trim_start_matches('/');
        let mut header = tar::Header::new_gnu();
        header.set_size(file.contents.len() as u64);
        header.set_mode(file.mode);
        header.set_mtime(0);
        header.set_entry_type(tar::EntryType::Regular);
        header.set_cksum();
        builder
            .append_data(&mut header, path, file.contents.as_slice())
            .map_err(|err| {
                Error::ContainerRuntime(format!(
                    "archiving container file `{}`: {err}",
                    file.container_path
                ))
            })?;
    }
    builder
        .into_inner()
        .map_err(|err| Error::ContainerRuntime(format!("finalizing container-file archive: {err}")))
}

/// Unpack a tar archive file into `dest` on the host.
///
/// The `tar` crate reports an entry that would not unpack as a chain — the host path,
/// then the entry, then the I/O error underneath — and only the outermost link is in
/// its `Display`. The report here walks the whole chain, because the innermost link
/// is the one that says *why*: a stream cut short, a full disk, a permission.
fn unpack_archive_file(archive: &Path, dest: &Path) -> Result<()> {
    let file = std::fs::File::open(archive)
        .map_err(|err| Error::ArtifactCollection(format!("opening collected archive: {err}")))?;
    tar::Archive::new(file).unpack(dest).map_err(|err| {
        Error::ArtifactCollection(format!(
            "unpacking collected archive: {}",
            error_chain(&err)
        ))
    })
}

/// An error and every cause beneath it, outermost first, joined with `: `.
fn error_chain(err: &dyn std::error::Error) -> String {
    let mut chain = err.to_string();
    let mut source = err.source();
    while let Some(cause) = source {
        chain.push_str(": ");
        chain.push_str(&cause.to_string());
        source = cause.source();
    }
    chain
}
