//! Counting a run's tool calls from its normalized event stream, for the two
//! harnesses whose output names no tools (docs/comparisons/diagnostics.md,
//! "Tool-call counts").
//!
//! The tool-name harnesses are counted by the [event parser](crate::event::EventParser)
//! as it meets each named tool call. Codex reports completed items instead, and gg
//! reports its own telemetry, so their tallies are counted off the events a run
//! records. The same functions count a run as it streams and count a stored run
//! afterwards, so the two never disagree.

use std::collections::BTreeMap;

use crate::event::{EventKind, HarnessEvent};
use crate::gg::GgTelemetryKind;
use crate::run_record::HarnessSlug;

/// The name a Codex event counts under, or `None` for an event that is no tool
/// call (a message, an error, a usage report).
///
/// A Codex command recognized as a file read, search or listing becomes that
/// event, so it counts as a `read`, `search` or `list` rather than a `command`;
/// each file a change touched is its own `write`.
pub fn codex_tool_name(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Read { .. } => Some("read"),
        EventKind::Write { .. } => Some("write"),
        EventKind::Command { .. } => Some("command"),
        EventKind::Search { .. } => Some("search"),
        EventKind::List { .. } => Some("list"),
        _ => None,
    }
}

/// The name a gg event counts under, or `None` for an event that is no tool call.
///
/// Only the native gg carry counts: a tool-calling agent's `ToolCall` under the
/// tool's name, and a responses-as-code program's `ApiCall` under the operation it
/// called. The human-facing events gg's bridge emits beside a carry describe the
/// same call again, so counting them would count it twice.
pub fn gg_tool_name(kind: &EventKind) -> Option<&str> {
    let EventKind::Gg { event } = kind else {
        return None;
    };
    match &event.kind {
        GgTelemetryKind::ToolCall { name, .. } => Some(name),
        GgTelemetryKind::ApiCall { operation } => Some(operation),
        _ => None,
    }
}

/// Count `events` with `name_of`, keyed by lowercased name as the parser's own
/// tally is.
fn count<'e, N: AsRef<str>>(
    events: &'e [HarnessEvent],
    name_of: impl Fn(&'e EventKind) -> Option<N>,
) -> BTreeMap<String, u64> {
    let mut tally = BTreeMap::new();
    for event in events {
        if let Some(name) = name_of(&event.kind) {
            *tally.entry(name.as_ref().to_ascii_lowercase()).or_insert(0) += 1;
        }
    }
    tally
}

/// A Codex run's tool-call tally, counted off its normalized events.
pub fn codex_tool_calls(events: &[HarnessEvent]) -> BTreeMap<String, u64> {
    count(events, codex_tool_name)
}

/// A gg run's tool-call tally, counted off the telemetry its events carry: every
/// agent's tool calls and program function calls, subagents included.
pub fn gg_tool_calls(events: &[HarnessEvent]) -> BTreeMap<String, u64> {
    count(events, gg_tool_name)
}

/// Whether a run of `harness` has its tally counted off its events, rather than by
/// the parser as it streams: true for Codex and gg.
pub fn counted_from_events(harness: HarnessSlug) -> bool {
    matches!(harness, HarnessSlug::Codex | HarnessSlug::Gg)
}

/// The tool-call tally of a stored run of `harness`, counted off its `events`, or
/// `None` for a harness whose tally the parser counts as it streams and that a
/// stored event stream therefore cannot reproduce.
pub fn tool_calls_from_events(
    harness: HarnessSlug,
    events: &[HarnessEvent],
) -> Option<BTreeMap<String, u64>> {
    match harness {
        HarnessSlug::Codex => Some(codex_tool_calls(events)),
        HarnessSlug::Gg => Some(gg_tool_calls(events)),
        _ => None,
    }
}

#[cfg(test)]
#[path = "tool_tally.test.rs"]
mod tests;
