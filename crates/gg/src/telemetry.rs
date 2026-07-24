//! The gg telemetry **emitter**: serializes
//! [`GgTelemetryEvent`]s to **NDJSON**, one event per line, on a pluggable
//! [`EventSink`] (stdout in production).
//!
//! Because gg is [headless](test_cabinet_core::gg), this stream is the only live
//! window into a run — the backend and console read it natively. The wire schema
//! (v1) is owned by `core`; this module only stamps events with an RFC 3339
//! timestamp and the session id, serializes them, and hands each line to the sink.
//!
//! The sink is an injection seam: production writes to stdout and **flushes each
//! line** so the live monitor sees activity as it happens, while a test can collect
//! the emitted lines into memory and assert on the exact stream (see the
//! `#[cfg(test)]` `CollectingSink`). The transport is stdout NDJSON for now; a
//! dedicated live channel to the backend is part of gg's own transport work.
//!
//! TODO(gg-integration): the reserved agent/issue ids get populated once subagents
//! (Phase 4) and the issue board (Phase 3) exist.

use std::io::Write;

use test_cabinet_core::gg::{GgTelemetryEvent, GgTelemetryKind};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

/// A destination for serialized telemetry lines.
///
/// The [`Emitter`] owns serialization and framing; a sink only receives the finished
/// NDJSON line (no trailing newline) and is responsible for writing it out. The
/// default [`StdoutSink`] writes to stdout and flushes per line; tests substitute an
/// in-memory sink to capture the stream. Implementations take `&self` (the emitter is
/// shared across the async loop as `&Emitter`), so any state a sink keeps must use
/// interior mutability.
pub trait EventSink: Send + Sync {
    /// Write one already-serialized NDJSON line (without the terminating newline).
    fn write_line(&self, line: &str);
}

/// The production sink: writes each telemetry line to stdout and **flushes
/// immediately**, so the live monitor observes events as they are emitted rather
/// than when an OS buffer happens to drain.
pub struct StdoutSink;

impl EventSink for StdoutSink {
    fn write_line(&self, line: &str) {
        let mut stdout = std::io::stdout().lock();
        if let Err(err) = writeln!(stdout, "{line}").and_then(|()| stdout.flush()) {
            eprintln!("gg: failed to write telemetry event: {err}");
        }
    }
}

/// Writes the first-party telemetry stream as NDJSON to its [`EventSink`].
///
/// Every event it emits carries the [`session_id`](Self::session_id) it was built
/// with and a fresh [`now_rfc3339`] timestamp.
pub struct Emitter {
    /// The session id stamped onto every emitted event, when known.
    session_id: Option<String>,
    /// Where serialized lines are written. Stdout in production; injectable for tests.
    sink: Box<dyn EventSink>,
}

impl Emitter {
    /// Build an emitter that stamps `session_id` onto every event and writes to
    /// stdout (the production sink).
    pub fn new(session_id: Option<String>) -> Self {
        Self::with_sink(session_id, Box::new(StdoutSink))
    }

    /// Build an emitter writing to an arbitrary `sink`. Used to redirect the stream
    /// in tests; production uses [`Self::new`].
    pub fn with_sink(session_id: Option<String>, sink: Box<dyn EventSink>) -> Self {
        Self { session_id, sink }
    }

    /// Stamp `kind` with the current time and this emitter's session id, then write
    /// it to the sink as one NDJSON line.
    ///
    /// Serialization failures are reported on stderr and otherwise ignored —
    /// telemetry is best-effort and must never abort the run it is observing.
    pub fn emit(&self, kind: GgTelemetryKind) {
        let mut event = GgTelemetryEvent::new(now_rfc3339(), kind);
        event.session_id = self.session_id.clone();

        match serde_json::to_string(&event) {
            Ok(line) => self.sink.write_line(&line),
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

/// An in-memory [`EventSink`] that collects emitted NDJSON lines, for tests that
/// assert on the exact telemetry stream. Cloneable so a test can keep a handle to
/// inspect the lines after the emitter has written to it.
#[cfg(test)]
#[derive(Clone, Default)]
pub struct CollectingSink {
    lines: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
}

#[cfg(test)]
impl CollectingSink {
    /// A fresh, empty collecting sink.
    pub fn new() -> Self {
        Self::default()
    }

    /// A snapshot of the lines collected so far, in emission order.
    pub fn lines(&self) -> Vec<String> {
        self.lines.lock().expect("sink lock").clone()
    }

    /// The collected lines parsed back into [`GgTelemetryEvent`]s, asserting each is
    /// well-formed NDJSON. This round-trip is itself a check that the emitted stream
    /// conforms to the wire schema.
    pub fn events(&self) -> Vec<GgTelemetryEvent> {
        self.lines()
            .iter()
            .map(|line| serde_json::from_str(line).expect("emitted line is valid NDJSON"))
            .collect()
    }
}

#[cfg(test)]
impl EventSink for CollectingSink {
    fn write_line(&self, line: &str) {
        self.lines.lock().expect("sink lock").push(line.to_string());
    }
}

#[cfg(test)]
#[path = "telemetry.test.rs"]
mod tests;
