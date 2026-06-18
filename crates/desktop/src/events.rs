//! Bridging the core's live [`HarnessEvent`] stream to the webview.
//!
//! The core orchestrator drives a run and emits normalized
//! [`HarnessEvent`](test_cabinet_core::HarnessEvent)s to an
//! [`EventSink`](test_cabinet_core::EventSink) as the harness works. The desktop
//! shell forwards each one to the frontend as a Tauri event so the UI can render
//! the live activity feed without the run blocking the command that launched it.
//!
//! Events are namespaced per run (`run://<id>/event`) so a window can subscribe
//! to exactly the run it launched, and the run's terminal record is delivered on
//! a sibling `run://<id>/done` channel.

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use test_cabinet_core::{EventSink, HarnessEvent};

/// The Tauri event name carrying one live harness event for a run.
pub fn event_channel(run_id: &str) -> String {
    format!("run://{run_id}/event")
}

/// The Tauri event name carrying a run's terminal outcome (record or error).
pub fn done_channel(run_id: &str) -> String {
    format!("run://{run_id}/done")
}

/// An [`EventSink`] that forwards each harness event to the webview.
///
/// Each emitted event is tagged with the launch-assigned `run_id` so the UI can
/// correlate a feed line with the run it belongs to even if several are observed.
pub struct WebviewEventSink {
    app: AppHandle,
    run_id: String,
    channel: String,
}

impl WebviewEventSink {
    /// Forward this run's events to `app` on the run's event channel.
    pub fn new(app: AppHandle, run_id: String) -> Self {
        let channel = event_channel(&run_id);
        Self {
            app,
            run_id,
            channel,
        }
    }
}

/// The payload delivered to the webview for one live event: the run it belongs
/// to plus the normalized harness event itself.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveEvent<'a> {
    run_id: &'a str,
    event: &'a HarnessEvent,
}

impl EventSink for WebviewEventSink {
    fn emit(&mut self, event: &HarnessEvent) {
        // A failed emit (for example, the window closed mid-run) must not abort
        // the run; the record is still written to disk regardless. Drop it.
        let _ = self.app.emit(
            &self.channel,
            LiveEvent {
                run_id: &self.run_id,
                event,
            },
        );
    }
}
