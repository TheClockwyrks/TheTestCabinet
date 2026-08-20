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
//! # Agent scoping
//!
//! An emitter also carries the id of the [agent](crate::agent::Agent) whose stream it
//! stamps, so every event an agent emits is attributed to its node in the
//! [subagent tree](https://docs.testcabinet.ai/gg/subagents/). A base emitter (no agent)
//! is [scoped to an agent](Emitter::for_agent) to obtain a child emitter that shares the
//! same underlying [`sink`](EventSink) but stamps that agent's id and its spawner's id onto
//! every event. Because the sink is shared (an [`Arc`]), each agent — the root today, and
//! spawned subagents in Phase 4B — writes to the one live stream while remaining
//! individually attributable. A subagent dispatched against a board
//! [issue](test_cabinet_core::gg::GgBoardIssue) is [scoped to that issue](Emitter::for_agent_on_issue)
//! so its whole stream also carries the `issue_id` it was dispatched for.

use std::io::Write;
use std::sync::Arc;

use test_cabinet_core::gg::{
    GgHealingStrategy, GgLimitBreach, GgProgramLanguage, GgPromptRef, GgRunLimits,
    GgSessionSummary, GgTelemetryEvent, GgTelemetryKind,
};
use test_cabinet_core::metrics::{Cost, TokenCounts};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::context::PromptItem;
use crate::message_log::{MessagePool, context_message_event, fingerprint};
use crate::model::Message;
use crate::summary::SessionSummaryTracker;

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
/// Every event it emits carries the [`session_id`](Self::session_id) it was built with, a
/// fresh [`now_rfc3339`] timestamp, and — once the emitter is
/// [scoped to an agent](Self::for_agent) — that agent's id, its spawner's id, and (for a
/// subagent dispatched against a board issue) the [issue id](Self::issue_id), so the event is
/// attributable to its node in the subagent tree and to the work it was dispatched for.
///
/// [`Clone`] shares the underlying [`sink`](EventSink) (an [`Arc`]) so the orchestrator can keep
/// a base emitter and derive a fresh [agent-scoped](Self::for_agent) child per spawned subagent,
/// all writing to the one live stream.
#[derive(Clone)]
pub struct Emitter {
    /// The session id stamped onto every emitted event, when known.
    session_id: Option<String>,
    /// The id of the agent whose stream this emitter stamps, once
    /// [scoped](Self::for_agent). `None` on a base emitter (before an agent exists).
    agent_id: Option<String>,
    /// The id of that agent's spawner, once [scoped](Self::for_agent). `None` for the root
    /// agent (no spawner) and on a base emitter.
    parent_agent_id: Option<String>,
    /// The id of the board [issue](test_cabinet_core::gg::GgBoardIssue) this agent's work is
    /// scoped to, when it was [dispatched against one](Self::for_agent_on_issue). `None` for the
    /// root and for subagents spawned from a free-form brief.
    issue_id: Option<String>,
    /// Where serialized lines are written. Stdout in production; injectable for tests.
    /// Shared (`Arc`) so an [agent-scoped](Self::for_agent) child emitter writes to the same
    /// live stream as its parent.
    sink: Arc<dyn EventSink>,
    /// The [session summary tracker](SessionSummaryTracker) every emitted event is folded into,
    /// so the run can compute its aggregatable [`GgSessionSummary`] from exactly the telemetry it
    /// emitted. Shared (`Arc`) across the base emitter and every
    /// [agent-scoped](Self::for_agent) child, so events from the root and every subagent
    /// accumulate into the one summary; [`finalize_summary`](Self::finalize_summary) reads it at
    /// session end.
    summary: Arc<SessionSummaryTracker>,
    /// The per-agent [message pool](MessagePool) backing [`log_prompt`](Self::log_prompt):
    /// which message fingerprints have already been streamed as
    /// [`ContextMessage`](GgTelemetryKind::ContextMessage) definitions on this agent's
    /// stream, so each message's body is emitted once and referenced by id thereafter.
    /// Unlike [`summary`](Self::summary), this is **not** shared across agents — each
    /// [agent-scoped](Self::for_agent) emitter gets a fresh pool so its stream always
    /// carries the definitions its own prompts reference.
    messages: Arc<MessagePool>,
}

impl Emitter {
    /// Build an emitter that stamps `session_id` onto every event and writes to
    /// stdout (the production sink). Not yet scoped to an agent — call
    /// [`for_agent`](Self::for_agent) to obtain the per-agent emitter the loop uses.
    pub fn new(session_id: Option<String>) -> Self {
        Self::with_sink(session_id, Box::new(StdoutSink))
    }

    /// Build an emitter writing to an arbitrary `sink`. Used to redirect the stream
    /// in tests; production uses [`Self::new`]. The boxed sink is shared internally as an
    /// [`Arc`] so agent-scoped children can write to the same stream.
    pub fn with_sink(session_id: Option<String>, sink: Box<dyn EventSink>) -> Self {
        Self {
            session_id,
            agent_id: None,
            parent_agent_id: None,
            issue_id: None,
            sink: Arc::from(sink),
            summary: Arc::new(SessionSummaryTracker::new()),
            messages: Arc::new(MessagePool::new()),
        }
    }

    /// Derive an emitter scoped to the agent `agent_id` (spawned by `parent_agent_id`),
    /// sharing this emitter's session id and underlying [`sink`](EventSink).
    ///
    /// Every event the returned emitter emits is stamped with `agent_id` and
    /// `parent_agent_id`, so an agent's whole stream is attributable to its node in the
    /// [subagent tree](https://docs.testcabinet.ai/gg/subagents/). The root agent passes
    /// `parent_agent_id: None`; a spawned subagent passes its spawner's id. Use
    /// [`for_agent_on_issue`](Self::for_agent_on_issue) when the subagent was dispatched against a
    /// board issue.
    pub fn for_agent(&self, agent_id: impl Into<String>, parent_agent_id: Option<String>) -> Self {
        self.for_agent_on_issue(agent_id, parent_agent_id, None)
    }

    /// Derive an emitter scoped to `agent_id` (spawned by `parent_agent_id`) whose work is
    /// scoped to board [issue](test_cabinet_core::gg::GgBoardIssue) `issue_id`, so every event the
    /// agent emits also carries the issue it was dispatched for. `issue_id: None` is equivalent to
    /// [`for_agent`](Self::for_agent).
    pub fn for_agent_on_issue(
        &self,
        agent_id: impl Into<String>,
        parent_agent_id: Option<String>,
        issue_id: Option<String>,
    ) -> Self {
        Self {
            session_id: self.session_id.clone(),
            agent_id: Some(agent_id.into()),
            parent_agent_id,
            issue_id,
            sink: Arc::clone(&self.sink),
            summary: Arc::clone(&self.summary),
            // A fresh pool per agent: an agent's stream must carry the definitions its own
            // prompts reference (the console reduces the log per agent), so pools are never
            // shared the way the run-wide summary is.
            messages: Arc::new(MessagePool::new()),
        }
    }

    /// Derive an emitter identical to this one but scoped to board
    /// [issue](test_cabinet_core::gg::GgBoardIssue) `issue_id` — the same agent/session/sink, with
    /// the [`issue_id`](Self::issue_id) set. Used to emit an agent's
    /// [issue review](test_cabinet_core::gg::GgTelemetryKind::IssueReview) transitions on the stream of
    /// the issue under review even though the agent that emits them (the one that completed the
    /// issue) was not itself dispatched against that issue, so the issue rides on the event envelope
    /// rather than the payload.
    pub fn with_issue(&self, issue_id: impl Into<String>) -> Self {
        Self {
            issue_id: Some(issue_id.into()),
            ..self.clone()
        }
    }

    /// Stamp `kind` with the current time, this emitter's session id, and — when
    /// [scoped to an agent](Self::for_agent) — that agent's id, its spawner's id, and any
    /// [issue id](Self::issue_id), then write it to the sink as one NDJSON line.
    ///
    /// Serialization failures are reported on stderr and otherwise ignored —
    /// telemetry is best-effort and must never abort the run it is observing.
    pub fn emit(&self, kind: GgTelemetryKind) {
        // Fold the event into the shared session summary before it is serialized, so the
        // computed [`GgSessionSummary`] derives from exactly the stream the run emitted (across
        // the root and every agent-scoped child that shares this tracker).
        self.summary.observe(&kind);

        let mut event = GgTelemetryEvent::new(now_rfc3339(), kind);
        event.session_id = self.session_id.clone();
        event.agent_id = self.agent_id.clone();
        event.parent_agent_id = self.parent_agent_id.clone();
        event.issue_id = self.issue_id.clone();

        match serde_json::to_string(&event) {
            Ok(line) => self.sink.write_line(&line),
            Err(err) => eprintln!("gg: failed to serialize telemetry event: {err}"),
        }
    }

    /// Compute the run's aggregatable [`GgSessionSummary`] from the telemetry accumulated across
    /// every emitter derived from this one, stamped with `terminal_status` (the
    /// [`SessionEnded`](GgTelemetryKind::SessionEnded) status the session is about to report).
    ///
    /// Called once at session end, immediately before emitting the terminal
    /// [`SessionSummary`](GgTelemetryKind::SessionSummary) and
    /// [`SessionEnded`](GgTelemetryKind::SessionEnded) events — so the per-slot rollups the run
    /// streamed just before are already folded in, and the summary excludes only itself and the
    /// `SessionEnded` it precedes.
    pub fn finalize_summary(&self, terminal_status: &str) -> GgSessionSummary {
        self.summary.finalize(terminal_status)
    }

    /// Record the run's [effective toolset](GgSessionSummary::effective_tools) on the shared
    /// [summary tracker](SessionSummaryTracker) — the exact tool names offered to the root agent,
    /// in the order presented to the model.
    ///
    /// Unlike the telemetry-derived counts, the offered toolset is not carried by any event, so the
    /// binary records it once (off the root's assembled [`ToolRegistry`](crate::tools::ToolRegistry))
    /// before [finalizing](Self::finalize_summary). Because the tracker is shared across every
    /// agent-scoped emitter, it does not matter which emitter records it; the loop records it on the
    /// root's.
    pub fn record_effective_tools(&self, tools: Vec<String>) {
        self.summary.record_effective_tools(tools);
    }

    /// Record the run's [execution mode](GgSessionSummary::execution_mode) on the shared
    /// [summary tracker](SessionSummaryTracker) — `"responses_as_code"` when the
    /// [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) capability drove the
    /// run, else `"tool_calling"`. Like [`record_effective_tools`](Self::record_effective_tools) it
    /// is a configuration fact no event carries; the loop records it once (on the root's emitter)
    /// before [finalizing](Self::finalize_summary).
    pub fn record_execution_mode(&self, mode: impl Into<String>) {
        self.summary.record_execution_mode(mode);
    }

    /// Record the run's [program language](GgSessionSummary::program_language) on the shared
    /// [summary tracker](SessionSummaryTracker) — the language the root agent's programs were
    /// written in, or `None` for a tool-calling run, which wrote none.
    ///
    /// Recorded beside [`record_execution_mode`](Self::record_execution_mode) and for the same
    /// reason: no event carries it, and it is the dimension a cross-language study slices its arms
    /// on.
    pub fn record_program_language(&self, language: Option<GgProgramLanguage>) {
        self.summary.record_program_language(language);
    }

    /// Record the [execution ceilings](GgRunLimits) in force for this run on the shared
    /// [summary tracker](SessionSummaryTracker) — the configured set exactly as the orchestrator
    /// resolved it, with an unarmed ceiling recorded as the absence it is.
    ///
    /// Another configuration fact no event carries, so the loop records it once (on the root's
    /// emitter) as soon as the orchestrator has resolved it — long before any ceiling could be
    /// breached, so a run stopped by one carries both the breach and the ceiling that produced it.
    pub fn record_limits(&self, limits: GgRunLimits) {
        self.summary.record_limits(limits);
    }

    /// Record the [response-healing](crate::healing) strategies armed for this run on the shared
    /// [summary tracker](SessionSummaryTracker), in the order gg applies them.
    ///
    /// A fourth configuration fact no event carries, recorded once (on the root's emitter) beside
    /// the ceilings and only for a run that actually runs the pipeline. It is what lets a study
    /// tell a healing-off configuration from a healing-on one without reading the invocation
    /// files: every other healing figure counts what fired, and neither arm fires anything on a
    /// clean run.
    pub fn record_healing(&self, enabled: Vec<GgHealingStrategy>) {
        self.summary.record_healing(enabled);
    }

    /// Record the ceiling that stopped the **run** on the shared
    /// [summary tracker](SessionSummaryTracker), or `None` for a run that ended on its own terms.
    ///
    /// The one summary figure whose event *is* on this stream — a
    /// [`LimitExceeded`](GgTelemetryKind::LimitExceeded) is emitted by every agent that stops on a
    /// ceiling — and is still handed over rather than folded, because every agent's events pass
    /// through the one shared tracker and a subagent's breach is not the run's outcome. The loop
    /// therefore passes the **root** loop's own breach, immediately before
    /// [finalizing](Self::finalize_summary).
    pub fn record_limit_hit(&self, breach: Option<GgLimitBreach>) {
        self.summary.record_limit_hit(breach);
    }

    /// Log one turn's exact request and response to the
    /// [message log](https://docs.testcabinet.ai/gg/context-visibility/): stream the body of
    /// every message not yet seen on this agent's stream (as a
    /// [`ContextMessage`](GgTelemetryKind::ContextMessage)), then a
    /// [`Prompt`](GgTelemetryKind::Prompt) carrying the request as ordered
    /// [pointers](GgPromptRef) into that pool plus the response.
    ///
    /// `request` is the turn's messages in order, each with the [`GgContextSource`](test_cabinet_core::gg::GgContextSource) band it
    /// occupies *this turn*, its estimated tokens, and its selector tag (from
    /// [`ContextModel::prompt_items`](crate::context::ContextModel::prompt_items)) — the tag
    /// travels onto the pooled definition, so a view's tokens stay attributable to the selector
    /// that filled the window (a file view's path, a text view's label). `response`
    /// is the assistant reply the turn produced and its estimated tokens — pooled like any
    /// message (so it reappears, its id unchanged, as a request pointer next turn), or `None`
    /// when the turn produced no assistant message. `usage`/`cost`/`finish_reason` are the
    /// turn's actual provider outcome, and `duration_ms` the model call's wall-clock
    /// latency (the denominator for the turn's generation throughput), or `None` when the
    /// response was not produced by a timed model call.
    ///
    /// De-duplication makes this cheap on gg's [append-only](crate::message_log) window: only
    /// the messages new *this* turn (typically just the latest assistant/tool exchange, and
    /// any rebuilt mutable block) carry a body; the rest are one id apiece.
    pub fn log_prompt(
        &self,
        request: &[PromptItem<'_>],
        response: Option<(&Message, usize)>,
        usage: TokenCounts,
        cost: Option<Cost>,
        finish_reason: String,
        duration_ms: Option<u64>,
    ) {
        // Stream each request message's body the first time this agent sends it, and build
        // the ordered pointer list. `total_tokens` sums the per-item estimates so it agrees
        // with the adjacent breakdown.
        let mut refs = Vec::with_capacity(request.len());
        let mut total_tokens: u64 = 0;
        for item in request {
            let id = fingerprint(item.message);
            if self.messages.register(&id) {
                self.emit(context_message_event(
                    id.clone(),
                    item.message,
                    item.tokens as u64,
                    item.label,
                ));
            }
            total_tokens += item.tokens as u64;
            refs.push(GgPromptRef {
                id,
                source: item.source,
            });
        }

        // Pool the assistant reply too, so it is a first-class message the next turn can
        // reference and its own token share is legible. A turn with no assistant message
        // (neither text nor tool calls) carries no response pointer.
        let response_id = response.map(|(message, tokens)| {
            let id = fingerprint(message);
            if self.messages.register(&id) {
                // An assistant reply is never a tagged window item — it is pooled here
                // before it is pushed — so it carries no label.
                self.emit(context_message_event(
                    id.clone(),
                    message,
                    tokens as u64,
                    None,
                ));
            }
            id
        });

        self.emit(GgTelemetryKind::Prompt {
            request: refs,
            total_tokens,
            response_id,
            finish_reason,
            tokens: usage,
            cost,
            duration_ms,
        });
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

/// An in-memory [`EventSink`] that keeps every emitted NDJSON line instead of writing it out, so a
/// test can assert on the exact stream a scenario produced.
///
/// Cloneable, sharing one buffer: an [`Emitter`] takes ownership of the sink it writes through, so
/// a caller keeps a clone to read afterwards. Every agent's [scoped](Emitter::for_agent) emitter
/// writes to the same buffer, which is what makes the collected stream the *session's* rather than
/// one agent's.
///
/// Nothing in a live run keeps a telemetry stream in memory — production writes to [`StdoutSink`] —
/// so this is `#[cfg(test)]`, where it is spelled `CollectingSink`, its name since before there was
/// anything else to call it.
#[cfg(test)]
#[derive(Clone, Default)]
pub struct CapturingSink {
    lines: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
}

#[cfg(test)]
impl CapturingSink {
    /// A fresh, empty capturing sink.
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
impl EventSink for CapturingSink {
    fn write_line(&self, line: &str) {
        self.lines.lock().expect("sink lock").push(line.to_string());
    }
}

/// The name gg's test suite has always called [`CapturingSink`] by, kept so that renaming the type
/// did not touch a hundred and seventy call sites that assert nothing new.
#[cfg(test)]
pub type CollectingSink = CapturingSink;

#[cfg(test)]
#[path = "telemetry.test.rs"]
mod tests;
