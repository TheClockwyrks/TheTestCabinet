//! The live event/preview **relay**: the backend's in-memory fan-out of a
//! running job's progress to live subscribers.
//!
//! A run is driven by a per-run Job pod (the driver), not the backend, so the
//! backend never executes a run — it **relays** one. The driver streams the
//! harness events and asset-preview frames it produces to the backend over HTTP
//! (`POST /jobs/{id}/events|preview`), and the relay fans them out to every live
//! subscriber on `GET /jobs/{id}/live` (NDJSON).
//!
//! The relay holds no events. Every event batch is written to the database, keyed
//! by job and sequence, before it is acknowledged and only then handed to the relay
//! (see "Delivery to the backend" in the driver's event documentation), so the
//! stored rows are the job's recorded stream: a late subscriber is replayed them
//! from the database before the live tail, the run record is persisted with them,
//! and a backend restart loses none of them. What the relay keeps in memory is
//! only what is never stored: the latest preview frame per frame index, and whether
//! the job has finished, so a stream to a finished job closes after its backlog.
//! A restart drops those; the live handler then reads the job's terminal state
//! from its row, and previews resume with the next frame the driver sends.
//!
//! Each fanned-out event carries its sequence, so a subscriber that took its
//! backlog from the database after subscribing here skips the events it was
//! already replayed, and one that falls behind the channel reads the events it
//! missed back from the database.
//!
//! Alongside the per-job relay this module owns the **console stream**
//! ([`Notifier`]): one worker-wide fan-out, multiplexed per client, carrying both
//! the completion alerts a person is shown and the run-lifecycle events the
//! in-flight list is maintained from. A client picks its topics and changes them
//! while connected, so a console subscribes to the churn only while it is on a page
//! that shows it. That is a different thing from the per-job relay above — this one
//! is about *every* run's coarse lifecycle, not one run's harness output.
//!
//! On PostgreSQL the backend runs as more than one replica, and a subscriber may be
//! connected to a replica other than the one the driver posts to. A relay built
//! [`shared`](Relay::shared) therefore also announces what it fans out through the
//! [replica bus](crate::bus), which delivers the other replicas' announcements back
//! into it with the `deliver_*` methods, and a job's latest preview frames are kept
//! in the database rather than only here.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use test_cabinet_contracts::preview::AssetPreview;

use test_cabinet_contracts::event::HarnessEvent;
use tokio::sync::broadcast;

use crate::bus::{Announcement, Announcer};

/// The capacity of each job's live broadcast channel. A slow streaming client
/// that falls this far behind is lagged (the stream handler reads what it missed
/// back from the database rather than blocking ingestion).
const EVENT_CHANNEL_CAPACITY: usize = 1024;

/// How many messages the worker-wide console channel buffers for a slow subscriber
/// before it is lagged.
///
/// Sized for the *run-event* topic, not the alerts: a run publishes one alert but
/// half a dozen lifecycle transitions, and a bulk cancel or a launch pass moves
/// hundreds of runs in one go. The buffer is shared by every connected stream
/// regardless of its topics, so it must absorb the noisiest producer or a console
/// watching only the quiet topic would be lagged by traffic it never asked for.
/// Messages are small (a run's identity and a state), so this is cheap.
const STREAM_CHANNEL_CAPACITY: usize = 4096;

/// An item delivered to a live stream: a stored harness event with its sequence, an
/// asset-preview frame, or the terminal marker that lets a streaming client close
/// cleanly.
#[derive(Debug, Clone)]
pub enum StreamItem {
    /// A normalized harness event the backend has stored.
    Event {
        /// The event's sequence within its job, as the driver numbered it.
        sequence: u64,
        /// The event.
        event: Box<HarnessEvent>,
    },
    /// A live asset-generation preview frame. Carried on the same channel as
    /// events but never stored; a viewer renders it to watch the sprite form.
    Preview(Box<AssetPreview>),
    /// The run reached a terminal state; no further items will arrive. A
    /// subscriber reads any stored event it has not delivered before it closes,
    /// since another replica's announcement of a batch can arrive after the end.
    Done,
    /// Items for this job may have been lost: the replica's bus reconnected after
    /// losing announcements, or an announced batch could not be read back. A
    /// subscriber reads what it missed from the database, and closes if the job
    /// ended meanwhile.
    Resync,
}

/// One running job's shared live state, behind a `Mutex` because ingestion writes
/// it while live subscribers read it.
#[derive(Debug, Default)]
struct LiveInner {
    /// The most recent preview frame, keyed by frame index. Only the latest per
    /// frame is kept, since a viewer only shows the current image and previews are
    /// never stored.
    latest_previews: HashMap<u32, AssetPreview>,
    /// Whether the job has reached a terminal state. A late subscriber to a
    /// terminated job drains its backlog and closes without waiting on the channel.
    terminated: bool,
}

/// A handle to one job's live relay: its latest previews plus the live broadcast.
/// Cloning shares the same underlying state (it is `Arc`-backed).
#[derive(Debug, Clone)]
pub struct LiveJob {
    id: Arc<str>,
    inner: Arc<Mutex<LiveInner>>,
    tx: broadcast::Sender<StreamItem>,
    /// Where what this replica accepts is announced to the others, when shared.
    announcer: Option<Announcer>,
}

impl LiveJob {
    /// Publish events the backend has just stored, each with its sequence, in order
    /// to every live subscriber, and announce them to the other replicas. A
    /// subscriber connecting later is replayed them from the database instead.
    pub fn push_events(&self, events: Vec<(u64, HarnessEvent)>) {
        if let (Some(announcer), Some((first, _)), Some((last, _))) =
            (&self.announcer, events.first(), events.last())
        {
            announcer.announce(Announcement::Events {
                job: self.id.to_string(),
                first: *first,
                last: *last,
            });
        }
        self.deliver_events(events);
    }

    /// Publish stored events to this replica's live subscribers only: another
    /// replica's batch, which that replica announced.
    pub fn deliver_events(&self, events: Vec<(u64, HarnessEvent)>) {
        for (sequence, event) in events {
            // A send error only means there are no live subscribers, which is fine —
            // the event is stored for a later one.
            let _ = self.tx.send(StreamItem::Event {
                sequence,
                event: Box::new(event),
            });
        }
    }

    /// Record the latest preview for its frame, publish it to live subscribers, and
    /// announce it to the other replicas, which read it back from the database the
    /// caller stored it in. Overwrites rather than appends — a viewer shows the
    /// current image, not a history.
    pub fn push_preview(&self, preview: AssetPreview) {
        if let Some(announcer) = &self.announcer {
            announcer.announce(Announcement::Preview {
                job: self.id.to_string(),
                frame: preview.frame,
            });
        }
        self.deliver_preview(preview);
    }

    /// Record and publish a preview to this replica's live subscribers only.
    pub fn deliver_preview(&self, preview: AssetPreview) {
        {
            let mut inner = self.inner.lock().expect("relay mutex poisoned");
            inner.latest_previews.insert(preview.frame, preview.clone());
        }
        let _ = self.tx.send(StreamItem::Preview(Box::new(preview)));
    }

    /// Mark the job terminal, signal every live stream to close, and announce the
    /// end to the other replicas. Idempotent.
    pub fn finish(&self) {
        if let Some(announcer) = &self.announcer {
            announcer.announce(Announcement::Finished {
                job: self.id.to_string(),
            });
        }
        self.deliver_finish();
    }

    /// Mark the job terminal and signal this replica's live streams to close.
    pub fn deliver_finish(&self) {
        {
            let mut inner = self.inner.lock().expect("relay mutex poisoned");
            inner.terminated = true;
        }
        let _ = self.tx.send(StreamItem::Done);
    }

    /// Tell this replica's live streams of the job to resynchronize.
    pub fn resync(&self) {
        let _ = self.tx.send(StreamItem::Resync);
    }

    /// Whether any live stream of the job is connected to this replica.
    pub fn has_subscribers(&self) -> bool {
        self.tx.receiver_count() > 0
    }

    /// Subscribe to the job's live stream: the latest preview per frame, a live
    /// receiver for everything published afterward, and whether the job is already
    /// terminal. The caller reads the stored events as its backlog *after* this, so
    /// an event stored in between arrives on the receiver as well and is skipped by
    /// its sequence; none falls between the two.
    pub fn subscribe(&self) -> Subscription {
        let inner = self.inner.lock().expect("relay mutex poisoned");
        let mut previews: Vec<AssetPreview> = inner.latest_previews.values().cloned().collect();
        previews.sort_by_key(|preview| preview.frame);
        let terminated = inner.terminated;
        let receiver = self.tx.subscribe();
        drop(inner);
        Subscription {
            previews,
            receiver,
            terminated,
        }
    }
}

/// What a new subscriber receives from the relay: the latest preview per frame, a
/// live receiver, and whether the job had already finished at subscribe time (so
/// the stream closes once its backlog is drained). The event backlog comes from
/// the database.
pub struct Subscription {
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
    announcer: Option<Announcer>,
}

impl Relay {
    /// Create an empty relay for a backend that runs as one replica.
    pub fn new() -> Self {
        Self {
            jobs: Arc::new(Mutex::new(HashMap::new())),
            notifier: Notifier::new(),
            announcer: None,
        }
    }

    /// Create an empty relay for a replica that shares its database with others,
    /// announcing what it fans out through `announcer`.
    pub fn shared(announcer: Announcer) -> Self {
        Self {
            jobs: Arc::new(Mutex::new(HashMap::new())),
            notifier: Notifier::shared(announcer.clone()),
            announcer: Some(announcer),
        }
    }

    /// The announcer of a shared relay, which forwards what this replica cannot
    /// answer alone.
    pub fn announcer(&self) -> Option<&Announcer> {
        self.announcer.as_ref()
    }

    /// Whether the relay is shared with other replicas, in which case a job's
    /// latest preview frames are kept in the database.
    pub fn is_shared(&self) -> bool {
        self.announcer.is_some()
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
                    id: Arc::from(id),
                    inner: Arc::new(Mutex::new(LiveInner::default())),
                    tx,
                    announcer: self.announcer.clone(),
                }
            })
            .clone()
    }

    /// The live relay for a job, if this replica has one.
    pub fn existing(&self, id: &str) -> Option<LiveJob> {
        self.jobs
            .lock()
            .expect("relay registry mutex poisoned")
            .get(id)
            .cloned()
    }

    /// Tell every live stream this replica serves to resynchronize, after its bus
    /// lost announcements.
    pub fn resync(&self) {
        let jobs: Vec<LiveJob> = self
            .jobs
            .lock()
            .expect("relay registry mutex poisoned")
            .values()
            .cloned()
            .collect();
        for live in jobs {
            live.resync();
        }
        self.notifier.resync();
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
// clients, so they live in the contracts crate's `job_api`; re-export them here so
// the rest of the backend keeps referring to them as `relay::…`.
pub use test_cabinet_contracts::job_api::JobSummary;
pub use test_cabinet_contracts::job_api::Notification;
pub use test_cabinet_contracts::job_api::NotificationKind;
pub use test_cabinet_contracts::job_api::NotificationOutcome;
pub use test_cabinet_contracts::job_api::RunEvent;
pub use test_cabinet_contracts::job_api::RunEventKind;

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
    /// This replica's bus lost the other replicas' announcements for a while, so
    /// the client must re-read the authoritative lists. Sent whatever the topics.
    Resync,
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
            StreamMessage::Resync => true,
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
    /// Where each message is announced to the other replicas, when shared.
    announcer: Option<Announcer>,
}

impl Notifier {
    /// Create a notifier with an empty channel and no connected streams.
    pub fn new() -> Self {
        let (tx, _rx) = broadcast::channel(STREAM_CHANNEL_CAPACITY);
        Self {
            tx,
            streams: Arc::new(Mutex::new(HashMap::new())),
            announcer: None,
        }
    }

    /// A notifier that also announces each message to the other replicas.
    fn shared(announcer: Announcer) -> Self {
        Self {
            announcer: Some(announcer),
            ..Self::new()
        }
    }

    /// Open and register a stream with the default topics (alerts on, run churn
    /// off). The returned handle deregisters itself when dropped.
    ///
    /// The receiver is taken **before** the id is published to the client, so nothing
    /// can be lost between registering and subscribing.
    pub fn open_stream(&self) -> StreamHandle {
        let id = cuid2::create_id();
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
        let notification = Box::new(notification);
        if let Some(announcer) = &self.announcer {
            announcer.announce(Announcement::Notification(notification.clone()));
        }
        self.deliver(StreamMessage::Notification(notification));
    }

    /// Publish a run-lifecycle event to every stream subscribed to the `runs` topic.
    pub fn publish_run(&self, event: RunEvent) {
        let event = Box::new(event);
        if let Some(announcer) = &self.announcer {
            announcer.announce(Announcement::Run(event.clone()));
        }
        self.deliver(StreamMessage::Run(event));
    }

    /// Publish a message to the streams connected to this replica only: another
    /// replica's message, which that replica announced.
    pub fn deliver(&self, message: StreamMessage) {
        let _ = self.tx.send(message);
    }

    /// Tell every stream connected to this replica to re-read the authoritative
    /// lists.
    fn resync(&self) {
        self.deliver(StreamMessage::Resync);
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
