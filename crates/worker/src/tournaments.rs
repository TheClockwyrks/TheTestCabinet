//! The async tournament-job model.
//!
//! A tournament runs `C(n,2)` matches and can take a while, so — like a run — the
//! worker does not hold the HTTP request open for it. `POST /tournaments` submits
//! a job and returns its id (the tournament id); the matches run on a background
//! task that records progress here. The caller observes it out of band:
//! `GET /tournaments/{job}/events` streams per-match progress as NDJSON, and
//! `GET /tournaments/{job}` reports status (and the finished record). Once
//! complete, the worker publishes the tournament to the backend, where the gallery
//! reads it.
//!
//! This is deliberately a small parallel of [`crate::jobs`] rather than a
//! generalization of it: the run-job state is typed to a `RunRecord`, and a
//! tournament carries a different payload (a [`TournamentRecord`]) and a different
//! progress shape.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use test_cabinet_core::match_play::{MatchSummary, TournamentRecord};
use tokio::sync::broadcast;

/// Where a submitted tournament is in its lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TournamentState {
    /// Accepted and running its matches.
    Running,
    /// Every match ran and the tournament was published to the backend.
    Succeeded,
    /// The tournament could not be completed (a controller could not be resolved,
    /// the engine failed, or publishing failed). `detail` carries the reason.
    Failed,
}

/// One match's completion, streamed as the field plays out so the UI can show a
/// live tournament board. Carries the full [`MatchSummary`] plus how far along the
/// field is.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentProgress {
    /// How many matches have completed (1-based).
    pub played: usize,
    /// How many matches the field has in total (`C(n,2)`).
    pub total: usize,
    /// The match that just completed.
    pub summary: MatchSummary,
}

/// A point-in-time view of a tournament job.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentJobStatus {
    /// The job id (= the tournament id).
    pub id: String,
    /// Lifecycle state.
    pub state: TournamentState,
    /// The finished record, present once `state` is `succeeded`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record: Option<TournamentRecord>,
    /// A failure reason, present when `state` is `failed`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Default)]
struct JobInner {
    state: StateInner,
    progress: Vec<TournamentProgress>,
}

#[derive(Debug, Default)]
enum StateInner {
    #[default]
    Running,
    Succeeded(Box<TournamentRecord>),
    Failed(String),
}

/// An item delivered to a tournament's live stream.
#[derive(Debug, Clone)]
pub enum StreamItem {
    /// A completed match.
    Progress(Box<TournamentProgress>),
    /// The tournament reached a terminal state; no further items will arrive.
    Done,
}

/// A handle to one tracked tournament job.
#[derive(Debug, Clone)]
pub struct TournamentJob {
    id: String,
    inner: Arc<Mutex<JobInner>>,
    tx: broadcast::Sender<StreamItem>,
}

impl TournamentJob {
    /// The job/tournament id.
    pub fn id(&self) -> &str {
        &self.id
    }

    /// Append a completed match and publish it to live subscribers.
    pub fn push_progress(&self, progress: TournamentProgress) {
        {
            let mut inner = self.inner.lock().expect("tournament job mutex poisoned");
            inner.progress.push(progress.clone());
        }
        let _ = self.tx.send(StreamItem::Progress(Box::new(progress)));
    }

    /// Mark the tournament succeeded with its record, then close the stream.
    pub fn finish_succeeded(&self, record: TournamentRecord) {
        {
            let mut inner = self.inner.lock().expect("tournament job mutex poisoned");
            inner.state = StateInner::Succeeded(Box::new(record));
        }
        let _ = self.tx.send(StreamItem::Done);
    }

    /// Mark the tournament failed with a reason, then close the stream.
    pub fn finish_failed(&self, detail: impl Into<String>) {
        {
            let mut inner = self.inner.lock().expect("tournament job mutex poisoned");
            inner.state = StateInner::Failed(detail.into());
        }
        let _ = self.tx.send(StreamItem::Done);
    }

    /// A point-in-time status snapshot.
    pub fn status(&self) -> TournamentJobStatus {
        let inner = self.inner.lock().expect("tournament job mutex poisoned");
        match &inner.state {
            StateInner::Running => TournamentJobStatus {
                id: self.id.clone(),
                state: TournamentState::Running,
                record: None,
                detail: None,
            },
            StateInner::Succeeded(record) => TournamentJobStatus {
                id: self.id.clone(),
                state: TournamentState::Succeeded,
                record: Some((**record).clone()),
                detail: None,
            },
            StateInner::Failed(detail) => TournamentJobStatus {
                id: self.id.clone(),
                state: TournamentState::Failed,
                record: None,
                detail: Some(detail.clone()),
            },
        }
    }

    /// Subscribe to the live progress stream: the backlog so far plus a live
    /// receiver, and whether the job is already terminal.
    pub fn subscribe(&self) -> Subscription {
        let inner = self.inner.lock().expect("tournament job mutex poisoned");
        let backlog = inner.progress.clone();
        let terminated = !matches!(inner.state, StateInner::Running);
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
/// whether the tournament had already finished at subscribe time.
pub struct Subscription {
    /// Matches completed before this subscription, replayed in order.
    pub backlog: Vec<TournamentProgress>,
    /// Live items published after this subscription was taken.
    pub receiver: broadcast::Receiver<StreamItem>,
    /// Whether the job was already terminal when subscribed.
    pub terminated: bool,
}

/// The capacity of each tournament's live progress channel.
const PROGRESS_CHANNEL_CAPACITY: usize = 1024;

/// The set of all tracked tournament jobs, keyed by id. `Arc`-backed so the router
/// state and each background task share one registry.
#[derive(Debug, Clone, Default)]
pub struct TournamentRegistry {
    jobs: Arc<Mutex<HashMap<String, TournamentJob>>>,
}

impl TournamentRegistry {
    /// Create an empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a fresh tournament job under a new id and return its handle.
    pub fn create(&self) -> TournamentJob {
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, _rx) = broadcast::channel(PROGRESS_CHANNEL_CAPACITY);
        let job = TournamentJob {
            id: id.clone(),
            inner: Arc::new(Mutex::new(JobInner::default())),
            tx,
        };
        self.jobs
            .lock()
            .expect("tournament registry mutex poisoned")
            .insert(id, job.clone());
        job
    }

    /// Look up a tournament job by id.
    pub fn get(&self, id: &str) -> Option<TournamentJob> {
        self.jobs
            .lock()
            .expect("tournament registry mutex poisoned")
            .get(id)
            .cloned()
    }
}
