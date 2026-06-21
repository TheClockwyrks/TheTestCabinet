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
use test_cabinet_core::{AssetPreview, EventSink, HarnessEvent, PreviewSink};

/// The Tauri event name carrying one live harness event for a run.
pub fn event_channel(run_id: &str) -> String {
    format!("run://{run_id}/event")
}

/// The Tauri event name carrying one live asset-generation preview frame for a
/// run — the desktop equivalent of the worker's `asset_preview` line on its event
/// stream. The payload is a bare [`AssetPreview`]; the run it belongs to is the
/// channel itself.
pub fn preview_channel(run_id: &str) -> String {
    format!("run://{run_id}/preview")
}

/// The Tauri event name carrying a run's terminal outcome (record or error).
pub fn done_channel(run_id: &str) -> String {
    format!("run://{run_id}/done")
}

/// The worker-wide notification channel: one event per run completion, regardless
/// of which run (or none) the UI is currently watching. The desktop equivalent of
/// the worker's `GET /notifications` SSE stream — the console listens to it once
/// to raise completion alerts without holding a per-run subscription open.
pub const NOTIFY_CHANNEL: &str = "notifications://run";

/// A worker-wide run-completion notification, emitted on [`NOTIFY_CHANNEL`].
///
/// Mirrors the worker's `WorkerNotification` field-for-field so the console
/// deserializes both transports into one notification type: a `completed` run
/// carries the `recordId` to open; a `failed` run carries the `message`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunNotification {
    /// The notification kind; only `run-completed` exists today.
    pub kind: &'static str,
    /// The live stream/job id the run was observed under.
    pub job_id: String,
    /// The test-case slug that ran.
    pub test_case_slug: String,
    /// The variant that ran.
    pub variant: String,
    /// The harness that drove the run, as its slug string.
    pub harness_slug: String,
    /// The model id passed to the harness.
    pub model_id: String,
    /// How the run ended: `completed` (produced a record) or `failed`.
    pub outcome: &'static str,
    /// The produced record's id, present when `outcome` is `completed`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record_id: Option<String>,
    /// The failure reason, present when `outcome` is `failed`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
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

/// A [`PreviewSink`] that forwards each live asset-generation preview frame to the
/// webview, so the run monitor can watch the sprite take shape.
///
/// Mirrors [`WebviewEventSink`] on the run's preview channel. It takes `&self` (the
/// trait requires it) so the orchestrator can share it with the background listener
/// task running alongside the harness session.
pub struct WebviewPreviewSink {
    app: AppHandle,
    channel: String,
}

impl WebviewPreviewSink {
    /// Forward this run's preview frames to `app` on the run's preview channel.
    pub fn new(app: AppHandle, run_id: &str) -> Self {
        Self {
            app,
            channel: preview_channel(run_id),
        }
    }
}

impl PreviewSink for WebviewPreviewSink {
    fn preview(&self, preview: AssetPreview) {
        // Like an event emit, a failed send (the window closed) must not affect the
        // run; the preview is non-essential, so drop it.
        let _ = self.app.emit(&self.channel, preview);
    }
}
