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

/// The kind of a [`Notification`]. Only [`Self::RunCompleted`] exists today;
/// modeled as an enum so it is part of the generated contract and the console can
/// switch on it as more are added.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum NotificationKind {
    /// A run reached a terminal state (produced a record, or failed before one).
    RunCompleted,
}

/// A worker-wide notification that a run reached a terminal state. Carries the
/// run's display identity (flattened to the console's notification shape) plus
/// how it ended. Delivered over `GET /notifications` (SSE).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct Notification {
    /// The notification kind. Only `run-completed` exists today.
    pub kind: NotificationKind,
    /// The job id the run was observed under.
    pub job_id: String,
    /// The run's display identity (test case, variant, harness, model).
    #[serde(flatten)]
    pub summary: JobSummary,
    /// How the run ended.
    pub outcome: NotificationOutcome,
    /// The persisted run record's id the console links the alert to: the produced
    /// record's id for a `completed` run, the job id for a `failed` one.
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
}
