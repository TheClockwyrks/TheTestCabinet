//! The gg telemetry **emitter**: serializes
//! [`GgTelemetryEvent`]s to **NDJSON on
//! stdout**, one event per line.
//!
//! Because gg is [headless](test_cabinet_core::gg), this stream is the only live
//! window into a run — the backend and console read it natively. The wire schema
//! (v1) is owned by `core`; this module only stamps events with an RFC 3339
//! timestamp and the session id and writes them out.
//!
//! TODO(gg-integration): the real turn loop emits the richer events (turn
//! boundaries, tool calls/results, token usage/cost) from here as they happen,
//! and the reserved agent/issue ids get populated once subagents (Phase 4) and the
//! issue board (Phase 3) exist. The transport is stdout NDJSON for now; a
//! dedicated live channel to the backend is part of gg's own transport work.

use std::io::Write;

use test_cabinet_core::gg::{GgTelemetryEvent, GgTelemetryKind};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

/// Writes the first-party telemetry stream to stdout as NDJSON.
///
/// Every event it emits carries the [`session_id`](Self::session_id) it was built
/// with and a fresh [`now_rfc3339`] timestamp.
pub struct Emitter {
    /// The session id stamped onto every emitted event, when known.
    session_id: Option<String>,
}

impl Emitter {
    /// Build an emitter that stamps `session_id` onto every event.
    pub fn new(session_id: Option<String>) -> Self {
        Self { session_id }
    }

    /// Stamp `kind` with the current time and this emitter's session id, then write
    /// it to stdout as one NDJSON line.
    ///
    /// Serialization or write failures are reported on stderr and otherwise ignored
    /// — telemetry is best-effort and must never abort the run it is observing.
    pub fn emit(&self, kind: GgTelemetryKind) {
        let mut event = GgTelemetryEvent::new(now_rfc3339(), kind);
        event.session_id = self.session_id.clone();

        match serde_json::to_string(&event) {
            Ok(line) => {
                let mut stdout = std::io::stdout().lock();
                if let Err(err) = writeln!(stdout, "{line}") {
                    eprintln!("gg: failed to write telemetry event: {err}");
                }
            }
            Err(err) => eprintln!("gg: failed to serialize telemetry event: {err}"),
        }
    }
}

/// The current UTC time as an RFC 3339 string, matching how `core` stamps its own
/// event and record timestamps. Falls back to an empty string only if formatting
/// fails, which it cannot for a valid `now_utc()`.
pub fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default()
}
