//! The worker-wide notification stream endpoint.
//!
//! `GET /notifications` is a Server-Sent Events stream of
//! [`WorkerNotification`](crate::notify::WorkerNotification)s — one per run
//! completion across the whole worker. The console subscribes once (an
//! `EventSource`) to raise completion alerts without polling and without holding
//! a per-run subscription open. The stream is live-only: it replays no backlog,
//! so a client connecting after a run finished does not see that completion
//! (the run is already a produced run by then).

use std::convert::Infallible;

use axum::extract::State;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::stream::{self, Stream};
use tokio::sync::broadcast::error::RecvError;

use crate::api::AppState;

/// `GET /notifications` — stream worker-wide run-completion notifications as SSE.
///
/// Each event's `data` is one [`WorkerNotification`](crate::notify::WorkerNotification)
/// as JSON. A keep-alive comment is sent periodically so idle connections (and
/// the proxies between) stay open between runs. A subscriber that falls behind is
/// lagged (the gap is skipped) rather than blocking a run.
pub async fn notifications(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let receiver = state.notifier.subscribe();
    let stream = stream::unfold(receiver, |mut receiver| async move {
        loop {
            match receiver.recv().await {
                Ok(notification) => {
                    // Serialization of a notification cannot meaningfully fail
                    // (plain JSON-safe scalars); fall back to an empty event in
                    // the impossible error case rather than ending the stream.
                    let event = Event::default()
                        .json_data(&notification)
                        .unwrap_or_else(|_| Event::default());
                    return Some((Ok(event), receiver));
                }
                // Skip the lagged window and keep streaming the latest events.
                Err(RecvError::Lagged(_)) => continue,
                // The sender was dropped (worker shutting down); end the stream.
                Err(RecvError::Closed) => return None,
            }
        }
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}
