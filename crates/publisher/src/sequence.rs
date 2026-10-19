//! The publisher's step sequence and how it stops on `SIGTERM`.
//!
//! A publish runs the steps `components/backend/results.md` ("Publish") gives
//! the publisher, in order: the publication preflight, the download, the Pages
//! deploy and the repository publish, then the result report. [`run`] drives them
//! through a [`Steps`] implementation ([`JobSteps`] in the binary, a fake in the
//! tests) and turns their outcome into the terminal [`PublishResult`].
//!
//! On `SIGTERM` ("A publisher that stops") the publisher starts no further step.
//! The step it is on keeps running while it can still end within the pod's
//! termination grace period, less a reserve kept for the report
//! ([`Grace::step_budget`]); a step that has not ended by then is abandoned,
//! which leaves it repeatable, since every step is (see "Repeating a step"). The
//! publisher then reports the publish failed with the reason that it was
//! interrupted, naming the step, within what is left of the grace period, and
//! exits non-zero. The failure is retried like any other.

use std::fmt;
use std::future::Future;
use std::path::PathBuf;
use std::time::Duration;

use test_cabinet_contracts::publish_job_api::{PublishResult, PublishState};
use tokio::sync::watch;
use tokio::time::Instant;

use crate::client::PublishJobClient;
use crate::config::Config;
use crate::download::download_run_tree;
use crate::publish::{PreparedRelease, ReleasedLinks};
use crate::release::SystemCommandRunner;
use crate::retry::Backoff;

/// The start of the failure detail a publisher interrupted by `SIGTERM`
/// reports; the step it was on (or would have started) follows.
pub const INTERRUPTED: &str = "publisher interrupted by SIGTERM";

/// The longest part of the grace period kept for the result report after an
/// interrupted step (see [`Grace::new`]).
pub const REPORT_RESERVE: Duration = Duration::from_secs(10);

/// One step of the publisher's sequence, as a failure detail names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    /// Asking the backend whether the run is already published.
    Preflight,
    /// Downloading the run's tree from the artifacts service.
    Download,
    /// Deploying (or reusing the deployment of) the playable build.
    PagesDeploy,
    /// Publishing the implementation to the run's public repository.
    RepositoryPublish,
}

impl fmt::Display for Step {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Step::Preflight => "the publication preflight",
            Step::Download => "the download",
            Step::PagesDeploy => "the Pages deploy",
            Step::RepositoryPublish => "the repository publish",
        })
    }
}

/// The work of each step, which [`run`] sequences. Each method is one step and
/// returns its failure as the detail the publish fails with.
#[async_trait::async_trait(?Send)]
pub trait Steps {
    /// The publication preflight: the links the run already carries when it is
    /// published, or `None` when it still needs releasing.
    async fn preflight(&mut self) -> Result<Option<ReleasedLinks>, String>;
    /// The download of the run's tree, which the release steps then read.
    async fn download(&mut self) -> Result<(), String>;
    /// The Pages deploy: the playable build's URL, or `None` without a build.
    async fn deploy(&mut self) -> Result<Option<String>, String>;
    /// The repository publish: the repository URL, or `None` for a run that
    /// releases no code.
    async fn publish_repository(&mut self) -> Result<Option<String>, String>;
    /// Stream one progress line. Best effort: it never fails the publish.
    async fn progress(&mut self, message: &str);
    /// Report the terminal result to the backend.
    async fn report(&mut self, result: &PublishResult) -> Result<(), String>;
}

/// The termination grace period and the part of it kept for the report.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Grace {
    /// The time between `SIGTERM` and the pod's kill.
    pub period: Duration,
    /// The part of `period` the interrupted step may not use, kept for the
    /// result report.
    pub report_reserve: Duration,
}

impl Grace {
    /// The grace period `period`, keeping [`REPORT_RESERVE`] of it for the
    /// report, or half of it when it is shorter than twice that.
    pub fn new(period: Duration) -> Self {
        Self {
            period,
            report_reserve: REPORT_RESERVE.min(period / 2),
        }
    }

    /// How long after `SIGTERM` the step the publisher is on may still run.
    pub fn step_budget(&self) -> Duration {
        self.period.saturating_sub(self.report_reserve)
    }
}

/// The publisher's view of `SIGTERM`: whether, and when, it arrived. Clones
/// observe the same signal.
#[derive(Debug, Clone)]
pub struct Shutdown {
    received: watch::Receiver<Option<Instant>>,
}

/// Fires a [`Shutdown`] made by [`Shutdown::channel`].
#[derive(Debug)]
pub struct ShutdownTrigger {
    sender: watch::Sender<Option<Instant>>,
}

impl ShutdownTrigger {
    /// Record the signal as received now. Only the first call counts.
    pub fn fire(&self) {
        self.sender.send_if_modified(|received| {
            if received.is_some() {
                return false;
            }
            *received = Some(Instant::now());
            true
        });
    }
}

impl Shutdown {
    /// A shutdown fired by hand, and its trigger.
    pub fn channel() -> (ShutdownTrigger, Self) {
        let (sender, received) = watch::channel(None);
        (ShutdownTrigger { sender }, Self { received })
    }

    /// A shutdown that fires when `signal` resolves (see [`sigterm`]). The
    /// signal is awaited on a task of its own, so it is noticed whatever the
    /// publisher is doing.
    pub fn on(signal: impl Future<Output = ()> + Send + 'static) -> Self {
        let (trigger, shutdown) = Self::channel();
        tokio::spawn(async move {
            signal.await;
            trigger.fire();
        });
        shutdown
    }

    /// A shutdown that never fires.
    pub fn never() -> Self {
        Self::channel().1
    }

    /// When the signal arrived, if it has.
    pub fn received_at(&self) -> Option<Instant> {
        *self.received.borrow()
    }

    /// Wait for the signal, resolving to when it arrived; never resolves when it
    /// cannot arrive any more.
    pub async fn received(&self) -> Instant {
        let mut received = self.received.clone();
        let at = received
            .wait_for(Option::is_some)
            .await
            .ok()
            .and_then(|at| *at);
        match at {
            Some(at) => at,
            None => std::future::pending().await,
        }
    }
}

/// Resolve on the publisher's first `SIGTERM`. A handler that cannot be
/// installed is logged and never resolves, leaving the signal's default action.
/// The handler is installed when this is called, not when it is first polled.
pub fn sigterm() -> impl Future<Output = ()> + Send + 'static {
    let signal = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate());
    async move {
        match signal {
            Ok(mut signal) => {
                if signal.recv().await.is_some() {
                    return;
                }
            }
            Err(err) => {
                tracing::warn!(error = %err, "could not install the SIGTERM handler");
            }
        }
        std::future::pending().await
    }
}

/// How a publish ended: the terminal result and whether the backend took it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outcome {
    /// The terminal result the publisher reported (or tried to).
    pub result: PublishResult,
    /// Whether the report reached the backend.
    pub reported: bool,
}

impl Outcome {
    /// Whether the publisher should exit zero: the release succeeded and the
    /// backend has the result. A failed or interrupted publish, and a result
    /// that could not be reported, exit non-zero, so the outcome is visible in
    /// the Job's status as well as on the live stream.
    pub fn succeeded(&self) -> bool {
        self.reported && self.result.state == PublishState::Succeeded
    }
}

/// Run the publisher's sequence through `steps`, stopping as `shutdown` and
/// `grace` say, and report its result.
pub async fn run<S: Steps>(steps: &mut S, shutdown: &Shutdown, grace: Grace) -> Outcome {
    let result = match release(steps, shutdown, grace).await {
        Ok(links) => PublishResult {
            state: PublishState::Succeeded,
            source_repo: links.source_repo,
            playable_build: links.playable_build,
            detail: None,
        },
        Err(detail) => {
            tracing::warn!(%detail, "release failed");
            PublishResult {
                state: PublishState::Failed,
                source_repo: None,
                playable_build: None,
                detail: Some(detail),
            }
        }
    };
    let reported = report(steps, &result, shutdown, grace).await;
    Outcome { result, reported }
}

/// The release steps in order, each started only while no `SIGTERM` has
/// arrived, with a progress line before each. Returns the links, or the detail
/// the publish fails with.
async fn release<S: Steps>(
    steps: &mut S,
    shutdown: &Shutdown,
    grace: Grace,
) -> Result<ReleasedLinks, String> {
    // Preflight: a job that runs against an already-published run reports the
    // links the run carries and does nothing else (see `JobSteps::preflight`).
    if let Some(published) = step(shutdown, grace, Step::Preflight, steps.preflight()).await? {
        progress(steps, shutdown, "run is already published").await;
        return Ok(published);
    }

    progress(steps, shutdown, "downloading the run's source tree").await;
    step(shutdown, grace, Step::Download, steps.download()).await?;

    progress(steps, shutdown, "deploying the playable build").await;
    let playable_build = step(shutdown, grace, Step::PagesDeploy, steps.deploy()).await?;

    progress(steps, shutdown, "publishing the source repository").await;
    let source_repo = step(
        shutdown,
        grace,
        Step::RepositoryPublish,
        steps.publish_repository(),
    )
    .await?;

    progress(steps, shutdown, "release complete").await;
    Ok(ReleasedLinks {
        source_repo,
        playable_build,
    })
}

/// Run one step unless `SIGTERM` has arrived. A signal that arrives while it
/// runs lets it go on for [`Grace::step_budget`] from the signal, after which
/// it is abandoned; either way the publish then fails as interrupted.
async fn step<T>(
    shutdown: &Shutdown,
    grace: Grace,
    step: Step,
    work: impl Future<Output = Result<T, String>>,
) -> Result<T, String> {
    if shutdown.received_at().is_some() {
        tracing::warn!(%step, "SIGTERM received; not starting the step");
        return Err(format!("{INTERRUPTED} before {step}"));
    }
    let mut work = std::pin::pin!(work);
    let signalled = tokio::select! {
        biased;
        outcome = &mut work => return outcome,
        at = shutdown.received() => at,
    };
    let budget = grace.step_budget();
    tracing::warn!(
        %step,
        budget_ms = u64::try_from(budget.as_millis()).unwrap_or(u64::MAX),
        "SIGTERM received; letting the step finish within the grace period"
    );
    match tokio::time::timeout_at(signalled + budget, work).await {
        Ok(Ok(_)) => Err(format!("{INTERRUPTED} during {step}")),
        Ok(Err(err)) => Err(format!(
            "{INTERRUPTED} during {step}; the step failed: {err}"
        )),
        Err(_) => {
            tracing::warn!(%step, "the step outlasted the grace period; abandoning it");
            Err(format!(
                "{INTERRUPTED} during {step}; the step did not end within the \
                 termination grace period and was abandoned"
            ))
        }
    }
}

/// Stream a progress line unless `SIGTERM` has arrived; one in flight when it
/// arrives is dropped, as the line is best effort.
async fn progress<S: Steps>(steps: &mut S, shutdown: &Shutdown, message: &str) {
    if shutdown.received_at().is_some() {
        return;
    }
    tokio::select! {
        biased;
        () = steps.progress(message) => {}
        _ = shutdown.received() => {}
    }
}

/// Report `result`, within the grace period once `SIGTERM` has arrived.
/// Returns whether the backend took it.
async fn report<S: Steps>(
    steps: &mut S,
    result: &PublishResult,
    shutdown: &Shutdown,
    grace: Grace,
) -> bool {
    let mut work = std::pin::pin!(steps.report(result));
    let signalled = match shutdown.received_at() {
        Some(at) => at,
        None => tokio::select! {
            biased;
            outcome = &mut work => return reported(outcome),
            at = shutdown.received() => at,
        },
    };
    match tokio::time::timeout_at(signalled + grace.period, work).await {
        Ok(outcome) => reported(outcome),
        Err(_) => {
            tracing::error!("the result report did not land within the termination grace period");
            false
        }
    }
}

/// Log a report that did not land, and say whether it did.
fn reported(outcome: Result<(), String>) -> bool {
    match outcome {
        Ok(()) => true,
        Err(err) => {
            tracing::error!(error = %err, "could not report the publish result to the backend");
            false
        }
    }
}

/// The steps of a real publish Job: the backend over the publish-job client, the
/// artifacts service, and `gh`/`git`/`wrangler` with the Cloudflare API.
pub struct JobSteps<'a> {
    config: &'a Config,
    client: &'a PublishJobClient,
    release: Option<PreparedRelease<SystemCommandRunner>>,
}

impl<'a> JobSteps<'a> {
    /// The steps of the publish `config` describes, reported through `client`.
    pub fn new(config: &'a Config, client: &'a PublishJobClient) -> Self {
        Self {
            config,
            client,
            release: None,
        }
    }

    /// The release the download prepared.
    fn prepared(&self) -> Result<&PreparedRelease<SystemCommandRunner>, String> {
        self.release
            .as_ref()
            .ok_or_else(|| "the run's tree was not downloaded before its release".to_string())
    }
}

#[async_trait::async_trait(?Send)]
impl Steps for JobSteps<'_> {
    /// Never release a run that is already published. A publish job can
    /// legitimately reach this point against a published run — a duplicate
    /// enqueued before the first one finished, or a retry after the live stream
    /// dropped once the release had already landed. Every release step is safe to
    /// repeat, but the links the run carries are the ones it was published with,
    /// so reporting them makes the job a truthful no-op: the backend re-asserts
    /// the same links and keeps the original `published_at`. An unreachable
    /// backend fails the job (see [`PublishJobClient::published_run`]).
    async fn preflight(&mut self) -> Result<Option<ReleasedLinks>, String> {
        let published = self
            .client
            .published_run(&self.config.run_id)
            .await
            .map_err(|err| format!("checking whether the run is already published: {err}"))?;
        Ok(published.map(|published| {
            tracing::warn!(
                run_id = %self.config.run_id,
                publish_job_id = %self.config.publish_job_id,
                "run is already published"
            );
            ReleasedLinks {
                source_repo: published.source_repo,
                playable_build: published.playable_build,
            }
        }))
    }

    async fn download(&mut self) -> Result<(), String> {
        let run_dir: PathBuf = download_run_tree(
            &self.config.artifacts_url,
            &self.config.run_id,
            &self.config.publish_job_id,
            &self.config.publish_job_token,
            &self.config.work_dir,
            &Backoff::default(),
        )
        .await
        .map_err(|err| format!("downloading the run source tree: {err}"))?;
        self.release = Some(PreparedRelease::from_env(&run_dir).map_err(|err| err.to_string())?);
        Ok(())
    }

    async fn deploy(&mut self) -> Result<Option<String>, String> {
        self.prepared()?
            .deploy()
            .await
            .map_err(|err| err.to_string())
    }

    async fn publish_repository(&mut self) -> Result<Option<String>, String> {
        self.prepared()?
            .publish_repository()
            .await
            .map_err(|err| err.to_string())
    }

    async fn progress(&mut self, message: &str) {
        if let Err(err) = self.client.post_progress(message).await {
            tracing::warn!(%message, error = %err, "could not stream a publish progress line");
        }
    }

    async fn report(&mut self, result: &PublishResult) -> Result<(), String> {
        self.client
            .post_result(result)
            .await
            .map_err(|err| err.to_string())
    }
}

#[cfg(test)]
#[path = "sequence.test.rs"]
mod tests;
