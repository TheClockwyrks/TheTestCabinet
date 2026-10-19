//! Handing a finished run to durable storage before the driver exits.
//!
//! Once the session ends, the run's result exists only on the driver pod's disk.
//! [`finish`] hands it over in the order the driver overview's "Finishing a run"
//! sets:
//!
//! 1. The held report: a `storing` status carrying the record, and the failure
//!    detail when the run failed. The backend keeps it against the job, and
//!    finishes the run from it if the driver is lost from here on.
//! 2. The uploads: the run tree to the artifacts service
//!    ([`store_run_tree`]), which stamps the
//!    playable-build link only once the tree is stored, then the bundle to the
//!    repos service ([`store_bundle`]), then the
//!    best-effort mirrors into the backend store ([`Mirrors`]).
//! 3. The terminal report: `succeeded`, `failed` or `canceled`, carrying the
//!    record with its build link, `artifactsStored` and, when the store was why the
//!    tree was not stored, `storeFault`.
//!
//! Every call is made under the driver's [retry policy](crate::retry): the reports
//! bounded by `TCAB_DRIVER_REPORT_WAIT_SECONDS`, the uploads by
//! `TCAB_ARTIFACT_UPLOAD_WAIT_SECONDS`. A held report that does not land does not
//! stop the uploads or the terminal report: the driver still makes them.
//!
//! An operator's cancellation ends the waiting wherever it is. The driver polls its
//! job's state every three seconds throughout; once the job reads `canceled`, the
//! call in flight ends, the calls still to come are not waited on, and the terminal
//! report becomes `canceled` carrying the record. A gg run that was already
//! canceled when its finishing began is not cut short by the cancellation it
//! follows: its uploads wait at most ten minutes each instead, and its terminal
//! report is `canceled`.
//!
//! The driver exits successfully once its terminal report lands or the backend
//! refuses it, and non-zero only when the report deadline passes with it
//! undelivered ([`Finished::exit_code`]); the backend then finishes the run from the
//! held record.

use std::future::Future;
use std::path::Path;
use std::process::ExitCode;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use crate::RunRecord;
use crate::artifacts::{RunWait, StoreWait, TreeStore, UploadEnd, store_run_tree};
use crate::bundle::{BundleTarget, store_bundle};
use crate::client::{ClientError, JobClient, StoreFields};
use crate::retry::{FinalFailure, RetryEnd, RetryFailure, RetryPolicy, retry_call};
use crate::sigterm::StageCell;

/// How long one attempt of a report may go unanswered before it is abandoned as a
/// failed attempt and retried. Without it a backend that accepts the connection
/// and never answers would hold the driver past its report deadline, which is
/// counted from a call's first failure.
pub const REPORT_ATTEMPT_TIMEOUT: Duration = Duration::from_secs(60);

/// Where a run's finishing calls go, and how long each may wait.
#[derive(Debug, Clone, Copy)]
pub struct FinishTarget<'a> {
    /// The run's job client: the reports and the cancellation poll.
    pub client: &'a JobClient,
    /// The artifacts service (`TCAB_ARTIFACTS_URL`); `None` uploads no tree.
    pub artifacts_url: Option<&'a str>,
    /// The repos service (`TCAB_REPOS_URL`); `None` uploads no bundle.
    pub repos_url: Option<&'a str>,
    /// The job id the per-job token was minted for.
    pub job_id: &'a str,
    /// The per-job bearer token.
    pub job_token: &'a str,
    /// The directory holding the run tree at `{out_dir}/{run id}/`.
    pub out_dir: &'a Path,
    /// Each upload's wait (`TCAB_ARTIFACT_UPLOAD_WAIT_SECONDS`).
    pub upload_wait: Duration,
    /// The held and terminal reports' wait (`TCAB_DRIVER_REPORT_WAIT_SECONDS`).
    pub report_wait: Duration,
    /// How long one report attempt may go unanswered before it counts as a failed
    /// attempt: [`REPORT_ATTEMPT_TIMEOUT`] for the driver. `None` leaves an attempt
    /// unbounded, which only a test on a paused clock wants: there the clock jumps
    /// whenever the runtime waits on the network, and would end an attempt the stub
    /// is answering.
    pub attempt_timeout: Option<Duration>,
    /// The run's [stage cell](crate::sigterm::StageCell), in which the finishing
    /// records its held report and whether it landed, for the driver's `SIGTERM`
    /// handling. `None` records nothing.
    pub stage: Option<&'a StageCell>,
}

/// The outcome the run reached, which its terminal report carries unless a
/// cancellation turns it into `canceled`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunOutcome {
    /// The run produced its record: `succeeded`.
    Succeeded,
    /// The run failed for `detail`: `failed`, the detail also carried by the held
    /// report.
    Failed {
        /// The failure detail.
        detail: String,
    },
    /// The run was canceled and recorded from what the driver holds: `canceled`.
    Canceled,
}

/// The best-effort mirrors of a run's media into the backend store, made after the
/// uploads and before the terminal report. Their failures are the mirror's own to
/// log; they never change the run's finishing.
pub trait Mirrors {
    /// Mirror what `record`'s tree holds into the backend store.
    fn mirror(&self, record: &RunRecord) -> impl Future<Output = ()>;
}

/// No mirrors at all.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoMirrors;

impl Mirrors for NoMirrors {
    async fn mirror(&self, _record: &RunRecord) {}
}

/// How one report ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReportEnd {
    /// The backend accepted it.
    Landed,
    /// The backend refused it: a `4xx` other than `408` and `429`.
    Refused,
    /// The report deadline passed without it landing.
    GaveUp,
    /// The job was canceled while it was being made or waited on.
    Canceled,
    /// Nothing was owed: the job was canceled and there is no record to hand
    /// back with a `canceled` report.
    NotOwed,
}

impl ReportEnd {
    fn of<E>(result: &Result<(), RetryFailure<E>>) -> Self {
        match result {
            Ok(()) => Self::Landed,
            Err(failure) => match failure.end {
                RetryEnd::Refused => Self::Refused,
                RetryEnd::GaveUp => Self::GaveUp,
                RetryEnd::Canceled => Self::Canceled,
            },
        }
    }
}

/// The status a terminal report carried.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalState {
    /// `succeeded`.
    Succeeded,
    /// `failed`.
    Failed,
    /// `canceled`.
    Canceled,
}

/// What a run's finishing did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finished {
    /// How the held report ended; `None` when the run had no record to hold.
    pub held: Option<ReportEnd>,
    /// What became of the run tree.
    pub tree: TreeStore,
    /// Whether the bundle was stored; `None` when it was not attempted (no repos
    /// service, no record, or a cancellation before it).
    pub bundle_stored: Option<bool>,
    /// The status of the last terminal report made.
    pub terminal: TerminalState,
    /// How that terminal report ended.
    pub report: ReportEnd,
}

impl Finished {
    /// The driver's exit code: success once the terminal report landed or was
    /// refused (or none was owed), failure only when the report deadline passed
    /// with it undelivered.
    pub fn exit_code(&self) -> ExitCode {
        if self.report == ReportEnd::GaveUp {
            ExitCode::FAILURE
        } else {
            ExitCode::SUCCESS
        }
    }
}

/// A report attempt's failure: the backend's answer, or no answer within
/// [`REPORT_ATTEMPT_TIMEOUT`].
#[derive(Debug, thiserror::Error)]
pub(crate) enum ReportError {
    #[error(transparent)]
    Client(#[from] ClientError),
    #[error("the backend did not answer within {} seconds", .0.as_secs())]
    TimedOut(Duration),
}

impl FinalFailure for ReportError {
    fn is_final(&self) -> bool {
        match self {
            Self::Client(error) => error.is_refused(),
            Self::TimedOut(_) => false,
        }
    }
}

/// One report attempt, bounded by `limit` when there is one.
pub(crate) async fn timed(
    limit: Option<Duration>,
    report: impl Future<Output = Result<(), ClientError>>,
) -> Result<(), ReportError> {
    let Some(limit) = limit else {
        return report.await.map_err(ReportError::from);
    };
    match tokio::time::timeout(limit, report).await {
        Ok(result) => result.map_err(ReportError::from),
        Err(_) => Err(ReportError::TimedOut(limit)),
    }
}

/// The run's cancellation as the finishing sees it: whether the run was already
/// canceled when finishing began, and whether a cancellation has been observed
/// since.
struct Watch<'a> {
    client: &'a JobClient,
    already_canceled: bool,
    seen: AtomicBool,
}

impl<'a> Watch<'a> {
    fn new(client: &'a JobClient, already_canceled: bool) -> Self {
        Self {
            client,
            already_canceled,
            seen: AtomicBool::new(false),
        }
    }

    /// Resolves once the job reads `canceled`, recording that it did. Never
    /// resolves for a run that was already canceled: the finishing it is making is
    /// the one that cancellation asked for.
    async fn canceled(&self) {
        if self.already_canceled {
            return std::future::pending().await;
        }
        crate::retry::job_canceled(self.client).await;
        self.seen.store(true, Ordering::SeqCst);
    }

    /// Whether a cancellation was observed during the finishing.
    fn seen(&self) -> bool {
        self.seen.load(Ordering::SeqCst)
    }

    /// Whether the terminal report is `canceled`.
    fn reports_canceled(&self) -> bool {
        self.already_canceled || self.seen()
    }
}

/// The run-tree upload's wait: its repeated `storing` reports are the run's
/// [`RunWait`], and its cancellation is the finishing's [`Watch`].
struct FinishWait<'w, 'a> {
    watch: &'w Watch<'a>,
    reports: RunWait<'a>,
}

impl StoreWait for FinishWait<'_, '_> {
    async fn already_canceled(&self) -> bool {
        self.watch.already_canceled
    }

    async fn waiting(&self, reason: &str) {
        self.reports.waiting(reason).await;
    }

    async fn canceled(&self) {
        self.watch.canceled().await;
    }
}

/// Hand a finished run to durable storage and make its terminal report.
///
/// `record` is the run's record, `None` only for a failed run whose record could
/// not be built: such a run has no held report and no uploads, only its `failed`
/// report. `outcome` is what the run reached. `already_canceled` is set for a gg
/// run that was canceled before its finishing began. `mirrors` runs between the
/// uploads and the terminal report.
pub async fn finish<M: Mirrors>(
    target: &FinishTarget<'_>,
    record: Option<RunRecord>,
    outcome: RunOutcome,
    already_canceled: bool,
    mirrors: &M,
) -> Finished {
    let client = target.client;
    let watch = Watch::new(client, already_canceled);
    let report_policy = RetryPolicy::waiting_for(target.report_wait);
    let detail = match &outcome {
        RunOutcome::Failed { detail } => Some(detail.clone()),
        RunOutcome::Succeeded | RunOutcome::Canceled => None,
    };

    let Some(mut record) = record else {
        return finish_without_record(target, &watch, &report_policy, &outcome, detail).await;
    };

    // 1. The held report.
    if let Some(stage) = target.stage {
        stage.hold(&record, detail.as_deref());
    }
    let held = retry_call(&report_policy, "the held report", watch.canceled(), || {
        timed(
            target.attempt_timeout,
            client.post_status_storing(&record, detail.as_deref(), None),
        )
    })
    .await;
    let held = log_report("storing", &record.id, held);
    if held == ReportEnd::Landed
        && let Some(stage) = target.stage
    {
        stage.held_landed();
    }

    // 2. The uploads, unless a cancellation already ended the waiting.
    let tree = if watch.seen() {
        tree_skipped(target)
    } else {
        let wait = FinishWait {
            watch: &watch,
            reports: RunWait::holding(client, &record, detail.as_deref()),
        };
        store_run_tree(
            &RetryPolicy::waiting_for(target.upload_wait),
            &wait,
            target.artifacts_url,
            &mut record,
            target.job_id,
            target.out_dir,
            target.job_token,
        )
        .await
    };
    let bundle_stored = match target.repos_url {
        Some(repos_url) if !watch.seen() => {
            Some(store_run_bundle(target, repos_url, &record, &watch).await)
        }
        _ => None,
    };
    mirrors.mirror(&record).await;

    // 3. The terminal report.
    let store = tree.store_fields();
    let (terminal, report) = if watch.reports_canceled() || outcome == RunOutcome::Canceled {
        (
            TerminalState::Canceled,
            report_canceled(target, &report_policy, &record, &store).await,
        )
    } else {
        let (state, what) = match &outcome {
            RunOutcome::Failed { .. } => (TerminalState::Failed, "failed"),
            RunOutcome::Succeeded | RunOutcome::Canceled => (TerminalState::Succeeded, "succeeded"),
        };
        let result = retry_call(
            &report_policy,
            "the terminal report",
            watch.canceled(),
            || {
                let record = record.clone();
                let store = store.clone();
                let detail = detail.clone();
                timed(target.attempt_timeout, async move {
                    match detail {
                        Some(detail) => {
                            client.post_status_failed(detail, Some(record), store).await
                        }
                        None => client.post_status_succeeded(record, store).await,
                    }
                })
            },
        )
        .await;
        match log_report(what, &record.id, result) {
            // The job was canceled while the report waited: the only status the
            // backend still takes for it is `canceled`, which keeps the record.
            ReportEnd::Canceled => (
                TerminalState::Canceled,
                report_canceled(target, &report_policy, &record, &store).await,
            ),
            end => (state, end),
        }
    };
    Finished {
        held: Some(held),
        tree,
        bundle_stored,
        terminal,
        report,
    }
}

/// The finishing of a failed run with no record: no held report and no uploads,
/// only the `failed` report with its detail. A cancellation while it waits leaves
/// nothing owed, the job being terminal and there being no record to keep.
async fn finish_without_record(
    target: &FinishTarget<'_>,
    watch: &Watch<'_>,
    policy: &RetryPolicy,
    outcome: &RunOutcome,
    detail: Option<String>,
) -> Finished {
    let not_owed = Finished {
        held: None,
        tree: TreeStore::NoService,
        bundle_stored: None,
        terminal: TerminalState::Canceled,
        report: ReportEnd::NotOwed,
    };
    let Some(detail) = detail else {
        // A succeeded or canceled run always has a record; without one there is
        // nothing to report it with.
        tracing::warn!(?outcome, "no record to report the run with");
        return not_owed;
    };
    if watch.already_canceled {
        return not_owed;
    }
    let client = watch.client;
    let result = retry_call(policy, "the terminal report", watch.canceled(), || {
        timed(
            target.attempt_timeout,
            client.post_status_failed(detail.clone(), None, StoreFields::default()),
        )
    })
    .await;
    match log_report("failed", "(none)", result) {
        ReportEnd::Canceled => not_owed,
        report => Finished {
            terminal: TerminalState::Failed,
            report,
            ..not_owed
        },
    }
}

/// The `canceled` report with the record, retried under `policy`. Nothing ends its
/// wait but the deadline: the cancellation it reports is the one already seen.
async fn report_canceled(
    target: &FinishTarget<'_>,
    policy: &RetryPolicy,
    record: &RunRecord,
    store: &StoreFields,
) -> ReportEnd {
    let result = retry_call(
        policy,
        "the terminal report",
        std::future::pending(),
        || {
            timed(
                target.attempt_timeout,
                target
                    .client
                    .post_status_canceled(record.clone(), store.clone()),
            )
        },
    )
    .await;
    log_report("canceled", &record.id, result)
}

/// Upload the bundle under the upload wait, for at most ten minutes for a run that
/// was already canceled. Whether it was stored.
async fn store_run_bundle(
    target: &FinishTarget<'_>,
    repos_url: &str,
    record: &RunRecord,
    watch: &Watch<'_>,
) -> bool {
    let mut policy = RetryPolicy::waiting_for(target.upload_wait);
    if watch.already_canceled {
        policy = policy.for_canceled_run();
    }
    let bundle = BundleTarget {
        repos_url,
        run_id: &record.id,
        job_id: target.job_id,
        job_token: target.job_token,
    };
    let repo = target.out_dir.join(&record.id).join("implementation");
    match store_bundle(bundle, &repo, target.out_dir, &policy, watch.canceled()).await {
        Ok(()) => {
            tracing::info!(run_id = %record.id, "uploaded the run's bundle to the repos service");
            true
        }
        Err(err) => {
            tracing::warn!(
                run_id = %record.id,
                runs_own = err.is_runs_own(),
                error = %err,
                "could not store the run's bundle",
            );
            false
        }
    }
}

/// The tree a cancellation ended the finishing before: not stored, with no fault of
/// the store's, or not owed at all with no artifacts service.
fn tree_skipped(target: &FinishTarget<'_>) -> TreeStore {
    match target.artifacts_url {
        Some(_) => TreeStore::NotStored {
            end: UploadEnd::Canceled,
            store_fault: None,
        },
        None => TreeStore::NoService,
    }
}

/// Log how a report ended, and say so.
fn log_report<E: std::fmt::Display>(
    what: &str,
    run_id: &str,
    result: Result<(), RetryFailure<E>>,
) -> ReportEnd {
    let end = ReportEnd::of(&result);
    match (&result, end) {
        (Ok(()), _) => {
            tracing::info!(run_id, status = what, "reported the run to the backend");
        }
        (Err(failure), ReportEnd::Canceled) => {
            tracing::info!(
                run_id,
                status = what,
                error = %failure,
                "the job was canceled while the report waited",
            );
        }
        (Err(failure), _) => {
            tracing::error!(
                run_id,
                status = what,
                end = ?end,
                error = %failure,
                "could not report the run to the backend",
            );
        }
    }
    end
}

#[cfg(test)]
#[path = "finish.test.rs"]
mod tests;
