//! The live event/preview **relay**: the backend's in-memory fan-out of a
//! running job's progress to live subscribers.
//!
//! A run is driven by a per-run Job pod (the driver), not the backend, so the
//! backend never executes a run — it **relays** one. The driver streams the
//! harness events and asset-preview frames it produces to the backend over HTTP
//! (`POST /jobs/{id}/events|preview`); the relay records them per job and fans
//! them out to every live subscriber on `GET /jobs/{id}/live` (NDJSON), exactly
//! as the old in-process worker did over its own broadcast channel — only now the
//! producer is across the network. A late subscriber is replayed the backlog (and
//! the latest preview per frame) before the live tail, so it never misses
//! progress between dispatch and connect.
//!
//! This state is deliberately **in-memory and transient**: the durable record of
//! a run is the `RunRecord` persisted to the `run` table on completion, and the
//! job lifecycle is the `job` table. A backend restart drops the live buffers; a
//! subscriber that reconnects afterward falls back to the persisted record and
//! its recorded events. Losing the live buffer never loses the run.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use test_cabinet_core::{AssetPreview, HarnessEvent};
use tokio::sync::broadcast;

/// The capacity of each job's live broadcast channel. A slow streaming client
/// that falls this far behind is lagged (the stream handler reports the gap
/// rather than blocking ingestion); the full ordered history is always available
/// from the backlog, so a lag never loses an event for a fresh subscriber.
const EVENT_CHANNEL_CAPACITY: usize = 1024;

/// How many completion notifications the worker-wide channel buffers for a slow
/// subscriber before it is lagged. Notifications are small and infrequent (one
/// per run completion), so a modest buffer is ample.
const NOTIFICATION_CHANNEL_CAPACITY: usize = 256;

/// A run's display identity, lifted from its launch request so the active-run
/// list and completion notifications can describe a job without its (not-yet-
/// produced) record. Flattened in JSON to the console's `InProgressRun` shape.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct JobSummary {
    /// The test-case slug being run (e.g. `pong`).
    pub test_case_slug: String,
    /// The variant being run (e.g. `base`).
    pub variant: String,
    /// The harness driving the run, as its slug string.
    pub harness_slug: String,
    /// The opaque model id passed to the harness.
    pub model_id: String,
}

/// An item delivered to a live stream: a harness event, an asset-preview frame,
/// or the terminal marker that lets a streaming client close cleanly.
#[derive(Debug, Clone)]
pub enum StreamItem {
    /// A normalized harness event.
    Event(Box<HarnessEvent>),
    /// A live asset-generation preview frame. Carried on the same channel as
    /// events but never persisted; a viewer renders it to watch the sprite form.
    Preview(Box<AssetPreview>),
    /// The run reached a terminal state; no further items will arrive.
    Done,
}

/// One running job's shared live state: the ordered event backlog and the latest
/// preview per frame, behind a `Mutex` because ingestion writes it while live
/// subscribers read it.
#[derive(Debug, Default)]
struct LiveInner {
    events: Vec<HarnessEvent>,
    /// The most recent preview frame, keyed by frame index. Unlike `events`,
    /// previews are not accumulated — only the latest per frame is kept, since a
    /// viewer only shows the current image and previews are never persisted.
    latest_previews: HashMap<u32, AssetPreview>,
    /// Whether the job has reached a terminal state. A late subscriber to a
    /// terminated job drains the backlog and closes without waiting on the channel.
    terminated: bool,
}

/// A handle to one job's live relay: its shared backlog plus the live broadcast.
/// Cloning shares the same underlying state (it is `Arc`-backed).
#[derive(Debug, Clone)]
pub struct LiveJob {
    inner: Arc<Mutex<LiveInner>>,
    tx: broadcast::Sender<StreamItem>,
}

impl LiveJob {
    /// Append an event to the backlog and publish it to every live subscriber.
    ///
    /// Recording under the lock before broadcasting keeps a fresh subscriber's
    /// replayed backlog consistent with the live items it then receives.
    pub fn push_event(&self, event: HarnessEvent) {
        {
            let mut inner = self.inner.lock().expect("relay mutex poisoned");
            inner.events.push(event.clone());
        }
        // A send error only means there are no live subscribers, which is fine —
        // the event is in the backlog for a later one.
        let _ = self.tx.send(StreamItem::Event(Box::new(event)));
    }

    /// Append a batch of events in order (the driver streams events in batches).
    pub fn push_events(&self, events: Vec<HarnessEvent>) {
        for event in events {
            self.push_event(event);
        }
    }

    /// Record the latest preview for its frame and publish it to live subscribers.
    /// Overwrites rather than appends — a viewer shows the current image, not a
    /// history.
    pub fn push_preview(&self, preview: AssetPreview) {
        {
            let mut inner = self.inner.lock().expect("relay mutex poisoned");
            inner.latest_previews.insert(preview.frame, preview.clone());
        }
        let _ = self.tx.send(StreamItem::Preview(Box::new(preview)));
    }

    /// A snapshot of the events relayed so far, in order. On completion the
    /// backend persists this as the run's recorded event stream — the same
    /// backlog the live stream replays, so the stored events match what viewers
    /// saw live, with no need for the driver to re-send them.
    pub fn events_snapshot(&self) -> Vec<HarnessEvent> {
        self.inner
            .lock()
            .expect("relay mutex poisoned")
            .events
            .clone()
    }

    /// Mark the job terminal and signal every live stream to close. Idempotent.
    pub fn finish(&self) {
        {
            let mut inner = self.inner.lock().expect("relay mutex poisoned");
            inner.terminated = true;
        }
        let _ = self.tx.send(StreamItem::Done);
    }

    /// Subscribe to the job's live stream: the backlog accumulated so far
    /// (replayed in order), the latest preview per frame, a live receiver for
    /// everything published afterward, and whether the job is already terminal.
    /// The backlog is snapshotted under the same lock that gates appends, so no
    /// item falls between the snapshot and the subscription.
    pub fn subscribe(&self) -> Subscription {
        let inner = self.inner.lock().expect("relay mutex poisoned");
        let backlog = inner.events.clone();
        let mut previews: Vec<AssetPreview> = inner.latest_previews.values().cloned().collect();
        previews.sort_by_key(|preview| preview.frame);
        let terminated = inner.terminated;
        let receiver = self.tx.subscribe();
        drop(inner);
        Subscription {
            backlog,
            previews,
            receiver,
            terminated,
        }
    }
}

/// What a new subscriber receives: the replayed backlog, the latest preview per
/// frame, a live receiver, and whether the job had already finished at subscribe
/// time (so the stream closes once the backlog is drained).
pub struct Subscription {
    /// Events accumulated before this subscription, replayed in order.
    pub backlog: Vec<HarnessEvent>,
    /// The latest preview per frame at subscribe time. Empty for anything but an
    /// observed asset-generation run.
    pub previews: Vec<AssetPreview>,
    /// Live items published after this subscription was taken.
    pub receiver: broadcast::Receiver<StreamItem>,
    /// Whether the job was already terminal when subscribed.
    pub terminated: bool,
}

/// The set of live job relays, keyed by job id, plus the worker-wide completion
/// notifier. Cloning shares the same underlying state (it is `Arc`-backed), so
/// the router state, the ingestion handlers, and the subscribe handler all see
/// one relay.
#[derive(Clone)]
pub struct Relay {
    jobs: Arc<Mutex<HashMap<String, LiveJob>>>,
    notifier: Notifier,
}

impl Relay {
    /// Create an empty relay.
    pub fn new() -> Self {
        Self {
            jobs: Arc::new(Mutex::new(HashMap::new())),
            notifier: Notifier::new(),
        }
    }

    /// The live relay for a job, creating an empty one if none exists yet. Both
    /// the driver's first ingestion and a subscriber connecting before it land
    /// here; whichever arrives first creates the shared state.
    pub fn live(&self, id: &str) -> LiveJob {
        let mut jobs = self.jobs.lock().expect("relay registry mutex poisoned");
        jobs.entry(id.to_string())
            .or_insert_with(|| {
                let (tx, _rx) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
                LiveJob {
                    inner: Arc::new(Mutex::new(LiveInner::default())),
                    tx,
                }
            })
            .clone()
    }

    /// The worker-wide completion notifier (the console's `/notifications` feed).
    pub fn notifier(&self) -> &Notifier {
        &self.notifier
    }
}

impl Default for Relay {
    fn default() -> Self {
        Self::new()
    }
}

// --- Completion notifications ----------------------------------------------

/// Whether a finished run produced a record. `completed` carries a record id to
/// open; `failed` carries a reason.
#[derive(Debug, Clone, Copy, Serialize)]
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
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum NotificationKind {
    /// A run reached a terminal state (produced a record, or failed before one).
    RunCompleted,
}

/// A worker-wide notification that a run reached a terminal state. Carries the
/// run's display identity (flattened to the console's notification shape) plus
/// how it ended.
#[derive(Debug, Clone, Serialize)]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub record_id: Option<String>,
    /// A human-readable failure reason, present when `outcome` is `failed`.
    #[serde(skip_serializing_if = "Option::is_none")]
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

    /// A run that failed before producing a result, with the reason.
    pub fn failed(job_id: &str, summary: JobSummary, message: &str) -> Self {
        Self {
            kind: NotificationKind::RunCompleted,
            job_id: job_id.to_string(),
            summary,
            outcome: NotificationOutcome::Failed,
            record_id: Some(job_id.to_string()),
            message: Some(message.to_string()),
        }
    }
}

/// The worker-wide notification fan-out. Live-only (no backlog): a completion
/// while no client is connected is simply not delivered — the run still surfaces
/// as a finished run and drops out of the active list.
#[derive(Clone)]
pub struct Notifier {
    tx: broadcast::Sender<Notification>,
}

impl Notifier {
    /// Create a notifier with an empty channel.
    pub fn new() -> Self {
        let (tx, _rx) = broadcast::channel(NOTIFICATION_CHANNEL_CAPACITY);
        Self { tx }
    }

    /// Subscribe to the live notification stream.
    pub fn subscribe(&self) -> broadcast::Receiver<Notification> {
        self.tx.subscribe()
    }

    /// Publish a notification to every current subscriber. A send with no
    /// subscribers is fine — the channel is live-only, so it is simply dropped.
    pub fn notify(&self, notification: Notification) {
        let _ = self.tx.send(notification);
    }
}

impl Default for Notifier {
    fn default() -> Self {
        Self::new()
    }
}
