//! Backend-streaming event and preview sinks, with a draining relay task.
//!
//! The worker recorded a run's live events onto an in-memory job and served them
//! from there; the driver has no such registry — it streams them straight to the
//! backend, which relays them to the console. But the core's sink traits are
//! **synchronous** ([`EventSink::emit`](test_cabinet_core::EventSink::emit) takes
//! `&mut self`, [`PreviewSink::preview`](test_cabinet_core::PreviewSink::preview)
//! takes `&self`), while sending over HTTP is async. So each sink does the only
//! thing it can synchronously: push the item onto an unbounded channel. A single
//! [`relay_task`] drains that channel and performs the async backend calls,
//! **batching** every event ready in one drain into a single `post_events` (the
//! events endpoint takes a batch) and posting previews individually.
//!
//! The engine's announcement that the harness session has ended
//! ([`EventSink::session_ended`](test_cabinet_core::EventSink::session_ended))
//! rides the same channel, so the relay reports the job `validating` only after
//! every event the session produced has been posted: a console never shows a run
//! validating while the session's last events are still arriving.
//!
//! The relay runs for the whole run and must be **awaited after the sinks are
//! dropped** (which closes the channel): only then is the backlog guaranteed
//! flushed to the backend before the terminal status — carrying the record — is
//! sent, so the relay's accumulated events are complete when the backend persists
//! the run from them.

use std::sync::Arc;

use test_cabinet_core::event::HarnessEvent;
use test_cabinet_core::preview::AssetPreview;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};

use crate::client::JobClient;

/// One item handed to the relay: a harness event, an asset-preview frame, or the
/// end of the harness session. They share one channel so the relay drains them in
/// production order, then splits them — events batched, previews individual, the
/// session's end as a status report — when it posts.
#[derive(Debug, Clone)]
pub enum Outbound {
    /// A normalized harness event, to be batched into `post_events`.
    Event(HarnessEvent),
    /// A live asset-generation preview frame, posted individually.
    Preview(AssetPreview),
    /// The harness session has ended. The relay flushes every event queued before
    /// it, then reports the job `validating`.
    SessionEnded,
}

/// Create the relay channel. Returns the sending half (cloned into the two sinks)
/// and the receiving half (handed to [`relay_task`]).
pub fn channel() -> (UnboundedSender<Outbound>, UnboundedReceiver<Outbound>) {
    unbounded_channel()
}

/// An [`EventSink`](test_cabinet_core::EventSink) that forwards each event onto
/// the relay channel. The push is synchronous and non-blocking; the relay does
/// the async send.
pub struct BackendEventSink {
    tx: UnboundedSender<Outbound>,
}

impl BackendEventSink {
    /// Build a sink that pushes onto `tx`.
    pub fn new(tx: UnboundedSender<Outbound>) -> Self {
        Self { tx }
    }
}

impl test_cabinet_core::EventSink for BackendEventSink {
    fn emit(&mut self, event: &HarnessEvent) {
        // A send error only means the relay has stopped (its receiver dropped),
        // which the driver only does after the run ends; an event arriving then is
        // safely discarded rather than panicking the run.
        let _ = self.tx.send(Outbound::Event(event.clone()));
    }

    fn session_ended(&mut self) {
        // Queued behind every event the session emitted, so the relay posts them
        // all before it reports the job `validating`.
        let _ = self.tx.send(Outbound::SessionEnded);
    }
}

/// A [`PreviewSink`](test_cabinet_core::PreviewSink) that forwards each live
/// preview frame onto the relay channel. Takes `&self` (the trait requires it) so
/// the orchestrator can share it with the background listener task; it just
/// pushes, like the event sink.
pub struct BackendPreviewSink {
    tx: UnboundedSender<Outbound>,
}

impl BackendPreviewSink {
    /// Build a sink that pushes onto `tx`.
    pub fn new(tx: UnboundedSender<Outbound>) -> Self {
        Self { tx }
    }
}

impl test_cabinet_core::PreviewSink for BackendPreviewSink {
    fn preview(&self, preview: AssetPreview) {
        let _ = self.tx.send(Outbound::Preview(preview));
    }
}

/// Drain the relay channel, streaming items to the backend until it closes.
///
/// On each wakeup it takes the first ready item, then greedily drains everything
/// else already queued (`try_recv`), so a burst of events coalesces into one
/// `post_events` batch rather than a request per event. Previews are posted one
/// at a time, in order relative to the events around them. The channel closes
/// when both sink halves drop; the task then flushes any final batch and returns.
///
/// The end of the session flushes the pending batch, then reports the job
/// `validating` (`POST /jobs/{id}/status`), so the report follows every event that
/// preceded it.
///
/// A failed backend call is logged and the item dropped, not fatal: live
/// streaming is best-effort (the authoritative record is sent with the terminal
/// status), so a transient relay error must not abort the run. A lost `validating`
/// report only leaves the console showing the run `running` until its terminal
/// report.
pub async fn relay_task(client: Arc<JobClient>, mut rx: UnboundedReceiver<Outbound>) {
    while let Some(first) = rx.recv().await {
        // Coalesce this wakeup's ready items into one drain, preserving order:
        // contiguous events accumulate into a batch, and a preview flushes the
        // pending batch before it is posted so events never reorder around it.
        let mut batch: Vec<HarnessEvent> = Vec::new();
        let mut item = Some(first);
        loop {
            match item.take() {
                Some(Outbound::Event(event)) => batch.push(event),
                Some(Outbound::Preview(preview)) => {
                    flush_events(&client, &mut batch).await;
                    if let Err(err) = client.post_preview(&preview).await {
                        tracing::warn!(error = %err, "relaying preview frame to the backend failed");
                    }
                }
                Some(Outbound::SessionEnded) => {
                    flush_events(&client, &mut batch).await;
                    if let Err(err) = client.post_status_validating().await {
                        tracing::warn!(error = %err, "could not report `validating` to the backend; continuing");
                    }
                }
                None => {}
            }
            match rx.try_recv() {
                Ok(next) => item = Some(next),
                Err(_) => break,
            }
        }
        flush_events(&client, &mut batch).await;
    }
}

/// Post the accumulated event batch (if any) and clear it. A failed post is
/// logged, not fatal — see [`relay_task`].
async fn flush_events(client: &JobClient, batch: &mut Vec<HarnessEvent>) {
    if batch.is_empty() {
        return;
    }
    if let Err(err) = client.post_events(batch).await {
        tracing::warn!(error = %err, count = batch.len(), "relaying event batch to the backend failed");
    }
    batch.clear();
}

#[cfg(test)]
#[path = "sink.test.rs"]
mod tests;
