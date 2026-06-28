//! The live **publish** relay: the backend's in-memory fan-out of an in-flight
//! publish job's progress to live subscribers.
//!
//! A publish is carried out by a per-publish Job pod (the `tcab-publisher`), not
//! the backend, so the backend never runs the gh/wrangler release — it **relays**
//! one. The publisher streams progress lines to the backend over HTTP
//! (`POST /publish-jobs/{id}/events`) and reports a terminal result
//! (`POST /publish-jobs/{id}/result`); the relay records them per publish job and
//! fans them out to every live subscriber on `GET /publish-jobs/{id}/live` (NDJSON).
//! A late subscriber is replayed the backlog before the live tail, so it never
//! misses progress between dispatch and connect, and — if it connects after the
//! publish already finished — the retained terminal item still closes its stream.
//!
//! This is the publish path's analogue of the run [`crate::relay`]; it is kept
//! separate so the run path's event/preview relay is untouched, and it carries the
//! publish wire shapes ([`PublishProgress`] / [`PublishResult`]) rather than harness
//! events. Like the run relay it is deliberately **in-memory and transient**: the
//! durable record is the `publish_job` table and the published `run`. A backend
//! restart drops the live buffers; a subscriber that reconnects afterward falls
//! back to the persisted publish-job state. Losing the live buffer never loses the
//! publish.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use test_cabinet_core::{PublishProgress, PublishResult};
use tokio::sync::broadcast;

/// The capacity of each publish job's live broadcast channel. A publish emits few
/// items (a handful of progress lines then one terminal result), so a small buffer
/// is ample; the full ordered history is always available from the backlog, so a
/// lagged slow subscriber never loses an item for a fresh one.
const PUBLISH_CHANNEL_CAPACITY: usize = 256;

/// An item delivered to a publish job's live stream: a progress line, or the
/// terminal result that lets a streaming client close cleanly.
#[derive(Debug, Clone)]
pub enum PublishStreamItem {
    /// A progress line streamed while the release runs.
    Progress(Box<PublishProgress>),
    /// The terminal outcome of the release; no further items will arrive. Carried
    /// on the stream so a subscriber — including a late one replayed from the
    /// backlog — sees the result and closes.
    Result(Box<PublishResult>),
}

/// One publish job's shared live state: the ordered backlog of items emitted so
/// far (progress lines and, once finished, the terminal result), behind a `Mutex`
/// because ingestion writes it while live subscribers read it.
#[derive(Debug, Default)]
struct LiveInner {
    /// Every item emitted, in order. The terminal [`PublishStreamItem::Result`],
    /// once pushed, is the last entry and also flips `terminated`.
    backlog: Vec<PublishStreamItem>,
    /// Whether the publish has reached its terminal result. A late subscriber to a
    /// terminated publish drains the backlog (which ends in the result) and closes
    /// without waiting on the channel.
    terminated: bool,
}

/// A handle to one publish job's live relay: its shared backlog plus the live
/// broadcast. Cloning shares the same underlying state (it is `Arc`-backed).
#[derive(Debug, Clone)]
pub struct LivePublish {
    inner: Arc<Mutex<LiveInner>>,
    tx: broadcast::Sender<PublishStreamItem>,
}

impl LivePublish {
    /// Append a progress line to the backlog and publish it to every live
    /// subscriber. Recording under the lock before broadcasting keeps a fresh
    /// subscriber's replayed backlog consistent with the live items it then
    /// receives. A no-op after the terminal result has been pushed.
    pub fn push_progress(&self, progress: PublishProgress) {
        {
            let mut inner = self.inner.lock().expect("publish relay mutex poisoned");
            if inner.terminated {
                return;
            }
            inner
                .backlog
                .push(PublishStreamItem::Progress(Box::new(progress.clone())));
        }
        // A send error only means there are no live subscribers, which is fine —
        // the item is in the backlog for a later one.
        let _ = self
            .tx
            .send(PublishStreamItem::Progress(Box::new(progress)));
    }

    /// Record the terminal result, mark the publish finished, and signal every live
    /// stream to close after delivering it. Idempotent — a second terminal result
    /// (e.g. a retried report) is ignored so the recorded outcome is the first one.
    pub fn finish(&self, result: PublishResult) {
        {
            let mut inner = self.inner.lock().expect("publish relay mutex poisoned");
            if inner.terminated {
                return;
            }
            inner.terminated = true;
            inner
                .backlog
                .push(PublishStreamItem::Result(Box::new(result.clone())));
        }
        let _ = self.tx.send(PublishStreamItem::Result(Box::new(result)));
    }

    /// Subscribe to the publish job's live stream: the backlog accumulated so far
    /// (replayed in order, ending in the terminal result if it has finished), a
    /// live receiver for everything published afterward, and whether the publish is
    /// already terminal. The backlog is snapshotted under the same lock that gates
    /// appends, so no item falls between the snapshot and the subscription.
    pub fn subscribe(&self) -> PublishSubscription {
        let inner = self.inner.lock().expect("publish relay mutex poisoned");
        let backlog = inner.backlog.clone();
        let terminated = inner.terminated;
        let receiver = self.tx.subscribe();
        drop(inner);
        PublishSubscription {
            backlog,
            receiver,
            terminated,
        }
    }
}

/// What a new publish-stream subscriber receives: the replayed backlog, a live
/// receiver, and whether the publish had already finished at subscribe time (so the
/// stream closes once the backlog — which then ends in the terminal result — is
/// drained).
pub struct PublishSubscription {
    /// Items accumulated before this subscription, replayed in order.
    pub backlog: Vec<PublishStreamItem>,
    /// Live items published after this subscription was taken.
    pub receiver: broadcast::Receiver<PublishStreamItem>,
    /// Whether the publish was already terminal when subscribed.
    pub terminated: bool,
}

/// The set of live publish relays, keyed by publish-job id. Cloning shares the same
/// underlying state (it is `Arc`-backed), so the router state, the ingestion
/// handlers, and the subscribe handler all see one relay.
#[derive(Clone, Default)]
pub struct PublishRelay {
    jobs: Arc<Mutex<HashMap<String, LivePublish>>>,
}

impl PublishRelay {
    /// Create an empty publish relay.
    pub fn new() -> Self {
        Self::default()
    }

    /// The live relay for a publish job, creating an empty one if none exists yet.
    /// Both the publisher's first progress ingestion and a subscriber connecting
    /// before it land here; whichever arrives first creates the shared state.
    pub fn live(&self, id: &str) -> LivePublish {
        let mut jobs = self
            .jobs
            .lock()
            .expect("publish relay registry mutex poisoned");
        jobs.entry(id.to_string())
            .or_insert_with(|| {
                let (tx, _rx) = broadcast::channel(PUBLISH_CHANNEL_CAPACITY);
                LivePublish {
                    inner: Arc::new(Mutex::new(LiveInner::default())),
                    tx,
                }
            })
            .clone()
    }
}

#[cfg(test)]
#[path = "publish_relay.test.rs"]
mod tests;
