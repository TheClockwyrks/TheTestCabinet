//! The **replica bus**: how the replicas sharing one PostgreSQL database tell each
//! other what a subscriber of another replica wants (the backend overview's
//! "Replicas").
//!
//! The relay, the console stream and the publish relay each fan out within one
//! process. On PostgreSQL every replica also announces what it accepted through
//! `NOTIFY` on one channel, and every replica listens on that channel on a
//! connection of its own and delivers what the others announced to its own
//! subscribers. A replica skips its own announcements, since it delivered those
//! directly.
//!
//! An announcement carries what identifies the thing rather than the thing when
//! the thing is stored: an event batch is its job and sequence range, a preview
//! frame its job and index, and a replica with a subscriber reads them back from
//! the database. Everything else rides in the payload, and a payload over
//! PostgreSQL's limit is stored in `relay_overflow` and announced by its key.
//!
//! Announcements are sent in the order they are made, by one task per replica, so
//! another replica receives one replica's announcements in that order, and a
//! stopping replica sends what it has queued before it exits. A replica whose
//! listening connection drops reconnects, with the freshest credentials the store
//! holds, and resynchronizes every stream it serves, because what was announced in
//! the gap is lost. A connection that silently stopped delivering is found by the
//! replica's own ping, announced whenever the channel has been quiet for a while
//! and expected back.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use sea_orm::sqlx::postgres::{PgListener, PgPoolOptions};
use serde::{Deserialize, Serialize};
use test_cabinet_contracts::ingest::IngestBody;
use test_cabinet_contracts::publish_job_api::{PublishJobState, PublishProgress, PublishResult};
use tokio::sync::{mpsc, oneshot, watch};

use crate::api::AppState;
use crate::db::Db;
use crate::relay::{Notification, RunEvent, StreamMessage};

/// The PostgreSQL channel every replica announces on and listens to.
pub const CHANNEL: &str = "tcab_replicas";

/// The largest payload sent as a notification. PostgreSQL refuses one of 8000
/// bytes or more; a longer one is stored and announced by its key.
const PAYLOAD_LIMIT: usize = 7999;

/// How long a forwarded topic change waits for the replica holding the stream to
/// acknowledge it (the console stream's `PUT /notifications/{stream}/topics`).
pub const TOPICS_ACK_TIMEOUT: Duration = Duration::from_secs(2);

/// How long the listener waits before reconnecting after its connection failed.
const RECONNECT_DELAY: Duration = Duration::from_secs(1);

/// How long the channel may stay quiet before the listener pings itself.
const PING_INTERVAL: Duration = Duration::from_secs(30);

/// How long the listener waits for its own ping before it takes its connection for
/// dead and reconnects.
const PING_TIMEOUT: Duration = Duration::from_secs(10);

/// One thing a replica announces to the others.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "body", rename_all = "kebab-case")]
pub enum Announcement {
    /// Job `job` stored the events `first..=last`.
    Events {
        /// The job.
        job: String,
        /// The batch's first sequence.
        first: u64,
        /// The batch's last sequence.
        last: u64,
    },
    /// Job `job` stored a new latest frame at index `frame`.
    Preview {
        /// The job.
        job: String,
        /// The frame index.
        frame: u32,
    },
    /// Job `job` ended; its stored frames are deleted before this is sent.
    Finished {
        /// The job.
        job: String,
    },
    /// A console stream alert.
    Notification(Box<Notification>),
    /// A console stream run-lifecycle event.
    Run(Box<RunEvent>),
    /// A topic change for console stream `stream`, held by whichever replica
    /// serves it, which acknowledges `request`.
    Topics {
        /// The stream's id.
        stream: String,
        /// The `notifications` topic, or `None` to leave it.
        notifications: Option<bool>,
        /// The `runs` topic, or `None` to leave it.
        runs: Option<bool>,
        /// The id the acknowledgement quotes.
        request: String,
    },
    /// The replica serving a stream applied the topic change `request`.
    TopicsAck {
        /// The change's id.
        request: String,
    },
    /// A progress line of publish job `job`.
    PublishProgress {
        /// The publish job.
        job: String,
        /// The line.
        progress: PublishProgress,
    },
    /// The terminal result of publish job `job`.
    PublishResult {
        /// The publish job.
        job: String,
        /// The result.
        result: PublishResult,
    },
    /// A snapshot refresh was queued; its dirty mark is written.
    RefreshQueued,
    /// An ingest that refreshed the announcing replica's checkout succeeded, so
    /// every other replica runs the same ingest into its own store.
    Ingest {
        /// The ingest's request body.
        body: IngestBody,
    },
    /// A replica's liveness ping of its own listening connection.
    Ping {
        /// What tells the replica's ping apart from any other.
        nonce: String,
    },
}

/// What travels as a notification's payload: the announcing replica, and the
/// announcement or the key it was stored under.
#[derive(Debug, Serialize, Deserialize)]
struct Envelope {
    origin: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    announcement: Option<Announcement>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    overflow: Option<i64>,
}

/// What the sender task drains: an announcement, or a request to be told once
/// everything queued before it was sent.
enum Outgoing {
    Announce(Announcement),
    Flush(oneshot::Sender<()>),
}

/// The queue an [`Announcer`] fills, which [`spawn`] sends from.
pub struct Queue(mpsc::UnboundedReceiver<Outgoing>);

/// The sending half of the bus, held by the relays. Cloning shares it.
#[derive(Clone)]
pub struct Announcer {
    inner: Arc<AnnouncerInner>,
}

struct AnnouncerInner {
    /// This replica's id, which its own announcements carry so it skips them.
    origin: String,
    /// The queue the sender task drains, in order.
    outgoing: mpsc::UnboundedSender<Outgoing>,
    /// The forwarded topic changes waiting for an acknowledgement, by request id.
    acks: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

impl std::fmt::Debug for Announcer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Announcer")
            .field("origin", &self.inner.origin)
            .finish_non_exhaustive()
    }
}

impl Announcer {
    /// A new announcer with a fresh replica id, and the queue [`spawn`] sends from.
    pub fn new() -> (Self, Queue) {
        let (outgoing, queue) = mpsc::unbounded_channel();
        (
            Self {
                inner: Arc::new(AnnouncerInner {
                    origin: cuid2::create_id(),
                    outgoing,
                    acks: Mutex::new(HashMap::new()),
                }),
            },
            Queue(queue),
        )
    }

    /// Queue `announcement`. Never waits: the sender task sends it after every
    /// announcement queued before it.
    pub fn announce(&self, announcement: Announcement) {
        // The queue closes only when the sender task ends with the backend.
        let _ = self.inner.outgoing.send(Outgoing::Announce(announcement));
    }

    /// Wait, at most `limit`, until everything announced so far was sent: what a
    /// stopping replica does before it exits.
    pub async fn flush(&self, limit: Duration) {
        let (sent, flushed) = oneshot::channel();
        if self.inner.outgoing.send(Outgoing::Flush(sent)).is_ok()
            && tokio::time::timeout(limit, flushed).await.is_err()
        {
            tracing::warn!("stopping with announcements still unsent");
        }
    }

    /// Forward a topic change for a stream this replica does not serve, and answer
    /// whether the replica serving it acknowledged it within
    /// [`TOPICS_ACK_TIMEOUT`].
    pub async fn forward_topics(
        &self,
        stream: &str,
        notifications: Option<bool>,
        runs: Option<bool>,
    ) -> bool {
        let request = cuid2::create_id();
        let (acknowledged, ack) = oneshot::channel();
        self.acks().insert(request.clone(), acknowledged);
        self.announce(Announcement::Topics {
            stream: stream.to_string(),
            notifications,
            runs,
            request: request.clone(),
        });
        let answered = matches!(
            tokio::time::timeout(TOPICS_ACK_TIMEOUT, ack).await,
            Ok(Ok(()))
        );
        self.acks().remove(&request);
        answered
    }

    fn acknowledge(&self, request: &str) {
        if let Some(acknowledged) = self.acks().remove(request) {
            let _ = acknowledged.send(());
        }
    }

    fn acks(&self) -> std::sync::MutexGuard<'_, HashMap<String, oneshot::Sender<()>>> {
        self.inner.acks.lock().expect("topic ack registry poisoned")
    }

    fn origin(&self) -> &str {
        &self.inner.origin
    }
}

/// The running bus: its sender and listener tasks, aborted when it is dropped.
pub struct BusHandle {
    announcer: Announcer,
    sender: tokio::task::JoinHandle<()>,
    listener: tokio::task::JoinHandle<()>,
    listening: watch::Receiver<bool>,
}

impl BusHandle {
    /// A receiver that reads `true` while the listener is listening.
    pub fn listening(&self) -> watch::Receiver<bool> {
        self.listening.clone()
    }

    /// Wait, at most `limit`, until the listener listens, answering whether it does.
    pub async fn wait_listening(&self, limit: Duration) -> bool {
        let mut listening = self.listening();
        matches!(
            tokio::time::timeout(limit, listening.wait_for(|listening| *listening)).await,
            Ok(Ok(_))
        )
    }

    /// Send everything announced so far, waiting at most `limit`.
    pub async fn flush(&self, limit: Duration) {
        self.announcer.flush(limit).await;
    }
}

impl Drop for BusHandle {
    fn drop(&mut self) {
        self.sender.abort();
        self.listener.abort();
    }
}

/// Start the bus of `state`, whose store must be PostgreSQL and whose relays and
/// publisher share `announcer`: the task that sends what `announcer` queues, and
/// the listener that delivers the other replicas' announcements into `state`.
pub fn spawn(state: AppState, announcer: Announcer, queue: Queue) -> BusHandle {
    let (listening_tx, listening) = watch::channel(false);
    let sender = tokio::spawn(send(
        Arc::clone(&state.db),
        announcer.origin().to_string(),
        queue.0,
    ));
    let listener = tokio::spawn(listen(state, announcer.clone(), listening_tx));
    BusHandle {
        announcer,
        sender,
        listener,
        listening,
    }
}

/// Send every queued announcement, in order. A send that fails is logged and
/// dropped: a job's stream notices the events it missed by their sequence, and the
/// job's end by reading its state while idle, and every other announcement is a
/// live signal a client re-reads the authoritative state for when it reconnects.
async fn send(db: Arc<Db>, origin: String, mut queue: mpsc::UnboundedReceiver<Outgoing>) {
    while let Some(outgoing) = queue.recv().await {
        let announcement = match outgoing {
            Outgoing::Announce(announcement) => announcement,
            Outgoing::Flush(flushed) => {
                let _ = flushed.send(());
                continue;
            }
        };
        if let Announcement::Finished { job } = &announcement
            && let Err(error) = db.delete_job_previews(job).await
        {
            tracing::warn!(job = %job, %error, "deleting an ended job's preview frames failed");
        }
        if let Err(error) = send_one(&db, &origin, announcement).await {
            tracing::warn!(%error, "announcing to the other replicas failed");
        }
    }
}

async fn send_one(db: &Db, origin: &str, announcement: Announcement) -> crate::error::Result<()> {
    let envelope = Envelope {
        origin: origin.to_string(),
        announcement: Some(announcement),
        overflow: None,
    };
    let mut payload = serde_json::to_string(&envelope)?;
    if payload.len() > PAYLOAD_LIMIT {
        let stored = serde_json::to_string(&envelope.announcement)?;
        let key = db.store_overflow(&stored).await?;
        payload = serde_json::to_string(&Envelope {
            origin: origin.to_string(),
            announcement: None,
            overflow: Some(key),
        })?;
    }
    db.notify(CHANNEL, &payload).await
}

/// Listen on [`CHANNEL`] for as long as the backend runs, reconnecting whenever the
/// connection fails or stops answering this replica's pings, and resynchronize
/// what this replica serves after each reconnect.
async fn listen(state: AppState, announcer: Announcer, listening: watch::Sender<bool>) {
    // What a replica that stopped before announcing a job's end left behind.
    match state.db.delete_ended_job_previews().await {
        Ok(0) => {}
        Ok(deleted) => tracing::info!(deleted, "deleted the preview frames of ended jobs"),
        Err(error) => tracing::warn!(%error, "deleting the preview frames of ended jobs failed"),
    }
    let mut reconnecting = false;
    loop {
        if let Some(mut listener) = connect(&state.db).await {
            if reconnecting {
                tracing::info!("the replica bus reconnected; resynchronizing every stream");
                resync(&state).await;
            }
            listening.send_replace(true);
            receive_until_lost(&state, &announcer, &mut listener).await;
            listening.send_replace(false);
        }
        reconnecting = true;
        tokio::time::sleep(RECONNECT_DELAY).await;
    }
}

/// Open a listening connection, from a pool of one connection of its own built with
/// the options the store's current pool connects with, so a reconnect presents the
/// freshest credentials.
async fn connect(db: &Db) -> Option<PgListener> {
    let pool = db.postgres_pool()?;
    let own = PgPoolOptions::new()
        .max_connections(1)
        .min_connections(0)
        .max_lifetime(None)
        .idle_timeout(None)
        .connect_lazy_with(pool.connect_options().as_ref().clone());
    let mut listener = match PgListener::connect_with(&own).await {
        Ok(listener) => listener,
        Err(error) => {
            tracing::warn!(%error, "the replica bus could not connect");
            return None;
        }
    };
    // A lost connection is rebuilt here, from the store's current pool, rather than
    // by the listener from the pool it was built with.
    listener.eager_reconnect(false);
    if let Err(error) = listener.listen(CHANNEL).await {
        tracing::warn!(%error, "the replica bus could not listen");
        return None;
    }
    Some(listener)
}

/// Deliver what arrives on `listener` until its connection is lost or stops
/// delivering this replica's own pings.
async fn receive_until_lost(state: &AppState, announcer: &Announcer, listener: &mut PgListener) {
    // The nonce of the ping sent and not yet received back, and when it was sent.
    let mut pending: Option<(String, tokio::time::Instant)> = None;
    loop {
        let wait = match &pending {
            Some((_, sent)) => PING_TIMEOUT.saturating_sub(sent.elapsed()),
            None => PING_INTERVAL,
        };
        let received = match tokio::time::timeout(wait, listener.try_recv()).await {
            Ok(received) => received,
            Err(_) if pending.is_some() => {
                tracing::warn!("the replica bus stopped delivering; reconnecting");
                return;
            }
            Err(_) => {
                let nonce = cuid2::create_id();
                if let Err(error) = ping(&state.db, announcer, &nonce).await {
                    tracing::warn!(%error, "the replica bus could not ping itself");
                }
                pending = Some((nonce, tokio::time::Instant::now()));
                continue;
            }
        };
        match received {
            Ok(Some(notification)) => {
                if let Some((nonce, _)) = &pending
                    && is_ping(notification.payload(), nonce)
                {
                    pending = None;
                    continue;
                }
                receive(state, announcer, notification.payload()).await;
            }
            Ok(None) => {
                tracing::warn!("the replica bus lost its connection");
                return;
            }
            Err(error) => {
                tracing::warn!(%error, "the replica bus failed to receive");
                return;
            }
        }
    }
}

/// Send this replica's ping `nonce` directly, ahead of anything queued.
async fn ping(db: &Db, announcer: &Announcer, nonce: &str) -> crate::error::Result<()> {
    let payload = serde_json::to_string(&Envelope {
        origin: announcer.origin().to_string(),
        announcement: Some(Announcement::Ping {
            nonce: nonce.to_string(),
        }),
        overflow: None,
    })?;
    db.notify(CHANNEL, &payload).await
}

/// Whether `payload` is the ping `nonce`.
fn is_ping(payload: &str, nonce: &str) -> bool {
    matches!(
        serde_json::from_str::<Envelope>(payload),
        Ok(Envelope {
            announcement: Some(Announcement::Ping { nonce: received }),
            ..
        }) if received == nonce
    )
}

/// Resynchronize what this replica serves after its bus lost announcements: every
/// job and console stream, every publish stream whose publish ended meanwhile, and
/// a refresh another replica queued meanwhile.
async fn resync(state: &AppState) {
    state.relay.resync();
    for (id, live) in state.publish_relay.unfinished() {
        match state.db.get_publish_job(&id).await {
            Ok(Some(job)) if PublishJobState::from_db(&job.state).is_terminal() => {
                live.deliver_finish(crate::api::publish_terminal_from_row(&job));
            }
            Ok(_) => {}
            Err(error) => {
                tracing::warn!(publish_job = %id, %error, "resynchronizing a publish stream failed");
            }
        }
    }
    state.publisher.wake();
}

/// Deliver one notification's announcement to this replica, unless this replica
/// made it.
async fn receive(state: &AppState, announcer: &Announcer, payload: &str) {
    let envelope: Envelope = match serde_json::from_str(payload) {
        Ok(envelope) => envelope,
        Err(error) => {
            tracing::warn!(%error, "the replica bus received a payload it cannot read");
            return;
        }
    };
    if envelope.origin == announcer.origin() {
        return;
    }
    let announcement = match (envelope.announcement, envelope.overflow) {
        (Some(announcement), _) => announcement,
        (None, Some(key)) => match state.db.overflow(key).await {
            Ok(Some(stored)) => match serde_json::from_str::<Option<Announcement>>(&stored) {
                Ok(Some(announcement)) => announcement,
                Ok(None) => return,
                Err(error) => {
                    tracing::warn!(%error, key, "a stored announcement does not parse");
                    return;
                }
            },
            Ok(None) => {
                tracing::warn!(key, "a stored announcement was deleted before it was read");
                return;
            }
            Err(error) => {
                tracing::warn!(%error, key, "reading a stored announcement failed");
                return;
            }
        },
        (None, None) => return,
    };
    deliver(state, announcer, announcement).await;
}

async fn deliver(state: &AppState, announcer: &Announcer, announcement: Announcement) {
    let db = state.db.as_ref();
    let relay = &state.relay;
    match announcement {
        Announcement::Events { job, first, last } => {
            // Only a job this replica serves a subscriber of is read back; a later
            // subscriber is replayed the stored events.
            let Some(live) = relay.existing(&job).filter(|live| live.has_subscribers()) else {
                return;
            };
            match db.job_events_after(&job, first.checked_sub(1)).await {
                Ok(events) => live.deliver_events(
                    events
                        .into_iter()
                        .take_while(|(sequence, _)| *sequence <= last)
                        .collect(),
                ),
                Err(error) => {
                    tracing::warn!(job = %job, %error, "reading an announced event batch failed");
                    live.resync();
                }
            }
        }
        Announcement::Preview { job, frame } => {
            let Some(live) = relay.existing(&job).filter(|live| live.has_subscribers()) else {
                return;
            };
            match db.job_preview(&job, frame).await {
                Ok(Some(preview)) => live.deliver_preview(preview),
                Ok(None) => {}
                Err(error) => {
                    tracing::warn!(job = %job, %error, "reading an announced preview frame failed");
                }
            }
        }
        Announcement::Finished { job } => {
            if let Some(live) = relay.existing(&job) {
                live.deliver_finish();
            }
        }
        Announcement::Notification(notification) => relay
            .notifier()
            .deliver(StreamMessage::Notification(notification)),
        Announcement::Run(event) => relay.notifier().deliver(StreamMessage::Run(event)),
        Announcement::Topics {
            stream,
            notifications,
            runs,
            request,
        } => {
            if relay.notifier().set_topics(&stream, notifications, runs) {
                announcer.announce(Announcement::TopicsAck { request });
            }
        }
        Announcement::TopicsAck { request } => announcer.acknowledge(&request),
        Announcement::PublishProgress { job, progress } => {
            state.publish_relay.live(&job).deliver_progress(progress);
        }
        Announcement::PublishResult { job, result } => {
            state.publish_relay.live(&job).deliver_finish(result);
        }
        Announcement::RefreshQueued => state.publisher.wake(),
        Announcement::Ingest { body } => {
            // An ingest runs for minutes, and announcements behind it must not wait.
            tokio::spawn(crate::api::ingest_announced(state.clone(), body));
        }
        Announcement::Ping { .. } => {}
    }
}

#[cfg(test)]
#[path = "bus.test.rs"]
mod tests;
