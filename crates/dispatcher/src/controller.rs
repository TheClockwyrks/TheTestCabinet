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
//! 2. **Admit** through two independent lanes (see [`admission`]). The **run**
//!    lane claims the oldest queued run job and creates one driver `Job` for it
//!    while fewer than `max_inflight` driver `Job`s are active. The **publish** lane
//!    — open only when publishing is enabled — claims the oldest queued publish job
//!    and creates one `tcab-publisher` `Job` for it while fewer than
//!    `max_publish_inflight` publish `Job`s are active. A `Job` counts against its
//!    own lane's cap only (by its [`JobKind`]), and every tick tries both lanes, so
//!    a long run queue or a full run lane never holds a publish back, nor the
//!    reverse. A tick admits at most one `Job` per lane; one that admits nothing
//!    backs off for the poll interval.
//!
//! Publish `Job`s carry no bespoke death detection in this first cut: a publisher
//! that dies before reporting either surfaces as a stuck `dispatched` publish job or
//! is reaped by its TTL — the run-queue death-detection path (which needs the
//! driver's per-job-token semantics) is not duplicated for the publish path.
//!
//! The reconcile also finds **lost** jobs (see [`crate::lost`]): jobs the backend
//! still believes a driver is executing, with no live driver `Job` for a grace
//! period. Each is reported through the service-token `POST /jobs/{id}/lost`, so a
//! driver that died with no one to report it — a whole-machine restart, or a `Job`
//! that failed while no dispatcher held its token — never leaves its job in flight.
//!
//! The in-memory state is `{job_id → job_token}` for jobs this process dispatched,
//! retained so a death report can present the per-job token, and the lost tracker's
//! clock. A restart loses both safely: a death the token path can no longer report is
//! reported lost once its grace has run again.

use std::collections::HashMap;

use tokio::time::sleep;

use test_cabinet_core::{ClaimedJob, PublishClaim};

use crate::client::BackendClient;
use crate::config::Config;
use crate::job::{JobKind, build_driver_job, build_publish_job};
use crate::kubernetes::{JobPhase, Kube, ManagedJob};
use crate::lost::{LOST_GRACE, LostTracker};

/// Which admission lanes may claim on one tick.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Admission {
    /// The run lane has room: claim a queued run and create its driver `Job`.
    pub run: bool,
    /// The publish lane is open and has room: claim a queued publish and create its
    /// publisher `Job`.
    pub publish: bool,
}

/// Decide which lanes may claim, from the `Job`s the dispatcher owns. Pure, so the
/// decision is unit-tested without a cluster or a backend.
///
/// Each lane counts only its own kind's `Active` `Job`s against its own cap, and
/// neither lane's answer reads the other's count or either queue's length. That is
/// the whole guarantee that a publish does not wait behind runs: with the run lane
/// at `max_inflight` the publish lane still answers from the publish `Job`s alone.
/// The publish lane is closed outright when no publisher image is configured.
pub fn admission(
    managed: &[ManagedJob],
    max_inflight: usize,
    max_publish_inflight: usize,
    publishing_enabled: bool,
) -> Admission {
    let active = |kind: JobKind| {
        managed
            .iter()
            .filter(|job| job.phase == JobPhase::Active && job.kind == kind)
            .count()
    };
    Admission {
        run: active(JobKind::Run) < max_inflight,
        publish: publishing_enabled && active(JobKind::Publish) < max_publish_inflight,
    }
}

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
    /// Backend job ids whose orphaned sandbox pods have already been reaped. Kept
    /// separate from [`reported_dead`](Self::reported_dead) because the two are
    /// reached under different conditions: a job can be un-reportable (no retained
    /// token, already terminal) yet still have a sandbox to clean up.
    reaped: std::collections::HashSet<String>,
    /// Since when each driven backend job has had no live driver `Job`.
    lost: LostTracker,
}

impl Dispatcher {
    /// Assemble a dispatcher from its resolved config, connecting the Kubernetes
    /// client to the cluster.
    pub async fn connect(config: Config) -> anyhow::Result<Self> {
        let backend = BackendClient::new(&config.backend_url, &config.service_token);
        let kube = Kube::connect(&config.namespace, &config.sandbox_namespace).await?;
        Ok(Self {
            config,
            backend,
            kube,
            tokens: HashMap::new(),
            reported_dead: std::collections::HashSet::new(),
            reaped: std::collections::HashSet::new(),
            lost: LostTracker::default(),
        })
    }

    /// Run the control loop forever. Each iteration reconciles the cluster, then
    /// admits queued jobs as each lane's in-flight cap allows; transient errors are
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
                    tracing::warn!(
                        error = %err,
                        poll_interval_secs = self.config.poll_interval.as_secs_f64(),
                        "dispatcher tick failed"
                    );
                }
            }
            sleep(self.config.poll_interval).await;
        }
    }

    /// One iteration: reconcile, then try to admit one job through each lane that
    /// has room. Returns whether any job was admitted, so the caller can keep
    /// draining the queues without backing off while capacity remains.
    async fn tick(&mut self) -> anyhow::Result<bool> {
        // Read before the cluster, so a job claimed in between is not yet driven here
        // rather than driven with no `Job`.
        let driven = match self.backend.active_jobs().await {
            Ok(jobs) => Some(
                jobs.into_iter()
                    .filter(|job| job.state.is_driven())
                    .map(|job| job.run_id)
                    .collect::<Vec<_>>(),
            ),
            Err(err) => {
                tracing::warn!(error = %err, "could not read the backend's jobs in flight for lost-driver detection");
                None
            }
        };
        let managed = self.kube.list_managed().await?;
        self.detect_deaths(&managed).await;
        if let Some(driven) = driven {
            self.detect_lost(&driven, &managed).await;
        }

        let lanes = admission(
            &managed,
            self.config.max_inflight,
            self.config.max_publish_inflight,
            self.config.publishing_enabled(),
        );
        if !lanes.run {
            tracing::debug!(cap = self.config.max_inflight, "run lane at its cap");
        }

        // The lanes are tried independently: one lane's empty queue, full cap or
        // failure never decides whether the other is tried. A lane that fails is
        // logged here rather than propagated, so a backend that cannot serve one
        // queue does not stop this tick from admitting the other's work (nor send the
        // loop into its backoff when that work was admitted).
        let mut admitted = false;
        if lanes.publish {
            admitted |= lane_admitted("publish", self.admit_publish().await);
        }
        if lanes.run {
            admitted |= lane_admitted("run", self.admit_run().await);
        }
        Ok(admitted)
    }

    /// The run lane: claim the oldest queued run, if any, and dispatch it. Returns
    /// whether one was admitted.
    async fn admit_run(&mut self) -> anyhow::Result<bool> {
        let Some(claim) = self.backend.claim_next().await? else {
            return Ok(false);
        };
        self.dispatch(claim).await?;
        Ok(true)
    }

    /// The publish lane: claim the oldest queued publish, if any, and dispatch it.
    /// Returns whether one was admitted. Only called when publishing is enabled (a
    /// publisher image is configured) — otherwise the dispatcher never touches the
    /// publish queue at all.
    async fn admit_publish(&mut self) -> anyhow::Result<bool> {
        let Some(claim) = self.backend.claim_next_publish().await? else {
            return Ok(false);
        };
        self.dispatch_publish(claim).await?;
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

    /// Create one `tcab-publisher` `Job` for a claimed publish job. Unlike a driver
    /// dispatch this retains no token: the publish path has no dispatcher-side death
    /// detection (the publisher reports its own terminal result, and a publisher that
    /// dies surfaces as a stuck `dispatched` publish job or is reaped by its TTL).
    async fn dispatch_publish(&mut self, claim: PublishClaim) -> anyhow::Result<()> {
        let job = build_publish_job(&claim, &self.config);
        self.kube.create_job(&job).await?;
        tracing::info!(
            job_id = %claim.job_id,
            run_id = %claim.run_id,
            "dispatched a publisher Job",
        );
        Ok(())
    }

    /// For each owned `Job` that failed terminally: reap the sandbox pods its driver
    /// left behind, then report a specific death reason to the backend — the latter
    /// only when this process has the job's token and the backend job has not already
    /// reached a terminal state. A driver that died before reporting leaves its job
    /// hanging in `dispatched`/`running`; this is the safety net that ends it with a
    /// real diagnostic.
    ///
    /// The two halves are deliberately **independent**. Reporting is best-effort by
    /// nature — it needs a token this process may no longer hold, and a job the
    /// backend may already consider terminal — whereas an orphaned sandbox must be
    /// removed in *every* one of those cases, or it runs forever. So the reap runs
    /// first, gated only on the `Job` having failed, and none of the reporting
    /// preconditions can skip past it.
    async fn detect_deaths(&mut self, managed: &[ManagedJob]) {
        for job in managed {
            if job.phase != JobPhase::Failed {
                continue;
            }
            let Some(job_id) = job.job_id.as_deref() else {
                continue;
            };
            self.reap_sandbox(job_id).await;
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
            tracing::warn!(job_id, detail = %detail, "driver Job failed before reporting its own outcome");
            match self.backend.report_failed(job_id, &token, detail).await {
                Ok(()) => {
                    self.reported_dead.insert(job_id.to_string());
                    self.tokens.remove(job_id);
                }
                Err(err) => {
                    tracing::warn!(job_id, error = %err, "reporting the driver pod's death to the backend failed");
                }
            }
        }
    }

    /// Report every driven job that has had no live driver `Job` for [`LOST_GRACE`]
    /// (see [`crate::lost`]), with what the cluster says about its driver as the
    /// detail. Best-effort: a report that fails is made again on the next tick.
    async fn detect_lost(&mut self, driven: &[String], managed: &[ManagedJob]) {
        let live: std::collections::HashSet<String> = managed
            .iter()
            .filter(|job| job.phase == JobPhase::Active)
            .filter_map(|job| job.job_id.clone())
            .collect();
        let lost = self
            .lost
            .observe(driven, &live, std::time::Instant::now(), LOST_GRACE);
        for job_id in lost {
            let found = managed
                .iter()
                .find(|job| job.job_id.as_deref() == Some(job_id.as_str()));
            let detail = match found {
                Some(job) if job.phase == JobPhase::Failed => {
                    self.kube.failure_detail(&job.name).await
                }
                Some(_) => {
                    "the driver exited without its final status reaching the backend".to_string()
                }
                None => "the driver's Kubernetes Job no longer exists, so the run ended \
                         without reporting (for example, the cluster restarted)"
                    .to_string(),
            };
            tracing::warn!(job_id, detail = %detail, "a driven job has no live driver; reporting it lost");
            if let Err(err) = self.backend.report_lost(&job_id, detail).await {
                tracing::warn!(job_id, error = %err, "reporting a lost job to the backend failed");
            }
        }
    }

    /// Delete the sandbox pods left behind by a driver that died before its own
    /// teardown could run, at most once per job id.
    ///
    /// A failed `Job` lingers until its TTL reaps it, so it reappears in
    /// `detect_deaths` on every tick for minutes; [`reaped`](Self::reaped) keeps that
    /// from re-listing pods each time. A *failed* reap is deliberately not recorded,
    /// so a transient API error is retried on the next tick — the pod would otherwise
    /// leak permanently, which is the whole failure this guards against.
    ///
    /// Best-effort: an error is logged, never fatal. The sandbox pod's own
    /// `activeDeadlineSeconds` is the backstop if this never succeeds.
    async fn reap_sandbox(&mut self, job_id: &str) {
        if self.reaped.contains(job_id) {
            return;
        }
        match self.kube.delete_sandbox_pods(job_id).await {
            Ok(count) => {
                self.reaped.insert(job_id.to_string());
                if count > 0 {
                    tracing::warn!(
                        job_id,
                        count,
                        "driver died before tearing down its sandbox; reaped the orphaned pod(s)"
                    );
                }
            }
            Err(err) => {
                tracing::warn!(job_id, error = %err, "reaping the dead driver's sandbox pods failed");
            }
        }
    }
}

/// Whether a lane admitted a job this tick, logging the lane's failure when it had
/// one. A failed lane admitted nothing.
fn lane_admitted(lane: &'static str, result: anyhow::Result<bool>) -> bool {
    match result {
        Ok(admitted) => admitted,
        Err(err) => {
            tracing::warn!(lane, error = %err, "dispatcher lane failed to admit a job");
            false
        }
    }
}

#[cfg(test)]
#[path = "controller.test.rs"]
mod tests;
