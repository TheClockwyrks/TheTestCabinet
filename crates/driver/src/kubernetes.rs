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
use tokio::time::{Instant, sleep};
use tracing::instrument;
use uuid::Uuid;

use test_cabinet_core::execution::{
    ArtifactCollection, ArtifactCollector, ContainerFile, ContainerHandle, ContainerRuntime,
    ContainerSpec, ContainerStart, ExecOutput, OutputSink, OutputStream,
};
use test_cabinet_core::{Error, Result};

/// The container working directory the seeded repository is copied into. Matches
/// the run-container images' `WORKDIR` (`containers/base/Dockerfile`).
const WORK_DIR: &str = "/work";

/// The name of the single container in each run pod. `exec` targets it explicitly
/// so a future sidecar would not make the target ambiguous.
const RUN_CONTAINER: &str = "run";

/// The label each run pod carries identifying the job it belongs to (the same key
/// the dispatcher stamps on the driver `Job`). It lets the driver find and delete
/// exactly *its* sandbox pod when a run is canceled, without disturbing another
/// run's pod that shares the `managed-by: tcab-driver` label.
const JOB_ID_LABEL: &str = "tcab.dev/job-id";

/// How many times to attempt the streaming `tar` artifact collection before giving
/// up. The collection rides the kube exec WebSocket, where a transient tunnel drop
/// surfaces as a missing exit `Status` (`tar exit -1`) on an otherwise-finished run;
/// `tar -c` is read-only so re-running it is safe. See `KubernetesArtifactCollector`.
const COLLECT_ATTEMPTS: u32 = 4;

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
    /// Memory request applied to each run pod (e.g. `1Gi`).
    pub memory_request: Option<String>,
    /// Memory limit applied to each run pod (e.g. `4Gi`).
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
    /// The driver pod's own IP, used to route a watched asset-generation sandbox
    /// pod's live preview frames back to the driver via a `hostAlias`. `None`
    /// disables the route (previews are best-effort, so runs are unaffected).
    pub pod_ip: Option<String>,
    /// Name prefix for run pods (the rest is a uuid).
    pub run_pod_prefix: String,
    /// The id of the job this driver executes. Stamped onto each run pod as the
    /// [`JOB_ID_LABEL`] so the driver can find and delete its own sandbox pod on
    /// cancellation. `None` outside a dispatcher-driven run (e.g. a test), in which
    /// case the label is omitted and [`Self::delete_run_pods_for_job`] is a no-op.
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
    /// **canceled** mid-flight. Dropping the run future cancels the in-flight
    /// harness `exec`, but the sandbox pod the run created outlives it, so it is
    /// removed here: every pod carrying this job's [`JOB_ID_LABEL`] is deleted with
    /// a zero grace period (the run is over; there is nothing to drain), matching
    /// what [`ContainerRuntime::stop`] does at a normal end of run.
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
    async fn exec_raw(
        &self,
        pod: &str,
        command: &[String],
        stdin: Option<&[u8]>,
    ) -> Result<(i32, Vec<u8>, String)> {
        let params = AttachParams::default()
            .container(RUN_CONTAINER)
            .stdin(stdin.is_some())
            .stdout(true)
            .stderr(true);
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
        // Crucially, we do NOT close (shutdown/drop) stdin here. Closing stdin is
        // the kube-rs client's signal for stdin-EOF, and on the **v4** exec
        // WebSocket subprotocol (`v4.channel.k8s.io` — no per-stream CLOSE frame)
        // the only way it can send that signal is to close the *entire* WebSocket,
        // which races — and beats — the terminating `Status` frame coming back, so
        // the exit code is lost as `-1`. Instead the only stdin consumer
        // (`extract_tar`) bounds its own read with `head -c`, so the remote process
        // exits on its own and the server delivers `Status` without us ever needing
        // to signal stdin-EOF. We therefore hold the writer open until the command
        // has finished (status received), then drop it at end of scope — by which
        // point the message loop has already broken on `Status`, so the close is a
        // harmless no-op on both v4 and v5. (Every stdin command must self-terminate
        // without relying on stdin-EOF; a command that reads to EOF would hang.)
        let write = async {
            if let (Some(data), Some(writer)) = (stdin, writer.as_mut()) {
                writer.write_all(data).await.map_err(|err| {
                    Error::ContainerRuntime(format!("writing stdin to run pod `{pod}`: {err}"))
                })?;
            }
            Ok::<(), Error>(())
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
        let (write, _, _) = tokio::join!(write, read_out, read_err);
        write?;
        let exit_code = exit_code_from_status(status.await);

        // Stdin stays open through the await above; only now is it safe to close.
        drop(writer);

        Ok((
            exit_code,
            stdout,
            String::from_utf8_lossy(&stderr).into_owned(),
        ))
    }

    /// Run a command streaming its stdout to `out` (a host file), returning the
    /// exit code and captured stderr. This is the copy-**out** path: the working
    /// tree can be large, so the `tar` stream is streamed to disk rather than held
    /// in memory.
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
            .stderr(true);
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
    async fn extract_tar(
        &self,
        pod: &str,
        dest: &str,
        archive: &[u8],
        preserve_modes: bool,
    ) -> Result<()> {
        let command = extract_tar_command(dest, archive.len(), preserve_modes);
        let (exit_code, _stdout, stderr) = self.exec_raw(pod, &command, Some(archive)).await?;
        if exit_code != 0 {
            return Err(Error::ContainerRuntime(format!(
                "seeding `{dest}` in run pod `{pod}` failed (tar exit {exit_code}): {}",
                stderr.trim()
            )));
        }
        Ok(())
    }

    /// Copy the seeded repository's contents into the pod's `/work`.
    async fn seed_workdir(&self, pod: &str, repo_path: &Path) -> Result<()> {
        let archive = tar_dir_contents(repo_path)?;
        self.extract_tar(pod, WORK_DIR, &archive, false).await
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
        let name = format!("{}{}", self.config.run_pod_prefix, Uuid::new_v4());
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
        let (exit_code, stdout, stderr) = self
            .exec_raw(&container.id, &workdir_command(command), None)
            .await?;
        Ok(ExecOutput {
            exit_code,
            stdout: String::from_utf8_lossy(&stdout).into_owned(),
            stderr,
        })
    }

    #[instrument(name = "k8s.exec_streamed", skip_all, fields(container.id = %container.id), err)]
    async fn exec_streamed(
        &self,
        container: &ContainerHandle,
        command: &[String],
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

        let mut captured_stdout = String::new();
        let mut captured_stderr = String::new();
        let mut stdout_open = true;
        let mut stderr_open = true;
        // Drain both streams concurrently, forwarding each line to the sink as it
        // arrives, exactly as the CLI runtime does.
        while stdout_open || stderr_open {
            tokio::select! {
                line = stdout.next_line(), if stdout_open => match read_line(line)? {
                    Some(line) => {
                        sink.on_line(OutputStream::Stdout, &line);
                        captured_stdout.push_str(&line);
                        captured_stdout.push('\n');
                    }
                    None => stdout_open = false,
                },
                line = stderr.next_line(), if stderr_open => match read_line(line)? {
                    Some(line) => {
                        sink.on_line(OutputStream::Stderr, &line);
                        captured_stderr.push_str(&line);
                        captured_stderr.push('\n');
                    }
                    None => stderr_open = false,
                },
            }
        }

        Ok(ExecOutput {
            exit_code: exit_code_from_status(status.await),
            stdout: captured_stdout,
            stderr: captured_stderr,
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

/// Collects a finished run's working tree by streaming it out of the pod with
/// `tar` and unpacking it on the host.
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

#[async_trait::async_trait]
impl ArtifactCollector for KubernetesArtifactCollector {
    async fn collect(&self, container: &ContainerHandle) -> Result<ArtifactCollection> {
        let dest = self.base_dir.join(format!("artifact-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dest).map_err(|err| Error::ArtifactCollection(err.to_string()))?;

        // `tar -c -C /work .` writes the working tree to stdout as a binary stream;
        // the extracting `tar` ran as `node`, so it can read its own tree. Stream it
        // to a scratch file (the tree can be large) and unpack into the native host
        // destination.
        let command = [
            "tar".to_string(),
            "-c".to_string(),
            "-f".to_string(),
            "-".to_string(),
            "-C".to_string(),
            WORK_DIR.to_string(),
            ".".to_string(),
        ];

        // Retry the streaming collection a few times. `tar -c` is read-only, so
        // re-running it is safe, and the failure it guards against is transient: the
        // collection rides the kube exec WebSocket, and a managed API-server tunnel
        // severing that long-lived stream surfaces as a missing terminating `Status`
        // frame — `tar exit -1` with empty stderr — even though the run finished and
        // its tree is intact. Without this the one blip permanently fails an
        // otherwise-successful run, since the dispatcher never retries a driver Job.
        let archive_path = self
            .base_dir
            .join(format!("artifact-{}.tar", Uuid::new_v4()));
        for attempt in 1..=COLLECT_ATTEMPTS {
            let mut archive = tokio::fs::File::create(&archive_path)
                .await
                .map_err(|err| {
                    Error::ArtifactCollection(format!("creating scratch archive: {err}"))
                })?;
            let result = self
                .runtime
                .exec_stream_stdout(&container.id, &command, &mut archive)
                .await;
            drop(archive);

            // Treat both a non-zero `tar` exit and an exec transport error as
            // retryable; surface the last one if every attempt is exhausted.
            let failure = match result {
                Ok((0, _)) => {
                    let unpack = unpack_archive_file(&archive_path, &dest);
                    let _ = std::fs::remove_file(&archive_path);
                    unpack?;
                    return Ok(ArtifactCollection { repo_path: dest });
                }
                Ok((exit_code, stderr)) => Error::ArtifactCollection(format!(
                    "collecting `{WORK_DIR}` from run pod `{}` failed (tar exit {exit_code}): {}",
                    container.id,
                    stderr.trim()
                )),
                Err(err) => err,
            };
            let _ = std::fs::remove_file(&archive_path);

            if attempt == COLLECT_ATTEMPTS {
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
}

/// Build the `Pod` manifest for a run. Pure given the spec and config, so the
/// manifest shape is unit-tested without a cluster.
fn build_run_pod(name: &str, spec: &ContainerSpec, config: &KubernetesConfig) -> Pod {
    let env = spec
        .secrets
        .iter()
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
        // Untrusted model code runs here; it never needs the API, so withhold a
        // service-account token from the run pod.
        automount_service_account_token: Some(false),
        ..Default::default()
    };

    Pod {
        metadata: ObjectMeta {
            name: Some(name.to_string()),
            labels: Some(labels),
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
/// directory root), for extraction into the pod's `/work`.
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
fn unpack_archive_file(archive: &Path, dest: &Path) -> Result<()> {
    let file = std::fs::File::open(archive)
        .map_err(|err| Error::ArtifactCollection(format!("opening collected archive: {err}")))?;
    tar::Archive::new(file)
        .unpack(dest)
        .map_err(|err| Error::ArtifactCollection(format!("unpacking collected archive: {err}")))
}

/// Map a line read from a streamed exec into our [`Result`].
fn read_line(line: std::io::Result<Option<String>>) -> Result<Option<String>> {
    line.map_err(|err| Error::ContainerRuntime(format!("reading run pod output failed: {err}")))
}
