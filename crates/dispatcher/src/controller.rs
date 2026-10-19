//! The dispatcher control loop: claim → create driver `Job` → renew its lease →
//! watch for deaths and lapsed leases.
//!
//! The loop is deliberately simple and stateless-on-disk. Each tick:
//!
//! 1. **Reconcile** against the live cluster and the backend, in this order:
//!    - list the `Job`s this dispatcher owns (label-selected) and count the
//!      non-terminal ones of each kind as that lane's in-flight total. Listing the
//!      cluster (not trusting an in-memory counter) is what makes a restart safe:
//!      the in-flight count is recomputed from reality, never assumed zero;
//!    - **renew**, in one `POST /jobs/leases`, the claim lease of every run whose
//!      driver `Job` is live (see [`lease_renewals`]);
//!    - for any driver `Job` that **failed terminally** while its backend job is
//!      still live, reap the sandbox it orphaned and report a specific death reason;
//!    - read the backend's jobs in flight with their lease expiries
//!      (`GET /jobs/active`, read *after* the renewal) and report every job past
//!      `dispatched` whose lease has lapsed as **lost** (see [`lapsed`]) through the
//!      service-token `POST /jobs/{id}/lost`.
//!
//!    The dispatcher renews before it judges, and judges nothing on a tick whose
//!    renewal failed: a lease that lapsed while the dispatcher or the backend was
//!    down is renewed for every job that still has a live `Job`, and judged only for
//!    the rest. A lapsed `dispatched` job is not the dispatcher's to judge: the
//!    backend's next claim returns it to the queue at its original position with a
//!    fresh per-job token, which is how a claim whose `Job` creation failed recovers.
//!
//!    When publishing is enabled the publish lane is reconciled the same way, on its
//!    own: **renew**, in one `POST /publish-jobs/leases`, the claim lease of every
//!    publish job whose publisher `Job` is live (see [`publish_lease_renewals`]),
//!    then read `GET /publish-jobs/active` and report every `dispatched` publish job
//!    whose lease has lapsed as **lost** (see [`publish_lapsed`]) through the
//!    service-token `POST /publish-jobs/{id}/lost`. A publish job held `dispatched`
//!    with no active publisher `Job` for the two minutes of its lease is therefore
//!    reported lost, and the backend records it failed. Each lane judges only on a
//!    tick whose own renewal succeeded.
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
//! A publisher reports its own result over its per-job token, so the dispatcher
//! retains no token for a publish job and reports no publisher death through the
//! token path: a publisher that ends without reporting is caught by its lapsed lease
//! alone. Every publisher `Job` also carries an `activeDeadlineSeconds` of 45 minutes
//! (see [`PUBLISH_ACTIVE_DEADLINE_SECONDS`](crate::job::PUBLISH_ACTIVE_DEADLINE_SECONDS)),
//! which ends one that has hung; its `Job` then fails and is reported lost the same
//! way.
//!
//! The leases live in Postgres, so a restarted dispatcher judges each job against
//! the expiry its predecessor last set; it keeps no clock of its own. The only
//! in-memory state is `{job_id → job_token}` for jobs this process dispatched,
//! retained so a death report can present the per-job token, and the sets that keep
//! a lingering failed `Job` from being reported or reaped twice. A restart loses them
//! safely: a death the token path can no longer report is reported lost once the
//! job's lease lapses.

use std::collections::{HashMap, HashSet};

use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use tokio::time::sleep;

use test_cabinet_contracts::job_api::ClaimedJob;
use test_cabinet_contracts::publish_job_api::PublishClaim;

use test_cabinet_contracts::publish_job_api::PublishJobState;

use crate::client::{ActiveJob, ActivePublishJob, BackendClient, JobState};
use crate::config::Config;
use crate::job::{JobKind, build_driver_job, build_publish_job};
use crate::kubernetes::{Cluster, JobPhase, Kube, ManagedJob};

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

/// The backend job ids whose claim leases this tick renews: every run whose driver
/// `Job` exists and has not finished. A publish `Job` belongs to the publish lane's
/// renewal (see [`publish_lease_renewals`]), and a `Job` without a job-id label names
/// nothing to renew. Pure, so it is unit-tested without
/// a cluster.
pub fn lease_renewals(managed: &[ManagedJob]) -> Vec<String> {
    managed
        .iter()
        .filter(|job| job.kind == JobKind::Run && job.phase == JobPhase::Active)
        .filter_map(|job| job.job_id.clone())
        .collect()
}

/// The jobs the dispatcher judges lost as of `now`: each `starting`, `running` or
/// `storing` job whose lease has lapsed. A lease the backend reports none of, or one
/// that does not parse, counts as lapsed, as it does at the backend. A `dispatched`
/// job is never answered: the backend returns a lapsed one to the queue itself. The
/// expiries are compared as instants, never as strings. Pure, so it is unit-tested
/// without a backend.
pub fn lapsed(jobs: &[ActiveJob], now: OffsetDateTime) -> Vec<String> {
    jobs.iter()
        .filter(|job| {
            matches!(
                job.state,
                JobState::Starting | JobState::Running | JobState::Storing
            )
        })
        .filter(|job| lease_lapsed(job.lease_expires_at.as_deref(), now))
        .map(|job| job.run_id.clone())
        .collect()
}

/// The publish job ids whose claim leases this tick renews: every publish job whose
/// publisher `Job` exists and has not finished. A driver `Job` belongs to the run
/// lane's renewal, and a `Job` without a job-id label names nothing to renew. Pure,
/// so it is unit-tested without a cluster.
pub fn publish_lease_renewals(managed: &[ManagedJob]) -> Vec<String> {
    managed
        .iter()
        .filter(|job| job.kind == JobKind::Publish && job.phase == JobPhase::Active)
        .filter_map(|job| job.job_id.clone())
        .collect()
}

/// The publish jobs the dispatcher judges lost as of `now`: each `dispatched` publish
/// job whose lease has lapsed. A lease the backend reports none of, or one that does
/// not parse, counts as lapsed. A `queued` publish job has no publisher to lose. The
/// expiries are compared as instants, never as strings. Pure, so it is unit-tested
/// without a backend.
pub fn publish_lapsed(jobs: &[ActivePublishJob], now: OffsetDateTime) -> Vec<String> {
    jobs.iter()
        .filter(|job| job.state == PublishJobState::Dispatched)
        .filter(|job| lease_lapsed(job.lease_expires_at.as_deref(), now))
        .map(|job| job.id.clone())
        .collect()
}

/// Whether a lease expiry has lapsed as of `now`. An absent or unparseable expiry
/// counts as lapsed, as it does at the backend.
fn lease_lapsed(expiry: Option<&str>, now: OffsetDateTime) -> bool {
    expiry
        .and_then(|expiry| OffsetDateTime::parse(expiry, &Rfc3339).ok())
        .is_none_or(|expiry| expiry < now)
}

/// The running dispatcher: its config, the backend client, the cluster, and the
/// per-job tokens for jobs this process dispatched (for the death-detection report).
pub struct Dispatcher<C = Kube> {
    config: Config,
    backend: BackendClient,
    cluster: C,
    /// `{job_id → job_token}` for jobs this process dispatched. In-memory only; the
    /// backend's `job` table is the source of truth.
    tokens: HashMap<String, String>,
    /// Backend job ids the dispatcher has already reported a death for, so a `Job`
    /// that lingers (until its TTL reaps it) is not reported every tick.
    reported_dead: HashSet<String>,
    /// Backend job ids whose orphaned sandbox pods have already been reaped. Kept
    /// separate from [`reported_dead`](Self::reported_dead) because the two are
    /// reached under different conditions: a job can be un-reportable (no retained
    /// token, already terminal) yet still have a sandbox to clean up.
    reaped: HashSet<String>,
}

impl Dispatcher<Kube> {
    /// Assemble a dispatcher from its resolved config, connecting the Kubernetes
    /// client to the cluster.
    pub async fn connect(config: Config) -> anyhow::Result<Self> {
        let backend = BackendClient::new(&config.backend_url, &config.service_token);
        let kube = Kube::connect(&config.namespace, &config.sandbox_namespace).await?;
        Ok(Self::new(config, backend, kube))
    }
}

impl<C: Cluster> Dispatcher<C> {
    /// Assemble a dispatcher over an existing backend client and cluster. It starts
    /// with no in-memory state at all, exactly as a restarted process does.
    pub fn new(config: Config, backend: BackendClient, cluster: C) -> Self {
        Self {
            config,
            backend,
            cluster,
            tokens: HashMap::new(),
            reported_dead: HashSet::new(),
            reaped: HashSet::new(),
        }
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
    pub(crate) async fn tick(&mut self) -> anyhow::Result<bool> {
        let managed = self.cluster.list_managed().await?;
        let renewed = self.renew_leases(&managed).await;
        self.detect_deaths(&managed).await;
        if renewed {
            self.detect_lost(&managed).await;
        }
        // The publish lane's leases are renewed and judged only while publishing is
        // enabled: with no publisher image the dispatcher never touches the publish
        // queue, and so has no publisher `Job`s to vouch for.
        if self.config.publishing_enabled() && self.renew_publish_leases(&managed).await {
            self.detect_lost_publishes(&managed).await;
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
        self.cluster.create_job(&job).await?;
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
    /// dispatch this retains no token: the publisher reports its own terminal result,
    /// and one that ends without reporting is caught by its lapsed claim lease (see
    /// [`detect_lost_publishes`](Self::detect_lost_publishes)), which needs only the
    /// service token. A claim whose `Job` creation fails is caught the same way.
    async fn dispatch_publish(&mut self, claim: PublishClaim) -> anyhow::Result<()> {
        let job = build_publish_job(&claim, &self.config);
        self.cluster.create_job(&job).await?;
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

            let detail = self.cluster.failure_detail(&job.name).await;
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

    /// Renew the claim lease of every run whose driver `Job` is live, in one call.
    /// Answers whether the leases may be judged this tick: `false` when the renewal
    /// failed, since a lease it should have extended may read as lapsed. With no live
    /// run `Job` there is nothing to renew, and no call is made.
    async fn renew_leases(&self, managed: &[ManagedJob]) -> bool {
        let renewals = lease_renewals(managed);
        if renewals.is_empty() {
            return true;
        }
        match self.backend.renew_leases(&renewals).await {
            Ok(()) => true,
            Err(err) => {
                tracing::warn!(
                    error = %err,
                    jobs = renewals.len(),
                    "renewing the claim leases failed; judging no lease this tick"
                );
                false
            }
        }
    }

    /// Report every job past `dispatched` whose lease has lapsed (see [`lapsed`]),
    /// with what the cluster says about its driver as the detail. Reads the backend's
    /// jobs in flight, so it must run after this tick's renewal. Best-effort: a
    /// report that fails is made again on the next tick, as the lease stays lapsed.
    async fn detect_lost(&mut self, managed: &[ManagedJob]) {
        let jobs = match self.backend.active_jobs().await {
            Ok(jobs) => jobs,
            Err(err) => {
                tracing::warn!(error = %err, "could not read the backend's jobs in flight to judge their leases");
                return;
            }
        };
        for job_id in lapsed(&jobs, OffsetDateTime::now_utc()) {
            let found = managed
                .iter()
                .find(|job| job.job_id.as_deref() == Some(job_id.as_str()));
            let detail = match found {
                // Renewed on this very tick, so its lapse is a clock disagreement
                // between the dispatcher and the backend, not a lost driver.
                Some(job) if job.phase == JobPhase::Active => {
                    tracing::debug!(
                        job_id,
                        "a lease renewed this tick reads as lapsed; leaving it"
                    );
                    continue;
                }
                Some(job) if job.phase == JobPhase::Failed => {
                    self.cluster.failure_detail(&job.name).await
                }
                Some(_) => {
                    // Complete: the driver exited, its report undelivered.
                    "the driver exited without its final status reaching the backend".to_string()
                }
                None => "the driver's Kubernetes Job no longer exists, so the run ended \
                         without reporting (for example, the cluster restarted)"
                    .to_string(),
            };
            tracing::warn!(job_id, detail = %detail, "a driven job's lease lapsed; reporting it lost");
            if let Err(err) = self.backend.report_lost(&job_id, detail).await {
                tracing::warn!(job_id, error = %err, "reporting a lost job to the backend failed");
            }
        }
    }

    /// Renew the claim lease of every publish job whose publisher `Job` is live, in
    /// one call. Answers whether the publish leases may be judged this tick: `false`
    /// when the renewal failed, since a lease it should have extended may read as
    /// lapsed. With no live publisher `Job` there is nothing to renew, and no call is
    /// made.
    async fn renew_publish_leases(&self, managed: &[ManagedJob]) -> bool {
        let renewals = publish_lease_renewals(managed);
        if renewals.is_empty() {
            return true;
        }
        match self.backend.renew_publish_leases(&renewals).await {
            Ok(()) => true,
            Err(err) => {
                tracing::warn!(
                    error = %err,
                    jobs = renewals.len(),
                    "renewing the publish leases failed; judging no publish lease this tick"
                );
                false
            }
        }
    }

    /// Report every `dispatched` publish job whose lease has lapsed (see
    /// [`publish_lapsed`]) lost, with what the cluster says about its publisher as the
    /// detail. Reads the backend's publish jobs in flight, so it must run after this
    /// tick's publish renewal. Best-effort: a report that fails is made again on the
    /// next tick, as the lease stays lapsed.
    async fn detect_lost_publishes(&self, managed: &[ManagedJob]) {
        let jobs = match self.backend.active_publish_jobs().await {
            Ok(jobs) => jobs,
            Err(err) => {
                tracing::warn!(error = %err, "could not read the backend's publish jobs in flight to judge their leases");
                return;
            }
        };
        for job_id in publish_lapsed(&jobs, OffsetDateTime::now_utc()) {
            let found = managed.iter().find(|job| {
                job.kind == JobKind::Publish && job.job_id.as_deref() == Some(job_id.as_str())
            });
            let detail = match found {
                // Renewed on this very tick, so its lapse is a clock disagreement
                // between the dispatcher and the backend, not a lost publisher.
                Some(job) if job.phase == JobPhase::Active => {
                    tracing::debug!(
                        job_id,
                        "a publish lease renewed this tick reads as lapsed; leaving it"
                    );
                    continue;
                }
                Some(job) if job.phase == JobPhase::Failed => {
                    self.cluster.failure_detail(&job.name).await
                }
                Some(_) => {
                    // Complete: the publisher exited, its result undelivered.
                    "the publisher exited without its result reaching the backend".to_string()
                }
                None => "the publisher's Kubernetes Job no longer exists, so the publish \
                         ended without reporting a result"
                    .to_string(),
            };
            tracing::warn!(job_id, detail = %detail, "a publish job's lease lapsed; reporting it lost");
            if let Err(err) = self.backend.report_publish_lost(&job_id, detail).await {
                tracing::warn!(job_id, error = %err, "reporting a lost publish job to the backend failed");
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
        match self.cluster.delete_sandbox_pods(job_id).await {
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

#[cfg(test)]
#[path = "controller.leases.test.rs"]
mod lease_tests;

#[cfg(test)]
#[path = "controller.publish.test.rs"]
mod publish_tests;
