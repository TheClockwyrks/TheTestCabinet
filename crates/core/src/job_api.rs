//! The job-API wire types shared between the backend, the dispatcher, and the
//! driver.
//!
//! These are the request/response shapes of the backend's run-queue control
//! plane that more than one component speaks. They live here, in `core`, rather
//! than in the backend crate so the driver and dispatcher — both clients of the
//! backend's job API — can name them without depending on the heavy backend
//! crate (and its SeaORM/SQLite footprint). The backend imports them from here
//! for its server side.
//!
//! Only the types crossing a crate boundary live here:
//!
//! - [`LaunchBody`] — the body of `POST /jobs`, stored verbatim at enqueue and
//!   handed back to the driver when the dispatcher claims the job.
//! - [`ClaimedJob`] — what the dispatcher receives from `POST /jobs/next`.
//! - [`StatusUpdate`] / [`DriverState`] — the body of `POST /jobs/{id}/status`,
//!   how the driver advances a job and hands back the record it produced.
//! - [`LaunchAck`] / [`JobState`] / [`ActiveJobOut`] / [`JobStatusOut`] /
//!   [`JobSummary`] / [`Notification`] — the backend's run-queue **output**
//!   shapes. The backend constructs them on its server side (re-exporting them
//!   from here so its handlers and the `contract-codegen` generator keep naming
//!   them under `backend::api` / `backend::relay`); a Rust client of the queue
//!   (the CLI / Tauri shell, mirroring the web console's TypeScript transport)
//!   deserializes them. They live here so both sides share one definition.
//!
//! The contract `cfg_attr` derives are preserved so the `contract-codegen`
//! generator still emits these types' TypeScript bindings and JSON Schemas from
//! here once the console is rewired (the bindings are deferred to that pass).

use serde::{Deserialize, Serialize};

use crate::run_record::{HarnessSlug, RunRecord};

/// The body of `POST /jobs`: what to run, with what, against which model. The
/// canonical launch shape — stored verbatim and handed to the driver when the job
/// is claimed.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LaunchBody {
    /// Test-case slug to run (e.g. `carom`).
    pub test_case: String,
    /// Exact, immutable test-case version (e.g. `v1.0.0`).
    pub version: String,
    /// Variant to run (e.g. `base`).
    pub variant: String,
    /// Agent harness to drive.
    pub harness: HarnessSlug,
    /// Opaque model id passed to the harness.
    pub model: String,
    /// Built-in orchestrator slug that conducts the harness sessions (e.g.
    /// `one-shot` or `ralph`). Omit for the `one-shot` default.
    #[serde(default)]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub orchestrator: Option<String>,
    /// Optional override for the maximum harness runtime, in seconds.
    #[serde(default)]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub max_runtime_seconds: Option<u64>,
    /// Optional harness authentication mode for this run (`auto`, `subscription`,
    /// or `api-key`). Omitted keeps the default behavior (API-key, preferring a
    /// subscription only when its credentials are available). The driver applies
    /// it by setting `TCAB_AUTH_MODE` before the engine resolves auth, so a console
    /// can request subscription mode for a backend-driven run (the only way to run
    /// the subscription-only Antigravity harness on the cluster path).
    #[serde(default)]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub auth_mode: Option<String>,
    /// How many times to automatically retry this run after a terminal failure the
    /// Test Cabinet (or a catastrophic build) is responsible for — an
    /// [`Infrastructure`](crate::run_record::RunState::Infrastructure) error or a
    /// [`Catastrophic`](crate::run_record::RunState::Catastrophic) build. A
    /// [`TimedOut`](crate::run_record::RunState::TimedOut) or
    /// [`Completed`](crate::run_record::RunState::Completed) outcome is the model's,
    /// not a fault to retry, and a user cancel is never retried.
    ///
    /// The default is `1` (one retry) when omitted, so the total attempts allowed is
    /// `1 + retry_count`: the initial attempt plus up to `retry_count` retries.
    /// `0` disables retries; the backend clamps the value to a sane maximum. This is
    /// the field the run form sends; absent → treated as `1` by the backend.
    #[serde(default)]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub retry_count: Option<u32>,
}

/// The claimed job the dispatcher receives from `POST /jobs/next`: the id, the
/// per-job driver token, and the launch request to run.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ClaimedJob {
    /// The claimed job's id.
    pub job_id: String,
    /// The per-job token the driver presents to stream this job's progress back.
    pub job_token: String,
    /// The launch request to run.
    pub request: LaunchBody,
}

/// The state a driver reports for a job via `POST /jobs/{id}/status`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum DriverState {
    /// The driver pod has come up and is running the pre-run setup (connecting to
    /// the container runtime, materializing the served definition) — the run is not
    /// yet executing the harness, but it will as soon as setup finishes.
    Starting,
    /// Execution has begun.
    Running,
    /// The run produced a record (carried in the same update).
    Succeeded,
    /// The run could not be driven to a record (reason in `detail`).
    Failed,
}

/// The body of `POST /jobs/{id}/status`: the new driver state, plus the produced
/// record on success or the reason on failure.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct StatusUpdate {
    /// The state the driver is reporting.
    pub state: DriverState,
    /// The produced run record, required when `state` is `succeeded`. Its `links`
    /// are authoritative and stored with it.
    #[serde(default)]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub record: Option<RunRecord>,
    /// A human-readable failure reason, used when `state` is `failed`.
    #[serde(default)]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub detail: Option<String>,
}

/// The response to a successful `POST /jobs`: the enqueued job's id and where to
/// observe it. The backend constructs it; a queue client reads `job_id` to begin
/// watching the run (and may reconstruct the status/live URLs from it).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LaunchAck {
    /// The id of the enqueued job.
    pub job_id: String,
    /// Where to poll the job's status.
    pub status_url: String,
    /// Where to stream the job's live progress (NDJSON).
    pub live_url: String,
}

/// The body of `POST /jobs/batch`: many launch requests to enqueue in one call.
/// Each entry is the same shape as a single `POST /jobs` body, so the two enqueue
/// paths never drift on what a run request carries. The batch analogue of a single
/// [`LaunchBody`] — used when a console fans a whole set of runs out at once (the
/// coverage matrix's still-missing runs, the new-run form's combinations × runs).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LaunchBatchBody {
    /// The runs to enqueue, in the order the caller wants them reported back.
    pub runs: Vec<LaunchBody>,
}

/// One entry in a batch launch's response, aligned by index to the request's
/// `runs`. Carries the enqueued job id on success, or a human-readable reason for a
/// run that could not be enqueued — a single rejected run (e.g. a malformed request)
/// never aborts the rest of the batch, mirroring the per-item isolation the console
/// had when it launched runs one request at a time.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LaunchBatchItem {
    /// The enqueued job's id, present when this run was accepted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub job_id: Option<String>,
    /// Why this run was rejected, present when it was not enqueued.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub error: Option<String>,
}

/// The response to `POST /jobs/batch`: one [`LaunchBatchItem`] per requested run,
/// in request order.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LaunchBatchAck {
    /// One result per requested run, aligned by index to the request's `runs`.
    pub jobs: Vec<LaunchBatchItem>,
}

/// A job's lifecycle state on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum JobState {
    /// Enqueued, awaiting a dispatcher to claim it.
    Queued,
    /// Enqueued, but intentionally held back: the run's harness is already at its
    /// configured maximum parallelism, so the backend will not hand it to a
    /// dispatcher until an in-flight run of the same harness finishes. Distinct from
    /// `queued` (which is free to be claimed the moment a dispatcher has capacity) so
    /// an operator can see a run is deliberately waiting rather than merely next in
    /// line.
    Pending,
    /// Claimed by the dispatcher; the driver Job is being created.
    Dispatched,
    /// The driver pod is up and running the pre-run setup (connecting to the
    /// container runtime, materializing the definition) — not yet executing the
    /// harness, but it will as soon as setup finishes.
    Starting,
    /// The driver is executing the run.
    Running,
    /// The run produced a record.
    Succeeded,
    /// The run could not be driven to a record.
    Failed,
    /// The job was canceled before completing.
    Canceled,
}

impl JobState {
    /// Map the stored state string to the wire enum. An unrecognized value (which
    /// the backend never writes) is treated as `queued`.
    pub fn from_db(state: &str) -> Self {
        match state {
            "pending" => Self::Pending,
            "dispatched" => Self::Dispatched,
            "starting" => Self::Starting,
            "running" => Self::Running,
            "succeeded" => Self::Succeeded,
            "failed" => Self::Failed,
            "canceled" => Self::Canceled,
            _ => Self::Queued,
        }
    }

    /// Whether this is a terminal state (the run is over).
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Succeeded | Self::Failed | Self::Canceled)
    }
}

/// A run's display identity, lifted from its launch request so the active-run
/// list and completion notifications can describe a job without its (not-yet-
/// produced) record. Flattened in JSON to the console's `InProgressRun` shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct JobSummary {
    /// The test-case slug being run (e.g. `carom`).
    pub test_case_slug: String,
    /// The exact, immutable test-case version being run (e.g. `v1.0.0`), fixed at
    /// enqueue — so the active-run list can show it before the run produces a record.
    pub test_case_version: String,
    /// The variant being run (e.g. `base`).
    pub variant: String,
    /// The harness driving the run, as its slug string.
    pub harness_slug: String,
    /// The opaque model id passed to the harness.
    pub model_id: String,
}

/// One in-flight job, as `GET /jobs/active` reports it: the live/job id, the
/// run's display identity (flattened), and its current state.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ActiveJobOut {
    /// The job/stream id (`POST /jobs` returns this).
    pub run_id: String,
    /// The run's display identity.
    #[serde(flatten)]
    pub summary: JobSummary,
    /// The job's current lifecycle state.
    pub state: JobState,
}

/// A job's status, as `GET /jobs/{id}` reports it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct JobStatusOut {
    /// The job id.
    pub id: String,
    /// Where the job is in its lifecycle.
    pub state: JobState,
    /// The produced run record's id, present once `state` is `succeeded` and the
    /// run was completed (the row the console navigates to).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub record_id: Option<String>,
    /// A human-readable failure reason, present when `state` is `failed`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub detail: Option<String>,
}

/// Whether a finished run produced a record. `completed` carries a record id to
/// open; `failed` carries a reason.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum NotificationOutcome {
    /// The run produced a record (its own `status.state` may still be a failure).
    Completed,
    /// The run could not be driven to a record at all.
    Failed,
}

/// The kind of a [`Notification`] — which event in a run's life it announces. The
/// console switches on it, because the kinds mean different things about the same
/// run: a completion changes the in-flight list, a publish failure does not.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum NotificationKind {
    /// A run reached a terminal state (produced a record, or failed before one).
    RunCompleted,
    /// A run's **publish** failed — the release Job reported a terminal failure.
    ///
    /// Publishing is asynchronous and the console typically navigates away from
    /// the live publish stream as soon as it is enqueued (the whole point of
    /// enqueuing it), so without this alert a failed release — a transient GitHub
    /// 5xx, say — is invisible: the run simply stays unpublished and the operator
    /// finds out much later. The durable record of the failure is the publish job
    /// row; this is how a reviewer *learns* about it.
    PublishFailed,
}

/// A worker-wide notification about a run: that it reached a terminal state, or
/// that publishing it failed. Carries the run's display identity (flattened to the
/// console's notification shape) plus how it ended. Delivered over
/// `GET /notifications` (SSE).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct Notification {
    /// Which event this announces.
    pub kind: NotificationKind,
    /// The job the notification is about — the **run** job for `run-completed`,
    /// the **publish** job for `publish-failed`. It identifies the attempt rather
    /// than the run, so a run that fails to publish twice raises two alerts.
    pub job_id: String,
    /// The run's display identity (test case, variant, harness, model).
    #[serde(flatten)]
    pub summary: JobSummary,
    /// How the run ended.
    pub outcome: NotificationOutcome,
    /// The persisted run record's id the console links the alert to: the produced
    /// record's id for a `completed` run, the job id for a `failed` one, and the
    /// run that could not be released for a `publish-failed` one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub record_id: Option<String>,
    /// A human-readable failure reason, present when `outcome` is `failed`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub message: Option<String>,
}

impl Notification {
    /// A run that produced the record `record_id`.
    pub fn completed(job_id: &str, summary: JobSummary, record_id: &str) -> Self {
        Self {
            kind: NotificationKind::RunCompleted,
            job_id: job_id.to_string(),
            summary,
            outcome: NotificationOutcome::Completed,
            record_id: Some(record_id.to_string()),
            message: None,
        }
    }

    /// A run that failed, with the reason. `record_id` is the produced failure
    /// record to open when the driver built one (a model failure with a timeline),
    /// or `None` for an infrastructure failure that produced no record (the alert
    /// then just surfaces the message).
    pub fn failed(
        job_id: &str,
        summary: JobSummary,
        message: &str,
        record_id: Option<&str>,
    ) -> Self {
        Self {
            kind: NotificationKind::RunCompleted,
            job_id: job_id.to_string(),
            summary,
            outcome: NotificationOutcome::Failed,
            record_id: record_id.map(str::to_string),
            message: Some(message.to_string()),
        }
    }

    /// A run whose **publish** failed, with the publisher's reason. `publish_job_id`
    /// is the release attempt that failed (not the run job that produced the run),
    /// and `run_id` the run it was releasing — the run the console links the alert
    /// to, so the reviewer lands where they can retry the publish.
    pub fn publish_failed(
        publish_job_id: &str,
        summary: JobSummary,
        run_id: &str,
        message: &str,
    ) -> Self {
        Self {
            kind: NotificationKind::PublishFailed,
            job_id: publish_job_id.to_string(),
            summary,
            outcome: NotificationOutcome::Failed,
            record_id: Some(run_id.to_string()),
            message: Some(message.to_string()),
        }
    }
}

/// Which transition in a run's life a [`RunEvent`] announces.
///
/// The three are separated because the console does different things with them:
/// an `enqueued` run joins the in-flight list, a `state-changed` run is patched in
/// place (without reordering the list), and a `finished` run leaves it — and, for a
/// run that produced a record, makes the produced-run listing stale.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum RunEventKind {
    /// The run entered the queue. Its `state` is `queued` — the dispatcher may hold
    /// it back to `pending` on the very next claim pass, which arrives as its own
    /// `state-changed`.
    Enqueued,
    /// The run moved between two non-terminal states (`queued` ↔ `pending`, or
    /// forward through `dispatched` → `starting` → `running`).
    StateChanged,
    /// The run reached a terminal state (`succeeded`, `failed`, or `canceled`) and
    /// is no longer in flight.
    Finished,
}

/// A run-lifecycle event on the multiplexed console stream (`GET /notifications`,
/// `runs` topic).
///
/// This is deliberately **not** a [`Notification`]. A notification is an *alert* —
/// something a person should be told about, filed to the bell and raised as a toast,
/// and so only ever fired for the two things worth interrupting someone over (a run
/// finishing, a publish failing). A run event is *list maintenance*: every transition
/// the in-flight list must reflect, including the many that nobody wants a toast for
/// (a queued run held back to `pending`, a driver reaching `starting`, an operator's
/// bulk cancel ending forty runs at once). Keeping them separate is what lets the
/// console subscribe to the alerts always and to the churn only while a page is
/// showing it.
///
/// It carries enough to patch the list in place — the run's identity and its state
/// after the transition — so a console applies it without a round-trip. The one thing
/// it does not carry is the produced *record*, so a `finished` run that produced one
/// still makes the produced-run listing stale; the console re-reads that separately.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct RunEvent {
    /// Which transition this announces.
    pub kind: RunEventKind,
    /// The run (job) this is about. Named `runId` to match `ActiveJobOut`, which is
    /// the shape this event maintains — the console keys its in-flight list on it.
    pub run_id: String,
    /// The run's display identity (test case, variant, harness, model), so a console
    /// that has never seen this run can render the row from the event alone.
    #[serde(flatten)]
    pub summary: JobSummary,
    /// The run's state **after** the transition. For a `finished` event this is the
    /// terminal state, which is how a console tells an operator's `canceled` run from
    /// one that ran to `succeeded`/`failed`.
    pub state: JobState,
    /// The produced run record's id, present on a `finished` event whose run produced
    /// one (a success, or a failure the driver still built a record for).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub record_id: Option<String>,
    /// The terminal reason, present on a `finished` event that failed or was
    /// canceled.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub detail: Option<String>,
}

impl RunEvent {
    /// A run that just entered the queue.
    pub fn enqueued(run_id: &str, summary: JobSummary) -> Self {
        Self {
            kind: RunEventKind::Enqueued,
            run_id: run_id.to_string(),
            summary,
            state: JobState::Queued,
            record_id: None,
            detail: None,
        }
    }

    /// A run that moved to a new non-terminal state.
    pub fn state_changed(run_id: &str, summary: JobSummary, state: JobState) -> Self {
        Self {
            kind: RunEventKind::StateChanged,
            run_id: run_id.to_string(),
            summary,
            state,
            record_id: None,
            detail: None,
        }
    }

    /// A run that reached the terminal `state`, with whatever record it produced and
    /// the reason it ended (for a failure or a cancellation).
    pub fn finished(
        run_id: &str,
        summary: JobSummary,
        state: JobState,
        record_id: Option<&str>,
        detail: Option<&str>,
    ) -> Self {
        Self {
            kind: RunEventKind::Finished,
            run_id: run_id.to_string(),
            summary,
            state,
            record_id: record_id.map(str::to_string),
            detail: detail.map(str::to_string),
        }
    }
}

/// Which of the console stream's topics a subscriber wants, as
/// `PUT /notifications/{stream}/topics` carries them.
///
/// Both fields are optional so a caller toggles one topic without having to restate
/// the other — the console flips `runs` on and off as it enters and leaves the pages
/// that show in-flight runs, and never wants that request to disturb its alerts.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct StreamTopicsBody {
    /// Whether to deliver [`Notification`]s (the bell/toast alerts). Defaults to on
    /// when a stream is opened; a console has no reason to turn it off, but it is
    /// settable so the topic set is uniform.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub notifications: Option<bool>,
    /// Whether to deliver [`RunEvent`]s (in-flight list maintenance). Defaults to
    /// **off**: most of the console shows no in-flight list, and a run's churn is far
    /// noisier than its alerts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub runs: Option<bool>,
}

#[cfg(test)]
#[path = "job_api.test.rs"]
mod tests;
