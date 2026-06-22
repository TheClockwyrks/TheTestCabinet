//! The async run-job model.
//!
//! A run can last up to an hour, so the worker does not hold an HTTP request open
//! for the whole run. `POST /runs` submits a job and returns its id immediately;
//! the run proceeds on a background task that records its progress here. The
//! caller observes that progress out of band: `GET /runs/{job}/events` streams
//! the live [`HarnessEvent`](test_cabinet_core::HarnessEvent)s as NDJSON, and
//! `GET /runs/{job}` reports the current status (and the run record once it has
//! finished).
//!
//! Each job keeps the full ordered event log so far plus a fan-out of live
//! subscribers. A late subscriber is replayed the backlog and then receives new
//! events as they arrive, so it never misses an event between submit and connect.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use test_cabinet_core::{AssetPreview, HarnessEvent, RunRecord};
use tokio::sync::broadcast;

/// How a single submitted run is progressing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum JobState {
    /// The job has been accepted and is executing (seeding, the harness session,
    /// validation). This covers the whole up-to-an-hour run.
    Running,
    /// The run finished and produced a [`RunRecord`]. The record's own
    /// `status.state` distinguishes a completed run from one the run lifecycle
    /// classified as failed/unevaluable.
    Succeeded,
    /// The run could not be driven to a record at all (the definition would not
    /// resolve, the container would not start, the harness was unavailable, the
    /// runtime cap fired). `detail` carries the reason.
    Failed,
}

/// The display identity of a run, captured at submit time so the active-run list
/// can describe a job without waiting for the record it only gains at completion.
/// Mirrors the console's `InProgressRun` shape (camelCase in JSON).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct RunSummary {
    /// The test-case slug being run (e.g. `pong`).
    pub test_case_slug: String,
    /// The variant being run (e.g. `base`).
    pub variant: String,
    /// The harness driving the run, as its slug string.
    pub harness_slug: String,
    /// The opaque model id passed to the harness.
    pub model_id: String,
}

/// The lifecycle state an [`ActiveRun`] reports — always [`Self::Running`], since
/// a job that reaches a terminal state drops out of the active list. Modeled as a
/// single-variant enum (rather than a bare string) so it is part of the generated
/// contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum ActiveRunState {
    /// The run is executing and has not yet reached a terminal state.
    Running,
}

/// One currently-running job, as `GET /runs/active` reports it: the live
/// stream/job id plus the run's display identity. `state` is always `running` —
/// a job that reaches a terminal state is no longer active and drops out of the
/// list. The flattened shape matches the console's `InProgressRun`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ActiveRun {
    /// The live stream/job id (`POST /runs` returns this).
    pub run_id: String,
    /// The run's display identity.
    #[serde(flatten)]
    pub summary: RunSummary,
    /// Always `running`; an active run has not yet reached a terminal state.
    pub state: ActiveRunState,
}

/// A point-in-time view of a job, returned by the status endpoint.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct JobStatus {
    /// The job id (`POST /runs` returns this; the other endpoints key on it).
    pub id: String,
    /// Where the job is in its lifecycle.
    pub state: JobState,
    /// The produced run record, present once `state` is `succeeded`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub record: Option<RunRecord>,
    /// A human-readable failure reason, present when `state` is `failed`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub detail: Option<String>,
}

/// One job's shared, mutable state: its terminal outcome (once known) and the
/// ordered event log accumulated so far. Behind a `Mutex` because the background
/// run task writes it while status/stream requests read it.
#[derive(Debug, Default)]
struct JobInner {
    state: JobStateInner,
    events: Vec<HarnessEvent>,
    /// The most recent live asset-generation preview frame, keyed by frame index.
    /// Unlike `events`, previews are not accumulated — only the latest per frame is
    /// kept, since a viewer only ever shows the current image and previews are
    /// never persisted. Replayed to a late subscriber so a reconnecting viewer
    /// immediately sees the current state of each frame.
    latest_previews: HashMap<u32, AssetPreview>,
}

/// The internal lifecycle, carrying the payloads each terminal state owns.
#[derive(Debug, Default)]
enum JobStateInner {
    #[default]
    Running,
    Succeeded(Box<RunRecord>),
    Failed(String),
}

/// A handle to one tracked job: its shared state plus the live event broadcast.
#[derive(Debug, Clone)]
pub struct Job {
    id: String,
    /// The run's display identity, fixed at submit. Lets the active-run list
    /// describe the job before it has produced a record.
    summary: Arc<RunSummary>,
    inner: Arc<Mutex<JobInner>>,
    /// Live event fan-out. New subscribers are first replayed the backlog held in
    /// `inner.events`, then receive everything published after they subscribed.
    tx: broadcast::Sender<StreamItem>,
}

/// An item delivered to a live event stream: either an event or the terminal
/// marker that lets a streaming client close cleanly when the run ends.
#[derive(Debug, Clone)]
pub enum StreamItem {
    /// A normalized harness event.
    Event(Box<HarnessEvent>),
    /// A live asset-generation preview frame, streamed as the model draws. Carried
    /// on the same channel as events but never recorded; a viewer renders it to
    /// watch the sprite take shape.
    Preview(Box<AssetPreview>),
    /// The run reached a terminal state; no further events will arrive.
    Done,
}

impl Job {
    /// The job's id.
    pub fn id(&self) -> &str {
        &self.id
    }

    /// The run's display identity (test case, variant, harness, model).
    pub fn summary(&self) -> &RunSummary {
        &self.summary
    }

    /// This job as an active-run entry, or `None` once it has reached a terminal
    /// state (a finished job is no longer "in progress").
    fn active_entry(&self) -> Option<ActiveRun> {
        let inner = self.inner.lock().expect("job mutex poisoned");
        matches!(inner.state, JobStateInner::Running).then(|| ActiveRun {
            run_id: self.id.clone(),
            summary: (*self.summary).clone(),
            state: ActiveRunState::Running,
        })
    }

    /// A snapshot of the events logged so far, in order.
    ///
    /// The failure path persists this beside a failed run's record as its
    /// `events.jsonl` so a reviewer can inspect the timeline that led up to the
    /// failure — the same backlog the live stream replays, captured at the moment
    /// the run gave out.
    pub fn events_snapshot(&self) -> Vec<HarnessEvent> {
        self.inner
            .lock()
            .expect("job mutex poisoned")
            .events
            .clone()
    }

    /// Append an event to the log and publish it to every live subscriber.
    ///
    /// Recording the event under the lock before broadcasting keeps the backlog a
    /// subscriber replays consistent with what it then receives live: an event is
    /// in the log before any "new event" wakeup races a fresh subscription.
    pub fn push_event(&self, event: HarnessEvent) {
        {
            let mut inner = self.inner.lock().expect("job mutex poisoned");
            inner.events.push(event.clone());
        }
        // A send error only means there are currently no subscribers, which is
        // fine — the event is already in the backlog for a later one.
        let _ = self.tx.send(StreamItem::Event(Box::new(event)));
    }

    /// Record the latest preview for its frame and publish it to live subscribers.
    ///
    /// Only the most recent frame is retained (a viewer shows the current image,
    /// not a history), so this overwrites rather than appends. Like
    /// [`push_event`](Self::push_event), the retained snapshot is updated under the
    /// lock before broadcasting so a fresh subscription's replay stays consistent
    /// with the live frames it then receives.
    pub fn push_preview(&self, preview: AssetPreview) {
        {
            let mut inner = self.inner.lock().expect("job mutex poisoned");
            inner.latest_previews.insert(preview.frame, preview.clone());
        }
        let _ = self.tx.send(StreamItem::Preview(Box::new(preview)));
    }

    /// Mark the job succeeded with its produced run record, then signal the stream
    /// to close.
    pub fn finish_succeeded(&self, record: RunRecord) {
        {
            let mut inner = self.inner.lock().expect("job mutex poisoned");
            inner.state = JobStateInner::Succeeded(Box::new(record));
        }
        let _ = self.tx.send(StreamItem::Done);
    }

    /// Mark the job failed with a reason, then signal the stream to close.
    pub fn finish_failed(&self, detail: impl Into<String>) {
        {
            let mut inner = self.inner.lock().expect("job mutex poisoned");
            inner.state = JobStateInner::Failed(detail.into());
        }
        let _ = self.tx.send(StreamItem::Done);
    }

    /// A point-in-time status snapshot.
    pub fn status(&self) -> JobStatus {
        let inner = self.inner.lock().expect("job mutex poisoned");
        match &inner.state {
            JobStateInner::Running => JobStatus {
                id: self.id.clone(),
                state: JobState::Running,
                record: None,
                detail: None,
            },
            JobStateInner::Succeeded(record) => JobStatus {
                id: self.id.clone(),
                state: JobState::Succeeded,
                record: Some((**record).clone()),
                detail: None,
            },
            JobStateInner::Failed(detail) => JobStatus {
                id: self.id.clone(),
                state: JobState::Failed,
                record: None,
                detail: Some(detail.clone()),
            },
        }
    }

    /// Subscribe to the job's live event stream.
    ///
    /// Returns the backlog accumulated so far (replayed in order) and a live
    /// receiver for everything published afterward, plus whether the job is
    /// already terminal (so a caller subscribing after the run ended still closes
    /// cleanly without waiting on the receiver). The backlog is snapshotted under
    /// the same lock that gates new appends, so no event falls between the two.
    pub fn subscribe(&self) -> Subscription {
        let inner = self.inner.lock().expect("job mutex poisoned");
        let backlog = inner.events.clone();
        // The latest preview per frame, in frame order, so a reconnecting viewer
        // immediately shows the current image of each frame before the live tail.
        let mut previews: Vec<AssetPreview> = inner.latest_previews.values().cloned().collect();
        previews.sort_by_key(|preview| preview.frame);
        let terminated = !matches!(inner.state, JobStateInner::Running);
        // Subscribe while holding the lock so an event appended between the
        // snapshot and the subscribe cannot be missed.
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

/// What a new subscriber receives: the replayed backlog, a live receiver, and
/// whether the run had already finished at subscribe time.
pub struct Subscription {
    /// Events accumulated before this subscription, replayed in order.
    pub backlog: Vec<HarnessEvent>,
    /// The latest preview per frame at subscribe time, replayed so a reconnecting
    /// viewer immediately shows the current image. Empty for a run with no live
    /// previews (anything but an observed asset-generation run).
    pub previews: Vec<AssetPreview>,
    /// Live items published after this subscription was taken.
    pub receiver: broadcast::Receiver<StreamItem>,
    /// Whether the job was already terminal when subscribed (no live items will
    /// arrive; the stream should close once the backlog is drained).
    pub terminated: bool,
}

/// The set of all tracked jobs, keyed by id.
///
/// Cloning shares the same underlying map (it is `Arc`-backed), so the router
/// state, the submit handler, and each background run task all see one registry.
#[derive(Debug, Clone, Default)]
pub struct JobRegistry {
    jobs: Arc<Mutex<HashMap<String, Job>>>,
}

/// The capacity of each job's live event channel. A slow streaming client that
/// falls this far behind is lagged (the stream handler reports the gap rather
/// than blocking the run); the full ordered history is always available from the
/// backlog and the final status, so a lag never loses the record itself.
const EVENT_CHANNEL_CAPACITY: usize = 1024;

impl JobRegistry {
    /// Create an empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a fresh job under a new id and return its handle. The `summary`
    /// describes the run for the active-run list before it has a record.
    pub fn create(&self, summary: RunSummary) -> Job {
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, _rx) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        let job = Job {
            id: id.clone(),
            summary: Arc::new(summary),
            inner: Arc::new(Mutex::new(JobInner::default())),
            tx,
        };
        self.jobs
            .lock()
            .expect("registry mutex poisoned")
            .insert(id, job.clone());
        job
    }

    /// Every job still running, newest registration order not guaranteed (the
    /// console sorts for display). A job that has reached a terminal state is
    /// excluded — it is now a produced run, not an in-progress one.
    pub fn active(&self) -> Vec<ActiveRun> {
        self.jobs
            .lock()
            .expect("registry mutex poisoned")
            .values()
            .filter_map(Job::active_entry)
            .collect()
    }

    /// Look up a job by id.
    pub fn get(&self, id: &str) -> Option<Job> {
        self.jobs
            .lock()
            .expect("registry mutex poisoned")
            .get(id)
            .cloned()
    }

    /// The number of jobs currently tracked (used by tests and diagnostics).
    pub fn len(&self) -> usize {
        self.jobs.lock().expect("registry mutex poisoned").len()
    }

    /// Whether any jobs are tracked.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// An [`EventSink`](test_cabinet_core::EventSink) that records each event onto a
/// [`Job`], so the orchestrator's live events become the job's streamed events.
///
/// `RunEngine::run_resolved` takes `&mut dyn EventSink` and emits events as
/// the harness runs; forwarding them through this sink is the whole of the
/// HTTP-to-core translation for the live stream — the worker re-implements none
/// of the event taxonomy, it just relays what core produces.
pub struct JobEventSink {
    job: Job,
}

impl JobEventSink {
    /// Build a sink that records onto `job`.
    pub fn new(job: Job) -> Self {
        Self { job }
    }
}

impl test_cabinet_core::EventSink for JobEventSink {
    fn emit(&mut self, event: &HarnessEvent) {
        self.job.push_event(event.clone());
    }
}

/// A [`PreviewSink`](test_cabinet_core::PreviewSink) that records each live
/// asset-generation preview frame onto a [`Job`], so the orchestrator's streamed
/// frames join the job's live stream alongside its events.
///
/// Takes `&self` (the trait requires it) so the orchestrator can share it with the
/// background listener task that runs concurrently with the harness session — the
/// same `Job` the [`JobEventSink`] writes to, just on the preview channel.
pub struct JobPreviewSink {
    job: Job,
}

impl JobPreviewSink {
    /// Build a sink that records preview frames onto `job`.
    pub fn new(job: Job) -> Self {
        Self { job }
    }
}

impl test_cabinet_core::PreviewSink for JobPreviewSink {
    fn preview(&self, preview: test_cabinet_core::AssetPreview) {
        self.job.push_preview(preview);
    }
}

#[cfg(test)]
#[path = "jobs.test.rs"]
mod tests;

#[cfg(test)]
impl Job {
    /// Whether the job has reached a terminal state (test-visible).
    pub(crate) fn terminal_for_test(&self) -> bool {
        !matches!(
            self.inner.lock().expect("job mutex poisoned").state,
            JobStateInner::Running
        )
    }
}
