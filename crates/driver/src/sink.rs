//! Backend-streaming event and preview sinks, with a draining relay task.
//!
//! The driver streams a run's live events straight to the backend, which stores
//! them and relays them to the console. But the engine's sink traits are
//! **synchronous** ([`EventSink::emit`](crate::EventSink::emit) takes
//! `&mut self`, [`PreviewSink::preview`](crate::PreviewSink::preview)
//! takes `&self`), while sending over HTTP is async. So each sink does the only
//! thing it can synchronously: push the item onto an unbounded channel
//! ([`RelaySender`]). A single [`relay_task`] drains that channel and makes the
//! async backend calls.
//!
//! The relay delivers events as the driver's events page describes under
//! "Delivery to the backend": it numbers a job's events with a sequence that
//! starts at `0` and rises by one per event, and posts them as
//! [`EventBatch`]es, one batch at a time, in sequence order. A batch is held
//! fixed until the backend acknowledges it: while the backend is unreachable or
//! answers `5xx`, `408` or `429`, the same batch is sent again under the driver's
//! [retry policy](crate::retry), and events emitted in the meantime wait in the
//! channel for the next batch. A batch the backend refuses (a `4xx` other than
//! `408` and `429`) can never be acknowledged, so it is logged and abandoned
//! rather than blocking the relay; so is a batch whose wait passes without an
//! answer. Either leaves the stored stream incomplete, which the relay reports
//! as [`RelayOutcome::Undelivered`].
//!
//! Every batch is bounded by a [`BatchLimit`], in events and in serialized
//! bytes, well under the backend's request body limit. A backlog larger than
//! that (the events that piled up while a batch was being resent through an
//! outage) is posted as several batches, contiguous in sequence, one at a time,
//! so its size can never earn a refusal that would leave the stream incomplete.
//!
//! Preview frames travel outside the sequence: each is posted once, best-effort,
//! after the events queued before it, and never stored.
//!
//! The relay runs for the whole run and is **awaited after the sinks are
//! dropped** (which closes the channel): only then is every batch settled, so a
//! terminal status sent after it finds the stored stream complete. A path that
//! cannot drop every sender first (the `SIGTERM` handling) waits on the shared
//! [`RelayProgress`] instead, for every event emitted so far to be acknowledged.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};
use tokio::sync::watch;

use crate::client::JobClient;
use crate::event::HarnessEvent;
use crate::job_api::EventBatch;
use crate::preview::AssetPreview;
use crate::retry::{RetryEnd, RetryPolicy, retry_call};
use crate::sigterm::{Stage, StageCell};

/// The bound on one event batch. A batch is closed before the event that would
/// take it past either bound; an event that alone exceeds `bytes` is posted as a
/// batch of its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BatchLimit {
    /// The most events one batch carries.
    pub events: usize,
    /// The most bytes one batch's JSON body takes.
    pub bytes: usize,
}

impl BatchLimit {
    /// The relay's bound: 1,000 events or 1 MiB of JSON, half of the 2 MB request
    /// body the backend's events route accepts.
    pub const DEFAULT: Self = Self {
        events: 1_000,
        bytes: 1 << 20,
    };
}

/// axum's default request body limit, which the backend's events route keeps.
const BACKEND_BODY_LIMIT: usize = 2 * 1024 * 1024;

// The default bound stays well under what the backend accepts.
const _: () = assert!(BatchLimit::DEFAULT.bytes <= BACKEND_BODY_LIMIT / 2);

impl Default for BatchLimit {
    fn default() -> Self {
        Self::DEFAULT
    }
}

/// The bytes an [`EventBatch`]'s JSON takes beside its events: the braces, both
/// keys, the widest sequence number and the array's brackets.
const BATCH_ENVELOPE_BYTES: usize = r#"{"sequence":18446744073709551615,"events":[]}"#.len();

/// One item handed to the relay: a harness event or an asset-preview frame. They
/// share one channel so the relay drains them in production order, then splits
/// them (events batched, previews individual) when it posts.
#[derive(Debug, Clone)]
pub enum Outbound {
    /// A normalized harness event, to be numbered and batched.
    Event(HarnessEvent),
    /// A live asset-generation preview frame, posted individually.
    Preview(AssetPreview),
}

/// How a relay's events fared.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelayOutcome {
    /// The backend acknowledged every batch: the stored stream is complete.
    Delivered,
    /// At least one batch was refused, or its wait passed without an
    /// acknowledgement, and was abandoned: the stored stream is incomplete.
    Undelivered,
}

/// What the relay has settled so far, shared through [`RelayProgress`].
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct Settled {
    /// Events the backend acknowledged.
    acknowledged: u64,
    /// Events in batches the relay abandoned.
    abandoned: u64,
    /// Whether the relay has returned: nothing more will settle.
    finished: bool,
}

/// The shared account of a relay's progress: how many events were emitted onto
/// its channel and how many the relay has settled, acknowledged or abandoned.
#[derive(Debug)]
pub struct RelayProgress {
    emitted: AtomicU64,
    settled: watch::Sender<Settled>,
}

impl RelayProgress {
    fn new() -> Self {
        Self {
            emitted: AtomicU64::new(0),
            settled: watch::Sender::new(Settled::default()),
        }
    }

    /// Wait until every event emitted so far has been settled, and say whether
    /// every event of the relay's so far, those included, was acknowledged.
    ///
    /// Events emitted after the call are not waited for. It resolves at once when
    /// the relay has returned, with [`RelayOutcome::Undelivered`] when events it
    /// never settled remain. The caller bounds the wait with its own timeout.
    pub async fn acknowledged(&self) -> RelayOutcome {
        let target = self.emitted.load(Ordering::SeqCst);
        let mut settled = self.settled.subscribe();
        let state = match settled
            .wait_for(|s| s.finished || s.acknowledged + s.abandoned >= target)
            .await
        {
            Ok(state) => *state,
            // The sender lives in `self`, so it cannot have been dropped.
            Err(_) => *self.settled.borrow(),
        };
        if state.abandoned == 0 && state.acknowledged >= target {
            RelayOutcome::Delivered
        } else {
            RelayOutcome::Undelivered
        }
    }

    /// The number of events the backend has acknowledged.
    pub fn acknowledged_count(&self) -> u64 {
        self.settled.borrow().acknowledged
    }

    fn settle(&self, events: u64, acknowledged: bool) {
        self.settled.send_modify(|s| {
            if acknowledged {
                s.acknowledged += events;
            } else {
                s.abandoned += events;
            }
        });
    }

    fn finish(&self) {
        self.settled.send_modify(|s| s.finished = true);
    }
}

/// An item handed to a relay that has stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("the relay has stopped")]
pub struct RelayClosed;

/// The sending half of the relay channel, cloned into the two sinks. It counts
/// every event it sends in the shared [`RelayProgress`].
#[derive(Debug, Clone)]
pub struct RelaySender {
    tx: UnboundedSender<Outbound>,
    progress: Arc<RelayProgress>,
}

impl RelaySender {
    /// Hand `item` to the relay. An error means the relay has stopped (its
    /// receiver dropped); the item is discarded and not counted then.
    pub fn send(&self, item: Outbound) -> Result<(), RelayClosed> {
        let is_event = matches!(item, Outbound::Event(_));
        if is_event {
            self.progress.emitted.fetch_add(1, Ordering::SeqCst);
        }
        self.tx.send(item).map_err(|_| {
            if is_event {
                self.progress.emitted.fetch_sub(1, Ordering::SeqCst);
            }
            RelayClosed
        })
    }

    /// The relay's shared progress.
    pub fn progress(&self) -> Arc<RelayProgress> {
        self.progress.clone()
    }
}

/// The receiving half of the relay channel, handed to [`relay_task`].
#[derive(Debug)]
pub struct RelayReceiver {
    rx: UnboundedReceiver<Outbound>,
    progress: Arc<RelayProgress>,
}

impl RelayReceiver {
    /// The relay's shared progress.
    pub fn progress(&self) -> Arc<RelayProgress> {
        self.progress.clone()
    }
}

/// Create the relay channel. Returns the sending half (cloned into the two sinks)
/// and the receiving half (handed to [`relay_task`]), sharing one
/// [`RelayProgress`].
pub fn channel() -> (RelaySender, RelayReceiver) {
    let (tx, rx) = unbounded_channel();
    let progress = Arc::new(RelayProgress::new());
    (
        RelaySender {
            tx,
            progress: progress.clone(),
        },
        RelayReceiver { rx, progress },
    )
}

/// An [`EventSink`](crate::EventSink) that forwards each event onto
/// the relay channel. The push is synchronous and non-blocking; the relay does
/// the async send.
pub struct BackendEventSink {
    tx: RelaySender,
    stage: Option<Arc<StageCell>>,
}

impl BackendEventSink {
    /// Build a sink that pushes onto `tx`.
    pub fn new(tx: RelaySender) -> Self {
        Self { tx, stage: None }
    }

    /// Also move `stage` through the stages the run engine reports, for the
    /// driver's `SIGTERM` handling.
    pub fn with_stage(mut self, stage: Arc<StageCell>) -> Self {
        self.stage = Some(stage);
        self
    }
}

impl crate::EventSink for BackendEventSink {
    fn emit(&mut self, event: &HarnessEvent) {
        // A send error only means the relay has stopped (its receiver dropped),
        // which the driver only does after the run ends; an event arriving then is
        // safely discarded rather than panicking the run.
        let _ = self.tx.send(Outbound::Event(event.clone()));
    }

    fn stage(&mut self, stage: Stage) {
        if let Some(cell) = &self.stage {
            cell.set(stage);
        }
    }
}

/// A [`PreviewSink`](crate::PreviewSink) that forwards each live
/// preview frame onto the relay channel. Takes `&self` (the trait requires it) so
/// the orchestrator can share it with the background listener task; it just
/// pushes, like the event sink.
pub struct BackendPreviewSink {
    tx: RelaySender,
}

impl BackendPreviewSink {
    /// Build a sink that pushes onto `tx`.
    pub fn new(tx: RelaySender) -> Self {
        Self { tx }
    }
}

impl crate::PreviewSink for BackendPreviewSink {
    fn preview(&self, preview: AssetPreview) {
        let _ = self.tx.send(Outbound::Preview(preview));
    }
}

/// Drain the relay channel, delivering items to the backend until it closes, and
/// say whether every event was acknowledged.
///
/// On each wakeup it takes the first ready item, then greedily drains everything
/// else already queued (`try_recv`), so a burst of events coalesces into one
/// batch rather than a request per event. A preview flushes the events queued
/// before it, so order is kept, and is then posted once; a failed preview is
/// logged and dropped. The events drained are posted in batches no larger than
/// [`BatchLimit::DEFAULT`], each delivered under `policy`, the driver's report
/// wait, as the module documentation describes. The channel closes when every
/// [`RelaySender`] drops; the task then flushes any final batch and returns.
pub async fn relay_task(
    client: Arc<JobClient>,
    receiver: RelayReceiver,
    policy: RetryPolicy,
) -> RelayOutcome {
    relay_task_with_limit(client, receiver, policy, BatchLimit::DEFAULT).await
}

/// [`relay_task`] with each batch bounded by `limit` rather than the default.
pub async fn relay_task_with_limit(
    client: Arc<JobClient>,
    receiver: RelayReceiver,
    policy: RetryPolicy,
    limit: BatchLimit,
) -> RelayOutcome {
    let RelayReceiver { mut rx, progress } = receiver;
    let mut relay = Relay {
        client,
        policy,
        limit,
        progress,
        next_sequence: 0,
        undelivered: false,
    };
    while let Some(first) = rx.recv().await {
        let mut pending: Vec<HarnessEvent> = Vec::new();
        let mut item = Some(first);
        loop {
            match item.take() {
                Some(Outbound::Event(event)) => pending.push(event),
                Some(Outbound::Preview(preview)) => {
                    relay.deliver(std::mem::take(&mut pending)).await;
                    if let Err(err) = relay.client.post_preview(&preview).await {
                        tracing::warn!(error = %err, "relaying preview frame to the backend failed");
                    }
                }
                None => {}
            }
            match rx.try_recv() {
                Ok(next) => item = Some(next),
                Err(_) => break,
            }
        }
        relay.deliver(pending).await;
    }
    relay.progress.finish();
    if relay.undelivered {
        RelayOutcome::Undelivered
    } else {
        RelayOutcome::Delivered
    }
}

/// Close the relay channel by dropping the driver's own sender `tx`, then wait
/// for the relay `task` to settle every batch, and say how its events fared.
///
/// This is what every terminal status waits on: only [`RelayOutcome::Delivered`]
/// lets one be posted. A relay task that panicked or was aborted settled nothing
/// it can vouch for, so it reads as [`RelayOutcome::Undelivered`].
pub async fn settle(tx: RelaySender, task: tokio::task::JoinHandle<RelayOutcome>) -> RelayOutcome {
    drop(tx);
    match task.await {
        Ok(outcome) => outcome,
        Err(err) => {
            tracing::warn!(error = %err, "the event relay task did not finish");
            RelayOutcome::Undelivered
        }
    }
}

/// The relay's delivery state.
struct Relay {
    client: Arc<JobClient>,
    policy: RetryPolicy,
    limit: BatchLimit,
    progress: Arc<RelayProgress>,
    /// The sequence of the next event to be batched.
    next_sequence: u64,
    /// Whether any batch was abandoned.
    undelivered: bool,
}

impl Relay {
    /// Deliver `events` in order, as consecutive batches each within the relay's
    /// [`BatchLimit`], each settled before the next is posted.
    async fn deliver(&mut self, events: Vec<HarnessEvent>) {
        let mut batch: Vec<HarnessEvent> = Vec::new();
        let mut bytes = BATCH_ENVELOPE_BYTES;
        for event in events {
            // An event that cannot be serialized fails the batch's own
            // serialization too; counting it as empty keeps it in a batch, whose
            // post then reports the error.
            let size = serde_json::to_vec(&event).map_or(0, |json| json.len());
            // The comma that separates it from the event before it.
            let added = size + usize::from(!batch.is_empty());
            if !batch.is_empty()
                && (batch.len() >= self.limit.events || bytes + added > self.limit.bytes)
            {
                self.deliver_batch(std::mem::take(&mut batch)).await;
                bytes = BATCH_ENVELOPE_BYTES;
                batch.push(event);
                bytes += size;
            } else {
                batch.push(event);
                bytes += added;
            }
        }
        self.deliver_batch(batch).await;
    }

    /// Deliver `events` as one batch, numbered from the next sequence, holding it
    /// until the backend acknowledges it, refuses it or its wait passes. The
    /// sequence advances past the batch whatever its fate, so a batch the backend
    /// stored without the driver hearing so is never overwritten by later events.
    async fn deliver_batch(&mut self, events: Vec<HarnessEvent>) {
        if events.is_empty() {
            return;
        }
        let count = events.len() as u64;
        let batch = EventBatch {
            sequence: self.next_sequence,
            events,
        };
        self.next_sequence += count;
        let client = &self.client;
        let result = retry_call(&self.policy, "events", std::future::pending(), || {
            client.post_events(&batch)
        })
        .await;
        match result {
            Ok(()) => self.progress.settle(count, true),
            Err(failure) => {
                let reason = match failure.end {
                    RetryEnd::Refused => "the backend refused it",
                    RetryEnd::GaveUp => "its wait passed without an acknowledgement",
                    RetryEnd::Canceled => "the relay was canceled",
                };
                tracing::warn!(
                    sequence = batch.sequence,
                    count,
                    error = %failure,
                    "abandoning an event batch: {reason}; the stored stream is incomplete",
                );
                self.undelivered = true;
                self.progress.settle(count, false);
            }
        }
    }
}

#[cfg(test)]
#[path = "sink.test.rs"]
mod tests;
