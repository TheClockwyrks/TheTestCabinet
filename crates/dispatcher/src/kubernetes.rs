//! The dispatcher's Kubernetes client: create, list, and inspect driver `Job`s.
//!
//! This is the *only* component in the system that talks to the Kubernetes API for
//! `Job` creation — the backend stays k8s-agnostic. It wraps a [`kube::Client`]
//! with the small set of operations the control loop needs:
//!
//! - [`create_job`](Kube::create_job) — submit one driver `Job` per claimed run.
//! - [`list_managed`](Kube::list_managed) — list exactly the `Job`s this dispatcher
//!   owns (label-selected), to count in-flight work and to reconcile on restart.
//! - [`failure_detail`](Kube::failure_detail) — derive a **specific** reason a
//!   terminally-failed driver pod died (image-pull failure, OOMKill, a non-zero
//!   exit), for the death-detection report, so a hung job ends with a real
//!   diagnostic rather than a bare "run failed".
//! - [`delete_sandbox_pods`](Kube::delete_sandbox_pods) — reap the *sandbox* pods a
//!   dead driver left behind, which nothing else can (see below).
//!
//! It deliberately holds no durable state: the in-flight set is recomputed from the
//! live cluster, and the backend's `job` table is the source of truth.
//!
//! ## Why the dispatcher reaps sandboxes
//!
//! The driver creates the sandbox pod and normally deletes it itself — at the end of
//! a run, and on cancellation. Both paths are *in-process*, so a driver that dies by
//! `SIGKILL` (OOM kill, eviction, node drain, spot preemption) executes neither. The
//! sandbox it left behind has no `ownerReference` — it cannot have a useful one,
//! since its only candidate parent is the driver `Job`, which `ttlSecondsAfterFinished`
//! reaps a few minutes after the run ends and which would then cascade-delete healthy
//! sandboxes mid-run — so nothing garbage-collects it and its `sleep infinity`
//! keep-alive runs forever, holding its requests against the node.
//!
//! The dispatcher is the only component positioned to clean this up: it is long-lived,
//! it already watches every driver `Job` it created, and it learns the moment one
//! fails terminally. So the death-detection path reaps the sandbox by the job-id label
//! the driver stamped on it. (The sandbox pod carries a per-run `activeDeadlineSeconds`
//! as a further backstop for the case where the dispatcher itself is down.)

use k8s_openapi::api::batch::v1::Job;
use k8s_openapi::api::core::v1::Pod;
use kube::api::{DeleteParams, ListParams, LogParams, PostParams};
use kube::{Api, Client};

use crate::job::{JOB_ID_LABEL, SANDBOX_MANAGED_BY, managed_selector};

/// The classification of a driver `Job`'s lifecycle, derived from its status
/// conditions. A `Job` with `backoffLimit: 0` settles into exactly one of these.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobPhase {
    /// The driver `Job` has neither completed nor failed yet.
    Active,
    /// The driver `Job` completed (the driver exited `0` — which it does even when
    /// it *reported* a failed run, so this is not itself a run outcome).
    Complete,
    /// The driver `Job` failed terminally (the pod died before the driver could
    /// exit `0` — e.g. it was unschedulable, its image would not pull, or it was
    /// OOMKilled). This is the infra-failure case the dispatcher must report.
    Failed,
}

/// A driver `Job` the dispatcher owns, paired with its derived phase and the
/// backend job id it carries (from its [`JOB_ID_LABEL`]).
#[derive(Debug, Clone)]
pub struct ManagedJob {
    /// The backend job id this `Job` runs (`None` if the label is somehow absent).
    pub job_id: Option<String>,
    /// The `Job`'s metadata name.
    pub name: String,
    /// Where the `Job` is in its lifecycle.
    pub phase: JobPhase,
}

/// A thin wrapper over the `kube` client scoped to the dispatcher's namespace.
#[derive(Clone)]
pub struct Kube {
    client: Client,
    namespace: String,
    /// The namespace the *driver* creates sandbox pods in (`TCAB_K8S_NAMESPACE`).
    /// Usually identical to [`namespace`](Self::namespace) — a deployment that
    /// separates them must grant the dispatcher's ServiceAccount the pod
    /// `list`/`delete` verbs in this namespace too, or sandbox reaping silently
    /// fails there (it is logged, never fatal).
    sandbox_namespace: String,
}

impl std::fmt::Debug for Kube {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // `kube::Client` is not `Debug`; summarize by the namespaces.
        f.debug_struct("Kube")
            .field("namespace", &self.namespace)
            .field("sandbox_namespace", &self.sandbox_namespace)
            .finish_non_exhaustive()
    }
}

impl Kube {
    /// Connect to the cluster the dispatcher is running in (the in-cluster service
    /// account in a deployment, or the ambient kubeconfig locally), scoped to
    /// `namespace` for `Job`s and `sandbox_namespace` for the driver's sandbox pods.
    pub async fn connect(
        namespace: impl Into<String>,
        sandbox_namespace: impl Into<String>,
    ) -> anyhow::Result<Self> {
        let client = Client::try_default().await?;
        Ok(Self::with_client(client, namespace, sandbox_namespace))
    }

    /// Build a wrapper around an existing client (used by tests).
    pub fn with_client(
        client: Client,
        namespace: impl Into<String>,
        sandbox_namespace: impl Into<String>,
    ) -> Self {
        Self {
            client,
            namespace: namespace.into(),
            sandbox_namespace: sandbox_namespace.into(),
        }
    }

    /// The `Job`s API in the dispatcher's namespace.
    fn jobs(&self) -> Api<Job> {
        Api::namespaced(self.client.clone(), &self.namespace)
    }

    /// The pods API in the dispatcher's namespace — driver pods, for reading the
    /// status and logs of one that died.
    fn pods(&self) -> Api<Pod> {
        Api::namespaced(self.client.clone(), &self.namespace)
    }

    /// The pods API in the namespace the driver creates *sandbox* pods in.
    fn sandbox_pods(&self) -> Api<Pod> {
        Api::namespaced(self.client.clone(), &self.sandbox_namespace)
    }

    /// Create one driver `Job`.
    pub async fn create_job(&self, job: &Job) -> anyhow::Result<()> {
        self.jobs().create(&PostParams::default(), job).await?;
        Ok(())
    }

    /// List exactly the driver `Job`s this dispatcher owns, each classified into a
    /// [`JobPhase`]. The control loop counts the non-terminal ones for queue
    /// admission and reports any newly-failed ones whose backend job is still live.
    pub async fn list_managed(&self) -> anyhow::Result<Vec<ManagedJob>> {
        let params = ListParams::default().labels(&managed_selector());
        let list = self.jobs().list(&params).await?;
        Ok(list.items.iter().map(managed_job).collect())
    }

    /// Derive a **specific** human-readable reason a driver `Job`'s pod died, for
    /// the death-detection report. Prefers, in order: the failed container's
    /// terminated reason and exit code (e.g. `OOMKilled`, `Error (exit 137)`); its
    /// waiting reason (e.g. `ImagePullBackOff` — "couldn't pull container image");
    /// a short tail of its logs; and finally a generic-but-honest fallback naming
    /// the `Job`. Never returns a bare "run failed".
    pub async fn failure_detail(&self, job_name: &str) -> String {
        let Some(pod) = self.newest_job_pod(job_name).await else {
            return format!("driver Job `{job_name}` failed before its pod started");
        };
        let pod_name = pod.metadata.name.clone().unwrap_or_default();
        if let Some(reason) = container_failure_reason(&pod) {
            return format!("driver pod failed: {reason}");
        }
        if !pod_name.is_empty()
            && let Some(tail) = self.pod_log_tail(&pod_name).await
        {
            return format!("driver pod `{pod_name}` failed; last log lines:\n{tail}");
        }
        format!("driver Job `{job_name}` failed without a diagnostic pod status")
    }

    /// Delete every **sandbox** pod belonging to `job_id`, returning how many were
    /// removed. This is the cleanup a `SIGKILL`ed driver never got to run.
    ///
    /// The selector pins **both** the job id and the driver's `managed-by` value.
    /// The job-id label alone is not enough: the driver `Job` and its own pod carry
    /// the same `tcab.dev/job-id`, so a single-label selector would delete the
    /// driver pod out from under the very failure the dispatcher is diagnosing —
    /// destroying the logs [`failure_detail`](Self::failure_detail) reads.
    ///
    /// Deleted with a zero grace period: the run is already over and the sandbox
    /// holds nothing worth draining. A pod that is already gone is success, so this
    /// is safe to call more than once for the same job. Listing-then-deleting
    /// (rather than `delete_collection`) keeps to the `list`/`delete` verbs the
    /// dispatcher's Role grants — no extra RBAC — and mirrors what the driver's own
    /// teardown does.
    pub async fn delete_sandbox_pods(&self, job_id: &str) -> anyhow::Result<usize> {
        let listed = self
            .sandbox_pods()
            .list(&ListParams::default().labels(&sandbox_selector(job_id)))
            .await?;
        let params = DeleteParams::default().grace_period(0);
        let mut deleted = 0;
        for pod in listed {
            let Some(name) = pod.metadata.name else {
                continue;
            };
            match self.sandbox_pods().delete(&name, &params).await {
                Ok(_) => deleted += 1,
                // Already gone — the driver may have torn it down itself, or a
                // previous pass removed it. Either way there is nothing to do.
                Err(kube::Error::Api(err)) if err.code == 404 => {}
                Err(err) => return Err(err.into()),
            }
        }
        Ok(deleted)
    }

    /// The newest pod created by a `Job` (selected via the controller-set
    /// `job-name` label), for reading its failure status. `None` when none exist.
    async fn newest_job_pod(&self, job_name: &str) -> Option<Pod> {
        let params = ListParams::default().labels(&format!("job-name={job_name}"));
        let pods = self.pods().list(&params).await.ok()?;
        pods.items
            .into_iter()
            .max_by(|a, b| creation_key(a).cmp(&creation_key(b)))
    }

    /// A short, log-friendly tail of a pod's logs, or `None` when none can be read
    /// (the pod may already be gone, or never produced output).
    async fn pod_log_tail(&self, pod_name: &str) -> Option<String> {
        let params = LogParams {
            tail_lines: Some(20),
            ..Default::default()
        };
        match self.pods().logs(pod_name, &params).await {
            Ok(logs) if !logs.trim().is_empty() => Some(logs.trim().to_string()),
            _ => None,
        }
    }
}

/// The label selector matching exactly the **sandbox** pods belonging to `job_id`.
///
/// Both labels are load-bearing. The driver `Job` and its pod carry the same
/// `tcab.dev/job-id` as the sandbox they belong to, so selecting on the job id alone
/// would also match the driver's own pod — and the caller deletes what this matches.
/// Pinning the driver's `managed-by` value narrows it to pods the driver created.
fn sandbox_selector(job_id: &str) -> String {
    format!("{JOB_ID_LABEL}={job_id},app.kubernetes.io/managed-by={SANDBOX_MANAGED_BY}")
}

/// Classify a `Job` into a [`ManagedJob`] from its conditions and labels. A
/// `Job` with `backoffLimit: 0` reports a `Complete` or `Failed` condition with
/// `status: "True"` once terminal; anything else is still active.
fn managed_job(job: &Job) -> ManagedJob {
    let name = job.metadata.name.clone().unwrap_or_default();
    let job_id = job
        .metadata
        .labels
        .as_ref()
        .and_then(|labels| labels.get(JOB_ID_LABEL))
        .cloned();
    ManagedJob {
        job_id,
        name,
        phase: job_phase(job),
    }
}

/// Derive a `Job`'s phase from its status conditions.
fn job_phase(job: &Job) -> JobPhase {
    let conditions = job
        .status
        .as_ref()
        .and_then(|status| status.conditions.as_ref());
    let Some(conditions) = conditions else {
        return JobPhase::Active;
    };
    let is_true = |type_: &str| {
        conditions
            .iter()
            .any(|c| c.type_ == type_ && c.status == "True")
    };
    if is_true("Failed") {
        JobPhase::Failed
    } else if is_true("Complete") {
        JobPhase::Complete
    } else {
        JobPhase::Active
    }
}

/// The most specific failure reason readable from a pod's container statuses: a
/// terminated state's reason + exit code, or a waiting state's reason. `None` when
/// no container status carries one (e.g. the pod never scheduled).
fn container_failure_reason(pod: &Pod) -> Option<String> {
    let statuses = pod.status.as_ref()?.container_statuses.as_ref()?;
    for status in statuses {
        let state = status.state.as_ref()?;
        if let Some(terminated) = state.terminated.as_ref() {
            // `OOMKilled` carries no exit code worth surfacing on its own; a plain
            // non-zero exit does. Prefer the reason, fall back to the exit code.
            let reason = terminated
                .reason
                .clone()
                .unwrap_or_else(|| "Error".to_string());
            return Some(format!("{reason} (exit {})", terminated.exit_code));
        }
        if let Some(waiting) = state.waiting.as_ref()
            && let Some(reason) = &waiting.reason
        {
            let suffix = waiting
                .message
                .as_deref()
                .map(|m| format!(": {m}"))
                .unwrap_or_default();
            return Some(format!("{reason}{suffix}"));
        }
    }
    None
}

/// A sortable creation key for a pod (its creation timestamp's seconds, or `0`),
/// so the newest pod of a `Job` is picked deterministically.
fn creation_key(pod: &Pod) -> i64 {
    pod.metadata
        .creation_timestamp
        .as_ref()
        .map(|t| t.0.as_second())
        .unwrap_or(0)
}

#[cfg(test)]
#[path = "kubernetes.test.rs"]
mod tests;
