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
//!
//! It deliberately holds no durable state: the in-flight set is recomputed from the
//! live cluster, and the backend's `job` table is the source of truth.

use k8s_openapi::api::batch::v1::Job;
use k8s_openapi::api::core::v1::Pod;
use kube::api::{ListParams, LogParams, PostParams};
use kube::{Api, Client};

use crate::job::{JOB_ID_LABEL, managed_selector};

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
}

impl std::fmt::Debug for Kube {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // `kube::Client` is not `Debug`; summarize by the namespace.
        f.debug_struct("Kube")
            .field("namespace", &self.namespace)
            .finish_non_exhaustive()
    }
}

impl Kube {
    /// Connect to the cluster the dispatcher is running in (the in-cluster service
    /// account in a deployment, or the ambient kubeconfig locally), scoped to
    /// `namespace`.
    pub async fn connect(namespace: impl Into<String>) -> anyhow::Result<Self> {
        let client = Client::try_default().await?;
        Ok(Self {
            client,
            namespace: namespace.into(),
        })
    }

    /// Build a wrapper around an existing client (used by tests).
    pub fn with_client(client: Client, namespace: impl Into<String>) -> Self {
        Self {
            client,
            namespace: namespace.into(),
        }
    }

    /// The `Job`s API in the dispatcher's namespace.
    fn jobs(&self) -> Api<Job> {
        Api::namespaced(self.client.clone(), &self.namespace)
    }

    /// The pods API in the dispatcher's namespace.
    fn pods(&self) -> Api<Pod> {
        Api::namespaced(self.client.clone(), &self.namespace)
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
