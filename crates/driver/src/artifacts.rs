//! Uploading the produced run tree to the artifact service.
//!
//! A driver pod is ephemeral: the run tree it writes to its scratch `out_dir`
//! (`run-record.json`, the collected `implementation/` with the playable build and
//! proof/asset media, and the `events.jsonl`/`raw.jsonl` logs) is lost when the pod
//! exits. So when an artifact service is configured (`TCAB_ARTIFACTS_URL`), the
//! driver tars `{out_dir}/{id}/` and uploads it to
//! `POST {artifacts_url}/runs/{id}/artifacts`, authed by the **same per-job token**
//! it streams status to the backend with — the artifact service forwards that token
//! to the backend to verify. Because that token was minted for the **job id** (a
//! different UUID from the run/record id in the upload path, which is the store
//! key), the driver sends its job id in the `x-tcab-job-id` header so the service
//! verifies against the right job. The upload happens *before* the terminal status
//! is posted, so by the time the console sees the run finish its artifacts are
//! already servable.
//!
//! The driver's copy is the only one until the service acknowledges it, and the pod
//! is discarded afterwards. So a failed upload is sorted into one of two
//! [kinds](UploadFailureKind): a failure that is this run's own ends the upload at
//! once, and every other failure is a condition of the store, which the driver
//! [waits on](retry_until_stored) under an [`UploadRetry`] policy, holding the tree
//! and telling the backend through a [`StoreWait`] that it is doing so. The run's
//! record is handed to the backend as the wait begins ([`RunWait`]), since it too
//! is otherwise lost with the pod. Whether the tree landed, and whether the store
//! was the reason it did not, is part of the run's report ([`store_run_tree`]); it
//! never changes the run's own outcome.
//!
//! When `TCAB_ARTIFACTS_URL` is unset (a local setup), nothing here runs — there
//! is no separate artifact service in that topology.

use std::fs::File;
use std::future::Future;
use std::io::Seek;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use test_cabinet_core::job_api::JobState;
use test_cabinet_core::{BackendClient, HttpBackendClient, RunRecord, find_build_output};
use tokio::time::Instant;

use crate::client::JobClient;

/// How much of the tarball one chunk of the upload body carries.
const TARBALL_CHUNK: usize = 256 * 1024;

/// A failure tarring or uploading the produced run tree.
#[derive(Debug, thiserror::Error)]
pub enum UploadError {
    /// The run directory could not be read or tarred.
    #[error("tarring the run tree at `{path}`: {source}")]
    Tar {
        /// The run directory that could not be archived.
        path: String,
        /// The underlying I/O error.
        #[source]
        source: std::io::Error,
    },
    /// The upload request could not be sent (a transport/connection error).
    #[error("uploading artifacts to the artifact service: {0}")]
    Transport(#[source] reqwest::Error),
    /// The artifact service rejected the upload with a non-success status.
    #[error("the artifact service rejected the upload: HTTP {status}{}", body_suffix(.body))]
    Status {
        /// The HTTP status the service returned.
        status: reqwest::StatusCode,
        /// The response body, for diagnostics.
        body: String,
    },
    /// The upload stopped making progress: no part of the tree was taken, and no
    /// answer arrived, for the whole of the stall timeout.
    #[error("the upload to the artifact service stalled for {} s", .0.as_secs())]
    Stalled(Duration),
}

/// Append the body to a status error when there is one to show.
fn body_suffix(body: &str) -> String {
    if body.trim().is_empty() {
        String::new()
    } else {
        format!(": {}", body.trim())
    }
}

/// Whose failure a failed upload is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UploadFailureKind {
    /// This run's own: something about its tree that no state of the store would
    /// change. The upload ends at once, and no other run is held for it.
    RunsOwn,
    /// A condition of the store, or of the path to it: the tree is sound and would
    /// land on a store that could take it. The driver waits on it.
    StoreCondition,
}

impl UploadError {
    /// Whose failure this is.
    ///
    /// Four failures are provably about this one tree: it could not be tarred, the
    /// service refused it as over its size cap (`413`), the service refused a path
    /// in it (`400`, the only thing the upload route answers that status for), or
    /// the service could not read it as an archive (`422`). Sending the same bytes
    /// again gets the same answer whatever the store does.
    ///
    /// Everything else is a store condition: no answer, a stall, a `5xx` (a full or
    /// faulted volume among them), a `401` or `403` (the service could not verify
    /// the job token, which the backend minted and never revokes), a `404`, and
    /// any status nothing here expects. None of them says the tree is at fault, so
    /// none of them is a reason to discard the only copy of it.
    pub fn kind(&self) -> UploadFailureKind {
        match self {
            Self::Tar { .. } => UploadFailureKind::RunsOwn,
            Self::Status { status, .. }
                if *status == reqwest::StatusCode::PAYLOAD_TOO_LARGE
                    || *status == reqwest::StatusCode::BAD_REQUEST
                    || *status == reqwest::StatusCode::UNPROCESSABLE_ENTITY =>
            {
                UploadFailureKind::RunsOwn
            }
            Self::Transport(_) | Self::Stalled(_) | Self::Status { .. } => {
                UploadFailureKind::StoreCondition
            }
        }
    }
}

/// How long the driver waits on a store that cannot take its run's tree, and how
/// it paces the attempts.
///
/// The wait between two attempts doubles from
/// [`initial_delay`](Self::initial_delay) and is capped at
/// [`max_delay`](Self::max_delay): by default 5, 10, 20 and 40 seconds, then once a
/// minute. The driver gives up once [`give_up_after`](Self::give_up_after) has
/// passed since the first failure, six hours by default
/// (`TCAB_ARTIFACT_UPLOAD_WAIT_SECONDS`).
///
/// An attempt has no overall deadline, because the body is as large as the run
/// tree and a slow link is not a failure. It is bounded by
/// [`stall_timeout`](Self::stall_timeout) instead, so a service that accepts the
/// connection and then stops reading or never answers ends the attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UploadRetry {
    /// How long after the first failed attempt the driver stops waiting on the
    /// store. The attempt in flight when it passes is allowed to finish.
    /// [`Duration::ZERO`] is a single attempt.
    pub give_up_after: Duration,
    /// The wait before the second attempt.
    pub initial_delay: Duration,
    /// The longest wait between two attempts.
    pub max_delay: Duration,
    /// How long an attempt may go without the service taking any of the tree or
    /// answering before it is abandoned as [stalled](UploadError::Stalled). An
    /// attempt is abandoned between one and two of these after its last progress.
    /// [`Duration::ZERO`] removes the bound.
    pub stall_timeout: Duration,
    /// How long the first attempt may run before the driver reports that it is
    /// waiting on the store, without the attempt having failed. A store that
    /// accepts the upload and then hangs fails nothing for a whole
    /// [`stall_timeout`](Self::stall_timeout), and for that long the run would
    /// read as running. [`Duration::ZERO`] never reports an attempt as slow.
    pub slow_after: Duration,
    /// The longest a run that was **already canceled** when its upload began is
    /// waited on. Its job is terminal, so the backend does not show it as waiting
    /// and an operator has no second cancellation to end the wait with. The bound
    /// covers a store that is restarting; the wait is
    /// [`give_up_after`](Self::give_up_after) when that is shorter.
    pub canceled_run_wait: Duration,
}

/// The default of [`UploadRetry::give_up_after`]: long enough for an operator to
/// be told of a store that takes no uploads and to repair it, with the tree kept
/// the whole time.
pub const DEFAULT_UPLOAD_WAIT: Duration = Duration::from_secs(6 * 60 * 60);

impl Default for UploadRetry {
    fn default() -> Self {
        Self {
            give_up_after: DEFAULT_UPLOAD_WAIT,
            initial_delay: Duration::from_secs(5),
            max_delay: Duration::from_secs(60),
            // Long next to the pause between two chunks of a healthy upload, and
            // next to the service unpacking the largest tree before it answers.
            stall_timeout: Duration::from_secs(5 * 60),
            // Many times what the largest tree takes to upload and unpack inside
            // a cluster, so a healthy upload is never reported as waiting.
            slow_after: Duration::from_secs(60),
            canceled_run_wait: Duration::from_secs(10 * 60),
        }
    }
}

impl UploadRetry {
    /// The default policy with its wait bound replaced.
    pub fn waiting_for(give_up_after: Duration) -> Self {
        Self {
            give_up_after,
            ..Self::default()
        }
    }

    /// A single attempt: no wait on the store at all.
    pub fn single_attempt() -> Self {
        Self::waiting_for(Duration::ZERO)
    }

    /// The wait after failed attempt number `attempt` (counted from one).
    pub fn delay_after(&self, attempt: u32) -> Duration {
        let doublings = attempt.saturating_sub(1).min(31);
        self.initial_delay
            .saturating_mul(1u32 << doublings)
            .min(self.max_delay)
    }
}

/// What a driver waiting on the store tells, and asks of, its surroundings.
///
/// The wait is the one stretch of a run's life in which the driver holds the only
/// copy of something nothing can reproduce while a different service is at fault.
/// So the backend is told about it, which is what puts the run queue on hold and
/// shows the run as waiting rather than running, and an operator's cancellation
/// has to be able to end it.
pub trait StoreWait {
    /// Whether the run was canceled before its upload began. Asked once, ahead of
    /// the first attempt. Such an upload is the one a canceled run was wound down
    /// to make, so the cancellation behind it must not end it.
    fn already_canceled(&self) -> impl Future<Output = bool> + Send;

    /// The driver is waiting on the store for `reason`: the latest attempt failed
    /// on a store condition and another follows, or the first attempt has run for
    /// [`UploadRetry::slow_after`] without finishing. Called once per failed
    /// attempt, and at most once for a slow first one.
    fn waiting(&self, reason: &str) -> impl Future<Output = ()> + Send;

    /// The wait is over other than by a cancellation, and `stored` says whether
    /// the tree landed: otherwise the driver gave up, or a later attempt failed as
    /// the run's own. Called only after [`waiting`](Self::waiting) has been.
    fn over(&self, stored: bool) -> impl Future<Output = ()> + Send;

    /// Resolves when the run has been canceled. Raced against the whole upload,
    /// the first attempt included, unless the run was
    /// [already canceled](Self::already_canceled).
    fn canceled(&self) -> impl Future<Output = ()> + Send;
}

/// A wait nobody is told about and nothing cancels: for a caller with no job to
/// report against.
#[derive(Debug, Clone, Copy, Default)]
pub struct Unattended;

impl StoreWait for Unattended {
    async fn already_canceled(&self) -> bool {
        false
    }
    async fn waiting(&self, _reason: &str) {}
    async fn over(&self, _stored: bool) {}
    async fn canceled(&self) {
        std::future::pending().await
    }
}

/// How often a waiting driver polls its job's state for a cancellation.
const WAIT_CANCEL_POLL_INTERVAL: Duration = Duration::from_secs(3);

/// How long one report of the wait may take. A report is a courtesy to the
/// backend; the wait it describes must go on whether or not it lands.
const WAIT_REPORT_TIMEOUT: Duration = Duration::from_secs(30);

/// The terminal report a driver is holding while it waits: what the backend is
/// handed for safekeeping with the first `storing` report it accepts.
#[derive(Debug, Clone)]
struct HeldReport {
    /// The record the run produced.
    record: RunRecord,
    /// Why the run failed, when the report being held is a `failed` one.
    run_failure: Option<String>,
}

/// A run's wait on the artifact store, reported to the backend through the run's
/// own [`JobClient`].
///
/// The first `storing` report the backend accepts carries the run's record. For
/// the length of the wait that record exists nowhere but this pod, and the backend
/// finishes the run from its copy if the pod is lost.
#[derive(Debug)]
pub struct RunWait<'a> {
    client: &'a JobClient,
    /// The report still to be handed over; `None` once the backend has it, and for
    /// a wait with nothing to hand over.
    held: std::sync::Mutex<Option<HeldReport>>,
}

impl<'a> RunWait<'a> {
    /// The wait of a run that produced `record`. `run_failure` is the reason the
    /// run failed when the driver will report it `failed`, and `None` when it will
    /// report it `succeeded`.
    pub fn holding(client: &'a JobClient, record: &RunRecord, run_failure: Option<&str>) -> Self {
        Self {
            client,
            held: std::sync::Mutex::new(Some(HeldReport {
                record: record.clone(),
                run_failure: run_failure.map(str::to_string),
            })),
        }
    }

    /// A wait with no report to hand over: for a run whose job is already
    /// terminal, which the backend would not finish from one.
    pub fn bare(client: &'a JobClient) -> Self {
        Self {
            client,
            held: std::sync::Mutex::new(None),
        }
    }
}

impl StoreWait for RunWait<'_> {
    async fn already_canceled(&self) -> bool {
        // Anything but a `canceled` answer, an unreachable backend included, is a
        // run that may yet be canceled, which the wait then watches for.
        matches!(self.client.poll_state().await, Ok(Some(JobState::Canceled)))
    }

    async fn waiting(&self, reason: &str) {
        let held = self
            .held
            .lock()
            .expect("held report mutex poisoned")
            .clone();
        let handing_over = held.is_some();
        let report = self.client.post_status_storing(
            reason,
            held.as_ref().map(|held| &held.record),
            held.as_ref().and_then(|held| held.run_failure.as_deref()),
        );
        match tokio::time::timeout(WAIT_REPORT_TIMEOUT, report).await {
            Ok(Ok(())) => {
                if handing_over {
                    // The backend has the record now; later reports are the reason
                    // alone.
                    *self.held.lock().expect("held report mutex poisoned") = None;
                }
            }
            Ok(Err(err)) => {
                tracing::warn!(error = %err, "could not report the wait on the artifact store to the backend");
            }
            Err(_) => {
                tracing::warn!("reporting the wait on the artifact store to the backend timed out");
            }
        }
    }

    async fn over(&self, stored: bool) {
        // `validating` is the state the job was in before the wait, and the one it
        // holds while the driver finishes its report.
        let report = self.client.post_status_wait_over(stored);
        match tokio::time::timeout(WAIT_REPORT_TIMEOUT, report).await {
            Ok(Ok(())) => {}
            Ok(Err(err)) => {
                tracing::warn!(error = %err, "could not report the end of the wait on the artifact store to the backend");
            }
            Err(_) => {
                tracing::warn!(
                    "reporting the end of the wait on the artifact store to the backend timed out"
                );
            }
        }
    }

    async fn canceled(&self) {
        loop {
            tokio::time::sleep(WAIT_CANCEL_POLL_INTERVAL).await;
            // Anything but a `canceled` answer, an unreachable backend included, is
            // no reason to stop holding the tree.
            if matches!(self.client.poll_state().await, Ok(Some(JobState::Canceled))) {
                return;
            }
        }
    }
}

/// How an upload that did not store the tree ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UploadEnd {
    /// An attempt failed as the [run's own](UploadFailureKind::RunsOwn).
    RunsOwn,
    /// The store did not take the tree within the policy's
    /// [wait](UploadRetry::give_up_after).
    GaveUp,
    /// The run was canceled while its tree was being uploaded.
    Canceled,
}

/// An upload that ended without the tree stored.
#[derive(Debug)]
pub struct UploadFailure {
    /// How the upload ended.
    pub end: UploadEnd,
    /// The last attempt's failure. `None` only for an upload canceled before any
    /// attempt had failed.
    pub error: Option<UploadError>,
}

impl std::fmt::Display for UploadFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.error {
            Some(error) => error.fmt(f),
            None => f.write_str("the run was canceled before its tree was uploaded"),
        }
    }
}

impl std::error::Error for UploadFailure {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.error
            .as_ref()
            .map(|error| error as &(dyn std::error::Error + 'static))
    }
}

impl UploadFailure {
    /// Why the tree was not stored, when the cause was a condition of the store:
    /// the last failure of an upload the driver gave up on, or was canceled out
    /// of after an attempt had failed on one. `None` when the failure was the
    /// run's own, and for a cancellation that no failed attempt preceded.
    pub fn store_fault(&self) -> Option<String> {
        match (self.end, &self.error) {
            (UploadEnd::GaveUp | UploadEnd::Canceled, Some(error))
                if error.kind() == UploadFailureKind::StoreCondition =>
            {
                Some(error.to_string())
            }
            _ => None,
        }
    }
}

/// Make `attempt` until it succeeds, waiting on a store that cannot take the tree.
///
/// A failure that is the [run's own](UploadFailureKind::RunsOwn) ends the upload
/// at once, on any attempt.
///
/// From the first [store-condition](UploadFailureKind::StoreCondition) failure the
/// driver is waiting. It tells `wait` so after each failed attempt, sleeps the
/// policy's delay and tries again, until the policy's wait has passed since that
/// first failure. A first attempt that neither lands nor fails within
/// [`UploadRetry::slow_after`] is reported as a wait too, while it goes on.
///
/// A cancellation ends the upload wherever it lands: mid-attempt, mid-report or
/// mid-sleep. The exception is a run that was
/// [already canceled](StoreWait::already_canceled) when its upload began. A
/// canceled gg run uploads its tree after the cancellation, and that upload must
/// not be cut short by the very cancellation it follows. It is retried like any
/// other, for at most [`UploadRetry::canceled_run_wait`].
///
/// Split from [`upload_run_tree_with`] so the wait runs against scripted attempts
/// on a paused clock.
pub async fn retry_until_stored<W, A, F>(
    retry: UploadRetry,
    wait: &W,
    run_id: &str,
    mut attempt: A,
) -> Result<(), UploadFailure>
where
    W: StoreWait,
    A: FnMut() -> F,
    F: Future<Output = Result<(), UploadError>>,
{
    let already_canceled = wait.already_canceled().await;
    let give_up_after = if already_canceled {
        retry.give_up_after.min(retry.canceled_run_wait)
    } else {
        retry.give_up_after
    };
    let canceled = async {
        if already_canceled {
            std::future::pending().await
        } else {
            wait.canceled().await
        }
    };
    tokio::pin!(canceled);
    // Set as a report is begun rather than as it returns: a report abandoned part
    // way may have reached the backend, and the end of the wait must then be
    // reported too.
    let reported = std::sync::atomic::AtomicBool::new(false);

    let first = {
        let first = attempt();
        tokio::pin!(first);
        let slow = async {
            if retry.slow_after.is_zero() {
                return std::future::pending().await;
            }
            tokio::time::sleep(retry.slow_after).await;
            reported.store(true, Ordering::Relaxed);
            tracing::warn!(
                run_id = %run_id,
                after_secs = retry.slow_after.as_secs(),
                "the upload of the run's tree has not finished; reporting the run as waiting on the artifact store"
            );
            let reason = format!(
                "the upload has not finished after {} s",
                retry.slow_after.as_secs()
            );
            wait.waiting(&reason).await;
        };
        tokio::pin!(slow);
        let mut slow_done = false;
        loop {
            tokio::select! {
                result = &mut first => break Some(result),
                () = &mut slow, if !slow_done => slow_done = true,
                () = &mut canceled => break None,
            }
        }
    };
    let was_reported = || reported.load(Ordering::Relaxed);
    let mut error = match first {
        // A canceled job takes no further report.
        None => {
            return Err(UploadFailure {
                end: UploadEnd::Canceled,
                error: None,
            });
        }
        Some(Ok(())) => {
            if was_reported() {
                wait.over(true).await;
            }
            return Ok(());
        }
        Some(Err(error)) => error,
    };
    if error.kind() == UploadFailureKind::RunsOwn {
        if was_reported() {
            wait.over(false).await;
        }
        return Err(UploadFailure {
            end: UploadEnd::RunsOwn,
            error: Some(error),
        });
    }

    let waiting_since = Instant::now();
    let mut failed_attempts: u32 = 1;
    let end = loop {
        let waited = waiting_since.elapsed();
        if waited >= give_up_after {
            break UploadEnd::GaveUp;
        }
        let reason = error.to_string();
        reported.store(true, Ordering::Relaxed);
        tokio::select! {
            () = wait.waiting(&reason) => {}
            () = &mut canceled => break UploadEnd::Canceled,
        }
        // The last sleep is cut to what is left of the wait, so the final attempt
        // is made as the bound passes rather than up to a delay after it.
        let delay = retry
            .delay_after(failed_attempts)
            .min(give_up_after - waited);
        tracing::warn!(
            run_id = %run_id,
            failed_attempts,
            waited_secs = waited.as_secs(),
            give_up_after_secs = give_up_after.as_secs(),
            retry_in_secs = delay.as_secs_f64(),
            already_canceled,
            error = %error,
            "the artifact store did not take the run's tree; holding it and retrying"
        );
        tokio::select! {
            () = tokio::time::sleep(delay) => {}
            () = &mut canceled => break UploadEnd::Canceled,
        }
        let result = tokio::select! {
            result = attempt() => result,
            () = &mut canceled => break UploadEnd::Canceled,
        };
        match result {
            Ok(()) => {
                tracing::info!(
                    run_id = %run_id,
                    failed_attempts,
                    waited_secs = waiting_since.elapsed().as_secs(),
                    "the artifact store took the run's tree after a wait"
                );
                wait.over(true).await;
                return Ok(());
            }
            Err(next) => {
                error = next;
                failed_attempts += 1;
                if error.kind() == UploadFailureKind::RunsOwn {
                    break UploadEnd::RunsOwn;
                }
            }
        }
    };
    // A canceled job takes no further report, so only the other endings say the
    // wait is over.
    if was_reported() && end != UploadEnd::Canceled {
        wait.over(false).await;
    }
    Err(UploadFailure {
        end,
        error: Some(error),
    })
}

/// Tar the run tree at `{out_dir}/{run_id}/` and upload it to the artifact service
/// at `artifacts_url`, presenting `job_token`, in a single attempt nobody is told
/// about. See [`upload_run_tree_with`].
pub async fn upload_run_tree(
    artifacts_url: &str,
    run_id: &str,
    job_id: &str,
    out_dir: &Path,
    job_token: &str,
) -> Result<(), UploadFailure> {
    upload_run_tree_with(
        UploadRetry::single_attempt(),
        &Unattended,
        artifacts_url,
        run_id,
        job_id,
        out_dir,
        job_token,
    )
    .await
}

/// Tar the run tree at `{out_dir}/{run_id}/` and upload it to the artifact service
/// at `artifacts_url`, presenting `job_token`. The tarball's entries are relative
/// to the run directory (so the service unpacks them under its own
/// `<store-root>/{run_id}/`), matching the layout the core resolvers read.
///
/// `run_id` is the **run/record id** — the store key the upload URL carries and the
/// console later addresses media by. `job_id` is the **job id** the per-job token
/// was minted for; the service verifies the token against it (a different UUID from
/// the run id), so it is sent in the `x-tcab-job-id` header rather than the path.
///
/// The tree is tarred once and the tarball kept on disk for every attempt, which
/// [`retry_until_stored`] makes under `retry`, reporting to `wait`. Returns `Ok`
/// once the service has acknowledged the upload (`2xx`).
pub async fn upload_run_tree_with<W: StoreWait>(
    retry: UploadRetry,
    wait: &W,
    artifacts_url: &str,
    run_id: &str,
    job_id: &str,
    out_dir: &Path,
    job_token: &str,
) -> Result<(), UploadFailure> {
    let run_dir = out_dir.join(run_id);
    let path_label = run_dir.display().to_string();
    // A tree that cannot be tarred, and a client that cannot be built, are local to
    // this driver: nothing the store does changes either.
    let own = |error| UploadFailure {
        end: UploadEnd::RunsOwn,
        error: Some(error),
    };

    // Build the tarball on DISK and stream it, rather than assembling it in memory.
    //
    // This is the driver's single largest allocation and the reason its memory
    // footprint used to be unsizeable. A run tree is bounded only by the case that
    // produced it — source, a static build, and proof/asset media — so buffering the
    // whole archive made peak driver memory a function of the heaviest case rather
    // than of the driver's own work: measured peaks ran ~475MiB against a 512Mi
    // request, i.e. right at what the node had reserved. Every other moment in a
    // driver's life costs under 10MiB.
    //
    // The timing is what makes that dangerous rather than merely untidy. This upload
    // happens AFTER the harness session has finished and BEFORE the terminal status
    // is posted, so a driver killed here loses a run that has already paid for every
    // one of its API calls — strictly the most expensive way for a run to die. Reading
    // the archive off disk a chunk at a time makes the driver's footprint a property
    // of the driver instead of the case, which is what lets its memory request be a
    // real reservation (see the dispatcher's `DEFAULT_DRIVER_MEMORY_REQUEST`; the
    // driver carries no memory limit, deliberately).
    //
    // Tarring is a blocking filesystem walk, so it runs on the blocking pool: the same
    // task is still streaming harness events and heartbeating status, and stalling the
    // reactor for the length of a large walk would starve both.
    let scratch_dir = out_dir.to_path_buf();
    let tarball = tokio::task::spawn_blocking(move || tar_run_dir(&run_dir, &scratch_dir))
        .await
        .map_err(|join| {
            own(UploadError::Tar {
                path: path_label.clone(),
                source: std::io::Error::other(join),
            })
        })?
        .map_err(|source| {
            own(UploadError::Tar {
                path: path_label.clone(),
                source,
            })
        })?;

    // One client for every attempt. The connect timeout bounds an attempt against a
    // service that is not there; there is deliberately no overall timeout, because
    // the body is as large as the run tree and a slow link is not a failure. An
    // attempt that stops moving is ended by the policy's stall timeout.
    let http = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|err| own(UploadError::Transport(err)))?;
    let url = format!("{}/runs/{}/artifacts", artifacts_url, run_id);
    let tarball = Arc::new(tarball);

    // Each attempt reads the same archive from its start, at offsets of its own. An
    // earlier attempt's body can outlive its `send` when the service answers before
    // it has read the whole of it (a full volume does exactly that), and a cursor
    // shared with it would be moved under this one.
    retry_until_stored(retry, wait, run_id, || {
        send_tarball(
            &http,
            &url,
            job_id,
            job_token,
            Arc::clone(&tarball),
            retry.stall_timeout,
        )
    })
    .await
}

/// Send one attempt of the run-tree upload: the whole of `tarball` as the body of
/// `POST {url}`, abandoned as [stalled](UploadError::Stalled) when it makes no
/// progress for `stall_timeout`.
async fn send_tarball(
    http: &reqwest::Client,
    url: &str,
    job_id: &str,
    job_token: &str,
    tarball: Arc<File>,
    stall_timeout: Duration,
) -> Result<(), UploadError> {
    // No `Content-Length`: a wrapped stream has no size hint, so reqwest frames the
    // body `chunked`. The artifact service's `DefaultBodyLimit` enforces its cap as
    // the bytes arrive either way, and declaring a length alongside a chunked body
    // would be the one framing error that could truncate an upload silently.
    let progress = Arc::new(AtomicU64::new(0));
    let body = reqwest::Body::wrap_stream(tarball_chunks(tarball, Arc::clone(&progress)));
    let attempt = async {
        let response = http
            .post(url)
            .bearer_auth(job_token)
            .header("x-tcab-job-id", job_id)
            .header(reqwest::header::CONTENT_TYPE, "application/x-tar")
            .body(body)
            .send()
            .await
            .map_err(UploadError::Transport)?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        let body = response.text().await.unwrap_or_default();
        Err(UploadError::Status { status, body })
    };
    tokio::select! {
        result = attempt => result,
        () = stalled(&progress, stall_timeout) => Err(UploadError::Stalled(stall_timeout)),
    }
}

/// The tarball as a stream of chunks, read from its first byte at explicit
/// offsets. Each chunk the connection takes is counted in `progress`.
///
/// The connection asks for a chunk only when it has room to send one, so the count
/// moves exactly as fast as the service reads. Reading at an offset leaves the
/// file's own cursor alone, so any number of these streams over one file are
/// independent.
fn tarball_chunks(
    tarball: Arc<File>,
    progress: Arc<AtomicU64>,
) -> impl futures_util::Stream<Item = std::io::Result<bytes::Bytes>> + Send + 'static {
    futures_util::stream::try_unfold(0u64, move |offset| {
        let tarball = Arc::clone(&tarball);
        let progress = Arc::clone(&progress);
        async move {
            // A blocking read, so it runs on the blocking pool like the tar walk.
            let chunk = tokio::task::spawn_blocking(move || read_chunk_at(&tarball, offset))
                .await
                .map_err(std::io::Error::other)??;
            if chunk.is_empty() {
                return Ok(None);
            }
            progress.fetch_add(1, Ordering::Relaxed);
            let next = offset + chunk.len() as u64;
            Ok(Some((bytes::Bytes::from(chunk), next)))
        }
    })
}

/// Read up to [`TARBALL_CHUNK`] bytes of `file` at `offset`. Empty at its end.
fn read_chunk_at(file: &File, offset: u64) -> std::io::Result<Vec<u8>> {
    let mut chunk = vec![0u8; TARBALL_CHUNK];
    #[cfg(unix)]
    let read = std::os::unix::fs::FileExt::read_at(file, &mut chunk, offset)?;
    #[cfg(windows)]
    let read = std::os::windows::fs::FileExt::seek_read(file, &mut chunk, offset)?;
    chunk.truncate(read);
    Ok(chunk)
}

/// Resolve once `progress` has stood still for a whole `limit`. Never resolves
/// with a zero `limit`.
async fn stalled(progress: &AtomicU64, limit: Duration) {
    if limit.is_zero() {
        return std::future::pending().await;
    }
    let mut seen = progress.load(Ordering::Relaxed);
    loop {
        tokio::time::sleep(limit).await;
        let now = progress.load(Ordering::Relaxed);
        if now == seen {
            return;
        }
        seen = now;
    }
}

/// What became of a run's tree: what [`store_run_tree`] returns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TreeStore {
    /// No artifact service is configured, so nothing was uploaded.
    NoService,
    /// The service acknowledged the tree.
    Stored,
    /// The upload ended without the tree stored.
    NotStored {
        /// How the upload ended.
        end: UploadEnd,
        /// The upload's last failure, when it was a condition of the store rather
        /// than the run's own ([`UploadFailure::store_fault`]).
        store_fault: Option<String>,
    },
}

impl TreeStore {
    /// What the terminal status report carries as
    /// [`artifacts_stored`](test_cabinet_core::StatusUpdate::artifacts_stored):
    /// absent with no artifact service, else whether the tree landed.
    pub fn artifacts_stored(&self) -> Option<bool> {
        match self {
            Self::NoService => None,
            Self::Stored => Some(true),
            Self::NotStored { .. } => Some(false),
        }
    }

    /// What the terminal status report carries as
    /// [`store_fault`](test_cabinet_core::StatusUpdate::store_fault): why the tree
    /// was not stored, when the store was the cause.
    pub fn store_fault(&self) -> Option<&str> {
        match self {
            Self::NotStored { store_fault, .. } => store_fault.as_deref(),
            Self::NoService | Self::Stored => None,
        }
    }

    /// Whether the run was canceled while its tree was being uploaded. The job is
    /// then terminally `canceled`, and `canceled` is the only status the backend
    /// still takes for it.
    pub fn canceled_during_upload(&self) -> bool {
        matches!(
            self,
            Self::NotStored {
                end: UploadEnd::Canceled,
                ..
            }
        )
    }

    /// Whether the run's terminal report is `canceled` rather than the outcome the
    /// run reached: the run itself was canceled (`run_canceled`), or its upload
    /// was. Either way the job is terminally `canceled`, and a `succeeded` or
    /// `failed` report would be discarded with the record it carries.
    pub fn reports_canceled(&self, run_canceled: bool) -> bool {
        run_canceled || self.canceled_during_upload()
    }
}

/// Upload the produced run tree to the artifact service and, once the service has
/// acknowledged it, stamp the run's playable-build link onto `record`.
///
/// - [`TreeStore::NoService`] when `artifacts_url` is `None` (a local setup with no
///   artifact service): nothing is uploaded and the record carries no playable link.
/// - [`TreeStore::Stored`] when the tree landed. The link is set root-relative
///   (`/runs/{id}/build/`), and only when the run produced a static build to serve.
/// - [`TreeStore::NotStored`] when the upload ended without it: the failure was the
///   run's own, the store did not take the tree for the whole of `retry`'s wait, or
///   the run was canceled during the upload. The failure is logged at `error` with
///   the service's last status and body, and the link is left off the record: a
///   link nothing serves would offer a build that is not there.
///
/// A tree that is not stored never changes the run's outcome. The record still
/// reaches the backend with the state the run reached; what is lost is the tree,
/// and the backend is told so rather than left to discover it at publish.
pub async fn store_run_tree<W: StoreWait>(
    retry: UploadRetry,
    wait: &W,
    artifacts_url: Option<&str>,
    record: &mut RunRecord,
    job_id: &str,
    out_dir: &Path,
    job_token: &str,
) -> TreeStore {
    let Some(artifacts_url) = artifacts_url else {
        return TreeStore::NoService;
    };
    match upload_run_tree_with(
        retry,
        wait,
        artifacts_url,
        &record.id,
        job_id,
        out_dir,
        job_token,
    )
    .await
    {
        Ok(()) => {
            if let Some(link) = playable_build_link(out_dir, &record.id) {
                record.links.playable_build = Some(link);
            }
            tracing::info!(run_id = %record.id, "uploaded run artifacts to the artifact service");
            TreeStore::Stored
        }
        Err(failure) => {
            let (status, body) = match &failure.error {
                Some(UploadError::Status { status, body }) => (Some(status.as_u16()), body.trim()),
                Some(
                    UploadError::Tar { .. } | UploadError::Transport(_) | UploadError::Stalled(_),
                )
                | None => (None, ""),
            };
            tracing::error!(
                run_id = %record.id,
                status,
                body,
                end = ?failure.end,
                error = %failure,
                "could not store the run's artifact tree; the run is reported with its \
                 own outcome, but it has no tree to play or publish"
            );
            TreeStore::NotStored {
                end: failure.end,
                store_fault: failure.store_fault(),
            }
        }
    }
}

/// Upload an adversarial run's controller wasm and proof replays to the **backend
/// store**, keyed by run id — the backend-driven mirror of the CLI push
/// (`BackendPublisher::upload_adversarial`).
///
/// The backend store is a different place from the artifact service. The arena
/// lists a run's controller as pittable only when the backend holds its
/// `runs/{id}/controller.wasm` (`GET /adversarial/controllers`), and the console
/// fetches a run's proof replays from the backend's `/runs/{id}/asset/{file}`
/// whenever that run was not produced in the *open* console session (the artifact
/// service only serves session-local runs). The CLI uploads both at push from its
/// local `repo_path`; a backend-driven run has no console-side repo to push from, so
/// without this its controller never appears in the arena (Quick Match /
/// tournaments) and its replays 404 on playback (surfacing as "foray-core rejected
/// the replay" once the 404 body is parsed). The files are read from the produced
/// tree the driver still holds at `{out_dir}/{id}/implementation/`.
///
/// Best-effort and driven purely off the produced record: a no-op for a
/// non-adversarial run, and for a forfeit-before-load that emitted no controller and
/// no replays. The backend upload routes are ungated on the private network, so the
/// client carries no token. An individual missing file is skipped (the run is still
/// inspectable); a rejected upload is surfaced so the caller can log it.
pub async fn upload_adversarial_to_backend(
    backend_url: &str,
    record: &RunRecord,
    out_dir: &Path,
) -> test_cabinet_core::Result<()> {
    let Some(adversarial) = record.validation.adversarial.as_ref() else {
        return Ok(());
    };
    let impl_dir = out_dir.join(&record.id).join("implementation");
    let client = HttpBackendClient::new(backend_url);

    // The controller wasm first. It is the artifact the arena gates a run's
    // pushed-controller listing on (`has_run_controller`), so it must land even if a
    // later — and much larger — replay upload fails; uploading it ahead of the
    // replays keeps a completed run visible in Quick Match / tournaments regardless.
    // A forfeit-before-load run records an empty module path and has nothing to
    // upload.
    if !adversarial.controller_module.is_empty()
        && let Ok(bytes) = std::fs::read(impl_dir.join(&adversarial.controller_module))
    {
        client.publish_run_controller(&record.id, bytes).await?;
    }

    // Then each opponent's replay, stored under its own run-root-relative filename
    // (`replay.json`, `replay-1.json`, …), matching the CLI push and the
    // `playable::serve_asset_file` the backend serves them back through.
    for replay in &adversarial.replays {
        let Ok(bytes) = std::fs::read(impl_dir.join(&replay.replay_json)) else {
            continue;
        };
        client
            .publish_run_asset(&record.id, &replay.replay_json, bytes)
            .await?;
    }
    Ok(())
}

/// Upload a performance run's scored scenarios to the **backend store**, keyed by
/// run id — the performance counterpart to [`upload_adversarial_to_backend`].
///
/// Browser playback fetches a run's scenario from the backend's
/// `/runs/{id}/asset/{file}` and re-simulates it to reconstruct the factory the run
/// was graded on. As with adversarial replays, the artifact service only serves
/// runs produced in the *open* console session, so without this mirror a
/// backend-driven run's scenario 404s and playback has nothing to load.
///
/// Best-effort and driven purely off the produced record: a no-op for a
/// non-performance run, and for any case the engine got wrong (which records no
/// scenario, because playback is offered only for a passing run). An individual
/// missing file is skipped; a rejected upload is surfaced so the caller can log it.
pub async fn upload_performance_to_backend(
    backend_url: &str,
    record: &RunRecord,
    out_dir: &Path,
) -> test_cabinet_core::Result<()> {
    let Some(performance) = record.validation.performance.as_ref() else {
        return Ok(());
    };
    let impl_dir = out_dir.join(&record.id).join("implementation");
    let client = HttpBackendClient::new(backend_url);

    // Each passing case's scenario, under its own run-root-relative filename,
    // matching `playable::serve_asset_file`'s `scenario`/`scenario-<i>` addressing.
    for case in &performance.cases {
        let Some(scenario_json) = case.scenario_json.as_deref() else {
            continue;
        };
        let Ok(bytes) = std::fs::read(impl_dir.join(scenario_json)) else {
            continue;
        };
        client
            .publish_run_asset(&record.id, scenario_json, bytes)
            .await?;
    }

    // The run's own engine module, so the console's browser playback can load and
    // step it — the same wasm that graded every case. It is published under its
    // run-level `module_wasm` filename (`engine.wasm`) and served exactly like a
    // scenario; without this upload the console's module URL 404s and playback
    // cannot start. A missing module (the build emitted none) is simply skipped.
    if let Some(module_wasm) = performance.module_wasm.as_deref()
        && let Ok(bytes) = std::fs::read(impl_dir.join(module_wasm))
    {
        client
            .publish_run_asset(&record.id, module_wasm, bytes)
            .await?;
    }
    Ok(())
}

/// Mirror a run's proof-of-implementation media into the **backend store**, keyed by
/// run id — the backend-driven counterpart to the artifact-service tarball upload.
///
/// The backend store is a different place from the artifact service. The artifact
/// service serves a run's proof to the *open* console session it was produced in;
/// but the public static site (and any other host) reads proof from the snapshot
/// the backend exports out of **its own store** (`snapshot::run_proofs` →
/// `store::list_run_proofs`). Nothing else writes that store's `runs/{id}/proof/`
/// dir, so without this a backend-driven run's proof never reaches the snapshot and
/// the published site renders "Proof media is not available here." for every
/// declared proof.
///
/// Each present proof is read from the produced tree at
/// `{out_dir}/{id}/implementation/<dest>` and uploaded under the served file name
/// `<proof-id>.<ext>` — the same `<proof-id>.<ext>` spelling `playable::serve_proof_file`
/// serves and the gallery's `proofMediaUrl` requests, so the snapshot key matches the
/// UI lookup. The extension is derived from the proof's `dest` exactly as the UI's
/// `extensionFor` does (defaulting to `png`); it is cosmetic, since the backend
/// resolves the file by its proof-id stem.
///
/// Best-effort and driven purely off the produced record: a no-op for a run that
/// declares no proofs, and skips any proof the agent did not produce or whose file is
/// unreadable. The backend upload route is ungated on the private network, so the
/// client carries no token. A rejected upload is surfaced so the caller can log it.
pub async fn upload_proofs_to_backend(
    backend_url: &str,
    record: &RunRecord,
    out_dir: &Path,
) -> test_cabinet_core::Result<()> {
    let impl_dir = out_dir.join(&record.id).join("implementation");
    let client = HttpBackendClient::new(backend_url);

    for proof in &record.validation.proofs {
        if !proof.present {
            continue;
        }
        let Ok(bytes) = std::fs::read(impl_dir.join(&proof.dest)) else {
            continue;
        };
        let file = format!(
            "{}.{}",
            proof.id,
            test_cabinet_core::proof_served_extension(&proof.dest),
        );
        client.publish_run_proof(&record.id, &file, bytes).await?;
    }
    Ok(())
}

/// Mirror a run's synthesized *actual* validation media into the **backend store**,
/// keyed by run id — the automated-validation counterpart to
/// [`upload_proofs_to_backend`], for the same reason.
///
/// The public snapshot reads a run's *actual* validation media (the model build's
/// per-review-item debug-script outputs) from the backend store
/// (`snapshot::run_validation_media` → `store::read_run_validation`), and nothing else
/// writes that store's `runs/{id}/validation/` dir for a backend-driven run. Without
/// this mirror a backend-driven run's synthesized media never reaches the snapshot and
/// the published site degrades the reviewer's side-by-side to presence-only.
///
/// Each present output is read from the produced tree at
/// `{out_dir}/{id}/implementation/.vendor/validation/<item>__<output>.<ext>` — the flat
/// [`validation_media_name`](test_cabinet_core::validation_media_name) spelling
/// `playable::serve_validation_file` serves and the gallery requests — and uploaded
/// under that same name, so the snapshot key matches the UI lookup. The captured
/// video is the `.webm` Playwright records; the snapshot transcodes it to `.mp4` at
/// publish (as it does a video proof), so what is mirrored here stays the raw webm.
///
/// The recordings' **shared image store** (`img.<id>.png` / `img.<id>.bin` — see
/// [`VALIDATION_IMAGE_PREFIX`](test_cabinet_core::VALIDATION_IMAGE_PREFIX)) is
/// mirrored too, and is the one thing here that is *not* driven off the record: a
/// store file backs no verdict and is named by its own bytes, so it appears on no
/// output declaration and is enumerated off the directory instead. Without it the
/// published replays resolve nothing and draw holes where their sprites were.
///
/// Best-effort and driven off the produced record (plus that one directory listing):
/// a no-op for a run that declares no debug scripts, and skips any output the build
/// did not produce or whose file is unreadable. The backend upload route is ungated
/// on the private network, so the client carries no token. A rejected upload is
/// surfaced so the caller can log it.
pub async fn upload_validation_to_backend(
    backend_url: &str,
    record: &RunRecord,
    out_dir: &Path,
) -> test_cabinet_core::Result<()> {
    let validation_dir = out_dir
        .join(&record.id)
        .join("implementation")
        .join(".vendor")
        .join("validation");
    let client = HttpBackendClient::new(backend_url);

    for script in &record.validation.debug_scripts {
        // The verdict id keys this script's media — the item's own id, or the composite
        // `<item>.<sub>` for a per-sub-item driver.
        let verdict_id = match &script.sub_item_id {
            Some(sub) => test_cabinet_core::ReviewItem::sub_item_verdict_id(&script.item_id, sub),
            None => script.item_id.clone(),
        };
        for output in &script.outputs {
            if !output.actual_present {
                continue;
            }
            let file =
                test_cabinet_core::validation_media_name(&verdict_id, &output.id, output.kind);
            let Ok(bytes) = std::fs::read(validation_dir.join(&file)) else {
                continue;
            };
            client
                .publish_run_validation(&record.id, &file, bytes)
                .await?;
        }
    }

    // The recordings' shared image store travels with them, or the published replays
    // draw holes where their sprites were. It cannot be driven off the record like
    // everything above: a store file backs no verdict and is named by its own bytes,
    // so it is on no output declaration and is enumerated off the directory instead
    // (`is_validation_image_name` is the one place that judgement lives). Same
    // best-effort stance as the declared outputs — an unreadable entry is skipped
    // rather than failing the mirror.
    if let Ok(read) = std::fs::read_dir(&validation_dir) {
        for entry in read.flatten() {
            let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            if !test_cabinet_core::is_validation_image_name(&name) {
                continue;
            }
            let Ok(bytes) = std::fs::read(entry.path()) else {
                continue;
            };
            client
                .publish_run_validation(&record.id, &name, bytes)
                .await?;
        }
    }
    Ok(())
}

/// Mirror a gg run's session record into the **backend store**, keyed by run id — the debug-only
/// counterpart to [`upload_validation_to_backend`], for the same reason.
///
/// A gg run streams every model call it makes into a journal that the host folds into
/// [`{out_dir}/{id}/replay.json.gz`](test_cabinet_core::gg_session_assembly::GG_SESSION_TREE_ARTIFACT)
/// at the [post-run seam](test_cabinet_core::post_run) — at the **run tree's root**, not inside
/// `implementation/`, which is a verbatim copy of what the model produced. (The `replay` in those
/// paths is an
/// [address](test_cabinet_core::gg_session_record), not a name.) Nothing else writes the backend
/// store's `runs/{id}/replay.json` for a backend-driven run, so without this mirror the record
/// never reaches `GET /runs/{id}/replay` and a run's session is readable only from whatever host
/// still has its tree.
///
/// The gzipped bytes are uploaded **as they are**: the store keeps run-tree artifacts opaque and the
/// serving route content-negotiates on the request's `Accept-Encoding`, so decompressing here would
/// only cost the transfer and be re-done on the way out.
///
/// Best-effort: a no-op for a run with no assembled record (a third-party-harness run, or a gg run
/// whose journal never reached the host), and reads it straight off the produced tree. The backend
/// upload route is ungated on the private network, so the client carries no token. A rejected upload
/// is surfaced so the caller can log it.
pub async fn upload_replay_to_backend(
    backend_url: &str,
    record: &RunRecord,
    out_dir: &Path,
) -> test_cabinet_core::Result<()> {
    let replay_path = out_dir
        .join(&record.id)
        .join(test_cabinet_core::gg_session_assembly::GG_SESSION_TREE_ARTIFACT);
    let Ok(bytes) = std::fs::read(&replay_path) else {
        // No assembled record (a non-gg run, or a gg run whose journal never reached the host)
        // — nothing to mirror.
        return Ok(());
    };
    HttpBackendClient::new(backend_url)
        .publish_run_replay(&record.id, bytes)
        .await
}

/// Mirror a run's **code-analysis document** into the backend store, keyed by run id — the
/// analyzer's counterpart to [`upload_replay_to_backend`], for the same reason and by the same
/// convention.
///
/// The post-run stage writes the unbounded document to
/// [`{out_dir}/{id}/code-analysis.json.gz`](test_cabinet_core::CODE_ANALYSIS_TREE_ARTIFACT) at the
/// run tree's **root**, and its bounded summary rides on the record. Nothing else writes the
/// backend store's `runs/{id}/code-analysis.json` for a backend-driven run, so without this mirror
/// the document never reaches `GET /runs/{id}/code-analysis` and the per-run Code tab has only the
/// summary to show — no file explorer, no symbol table, no cycles.
///
/// Applies to **every** harness, unlike the replay mirror: the analysis is harness-agnostic.
///
/// The gzipped bytes are uploaded as they are, for the same reason the session record's are: the
/// store keeps run-tree artifacts opaque and the serving route content-negotiates, so decompressing
/// here would only cost the transfer and be re-done on the way out.
///
/// Best-effort: a no-op for a run with no document (a run collected before the analyzer shipped, or
/// one whose tree never reached the host). A rejected upload is surfaced so the caller can log it.
pub async fn upload_code_analysis_to_backend(
    backend_url: &str,
    record: &RunRecord,
    out_dir: &Path,
) -> test_cabinet_core::Result<()> {
    let path = out_dir
        .join(&record.id)
        .join(test_cabinet_core::CODE_ANALYSIS_TREE_ARTIFACT);
    let Ok(bytes) = std::fs::read(&path) else {
        // No analysis for this run — nothing to mirror.
        return Ok(());
    };
    HttpBackendClient::new(backend_url)
        .publish_run_code_analysis(&record.id, bytes)
        .await
}

/// Mirror an asset-generation run's media into the **backend store**, keyed by run
/// id — the asset-gen counterpart to [`upload_proofs_to_backend`], for the same
/// reason: the public snapshot reads a run's asset media from the backend store
/// (`snapshot::run_assets` → `store::read_run_asset`), and nothing else writes that
/// store's `runs/{id}/asset/` dir for an asset-generation run. Without this mirror a
/// backend-driven sprite/sheet run's regenerated image, preview, and action log
/// never reach the snapshot and the published site's asset result view has no media
/// to show.
///
/// Each artifact is read from the produced tree at
/// `{out_dir}/{id}/implementation/<recorded path>` and uploaded under the served
/// names the result view requests — a single sprite's bare
/// `regenerated.png`/`preview.png`/`actions.json` (its one frame), or a sprite
/// sheet's per-frame `regenerated-<index>.png`/`preview-<index>.png`/`actions-<index>.json`
/// — matching `playable::serve_asset_file` and the snapshot exactly so the keys line
/// up with the UI lookup. A voxel run mirrors the same way but carries no
/// regenerated PNG (cheat detection is retired for voxel): each part uploads its
/// `preview.png`/`actions.json` and the per-part `.glb` the 3D client renders (bare
/// for a static model, `mesh-<index>.glb` per part for an animated one).
///
/// A no-op for any non-asset-generation run (an adversarial run's replays are
/// mirrored by [`upload_adversarial_to_backend`] instead). Best-effort: an
/// artifact missing from disk is skipped (the run is still inspectable); a rejected
/// upload is surfaced so the caller can log it. The backend upload route is ungated
/// on the private network, so the client carries no token.
pub async fn upload_assets_to_backend(
    backend_url: &str,
    record: &RunRecord,
    out_dir: &Path,
) -> test_cabinet_core::Result<()> {
    let impl_dir = out_dir.join(&record.id).join("implementation");
    let client = HttpBackendClient::new(backend_url);

    if let Some(asset) = record.validation.asset.as_ref() {
        // A single sprite serves under bare names; a sheet suffixes each frame with
        // `-<index>`, matching `playable::serve_asset_file` and the snapshot.
        let is_sheet = asset.sheet.is_some();
        for frame in &asset.frames {
            let suffix = if is_sheet {
                format!("-{}", frame.index)
            } else {
                String::new()
            };
            let artifacts = [
                (format!("regenerated{suffix}.png"), &frame.regenerated_image),
                (format!("preview{suffix}.png"), &frame.preview_image),
                (format!("actions{suffix}.json"), &frame.actions_log),
            ];
            for (served, rel) in artifacts {
                let Ok(bytes) = std::fs::read(impl_dir.join(rel)) else {
                    continue;
                };
                client.publish_run_asset(&record.id, &served, bytes).await?;
            }
        }
    } else if let Some(voxel) = record.validation.voxel.as_ref() {
        // A voxel run mirrors its parts the same flat way: a static model under
        // bare names (its one part), an animated model suffixing each part with its
        // `-<index>` in declared order — matching `playable::serve_asset_file` and
        // the snapshot. The per-part `.glb` is the geometry the 3D client renders.
        let animated = voxel.model.is_some() || voxel.rig.is_some();
        for (index, part) in voxel.parts.iter().enumerate() {
            let suffix = if animated {
                format!("-{index}")
            } else {
                String::new()
            };
            let artifacts = [
                (format!("preview{suffix}.png"), &part.preview_image),
                (format!("actions{suffix}.json"), &part.ops_log),
                (format!("mesh{suffix}.glb"), &part.mesh),
            ];
            for (served, rel) in artifacts {
                let Ok(bytes) = std::fs::read(impl_dir.join(rel)) else {
                    continue;
                };
                client.publish_run_asset(&record.id, &served, bytes).await?;
            }
        }
    } else if let Some(ui) = record.validation.ui.as_ref() {
        // A UI run mirrors its flattened per-element PNG(s) — single-image under the
        // bare `element.png`, a kit suffixing each element with `-<index>` — plus the
        // `ui.json` manifest (served name == on-disk name). Matches
        // `playable::serve_asset_file` and the snapshot.
        let is_kit = ui.elements.len() > 1;
        let mut artifacts: Vec<(String, String)> =
            vec![("ui.json".to_string(), "ui.json".to_string())];
        for (index, element) in ui.elements.iter().enumerate() {
            let suffix = if is_kit {
                format!("-{index}")
            } else {
                String::new()
            };
            artifacts.push((format!("element{suffix}.png"), element.image.clone()));
        }
        publish_artifacts(&client, &record.id, &impl_dir, artifacts).await?;
    } else if let Some(material) = record.validation.material.as_ref() {
        let mut artifacts: Vec<(String, String)> =
            vec![("material.json".to_string(), "material.json".to_string())];
        for (index, map) in material.maps.iter().enumerate() {
            artifacts.push((format!("map-{index}.png"), map.image.clone()));
        }
        publish_artifacts(&client, &record.id, &impl_dir, artifacts).await?;
    } else if let Some(particle) = record.validation.particle.as_ref() {
        let mut artifacts: Vec<(String, String)> =
            vec![("system.json".to_string(), particle.system.clone())];
        if let Some(preview) = &particle.preview {
            artifacts.push(("preview.gif".to_string(), preview.clone()));
        }
        publish_artifacts(&client, &record.id, &impl_dir, artifacts).await?;
    } else if let Some(audio) = record.validation.audio.as_ref() {
        let mut artifacts: Vec<(String, String)> =
            vec![("clip.wav".to_string(), audio.clip.clone())];
        if let Some(midi) = &audio.midi {
            artifacts.push(("score.mid".to_string(), midi.clone()));
        }
        if let Some(preview) = &audio.preview {
            artifacts.push(("preview.png".to_string(), preview.clone()));
        }
        publish_artifacts(&client, &record.id, &impl_dir, artifacts).await?;
    }
    Ok(())
}

/// Mirror a run's [showcase](test_cabinet_core::RunShowcase) files into the
/// **backend store**, keyed by run id — the showcase counterpart to
/// [`upload_proofs_to_backend`], for the same reason: the public snapshot reads a
/// run's showcase media from the backend store (`snapshot::run_showcase` →
/// `store::read_run_showcase`), and nothing else writes that store's
/// `runs/{id}/showcase/` dir for a backend-driven run. Without this mirror a
/// showcase's carousel media never reach the snapshot and the published Play tab
/// has only the description text (which rides the record) to show.
///
/// Every file in the produced tree's `implementation/showcase/` uploads under its
/// own name **except `showcase.toml`** — the manifest is capture-side input,
/// already folded into the record's carousel. The description's `showcase.md` text
/// also rides the record, but the file uploads anyway: an image the description
/// references by bare relative path must be served per run even when the carousel
/// does not list it, which is why the upload takes the whole directory rather than
/// the carousel — and taking the directory whole keeps the mirror in lockstep with
/// `playable::serve_showcase_file`, which serves the same namespace from the tree.
/// A file over the capture's media cap
/// ([`test_cabinet_core::MAX_SHOWCASE_MEDIA_FILE_BYTES`]) is skipped: the capture
/// already refused to record it, so shipping it would bloat every store downstream
/// for a file nothing references.
///
/// A no-op for a run whose record carries no showcase — the files serve no one
/// without the record's description and carousel. Best-effort: an unreadable file
/// is skipped (the run is still inspectable); a rejected upload is surfaced so the
/// caller can log it. The backend upload route is ungated on the private network,
/// so the client carries no token.
pub async fn upload_showcase_to_backend(
    backend_url: &str,
    record: &RunRecord,
    out_dir: &Path,
) -> test_cabinet_core::Result<()> {
    if record.showcase.is_none() {
        return Ok(());
    }
    let dir = out_dir
        .join(&record.id)
        .join("implementation")
        .join("showcase");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        // The record captured a showcase but the tree no longer holds the dir —
        // nothing to mirror.
        return Ok(());
    };
    let client = HttpBackendClient::new(backend_url);
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() {
            continue;
        }
        let Some(file) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if file == "showcase.toml" {
            continue;
        }
        if entry
            .metadata()
            .is_ok_and(|m| m.len() > test_cabinet_core::MAX_SHOWCASE_MEDIA_FILE_BYTES)
        {
            continue;
        }
        let Ok(bytes) = std::fs::read(entry.path()) else {
            continue;
        };
        client
            .publish_run_showcase(&record.id, &file, bytes)
            .await?;
    }
    Ok(())
}

/// Publish a list of `(served-name, run-root-relative on-disk path)` artifacts,
/// skipping any that are missing on disk. Shared by the UI/material/particle/audio
/// mirror branches, whose served name and on-disk `rel` differ.
async fn publish_artifacts(
    client: &HttpBackendClient,
    run_id: &str,
    impl_dir: &Path,
    artifacts: Vec<(String, String)>,
) -> test_cabinet_core::Result<()> {
    for (served, rel) in artifacts {
        let Ok(bytes) = std::fs::read(impl_dir.join(&rel)) else {
            continue;
        };
        client.publish_run_asset(run_id, &served, bytes).await?;
    }
    Ok(())
}

/// Tar `run_dir` into a temporary file on `scratch_dir`, with every entry path
/// relative to `run_dir` itself (so the archive root *is* the run directory's
/// contents). The whole tree is walked: `run-record.json`, the `implementation/`
/// build/media, and the `events.jsonl`/`raw.jsonl` logs when present. The returned
/// file is rewound, ready for the upload to read from the start.
///
/// `scratch_dir` is the driver's own out-dir rather than the system temp dir, for
/// two reasons: it is the volume already sized to hold a run tree, and it is the
/// same filesystem as `run_dir`, so the archive cannot fail halfway on a `/tmp` that
/// turns out to be a small tmpfs — which, being memory-backed, would also reinstate
/// the very allocation writing to disk exists to avoid.
///
/// The file is created via `tempfile_in`, so it has **no directory entry**: the
/// kernel reclaims it when the last descriptor closes, including when the driver is
/// killed mid-upload. Nothing is left behind for a later run to trip over, and there
/// is no cleanup path that has to be remembered on the error branches.
fn tar_run_dir(run_dir: &Path, scratch_dir: &Path) -> Result<File, std::io::Error> {
    let mut file = tempfile::tempfile_in(scratch_dir)?;
    {
        let mut builder = tar::Builder::new(&mut file);
        // `append_dir_all("", run_dir)` archives the directory's *contents* at the
        // archive root (an empty prefix), which is exactly the relative layout the
        // service untars under `<store-root>/{id}/`.
        builder.append_dir_all("", run_dir)?;
        // Write the end-of-archive trailer before the borrow ends; without it the
        // service sees a truncated tar.
        builder.finish()?;
    }
    // `append_dir_all` left the cursor at the end of the archive.
    file.rewind()?;
    Ok(file)
}

/// The root-relative playable-build link for a produced run, when its collected
/// implementation contains a static build. Mirrors what the worker set at list
/// time (`/runs/{id}/build/`): root-relative, so the console prefixes the artifact
/// service base URL it learned from the backend's `/config`. `None` when the run
/// produced no static build (it has nothing to play).
pub fn playable_build_link(out_dir: &Path, run_id: &str) -> Option<String> {
    let impl_dir = out_dir.join(run_id).join("implementation");
    find_build_output(&impl_dir)
        .is_some()
        .then(|| format!("/runs/{run_id}/build/"))
}

#[cfg(test)]
#[path = "artifacts.test.rs"]
mod tests;

#[cfg(test)]
#[path = "artifacts.tarball.test.rs"]
mod tarball_tests;

#[cfg(test)]
#[path = "artifacts.retry.test.rs"]
mod retry_tests;

#[cfg(test)]
#[path = "artifacts.runwait.test.rs"]
mod runwait_tests;

#[cfg(test)]
#[path = "artifacts.wait.test.rs"]
mod wait_tests;
