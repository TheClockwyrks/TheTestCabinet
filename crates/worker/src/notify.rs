//! Worker-level notifications: a push channel for run lifecycle events.
//!
//! Distinct from a job's per-run event stream (`jobs`/`GET /runs/{job}/events`),
//! this is a single worker-wide fan-out the console subscribes to once to learn
//! when *any* run finishes — so it can raise a completion alert without sitting on
//! the live monitor and without polling. `GET /notifications` (see
//! [`api::notify`](crate::api)) streams these as Server-Sent Events; the desktop
//! shell delivers the same payload over a global Tauri event.
//!
//! The channel is live-only: there is no backlog. A completion that occurs while
//! no client is connected is simply not delivered (the run still surfaces as a
//! produced run and drops out of the active-run list). Losing a *notification* is
//! never losing the run.

use serde::Serialize;
use tokio::sync::broadcast;

use crate::jobs::RunSummary;

/// How many notifications the worker-wide channel buffers for a slow subscriber
/// before it is lagged. Notifications are small and infrequent (one per run
/// completion), so a modest buffer is ample; a lagged subscriber skips the gap
/// rather than blocking a run.
const NOTIFICATION_CHANNEL_CAPACITY: usize = 256;

/// Whether a finished run produced a record. Mirrors the console's run outcome:
/// `completed` carries a record id to open; `failed` carries a reason.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum NotificationOutcome {
    /// The run produced a record (its own `status.state` may still be a failure).
    Completed,
    /// The run could not be driven to a record at all.
    Failed,
}

/// The kind of a [`WorkerNotification`]. Only [`Self::RunCompleted`] exists today;
/// modeled as an enum (rather than a bare string) so it is part of the generated
/// contract and the console can switch on it as more are added.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum NotificationKind {
    /// A run reached a terminal state (produced a record, or failed before one).
    RunCompleted,
}

/// A worker-wide notification that a run reached a terminal state.
///
/// Carries the run's display identity (flattened, so the JSON matches the
/// console's `InProgressRun`/notification shape) plus how it ended: a `completed`
/// run includes the `recordId` to open; a `failed` run includes the `message`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct WorkerNotification {
    /// The notification kind. Only `run-completed` exists today; carried
    /// explicitly so the console can switch on it as more are added.
    pub kind: NotificationKind,
    /// The live stream/job id the run was observed under.
    pub job_id: String,
    /// The run's display identity (test case, variant, harness, model).
    #[serde(flatten)]
    pub summary: RunSummary,
    /// How the run ended.
    pub outcome: NotificationOutcome,
    /// The persisted run record's id — what the console links the alert to. For a
    /// `completed` run this is the produced record's own id; for a `failed` run it
    /// is the job id, which is also the id the failed record is persisted under
    /// (see [`crate::runner::drive_run`]), so a failure alert still opens the run.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub record_id: Option<String>,
    /// A human-readable failure reason, present when `outcome` is `failed`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub message: Option<String>,
}

impl WorkerNotification {
    /// A run that produced the record `record_id`.
    pub fn completed(job_id: &str, summary: &RunSummary, record_id: &str) -> Self {
        Self {
            kind: NotificationKind::RunCompleted,
            job_id: job_id.to_string(),
            summary: summary.clone(),
            outcome: NotificationOutcome::Completed,
            record_id: Some(record_id.to_string()),
            message: None,
        }
    }

    /// A run that failed before producing a result, with the reason. The failed
    /// run is persisted as a record under the job id, so the alert links there.
    pub fn failed(job_id: &str, summary: &RunSummary, message: &str) -> Self {
        Self {
            kind: NotificationKind::RunCompleted,
            job_id: job_id.to_string(),
            summary: summary.clone(),
            outcome: NotificationOutcome::Failed,
            record_id: Some(job_id.to_string()),
            message: Some(message.to_string()),
        }
    }
}

/// The worker-wide notification fan-out, held in [`AppState`](crate::api) and
/// cloned cheaply into each run task. Subscribers connect via `GET /notifications`.
#[derive(Clone)]
pub struct WorkerNotifier {
    tx: broadcast::Sender<WorkerNotification>,
}

impl WorkerNotifier {
    /// Create a notifier with an empty channel.
    pub fn new() -> Self {
        let (tx, _rx) = broadcast::channel(NOTIFICATION_CHANNEL_CAPACITY);
        Self { tx }
    }

    /// Subscribe to the live notification stream.
    pub fn subscribe(&self) -> broadcast::Receiver<WorkerNotification> {
        self.tx.subscribe()
    }

    /// Publish a notification to every current subscriber. A send with no
    /// subscribers is fine — the channel is live-only, so it is simply dropped.
    pub fn notify(&self, notification: WorkerNotification) {
        let _ = self.tx.send(notification);
    }
}

impl Default for WorkerNotifier {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
#[path = "notify.test.rs"]
mod tests;
