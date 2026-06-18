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
use test_cabinet_core::{HarnessEvent, RunRecord};
use tokio::sync::broadcast;

/// How a single submitted run is progressing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
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

/// A point-in-time view of a job, returned by the status endpoint.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobStatus {
    /// The job id (`POST /runs` returns this; the other endpoints key on it).
    pub id: String,
    /// Where the job is in its lifecycle.
    pub state: JobState,
    /// The produced run record, present once `state` is `succeeded`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record: Option<RunRecord>,
    /// A human-readable failure reason, present when `state` is `failed`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// One job's shared, mutable state: its terminal outcome (once known) and the
/// ordered event log accumulated so far. Behind a `Mutex` because the background
/// run task writes it while status/stream requests read it.
#[derive(Debug, Default)]
struct JobInner {
    state: JobStateInner,
    events: Vec<HarnessEvent>,
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
    /// The run reached a terminal state; no further events will arrive.
    Done,
}

impl Job {
    /// The job's id.
    pub fn id(&self) -> &str {
        &self.id
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
        let terminated = !matches!(inner.state, JobStateInner::Running);
        // Subscribe while holding the lock so an event appended between the
        // snapshot and the subscribe cannot be missed.
        let receiver = self.tx.subscribe();
        drop(inner);
        Subscription {
            backlog,
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

    /// Register a fresh job under a new id and return its handle.
    pub fn create(&self) -> Job {
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, _rx) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        let job = Job {
            id: id.clone(),
            inner: Arc::new(Mutex::new(JobInner::default())),
            tx,
        };
        self.jobs
            .lock()
            .expect("registry mutex poisoned")
            .insert(id, job.clone());
        job
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
/// `Orchestrator::run_resolved` takes `&mut dyn EventSink` and emits events as
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
