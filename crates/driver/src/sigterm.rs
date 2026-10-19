//! What the driver does when it is sent `SIGTERM`.
//!
//! Kubernetes sends the driver `SIGTERM` before it kills the pod for a drain, an
//! eviction or a preemption, and the driver `Job` grants it a grace period to act
//! on it. The driver overview's "Termination" sets what it does, by what it holds:
//!
//! - A driver that holds the run's record posts the held report at once if it has
//!   not landed, then goes on [finishing](crate::finish) the run for as long as the
//!   grace lasts. The backend finishes from the held record whatever the driver did
//!   not.
//! - A driver that holds no record yet reports the run `failed` with the state
//!   `infrastructure` and the detail `driver interrupted by SIGTERM`, naming the
//!   [stage](Stage) it was in.
//!
//! Either way the driver deletes its sandbox before it exits.
//!
//! [`run_until_shutdown`] holds that logic. It races the driver's run, finishing
//! included, against a shutdown future, which `main` resolves on the signal and a
//! test resolves when it likes. The [`StageCell`] is what tells the two cases
//! apart: `main`, [`drive`](crate::run::drive) and the run engine (through
//! [`EventSink::stage`](crate::EventSink::stage)) move it through the run's stages,
//! and [`finish`](crate::finish::finish) records in it the held report it makes and
//! whether that report landed.

use std::future::Future;
use std::process::ExitCode;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use crate::client::{JobClient, StoreFields};
use crate::finish::timed;
use crate::retry::{RetryPolicy, retry_call};
use crate::{RunRecord, RunState};

/// The detail a run interrupted before it had a record is reported with, followed
/// by the stage it was in.
pub const INTERRUPTED_DETAIL: &str = "driver interrupted by SIGTERM";

/// How long the report of an interrupted run is retried. It has to fit inside the
/// driver pod's termination grace (`120` seconds by default) with the sandbox
/// teardown made beside it, so it is half of that.
pub const INTERRUPTED_REPORT_WAIT: Duration = Duration::from_secs(60);

/// How long one attempt of a report made on `SIGTERM` may go unanswered.
pub const INTERRUPTED_ATTEMPT_TIMEOUT: Duration = Duration::from_secs(15);

/// How long after the first sandbox teardown of an interrupted run the second is
/// made, to catch a sandbox whose creation was in flight when the run was dropped.
pub const SANDBOX_SWEEP_INTERVAL: Duration = Duration::from_secs(2);

/// The stage of the run the driver is in, named in an interrupted run's detail.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stage {
    /// The driver's own setup: its first report and resolving the definition.
    Setup,
    /// Seeding the run's workspace.
    Seeding,
    /// Pulling the image, starting the sandbox and preparing it for the session.
    SandboxStart,
    /// The harness session.
    Session,
    /// Collecting the produced tree out of the sandbox and stopping it.
    Collection,
    /// The host-side work on the collected tree: the post-run stages, validation
    /// and the record.
    PostRun,
    /// Handing the finished run to durable storage and reporting it.
    Finishing,
}

impl Stage {
    /// The stage's name, as an interrupted run's detail carries it.
    pub fn describe(self) -> &'static str {
        match self {
            Self::Setup => "setup",
            Self::Seeding => "seeding",
            Self::SandboxStart => "sandbox start",
            Self::Session => "session",
            Self::Collection => "collection",
            Self::PostRun => "post-run",
            Self::Finishing => "finishing",
        }
    }
}

impl std::fmt::Display for Stage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.describe())
    }
}

/// The detail an interrupted run is reported with: [`INTERRUPTED_DETAIL`] naming
/// `stage`.
pub fn interrupted_detail(stage: Stage) -> String {
    format!("{INTERRUPTED_DETAIL} during {stage}")
}

/// The held report the finishing made: the record and failure detail it carried.
#[derive(Debug, Clone)]
struct Held {
    record: RunRecord,
    detail: Option<String>,
}

/// The run's progress as `SIGTERM` handling needs it: the stage it is in and, once
/// the finishing began, the held report and whether it landed. Shared by `main`,
/// [`drive`](crate::run::drive), the run engine's event sink and
/// [`finish`](crate::finish::finish).
#[derive(Debug)]
pub struct StageCell {
    stage: Mutex<Stage>,
    held: Mutex<Option<Held>>,
    landed: AtomicBool,
}

impl Default for StageCell {
    fn default() -> Self {
        Self::new()
    }
}

impl StageCell {
    /// A run at [`Stage::Setup`], holding no report.
    pub fn new() -> Self {
        Self {
            stage: Mutex::new(Stage::Setup),
            held: Mutex::new(None),
            landed: AtomicBool::new(false),
        }
    }

    /// Move the run to `stage`. Once at [`Stage::Finishing`] it stays there: the
    /// run's stages are behind it.
    pub fn set(&self, stage: Stage) {
        if let Ok(mut current) = self.stage.lock()
            && *current != Stage::Finishing
        {
            *current = stage;
        }
    }

    /// The stage the run is in.
    pub fn stage(&self) -> Stage {
        self.stage
            .lock()
            .map(|stage| *stage)
            .unwrap_or(Stage::Finishing)
    }

    /// Record the held report the finishing is making: `record` with the run's
    /// failure `detail`. Moves the run to [`Stage::Finishing`].
    pub fn hold(&self, record: &RunRecord, detail: Option<&str>) {
        self.set(Stage::Finishing);
        if let Ok(mut held) = self.held.lock() {
            *held = Some(Held {
                record: record.clone(),
                detail: detail.map(str::to_owned),
            });
        }
    }

    /// Record that the held report landed.
    pub fn held_landed(&self) {
        self.landed.store(true, Ordering::SeqCst);
    }

    /// Whether the held report landed.
    pub fn is_held_landed(&self) -> bool {
        self.landed.load(Ordering::SeqCst)
    }

    /// Whether the run holds its record: the finishing recorded a held report.
    pub fn holds_record(&self) -> bool {
        self.held.lock().map(|held| held.is_some()).unwrap_or(false)
    }

    /// The held report still to land, if there is one.
    fn unlanded(&self) -> Option<Held> {
        if self.is_held_landed() {
            return None;
        }
        self.held.lock().ok().and_then(|held| held.clone())
    }
}

/// The run's sandbox, which every `SIGTERM` path deletes before the driver exits.
pub trait Sandbox {
    /// Delete the job's sandbox, reporting whether it is now gone. A sandbox that
    /// is already gone is success.
    fn teardown(&self) -> impl Future<Output = bool>;
}

/// Where the reports made on `SIGTERM` go, and how long each may wait.
#[derive(Debug, Clone, Copy)]
pub struct ShutdownTarget<'a> {
    /// The run's job client.
    pub client: &'a JobClient,
    /// How long an interrupted run's `failed` report is retried:
    /// [`INTERRUPTED_REPORT_WAIT`] for the driver.
    pub report_wait: Duration,
    /// How long one report attempt may go unanswered:
    /// [`INTERRUPTED_ATTEMPT_TIMEOUT`] for the driver, `None` for a test on a
    /// paused clock.
    pub attempt_timeout: Option<Duration>,
    /// The pause between the two sandbox teardowns of an interrupted run:
    /// [`SANDBOX_SWEEP_INTERVAL`] for the driver.
    pub sweep_interval: Duration,
}

/// Run the driver's `run`, finishing included, until it ends or `shutdown`
/// resolves, and act on the shutdown as the driver overview's "Termination" sets.
///
/// `stage` is the cell the run moves through its stages. On shutdown:
///
/// - At [`Stage::Finishing`] the run holds its record, or is about to make its held
///   report with it. The held report is posted at once if it has not landed, the
///   sandbox is deleted, and the run keeps going: its exit code is the driver's.
/// - Before it, the run holds no record. It is dropped, the sandbox is deleted
///   (and swept for again a moment later), and the run is reported `failed` with
///   the record `interrupted_record` builds for the state
///   [`RunState::Infrastructure`] and the detail naming the stage (`None` when it
///   cannot build one, which reports the failure without a record). The driver
///   exits successfully once that report landed or was refused and the sandbox is
///   gone.
pub async fn run_until_shutdown<R, S, B, F>(
    stage: &StageCell,
    run: R,
    shutdown: S,
    target: &ShutdownTarget<'_>,
    sandbox: &B,
    interrupted_record: F,
) -> ExitCode
where
    R: Future<Output = ExitCode>,
    S: Future<Output = ()>,
    B: Sandbox,
    F: FnOnce(RunState, &str) -> Option<RunRecord>,
{
    let mut run = Box::pin(run);
    tokio::select! {
        biased;
        exit = &mut run => return exit,
        () = shutdown => {}
    }

    let at = stage.stage();
    if at == Stage::Finishing {
        tracing::warn!(
            holds_record = stage.holds_record(),
            held_landed = stage.is_held_landed(),
            "driver sent SIGTERM while finishing the run; finishing it for as long as the grace lasts",
        );
        let held = post_held(stage, target);
        let teardown = async {
            sandbox.teardown().await;
        };
        let ((), (), exit) = tokio::join!(held, teardown, run);
        return exit;
    }

    // No record yet: the run is dropped where it is.
    drop(run);
    let detail = interrupted_detail(at);
    tracing::warn!(stage = %at, "driver sent SIGTERM before the run had a record; reporting it failed");
    let record = interrupted_record(RunState::Infrastructure, &detail);
    let report = async {
        let policy = RetryPolicy::waiting_for(target.report_wait);
        let client = target.client;
        retry_call(
            &policy,
            "the interrupted run's report",
            std::future::pending(),
            || {
                timed(
                    target.attempt_timeout,
                    client.post_status_failed(
                        detail.clone(),
                        record.clone(),
                        StoreFields::default(),
                    ),
                )
            },
        )
        .await
    };
    let teardown = async {
        let first = sandbox.teardown().await;
        tokio::time::sleep(target.sweep_interval).await;
        let second = sandbox.teardown().await;
        first && second
    };
    let (report, torn_down) = tokio::join!(report, teardown);
    let reported = match &report {
        Ok(()) => {
            tracing::info!(%detail, "reported the interrupted run to the backend");
            true
        }
        Err(failure) => {
            let refused = failure.end == crate::retry::RetryEnd::Refused;
            tracing::error!(
                %detail,
                error = %failure,
                refused,
                "could not report the interrupted run to the backend",
            );
            refused
        }
    };
    if reported && torn_down {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

/// The held report, posted once at once when the finishing made it and it has not
/// landed. The finishing's own retries go on beside it; the backend replaces a held
/// record with a repeat of it.
async fn post_held(stage: &StageCell, target: &ShutdownTarget<'_>) {
    let Some(held) = stage.unlanded() else {
        return;
    };
    match timed(
        target.attempt_timeout,
        target
            .client
            .post_status_storing(&held.record, held.detail.as_deref(), None),
    )
    .await
    {
        Ok(()) => {
            stage.held_landed();
            tracing::info!(run_id = %held.record.id, "posted the held report on SIGTERM");
        }
        Err(error) => tracing::warn!(
            run_id = %held.record.id,
            %error,
            "could not post the held report on SIGTERM; the finishing keeps retrying it",
        ),
    }
}

#[cfg(test)]
#[path = "sigterm.test.rs"]
mod tests;
