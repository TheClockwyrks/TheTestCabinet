//! The dispatcher control loop: claim → create driver `Job` → watch for deaths.
//!
//! The loop is deliberately simple and stateless-on-disk. Each tick:
//!
//! 1. **Reconcile** against the live cluster: list the driver `Job`s this
//!    dispatcher owns (label-selected), count the non-terminal ones as the
//!    in-flight total, and — for any that **failed terminally** while their backend
//!    job is still live — report a specific death reason. Listing the cluster (not
//!    trusting an in-memory counter) is what makes a restart safe: the in-flight
//!    count is recomputed from reality, never assumed zero.
//! 2. **Admit**: while under the in-flight cap, claim the oldest queued job and
//!    create one driver `Job` for it. An empty queue or a full cap backs off for
//!    the poll interval.
//!
//! The only in-memory state is `{job_id → job_token}` for jobs this process
//! dispatched, retained so it can present the per-job token when reporting a death.
//! A token lost across a restart just means that job relies on its own driver
//! reporting (or a later reconcile once the `Job` is gone) — never a correctness
//! problem, only a missed safety-net for an already-rare double failure.

use std::collections::HashMap;

use tokio::time::sleep;

use test_cabinet_core::ClaimedJob;

use crate::client::BackendClient;
use crate::config::Config;
use crate::job::build_driver_job;
use crate::kubernetes::{JobPhase, Kube, ManagedJob};

/// The running dispatcher: its config, the two clients, and the per-job tokens for
/// jobs this process dispatched (for the death-detection report).
pub struct Dispatcher {
    config: Config,
    backend: BackendClient,
    kube: Kube,
    /// `{job_id → job_token}` for jobs this process dispatched. In-memory only; the
    /// backend's `job` table is the source of truth.
    tokens: HashMap<String, String>,
    /// Backend job ids the dispatcher has already reported a death for, so a `Job`
    /// that lingers (until its TTL reaps it) is not reported every tick.
    reported_dead: std::collections::HashSet<String>,
}

impl Dispatcher {
    /// Assemble a dispatcher from its resolved config, connecting the Kubernetes
    /// client to the cluster.
    pub async fn connect(config: Config) -> anyhow::Result<Self> {
        let backend = BackendClient::new(&config.backend_url, &config.service_token);
        let kube = Kube::connect(&config.namespace).await?;
        Ok(Self {
            config,
            backend,
            kube,
            tokens: HashMap::new(),
            reported_dead: std::collections::HashSet::new(),
        })
    }

    /// Run the control loop forever. Each iteration reconciles the cluster, then
    /// admits as many queued jobs as the in-flight cap allows; transient errors are
    /// logged and the loop backs off rather than exiting (the dispatcher is a
    /// long-lived controller).
    pub async fn run(mut self) -> anyhow::Result<()> {
        loop {
            match self.tick().await {
                Ok(admitted) if admitted => {
                    // Admitted at least one job; loop straight back to keep draining
                    // the queue while there is capacity, without an idle backoff.
                    continue;
                }
                Ok(_) => {}
                Err(err) => {
                    tracing::warn!(error = %err, "dispatcher tick failed; backing off");
                }
            }
            sleep(self.config.poll_interval).await;
        }
    }

    /// One iteration: reconcile, then try to admit a single job. Returns whether a
    /// job was admitted, so the caller can keep draining the queue without backing
    /// off while capacity remains.
    async fn tick(&mut self) -> anyhow::Result<bool> {
        let managed = self.kube.list_managed().await?;
        self.detect_deaths(&managed).await;

        let in_flight = managed
            .iter()
            .filter(|m| m.phase == JobPhase::Active)
            .count();
        if in_flight >= self.config.max_inflight {
            tracing::debug!(
                in_flight,
                cap = self.config.max_inflight,
                "at in-flight cap"
            );
            return Ok(false);
        }

        let Some(claim) = self.backend.claim_next().await? else {
            return Ok(false);
        };
        self.dispatch(claim).await?;
        Ok(true)
    }

    /// Create one driver `Job` for a claimed run and retain its per-job token for
    /// death detection.
    async fn dispatch(&mut self, claim: ClaimedJob) -> anyhow::Result<()> {
        let job = build_driver_job(&claim, &self.config)?;
        self.kube.create_job(&job).await?;
        tracing::info!(
            job_id = %claim.job_id,
            test_case = %claim.request.test_case,
            variant = %claim.request.variant,
            harness = claim.request.harness.as_str(),
            model = %claim.request.model,
            "dispatched a driver Job",
        );
        self.tokens.insert(claim.job_id, claim.job_token);
        Ok(())
    }

    /// For each owned `Job` that failed terminally, report a specific death reason
    /// to the backend — but only when this process has the job's token and the
    /// backend job has not already reached a terminal state. A driver that died
    /// before reporting leaves its job hanging in `dispatched`/`running`; this is
    /// the safety net that ends it with a real diagnostic.
    async fn detect_deaths(&mut self, managed: &[ManagedJob]) {
        for job in managed {
            if job.phase != JobPhase::Failed {
                continue;
            }
            let Some(job_id) = job.job_id.as_deref() else {
                continue;
            };
            if self.reported_dead.contains(job_id) {
                continue;
            }
            // Only this process's dispatched jobs carry a retained token; a job from
            // a previous process relies on its own driver reporting (or the `Job`
            // being reaped, after which it no longer appears here).
            let Some(token) = self.tokens.get(job_id).cloned() else {
                continue;
            };
            match self.backend.job_state(job_id).await {
                Ok(Some(state)) if state.is_terminal() => {
                    // The driver already reported (or it was canceled); the cluster
                    // Job failing afterward is expected. Nothing to do.
                    self.reported_dead.insert(job_id.to_string());
                    continue;
                }
                Ok(None) => {
                    // The backend no longer knows this job; nothing to report.
                    self.reported_dead.insert(job_id.to_string());
                    continue;
                }
                Ok(Some(_)) => {}
                Err(err) => {
                    tracing::warn!(job_id, error = %err, "could not read job state for death detection");
                    continue;
                }
            }

            let detail = self.kube.failure_detail(&job.name).await;
            tracing::warn!(job_id, detail = %detail, "driver Job failed before reporting; reporting death");
            match self.backend.report_failed(job_id, &token, detail).await {
                Ok(()) => {
                    self.reported_dead.insert(job_id.to_string());
                    self.tokens.remove(job_id);
                }
                Err(err) => {
                    tracing::warn!(job_id, error = %err, "reporting driver-pod death failed; will retry");
                }
            }
        }
    }
}
