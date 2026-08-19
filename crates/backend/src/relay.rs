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
//! Alongside the per-job relay this module owns the **console stream**
//! ([`Notifier`]): one worker-wide fan-out, multiplexed per client, carrying both
//! the completion alerts a person is shown and the run-lifecycle events the
//! in-flight list is maintained from. A client picks its topics and changes them
//! while connected, so a console subscribes to the churn only while it is on a page
//! that shows it. That is a different thing from the per-job relay above — this one
//! is about *every* run's coarse lifecycle, not one run's harness output.
//!
//! This state is deliberately **in-memory and transient**: the durable record of
//! a run is the `RunRecord` persisted to the `run` table on completion, and the
//! job lifecycle is the `job` table. A backend restart drops the live buffers; a
//! subscriber that reconnects afterward falls back to the persisted record and
//! its recorded events. Losing the live buffer never loses the run.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use test_cabinet_core::{AssetPreview, HarnessEvent};
use tokio::sync::broadcast;

/// The capacity of each job's live broadcast channel. A slow streaming client
/// that falls this far behind is lagged (the stream handler reports the gap
/// rather than blocking ingestion); the full ordered history is always available
/// from the backlog, so a lag never loses an event for a fresh subscriber.
const EVENT_CHANNEL_CAPACITY: usize = 1024;

/// How many messages the worker-wide console channel buffers for a slow subscriber
/// before it is lagged.
///
/// Sized for the *run-event* topic, not the alerts: a run publishes one alert but
/// half a dozen lifecycle transitions, and a bulk cancel or a coverage top-up moves
/// hundreds of runs in one go. The buffer is shared by every connected stream
/// regardless of its topics, so it must absorb the noisiest producer or a console
/// watching only the quiet topic would be lagged by traffic it never asked for.
/// Messages are small (a run's identity and a state), so this is cheap.
const STREAM_CHANNEL_CAPACITY: usize = 4096;

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

    /// The worker-wide console stream (the `/notifications` feed).
    pub fn notifier(&self) -> &Notifier {
        &self.notifier
    }
}

impl Default for Relay {
    fn default() -> Self {
        Self::new()
    }
}

// --- The console stream -----------------------------------------------------

// The notification wire shapes (`Notification`, `NotificationKind`,
// `NotificationOutcome`), the run-lifecycle event (`RunEvent`, `RunEventKind`), and
// the run's display identity (`JobSummary`) are shared with the queue's Rust
// clients, so they live in `core::job_api`; re-export them here so this module —
// and the `contract-codegen` generator that names them as `relay::…` — keep
// referring to them unchanged.
pub use test_cabinet_core::{
    JobSummary, Notification, NotificationKind, NotificationOutcome, RunEvent, RunEventKind,
};

/// One message on the console stream, tagged with the topic that gates it.
///
/// Both topics ride a single broadcast channel rather than one channel each. A
/// subscriber must see the two in the order they were published — a run's `finished`
/// event and its completion `Notification` describe the same instant, and delivering
/// the alert before the list update (or vice versa) across two channels would let a
/// console toast a run it still shows as running. One channel makes that ordering
/// automatic.
#[derive(Debug, Clone)]
pub enum StreamMessage {
    /// An alert for a person: gated on the `notifications` topic.
    Notification(Box<Notification>),
    /// An in-flight list transition: gated on the `runs` topic.
    Run(Box<RunEvent>),
}

/// Which topics one connected stream currently wants.
///
/// Held behind `Arc` and mutated through atomics rather than replaced, because the
/// toggle arrives on a **different** request than the one serving the stream: the
/// console `PUT`s its topic change while its `GET` is still open. The stream task
/// reads these on every message, so a toggle takes effect on the very next one
/// without disturbing the connection.
#[derive(Debug)]
pub struct StreamTopics {
    notifications: AtomicBool,
    runs: AtomicBool,
}

impl StreamTopics {
    /// The defaults a freshly-opened stream gets: alerts on, run churn off.
    fn new() -> Self {
        Self {
            notifications: AtomicBool::new(true),
            runs: AtomicBool::new(false),
        }
    }

    /// Whether this stream currently wants `message`.
    fn wants(&self, message: &StreamMessage) -> bool {
        match message {
            StreamMessage::Notification(_) => self.notifications.load(Ordering::Relaxed),
            StreamMessage::Run(_) => self.runs.load(Ordering::Relaxed),
        }
    }

    /// Apply a topic change. `None` leaves that topic as it was, so a caller
    /// toggling one topic never has to restate the other.
    fn set(&self, notifications: Option<bool>, runs: Option<bool>) {
        if let Some(on) = notifications {
            self.notifications.store(on, Ordering::Relaxed);
        }
        if let Some(on) = runs {
            self.runs.store(on, Ordering::Relaxed);
        }
    }
}

/// A registered, connected stream: its live receiver, the topic set the `PUT`
/// handler mutates, and the registry entry it owns.
///
/// Dropping this deregisters the stream. That is the whole reason it exists as a
/// struct rather than a tuple: the SSE task holds it for as long as the response
/// body is alive, so a client that disconnects — cleanly or not — takes its registry
/// entry with it, and the map cannot grow without bound as consoles come and go.
pub struct StreamHandle {
    /// The id the client quotes back to change its topics.
    pub id: String,
    /// Everything published while this stream is connected.
    pub receiver: broadcast::Receiver<StreamMessage>,
    /// This stream's topic set, shared with the registry.
    pub topics: Arc<StreamTopics>,
    /// Deregisters `id` on drop.
    _guard: StreamGuard,
}

impl StreamHandle {
    /// Whether this stream currently wants `message` — the per-message filter the
    /// stream task applies.
    pub fn wants(&self, message: &StreamMessage) -> bool {
        self.topics.wants(message)
    }
}

/// Removes a stream's registry entry when the stream ends.
struct StreamGuard {
    id: String,
    streams: Arc<Mutex<HashMap<String, Arc<StreamTopics>>>>,
}

impl Drop for StreamGuard {
    fn drop(&mut self) {
        self.streams
            .lock()
            .expect("stream registry mutex poisoned")
            .remove(&self.id);
    }
}

/// The worker-wide console fan-out: completion alerts and run-lifecycle events,
/// multiplexed onto one per-client stream whose topics the client controls.
///
/// Live-only (no backlog): anything published while a client is between connections
/// is simply not delivered. That is deliberate — the durable truth is the `job` and
/// `run` tables, and a reconnecting console re-reads them rather than replaying a
/// buffer we would have to bound anyway. What the stream owes a client is a *signal*
/// that it fell behind, which is why a lagged receiver is reported rather than
/// silently skipped (see the stream handler).
#[derive(Clone)]
pub struct Notifier {
    tx: broadcast::Sender<StreamMessage>,
    /// Every connected stream's topic set, keyed by stream id, so the `PUT` handler
    /// can reach a stream being served by a different request.
    streams: Arc<Mutex<HashMap<String, Arc<StreamTopics>>>>,
}

impl Notifier {
    /// Create a notifier with an empty channel and no connected streams.
    pub fn new() -> Self {
        let (tx, _rx) = broadcast::channel(STREAM_CHANNEL_CAPACITY);
        Self {
            tx,
            streams: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Open and register a stream with the default topics (alerts on, run churn
    /// off). The returned handle deregisters itself when dropped.
    ///
    /// The receiver is taken **before** the id is published to the client, so nothing
    /// can be lost between registering and subscribing.
    pub fn open_stream(&self) -> StreamHandle {
        let id = uuid::Uuid::new_v4().to_string();
        let receiver = self.tx.subscribe();
        let topics = Arc::new(StreamTopics::new());
        self.streams
            .lock()
            .expect("stream registry mutex poisoned")
            .insert(id.clone(), Arc::clone(&topics));
        StreamHandle {
            id: id.clone(),
            receiver,
            topics,
            _guard: StreamGuard {
                id,
                streams: Arc::clone(&self.streams),
            },
        }
    }

    /// Change a connected stream's topics. Returns `false` when no such stream is
    /// connected — which is how the console learns its stream died (its `EventSource`
    /// reconnected under a new id, or the backend restarted) and that it must
    /// re-apply its topics to the new one.
    pub fn set_topics(&self, id: &str, notifications: Option<bool>, runs: Option<bool>) -> bool {
        let streams = self.streams.lock().expect("stream registry mutex poisoned");
        match streams.get(id) {
            Some(topics) => {
                topics.set(notifications, runs);
                true
            }
            None => false,
        }
    }

    /// Publish an alert to every stream subscribed to the `notifications` topic. A
    /// send with no subscribers is fine — the channel is live-only, so it is simply
    /// dropped.
    pub fn notify(&self, notification: Notification) {
        let _ = self
            .tx
            .send(StreamMessage::Notification(Box::new(notification)));
    }

    /// Publish a run-lifecycle event to every stream subscribed to the `runs` topic.
    pub fn publish_run(&self, event: RunEvent) {
        let _ = self.tx.send(StreamMessage::Run(Box::new(event)));
    }

    /// How many streams are connected right now. Test/diagnostic only.
    pub fn connected_streams(&self) -> usize {
        self.streams
            .lock()
            .expect("stream registry mutex poisoned")
            .len()
    }
}

impl Default for Notifier {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
#[path = "relay.test.rs"]
mod tests;
